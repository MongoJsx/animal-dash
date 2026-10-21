// Item boxes: placed the same for a seed, never inside an obstacle row, and in
// a simulated race runners pick them up and every item does its job.
// Usage: npx tsx tools/check-items.ts
import { ITEM, START_SLOTS, TICK } from '../src/config.ts';
import type { Action } from '../src/core/input.ts';
import { Player } from '../src/entities/player.ts';
import { Rival } from '../src/entities/rival.ts';
import { rollItem, touches, type ItemKind } from '../src/world/items.ts';
import { buildTrack } from '../src/world/track.ts';

let failures = 0;
const fail = (msg: string) => { failures++; console.log('FAIL', msg); };

// ── Placement ─────────────────────────────────────────────────────────
let boxes = 0;
for (let seed = 1; seed <= 300; seed++) {
  const map = (['thai', 'china', 'japan', 'fable'] as const)[seed % 4];
  const track = buildTrack(seed, map);
  if (JSON.stringify(track.items) !== JSON.stringify(buildTrack(seed, map).items)) fail(`seed ${seed}: items differ between builds`);
  if (track.items.length < 6) fail(`seed ${seed}: only ${track.items.length} boxes`);
  boxes += track.items.length;
  for (const b of track.items) {
    const row = track.rows.find((r) => b.d > r.d0 - 4 && b.d < r.d1 + 4);
    if (row) fail(`seed ${seed}: box at ${b.d.toFixed(1)} inside row ${row.d0.toFixed(1)}–${row.d1.toFixed(1)}`);
  }
}
console.log(`placement: ${boxes} boxes over 300 seeds (${(boxes / 300).toFixed(1)} per race)`);

// ── Rolls ─────────────────────────────────────────────────────────────
const leader: Record<string, number> = {}, last: Record<string, number> = {};
for (let i = 0; i < 4000; i++) {
  const a = rollItem(i / 4000, 0, false), b = rollItem(i / 4000, 1, true);
  leader[a] = (leader[a] ?? 0) + 1;
  last[b] = (last[b] ?? 0) + 1;
}
if (leader.ink) fail('the leader can roll ink with nobody ahead');
if ((last.boost ?? 0) <= (leader.boost ?? 0)) fail('last place should get more boosts than the leader');
console.log('rolls (leader):', leader, ' (last):', last);

// ── Race ──────────────────────────────────────────────────────────────
const used: Record<string, number> = {};
let pickups = 0, blocks = 0, springHits = 0, rivalUses = 0, rivalPickups = 0, flightStart = 0, rivalFlights = 0;
const flights: number[] = [];
for (let seed = 1; seed <= 40; seed++) {
  const track = buildTrack(seed, 'thai');
  const p = new Player();
  p.startSlot(START_SLOTS[0], -1);
  const rivals = [[1, 0], [2, 1], [3, 1]].map(([slot, lane], i) => new Rival(seed * 7 + i, { mistake: 0.3, pace: 1 }, START_SLOTS[slot], lane));
  p.launch();
  for (const r of rivals) r.launch();
  const order: ItemKind[] = ['boost', 'shield', 'ink', 'spring', 'rocket'];
  let t = 0;
  for (let step = 0; step < 60 * 200 && !p.finished; step++) {
    t += TICK;
    // A careless player: never dodges, so the shield and spring get tested for real.
    const actions: Action[] = p.itemReady ? ['item'] : [];
    const before = p.item;
    p.step(TICK, t, actions, track);
    for (const e of p.events) {
      if (e.type === 'item') used[e.item] = (used[e.item] ?? 0) + 1;
      if (e.type === 'item' && e.item === 'rocket') flightStart = t;
      if (e.type === 'shieldBlock') blocks++;
      if ((e.type === 'stumble' || e.type === 'sidehit' || e.type === 'fall') && (p.springing || p.flying)) springHits++;
      if (e.type === 'rocketEnd') flights.push(t - flightStart);
    }
    if (before && !p.item && p.events.every((e) => e.type !== 'item')) fail('item vanished without being used');
    p.events.length = 0;
    if (p.flying && t - flightStart > 1.5 && p.y < ITEM.flyHeight - 0.2) fail(`rocket sagging to ${p.y.toFixed(2)} m`);
    for (const r of rivals) {
      const had = r.item;
      r.step(TICK, track, p.d, [p, ...rivals.filter((o) => o !== r)]);
      if (had && !r.item) rivalUses++;
      if (had === 'rocket' && !r.item) rivalFlights++;
      r.fired.length = 0;
    }
    for (const s of [p, ...rivals]) {
      for (const box of track.items) {
        // Hand items out in turn so every kind gets exercised.
        if (s.took.has(box.id) || !touches(box, s.x, s.y, s.d) || !s.give(order[(pickups + rivalPickups) % 5])) continue;
        s.took.add(box.id);
        if (s === p) pickups++; else rivalPickups++;
      }
    }
    if (p.d > 2000) p.finish(t);
  }
  if (!p.finished) fail(`seed ${seed}: player never finished`);
}
if (springHits) fail(`${springHits} hits in mid-spring or mid-flight`);
if (!flights.length) fail('the rocket never flew');
for (const f of flights) if (Math.abs(f - 10) > 0.05) fail(`rocket flew ${f.toFixed(2)} s, expected 10`);
if (!rivalFlights) fail('rivals never flew a rocket');
for (const k of ['boost', 'shield', 'ink', 'spring', 'rocket']) if (!used[k]) fail(`player never used ${k}`);
if (!blocks) fail('the shield never blocked anything');
if (!rivalUses) fail('rivals never used an item');
console.log(`race: player picked ${pickups}, used`, used, `shield blocks ${blocks}; rivals picked ${rivalPickups}, used ${rivalUses}`);

// ── A player who never presses the item button ────────────────────────
// Every box they run through gives a fresh roll, replacing the one held.
{
  const track = buildTrack(3, 'thai');
  const p = new Player();
  p.startSlot(START_SLOTS[0], -1);
  p.launch();
  let t = 0, got = 0;
  for (let step = 0; step < 60 * 200 && !p.finished; step++) {
    t += TICK;
    p.step(TICK, t, [], track);
    p.events.length = 0;
    for (const box of track.items) {
      if (p.took.has(box.id) || !touches(box, p.x, p.y, p.d) || !p.give('boost')) continue;
      p.took.add(box.id);
      got++;
    }
    if (p.d > 2000) p.finish(t);
  }
  if (got < 2 || p.items.length !== 1) fail(`a player who never uses items holds ${p.items.length} after ${got} boxes, expected 1 (each box replacing the last)`);
  console.log(`never-using player: took ${got} boxes, holds ${p.items.length}`);
}

if (failures) {
  console.log(`${failures} failures`);
  process.exit(1);
}
console.log('all checks passed');
