#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fromFile } from "geotiff";
import { PNG } from "pngjs";
import proj4 from "proj4";

const DEFAULT_INPUT = "data-sources/terrain/MNT_FRANCE-BDALTI_25M_L93_lzw.COG.TIF";
const DEFAULT_OUTPUT = "assets/web/data/terrain-dem";
const DEFAULT_BOUNDS = [-6.0, 41.0, 10.2, 52.2];
const TILE_SIZE = 256;

proj4.defs(
  "EPSG:2154",
  "+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs"
);

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    minZoom: 6,
    maxZoom: 8,
    bounds: DEFAULT_BOUNDS,
    exaggerationBake: 1
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--min-zoom") args.minZoom = Number(argv[++i]);
    else if (arg === "--max-zoom") args.maxZoom = Number(argv[++i]);
    else if (arg === "--bounds") args.bounds = argv.slice(i + 1, i + 5).map(Number), i += 4;
    else if (arg === "--exaggeration-bake") args.exaggerationBake = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
node tools/terrain-builder/build_bdalti_terrarium_tiles.mjs --input <BDALTI.tif> --output assets/web/data/terrain-dem --max-zoom 8

Options:
  --bounds west south east north   Default: ${DEFAULT_BOUNDS.join(" ")}
  --min-zoom n                    Default: 6
  --max-zoom n                    Default: 8
  --exaggeration-bake n           Default: 1, keep source elevation unmodified
`);
      process.exit(0);
    }
  }

  if (!Number.isInteger(args.minZoom) || !Number.isInteger(args.maxZoom) || args.minZoom < 0 || args.maxZoom < args.minZoom) {
    throw new Error("Invalid zoom range.");
  }
  if (args.bounds.length !== 4 || args.bounds.some(value => !Number.isFinite(value))) {
    throw new Error("Invalid bounds.");
  }
  if (!Number.isFinite(args.exaggerationBake) || args.exaggerationBake <= 0) {
    throw new Error("Invalid --exaggeration-bake.");
  }
  return args;
}

function lonToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function latToTileY(lat, zoom) {
  const latRad = lat * Math.PI / 180;
  return Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * 2 ** zoom);
}

function tilePixelToLonLat(zoom, x, y, px, py) {
  const n = 2 ** zoom;
  const lon = (x + px / TILE_SIZE) / n * 360 - 180;
  const mercator = Math.PI * (1 - 2 * (y + py / TILE_SIZE) / n);
  const lat = Math.atan(Math.sinh(mercator)) * 180 / Math.PI;
  return [lon, lat];
}

function getTileRanges(bounds, zoom) {
  const [west, south, east, north] = bounds;
  const maxIndex = 2 ** zoom - 1;
  const x0 = clamp(lonToTileX(west, zoom), 0, maxIndex);
  const x1 = clamp(lonToTileX(east, zoom), 0, maxIndex);
  const y0 = clamp(latToTileY(north, zoom), 0, maxIndex);
  const y1 = clamp(latToTileY(south, zoom), 0, maxIndex);
  return { x0, x1, y0, y1 };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeTerrariumPixel(elevationMeters) {
  const value = clamp(elevationMeters + 32768, 0, 65535.996);
  const red = Math.floor(value / 256);
  const green = Math.floor(value - red * 256);
  const blue = Math.floor((value - red * 256 - green) * 256);
  return [red, green, blue];
}

function normalizeElevation(value, noData) {
  if (value === noData || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function sampleWindowNearest(raster, window, sourceX, sourceY, noData) {
  const [minX, minY, maxX, maxY] = window;
  if (sourceX < minX || sourceX >= maxX || sourceY < minY || sourceY >= maxY) {
    return 0;
  }

  const localX = clamp(Math.round(sourceX - minX), 0, maxX - minX - 1);
  const localY = clamp(Math.round(sourceY - minY), 0, maxY - minY - 1);
  return normalizeElevation(raster[localY * (maxX - minX) + localX], noData);
}

function tileLambertWindow(zoom, x, y, originX, originY, pixelScaleX, pixelScaleY, width, height) {
  const corners = [
    tilePixelToLonLat(zoom, x, y, 0, 0),
    tilePixelToLonLat(zoom, x, y, TILE_SIZE, 0),
    tilePixelToLonLat(zoom, x, y, TILE_SIZE, TILE_SIZE),
    tilePixelToLonLat(zoom, x, y, 0, TILE_SIZE)
  ].map(([lon, lat]) => proj4("EPSG:4326", "EPSG:2154", [lon, lat]));

  const xs = corners.map(([lambertX]) => (lambertX - originX) / pixelScaleX);
  const ys = corners.map(([, lambertY]) => (originY - lambertY) / pixelScaleY);
  const rawMinX = Math.floor(Math.min(...xs)) - 2;
  const rawMaxX = Math.ceil(Math.max(...xs)) + 2;
  const rawMinY = Math.floor(Math.min(...ys)) - 2;
  const rawMaxY = Math.ceil(Math.max(...ys)) + 2;
  const minX = clamp(rawMinX, 0, width - 1);
  const maxX = clamp(rawMaxX, 0, width);
  const minY = clamp(rawMinY, 0, height - 1);
  const maxY = clamp(rawMaxY, 0, height);

  if (maxX <= minX || maxY <= minY) {
    return null;
  }

  return [minX, minY, maxX, maxY];
}

function writeTileJson(output, bounds, minZoom, maxZoom) {
  const payload = {
    tilejson: "3.0.0",
    name: "Fire Logistics BD ALTI DEM local",
    scheme: "xyz",
    tiles: ["data/terrain-dem/{z}/{x}/{y}.png"],
    bounds,
    center: [2.35, 46.8, 6],
    minzoom: minZoom,
    maxzoom: maxZoom,
    tileSize: TILE_SIZE,
    encoding: "terrarium",
    attribution: "IGN BD ALTI local"
  };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "tilejson.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.input)) {
    throw new Error(`Input COG not found: ${args.input}`);
  }

  const tiff = await fromFile(args.input);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const tie = image.getTiePoints()[0];
  const scale = image.getFileDirectory().ModelPixelScale;
  const origin = image.getOrigin?.();
  const resolution = image.getResolution?.();
  const noDataRaw = image.getGDALNoData();
  const noData = noDataRaw == null ? null : Number(noDataRaw);

  let originX;
  let originY;
  let pixelScaleX;
  let pixelScaleY;
  if (origin && resolution) {
    originX = origin[0];
    originY = origin[1];
    pixelScaleX = Math.abs(resolution[0]);
    pixelScaleY = Math.abs(resolution[1]);
  } else if (tie && scale) {
    originX = tie.x;
    originY = tie.y;
    pixelScaleX = Math.abs(scale[0]);
    pixelScaleY = Math.abs(scale[1]);
  } else {
    throw new Error("GeoTIFF georeferencing is missing origin/resolution metadata.");
  }
  let count = 0;
  writeTileJson(args.output, args.bounds, args.minZoom, args.maxZoom);

  for (let zoom = args.minZoom; zoom <= args.maxZoom; zoom++) {
    const range = getTileRanges(args.bounds, zoom);
    for (let x = range.x0; x <= range.x1; x++) {
      for (let y = range.y0; y <= range.y1; y++) {
        const window = tileLambertWindow(zoom, x, y, originX, originY, pixelScaleX, pixelScaleY, width, height);
        if (window == null) {
          continue;
        }

        const rasterPayload = await image.readRasters({ window, interleave: true });
        const raster = Array.isArray(rasterPayload) ? rasterPayload[0] : rasterPayload;
        const png = new PNG({ width: TILE_SIZE, height: TILE_SIZE, colorType: 2 });
        for (let py = 0; py < TILE_SIZE; py++) {
          for (let px = 0; px < TILE_SIZE; px++) {
            const [lon, lat] = tilePixelToLonLat(zoom, x, y, px + 0.5, py + 0.5);
            const [lambertX, lambertY] = proj4("EPSG:4326", "EPSG:2154", [lon, lat]);
            const sourceX = (lambertX - originX) / pixelScaleX;
            const sourceY = (originY - lambertY) / pixelScaleY;
            const inRaster = sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height;
            const elevation = (inRaster ? sampleWindowNearest(raster, window, sourceX, sourceY, noData) : 0) * args.exaggerationBake;
            const [red, green, blue] = makeTerrariumPixel(elevation);
            const offset = (py * TILE_SIZE + px) * 4;
            png.data[offset] = red;
            png.data[offset + 1] = green;
            png.data[offset + 2] = blue;
            png.data[offset + 3] = 255;
          }
        }

        const tilePath = path.join(args.output, String(zoom), String(x), `${y}.png`);
        fs.mkdirSync(path.dirname(tilePath), { recursive: true });
        fs.writeFileSync(tilePath, PNG.sync.write(png, { colorType: 2 }));
        count++;
      }
    }
  }

  console.log(`Wrote ${count} BD ALTI Terrarium tiles to ${args.output}`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
