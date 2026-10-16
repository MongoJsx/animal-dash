// Low-poly shape builder: many primitives merged into one vertex-coloured
// geometry, so a whole obstacle or a 25 m stretch of scenery is one draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const flatMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
export const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });

const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

export class Shapes {
  private parts: THREE.BufferGeometry[] = [];

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
    this.parts.push(g);
    return this;
  }

  /** Axis-aligned box given by its centre and size. */
  box(color: number, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0): this {
    return this.add(BOX, color, x, y, z, 0, ry, 0, w, h, d);
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
