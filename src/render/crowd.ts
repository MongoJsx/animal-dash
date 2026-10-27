// Cheering spectators lining the start and the finish, and in knots along the
// pavements of the city zones: little animal-eared fans in team shirts,
// hopping and waving both arms over their heads. Instanced meshes in track
// space (so they bend with the road like everything else), one per stretch so
// only the fans near the runner are drawn; the hopping and waving happen in
// the vertex shader off one time uniform, so a frame costs nothing on the CPU.
import * as THREE from 'three';
import { BIOME_LENGTH, RACE_LENGTH, TRACK_HALF } from '../config.ts';
import { Rng } from '../core/rng.ts';
import type { BiomeId } from '../world/biomes.ts';
import { SCENE_HALF } from './shapes.ts';

/** Zones with a pavement where fans gather along the race, and how far out it runs (from the road edge, metres). */
const STREETS: Partial<Record<BiomeId, [number, number]>> = {
  th_city: [0.8, 2.6], cn_town: [0.6, 1.6], jp_tokyo: [0.8, 2.8], jp_sakura: [0.9, 2.2], th_palace: [0.9, 1.6],
};

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

interface Spot { x: number; d: number; s: number }

export class Crowd {
  /** Everything the crowd draws (add this to the scene). */
  readonly mesh = new THREE.Group();
  private stands: { mesh: THREE.InstancedMesh; d0: number; d1: number }[] = [];
  private time = { value: 0 };
  private material: THREE.MeshLambertMaterial;
  private geometry = fanGeometry();

  constructor(seed: number, biomes: BiomeId[] = []) {
    const rng = new Rng(seed ^ 0xc40d);
    const spots: Spot[] = [];
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
    // Knots of fans along the pavements, every 30-60 m; one mesh per 100 m.
    const street: Spot[][] = [];
    biomes.forEach((b, z) => {
      const walk = STREETS[b];
      if (!walk) return;
      for (let d = z * BIOME_LENGTH + 30; d < (z + 1) * BIOME_LENGTH - 20; d += rng.range(30, 60)) {
        const side = rng.chance(0.5) ? -1 : 1;
        const knot: Spot[] = [];
        const n = rng.int(4, 9);
        for (let i = 0; i < n; i++) {
          knot.push({ x: side * (SCENE_HALF + rng.range(walk[0], walk[1])) + side * (TRACK_HALF - SCENE_HALF), d: d + rng.range(-2.5, 2.5), s: rng.range(0.85, 1.08) });
        }
        const k = Math.floor(d / 100);
        (street[k] ??= []).push(...knot);
      }
    });

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

    this.material = mat;
    this.stand(spots.filter((f) => f.d < RACE_LENGTH / 2), rng, -1e9, 40);
    this.stand(spots.filter((f) => f.d > RACE_LENGTH / 2), rng, RACE_LENGTH - 200, 1e9);
    street.forEach((list, k) => this.stand(list, rng, k * 100 - 200, k * 100 + 120));
  }

  /** One instanced batch of fans, drawn while the runner is between d0 and d1. */
  private stand(spots: Spot[], rng: Rng, d0: number, d1: number) {
    if (!spots.length) return;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    spots.forEach((f, i) => {
      // Face the track, turned a little this way or that.
      q.setFromAxisAngle(up, (f.x < 0 ? Math.PI / 2 : -Math.PI / 2) + rng.range(-0.5, 0.5));
      mesh.setMatrixAt(i, m.compose(p.set(f.x, 0, -f.d), q, s.setScalar(f.s)));
      mesh.setColorAt(i, c.setHex(rng.pick(SHIRTS)));
    });
    mesh.frustumCulled = false;
    this.mesh.add(mesh);
    this.stands.push({ mesh, d0, d1 });
  }

  /** Each batch is only drawn while it can be in view. */
  update(dt: number, viewD: number) {
    this.time.value += dt;
    for (const st of this.stands) st.mesh.visible = viewD > st.d0 && viewD < st.d1;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    for (const st of this.stands) st.mesh.dispose();
  }
}
