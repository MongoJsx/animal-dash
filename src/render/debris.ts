// Bursts of chunky debris when something is smashed, and speed streaks
// behind a dashing runner. One instanced mesh, laid out in track space.
import * as THREE from 'three';

const N = 220;

interface Bit { x: number; y: number; d: number; vx: number; vy: number; vd: number; life: number; max: number; size: number; spin: number; streak: boolean }

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class Debris {
  readonly mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ flatShading: true }), N);
  private bits: (Bit | null)[] = new Array(N).fill(null);
  private next = 0;

  constructor() {
    this.mesh.frustumCulled = false;
    this.mesh.count = N;
    for (let i = 0; i < N; i++) {
      this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, _c.setHex(0xffffff));
    }
  }

  private spawn(b: Bit, color: number) {
    const i = this.next;
    this.next = (this.next + 1) % N;
    this.bits[i] = b;
    this.mesh.setColorAt(i, _c.setHex(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Smash something at (x, y, d): pieces fly up and away from the runner. */
  burst(x: number, y: number, d: number, colors: number[], count = 14, spread = 1, forward = 6) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      this.spawn({
        x: x + (Math.random() - 0.5) * spread, y: y + Math.random() * spread, d: d + (Math.random() - 0.5) * spread,
        vx: Math.cos(a) * sp, vy: 3 + Math.random() * 6, vd: forward + Math.sin(a) * sp,
        life: 0, max: 0.6 + Math.random() * 0.5, size: 0.12 + Math.random() * 0.22, spin: (Math.random() - 0.5) * 20, streak: false,
      }, colors[k % colors.length]);
    }
  }

  /** Wind streak left behind a dashing runner. */
  streak(x: number, y: number, d: number, color = 0xffffff) {
    this.spawn({ x, y, d, vx: 0, vy: 0, vd: 0, life: 0, max: 0.25, size: 0.05, spin: 0, streak: true }, color);
  }

  update(dt: number) {
    for (let i = 0; i < N; i++) {
      const b = this.bits[i];
      if (!b) continue;
      b.life += dt;
      if (b.life >= b.max) {
        this.bits[i] = null;
        this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
        continue;
      }
      const k = 1 - b.life / b.max;
      if (b.streak) {
        _s.set(b.size * k, b.size * k, 2.2);
        _q.identity();
      } else {
        b.vy -= 22 * dt;
        b.x += b.vx * dt;
        b.y = Math.max(0.05, b.y + b.vy * dt);
        b.d += b.vd * dt;
        _q.setFromEuler(_e.set(b.life * b.spin, b.life * b.spin * 0.7, 0));
        _s.setScalar(b.size * Math.min(1, k * 2));
      }
      _p.set(b.x, b.y, -b.d);
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
