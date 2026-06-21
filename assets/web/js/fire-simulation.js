"use strict";
(function (global) {
    const Model = typeof require !== "undefined"
        ? require("./fire-model.js")
        : global.FireLogisticsFireModel;
    const { BURN_SCAR_SOURCE_ID, DEFAULT_FIRE_CENTER, FIRE_COLORS, FIRE_GRID, FIRE_LEGEND_ITEMS, FIRE_SOURCE_ID, FUEL_BEHAVIOR, IGNITION_SOURCE_ID, WIND_MODEL, clamp, deterministicNoise, getCellLocalKm, localKmToLngLat, normalizeCenter, sampleScenarioFuel } = Model;
    const STATE = {
        UNBURNED: "unburned",
        HEAT: "heat",
        ACTIVE: "active",
        EMBERS: "embers",
        BURNED: "burned"
    };
    const RENDERED_FUEL_SAMPLE = {
        width: 65,
        height: 49,
        originX: -32,
        originY: -24
    };
    function cellKey(x, y) {
        return `${x},${y}`;
    }
    function createBurnScarStore() {
        return {
            cells: new Map(),
            pending: new Set(),
            reset: true,
            revision: 1
        };
    }
    function burnScarHas(store, x, y) {
        return Boolean(store?.cells?.has?.(cellKey(x, y)));
    }
    function addBurnScarCell(store, cell) {
        if (!store || !cell || !FUEL_BEHAVIOR[cell.fuel]?.burnable)
            return false;
        const key = cellKey(cell.x, cell.y);
        if (store.cells.has(key))
            return false;
        store.cells.set(key, { x: cell.x, y: cell.y, fuel: cell.fuel });
        store.pending.add(key);
        store.revision += 1;
        return true;
    }
    function buildBurnScarRuns(store, pendingOnly = false) {
        if (!store)
            return [];
        const sourceKeys = pendingOnly ? Array.from(store.pending) : Array.from(store.cells.keys());
        const rows = new Map();
        for (const key of sourceKeys) {
            const cell = store.cells.get(key);
            if (!cell)
                continue;
            const rowKey = `${cell.y}:${cell.fuel}`;
            if (!rows.has(rowKey))
                rows.set(rowKey, { y: cell.y, fuel: cell.fuel, xs: [] });
            rows.get(rowKey).xs.push(cell.x);
        }
        const runs = [];
        for (const row of rows.values()) {
            row.xs.sort((a, b) => a - b);
            let start = null;
            let previous = null;
            for (const x of row.xs) {
                if (start == null) {
                    start = x;
                    previous = x;
                    continue;
                }
                if (x === previous + 1) {
                    previous = x;
                    continue;
                }
                runs.push({ y: row.y, x1: start, x2: previous, fuel: row.fuel });
                start = x;
                previous = x;
            }
            if (start != null)
                runs.push({ y: row.y, x1: start, x2: previous, fuel: row.fuel });
        }
        return runs.sort((left, right) => left.y - right.y || left.x1 - right.x1 || String(left.fuel).localeCompare(String(right.fuel)));
    }
    function buildBurnScarPatch(store) {
        if (!store)
            return null;
        return {
            reset: Boolean(store.reset),
            revision: store.revision,
            cellKm: FIRE_GRID.cellKm,
            runs: buildBurnScarRuns(store, !store.reset)
        };
    }
    function markBurnScarPublished(store) {
        if (!store)
            return;
        store.reset = false;
        store.pending.clear();
    }
    function normalizeFuelOverrides(fuelOverrides) {
        const overrides = new Map();
        if (!fuelOverrides)
            return overrides;
        if (fuelOverrides instanceof Map) {
            for (const [key, fuel] of fuelOverrides) {
                if (FUEL_BEHAVIOR[fuel])
                    overrides.set(String(key), fuel);
            }
            return overrides;
        }
        const fuels = Array.isArray(fuelOverrides) ? fuelOverrides : fuelOverrides.fuels;
        if (Array.isArray(fuels)) {
            const width = Math.max(1, Number(fuelOverrides.width ?? RENDERED_FUEL_SAMPLE.width) || RENDERED_FUEL_SAMPLE.width);
            const height = Math.max(1, Number(fuelOverrides.height ?? Math.ceil(fuels.length / width)) || RENDERED_FUEL_SAMPLE.height);
            const originX = Number.isFinite(Number(fuelOverrides.originX)) ? Number(fuelOverrides.originX) : -Math.floor(width / 2);
            const originY = Number.isFinite(Number(fuelOverrides.originY)) ? Number(fuelOverrides.originY) : -Math.floor(height / 2);
            for (let index = 0; index < Math.min(fuels.length, width * height); index++) {
                const fuel = fuels[index];
                if (!FUEL_BEHAVIOR[fuel])
                    continue;
                overrides.set(cellKey(originX + (index % width), originY + Math.floor(index / width)), fuel);
            }
            return overrides;
        }
        if (typeof fuelOverrides === "object") {
            for (const [key, fuel] of Object.entries(fuelOverrides)) {
                const fuelName = String(fuel);
                if (FUEL_BEHAVIOR[fuelName])
                    overrides.set(key, fuelName);
            }
        }
        return overrides;
    }
    function sampleFuelForCell(x, y, fuelOverrides) {
        const override = fuelOverrides?.get?.(cellKey(x, y));
        if (override && FUEL_BEHAVIOR[override])
            return override;
        const local = getCellLocalKm(x, y);
        return sampleScenarioFuel(local.xKm, local.yKm);
    }
    function createFireCell(x, y, fuelOverrides) {
        const local = getCellLocalKm(x, y);
        const fuel = sampleFuelForCell(x, y, fuelOverrides);
        const behavior = FUEL_BEHAVIOR[fuel];
        return {
            x,
            y,
            ...local,
            fuel,
            state: STATE.UNBURNED,
            age: 0,
            heat: 0,
            fuelLoad: behavior.burnable ? 1 : 0,
            intensity: 0
        };
    }
    function getOrCreateCell(cells, x, y, fuelOverrides) {
        const key = cellKey(x, y);
        let cell = cells.get(key);
        if (!cell) {
            cell = createFireCell(x, y, fuelOverrides);
            cells.set(key, cell);
        }
        return cell;
    }
    function createSparseFireCell(x, y, fuelOverrides = null) {
        return getOrCreateCell(new Map(), Number(x), Number(y), normalizeFuelOverrides(fuelOverrides));
    }
    function cloneFireCells(cells) {
        return new Map(Array.from(cells, ([key, cell]) => [key, { ...cell }]));
    }
    function visibleFireCells(cells) {
        return Array.from(cells.values()).filter(cell => cell.state !== STATE.UNBURNED);
    }
    function createInitialFireCells(fuelOverrides, ignite = true) {
        const overrides = normalizeFuelOverrides(fuelOverrides);
        const cells = new Map();
        const radius = 2;
        for (let y = -radius; y <= radius; y++) {
            for (let x = -radius; x <= radius; x++) {
                const cell = getOrCreateCell(cells, x, y, overrides);
                const behavior = FUEL_BEHAVIOR[cell.fuel];
                const distanceToIgnition = Math.hypot(cell.xKm, cell.yKm);
                if (!ignite || !behavior.burnable || distanceToIgnition >= 0.34)
                    continue;
                cell.state = STATE.ACTIVE;
                cell.heat = 1;
                cell.intensity = behavior.flame;
            }
        }
        pruneFireCells(cells);
        return { cells, fuelOverrides: overrides };
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
    function applyHeatDiffusion(cells, next, fuelOverrides, burnScar, tick) {
        for (const source of Array.from(cells.values())) {
            if (source.state !== STATE.ACTIVE && source.state !== STATE.EMBERS)
                continue;
            const radius = source.state === STATE.ACTIVE ? 2 : 1;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (dx === 0 && dy === 0)
                        continue;
                    if (burnScarHas(burnScar, source.x + dx, source.y + dy))
                        continue;
                    const target = getOrCreateCell(cells, source.x + dx, source.y + dy, fuelOverrides);
                    const targetNext = getOrCreateCell(next, source.x + dx, source.y + dy, fuelOverrides);
                    if (target.state === STATE.BURNED || target.state === STATE.ACTIVE)
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
    function applySpotting(cells, next, fuelOverrides, burnScar, tick) {
        for (const source of Array.from(cells.values())) {
            const behavior = FUEL_BEHAVIOR[source.fuel];
            if (source.state !== STATE.ACTIVE || behavior.spotting <= 0)
                continue;
            const downwindX = Math.round(source.x + WIND_MODEL.vector[0] * (2 + behavior.spotting * 12));
            const downwindY = Math.round(source.y + WIND_MODEL.vector[1] * (1 + behavior.spotting * 6));
            if (burnScarHas(burnScar, downwindX, downwindY))
                continue;
            const candidate = getOrCreateCell(cells, downwindX, downwindY, fuelOverrides);
            const candidateNext = getOrCreateCell(next, downwindX, downwindY, fuelOverrides);
            if (candidate.state === STATE.ACTIVE || candidate.state === STATE.BURNED)
                continue;
            const targetBehavior = FUEL_BEHAVIOR[candidate.fuel];
            if (!targetBehavior.burnable)
                continue;
            const probability = behavior.spotting * source.intensity * (1 - targetBehavior.moisture) * 0.55;
            if (deterministicNoise(source.x + candidate.x, source.y + candidate.y, tick + 19) < probability) {
                candidateNext.heat = Math.max(candidateNext.heat, ignitionThreshold(candidate) + 0.04);
                candidateNext.state = STATE.HEAT;
            }
        }
    }
    function updateCombustionStates(next) {
        for (const cell of next.values()) {
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
    function pruneFireCells(cells, burnScar = null) {
        for (const [key, cell] of cells) {
            if (cell.state === STATE.UNBURNED) {
                cells.delete(key);
            }
            else if (cell.state === STATE.BURNED) {
                addBurnScarCell(burnScar, cell);
                cells.delete(key);
            }
        }
    }
    function liveCellTrimScore(cell) {
        if (cell.state === STATE.ACTIVE)
            return 100 + cell.intensity;
        if (cell.state === STATE.EMBERS)
            return 10 + cell.heat;
        if (cell.state === STATE.HEAT)
            return cell.heat;
        return Number.POSITIVE_INFINITY;
    }
    function trimLiveFireCells(cells) {
        if (cells.size <= MAX_LIVE_FIRE_CELLS)
            return;
        const ranked = Array.from(cells.entries())
            .sort(([, left], [, right]) => liveCellTrimScore(right) - liveCellTrimScore(left)
            || left.x - right.x
            || left.y - right.y)
            .slice(0, MAX_LIVE_FIRE_CELLS);
        cells.clear();
        for (const [key, cell] of ranked)
            cells.set(key, cell);
    }
    function advanceFireCells(cells, fuelOverrides, burnScar, tick) {
        const next = cloneFireCells(cells);
        applyHeatDiffusion(cells, next, fuelOverrides, burnScar, tick);
        applySpotting(cells, next, fuelOverrides, burnScar, tick);
        updateCombustionStates(next);
        pruneFireCells(next, burnScar);
        trimLiveFireCells(next);
        return next;
    }
    function simulateFireCells(step, fuelOverrides) {
        const maxStep = Math.max(0, Number(step) || 0);
        const initial = createInitialFireCells(fuelOverrides);
        const burnScar = createBurnScarStore();
        let cells = initial.cells;
        for (let tick = 1; tick <= maxStep; tick++) {
            cells = advanceFireCells(cells, initial.fuelOverrides, burnScar, tick);
        }
        return visibleFireCells(cells);
    }
    function createFireSimulationState(options = {}) {
        const center = normalizeCenter(options.center);
        const ignite = options.ignite !== false;
        const initial = createInitialFireCells(options.fuelOverrides ?? null, ignite);
        return {
            step: 0,
            center,
            fuelOverrides: initial.fuelOverrides,
            burnScar: createBurnScarStore(),
            cellMap: initial.cells,
            cells: visibleFireCells(initial.cells)
        };
    }
    function createIdleFireSimulationState(options = {}) {
        return createFireSimulationState({ ...options, ignite: false });
    }
    function resetFireSimulationState(state, options = {}) {
        state.step = 0;
        state.center = normalizeCenter(options.center ?? state.center);
        const ignite = options.ignite !== false;
        const initial = createInitialFireCells(options.fuelOverrides ?? null, ignite);
        state.fuelOverrides = initial.fuelOverrides;
        state.burnScar = createBurnScarStore();
        state.cellMap = initial.cells;
        state.cells = visibleFireCells(initial.cells);
        return state;
    }
    function advanceFireSimulationState(state, ticks = 1) {
        const count = Math.max(1, Number(ticks) || 1);
        for (let i = 0; i < count; i++) {
            state.step += 1;
            state.cellMap = advanceFireCells(state.cellMap, state.fuelOverrides, state.burnScar, state.step);
            state.cells = visibleFireCells(state.cellMap);
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
    const MAX_LIVE_FIRE_CELLS = 8000;
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
    function mergeBurnScarRunList(runs) {
        if (!Array.isArray(runs) || !runs.length)
            return [];
        const merged = [];
        const sorted = runs
            .map(run => ({
            y: Number(run.y),
            x1: Number(run.x1),
            x2: Number(run.x2),
            fuel: String(run.fuel ?? "unknown")
        }))
            .filter(run => Number.isFinite(run.y) && Number.isFinite(run.x1) && Number.isFinite(run.x2))
            .sort((left, right) => left.y - right.y || left.fuel.localeCompare(right.fuel) || left.x1 - right.x1);
        for (const run of sorted) {
            const previous = merged[merged.length - 1];
            if (previous && previous.y === run.y && previous.fuel === run.fuel && run.x1 <= previous.x2 + 1) {
                previous.x2 = Math.max(previous.x2, run.x2);
                continue;
            }
            merged.push({ ...run });
        }
        return merged;
    }
    function burnScarRunFeatureId(run) {
        return `burn-${run.y}-${run.x1}-${run.x2}-${run.fuel}`;
    }
    function buildBurnScarRunFeature(run, center, cellKm = FIRE_GRID.cellKm) {
        const y = Number(run.y);
        const x1 = Number(run.x1);
        const x2 = Number(run.x2);
        const fuel = String(run.fuel ?? "unknown");
        if (!Number.isFinite(y) || !Number.isFinite(x1) || !Number.isFinite(x2) || !center)
            return null;
        const runCells = [
            { x: x1, y, xKm: x1 * cellKm, yKm: y * cellKm },
            { x: x2, y, xKm: x2 * cellKm, yKm: y * cellKm }
        ];
        return {
            type: "Feature",
            properties: {
                id: burnScarRunFeatureId({ y, x1, x2, fuel }),
                state: STATE.BURNED,
                fuel,
                intensity: 0,
                cellCount: Math.max(0, x2 - x1 + 1)
            },
            geometry: {
                type: "Polygon",
                coordinates: [buildRunRing(center, runCells, cellKm)]
            }
        };
    }
    function buildBurnScarRunFeatures(runs, center, cellKm = FIRE_GRID.cellKm) {
        if (!Array.isArray(runs) || !runs.length || !center)
            return [];
        return runs
            .map(run => buildBurnScarRunFeature(run, center, cellKm))
            .filter(Boolean);
    }
    function buildBurnScarFeatureCollection(patch, center) {
        const cellKm = Number(patch?.cellKm) || FIRE_GRID.cellKm;
        const runs = patch?.runs?.length ? mergeBurnScarRunList(patch.runs) : [];
        return {
            type: "FeatureCollection",
            features: buildBurnScarRunFeatures(runs, center, cellKm)
        };
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
        const radii = Array.from({ length: pointCount }, () => FIRE_GRID.cellKm * 1.05);
        const fullCircle = Math.PI * 2;
        const binWidth = fullCircle / pointCount;
        const angularSplatRadius = 2;
        for (const cell of cells) {
            const dx = cell.xKm - centroid.xKm;
            const dy = cell.yKm - centroid.yKm;
            const distance = Math.hypot(dx, dy);
            if (distance <= 0)
                continue;
            const angle = (Math.atan2(dy, dx) + fullCircle) % fullCircle;
            const centerBin = Math.floor(angle / binWidth) % pointCount;
            for (let offset = -angularSplatRadius; offset <= angularSplatRadius; offset++) {
                const bin = (centerBin + offset + pointCount) % pointCount;
                const spreadPenalty = Math.abs(offset) * FIRE_GRID.cellKm * 0.28;
                const influence = distance + Math.max(0, FIRE_GRID.cellKm * 0.9 - spreadPenalty);
                radii[bin] = Math.max(radii[bin], influence);
            }
        }
        for (let i = 0; i < pointCount; i++) {
            const wobble = (deterministicNoise(i, cells.length, state.length) - 0.5) * FIRE_GRID.cellKm * 0.18;
            radii[i] = Math.max(FIRE_GRID.cellKm * 0.65, radii[i] + wobble);
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
        const byCoordinate = new Map(cells.map(cell => [cellKey(cell.x, cell.y), cell]));
        return cells.filter(cell => {
            if (cell.fuel !== "urban")
                return false;
            if (cell.state !== STATE.UNBURNED)
                return true;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const neighbor = byCoordinate.get(cellKey(cell.x + dx, cell.y + dy));
                    if (neighbor && (neighbor.state === STATE.ACTIVE || neighbor.state === STATE.EMBERS || neighbor.state === STATE.BURNED || neighbor.state === STATE.HEAT))
                        return true;
                }
            }
            return false;
        }).length;
    }
    function summarizeFireStats(cells, burnScar = null) {
        const affected = cells.filter(cell => cell.state === STATE.ACTIVE || cell.state === STATE.EMBERS);
        const active = cells.filter(cell => cell.state === STATE.ACTIVE);
        const cellHectares = FIRE_GRID.cellKm * FIRE_GRID.cellKm * 100;
        const fuelImpacts = Object.fromEntries(Object.keys(FUEL_BEHAVIOR).map(fuel => [fuel, 0]));
        for (const cell of affected)
            fuelImpacts[cell.fuel] += 1;
        const burnedCount = burnScar?.cells?.size ?? 0;
        if (burnScar?.cells) {
            for (const cell of burnScar.cells.values()) {
                fuelImpacts[cell.fuel] += 1;
            }
        }
        const avgIntensity = active.length ? active.reduce((sum, cell) => sum + cell.intensity, 0) / active.length : 0;
        return {
            burnedHectares: Math.round((affected.length + burnedCount) * cellHectares),
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
        const state = createFireSimulationState(options);
        if (tick > 0)
            advanceFireSimulationState(state, tick);
        return buildFireSimulationFrameFromState(state, options);
    }
    function buildFireSimulationFrameFromState(state, options = {}) {
        const center = normalizeCenter(state.center);
        const renderMode = normalizeRenderMode(options.renderMode);
        const renderCells = state.cells;
        const windSpeed = Math.round(WIND_MODEL.speedKmh + Math.sin(state.step * 0.18) * 5);
        return {
            step: state.step,
            center,
            cells: renderCells,
            zones: buildFireFeatureCollection(renderCells, center, renderMode),
            emitters: buildFireEmitters(renderCells, center),
            stats: summarizeFireStats(state.cells, state.burnScar),
            burnScar: buildBurnScarPatch(state.burnScar),
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
        const overrides = {
            originX: RENDERED_FUEL_SAMPLE.originX,
            originY: RENDERED_FUEL_SAMPLE.originY,
            width: RENDERED_FUEL_SAMPLE.width,
            height: RENDERED_FUEL_SAMPLE.height,
            cellKm: FIRE_GRID.cellKm,
            fuels: []
        };
        let resolved = 0;
        try {
            for (let y = 0; y < RENDERED_FUEL_SAMPLE.height; y++) {
                for (let x = 0; x < RENDERED_FUEL_SAMPLE.width; x++) {
                    const gridX = RENDERED_FUEL_SAMPLE.originX + x;
                    const gridY = RENDERED_FUEL_SAMPLE.originY + y;
                    const local = getCellLocalKm(gridX, gridY);
                    const lngLat = localKmToLngLat(center, local.xKm, local.yKm);
                    const point = map.project(lngLat);
                    const fuel = classifyRenderedFuel(map.queryRenderedFeatures(point, { layers: queryLayers }));
                    overrides.fuels.push(fuel);
                    if (fuel)
                        resolved += 1;
                }
            }
        }
        catch (error) {
            console.warn("[FireLogistics] Lecture des combustibles MapLibre indisponible", error);
            return null;
        }
        return resolved > RENDERED_FUEL_SAMPLE.width * RENDERED_FUEL_SAMPLE.height * 0.08 ? overrides : null;
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
                source: BURN_SCAR_SOURCE_ID,
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
        BURN_SCAR_SOURCE_ID,
        FIRE_COLORS,
        FIRE_GRID,
        FIRE_RENDER_MODES,
        FIRE_SOURCE_ID,
        IGNITION_SOURCE_ID,
        buildFireFeatureCollection,
        buildBurnScarFeatureCollection,
        buildBurnScarRunFeature,
        buildBurnScarRunFeatures,
        burnScarRunFeatureId,
        mergeBurnScarRunList,
        buildFireLayerDefinitions,
        buildFireLegendItems,
        buildFireSimulationFrame,
        buildFireSimulationFrameFromState,
        buildIgnitionFeatureCollection,
        classifyRenderedFuel,
        createFireSimulationState,
        createIdleFireSimulationState,
        createRenderedFuelOverrides,
        createSparseFireCell,
        advanceFireSimulationState,
        markBurnScarPublished,
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
