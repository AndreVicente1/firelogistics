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
    FIRE_SOURCE_ID,
    buildFireLayerDefinitions
  } = require("../../assets/web/js/app.js");

  const fireLayers = buildFireLayerDefinitions();
  const fillAndLineLayers = fireLayers.filter(layer => layer.type === "fill" || layer.type === "line");

  assert.ok(fillAndLineLayers.length > 0);
  assert.ok(fillAndLineLayers.every(layer => layer.source === FIRE_SOURCE_ID));
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
    createFireRenderState
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
  assert.equal(renderState.lastZonesHash, JSON.stringify(later.zones));
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

  assert.equal(gridZones, frame.zones);
  assert.ok(blobZones.features.length > 0);
  assert.ok(blobZones.features.every(feature => feature.geometry.coordinates[0].length > 12));
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

test("wildfire accepts rendered fuel overrides from the map", () => {
  const { FIRE_GRID, buildFireSimulationFrame } = require("../../assets/web/js/app.js");
  const waterOverrides = Array.from({ length: FIRE_GRID.width * FIRE_GRID.height }, () => "water");

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
