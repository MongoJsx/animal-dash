// Ground, roadside scenery, zone gates and the finish line, streamed in
// 25 m chunks around the player (one lit + one glowing mesh per chunk), plus
// the sky, distant skyline, ambient particles and per-zone lighting "look".
import * as THREE from 'three';
import { BIOME_LENGTH, LANES, RACE_LENGTH, TRACK_HALF, VIEW_AHEAD, VIEW_BEHIND, laneDividers, laneX } from '../config.ts';
import { Rng } from '../core/rng.ts';
import { BIOMES, biomeAt, type BiomeId, type CountryId, type Palette } from '../world/biomes.ts';
import type { TrackPath } from '../world/path.ts';
import type { Track } from '../world/track.ts';
import { Atmosphere } from './atmosphere.ts';
import { finishArea, startArea, zoneGate } from './landmarks.ts';
import { DecorInstancer, decorList, type Placement, type Template } from './props.ts';
import { CHUNK, SCENE_HALF, buildCountryChunk, countryLandmarks } from './scenery.ts';
import { BTS_X, mountain, skytrain } from './kit.ts';
import { Shapes, flatMaterial, glowMaterial, haloMaterial, haloStrength, waterMaterial } from './shapes.ts';
import { Sky, blendLook, cloneLook, lookOf, type Look } from './sky.ts';

const SMALL_DECOR_RANGE = 90;
/** Scenery casts shadows from this far behind the runner to this far ahead (the sun's shadow box is ±14 m round a point 8 m ahead). */
const SHADOW_BEHIND = 10;
const SHADOW_AHEAD = 26;
/** Skytrain: cars, speed (m/s, toward the runner) and how often one comes by (s). */
const TRAIN = { cars: 3, speed: 17, every: 12 };

function ground(s: Shapes, water: Shapes, p: Palette, b: BiomeId, z0: number, rng: Rng) {
  const zc = z0 - CHUNK / 2;
  const half = SCENE_HALF;
  s.long(p.ground, 0, -0.1, zc, half * 2, 0.2, CHUNK);
  s.exact(() => { for (const lx of laneDividers()) s.long(p.groundAlt, lx, 0.005, zc, 0.12, 0.02, CHUNK); });
  const tint = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();
  switch (b) {
    case 'village':
      // Cobbles: rows of stones of uneven width, each a shade lighter or darker.
      for (let d = 0.45; d < CHUNK; d += 0.9) {
        let x = -half + rng.range(0, 0.4);
        while (x < half - 0.3) {
          const w = Math.min(half - 0.15 - x, rng.range(0.7, 1.3));
          s.box(tint(rng.pick([p.ground, p.groundAlt]), rng.range(0.92, 1.1)), x + w / 2, 0.012, z0 - d, w - 0.1, 0.03, 0.8);
          x += w;
        }
      }
      // Flowers in the grass verge.
      for (const side of [-1, 1]) for (let i = 0; i < 8; i++) s.sphere(rng.pick([0xffffff, 0xffd166, 0xef476f, 0xc77dff]), side * rng.range(half + 0.8, half + 3), 0.12, z0 - rng.range(0, CHUNK), 0.12, 0);
      break;
    case 'forest':
      // Packed earth with two worn wheel tracks and tufts of grass along the edges.
      for (const o of [-1.4, 1.4]) s.long(p.groundAlt, o, 0.004, zc, 0.9, 0.01, CHUNK);
      for (const side of [-1, 1]) for (let i = 0; i < 14; i++) s.cone(rng.pick([0x588157, 0x3a7d44, 0x6a994e]), side * rng.range(half - 0.3, half + 2.5), 0, z0 - rng.range(0, CHUNK), rng.range(0.12, 0.22), rng.range(0.25, 0.5), 5);
      for (const side of [-1, 1]) if (rng.chance(0.5)) {
        const z = z0 - rng.range(3, 22), x = side * rng.range(half + 1.2, half + 3);
        s.cyl(0xfefae0, x, 0, z, 0.06, 0.25, 6).sphere(0xe63946, x, 0.28, z, 0.18, 1, 0.55);
      }
      break;
    case 'harbor':
      // Pier planks across the walkway, every other one a little darker.
      for (let d = 0; d < CHUNK; d += 0.6) s.box(tint(p.ground, Math.floor(d / 0.6) % 2 ? 0.9 : 1.04), 0, 0.006, z0 - d - 0.3, half * 2 - 0.1, 0.012, 0.52);
      break;
    case 'snow':
      s.exact(() => { for (const l of LANES) for (const o of [-0.4, 0.4]) s.long(0xc9d6e8, laneX(l) + o, 0.004, zc, 0.3, 0.01, CHUNK); });
      for (const side of [-1, 1]) for (let d = 0.8; d < CHUNK; d += 1.6) s.sphere(rng.pick([0xffffff, 0xf2f6fc]), side * (half + 0.55), 0, z0 - d, 0.8, 1, rng.range(0.4, 0.65));
      break;
    default:
      // Paving stripes give a sense of speed.
      for (let i = 0; i < CHUNK; i += 5) s.box(p.groundAlt, 0, 0.004, z0 - i - 1.25, half * 2 - 0.4, 0.01, 0.35);
  }
  const curb = b === 'harbor' ? p.a : b === 'candy' ? 0xffffff : p.d;
  if (b !== 'snow') s.long(curb, -half - 0.2, 0.1, zc, 0.4, 0.4, CHUNK).long(curb, half + 0.2, 0.1, zc, 0.4, 0.4, CHUNK);
  const sideY = b === 'harbor' ? -0.6 : -0.12;
  (b === 'harbor' ? water : s).long(p.side, -half - 30.4, sideY, zc, 60, 0.2, CHUNK).long(p.side, half + 30.4, sideY, zc, 60, 0.2, CHUNK);
  if (b === 'harbor') {
    // Track is a pier: posts under it, water around.
    for (const x of [-half, half]) for (let i = 2; i < CHUNK; i += 6) s.cyl(p.a, x, -1.2, z0 - i, 0.22, 1.3, 6);
  }
}

function decor(s: Shapes, p: Palette, b: BiomeId, x: number, z: number, rng: Rng) {
  const side = Math.sign(x);
  switch (b) {
    case 'village': {
      if (rng.chance(0.65)) {
        const w = rng.range(3, 5), h = rng.range(2.6, 4), d = rng.range(3, 5);
        const cx = x + side * w / 2;
        s.box(p.b, cx, h / 2, z, w, h, d);
        s.add(new THREE.ConeGeometry(Math.max(w, d) * 0.75, 2.2, 4), rng.pick([p.c, 0x9c6644, 0x6d597a]), cx, h + 1.1, z, 0, Math.PI / 4);
        s.box(p.d, x + 0.02 * side, 0.9, z, 0.05, 1.8, 0.9);
        s.box(0x8ecae6, x + 0.02 * side, h * 0.6, z + d / 4, 0.05, 0.7, 0.7);
      } else {
        s.cyl(p.d, x, 0, z, 0.08, 3.2, 6).sphere(0xffe8a3, x, 3.3, z, 0.25, 0);
      }
      break;
    }
    case 'forest': {
      const h = rng.range(4, 8);
      if (rng.chance(0.75)) {
        s.cyl(p.a, x, 0, z, rng.range(0.3, 0.6), h * 0.5, 7);
        if (rng.chance(0.5)) s.cone(p.b, x, h * 0.4, z, rng.range(1.6, 2.4), h * 0.8, 7);
        else s.sphere(rng.pick([p.b, 0x3a7d44, 0x588157]), x, h * 0.6, z, rng.range(1.5, 2.3), 1);
      } else {
        const r = rng.range(0.6, 1.3);
        s.cyl(0xfefae0, x, 0, z, r * 0.3, r * 1.2, 7).sphere(p.c, x, r * 1.25, z, r, 1, 0.55);
        s.sphere(0xffffff, x + r * 0.4, r * 1.5, z, r * 0.15, 0);
      }
      break;
    }
    case 'candy': {
      const pick = rng.int(0, 2);
      if (pick === 0) {
        const h = rng.range(2.5, 5);
        s.cyl(0xffffff, x, 0, z, 0.08, h, 6);
        s.add(new THREE.CylinderGeometry(rng.range(0.8, 1.3), rng.range(0.8, 1.3), 0.3, 14), rng.pick([p.a, p.b, p.c]), x, h, z, Math.PI / 2, side * 0.3);
      } else if (pick === 1) {
        s.cone(rng.pick([p.a, p.b, p.c, 0x9b5de5]), x, 0, z, rng.range(0.8, 1.4), rng.range(1, 1.8), 10);
      } else {
        s.cyl(0xffd6a5, x, 0, z, 1.0, 1.2, 12, 1.3).sphere(rng.pick([p.a, 0xfff1f6]), x, 1.4, z, 1.2, 1, 0.6).sphere(p.c, x, 2.1, z, 0.25, 0);
      }
      break;
    }
    case 'harbor': {
      if (rng.chance(0.4)) {
        const len = rng.range(5, 8);
        s.box(p.a, x + side * 2, -0.1, z, 2.4, 1.2, len).box(0xfefae0, x + side * 2, 0.6, z, 2.2, 0.15, len - 0.4);
        s.cyl(p.d, x + side * 2, 0.5, z, 0.08, rng.range(4, 6), 6);
        s.add(new THREE.PlaneGeometry(2.2, 2.6), rng.pick([0xffffff, p.c]), x + side * 2, 3.2, z - 0.3, 0, Math.PI / 2);
      } else {
        s.cyl(p.a, x, -0.6, z, 0.25, rng.range(1.5, 2.5), 7);
        if (rng.chance(0.5)) s.box(p.b, x, 1.3, z, 1, 1, 1);
      }
      break;
    }
    case 'snow': {
      if (rng.chance(0.75)) {
        const h = rng.range(3, 6.5);
        s.cyl(p.a, x, 0, z, 0.2, 0.8, 6);
        for (let i = 0; i < 3; i++) s.cone(i % 2 ? 0x2d6a4f : 0x40916c, x, 0.6 + i * h * 0.25, z, (1.6 - i * 0.4) * h / 5, h * 0.4, 7);
        s.cone(0xffffff, x, 0.6 + 2 * h * 0.25 + h * 0.18, z, 0.5 * h / 5, h * 0.22, 7);
      } else {
        s.sphere(0xffffff, x, 0.55, z, 0.6, 1).sphere(0xffffff, x, 1.35, z, 0.42, 1).sphere(0xffffff, x, 1.95, z, 0.3, 1);
        s.cone(0xf77f00, x - side * 0.3, 1.95, z, 0.06, 0.3, 5);
      }
      break;
    }
  }
}

function far(s: Shapes, p: Palette, b: BiomeId, z: number, rng: Rng) {
  for (const side of [-1, 1]) {
    if (!rng.chance(0.6)) continue;
    const x = side * rng.range(26, 40);
    if (b === 'snow') {
      // Snowy peaks: rock below, a white cap.
      const r = rng.range(8, 13), h = rng.range(12, 22);
      mountain(s, rng, x, -0.5, z, r, h, [0x8d99ae, 0x7d8597], 0.5);
    } else if (b === 'forest') {
      for (let i = 0; i < 3; i++) s.cone(rng.pick([0x52796f, 0x3a5a40, 0x588157]), x + rng.range(-4, 4), -0.2, z + rng.range(-6, 6), rng.range(3, 5), rng.range(10, 18), 7);
    } else if (b === 'harbor') {
      s.box(p.a, x, 2, z, 6, 4, 14).prism(p.d, x, 4, z, 6.6, 3, 14.4);
    } else {
      mountain(s, rng, x, -2, z, rng.range(8, 13), rng.range(6, 10), b === 'candy' ? [p.a, p.b, 0xffd6ff] : [0x90be6d, 0x83b05f, 0x9cc77a]);
    }
  }
}

interface Chunk { meshes: THREE.Mesh[]; placements: Placement[]; small: Placement[] }

/** Kinds that rise into the air or need headroom: overhead scenery keeps clear of them. */
const TALL = new Set(['pendulum', 'drop', 'bounce']);

export class Environment {
  readonly root = new THREE.Group();
  readonly sky: Sky;
  readonly atmosphere = new Atmosphere();
  readonly look: Look;
  readonly country: CountryId | null;
  private chunks = new Map<number, Chunk>();
  private instancer = new DecorInstancer();
  private landmarks: THREE.Mesh[] = [];
  private seed: number;
  private biomes: BiomeId[];
  private path: TrackPath;
  private busy: [number, number][];
  private zone: BiomeId;
  /** Bangkok's skytrain, running along its viaduct toward the runner; the stretch of track it runs over. */
  private train: { group: THREE.Group; from: number; to: number; frontD: number; wait: number } | null = null;

  constructor(seed: number, biomes: BiomeId[], track: Track, path: TrackPath) {
    this.seed = seed;
    this.biomes = biomes;
    this.path = path;
    this.country = BIOMES[biomes[0]].country ?? null;
    this.busy = track.obstacles.filter((o) => TALL.has(o.kind)).map((o) => [o.d - 2, o.d + o.length + 2]);
    this.zone = biomes[0];
    this.look = lookOf(BIOMES[biomes[0]]);
    this.sky = new Sky(this.country, seed);
    this.root.add(this.instancer.root, this.sky.root, this.atmosphere.mesh);
    this.atmosphere.set(BIOMES[biomes[0]].particles, 0);
    this.addLandmarks();
    const city = biomes.indexOf('th_city');
    if (city >= 0) {
      const lit = new Shapes(), glow = new Shapes();
      lit.widen = glow.widen = true;
      skytrain({ lit, glow }, BTS_X, TRAIN.cars);
      const group = new THREE.Group();
      group.add(...this.batchMeshes(lit, glow, false));
      group.visible = false;
      this.root.add(group);
      this.train = { group, from: city * BIOME_LENGTH, to: (city + 1) * BIOME_LENGTH, frontD: -1e9, wait: 3 };
    }
  }

  /** Send a train down the viaduct now and then while the runner is under it. */
  private runTrain(playerD: number, dt: number) {
    const t = this.train!;
    const len = TRAIN.cars * 20.6;
    t.frontD -= TRAIN.speed * dt;
    // Gone past the camera: wait, then the next one appears far up the line.
    if (t.frontD + len < playerD - VIEW_BEHIND) {
      t.wait -= dt;
      if (t.wait <= 0 && playerD > t.from - 60 && playerD < t.to - 80) {
        t.frontD = Math.min(t.to, playerD + VIEW_AHEAD * 0.9);
        t.wait = TRAIN.every;
      }
    }
    // The viaduct ends at the zone's edges: no train hangs past them.
    const tail = t.frontD + len;
    t.group.visible = t.frontD > t.from && tail < t.to + 1 && t.frontD < playerD + VIEW_AHEAD;
    t.group.position.z = -t.frontD;
  }

  private clear = (d0: number, d1: number) => !this.busy.some(([a, b]) => b > d0 && a < d1);

  /** Place a Sketchfab decor model `height` tall, turned to face the track. */
  private place(out: Placement[], t: Template, x: number, z: number, height: number, rng: Rng) {
    const s = height / t.size[1];
    const yaw = (x > 0 ? -Math.PI / 2 : Math.PI / 2) + rng.range(-0.35, 0.35);
    // Keep the whole footprint off the track.
    const reach = (Math.max(t.size[0], t.size[2]) * s) / 2;
    const px = Math.sign(x) * Math.max(Math.abs(x), TRACK_HALF + 0.6 + reach);
    out.push({ t, matrix: new THREE.Matrix4().compose(new THREE.Vector3(px, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(s, s, s)) });
  }

  private add(...meshes: THREE.Mesh[]) {
    this.landmarks.push(...meshes);
    this.root.add(...meshes);
  }

  private batchMeshes(lit: Shapes, glow: Shapes, castShadow = true, water?: Shapes, halo?: Shapes): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    if (halo && !halo.empty) {
      const m = new THREE.Mesh(halo.build(), haloMaterial);
      m.renderOrder = 5;
      out.push(m);
    }
    if (water && !water.empty) {
      const m = new THREE.Mesh(water.build(), waterMaterial);
      m.receiveShadow = true;
      out.push(m);
    }
    if (!lit.empty) {
      const m = lit.mesh();
      m.castShadow = castShadow;
      out.push(m);
    }
    if (!glow.empty) out.push(new THREE.Mesh(glow.build(), glowMaterial));
    return out;
  }

  private addLandmarks() {
    const country = this.country;
    const lit = new Shapes(), glow = new Shapes(), halo = new Shapes();
    lit.widen = glow.widen = halo.widen = true;
    const b = { lit, glow, halo };
    const extras = startArea(b, country, this.seed);
    for (let d = BIOME_LENGTH; d < RACE_LENGTH; d += BIOME_LENGTH) extras.push(...zoneGate(b, country, BIOMES[biomeAt(this.biomes, d + 1)], d));
    extras.push(...finishArea(b, country, RACE_LENGTH, this.seed));
    if (country) countryLandmarks(b, this.biomes, (i) => i * BIOME_LENGTH);
    this.add(...this.batchMeshes(lit, glow, true, undefined, halo), ...extras);
  }

  private build(i: number): Chunk {
    const d0 = i * CHUNK;
    const b = biomeAt(this.biomes, d0 + 1);
    const p = BIOMES[b];
    const rng = new Rng(this.seed * 7919 + i);
    const s = new Shapes();
    const glow = new Shapes();
    const water = new Shapes(), halo = new Shapes();
    s.widen = glow.widen = water.widen = halo.widen = true;
    // Props are placed, not drawn: move them out by the extra track width by hand.
    const by = TRACK_HALF - SCENE_HALF;
    const placements: Placement[] = [];
    const smallPlacements: Placement[] = [];
    if (buildCountryChunk({ lit: s, glow, water, halo, rng, biome: b, p, d0, clear: this.clear })) {
      return { meshes: this.batchMeshes(s, glow, false, water, halo), placements, small: smallPlacements };
    }
    const large = decorList('large', b);
    const small = decorList('small', b);
    ground(s, water, p, b, -d0, rng);
    for (const side of [-1, 1]) {
      for (let z = rng.range(0, 4); z < CHUNK; z += rng.range(5, 9)) {
        const near = side * rng.range(SCENE_HALF + 1.8, SCENE_HALF + 6);
        if (large.length) this.place(placements, rng.pick(large), near + side * by, -d0 - z, rng.range(3.5, 6.5), rng);
        else decor(s, p, b, near, -d0 - z, rng);
        if (rng.chance(large.length ? 0.3 : 0.5)) {
          const back = side * rng.range(SCENE_HALF + 9, SCENE_HALF + 17);
          if (large.length) this.place(placements, rng.pick(large), back + side * by, -d0 - z - 2, rng.range(4.5, 8), rng);
          else decor(s, p, b, back, -d0 - z - 2, rng);
        }
        if (small.length && rng.chance(0.6)) {
          this.place(smallPlacements, rng.pick(small), side * rng.range(TRACK_HALF + 0.9, TRACK_HALF + 2.2), -d0 - z - 3, rng.range(0.6, 1.3), rng);
        }
      }
    }
    far(s, p, b, -d0 - CHUNK / 2, rng);
    return { meshes: this.batchMeshes(s, glow, false, water), placements, small: smallPlacements };
  }

  /** Stream chunks, blend the zone look, move sky and particles. */
  update(playerD: number, dt: number, cam: THREE.Vector3) {
    const first = Math.max(-2, Math.floor((playerD - VIEW_BEHIND) / CHUNK));
    const last = Math.floor((playerD + VIEW_AHEAD) / CHUNK);
    let changed = false;
    for (const [i, c] of this.chunks) {
      if (i < first || i > last) {
        for (const m of c.meshes) {
          this.root.remove(m);
          m.geometry.dispose();
        }
        this.chunks.delete(i);
        changed = true;
      }
    }
    for (let i = first; i <= last; i++) {
      if (!this.chunks.has(i)) {
        const c = this.build(i);
        this.chunks.set(i, c);
        this.root.add(...c.meshes);
        changed = true;
      }
    }
    // Scenery right round the runner casts real shadows (the shadow map only
    // covers a few metres anyway); everything further out is left out of that pass.
    for (const [i, c] of this.chunks) {
      const near = i * CHUNK < playerD + SHADOW_AHEAD && (i + 1) * CHUNK > playerD - SHADOW_BEHIND;
      for (const m of c.meshes) if (m.material === flatMaterial) m.castShadow = near;
    }
    // Small props vanish into the distance: only draw them in nearby chunks.
    if (changed) {
      this.instancer.rebuild([...this.chunks].flatMap(([i, c]) =>
        i * CHUNK < playerD + SMALL_DECOR_RANGE ? [...c.placements, ...c.small] : c.placements));
    }

    // The look changes a little before each gate so you run into the new mood.
    const zone = biomeAt(this.biomes, playerD + 25);
    if (zone !== this.zone) {
      this.zone = zone;
      this.atmosphere.set(BIOMES[zone].particles, playerD);
    }
    blendLook(this.look, lookOf(BIOMES[zone]), dt > 0 ? 1 - Math.exp(-dt * 0.9) : 1);
    if (this.train) this.runTrain(playerD, dt);
    haloStrength.value = 0.06 + 0.3 * this.look.night;
    this.atmosphere.update(dt, playerD);
    const f = this.path.frame(playerD);
    this.sky.update(cam, this.look, f.y + this.groundBelow(playerD), f.yaw, dt);
  }

  /** Far ground height: below every bit of track in view. */
  private groundBelow(playerD: number) {
    let min = Infinity;
    const base = this.path.frame(playerD).y;
    for (let d = playerD - 20; d < playerD + VIEW_AHEAD; d += 20) min = Math.min(min, this.path.frame(d).y);
    const side = Math.min(0, BIOMES[this.zone].sideY ?? 0);
    return min - base + side - 0.6;
  }

  snapLook(playerD: number) {
    this.zone = biomeAt(this.biomes, playerD + 25);
    Object.assign(this.look, cloneLook(lookOf(BIOMES[this.zone])));
    this.atmosphere.set(BIOMES[this.zone].particles, playerD);
  }

  dispose() {
    for (const c of this.chunks.values()) for (const m of c.meshes) m.geometry.dispose();
    this.chunks.clear();
    this.train?.group.children.forEach((m) => (m as THREE.Mesh).geometry.dispose());
    this.instancer.dispose();
    this.sky.dispose();
    this.atmosphere.dispose();
    // Landmark batches share materials; banners own their material and canvas texture.
    for (const m of this.landmarks) {
      m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial;
      if (mat.map) {
        mat.map.dispose();
        mat.dispose();
      }
    }
    this.landmarks = [];
  }
}
