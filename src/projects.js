// ============================================================================
// projects.js - project dimension + inline preview controller
//
// The Projects CTA is no longer a plain jump. With JS, it opens a fixed project
// layer through a slow white flash, renders the project index, runs a lightweight
// pointer-reactive glitch net behind it, and previews a selected project in an
// inline iframe plane. Without JS, #projects remains a normal anchor.
// ============================================================================

const PROJECTS = [
  {
    id: "brain-dump",
    title: "Brain Dump",
    kind: "AI SDLC system",
    description: "Provider-agnostic software delivery workflow for agent work: epics, tickets, criteria, telemetry, reviews, demos, and project memory.",
    tags: ["SDLC", "Agents", "MCP"],
    accent: "#008096",
    repoUrl: "https://github.com/salmanrrana/brain-dump",
  },
  {
    id: "maa-faa-notes",
    title: "Maa-Faa Notes",
    kind: "Agent-aware notes",
    description: "Daily capture and shared notes that let AI read context, record its contributions, and turn loose thoughts into Brain Dump work.",
    tags: ["Notes", "Memory", "Agents"],
    accent: "#d20060",
    liveUrl: "https://maa-faa-notes.lakebed.app/",
    previewUrl: "https://maa-faa-notes.lakebed.app/",
    repoUrl: "https://github.com/salmanrrana/maa-faa-notes",
  },
  {
    id: "update-clankers",
    title: "Update Clankers",
    kind: "Provider skill",
    description: "A one-command skill that detects installed AI coding CLIs across providers and updates Claude, Cursor Agent, OpenCode, Codex, and Pi in parallel.",
    tags: ["Providers", "Agents", "CLI"],
    accent: "#6d46ff",
    repoUrl: "https://github.com/salmanrrana/update-clankers",
  },
  {
    id: "openbeats",
    title: "OpenBeats",
    kind: "Music interface",
    description: "A music-focused web project for exploring playback, browsing, and expressive UI states.",
    tags: ["Audio", "UI", "Web"],
    accent: "#f0b900",
    liveUrl: "https://openb3ats.netlify.app/",
    previewUrl: "https://openb3ats.netlify.app/",
    repoUrl: "https://github.com/salmanrrana/openbeats",
  },
  {
    id: "8-bit-satoshi",
    title: "8-bit Satoshi",
    kind: "Retro web experiment",
    description: "A pixel-flavored Bitcoin project where the interface leans into arcade energy and motion.",
    tags: ["Game", "Bitcoin", "Canvas"],
    accent: "#12a357",
    liveUrl: "https://eight-bit-satoshi.netlify.app/",
    previewUrl: "https://eight-bit-satoshi.netlify.app/",
    repoUrl: "https://github.com/salmanrrana/8-bit-satoshi",
  },
  {
    id: "scriptbook",
    title: "Scriptbook",
    kind: "Course build",
    description: "A notebook-style JavaScript runtime built while following Stephen Grider's course and digging into bundling, transpilation, and execution flow.",
    tags: ["React", "Bundling", "Learning"],
    accent: "#5d5fea",
    repoUrl: "https://github.com/salmanrrana/scriptbook",
  },
  {
    id: "kids-meal",
    title: "Kids-Meal",
    kind: "Family utility",
    description: "A practical app concept shaped around food choices, small decisions, and parent-friendly speed.",
    tags: ["Product", "UX", "Utility"],
    accent: "#eb6f38",
    liveUrl: "https://kids-meal.netlify.app/",
    previewUrl: "https://kids-meal.netlify.app/",
    repoUrl: "https://github.com/salmanrrana/kids-meal",
  },
];

const GITHUB_URL = "https://github.com/salmanrrana";
const FLASH_MS = 1400;
const FLASH_OPEN_AT_MS = 620;
const PREVIEW_FRAME_DELAY_MS = 240;
const PREVIEW_SWAP_MS = 220;
const PREVIEW_LOAD_TIMEOUT_MS = 10000;
const PROJECT_LAYOUT_MS = 860;
const NET_MAX_DPR = 1.35;
const NET_SPACING = 74;
const NET_TRAIL_LIMIT = 7;
const NET_POKE_MS = 48;
const NET_POKE_DISTANCE = 18;

const reduceMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function renderPreviewDoc(project) {
  const tags = project.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  const repo = escapeHtml(project.repoUrl || GITHUB_URL);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
        background: #ffffff;
        color: #05060a;
        --accent: ${project.accent};
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        overflow: hidden;
        background:
          linear-gradient(90deg, rgba(5, 6, 10, 0.045) 1px, transparent 1px),
          linear-gradient(180deg, rgba(5, 6, 10, 0.045) 1px, transparent 1px),
          radial-gradient(circle at 20% 22%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 26rem),
          #ffffff;
        background-size: 54px 54px, 54px 54px, auto, auto;
      }
      main {
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto 1fr auto;
        padding: clamp(1.2rem, 4vw, 4rem);
      }
      p, h1 { margin: 0; }
      .bar {
        display: flex;
        align-items: center;
        gap: 0.42rem;
        color: rgba(5, 6, 10, 0.54);
        font: 0.78rem ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .dot {
        width: 0.62rem;
        height: 0.62rem;
        border-radius: 999px;
        background: var(--accent);
      }
      .hero {
        align-self: center;
        width: min(760px, 100%);
      }
      .kind {
        margin-bottom: 1rem;
        color: color-mix(in srgb, var(--accent) 72%, #05060a);
        font: 0.82rem ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      h1 {
        font-size: clamp(3rem, 12vw, 7rem);
        line-height: 0.95;
        letter-spacing: 0;
        text-wrap: balance;
      }
      .desc {
        max-width: 44rem;
        margin-top: 1.1rem;
        color: rgba(5, 6, 10, 0.74);
        font-size: clamp(1rem, 2.2vw, 1.22rem);
        line-height: 1.55;
      }
      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        margin-top: 2rem;
      }
      .tags span {
        padding: 0.35rem 0.58rem;
        border: 1px solid rgba(5, 6, 10, 0.2);
        border-radius: 999px;
        color: rgba(5, 6, 10, 0.72);
        font: 0.78rem ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .repo {
        align-self: end;
        color: rgba(5, 6, 10, 0.55);
        font: 0.78rem ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (max-width: 640px) {
        body { overflow: auto; }
        main { min-height: 100vh; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="bar" aria-hidden="true">
        <span class="dot"></span>
        <span>inline project preview</span>
      </div>
      <section class="hero" aria-label="${escapeHtml(project.title)} preview summary">
        <p class="kind">${escapeHtml(project.kind)}</p>
        <h1>${escapeHtml(project.title)}</h1>
        <p class="desc">${escapeHtml(project.description)}</p>
        <div class="tags">${tags}</div>
      </section>
      <p class="repo">${repo}</p>
    </main>
  </body>
</html>`;
}

function renderProjectRows(grid) {
  const frag = document.createDocumentFragment();
  PROJECTS.forEach((project, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-row";
    button.dataset.projectId = project.id;
    button.style.setProperty("--project-accent", project.accent);
    button.setAttribute("aria-label", `Preview ${project.title}`);
    button.innerHTML = `
      <span class="project-row__number">${String(index + 1).padStart(2, "0")}</span>
      <span class="project-row__body">
        <span class="project-row__kind">${escapeHtml(project.kind)}</span>
        <span class="project-row__title">${escapeHtml(project.title)}</span>
        <span class="project-row__description">${escapeHtml(project.description)}</span>
      </span>
      <span class="project-row__tags" aria-label="${escapeHtml(project.title)} tags">
        ${project.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
      </span>
      <span class="project-row__action">Inspect</span>
    `;
    frag.appendChild(button);
  });
  grid.replaceChildren(frag);
}

function focusFirstRow(grid) {
  const first = grid.querySelector(".project-row");
  if (first) first.focus({ preventScroll: true });
}

function initGlitchNet(canvas) {
  if (!canvas || reduceMotion()) {
    return {
      start() {},
      stop() {},
      poke() {},
      resize() {},
    };
  }

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    return {
      start() {},
      stop() {},
      poke() {},
      resize() {},
    };
  }

  let raf = 0;
  let running = false;
  let w = 1;
  let h = 1;
  let dpr = 1;
  let trails = [];
  let time = 0;
  let lastPoke = { x: -9999, y: -9999, t: 0 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, NET_MAX_DPR);
    w = Math.max(1, Math.round(rect.width * dpr));
    h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function poke(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const now = performance.now();
    const dx = clientX - lastPoke.x;
    const dy = clientY - lastPoke.y;
    if (now - lastPoke.t < NET_POKE_MS && Math.hypot(dx, dy) < NET_POKE_DISTANCE) {
      return;
    }
    lastPoke = { x: clientX, y: clientY, t: now };
    trails.push({
      x: (clientX - rect.left) * dpr,
      y: (clientY - rect.top) * dpr,
      life: 1,
      seed: Math.random() * 1000,
    });
    if (trails.length > NET_TRAIL_LIMIT) trails = trails.slice(-NET_TRAIL_LIMIT);
  }

  function influenceAt(x, y) {
    let total = 0;
    for (const trail of trails) {
      const dx = x - trail.x;
      const dy = y - trail.y;
      const radius = 190 * dpr;
      const falloff = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / radius);
      total += falloff * falloff * trail.life;
    }
    return Math.min(1, total);
  }

  function drawNet() {
    const spacing = NET_SPACING * dpr;
    const cols = Math.ceil(w / spacing) + 2;
    const rows = Math.ceil(h / spacing) + 2;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    for (let row = 0; row < rows; row++) {
      ctx.beginPath();
      for (let col = 0; col < cols; col++) {
        const x = (col - 0.5) * spacing;
        const y = (row - 0.5) * spacing;
        const inf = influenceAt(x, y);
        const wiggle =
          Math.sin(time * 0.0017 + col * 0.9 + row * 0.34) * 3 * dpr +
          Math.sin(time * 0.003 + row * 1.7) * 8 * dpr * inf;
        const px = x + wiggle * (0.3 + inf);
        const py = y + Math.cos(time * 0.002 + col * 1.1) * 6 * dpr * inf;
        if (col === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      const alpha = 0.05 + 0.1 * influenceAt(w * 0.5, (row - 0.5) * spacing);
      ctx.strokeStyle = `rgba(0, 128, 150, ${alpha})`;
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();
    }

    for (let col = 0; col < cols; col++) {
      ctx.beginPath();
      for (let row = 0; row < rows; row++) {
        const x = (col - 0.5) * spacing;
        const y = (row - 0.5) * spacing;
        const inf = influenceAt(x, y);
        const px = x + Math.sin(time * 0.002 + row * 0.85) * 9 * dpr * inf;
        const py = y + Math.cos(time * 0.0015 + col * 0.65) * 3 * dpr;
        if (row === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      const alpha = 0.018 + 0.035 * influenceAt((col - 0.5) * spacing, h * 0.5);
      ctx.strokeStyle = `rgba(210, 0, 96, ${alpha})`;
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();
    }

    for (const trail of trails) {
      const alpha = trail.life;
      const haze = ctx.createRadialGradient(trail.x, trail.y, 0, trail.x, trail.y, 170 * dpr * alpha);
      haze.addColorStop(0, `rgba(0, 128, 150, ${0.08 * alpha})`);
      haze.addColorStop(0.55, `rgba(210, 0, 96, ${0.018 * alpha})`);
      haze.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = haze;
      ctx.fillRect(trail.x - 180 * dpr, trail.y - 180 * dpr, 360 * dpr, 360 * dpr);

      const burst = 16 * dpr * alpha;
      for (let i = 0; i < 3; i++) {
        const x = trail.x + Math.sin(trail.seed + i * 1.7 + time * 0.006) * burst * (1 + i * 0.1);
        const y = trail.y + Math.cos(trail.seed + i * 1.1 + time * 0.007) * burst * (0.7 + i * 0.08);
        ctx.fillStyle = i % 2 ? `rgba(210, 0, 96, ${0.055 * alpha})` : `rgba(0, 128, 150, ${0.16 * alpha})`;
        ctx.fillRect(x, y, (10 + i * 4) * dpr * alpha, Math.max(1, 1.4 * dpr));
      }
    }

    trails = trails
      .map((trail) => ({ ...trail, life: trail.life * 0.91 }))
      .filter((trail) => trail.life > 0.025);
  }

  function tick(ts) {
    if (!running) return;
    time = ts;
    drawNet();
    raf = window.requestAnimationFrame(tick);
  }

  return {
    start() {
      if (running) return;
      resize();
      running = true;
      raf = window.requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
      ctx.clearRect(0, 0, w, h);
      trails = [];
    },
    poke,
    resize,
  };
}

/**
 * @param {Object} opts
 * @param {Document} [opts.root=document]
 * @param {boolean} [opts.debug=false]
 */
export function initProjects({ root = document, debug = false } = {}) {
  const section = root.querySelector("[data-project-space]");
  const grid = root.querySelector("[data-project-grid]");
  const preview = root.querySelector("[data-project-preview]");
  const frame = root.querySelector("[data-project-preview-frame]");
  const previewTitle = root.querySelector("[data-project-preview-title]");
  const previewKind = root.querySelector("[data-project-preview-kind]");
  const previewDescription = root.querySelector("[data-project-preview-description]");
  const previewOpen = root.querySelector("[data-project-preview-open]");
  const previewClose = root.querySelector("[data-project-preview-close]");
  const previewLoader = root.querySelector("[data-project-preview-loader]");
  const projectHomeButtons = Array.from(root.querySelectorAll("[data-project-home]"));
  const netCanvas = root.querySelector("[data-project-glitch-net]");
  const projectLinks = Array.from(root.querySelectorAll('a[href="#projects"]'));

  if (!section || !grid || !preview || !frame) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.warn("[projects] missing project dimension markup");
    }
    return null;
  }

  renderProjectRows(grid);
  section.setAttribute("aria-hidden", "true");
  preview.setAttribute("aria-hidden", "true");
  preview.inert = true;

  const net = initGlitchNet(netCanvas);
  let flashTimer = 0;
  let flashCleanupTimer = 0;
  let frameLoadTimer = 0;
  let swapTimer = 0;
  let loadFallbackTimer = 0;
  let closeTimer = 0;
  let projectsOpen = false;
  let activeRow = null;

  function syncNetSize() {
    if (!netCanvas) return;
    const height = Math.max(section.scrollHeight, section.clientHeight, window.innerHeight || 0);
    netCanvas.style.height = `${height}px`;
    net.resize();
  }

  function showProjects(shouldFocusRow) {
    projectsOpen = true;
    section.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("is-projects-open");
    syncNetSize();
    net.start();
    window.requestAnimationFrame(syncNetSize);
    if (shouldFocusRow) focusFirstRow(grid);
  }

  function enterProjects(event, instant = false) {
    if (event) event.preventDefault();
    window.clearTimeout(flashTimer);
    window.clearTimeout(flashCleanupTimer);
    const shouldFocusRow = !event || (event.detail === 0 && event.isTrusted);
    if (projectsOpen) {
      if (shouldFocusRow) focusFirstRow(grid);
      return;
    }

    if (reduceMotion() || instant) {
      showProjects(shouldFocusRow);
      if (instant && !reduceMotion()) {
        section.classList.add("is-arriving");
        flashCleanupTimer = window.setTimeout(() => {
          section.classList.remove("is-arriving");
        }, FLASH_MS);
      }
      return;
    }

    document.documentElement.classList.add("is-project-flashing");
    section.classList.add("is-arriving");

    flashTimer = window.setTimeout(() => {
      showProjects(shouldFocusRow);
    }, FLASH_OPEN_AT_MS);

    flashCleanupTimer = window.setTimeout(() => {
      document.documentElement.classList.remove("is-project-flashing");
      section.classList.remove("is-arriving");
    }, FLASH_MS);
  }

  function closeProjects(force = false) {
    if (!projectsOpen) return;
    if (activeRow && !force) {
      closeProject();
      return;
    }

    window.clearTimeout(flashTimer);
    window.clearTimeout(flashCleanupTimer);
    if (activeRow) {
      window.clearTimeout(frameLoadTimer);
      window.clearTimeout(swapTimer);
      window.clearTimeout(closeTimer);
      window.clearTimeout(loadFallbackTimer);
      finishClose();
    }

    const finish = () => {
      projectsOpen = false;
      section.setAttribute("aria-hidden", "true");
      document.documentElement.classList.remove("is-projects-open");
      section.classList.remove("is-arriving");
      net.stop();
      if (netCanvas) netCanvas.style.height = "";
    };

    if (reduceMotion()) {
      finish();
      return;
    }

    document.documentElement.classList.add("is-project-flashing");
    flashTimer = window.setTimeout(finish, FLASH_OPEN_AT_MS * 0.8);
    flashCleanupTimer = window.setTimeout(() => {
      document.documentElement.classList.remove("is-project-flashing");
    }, FLASH_MS);
  }

  function clearActiveRow() {
    if (activeRow) activeRow.classList.remove("is-active");
  }

  function showFrameLoading() {
    window.clearTimeout(loadFallbackTimer);
    preview.classList.add("is-loading");
    preview.setAttribute("aria-busy", "true");
    if (previewLoader) previewLoader.setAttribute("aria-hidden", "false");
    loadFallbackTimer = window.setTimeout(() => {
      hideFrameLoading();
    }, PREVIEW_LOAD_TIMEOUT_MS);
  }

  function hideFrameLoading() {
    window.clearTimeout(loadFallbackTimer);
    preview.classList.remove("is-loading");
    preview.setAttribute("aria-busy", "false");
    if (previewLoader) previewLoader.setAttribute("aria-hidden", "true");
  }

  function applyProjectMeta(project) {
    if (previewTitle) previewTitle.textContent = project.title;
    if (previewKind) previewKind.textContent = project.kind;
    if (previewDescription) previewDescription.textContent = project.description;
    if (previewOpen) {
      previewOpen.href = project.liveUrl || project.repoUrl || GITHUB_URL;
      previewOpen.textContent = project.liveUrl ? "Open live site" : "Open repository";
    }
    frame.title = `${project.title} preview`;
  }

  function loadProjectFrame(project) {
    showFrameLoading();
    if (project.previewUrl) {
      frame.removeAttribute("srcdoc");
      frame.src = project.previewUrl;
    } else {
      frame.removeAttribute("src");
      frame.srcdoc = renderPreviewDoc(project);
    }
  }

  function openProject(project, row) {
    window.clearTimeout(frameLoadTimer);
    window.clearTimeout(swapTimer);
    window.clearTimeout(closeTimer);
    const wasViewing = Boolean(activeRow);
    const isSameRow = activeRow === row && section.classList.contains("is-viewing");
    if (isSameRow) return;

    clearActiveRow();
    activeRow = row;
    activeRow.classList.add("is-active");

    preview.setAttribute("aria-hidden", "false");
    preview.inert = false;
    section.classList.add("is-viewing");
    preview.classList.remove("is-minimizing");
    showFrameLoading();
    window.requestAnimationFrame(syncNetSize);

    if (wasViewing) {
      preview.classList.add("is-swapping");
      swapTimer = window.setTimeout(() => {
        applyProjectMeta(project);
        preview.classList.remove("is-swapping");
        frameLoadTimer = window.setTimeout(() => {
          loadProjectFrame(project);
        }, reduceMotion() ? 0 : 80);
      }, reduceMotion() ? 0 : PREVIEW_SWAP_MS);
      return;
    }

    applyProjectMeta(project);
    preview.classList.add("is-open");

    frameLoadTimer = window.setTimeout(() => {
      loadProjectFrame(project);
    }, reduceMotion() ? 0 : PREVIEW_FRAME_DELAY_MS);
  }

  function finishClose() {
    preview.classList.remove("is-open");
    preview.classList.remove("is-minimizing");
    preview.classList.remove("is-swapping");
    hideFrameLoading();
    frame.removeAttribute("src");
    frame.removeAttribute("srcdoc");
    preview.setAttribute("aria-hidden", "true");
    preview.inert = true;
    section.classList.remove("is-viewing");
    const returnFocus = activeRow;
    clearActiveRow();
    activeRow = null;
    if (returnFocus) returnFocus.focus({ preventScroll: true });
    window.requestAnimationFrame(syncNetSize);
  }

  function closeProject() {
    if (!activeRow) return;
    window.clearTimeout(frameLoadTimer);
    window.clearTimeout(swapTimer);
    window.clearTimeout(closeTimer);
    window.clearTimeout(loadFallbackTimer);
    preview.classList.remove("is-swapping");
    preview.classList.remove("is-open");
    preview.classList.add("is-minimizing");
    section.classList.remove("is-viewing");

    if (reduceMotion()) {
      finishClose();
      return;
    }

    closeTimer = window.setTimeout(finishClose, PROJECT_LAYOUT_MS);
  }

  function onGridClick(event) {
    const row = event.target.closest("[data-project-id]");
    if (!row || !grid.contains(row)) return;
    const project = PROJECTS.find((item) => item.id === row.dataset.projectId);
    if (project) openProject(project, row);
  }

  function onPointerMove(event) {
    if (!projectsOpen) return;
    if (grid.contains(event.target)) {
      const rect = grid.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100;
      const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100;
      grid.style.setProperty("--project-haze-x", `${x}%`);
      grid.style.setProperty("--project-haze-y", `${y}%`);
    }
    net.poke(event.clientX, event.clientY);
  }

  function onKeydown(event) {
    if (event.key === "Escape" && projectsOpen) {
      event.preventDefault();
      if (activeRow) closeProject();
      else closeProjects();
    }
  }

  function onResize() {
    if (projectsOpen) syncNetSize();
  }

  function onFrameLoad() {
    hideFrameLoading();
  }

  function onProjectHomeClick() {
    closeProjects(true);
  }

  for (const link of projectLinks) {
    link.addEventListener("click", enterProjects);
  }
  for (const button of projectHomeButtons) {
    button.addEventListener("click", onProjectHomeClick);
  }
  grid.addEventListener("click", onGridClick);
  previewClose?.addEventListener("click", closeProject);
  frame.addEventListener("load", onFrameLoad);
  section.addEventListener("pointermove", onPointerMove);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", onResize);

  if (typeof window !== "undefined" && window.location.hash === "#projects") {
    window.setTimeout(() => enterProjects(null, true), 0);
  }

  if (debug) {
    // eslint-disable-next-line no-console
    console.info("[projects] project dimension wired", { count: PROJECTS.length });
  }

  return {
    destroy() {
      window.clearTimeout(flashTimer);
      window.clearTimeout(flashCleanupTimer);
      window.clearTimeout(frameLoadTimer);
      window.clearTimeout(swapTimer);
      window.clearTimeout(loadFallbackTimer);
      window.clearTimeout(closeTimer);
      net.stop();
      for (const link of projectLinks) {
        link.removeEventListener("click", enterProjects);
      }
      for (const button of projectHomeButtons) {
        button.removeEventListener("click", onProjectHomeClick);
      }
      grid.removeEventListener("click", onGridClick);
      previewClose?.removeEventListener("click", closeProject);
      frame.removeEventListener("load", onFrameLoad);
      section.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("resize", onResize);
    },
  };
}
