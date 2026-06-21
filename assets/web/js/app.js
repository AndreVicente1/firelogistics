"use strict";
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
    const FUEL_SAMPLE_STRIDE = 3;
    const FUEL_SAMPLE_BUDGET_MS = 6;
    const FUEL_SAMPLE_MIN_BLOCKS_PER_FRAME = 8;
    const TERRAIN_TILEJSON_URL = "data/terrain-dem/tilejson.json";
    function sendToGodot(action, payload) {
        const message = JSON.stringify({ action, payload });
        if (global.ipc?.postMessage) {
            global.ipc.postMessage(message);
            return true;
        }
        if (global.godot?.ipc) {
            global.godot.ipc.postMessage(message);
            return true;
        }
        if (global.GodotBridge?.postMessage) {
            global.GodotBridge.postMessage(message);
            return true;
        }
        console.info("[FireLogistics bridge fallback]", message);
        return false;
    }
    function formatBytes(bytes) {
        const value = Number(bytes) || 0;
        if (value <= 0)
            return "--";
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
        if (!root)
            return;
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
        if (element)
            element.textContent = value;
    }
    function updateFireHud(frame, running) {
        if (!frame)
            return;
        const statusLabel = frame.status === "idle"
            ? "Aucun feu"
            : frame.status === "extinguished"
                ? "Eteint"
                : running
                    ? "Feu actif"
                    : "Pause";
        setText("simulation-value", statusLabel);
        setText("wind-value", `Vent ${frame.wind.direction} ${frame.wind.speedKmh} km/h`);
        setText("burned-area-value", `${frame.stats.burnedHectares} ha`);
        setText("front-length-value", `${frame.stats.frontKilometers} km`);
        setText("intensity-value", frame.stats.intensity);
        setText("building-risk-value", `${frame.stats.threatenedBuildings} zones`);
        const toggle = document.getElementById("fire-toggle-button");
        if (toggle)
            toggle.textContent = running ? "Pause feu" : "Reprendre";
    }
    function updateSelectionUi(enabled) {
        document.body.classList.toggle("selecting-fire-start", enabled);
        const button = document.getElementById("fire-start-button");
        if (button)
            button.textContent = enabled ? "Cliquer carte" : "Choisir depart";
        setText("phase-value", enabled ? "Choix depart" : "Incident");
    }
    function updateFireRenderModeUi(renderMode) {
        const button = document.getElementById("fire-render-mode-button");
        if (button) {
            button.textContent = `Rendu ${Fire.getFireRenderModeLabel(renderMode)}`;
        }
    }
    function hashZones(zones) {
        const features = zones?.features || [];
        if (!features.length)
            return "empty";
        let hash = 2166136261;
        for (const feature of features) {
            const id = String(feature?.properties?.id ?? "");
            const cellCount = Number(feature?.properties?.cellCount ?? 0);
            for (let i = 0; i < id.length; i++) {
                hash ^= id.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            hash ^= cellCount;
            hash = Math.imul(hash, 16777619);
            const ringCount = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates.length : 0;
            hash ^= ringCount;
            hash = Math.imul(hash, 16777619);
        }
        return String(hash >>> 0);
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
            if (id)
                previousById.set(id, feature);
        }
        const nextById = new Map();
        for (const feature of nextFeatures) {
            const id = feature?.properties?.id;
            if (id)
                nextById.set(id, feature);
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
            if (!geometryChanged && !propertiesChanged)
                continue;
            const update = { id };
            if (geometryChanged)
                update.newGeometry = nextFeature.geometry;
            if (propertiesChanged) {
                update.addOrUpdateProperties = Object.entries(nextFeature.properties).map(([key, value]) => ({ key, value }));
            }
            diff.update.push(update);
        }
        for (const id of previousById.keys()) {
            if (!nextById.has(id))
                diff.removed.push(id);
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
        state.lastResolvedZones = null;
        state.lastResolvedZonesKey = null;
    }
    function resetBurnScarRenderState(state) {
        state.burnScarEverLoaded = false;
        state.burnScarFeatures = [];
        state.burnScarRuns = [];
        state.burnScarFeatureIds = new Set();
        state.lastBurnScarRevision = -1;
    }
    function buildFireGeometryKey(frame, renderMode) {
        if (!frame)
            return "none";
        const seed = frame.incidentSeed ?? "no-seed";
        const step = frame.step ?? 0;
        const cellCount = Array.isArray(frame.cells) ? frame.cells.length : 0;
        const mutationRevision = frame.reason === "fuel_sample" ? `:${frame.revision ?? "sample"}` : "";
        return `${seed}:${step}:${renderMode}:${cellCount}${mutationRevision}`;
    }
    function resolveEffectiveFireRenderMode(frame, renderMode, state) {
        const requestedMode = Fire.normalizeRenderMode(renderMode ?? Fire.DEFAULT_FIRE_RENDER_MODE);
        if (requestedMode !== Fire.FIRE_RENDER_MODES.GRID)
            return requestedMode;
        return state?.mapInteracting
            ? Fire.FIRE_RENDER_MODES.BLOB
            : requestedMode;
    }
    function resolveCachedFireZones(frame, renderMode, state) {
        const effectiveMode = resolveEffectiveFireRenderMode(frame, renderMode, state);
        const cacheKey = buildFireGeometryKey(frame, effectiveMode);
        if (state?.lastResolvedZones && state.lastResolvedZonesKey === cacheKey) {
            return { zones: state.lastResolvedZones, renderMode: effectiveMode };
        }
        const zones = Fire.resolveFireZones(frame, effectiveMode);
        if (state) {
            state.lastResolvedZones = zones;
            state.lastResolvedZonesKey = cacheKey;
        }
        return { zones, renderMode: effectiveMode };
    }
    function applyFireZonesToSource(fireSource, state, zones) {
        const features = zones.features || [];
        const zonesHash = hashZones(zones);
        if (state && state.lastZonesHash === zonesHash)
            return false;
        if (!features.length) {
            if (state?.fireZonesEverLoaded && typeof fireSource.updateData === "function") {
                fireSource.updateData({ removeAll: true });
                if (state.counters)
                    state.counters.updateData += 1;
            }
            else {
                fireSource.setData(zones);
                if (state?.counters)
                    state.counters.setData += 1;
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
                if (state.counters)
                    state.counters.setData += 1;
            }
            return true;
        }
        if (typeof fireSource.updateData !== "function") {
            fireSource.setData(zones);
            if (state) {
                state.lastZoneFeatures = cloneFireZoneFeatures(features);
                state.lastZonesHash = zonesHash;
                if (state.counters)
                    state.counters.setData += 1;
            }
            return true;
        }
        const diff = buildFireZonesDiff(state.lastZoneFeatures || [], features);
        if (hasFireZonesDiffChanges(diff)) {
            fireSource.updateData(diff);
            if (state?.counters)
                state.counters.updateData += 1;
        }
        if (state) {
            state.lastZoneFeatures = cloneFireZoneFeatures(features);
            state.lastZonesHash = zonesHash;
        }
        return true;
    }
    function applyBurnScarToSource(burnScarSource, state, frame) {
        if (!burnScarSource?.setData || !frame?.burnScar)
            return false;
        const patch = frame.burnScar;
        const cellKm = patch.cellKm ?? Fire.FIRE_GRID.cellKm;
        const patchRuns = Array.isArray(patch.runs) ? patch.runs : [];
        if (patch.reset) {
            if (state) {
                state.burnScarRuns = [];
                state.burnScarFeatureIds = new Set();
            }
        }
        if (state && !Array.isArray(state.burnScarRuns))
            state.burnScarRuns = [];
        if (state && !state.burnScarFeatureIds)
            state.burnScarFeatureIds = new Set();
        if (state && patchRuns.length) {
            state.burnScarRuns = Fire.mergeBurnScarRunList([...state.burnScarRuns, ...patchRuns]);
        }
        const revision = Number(patch.revision ?? frame.revision ?? frame.step ?? 0);
        if (!patch.reset && state?.burnScarEverLoaded && revision <= state.lastBurnScarRevision) {
            return false;
        }
        if (patch.reset) {
            const features = Fire.buildBurnScarRunFeatures(Fire.mergeBurnScarRunList(patchRuns), frame.center, cellKm);
            burnScarSource.setData({ type: "FeatureCollection", features });
            if (state) {
                state.burnScarEverLoaded = true;
                state.burnScarFeatures = features.slice();
                state.burnScarFeatureIds = new Set(features.map(feature => feature.properties.id));
                state.lastBurnScarRevision = revision;
                if (state.counters)
                    state.counters.burnScarSetData += 1;
            }
            return true;
        }
        if (!state?.burnScarEverLoaded) {
            const features = Fire.buildBurnScarRunFeatures(Fire.mergeBurnScarRunList(patchRuns), frame.center, cellKm);
            if (!features.length)
                return false;
            burnScarSource.setData({ type: "FeatureCollection", features });
            if (state) {
                state.burnScarEverLoaded = true;
                state.burnScarFeatures = features.slice();
                state.burnScarFeatureIds = new Set(features.map(feature => feature.properties.id));
                state.lastBurnScarRevision = revision;
                if (state.counters)
                    state.counters.burnScarSetData += 1;
            }
            return true;
        }
        const newFeatures = [];
        for (const run of patchRuns) {
            const normalized = Fire.mergeBurnScarRunList([run])[0];
            if (!normalized)
                continue;
            const featureId = Fire.burnScarRunFeatureId(normalized);
            if (state.burnScarFeatureIds.has(featureId))
                continue;
            const feature = Fire.buildBurnScarRunFeature(normalized, frame.center, cellKm);
            if (!feature)
                continue;
            newFeatures.push(feature);
            state.burnScarFeatureIds.add(featureId);
        }
        if (!newFeatures.length)
            return false;
        if (typeof burnScarSource.updateData === "function") {
            burnScarSource.updateData({ add: newFeatures });
            state.burnScarFeatures.push(...newFeatures);
            state.lastBurnScarRevision = revision;
            if (state.counters)
                state.counters.burnScarUpdateData += 1;
            return true;
        }
        const features = Fire.buildBurnScarRunFeatures(state.burnScarRuns, frame.center, cellKm);
        burnScarSource.setData({ type: "FeatureCollection", features });
        if (state) {
            state.burnScarFeatures = features.slice();
            state.lastBurnScarRevision = revision;
            if (state.counters)
                state.counters.burnScarSetData += 1;
        }
        return true;
    }
    function applyFireFrameToSources(map, frame, ignitionCenter, renderMode) {
        if (map?.isStyleLoaded && !map.isStyleLoaded())
            return false;
        const ignitionSource = map?.getSource?.(Fire.IGNITION_SOURCE_ID);
        const fireSource = map?.getSource?.(Fire.FIRE_SOURCE_ID);
        const burnScarSource = map?.getSource?.(Fire.BURN_SCAR_SOURCE_ID);
        if (!ignitionSource?.setData)
            return false;
        const state = map.__fireRenderState || null;
        const { zones } = resolveCachedFireZones(frame, renderMode ?? Fire.DEFAULT_FIRE_RENDER_MODE, state);
        if (state && frame?.incidentSeed != null && state.lastAppliedIncidentSeed !== frame.incidentSeed) {
            state.lastAppliedIncidentSeed = frame.incidentSeed;
            resetFireZoneRenderState(state);
            resetBurnScarRenderState(state);
        }
        applyBurnScarToSource(burnScarSource, state, frame);
        if (fireSource?.setData) {
            applyFireZonesToSource(fireSource, state, zones);
        }
        const ignitionKey = JSON.stringify(ignitionCenter);
        if (!state || state.lastIgnitionKey !== ignitionKey) {
            ignitionSource.setData(Fire.buildIgnitionFeatureCollection(ignitionCenter));
            if (state)
                state.lastIgnitionKey = ignitionKey;
        }
        return true;
    }
    function createEmptyFireFrame(center) {
        return {
            step: 0,
            center,
            incidentSeed: 0,
            zones: { type: "FeatureCollection", features: [] },
            burnScar: { reset: true, revision: 0, cellKm: Fire.FIRE_GRID.cellKm, runs: [] },
            cells: [],
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
            status: center ? "paused" : "idle"
        };
    }
    function createFireRenderState() {
        return {
            lastIncidentSeed: null,
            lastAppliedIncidentSeed: null,
            lastRevision: -1,
            lastZonesHash: null,
            lastZoneFeatures: [],
            lastResolvedZones: null,
            lastResolvedZonesKey: null,
            burnScarEverLoaded: false,
            burnScarFeatures: [],
            burnScarRuns: [],
            burnScarFeatureIds: new Set(),
            lastBurnScarRevision: -1,
            fireZonesEverLoaded: false,
            lastIgnitionKey: null,
            pendingFrame: null,
            pendingMapFrame: null,
            pendingMapIgnitionCenter: null,
            pendingMapRenderMode: null,
            renderScheduled: false,
            mapInteracting: false,
            mapRenderScheduled: false,
            fuelSampleActive: false,
            counters: {
                receiveFrame: 0,
                setData: 0,
                updateData: 0,
                ignoredFrame: 0,
                samplesSent: 0,
                deferredMapWrites: 0,
                flushedMapWrites: 0,
                burnScarSetData: 0,
                burnScarUpdateData: 0
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
            if (seed === pendingSeed && revision <= pendingRevision)
                return false;
        }
        if (renderState.lastIncidentSeed === null)
            return true;
        if (seed !== renderState.lastIncidentSeed)
            return true;
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
    function mergeBurnScarPatch(previousPatch, nextPatch) {
        if (!previousPatch)
            return nextPatch || null;
        if (!nextPatch)
            return previousPatch;
        if (nextPatch.reset)
            return nextPatch;
        return {
            ...nextPatch,
            reset: Boolean(previousPatch.reset),
            revision: Math.max(Number(previousPatch.revision ?? 0), Number(nextPatch.revision ?? 0)),
            runs: [
                ...(Array.isArray(previousPatch.runs) ? previousPatch.runs : []),
                ...(Array.isArray(nextPatch.runs) ? nextPatch.runs : [])
            ]
        };
    }
    function mergeFrameBurnScar(previousFrame, nextFrame) {
        if (!previousFrame || !nextFrame || previousFrame.incidentSeed !== nextFrame.incidentSeed)
            return nextFrame;
        return {
            ...nextFrame,
            burnScar: mergeBurnScarPatch(previousFrame.burnScar, nextFrame.burnScar)
        };
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
                [Fire.BURN_SCAR_SOURCE_ID]: {
                    type: "geojson",
                    promoteId: "id",
                    data: { type: "FeatureCollection", features: [] }
                },
                [Fire.IGNITION_SOURCE_ID]: {
                    type: "geojson",
                    data: { type: "FeatureCollection", features: [] }
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
        let usesCoreSimulation = Boolean(global.ipc?.postMessage || global.godot?.ipc || global.GodotBridge?.postMessage || api.pendingFireFrame);
        let running = false;
        let hasIgnition = false;
        let center = null;
        let fuelOverrides = null;
        let fireRenderMode = api.fireRenderMode;
        let state = usesCoreSimulation ? null : Fire.createIdleFireSimulationState({ center: Fire.DEFAULT_FIRE_CENTER });
        let frame = usesCoreSimulation
            ? (api.pendingFireFrame || createEmptyFireFrame(null))
            : createEmptyFireFrame(null);
        let lastTick = performance.now();
        const renderState = createFireRenderState();
        const fireSource = map.getSource(Fire.FIRE_SOURCE_ID);
        const burnScarSource = map.getSource(Fire.BURN_SCAR_SOURCE_ID);
        const ignitionSource = map.getSource(Fire.IGNITION_SOURCE_ID);
        map.__fireRenderState = renderState;
        function applyMapFrame(targetFrame, ignitionCenter, renderMode) {
            return applyFireFrameToSources({
                __fireRenderState: renderState,
                isStyleLoaded() {
                    return !map.isStyleLoaded || map.isStyleLoaded();
                },
                getSource(id) {
                    return map.getSource(id)
                        || (id === Fire.FIRE_SOURCE_ID ? fireSource : id === Fire.BURN_SCAR_SOURCE_ID ? burnScarSource : ignitionSource);
                }
            }, targetFrame, ignitionCenter, renderMode);
        }
        function queueMapFrame(targetFrame, ignitionCenter, renderMode) {
            renderState.pendingMapFrame = targetFrame;
            renderState.pendingMapIgnitionCenter = ignitionCenter;
            renderState.pendingMapRenderMode = renderMode;
            renderState.counters.deferredMapWrites += 1;
        }
        function flushDeferredMapFrame() {
            renderState.mapRenderScheduled = false;
            if (renderState.mapInteracting || !renderState.pendingMapFrame)
                return;
            const applied = applyMapFrame(renderState.pendingMapFrame, renderState.pendingMapIgnitionCenter, renderState.pendingMapRenderMode);
            if (!applied) {
                return;
            }
            renderState.pendingMapFrame = null;
            renderState.pendingMapIgnitionCenter = null;
            renderState.pendingMapRenderMode = null;
            if (!usesCoreSimulation && state)
                Fire.markBurnScarPublished(state.burnScar);
            renderState.counters.flushedMapWrites += 1;
        }
        function scheduleDeferredMapFlush() {
            if (renderState.mapRenderScheduled)
                return;
            renderState.mapRenderScheduled = true;
            global.requestAnimationFrame(flushDeferredMapFrame);
        }
        function publish() {
            const ignitionCenter = hasIgnition ? center : null;
            let applied = true;
            if (renderState.mapInteracting) {
                queueMapFrame(frame, ignitionCenter, fireRenderMode);
            }
            else {
                applied = applyMapFrame(frame, ignitionCenter, fireRenderMode);
                if (applied && !usesCoreSimulation && state)
                    Fire.markBurnScarPublished(state.burnScar);
            }
            updateFireHud(frame, running);
            return applied;
        }
        function getFluidRenderModeForBuild() {
            const requestedMode = Fire.normalizeRenderMode(fireRenderMode);
            return requestedMode === Fire.FIRE_RENDER_MODES.GRID && renderState.mapInteracting
                ? Fire.FIRE_RENDER_MODES.BLOB
                : requestedMode;
        }
        function markMapInteractionActive() {
            renderState.mapInteracting = true;
        }
        function markMapInteractionIdle() {
            renderState.mapInteracting = false;
            if (renderState.pendingMapFrame && !renderState.mapRenderScheduled) {
                scheduleDeferredMapFlush();
            }
        }
        if (typeof map.on === "function") {
            for (const eventName of ["movestart", "zoomstart", "rotatestart", "pitchstart"]) {
                map.on(eventName, markMapInteractionActive);
            }
            for (const eventName of ["moveend", "zoomend", "rotateend", "pitchend", "idle"]) {
                map.on(eventName, markMapInteractionIdle);
            }
        }
        function rebuildFrame() {
            if (!state)
                return;
            frame = Fire.buildFireSimulationFrameFromState(state, { renderMode: getFluidRenderModeForBuild() });
            publish();
        }
        function rebuildStateWithFuelOverrides(nextFuelOverrides) {
            const targetStep = state.step;
            fuelOverrides = nextFuelOverrides;
            state = Fire.resetFireSimulationState(state, { center, fuelOverrides });
            if (targetStep > 0)
                Fire.advanceFireSimulationState(state, targetStep);
            rebuildFrame();
        }
        let fuelModelApplied = false;
        function switchToCoreSimulation() {
            if (usesCoreSimulation)
                return;
            usesCoreSimulation = true;
            state = null;
            fuelOverrides = null;
            fuelModelApplied = false;
            resetFireZoneRenderState(renderState);
        }
        function switchToLocalSimulation() {
            if (!usesCoreSimulation)
                return;
            usesCoreSimulation = false;
            state = Fire.createIdleFireSimulationState({ center: center ?? Fire.DEFAULT_FIRE_CENTER });
            resetFireZoneRenderState(renderState);
        }
        function refreshRenderedFuelModel() {
            if (!hasIgnition)
                return;
            if (usesCoreSimulation) {
                return;
            }
            if (fuelModelApplied)
                return;
            const renderedOverrides = Fire.createRenderedFuelOverrides(map, center);
            if (!renderedOverrides)
                return;
            fuelModelApplied = true;
            rebuildStateWithFuelOverrides(renderedOverrides);
        }
        function animate(now) {
            if (usesCoreSimulation) {
                global.requestAnimationFrame(animate);
                return;
            }
            if (running && hasIgnition && state && now - lastTick > 720) {
                lastTick = now;
                Fire.advanceFireSimulationState(state);
                rebuildFrame();
            }
            global.requestAnimationFrame(animate);
        }
        if (!usesCoreSimulation) {
            publish();
        }
        else {
            updateFireHud(frame, false);
        }
        if (usesCoreSimulation && api.pendingFireFrame) {
            queueCoreFrame(api.pendingFireFrame);
            api.pendingFireFrame = null;
        }
        global.requestAnimationFrame(animate);
        function clearAllFires() {
            hasIgnition = false;
            running = false;
            center = null;
            fuelOverrides = null;
            fuelModelApplied = false;
            api.selectingIgnition = false;
            updateSelectionUi(false);
            renderState.fuelSampleActive = false;
            if (usesCoreSimulation) {
                sendToGodot("fire_command", { command: "clear" });
                return;
            }
            state = Fire.createIdleFireSimulationState({ center: Fire.DEFAULT_FIRE_CENTER });
            frame = createEmptyFireFrame(null);
            resetFireZoneRenderState(renderState);
            publish();
        }
        return {
            getFrame() {
                return frame;
            },
            getFireRenderMode() {
                return fireRenderMode;
            },
            setFireRenderMode(mode) {
                fireRenderMode = Fire.normalizeRenderMode(mode);
                api.fireRenderMode = fireRenderMode;
                resetFireZoneRenderState(renderState);
                if (state)
                    rebuildFrame();
                else
                    publish();
                updateFireRenderModeUi(fireRenderMode);
            },
            toggleFireRenderMode() {
                const nextMode = fireRenderMode === Fire.FIRE_RENDER_MODES.GRID
                    ? Fire.FIRE_RENDER_MODES.BLOB
                    : Fire.FIRE_RENDER_MODES.GRID;
                this.setFireRenderMode(nextMode);
            },
            republish() {
                resetFireZoneRenderState(renderState);
                publish();
            },
            receiveFrame(nextFrame) {
                if (!nextFrame)
                    return;
                switchToCoreSimulation();
                queueCoreFrame(nextFrame);
            },
            usesCoreSimulation() {
                return usesCoreSimulation;
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
                if (!hasIgnition)
                    return;
                if (usesCoreSimulation) {
                    sendToGodot("fire_command", { command: "reset" });
                    return;
                }
                running = true;
                state = Fire.resetFireSimulationState(state, { center, fuelOverrides, ignite: true });
                rebuildFrame();
            },
            clearAllFires() {
                clearAllFires();
            },
            setIgnitionCenter(lngLat) {
                center = [Number(lngLat[0]), Number(lngLat[1])];
                hasIgnition = true;
                let notifyGodot = true;
                if (usesCoreSimulation) {
                    if (sendToGodot("fire_ignition_selected", { center })) {
                        return;
                    }
                    switchToLocalSimulation();
                    notifyGodot = false;
                }
                running = true;
                fuelOverrides = null;
                fuelModelApplied = false;
                state = Fire.resetFireSimulationState(state, { center, fuelOverrides, ignite: true });
                rebuildFrame();
                refreshRenderedFuelModel();
                map.once("idle", refreshRenderedFuelModel);
                if (notifyGodot) {
                    sendToGodot("fire_ignition_selected", { center });
                }
            },
            requestFuelSample(request) {
                if (renderState.fuelSampleActive)
                    return;
                const deliverFailure = () => {
                    sendToGodot("fire_fuel_sample_failed", request ?? null);
                };
                const deliverSample = (afterIdle = false) => {
                    if (!hasIgnition)
                        return;
                    renderState.fuelSampleActive = true;
                    const started = scheduleRenderedFuelSample(map, center, request, {
                        onSuccess(sample) {
                            renderState.fuelSampleActive = false;
                            renderState.counters.samplesSent += 1;
                            sendToGodot("fire_fuel_overrides_ready", sample);
                        },
                        onFailure() {
                            renderState.fuelSampleActive = false;
                            if (!afterIdle) {
                                map.once("idle", () => deliverSample(true));
                                return;
                            }
                            deliverFailure();
                        }
                    });
                    if (!started) {
                        renderState.fuelSampleActive = false;
                        if (!afterIdle) {
                            map.once("idle", () => deliverSample(true));
                            return;
                        }
                        deliverFailure();
                    }
                };
                deliverSample();
            }
        };
        function queueCoreFrame(nextFrame) {
            renderState.counters.receiveFrame += 1;
            if (!isNewerCoreFrame(renderState, nextFrame)) {
                renderState.counters.ignoredFrame += 1;
                return;
            }
            renderState.pendingFrame = mergeFrameBurnScar(renderState.pendingFrame, nextFrame);
            if (renderState.renderScheduled)
                return;
            renderState.renderScheduled = true;
            global.requestAnimationFrame(applyPendingCoreFrame);
        }
        function applyPendingCoreFrame() {
            renderState.renderScheduled = false;
            const nextFrame = renderState.pendingFrame;
            if (!nextFrame)
                return;
            if (map.isStyleLoaded && !map.isStyleLoaded()) {
                renderState.renderScheduled = true;
                global.requestAnimationFrame(applyPendingCoreFrame);
                return;
            }
            frame = nextFrame;
            center = nextFrame.center || center;
            hasIgnition = nextFrame.status !== "idle";
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
        if (!request)
            return null;
        const job = createRenderedFuelSampleJob(map, center, request);
        if (!job)
            return null;
        while (job.blockIndex < job.blockCount) {
            if (!stepRenderedFuelSample(map, center, job, { unlimited: true })) {
                return null;
            }
        }
        return finalizeRenderedFuelSample(job);
    }
    function createRenderedFuelSampleJob(map, center, request) {
        if (!request)
            return null;
        const width = Math.max(1, Number(request.width) || 0);
        const height = Math.max(1, Number(request.height) || 0);
        const originX = Number(request.originX) || 0;
        const originY = Number(request.originY) || 0;
        const cellKm = Number(request.cellKm) || Fire.FIRE_GRID.cellKm;
        if (!map?.queryRenderedFeatures || !map?.project || width <= 0 || height <= 0)
            return null;
        const stride = Math.max(1, Number(request.stride) || FUEL_SAMPLE_STRIDE);
        const blockCols = Math.ceil(width / stride);
        const blockRows = Math.ceil(height / stride);
        return {
            originX,
            originY,
            width,
            height,
            stride,
            blockCols,
            blockRows,
            blockCount: blockCols * blockRows,
            cellKm,
            fuels: new Array(width * height),
            resolved: 0,
            blockIndex: 0,
            queryLayers: ["buildings", "fuel-water", "fuel-mineral", "fuel-forest", "fuel-scrub", "fuel-grass", "fuel-crops", "fuel-urban"]
        };
    }
    function stepRenderedFuelSample(map, center, job, options = {}) {
        if (!job || !map?.queryRenderedFeatures || !map?.project)
            return false;
        const unlimited = Boolean(options?.unlimited);
        const budgetMs = Math.max(1, Number(options?.budgetMs) || FUEL_SAMPLE_BUDGET_MS);
        const minBlocks = Math.max(1, Number(options?.minBlocks) || FUEL_SAMPLE_MIN_BLOCKS_PER_FRAME);
        let processed = 0;
        const now = typeof performance?.now === "function" ? () => performance.now() : () => Date.now();
        const startAt = now();
        try {
            while (job.blockIndex < job.blockCount) {
                if (!unlimited && processed >= minBlocks && now() - startAt >= budgetMs)
                    break;
                const blockX = job.blockIndex % job.blockCols;
                const blockY = Math.floor(job.blockIndex / job.blockCols);
                const startX = blockX * job.stride;
                const startY = blockY * job.stride;
                const endX = Math.min(job.width, startX + job.stride);
                const endY = Math.min(job.height, startY + job.stride);
                const sampleX = Math.min(job.width - 1, startX + Math.floor(job.stride / 2));
                const sampleY = Math.min(job.height - 1, startY + Math.floor(job.stride / 2));
                const gridX = job.originX + sampleX;
                const gridY = job.originY + sampleY;
                const lngLat = Fire.localKmToLngLat(center, gridX * job.cellKm, gridY * job.cellKm);
                const point = map.project(lngLat);
                const fuel = Fire.classifyRenderedFuel
                    ? Fire.classifyRenderedFuel(map.queryRenderedFeatures(point, { layers: job.queryLayers }))
                    : null;
                for (let y = startY; y < endY; y++) {
                    for (let x = startX; x < endX; x++) {
                        const index = y * job.width + x;
                        job.fuels[index] = fuel;
                        if (fuel)
                            job.resolved += 1;
                    }
                }
                job.blockIndex += 1;
                processed += 1;
            }
        }
        catch (error) {
            console.warn("[FireLogistics] Echantillonnage combustible indisponible", error);
            return false;
        }
        return true;
    }
    function finalizeRenderedFuelSample(job) {
        if (!job)
            return null;
        if (job.resolved <= job.fuels.length * 0.04)
            return null;
        return {
            originX: job.originX,
            originY: job.originY,
            width: job.width,
            height: job.height,
            cellKm: job.cellKm,
            fuels: job.fuels
        };
    }
    function scheduleRenderedFuelSample(map, center, request, callbacks) {
        const job = createRenderedFuelSampleJob(map, center, request);
        if (!job) {
            callbacks.onFailure?.();
            return false;
        }
        const pump = () => {
            if (!stepRenderedFuelSample(map, center, job)) {
                callbacks.onFailure?.();
                return;
            }
            if (job.blockIndex < job.blockCount) {
                global.requestAnimationFrame(pump);
                return;
            }
            const sample = finalizeRenderedFuelSample(job);
            if (sample)
                callbacks.onSuccess?.(sample);
            else
                callbacks.onFailure?.();
        };
        pump();
        return true;
    }
    function createMapFpsTracker(map) {
        let frameCount = 0;
        let lastSampleAt = performance.now();
        map.on("render", () => {
            frameCount += 1;
        });
        global.setInterval(() => {
            const now = performance.now();
            const elapsedMs = Math.max(1, now - lastSampleAt);
            const fps = Math.round((frameCount * 1000) / elapsedMs);
            frameCount = 0;
            lastSampleAt = now;
            setText("map-fps-value", String(fps));
        }, 500);
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
            if (!api.selectingIgnition)
                return;
            api.selectingIgnition = false;
            updateSelectionUi(false);
            api.fireController?.setIgnitionCenter([event.lngLat.lng, event.lngLat.lat]);
        });
        map.on("error", event => {
            const message = event?.error?.message ?? "";
            if (message.includes("france-openmaptiles.pmtiles")) {
                console.error("Carte France absente: assets/web/data/france-openmaptiles.pmtiles");
            }
            else if (message.includes("world-backdrop.geojson")) {
                console.error("Fond monde absent: assets/web/data/world-backdrop.geojson");
            }
            else if (message.includes("terrain-dem")) {
                console.error("Relief DEM indisponible: " + TERRAIN_TILEJSON_URL);
            }
            else if (message) {
                console.error("[MapLibre]", message);
            }
        });
        createMapFpsTracker(map);
        return map;
    }
    const api = {
        map: null,
        fireController: null,
        pendingFireFrame: null,
        selectingIgnition: false,
        fireRenderMode: Fire.DEFAULT_FIRE_RENDER_MODE,
        sendToGodot,
        receiveFireFrame(frame) {
            if (api.fireController?.receiveFrame) {
                api.fireController.receiveFrame(frame);
            }
            else {
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
            updateFireHud(createEmptyFireFrame(null), false);
            api.map = initMap();
            document.getElementById("fire-toggle-button").addEventListener("click", () => {
                api.fireController?.toggle();
            });
            document.getElementById("fire-reset-button").addEventListener("click", () => {
                api.fireController?.reset();
            });
            document.getElementById("fire-clear-button").addEventListener("click", () => {
                api.fireController?.clearAllFires?.();
            });
            document.getElementById("fire-start-button").addEventListener("click", () => {
                api.selectingIgnition = !api.selectingIgnition;
                updateSelectionUi(api.selectingIgnition);
            });
            document.getElementById("fire-render-mode-button").addEventListener("click", () => {
                api.fireController?.toggleFireRenderMode?.();
            });
            updateFireRenderModeUi(api.fireRenderMode);
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
            BURN_SCAR_SOURCE_ID: Fire.BURN_SCAR_SOURCE_ID,
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
            getFireRenderModeLabel: Fire.getFireRenderModeLabel,
            hashZones,
            isNewerCoreFrame,
            markCoreFrameApplied,
            mergeFrameBurnScar,
            getCoreToggleCommand,
            shouldClearFireEffects,
            resolveFireZones: Fire.resolveFireZones,
            FIRE_RENDER_MODES: Fire.FIRE_RENDER_MODES,
            buildFranceWorldStyle,
            buildFuelLayerDefinitions,
            buildFuelLegendItems,
            buildTerrainLayerDefinition,
            buildTerrainSourceDefinition,
            createFireSimulation,
            formatBytes
        };
    }
})(typeof window !== "undefined" ? window : globalThis);
