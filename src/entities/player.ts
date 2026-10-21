// Player simulation: auto-run, lane changes, jump/slide, collisions that cost
// speed instead of lives, and the Focus streak. Pure logic, no rendering.
import { BODY, DASH, FOCUS, ITEM, PENALTY, PLAYER, RACE_LENGTH, START_BOOST, baseSpeed, laneX, runOut } from '../config.ts';
import type { Action } from '../core/input.ts';
import type { ItemKind } from '../world/items.ts';
import {
  hitBoxes, isHazard, onFloor, trigger, type Box, type Obstacle,
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
  | { type: 'bump'; side: boolean }
  | { type: 'smash'; obstacle: Obstacle } // destroyed by a hit or a dash
  | { type: 'dash' }
  | { type: 'dashReady' }
  | { type: 'stunned' }
  | { type: 'shoved' } // barged into the next lane
  | { type: 'barged' } // barged someone else aside
  | { type: 'pickup'; item: ItemKind }
  | { type: 'item'; item: ItemKind } // used it
  | { type: 'shieldBlock' } // the shield took a hit
  | { type: 'inked' }
  | { type: 'rocketEnd' } // out of fuel: dropping back to the track
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
  private laneTime: number = PLAYER.laneChangeTime;
  /** False until everyone leaves the blocks together. */
  launched = false;
  private boost = 0; // extra speed out of the blocks, decays
  private bumpT = 0;
  /** Dash meter 0..DASH.full, and time left in a dash. */
  dash = 0;
  dashT = 0;
  private stunT = 0;
  /** Sideways jolt from a shoulder bump, for the view (−1/1, 0 = none). */
  jolt = 0;
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
  /** Stopped short of the line because someone else won. */
  halted = false;
  private buffer: { a: Action; t: number }[] = [];
  private nextRow = 0;
  private dirtyRows = new Set<number>();
  private nearIndex = 0;
  events: PlayerEvent[] = [];
  /** The held item (one at a time); a new one spins in the slot for `itemRoll`. */
  items: ItemKind[] = [];
  itemRoll = 0;
  itemBoostT = 0;
  shield = false;
  /** In the air off a spring: clears everything until landing. */
  springing = false;
  /** Seconds of rocket flight left. */
  flyT = 0;
  inkT = 0;
  /** Item boxes this runner has taken (ids); the rest are still there for them. */
  took = new Set<number>();

  get sliding() {
    return this.slideT > 0;
  }

  get stunned() {
    return this.fallT > 0 || this.stunT > 0;
  }

  get dashing() {
    return this.dashT > 0;
  }

  /** The item the button uses next. */
  get item(): ItemKind | null {
    return this.items[0] ?? null;
  }

  get flying() {
    return this.flyT > 0;
  }

  get itemReady() {
    return !!this.item && this.itemRoll <= 0 && this.launched && !this.finished && !this.stunned;
  }

  /** Ran through an item box: a new roll, replacing whatever was held (it spins again). */
  give(item: ItemKind) {
    if (this.finished) return false;
    this.items = [item];
    this.itemRoll = ITEM.roll;
    this.emit({ type: 'pickup', item });
    return true;
  }

  /** Splattered by someone behind. */
  ink() {
    if (this.finished) return;
    this.inkT = ITEM.inkTime;
    this.emit({ type: 'inked' });
  }

  private useItem() {
    const item = this.items.shift()!;
    switch (item) {
      case 'boost':
        this.itemBoostT = ITEM.boostTime;
        this.speedMul = 1;
        break;
      case 'shield':
        this.shield = true;
        break;
      case 'spring':
        this.jump(ITEM.springVelocity, 'bounce');
        this.springing = true;
        break;
      case 'rocket':
        this.flyT = ITEM.flyTime;
        this.grounded = false;
        this.slideT = 0;
        this.speedMul = 1;
        break;
      case 'ink': break; // the game splatters whoever is ahead
    }
    this.emit({ type: 'item', item });
  }

  private shieldBlock() {
    this.shield = false;
    this.invulnT = Math.max(this.invulnT, 0.4);
    this.emit({ type: 'shieldBlock' });
  }

  get dashReady() {
    return this.dash >= DASH.full && !this.dashing && this.launched && !this.finished;
  }

  private addDash(v: number) {
    if (this.dashing || this.finished) return;
    const was = this.dash >= DASH.full;
    this.dash = Math.min(DASH.full, this.dash + v);
    if (!was && this.dash >= DASH.full) this.emit({ type: 'dashReady' });
  }

  /** Rammed by a dashing runner: stopped dead for a moment and knocked aside. */
  stun(time: number, push: number) {
    if (this.dashing || this.finished) return;
    if (this.shield) { this.shieldBlock(); return; }
    this.stunT = Math.max(this.stunT, time);
    this.speedMul = 0.45;
    this.recoverRate = 0.55 / 0.7;
    this.shove(push);
    this.emit({ type: 'stunned' });
  }

  /** Pushed sideways by `push` metres right now, settling into the nearest lane that way. */
  private shove(push: number) {
    if (!push) return;
    this.x += push;
    this.jolt = Math.sign(push);
    this.laneFrom = this.currentLaneFloat();
    const lane = Math.max(-1, Math.min(1, push > 0 ? Math.ceil(this.laneFrom - 0.25) : Math.floor(this.laneFrom + 0.25)));
    this.lane = lane;
    this.laneT = 0;
    this.laneTime = 0.25;
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

  /** Crouch in a starting box at x; after the gun, merge into `lane`. */
  startSlot(x: number, lane: number) {
    this.x = x;
    this.laneFrom = x / laneX(1);
    this.lane = lane;
    this.laneT = 1;
    this.launched = false;
  }

  /** Out of the blocks: accelerate hard. Everyone gets the same start. */
  launch() {
    if (this.launched) return;
    this.launched = true;
    this.speedMul = 0;
    this.recoverRate = 1 / 0.55;
    this.boost = START_BOOST;
    this.laneFrom = this.currentLaneFloat();
    this.laneT = 0;
    this.laneTime = 0.5;
  }

  /** Ran into the back of another runner: held behind them. */
  blockBehind(leaderD: number, leaderSpeed: number) {
    // Two dashers: no slowdown, but still no overlapping.
    if (this.dashing) { this.d = Math.min(this.d, leaderD - BODY.depth); return; }
    const first = this.bumpT <= 0;
    // A first contact knocks you back a touch; after that you just tuck in behind.
    this.d = Math.min(this.d, leaderD - BODY.depth - (first ? 0.15 : 0));
    if (this.speed > leaderSpeed) {
      this.speedMul = Math.min(this.speedMul, Math.max(0.55, (leaderSpeed / Math.max(1, this.speed)) * this.speedMul * (first ? 0.85 : 1)));
      this.recoverRate = 0.6;
    }
    if (first) {
      this.addDash(DASH.perBump);
      this.emit({ type: 'bump', side: false });
    }
    this.bumpT = 1.0;
  }

  /** Barged one lane over by a runner cutting across. */
  shoved(dir: -1 | 1, push: number) {
    if (this.dashing || this.finished) return;
    this.x += push;
    this.jolt = dir;
    this.laneFrom = this.currentLaneFloat();
    this.lane = Math.max(-1, Math.min(1, Math.round(this.laneFrom - push / laneX(1)) + dir));
    this.laneT = 0;
    this.laneTime = 0.3;
    this.speedMul = Math.min(this.speedMul, 0.9);
    this.recoverRate = 0.5;
    if (this.bumpT <= 0) this.emit({ type: 'shoved' });
    this.bumpT = 0.6;
  }

  /** Barged someone aside: a little shoulder, a little meter. */
  barged() {
    if (this.bumpT <= 0) {
      this.addDash(DASH.perBump);
      this.emit({ type: 'barged' });
    }
    this.bumpT = 0.6;
  }

  /** Shouldered someone while changing lanes: bounce back. */
  sideBump(push = 0) {
    this.x += push;
    this.jolt = Math.sign(push);
    if (this.laneT >= 1) {
      this.laneFrom = this.currentLaneFloat();
      return;
    }
    const back = Math.round(this.laneFrom);
    this.laneFrom = this.currentLaneFloat();
    this.lane = back;
    this.laneT = 0;
    this.laneTime = PLAYER.laneChangeTime;
    this.speedMul = Math.min(this.speedMul, 0.92);
    this.recoverRate = 0.4;
    if (this.bumpT <= 0) {
      this.addDash(DASH.perBump);
      this.emit({ type: 'bump', side: true });
    }
    this.bumpT = 0.6;
  }

  get changingLane() {
    return this.laneT < 1;
  }

  private changeLane(dir: -1 | 1) {
    const target = this.lane + dir;
    if (target < -1 || target > 1) return;
    this.laneFrom = this.currentLaneFloat();
    this.lane = target;
    this.laneT = 0;
    this.laneTime = PLAYER.laneChangeTime;
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

  step(dt: number, t: number, actions: Action[], track: Track) {
    if (!this.launched) {
      this.speed = 0;
      this.laneVelocity = 0;
      return;
    }
    if (this.halted) {
      // The race is over: ease to a stop (never over the line) and come down if in the air.
      this.speed = runOut(this.speed, dt);
      this.d = Math.min(this.d + this.speed * dt, Math.max(this.d, RACE_LENGTH - 1));
      this.laneVelocity = 0;
      this.vy -= PLAYER.gravity * dt;
      this.y = Math.max(0, this.y + this.vy * dt);
      if (this.y === 0) { this.vy = 0; this.grounded = true; }
      return;
    }
    for (const a of actions) this.buffer.push({ a, t });
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.fallT = Math.max(0, this.fallT - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.bumpT = Math.max(0, this.bumpT - dt);
    this.boost = Math.max(0, this.boost - dt * 0.2);
    this.itemRoll = Math.max(0, this.itemRoll - dt);
    this.itemBoostT = Math.max(0, this.itemBoostT - dt);
    this.inkT = Math.max(0, this.inkT - dt);
    if (this.dashT > 0) {
      this.dashT = Math.max(0, this.dashT - dt);
      if (this.dashT === 0) this.invulnT = Math.max(this.invulnT, 0.3);
    }

    // ── Input (buffered so early swipes still count) ──────────────────
    this.buffer = this.buffer.filter(({ a, t: at }) => {
      if (t - at > PLAYER.inputBuffer) return false;
      if (a === 'dash') {
        if (this.dashReady) this.startDash();
        return false;
      }
      if (a === 'item') {
        if (this.itemReady) this.useItem();
        return false;
      }
      if (this.stunned || this.finished) return true;
      // On a rocket: steer only, no jumping or sliding in the air.
      if (this.flying && (a === 'jump' || a === 'slide')) return false;
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
    this.laneT = Math.min(1, this.laneT + dt / this.laneTime);
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
      ? runOut(this.speed, dt)
      : this.stunT > 0 ? 0
      : this.dashing ? baseSpeed(this.d) * focusMul * DASH.mul
      : baseSpeed(this.d) * focusMul * this.speedMul * floorMul * (1 + this.boost) *
        (this.itemBoostT > 0 ? ITEM.boostMul : 1) * (this.flying ? ITEM.rocketMul : 1);
    const before = this.d;
    this.d += this.speed * dt;
    if (!this.dashing && !this.finished) this.addDash((this.d - before) * DASH.perMeter);

    // ── Vertical ──────────────────────────────────────────────────────
    const floor = 0;
    if (this.flyT > 0) {
      // Climb to cruising height and hold it; when the fuel runs out, drop
      // back down (still clearing everything until the feet touch the ground).
      this.flyT = Math.max(0, this.flyT - dt);
      this.vy = (ITEM.flyHeight - this.y) * 3;
      if (this.flyT === 0) {
        this.vy = 0;
        this.springing = true;
        this.emit({ type: 'rocketEnd' });
      }
    } else {
      this.vy -= PLAYER.gravity * dt;
    }
    this.y += this.vy * dt;
    if (this.y <= floor) {
      const wasAir = !this.grounded;
      this.y = floor;
      this.vy = 0;
      this.grounded = true;
      if (wasAir) {
        this.springing = false;
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
      if (this.dashing) {
        // Nothing stops a dash: plough through and leave nothing standing.
        if (o.kind === 'gap' || o.kind === 'slow' || o.kind === 'bounce') continue;
        boxes.length = 0;
        hitBoxes(o, t, boxes);
        if (boxes.some((b) => this.overlaps(b, this.x))) {
          o.hit = true;
          this.emit({ type: 'smash', obstacle: o });
        }
        continue;
      }
      if (this.grounded && this.y < 0.05) {
        if (o.kind === 'bounce' && onFloor(o, this.x, this.d)) this.jump(PLAYER.bounceVelocity, 'bounce');
        if (o.kind === 'gap' && onFloor(o, this.x, this.d)) {
          if (this.shield) {
            // The shield takes the fall: hop over instead.
            o.hit = true;
            this.shieldBlock();
            this.jump(PLAYER.jumpVelocity, 'jump');
          } else this.fall(o);
        }
      }
      if (this.springing || this.flying) continue;
      if (this.invulnT > 0) continue;
      boxes.length = 0;
      hitBoxes(o, t, boxes);
      for (const b of boxes) {
        if (!this.overlaps(b, this.x)) continue;
        if (this.shield) {
          // Bounces off the bubble: the obstacle is smashed, the runner keeps going.
          o.hit = true;
          this.emit({ type: 'smash', obstacle: o });
          this.shieldBlock();
          break;
        }
        // Moving sideways into something we would have missed = side hit.
        if (this.laneT < 1 && !this.overlaps(b, laneX(this.laneFrom))) this.sideHit(o);
        else this.stumble(o);
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

  private startDash() {
    this.dash = 0;
    this.dashT = DASH.time;
    this.speedMul = 1;
    this.boost = 0;
    this.stunT = 0;
    this.slideT = 0;
    this.setFocus(FOCUS.max);
    this.emit({ type: 'dash' });
  }

  /** Whatever you run into is smashed out of the way (and fills the dash meter). */
  private smash(o: Obstacle) {
    o.hit = true;
    this.addDash(DASH.perHit);
    this.emit({ type: 'smash', obstacle: o });
  }

  private sideHit(o: Obstacle) {
    this.smash(o);
    // Bounce back to where we came from.
    const back = Math.round(this.laneFrom);
    this.laneFrom = this.currentLaneFloat();
    this.lane = back;
    this.laneT = 0;
    this.laneTime = PLAYER.laneChangeTime;
    this.speedMul = Math.min(this.speedMul, PENALTY.sideHit.speed);
    this.recoverRate = (1 - PENALTY.sideHit.speed) / PENALTY.sideHit.recover;
    this.invulnT = 0.25;
    this.setFocus(this.focus - FOCUS.sideHitLoss);
    this.markRow(this.nextRow);
    this.emit({ type: 'sidehit' });
  }

  private stumble(o: Obstacle) {
    this.smash(o);
    this.speedMul = PENALTY.stumble.speed;
    this.recoverRate = (1 - PENALTY.stumble.speed) / PENALTY.stumble.recover;
    this.invulnT = PENALTY.stumble.invulnerable;
    this.slideT = 0;
    this.setFocus(0);
    this.markRow(o.row);
    this.emit({ type: 'stumble', obstacle: o });
  }

  private fall(o: Obstacle) {
    o.hit = true;
    this.addDash(DASH.perHit);
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

  /** Someone else crossed the line first: stop racing where you are. */
  halt() {
    if (this.finished || this.halted) return;
    this.halted = true;
    this.flyT = 0;
    this.dashT = 0;
    this.itemBoostT = 0;
    this.slideT = 0;
  }

  finish(t: number) {
    if (this.finished || this.halted) return;
    this.finished = true;
    this.finishTime = t;
    // Over the line on a rocket: come down to run it out.
    if (this.flyT > 0) { this.flyT = 0; this.springing = true; }
    this.emit({ type: 'finish' });
  }
}
