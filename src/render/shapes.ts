// Low-poly shape builder: many primitives merged into one vertex-coloured
// geometry, so a whole obstacle or a 25 m stretch of scenery is one draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANE_WIDTH, TRACK_HALF } from '../config.ts';

export const flatMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

// Wind: every vertex carries (sway, flutter) weights, zero for anything solid.
// Leaves and fronds sway slowly, flags ripple fast, all in the vertex shader.
const wind = { value: 0 };
/** Advance the wind (seconds). */
export function setWind(t: number) {
  wind.value = t;
}
// The shared hook (bend.ts) is installed later, so look it up when compiling.
// Surface detail, in straight track space so it never swims round bends:
// - grain: two octaves of value noise break up every flat colour like painted
//   card, coarse blotches plus fine speckle (a road reads as asphalt, a wall as plaster);
// - grounding: walls darken toward their foot and brighten toward their top,
//   so houses, trees and posts sit on the ground instead of floating on it;
// - ground speckle is stronger on level faces, wall grain runs in bands.
const DETAIL_VS = /* glsl */ `
varying vec3 vStraight;`;
const DETAIL_FS = /* glsl */ `
varying vec3 vStraight;
float dHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float dNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( dHash( i ), dHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( dHash( i + vec3( 0, 1, 0 ) ), dHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( dHash( i + vec3( 0, 0, 1 ) ), dHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( dHash( i + vec3( 0, 1, 1 ) ), dHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}`;
const DETAIL_APPLY = /* glsl */ `
{
  vec3 sp = vStraight;
  vec3 fn = normalize( cross( dFdx( sp ), dFdy( sp ) ) );
  float level = abs( fn.y );
  float coarse = dNoise( sp * 0.45 );
  float fine = dNoise( sp * vec3( 3.1, 3.1, 3.1 ) );
  float speck = dNoise( sp * 11.0 );
  // Fine detail fades with distance, so far surfaces stay calm instead of shimmering.
  float near = 1.0 - smoothstep( 25.0, 80.0, length( vViewPosition ) );
  float grain = ( coarse - 0.5 ) * 0.16 + ( ( fine - 0.5 ) * 0.10 + ( speck - 0.5 ) * 0.10 * level ) * near;
  diffuseColor.rgb *= 1.0 + grain;
  // Snow (bright, level): a few crystals glint, each only from some angles.
  float bright = dot( diffuseColor.rgb, vec3( 0.333 ) );
  if ( bright > 0.82 && level > 0.8 ) {
    vec3 cell = floor( sp * 9.0 );
    float glint = step( 0.992, dHash( cell ) ) * step( 0.6, fract( dHash( cell + 3.1 ) * 7.0 + dot( normalize( vViewPosition ), vec3( 2.0, 3.0, 1.0 ) ) ) );
    diffuseColor.rgb += vec3( 0.6 ) * glint * near;
  }
  // Walls: darker at the foot, a touch lighter up top.
  float foot = smoothstep( -0.2, 2.2, sp.y );
  diffuseColor.rgb *= mix( 1.0, mix( 0.74, 1.04, foot ), 1.0 - level );
}`;
flatMaterial.onBeforeCompile = function (shader, renderer) {
  THREE.Material.prototype.onBeforeCompile.call(this, shader, renderer);
  shader.uniforms.windTime = wind;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
uniform float windTime;
attribute vec2 sway;${DETAIL_VS}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
if ( sway.x + sway.y > 0.0 ) {
  float ph = position.x * 0.21 + position.z * 0.17;
  transformed.x += sway.x * ( sin( windTime * 1.6 + ph ) * 0.16 + sin( windTime * 3.7 + ph * 2.3 ) * 0.04 );
  transformed.z += sway.x * sin( windTime * 1.2 + ph * 1.4 ) * 0.1;
  transformed.x += sway.y * sin( windTime * 9.0 + position.z * 4.5 + position.y * 1.5 ) * 0.11;
  transformed.y += sway.y * sin( windTime * 7.0 + position.z * 3.0 ) * 0.03;
}
vStraight = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>${DETAIL_FS}`)
    .replace('#include <color_fragment>', `#include <color_fragment>${DETAIL_APPLY}`);
};
flatMaterial.customProgramCacheKey = () => 'flat-wind-detail';
/**
 * Water: the vertex colour, glossy, with drifting ripples that bend the sun's
 * highlight into glints, darker troughs and pale crests (straight track space,
 * so the pattern flows along the bends with the scenery).
 */
export const waterMaterial = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0x9a9a9a });
waterMaterial.onBeforeCompile = function (shader, renderer) {
  THREE.Material.prototype.onBeforeCompile.call(this, shader, renderer);
  shader.uniforms.windTime = wind;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
varying vec3 vStraight;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
vStraight = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float windTime;
varying vec3 vStraight;
float wHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float wNoise( vec2 x ) {
  vec2 i = floor( x ), f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wHash( i ), wHash( i + vec2( 1, 0 ) ), f.x ), mix( wHash( i + vec2( 0, 1 ) ), wHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
float wHeight( vec2 p ) {
  float t = windTime;
  return wNoise( p * vec2( 0.35, 0.6 ) + vec2( t * 0.12, t * 0.25 ) ) * 0.6
    + wNoise( p * vec2( 1.1, 1.6 ) - vec2( t * 0.3, t * 0.1 ) ) * 0.3
    + wNoise( p * 3.2 + vec2( 0.0, t * 0.6 ) ) * 0.1;
}`)
    .replace('#include <color_fragment>', `#include <color_fragment>
float wh = wHeight( vStraight.xz );
float wFar = smoothstep( 20.0, 90.0, length( vViewPosition ) );
// Troughs deeper, crests paler; further away it calms into a sheen.
diffuseColor.rgb *= mix( 0.82 + wh * 0.34, 1.0, wFar * 0.6 );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0 ), smoothstep( 0.78, 0.92, wh ) * 0.35 * ( 1.0 - wFar ) );`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 e = vec2( 0.15, 0.0 );
  float h0 = wHeight( vStraight.xz );
  vec2 grad = vec2( wHeight( vStraight.xz + e.xy ) - h0, wHeight( vStraight.xz + e.yx ) - h0 ) / e.x;
  vec3 tilt = ( viewMatrix * vec4( - grad.x * 0.35, 0.0, - grad.y * 0.35, 0.0 ) ).xyz;
  normal = normalize( normal + tilt );
}`);
};
waterMaterial.customProgramCacheKey = () => 'water-ripple';

/**
 * Soft light round lamps, lanterns and neon: additive discs facing down the
 * track, bright in the middle and fading to nothing at the rim. They sink into
 * the fog with distance (instead of turning fog-coloured) and are scaled by
 * how dark it is (`haloStrength`, set per zone).
 */
export const haloStrength = { value: 0.2 };
export const haloMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
haloMaterial.onBeforeCompile = function (shader, renderer) {
  THREE.Material.prototype.onBeforeCompile.call(this, shader, renderer);
  shader.uniforms.haloStrength = haloStrength;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float haloStrength;`)
    .replace('#include <fog_fragment>', `gl_FragColor.rgb *= haloStrength;
#ifdef USE_FOG
  gl_FragColor.rgb *= 1.0 - smoothstep( fogNear, fogFar, vFogDepth );
#endif`);
};
haloMaterial.customProgramCacheKey = () => 'halo';

/** Unlit: neon, lanterns, lit windows. */
export const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
export const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });

const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

export type Weight = (x: number, y: number, z: number) => number;

/** Road half-width the roadside scenery is drawn for: three lanes. */
export const SCENE_HALF = LANE_WIDTH * 1.5 + 0.3;
/** Past this |x| a vertex belongs to the roadside (or reaches across the road) and moves out with a wider track. */
const WIDEN_FROM = 3.0;

export class Shapes {
  private parts: THREE.BufferGeometry[] = [];
  /**
   * Scenery is drawn around a three-lane road. With `widen` on, every vertex
   * beyond the road's inner edge is pushed out by the extra width of the real
   * track: kerbs, houses and trees move out whole, and anything spanning the
   * road (the road itself, banners, wires, arches) stretches to fit.
   */
  widen = false;
  private exactDepth = 0;
  private swayW: Weight | null = null;
  private flutterW: Weight | null = null;

  /** Shapes added inside `build` sway in the wind, weighted per vertex (0 = still, 1 = full). */
  swaying(w: Weight, build: () => void): this {
    this.swayW = w;
    build();
    this.swayW = null;
    return this;
  }

  /** Shapes added inside `build` are placed on the real track as given (lane lines, start blocks): never widened. */
  exact(build: () => void): this {
    this.exactDepth++;
    build();
    this.exactDepth--;
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
    const by = this.widen && !this.exactDepth ? TRACK_HALF - SCENE_HALF : 0;
    if (by > 1e-3) {
      const p = g.attributes.position;
      for (let i = 0; i < n; i++) {
        const x = p.getX(i);
        if (Math.abs(x) > WIDEN_FROM) p.setX(i, x + Math.sign(x) * by);
      }
    }
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

  /**
   * A glow disc facing +z (back up the track, toward the camera), rx by ry
   * metres across its half-widths, full colour in the middle, nothing at the rim.
   */
  halo(color: number, x: number, y: number, z: number, rx: number, ry = rx): this {
    return this.haloAt(color, x, y, z, 0, rx, ry);
  }

  /** A glow lying flat on the ground, rx across and rz along the track: light reflected off a wet street. */
  puddle(color: number, x: number, z: number, rx: number, rz: number): this {
    return this.haloAt(color, x, 0.03, z, -Math.PI / 2, rx, rz);
  }

  private haloAt(color: number, x: number, y: number, z: number, rx: number, sx: number, sy: number): this {
    this.add(HALO, color, x, y, z, rx, 0, 0, sx, sy, 1);
    const g = this.parts[this.parts.length - 1];
    const col = g.attributes.color, fall = g.attributes.fall;
    for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * fall.getX(i), col.getY(i) * fall.getX(i), col.getZ(i) * fall.getX(i));
    g.deleteAttribute('fall');
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

// Unit glow disc: a centre, an inner ring at 30% radius and the rim, with a
// falloff weight per vertex (1, 0.4, 0) so the colour fades out smoothly.
const HALO = (() => {
  const n = 14, pos: number[] = [], fall: number[] = [];
  const ring = (r: number, i: number) => [Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r, 0];
  const push = (p: number[], f: number) => { pos.push(...p); fall.push(f); };
  for (let i = 0; i < n; i++) {
    push([0, 0, 0], 1); push(ring(0.3, i), 0.4); push(ring(0.3, i + 1), 0.4);
    push(ring(0.3, i), 0.4); push(ring(1, i), 0); push(ring(1, i + 1), 0);
    push(ring(0.3, i), 0.4); push(ring(1, i + 1), 0); push(ring(0.3, i + 1), 0.4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('fall', new THREE.Float32BufferAttribute(fall, 1));
  return g;
})();
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
