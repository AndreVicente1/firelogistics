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

  function renderFuelLegend() {
    const root = document.getElementById("fuel-legend");
    if (!root) return;
    root.innerHTML = buildFuelLegendItems().map(item => `
      <div class="fuel-legend-item">
        <span class="fuel-swatch" style="background:${item.color}"></span>
        <span>${item.label}</span>
      </div>
    `).join("");
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
        [TERRAIN_SOURCE_ID]: buildTerrainSourceDefinition()
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
      center: [2.35, 46.8],
      zoom: 5.2,
      pitch: 62,
      bearing: -18,
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
              geometry: { type: "Point", coordinates: [5.38, 43.3] }
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
      api.map = initMap();
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
      FUEL_COLORS,
      TERRAIN_EXAGGERATION,
      TERRAIN_SOURCE_ID,
      buildFranceWorldStyle,
      buildFuelLayerDefinitions,
      buildFuelLegendItems,
      buildTerrainLayerDefinition,
      buildTerrainSourceDefinition,
      formatBytes
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
