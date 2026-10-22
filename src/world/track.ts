// Builds the whole race track from a seed: rows of hand-designed patterns,
// with tier gating, cooldowns so nothing repeats back to back, and breathers.
import { BIOME_LENGTH, FINISH_CLEAR, LANE_COUNT, LANES, RACE_LENGTH, START_CLEAR, baseSpeed } from '../config.ts';
import { Rng } from '../core/rng.ts';
import { biomeAt, pickBiomes, type BiomeId, type MapId } from './biomes.ts';
import { placeItems, type ItemBox } from './items.ts';
import type { Kind, Obstacle } from './obstacles.ts';

type Lane = number;

interface Part {
  kind: Kind;
  lane?: Lane;
  at?: number; // offset from the row start
  length?: number;
  phase?: number;
  period?: number;
  speed?: number;
}

interface Pattern {
  id: string;
  tier: number;
  weight: number;
  main: Kind; // used for the "no more than two in a row" rule
  build(rng: Rng): Part[];
}

// Patterns are written for any lane count (LANES is read when a row is built):
// "all but one" blocks every lane but one, and rows that put a few hazards
// down add one more for each lane past three, so a wider track isn't easier.
const others = (rng: Rng, n: number): Lane[] => rng.shuffle([...LANES]).slice(0, Math.min(n, LANE_COUNT));
const extra = () => LANE_COUNT - 3;
const allButOne = () => LANE_COUNT - 1;

const PATTERNS: Pattern[] = [
  // ── Tier 1: one clear read ───────────────────────────────────────────
  { id: 'jump-row', tier: 1, weight: 3, main: 'lowbar',
    build: () => LANES.map((lane) => ({ kind: 'lowbar', lane })) },
  { id: 'slide-row', tier: 1, weight: 3, main: 'highbar',
    build: () => LANES.map((lane) => ({ kind: 'highbar', lane })) },
  { id: 'two-walls', tier: 1, weight: 3, main: 'wall',
    build: (r) => others(r, allButOne()).map((lane) => ({ kind: 'wall', lane, length: 1.6 })) },
  { id: 'mixed-row', tier: 1, weight: 3, main: 'wall',
    build: (r) => others(r, LANE_COUNT).map((lane, i): Part => {
      const kind: Kind = i === 0 ? 'lowbar' : i === 1 ? 'highbar' : i === 2 ? 'wall' : r.pick<Kind>(['lowbar', 'highbar', 'wall']);
      return { kind, lane, length: kind === 'wall' ? 1.6 : undefined };
    }) },
  { id: 'hay-pair', tier: 1, weight: 2, main: 'hay',
    build: (r) => others(r, allButOne()).map((lane) => ({ kind: 'hay', lane, length: 1.4 })) },
  { id: 'bounce-over', tier: 1, weight: 1.5, main: 'bounce',
    build: (r) => {
      const pad = r.pick(LANES);
      return [
        { kind: 'bounce', lane: pad, length: 1.5 },
        ...LANES.map((lane): Part => (lane === pad ? { kind: 'wall', lane, at: 9, length: 1.6 } : { kind: 'lowbar', lane, at: 9 })),
      ];
    } },

  // ── Tier 2: longer reads, movement, floor tricks ─────────────────────
  { id: 'market-alley', tier: 2, weight: 3, main: 'wall',
    build: (r) => {
      // Weave through stalls (one gap, then another), then duck under a banner across the street.
      const [a, b, c, ...rest] = others(r, LANE_COUNT);
      return [
        { kind: 'wall', lane: a, length: 1.6 }, { kind: 'hay', lane: b, length: 1.4 },
        ...rest.map((lane): Part => ({ kind: r.chance(0.5) ? 'wall' : 'hay', lane, length: 1.5 })),
        { kind: 'wall', lane: c, at: 11, length: 1.6 }, { kind: 'lowbar', lane: a, at: 11 },
        ...rest.map((lane): Part => ({ kind: 'wall', lane, at: 11, length: 1.6 })),
        ...LANES.map((lane): Part => ({ kind: 'highbar', lane, at: 22 })),
      ];
    } },
  { id: 'stampede', tier: 2, weight: 2, main: 'oncoming',
    build: (r) => others(r, 2 + extra()).map((lane, i) => ({ kind: 'oncoming', lane, at: (i % 2) * 14, length: 3.2, speed: r.range(6, 8) })) },
  { id: 'oncoming', tier: 2, weight: 2.5, main: 'oncoming',
    build: (r) => {
      const [a, ...hay] = others(r, 2 + extra());
      return [{ kind: 'oncoming', lane: a, length: 3.2, speed: r.range(6, 9) }, ...hay.map((lane): Part => ({ kind: 'hay', lane, at: 6, length: 1.4 }))];
    } },
  { id: 'rolling-pair', tier: 2, weight: 2.5, main: 'rolling',
    build: (r) => others(r, 2 + extra()).map((lane, i) => ({ kind: 'rolling', lane, at: (i % 2) * 12, length: 1.2, speed: 5 })) },
  { id: 'slow-lanes', tier: 2, weight: 1.5, main: 'slow',
    build: (r) => {
      const lanes = others(r, LANE_COUNT);
      const open = lanes.pop()!;
      return [...lanes.map((lane): Part => ({ kind: 'slow', lane, length: 14 })), { kind: 'lowbar', lane: open, at: 6 }];
    } },
  { id: 'zigzag', tier: 2, weight: 2, main: 'wall',
    build: (r) => {
      // The open lane steps across three neighbouring lanes; each step needs exactly one lane change.
      const from = r.int(0, LANE_COUNT - 3);
      const path = LANES.slice(from, from + 3);
      const free = r.chance(0.5) ? path : path.reverse();
      return free.flatMap((open, i) => LANES.filter((l) => l !== open)
        .map((lane): Part => ({ kind: 'wall', lane, at: i * 13, length: 1.6 })));
    } },

  // ── Tier 3: timing ───────────────────────────────────────────────────
  { id: 'shifter', tier: 3, weight: 2, main: 'shifter',
    build: (r) => [{ kind: 'shifter', length: 1.4, period: r.range(2.6, 3.4), phase: r.next() }] },
  { id: 'pendulums', tier: 3, weight: 2, main: 'pendulum',
    build: (r) => {
      const phase = r.next();
      return [{ kind: 'pendulum', length: 1.4, period: 2.4, phase }, { kind: 'pendulum', at: 14, length: 1.4, period: 2.4, phase: phase + 0.5 }];
    } },
  { id: 'spike-field', tier: 3, weight: 2, main: 'spikes',
    build: (r) => {
      const base = r.next();
      return LANES.map((lane, i) => ({ kind: 'spikes', lane, length: 2.4, period: 2.2, phase: base + i / LANE_COUNT }));
    } },
  { id: 'drops', tier: 3, weight: 2, main: 'drop',
    build: (r) => others(r, 2 + extra()).map((lane, i) => ({ kind: 'drop', lane, at: (i % 2) * 11, length: 1.6 })) },
  { id: 'sweeper', tier: 3, weight: 1.5, main: 'sweeper',
    build: (r) => [{ kind: 'sweeper', length: 7.4, period: r.range(2.2, 2.8), phase: r.next() }] },

  // ── Tier 4: combos ───────────────────────────────────────────────────
  // No pits across the track: on dark ground they read as two odd lines, not a hole.
  { id: 'jump-then-slide', tier: 4, weight: 2, main: 'lowbar',
    build: () => [...LANES.map((lane): Part => ({ kind: 'lowbar', lane })), ...LANES.map((lane): Part => ({ kind: 'highbar', lane, at: 14 }))] },
  { id: 'gauntlet', tier: 4, weight: 2, main: 'wall',
    build: (r) => {
      const [a, b, ...walls] = others(r, 2 + extra());
      return [
        { kind: 'wall', lane: a, length: 1.6 }, { kind: 'oncoming', lane: b, length: 3.2, speed: 7 },
        ...walls.map((lane): Part => ({ kind: 'wall', lane, length: 1.6 })),
        ...LANES.map((lane): Part => ({ kind: 'lowbar', lane, at: 16 })),
        ...LANES.map((lane): Part => ({ kind: 'highbar', lane, at: 27 })),
      ];
    } },
  { id: 'drop-shifter', tier: 4, weight: 1.5, main: 'shifter',
    build: (r) => [
      { kind: 'shifter', length: 1.4, period: 3, phase: r.next() },
      { kind: 'drop', lane: r.pick(LANES), at: 14, length: 1.6 },
    ] },
  { id: 'spikes-rolling', tier: 4, weight: 1.5, main: 'spikes',
    build: (r) => {
      const [a, ...hay] = others(r, 2 + extra());
      return [
        { kind: 'rolling', lane: a, length: 1.2, speed: 6 },
        ...LANES.map((lane, i): Part => ({ kind: 'spikes', lane, at: 16, length: 2.4, period: 2.0, phase: i / LANE_COUNT })),
        ...hay.map((lane): Part => ({ kind: 'hay', lane, at: 4, length: 1.4 })),
      ];
    } },
];

const tierAt = (d: number) => (d < 400 ? 1 : d < 1000 ? 2 : d < 1600 ? 3 : 4);
const COOLDOWN = 6;
const GATE_CLEAR = 14;

export interface Track {
  seed: number;
  lanes: number; // lane count it was built for
  map: MapId;
  biomes: BiomeId[];
  obstacles: Obstacle[]; // sorted by d
  rows: { d0: number; d1: number }[]; // span of each pattern row
  items: ItemBox[]; // sorted by d
}

export function buildTrack(seed: number, map: MapId = 'fable'): Track {
  const rng = new Rng(seed);
  const biomes = pickBiomes(rng, map);
  const obstacles: Obstacle[] = [];
  const rows: { d0: number; d1: number }[] = [];
  const recent: string[] = [];
  const recentMain: Kind[] = [];
  let id = 0;
  let d = START_CLEAR;
  let sinceBreather = 0;
  let breatherAt = rng.int(5, 7);

  while (d < RACE_LENGTH - FINISH_CLEAR) {
    const tier = tierAt(d);
    const lastMain = recentMain.slice(-2);
    const allowed = PATTERNS.filter((p) => p.tier <= tier);
    // Early tiers have few patterns: only remember as many as leaves a choice.
    const memory = recent.slice(-Math.min(COOLDOWN, allowed.length - 2));
    const pool = allowed.filter((p) =>
      !memory.includes(p.id) &&
      !(lastMain.length === 2 && lastMain.every((m) => m === p.main)));
    // Favour the current tier so difficulty actually rises.
    const choices = pool.length ? pool : allowed.filter((p) => !memory.includes(p.id));
    const pattern = rng.weighted(choices, (p) => p.weight * (p.tier === tier ? 2 : 1));
    const parts = pattern.build(rng);
    const length = Math.max(...parts.map((p) => (p.at ?? 0) + (p.length ?? 0.6)));

    // Keep biome gates clear.
    const gate = Math.ceil(d / BIOME_LENGTH) * BIOME_LENGTH;
    if (gate < RACE_LENGTH && d + length > gate - GATE_CLEAR && d < gate + GATE_CLEAR) {
      d = gate + GATE_CLEAR;
      continue;
    }
    if (d + length > RACE_LENGTH - FINISH_CLEAR) break;

    for (const p of parts) {
      const od = d + (p.at ?? 0);
      obstacles.push({
        id: id++, row: rows.length, kind: p.kind, lane: p.lane ?? 0, d: od, length: p.length ?? 0.6,
        biome: biomeAt(biomes, od), phase: p.phase ?? 0,
        period: p.period ?? 1, speed: p.speed ?? 0, hit: false, cleared: false, triggerT: -1,
      });
    }
    rows.push({ d0: d, d1: d + length });
    recent.push(pattern.id);
    if (recent.length > COOLDOWN) recent.shift();
    recentMain.push(pattern.main);

    // Reaction space scales with the speed the player will have here.
    const speed = baseSpeed(d) * 1.15;
    d += length + speed * 0.75 + rng.range(2, 9) + (tier >= 3 ? 4 : 0);
    if (++sinceBreather >= breatherAt) {
      d += 24;
      sinceBreather = 0;
      breatherAt = rng.int(5, 7);
    }
  }

  obstacles.sort((a, b) => a.d - b.d);
  return { seed, map, lanes: LANE_COUNT, biomes, obstacles, rows, items: placeItems(seed, rows) };
}
