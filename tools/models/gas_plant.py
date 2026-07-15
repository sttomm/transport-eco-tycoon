# Legacy gas plant GLB (WP8 rendering polish) — run headless:
#   blender --background --python tools/models/gas_plant.py -- assets/models/gas_plant.glb
#
# Every game inherits exactly one of these (BUILDINGS.gas, legacy: true) —
# it's a single unique asset, not a library, so parts stay top-level nodes
# (like wind_turbine.glb) rather than joined into one mesh.
#
# Detail: turbine hall with ribbed cladding pilasters, twin banded
# smokestacks, pipe rack, gas skid + horizontal tank, and a transformer yard.
# Night look: a small control-room window strip carries a baked-in warm
# emissive, below the bloom threshold — same "always-on, only reads at night"
# convention already used for vehicle headlights (see common.py `material`).
#
# 'smoke' is an EMPTY, not geometry: it only marks the anchor position above
# the stacks. The render layer (assets.js modelInstance) builds the actual
# animated puff group there at runtime, mirroring the procedural fallback in
# meshes.js — this is the same "name is the contract" pattern as 'rotor'.
#
# Coordinate note: common.py's cube()/cyl() take Blender (x, y, z), and the
# glTF exporter maps that to runtime (three.js) space as
#   three.x = blender.x, three.y = blender.z (up), three.z = -blender.y
# (verified empirically against an exported Empty — do NOT assume a
# same-sign mapping). The t*() helpers below take arguments in *runtime*
# (three.js) space, using the SAME base-anchored convention as meshes.js's
# `box()`/`cyl()` helpers (y = base height, not center) so this script reads
# like a direct transcription of the procedural fallback in meshes.js.
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import material, cube, cyl, gable, export_glb, reset_scene  # noqa: E402

out = sys.argv[sys.argv.index('--') + 1]
reset_scene()


def tbox(name, w, h, d, x, y, z, mat):
    """Box at runtime (x, y, z) with y = BASE height (meshes.js box() convention)."""
    return cube(name, w, d, h, x, -z, y + h / 2, mat)


def tgable(name, w, h, d, x, y, z, mat):
    """Gabled roof at runtime (x, y, z) with y = BASE height."""
    return gable(name, w, d, h, x, -z, y, mat)


def tcyl(name, r, h, x, y, z, mat, r2=None, verts=16, ry=None):
    """Cylinder at runtime (x, y, z) with y = BASE height (meshes.js cyl() convention)."""
    kwargs = {'verts': verts}
    if r2 is not None:
        kwargs['r2'] = r2
    if ry is not None:
        kwargs['ry'] = ry
    return cyl(name, r, h, x, -z, y + h / 2, mat, **kwargs)


def tcyl_c(name, r, h, x, y, z, mat, verts=16, ry=None):
    """Cylinder at runtime (x, y, z) with y = CENTER height (raw THREE.Mesh convention,
    used for the horizontal tank in the procedural fallback)."""
    kwargs = {'verts': verts}
    if ry is not None:
        kwargs['ry'] = ry
    return cyl(name, r, h, x, -z, y, mat, **kwargs)


def tempty(name, x, y, z):
    bpy.ops.object.empty_add(type='PLAIN_AXES', radius=0.05, location=(x, -z, y))
    o = bpy.context.object
    o.name = name
    return o


CORR = material('gas_corrugated', '#7c7468', 0.75, 0.30)
RIB = material('gas_rib', '#6a6357', 0.70, 0.30)
ROOFDARK = material('gas_roof', '#4e4a42', 0.85, 0.10)
STEEL = material('gas_steel', '#9aa1a7', 0.55, 0.40)
STACK = material('gas_stack', '#8a8378', 0.70, 0.15)
REDBAND = material('gas_red_band', '#c5483c', 0.55, 0.05)
TANK = material('gas_tank', '#c8ccd0', 0.35, 0.50)
DARKSTEEL = material('gas_dark_steel', '#3a4046', 0.60, 0.20)
YARD = material('gas_yard_steel', '#8b9198', 0.40, 0.55)
INSUL = material('gas_insulator', '#4a7d5f', 0.60, 0.10)
CONTROL = material('gas_control_wall', '#9aa1a6', 0.85, 0.05)
WINDOW = material('gas_control_window', '#2a3f52', 0.30, 0.15, emit='#ffcf8e', emit_str=1.4)

# ---------- turbine hall (corrugated cladding + ribbed pilasters) ----------
tbox('hall', 5.4, 3.0, 3.8, -0.6, 0, 0.4, CORR)
tgable('hall_roof', 5.8, 1.0, 4.2, -0.6, 3.0, 0.4, ROOFDARK)
for k, x in enumerate((-2.8, -1.6, -0.4, 0.8)):
    tbox(f'rib{k}', 0.10, 3.0, 0.08, x, 0, -1.56, RIB)

# control-room annex, warm emissive window strip (reads at night only)
tbox('control_wall', 1.8, 1.8, 1.4, -2.2, 0, -2.3, CONTROL)
tbox('control_win', 1.3, 0.45, 0.06, -2.2, 1.15, -2.36, WINDOW)

# ---------- gas pressure skid + horizontal tank ----------
tbox('skid', 2.2, 1.6, 1.8, -1.0, 0, 3.0, STEEL)
tcyl_c('tank', 0.8, 2.6, 1.8, 0.9, 3.0, TANK, verts=14, ry=90)

# ---------- twin banded smokestacks ----------
for k, x in enumerate((1.8, 3.1)):
    tcyl(f'stack{k}', 0.5, 9.0, x, 0, -1.0, STACK, r2=0.4, verts=16)
    tcyl(f'stack{k}_band', 0.46, 0.5, x, 8.6, -1.0, REDBAND, verts=16)

# ---------- pipe rack ----------
tbox('pipe_rack', 3.2, 0.16, 0.16, 0.4, 1.6, 2.5, DARKSTEEL)
for k, x in enumerate((-1.0, 0.4, 1.8)):
    tcyl(f'pipe_leg{k}', 0.05, 1.6, x, 0, 2.5, DARKSTEEL, verts=8)

# ---------- transformer yard ----------
tbox('transformer', 1.4, 1.7, 1.5, 2.4, 0, -3.4, DARKSTEEL)
for k, x in enumerate((1.8, 3.0)):
    tcyl(f'yard_leg{k}', 0.10, 3.0, x, 0, -3.4, YARD, verts=8)
tbox('yard_arm', 1.6, 0.12, 0.12, 2.4, 2.9, -3.4, YARD)
for k, x in enumerate((1.7, 2.4, 3.1)):
    tcyl(f'insulator{k}', 0.06, 0.45, x, 2.55, -3.4, INSUL, verts=8)

# ---------- smoke anchor (empty, no geometry) ----------
tempty('smoke', 3.1, 9.3, -1.0)

export_glb(out)
