#!/usr/bin/env bash
#
# encode-video.sh — transcode the raw hero .MOV into web-optimized assets.
# Run from the repo root:  ./scripts/encode-video.sh
#
# ============================================================================
# SOURCE METADATA — horses-be-chillin.MOV  (probed 2026-06-20 via `ffmpeg -i`)
# ----------------------------------------------------------------------------
#   Container  : QuickTime / MOV
#   Video      : HEVC (H.265) Main 10, hvc1, 10-bit (yuv420p10le)
#   Color      : BT.2020 primaries + HLG transfer (arib-std-b67)  -> HDR
#   Resolution : 1920 x 1080   (16:9, square pixels)
#   Frame rate : 29.97 fps
#   Duration   : 51.01 s (full source)
#   Rotation   : none (no display matrix)
#   Audio      : present in source; STRIPPED from every output (silent bg loop)
#   Shot       : locked/static camera; horizon ~46% from top; sky fills the
#                top ~45%; three horses graze centrally; clouds drift slowly.
#
# Downstream tickets depend on these exact dimensions / aspect ratio:
#   - sky-mask ticket : author sky-mask.png at 1920x1080 (white=sky/black=keep)
#   - WebGL shader    : samples the video as a 16:9 texture; UVs are cover-fit
# ============================================================================
#
# WHY tonemap? The source is HDR (BT.2020 / HLG). A naive 8-bit SDR transcode
#   looks washed-out and grey. We tonemap HLG BT.2020 -> BT.709 SDR (hable) so
#   the web outputs keep the correct vivid blue sky and green grass, and tag
#   the outputs as BT.709 so browsers display them correctly.
#
# WHY a ~15s loop window instead of the full 51s? The dense, wind-blown grass
#   is expensive to compress: the full clip at good quality is ~27-47 MB, far
#   over the <10 MB budget. The shot is a static lock, so it loops fine from a
#   tighter window — and a shorter window also shrinks the cloud-drift "jump"
#   at the loop seam. The sky (where any cloud seam lives) is later corrupted
#   by the glitch shader, hiding it further. Re-cut via START/DURATION below.
#
# WHY MP4 (H.264) + WebM (VP9), 1080 + 720? H.264 MP4 is universal (iOS Safari
#   especially); VP9 WebM is smaller for browsers that support it. 720 variants
#   serve phones / small viewports. `+faststart` puts the moov atom up front so
#   playback can begin before the full file downloads.
#
set -euo pipefail

# --- Config (override any of these via environment variables) ---------------
SRC="${SRC:-/home/xtra/Downloads/horses-be-chillin.MOV}"
OUT_DIR="${OUT_DIR:-public/assets}"
FFMPEG="${FFMPEG:-ffmpeg}"

START="${START:-1.5}"          # loop window start, seconds into the source
DURATION="${DURATION:-15}"     # loop window length, seconds

CRF_1080="${CRF_1080:-26}"     # H.264 quality (lower = better/larger)
CRF_720="${CRF_720:-27}"
VP9_CRF_1080="${VP9_CRF_1080:-40}"  # VP9 quality (VP9 CRF scale differs from x264;
VP9_CRF_720="${VP9_CRF_720:-42}"    #   tuned so each WebM is SMALLER than its MP4)
X264_PRESET="${X264_PRESET:-slow}"
VP9_CPU="${VP9_CPU:-2}"        # libvpx-vp9 effort (lower = slower/better)

POSTER_W="${POSTER_W:-1280}"        # poster width; dense grass won't fit <200KB at 1920
POSTER_MAX_KB="${POSTER_MAX_KB:-200}"

# The poster is the FIRST frame of the loop window (== the video's first shown
# frame), so the poster -> video handoff on `canplay` has no visible jump.
POSTER_AT="$START"

# HDR (BT.2020/HLG) -> SDR (BT.709) tonemap. Shared by every output.
TONEMAP="zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv"

# BT.709 SDR color tags so browsers don't second-guess the color space.
COLOR_TAGS=(-color_primaries bt709 -color_trc bt709 -colorspace bt709)

# ---------------------------------------------------------------------------
log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

human_size() { # bytes -> "X.XX MB" / "XXX KB"
  local b=$1
  if [ "$b" -ge 1048576 ]; then awk "BEGIN{printf \"%.2f MB\", $b/1048576}"
  else awk "BEGIN{printf \"%.0f KB\", $b/1024}"; fi
}

[ -f "$SRC" ] || die "Source video not found: $SRC  (set SRC=/path/to/file.MOV)"
command -v "$FFMPEG" >/dev/null 2>&1 || die "ffmpeg not found (set FFMPEG=/path/to/ffmpeg)"
mkdir -p "$OUT_DIR"

log "Source : $SRC"
log "Window : ${START}s for ${DURATION}s  (loop)"
log "Output : $OUT_DIR/"
echo

# --- H.264 MP4 (1080 + 720) -------------------------------------------------
encode_h264() { # <width> <crf> <outfile>
  local w=$1 crf=$2 out=$3
  log "H.264  -> $out  (${w}px wide, crf $crf, preset $X264_PRESET)"
  "$FFMPEG" -hide_banner -y -ss "$START" -t "$DURATION" -i "$SRC" \
    -map 0:v:0 -an -map_metadata -1 \
    -vf "${TONEMAP},scale=${w}:-2,format=yuv420p" \
    -c:v libx264 -preset "$X264_PRESET" -profile:v high -crf "$crf" \
    -pix_fmt yuv420p "${COLOR_TAGS[@]}" \
    -movflags +faststart \
    "$out" 2>/dev/null
}

# --- VP9 WebM (1080 + 720) --------------------------------------------------
encode_vp9() { # <width> <crf> <outfile>
  local w=$1 crf=$2 out=$3
  log "VP9    -> $out  (${w}px wide, crf $crf, cpu-used $VP9_CPU)"
  "$FFMPEG" -hide_banner -y -ss "$START" -t "$DURATION" -i "$SRC" \
    -map 0:v:0 -an -map_metadata -1 \
    -vf "${TONEMAP},scale=${w}:-2,format=yuv420p" \
    -c:v libvpx-vp9 -b:v 0 -crf "$crf" -row-mt 1 -deadline good -cpu-used "$VP9_CPU" \
    -pix_fmt yuv420p "${COLOR_TAGS[@]}" \
    "$out" 2>/dev/null
}

encode_h264 1920 "$CRF_1080" "$OUT_DIR/hero-1080.mp4"
encode_h264 1280 "$CRF_720"  "$OUT_DIR/hero-720.mp4"
encode_vp9  1920 "$VP9_CRF_1080" "$OUT_DIR/hero-1080.webm"
encode_vp9  1280 "$VP9_CRF_720"  "$OUT_DIR/hero-720.webm"

# --- Poster (first frame of the loop window) --------------------------------
# Step the JPEG quality down until it fits the poster byte budget.
log "Poster -> $OUT_DIR/hero-poster.jpg  (frame at ${POSTER_AT}s, <= ${POSTER_MAX_KB} KB)"
poster="$OUT_DIR/hero-poster.jpg"
for q in 4 5 6 7 8; do
  "$FFMPEG" -hide_banner -y -ss "$POSTER_AT" -i "$SRC" -frames:v 1 -update 1 \
    -vf "${TONEMAP},scale=${POSTER_W}:-2,format=yuv420p" -q:v "$q" "$poster" 2>/dev/null
  kb=$(( $(stat -c%s "$poster") / 1024 ))
  if [ "$kb" -le "$POSTER_MAX_KB" ]; then break; fi
done

# --- faststart verification (no ffprobe/mediainfo needed) -------------------
# Parses the MP4 top-level atom order and asserts moov appears before mdat.
verify_faststart() { # <mp4>
  local f=$1
  if ! command -v python3 >/dev/null 2>&1; then warn "python3 missing; skipped faststart check for $f"; return 0; fi
  python3 - "$f" <<'PY'
import struct, sys
order = []
with open(sys.argv[1], 'rb') as fh:
    while True:
        hdr = fh.read(8)
        if len(hdr) < 8: break
        size = struct.unpack('>I', hdr[:4])[0]
        typ  = hdr[4:8].decode('latin1', 'replace')
        order.append(typ)
        if size == 1:        # 64-bit extended size
            size = struct.unpack('>Q', fh.read(8))[0]; fh.seek(size - 16, 1)
        elif size == 0:      # extends to EOF
            break
        else:
            fh.seek(size - 8, 1)
try:
    ok = order.index('moov') < order.index('mdat')
except ValueError:
    ok = False
print("OK" if ok else "FAIL", "atoms:", " ".join(order))
sys.exit(0 if ok else 1)
PY
}

# --- Summary ----------------------------------------------------------------
echo
log "Results (window ${DURATION}s @ ${START}s):"
printf '%-22s %12s  %s\n' "FILE" "SIZE" "FASTSTART"
for f in hero-1080.mp4 hero-720.mp4 hero-1080.webm hero-720.webm hero-poster.jpg; do
  p="$OUT_DIR/$f"; [ -f "$p" ] || { warn "missing: $p"; continue; }
  size_h=$(human_size "$(stat -c%s "$p")")
  fs="-"
  case "$f" in
    *.mp4) if verify_faststart "$p" >/tmp/.fs 2>&1; then fs="yes"; else fs="NO"; fi ;;
  esac
  printf '%-22s %12s  %s\n' "$f" "$size_h" "$fs"
done
echo
log "Done. Outputs in $OUT_DIR/  (audio stripped, HDR->SDR tonemapped, BT.709)."
