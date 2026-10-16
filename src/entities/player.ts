// Player simulation: auto-run, lane changes, jump/slide, collisions that cost
// speed instead of lives, and the Focus streak. Pure logic, no rendering.
import { FOCUS, PENALTY, PLAYER, baseSpeed, laneX } from '../config.ts';
import type { Action } from '../core/input.ts';
import {
  TRAIN_TOP, hitBoxes, isHazard, onFloor, platformHeight, trigger, type Box, type Obstacle,
} from '../world/obstacles.ts';
import type { Track } from '../world/track.ts';

export type PlayerEvent =
  | { type: 'jump'; airTime: number }
  | { type: 'bounce'; airTime: number }
  | { type: 'slide' }
  | { type: 'land' }
  | { type: 'lane'; dir: -1 | 1 }
  | { type: 'stumble'; obstacle: Obstacle }
  | { type: 'sidehit' }
  | { type: 'fall' }
  | { type: 'focus'; level: number }
  | { type: 'finish' };

const smooth = (t: number) => t * t * (3 - 2 * t);
const boxes: Box[] = [];

export class Player {
  d = 0;
  x = 0;
  y = 0;
  vy = 0;
  lane = 0;
  private laneFrom = 0;
  private laneT = 1;
  laneVelocity = 0;
  grounded = true;
  slideT = 0;
  speed = 0;
  private speedMul = 1;
  private recoverRate = 1;
  private invulnT = 0;
  fallT = 0;
  focus = 0;
  finished = false;
  finishTime = 0;
  private buffer: { a: Action; t: number }[] = [];
  private nextRow = 0;
  private dirtyRows = new Set<number>();
  private nearIndex = 0;
  events: PlayerEvent[] = [];

  get sliding() {
    return this.slideT > 0;
  }

  get stunned() {
    return this.fallT > 0;
  }

  get height() {
    return this.sliding ? PLAYER.slideHeight : PLAYER.height;
  }

  private emit(e: PlayerEvent) {
    this.events.push(e);
  }

  private airTime(v: number) {
    return (2 * v) / PLAYER.gravity;
  }

  /** Place on a lane before the start (online races start side by side). */
  startLane(lane: number) {
    this.lane = this.laneFrom = lane;
    this.x = laneX(lane);
  }

  private changeLane(dir: -1 | 1) {
    const target = this.lane + dir;
    if (target < -1 || target > 1) return;
    this.laneFrom = this.currentLaneFloat();
    this.lane = target;
    this.laneT = 0;
    this.emit({ type: 'lane', dir });
  }

  private currentLaneFloat() {
    return this.x / laneX(1);
  }

  private jump(v: number, type: 'jump' | 'bounce') {
    this.vy = v;
    this.grounded = false;
    this.slideT = 0;
    this.emit({ type, airTime: this.airTime(v) });
  }

  /** Floor height under (x, d): platforms or the ground. */
  private floorAt(track: Track, x: number, d: number) {
    let h = 0;
    for (const p of track.platforms) {
      if (p.d0 > d + 1 || p.d1 < d - 1) continue;
      h = Math.max(h, platformHeight(p, x, d));
    }
    return h;
  }

  step(dt: number, t: number, actions: Action[], track: Track) {
    for (const a of actions) this.buffer.push({ a, t });
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.fallT = Math.max(0, this.fallT - dt);

    // ── Input (buffered so early swipes still count) ──────────────────
    this.buffer = this.buffer.filter(({ a, t: at }) => {
      if (t - at > PLAYER.inputBuffer) return false;
      if (this.stunned || this.finished) return true;
      switch (a) {
        case 'left': this.changeLane(-1); return false;
        case 'right': this.changeLane(1); return false;
        case 'jump':
          if (!this.grounded) return true;
          this.jump(PLAYER.jumpVelocity, 'jump');
          return false;
        case 'slide':
          if (!this.grounded) {
            this.vy = Math.min(this.vy, PLAYER.fastFallVelocity);
            return true; // slide on landing
          }
          this.slideT = PLAYER.slideTime;
          this.emit({ type: 'slide' });
          return false;
      }
    });

    // ── Lateral ───────────────────────────────────────────────────────
    const prevX = this.x;
    this.laneT = Math.min(1, this.laneT + dt / PLAYER.laneChangeTime);
    this.x = laneX(this.laneFrom + (this.lane - this.laneFrom) * smooth(this.laneT));
    this.laneVelocity = (this.x - prevX) / dt;

    // ── Forward ───────────────────────────────────────────────────────
    this.speedMul = Math.min(1, this.speedMul + this.recoverRate * dt);
    let floorMul = 1;
    const near = this.nearby(track);
    if (this.grounded) {
      for (const o of near) {
        if (o.kind === 'slow' && onFloor(o, this.x, this.d)) floorMul = PENALTY.slowFloor;
      }
    }
    const focusMul = 1 + this.focus * FOCUS.bonusPerLevel;
    this.speed = this.finished
      ? Math.max(0, this.speed - 14 * dt)
      : baseSpeed(this.d) * focusMul * this.speedMul * floorMul;
    this.d += this.speed * dt;

    // ── Vertical ──────────────────────────────────────────────────────
    let floor = this.floorAt(track, this.x, this.d);
    // A roof well above our feet is a wall to collide with, not a floor.
    if (floor - this.y > PLAYER.stepUp) floor = 0;
    this.vy -= PLAYER.gravity * dt;
    this.y += this.vy * dt;
    if (this.grounded && floor < this.y - 0.05) {
      this.grounded = false; // ran off a roof
      this.vy = Math.min(this.vy, 0);
    }
    if (this.y <= floor) {
      const wasAir = !this.grounded;
      this.y = floor;
      this.vy = 0;
      this.grounded = true;
      if (wasAir) {
        this.emit({ type: 'land' });
        if (this.buffer.some((b) => b.a === 'slide')) {
          this.buffer = this.buffer.filter((b) => b.a !== 'slide');
          this.slideT = PLAYER.slideTime;
          this.emit({ type: 'slide' });
        }
      }
    }
    this.slideT = Math.max(0, this.slideT - dt);

    // ── Obstacles ─────────────────────────────────────────────────────
    for (const o of near) {
      trigger(o, t, this.d, this.speed);
      if (o.hit || this.finished) continue;
      if (this.grounded && this.y < 0.05) {
        if (o.kind === 'bounce' && onFloor(o, this.x, this.d)) this.jump(PLAYER.bounceVelocity, 'bounce');
        if (o.kind === 'gap' && onFloor(o, this.x, this.d)) this.fall(o);
      }
      if (this.invulnT > 0) continue;
      boxes.length = 0;
      hitBoxes(o, t, boxes);
      for (const b of boxes) {
        if (!this.overlaps(b, this.x)) continue;
        // Moving sideways into something we would have missed = side hit.
        if (this.laneT < 1 && !this.overlaps(b, laneX(this.laneFrom))) this.sideHit();
        else this.stumble(o, track, t);
        break;
      }
    }

    this.trackRows(track);
  }

  private nearby(track: Track): Obstacle[] {
    const obs = track.obstacles;
    while (this.nearIndex < obs.length && obs[this.nearIndex].d + obs[this.nearIndex].length + 40 < this.d) this.nearIndex++;
    const out: Obstacle[] = [];
    for (let i = this.nearIndex; i < obs.length && obs[i].d < this.d + 120; i++) out.push(obs[i]);
    return out;
  }

  private overlaps(b: Box, x: number) {
    const hw = PLAYER.width / 2;
    const hd = PLAYER.depth / 2;
    return x + hw > b.x0 && x - hw < b.x1 &&
      this.y + this.height > b.y0 && this.y < b.y1 &&
      this.d + hd > b.d0 && this.d - hd < b.d1;
  }

  private sideHit() {
    // Bounce back to where we came from.
    const back = Math.round(this.laneFrom);
    this.laneFrom = this.currentLaneFloat();
    this.lane = back;
    this.laneT = 0;
    this.speedMul = Math.min(this.speedMul, PENALTY.sideHit.speed);
    this.recoverRate = (1 - PENALTY.sideHit.speed) / PENALTY.sideHit.recover;
    this.invulnT = 0.25;
    this.setFocus(this.focus - FOCUS.sideHitLoss);
    this.markRow(this.nextRow);
    this.emit({ type: 'sidehit' });
  }

  private stumble(o: Obstacle, track: Track, t: number) {
    // A train stays solid after a hit (it can't be knocked away like a crate).
    if (o.kind !== 'train') o.hit = true;
    this.speedMul = PENALTY.stumble.speed;
    this.recoverRate = (1 - PENALTY.stumble.speed) / PENALTY.stumble.recover;
    this.invulnT = PENALTY.stumble.invulnerable;
    this.slideT = 0;
    this.setFocus(0);
    this.markRow(o.row);
    // Long obstacles (trains) would keep us inside them: move to the nearest
    // free lane, or onto the roof when every lane is blocked here.
    if (o.length > 4) {
      const options = [-1, 0, 1]
        .filter((l) => l !== this.lane && !this.blocked(track, l, t))
        .sort((a, b) => Math.abs(a - this.lane) - Math.abs(b - this.lane));
      if (options.length) {
        this.laneFrom = this.currentLaneFloat();
        this.lane = options[0];
        this.laneT = 0;
      } else if (o.kind === 'train') {
        this.y = TRAIN_TOP;
        this.vy = 0;
        this.grounded = true;
      }
    }
    this.emit({ type: 'stumble', obstacle: o });
  }

  private blocked(track: Track, lane: number, t: number) {
    const x = laneX(lane);
    for (const o of this.nearby(track)) {
      if (o.d > this.d + 6) break;
      boxes.length = 0;
      hitBoxes(o, t, boxes);
      if (boxes.some((b) => this.overlaps(b, x))) return true;
    }
    return false;
  }

  private fall(o: Obstacle) {
    o.hit = true;
    this.fallT = PENALTY.fall.duration;
    this.speedMul = PENALTY.fall.speed;
    this.recoverRate = (1 - PENALTY.fall.speed) / PENALTY.fall.recover;
    this.invulnT = PENALTY.fall.duration;
    this.setFocus(0);
    this.markRow(o.row);
    this.emit({ type: 'fall' });
  }

  private setFocus(v: number) {
    const next = Math.max(0, Math.min(FOCUS.max, v));
    if (next !== this.focus) {
      this.focus = next;
      this.emit({ type: 'focus', level: next });
    }
  }

  private markRow(row: number) {
    this.dirtyRows.add(row);
  }

  /** A row passed without any hit adds one level of Focus. */
  private trackRows(track: Track) {
    while (this.nextRow < track.rows.length && track.rows[this.nextRow].d1 < this.d - 0.5) {
      const r = this.nextRow++;
      const hazardous = track.obstacles.some((o) => o.row === r && isHazard(o.kind));
      if (hazardous && !this.dirtyRows.has(r)) this.setFocus(this.focus + 1);
    }
  }

  finish(t: number) {
    if (this.finished) return;
    this.finished = true;
    this.finishTime = t;
    this.emit({ type: 'finish' });
  }
}
