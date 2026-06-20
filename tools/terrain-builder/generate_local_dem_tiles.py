#!/usr/bin/env python3
"""Generate local Terrarium DEM tiles for MapLibre terrain.

This is a lightweight local bootstrap DEM. It is intentionally replaceable by
BD ALTI/RGE ALTI derived tiles once the raster pipeline is installed.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path

import numpy as np
from PIL import Image


FRANCE_BOUNDS = (-6.0, 41.0, 10.2, 52.2)
TILE_SIZE = 256


def lon_to_tile_x(lon: float, zoom: int) -> int:
    return int(math.floor((lon + 180.0) / 360.0 * (2**zoom)))


def lat_to_tile_y(lat: float, zoom: int) -> int:
    lat_rad = math.radians(lat)
    value = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0
    return int(math.floor(value * (2**zoom)))


def tile_pixel_to_lonlat(zoom: int, x: int, y: int, px: np.ndarray, py: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    n = float(2**zoom)
    lon = (x + px / TILE_SIZE) / n * 360.0 - 180.0
    mercator = math.pi * (1.0 - 2.0 * (y + py / TILE_SIZE) / n)
    lat = np.degrees(np.arctan(np.sinh(mercator)))
    return lon, lat


def gaussian(lon: np.ndarray, lat: np.ndarray, lon0: float, lat0: float, amp: float, sx: float, sy: float) -> np.ndarray:
    return amp * np.exp(-(((lon - lon0) / sx) ** 2 + ((lat - lat0) / sy) ** 2) * 0.5)


def synthetic_france_elevation(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    relief = np.zeros_like(lon, dtype=np.float32)
    relief += gaussian(lon, lat, 6.8, 45.35, 3000.0, 0.95, 1.05)   # Alpes
    relief += gaussian(lon, lat, 0.4, 42.75, 2200.0, 2.0, 0.42)     # Pyrenees
    relief += gaussian(lon, lat, 3.0, 45.05, 1200.0, 1.55, 1.05)    # Massif central
    relief += gaussian(lon, lat, 6.15, 46.45, 1150.0, 0.5, 0.7)     # Jura
    relief += gaussian(lon, lat, 7.05, 48.25, 900.0, 0.45, 0.7)     # Vosges
    relief += gaussian(lon, lat, 9.05, 42.15, 1850.0, 0.45, 0.72)   # Corse
    relief += 95.0 * np.sin((lon + 1.7) * 2.4) * np.cos((lat - 45.0) * 1.35)
    relief += 45.0 * np.sin((lon * 5.4) + (lat * 1.8))
    return np.maximum(relief, 0.0)


def encode_terrarium(elevation: np.ndarray) -> np.ndarray:
    encoded = np.clip(elevation + 32768.0, 0.0, 65535.996)
    red = np.floor(encoded / 256.0)
    green = np.floor(encoded - red * 256.0)
    blue = np.floor((encoded - red * 256.0 - green) * 256.0)
    return np.dstack([red, green, blue]).astype(np.uint8)


def tile_range_for_bounds(zoom: int, bounds: tuple[float, float, float, float]) -> tuple[range, range]:
    west, south, east, north = bounds
    max_index = 2**zoom - 1
    x0 = max(0, min(max_index, lon_to_tile_x(west, zoom)))
    x1 = max(0, min(max_index, lon_to_tile_x(east, zoom)))
    y0 = max(0, min(max_index, lat_to_tile_y(north, zoom)))
    y1 = max(0, min(max_index, lat_to_tile_y(south, zoom)))
    return range(x0, x1 + 1), range(y0, y1 + 1)


def write_tile(output_dir: Path, zoom: int, x: int, y: int) -> None:
    coords = np.arange(TILE_SIZE, dtype=np.float32) + 0.5
    px, py = np.meshgrid(coords, coords)
    lon, lat = tile_pixel_to_lonlat(zoom, x, y, px, py)
    elevation = synthetic_france_elevation(lon, lat)
    image = Image.fromarray(encode_terrarium(elevation), mode="RGB")
    tile_path = output_dir / str(zoom) / str(x) / f"{y}.png"
    tile_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(tile_path, optimize=True)


def write_tilejson(output_dir: Path, min_zoom: int, max_zoom: int, bounds: tuple[float, float, float, float]) -> None:
    payload = {
        "tilejson": "3.0.0",
        "name": "Fire Logistics Local DEM",
        "scheme": "xyz",
        "tiles": ["data/terrain-dem/{z}/{x}/{y}.png"],
        "bounds": list(bounds),
        "center": [2.35, 46.8, 6],
        "minzoom": min_zoom,
        "maxzoom": max_zoom,
        "tileSize": TILE_SIZE,
        "encoding": "terrarium",
        "attribution": "Local synthetic DEM bootstrap; replace with BD ALTI/RGE ALTI"
    }
    with open(output_dir / "tilejson.json", "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="assets/web/data/terrain-dem")
    parser.add_argument("--min-zoom", type=int, default=0)
    parser.add_argument("--max-zoom", type=int, default=8)
    parser.add_argument("--bounds", type=float, nargs=4, default=FRANCE_BOUNDS, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    args = parser.parse_args()

    if args.min_zoom < 0 or args.max_zoom < args.min_zoom:
        raise SystemExit("Invalid zoom range")

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    tile_count = 0
    for zoom in range(args.min_zoom, args.max_zoom + 1):
        xs, ys = tile_range_for_bounds(zoom, tuple(args.bounds))
        for x in xs:
            for y in ys:
                write_tile(output_dir, zoom, x, y)
                tile_count += 1

    write_tilejson(output_dir, args.min_zoom, args.max_zoom, tuple(args.bounds))
    print(f"Wrote {tile_count} local DEM tiles to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
