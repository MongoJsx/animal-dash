"""Turn the asset-picking workflow output into the final build list.

assets-src/picks-workflow.json  (judge picks + per-biome verifier verdicts)
  -> assets-src/picks.json      (input of tools/build-props.mjs)

1. Apply verifier verdicts: rejected picks are swapped for the verifier's
   replacement, or dropped.
2. Apply the curation rules below (from the verifiers' style notes).
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
res = json.loads((ROOT / "assets-src/picks-workflow.json").read_text())

# Pieces that must not ship anywhere (reason in comment).
BANNED = {
    ("ob-block/low-poly-stylized-cart-with-wooden-barrels-309cf2", -1),  # loose parts + 9 m shaft, near-black
    ("ob-ride/gravity-tram-stylized-2ecd4b", -1),  # renders black, sci-fi
    ("ob-jump/stylized-fence-9d8ce9", 1),  # slanted thin plank, reads as a stick
    ("pack/low-poly-medieval-environment-pack-35-props-a85053", 10),  # spindly fence, weak jump cue
    ("candy/christmas-presents-low-poly-efda34", 17),  # Hogwarts-style crests (IP)
}
# Slots where the procedural greybox reads better than any candidate.
PROCEDURAL_SLOTS = {"highbar"}  # tiny boards once fitted; the painted procedural sign is clearer
# Picks that share a mesh with a hazard asking for a different move in that biome.
DROP = {
    ("candy", "bounce", "candy/low-poly-sweets-pack-f29161", 0),  # donut is also the rolling hazard
    ("candy", "drop", "candy/low-poly-sweets-pack-f29161", 2),  # cupcake is also the dodge-only wall
    ("harbor", "wall", "harbor/pirate-asset-pack-a9661a", 2),  # barrel is also the rolling hazard
    ("candy", "hay", "candy/christmas-presents-low-poly-efda34", 20),  # dark denim-like wrap texture
    ("candy", "drop", "candy/christmas-presents-low-poly-efda34", 20),
    ("snow", "drop", "candy/christmas-presents-low-poly-efda34", 20),
    ("candy", "rolling", "candy/low-poly-sweets-pack-f29161", 0),  # donut lies flat, can't roll
    ("village", "trainCar", "ob-ride/stagecoach-840203", -1),  # tiny once fitted, no rideable roof
    ("harbor", "lowbar", "pack/low-poly-medieval-environment-pack-35-props-a85053", 5),  # log pile too deep for a jump bar
}
# Use whole-asset picks as a specific piece instead.
REINDEX = {("pack/treasure-chest-mimic-26277b", -1): 0}  # chest only, no coin trails
FLIP = {("pack/low-poly-farm-village-medieval-wood-asset-pack-e440b9", 7)}  # sign: stub post becomes the hanger
# Long vehicles: only the container has a flat roof that reads as rideable.
CONTAINER = ("pack/zombie-apocalypse-kit-free-b0806e", 30)


def short(d):
    return d.split("assets-src/sketchfab/")[-1]


picks = [dict(p, slot=j["slot"]) for j in res["picks"] for p in j["picks"]]
verdicts = {(v["biome"], x["slot"], x["dir"], x["index"]): x for v in res["verified"] for x in v["verdicts"]}
merged = []
for p in picks:
    v = verdicts.get((p["biome"], p["slot"], p["dir"], p["index"]))
    if v and not v["keep"]:
        if not (v.get("replacementDir") and v.get("replacementIndex") is not None):
            continue
        p = dict(p, dir=v["replacementDir"], index=v["replacementIndex"], what="replacement: " + v["reason"][:60])
    merged.append(p)

out, seen = [], set()
for p in merged:
    key = (short(p["dir"]), p["index"])
    if key in BANNED or (p["biome"], p["slot"], *key) in DROP or p["slot"] in PROCEDURAL_SLOTS:
        continue
    if key in REINDEX:
        p = dict(p, index=REINDEX[key])
        key = (key[0], p["index"])
    if key in FLIP:
        p = dict(p, flip=True)
    k = (p["biome"], p["slot"], p["dir"], p["index"])
    if k not in seen:
        seen.add(k)
        out.append(p)

for biome in ("harbor", "snow", "candy"):
    if not any(p["biome"] == biome and p["slot"] == "trainCar" for p in out):
        out.append({"slot": "trainCar", "biome": biome, "dir": "assets-src/sketchfab/" + CONTAINER[0], "index": CONTAINER[1], "rank": 1, "what": "shipping container car"})

# Roadside decor must never look like an obstacle of the same biome.
hazards = {(p["biome"], p["dir"], p["index"]) for p in out if not p["slot"].startswith("decor")}
out = [p for p in out if not (p["slot"].startswith("decor") and (p["biome"], p["dir"], p["index"]) in hazards)]

(ROOT / "assets-src/picks.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
counts = {}
for p in out:
    counts.setdefault(p["slot"], {}).setdefault(p["biome"], 0)
    counts[p["slot"]][p["biome"]] += 1
for slot in sorted(counts):
    print(f"{slot:13}", " ".join(f"{b[:4]}:{counts[slot].get(b, 0)}" for b in ("village", "forest", "candy", "harbor", "snow")))
print(len(out), "picks")
