// Set pieces at fixed distances: the start (painted boxes, starting blocks,
// country scenery, gantry), the gates between zones and the finish. Each country
// dresses them in its own architecture.
import * as THREE from 'three';
import { LANE_MAX, LANE_WIDTH, TRACK_HALF, laneDividers, startSlots } from '../config.ts';
import { Rng } from '../core/rng.ts';
import type { CountryId, Palette } from '../world/biomes.ts';
import {
  GOLD, ball, bamboo, chedi, cherryTree, coconutPalm, cone, cylinder, pagoda, prang, redLantern, rod, roundTree,
  stoneLantern, streetLamp, thaiFlag, thaiHall, torii, type Batch,
} from './kit.ts';
import { SCENE_HALF } from './scenery.ts';

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
  // Two faces back to back, so it reads the right way round from either side.
  const geo = new THREE.PlaneGeometry(w, h);
  const mat = new THREE.MeshBasicMaterial({ map });
  const m = new THREE.Mesh(geo, mat);
  const back = new THREE.Mesh(geo, mat);
  back.rotation.y = Math.PI;
  m.add(back);
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

/** Thai spirit house (san phra phum) on its post, hung with marigold garlands. */
function spiritHouse(s: Batch['lit'], x: number, z: number) {
  s.box(0xf4efe6, x, 0.7, z, 0.22, 1.4, 0.22);
  s.box(0xe9dfc9, x, 1.45, z, 1.0, 0.1, 1.0);
  s.box(0xfbf6ec, x, 1.85, z, 0.6, 0.7, 0.6);
  s.box(GOLD, x, 1.85, z, 0.62, 0.12, 0.62);
  s.prism(0xd62828, x, 2.2, z, 0.95, 0.55, 0.85);
  s.prism(0xe8641a, x, 2.55, z, 0.7, 0.45, 0.6);
  cone(s, GOLD, x, 2.95, z, 0.06, 0.7, 6);
  for (const [dx, dz] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) ball(s, 0xffa21f, x + dx, 1.55, z + dz, 0.07);
  ball(s, 0xd62828, x, 1.56, z - 0.42, 0.06);
}

/**
 * The country's own scenery beside the start and finish straights (in place
 * of grandstands): a temple, a pagoda, sakura, a storybook village. `from` is
 * |x| of the inner edge, `len` the stretch along z centred on `z`; `open` when
 * the zone leaves room for big buildings (not a pavement in front of shops).
 */
function roadside(b: Batch, rng: Rng, country: CountryId | null, side: number, z: number, len: number, from: number, open: boolean) {
  const s = b.lit;
  const X = (dx: number) => side * (from + dx);
  const z0 = z - len / 2, z1 = z + len / 2;
  switch (country) {
    case 'th': {
      // Along the pavement: spirit houses hung with garlands, little gold chedis, flags.
      for (let i = 0, pz = z0 + 1.5; pz < z1; i++, pz += 3.7) {
        if (i % 2) chedi(s, X(0.6), pz, 3.2);
        else spiritHouse(s, X(0.6), pz);
      }
      for (let i = 0, pz = z0 + 3.35; pz < z1; i++, pz += 3.7) thaiFlag(s, X(-1.3), pz, 4.6, i % 2 === 1);
      if (open) {
        // Room to spare (the finish out in the fields): a temple hall and white prangs.
        thaiHall(s, X(6.5), z, 5, len * 0.55);
        for (const pz of [z0 + 2.5, z1 - 2.5]) prang(s, X(4.2), pz, 7.5, 0xf4efe6, GOLD);
        for (const pz of [z0 - 1.5, z1 + 1.5]) coconutPalm(s, rng, X(rng.range(3, 5)), pz, rng.range(7, 9), side * 0.25);
      }
      break;
    }
    case 'cn': {
      // Red pagoda behind a row of lanterns on posts, bamboo either side.
      pagoda(b, X(6), z, 3, 4, 0xb22222, 0x2f5d50, GOLD);
      for (let pz = z0 + 1; pz < z1; pz += 3.6) {
        cylinder(s, 0x6d2a1a, X(0.6), 0, pz, 0.09, 3.2, 6);
        rod(s, 0x6d2a1a, X(0.6), 3.1, pz, X(0.1), 3.1, pz, 0.04);
        redLantern(b, X(0.1), 2.6, pz, 0.32);
      }
      for (const pz of [z0 + 1.5, z1 - 1.5]) {
        for (let k = 0; k < 6; k++) bamboo(s, rng, X(2.5 + rng.range(0, 2)), pz + rng.range(-1.5, 1.5), rng.range(6, 9), rng.range(-0.15, 0.15));
      }
      break;
    }
    case 'jp': {
      // Sakura avenue: blossom trees, stone lanterns and a low red fence.
      for (let pz = z0 + 1.5; pz < z1; pz += 5) cherryTree(s, rng, X(3.2 + rng.range(-0.4, 0.6)), pz, rng.range(5.5, 7), -side * 1.2);
      for (let pz = z0 + 4; pz < z1; pz += 5) stoneLantern(b, X(0.9), pz, 0.9);
      s.box(0xe8461e, X(0.3), 0.55, z, 0.1, 0.1, len);
      s.box(0xe8461e, X(0.3), 0.25, z, 0.1, 0.1, len);
      for (let pz = z0; pz <= z1; pz += 1.6) s.box(0x1d1d1d, X(0.3), 0.35, pz, 0.14, 0.7, 0.14);
      break;
    }
    default: {
      // Storybook village: timbered cottages with lit windows, round trees, lamps.
      for (let pz = z0 + 3; pz < z1 - 1; pz += 7.5) {
        const cx = X(3.6 + rng.range(0, 1)), w = rng.range(3.2, 4), d = rng.range(4, 5);
        s.box(0xf3e3c3, cx, 1.4, pz, w, 2.8, d);
        for (const e of [-1, 1]) s.box(0x6b4a2b, cx, 1.4, pz + e * (d / 2 - 0.1), w + 0.04, 2.8, 0.18);
        s.box(0x6b4a2b, cx, 2.8, pz, w + 0.04, 0.16, d + 0.04);
        s.prism(rng.pick([0xc0392b, 0x2f5fa8, 0x8e5a3c]), cx, 2.8, pz, w + 0.7, 2.2, d + 0.5);
        s.box(0x9a8f86, cx + side * 0.6, 4.4, pz + d * 0.25, 0.5, 1.4, 0.5);
        const face = cx - side * (w / 2 + 0.03);
        s.box(0x7a4a24, face, 0.9, pz, 0.06, 1.8, 0.9);
        for (const e of [-1, 1]) b.glow.box(0xffd27a, face, 1.7, pz + e * (d * 0.28), 0.05, 0.7, 0.7);
      }
      for (let pz = z0 + 6.75; pz < z1; pz += 7.5) roundTree(s, rng, X(4 + rng.range(0, 1.5)), pz, rng.range(4.5, 6), [0x5aa05a, 0x3f8f4f, 0x7cc06a]);
      for (let pz = z0 + 2; pz < z1; pz += 7) streetLamp(b, X(0.5), pz, side, 3.4, 0xffd27a, 0x2f3a3f);
    }
  }
}

/** Arch over the track in the country's style; returns the y of its name board. */
function countryArch(b: Batch, country: CountryId | null, d: number, main: number, accent: number): number {
  const s = b.lit;
  const z = -d;
  const x = SCENE_HALF + 0.7;
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

/** Start straight: painted boxes, blocks, numbers, country scenery and the gantry. */
export function startArea(b: Batch, country: CountryId | null, seed: number): THREE.Mesh[] {
  const s = b.lit;
  const rng = new Rng(seed ^ 0x77);
  const extras: THREE.Mesh[] = [];
  // Box lines between the lanes, the white start line, and a block in every lane.
  s.box(0xffffff, 0, 0.013, -0.75, SCENE_HALF * 2, 0.02, 0.2);
  s.exact(() => {
    const outer = (LANE_MAX + 0.5) * LANE_WIDTH;
    for (const x of [-outer, ...laneDividers(), outer]) s.long(0xffffff, x, 0.012, 3.5, 0.08, 0.02, 9);
    startSlots().forEach((x) => {
      // Starting blocks: a rail with two angled pedals.
      s.box(0x3a3d45, x, 0.04, 0.55, 0.12, 0.08, 1.1);
      for (const [px, pz] of [[-0.14, 0.15], [0.14, 0.6]]) {
        s.add(new THREE.BoxGeometry(1, 1, 1), 0xd62828, x + px, 0.12, pz, -0.75, 0, 0, 0.18, 0.04, 0.24);
      }
    });
  });
  // Lane 1 is the runners' right, so it reads 1, 2, 3… left to right facing the line.
  startSlots().forEach((x, i, all) => extras.push(laneNumber(all.length - i, x, 2.4)));
  const flags = country ? FLAG_COLORS[country] : [0xe63946, 0xffbe0b, 0x3a86ff];
  for (const side of [-1, 1]) roadside(b, rng, country, side, 4, 22, SCENE_HALF + 2.2, false);
  const y = countryArch(b, country, 1.2, 0x264653, 0xe9c46a);
  extras.push(banner('START · เริ่ม', 0, y, -0.6, TRACK_HALF * 2 + 0.6, 0.85, '#d62828', '#fff', '#ffd23f'));
  // Flag poles in the country's colours behind the scenery.
  for (let i = 0; i < 6; i++) {
    for (const side of [-1, 1]) {
      const x = side * (SCENE_HALF + 8), z = 12 - i * 4;
      cylinder(s, 0xdddddd, x, 0, z, 0.06, 7, 6);
      s.fluttering((_x, _y, vz) => (z - vz) / 1.3, () => s.cloth(flags[i % flags.length], x, 6.4, z - 0.7, 0.04, 0.9, 1.3));
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
  // Checkered line, tiles of the same size whatever the width.
  const tiles = Math.round(TRACK_HALF * 2 / 0.95);
  s.exact(() => {
    for (let i = 0; i < tiles; i++) for (let j = 0; j < 2; j++) {
      s.box((i + j) % 2 ? 0x111111 : 0xffffff, -TRACK_HALF + (i + 0.5) * (TRACK_HALF * 2) / tiles, 0.014, z - 0.4 + j * 0.8, (TRACK_HALF * 2) / tiles, 0.02, 0.8);
    }
  });
  const rng = new Rng(seed ^ 0x99);
  const flags = country ? FLAG_COLORS[country] : [0xe63946, 0xffbe0b, 0x3a86ff];
  for (const side of [-1, 1]) roadside(b, rng, country, side, z - 8, 24, SCENE_HALF + 2.2, true);
  // Bunting over the line, spread over the real width.
  for (const zz of [z + 6, z - 6]) s.exact(() => {
    for (let i = 0; i < 10; i++) {
      const t = (i + 0.5) / 10, x = -TRACK_HALF - 1 + t * (2 * TRACK_HALF + 2);
      s.fluttering((_x, y) => (7.6 - Math.sin(t * Math.PI) * 0.5 - 0.35 - y) * 0.9, () => cone(s, flags[i % flags.length], x, 7.6 - Math.sin(t * Math.PI) * 0.5 - 0.6, zz, 0.22, 0.5, 6, Math.PI));
    }
    rod(s, 0x333333, -TRACK_HALF - 1, 7.6, zz, TRACK_HALF + 1, 7.6, zz, 0.02);
    for (const e of [-1, 1]) cylinder(s, 0xdddddd, e * (TRACK_HALF + 1), 0, zz, 0.07, 7.7, 6);
  });
  const y = countryArch(b, country, d, 0xffffff, 0xe63946);
  return [banner('FINISH · เส้นชัย', 0, y, z + 0.6, TRACK_HALF * 2 + 0.6, 0.85, '#111', '#fff', '#ffd23f')];
}
