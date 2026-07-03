#!/bin/sh
# Regenerate every glTF asset from its Blender script (author-time only —
# players never run this; the .glb output is committed).
# Usage: tools/build-models.sh
set -e
cd "$(dirname "$0")/.."
BLENDER="${BLENDER:-/opt/homebrew/bin/blender}"

for script in tools/models/*.py; do
  name=$(basename "$script" .py)
  [ "$name" = "common" ] && continue
  echo "== $name"
  "$BLENDER" --background --python "$script" -- "assets/models/$name.glb" | grep -Ev '^(Blender|Read prefs)' || true
  # size pass. Conservative flags on purpose: join/flatten/palette would merge
  # nodes and destroy the load-bearing names (rotor, glow, <style>_<tier>);
  # quantize is the only compression GLTFLoader decodes without extra runtime.
  npx --yes @gltf-transform/cli optimize "assets/models/$name.glb" "assets/models/$name.glb" \
    --join false --palette false --flatten false --simplify false \
    --compress quantize --texture-compress webp 2>&1 | grep -E 'info:' || true
done
echo "done."
