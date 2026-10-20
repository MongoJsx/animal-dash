"""Model the hippo runner (hippo head, human body) from primitives.

Writes the source model the rest of the character pipeline starts from
(assets-src/characters/<id>.glb): Z-up, facing -Y, 1.8 m tall, feet at z=0,
arms in an A-pose so tools/blender/autorig.py can skin it like the others.

Usage:
  blender -b -P tools/blender/model_hippo.py -- <out.glb>
"""
import math
import sys

import bpy
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, hex_color, rough=0.75):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    c = [((hex_color >> s) & 255) / 255 for s in (16, 8, 0)]
    # Hex colours are sRGB; Blender wants linear.
    bsdf.inputs["Base Color"].default_value = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1]
    bsdf.inputs["Roughness"].default_value = rough
    return m


SKIN = mat("hippo_skin", 0x9b8fb8)
SNOUT = mat("hippo_snout", 0xc9b6d8)
PINK = mat("hippo_pink", 0xf29bb4)
DARK = mat("hippo_dark", 0x3d3350)
WHITE = mat("eye_white", 0xffffff, 0.4)
PUPIL = mat("eye_pupil", 0x111111, 0.3)
TOOTH = mat("tooth", 0xfffbe8, 0.4)
SHIRT = mat("tank_top", 0xff8a1f)
STRIPE = mat("stripe", 0xffffff)
SHORTS = mat("shorts", 0x2747a8)
SOCK = mat("sock", 0xf4f4f4)
SHOE = mat("shoe", 0xe23b3b, 0.5)
SOLE = mat("sole", 0xf7f2e8)
BAND = mat("wristband", 0xffd23f)

parts = []


def done(ob, material, smooth=True):
    ob.data.materials.append(material)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    parts.append(ob)
    return ob


def blob(material, loc, size, rot=(0, 0, 0), segs=14, rings=9):
    """Ellipsoid: `size` is the full extent along x, y, z."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=0.5, location=loc, rotation=rot)
    ob = bpy.context.object
    ob.scale = size
    return done(ob, material)


def limb(material, a, b, r1, r2, segs=12, squash=1.0):
    """Tapered tube from a (radius r1) to b (radius r2), rounded at both ends."""
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cone_add(vertices=segs, radius1=r1, radius2=r2, depth=d.length, location=(a + b) / 2)
    ob = bpy.context.object
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    ob.scale = (1, squash, 1)
    done(ob, material)
    for p, r in ((a, r1), (b, r2)):
        blob(material, p, (2 * r, 2 * r * squash, 2 * r), segs=segs, rings=7)
    return ob


def box(material, loc, size, bevel=0.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.object
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    m = ob.modifiers.new("bevel", "BEVEL")
    m.width = bevel
    m.segments = 3
    bpy.ops.object.modifier_apply(modifier="bevel")
    return done(ob, material)


# ── Legs, socks and sneakers ──────────────────────────────────────────
for s in (1, -1):
    x = 0.11 * s
    limb(SHORTS, (x, 0, 0.92), (x * 1.12, 0, 0.7), 0.11, 0.115)  # loose running-shorts leg
    blob(STRIPE, (x * 1.06 + 0.1 * s, 0, 0.8), (0.02, 0.07, 0.2))  # side stripe
    limb(SKIN, (x * 1.12, 0, 0.7), (x * 1.15, 0.0, 0.5), 0.088, 0.072)  # thigh below the shorts
    limb(SKIN, (x * 1.15, 0, 0.5), (x * 1.2, 0.02, 0.17), 0.072, 0.052)  # shin
    blob(SKIN, (x * 1.15, 0.035, 0.36), (0.12, 0.11, 0.18))  # calf
    limb(SOCK, (x * 1.2, 0.02, 0.2), (x * 1.2, 0.02, 0.1), 0.052, 0.052)
    blob(SHOE, (x * 1.2, -0.05, 0.075), (0.13, 0.28, 0.12))
    blob(SOLE, (x * 1.2, -0.05, 0.03), (0.14, 0.29, 0.06))
    blob(STRIPE, (x * 1.2 + 0.055 * s, -0.04, 0.08), (0.025, 0.16, 0.05))

# ── Hips and torso ────────────────────────────────────────────────────
blob(SHORTS, (0, 0, 0.92), (0.4, 0.25, 0.2))
box(STRIPE, (0, 0, 0.99), (0.37, 0.24, 0.035), bevel=0.012)  # waistband
blob(SHIRT, (0, 0, 1.12), (0.4, 0.26, 0.34))  # belly
blob(SHIRT, (0, 0.005, 1.3), (0.44, 0.25, 0.32))  # chest
limb(SHIRT, (0, 0, 1.0), (0, 0, 1.38), 0.18, 0.2, squash=0.62)
box(STRIPE, (0, -0.125, 1.22), (0.3, 0.02, 0.05), bevel=0.01)  # racing stripe across the vest
box(STRIPE, (0, -0.13, 1.3), (0.11, 0.015, 0.09), bevel=0.01)  # number plate
blob(SKIN, (0, 0.0, 1.43), (0.3, 0.2, 0.1))  # shoulders / collar

# ── Arms (A-pose) ─────────────────────────────────────────────────────
for s in (1, -1):
    sh = (0.21 * s, 0, 1.42)
    el = (0.38 * s, 0.0, 1.21)
    wr = (0.52 * s, 0.02, 1.0)
    blob(SHIRT, (0.16 * s, 0, 1.41), (0.1, 0.15, 0.08))  # vest strap over the shoulder
    limb(SKIN, sh, el, 0.065, 0.055)
    limb(SKIN, el, wr, 0.055, 0.047)
    limb(BAND, (0.49 * s, 0.017, 1.04), (0.525 * s, 0.02, 0.995), 0.054, 0.054)
    blob(SKIN, (0.565 * s, 0.025, 0.94), (0.1, 0.085, 0.13))  # hand (mitten)
    blob(SKIN, (0.535 * s, -0.025, 0.96), (0.04, 0.05, 0.06))  # thumb

# ── Neck and hippo head ───────────────────────────────────────────────
limb(SKIN, (0, 0.0, 1.42), (0, -0.01, 1.53), 0.085, 0.09)
# A cartoon head: everything above the neck is drawn K× bigger about the neck.
K = 1.35
NECK = Vector((0, 0, 1.5))


def hb(material, loc, size, rot=(0, 0, 0), segs=14, rings=9):
    return blob(material, NECK + (Vector(loc) - NECK) * K, [v * K for v in size], rot, segs, rings)


def ht(material, loc, size, bevel):
    return box(material, NECK + (Vector(loc) - NECK) * K, [v * K for v in size], bevel * K)


hb(SKIN, (0, 0.02, 1.64), (0.36, 0.34, 0.3), segs=24, rings=14)  # skull
hb(SKIN, (0, -0.05, 1.7), (0.3, 0.26, 0.17), segs=20, rings=10)  # brow, raises the eyes
hb(SNOUT, (0, -0.18, 1.58), (0.4, 0.26, 0.23), segs=24, rings=14)  # the big snout
hb(SNOUT, (0, -0.15, 1.5), (0.32, 0.2, 0.1), segs=18, rings=10)  # lower jaw
hb(DARK, (0, -0.305, 1.555), (0.24, 0.02, 0.02), segs=12, rings=6)  # mouth line
for s in (1, -1):
    hb(DARK, (0.075 * s, -0.27, 1.66), (0.05, 0.035, 0.03), segs=10, rings=6)  # nostril
    hb(PINK, (0.14 * s, -0.22, 1.53), (0.07, 0.05, 0.05), segs=10, rings=6)  # cheek
    ht(TOOTH, (0.075 * s, -0.29, 1.52), (0.035, 0.025, 0.05), bevel=0.008)  # tooth
    hb(WHITE, (0.085 * s, -0.13, 1.745), (0.085, 0.07, 0.09))  # eye
    hb(PUPIL, (0.085 * s, -0.165, 1.75), (0.04, 0.02, 0.045), segs=10, rings=6)
    hb(WHITE, (0.075 * s, -0.172, 1.762), (0.012, 0.006, 0.012), segs=6, rings=4)  # catch-light
    hb(SKIN, (0.085 * s, -0.12, 1.79), (0.09, 0.07, 0.025), segs=12, rings=6)  # eyelid
    hb(SKIN, (0.15 * s, 0.07, 1.775), (0.06, 0.035, 0.07), rot=(0, 0.35 * s, 0), segs=12, rings=7)  # ear
    hb(PINK, (0.15 * s, 0.055, 1.775), (0.035, 0.012, 0.045), rot=(0, 0.35 * s, 0), segs=8, rings=5)

# ── Tidy up and export ────────────────────────────────────────────────
bpy.ops.object.select_all(action="DESELECT")
for ob in parts:
    ob.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
body = bpy.context.object
body.name = "hippo_runner"
tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
# Normalise the way glb_to_mixamo_fbx.py does (1.8 m, centred, feet on the
# ground) and report the mapping so rig-joints.json can use design coordinates.
co = [v.co for v in body.data.vertices]
lo = Vector([min(c[i] for c in co) for i in range(3)])
hi = Vector([max(c[i] for c in co) for i in range(3)])
f = 1.8 / (hi.z - lo.z)
shift = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
for v in body.data.vertices:
    v.co = (v.co - shift) * f
# rig-joints.json uses forward = -y: marker = [x, -(y - dy), z] * f
print(f"HIPPO: {tris} tris, scale {f:.4f}, dy {shift.y:.4f}, dz {shift.z:.4f}")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True)
