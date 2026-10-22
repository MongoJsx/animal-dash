// The friend's runner, rebuilt from their state packets. It keeps moving at
// the last known speed between packets and eases toward each new position,
// so 20 Hz updates still look smooth. Each packet is moved on by its age on the
// shared clock, so the friend is drawn where they are now, not where they were
// when the packet left; and they leave the blocks on our gun, not a packet later.
import { DASH } from '../config.ts';
import type { RivalMove } from '../entities/rival.ts';
import type { ItemKind } from '../world/items.ts';
import type { NetMove } from './online.ts';

export class Remote {
  d = 0;
  x = 0;
  y = 0;
  speed = 0;
  laneVelocity = 0;
  finished = false;
  finishTime = 0;
  /** Their character's strength, for who wins a barge. */
  strength = 3;
  halted = false;
  moves: RivalMove[] = [];
  /** Their shield bubble, for drawing. */
  shield = false;
  /** Flying on a rocket, for drawing. */
  rocket = false;
  /** The item they're holding, for the icon over their head. */
  item: ItemKind | null = null;
  private dashT = 0;
  /** Out of the blocks (on our own gun, or their first word that they are). */
  launched = false;
  /** Launched on our gun but not heard from since: the game runs them like the player. */
  predicting = false;

  get dashing() {
    return this.dashT > 0;
  }
  private target: { d: number; x: number; y: number };

  constructor(x: number) {
    this.x = x;
    this.target = { d: 0, x, y: 0 };
  }

  /** @param since metres they have run since sending it */
  receive(d: number, x: number, y: number, v: number, since = 0) {
    // Sent from the blocks before their gun, landing after ours: they've left by now.
    if (this.predicting && d <= 0.05) return;
    this.target = { d: d + since, x, y };
    this.speed = v;
    if (d > 0.05) {
      this.launched = true;
      this.predicting = false;
    }
  }

  /**
   * The gun fired here, so it fired there too: run them off the line now
   * (the game paces them like the player), rather than standing still until
   * their first packet arrives.
   */
  launch() {
    if (this.launched) return;
    this.launched = true;
    this.predicting = true;
    this.moves.push('launch');
  }

  move(m: NetMove) {
    if (m === 'launch') {
      if (this.launched) return;
      this.launched = true;
    }
    this.moves.push(m);
    if (m === 'dash') this.dashT = DASH.time;
  }

  finish(time: number) {
    this.finished = true;
    this.finishTime = time;
  }

  step(dt: number) {
    this.dashT = Math.max(0, this.dashT - dt);
    const t = this.target;
    t.d += this.speed * dt;
    // Run on at their speed and ease out only the error: easing toward a moving
    // target would always trail it. Snap if far off (e.g. the tab was asleep).
    this.d += this.speed * dt;
    this.d = Math.abs(t.d - this.d) > 15 ? t.d : this.d + (t.d - this.d) * Math.min(1, dt * 8);
    const prevX = this.x;
    this.x += (t.x - this.x) * Math.min(1, dt * 15);
    this.y += (t.y - this.y) * Math.min(1, dt * 20);
    this.laneVelocity = (this.x - prevX) / dt;
  }
}
