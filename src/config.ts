// Every gameplay tunable lives here. Distances in metres, times in seconds.

export const TICK = 1 / 60;

export const LANE_WIDTH = 2.3;
export const laneX = (lane: number) => lane * LANE_WIDTH;

/**
 * Lanes: 3, 5 or 7, chosen before a race (one runner per lane). Lane numbers are
 * centred on the middle of the track and step by 1, so with an even count
 * they sit on halves (4 lanes: -1.5, -0.5, 0.5, 1.5). These are live bindings:
 * read them where they're used, never copy them into a module constant.
 */
export const LANE_CHOICES = [3, 5, 7] as const;
/** The lane choice nearest `n` (a count saved before the choices changed). */
export const fitLanes = (n: number | undefined) =>
  LANE_CHOICES.reduce<number>((a, b) => (Math.abs(b - (n ?? 3)) < Math.abs(a - (n ?? 3)) ? b : a), LANE_CHOICES[0]);
export let LANE_COUNT = 3;
export let LANE_MIN = -1;
export let LANE_MAX = 1;
export let LANES: number[] = [-1, 0, 1];
/** Half the paved width, kerb to kerb. */
export let TRACK_HALF = LANE_WIDTH * 1.5 + 0.3;

export function setLaneCount(n: number) {
  LANE_COUNT = Math.max(3, Math.min(7, Math.round(n) || 3));
  LANE_MAX = (LANE_COUNT - 1) / 2;
  LANE_MIN = -LANE_MAX;
  LANES = Array.from({ length: LANE_COUNT }, (_, i) => LANE_MIN + i);
  TRACK_HALF = LANE_WIDTH * LANE_COUNT / 2 + 0.3;
}

/** 0 with an odd lane count, 0.5 with an even one. */
const laneOffset = () => LANE_MAX % 1;
export const clampLane = (lane: number) => Math.max(LANE_MIN, Math.min(LANE_MAX, lane));
/** The lane whose centre is nearest `x`. */
export const nearestLane = (x: number) => clampLane(Math.round(x / LANE_WIDTH - laneOffset()) + laneOffset());
/** Where a body at lane position `f` (fractional) settles when pushed toward `dir`. */
export const laneAfterPush = (f: number, dir: number) =>
  clampLane((dir > 0 ? Math.ceil(f - laneOffset() - 0.25) : Math.floor(f - laneOffset() + 0.25)) + laneOffset());
/** Array index of a lane (0 = leftmost). */
export const laneIndex = (lane: number) => Math.round(lane - LANE_MIN);
/** x of the painted lines between lanes. */
export const laneDividers = () => LANES.slice(1).map((l) => laneX(l - 0.5));

export const RACE_LENGTH = 2000;
export const BIOME_LENGTH = 500;
export const START_CLEAR = 70; // empty run-up before the first obstacle
export const FINISH_CLEAR = 60; // empty stretch before the finish line
export const VIEW_AHEAD = 190; // ≈ 8.5 s of warning at top speed; fog hides the edge
export const VIEW_BEHIND = 20;

export const SPEED = { start: 14, end: 22 };
export const baseSpeed = (d: number) =>
  SPEED.start + (SPEED.end - SPEED.start) * Math.min(1, Math.max(0, d / RACE_LENGTH));

export const FOCUS = { max: 10, bonusPerLevel: 0.03, sideHitLoss: 3 };

export const PENALTY = {
  stumble: { speed: 0.35, recover: 1.2, invulnerable: 1.0 },
  sideHit: { speed: 0.75, recover: 0.6 },
  fall: { speed: 0.3, recover: 1.0, duration: 0.8 },
  slowFloor: 0.6,
};

export const PLAYER = {
  width: 0.7,
  height: 1.7,
  slideHeight: 0.75,
  depth: 0.5,
  laneChangeTime: 0.15,
  jumpVelocity: 12.5, // apex ≈ 2.05 m, airtime ≈ 0.66 s
  bounceVelocity: 18, // bounce pad: apex ≈ 4.3 m
  fastFallVelocity: -26,
  gravity: 38,
  slideTime: 0.65,
  inputBuffer: 0.15,
  stepUp: 0.4,
};

/** Over the line: ease off quickly (≈12 m from full speed), still running. */
export const runOut = (speed: number, dt: number) => Math.max(0, speed - (6 + speed * 0.9) * dt);
/** Below this a runner past the line stops running and strikes a pose. */
export const STOP_SPEED = 3.5;

/** Extra speed out of the blocks (decays); the same for every runner. */
export const START_BOOST = 0.12;

/** Starting blocks: one box per lane, on the lane. */
export const startSlots = () => LANES.map(laneX);

/** Runners are solid to each other: body footprint for racer-vs-racer contact. */
export const BODY = { width: 0.72, depth: 0.62 };

/**
 * Dash: the meter fills as you run and fills a lot when you smash into
 * things. Full = press to blast forward at max Focus, smashing through
 * obstacles; runners you ram are stunned for a moment.
 */
export const DASH = { full: 100, perMeter: 0.3, perHit: 34, perBump: 8, time: 1.6, mul: 1.6, stun: 0.1 };

/**
 * Item boxes between obstacle rows: run through one to get a random item
 * (one held at a time, shown over the runner's head), press to use it.
 * - boost: faster for a while and +3 Focus, smashing through whatever it hits
 * - shield: 5 s of protection from everything (obstacles, falls, rams, ink)
 * - ink: splatters everyone ahead (blinds the player, makes AI fumble)
 * - spring: 5 s of huge jumps that clear whatever is ahead
 * - rocket: fly above everything for 10 s, then drop back down and run on
 */
export const ITEM = {
  roll: 0.6, // item slot spins this long before it can be used
  boxY: 1.15, // box centre height
  boostMul: 1.35,
  boostTime: 2.2,
  boostFocus: 3, // Focus levels a boost adds on the spot
  shieldTime: 5,
  springTime: 5, // every jump in this window is a spring jump
  inkTime: 3.2,
  springVelocity: 19, // apex ≈ 4.75 m, airtime ≈ 1 s
  flyTime: 10, // rocket: seconds in the air above every obstacle
  flyHeight: 4.6, // clears bars, walls and swinging pendulums
  rocketMul: 1.15,
};

/**
 * Runner stats, 1..5 each (3 = average); every character spends 12 points.
 * - speed: top speed
 * - accel: Focus builds a little faster per clean row
 * - strength: wins shoulder-to-shoulder barges (and gives less ground when pressed)
 * - stamina: loses less Focus when it runs into something
 */
export interface Stats { speed: number; accel: number; strength: number; stamina: number }
export const BASE_STATS: Stats = { speed: 3, accel: 3, strength: 3, stamina: 3 };
/** Speed multiplier: 0.97 at 1, 1.03 at 5. */
export const statPace = (s: Stats) => 1 + (s.speed - 3) * 0.015;
/** Focus gained per clean row: 0.8 at 1, 1.2 at 5. */
export const statFocusGain = (s: Stats) => 1 + (s.accel - 3) * 0.1;
/** Share of Focus kept through a stumble or fall: 0 at 1, half at 5. */
export const statFocusKeep = (s: Stats) => (s.stamina - 1) * 0.125;
/** Focus lost to a side hit: 4 at 1, 3 at 3, 2 at 5. */
export const statSideLoss = (s: Stats) => Math.round(FOCUS.sideHitLoss - (s.stamina - 3) * 0.5);
