const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");

test("runtime web assets required by the WebView are present", () => {
  const required = [
    "assets/web/index.html",
    "assets/web/css/game.css",
    "assets/web/js/app.js",
    "assets/web/js/fire-model.js",
    "assets/web/js/fire-simulation.js",
    "assets/web/vendor/maplibre-gl@4.7.1/maplibre-gl.js",
    "assets/web/vendor/maplibre-gl@4.7.1/maplibre-gl.css",
    "assets/web/vendor/pmtiles@4.4.1/pmtiles.js"
  ];

  for (const file of required) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} should exist`);
  }
});

test("map runtime sources stay local except documented glyphs", () => {
  const { buildFranceWorldStyle } = require("../../assets/web/js/app.js");
  const style = buildFranceWorldStyle();

  const remoteSourceUrls = Object.values(style.sources)
    .flatMap(source => [source.url, source.data, source.tiles].flat().filter(Boolean))
    .filter(value => /^https?:\/\//i.test(String(value)));

  assert.deepEqual(remoteSourceUrls, []);
  assert.match(style.glyphs, /^https:\/\/demotiles\.maplibre\.org\//);
});

test("prototype fire simulation remains documented until moved to Core", () => {
  const contracts = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");

  assert.match(contracts, /JavaScript fire simulation as a prototype/);
  assert.match(contracts, /FireLogistics\.Core/);
});

test("Core fire runtime IPC messages are documented", () => {
  const contracts = fs.readFileSync(path.join(root, "docs", "contracts.md"), "utf8");

  assert.match(contracts, /fire_command/);
  assert.match(contracts, /fire_fuel_overrides_ready/);
  assert.match(contracts, /originX/);
  assert.match(contracts, /originY/);
  assert.match(contracts, /receiveFireFrame/);
  assert.match(contracts, /requestFuelSample/);
  assert.match(contracts, /incidentSeed/);
  assert.match(contracts, /revision/);
  assert.match(contracts, /reason/);
  assert.match(contracts, /paused/);
  assert.match(contracts, /MultiPolygon/);
  assert.match(contracts, /updateData/);
  assert.match(contracts, /promoteId/);
  assert.match(contracts, /heat-surface/);
});
