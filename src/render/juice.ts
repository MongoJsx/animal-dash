// What the race does with the effects in fx.ts: dust under every footfall,
// landing and slide; stars and a "pow" on a hit; sparkles round item boxes and
// on a pickup; shockwave rings for dashes and items; confetti cannons at the gun
// and fireworks over the finish. Runners live in straight track space, the
// sprites in world space, so positions go through the path when spawned.
import * as THREE from 'three';
import { ITEM, RACE_LENGTH, laneX } from '../config.ts';
import type { ItemKind, ItemBox } from '../world/items.ts';
import type { TrackPath } from '../world/path.ts';
import { Cell, Dizzy, SpeedLines, Sprites } from './fx.ts';
import { TRACK_HALF } from './scenery.ts';

/** What the effects need to know about a runner (player, rival or online friend). */
export interface Runner { x: number; y: number; d: number; speed: number }

interface Stride { acc: number; foot: number; air: boolean }

const STRIDE = 2.1; // metres between footfalls at a sprint
const CONFETTI = [0xff3b5c, 0xffc93c, 0x3ddc97, 0x3a86ff, 0xb15cff, 0xffffff];
const FIREWORK = [[0xffd23f, 0xfff3b0], [0xff4d6d, 0xffc2d1], [0x4cc9f0, 0xe0fbff], [0x80ed99, 0xf1fff4], [0xc77dff, 0xf3e5ff]];

const _f = { x: 0, y: 0, z: 0, yaw: 0, curve: 0 };
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dust = new THREE.Color();
const _white = new THREE.Color(0xffffff);

export class Juice {
  readonly sprites = new Sprites();
  readonly dizzy: Dizzy;
  readonly lines = new SpeedLines();
  readonly root = new THREE.Group();
  private path: TrackPath | null = null;
  private strides = new WeakMap<object, Stride>();
  private shells: { at: number; x: number; y: number; d: number }[] = [];
  private twinkle = 0;

  constructor() {
    this.dizzy = new Dizzy(this.sprites.mesh.material.uniforms.map.value);
    this.root.add(this.sprites.mesh, this.dizzy.mesh, this.lines.mesh);
  }

  setPath(path: TrackPath) {
    this.path = path;
    this.shells.length = 0;
  }

  /** Track space → world, into `out`. */
  private at(x: number, y: number, d: number, out = _p) {
    return this.path!.toWorld(x, y, d, out);
  }

  /** A track-space velocity (sideways, up, forwards) at distance d → world. */
  private vel(vx: number, vy: number, vd: number, d: number) {
    const yaw = this.path!.frame(d, _f).yaw;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return _v.set(vx * c - vd * s, vy, -vx * s - vd * c);
  }

  /** Moving with the runner, so what pops round them doesn't slide back at the camera. */
  private carry(r: Runner, share = 1) {
    return _b.copy(this.vel(0, 0, r.speed * share, r.d));
  }

  /** Dust in the colour of the ground underfoot, lifted a little towards white. */
  setGround(color: number) {
    _dust.setHex(color).lerp(_white, 0.3);
  }

  // ── Every frame ───────────────────────────────────────────────────
  /**
   * Footfalls, slides and landings for one runner.
   * @param near how much to show (1 = the player, less for rivals further off)
   */
  runner(r: Runner, sliding: boolean, flying: boolean, near: number, dt: number) {
    if (!this.path || near <= 0) return;
    let st = this.strides.get(r);
    if (!st) this.strides.set(r, (st = { acc: 0, foot: 1, air: false }));
    const grounded = r.y < 0.06 && !flying;
    if (st.air && grounded) this.land(r, near);
    st.air = r.y > 0.3 || flying;
    if (!grounded || r.speed < 2) return;
    if (sliding) {
      // A spray of dust off the heels.
      if (Math.random() < dt * 40 * near) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.sprites.spawn(this.at(r.x + side * 0.25, 0.1, r.d - 0.1), {
          vel: this.vel(side * (1 + Math.random() * 2), 1 + Math.random() * 1.5, r.speed * 0.25, r.d), drag: 3,
          life: 0.55, size: [0.3, 0.9], color: _dust, alpha: 0.6 * near, cell: Cell.Puff, spin: 1,
        });
      }
      return;
    }
    st.acc += r.speed * dt;
    if (st.acc < STRIDE) return;
    st.acc -= STRIDE;
    st.foot = -st.foot;
    this.sprites.spawn(this.at(r.x + st.foot * 0.17, 0.06, r.d - 0.15), {
      vel: this.vel(st.foot * 0.6, 0.6, r.speed * 0.7, r.d), drag: 3,
      life: 0.26, size: [0.15, 0.5], color: _dust, alpha: 0.42 * near, cell: Cell.Puff, spin: 0.8,
    });
  }

  private land(r: Runner, near: number) {
    const n = Math.round(9 * near);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      this.sprites.spawn(this.at(r.x + Math.cos(a) * 0.2, 0.08, r.d + Math.sin(a) * 0.2), {
        vel: this.vel(Math.cos(a) * 2.6, 0.5, Math.sin(a) * 2.6 + r.speed * 0.6, r.d), drag: 4,
        life: 0.5, size: [0.25, 0.75], color: _dust, alpha: 0.65 * near, cell: Cell.Puff, spin: 1.5,
      });
    }
  }

  /** Twinkles round the next item boxes; fireworks due; speed lines. */
  update(dt: number, viewD: number, boxes: readonly ItemBox[] | null, taken: Set<number> | null, cam: THREE.PerspectiveCamera, head: THREE.Vector3, lines: number) {
    this.sprites.update(dt);
    this.dizzy.update(dt, head, cam);
    this.lines.update(dt, lines, cam.aspect);
    if (!this.path) return;
    if (boxes && (this.twinkle -= dt) <= 0) {
      this.twinkle = 0.05;
      const near = boxes.filter((b) => b.d > viewD + 4 && b.d < viewD + 45 && !taken?.has(b.id));
      if (near.length) {
        const b = near[Math.floor(Math.random() * near.length)];
        this.sprites.spawn(this.at(laneX(b.lane) + (Math.random() - 0.5) * 1.1, ITEM.boxY + (Math.random() - 0.5) * 1.1, b.d + (Math.random() - 0.5) * 0.6), {
          life: 0.45, size: [0.12, 0.38], color: Math.random() < 0.5 ? 0xffe066 : 0xffffff, cell: Cell.Sparkle, spin: 2, glow: true,
        });
      }
    }
    const now = this.sprites.time;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      if (s.at > now) continue;
      this.shells.splice(i, 1);
      this.firework(s.x, s.y, s.d);
    }
  }

  // ── Moments ───────────────────────────────────────────────────────
  /** Tripped, knocked down or barged: a comic "pow", stars flying, and (big) dizzy stars. */
  hit(r: Runner, big: boolean, isPlayer: boolean) {
    if (!this.path) return;
    const pos = this.at(r.x, r.y + 1.1, r.d + 0.3, _a);
    const s = isPlayer ? 1 : 0.6;
    const vel = this.carry(r, 0.8);
    this.sprites.spawn(pos, { vel, life: 0.22, size: [0.5 * s, (big ? 2.2 : 1.4) * s], color: 0xfff1a8, cell: Cell.Burst, spin: 1.5 });
    this.sprites.spawn(pos, { vel, life: 0.3, size: [0.3 * s, (big ? 1.5 : 1) * s], color: 0xff7b2e, alpha: 0.9, cell: Cell.Burst, spin: -2 });
    this.sprites.burst(pos, big ? 7 : 4, 4.5, 3, { gravity: 9, drag: 1, life: 0.75, size: [0.32 * s, 0.18 * s], color: 0xffd23f, cell: Cell.Star, spin: 7 }, [0xffd23f, 0xffb703, 0xfff3b0], vel);
    if (big) {
      const n = isPlayer ? 8 : 4;
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        this.sprites.spawn(this.at(r.x + Math.cos(a) * 0.4, 0.15, r.d + Math.sin(a) * 0.4), {
          vel: this.vel(Math.cos(a) * 2, 0.8, Math.sin(a) * 2 + r.speed * 0.3, r.d), drag: 3,
          life: 0.7, size: [0.4, 1.1], color: _dust, alpha: 0.7, cell: Cell.Puff, spin: 1,
        });
      }
    }
    if (isPlayer) this.dizzy.start(big ? 1.1 : 0.5);
  }

  /** Down a hole or the like: a big cloud of dust. */
  dustCloud(r: Runner, n = 12) {
    if (!this.path) return;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      this.sprites.spawn(this.at(r.x + Math.cos(a) * 0.5, 0.3 + Math.random() * 0.6, r.d + Math.sin(a) * 0.5), {
        vel: this.vel(Math.cos(a) * 2.5, 1 + Math.random() * 1.5, Math.sin(a) * 2.5 + r.speed * 0.2, r.d), drag: 2.5,
        life: 0.9, size: [0.5, 1.5], color: _dust, alpha: 0.75, cell: Cell.Puff, spin: 1,
      });
    }
  }

  /** Jumped: a little kick of dust. */
  takeoff(r: Runner) {
    if (!this.path) return;
    for (let k = 0; k < 4; k++) {
      const side = k % 2 ? 1 : -1;
      this.sprites.spawn(this.at(r.x + side * 0.2, 0.08, r.d - 0.2), {
        vel: this.vel(side * 1.6, 0.6, r.speed * 0.2, r.d), drag: 4,
        life: 0.45, size: [0.2, 0.6], color: _dust, alpha: 0.55, cell: Cell.Puff, spin: 1,
      });
    }
  }

  /** A shockwave ring round a runner (dash, items), plus optional sparkles. */
  ring(r: Runner, color: number, sparkles = 0, size = 4) {
    if (!this.path) return;
    const pos = this.at(r.x, r.y + 1, r.d + 0.4, _a);
    const vel = this.carry(r);
    this.sprites.spawn(pos, { vel, life: 0.35, size: [0.6, size], color, cell: Cell.Ring, glow: true });
    this.sprites.spawn(pos, { vel, life: 0.5, size: [0.4, size * 0.7], color, alpha: 0.7, cell: Cell.Ring, glow: true });
    if (sparkles) this.sprites.burst(pos, sparkles, 5, 1, { life: 0.6, size: [0.45, 0.15], color, cell: Cell.Sparkle, spin: 3, glow: true }, [color, 0xffffff], vel);
  }

  /** Took an item box: a pop of gold sparkles and a ring. */
  pickup(r: Runner) {
    if (!this.path) return;
    const pos = this.at(r.x, ITEM.boxY, r.d + 0.5, _a);
    const vel = this.carry(r);
    this.sprites.spawn(pos, { vel, life: 0.3, size: [0.5, 2.6], color: 0xffd23f, cell: Cell.Ring, glow: true });
    this.sprites.spawn(pos, { vel, life: 0.18, size: [1.2, 2.4], color: 0xffffff, alpha: 0.9, cell: Cell.Sparkle, glow: true });
    this.sprites.burst(pos, 14, 5, 1.5, { gravity: 2, life: 0.7, size: [0.45, 0.12], color: 0xffd23f, cell: Cell.Sparkle, spin: 4, glow: true }, [0xffd23f, 0xffffff, 0xff9f1c, 0xff5d8f], vel);
  }

  /** Used an item: a burst in its colour. */
  item(r: Runner, item: ItemKind) {
    if (item === 'boost') this.ring(r, 0xffd23f, 10, 4.5);
    else if (item === 'shield') this.ring(r, 0x7ae0ff, 12, 3.5);
    else if (item === 'spring') { this.ring(r, 0x9be564, 6, 3); this.land(r, 1); }
    else if (item === 'rocket') { this.ring(r, 0xff9f1c, 8, 5); this.dustCloud(r, 16); }
    else if (item === 'ink') this.ring(r, 0x6c4ab6, 0, 3);
  }

  /** Focus maxed out: a crown of gold sparkles. */
  focusMax(r: Runner) {
    this.ring(r, 0xffe066, 18, 3);
  }

  /** Confetti cannons both sides of the track at distance d. */
  cannons(d: number, n = 50) {
    if (!this.path) return;
    for (const side of [-1, 1]) {
      const pos = this.at(side * (TRACK_HALF + 0.6), 1.2, d, _a).clone();
      for (let k = 0; k < n; k++) {
        const sp = 9 + Math.random() * 7;
        this.sprites.spawn(pos, {
          vel: this.vel(-side * sp * (0.25 + Math.random() * 0.3), sp * (0.8 + Math.random() * 0.4), (Math.random() - 0.3) * 5, d),
          gravity: 6, drag: 1.4, life: 2.2 + Math.random() * 1.2, size: [0.16, 0.13],
          color: CONFETTI[k % CONFETTI.length], cell: Cell.Confetti, spin: (Math.random() - 0.5) * 16,
        });
      }
    }
  }

  /** Fireworks over the finish for a few seconds (the player crossed). */
  finishShow() {
    if (!this.path) return;
    const now = this.sprites.time;
    for (let i = 0; i < 14; i++) {
      this.shells.push({ at: now + 0.15 + i * 0.38 + Math.random() * 0.2, x: (Math.random() - 0.5) * 26, y: 13 + Math.random() * 9, d: RACE_LENGTH + 28 + Math.random() * 30 });
    }
    this.cannons(RACE_LENGTH + 1, 70);
  }

  private firework(x: number, y: number, d: number) {
    const pos = this.at(x, y, d, _a);
    const [main, light] = FIREWORK[Math.floor(Math.random() * FIREWORK.length)];
    this.sprites.spawn(pos, { life: 0.3, size: [3, 9], color: light, cell: Cell.Sparkle, glow: true });
    // Two shells of sparks: fast bright ones and a slower, fuller inner bloom.
    this.sprites.burst(pos, 46, 13, 0, { gravity: 3.5, drag: 1.5, life: 1.6 + Math.random() * 0.4, size: [1, 0.3], color: main, cell: Cell.Sparkle, spin: 2, glow: true }, [main, main, light]);
    this.sprites.burst(pos, 22, 6, 0, { gravity: 2.5, drag: 1.2, life: 1.2, size: [0.8, 0.2], color: light, cell: Cell.Sparkle, spin: -2, glow: true }, [light, 0xffffff]);
  }

  dispose() {
    this.sprites.dispose();
    this.dizzy.dispose();
    this.lines.dispose();
  }
}
