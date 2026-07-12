---
name: edit-graphics
description: Change the visuals of Transport Eco Tycoon — 3D models (glTF/Blender pipeline), terrain/water/scatter, roads/rails, lighting/post-processing, textures, or the render layer generally. Use when asked to add or restyle a model, tweak the look, fix a rendering glitch, or extend a render module.
---

# Editing graphics

The approved look is **Board 07** (`docs/art-direction/`, ADR 31) — detailed
low-poly, muted natural greens, calm pale sky. Don't restyle casually; the
user rejected a pastel/cozy restyle once already. `src/render/` reads sim
state `G` and subscribes to sim events — never put game rules here.

## Render layer map

| Module | Owns |
|---|---|
| `render/scene.js` | renderer, camera, sun/sky/IBL, day-night, fly-to |
| `render/postfx.js` | GTAO → bloom → tone map → tilt-shift (ADR 15) |
| `render/world.js` | thin facade: init/update order over the five below |
| `render/terrain.js` | terrain mesh, ground shader, detail maps, water |
| `render/buildings.js` | city + plant + industry meshes, `placed`/`bulldozed` handlers, night windows |
| `render/scatter.js` | trees, grass/flowers/boulders/reeds, farm fields |
| `render/infrastructure.js` | roads, curbs, rails, street lamps (`roadBuilt`/`railBuilt` dirty flags) |
| `render/ambient.js` | cosmetic instanced cars/pedestrians (sim doesn't know they exist, ADR 9) |
| `render/rng.js` | ONE shared seeded rand stream — consumption order = init order; reordering init calls reshuffles the whole world's cosmetic randomness |
| `render/meshes.js` | procedural fallback meshes + canvas textures |
| `render/textures.js` | runtime canvas textures attached to glTF materials BY NAME |
| `render/assets.js` | loads `assets/models/*.glb` once at startup |

## glTF asset pipeline (ADR 16)

Source of truth = Python scripts in `tools/models/` run through headless
Blender; the committed `.glb` in `assets/models/` is a build artifact.
Style spec: `tools/models/STYLE.md` (window module, floor heights,
cornice/plinth/parapet).

```bash
tools/build-models.sh          # regenerates every .glb (needs Blender)
```

**Hard-won traps — violating any of these has broken the game before:**
- Object/material **names are load-time API**: `rotor`, `glow`, `bldg_window`,
  `<style>_<tier>` — assets.js and textures.js look things up by name. Keep
  them stable across regenerations.
- Blender crashes (stoi overflow) on object names with float suffixes —
  avoid names like `part_1.5`.
- `build-models.sh` runs gltf-transform in **dedup+weld-only** mode. Never
  add join/flatten/palette (merges nodes, destroys the name contract) or
  quantization (re-centers vertices into node transforms, breaks the rotor
  pivot). Keep `--prune-attributes false` — pruning strips TEXCOORD_0 and
  silently kills the night-window atlas.
- Rotors must export with **identity rotation** (buildings.js animates
  `rotation.x` directly); per-instance rotor phase lives in `userData`.
- UVs are box/cylinder-projected in **world space** (1 UV unit = 1 world
  unit, `common.py box_uv/cyl_uv`) so the runtime canvas textures tile at
  uniform density. `bevel()` must run before `join_parts` and re-project UVs.

## Material & lighting rules (ADR 15/16/17)

- Bloom threshold ≈ **3.4**: every emissive (window atlas 4.5 is the
  exception by design, lamp heads, vehicle lights) must stay below it or the
  city glows in sunlight; sun-lit whites sit ~2.8 — keep roughness ≥ ~0.5 on
  whites.
- Metalness ≤ ~0.25 on painted surfaces (greys out albedo); pick albedos
  darker than the target look (noon ACES bleaches mid-tones).
- HSL math in textures.js happens explicitly in **sRGB** — three.js's linear
  working space makes dark colors' lightness tiny; offsets computed there
  blow past the palette.
- glTF materials arrive as `MeshStandardMaterial` — attach canvas textures,
  don't re-wrap.
- Night lighting: `setNightAmount` (buildings.js) drives the window atlas and
  lamp heads; solar panels must read dark at night (teaching mission).
- r185: configure `PCFShadowMap` explicitly (`PCFSoftShadowMap` was removed;
  the silent fallback loses shadow lookups).

## Verifying visual changes

`npm test` still runs first (catches accidental sim imports). Then the
`playtest-game` skill — force-refresh modules, screenshot at three altitudes
(aerial / landscape / street, compare against `docs/art-direction/` Board 07
renders), check the console for errors, and verify night (windows lit, solar
dark, no bloom flare). Budget: ≥55 fps orbiting the city center (phase-3
calibration measured ~212).
