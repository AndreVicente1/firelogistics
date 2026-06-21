(function (global) {
  const Fire = typeof require !== "undefined"
    ? require("./fire-simulation.js")
    : global.FireLogisticsFire;

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
        paint: { "fill-color": FUEL_COLORS.water, "fill-opacity": 0.72 }
      },
      {
        id: "fuel-mineral",
        type: "fill",
        source: "france",
        "source-layer": "landcover",
        filter: ["in", ["get", "class"], ["literal", ["rock", "sand"]]],
        paint: { "fill-color": FUEL_COLORS.mineral, "fill-opacity": 0.46 }
      },
      {
        id: "fuel-crops",
        type: "fill",
        source: "france",
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "farmland"],
        paint: { "fill-color": FUEL_COLORS.crops, "fill-opacity": 0.62 }
      },
      {
        id: "fuel-grass",
        type: "fill",
        source: "france",
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "grass"],
        paint: { "fill-color": FUEL_COLORS.grass, "fill-opacity": 0.58 }
      },
      {
        id: "fuel-scrub",
        type: "fill",
        source: "france",
        "source-layer": "landcover",
        filter: ["==", ["get", "subclass"], "scrub"],
        paint: { "fill-color": FUEL_COLORS.scrub, "fill-opacity": 0.64 }
      },
      {
        id: "fuel-forest",
        type: "fill",
        source: "france",
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "wood"],
        paint: { "fill-color": FUEL_COLORS.forest, "fill-opacity": 0.72 }
      },
      {
        id: "fuel-urban",
        type: "fill",
        source: "france",
        "source-layer": "landuse",
        filter: ["in", ["get", "class"], ["literal", ["residential", "industrial", "commercial", "retail"]]],
        paint: { "fill-color": FUEL_COLORS.urban, "fill-opacity": 0.68 }
      }
    ];
  }

  function buildFuelLegendItems() {
    return FUEL_LEGEND_ITEMS.map(item => ({ ...item }));
  }

  function buildTerrainSourceDefinition() {
    return { type: "raster-dem", url: TERRAIN_TILEJSON_URL };
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
    renderLegend("fire-legend", "fire-legend", Fire.buildFireLegendItems());
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function updateFireHud(frame, running) {
    if (!frame) return;
    setText("simulation-value", frame.status === "extinguished" ? "Eteint" : running ? "Feu actif" : "Pause");
    setText("wind-value", `Vent ${frame.wind.direction} ${frame.wind.speedKmh} km/h`);
    setText("burned-area-value", `${frame.stats.burnedHectares} ha`);
    setText("front-length-value", `${frame.stats.frontKilometers} km`);
    setText("intensity-value", frame.stats.intensity);
    setText("building-risk-value", `${frame.stats.threatenedBuildings} zones`);
    const toggle = document.getElementById("fire-toggle-button");
    if (toggle) toggle.textContent = running ? "Pause feu" : "Reprendre";
  }

  function updateSelectionUi(enabled) {
    document.body.classList.toggle("selecting-fire-start", enabled);
    const button = document.getElementById("fire-start-button");
    if (button) button.textContent = enabled ? "Cliquer carte" : "Choisir depart";
    setText("phase-value", enabled ? "Choix depart" : "Incident");
  }

  function hashZones(zones) {
    return JSON.stringify(zones);
  }

  function cloneFireZoneFeatures(features) {
    return features.map(feature => ({
      type: feature.type,
      properties: { ...feature.properties },
      geometry: JSON.parse(JSON.stringify(feature.geometry))
    }));
  }

  function buildFireZonesDiff(previousFeatures, nextFeatures) {
    const previousById = new Map();
    for (const feature of previousFeatures) {
      const id = feature?.properties?.id;
      if (id) previousById.set(id, feature);
    }

    const nextById = new Map();
    for (const feature of nextFeatures) {
      const id = feature?.properties?.id;
      if (id) nextById.set(id, feature);
    }

    const diff = { add: [], update: [], removed: [] };

    for (const [id, nextFeature] of nextById) {
      const previousFeature = previousById.get(id);
      if (!previousFeature) {
        diff.add.push(nextFeature);
        continue;
      }

      const geometryChanged = JSON.stringify(previousFeature.geometry) !== JSON.stringify(nextFeature.geometry);
      const propertiesChanged = JSON.stringify(previousFeature.properties) !== JSON.stringify(nextFeature.properties);
      if (!geometryChanged && !propertiesChanged) continue;

      const update: { id: string; newGeometry?: unknown; addOrUpdateProperties?: { key: string; value: unknown }[] } = { id };
      if (geometryChanged) update.newGeometry = nextFeature.geometry;
      if (propertiesChanged) {
        update.addOrUpdateProperties = Object.entries(nextFeature.properties).map(([key, value]) => ({ key, value }));
      }
      diff.update.push(update);
    }

    for (const id of previousById.keys()) {
      if (!nextById.has(id)) diff.removed.push(id);
    }

    return diff;
  }

  function hasFireZonesDiffChanges(diff) {
    return Boolean(diff.removeAll)
      || diff.add.length > 0
      || diff.update.length > 0
      || diff.removed.length > 0;
  }

  function resetFireZoneRenderState(state) {
    state.fireZonesEverLoaded = false;
    state.lastZoneFeatures = [];
    state.lastZonesHash = null;
  }

  function applyFireZonesToSource(fireSource, state, zones) {
    const features = zones.features || [];
    const zonesHash = hashZones(zones);

    if (state && state.lastZonesHash === zonesHash) return false;

    if (!features.length) {
      if (state?.fireZonesEverLoaded && typeof fireSource.updateData === "function") {
        fireSource.updateData({ removeAll: true });
        if (state.counters) state.counters.updateData += 1;
      } else {
        fireSource.setData(zones);
        if (state?.counters) state.counters.setData += 1;
      }
      if (state) {
        resetFireZoneRenderState(state);
        state.lastZonesHash = zonesHash;
      }
      return true;
    }

    if (!state?.fireZonesEverLoaded) {
      fireSource.setData(zones);
      if (state) {
        state.fireZonesEverLoaded = true;
        state.lastZoneFeatures = cloneFireZoneFeatures(features);
        state.lastZonesHash = zonesHash;
        if (state.counters) state.counters.setData += 1;
      }
      return true;
    }

    if (typeof fireSource.updateData !== "function") {
      fireSource.setData(zones);
      if (state) {
        state.lastZoneFeatures = cloneFireZoneFeatures(features);
        state.lastZonesHash = zonesHash;
        if (state.counters) state.counters.setData += 1;
      }
      return true;
    }

    const diff = buildFireZonesDiff(state.lastZoneFeatures || [], features);
    if (hasFireZonesDiffChanges(diff)) {
      fireSource.updateData(diff);
      if (state?.counters) state.counters.updateData += 1;
    }
    if (state) {
      state.lastZoneFeatures = cloneFireZoneFeatures(features);
      state.lastZonesHash = zonesHash;
    }
    return true;
  }

  function applyFireFrameToSources(map, frame, ignitionCenter) {
    if (map?.isStyleLoaded && !map.isStyleLoaded()) return false;
    const ignitionSource = map?.getSource?.(Fire.IGNITION_SOURCE_ID);
    const fireSource = map?.getSource?.(Fire.FIRE_SOURCE_ID);
    if (!ignitionSource?.setData) return false;

    const state = map.__fireRenderState || null;
    const zones = frame?.zones || { type: "FeatureCollection", features: [] };

    if (state && frame?.incidentSeed != null && state.lastAppliedIncidentSeed !== frame.incidentSeed) {
      state.lastAppliedIncidentSeed = frame.incidentSeed;
      resetFireZoneRenderState(state);
    }

    if (fireSource?.setData) {
      applyFireZonesToSource(fireSource, state, zones);
    }

    const ignitionKey = JSON.stringify(ignitionCenter);
    if (!state || state.lastIgnitionKey !== ignitionKey) {
      ignitionSource.setData(Fire.buildIgnitionFeatureCollection(ignitionCenter));
      if (state) state.lastIgnitionKey = ignitionKey;
    }

    return true;
  }

  function createEmptyFireFrame(center) {
    return {
      step: 0,
      center,
      incidentSeed: 0,
      zones: { type: "FeatureCollection", features: [] },
      emitters: [],
      stats: {
        burnedHectares: 0,
        frontKilometers: 0,
        intensity: "Moderee",
        activeCells: 0,
        threatenedBuildings: 0,
        fuelImpacts: {}
      },
      wind: { direction: "E-NE", degrees: 72, speedKmh: 28 },
      status: "paused"
    };
  }

  function createFireRenderState() {
    return {
      lastIncidentSeed: null,
      lastAppliedIncidentSeed: null,
      lastRevision: -1,
      lastZonesHash: null,
      lastZoneFeatures: [],
      fireZonesEverLoaded: false,
      lastIgnitionKey: null,
      pendingFrame: null,
      renderScheduled: false,
      counters: {
        receiveFrame: 0,
        setData: 0,
        updateData: 0,
        ignoredFrame: 0,
        samplesSent: 0
      }
    };
  }

  function isNewerCoreFrame(renderState, frame) {
    const seed = Number(frame?.incidentSeed);
    const revision = Number(frame?.revision ?? frame?.step ?? 0);
    const pending = renderState.pendingFrame;
    if (pending) {
      const pendingSeed = Number(pending.incidentSeed);
      const pendingRevision = Number(pending.revision ?? pending.step ?? 0);
      if (seed === pendingSeed && revision <= pendingRevision) return false;
    }

    if (renderState.lastIncidentSeed === null) return true;
    if (seed !== renderState.lastIncidentSeed) return true;
    return revision > renderState.lastRevision;
  }

  function markCoreFrameApplied(renderState, frame) {
    renderState.lastIncidentSeed = Number(frame.incidentSeed);
    renderState.lastRevision = Number(frame.revision ?? frame.step ?? 0);
  }

  function getCoreToggleCommand(frame) {
    return frame?.status === "paused" ? "resume" : "pause";
  }

  function shouldClearFireEffects(previousFrame, nextFrame) {
    return Boolean(previousFrame && nextFrame && previousFrame.incidentSeed !== nextFrame.incidentSeed);
  }

  function buildFranceWorldStyle() {
    const baseLayers = [
      { id: "background", type: "background", paint: { "background-color": "#0f1413" } },
      {
        id: "world-backdrop-water",
        type: "fill",
        source: "world-backdrop",
        filter: ["==", ["get", "kind"], "water"],
        paint: { "fill-color": "#101c24", "fill-opacity": 0.95 }
      },
      {
        id: "world-backdrop-land",
        type: "fill",
        source: "world-backdrop",
        filter: ["==", ["get", "kind"], "land"],
        paint: { "fill-color": "#151b18", "fill-opacity": 0.92 }
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
        "world-backdrop": { type: "geojson", data: "data/world-backdrop.geojson" },
        france: { type: "vector", url: "pmtiles://data/france-openmaptiles.pmtiles" },
        [TERRAIN_SOURCE_ID]: buildTerrainSourceDefinition(),
        [Fire.FIRE_SOURCE_ID]: {
          type: "geojson",
          promoteId: "id",
          data: { type: "FeatureCollection", features: [] }
        },
        [Fire.IGNITION_SOURCE_ID]: {
          type: "geojson",
          data: Fire.buildIgnitionFeatureCollection(Fire.DEFAULT_FIRE_CENTER)
        }
      },
      terrain: { source: TERRAIN_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION },
      sky: { "atmosphere-blend": 0.12 },
      layers: [
        ...baseLayers,
        ...buildFuelLayerDefinitions(),
        buildTerrainLayerDefinition(),
        ...Fire.buildFireLayerDefinitions(),
        ...overlayLayers
      ]
    };
  }

  function applyTerrainRuntime(map) {
    if (typeof map.setTerrain === "function") {
      map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION });
    }

    if (global.maplibregl?.TerrainControl) {
      map.addControl(new global.maplibregl.TerrainControl({
        source: TERRAIN_SOURCE_ID,
        exaggeration: TERRAIN_EXAGGERATION
      }), "bottom-right");
    }
  }

  function createFireSimulation(map) {
    const usesCoreSimulation = Boolean(global.godot?.ipc || global.GodotBridge?.postMessage);
    let running = true;
    let center = Fire.DEFAULT_FIRE_CENTER;
    let fuelOverrides = null;
    let state = usesCoreSimulation ? null : Fire.createFireSimulationState({ center, fuelOverrides });
    let frame = usesCoreSimulation
      ? (api.pendingFireFrame || createEmptyFireFrame(center))
      : Fire.buildFireSimulationFrameFromState(state);
    let lastTick = performance.now();
    const renderState = createFireRenderState();
    const fireSource = map.getSource(Fire.FIRE_SOURCE_ID);
    const ignitionSource = map.getSource(Fire.IGNITION_SOURCE_ID);
    map.__fireRenderState = renderState;

    function publish() {
      const applied = applyFireFrameToSources({
        __fireRenderState: renderState,
        isStyleLoaded() {
          return !map.isStyleLoaded || map.isStyleLoaded();
        },
        getSource(id) {
          return map.getSource(id) || (id === Fire.FIRE_SOURCE_ID ? fireSource : ignitionSource);
        }
      }, frame, center);
      updateFireHud(frame, running);
      return applied;
    }

    function rebuildFrame() {
      if (!state) return;
      frame = Fire.buildFireSimulationFrameFromState(state);
      publish();
    }

    function rebuildStateWithFuelOverrides(nextFuelOverrides) {
      const targetStep = state.step;
      fuelOverrides = nextFuelOverrides;
      state = Fire.resetFireSimulationState(state, { center, fuelOverrides });
      if (targetStep > 0) Fire.advanceFireSimulationState(state, targetStep);
      rebuildFrame();
    }

    let fuelModelApplied = false;

    function refreshRenderedFuelModel() {
      if (usesCoreSimulation) {
        const sample = createRenderedFuelSample(map, center, {
          originX: -64,
          originY: -48,
          width: 129,
          height: 97,
          cellKm: Fire.FIRE_GRID.cellKm
        });
        if (sample) sendToGodot("fire_fuel_overrides_ready", sample);
        return;
      }

      if (fuelModelApplied) return;
      const renderedOverrides = Fire.createRenderedFuelOverrides(map, center);
      if (!renderedOverrides) return;
      fuelModelApplied = true;
      rebuildStateWithFuelOverrides(renderedOverrides);
    }

    function animate(now) {
      if (usesCoreSimulation) {
        global.requestAnimationFrame(animate);
        return;
      }

      if (running && now - lastTick > 720) {
        lastTick = now;
        Fire.advanceFireSimulationState(state);
        rebuildFrame();
      }
      global.requestAnimationFrame(animate);
    }

    if (!usesCoreSimulation) {
      publish();
    } else {
      updateFireHud(frame, false);
    }
    if (usesCoreSimulation && api.pendingFireFrame) {
      queueCoreFrame(api.pendingFireFrame);
      api.pendingFireFrame = null;
    }
    map.once("idle", refreshRenderedFuelModel);
    global.requestAnimationFrame(animate);

    return {
      getFrame() {
        return frame;
      },
      receiveFrame(nextFrame) {
        if (!nextFrame) return;
        if (usesCoreSimulation) {
          queueCoreFrame(nextFrame);
          return;
        }

        frame = nextFrame;
        center = nextFrame.center || center;
        running = nextFrame.status === "running";
      publish();
      },
      toggle() {
        if (usesCoreSimulation) {
          sendToGodot("fire_command", { command: getCoreToggleCommand(frame) });
          return running;
        }

        running = !running;
        updateFireHud(frame, running);
        return running;
      },
      reset() {
        if (usesCoreSimulation) {
          sendToGodot("fire_command", { command: "reset" });
          return;
        }
        running = true;
        state = Fire.resetFireSimulationState(state, { center, fuelOverrides });
        rebuildFrame();
      },
      setIgnitionCenter(lngLat) {
        center = [Number(lngLat[0]), Number(lngLat[1])];
        if (usesCoreSimulation) {
          sendToGodot("fire_ignition_selected", { center });
          return;
        }

        running = true;
        fuelOverrides = null;
        fuelModelApplied = false;
        state = Fire.resetFireSimulationState(state, { center, fuelOverrides });
        rebuildFrame();
        refreshRenderedFuelModel();
        map.once("idle", refreshRenderedFuelModel);
        sendToGodot("fire_ignition_selected", { center });
      },
      requestFuelSample(request) {
        const sample = createRenderedFuelSample(map, center, request);
        if (sample) {
          renderState.counters.samplesSent += 1;
          sendToGodot("fire_fuel_overrides_ready", sample);
        }
      }
    };

    function queueCoreFrame(nextFrame) {
      renderState.counters.receiveFrame += 1;
      if (!isNewerCoreFrame(renderState, nextFrame)) {
        renderState.counters.ignoredFrame += 1;
        return;
      }

      renderState.pendingFrame = nextFrame;
      if (renderState.renderScheduled) return;
      renderState.renderScheduled = true;
      global.requestAnimationFrame(applyPendingCoreFrame);
    }

    function applyPendingCoreFrame() {
      renderState.renderScheduled = false;
      const nextFrame = renderState.pendingFrame;
      if (!nextFrame) return;
      if (map.isStyleLoaded && !map.isStyleLoaded()) {
        renderState.renderScheduled = true;
        global.requestAnimationFrame(applyPendingCoreFrame);
        return;
      }

      frame = nextFrame;
      center = nextFrame.center || center;
      running = nextFrame.status === "running";
      if (!publish()) {
        renderState.renderScheduled = true;
        global.requestAnimationFrame(applyPendingCoreFrame);
        return;
      }

      markCoreFrameApplied(renderState, nextFrame);
      renderState.pendingFrame = null;
    }
  }

  function createRenderedFuelSample(map, center, request) {
    if (!request) return null;
    const width = Math.max(1, Number(request.width) || 0);
    const height = Math.max(1, Number(request.height) || 0);
    const originX = Number(request.originX) || 0;
    const originY = Number(request.originY) || 0;
    const cellKm = Number(request.cellKm) || Fire.FIRE_GRID.cellKm;
    if (!map?.queryRenderedFeatures || !map?.project || width <= 0 || height <= 0) return null;

    const queryLayers = ["buildings", "fuel-water", "fuel-mineral", "fuel-forest", "fuel-scrub", "fuel-grass", "fuel-crops", "fuel-urban"];
    const fuels = [];
    let resolved = 0;
    try {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const gridX = originX + x;
          const gridY = originY + y;
          const lngLat = Fire.localKmToLngLat(center, gridX * cellKm, gridY * cellKm);
          const point = map.project(lngLat);
          const fuel = Fire.classifyRenderedFuel
            ? Fire.classifyRenderedFuel(map.queryRenderedFeatures(point, { layers: queryLayers }))
            : null;
          fuels.push(fuel);
          if (fuel) resolved += 1;
        }
      }
    } catch (error) {
      console.warn("[FireLogistics] Echantillonnage combustible indisponible", error);
      return null;
    }

    if (resolved <= width * height * 0.04) return null;
    return { originX, originY, width, height, cellKm, fuels };
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
      api.fireController = createFireSimulation(map);
    });
    map.on("click", event => {
      if (!api.selectingIgnition) return;
      api.selectingIgnition = false;
      updateSelectionUi(false);
      api.fireController?.setIgnitionCenter([event.lngLat.lng, event.lngLat.lat]);
    });
    map.on("error", event => {
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
    pendingFireFrame: null,
    selectingIgnition: false,
    sendToGodot,
    receiveFireFrame(frame) {
      if (api.fireController?.receiveFrame) {
        api.fireController.receiveFrame(frame);
      } else {
        api.pendingFireFrame = frame;
      }
    },
    requestFuelSample(request) {
      api.fireController?.requestFuelSample?.(request);
    },
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
      updateFireHud(Fire.buildFireSimulationFrame(0, { center: Fire.DEFAULT_FIRE_CENTER }), true);
      api.map = initMap();
      document.getElementById("fire-toggle-button").addEventListener("click", () => {
        api.fireController?.toggle();
      });
      document.getElementById("fire-reset-button").addEventListener("click", () => {
        api.fireController?.reset();
      });
      document.getElementById("fire-start-button").addEventListener("click", () => {
        api.selectingIgnition = !api.selectingIgnition;
        updateSelectionUi(api.selectingIgnition);
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
      FIRE_COLORS: Fire.FIRE_COLORS,
      FIRE_GRID: Fire.FIRE_GRID,
      FIRE_SOURCE_ID: Fire.FIRE_SOURCE_ID,
      FUEL_COLORS,
      TERRAIN_EXAGGERATION,
      TERRAIN_SOURCE_ID,
      buildFireLayerDefinitions: Fire.buildFireLayerDefinitions,
      buildFireLegendItems: Fire.buildFireLegendItems,
      buildFireSimulationFrame: Fire.buildFireSimulationFrame,
      applyFireFrameToSources,
      applyFireZonesToSource,
      buildFireZonesDiff,
      createEmptyFireFrame,
      createFireRenderState,
      createRenderedFuelSample,
      hashZones,
      isNewerCoreFrame,
      markCoreFrameApplied,
      getCoreToggleCommand,
      shouldClearFireEffects,
      buildFranceWorldStyle,
      buildFuelLayerDefinitions,
      buildFuelLegendItems,
      buildTerrainLayerDefinition,
      buildTerrainSourceDefinition,
      formatBytes
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
