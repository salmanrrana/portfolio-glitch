// ============================================================================
// Glitch Portfolio — entry module
//
// Vanilla ES module, no framework. This is the bootstrap seam: later tickets
// wire in the scroll timeline engine (timeline.js), the WebGL sky-glitch
// shader (glitch.js), and the scene choreography (scenes.js) from here.
//
// For the scaffold it only confirms the module pipeline loads and exposes a
// tiny `?debug` hook that downstream tickets reuse for the live overlay.
// ============================================================================

// Guard the location read so importing this module outside a browser
// (test runner / SSR) doesn't blow up with an opaque module-load error.
const params =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
export const DEBUG = params.has("debug");

function init() {
  // Error boundary: this is the seam where later tickets wire timeline.js,
  // glitch.js, and scenes.js. Surface bootstrap failures instead of letting
  // them vanish into an uncaught module error.
  try {
    if (DEBUG) {
      // Placeholder debug signal. The full progress/scene overlay arrives with
      // the timeline-engine ticket; this just proves the flag plumbing works.
      document.documentElement.dataset.debug = "true";
      // eslint-disable-next-line no-console
      console.info("[glitch-portfolio] debug mode on");
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
