# Low-poly tree species for the instanced forest.
#   blender --background --python tools/models/trees.py -- assets/models/trees.glb
#
# Loaded via prepareTrees() in assets.js: each species is merged into ONE
# geometry with material colors baked into vertex colors, so the whole
# forest is one InstancedMesh per species. Flat-shaded icospheres read as
# stylized foliage. Albedos deliberately dark — noon ACES bleaches greens.
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import material, cyl, join_parts, export_glb, reset_scene, set_mat  # noqa: E402

out = sys.argv[sys.argv.index('--') + 1]
reset_scene()

TRUNK = material('tree_trunk', '#54402c', 0.90, 0.00)
CONIFER = material('tree_conifer_leaf', '#26562c', 0.90, 0.00)
OAK = material('tree_oak_leaf', '#33682f', 0.90, 0.00)
POPLAR = material('tree_poplar_leaf', '#4a7431', 0.90, 0.00)


def ico(name, r, x, y, z, mat, scale_z=1.0, subdiv=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=r, location=(x, y, z))
    o = bpy.context.object
    o.name = name
    o.scale = (1, 1, scale_z)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    set_mat(o, mat)
    return o  # flat-shaded on purpose


def cone(name, r, h, x, y, z, mat, verts=8):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=0.02, depth=h, location=(x, y, z))
    o = bpy.context.object
    o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    set_mat(o, mat)
    return o


def conifer():
    p = [cyl('trunk', 0.13, 1.0, 0, 0, 0.5, TRUNK, verts=6, shade=False)]
    p.append(cone('t1', 1.05, 1.5, 0, 0, 1.55, CONIFER))
    p.append(cone('t2', 0.80, 1.3, 0, 0, 2.35, CONIFER))
    p.append(cone('t3', 0.52, 1.1, 0, 0, 3.10, CONIFER))
    return p


def oak():
    p = [cyl('trunk', 0.17, 1.3, 0, 0, 0.65, TRUNK, verts=6, shade=False)]
    p.append(ico('b1', 1.00, 0.0, 0.0, 2.05, OAK))
    p.append(ico('b2', 0.75, 0.65, 0.35, 1.75, OAK))
    p.append(ico('b3', 0.70, -0.60, -0.30, 1.85, OAK))
    p.append(ico('b4', 0.60, 0.05, -0.55, 2.45, OAK))
    return p


def poplar():
    p = [cyl('trunk', 0.11, 0.9, 0, 0, 0.45, TRUNK, verts=6, shade=False)]
    p.append(ico('col', 0.62, 0, 0, 2.25, POPLAR, scale_z=2.6))
    return p


ox = 0
for name, build in (('tree_conifer', conifer), ('tree_oak', oak), ('tree_poplar', poplar)):
    obj = join_parts(build(), name)
    obj.location = (ox, 0, 0)  # layout only
    ox += 5

export_glb(out)
