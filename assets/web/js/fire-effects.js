"use strict";
(function (global) {
    const SURFACE_COLORS = {
        heat: { fill: "rgba(255, 156, 47, 0.12)", stroke: "rgba(255, 190, 85, 0.18)", lineWidth: 2, blur: 7 },
        burned: { fill: "rgba(11, 9, 7, 0.68)", stroke: "rgba(255, 214, 163, 0.12)", lineWidth: 1.4, blur: 1 },
        embers: { fill: "rgba(130, 28, 8, 0.24)", stroke: "rgba(255, 138, 64, 0.2)", lineWidth: 2, blur: 4 },
        active: { fill: "rgba(255, 61, 0, 0.62)", stroke: "rgba(255, 178, 31, 0.82)", lineWidth: 6, blur: 11 }
    };
    function configureCanvas(canvas) {
        const context = canvas.getContext("2d");
        const state = { width: 0, height: 0 };
        function resize() {
            const ratio = global.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            state.width = Math.max(1, Math.floor(rect.width));
            state.height = Math.max(1, Math.floor(rect.height));
            canvas.width = Math.floor(state.width * ratio);
            canvas.height = Math.floor(state.height * ratio);
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
        resize();
        return { context, resize, state };
    }
    function forEachPolygon(feature, callback) {
        const geometry = feature?.geometry;
        if (!geometry?.coordinates)
            return;
        if (geometry.type === "Polygon") {
            callback(geometry.coordinates);
            return;
        }
        if (geometry.type === "MultiPolygon") {
            for (const polygon of geometry.coordinates)
                callback(polygon);
        }
    }
    function createSurfaceBuffer(state) {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        function syncSize() {
            const ratio = global.devicePixelRatio || 1;
            const width = Math.max(1, Math.floor(state.width * ratio));
            const height = Math.max(1, Math.floor(state.height * ratio));
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
        syncSize();
        return { canvas, context, syncSize };
    }
    function hashStableNumber(value) {
        const text = String(Math.round(value * 10000));
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }
    function collectSurfaceRects(map, features) {
        const rects = [];
        for (const feature of features) {
            forEachPolygon(feature, polygon => {
                const ring = polygon?.[0];
                if (!ring || ring.length < 4)
                    return;
                const points = ring.map(lngLat => map.project(lngLat));
                const xs = points.map(point => point.x);
                const ys = points.map(point => point.y);
                const minX = Math.min(...xs);
                const maxX = Math.max(...xs);
                const minY = Math.min(...ys);
                const maxY = Math.max(...ys);
                const width = maxX - minX;
                const height = maxY - minY;
                if (width <= 0 || height <= 0)
                    return;
                const geoSeed = ring.reduce((seed, lngLat) => {
                    return (seed ^ hashStableNumber(lngLat[0] * 31 + lngLat[1] * 17)) >>> 0;
                }, 0);
                rects.push({
                    minX,
                    maxX,
                    minY,
                    maxY,
                    width,
                    height,
                    cx: (minX + maxX) * 0.5,
                    cy: (minY + maxY) * 0.5,
                    area: Math.max(1, width * height),
                    seed: geoSeed
                });
            });
        }
        return rects;
    }
    function median(values) {
        if (!values.length)
            return 1;
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length * 0.5)];
    }
    function rectsTouch(a, b, tolerance) {
        return a.minX <= b.maxX + tolerance
            && a.maxX + tolerance >= b.minX
            && a.minY <= b.maxY + tolerance
            && a.maxY + tolerance >= b.minY;
    }
    function groupSurfaceRects(rects) {
        if (!rects.length)
            return [];
        const tolerance = Math.max(2, median(rects.map(rect => Math.min(rect.width, rect.height))) * 0.38);
        const parents = rects.map((_, index) => index);
        function find(index) {
            while (parents[index] !== index) {
                parents[index] = parents[parents[index]];
                index = parents[index];
            }
            return index;
        }
        function union(a, b) {
            const rootA = find(a);
            const rootB = find(b);
            if (rootA !== rootB)
                parents[rootB] = rootA;
        }
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                if (rectsTouch(rects[i], rects[j], tolerance))
                    union(i, j);
            }
        }
        const groups = new Map();
        for (let i = 0; i < rects.length; i++) {
            const root = find(i);
            if (!groups.has(root))
                groups.set(root, []);
            groups.get(root).push(rects[i]);
        }
        return [...groups.values()];
    }
    function intersectRayWithRect(cx, cy, ux, uy, rect, padding) {
        const minX = rect.minX - padding;
        const maxX = rect.maxX + padding;
        const minY = rect.minY - padding;
        const maxY = rect.maxY + padding;
        let tMin = -Infinity;
        let tMax = Infinity;
        if (Math.abs(ux) < 0.000001) {
            if (cx < minX || cx > maxX)
                return null;
        }
        else {
            const tx1 = (minX - cx) / ux;
            const tx2 = (maxX - cx) / ux;
            tMin = Math.max(tMin, Math.min(tx1, tx2));
            tMax = Math.min(tMax, Math.max(tx1, tx2));
        }
        if (Math.abs(uy) < 0.000001) {
            if (cy < minY || cy > maxY)
                return null;
        }
        else {
            const ty1 = (minY - cy) / uy;
            const ty2 = (maxY - cy) / uy;
            tMin = Math.max(tMin, Math.min(ty1, ty2));
            tMax = Math.min(tMax, Math.max(ty1, ty2));
        }
        if (tMax < Math.max(0, tMin))
            return null;
        return tMax;
    }
    function supportDistance(cx, cy, ux, uy, rect, padding) {
        const corners = [
            [rect.minX - padding, rect.minY - padding],
            [rect.maxX + padding, rect.minY - padding],
            [rect.maxX + padding, rect.maxY + padding],
            [rect.minX - padding, rect.maxY + padding]
        ];
        return Math.max(...corners.map(([x, y]) => (x - cx) * ux + (y - cy) * uy));
    }
    function buildSurfaceBlobs(map, features, stateName) {
        const rects = collectSurfaceRects(map, features);
        const groups = groupSurfaceRects(rects);
        const blobs = [];
        const paddingScale = stateName === "heat" ? 0.92 : stateName === "active" ? 0.7 : stateName === "burned" ? 0.48 : 0.58;
        for (const group of groups) {
            const area = group.reduce((sum, rect) => sum + rect.area, 0);
            const cx = group.reduce((sum, rect) => sum + rect.cx * rect.area, 0) / area;
            const cy = group.reduce((sum, rect) => sum + rect.cy * rect.area, 0) / area;
            const cellSpan = median(group.map(rect => Math.min(rect.width, rect.height)));
            const padding = Math.max(3, cellSpan * paddingScale);
            const sampleCount = stateName === "active" ? 112 : stateName === "heat" ? 96 : 80;
            const seed = group.reduce((value, rect) => (value ^ rect.seed) >>> 0, 0);
            const radii = [];
            for (let i = 0; i < sampleCount; i++) {
                const angle = (Math.PI * 2 * i) / sampleCount;
                const ux = Math.cos(angle);
                const uy = Math.sin(angle);
                let distance = 0;
                for (const rect of group) {
                    const intersection = intersectRayWithRect(cx, cy, ux, uy, rect, padding);
                    if (intersection !== null)
                        distance = Math.max(distance, intersection);
                }
                if (distance <= 0) {
                    for (const rect of group)
                        distance = Math.max(distance, supportDistance(cx, cy, ux, uy, rect, padding));
                }
                const phase = (seed % 997) * 0.017;
                const organic = 1
                    + Math.sin(angle * 3 + phase) * 0.035
                    + Math.sin(angle * 7 + phase * 0.7) * 0.018;
                radii.push(Math.max(2, distance * organic));
            }
            for (let pass = 0; pass < 3; pass++) {
                const copy = [...radii];
                for (let i = 0; i < radii.length; i++) {
                    const previous = copy[(i - 1 + copy.length) % copy.length];
                    const next = copy[(i + 1) % copy.length];
                    radii[i] = previous * 0.24 + copy[i] * 0.52 + next * 0.24;
                }
            }
            blobs.push({
                cx,
                cy,
                points: radii.map((radius, index) => {
                    const angle = (Math.PI * 2 * index) / radii.length;
                    return {
                        x: cx + Math.cos(angle) * radius,
                        y: cy + Math.sin(angle) * radius
                    };
                })
            });
        }
        return blobs;
    }
    function traceBlobPath(context, blob, grow) {
        const points = blob.points.map(point => ({
            x: blob.cx + (point.x - blob.cx) * grow,
            y: blob.cy + (point.y - blob.cy) * grow
        }));
        if (points.length < 3)
            return;
        const first = points[0];
        const last = points[points.length - 1];
        context.moveTo((last.x + first.x) * 0.5, (last.y + first.y) * 0.5);
        for (let i = 0; i < points.length; i++) {
            const current = points[i];
            const next = points[(i + 1) % points.length];
            context.quadraticCurveTo(current.x, current.y, (current.x + next.x) * 0.5, (current.y + next.y) * 0.5);
        }
    }
    function drawBlobSet(context, blobs, style, stateName) {
        if (!blobs.length)
            return false;
        const passes = stateName === "active"
            ? [
                { alpha: 0.32, grow: 1.75, blur: style.blur + 8, fill: "rgba(255, 154, 31, 0.32)" },
                { alpha: 1, grow: 1, blur: style.blur, fill: style.fill }
            ]
            : [
                { alpha: 1, grow: 1, blur: style.blur, fill: style.fill }
            ];
        for (const pass of passes) {
            context.save();
            context.fillStyle = pass.fill;
            context.globalAlpha = pass.alpha;
            context.shadowColor = stateName === "burned" ? "rgba(0, 0, 0, 0)" : style.stroke;
            context.shadowBlur = pass.blur;
            context.beginPath();
            for (const blob of blobs)
                traceBlobPath(context, blob, pass.grow);
            context.fill();
            context.restore();
        }
        if (stateName !== "burned") {
            context.save();
            context.strokeStyle = style.stroke;
            context.lineWidth = style.lineWidth;
            context.globalAlpha = stateName === "active" ? 0.78 : 0.34;
            context.beginPath();
            for (const blob of blobs)
                traceBlobPath(context, blob, 1.06);
            context.stroke();
            context.restore();
        }
        return true;
    }
    function createFireSurfaceOverlay(map, getFrame) {
        const canvas = document.getElementById("fire-surfaces");
        if (!canvas || !canvas.getContext || !global.requestAnimationFrame)
            return null;
        const { context, resize, state } = configureCanvas(canvas);
        const buffer = createSurfaceBuffer(state);
        let lastIncidentSeed = null;
        let renderScheduled = false;
        function clear() {
            context.clearRect(0, 0, state.width, state.height);
            buffer.context.clearRect(0, 0, state.width, state.height);
            lastIncidentSeed = null;
        }
        function drawFrame(frame) {
            buffer.syncSize();
            buffer.context.clearRect(0, 0, state.width, state.height);
            if (!frame?.zones?.features?.length) {
                context.clearRect(0, 0, state.width, state.height);
                return;
            }
            if (lastIncidentSeed !== null && frame.incidentSeed !== lastIncidentSeed)
                clear();
            lastIncidentSeed = frame.incidentSeed;
            for (const stateName of ["heat", "burned", "embers", "active"]) {
                const style = SURFACE_COLORS[stateName];
                const features = frame.zones.features.filter(feature => feature.properties?.state === stateName);
                if (!features.length)
                    continue;
                drawSurfaceBlobGroup(buffer.context, map, features, style, stateName);
            }
            context.clearRect(0, 0, state.width, state.height);
            context.drawImage(buffer.canvas, 0, 0, state.width, state.height);
        }
        function drawSurfaceBlobGroup(context, map, features, style, stateName) {
            return drawBlobSet(context, buildSurfaceBlobs(map, features, stateName), style, stateName);
        }
        function render() {
            drawFrame(getFrame());
        }
        function requestRender() {
            if (renderScheduled)
                return;
            renderScheduled = true;
            global.requestAnimationFrame(() => {
                renderScheduled = false;
                render();
            });
        }
        global.addEventListener("resize", () => {
            resize();
            requestRender();
        });
        map.on("resize", () => {
            resize();
            requestRender();
        });
        map.on("move", requestRender);
        requestRender();
        return { resize, clear, render, requestRender };
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
        if (!canvas || !canvas.getContext || !global.requestAnimationFrame)
            return null;
        const { context, resize, state } = configureCanvas(canvas);
        const particles = [];
        let lastTime = performance.now();
        let lastIncidentSeed = null;
        function spawn(frame) {
            if (!frame || !isRunning() || particles.length > 440)
                return;
            if (lastIncidentSeed !== null && frame.incidentSeed !== lastIncidentSeed) {
                clear();
            }
            lastIncidentSeed = frame.incidentSeed;
            for (const emitter of frame.emitters) {
                if (Math.random() > 0.54)
                    continue;
                const point = map.project(emitter.lngLat);
                if (point.x < -80 || point.y < -80 || point.x > state.width + 80 || point.y > state.height + 80)
                    continue;
                particles.push(createParticle("smoke", point, emitter.intensity));
                if (Math.random() > 0.22)
                    particles.push(createParticle(emitter.type, point, emitter.intensity));
            }
        }
        function clear() {
            particles.length = 0;
            context.clearRect(0, 0, state.width, state.height);
            lastIncidentSeed = null;
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
            if (!isRunning() && particles.length === 0) {
                global.requestAnimationFrame(loop);
                return;
            }
            context.clearRect(0, 0, state.width, state.height);
            spawn(getFrame());
            for (let i = particles.length - 1; i >= 0; i--) {
                const particle = particles[i];
                drawParticle(particle, delta);
                if (particle.age >= particle.life)
                    particles.splice(i, 1);
            }
            global.requestAnimationFrame(loop);
        }
        global.addEventListener("resize", resize);
        map.on("resize", resize);
        global.requestAnimationFrame(loop);
        return {
            resize,
            clear,
            getParticleCount() {
                return particles.length;
            }
        };
    }
    const api = { buildSurfaceBlobs, createFireParticleOverlay, createFireSurfaceOverlay };
    global.FireLogisticsFireEffects = api;
    if (typeof module !== "undefined" && module.exports)
        module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
