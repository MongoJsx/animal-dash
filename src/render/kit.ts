// Low-poly building blocks for the Thailand, China and Japan maps: trees,
// temples, houses, lanterns. Each writes primitives into a Shapes batch (lit)
// and, for things that shine, a second batch drawn unlit (glow).
import * as THREE from 'three';
import type { Rng } from '../core/rng.ts';
import type { Shapes } from './shapes.ts';

export interface Batch { lit: Shapes; glow: Shapes }

const ICO = new THREE.IcosahedronGeometry(1, 0);
const ICO1 = new THREE.IcosahedronGeometry(1, 1);
const SPHERE = new THREE.SphereGeometry(1, 10, 7);
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6);
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const CYL12 = new THREE.CylinderGeometry(1, 1, 1, 12);
const CONE6 = new THREE.ConeGeometry(1, 1, 6);
const CONE8 = new THREE.ConeGeometry(1, 1, 8);
const TORUS = new THREE.TorusGeometry(1, 0.18, 5, 12);
// Thin limbs, wires and poles: open-ended, the caps are never seen.
const ROD = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);

export const GOLD = 0xf2b632;
export const GOLD_DARK = 0xc98a1b;

/** A cylinder from point a to point b (thin limbs, wires, poles). */
export function rod(s: Shapes, color: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, geo = ROD) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  const e = new THREE.Euler().setFromQuaternion(q);
  return s.add(geo, color, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, e.x, e.y, e.z, r, len, r);
}

export const blob = (s: Shapes, color: number, x: number, y: number, z: number, rx: number, ry: number, rz = rx, smooth = false) =>
  s.add(smooth ? ICO1 : ICO, color, x, y, z, 0, 0, 0, rx, ry, rz);

export const ball = (s: Shapes, color: number, x: number, y: number, z: number, r: number, sy = 1) =>
  s.add(SPHERE, color, x, y, z, 0, 0, 0, r, r * sy, r);

export const cylinder = (s: Shapes, color: number, x: number, y: number, z: number, r: number, h: number, sides: 6 | 8 | 12 = 8) =>
  s.add(sides === 6 ? CYL6 : sides === 8 ? CYL8 : CYL12, color, x, y + h / 2, z, 0, 0, 0, r, h, r);

export const cone = (s: Shapes, color: number, x: number, y: number, z: number, r: number, h: number, sides: 6 | 8 = 8, rx = 0, rz = 0) =>
  s.add(sides === 6 ? CONE6 : CONE8, color, x, y + h / 2, z, rx, 0, rz, r, h, r);

/** Catenary-ish wire between two points, sagging by `sag`. */
export function wire(s: Shapes, color: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number, r = 0.03) {
  const n = 6;
  let px = ax, py = ay, pz = az;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const y = ay + (by - ay) * t - Math.sin(t * Math.PI) * sag;
    rod(s, color, px, py, pz, x, y, z, r);
    px = x; py = y; pz = z;
  }
}

// ── Plants ──────────────────────────────────────────────────────────────
export function roundTree(s: Shapes, rng: Rng, x: number, z: number, h: number, greens: number[], trunk = 0x6b4a2b, y0 = 0) {
  cylinder(s, trunk, x, y0, z, h * 0.06, h * 0.55, 6);
  for (let i = 0; i < 4; i++) {
    const r = h * rng.range(0.22, 0.32);
    blob(s, rng.pick(greens), x + rng.range(-0.25, 0.25) * h, y0 + h * rng.range(0.55, 0.85), z + rng.range(-0.25, 0.25) * h, r, r * 0.85, r, true);
  }
}

export function coconutPalm(s: Shapes, rng: Rng, x: number, z: number, h: number, lean: number) {
  const trunk = 0x8a6a4a;
  let px = x, py = 0;
  const segs = 5;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const nx = x + lean * h * t * t;
    const ny = h * t;
    rod(s, i % 2 ? trunk : 0x7a5c3e, px, py, z, nx, ny, z, h * 0.035 * (1.2 - t * 0.4));
    px = nx; py = ny;
  }
  const greens = [0x3f8f3a, 0x4fa44a, 0x2f7a33];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const len = h * rng.range(0.32, 0.42);
    const ex = px + Math.cos(a) * len, ez = z + Math.sin(a) * len;
    const mx = px + Math.cos(a) * len * 0.5, mz = z + Math.sin(a) * len * 0.5;
    rod(s, greens[i % 3], px, py, z, mx, py + len * 0.18, mz, h * 0.035);
    rod(s, greens[(i + 1) % 3], mx, py + len * 0.18, mz, ex, py - len * 0.25, ez, h * 0.028);
  }
  for (let i = 0; i < 3; i++) ball(s, 0x6b8e23, px + rng.range(-0.3, 0.3), py - 0.35, z + rng.range(-0.3, 0.3), 0.22);
}

export function sugarPalm(s: Shapes, rng: Rng, x: number, z: number, h: number) {
  cylinder(s, 0x5a4636, x, 0, z, h * 0.025, h, 6);
  blob(s, 0x2f6b2a, x, h, z, h * 0.12, h * 0.1);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    cone(s, i % 2 ? 0x3d7f31 : 0x4f9a3c, x + Math.cos(a) * h * 0.1, h - h * 0.02, z + Math.sin(a) * h * 0.1, h * 0.07, h * 0.16, 6, Math.sin(a) * 1.2, -Math.cos(a) * 1.2);
  }
  void rng;
}

export function bamboo(s: Shapes, rng: Rng, x: number, z: number, h: number, lean: number, leanZ = 0) {
  const greens = [0x7cb342, 0x8bc34a, 0x689f38];
  const g = rng.pick(greens);
  const r = rng.range(0.07, 0.11);
  let px = x, py = 0, pz = z;
  for (let i = 1; i <= 3; i++) {
    const t = i / 3;
    const nx = x + lean * h * t * t, ny = h * t, nz = z + leanZ * h * t * t;
    rod(s, i === 2 ? 0x6fa83a : g, px, py, pz, nx, ny, nz, r);
    if (i >= 2) {
      const side = rng.chance(0.5) ? 1 : -1;
      blob(s, rng.pick([0x4caf50, 0x388e3c, 0x66bb6a]), nx + side * rng.range(0.4, 0.9), ny + rng.range(-0.6, 0.1), nz + rng.range(-0.5, 0.5), rng.range(0.6, 1.0), 0.2, 0.4);
      blob(s, rng.pick([0x4caf50, 0x388e3c, 0x66bb6a]), nx - side * rng.range(0.3, 0.7), ny - h * 0.15, nz + rng.range(-0.5, 0.5), rng.range(0.5, 0.8), 0.18, 0.35);
    }
    px = nx; py = ny; pz = nz;
  }
  blob(s, 0x43a047, px, py + 0.2, pz, 0.8, 0.25, 0.5);
}

export function cherryTree(s: Shapes, rng: Rng, x: number, z: number, h: number, reach = 0, lite = false) {
  const trunk = 0x4a3328;
  // Short trunk that forks into spreading limbs; blossom clouds sit on the tips.
  const tx = x + reach * 0.25, ty = h * 0.38;
  rod(s, trunk, x, 0, z, tx, ty, z, h * 0.055);
  const pinks = [0xffc0d0, 0xffd0dc, 0xffb0c6, 0xfde2ea, 0xff9fbc];
  const limbs = rng.int(4, 5);
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const spread = h * rng.range(0.28, 0.42);
    const ex = tx + Math.cos(a) * spread + reach * 0.35, ey = h * rng.range(0.62, 0.8), ez = z + Math.sin(a) * spread;
    rod(s, trunk, tx, ty, z, ex, ey, ez, h * 0.028);
    for (let k = 0; k < (lite ? 2 : 3); k++) {
      const r = h * rng.range(0.11, 0.16) * (lite ? 1.2 : 1);
      blob(s, rng.pick(pinks), ex + rng.range(-0.6, 0.6), ey + rng.range(-0.1, 0.7), ez + rng.range(-0.6, 0.6), r, r * 0.8, r, !lite);
    }
  }
  blob(s, rng.pick(pinks), tx, h * 0.85, z, h * 0.16, h * 0.12, h * 0.16, true);
}

export function pine(s: Shapes, rng: Rng, x: number, z: number, h: number, snow = false) {
  cylinder(s, 0x5a3e2b, x, 0, z, h * 0.05, h * 0.3, 6);
  const greens = [0x2d6a4f, 0x1b4332, 0x40916c];
  for (let i = 0; i < 3; i++) {
    const r = h * (0.32 - i * 0.07), y = h * (0.2 + i * 0.22);
    cone(s, rng.pick(greens), x, y, z, r, h * 0.42, 8);
    if (snow) cone(s, 0xf4f8ff, x, y + h * 0.2, z, r * 0.6, h * 0.24, 8);
  }
}

export function cedar(s: Shapes, rng: Rng, x: number, z: number, h: number) {
  cylinder(s, 0x5d4030, x, 0, z, h * 0.04, h * 0.7, 6);
  const greens = [0x1f4d2b, 0x2a5e35, 0x174226];
  for (let i = 0; i < 4; i++) cone(s, rng.pick(greens), x, h * (0.35 + i * 0.15), z, h * (0.2 - i * 0.035), h * 0.3, 8);
}

// ── Lights ──────────────────────────────────────────────────────────────
/** Chinese red lantern: glowing body, gold caps and tassel. */
export function redLantern(b: Batch, x: number, y: number, z: number, r: number, color = 0xff3b2f) {
  ball(b.glow, color, x, y, z, r, 0.85);
  cylinder(b.lit, GOLD, x, y + r * 0.7, z, r * 0.45, r * 0.25, 8);
  cylinder(b.lit, GOLD, x, y - r * 0.95, z, r * 0.45, r * 0.25, 8);
  cylinder(b.lit, 0xd62828, x, y - r * 1.6, z, r * 0.08, r * 0.6, 6);
}

/** Japanese stone lantern (tōrō) with a glowing fire box. */
export function stoneLantern(b: Batch, x: number, z: number, scale = 1, snow = false) {
  const s = b.lit, k = scale, stone = 0x9a958c;
  cylinder(s, stone, x, 0, z, 0.45 * k, 0.25 * k, 6);
  cylinder(s, stone, x, 0.25 * k, z, 0.16 * k, 0.8 * k, 8);
  cylinder(s, stone, x, 1.05 * k, z, 0.4 * k, 0.15 * k, 6);
  b.glow.box(0xffd27a, x, 1.42 * k, z, 0.42 * k, 0.42 * k, 0.42 * k);
  s.box(stone, x, 1.42 * k, z, 0.5 * k, 0.5 * k, 0.12 * k);
  s.eaves(0x7f7a72, x, 1.66 * k, z, 1.0 * k, 1.0 * k, 0.4 * k);
  ball(s, stone, x, 2.12 * k, z, 0.1 * k);
  if (snow) s.eaves(0xf6f9ff, x, 1.8 * k, z, 0.9 * k, 0.9 * k, 0.3 * k);
}

export function streetLamp(b: Batch, x: number, z: number, side: number, h = 6, color = 0xfff3c4, pole = 0x3a3d45) {
  cylinder(b.lit, pole, x, 0, z, 0.08, h, 6);
  rod(b.lit, pole, x, h, z, x - side * 1.2, h + 0.2, z, 0.05);
  b.glow.box(color, x - side * 1.3, h + 0.05, z, 0.5, 0.15, 0.3);
}

// ── Thailand ────────────────────────────────────────────────────────────
/** Golden bell-shaped chedi. */
export function chedi(s: Shapes, x: number, z: number, h: number, color = GOLD, band = GOLD_DARK) {
  const P: [number, number][] = [
    [0, 0], [0.34, 0], [0.34, 0.06], [0.3, 0.06], [0.3, 0.11], [0.26, 0.11], [0.26, 0.16],
    [0.24, 0.17], [0.25, 0.24], [0.22, 0.34], [0.16, 0.42], [0.09, 0.47], [0.1, 0.5], [0.07, 0.52],
    [0.05, 0.6], [0.035, 0.8], [0.012, 0.98], [0, 1],
  ];
  s.lathe(color, P.map(([r, y]) => [r * h, y * h]), x, 0, z, 12);
  for (const y of [0.53, 0.57, 0.62]) cylinder(s, band, x, y * h, z, 0.055 * h * (1.05 - (y - 0.53) * 4), 0.012 * h, 12);
}

/** Khmer-style prang (Wat Arun / Ayutthaya). */
export function prang(s: Shapes, x: number, z: number, h: number, color: number, accent: number) {
  const P: [number, number][] = [
    [0, 0], [0.3, 0], [0.3, 0.08], [0.25, 0.08], [0.25, 0.3], [0.21, 0.32], [0.2, 0.42],
    [0.17, 0.5], [0.15, 0.58], [0.12, 0.66], [0.09, 0.74], [0.05, 0.8], [0.02, 0.9], [0.008, 1], [0, 1],
  ];
  s.lathe(color, P.map(([r, y]) => [r * h, y * h]), x, 0, z, 8);
  for (const y of [0.44, 0.54, 0.64, 0.73]) cylinder(s, accent, x, y * h, z, (0.2 - (y - 0.44) * 0.45) * h, 0.018 * h, 8);
}

/**
 * Thai temple hall (ubosot): white walls, layered orange roofs with green
 * borders, gold gable and chofa horns. Ridge along z; `len` along z.
 */
export function thaiHall(s: Shapes, x: number, z: number, w: number, len: number, wall = 0xfbf6ec) {
  const h = w * 0.45;
  s.box(0xe9dfc9, x, 0.35, z, w + 1.2, 0.7, len + 1.2);
  s.box(wall, x, 0.7 + h / 2, z, w, h, len);
  for (let i = 0; i < 6; i++) {
    const zz = z - len / 2 + (i + 0.5) * (len / 6);
    s.box(GOLD, x - w / 2 - 0.05, 0.7 + h * 0.55, zz, 0.08, h * 0.5, 0.9);
    s.box(GOLD, x + w / 2 + 0.05, 0.7 + h * 0.55, zz, 0.08, h * 0.5, 0.9);
  }
  const top = 0.7 + h;
  // Three stepped roof tiers, each with a green skirt below the orange.
  for (let t = 0; t < 3; t++) {
    const rw = w * (1.25 - t * 0.17), rh = w * (0.42 - t * 0.04), rl = len * (1.05 - t * 0.14);
    const ry = top + t * w * 0.18;
    s.prism(0x1f7a55, x, ry - 0.15, z, rw + 0.5, rh * 0.92, rl + 0.2);
    s.prism(0xe8641a, x, ry, z, rw, rh, rl);
  }
  const peak = top + 2 * w * 0.18 + w * 0.34;
  for (const e of [-1, 1]) {
    const gz = z + e * (len * 0.53);
    s.prism(GOLD, x, top + 0.05, gz, w * 0.95, w * 0.62, 0.15);
    cone(s, GOLD, x, peak - 0.1, gz + e * 0.2, 0.18, 1.3, 6, e * -0.55, 0);
  }
}

/** Yaksha temple guardian: stocky giant with a spired crown and a club. */
export function yaksha(s: Shapes, x: number, z: number, h: number, body: number, facing: number) {
  const k = h / 6;
  s.box(0xd9d2c3, x, 0.3 * k, z, 1.8 * k, 0.6 * k, 1.6 * k);
  for (const lx of [-0.4, 0.4]) s.box(body, x + lx * k, 1.3 * k, z, 0.55 * k, 1.4 * k, 0.6 * k);
  s.box(GOLD, x, 2.15 * k, z, 1.5 * k, 0.5 * k, 0.95 * k);
  s.box(body, x, 3.1 * k, z, 1.6 * k, 1.5 * k, 0.9 * k);
  s.box(GOLD, x, 3.6 * k, z, 1.7 * k, 0.25 * k, 1.0 * k);
  ball(s, body, x, 4.3 * k, z, 0.5 * k);
  s.box(0xffffff, x + facing * 0.15 * k, 4.4 * k, z + 0.45 * k, 0.15 * k, 0.12 * k, 0.05 * k);
  s.box(0xffffff, x - facing * 0.15 * k, 4.4 * k, z + 0.45 * k, 0.15 * k, 0.12 * k, 0.05 * k);
  s.lathe(GOLD, [[0, 0], [0.55, 0], [0.45, 0.25], [0.3, 0.45], [0.18, 0.9], [0.06, 1.4], [0, 1.6]].map(([r, y]) => [r * k, y * k] as [number, number]), x, 4.65 * k, z, 8);
  for (const ax of [-1, 1]) rod(s, body, x + ax * 0.9 * k, 3.6 * k, z, x + ax * 1.0 * k, 2.4 * k, z + 0.3 * k, 0.22 * k);
  rod(s, 0x6b4a2b, x, 2.2 * k, z + 0.4 * k, x, 0.1 * k, z + 0.5 * k, 0.16 * k);
  ball(s, GOLD, x, 2.25 * k, z + 0.4 * k, 0.3 * k);
}

const SHOP_COLORS = [0xf2c14e, 0xf78154, 0x5fad56, 0x4d9de0, 0xe15554, 0xf4d6cc, 0xb8d8ba, 0xffe8a3, 0xc9ada7, 0x8ecae6];
const SIGN_COLORS = [0xe63946, 0xffd23f, 0x2a9d8f, 0x3a86ff, 0xff006e, 0x06d6a0, 0xffffff];

/**
 * Thai shophouse unit facing the track. `side` = -1 left / 1 right, the facade
 * sits at |x| = face, the unit is `w` wide along z.
 */
export function shophouse(b: Batch, rng: Rng, face: number, side: number, z: number, w: number) {
  const s = b.lit;
  const floors = rng.int(2, 4);
  const fh = 3.1;
  const h = floors * fh + 0.6;
  const depth = 8;
  const col = rng.pick(SHOP_COLORS);
  const x = side * (face + depth / 2);
  const fx = side * face; // facade plane
  s.box(col, x, h / 2, z, depth, h, w - 0.15);
  s.box(0xf1ede4, x, h + 0.25, z, depth + 0.2, 0.5, w);
  // Ground floor: open shop with a striped awning.
  s.box(0x2b2d42, fx + side * 0.2, 1.4, z, 0.4, 2.6, w - 0.8);
  if (rng.chance(0.55)) {
    s.box(0x9aa1ab, fx + side * 0.05, 1.6, z, 0.12, 2.2, w - 0.9);
    for (let i = 0; i < 5; i++) s.box(0x7d838c, fx - side * 0.02, 0.7 + i * 0.4, z, 0.04, 0.05, w - 0.9);
  } else {
    for (let i = 0; i < 4; i++) ball(b.lit, rng.pick([0xff8c42, 0xf9dc5c, 0xe63946, 0x76c893]), fx - side * 0.3, 0.9, z - w / 2 + 0.7 + i * (w - 1.4) / 3, 0.28);
  }
  const awn = rng.pick([0xe63946, 0x2a9d8f, 0xffb703, 0x3a86ff, 0xffffff]);
  s.add(BOXG, awn, fx - side * 0.6, 2.85, z, 0, 0, side * 0.35, 1.4, 0.08, w - 0.3);
  // Upper floors: windows, sill, balcony rail, the odd air conditioner.
  for (let f = 1; f < floors; f++) {
    const y = f * fh + 1.5;
    for (const wz of [-w * 0.24, w * 0.24]) {
      s.box(0xf8f8f8, fx - side * 0.04, y, z + wz, 0.1, 1.7, 1.25);
      s.box(rng.chance(0.25) ? 0x2c3e50 : 0x5c7d99, fx - side * 0.08, y, z + wz, 0.1, 1.45, 1.05);
    }
    if (rng.chance(0.6)) {
      s.box(0x6c757d, fx - side * 0.5, y - 0.9, z, 1.0, 0.08, w - 0.4);
      for (let i = 0; i < 7; i++) s.box(0x6c757d, fx - side * 0.98, y - 0.5, z - w / 2 + 0.4 + i * (w - 0.8) / 6, 0.05, 0.8, 0.05);
      s.box(0x6c757d, fx - side * 0.98, y - 0.12, z, 0.06, 0.06, w - 0.4);
    }
    if (rng.chance(0.45)) s.box(0xe9ecef, fx - side * 0.3, y - 0.6, z + rng.range(-1, 1), 0.5, 0.55, 0.85);
  }
  // Shop sign: flat board over the door, or a lit blade sticking out.
  if (rng.chance(0.65)) {
    const sc = rng.pick(SIGN_COLORS);
    s.box(sc, fx - side * 0.12, 3.35, z, 0.12, 0.75, w - 0.6);
    s.box(sc === 0xffffff ? 0xe63946 : 0xffffff, fx - side * 0.19, 3.35, z, 0.04, 0.22, w * 0.5);
  }
  if (rng.chance(0.35) && floors > 2) {
    const sc = rng.pick(SIGN_COLORS);
    b.glow.box(sc, fx - side * 0.8, fh + 2.2, z + w / 2 - 0.3, 1.2, 2.6, 0.18);
    b.glow.box(0xffffff, fx - side * 0.8, fh + 2.2, z + w / 2 - 0.39, 0.6, 2.0, 0.02);
  }
}
const BOXG = new THREE.BoxGeometry(1, 1, 1);

/** Concrete power pole with crossarms; returns the wire anchor height. */
export function powerPole(s: Shapes, x: number, z: number, side: number) {
  cylinder(s, 0xb8b8b0, x, 0, z, 0.16, 9, 8);
  for (const y of [7.6, 8.4]) s.box(0x8d8d85, x - side * 0.4, y, z, 1.6, 0.12, 0.12);
  s.box(0x6c757d, x + side * 0.35, 6.2, z, 0.6, 0.9, 0.6);
  return 8.3;
}

export function thaiFlag(s: Shapes, x: number, z: number, h: number, royal = false) {
  cylinder(s, 0xeeeeee, x, 0, z, 0.05, h, 6);
  ball(s, GOLD, x, h + 0.05, z, 0.09);
  const fz = z - 0.75, fy = h - 0.55;
  if (royal) {
    s.box(0xffd60a, x, fy, fz, 0.03, 1.0, 1.4);
    return;
  }
  const stripes = [0xd62828, 0xffffff, 0x1d3557, 0xffffff, 0xd62828];
  const hs = [0.17, 0.17, 0.33, 0.17, 0.17];
  let y = fy + 0.5;
  stripes.forEach((c, i) => {
    y -= hs[i] / 2;
    s.box(c, x, y, fz, 0.03, hs[i], 1.4);
    y -= hs[i] / 2;
  });
}

/** Street food cart with a big umbrella. */
export function foodCart(s: Shapes, rng: Rng, x: number, z: number) {
  s.box(0xc0c7cf, x, 0.85, z, 0.9, 0.5, 1.6);
  s.box(0x8a9099, x, 0.3, z, 0.8, 0.6, 1.5);
  s.box(0xe9f5ff, x, 1.25, z, 0.85, 0.35, 1.5);
  for (let i = 0; i < 3; i++) ball(s, rng.pick([0xff8c42, 0xffd166, 0xef476f, 0x06d6a0]), x, 1.15, z - 0.5 + i * 0.5, 0.14);
  cylinder(s, 0xdddddd, x, 0, z, 0.03, 2.4, 6);
  const c = rng.pick([0xe63946, 0x2a9d8f, 0xffb703, 0x3a86ff]);
  s.add(CONE8, c, x, 2.55, z, 0, 0, 0, 1.3, 0.45, 1.3);
  for (let i = 0; i < 2; i++) cylinder(s, rng.pick([0xe63946, 0x3a86ff]), x + 0.9, 0, z - 0.4 + i * 0.8, 0.18, 0.45, 8);
}

/** Wooden longtail / sampan boat, optionally with a vendor and fruit. */
export function boat(s: Shapes, rng: Rng, x: number, y: number, z: number, len: number, vendor: boolean) {
  const hull = rng.pick([0x5c3d2e, 0x6b4a2b, 0x4a3324]);
  s.box(hull, x, y + 0.2, z, 1.1, 0.4, len);
  s.add(CONE6, hull, x, y + 0.25, z - len / 2 - 0.5, -Math.PI / 2, 0, 0, 0.55, 1.0, 0.25);
  s.add(CONE6, hull, x, y + 0.25, z + len / 2 + 0.5, Math.PI / 2, 0, 0, 0.55, 1.0, 0.25);
  s.box(0x3a2a1e, x, y + 0.42, z, 0.9, 0.06, len - 0.2);
  if (!vendor) return;
  for (let i = 0; i < 7; i++) ball(s, rng.pick([0xff8c42, 0xffd166, 0xef476f, 0x8ac926, 0xf9844a, 0x9d4edd]), x + rng.range(-0.3, 0.3), y + 0.6, z + rng.range(-len / 2 + 0.6, len / 2 - 0.6), rng.range(0.12, 0.22));
  const vz = z + len * 0.25;
  s.box(rng.pick([0x1d3557, 0x6a4c93, 0x2a9d8f]), x, y + 0.85, vz, 0.45, 0.7, 0.4);
  ball(s, 0xc68b59, x, y + 1.35, vz, 0.17);
  s.add(CONE8, 0xe9c46a, x, y + 1.55, vz, 0, 0, 0, 0.55, 0.3, 0.55);
}

export function stiltHouse(b: Batch, rng: Rng, x: number, z: number, side: number, waterY: number) {
  const s = b.lit;
  const w = rng.range(4.5, 6), d = rng.range(5, 7), fy = 1.4;
  for (const px of [-1, 1]) for (const pz of [-1, 1]) cylinder(s, 0x4a3324, x + px * w * 0.4, waterY - 0.5, z + pz * d * 0.4, 0.12, fy - waterY + 0.5, 6);
  s.box(0x8d5a34, x, fy, z, w + 0.6, 0.2, d + 0.6);
  s.box(rng.pick([0xa47148, 0x936340, 0xb5835a]), x, fy + 1.3, z, w, 2.4, d);
  s.box(0x2b2018, x - side * w / 2 - 0.01, fy + 1.1, z, 0.04, 1.8, 1.0);
  b.glow.box(0xffd89b, x - side * w / 2 - 0.02, fy + 1.6, z + d * 0.28, 0.03, 0.6, 0.8);
  s.prism(rng.pick([0x9c4a2b, 0x8a8d91, 0xb5523b]), x, fy + 2.5, z, w + 1.6, 1.9, d + 1.0);
  for (let i = 0; i < 3; i++) cylinder(s, rng.pick([0x2f7a33, 0x4fa44a]), x - side * (w / 2 + 0.3), fy + 0.1, z - d / 3 + i * d / 3, 0.25, 0.5, 6);
}

export function paddy(s: Shapes, x: number, z: number, w: number, d: number, green: number, y = -0.05) {
  s.box(0x9b7b55, x, y - 0.02, z, w, 0.12, d);
  s.box(green, x, y + 0.06, z, w - 0.5, 0.1, d - 0.5);
}

export function buffalo(s: Shapes, x: number, z: number, ry: number) {
  const c = 0x4a4e57;
  const k = 1;
  const cs = Math.cos(ry), sn = Math.sin(ry);
  const at = (f: number, r: number): [number, number] => [x + sn * f + cs * r, z + cs * f - sn * r];
  s.add(ICO1, c, x, 1.1 * k, z, 0, ry, 0, 0.6, 0.55, 1.1);
  const [hx, hz] = at(1.15, 0);
  s.add(ICO1, c, hx, 1.15, hz, 0, ry, 0, 0.35, 0.33, 0.45);
  for (const r of [-1, 1]) {
    const [tx, tz] = at(1.1, r * 0.45);
    s.add(CONE6, 0xe8e2d0, tx, 1.45, tz, 0, ry, r * 1.9, 0.08, 0.6, 0.08);
  }
  for (const [f, r] of [[0.6, 0.3], [0.6, -0.3], [-0.6, 0.3], [-0.6, -0.3]]) {
    const [lx, lz] = at(f, r);
    cylinder(s, 0x3a3e46, lx, 0, lz, 0.1, 0.8, 6);
  }
}

// ── China ───────────────────────────────────────────────────────────────
/** Great Wall battlement run along one side of the track. */
export function battlements(s: Shapes, x: number, z0: number, len: number, side: number, stone: number, dark: number) {
  s.long(stone, x, 0.5, z0 - len / 2, 0.55, 1.0, len);
  for (let d = 0.4; d < len; d += 1.3) s.box(dark === stone ? stone : stone, x, 1.35, z0 - d, 0.55, 0.7, 0.7);
  s.long(dark, x + side * 0.05, 1.02, z0 - len / 2, 0.6, 0.06, len);
}

export function watchtower(s: Shapes, z: number, half: number, stone: number, dark: number) {
  for (const side of [-1, 1]) {
    s.box(stone, side * (half + 2.2), 3.0, z, 4.4, 6, 7);
    s.box(dark, side * (half + 1.05), 2.6, z, 0.2, 5.2, 7.2);
  }
  s.box(stone, 0, 6.4, z, 2 * half + 8.8, 2.6, 7);
  for (let i = 0; i < 9; i++) s.box(stone, -half - 4 + i * ((2 * half + 8) / 8), 8.1, z + 3.2, 0.9, 0.8, 0.6);
  for (let i = 0; i < 9; i++) s.box(stone, -half - 4 + i * ((2 * half + 8) / 8), 8.1, z - 3.2, 0.9, 0.8, 0.6);
  s.box(0x2b2018, 0, 6.4, z + 3.51, 1.0, 1.0, 0.04);
  s.eaves(0x5a4a3a, 0, 7.7, z, 7.5, 6.0, 2.6);
  s.box(0xc0392b, 0, 7.8, z, 6.2, 0.9, 4.6);
  s.eaves(0x3a3f47, 0, 8.6, z, 7.6, 6.4, 2.2);
}

export function mountain(s: Shapes, rng: Rng, x: number, y: number, z: number, r: number, h: number, colors: number[], snow = 0) {
  s.add(ICO, rng.pick(colors), x, y, z, 0, rng.range(0, 6), 0, r, h, r * rng.range(0.8, 1.2));
  if (snow > 0) s.add(ICO, 0xf4f8ff, x, y + h * (1 - snow) * 0.92, z, 0, rng.range(0, 6), 0, r * snow * 0.9, h * snow, r * snow * 0.9);
}

/** Tall rounded limestone peak (Guilin karst). */
export function karst(s: Shapes, rng: Rng, x: number, z: number, r: number, h: number, base = -0.5) {
  const P: [number, number][] = [[0, 0], [1, 0], [1.05, 0.12], [0.92, 0.35], [0.95, 0.55], [0.78, 0.78], [0.5, 0.93], [0, 1]];
  const greens = [0x4f8a4a, 0x5f9a55, 0x3f7a42, 0x6aa060];
  s.lathe(rng.pick(greens), P.map(([a, b]) => [a * r, b * h]), x, base, z, 9, 1, 1);
  s.lathe(0x8a948a, [[0, 0], [1.08, 0], [1.08, 0.08], [0, 0.08]].map(([a, b]) => [a * r, b * h]), x, base + h * rng.range(0.3, 0.5), z, 9);
}

/** Two-storey Chinese shop house with curved roof and lanterns. */
export function cnHouse(b: Batch, rng: Rng, face: number, side: number, z: number, w: number) {
  const s = b.lit;
  const d = 7, x = side * (face + d / 2), fx = side * face;
  const wall = rng.pick([0xf2ebe0, 0xe9dfcf, 0x8b5a3c, 0x7a4b30]);
  s.box(0x6d6a66, x, 0.25, z, d + 0.4, 0.5, w + 0.2);
  s.box(wall, x, 2.3, z, d, 3.6, w - 0.1);
  for (const pz of [-w / 2 + 0.3, w / 2 - 0.3]) cylinder(s, 0xb22222, fx - side * 0.1, 0.5, z + pz, 0.16, 3.4, 8);
  s.box(0x5a2e1e, fx + side * 0.02, 1.7, z, 0.08, 2.4, w * 0.45);
  s.box(0xffd166, fx - side * 0.03, 2.6, z, 0.04, 0.4, w * 0.3);
  for (const pz of [-w * 0.32, w * 0.32]) s.box(0xd62828, fx - side * 0.03, 1.8, z + pz, 0.04, 1.6, 0.3);
  s.eaves(0x3a3f47, x, 4.0, z, d + 2.4, w + 1.2, 1.4);
  if (rng.chance(0.6)) {
    s.box(wall, x + side * 0.5, 5.6, z, d - 1.5, 2.6, w - 0.6);
    for (const wz of [-w * 0.22, w * 0.22]) b.glow.box(0xffc46b, fx + side * 0.74, 5.6, z + wz, 0.04, 1.1, 0.9);
    s.eaves(0x3a3f47, x + side * 0.5, 6.85, z, d + 0.6, w + 0.6, 1.5);
  }
  redLantern(b, fx - side * 0.9, 3.25, z - w * 0.3, 0.32);
  redLantern(b, fx - side * 0.9, 3.25, z + w * 0.3, 0.32);
}

/** Multi-tier pagoda (Chinese or Japanese). */
export function pagoda(b: Batch, x: number, z: number, tiers: number, base: number, wall: number, roof: number, trim: number, glowWin = false) {
  const s = b.lit;
  let y = 0;
  s.box(0x9a958c, x, 0.4, z, base * 1.5, 0.8, base * 1.5);
  y = 0.8;
  for (let t = 0; t < tiers; t++) {
    const k = 1 - t * (0.5 / tiers);
    const w = base * k, h = 2.6 * (base / 6) * (t ? 0.85 : 1.1);
    s.box(wall, x, y + h / 2, z, w, h, w);
    if (glowWin) for (const f of [-1, 1]) b.glow.box(0xffd27a, x + f * (w / 2 + 0.02), y + h * 0.55, z, 0.04, h * 0.4, w * 0.3);
    s.box(trim, x, y + h - 0.1, z, w + 0.1, 0.2, w + 0.1);
    s.eaves(roof, x, y + h, z, w * 1.75, w * 1.75, h * 0.55);
    y += h + h * 0.18;
  }
  cylinder(s, GOLD_DARK, x, y - 0.3, z, 0.12 * base / 6, base * 0.8, 8);
  for (let i = 0; i < 5; i++) s.add(TORUS, GOLD_DARK, x, y + i * base * 0.12, z, Math.PI / 2, 0, 0, 0.25 * base / 6, 0.25 * base / 6, 0.25 * base / 6);
}

export function panda(s: Shapes, x: number, z: number, scale: number, ry = 0) {
  const k = scale, W = 0xf5f5f0, K = 0x222222;
  s.add(ICO1, W, x, 0.75 * k, z, 0, ry, 0, 0.7 * k, 0.75 * k, 0.6 * k);
  s.add(ICO1, K, x, 0.95 * k, z, 0, ry, 0, 0.72 * k, 0.28 * k, 0.62 * k);
  ball(s, W, x, 1.7 * k, z, 0.5 * k);
  for (const e of [-1, 1]) {
    ball(s, K, x + e * 0.38 * k, 2.08 * k, z, 0.17 * k);
    ball(s, K, x + e * 0.18 * k, 1.75 * k, z + Math.cos(ry) * 0.42 * k, 0.11 * k, 1.3);
    ball(s, K, x + e * 0.45 * k, 0.25 * k, z + 0.25 * k, 0.25 * k);
  }
  ball(s, K, x, 1.6 * k, z + Math.cos(ry) * 0.48 * k, 0.07 * k);
}

/** A string of red lanterns across the track. */
export function lanternLine(b: Batch, z: number, half: number, y: number) {
  wire(b.lit, 0x3a2a1e, -half, y + 0.6, z, half, y + 0.6, z, 0.7, 0.025);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = -half + 2 * half * t;
    const yy = y + 0.6 - Math.sin(t * Math.PI) * 0.7 - 0.45;
    redLantern(b, x, yy, z, 0.3, i % 3 === 1 ? 0xffb02e : 0xff3b2f);
  }
}

// ── Japan ───────────────────────────────────────────────────────────────
/** Torii gate spanning the track (centred on x = 0). */
export function torii(s: Shapes, z: number, half: number, h: number, color = 0xe8461e, black = 0x1d1d1d) {
  const r = 0.22 * (h / 6.2);
  for (const side of [-1, 1]) {
    cylinder(s, color, side * half, 0, z, r, h, 8);
    cylinder(s, black, side * half, 0, z, r * 1.25, 0.5, 8);
  }
  s.box(color, 0, h * 0.8, z, 2 * half + 1.0, r * 1.5, r * 1.6);
  // Kasagi: the top beam curves up at its ends.
  const n = 5, span = 2 * half + 2.4;
  for (let i = 0; i < n; i++) {
    const x0 = -span / 2 + (i * span) / n, x1 = x0 + span / n;
    const lift = (x: number) => Math.pow((2 * x) / span, 2) * 0.45;
    rod(s, color, x0, h + lift(x0), z, x1, h + lift(x1), z, r * 1.05, CYL8);
    rod(s, black, x0, h + 0.28 + lift(x0), z, x1, h + 0.28 + lift(x1), z, r * 0.9, CYL8);
  }
  s.box(color, 0, h * 0.9, z, 0.3, h * 0.2, 0.25);
}

export function kitsune(s: Shapes, x: number, z: number, side: number) {
  const st = 0xd8d2c4;
  s.box(0x8f8a80, x, 0.6, z, 0.9, 1.2, 0.9);
  s.add(ICO1, st, x, 1.6, z, 0, 0, 0, 0.32, 0.5, 0.4);
  ball(s, st, x, 2.2, z + 0.05, 0.26);
  s.add(CONE6, st, x, 2.3, z + 0.3, Math.PI / 2, 0, 0, 0.12, 0.35, 0.12);
  for (const e of [-1, 1]) s.add(CONE6, st, x + e * 0.12, 2.5, z, 0, 0, 0, 0.08, 0.25, 0.08);
  s.box(0xd62828, x, 1.85, z + 0.25, 0.4, 0.25, 0.1);
  s.add(ICO1, st, x - side * 0.35, 1.5, z - 0.25, 0.6, 0, 0, 0.15, 0.5, 0.15);
}

/** Thatched gassho-zukuri farmhouse, roof heavy with snow. */
export function gassho(b: Batch, rng: Rng, x: number, z: number, side: number) {
  const s = b.lit;
  const w = rng.range(7, 9), d = rng.range(9, 12);
  s.box(0x5a3e2b, x, 1.6, z, w, 3.2, d);
  for (let i = 0; i < 3; i++) b.glow.box(0xffc46b, x - side * (w / 2 + 0.02), 1.7, z - d / 3 + i * d / 3, 0.04, 1.0, 1.4);
  s.box(0x3a2a1e, x - side * (w / 2 + 0.01), 3.25, z, 0.06, 0.15, d);
  // Steep thatch with a fat snow blanket on top; ridge runs along z.
  s.prism(0x7a6146, x, 3.2, z, w + 1.4, 6.5, d + 1.2);
  s.prism(0xf7faff, x, 3.9, z, w + 1.3, 6.0, d + 1.4);
  b.glow.box(0xffc46b, x, 5.6, z + (d + 1.2) / 2 + 0.02, 1.2, 1.0, 0.04);
  b.glow.box(0xffc46b, x, 5.6, z - (d + 1.2) / 2 - 0.02, 1.2, 1.0, 0.04);
}

const NEON = [0xff006e, 0x3a86ff, 0x8338ec, 0xffbe0b, 0x06d6a0, 0xfb5607, 0x00f5d4, 0xff5d8f];

/** Tokyo street building with lit windows, vertical neon and rooftop sign. */
export function tokyoBuilding(b: Batch, rng: Rng, face: number, side: number, z: number, w: number) {
  const s = b.lit;
  const h = rng.range(12, 34), d = rng.range(9, 14);
  const x = side * (face + d / 2), fx = side * face;
  const col = rng.pick([0x3d4152, 0x4a4e63, 0x5b5f73, 0x2f3344, 0x6b6f80, 0x8a8f9f]);
  s.box(col, x, h / 2, z, d, h, w - 0.3);
  // Shop front.
  b.glow.box(rng.pick([0xfff3d6, 0xe8f4ff, 0xffe0f0]), fx - side * 0.02, 1.5, z, 0.05, 2.2, w - 1.4);
  s.box(0x22252f, fx - side * 0.3, 2.85, z, 0.6, 0.25, w - 0.4);
  // Window grid, some lit.
  const rows = Math.floor((h - 4) / 2.6);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 3; c++) {
      const wz = z - w / 2 + (c + 0.5) * (w / 3);
      const lit = rng.chance(0.55);
      (lit ? b.glow : s).box(lit ? rng.pick([0xfff1c1, 0xd6ecff, 0xffe3b3]) : 0x1b1e28, fx - side * 0.03, 4.6 + r * 2.6, wz, 0.05, 1.5, w / 3 - 0.6);
    }
  }
  if (rng.chance(0.75)) {
    const nc = rng.pick(NEON);
    const nz = z + rng.pick([-1, 1]) * (w / 2 - 0.6);
    const nh = Math.min(h - 4, rng.range(6, 12));
    b.glow.box(nc, fx - side * 0.7, 3.8 + nh / 2, nz, 0.25, nh, 0.9);
    for (let i = 0; i < Math.floor(nh / 1.4); i++) b.glow.box(0xffffff, fx - side * 0.84, 4.4 + i * 1.4, nz, 0.02, 0.8, 0.5);
  }
  if (rng.chance(0.5)) {
    const nc = rng.pick(NEON);
    s.box(0x22252f, x, h + 1.6, z, 1.0, 3.2, w * 0.7);
    b.glow.box(nc, fx + side * 0.6, h + 1.8, z, 0.1, 2.4, w * 0.6);
  }
}

export function vending(b: Batch, rng: Rng, x: number, z: number, side: number) {
  const c = rng.pick([0xf1f1f1, 0xd62828, 0x1d4ed8]);
  b.lit.box(c, x, 0.95, z, 0.8, 1.9, 1.1);
  b.glow.box(0xe6f6ff, x - side * 0.41, 1.25, z, 0.02, 0.9, 0.9);
  for (let i = 0; i < 4; i++) b.glow.box(rng.pick(NEON), x - side * 0.42, 1.05 + (i % 2) * 0.35, z - 0.25 + Math.floor(i / 2) * 0.5, 0.02, 0.2, 0.12);
}

export function zebra(s: Shapes, z: number, half: number) {
  for (let x = -half + 0.4; x < half; x += 0.9) s.box(0xf4f4f4, x, 0.012, z, 0.5, 0.02, 3.2);
}

/** White castle keep (Himeji style). */
export function castle(b: Batch, x: number, z: number, k: number) {
  const s = b.lit;
  s.box(0x8f8a80, x, 2.5 * k, z, 22 * k, 5 * k, 18 * k);
  const tiers = [[18, 4.5], [14, 4], [10.5, 3.6], [7.5, 3.4], [5, 3]];
  let y = 5 * k;
  for (const [w, h] of tiers) {
    s.box(0xfafaf7, x, y + (h * k) / 2, z, w * k, h * k, w * k * 0.8);
    for (const f of [-1, 1]) b.glow.box(0xffe1a8, x, y + h * k * 0.5, z + f * (w * k * 0.4 + 0.02), w * k * 0.5, 0.5 * k, 0.04);
    s.eaves(0x4a5568, x, y + h * k, z, w * k * 1.35, w * k * 1.1, h * k * 0.5);
    s.prism(0xfafaf7, x, y + h * k * 0.8, z + w * k * 0.4, w * k * 0.35, h * k * 0.6, 0.6 * k);
    y += h * k * 1.05;
  }
  s.box(GOLD, x, y + 0.6 * k, z, 1.2 * k, 1.2 * k, 0.4 * k);
}
