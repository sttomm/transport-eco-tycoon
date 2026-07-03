# Graphics Phase 2 — real 3D assets via headless Blender

Successor to phase 1 (physical sky, IBL, GTAO/bloom/tilt-shift — see
ARCHITECTURE.md ADR 15, commits `c3cd1a6` + `88f8f84`). Phase 1 fixed
lighting and atmosphere; the remaining gap to Transport Fever is the
box-geometry models. Phase 2 replaces them with real glTF assets generated
by scripted Blender.

## Ground rules (unchanged from CLAUDE.md — read it first)

- No build step, no npm dependencies. Assets are static `.glb` files in
  `assets/models/`, loaded with `GLTFLoader` from the three CDN. One-off
  tooling (`npx gltf-transform`, Blender) runs at author time, never at
  player load time.
- Sim layer untouched. Everything here lives in `src/render/` + `assets/` +
  `tools/`. Worldgen must not change → saves stay valid, no save-version bump.
- The teaching mission's visual contracts survive: lit windows at night
  (emissive must exceed the bloom threshold 3.4 — see ADR 15), spinning
  rotors exposed as `group.userData.rotor`, solar panels visibly dark at night.
- Budget: ≥ 55 fps orbiting the city center (measure with the recipe below).

## Toolchain (verified working on this machine)

- Blender 5.1.2 at `/opt/homebrew/bin/blender`, headless:
  `blender --background --python tools/models/<script>.py -- <out.glb>`
  (smoke-tested: procedural mesh + Principled BSDF → GLB export works).
- Optional CC0 sources when hand-modeling is not worth it: Kenney.nl
  (city/vehicle kits), Quaternius (buildings), ambientCG (PBR textures).
  License note in `assets/CREDITS.md` for anything imported.
- `npx gltf-transform optimize in.glb out.glb --texture-compress webp`
  for final size passes (author-time only).

## Architecture: where new code goes

- `tools/models/*.py` — one Blender script per asset family, deterministic
  (seeded), re-runnable. `tools/build-models.sh` regenerates everything.
- `assets/models/*.glb` — committed binary output (they're small; the repo
  serves them statically like everything else).
- `src/render/assets.js` (new) — async loader: `await loadModels()` returns
  `{ name → { geometry, material } }` merged/prepared for instancing.
  Called from `main.js` *before* `initWorldRender` (init becomes async; the
  welcome screen already covers the load moment).
- `src/render/meshes.js` is the seam: `buildPlantMesh(type)` and the vehicle
  builders keep their signatures but return glTF-based groups per type as
  they're migrated. Un-migrated types keep the procedural path — migrate
  incrementally, one commit each.
- City buildings are `InstancedMesh` (world.js) — keep that: extract
  geometry+material from the GLB and instance it. The night-window system
  (`facadeMats`, `setNightAmount`, emissive maps) must be reproduced via the
  GLB materials' emissive maps.

## Work packages, in order (each: tests → playtest → docs → commit)

1. **Pilot: loader + one asset end-to-end.** ✅ *done (ADR 16)* — `assets.js`,
   async init in `main.js`, and a Blender-built wind turbine (tower, nacelle,
   3-blade rotor as a named node → `userData.rotor`). Proves: loading,
   instancing into the existing `placed` event flow, rotor animation, shadows,
   scale (tower ≈ 14 units tall; note `G.TILE` is 4 units, not 2 as first
   drafted). Verified: save replay, spin rate, noon/night look, 102 fps orbit.
2. **Building set.** 3 styles (brick, plaster, glass) × 3 height tiers,
   modular floors so Blender scripts generate variants; baked AO in a small
   atlas; emissive window map for night. Wire into world.js instancing +
   `setNightAmount`. This is the biggest visual win.
3. **Vehicles.** Bus, truck, train engine + 2 wagon types (matching
   `src/sim/data.js` vehicle list). Wheels/bogies as separate nodes if
   animating them is cheap.
4. **Power & industry.** Solar table, battery container, hydro dam,
   electrolyzer/H₂ tank, and the industry buildings — keep each one's
   readable silhouette (players identify plants at a glance from far zoom;
   check every asset at max zoom-out before committing).
5. **Trees & props.** Instanced low-poly trees (2–3 species), bus stops,
   street props. Cheap, big atmosphere gain.
6. **Optimization pass.** gltf-transform everything, verify total asset
   weight (target < 5 MB), re-run the fps recipe, consider a far-zoom LOD
   only if the budget fails.

## Traps

- **Async init:** save replay (`place()` events) fires during init — the
  render layer's `placed` listeners must be registered *after* models are
  ready, or buffer events. Test: reload with an existing save.
- **Module cache:** new files (`assets.js`) must be added to the
  playtest-game skill's force-reload list, like postfx.js was.
- **glTF materials arrive `MeshStandardMaterial` already** — do not re-wrap;
  just set `castShadow/receiveShadow` and check roughness against the bloom
  threshold (glossy whites bloom in full sun — ADR 15).
- **Scale/orientation:** Blender +Z-up exports to glTF +Y-up automatically;
  vehicles must face +X (the convention `userData.rotor` and vehicle
  heading code assume — verify against `src/render/vehicles.js`).
- Keep GLB node/material names stable between regenerations so `assets.js`
  lookups don't silently break.

## Verification recipes

fps (from the playtest-game skill setup, camera orbiting):

```js
(async () => { const cam = DEBUG.camera, c = DEBUG.controls;
  const t0 = performance.now(); let n = 0;
  await new Promise(res => { const f = () => {
    const t = (performance.now() - t0) / 1000;
    cam.position.set(c.target.x - 120*Math.cos(t), 65, c.target.z + 120*Math.sin(t));
    n++; performance.now() - t0 > 2000 ? res() : requestAnimationFrame(f); };
    requestAnimationFrame(f); });
  return Math.round(n / 2) + ' fps'; })()
```

Look checks per asset: noon + 21:30 screenshots (bloom/night windows),
max zoom-out (silhouette readability), max zoom-in (texture quality).
