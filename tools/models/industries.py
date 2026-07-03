# Industry buildings: mine, steel works, farm, food plant (2x2 tiles = 8 units).
#   blender --background --python tools/models/industries.py -- assets/models/industries.glb
#
# Nodes are named ind_<type>. The steel works keeps a SEPARATE child object
# named "glow" — world.js drives its emissiveIntensity from the industry's
# running state, and assets.js clones its material per instance.
import sys
import os
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import (material, cube, cyl, gable, join_parts, export_glb,  # noqa: E402
                    reset_scene, smooth, set_mat, bisect_z, band_material, deselect)

out = sys.argv[sys.argv.index('--') + 1]
reset_scene()

RUST = material('ind_rust', '#6b4a2f', 0.80, 0.05)  # dark: ACES + noon sun bleaches mid-browns to cream
DARKROOF = material('ind_dark_roof', '#3f3830', 0.90, 0.00)
TIMBER = material('ind_timber', '#463a2e', 0.80, 0.05)
WHEELM = material('ind_wheel', '#3c3835', 0.55, 0.30)
BELT = material('ind_belt', '#454744', 0.65, 0.15)
ORE = material('ind_ore', '#6e6a62', 0.95, 0.00)
CORR = material('ind_corr', '#5d6674', 0.60, 0.20)
CORR_DARK = material('ind_corr_dark', '#454c56', 0.65, 0.20)
CHIMNEY = material('ind_chimney', '#8a929c', 0.60, 0.10)
CHIMNEY_RED = material('ind_chimney_red', '#c5483c', 0.60, 0.10)
CONCRETE = material('ind_concrete', '#9aa1a6', 0.90, 0.00)
GLOW = material('glow_metal', '#331a00', 0.60, 0.10)  # emissive set at runtime
PLANKS = material('ind_planks', '#a8392c', 0.85, 0.00)
BARNROOF = material('ind_barn_roof', '#6e4634', 0.90, 0.00)
BARNDOOR = material('ind_barn_door', '#54311f', 0.80, 0.00)
SILO = material('ind_silo', '#d9dde1', 0.55, 0.25)
SOIL = material('ind_soil', '#8a6f42', 1.00, 0.00)
CROP = material('ind_crop', '#c9b34a', 0.95, 0.00)
PANEL = material('ind_panel', '#dde2e7', 0.55, 0.20)
PANEL_TRIM = material('ind_panel_trim', '#9aa2aa', 0.60, 0.25)
STAINLESS = material('ind_stainless', '#c8ced4', 0.45, 0.35)
SIGN = material('ind_sign', '#3f7fbf', 0.50, 0.10)
STEELGREY = material('ind_steel_grey', '#8d959d', 0.55, 0.25)


def mine():
    p = [cube('hall', 4.6, 3.6, 2.8, 0.4, -0.2, 1.4, RUST)]
    p.append(gable('roof', 5.0, 4.0, 1.1, 0.4, -0.2, 2.8, DARKROOF))
    # headframe with sheave wheel
    for x in (2.6, 3.6):
        p.append(cube(f'leg{x}', 0.45, 0.45, 5.4, x, 1.6, 2.7, TIMBER))
    p.append(cube('cross', 1.6, 0.5, 0.5, 3.1, 1.6, 5.0, TIMBER))
    p.append(cyl('wheel', 0.7, 0.2, 3.1, 1.6, 5.6, WHEELM, rx=90))
    p.append(cube('belt', 4.2, 0.8, 0.22, -1.5, -1.8, 2.15, BELT, rot=(0, 26, 0)))
    p.append(cyl('heap', 2.2, 2.0, -3.5, -1.8, 1.0, ORE, r2=0.3))
    return p


def steel():
    p = [cube('hall', 7.0, 5.0, 4.6, 0, 0, 2.3, CORR)]
    p.append(gable('roof', 7.4, 5.4, 1.4, 0, 0, 4.6, CORR_DARK))
    p.append(cube('annex', 3.4, 2.6, 2.2, -4.6, -0.8, 1.1, CORR))
    for x, h in ((-2.0, 9.5), (0.0, 8.5)):
        c = cyl(f'chim{x}', 0.62, h, x, 1.4, h / 2, CHIMNEY, r2=0.48)
        bisect_z(c, (h - 0.6,))
        band_material(c, CHIMNEY_RED, [(h - 0.6, h + 1)])
        p.append(c)
    p.append(cyl('furnace', 1.1, 3.2, 2.4, 1.6, 1.6, CONCRETE))
    return p


def steel_glow():
    """Separate named object; world.js pulses its emissive when running."""
    g = cube('glow', 2.4, 0.4, 2.2, 1.6, -2.55, 1.7, GLOW)
    mat = g.data.materials[0]
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Emission Color'].default_value = (1.0, 0.42, 0.06, 1.0)
    bsdf.inputs['Emission Strength'].default_value = 1.6
    return g


def farm():
    p = [cube('barn', 3.6, 2.8, 2.2, -1.6, 1.0, 1.1, PLANKS)]
    p.append(gable('barnroof', 4.0, 3.1, 1.5, -1.6, 1.0, 2.2, BARNROOF))
    p.append(cube('barndoor', 1.1, 0.1, 1.6, -1.6, -0.42, 0.8, BARNDOOR))
    p.append(cyl('silo', 0.9, 3.4, 1.2, 1.6, 1.7, SILO))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.9, location=(1.2, 1.6, 3.4))
    dome = bpy.context.object
    dome.name = 'dome'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    set_mat(dome, SILO)
    smooth(dome)
    p.append(dome)
    # crop field: soil bed + green/tan rows
    p.append(cube('field', 5.6, 4.6, 0.18, 1.6, -1.6, 0.09, SOIL))
    for k in range(6):
        p.append(cube(f'row{k}', 5.2, 0.34, 0.10, 1.6, -3.4 + k * 0.72, 0.22, CROP))
    return p


def food():
    p = [cube('hall', 5.6, 4.2, 3.2, -0.6, 0, 1.6, PANEL)]
    p.append(cube('rim', 5.8, 4.4, 0.22, -0.6, 0, 3.28, PANEL_TRIM))
    for y in (-1.2, 0.2, 1.4):
        p.append(cube(f'vent{y}', 0.8, 0.8, 0.5, -2.0, y, 3.6, STEELGREY))
    p.append(cube('sign', 2.0, 0.12, 1.1, -0.6, 2.14, 2.1, SIGN))
    for y in (0, 2.2):
        p.append(cyl(f'silo{y}', 0.95, 4.4, 2.9, y - 1.0, 2.2, STAINLESS))
        p.append(cyl(f'pipe{y}', 0.12, 2.2, 2.1, y - 1.0, 3.1, PANEL_TRIM, verts=8, ry=25))
    return p


ox = 0
for name, build in (('ind_mine', mine), ('ind_steel', steel), ('ind_farm', farm), ('ind_food', food)):
    obj = join_parts(build(), name)
    if name == 'ind_steel':
        g = steel_glow()
        deselect()
        g.parent = obj  # keep "glow" as its own named child node
    obj.location = (ox, 14, 0)  # layout only — ignored at load
    ox += 14

export_glb(out)
