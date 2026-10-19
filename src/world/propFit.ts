// Which Sketchfab prop each obstacle uses and how big it is drawn, computed
// from manifest data only (no Three.js). The renderer scales models with
// fitScale() and the collision code shrinks hitboxes to visualExtent(), so
// both always agree — and the simulation stays deterministic on any client
// that has the same manifest.
import { LANE_WIDTH } from '../config.ts';
import type { BiomeId } from './biomes.ts';
import type { Kind, Obstacle } from './obstacles.ts';

export type PropSlot =
  | 'lowbar' | 'highbar' | 'wall' | 'hay' | 'oncoming' | 'rolling' | 'shifter'
  | 'pendulumHead' | 'spikes' | 'drop' | 'sweeper' | 'bounce';

export interface PropEntry {
  url: string;
  tint?: 'candy';
  size: [number, number, number]; // model bounds in metres: x (across), y (up), z (along track)
}
type ByBiome = Partial<Record<BiomeId, PropEntry[]>>;
export interface PropManifest {
  obstacles: Partial<Record<PropSlot, ByBiome>>;
  decor: { large: ByBiome; small: ByBiome };
}

let manifest: PropManifest = { obstacles: {}, decor: { large: {}, small: {} } };

export function setPropManifest(m: Partial<PropManifest> | null | undefined) {
  manifest = { obstacles: m?.obstacles ?? {}, decor: { large: m?.decor?.large ?? {}, small: m?.decor?.small ?? {} } };
}

export const propManifest = () => manifest;

export const KIND_SLOT: Partial<Record<Kind, PropSlot>> = {
  lowbar: 'lowbar', wall: 'wall', hay: 'hay', oncoming: 'oncoming',
  rolling: 'rolling', shifter: 'shifter', pendulum: 'pendulumHead', spikes: 'spikes', drop: 'drop',
  sweeper: 'sweeper', bounce: 'bounce',
};

/** The prop an obstacle uses (stable per obstacle id), or undefined for greybox. */
export function obstacleEntry(o: Obstacle): PropEntry | undefined {
  const slot = KIND_SLOT[o.kind];
  const list = slot ? manifest.obstacles[slot]?.[o.biome] : undefined;
  return list?.length ? list[Math.abs(o.id) % list.length] : undefined;
}

export interface FitOpts {
  centered?: boolean; // centred on z instead of starting at the near edge
  stretchDepth?: boolean; // fill the full depth (≤ 35% stretch, or unlimited with stretchDepthFree)
  stretchDepthFree?: boolean;
  stretchX?: boolean; // stretch freely along x (a log used as a long bar)
  depthSlack?: number; // how much deeper than the target the model may be
}

/**
 * Per-axis scale that fits a model of `size` into a w×h×d target: uniform to
 * fit, then up to 35% extra stretch per axis to fill the silhouette.
 */
export function fitScale(size: readonly number[], w: number, h: number, d: number, opts: FitOpts = {}): [number, number, number] {
  const [sx, sy, sz] = size.map((v) => Math.max(v, 1e-4));
  const slack = opts.stretchDepth || opts.stretchDepthFree ? 1 : opts.depthSlack ?? 2;
  const s = Math.min(opts.stretchX ? Infinity : w / sx, h / sy, (d * slack) / sz);
  const k = (target: number, v: number) => Math.min(1.35, Math.max(1, target / (v * s)));
  return [
    opts.stretchX ? w / sx : s * k(w, sx),
    s * k(h, sy),
    opts.stretchDepthFree ? d / sz : s * (opts.stretchDepth ? k(d, sz) : 1),
  ];
}

const W = LANE_WIDTH - 0.3;

/** Target box (w, h, d) and options each kind's model is fitted into. */
export function fitTarget(o: Obstacle): { w: number; h: number; d: number; opts: FitOpts } | null {
  switch (o.kind) {
    case 'lowbar': return { w: W, h: 0.95, d: o.length, opts: {} };
    case 'hay': return { w: 1.8, h: 1.15, d: o.length, opts: {} };
    case 'wall': return { w: W, h: 2.9, d: o.length, opts: { depthSlack: 1.5 } };
    case 'oncoming': return { w: W - 0.3, h: 1.9, d: o.length, opts: { stretchDepth: true } };
    case 'rolling': return { w: 1.2, h: 1.1, d: 1.1, opts: { centered: true } };
    case 'shifter': return { w: 1.5, h: 2.0, d: 1.4, opts: { centered: true } };
    case 'pendulum': return { w: 1.4, h: 1.4, d: 1.4, opts: { centered: true } };
    case 'spikes': return { w: W, h: 0.85, d: o.length, opts: { stretchDepth: true } };
    case 'drop': return { w: 1.2, h: 1.15, d: 1.2, opts: { centered: true } };
    case 'sweeper': return { w: 7.4, h: 0.45, d: 0.45, opts: { centered: true, stretchX: true } };
    case 'bounce': return { w: 1.6, h: 0.7, d: 1.6, opts: { centered: true } };
    default: return null;
  }
}

/** Drawn size (w, h, d) of an obstacle's prop, or null when it uses the greybox. */
export function visualExtent(o: Obstacle): { w: number; h: number; d: number } | null {
  const e = obstacleEntry(o);
  const t = e && fitTarget(o);
  if (!e || !t) return null;
  const [kx, ky, kz] = fitScale(e.size, t.w, t.h, t.d, t.opts);
  return { w: e.size[0] * kx, h: e.size[1] * ky, d: e.size[2] * kz };
}
