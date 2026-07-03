# Transport stations: bus stop, truck depot, train station.
#   blender --background --python tools/models/stations.py -- assets/models/stations.glb
#
# Node names match the building types (buildPlantMesh routes by type).
# busStop/truckStop are 1 tile (4 units), trainStation 2 tiles (8 units).
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import material, cube, cyl, gable, join_parts, export_glb, reset_scene  # noqa: E402

out = sys.argv[sys.argv.index('--') + 1]
reset_scene()

PAVE = material('sta_pave', '#8f959b', 0.90, 0.00)
ASPHALT = material('sta_asphalt', '#3c4043', 0.95, 0.00)
POLE = material('sta_pole', '#4a5158', 0.60, 0.30)
GLASS = material('sta_glass', '#20303c', 0.20, 0.25)
SIGNBLUE = material('sta_sign_blue', '#2a63a3', 0.50, 0.10)
SHELTER = material('sta_shelter', '#c9cfd4', 0.55, 0.20)
DEPOT_ORANGE = material('sta_depot_orange', '#b05a20', 0.60, 0.05)
CHARGER = material('sta_charger', '#3a4550', 0.55, 0.20)
CHARGER_FACE = material('sta_charger_face', '#54c08a', 0.50, 0.05)
BRICKRED = material('sta_brick_red', '#8a4238', 0.80, 0.00)
STA_ROOF = material('sta_roof', '#4a4038', 0.90, 0.00)
PLATFORM = material('sta_platform', '#a89f8e', 0.90, 0.00)
CANOPY = material('sta_canopy', '#dfe3e7', 0.55, 0.15)
BOARD = material('sta_board', '#22303a', 0.45, 0.15)


def bus_stop():
    p = [cube('slab', 2.5, 1.5, 0.12, 0, 0, 0.06, PAVE)]
    for x in (-1.0, 1.0):
        p.append(cyl(f'post{x}', 0.05, 2.3, x, -0.45, 1.15, POLE, verts=8))
    p.append(cube('roofc', 2.4, 1.1, 0.08, 0, -0.2, 2.32, SIGNBLUE))
    p.append(cube('back', 2.3, 0.06, 1.5, 0, -0.62, 1.35, GLASS))
    p.append(cube('bench', 1.6, 0.35, 0.08, 0, -0.35, 0.55, SHELTER))
    p.append(cyl('signpole', 0.04, 2.6, 1.15, 0.55, 1.3, POLE, verts=8))
    p.append(cube('sign', 0.5, 0.06, 0.5, 1.15, 0.55, 2.5, SIGNBLUE))
    return p


def truck_stop():
    p = [cube('pad', 3.6, 3.6, 0.14, 0, 0, 0.07, ASPHALT)]
    p.append(cube('depot', 2.6, 1.7, 1.9, 0, -0.9, 1.05, DEPOT_ORANGE))
    p.append(cube('depotroof', 2.75, 1.85, 0.12, 0, -0.9, 2.06, SHELTER))
    p.append(cube('rolldoor', 1.5, 0.08, 1.4, 0, -0.02, 0.82, SHELTER))
    for k, x in enumerate((1.15, 0.25)):  # int names: Blender's name-uniquing
        p.append(cube(f'charger{k}', 0.45, 0.35, 1.25, x, 1.25, 0.72, CHARGER))  # stoi-crashes on long float suffixes
        p.append(cube(f'chface{k}', 0.35, 0.06, 0.5, x, 1.44, 1.05, CHARGER_FACE))
    return p


def train_station():
    p = [cube('platform', 7.0, 2.4, 0.55, 0, 1.6, 0.28, PLATFORM)]
    p.append(cube('house', 4.2, 2.6, 2.4, -1.2, -1.4, 1.2, BRICKRED))
    p.append(gable('roofh', 4.7, 3.0, 0.9, -1.2, -1.4, 2.4, STA_ROOF))
    p.append(cube('housedoor', 0.9, 0.1, 1.7, -1.2, -0.08, 0.85, BOARD))
    for x in (-2.6, 0.2):
        p.append(cube(f'housewin{x}', 0.8, 0.1, 1.0, x, -0.08, 1.5, GLASS))
    p.append(cube('canopy', 3.4, 1.7, 0.12, 1.8, 1.6, 2.24, CANOPY))
    for x in (0.6, 3.0):
        p.append(cyl(f'cpost{x}', 0.07, 1.7, x, 1.6, 1.4, POLE, verts=8))
    p.append(cube('board', 0.45, 0.1, 1.1, -3.0, 0.9, 1.15, BOARD))
    p.append(cube('clockp', 0.08, 0.08, 2.2, 3.3, 0.6, 1.1, POLE))
    p.append(cube('clock', 0.45, 0.12, 0.45, 3.3, 0.6, 2.35, CANOPY))
    return p


ox = 0
for name, build in (('busStop', bus_stop), ('truckStop', truck_stop), ('trainStation', train_station)):
    obj = join_parts(build(), name)
    obj.location = (ox, 8, 0)  # layout only
    ox += 10

export_glb(out)
