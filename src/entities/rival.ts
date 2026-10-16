// AI rivals. They don't simulate physics: per row they pick a lane, decide
// (by skill) whether they fumble it, and play the matching move. Same rules
// for speed, Focus and penalties as the player so races stay close.
import { FOCUS, PENALTY, PLAYER, baseSpeed, laneX } from '../config.ts';
import { Rng } from '../core/rng.ts';
import { answerFor, spansTrack, type Answer } from '../world/obstacles.ts';
import type { Track } from '../world/track.ts';

export interface RivalSkill {
  mistake: number; // chance to fumble a row
  pace: number; // multiplier on base speed
}

export type RivalMove = 'jump' | 'bounce' | 'slide' | 'stumble' | 'fall' | 'lane';

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
  moves: RivalMove[] = [];
  private speedMul = 1;
  private recoverRate = 1;
  private row = 0;
  private planned = -1;
  private plan: { answer: Answer; fumble: boolean; at: number } | null = null;
  private vy = 0;
  private slideT = 0;
  private rng: Rng;
  private skill: RivalSkill;

  constructor(seed: number, skill: RivalSkill, lane: number) {
    this.rng = new Rng(seed);
    this.skill = skill;
    this.lane = lane;
    this.x = laneX(lane);
  }

  get sliding() {
    return this.slideT > 0;
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

  step(dt: number, track: Track, playerD: number) {
    const r = track.rows[this.row];
    // Plan the next row a little before reaching it.
    if (r && this.planned !== this.row && this.d > r.d0 - 18) {
      this.planned = this.row;
      const answers = this.laneAnswers(track, this.row);
      const ok = (l: number) => answers[l + 1] !== 'dodge';
      if (!ok(this.lane)) {
        const choices = [-1, 0, 1].filter(ok).sort((a, b) => Math.abs(a - this.lane) - Math.abs(b - this.lane));
        if (choices.length) {
          this.lane = choices[0];
          this.moves.push('lane');
        }
      }
      this.plan = { answer: answers[this.lane + 1], fumble: this.rng.chance(this.skill.mistake), at: r.d0 };
    }

    if (this.plan && this.d >= this.plan.at - 2.5) {
      const { answer, fumble } = this.plan;
      if (fumble && answer !== 'none') {
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

    // Rubber band: keep the pack within sight of the player.
    const gap = this.d - playerD;
    const band = gap > 40 ? 0.94 : gap < -40 ? 1.06 : 1;
    this.speedMul = Math.min(1, this.speedMul + this.recoverRate * dt);
    this.speed = this.finished
      ? Math.max(0, this.speed - 14 * dt)
      : baseSpeed(this.d) * this.skill.pace * band * (1 + this.focus * FOCUS.bonusPerLevel) * this.speedMul;
    this.d += this.speed * dt;

    const prevX = this.x;
    this.x += (laneX(this.lane) - this.x) * Math.min(1, dt * 10);
    this.laneVelocity = (this.x - prevX) / dt;
    this.vy -= PLAYER.gravity * dt;
    this.y = Math.max(0, this.y + this.vy * dt);
    if (this.y === 0) this.vy = 0;
    this.slideT = Math.max(0, this.slideT - dt);
  }

  finish(t: number) {
    if (this.finished) return;
    this.finished = true;
    this.finishTime = t;
  }
}
