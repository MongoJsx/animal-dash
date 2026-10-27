// Low-poly building blocks for the Thailand, China and Japan maps: trees,
// temples, houses, lanterns. Each writes primitives into a Shapes batch (lit)
// and, for things that shine, a second batch drawn unlit (glow).
import * as THREE from 'three';
import type { Rng } from '../core/rng.ts';
import type { Shapes } from './shapes.ts';

/** lit: shaded; glow: unlit (lamps, windows); halo: soft light round lights (absent where nothing glows round them). */
export interface Batch { lit: Shapes; glow: Shapes; halo?: Shapes }

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
  s.swaying((_x, y) => (y - y0) / h * 0.7, () => {
    for (let i = 0; i < 4; i++) {
      const r = h * rng.range(0.22, 0.32);
      blob(s, rng.pick(greens), x + rng.range(-0.25, 0.25) * h, y0 + h * rng.range(0.55, 0.85), z + rng.range(-0.25, 0.25) * h, r, r * 0.85, r, true);
    }
  });
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
  const cx = px, cy = py;
  s.swaying((vx, vy, vz) => 0.25 + Math.hypot(vx - cx, vy - cy, vz - z) / (h * 0.4), () => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const len = h * rng.range(0.32, 0.42);
      const ex = px + Math.cos(a) * len, ez = z + Math.sin(a) * len;
      const mx = px + Math.cos(a) * len * 0.5, mz = z + Math.sin(a) * len * 0.5;
      rod(s, greens[i % 3], px, py, z, mx, py + len * 0.18, mz, h * 0.035);
      rod(s, greens[(i + 1) % 3], mx, py + len * 0.18, mz, ex, py - len * 0.25, ez, h * 0.028);
    }
  });
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
  s.swaying((_x, y) => (y / h) ** 2, () => bambooCane(s, rng, x, z, h, lean, leanZ, g, r));
}

function bambooCane(s: Shapes, rng: Rng, x: number, z: number, h: number, lean: number, leanZ: number, g: number, r: number) {
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
    s.swaying((_x, y) => y / h * 0.45, () => {
      for (let k = 0; k < (lite ? 2 : 3); k++) {
        const r = h * rng.range(0.11, 0.16) * (lite ? 1.2 : 1);
        blob(s, rng.pick(pinks), ex + rng.range(-0.6, 0.6), ey + rng.range(-0.1, 0.7), ez + rng.range(-0.6, 0.6), r, r * 0.8, r, !lite);
      }
    });
  }
  s.swaying(() => 0.35, () => blob(s, rng.pick(pinks), tx, h * 0.85, z, h * 0.16, h * 0.12, h * 0.16, true));
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
  b.halo?.halo(color, x, y, z + r * 1.2, r * 2.6);
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
  b.halo?.halo(0xffb54a, x, 1.42 * k, z + 0.4 * k, 1.5 * k);
  s.box(stone, x, 1.42 * k, z, 0.5 * k, 0.5 * k, 0.12 * k);
  s.eaves(0x7f7a72, x, 1.66 * k, z, 1.0 * k, 1.0 * k, 0.4 * k);
  ball(s, stone, x, 2.12 * k, z, 0.1 * k);
  if (snow) s.eaves(0xf6f9ff, x, 1.8 * k, z, 0.9 * k, 0.9 * k, 0.3 * k);
}

export function streetLamp(b: Batch, x: number, z: number, side: number, h = 6, color = 0xfff3c4, pole = 0x3a3d45) {
  cylinder(b.lit, pole, x, 0, z, 0.08, h, 6);
  rod(b.lit, pole, x, h, z, x - side * 1.2, h + 0.2, z, 0.05);
  b.glow.box(color, x - side * 1.3, h + 0.05, z, 0.5, 0.15, 0.3);
  b.halo?.halo(color, x - side * 1.3, h - 0.2, z + 0.4, 2.2, 1.6);
  b.halo?.puddle(color, x - side * 1.3, z, 1.6, 3.5);
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
  const cloth = (_x: number, _y: number, vz: number) => (z - vz) / 1.4;
  if (royal) {
    s.fluttering(cloth, () => s.cloth(0xffd60a, x, fy, fz, 0.03, 1.0, 1.4));
    return;
  }
  const stripes = [0xd62828, 0xffffff, 0x1d3557, 0xffffff, 0xd62828];
  const hs = [0.17, 0.17, 0.33, 0.17, 0.17];
  let y = fy + 0.5;
  s.fluttering(cloth, () => stripes.forEach((c, i) => {
    y -= hs[i] / 2;
    s.cloth(c, x, y, fz, 0.03, hs[i], 1.4);
    y -= hs[i] / 2;
  }));
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

/**
 * Rice paddy: an earth bund round a field of rice in rows; with `water` the
 * field is flooded instead (drawn into that batch, so it ripples and shines).
 */
export function paddy(s: Shapes, x: number, z: number, w: number, d: number, green: number, y = -0.05, water?: Shapes) {
  s.box(0x9b7b55, x, y - 0.02, z, w, 0.12, d);
  if (water) {
    water.box(green, x, y + 0.03, z, w - 0.5, 0.06, d - 0.5);
    // Seedlings just poking out of the water, in rows.
    for (let rx = -w / 2 + 0.6; rx < w / 2 - 0.4; rx += 0.9) s.box(0x9ad85a, x + rx, y + 0.1, z, 0.08, 0.08, d - 0.8);
    return;
  }
  s.box(green, x, y + 0.06, z, w - 0.5, 0.1, d - 0.5);
  // Rows of rice, darker furrows between them.
  const dark = new THREE.Color(green).multiplyScalar(0.72).getHex();
  for (let rx = -w / 2 + 0.55; rx < w / 2 - 0.4; rx += 0.5) s.box(dark, x + rx, y + 0.115, z, 0.12, 0.02, d - 0.6);
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
  const span = 2 * half + 8.8;
  // Shallow, so the camera is through the passage in a blink.
  const D = 4;
  // The gate's two piers, with brick courses and a darker plinth.
  for (const side of [-1, 1]) {
    const px = side * (half + 2.2);
    s.box(stone, px, 3.9, z, 4.4, 7.8, D);
    s.box(dark, px, 0.4, z, 4.6, 0.8, D + 0.2);
    for (let y = 1.2; y < 7.4; y += 0.6) s.box(dark, px, y, z, 4.42, 0.04, D + 0.02);
    s.box(dark, side * (half + 1.05), 3.5, z, 0.2, 7.0, D + 0.2);
  }
  // Arched passage: the lintel with a round arch cut in it (a half-ring of voussoirs).
  s.box(stone, 0, 8.2, z, span, 2.6, D);
  const r = half + 0.02;
  for (let i = 0; i < 24; i++) {
    const a = ((i + 0.5) / 24) * Math.PI;
    // Tangent of the flattened arch, so the stones lie along it edge to edge.
    const tan = Math.atan2(Math.cos(a) * 1.1, -Math.sin(a) * r);
    s.add(BOXG, dark, Math.cos(a) * r, 6.7 + Math.sin(a) * 1.1, z + D / 2 + 0.02, 0, 0, tan, 0.62, 0.3, 0.06);
  }
  s.long(dark, 0, 6.95, z, 2 * half + 0.4, 0.06, D + 0.06);
  // Crenellations front and back.
  for (const f of [-1, 1]) for (let i = 0; i < 9; i++) s.box(stone, -half - 4 + i * ((2 * half + 8) / 8), 9.9, z + f * (D / 2 - 0.3), 0.9, 0.8, 0.6);
  s.box(0x2b2018, 0, 8.2, z + D / 2 + 0.01, 1.4, 1.0, 0.04);
  s.box(GOLD, 0, 8.2, z + D / 2 + 0.04, 1.1, 0.7, 0.04);
  // Pavilion on top: red columns, a gold-trimmed beam, two tiers of swept eaves.
  const top = 9.5;
  for (const cx of [-2.6, -0.9, 0.9, 2.6]) for (const cz of [-1.4, 1.4]) cylinder(s, 0xb3261e, cx, top, z + cz, 0.16, 2.0, 8);
  s.box(0x8a1c15, 0, top + 2.05, z, 6.0, 0.35, 3.4);
  s.box(GOLD, 0, top + 1.8, z, 6.1, 0.1, 3.5);
  s.box(0x2d6e6a, 0, top + 1.6, z, 6.1, 0.2, 3.5);
  s.eaves(0x3a3f47, 0, top + 2.2, z, 8.2, 5.2, 1.5);
  s.box(0x8a1c15, 0, top + 3.25, z, 4.4, 0.9, 2.4);
  s.eaves(0x3a3f47, 0, top + 3.7, z, 6.0, 3.8, 1.8);
  s.box(0x2a2e35, 0, top + 5.35, z, 2.4, 0.2, 0.25);
  for (const o of [-1.25, 1.25]) cone(s, 0x2a2e35, o, top + 5.3, z, 0.18, 0.5, 6);
  // Banners on poles at the corners.
  for (const side of [-1, 1]) {
    const fx = side * (half + 3.9);
    cylinder(s, 0x5a3a24, fx, 10.3, z + D / 2 - 0.4, 0.06, 3.4, 6);
    s.fluttering((x) => Math.min(1, Math.abs(x - fx) / 1.3), () => s.cloth(side < 0 ? 0xc0392b : 0xf2b632, fx - side * 0.7, 13.0, z + D / 2 - 0.4, 1.4, 0.9, 0.04));
  }
}

export function mountain(s: Shapes, rng: Rng, x: number, y: number, z: number, r: number, h: number, colors: number[], snow = 0) {
  s.add(ICO1, rng.pick(colors), x, y, z, 0, rng.range(0, 6), 0, r, h, r * rng.range(0.8, 1.2));
  if (snow > 0) s.add(ICO1, 0xf4f8ff, x, y + h * (1 - snow) * 0.92, z, 0, rng.range(0, 6), 0, r * snow * 0.9, h * snow, r * snow * 0.9);
}

/**
 * Guilin karst tower: a steep limestone pillar, often two or three stacked
 * and offset, grey cliff faces with green scrub on every ledge and the crown.
 */
export function karst(s: Shapes, rng: Rng, x: number, z: number, r: number, h: number, base = -0.5) {
  const rock = rng.pick([0x8e968c, 0x9aa198, 0x7f897f]);
  const greens = [0x4f8a4a, 0x5f9a55, 0x3f7a42, 0x6aa060];
  const tiers = rng.int(1, 3);
  let y = base, cx = x, cz = z, rr = r;
  for (let t = 0; t < tiers; t++) {
    const th = (h / tiers) * rng.range(0.85, 1.15) * (t === 0 ? 1.15 : 1);
    const last = t === tiers - 1;
    // Cliffs bulge and pinch a little; the top tier rounds over into a dome.
    const P: [number, number][] = last
      ? [[1, 0], [1.04, 0.18], [0.94, 0.45], [0.9, 0.68], [0.72, 0.86], [0.42, 0.97], [0, 1]]
      : [[1, 0], [1.05, 0.25], [0.95, 0.6], [0.88, 1]];
    s.lathe(rock, [[0, 0], ...P].map(([a, b]) => [a * rr, b * th]), cx, y, cz, 8, 1, 1);
    // Scrub: a green cap on the crown, clumps on the ledge and down the face.
    if (last) s.lathe(rng.pick(greens), [[0, 0], [0.76, 0], [0.6, 0.12], [0.3, 0.2], [0, 0.22]].map(([a, b]) => [a * rr, b * th]), cx, y + th * 0.84, cz, 8);
    else blob(s, rng.pick(greens), cx, y + th * 0.97, cz, rr * 0.92, th * 0.1, rr * 0.92, true);
    for (let k = 0; k < 3; k++) {
      const a = rng.range(0, Math.PI * 2), fy = rng.range(0.25, 0.8);
      blob(s, rng.pick(greens), cx + Math.cos(a) * rr * 0.86, y + th * fy, cz + Math.sin(a) * rr * 0.86, rr * rng.range(0.28, 0.42), th * rng.range(0.1, 0.16), rr * rng.range(0.28, 0.42), true);
    }
    y += th * 0.96;
    rr *= rng.range(0.6, 0.78);
    cx += rng.range(-0.25, 0.25) * rr;
    cz += rng.range(-0.25, 0.25) * rr;
  }
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
  b.halo?.halo(0xffa94a, x, 5.6, z + (d + 1.2) / 2 + 0.3, 2.2, 1.8);
  for (let i = 0; i < 3; i++) b.halo?.halo(0xffa94a, x - side * (w / 2 + 0.3), 1.7, z - d / 3 + i * d / 3 + 0.8, 1.6, 1.2);
}

/** Paper lantern on a short wooden post (andon), with a cap of snow on its roof. */
export function andon(b: Batch, x: number, z: number, snow = true) {
  const s = b.lit;
  s.box(0x4a3426, x, 0.55, z, 0.14, 1.1, 0.14);
  s.box(0x3a2a1e, x, 1.12, z, 0.5, 0.06, 0.5);
  b.glow.box(0xffe0a8, x, 1.42, z, 0.4, 0.55, 0.4);
  for (const o of [-0.2, 0.2]) s.box(0x3a2a1e, x + o, 1.42, z, 0.04, 0.58, 0.44);
  s.eaves(0x3a2a1e, x, 1.7, z, 0.62, 0.62, 0.22);
  if (snow) s.eaves(0xf7faff, x, 1.78, z, 0.56, 0.56, 0.2);
  b.halo?.halo(0xffb560, x, 1.42, z + 0.35, 1.3, 1.1);
  b.halo?.puddle(0xffc27a, x, z, 1.4, 1.4);
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
    b.halo?.halo(nc, fx - side * 0.7, 3.8 + nh / 2, nz + 0.6, 1.2, nh * 0.58);
    // Its reflection streaks across the wet pavement toward the camera.
    b.halo?.puddle(nc, fx - side * 1.8, nz, 0.7, nh * 0.9);
    for (let i = 0; i < Math.floor(nh / 1.4); i++) b.glow.box(0xffffff, fx - side * 0.84, 4.4 + i * 1.4, nz, 0.02, 0.8, 0.5);
  }
  if (rng.chance(0.5)) {
    const nc = rng.pick(NEON);
    s.box(0x22252f, x, h + 1.6, z, 1.0, 3.2, w * 0.7);
    b.glow.box(nc, fx + side * 0.6, h + 1.8, z, 0.1, 2.4, w * 0.6);
    b.halo?.halo(nc, fx + side * 0.6, h + 1.8, z + w * 0.3, 2.0, 1.9);
  }
}

export function vending(b: Batch, rng: Rng, x: number, z: number, side: number) {
  const c = rng.pick([0xf1f1f1, 0xd62828, 0x1d4ed8]);
  b.lit.box(c, x, 0.95, z, 0.8, 1.9, 1.1);
  b.glow.box(0xe6f6ff, x - side * 0.41, 1.25, z, 0.02, 0.9, 0.9);
  b.halo?.halo(0xbfe4ff, x - side * 0.5, 1.2, z + 0.7, 1.3);
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

// ── Bangkok skyline and skytrain ────────────────────────────────────────
const GLASS = [0x6f93b3, 0x7fa3c0, 0x5d7f9e, 0x8db3c9, 0x9ab2c4];
const CONCRETE = [0xe6e1d8, 0xd8d4cc, 0xcfd6dc, 0xf0ece4];

/**
 * Office or condo tower: a podium, a glass shaft banded floor by floor with
 * light concrete slabs and mullions, a stepped crown and roof plant.
 * The face toward the track (side = -1: it stands left) gets the detail.
 */
export function bkkTower(b: Batch, rng: Rng, x: number, z: number, w: number, h: number, side: number) {
  const s = b.lit;
  const glass = rng.pick(GLASS), slab = rng.pick(CONCRETE);
  s.box(slab, x, 3, z, w + 3, 6, w + 3);
  s.box(0x3d4b5a, x - side * (w / 2 + 1.52), 2.2, z, 0.05, 3, w + 1);
  s.box(glass, x, 6 + (h - 6) / 2, z, w, h - 6, w);
  // Floor slabs: thin rings round the shaft; every few floors a thicker band.
  for (let y = 9; y < h - 2; y += 3.4) {
    const thick = Math.round((y - 9) / 3.4) % 4 === 3;
    s.box(slab, x, y, z, w + 0.24, thick ? 0.7 : 0.28, w + 0.24);
  }
  // Mullions on the street face.
  const fx = x - side * (w / 2 + 0.06);
  for (let i = 1; i < 5; i++) s.box(slab, fx, 6 + (h - 6) / 2, z - w / 2 + (i * w) / 5, 0.12, h - 6, 0.16);
  // Lit offices here and there.
  for (let y = 10.7; y < h - 3; y += 3.4) {
    for (let i = 0; i < 5; i++) {
      if (!rng.chance(0.18)) continue;
      b.glow.box(rng.pick([0xfff2cf, 0xe9f4ff]), fx - side * 0.02, y, z - w / 2 + (i + 0.5) * (w / 5), 0.04, 2.2, w / 5 - 0.35);
    }
  }
  // Crown: a set-back top storey, a parapet and roof plant or a mast.
  s.box(slab, x, h + 1.4, z, w * 0.7, 2.8, w * 0.7);
  s.box(slab, x, h + 0.25, z, w + 0.4, 0.5, w + 0.4);
  if (rng.chance(0.5)) cylinder(s, 0xd8d8d8, x, h + 2.8, z, 0.12, rng.range(5, 9), 6);
  else for (let i = 0; i < 3; i++) s.box(0x9aa3ab, x + rng.range(-w / 4, w / 4), h + 3.3, z + rng.range(-w / 4, w / 4), 1.4, 1, 1.4);
}

/** Height of the skytrain deck's running surface. */
export const BTS_Y = 7.4;
/** The deck's centre line (right of the road, over the pavement), and where the shops behind it start. */
export const BTS_X = 6.6;
export const BTS_FACE = 9.2;

/**
 * One stretch of the elevated skytrain: a concrete deck over the pavement,
 * running along the track from z0 for len metres, on a T-pier at its middle.
 * x is the deck's centre line.
 */
export function btsViaduct(s: Shapes, x: number, z0: number, len: number) {
  const zc = z0 - len / 2;
  s.long(0xd9d5cc, x, BTS_Y - 0.55, zc, 4.4, 1.1, len);
  s.long(0xb9b4aa, x, BTS_Y - 1.25, zc, 2.6, 0.3, len);
  // Parapets: low on the street side so the trains show over it, a full wall outside.
  s.long(0xe9e5dc, x - 2.1, BTS_Y + 0.2, zc, 0.2, 0.4, len);
  s.long(0xe9e5dc, x + 2.1, BTS_Y + 0.45, zc, 0.2, 0.9, len);
  s.long(0x8f8a80, x, BTS_Y + 0.04, zc, 3.2, 0.08, len);
  for (const o of [-0.72, 0.72]) s.long(0x6a6f76, x + o, BTS_Y + 0.12, zc, 0.12, 0.12, len);
  // The pier: a round column and a hammerhead under the deck.
  cylinder(s, 0xd2cdc3, x, -0.1, zc, 0.85, BTS_Y - 1.95, 12);
  s.box(0xd2cdc3, x, BTS_Y - 1.75, zc, 4.6, 0.9, 1.6);
}

/** The skytrain itself: a few cars along -z from z, glowing windows, livery stripes. Built in its own batch to move as one. */
export function skytrain(b: Batch, x: number, cars: number) {
  const s = b.lit;
  const L = 20;
  for (let i = 0; i < cars; i++) {
    const zc = -i * (L + 0.6) - L / 2;
    s.box(0xeef0f2, x, BTS_Y + 1.85, zc, 2.9, 3.0, L);
    s.box(0x2f2f36, x, BTS_Y + 0.42, zc, 2.6, 0.5, L - 3);
    s.box(0xd7dbe0, x, BTS_Y + 3.42, zc, 2.3, 0.18, L - 2);
    for (const f of [-1, 1]) {
      // Livery: a broad green band low down, a dark window band, a blue line on top.
      s.box(0x149a48, x + f * 1.46, BTS_Y + 1.05, zc, 0.04, 0.75, L - 0.4);
      s.box(0x1d2a3a, x + f * 1.46, BTS_Y + 2.25, zc, 0.04, 1.15, L - 0.6);
      s.box(0x1e5aa8, x + f * 1.46, BTS_Y + 3.05, zc, 0.04, 0.22, L - 0.4);
      for (let k = 0; k < 5; k++) b.glow.box(0xbfe2ff, x + f * 1.48, BTS_Y + 2.3, zc - L / 2 + 2 + k * 4, 0.03, 0.85, 2.5);
      for (const dz of [-L / 4, L / 4]) s.box(0x9aa3ab, x + f * 1.47, BTS_Y + 1.9, zc + dz, 0.04, 2.3, 1.3);
    }
  }
  // Cab ends: dark windscreen, green nose, headlights.
  for (const [zc, f] of [[0.02, 1], [-cars * (L + 0.6) + 0.58, -1]] as const) {
    s.box(0x1d2a3a, x, BTS_Y + 2.35, zc + f * 0.01, 2.4, 1.2, 0.05);
    s.box(0x149a48, x, BTS_Y + 1.15, zc + f * 0.01, 2.6, 0.8, 0.06);
    for (const o of [-0.85, 0.85]) b.glow.box(0xfff6d0, x + o, BTS_Y + 1.15, zc + f * 0.05, 0.4, 0.25, 0.04);
  }
}

/** Tokyo Tower: a tapering red-and-white lattice on four splayed legs, two observation decks, lit at night. */
export function tokyoTower(b: Batch, x: number, z: number, h: number) {
  const s = b.lit;
  const red = 0xe2452b, white = 0xf4f1ea;
  // Width at a height (fraction 0..1): wide legs, a fast taper, then a slim mast.
  const half = (t: number) => (t < 0.12 ? 0.22 - t * 0.9 : t < 0.6 ? 0.112 - (t - 0.12) * 0.17 : Math.max(0.012, 0.03 - (t - 0.6) * 0.045)) * h;
  const N = 18;
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const col = Math.floor(i / 2) % 2 ? white : red;
    for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      rod(s, col, x + cx * half(t0), t0 * h, z + cz * half(t0), x + cx * half(t1), t1 * h, z + cz * half(t1), 0.012 * h, CYL6);
    }
    // Cross-bracing on every face.
    const y0 = t0 * h, y1 = t1 * h, a = half(t0), c = half(t1);
    for (const f of [-1, 1]) {
      rod(s, col, x - a, y0, z + f * a, x + c, y1, z + f * c, 0.005 * h);
      rod(s, col, x + f * a, y0, z - a, x + f * c, y1, z + c, 0.005 * h);
    }
    // Night: a string of lights up each leg.
    b.glow.box(0xffb36b, x - half(t0), y0, z + half(t0), 0.012 * h, 0.012 * h, 0.012 * h);
    b.glow.box(0xffb36b, x + half(t0), y0, z + half(t0), 0.012 * h, 0.012 * h, 0.012 * h);
  }
  // Main and top decks.
  for (const [t, r, dh] of [[0.36, 0.085, 0.035], [0.7, 0.035, 0.02]] as const) {
    s.box(white, x, t * h, z, r * 2 * h, dh * h, r * 2 * h);
    b.glow.box(0xfff0c8, x, t * h, z + r * h + 0.05, r * 1.7 * h, dh * 0.5 * h, 0.05);
    s.box(red, x, (t + dh * 0.7) * h, z, r * 2.1 * h, dh * 0.4 * h, r * 2.1 * h);
  }
  b.halo?.halo(0xff7a3d, x, h * 0.4, z + h * 0.15, h * 0.32, h * 0.45);
  b.glow.box(0xff3b2f, x, h, z, 0.02 * h, 0.02 * h, 0.02 * h);
}

/** A slim skyscraper with its glass "pixels" stepping out in a spiral (Bangkok's MahaNakhon). */
export function pixelTower(b: Batch, x: number, z: number, h: number, w: number) {
  const s = b.lit;
  s.box(0x8fb0c8, x, h / 2, z, w, h, w);
  for (let y = 3; y < h; y += 2.4) s.box(0xd6e2ea, x, y, z, w + 0.1, 0.18, w + 0.1);
  // The cut-away spiral: boxes stepped out round the tower, climbing as they turn.
  const turns = 1.4;
  for (let i = 0; i < 40; i++) {
    const t = i / 40, a = t * turns * Math.PI * 2, y = h * (0.15 + t * 0.8);
    const r = w / 2 + 0.6;
    const px = x + Math.cos(a) * r * 0.75, pz = z + Math.sin(a) * r * 0.75;
    s.box(i % 3 ? 0xa9c5d6 : 0xe8eef2, px, y, pz, w * 0.42, 1.6, w * 0.42);
    if (i % 4 === 0) b.glow.box(0xfff3d6, px, y, pz + w * 0.22, w * 0.3, 0.8, 0.04);
  }
  s.box(0xd6e2ea, x, h + 1, z, w * 0.8, 2, w * 0.8);
}
