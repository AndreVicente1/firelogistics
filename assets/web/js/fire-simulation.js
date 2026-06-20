(function (global) {
  const DEFAULT_FIRE_CENTER = [5.38, 43.3];
  const FIRE_SOURCE_ID = "wildfire-zones";
  const IGNITION_SOURCE_ID = "wildfire-ignition";

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
    water: { burnable: false, ignition: 0, burnTicks: 0, flame: 0, resistance: 99 },
    mineral: { burnable: false, ignition: 0, burnTicks: 0, flame: 0, resistance: 99 },
    crops: { burnable: true, ignition: 0.44, burnTicks: 4, flame: 0.48, resistance: 0.16 },
    grass: { burnable: true, ignition: 0.64, burnTicks: 3, flame: 0.58, resistance: 0.06 },
    scrub: { burnable: true, ignition: 0.78, burnTicks: 5, flame: 0.78, resistance: 0.02 },
    forest: { burnable: true, ignition: 0.9, burnTicks: 8, flame: 0.95, resistance: 0.04 },
    urban: { burnable: true, ignition: 0.22, burnTicks: 7, flame: 0.66, resistance: 0.58 }
  };

  function normalizeCenter(center) {
    if (!Array.isArray(center) || center.length < 2) return DEFAULT_FIRE_CENTER;
    const lng = Number(center[0]);
    const lat = Number(center[1]);
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : DEFAULT_FIRE_CENTER;
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

  function localKmToLngLat(center, xKm, yKm) {
    const origin = normalizeCenter(center);
    const lat = origin[1];
    const lngPerKm = 1 / (111.32 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    const latPerKm = 1 / 110.57;
    return [
      origin[0] + xKm * lngPerKm,
      origin[1] + yKm * latPerKm
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
        const distanceToIgnition = Math.hypot(local.xKm, local.yKm);
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

  function dominantFuel(cells) {
    const counts = {};
    for (const cell of cells) counts[cell.fuel] = (counts[cell.fuel] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
  }

  function buildSmoothBlobFeature(cells, state, center, radiusPaddingKm) {
    if (!cells.length) return null;
    const centroid = cells.reduce((acc, cell) => {
      acc.xKm += cell.xKm;
      acc.yKm += cell.yKm;
      return acc;
    }, { xKm: 0, yKm: 0 });
    centroid.xKm /= cells.length;
    centroid.yKm /= cells.length;

    const pointCount = 96;
    const radii = [];
    for (let i = 0; i < pointCount; i++) {
      const angle = (i / pointCount) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let radius = FIRE_GRID.cellKm * (1.05 + radiusPaddingKm);

      for (const cell of cells) {
        const dx = cell.xKm - centroid.xKm;
        const dy = cell.yKm - centroid.yKm;
        const projection = dx * cos + dy * sin;
        const perpendicular = Math.abs(-dx * sin + dy * cos);
        if (projection > -FIRE_GRID.cellKm) {
          const influence = projection + Math.max(0, FIRE_GRID.cellKm * 0.9 - perpendicular * 0.35);
          radius = Math.max(radius, influence + radiusPaddingKm);
        }
      }

      const wobble = (deterministicNoise(i, cells.length, state.length) - 0.5) * FIRE_GRID.cellKm * 0.2;
      radii.push(Math.max(FIRE_GRID.cellKm * 0.65, radius + wobble));
    }

    for (let pass = 0; pass < 3; pass++) {
      const smoothed = radii.slice();
      for (let i = 0; i < pointCount; i++) {
        const prev = radii[(i - 1 + pointCount) % pointCount];
        const next = radii[(i + 1) % pointCount];
        smoothed[i] = radii[i] * 0.5 + (prev + next) * 0.25;
      }
      for (let i = 0; i < pointCount; i++) radii[i] = smoothed[i];
    }

    const ring = radii.map((radius, i) => {
      const angle = (i / pointCount) * Math.PI * 2;
      return localKmToLngLat(center, centroid.xKm + Math.cos(angle) * radius, centroid.yKm + Math.sin(angle) * radius);
    });
    ring.push(ring[0]);

    const maxIntensity = cells.reduce((value, cell) => Math.max(value, cell.intensity, cell.heat), 0);
    return {
      type: "Feature",
      properties: {
        id: `${state}-surface`,
        state,
        fuel: dominantFuel(cells),
        intensity: Number(maxIntensity.toFixed(3)),
        cellCount: cells.length
      },
      geometry: {
        type: "Polygon",
        coordinates: [ring]
      }
    };
  }

  function buildFireFeatureCollection(cells, center) {
    const features = [];
    const groups = {
      heat: cells.filter(cell => cell.state === "heat"),
      burned: cells.filter(cell => cell.state === "burned"),
      embers: cells.filter(cell => cell.state === "embers"),
      active: cells.filter(cell => cell.state === "active")
    };

    for (const [state, group] of Object.entries(groups)) {
      const padding = state === "heat" ? 0.36 : state === "active" ? 0.2 : 0.16;
      const feature = buildSmoothBlobFeature(group, state, center, padding);
      if (feature) features.push(feature);
    }

    return { type: "FeatureCollection", features };
  }

  function buildFireEmitters(cells, center) {
    return cells
      .filter(cell => cell.state === "active")
      .sort((a, b) => (b.xKm + b.yKm * 0.35) - (a.xKm + a.yKm * 0.35))
      .slice(0, 24)
      .map((cell, index) => ({
        id: `cell-${cell.x}-${cell.y}`,
        lngLat: localKmToLngLat(center, cell.xKm, cell.yKm),
        intensity: Math.max(0.32, cell.intensity),
        type: index % 4 === 0 ? "ember" : "flame"
      }));
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

  function summarizeFireStats(cells) {
    const affected = cells.filter(cell => cell.state === "active" || cell.state === "embers" || cell.state === "burned");
    const active = cells.filter(cell => cell.state === "active");
    const cellHectares = FIRE_GRID.cellKm * FIRE_GRID.cellKm * 100;
    const fuelImpacts = Object.fromEntries(Object.keys(FUEL_BEHAVIOR).map(fuel => [fuel, 0]));

    for (const cell of affected) fuelImpacts[cell.fuel] += 1;
    const avgIntensity = active.length ? active.reduce((sum, cell) => sum + cell.intensity, 0) / active.length : 0;

    return {
      burnedHectares: Math.round(affected.length * cellHectares),
      frontKilometers: Number((active.length * FIRE_GRID.cellKm * 0.32).toFixed(1)),
      intensity: avgIntensity > 0.78 ? "Extreme" : avgIntensity > 0.54 ? "Forte" : "Moderee",
      activeCells: active.length,
      threatenedBuildings: countThreatenedBuildings(cells),
      fuelImpacts
    };
  }

  function buildIgnitionFeatureCollection(center) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Depart de feu" },
          geometry: { type: "Point", coordinates: normalizeCenter(center) }
        }
      ]
    };
  }

  function buildFireSimulationFrame(step, options = {}) {
    const tick = Math.max(0, Number(step) || 0);
    const center = normalizeCenter(options.center);
    const cells = simulateFireCells(tick, options.fuelOverrides);
    const windSpeed = Math.round(28 + Math.sin(tick * 0.18) * 5);

    return {
      step: tick,
      center,
      cells,
      zones: buildFireFeatureCollection(cells, center),
      emitters: buildFireEmitters(cells, center),
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

  function createRenderedFuelOverrides(map, center) {
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
          const lngLat = localKmToLngLat(center, local.xKm, local.yKm);
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
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.08, 10, 0.16, 14, 0.22]
        }
      },
      {
        id: "fire-burn-scar",
        type: "fill",
        source: FIRE_SOURCE_ID,
        filter: ["==", ["get", "state"], "burned"],
        paint: {
          "fill-color": FIRE_COLORS.burned,
          "fill-opacity": 0.76
        }
      },
      {
        id: "fire-ember-bed",
        type: "fill",
        source: FIRE_SOURCE_ID,
        filter: ["==", ["get", "state"], "embers"],
        paint: {
          "fill-color": FIRE_COLORS.embers,
          "fill-opacity": 0.42
        }
      },
      {
        id: "fire-active-core",
        type: "fill",
        source: FIRE_SOURCE_ID,
        filter: ["==", ["get", "state"], "active"],
        paint: {
          "fill-color": FIRE_COLORS.active,
          "fill-opacity": 0.66
        }
      },
      {
        id: "fire-active-glow",
        type: "line",
        source: FIRE_SOURCE_ID,
        filter: ["==", ["get", "state"], "active"],
        paint: {
          "line-color": "#ffb21f",
          "line-opacity": 0.9,
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 4, 11, 12, 15, 28],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 6, 5, 11, 12, 15, 22]
        }
      },
      {
        id: "fire-perimeter",
        type: "line",
        source: FIRE_SOURCE_ID,
        filter: ["in", ["get", "state"], ["literal", ["burned", "embers", "active"]]],
        paint: {
          "line-color": FIRE_COLORS.perimeter,
          "line-opacity": 0.46,
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.2, 11, 3.2, 15, 7],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 6, 1.5, 11, 3, 15, 7]
        }
      },
      {
        id: "wildfire-ignition",
        type: "circle",
        source: IGNITION_SOURCE_ID,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5, 11, 8, 15, 13],
          "circle-color": "#fff2df",
          "circle-opacity": 0.92,
          "circle-stroke-color": "#ff5a1f",
          "circle-stroke-width": 3
        }
      }
    ];
  }

  function buildFireLegendItems() {
    return FIRE_LEGEND_ITEMS.map(item => ({ ...item }));
  }

  const api = {
    DEFAULT_FIRE_CENTER,
    FIRE_COLORS,
    FIRE_GRID,
    FIRE_SOURCE_ID,
    IGNITION_SOURCE_ID,
    buildFireLayerDefinitions,
    buildFireLegendItems,
    buildFireSimulationFrame,
    buildIgnitionFeatureCollection,
    createRenderedFuelOverrides,
    localKmToLngLat
  };

  global.FireLogisticsFire = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
