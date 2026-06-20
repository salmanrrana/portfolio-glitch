// ============================================================================
// timeline.js — central scroll-progress engine
//
// Converts page scroll position into a smooth, normalized 0..1 progress value
// and broadcasts it to subscribers on a single requestAnimationFrame loop. This
// is the one clock the whole experience runs on: the WebGL glitch shader, the
// title reveal, and the outro all subscribe here, so every animated layer stays
// frame-synchronized and there is exactly one scroll reader (no per-module
// scroll listeners, no scroll-event jank).
//
//   progress 0 → top of the experience
//   progress 1 → end of the tall scroll container
//
// Heavy work never runs in the `scroll` event. We sample scroll position once
// per frame inside the rAF loop and exponentially smooth it toward the target
// so the value glides instead of stepping.
// ============================================================================

/**
 * @typedef {Object} TimelineState
 * @property {number} progress      Smoothed 0..1 progress (what subscribers animate to).
 * @property {number} raw           Unsmoothed 0..1 progress (the instantaneous scroll target).
 * @property {number} velocity      Per-frame delta of `progress` (signed; useful for glitch surges).
 * @property {string} scene         Active scene name (a key of SCENES).
 * @property {number} sceneProgress 0..1 progress within the active scene's range.
 */

/**
 * Subscriber invoked once per frame with the smoothed progress and full state.
 * The second argument carries the richer state; the first mirrors the PRD's
 * `(progress) => void` shape for the simplest consumers.
 * @typedef {(progress: number, state: TimelineState) => void} ProgressSubscriber
 */

// Named scene ranges as [start, end] fractions of total scroll progress.
// Ordered and contiguous across the full 0..1 span. Downstream tickets read
// these to time the glitch surges (glitchInOut / glitchWave2), the name reveal,
// hold and fade (titleReveal / titleHold / titleFade), and the closing links
// (outro).
export const SCENES = Object.freeze({
  glitchInOut: [0.0, 0.32],
  titleReveal: [0.32, 0.5],
  titleHold: [0.5, 0.68],
  titleFade: [0.68, 0.78],
  glitchWave2: [0.78, 0.93],
  outro: [0.93, 1.0],
});

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Name of the scene a global progress value falls into.
 * @param {number} progress 0..1
 * @returns {string}
 */
export function sceneAt(progress) {
  const p = clamp01(progress);
  for (const name of Object.keys(SCENES)) {
    const [start, end] = SCENES[name];
    if (p >= start && p < end) return name;
  }
  // p === 1 (or rounding past the last end) settles on the final scene.
  return "outro";
}

/**
 * Progress within a named scene's range: 0 before/at its start, 1 at/after its
 * end. Lets a consumer animate a beat without re-deriving the scene boundaries.
 * @param {string} name a key of SCENES
 * @param {number} progress global 0..1 progress
 * @returns {number} 0..1 local progress
 */
export function sceneProgress(name, progress) {
  const range = SCENES[name];
  if (!range) return 0;
  const [start, end] = range;
  if (end <= start) return progress >= end ? 1 : 0;
  return clamp01((progress - start) / (end - start));
}

/**
 * Create the scroll-progress timeline.
 *
 * @param {Object} [options]
 * @param {Element|null} [options.root]  Element whose scroll-through drives progress.
 *   When omitted, the whole document's scroll is used. Progress is measured as
 *   how far the element has scrolled past the top of the viewport relative to
 *   the distance it can travel (its height minus one viewport) — the standard
 *   sticky-section mapping, robust to where the element starts on the page.
 * @param {number} [options.smoothing=0.12]  Per-frame lerp factor toward the raw
 *   target (0..1). Lower = smoother/laggier, higher = snappier.
 * @returns {{
 *   subscribe: (fn: ProgressSubscriber) => () => void,
 *   getState: () => TimelineState,
 *   start: () => void,
 *   stop: () => void,
 *   destroy: () => void
 * }}
 */
export function createTimeline(options = {}) {
  const { root = null, smoothing = 0.12 } = options;

  // SSR / test guard: with no DOM there is nothing to measure. Return an inert
  // timeline so importing this module (or constructing it) off the main thread
  // never throws — it just never ticks.
  if (typeof window === "undefined" || typeof document === "undefined") {
    const inert = {
      progress: 0,
      raw: 0,
      velocity: 0,
      scene: sceneAt(0),
      sceneProgress: 0,
    };
    return {
      subscribe: () => () => {},
      getState: () => ({ ...inert }),
      start: () => {},
      stop: () => {},
      destroy: () => {},
    };
  }

  /** @type {Set<ProgressSubscriber>} */
  const subscribers = new Set();
  let rafId = 0;
  let running = false;

  /** Read the instantaneous (unsmoothed) 0..1 scroll target. */
  function readRaw() {
    if (root) {
      const rect = root.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      if (travel <= 0) return 0;
      return clamp01(-rect.top / travel);
    }
    const doc = document.documentElement;
    const travel = doc.scrollHeight - window.innerHeight;
    if (travel <= 0) return 0;
    return clamp01(window.scrollY / travel);
  }

  let smoothed = readRaw();
  let prevSmoothed = smoothed;

  function buildState(raw, velocity) {
    const scene = sceneAt(smoothed);
    return {
      progress: smoothed,
      raw,
      velocity,
      scene,
      sceneProgress: sceneProgress(scene, smoothed),
    };
  }

  function getState() {
    return buildState(readRaw(), smoothed - prevSmoothed);
  }

  function tick() {
    if (!running) return;
    const raw = readRaw();

    // Exponential smoothing toward the raw target for jitter-free motion.
    smoothed += (raw - smoothed) * smoothing;
    // Snap when extremely close so we settle exactly on the target (and on the
    // hard 0/1 ends) instead of asymptotically creeping forever.
    if (Math.abs(raw - smoothed) < 0.00015) smoothed = raw;

    const velocity = smoothed - prevSmoothed;
    prevSmoothed = smoothed;

    const state = buildState(raw, velocity);
    for (const fn of subscribers) {
      try {
        fn(state.progress, state);
      } catch (err) {
        // One bad subscriber must not kill the loop for every other layer.
        // eslint-disable-next-line no-console
        console.error("[timeline] subscriber threw", err);
      }
    }

    rafId = window.requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    // Re-seed the smoothed value to the current scroll on every cold start so a
    // resume (after the power saver paused us while hidden/offscreen) snaps to
    // where the page actually is instead of animating a big catch-up sweep.
    smoothed = readRaw();
    prevSmoothed = smoothed;
    running = true;
    rafId = window.requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  /**
   * Register a subscriber. The current state is pushed immediately so a late
   * subscriber renders correctly on its first frame instead of flashing blank.
   * @param {ProgressSubscriber} fn
   * @returns {() => void} unsubscribe
   */
  function subscribe(fn) {
    subscribers.add(fn);
    try {
      const state = getState();
      fn(state.progress, state);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[timeline] subscriber threw on subscribe", err);
    }
    return () => subscribers.delete(fn);
  }

  // Pausing while the tab is hidden / the hero is offscreen (to save battery) is
  // owned by the single power-saver authority in main.js, which calls stop()/
  // start() here alongside the glitch loop and the video. start() re-seeds, so
  // resuming never animates a catch-up jump. (Timeline no longer attaches its
  // own visibilitychange listener — one authority avoids the two fighting.)
  function destroy() {
    stop();
    subscribers.clear();
  }

  start();

  return { subscribe, getState, start, stop, destroy };
}
