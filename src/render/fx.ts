// Game-feel sprites: dust kicked up by feet, landings and slides, cartoon stars
// and "pow" bursts on a hit, sparkles, shockwave rings, confetti and fireworks.
// All of it is one instanced mesh of camera-facing quads from one small canvas
// atlas: a sprite is written once when it's spawned (world position, velocity,
// gravity, life) and the vertex shader moves, grows, spins and fades it, so a
// frame costs a single uniform. Plus dizzy stars round a stunned head, and
// anime speed lines over the screen while dashing or flying.
import * as THREE from 'three';
import { noBend } from './bend.ts';

export const Cell = { Puff: 0, Star: 1, Burst: 2, Sparkle: 3, Confetti: 4, Ring: 5 } as const;
export type Cell = (typeof Cell)[keyof typeof Cell];

const N = 900;
const CELL = 128, COLS = 4, ROWS = 2;

function atlas() {
  const c = document.createElement('canvas');
  c.width = CELL * COLS;
  c.height = CELL * ROWS;
  const g = c.getContext('2d')!;
  const at = (i: number, draw: () => void) => {
    g.save();
    g.translate((i % COLS) * CELL + CELL / 2, Math.floor(i / COLS) * CELL + CELL / 2);
    draw();
    g.restore();
  };
  const R = CELL / 2 - 4;
  const starPath = (points: number, outer: number, inner: number) => {
    g.beginPath();
    for (let k = 0; k < points * 2; k++) {
      const r = k % 2 ? inner : outer, a = (k / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
  };
  // Puff: a soft round cloud, lit from above.
  at(Cell.Puff, () => {
    const gr = g.createRadialGradient(-R * 0.2, -R * 0.3, R * 0.1, 0, 0, R);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.4, 'rgba(240,240,240,0.6)');
    gr.addColorStop(0.75, 'rgba(225,225,225,0.2)');
    gr.addColorStop(1, 'rgba(210,210,210,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.fill();
  });
  // Star: a fat cartoon star with an outline and a shine (tinted per sprite).
  at(Cell.Star, () => {
    starPath(5, R * 0.95, R * 0.45);
    g.fillStyle = '#fff';
    g.fill();
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(150,150,150,1)';
    g.stroke();
    starPath(5, R * 0.5, R * 0.24);
    g.fillStyle = 'rgba(255,255,255,1)';
    g.fill();
  });
  // Burst: the spiky comic "pow".
  at(Cell.Burst, () => {
    starPath(11, R, R * 0.55);
    g.fillStyle = '#fff';
    g.fill();
  });
  // Sparkle: a four-point twinkle with a glow.
  at(Cell.Sparkle, () => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.6);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(-R, -R, R * 2, R * 2);
    starPath(4, R, R * 0.12);
    g.fillStyle = '#fff';
    g.fill();
  });
  // Confetti: a little paper strip.
  at(Cell.Confetti, () => {
    g.fillStyle = '#fff';
    g.fillRect(-R * 0.35, -R * 0.75, R * 0.7, R * 1.5);
  });
  // Ring: a shockwave.
  at(Cell.Ring, () => {
    g.lineWidth = R * 0.16;
    g.strokeStyle = '#fff';
    g.beginPath();
    g.arc(0, 0, R * 0.88, 0, Math.PI * 2);
    g.stroke();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = true;
  return tex;
}

const VS = /* glsl */ `
uniform float time;
attribute vec3 iPos;
attribute vec4 iVel;   // world velocity, gravity
attribute vec4 iTime;  // birth, life, size from, size to
attribute vec4 iColor; // rgb, alpha
attribute vec4 iMisc;  // atlas cell, spin (rad/s), glow (additive), drag
varying vec2 vUv;
varying vec4 vColor;
varying float vGlow;
void main() {
  float t = time - iTime.x;
  float k = t / iTime.y;
  if ( k < 0.0 || k > 1.0 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
  float drag = iMisc.w;
  float travel = drag > 0.0 ? ( 1.0 - exp( - drag * t ) ) / drag : t;
  vec3 p = iPos + iVel.xyz * travel - vec3( 0.0, 0.5 * iVel.w * t * t, 0.0 );
  float e = 1.0 - ( 1.0 - k ) * ( 1.0 - k );
  float size = mix( iTime.z, iTime.w, e );
  float a = iMisc.y * t + iTime.x * 17.0;
  vec2 q = mat2( cos( a ), sin( a ), - sin( a ), cos( a ) ) * position.xy * size;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  mv.xy += q;
  gl_Position = projectionMatrix * mv;
  float cell = iMisc.x;
  vUv = ( uv + vec2( mod( cell, ${COLS}.0 ), ${ROWS - 1}.0 - floor( cell / ${COLS}.0 ) ) ) / vec2( ${COLS}.0, ${ROWS}.0 );
  vColor = vec4( iColor.rgb, iColor.a * smoothstep( 0.0, 0.06, k ) * ( 1.0 - smoothstep( 0.55, 1.0, k ) ) );
  vGlow = iMisc.z;
}`;

const FS = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
varying float vGlow;
void main() {
  vec4 c = texture2D( map, vUv ) * vColor.a;
  // Premultiplied: a glowing sprite adds light instead of covering.
  gl_FragColor = vec4( c.rgb * vColor.rgb, c.a * ( 1.0 - vGlow ) );
  #include <colorspace_fragment>
}`;

export interface SpriteOpts {
  vel?: THREE.Vector3;
  gravity?: number;
  life: number;
  size: [number, number];
  color: number | THREE.Color;
  alpha?: number;
  cell: Cell;
  spin?: number;
  glow?: boolean;
  drag?: number;
}

const _c = new THREE.Color();
const _zero = new THREE.Vector3();
const _v = new THREE.Vector3();

export class Sprites {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private attrs: Record<'iPos' | 'iVel' | 'iTime' | 'iColor' | 'iMisc', THREE.InstancedBufferAttribute>;
  private next = 0;
  private lo = N;
  private hi = -1;
  time = 0;

  constructor() {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    const attr = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(N * size), size).setUsage(THREE.DynamicDrawUsage);
    this.attrs = { iPos: attr(3), iVel: attr(4), iTime: attr(4), iColor: attr(4), iMisc: attr(4) };
    // Nothing alive yet: every slot born long ago.
    (this.attrs.iTime.array as Float32Array).fill(-1e6);
    for (let i = 0; i < N; i++) this.attrs.iTime.setY(i, 1);
    for (const [k, a] of Object.entries(this.attrs)) g.setAttribute(k, a);
    g.instanceCount = N;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, map: { value: atlas() } },
      vertexShader: VS, fragmentShader: FS,
      transparent: true, premultipliedAlpha: true, depthWrite: false, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  /** One sprite at a world position. */
  spawn(pos: THREE.Vector3, o: SpriteOpts) {
    const i = this.next;
    this.next = (this.next + 1) % N;
    const v = o.vel ?? _zero;
    const col = typeof o.color === 'number' ? _c.setHex(o.color) : o.color;
    this.attrs.iPos.setXYZ(i, pos.x, pos.y, pos.z);
    this.attrs.iVel.setXYZW(i, v.x, v.y, v.z, o.gravity ?? 0);
    this.attrs.iTime.setXYZW(i, this.time, o.life, o.size[0], o.size[1]);
    this.attrs.iColor.setXYZW(i, col.r, col.g, col.b, o.alpha ?? 1);
    this.attrs.iMisc.setXYZW(i, o.cell, o.spin ?? 0, o.glow ? 1 : 0, o.drag ?? 0);
    this.lo = Math.min(this.lo, i);
    this.hi = Math.max(this.hi, i);
  }

  /** `n` sprites flung out from `pos` (speed `sp`, plus `up` upwards, plus `base`: carried along). */
  burst(pos: THREE.Vector3, n: number, sp: number, up: number, o: SpriteOpts, colors?: number[], base = _zero) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 2 - 1;
      const h = Math.sqrt(1 - e * e) * sp * (0.6 + Math.random() * 0.4);
      _v.set(Math.cos(a) * h, e * sp * 0.6 + up, Math.sin(a) * h).add(base);
      this.spawn(pos, { ...o, vel: _v, color: colors ? colors[k % colors.length] : o.color });
    }
  }

  update(dt: number) {
    this.time += dt;
    this.mesh.material.uniforms.time.value = this.time;
    if (this.hi < 0) return;
    for (const a of Object.values(this.attrs)) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.lo * a.itemSize, (this.hi - this.lo + 1) * a.itemSize);
      a.needsUpdate = true;
    }
    this.lo = N;
    this.hi = -1;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.uniforms.map.value.dispose();
    this.mesh.material.dispose();
  }
}

/** Stars circling a stunned runner's head (the player only). */
export class Dizzy {
  readonly mesh: THREE.InstancedMesh;
  private t = 0;
  private left = 0;
  private static readonly COUNT = 5;

  constructor(map: THREE.Texture) {
    const g = new THREE.PlaneGeometry(1, 1);
    // The star cell of the sprite atlas.
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + Cell.Star % COLS) / COLS, (uv.getY(i) + ROWS - 1) / ROWS);
    // The atlas is premultiplied: blend it as such.
    // Placed in world space (round the bent head), not bent again.
    const mat = noBend(new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false, color: 0xffd23f }));
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.mesh = new THREE.InstancedMesh(g, mat, Dizzy.COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  start(time: number) {
    this.left = Math.max(this.left, time);
  }

  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();

  /** @param head world position over the head; @param cam to face the stars at it */
  update(dt: number, head: THREE.Vector3, cam: THREE.Camera) {
    this.left -= dt;
    this.mesh.visible = this.left > 0;
    if (!this.mesh.visible) return;
    this.t += dt;
    const fade = Math.min(1, this.left / 0.25);
    this.q.copy(cam.quaternion);
    for (let i = 0; i < Dizzy.COUNT; i++) {
      const a = this.t * 6 + (i / Dizzy.COUNT) * Math.PI * 2;
      this.p.set(head.x + Math.cos(a) * 0.45, head.y + 0.1 + Math.sin(a * 2) * 0.05, head.z + Math.sin(a) * 0.45);
      const sz = 0.26 * fade * (0.85 + 0.15 * Math.sin(this.t * 10 + i));
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s.setScalar(sz)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

const LINES_VS = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

const LINES_FS = /* glsl */ `
uniform float time;
uniform float strength;
uniform float aspect;
uniform vec3 color;
varying vec2 vP;
float hash( float n ) { return fract( sin( n ) * 43758.5453 ); }
void main() {
  vec2 p = vec2( vP.x * aspect, vP.y );
  float r = length( p );
  // Only round the edges of the screen: the runner stays clear.
  float edge = smoothstep( 0.55, 1.15, r / max( aspect, 1.0 ) * 1.1 );
  if ( edge <= 0.0 ) discard;
  float ang = atan( p.y, p.x ) / 6.2831853 + 0.5;
  float slot = floor( ang * 90.0 );
  float h = hash( slot );
  float w = abs( fract( ang * 90.0 ) - 0.5 ) * 2.0;
  // Each ray streaks inwards on its own clock.
  float run = fract( h * 7.3 - time * ( 1.6 + h * 1.8 ) + r * 0.6 );
  float on = step( 0.55, h ) * smoothstep( 1.0, 0.4, w ) * smoothstep( 0.0, 0.25, run ) * smoothstep( 1.0, 0.6, run );
  float a = on * edge * strength;
  if ( a <= 0.003 ) discard;
  gl_FragColor = vec4( color * a, a );
}`;

/** Anime speed lines streaking in round the edges of the screen. */
export class SpeedLines {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private level = 0;

  constructor() {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, strength: { value: 0 }, aspect: { value: 1 }, color: { value: new THREE.Color(0xffffff) } },
      vertexShader: LINES_VS, fragmentShader: LINES_FS,
      transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    this.mesh.visible = false;
  }

  /** @param want 0 = off … 1 = full (dash, rocket) */
  update(dt: number, want: number, aspect: number) {
    this.level += (want - this.level) * (1 - Math.exp(-dt * (want > this.level ? 10 : 4)));
    const u = this.mesh.material.uniforms;
    u.time.value += dt;
    u.strength.value = this.level * 0.55;
    u.aspect.value = aspect;
    this.mesh.visible = this.level > 0.02;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
