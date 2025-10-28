#!/bin/zsh
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <output-icon-path>" >&2
  exit 1
fi

out="$1"
mkdir -p "$(dirname "$out")"

# Requires ImageMagick (magick/convert)
convert -size 512x512 canvas:none -colorspace sRGB \
  -stroke black -strokewidth 16 -fill none \
  -draw "circle 256,256 256,56" \
  -draw "line 256,120 256,392" \
  -draw "line 120,256 392,256" \
  PNG32:"$out"

file "$out" | sed 's/^/Generated icon: /'






