// Ambient particles around the runner: sakura petals, snow, falling leaves,
// festival confetti and floating Thai lanterns (khom loi). One instanced mesh,
// laid out in track space so it follows the bends with everything else.
import * as THREE from 'three';
import type { Particles } from '../world/biomes.ts';

const N = 260;

interface Style {
  count: number;
  size: [number, number];
  colors: number[];
  fall: number; // m/s down (negative = rising)
  sway: number;
  spin: number;
  box: { x: number; y0: number; y1: number; ahead: number; behind: number };
  glow?: boolean;
}

const STYLES: Record<Particles, Style> = {
  petals: { count: 220, size: [0.12, 0.18], colors: [0xffc6d6, 0xffb7c9, 0xffe0ea, 0xff9fbc], fall: 0.9, sway: 1.2, spin: 3, box: { x: 12, y0: 0, y1: 9, ahead: 55, behind: 6 } },
  snow: { count: 260, size: [0.07, 0.12], colors: [0xffffff, 0xeef4ff], fall: 1.6, sway: 0.6, spin: 1, box: { x: 14, y0: 0, y1: 12, ahead: 60, behind: 6 } },
  leaves: { count: 120, size: [0.14, 0.2], colors: [0x7cb342, 0x9ccc65, 0xc0ca33, 0xffb74d], fall: 1.1, sway: 1.5, spin: 4, box: { x: 12, y0: 0, y1: 10, ahead: 50, behind: 6 } },
  confetti: { count: 160, size: [0.08, 0.13], colors: [0xff3b2f, 0xffc93c, 0xff7b54, 0xffe8a3], fall: 1.4, sway: 1.0, spin: 6, box: { x: 9, y0: 0, y1: 9, ahead: 45, behind: 6 } },
  lanterns: { count: 90, size: [0.45, 0.6], colors: [0xffb347, 0xffc966, 0xff9d3b], fall: -0.9, sway: 0.4, spin: 0, box: { x: 70, y0: 6, y1: 70, ahead: 230, behind: -20 }, glow: true },
  fireflies: { count: 80, size: [0.06, 0.09], colors: [0xfff6a8, 0xd9ff8a], fall: 0, sway: 0.6, spin: 0, box: { x: 14, y0: 0.3, y1: 4, ahead: 40, behind: 4 }, glow: true },
  mist: { count: 0, size: [1, 1], colors: [0xffffff], fall: 0, sway: 0, spin: 0, box: { x: 1, y0: 0, y1: 1, ahead: 1, behind: 1 } },
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class Atmosphere {
  readonly mesh: THREE.InstancedMesh;
  private kind: Particles | null = null;
  private x = new Float32Array(N);
  private y = new Float32Array(N);
  private d = new Float32Array(N);
  private size = new Float32Array(N);
  private seed = new Float32Array(N);
  private fade = 0;
  private t = 0;

  constructor() {
    const g = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false }), N);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** Switch style (fades the old one out first). */
  set(kind: Particles | null | undefined, playerD: number) {
    const k = kind ?? null;
    if (k === this.kind) return;
    this.kind = k;
    if (!k) { this.mesh.count = 0; return; }
    const st = STYLES[k];
    this.mesh.count = st.count;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
    this.fade = 0;
    for (let i = 0; i < st.count; i++) {
      this.spawn(i, st, playerD, true);
      this.mesh.setColorAt(i, _c.setHex(st.colors[i % st.colors.length]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private spawn(i: number, st: Style, playerD: number, anywhere: boolean) {
    const b = st.box;
    this.x[i] = (Math.random() * 2 - 1) * b.x;
    this.y[i] = anywhere || st.fall <= 0 ? b.y0 + Math.random() * (b.y1 - b.y0) : b.y1;
    if (st.fall < 0 && !anywhere) this.y[i] = b.y0;
    this.d[i] = playerD - b.behind + Math.random() * (b.ahead + b.behind);
    this.size[i] = st.size[0] + Math.random() * (st.size[1] - st.size[0]);
    this.seed[i] = Math.random() * 100;
  }

  update(dt: number, playerD: number) {
    const k = this.kind;
    if (!k) return;
    const st = STYLES[k];
    this.t += dt;
    this.fade = Math.min(1, this.fade + dt * 0.8);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = this.fade * (st.glow ? 0.95 : 0.9);
    for (let i = 0; i < st.count; i++) {
      const s = this.seed[i];
      this.y[i] -= st.fall * dt * (0.7 + (s % 1) * 0.6);
      this.x[i] += Math.sin(this.t * 0.9 + s) * st.sway * dt;
      if (this.y[i] < st.box.y0 - 0.2 || this.y[i] > st.box.y1 + 0.5 || this.d[i] < playerD - st.box.behind - 2 || this.d[i] > playerD + st.box.ahead + 30) {
        this.spawn(i, st, playerD, false);
        this.d[i] = playerD + st.box.ahead * (0.3 + Math.random() * 0.7);
      }
      const r = this.t * st.spin + s;
      _q.setFromEuler(_e.set(r * 0.7, r, r * 0.4));
      const sz = this.size[i];
      _s.set(sz, st.glow ? sz * 1.25 : sz, sz);
      _p.set(this.x[i], this.y[i], -this.d[i]);
      _m.compose(_p, st.spin ? _q : _q.identity(), _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
