"""Prepare a character .glb for Mixamo auto-rigging.

Strips any existing skeleton, joins all meshes, stands the model upright
(Z-up, facing -Y as Mixamo expects), scales it to 1.8 m, puts the feet on the
ground and exports an FBX with embedded textures. Also renders a front preview
PNG next to the FBX so the pose can be checked before uploading.

Usage:
  blender -b -P tools/blender/glb_to_mixamo_fbx.py -- <in.glb> <out.fbx>
"""
import sys
import bpy
from mathutils import Vector

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
HEIGHT = 1.8

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

# Drop skeletons: Mixamo re-rigs from the bare mesh. Converting to mesh first
# bakes the armature deform and parent scale into the shape as it looks now.
for ob in list(bpy.data.objects):
    # Stray helper geometry (e.g. an untextured icosphere) would confuse the rigger.
    if ob.type == "MESH" and not ob.data.materials and len(ob.data.polygons) < 200:
        bpy.data.objects.remove(ob)
meshes = [ob for ob in bpy.data.objects if ob.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for ob in meshes:
    ob.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.convert(target="MESH")
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
for ob in list(bpy.data.objects):
    if ob.type != "MESH":
        bpy.data.objects.remove(ob)

meshes = [ob for ob in bpy.data.objects if ob.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for ob in meshes:
    ob.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = "Character"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def bounds(ob):
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


# Some sources were authored Z-up and import lying down along Y.
lo, hi = bounds(body)
size = hi - lo
if size.y > size.z and size.y >= size.x:
    body.rotation_euler.x = -1.5708
    bpy.ops.object.transform_apply(rotation=True)

lo, hi = bounds(body)
body.scale *= HEIGHT / (hi.z - lo.z)
bpy.ops.object.transform_apply(scale=True)
lo, hi = bounds(body)
body.location -= Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
bpy.ops.object.transform_apply(location=True)

bpy.ops.export_scene.fbx(
    filepath=dst,
    use_selection=False,
    object_types={"MESH"},
    path_mode="COPY",
    embed_textures=True,
    add_leaf_bones=False,
    bake_anim=False,
)

# Front preview (camera on -Y looking at +Y, the side Mixamo shows first).
scene = bpy.context.scene
cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = 2.2
cam.location = (0, -6, 0.9)
cam.rotation_euler = (1.5708, 0, 0)
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = 400
scene.render.resolution_y = 400
scene.render.filepath = dst.rsplit(".", 1)[0] + "_front.png"
bpy.ops.render.render(write_still=True)
