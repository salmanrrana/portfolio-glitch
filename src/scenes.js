// ============================================================================
// scenes.js — scroll narrative choreography
//
// The content + timing layer that turns raw timeline progress into the story:
//
//   glitchInOut  → video plays, sky glitch flickers in/out, title hidden
//   titleReveal  → "Salman R Rana || Software Engineer" emerges from the sky
//   titleFade    → the title drifts away on continued scroll
//   glitchWave2  → a second sky-glitch wave (driven by glitch.js; title gone)
//   outro        → sky settles clean; Contact + Projects links reveal
//
// This module owns only the DOM presentation of the title and outro. It reads
// the SAME timeline the glitch shader reads (one clock, frame-synced) and writes
// CSS custom properties on the title/outro elements per frame. The shader's own
// intensity surges (glitchInOut / glitchWave2) live in glitch.js — here we just
// confirm the beats line up and present the text over them.
//
// Progressive enhancement: with JavaScript off, the `js` class is never added to
// <html>, so styles.css leaves the title and outro fully visible (legible static
// page). Only when this module runs do they start hidden and animate on scroll.
//
// Reduced motion: `prefers-reduced-motion: reduce` keeps the same beats but
// strips the blur / drift / chromatic-glitch — title and links cross-fade calmly.
// ============================================================================

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

// Cubic easings — gentle acceleration in/out so the reveal and fade feel
// deliberate rather than linear.
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
// Hermite smoothstep between edges e0..e1.
const smoothstep = (e0, e1, x) => {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// Title motion budget (px / px / unitless). Tuned small so the reveal reads as a
// settle, not a slide. Zeroed entirely under reduced motion.
const TITLE_RISE_PX = 26; // travels up into place on reveal
const TITLE_DRIFT_PX = 30; // drifts further up while fading out
const TITLE_BLUR_PX = 10; // de-focus → focus on reveal

// Outro link reveal budget.
const OUTRO_RISE_PX = 18;

/**
 * @typedef {Object} TitleFrame
 * @property {number} opacity 0..1
 * @property {number} shift   px on the Y axis (negative = up)
 * @property {number} blur    px
 * @property {number} glitch  0..1 chromatic-aberration amount
 */

/**
 * Compute the title's visual state for a scene + its local progress.
 * Reveal completes by ~75% of `titleReveal` and holds full until the scene ends,
 * giving a deliberate beat before `titleFade` carries it off. The chromatic
 * "emergence" decays over the first part of the reveal so the text resolves out
 * of the glitch rather than simply fading in.
 * @param {string} scene
 * @param {number} sp scene-local progress 0..1
 * @returns {TitleFrame}
 */
export function titleFrame(scene, sp) {
  switch (scene) {
    case "titleReveal": {
      const e = easeOutCubic(clamp01(sp / 0.75));
      return {
        opacity: e,
        shift: -(1 - e) * TITLE_RISE_PX,
        blur: (1 - e) * TITLE_BLUR_PX,
        // Strong chromatic split at the start, settling to clean by ~60%.
        glitch: 1 - smoothstep(0, 0.6, sp),
      };
    }
    case "titleFade": {
      const e = easeInCubic(sp);
      return {
        opacity: 1 - e,
        shift: -e * TITLE_DRIFT_PX,
        blur: e * (TITLE_BLUR_PX * 0.8),
        // A faint chromatic shiver on the way out ties it back to the glitch.
        glitch: e * 0.4,
      };
    }
    default:
      // glitchInOut (before reveal), glitchWave2 and outro (after fade): hidden.
      return { opacity: 0, shift: 0, blur: 0, glitch: 0 };
  }
}

/**
 * Compute the outro links' visual state. They reveal over the first half of the
 * `outro` scene and hold, so the links are fully settled well before the bottom.
 * @param {string} scene
 * @param {number} sp scene-local progress 0..1
 * @returns {{ opacity: number, shift: number }}
 */
export function outroFrame(scene, sp) {
  if (scene !== "outro") return { opacity: 0, shift: OUTRO_RISE_PX };
  const e = easeOutCubic(clamp01(sp / 0.5));
  return { opacity: e, shift: (1 - e) * OUTRO_RISE_PX };
}

/**
 * Wire the scroll narrative to a timeline.
 *
 * @param {Object} opts
 * @param {{ subscribe: Function }} opts.timeline The shared scroll timeline.
 * @param {ParentNode} [opts.root=document] Where to look up the title/outro nodes.
 * @param {boolean} [opts.debug=false]
 * @returns {null | { destroy: () => void }} A controller, or null if neither the
 *   title nor the outro element is present (nothing to choreograph).
 */
export function initScenes({ timeline, root = typeof document !== "undefined" ? document : null, debug = false } = {}) {
  if (!timeline || !root) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.warn("[scenes] missing timeline or root → nothing to choreograph");
    }
    return null;
  }

  const titleEl = root.querySelector("[data-title]");
  const outroEl = root.querySelector("[data-outro]");
  if (!titleEl && !outroEl) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.warn("[scenes] no [data-title] or [data-outro] element → nothing to choreograph");
    }
    return null;
  }

  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Last-applied values, so we only touch the DOM when something actually moved
  // (cheap, but avoids redundant style writes every single frame at rest).
  let lastTitleKey = "";
  let lastOutroVisible = null;
  let lastOutroKey = "";

  function applyTitle(scene, sp) {
    if (!titleEl) return;
    const f = titleFrame(scene, sp);
    // Reduced motion: keep the beat (opacity) but drop blur / drift / chroma.
    const shift = reduceMotion ? 0 : f.shift;
    const blur = reduceMotion ? 0 : f.blur;
    const glitch = reduceMotion ? 0 : f.glitch;

    const key = `${f.opacity.toFixed(3)}|${shift.toFixed(2)}|${blur.toFixed(2)}|${glitch.toFixed(3)}`;
    if (key === lastTitleKey) return;
    lastTitleKey = key;

    const s = titleEl.style;
    s.setProperty("--title-opacity", f.opacity.toFixed(3));
    s.setProperty("--title-shift", `${shift.toFixed(2)}px`);
    s.setProperty("--title-blur", `${blur.toFixed(2)}px`);
    s.setProperty("--title-glitch", glitch.toFixed(3));
  }

  function applyOutro(scene, sp) {
    if (!outroEl) return;
    const f = outroFrame(scene, sp);
    const shift = reduceMotion ? 0 : f.shift;

    // visibility:hidden when fully transparent keeps the links out of the tab
    // order and off the a11y tree until they actually appear, so a keyboard user
    // never lands on an invisible link mid-journey. (Non-scroll keyboard access
    // to these links is the hardening ticket's skip-link.)
    const visible = f.opacity > 0.02;
    if (visible !== lastOutroVisible) {
      lastOutroVisible = visible;
      outroEl.classList.toggle("is-visible", visible);
      outroEl.setAttribute("aria-hidden", visible ? "false" : "true");
    }

    const key = `${f.opacity.toFixed(3)}|${shift.toFixed(2)}`;
    if (key === lastOutroKey) return;
    lastOutroKey = key;

    const s = outroEl.style;
    s.setProperty("--outro-opacity", f.opacity.toFixed(3));
    s.setProperty("--outro-shift", `${shift.toFixed(2)}px`);
  }

  const unsubscribe = timeline.subscribe((_progress, state) => {
    applyTitle(state.scene, state.sceneProgress);
    applyOutro(state.scene, state.sceneProgress);
  });

  if (debug) {
    // eslint-disable-next-line no-console
    console.info("[scenes] narrative wired", {
      title: Boolean(titleEl),
      outro: Boolean(outroEl),
      reduceMotion,
    });
  }

  return {
    destroy() {
      unsubscribe();
    },
  };
}
