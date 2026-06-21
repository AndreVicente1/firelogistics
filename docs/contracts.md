# Fire Logistics Runtime Contracts

This document records contracts that agents must preserve when changing runtime code.

## WebView IPC

Messages from JavaScript to Godot are JSON objects with this shape:

```json
{ "action": "diagnostics_log", "payload": "Diagnostic text" }
```

Supported JS -> C# actions:

- `diagnostics_log`: logs a diagnostic payload in Godot.
- `quit_game`: asks Godot to quit the current tree.
- `fire_ignition_selected`: reports a selected ignition center as `{ "center": [longitude, latitude] }`.
- `fire_command`: controls the Core fire runtime with `{ "command": "pause" | "resume" | "reset" | "clear" }`.
- `fire_fuel_overrides_ready`: reports optional rendered-map fuels as `{ "originX": number, "originY": number, "width": number, "height": number, "cellKm": number, "fuels": string[] }`. This message may be sent repeatedly; C# merges the samples into the current incident instead of resetting it.
- `fire_fuel_sample_failed`: reports that the browser could not sample fuels for the requested window. C# clears the pending sample request and may ask again.

C# publishes the authoritative fire simulation frame by evaluating:

```js
window.FireLogistics.receiveFireFrame(frame)
```

`frame` has this shape:

```json
{
  "step": 0,
  "revision": 1,
  "reason": "initial",
  "center": [5.38, 43.3],
  "incidentSeed": 1,
  "zones": { "type": "FeatureCollection", "features": [] },
  "burnScar": { "reset": true, "revision": 1, "cellKm": 0.18, "runs": [] },
  "emitters": [],
  "cells": [],
  "stats": {
    "burnedHectares": 0,
    "frontKilometers": 0,
    "intensity": "Moderee",
    "activeCells": 0,
    "threatenedBuildings": 0,
    "fuelImpacts": {}
  },
  "wind": { "direction": "E-NE", "degrees": 72, "speedKmh": 28 },
  "status": "running"
}
```

`status` is `"idle"`, `"running"`, `"paused"`, or `"extinguished"`. `"idle"` means no incident is active yet. The browser must use the C# frame status as authoritative and must not advance or rebuild the fire locally while connected to Godot.

`revision` is monotonic within an incident and `reason` explains why the frame was published (`"initial"`, `"tick"`, `"command"`, `"reset"`, `"ignition"`, or `"fuel_sample"`). The browser must apply only the newest Core frame for an incident and coalesce multiple received frames so MapLibre is updated at most once per browser animation frame.

`zones` remains GeoJSON for MapLibre. Fire feature geometry may be `Polygon` or `MultiPolygon`; individual polygons are exterior-filled tactical surfaces and must not use inner rings to create donut-shaped active fronts. Fire zones must not visually cover non-burnable water or mineral cells. Clients that need a fluid surface should rebuild live zones from `cells`.

`cells` is a compact array of all visible fire cells (`{ "x", "y", "fuel", "state", "intensity", "heat" }`) used by the browser to rebuild zones in blob mode without re-simulating locally. C# must publish every visible live cell on every Core frame without render sampling or caps. Gameplay/state counters must come from `stats`, not from assuming `cells` is exhaustive.

`burnScar` is an optional compact patch for the complete burned trace. It has `{ "reset": boolean, "revision": number, "cellKm": number, "runs": [{ "y": number, "x1": number, "x2": number, "fuel": string }] }`. When `reset` is true, the browser replaces the burn-scar source with exactly those runs. When `reset` is false, the browser appends the runs incrementally. `zones` and `cells` represent the live front and must not be treated as the complete burned-history source.

The browser may switch fire rendering between:

- `blob`: smooth tactical envelope built client-side from `cells`
- `grid`: rectangular cell runs; Core frames may reuse authoritative `zones` directly

Each live-zone feature must expose a stable `properties.id` (`heat-surface`, `active-surface`, `embers-surface` for blob mode, or `{state}-{fuel}` for grid mode) so the browser can diff updates. Burn-scar features use stable ids `burn-{y}-{x1}-{x2}-{fuel}` with one feature per horizontal run.

## Fire map rendering

Fire is rendered exclusively with native MapLibre GL `fill`/`line` layers bound to GeoJSON sources. The live front uses `wildfire-zones`; the long-term burned trace uses `wildfire-burn-scar`. There is no canvas overlay, smoke layer, or particle FX.

The map style declares `promoteId: "id"` on `wildfire-zones` and `wildfire-burn-scar`. The browser must:

1. Call `setData(zones)` once when fire zones first appear for an incident.
2. Call `updateData(diff)` on later ticks, updating geometry/properties by stable feature id.
3. Call `updateData({ removeAll: true })` when an incident is cleared.
4. Skip MapLibre writes when the zones hash is unchanged.
5. Apply `burnScar` patches to `wildfire-burn-scar` with `setData` on reset and `updateData({ add })` for deltas.

Tactical layer ids (bottom to top): `fire-heat`, `fire-active-core`, `fire-active-glow`, `fire-ember-bed`, `fire-burn-scar`, `fire-perimeter`, `wildfire-ignition`. Layers drape on the terrain DEM.

C# can ask the browser to resample rendered fuels around the moving front by evaluating:

```js
window.FireLogistics.requestFuelSample({ originX, originY, width, height, cellKm })
```

The sample window is dynamic: C# sizes it from the live fire front plus margin and recenters as the incident grows. The browser must not send fixed-size fuel samples while connected to Godot.

C# publishes runtime metrics by evaluating:

```js
window.FireLogistics.updateRuntimeMetrics({ fps, ramBytes })
```

`fps` is the Godot engine frame rate. `ramBytes` is the working set of the Godot process tree in bytes, including WebView2 child processes when present.

The browser computes MapLibre cartography FPS locally from `map.on("render")` and displays it in the HUD as `Carte FPS`.

## Required Web Assets

`assets/web/index.html` is the browser entry point. The runtime requires these tracked files:

- `assets/web/css/game.css`
- `assets/web/js/app.js`
- `assets/web/js/fire-model.js`
- `assets/web/js/fire-simulation.js`
- `assets/web/vendor/maplibre-gl@4.7.1/maplibre-gl.js`
- `assets/web/vendor/maplibre-gl@4.7.1/maplibre-gl.css`
- `assets/web/vendor/pmtiles@4.4.1/pmtiles.js`

Large local map data stays untracked. Missing PMTiles, terrain, or vegetation data must degrade gracefully.

## Terrain Format `.flht`

The current terrain chunk format is version 1 and must remain backward compatible.

- Magic: ASCII `FLHT`
- Version: `uint16` little-endian, currently `1`
- Flags: `uint16` little-endian, currently `0`
- Width/height: `int32` little-endian, both greater than `1`
- Cell size, origin X/Z, elevation scale, min elevation, max elevation: `float32` little-endian
- Elevations: `width * height` `float32` values multiplied by elevation scale on read

Any incompatible change must use a new version and tests for both old and new readers.

## Data Rules

These paths are local or generated and must not be tracked:

- `OSO_20230101_RASTER.tar.gz`
- `.cache/`
- `data-sources/`
- `assets/web/data/*.pmtiles`
- `assets/web/data/terrain-dem/[0-9]*/`
- `assets/terrain/chunks/ign/`
- `assets/terrain/chunks/national/`
- `assets/terrain/chunks/pilot/`

Runtime code must not assume national terrain or vegetation data exists.
