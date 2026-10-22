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

/** Loot glow behind a box: a soft gold halo with light rays (turned per box). */
function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.translate(128, 128);
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, 128);
  glow.addColorStop(0, 'rgba(255,240,170,0.95)');
  glow.addColorStop(0.3, 'rgba(255,200,60,0.45)');
  glow.addColorStop(1, 'rgba(255,170,0,0)');
  g.fillStyle = glow;
  g.fillRect(-128, -128, 256, 256);
  const rays = g.createRadialGradient(0, 0, 10, 0, 0, 128);
  rays.addColorStop(0, 'rgba(255,250,220,0.8)');
  rays.addColorStop(1, 'rgba(255,220,120,0)');
  g.fillStyle = rays;
  for (let i = 0; i < 12; i++) {
    g.rotate((Math.PI * 2) / 12);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(-9, 128);
    g.lineTo(9, 128);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft round shadow under a hovering box. */
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.45)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class ItemBoxes {
  readonly mesh: THREE.InstancedMesh;
  /** Halo behind each box and its shadow on the ground (children of `mesh`). */
  private halo: THREE.InstancedMesh;
  private shadow: THREE.InstancedMesh;
  private boxes: ItemBox[];

  constructor(boxes: ItemBox[]) {
    this.boxes = boxes;
    const n = Math.max(1, boxes.length);
    const mat = new THREE.MeshLambertMaterial({ map: questionTexture(), emissive: 0x553300 });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(SIZE, SIZE, SIZE), mat, n);
    this.mesh.count = boxes.length;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    // The halo faces back down the track, where the runners (and camera) come from.
    this.halo = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: haloTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), n);
    this.shadow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }), n);
    for (const m of [this.halo, this.shadow]) {
      m.count = boxes.length;
      m.frustumCulled = false;
      this.mesh.add(m);
    }
  }

  /** `taken`: boxes the local player already took (hidden for them). */
  update(t: number, viewD: number, taken: Set<number>) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    (this.mesh.material as THREE.MeshLambertMaterial).emissive.setRGB(0.32 + pulse * 0.25, 0.2 + pulse * 0.14, 0.02);
    this.boxes.forEach((b, i) => {
      if (taken.has(b.id) || b.d < viewD - VIEW_BEHIND || b.d > viewD + VIEW_AHEAD) {
        this.mesh.setMatrixAt(i, HIDDEN);
        this.halo.setMatrixAt(i, HIDDEN);
        this.shadow.setMatrixAt(i, HIDDEN);
        return;
      }
      const bob = Math.sin(t * 3 + b.id) * 0.14;
      // Spins on a tilted axis and breathes a little.
      _q.setFromEuler(_e.set(0.45 + Math.sin(t * 1.3 + b.id) * 0.15, t * 2.2 + b.id, 0.3));
      _p.set(laneX(b.lane), ITEM.boxY + bob, -b.d);
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(1 + Math.sin(t * 5 + b.id * 1.7) * 0.05)));
      _q.setFromEuler(_e.set(0, 0, t * 0.6 + b.id));
      _p.z -= 0.55;
      this.halo.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(2.3 + pulse * 0.25)));
      _q.identity();
      _p.set(laneX(b.lane), 0.03, -b.d);
      this.shadow.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(1.1 - bob * 0.8)));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
    this.shadow.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const m of [this.mesh, this.halo, this.shadow]) {
      m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
      m.dispose();
    }
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
    // Flat on the back of a runner flying face down (the 'fly' pose), nose
    // forward and the flames trailing behind (+z is behind them).
    this.root.position.set(x, y + 1.2, -d - 0.2);
    this.root.rotation.x = -Math.PI / 2;
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
