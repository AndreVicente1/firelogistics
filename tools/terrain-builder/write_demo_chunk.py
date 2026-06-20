#!/usr/bin/env python3
"""Generate the tiny procedural FLHT chunk used by the initial 3D scene."""

from __future__ import annotations

import argparse
import math
import os
import struct


def build_heights(size: int, cell_size_meters: float) -> list[float]:
    center = (size - 1) * 0.5
    values: list[float] = []
    for y in range(size):
        for x in range(size):
            dx = (x - center) * cell_size_meters
            dz = (y - center) * cell_size_meters
            ridge = math.sin(dx * 0.0048) * 135.0 + math.cos(dz * 0.0035) * 95.0
            valley = -math.exp(-((dx * dx + dz * dz) / 850000.0)) * 130.0
            shoulder = math.sin((dx + dz) * 0.0025) * 45.0
            values.append(260.0 + ridge + valley + shoulder)
    return values


def write_flht(path: str, size: int, cell_size_meters: float) -> None:
    heights = build_heights(size, cell_size_meters)
    origin = -((size - 1) * cell_size_meters) * 0.5
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(b"FLHT")
        handle.write(struct.pack("<HH", 1, 0))
        handle.write(struct.pack("<ii", size, size))
        handle.write(struct.pack("<f", cell_size_meters))
        handle.write(struct.pack("<f", origin))
        handle.write(struct.pack("<f", origin))
        handle.write(struct.pack("<f", 1.0))
        handle.write(struct.pack("<f", min(heights)))
        handle.write(struct.pack("<f", max(heights)))
        handle.write(struct.pack(f"<{len(heights)}f", *heights))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="assets/terrain/chunks/demo/marseille-demo.flht")
    parser.add_argument("--size", type=int, default=65)
    parser.add_argument("--cell-size-meters", type=float, default=25.0)
    args = parser.parse_args()

    if args.size <= 1:
        raise SystemExit("--size must be greater than 1")
    if args.cell_size_meters <= 0:
        raise SystemExit("--cell-size-meters must be positive")

    write_flht(args.output, args.size, args.cell_size_meters)
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
