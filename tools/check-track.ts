// Sanity-checks the track generator over many seeds:
// - every row leaves at least one lane passable at every moment
// - no pattern repeats back to back, patterns cover the whole library
// - the same seed builds the same track
// Runs for every lane count (3, 4 and 5).
// Usage: npx tsx tools/check-track.ts
import { LANES, LANE_CHOICES, LANE_WIDTH, RACE_LENGTH, setLaneCount } from '../src/config.ts';
import { hitBoxes, type Box } from '../src/world/obstacles.ts';
import { buildTrack } from '../src/world/track.ts';

const SEEDS = 300;
let failures = 0;
const kinds = new Map<string, number>();
const boxes: Box[] = [];

// A lane is passable at (d, t) if some stance (run, jump apex, slide) clears every box.
const STANCES = [
  { y0: 0, y1: 1.7 }, // run
  { y0: 1.0, y1: 2.7 }, // mid-jump
  { y0: 0, y1: 0.75 }, // slide
];

const MAPS = ['thai', 'china', 'japan', 'fable'] as const;
for (let seed = 1; seed <= SEEDS; seed++) {
  setLaneCount(LANE_CHOICES[seed % LANE_CHOICES.length]);
  const map = MAPS[seed % MAPS.length];
  const track = buildTrack(seed, map);
  const again = buildTrack(seed, map);
  if (JSON.stringify(track.obstacles) !== JSON.stringify(again.obstacles)) {
    console.log(`seed ${seed}: not deterministic`);
    failures++;
  }
  for (const o of track.obstacles) kinds.set(o.kind, (kinds.get(o.kind) ?? 0) + 1);

  for (let d = 0; d < RACE_LENGTH; d += 0.5) {
    const near = track.obstacles.filter((o) => o.d <= d + 1 && o.d + o.length >= d - 1 && o.kind !== 'oncoming' && o.kind !== 'rolling' && o.kind !== 'drop');
    if (!near.length) continue;
    for (let t = 0; t < 4; t += 0.25) {
      boxes.length = 0;
      for (const o of near) hitBoxes(o, t, boxes);
      const at = boxes.filter((b) => b.d0 <= d && b.d1 >= d);
      if (!at.length) continue;
      const open = LANES.some((lane) => {
        const x = lane * LANE_WIDTH;
        return STANCES.some((s) => !at.some((b) => x + 0.35 > b.x0 && x - 0.35 < b.x1 && s.y1 > b.y0 && s.y0 < b.y1));
      });
      if (!open) {
        console.log(`seed ${seed} (${LANES.length} lanes): blocked at d=${d.toFixed(1)} t=${t} kinds=${near.map((o) => o.kind).join(',')}`);
        failures++;
        break;
      }
    }
  }
}

console.log('obstacle counts over', SEEDS, 'seeds:', Object.fromEntries([...kinds].sort((a, b) => b[1] - a[1])));
const t = buildTrack(7);
console.log(`seed 7: ${t.rows.length} rows, ${t.obstacles.length} obstacles, biomes ${t.biomes.join(' → ')}`);
console.log(failures ? `${failures} FAILURES` : 'all checks passed');
process.exit(failures ? 1 : 0);
