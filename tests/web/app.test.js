const test = require("node:test");
const assert = require("node:assert/strict");

test("formatBytes renders common units", () => {
  const { formatBytes } = require("../../assets/web/js/app.js");

  assert.equal(formatBytes(0), "--");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(2 * 1024 * 1024), "2.0 MB");
});

test("map style includes world backdrop and France PMTiles sources", () => {
  const { buildFranceWorldStyle } = require("../../assets/web/js/app.js");

  const style = buildFranceWorldStyle();

  assert.equal(style.sources["world-backdrop"].type, "geojson");
  assert.equal(style.sources["world-backdrop"].data, "data/world-backdrop.geojson");
  assert.equal(style.sources.france.type, "vector");
  assert.equal(style.sources.france.url, "pmtiles://data/france-openmaptiles.pmtiles");
  assert.ok(style.layers.some(layer => layer.id === "world-backdrop-land"));
  assert.ok(style.layers.some(layer => layer.id === "world-backdrop-water"));
});

test("map style includes permanent fuel layers before roads and buildings", () => {
  const { FUEL_COLORS, buildFranceWorldStyle, buildFuelLayerDefinitions } = require("../../assets/web/js/app.js");

  const style = buildFranceWorldStyle();
  const fuelLayers = buildFuelLayerDefinitions();
  const layerIds = style.layers.map(layer => layer.id);

  assert.deepEqual(fuelLayers.map(layer => layer.id), [
    "fuel-water",
    "fuel-mineral",
    "fuel-crops",
    "fuel-grass",
    "fuel-scrub",
    "fuel-forest",
    "fuel-urban"
  ]);
  assert.ok(fuelLayers.every(layer => layer.source === "france"));
  assert.equal(fuelLayers.find(layer => layer.id === "fuel-forest").paint["fill-color"], FUEL_COLORS.forest);
  assert.equal(fuelLayers.find(layer => layer.id === "fuel-crops").paint["fill-color"], FUEL_COLORS.crops);

  const lastFuelIndex = Math.max(...layerIds.filter(id => id.startsWith("fuel-")).map(id => layerIds.indexOf(id)));
  assert.ok(lastFuelIndex < layerIds.indexOf("transportation"));
  assert.ok(lastFuelIndex < layerIds.indexOf("buildings"));
});

test("map style enables terrain relief on the cartography", () => {
  const {
    TERRAIN_EXAGGERATION,
    TERRAIN_SOURCE_ID,
    buildFranceWorldStyle,
    buildTerrainLayerDefinition,
    buildTerrainSourceDefinition
  } = require("../../assets/web/js/app.js");

  const style = buildFranceWorldStyle();
  const layerIds = style.layers.map(layer => layer.id);

  assert.equal(TERRAIN_SOURCE_ID, "terrain-dem");
  assert.equal(style.sources[TERRAIN_SOURCE_ID].type, "raster-dem");
  assert.equal(style.sources[TERRAIN_SOURCE_ID].url, "data/terrain-dem/tilejson.json");
  assert.ok(!style.sources[TERRAIN_SOURCE_ID].url.startsWith("http"));
  assert.equal(style.sources[TERRAIN_SOURCE_ID].url, buildTerrainSourceDefinition().url);
  assert.equal(style.terrain.source, TERRAIN_SOURCE_ID);
  assert.equal(style.terrain.exaggeration, TERRAIN_EXAGGERATION);
  assert.equal(buildTerrainLayerDefinition().type, "hillshade");
  assert.ok(layerIds.indexOf("terrain-hillshade") > layerIds.indexOf("fuel-forest"));
  assert.ok(layerIds.indexOf("terrain-hillshade") < layerIds.indexOf("transportation"));
  assert.ok(layerIds.indexOf("terrain-hillshade") < layerIds.indexOf("buildings"));
});

test("map style includes tactical wildfire layers above terrain and below roads", () => {
  const {
    BURN_SCAR_SOURCE_ID,
    FIRE_COLORS,
    FIRE_SOURCE_ID,
    buildFireLayerDefinitions,
    buildFranceWorldStyle
  } = require("../../assets/web/js/app.js");

  const style = buildFranceWorldStyle();
  const fireLayers = buildFireLayerDefinitions();
  const layerIds = style.layers.map(layer => layer.id);

  assert.equal(style.sources[FIRE_SOURCE_ID].type, "geojson");
  assert.equal(style.sources[FIRE_SOURCE_ID].promoteId, "id");
  assert.equal(style.sources[FIRE_SOURCE_ID].data.type, "FeatureCollection");
  assert.deepEqual(style.sources[FIRE_SOURCE_ID].data.features, []);
  assert.equal(style.sources[BURN_SCAR_SOURCE_ID].type, "geojson");
  assert.equal(style.sources[BURN_SCAR_SOURCE_ID].promoteId, "id");
  assert.deepEqual(fireLayers.map(layer => layer.id), [
    "fire-heat",
    "fire-active-core",
    "fire-active-glow",
    "fire-ember-bed",
    "fire-burn-scar",
    "fire-perimeter",
    "wildfire-ignition"
  ]);
  assert.match(JSON.stringify(fireLayers.find(layer => layer.id === "fire-active-core").paint["fill-color"]), /intensity/);
  assert.equal(fireLayers.find(layer => layer.id === "fire-burn-scar").paint["fill-color"], FIRE_COLORS.burned);
  assert.equal(fireLayers.find(layer => layer.id === "fire-burn-scar").source, BURN_SCAR_SOURCE_ID);

  const firstFireIndex = layerIds.indexOf("fire-heat");
  const lastFireIndex = layerIds.indexOf("fire-perimeter");
  assert.ok(firstFireIndex > layerIds.indexOf("terrain-hillshade"));
  assert.ok(lastFireIndex < layerIds.indexOf("transportation"));
  assert.ok(lastFireIndex < layerIds.indexOf("buildings"));
});

test("wildfire simulation frame expands deterministically", () => {
  const { buildFireSimulationFrame } = require("../../assets/web/js/app.js");

  const initial = buildFireSimulationFrame(0);
  const later = buildFireSimulationFrame(12);

  assert.equal(initial.zones.type, "FeatureCollection");
  assert.ok(initial.zones.features.every(feature => feature.properties.fuel));
  assert.ok(initial.zones.features.some(feature => feature.properties.state === "active"));
  assert.ok(initial.zones.features.length <= 4);
  assert.ok(initial.zones.features.every(feature => feature.geometry.coordinates[0].length > 20));
  assert.equal(initial.emitters.length, initial.stats.activeCells);
  assert.ok(later.stats.burnedHectares > initial.stats.burnedHectares);
  assert.ok(later.stats.frontKilometers > initial.stats.frontKilometers);
  assert.ok(later.stats.fuelImpacts.forest > 0);
  assert.ok(later.stats.fuelImpacts.scrub > 0);
  assert.equal(later.stats.fuelImpacts.water, 0);
  assert.equal(later.stats.fuelImpacts.mineral, 0);
  assert.equal(later.wind.direction, "E-NE");
});

test("wildfire polygons are filled surfaces without donut holes", () => {
  const { buildFireSimulationFrame } = require("../../assets/web/js/app.js");

  const frame = buildFireSimulationFrame(80);

  assert.ok(frame.zones.features.length > 0);
  assert.ok(frame.zones.features.every(feature => feature.geometry.type === "Polygon"));
  assert.ok(frame.zones.features.every(feature => feature.geometry.coordinates.length === 1));
});

test("fire layers render natively from the GeoJSON source draped on terrain", () => {
  const {
    BURN_SCAR_SOURCE_ID,
    FIRE_SOURCE_ID,
    buildFireLayerDefinitions
  } = require("../../assets/web/js/app.js");

  const fireLayers = buildFireLayerDefinitions();
  const fillAndLineLayers = fireLayers.filter(layer => layer.type === "fill" || layer.type === "line");

  assert.ok(fillAndLineLayers.length > 0);
  assert.ok(fillAndLineLayers.every(layer => layer.source === FIRE_SOURCE_ID || layer.source === BURN_SCAR_SOURCE_ID));
  assert.ok(fireLayers.every(layer => layer.layout?.visibility !== "none"));
});

test("active fire fill color is driven by feature intensity", () => {
  const { buildFireLayerDefinitions } = require("../../assets/web/js/app.js");

  const activeCore = buildFireLayerDefinitions().find(layer => layer.id === "fire-active-core");
  const fillColor = JSON.stringify(activeCore.paint["fill-color"]);

  assert.match(fillColor, /interpolate/);
  assert.match(fillColor, /intensity/);
});

test("received Core fire frames update both ignition and terrain-draped fire zones", () => {
  const {
    FIRE_SOURCE_ID,
    applyFireFrameToSources,
    buildFireSimulationFrame,
    resolveFireZones
  } = require("../../assets/web/js/app.js");
  const frame = buildFireSimulationFrame(3);
  const calls = {};
  const map = {
    getSource(id) {
      return {
        setData(data) {
          calls[id] = data;
        }
      };
    }
  };

  applyFireFrameToSources(map, frame, frame.center);

  assert.deepEqual(calls[FIRE_SOURCE_ID], resolveFireZones(frame));
  assert.equal(calls["wildfire-ignition"].features[0].geometry.coordinates[0], frame.center[0]);
});

test("fire zone updates use incremental updateData after the initial setData", () => {
  const {
    FIRE_SOURCE_ID,
    applyFireFrameToSources,
    buildFireSimulationFrame,
    createFireRenderState,
    hashZones
  } = require("../../assets/web/js/app.js");
  const initial = buildFireSimulationFrame(3);
  const later = buildFireSimulationFrame(8);
  const renderState = createFireRenderState();
  let setDataCalls = 0;
  let updateDataCalls = 0;
  const map = {
    __fireRenderState: renderState,
    getSource(id) {
      return {
        setData() {
          if (id === FIRE_SOURCE_ID) setDataCalls += 1;
        },
        updateData() {
          if (id === FIRE_SOURCE_ID) updateDataCalls += 1;
        }
      };
    }
  };

  applyFireFrameToSources(map, initial, initial.center);
  applyFireFrameToSources(map, initial, initial.center);
  applyFireFrameToSources(map, later, later.center);

  assert.equal(setDataCalls, 1);
  assert.equal(updateDataCalls, 1);
  assert.equal(renderState.lastZonesHash, hashZones(later.zones));
});

test("burn scar deltas update a separate source without rewriting fire zones", () => {
  const {
    BURN_SCAR_SOURCE_ID,
    FIRE_SOURCE_ID,
    applyFireFrameToSources,
    createEmptyFireFrame,
    createFireRenderState
  } = require("../../assets/web/js/app.js");
  const renderState = createFireRenderState();
  const initial = {
    ...createEmptyFireFrame([5.38, 43.3]),
    incidentSeed: 201,
    revision: 1,
    status: "running"
  };
  const delta = {
    ...initial,
    revision: 2,
    burnScar: {
      reset: false,
      revision: 2,
      cellKm: 0.18,
      runs: [{ y: 0, x1: 0, x2: 2, fuel: "forest" }]
    }
  };
  const writes = {
    fireSetData: 0,
    fireUpdateData: 0,
    scarSetData: 0,
    scarUpdateData: 0
  };
  const sources = {
    [FIRE_SOURCE_ID]: {
      setData() { writes.fireSetData += 1; },
      updateData() { writes.fireUpdateData += 1; }
    },
    [BURN_SCAR_SOURCE_ID]: {
      setData() { writes.scarSetData += 1; },
      updateData(diff) {
        writes.scarUpdateData += 1;
        assert.equal(diff.add.length, 1);
      }
    },
    "wildfire-ignition": { setData() {} }
  };
  const map = {
    __fireRenderState: renderState,
    getSource(id) { return sources[id]; }
  };

  applyFireFrameToSources(map, initial, initial.center);
  applyFireFrameToSources(map, delta, delta.center);

  assert.equal(writes.fireSetData, 1);
  assert.equal(writes.fireUpdateData, 0);
  assert.equal(writes.scarSetData, 2);
  assert.equal(writes.scarUpdateData, 0);
});

test("pending Core fire frames merge burn scar deltas before render", () => {
  const {
    BURN_SCAR_SOURCE_ID,
    createFireSimulation
  } = require("../../assets/web/js/app.js");
  const previousDocument = global.document;
  const previousRequestAnimationFrame = global.requestAnimationFrame;
  const previousIpc = global.ipc;
  const previousPendingFrame = global.FireLogistics.pendingFireFrame;
  const rafCallbacks = [];
  let scarFeatureCount = 0;
  global.document = {
    getElementById() {
      return { textContent: "", addEventListener() {}, classList: { toggle() {} } };
    }
  };
  global.requestAnimationFrame = callback => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };
  global.ipc = { postMessage() {} };
  global.FireLogistics.pendingFireFrame = null;
  const sources = {
    "wildfire-zones": { setData() {}, updateData() {} },
    [BURN_SCAR_SOURCE_ID]: {
      setData(data) { scarFeatureCount = data.features.length; },
      updateData() {}
    },
    "wildfire-ignition": { setData() {} }
  };
  const map = {
    __fireRenderState: null,
    isStyleLoaded() { return true; },
    getSource(id) { return sources[id]; }
  };
  const baseFrame = {
    step: 1,
    center: [5.38, 43.3],
    incidentSeed: 202,
    zones: { type: "FeatureCollection", features: [] },
    cells: [],
    emitters: [],
    stats: { activeCells: 0, burnedHectares: 0, frontKilometers: 0, intensity: "Moderee", threatenedBuildings: 0, fuelImpacts: {} },
    wind: { direction: "E-NE", degrees: 72, speedKmh: 28 },
    status: "running"
  };

  try {
    const controller = createFireSimulation(map);
    controller.receiveFrame({
      ...baseFrame,
      revision: 1,
      burnScar: { reset: false, revision: 1, cellKm: 0.18, runs: [{ y: 0, x1: 0, x2: 0, fuel: "forest" }] }
    });
    controller.receiveFrame({
      ...baseFrame,
      revision: 2,
      burnScar: { reset: false, revision: 2, cellKm: 0.18, runs: [{ y: 1, x1: 1, x2: 1, fuel: "scrub" }] }
    });
    rafCallbacks.find(callback => callback.name === "applyPendingCoreFrame")();

    assert.equal(scarFeatureCount, 2);
  } finally {
    global.document = previousDocument;
    global.requestAnimationFrame = previousRequestAnimationFrame;
    global.ipc = previousIpc;
    global.FireLogistics.pendingFireFrame = previousPendingFrame;
  }
});

test("fire map writes are deferred while the map is zooming", () => {
  const {
    FIRE_SOURCE_ID,
    buildFireSimulationFrame,
    createFireSimulation
  } = require("../../assets/web/js/app.js");
  const previousDocument = global.document;
  const previousRequestAnimationFrame = global.requestAnimationFrame;
  const previousIpc = global.ipc;
  const previousPendingFrame = global.FireLogistics.pendingFireFrame;
  const rafCallbacks = [];
  const handlers = {};
  const fireWrites = { setData: 0, updateData: 0 };
  global.document = {
    getElementById() {
      return { textContent: "", addEventListener() {}, classList: { toggle() {} } };
    }
  };
  global.requestAnimationFrame = callback => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };
  global.ipc = { postMessage() {} };
  global.FireLogistics.pendingFireFrame = null;
  const sources = {
    [FIRE_SOURCE_ID]: {
      setData() { fireWrites.setData += 1; },
      updateData() { fireWrites.updateData += 1; }
    },
    "wildfire-ignition": { setData() {} }
  };
  const map = {
    __fireRenderState: null,
    isStyleLoaded() { return true; },
    getSource(id) { return sources[id]; },
    on(event, callback) { handlers[event] = callback; }
  };
  const frame = {
    ...buildFireSimulationFrame(3),
    incidentSeed: 101,
    revision: 1,
    status: "running"
  };

  try {
    const controller = createFireSimulation(map);
    handlers.zoomstart();
    controller.receiveFrame(frame);
    rafCallbacks.find(callback => callback.name === "applyPendingCoreFrame")();

    assert.equal(fireWrites.setData, 0);
    assert.equal(fireWrites.updateData, 0);
    assert.equal(controller.getFrame(), frame);

    handlers.zoomend();
    rafCallbacks.find(callback => callback.name === "flushDeferredMapFrame")();

    assert.equal(fireWrites.setData, 1);
    assert.equal(fireWrites.updateData, 0);
  } finally {
    global.document = previousDocument;
    global.requestAnimationFrame = previousRequestAnimationFrame;
    global.ipc = previousIpc;
    global.FireLogistics.pendingFireFrame = previousPendingFrame;
  }
});

test("paused Core frames with unchanged geometry do not rewrite fire zones", () => {
  const {
    BURN_SCAR_SOURCE_ID,
    FIRE_SOURCE_ID,
    applyFireFrameToSources,
    buildFireSimulationFrame,
    createFireRenderState
  } = require("../../assets/web/js/app.js");
  const renderState = createFireRenderState();
  const initial = {
    ...buildFireSimulationFrame(6),
    incidentSeed: 102,
    revision: 2,
    reason: "tick",
    status: "running"
  };
  const paused = {
    ...initial,
    revision: 3,
    reason: "command",
    status: "paused"
  };
  let fireSetData = 0;
  let fireUpdateData = 0;
  let ignitionSetData = 0;
  const map = {
    __fireRenderState: renderState,
    getSource(id) {
      if (id === FIRE_SOURCE_ID) {
        return {
          setData() { fireSetData += 1; },
          updateData() { fireUpdateData += 1; }
        };
      }
      if (id === BURN_SCAR_SOURCE_ID) {
        return {
          setData() {},
          updateData() {}
        };
      }
      return {
        setData() { ignitionSetData += 1; }
      };
    }
  };

  applyFireFrameToSources(map, initial, initial.center);
  applyFireFrameToSources(map, paused, paused.center);

  assert.equal(fireSetData, 1);
  assert.equal(fireUpdateData, 0);
  assert.equal(ignitionSetData, 1);
});

test("grid rendering keeps grid geometry when the cell budget is too high", () => {
  const {
    FIRE_RENDER_MODES,
    FIRE_SOURCE_ID,
    MAX_RENDERED_ZONE_CELLS,
    applyFireFrameToSources,
    buildFireSimulationFrame,
    createFireRenderState
  } = require("../../assets/web/js/app.js");
  const frame = {
    ...buildFireSimulationFrame(40),
    incidentSeed: 103,
    revision: 1,
    status: "running"
  };
  const renderState = createFireRenderState();
  let renderedZones = null;
  const map = {
    __fireRenderState: renderState,
    getSource(id) {
      if (id === FIRE_SOURCE_ID) {
        return {
          setData(data) { renderedZones = data; },
          updateData() {}
        };
      }
      return { setData() {} };
    }
  };

  applyFireFrameToSources(map, frame, frame.center, FIRE_RENDER_MODES.GRID);

  assert.ok(frame.cells.length > MAX_RENDERED_ZONE_CELLS);
  assert.ok(renderedZones.features.length > 0);
  assert.ok(renderedZones.features.every(feature => !feature.properties.id.endsWith("-surface")));
});

test("buildFireZonesDiff updates geometry for stable feature ids", () => {
  const { buildFireZonesDiff } = require("../../assets/web/js/app.js");
  const previous = [{
    type: "Feature",
    properties: { id: "active-surface", state: "active", intensity: 0.5 },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
  }];
  const next = [{
    type: "Feature",
    properties: { id: "active-surface", state: "active", intensity: 0.8 },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] }
  }];

  const diff = buildFireZonesDiff(previous, next);

  assert.equal(diff.add.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.update.length, 1);
  assert.equal(diff.update[0].id, "active-surface");
  assert.ok(diff.update[0].newGeometry);
  assert.ok(diff.update[0].addOrUpdateProperties.some(entry => entry.key === "intensity"));
});

test("Core fire frames received before map init are kept pending", () => {
  require("../../assets/web/js/app.js");
  const frame = {
    step: 1,
    center: [5.4, 43.3],
    incidentSeed: 77,
    zones: { type: "FeatureCollection", features: [] },
    emitters: [],
    stats: {},
    wind: {},
    status: "running"
  };

  global.FireLogistics.fireController = null;
  global.FireLogistics.receiveFireFrame(frame);

  assert.equal(global.FireLogistics.pendingFireFrame, frame);
});

test("Core frame revisions are deduplicated before render", () => {
  const {
    createFireRenderState,
    isNewerCoreFrame,
    markCoreFrameApplied
  } = require("../../assets/web/js/app.js");
  const renderState = createFireRenderState();
  const first = { incidentSeed: 10, revision: 1 };
  const duplicate = { incidentSeed: 10, revision: 1 };
  const next = { incidentSeed: 10, revision: 2 };
  const newIncident = { incidentSeed: 11, revision: 1 };

  assert.equal(isNewerCoreFrame(renderState, first), true);
  markCoreFrameApplied(renderState, first);
  assert.equal(isNewerCoreFrame(renderState, duplicate), false);
  assert.equal(isNewerCoreFrame(renderState, next), true);
  assert.equal(isNewerCoreFrame(renderState, newIncident), true);
});

test("Core mode buttons derive commands from authoritative frame status", () => {
  const { getCoreToggleCommand } = require("../../assets/web/js/app.js");

  assert.equal(getCoreToggleCommand({ status: "running" }), "pause");
  assert.equal(getCoreToggleCommand({ status: "paused" }), "resume");
  assert.equal(getCoreToggleCommand({ status: "extinguished" }), "pause");
  assert.equal(getCoreToggleCommand({ status: "idle" }), "pause");
});

test("idle fire frame exposes no ignition marker or zones", () => {
  const {
    applyFireFrameToSources,
    createEmptyFireFrame
  } = require("../../assets/web/js/app.js");
  const frame = createEmptyFireFrame(null);
  const calls = {};
  const map = {
    getSource(id) {
      return {
        setData(data) {
          calls[id] = data;
        }
      };
    }
  };

  applyFireFrameToSources(map, frame, null);

  assert.equal(frame.status, "idle");
  assert.deepEqual(calls["wildfire-zones"], { type: "FeatureCollection", features: [] });
  assert.deepEqual(calls["wildfire-ignition"], { type: "FeatureCollection", features: [] });
});

test("createIdleFireSimulationState starts without active cells", () => {
  const { createIdleFireSimulationState } = require("../../assets/web/js/fire-simulation.js");
  const state = createIdleFireSimulationState({ center: [5.38, 43.3] });

  assert.equal(state.cells.filter(cell => cell.state === "active").length, 0);
});

test("fallback fire simulation can grow past the former 65x49 grid", () => {
  const { buildFireSimulationFrame } = require("../../assets/web/js/app.js");

  const frame = buildFireSimulationFrame(30);

  assert.ok(frame.stats.activeCells > 0);
  assert.ok(frame.cells.some(cell => Math.abs(cell.x) > 32 || Math.abs(cell.y) > 24));
});

test("sparse fire cells can be created outside the former grid", () => {
  const { createSparseFireCell } = require("../../assets/web/js/fire-simulation.js");

  const cell = createSparseFireCell(100, -75);

  assert.equal(cell.x, 100);
  assert.equal(cell.y, -75);
  assert.equal(cell.xKm, 18);
  assert.equal(cell.yKm, -13.5);
  assert.ok(["water", "mineral", "crops", "grass", "scrub", "forest", "urban"].includes(cell.fuel));
});

test("incident seed changes require clearing fire effects", () => {
  const { shouldClearFireEffects } = require("../../assets/web/js/app.js");

  assert.equal(shouldClearFireEffects({ incidentSeed: 1 }, { incidentSeed: 1 }), false);
  assert.equal(shouldClearFireEffects({ incidentSeed: 1 }, { incidentSeed: 2 }), true);
});

test("rendered fuel samples include explicit sparse-grid origin", () => {
  const { createRenderedFuelSample } = require("../../assets/web/js/app.js");
  const map = {
    project(lngLat) {
      return { x: lngLat[0], y: lngLat[1] };
    },
    queryRenderedFeatures() {
      return [{ layer: { id: "fuel-water" } }];
    }
  };

  const sample = createRenderedFuelSample(map, [5.38, 43.3], {
    originX: -2,
    originY: -1,
    width: 3,
    height: 2,
    cellKm: 0.18
  });

  assert.equal(sample.originX, -2);
  assert.equal(sample.originY, -1);
  assert.equal(sample.width, 3);
  assert.equal(sample.height, 2);
  assert.deepEqual(sample.fuels, ["water", "water", "water", "water", "water", "water"]);
});

test("rendered fuel sampling probes one point per coarse block", () => {
  const { createRenderedFuelSample } = require("../../assets/web/js/app.js");
  let probeCount = 0;
  const map = {
    project(lngLat) {
      return { x: lngLat[0], y: lngLat[1] };
    },
    queryRenderedFeatures() {
      probeCount += 1;
      return [{ layer: { id: "fuel-forest" } }];
    }
  };

  const sample = createRenderedFuelSample(map, [5.38, 43.3], {
    originX: -4,
    originY: -3,
    width: 9,
    height: 6,
    cellKm: 0.18
  });

  assert.ok(sample);
  assert.equal(probeCount, 6);
  assert.equal(sample.fuels.length, 54);
  assert.ok(sample.fuels.every(fuel => fuel === "forest"));
});

test("wildfire render mode toggle switches between blob and grid geometry", () => {
  const {
    FIRE_RENDER_MODES,
    buildFireSimulationFrame,
    resolveFireZones
  } = require("../../assets/web/js/app.js");

  const blobFrame = buildFireSimulationFrame(40, { renderMode: FIRE_RENDER_MODES.BLOB });
  const gridFrame = buildFireSimulationFrame(40, { renderMode: FIRE_RENDER_MODES.GRID });
  const resolvedBlob = resolveFireZones(blobFrame, FIRE_RENDER_MODES.BLOB);
  const resolvedGrid = resolveFireZones(gridFrame, FIRE_RENDER_MODES.GRID);

  assert.ok(blobFrame.zones.features.length > 0);
  assert.ok(gridFrame.zones.features.length > 0);
  assert.ok(blobFrame.zones.features.every(feature => feature.geometry.coordinates[0].length > 12));
  assert.ok(gridFrame.zones.features.some(feature => feature.geometry.coordinates[0].length <= 6));
  assert.ok(resolvedBlob.features.every(feature => feature.geometry.coordinates[0].length > 12));
  assert.ok(resolvedGrid.features.some(feature => feature.geometry.coordinates[0].length <= 6));
});

test("resolveFireZones can rebuild blob zones from Core wire cells", () => {
  const { FIRE_RENDER_MODES, resolveFireZones } = require("../../assets/web/js/app.js");
  const frame = {
    center: [5.38, 43.3],
    incidentSeed: 42,
    zones: {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { id: "active-forest", state: "active", fuel: "forest", intensity: 0.8, cellCount: 2 },
        geometry: {
          type: "Polygon",
          coordinates: [[[5.38, 43.3], [5.39, 43.3], [5.39, 43.31], [5.38, 43.31], [5.38, 43.3]]]
        }
      }]
    },
    cells: [
      { x: 0, y: 0, fuel: "forest", state: "active", intensity: 0.8, heat: 1 },
      { x: 1, y: 0, fuel: "forest", state: "active", intensity: 0.7, heat: 0.9 }
    ]
  };

  const blobZones = resolveFireZones(frame, FIRE_RENDER_MODES.BLOB);
  const gridZones = resolveFireZones(frame, FIRE_RENDER_MODES.GRID);

  assert.ok(blobZones.features.length > 0);
  assert.ok(gridZones.features.length > 0);
  assert.ok(blobZones.features.every(feature => feature.geometry.coordinates[0].length > 12));
  assert.ok(gridZones.features.some(feature => feature.geometry.coordinates[0].length <= 6));
});

test("wildfire exposes nearby buildings without making water or mineral burn", () => {
  const { buildFireSimulationFrame } = require("../../assets/web/js/app.js");

  const frame = buildFireSimulationFrame(25);

  assert.ok(frame.stats.threatenedBuildings > 0);
  assert.ok(frame.stats.fuelImpacts.forest > 0);
  assert.ok(frame.stats.fuelImpacts.scrub > 0);
  assert.equal(frame.stats.fuelImpacts.water, 0);
  assert.equal(frame.stats.fuelImpacts.mineral, 0);
});

test("wildfire keeps a wind-driven front alive over a longer incident", () => {
  const { buildFireSimulationFrame } = require("../../assets/web/js/app.js");

  const frame = buildFireSimulationFrame(140);

  assert.ok(frame.stats.activeCells > 0);
  assert.ok(frame.stats.frontKilometers > 0);
  assert.ok(frame.zones.features.some(feature => feature.properties.state === "active"));
});

test("wildfire frames cap rendered cells without capping simulation stats", () => {
  const { buildFireSimulationFrame } = require("../../assets/web/js/app.js");

  const frame = buildFireSimulationFrame(140);
  const renderedCellCount = frame.cells.length;
  const renderedFeatureCellCount = frame.zones.features.reduce((sum, feature) => sum + feature.properties.cellCount, 0);

  assert.ok(frame.stats.activeCells > 0);
  assert.ok(frame.stats.burnedHectares > renderedCellCount);
  assert.ok(renderedCellCount <= 12000);
  assert.ok(renderedFeatureCellCount <= 12000);
  assert.ok(frame.zones.features.some(feature => feature.properties.state === "active"));
});

test("fallback fire cell map stays bounded during long incidents", () => {
  const {
    advanceFireSimulationState,
    createFireSimulationState
  } = require("../../assets/web/js/fire-simulation.js");
  const state = createFireSimulationState({ center: [5.38, 43.3] });

  advanceFireSimulationState(state, 220);

  assert.ok(state.cellMap.size <= 8000);
  assert.ok(state.cells.length <= 8000);
  assert.ok(state.cells.some(cell => cell.state === "active"));
});
test("fallback fire state compacts burned cells into burn scar over long incidents", () => {
  const {
    advanceFireSimulationState,
    buildFireSimulationFrameFromState,
    createFireSimulationState
  } = require("../../assets/web/js/fire-simulation.js");
  const state = createFireSimulationState({ center: [5.38, 43.3] });

  advanceFireSimulationState(state, 140);
  const frame = buildFireSimulationFrameFromState(state);

  assert.ok(state.burnScar.cells.size > 0);
  assert.equal(state.cells.some(cell => cell.state === "burned"), false);
  assert.ok(frame.burnScar.runs.length > 0);
  assert.ok(frame.stats.activeCells > 0);
  assert.ok(frame.stats.burnedHectares > state.cells.length);
});

test("wildfire accepts rendered fuel overrides from the map", () => {
  const { buildFireSimulationFrame } = require("../../assets/web/js/app.js");
  const waterOverrides = {
    originX: -3,
    originY: -3,
    width: 7,
    height: 7,
    fuels: Array.from({ length: 49 }, () => "water")
  };

  const frame = buildFireSimulationFrame(4, { fuelOverrides: waterOverrides });

  assert.equal(frame.stats.burnedHectares, 0);
  assert.equal(frame.stats.activeCells, 0);
  assert.equal(frame.zones.features.length, 0);
});

test("wildfire frame can start from a selected map coordinate", () => {
  const { buildFireSimulationFrame } = require("../../assets/web/js/app.js");

  const defaultFrame = buildFireSimulationFrame(0);
  const selectedFrame = buildFireSimulationFrame(0, { center: [6.12, 43.85] });

  assert.deepEqual(selectedFrame.center, [6.12, 43.85]);
  assert.notDeepEqual(
    selectedFrame.zones.features[0].geometry.coordinates[0][0],
    defaultFrame.zones.features[0].geometry.coordinates[0][0]
  );
});

test("controller switches to Core mode when an authoritative Core frame arrives", () => {
  const { createFireSimulation } = require("../../assets/web/js/app.js");
  const previousDocument = global.document;
  const previousRequestAnimationFrame = global.requestAnimationFrame;
  const previousIpc = global.ipc;
  const previousGodot = global.godot;
  const previousGodotBridge = global.GodotBridge;
  const previousPendingFrame = global.FireLogistics.pendingFireFrame;
  const previousConsoleInfo = console.info;
  const rafCallbacks = [];
  global.document = {
    getElementById() {
      return {
        textContent: "",
        addEventListener() {},
        classList: { toggle() {} }
      };
    }
  };
  global.requestAnimationFrame = callback => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };
  delete global.ipc;
  delete global.godot;
  delete global.GodotBridge;
  global.FireLogistics.pendingFireFrame = null;
  const sources = {
    "wildfire-zones": { setData() {}, updateData() {} },
    "wildfire-ignition": { setData() {} }
  };
  const map = {
    __fireRenderState: null,
    isStyleLoaded() { return true; },
    getSource(id) { return sources[id]; }
  };
  const frame = {
    step: 1,
    revision: 1,
    center: [5.4, 43.3],
    incidentSeed: 77,
    zones: { type: "FeatureCollection", features: [] },
    cells: [{ x: 40, y: 0, fuel: "forest", state: "active", intensity: 0.8, heat: 1 }],
    emitters: [],
    stats: { activeCells: 1, burnedHectares: 0, frontKilometers: 0, intensity: "Forte", threatenedBuildings: 0, fuelImpacts: {} },
    wind: { direction: "E-NE", degrees: 72, speedKmh: 28 },
    status: "running"
  };

  try {
    const controller = createFireSimulation(map);
    assert.equal(controller.usesCoreSimulation(), false);

    controller.receiveFrame(frame);
    assert.equal(controller.usesCoreSimulation(), true);
    rafCallbacks.find(callback => callback.name === "applyPendingCoreFrame")();

    assert.equal(controller.getFrame(), frame);
  } finally {
    global.document = previousDocument;
    global.requestAnimationFrame = previousRequestAnimationFrame;
    global.ipc = previousIpc;
    global.godot = previousGodot;
    global.GodotBridge = previousGodotBridge;
    global.FireLogistics.pendingFireFrame = previousPendingFrame;
  }
});

test("pending Core frames force Core mode during controller creation", () => {
  const { createFireSimulation } = require("../../assets/web/js/app.js");
  const previousDocument = global.document;
  const previousRequestAnimationFrame = global.requestAnimationFrame;
  const previousIpc = global.ipc;
  const previousPendingFrame = global.FireLogistics.pendingFireFrame;
  const rafCallbacks = [];
  global.document = {
    getElementById() {
      return {
        textContent: "",
        addEventListener() {},
        classList: { toggle() {} }
      };
    }
  };
  global.ipc = { postMessage() {} };
  global.requestAnimationFrame = callback => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };
  global.FireLogistics.pendingFireFrame = {
    step: 1,
    revision: 1,
    center: [5.4, 43.3],
    incidentSeed: 78,
    zones: { type: "FeatureCollection", features: [] },
    cells: [],
    emitters: [],
    stats: {},
    wind: {},
    status: "running"
  };
  const sources = {
    "wildfire-zones": { setData() {}, updateData() {} },
    "wildfire-ignition": { setData() {} }
  };
  const map = {
    __fireRenderState: null,
    isStyleLoaded() { return true; },
    getSource(id) { return sources[id]; }
  };

  try {
    const controller = createFireSimulation(map);

    assert.equal(controller.usesCoreSimulation(), true);
  } finally {
    global.FireLogistics.pendingFireFrame = previousPendingFrame;
    global.document = previousDocument;
    global.requestAnimationFrame = previousRequestAnimationFrame;
    global.ipc = previousIpc;
  }
});

test("pending Core mode falls back locally when ignition cannot be sent to Godot", () => {
  const { createFireSimulation } = require("../../assets/web/js/app.js");
  const previousDocument = global.document;
  const previousRequestAnimationFrame = global.requestAnimationFrame;
  const previousIpc = global.ipc;
  const previousGodot = global.godot;
  const previousGodotBridge = global.GodotBridge;
  const previousPendingFrame = global.FireLogistics.pendingFireFrame;
  const previousConsoleInfo = console.info;
  const rafCallbacks = [];
  global.document = {
    body: { classList: { toggle() {} } },
    getElementById() {
      return {
        textContent: "",
        addEventListener() {},
        classList: { toggle() {} }
      };
    }
  };
  global.requestAnimationFrame = callback => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };
  delete global.ipc;
  delete global.godot;
  delete global.GodotBridge;
  console.info = () => {};
  global.FireLogistics.pendingFireFrame = {
    step: 0,
    revision: 1,
    center: [5.4, 43.3],
    incidentSeed: 79,
    zones: { type: "FeatureCollection", features: [] },
    cells: [],
    emitters: [],
    stats: {},
    wind: {},
    status: "idle"
  };
  const sources = {
    "wildfire-zones": { setData() {}, updateData() {} },
    "wildfire-ignition": { setData() {} }
  };
  const map = {
    __fireRenderState: null,
    isStyleLoaded() { return true; },
    getSource(id) { return sources[id]; },
    once(event, callback) {
      if (event === "idle") callback();
    },
    queryRenderedFeatures() {
      return [];
    },
    project(lngLat) {
      return { x: lngLat[0], y: lngLat[1] };
    }
  };

  try {
    const controller = createFireSimulation(map);
    assert.equal(controller.usesCoreSimulation(), true);

    controller.setIgnitionCenter([5.4, 43.3]);

    assert.equal(controller.usesCoreSimulation(), false);
    assert.ok(controller.getFrame().stats.activeCells > 0);
  } finally {
    global.FireLogistics.pendingFireFrame = previousPendingFrame;
    global.document = previousDocument;
    global.requestAnimationFrame = previousRequestAnimationFrame;
    global.ipc = previousIpc;
    global.godot = previousGodot;
    global.GodotBridge = previousGodotBridge;
    console.info = previousConsoleInfo;
  }
});

test("fuel legend exposes all gameplay categories", () => {
  const { buildFuelLegendItems } = require("../../assets/web/js/app.js");

  assert.deepEqual(buildFuelLegendItems().map(item => item.label), [
    "Eau",
    "Mineral",
    "Cultures",
    "Herbe",
    "Broussailles",
    "Foret",
    "Urbain"
  ]);
});

test("fire legend exposes tactical fire categories", () => {
  const { buildFireLegendItems } = require("../../assets/web/js/app.js");

  assert.deepEqual(buildFireLegendItems().map(item => item.label), [
    "Front actif",
    "Braises",
    "Zone brulee",
    "Chaleur"
  ]);
});
