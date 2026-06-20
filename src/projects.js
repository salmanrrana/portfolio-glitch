// ============================================================================
// projects.js - project dimension + iframe preview controller
//
// The Projects CTA is no longer a plain jump. With JS, it opens a fixed project
// layer through a slow white flash, renders six temporary project bays, runs a
// lightweight pointer-reactive glitch net behind them, and previews a selected
// bay inside an iframe dialog. Without JS, #projects remains a normal anchor.
// ============================================================================

const PROJECTS = [
  {
    id: "bay-01",
    title: "Project Bay 01",
    kind: "Full-stack build",
    description: "Reserved for a live app with a playable preview, source link, and stack notes.",
    tags: ["App", "API", "Live"],
    accent: "#5ef2d6",
  },
  {
    id: "bay-02",
    title: "Project Bay 02",
    kind: "Automation system",
    description: "Reserved for agent workflows, integrations, or background jobs worth showing in motion.",
    tags: ["Agents", "Queues", "Ops"],
    accent: "#ff4f9a",
  },
  {
    id: "bay-03",
    title: "Project Bay 03",
    kind: "Interface experiment",
    description: "Reserved for an interactive UI, canvas piece, game, or visual tool people can try here.",
    tags: ["UI", "Motion", "Canvas"],
    accent: "#f5d94f",
  },
  {
    id: "bay-04",
    title: "Project Bay 04",
    kind: "Data product",
    description: "Reserved for dashboards, maps, search surfaces, or anything with a real information model.",
    tags: ["Data", "Search", "Maps"],
    accent: "#69ff8f",
  },
  {
    id: "bay-05",
    title: "Project Bay 05",
    kind: "Infrastructure",
    description: "Reserved for platform work, deployment systems, observability, or developer tooling.",
    tags: ["Infra", "DX", "Cloud"],
    accent: "#a987ff",
  },
  {
    id: "bay-06",
    title: "Project Bay 06",
    kind: "Wild card",
    description: "Reserved for the project that does not fit the other bays but deserves the strangest room.",
    tags: ["Prototype", "Research", "Weird"],
    accent: "#ff8f5e",
  },
];

const GITHUB_URL = "https://github.com/salmanrrana";
const FLASH_MS = 1400;
const FLASH_OPEN_AT_MS = 620;
const CLOSE_MS = 540;
const NET_MAX_DPR = 1.35;
const NET_SPACING = 74;
const NET_TRAIL_LIMIT = 10;

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
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: dark;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
        background: #05060a;
        color: #f4f6fb;
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        overflow: hidden;
        background:
          radial-gradient(circle at 20% 28%, ${project.accent}33 0 1px, transparent 2px),
          radial-gradient(circle at 82% 62%, #ff4f9a33 0 1px, transparent 2px),
          conic-gradient(from 180deg at 50% 50%, #05060a, #101832, #05060a, #1b1022, #05060a);
      }
      main {
        width: min(720px, calc(100% - 2rem));
        padding: 4rem;
      }
      p, h1 { margin: 0; }
      .kind {
        margin-bottom: 0.8rem;
        color: ${project.accent};
        font: 0.82rem ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      h1 {
        font-size: 5.5rem;
        line-height: 0.95;
        letter-spacing: 0;
        text-wrap: balance;
      }
      .desc {
        max-width: 38rem;
        margin-top: 1rem;
        color: rgba(244, 246, 251, 0.76);
        font-size: 1.1rem;
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
        border: 1px solid rgba(244, 246, 251, 0.22);
        border-radius: 999px;
        color: rgba(244, 246, 251, 0.8);
        font: 0.78rem ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      @media (max-width: 640px) {
        main { padding: 1.5rem; }
        h1 { font-size: 3rem; }
      }
    </style>
  </head>
  <body>
    <main>
      <p class="kind">${escapeHtml(project.kind)}</p>
      <h1>${escapeHtml(project.title)}</h1>
      <p class="desc">${escapeHtml(project.description)}</p>
      <div class="tags">${tags}</div>
    </main>
  </body>
</html>`;
}

function renderCards(grid) {
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
      <span class="project-row__action">Preview</span>
    `;
    frag.appendChild(button);
  });
  grid.replaceChildren(frag);
}

function focusFirstCard(grid) {
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
      const alpha = 0.035 + 0.18 * influenceAt(w * 0.5, (row - 0.5) * spacing);
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
      const alpha = 0.028 + 0.14 * influenceAt((col - 0.5) * spacing, h * 0.5);
      ctx.strokeStyle = `rgba(210, 0, 96, ${alpha})`;
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();
    }

    for (const trail of trails) {
      const alpha = trail.life;
      const burst = 26 * dpr * alpha;
      for (let i = 0; i < 7; i++) {
        const x = trail.x + Math.sin(trail.seed + i * 1.7 + time * 0.01) * burst * (1 + i * 0.12);
        const y = trail.y + Math.cos(trail.seed + i * 1.1 + time * 0.012) * burst * (0.7 + i * 0.08);
        ctx.fillStyle = i % 2 ? `rgba(210, 0, 96, ${0.42 * alpha})` : `rgba(0, 128, 150, ${0.48 * alpha})`;
        ctx.fillRect(x, y, (18 + i * 7) * dpr * alpha, Math.max(1, 2.5 * dpr));
      }
    }

    trails = trails
      .map((trail) => ({ ...trail, life: trail.life * 0.935 }))
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
  const viewer = root.querySelector("[data-project-viewer]");
  const frame = root.querySelector("[data-project-viewer-frame]");
  const viewerTitle = root.querySelector("[data-project-viewer-title]");
  const viewerKind = root.querySelector("[data-project-viewer-kind]");
  const viewerOpen = root.querySelector("[data-project-viewer-open]");
  const viewerClose = root.querySelector("[data-project-viewer-close]");
  const projectClose = root.querySelector("[data-project-space-close]");
  const netCanvas = root.querySelector("[data-project-glitch-net]");
  const projectLinks = Array.from(root.querySelectorAll('a[href="#projects"]'));

  if (!section || !grid || !viewer || !frame) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.warn("[projects] missing project dimension markup");
    }
    return null;
  }

  renderCards(grid);
  section.setAttribute("aria-hidden", "true");

  const net = initGlitchNet(netCanvas);
  let flashTimer = 0;
  let flashCleanupTimer = 0;
  let openTimer = 0;
  let closeTimer = 0;
  let projectsOpen = false;
  let activeCard = null;

  function enterProjects(event) {
    if (event) event.preventDefault();
    window.clearTimeout(flashTimer);
    window.clearTimeout(flashCleanupTimer);
    const shouldFocusCard = !event || (event.detail === 0 && event.isTrusted);
    if (projectsOpen) {
      if (shouldFocusCard) focusFirstCard(grid);
      return;
    }

    if (reduceMotion()) {
      projectsOpen = true;
      section.setAttribute("aria-hidden", "false");
      document.documentElement.classList.add("is-projects-open");
      net.start();
      if (shouldFocusCard) focusFirstCard(grid);
      return;
    }

    document.documentElement.classList.add("is-project-flashing");
    section.classList.add("is-arriving");

    flashTimer = window.setTimeout(() => {
      projectsOpen = true;
      section.setAttribute("aria-hidden", "false");
      document.documentElement.classList.add("is-projects-open");
      net.start();
      if (shouldFocusCard) focusFirstCard(grid);
    }, FLASH_OPEN_AT_MS);

    flashCleanupTimer = window.setTimeout(() => {
      document.documentElement.classList.remove("is-project-flashing");
      section.classList.remove("is-arriving");
    }, FLASH_MS);
  }

  function closeProjects() {
    if (!projectsOpen) return;
    if (viewer.open) {
      closeProject();
      return;
    }

    window.clearTimeout(flashTimer);
    window.clearTimeout(flashCleanupTimer);

    const finish = () => {
      projectsOpen = false;
      section.setAttribute("aria-hidden", "true");
      document.documentElement.classList.remove("is-projects-open");
      section.classList.remove("is-arriving");
      net.stop();
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

  function clearActiveCard() {
    if (activeCard) activeCard.classList.remove("is-active");
  }

  function openProject(project, card) {
    window.clearTimeout(openTimer);
    window.clearTimeout(closeTimer);
    clearActiveCard();
    activeCard = card;
    activeCard.classList.add("is-active");

    if (viewerTitle) viewerTitle.textContent = project.title;
    if (viewerKind) viewerKind.textContent = project.kind;
    if (viewerOpen) {
      viewerOpen.href = project.sourceUrl || GITHUB_URL;
      viewerOpen.textContent = project.sourceLabel || "Open GitHub";
    }
    frame.title = `${project.title} preview`;
    frame.removeAttribute("src");
    frame.srcdoc = renderPreviewDoc(project);

    section.classList.add("is-viewing");
    document.documentElement.classList.add("project-modal-open");

    if (!viewer.open) viewer.showModal();
    viewer.classList.remove("is-minimizing");
    viewer.classList.remove("is-open");

    openTimer = window.setTimeout(() => {
      viewer.classList.add("is-open");
    }, reduceMotion() ? 0 : 30);
  }

  function finishClose() {
    viewer.classList.remove("is-open");
    viewer.classList.remove("is-minimizing");
    if (viewer.open) viewer.close();
    frame.removeAttribute("src");
    frame.removeAttribute("srcdoc");
    section.classList.remove("is-viewing");
    document.documentElement.classList.remove("project-modal-open");
    const returnFocus = activeCard;
    clearActiveCard();
    activeCard = null;
    if (returnFocus) returnFocus.focus({ preventScroll: true });
  }

  function closeProject() {
    if (!viewer.open) return;
    window.clearTimeout(openTimer);
    window.clearTimeout(closeTimer);
    viewer.classList.remove("is-open");

    if (reduceMotion()) {
      finishClose();
      return;
    }

    viewer.classList.add("is-minimizing");
    closeTimer = window.setTimeout(finishClose, CLOSE_MS);
  }

  function onGridClick(event) {
    const row = event.target.closest("[data-project-id]");
    if (!row || !grid.contains(row)) return;
    const project = PROJECTS.find((item) => item.id === row.dataset.projectId);
    if (project) openProject(project, row);
  }

  function onViewerClick(event) {
    if (event.target !== viewer) return;
    const rect = viewer.getBoundingClientRect();
    const outside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;
    if (outside) closeProject();
  }

  function onViewerCancel(event) {
    event.preventDefault();
    closeProject();
  }

  function onPointerMove(event) {
    if (!projectsOpen) return;
    net.poke(event.clientX, event.clientY);
  }

  function onKeydown(event) {
    if (event.key === "Escape" && projectsOpen && !viewer.open) {
      event.preventDefault();
      closeProjects();
    }
  }

  function onResize() {
    if (projectsOpen) net.resize();
  }

  for (const link of projectLinks) {
    link.addEventListener("click", enterProjects);
  }
  grid.addEventListener("click", onGridClick);
  projectClose?.addEventListener("click", closeProjects);
  viewerClose?.addEventListener("click", closeProject);
  viewer.addEventListener("cancel", onViewerCancel);
  viewer.addEventListener("click", onViewerClick);
  section.addEventListener("pointermove", onPointerMove);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", onResize);

  if (debug) {
    // eslint-disable-next-line no-console
    console.info("[projects] project dimension wired", { count: PROJECTS.length });
  }

  return {
    destroy() {
      window.clearTimeout(flashTimer);
      window.clearTimeout(flashCleanupTimer);
      window.clearTimeout(openTimer);
      window.clearTimeout(closeTimer);
      net.stop();
      for (const link of projectLinks) {
        link.removeEventListener("click", enterProjects);
      }
      grid.removeEventListener("click", onGridClick);
      projectClose?.removeEventListener("click", closeProjects);
      viewerClose?.removeEventListener("click", closeProject);
      viewer.removeEventListener("cancel", onViewerCancel);
      viewer.removeEventListener("click", onViewerClick);
      section.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("resize", onResize);
      if (viewer.open) viewer.close();
    },
  };
}
