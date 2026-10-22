// Runners are solid and never overlap.
// - A dashing runner bowls the other one aside and stuns them briefly.
// - Shoulder to shoulder, whoever was moving across barges the other one
//   over into the next lane, if they're at least as strong; a stronger runner
//   stands firm and the one cutting in bounces back instead (as it does at
//   the edge of the track, or against a dasher).
// - A runner clearly ahead who cuts across keeps the lane; the one behind
//   tucks in behind them.
// - Whatever is still overlapping after that (a shield took the ram, a runner
//   past the line, a friend online) is pushed apart, the stronger one giving
//   less ground.
// Racers without the bump methods (a friend online) are never moved here:
// their own client resolves their side (it sees our dash and stuns itself).
import { BODY, DASH, LANE_MAX, LANE_MIN, laneX, nearestLane } from '../config.ts';

export interface Body {
  x: number;
  y: number;
  d: number;
  speed: number;
  laneVelocity: number;
  finished: boolean;
  /** 1..5: who wins a barge, and who gives less ground when pressed. */
  strength: number;
  dashing?: boolean;
  sideBump?: (push: number) => void; // push: sideways correction out of the other body
  blockBehind?: (leaderD: number, leaderSpeed: number) => void;
  stun?: (time: number, push: number) => void;
  /** Barged one lane over in `dir` (push: metres to clear the barger now). */
  shoved?: (dir: -1 | 1, push: number) => void;
  /** This runner just barged someone aside. */
  barged?: () => void;
  /** Moved out of someone by (dx, dd) metres. */
  nudge?: (dx: number, dd: number) => void;
}

/** Furthest a body may be pushed from the middle of the track. */
const edge = () => laneX(LANE_MAX) + 0.3;

/** Can `b` be barged one lane over in `dir`? */
function canShove(b: Body, dir: -1 | 1) {
  if (b.dashing) return false;
  const lane = nearestLane(b.x) + dir;
  return lane >= LANE_MIN && lane <= LANE_MAX;
}

const touching = (a: Body, b: Body) =>
  Math.abs(a.x - b.x) < BODY.width && Math.abs(a.d - b.d) < BODY.depth && Math.abs(a.y - b.y) <= 1.3;

export function resolveContacts(bodies: Body[]) {
  // Pushing one runner back can press it into the one behind: settle in passes.
  for (let pass = 0; pass < 3; pass++) resolvePass(bodies);
  // A shove in a crowd can land someone on a third runner: finish with plain
  // pushing apart, which only ever moves bodies out of each other.
  for (let pass = 0; pass < 10; pass++) {
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) separate(bodies[i], bodies[j]);
  }
}

/** Sideways push that clears `victim` out of `other`, toward the open side of the track. */
function clearSide(victim: Body, other: Body) {
  let dir = Math.sign(victim.x - other.x);
  if (!dir) dir = victim.x > 0 ? -1 : 1;
  // Never shove anyone off the track: go the other way at the edge.
  if (Math.abs(victim.x + dir * BODY.width) > edge() - 0.1) dir = -dir;
  const target = other.x + dir * (BODY.width + 0.02);
  return target - victim.x;
}

/**
 * Push two overlapping bodies apart the short way: across if there's room on
 * the track, otherwise the one behind drops back. The stronger one moves less.
 */
function separate(a: Body, b: Body) {
  if (!touching(a, b) || (!a.nudge && !b.nudge)) return;
  const dx = a.x - b.x;
  const penX = BODY.width - Math.abs(dx);
  const penD = BODY.depth - Math.abs(a.d - b.d);
  if (penX < penD) {
    // Share of the push `a` takes: all of it against someone we can't move.
    const share = !b.nudge ? 1 : !a.nudge ? 0 : b.strength / (a.strength + b.strength);
    const dir = Math.sign(dx) || (a.x > 0 ? -1 : 1);
    const push = penX + 0.01;
    const ax = Math.max(-edge(), Math.min(edge(), a.x + dir * push * share));
    const bx = Math.max(-edge(), Math.min(edge(), b.x - dir * push * (1 - share)));
    if (Math.abs(ax - bx) >= BODY.width) {
      a.nudge?.(ax - a.x, 0);
      b.nudge?.(bx - b.x, 0);
      return;
    }
  }
  const [lead, trail] = a.d >= b.d ? [a, b] : [b, a];
  const back = BODY.depth - (lead.d - trail.d) + 0.01;
  if (trail.nudge) trail.nudge(0, -back);
  else lead.nudge!(0, back);
}

function resolvePass(bodies: Body[]) {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      if (!touching(a, b)) continue;
      // Past the line nobody barges anyone: just don't stand inside each other.
      if (a.finished || b.finished) { separate(a, b); continue; }

      if (!!a.dashing !== !!b.dashing) {
        const [dasher, victim] = a.dashing ? [a, b] : [b, a];
        victim.stun?.(DASH.stun, clearSide(victim, dasher));
        separate(a, b);
        continue;
      }

      const dd = a.d - b.d;
      const [lead, trail] = dd >= 0 ? [a, b] : [b, a];
      if (Math.abs(dd) < BODY.depth * 0.5) {
        // Truly side by side: the one moving across gives way.
        const [mover, other] = Math.abs(a.laneVelocity) >= Math.abs(b.laneVelocity) ? [a, b] : [b, a];
        if (Math.abs(mover.laneVelocity) > 0.5) {
          const dir = Math.sign(mover.laneVelocity) as -1 | 1;
          // Moving into them (not away): barge them over if there's room and
          // they aren't the stronger one. A friend online has no `shoved`:
          // their own client moves them.
          if (Math.sign(other.x - mover.x) !== -dir && canShove(other, dir) && mover.strength >= other.strength) {
            other.shoved?.(dir, mover.x + dir * (BODY.width + 0.02) - other.x);
            mover.barged?.();
            separate(a, b);
            continue;
          }
          if (mover.sideBump) {
            mover.sideBump(clearSide(mover, other));
            separate(a, b);
            continue;
          }
        }
      }
      trail.blockBehind?.(lead.d, lead.speed);
      separate(a, b);
    }
  }
}
