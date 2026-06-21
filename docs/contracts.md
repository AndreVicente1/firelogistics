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

C# publishes runtime metrics by evaluating:

```js
window.FireLogistics.updateRuntimeMetrics({ fps, ramBytes })
```

`fps` is an integer. `ramBytes` is the current process working set in bytes.

## Required Web Assets

`assets/web/index.html` is the browser entry point. The runtime requires these tracked files:

- `assets/web/css/game.css`
- `assets/web/js/app.js`
- `assets/web/js/fire-model.js`
- `assets/web/js/fire-simulation.js`
- `assets/web/js/fire-effects.js`
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
