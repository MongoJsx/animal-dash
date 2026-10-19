// Racer-vs-racer contact: crowd a lane with runners at the start, swerve into
// the pack and dash through it; check no two bodies ever overlap.
// Usage: npx tsx tools/check-contacts.ts
import { BODY, START_SLOTS, TICK } from '../src/config.ts';
import { resolveContacts } from '../src/entities/contact.ts';
import { Player } from '../src/entities/player.ts';
import { Rival } from '../src/entities/rival.ts';
import type { Action } from '../src/core/input.ts';
import { buildTrack } from '../src/world/track.ts';

let failures = 0;
let bumps = 0, dashes = 0, stuns = 0, barges = 0, shoved = 0;
for (let seed = 1; seed <= 60; seed++) {
  const track = buildTrack(seed, (['thai', 'china', 'japan'] as const)[seed % 3]);
  const p = new Player();
  p.startSlot(START_SLOTS[0], -1);
  const rivals = [[1, 0], [2, 1], [3, 1]].map(([slot, lane], i) =>
    new Rival(seed * 7 + i, { mistake: 0.3, pace: 1 }, START_SLOTS[slot], lane));
  // Everyone leaves the blocks together.
  p.launch();
  for (const r of rivals) r.launch();
  let t = 0;
  // The player keeps swerving into the pack.
  for (let step = 0; step < 60 * 40 && !p.finished; step++) {
    t += TICK;
    const actions: Action[] = step % 50 === 0 ? [(step / 50) % 2 ? 'left' : 'right'] : [];
    if (p.dashReady) actions.push('dash');
    p.step(TICK, t, actions, track);
    for (const e of p.events) {
      if (e.type === 'bump') bumps++;
      if (e.type === 'barged') barges++;
      if (e.type === 'shoved') shoved++;
      if (e.type === 'dash') dashes++;
    }
    p.events.length = 0;
    for (const r of rivals) r.step(TICK, track, p.d, [p, ...rivals.filter((o) => o !== r)]);
    resolveContacts([p, ...rivals]);
    const all = [p, ...rivals];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (Math.abs(a.x - b.x) < BODY.width - 0.05 && Math.abs(a.d - b.d) < BODY.depth - 0.05 && Math.abs(a.y - b.y) < 1.3) {
        console.log(`seed ${seed} t=${t.toFixed(2)}: overlap ${i}/${j} dx=${(a.x - b.x).toFixed(2)} dd=${(a.d - b.d).toFixed(2)}`);
        failures++;
        step = 1e9;
        break;
      }
    }
  }
  for (const r of rivals) stuns += r.moves.filter((m) => m === 'stunned').length;
}
console.log(`player bumps: ${bumps}, barged others: ${barges}, got barged: ${shoved}, dashes: ${dashes}, rivals stunned/barged: ${stuns}`);
console.log(failures ? `${failures} FAILURES` : 'no overlaps');
process.exit(failures ? 1 : 0);
