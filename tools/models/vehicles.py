# Vehicles: bus, truck, electric locomotive + passenger/freight wagons.
#   blender --background --python tools/models/vehicles.py -- assets/models/vehicles.glb
#
# Conventions (src/render/vehicles.js): vehicles face +X at yaw 0, origin at
# ground/rail-top center. Sizes match the procedural meshes so stop spacing
# and wagon gaps stay right. One object per vehicle, named veh_*/wagon_* —
# assets.js registers every top-level node of this file by name.
# Blender axes here: x = game x (forward), y = -game z (lateral), z = up.
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import material, cube, cyl, join_parts, export_glb, reset_scene  # noqa: E402

out = sys.argv[sys.argv.index('--') + 1]
reset_scene()

GLASS = material('veh_glass', '#18242f', 0.15, 0.30)
TIRE = material('veh_tire', '#141618', 0.90, 0.00)
CHASSIS = material('veh_chassis', '#2b3036', 0.70, 0.30)
ROOF = material('veh_roof', '#dfe7ee', 0.45, 0.30)
BUS_BLUE = material('veh_bus_blue', '#1f66ad', 0.50, 0.08)
TRUCK_GREEN = material('veh_truck_green', '#276e45', 0.50, 0.08)
BOX_WHITE = material('veh_box_white', '#e8e4da', 0.60, 0.05)
TRAIN_RED = material('veh_train_red', '#b23028', 0.50, 0.08)
TRAIN_DARK = material('veh_train_dark', '#3a4046', 0.60, 0.30)
WAGON_BLUE = material('veh_wagon_blue', '#33699f', 0.50, 0.08)
WAGON_BROWN = material('veh_wagon_brown', '#7a6a52', 0.75, 0.10)
LOAD_GREY = material('veh_load', '#55504a', 0.95, 0.00)
ACCENT = material('veh_accent', '#c3c9ce', 0.50, 0.40)


def wheel(parts, name, x, y, r, w=0.16):
    parts.append(cyl(name, r, w, x, y, r, TIRE, verts=12, rx=90))


def bus():
    p = [cube('body', 2.8, 1.05, 1.12, 0, 0, 0.76, BUS_BLUE)]
    p.append(cube('roof', 2.75, 0.98, 0.10, 0, 0, 1.36, ROOF))
    p.append(cube('battpack', 1.3, 0.8, 0.12, -0.4, 0, 1.46, ACCENT))
    p.append(cube('winband', 2.45, 1.09, 0.42, 0.05, 0, 1.02, GLASS))
    p.append(cube('shield', 0.10, 0.96, 0.52, 1.36, 0, 1.00, GLASS, rot=(0, -8, 0)))
    p.append(cube('door', 0.62, 0.06, 0.95, 0.72, 0.53, 0.62, GLASS))
    p.append(cube('skirt', 2.5, 0.98, 0.22, 0, 0, 0.24, CHASSIS))
    for x in (0.95, -0.95):
        for y in (0.45, -0.45):
            wheel(p, f'w{x}{y}', x, y, 0.26)
    return p


def truck():
    p = [cube('cab', 0.95, 1.02, 1.05, 1.05, 0, 0.78, TRUCK_GREEN)]
    p.append(cube('shield', 0.08, 0.92, 0.44, 1.50, 0, 0.98, GLASS, rot=(0, -12, 0)))
    p.append(cube('sidewin', 0.7, 1.06, 0.34, 1.12, 0, 1.02, GLASS))
    p.append(cube('boxtrailer', 2.05, 1.10, 1.18, -0.50, 0, 0.90, BOX_WHITE))
    p.append(cube('boxroof', 2.05, 1.04, 0.06, -0.50, 0, 1.52, ACCENT))
    p.append(cube('chassis', 2.95, 0.80, 0.22, 0, 0, 0.32, CHASSIS))
    for x in (1.1, -0.1, -1.1):
        for y in (0.46, -0.46):
            wheel(p, f'w{x}{y}', x, y, 0.26)
    return p


def train():
    p = [cube('body', 3.1, 1.00, 0.92, 0, 0, 0.76, TRAIN_RED)]
    for sgn in (1, -1):  # slanted noses both ends
        p.append(cube(f'nose{sgn}', 0.55, 0.94, 0.80, sgn * 1.62, 0, 0.66, TRAIN_RED, rot=(0, sgn * 14, 0)))
        p.append(cube(f'front{sgn}', 0.10, 0.72, 0.28, sgn * 1.80, 0, 0.88, GLASS, rot=(0, sgn * 14, 0)))
    p.append(cube('winband', 2.7, 1.04, 0.34, 0, 0, 1.00, GLASS))
    p.append(cube('roof', 3.0, 0.90, 0.12, 0, 0, 1.28, ACCENT))
    p.append(cube('underframe', 2.8, 0.86, 0.28, 0, 0, 0.28, TRAIN_DARK))
    # pantograph
    p.append(cube('parm', 0.06, 0.06, 0.62, 0.42, 0, 1.62, TRAIN_DARK, rot=(0, 28, 0)))
    p.append(cube('pshoe', 0.08, 0.85, 0.05, 0.58, 0, 1.90, TRAIN_DARK))
    for x in (1.15, -1.15):
        for y in (0.42, -0.42):
            wheel(p, f'w{x}{y}', x, y, 0.20, 0.14)
    return p


def wagon_pax():
    p = [cube('body', 2.9, 0.96, 0.88, 0, 0, 0.66, WAGON_BLUE)]
    p.append(cube('winband', 2.6, 1.00, 0.30, 0, 0, 0.90, GLASS))
    p.append(cube('roof', 2.85, 0.88, 0.10, 0, 0, 1.15, ROOF))
    p.append(cube('under', 2.6, 0.80, 0.20, 0, 0, 0.22, CHASSIS))
    for x in (1.1, -1.1):
        for y in (0.42, -0.42):
            wheel(p, f'w{x}{y}', x, y, 0.18, 0.12)
    return p


def wagon_freight():
    p = [cube('tub', 2.9, 0.96, 0.78, 0, 0, 0.61, WAGON_BROWN)]
    p.append(cube('load', 2.45, 0.72, 0.28, 0, 0, 1.06, LOAD_GREY))
    for sgn in (1, -1):  # side ribs
        for x in (-0.95, 0, 0.95):
            p.append(cube(f'rib{sgn}{x}', 0.10, 0.06, 0.74, x, sgn * 0.50, 0.61, WAGON_BROWN))
    p.append(cube('under', 2.6, 0.80, 0.20, 0, 0, 0.22, CHASSIS))
    for x in (1.1, -1.1):
        for y in (0.42, -0.42):
            wheel(p, f'w{x}{y}', x, y, 0.18, 0.12)
    return p


ox = 0
for name, build in (('veh_bus', bus), ('veh_truck', truck), ('veh_train', train),
                    ('wagon_pax', wagon_pax), ('wagon_freight', wagon_freight)):
    obj = join_parts(build(), name)
    obj.location = (ox, 6, 0)  # layout only — ignored at load
    ox += 6

export_glb(out)
