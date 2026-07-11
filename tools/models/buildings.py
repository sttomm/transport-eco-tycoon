# City building set: 3 styles (brick, plaster, glass) x 3 height tiers, plus
# seeded variants per style/tier for suburb variety.
#   blender --background --python tools/models/buildings.py -- assets/models/buildings.glb
#
# Each building exports as ONE object named "<style>_<tier>" (variants get a
# "_vN" suffix — src/render/assets.js splits on '_' and only reads the first
# two tokens, so variants still group under their style/tier) at the ground
# center; node translations are layout-only and ignored at load. Windows use
# the material "bldg_window" and have their UVs collapsed onto one cell of an
# 8x8 atlas — at runtime a canvas texture with randomly lit cells becomes the
# emissiveMap, so each window/floor is uniformly lit or dark at night
# (see src/render/assets.js). Deterministic: seeded random only.
#
# Recipes below port tools/models/STYLE.md (lifted from docs/art-direction/
# lookdev-blender.py build_hifi() make_house/make_apt/make_tower/
# make_glasstower) verbatim where the game's window-atlas contract allows.
import sys
import os
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import material, cube, cyl, gable, join_parts, export_glb, reset_scene  # noqa: E402

out = sys.argv[sys.argv.index('--') + 1]
reset_scene()

M = {
    'window': material('bldg_window', '#22303c', 0.18, 0.30),
    'brick': material('bldg_brick', '#9a5843', 0.85),
    'brick_trim': material('bldg_brick_trim', '#d9d0c0', 0.75),
    'plaster': material('bldg_plaster', '#ded4c3', 0.80),
    'plaster_trim': material('bldg_plaster_trim', '#b46a41', 0.70),
    'mullion': material('bldg_mullion', '#39434d', 0.55, 0.35),
    'spandrel': material('bldg_spandrel', '#93a7b5', 0.50, 0.25),
    'roof': material('bldg_roof', '#6e6a64', 0.92),
    'door': material('bldg_door', '#4a3527', 0.70),
    'ac': material('bldg_ac', '#c3c9ce', 0.55, 0.30),
    # phase-3 (Board 07) flat parts — see tools/models/STYLE.md
    'frame': material('bldg_frame', '#e8e8e4', 0.55),      # window-reveal paint
    'stone': material('bldg_stone', '#87837c', 0.90),      # plinth
    'rooftile': material('bldg_rooftile', '#9c4a38', 0.85),  # gabled clay roof
    'chimney': material('bldg_chimney', '#4a2e24', 0.90),
}


def cell(rng, zone='win'):
    """Atlas rows 0-1: dim/sparse zone for large glazing (floor bands,
    shopfronts, lobbies) — a fully lit big quad must never bloom. Rows 2-7:
    normal window cells (see makeWindowLightsTexture in assets.js)."""
    if zone == 'band':
        return (rng.randrange(8), rng.randrange(0, 2))
    return (rng.randrange(8), rng.randrange(2, 8))


# ---- Board 07 window module: frame (flat) + proud inset glass (atlas) ------
# The glass part is the ONLY thing that may carry material 'bldg_window' +
# set_uv_cell — the frame is a flat near-white paint part. Ported verbatim from
# lookdev-blender.py window()/facade_windows(); see tools/models/STYLE.md.
_WN = [0]


def window(parts, rng, x, y, z, w=0.55, h=0.75, rz=0):
    _WN[0] += 1
    n = _WN[0]
    parts.append(cube(f'wfr{n}', w, 0.10, h, x, y, z, M['frame'], rot=(0, 0, rz)))
    parts.append(cube(f'wgl{n}', w * 0.8, 0.12, h * 0.82, x, y, z, M['window'],
                      cell=cell(rng), rot=(0, 0, rz)))


def facade_windows(parts, rng, w, d, floors, fh, z0=0.0, inset=0.02, skip_ground=False):
    for fl in range(floors):
        if skip_ground and fl == 0:
            continue
        zc = z0 + fl * fh + fh * 0.55
        nx = max(2, int(w / 0.95))
        for k in range(nx):
            xk = -w / 2 + (k + 0.5) * w / nx
            window(parts, rng, xk, d / 2 - inset, zc)
            window(parts, rng, xk, -d / 2 + inset, zc)
        ny = max(2, int(d / 0.95))
        for k in range(ny):
            yk = -d / 2 + (k + 0.5) * d / ny
            window(parts, rng, w / 2 - inset, yk, zc, rz=90)
            window(parts, rng, -w / 2 + inset, yk, zc, rz=90)


# ---------------- low: gabled detached house (make_house) — brick/plaster --
def house(style, rng):
    w, d = rng.uniform(2.3, 2.9), rng.uniform(2.0, 2.5)
    floors = rng.choice([1, 2, 2])
    fh = 1.45
    H = floors * fh
    wall = M[style]
    roofm = rng.choice([M['rooftile'], M['roof']])
    parts = [cube('wall', w, d, H, 0, 0, H / 2, wall)]
    parts.append(cube('plinth', w + 0.14, d + 0.14, 0.16, 0, 0, 0.08, M['stone']))
    parts.append(gable('roof', w + 0.42, d + 0.42, rng.uniform(0.9, 1.3), 0, 0, H, roofm))
    parts.append(cube('chimney', 0.26, 0.26, 0.9, rng.uniform(-w / 4, w / 4), -d / 5,
                      H + 0.55, M['chimney']))
    facade_windows(parts, rng, w, d, floors, fh)
    parts.append(cube('door', 0.6, 0.1, 1.05, rng.uniform(-w / 4, w / 4), d / 2, 0.55, M['door']))
    return parts


# ---------------- low: small curtain-wall block — glass only ---------------
# STYLE.md: "look-dev has no 'glass low'; give glass_low a small curtain-wall/
# glazed low block, not a gable." Same window-atlas + mullion-fin language as
# the taller glass tiers, just short.
def glass_low(rng):
    w, d = rng.uniform(2.3, 2.7), rng.uniform(2.0, 2.4)
    floors = rng.choice([1, 2])
    fh = 1.5
    H = floors * fh
    parts = [cube('plinth', w + 0.14, d + 0.14, 0.16, 0, 0, 0.08, M['stone'])]
    for f in range(floors):
        z0 = f * fh
        gh = fh - 0.22
        parts.append(cube(f'gl{f}', w + 0.02, d + 0.02, gh, 0, 0, z0 + gh / 2 + 0.11,
                          M['window'], cell=cell(rng, 'band')))
    for f in range(floors + 1):
        parts.append(cube(f'slab{f}', w + 0.06, d + 0.06, 0.08, 0, 0,
                          min(f * fh, H - 0.04), M['ac']))
    nmul = max(2, int(w / 0.6))
    for k in range(nmul + 1):
        xk = -w / 2 + k * w / nmul
        parts.append(cube(f'mv{k}', 0.05, d + 0.05, H, xk, 0, H / 2, M['mullion']))
    parts.append(cube('parapet', w + 0.10, d + 0.10, 0.20, 0, 0, H + 0.10, M['mullion']))
    parts.append(cube('pent', 0.9, 0.7, 0.4, rng.uniform(-0.3, 0.3), rng.uniform(-0.2, 0.2),
                      H + 0.30, M['ac']))
    return parts


# ---------------- mid: apartment block (make_apt) — brick/plaster ----------
def apt(style, rng):
    w, d = rng.uniform(2.6, 3.0), rng.uniform(2.4, 2.8)
    floors = rng.choice([3, 4])
    fh = 1.15
    H = floors * fh
    wall = M[style]
    parts = [cube('wall', w, d, H, 0, 0, H / 2, wall)]
    parts.append(cube('plinth', w + 0.14, d + 0.14, 0.6, 0, 0, 0.3, M['stone']))
    for fl in range(1, floors):
        parts.append(cube(f'slab{fl}', w + 0.10, d + 0.10, 0.07, 0, 0, fl * fh, M['frame']))
    facade_windows(parts, rng, w, d, floors, fh)
    for fl in range(1, floors):
        bx = rng.uniform(-w / 5, w / 5)
        parts.append(cube(f'bslab{fl}', 1.05, 0.5, 0.06, bx, d / 2 + 0.25, fl * fh + 0.35, M['stone']))
        parts.append(cube(f'brail{fl}', 1.05, 0.05, 0.4, bx, d / 2 + 0.48, fl * fh + 0.6, M['ac']))
    parts.append(cube('par1', w + 0.1, 0.12, 0.35, 0, d / 2, H + 0.17, wall))
    parts.append(cube('par2', w + 0.1, 0.12, 0.35, 0, -d / 2, H + 0.17, wall))
    parts.append(cube('par3', 0.12, d + 0.1, 0.35, w / 2, 0, H + 0.17, wall))
    parts.append(cube('par4', 0.12, d + 0.1, 0.35, -w / 2, 0, H + 0.17, wall))
    parts.append(cube('ac', 0.8, 0.6, 0.45, rng.uniform(-0.6, 0.6), 0, H + 0.22, M['ac']))
    parts.append(cube('achouse', 0.9, 0.9, 0.6, -w / 4, -d / 4, H + 0.3, M['stone']))
    return parts


# ---------------- mid/high: curtain-wall tower (make_glasstower) — glass ----
# STYLE.md's per-floor window-atlas contract splits the single look-dev glass
# box into one banded pane per floor (each floor lights independently at
# night); floor slabs + mullion fins are ported verbatim.
def glasstower(tier, rng):
    if tier == 'mid':
        w, d = rng.uniform(2.6, 3.0), rng.uniform(2.4, 2.8)
        n = rng.choice([3, 4])
        fh = 1.15
    else:
        w, d = rng.uniform(2.6, 3.0), rng.uniform(2.5, 2.9)
        n = rng.choice([6, 8, 9])
        fh = 1.05
    H = n * fh
    parts = [cube('plinth', w + 0.2, d + 0.2, 0.5, 0, 0, 0.25, M['stone'])]
    for f in range(n):
        z0 = f * fh
        gh = fh - 0.12
        parts.append(cube(f'gl{f}', w + 0.02, d + 0.02, gh, 0, 0, z0 + gh / 2 + 0.10,
                          M['window'], cell=cell(rng, 'band')))
    for f in range(n + 1):
        parts.append(cube(f'slab{f}', w + 0.08, d + 0.08, 0.10, 0, 0, min(f * fh, H - 0.05), M['ac']))
    nmul = max(2, int(w / 0.5))
    for k in range(nmul + 1):
        xk = -w / 2 + k * w / nmul
        yk = -d / 2 + k * d / nmul
        parts.append(cube(f'mv{k}', 0.05, d + 0.06, H, xk, 0, H / 2, M['mullion']))
        parts.append(cube(f'mh{k}', w + 0.06, 0.05, H, 0, yk, H / 2, M['mullion']))
    parts.append(cube('mech', w * 0.5, d * 0.5, 0.8, 0, 0, H + 0.4, M['ac']))
    if tier == 'high':
        parts.append(cyl('ant', 0.035, 2.4, w / 2 - 0.3, -d / 2 + 0.3, H + 1.2, M['mullion'], verts=8))
    return parts


# ---------------- high: masonry tower (make_tower) — brick/plaster ---------
def tower(style, rng):
    w, d = rng.uniform(2.7, 3.0), rng.uniform(2.6, 2.9)
    floors = rng.choice([6, 7, 8])
    fh = 1.0
    H = floors * fh
    wall = M[style]
    parts = [cube('wall', w, d, H, 0, 0, H / 2, wall)]
    parts.append(cube('plinth', w + 0.16, d + 0.16, 0.9, 0, 0, 0.45, M['stone']))
    facade_windows(parts, rng, w, d, floors, fh, skip_ground=True)
    parts.append(cube('cornice', w + 0.08, d + 0.08, 0.25, 0, 0, H + 0.12, wall))
    parts.append(cube('bulk1', 1.1, 0.8, 0.55, 0.5, 0.4, H + 0.4, M['ac']))
    parts.append(cube('bulk2', 0.9, 0.9, 0.7, -0.6, -0.5, H + 0.45, M['stone']))
    parts.append(cyl('mast', 0.06, 1.6, 0.8, -0.8, H + 0.9, M['ac'], verts=8))
    return parts


def build(style, tier, rng):
    if tier == 'low':
        return glass_low(rng) if style == 'glass' else house(style, rng)
    if tier == 'mid':
        return glasstower('mid', rng) if style == 'glass' else apt(style, rng)
    return glasstower('high', rng) if style == 'glass' else tower(style, rng)


VARIANTS = 3  # base + 2 seeded variants per style/tier, for suburb variety
ox = 0
for style in ('brick', 'plaster', 'glass'):
    for tier in ('low', 'mid', 'high'):
        for v in range(VARIANTS):
            rng = random.Random(hash((style, tier, v)) & 0xffffffff)
            _WN[0] = 0
            parts = build(style, tier, rng)
            name = f'{style}_{tier}' if v == 0 else f'{style}_{tier}_v{v + 1}'
            obj = join_parts(parts, name)
            obj.location = (ox, 0, 0)  # layout only — ignored at load
            ox += 8

export_glb(out)
