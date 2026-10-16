"""Stamp piece numbers onto a catalog sheet.png (8 columns, row-major).
Usage: python3 tools/label-sheet.py <asset_dir>
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

d = Path(sys.argv[1])
cat = json.loads((d / "catalog.json").read_text())
img = Image.open(d / "sheet.png").convert("RGB")
cell = img.width // 8
draw = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 26)
except OSError:
    font = ImageFont.load_default()
for p in cat["pieces"]:
    i = p["index"]
    x, y = (i % 8) * cell, (i // 8) * cell
    label = str(i)
    draw.rectangle([x + 4, y + 4, x + 14 + 16 * len(label), y + 36], fill=(20, 20, 20))
    draw.text((x + 9, y + 5), label, fill=(255, 220, 60), font=font)
    w, h, dep = p["size"]
    draw.text((x + 6, y + cell - 22), f"{w:.1f}x{h:.1f}x{dep:.1f} {p['tris']}t", fill=(30, 30, 30), font=ImageFont.load_default())
img.save(d / "sheet_labeled.png")
