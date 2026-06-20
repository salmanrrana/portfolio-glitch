// ============================================================================
// glitch.js — WebGL masked sky-glitch renderer
//
// Renders the live hero <video> to a full-viewport <canvas> through a fragment
// shader that corrupts ONLY the sky (gated by sky-mask.png) while the field,
// hills, and horses stay pixel-clean. Glitch intensity is driven by the scroll
// timeline so the effect pulses in and out; a subtle parallax drifts the sky.
//
// Pipeline (one GPU pass per rAF frame):
//   1. Upload the current video frame as a texture (texImage2D).
//   2. Bind the baked sky mask as a second texture (white = sky, black = keep).
//   3. Cover-fit UVs (identical for video + mask, per assets-src/sky-mask-notes.md)
//      so the mask tracks the video — not the screen — across aspect ratios.
//   4. finalColor = mix(cleanVideo, glitch, maskValue * intensity).
//
// Degradation is first-class: no WebGL, a failed mask load, reduced-motion, or a
// lost GL context all fall back to the plain <video> hero (handled by CSS via the
// `data-glitch` flag on <html>). The full reduced-motion / slow-connection /
// offscreen-pause policy lives in the hardening ticket; the hooks are exposed
// here (setIntensityScale, pause/resume).
// ============================================================================

// The encoded hero + mask are authored at 1920x1080 (see sky-mask-notes.md), so
// the shader cover-fits against this exact aspect to keep the mask 1:1 with the
// video regardless of viewport shape.
const VIDEO_ASPECT = 16 / 9;

// Cap the backing-store resolution. WebGL cost scales with pixel count; 2x is
// plenty crisp on a HiDPI laptop.
const MAX_DPR = 2;

// Phones are fill-rate bound, not sharpness bound: this is a full-screen,
// fragment-heavy pass, so DPR 3 on a phone melts the framerate for no visible
// gain. Clamp harder on coarse-pointer / small-viewport devices.
const MAX_DPR_MOBILE = 1.5;

// Dropped-frame watchdog: if we can't sustain ~60fps (weak GPU / thermal
// throttle), step the internal resolution down by this factor, no lower than
// MIN_QUALITY. Downgrade-only — we never step back up, to avoid oscillating
// around the threshold.
const MIN_QUALITY = 0.5;
const QUALITY_STEP = 0.25;
// Sustained average frame time above this (≈ < 45fps) trips a downgrade.
const SLOW_FRAME_MS = 22;
// Samples averaged before judging — ~1s at 60fps, long enough to ignore one-off
// hitches (GC, a scroll spike) and only react to a sustained shortfall.
const FRAME_WINDOW = 60;

const MASK_URL = "public/assets/sky-mask.png";

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Per-device ceiling on the backing-store DPR, before the dynamic quality scale.
 * @returns {number}
 */
function maxDprForDevice() {
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.innerWidth, window.innerHeight) <= 900;
  return coarse || small ? MAX_DPR_MOBILE : MAX_DPR;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  // a_pos spans the clip-space quad [-1,1]; v_uv is 0..1 with y up (screen top).
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Fragment shader. Blends the two reference aesthetics — analog chromatic wave
// (Reference A) and digital datamosh / neon blocks (Reference B) — and sweeps
// from subtle to full corruption with u_intensity. Everything is gated by the
// sky mask so the foreground is always the untouched clean video.
const FRAG_SRC = `
// High float precision is optional for fragment shaders in WebGL1; falling back
// to mediump where it's unavailable keeps the effect working on low-end GPUs
// (all UVs are 0..1, so mediump is plenty) instead of failing to compile.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;

uniform sampler2D u_video;
uniform sampler2D u_mask;
uniform float u_time;
uniform float u_intensity;   // 0..1 from the scroll timeline
uniform vec2  u_parallax;    // sky-only sampling offset (foreground unaffected)
uniform vec2  u_resolution;  // canvas backing-store size in px
uniform float u_videoAspect; // 16/9

// --- hashes (cheap, deterministic; no texture lookups) ---------------------
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 screenUv = v_uv;

  // Cover-fit: map screen UVs into the visible center-crop of the 16:9 video
  // (identical to CSS object-fit: cover). The SAME uv samples both the video
  // and the mask, so the mask tracks the video exactly.
  float viewAspect = u_resolution.x / u_resolution.y;
  vec2 scale = (viewAspect > u_videoAspect)
      ? vec2(1.0, u_videoAspect / viewAspect)  // viewport wider  -> crop top/bottom
      : vec2(viewAspect / u_videoAspect, 1.0); // viewport taller -> crop left/right
  vec2 uv = (screenUv - 0.5) * scale + 0.5;

  // Clean, untouched video at the true UV — this is what the foreground keeps.
  vec3 clean = texture2D(u_video, uv).rgb;

  // Mask read at the TRUE uv (no displacement/parallax) so the gate always
  // follows the real horizon. 1 = sky/glitchable, 0 = protected foreground.
  float m = texture2D(u_mask, uv).r;

  float intensity = clamp(u_intensity, 0.0, 1.0);

  // Early out where there is nothing to do (foreground, or intensity ~0): just
  // emit the clean frame. Saves the glitch math on most of the screen.
  float gate = m * intensity;
  if (gate < 0.001) {
    gl_FragColor = vec4(clean, 1.0);
    return;
  }

  // --- Reference A: analog wave / VHS row displacement ----------------------
  // Layered sines give a slow S-curve warp; a per-scanline hash adds tracking
  // jitter. Displacement is horizontal (rows flow left/right).
  float row = uv.y;
  float wave =
      sin(row * 18.0 + u_time * 2.0) * 0.5 +
      sin(row * 7.3 - u_time * 1.3) * 0.5;
  float lineJitter = hash11(floor(row * 140.0) + floor(u_time * 9.0)) - 0.5;
  float disp = (wave * 0.018 + lineJitter * 0.03) * intensity;

  // --- Reference B: datamosh block displacement -----------------------------
  // Quantize into blocks; a fraction of them jump to a shuffled offset. Ramps
  // in only at higher intensity so low intensity stays an analog shimmer.
  float blockAmt = smoothstep(0.4, 0.95, intensity);
  vec2 bsize = vec2(0.085, 0.045);
  vec2 bid = floor(uv / bsize);
  float bsel = hash21(bid + floor(u_time * 6.0));
  vec2 boff = step(0.74, bsel) *
      (vec2(hash21(bid + 1.7), hash21(bid + 7.3)) - 0.5) *
      vec2(0.14, 0.05) * blockAmt;

  // Sky sample point: displacement + datamosh + scroll parallax. Parallax only
  // affects the glitch sample (sky), never the clean foreground above.
  vec2 guv = uv + vec2(disp, 0.0) + boff + u_parallax;

  // --- RGB / chromatic split -------------------------------------------------
  float ca = 0.004 + 0.018 * intensity;
  float r = texture2D(u_video, guv + vec2(ca, 0.0)).r;
  float g = texture2D(u_video, guv).g;
  float b = texture2D(u_video, guv - vec2(ca, 0.0)).b;
  vec3 glitch = vec3(r, g, b);

  // --- Scanlines (screen-space, so density is resolution-independent) -------
  float scan = 0.82 + 0.18 * sin(screenUv.y * u_resolution.y * 1.4 - u_time * 8.0);
  glitch *= mix(1.0, scan, 0.55 * intensity);

  // --- Neon bars / datamosh color blocks (peak only) ------------------------
  // Rare full-saturation bars over near-black, in the Reference B palette.
  float barAmt = smoothstep(0.62, 1.0, intensity);
  float barId = floor((uv.y + u_time * 0.08) * 46.0);
  float barRand = hash11(barId + floor(u_time * 5.0));
  float barHit = step(0.9, barRand) * barAmt;
  // Pick a neon hue from the bar's randomness.
  float hue = hash11(barId * 1.7);
  vec3 neon = (hue < 0.2) ? vec3(0.1, 1.0, 0.35)   // electric green
            : (hue < 0.4) ? vec3(1.0, 0.15, 0.55)  // magenta
            : (hue < 0.6) ? vec3(0.15, 0.85, 1.0)  // cyan
            : (hue < 0.8) ? vec3(1.0, 0.9, 0.2)    // yellow
                          : vec3(0.55, 0.2, 1.0);  // violet
  glitch = mix(glitch, neon, barHit);

  // Crush toward high-contrast near-monochrome base at peak (Reference A) before
  // the neon fringing reads, then let the chromatic split carry the color.
  float lum = dot(glitch, vec3(0.299, 0.587, 0.114));
  glitch = mix(glitch, vec3(lum), 0.25 * intensity);

  // Gate: foreground (m≈0) and low intensity keep the clean video; the sky
  // corrupts proportionally. This is the zero-bleed guarantee.
  gl_FragColor = vec4(mix(clean, glitch, gate), 1.0);
}
`;

// ---------------------------------------------------------------------------
// GL helpers
// ---------------------------------------------------------------------------

function compileShader(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function linkProgram(gl, vertSrc, fragSrc) {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  // Shaders are linked into the program now; the standalone objects can go.
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log}`);
  }
  return program;
}

// A texture configured for streaming non-power-of-two sources (video frames and
// the 1920x1080 mask): CLAMP_TO_EDGE + LINEAR, no mipmaps. CLAMP_TO_EDGE is
// what stops the cropped-away cover-fit margins from wrapping the opposite edge
// in (sky staying sky, foreground staying foreground).
function createStreamTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

/**
 * Load the sky mask into a GL texture. Resolves with the texture once decoded,
 * or rejects if the image fails to load (caller then falls back to plain video).
 * @param {WebGLRenderingContext} gl
 * @returns {Promise<WebGLTexture>}
 */
function loadMaskTexture(gl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tex = createStreamTexture(gl);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      resolve(tex);
    };
    img.onerror = () => reject(new Error(`failed to load mask: ${MASK_URL}`));
    img.src = MASK_URL;
  });
}

// ---------------------------------------------------------------------------
// Intensity choreography (timeline -> u_intensity)
// ---------------------------------------------------------------------------

/**
 * Per-scene base intensity target. The two glitch scenes (glitchInOut,
 * glitchWave2) get a sin bump so the effect surges in and recedes rather than
 * sitting constant; the title scenes idle low; the outro settles to clean. The
 * scroll-narrative ticket tunes these curves further — this provides the pulsing
 * baseline the ticket requires.
 * @param {string} scene
 * @param {number} sp scene-local progress 0..1
 */
function sceneBaseIntensity(scene, sp) {
  switch (scene) {
    case "glitchInOut":
      // 0.12 -> ~1.0 -> 0.12 across the scene.
      return 0.12 + 0.88 * Math.sin(Math.PI * sp);
    case "titleReveal":
      // Calm sky behind the emerging title; gentle rise.
      return 0.1 + 0.18 * sp;
    case "titleHold":
      // Let the resolved title breathe against a mostly calm sky.
      return 0.14 + 0.06 * Math.sin(Math.PI * sp);
    case "titleFade":
      // Build toward the second wave.
      return 0.18 + 0.22 * sp;
    case "glitchWave2":
      // Full corruption peak.
      return 0.25 + 0.75 * Math.sin(Math.PI * sp);
    case "outro":
      // Settle to a mostly-clean sky.
      return 0.08 * (1 - sp);
    default:
      return 0.1;
  }
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Initialize the WebGL sky-glitch hero.
 *
 * @param {Object} opts
 * @param {HTMLVideoElement} opts.video   Playing hero video (the texture source).
 * @param {HTMLCanvasElement} opts.canvas Full-viewport canvas to render into.
 * @param {{ subscribe: Function, getState: Function }} opts.timeline Scroll timeline.
 * @param {boolean} [opts.debug=false]
 * @returns {null | {
 *   destroy: () => void,
 *   pause: () => void,
 *   resume: () => void,
 *   setIntensityScale: (s: number) => void,
 *   isActive: boolean
 * }} A controller, or null if WebGL/mask is unavailable (caller stays on plain video).
 */
export function initGlitch({ video, canvas, timeline, debug = false } = {}) {
  if (typeof window === "undefined" || !video || !canvas || !timeline) {
    return null;
  }

  const warn = (...args) => {
    if (debug) {
      // eslint-disable-next-line no-console
      console.warn("[glitch]", ...args);
    }
  };

  // Reduced-motion users get the plain video hero. This is the calm fallback the
  // hardening ticket builds on; we expose setIntensityScale so it can instead
  // dial in a gentle shimmer later if desired.
  const reduceMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    warn("prefers-reduced-motion → plain video hero");
    return null;
  }

  // Acquire a context. `preserveDrawingBuffer:false` + `antialias:false` keep it
  // cheap; `alpha:false` since we always paint an opaque frame.
  const glOpts = { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };
  const gl =
    canvas.getContext("webgl", glOpts) ||
    canvas.getContext("experimental-webgl", glOpts);
  if (!gl) {
    warn("no WebGL context → plain video hero");
    return null;
  }

  let program;
  try {
    program = linkProgram(gl, VERT_SRC, FRAG_SRC);
  } catch (err) {
    warn(err.message, "→ plain video hero");
    return null;
  }

  // Fullscreen quad (two triangles covering clip space).
  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(program, "a_pos");
  const u = {
    video: gl.getUniformLocation(program, "u_video"),
    mask: gl.getUniformLocation(program, "u_mask"),
    time: gl.getUniformLocation(program, "u_time"),
    intensity: gl.getUniformLocation(program, "u_intensity"),
    parallax: gl.getUniformLocation(program, "u_parallax"),
    resolution: gl.getUniformLocation(program, "u_resolution"),
    videoAspect: gl.getUniformLocation(program, "u_videoAspect"),
  };

  const videoTex = createStreamTexture(gl);
  let maskTex = null;

  // --- per-frame state ---
  let raf = 0;
  let running = false;
  let active = false; // true once mask + first video frame are up and we've revealed the canvas
  let destroyed = false;
  let disabled = false; // set when we fall back permanently (context lost / fatal upload)
  let suspended = false; // set when an external authority (power saver) wants us paused
  let startTime = 0; // set on first frame (Date.now is fine; only used for shader time)
  let intensity = 0;
  let intensityScale = 1;
  let parallaxX = 0;
  let parallaxY = 0;

  // Dynamic quality (dropped-frame watchdog). Scales the device DPR cap down on
  // weak GPUs to protect 60fps. lastTs/frameAccum/frameCount accumulate the
  // rolling frame-time average; reset on every (re)start so a pause gap or the
  // first post-resume frame never counts as a slow frame.
  let qualityScale = 1;
  let lastTs = 0;
  let frameAccum = 0;
  let frameCount = 0;

  // Latest timeline state, refreshed by the subscriber. We read it in the draw
  // loop rather than rendering from inside the timeline tick so the GL frame is
  // driven by this module's own rAF (decoupled, and pausable independently).
  let state = timeline.getState();
  const unsubscribe = timeline.subscribe((_p, s) => {
    state = s;
  });

  function resize() {
    const dpr =
      Math.min(window.devicePixelRatio || 1, maxDprForDevice()) * qualityScale;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  // Roll the frame-time average and, on a sustained shortfall, step the internal
  // resolution down (re-applied by resize() next frame). Downgrade-only.
  function monitorFrame(tsMs) {
    if (!active || !lastTs) return; // skip the first frame after each (re)start
    frameAccum += tsMs - lastTs;
    frameCount++;
    if (frameCount < FRAME_WINDOW) return;
    const avgMs = frameAccum / frameCount;
    frameAccum = 0;
    frameCount = 0;
    if (avgMs > SLOW_FRAME_MS && qualityScale > MIN_QUALITY) {
      qualityScale = Math.max(MIN_QUALITY, qualityScale - QUALITY_STEP);
      warn(`frame budget exceeded (${avgMs.toFixed(1)}ms avg) → quality ${qualityScale.toFixed(2)}`);
    }
  }

  function updateIntensity(tSec) {
    const base = sceneBaseIntensity(state.scene, state.sceneProgress);
    // Scroll-velocity surge: fast scrolling kicks the glitch harder, so it feels
    // reactive rather than purely positional.
    const surge = Math.min(0.35, Math.abs(state.velocity) * 28);
    // Time-based flicker, scaled by base so a clean sky never shimmers.
    const flicker =
      (Math.sin(tSec * 7.0) * 0.5 + Math.sin(tSec * 13.0 + 1.3) * 0.3) * 0.08 * base;
    const target = clamp01((base + surge + flicker) * intensityScale);
    // Smooth toward the target so scene boundaries don't snap.
    intensity += (target - intensity) * 0.15;

    // Subtle sky parallax: drift the sky sample with overall scroll. Kept tiny
    // and bounded so it never pulls foreground content up past the mask.
    const targetPY = (state.progress - 0.5) * 0.05; // ±0.025 of video height
    parallaxY += (targetPY - parallaxY) * 0.1;
    parallaxX += (0 - parallaxX) * 0.1;
  }

  // draw is always invoked as a requestAnimationFrame callback, so the browser
  // hands us a monotonic DOMHighResTimeStamp (tsMs) — we use that for the shader
  // clock rather than Date.now(), which can jump on NTP/sleep.
  function draw(tsMs) {
    if (!running) return;
    raf = window.requestAnimationFrame(draw);

    resize();
    monitorFrame(tsMs);
    lastTs = tsMs;

    // Upload the current video frame. Guard until the video actually has pixels;
    // before that the poster (CSS background) is what the user sees.
    const haveFrame = video.readyState >= 2 && video.videoWidth > 0;
    if (haveFrame) {
      gl.bindTexture(gl.TEXTURE_2D, videoTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      } catch (err) {
        // A cross-origin/tainted source would throw here. Treat as fatal for the
        // GL path and fall back to plain video rather than spinning a dead loop.
        warn("video texImage2D failed → plain video hero", err);
        fallback();
        return;
      }
      if (!active) {
        // First good frame: reveal the canvas (CSS cross-fades it in over the
        // already-playing video / poster) and start the shader clock.
        active = true;
        startTime = tsMs;
        canvas.classList.add("is-ready");
      }
    }

    // Shader time measured from the first active frame (0 until then).
    const tSec = startTime ? (tsMs - startTime) / 1000 : 0;
    updateIntensity(tSec);

    if (!active || !maskTex) return; // nothing meaningful to render yet

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.uniform1i(u.video, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.uniform1i(u.mask, 1);

    gl.uniform1f(u.time, tSec);
    gl.uniform1f(u.intensity, intensity);
    gl.uniform2f(u.parallax, parallaxX, parallaxY);
    gl.uniform2f(u.resolution, canvas.width, canvas.height);
    gl.uniform1f(u.videoAspect, VIDEO_ASPECT);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function start() {
    // `disabled` covers a permanent fallback (context lost / fatal upload): the
    // power saver may call resume() on tab-return, and we must not revive a dead
    // GL path. Reset the frame-time accumulators so the gap while paused — or the
    // first frame after resuming — never counts as a slow frame.
    if (running || destroyed || disabled) return;
    lastTs = 0;
    frameAccum = 0;
    frameCount = 0;
    running = true;
    raf = window.requestAnimationFrame(draw);
  }

  function stop() {
    running = false;
    if (raf) {
      window.cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  // External pause/resume (the power saver). `suspended` is separate from the
  // internal `running` so a pause requested BEFORE the async mask load finishes
  // is remembered: the mask-load `.then()` only auto-starts when not suspended,
  // so we never spin the loop on a hidden/offscreen tab just because the mask
  // happened to resolve late.
  function suspend() {
    suspended = true;
    stop();
  }
  function resume() {
    suspended = false;
    start();
  }

  // Tear down the GL path and hand the hero back to the plain <video>. This is a
  // one-way trip: `disabled` blocks any later resume() from reviving a dead path.
  function fallback() {
    disabled = true;
    stop();
    document.documentElement.dataset.glitch = "off";
    canvas.classList.remove("is-ready");
  }

  // --- context-loss handling: don't silently freeze on a dead context --------
  function onContextLost(e) {
    e.preventDefault(); // allow a potential restore
    warn("WebGL context lost → plain video hero");
    fallback();
  }
  canvas.addEventListener("webglcontextlost", onContextLost, false);

  // Pausing while the tab is hidden / the hero is offscreen (to save battery) is
  // owned by the single power-saver authority in main.js, which calls pause()/
  // resume() here alongside the timeline and the video. (No own visibilitychange
  // listener — one authority avoids the two fighting over the run state.)

  // Signal CSS that the glitch canvas owns the hero. The canvas itself only
  // becomes visible once `.is-ready` is added (first rendered frame), so the
  // poster→video→canvas hand-off stays seamless.
  document.documentElement.dataset.glitch = "on";

  // Kick off: load the mask, then run. If the mask never loads we cannot gate
  // safely, so we fall back rather than risk glitching the foreground.
  loadMaskTexture(gl)
    .then((tex) => {
      if (destroyed) {
        gl.deleteTexture(tex);
        return;
      }
      maskTex = tex;
      // Honor a pause the power saver requested while the mask was loading
      // (page opened on a hidden/offscreen tab) instead of starting regardless.
      if (!suspended) start();
    })
    .catch((err) => {
      warn(err.message, "→ plain video hero");
      fallback();
    });

  return {
    get isActive() {
      return active;
    },
    pause: suspend,
    resume,
    /**
     * Scale the timeline-driven intensity (0 = clean, 1 = full). Hook for the
     * hardening ticket (reduced-motion shimmer, weak-GPU dial-down).
     * @param {number} s
     */
    setIntensityScale(s) {
      intensityScale = Math.max(0, Number(s) || 0);
    },
    destroy() {
      destroyed = true;
      stop();
      unsubscribe();
      canvas.removeEventListener("webglcontextlost", onContextLost, false);
      gl.deleteTexture(videoTex);
      if (maskTex) gl.deleteTexture(maskTex);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      delete document.documentElement.dataset.glitch;
    },
  };
}
