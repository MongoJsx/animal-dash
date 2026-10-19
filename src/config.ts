// Every gameplay tunable lives here. Distances in metres, times in seconds.

export const TICK = 1 / 60;

export const LANE_WIDTH = 2.3;
export const laneX = (lane: number) => lane * LANE_WIDTH;

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

export const RIVAL_COUNT = 3;

/** Starting blocks: four boxes across the three lanes, merged after the gun. */
/** Over the line: ease off quickly (≈12 m from full speed), still running. */
export const runOut = (speed: number, dt: number) => Math.max(0, speed - (6 + speed * 0.9) * dt);
/** Below this a runner past the line stops running and strikes a pose. */
export const STOP_SPEED = 3.5;

/** Extra speed out of the blocks (decays); the same for every runner. */
export const START_BOOST = 0.12;

export const START_SLOTS = [-2.55, -0.85, 0.85, 2.55];

/** Runners are solid to each other: body footprint for racer-vs-racer contact. */
export const BODY = { width: 0.72, depth: 0.62 };

/**
 * Dash: the meter fills as you run and fills a lot when you smash into
 * things. Full = press to blast forward at max Focus, smashing through
 * obstacles; runners you ram are stunned for a moment.
 */
export const DASH = { full: 100, perMeter: 0.3, perHit: 34, perBump: 8, time: 1.6, mul: 1.6, stun: 0.1 };
