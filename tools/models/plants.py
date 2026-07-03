# Player power & storage buildings (wind has its own file):
#   solar, battery, hydro, electrolyzer, h2tank, fuelcell
#   blender --background --python tools/models/plants.py -- assets/models/plants.glb
#
# Node names == building type in sim/data.js (buildPlantMesh looks them up
# directly). Origin at ground center. Footprints: solar 3 tiles (12 units),
# the rest 2 tiles (8 units) — keep silhouettes readable at max zoom-out,
# players identify plants by shape. Solar panels stay dark (no emissive):
# "solar at night is zero" is a teaching contract.
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import material, cube, cyl, gable, join_parts, export_glb, reset_scene, smooth, set_mat  # noqa: E402

out = sys.argv[sys.argv.index('--') + 1]
reset_scene()

PANEL = material('plant_panel', '#0e1c33', 0.62, 0.05)  # matte-dark: glossy PV glints past the bloom threshold (ADR 15)      # PV glass
PANEL_EDGE = material('plant_panel_edge', '#aab1b8', 0.60, 0.25)
STEEL = material('plant_steel', '#8b8f94', 0.50, 0.30)
CABINET = material('plant_cabinet', '#dfe3e7', 0.55, 0.15)
CONCRETE = material('plant_concrete', '#9aa1a6', 0.90, 0.00)
CONC_DARK = material('plant_concrete_dark', '#7d848a', 0.92, 0.00)
ROOFGREY = material('plant_roof', '#5d6a73', 0.85, 0.10)
GATE = material('plant_gate', '#3a4754', 0.60, 0.25)
WATERBLUE = material('plant_water_steel', '#46708e', 0.50, 0.20)
CONTAINER = material('plant_container', '#e9edf0', 0.55, 0.12)
HVGREEN = material('plant_hv_green', '#2f7d4b', 0.60, 0.10)
TEAL = material('plant_teal', '#1d7263', 0.45, 0.15)
PIPE = material('plant_pipe', '#c2c8cd', 0.50, 0.35)
TANKWHITE = material('plant_tank_white', '#eef1f3', 0.50, 0.20)
DARKSTEEL = material('plant_dark_steel', '#3a4046', 0.60, 0.20)
FIN = material('plant_fin', '#7c8896', 0.60, 0.20)


def solar():
    p = []
    for r in range(3):
        y = (r - 1) * 3.7
        # tilted table: panel + edge frame + cell divider strips
        p.append(cube(f'tbl{r}', 10.4, 2.3, 0.10, 0, y, 1.55, PANEL, rot=(24, 0, 0)))
        p.append(cube(f'frame{r}', 10.5, 2.4, 0.06, 0, y - 0.02, 1.53, PANEL_EDGE, rot=(24, 0, 0)))
        for k in range(7):  # divider strips read as module joints
            p.append(cube(f'div{r}{k}', 0.05, 2.32, 0.115, -4.5 + k * 1.5, y, 1.555, PANEL_EDGE, rot=(24, 0, 0)))
        for x in (-4.4, -1.5, 1.5, 4.4):
            p.append(cyl(f'pile{r}{x}', 0.08, 1.1, x, y, 0.55, STEEL, verts=8))
    p.append(cube('inv', 1.3, 0.95, 1.1, 4.7, 5.0, 0.55, CABINET))
    p.append(cube('invtop', 1.2, 0.85, 0.10, 4.7, 5.0, 1.15, STEEL))
    return p


def battery():
    p = []
    for k in range(4):
        y = (k - 1.5) * 1.75
        p.append(cube(f'cont{k}', 3.4, 1.25, 1.5, -0.4, y, 0.75, CONTAINER))
        p.append(cube(f'hv{k}', 0.5, 0.06, 0.9, -1.6, y - 0.66, 0.75, HVGREEN))
        p.append(cube(f'cool{k}', 2.6, 0.9, 0.18, -0.4, y, 1.58, STEEL))
    p.append(cube('trafo', 1.2, 1.2, 1.7, 2.4, 0, 0.85, GATE))
    p.append(cyl('bushing1', 0.07, 0.6, 2.2, -0.25, 1.95, PIPE, verts=8))
    p.append(cyl('bushing2', 0.07, 0.6, 2.2, 0.25, 1.95, PIPE, verts=8))
    return p


def hydro():
    # must read "dam" from every rotation: weir + gates on one side,
    # spillway steps on the other, fat penstock over the roofline
    p = [cube('house', 5.0, 4.0, 3.2, 0, -0.4, 1.6, CONCRETE)]
    p.append(cube('plinth', 5.2, 4.2, 0.5, 0, -0.4, 0.25, CONC_DARK))
    for x in (-2.35, 2.35):
        p.append(cube(f'pilaster{x}', 0.35, 4.1, 3.0, x, -0.4, 1.5, CONC_DARK))
    for x in (0.3, 1.5):
        p.append(cube(f'win{x}', 0.7, 0.1, 1.4, x, -2.42, 1.9, GATE))
    p.append(gable('roof', 5.5, 4.5, 1.1, 0, -0.4, 3.2, ROOFGREY))
    p.append(cube('weir', 5.6, 1.4, 1.1, 0, 2.4, 0.55, CONC_DARK))
    p.append(cube('weirtop', 5.6, 0.5, 0.22, 0, 2.4, 1.15, WATERBLUE))
    for x in (-1.6, 0, 1.6):
        p.append(cube(f'gate{x}', 0.55, 0.18, 1.5, x, 1.85, 0.9, GATE))
    for k in range(3):  # spillway steps on the opposite side
        p.append(cube(f'step{k}', 3.4, 0.55, 0.9 - k * 0.3, 0.4, -2.7 - k * 0.55, (0.9 - k * 0.3) / 2, CONC_DARK))
    p.append(cyl('penstock', 0.45, 4.0, 1.9, 0.9, 0.55, PIPE, rx=90))
    p.append(cube('door', 0.9, 0.1, 1.8, -1.6, -2.42, 0.9, GATE))
    return p


def electrolyzer():
    p = []
    for k in range(3):
        x = (k - 1) * 2.1
        p.append(cyl(f'stack{k}', 0.8, 2.9, x, 0, 1.45, TEAL))
        p.append(cyl(f'cap{k}', 0.55, 0.35, x, 0, 3.05, PIPE))
    p.append(cube('rack', 4.6, 0.22, 0.22, 0, 0, 2.75, PIPE))
    p.append(cube('skid', 2.4, 1.7, 1.5, 0, 2.3, 0.75, CABINET))
    p.append(cube('vents', 2.0, 1.3, 0.14, 0, 2.3, 1.58, STEEL))
    return p


def h2tank():
    p = []
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=2.5, location=(0, 0, 3.0))
    sph = bpy.context.object
    sph.name = 'sphere'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    set_mat(sph, TANKWHITE)
    smooth(sph)
    p.append(sph)
    for k in range(4):
        a = k * 1.5708
        import math as _m
        p.append(cyl(f'leg{k}', 0.15, 2.4, _m.cos(a) * 1.7, _m.sin(a) * 1.7, 1.2, STEEL, verts=10))
    p.append(cyl('valve', 0.12, 1.2, 2.3, 0, 0.6, PIPE, verts=8))
    p.append(cube('pumpskid', 1.4, 1.0, 0.9, 2.9, 0, 0.45, CABINET))
    return p


def fuelcell():
    p = [cube('hall', 4.4, 3.2, 2.6, 0, 0, 1.3, CABINET)]
    for k in range(5):
        p.append(cube(f'fin{k}', 0.18, 2.9, 2.1, -1.8 + k * 0.9, 0, 2.72, FIN))
    p.append(cube('duct', 4.0, 0.5, 0.5, 0, 1.9, 2.4, DARKSTEEL))
    p.append(cyl('stack1', 0.22, 1.4, 1.6, 1.35, 3.2, PIPE, verts=10))
    p.append(cube('door', 0.9, 0.1, 1.7, -1.2, -1.62, 0.85, GATE))
    return p


ox = 0
for name, build in (('solar', solar), ('battery', battery), ('hydro', hydro),
                    ('electrolyzer', electrolyzer), ('h2tank', h2tank), ('fuelcell', fuelcell)):
    obj = join_parts(build(), name)
    obj.location = (ox, -14, 0)  # layout only — ignored at load
    ox += 14

export_glb(out)
