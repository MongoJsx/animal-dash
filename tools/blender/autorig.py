"""Rig a character for the game without Mixamo.

Builds a skeleton with Mixamo bone names from the joint markers in
rig-joints.json, skins the mesh with Blender's automatic (heat) weights and
exports a skinned .glb. The game animates these bones itself (src/render/rig.ts).
Optionally renders a test running pose so the deformation can be checked.

Usage:
  blender -b -P tools/blender/autorig.py -- <id> <in.fbx> <out.glb> [source.glb] [preview]
The source .glb (the original model) supplies materials, which the FBX round
trip sometimes loses; `preview` is a path prefix for the test-pose renders.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

cid, src, dst, *rest = sys.argv[sys.argv.index("--") + 1:]
source = rest[0] if rest and rest[0].endswith(".glb") else None
preview = rest[-1] if rest and not rest[-1].endswith(".glb") else None
J = json.load(open(os.path.join(os.path.dirname(__file__), "rig-joints.json")))[cid]


def P(p, side=1):
    # Marker [x, forward, z] -> Blender (the model faces -Y).
    return Vector((p[0] * side, -p[1], p[2]))


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
body = next(ob for ob in bpy.data.objects if ob.type == "MESH")
body.name = "Body"
for ob in list(bpy.data.objects):
    if ob is not body:
        bpy.data.objects.remove(ob)
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

if source:
    # Same material names as the FBX, but with every texture still wired up.
    before, mats = set(bpy.data.objects), set(bpy.data.materials)
    bpy.ops.import_scene.gltf(filepath=source)
    for ob in set(bpy.data.objects) - before:
        bpy.data.objects.remove(ob)
    originals = {m.name.rsplit(".", 1)[0] if m.name[-4:-3] == "." else m.name: m for m in set(bpy.data.materials) - mats}
    for slot in body.material_slots:
        if slot.material and slot.material.name in originals:
            slot.material = originals[slot.material.name]
    bpy.context.view_layer.objects.active = body
    body.select_set(True)

# Welding split vertices lets the heat solver see one surface per part.
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.object.mode_set(mode="OBJECT")

# ── Skeleton ──────────────────────────────────────────────────────────────
arm_data = bpy.data.armatures.new("Armature")
rig = bpy.data.objects.new("Armature", arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None):
    b = eb.new("mixamorig" + name)
    b.head, b.tail = head, tail
    b.parent = eb.get("mixamorig" + parent) if parent else None
    b.use_connect = False
    return b


spine = [P(p) for p in J["spine"]] + [P(J["headTop"])]
names = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"]
for i, n in enumerate(names):
    bone(n, spine[i], spine[i + 1], names[i - 1] if i else None)

for side, s in (("Left", 1), ("Right", -1)):
    a = [P(p, s) for p in J["arm"]]
    clav = Vector((a[0].x * 0.3, a[0].y, a[0].z - 0.03))
    bone(side + "Shoulder", clav, a[0], "Spine2")
    bone(side + "Arm", a[0], a[1], side + "Shoulder")
    bone(side + "ForeArm", a[1], a[2], side + "Arm")
    bone(side + "Hand", a[2], a[3], side + "ForeArm")
    g = [P(p, s) for p in J["leg"]]
    bone(side + "UpLeg", g[0], g[1], "Hips")
    bone(side + "Leg", g[1], g[2], side + "UpLeg")
    bone(side + "Foot", g[2], g[3], side + "Leg")
    bone(side + "ToeBase", g[3], g[4], side + "Foot")
bpy.ops.object.mode_set(mode="OBJECT")

# ── Skin ──────────────────────────────────────────────────────────────────
# Source meshes are rarely watertight, which makes the heat solver give up.
# Solve on a voxel-remeshed copy instead, then copy the weights across.
proxy = body.copy()
proxy.data = body.data.copy()
bpy.context.scene.collection.objects.link(proxy)
mod = proxy.modifiers.new("remesh", "REMESH")
mod.mode = "VOXEL"
mod.voxel_size = 0.012
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = proxy
proxy.select_set(True)
bpy.ops.object.modifier_apply(modifier="remesh")
# The heat solver also fails on human-sized (≈1 unit) meshes: solve at 10×.
rig.select_set(True)
for ob in (proxy, rig):
    ob.scale = (10, 10, 10)
bpy.ops.object.transform_apply(scale=True)
# Clothing and body parts remesh into separate islands, and one island the
# solver can't handle voids the whole result: solve each island on its own and
# drop the ones that fail (their surface takes weights from its neighbours).
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = proxy
proxy.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="LOOSE")
bpy.ops.object.mode_set(mode="OBJECT")
pieces = [ob for ob in bpy.context.selected_objects if ob.type == "MESH"]
kept = []
for piece in pieces:
    bpy.ops.object.select_all(action="DESELECT")
    if len(piece.data.vertices) >= 60:
        piece.select_set(True)
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        if any(v.groups for v in piece.data.vertices):
            kept.append(piece)
            continue
    bpy.data.objects.remove(piece)
print(f"proxy islands {len(pieces)}, solved {len(kept)}")
bpy.ops.object.select_all(action="DESELECT")
for ob in kept:
    ob.modifiers.clear()
    ob.parent = None
    ob.select_set(True)
bpy.context.view_layer.objects.active = kept[0]
bpy.ops.object.join()
proxy = kept[0]
proxy.select_set(True)
rig.select_set(True)
for ob in (proxy, rig):
    ob.scale = (0.1, 0.1, 0.1)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.transform_apply(scale=True)

bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_NAME")  # empty groups + modifier
mod = body.modifiers.new("weights", "DATA_TRANSFER")
mod.object = proxy
mod.use_vert_data = True
mod.data_types_verts = {"VGROUP_WEIGHTS"}
mod.vert_mapping = "POLYINTERP_NEAREST"
mod.layers_vgroup_select_src = "ALL"
mod.layers_vgroup_select_dst = "NAME"
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.modifier_move_to_index(modifier="weights", index=0)
bpy.ops.object.modifier_apply(modifier="weights")
bpy.data.objects.remove(proxy)

# Heat weighting can leave parts unweighted (open or intersecting geometry):
# give those vertices to the nearest bone so nothing stays behind.
segs = [(b.name, rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local) for b in arm_data.bones]


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (a + ab * t - p).length


groups = {g.index: g for g in body.vertex_groups}
fixed = 0
for v in body.data.vertices:
    if sum(g.weight for g in v.groups) > 1e-4:
        continue
    p = body.matrix_world @ v.co
    name = min(segs, key=lambda s: seg_dist(p, s[1], s[2]))[0]
    body.vertex_groups[name].add([v.index], 1.0, "REPLACE")
    fixed += 1
# A jacket hem over the thighs should mostly ride with the pelvis, not get
# dragged up by the knees (hemZ in rig-joints.json, where the hem ends).
if "hemZ" in J:
    hips = body.vertex_groups["mixamorigHips"]
    legs = [body.vertex_groups[f"mixamorig{s}UpLeg"] for s in ("Left", "Right")]
    for v in body.data.vertices:
        z = (body.matrix_world @ v.co).z
        k = max(0.0, min(1.0, (z - J["hemZ"] + 0.04) / 0.08))
        k = 0.75 * k * k * (3 - 2 * k)
        if k <= 0:
            continue
        for g in legs:
            try:
                w = g.weight(v.index)
            except RuntimeError:
                continue
            g.add([v.index], w * (1 - k), "REPLACE")
            hips.add([v.index], w * k, "ADD")

bpy.context.view_layer.objects.active = body
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
print(f"RIG {cid}: {len(body.data.vertices)} verts, {fixed} unweighted fixed")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    export_animations=False,
    export_skins=True,
    export_yup=True,
)

if preview:
    # Test pose: mid-stride sprint, posed by aiming bones like the game does.
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    pb = rig.pose.bones

    def aim(name, d):
        b = pb["mixamorig" + name]
        bpy.context.view_layer.update()
        m = b.matrix.copy()
        cur = (b.tail - b.head).normalized()
        rot = cur.rotation_difference(Vector(d).normalized()).to_matrix().to_4x4()
        h = m.translation.copy()
        b.matrix = Matrix.Translation(h) @ rot @ Matrix.Translation(-h) @ m

    def ang(deg_fwd, deg_down=0.0):
        # Direction pointing down, swung forward by deg_fwd (forward is -Y).
        a = math.radians(deg_fwd)
        return (0, -math.sin(a), -math.cos(a))

    aim("Spine1", (0, -0.25, 1))
    aim("LeftUpLeg", ang(70))
    aim("LeftLeg", ang(-5))
    aim("RightUpLeg", ang(-25))
    aim("RightLeg", ang(-110))
    for side, s, sw in (("Left", 1, -45), ("Right", -1, 55)):
        aim(side + "Arm", (0.25 * s, -math.sin(math.radians(sw)), -math.cos(math.radians(sw))))
        aim(side + "ForeArm", (0.1 * s, -math.sin(math.radians(sw + 95)), -math.cos(math.radians(sw + 95))))
    bpy.ops.object.mode_set(mode="OBJECT")

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = 500
    scene.render.resolution_y = 500
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.2
    scene.collection.objects.link(cam)
    scene.camera = cam
    rig.hide_render = True
    for view, loc, rot in (
        ("side", (-6, 0, 0.9), (math.pi / 2, 0, -math.pi / 2)),
        ("front", (0, -6, 0.9), (math.pi / 2, 0, 0)),
        ("three", (-4.2, -4.2, 0.9), (math.pi / 2, 0, -math.pi / 4)),
    ):
        cam.location, cam.rotation_euler = loc, rot
        scene.render.filepath = f"{preview}_{view}.png"
        bpy.ops.render.render(write_still=True)
