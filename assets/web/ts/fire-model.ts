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
    width: 65,
    height: 49,
    cellKm: 0.18
  };

  const WIND_MODEL = {
    direction: "E-NE",
    degrees: 72,
    vector: [0.92, 0.39],
    speedKmh: 28
  };

  const FUEL_BEHAVIOR = {
    water: { burnable: false, ignition: 99, spread: 0, burnTicks: 0, emberTicks: 0, flame: 0, moisture: 1, resistance: 99, spotting: 0 },
    mineral: { burnable: false, ignition: 99, spread: 0, burnTicks: 0, emberTicks: 0, flame: 0, moisture: 1, resistance: 99, spotting: 0 },
    crops: { burnable: true, ignition: 0.48, spread: 0.46, burnTicks: 8, emberTicks: 3, flame: 0.5, moisture: 0.34, resistance: 0.16, spotting: 0.03 },
    grass: { burnable: true, ignition: 0.4, spread: 0.72, burnTicks: 7, emberTicks: 3, flame: 0.58, moisture: 0.22, resistance: 0.06, spotting: 0.05 },
    scrub: { burnable: true, ignition: 0.5, spread: 0.82, burnTicks: 12, emberTicks: 6, flame: 0.8, moisture: 0.16, resistance: 0.02, spotting: 0.11 },
    forest: { burnable: true, ignition: 0.58, spread: 0.76, burnTicks: 18, emberTicks: 9, flame: 0.96, moisture: 0.19, resistance: 0.04, spotting: 0.18 },
    urban: { burnable: true, ignition: 0.92, spread: 0.2, burnTicks: 12, emberTicks: 5, flame: 0.62, moisture: 0.42, resistance: 0.62, spotting: 0.01 }
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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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
    const river = Math.abs(yKm + 1.08 + Math.sin((xKm + 0.6) * 1.2) * 0.16);
    if (river < 0.1 && xKm > -4.3 && xKm < 4.2) return "water";

    const ridgeTrack = Math.abs(yKm - (xKm * 0.32 - 0.45));
    if (ridgeTrack < 0.07 && xKm > -3.9 && xKm < 4.2) return "mineral";
    if (Math.abs(xKm + 3.45) < 0.07 && yKm < 2.1) return "mineral";

    const villageA = Math.hypot(xKm - 1.75, yKm - 0.42);
    const villageB = Math.hypot(xKm - 2.8, yKm - 0.2);
    const hamlet = Math.hypot(xKm + 1.75, yKm - 1.25);
    if (villageA < 0.44 || villageB < 0.38 || hamlet < 0.34) return "urban";

    const roughness = deterministicNoise(Math.round(xKm * 8), Math.round(yKm * 8), 3);
    if ((yKm > 0.22 && xKm < 3.45) || (xKm > 0.55 && yKm > 0.44)) {
      return roughness > 0.2 ? "forest" : "scrub";
    }
    if (yKm > -0.88 && xKm < 2.1) return roughness > 0.32 ? "scrub" : "grass";
    if (xKm < -1.8 && yKm < -0.2) return "crops";
    if (roughness > 0.7) return "scrub";
    return yKm < -1.25 ? "crops" : "grass";
  }

  const api = {
    DEFAULT_FIRE_CENTER,
    FIRE_COLORS,
    FIRE_GRID,
    FIRE_LEGEND_ITEMS,
    FIRE_SOURCE_ID,
    FUEL_BEHAVIOR,
    IGNITION_SOURCE_ID,
    WIND_MODEL,
    clamp,
    deterministicNoise,
    getCellLocalKm,
    localKmToLngLat,
    normalizeCenter,
    sampleScenarioFuel
  };

  global.FireLogisticsFireModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
