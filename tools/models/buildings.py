# City building set: 3 styles (brick, plaster, glass) x 3 height tiers.
#   blender --background --python tools/models/buildings.py -- assets/models/buildings.glb
#
# Each building exports as ONE object named "<style>_<tier>" at the ground
# center; node translations are layout-only and ignored at load. Windows use
# the material "bldg_window" and have their UVs collapsed onto one cell of an
# 8x8 atlas — at runtime a canvas texture with randomly lit cells becomes the
# emissiveMap, so each window/floor is uniformly lit or dark at night
# (see src/render/assets.js). Deterministic: seeded random only.
import sys
import os
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import material, cube, cyl, gable, join_parts, export_glb, reset_scene  # noqa: E402

out = sys.argv[sys.argv.index('--') + 1]
reset_scene()
R = random.Random(20260703)

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

FLOORS = {'low': 1, 'mid': 3, 'high': 6}
W = 3.0    # footprint (tile is 4; instancing adds 0.88-1.08 scale jitter)
GF = 3.0   # ground floor height
FH = 2.7   # upper floor height


def cell(zone='win'):
    """Atlas rows 0-1: dim/sparse zone for large glazing (floor bands,
    shopfronts, lobbies) — a fully lit big quad must never bloom. Rows 2-7:
    normal window cells (see makeWindowLightsTexture in assets.js)."""
    if zone == 'band':
        return (R.randrange(8), R.randrange(0, 2))
    return (R.randrange(8), R.randrange(2, 8))


def windows_ring(parts, z, ww, wh, name):
    """Three windows on each of the four sides at height z."""
    t = 0.12
    for off in (-0.95, 0, 0.95):
        parts.append(cube(f'{name}a', t, ww, wh, W / 2, off, z, M['window'], cell=cell()))
        parts.append(cube(f'{name}b', t, ww, wh, -W / 2, off, z, M['window'], cell=cell()))
        parts.append(cube(f'{name}c', ww, t, wh, off, W / 2, z, M['window'], cell=cell()))
        parts.append(cube(f'{name}d', ww, t, wh, off, -W / 2, z, M['window'], cell=cell()))


# ---- Board 07 window module: frame (flat) + proud inset glass (atlas) ------
# The glass part is the ONLY thing that may carry material 'bldg_window' +
# set_uv_cell — the frame is a flat near-white paint part. Ported verbatim from
# lookdev-blender.py window()/facade_windows(); see tools/models/STYLE.md.
_WN = [0]


def window(parts, x, y, z, w=0.55, h=0.75, rz=0):
    _WN[0] += 1
    n = _WN[0]
    parts.append(cube(f'wfr{n}', w, 0.10, h, x, y, z, M['frame'], rot=(0, 0, rz)))
    parts.append(cube(f'wgl{n}', w * 0.8, 0.12, h * 0.82, x, y, z, M['window'],
                      cell=cell(), rot=(0, 0, rz)))


def facade_windows(parts, w, d, floors, fh, z0=0.0, inset=0.02, skip_ground=False):
    for fl in range(floors):
        if skip_ground and fl == 0:
            continue
        zc = z0 + fl * fh + fh * 0.55
        nx = max(2, int(w / 0.95))
        for k in range(nx):
            xk = -w / 2 + (k + 0.5) * w / nx
            window(parts, xk, d / 2 - inset, zc)
            window(parts, xk, -d / 2 + inset, zc)
        ny = max(2, int(d / 0.95))
        for k in range(ny):
            yk = -d / 2 + (k + 0.5) * d / ny
            window(parts, w / 2 - inset, yk, zc, rz=90)
            window(parts, -w / 2 + inset, yk, zc, rz=90)


def house(style, tier):
    """Gabled detached house — Board 07 low tier (make_house). Wall carries the
    style's facade material; plinth/roof/chimney/door/frames are flat parts."""
    rng = random.Random(hash((style, tier)) & 0xffffffff)
    w, d = 2.7, 2.4
    floors = 2
    fh = 1.45
    H = floors * fh
    wall = M[style] if style in ('brick', 'plaster') else M['plaster']
    roofm = rng.choice([M['rooftile'], M['roof']])  # clay or slate-grey
    parts = [cube('wall', w, d, H, 0, 0, H / 2, wall)]
    parts.append(cube('plinth', w + 0.14, d + 0.14, 0.16, 0, 0, 0.08, M['stone']))
    parts.append(gable('roof', w + 0.42, d + 0.42, rng.uniform(0.95, 1.25), 0, 0, H, roofm))
    parts.append(cube('chimney', 0.26, 0.26, 0.9, rng.uniform(-w / 4, w / 4), -d / 5,
                      H + 0.55, M['chimney']))
    facade_windows(parts, w, d, floors, fh)
    parts.append(cube('door', 0.6, 0.1, 1.05, rng.uniform(-w / 4, w / 4), d / 2, 0.55, M['door']))
    return parts


def masonry(style, tier):
    n = FLOORS[tier]
    H = GF + n * FH
    wall, trim = M[style], M[f'{style}_trim']
    parts = [cube('wall', W, W, H, 0, 0, H / 2, wall)]
    parts.append(cube('roofslab', W - 0.2, W - 0.2, 0.15, 0, 0, H + 0.02, M['roof']))
    parts.append(cube('parapet', W + 0.18, W + 0.18, 0.35, 0, 0, H + 0.14, trim))
    # ground floor: entrance door (+y) and shopfront glazing
    parts.append(cube('door', 1.0, 0.12, 2.3, 0, W / 2, 1.15, M['door']))
    for sgn in (1, -1):
        parts.append(cube('shop', 0.12, 2.0, 1.6, sgn * W / 2, 0, 1.25, M['window'], cell=cell('band')))
    parts.append(cube('shop2', 2.0, 0.12, 1.6, 0, -W / 2, 1.25, M['window'], cell=cell('band')))
    parts.append(cube('band0', W + 0.14, W + 0.14, 0.14, 0, 0, GF - 0.05, trim))
    for f in range(n):
        zc = GF + f * FH + 1.55
        windows_ring(parts, zc, 0.62, 1.0, f'w{f}')
        if f:
            parts.append(cube(f'band{f}', W + 0.08, W + 0.08, 0.10, 0, 0, GF + f * FH, trim))
    # rooftop clutter
    parts.append(cube('ac', 0.7, 0.5, 0.45, 0.7, 0.4, H + 0.32, M['ac']))
    if tier == 'high':
        parts.append(cube('ac2', 0.5, 0.5, 0.6, -0.8, -0.6, H + 0.40, M['ac']))
        parts.append(cyl('vent', 0.14, 0.9, -0.2, 0.9, H + 0.55, M['ac'], verts=10))
    return parts


def glassy(tier):
    n = FLOORS[tier]
    H = GF + n * FH
    parts = [cube('core', W - 0.08, W - 0.08, H, 0, 0, H / 2, M['mullion'])]
    parts.append(cube('lobby', W + 0.05, W + 0.05, 2.3, 0, 0, 1.25, M['window'], cell=cell('band')))
    for f in range(n):
        z0 = GF + f * FH
        gh = FH - 0.8
        parts.append(cube(f'gl{f}', W + 0.05, W + 0.05, gh, 0, 0, z0 + gh / 2 + 0.05, M['window'], cell=cell('band')))
        parts.append(cube(f'sp{f}', W + 0.02, W + 0.02, 0.72, 0, 0, z0 + FH - 0.36, M['spandrel']))
    for cx in (1, -1):
        for cy in (1, -1):
            parts.append(cube(f'post{cx}{cy}', 0.16, 0.16, H, cx * (W / 2 - 0.02), cy * (W / 2 - 0.02), H / 2, M['mullion']))
    parts.append(cube('parapet', W + 0.10, W + 0.10, 0.30, 0, 0, H + 0.12, M['mullion']))
    parts.append(cube('pent', 1.4, 1.1, 0.9, -0.4, 0.3, H + 0.45, M['ac']))
    if tier == 'high':
        parts.append(cyl('ant', 0.035, 2.4, 0.9, -0.9, H + 1.2, M['mullion'], verts=8))
    return parts


ox = 0
for style in ('brick', 'plaster', 'glass'):
    for tier in ('low', 'mid', 'high'):
        # WP1 pilot: only plaster_low is rebuilt to the Board 07 house spec.
        # The other 8 keep the pre-phase-3 recipe until WP2 ports them.
        if (style, tier) == ('plaster', 'low'):
            parts = house(style, tier)
        elif style == 'glass':
            parts = glassy(tier)
        else:
            parts = masonry(style, tier)
        obj = join_parts(parts, f'{style}_{tier}')
        obj.location = (ox, 0, 0)  # layout only — ignored at load
        ox += 8

export_glb(out)
