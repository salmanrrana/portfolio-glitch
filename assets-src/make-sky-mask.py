#!/usr/bin/env python3
"""
make-sky-mask.py — derive the pixel-perfect sky mask for the glitch shader.

Run from the repo root:  python3 assets-src/make-sky-mask.py
(Requires: numpy, Pillow, and ffmpeg on PATH.)

============================================================================
WHAT THIS PRODUCES
----------------------------------------------------------------------------
  public/assets/sky-mask.png   1920x1080, 8-bit grayscale
                               white (255) = sky      -> glitch ALLOWED
                               black (0)   = foreground -> glitch PROTECTED
  assets-src/sky-mask-overlay.jpg   debug evidence: the mask boundary + a
                               red tint drawn over a real frame, proving the
                               white region hugs the sky and never touches the
                               trees / hills / horses.

The shader samples `m = texture(u_mask, uv).r` and outputs
  mix(cleanVideo, glitch, m * u_intensity)
so foreground pixels (m=0) are always the clean video.

============================================================================
SOURCE FOOTAGE — horses-be-chillin (encoded hero-1080.mp4)
----------------------------------------------------------------------------
  Dimensions : 1920 x 1080 (16:9, square pixels) — matches every hero encode.
  Camera     : LOCKED / static. The tree line is pixel-identical across the
               whole loop (verified frame 0 vs frame 14.5); only the clouds
               drift and the horses shuffle — both well clear of the boundary.
               => a single BAKED static mask is correct (no per-frame cost,
                  no edge "breathing"). See ticket for the analysis.
  Horizon    : NOT a flat line. An irregular dark tree canopy runs the full
               width, rising into a forested HILL on the right and dipping in
               the centre. Sky fills roughly the top ~45%. Nothing in the
               foreground (horse heads, fence) pokes above the canopy into the
               sky, so the canopy top IS the sky boundary.

============================================================================
HOW THE BOUNDARY IS FOUND (and why it can't bleed)
----------------------------------------------------------------------------
  1. Sample several frames across the loop and classify every pixel as
     sky vs foreground (blue/cloud vs green/dark — see is_sky()).
  2. Per column, scan top->down and record the FIRST foreground pixel (a short
     confirm-run rejects single-pixel JPEG noise but still stops at the very
     top of a real tree, so sparse treetops stay protected).
  3. Take the most conservative (highest) boundary per column ACROSS frames,
     then a horizontal min-filter so thin branches between columns stay
     protected too. The boundary therefore tracks the HIGHEST foreground seen.
  4. SAFETY MARGIN: lift the fully-opaque sky region SAFETY_MARGIN px above the
     detected canopy, then Gaussian-feather. Because the whole feather ramp is
     tuned to finish (reach black) at/above the real canopy, the trees receive
     mask=0 — we'd rather under-glitch a sliver of true sky than ever bleed
     onto the foreground. This is the "fucking perfect, zero bleed" guarantee.

============================================================================
UV MAPPING (for the WebGL shader ticket)
----------------------------------------------------------------------------
  The mask is authored in the SAME 1920x1080 space as the video, so it maps
  1:1 to the video texture. The shader must therefore sample the mask with the
  EXACT SAME cover-fit UVs it uses for the video — NOT screen UVs. Concretely:

    videoAspect = 1920/1080 = 16/9
    viewAspect  = canvas.width / canvas.height
    // object-fit: cover -> scale so the SHORTER axis fills, crop the longer
    if (viewAspect > videoAspect) {           // viewport wider than video
        scale = vec2(1.0, videoAspect/viewAspect);
    } else {                                   // viewport taller than video
        scale = vec2(viewAspect/videoAspect, 1.0);
    }
    uv = (screenUv - 0.5) / scale + 0.5;       // same uv for u_video AND u_mask

  Sampling both textures with this identical `uv` keeps the mask locked to the
  video under object-fit: cover at every viewport aspect ratio (desktop +
  mobile portrait/landscape). The mask must use CLAMP_TO_EDGE wrapping so the
  cropped-away margins resolve to the nearest edge (sky stays sky, foreground
  stays foreground) instead of wrapping.
============================================================================
"""

import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageFilter

# --- Config (override via environment variables) ----------------------------
VIDEO = os.environ.get("VIDEO", "public/assets/hero-1080.mp4")
OUT = os.environ.get("OUT", "public/assets/sky-mask.png")
OVERLAY = os.environ.get("OVERLAY", "assets-src/sky-mask-overlay.jpg")
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")

# Frame sample times (seconds) across the ~15s loop window. The boundary is the
# most-conservative across all of these, so transient clouds/horses can't open
# a hole in the protection.
SAMPLE_TIMES = [float(t) for t in os.environ.get("SAMPLE_TIMES", "0,3,6,9,12,14.5").split(",")]

CONFIRM_RUN = 3      # consecutive foreground rows needed to confirm the canopy
SAFETY_MARGIN = 14   # px to lift the opaque sky region above the canopy
FEATHER_RADIUS = 5   # px Gaussian blur for a soft, seamless edge
COL_MIN_WINDOW = 9   # horizontal min-filter window (protect between-col branches)


def run_ffmpeg_frame(time_s, dst):
    """Extract a single frame at `time_s` from the encoded hero video."""
    cmd = [FFMPEG, "-loglevel", "error", "-y", "-ss", str(time_s),
           "-i", VIDEO, "-frames:v", "1", dst]
    subprocess.run(cmd, check=True)


def is_sky(rgb):
    """Boolean (H,W) sky map. Sky = blue sky OR bright cloud, never green/dark.

    rgb: (H,W,3) uint8. Foreground here is green trees/grass, the dark forested
    hill, and brown horses — all easily separated from blue sky + white cloud.
    """
    r = rgb[..., 0].astype(np.int16)
    g = rgb[..., 1].astype(np.int16)
    b = rgb[..., 2].astype(np.int16)
    brightness = (r + g + b) / 3.0
    greenness = g - np.maximum(r, b)   # >0 => green-dominant (trees/grass)
    blueness = b - g                   # >0 => blue-dominant (sky)

    blue_sky = (blueness > 0) & (brightness > 110)
    cloud = np.minimum(np.minimum(r, g), b) > 165          # near-white, bright
    foreground = (greenness > 6) | (brightness < 72) | (r > b + 12)

    return (blue_sky | cloud) & ~foreground


def column_horizon(sky):
    """For each column, the row index of the FIRST confirmed foreground pixel
    scanning top->down. Columns that are sky all the way down return H."""
    h, w = sky.shape
    fg = ~sky
    horizon = np.full(w, h, dtype=np.int32)
    for x in range(w):
        col = fg[:, x]
        run = 0
        start = -1
        for y in range(h):
            if col[y]:
                if run == 0:
                    start = y
                run += 1
                if run >= CONFIRM_RUN:
                    horizon[x] = start   # the TOP of the confirmed run
                    break
            else:
                run = 0
                start = -1
    return horizon


def horizontal_min(arr, window):
    """Min over a sliding horizontal window (highest boundary => most protective)."""
    pad = window // 2
    padded = np.pad(arr, pad, mode="edge")
    out = np.empty_like(arr)
    for i in range(len(arr)):
        out[i] = padded[i:i + window].min()
    return out


def main():
    if not os.path.exists(VIDEO):
        sys.exit(f"[make-sky-mask] video not found: {VIDEO} (run the encode script first)")

    tmp = tempfile.mkdtemp(prefix="skymask_")
    frames = []
    for i, t in enumerate(SAMPLE_TIMES):
        dst = os.path.join(tmp, f"f{i}.png")
        run_ffmpeg_frame(t, dst)
        frames.append(np.asarray(Image.open(dst).convert("RGB")))

    h, w, _ = frames[0].shape
    print(f"[make-sky-mask] {len(frames)} frames @ {w}x{h}")

    # Most-conservative (highest) canopy per column across all sampled frames.
    horizon = np.full(w, h, dtype=np.int32)
    for f in frames:
        horizon = np.minimum(horizon, column_horizon(is_sky(f)))
    horizon = horizontal_min(horizon, COL_MIN_WINDOW)

    # Lift the opaque sky region above the canopy, then build a per-column step.
    boundary = np.clip(horizon - SAFETY_MARGIN, 0, h)
    rows = np.arange(h).reshape(h, 1)
    mask = (rows < boundary.reshape(1, w)).astype(np.float32) * 255.0

    # Feather the edge so there is no hard seam. The ramp lives ABOVE the canopy
    # (see header), so feathering never pushes white onto the trees.
    mask_img = Image.fromarray(mask.astype(np.uint8), mode="L")
    mask_img = mask_img.filter(ImageFilter.GaussianBlur(FEATHER_RADIUS))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    mask_img.save(OUT)
    sky_pct = 100.0 * float(boundary.mean()) / h
    print(f"[make-sky-mask] wrote {OUT}  (sky covers ~{sky_pct:.1f}% of height)")

    # --- Debug evidence overlay: prove zero bleed -------------------------------
    base = frames[0].copy()
    m = np.asarray(mask_img).astype(np.float32) / 255.0   # (H,W) 0..1
    # Red tint where the mask says "glitchable sky": if any of that red lands on
    # a tree/hill/horse, the mask is wrong. It must hug the sky only.
    tint = np.zeros_like(base, dtype=np.float32)
    tint[..., 0] = 255.0
    overlaid = base.astype(np.float32) * (1 - 0.45 * m[..., None]) + tint * (0.45 * m[..., None])
    # Draw the hard boundary line bright green for a crisp read of the edge.
    for x in range(w):
        yb = int(boundary[x])
        if 0 <= yb < h:
            overlaid[max(0, yb - 1):yb + 1, x] = (0, 255, 0)
    os.makedirs(os.path.dirname(OVERLAY), exist_ok=True)
    overlay_img = Image.fromarray(np.clip(overlaid, 0, 255).astype(np.uint8))
    # JPEG keeps this evidence frame small (it's a screenshot, not an asset).
    save_kwargs = {"quality": 88} if OVERLAY.lower().endswith((".jpg", ".jpeg")) else {}
    overlay_img.save(OVERLAY, **save_kwargs)
    print(f"[make-sky-mask] wrote {OVERLAY}  (red=glitchable sky, green=boundary)")


if __name__ == "__main__":
    main()
