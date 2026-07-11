# Tree species for the instanced forest (graphics phase 3, WP3).
#   blender --background --python tools/models/trees.py -- assets/models/trees.glb
#
# Loaded via prepareTrees() in assets.js: each species is merged into ONE
# geometry with material colors baked into vertex colors, so the whole
# forest is one InstancedMesh per species (world.js buildTreesGLTF). Shapes
# and proportions are ported verbatim from docs/art-direction/lookdev-blender.py
# (make_oak/make_conifer/make_poplar/make_birch in build_hifi()), with lobe/
# vertex counts trimmed to hit the ~2.5k tri/tree budget. Albedos deliberately
# dark — noon ACES bleaches greens (birch bark is the one exception: it needs
# to read as pale bark, so it's darkened less than the leaf colors).
import sys
import os
import math
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Vector, noise  # noqa: E402
from common import (material, cyl, join_parts, export_glb, reset_scene,  # noqa: E402
                     set_mat, box_uv, smooth, apply_all)

out = sys.argv[sys.argv.index('--') + 1]
reset_scene()

TRUNK = material('tree_trunk', '#54402c', 0.90, 0.00)
CONIFER = material('tree_conifer_leaf', '#26562c', 0.90, 0.00)
OAK1 = material('tree_oak_leaf', '#33682f', 0.90, 0.00)
OAK2 = material('tree_oak_leaf2', '#3d7a38', 0.90, 0.00)
POPLAR1 = material('tree_poplar_leaf', '#4a7431', 0.90, 0.00)
POPLAR2 = material('tree_poplar_leaf2', '#568539', 0.90, 0.00)
BIRCH_TRUNK = material('tree_birch_trunk', '#b1afa9', 0.85, 0.00)
BIRCH_BAND = material('tree_birch_band', '#3e3b38', 0.85, 0.00)
BIRCH_LEAF = material('tree_birch_leaf', '#5e7842', 0.90, 0.00)


# ---------------------------------------------------------------- canopy primitives
def ico_lobe(name, r, x, y, z, mat, seed, amp=0.16, freq=2.0, sub=1, scale=None):
    """Icosphere canopy lobe: displaced by 3D noise (per-lobe `seed` so lobes
    on the same tree don't come out as visible clones), then shade_smooth so
    the bumps read as soft foliage rather than facets."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=(x, y, z))
    o = bpy.context.object
    o.name = name
    if scale:
        o.scale = scale
    for v in o.data.vertices:
        n = noise.noise(Vector((v.co.x * freq + seed, v.co.y * freq + seed * 2.0, v.co.z * freq)))
        v.co += v.co.normalized() * n * amp
    apply_all()
    set_mat(o, mat)
    box_uv(o)
    smooth(o, 40)
    return o


def conifer_tier(name, r, h, x, y, z, mat, seed, r2=None, r2ratio=0.30, verts=14,
                  amp=0.14, freq=2.6, droop=0.14):
    """One stacked cone of a conifer: radial noise (xy only, so the cone
    silhouette survives) then droops the wide bottom ring down for the
    layered, drooping-skirt look."""
    r2v = r2 if r2 is not None else r * r2ratio
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2v, depth=h, location=(x, y, z))
    o = bpy.context.object
    o.name = name
    for v in o.data.vertices:
        d = Vector((v.co.x, v.co.y, 0))
        n = noise.noise(Vector((v.co.x * freq + seed, v.co.y * freq + seed * 2.0, v.co.z * freq)))
        if d.length > 0.03:
            v.co += d.normalized() * n * amp
        dd = math.hypot(v.co.x, v.co.y)
        if v.co.z < 0 and dd > r * 0.5:
            v.co.z -= droop * (dd / r)
    apply_all()
    set_mat(o, mat)
    box_uv(o)
    smooth(o, 40)
    return o


# ---------------------------------------------------------------- species
def oak():
    """3-4 branch cylinders off a tapered trunk, 8-14 displaced icosphere
    lobes in two greens at the branch ends + crown."""
    rng = random.Random(500)
    p = [cyl('trunk', 0.17, 1.5, 0, 0, 0.75, TRUNK, verts=10, r2=0.11, shade=False)]
    ends = []
    for k in range(rng.randint(3, 4)):
        a = rng.uniform(0, 2 * math.pi) + k * 2.0
        tilt = rng.uniform(28, 50)
        length = rng.uniform(0.9, 1.4)
        bx = 0.55 * length * math.cos(a)
        by = 0.55 * length * math.sin(a)
        p.append(cyl('branch%d' % k, 0.075, length, bx * 0.55, by * 0.55, 1.35 + length * 0.32, TRUNK,
                      verts=7, r2=0.035, shade=False,
                      rx=tilt * math.sin(a + math.pi / 2), ry=tilt * math.cos(a + math.pi / 2)))
        ends.append((bx, by, 1.55 + length * 0.55, rng.randint(2, 3)))
    ends.append((0.0, 0.0, 2.15, 2))  # crown top — capped lobe count keeps total in [8, 14]
    lobe_i = 0
    for (ex, ey, ez, n_lobes) in ends:
        for _ in range(n_lobes):
            r = rng.uniform(0.38, 0.62)
            m = OAK1 if rng.random() < 0.6 else OAK2
            p.append(ico_lobe('lobe%d' % lobe_i, r, ex + rng.uniform(-0.30, 0.30), ey + rng.uniform(-0.30, 0.30),
                               ez + rng.uniform(-0.15, 0.35), m, seed=lobe_i * 3.1 + 1.0,
                               amp=rng.uniform(0.13, 0.2), freq=2.0, sub=2))
            lobe_i += 1
    return p


def conifer():
    """7 stacked displaced cones (shrinking radius, drooped skirts) + a
    slender tip cone."""
    p = [cyl('trunk', 0.14, 1.0, 0, 0, 0.5, TRUNK, verts=9, r2=0.09, shade=False)]
    z, r = 0.75, 1.05
    for k in range(7):
        h = 0.65
        p.append(conifer_tier('tier%d' % k, r, h, 0, 0, z + h / 2, CONIFER, seed=k * 1.7 + 0.5,
                               r2ratio=0.30, verts=14, amp=0.14, freq=2.6, droop=0.14))
        z += h * 0.66
        r *= 0.82
    p.append(conifer_tier('tip', r, 0.85, 0, 0, z + 0.38, CONIFER, seed=11.0,
                           r2=0.02, verts=12, amp=0.06, freq=3.0, droop=0.0))
    return p


def poplar():
    """Trunk + 3 stacked, vertically-stretched displaced icosphere lobes."""
    rng = random.Random(650)
    p = [cyl('trunk', 0.12, 1.0, 0, 0, 0.5, TRUNK, verts=9, r2=0.08, shade=False)]
    for k, (r, z, s) in enumerate([(0.55, 1.6, 1.6), (0.62, 2.5, 1.9), (0.45, 3.4, 1.4)]):
        m = POPLAR1 if k % 2 == 0 else POPLAR2
        p.append(ico_lobe('lobe%d' % k, r, rng.uniform(-0.06, 0.06), rng.uniform(-0.06, 0.06), z, m,
                           seed=k * 2.0 + 5.0, amp=0.11, freq=2.2, sub=3, scale=(1, 1, s)))
    return p


def birch():
    """Tall thin white trunk with dark band rings, 4-6 small airy displaced
    icosphere lobes."""
    rng = random.Random(680)
    p = [cyl('trunk', 0.10, 2.7, 0, 0, 1.35, BIRCH_TRUNK, verts=9, r2=0.055, shade=False)]
    for k in range(4):
        z = rng.uniform(0.3, 2.2)
        p.append(cyl('band%d' % k, 0.105 - k * 0.012, 0.07, 0, 0, z, BIRCH_BAND, verts=9, shade=False))
    for k in range(rng.randint(4, 6)):
        r = rng.uniform(0.30, 0.5)
        p.append(ico_lobe('lobe%d' % k, r, rng.uniform(-0.45, 0.45), rng.uniform(-0.45, 0.45),
                           rng.uniform(2.3, 3.2), BIRCH_LEAF, seed=k * 4.0 + 9.0, amp=0.14, freq=2.4, sub=2))
    return p


ox = 0
for name, build in (('tree_conifer', conifer), ('tree_oak', oak), ('tree_poplar', poplar), ('tree_birch', birch)):
    obj = join_parts(build(), name)
    obj.location = (ox, 0, 0)  # layout only
    ox += 5

export_glb(out)
