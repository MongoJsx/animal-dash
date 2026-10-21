// Victory ceremony after the race: a three-step podium with a sponsor-style
// backdrop, confetti, and medals that drop onto each runner's chest and then
// ride along with the chest bone. Built in straight track space like
// everything else, so the bend shader puts it on the curve.
import * as THREE from 'three';
import type { CharacterView } from './character.ts';

const STEP_W = 1.22;
const STEP_D = 1.3;
const HEIGHTS = [0.95, 0.66, 0.42];
/** x of each place; the camera looks back down the track, so +x is screen left. */
const STEP_X = [0, STEP_W + 0.02, -(STEP_W + 0.02)];
const FOURTH_X = -2.85;
const METAL = [0xffc93c, 0xd9dee8, 0xd9894a];
const METAL_DARK = ['#a86b00', '#7b8494', '#8a4a1c'];
const METAL_LIGHT = ['#fff1a8', '#ffffff', '#ffd2a8'];
const MEDAL_DROP = [2.1, 1.45, 0.8]; // 3rd, then 2nd, then the champion
const DROP_TIME = 0.55;

const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

const FONT = `'Kanit', system-ui, sans-serif`;

function stepFront(place: number) {
  return canvasTex(256, 256 * (HEIGHTS[place] / STEP_W) * 1.0 + 1, (g) => {
    const { width: w, height: h } = g.canvas;
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#2b3f7a');
    bg.addColorStop(1, '#16224a');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // Metal band along the top edge.
    g.fillStyle = METAL_LIGHT[place];
    g.fillRect(0, 0, w, 10);
    // The number.
    const size = Math.min(h * 0.78, 170);
    g.font = `900 ${size}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const grad = g.createLinearGradient(0, h / 2 - size / 2, 0, h / 2 + size / 2);
    grad.addColorStop(0, METAL_LIGHT[place]);
    grad.addColorStop(0.55, `#${METAL[place].toString(16).padStart(6, '0')}`);
    grad.addColorStop(1, METAL_DARK[place]);
    g.lineWidth = 10;
    g.strokeStyle = '#0d1530';
    g.strokeText(String(place + 1), w / 2, h / 2 + 8);
    g.fillStyle = grad;
    g.fillText(String(place + 1), w / 2, h / 2 + 8);
  });
}

function backdropTex() {
  return canvasTex(1024, 512, (g) => {
    const w = 1024, h = 512;
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#1d3c8f');
    bg.addColorStop(1, '#0f1d4a');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // Sponsor-wall pattern.
    g.save();
    g.globalAlpha = 0.13;
    g.fillStyle = '#ffffff';
    g.font = `800 26px ${FONT}`;
    g.textAlign = 'center';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 6; col++) {
        const x = col * 220 + (row % 2 ? 110 : 0);
        g.font = row % 2 ? `700 20px ${FONT}` : `800 28px ${FONT}`;
        g.fillText(row % 2 ? 'วิ่งซิ่งข้ามโลก' : '★ วิ่งสุดใจ ★', x, 44 + row * 60);
      }
    }
    g.restore();
    // Rays from behind the champion.
    g.save();
    g.translate(w / 2, h * 0.95);
    for (let i = 0; i < 18; i++) {
      g.rotate(Math.PI / 18);
      g.fillStyle = i % 2 ? '#ffffff10' : '#ffd16614';
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(-60, -900);
      g.lineTo(60, -900);
      g.fill();
    }
    g.restore();
    // Checkered strip and title.
    const sq = 24;
    for (let x = 0; x < w / sq; x++) for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      g.fillRect(x * sq, h - sq * 2 + y * sq, sq, sq);
    }
  });
}

function medalFace(place: number) {
  return canvasTex(128, 128, (g) => {
    const c = 64;
    const grad = g.createRadialGradient(c - 18, c - 22, 6, c, c, 64);
    grad.addColorStop(0, METAL_LIGHT[place]);
    grad.addColorStop(0.6, `#${METAL[place].toString(16).padStart(6, '0')}`);
    grad.addColorStop(1, METAL_DARK[place]);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(c, c, 63, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = METAL_DARK[place];
    g.lineWidth = 6;
    g.beginPath();
    g.arc(c, c, 50, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = METAL_DARK[place];
    g.font = `900 64px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(place + 1), c, c + 4);
  });
}

function ribbonTex() {
  return canvasTex(32, 8, (g) => {
    g.fillStyle = '#e63946';
    g.fillRect(0, 0, 32, 8);
    g.fillStyle = '#ffffff';
    g.fillRect(11, 0, 10, 8);
    g.fillStyle = '#1d3c8f';
    g.fillRect(14, 0, 4, 8);
  });
}

const DISC = new THREE.CylinderGeometry(0.12, 0.12, 0.028, 40).rotateX(Math.PI / 2);
const FACE = new THREE.CircleGeometry(0.105, 40).rotateY(Math.PI);
const RIBBON = new THREE.BoxGeometry(0.05, 1, 0.006).translate(0, -0.5, 0);

interface Medal {
  place: number;
  obj: THREE.Group;
  view: CharacterView;
  bone: THREE.Object3D | null;
  /** Medal pose in the bone's frame once it's on. */
  local: THREE.Matrix4 | null;
  landed: boolean;
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const ray = new THREE.Raycaster();

export class Podium {
  readonly root = new THREE.Group();
  private confetti: THREE.InstancedMesh;
  private bits: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3 }[] = [];
  private medals: Medal[] = [];
  private textures: THREE.Texture[] = [];
  private t = 0;
  /** Fired when a medal lands: place 0..2. */
  onMedal: (place: number) => void = () => {};

  /** `d` is where the podium stands along the track. */
  readonly d: number;

  constructor(d: number) {
    this.d = d;
    this.root.position.set(0, 0, -d);
    const navy = new THREE.MeshStandardMaterial({ color: 0x1b2a5c, roughness: 0.6 });
    // Red carpet base.
    const carpet = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.1, 3.4), new THREE.MeshStandardMaterial({ color: 0xc1272d, roughness: 0.85 }));
    carpet.position.set(0, 0.05, 0.15);
    carpet.receiveShadow = true;
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xffc93c, roughness: 0.35, metalness: 0.3 });
    const trim = new THREE.Mesh(new THREE.BoxGeometry(6.7, 0.06, 3.5), trimMat);
    trim.position.set(0, 0.02, 0.15);
    this.root.add(carpet, trim);
    for (let i = 0; i < 3; i++) {
      const h = HEIGHTS[i];
      const front = stepFront(i);
      this.textures.push(front);
      const top = new THREE.MeshStandardMaterial({ color: METAL[i], roughness: 0.3, metalness: 0.35, emissive: METAL[i], emissiveIntensity: 0.12 });
      const face = new THREE.MeshStandardMaterial({ map: front, roughness: 0.5 });
      // Box faces: +x, -x, +y, -y, +z (back), -z (front, towards the camera).
      const step = new THREE.Mesh(new THREE.BoxGeometry(STEP_W, h, STEP_D), [navy, navy, top, navy, navy, face]);
      step.position.set(STEP_X[i], 0.1 + h / 2, 0);
      step.castShadow = step.receiveShadow = true;
      const lip = new THREE.Mesh(new THREE.BoxGeometry(STEP_W + 0.04, 0.05, STEP_D + 0.04), top);
      lip.position.set(STEP_X[i], 0.1 + h, 0);
      this.root.add(step, lip);
    }
    // Backdrop wall on two posts.
    const wallTex = backdropTex();
    this.textures.push(wallTex);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.2, 0.12), [navy, navy, navy, navy, navy, new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7, emissive: 0xffffff, emissiveMap: wallTex, emissiveIntensity: 0.35 })]);
    wall.position.set(0, 2.15, 1.5);
    wall.castShadow = true;
    const postMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ee, roughness: 0.4, metalness: 0.5 });
    for (const x of [-3.3, 3.3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.9, 12), postMat);
      post.position.set(x, 1.95, 1.5);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), trimMat);
      ball.position.set(x, 3.95, 1.5);
      this.root.add(post, ball);
    }
    this.root.add(wall);
    // Warm key light on the steps, so dusk maps still read.
    const key = new THREE.PointLight(0xfff0d0, 14, 12, 1.6);
    key.position.set(0, 3.6, -3.4);
    this.root.add(key);

    // Confetti.
    const N = 260;
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.11), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), N);
    const cols = [0xffc93c, 0xef476f, 0x06d6a0, 0x118ab2, 0xffffff, 0xff8fab, 0x8338ec].map((c) => new THREE.Color(c));
    for (let i = 0; i < N; i++) {
      this.bits.push({
        p: new THREE.Vector3((Math.random() - 0.5) * 7, 3 + Math.random() * 5, -2.4 + Math.random() * 3.6),
        v: new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.7 - Math.random() * 0.8, (Math.random() - 0.5) * 0.3),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        w: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
      });
      this.confetti.setColorAt(i, cols[i % cols.length]);
    }
    this.confetti.count = 0; // falls once the champion has a medal
    this.root.add(this.confetti);
  }

  /** Where a runner stands for `place` (0-based), in straight track space. */
  spot(place: number, out = new THREE.Vector3()) {
    if (place < 3) return out.set(STEP_X[place], 0.1 + HEIGHTS[place], -this.d + 0.05);
    return out.set(FOURTH_X - (place - 3) * 0.9, 0.1, -this.d - 0.2);
  }

  /** Hang a medal on the runner on step `place` once they stand there. */
  award(place: number, view: CharacterView) {
    const obj = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: METAL[place], roughness: 0.28, metalness: 0.55, emissive: METAL[place], emissiveIntensity: 0.25 });
    const faceTex = medalFace(place);
    this.textures.push(faceTex);
    const disc = new THREE.Mesh(DISC, metal);
    const face = new THREE.Mesh(FACE, new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.3, metalness: 0.2, emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: 0.25 }));
    face.position.z = -0.016;
    obj.add(disc, face);
    obj.matrixAutoUpdate = false;
    obj.visible = false;
    this.root.parent?.add(obj);
    this.medals.push({ place, obj, view, bone: null, local: null, landed: false });
  }

  /** Lock each medal to its runner's chest: ray in from the front at chest height. */
  private fit(m: Medal) {
    const root = m.view.root;
    root.updateMatrixWorld(true);
    let bone: THREE.Object3D | null = null;
    for (const re of [/Spine2$/, /Spine1$/, /Spine$/]) {
      root.traverse((o) => { if (!bone && (o as THREE.Bone).isBone && re.test(o.name)) bone = o; });
      if (bone) break;
    }
    const chest = new THREE.Vector3();
    if (bone) (bone as THREE.Object3D).getWorldPosition(chest);
    else chest.set(root.position.x, root.position.y + 1.05, root.position.z);
    let neckY = chest.y + 0.28;
    root.traverse((o) => { if ((o as THREE.Bone).isBone && /Neck$/.test(o.name)) neckY = o.getWorldPosition(_v).y; });
    // Hang a little below the neck, never above the chest bone.
    const y = Math.min(chest.y, neckY - 0.3);
    // Runners face -z (down the track): come in from there.
    ray.set(new THREE.Vector3(root.position.x, y, root.position.z - 2), new THREE.Vector3(0, 0, 1));
    const meshes: THREE.Object3D[] = [];
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible && (o as THREE.Mesh).geometry !== undefined && o.name !== 'blob') meshes.push(o); });
    const hit = ray.intersectObjects(meshes, false).find((h) => h.distance > 0.3);
    const z = hit ? hit.point.z - 0.03 : root.position.z - 0.3;
    const pos = new THREE.Vector3(root.position.x, y, z);
    // Ribbon: two straps from either side of the neck down to the medal.
    const len = Math.max(0.15, neckY - y + 0.02);
    const ribbonMat = new THREE.MeshStandardMaterial({ map: ribbonTex(), roughness: 0.7 });
    for (const s of [-1, 1]) {
      const strap = new THREE.Mesh(RIBBON, ribbonMat);
      strap.position.set(s * 0.1, len + 0.08, 0.01);
      strap.scale.y = len + 0.02;
      strap.rotation.z = -s * Math.atan2(0.08, len);
      m.obj.add(strap);
    }
    const world = new THREE.Matrix4().makeTranslation(pos.x, pos.y - 0.11, pos.z);
    m.bone = bone;
    m.local = bone ? new THREE.Matrix4().copy((bone as THREE.Object3D).matrixWorld).invert().multiply(world) : world;
  }

  update(dt: number) {
    this.t += dt;
    for (const m of this.medals) {
      const at = MEDAL_DROP[m.place];
      if (this.t < at) continue;
      if (!m.local) this.fit(m);
      m.obj.visible = true;
      const k = Math.min(1, (this.t - at) / DROP_TIME);
      // Drop from above the head with a little bounce on landing.
      const drop = k < 1 ? (1 - k) * (1 - k) * 1.6 - Math.sin(k * Math.PI) * 0.04 : 0;
      m.bone?.updateWorldMatrix(true, false);
      if (m.bone) _m.multiplyMatrices(m.bone.matrixWorld, m.local!);
      else _m.copy(m.local!);
      _m.elements[13] += drop;
      // A spin on the way down.
      if (k < 1) _m.multiply(new THREE.Matrix4().makeRotationY((1 - k) * Math.PI * 4));
      m.obj.matrix.copy(_m);
      m.obj.matrixWorldNeedsUpdate = true;
      if (k >= 1 && !m.landed) {
        m.landed = true;
        this.onMedal(m.place);
        if (m.place === 0) this.confetti.count = this.bits.length;
      }
    }
    if (this.confetti.count) {
      const o = new THREE.Object3D();
      this.bits.forEach((b, i) => {
        b.p.addScaledVector(b.v, dt);
        b.p.x += Math.sin(this.t * 3 + i) * dt * 0.4;
        if (b.p.y < 0.1) b.p.set((Math.random() - 0.5) * 7, 4.5 + Math.random() * 1.5, -2.4 + Math.random() * 3.6);
        b.r.x += b.w.x * dt;
        b.r.y += b.w.y * dt;
        b.r.z += b.w.z * dt;
        o.position.copy(b.p);
        o.rotation.copy(b.r);
        o.updateMatrix();
        this.confetti.setMatrixAt(i, o.matrix);
      });
      this.confetti.instanceMatrix.needsUpdate = true;
    }
  }

  landed(place: number) {
    return this.medals.some((m) => m.place === place && m.landed);
  }

  get time() {
    return this.t;
  }

  dispose() {
    for (const m of this.medals) m.obj.removeFromParent();
    this.root.removeFromParent();
    for (const t of this.textures) t.dispose();
  }
}
