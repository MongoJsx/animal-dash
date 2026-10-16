// Dev autopilot (?bot): reads the obstacles ahead and swipes like a player.
// Used for automated play-testing and screenshots, not shipped gameplay.
import { laneX } from '../config.ts';
import type { Action } from '../core/input.ts';
import { answerFor, movingD, spansTrack, type Obstacle } from '../world/obstacles.ts';
import type { Track } from '../world/track.ts';
import type { Player } from './player.ts';

export function botActions(p: Player, track: Track, t: number): Action[] {
  const look = Math.max(10, p.speed * 0.9);
  const ahead = track.obstacles.filter((o) => {
    const d = o.kind === 'oncoming' || o.kind === 'rolling' ? movingD(o, t) : o.d;
    return d + o.length > p.d && d < p.d + look && !o.hit;
  });
  const inLane = (o: Obstacle, lane: number) => spansTrack(o.kind) || o.lane === lane;
  const need = (lane: number) => ahead.filter((o) => inLane(o, lane)).map((o) => ({ o, a: answerFor(o) }));
  const blocked = (lane: number) => need(lane).some(({ o, a }) => a === 'dodge' && !(o.kind === 'train' && o.ramp) && !spansTrack(o.kind));

  const lane = Math.round(p.x / laneX(1));
  if (blocked(lane)) {
    const free = [lane - 1, lane + 1].filter((l) => l >= -1 && l <= 1 && !blocked(l));
    if (free.length) return [free[0] < lane ? 'left' : 'right'];
  }
  for (const { o, a } of need(lane)) {
    const d = (o.kind === 'oncoming' || o.kind === 'rolling' ? movingD(o, t) : o.d) - p.d;
    if (a === 'jump' && d < p.speed * 0.28 && d > 0) return ['jump'];
    if (a === 'slide' && d < p.speed * 0.3 && d > 0) return ['slide'];
  }
  return [];
}
