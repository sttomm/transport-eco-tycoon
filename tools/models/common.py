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


def material(name, hexcol, rough, metal=0.0, emit=None, emit_str=0.0):
    """Principled material. `emit` (hex) + `emit_str` add an emission color and
    strength — exported as glTF emissiveFactor / KHR_materials_emissive_strength,
    which the runtime keeps as material.emissive/emissiveIntensity (head/tail
    lights). Keep emit_str below the bloom threshold (~3.4) or lights flare."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*srgb(hexcol), 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*srgb(emit), 1.0)
        bsdf.inputs['Emission Strength'].default_value = emit_str
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


def bevel(obj, width=0.03, segments=2, angle_deg=40):
    """Round sharp edges — the single biggest realism win on boxy vehicle
    bodies. Applies a Bevel modifier (angle-limited so only hard edges round),
    then re-projects box UVs since new bevel faces need coords. Box-projected
    parts only (cubes); call before joining. Also smooth-shades the result."""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new('bev', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle_deg)
    mod.harden_normals = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)
    box_uv(obj)
    smooth(obj, 55)
    return obj


def cube(name, sx, sy, sz, x, y, z, mat, cell=None, rot=None):
    """Box: dimensions (sx, sy, sz), center (x, y, z), optional euler degrees."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sy, sz)
    if rot:
        o.rotation_euler = tuple(math.radians(a) for a in rot)
    apply_all()
    set_mat(o, mat)
    if cell is not None:
        set_uv_cell(o, cell)
    else:
        box_uv(o)
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
    if rx or ry:  # tipped-over cylinder (pipe/wheel): axis isn't +Z, box-project
        box_uv(o)
    else:
        cyl_uv(o)
    if shade:
        smooth(o)
    return o


def gable(name, sx, sy, sz, x, y, z, mat):
    """Triangular prism (gabled roof): ridge along local X at the top,
    base sx × sy, height sz, base center at (x, y, z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.5))
    o = bpy.context.object
    o.name = name
    apply_all()
    for v in o.data.vertices:
        if v.co.z > 0.5:
            v.co.y = 0
    o.scale = (sx, sy, sz)
    o.location = (x, y, z)
    apply_all()
    set_mat(o, mat)
    box_uv(o)
    return o


def box_uv(obj, scale=1.0):
    """World-space box projection: every face is mapped along its dominant
    normal axis, 1 UV unit = `scale` world units. Gives every part the same
    texel density regardless of size, so the runtime can attach tileable
    canvas textures by material name (src/render/textures.js). Apply
    transforms first — vert coords must be world space."""
    me = obj.data
    layer = me.uv_layers.active or me.uv_layers.new(name='UVMap')
    inv = 1.0 / scale
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                uv = (co.y, co.z)
            elif ax == 1:
                uv = (co.x, co.z)
            else:
                uv = (co.x, co.y)
            layer.data[li].uv = (uv[0] * inv, uv[1] * inv)


def cyl_uv(obj, scale=1.0):
    """World-space cylindrical projection for +Z cylinders/cones: u follows
    the circumference (arc length at the mean radius), v is world z. Caps
    fall back to planar top-down mapping. Same 1 UV unit = `scale` world
    units contract as box_uv."""
    me = obj.data
    layer = me.uv_layers.active or me.uv_layers.new(name='UVMap')
    inv = 1.0 / scale
    verts = me.vertices
    cx = sum(v.co.x for v in verts) / len(verts)
    cy = sum(v.co.y for v in verts) / len(verts)
    r = sum(math.hypot(v.co.x - cx, v.co.y - cy) for v in verts) / len(verts)
    tau = 2 * math.pi
    for poly in me.polygons:
        if abs(poly.normal.z) > 0.7:  # cap: planar from above
            for li in poly.loop_indices:
                co = verts[me.loops[li].vertex_index].co
                layer.data[li].uv = (co.x * inv, co.y * inv)
            continue
        fc = poly.center
        th0 = math.atan2(fc.y - cy, fc.x - cx)
        for li in poly.loop_indices:
            co = verts[me.loops[li].vertex_index].co
            th = math.atan2(co.y - cy, co.x - cx)
            th = th0 + math.remainder(th - th0, tau)  # keep the face on one branch of the seam
            layer.data[li].uv = (th * r * inv, co.z * inv)


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
