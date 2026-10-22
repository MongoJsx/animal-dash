// Cheering spectators lining the start and the finish: little animal-eared
// fans in team shirts, hopping and waving both arms over their heads. One
// instanced mesh in track space (so it bends with the road like everything
// else); the hopping and waving happen in the vertex shader off one time
// uniform, so a frame costs nothing on the CPU.
import * as THREE from 'three';
import { RACE_LENGTH, TRACK_HALF } from '../config.ts';
import { Rng } from '../core/rng.ts';

const SHIRTS = [0xe63946, 0xffbe0b, 0x3a86ff, 0x2ec4b6, 0xff6b9d, 0x8338ec, 0xfb5607, 0x06d6a0, 0xffffff];
const SKIN = 0xc8915a, PANTS = 0x2b2d42;

/** One fan: legs, shirt, head with ears, two arms hinged at the shoulders. */
function fanGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: number, shirt: boolean, arm = 0) => {
    const g2 = g.index ? g.toNonIndexed() : g;
    const n = g2.getAttribute('position').count;
    const c = new THREE.Color(color);
    g2.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
    g2.setAttribute('shirt', new THREE.Float32BufferAttribute(new Array(n).fill(shirt ? 1 : 0), 1));
    g2.setAttribute('arm', new THREE.Float32BufferAttribute(new Array(n).fill(arm), 1));
    g2.deleteAttribute('uv');
    parts.push(g2);
  };
  add(new THREE.BoxGeometry(0.34, 0.72, 0.22).translate(0, 0.36, 0), PANTS, false);
  add(new THREE.CylinderGeometry(0.19, 0.23, 0.62, 8).translate(0, 1.03, 0), 0, true);
  add(new THREE.IcosahedronGeometry(0.19, 1).translate(0, 1.52, 0), SKIN, false);
  for (const e of [-1, 1]) {
    add(new THREE.ConeGeometry(0.07, 0.2, 5).rotateZ(-e * 0.35).translate(e * 0.11, 1.72, 0), SKIN, false);
    // Arms hang from the shoulder; the shader swings them up.
    add(new THREE.BoxGeometry(0.1, 0.5, 0.1).translate(e * 0.26, 1.06, 0), 0, true, e);
  }
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color', 'shirt', 'arm']) {
    const size = parts[0].getAttribute(name).itemSize;
    const arr: number[] = [];
    for (const p of parts) arr.push(...(p.getAttribute(name).array as Float32Array));
    out.setAttribute(name, new THREE.Float32BufferAttribute(arr, size));
  }
  return out;
}

export class Crowd {
  readonly mesh: THREE.InstancedMesh;
  private time = { value: 0 };

  constructor(seed: number) {
    const rng = new Rng(seed ^ 0xc40d);
    const spots: { x: number; d: number; s: number }[] = [];
    // Two rows each side: behind the start boxes, and along the run-in to the finish and the run-out past it.
    const line = (d0: number, d1: number) => {
      for (const side of [-1, 1]) for (let row = 0; row < 2; row++) {
        for (let d = d0 + rng.range(0, 0.4); d < d1; d += rng.range(0.7, 1.0)) {
          spots.push({ x: side * (TRACK_HALF + 1.05 + row * 0.8 + rng.range(-0.1, 0.1)), d, s: rng.range(0.85, 1.08) });
        }
      }
    };
    line(3, 15);
    line(RACE_LENGTH - 26, RACE_LENGTH + 30);

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const time = this.time;
    mat.onBeforeCompile = (shader, renderer) => {
      THREE.Material.prototype.onBeforeCompile.call(mat, shader, renderer);
      shader.uniforms.crowdTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float crowdTime;
attribute float shirt;
attribute float arm;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
float fan = fract( sin( float( gl_InstanceID ) * 12.9898 ) * 43758.5453 );
// Arms up over the head, waving; the whole fan hops on its own beat.
if ( arm != 0.0 ) {
  vec2 sh = vec2( arm * 0.26, 1.3 );
  float a = arm * ( 2.55 + 0.35 * sin( crowdTime * ( 8.0 + fan * 4.0 ) + fan * 20.0 ) );
  vec2 q = transformed.xy - sh;
  transformed.xy = sh + vec2( q.x * cos( a ) - q.y * sin( a ), q.x * sin( a ) + q.y * cos( a ) );
}
transformed.y += max( 0.0, sin( crowdTime * ( 6.0 + fan * 3.0 ) + fan * 31.0 ) ) * 0.2;`)
        .replace('#include <color_vertex>', `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
	vColor.xyz = mix( color.xyz, instanceColor.xyz, shirt );
#endif`);
    };
    mat.customProgramCacheKey = () => 'crowd';

    this.mesh = new THREE.InstancedMesh(fanGeometry(), mat, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    spots.forEach((f, i) => {
      // Face the track, turned a little this way or that.
      q.setFromAxisAngle(up, (f.x < 0 ? Math.PI / 2 : -Math.PI / 2) + rng.range(-0.5, 0.5));
      this.mesh.setMatrixAt(i, m.compose(p.set(f.x, 0, -f.d), q, s.setScalar(f.s)));
      this.mesh.setColorAt(i, c.setHex(rng.pick(SHIRTS)));
    });
    this.mesh.frustumCulled = false;
  }

  /** Only drawn while the start or the finish is in view. */
  update(dt: number, viewD: number) {
    this.time.value += dt;
    this.mesh.visible = viewD < 40 || viewD > RACE_LENGTH - 200;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
