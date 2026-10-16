"""Shared piece discovery for catalog_asset.py and extract_piece.py.
Both must enumerate pieces identically so catalog indices stay valid."""
import os
import re
import sys

import bpy
from mathutils import Vector

MAX_PIECES = 96


def find_source(d):
    if os.path.exists(os.path.join(d, "model.glb")):
        return os.path.join(d, "model.glb")
    for root, _, files in os.walk(os.path.join(d, "gltf")):
        for f in files:
            if f.endswith(".gltf") or f.endswith(".glb"):
                return os.path.join(root, f)
    sys.exit(f"no model in {d}")


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons) if ob.type == "MESH" else 0


def subtree_meshes(ob):
    out = [ob] if ob.type == "MESH" else []
    for c in ob.children_recursive:
        if c.type == "MESH":
            out.append(c)
    return out


def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def pieces_of(roots):
    """Descend through wrapper nodes until the scene fans out into pieces."""
    level = roots
    # Stop at a mesh with children (a cart body with wheels): it is one piece.
    while len(level) == 1 and level[0].children and level[0].type != "MESH":
        level = list(level[0].children)
    out = [o for o in level if subtree_meshes(o)]
    # A single merged mesh holding a whole pack: split it into loose parts.
    if len(out) == 1 and out[0].type == "MESH" and not out[0].children and len(out[0].data.polygons) > 50:
        ob = out[0]
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.separate(type="LOOSE")
        bpy.ops.object.mode_set(mode="OBJECT")
        parts = [o for o in bpy.context.selected_objects if o.type == "MESH"]
        if 1 < len(parts) <= 400:
            return parts
    return out


def is_helper(o):
    # The glTF importer adds untextured icospheres as bone display shapes.
    return not o.users_collection or (o.type == "MESH" and o.name.startswith("Icosphere") and not o.data.materials)


def load_pieces(asset_dir):
    """Import the asset into an empty scene and return (pieces, dropped)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=find_source(asset_dir))
    bpy.context.view_layer.update()
    for o in [o for o in bpy.data.objects if is_helper(o)]:
        bpy.data.objects.remove(o)
    roots = [o for o in bpy.data.objects if o.parent is None and subtree_meshes(o)]
    pieces = pieces_of(roots)
    # Biggest first so the sheet shows what matters; cap the count.
    pieces.sort(key=lambda o: -sum(tris(m) for m in subtree_meshes(o)))
    # Packs repeat the same model (Tree.001, Tree.002 ...): keep one of each.
    seen, unique = set(), []
    for p in pieces:
        key = (re.sub(r"\.\d+$", "", p.name), sum(tris(m) for m in subtree_meshes(p)))
        if key not in seen:
            seen.add(key)
            unique.append(p)
    return unique[:MAX_PIECES], max(0, len(unique) - MAX_PIECES)
