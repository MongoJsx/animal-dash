// A colour grade with no extra pass: every material's last step (the colour
// space conversion) first gives its colour a little more saturation, the
// already-colourful parts less, so the scene reads bright and toy-like
// without neon skin or skies.
import * as THREE from 'three';

const SATURATION = 1.22;

let installed = false;

/** Patch three's shader chunks once, before anything is compiled. */
export function installGrade() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.colorspace_fragment = /* glsl */ `
{
  vec3 c = gl_FragColor.rgb;
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  float chroma = max( c.r, max( c.g, c.b ) ) - min( c.r, min( c.g, c.b ) );
  // Vibrance: muted colours get the full boost, vivid ones hardly any.
  float k = 1.0 + ( ${SATURATION.toFixed(2)} - 1.0 ) * ( 1.0 - smoothstep( 0.0, 0.6, chroma ) );
  gl_FragColor.rgb = max( mix( vec3( l ), c, k ), 0.0 );
}
` + C.colorspace_fragment;
}
