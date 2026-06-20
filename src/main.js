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

const params = new URLSearchParams(window.location.search);
export const DEBUG = params.has("debug");

function init() {
  if (DEBUG) {
    // Placeholder debug signal. The full progress/scene overlay arrives with
    // the timeline-engine ticket; this just proves the flag plumbing works.
    document.documentElement.dataset.debug = "true";
    // eslint-disable-next-line no-console
    console.info("[glitch-portfolio] debug mode on");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
