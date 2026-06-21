// Contact page line field. The page is fully readable without this script; this
// only adds the pointer-reactive distortion behind the resume content.

const reduceMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const canvas = document.querySelector("[data-contact-net]");
const ctx = canvas?.getContext("2d", { alpha: true });
const root = document.documentElement;

const MAX_DPR = 1.45;
const SPACING = 68;
const TRAIL_LIMIT = 8;
const POKE_MS = 54;
const POKE_DISTANCE = 20;
const ARRIVAL_CLEANUP_MS = 1600;
const ROUTE_NAVIGATE_AT_MS = 900;

let raf = 0;
let running = false;
let w = 1;
let h = 1;
let dpr = 1;
let time = 0;
let trails = [];
let lastPoke = { x: -9999, y: -9999, t: 0 };

if (root.classList.contains("is-contact-arriving")) {
  window.setTimeout(() => {
    root.classList.remove("is-contact-arriving");
  }, ARRIVAL_CLEANUP_MS);
}

function initRouteTransitions() {
  const links = Array.from(document.querySelectorAll('a[href="index.html"], a[href="index.html#projects"]'));
  let navTimer = 0;

  function onRouteClick(event) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    const link = event.currentTarget;
    if (!link || link.target) return;

    event.preventDefault();
    window.clearTimeout(navTimer);

    if (reduceMotion()) {
      window.location.href = link.href;
      return;
    }

    try {
      window.sessionStorage.setItem("indexTransition", "inbound");
    } catch (_) {
      /* Navigation still works without sessionStorage. */
    }

    root.classList.add("is-contact-leaving");
    navTimer = window.setTimeout(() => {
      window.location.href = link.href;
    }, ROUTE_NAVIGATE_AT_MS);
  }

  for (const link of links) {
    link.addEventListener("click", onRouteClick);
  }
}

initRouteTransitions();

function setPointerVars(clientX, clientY) {
  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);
  const nx = clientX / vw - 0.5;
  const ny = clientY / vh - 0.5;
  root.style.setProperty("--contact-grid-x", `${nx * -24}px`);
  root.style.setProperty("--contact-grid-y", `${ny * -24}px`);
  root.style.setProperty("--contact-glow-x", `${clientX}px`);
  root.style.setProperty("--contact-glow-y", `${clientY}px`);
}

function resize() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  w = Math.max(1, Math.round(rect.width * dpr));
  h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function poke(clientX, clientY) {
  if (!canvas || reduceMotion()) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const now = performance.now();
  const dx = clientX - lastPoke.x;
  const dy = clientY - lastPoke.y;
  if (now - lastPoke.t < POKE_MS && Math.hypot(dx, dy) < POKE_DISTANCE) return;

  lastPoke = { x: clientX, y: clientY, t: now };
  trails.push({
    x: (clientX - rect.left) * dpr,
    y: (clientY - rect.top) * dpr,
    life: 1,
    seed: Math.random() * 1000,
  });
  if (trails.length > TRAIL_LIMIT) trails = trails.slice(-TRAIL_LIMIT);
}

function influenceAt(x, y) {
  let total = 0;
  for (const trail of trails) {
    const dx = x - trail.x;
    const dy = y - trail.y;
    const radius = 230 * dpr;
    const falloff = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / radius);
    total += falloff * falloff * trail.life;
  }
  return Math.min(1, total);
}

function drawField(ts = 0) {
  if (!ctx) return;
  time = ts;
  ctx.clearRect(0, 0, w, h);

  const spacing = SPACING * dpr;
  const cols = Math.ceil(w / spacing) + 2;
  const rows = Math.ceil(h / spacing) + 2;

  for (let row = 0; row < rows; row++) {
    ctx.beginPath();
    for (let col = 0; col < cols; col++) {
      const x = (col - 0.5) * spacing;
      const y = (row - 0.5) * spacing;
      const inf = influenceAt(x, y);
      const idle = Math.sin(time * 0.0009 + col * 0.42 + row * 0.74) * 2.6 * dpr;
      const drift = Math.sin(time * 0.0021 + col * 1.4) * 18 * dpr * inf;
      const px = x + idle + drift;
      const py = y + Math.cos(time * 0.0017 + row * 0.9) * 8 * dpr * inf;
      if (col === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    const alpha = 0.06 + 0.14 * influenceAt(w * 0.52, (row - 0.5) * spacing);
    ctx.strokeStyle = `rgba(94, 242, 214, ${alpha})`;
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
  }

  for (let col = 0; col < cols; col++) {
    ctx.beginPath();
    for (let row = 0; row < rows; row++) {
      const x = (col - 0.5) * spacing;
      const y = (row - 0.5) * spacing;
      const inf = influenceAt(x, y);
      const px = x + Math.sin(time * 0.0015 + row * 1.1) * 12 * dpr * inf;
      const py = y + Math.cos(time * 0.0008 + col * 0.6) * 2.2 * dpr;
      if (row === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    const alpha = 0.045 + 0.12 * influenceAt((col - 0.5) * spacing, h * 0.46);
    ctx.strokeStyle = `rgba(255, 79, 154, ${alpha})`;
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
  }

  for (const trail of trails) {
    const alpha = trail.life;
    const haze = ctx.createRadialGradient(trail.x, trail.y, 0, trail.x, trail.y, 230 * dpr * alpha);
    haze.addColorStop(0, `rgba(94, 242, 214, ${0.16 * alpha})`);
    haze.addColorStop(0.48, `rgba(255, 79, 154, ${0.08 * alpha})`);
    haze.addColorStop(1, "rgba(5, 6, 10, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(trail.x - 250 * dpr, trail.y - 250 * dpr, 500 * dpr, 500 * dpr);

    const burst = 20 * dpr * alpha;
    for (let i = 0; i < 4; i++) {
      const x = trail.x + Math.sin(trail.seed + i * 1.8 + time * 0.006) * burst;
      const y = trail.y + Math.cos(trail.seed + i * 1.2 + time * 0.007) * burst * 0.7;
      ctx.fillStyle = i % 2
        ? `rgba(255, 79, 154, ${0.28 * alpha})`
        : `rgba(94, 242, 214, ${0.32 * alpha})`;
      ctx.fillRect(x, y, (18 + i * 5) * dpr * alpha, Math.max(1, 1.4 * dpr));
    }
  }

  trails = trails
    .map((trail) => ({ ...trail, life: trail.life * 0.92 }))
    .filter((trail) => trail.life > 0.025);

  if (running) raf = window.requestAnimationFrame(drawField);
}

function start() {
  if (running || reduceMotion()) return;
  running = true;
  resize();
  raf = window.requestAnimationFrame(drawField);
}

function stop() {
  running = false;
  if (raf) {
    window.cancelAnimationFrame(raf);
    raf = 0;
  }
}

function onPointerMove(event) {
  setPointerVars(event.clientX, event.clientY);
  poke(event.clientX, event.clientY);
}

function onResize() {
  resize();
  if (!running) drawField(0);
}

function onVisibilityChange() {
  if (document.hidden) stop();
  else start();
}

if (canvas && ctx) {
  resize();
  drawField(0);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibilityChange);
  start();
}
