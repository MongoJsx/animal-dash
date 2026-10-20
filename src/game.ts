// Ties simulation, rendering and UI together: menu → countdown → race → results.
import * as THREE from 'three';
import { DASH, PLAYER, laneX, RACE_LENGTH, RIVAL_COUNT, START_SLOTS, TICK, VIEW_AHEAD, VIEW_BEHIND, STOP_SPEED } from './config.ts';
import { Input } from './core/input.ts';
import { Rng } from './core/rng.ts';
import { botActions } from './entities/bot.ts';
import { resolveContacts } from './entities/contact.ts';
import { Player, type PlayerEvent } from './entities/player.ts';
import { Rival, type RivalSkill, type Traffic } from './entities/rival.ts';
import { Online, type NetMove, type NetMsg } from './net/online.ts';
import { Remote } from './net/remote.ts';
import { CharacterView, preloadCharacters, type AnimState, type CharacterDef } from './render/character.ts';
import { installBend, setBendPath } from './render/bend.ts';
import { Debris } from './render/debris.ts';
import { Environment } from './render/environment.ts';
import { warmUpProps } from './render/props.ts';
import { ObstacleView } from './render/obstacleView.ts';
import { Podium } from './render/podium.ts';
import { Hud, byFinish, desktop, type Racer } from './ui/hud.ts';
import { BIOMES, MAPS, biomeAt, isMapId, type BiomeId, type MapId } from './world/biomes.ts';
import { sunDirection } from './render/sky.ts';
import { movingD, type Obstacle } from './world/obstacles.ts';
import { TrackPath } from './world/path.ts';
import { buildTrack, type Track } from './world/track.ts';

installBend();

type State = 'menu' | 'countdown' | 'race' | 'done' | 'results';

const SKILLS: RivalSkill[] = [
  { mistake: 0.1, pace: 1.0 },
  { mistake: 0.18, pace: 0.99 },
  { mistake: 0.27, pace: 0.985 },
];
const COLORS = ['#ffb703', '#ef476f', '#06d6a0', '#118ab2'];
// Starting box → lane after the merge. The player takes box 1 (nearest the
// start camera); rivals the rest, two of them fighting for the right lane.
const PLAYER_SLOT = 0;
const RIVAL_SLOTS: [slot: number, lane: number][] = [[1, 0], [2, 1], [3, 1]];
const airTime = (v: number) => (2 * v) / PLAYER.gravity;

// Start sequence: "On your marks" → "Set" (held a varying time) → gun.
const MARKS_TIME = 1.7;
const LAUNCH_AT = 0.4; // everyone leaves the blocks together, this long after the gun
const BURST_TIME = 1.25;

interface RivalEntry { sim: Rival | Remote; view: CharacterView; def: CharacterDef; lock: number; moveIndex: number }

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(65, 1, 0.1, 420);
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x8d7b68, 1.7);
  private debris = new Debris();
  private input: Input;
  private hud: Hud;
  private clock = new THREE.Clock();
  private acc = 0;

  private state: State = 'menu';
  private chars: CharacterDef[];
  private selected: string;
  private track!: Track;
  private path!: TrackPath;
  private camTarget = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private env: Environment | null = null;
  private views = new Map<number, ObstacleView>();
  private spawnIndex = 0;
  private player = new Player();
  private playerView: CharacterView | null = null;
  private playerLock = 0;
  private rivals: RivalEntry[] = [];
  private t = 0;
  private countdownT = 0; // time since the start sequence began
  private goAt = 3; // when the gun fires
  /** Wall clock at the gun (ms), for online finish times. */
  private gunWall = 0;
  private phase: 'marks' | 'set' | 'go' = 'marks';
  private gunT = -1; // time since the gun
  private doneT = 0;
  private shake = 0;
  private map: MapId = 'thai';
  private zone: BiomeId | null = null;
  private bot = import.meta.env.DEV && new URLSearchParams(location.search).has('bot');
  private online: Online | null = null;
  private remoteChar: string | null = null;
  private remote: Remote | null = null;
  private sendTick = 0;
  private podium: Podium | null = null;
  /** Finishing order for the ceremony: views by place. */
  private standings: { view: CharacterView; isPlayer: boolean }[] = [];

  constructor(container: HTMLElement, chars: CharacterDef[]) {
    this.chars = chars;
    preloadCharacters(chars);
    const params = new URLSearchParams(location.search);
    this.selected = chars.find((c) => c.id === params.get('char'))?.id ?? chars[0].id;
    let saved: string | null = null;
    try { saved = localStorage.getItem('map'); } catch { /* private mode */ }
    const wanted = params.get('map') ?? saved;
    if (isMapId(wanted)) this.map = wanted;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    this.scene.fog = new THREE.Fog(0xffffff, 45, VIEW_AHEAD * 0.92);

    this.input = new Input(container);
    this.hud = new Hud(container);
    this.hud.onDash = () => this.input.press('dash');
    this.scene.add(this.debris.mesh);
    addEventListener('keydown', (e) => this.menuKey(e));

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
          fps, state: this.state, t: +this.t.toFixed(2), d: +this.player.d.toFixed(1), speed: +this.player.speed.toFixed(1), dash: Math.round(this.player.dash), dashing: this.player.dashing,
          focus: this.player.focus, calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles,
          views: this.views.size, x: +this.player.x.toFixed(2), map: this.map,
          rivals: this.rivals.map((r) => ({ d: +r.sim.d.toFixed(1), x: +r.sim.x.toFixed(2) })),
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
    this.endCeremony();
    for (const v of this.views.values()) this.scene.remove(v.root);
    this.views.clear();
    this.spawnIndex = 0;
    if (this.env) {
      this.scene.remove(this.env.root);
      this.env.dispose();
    }
    for (const r of this.rivals) this.scene.remove(r.view.root);
    this.rivals = [];

    this.track = buildTrack(seed, this.map);
    this.path = new TrackPath(seed, this.track.biomes);
    setBendPath(this.path);
    this.env = new Environment(seed, this.track.biomes, this.track, this.path);
    this.env.snapLook(0);
    this.scene.add(this.env.root);
    this.player = new Player();
    this.player.startSlot(START_SLOTS[PLAYER_SLOT], -1);
    this.t = 0;
    this.zone = null;
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
      // A little hop to say hello.
      this.playerView!.play('victory');
      this.menuCheer = 1.1;
      this.online?.send({ t: 'char', id });
    }, () => this.onStartPressed(), () => this.connect(Online.host()), this.map, (map) => {
      this.map = map;
      try { localStorage.setItem('map', map); } catch { /* private mode */ }
      this.reset(1234);
      this.setPlayerView(this.selected);
      this.playerView!.play('idle');
    });
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
        if (this.online?.role === 'guest') {
          if (isMapId(m.map)) this.map = m.map;
          this.startRace(m.seed);
        }
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
    if (online?.role === 'host') online.send({ t: 'start', seed, map: this.map });
    this.reset(seed);
    this.setPlayerView(this.selected);
    this.remote = null;
    if (online) {
      // Host in box 1 (merging left), guest in box 2 (merging to the middle).
      const mine = online.role === 'host' ? [0, -1] : [1, 0];
      const theirs = online.role === 'host' ? 1 : 0;
      this.player.startSlot(START_SLOTS[mine[0]], mine[1]);
      const def = this.def(this.remoteChar ?? this.chars[0].id);
      this.remote = new Remote(START_SLOTS[theirs]);
      const view = new CharacterView(def, { castShadow: false });
      this.scene.add(view.root);
      this.rivals.push({ sim: this.remote, view, def, lock: 0, moveIndex: 0 });
    } else {
      const rng = new Rng(seed ^ 0x5bd1e995);
      const pool = rng.shuffle(this.chars.filter((c) => c.id !== this.selected));
      for (let i = 0; i < Math.min(RIVAL_COUNT, pool.length); i++) {
        const [slot, lane] = RIVAL_SLOTS[i];
        const sim = new Rival(seed + i * 101, SKILLS[i], START_SLOTS[slot], lane);
        // Rivals use a cheap blob shadow: four shadow-casting characters cost ~60k tris.
        const view = new CharacterView(pool[i], { castShadow: false });
        this.scene.add(view.root);
        this.rivals.push({ sim, view, def: pool[i], lock: 0, moveIndex: 0 });
      }
    }
    this.hud.startRace(this.racers());
    this.state = 'countdown';
    this.countdownT = 0;
    this.phase = 'marks';
    this.gunT = -1;
    // The starter holds "set" for a different time every race (same for both players online).
    this.goAt = MARKS_TIME + 1.1 + new Rng(seed ^ 0x9e3779b9).range(0, 0.9);
    this.playerView!.play('marks');
    for (const r of this.rivals) r.view.play('marks');
    this.hud.countdown('เข้าที่', 'ON YOUR MARKS');
    this.input.clear();
    this.input.enabled = true;
    // Open on the start-line shot (no sweep through the runners).
    const side = this.player.x <= 0 ? -1 : 1;
    this.camTarget.set(THREE.MathUtils.clamp(this.player.x + side * 0.8, -3.2, 3.2), 1.6, this.player.d + 4.5);
    // Dev: start further down the track (?at=1200), optionally without the start (?nocount).
    const at = import.meta.env.DEV ? Number(params.get('at')) : 0;
    if (at > 0) {
      this.player.d = at;
      for (const r of this.rivals) r.sim.d += at;
    }
    if (import.meta.env.DEV && params.has('nocount')) this.goAt = 0.05;
    if (import.meta.env.DEV && params.has('hold')) this.goAt = 1e9;
    if (import.meta.env.DEV && params.has('dash')) this.player.dash = DASH.full;
  }

  private racers(): Racer[] {
    return [
      { name: this.def(this.selected).name, d: this.player.d, isPlayer: true, finished: this.player.finished, finishTime: this.player.finishTime, color: COLORS[0] },
      ...this.rivals.map((r, i) => ({ name: r.sim instanceof Remote ? `เพื่อน · ${r.def.name}` : r.def.name, d: r.sim.d, isPlayer: false, finished: r.sim.finished, finishTime: r.sim.finishTime, color: COLORS[i + 1] })),
    ];
  }

  // ── Loop ────────────────────────────────────────────────────────────
  private slowFrames = 0;

  private frame() {
    const dt = Math.min(0.1, this.clock.getDelta());
    // Phones that can't keep up drop to a lower render resolution.
    if (this.state === 'race' && dt > 1 / 42) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(Math.max(1, this.renderer.getPixelRatio() * 0.75));
      this.resize();
      this.slowFrames = 0;
    }
    this.acc += dt;
    while (this.acc >= TICK) {
      this.step(TICK);
      this.acc -= TICK;
    }
    this.render(dt);
  }

  private step(dt: number) {
    if (this.state === 'countdown') {
      this.countdownT += dt;
      this.input.drain(); // nothing to press in the blocks
      if (this.phase === 'marks' && this.countdownT >= MARKS_TIME) {
        this.phase = 'set';
        this.playerView?.play('set');
        for (const r of this.rivals) r.view.play('set');
        this.hud.countdown('ระวัง…', 'SET');
      }
      if (this.countdownT >= this.goAt) {
        this.state = 'race';
        this.phase = 'go';
        this.gunT = 0;
        this.gunWall = performance.now();
        this.shake = 0.12;
        this.hud.countdown('ปัง! ไป!', 'GO');
      }
      return;
    }
    if (this.state !== 'race' && this.state !== 'done') return;

    if (this.gunT >= 0 && this.gunT < 3) {
      this.gunT += dt;
      if (this.gunT >= LAUNCH_AT) {
        for (const r of this.rivals) if (r.sim instanceof Rival) r.sim.launch();
      }
    }

    this.t += dt;
    const p = this.player;
    const actions = this.input.drain();
    if (!p.launched) {
      // Same start for everyone; lane changes pressed on the launch frame still count.
      if (this.gunT >= LAUNCH_AT) {
        p.launch();
        this.onLaunch();
      }
      const keep = p.launched ? actions.filter((a) => a === 'left' || a === 'right') : [];
      actions.length = 0;
      actions.push(...keep);
    }
    if (this.bot && !p.finished && p.launched) actions.push(...botActions(p, this.track, this.t), ...(p.dashReady ? ['dash' as const] : []));
    p.step(dt, this.t, actions, this.track);
    if (!p.finished && p.d >= RACE_LENGTH) p.finish(this.finishClock());
    for (const e of p.events) this.onPlayerEvent(e);
    p.events.length = 0;

    if (this.online?.connected && this.remote && ++this.sendTick % 3 === 0) {
      this.online.send({ t: 's', d: +p.d.toFixed(2), x: +p.x.toFixed(2), y: +p.y.toFixed(2), v: +p.speed.toFixed(2) });
    }

    for (const r of this.rivals) {
      if (r.sim instanceof Remote) { r.sim.step(dt); continue; }
      r.sim.step(dt, this.track, p.d, this.traffic(r.sim));
      if (!r.sim.finished && r.sim.d >= RACE_LENGTH) r.sim.finish(this.t);
    }
    this.contacts();

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
        this.ceremony();
      }
    }
  }

  // ── Ceremony ────────────────────────────────────────────────────────
  /** Top three onto the podium, medals, confetti; everyone else stands by. */
  private ceremony() {
    const racers = this.racers();
    const views = [this.playerView!, ...this.rivals.map((r) => r.view)];
    const order = racers.map((_, i) => i).sort((a, b) => byFinish(racers[a], racers[b]));
    this.standings = order.map((i) => ({ view: views[i], isPlayer: racers[i].isPlayer }));
    const podium = new Podium(this.player.d + 9);
    this.podium = podium;
    this.scene.add(podium.root);
    this.cheer = [];
    this.standings.forEach((s, place) => {
      s.view.play(place < 3 ? 'idle' : 'defeat');
      s.view.root.visible = true;
      if (place < 3) podium.award(place, s.view);
    });
    podium.onMedal = (place) => {
      this.standings[place].view.play('victory');
      // The runners-up settle down again; the champion keeps celebrating.
      if (place > 0) this.cheer[place] = 2.6;
      if (place === 0) this.shake = 0.08;
    };
    this.hud.showResults(order.map((i) => racers[i]), `${MAPS[this.map].flag} ${MAPS[this.map].name}`, (btn) => this.again(btn), () => this.showMenu());
  }

  private cheer: number[] = [];
  private endPose: AnimState = 'idle';

  /** The time to record at the line. Online it is real time since the gun: the
   *  game clock stalls when a device stutters or its tab sleeps, so two players'
   *  game times can put the one who crossed second in first place. */
  private finishClock() {
    return this.remote ? (performance.now() - this.gunWall) / 1000 : this.t;
  }

  /** Finishing place for a finish time (1 = first). */
  private placeOf(time: number) {
    const times = [this.player, ...this.rivals.map((r) => r.sim)].filter((s) => s.finished).map((s) => s.finishTime);
    return 1 + times.filter((t) => t < time).length;
  }
  private menuCheer = 0;
  private viewOffset = new THREE.Vector2();

  private endCeremony() {
    if (!this.podium) return;
    this.podium.dispose();
    this.podium = null;
    for (const s of this.standings) s.view.root.visible = true;
    this.standings = [];
    this.camera.clearViewOffset();
    this.viewOffset.set(0, 0);
  }

  /** Runners onto their steps; the 4th stands by only where the shot is wide enough. */
  private updateCeremony(dt: number) {
    const podium = this.podium!;
    const portrait = this.camera.aspect < 1;
    this.standings.forEach((s, place) => {
      podium.spot(place, s.view.root.position);
      s.view.root.visible = place < 3 || !portrait || s.isPlayer;
      if (this.cheer[place] > 0 && (this.cheer[place] -= dt) <= 0) s.view.play('idle');
    });
    podium.update(dt);
  }

  /** Name tags over the heads on the podium. */
  private placeTags() {
    const podium = this.podium!;
    const v = new THREE.Vector3();
    const w = innerWidth, h = innerHeight;
    this.hud.placeTags(this.standings.map((s, place) => {
      const shown = s.view.root.visible && (place < 3 ? podium.landed(place) : podium.time > 2.4);
      if (!shown) return null;
      const p = s.view.root.position;
      this.path.toWorld(p.x, p.y + 1.95, -p.z, v).project(this.camera);
      return v.z < 1 ? { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h } : null;
    }));
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

  private onLaunch() {
    this.playerView?.play('burst', BURST_TIME);
    this.playerLock = BURST_TIME;
    this.online?.send({ t: 'm', m: 'launch' });
  }

  /** Everyone else's position, for a rival choosing a lane. */
  private traffic(self: Rival): Traffic[] {
    const out: Traffic[] = [{ x: this.player.x, d: this.player.d }];
    for (const r of this.rivals) if (r.sim !== self) out.push({ x: r.sim.x, d: r.sim.d });
    return out;
  }

  /** Runners are solid (a friend's Remote has no bump methods, so it is never moved). */
  private contacts() {
    resolveContacts([this.player, ...this.rivals.map((r) => r.sim)]);
  }

  private onPlayerEvent(e: PlayerEvent) {
    const v = this.playerView;
    if (this.remote && this.online?.connected) {
      if (e.type === 'finish') this.online.send({ t: 'fin', time: this.player.finishTime });
      else if (['jump', 'bounce', 'slide', 'stumble', 'fall', 'dash', 'stunned'].includes(e.type)) this.online.send({ t: 'm', m: e.type as NetMove });
      else if (e.type === 'shoved') this.online.send({ t: 'm', m: 'stunned' }); // the friend sees the stagger
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
      case 'bump':
        this.shake = Math.max(this.shake, 0.1);
        this.hud.flash(e.side ? 'เบียด!' : 'ชน!');
        break;
      case 'smash':
        this.smashView(e.obstacle);
        if (this.player.dashing) this.shake = Math.max(this.shake, 0.12);
        break;
      case 'dash':
        v?.play('burst', DASH.time);
        this.playerLock = DASH.time;
        this.shake = 0.25;
        this.hud.flash('DASH!!', 'good');
        this.hud.setFocus(this.player.focus);
        break;
      case 'dashReady':
        this.hud.flash(desktop ? 'แดชพร้อม! กด Shift' : 'แดชพร้อม! กดปุ่ม DASH', 'good');
        break;
      case 'shoved':
        v?.play('stumble', 0.35);
        this.playerLock = 0.35;
        this.shake = Math.max(this.shake, 0.18);
        this.hud.flash('โดนเบียด!');
        this.hud.hit();
        break;
      case 'barged':
        this.shake = Math.max(this.shake, 0.1);
        this.hud.flash('เบียดออกไป!', 'good');
        break;
      case 'stunned':
        v?.play('stumble', 0.45);
        this.playerLock = 0.45;
        this.shake = 0.3;
        this.hud.flash('โดนพุ่งชน!');
        this.hud.hit();
        break;
      case 'focus':
        this.hud.setFocus(e.level);
        if (e.level === 10) this.hud.flash('FOCUS MAX!', 'good');
        break;
      case 'finish': {
        // A friend already over the line may not have sent their time yet.
        const place = 1 + this.rivals.filter((r) => r.sim.finished || (r.sim instanceof Remote && r.sim.d >= RACE_LENGTH)).length;
        // Run it out first; the pose comes once they've slowed (see render).
        this.endPose = place === 1 ? 'victory' : 'defeat';
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
      const end = movingD(v.o, this.t) + v.o.length;
      if (end < d - VIEW_BEHIND) {
        this.scene.remove(v.root);
        this.views.delete(id);
      } else {
        v.update(this.t, dt);
        // Behind the runner = between them and the camera: see through it.
        v.setGhost(end < d - 0.3 || (v.o.hit && v.o.d < d + 2));
      }
    }
  }

  private render(dt: number) {
    const p = this.player;
    if (this.track) this.syncObstacles(dt);

    if (this.playerView) {
      const v = this.playerView;
      if (!this.podium) v.root.position.set(p.x, p.y, -p.d);
      if (this.state === 'race') {
        this.playerLock -= dt;
        if (this.playerLock <= 0 && p.launched && p.grounded && !p.sliding && !p.stunned && v.state !== 'run') v.play('run');
      } else if (this.state === 'done' && !this.podium) {
        this.playerLock -= dt;
        if (p.speed < STOP_SPEED) { if (v.state !== this.endPose) v.play(this.endPose); }
        else if (this.playerLock <= 0 && p.grounded && v.state !== 'run') v.play('run');
      }
      if (p.jolt) { v.kick(p.jolt); p.jolt = 0; }
      if (p.dashing) this.trail(p.x, p.y, p.d);
      v.update(dt, this.podium ? 0 : p.speed, this.podium ? 0 : p.laneVelocity);
    }
    this.debris.update(dt);
    for (const r of this.rivals) {
      const s = r.sim;
      while (r.moveIndex < s.moves.length) {
        const m = s.moves[r.moveIndex++];
        if (m === 'launch') { r.view.play('burst', BURST_TIME); r.lock = BURST_TIME; }
        if (m === 'dash') { r.view.play('burst', DASH.time); r.lock = DASH.time; }
        if (m === 'stunned') { r.view.play('stumble', 0.45); r.lock = 0.45; }
        if (m === 'jump') { r.view.play('jump', airTime(PLAYER.jumpVelocity)); r.lock = airTime(PLAYER.jumpVelocity); }
        if (m === 'bounce') { r.view.play('jump', airTime(PLAYER.bounceVelocity)); r.lock = airTime(PLAYER.bounceVelocity); }
        if (m === 'fall') { r.view.play('fall', 0.8); r.lock = 0.8; }
        if (m === 'slide') { r.view.play('slide', PLAYER.slideTime); r.lock = PLAYER.slideTime; }
        if (m === 'stumble') { r.view.play('stumble', 0.9); r.lock = 0.9; }
      }
      r.lock -= dt;
      const started = s instanceof Rival ? s.launched : s.d > 0.3;
      if (r.lock <= 0 && started && (this.state === 'race' || this.state === 'done')) {
        // Past the line they run it out, then the winner celebrates.
        const stopped = s.finished && s.speed < STOP_SPEED;
        r.view.play(!stopped ? 'run' : this.placeOf(s.finishTime) === 1 ? 'victory' : 'idle');
      }
      if (!this.podium) r.view.root.position.set(s.x, s.y, -s.d);
      if ('jolt' in s && s.jolt) { r.view.kick(s.jolt); s.jolt = 0; }
      if (s.dashing) this.trail(s.x, s.y, s.d);
      // Rivals between the camera and the player would hide what's coming.
      const behind = p.d - s.d;
      const racing = this.state === 'race' || this.state === 'done';
      r.view.setOpacity(!racing || this.gunT < 1.5 ? 1 : behind > 1 && behind < 10 ? 0.15 : behind > -1.5 && behind < 10 ? 0.4 : 1, dt);
      r.view.update(dt, this.podium ? 0 : s.speed, this.podium ? 0 : s.laneVelocity);
    }
    if (this.podium) this.updateCeremony(dt);
    if (this.menuCheer > 0 && (this.menuCheer -= dt) <= 0 && this.state === 'menu') this.playerView?.play('idle');

    this.updateCamera(dt);
    if (this.env) {
      this.env.update(p.d, dt, this.camera.position);
      this.applyLook();
    }
    if (this.track && (this.state === 'race' || this.state === 'done')) {
      const zone = biomeAt(this.track.biomes, p.d);
      if (zone !== this.zone) {
        if (this.zone !== null) this.hud.zoneTitle(`${MAPS[this.map].flag} ${BIOMES[zone].name}`);
        this.zone = zone;
      }
    }
    // Bounds are in straight space but drawn bent: cull nothing.
    this.scene.traverse((o) => { o.frustumCulled = false; });
    this.renderer.render(this.scene, this.camera);
    if (this.podium) this.placeTags();
    if (this.state === 'race' || this.state === 'done') {
      this.hud.update(this.racers(), this.t, dt);
      this.hud.setDash(p.dash / DASH.full, p.dashing);
    }
  }

  /** Speed streaks behind a dashing runner. */
  private trail(x: number, y: number, d: number) {
    for (let i = 0; i < 2; i++) this.debris.streak(x + (Math.random() - 0.5) * 0.9, y + 0.2 + Math.random() * 1.4, d - 0.6 - Math.random() * 0.8, Math.random() < 0.5 ? 0xffffff : 0xffd166);
  }

  /** Smashed: pop the model and throw chunks in its colours. */
  private smashView(o: Obstacle) {
    this.views.get(o.id)?.smash();
    const pal = BIOMES[o.biome];
    const colors = [pal.a, pal.c, pal.b, 0xffffff];
    const x = o.kind === 'shifter' || o.kind === 'pendulum' || o.kind === 'sweeper' ? this.player.x : laneX(o.lane);
    const fwd = this.player.speed * 0.5;
    this.debris.burst(x, 0.8, o.d + Math.min(o.length, 2) / 2, colors, 16, 1, fwd);
  }

  /** Keyboard on the menu and results screens. */
  private menuKey(e: KeyboardEvent) {
    if (this.state === 'menu') {
      if (e.key === 'Enter') { e.preventDefault(); this.onStartPressed(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const i = this.chars.findIndex((c) => c.id === this.selected);
        const next = this.chars[(i + (e.key === 'ArrowRight' ? 1 : this.chars.length - 1)) % this.chars.length];
        document.querySelector<HTMLButtonElement>(`.char[data-id="${next.id}"]`)?.click();
      }
    } else if (this.state === 'results' && e.key === 'Enter') {
      e.preventDefault();
      document.querySelector<HTMLButtonElement>('.results .again')?.click();
    }
  }

  /** Lights, fog and sky follow the zone's look. */
  private applyLook() {
    const l = this.env!.look;
    this.hemi.color.copy(l.hemiSky);
    this.hemi.groundColor.copy(l.hemiGround);
    this.hemi.intensity = l.hemiI;
    this.sun.color.copy(l.sun);
    this.sun.intensity = l.sunI;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(l.horizon);
    fog.near = l.fogNear;
    fog.far = Math.min(l.fogFar, VIEW_AHEAD + 30);
    this.scene.background = l.horizon;
    const at = this.path.toWorld(this.player.x, 0, this.player.d + 8, new THREE.Vector3());
    this.sun.target.position.copy(at);
    // Shadows from the zone's sun, kept steep enough to stay readable.
    const dir = sunDirection(Math.max(0.55, l.sunAngle), new THREE.Vector3());
    this.sun.position.copy(at).addScaledVector(dir, 30);
  }

  private updateCamera(dt: number) {
    const p = this.player;
    const cam = this.camera;
    const portrait = cam.aspect < 1;
    const k = 1 - Math.exp(-dt * 8);
    // The camera is placed in straight track space, then bent onto the path.
    const t = this.camTarget;
    const look = this.camLook;

    if (this.state === 'menu') {
      // Showcase the selected character from the front.
      t.lerp(new THREE.Vector3(p.x + 1.2, 1.5, p.d + 4.8), k);
      look.set(p.x, 1.0, p.d);
      cam.fov = portrait ? 60 : 45;
    } else if (this.podium) {
      // Ceremony: start tight on the champion, pull back to frame the podium in
      // the space the title and the results panel leave free.
      const pd = this.podium.d;
      const w = innerWidth, h = innerHeight;
      const ins = this.hud.podiumInsets();
      const fw = Math.max(0.35, (w - ins.right) / w);
      const fh = Math.max(0.35, (h - ins.top - ins.bottom) / h);
      cam.fov = portrait ? 50 : 38;
      const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      const wide = this.standings.slice(3).some((s) => s.view.root.visible);
      const halfW = wide ? (portrait ? 3.25 : 3.6) : 2.2;
      const dist = Math.max(halfW / (tan * cam.aspect * fw), 1.75 / (tan * fh));
      const tt = this.podium.time;
      const e = THREE.MathUtils.smootherstep(tt, 0.3, 2.9);
      const sway = Math.sin(tt * 0.35) * 0.35 * e;
      t.set(THREE.MathUtils.lerp(1.1, sway, e), THREE.MathUtils.lerp(2.3, 2.05, e), pd + THREE.MathUtils.lerp(3.2, dist, e));
      look.set(THREE.MathUtils.lerp(0, (wide ? -0.4 : 0), e), THREE.MathUtils.lerp(2.0, 1.62, e), pd);
      this.viewOffset.lerp(new THREE.Vector2(ins.right / 2, (ins.bottom - ins.top) / 2).multiplyScalar(e), 1 - Math.exp(-dt * 6));
      cam.setViewOffset(w, h, this.viewOffset.x, this.viewOffset.y, w, h);
    } else if (this.state === 'countdown') {
      // TV shot along the start line: low beside your box, your runner big in
      // the foreground and the field crouched beyond; it creeps in on "set".
      const set = this.phase === 'set' ? Math.min(1, (this.countdownT - MARKS_TIME) / 1.5) : 0;
      const k2 = 1 - Math.exp(-dt * 2.5);
      // Keep the camera on the track, clear of walls, stands and the gantry posts.
      const side = p.x <= 0 ? -1 : 1;
      const cx = THREE.MathUtils.clamp(p.x + side * 0.8, -3.2, 3.2);
      t.lerp(new THREE.Vector3(cx, (portrait ? 1.25 : 1.0) - set * 0.12, p.d + (portrait ? 3.8 : 2.4) - set * 0.5), k2);
      look.set(p.x - side * (portrait ? 0.9 : 2.0), 0.4, p.d - 0.5);
      cam.fov += ((portrait ? 66 : 50) - cam.fov) * k2;
    } else {
      // Swoop round behind the runner after the gun, then follow tightly.
      const swoop = this.gunT >= 0 && this.gunT < 1.6;
      const kz = swoop ? 1 - Math.exp(-dt * (2 + this.gunT * 6)) : 1;
      t.x += (p.x * 0.75 - t.x) * (swoop ? kz : k);
      t.y += (4.3 + p.y * 0.6 - t.y) * (swoop ? kz : k);
      t.z += (p.d - (portrait ? 7.2 : 6.5) - t.z) * kz;
      look.set(p.x * 0.5, 1.2 + p.y * 0.5, p.d + 10);
      look.lerp(new THREE.Vector3(-0.4, 0.55, p.d), swoop ? Math.max(0, 1 - this.gunT * 1.4) : 0);
      const fov = (portrait ? 72 : 58) + p.focus * 0.8 + (p.launched ? Math.max(0, 1 - this.gunT) * 6 : 0) + (p.dashing ? 9 : 0);
      cam.fov += (fov - cam.fov) * k;
    }
    this.path.toWorld(t.x, t.y, t.z, cam.position);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.8;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.8;
    }
    const w = this.path.toWorld(look.x, look.y, look.z, new THREE.Vector3());
    cam.lookAt(w);
    // Bank a little into bends.
    if (this.state === 'race' || this.state === 'done') cam.rotateZ(THREE.MathUtils.clamp(this.path.frame(p.d + 12).curve * 9, -0.07, 0.07));
    cam.updateProjectionMatrix();
  }
}
