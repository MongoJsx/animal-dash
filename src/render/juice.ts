// What the race does with the effects in fx.ts: dust under every footfall,
// landing and slide; stars and a "pow" on a hit; sparkles round item boxes and
// on a pickup; shockwave rings for dashes and items; confetti cannons at the gun
// and fireworks over the finish and the podium. Runners live in straight track
// space, the sprites in world space, so positions go through the path when
// spawned. What pops round the player rides in a second layer that follows
// them, so it stays with them however their speed changes.
import * as THREE from 'three';
import { ITEM, RACE_LENGTH, laneX } from '../config.ts';
import type { ItemKind, ItemBox } from '../world/items.ts';
import type { TrackPath } from '../world/path.ts';
import { Cell, Dizzy, SpeedLines, Sprites, type SpriteOpts } from './fx.ts';
import { TRACK_HALF } from './scenery.ts';

/** What the effects need to know about a runner (player, rival or online friend). */
export interface Runner { x: number; y: number; d: number; speed: number }

interface Stride { acc: number; foot: number; air: boolean }
/** `view`: placed off the camera when it climbs (right, up), for the ceremony shot. */
interface Shell { at: number; pos: THREE.Vector3; size: number; rising: boolean; view?: [number, number] }

const RISE = 0.6; // seconds a shell climbs before it bursts

const STRIDE = 2.1; // metres between footfalls at a sprint
const CONFETTI = [0xff3b5c, 0xffc93c, 0x3ddc97, 0x3a86ff, 0xb15cff, 0xffffff];
// Each firework: a deep colour that shows against a day sky, and a light one that glows.
const FIREWORK = [[0xff9f00, 0xfff3b0], [0xff1f5a, 0xffc2d1], [0x1fa2ff, 0xd8f6ff], [0x22c55e, 0xe8ffe8], [0xa855f7, 0xf3e5ff], [0xff5d1f, 0xffe0c2]];

const _f = { x: 0, y: 0, z: 0, yaw: 0, curve: 0 };
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _o = new THREE.Vector3();
const _dust = new THREE.Color();
const _white = new THREE.Color(0xffffff);

export class Juice {
  readonly sprites = new Sprites();
  /** Rides along with the player: hits, rings and pickups round them. */
  private follow: Sprites;
  readonly dizzy: Dizzy;
  readonly lines = new SpeedLines();
  readonly root = new THREE.Group();
  private path: TrackPath | null = null;
  private player: Runner | null = null;
  private strides = new WeakMap<object, Stride>();
  private shells: Shell[] = [];
  private twinkle = 0;

  constructor() {
    const map = this.sprites.mesh.material.uniforms.map.value;
    this.follow = new Sprites(map);
    this.dizzy = new Dizzy(map);
    this.root.add(this.sprites.mesh, this.follow.mesh, this.dizzy.mesh, this.lines.mesh);
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

  /**
   * Where to put a sprite round runner `r` at track point (x, y, d): the
   * player's layer (relative to them) or the world one (carried forward with
   * the runner's speed instead).
   */
  private round(r: Runner, x: number, y: number, d: number) {
    const pos = this.at(x, y, d, _a);
    if (r === this.player) {
      pos.sub(this.at(r.x, r.y, r.d, _o));
      return { layer: this.follow, pos, carry: _o.set(0, 0, 0) };
    }
    const carry = _o.copy(this.vel(0, 0, r.speed * 0.8, r.d));
    return { layer: this.sprites, pos, carry };
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
      if (Math.random() < dt * 30 * near) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.sprites.spawn(this.at(r.x + side * 0.25, 0.1, r.d - 0.1), {
          vel: this.vel(side * (1 + Math.random() * 2), 0.8 + Math.random(), r.speed * 0.6, r.d), drag: 3,
          life: 0.35, size: [0.2, 0.6], color: _dust, alpha: 0.4 * near, cell: Cell.Puff, spin: 1,
        });
      }
      return;
    }
    st.acc += r.speed * dt;
    if (st.acc < STRIDE) return;
    st.acc -= STRIDE;
    st.foot = -st.foot;
    this.sprites.spawn(this.at(r.x + st.foot * 0.17, 0.05, r.d - 0.1), {
      vel: this.vel(st.foot * 0.5, 0.5, r.speed * 0.75, r.d), drag: 3,
      life: 0.22, size: [0.1, 0.34], color: _dust, alpha: 0.32 * near, cell: Cell.Puff, spin: 0.8,
    });
  }

  private land(r: Runner, near: number) {
    const n = Math.round(8 * near);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      this.sprites.spawn(this.at(r.x + Math.cos(a) * 0.2, 0.06, r.d + Math.sin(a) * 0.2), {
        vel: this.vel(Math.cos(a) * 2.2, 0.4, Math.sin(a) * 2.2 + r.speed * 0.75, r.d), drag: 4,
        life: 0.32, size: [0.16, 0.5], color: _dust, alpha: 0.45 * near, cell: Cell.Puff, spin: 1.5,
      });
    }
  }

  /** The player's layer follows them; twinkles round the boxes ahead; fireworks due; speed lines. */
  update(dt: number, player: Runner, boxes: readonly ItemBox[] | null, taken: Set<number> | null, cam: THREE.PerspectiveCamera, head: THREE.Vector3, lines: number) {
    this.player = player;
    this.sprites.update(dt);
    this.follow.update(dt);
    this.dizzy.update(dt, head, cam);
    this.lines.update(dt, lines, cam.aspect);
    if (!this.path) return;
    this.at(player.x, player.y, player.d, this.follow.mesh.position);
    if (boxes && (this.twinkle -= dt) <= 0) {
      this.twinkle = 0.04;
      const near = boxes.filter((b) => b.d > player.d + 4 && b.d < player.d + 45 && !taken?.has(b.id));
      if (near.length) {
        const b = near[Math.floor(Math.random() * near.length)];
        this.sprites.spawn(this.at(laneX(b.lane) + (Math.random() - 0.5) * 1.2, ITEM.boxY + (Math.random() - 0.5) * 1.2, b.d + (Math.random() - 0.5) * 0.6), {
          life: 0.5, size: [0.15, 0.45], color: Math.random() < 0.5 ? 0xffe066 : 0xffffff, cell: Cell.Sparkle, spin: 2, glow: true,
        });
      }
    }
    const now = this.sprites.time;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      if (!s.rising && s.at - RISE <= now) {
        // The climb: a bright head with a fading tail.
        s.rising = true;
        if (s.view) {
          cam.getWorldDirection(_v);
          _o.crossVectors(_v, cam.up).normalize();
          s.pos.copy(cam.position).addScaledVector(_v, 6).addScaledVector(_o, s.view[0]).addScaledVector(cam.up, s.view[1]);
        }
        const h = 16 * s.size;
        _a.copy(s.pos).y -= h;
        for (let k = 0; k < 4; k++) {
          this.sprites.spawn(_a, { vel: _v.set(0, h / RISE, 0), life: RISE - k * 0.04, size: [0.5 * s.size * (1 - k * 0.2), 0.3 * s.size], color: k ? 0xffd9a0 : 0xffffff, alpha: 1 - k * 0.2, cell: Cell.Sparkle, glow: true });
          _a.y -= 0.6 * s.size;
        }
      }
      if (s.at > now) continue;
      this.shells.splice(i, 1);
      this.firework(s.pos, s.size);
    }
  }

  // ── Moments ───────────────────────────────────────────────────────
  /** Tripped, knocked down or barged: a comic "pow", stars flying, and (big) dizzy stars. */
  hit(r: Runner, big: boolean, isPlayer: boolean) {
    if (!this.path) return;
    const { layer, pos, carry } = this.round(r, r.x, r.y + 1.1, r.d + 0.3);
    const s = isPlayer ? 1 : 0.6;
    layer.spawn(pos, { vel: carry, life: 0.22, size: [0.5 * s, (big ? 2.2 : 1.4) * s], color: 0xfff1a8, cell: Cell.Burst, spin: 1.5 });
    layer.spawn(pos, { vel: carry, life: 0.3, size: [0.3 * s, (big ? 1.5 : 1) * s], color: 0xff7b2e, alpha: 0.9, cell: Cell.Burst, spin: -2 });
    layer.burst(pos, big ? 7 : 4, 4, 2.5, { gravity: 9, drag: 1.5, life: 0.6, size: [0.32 * s, 0.18 * s], color: 0xffd23f, cell: Cell.Star, spin: 7 }, [0xffd23f, 0xffb703, 0xfff3b0], carry);
    if (big) {
      for (let k = 0; k < (isPlayer ? 6 : 3); k++) {
        const a = Math.random() * Math.PI * 2;
        const g = this.round(r, r.x + Math.cos(a) * 0.4, 0.12, r.d + Math.sin(a) * 0.4);
        g.layer.spawn(g.pos, {
          vel: _v.set(Math.cos(a) * 1.6, 0.6, -Math.sin(a) * 1.6).add(g.carry), drag: 3,
          life: 0.5, size: [0.3, 0.8], color: _dust, alpha: 0.5, cell: Cell.Puff, spin: 1,
        });
      }
    }
    if (isPlayer) this.dizzy.start(big ? 1.1 : 0.5);
  }

  /** Down a hole or the like: a cloud of dust. */
  dustCloud(r: Runner, n = 10) {
    if (!this.path) return;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const g = this.round(r, r.x + Math.cos(a) * 0.5, 0.3 + Math.random() * 0.5, r.d + Math.sin(a) * 0.5);
      g.layer.spawn(g.pos, {
        vel: _v.set(Math.cos(a) * 2, 0.8 + Math.random(), -Math.sin(a) * 2).add(g.carry), drag: 2.5,
        life: 0.7, size: [0.4, 1.2], color: _dust, alpha: 0.55, cell: Cell.Puff, spin: 1,
      });
    }
  }

  /** Jumped: a little kick of dust. */
  takeoff(r: Runner) {
    if (!this.path) return;
    for (let k = 0; k < 4; k++) {
      const side = k % 2 ? 1 : -1;
      this.sprites.spawn(this.at(r.x + side * 0.2, 0.06, r.d - 0.1), {
        vel: this.vel(side * 1.4, 0.5, r.speed * 0.75, r.d), drag: 4,
        life: 0.3, size: [0.15, 0.45], color: _dust, alpha: 0.4, cell: Cell.Puff, spin: 1,
      });
    }
  }

  /** A shockwave ring round a runner (dash, items), plus optional sparkles. */
  ring(r: Runner, color: number, sparkles = 0, size = 4) {
    if (!this.path) return;
    const { layer, pos, carry } = this.round(r, r.x, r.y + 1, r.d + 0.4);
    layer.spawn(pos, { vel: carry, life: 0.35, size: [0.6, size], color, cell: Cell.Ring, glow: true });
    layer.spawn(pos, { vel: carry, life: 0.5, size: [0.4, size * 0.7], color, alpha: 0.7, cell: Cell.Ring, glow: true });
    if (sparkles) layer.burst(pos, sparkles, 5, 1, { drag: 2, life: 0.6, size: [0.45, 0.15], color, cell: Cell.Sparkle, spin: 3, glow: true }, [color, 0xffffff], carry);
  }

  /** Took an item box: a pop of gold sparkles and a ring. */
  pickup(r: Runner) {
    if (!this.path) return;
    const { layer, pos, carry } = this.round(r, r.x, ITEM.boxY, r.d + 0.5);
    layer.spawn(pos, { vel: carry, life: 0.3, size: [0.5, 2.6], color: 0xffd23f, cell: Cell.Ring, glow: true });
    layer.spawn(pos, { vel: carry, life: 0.18, size: [1.2, 2.4], color: 0xffffff, alpha: 0.9, cell: Cell.Sparkle, glow: true });
    layer.burst(pos, 16, 5, 1.5, { gravity: 2, drag: 1.5, life: 0.7, size: [0.45, 0.12], color: 0xffd23f, cell: Cell.Sparkle, spin: 4, glow: true }, [0xffd23f, 0xffffff, 0xff9f1c, 0xff5d8f], carry);
  }

  /** Used an item: a burst in its colour. */
  item(r: Runner, item: ItemKind) {
    if (item === 'boost') this.ring(r, 0xffd23f, 10, 4.5);
    else if (item === 'shield') this.ring(r, 0x7ae0ff, 12, 3.5);
    else if (item === 'spring') { this.ring(r, 0x9be564, 6, 3); this.land(r, 1); }
    else if (item === 'rocket') { this.ring(r, 0xff9f1c, 8, 5); this.dustCloud(r, 12); }
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

  /** The player crossed: fireworks over the finish (they keep going into the ceremony) and confetti. */
  finishShow() {
    if (!this.path) return;
    const now = this.sprites.time;
    for (let i = 0; i < 24; i++) {
      const pos = this.at((Math.random() - 0.5) * 30, 12 + Math.random() * 12, RACE_LENGTH + 25 + Math.random() * 35).clone();
      this.shells.push({ at: now + 0.3 + i * 0.32 + Math.random() * 0.25, pos, size: 1, rising: false });
    }
    this.cannons(RACE_LENGTH + 1, 70);
  }

  /** The ceremony: smaller fireworks either side of the podium, in the camera's view. */
  ceremonyShow() {
    const now = this.sprites.time;
    // The finish show is over the line, behind the ceremony camera now.
    this.shells.length = 0;
    for (let i = 0; i < 18; i++) {
      const side = i % 2 ? 1 : -1;
      this.shells.push({ at: now + 1.2 + i * 0.45 + Math.random() * 0.2, pos: new THREE.Vector3(), size: 0.17, rising: false, view: [side * (1.7 + Math.random() * 0.6), 0.9 + Math.random() * 0.6] });
    }
  }

  /** A shell: a rising trail, a flash, then two rings of sparks. */
  private firework(pos: THREE.Vector3, size: number) {
    const [main, light] = FIREWORK[Math.floor(Math.random() * FIREWORK.length)];
    const k = size;
    const sp = (o: Omit<SpriteOpts, 'life' | 'size'> & { life: number; size: [number, number] }) => ({ ...o, size: [o.size[0] * k, o.size[1] * k] as [number, number] });
    this.sprites.spawn(pos, sp({ life: 0.3, size: [4, 11], color: light, cell: Cell.Sparkle, glow: true }));
    // Deep-coloured sparks read against a bright sky; glowing ones light it up.
    this.sprites.burst(pos, 40, 14 * k, 0, sp({ gravity: 3.5 * k, drag: 1.4, life: 2.2, size: [1.3, 0.5], color: main, cell: Cell.Sparkle, spin: 2 }), [main]);
    this.sprites.burst(pos, 40, 13 * k, 0, sp({ gravity: 3.5 * k, drag: 1.4, life: 2, size: [1.2, 0.35], color: main, cell: Cell.Sparkle, spin: 2, glow: true }), [main, light]);
    this.sprites.burst(pos, 26, 6 * k, 0, sp({ gravity: 2.5 * k, drag: 1.2, life: 1.6, size: [0.9, 0.25], color: light, cell: Cell.Sparkle, spin: -2, glow: true }), [light, 0xffffff]);
    // Crackle: a delayed glitter that hangs where the shell burst.
    for (let i = 0; i < 12; i++) {
      _v.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).normalize().multiplyScalar(9 * k);
      this.sprites.spawn(_p.copy(pos).addScaledVector(_v, 0.8), sp({ vel: _v.multiplyScalar(0.1), gravity: 1.5 * k, life: 1.4, size: [0.6, 0.2], color: 0xffffff, cell: Cell.Sparkle, spin: 6, glow: true }));
    }
  }

  dispose() {
    this.sprites.dispose();
    this.follow.dispose();
    this.dizzy.dispose();
    this.lines.dispose();
  }
}
