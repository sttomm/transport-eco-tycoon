# New-geometry mockups for Transport Eco Tycoon — goes beyond restyling:
# every model here is built from scratch (no game GLBs).
# Usage: blender -b -P newmodels.py -- <style> <out.png> [quick]
# Styles: hifi | hifi-close | hifi-nature | hexworld | hexworld-close
import bpy
import bmesh
import math
import random
import sys
from mathutils import Vector, Matrix, noise

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['hifi', '/tmp/mock.png']
STYLE = ARGS[0]
OUT = ARGS[1]
QUICK = len(ARGS) > 2 and ARGS[2] == 'quick'
BASE = STYLE.split('-')[0]
CLOSE = STYLE.endswith('-close')
NATURE = STYLE.endswith('-nature')
random.seed(11)

bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene

# ---------------------------------------------------------------- materials
MATS = {}


def mat(name, col, rough=0.8, metal=0.0, emitc=None, emits=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*col, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emitc:
        b.inputs['Emission Color'].default_value = (*emitc, 1.0)
        b.inputs['Emission Strength'].default_value = emits
    MATS[name] = m
    return m


# ---------------------------------------------------------------- primitives
def P_cube(sx, sy, sz, x, y, z, m, rot=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    o = bpy.context.object
    o.scale = (sx, sy, sz)
    if rot:
        o.rotation_euler = tuple(math.radians(a) for a in rot)
    o.data.materials.append(m)
    return o


def P_cyl(r, h, x, y, z, m, verts=16, r2=None, rot=None, smoothed=True):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=(x, y, z))
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=h, location=(x, y, z))
    o = bpy.context.object
    if rot:
        o.rotation_euler = tuple(math.radians(a) for a in rot)
    o.data.materials.append(m)
    if smoothed and verts > 8:
        bpy.ops.object.shade_smooth()
    return o


def P_ico(r, x, y, z, m, sub=3, scale=None, smoothed=True):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=(x, y, z))
    o = bpy.context.object
    if scale:
        o.scale = scale
    o.data.materials.append(m)
    if smoothed:
        bpy.ops.object.shade_smooth()
    return o


def P_gable(sx, sy, sz, x, y, z, m):
    """Triangular prism, ridge along local X, base center at (x,y,z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    o = bpy.context.object
    for v in o.data.vertices:
        if v.co.z > 0:
            v.co.y = 0
        v.co.z += 0.5
    o.scale = (sx, sy, sz)
    o.location = (x, y, z)
    o.data.materials.append(m)
    return o


def blobify(o, amp=0.16, freq=1.4, seed=0.0, radial_xy=False):
    for v in o.data.vertices:
        n = noise.noise(Vector((v.co.x * freq + seed, v.co.y * freq + seed * 2, v.co.z * freq)))
        if radial_xy:
            d = Vector((v.co.x, v.co.y, 0))
            if d.length > 0.03:
                v.co += d.normalized() * n * amp
        else:
            v.co += v.co.normalized() * n * amp


def bevelize(o, width=0.05, segments=2):
    bpy.context.view_layer.objects.active = o
    mod = o.modifiers.new('bev', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(40)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return o


LIB = {}


def prefab(parts, name):
    """Join parts, bake to world space, origin -> bbox bottom-center, stash."""
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)
    vs = [v.co for v in o.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    o.data.transform(Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))))
    o.name = name
    LIB[name] = o
    for coll in o.users_collection:
        coll.objects.unlink(o)
    return o


def inst(name, x, y, z=0.0, rz=0.0, s=1.0):
    src = LIB[name]
    o = src.copy()
    bpy.context.collection.objects.link(o)
    o.location = (x, y, z)
    o.rotation_euler = (0, 0, math.radians(rz))
    o.scale = (s, s, s)
    return o


# ---------------------------------------------------------------- shared style plumbing
def world_solid(col, strength=1.0):
    w = bpy.data.worlds.new('w')
    SC.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*col, 1.0)
    bg.inputs['Strength'].default_value = strength


def cycles_setup(samples):
    SC.render.engine = 'CYCLES'
    SC.cycles.samples = 8 if QUICK else samples
    SC.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for dev in prefs.devices:
            dev.use = True
        SC.cycles.device = 'GPU'
        print('cycles: METAL GPU')
    except Exception as e:
        print('cycles: CPU fallback', e)


def mist_compositor(fac=0.22, col=(0.70, 0.80, 0.97), start=70, depth=190):
    SC.view_layers[0].use_pass_mist = True
    SC.world.mist_settings.start = start
    SC.world.mist_settings.depth = depth
    ng = bpy.data.node_groups.new('comp', 'CompositorNodeTree')
    SC.compositing_node_group = ng
    ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    rl = ng.nodes.new('CompositorNodeRLayers')
    mix = ng.nodes.new('ShaderNodeMixRGB')
    mix.blend_type = 'MIX'
    mix.inputs[2].default_value = (*col, 1.0)
    mul = ng.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = fac
    out = ng.nodes.new('NodeGroupOutput')
    ng.links.new(rl.outputs['Mist'], mul.inputs[0])
    ng.links.new(mul.outputs[0], mix.inputs[0])
    ng.links.new(rl.outputs['Image'], mix.inputs[1])
    ng.links.new(mix.outputs[0], out.inputs[0])


def look_at(cam, target):
    d = Vector(target) - Vector(cam.location)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


# ================================================================ HIFI WORLD
def build_hifi():
    M = dict(
        plaster=mat('plaster', (0.78, 0.73, 0.64), 0.85),
        cream=mat('cream', (0.85, 0.77, 0.58), 0.85),
        sage=mat('sage', (0.52, 0.57, 0.45), 0.85),
        rust=mat('rust', (0.62, 0.38, 0.24), 0.85),
        brick=mat('brick', (0.42, 0.19, 0.13), 0.9),
        brickdark=mat('brickdark', (0.28, 0.12, 0.09), 0.9),
        stone=mat('stone', (0.52, 0.50, 0.47), 0.9),
        concrete=mat('concrete', (0.58, 0.58, 0.56), 0.9),
        pave=mat('pave', (0.44, 0.44, 0.43), 0.95),
        rooftile=mat('rooftile', (0.36, 0.15, 0.11), 0.85),
        slate=mat('slate', (0.16, 0.17, 0.20), 0.75),
        glass=mat('glassm', (0.04, 0.09, 0.13), 0.08, 0.35),
        winglass=mat('winglass', (0.06, 0.10, 0.14), 0.1, 0.2),
        frame=mat('framem', (0.90, 0.90, 0.88), 0.5),
        metal=mat('metalm', (0.62, 0.64, 0.67), 0.35, 0.8),
        white=mat('whitem', (0.86, 0.88, 0.90), 0.4),
        turb=mat('turbm', (0.90, 0.92, 0.94), 0.3),
        panel=mat('panelm', (0.02, 0.05, 0.14), 0.12, 0.1),
        trunk=mat('trunkm', (0.24, 0.15, 0.09), 0.95),
        leaf1=mat('leaf1', (0.09, 0.26, 0.06), 0.9),
        leaf1b=mat('leaf1b', (0.14, 0.33, 0.08), 0.9),
        leaf2=mat('leaf2', (0.13, 0.32, 0.08), 0.9),
        leaf2b=mat('leaf2b', (0.19, 0.38, 0.10), 0.9),
        leaf3=mat('leaf3', (0.06, 0.20, 0.05), 0.9),
        leaf3b=mat('leaf3b', (0.09, 0.25, 0.07), 0.9),
        birch=mat('birchm', (0.80, 0.78, 0.72), 0.8),
        birchdark=mat('birchdark', (0.12, 0.11, 0.10), 0.9),
        birchleaf=mat('birchleaf', (0.25, 0.42, 0.12), 0.9),
        rock=mat('rockm', (0.36, 0.35, 0.33), 0.95),
        rock2=mat('rock2m', (0.30, 0.28, 0.25), 0.95),
        tuft=mat('tuftm', (0.16, 0.36, 0.09), 0.95),
        tuft2=mat('tuft2m', (0.28, 0.44, 0.12), 0.95),
        reed=mat('reedm', (0.42, 0.46, 0.18), 0.9),
        reedtop=mat('reedtopm', (0.48, 0.36, 0.20), 0.9),
        fl_white=mat('flwhite', (0.9, 0.9, 0.85), 0.7),
        fl_yellow=mat('flyellow', (0.9, 0.7, 0.12), 0.7),
        fl_red=mat('flred', (0.75, 0.15, 0.12), 0.7),
        soil=mat('soilm', (0.34, 0.24, 0.13), 0.95),
        soil2=mat('soil2m', (0.28, 0.19, 0.10), 0.95),
        cabbage=mat('cabbagem', (0.22, 0.42, 0.14), 0.85),
        fence=mat('fencem', (0.35, 0.26, 0.16), 0.9),
        curb=mat('curbm', (0.66, 0.66, 0.64), 0.85),
        gravel=mat('gravelm', (0.40, 0.36, 0.30), 0.95),
        wheat=mat('wheatm', (0.72, 0.58, 0.24), 0.9),
        wheat2=mat('wheat2', (0.60, 0.47, 0.18), 0.9),
        dark=mat('darkm', (0.10, 0.10, 0.11), 0.6),
        red=mat('redm', (0.55, 0.10, 0.08), 0.4),
        blue=mat('bluem', (0.10, 0.20, 0.45), 0.4),
        yellow=mat('yellowm', (0.75, 0.55, 0.10), 0.4),
        green=mat('greenm', (0.10, 0.42, 0.20), 0.5),
        tyre=mat('tyrem', (0.04, 0.04, 0.04), 0.9),
    )

    # ---------------- window helper: frame + inset glass, facing +Y
    def window(parts, x, y, z, w=0.55, h=0.75, rz=0):
        f = P_cube(w, 0.10, h, x, y, z, M['frame'], rot=(0, 0, rz))
        g = P_cube(w * 0.8, 0.12, h * 0.82, x, y, z, M['winglass'], rot=(0, 0, rz))
        parts += [f, g]

    def facade_windows(parts, w, d, floors, fh, z0=0.0, inset=0.02, skip_ground=False):
        for fl in range(floors):
            if skip_ground and fl == 0:
                continue
            zc = z0 + fl * fh + fh * 0.55
            nx = max(2, int(w / 0.95))
            for k in range(nx):
                xk = -w / 2 + (k + 0.5) * w / nx
                window(parts, xk, d / 2 - inset, zc)
                window(parts, xk, -d / 2 + inset, zc)
            ny = max(2, int(d / 0.95))
            for k in range(ny):
                yk = -d / 2 + (k + 0.5) * d / ny
                window(parts, w / 2 - inset, yk, zc, rz=90)
                window(parts, -w / 2 + inset, yk, zc, rz=90)

    # ---------------- building prefabs
    def make_house(i):
        rng = random.Random(100 + i)
        w, d = rng.uniform(2.3, 2.9), rng.uniform(2.0, 2.5)
        floors = rng.choice([1, 2, 2])
        fh = 1.45
        wall = rng.choice([M['plaster'], M['cream'], M['sage'], M['brick'], M['rust']])
        roofm = rng.choice([M['rooftile'], M['slate'], M['rooftile']])
        parts = [P_cube(w, d, floors * fh, 0, 0, floors * fh / 2, wall)]
        parts.append(P_cube(w + 0.14, d + 0.14, 0.16, 0, 0, 0.08, M['stone']))
        parts.append(P_gable(w + 0.42, d + 0.42, rng.uniform(0.9, 1.3), 0, 0, floors * fh, roofm))
        parts.append(P_cube(0.26, 0.26, 0.9, rng.uniform(-w / 4, w / 4), -d / 5,
                            floors * fh + 0.55, M['brickdark']))
        facade_windows(parts, w, d, floors, fh)
        # door
        parts.append(P_cube(0.6, 0.1, 1.05, rng.uniform(-w / 4, w / 4), d / 2, 0.55, M['slate']))
        return prefab(parts, 'house%d' % i)

    def make_apt(i):
        rng = random.Random(200 + i)
        w, d = rng.uniform(2.6, 3.0), rng.uniform(2.4, 2.8)
        floors = rng.choice([3, 4])
        fh = 1.15
        wall = rng.choice([M['plaster'], M['cream'], M['brick'], M['rust']])
        H = floors * fh
        parts = [P_cube(w, d, H, 0, 0, H / 2, wall)]
        parts.append(P_cube(w + 0.14, d + 0.14, 0.6, 0, 0, 0.3, M['stone']))
        for fl in range(1, floors):
            parts.append(P_cube(w + 0.10, d + 0.10, 0.07, 0, 0, fl * fh, M['frame']))
        facade_windows(parts, w, d, floors, fh)
        # balconies on +Y facade
        for fl in range(1, floors):
            bx = rng.uniform(-w / 5, w / 5)
            parts.append(P_cube(1.05, 0.5, 0.06, bx, d / 2 + 0.25, fl * fh + 0.35, M['concrete']))
            parts.append(P_cube(1.05, 0.05, 0.4, bx, d / 2 + 0.48, fl * fh + 0.6, M['metal']))
        # parapet + roof gear
        parts.append(P_cube(w + 0.1, 0.12, 0.35, 0, d / 2, H + 0.17, wall))
        parts.append(P_cube(w + 0.1, 0.12, 0.35, 0, -d / 2, H + 0.17, wall))
        parts.append(P_cube(0.12, d + 0.1, 0.35, w / 2, 0, H + 0.17, wall))
        parts.append(P_cube(0.12, d + 0.1, 0.35, -w / 2, 0, H + 0.17, wall))
        parts.append(P_cube(0.8, 0.6, 0.45, rng.uniform(-0.6, 0.6), 0, H + 0.22, M['metal']))
        parts.append(P_cube(0.9, 0.9, 0.6, -w / 4, -d / 4, H + 0.3, M['concrete']))
        return prefab(parts, 'apt%d' % i)

    def make_tower(i):
        rng = random.Random(300 + i)
        w, d = rng.uniform(2.7, 3.0), rng.uniform(2.6, 2.9)
        floors = rng.choice([6, 7, 8])
        fh = 1.0
        wall = rng.choice([M['concrete'], M['plaster'], M['brick']])
        H = floors * fh
        parts = [P_cube(w, d, H, 0, 0, H / 2, wall)]
        parts.append(P_cube(w + 0.16, d + 0.16, 0.9, 0, 0, 0.45, M['stone']))
        facade_windows(parts, w, d, floors, fh, skip_ground=True)
        parts.append(P_cube(w + 0.08, d + 0.08, 0.25, 0, 0, H + 0.12, wall))
        parts.append(P_cube(1.1, 0.8, 0.55, 0.5, 0.4, H + 0.4, M['metal']))
        parts.append(P_cube(0.9, 0.9, 0.7, -0.6, -0.5, H + 0.45, M['concrete']))
        parts.append(P_cyl(0.06, 1.6, 0.8, -0.8, H + 0.9, M['metal'], verts=8))
        return prefab(parts, 'tower%d' % i)

    def make_glasstower(i):
        rng = random.Random(400 + i)
        w, d = rng.uniform(2.6, 3.0), rng.uniform(2.5, 2.9)
        floors = rng.choice([6, 8, 9])
        fh = 1.05
        H = floors * fh
        parts = [P_cube(w, d, H, 0, 0, H / 2, M['glass'])]
        for fl in range(floors + 1):
            parts.append(P_cube(w + 0.08, d + 0.08, 0.10, 0, 0, min(fl * fh, H - 0.05), M['metal']))
        nmul = int(w / 0.5)
        for k in range(nmul + 1):
            xk = -w / 2 + k * w / nmul
            parts.append(P_cube(0.05, d + 0.06, H, xk, 0, H / 2, M['metal']))
            parts.append(P_cube(w + 0.06, 0.05, H, 0, -d / 2 + k * d / nmul, H / 2, M['metal']))
        parts.append(P_cube(w * 0.5, d * 0.5, 0.8, 0, 0, H + 0.4, M['metal']))
        parts.append(P_cube(w + 0.2, d + 0.2, 0.5, 0, 0, 0.25, M['stone']))
        return prefab(parts, 'glass%d' % i)

    # ---------------- trees (high-poly: branching trunks, many-lobed canopies)
    def make_oak(i):
        rng = random.Random(500 + i)
        la, lb = rng.choice([(M['leaf1'], M['leaf1b']), (M['leaf2'], M['leaf2b'])])
        parts = [P_cyl(0.17, 1.5, 0, 0, 0.75, M['trunk'], verts=10, r2=0.11)]
        ends = []
        for k in range(rng.randint(3, 4)):
            a = rng.uniform(0, 2 * math.pi) + k * 2.0
            tilt = rng.uniform(28, 50)
            L = rng.uniform(0.9, 1.4)
            bx = 0.55 * L * math.cos(a)
            by = 0.55 * L * math.sin(a)
            parts.append(P_cyl(0.075, L, bx * 0.55, by * 0.55, 1.35 + L * 0.32, M['trunk'],
                               verts=7, r2=0.035,
                               rot=(tilt * math.sin(a + math.pi / 2), tilt * math.cos(a + math.pi / 2), 0),
                               smoothed=False))
            ends.append((bx, by, 1.55 + L * 0.55))
        ends.append((0, 0, 2.15))
        for (ex, ey, ez) in ends:
            for k in range(rng.randint(2, 3)):
                r = rng.uniform(0.38, 0.62)
                b = P_ico(r, ex + rng.uniform(-0.30, 0.30), ey + rng.uniform(-0.30, 0.30),
                          ez + rng.uniform(-0.15, 0.35), la if rng.random() < 0.6 else lb, sub=3)
                blobify(b, amp=rng.uniform(0.13, 0.2), freq=2.0, seed=i * 7 + k + ez)
                parts.append(b)
        return prefab(parts, 'oak%d' % i)

    def make_conifer(i):
        rng = random.Random(600 + i)
        lm = M['leaf3'] if i % 2 == 0 else M['leaf3b']
        parts = [P_cyl(0.14, 1.0, 0, 0, 0.5, M['trunk'], verts=9, r2=0.09)]
        z = 0.75
        r = 1.05
        for k in range(7):
            h = 0.65
            c = P_cyl(r, h, 0, 0, z + h / 2, lm, verts=22, r2=r * 0.30)
            blobify(c, amp=0.14, freq=2.6, seed=i * 5 + k, radial_xy=True)
            # droop the skirt: pull the wide bottom ring down a touch
            for v in c.data.vertices:
                d = math.hypot(v.co.x, v.co.y)
                if v.co.z < 0 and d > r * 0.5:
                    v.co.z -= 0.14 * (d / r)
            parts.append(c)
            z += h * 0.66
            r *= 0.82
        tip = P_cyl(r, 0.85, 0, 0, z + 0.38, lm, verts=14, r2=0.02)
        blobify(tip, amp=0.06, freq=3.0, seed=i * 11, radial_xy=True)
        parts.append(tip)
        return prefab(parts, 'conifer%d' % i)

    def make_poplar(i):
        rng = random.Random(650 + i)
        parts = [P_cyl(0.12, 1.0, 0, 0, 0.5, M['trunk'], verts=9, r2=0.08)]
        for k, (r, z, s) in enumerate([(0.55, 1.6, 1.6), (0.62, 2.5, 1.9), (0.45, 3.4, 1.4)]):
            b = P_ico(r, rng.uniform(-0.06, 0.06), rng.uniform(-0.06, 0.06), z,
                      M['leaf2'] if k % 2 else M['leaf2b'], sub=3, scale=(1, 1, s))
            blobify(b, amp=0.11, freq=2.2, seed=i * 3 + k)
            parts.append(b)
        return prefab(parts, 'poplar%d' % i)

    def make_birch(i):
        rng = random.Random(680 + i)
        parts = [P_cyl(0.10, 2.7, 0, 0, 1.35, M['birch'], verts=9, r2=0.055)]
        for k in range(4):
            parts.append(P_cyl(0.105 - k * 0.012, 0.07, 0, 0, rng.uniform(0.3, 2.2),
                               M['birchdark'], verts=9, smoothed=False))
        for k in range(rng.randint(4, 6)):
            r = rng.uniform(0.30, 0.5)
            b = P_ico(r, rng.uniform(-0.45, 0.45), rng.uniform(-0.45, 0.45),
                      rng.uniform(2.3, 3.2), M['birchleaf'], sub=3)
            blobify(b, amp=0.14, freq=2.4, seed=i * 9 + k)
            parts.append(b)
        return prefab(parts, 'birch%d' % i)

    # ---------------- ground-cover prefabs
    def make_rock(i):
        rng = random.Random(720 + i)
        parts = []
        for k in range(rng.randint(1, 3)):
            r = rng.uniform(0.35, 0.8)
            b = P_ico(r, rng.uniform(-0.5, 0.5), rng.uniform(-0.4, 0.4), r * 0.35,
                      M['rock'] if rng.random() < 0.7 else M['rock2'], sub=2,
                      scale=(1, rng.uniform(0.7, 1.0), rng.uniform(0.5, 0.75)))
            blobify(b, amp=0.22, freq=1.6, seed=i * 13 + k)
            parts.append(b)
        return prefab(parts, 'rock%d' % i)

    def make_bush(i):
        rng = random.Random(760 + i)
        lm = rng.choice([M['leaf1b'], M['leaf2b'], M['birchleaf']])
        parts = []
        for k in range(rng.randint(2, 4)):
            r = rng.uniform(0.28, 0.5)
            b = P_ico(r, rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), r * 0.75,
                      lm, sub=2, scale=(1, 1, 0.8))
            blobify(b, amp=0.15, freq=2.4, seed=i * 17 + k)
            parts.append(b)
        return prefab(parts, 'bush%d' % i)

    def make_tuft():
        rng = random.Random(790)
        parts = []
        for k in range(7):
            a = rng.uniform(0, 2 * math.pi)
            d = rng.uniform(0, 0.28)
            parts.append(P_cyl(0.045, rng.uniform(0.22, 0.4), d * math.cos(a), d * math.sin(a),
                               0.14, M['tuft'] if k % 2 else M['tuft2'], verts=5, r2=0.004,
                               rot=(rng.uniform(-16, 16), rng.uniform(-16, 16), 0), smoothed=False))
        return prefab(parts, 'tuft')

    def make_flowers(i):
        rng = random.Random(820 + i)
        fm = [M['fl_white'], M['fl_yellow'], M['fl_red']][i % 3]
        parts = []
        for k in range(rng.randint(6, 9)):
            a = rng.uniform(0, 2 * math.pi)
            d = rng.uniform(0, 0.55)
            x, y = d * math.cos(a), d * math.sin(a)
            parts.append(P_cyl(0.018, 0.22, x, y, 0.11, M['tuft'], verts=4, smoothed=False))
            parts.append(P_ico(0.05, x, y, 0.24, fm, sub=1))
        return prefab(parts, 'flowers%d' % i)

    def make_reeds():
        rng = random.Random(850)
        parts = []
        for k in range(9):
            a = rng.uniform(0, 2 * math.pi)
            d = rng.uniform(0, 0.4)
            x, y = d * math.cos(a), d * math.sin(a)
            h = rng.uniform(0.7, 1.2)
            parts.append(P_cyl(0.03, h, x, y, h / 2, M['reed'], verts=5,
                               rot=(rng.uniform(-8, 8), rng.uniform(-8, 8), 0), smoothed=False))
            if k % 2 == 0:
                parts.append(P_cyl(0.05, 0.22, x, y, h + 0.1, M['reedtop'], verts=5, smoothed=False))
        return prefab(parts, 'reeds')

    # ---------------- turbine (hero model, exactly 3 blades; phase variants so
    # neighboring turbines never overlap into a fake 6-blade star)
    def make_turbine(i, phase):
        parts = [P_cyl(0.55, 13.5, 0, 0, 6.75, M['turb'], verts=28, r2=0.26)]
        parts.append(P_cyl(0.8, 0.25, 0, 0, 0.12, M['concrete'], verts=20))
        nac = P_cube(1.0, 2.2, 0.95, 0, 0.35, 13.9, M['turb'])
        bevelize(nac, 0.18, 3)
        parts.append(nac)
        parts.append(P_cyl(0.34, 0.9, 0, -1.0, 13.9, M['turb'], verts=16, r2=0.10, rot=(90, 0, 0)))
        for k in range(3):
            bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
            bl = bpy.context.object
            # root at z=0, tip at z=1 — a blade must grow OUTWARD from the hub
            # only, or each cube reads as two opposite blades (6-spoke star)
            for v in bl.data.vertices:
                v.co.z += 0.5
                t = v.co.z
                v.co.x *= (1.0 - 0.85 * t)
                v.co.y *= (1.0 - 0.55 * t)
                v.co.x += 0.18 * math.sin(t * 1.8)
            bl.scale = (0.42, 0.13, 7.6)
            bl.rotation_euler = (math.radians(5), math.radians(k * 120 + phase), 0)
            bl.location = (0, -1.15, 13.9)
            bl.data.materials.append(M['turb'])
            bpy.ops.object.shade_smooth()
            parts.append(bl)
        return prefab(parts, 'turbine%d' % i)

    # ---------------- vehicles
    def make_car(i, colm):
        parts = []
        body = P_cube(1.9, 0.85, 0.42, 0, 0, 0.42, colm)
        bevelize(body, 0.09, 2)
        parts.append(body)
        cab = P_cube(1.0, 0.78, 0.36, -0.1, 0, 0.78, M['winglass'])
        bevelize(cab, 0.09, 2)
        parts.append(cab)
        for sx in (-0.6, 0.6):
            for sy in (-0.42, 0.42):
                parts.append(P_cyl(0.17, 0.14, sx, sy, 0.18, M['tyre'], verts=16, rot=(90, 0, 0)))
        return prefab(parts, 'car%d' % i)

    def make_bus():
        parts = []
        body = P_cube(3.4, 0.98, 1.15, 0, 0, 0.85, M['green'])
        bevelize(body, 0.1, 2)
        parts.append(body)
        parts.append(P_cube(2.9, 1.02, 0.42, 0, 0, 1.05, M['winglass']))
        for sx in (-1.15, 1.15):
            for sy in (-0.5, 0.5):
                parts.append(P_cyl(0.21, 0.16, sx, sy, 0.22, M['tyre'], verts=16, rot=(90, 0, 0)))
        return prefab(parts, 'bus')

    def make_truck():
        parts = []
        cab = P_cube(1.0, 0.95, 1.0, -1.35, 0, 0.75, M['blue'])
        bevelize(cab, 0.1, 2)
        parts.append(cab)
        parts.append(P_cube(0.9, 0.9, 0.35, -1.3, 0, 1.15, M['winglass']))
        parts.append(P_cube(2.4, 1.0, 1.15, 0.5, 0, 0.95, M['white']))
        for sx in (-1.3, 0.0, 1.2):
            for sy in (-0.5, 0.5):
                parts.append(P_cyl(0.22, 0.16, sx, sy, 0.23, M['tyre'], verts=16, rot=(90, 0, 0)))
        return prefab(parts, 'truck')

    def make_lamp():
        parts = [P_cyl(0.05, 3.4, 0, 0, 1.7, M['dark'], verts=8)]
        parts.append(P_cube(0.7, 0.06, 0.06, 0.3, 0, 3.4, M['dark']))
        parts.append(P_cube(0.3, 0.12, 0.08, 0.6, 0, 3.36, M['frame']))
        return prefab(parts, 'lamp')

    # ---------------- energy / industry prefabs
    def make_solarfarm():
        parts = []
        for row in range(5):
            for col in range(4):
                x = -4.5 + col * 3.0
                y = -4.4 + row * 2.2
                parts.append(P_cube(2.5, 1.35, 0.06, x, y, 0.95, M['panel'], rot=(28, 0, 0)))
                parts.append(P_cube(2.55, 1.42, 0.04, x, y - 0.03, 0.90, M['metal'], rot=(28, 0, 0)))
                parts.append(P_cyl(0.05, 0.8, x - 1.0, y - 0.4, 0.4, M['metal'], verts=6, smoothed=False))
                parts.append(P_cyl(0.05, 0.8, x + 1.0, y - 0.4, 0.4, M['metal'], verts=6, smoothed=False))
        parts.append(P_cube(1.2, 1.0, 1.0, 6.4, 0, 0.5, M['white']))
        return prefab(parts, 'solarfarm')

    def make_battery():
        parts = []
        for k in range(3):
            b = P_cube(2.5, 1.15, 1.2, 0, k * 1.7, 0.6, M['white'])
            bevelize(b, 0.05, 2)
            parts.append(b)
            parts.append(P_cube(2.52, 0.1, 0.3, 0, k * 1.7 - 0.56, 0.7, M['green']))
        parts.append(P_cube(1.0, 0.9, 1.3, 2.3, 1.7, 0.65, M['metal']))
        return prefab(parts, 'battery')

    def make_electro():
        parts = []
        for k in range(2):
            parts.append(P_cyl(0.8, 3.2, 0, k * 2.0, 1.0, M['metal'], verts=20, rot=(0, 90, 0)))
        parts.append(P_cube(1.6, 1.4, 1.6, 2.8, 1.0, 0.8, M['white']))
        parts.append(P_cyl(0.09, 2.6, 1.2, 1.0, 1.6, M['metal'], verts=8, rot=(0, 90, 0)))
        parts.append(P_cyl(0.09, 1.4, 2.0, 1.0, 1.2, M['metal'], verts=8))
        return prefab(parts, 'electro')

    def make_steel():
        parts = [P_cube(11, 7.5, 4.2, 0, 0, 2.1, M['slate'])]
        for k in range(3):
            parts.append(P_gable(11.2, 2.5, 1.4, 0, -2.5 + k * 2.5, 4.2, M['metal']))
        for k, sx in enumerate((-3.5, -1.8)):
            parts.append(P_cyl(0.5, 8.5, sx, -4.6, 4.25, M['brickdark'], verts=18, r2=0.36))
            parts.append(P_cyl(0.55, 0.5, sx, -4.6, 8.4, M['red'], verts=18))
        p1 = P_cyl(2.2, 2.4, 7.5, -2.0, 1.2, M['dark'], verts=20, r2=0.2)
        blobify(p1, 0.3, 1.2, 3, radial_xy=True)
        parts.append(p1)
        p2 = P_cyl(1.7, 1.9, 7.5, 2.2, 0.95, M['rust'], verts=20, r2=0.2)
        blobify(p2, 0.25, 1.4, 8, radial_xy=True)
        parts.append(p2)
        parts.append(P_cube(5.0, 0.9, 0.5, 4.5, 0.2, 2.8, M['metal'], rot=(0, -14, 12)))
        return prefab(parts, 'steel')

    def make_farm():
        parts = [P_cube(4.2, 2.6, 1.9, 0, 0, 0.95, M['red'])]
        parts.append(P_gable(4.5, 2.9, 1.3, 0, 0, 1.9, M['slate']))
        parts.append(P_cyl(0.95, 3.6, 3.2, -0.4, 1.8, M['metal'], verts=20))
        parts.append(P_cyl(0.98, 0.9, 3.2, -0.4, 3.9, M['metal'], verts=20, r2=0.1))
        for k in range(6):
            wm = M['wheat'] if k % 2 == 0 else M['wheat2']
            parts.append(P_cube(7.5, 1.15, 0.22, 1.0, 2.6 + k * 1.3, 0.11, wm))
        return prefab(parts, 'farm')

    def make_busstop():
        parts = [P_cyl(0.05, 2.4, -1.0, 0, 1.2, M['metal'], verts=8),
                 P_cyl(0.05, 2.4, 1.0, 0, 1.2, M['metal'], verts=8),
                 P_cube(2.6, 1.1, 0.08, 0, -0.15, 2.42, M['green']),
                 P_cube(2.4, 0.06, 1.0, 0, 0.4, 1.35, M['winglass'])]
        return prefab(parts, 'busstop')

    # build the prefab library
    for i in range(4):
        make_house(i)
    for i in range(3):
        make_apt(i)
    for i in range(2):
        make_tower(i)
        make_glasstower(i)
    for i in range(3):
        make_oak(i)
        make_rock(i)
        make_bush(i)
        make_flowers(i)
    for i in range(2):
        make_conifer(i)
        make_poplar(i)
        make_birch(i)
    make_tuft()
    make_reeds()
    for i, phase in enumerate((0, 42, 77)):
        make_turbine(i, phase)
    make_car(0, M['red'])
    make_car(1, M['blue'])
    make_car(2, M['white'])
    make_bus()
    make_truck()
    make_lamp()
    make_solarfarm()
    make_battery()
    make_electro()
    make_steel()
    make_farm()
    make_busstop()

    # ---------------- terrain
    WORLD = 95
    CITY_R = 22
    LAKE_C = Vector((46, 42, 0))
    LAKE_R = 27
    WATER_Z = -1.8
    PAL = dict(grass=(0.13, 0.28, 0.08), grass2=(0.20, 0.33, 0.10), dirt=(0.38, 0.28, 0.16),
               sand=(0.55, 0.47, 0.30), road=(0.045, 0.045, 0.05), water=(0.02, 0.09, 0.13))

    def smoothstep(a, b, x):
        t = max(0.0, min(1.0, (x - a) / (b - a)))
        return t * t * (3 - 2 * t)

    RIVER = [Vector((-20, 95, 0)), Vector((-10, 74, 0)), Vector((2, 60, 0)),
             Vector((14, 51, 0)), Vector((30, 45, 0))]

    def river_dist(x, y):
        p = Vector((x, y, 0))
        best = 1e9
        for k in range(len(RIVER) - 1):
            a, b = RIVER[k], RIVER[k + 1]
            ab = b - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
            best = min(best, (p - (a + ab * t)).length)
        return best

    def hfield(x, y):
        n = noise.noise(Vector((x * 0.016, y * 0.016, 0.0))) * 5.0 \
            + noise.noise(Vector((x * 0.05, y * 0.05, 7.3))) * 1.5
        n = max(n, -0.8) * 0.9
        n *= smoothstep(CITY_R + 2.0, CITY_R + 15.0, max(abs(x), abs(y)))
        d = (Vector((x, y, 0)) - LAKE_C).length
        n -= smoothstep(LAKE_R, LAKE_R * 0.3, d) * 4.5
        n -= smoothstep(5.5, 0.0, river_dist(x, y)) * 3.6
        return n

    N = 240
    terr = bpy.data.meshes.new('terrain')
    bm = bmesh.new()
    grid = {}
    for i in range(N + 1):
        for j in range(N + 1):
            x = -WORLD + 2 * WORLD * i / N
            y = -WORLD + 2 * WORLD * j / N
            grid[(i, j)] = bm.verts.new((x, y, hfield(x, y)))
    for i in range(N):
        for j in range(N):
            bm.faces.new((grid[(i, j)], grid[(i + 1, j)], grid[(i + 1, j + 1)], grid[(i, j + 1)]))
    bm.to_mesh(terr)
    bm.free()
    tobj = bpy.data.objects.new('terrain', terr)
    bpy.context.collection.objects.link(tobj)
    bpy.context.view_layer.objects.active = tobj
    tobj.select_set(True)
    bpy.ops.object.shade_smooth()
    tobj.select_set(False)

    # procedural ground shader: grass patchwork + dirt breaks + rock on slope +
    # sand at the waterline + micro bump. Replaces the flat vertex-color look.
    tmat = bpy.data.materials.new('terr')
    tmat.use_nodes = True
    nt = tmat.node_tree
    tb = nt.nodes['Principled BSDF']
    tb.inputs['Roughness'].default_value = 0.92
    geo = nt.nodes.new('ShaderNodeNewGeometry')

    def noise_node(scale, detail=4.0):
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        nt.links.new(geo.outputs['Position'], n.inputs['Vector'])
        return n

    def ramp_node(fmin, fmax):
        r = nt.nodes.new('ShaderNodeMapRange')
        r.inputs['From Min'].default_value = fmin
        r.inputs['From Max'].default_value = fmax
        r.clamp = True
        return r

    def mix_node(col=None):
        mx = nt.nodes.new('ShaderNodeMixRGB')
        if col:
            mx.inputs[2].default_value = (*col, 1.0)
        return mx

    n_macro = noise_node(0.045)
    r_macro = ramp_node(0.44, 0.56)
    nt.links.new(n_macro.outputs['Fac'], r_macro.inputs['Value'])
    m1 = mix_node()
    m1.inputs[1].default_value = (0.085, 0.22, 0.05, 1.0)   # grass dark
    m1.inputs[2].default_value = (0.15, 0.30, 0.085, 1.0)   # grass light
    nt.links.new(r_macro.outputs['Result'], m1.inputs['Fac'])

    n_dirt = noise_node(0.065)
    r_dirt = ramp_node(0.565, 0.645)
    nt.links.new(n_dirt.outputs['Fac'], r_dirt.inputs['Value'])
    m2 = mix_node((0.35, 0.25, 0.13))
    nt.links.new(r_dirt.outputs['Result'], m2.inputs['Fac'])
    nt.links.new(m1.outputs['Color'], m2.inputs[1])

    sep_n = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Normal'], sep_n.inputs['Vector'])
    r_slope = ramp_node(0.88, 0.72)   # steeper -> rockier
    nt.links.new(sep_n.outputs['Z'], r_slope.inputs['Value'])
    m3 = mix_node((0.33, 0.32, 0.30))
    nt.links.new(r_slope.outputs['Result'], m3.inputs['Fac'])
    nt.links.new(m2.outputs['Color'], m3.inputs[1])

    sep_p = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Position'], sep_p.inputs['Vector'])
    r_sand = ramp_node(-0.55, -1.35)  # below the bank line -> sand
    nt.links.new(sep_p.outputs['Z'], r_sand.inputs['Value'])
    m4 = mix_node((0.52, 0.44, 0.27))
    nt.links.new(r_sand.outputs['Result'], m4.inputs['Fac'])
    nt.links.new(m3.outputs['Color'], m4.inputs[1])
    nt.links.new(m4.outputs['Color'], tb.inputs['Base Color'])

    n_micro = noise_node(1.1, 8.0)
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.28
    nt.links.new(n_micro.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], tb.inputs['Normal'])
    terr.materials.append(tmat)

    bpy.ops.mesh.primitive_plane_add(size=2 * WORLD, location=(0, 0, WATER_Z))
    water = bpy.context.object
    wmat = mat('waterm', PAL['water'], 0.06)
    water.data.materials.append(wmat)

    # ---------------- city grid + streets with sidewalks
    ROAD_H = 0.08
    roadmat = mat('roadm', (0.055, 0.055, 0.06), 0.9)
    markmat = mat('markm', (0.85, 0.85, 0.8), 0.6)
    ROAD_N = [0]

    def road(x, y, sx, sy, m=None):
        ROAD_N[0] += 1
        zj = ROAD_N[0] * 0.006
        o = P_cube(sx, sy, ROAD_H, x, y, ROAD_H / 2 + zj, m or roadmat)
        o.name = 'road_%d' % ROAD_N[0]
        return o

    def curbs(x, y, sx, sy):
        # raised curb strips along both long edges of a street
        ROAD_N[0] += 1
        zj = ROAD_N[0] * 0.006
        if sy > sx:  # north-south street
            for side in (-1, 1):
                o = P_cube(0.18, sy, 0.15, x + side * (sx / 2 + 0.09), y, 0.075 + zj, M['curb'])
                o.name = 'curb_%d_%d' % (ROAD_N[0], side + 1)
        else:
            for side in (-1, 1):
                o = P_cube(sx, 0.18, 0.15, x, y + side * (sy / 2 + 0.09), 0.075 + zj, M['curb'])
                o.name = 'curb_%d_%d' % (ROAD_N[0], side + 1)

    def crosswalk(px, py, along_x):
        # zebra band across the street at an intersection approach
        w = PITCH * 0.82
        for k in range(6):
            off = -w / 2 + 0.55 + k * (w - 1.1) / 5
            if along_x:  # stripes crossing the E-W street, offset north of center
                o = P_cube(0.30, 1.15, 0.02, px + off, py + w / 2 + 0.75, ROAD_H + 0.115, markmat)
            else:
                o = P_cube(1.15, 0.30, 0.02, px + w / 2 + 0.75, py + off, ROAD_H + 0.115, markmat)
            o.name = 'xwalk_%d_%d_%d' % (int(px * 10), int(py * 10), k)

    def dashes(x0, y0, x1, y1):
        L = math.hypot(x1 - x0, y1 - y0)
        n = int(L / 4.0)
        for k in range(n):
            t = (k + 0.5) / n
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            horiz = abs(x1 - x0) > abs(y1 - y0)
            o = P_cube(1.3 if horiz else 0.16, 0.16 if horiz else 1.3, 0.02, x, y, ROAD_H + 0.10, markmat)
            o.name = 'dash_%d_%d' % (int(x * 10), int(y * 10))

    GRID = 9
    PITCH = 3.65
    half = GRID * PITCH / 2
    occupied = []
    pavemat = MATS['pave']

    for gi in range(GRID):
        for gj in range(GRID):
            if gi % 3 == 2 or gj % 3 == 2:
                continue
            x = -half + (gi + 0.5) * PITCH
            y = -half + (gj + 0.5) * PITCH
            r = max(abs(x), abs(y)) / half
            if random.random() < 0.03:
                continue
            o = P_cube(PITCH * 1.02, PITCH * 1.02, 0.14, x, y, 0.07, pavemat)
            o.name = 'pad_%d_%d' % (gi, gj)
            if r < 0.35:
                pool = ['tower0', 'tower1', 'glass0', 'glass1', 'apt0', 'apt1']
            elif r < 0.7:
                pool = ['apt0', 'apt1', 'apt2', 'tower0', 'house0', 'glass0']
            else:
                pool = ['house0', 'house1', 'house2', 'house3', 'apt2']
            inst(random.choice(pool), x, y, 0.14, rz=random.choice([0, 90, 180, 270]))

    street_pos = [-half + (k + 0.5) * PITCH for k in range(GRID) if k % 3 == 2]
    ext = half + PITCH
    for p in street_pos:
        road(p, 0, PITCH * 0.82, 2 * ext)
        road(0, p, 2 * ext, PITCH * 0.82)
        curbs(p, 0, PITCH * 0.82, 2 * ext)
        curbs(0, p, 2 * ext, PITCH * 0.82)
        dashes(p, -ext, p, ext)
        dashes(-ext, p, ext, p)
    road(0, -ext, 2 * ext + PITCH, PITCH * 0.82)
    road(0, ext, 2 * ext + PITCH, PITCH * 0.82)
    road(-ext, 0, PITCH * 0.82, 2 * ext + PITCH)
    road(ext, 0, PITCH * 0.82, 2 * ext + PITCH)
    for px in street_pos:
        for py in street_pos:
            crosswalk(px, py, True)
            crosswalk(px, py, False)
    # rural approaches: same asphalt + center line as city streets
    road(-(WORLD + ext) / 2 - 1, street_pos[0], WORLD - ext + 2, PITCH * 0.7)
    road(street_pos[1], -(WORLD + ext) / 2 - 1, PITCH * 0.7, WORLD - ext + 2)
    dashes(-WORLD, street_pos[0], -ext, street_pos[0])
    dashes(street_pos[1], -WORLD, street_pos[1], -ext)

    # lamps along the two main streets
    for k in range(-4, 5):
        y = k * 8.0
        if abs(y) < ext:
            inst('lamp', street_pos[0] - 1.9, y, 0.14, rz=0)
            inst('lamp', street_pos[1] + 1.9, y + 4, 0.14, rz=180)

    inst('truck', street_pos[0], -9.0, 0.16, rz=90)
    inst('bus', street_pos[1], 7.0, 0.16, rz=270)
    inst('car0', -6.0, street_pos[1], 0.16, rz=0)
    inst('car1', 10.0, street_pos[0], 0.16, rz=180)
    inst('car2', street_pos[0], 3.0, 0.16, rz=90)
    inst('truck', -40.0, street_pos[0], 0.16, rz=0)
    inst('car0', -28.0, street_pos[0] + 1.0, 0.16, rz=180)
    inst('busstop', street_pos[1] + 2.6, 7.0, 0.14, rz=90)

    # energy + industry — turbines spread far enough apart that their rotors
    # never overlap into a fake many-bladed silhouette
    for k, (x, y) in enumerate([(-81, 30), (-61, 45), (-47, 20), (-25, 46)]):
        inst('turbine%d' % (k % 3), x, y, hfield(x, y) - 0.1, rz=random.uniform(-30, 30))
        occupied.append((x, y, 9.0))
    for sx, sy in [(-46, -44), (-33.5, -44)]:
        inst('solarfarm', sx, sy, hfield(sx, sy) + 0.05, rz=0)
        occupied.append((sx, sy, 8.0))
    inst('battery', -24.0, -48.0, hfield(-24.0, -48.0))
    inst('electro', -25.0, -39.0, hfield(-25.0, -39.0))
    occupied += [(-24.0, -48.0, 4.0), (-25.0, -39.0, 4.0)]
    x, y = 41, 11
    inst('steel', x, y, hfield(x, y) + 0.05, rz=200)
    occupied.append((x, y, 11.0))
    x, y = 26, -43
    inst('farm', x, y, hfield(x, y) + 0.05, rz=15)
    occupied.append((x, y, 10.0))

    # ---------------- farmland patchwork (fenced fields with crop rows)
    def field(cx, cy, w, d, ang, crop):
        ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        rows = int(d / 1.15)
        for k in range(rows):
            off = -d / 2 + (k + 0.5) * d / rows
            rx, ry = cx - sa * off, cy + ca * off
            z = hfield(rx, ry)
            if crop == 'wheat':
                m = M['wheat'] if k % 2 == 0 else M['wheat2']
            elif crop == 'plow':
                m = M['soil'] if k % 2 == 0 else M['soil2']
            else:
                m = M['cabbage'] if k % 2 == 0 else M['soil']
            P_cube(w - 0.7, 0.82, 0.22, rx, ry, z + 0.11, m, rot=(0, 0, ang))
        # perimeter fence: posts + one rail per side
        for sx, sy, L, horiz in [(0, d / 2, w, True), (0, -d / 2, w, True),
                                 (w / 2, 0, d, False), (-w / 2, 0, d, False)]:
            fx, fy = cx + ca * sx - sa * sy, cy + sa * sx + ca * sy
            z = hfield(fx, fy)
            P_cube(L if horiz else 0.07, 0.07 if horiz else L, 0.06, fx, fy, z + 0.62,
                   M['fence'], rot=(0, 0, ang))
            n = int(L / 2.4)
            for k in range(n + 1):
                t = -L / 2 + k * L / n
                px_, py_ = (sx + t, sy) if horiz else (sx, sy + t)
                gx, gy = cx + ca * px_ - sa * py_, cy + sa * px_ + ca * py_
                P_cube(0.09, 0.09, 0.75, gx, gy, hfield(gx, gy) + 0.37, M['fence'],
                       rot=(0, 0, ang))
        occupied.append((cx, cy, max(w, d) / 2 + 1.5))

    field(16, -62, 14, 10, 8, 'wheat')
    field(34, -65, 12, 9, -5, 'plow')
    field(50, -57, 11, 9, 12, 'cabbage')
    field(45, -38, 10, 8, -8, 'wheat')
    field(-58, 62, 13, 10, 20, 'plow')
    field(-41, 70, 11, 8, 15, 'wheat')

    # ---------------- trees (clumped: forests of conifers, broadleaf meadows)
    tree_pool = ['oak0', 'oak1', 'oak2', 'poplar0', 'poplar1', 'birch0', 'birch1']
    placed, attempts = 0, 0
    while placed < 440 and attempts < 14000:
        attempts += 1
        x = random.uniform(-WORLD + 3, WORLD - 3)
        y = random.uniform(-WORLD + 3, WORLD - 3)
        if max(abs(x), abs(y)) < ext + 2.5:
            continue
        h = hfield(x, y)
        if h < WATER_Z + 0.8:
            continue
        if abs(y - street_pos[0]) < 3.0 and x < -ext:
            continue
        if abs(x - street_pos[1]) < 3.0 and y < -ext:
            continue
        if any((x - ox) ** 2 + (y - oy) ** 2 < orad ** 2 for ox, oy, orad in occupied):
            continue
        n = noise.noise(Vector((x * 0.03, y * 0.03, 3.0)))
        if n > 0.05:
            nm = 'conifer%d' % random.randint(0, 1)
        elif n > -0.05 and random.random() < 0.4:
            nm = 'birch%d' % random.randint(0, 1)
        else:
            nm = random.choice(tree_pool)
        inst(nm, x, y, h - 0.06, rz=random.uniform(0, 360), s=random.uniform(0.85, 1.6))
        placed += 1
    print('trees placed:', placed)

    # ---------------- ground cover: tufts, flowers, bushes, rocks, reeds
    def scatter(count, names, smin, smax, cond=None, zoff=-0.03):
        done, att = 0, 0
        while done < count and att < count * 25:
            att += 1
            x = random.uniform(-WORLD + 2, WORLD - 2)
            y = random.uniform(-WORLD + 2, WORLD - 2)
            if max(abs(x), abs(y)) < ext + 1.5:
                continue
            h = hfield(x, y)
            if cond is None:
                if h < WATER_Z + 0.7:
                    continue
            elif not cond(x, y, h):
                continue
            if abs(y - street_pos[0]) < 2.6 and x < -ext:
                continue
            if abs(x - street_pos[1]) < 2.6 and y < -ext:
                continue
            if any((x - ox) ** 2 + (y - oy) ** 2 < orad ** 2 for ox, oy, orad in occupied):
                continue
            inst(random.choice(names), x, y, h + zoff, rz=random.uniform(0, 360),
                 s=random.uniform(smin, smax))
            done += 1
        return done

    def slope_of(x, y):
        e = 0.8
        return math.hypot(hfield(x + e, y) - hfield(x - e, y),
                          hfield(x, y + e) - hfield(x, y - e)) / (2 * e)

    scatter(850, ['tuft'], 0.9, 1.9)
    scatter(140, ['flowers0', 'flowers1', 'flowers2'], 0.8, 1.5)
    scatter(170, ['bush0', 'bush1', 'bush2'], 0.7, 1.5)
    scatter(90, ['rock0', 'rock1', 'rock2'], 0.5, 1.6,
            cond=lambda x, y, h: h > WATER_Z + 0.5 and (slope_of(x, y) > 0.30 or random.random() < 0.12))
    scatter(150, ['reeds'], 0.9, 1.6, zoff=0.0,
            cond=lambda x, y, h: WATER_Z - 0.5 < h < WATER_Z + 0.75)

    # street trees inside town
    for k in range(-3, 4):
        y = k * 9.0 + 2.0
        if abs(y) < ext - 2:
            inst('oak%d' % (abs(k) % 3), street_pos[0] + 2.0, y, 0.1, rz=k * 40, s=0.8)
            inst('oak%d' % ((k + 1) % 3), street_pos[1] - 2.0, y + 3, 0.1, rz=k * 70, s=0.75)

    return dict(hf=hfield)


# ================================================================ HEX WORLD
def build_hex():
    M = dict(
        grass=mat('hx_grass', (0.28, 0.52, 0.15), 0.9),
        grass2=mat('hx_grass2', (0.23, 0.46, 0.12), 0.9),
        forest=mat('hx_forest', (0.16, 0.36, 0.11), 0.9),
        cliff=mat('hx_cliff', (0.66, 0.53, 0.36), 0.95),
        cliff2=mat('hx_cliff2', (0.56, 0.44, 0.30), 0.95),
        water=mat('hx_water', (0.05, 0.30, 0.40), 0.22),
        waterside=mat('hx_waterside', (0.52, 0.46, 0.35), 0.9),
        wheat=mat('hx_wheat', (0.85, 0.62, 0.18), 0.9),
        wheat2=mat('hx_wheat2', (0.70, 0.49, 0.13), 0.9),
        soil=mat('hx_soil', (0.52, 0.38, 0.22), 0.95),
        path=mat('hx_path', (0.78, 0.68, 0.50), 0.9),
        wall_cream=mat('hx_wcream', (0.90, 0.83, 0.66), 0.85),
        wall_terra=mat('hx_wterra', (0.78, 0.46, 0.30), 0.85),
        wall_sage=mat('hx_wsage', (0.58, 0.64, 0.48), 0.85),
        wall_blue=mat('hx_wblue', (0.48, 0.58, 0.66), 0.85),
        roof_red=mat('hx_rred', (0.62, 0.26, 0.18), 0.8),
        roof_dark=mat('hx_rdark', (0.30, 0.24, 0.20), 0.8),
        trunk=mat('hx_trunk', (0.36, 0.24, 0.14), 0.95),
        tree1=mat('hx_tree1', (0.22, 0.42, 0.18), 0.85),
        tree2=mat('hx_tree2', (0.28, 0.50, 0.20), 0.85),
        tree3=mat('hx_tree3', (0.16, 0.35, 0.15), 0.85),
        turb=mat('hx_turb', (0.92, 0.94, 0.95), 0.35),
        panel=mat('hx_panel', (0.08, 0.16, 0.32), 0.15),
        frame=mat('hx_frame', (0.85, 0.86, 0.85), 0.5),
        brick=mat('hx_brick', (0.55, 0.28, 0.20), 0.9),
        smoke=mat('hx_smoke', (0.94, 0.94, 0.95), 0.9),
        white=mat('hx_white', (0.90, 0.91, 0.92), 0.5),
        green=mat('hx_green', (0.20, 0.52, 0.30), 0.5),
        stone=mat('hx_stone', (0.62, 0.60, 0.56), 0.9),
        snow=mat('hx_snow', (0.95, 0.96, 0.98), 0.7),
        cloud=mat('hx_cloud', (0.98, 0.98, 1.0), 0.9),
        rail=mat('hx_rail', (0.35, 0.32, 0.30), 0.7),
    )

    R = 5.0          # hex circumradius
    APO = R * math.sqrt(3) / 2

    def hex_center(q, r):
        # neighbors at angles 30 + 60k, distance 2*APO
        b1 = Vector((2 * APO * math.cos(math.radians(30)), 2 * APO * math.sin(math.radians(30)), 0))
        b2 = Vector((0, 2 * APO, 0))
        return b1 * q + b2 * r

    # ---------------- little prefabs (scaled to R=5 tiles)
    def make_hex_house(i, wall, roofm):
        rng = random.Random(700 + i)
        w, d = rng.uniform(1.6, 2.0), rng.uniform(1.1, 1.4)
        h = rng.uniform(0.9, 1.1)
        parts = [P_cube(w, d, h, 0, 0, h / 2, wall)]
        parts.append(P_gable(w + 0.25, d + 0.25, rng.uniform(0.7, 0.95), 0, 0, h, roofm))
        parts.append(P_cube(0.18, 0.18, 0.5, w / 4, 0, h + 0.55, M['stone']))
        return prefab(parts, 'hxhouse%d' % i)

    def make_hex_church():
        parts = [P_cube(2.2, 1.4, 1.3, 0, 0, 0.65, M['wall_cream'])]
        parts.append(P_gable(2.45, 1.6, 0.9, 0, 0, 1.3, M['roof_dark']))
        parts.append(P_cube(0.9, 0.9, 2.4, -1.5, 0, 1.2, M['wall_cream']))
        parts.append(P_cyl(0.62, 1.4, -1.5, 0, 3.05, M['roof_dark'], verts=4, r2=0.02, smoothed=False))
        return prefab(parts, 'hxchurch')

    def make_hex_tree(i):
        rng = random.Random(800 + i)
        tm = rng.choice([M['tree1'], M['tree2'], M['tree3']])
        parts = [P_cyl(0.14, 0.5, 0, 0, 0.25, M['trunk'], verts=7, smoothed=False)]
        if i % 2 == 0:
            c = P_cyl(0.75, 1.9, 0, 0, 1.35, tm, verts=14, r2=0.05)
            blobify(c, 0.1, 2.0, i, radial_xy=True)
            parts.append(c)
        else:
            b = P_ico(0.72, 0, 0, 1.15, tm, sub=2, scale=(1, 1, 1.25))
            blobify(b, 0.12, 1.8, i * 3)
            parts.append(b)
        return prefab(parts, 'hxtree%d' % i)

    def make_hex_turbine():
        parts = [P_cyl(0.28, 6.2, 0, 0, 3.1, M['turb'], verts=18, r2=0.14)]
        nac = P_cube(0.55, 1.0, 0.5, 0, 0.1, 6.4, M['turb'])
        bevelize(nac, 0.1, 2)
        parts.append(nac)
        for k in range(3):
            bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
            bl = bpy.context.object
            for v in bl.data.vertices:
                v.co.z += 0.5   # outward-only blade (see hifi turbine comment)
                v.co.x *= (1.0 - 0.75 * v.co.z)
            bl.scale = (0.34, 0.09, 2.9)
            bl.rotation_euler = (0, math.radians(k * 120 + 15), 0)
            bl.location = (0, -0.5, 6.4)
            bl.data.materials.append(M['turb'])
            parts.append(bl)
        return prefab(parts, 'hxturbine')

    def make_hex_factory():
        parts = [P_cube(2.8, 2.0, 1.5, 0, 0, 0.75, M['brick'])]
        for k in range(2):
            parts.append(P_gable(2.9, 1.0, 0.6, 0, -0.5 + k * 1.0, 1.5, M['roof_dark']))
        parts.append(P_cyl(0.28, 2.6, 1.0, -0.6, 2.4, M['brick'], verts=12, r2=0.2))
        for k, (r, dz) in enumerate([(0.3, 0.4), (0.42, 1.0), (0.55, 1.75)]):
            s = P_ico(r, 1.0 + k * 0.22, -0.6, 3.7 + dz, M['smoke'], sub=2)
            blobify(s, 0.08, 2.5, k * 9)
            parts.append(s)
        return prefab(parts, 'hxfactory')

    def make_hex_solar():
        parts = []
        for row in range(3):
            for col in range(3):
                x, y = -2.0 + col * 2.0, -1.6 + row * 1.6
                parts.append(P_cube(1.7, 1.0, 0.06, x, y, 0.55, M['panel'], rot=(26, 0, 0)))
                parts.append(P_cube(1.74, 1.06, 0.05, x, y - 0.02, 0.50, M['frame'], rot=(26, 0, 0)))
                parts.append(P_cyl(0.05, 0.5, x - 0.6, y - 0.3, 0.25, M['frame'], verts=6, smoothed=False))
                parts.append(P_cyl(0.05, 0.5, x + 0.6, y - 0.3, 0.25, M['frame'], verts=6, smoothed=False))
        return prefab(parts, 'hxsolar')

    def make_hex_battery():
        parts = []
        for k in range(2):
            b = P_cube(1.6, 0.8, 0.85, 0, k * 1.2, 0.43, M['white'])
            bevelize(b, 0.05, 2)
            parts.append(b)
            parts.append(P_cube(1.62, 0.08, 0.22, 0, k * 1.2 - 0.4, 0.5, M['green']))
        return prefab(parts, 'hxbattery')

    def make_hex_bus():
        parts = []
        b = P_cube(1.5, 0.55, 0.6, 0, 0, 0.42, M['green'])
        bevelize(b, 0.07, 2)
        parts.append(b)
        parts.append(P_cube(1.2, 0.6, 0.2, 0, 0, 0.52, M['white']))
        for sx in (-0.5, 0.5):
            for sy in (-0.3, 0.3):
                parts.append(P_cyl(0.11, 0.1, sx, sy, 0.12, M['roof_dark'], verts=10, rot=(90, 0, 0)))
        return prefab(parts, 'hxbus')

    def make_hex_peak(i):
        rng = random.Random(900 + i)
        parts = []
        c = P_cyl(rng.uniform(1.6, 2.2), rng.uniform(2.6, 3.6), 0, 0, 1.6, M['stone'],
                  verts=9, r2=0.15, smoothed=False)
        blobify(c, 0.35, 0.9, i * 4, radial_xy=True)
        parts.append(c)
        s = P_cyl(0.7, 1.0, 0, 0, 3.0, M['snow'], verts=9, r2=0.05, smoothed=False)
        parts.append(s)
        return prefab(parts, 'hxpeak%d' % i)

    def make_cloud(i):
        rng = random.Random(950 + i)
        parts = []
        for k in range(rng.randint(3, 5)):
            r = rng.uniform(0.8, 1.7)
            b = P_ico(r, rng.uniform(-2, 2), rng.uniform(-0.8, 0.8), rng.uniform(-0.2, 0.5),
                      M['cloud'], sub=2, scale=(1, 1, 0.55))
            blobify(b, 0.1, 1.5, i * 7 + k)
            parts.append(b)
        return prefab(parts, 'cloud%d' % i)

    wallpool = [M['wall_cream'], M['wall_terra'], M['wall_sage'], M['wall_blue']]
    for i in range(6):
        make_hex_house(i, wallpool[i % 4], M['roof_red'] if i % 3 else M['roof_dark'])
    make_hex_church()
    for i in range(4):
        make_hex_tree(i)
    make_hex_turbine()
    make_hex_factory()
    make_hex_solar()
    make_hex_battery()
    make_hex_bus()
    for i in range(2):
        make_hex_peak(i)
    for i in range(3):
        make_cloud(i)

    # ---------------- tile layout
    RINGS = 5
    tiles = {}
    for q in range(-RINGS, RINGS + 1):
        for r in range(-RINGS, RINGS + 1):
            if abs(q + r) > RINGS:
                continue
            hd = (abs(q) + abs(r) + abs(q + r)) / 2
            if hd > RINGS:
                continue
            if hd == RINGS and random.random() < 0.28:
                continue  # ragged rim
            tiles[(q, r)] = {}

    path_hexes = [(-4, 1), (-3, 1), (-2, 1), (-1, 1), (0, 0), (1, 0), (2, 0), (3, -1)]
    village_hexes = [(0, 0), (1, 0), (0, 1), (-1, 1), (1, -1)]
    wind_hexes = [(-3, 4), (-2, 4), (-4, 3)]
    solar_hexes = [(2, -4), (3, -4)]
    battery_hex = (1, -3)
    factory_hex = (3, -1)
    peak_hexes = [(4, 1), (5, 0)]

    for (q, r), t in tiles.items():
        c = hex_center(q, r)
        n = noise.noise(Vector((c.x * 0.03 + 11, c.y * 0.03 + 5, 0)))
        n2 = noise.noise(Vector((c.x * 0.045 + 80, c.y * 0.045 + 31, 0)))
        if n < -0.34:
            theme, level = 'water', 0
        elif n2 > 0.30:
            theme, level = 'forest', (2 if n > 0.15 else 1)
        elif n2 < -0.28:
            theme, level = 'field', 1
        else:
            theme, level = 'meadow', (2 if n > 0.22 else 1)
        if (q, r) in village_hexes:
            theme, level = 'village', 1
        if (q, r) in path_hexes:
            level = 1
            if theme in ('water', 'forest'):
                theme = 'meadow'
        if (q, r) in wind_hexes:
            theme, level = 'wind', 2
        if (q, r) in solar_hexes:
            theme, level = 'solar', 1
        if (q, r) == battery_hex:
            theme, level = 'battery', 1
        if (q, r) == factory_hex:
            theme, level = 'factory', 1
        if (q, r) in peak_hexes:
            theme, level = 'peak', 3
        t['theme'] = theme
        t['level'] = level
        t['c'] = c

    LEVEL_H = {0: 1.0, 1: 2.0, 2: 3.0, 3: 3.8}

    def top_mat(theme, q, r):
        if theme == 'water':
            return M['water']
        if theme == 'forest':
            return M['forest']
        if theme == 'field':
            return M['soil']
        return M['grass'] if (q + 2 * r) % 3 else M['grass2']

    for (q, r), t in tiles.items():
        c, theme, level = t['c'], t['theme'], t['level']
        h = LEVEL_H[level]
        sidem = M['waterside'] if theme == 'water' else (M['cliff'] if level < 3 else M['cliff2'])
        # cylinder verts sit at 30+60k deg -> edge normals at 0+60k; our
        # neighbor lattice is at 30+60k, so rotate 30 deg to meet edge-to-edge
        bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=R * 1.003, depth=h,
                                            location=(c.x, c.y, h / 2),
                                            rotation=(0, 0, math.radians(30)))
        o = bpy.context.object
        o.name = 'hex_%d_%d' % (q + 10, r + 10)
        o.data.materials.append(sidem)
        o.data.materials.append(top_mat(theme, q, r))
        for poly in o.data.polygons:
            if poly.normal.z > 0.5:
                poly.material_index = 1
        t['z'] = h

    rng = random.Random(31)

    def scatter_on(c, z, n, rmax, fn):
        pts = []
        att = 0
        while len(pts) < n and att < n * 30:
            att += 1
            a = rng.uniform(0, 2 * math.pi)
            d = rmax * math.sqrt(rng.uniform(0.02, 1.0))
            x, y = c.x + d * math.cos(a), c.y + d * math.sin(a)
            if any((x - px) ** 2 + (y - py) ** 2 < 1.1 for px, py in pts):
                continue
            pts.append((x, y))
            fn(x, y, z)

    for (q, r), t in tiles.items():
        c, theme, z = t['c'], t['theme'], t['z']
        if theme == 'forest':
            scatter_on(c, z, rng.randint(10, 15), R * 0.72,
                       lambda x, y, zz: inst('hxtree%d' % rng.randint(0, 3), x, y, zz,
                                             rz=rng.uniform(0, 360), s=rng.uniform(0.75, 1.35)))
        elif theme == 'meadow':
            scatter_on(c, z, rng.randint(1, 3), R * 0.6,
                       lambda x, y, zz: inst('hxtree%d' % rng.randint(0, 3), x, y, zz,
                                             rz=rng.uniform(0, 360), s=rng.uniform(0.7, 1.1)))
        elif theme == 'field':
            ang = rng.choice([15, 40, 70, 105])
            ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
            for k in range(-3, 4):
                wm = M['wheat'] if k % 2 == 0 else M['wheat2']
                off = k * 1.05
                L = 2 * math.sqrt(max(0.5, (R * 0.82) ** 2 - off ** 2))
                P_cube(L, 0.85, 0.18, c.x - sa * off, c.y + ca * off, z + 0.09, wm,
                       rot=(0, 0, ang))
        elif theme == 'village':
            if (q, r) == (0, 0):
                inst('hxchurch', c.x - 0.4, c.y, z, rz=rng.uniform(0, 360))
                for k in range(2):
                    a = rng.uniform(0, 2 * math.pi)
                    inst('hxhouse%d' % rng.randint(0, 5), c.x + 3.0 * math.cos(a),
                         c.y + 3.0 * math.sin(a), z, rz=rng.uniform(0, 360))
            else:
                for k in range(rng.randint(3, 4)):
                    a = rng.uniform(0, 2 * math.pi)
                    d = rng.uniform(0.5, R * 0.62)
                    inst('hxhouse%d' % rng.randint(0, 5), c.x + d * math.cos(a),
                         c.y + d * math.sin(a), z, rz=rng.choice([0, 30, 60, 90, 120]))
                for k in range(rng.randint(1, 2)):
                    a = rng.uniform(0, 2 * math.pi)
                    d = rng.uniform(R * 0.55, R * 0.8)
                    inst('hxtree%d' % rng.randint(0, 3), c.x + d * math.cos(a),
                         c.y + d * math.sin(a), z, s=rng.uniform(0.7, 1.0))
        elif theme == 'wind':
            for k in range(2):
                a = rng.uniform(0, 2 * math.pi)
                d = rng.uniform(0.4, R * 0.45)
                inst('hxturbine', c.x + d * math.cos(a), c.y + d * math.sin(a), z,
                     rz=rng.uniform(0, 360))
        elif theme == 'solar':
            inst('hxsolar', c.x, c.y, z, rz=rng.choice([0, 30, 60]))
        elif theme == 'battery':
            inst('hxbattery', c.x - 0.5, c.y - 0.5, z, rz=20)
            inst('hxtree0', c.x + 2.5, c.y + 1.5, z, s=0.9)
        elif theme == 'factory':
            inst('hxfactory', c.x, c.y, z, rz=-30)
        elif theme == 'peak':
            inst('hxpeak%d' % rng.randint(0, 1), c.x, c.y, z, rz=rng.uniform(0, 360),
                 s=rng.uniform(0.9, 1.2))
            scatter_on(c, z, 3, R * 0.8,
                       lambda x, y, zz: inst('hxtree0', x, y, zz, s=rng.uniform(0.6, 0.9)))

    # path ribbon across path hexes
    PZ = LEVEL_H[1]
    centers = [tiles[h]['c'] for h in path_hexes if h in tiles]
    for k in range(len(centers) - 1):
        a, b = centers[k], centers[k + 1]
        mid = (a + b) / 2
        L = (b - a).length + 1.2
        ang = math.degrees(math.atan2(b.y - a.y, b.x - a.x))
        P_cube(L, 1.1, 0.08, mid.x, mid.y, PZ + 0.05 + k * 0.004, M['path'], rot=(0, 0, ang))
    # two buses on the path
    a, b = centers[1], centers[2]
    ang = math.degrees(math.atan2(b.y - a.y, b.x - a.x))
    m = a.lerp(b, 0.4)
    inst('hxbus', m.x, m.y, PZ + 0.1, rz=ang)
    a, b = centers[4], centers[5]
    ang = math.degrees(math.atan2(b.y - a.y, b.x - a.x))
    m = a.lerp(b, 0.6)
    inst('hxbus', m.x, m.y, PZ + 0.1, rz=ang + 180)

    # clouds
    inst('cloud0', -30, 20, 32, rz=15, s=1.4)
    inst('cloud1', 22, 32, 36, rz=-25, s=1.7)
    inst('cloud2', 8, -32, 30, rz=40, s=1.1)
    inst('cloud0', 40, -6, 38, rz=70, s=1.3)

    return {}


# ================================================================ build + render
if BASE == 'hifi':
    build_hifi()
else:
    build_hex()

cam_data = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam)
SC.camera = cam

sun_data = bpy.data.lights.new('sun', 'SUN')
sun = bpy.data.objects.new('sun', sun_data)
bpy.context.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), math.radians(12), math.radians(35))

RES = (1600, 900)
SC.render.resolution_x, SC.render.resolution_y = RES
if QUICK:
    SC.render.resolution_percentage = 55
SC.render.filepath = OUT
SC.render.image_settings.file_format = 'PNG'
VIEW = SC.view_settings

if BASE == 'hifi':
    cycles_setup(140)
    world_solid((0.30, 0.48, 0.80), 0.85)
    sun_data.energy = 3.4
    sun_data.angle = math.radians(0.8)
    sun_data.color = (1.0, 0.88, 0.72)
    mist_compositor()
    VIEW.view_transform = 'Filmic'
    try:
        VIEW.look = 'Medium High Contrast'
    except Exception:
        pass
    if CLOSE:
        cam.location = (16, -26, 7.5)
        look_at(cam, (-4, -4, 4.5))
        cam_data.lens = 44
    elif NATURE:
        cam.location = (-12, -4, 13)
        look_at(cam, (-70, 42, 11))
        cam_data.lens = 40
    else:
        cam.location = (44, -76, 48)
        look_at(cam, (-2, -1, 3))
        cam_data.lens = 36
else:
    cycles_setup(140)
    world_solid((0.48, 0.70, 0.94), 0.75)
    sun_data.energy = 4.2
    sun_data.angle = math.radians(5)
    sun_data.color = (1.0, 0.95, 0.86)
    fill = bpy.data.lights.new('fill', 'SUN')
    fo = bpy.data.objects.new('fill', fill)
    bpy.context.collection.objects.link(fo)
    fo.rotation_euler = (math.radians(55), 0, math.radians(-140))
    fill.energy = 0.6
    fill.color = (0.75, 0.85, 1.0)
    VIEW.view_transform = 'Filmic'
    try:
        VIEW.look = 'Medium High Contrast'
    except Exception:
        pass
    if CLOSE:
        cam.location = (26, -34, 22)
        look_at(cam, (1, 1, 2.5))
        cam_data.lens = 55
        cam_data.dof.use_dof = True
        cam_data.dof.focus_distance = (Vector(cam.location) - Vector((1, 1, 3))).length
        cam_data.dof.aperture_fstop = 0.035
    else:
        cam.location = (56, -76, 58)
        look_at(cam, (-1, 4, 0))
        cam_data.lens = 42

print('rendering', STYLE, '->', OUT)
bpy.ops.render.render(write_still=True)
print('DONE', STYLE)
