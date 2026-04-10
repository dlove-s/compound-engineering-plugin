#!/usr/bin/env bash
set -euo pipefail

# Evidence capture pipeline — handles stitching, normalization, size optimization, and upload.
# The agent calls this script instead of running ffmpeg/curl commands individually.
#
# Usage:
#   bash scripts/capture-evidence.sh stitch output.gif frame1.png frame2.png [frame3.png ...]
#   bash scripts/capture-evidence.sh stitch --duration 2.5 output.gif frame1.png frame2.png
#   bash scripts/capture-evidence.sh upload file.gif
#   bash scripts/capture-evidence.sh upload file.png

MAX_GIF_SIZE=$((10 * 1024 * 1024))  # 10 MB — GitHub inline render limit
TARGET_GIF_SIZE=$((5 * 1024 * 1024)) # 5 MB — preferred target

CATBOX_API="https://catbox.moe/user/api.php"

# --- Helpers ---

die() { echo "ERROR: $*" >&2; exit 1; }

check_tool() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is not installed. Install with: $2"
}

file_size() {
  stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null
}

file_size_mb() {
  local bytes
  bytes=$(file_size "$1")
  echo "scale=1; $bytes / 1048576" | bc
}

# --- Stitch: normalize frames + create GIF ---

cmd_stitch() {
  local duration=3.0
  local output=""
  local frames=()

  # Parse args
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --duration) duration="$2"; shift 2 ;;
      *)
        if [[ -z "$output" ]]; then
          output="$1"
        else
          frames+=("$1")
        fi
        shift
        ;;
    esac
  done

  [[ -n "$output" ]] || die "Usage: stitch [--duration N] output.gif frame1.png [frame2.png ...]"
  [[ ${#frames[@]} -gt 0 ]] || die "No input frames provided"

  # Validate all frames exist before checking tools
  for f in "${frames[@]}"; do
    [[ -f "$f" ]] || die "Frame not found: $f"
  done

  check_tool ffmpeg "brew install ffmpeg"
  check_tool ffprobe "brew install ffmpeg"

  echo "Stitching ${#frames[@]} frames into GIF (${duration}s per frame)..."

  local tmpdir
  tmpdir=$(mktemp -d -t evidence-stitch-XXXX)
  trap "rm -rf '$tmpdir'" EXIT

  # Step 1: Detect max dimensions across all frames
  local max_w=0 max_h=0
  for f in "${frames[@]}"; do
    local dims
    dims=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$f")
    local w h
    w=$(echo "$dims" | cut -d, -f1)
    h=$(echo "$dims" | cut -d, -f2)
    [[ $w -gt $max_w ]] && max_w=$w
    [[ $h -gt $max_h ]] && max_h=$h
  done

  # Ensure dimensions are even (required for many codecs)
  [[ $((max_w % 2)) -ne 0 ]] && max_w=$((max_w + 1))
  [[ $((max_h % 2)) -ne 0 ]] && max_h=$((max_h + 1))

  echo "  Target dimensions: ${max_w}x${max_h}"

  # Step 2: Normalize each frame — pad to max dimensions, centered, top-aligned
  local normalized=()
  local i=0
  for f in "${frames[@]}"; do
    local out="$tmpdir/frame_$(printf '%03d' $i).png"
    ffmpeg -y -v error \
      -i "$f" \
      -vf "scale=${max_w}:${max_h}:force_original_aspect_ratio=decrease,pad=${max_w}:${max_h}:(ow-iw)/2:0:color=black" \
      "$out"
    normalized+=("$out")
    i=$((i + 1))
  done

  echo "  Normalized ${#normalized[@]} frames"

  # Step 3: Write concat file
  local concat_file="$tmpdir/concat.txt"
  for f in "${normalized[@]}"; do
    echo "file '$(basename "$f")'"
    echo "duration $duration"
  done > "$concat_file"
  # Concat demuxer requires last file repeated without duration
  echo "file '$(basename "${normalized[${#normalized[@]}-1]}")'" >> "$concat_file"

  # Step 4: Two-pass palette generation for quality
  local palette="$tmpdir/palette.png"
  ffmpeg -y -v error \
    -f concat -safe 0 -i "$concat_file" \
    -vf "palettegen=stats_mode=diff" \
    "$palette"

  # Step 5: Generate GIF with palette
  ffmpeg -y -v error \
    -f concat -safe 0 -i "$concat_file" \
    -i "$palette" \
    -lavfi "paletteuse=dither=bayer:bayer_scale=3" \
    -loop 0 \
    "$output"

  if [[ ! -f "$output" ]]; then
    die "GIF creation failed — no output file"
  fi

  local size
  size=$(file_size "$output")
  local size_mb
  size_mb=$(file_size_mb "$output")

  echo "  Created: $output (${size_mb} MB, ${#frames[@]} frames)"

  # Step 6: Auto-reduce if over limit
  if [[ $size -gt $MAX_GIF_SIZE ]]; then
    echo "  GIF exceeds 10 MB limit. Reducing..."

    if [[ ${#frames[@]} -gt 2 ]]; then
      # Remove middle frames, keep first and last
      echo "  Dropping middle frame(s) and re-stitching..."
      local reduced_frames=()
      reduced_frames+=("${frames[0]}")
      # Keep every other middle frame
      local step=$(( (${#frames[@]} - 1) / 2 ))
      [[ $step -lt 2 ]] && step=2
      for ((j=step; j < ${#frames[@]} - 1; j+=step)); do
        reduced_frames+=("${frames[$j]}")
      done
      reduced_frames+=("${frames[${#frames[@]}-1]}")

      if [[ ${#reduced_frames[@]} -lt ${#frames[@]} ]]; then
        echo "  Reduced from ${#frames[@]} to ${#reduced_frames[@]} frames"
        # Recursive call with fewer frames
        trap - EXIT
        rm -rf "$tmpdir"
        cmd_stitch --duration "$duration" "$output" "${reduced_frames[@]}"
        return
      fi
    fi

    echo "  WARNING: Could not reduce below 10 MB. GIF may not render inline on GitHub."
  elif [[ $size -gt $TARGET_GIF_SIZE ]]; then
    echo "  Note: GIF is over 5 MB preferred target but under 10 MB limit. Acceptable."
  fi
}

# --- Upload to catbox.moe ---

cmd_upload() {
  local file="$1"
  [[ -f "$file" ]] || die "File not found: $file"

  check_tool curl "brew install curl"

  local size_mb
  size_mb=$(file_size_mb "$file")
  echo "Uploading $file (${size_mb} MB) to catbox.moe..."

  local url
  url=$(curl -s -F "reqtype=fileupload" -F "fileToUpload=@${file}" "$CATBOX_API") || true

  if [[ "$url" == https://* ]]; then
    echo "Uploaded: $url"
    echo "$url"
  else
    echo "ERROR: Upload failed. Response: ${url:0:200}" >&2
    echo "Local file preserved at: $file" >&2

    # Retry once
    echo "Retrying in 5 seconds..." >&2
    sleep 5
    url=$(curl -s -F "reqtype=fileupload" -F "fileToUpload=@${file}" "$CATBOX_API") || true
    if [[ "$url" == https://* ]]; then
      echo "Uploaded (retry): $url"
      echo "$url"
    else
      echo "ERROR: Retry also failed. Upload manually or commit to branch." >&2
      exit 1
    fi
  fi
}

# --- Main ---

case "${1:-}" in
  stitch)  shift; cmd_stitch "$@" ;;
  upload)  shift; cmd_upload "$@" ;;
  *)
    echo "Usage: capture-evidence.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  stitch [--duration N] output.gif frame1.png [frame2.png ...]"
    echo "    Normalize frame dimensions, stitch into animated GIF with two-pass palette."
    echo "    Default duration: 3s per frame. Auto-reduces if over 10 MB."
    echo ""
    echo "  upload file"
    echo "    Upload to catbox.moe. Returns public URL. Retries once on failure."
    exit 1
    ;;
esac
