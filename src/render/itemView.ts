// Item boxes (one instanced mesh: spinning, bobbing "?" cubes) and the shield
// bubble drawn around a runner. Laid out in track space like everything else.
import * as THREE from 'three';
import { ITEM, VIEW_AHEAD, VIEW_BEHIND, laneX } from '../config.ts';
import type { ItemBox } from '../world/items.ts';

const SIZE = 0.85;

function questionTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, '#ffe066');
  grad.addColorStop(0.5, '#ff9f1c');
  grad.addColorStop(1, '#ff5d8f');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#fff';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 118, 118);
  g.fillStyle = '#fff';
  g.font = 'bold 92px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#0006';
  g.shadowBlur = 6;
  g.fillText('?', 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class ItemBoxes {
  readonly mesh: THREE.InstancedMesh;
  private boxes: ItemBox[];

  constructor(boxes: ItemBox[]) {
    this.boxes = boxes;
    const mat = new THREE.MeshLambertMaterial({ map: questionTexture(), emissive: 0x553300, transparent: true, opacity: 0.92 });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(SIZE, SIZE, SIZE), mat, Math.max(1, boxes.length));
    this.mesh.count = boxes.length;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }

  /** `taken`: boxes the local player already took (hidden for them). */
  update(t: number, viewD: number, taken: Set<number>) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    (this.mesh.material as THREE.MeshLambertMaterial).emissive.setRGB(0.25 + pulse * 0.2, 0.15 + pulse * 0.1, 0);
    this.boxes.forEach((b, i) => {
      if (taken.has(b.id) || b.d < viewD - VIEW_BEHIND || b.d > viewD + VIEW_AHEAD) {
        this.mesh.setMatrixAt(i, HIDDEN);
        return;
      }
      _q.setFromEuler(_e.set(0.35, t * 1.8 + b.id, 0.2));
      _p.set(laneX(b.lane), ITEM.boxY + Math.sin(t * 3 + b.id) * 0.12, -b.d);
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(1)));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    const mat = this.mesh.material as THREE.MeshLambertMaterial;
    mat.map?.dispose();
    mat.dispose();
    this.mesh.dispose();
  }
}

/** Rocket strapped to a flying runner's back, flame flickering underneath. */
export class RocketPack {
  readonly root = new THREE.Group();
  private flame: THREE.Mesh;
  private t = 0;

  constructor() {
    const body = new THREE.MeshLambertMaterial({ color: 0xe8e8f0 });
    const red = new THREE.MeshLambertMaterial({ color: 0xe23b3b });
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      this.root.add(mesh);
      return mesh;
    };
    for (const x of [-0.13, 0.13]) {
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.55, 12), body, x, 0, 0);
      add(new THREE.ConeGeometry(0.1, 0.22, 12), red, x, 0.385, 0);
      add(new THREE.CylinderGeometry(0.07, 0.11, 0.1, 12), red, x, -0.32, 0);
    }
    add(new THREE.BoxGeometry(0.2, 0.3, 0.06), red, 0, 0.02, -0.07); // strap plate
    const fire = new THREE.ConeGeometry(0.09, 0.6, 10).rotateX(Math.PI).translate(0, -0.3, 0);
    this.flame = new THREE.Mesh(fire, new THREE.MeshBasicMaterial({ color: 0xffa21f, transparent: true, opacity: 0.9 }));
    this.flame.position.y = -0.37;
    const second = this.flame.clone();
    this.flame.position.x = -0.13;
    second.position.x = 0.13;
    this.root.add(this.flame, second);
    this.root.scale.setScalar(0.7); // small enough not to hide a slim runner from the chase camera
    this.root.visible = false;
  }

  update(on: boolean, x: number, y: number, d: number, dt: number) {
    this.root.visible = on;
    if (!on) return;
    this.t += dt;
    const f = 0.8 + Math.sin(this.t * 47) * 0.15 + Math.random() * 0.2;
    for (const c of this.root.children.slice(-2)) c.scale.set(1, f, 1);
    // On the back (+z is behind a runner heading down the track).
    this.root.position.set(x, y + 1.1, -d + 0.24);
  }
}

const iconTextures = new Map<string, THREE.CanvasTexture>();

/** An emoji on a white disc, drawn once per icon. */
function iconTexture(icon: string) {
  let tex = iconTextures.get(icon);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fffffff0';
  g.strokeStyle = '#ff9f1c';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.font = '72px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(icon, 64, 70);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  iconTextures.set(icon, tex);
  return tex;
}

/**
 * The held item floating over a runner's head. Sprites skip the bend shader,
 * so it is placed at an already-bent world position.
 */
export class ItemTag {
  readonly sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, fog: false }));
  private icon = '';
  private t = Math.random() * 10;

  constructor() {
    this.sprite.visible = false;
    this.sprite.scale.setScalar(0.62);
    this.sprite.renderOrder = 5;
  }

  /** `icon`: what to show, or '' for nothing; `at`: the top of the head, in world space. */
  update(icon: string, at: THREE.Vector3, dt: number) {
    this.sprite.visible = !!icon;
    if (!icon) return;
    if (icon !== this.icon) {
      this.icon = icon;
      this.sprite.material.map = iconTexture(icon);
      this.sprite.material.needsUpdate = true;
    }
    this.t += dt;
    this.sprite.position.copy(at).y += 0.45 + Math.sin(this.t * 4) * 0.06;
  }
}

const bubbleGeo = new THREE.SphereGeometry(1, 20, 14);
const bubbleMat = new THREE.MeshLambertMaterial({ color: 0x7ae0ff, emissive: 0x2277aa, transparent: true, opacity: 0.28, depthWrite: false });

/** See-through bubble around a shielded runner. */
export class Bubble {
  readonly mesh = new THREE.Mesh(bubbleGeo, bubbleMat);
  private t = 0;

  constructor() {
    this.mesh.visible = false;
    this.mesh.scale.set(0.8, 1.05, 0.8);
  }

  update(on: boolean, x: number, y: number, d: number, dt: number) {
    this.mesh.visible = on;
    if (!on) return;
    this.t += dt;
    const w = 1 + Math.sin(this.t * 7) * 0.04;
    this.mesh.scale.set(0.8 * w, 1.05 / w, 0.8 * w);
    this.mesh.position.set(x, y + 0.9, -d);
  }
}
