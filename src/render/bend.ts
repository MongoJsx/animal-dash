// Bends the whole straight race strip along the TrackPath in the vertex
// shader. Every built-in material (shadow depth passes included) goes through
// the patched chunks, so obstacles, scenery, characters and their shadows all
// follow the curves while gameplay stays on straight lines. Materials with a
// NO_BEND define (sky, backdrop) are drawn in plain world space.
import * as THREE from 'three';
import { PATH_PRE, PATH_SAMPLES, PATH_TEX_W, type TrackPath } from '../world/path.ts';

const rows = Math.ceil(PATH_SAMPLES / PATH_TEX_W);
const texData = new Float32Array(PATH_TEX_W * rows * 4);
const texture = new THREE.DataTexture(texData, PATH_TEX_W, rows, THREE.RGBAFormat, THREE.FloatType);
texture.minFilter = texture.magFilter = THREE.NearestFilter;
texture.generateMipmaps = false;
const bendUniform = { value: texture };

// Straight until a path is set.
for (let i = 0; i < PATH_SAMPLES; i++) texData[i * 4 + 2] = -(i - PATH_PRE);
texture.needsUpdate = true;

export function setBendPath(path: TrackPath) {
  texData.set(path.data);
  texture.needsUpdate = true;
}

const HEADER = /* glsl */ `
#ifndef NO_BEND
uniform highp sampler2D bendMap;
vec4 bendTexel( int i ) {
  return texelFetch( bendMap, ivec2( i % ${PATH_TEX_W}, i / ${PATH_TEX_W} ), 0 );
}
// Centre-line frame (x, y, z, yaw) at track distance d, extrapolated straight.
vec4 bendFrame( float d, out float extra ) {
  float f = d + ${PATH_PRE.toFixed(1)};
  float c = clamp( f, 0.0, ${(PATH_SAMPLES - 1.001).toFixed(3)} );
  extra = f - c;
  int i = int( floor( c ) );
  return mix( bendTexel( i ), bendTexel( i + 1 ), c - floor( c ) );
}
vec3 bendPoint( vec3 p ) {
  float extra;
  vec4 f = bendFrame( - p.z, extra );
  float c = cos( f.w ), s = sin( f.w );
  return vec3( f.x + p.x * c - s * extra, f.y + p.y, f.z - p.x * s - c * extra );
}
vec3 bendNormal( vec3 n, float z ) {
  float extra;
  float yaw = bendFrame( - z, extra ).w;
  float c = cos( yaw ), s = sin( yaw );
  return vec3( n.x * c + n.z * s, n.y, - n.x * s + n.z * c );
}
#endif
`;

let installed = false;

/** Patch three's shader chunks once, before anything is compiled. */
export function installBend() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.common += HEADER;

  C.project_vertex = C.project_vertex.replace(
    'mvPosition = modelViewMatrix * mvPosition;',
    `#ifdef NO_BEND
	mvPosition = modelViewMatrix * mvPosition;
#else
	mvPosition = modelMatrix * mvPosition;
	mvPosition.xyz = bendPoint( mvPosition.xyz );
	mvPosition = viewMatrix * mvPosition;
#endif`,
  );

  C.worldpos_vertex = C.worldpos_vertex.replace(
    'worldPosition = modelMatrix * worldPosition;',
    `worldPosition = modelMatrix * worldPosition;
#ifndef NO_BEND
	worldPosition.xyz = bendPoint( worldPosition.xyz );
#endif`,
  );

  // Normals turn with the road: world-space yaw at this vertex.
  C.defaultnormal_vertex = C.defaultnormal_vertex.replace(
    'transformedNormal = normalMatrix * transformedNormal;',
    `transformedNormal = normalMatrix * transformedNormal;
#ifndef NO_BEND
	{
		vec4 bendW = vec4( position, 1.0 );
		#ifdef USE_INSTANCING
			bendW = instanceMatrix * bendW;
		#endif
		bendW = modelMatrix * bendW;
		mat3 viewRot = mat3( viewMatrix );
		transformedNormal = viewRot * bendNormal( transpose( viewRot ) * transformedNormal, bendW.z );
	}
#endif`,
  );

  // Every material shares the one path texture.
  THREE.Material.prototype.onBeforeCompile = function (shader: THREE.WebGLProgramParametersWithUniforms) {
    shader.uniforms.bendMap = bendUniform;
  };
}

/** Mark a material as drawn in world space (sky dome, distant backdrop). */
export function noBend<M extends THREE.Material>(m: M): M {
  m.defines = { ...(m.defines ?? {}), NO_BEND: '' };
  return m;
}
