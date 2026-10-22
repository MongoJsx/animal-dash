// Item boxes: placed from the seed in the gaps between obstacle rows (so every
// client gets the same boxes), and the item each one gives when run through.
import { BIOME_LENGTH, ITEM, LANE_COUNT, LANES, LANE_WIDTH, PLAYER, RACE_LENGTH, laneX } from '../config.ts';
import { Rng } from '../core/rng.ts';

export type ItemKind = 'boost' | 'shield' | 'ink' | 'spring' | 'rocket';
export const ITEM_KINDS: ItemKind[] = ['boost', 'shield', 'ink', 'spring', 'rocket'];

export const ITEM_ICON: Record<ItemKind, string> = { boost: '⚡', shield: '🛡️', ink: '🦑', spring: '🦘', rocket: '🚀' };
export const ITEM_NAME: Record<ItemKind, string> = { boost: 'บูสต์', shield: 'โล่', ink: 'หมึก', spring: 'สปริง', rocket: 'จรวด' };

/** Every runner can take every box once (a runner stuck behind the pack still gets items). */
export interface ItemBox {
  id: number;
  lane: number;
  d: number;
}

const MIN_GAP = 13; // only in gaps this long, so a box never sits in an obstacle row
const MIN_SPACING = 70; // between two lines of boxes
const GATE_CLEAR = 10;

/** Lines of boxes across the gaps between rows. Uses its own RNG: the obstacles stay as they were. */
export function placeItems(seed: number, rows: { d0: number; d1: number }[]): ItemBox[] {
  const rng = new Rng(seed ^ 0x2c1b3c6d);
  const out: ItemBox[] = [];
  let last = -Infinity;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].d1, b = rows[i].d0;
    if (b - a < MIN_GAP) continue;
    const d = (a + b) / 2;
    const gate = Math.round(d / BIOME_LENGTH) * BIOME_LENGTH;
    if (gate > 0 && gate < RACE_LENGTH && Math.abs(d - gate) < GATE_CLEAR) continue;
    if (d - last < MIN_SPACING || !rng.chance(0.55)) continue;
    last = d;
    const lanes = rng.chance(0.4) ? LANES : rng.shuffle([...LANES]).slice(0, LANE_COUNT - 1);
    for (const lane of lanes) out.push({ id: out.length, lane, d });
  }
  return out;
}

/** Is a runner at (x, y, d) touching this box? */
export function touches(box: ItemBox, x: number, y: number, d: number) {
  return Math.abs(x - laneX(box.lane)) < LANE_WIDTH * 0.45 &&
    Math.abs(d - box.d) < 0.9 &&
    y < ITEM.boxY + 0.5 && y + PLAYER.height > ITEM.boxY - 0.5;
}

/**
 * What a box gives. Runners further back get more boosts; ink only when
 * someone is ahead to splatter.
 * @param behind 0 = leading … 1 = last
 */
export function rollItem(r: number, behind: number, anyoneAhead: boolean, allowed: readonly ItemKind[] = ITEM_KINDS): ItemKind | null {
  const all: [ItemKind, number][] = [
    ['boost', 1 + 2 * behind],
    ['shield', 1.3 - 0.5 * behind],
    ['ink', anyoneAhead ? 0.5 + 1.5 * behind : 0],
    ['spring', 1.2],
    // The big one: mostly for whoever is falling behind.
    ['rocket', 0.15 + 0.85 * behind],
  ];
  // Only the items switched on for this race (none left to give: no item).
  const weights = all.filter(([k, w]) => allowed.includes(k) && w > 0);
  if (!weights.length) return null;
  let x = r * weights.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of weights) if ((x -= w) <= 0) return k;
  return weights[weights.length - 1][0];
}
