// Low-poly shape builder: many primitives merged into one vertex-coloured
// geometry, so a whole obstacle or a 25 m stretch of scenery is one draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const flatMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

// Wind: every vertex carries (sway, flutter) weights, zero for anything solid.
// Leaves and fronds sway slowly, flags ripple fast, all in the vertex shader.
const wind = { value: 0 };
/** Advance the wind (seconds). */
export function setWind(t: number) {
  wind.value = t;
}
// The shared hook (bend.ts) is installed later, so look it up when compiling.
flatMaterial.onBeforeCompile = function (shader, renderer) {
  THREE.Material.prototype.onBeforeCompile.call(this, shader, renderer);
  shader.uniforms.windTime = wind;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
uniform float windTime;
attribute vec2 sway;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
if ( sway.x + sway.y > 0.0 ) {
  float ph = position.x * 0.21 + position.z * 0.17;
  transformed.x += sway.x * ( sin( windTime * 1.6 + ph ) * 0.16 + sin( windTime * 3.7 + ph * 2.3 ) * 0.04 );
  transformed.z += sway.x * sin( windTime * 1.2 + ph * 1.4 ) * 0.1;
  transformed.x += sway.y * sin( windTime * 9.0 + position.z * 4.5 + position.y * 1.5 ) * 0.11;
  transformed.y += sway.y * sin( windTime * 7.0 + position.z * 3.0 ) * 0.03;
}`);
};
flatMaterial.customProgramCacheKey = () => 'flat-wind';
/** Unlit: neon, lanterns, lit windows. */
export const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
export const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });

const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

export type Weight = (x: number, y: number, z: number) => number;

export class Shapes {
  private parts: THREE.BufferGeometry[] = [];
  private swayW: Weight | null = null;
  private flutterW: Weight | null = null;

  /** Shapes added inside `build` sway in the wind, weighted per vertex (0 = still, 1 = full). */
  swaying(w: Weight, build: () => void): this {
    this.swayW = w;
    build();
    this.swayW = null;
    return this;
  }

  /** Shapes added inside `build` ripple like cloth (flags), weighted per vertex. */
  fluttering(w: Weight, build: () => void): this {
    this.flutterW = w;
    build();
    this.flutterW = null;
    return this;
  }

  add(geom: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): this {
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    g.deleteAttribute('uv');
    tmpColor.setHex(color);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    tmpQuat.setFromEuler(tmpEuler.set(rx, ry, rz));
    tmpMatrix.compose(new THREE.Vector3(x, y, z), tmpQuat, new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(tmpMatrix);
    const sway = new Float32Array(n * 2);
    if (this.swayW || this.flutterW) {
      const p = g.attributes.position;
      for (let i = 0; i < n; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (this.swayW) sway[i * 2] = Math.max(0, Math.min(1, this.swayW(x, y, z)));
        if (this.flutterW) sway[i * 2 + 1] = Math.max(0, Math.min(1, this.flutterW(x, y, z)));
      }
    }
    g.setAttribute('sway', new THREE.BufferAttribute(sway, 2));
    this.parts.push(g);
    return this;
  }

  /** Axis-aligned box given by its centre and size. */
  box(color: number, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0): this {
    return this.add(BOX, color, x, y, z, 0, ry, 0, w, h, d);
  }

  /**
   * Box running along the track, cut every ~2.5 m so it follows the bends
   * (the track is curved in the vertex shader, between vertices it is straight).
   */
  long(color: number, x: number, y: number, z: number, w: number, h: number, d: number): this {
    const n = Math.min(24, Math.max(1, Math.ceil(d / 2.5)));
    return this.add(longBox(n), color, x, y, z, 0, 0, 0, w, h, d);
  }

  /** Thin flag cloth (cut along its length so it can ripple), centred at (x, y, z). */
  cloth(color: number, x: number, y: number, z: number, w: number, h: number, d: number): this {
    return this.add(CLOTH, color, x, y, z, 0, 0, 0, w, h, d);
  }

  /** Gable roof: triangular prism, base on y, ridge along z (before ry). */
  prism(color: number, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0): this {
    return this.add(PRISM, color, x, y, z, 0, ry, 0, w, h, d);
  }

  /** Solid of revolution from [radius, height] pairs, standing on y. */
  lathe(color: number, profile: [number, number][], x: number, y: number, z: number, sides = 10, sx = 1, sy = 1): this {
    return this.add(latheGeo(profile, sides), color, x, y, z, 0, 0, 0, sx, sy, sx);
  }

  /** East-Asian hip roof: square cone with eaves that sweep up at the corners. */
  eaves(color: number, x: number, y: number, z: number, w: number, d: number, h: number, ry = 0): this {
    return this.add(EAVES, color, x, y, z, 0, ry, 0, w, h, d);
  }

  /** Upright cylinder standing on y. */
  cyl(color: number, x: number, y: number, z: number, r: number, h: number, sides = 8, rTop = r): this {
    return this.add(new THREE.CylinderGeometry(rTop, r, h, sides), color, x, y + h / 2, z);
  }

  cone(color: number, x: number, y: number, z: number, r: number, h: number, sides = 8): this {
    return this.add(new THREE.ConeGeometry(r, h, sides), color, x, y + h / 2, z);
  }

  sphere(color: number, x: number, y: number, z: number, r: number, detail = 1, sy = 1): this {
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, x, y, z, 0, 0, 0, 1, sy, 1);
  }

  get empty() {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged.computeBoundingSphere();
    return merged;
  }

  mesh(): THREE.Mesh {
    const m = new THREE.Mesh(this.build(), flatMaterial);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CLOTH = new THREE.BoxGeometry(1, 1, 1, 1, 2, 8);

const longBoxes = new Map<number, THREE.BufferGeometry>();
function longBox(n: number) {
  let g = longBoxes.get(n);
  if (!g) longBoxes.set(n, (g = new THREE.BoxGeometry(1, 1, 1, 1, 1, n)));
  return g;
}

const PRISM = (() => {
  const g = new THREE.BufferGeometry();
  const v = [
    [-0.5, 0, 0.5], [0.5, 0, 0.5], [0, 1, 0.5],
    [-0.5, 0, -0.5], [0.5, 0, -0.5], [0, 1, -0.5],
  ];
  const tri = [0, 1, 2, 4, 3, 5, 0, 2, 5, 0, 5, 3, 1, 4, 5, 1, 5, 2, 0, 3, 4, 0, 4, 1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri.flatMap((i) => v[i]), 3));
  g.computeVertexNormals();
  return g;
})();

const lathes = new Map<string, THREE.BufferGeometry>();
function latheGeo(profile: [number, number][], sides: number) {
  const key = `${sides}:${profile.join(';')}`;
  let g = lathes.get(key);
  if (!g) lathes.set(key, (g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), sides)));
  return g;
}

// Unit roof (1 × 1 × 1, eaves at y = 0, peak at y = 1): a 4-sided cone whose
// surface sags and whose corners lift, like Chinese and Japanese temple roofs.
const EAVES = (() => {
  const g = new THREE.CylinderGeometry(0.02, Math.SQRT1_2, 1, 4, 5, false).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.max(Math.abs(x), Math.abs(z)) * 2; // 0 at the ridge, 1 at the eaves
    const corner = Math.min(Math.abs(x), Math.abs(z)) * 2; // 1 at the corners
    p.setY(i, y - Math.sin(r * Math.PI) * 0.12 + Math.pow(r, 3) * corner * 0.3);
  }
  g.computeVertexNormals();
  return g;
})();
