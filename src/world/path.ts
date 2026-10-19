// The race is simulated on a straight strip (x across, y up, d along) and drawn
// bent along this centre line: sweeping curves, S-bends and rolling hills.
// render/bend.ts does the bending in the vertex shader, so gameplay code and
// collision never see the curves. Built from the seed: same track everywhere.
import { BIOME_LENGTH, RACE_LENGTH } from '../config.ts';
import { Rng } from '../core/rng.ts';
import { BIOMES, type BiomeId } from './biomes.ts';

export const PATH_PRE = 256; // metres of table before d = 0
export const PATH_SAMPLES = 3584; // 1 m apart: d from -256 to 3328
export const PATH_TEX_W = 512;

const STRAIGHT_START = 120; // start boxes, merge and the first rows
const STRAIGHT_FINISH = 110; // a clear view of the finish arch
const MIN_RADIUS = 78; // keeps roadside scenery from folding on the inside of a bend
const MAX_HEADING = (68 * Math.PI) / 180;

export interface PathFrame { x: number; y: number; z: number; yaw: number; curve: number }

export class TrackPath {
  /** (x, y, z, yaw) per metre, the layout of the shader's lookup texture. */
  readonly data = new Float32Array(PATH_SAMPLES * 4);
  private curvature = new Float32Array(PATH_SAMPLES);

  constructor(seed: number, biomes: BiomeId[], straight = false) {
    const rng = new Rng(seed ^ 0x2c1b3c6d);
    if (!straight) this.layCurves(rng);
    const hills = straight ? null : this.hillProfile(rng, biomes);
    let x = 0, z = 0, yaw = 0;
    // Integrate forward from d = 0, then backward for the run-up.
    const write = (i: number) => {
      const d = i - PATH_PRE;
      const o = i * 4;
      this.data[o] = x;
      this.data[o + 1] = hills ? hills(d) : 0;
      this.data[o + 2] = z;
      this.data[o + 3] = yaw;
    };
    const i0 = PATH_PRE;
    write(i0);
    for (let i = i0 + 1; i < PATH_SAMPLES; i++) {
      const k = (this.curvature[i - 1] + this.curvature[i]) / 2;
      const mid = yaw + k / 2;
      x -= Math.sin(mid);
      z -= Math.cos(mid);
      yaw += k;
      write(i);
    }
    x = 0; z = 0; yaw = 0;
    for (let i = i0 - 1; i >= 0; i--) {
      x += Math.sin(yaw);
      z += Math.cos(yaw);
      write(i);
    }
  }

  /** Curvature (1/m) per metre: eased turns between straights. */
  private layCurves(rng: Rng) {
    const end = RACE_LENGTH - STRAIGHT_FINISH;
    let d = STRAIGHT_START;
    let heading = 0;
    let lastSign = rng.chance(0.5) ? 1 : -1;
    while (d < end - 60) {
      // Turn back toward the main direction when drifting too far.
      let sign = rng.chance(0.62) ? -lastSign : lastSign;
      if (Math.abs(heading) > 0.5) sign = -Math.sign(heading);
      let angle = rng.range(0.45, 1.15);
      if (Math.abs(heading + sign * angle) > MAX_HEADING) angle = Math.max(0.25, MAX_HEADING - Math.abs(heading));
      // κ(s) = κmax·sin(πs/L): total turn = 2·κmax·L/π, so L follows from the radius limit.
      const minLen = (angle * Math.PI * MIN_RADIUS) / 2;
      let len = Math.max(minLen, rng.range(70, 170));
      if (d + len > end) len = end - d;
      if (len < minLen) break;
      const kmax = (angle * Math.PI) / (2 * len);
      for (let s = 0; s < len; s++) {
        const i = Math.floor(d + s) + PATH_PRE;
        if (i >= 0 && i < PATH_SAMPLES) this.curvature[i] = sign * kmax * Math.sin((Math.PI * s) / len);
      }
      heading += sign * angle;
      lastSign = sign;
      d += len;
      // S-bends: sometimes flick straight into the next turn.
      d += rng.chance(0.3) ? rng.range(0, 10) : rng.range(25, 90);
    }
  }

  /** Rolling hills, flattened at the start, the finish and over water. */
  private hillProfile(rng: Rng, biomes: BiomeId[]) {
    const waves = [0, 1, 2].map(() => ({ len: rng.range(140, 320), phase: rng.range(0, Math.PI * 2), w: rng.range(0.6, 1) }));
    const ampAt = (d: number) => {
      const i = Math.min(biomes.length - 1, Math.max(0, Math.floor(d / BIOME_LENGTH)));
      return BIOMES[biomes[i]].hills ?? 1.2;
    };
    // Smooth the per-zone amplitude so hills fade in and out across gates.
    const amp = (d: number) => {
      let s = 0, n = 0;
      for (let o = -60; o <= 60; o += 10) { s += ampAt(d + o); n++; }
      return s / n;
    };
    const ease = (d: number) => {
      const a = Math.min(1, Math.max(0, (d - 60) / 120));
      const b = Math.min(1, Math.max(0, (RACE_LENGTH - 40 - d) / 120));
      const s = (t: number) => t * t * (3 - 2 * t);
      return s(a) * s(b);
    };
    return (d: number) => {
      let y = 0;
      for (const w of waves) y += Math.sin((d / w.len) * Math.PI * 2 + w.phase) * w.w;
      return (y / 1.6) * amp(d) * ease(d);
    };
  }

  /** Centre-line frame at distance d (extrapolated straight past the table). */
  frame(d: number, out: PathFrame = { x: 0, y: 0, z: 0, yaw: 0, curve: 0 }): PathFrame {
    const f = d + PATH_PRE;
    const c = Math.min(PATH_SAMPLES - 1.001, Math.max(0, f));
    const i = Math.floor(c);
    const t = c - i;
    const a = i * 4, b = a + 4;
    const D = this.data;
    out.x = D[a] + (D[b] - D[a]) * t;
    out.y = D[a + 1] + (D[b + 1] - D[a + 1]) * t;
    out.z = D[a + 2] + (D[b + 2] - D[a + 2]) * t;
    out.yaw = D[a + 3] + (D[b + 3] - D[a + 3]) * t;
    const extra = f - c;
    out.x -= Math.sin(out.yaw) * extra;
    out.z -= Math.cos(out.yaw) * extra;
    out.curve = this.curvature[i] ?? 0;
    return out;
  }

  /** Track-space point → world point (same maths as the shader). */
  toWorld<T extends { x: number; y: number; z: number }>(x: number, y: number, d: number, out: T): T {
    const f = this.frame(d, _f);
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    out.x = f.x + x * c;
    out.y = f.y + y;
    out.z = f.z - x * s;
    return out;
  }
}

const _f: PathFrame = { x: 0, y: 0, z: 0, yaw: 0, curve: 0 };
