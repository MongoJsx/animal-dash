"""Catalog one downloaded Sketchfab asset: split it into pieces, measure each
piece and render a numbered contact sheet so pieces can be picked by eye.

Writes next to the asset:
  catalog.json  [{index, name, tris, size:[w,h,d] (metres, Y-up), materials}]
  sheet.png     grid of numbered piece renders

Usage:
  blender -b -P tools/blender/catalog_asset.py -- <asset_dir>
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pieces import bounds, load_pieces, subtree_meshes, tris  # noqa: E402

asset_dir = sys.argv[sys.argv.index("--") + 1]
CELL = 256

pieces, dropped = load_pieces(asset_dir)

catalog = []
for i, p in enumerate(pieces):
    meshes = subtree_meshes(p)
    lo, hi = bounds(meshes)
    size = hi - lo
    mats = sorted({s.material.name for m in meshes for s in m.material_slots if s.material})
    # Blender is Z-up; report Y-up like glTF/three.js.
    catalog.append({
        "index": i,
        "name": p.name,
        "tris": sum(tris(m) for m in meshes),
        "size": [round(size.x, 3), round(size.z, 3), round(size.y, 3)],
        "materials": mats[:6],
    })

with open(os.path.join(asset_dir, "catalog.json"), "w") as f:
    json.dump({"pieces": catalog, "dropped": dropped}, f, indent=1)

# ── Contact sheet: render each piece alone, then tile. ────────────────
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_cavity = True
scene.render.resolution_x = CELL
scene.render.resolution_y = CELL
scene.render.film_transparent = False
world = bpy.data.worlds.new("W")
world.color = (0.85, 0.87, 0.9)
scene.world = world
cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
cam.data.type = "ORTHO"
scene.collection.objects.link(cam)
scene.camera = cam

all_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
tmp = os.path.join(asset_dir, ".cells")
os.makedirs(tmp, exist_ok=True)
cells = []
for i, p in enumerate(pieces):
    keep = set(subtree_meshes(p))
    for o in all_meshes:
        o.hide_render = o not in keep
    lo, hi = bounds(list(keep))
    c = (lo + hi) / 2
    r = max((hi - lo).length / 2, 0.01)
    # Three-quarter view from the front (-Y) and above.
    d = Vector((0.9, -1.4, 0.8)).normalized()
    cam.location = c + d * r * 4
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = r * 2.3
    cam.data.clip_start = r * 0.05
    cam.data.clip_end = r * 10
    path = os.path.join(tmp, f"{i}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    cells.append(path)

cols = 8
rows = math.ceil(len(cells) / cols) or 1
sheet = bpy.data.images.new("sheet", cols * CELL, rows * CELL)
px = [0.15] * (cols * CELL * rows * CELL * 4)
for i, path in enumerate(cells):
    img = bpy.data.images.load(path)
    src = list(img.pixels)
    cx, cy = i % cols, rows - 1 - i // cols
    for y in range(CELL):
        row_src = y * CELL * 4
        row_dst = ((cy * CELL + y) * cols * CELL + cx * CELL) * 4
        px[row_dst:row_dst + CELL * 4] = src[row_src:row_src + CELL * 4]
sheet.pixels = px
sheet.filepath_raw = os.path.join(asset_dir, "sheet.png")
sheet.file_format = "PNG"
sheet.save()
for path in cells:
    os.remove(path)
os.rmdir(tmp)
print(f"CATALOG {asset_dir}: {len(pieces)} pieces (+{dropped} dropped)")
