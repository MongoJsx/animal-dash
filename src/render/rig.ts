// Code-driven animation for characters that have a skeleton (Mixamo bone
// names) but no animation clips. Poses are built the way an animator blocks a
// run cycle: foot paths solved with two-bone IK, pelvis bob/twist/drop,
// counter-rotating spine, opposite arm swing and a stabilised head, then
// cross-faded between states. Everything is measured from the rest pose, so
// T-pose, A-pose and arms-down rigs of any proportions animate the same way.
import * as THREE from 'three';
import type { AnimState } from './character.ts';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (x: number) => x - Math.floor(x);
/** 0→1→0 bump over [a, b]. */
const bump = (x: number, a: number, b: number) => (x <= a || x >= b ? 0 : Math.sin(((x - a) / (b - a)) * Math.PI));

// ── Run cycle ─────────────────────────────────────────────────────────────
// Ankle path of one leg over a stride, phase 0 = foot strike. f = forward of
// the hip, h = lift above the standing ankle height, both in leg lengths.
// Sprint mechanics: short stance under the body, heel kicks up behind, then a
// high knee drive and a reach that paws back down into the next strike.
const FOOT_PATH: [u: number, f: number, h: number][] = [
  [0.0, 0.36, 0.0],
  [0.1, 0.13, 0.0],
  [0.2, -0.12, 0.0],
  [0.32, -0.38, 0.05], // toe-off
  [0.43, -0.44, 0.27], // heel kicks up
  [0.56, -0.2, 0.5], // heel tucked under the hip
  [0.68, 0.16, 0.46], // knee drive
  [0.8, 0.42, 0.24], // reach
  [0.91, 0.4, 0.06], // paw back
];
// Ankle pitch over the stride (+ = toes down).
const FOOT_PITCH: [u: number, a: number][] = [
  [0.0, 8], [0.12, 0], [0.24, 6], [0.34, 38], [0.45, 30], [0.6, 5], [0.72, -14], [0.86, -10], [0.95, 4],
];

/** Periodic Catmull-Rom through keys at uneven times (first key at 0). */
function loopCurve(keys: readonly (readonly number[])[], u: number, out: number[]) {
  u = wrap(u);
  const n = keys.length;
  let i = 0;
  for (let k = 0; k < n; k++) if (keys[k][0] <= u) i = k;
  const K = (m: number) => keys[((m % n) + n) % n];
  const T = (m: number) => K(m)[0] + Math.floor(m / n);
  const t0 = T(i - 1), t1 = T(i), t2 = T(i + 1), t3 = T(i + 2);
  const span = t2 - t1;
  const t = (u - t1) / span;
  const h00 = 2 * t ** 3 - 3 * t * t + 1, h10 = t ** 3 - 2 * t * t + t, h01 = -2 * t ** 3 + 3 * t * t, h11 = t ** 3 - t * t;
  for (let c = 1; c < K(i).length; c++) {
    const m1 = ((K(i + 1)[c] - K(i - 1)[c]) / (t2 - t0)) * span;
    const m2 = ((K(i + 2)[c] - K(i)[c]) / (t3 - t1)) * span;
    out[c - 1] = h00 * K(i)[c] + h10 * m1 + h01 * K(i + 1)[c] + h11 * m2;
  }
  return out;
}

// ── Rig ───────────────────────────────────────────────────────────────────
const NAMES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
] as const;
type Name = (typeof NAMES)[number];

interface Joint {
  bone: THREE.Object3D;
  parent: Joint | null;
  restWQ: THREE.Quaternion; // rest orientation in pivot space
  restWP: THREE.Vector3; // rest position in pivot space
  /** This frame's rotation on top of the rest pose (pivot space). */
  d: THREE.Quaternion;
  p: THREE.Vector3;
}

interface Pose {
  q: THREE.Quaternion[];
  hips: THREE.Vector3;
}

const ARM_REST = { swing: 0, spread: 0, elbow: 0, cf: 0, cu: 0, tin: 0 };

const newPose = (): Pose => ({ q: NAMES.map(() => new THREE.Quaternion()), hips: new THREE.Vector3() });

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _curve: number[] = [0, 0];
const _knee = new THREE.Vector3();
const _end = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _want = new THREE.Vector3();
const _qy = new THREE.Quaternion();
const _sh = new THREE.Vector3();
const _hand = new THREE.Vector3();
/** Wrist height when the fingertips are on the track, in leg lengths. */
const HAND_LIFT = 0.07;

/** Per-character tweaks (characters.json `anim`). */
export interface RigStyle {
  /** Extra degrees the arms are held out from the body (wide bellies, bulky clothes). */
  armSpread?: number;
  /** Arm swing scale; lower for meshes whose arms are fused to the torso. */
  armSwing?: number;
}

interface Leg { up: Joint; low: Joint; foot: Joint; toe: Joint; thigh: number; shin: number; side: number }
interface Arm { clav: Joint; up: Joint; fore: Joint; hand: Joint; side: number; upper: number; lower: number }

export class ProcRig {
  private j = {} as Record<Name, Joint>;
  private order: Joint[] = [];
  private hipsParentInv = new THREE.Matrix4();
  private hipsParentQ = new THREE.Quaternion();
  // Body frame (pivot space): right, up, forward.
  private R = new THREE.Vector3();
  private U = new THREE.Vector3(0, 1, 0);
  private F = new THREE.Vector3();
  private legLen = 1;
  private hipsH = 1;
  /** Hips to the shoulder line at rest. */
  private torsoLen = 1;
  private legs: Leg[] = [];
  private arms: Arm[] = [];

  private state: AnimState = 'idle';
  private time = 0; // in current state
  private dur = 1;
  phase = Math.random(); // stride phase, 0 = left foot strike
  private speedS = 0; // smoothed speed
  private laneS = 0;
  private accel = 0;
  private land = 0; // landing impact, decays
  private from = newPose();
  private out = newPose();
  private target = newPose();
  private fade = 0;
  private fadeT = 0;
  private seed = Math.random() * 100;
  private posed = false;
  private work = {
    hipsPos: new THREE.Vector3(),
    hipsQ: new THREE.Quaternion(),
    ankles: [new THREE.Vector3(), new THREE.Vector3()],
    fp: [0, 0],
    toes: [0, 0],
    armP: [{ ...ARM_REST }, { ...ARM_REST }],
  };

  static detect(model: THREE.Object3D) {
    let n = 0;
    model.traverse((o) => { if (NAMES.includes(o.name.replace(/^mixamorig/, '') as Name)) n++; });
    return n === NAMES.length;
  }

  private style: RigStyle;

  constructor(model: THREE.Object3D, space: THREE.Object3D, style: RigStyle = {}) {
    this.style = style;
    space.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(space.matrixWorld).invert();
    const byName = new Map<string, THREE.Object3D>();
    model.traverse((o) => byName.set(o.name.replace(/^mixamorig/, ''), o));
    const local = (o: THREE.Object3D, q: THREE.Quaternion, p: THREE.Vector3) =>
      _m.multiplyMatrices(inv, o.matrixWorld).decompose(p, q, _s);
    for (const name of NAMES) {
      const bone = byName.get(name)!;
      const restWQ = new THREE.Quaternion();
      const restWP = new THREE.Vector3();
      local(bone, restWQ, restWP);
      let parent: Joint | null = null;
      for (let o = bone.parent; o && !parent; o = o.parent) parent = this.j[o.name.replace(/^mixamorig/, '') as Name] ?? null;
      this.j[name] = { bone, parent, restWQ, restWP, d: new THREE.Quaternion(), p: new THREE.Vector3() };
      this.order.push(this.j[name]);
    }
    const hipsParent = this.j.Hips.bone.parent!;
    _m.multiplyMatrices(inv, hipsParent.matrixWorld);
    this.hipsParentInv.copy(_m).invert();
    _m.decompose(_v, this.hipsParentQ, _s);

    const { j } = this;
    this.R.subVectors(j.RightUpLeg.restWP, j.LeftUpLeg.restWP).setY(0).normalize();
    this.F.crossVectors(this.U, this.R).normalize();
    const thigh = (s: 'Left' | 'Right') => j[`${s}UpLeg`].restWP.distanceTo(j[`${s}Leg`].restWP);
    const shin = (s: 'Left' | 'Right') => j[`${s}Leg`].restWP.distanceTo(j[`${s}Foot`].restWP);
    for (const [s, side] of [['Left', -1], ['Right', 1]] as const) {
      this.legs.push({ up: j[`${s}UpLeg`], low: j[`${s}Leg`], foot: j[`${s}Foot`], toe: j[`${s}ToeBase`], thigh: thigh(s), shin: shin(s), side });
      this.arms.push({ clav: j[`${s}Shoulder`], up: j[`${s}Arm`], fore: j[`${s}ForeArm`], hand: j[`${s}Hand`], side,
        upper: j[`${s}Arm`].restWP.distanceTo(j[`${s}ForeArm`].restWP), lower: j[`${s}ForeArm`].restWP.distanceTo(j[`${s}Hand`].restWP) });
    }
    this.legLen = (thigh('Left') + shin('Left') + thigh('Right') + shin('Right')) / 2;
    this.hipsH = j.Hips.restWP.y;
    this.torsoLen = j.LeftArm.restWP.clone().add(j.RightArm.restWP).multiplyScalar(0.5).distanceTo(j.Hips.restWP);
  }

  play(state: AnimState, duration = 0) {
    const restart = state === 'jump' || state === 'slide' || state === 'stumble' || state === 'fall';
    if (state === this.state && !restart) return;
    const prev = this.state;
    // Freeze the pose we are leaving and blend out of it.
    for (let i = 0; i < NAMES.length; i++) this.from.q[i].copy(this.out.q[i]);
    this.from.hips.copy(this.out.hips);
    this.fade = state === 'jump' ? 0.08 : state === 'run' && prev === 'jump' ? 0.06 : state === 'slide' ? 0.1
      : state === 'fly' ? 0.35 : state === 'marks' ? 0.7 : state === 'set' ? 0.45 : state === 'burst' ? 0.07 : state === 'run' && prev === 'burst' ? 0.35 : 0.18;
    if (state === 'burst') this.phase = 0.62; // first stride: rear leg drives through
    this.fadeT = this.posed ? 0 : this.fade;
    if (state === 'run' && prev === 'jump') {
      this.land = 1;
      this.phase = 0.97; // strike with the leg that reached forward in the air
    }
    this.state = state;
    this.time = 0;
    this.dur = duration > 0 ? duration : 1;
  }

  update(dt: number, speed: number, laneVelocity: number) {
    this.time += dt;
    const prevSpeed = this.speedS;
    this.speedS += (speed - this.speedS) * Math.min(1, dt * 6);
    this.accel += ((this.speedS - prevSpeed) / Math.max(dt, 1e-4) - this.accel) * Math.min(1, dt * 4);
    this.laneS += (laneVelocity - this.laneS) * Math.min(1, dt * 10);
    this.land = Math.max(0, this.land - dt * 4.5);

    // Cadence rises a little with speed; stride length does the rest.
    const cadence = THREE.MathUtils.clamp(1.25 + this.speedS * 0.035, 1.2, 2.1);
    const still = this.state === 'fly' || this.state === 'idle' || this.state === 'victory' || this.state === 'defeat' || this.state === 'marks' || this.state === 'set';
    // Drive phase: quick, punchy steps while the speed is still low.
    const drive = this.state === 'burst' ? 1.25 : 1;
    if (!still) this.phase = wrap(this.phase + dt * Math.max(cadence, this.state === 'burst' ? 1.9 : 0) * drive * (this.state === 'stumble' ? 1.3 : 1));

    this.pose(this.target);
    this.fadeT += dt;
    const w = this.fade > 0 ? smooth(this.fadeT / this.fade) : 1;
    for (let i = 0; i < NAMES.length; i++) this.out.q[i].slerpQuaternions(this.from.q[i], this.target.q[i], w);
    this.out.hips.lerpVectors(this.from.hips, this.target.hips, w);
    this.apply(this.out);
    this.posed = true;
  }

  private apply(p: Pose) {
    for (let i = 0; i < NAMES.length; i++) this.j[NAMES[i]].bone.quaternion.copy(p.q[i]);
    this.j.Hips.bone.position.copy(p.hips);
  }

  // ── Pose building ───────────────────────────────────────────────────────
  /** Rotation in body axes: pitch forward, yaw to the left, roll to the right. */
  private rot(pitch: number, yaw: number, roll: number, out = new THREE.Quaternion()) {
    out.setFromAxisAngle(this.U, yaw);
    out.multiply(_qr.setFromAxisAngle(this.R, -pitch));
    return out.multiply(_qr.setFromAxisAngle(this.F, roll));
  }

  /** Body-frame vector (right, up, forward) → pivot space. */
  private vec(r: number, u: number, f: number, out: THREE.Vector3) {
    return out.copy(this.R).multiplyScalar(r).addScaledVector(this.U, u).addScaledVector(this.F, f);
  }

  private fk(jt: Joint, local: THREE.Quaternion | null) {
    const par = jt.parent!;
    jt.d.copy(par.d);
    if (local) jt.d.multiply(local);
    jt.p.subVectors(jt.restWP, par.restWP).applyQuaternion(par.d).add(par.p);
  }

  private hipsPose(pos: THREE.Vector3, q: THREE.Quaternion) {
    const h = this.j.Hips;
    h.d.copy(q);
    h.p.copy(pos);
  }

  /** Spine chain bend (radians, split over the three spine bones) and head look. */
  private spinePose(pitch: number, yaw: number, roll: number, headPitch: number, headYaw: number, stabilise: number) {
    const { j } = this;
    const split = [0.3, 0.35, 0.35];
    (['Spine', 'Spine1', 'Spine2'] as const).forEach((n, i) => this.fk(j[n], this.rot(pitch * split[i], yaw * split[i], roll * split[i], _q)));
    this.fk(j.Neck, this.rot(headPitch * 0.3, headYaw * 0.4, 0, _q));
    // Head: cancel most of the torso's motion so the eyes stay on the road.
    this.fk(j.Head, null);
    j.Head.d.slerp(_q.identity(), stabilise);
    j.Head.d.premultiply(this.rot(headPitch * 0.7, headYaw * 0.6, 0, _q));
  }

  /** Two-bone leg IK to an ankle target, then ankle/toe pitch. */
  private legPose(leg: Leg, ankle: THREE.Vector3, pitch: number, toe: number, kneeOut: number) {
    this.fk(leg.up, null);
    const hip = leg.up.p;
    const a = leg.thigh, b = leg.shin;
    const toT = _v3.subVectors(ankle, hip);
    let d = toT.length();
    d = THREE.MathUtils.clamp(d, Math.abs(a - b) + 1e-3, (a + b) * 0.999);
    toT.normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    // Knee points forward (following the pelvis) and slightly out.
    const pole = _v2.copy(this.F).applyQuaternion(this.j.Hips.d).addScaledVector(this.R, leg.side * kneeOut);
    pole.addScaledVector(toT, -pole.dot(toT)).normalize();
    const knee = _knee.copy(hip).addScaledVector(toT, a * cosA).addScaledVector(pole, a * sinA);
    const end = _end.copy(hip).addScaledVector(toT, d);
    this.aimTo(leg.up, leg.low, _dir.subVectors(knee, hip));
    this.fk(leg.low, null);
    this.aimTo(leg.low, leg.foot, end.sub(knee));
    this.fk(leg.foot, null);
    // Foot: keep its rest heading, pitch it about the hip's side axis.
    const axis = _v3.copy(this.R).applyQuaternion(this.j.Hips.d);
    const fdir = _v.subVectors(leg.toe.restWP, leg.foot.restWP);
    _q.setFromAxisAngle(axis, -pitch);
    this.aimTo(leg.foot, leg.toe, fdir.applyQuaternion(this.yawOnly(this.j.Hips.d)).applyQuaternion(_q));
    this.fk(leg.toe, this.rot(toe, 0, 0, _q2));
  }

  /** Turn bone `jt` (already placed by fk) so it points along `dir` (pivot space). */
  private aimTo(jt: Joint, child: Joint, dir: THREE.Vector3) {
    const want = _want.copy(dir).normalize();
    _v.subVectors(child.restWP, jt.restWP).applyQuaternion(jt.d).normalize();
    _q.setFromUnitVectors(_v, want);
    jt.d.premultiply(_q);
  }

  private yawOnly(q: THREE.Quaternion) {
    const f = _v2.copy(this.F).applyQuaternion(q);
    const yaw = Math.atan2(-f.dot(this.R), f.dot(this.F));
    return _qy.setFromAxisAngle(this.U, yaw * 0.6);
  }

  /** Arm from swing (forward from hanging), spread (out to the side) and elbow bend, in chest space. */
  private armPose(arm: Arm, swing: number, spread: number, elbow: number, clavFwd: number, clavUp: number, twistIn = 0) {
    const chest = this.j.Spine2.d;
    this.fk(arm.clav, this.rot(0, arm.side * clavFwd, -arm.side * clavUp, _q));
    this.fk(arm.up, null);
    const dir = (pitch: number, out: number, v: THREE.Vector3) =>
      this.vec(arm.side * Math.sin(out), -Math.cos(pitch) * Math.cos(out), Math.sin(pitch) * Math.cos(out), v).applyQuaternion(chest);
    this.aimTo(arm.up, arm.fore, dir(swing, spread, _dir));
    this.fk(arm.fore, null);
    this.aimTo(arm.fore, arm.hand, dir(swing + elbow, spread - twistIn, _dir));
    this.fk(arm.hand, null);
  }

  /** Two-bone arm IK: wrist to `target`, elbow pointing back and a little out. */
  private armTo(arm: Arm, target: THREE.Vector3, clavFwd: number, clavUp: number) {
    this.fk(arm.clav, this.rot(0, arm.side * clavFwd, -arm.side * clavUp, _q));
    this.fk(arm.up, null);
    const sh = arm.up.p;
    const a = arm.upper, b = arm.lower;
    const toT = _v3.subVectors(target, sh);
    let d = toT.length();
    d = THREE.MathUtils.clamp(d, Math.abs(a - b) + 1e-3, (a + b) * 0.999);
    toT.normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pole = _v2.copy(this.F).negate().addScaledVector(this.R, arm.side * 0.8);
    pole.addScaledVector(toT, -pole.dot(toT)).normalize();
    const elbow = _knee.copy(sh).addScaledVector(toT, a * cosA).addScaledVector(pole, a * sinA);
    const end = _end.copy(sh).addScaledVector(toT, d);
    this.aimTo(arm.up, arm.fore, _dir.subVectors(elbow, sh));
    this.fk(arm.fore, null);
    this.aimTo(arm.fore, arm.hand, end.sub(elbow));
    this.fk(arm.hand, null);
  }

  /**
   * Feet in the starting blocks (the same spot for "marks" and "set"): front
   * foot a stride behind the hands, rear foot further back on its toes. In
   * "marks" the rear knee rests on the track, in "set" it lifts off.
   */
  private blocks(ankles: THREE.Vector3[], fp: number[], toes: number[], set: number) {
    ankles[0] = this.ground(this.legs[0], 0.12, mix(0.05, 0.07, set), 0.9, ankles[0]);
    ankles[1] = this.ground(this.legs[1], -0.42, mix(0.1, 0.14, set), 0.9, ankles[1]);
    fp[0] = mix(30, 38, set) * DEG;
    fp[1] = mix(58, 62, set) * DEG;
    toes[0] = -20 * DEG;
    toes[1] = -45 * DEG;
  }

  /** Shoulder joints' midpoint for the current spine pose (clavicles at rest). */
  private shoulders(cu: number, out: THREE.Vector3) {
    out.set(0, 0, 0);
    for (const arm of this.arms) {
      this.fk(arm.clav, this.rot(0, 0, -arm.side * cu, _q));
      this.fk(arm.up, null);
      out.addScaledVector(arm.up.p, 0.5);
    }
    return out;
  }

  private ground(leg: Leg, f: number, h: number, width: number, out: THREE.Vector3) {
    // Ankle target relative to where the hip joint stands at rest.
    const L = this.legLen;
    const hipJ = leg.up.restWP;
    const restAnkle = leg.foot.restWP;
    const hipsR = this.j.Hips.restWP.dot(this.R);
    this.vec(hipsR + (restAnkle.dot(this.R) - hipsR) * width, 0, 0, out);
    out.addScaledVector(this.F, hipJ.dot(this.F) + f * L);
    out.y = restAnkle.y + h * L;
    return out;
  }

  private pose(out: Pose) {
    const { j, legLen: L } = this;
    const t = this.time;
    const k = clamp01(t / this.dur);
    const amp = THREE.MathUtils.clamp(this.speedS / 15, 0.45, 1.1);
    const lane = THREE.MathUtils.clamp(this.laneS / 15, -1, 1);
    const { hipsPos, hipsQ, ankles, fp, toes, armP } = this.work;
    hipsPos.copy(j.Hips.restWP);
    hipsQ.identity();
    fp.fill(0);
    toes.fill(0);
    for (const a of armP) Object.assign(a, ARM_REST);
    let sp = 0, sy = 0, sr = 0, hp = 0, hy = 0, stab = 0.7;
    let kneeOut = 0.15;
    /** Hands on the track (start poses): wrists this far ahead of the shoulders, arms at `reach` of their length. */
    let plant: { hips: number; ahead: number; reach: number } | null = null;
    /** Flying: legs stretched straight back along the body, kicking by this much (-1..1). */
    let flyLegs: number | null = null;

    const runPose = (strength = 1) => {
      const u = this.phase;
      const crouch = 0.045 * L * Math.min(1, amp);
      // Two dips per stride at mid-stance, highest in the flight phase.
      const bob = -Math.cos(TAU * 2 * (u - 0.1)) * 0.035 * L * amp;
      hipsPos.y = this.hipsH - crouch + bob - this.land * 0.1 * L;
      hipsPos.addScaledVector(this.F, 0.02 * L);
      // Pelvis twists toward the swinging leg and drops on the unsupported side.
      const twist = -Math.cos(TAU * (u - 0.88)) * 9 * DEG * amp;
      const drop = Math.cos(TAU * (u - 0.14)) * 4 * DEG * amp;
      this.rot(5 * DEG + this.land * 6 * DEG, twist + lane * 6 * DEG, drop - lane * 4 * DEG, hipsQ);
      for (let i = 0; i < 2; i++) {
        const lu = wrap(u + (i ? 0.5 : 0));
        loopCurve(FOOT_PATH, lu, _curve);
        ankles[i] = this.ground(this.legs[i], _curve[0] * amp, _curve[1] * Math.pow(amp, 0.8) * strength, 0.75, ankles[i]);
        loopCurve(FOOT_PITCH, lu, _curve);
        fp[i] = _curve[0] * DEG;
        toes[i] = -bump(lu, 0.22, 0.44) * 35 * DEG; // toes stay planted while the heel rises
      }
      // Torso leans into the sprint (more when accelerating) and counter-rotates.
      const lean = (6 + 7 * Math.min(1, amp) + THREE.MathUtils.clamp(this.accel, -10, 20) * 0.5) * DEG;
      sp = lean + Math.cos(TAU * 2 * (u - 0.15)) * 2 * DEG + this.land * 10 * DEG;
      sy = -twist * 1.9 - lane * 4 * DEG;
      sr = -drop * 0.6 - lane * 8 * DEG;
      hp = -lean * 0.6 + 4 * DEG;
      hy = lane * 10 * DEG;
      // Arms oppose the legs: left arm forward while the right leg is.
      for (let i = 0; i < 2; i++) {
        const s = Math.cos(TAU * (u - 0.88 + (i ? 0 : 0.5)));
        const fwd = Math.max(0, s);
        armP[i].swing = (6 + 44 * s * amp) * DEG;
        armP[i].spread = (14 - 6 * fwd) * DEG;
        armP[i].elbow = (80 + 12 * s) * DEG;
        armP[i].tin = 22 * fwd * DEG;
        armP[i].cf = 6 * s * DEG;
        armP[i].cu = 2 * DEG;
      }
    };

    switch (this.state) {
      case 'run':
      case 'strafe_left':
      case 'strafe_right':
        runPose();
        break;

      case 'burst': {
        // Drive phase out of the blocks: body low and leaning hard, big
        // piston arms, rising toward upright over the first strides.
        runPose(1.15);
        const e = 1 - smooth(k);
        sp += 34 * e * DEG;
        hp -= 26 * e * DEG;
        hipsPos.y -= 0.12 * L * e;
        hipsPos.addScaledVector(this.F, 0.1 * L * e);
        hipsQ.premultiply(this.rot(28 * e * DEG, 0, 0, _q));
        for (let i = 0; i < 2; i++) {
          armP[i].swing = armP[i].swing * (1 + 0.5 * e) + 10 * e * DEG;
          armP[i].elbow = mix(armP[i].elbow, 95 * DEG, e * 0.6);
        }
        break;
      }

      case 'marks': {
        // "On your marks": rear knee down beside the front foot, hands on
        // the line shoulder-width apart, arms straight under the shoulders,
        // back long and the head hanging in line with it, eyes on the track.
        const br = Math.sin(t * 2.4 + this.seed) * 0.5 + 0.5;
        hipsPos.addScaledVector(this.F, -0.1 * L);
        this.blocks(ankles, fp, toes, 0);
        kneeOut = 0.04;
        hp = -6 * DEG;
        stab = 0.25;
        plant = { hips: 0.5 + br * 0.006, ahead: 0.03, reach: 0.97 };
        break;
      }

      case 'set': {
        // "Set": hips up a touch above the shoulders, front knee near a right
        // angle, shoulders rolled forward past the hands, arms locked, head in
        // line with the back; a held-breath quiver before the gun.
        const quiver = Math.sin(t * 17 + this.seed) * 0.002;
        hipsPos.addScaledVector(this.F, 0.06 * L);
        this.blocks(ankles, fp, toes, 1);
        kneeOut = 0.04;
        hp = -4 * DEG;
        stab = 0.3;
        plant = { hips: 0.74 + quiver, ahead: -0.08, reach: 0.985 };
        break;
      }

      case 'fly': {
        // Rocket pack: lying flat like a flying hero, back arched so the head
        // looks down the track, one fist punching ahead, the other arm along
        // the side, legs straight out behind with a lazy flutter.
        const bob = Math.sin(t * 3 + this.seed);
        hipsPos.y = this.hipsH + bob * 0.015 * L;
        this.rot((84 + bob * 2) * DEG, 0, 0, hipsQ);
        sp = -14 * DEG;
        hp = -48 * DEG;
        stab = 0;
        fp[0] = fp[1] = 55 * DEG;
        kneeOut = 0.1;
        flyLegs = Math.sin(t * 7 + this.seed);
        armP[1].swing = 172 * DEG; armP[1].spread = 8 * DEG; armP[1].elbow = 4 * DEG; armP[1].cu = 14 * DEG;
        armP[0].swing = -14 * DEG; armP[0].spread = 16 * DEG; armP[0].elbow = 12 * DEG;
        break;
      }

      case 'jump': {
        // Takeoff → tuck → reach for the ground.
        const up = smooth(k / 0.25), tuck = bump(k, 0.05, 0.85), reach = smooth((k - 0.6) / 0.35);
        hipsPos.y = this.hipsH - 0.03 * L;
        this.rot((12 - 6 * tuck) * DEG, 0, 0, hipsQ);
        for (let i = 0; i < 2; i++) {
          const lead = i === 0;
          // Running leap: lead knee drives up and forward, trail leg kicks back.
          const f = lead ? mix(mix(-0.2, 0.34, up), 0.24, reach) : mix(mix(0.25, -0.4, up), -0.08, reach);
          const h = (lead ? 0.6 : 0.42) * tuck + (lead ? 0.04 : 0.1) * (1 - reach);
          ankles[i] = this.ground(this.legs[i], f, h, 0.85, ankles[i]);
          ankles[i].y += hipsPos.y - this.hipsH;
          fp[i] = mix(30, -8, up) * DEG + reach * 10 * DEG;
        }
        sp = (14 - 8 * reach) * DEG;
        hp = -6 * DEG;
        for (let i = 0; i < 2; i++) {
          const lead = i === 1; // arm opposite the lead leg drives up
          armP[i].swing = mix(lead ? -20 : 40, lead ? 95 : -25, up) * DEG + reach * (lead ? -40 : 30) * DEG;
          armP[i].spread = (22 + 18 * tuck) * DEG;
          armP[i].elbow = (60 + 30 * tuck) * DEG;
          armP[i].cu = 8 * tuck * DEG;
        }
        break;
      }

      case 'slide': {
        // Baseball slide: drop low, lie back, lead leg out along the ground.
        const into = smooth(k / 0.18), outOf = smooth((k - 0.85) / 0.15), w = into * (1 - outOf);
        hipsPos.y = mix(this.hipsH - 0.07 * L, 0.26 * L, w);
        hipsPos.addScaledVector(this.F, -0.15 * L * w);
        this.rot(mix(8, -55, w) * DEG, 10 * w * DEG, 0, hipsQ);
        ankles[0] = this.ground(this.legs[0], mix(0.1, 0.95, w), 0.02, 1, ankles[0]);
        ankles[1] = this.ground(this.legs[1], mix(-0.1, 0.25, w), 0.0, 1.2, ankles[1]);
        fp[0] = -20 * w * DEG;
        fp[1] = 40 * w * DEG;
        kneeOut = mix(0.15, 0.7, w);
        sp = 25 * w * DEG;
        hp = 18 * w * DEG;
        sy = -10 * w * DEG;
        stab = 0.85;
        armP[0].swing = mix(10, -50, w) * DEG; armP[0].spread = 45 * w * DEG; armP[0].elbow = 15 * DEG;
        armP[1].swing = mix(10, 70, w) * DEG; armP[1].spread = 20 * DEG; armP[1].elbow = 60 * DEG;
        break;
      }

      case 'stumble': {
        runPose();
        // Trip: pitch forward, arms thrown out, catch and recover.
        const e = bump(k, 0, 0.75) * (k < 0.2 ? smooth(k / 0.2) : 1);
        sp += 40 * e * DEG;
        hp -= 25 * e * DEG;
        hipsPos.y -= 0.1 * L * e;
        hipsQ.premultiply(this.rot(10 * e * DEG, 0, 0, _q));
        for (let i = 0; i < 2; i++) {
          armP[i].swing = mix(armP[i].swing, (70 + 25 * Math.sin(t * 25 + i * 2)) * DEG, e);
          armP[i].spread = mix(armP[i].spread, 40 * DEG, e);
          armP[i].elbow = mix(armP[i].elbow, 25 * DEG, e);
        }
        break;
      }

      case 'fall': {
        // Dropped into a gap: legs dangle, arms windmill.
        const e = smooth(k / 0.2);
        hipsPos.y = this.hipsH;
        this.rot(25 * e * DEG, 0, 0, hipsQ);
        for (let i = 0; i < 2; i++) {
          ankles[i] = this.ground(this.legs[i], Math.sin(t * 9 + i * Math.PI) * 0.2, 0.1 + 0.08 * Math.cos(t * 9 + i * Math.PI), 1, ankles[i]);
          fp[i] = 25 * DEG;
          armP[i].swing = (100 + 50 * Math.sin(t * 14 + i * Math.PI)) * DEG;
          armP[i].spread = 50 * DEG;
          armP[i].elbow = 20 * DEG;
        }
        sp = 15 * e * DEG;
        hp = -25 * e * DEG;
        stab = 0.3;
        break;
      }

      case 'victory': {
        const hop = Math.abs(Math.sin(t * 5.5));
        hipsPos.y = this.hipsH - 0.06 * L + hop * 0.12 * L;
        for (let i = 0; i < 2; i++) {
          ankles[i] = this.ground(this.legs[i], 0, hop * 0.12, 1.1, ankles[i]);
          ankles[i].y += hop * 0.12 * L;
          fp[i] = hop * 25 * DEG;
          armP[i].swing = (150 + 15 * Math.sin(t * 11 + i)) * DEG;
          armP[i].spread = 25 * DEG;
          armP[i].elbow = 25 * DEG;
          armP[i].cu = 15 * DEG;
        }
        sp = -8 * DEG;
        hp = -15 * DEG;
        break;
      }

      case 'defeat': {
        hipsPos.y = this.hipsH - 0.05 * L;
        for (let i = 0; i < 2; i++) {
          ankles[i] = this.ground(this.legs[i], i ? 0.05 : -0.05, 0, 1, ankles[i]);
          armP[i].swing = 4 * DEG; armP[i].spread = 6 * DEG; armP[i].elbow = 12 * DEG;
          armP[i].cu = -6 * DEG;
        }
        sp = (22 + Math.sin(t * 1.5) * 2) * DEG;
        hp = 25 * DEG;
        stab = 0;
        break;
      }

      default: {
        // Idle: breathing, a slow weight shift, relaxed arms.
        const br = Math.sin(t * 2.2 + this.seed);
        const sway = Math.sin(t * 0.7 + this.seed);
        hipsPos.y = this.hipsH - 0.015 * L + br * 0.004 * L;
        hipsPos.addScaledVector(this.R, sway * 0.015 * L);
        this.rot(2 * DEG, sway * 2 * DEG, -sway * 2.5 * DEG, hipsQ);
        for (let i = 0; i < 2; i++) ankles[i] = this.ground(this.legs[i], 0, 0, 1, ankles[i]);
        sp = (2 + br * 1.2) * DEG;
        sr = sway * 2 * DEG;
        hp = -1 * DEG;
        hy = Math.sin(t * 0.43 + this.seed * 2) * 8 * DEG;
        stab = 0.5;
        for (let i = 0; i < 2; i++) {
          armP[i].swing = (4 + br * 1.5) * DEG;
          armP[i].spread = (9 + br) * DEG;
          armP[i].elbow = 14 * DEG;
        }
      }
    }

    // ── Solve ──
    const handY = HAND_LIFT * L;
    const reach = (this.arms[0].upper + this.arms[0].lower) * (plant?.reach ?? 1);
    if (plant) {
      // Hips at the height the pose wants; tip the back forward until the
      // shoulders sit an arm's length above the track.
      hipsPos.y = this.hipsH * plant.hips;
      const want = handY + reach;
      let lean = Math.acos(THREE.MathUtils.clamp((want - hipsPos.y) / this.torsoLen, -0.6, 0.7));
      // The spine curls rather than tipping like a stick: refine by Newton steps.
      for (let it = 0; it < 4; it++) {
        this.rot(lean * 0.6, 0, 0, hipsQ);
        this.hipsPose(hipsPos, hipsQ);
        this.spinePose(lean * 0.4, sy, sr, hp, hy, stab);
        const err = this.shoulders(0, _sh).y - want;
        lean = THREE.MathUtils.clamp(lean + err / (this.torsoLen * Math.max(0.3, Math.sin(lean))), 45 * DEG, 135 * DEG);
      }
      this.rot(lean * 0.6, 0, 0, hipsQ);
      sp = lean * 0.4;
    }
    this.hipsPose(hipsPos, hipsQ);
    this.spinePose(sp, sy, sr, hp, hy, stab);
    if (plant) {
      // The spine doesn't bend like one stick: settle the rest by raising or
      // lowering the whole body (the legs follow by IK).
      const sh = this.shoulders(0, _sh);
      const lo = this.hipsH * 0.32, hi = this.hipsH * 0.96;
      hipsPos.y = THREE.MathUtils.clamp(hipsPos.y + handY + reach - sh.y, lo, hi);
      this.hipsPose(hipsPos, hipsQ);
      this.spinePose(sp, sy, sr, hp, hy, stab);
    }
    if (flyLegs !== null) {
      // Ankles a nearly straight leg's length out along the body's own "down".
      _v3.copy(this.U).negate().applyQuaternion(hipsQ);
      for (let i = 0; i < 2; i++) {
        const leg = this.legs[i];
        this.fk(leg.up, null);
        const kick = flyLegs * (i ? -1 : 1) * 0.06 * L;
        ankles[i].copy(leg.up.p).addScaledVector(_v3, (leg.thigh + leg.shin) * 0.95)
          .addScaledVector(this.R, leg.side * 0.03 * L).addScaledVector(this.U, kick);
      }
    }
    for (let i = 0; i < 2; i++) this.legPose(this.legs[i], ankles[i], fp[i], toes[i], kneeOut);
    const swingK = this.style.armSwing ?? 1;
    const spreadAdd = (this.style.armSpread ?? 0) * DEG;
    for (let i = 0; i < 2; i++) {
      const a = armP[i];
      if (plant) {
        // Wrists on the line, a little wider than the shoulders.
        this.fk(this.arms[i].clav, null);
        this.fk(this.arms[i].up, null);
        const sh = this.arms[i].up.p;
        _hand.copy(sh).addScaledVector(this.F, plant.ahead * L).addScaledVector(this.R, this.arms[i].side * 0.05 * L);
        _hand.y = handY;
        this.armTo(this.arms[i], _hand, 0, 0);
        continue;
      }
      this.armPose(this.arms[i], a.swing * swingK, a.spread + spreadAdd, a.elbow, a.cf, a.cu, a.tin * swingK);
    }

    // World deltas → local bone rotations.
    for (let i = 0; i < NAMES.length; i++) {
      const jt = this.j[NAMES[i]];
      const world = _q.multiplyQuaternions(jt.d, jt.restWQ);
      const parentWorld = jt.parent ? _q2.multiplyQuaternions(jt.parent.d, jt.parent.restWQ) : _q2.copy(this.hipsParentQ);
      out.q[i].copy(parentWorld.invert().multiply(world));
    }
    out.hips.copy(j.Hips.p).applyMatrix4(this.hipsParentInv);
  }
}
