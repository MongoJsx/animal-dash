// Character model + animation. Rigged characters play the shared Mixamo clip
// set (/assets/characters/anims.glb) with crossfades; without clips a rigged
// model is animated in code (rig.ts), and an unrigged one gets a simple bob.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { Stats } from '../config.ts';
import { assetUrl } from '../core/asset.ts';
import { ProcRig, type RigStyle } from './rig.ts';

export interface CharacterDef {
  id: string;
  name: string;
  model: string;
  anim?: RigStyle;
  stats?: Stats;
}

export type AnimState =
  | 'idle' | 'run' | 'jump' | 'slide' | 'stumble' | 'fall'
  | 'strafe_left' | 'strafe_right' | 'victory' | 'defeat'
  | 'marks' | 'set' | 'burst' // sprint start: on your marks, set, drive out
  | 'fly'; // on a rocket pack: lying flat, one fist forward

const ONE_SHOT: AnimState[] = ['jump', 'slide', 'stumble', 'fall', 'strafe_left', 'strafe_right', 'burst'];
const HEIGHT = 1.7;
const RUN_CLIP_SPEED = 9; // m/s the run clip looks right at

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const modelCache = new Map<string, Promise<GLTF>>();
let clipsPromise: Promise<{ clips: THREE.AnimationClip[]; hipsHeight: number } | null> | null = null;

const BLOB = new THREE.CircleGeometry(0.45, 16).rotateX(-Math.PI / 2);
const BLOB_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });

const normBone = (name: string) => name.replace(/^mixamorig\d*:?/, 'mixamorig');

export async function loadCharacters(): Promise<CharacterDef[]> {
  const res = await fetch(assetUrl('/assets/characters/characters.json'));
  return res.json();
}

function loadModel(url: string) {
  let p = modelCache.get(url);
  if (!p) {
    p = loader.loadAsync(assetUrl(url));
    modelCache.set(url, p);
  }
  return p;
}

/** Start fetching every runner so the start line is full when the race begins. */
export function preloadCharacters(defs: CharacterDef[]) {
  for (const d of defs) loadModel(d.model).catch(() => {});
}

/** Shared Mixamo clips, or null until animations have been made. */
function loadClips() {
  clipsPromise ??= loader.loadAsync(assetUrl('/assets/characters/anims.glb')).then(
    (gltf) => {
      let hipsHeight = 1;
      gltf.scene.traverse((o) => {
        if (normBone(o.name) === 'mixamorigHips') hipsHeight = o.position.y || 1;
      });
      const clips = gltf.animations.map((clip) => {
        const c = clip.clone();
        c.tracks = c.tracks.filter((t) => {
          t.name = normBone(t.name);
          // Only the hips may move; everything else is rotation.
          return !t.name.endsWith('.scale') && (!t.name.endsWith('.position') || t.name.startsWith('mixamorigHips.'));
        });
        return c;
      });
      return { clips, hipsHeight };
    },
    () => null,
  );
  return clipsPromise;
}

export class CharacterView {
  readonly root = new THREE.Group();
  private pivot = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private rig: ProcRig | null = null;
  private actions = new Map<AnimState, THREE.AnimationAction>();
  private current: AnimState | null = null;
  private phase = Math.random() * 10;
  private procedural: AnimState = 'idle';
  private procTime = 0;
  private lean = 0;
  private kickRoll = 0;
  readonly ready: Promise<void>;

  private materials: THREE.Material[] = [];
  private opacity = 1;

  private castShadow: boolean;

  constructor(def: CharacterDef, opts: { castShadow?: boolean } = {}) {
    this.castShadow = opts.castShadow ?? true;
    this.root.add(this.pivot);
    if (!this.castShadow) {
      const blob = new THREE.Mesh(BLOB, BLOB_MATERIAL);
      blob.position.y = 0.02;
      this.root.add(blob);
    }
    this.ready = this.load(def);
  }

  /** Jolt from a shoulder bump or a ram: the body rocks with the push. */
  kick(dir: number) {
    this.kickRoll = 0.38 * Math.sign(dir);
  }

  /** Fade out (e.g. a rival between the camera and the player). */
  setOpacity(target: number, dt: number) {
    this.opacity += (target - this.opacity) * Math.min(1, dt * 10);
    const transparent = this.opacity < 0.98;
    for (const m of this.materials) {
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = this.opacity;
      m.depthWrite = !transparent;
    }
  }

  private async load(def: CharacterDef) {
    const [gltf, anim] = await Promise.all([loadModel(def.model), loadClips()]);
    const model = SkeletonUtils.clone(gltf.scene);

    // Stand it on the ground, 1.7 m tall, facing down the track (-z).
    model.rotation.y = Math.PI;
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    if (size.z > size.y && size.z >= size.x) {
      model.rotation.x = -Math.PI / 2;
      model.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(model);
    }
    model.scale.multiplyScalar(HEIGHT / box.getSize(new THREE.Vector3()).y);
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    model.position.x -= c.x;
    model.position.z -= c.z;
    model.position.y -= box.min.y;

    let hips: THREE.Object3D | null = null;
    model.traverse((o) => {
      o.name = normBone(o.name);
      if (o.name === 'mixamorigHips') hips = o;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = this.castShadow;
        mesh.frustumCulled = false; // skinned bounds don't follow the animation
        // Own material copies so this character can fade without touching others.
        const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => m.clone());
        mesh.material = mats.length === 1 ? mats[0] : mats;
        this.materials.push(...mats);
      }
    });
    this.pivot.add(model);

    if (anim && hips) {
      const ratio = (hips as THREE.Object3D).position.y / anim.hipsHeight;
      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of anim.clips) {
        const c = clip.clone();
        for (const t of c.tracks) {
          if (t.name === 'mixamorigHips.position') {
            // Different body proportions: scale the hip bob to this rig.
            t.values = t.values.map((v) => v * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1));
          }
        }
        const action = this.mixer.clipAction(c);
        if (ONE_SHOT.includes(c.name as AnimState)) {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        this.actions.set(c.name as AnimState, action);
      }
    } else if (hips && ProcRig.detect(model)) {
      // Undo any stand-in pose applied while loading before measuring the rig.
      this.pivot.position.set(0, 0, 0);
      this.pivot.rotation.set(0, 0, 0);
      this.pivot.scale.set(1, 1, 1);
      this.rig = new ProcRig(model, this.pivot, def.anim);
    }
    this.play(this.current ?? 'idle', 0);
  }

  get rigged() {
    return this.actions.size > 0 || this.rig !== null;
  }

  /** Switch animation. `duration` fits one-shots to gameplay time (e.g. air time). */
  play(state: AnimState, duration = 0, fade = 0.12) {
    const restart = ONE_SHOT.includes(state);
    if (state === this.current && !restart) return;
    this.current = state;
    this.procedural = state;
    this.procTime = 0;
    this.rig?.play(state, duration);
    if (!this.mixer) return;
    const next = this.actions.get(state) ?? this.actions.get(state.startsWith('strafe') || state === 'burst' ? 'run' : 'idle');
    if (!next) return;
    for (const a of this.actions.values()) if (a !== next) a.fadeOut(fade);
    next.reset();
    next.setEffectiveWeight(1);
    next.timeScale = duration > 0 ? next.getClip().duration / duration : 1;
    next.fadeIn(fade).play();
  }

  get state() {
    return this.current;
  }

  update(dt: number, speed: number, laneVelocity: number) {
    // Lean into lane changes for both rigged and unrigged characters.
    this.lean += (-laneVelocity * 0.06 - this.lean) * Math.min(1, dt * 12);
    this.kickRoll *= Math.exp(-dt * 7);
    this.pivot.rotation.z = this.lean + this.kickRoll;

    if (this.mixer || this.rig) {
      // The stand-in pose only applies to unrigged models.
      this.pivot.position.set(0, 0, 0);
      this.pivot.rotation.x = this.pivot.rotation.y = 0;
      this.pivot.scale.set(1, 1, 1);
    }
    if (this.mixer) {
      const run = this.actions.get('run');
      if (run && this.current === 'run') run.timeScale = THREE.MathUtils.clamp(speed / RUN_CLIP_SPEED, 0.8, 1.8);
      this.mixer.update(dt);
      return;
    }
    if (this.rig) {
      this.rig.update(dt, speed, laneVelocity);
      return;
    }
    this.proceduralPose(dt, speed);
  }

  private proceduralPose(dt: number, speed: number) {
    const p = this.pivot;
    this.procTime += dt;
    this.phase += dt * Math.max(4, speed * 0.75);
    p.position.set(0, 0, 0);
    p.rotation.x = 0;
    p.rotation.y = 0;
    p.scale.set(1, 1, 1);
    switch (this.procedural) {
      case 'run':
      case 'burst':
      case 'strafe_left':
      case 'strafe_right':
        p.position.y = Math.abs(Math.sin(this.phase)) * 0.14;
        p.rotation.x = this.procedural === 'burst' ? -0.5 * Math.max(0, 1 - this.procTime) - 0.12 : -0.12;
        p.rotation.y = Math.sin(this.phase) * 0.12;
        break;
      case 'marks':
        p.rotation.x = -0.9;
        p.position.y = -0.35;
        break;
      case 'set':
        p.rotation.x = -1.05;
        p.position.y = -0.2;
        break;
      case 'jump': {
        const k = Math.min(1, this.procTime / 0.35);
        p.rotation.x = -0.25 * Math.sin(k * Math.PI);
        p.scale.set(1 + 0.08 * (1 - k), 1 - 0.12 * (1 - k), 1);
        break;
      }
      case 'slide':
        p.rotation.x = 1.15;
        p.position.set(0, 0.25, 0.6);
        break;
      case 'stumble':
      case 'fall': {
        const k = Math.min(1, this.procTime / 0.9);
        p.rotation.x = -Math.sin(k * Math.PI) * 0.9;
        p.position.y = Math.sin(k * Math.PI) * 0.3;
        break;
      }
      case 'victory':
        p.position.y = Math.abs(Math.sin(this.procTime * 6)) * 0.5;
        p.rotation.y = this.procTime * 4;
        break;
      case 'defeat':
        p.rotation.x = 0.3;
        break;
      case 'fly':
        p.rotation.x = -1.35;
        p.position.set(0, 0.9, -0.2);
        break;
      default:
        p.position.y = Math.sin(this.procTime * 2) * 0.02;
    }
  }
}
