// Dev page (anim-lab.html): every character side by side running the real
// CharacterView animation, with the ground scrolling at race speed.
// Buttons switch state / camera / speed / slow motion. Jumps and slides move
// the body like the game does, so timing can be judged in context.
// Capture mode for screenshots: ?capture&state=run&phase=0.25&speed=18&cam=side&char=luobotu
// (one-shots take &t=0.4 as a fraction of their duration).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLAYER } from '../config.ts';
import { CharacterView, loadCharacters, type AnimState } from '../render/character.ts';
import { RocketPack } from '../render/itemView.ts';
import type { ProcRig } from '../render/rig.ts';

const params = new URLSearchParams(location.search);
const capture = params.has('capture');
if (capture) document.body.classList.add('capture');

const STATES: AnimState[] = ['idle', 'run', 'jump', 'slide', 'stumble', 'fall', 'victory', 'defeat', 'marks', 'set', 'burst', 'fly'];
const airTime = (v: number) => (2 * v) / PLAYER.gravity;
const DURATION: Partial<Record<AnimState, number>> = { jump: airTime(PLAYER.jumpVelocity), slide: PLAYER.slideTime, stumble: 0.9, fall: 0.8, burst: 1.25 };
const SPACING = 1.7;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: capture });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x20232a);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 8, 3);
sun.castShadow = true;
sun.shadow.camera.left = sun.shadow.camera.bottom = -8;
sun.shadow.camera.right = sun.shadow.camera.top = 8;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

// Striped ground that scrolls toward the camera at the running speed.
const stripes = document.createElement('canvas');
stripes.width = 64;
stripes.height = 64;
const g2 = stripes.getContext('2d')!;
g2.fillStyle = '#3a3f4b';
g2.fillRect(0, 0, 64, 64);
g2.fillStyle = '#454b59';
g2.fillRect(0, 0, 64, 32);
const tex = new THREE.CanvasTexture(stripes);
tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
tex.repeat.set(1, 30);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 60), new THREE.MeshStandardMaterial({ map: tex }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);

let chars = await loadCharacters();
if (params.get('char')) chars = chars.filter((c) => c.id === params.get('char'));
const views = chars.map((def) => {
  const v = new CharacterView(def);
  scene.add(v.root);
  return v;
});
await Promise.all(views.map((v) => v.ready));
// The rocket pack rides on the back in the 'fly' pose, as in the game.
const packs = views.map(() => { const r = new RocketPack(); scene.add(r.root); return r; });
const syncPacks = (dt: number) => views.forEach((v, i) =>
  packs[i].update(state === 'fly', v.root.position.x, v.root.position.y, -v.root.position.z, dt));

const span = (chars.length - 1) * SPACING;
// Side view lines the runners up front to back so none hides another.
const layout = (alongZ: boolean) => views.forEach((v, i) => {
  const o = (i - (chars.length - 1) / 2) * SPACING * (alongZ ? 1.2 : 1);
  v.root.position.x = alongZ ? 0 : o;
  v.root.position.z = alongZ ? o : 0;
});
const look = (x: number, y: number, z: number, tx: number, ty: number, tz: number, alongZ = false) => {
  layout(alongZ);
  camera.position.set(x, y, z);
  controls.target.set(tx, ty, tz);
  camera.lookAt(controls.target);
};
const CAMS: Record<string, () => void> = {
  side: () => look(span * 1.6 + 3, 0.95, 0, 0, 0.85, 0, true),
  front: () => look(0, 1.2, -4 - span * 1.1, 0, 0.85, 0),
  three: () => look(2 + span * 0.7, 1.6, -2 - span * 0.8, 0, 0.85, 0),
  chase: () => look(0, 2.6, 4 + span * 0.6, 0, 1.0, -4),
};

let state: AnimState = (params.get('state') as AnimState) ?? 'run';
let speed = Number(params.get('speed') ?? 16);
let slow = 1;
let loop = true;
let t = 0;
let lane = 0;
let laneX = 0;

function play(s: AnimState) {
  state = s;
  t = 0;
  for (const v of views) v.play(s, DURATION[s] ?? 0);
}

// ── UI ──
const ui = document.getElementById('ui')!;
const button = (label: string, on: () => boolean, click: () => void) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => { click(); refresh(); };
  ui.append(b);
  return () => b.classList.toggle('on', on());
};
const refreshers: (() => void)[] = [];
const refresh = () => refreshers.forEach((r) => r());
for (const s of STATES) refreshers.push(button(s, () => state === s, () => play(s)));
refreshers.push(button('↔ lane', () => false, () => { lane = lane === 0 ? 1 : lane === 1 ? -1 : 0; }));
refreshers.push(button('loop', () => loop, () => { loop = !loop; }));
for (const s of [1, 0.25, 0.1]) refreshers.push(button(`×${s}`, () => slow === s, () => { slow = s; }));
let cam = params.get('cam') ?? 'three';
for (const c of Object.keys(CAMS)) refreshers.push(button(c, () => cam === c, () => { cam = c; CAMS[c](); }));
const speedLabel = document.createElement('label');
const slider = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '24', step: '0.5', value: String(speed) });
slider.oninput = () => { speed = Number(slider.value); speedLabel.lastChild!.textContent = ` ${speed} m/s`; };
speedLabel.append('speed ', slider, ` ${speed} m/s`);
ui.append(speedLabel);
CAMS[cam]();
refresh();

const rigOf = (v: CharacterView) => (v as unknown as { rig: ProcRig | null }).rig;

function step(dt: number) {
  t += dt;
  const dur = DURATION[state];
  // Body motion the game would add: jump arc, lane change.
  const prevX = laneX;
  laneX += (lane * 1.2 - laneX) * Math.min(1, dt * 14);
  const laneV = (laneX - prevX) / Math.max(dt, 1e-4);
  // (Capture keeps the body on the ground so a fixed camera can frame it.)
  const y = state === 'jump' && !capture ? Math.max(0, PLAYER.jumpVelocity * t - (PLAYER.gravity * t * t) / 2) : 0;
  for (const v of views) {
    v.root.position.y = y;
    v.update(dt, state === 'idle' || state === 'victory' || state === 'defeat' ? 0 : speed, laneV);
  }
  if (dur && t >= dur) {
    if (loop) {
      state = 'run';
      for (const v of views) v.play('run');
      setTimeout(() => { if (loop && state === 'run') play(STATES.find((s) => s === (params.get('state') as AnimState)) ?? 'jump'); }, 900);
    }
    refresh();
  }
  tex.offset.y += (speed * dt * (state === 'idle' ? 0 : 1)) / 2;
}

if (capture) {
  // Deterministic frame: settle at speed, then jump straight to the requested moment.
  const still = state === 'idle' || state === 'victory' || state === 'defeat';
  for (const v of views) v.play(still ? 'idle' : 'run');
  for (let i = 0; i < 120; i++) for (const v of views) v.update(1 / 60, speed, 0);
  const dur = DURATION[state];
  if (dur) {
    play(state);
    const target = Number(params.get('t') ?? 0.5) * dur;
    while (t < target) step(1 / 120);
  } else {
    if (state !== 'run') {
      play(state);
      while (t < 0.3 + Number(params.get('t') ?? 0) * 2) step(1 / 120);
    }
    for (const v of views) {
      const rig = rigOf(v);
      if (rig) rig.phase = Number(params.get('phase') ?? 0);
      v.update(0, speed, 0);
    }
  }
  syncPacks(0);
  renderer.render(scene, camera);
  Object.assign(window, { __ready: true });
} else {
  play(state);
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    step(Math.min(0.05, clock.getDelta()) * slow);
    controls.update();
    syncPacks(1 / 60);
    renderer.render(scene, camera);
  });
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
