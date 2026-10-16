// Ground, roadside scenery, biome gates and the finish line, streamed in
// 25 m chunks around the player. Each chunk is a single merged mesh.
import * as THREE from 'three';
import { BIOME_LENGTH, LANE_WIDTH, RACE_LENGTH, VIEW_AHEAD, VIEW_BEHIND } from '../config.ts';
import { Rng } from '../core/rng.ts';
import { BIOMES, biomeAt, type BiomeId, type Palette } from '../world/biomes.ts';
import { DecorInstancer, decorList, type Placement, type Template } from './props.ts';
import { Shapes } from './shapes.ts';

const CHUNK = 25;
const SMALL_DECOR_RANGE = 90;
const TRACK_HALF = LANE_WIDTH * 1.5 + 0.3;

function ground(s: Shapes, p: Palette, b: BiomeId, z0: number) {
  const zc = z0 - CHUNK / 2;
  s.box(p.ground, 0, -0.1, zc, TRACK_HALF * 2, 0.2, CHUNK);
  for (const lx of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) s.box(p.groundAlt, lx, 0.005, zc, 0.12, 0.02, CHUNK);
  // Paving stripes give a sense of speed.
  for (let i = 0; i < CHUNK; i += 5) s.box(p.groundAlt, 0, 0.004, z0 - i - 1.25, TRACK_HALF * 2 - 0.4, 0.01, 0.35);
  const curb = b === 'harbor' ? p.a : b === 'candy' ? 0xffffff : p.d;
  s.box(curb, -TRACK_HALF - 0.2, 0.1, zc, 0.4, 0.4, CHUNK).box(curb, TRACK_HALF + 0.2, 0.1, zc, 0.4, 0.4, CHUNK);
  const sideY = b === 'harbor' ? -0.6 : -0.12;
  s.box(p.side, -TRACK_HALF - 30.4, sideY, zc, 60, 0.2, CHUNK).box(p.side, TRACK_HALF + 30.4, sideY, zc, 60, 0.2, CHUNK);
  if (b === 'harbor') {
    // Track is a pier: posts under it, water around.
    for (const x of [-TRACK_HALF, TRACK_HALF]) for (let i = 2; i < CHUNK; i += 6) s.cyl(p.a, x, -1.2, z0 - i, 0.22, 1.3, 6);
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
    if (b === 'snow' || b === 'forest') s.cone(b === 'snow' ? 0xf1f5f9 : 0x52796f, x, -0.2, z, rng.range(8, 14), rng.range(10, 20), 6);
    else if (b === 'harbor') s.box(p.a, x, 2, z, 6, 4, 14).cone(p.d, x, 4, z, 4, 6, 4);
    else s.sphere(b === 'candy' ? rng.pick([p.a, p.b, 0xffd6ff]) : 0x90be6d, x, -2, z, rng.range(7, 12), 1, 0.6);
  }
}

function arch(s: Shapes, color: number, accent: number, z: number) {
  const x = TRACK_HALF + 0.6;
  s.box(color, -x, 3, z, 0.6, 6, 0.6).box(color, x, 3, z, 0.6, 6, 0.6);
  s.box(color, 0, 6.2, z, 2 * x + 1, 0.8, 0.7);
  s.sphere(accent, -x, 6.5, z, 0.5).sphere(accent, x, 6.5, z, 0.5);
}

function bannerTexture(text: string, bg: string, fg: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg;
  g.font = 'bold 56px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function banner(text: string, z: number, bg = '#222', fg = '#fff') {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK_HALF * 2 + 1, 0.75),
    new THREE.MeshBasicMaterial({ map: bannerTexture(text, bg, fg) }),
  );
  m.position.set(0, 6.2, z + 0.36);
  return m;
}

export class Environment {
  readonly root = new THREE.Group();
  private chunks = new Map<number, { mesh: THREE.Mesh; placements: Placement[]; small: Placement[] }>();
  private instancer = new DecorInstancer();
  private landmarks: THREE.Mesh[] = [];
  private seed: number;
  private biomes: BiomeId[];

  constructor(seed: number, biomes: BiomeId[]) {
    this.seed = seed;
    this.biomes = biomes;
    this.root.add(this.instancer.root);
    this.addLandmarks();
  }

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

  private addLandmarks() {
    const start = new Shapes();
    arch(start, 0x264653, 0xe9c46a, 2);
    this.add(start.mesh(), banner('START', 2, '#264653'));

    for (let d = BIOME_LENGTH; d < RACE_LENGTH; d += BIOME_LENGTH) {
      const next = BIOMES[biomeAt(this.biomes, d + 1)];
      const s = new Shapes();
      arch(s, next.a, next.c, -d);
      this.add(s.mesh(), banner(next.name, -d, '#' + next.d.toString(16).padStart(6, '0')));
    }

    const fin = new Shapes();
    arch(fin, 0xffffff, 0xe63946, -RACE_LENGTH);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) {
      fin.box((i + j) % 2 ? 0x111111 : 0xffffff, -TRACK_HALF + (i + 0.5) * (TRACK_HALF * 2) / 8, 0.012, -RACE_LENGTH - 0.4 + j * 0.8, (TRACK_HALF * 2) / 8, 0.02, 0.8);
    }
    this.add(fin.mesh(), banner('FINISH', -RACE_LENGTH, '#e63946'));
  }

  private build(i: number) {
    const d0 = i * CHUNK;
    const b = biomeAt(this.biomes, d0 + 1);
    const p = BIOMES[b];
    const rng = new Rng(this.seed * 7919 + i);
    const s = new Shapes();
    const placements: Placement[] = [];
    const smallPlacements: Placement[] = [];
    const large = decorList('large', b);
    const small = decorList('small', b);
    ground(s, p, b, -d0);
    for (const side of [-1, 1]) {
      for (let z = rng.range(0, 4); z < CHUNK; z += rng.range(5, 9)) {
        const near = side * rng.range(TRACK_HALF + 1.8, TRACK_HALF + 6);
        if (large.length) this.place(placements, rng.pick(large), near, -d0 - z, rng.range(3.5, 6.5), rng);
        else decor(s, p, b, near, -d0 - z, rng);
        if (rng.chance(large.length ? 0.3 : 0.5)) {
          const back = side * rng.range(TRACK_HALF + 9, TRACK_HALF + 17);
          if (large.length) this.place(placements, rng.pick(large), back, -d0 - z - 2, rng.range(4.5, 8), rng);
          else decor(s, p, b, back, -d0 - z - 2, rng);
        }
        if (small.length && rng.chance(0.6)) {
          this.place(smallPlacements, rng.pick(small), side * rng.range(TRACK_HALF + 0.9, TRACK_HALF + 2.2), -d0 - z - 3, rng.range(0.6, 1.3), rng);
        }
      }
    }
    far(s, p, b, -d0 - CHUNK / 2, rng);
    const mesh = s.mesh();
    mesh.castShadow = false;
    return { mesh, placements, small: smallPlacements };
  }

  update(playerD: number) {
    const first = Math.max(-2, Math.floor((playerD - VIEW_BEHIND) / CHUNK));
    const last = Math.floor((playerD + VIEW_AHEAD) / CHUNK);
    let changed = false;
    for (const [i, c] of this.chunks) {
      if (i < first || i > last) {
        this.root.remove(c.mesh);
        c.mesh.geometry.dispose();
        this.chunks.delete(i);
        changed = true;
      }
    }
    for (let i = first; i <= last; i++) {
      if (!this.chunks.has(i)) {
        const c = this.build(i);
        this.chunks.set(i, c);
        this.root.add(c.mesh);
        changed = true;
      }
    }
    // Small props vanish into the distance: only draw them in nearby chunks.
    if (changed) {
      this.instancer.rebuild([...this.chunks].flatMap(([i, c]) =>
        i * CHUNK < playerD + SMALL_DECOR_RANGE ? [...c.placements, ...c.small] : c.placements));
    }
  }

  dispose() {
    for (const c of this.chunks.values()) c.mesh.geometry.dispose();
    this.chunks.clear();
    this.instancer.dispose();
    // Arches share flatMaterial; banners own their material and canvas texture.
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
