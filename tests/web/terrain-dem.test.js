const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("../../tools/terrain-builder/node_modules/pngjs");

function tilePixelFor(lon, lat, zoom) {
  const n = 2 ** zoom;
  const fx = (lon + 180) / 360 * n;
  const latRad = lat * Math.PI / 180;
  const fy = (1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n;
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  return {
    x,
    y,
    px: Math.floor((fx - x) * 256),
    py: Math.floor((fy - y) * 256)
  };
}

function readTerrariumElevation(lon, lat, zoom = 8) {
  const tile = tilePixelFor(lon, lat, zoom);
  const tilePath = path.join(__dirname, "..", "..", "assets", "web", "data", "terrain-dem", String(zoom), String(tile.x), `${tile.y}.png`);
  const png = PNG.sync.read(fs.readFileSync(tilePath));
  const offset = (tile.py * png.width + tile.px) * 4;
  return (png.data[offset] * 256 + png.data[offset + 1] + png.data[offset + 2] / 256) - 32768;
}

test("local BD ALTI DEM keeps sea pixels flat", () => {
  assert.equal(readTerrariumElevation(4.2, 42.75), 0);
});

test("local BD ALTI DEM contains positive land elevation", () => {
  assert.ok(readTerrariumElevation(6.8, 45.8) > 2500);
});
