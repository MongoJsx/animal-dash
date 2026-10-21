// AI rivals. They don't simulate physics: per row they pick a lane, decide
// (by skill) whether they fumble it, and play the matching move. Same rules
// for speed, Focus and penalties as the player so races stay close. They are
// solid: they react to the gun, merge out of their starting box, get held up
// behind slower runners and pull out to overtake when a lane is free.
import { BODY, DASH, FOCUS, ITEM, PENALTY, PLAYER, RACE_LENGTH, START_BOOST, baseSpeed, laneX, runOut } from '../config.ts';
import { Rng } from '../core/rng.ts';
import type { ItemKind } from '../world/items.ts';
import { answerFor, spansTrack, type Answer } from '../world/obstacles.ts';
import type { Track } from '../world/track.ts';

export interface RivalSkill {
  mistake: number; // chance to fumble a row
  pace: number; // multiplier on base speed
}

export type RivalMove = 'jump' | 'bounce' | 'slide' | 'stumble' | 'fall' | 'lane' | 'launch' | 'dash' | 'stunned';

/** Where another runner is, for lane choice. */
export interface Traffic { x: number; d: number }

export class Rival {
  d = 0;
  x = 0;
  y = 0;
  lane: number;
  laneVelocity = 0;
  speed = 0;
  focus = 0;
  finished = false;
  finishTime = 0;
  /** Stopped short of the line because someone else won. */
  halted = false;
  launched = false;
  moves: RivalMove[] = [];
  dash = 0;
  dashT = 0;
  jolt = 0;
  private stunT = 0;
  private prevLane: number;
  private speedMul = 1;
  private recoverRate = 1;
  private boost = 0;
  private row = 0;
  private planned = -1;
  private plan: { answer: Answer; fumble: boolean; at: number } | null = null;
  private vy = 0;
  private slideT = 0;
  private blockedT = 0;
  private rng: Rng;
  private skill: RivalSkill;
  item: ItemKind | null = null;
  private useAt = 0; // seconds until it decides to use the held item
  itemBoostT = 0;
  /** Seconds of rocket flight left. */
  flyT = 0;
  shield = false;
  private inkT = 0;
  /** Items used this step that touch other runners (ink); the game drains it. */
  fired: ItemKind[] = [];
  /** Item boxes this runner has taken (ids). */
  took = new Set<number>();

  constructor(seed: number, skill: RivalSkill, x: number, lane: number) {
    this.rng = new Rng(seed);
    this.skill = skill;
    this.lane = this.prevLane = lane;
    this.x = x;
  }

  get sliding() {
    return this.slideT > 0;
  }

  get dashing() {
    return this.dashT > 0;
  }

  /** Rammed by a dashing runner. */
  stun(time: number, push: number) {
    if (this.dashing || this.finished) return;
    if (this.shield) { this.shield = false; return; }
    this.stunT = Math.max(this.stunT, time);
    this.speedMul = 0.45;
    this.recoverRate = 0.55 / 0.7;
    this.x += push;
    this.jolt = Math.sign(push);
    const lane = Math.max(-1, Math.min(1, push > 0 ? Math.ceil(this.x / laneX(1) - 0.25) : Math.floor(this.x / laneX(1) + 0.25)));
    if (lane !== this.lane) { this.prevLane = this.lane; this.lane = lane; }
    this.moves.push('stunned');
  }

  launch() {
    if (this.launched) return;
    this.launched = true;
    this.speedMul = 0;
    this.recoverRate = 1 / 0.6;
    this.boost = START_BOOST;
    this.moves.push('launch');
  }

  /** What each lane of a row asks for: the hardest answer among its obstacles. */
  private laneAnswers(track: Track, row: number): Answer[] {
    const res: Answer[] = ['none', 'none', 'none'];
    const rank: Record<Answer, number> = { none: 0, any: 1, jump: 2, slide: 2, dodge: 3 };
    for (const o of track.obstacles) {
      if (o.row !== row) continue;
      const a = answerFor(o);
      const lanes = spansTrack(o.kind) ? [-1, 0, 1] : [o.lane];
      for (const l of lanes) if (rank[a] > rank[res[l + 1]]) res[l + 1] = a;
    }
    return res;
  }

  /** Somebody is beside or just ahead in that lane. */
  private occupied(lane: number, others: Traffic[]) {
    const x = laneX(lane);
    return others.some((o) => Math.abs(o.x - x) < BODY.width + 0.3 && o.d > this.d - 1.4 && o.d < this.d + 2.2);
  }

  private moveTo(lane: number) {
    if (lane === this.lane) return;
    this.prevLane = this.lane;
    this.lane = lane;
    this.moves.push('lane');
  }

  /** Held up behind a slower runner (racer-vs-racer contact). */
  blockBehind(leaderD: number, leaderSpeed: number) {
    this.d = Math.min(this.d, leaderD - BODY.depth);
    if (this.dashing) return;
    if (this.speed > leaderSpeed) this.speedMul = Math.min(this.speedMul, Math.max(0.5, (leaderSpeed / Math.max(1, this.speed)) * this.speedMul));
    this.recoverRate = 0.5;
    this.blockedT = 0.4;
  }

  /** Barged one lane over by a runner cutting across. */
  shoved(dir: -1 | 1, push: number) {
    if (this.dashing || this.finished) return;
    const from = Math.round(this.x / laneX(1));
    this.x += push;
    this.jolt = dir;
    const lane = Math.max(-1, Math.min(1, from + dir));
    if (lane !== this.lane) { this.prevLane = this.lane; this.lane = lane; }
    this.speedMul = Math.min(this.speedMul, 0.9);
    this.recoverRate = 0.5;
    this.moves.push('stunned');
  }

  /** Bumped shoulders while pulling out: go back to the old lane. */
  sideBump(push = 0) {
    this.x += push;
    this.jolt = Math.sign(push);
    if (Math.abs(this.x - laneX(this.lane)) < 0.1) return;
    const back = this.prevLane;
    this.prevLane = this.lane;
    this.lane = back;
    this.speedMul = Math.min(this.speedMul, 0.9);
    this.recoverRate = 0.4;
  }

  step(dt: number, track: Track, playerD: number, others: Traffic[] = []) {
    if (!this.launched) {
      this.speed = 0;
      return;
    }
    if (this.halted) {
      // The race is over: ease to a stop (never over the line) and come down if in the air.
      this.speed = runOut(this.speed, dt);
      this.d = Math.min(this.d + this.speed * dt, Math.max(this.d, RACE_LENGTH - 1));
      this.laneVelocity = 0;
      this.vy -= PLAYER.gravity * dt;
      this.y = Math.max(0, this.y + this.vy * dt);
      if (this.y === 0) this.vy = 0;
      return;
    }
    const r = track.rows[this.row];
    // Plan the next row a little before reaching it.
    if (r && this.planned !== this.row && this.d > r.d0 - 18) {
      this.planned = this.row;
      const answers = this.laneAnswers(track, this.row);
      const ok = (l: number) => answers[l + 1] !== 'dodge';
      if (!ok(this.lane)) {
        const choices = [-1, 0, 1].filter(ok).sort((a, b) =>
          Number(this.occupied(a, others)) - Number(this.occupied(b, others)) || Math.abs(a - this.lane) - Math.abs(b - this.lane));
        if (choices.length) this.moveTo(choices[0]);
      }
      // Ink in the eyes: much more likely to fumble.
      const mistake = this.inkT > 0 ? Math.max(0.6, this.skill.mistake) : this.skill.mistake;
      this.plan = { answer: answers[this.lane + 1], fumble: this.rng.chance(mistake), at: r.d0 };
    }

    this.stunT = Math.max(0, this.stunT - dt);
    this.dashT = Math.max(0, this.dashT - dt);
    this.itemBoostT = Math.max(0, this.itemBoostT - dt);
    this.inkT = Math.max(0, this.inkT - dt);
    this.useAt -= dt;
    if (this.item && this.useAt <= 0 && !this.finished && this.stunT <= 0) this.thinkItem(others);
    // Dash when the meter is full, at a moment of its own choosing.
    if (this.dash >= DASH.full && !this.dashing && !this.finished && this.rng.chance(dt * 0.7)) {
      this.dash = 0;
      this.dashT = DASH.time;
      this.speedMul = 1;
      this.focus = FOCUS.max;
      this.moves.push('dash');
    }

    if (this.plan && this.d >= this.plan.at - 2.5) {
      const { answer, fumble } = this.plan;
      if (this.dashing || this.flyT > 0 || this.y > 1.5) {
        // Smashes straight through, or flies over it.
      } else if (fumble && answer !== 'none' && this.shield) {
        this.shield = false; // the bubble takes it
      } else if (fumble && answer !== 'none') {
        this.dash = Math.min(DASH.full, this.dash + DASH.perHit);
        this.speedMul = PENALTY.stumble.speed;
        this.recoverRate = (1 - PENALTY.stumble.speed) / PENALTY.stumble.recover;
        this.focus = 0;
        this.moves.push('stumble');
      } else if (answer === 'jump' && this.y <= 0) {
        this.vy = PLAYER.jumpVelocity;
        this.moves.push('jump');
      } else if (answer === 'slide') {
        this.slideT = PLAYER.slideTime;
        this.moves.push('slide');
      }
      this.plan = null;
    }

    if (r && this.d > r.d1) {
      if (this.speedMul >= 1) this.focus = Math.min(FOCUS.max, this.focus + 1);
      this.row++;
    }

    // Stuck behind someone: pull out into a free lane that isn't blocked ahead.
    this.blockedT = Math.max(0, this.blockedT - dt);
    if (this.blockedT > 0 && Math.abs(this.x - laneX(this.lane)) < 0.2 && this.rng.chance(dt * 4)) {
      const answers = r ? this.laneAnswers(track, this.row) : ['none', 'none', 'none'];
      const free = [this.lane - 1, this.lane + 1].filter((l) => l >= -1 && l <= 1 && answers[l + 1] !== 'dodge' && !this.occupied(l, others));
      if (free.length) this.moveTo(this.rng.pick(free));
    }

    // Rubber band: keep the pack within sight of the player.
    const gap = this.d - playerD;
    const band = gap > 40 ? 0.94 : gap < -40 ? 1.06 : 1;
    this.speedMul = Math.min(1, this.speedMul + this.recoverRate * dt);
    if (this.speedMul >= 1) this.recoverRate = 1;
    this.boost = Math.max(0, this.boost - dt * 0.2);
    const focusMul = 1 + this.focus * FOCUS.bonusPerLevel;
    this.speed = this.finished
      ? runOut(this.speed, dt)
      : this.stunT > 0 ? 0
      : this.dashing ? baseSpeed(this.d) * focusMul * DASH.mul
      : baseSpeed(this.d) * this.skill.pace * band * focusMul * this.speedMul * (1 + this.boost) *
        (this.itemBoostT > 0 ? ITEM.boostMul : 1) * (this.flyT > 0 ? ITEM.rocketMul : 1);
    this.d += this.speed * dt;
    if (!this.dashing && !this.finished) this.dash = Math.min(DASH.full, this.dash + this.speed * dt * DASH.perMeter);

    const prevX = this.x;
    // Out of the blocks they drift over; later lane changes are a quick sidestep.
    const rate = this.d < 12 ? 3 : 10;
    this.x += (laneX(this.lane) - this.x) * Math.min(1, dt * rate);
    this.laneVelocity = (this.x - prevX) / dt;
    if (this.flyT > 0) {
      // On a rocket: climb to cruising height and hold it, then drop.
      this.flyT = Math.max(0, this.flyT - dt);
      this.vy = this.flyT > 0 ? (ITEM.flyHeight - this.y) * 3 : 0;
    } else {
      this.vy -= PLAYER.gravity * dt;
    }
    this.y = Math.max(0, this.y + this.vy * dt);
    if (this.y === 0) this.vy = 0;
    this.slideT = Math.max(0, this.slideT - dt);
  }

  /** Ran through an item box: a new roll, replacing whatever was held. */
  give(item: ItemKind) {
    if (this.finished) return false;
    this.item = item;
    this.useAt = ITEM.roll + this.rng.range(0.3, 1.5);
    return true;
  }

  /** Splattered by someone behind. */
  ink() {
    if (!this.finished) this.inkT = ITEM.inkTime;
  }

  get inked() {
    return this.inkT > 0;
  }

  /** Use the held item when it pays off. */
  private thinkItem(others: Traffic[]) {
    const item = this.item!;
    const plan = this.plan;
    switch (item) {
      case 'boost':
        // Best straight after a stumble; otherwise whenever.
        if (this.speedMul < 0.8 || this.rng.chance(0.02)) {
          this.itemBoostT = ITEM.boostTime;
          this.speedMul = 1;
          break;
        }
        return;
      case 'shield':
        this.shield = true;
        break;
      case 'ink':
        if (!others.some((o) => o.d > this.d + 1 && o.d < this.d + 80)) return;
        this.fired.push('ink');
        break;
      case 'spring':
        // Hop the next row it would have to deal with.
        if (!plan || plan.answer === 'none' || this.d < plan.at - 5 || this.y > 0) return;
        this.vy = ITEM.springVelocity;
        this.slideT = 0;
        this.plan = null;
        this.moves.push('bounce');
        break;
      case 'rocket':
        this.flyT = ITEM.flyTime;
        this.slideT = 0;
        this.speedMul = 1;
        break;
    }
    this.item = null;
  }

  /** Someone else crossed the line first: stop racing where you are. */
  halt() {
    if (this.finished || this.halted) return;
    this.halted = true;
    this.flyT = 0;
    this.dashT = 0;
    this.itemBoostT = 0;
  }

  finish(t: number) {
    if (this.finished || this.halted) return;
    this.finished = true;
    this.finishTime = t;
    this.flyT = 0;
  }
}
