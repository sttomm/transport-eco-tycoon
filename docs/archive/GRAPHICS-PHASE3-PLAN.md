# Graphics Phase 3 — the approved Board 07 look: detailed assets + living landscape

Successor to phase 2 (real GLB assets — see GRAPHICS-PHASE2-PLAN.md, all work
packages done, ADRs 16–19). The art-direction review of July 2026 produced
eight mockup boards; the user **approved Board 07**: keep the world layout and
engine, but rebuild the models at much higher detail and give the landscape a
from-scratch nature pass. This plan turns those mockups into the shipped look.

## Visual target (open these first)

- `docs/art-direction/board07-aerial.jpg` — the whole world: river with reeded
  sandy banks flowing into the lake, crop-field patchwork, rock outcrops,
  curbed streets with zebra crossings, 3-blade turbines.
- `docs/art-direction/board07-landscape.jpg` — nature only: branching oaks
  with multi-lobe two-tone canopies, layered drooping conifers, birches,
  grass tufts, boulders.
- `docs/art-direction/board07-street.jpg` — the approved building style:
  real window reveals, balconies, cornices, plinths, roof overhangs,
  rooftop AC/bulkheads.
- `docs/art-direction/lookdev-blender.py` — the Blender scene that produced
  them (`blender -b -P lookdev-blender.py -- hifi out.png [quick]`). Its
  `build_hifi()` contains the exact proportions, palettes and construction
  recipes for every model below. Treat it as the spec; port, don't reinvent.
- Full review with all eight boards (context only, not needed to execute):
  https://claude.ai/code/artifact/acf74aa0-f9f3-40a6-b3c4-b8001919de0d

Decisions already made (do not relitigate):
- Building/house style: **approved as rendered**.
- ALL roads are asphalt with dashed center lines — city and inter-city alike.
  No gravel roads (explicitly rejected).
- Turbines have exactly **3 blades** (see trap below), thin chord, staggered
  rotor phases between neighbors.
- The gritty/classic tone stays; this is detail, not a cozy restyle.

## Ground rules (unchanged — read CLAUDE.md and GRAPHICS-PHASE2-PLAN.md first)

- No build step, no npm deps. Assets are `.glb` in `assets/models/` from
  `tools/models/*.py` (Blender 5.1 headless, `/opt/homebrew/bin/blender`),
  optimized by `tools/build-models.sh` (keep its exact gltf-transform flags —
  join/flatten/palette/quantize all break load-bearing contracts).
- Sim untouched except WP6 (river worldgen, save v5). Everything else lives in
  `src/render/` + `assets/` + `tools/`.
- Contracts that must survive every WP: object/material names are load-time
  API (`<style>_<tier>` buildings, `rotor`, `glow`); building footprints
  ≈ same as today; night windows (UV atlas cells, ADR 17), `userData.rotor`
  spin, solar dark at night; bloom threshold ≈ 3.4 caps every emissive and
  specular; metalness ≤ 0.25 on painted surfaces; albedos darker than the
  target look (ACES bleaches mid-tones).
- Budget: ≥ 55 fps orbiting the city center (playtest-game skill has the
  recipe; phase 2 ended at ~120 fps, so there is headroom to spend).
- Definition of done per WP: `npm test` green → browser playtest (force-reload
  trick!) → docs updated → commit. Never batch WPs into one commit.

## Work packages, in order

1. **Style guide + pilot building.** Write `tools/models/STYLE.md` (one page):
   window module (frame + inset glass proud ≈ 0.03), floor heights per tier,
   bevel widths, cornice/plinth/parapet dims, palette hexes, roof overhang
   ≈ +0.4 over footprint — extract the numbers from `lookdev-blender.py`
   `make_house/make_apt/make_tower/make_glasstower`. Then rebuild ONE tier
   (`plaster_low` gabled house) end-to-end: buildings.py → build-models.sh →
   in game. The hard part is preserving the night-light atlas: new window
   *glass* parts must still `set_uv_cell()` onto the 8×8 atlas; frames go to
   the merged facade material. Verify lit windows at night before continuing.
2. **Full building set.** All 3 styles × 3 tiers to the pilot's standard,
   plus 2–3 seeded variants per style/tier for suburb variety (variants can
   share the GLB, selected by instance like today). Balconies on mid tiers,
   rooftop AC/bulkheads on high tiers, mullion grid + floor slabs on glass.
3. **Trees.** Rework `trees.py`: oaks with 3–4 branch cylinders + 8–14
   displaced icosphere lobes in two greens (vertex-color bake keeps one
   InstancedMesh per species), conifers as 7 stacked displaced cones with
   drooped skirts, poplars as stacked ellipsoids, NEW birch species (white
   trunk, dark band rings, airy small lobes). Target ≤ ~2.5k tris per tree;
   if orbit fps < 55 with ~550 trees, add a far LOD (the old low-poly mesh
   swapped by camera distance) — measure first, don't pre-build it.
4. **Turbine + small props.** `wind_turbine.py`: thinner blades with taper
   and slight twist. ⚠ Trap discovered in look-dev: a tapered-cube blade must
   grow OUTWARD-only from the hub — shift verts to z∈[0,1] *before* scaling —
   or each cube reads as two opposite blades and the rotor renders as a
   6-spoke star. Keep the `rotor` named node. Give placed turbines a random
   initial rotor phase in the renderer so neighbors never sync. Street lamps:
   arm + brighter head per look-dev proportions.
5. **Ground shader.** Replace the terrain material's flat look (world.js
   `// ---------- terrain ----------`, textures.js): blend grass patchwork
   (two greens, macro noise), dirt breaks, rock on steep slopes (normal.z
   threshold), sand near the waterline (height threshold), micro bump.
   Implement as `onBeforeCompile` chunks on the existing terrain material so
   fog/shadows/GTAO keep working. Linear-space palette from look-dev:
   grass 0.085/0.22/0.05 ↔ 0.15/0.30/0.085, dirt 0.35/0.25/0.13,
   rock 0.33/0.32/0.30, sand 0.52/0.44/0.27.
6. **River (the only sim change).** Worldgen: a seeded spline from the north
   edge into the lake, carving the heightfield below water level (look-dev
   used ~5.5-unit half-width, 3.6 depth, smoothstep falloff). This changes
   terrain for placement/roads → **bump save version to 5** in
   `src/sim/save.js` (v2–v4 accepted+migrated today; decide replay vs reject
   for v4 saves and pin it in a test). Sim tests for: river tiles are
   unbuildable water, road/rail cannot cross without the existing bridge
   rules (or river placed to avoid the initial corridors, as look-dev does).
7. **Ground scatter.** New seeded InstancedMesh layers in world.js: grass
   tufts (~850), wildflower patches, bushes, boulders (slope-biased), reeds
   ringing lake + river shores (height-band |h − waterline| test). Exclude
   road corridors, city pads, building/industry footprints. Fade density by
   camera distance if fps demands. Models: tiny GLBs or procedural geometry
   inline — whichever matches `lookdev-blender.py` shapes cheaply.
8. **Farmland patchwork.** Fenced crop fields (wheat rows / plowed soil /
   cabbage) scattered outside the city near farm industries: rows as thin
   instanced boxes following terrain height, post-and-rail fence perimeter.
   Purely visual worldgen-seeded decoration in the render layer (no sim
   meaning — do NOT make them industries).
9. **Streets.** Extend the road tile builder (world.js): raised curb strips
   along both edges (city tiles), dashed center line on ALL road tiles
   including inter-city (already partially there — unify), zebra crosswalk
   bands at city intersections. Same asphalt everywhere; no gravel variant.
10. **Calibration + wrap.** Side-by-side the three reference JPGs vs
    in-game screenshots (playtest-game capture recipe) at matching angles;
    tune sun/exposure/saturation only in scene.js/postfx.js (phase-1 rig).
    Update README (player-visible), ARCHITECTURE.md (one ADR for the phase),
    ENERGY-MODEL.md untouched. Final fps + save-migration check.

## Traps (beyond the phase-2 list, all hit during look-dev)

- Turbine blades: outward-only geometry, see WP4 — the user personally
  caught the 6-spoke bug in review.
- Blender 5.1: `scene.compositing_node_group` replaced `scene.node_tree`;
  sky enum has no NISHITA; `dust_density` → `aerosol_density` (only relevant
  if you re-render look-dev images).
- Object names must not end in float-like strings (Blender name-uniquing
  crashes) — keep integer suffixes, as phase 2 already learned.
- Displaced-icosphere canopies look right only with shade_smooth AND
  per-lobe noise seeds; identical seeds make visibly cloned trees.
- Scatter placement must reuse the sim's seeded rand-stream discipline
  (world.js already splits streams) or saves will re-scatter differently
  after reload.

## Execution: sessions and models

One WP per session, in order. Every session starts by reading CLAUDE.md,
this plan, and the three reference JPGs; asset WPs also read
`lookdev-blender.py` and the phase-2 plan's traps. When in doubt about a
shape or color, copy the look-dev numbers verbatim. Commit per WP.

**First session (before WP1): commit this plan and `docs/art-direction/`**
so the handoff is in git history (they are untracked as of 2026-07-11 —
do not sweep in unrelated files like `tools/models/__pycache__`).

Per-WP model assignment (rationale: risk lives where visual judgment,
shader interactions, or save migration are involved; the rest is
pattern-following against look-dev + phase-2 conventions):

| WP | What | Model |
|----|------------------------------------------|----------------|
| 1  | Style guide + pilot building (night-window atlas must survive) | **Opus** |
| 2  | Full building set                        | Sonnet |
| 3  | Trees                                    | Sonnet |
| 4  | Turbine + props                          | Sonnet |
| 5  | Ground shader (`onBeforeCompile` × GTAO/fog/shadows) | **Opus** |
| 6  | River worldgen + save v5 migration       | **Opus** |
| 7  | Ground scatter                           | Sonnet |
| 8  | Farmland patchwork                       | Sonnet |
| 9  | Streets (curbs/crosswalks/center lines)  | Sonnet |
| 10 | Calibration vs reference renders + docs  | **Opus** |

Sonnet WPs assume WP1's pilot has landed as the pattern to copy. If a
Sonnet session stalls on a visual mismatch or an engine contract (night
windows, rotor, instancing), stop and re-run that WP on Opus rather than
iterating blind. Fable is not required for any WP; it's only worth
considering if WP1 or WP10 can't hit the reference look after an Opus
attempt.
