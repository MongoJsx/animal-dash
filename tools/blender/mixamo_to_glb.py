"""Convert Mixamo downloads to glTF.

Character (FBX "With Skin", T-pose) -> skinned .glb without animations:
  blender -b -P tools/blender/mixamo_to_glb.py -- character <in.fbx> <out.glb>

Animation set (folder of FBX "Without Skin", one clip per file, the file name
becomes the clip name, e.g. run.fbx -> "run") -> one armature-only .glb holding
every clip. All Mixamo rigs share bone names, so the game plays these clips on
any character:
  blender -b -P tools/blender/mixamo_to_glb.py -- anims <folder> <out.glb>
"""
import os
import sys
import bpy

mode, src, dst = sys.argv[sys.argv.index("--") + 1:][:3]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=True)
    return [ob for ob in bpy.data.objects if ob not in before]


def export(path, animations):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_animations=animations,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_anim_single_armature=True,
        export_def_bones=False,
        export_yup=True,
    )


reset()
if mode == "character":
    objs = import_fbx(src)
    for ob in objs:
        if ob.animation_data:
            ob.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    export(dst, animations=False)

elif mode == "anims":
    files = sorted(f for f in os.listdir(src) if f.lower().endswith(".fbx"))
    if not files:
        sys.exit(f"no .fbx files in {src}")
    base = None
    for f in files:
        name = os.path.splitext(f)[0]
        objs = import_fbx(os.path.join(src, f))
        arm = next(ob for ob in objs if ob.type == "ARMATURE")
        action = arm.animation_data.action
        slot = getattr(arm.animation_data, "action_slot", None)
        action.name = name
        action.use_fake_user = True
        if base is None:
            base = arm
            base.animation_data.action = None
        else:
            for ob in objs:
                bpy.data.objects.remove(ob)
        track = base.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, int(action.frame_range[0]), action)
        if slot is not None and hasattr(strip, "action_slot"):
            strip.action_slot = slot
        print(f"clip {name}: frames {action.frame_range[0]:.0f}-{action.frame_range[1]:.0f}")
    # Animation-only file: keep the skeleton, drop any mesh that came along.
    for ob in list(bpy.data.objects):
        if ob.type == "MESH":
            bpy.data.objects.remove(ob)
    export(dst, animations=True)

else:
    sys.exit(f"unknown mode {mode}")
