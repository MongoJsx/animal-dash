// Ties simulation, rendering and UI together: menu → countdown → race → results.
import * as THREE from 'three';
import { PLAYER, RACE_LENGTH, RIVAL_COUNT, TICK, VIEW_AHEAD, VIEW_BEHIND, laneX } from './config.ts';
import { Input } from './core/input.ts';
import { Rng } from './core/rng.ts';
import { botActions } from './entities/bot.ts';
import { Player, type PlayerEvent } from './entities/player.ts';
import { Rival, type RivalSkill } from './entities/rival.ts';
import { Online, type NetMove, type NetMsg } from './net/online.ts';
import { Remote } from './net/remote.ts';
import { CharacterView, type CharacterDef } from './render/character.ts';
import { Environment } from './render/environment.ts';
import { warmUpProps } from './render/props.ts';
import { ObstacleView } from './render/obstacleView.ts';
import { Hud, type Racer } from './ui/hud.ts';
import { BIOMES, biomeAt } from './world/biomes.ts';
import { movingD } from './world/obstacles.ts';
import { buildTrack, type Track } from './world/track.ts';

type State = 'menu' | 'countdown' | 'race' | 'done' | 'results';

const SKILLS: RivalSkill[] = [
  { mistake: 0.1, pace: 1.0 },
  { mistake: 0.18, pace: 0.99 },
  { mistake: 0.27, pace: 0.985 },
];
const COLORS = ['#ffb703', '#ef476f', '#06d6a0', '#118ab2'];
const RIVAL_START: [number, number][] = [[-1, 0], [1, 0], [0, -3]];
const airTime = (v: number) => (2 * v) / PLAYER.gravity;

interface RivalEntry { sim: Rival | Remote; view: CharacterView; def: CharacterDef; lock: number; moveIndex: number }

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(65, 1, 0.1, 400);
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private input: Input;
  private hud: Hud;
  private clock = new THREE.Clock();
  private acc = 0;

  private state: State = 'menu';
  private chars: CharacterDef[];
  private selected: string;
  private track!: Track;
  private env: Environment | null = null;
  private views = new Map<number, ObstacleView>();
  private spawnIndex = 0;
  private player = new Player();
  private playerView: CharacterView | null = null;
  private playerLock = 0;
  private rivals: RivalEntry[] = [];
  private t = 0;
  private countdownT = 0;
  private doneT = 0;
  private shake = 0;
  private sky = new THREE.Color();
  private bot = import.meta.env.DEV && new URLSearchParams(location.search).has('bot');
  private online: Online | null = null;
  private remoteChar: string | null = null;
  private remote: Remote | null = null;
  private sendTick = 0;

  constructor(container: HTMLElement, chars: CharacterDef[]) {
    this.chars = chars;
    const params = new URLSearchParams(location.search);
    this.selected = chars.find((c) => c.id === params.get('char'))?.id ?? chars[0].id;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d7b68, 1.7));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    this.scene.fog = new THREE.Fog(0xffffff, 45, VIEW_AHEAD * 0.92);

    this.input = new Input(container);
    this.hud = new Hud(container);

    addEventListener('resize', () => this.resize());
    this.resize();
    this.showMenu();
    void warmUpProps(this.renderer, this.camera, this.scene);
    const room = params.get('room');
    if (room) this.connect(Online.join(room, Number(params.get('b')) || 0));
    else if (params.has('autostart')) this.startRace();
    this.renderer.setAnimationLoop(() => this.frame());
    if (import.meta.env.DEV) {
      let frames = 0, last = performance.now(), fps = 0;
      this.renderer.setAnimationLoop(() => {
        this.frame();
        frames++;
        const now = performance.now();
        if (now - last > 1000) { fps = frames; frames = 0; last = now; }
      });
      Object.assign(window, {
        __debug: () => ({
          fps, state: this.state, t: +this.t.toFixed(2), d: +this.player.d.toFixed(1), speed: +this.player.speed.toFixed(1),
          focus: this.player.focus, calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles,
          views: this.views.size,
          breakdown: this.triBreakdown(),
        }),
      });
    }
  }

  /** Dev: triangles per scene part (instanced meshes × count), excluding shadow passes. */
  private triBreakdown() {
    const out: Record<string, number> = {};
    const tris = (m: THREE.Mesh) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    const add = (key: string, root: THREE.Object3D | undefined) => {
      root?.traverseVisible((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const n = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
        out[key] = (out[key] ?? 0) + Math.round(tris(m) * n);
      });
    };
    add('env', this.env?.root);
    for (const v of this.views.values()) add('obstacles', v.root);
    add('player', this.playerView?.root);
    for (const r of this.rivals) add('rivals', r.view.root);
    return out;
  }

  private resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private def(id: string) {
    return this.chars.find((c) => c.id === id)!;
  }

  // ── Setup ───────────────────────────────────────────────────────────
  private reset(seed: number) {
    for (const v of this.views.values()) this.scene.remove(v.root);
    this.views.clear();
    this.spawnIndex = 0;
    if (this.env) {
      this.scene.remove(this.env.root);
      this.env.dispose();
    }
    for (const r of this.rivals) this.scene.remove(r.view.root);
    this.rivals = [];

    this.track = buildTrack(seed);
    this.env = new Environment(seed, this.track.biomes);
    this.scene.add(this.env.root);
    this.player = new Player();
    this.t = 0;
    this.sky.setHex(BIOMES[this.track.biomes[0]].sky);
  }

  private setPlayerView(id: string) {
    if (this.playerView) this.scene.remove(this.playerView.root);
    this.playerView = new CharacterView(this.def(id));
    this.scene.add(this.playerView.root);
  }

  private showMenu() {
    this.state = 'menu';
    this.input.enabled = false;
    this.reset(1234);
    this.setPlayerView(this.selected);
    this.playerView!.play('idle');
    this.hud.showMenu(this.chars, this.selected, (id) => {
      this.selected = id;
      this.setPlayerView(id);
      this.playerView!.play('idle');
      this.online?.send({ t: 'char', id });
    }, () => this.onStartPressed(), () => this.connect(Online.host()));
    this.updateLobby();
  }

  // ── Online ──────────────────────────────────────────────────────────
  private connect(online: Online) {
    this.online?.close();
    this.online = online;
    this.remoteChar = null;
    online.onStatus = () => {
      if (online.connected) online.send({ t: 'char', id: this.selected });
      if (online.status === 'closed' && this.state !== 'menu') this.hud.flash('เพื่อนออกจากห้องแล้ว');
      this.updateLobby();
    };
    online.onMessage = (m) => this.onNet(m);
    this.updateLobby();
  }

  private leaveOnline() {
    this.online?.close();
    this.online = null;
    this.remoteChar = null;
    history.replaceState(null, '', location.pathname);
    this.updateLobby();
  }

  private onNet(m: NetMsg) {
    switch (m.t) {
      case 'char':
        this.remoteChar = this.chars.some((c) => c.id === m.id) ? m.id : this.chars[0].id;
        if (this.state === 'menu') this.updateLobby();
        break;
      case 'start':
        if (this.online?.role === 'guest') this.startRace(m.seed);
        break;
      case 'again':
        if (this.online?.role === 'host' && this.state === 'results') this.startRace();
        break;
      case 's':
        this.remote?.receive(m.d, m.x, m.y, m.v);
        break;
      case 'm':
        this.remote?.move(m.m);
        break;
      case 'fin':
        this.remote?.finish(m.time);
        break;
    }
  }

  private onStartPressed() {
    if (!this.online) this.startRace();
    else if (this.online.role === 'host' && this.online.connected) this.startRace();
  }

  private updateLobby() {
    if (this.state !== 'menu') return;
    const o = this.online;
    if (!o) { this.hud.setLobby(null); return; }
    const friend = this.remoteChar ? this.def(this.remoteChar).name : '…';
    const leave = { leave: () => this.leaveOnline() };
    let html: string;
    let start: string | null = null;
    let actions: Record<string, () => void> = leave;
    if (o.status === 'error' || o.status === 'closed') {
      html = `<div class="err">${o.status === 'error' ? o.error : 'เพื่อนออกจากห้องแล้ว'}</div>`;
      html += `<div class="acts"><button data-act="leave">กลับไปเล่นคนเดียว</button></div>`;
    } else if (o.role === 'host' && !o.connected) {
      html = `ส่งลิงก์นี้ให้เพื่อน แล้วรอเพื่อนเข้าห้อง<div class="code">${o.code.toUpperCase()}</div>
        <span class="link">${o.link}</span>
        <div class="acts"><button data-act="share">📋 คัดลอก/แชร์ลิงก์</button><button data-act="leave">ยกเลิก</button></div>`;
      actions = { ...leave, share: () => this.shareLink(o) };
    } else if (o.role === 'host') {
      html = `<div class="ok">เพื่อนเข้าห้องแล้ว ✓</div>เพื่อนเลือก: <b>${friend}</b>
        <div class="acts"><button data-act="leave">ออกจากห้อง</button></div>`;
      start = 'เริ่มแข่ง!';
    } else if (!o.connected) {
      html = `กำลังเข้าห้อง <b>${o.code.toUpperCase()}</b>…<div class="acts"><button data-act="leave">ยกเลิก</button></div>`;
    } else {
      html = `<div class="ok">เข้าห้องแล้ว ✓</div>เจ้าห้องเลือก: <b>${friend}</b><br>เลือกตัวละคร แล้วรอเจ้าห้องกดเริ่ม
        <div class="acts"><button data-act="leave">ออกจากห้อง</button></div>`;
    }
    this.hud.setLobby({ html, start, actions });
  }

  private shareLink(o: Online) {
    const url = o.link;
    if (navigator.share) {
      navigator.share({ title: 'Animal Dash', text: 'มาวิ่งแข่งกัน!', url }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(url).then(() => this.hud.flash('คัดลอกลิงก์แล้ว', 'good'), () => {});
    }
  }

  private startRace(netSeed?: number) {
    const params = new URLSearchParams(location.search);
    const seed = netSeed ?? (Number(params.get('seed')) || (Math.random() * 2 ** 31) | 0);
    const online = this.online?.connected ? this.online : null;
    if (online?.role === 'host') online.send({ t: 'start', seed });
    this.reset(seed);
    this.setPlayerView(this.selected);
    this.remote = null;
    if (online) {
      // Host on the left, guest on the right.
      const side = online.role === 'host' ? -1 : 1;
      this.player.startLane(side);
      const def = this.def(this.remoteChar ?? this.chars[0].id);
      this.remote = new Remote(laneX(-side));
      const view = new CharacterView(def, { castShadow: false });
      view.play('idle');
      this.scene.add(view.root);
      this.rivals.push({ sim: this.remote, view, def, lock: 0, moveIndex: 0 });
      this.playerView!.play('idle');
      this.hud.startRace(this.racers());
      this.state = 'countdown';
      this.countdownT = 3;
      this.hud.countdown('3');
      this.input.clear();
      return;
    }

    const rng = new Rng(seed ^ 0x5bd1e995);
    const pool = rng.shuffle(this.chars.filter((c) => c.id !== this.selected));
    for (let i = 0; i < Math.min(RIVAL_COUNT, pool.length); i++) {
      const [lane, d] = RIVAL_START[i];
      const sim = new Rival(seed + i * 101, SKILLS[i], lane);
      sim.d = d;
      // Rivals use a cheap blob shadow: four shadow-casting characters cost ~60k tris.
      const view = new CharacterView(pool[i], { castShadow: false });
      view.play('idle');
      this.scene.add(view.root);
      this.rivals.push({ sim, view, def: pool[i], lock: 0, moveIndex: 0 });
    }
    this.playerView!.play('idle');
    this.hud.startRace(this.racers());
    this.state = 'countdown';
    this.countdownT = 3;
    this.hud.countdown('3');
    this.input.clear();
  }

  private racers(): Racer[] {
    return [
      { name: this.def(this.selected).name, d: this.player.d, isPlayer: true, finished: this.player.finished, finishTime: this.player.finishTime, color: COLORS[0] },
      ...this.rivals.map((r, i) => ({ name: r.sim instanceof Remote ? `เพื่อน · ${r.def.name}` : r.def.name, d: r.sim.d, isPlayer: false, finished: r.sim.finished, finishTime: r.sim.finishTime, color: COLORS[i + 1] })),
    ];
  }

  // ── Loop ────────────────────────────────────────────────────────────
  private frame() {
    const dt = Math.min(0.1, this.clock.getDelta());
    this.acc += dt;
    while (this.acc >= TICK) {
      this.step(TICK);
      this.acc -= TICK;
    }
    this.render(dt);
  }

  private step(dt: number) {
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdownT);
      this.countdownT -= dt;
      const now = Math.ceil(this.countdownT);
      if (now !== before) this.hud.countdown(now > 0 ? String(now) : 'GO!');
      if (this.countdownT <= 0) {
        this.state = 'race';
        this.input.enabled = true;
        this.playerView?.play('run');
        for (const r of this.rivals) r.view.play('run');
      }
      return;
    }
    if (this.state !== 'race' && this.state !== 'done') return;

    this.t += dt;
    const p = this.player;
    const actions = this.input.drain();
    if (this.bot && !p.finished) actions.push(...botActions(p, this.track, this.t));
    p.step(dt, this.t, actions, this.track);
    if (!p.finished && p.d >= RACE_LENGTH) p.finish(this.t);
    for (const e of p.events) this.onPlayerEvent(e);
    p.events.length = 0;

    if (this.online?.connected && this.remote && ++this.sendTick % 3 === 0) {
      this.online.send({ t: 's', d: +p.d.toFixed(2), x: +p.x.toFixed(2), y: +p.y.toFixed(2), v: +p.speed.toFixed(2) });
    }

    for (const r of this.rivals) {
      if (r.sim instanceof Remote) { r.sim.step(dt); continue; }
      r.sim.step(dt, this.track, p.d);
      if (!r.sim.finished && r.sim.d >= RACE_LENGTH) r.sim.finish(this.t);
    }

    if (this.state === 'race' && p.finished) {
      this.state = 'done';
      this.doneT = 0;
      this.input.enabled = false;
    }
    if (this.state === 'done') {
      this.doneT += dt;
      const allIn = this.rivals.every((r) => r.sim.finished);
      // A friend gets longer to finish than the bots, as long as they're still there.
      const wait = this.remote && this.online?.connected ? 25 : 6;
      if (this.doneT > 2.5 && (allIn || this.doneT > wait)) {
        this.state = 'results';
        this.hud.showResults(this.racers(), (btn) => this.again(btn), () => this.showMenu());
      }
    }
  }

  private again(btn: HTMLButtonElement) {
    const o = this.online;
    if (o?.connected && o.role === 'guest') {
      o.send({ t: 'again' });
      btn.textContent = 'รอเจ้าห้อง…';
      btn.disabled = true;
      return;
    }
    this.startRace();
  }

  private onPlayerEvent(e: PlayerEvent) {
    const v = this.playerView;
    if (this.remote && this.online?.connected) {
      if (e.type === 'finish') this.online.send({ t: 'fin', time: this.player.finishTime });
      else if (['jump', 'bounce', 'slide', 'stumble', 'fall'].includes(e.type)) this.online.send({ t: 'm', m: e.type as NetMove });
    }
    switch (e.type) {
      case 'jump':
      case 'bounce':
        v?.play('jump', e.airTime);
        this.playerLock = e.airTime;
        break;
      case 'slide':
        v?.play('slide', PLAYER.slideTime);
        this.playerLock = PLAYER.slideTime;
        break;
      case 'land':
        if (!this.player.sliding) this.playerLock = 0;
        break;
      case 'stumble':
        v?.play('stumble', 0.9);
        this.playerLock = 0.9;
        this.shake = 0.35;
        this.views.get(e.obstacle.id)?.smash(this.player.x);
        this.hud.flash('สะดุด!');
        this.hud.hit();
        break;
      case 'sidehit':
        this.shake = 0.15;
        this.hud.flash('ชนข้าง!');
        this.hud.hit();
        break;
      case 'fall':
        v?.play('fall', 0.8);
        this.playerLock = 0.8;
        this.shake = 0.3;
        this.hud.flash('ตกหลุม!');
        this.hud.hit();
        break;
      case 'focus':
        this.hud.setFocus(e.level);
        if (e.level === 10) this.hud.flash('FOCUS MAX!', 'good');
        break;
      case 'finish': {
        const place = 1 + this.rivals.filter((r) => r.sim.finished).length;
        v?.play(place === 1 ? 'victory' : 'defeat');
        this.playerLock = 99;
        this.hud.flash(place === 1 ? 'เข้าเส้นชัยที่ 1!' : `เข้าเส้นชัยที่ ${place}`, 'good');
        break;
      }
      default: break;
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────
  private syncObstacles(dt: number) {
    const obs = this.track.obstacles;
    const d = this.player.d;
    while (this.spawnIndex < obs.length && obs[this.spawnIndex].d < d + VIEW_AHEAD) {
      const o = obs[this.spawnIndex++];
      const v = new ObstacleView(o);
      this.views.set(o.id, v);
      this.scene.add(v.root);
    }
    for (const [id, v] of this.views) {
      if (movingD(v.o, this.t) + v.o.length < d - VIEW_BEHIND) {
        this.scene.remove(v.root);
        this.views.delete(id);
      } else {
        v.update(this.t, dt);
      }
    }
  }

  private render(dt: number) {
    const p = this.player;
    this.env?.update(p.d);
    if (this.track) this.syncObstacles(dt);

    if (this.playerView) {
      const v = this.playerView;
      v.root.position.set(p.x, p.y, -p.d);
      if (this.state === 'race') {
        this.playerLock -= dt;
        if (this.playerLock <= 0 && p.grounded && !p.sliding && !p.stunned && v.state !== 'run') v.play('run');
      }
      v.update(dt, p.speed, p.laneVelocity);
    }
    for (const r of this.rivals) {
      const s = r.sim;
      while (r.moveIndex < s.moves.length) {
        const m = s.moves[r.moveIndex++];
        if (m === 'jump') { r.view.play('jump', airTime(PLAYER.jumpVelocity)); r.lock = airTime(PLAYER.jumpVelocity); }
        if (m === 'bounce') { r.view.play('jump', airTime(PLAYER.bounceVelocity)); r.lock = airTime(PLAYER.bounceVelocity); }
        if (m === 'fall') { r.view.play('fall', 0.8); r.lock = 0.8; }
        if (m === 'slide') { r.view.play('slide', PLAYER.slideTime); r.lock = PLAYER.slideTime; }
        if (m === 'stumble') { r.view.play('stumble', 0.9); r.lock = 0.9; }
      }
      r.lock -= dt;
      if (r.lock <= 0 && (this.state === 'race' || this.state === 'done')) r.view.play(s.finished ? 'idle' : 'run');
      r.view.root.position.set(s.x, s.y, -s.d);
      // Rivals between the camera and the player would hide what's coming.
      const behind = p.d - s.d;
      r.view.setOpacity(behind > 1 && behind < 10 ? 0.15 : behind > -1.5 && behind < 10 ? 0.4 : 1, dt);
      r.view.update(dt, s.speed, s.laneVelocity);
    }

    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    if (this.state === 'race' || this.state === 'done') this.hud.update(this.racers(), this.t, dt);
  }

  private updateCamera(dt: number) {
    const p = this.player;
    const cam = this.camera;
    const portrait = cam.aspect < 1;
    const k = 1 - Math.exp(-dt * 8);

    if (this.state === 'menu') {
      // Showcase the selected character from the front.
      cam.position.lerp(new THREE.Vector3(1.2, 1.5, -p.d - 4.8), k);
      cam.lookAt(0, 1.0, -p.d);
      cam.fov = portrait ? 60 : 45;
    } else {
      const target = new THREE.Vector3(p.x * 0.75, 4.3 + p.y * 0.6, -p.d + (portrait ? 7.2 : 6.5));
      cam.position.x += (target.x - cam.position.x) * k;
      cam.position.y += (target.y - cam.position.y) * k;
      cam.position.z = target.z;
      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - dt);
        cam.position.x += (Math.random() - 0.5) * this.shake * 0.8;
        cam.position.y += (Math.random() - 0.5) * this.shake * 0.8;
      }
      cam.lookAt(p.x * 0.5, 1.2 + p.y * 0.5, -p.d - 10);
      const fov = (portrait ? 72 : 58) + p.focus * 0.8;
      cam.fov += (fov - cam.fov) * k;
    }
    cam.updateProjectionMatrix();

    this.sun.position.set(p.x + 6, 16, -p.d + 6);
    this.sun.target.position.set(p.x, 0, -p.d - 10);

    if (this.track) {
      const target = new THREE.Color(BIOMES[biomeAt(this.track.biomes, p.d)].sky);
      this.sky.lerp(target, 1 - Math.exp(-dt * 1.5));
      this.scene.background = this.sky;
      (this.scene.fog as THREE.Fog).color.copy(this.sky);
    }
  }
}
