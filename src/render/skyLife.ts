// Life in the sky: painted clouds drifting on the wind round the horizon, and
// flocks of birds crossing the view now and then. Both live around the camera
// like the rest of the sky. Clouds move entirely in the vertex shader (one
// draw, no per-frame CPU work); birds are a handful of billboards whose wings
// flap in the shader, only their flock positions are set each frame.
import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import type { CountryId } from '../world/biomes.ts';

// ---------------------------------------------------------------- clouds

const CELL_W = 512, CELL_H = 256;

/** Four cumulus shapes on one canvas (2 × 2 cells): lit tops, blue-grey bellies, flat bases. */
function cloudAtlas(seed: number) {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * 2;
  canvas.height = CELL_H * 2;
  const g = canvas.getContext('2d')!;
  const rng = new Rng(seed ^ 0x6c0d);
  for (let cell = 0; cell < 4; cell++) {
    const layer = document.createElement('canvas');
    layer.width = CELL_W;
    layer.height = CELL_H;
    const c = layer.getContext('2d')!;
    const base = CELL_H * 0.82;
    // Puffs along a dome: big and high in the middle, small at the ends,
    // with a few smaller ones heaped on top for the cauliflower look.
    const lean = rng.range(-0.12, 0.12);
    const puffs: { x: number; y: number; r: number }[] = [];
    const n = rng.int(9, 12);
    for (let i = 0; i < n; i++) {
      const t = (i + rng.range(0.2, 0.8)) / n;
      const h = Math.sin(Math.PI * Math.min(1, Math.max(0, t + lean * (1 - t)))) ** 0.8;
      const r = CELL_H * (0.09 + 0.17 * h) * rng.range(0.85, 1.15);
      puffs.push({ x: CELL_W * (0.1 + 0.8 * t), y: base - r * 0.55 - CELL_H * 0.3 * h, r });
    }
    for (let i = rng.int(2, 4); i > 0; i--) {
      const t = rng.range(0.3, 0.7);
      const r = CELL_H * rng.range(0.1, 0.16);
      puffs.push({ x: CELL_W * (0.1 + 0.8 * t), y: base - CELL_H * rng.range(0.42, 0.55), r });
    }
    const puff = (x: number, y: number, r: number, inner: string, outer: string, hx = 0, hy = 0) => {
      const gr = c.createRadialGradient(x + hx * r, y + hy * r, r * 0.05, x, y, r);
      gr.addColorStop(0, inner);
      gr.addColorStop(0.86, outer);
      gr.addColorStop(1, outer.replace(/[\d.]+\)$/, '0)'));
      c.fillStyle = gr;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    };
    // Shadowed belly first, then the sunlit puffs a little higher over it.
    for (const p of puffs) puff(p.x, p.y + p.r * 0.06, p.r * 1.03, 'rgba(214,224,240,1)', 'rgba(178,195,224,1)');
    for (const p of puffs) puff(p.x, p.y - p.r * 0.18, p.r * 0.88, 'rgba(255,255,255,1)', 'rgba(240,245,252,1)', -0.3, -0.4);
    // Flatten and soften the base.
    c.globalCompositeOperation = 'destination-in';
    const fade = c.createLinearGradient(0, base - CELL_H * 0.08, 0, base + CELL_H * 0.04);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = fade;
    c.fillRect(0, 0, CELL_W, CELL_H);
    g.drawImage(layer, (cell % 2) * CELL_W, Math.floor(cell / 2) * CELL_H);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = true;
  tex.anisotropy = 4;
  return tex;
}

const CLOUD_VS = /* glsl */ `
uniform float time;
attribute float iA;     // azimuth at time 0
attribute float iSpeed; // radians per second
attribute vec4 iShape;  // radius, height, width (negative = mirrored), quad height
attribute vec2 iLook;   // atlas cell, opacity
varying vec2 vUv;
varying float vAlpha;
void main() {
  float a = iA + time * iSpeed;
  vec3 radial = vec3( cos( a ), 0.0, - sin( a ) );
  vec3 across = vec3( - sin( a ), 0.0, - cos( a ) );
  vec3 p = radial * iShape.x + across * position.x * iShape.z + vec3( 0.0, iShape.y + position.y * iShape.w, 0.0 );
  vUv = ( uv + vec2( mod( iLook.x, 2.0 ), floor( iLook.x / 2.0 ) ) ) * 0.5;
  vAlpha = iLook.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
}`;

const CLOUD_FS = /* glsl */ `
uniform sampler2D map;
uniform vec3 tint;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec4 c = texture2D( map, vUv );
  gl_FragColor = vec4( c.rgb * tint, c.a ) * vAlpha;
  #include <colorspace_fragment>
}`;

const WIND = 3.2; // m/s, the same way round for every cloud

function clouds(seed: number, seam: number) {
  const rng = new Rng(seed ^ 0xc10d5);
  const rows: { a: number; speed: number; shape: number[]; look: number[] }[] = [];
  const add = (a: number, r: number, y: number, w: number, alpha: number) => {
    rows.push({ a, speed: (WIND * rng.range(0.8, 1.25)) / r, shape: [r, y, w * (rng.chance(0.5) ? 1 : -1), w * 0.5], look: [rng.int(0, 3), alpha] });
  };
  // A belt along the top of the painting all the way round, so its edge is
  // always under a cloud or two, then smaller, paler ones higher up.
  const belt = 16;
  for (let i = 0; i < belt; i++) add(((i + rng.range(-0.3, 0.3)) / belt) * Math.PI * 2, rng.range(300, 330), seam + rng.range(-14, 14), rng.range(110, 170), rng.range(0.92, 1));
  for (let i = 0; i < 12; i++) add(rng.range(0, Math.PI * 2), rng.range(260, 300), seam + rng.range(50, 120), rng.range(70, 110), rng.range(0.75, 0.9));
  // A few low wisps that drift in front of the painted hills.
  for (let i = 0; i < 7; i++) add(rng.range(0, Math.PI * 2), rng.range(230, 280), seam * rng.range(0.45, 0.62), rng.range(55, 85), rng.range(0.5, 0.65));

  const g = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  g.setAttribute('uv', quad.getAttribute('uv'));
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(rows.map((r) => r.a)), 1));
  g.setAttribute('iSpeed', new THREE.InstancedBufferAttribute(new Float32Array(rows.map((r) => r.speed)), 1));
  g.setAttribute('iShape', new THREE.InstancedBufferAttribute(new Float32Array(rows.flatMap((r) => r.shape)), 4));
  g.setAttribute('iLook', new THREE.InstancedBufferAttribute(new Float32Array(rows.flatMap((r) => r.look)), 2));
  g.instanceCount = rows.length;
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, map: { value: cloudAtlas(seed) }, tint: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS,
    transparent: true, premultipliedAlpha: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = -8; // over the painting, under everything else
  return mesh;
}

// ----------------------------------------------------------------- birds

/** One gull silhouette, wings spread: x across (−1..1), y up; `flex` = how far out on the wing. */
function birdGeometry() {
  const pos: number[] = [], flex: number[] = [];
  const v = (x: number, y: number) => { pos.push(x, y, 0); flex.push(Math.abs(x)); };
  for (const s of [-1, 1]) {
    // Shoulder, elbow, tip; the wing thins out towards the tip.
    const p0 = [0, 0], p1 = [0.42 * s, 0.1], p2 = [1 * s, -0.04];
    const t0 = 0.075, t1 = 0.05;
    v(p0[0], p0[1] + t0); v(p0[0], p0[1] - t0); v(p1[0], p1[1] + t1);
    v(p0[0], p0[1] - t0); v(p1[0], p1[1] - t1); v(p1[0], p1[1] + t1);
    v(p1[0], p1[1] + t1); v(p1[0], p1[1] - t1); v(p2[0], p2[1]);
  }
  // Body.
  v(0, 0.07); v(-0.07, -0.01); v(0.07, -0.01);
  v(-0.07, -0.01); v(0, -0.12); v(0.07, -0.01);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('flex', new THREE.Float32BufferAttribute(flex, 1));
  return g;
}

const BIRD_VS = /* glsl */ `
uniform float time;
attribute float flex;
attribute vec4 iPos;  // position, size (0 = hidden)
attribute vec2 iWing; // flap rate (rad/s), phase
void main() {
  // Bursts of flapping between glides.
  float glide = smoothstep( -0.3, 0.5, sin( time * 0.45 + iWing.y * 3.1 ) );
  float f = sin( time * iWing.x + iWing.y ) * mix( 0.12, 1.0, glide );
  vec2 q = position.xy;
  q.y += f * ( 0.45 * flex + 0.4 * flex * flex );
  q.x *= 1.0 - 0.18 * abs( f ) * flex;
  vec4 mv = modelViewMatrix * vec4( iPos.xyz, 1.0 );
  mv.xy += q * iPos.w;
  gl_Position = projectionMatrix * mv;
}`;

const BIRD_FS = /* glsl */ `
uniform vec3 color;
void main() {
  gl_FragColor = vec4( color, 1.0 );
  #include <colorspace_fragment>
}`;

const FLOCKS = 3, PER_FLOCK = 7;

interface Flock {
  wait: number; // seconds until it sets off (while idle)
  t: number;
  dur: number;
  a0: number; a1: number; // azimuth from, to
  r0: number; r1: number; // distance from, to
  y: number;
  size: number;
  n: number;
  spacing: number;
}

// --------------------------------------------------------------- the lot

export class SkyLife {
  readonly root = new THREE.Group();
  private clouds: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private birds: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private birdPos: THREE.InstancedBufferAttribute;
  private flocks: Flock[];
  private birdColor: THREE.Color;
  private time = 0;

  /** @param seam height of the painted backdrop's top edge above the far ground */
  constructor(country: CountryId | null, seed: number, seam: number) {
    this.clouds = clouds(seed, seam);

    const g = birdGeometry();
    const n = FLOCKS * PER_FLOCK;
    this.birdPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.birdPos);
    // Cranes in Japan beat their wings slowly; the others are quicker.
    const rate = country === 'jp' ? 7 : 10;
    g.setAttribute('iWing', new THREE.InstancedBufferAttribute(new Float32Array(Array.from({ length: n }, () => [rate * (0.85 + Math.random() * 0.3), Math.random() * 6.28]).flat()), 2));
    g.instanceCount = n;
    this.birdColor = new THREE.Color(country === 'jp' ? 0xf4f6fb : 0x2c3140);
    this.birds = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, color: { value: new THREE.Color() } },
      vertexShader: BIRD_VS, fragmentShader: BIRD_FS, side: THREE.DoubleSide, fog: false,
    }));
    this.birds.frustumCulled = false;
    // The first flock comes by soon after the start, the others later.
    this.flocks = Array.from({ length: FLOCKS }, (_, i) => ({ wait: 3 + i * 9 + Math.random() * 4, t: 0, dur: 0, a0: 0, a1: 0, r0: 0, r1: 0, y: 0, size: 1, n: 0, spacing: 0 }));
    this.root.add(this.clouds, this.birds);
  }

  /**
   * @param heading azimuth the runner faces (radians, same measure as the clouds)
   * @param tint the light on the painted sky (dusk, snow), for clouds and birds
   */
  update(dt: number, heading: number, tint: THREE.Color, haze: THREE.Color) {
    this.time += dt;
    this.clouds.material.uniforms.time.value = this.time;
    this.clouds.material.uniforms.tint.value.copy(tint);
    const bu = this.birds.material.uniforms;
    bu.time.value = this.time;
    // Far birds take on a little of the sky's colour.
    bu.color.value.copy(this.birdColor).multiply(tint).lerp(haze, 0.22);

    const P = this.birdPos.array as Float32Array;
    this.flocks.forEach((f, k) => {
      if (f.n === 0) {
        f.wait -= dt;
        if (f.wait <= 0) this.launch(f, heading);
      } else {
        f.t += dt;
        if (f.t >= f.dur) { f.n = 0; f.wait = 6 + Math.random() * 10; }
      }
      const e = f.n ? f.t / f.dur : 0;
      const a = f.a0 + (f.a1 - f.a0) * e;
      const r = f.r0 + (f.r1 - f.r0) * e;
      const dir = Math.sign(f.a1 - f.a0);
      // Flying direction (along the arc) and sideways (out from the camera).
      const fx = -Math.sin(a) * dir, fz = -Math.cos(a) * dir;
      const sx = Math.cos(a), sz = -Math.sin(a);
      const cx = sx * r, cz = sz * r;
      for (let i = 0; i < PER_FLOCK; i++) {
        const o = (k * PER_FLOCK + i) * 4;
        if (i >= f.n) { P[o + 3] = 0; continue; }
        // A loose V: the leader in front, the rest trailing either side.
        const rank = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
        const back = rank * f.spacing + Math.sin(this.time * 0.7 + i * 1.7) * 0.8;
        const out = side * rank * f.spacing * 0.8;
        P[o] = cx - fx * back + sx * out;
        P[o + 1] = f.y + rank * 0.6 + Math.sin(this.time * 0.9 + i * 2.3) * 0.7 + Math.sin(f.t * 0.35) * 3;
        P[o + 2] = cz - fz * back + sz * out;
        P[o + 3] = f.size;
      }
    });
    this.birdPos.needsUpdate = true;
  }

  /** Set a flock off across the view ahead, from out of sight on one side to the other. */
  private launch(f: Flock, heading: number) {
    const side = Math.random() < 0.5 ? -1 : 1;
    f.a0 = heading + side * (1.05 + Math.random() * 0.3);
    f.a1 = heading - side * (0.95 + Math.random() * 0.4);
    f.r0 = 95 + Math.random() * 50;
    f.r1 = f.r0 + (Math.random() - 0.35) * 60;
    f.y = 24 + Math.random() * 20;
    f.n = 3 + Math.floor(Math.random() * (PER_FLOCK - 2));
    f.size = 1.35 + Math.random() * 0.4;
    f.spacing = 3.2 + Math.random() * 1.5;
    f.t = 0;
    const speed = 10 + Math.random() * 4;
    f.dur = (Math.abs(f.a1 - f.a0) * (f.r0 + f.r1)) / 2 / speed;
  }

  dispose() {
    this.clouds.geometry.dispose();
    this.clouds.material.uniforms.map.value.dispose();
    this.clouds.material.dispose();
    this.birds.geometry.dispose();
    this.birds.material.dispose();
  }
}
