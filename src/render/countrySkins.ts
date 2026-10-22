// Obstacle looks for the country maps. Same mechanics and hitboxes as the
// greybox (see obstacles.ts), drawn as things you'd meet on a street in that
// country: tuk-tuks and elephants, stone lions and lion dancers, daruma and
// Nara deer. Built in the same local frames as obstacleView's greybox.
import * as THREE from 'three';
import { LANE_COUNT, LANE_WIDTH } from '../config.ts';
import { BIOMES, type CountryId } from '../world/biomes.ts';
import { PENDULUM, SWEEPER, type Obstacle } from '../world/obstacles.ts';
import { GOLD, GOLD_DARK, ball, blob, cone, cylinder, rod } from './kit.ts';
import type { Shapes } from './shapes.ts';

const W = LANE_WIDTH - 0.3;
const trackW = () => LANE_WIDTH * LANE_COUNT;

export const countryOf = (o: Obstacle): CountryId | undefined => BIOMES[o.biome].country;

const X = Math.PI / 2;
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const ICO1 = new THREE.IcosahedronGeometry(1, 1);

/** Cylinder lying across the track (axis x), centred at (x, y, z). */
const across = (s: Shapes, color: number, x: number, y: number, z: number, r: number, len: number, geo = CYL) =>
  s.add(geo, color, x, y, z, 0, 0, X, r, len, r);

/** Stake positions (x, z) for a spike bed of length `len`: 3 across, rows ~0.8 m apart. */
function spikeSpots(len: number): [number, number][] {
  const rows = Math.max(2, Math.round(len / 0.8));
  const out: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    const dz = -(r + 0.5) * (len / rows);
    for (const x of r % 2 ? [-0.45, 0.45] : [-0.72, 0, 0.72]) out.push([x, dz]);
  }
  return out;
}

// ── Static parts ───────────────────────────────────────────────────────
export function countryStatic(o: Obstacle, s: Shapes): boolean {
  const c = countryOf(o);
  if (!c) return false;
  const z = -o.length / 2;
  switch (o.kind) {
    case 'lowbar':
      if (c === 'th') {
        // Red-and-white road barrier on trestles.
        for (const x of [-W / 2 + 0.15, W / 2 - 0.15]) {
          s.add(new THREE.BoxGeometry(1, 1, 1), 0x6b4a2b, x, 0.45, -0.15, 0.35, 0, 0, 0.1, 0.95, 0.1);
          s.add(new THREE.BoxGeometry(1, 1, 1), 0x6b4a2b, x, 0.45, -0.45, -0.35, 0, 0, 0.1, 0.95, 0.1);
        }
        for (let i = 0; i < 6; i++) s.box(i % 2 ? 0xffffff : 0xd62828, -W / 2 + (i + 0.5) * (W / 6), 0.78, -0.3, W / 6, 0.22, 0.12);
        s.box(0xffd23f, 0, 0.5, -0.3, W, 0.06, 0.06);
      } else if (c === 'cn') {
        s.box(0xb22222, 0, 0.82, -0.3, W, 0.12, 0.14);
        s.box(0xb22222, 0, 0.35, -0.3, W, 0.08, 0.1);
        for (let i = 0; i <= 4; i++) {
          const x = -W / 2 + (i * W) / 4;
          s.box(0xb22222, x, 0.45, -0.3, 0.14, 0.9, 0.14);
          ball(s, GOLD, x, 0.95, -0.3, 0.1);
        }
        for (let i = 0; i < 4; i++) s.box(GOLD_DARK, -W / 2 + (i + 0.5) * (W / 4), 0.58, -0.3, 0.3, 0.3, 0.04);
      } else {
        // Bamboo fence with black ties.
        for (const y of [0.35, 0.65, 0.9]) across(s, 0xc9b26b, 0, y, -0.3, 0.05, W, CYL8);
        for (let i = 0; i <= 6; i++) {
          const x = -W / 2 + (i * W) / 6;
          cylinder(s, 0xb59a55, x, 0, -0.3, 0.05, 0.95, 6);
          s.box(0x1d1d1d, x, 0.65, -0.3, 0.12, 0.05, 0.12);
        }
      }
      return true;

    case 'highbar': {
      const post = c === 'cn' ? 0xb22222 : c === 'jp' ? 0x5a3e2b : 0x7a4b2a;
      s.box(post, -W / 2, 1.6, -0.3, 0.16, 3.2, 0.16).box(post, W / 2, 1.6, -0.3, 0.16, 3.2, 0.16);
      s.box(post, 0, 3.15, -0.3, W + 0.3, 0.16, 0.18);
      if (c === 'th') {
        s.box(GOLD, 0, 1.95, -0.3, W - 0.05, 1.5, 0.1);
        s.box(0xb22222, 0, 1.95, -0.26, W - 0.3, 1.25, 0.06);
        s.box(0xffd23f, 0, 2.2, -0.22, W - 0.9, 0.18, 0.02);
        s.box(0xffffff, 0, 1.8, -0.22, W - 0.7, 0.14, 0.02);
        // Marigold garland along the bottom edge.
        for (let i = 0; i < 9; i++) ball(s, i % 2 ? 0xffa62b : 0xffd23f, -W / 2 + 0.15 + (i * (W - 0.3)) / 8, 1.17, -0.3, 0.09);
      } else if (c === 'cn') {
        s.box(0xc0392b, 0, 2.0, -0.3, W - 0.2, 1.3, 0.06);
        s.box(GOLD, 0, 2.65, -0.3, W - 0.1, 0.1, 0.08).box(GOLD, 0, 1.35, -0.3, W - 0.1, 0.1, 0.08);
        ball(s, GOLD, 0, 2.0, -0.26, 0.32, 0.25);
        for (const x of [-W / 2 + 0.35, W / 2 - 0.35]) {
          ball(s, 0xff3b2f, x, 1.45, -0.3, 0.22, 0.85);
          cylinder(s, GOLD, x, 1.6, -0.3, 0.1, 0.06, 8);
        }
      } else {
        // Indigo noren curtain split into panels.
        for (let i = 0; i < 4; i++) {
          const x = -W / 2 + 0.05 + (i + 0.5) * ((W - 0.1) / 4);
          s.box(0x23395d, x, 2.05, -0.3, (W - 0.1) / 4 - 0.06, 1.75, 0.04);
        }
        ball(s, 0xffffff, 0, 2.15, -0.27, 0.3, 0.15);
        s.box(0xe8e2d0, 0, 2.95, -0.3, W + 0.1, 0.12, 0.2);
      }
      return true;
    }

    case 'wall':
      if (c === 'th') {
        // Fruit seller's stacked crates under a parasol.
        for (let r = 0; r < 3; r++) for (let i = 0; i < 2; i++) {
          s.box(0xa47148, (i - 0.5) * 1.0, 0.35 + r * 0.7, z, 0.95, 0.65, o.length * 0.8);
          s.box(0x7a5230, (i - 0.5) * 1.0, 0.35 + r * 0.7, z + o.length * 0.41, 0.95, 0.08, 0.02);
        }
        for (let i = 0; i < 8; i++) ball(s, [0xff8c42, 0xffd166, 0x8ac926, 0xef476f][i % 4], -0.8 + (i % 4) * 0.53, 2.2, z - 0.3 + Math.floor(i / 4) * 0.5, 0.2);
        cylinder(s, 0xdddddd, 0, 2.1, z, 0.04, 0.6, 8);
        s.add(new THREE.ConeGeometry(1, 1, 8), 0xe63946, 0, 2.8, z, 0, 0, 0, 1.15, 0.2, 1.0);
      } else if (c === 'cn') {
        // Stone guardian lion on a plinth.
        const st = 0x9a958c, dk = 0x7f7a72;
        s.box(dk, 0, 0.45, z, W - 0.1, 0.9, o.length);
        s.box(st, 0, 0.98, z, W - 0.3, 0.16, o.length - 0.1);
        s.add(ICO1, st, 0, 1.55, z, 0, 0, 0, 0.62, 0.55, 0.55);
        ball(s, st, 0, 2.25, z + 0.15, 0.48);
        for (let i = 0; i < 7; i++) ball(s, dk, Math.cos(i) * 0.4, 2.35 + Math.sin(i * 1.7) * 0.25, z - 0.1 + Math.sin(i) * 0.2, 0.17);
        ball(s, 0x2b2b2b, -0.17, 2.32, z + 0.58, 0.07);
        ball(s, 0x2b2b2b, 0.17, 2.32, z + 0.58, 0.07);
        s.box(dk, 0, 2.08, z + 0.58, 0.4, 0.1, 0.06);
        ball(s, st, 0.45, 1.25, z + 0.45, 0.24);
        for (const x of [-0.35, 0.35]) cylinder(s, st, x, 1.05, z + 0.35, 0.14, 0.5, 8);
      } else {
        // Stacked sake barrels wrapped in straw.
        const barrel = (x: number, y: number, label: number) => {
          cylinder(s, 0xd8c08a, x, y, z, 0.5, 0.95, 12);
          cylinder(s, 0x6b4a2b, x, y + 0.08, z, 0.51, 0.06, 12);
          cylinder(s, 0x6b4a2b, x, y + 0.83, z, 0.51, 0.06, 12);
          s.box(label, x, y + 0.48, z + 0.47, 0.5, 0.5, 0.04);
          s.box(0xffffff, x, y + 0.48, z + 0.5, 0.14, 0.32, 0.02);
        };
        barrel(-0.5, 0, 0xd62828);
        barrel(0.5, 0, 0x1d3557);
        barrel(0, 0.95, 0x1d1d1d);
        barrel(-0.25, 1.9, 0xd62828);
      }
      return true;

    case 'hay':
      if (c === 'th') {
        // Glazed dragon water jar (ong mangkon).
        s.lathe(0x6b3a22, [[0, 0], [0.4, 0], [0.62, 0.3], [0.68, 0.6], [0.55, 0.95], [0.38, 1.05], [0.4, 1.12], [0, 1.12]], 0, 0, z, 12);
        cylinder(s, 0xe0a030, 0, 0.5, z, 0.69, 0.16, 12);
        for (let i = 0; i < 5; i++) ball(s, 0xffd23f, Math.cos(i * 1.25) * 0.66, 0.58, z + Math.sin(i * 1.25) * 0.66, 0.08);
      } else if (c === 'cn') {
        // Tower of bamboo dim sum steamers.
        for (let i = 0; i < 4; i++) {
          cylinder(s, 0xd8b56a, 0, i * 0.26, z, 0.62 - i * 0.03, 0.22, 12);
          cylinder(s, 0xb08a42, 0, i * 0.26 + 0.2, z, 0.63 - i * 0.03, 0.05, 12);
        }
        s.lathe(0xd8b56a, [[0, 0], [0.55, 0], [0.4, 0.06], [0.12, 0.08], [0.08, 0.1], [0, 0.1]], 0, 1.04, z, 12);
      } else {
        // Daruma doll.
        blob(s, 0xd62828, 0, 0.55, z, 0.62, 0.58, 0.58, true);
        ball(s, 0xd62828, 0, 0.98, z, 0.42);
        s.add(new THREE.CircleGeometry(0.28, 14), 0xf8f4ea, 0, 0.98, z + 0.41);
        for (const x of [-0.11, 0.11]) {
          ball(s, 0xffffff, x, 1.0, z + 0.42, 0.075);
          ball(s, 0x111111, x, 1.0, z + 0.48, 0.035);
          s.box(0x111111, x, 1.12, z + 0.42, 0.12, 0.035, 0.02);
        }
        s.box(GOLD, 0, 0.5, z + 0.6, 0.5, 0.18, 0.04);
      }
      return true;

    case 'gap': {
      const water = c === 'cn' ? 0x2f8f7a : c === 'jp' ? 0x2a6f97 : 0x3f8f6a;
      const edge = c === 'cn' ? 0x8f8a80 : c === 'jp' ? 0x7f7a72 : 0x6b4a2b;
      s.box(water, 0, -0.35, z, trackW() + 0.6, 0.06, o.length);
      s.box(0x1f3f3a, 0, -0.6, z, trackW() + 0.6, 0.06, o.length);
      s.box(edge, 0, 0.0, -0.06, trackW() + 0.6, 0.12, 0.14).box(edge, 0, 0.0, -o.length + 0.06, trackW() + 0.6, 0.12, 0.14);
      s.box(edge, -trackW() / 2 - 0.3, -0.25, z, 0.12, 0.5, o.length).box(edge, trackW() / 2 + 0.3, -0.25, z, 0.12, 0.5, o.length);
      if (c === 'cn') for (let i = 0; i < 5; i++) s.add(new THREE.CircleGeometry(0.35, 8), 0x5a9a3a, -3 + i * 1.5, -0.31, z + Math.sin(i * 2) * o.length * 0.3, -X);
      if (c === 'jp') for (let i = 0; i < 3; i++) s.add(ICO1, i % 2 ? 0xff8c42 : 0xffffff, -2 + i * 2, -0.38, z + (i - 1) * 0.6, 0, 0.6 * i, 0, 0.15, 0.06, 0.45);
      if (c === 'th') for (let i = 0; i < 4; i++) ball(s, 0x6fbf4f, -3 + i * 2, -0.3, z + Math.cos(i) * 0.8, 0.3, 0.15);
      return true;
    }

    case 'slow': {
      const snow = o.biome === 'jp_snow';
      const goo = snow ? 0xf8fbff : c === 'cn' ? 0x6b5a3a : 0x6b4a2b;
      s.box(goo, 0, 0.03, z, W, 0.06, o.length);
      for (let i = 0; i < 6; i++) ball(s, snow ? 0xffffff : goo, (i % 2 ? 0.45 : -0.45), 0.05, -1 - i * (o.length - 2) / 5, snow ? 0.4 : 0.28, 0.35);
      if (!snow) for (let i = 0; i < 8; i++) cone(s, 0x7dbb3c, -0.8 + (i % 4) * 0.55, 0.02, -1.5 - Math.floor(i / 4) * (o.length - 3), 0.06, 0.35, 6);
      return true;
    }

    case 'pendulum': {
      const x = PENDULUM.arm * Math.sin(PENDULUM.amplitude) + 0.9;
      const post = c === 'th' ? 0xc0392b : c === 'cn' ? 0x8b1a1a : 0xe8461e;
      for (const e of [-1, 1]) {
        s.box(post, e * x, PENDULUM.pivot / 2 + 0.2, -0.7, 0.45, PENDULUM.pivot + 0.4, 0.45);
        s.box(0x3a3a3a, e * x, 0.2, -0.7, 0.8, 0.4, 0.8);
      }
      s.box(post, 0, PENDULUM.pivot + 0.3, -0.7, 2 * x + 0.6, 0.45, 0.5);
      if (c === 'th') {
        // Giant Swing: the crossbar's flared gold ends.
        for (const e of [-1, 1]) cone(s, GOLD, e * (x + 0.55), PENDULUM.pivot + 0.1, -0.7, 0.25, 0.6, 6, 0, -e * X);
      } else if (c === 'cn') {
        s.eaves(0x2f5d50, 0, PENDULUM.pivot + 0.5, -0.7, 2 * x + 2, 1.6, 1.2);
      } else {
        s.box(0x1d1d1d, 0, PENDULUM.pivot + 0.65, -0.7, 2 * x + 1.4, 0.25, 0.6);
      }
      return true;
    }

    case 'spikes': {
      // A dark plate the full width it hurts, edged in hazard stripes, with a
      // hole for every stake: you can tell where it bites before it comes up.
      s.box(0x2b2b2b, 0, 0.03, z, W, 0.06, o.length);
      const stripes = 8;
      for (let i = 0; i < stripes; i++) {
        const col = i % 2 ? 0x1d1d1d : 0xffc300;
        const sx = -W / 2 + (W / stripes) * (i + 0.5);
        for (const e of [0, -o.length]) s.box(col, sx, 0.065, e + (e ? 0.09 : -0.09), W / stripes, 0.02, 0.18);
      }
      for (const e of [-1, 1]) s.box(0xffc300, e * (W / 2 - 0.09), 0.065, z, 0.18, 0.02, o.length);
      for (const [x, dz] of spikeSpots(o.length)) s.box(0x0d0d0d, x, 0.065, dz, 0.42, 0.02, 0.42);
      return true;
    }

    case 'sweeper': {
      const hub = c === 'th' ? GOLD : c === 'cn' ? 0xb22222 : 0x5a3e2b;
      cylinder(s, hub, 0, 0, z, 0.38, 0.95, 12);
      if (c === 'th') s.lathe(GOLD, [[0, 0], [0.32, 0], [0.18, 0.3], [0.05, 0.8], [0, 0.9]], 0, 0.95, z, 8);
      else if (c === 'cn') cylinder(s, GOLD, 0, 0.95, z, 0.45, 0.12, 12);
      else cylinder(s, 0x1d1d1d, 0, 0.95, z, 0.45, 0.12, 12);
      return true;
    }

    case 'bounce': {
      // A big drum to spring off.
      const body = c === 'th' ? 0xb22222 : c === 'cn' ? 0xc0392b : 0x7a4b2a;
      s.lathe(body, [[0, 0], [0.8, 0], [0.9, 0.15], [0.85, 0.3], [0, 0.3]], 0, 0, z, 14);
      cylinder(s, 0xf3e9d2, 0, 0.3, z, 0.8, 0.04, 12);
      cylinder(s, c === 'jp' ? 0x1d1d1d : GOLD, 0, 0.27, z, 0.86, 0.05, 12);
      for (let i = 0; i < 10; i++) ball(s, GOLD, Math.cos(i * 0.628) * 0.88, 0.2, z + Math.sin(i * 0.628) * 0.88, 0.05);
      if (c === 'jp') ball(s, 0xd62828, 0, 0.33, z, 0.3, 0.05);
      return true;
    }

    default:
      return false;
  }
}

// ── Moving parts ───────────────────────────────────────────────────────
export function countryMoving(o: Obstacle, s: Shapes, armOnly: boolean): boolean {
  const c = countryOf(o);
  if (!c) return false;
  const len = o.length;
  const z = -len / 2;
  switch (o.kind) {
    case 'oncoming':
      if (c === 'th') {
        // Tuk-tuk coming the wrong way.
        const f = z + len / 2;
        s.box(0x1f6fb2, 0, 0.75, z - 0.2, W - 0.4, 0.6, len - 0.6);
        s.box(0x1f6fb2, 0, 1.05, f - 0.55, 0.9, 0.9, 0.7);
        s.box(0xffd23f, 0, 1.95, z - 0.1, W - 0.25, 0.12, len - 0.3);
        for (const x of [-(W - 0.45) / 2, (W - 0.45) / 2]) {
          s.box(0x2b2d42, x, 1.4, z - 0.6, 0.08, 1.05, 0.08);
          s.box(0x2b2d42, x, 1.4, f - 0.35, 0.08, 1.05, 0.08);
          across(s, 0x1a1a1a, x, 0.3, z - len / 2 + 0.6, 0.3, 0.25);
        }
        across(s, 0x1a1a1a, 0, 0.3, f - 0.3, 0.3, 0.25);
        s.box(0x8a1c1c, 0, 1.05, z - 0.5, W - 0.6, 0.35, 1.0);
        s.box(0xbfe6ff, 0, 1.55, f - 0.25, 0.9, 0.5, 0.05);
        for (const x of [-0.3, 0.3]) ball(s, 0xfff4b0, x, 0.95, f - 0.18, 0.11);
        s.box(0xffd23f, 0, 0.6, f - 0.22, 0.7, 0.12, 0.05);
      } else if (c === 'cn') {
        // Lion dance charging at you.
        const f = z + len / 2;
        s.add(ICO1, 0xc0392b, 0, 1.45, f - 0.45, 0, 0, 0, 0.75, 0.6, 0.55);
        s.add(ICO1, GOLD, 0, 1.45, f - 0.05, 0, 0, 0, 0.6, 0.45, 0.15);
        for (const x of [-0.32, 0.32]) {
          ball(s, 0xffffff, x, 1.68, f, 0.17);
          ball(s, 0x111111, x, 1.7, f + 0.14, 0.08);
          cone(s, GOLD, x * 1.4, 1.95, f - 0.5, 0.12, 0.4, 6, 0, x > 0 ? -0.6 : 0.6);
        }
        ball(s, 0xffffff, 0, 1.25, f + 0.05, 0.22, 0.4);
        s.box(0xffd166, 0, 1.25, z - 0.3, 1.2, 0.7, len - 1.2);
        for (let k = 0; k < 6; k++) s.box(k % 2 ? 0xc0392b : GOLD, k % 2 ? 0.62 : -0.62, 1.0, z - len / 2 + 0.6 + k * 0.4, 0.05, 0.6, 0.35);
        for (const [x, dz] of [[-0.3, f - 0.7], [0.3, f - 0.7], [-0.3, z - len / 2 + 0.6], [0.3, z - len / 2 + 0.6]]) {
          cylinder(s, 0xf1c40f, x, 0, dz, 0.12, 0.95, 8);
          s.box(0x1d1d1d, x, 0.06, dz + 0.06, 0.2, 0.12, 0.3);
        }
      } else {
        // Rickshaw with its runner.
        const f = z + len / 2;
        s.box(0x1d1d1d, 0, 1.0, z - 0.6, 1.3, 0.8, 1.0);
        s.box(0xb22222, 0, 1.25, z - 0.55, 1.1, 0.5, 0.75);
        s.box(0x1d1d1d, 0, 1.75, z - 0.95, 1.3, 0.8, 0.15);
        for (const x of [-0.75, 0.75]) {
          s.add(new THREE.TorusGeometry(0.62, 0.05, 6, 16), 0x3a2a1e, x, 0.62, z - 0.6, 0, X, 0);
          rod(s, 0x6b4a2b, x * 0.6, 0.85, z - 0.1, x * 0.45, 0.85, f - 0.2, 0.04);
        }
        // Runner.
        s.box(0x23395d, 0, 1.2, f - 0.4, 0.55, 0.7, 0.35);
        ball(s, 0xe0ac69, 0, 1.7, f - 0.4, 0.17);
        s.add(new THREE.ConeGeometry(1, 1, 10), 0xd9c08a, 0, 1.88, f - 0.4, 0, 0, 0, 0.42, 0.18, 0.42);
        for (const x of [-0.15, 0.15]) cylinder(s, 0x1d1d1d, x, 0, f - 0.4 + (x > 0 ? 0.15 : -0.15), 0.08, 0.85, 6);
      }
      return true;

    case 'rolling':
      if (c === 'th') {
        // Giant rattan takraw ball.
        s.add(ICO1, 0xd9a441, 0, 0, 0, 0, 0, 0, 0.56, 0.56, 0.56);
        for (let i = 0; i < 3; i++) s.add(new THREE.TorusGeometry(0.55, 0.045, 5, 18), 0x8a5a1e, 0, 0, 0, i * 1.05, i * 0.6, 0);
      } else if (c === 'cn') {
        across(s, 0xff3b2f, 0, 0, 0, 0.55, 1.05, CYL);
        across(s, GOLD, 0, 0, 0, 0.57, 0.12, CYL);
        across(s, GOLD, 0.5, 0, 0, 0.4, 0.12, CYL);
        across(s, GOLD, -0.5, 0, 0, 0.4, 0.12, CYL);
        for (let i = 0; i < 6; i++) s.add(new THREE.BoxGeometry(1, 1, 1), 0xb22222, 0, Math.cos(i) * 0.56, Math.sin(i) * 0.56, i, 0, 0, 1.0, 0.04, 0.04);
      } else {
        // Taiko drum rolling on its rim.
        across(s, 0x7a4b2a, 0, 0, 0, 0.55, 1.1, CYL);
        across(s, 0xf3e9d2, 0.56, 0, 0, 0.5, 0.03, CYL);
        across(s, 0xf3e9d2, -0.56, 0, 0, 0.5, 0.03, CYL);
        for (const x of [-0.45, 0.45]) across(s, 0x1d1d1d, x, 0, 0, 0.57, 0.08, CYL);
        s.add(new THREE.CircleGeometry(0.3, 12), 0xd62828, 0.58, 0, 0, 0, X, 0);
      }
      return true;

    case 'shifter': {
      // Modelled around z = -0.7 with the head toward +z (obstacleView turns it to walk).
      const zc = -0.7;
      if (c === 'th') {
        const g = 0x8d8f99;
        s.add(ICO1, g, 0, 1.2, zc, 0, 0, 0, 0.7, 0.62, 0.95);
        ball(s, g, 0, 1.45, zc + 0.95, 0.48);
        for (const x of [-1, 1]) s.add(new THREE.CircleGeometry(0.42, 10), 0x7a7c86, x * 0.45, 1.5, zc + 0.85, 0, x * 1.2, 0);
        rod(s, g, 0, 1.25, zc + 1.3, 0, 0.6, zc + 1.45, 0.12);
        for (const x of [-0.18, 0.18]) ball(s, 0x1a1a1a, x, 1.6, zc + 1.38, 0.05);
        for (const [x, dz] of [[-0.35, 0.45], [0.35, 0.45], [-0.35, -0.45], [0.35, -0.45]]) cylinder(s, g, x, 0, zc + dz, 0.17, 0.85, 8);
        s.box(0xb22222, 0, 1.78, zc, 1.0, 0.08, 1.1);
        s.box(GOLD, 0, 1.79, zc, 1.04, 0.06, 0.3);
        cone(s, GOLD, 0, 1.8, zc, 0.12, 0.25, 6);
      } else if (c === 'cn') {
        const W_ = 0xf5f5f0, K = 0x222222;
        s.add(ICO1, W_, 0, 0.95, zc, 0, 0, 0, 0.7, 0.62, 0.85);
        s.add(ICO1, K, 0, 1.1, zc - 0.05, 0, 0, 0, 0.72, 0.25, 0.4);
        ball(s, W_, 0, 1.45, zc + 0.8, 0.45);
        for (const x of [-0.32, 0.32]) {
          ball(s, K, x, 1.8, zc + 0.75, 0.15);
          ball(s, K, x * 0.55, 1.5, zc + 1.18, 0.1, 1.3);
        }
        ball(s, K, 0, 1.35, zc + 1.24, 0.07);
        for (const [x, dz] of [[-0.38, 0.45], [0.38, 0.45], [-0.38, -0.45], [0.38, -0.45]]) cylinder(s, K, x, 0, zc + dz, 0.2, 0.7, 8);
      } else {
        // Nara deer.
        const b = 0xa86b3c;
        s.add(ICO1, b, 0, 1.25, zc, 0, 0, 0, 0.42, 0.42, 0.85);
        for (let i = 0; i < 5; i++) ball(s, 0xf5e6c8, Math.sin(i * 2) * 0.25, 1.5, zc - 0.5 + i * 0.25, 0.06);
        rod(s, b, 0, 1.4, zc + 0.6, 0, 1.85, zc + 0.85, 0.13);
        s.add(ICO1, b, 0, 1.95, zc + 1.0, 0, 0, 0, 0.18, 0.18, 0.3);
        for (const x of [-1, 1]) {
          rod(s, 0xe8dcc0, x * 0.08, 2.05, zc + 0.9, x * 0.35, 2.55, zc + 0.8, 0.03);
          rod(s, 0xe8dcc0, x * 0.25, 2.35, zc + 0.85, x * 0.2, 2.6, zc + 1.0, 0.025);
          s.add(ICO1, b, x * 0.2, 2.08, zc + 0.85, 0, 0, 0, 0.12, 0.06, 0.04);
        }
        ball(s, 0x1a1a1a, 0, 1.95, zc + 1.3, 0.05);
        for (const [x, dz] of [[-0.22, 0.55], [0.22, 0.55], [-0.22, -0.55], [0.22, -0.55]]) cylinder(s, 0x7a4b2a, x, 0, zc + dz, 0.07, 1.0, 6);
      }
      return true;
    }

    case 'pendulum': {
      const rope = c === 'th' ? 0x6b4a2b : c === 'cn' ? 0x5a5a5a : 0x1d1d1d;
      s.box(rope, -0.35, -PENDULUM.arm / 2, 0, 0.08, PENDULUM.arm, 0.08);
      s.box(rope, 0.35, -PENDULUM.arm / 2, 0, 0.08, PENDULUM.arm, 0.08);
      if (armOnly) return true;
      const y = -PENDULUM.arm;
      if (c === 'th') {
        // The swing's heavy carved seat.
        s.box(0xb22222, 0, y, 0, 1.3, 0.5, 1.2);
        s.box(GOLD, 0, y + 0.3, 0, 1.4, 0.12, 1.3);
        s.box(GOLD, 0, y - 0.3, 0, 1.4, 0.12, 1.3);
        cone(s, GOLD, 0, y - 0.95, 0, 0.35, 0.6, 6, Math.PI);
      } else if (c === 'cn') {
        // Bronze temple bell.
        s.lathe(0x8a6d3b, [[0, 0.7], [0.32, 0.7], [0.45, 0.4], [0.55, -0.2], [0.68, -0.6], [0.7, -0.7], [0, -0.7]], 0, y, 0, 12);
        cylinder(s, 0x6e5530, 0, y - 0.1, 0, 0.6, 0.1, 12);
        cylinder(s, 0x6e5530, 0, y + 0.3, 0, 0.47, 0.08, 12);
      } else {
        // Big red paper lantern.
        s.add(ICO1, 0xd62828, 0, y, 0, 0, 0, 0, 0.68, 0.72, 0.68);
        for (const dy of [-0.5, -0.25, 0, 0.25, 0.5]) cylinder(s, 0xb81e1e, 0, y + dy - 0.02, 0, Math.sqrt(1 - (dy / 0.72) ** 2) * 0.69, 0.04, 12);
        cylinder(s, 0x1d1d1d, 0, y + 0.62, 0, 0.35, 0.14, 12);
        cylinder(s, 0x1d1d1d, 0, y - 0.76, 0, 0.35, 0.14, 12);
        s.box(0x1d1d1d, 0, y, 0.69, 0.25, 0.6, 0.02);
      }
      return true;
    }

    case 'spikes': {
      // Chunky stakes on a tight grid with red-banded bases: a bed, not a few sticks.
      for (const [x, dz] of spikeSpots(o.length)) {
        if (c === 'jp') {
          // Iron spikes.
          s.add(new THREE.ConeGeometry(0.27, 0.85, 4), 0x5b6170, x, 0.425, dz, 0, Math.PI / 4, 0);
        } else {
          // Sharpened bamboo stakes.
          s.add(new THREE.ConeGeometry(0.24, 0.85, 6), c === 'cn' ? 0x9fd356 : 0xe3cf8a, x, 0.425, dz, 0, 0, 0);
        }
        cylinder(s, 0xd62828, x, 0, dz, 0.27, 0.22, 8);
      }
      return true;
    }

    case 'drop':
      if (c === 'th') {
        ball(s, 0x5c8a2e, 0, 0.55, 0, 0.55, 1.05);
        cylinder(s, 0x4a3324, 0, 1.08, 0, 0.08, 0.12, 6);
      } else if (c === 'cn') {
        ball(s, 0xff3b2f, 0, 0.58, 0, 0.58, 0.85);
        cylinder(s, GOLD, 0, 0.98, 0, 0.3, 0.14, 12);
        cylinder(s, GOLD, 0, 0.04, 0, 0.3, 0.14, 12);
      } else {
        blob(s, 0xd62828, 0, 0.45, 0, 0.55, 0.48, 0.5, true);
        ball(s, 0xd62828, 0, 0.88, 0, 0.36);
        s.add(new THREE.CircleGeometry(0.24, 12), 0xf8f4ea, 0, 0.88, 0.36);
      }
      return true;

    case 'sweeper': {
      // Hazard bands, dark against light, so the bar reads on any ground.
      const [dark, light] = c === 'th' ? [0xd62828, 0xffffff] : c === 'cn' ? [0xb22222, GOLD] : [0x1d1d1d, 0xffd166];
      const bands = 18;
      const band = (SWEEPER.half * 2) / bands;
      for (let i = 0; i < bands; i++) across(s, i % 2 ? light : dark, -SWEEPER.half + band * (i + 0.5), 0, 0, SWEEPER.pole, band, CYL8);
      // Capped ends.
      for (const e of [-1, 1]) across(s, dark, e * (SWEEPER.half + 0.06), 0, 0, SWEEPER.pole + 0.03, 0.12, CYL8);
      return true;
    }

    default:
      return false;
  }
}
