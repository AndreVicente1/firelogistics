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
