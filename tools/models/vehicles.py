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
from common import material, cube, cyl, bevel, join_parts, export_glb, reset_scene  # noqa: E402

out = sys.argv[sys.argv.index('--') + 1]
reset_scene()

# --- shared materials (names are load-time API for textures.js) ---
GLASS = material('veh_glass', '#141d27', 0.10, 0.35)
TIRE = material('veh_tire', '#101216', 0.85, 0.00)          # gets a tread texture
RIM = material('veh_rim', '#b7bcc2', 0.35, 0.75)            # bright alloy hub
CHASSIS = material('veh_chassis', '#23272c', 0.65, 0.30)
BUMPER = material('veh_bumper', '#2b2f34', 0.55, 0.20)
MIRROR = material('veh_mirror', '#30343a', 0.45, 0.30)
ROOF = material('veh_roof', '#d7dee6', 0.50, 0.15)
HEAD = material('veh_head', '#fff4d8', 0.20, 0.0, emit='#fff1cf', emit_str=2.4)   # warm headlamp
TAIL = material('veh_tail', '#c22018', 0.30, 0.0, emit='#ff2a1c', emit_str=1.8)   # red tail lamp
# painted body panels (subtle paint texture via textures.js), matte per ADR 16
BUS_BLUE = material('veh_bus_blue', '#1f66ad', 0.45, 0.10)
TRUCK_GREEN = material('veh_truck_green', '#276e45', 0.45, 0.10)
BOX_WHITE = material('veh_box_white', '#e8e4da', 0.60, 0.05)
TRAIN_RED = material('veh_train_red', '#b23028', 0.45, 0.10)
TRAIN_DARK = material('veh_train_dark', '#33383e', 0.55, 0.30)
WAGON_BLUE = material('veh_wagon_blue', '#33699f', 0.45, 0.10)
WAGON_BROWN = material('veh_wagon_brown', '#7a6a52', 0.75, 0.10)
LOAD_GREY = material('veh_load', '#55504a', 0.95, 0.00)
ACCENT = material('veh_accent', '#c3c9ce', 0.50, 0.35)


def wheel(parts, tag, x, y, r, w=0.17):
    """Dark tire + bright alloy rim that pokes out both sides."""
    parts.append(cyl(f't{tag}', r, w, x, y, r, TIRE, verts=18, rx=90))
    parts.append(cyl(f'r{tag}', r * 0.58, w + 0.04, x, y, r, RIM, verts=12, rx=90))


def lamp(parts, tag, mat, x, y, z, sy=0.20, sz=0.16):
    parts.append(cube(f'l{tag}', 0.07, sy, sz, x, y, z, mat))


def mirror(parts, tag, x, y, z):
    parts.append(cyl(f'ma{tag}', 0.03, 0.34, x, y, z, CHASSIS, verts=6, rx=90))     # arm
    parts.append(cube(f'mg{tag}', 0.06, 0.10, 0.22, x + 0.05, y, z + 0.05, MIRROR)) # glass pad


def bus():
    body = cube('body', 2.8, 1.05, 1.12, 0, 0, 0.76, BUS_BLUE)
    bevel(body, 0.07)
    p = [body]
    p.append(cube('roof', 2.72, 0.96, 0.12, 0, 0, 1.36, ROOF))
    p.append(cube('battpack', 1.3, 0.8, 0.12, -0.4, 0, 1.46, ACCENT))
    p.append(cube('winband', 2.45, 1.10, 0.44, 0.05, 0, 1.02, GLASS))
    # window pillars break the glass band into panes
    for x in (-1.0, -0.3, 0.5, 1.05):
        p.append(cube(f'pil{x}', 0.06, 1.12, 0.44, x, 0, 1.02, BUS_BLUE))
    p.append(cube('shield', 0.10, 0.98, 0.54, 1.36, 0, 1.00, GLASS, rot=(0, -8, 0)))
    p.append(cube('door', 0.60, 0.06, 0.94, 0.74, 0.54, 0.62, GLASS))
    p.append(cube('destsign', 0.05, 0.70, 0.16, 1.42, 0, 1.28, ACCENT))     # route board
    p.append(cube('skirt', 2.5, 0.98, 0.22, 0, 0, 0.24, CHASSIS))
    p.append(cube('fbump', 0.16, 1.02, 0.26, 1.40, 0, 0.30, BUMPER))
    p.append(cube('rbump', 0.16, 1.02, 0.26, -1.40, 0, 0.30, BUMPER))
    lamp(p, '_hl', HEAD, 1.42, 0.40, 0.52)
    lamp(p, '_hr', HEAD, 1.42, -0.40, 0.52)
    lamp(p, '_tl', TAIL, -1.42, 0.42, 0.58)
    lamp(p, '_tr', TAIL, -1.42, -0.42, 0.58)
    mirror(p, '_l', 1.30, 0.60, 1.02)
    mirror(p, '_r', 1.30, -0.60, 1.02)
    for x in (0.95, -0.95):
        for y in (0.47, -0.47):
            wheel(p, f'{x}{y}', x, y, 0.27)
    return p


def truck():
    cab = cube('cab', 0.98, 1.04, 1.10, 1.02, 0, 0.80, TRUCK_GREEN)
    bevel(cab, 0.07)
    p = [cab]
    p.append(cube('shield', 0.08, 0.94, 0.46, 1.48, 0, 1.00, GLASS, rot=(0, -12, 0)))
    p.append(cube('sidewin', 0.66, 1.08, 0.36, 1.10, 0, 1.04, GLASS))
    p.append(cube('grille', 0.10, 0.86, 0.42, 1.50, 0, 0.52, CHASSIS))
    box = cube('boxtrailer', 2.05, 1.12, 1.20, -0.50, 0, 0.92, BOX_WHITE)
    bevel(box, 0.05)
    p.append(box)
    p.append(cube('boxroof', 2.05, 1.06, 0.06, -0.50, 0, 1.54, ACCENT))
    p.append(cube('chassis', 2.95, 0.80, 0.22, 0, 0, 0.32, CHASSIS))
    p.append(cube('fbump', 0.16, 1.06, 0.24, 1.52, 0, 0.30, BUMPER))
    p.append(cyl('stack', 0.06, 0.9, 0.55, 0.52, 1.1, CHASSIS, verts=8))     # exhaust stack
    lamp(p, '_hl', HEAD, 1.53, 0.38, 0.52)
    lamp(p, '_hr', HEAD, 1.53, -0.38, 0.52)
    lamp(p, '_tl', TAIL, -1.53, 0.42, 0.50)
    lamp(p, '_tr', TAIL, -1.53, -0.42, 0.50)
    mirror(p, '_l', 1.20, 0.62, 1.06)
    mirror(p, '_r', 1.20, -0.62, 1.06)
    for x in (1.1, -0.1, -1.1):
        for y in (0.48, -0.48):
            wheel(p, f'{x}{y}', x, y, 0.27)
    return p


def train():
    body = cube('body', 3.1, 1.00, 0.94, 0, 0, 0.77, TRAIN_RED)
    bevel(body, 0.08)
    p = [body]
    for sgn in (1, -1):  # slanted, rounded noses both ends
        nose = cube(f'nose{sgn}', 0.60, 0.96, 0.82, sgn * 1.60, 0, 0.66, TRAIN_RED, rot=(0, sgn * 15, 0))
        bevel(nose, 0.10)
        p.append(nose)
        p.append(cube(f'front{sgn}', 0.10, 0.74, 0.30, sgn * 1.82, 0, 0.90, GLASS, rot=(0, sgn * 15, 0)))
        lamp(p, f'_h{sgn}u', HEAD, sgn * 1.86, 0.34, 0.52)
        lamp(p, f'_h{sgn}d', HEAD, sgn * 1.86, -0.34, 0.52)
        p.append(cube(f'buf{sgn}', 0.14, 0.86, 0.16, sgn * 1.92, 0, 0.34, CHASSIS))  # buffer beam
    p.append(cube('winband', 2.7, 1.05, 0.36, 0, 0, 1.00, GLASS))
    for x in (-1.0, -0.35, 0.35, 1.0):
        p.append(cube(f'pil{x}', 0.06, 1.07, 0.36, x, 0, 1.00, TRAIN_RED))
    roof = cube('roof', 3.0, 0.90, 0.14, 0, 0, 1.28, ACCENT)
    bevel(roof, 0.05)
    p.append(roof)
    p.append(cube('underframe', 2.8, 0.86, 0.28, 0, 0, 0.28, TRAIN_DARK))
    # pantograph
    p.append(cube('parm', 0.06, 0.06, 0.62, 0.42, 0, 1.62, TRAIN_DARK, rot=(0, 28, 0)))
    p.append(cube('pshoe', 0.08, 0.85, 0.05, 0.58, 0, 1.90, TRAIN_DARK))
    for x in (1.15, -1.15):
        for y in (0.42, -0.42):
            wheel(p, f'{x}{y}', x, y, 0.21, 0.15)
    return p


def wagon_pax():
    body = cube('body', 2.9, 0.96, 0.90, 0, 0, 0.66, WAGON_BLUE)
    bevel(body, 0.07)
    p = [body]
    p.append(cube('winband', 2.6, 1.01, 0.32, 0, 0, 0.90, GLASS))
    for x in (-0.9, -0.3, 0.3, 0.9):
        p.append(cube(f'pil{x}', 0.06, 1.02, 0.32, x, 0, 0.90, WAGON_BLUE))
    roof = cube('roof', 2.85, 0.88, 0.12, 0, 0, 1.15, ROOF)
    bevel(roof, 0.05)
    p.append(roof)
    p.append(cube('under', 2.6, 0.80, 0.20, 0, 0, 0.22, CHASSIS))
    for x in (1.1, -1.1):
        for y in (0.42, -0.42):
            wheel(p, f'{x}{y}', x, y, 0.19, 0.13)
    return p


def wagon_freight():
    tub = cube('tub', 2.9, 0.96, 0.80, 0, 0, 0.62, WAGON_BROWN)
    bevel(tub, 0.05)
    p = [tub]
    p.append(cube('load', 2.45, 0.72, 0.30, 0, 0, 1.06, LOAD_GREY))
    for sgn in (1, -1):  # side ribs
        for x in (-0.95, 0, 0.95):
            p.append(cube(f'rib{sgn}{x}', 0.10, 0.06, 0.76, x, sgn * 0.50, 0.62, WAGON_BROWN))
    p.append(cube('under', 2.6, 0.80, 0.20, 0, 0, 0.22, CHASSIS))
    for x in (1.1, -1.1):
        for y in (0.42, -0.42):
            wheel(p, f'{x}{y}', x, y, 0.19, 0.13)
    return p


ox = 0
for name, build in (('veh_bus', bus), ('veh_truck', truck), ('veh_train', train),
                    ('wagon_pax', wagon_pax), ('wagon_freight', wagon_freight)):
    obj = join_parts(build(), name)
    obj.location = (ox, 6, 0)  # layout only — ignored at load
    ox += 6

export_glb(out)
