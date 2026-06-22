// ============================================================================
// scroll-cue.js - bottom scroll affordance for the sticky narrative
//
// Uses the shared timeline so the cue reflects the same measured scroll progress
// as the hero, title, glitch, and outro. The cue remains visual-only; native page
// scrolling and the skip-nav cover keyboard and assistive-tech paths.
// ============================================================================

const END_THRESHOLD = 0.995;
const KEEP_SCROLLING_THRESHOLD = 0.08;

function frameForRawProgress(raw) {
  if (raw >= END_THRESHOLD) {
    return { state: "end", label: "FIN" };
  }
  if (raw >= KEEP_SCROLLING_THRESHOLD) {
    return { state: "more", label: "Keep scrolling" };
  }
  return { state: "more", label: "Scroll" };
}

/**
 * Keep the bottom-center scroll cue synchronized with the shared timeline.
 *
 * @param {Object} opts
 * @param {{ subscribe: Function }} opts.timeline The shared scroll timeline.
 * @param {ParentNode} [opts.root=document] Where to look up cue nodes.
 * @param {boolean} [opts.debug=false]
 * @returns {null | { destroy: () => void }}
 */
export function initScrollCue({ timeline, root = typeof document !== "undefined" ? document : null, debug = false } = {}) {
  if (!timeline || !root) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.warn("[scroll-cue] missing timeline or root");
    }
    return null;
  }

  const cue = root.querySelector("[data-scroll-cue]");
  const label = root.querySelector("[data-scroll-cue-label]");
  if (!cue || !label) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.warn("[scroll-cue] missing cue markup");
    }
    return null;
  }

  let lastKey = "";

  const unsubscribe = timeline.subscribe((_progress, state) => {
    const frame = frameForRawProgress(state.raw);
    const key = `${frame.state}|${frame.label}`;
    if (key === lastKey) return;
    lastKey = key;

    cue.dataset.state = frame.state;
    label.textContent = frame.label;
  });

  return {
    destroy() {
      unsubscribe();
    },
  };
}
