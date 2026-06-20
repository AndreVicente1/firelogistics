(function (global) {
  const FUEL_COLORS = {
    water: "#123145",
    mineral: "#8f9690",
    crops: "#b99b3a",
    grass: "#79a95b",
    scrub: "#8a7b38",
    forest: "#245c36",
    urban: "#343b3c"
  };

  const FUEL_LEGEND_ITEMS = [
    { id: "water", label: "Eau", color: FUEL_COLORS.water },
    { id: "mineral", label: "Mineral", color: FUEL_COLORS.mineral },
    { id: "crops", label: "Cultures", color: FUEL_COLORS.crops },
    { id: "grass", label: "Herbe", color: FUEL_COLORS.grass },
    { id: "scrub", label: "Broussailles", color: FUEL_COLORS.scrub },
    { id: "forest", label: "Foret", color: FUEL_COLORS.forest },
    { id: "urban", label: "Urbain", color: FUEL_COLORS.urban }
  ];

  const FIRE_SOURCE_ID = "wildfire-zones";
  const FIRE_CENTER = [5.38, 43.3];
  const FIRE_COLORS = {
    heat: "#ff9c2f",
    active: "#ff3d00",
    embers: "#d63b17",
    burned: "#15100d",
    perimeter: "#ffd6a3",
    smoke: "#b4b5ad"
  };

  const FIRE_LEGEND_ITEMS = [
    { id: "active", label: "Front actif", color: FIRE_COLORS.active },
    { id: "embers", label: "Braises", color: FIRE_COLORS.embers },
    { id: "burned", label: "Zone brulee", color: FIRE_COLORS.burned },
    { id: "heat", label: "Chaleur", color: FIRE_COLORS.heat }
  ];

  const FIRE_GRID = {
    width: 35,
    height: 27,
    cellKm: 0.22
  };

  const WIND_MODEL = {
    direction: "E-NE",
    degrees: 72,
    vector: [0.92, 0.39]
  };

  const FUEL_BEHAVIOR = {
    water: { burnable: false, ignition: 0, spread: 0, burnTicks: 0, flame: 0, resistance: 99 },
    mineral: { burnable: false, ignition: 0, spread: 0, burnTicks: 0, flame: 0, resistance: 99 },
    crops: { burnable: true, ignition: 0.44, spread: 0.46, burnTicks: 4, flame: 0.48, resistance: 0.16 },
    grass: { burnable: true, ignition: 0.64, spread: 0.67, burnTicks: 3, flame: 0.58, resistance: 0.06 },
    scrub: { burnable: true, ignition: 0.78, spread: 0.82, burnTicks: 5, flame: 0.78, resistance: 0.02 },
    forest: { burnable: true, ignition: 0.9, spread: 0.74, burnTicks: 8, flame: 0.95, resistance: 0.04 },
    urban: { burnable: true, ignition: 0.22, spread: 0.18, burnTicks: 7, flame: 0.66, resistance: 0.58 }
  };

  const TERRAIN_SOURCE_ID = "terrain-dem";
  const TERRAIN_EXAGGERATION = 1.35;
  const TERRAIN_TILEJSON_URL = "data/terrain-dem/tilejson.json";

  function sendToGodot(action, payload) {
    const message = JSON.stringify({ action, payload });
    if (global.godot?.ipc) {
      global.godot.ipc.postMessage(message);
      return;
    }

    if (global.GodotBridge?.postMessage) {
      global.GodotBridge.postMessage(message);
      return;
    }

    console.info("[FireLogistics bridge fallback]", message);
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value <= 0) return "--";
    const units = ["B", "KB", "MB", "GB"];
    let unit = 0;
    let amount = value;
    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024;
      unit++;
    }
    return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function buildFuelLayerDefinitions() {
    return [
      {
        id: "fuel-water",
        type: "fill",
        source: "france",
        "source-layer": "water",
        paint: {
          "fill-color": FUEL_COLORS.water,
          "fill-opacity": 0.72
        }
      },
      {
        id: "fuel-mineral",
        type: "fill",
        source: "france",
        "source-layer": "landcover",
        filter: ["in", ["get", "class"], ["literal", ["rock", "sand"]]],
        paint: {
          "fill-color": FUEL_COLORS.mineral,
          "fill-opacity": 0.46
        }
      },
      {
        id: "fuel-crops",
        type: "fill",
        source: "france",
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "farmland"],
        paint: {
          "fill-color": FUEL_COLORS.crops,
          "fill-opacity": 0.62
        }
      },
      {
        id: "fuel-grass",
        type: "fill",
        source: "france",
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "grass"],
        paint: {
          "fill-color": FUEL_COLORS.grass,
          "fill-opacity": 0.58
        }
      },
      {
        id: "fuel-scrub",
        type: "fill",
        source: "france",
        "source-layer": "landcover",
        filter: ["==", ["get", "subclass"], "scrub"],
        paint: {
          "fill-color": FUEL_COLORS.scrub,
          "fill-opacity": 0.64
        }
      },
      {
        id: "fuel-forest",
        type: "fill",
        source: "france",
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "wood"],
        paint: {
          "fill-color": FUEL_COLORS.forest,
          "fill-opacity": 0.72
        }
      },
      {
        id: "fuel-urban",
        type: "fill",
        source: "france",
        "source-layer": "landuse",
        filter: [
          "in",
          ["get", "class"],
          ["literal", ["residential", "industrial", "commercial", "retail"]]
        ],
        paint: {
          "fill-color": FUEL_COLORS.urban,
          "fill-opacity": 0.68
        }
      }
    ];
  }

  function buildFuelLegendItems() {
    return FUEL_LEGEND_ITEMS.map(item => ({ ...item }));
  }

  function buildFireLegendItems() {
    return FIRE_LEGEND_ITEMS.map(item => ({ ...item }));
  }

  function buildTerrainSourceDefinition() {
    return {
      type: "raster-dem",
      url: TERRAIN_TILEJSON_URL
    };
  }

  function buildTerrainLayerDefinition() {
    return {
      id: "terrain-hillshade",
      type: "hillshade",
      source: TERRAIN_SOURCE_ID,
      paint: {
        "hillshade-exaggeration": 0.45,
        "hillshade-shadow-color": "#08100d",
        "hillshade-highlight-color": "#d9d2aa",
        "hillshade-accent-color": "#5d634e"
      }
    };
  }

  function deterministicNoise(x, y, seed) {
    const value = Math.sin((x + 11.7) * 12.9898 + (y - 4.3) * 78.233 + seed * 37.719) * 43758.5453;
    return value - Math.floor(value);
  }

  function getCellLocalKm(x, y) {
    return {
      xKm: (x - (FIRE_GRID.width - 1) * 0.5) * FIRE_GRID.cellKm,
      yKm: (y - (FIRE_GRID.height - 1) * 0.5) * FIRE_GRID.cellKm
    };
  }

  function localKmToLngLat(xKm, yKm) {
    const lat = FIRE_CENTER[1];
    const lngPerKm = 1 / (111.32 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    const latPerKm = 1 / 110.57;
    return [
      FIRE_CENTER[0] + xKm * lngPerKm,
      FIRE_CENTER[1] + yKm * latPerKm
    ];
  }

  function sampleScenarioFuel(xKm, yKm) {
    const river = Math.abs(yKm + 1.05 + Math.sin((xKm + 0.6) * 1.2) * 0.16);
    if (river < 0.12 && xKm > -3.5 && xKm < 3.6) return "water";

    const ridgeTrack = Math.abs(yKm - (xKm * 0.32 - 0.45));
    if (ridgeTrack < 0.08 && xKm > -3.2 && xKm < 3.5) return "mineral";
    if (Math.abs(xKm + 2.75) < 0.08 && yKm < 1.8) return "mineral";

    const villageA = Math.hypot(xKm - 1.45, yKm - 0.42);
    const villageB = Math.hypot(xKm - 2.42, yKm - 0.42);
    const hamlet = Math.hypot(xKm + 1.45, yKm - 1.1);
    if (villageA < 0.43 || villageB < 0.36 || hamlet < 0.32) return "urban";

    const roughness = deterministicNoise(Math.round(xKm * 8), Math.round(yKm * 8), 3);
    if ((yKm > 0.26 && xKm < 2.75) || (xKm > 0.75 && yKm > 0.54)) {
      return roughness > 0.22 ? "forest" : "scrub";
    }
    if (yKm > -0.82 && xKm < 1.7) return roughness > 0.34 ? "scrub" : "grass";
    if (xKm < -1.4 && yKm < -0.25) return "crops";
    if (roughness > 0.72) return "scrub";
    return yKm < -1.25 ? "crops" : "grass";
  }

  function createInitialFireCells(fuelOverrides) {
    const cells = [];
    for (let y = 0; y < FIRE_GRID.height; y++) {
      for (let x = 0; x < FIRE_GRID.width; x++) {
        const local = getCellLocalKm(x, y);
        const override = Array.isArray(fuelOverrides) ? fuelOverrides[y * FIRE_GRID.width + x] : null;
        const fuel = override && FUEL_BEHAVIOR[override] ? override : sampleScenarioFuel(local.xKm, local.yKm);
        const distanceToIgnition = Math.hypot(local.xKm + 0.55, local.yKm + 0.08);
        const active = distanceToIgnition < 0.34 && FUEL_BEHAVIOR[fuel].burnable;
        cells.push({
          x,
          y,
          ...local,
          fuel,
          state: active ? "active" : "unburned",
          age: 0,
          heat: active ? 1 : 0,
          intensity: active ? FUEL_BEHAVIOR[fuel].flame : 0
        });
      }
    }
    return cells;
  }

  function getCell(cells, x, y) {
    if (x < 0 || y < 0 || x >= FIRE_GRID.width || y >= FIRE_GRID.height) return null;
    return cells[y * FIRE_GRID.width + x];
  }

  function cloneFireCells(cells) {
    return cells.map(cell => ({ ...cell }));
  }

  function computeSpreadScore(source, target, dx, dy, tick) {
    const targetFuel = FUEL_BEHAVIOR[target.fuel];
    if (!targetFuel.burnable) return -99;

    const distance = Math.hypot(dx, dy) || 1;
    const alignment = (dx * WIND_MODEL.vector[0] + dy * WIND_MODEL.vector[1]) / distance;
    const windBonus = Math.max(-0.18, alignment * 0.32);
    const slopeProxy = Math.max(-0.08, Math.min(0.12, (target.yKm - source.yKm) * 0.05));
    const noise = deterministicNoise(target.x, target.y, tick);
    const urbanPenalty = target.fuel === "urban" ? 0.32 : 0;

    return (
      targetFuel.ignition * 0.56 +
      source.intensity * 0.42 +
      windBonus +
      slopeProxy +
      noise * 0.2 -
      targetFuel.resistance -
      urbanPenalty
    );
  }

  function advanceFireCells(cells, tick) {
    const next = cloneFireCells(cells);

    for (const source of cells) {
      if (source.state !== "active") continue;
      const sourceNext = getCell(next, source.x, source.y);
      sourceNext.age += 1;
      sourceNext.heat = Math.max(0, source.heat - 0.05);
      sourceNext.intensity = Math.max(0.1, FUEL_BEHAVIOR[source.fuel].flame * (1 - source.age / (FUEL_BEHAVIOR[source.fuel].burnTicks + 2)));

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const target = getCell(cells, source.x + dx, source.y + dy);
          const targetNext = getCell(next, source.x + dx, source.y + dy);
          if (!target || !targetNext || target.state === "active" || target.state === "embers" || target.state === "burned") continue;

          const score = computeSpreadScore(source, target, dx, dy, tick);
          const threshold = target.fuel === "urban" ? 0.88 : 0.66;
          if (score > threshold) {
            targetNext.state = "active";
            targetNext.age = 0;
            targetNext.heat = Math.min(1, score);
            targetNext.intensity = FUEL_BEHAVIOR[target.fuel].flame;
          } else if (score > 0.35 && targetNext.state === "unburned") {
            targetNext.state = "heat";
            targetNext.heat = Math.max(targetNext.heat, Math.min(0.72, score));
          }
        }
      }

      if (sourceNext.age >= FUEL_BEHAVIOR[source.fuel].burnTicks) {
        sourceNext.state = "embers";
        sourceNext.age = 0;
        sourceNext.intensity = Math.max(0.24, FUEL_BEHAVIOR[source.fuel].flame * 0.45);
      }
    }

    for (const cell of next) {
      if (cell.state === "heat") {
        cell.age += 1;
        cell.heat *= 0.84;
        if (cell.heat < 0.22 || cell.age > 5) {
          cell.state = "unburned";
          cell.age = 0;
          cell.heat = 0;
        }
      } else if (cell.state === "embers") {
        cell.age += 1;
        cell.heat = Math.max(0.2, cell.heat * 0.88);
        if (cell.age >= 5) {
          cell.state = "burned";
          cell.intensity = 0;
        }
      }
    }

    return next;
  }

  function simulateFireCells(step, fuelOverrides) {
    const maxStep = Math.min(80, Math.max(0, Number(step) || 0));
    let cells = createInitialFireCells(fuelOverrides);
    for (let tick = 1; tick <= maxStep; tick++) {
      cells = advanceFireCells(cells, tick);
    }
    return cells;
  }

  function buildCellPolygon(cell) {
    const half = FIRE_GRID.cellKm * 0.5;
    return [
      localKmToLngLat(cell.xKm - half, cell.yKm - half),
      localKmToLngLat(cell.xKm + half, cell.yKm - half),
      localKmToLngLat(cell.xKm + half, cell.yKm + half),
      localKmToLngLat(cell.xKm - half, cell.yKm + half),
      localKmToLngLat(cell.xKm - half, cell.yKm - half)
    ];
  }

  function buildFireFeature(cell, state) {
    return {
      type: "Feature",
      properties: {
        id: `${state}-${cell.x}-${cell.y}`,
        state,
        fuel: cell.fuel,
        intensity: Number(Math.max(cell.intensity, cell.heat).toFixed(3))
      },
      geometry: {
        type: "Polygon",
        coordinates: [buildCellPolygon(cell)]
      }
    };
  }

  function buildFireFeatureCollection(cells) {
    const features = [];
    for (const cell of cells) {
      if (cell.state === "active" || cell.state === "embers" || cell.state === "burned") {
        features.push(buildFireFeature(cell, cell.state));
      } else if (cell.state === "heat") {
        features.push(buildFireFeature(cell, "heat"));
      }
    }
    return { type: "FeatureCollection", features };
  }

  function buildFireEmitters(cells) {
    return cells
      .filter(cell => cell.state === "active")
      .sort((a, b) => (b.xKm + b.yKm * 0.35) - (a.xKm + a.yKm * 0.35))
      .slice(0, 24)
      .map((cell, index) => ({
        id: `cell-${cell.x}-${cell.y}`,
        lngLat: localKmToLngLat(cell.xKm, cell.yKm),
        intensity: Math.max(0.32, cell.intensity),
        type: index % 4 === 0 ? "ember" : "flame"
      }));
  }

  function summarizeFireStats(cells) {
    const affected = cells.filter(cell => cell.state === "active" || cell.state === "embers" || cell.state === "burned");
    const active = cells.filter(cell => cell.state === "active");
    const cellHectares = FIRE_GRID.cellKm * FIRE_GRID.cellKm * 100;
    const fuelImpacts = Object.fromEntries(Object.keys(FUEL_BEHAVIOR).map(fuel => [fuel, 0]));

    for (const cell of affected) {
      fuelImpacts[cell.fuel] += 1;
    }

    const avgIntensity = active.length
      ? active.reduce((sum, cell) => sum + cell.intensity, 0) / active.length
      : 0;

    return {
      burnedHectares: Math.round(affected.length * cellHectares),
      frontKilometers: Number((active.length * FIRE_GRID.cellKm * 0.32).toFixed(1)),
      intensity: avgIntensity > 0.78 ? "Extreme" : avgIntensity > 0.54 ? "Forte" : "Moderee",
      activeCells: active.length,
      threatenedBuildings: countThreatenedBuildings(cells),
      fuelImpacts
    };
  }

  function countThreatenedBuildings(cells) {
    return cells.filter(cell => {
      if (cell.fuel !== "urban") return false;
      if (cell.state !== "unburned") return true;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const neighbor = getCell(cells, cell.x + dx, cell.y + dy);
          if (neighbor && (neighbor.state === "active" || neighbor.state === "embers" || neighbor.state === "burned" || neighbor.state === "heat")) {
            return true;
          }
        }
      }
      return false;
    }).length;
  }

  function buildFireSimulationFrame(step, options = {}) {
    const tick = Math.max(0, Number(step) || 0);
    const cells = simulateFireCells(tick, options.fuelOverrides);
    const windSpeed = Math.round(28 + Math.sin(tick * 0.18) * 5);

    return {
      step: tick,
      cells,
      zones: buildFireFeatureCollection(cells),
      emitters: buildFireEmitters(cells),
      stats: summarizeFireStats(cells),
      wind: {
        direction: WIND_MODEL.direction,
        degrees: WIND_MODEL.degrees,
        speedKmh: windSpeed
      }
    };
  }

  function classifyRenderedFuel(features) {
    const layerIds = new Set(features.map(feature => feature.layer?.id).filter(Boolean));
    if (layerIds.has("buildings")) return "urban";
    if (layerIds.has("fuel-water")) return "water";
    if (layerIds.has("fuel-mineral")) return "mineral";
    if (layerIds.has("fuel-forest")) return "forest";
    if (layerIds.has("fuel-scrub")) return "scrub";
    if (layerIds.has("fuel-grass")) return "grass";
    if (layerIds.has("fuel-crops")) return "crops";
    if (layerIds.has("fuel-urban")) return "urban";
    return null;
  }

  function createRenderedFuelOverrides(map) {
    if (!map?.queryRenderedFeatures || !map?.project) return null;
    const queryLayers = [
      "buildings",
      "fuel-water",
      "fuel-mineral",
      "fuel-forest",
      "fuel-scrub",
      "fuel-grass",
      "fuel-crops",
      "fuel-urban"
    ];
    const overrides = [];
    let resolved = 0;

    try {
      for (let y = 0; y < FIRE_GRID.height; y++) {
        for (let x = 0; x < FIRE_GRID.width; x++) {
          const local = getCellLocalKm(x, y);
          const lngLat = localKmToLngLat(local.xKm, local.yKm);
          const point = map.project(lngLat);
          const features = map.queryRenderedFeatures(point, { layers: queryLayers });
          const fuel = classifyRenderedFuel(features);
          overrides.push(fuel);
          if (fuel) resolved += 1;
        }
      }
    } catch (error) {
      console.warn("[FireLogistics] Lecture des combustibles MapLibre indisponible", error);
      return null;
    }

    return resolved > FIRE_GRID.width * FIRE_GRID.height * 0.08 ? overrides : null;
  }

  function buildFireLayerDefinitions() {
    return [
      {
        id: "fire-heat",
        type: "fill",
        source: FIRE_SOURCE_ID,
        filter: ["==", ["get", "state"], "heat"],
        paint: {
          "fill-color": FIRE_COLORS.heat,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.08, 10, 0.18, 14, 0.25]
        }
      },
      {
        id: "fire-burn-scar",
        type: "fill",
        source: FIRE_SOURCE_ID,
        filter: ["==", ["get", "state"], "burned"],
        paint: {
          "fill-color": FIRE_COLORS.burned,
          "fill-opacity": 0.82
        }
      },
      {
        id: "fire-ember-bed",
        type: "fill",
        source: FIRE_SOURCE_ID,
        filter: ["==", ["get", "state"], "embers"],
        paint: {
          "fill-color": FIRE_COLORS.embers,
          "fill-opacity": 0.46
        }
      },
      {
        id: "fire-active-core",
        type: "fill",
        source: FIRE_SOURCE_ID,
        filter: ["==", ["get", "state"], "active"],
        paint: {
          "fill-color": FIRE_COLORS.active,
          "fill-opacity": 0.72
        }
      },
      {
        id: "fire-active-glow",
        type: "line",
        source: FIRE_SOURCE_ID,
        filter: ["==", ["get", "state"], "active"],
        paint: {
          "line-color": "#ffb21f",
          "line-opacity": 0.95,
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2, 11, 7, 15, 18],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 6, 2, 11, 5, 15, 10]
        }
      },
      {
        id: "fire-perimeter",
        type: "line",
        source: FIRE_SOURCE_ID,
        filter: ["in", ["get", "state"], ["literal", ["burned", "embers", "active"]]],
        paint: {
          "line-color": FIRE_COLORS.perimeter,
          "line-opacity": 0.68,
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.8, 11, 2.2, 15, 5]
        }
      }
    ];
  }

  function renderLegend(rootId, className, items) {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.innerHTML = items.map(item => `
      <div class="${className}-item">
        <span class="${className}-swatch" style="background:${item.color}"></span>
        <span>${item.label}</span>
      </div>
    `).join("");
  }

  function renderFuelLegend() {
    renderLegend("fuel-legend", "fuel-legend", buildFuelLegendItems());
  }

  function renderFireLegend() {
    renderLegend("fire-legend", "fire-legend", buildFireLegendItems());
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function updateFireHud(frame, running) {
    if (!frame) return;
    setText("simulation-value", running ? "Feu actif" : "Pause");
    setText("wind-value", `Vent ${frame.wind.direction} ${frame.wind.speedKmh} km/h`);
    setText("burned-area-value", `${frame.stats.burnedHectares} ha`);
    setText("front-length-value", `${frame.stats.frontKilometers} km`);
    setText("intensity-value", frame.stats.intensity);
    setText("building-risk-value", `${frame.stats.threatenedBuildings} cellules`);
    const toggle = document.getElementById("fire-toggle-button");
    if (toggle) toggle.textContent = running ? "Pause feu" : "Reprendre";
  }

  function buildFranceWorldStyle() {
    const baseLayers = [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#0f1413" }
      },
      {
        id: "world-backdrop-water",
        type: "fill",
        source: "world-backdrop",
        filter: ["==", ["get", "kind"], "water"],
        paint: {
          "fill-color": "#101c24",
          "fill-opacity": 0.95
        }
      },
      {
        id: "world-backdrop-land",
        type: "fill",
        source: "world-backdrop",
        filter: ["==", ["get", "kind"], "land"],
        paint: {
          "fill-color": "#151b18",
          "fill-opacity": 0.92
        }
      },
      {
        id: "landcover",
        type: "fill",
        source: "france",
        "source-layer": "landcover",
        paint: {
          "fill-color": "#151b18",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 2, 0.08, 4, 0.16, 6, 0.22, 8, 0.28]
        }
      },
      {
        id: "landuse",
        type: "fill",
        source: "france",
        "source-layer": "landuse",
        paint: {
          "fill-color": "#1a211d",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.08, 6, 0.16, 8, 0.24]
        }
      },
      {
        id: "parks",
        type: "fill",
        source: "france",
        "source-layer": "park",
        paint: { "fill-color": "#1c2a20", "fill-opacity": 0.28 }
      }
    ];
    const overlayLayers = [
      {
        id: "water",
        type: "fill",
        source: "france",
        "source-layer": "water",
        paint: { "fill-color": "#101c24", "fill-opacity": 0.42 }
      },
      {
        id: "waterways",
        type: "line",
        source: "france",
        "source-layer": "waterway",
        paint: {
          "line-color": "#173245",
          "line-opacity": 0.9,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 13, 1.6, 16, 4]
        }
      },
      {
        id: "transportation",
        type: "line",
        source: "france",
        "source-layer": "transportation",
        paint: {
          "line-color": "#c5cac4",
          "line-opacity": 0.82,
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.45, 10, 1.2, 13, 2.8, 16, 8]
        }
      },
      {
        id: "buildings",
        type: "fill",
        source: "france",
        "source-layer": "building",
        minzoom: 13,
        paint: { "fill-color": "#202728", "fill-opacity": 0.9 }
      }
    ];

    return {
      version: 8,
      name: "Fire Logistics France",
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        "world-backdrop": {
          type: "geojson",
          data: "data/world-backdrop.geojson"
        },
        france: {
          type: "vector",
          url: "pmtiles://data/france-openmaptiles.pmtiles"
        },
        [TERRAIN_SOURCE_ID]: buildTerrainSourceDefinition(),
        [FIRE_SOURCE_ID]: {
          type: "geojson",
          data: buildFireSimulationFrame(0).zones
        }
      },
      terrain: {
        source: TERRAIN_SOURCE_ID,
        exaggeration: TERRAIN_EXAGGERATION
      },
      sky: {
        "atmosphere-blend": 0.12
      },
      layers: [
        ...baseLayers,
        ...buildFuelLayerDefinitions(),
        buildTerrainLayerDefinition(),
        ...buildFireLayerDefinitions(),
        ...overlayLayers
      ]
    };
  }

  function applyTerrainRuntime(map) {
    if (typeof map.setTerrain === "function") {
      map.setTerrain({
        source: TERRAIN_SOURCE_ID,
        exaggeration: TERRAIN_EXAGGERATION
      });
    }

    if (global.maplibregl?.TerrainControl) {
      map.addControl(new global.maplibregl.TerrainControl({
        source: TERRAIN_SOURCE_ID,
        exaggeration: TERRAIN_EXAGGERATION
      }), "bottom-right");
    }
  }

  function createParticle(type, point, intensity) {
    const smoke = type === "smoke";
    const ember = type === "ember";
    return {
      type,
      x: point.x + (Math.random() - 0.5) * 12,
      y: point.y + (Math.random() - 0.5) * 8,
      vx: (smoke ? -0.12 : 0.2) + (Math.random() - 0.5) * 0.48,
      vy: smoke ? -0.72 - Math.random() * 0.9 : -0.45 - Math.random() * 0.8,
      age: 0,
      life: smoke ? 1300 + Math.random() * 1600 : 550 + Math.random() * 900,
      size: smoke ? 20 + Math.random() * 32 : ember ? 1.4 + Math.random() * 2.6 : 7 + Math.random() * 13,
      intensity
    };
  }

  function createFireParticleOverlay(map, getFrame, isRunning) {
    const canvas = document.getElementById("fire-effects");
    if (!canvas || !canvas.getContext || !global.requestAnimationFrame) return null;
    const context = canvas.getContext("2d");
    const particles = [];
    let width = 0;
    let height = 0;
    let lastTime = performance.now();

    function resize() {
      const ratio = global.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function spawn(frame) {
      if (!frame || !isRunning() || particles.length > 440) return;
      for (const emitter of frame.emitters) {
        if (Math.random() > 0.54) continue;
        const point = map.project(emitter.lngLat);
        if (point.x < -80 || point.y < -80 || point.x > width + 80 || point.y > height + 80) continue;
        particles.push(createParticle("smoke", point, emitter.intensity));
        if (Math.random() > 0.22) particles.push(createParticle(emitter.type, point, emitter.intensity));
      }
    }

    function drawParticle(particle, delta) {
      particle.age += delta;
      particle.x += particle.vx * delta * 0.06;
      particle.y += particle.vy * delta * 0.06;
      particle.vx += Math.sin((particle.age + particle.x) * 0.004) * 0.008;
      const progress = Math.min(1, particle.age / particle.life);

      if (particle.type === "smoke") {
        const radius = particle.size * (0.7 + progress * 1.8);
        const alpha = (1 - progress) * 0.28 * particle.intensity;
        const gradient = context.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, radius);
        gradient.addColorStop(0, `rgba(205, 202, 190, ${alpha})`);
        gradient.addColorStop(0.52, `rgba(92, 91, 86, ${alpha * 0.72})`);
        gradient.addColorStop(1, "rgba(20, 20, 20, 0)");
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        context.fill();
        return;
      }

      context.globalCompositeOperation = "lighter";
      const radius = particle.size * (1 - progress * 0.35);
      const alpha = (1 - progress) * particle.intensity;
      const gradient = context.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, radius * 2.4);
      gradient.addColorStop(0, `rgba(255, 246, 174, ${alpha})`);
      gradient.addColorStop(0.35, `rgba(255, 93, 20, ${alpha * 0.78})`);
      gradient.addColorStop(1, "rgba(80, 8, 0, 0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(particle.x, particle.y, radius * 2.4, 0, Math.PI * 2);
      context.fill();
      context.globalCompositeOperation = "source-over";
    }

    function loop(now) {
      const delta = Math.min(48, now - lastTime);
      lastTime = now;
      context.clearRect(0, 0, width, height);
      spawn(getFrame());

      for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        drawParticle(particle, delta);
        if (particle.age >= particle.life) particles.splice(i, 1);
      }

      global.requestAnimationFrame(loop);
    }

    resize();
    global.addEventListener("resize", resize);
    map.on("resize", resize);
    global.requestAnimationFrame(loop);

    return {
      resize,
      getParticleCount() {
        return particles.length;
      }
    };
  }

  function createFireSimulation(map) {
    let step = 0;
    let running = true;
    let fuelOverrides = null;
    let frame = buildFireSimulationFrame(step, { fuelOverrides });
    let lastTick = performance.now();
    const source = map.getSource(FIRE_SOURCE_ID);

    function publish() {
      const fireSource = map.getSource(FIRE_SOURCE_ID) || source;
      if (fireSource?.setData) fireSource.setData(frame.zones);
      updateFireHud(frame, running);
    }

    function animate(now) {
      if (running && now - lastTick > 720) {
        lastTick = now;
        step += 1;
        frame = buildFireSimulationFrame(step, { fuelOverrides });
        publish();
      }
      global.requestAnimationFrame(animate);
    }

    function refreshRenderedFuelModel() {
      const renderedOverrides = createRenderedFuelOverrides(map);
      if (!renderedOverrides) return;
      fuelOverrides = renderedOverrides;
      frame = buildFireSimulationFrame(step, { fuelOverrides });
      publish();
    }

    publish();
    createFireParticleOverlay(map, () => frame, () => running);
    map.once("idle", refreshRenderedFuelModel);
    global.requestAnimationFrame(animate);

    return {
      getFrame() {
        return frame;
      },
      toggle() {
        running = !running;
        updateFireHud(frame, running);
        return running;
      },
      reset() {
        step = 0;
        running = true;
        frame = buildFireSimulationFrame(step, { fuelOverrides });
        lastTick = performance.now();
        publish();
      }
    };
  }

  function initMap() {
    if (!global.maplibregl) {
      document.getElementById("map").textContent = "MapLibre indisponible";
      return null;
    }

    if (global.pmtiles) {
      const protocol = new global.pmtiles.Protocol();
      global.maplibregl.addProtocol("pmtiles", protocol.tile);
    }

    const map = new global.maplibregl.Map({
      container: "map",
      center: [5.39, 43.31],
      zoom: 10.8,
      pitch: 66,
      bearing: -32,
      minZoom: 1.5,
      maxZoom: 18,
      maxPitch: 85,
      style: buildFranceWorldStyle(),
      renderWorldCopies: false,
      attributionControl: false
    });

    map.addControl(new global.maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), "bottom-right");
    map.on("load", () => {
      applyTerrainRuntime(map);
      map.addSource("bootstrap-incident", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { name: "Incident test" },
              geometry: { type: "Point", coordinates: FIRE_CENTER }
            }
          ]
        }
      });
      map.addLayer({
        id: "bootstrap-incident",
        type: "circle",
        source: "bootstrap-incident",
        paint: {
          "circle-radius": 8,
          "circle-color": "#ff5a1f",
          "circle-stroke-color": "#fff2df",
          "circle-stroke-width": 2
        }
      });
      api.fireController = createFireSimulation(map);
    });
    map.on("error", (event) => {
      const message = event?.error?.message ?? "";
      if (message.includes("france-openmaptiles.pmtiles")) {
        console.error("Carte France absente: assets/web/data/france-openmaptiles.pmtiles");
      } else if (message.includes("world-backdrop.geojson")) {
        console.error("Fond monde absent: assets/web/data/world-backdrop.geojson");
      } else if (message.includes("terrain-dem")) {
        console.error("Relief DEM indisponible: " + TERRAIN_TILEJSON_URL);
      } else if (message) {
        console.error("[MapLibre]", message);
      }
    });

    return map;
  }

  const api = {
    map: null,
    fireController: null,
    sendToGodot,
    updateRuntimeMetrics(metrics) {
      document.getElementById("fps-value").textContent = String(metrics?.fps ?? "--");
      document.getElementById("ram-value").textContent = formatBytes(metrics?.ramBytes);
    }
  };

  global.FireLogistics = api;

  if (typeof global.addEventListener === "function" && global.document) {
    global.addEventListener("DOMContentLoaded", () => {
      renderFuelLegend();
      renderFireLegend();
      updateFireHud(buildFireSimulationFrame(0), true);
      api.map = initMap();
      document.getElementById("fire-toggle-button").addEventListener("click", () => {
        api.fireController?.toggle();
      });
      document.getElementById("fire-reset-button").addEventListener("click", () => {
        api.fireController?.reset();
      });
      document.getElementById("diagnostics-button").addEventListener("click", () => {
        sendToGodot("diagnostics_log", "Diagnostic WebView Fire Logistics OK");
      });
      document.getElementById("quit-button").addEventListener("click", () => {
        sendToGodot("quit_game", null);
      });
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      FIRE_COLORS,
      FIRE_GRID,
      FIRE_SOURCE_ID,
      FUEL_COLORS,
      TERRAIN_EXAGGERATION,
      TERRAIN_SOURCE_ID,
      buildFireLayerDefinitions,
      buildFireLegendItems,
      buildFireSimulationFrame,
      buildFranceWorldStyle,
      buildFuelLayerDefinitions,
      buildFuelLegendItems,
      buildTerrainLayerDefinition,
      buildTerrainSourceDefinition,
      formatBytes
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
