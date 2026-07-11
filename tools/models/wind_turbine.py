# Wind turbine GLB for Transport Eco Tycoon — run headless:
#   blender --background --python tools/models/wind_turbine.py -- assets/models/wind_turbine.glb
#
# Deterministic (no randomness). Conventions the game relies on:
#   - origin at ground center, tower hub height ~14 game units (1 BU = 1 unit)
#   - rotor is a single object named "rotor" with IDENTITY object rotation,
#     located at the hub; it spins around its local +X (Blender X == glTF X).
#     world.js does `rotor.rotation.x += spin * dt`, so any baked rotation on
#     the node would break the animation.
#   - hub faces +X (same convention as the old procedural mesh)
#   - matte paint (roughness ≥ 0.55): glossy whites bloom in full sun (ADR 15)
import bpy
import bmesh
import math
import sys

out = sys.argv[sys.argv.index('--') + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------- helpers ----------
def srgb(hexstr):
    """hex sRGB -> linear RGB tuple (Principled BSDF expects linear)."""
    v = [int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in v)


def material(name, hexcol, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*srgb(hexcol), 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    return m


def set_mat(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def smooth(obj, angle_deg=35):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    except AttributeError:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle_deg))
    obj.select_set(False)


def deselect():
    bpy.ops.object.select_all(action='DESELECT')


def bisect_z(obj, zs):
    """Cut horizontal edge loops so paint bands get their own faces."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for zc in zs:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                               plane_co=(0, 0, zc), plane_no=(0, 0, 1))
    bm.to_mesh(me)
    bm.free()


def band_material(obj, mat, bands):
    """Assign mat to every face whose center z falls inside one of the bands."""
    me = obj.data
    me.materials.append(mat)
    idx = len(me.materials) - 1
    for poly in me.polygons:
        if any(z0 <= poly.center.z <= z1 for z0, z1 in bands):
            poly.material_index = idx


MAT_PAINT = material('turbine_paint', '#e8eaec', 0.55, 0.10)   # matte tower/nacelle white
MAT_BLADE = material('turbine_blade', '#f2f4f6', 0.55, 0.05)
MAT_ACCENT = material('turbine_accent', '#c2c7cc', 0.45, 0.30)  # flange, spinner
MAT_DARK = material('turbine_dark', '#3a4046', 0.60, 0.20)      # door, grille
MAT_RED = material('turbine_red', '#c5382e', 0.55, 0.05)        # blade tip bands
MAT_GREEN_D = material('turbine_green_dark', '#3f7d4a', 0.60, 0.05)   # tower base rings
MAT_GREEN_L = material('turbine_green_light', '#74ac6f', 0.60, 0.05)

# ---------- tower ----------
bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.55, radius2=0.30, depth=14, location=(0, 0, 7))
tower = bpy.context.object
tower.name = 'tower'
set_mat(tower, MAT_PAINT)
# bake location so mesh z == world z (cone data is centered, -7..+7) — the
# band cuts below are in world heights
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
# base rings: dark green, white gap, light green (Enercon-style)
bisect_z(tower, (0.35, 1.05, 1.65, 2.35))
band_material(tower, MAT_GREEN_D, [(0.35, 1.05)])
band_material(tower, MAT_GREEN_L, [(1.65, 2.35)])
smooth(tower)

bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.64, depth=0.35, location=(0, 0, 0.175))
flange = bpy.context.object
flange.name = 'flange'
set_mat(flange, MAT_ACCENT)
smooth(flange)

# service door, slightly proud of the tower wall, facing +X
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.52, 0, 1.05))
door = bpy.context.object
door.name = 'door'
door.scale = (0.06, 0.42, 0.75)
set_mat(door, MAT_DARK)

# ---------- nacelle ----------
bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.10, 0, 13.95))
nacelle = bpy.context.object
nacelle.name = 'nacelle'
nacelle.scale = (1.90, 1.00, 1.00)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bev = nacelle.modifiers.new('bevel', 'BEVEL')
bev.width = 0.14
bev.segments = 3
bpy.ops.object.modifier_apply(modifier='bevel')
set_mat(nacelle, MAT_PAINT)
smooth(nacelle, 40)

# cooling grille on the tail
bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.95, 0, 14.30))
grille = bpy.context.object
grille.name = 'grille'
grille.scale = (0.35, 0.62, 0.18)
set_mat(grille, MAT_DARK)

# ---------- rotor (assembled at world origin, joined, then moved to the hub
# so the exported node keeps an identity rotation) ----------
rotor_parts = []

bpy.ops.mesh.primitive_cone_add(vertices=18, radius1=0.34, radius2=0.04, depth=0.85,
                                rotation=(0, math.radians(90), 0), location=(0.32, 0, 0))
spinner = bpy.context.object
set_mat(spinner, MAT_ACCENT)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
smooth(spinner)
rotor_parts.append(spinner)

bpy.ops.mesh.primitive_cylinder_add(vertices=18, radius=0.36, depth=0.28,
                                    rotation=(0, math.radians(90), 0), location=(-0.16, 0, 0))
hubcap = bpy.context.object
set_mat(hubcap, MAT_ACCENT)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
smooth(hubcap)
rotor_parts.append(hubcap)

for k in range(3):
    ang = k * 2 * math.pi / 3
    # blade: tapered + twisted box, root fairing cylinder; built pointing +Z.
    # CRITICAL: the cube is placed at z=3.45 (not z=0) and baked with
    # transform_apply *before* the taper/twist modifiers run, so its verts
    # already span z=[0.35, 6.55] — entirely on the outward side of the hub
    # (z=0). A blade cube left straddling the hub (z spanning e.g. [-3.1,
    # +3.1]) reads as two opposite arms once swept around the rotation axis,
    # so 3 blades render as a fake 6-spoke star — always keep the bake
    # outward-only like this.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 3.45))
    blade = bpy.context.object
    blade.scale = (0.11, 0.30, 6.20)  # thin chord (0.30, was 0.62) + thin profile (0.11, was 0.15)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
    taper = blade.modifiers.new('taper', 'SIMPLE_DEFORM')
    taper.deform_method = 'TAPER'
    taper.deform_axis = 'Z'
    taper.factor = -0.74
    twist = blade.modifiers.new('twist', 'SIMPLE_DEFORM')
    twist.deform_method = 'TWIST'
    twist.deform_axis = 'Z'
    twist.angle = math.radians(16)  # slight twist root-to-tip
    bpy.ops.object.modifier_apply(modifier='taper')
    bpy.ops.object.modifier_apply(modifier='twist')
    set_mat(blade, MAT_BLADE)
    # aviation marking: two red bands at the tip, white between
    bisect_z(blade, (5.25, 5.65, 6.05))
    band_material(blade, MAT_RED, [(5.25, 5.65), (6.05, 6.60)])

    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.15, depth=0.55, location=(0, 0, 0.42))
    fairing = bpy.context.object
    set_mat(fairing, MAT_BLADE)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
    smooth(fairing)

    for obj in (blade, fairing):
        obj.rotation_euler = (ang, 0, 0)
        deselect()
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        rotor_parts.append(obj)

deselect()
for obj in rotor_parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = rotor_parts[0]
bpy.ops.object.join()
rotor = bpy.context.object
rotor.name = 'rotor'
rotor.location = (1.05, 0, 14.0)   # hub position; translation only, no rotation

# ---------- export ----------
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True)
print('wrote', out)
