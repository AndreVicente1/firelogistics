(function (global) {
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
    const canvas = document.getElementById("fire-effects") as HTMLCanvasElement | null;
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

  const api = { createFireParticleOverlay };
  global.FireLogisticsFireEffects = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
