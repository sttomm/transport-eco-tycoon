# Shared helpers for the Blender asset scripts. Blender doesn't put the
# script's directory on sys.path, so scripts import this as:
#   sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
#   from common import ...
#
# Conventions (see docs/GRAPHICS-PHASE2-PLAN.md and ADR 16):
#   - 1 Blender unit = 1 game unit, +Z up (exporter converts to glTF +Y up)
#   - every part gets its full transform applied (verts in world space,
#     origin at world origin) so joins and exports carry no baked rotations
#   - object/material names are load-time API — keep them stable
import bpy
import bmesh
import math


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


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


def deselect():
    bpy.ops.object.select_all(action='DESELECT')


def smooth(obj, angle_deg=35):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    except AttributeError:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle_deg))
    obj.select_set(False)


def apply_all(obj=None):
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def cube(name, sx, sy, sz, x, y, z, mat, cell=None):
    """Axis-aligned box: dimensions (sx, sy, sz), center (x, y, z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sy, sz)
    apply_all()
    set_mat(o, mat)
    if cell is not None:
        set_uv_cell(o, cell)
    return o


def cyl(name, r, h, x, y, z, mat, verts=16, rx=0, ry=0, r2=None, shade=True):
    """Cylinder (or truncated cone if r2 given), axis +Z unless rotated."""
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=(x, y, z),
                                            rotation=(math.radians(rx), math.radians(ry), 0))
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=h, location=(x, y, z),
                                        rotation=(math.radians(rx), math.radians(ry), 0))
    o = bpy.context.object
    o.name = name
    apply_all()
    set_mat(o, mat)
    if shade:
        smooth(o)
    return o


def set_uv_cell(obj, cell, grid=8):
    """Collapse the whole mesh's UVs onto one cell center of a grid×grid
    atlas — the runtime samples one flat value per part (window lit/unlit)."""
    me = obj.data
    layer = me.uv_layers.active or me.uv_layers.new(name='UVMap')
    u, v = (cell[0] + 0.5) / grid, (cell[1] + 0.5) / grid
    for k in range(len(layer.data)):
        layer.data[k].uv = (u, v)


def bisect_z(obj, zs):
    """Cut horizontal edge loops (world z heights — apply transforms first)."""
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


def join_parts(parts, name):
    deselect()
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    return obj


def export_glb(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True)
    print('wrote', path)
