# Building style guide — the approved Board 07 look

The spec for every building model in `buildings.py`. Numbers are lifted
verbatim from `docs/art-direction/lookdev-blender.py` `build_hifi()`
(`make_house / make_apt / make_tower / make_glasstower`). When in doubt, copy
the look-dev number — the boards are the contract, not this prose.

Units: 1 Blender unit = 1 game unit, +Z up. Footprint ≈ the game tile (4).
Buildings are **not** beveled (bevel is for vehicles/turbine only) — crisp
edges, detail comes from real geometry (reveals, cornices, plinths).

## Load-bearing contract (never break — see `src/render/assets.js`)

Every part's **material name** routes it into one runtime category:

| material name        | category | runtime treatment |
|----------------------|----------|-------------------|
| `bldg_window`        | window   | shared glass mat; emissive **atlas** — needs `set_uv_cell()` |
| `bldg_brick`         | brick    | stucco/brick facade texture keyed on the mat color |
| `bldg_plaster`       | plaster  | stucco facade texture keyed on the mat color |
| anything else        | flat     | Blender color baked to vertex color + shared grain map |

- Object exports as ONE joined mesh named **`<style>_<tier>`**
  (`brick|plaster|glass` × `low|mid|high`). Node translation is layout-only.
- **Window glass** parts MUST use `bldg_window` AND `set_uv_cell(o, cell())`.
  Rows 0–1 of the 8×8 atlas are the dim zone for LARGE glazing (bands, lobbies,
  glass-tower floors) — a fully lit big quad would bloom into a white blob;
  rows 2–7 are small bright windows. `cell('band')` → rows 0–1, `cell()` → 2–7.
- **Window frames** are flat parts (near-white paint) — they carry the "reveal"
  read, the glass sits proud/inset within them. Frames are NOT `bldg_window`.
- Emissive strength stays below the bloom threshold (~3.4); metalness ≤ 0.25 on
  painted surfaces (glass/mullion may go to 0.30–0.35).

## Window module (the unit that repeats)

Frame + inset glass, pane facing +Y (rotate `rz=90` for the ±X faces):

```
frame  = cube(w=0.55, dy=0.10, h=0.75)   flat, near-white
glass  = cube(w*0.8,  dy=0.12, h*0.82)   bldg_window + cell()   # proud ~0.01, narrower/shorter → reveal
```

`facade_windows`: per floor, band centre `zc = z0 + fl*fh + fh*0.55`; count per
side `nx = max(2, int(side/0.95))`, evenly spaced; wall inset `0.02`;
`skip_ground=True` on tiers whose ground floor is a shopfront/lobby.

## Palette (linear RGB via `srgb()` on these sRGB hexes)

Walls: plaster `#c7bda4`(0.78,0.73,0.64) · cream `#d9c493` · sage `#868f73` ·
brick `#9e6142` · rust `#9e6142`. Roof: rooftile `#9c4a38` · slate `#3a3d47`.
Trim/plinth: stone `#87837c` · concrete `#95958f` · frame(paint) `#e8e8e4`.
Glass: `bldg_window` glass `#22303c` · mullion `#39434d` · spandrel `#93a7b5`.
Metal(AC/vents/rails) `#a1a4a9` metal≈0.25 · chimney brickdark `#4a2e24`.
Door slate `#3a3d47`.

(The game keeps its own `bldg_*` mat set in `buildings.py`; these hexes tune it
toward look-dev. Albedos are deliberately a touch dark — ACES bleaches mids.)

## Per-tier construction

Roof overhang ≈ **+0.4** over footprint. Cornice/plinth/parapet dims below.

### low → gabled detached house  (`make_house`)
- `w≈2.7, d≈2.4`, floors 2 (or 1), `fh=1.45`.  H = floors·fh.
- wall cube; **plinth** `+0.14` footprint × `0.16` tall at z=0.08 (stone).
- **gable roof** `gable(w+0.42, d+0.42, 0.9–1.3)` at z=H (rooftile/slate).
- **chimney** `0.26×0.26×0.9` at (rand x, −d/5, H+0.55) (brickdark).
- `facade_windows` all floors; **door** `0.6×0.1×1.05` on +Y at z=0.55 (slate).

### mid → apartment block  (`make_apt`)
- `w≈2.8, d≈2.6`, floors 3–4, `fh=1.15`.
- plinth `+0.14 × 0.6` tall; **floor slabs** `+0.10 × 0.07` at each `fl*fh` (frame).
- `facade_windows`; **balconies** on +Y: slab `1.05×0.5×0.06` + rail
  `1.05×0.05×0.4` (concrete + metal), one per upper floor.
- **parapet** four `0.12`-thick walls `+0.35` above H (wall color); rooftop
  **AC** `0.8×0.6×0.45` + housing `0.9×0.9×0.6` (metal/concrete).

### high (masonry) → tower  (`make_tower`)
- `w≈2.9, d≈2.8`, floors 6–8, `fh=1.0`.
- plinth `+0.16 × 0.9` tall; `facade_windows(skip_ground=True)`.
- **cornice** `+0.08 × 0.25` at H+0.12; rooftop bulkheads (metal box
  `1.1×0.8×0.55` + concrete `0.9×0.9×0.7`) + thin `0.06r × 1.6` mast (metal).

### high (glass) → curtain-wall tower  (`make_glasstower`)
- `w≈2.8, d≈2.7`, floors 6–9, `fh=1.05`.
- glass box (`bldg_window`, `cell('band')` per floor); **floor slabs**
  `+0.08 × 0.10` metal at every `fl*fh`; **mullion grid** — vertical fins
  every ~0.5 and horizontal every `d/nmul` (metal `0.05` thick).
- rooftop mech `w·0.5 × d·0.5 × 0.8` (metal); plinth `+0.2 × 0.5`.

## Pilot status

WP2 ported all 9 models (`brick|plaster|glass` × `low|mid|high`) to the specs
above, plus 2 seeded variants each (`_v2`/`_v3` suffixes) for suburb variety —
27 nodes total, still resolving to the 9 canonical `<style>_<tier>` names for
`src/render/assets.js`/`world.js` (which group by tier only, so variants slot
in automatically). Notes on tiers without a direct look-dev counterpart:
- `glass_low` has no `make_house` analog in look-dev — built as a small
  curtain-wall block (1–2 floors) instead of a gable, per the plan.
- `glass_mid` reuses the `make_glasstower` recipe at apartment-block floor
  counts (3–4) rather than `make_apt`'s masonry-balcony shape, since balconies
  don't fit a full-glass facade.
Verified in-browser: all 9 base models render per the board07 references and
light their windows per-cell (not per-floor blob) at night.
