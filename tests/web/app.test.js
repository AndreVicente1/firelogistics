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
