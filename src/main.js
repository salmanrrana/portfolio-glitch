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
 * Choose a resolution tier for the current viewport. Deliberately simple here —
 * the hardening ticket layers in `navigator.connection`/save-data awareness.
 * Small viewports get the lighter 720 encodes; everything else gets 1080.
 * @returns {720 | 1080}
 */
function pickTier() {
  const w = window.innerWidth || document.documentElement.clientWidth || 1080;
  return w <= 800 ? 720 : 1080;
}

/**
 * Inject the chosen <source>s and kick off loading. Sources live in JS (not the
 * HTML) so the browser never pre-fetches a resolution it won't use.
 * @param {HTMLVideoElement} video
 */
function attachSources(video) {
  const sources = VIDEO_SOURCES[pickTier()];
  for (const { src, type } of sources) {
    const el = document.createElement("source");
    el.src = src;
    el.type = type;
    video.appendChild(el);
  }
  video.load();
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
 */
function initHeroVideo(video) {
  if (!video) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.warn("[glitch-portfolio] no [data-hero-video] element found");
    }
    return;
  }
  // Cross-fade from poster to live video once the first frame is decodable.
  video.addEventListener(
    "canplay",
    () => video.classList.add("is-ready"),
    { once: true }
  );
  attachSources(video);
  ensurePlaying(video);
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
  // Error boundary: this is the seam where later tickets wire glitch.js and
  // scenes.js. Surface bootstrap failures instead of letting them vanish into
  // an uncaught module error.
  try {
    const video = document.querySelector("[data-hero-video]");
    initHeroVideo(video);

    const root = document.querySelector("[data-scroll-root]");
    const timeline = createTimeline({ root });

    // WebGL sky-glitch hero: renders the playing video through the masked glitch
    // shader, driven by this same timeline. Returns null (and leaves the plain
    // <video> as the hero) when WebGL/the mask is unavailable or reduced-motion
    // is set — so this line never breaks the baseline experience.
    const glitchCanvas = document.querySelector("[data-glitch-canvas]");
    const glitch = initGlitch({ video, canvas: glitchCanvas, timeline, debug: DEBUG });

    // Scroll narrative: reveals the title, fades it, then reveals the outro
    // Contact/Projects links — all timed off the same timeline so the text stays
    // in sync with the shader's glitch surges. Returns null (leaving the static
    // title/links visible) if the markup hooks are absent.
    const scenes = initScenes({ timeline, debug: DEBUG });

    // Expose the single timeline + controllers so downstream modules (the
    // hardening pass) subscribe to the same clock and can dial things instead of
    // making their own.
    window.glitchPortfolio = { timeline, glitch, scenes };

    if (DEBUG) {
      document.documentElement.dataset.debug = "true";
      // eslint-disable-next-line no-console
      console.info("[glitch-portfolio] debug mode on");
      mountDebugOverlay(timeline);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[glitch-portfolio] bootstrap failed", err);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
