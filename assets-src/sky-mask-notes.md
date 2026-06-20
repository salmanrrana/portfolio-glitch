# Sky mask — analysis, asset, and shader-consumption notes

The glitch effect must be confined to the **sky** only; the field, hills, and
horses stay pixel-clean. This doc records the footage analysis, the mask
strategy, the exact UV mapping the WebGL shader must use, and how to regenerate
and verify the mask.

**Asset:** `public/assets/sky-mask.png` — 1920×1080, 8-bit grayscale,
**white (255) = sky → glitch allowed**, **black (0) = foreground → protected**,
with a feathered edge.

---

## 1. Horizon analysis (Step 1)

Sample frames were extracted across the encoded loop
(`ffmpeg -ss <t> -i public/assets/hero-1080.mp4 -frames:v 1 …` at
t = 0, 3, 6, 9, 12, 14.5 s) and inspected.

- **Camera: locked / static.** The tree line is pixel-identical between frame 0
  and frame 14.5 — only the clouds drift and the horses shuffle, both well clear
  of the boundary. This is what makes a single **baked static mask** correct: no
  per-frame cost and no edge "breathing" onto the horses.
- **Horizon: irregular, NOT a flat line.** A dark tree canopy runs the full
  width, **rising into a forested hill on the right** and dipping through the
  centre. Sky fills roughly the top ~45% of the frame. The detected protection
  boundary sits between rows **404** (tallest trees / right-hand hill, ~37% down)
  and **503** (centre dip, ~47% down).
- **Nothing foreground pokes into the sky.** The horse heads and the fence are
  all *below* the canopy, so the canopy top is the entire sky boundary — no
  islands of protection are needed inside the sky.

**Decision:** baked grayscale PNG mask traced to the canopy (the ticket's
preferred "static alpha mask" path), generated deterministically from the
footage by `assets-src/make-sky-mask.py` so it is repeatable after any re-encode.

## 2. How the boundary is derived (zero-bleed guarantee)

`make-sky-mask.py` (see its header for full detail):

1. Classifies every pixel sky vs foreground (blue/cloud vs green/dark).
2. Per column, finds the **first** confirmed foreground pixel scanning top→down
   (a short confirm-run rejects single-pixel JPEG noise but still stops at the
   very top of a real tree, so sparse treetops stay protected).
3. Takes the **most conservative (highest) boundary per column across all sampled
   frames**, then a horizontal min-filter so thin branches between columns are
   protected too.
4. Lifts the fully-opaque sky region **`SAFETY_MARGIN` px above** the canopy and
   Gaussian-feathers, so the entire soft edge finishes (reaches black) at/above
   the real canopy. Trees therefore receive mask = 0. We deliberately
   **under-glitch a sliver of true sky rather than ever bleed onto foreground.**

## 3. UV mapping for the WebGL shader (Step 2 — `object-fit: cover`)

The mask is authored in the **same 1920×1080 space as the video**, so it maps
**1:1 to the video texture**. The shader MUST sample the mask with the **exact
same cover-fit UVs** it uses for the video — sample against the *video*, not the
*screen*. GLSL:

```glsl
// u_resolution = canvas size (px); video/mask are both 1920x1080.
const float videoAspect = 16.0 / 9.0;
float viewAspect = u_resolution.x / u_resolution.y;

vec2 scale = (viewAspect > videoAspect)
    ? vec2(1.0, videoAspect / viewAspect)   // viewport wider  -> crop top/bottom
    : vec2(viewAspect / videoAspect, 1.0);  // viewport taller -> crop left/right

vec2 uv = (screenUv - 0.5) / scale + 0.5;   // SAME uv for u_video and u_mask
vec4 clean = texture2D(u_video, uv);
float m    = texture2D(u_mask,  uv).r;       // 1 = sky, 0 = protected
gl_FragColor = mix(clean, glitch, m * u_intensity);
```

- Use **`CLAMP_TO_EDGE`** wrapping on the mask (and video) so the cropped-away
  margins resolve to the nearest edge — sky stays sky, foreground stays
  foreground — instead of wrapping the opposite edge in.
- For parallax, offset the **sky** sample only and keep the foreground put: e.g.
  read the mask at base `uv`, and add `u_parallax` to the *glitch* sampling
  inside the masked region, so `m` still gates by the true horizon.
- The 2-D canvas reference implementation of this identical mapping lives in
  `assets-src/verify-sky-mask.html` (`coverRect()`), which is how the mask was
  verified to stay locked under cover-fit at 9:16 / 1:1 / 16:9 / 21:9.

## 4. Regenerate

```sh
# defaults: VIDEO=public/assets/hero-1080.mp4 OUT=public/assets/sky-mask.png
python3 assets-src/make-sky-mask.py

# tune if the footage/encode changes (all overridable via env):
SAFETY_MARGIN=18 FEATHER_RADIUS=6 SAMPLE_TIMES=0,2,4,6,8,10,12,14 \
  python3 assets-src/make-sky-mask.py
```

Requires `numpy`, `Pillow`, and `ffmpeg` on PATH. Re-run after any change to the
loop window or resolution in `scripts/encode-video.sh` so the mask stays aligned.

## 5. Verify (Step 3)

- **Static evidence:** `assets-src/sky-mask-overlay.jpg` — the mask's glitchable
  region tinted red over a real frame with the boundary drawn green. The red
  covers the sky/clouds and stops at the canopy with a safety gap; it touches **no**
  tree, hill, or horse.
- **Live, in-browser:** serve the repo root and open
  `http://localhost:8000/assets-src/verify-sky-mask.html`. Overlays the mask on
  the playing video using the cover-fit mapping above; switch aspect ratios to
  confirm the boundary stays locked to the video, and use "Punch-through" to see
  exactly which pixels glitch.
