// Sky dome, distant skyline and the far ground, all drawn around the camera in
// plain world space (not bent with the track). Each zone sets a "look": sky
// gradient, sun, ambient light and fog, blended smoothly as you run through.
import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import type { CountryId, Palette } from '../world/biomes.ts';
import { noBend } from './bend.ts';

export interface Look {
  top: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  sunI: number;
  sunAngle: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiI: number;
  fogNear: number;
  fogFar: number;
  side: THREE.Color;
}

export function lookOf(p: Palette): Look {
  const horizon = new THREE.Color(p.sky);
  return {
    top: new THREE.Color(p.skyTop ?? new THREE.Color(p.sky).lerp(new THREE.Color(0x3f8fe0), 0.55).getHex()),
    horizon,
    sun: new THREE.Color(p.sun ?? 0xffffff),
    sunI: p.sunI ?? 2.2,
    sunAngle: p.sunAngle ?? 0.9,
    hemiSky: new THREE.Color(p.hemiSky ?? 0xffffff),
    hemiGround: new THREE.Color(p.hemiGround ?? 0x8d7b68),
    hemiI: p.hemiI ?? 1.7,
    fogNear: p.fog?.[0] ?? 45,
    fogFar: p.fog?.[1] ?? 175,
    side: new THREE.Color(p.side),
  };
}

export function blendLook(out: Look, to: Look, k: number) {
  out.top.lerp(to.top, k);
  out.horizon.lerp(to.horizon, k);
  out.sun.lerp(to.sun, k);
  out.hemiSky.lerp(to.hemiSky, k);
  out.hemiGround.lerp(to.hemiGround, k);
  out.side.lerp(to.side, k);
  out.sunI += (to.sunI - out.sunI) * k;
  out.sunAngle += (to.sunAngle - out.sunAngle) * k;
  out.hemiI += (to.hemiI - out.hemiI) * k;
  out.fogNear += (to.fogNear - out.fogNear) * k;
  out.fogFar += (to.fogFar - out.fogFar) * k;
}

export const cloneLook = (l: Look): Look => ({
  ...l, top: l.top.clone(), horizon: l.horizon.clone(), sun: l.sun.clone(),
  hemiSky: l.hemiSky.clone(), hemiGround: l.hemiGround.clone(), side: l.side.clone(),
});

// Sun direction in world space: low in the sky ahead and to the right of the start.
export function sunDirection(angle: number, out = new THREE.Vector3()) {
  return out.set(0.45, Math.sin(angle), -Math.cos(angle)).normalize();
}

const DOME_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  vec4 p = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * p;
}`;

const DOME_FS = /* glsl */ `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 sunColor;
uniform vec3 sunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  float h = clamp( d.y, 0.0, 1.0 );
  vec3 col = mix( horizon, top, pow( h, 0.55 ) );
  float s = max( dot( d, sunDir ), 0.0 );
  col += sunColor * ( pow( s, 900.0 ) * 1.4 + pow( s, 24.0 ) * 0.28 + pow( s, 4.0 ) * 0.08 );
  gl_FragColor = vec4( col, 1.0 );
  #include <colorspace_fragment>
}`;

const RING_VS = /* glsl */ `
attribute float haze;
varying vec3 vColor;
varying float vHaze;
void main() {
  vColor = color;
  vHaze = haze;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const RING_FS = /* glsl */ `
uniform vec3 hazeColor;
varying vec3 vColor;
varying float vHaze;
void main() {
  gl_FragColor = vec4( mix( vColor, hazeColor, vHaze ), 1.0 );
  #include <colorspace_fragment>
}`;

interface Layer { radius: number; haze: number; color: number; peak: number; height: (a: number) => number; snow?: (a: number) => number }

/** Distant skyline for each country: ridges, plus Fuji, karst peaks or towers. */
function layersFor(country: CountryId | null, seed: number): Layer[] {
  const rng = new Rng(seed ^ 0x51ed27);
  const waves = (amp: number, base: number, n = 4) => {
    const w = Array.from({ length: n }, () => ({ f: rng.int(2, 9), p: rng.range(0, 6.28), a: rng.range(0.4, 1) }));
    return (a: number) => base + amp * w.reduce((s, x) => s + Math.sin(a * x.f + x.p) * x.a, 0) / n;
  };
  const bumps = (n: number, hMin: number, hMax: number, width: number) => {
    const b = Array.from({ length: n }, () => ({ a: rng.range(0, Math.PI * 2), h: rng.range(hMin, hMax), w: width * rng.range(0.6, 1.4) }));
    return (a: number) => {
      let h = 0;
      for (const x of b) {
        let da = Math.abs(a - x.a);
        da = Math.min(da, Math.PI * 2 - da);
        h = Math.max(h, x.h * Math.exp(-(da * da) / (x.w * x.w)));
      }
      return h;
    };
  };
  switch (country) {
    case 'jp': {
      // Fuji straight ahead of the start line.
      const fujiA = Math.PI / 2;
      const fuji = (a: number) => {
        let da = Math.abs(a - fujiA);
        da = Math.min(da, Math.PI * 2 - da);
        const t = Math.max(0, 1 - da / 0.42);
        return 92 * Math.min(1, t * 1.22) ** 1.2;
      };
      const ridge = waves(10, 18);
      return [
        { radius: 340, haze: 0.45, color: 0x5d7aa8, peak: 110, height: (a) => Math.max(fuji(a), ridge(a)), snow: (a) => (fuji(a) > 40 ? 0.7 : 2) },
        { radius: 310, haze: 0.4, color: 0x5f8a70, peak: 40, height: waves(9, 16, 5) },
        { radius: 285, haze: 0.25, color: 0x4a7a55, peak: 25, height: waves(6, 9, 6) },
      ];
    }
    case 'cn': {
      const far = bumps(26, 40, 85, 0.05), mid = bumps(22, 28, 60, 0.045);
      const base = waves(6, 10);
      return [
        { radius: 340, haze: 0.55, color: 0x6f8f8a, peak: 90, height: (a) => Math.max(base(a), far(a)) },
        { radius: 310, haze: 0.38, color: 0x4f7f62, peak: 60, height: (a) => Math.max(base(a) * 0.8, mid(a)) },
        { radius: 285, haze: 0.22, color: 0x3f6f4f, peak: 30, height: waves(7, 8, 6) },
      ];
    }
    case 'th': {
      const spires = bumps(10, 30, 55, 0.012);
      const towers = (() => {
        const t = Array.from({ length: 30 }, () => ({ a: rng.range(-0.9, 0.9) + Math.PI / 2, w: rng.range(0.012, 0.03), h: rng.range(18, 60) }));
        return (a: number) => t.reduce((m, x) => (Math.abs(a - x.a) < x.w ? Math.max(m, x.h) : m), 0);
      })();
      return [
        { radius: 340, haze: 0.5, color: 0x7f8fa8, peak: 60, height: (a) => Math.max(waves(8, 12)(a), towers(a)) },
        { radius: 310, haze: 0.35, color: 0x5f8a5a, peak: 55, height: (a) => Math.max(waves(5, 8, 5)(a), spires(a)) },
        { radius: 285, haze: 0.2, color: 0x4f7a45, peak: 20, height: waves(4, 6, 6) },
      ];
    }
    default:
      return [
        { radius: 340, haze: 0.5, color: 0x7f9fb8, peak: 50, height: waves(14, 22) },
        { radius: 300, haze: 0.3, color: 0x6a9a6a, peak: 30, height: waves(8, 10, 6) },
      ];
  }
}

function ringGeometry(layers: Layer[]) {
  const pos: number[] = [], col: number[] = [], haze: number[] = [], idx: number[] = [];
  const c = new THREE.Color(), white = new THREE.Color(0xf4f8ff);
  const N = 360;
  for (const L of layers) {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const h = Math.max(2, L.height(a));
      const x = Math.cos(a) * L.radius, z = -Math.sin(a) * L.radius;
      const snowAt = L.snow ? L.snow(a) : 2;
      // Rows: below the horizon, the body, a snow line, the top.
      const rows: [number, THREE.Color, number][] = [
        [-60, c.setHex(L.color).clone(), 1],
        [h * Math.min(0.98, snowAt), c.setHex(L.color).clone(), L.haze],
        [h * Math.min(0.99, snowAt + 0.01), snowAt < 1 ? white : c.setHex(L.color).clone(), L.haze * 0.8],
        [h, snowAt < 1 ? white : c.setHex(L.color).offsetHSL(0, 0, 0.06).clone(), L.haze * (snowAt < 1 ? 0.7 : 1)],
      ];
      for (const [y, cc, hz] of rows) {
        pos.push(x, y, z);
        col.push(cc.r, cc.g, cc.b);
        haze.push(hz);
      }
    }
    for (let i = 0; i < N; i++) {
      for (let r = 0; r < 3; r++) {
        const a = base + i * 4 + r, b = a + 4;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('haze', new THREE.Float32BufferAttribute(haze, 1));
  g.setIndex(idx);
  return g;
}

export class Sky {
  readonly root = new THREE.Group();
  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private ring: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private floor: THREE.Mesh<THREE.CircleGeometry, THREE.MeshLambertMaterial>;

  constructor(country: CountryId | null, seed: number) {
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(390, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunColor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) } },
        vertexShader: DOME_VS, fragmentShader: DOME_FS, side: THREE.BackSide, depthWrite: false, fog: false,
      }),
    );
    this.dome.renderOrder = -10;
    this.ring = new THREE.Mesh(
      ringGeometry(layersFor(country, seed)),
      new THREE.ShaderMaterial({ uniforms: { hazeColor: { value: new THREE.Color() } }, vertexShader: RING_VS, fragmentShader: RING_FS, vertexColors: true, fog: false, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ring.renderOrder = -9;
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(380, 40).rotateX(-Math.PI / 2), noBend(new THREE.MeshLambertMaterial({ color: 0x88aa66 })));
    this.floor.receiveShadow = false;
    this.root.add(this.dome, this.ring, this.floor);
  }

  update(cam: THREE.Vector3, look: Look, groundY: number) {
    this.dome.position.copy(cam);
    this.ring.position.set(cam.x, groundY - 2, cam.z);
    this.floor.position.set(cam.x, groundY, cam.z);
    const u = this.dome.material.uniforms;
    u.top.value.copy(look.top);
    u.horizon.value.copy(look.horizon);
    u.sunColor.value.copy(look.sun);
    sunDirection(look.sunAngle, u.sunDir.value);
    this.ring.material.uniforms.hazeColor.value.copy(look.horizon);
    this.floor.material.color.copy(look.side).lerp(look.horizon, 0.25);
  }

  dispose() {
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
  }
}
