#!/bin/sh
# Regenerate every glTF asset from its Blender script (author-time only —
# players never run this; the .glb output is committed).
# Usage: tools/build-models.sh
set -e
cd "$(dirname "$0")/.."
BLENDER="${BLENDER:-/opt/homebrew/bin/blender}"

for script in tools/models/*.py; do
  name=$(basename "$script" .py)
  echo "== $name"
  "$BLENDER" --background --python "$script" -- "assets/models/$name.glb" | grep -Ev '^(Blender|Read prefs)' || true
done
echo "done."
