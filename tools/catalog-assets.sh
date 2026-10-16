#!/bin/sh
# Catalog every downloaded Sketchfab asset (pieces + labelled contact sheet).
# Skips assets that already have a catalog. Usage: sh tools/catalog-assets.sh
cd "$(dirname "$0")/.." || exit 1
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
for dir in assets-src/sketchfab/*/*/; do
  dir=${dir%/}
  [ -f "$dir/sheet_labeled.png" ] && continue
  [ -f "$dir/source.json" ] || continue
  if "$BLENDER" -b -P tools/blender/catalog_asset.py -- "$dir" 2>&1 | grep -E "^CATALOG"; then
    python3 tools/label-sheet.py "$dir"
  else
    echo "FAILED $dir"
  fi
done
