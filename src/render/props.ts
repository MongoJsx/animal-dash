// Sketchfab prop models (built by tools/build-props.mjs). Obstacles get a
// model fitted into their collision volume so what you see is what you hit;
// biomes without a picked model keep the procedural greybox.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { assetUrl } from '../core/asset.ts';
import type { BiomeId } from '../world/biomes.ts';
import type { Obstacle } from '../world/obstacles.ts';
import {
  KIND_SLOT, fitScale, obstacleEntry, propManifest, setPropManifest, type FitOpts, type PropEntry,
} from '../world/propFit.ts';

export interface Template {
  scene: THREE.Object3D; // centred on x/z, feet on y=0
  size: readonly [number, number, number]; // from the manifest, shared with collision
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const templates = new Map<string, Template>();
const tinted = new Map<string, Template>();

/** Manifest groups the game still uses (old slots, e.g. train cars, are skipped). */
const usedObstacleGroups = (m: ReturnType<typeof propManifest>) => {
  const slots = new Set(Object.values(KIND_SLOT));
  return Object.entries(m.obstacles).filter(([slot]) => slots.has(slot as never)).map(([, g]) => g);
};

const PASTELS = [0xff8fab, 0xffc8dd, 0xa0e7e5, 0xfff1a8, 0xb8f2b0, 0xcdb4db, 0xffd6a5];

/** Average brightness of a texture (sampled small), 0..1. */
function luminance(tex: THREE.Texture): number {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  if (!img?.width) return 1;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return sum / (d.length / 4) / 255;
}

/** Sketchfab textures are often far darker than our flat cartoon palette: lift them. */
function brighten(scene: THREE.Object3D) {
  const done = new Set<THREE.Material>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
      if (done.has(m)) continue;
      done.add(m);
      if (m.map) {
        const lum = luminance(m.map);
        if (lum < 0.33) m.color.multiplyScalar(Math.min(2.2, 0.42 / Math.max(lum, 0.05)));
      }
      // Glossy metal looks black without an environment map.
      if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.3);
    }
  });
}

/** Pastel copy of a template for candy land (materials cloned, geometry shared). */
function candyTint(t: Template, key: string): Template {
  let out = tinted.get(key);
  if (!out) {
    const scene = t.scene.clone();
    let i = 0;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
        const c = (m as THREE.MeshStandardMaterial).clone();
        const pastel = new THREE.Color(PASTELS[i++ % PASTELS.length]);
        if (c.map) c.color.copy(pastel.lerp(new THREE.Color(0xffffff), 0.3)).multiplyScalar(1.3);
        else c.color.lerp(pastel, 0.65);
        return c;
      });
      mesh.material = mats.length === 1 ? mats[0] : mats;
    });
    out = { scene, size: t.size };
    tinted.set(key, out);
  }
  return out;
}

function resolve(e: PropEntry): Template | undefined {
  const t = templates.get(e.url);
  if (!t) return undefined;
  return e.tint === 'candy' ? candyTint(t, `${e.url}|candy`) : t;
}

/** Load every prop once, before the first race. Missing manifest = greybox only. */
export async function loadProps(onProgress?: (done: number, total: number) => void) {
  try {
    const res = await fetch(assetUrl('/assets/props/manifest.json'));
    if (!res.ok) return;
    setPropManifest(await res.json());
  } catch {
    return;
  }
  const m = propManifest();
  const sizes = new Map<string, PropEntry['size']>();
  for (const group of [...usedObstacleGroups(m), m.decor.large, m.decor.small]) {
    for (const list of Object.values(group ?? {})) list?.forEach((e) => sizes.set(e.url, e.size));
  }
  const urls = [...sizes.keys()];
  let done = 0;
  await Promise.all(urls.map(async (url) => {
    try {
      const gltf = await loader.loadAsync(assetUrl(url));
      const scene = gltf.scene;
      brighten(scene);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      const box = new THREE.Box3().setFromObject(scene);
      const c = box.getCenter(new THREE.Vector3());
      scene.position.set(-c.x, -box.min.y, -c.z);
      const wrap = new THREE.Group();
      wrap.add(scene);
      templates.set(url, { scene: wrap, size: sizes.get(url)! });
    } catch (e) {
      console.warn('prop failed to load', url, e);
    }
    onProgress?.(++done, urls.length);
  }));
  // Forget models that failed to load, so collision falls back to the greybox
  // sizes that will actually be drawn.
  const loaded = (list?: PropEntry[]) => list?.filter((e) => templates.has(e.url));
  const keep = (g: Partial<Record<BiomeId, PropEntry[]>> | undefined) =>
    Object.fromEntries(Object.entries(g ?? {}).map(([b, list]) => [b, loaded(list)]));
  setPropManifest({
    obstacles: Object.fromEntries(Object.entries(m.obstacles).map(([slot, g]) => [slot, keep(g)])),
    decor: { large: keep(m.decor.large), small: keep(m.decor.small) },
  });
}

/** The model an obstacle is drawn with (same choice the collision code uses). */
export function obstacleProp(o: Obstacle): Template | undefined {
  const e = obstacleEntry(o);
  return e && resolve(e);
}

export function decorList(kind: 'large' | 'small', biome: BiomeId): Template[] {
  return (propManifest().decor[kind][biome] ?? []).map(resolve).filter((t): t is Template => !!t);
}

/**
 * Clone a template scaled to fill a w×h×d box (see fitScale in propFit.ts):
 * feet on y=0, centred on x, and on z either centred or starting at the
 * near edge and running to -d.
 */
export function fitted(t: Template, w: number, h: number, d: number, opts: FitOpts = {}) {
  const obj = t.scene.clone();
  obj.scale.set(...fitScale(t.size, w, h, d, opts));
  const holder = new THREE.Group();
  holder.add(obj);
  if (!opts.centered) obj.position.z = -d / 2;
  return holder;
}

/** Drawn height of a fitted template. */
export const fittedHeight = (t: Template, w: number, h: number, d: number, opts: FitOpts = {}) =>
  t.size[1] * fitScale(t.size, w, h, d, opts)[1];

// ── Roadside decor, instanced across all visible chunks ───────────────
interface Part { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; matrix: THREE.Matrix4 }
const partsCache = new Map<Template, Part[]>();

/**
 * Compile every prop shader (plain and instanced) up front, so the first
 * candy or harbor chunk mid-race doesn't stall a frame on shader compiles.
 */
export async function warmUpProps(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene) {
  const group = new THREE.Group();
  const all = new Set<Template>();
  const m = propManifest();
  for (const g of [...usedObstacleGroups(m), m.decor.large, m.decor.small]) {
    for (const list of Object.values(g ?? {})) list?.forEach((e) => { const t = resolve(e); if (t) all.add(t); });
  }
  for (const t of all) {
    group.add(t.scene.clone());
    for (const part of partsOf(t)) group.add(new THREE.InstancedMesh(part.geometry, part.material, 1));
  }
  group.position.set(0, -1000, 0);
  scene.add(group);
  try {
    await renderer.compileAsync(scene, camera);
  } finally {
    scene.remove(group);
    group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
  }
}

function partsOf(t: Template): Part[] {
  let parts = partsCache.get(t);
  if (!parts) {
    parts = [];
    t.scene.updateMatrixWorld(true);
    t.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // Instances can't be depth-sorted: draw see-through decor as cut-out
      // instead of blended (on copies, so obstacles using the model keep blending).
      const cutout = (mat: THREE.Material) => {
        if (!mat.transparent) return mat;
        const c = mat.clone();
        c.transparent = false;
        c.alphaTest = 0.5;
        c.depthWrite = true;
        return c;
      };
      const material = Array.isArray(m.material) ? m.material.map(cutout) : cutout(m.material);
      parts!.push({ geometry: m.geometry, material, matrix: m.matrixWorld.clone() });
    });
    partsCache.set(t, parts);
  }
  return parts;
}

export interface Placement { t: Template; matrix: THREE.Matrix4 }

/** One InstancedMesh per model part; rebuilt when the set of visible chunks changes. */
export class DecorInstancer {
  readonly root = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private tmp = new THREE.Matrix4();

  rebuild(placements: Placement[]) {
    const byPart = new Map<string, { part: Part; matrices: THREE.Matrix4[] }>();
    for (const p of placements) {
      partsOf(p.t).forEach((part, i) => {
        const key = `${p.t.scene.uuid}:${i}`;
        let e = byPart.get(key);
        if (!e) byPart.set(key, (e = { part, matrices: [] }));
        e.matrices.push(this.tmp.multiplyMatrices(p.matrix, part.matrix).clone());
      });
    }
    for (const [key, mesh] of this.meshes) {
      if (!byPart.has(key)) {
        this.root.remove(mesh);
        mesh.dispose();
        this.meshes.delete(key);
      }
    }
    for (const [key, { part, matrices }] of byPart) {
      let mesh = this.meshes.get(key);
      if (!mesh || mesh.instanceMatrix.count < matrices.length) {
        if (mesh) {
          this.root.remove(mesh);
          mesh.dispose();
        }
        mesh = new THREE.InstancedMesh(part.geometry, part.material, Math.max(16, Math.ceil(matrices.length * 1.5)));
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // instances spread along the whole view
        this.meshes.set(key, mesh);
        this.root.add(mesh);
      }
      matrices.forEach((m, i) => mesh!.setMatrixAt(i, m));
      mesh.count = matrices.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const mesh of this.meshes.values()) mesh.dispose();
    this.meshes.clear();
    this.root.clear();
  }
}
