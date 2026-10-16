// Builds the whole race track from a seed: rows of hand-designed patterns,
// with tier gating, cooldowns so nothing repeats back to back, and breathers.
import { BIOME_LENGTH, FINISH_CLEAR, RACE_LENGTH, START_CLEAR, baseSpeed } from '../config.ts';
import { Rng } from '../core/rng.ts';
import { biomeAt, pickBiomes, type BiomeId } from './biomes.ts';
import { platformOf, type Kind, type Obstacle, type Platform } from './obstacles.ts';

type Lane = -1 | 0 | 1;
const LANES: Lane[] = [-1, 0, 1];

interface Part {
  kind: Kind;
  lane?: Lane;
  at?: number; // offset from the row start
  length?: number;
  ramp?: boolean;
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

const others = (rng: Rng, n: number): Lane[] => rng.shuffle([...LANES]).slice(0, n) as Lane[];

const PATTERNS: Pattern[] = [
  // ── Tier 1: one clear read ───────────────────────────────────────────
  { id: 'jump-row', tier: 1, weight: 3, main: 'lowbar',
    build: () => LANES.map((lane) => ({ kind: 'lowbar', lane })) },
  { id: 'slide-row', tier: 1, weight: 3, main: 'highbar',
    build: () => LANES.map((lane) => ({ kind: 'highbar', lane })) },
  { id: 'two-walls', tier: 1, weight: 3, main: 'wall',
    build: (r) => others(r, 2).map((lane) => ({ kind: 'wall', lane, length: 1.6 })) },
  { id: 'mixed-row', tier: 1, weight: 3, main: 'wall',
    build: (r) => {
      const [a, b, c] = others(r, 3);
      return [{ kind: 'lowbar', lane: a }, { kind: 'highbar', lane: b }, { kind: 'wall', lane: c, length: 1.6 }];
    } },
  { id: 'hay-pair', tier: 1, weight: 2, main: 'hay',
    build: (r) => others(r, 2).map((lane) => ({ kind: 'hay', lane, length: 1.4 })) },
  { id: 'bounce-over', tier: 1, weight: 1.5, main: 'bounce',
    build: (r) => {
      const pad = r.pick(LANES);
      return [
        { kind: 'bounce', lane: pad, length: 1.5 },
        ...LANES.map((lane): Part => (lane === pad ? { kind: 'wall', lane, at: 9, length: 1.6 } : { kind: 'lowbar', lane, at: 9 })),
      ];
    } },

  // ── Tier 2: longer reads, movement, floor tricks ─────────────────────
  { id: 'train-ramp', tier: 2, weight: 3, main: 'train',
    build: (r) => {
      const [a, b, c] = others(r, 3);
      return [
        { kind: 'train', lane: a, length: 30, ramp: true },
        { kind: 'train', lane: b, length: 22, at: 4 },
        { kind: 'highbar', lane: c, at: 14 },
      ];
    } },
  { id: 'train-corridor', tier: 2, weight: 2, main: 'train',
    build: (r) => {
      const free = r.pick(LANES);
      const parts: Part[] = LANES.filter((l) => l !== free).map((lane) => ({ kind: 'train', lane, length: 26, ramp: r.chance(0.3) }));
      parts.push({ kind: 'lowbar', lane: free, at: 8 }, { kind: 'highbar', lane: free, at: 19 });
      return parts;
    } },
  { id: 'oncoming', tier: 2, weight: 2.5, main: 'oncoming',
    build: (r) => {
      const [a, b] = others(r, 2);
      return [{ kind: 'oncoming', lane: a, length: 3.2, speed: r.range(6, 9) }, { kind: 'hay', lane: b, at: 6, length: 1.4 }];
    } },
  { id: 'rolling-pair', tier: 2, weight: 2.5, main: 'rolling',
    build: (r) => {
      const [a, b] = others(r, 2);
      return [{ kind: 'rolling', lane: a, length: 1.2, speed: 5 }, { kind: 'rolling', lane: b, at: 12, length: 1.2, speed: 5 }];
    } },
  { id: 'gap', tier: 2, weight: 2, main: 'gap',
    build: (r) => [{ kind: 'gap', length: r.range(3.5, 5) }] },
  { id: 'slow-lanes', tier: 2, weight: 1.5, main: 'slow',
    build: (r) => {
      const [a, b, c] = others(r, 3);
      return [{ kind: 'slow', lane: a, length: 14 }, { kind: 'slow', lane: b, length: 14 }, { kind: 'lowbar', lane: c, at: 6 }];
    } },
  { id: 'zigzag', tier: 2, weight: 2, main: 'wall',
    build: (r) => {
      const free: Lane[] = r.chance(0.5) ? [-1, 0, 1] : [1, 0, -1];
      // The open lane steps across the track; each step needs exactly one lane change.
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
      return LANES.map((lane, i) => ({ kind: 'spikes', lane, length: 2.4, period: 2.2, phase: base + i / 3 }));
    } },
  { id: 'drops', tier: 3, weight: 2, main: 'drop',
    build: (r) => others(r, 2).map((lane, i) => ({ kind: 'drop', lane, at: i * 11, length: 1.6 })) },
  { id: 'sweeper', tier: 3, weight: 1.5, main: 'sweeper',
    build: (r) => [{ kind: 'sweeper', length: 7.4, period: r.range(2.2, 2.8), phase: r.next() }] },

  // ── Tier 4: combos ───────────────────────────────────────────────────
  { id: 'gap-then-slide', tier: 4, weight: 2, main: 'gap',
    build: () => [{ kind: 'gap', length: 4 }, ...LANES.map((lane): Part => ({ kind: 'highbar', lane, at: 14 }))] },
  { id: 'roof-run', tier: 4, weight: 2, main: 'train',
    build: (r) => {
      const ride = r.pick(LANES);
      return [
        ...LANES.map((lane): Part => ({ kind: 'train', lane, length: lane === ride ? 34 : 30, ramp: lane === ride, at: lane === ride ? 0 : 4 })),
        ...LANES.map((lane): Part => ({ kind: 'lowbar', lane, at: 40 })),
      ];
    } },
  { id: 'drop-shifter', tier: 4, weight: 1.5, main: 'shifter',
    build: (r) => [
      { kind: 'shifter', length: 1.4, period: 3, phase: r.next() },
      { kind: 'drop', lane: r.pick(LANES), at: 14, length: 1.6 },
    ] },
  { id: 'spikes-rolling', tier: 4, weight: 1.5, main: 'spikes',
    build: (r) => {
      const [a, b] = others(r, 2);
      return [
        { kind: 'rolling', lane: a, length: 1.2, speed: 6 },
        ...LANES.map((lane, i): Part => ({ kind: 'spikes', lane, at: 16, length: 2.4, period: 2.0, phase: i / 3 })),
        { kind: 'hay', lane: b, at: 4, length: 1.4 },
      ];
    } },
];

const tierAt = (d: number) => (d < 400 ? 1 : d < 1000 ? 2 : d < 1600 ? 3 : 4);
const COOLDOWN = 6;
const GATE_CLEAR = 14;

export interface Track {
  seed: number;
  biomes: BiomeId[];
  obstacles: Obstacle[]; // sorted by d
  platforms: Platform[];
  rows: { d0: number; d1: number }[]; // span of each pattern row
}

export function buildTrack(seed: number): Track {
  const rng = new Rng(seed);
  const biomes = pickBiomes(rng);
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
        biome: biomeAt(biomes, od), ramp: p.ramp ?? false, phase: p.phase ?? 0,
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
  const platforms = obstacles.map(platformOf).filter((p): p is Platform => p !== null);
  return { seed, biomes, obstacles, platforms, rows };
}
