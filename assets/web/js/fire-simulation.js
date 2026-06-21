"use strict";
(function (global) {
    const Model = typeof require !== "undefined"
        ? require("./fire-model.js")
        : global.FireLogisticsFireModel;
    const { DEFAULT_FIRE_CENTER, FIRE_COLORS, FIRE_GRID, FIRE_LEGEND_ITEMS, FIRE_SOURCE_ID, FUEL_BEHAVIOR, IGNITION_SOURCE_ID, WIND_MODEL, clamp, deterministicNoise, getCellLocalKm, localKmToLngLat, normalizeCenter, sampleScenarioFuel } = Model;
    const STATE = {
        UNBURNED: "unburned",
        HEAT: "heat",
        ACTIVE: "active",
        EMBERS: "embers",
        BURNED: "burned"
    };
    function createInitialFireCells(fuelOverrides, ignite = true) {
        const cells = [];
        for (let y = 0; y < FIRE_GRID.height; y++) {
            for (let x = 0; x < FIRE_GRID.width; x++) {
                const local = getCellLocalKm(x, y);
                const override = Array.isArray(fuelOverrides) ? fuelOverrides[y * FIRE_GRID.width + x] : null;
                const fuel = override && FUEL_BEHAVIOR[override] ? override : sampleScenarioFuel(local.xKm, local.yKm);
                const behavior = FUEL_BEHAVIOR[fuel];
                const distanceToIgnition = Math.hypot(local.xKm, local.yKm);
                const active = ignite && distanceToIgnition < 0.34 && behavior.burnable;
                cells.push({
                    x,
                    y,
                    ...local,
                    fuel,
                    state: active ? STATE.ACTIVE : STATE.UNBURNED,
                    age: 0,
                    heat: active ? 1 : 0,
                    fuelLoad: behavior.burnable ? 1 : 0,
                    intensity: active ? behavior.flame : 0
                });
            }
        }
        return cells;
    }
    function getCell(cells, x, y) {
        if (x < 0 || y < 0 || x >= FIRE_GRID.width || y >= FIRE_GRID.height)
            return null;
        return cells[y * FIRE_GRID.width + x];
    }
    function cloneFireCells(cells) {
        return cells.map(cell => ({ ...cell }));
    }
    function ignitionThreshold(cell) {
        const behavior = FUEL_BEHAVIOR[cell.fuel];
        if (!behavior.burnable)
            return Infinity;
        return behavior.ignition + behavior.moisture * 0.18 + behavior.resistance * 0.12;
    }
    function windAlignment(dx, dy) {
        const distance = Math.hypot(dx, dy) || 1;
        return (dx * WIND_MODEL.vector[0] + dy * WIND_MODEL.vector[1]) / distance;
    }
    function sourceRadiantPower(cell) {
        const behavior = FUEL_BEHAVIOR[cell.fuel];
        if (cell.state === STATE.ACTIVE) {
            const loadFactor = clamp(cell.fuelLoad * 1.35, 0.28, 1.15);
            return behavior.flame * loadFactor * (0.86 + cell.heat * 0.28);
        }
        if (cell.state === STATE.EMBERS) {
            return behavior.flame * clamp(cell.heat, 0.2, 0.62) * 0.42;
        }
        return 0;
    }
    function heatTransfer(source, target, dx, dy, tick) {
        const targetBehavior = FUEL_BEHAVIOR[target.fuel];
        if (!targetBehavior.burnable)
            return 0;
        const distance = Math.hypot(dx, dy) || 1;
        const alignment = windAlignment(dx, dy);
        const windFactor = clamp(1 + alignment * 0.72, 0.24, 1.95);
        const distanceFactor = 1 / Math.pow(distance, 1.35);
        const slopeFactor = clamp(1 + (target.yKm - source.yKm) * 0.06, 0.88, 1.14);
        const noiseFactor = 0.9 + deterministicNoise(target.x, target.y, tick) * 0.22;
        const fuelFactor = targetBehavior.spread * (1 - targetBehavior.moisture * 0.34);
        return sourceRadiantPower(source) * fuelFactor * windFactor * distanceFactor * slopeFactor * noiseFactor * 0.24;
    }
    function applyHeatDiffusion(cells, next, tick) {
        for (const source of cells) {
            if (source.state !== STATE.ACTIVE && source.state !== STATE.EMBERS)
                continue;
            const radius = source.state === STATE.ACTIVE ? 2 : 1;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (dx === 0 && dy === 0)
                        continue;
                    const target = getCell(cells, source.x + dx, source.y + dy);
                    const targetNext = getCell(next, source.x + dx, source.y + dy);
                    if (!target || !targetNext || target.state === STATE.BURNED || target.state === STATE.ACTIVE)
                        continue;
                    const addedHeat = heatTransfer(source, target, dx, dy, tick);
                    if (addedHeat <= 0)
                        continue;
                    targetNext.heat = clamp(targetNext.heat + addedHeat, 0, 1.35);
                    if (targetNext.state === STATE.UNBURNED && targetNext.heat > 0.22) {
                        targetNext.state = STATE.HEAT;
                    }
                }
            }
        }
    }
    function applySpotting(cells, next, tick) {
        for (const source of cells) {
            const behavior = FUEL_BEHAVIOR[source.fuel];
            if (source.state !== STATE.ACTIVE || behavior.spotting <= 0)
                continue;
            const downwindX = Math.round(source.x + WIND_MODEL.vector[0] * (2 + behavior.spotting * 12));
            const downwindY = Math.round(source.y + WIND_MODEL.vector[1] * (1 + behavior.spotting * 6));
            const candidate = getCell(cells, downwindX, downwindY);
            const candidateNext = getCell(next, downwindX, downwindY);
            if (!candidate || !candidateNext || candidate.state === STATE.ACTIVE || candidate.state === STATE.BURNED)
                continue;
            const targetBehavior = FUEL_BEHAVIOR[candidate.fuel];
            if (!targetBehavior.burnable || candidate.heat < 0.12)
                continue;
            const probability = behavior.spotting * source.intensity * (1 - targetBehavior.moisture) * 0.55;
            if (deterministicNoise(source.x + candidate.x, source.y + candidate.y, tick + 19) < probability) {
                candidateNext.heat = Math.max(candidateNext.heat, ignitionThreshold(candidate) + 0.04);
                candidateNext.state = STATE.HEAT;
            }
        }
    }
    function updateCombustionStates(next) {
        for (const cell of next) {
            const behavior = FUEL_BEHAVIOR[cell.fuel];
            if (cell.state === STATE.ACTIVE) {
                cell.age += 1;
                const consumption = (0.38 + cell.intensity * 0.2) / Math.max(1, behavior.burnTicks);
                cell.fuelLoad = clamp(cell.fuelLoad - consumption, 0, 1);
                cell.heat = clamp(cell.heat + 0.1, 0, 1.2);
                const maturity = clamp(cell.age / Math.max(1, behavior.burnTicks), 0, 1);
                cell.intensity = behavior.flame * clamp(cell.fuelLoad * 1.22, 0.18, 1) * (1 - maturity * 0.22);
                if (cell.fuelLoad <= 0.1 || cell.age >= behavior.burnTicks * 1.45) {
                    cell.state = STATE.EMBERS;
                    cell.age = 0;
                    cell.heat = Math.max(cell.heat, 0.58);
                    cell.intensity = behavior.flame * 0.34;
                }
            }
            else if (cell.state === STATE.EMBERS) {
                cell.age += 1;
                cell.heat = clamp(cell.heat * (0.92 - behavior.moisture * 0.05), 0, 1);
                cell.intensity = behavior.flame * clamp(cell.heat, 0.18, 0.48);
                if (cell.age >= behavior.emberTicks || cell.heat < 0.18) {
                    cell.state = STATE.BURNED;
                    cell.heat = 0.08;
                    cell.intensity = 0;
                }
            }
            else if (cell.state === STATE.HEAT) {
                cell.age += 1;
                cell.heat = clamp(cell.heat * (0.94 - behavior.moisture * 0.12), 0, 1.35);
                if (cell.heat >= ignitionThreshold(cell)) {
                    cell.state = STATE.ACTIVE;
                    cell.age = 0;
                    cell.intensity = behavior.flame * clamp(cell.heat, 0.55, 1.1);
                }
                else if (cell.heat < 0.16 || cell.age > 10) {
                    cell.state = STATE.UNBURNED;
                    cell.age = 0;
                    cell.heat = 0;
                }
            }
        }
    }
    function advanceFireCells(cells, tick) {
        const next = cloneFireCells(cells);
        applyHeatDiffusion(cells, next, tick);
        applySpotting(cells, next, tick);
        updateCombustionStates(next);
        return next;
    }
    function simulateFireCells(step, fuelOverrides) {
        const maxStep = Math.max(0, Number(step) || 0);
        let cells = createInitialFireCells(fuelOverrides);
        for (let tick = 1; tick <= maxStep; tick++) {
            cells = advanceFireCells(cells, tick);
        }
        return cells;
    }
    function createFireSimulationState(options = {}) {
        const center = normalizeCenter(options.center);
        const ignite = options.ignite !== false;
        const fuelOverrides = options.fuelOverrides ?? null;
        return {
            step: 0,
            center,
            fuelOverrides,
            cells: createInitialFireCells(fuelOverrides, ignite)
        };
    }
    function createIdleFireSimulationState(options = {}) {
        return createFireSimulationState({ ...options, ignite: false });
    }
    function resetFireSimulationState(state, options = {}) {
        state.step = 0;
        state.center = normalizeCenter(options.center ?? state.center);
        state.fuelOverrides = options.fuelOverrides ?? null;
        const ignite = options.ignite !== false;
        state.cells = createInitialFireCells(state.fuelOverrides, ignite);
        return state;
    }
    function advanceFireSimulationState(state, ticks = 1) {
        const count = Math.max(1, Number(ticks) || 1);
        for (let i = 0; i < count; i++) {
            state.step += 1;
            state.cells = advanceFireCells(state.cells, state.step);
        }
        return state;
    }
    function dominantFuel(cells) {
        const counts = {};
        for (const cell of cells)
            counts[cell.fuel] = (counts[cell.fuel] || 0) + 1;
        return Object.entries(counts).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] ?? "unknown";
    }
    const BLOB_POINT_COUNT = 96;
    const FIRE_RENDER_MODES = {
        BLOB: "blob",
        GRID: "grid"
    };
    const DEFAULT_FIRE_RENDER_MODE = FIRE_RENDER_MODES.BLOB;
    function normalizeRenderMode(mode) {
        return mode === FIRE_RENDER_MODES.GRID ? FIRE_RENDER_MODES.GRID : FIRE_RENDER_MODES.BLOB;
    }
    function normalizeFrameCells(cells, center, cellKm = FIRE_GRID.cellKm) {
        if (!Array.isArray(cells))
            return [];
        const resolvedCellKm = Number(cellKm) || FIRE_GRID.cellKm;
        return cells.map(cell => {
            const x = Number(cell.x ?? cell.X);
            const y = Number(cell.y ?? cell.Y);
            const hasLocalKm = Number.isFinite(cell.xKm) && Number.isFinite(cell.yKm);
            return {
                x,
                y,
                xKm: hasLocalKm ? cell.xKm : x * resolvedCellKm,
                yKm: hasLocalKm ? cell.yKm : y * resolvedCellKm,
                fuel: cell.fuel ?? cell.Fuel ?? cell.f ?? "grass",
                state: cell.state ?? cell.State ?? cell.s ?? STATE.UNBURNED,
                intensity: Number(cell.intensity ?? cell.Intensity ?? cell.i ?? 0),
                heat: Number(cell.heat ?? cell.Heat ?? cell.h ?? 0)
            };
        });
    }
    function fourNeighbors(coordinate, byCoordinate) {
        const neighbors = [
            { x: coordinate.x + 1, y: coordinate.y },
            { x: coordinate.x - 1, y: coordinate.y },
            { x: coordinate.x, y: coordinate.y + 1 },
            { x: coordinate.x, y: coordinate.y - 1 }
        ];
        return neighbors.filter(neighbor => byCoordinate.has(`${neighbor.x},${neighbor.y}`));
    }
    function connectedComponents(cells) {
        const byCoordinate = new Map(cells.map(cell => [`${cell.x},${cell.y}`, cell]));
        const visited = new Set();
        const components = [];
        for (const cell of cells) {
            const key = `${cell.x},${cell.y}`;
            if (visited.has(key))
                continue;
            const component = [];
            const queue = [{ x: cell.x, y: cell.y }];
            visited.add(key);
            while (queue.length) {
                const coordinate = queue.shift();
                const current = byCoordinate.get(`${coordinate.x},${coordinate.y}`);
                component.push(current);
                for (const neighbor of fourNeighbors(coordinate, byCoordinate)) {
                    const neighborKey = `${neighbor.x},${neighbor.y}`;
                    if (visited.has(neighborKey))
                        continue;
                    visited.add(neighborKey);
                    queue.push(neighbor);
                }
            }
            components.push(component);
        }
        return components;
    }
    function buildHorizontalRuns(cells) {
        const runs = [];
        const rows = new Map();
        for (const cell of cells) {
            if (!rows.has(cell.y))
                rows.set(cell.y, []);
            rows.get(cell.y).push(cell);
        }
        for (const rowCells of rows.values()) {
            rowCells.sort((a, b) => a.x - b.x);
            let run = [];
            let previousX = null;
            for (const cell of rowCells) {
                if (previousX != null && cell.x !== previousX + 1) {
                    if (run.length)
                        runs.push(run);
                    run = [];
                }
                run.push(cell);
                previousX = cell.x;
            }
            if (run.length)
                runs.push(run);
        }
        return runs;
    }
    function buildRunRing(center, run, cellKm) {
        const minXCell = run.reduce((left, cell) => (cell.x < left.x ? cell : left));
        const maxXCell = run.reduce((left, cell) => (cell.x > left.x ? cell : left));
        const yCell = run[0];
        const half = cellKm / 2;
        const minXKm = minXCell.xKm - half;
        const maxXKm = maxXCell.xKm + half;
        const yKm = yCell.yKm;
        return [
            localKmToLngLat(center, minXKm, yKm - half),
            localKmToLngLat(center, maxXKm, yKm - half),
            localKmToLngLat(center, maxXKm, yKm + half),
            localKmToLngLat(center, minXKm, yKm + half),
            localKmToLngLat(center, minXKm, yKm - half)
        ];
    }
    function buildGridFeatureCollection(cells, center, cellKm = FIRE_GRID.cellKm) {
        const groups = {
            heat: cells.filter(cell => cell.state === STATE.HEAT),
            burned: cells.filter(cell => cell.state === STATE.BURNED),
            embers: cells.filter(cell => cell.state === STATE.EMBERS),
            active: cells.filter(cell => cell.state === STATE.ACTIVE)
        };
        const features = [];
        for (const [state, group] of Object.entries(groups)) {
            if (!group.length)
                continue;
            const runsByFuel = new Map();
            for (const component of connectedComponents(group)) {
                for (const run of buildHorizontalRuns(component)) {
                    const fuel = dominantFuel(run);
                    if (!runsByFuel.has(fuel))
                        runsByFuel.set(fuel, []);
                    runsByFuel.get(fuel).push(run);
                }
            }
            for (const [fuel, runs] of runsByFuel) {
                const polygons = runs.map(run => [buildRunRing(center, run, cellKm)]);
                const flatCells = runs.flat();
                const maxIntensity = flatCells.reduce((value, cell) => Math.max(value, cell.intensity, cell.heat), 0);
                features.push({
                    type: "Feature",
                    properties: {
                        id: `${state}-${fuel}`,
                        state,
                        fuel,
                        intensity: Number(maxIntensity.toFixed(3)),
                        cellCount: flatCells.length
                    },
                    geometry: {
                        type: polygons.length === 1 ? "Polygon" : "MultiPolygon",
                        coordinates: polygons.length === 1 ? polygons[0] : polygons
                    }
                });
            }
        }
        return { type: "FeatureCollection", features };
    }
    function median(values) {
        if (!values.length)
            return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    function buildSmoothBlobShape(cells, state, centroidOverride = null) {
        if (!cells.length)
            return null;
        let centroid = centroidOverride;
        if (!centroid) {
            centroid = cells.reduce((acc, cell) => {
                acc.xKm += cell.xKm;
                acc.yKm += cell.yKm;
                return acc;
            }, { xKm: 0, yKm: 0 });
            centroid.xKm /= cells.length;
            centroid.yKm /= cells.length;
        }
        const pointCount = BLOB_POINT_COUNT;
        const radii = [];
        for (let i = 0; i < pointCount; i++) {
            const angle = (i / pointCount) * Math.PI * 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            let radius = FIRE_GRID.cellKm * 1.05;
            for (const cell of cells) {
                const dx = cell.xKm - centroid.xKm;
                const dy = cell.yKm - centroid.yKm;
                const projection = dx * cos + dy * sin;
                const perpendicular = Math.abs(-dx * sin + dy * cos);
                if (projection > -FIRE_GRID.cellKm) {
                    const influence = projection + Math.max(0, FIRE_GRID.cellKm * 0.9 - perpendicular * 0.35);
                    radius = Math.max(radius, influence);
                }
            }
            const wobble = (deterministicNoise(i, cells.length, state.length) - 0.5) * FIRE_GRID.cellKm * 0.18;
            radii.push(Math.max(FIRE_GRID.cellKm * 0.65, radius + wobble));
        }
        for (let pass = 0; pass < 3; pass++) {
            const smoothed = radii.slice();
            for (let i = 0; i < pointCount; i++) {
                const prev = radii[(i - 1 + pointCount) % pointCount];
                const next = radii[(i + 1) % pointCount];
                smoothed[i] = radii[i] * 0.5 + (prev + next) * 0.25;
            }
            for (let i = 0; i < pointCount; i++)
                radii[i] = smoothed[i];
        }
        return { centroid, radii };
    }
    function ringFromRadii(center, centroid, radii) {
        const pointCount = radii.length;
        const ring = radii.map((radius, i) => {
            const angle = (i / pointCount) * Math.PI * 2;
            return localKmToLngLat(center, centroid.xKm + Math.cos(angle) * radius, centroid.yKm + Math.sin(angle) * radius);
        });
        ring.push(ring[0]);
        return densifyRing(ring, 2);
    }
    function densifyRing(ring, stepsPerSegment) {
        if (!ring?.length || ring.length < 2 || stepsPerSegment < 2)
            return ring;
        const dense = [];
        for (let i = 0; i < ring.length - 1; i++) {
            const a = ring[i];
            const b = ring[i + 1];
            dense.push(a);
            for (let step = 1; step < stepsPerSegment; step++) {
                const t = step / stepsPerSegment;
                dense.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            }
        }
        dense.push(ring[ring.length - 1]);
        return dense;
    }
    function buildSmoothBlobFeature(cells, state, center, radiusPaddingKm, innerCells) {
        const shape = buildSmoothBlobShape(cells, state);
        if (!shape)
            return null;
        const outerRadii = shape.radii.map(radius => radius + radiusPaddingKm);
        const coordinates = [ringFromRadii(center, shape.centroid, outerRadii)];
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
            geometry: { type: "Polygon", coordinates }
        };
    }
    function buildFireFeatureCollection(cells, center, renderMode = DEFAULT_FIRE_RENDER_MODE, options = {}) {
        const mode = normalizeRenderMode(renderMode);
        if (mode === FIRE_RENDER_MODES.GRID) {
            return buildGridFeatureCollection(cells, center, options.cellKm ?? FIRE_GRID.cellKm);
        }
        const groups = {
            heat: cells.filter(cell => cell.state === STATE.HEAT),
            burned: cells.filter(cell => cell.state === STATE.BURNED),
            embers: cells.filter(cell => cell.state === STATE.EMBERS),
            active: cells.filter(cell => cell.state === STATE.ACTIVE)
        };
        const features = [];
        for (const [state, group] of Object.entries(groups)) {
            const padding = state === "heat" ? 0.34 : state === "active" ? 0.18 : 0.15;
            const innerCells = null;
            const feature = buildSmoothBlobFeature(group, state, center, padding, innerCells);
            if (feature)
                features.push(feature);
        }
        return { type: "FeatureCollection", features };
    }
    function buildFireEmitters(cells, center) {
        return cells
            .filter(cell => cell.state === STATE.ACTIVE)
            .sort((a, b) => (b.xKm + b.yKm * 0.35) - (a.xKm + a.yKm * 0.35))
            .slice(0, 34)
            .map((cell, index) => ({
            id: `cell-${cell.x}-${cell.y}`,
            lngLat: localKmToLngLat(center, cell.xKm, cell.yKm),
            intensity: Math.max(0.3, cell.intensity),
            type: index % 4 === 0 ? "ember" : "flame"
        }));
    }
    function countThreatenedBuildings(cells) {
        return cells.filter(cell => {
            if (cell.fuel !== "urban")
                return false;
            if (cell.state !== STATE.UNBURNED)
                return true;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const neighbor = getCell(cells, cell.x + dx, cell.y + dy);
                    if (neighbor && (neighbor.state === STATE.ACTIVE || neighbor.state === STATE.EMBERS || neighbor.state === STATE.BURNED || neighbor.state === STATE.HEAT))
                        return true;
                }
            }
            return false;
        }).length;
    }
    function summarizeFireStats(cells) {
        const affected = cells.filter(cell => cell.state === STATE.ACTIVE || cell.state === STATE.EMBERS || cell.state === STATE.BURNED);
        const active = cells.filter(cell => cell.state === STATE.ACTIVE);
        const cellHectares = FIRE_GRID.cellKm * FIRE_GRID.cellKm * 100;
        const fuelImpacts = Object.fromEntries(Object.keys(FUEL_BEHAVIOR).map(fuel => [fuel, 0]));
        for (const cell of affected)
            fuelImpacts[cell.fuel] += 1;
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
        if (!center) {
            return { type: "FeatureCollection", features: [] };
        }
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
        const renderMode = normalizeRenderMode(options.renderMode);
        const cells = simulateFireCells(tick, options.fuelOverrides);
        const windSpeed = Math.round(WIND_MODEL.speedKmh + Math.sin(tick * 0.18) * 5);
        return {
            step: tick,
            center,
            cells,
            zones: buildFireFeatureCollection(cells, center, renderMode),
            emitters: buildFireEmitters(cells, center),
            stats: summarizeFireStats(cells),
            wind: {
                direction: WIND_MODEL.direction,
                degrees: WIND_MODEL.degrees,
                speedKmh: windSpeed
            }
        };
    }
    function buildFireSimulationFrameFromState(state, options = {}) {
        const center = normalizeCenter(state.center);
        const renderMode = normalizeRenderMode(options.renderMode);
        const windSpeed = Math.round(WIND_MODEL.speedKmh + Math.sin(state.step * 0.18) * 5);
        return {
            step: state.step,
            center,
            cells: state.cells,
            zones: buildFireFeatureCollection(state.cells, center, renderMode),
            emitters: buildFireEmitters(state.cells, center),
            stats: summarizeFireStats(state.cells),
            wind: {
                direction: WIND_MODEL.direction,
                degrees: WIND_MODEL.degrees,
                speedKmh: windSpeed
            }
        };
    }
    function classifyRenderedFuel(features) {
        const layerIds = new Set(features.map(feature => feature.layer?.id).filter(Boolean));
        if (layerIds.has("buildings"))
            return "urban";
        if (layerIds.has("fuel-water"))
            return "water";
        if (layerIds.has("fuel-mineral"))
            return "mineral";
        if (layerIds.has("fuel-forest"))
            return "forest";
        if (layerIds.has("fuel-scrub"))
            return "scrub";
        if (layerIds.has("fuel-grass"))
            return "grass";
        if (layerIds.has("fuel-crops"))
            return "crops";
        if (layerIds.has("fuel-urban"))
            return "urban";
        return null;
    }
    function createRenderedFuelOverrides(map, center) {
        if (!map?.queryRenderedFeatures || !map?.project)
            return null;
        const queryLayers = ["buildings", "fuel-water", "fuel-mineral", "fuel-forest", "fuel-scrub", "fuel-grass", "fuel-crops", "fuel-urban"];
        const overrides = [];
        let resolved = 0;
        try {
            for (let y = 0; y < FIRE_GRID.height; y++) {
                for (let x = 0; x < FIRE_GRID.width; x++) {
                    const local = getCellLocalKm(x, y);
                    const lngLat = localKmToLngLat(center, local.xKm, local.yKm);
                    const point = map.project(lngLat);
                    const fuel = classifyRenderedFuel(map.queryRenderedFeatures(point, { layers: queryLayers }));
                    overrides.push(fuel);
                    if (fuel)
                        resolved += 1;
                }
            }
        }
        catch (error) {
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
                    "fill-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.06, 12, 0.1, 15, 0.14],
                    "fill-antialias": true
                }
            },
            {
                id: "fire-active-core",
                type: "fill",
                source: FIRE_SOURCE_ID,
                filter: ["==", ["get", "state"], "active"],
                paint: {
                    "fill-color": [
                        "interpolate",
                        ["linear"],
                        ["coalesce", ["get", "intensity"], 0.5],
                        0, "#ff7a18",
                        0.5, "#ff4400",
                        0.8, "#e51d00",
                        1, "#b00d00"
                    ],
                    "fill-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.74, 12, 0.82, 15, 0.88],
                    "fill-antialias": true
                }
            },
            {
                id: "fire-active-glow",
                type: "line",
                source: FIRE_SOURCE_ID,
                filter: ["==", ["get", "state"], "active"],
                paint: {
                    "line-color": "#ffd24a",
                    "line-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.85, 13, 0.92, 16, 0.96],
                    "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.6, 12, 3, 16, 6],
                    "line-blur": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 12, 1, 16, 1.6]
                }
            },
            {
                id: "fire-ember-bed",
                type: "fill",
                source: FIRE_SOURCE_ID,
                filter: ["==", ["get", "state"], "embers"],
                paint: {
                    "fill-color": FIRE_COLORS.embers,
                    "fill-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 12, 0.58, 15, 0.64],
                    "fill-antialias": true
                }
            },
            {
                id: "fire-burn-scar",
                type: "fill",
                source: FIRE_SOURCE_ID,
                filter: ["==", ["get", "state"], "burned"],
                paint: {
                    "fill-color": FIRE_COLORS.burned,
                    "fill-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.74, 12, 0.82, 15, 0.88],
                    "fill-antialias": true
                }
            },
            {
                id: "fire-perimeter",
                type: "line",
                source: FIRE_SOURCE_ID,
                filter: ["in", ["get", "state"], ["literal", ["burned", "embers", "active"]]],
                paint: {
                    "line-color": FIRE_COLORS.perimeter,
                    "line-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.65, 12, 0.78, 15, 0.88],
                    "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.4, 12, 2.6, 16, 4],
                    "line-blur": 0.4
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
    function resolveFireZones(frame, renderMode = DEFAULT_FIRE_RENDER_MODE) {
        const mode = normalizeRenderMode(renderMode);
        const empty = { type: "FeatureCollection", features: [] };
        if (!frame)
            return empty;
        const cells = Array.isArray(frame.cells) && frame.cells.length
            ? frame.cells
            : null;
        if (cells?.length) {
            const normalized = normalizeFrameCells(cells, frame.center, frame.cellKm);
            if (normalized.length) {
                return buildFireFeatureCollection(normalized, frame.center, mode, { cellKm: frame.cellKm ?? FIRE_GRID.cellKm });
            }
        }
        if (mode === FIRE_RENDER_MODES.GRID && frame.incidentSeed != null && frame.zones?.features?.length) {
            return frame.zones;
        }
        return frame.zones || empty;
    }
    function getFireRenderModeLabel(mode) {
        return normalizeRenderMode(mode) === FIRE_RENDER_MODES.GRID ? "Grille" : "Blob";
    }
    const api = {
        DEFAULT_FIRE_CENTER,
        DEFAULT_FIRE_RENDER_MODE,
        FIRE_COLORS,
        FIRE_GRID,
        FIRE_RENDER_MODES,
        FIRE_SOURCE_ID,
        IGNITION_SOURCE_ID,
        buildFireFeatureCollection,
        buildFireLayerDefinitions,
        buildFireLegendItems,
        buildFireSimulationFrame,
        buildFireSimulationFrameFromState,
        buildIgnitionFeatureCollection,
        classifyRenderedFuel,
        createFireSimulationState,
        createIdleFireSimulationState,
        createRenderedFuelOverrides,
        advanceFireSimulationState,
        getFireRenderModeLabel,
        localKmToLngLat,
        normalizeFrameCells,
        normalizeRenderMode,
        resetFireSimulationState,
        resolveFireZones
    };
    global.FireLogisticsFire = api;
    if (typeof module !== "undefined" && module.exports)
        module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
