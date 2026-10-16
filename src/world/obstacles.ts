// Obstacle mechanics: where each kind is at race time t and what it collides with.
// Pure functions of (obstacle, t) so every client computes the same thing.
import { LANE_WIDTH, laneX } from '../config.ts';
import type { BiomeId } from './biomes.ts';
import { visualExtent } from './propFit.ts';

export type Kind =
  | 'lowbar' | 'highbar' | 'wall' | 'hay' | 'train' | 'oncoming' | 'rolling'
  | 'gap' | 'slow' | 'shifter' | 'pendulum' | 'spikes' | 'drop' | 'sweeper' | 'bounce';

/** How a player is expected to get past; drives rival AI and the tutorial hints. */
export type Answer = 'jump' | 'slide' | 'dodge' | 'any' | 'none';

export interface Obstacle {
  id: number;
  row: number; // index into Track.rows
  kind: Kind;
  lane: number; // -1..1; ignored by kinds that span the track
  d: number; // distance of the near edge
  length: number;
  biome: BiomeId;
  ramp: boolean; // train: has a ramp so it can be climbed
  phase: number; // 0..1 offset for timed kinds
  period: number; // seconds per cycle for timed kinds
  speed: number; // m/s for moving kinds
  // Runtime state for the local player only.
  hit: boolean;
  cleared: boolean;
  triggerT: number; // race time when a triggered kind started moving, -1 = not yet
}

export interface Box { x0: number; x1: number; y0: number; y1: number; d0: number; d1: number }
export interface Platform { x0: number; x1: number; d0: number; d1: number; top: number; ramp: number }

const HALF_LANE = LANE_WIDTH / 2 - 0.1;
export const TRAIN_TOP = 2.6;
export const TRAIN_RAMP = 7;
export const PENDULUM = { pivot: 6.2, arm: 5.2, amplitude: 0.85 };
export const SWEEPER = { half: 3.7, y0: 0.15, y1: 0.6 };
export const DROP = { warn: 1.5, fall: 0.55, height: 14 };
const TRIGGER: Partial<Record<Kind, number>> = { oncoming: 95, rolling: 70 };

export const spansTrack = (k: Kind) => k === 'gap' || k === 'shifter' || k === 'pendulum' || k === 'sweeper';
export const isHazard = (k: Kind) => k !== 'slow' && k !== 'bounce';

export function answerFor(o: Obstacle): Answer {
  switch (o.kind) {
    case 'lowbar': case 'hay': case 'rolling': case 'gap': case 'sweeper': case 'spikes': return 'jump';
    case 'highbar': return 'slide';
    case 'bounce': return 'none';
    case 'slow': return 'any';
    default: return 'dodge';
  }
}

const box = (x: number, halfW: number, y0: number, y1: number, d0: number, d1: number): Box =>
  ({ x0: x - halfW, x1: x + halfW, y0, y1, d0, d1 });

/** Start moving triggered kinds once the player gets close. */
export function trigger(o: Obstacle, t: number, playerD: number, speed: number) {
  if (o.triggerT >= 0) return;
  if (o.kind === 'drop') {
    if ((o.d - playerD) / Math.max(speed, 1) < DROP.warn + DROP.fall) o.triggerT = t;
    return;
  }
  const dist = TRIGGER[o.kind];
  if (dist !== undefined && o.d - playerD < dist) o.triggerT = t;
}

/** Near edge of a moving obstacle at time t. */
export const movingD = (o: Obstacle, t: number) =>
  o.triggerT < 0 ? o.d : o.d - o.speed * (t - o.triggerT);

export const shifterX = (o: Obstacle, t: number) =>
  Math.sin(Math.PI * 2 * (t / o.period + o.phase)) * LANE_WIDTH;

export const pendulumAngle = (o: Obstacle, t: number) =>
  Math.sin(Math.PI * 2 * (t / o.period + o.phase)) * PENDULUM.amplitude;

/** 0 = fully down, 1 = fully up. */
export function spikeLift(o: Obstacle, t: number) {
  const c = (((t / o.period + o.phase) % 1) + 1) % 1;
  if (c < 0.1) return c / 0.1;
  if (c < 0.5) return 1;
  if (c < 0.6) return 1 - (c - 0.5) / 0.1;
  return 0;
}

export const sweeperAngle = (o: Obstacle, t: number) => Math.PI * 2 * (t / o.period + o.phase);

/** 0 = still up in the sky (or not triggered), 1 = landed. */
export function dropProgress(o: Obstacle, t: number) {
  if (o.triggerT < 0) return 0;
  return Math.min(1, Math.max(0, (t - o.triggerT - DROP.warn) / DROP.fall));
}

/** Depth span of `depth` centred at `c` (never thinner than 0.2 m). */
const span = (c: number, depth: number): [number, number] => {
  const h = Math.max(0.2, depth) / 2;
  return [c - h, c + h];
};

/**
 * Solid boxes at time t. Kinds that only affect the floor return nothing.
 * When an obstacle is drawn with a Sketchfab model, its box shrinks to the
 * model's drawn size (see propFit.ts) so you only hit what you can see.
 */
export function hitBoxes(o: Obstacle, t: number, out: Box[]) {
  const x = laneX(o.lane);
  const d0 = o.d;
  const d1 = o.d + o.length;
  const mid = d0 + o.length / 2;
  const v = visualExtent(o);
  switch (o.kind) {
    case 'lowbar': {
      if (!v) { out.push(box(x, HALF_LANE, 0, 0.95, d0, d1)); break; }
      out.push(box(x, Math.min(HALF_LANE, v.w / 2), 0, Math.min(0.95, v.h), ...span(mid, v.d)));
      break;
    }
    case 'hay': {
      if (!v) { out.push(box(x, HALF_LANE * 0.9, 0, 1.15, d0, d1)); break; }
      out.push(box(x, Math.min(HALF_LANE * 0.9, v.w / 2), 0, Math.min(1.15, v.h), ...span(mid, v.d)));
      break;
    }
    case 'highbar': out.push(box(x, HALF_LANE, 1.05, 3.2, d0, d1)); break;
    case 'wall': {
      if (!v) { out.push(box(x, HALF_LANE, 0, 2.9, d0, d1)); break; }
      out.push(box(x, Math.min(HALF_LANE, v.w / 2), 0, Math.min(2.9, v.h), ...span(mid, v.d)));
      break;
    }
    case 'train': {
      const start = o.ramp ? d0 + TRAIN_RAMP : d0;
      out.push(box(x, HALF_LANE, 0, TRAIN_TOP - 0.05, start, d1));
      break;
    }
    case 'oncoming': {
      const m = movingD(o, t);
      if (!v) { out.push(box(x, HALF_LANE * 0.85, 0, 1.9, m, m + o.length)); break; }
      out.push(box(x, Math.min(HALF_LANE * 0.85, v.w / 2), 0, Math.min(1.9, v.h), ...span(m + o.length / 2, v.d)));
      break;
    }
    case 'rolling': {
      const m = movingD(o, t);
      if (!v) { out.push(box(x, 0.6, 0, 1.1, m, m + o.length)); break; }
      // It spins, so its reach is the larger of its height and depth.
      const diam = Math.min(1.1, Math.max(v.h, v.d));
      out.push(box(x, Math.min(0.6, v.w / 2), 0, diam, ...span(m + o.length / 2, diam)));
      break;
    }
    case 'shifter': {
      const sx = shifterX(o, t);
      if (!v) { out.push(box(sx, 0.75, 0, 2.0, d0, d1)); break; }
      // The model turns sideways to walk: its depth runs across the lanes.
      out.push(box(sx, Math.min(0.75, v.d / 2), 0, Math.min(2.0, v.h), ...span(mid, Math.min(o.length, v.w))));
      break;
    }
    case 'pendulum': {
      const a = pendulumAngle(o, t);
      const hx = Math.sin(a) * PENDULUM.arm;
      const hy = PENDULUM.pivot - Math.cos(a) * PENDULUM.arm;
      const rx = v ? Math.min(0.7, v.w / 2) : 0.7;
      const ry = v ? Math.min(0.7, v.h / 2) : 0.7;
      out.push(box(hx, rx, hy - ry, hy + ry, ...(v ? span(mid, Math.min(o.length, v.d)) : [d0, d1] as [number, number])));
      break;
    }
    case 'spikes': {
      const lift = spikeLift(o, t);
      const h = v ? Math.min(0.85, v.h) : 0.85;
      if (lift > 0.35) out.push(box(x, v ? Math.min(HALF_LANE, v.w / 2) : HALF_LANE, 0, h * lift, d0, d1));
      break;
    }
    case 'drop': {
      const p = dropProgress(o, t);
      const y = DROP.height * (1 - p);
      if (p > 0) {
        out.push(box(x, v ? Math.min(0.8, v.w / 2) : 0.8, y, y + (v ? Math.min(1.15, v.h) : 1.15),
          ...(v ? span(mid, Math.min(o.length, v.d)) : [d0, d1] as [number, number])));
      }
      break;
    }
    case 'sweeper': {
      // The bar rotates in the ground plane; approximate it with short boxes.
      const a = sweeperAngle(o, t);
      const cd = d0 + o.length / 2;
      const cy = (SWEEPER.y0 + SWEEPER.y1) / 2;
      const hh = v ? v.h / 2 : (SWEEPER.y1 - SWEEPER.y0) / 2;
      const thick = v ? Math.max(0.2, v.d / 2 + 0.1) : 0.45;
      for (let i = -3; i <= 3; i++) {
        const r = (i / 3) * SWEEPER.half;
        const bx = Math.cos(a) * r;
        const bd = cd + Math.sin(a) * r;
        out.push(box(bx, thick, cy - hh, cy + hh, bd - thick, bd + thick));
      }
      break;
    }
    default: break;
  }
}

export function platformOf(o: Obstacle): Platform | null {
  if (o.kind !== 'train') return null;
  const x = laneX(o.lane);
  return { x0: x - HALF_LANE, x1: x + HALF_LANE, d0: o.d, d1: o.d + o.length, top: TRAIN_TOP, ramp: o.ramp ? TRAIN_RAMP : 0 };
}

/** Floor height of a platform under (x, d), or -Infinity when not over it. */
export function platformHeight(p: Platform, x: number, d: number) {
  if (x < p.x0 || x > p.x1 || d < p.d0 || d > p.d1) return -Infinity;
  if (p.ramp > 0 && d < p.d0 + p.ramp) return p.top * ((d - p.d0) / p.ramp);
  return p.top;
}

/** True when (x, d) is over this obstacle's floor effect. */
export function onFloor(o: Obstacle, x: number, d: number) {
  if (d < o.d || d > o.d + o.length) return false;
  if (o.kind === 'gap') return true;
  return Math.abs(x - laneX(o.lane)) < LANE_WIDTH / 2;
}
