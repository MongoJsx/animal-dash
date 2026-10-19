// Runners are solid and never overlap.
// - A dashing runner bowls the other one aside and stuns them briefly.
// - Shoulder to shoulder, whoever was moving across barges the other one
//   over into the next lane; if there's no lane left that way (the edge of
//   the track, or they're dashing), the barger bounces back instead.
// - A runner clearly ahead who cuts across keeps the lane; the one behind
//   tucks in behind them.
// Racers without the bump methods (a friend online) are never moved here:
// their own client resolves their side (it sees our dash and stuns itself).
import { BODY, DASH, laneX } from '../config.ts';

export interface Body {
  x: number;
  y: number;
  d: number;
  speed: number;
  laneVelocity: number;
  finished: boolean;
  dashing?: boolean;
  sideBump?: (push: number) => void; // push: sideways correction out of the other body
  blockBehind?: (leaderD: number, leaderSpeed: number) => void;
  stun?: (time: number, push: number) => void;
  /** Barged one lane over in `dir` (push: metres to clear the barger now). */
  shoved?: (dir: -1 | 1, push: number) => void;
  /** This runner just barged someone aside. */
  barged?: () => void;
}

/** Can `b` be barged one lane over in `dir`? */
function canShove(b: Body, dir: -1 | 1) {
  if (b.dashing) return false;
  const lane = Math.round(b.x / laneX(1)) + dir;
  return lane >= -1 && lane <= 1;
}

export function resolveContacts(bodies: Body[]) {
  // Pushing one runner back can press it into the one behind: settle in passes.
  for (let pass = 0; pass < 3; pass++) resolvePass(bodies);
}

/** Sideways push that clears `victim` out of `other`, toward the open side of the track. */
function clearSide(victim: Body, other: Body) {
  let dir = Math.sign(victim.x - other.x);
  if (!dir) dir = victim.x > 0 ? -1 : 1;
  // Never shove anyone off the track: go the other way at the edge.
  if (Math.abs(victim.x + dir * BODY.width) > 2.5) dir = -dir;
  const target = other.x + dir * (BODY.width + 0.02);
  return target - victim.x;
}

function resolvePass(bodies: Body[]) {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      if (a.finished || b.finished) continue;
      if (Math.abs(a.x - b.x) >= BODY.width || Math.abs(a.d - b.d) >= BODY.depth || Math.abs(a.y - b.y) > 1.3) continue;

      if (!!a.dashing !== !!b.dashing) {
        const [dasher, victim] = a.dashing ? [a, b] : [b, a];
        const push = clearSide(victim, dasher);
        victim.stun?.(DASH.stun, push);
        continue;
      }

      const dd = a.d - b.d;
      const [lead, trail] = dd >= 0 ? [a, b] : [b, a];
      if (Math.abs(dd) < BODY.depth * 0.5) {
        // Truly side by side: the one moving across gives way.
        const [mover, other] = Math.abs(a.laneVelocity) >= Math.abs(b.laneVelocity) ? [a, b] : [b, a];
        if (Math.abs(mover.laneVelocity) > 0.5) {
          const dir = Math.sign(mover.laneVelocity) as -1 | 1;
          // Moving into them (not away): barge them over if there's room.
          // A friend online has no `shoved`: their own client moves them.
          if (Math.sign(other.x - mover.x) !== -dir && canShove(other, dir)) {
            other.shoved?.(dir, mover.x + dir * (BODY.width + 0.02) - other.x);
            mover.barged?.();
            continue;
          }
          if (mover.sideBump) {
            mover.sideBump(clearSide(mover, other));
            continue;
          }
        }
      }
      trail.blockBehind?.(lead.d, lead.speed);
    }
  }
}
