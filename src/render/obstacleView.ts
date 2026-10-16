// Greybox models for every obstacle kind, coloured per biome. Each view is a
// group at the obstacle's near edge (local -z runs down the track); static parts
// are cached merged geometry, moving parts are updated from the same pure
// functions the collision code uses.
import * as THREE from 'three';
import { LANE_WIDTH, laneX } from '../config.ts';
import { BIOMES, type BiomeId, type Palette } from '../world/biomes.ts';
import {
  DROP, PENDULUM, SWEEPER, TRAIN_RAMP, dropProgress, movingD, pendulumAngle, shifterX,
  spikeLift, sweeperAngle, type Obstacle,
} from '../world/obstacles.ts';
import { fitScale, fitTarget } from '../world/propFit.ts';
import { fitted, fittedHeight, obstacleProp } from './props.ts';
import { Shapes, flatMaterial, shadowMaterial } from './shapes.ts';

const W = LANE_WIDTH - 0.3; // visual width of a one-lane obstacle
const TRACK_W = LANE_WIDTH * 3;
const geoCache = new Map<string, THREE.BufferGeometry | null>();

/** Build once per key; null when nothing procedural is left (a model replaced it all). */
function cached(key: string, make: (s: Shapes) => void): THREE.BufferGeometry | null {
  if (!geoCache.has(key)) {
    const s = new Shapes();
    make(s);
    geoCache.set(key, s.empty ? null : s.build());
  }
  return geoCache.get(key)!;
}

const meshOf = (g: THREE.BufferGeometry) => {
  const m = new THREE.Mesh(g, flatMaterial);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

// ── Static shapes per kind and biome ──────────────────────────────────
function lowbar(s: Shapes, b: BiomeId, p: Palette) {
  switch (b) {
    case 'forest':
      s.add(new THREE.CylinderGeometry(0.42, 0.42, W, 9), p.a, 0, 0.42, -0.3, 0, 0, Math.PI / 2);
      s.add(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 9), 0xd9b98c, W / 2 + 0.02, 0.42, -0.3, 0, 0, Math.PI / 2);
      break;
    case 'candy':
      s.box(p.d, 0, 0.45, -0.3, W, 0.9, 0.5);
      for (let i = -2; i <= 2; i++) s.box(0x8b5e3c, i * 0.42, 0.92, -0.3, 0.36, 0.06, 0.42);
      break;
    case 'harbor':
      s.cyl(p.a, -W / 2, 0, -0.3, 0.14, 1.1).cyl(p.a, W / 2, 0, -0.3, 0.14, 1.1);
      s.add(new THREE.CylinderGeometry(0.06, 0.06, W, 6), p.b, 0, 0.85, -0.3, 0, 0, Math.PI / 2);
      s.add(new THREE.CylinderGeometry(0.06, 0.06, W, 6), p.b, 0, 0.5, -0.3, 0, 0, Math.PI / 2);
      break;
    default: {
      const post = b === 'snow' ? 0xffffff : p.a;
      s.box(post, -W / 2 + 0.1, 0.48, -0.3, 0.16, 0.95, 0.16).box(post, W / 2 - 0.1, 0.48, -0.3, 0.16, 0.95, 0.16);
      s.box(p.a, 0, 0.78, -0.3, W, 0.16, 0.08).box(p.a, 0, 0.42, -0.3, W, 0.16, 0.08);
      if (b === 'snow') s.box(0xffffff, 0, 0.9, -0.3, W, 0.1, 0.2);
    }
  }
}

function highbar(s: Shapes, b: BiomeId, p: Palette, board: boolean) {
  const post = b === 'forest' ? p.a : p.d;
  s.box(post, -W / 2, 1.6, -0.3, 0.16, 3.2, 0.16).box(post, W / 2, 1.6, -0.3, 0.16, 3.2, 0.16);
  s.box(post, 0, 3.15, -0.3, W + 0.2, 0.14, 0.16);
  if (!board) {
    s.box(post, -0.55, 2.6, -0.3, 0.04, 1.1, 0.04).box(post, 0.55, 2.6, -0.3, 0.04, 1.1, 0.04);
  } else if (b === 'forest') {
    s.add(new THREE.CylinderGeometry(0.3, 0.38, W + 0.6, 7), p.a, 0, 1.55, -0.3, 0, 0, Math.PI / 2);
    s.sphere(p.b, -0.6, 1.9, -0.3, 0.55).sphere(p.b, 0.5, 1.85, -0.3, 0.5);
  } else {
    s.box(p.c, 0, 1.6, -0.3, W - 0.1, 1.0, 0.12);
    s.box(p.b, 0, 1.6, -0.24, W - 0.4, 0.7, 0.04);
    s.box(p.d, -0.55, 2.4, -0.3, 0.04, 0.7, 0.04).box(p.d, 0.55, 2.4, -0.3, 0.04, 0.7, 0.04);
  }
}

function wall(s: Shapes, b: BiomeId, p: Palette, len: number) {
  const z = -len / 2;
  switch (b) {
    case 'forest':
      s.cyl(p.a, 0, 0, z, 0.75, 3.2, 9, 0.6);
      s.cone(p.b, 0, 2.6, z, 1.5, 3.2, 8);
      break;
    case 'candy':
      s.cyl(p.d, 0, 0, z, 1.05, 1.0, 12).cyl(0xfff1e6, 0, 1.0, z, 1.05, 0.25, 12);
      s.cyl(p.a, 0, 1.25, z, 0.85, 0.9, 12).cyl(0xfff1e6, 0, 2.15, z, 0.85, 0.2, 12);
      s.sphere(p.c, 0, 2.6, z, 0.28);
      break;
    case 'harbor':
      for (const [x, y] of [[-0.5, 0], [0.5, 0], [0, 1.25]]) s.cyl(p.a, x, y, z, 0.55, 1.2, 10).cyl(p.d, x, y + 0.55, z, 0.57, 0.1, 10);
      s.cyl(p.a, 0, 2.45, z, 0.45, 0.5, 10);
      break;
    case 'snow':
      s.box(p.b, 0, 1.45, z, W, 2.9, len).box(0xffffff, 0, 2.95, z, W + 0.1, 0.15, len + 0.1);
      break;
    default:
      s.box(p.a, -0.45, 0.6, z, 1.1, 1.2, len * 0.9).box(p.b, 0.55, 0.6, z, 0.9, 1.2, len * 0.8);
      s.box(p.a, 0.1, 1.85, z, 1.2, 1.3, len * 0.9);
      s.box(p.d, -0.45, 0.6, z + len * 0.46, 1.12, 0.12, 0.02).box(p.d, 0.1, 1.85, z + len * 0.46, 1.22, 0.12, 0.02);
  }
}

function hay(s: Shapes, b: BiomeId, p: Palette, len: number) {
  const z = -len / 2;
  switch (b) {
    case 'forest': s.cyl(p.a, 0, 0, z, 0.8, 1.1, 10, 0.7).cyl(0xd9b98c, 0, 1.08, z, 0.7, 0.04, 10); break;
    case 'candy': s.cyl(0xfff1f6, -0.4, 0, z, 0.55, 1.1, 10).cyl(p.a, 0.45, 0, z, 0.5, 1.0, 10); break;
    case 'harbor': s.add(new THREE.TorusGeometry(0.6, 0.25, 6, 14), p.b, 0, 0.25, z, Math.PI / 2).add(new THREE.TorusGeometry(0.45, 0.22, 6, 12), p.b, 0, 0.62, z, Math.PI / 2); break;
    case 'snow': s.sphere(0xffffff, 0, 0.3, z, 1.0, 1, 0.8); break;
    default:
      s.add(new THREE.CylinderGeometry(0.58, 0.58, W - 0.2, 10), 0xe9c46a, 0, 0.58, z, 0, 0, Math.PI / 2);
      s.add(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 10), 0xc9a227, -0.4, 0.58, z, 0, 0, Math.PI / 2);
      s.add(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 10), 0xc9a227, 0.4, 0.58, z, 0, 0, Math.PI / 2);
  }
}

const trainCars = (len: number, ramp: boolean) => Math.max(1, Math.round((len - (ramp ? TRAIN_RAMP : 0)) / 9));

function train(s: Shapes, p: Palette, len: number, ramp: boolean, cars: boolean) {
  const start = ramp ? TRAIN_RAMP : 0;
  const body = len - start;
  const count = trainCars(len, ramp);
  const carLen = body / count;
  for (let i = 0; cars && i < count; i++) {
    const z = -(start + carLen * i + carLen / 2);
    s.box(i % 2 ? p.a : p.c, 0, 1.45, z, W, 2.2, carLen - 0.5);
    s.box(p.b, 0, 2.6, z, W + 0.1, 0.12, carLen - 0.4);
    s.box(0xfefae0, -W / 2 - 0.01, 1.7, z, 0.02, 0.6, carLen - 2);
    s.box(0xfefae0, W / 2 + 0.01, 1.7, z, 0.02, 0.6, carLen - 2);
    for (const wz of [-carLen / 2 + 1.2, carLen / 2 - 1.2]) {
      s.add(new THREE.CylinderGeometry(0.35, 0.35, W + 0.1, 10), p.d, 0, 0.35, z + wz, 0, 0, Math.PI / 2);
    }
    if (i > 0) s.box(p.d, 0, 0.8, z + carLen / 2, 0.3, 0.3, 0.6);
  }
  if (cars) s.box(p.d, 0, 1.6, -start - 0.02, W - 0.4, 0.8, 0.05); // front window
  if (ramp) {
    const slope = Math.atan2(2.6, TRAIN_RAMP);
    const hyp = Math.hypot(2.6, TRAIN_RAMP);
    s.add(new THREE.BoxGeometry(W, 0.15, hyp), p.b, 0, 1.3, -TRAIN_RAMP / 2, slope);
    s.box(p.d, -W / 2 + 0.05, 0.65, -TRAIN_RAMP * 0.7, 0.1, 1.3, TRAIN_RAMP * 0.55);
    s.box(p.d, W / 2 - 0.05, 0.65, -TRAIN_RAMP * 0.7, 0.1, 1.3, TRAIN_RAMP * 0.55);
  }
}

function cart(s: Shapes, b: BiomeId, p: Palette, len: number) {
  const z = -len / 2;
  if (b === 'forest') {
    // Charging boar.
    s.sphere(0x5c4033, 0, 0.95, z, 0.9, 1, 0.8).sphere(0x4a3428, 0, 1.05, z + len / 2 - 0.4, 0.55);
    s.cone(0xfefae0, -0.3, 0.75, z + len / 2 - 0.1, 0.08, 0.35).cone(0xfefae0, 0.3, 0.75, z + len / 2 - 0.1, 0.08, 0.35);
    return;
  }
  if (b === 'candy') {
    s.add(new THREE.TorusGeometry(0.75, 0.38, 8, 16), p.c, 0, 1.15, z, 0, Math.PI / 2);
    s.add(new THREE.TorusGeometry(0.75, 0.4, 8, 16), p.a, 0.06, 1.15, z, 0, Math.PI / 2, 0, 0.95, 0.95, 0.6);
    return;
  }
  s.box(b === 'snow' ? p.c : p.a, 0, 1.0, z, W - 0.3, 0.9, len);
  s.box(p.b, 0, 1.55, z, W - 0.4, 0.3, len - 0.4);
  for (const wz of [-len / 2 + 0.6, len / 2 - 0.6]) s.add(new THREE.CylinderGeometry(0.45, 0.45, W - 0.1, 10), p.d, 0, 0.45, z + wz, 0, 0, Math.PI / 2);
  s.box(p.d, 0, 0.9, z + len / 2 + 0.3, 0.12, 0.12, 0.8);
}

function staticGeometry(o: Obstacle, modelled: boolean): THREE.BufferGeometry | null {
  const p = BIOMES[o.biome];
  const k = `${o.kind}|${o.biome}|${o.length.toFixed(1)}|${o.ramp}|${modelled}`;
  switch (o.kind) {
    case 'lowbar': return modelled ? null : cached(k, (s) => lowbar(s, o.biome, p));
    case 'highbar': return cached(k, (s) => highbar(s, o.biome, p, !modelled));
    case 'wall': return modelled ? null : cached(k, (s) => wall(s, o.biome, p, o.length));
    case 'hay': return modelled ? null : cached(k, (s) => hay(s, o.biome, p, o.length));
    case 'train': return cached(k, (s) => train(s, p, o.length, o.ramp, !modelled));
    case 'gap': return cached(k, (s) => {
      const water = o.biome === 'harbor' || o.biome === 'village' ? 0x2a6f97 : o.biome === 'candy' ? 0x5c3a21 : o.biome === 'snow' ? 0x89c2d9 : 0x3d2b1f;
      s.box(water, 0, -0.02, -o.length / 2, TRACK_W + 0.6, 0.06, o.length);
      s.box(p.d, 0, 0.04, -0.05, TRACK_W + 0.6, 0.1, 0.12).box(p.d, 0, 0.04, -o.length + 0.05, TRACK_W + 0.6, 0.1, 0.12);
    });
    case 'slow': return cached(k, (s) => {
      const goo = o.biome === 'candy' ? 0xc68642 : o.biome === 'snow' ? 0xf8fbff : o.biome === 'harbor' ? 0x8d99ae : 0x6b4a2b;
      s.box(goo, 0, 0.03, -o.length / 2, W, 0.06, o.length);
      for (let i = 0; i < 5; i++) s.sphere(goo, (i % 2 ? 0.4 : -0.4), 0.06, -1 - i * (o.length - 2) / 4, 0.25, 0, 0.3);
    });
    case 'pendulum': return cached(k, (s) => {
      const x = PENDULUM.arm * Math.sin(PENDULUM.amplitude) + 0.9;
      s.box(p.d, -x, PENDULUM.pivot / 2 + 0.2, -0.7, 0.3, PENDULUM.pivot + 0.4, 0.3);
      s.box(p.d, x, PENDULUM.pivot / 2 + 0.2, -0.7, 0.3, PENDULUM.pivot + 0.4, 0.3);
      s.box(p.a, 0, PENDULUM.pivot + 0.3, -0.7, 2 * x + 0.3, 0.35, 0.4);
    });
    case 'spikes': return cached(k, (s) => {
      s.box(p.d, 0, 0.03, -o.length / 2, W, 0.06, o.length);
      for (let i = 0; i < 6; i++) s.box(0x222222, -0.75 + (i % 3) * 0.75, 0.065, -0.6 - Math.floor(i / 3) * 1.2, 0.3, 0.02, 0.3);
    });
    case 'sweeper': return cached(k, (s) => s.cyl(p.d, 0, 0, -o.length / 2, 0.35, 0.9, 10).cyl(p.c, 0, 0.9, -o.length / 2, 0.42, 0.12, 10));
    case 'bounce': return modelled ? null : cached(k, (s) => {
      s.cyl(p.d, 0, 0, -o.length / 2, 0.85, 0.25, 12);
      s.cyl(o.biome === 'forest' ? p.c : p.b, 0, 0.25, -o.length / 2, 0.75, 0.08, 12);
    });
    default: return null;
  }
}

// ── Moving parts ──────────────────────────────────────────────────────
function movingGeometry(o: Obstacle, armOnly = false): THREE.BufferGeometry | null {
  const p = BIOMES[o.biome];
  const k = `${o.kind}|${o.biome}|${o.length.toFixed(1)}|moving|${armOnly}`;
  switch (o.kind) {
    case 'oncoming': return cached(k, (s) => cart(s, o.biome, p, o.length));
    case 'rolling': return cached(k, (s) => {
      const col = o.biome === 'snow' ? 0xffffff : o.biome === 'candy' ? p.a : p.a;
      s.add(new THREE.CylinderGeometry(0.55, 0.55, 1.2, 12), col, 0, 0, 0, 0, 0, Math.PI / 2);
      s.add(new THREE.CylinderGeometry(0.57, 0.57, 0.12, 12), p.d, 0.35, 0, 0, 0, 0, Math.PI / 2);
      s.add(new THREE.CylinderGeometry(0.57, 0.57, 0.12, 12), p.d, -0.35, 0, 0, 0, 0, Math.PI / 2);
    });
    case 'shifter': return cached(k, (s) => {
      s.box(p.b, 0, 1.15, -0.7, 1.3, 1.0, 1.8).sphere(p.c, 0, 1.5, 0.35, 0.45);
      for (const [lx, lz] of [[-0.45, -0.1], [0.45, -0.1], [-0.45, -1.3], [0.45, -1.3]]) s.box(p.d, lx, 0.33, lz, 0.2, 0.66, 0.2);
      s.cone(0xfefae0, -0.3, 1.85, 0.35, 0.08, 0.3).cone(0xfefae0, 0.3, 1.85, 0.35, 0.08, 0.3);
    });
    case 'pendulum': return cached(k, (s) => {
      s.box(p.d, 0, -PENDULUM.arm / 2, 0, 0.14, PENDULUM.arm, 0.14);
      if (armOnly) return;
      s.add(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 12), p.c, 0, -PENDULUM.arm, 0, 0, 0, Math.PI / 2);
      s.add(new THREE.CylinderGeometry(0.72, 0.72, 0.15, 12), p.d, 0.5, -PENDULUM.arm, 0, 0, 0, Math.PI / 2);
      s.add(new THREE.CylinderGeometry(0.72, 0.72, 0.15, 12), p.d, -0.5, -PENDULUM.arm, 0, 0, 0, Math.PI / 2);
    });
    case 'spikes': return cached(k, (s) => {
      const tip = o.biome === 'snow' ? p.b : o.biome === 'candy' ? 0xfff1f6 : 0xdee2e6;
      for (let i = 0; i < 6; i++) s.cone(tip, -0.75 + (i % 3) * 0.75, 0, -0.6 - Math.floor(i / 3) * 1.2, 0.2, 0.85, 6);
    });
    case 'drop': return cached(k, (s) => {
      if (o.biome === 'harbor') s.sphere(0x2b2d42, 0, 0.6, 0, 0.6, 1);
      else if (o.biome === 'candy') s.sphere(p.c, 0, 0.55, 0, 0.55, 1).cyl(0x386641, 0, 1.05, 0, 0.04, 0.4);
      else if (o.biome === 'snow') s.add(new THREE.ConeGeometry(0.5, 1.2, 6), p.b, 0, 0.6, 0, Math.PI);
      else s.cyl(p.c, 0, 0, 0, 0.45, 0.7, 10, 0.6).sphere(p.b, 0, 0.9, 0, 0.45);
    });
    case 'sweeper': return cached(k, (s) => {
      s.box(p.c, 0, 0, 0, SWEEPER.half * 2, 0.35, 0.35);
      for (let i = -3; i <= 3; i += 2) s.box(0xffffff, (i / 4) * SWEEPER.half, 0, 0, 0.35, 0.37, 0.37);
    });
    default: return null;
  }
}

const shadowGeo = new THREE.CircleGeometry(0.8, 16).rotateX(-Math.PI / 2);

/** Centre a fitted model on its own middle so it can spin in place. */
function spinning(model: THREE.Object3D, h: number) {
  const g = new THREE.Group();
  model.position.y = -h / 2;
  g.add(model);
  return g;
}

export class ObstacleView {
  readonly root = new THREE.Group();
  private moving: THREE.Object3D | null = null;
  private shadow: THREE.Mesh | null = null;
  private knock = 0; // seconds since the player smashed it
  private knockDir = 1;
  private knockX = 0;
  private spinRadius = 0.55; // rolling: height of the spin axis
  private spikeHeight = 0.85;

  readonly o: Obstacle;

  constructor(o: Obstacle) {
    this.o = o;
    const isSpanning = o.kind === 'gap' || o.kind === 'shifter' || o.kind === 'pendulum' || o.kind === 'sweeper';
    this.root.position.set(isSpanning ? 0 : laneX(o.lane), 0, -o.d);
    const prop = obstacleProp(o);
    const fit = fitTarget(o);

    const st = staticGeometry(o, !!prop && o.kind !== 'spikes' && o.kind !== 'pendulum' && o.kind !== 'sweeper');
    if (st) this.root.add(meshOf(st));

    if (prop && o.kind === 'train') {
      // Cars fill their whole slot so the solid train box has no invisible gaps.
      const start = o.ramp ? TRAIN_RAMP : 0;
      const count = trainCars(o.length, o.ramp);
      const carLen = (o.length - start) / count;
      for (let i = 0; i < count; i++) {
        const car = fitted(prop, W, 2.58, carLen - 0.15, { centered: true, stretchDepthFree: true });
        car.position.z = -(start + carLen * i + carLen / 2);
        this.root.add(car);
      }
    } else if (prop && fit) {
      const model = fitted(prop, fit.w, fit.h, fit.d, fit.opts);
      const h = fittedHeight(prop, fit.w, fit.h, fit.d, fit.opts);
      switch (o.kind) {
        case 'lowbar': case 'hay': case 'wall': this.root.add(model); break;
        case 'bounce': model.position.z = -o.length / 2; this.root.add(model); break;
        case 'oncoming': this.moving = model; break;
        case 'rolling': {
          const sz = prop.size;
          const [, ky, kz] = fitScale(sz, fit.w, fit.h, fit.d, fit.opts);
          this.spinRadius = Math.min(1.1, Math.max(sz[1] * ky, sz[2] * kz)) / 2;
          this.moving = spinning(model, h);
          break;
        }
        case 'shifter': this.moving = model; break;
        case 'pendulum': {
          const g = new THREE.Group();
          g.add(meshOf(movingGeometry(o, true)!));
          model.position.y = -PENDULUM.arm - h / 2; // head centred on the arm's end, like its hitbox
          g.add(model);
          this.moving = g;
          break;
        }
        case 'spikes': this.spikeHeight = h; this.moving = model; break;
        case 'drop': this.moving = model; break;
        case 'sweeper': this.moving = spinning(model, h); break;
        default: break;
      }
    }
    if (!this.moving) {
      const mv = movingGeometry(o);
      if (mv) this.moving = meshOf(mv);
    }
    if (this.moving && o.kind === 'shifter') {
      // Turn about the body's own centre (the hitbox centre), not the near edge.
      const pivot = new THREE.Group();
      pivot.position.z = -o.length / 2;
      if (!prop) this.moving.position.z = o.length / 2; // greybox is modelled around z = -0.7
      pivot.add(this.moving);
      this.moving = pivot;
    }
    if (this.moving) this.root.add(this.moving);
    if (o.kind === 'drop') {
      this.shadow = new THREE.Mesh(shadowGeo, shadowMaterial.clone());
      this.shadow.position.set(0, 0.03, -o.length / 2);
      this.root.add(this.shadow);
    }
    this.update(0, 0);
  }

  /** Called once when the player smashes through it. */
  smash(fromX: number) {
    if (this.o.kind === 'gap' || this.o.kind === 'slow' || this.o.kind === 'train' || this.o.kind === 'bounce') return;
    this.knock = 0.0001;
    this.knockDir = fromX <= this.root.position.x ? 1 : -1;
  }

  update(t: number, dt: number) {
    const o = this.o;
    const m = this.moving;
    switch (o.kind) {
      case 'oncoming':
      case 'rolling': {
        const d = movingD(o, t);
        this.root.position.z = -d;
        if (m && o.kind === 'rolling') {
          m.position.set(0, this.spinRadius, -o.length / 2);
          m.rotation.x = -(o.d - d) / this.spinRadius - t * 2;
        }
        break;
      }
      case 'shifter':
        if (m) {
          const x = shifterX(o, t);
          m.position.x = x;
          m.rotation.y = Math.cos(Math.PI * 2 * (t / o.period + o.phase)) > 0 ? Math.PI / 2 : -Math.PI / 2; // face the way it walks
          m.position.y = Math.abs(Math.sin(t * 9)) * 0.08;
        }
        break;
      case 'pendulum':
        if (m) {
          m.position.set(0, PENDULUM.pivot, -0.7);
          m.rotation.z = pendulumAngle(o, t);
        }
        break;
      case 'spikes':
        if (m) m.position.y = this.spikeHeight * (spikeLift(o, t) - 1);
        break;
      case 'sweeper':
        if (m) {
          m.position.set(0, (SWEEPER.y0 + SWEEPER.y1) / 2, -o.length / 2);
          m.rotation.y = sweeperAngle(o, t); // same sweep as the hitboxes in hitBoxes()
        }
        break;
      case 'drop': {
        const p = dropProgress(o, t);
        const warned = o.triggerT >= 0;
        if (m) {
          m.visible = warned;
          m.position.set(0, DROP.height * (1 - p), -o.length / 2);
          m.rotation.y = t * 3;
        }
        if (this.shadow) {
          this.shadow.visible = warned && p < 1;
          const grow = warned ? Math.min(1, (t - o.triggerT) / DROP.warn) : 0;
          this.shadow.scale.setScalar(0.4 + 0.8 * grow);
          (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.15 + 0.35 * grow;
        }
        break;
      }
      default: break;
    }
    if (this.knock > 0) {
      // Smashed obstacles tumble off the track instead of blocking it.
      this.knock += dt;
      const k = this.knock;
      this.knockX += this.knockDir * 9 * dt;
      this.root.position.x = (o.kind === 'shifter' || o.kind === 'pendulum' || o.kind === 'sweeper' ? 0 : laneX(o.lane)) + this.knockX;
      this.root.position.y = Math.max(-3, 5 * k - 12 * k * k);
      this.root.rotation.z = -this.knockDir * k * 6;
      this.root.visible = k < 1.2;
    }
  }
}
