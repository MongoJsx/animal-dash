"""Export one catalogued piece (or the whole asset with index -1) as a clean,
game-ready .glb: single object, transforms applied, feet on y=0, centred,
and optionally turned so its long side runs along X (across the lanes) or
Z (down the track).

Usage:
  blender -b -P tools/blender/extract_piece.py -- <asset_dir> <index> <out.glb> [x|z|none] [flip] [max_tris]

Pieces modelled at an angle (e.g. a container yawed 45 degrees) are squared up
first, using the yaw with the smallest footprint. "flip" turns it upside down.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pieces import bounds, load_pieces, subtree_meshes  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
asset_dir, index, out = argv[0], int(argv[1]), argv[2]
axis = argv[3] if len(argv) > 3 else "none"
flip = len(argv) > 4 and argv[4] == "flip"
max_tris = int(argv[5]) if len(argv) > 5 and argv[5] else 0

pieces, _ = load_pieces(asset_dir)
if index >= len(pieces):
    sys.exit(f"index {index} out of range ({len(pieces)} pieces)")
# Whole asset: keep every mesh (the catalog's de-duplication and cap don't apply).
keep = set(o for o in bpy.data.objects if o.type == "MESH") if index < 0 else set(subtree_meshes(pieces[index]))

for ob in list(bpy.data.objects):
    if ob.type == "MESH" and ob not in keep:
        bpy.data.objects.remove(ob)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
# Bake armature poses / parent transforms into plain meshes.
bpy.ops.object.convert(target="MESH")
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
for ob in list(bpy.data.objects):
    if ob.type != "MESH":
        bpy.data.objects.remove(ob)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
ob.name = "piece"
# Packs instance one mesh many times; transform_apply silently skips shared data.
if ob.data.users > 1:
    ob.data = ob.data.copy()
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# glTF imports use quaternion rotation; the euler edits below need XYZ mode.
ob.rotation_mode = "XYZ"

# Square up pieces that were placed at an angle: pick the yaw whose
# axis-aligned footprint is smallest (only if clearly better than now).
pts = [ob.matrix_world @ v.co for v in ob.data.vertices]


def footprint(a):
    c, s_ = math.cos(a), math.sin(a)
    xs = [p.x * c - p.y * s_ for p in pts]
    ys = [p.x * s_ + p.y * c for p in pts]
    return (max(xs) - min(xs)) * (max(ys) - min(ys))


if pts:
    best = min((math.radians(d) for d in range(0, 90)), key=footprint)
    if footprint(best) < footprint(0) * 0.92:
        ob.rotation_euler.z = best
        bpy.ops.object.transform_apply(rotation=True)
if flip:
    ob.rotation_euler.y = math.pi
    bpy.ops.object.transform_apply(rotation=True)

lo, hi = bounds([ob])
size = hi - lo
# Blender X = across lanes, Blender Y = down the track (glTF -Z).
if (axis == "x" and size.y > size.x * 1.15) or (axis == "z" and size.x > size.y * 1.15):
    ob.rotation_euler.z = 1.5708
    bpy.ops.object.transform_apply(rotation=True)

lo, hi = bounds([ob])
ob.location -= Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
bpy.ops.object.transform_apply(location=True)

tri_count = sum(len(p.vertices) - 2 for p in ob.data.polygons)
if max_tris and tri_count > max_tris:
    # Collapse decimation works on flat-shaded / split meshes where glTF simplifiers stall.
    mod = ob.modifiers.new("decimate", "DECIMATE")
    mod.ratio = max_tris / tri_count
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True, export_animations=False, use_selection=False)
lo, hi = bounds([ob])
s = hi - lo
print(f"EXTRACTED {out} size(x,y_up,z)=({s.x:.2f},{s.z:.2f},{s.y:.2f}) tris={sum(len(p.vertices) - 2 for p in ob.data.polygons)}")
