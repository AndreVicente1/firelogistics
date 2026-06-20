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
  assert.ok(style.sources[FIRE_SOURCE_ID].data.features.length > 0);
  assert.ok(style.sources[FIRE_SOURCE_ID].data.features.every(feature => feature.properties.fuel));
  assert.deepEqual(fireLayers.map(layer => layer.id), [
    "fire-heat",
    "fire-burn-scar",
    "fire-ember-bed",
    "fire-active-core",
    "fire-active-glow",
    "fire-perimeter"
  ]);
  assert.equal(fireLayers.find(layer => layer.id === "fire-active-core").paint["fill-color"], FIRE_COLORS.active);
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
  assert.equal(initial.emitters.length, initial.stats.activeCells);
  assert.ok(later.stats.burnedHectares > initial.stats.burnedHectares);
  assert.ok(later.stats.frontKilometers > initial.stats.frontKilometers);
  assert.ok(later.stats.fuelImpacts.forest > 0);
  assert.ok(later.stats.fuelImpacts.scrub > 0);
  assert.equal(later.stats.fuelImpacts.water, 0);
  assert.equal(later.stats.fuelImpacts.mineral, 0);
  assert.equal(later.wind.direction, "E-NE");
});

test("wildfire exposes nearby buildings without making water or mineral burn", () => {
  const { buildFireSimulationFrame } = require("../../assets/web/js/app.js");

  const frame = buildFireSimulationFrame(25);
  const affectedFuelTypes = new Set(frame.zones.features.map(feature => feature.properties.fuel));

  assert.ok(frame.stats.threatenedBuildings > 0);
  assert.ok(affectedFuelTypes.has("forest"));
  assert.ok(affectedFuelTypes.has("scrub"));
  assert.ok(!affectedFuelTypes.has("water"));
  assert.ok(!affectedFuelTypes.has("mineral"));
});

test("wildfire accepts rendered fuel overrides from the map", () => {
  const { FIRE_GRID, buildFireSimulationFrame } = require("../../assets/web/js/app.js");
  const waterOverrides = Array.from({ length: FIRE_GRID.width * FIRE_GRID.height }, () => "water");

  const frame = buildFireSimulationFrame(4, { fuelOverrides: waterOverrides });

  assert.equal(frame.stats.burnedHectares, 0);
  assert.equal(frame.stats.activeCells, 0);
  assert.equal(frame.zones.features.length, 0);
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
