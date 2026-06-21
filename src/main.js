// ============================================================================
// Glitch Portfolio — entry module
//
// Vanilla ES module, no framework. Bootstraps the hero video and the scroll
// timeline engine, and (under ?debug) mounts a live progress/scene overlay.
// Later tickets wire the WebGL sky-glitch shader (glitch.js) and the scene
// choreography (scenes.js) onto the same timeline created here.
// ============================================================================

import { createTimeline } from "./timeline.js";
import { initGlitch } from "./glitch.js";
import { initScenes } from "./scenes.js";
import { initProjects } from "./projects.js";

// This module executing at all means the ES-module graph loaded successfully, so
// cancel the inline self-heal fallback (index.html) that would otherwise reveal
// the static title/links assuming the app failed to boot. scenes.js drives the
// reveal from here on. (A bootstrap throw is handled in init()'s catch below.)
if (typeof window !== "undefined" && window.__scrollNarrativeFallback) {
  window.clearTimeout(window.__scrollNarrativeFallback);
  window.__scrollNarrativeFallback = 0;
}

// Guard the location read so importing this module outside a browser
// (test runner / SSR) doesn't blow up with an opaque module-load error.
const params =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
export const DEBUG = params.has("debug");

// Encoded hero assets (from the video-pipeline ticket). WebM (VP9) is listed
// first so browsers that support it pick the smaller file; MP4 (H.264) is the
// universal fallback (iOS Safari especially).
const VIDEO_SOURCES = {
  720: [
    { src: "public/assets/hero-720.webm", type: "video/webm" },
    { src: "public/assets/hero-720.mp4", type: "video/mp4" },
  ],
  1080: [
    { src: "public/assets/hero-1080.webm", type: "video/webm" },
    { src: "public/assets/hero-1080.mp4", type: "video/mp4" },
  ],
};

/**
 * Choose a media tier for the current viewport AND connection. Save-data or a
 * 2G-class link stays poster-only — no multi-MB video download at all (the CSS
 * poster background remains the hero). A 3G link or a small viewport gets the
 * lighter 720 encodes; everything else gets 1080. `navigator.connection` is
 * non-standard but available on the mobile browsers that need this most; when
 * it's absent we fall back to viewport width alone.
 * @returns {"poster" | 720 | 1080}
 */
function pickTier() {
  const conn =
    typeof navigator !== "undefined"
      ? navigator.connection || navigator.mozConnection || navigator.webkitConnection
      : null;
  if (conn) {
    if (conn.saveData) return "poster";
    const et = conn.effectiveType;
    if (et === "slow-2g" || et === "2g") return "poster";
    if (et === "3g") return 720;
  }
  const w = window.innerWidth || document.documentElement.clientWidth || 1080;
  return w <= 800 ? 720 : 1080;
}

/**
 * Inject the chosen <source>s and kick off loading. Sources live in JS (not the
 * HTML) so the browser never pre-fetches a resolution it won't use. On the
 * poster-only tier nothing is downloaded — the poster background stays the hero.
 * @param {HTMLVideoElement} video
 * @returns {"poster" | 720 | 1080} the chosen tier (so the caller can skip
 *   video-dependent work — autoplay, the WebGL renderer — when poster-only).
 */
function attachSources(video) {
  const tier = pickTier();
  if (tier === "poster") {
    // Slow / save-data path: don't pull megabytes of video. Drop the preload so
    // the browser fetches nothing beyond the already-painted poster.
    video.preload = "none";
    video.removeAttribute("autoplay");
    return tier;
  }
  for (const { src, type } of VIDEO_SOURCES[tier]) {
    const el = document.createElement("source");
    el.src = src;
    el.type = type;
    video.appendChild(el);
  }
  video.load();
  return tier;
}

/**
 * Drive autoplay defensively. `autoplay muted playsinline` already covers most
 * browsers (incl. iOS Safari), but a programmatic play() is more reliable, and
 * if a browser still blocks it we resume on the first user interaction so the
 * loop always ends up playing.
 * @param {HTMLVideoElement} video
 */
function ensurePlaying(video) {
  // Belt-and-braces: the muted *property* (not just the attribute) is what
  // unlocks autoplay on some engines.
  video.muted = true;

  const tryPlay = () => {
    const result = video.play();
    if (result && typeof result.catch === "function") {
      result.catch(() => {
        // Autoplay was blocked. Wait for any user gesture, then play once.
        const resume = () => {
          video.play().catch((retryErr) => {
            if (DEBUG) {
              // eslint-disable-next-line no-console
              console.warn("[glitch-portfolio] hero autoplay retry failed", retryErr);
            }
          });
          window.removeEventListener("pointerdown", resume);
          window.removeEventListener("touchstart", resume);
          window.removeEventListener("keydown", resume);
        };
        window.addEventListener("pointerdown", resume, { once: true });
        window.addEventListener("touchstart", resume, { once: true });
        window.addEventListener("keydown", resume, { once: true });
      });
    }
  };

  if (video.readyState >= 2 /* HAVE_CURRENT_DATA */) {
    tryPlay();
  } else {
    video.addEventListener("canplay", tryPlay, { once: true });
  }
}

/**
 * Set up the full-bleed hero video: adaptive sources, fade-in on `canplay`
 * (the poster shows via CSS until then), and resilient autoplay.
 * @param {HTMLVideoElement | null} video
 * @returns {"poster" | 720 | 1080} the chosen media tier.
 */
function initHeroVideo(video) {
  if (!video) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.warn("[glitch-portfolio] no [data-hero-video] element found");
    }
    return "poster";
  }
  const tier = attachSources(video);
  // Poster-only (slow / save-data): nothing is downloaded, so `canplay` never
  // fires and there is no video to start — skip both. Otherwise wire the
  // poster→video cross-fade (on the first decodable frame) and resilient play.
  if (tier !== "poster") {
    video.addEventListener(
      "canplay",
      () => video.classList.add("is-ready"),
      { once: true }
    );
    ensurePlaying(video);
  }
  return tier;
}

/**
 * Centralized run/pause authority for battery + CPU. The hero animation should
 * only run when it is BOTH on-screen and in the foreground tab, so this wires a
 * single IntersectionObserver (offscreen) + `visibilitychange` (tab hidden) and,
 * when either says "not visible", pauses the rAF loops (timeline + glitch) AND
 * the `<video>` decode — resuming them together when both say "visible". This is
 * the one authority for the run state, which is why timeline.js / glitch.js no
 * longer carry their own visibility handlers (two would fight over it).
 *
 * @param {Object} opts
 * @param {HTMLVideoElement | null} opts.video
 * @param {Element | null} opts.stage  Element observed for on/offscreen.
 * @param {{ pause: Function, resume: Function } | null} opts.glitch
 * @param {{ start: Function, stop: Function }} opts.timeline
 * @param {boolean} opts.videoActive  False when poster-only (no video to play).
 * @returns {{ destroy: () => void }}
 */
function initPowerSaver({ video, stage, glitch, timeline, videoActive }) {
  let onscreen = true;
  let visible = typeof document !== "undefined" ? !document.hidden : true;
  // Mirrors the initial running state: the timeline starts on creation, the
  // glitch loop starts after its mask loads, and the video autoplays.
  let running = true;

  const playVideo = () => {
    if (!video || !videoActive) return;
    const result = video.play();
    if (result && typeof result.catch === "function") result.catch(() => {});
  };

  function apply() {
    const shouldRun = onscreen && visible;
    if (shouldRun === running) return;
    running = shouldRun;
    if (shouldRun) {
      timeline.start();
      if (glitch) glitch.resume();
      playVideo();
    } else {
      timeline.stop();
      if (glitch) glitch.pause();
      if (video && videoActive) video.pause();
    }
  }

  function onVisibility() {
    visible = !document.hidden;
    apply();
  }
  document.addEventListener("visibilitychange", onVisibility);

  let observer = null;
  if (stage && typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver(
      (entries) => {
        // One observed target; reflect its latest intersection.
        for (const entry of entries) onscreen = entry.isIntersecting;
        apply();
      },
      { threshold: 0 }
    );
    observer.observe(stage);
  }

  // Reconcile once in case the page loaded already hidden (no visibilitychange
  // would fire to pause it otherwise).
  apply();

  return {
    destroy() {
      document.removeEventListener("visibilitychange", onVisibility);
      if (observer) observer.disconnect();
    },
  };
}

/**
 * Mount the dev-only ?debug overlay: live progress, raw target, velocity, and
 * the active scene + its local progress. Subscribes to the timeline so it
 * updates every frame. Kept entirely out of the page unless ?debug is present.
 * @param {ReturnType<typeof createTimeline>} timeline
 */
function mountDebugOverlay(timeline) {
  const overlay = document.createElement("pre");
  overlay.className = "debug-overlay";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "off");
  document.body.appendChild(overlay);

  timeline.subscribe((progress, state) => {
    overlay.textContent = [
      `progress : ${progress.toFixed(3)}`,
      `raw      : ${state.raw.toFixed(3)}`,
      `velocity : ${state.velocity >= 0 ? "+" : ""}${state.velocity.toFixed(4)}`,
      `scene    : ${state.scene}`,
      `scene %  : ${state.sceneProgress.toFixed(3)}`,
    ].join("\n");
  });
}

function init() {
  // Declared out here so the catch block can tear down anything that already
  // started its rAF loop before a later line threw. Since the per-module
  // visibility pausing now lives only in the power saver (which is wired last),
  // a half-initialized timeline/glitch would otherwise leak an unbounded loop.
  let timeline = null;
  let glitch = null;
  let scenes = null;
  let projects = null;
  let power = null;

  // Error boundary: this is the seam where later tickets wire glitch.js and
  // scenes.js. Surface bootstrap failures instead of letting them vanish into
  // an uncaught module error.
  try {
    const video = document.querySelector("[data-hero-video]");
    const tier = initHeroVideo(video);
    const posterOnly = tier === "poster";

    const root = document.querySelector("[data-scroll-root]");
    timeline = createTimeline({ root, smoothing: 0.105 });

    // WebGL sky-glitch hero: renders the playing video through the masked glitch
    // shader, driven by this same timeline. Returns null (and leaves the plain
    // <video> as the hero) when WebGL/the mask is unavailable or reduced-motion
    // is set — so this line never breaks the baseline experience. Skipped
    // entirely on the poster-only tier: with no video frames to sample, spinning
    // a GL loop would only waste battery on the constrained connection.
    const glitchCanvas = document.querySelector("[data-glitch-canvas]");
    glitch = posterOnly
      ? null
      : initGlitch({ video, canvas: glitchCanvas, timeline, debug: DEBUG });

    // Scroll narrative: reveals the title, fades it, then reveals the outro
    // Contact/Projects links — all timed off the same timeline so the text stays
    // in sync with the shader's glitch surges. Returns null (leaving the static
    // title/links visible) if the markup hooks are absent.
    scenes = initScenes({ timeline, debug: DEBUG });
    projects = initProjects({ debug: DEBUG });

    // Single battery/CPU authority: pauses the rAF loops + video when the hero
    // is offscreen or the tab is hidden, and resumes them together. timeline.js
    // and glitch.js delegate their visibility handling to this.
    const stage = document.querySelector(".stage");
    power = initPowerSaver({
      video,
      stage,
      glitch,
      timeline,
      videoActive: !posterOnly,
    });

    // Expose the single timeline + controllers so downstream modules (the
    // hardening pass) subscribe to the same clock and can dial things instead of
    // making their own.
    window.glitchPortfolio = { timeline, glitch, scenes, projects, power, tier };

    if (DEBUG) {
      document.documentElement.dataset.debug = "true";
      // eslint-disable-next-line no-console
      console.info("[glitch-portfolio] debug mode on");
      mountDebugOverlay(timeline);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[glitch-portfolio] bootstrap failed", err);
    // Reveal the static title/links: with the app down, scenes.js won't drive the
    // reveal, and the `js` gate would otherwise keep them permanently hidden.
    document.documentElement.classList.remove("js");
    // Tear down whatever started before the throw so we don't leak a running rAF
    // loop (each guarded — a destroy must not mask the original bootstrap error).
    for (const controller of [power, projects, glitch, scenes, timeline]) {
      try {
        controller?.destroy?.();
      } catch (_) {
        /* best-effort cleanup */
      }
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
