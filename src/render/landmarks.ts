// Set pieces at fixed distances: the start (painted boxes, starting blocks,
// grandstands, gantry), the gates between zones and the finish. Each country
// dresses them in its own architecture.
import * as THREE from 'three';
import { START_SLOTS } from '../config.ts';
import { Rng } from '../core/rng.ts';
import type { CountryId, Palette } from '../world/biomes.ts';
import { GOLD, ball, cone, cylinder, rod, torii, type Batch } from './kit.ts';
import { TRACK_HALF } from './scenery.ts';

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Text board facing the runners, centred at (x, y, z). */
export function banner(text: string, x: number, y: number, z: number, w: number, h: number, bg: string, fg = '#fff', border = '') {
  const map = canvasTexture(512, Math.round((512 * h) / w), (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    if (border) {
      g.strokeStyle = border;
      g.lineWidth = 10;
      g.strokeRect(8, 8, g.canvas.width - 16, g.canvas.height - 16);
    }
    g.fillStyle = fg;
    const size = Math.min(g.canvas.height * 0.62, 64);
    g.font = `900 ${size}px system-ui, 'Noto Sans Thai', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, g.canvas.width / 2, g.canvas.height / 2 + 3);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide }));
  m.position.set(x, y, z);
  return m;
}

/** Big painted lane number lying on the track. */
function laneNumber(n: number, x: number, z: number) {
  const map = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#ffffff';
    g.font = '900 104px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), 64, 70);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.02, z);
  return m;
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Grandstand with a cheering crowd, beside the track at |x| = from. */
function grandstand(b: Batch, rng: Rng, side: number, z: number, len: number, from: number, flags: number[]) {
  const s = b.lit;
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const x = side * (from + 0.9 + r * 1.1);
    s.box(r % 2 ? 0xd9d9d9 : 0xc4c4c4, x, 0.35 + r * 0.55, z, 1.1, 0.7 + r * 1.1, len);
    for (let i = 0; i < len / 0.7 - 1; i++) {
      if (rng.chance(0.15)) continue;
      const pz = z - len / 2 + 0.5 + i * 0.7 + rng.range(-0.1, 0.1);
      const py = 0.7 + r * 1.1;
      s.box(rng.pick([0xe63946, 0x3a86ff, 0xffbe0b, 0x06d6a0, 0xffffff, 0x8338ec, 0xfb5607]), x, py + 0.35, pz, 0.38, 0.6, 0.42);
      ball(s, rng.pick([0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524]), x, py + 0.8, pz, 0.17);
      if (rng.chance(0.25)) s.box(rng.pick(flags), x - side * 0.05, py + 1.2, pz, 0.03, 0.35, 0.5);
    }
  }
  s.box(0x6c757d, side * (from + 0.9 + rows * 1.1 + 0.2), 2.6, z, 0.3, 5.2, len);
  s.box(flags[0], side * (from + 2.6), 5.5, z, 4.6, 0.12, len + 0.4);
}

/** Arch over the track in the country's style; returns the y of its name board. */
function countryArch(b: Batch, country: CountryId | null, d: number, main: number, accent: number): number {
  const s = b.lit;
  const z = -d;
  const x = TRACK_HALF + 0.7;
  switch (country) {
    case 'th': {
      for (const e of [-1, 1]) {
        s.box(0xfbf6ec, e * x, 3.2, z, 0.9, 6.4, 0.9);
        s.box(GOLD, e * x, 6.5, z, 1.1, 0.25, 1.1);
        s.box(main, e * x, 1.0, z, 0.95, 0.4, 0.95);
      }
      s.box(0xfbf6ec, 0, 6.9, z, 2 * x + 1.4, 1.1, 0.9);
      for (let t = 0; t < 3; t++) {
        s.prism(0x1f7a55, 0, 7.4 + t * 0.9, z, 2 * x + 2 - t * 2.4 + 0.4, 1.5, 1.5);
        s.prism(0xe8641a, 0, 7.55 + t * 0.9, z, 2 * x + 2 - t * 2.4, 1.4, 1.4);
      }
      cone(s, GOLD, 0, 10.2, z, 0.3, 2.4, 6);
      for (const e of [-1, 1]) cone(s, GOLD, e * (x + 1.1), 7.7, z, 0.15, 1.1, 6, 0, e * 0.6);
      return 6.9;
    }
    case 'cn': {
      for (const e of [-1, 1]) {
        cylinder(s, 0xb22222, e * x, 0, z, 0.32, 7.2, 8);
        cylinder(s, 0x6d6a66, e * x, 0, z, 0.55, 0.6, 8);
        cylinder(s, 0xb22222, e * (x + 3), 0, z, 0.26, 5.2, 8);
        s.eaves(0x2f5d50, e * (x + 3), 5.2, z, 3.6, 1.6, 1.0);
      }
      s.box(0xb22222, 0, 6.2, z, 2 * x + 1.2, 0.5, 0.5);
      s.box(0x2f5d50, 0, 6.65, z, 2 * x + 1.0, 0.35, 0.55);
      s.eaves(0x2f5d50, 0, 7.2, z, 2 * x + 3.4, 2.4, 1.8);
      s.box(GOLD, 0, 7.4, z, 1.0, 0.25, 0.25);
      return 5.4;
    }
    case 'jp': {
      torii(s, z, x, 8.4, 0xe8461e, 0x1d1d1d);
      return 7.25;
    }
    default: {
      s.box(main, -x, 3, z, 0.6, 6, 0.6).box(main, x, 3, z, 0.6, 6, 0.6);
      s.box(main, 0, 6.2, z, 2 * x + 1, 0.8, 0.7);
      ball(s, accent, -x, 6.6, z, 0.5);
      ball(s, accent, x, 6.6, z, 0.5);
      return 6.2;
    }
  }
}

export interface Landmark { batch: Batch; extras: THREE.Mesh[] }

const FLAG_COLORS: Record<CountryId, number[]> = {
  th: [0xd62828, 0xffffff, 0x1d3557],
  cn: [0xde2910, 0xffde00],
  jp: [0xffffff, 0xbc002d],
};

/** Start straight: painted boxes, blocks, numbers, stands and the gantry. */
export function startArea(b: Batch, country: CountryId | null, seed: number): THREE.Mesh[] {
  const s = b.lit;
  const rng = new Rng(seed ^ 0x77);
  const extras: THREE.Mesh[] = [];
  // Box lines between the start slots, and the white start line.
  const edges = [-3.4, -1.7, 0, 1.7, 3.4];
  for (const x of edges) s.long(0xffffff, x, 0.012, 3.5, 0.08, 0.02, 9);
  s.box(0xffffff, 0, 0.013, -0.75, TRACK_HALF * 2, 0.02, 0.2);
  START_SLOTS.forEach((x, i) => {
    // Starting blocks: a rail with two angled pedals.
    s.box(0x3a3d45, x, 0.04, 0.55, 0.12, 0.08, 1.1);
    for (const [px, pz] of [[-0.14, 0.15], [0.14, 0.6]]) {
      s.add(new THREE.BoxGeometry(1, 1, 1), 0xd62828, x + px, 0.12, pz, -0.75, 0, 0, 0.18, 0.04, 0.24);
    }
    extras.push(laneNumber(i + 1, x, 2.4));
  });
  const flags = country ? FLAG_COLORS[country] : [0xe63946, 0xffbe0b, 0x3a86ff];
  for (const side of [-1, 1]) grandstand(b, rng, side, 4, 22, TRACK_HALF + 2.2, flags);
  const y = countryArch(b, country, 1.2, 0x264653, 0xe9c46a);
  extras.push(banner('START · เริ่ม', 0, y, -0.6, TRACK_HALF * 2 + 0.6, 0.85, '#d62828', '#fff', '#ffd23f'));
  // Flag poles in the country's colours behind the stands.
  for (let i = 0; i < 6; i++) {
    for (const side of [-1, 1]) {
      const x = side * (TRACK_HALF + 8), z = 12 - i * 4;
      cylinder(s, 0xdddddd, x, 0, z, 0.06, 7, 6);
      s.box(flags[i % flags.length], x, 6.4, z - 0.7, 0.04, 0.9, 1.3);
    }
  }
  return extras;
}

export function zoneGate(b: Batch, country: CountryId | null, next: Palette, d: number): THREE.Mesh[] {
  const y = countryArch(b, country, d, next.a, next.c);
  const z = -d + 0.6;
  const bg = country === 'cn' ? '#8b1a1a' : country === 'jp' ? '#1d1d1d' : country === 'th' ? '#7a1f1f' : hex(next.d);
  const fg = country === 'cn' || country === 'th' ? '#ffd23f' : '#fff';
  const w = country === 'jp' ? 3.6 : TRACK_HALF * 2 + 0.4;
  const h = country === 'jp' ? 1.15 : 0.8;
  return [banner(next.name, 0, y, z, w, h, bg, fg, country ? '#e0b040' : '')];
}

export function finishArea(b: Batch, country: CountryId | null, d: number, seed: number): THREE.Mesh[] {
  const s = b.lit;
  const z = -d;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) {
    s.box((i + j) % 2 ? 0x111111 : 0xffffff, -TRACK_HALF + (i + 0.5) * (TRACK_HALF * 2) / 8, 0.014, z - 0.4 + j * 0.8, (TRACK_HALF * 2) / 8, 0.02, 0.8);
  }
  const rng = new Rng(seed ^ 0x99);
  const flags = country ? FLAG_COLORS[country] : [0xe63946, 0xffbe0b, 0x3a86ff];
  for (const side of [-1, 1]) grandstand(b, rng, side, z - 8, 24, TRACK_HALF + 2.2, flags);
  // Bunting over the line.
  for (const zz of [z + 6, z - 6]) {
    for (let i = 0; i < 10; i++) {
      const t = (i + 0.5) / 10, x = -TRACK_HALF - 1 + t * (2 * TRACK_HALF + 2);
      cone(s, flags[i % flags.length], x, 7.6 - Math.sin(t * Math.PI) * 0.5 - 0.6, zz, 0.22, 0.5, 6, Math.PI);
    }
    rod(s, 0x333333, -TRACK_HALF - 1, 7.6, zz, TRACK_HALF + 1, 7.6, zz, 0.02);
    for (const e of [-1, 1]) cylinder(s, 0xdddddd, e * (TRACK_HALF + 1), 0, zz, 0.07, 7.7, 6);
  }
  const y = countryArch(b, country, d, 0xffffff, 0xe63946);
  return [banner('FINISH · เส้นชัย', 0, y, z + 0.6, TRACK_HALF * 2 + 0.6, 0.85, '#111', '#fff', '#ffd23f')];
}
