# Assets

Optimized, game-ready files only. Raw downloads from Sketchfab go in `assets-src/sketchfab/<name>/` and are never served.

| Folder | Contents |
|---|---|
| `characters/` | Half-animal player characters (`.glb` with run/jump/slide/stumble/fall animations) |
| `environment/<biome>/` | Ground tiles and side decorations for `village`, `forest`, `candy`, `harbor`, `snow` |
| `obstacles/` | Obstacle models, named `<mechanic>-<biome>.glb` (e.g. `lowbar-village.glb`) |
| `pickups/` | Coins and power-ups |
| `fx/` | Particle textures |
| `audio/` | Music and sound effects |
| `ui/` | Icons and HUD images |

Budgets: obstacle ≤ 3k tris, decor ≤ 5k tris, character ≤ 15k tris, textures ≤ 1024px. See `docs/GAME_DESIGN.md` §7.
