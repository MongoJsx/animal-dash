// The friend's runner, rebuilt from their state packets. It keeps moving at
// the last known speed between packets and eases toward each new position,
// so 20 Hz updates still look smooth.
import type { RivalMove } from '../entities/rival.ts';
import type { NetMove } from './online.ts';

export class Remote {
  d = 0;
  x = 0;
  y = 0;
  speed = 0;
  laneVelocity = 0;
  finished = false;
  finishTime = 0;
  moves: RivalMove[] = [];
  private target: { d: number; x: number; y: number };

  constructor(x: number) {
    this.x = x;
    this.target = { d: 0, x, y: 0 };
  }

  receive(d: number, x: number, y: number, v: number) {
    this.target = { d, x, y };
    this.speed = v;
  }

  move(m: NetMove) {
    this.moves.push(m);
  }

  finish(time: number) {
    this.finished = true;
    this.finishTime = time;
  }

  step(dt: number) {
    const t = this.target;
    t.d += this.speed * dt;
    // Snap if far off (e.g. the tab was asleep), otherwise ease in.
    this.d = Math.abs(t.d - this.d) > 15 ? t.d : this.d + (t.d - this.d) * Math.min(1, dt * 8);
    const prevX = this.x;
    this.x += (t.x - this.x) * Math.min(1, dt * 15);
    this.y += (t.y - this.y) * Math.min(1, dt * 20);
    this.laneVelocity = (this.x - prevX) / dt;
  }
}
