"use strict";
(function (global) {
    const Fire = typeof require !== "undefined"
        ? require("./fire-simulation.js")
        : global.FireLogisticsFire;
    const FireEffects = typeof require !== "undefined"
        ? require("./fire-effects.js")
        : global.FireLogisticsFireEffects;
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
        setText("simulation-value", running ? "Feu actif" : "Pause");
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
    function applyFireFrameToSources(map, frame, ignitionCenter) {
        const fireSource = map?.getSource?.(Fire.FIRE_SOURCE_ID);
        const ignitionSource = map?.getSource?.(Fire.IGNITION_SOURCE_ID);
        if (fireSource?.setData)
            fireSource.setData(frame.zones);
        if (ignitionSource?.setData)
            ignitionSource.setData(Fire.buildIgnitionFeatureCollection(ignitionCenter));
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
                    data: Fire.buildFireSimulationFrame(0, { center: Fire.DEFAULT_FIRE_CENTER }).zones
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
        let state = Fire.createFireSimulationState({ center, fuelOverrides });
        let frame = Fire.buildFireSimulationFrameFromState(state);
        let lastTick = performance.now();
        const fireSource = map.getSource(Fire.FIRE_SOURCE_ID);
        const ignitionSource = map.getSource(Fire.IGNITION_SOURCE_ID);
        function publish() {
            applyFireFrameToSources({
                getSource(id) {
                    return map.getSource(id) || (id === Fire.FIRE_SOURCE_ID ? fireSource : ignitionSource);
                }
            }, frame, center);
            updateFireHud(frame, running);
        }
        function rebuildFrame() {
            frame = Fire.buildFireSimulationFrameFromState(state);
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
        function refreshRenderedFuelModel() {
            const renderedOverrides = Fire.createRenderedFuelOverrides(map, center);
            if (!renderedOverrides)
                return;
            if (usesCoreSimulation) {
                sendToGodot("fire_fuel_overrides_ready", {
                    width: Fire.FIRE_GRID.width,
                    height: Fire.FIRE_GRID.height,
                    cellKm: Fire.FIRE_GRID.cellKm,
                    fuels: renderedOverrides
                });
                return;
            }
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
        publish();
        FireEffects.createFireParticleOverlay(map, () => frame, () => running);
        map.once("idle", refreshRenderedFuelModel);
        global.requestAnimationFrame(animate);
        return {
            getFrame() {
                return frame;
            },
            receiveFrame(nextFrame) {
                if (!nextFrame)
                    return;
                frame = nextFrame;
                running = nextFrame.status !== "extinguished" && running;
                publish();
            },
            toggle() {
                running = !running;
                if (usesCoreSimulation) {
                    sendToGodot("fire_command", { command: running ? "resume" : "pause" });
                }
                updateFireHud(frame, running);
                return running;
            },
            reset() {
                running = true;
                if (usesCoreSimulation) {
                    sendToGodot("fire_command", { command: "reset" });
                    updateFireHud(frame, running);
                    return;
                }
                state = Fire.resetFireSimulationState(state, { center, fuelOverrides });
                rebuildFrame();
            },
            setIgnitionCenter(lngLat) {
                center = [Number(lngLat[0]), Number(lngLat[1])];
                running = true;
                fuelOverrides = null;
                state = Fire.resetFireSimulationState(state, { center, fuelOverrides });
                rebuildFrame();
                refreshRenderedFuelModel();
                map.once("idle", refreshRenderedFuelModel);
                sendToGodot("fire_ignition_selected", { center });
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
        return map;
    }
    const api = {
        map: null,
        fireController: null,
        selectingIgnition: false,
        sendToGodot,
        receiveFireFrame(frame) {
            api.fireController?.receiveFrame(frame);
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
            buildFranceWorldStyle,
            buildFuelLayerDefinitions,
            buildFuelLegendItems,
            buildTerrainLayerDefinition,
            buildTerrainSourceDefinition,
            formatBytes
        };
    }
})(typeof window !== "undefined" ? window : globalThis);
