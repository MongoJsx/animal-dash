// Ties simulation, rendering and UI together: menu → countdown → race → results.
import * as THREE from 'three';
import { DASH, ITEM, PLAYER, laneX, RACE_LENGTH, RIVAL_COUNT, START_SLOTS, TICK, VIEW_AHEAD, VIEW_BEHIND, STOP_SPEED } from './config.ts';
import { COUNTDOWN_GO, sound, type Surface } from './core/audio.ts';
import { DOUBLE_GAP, Input, type Action } from './core/input.ts';
import { Rng } from './core/rng.ts';
import { botActions } from './entities/bot.ts';
import { resolveContacts } from './entities/contact.ts';
import { Player, type PlayerEvent } from './entities/player.ts';
import { Rival, type RivalSkill, type Traffic } from './entities/rival.ts';
import { Online, type NetMove, type NetMsg } from './net/online.ts';
import { Remote } from './net/remote.ts';
import { CharacterView, preloadCharacters, type AnimState, type CharacterDef } from './render/character.ts';
import { installBend, setBendPath } from './render/bend.ts';
import { installGrade } from './render/grade.ts';
import { Debris } from './render/debris.ts';
import { Environment } from './render/environment.ts';
import { Juice } from './render/juice.ts';
import { Crowd } from './render/crowd.ts';
import { setWind } from './render/shapes.ts';
import { Bubble, ItemBoxes, ItemTag, RocketPack } from './render/itemView.ts';
import { warmUpProps } from './render/props.ts';
import { ObstacleView } from './render/obstacleView.ts';
import { Podium } from './render/podium.ts';
import { Hud, byFinish, desktop, type Racer } from './ui/hud.ts';
import { BIOMES, MAPS, biomeAt, isMapId, type BiomeId, type MapId } from './world/biomes.ts';
import { sunDirection } from './render/sky.ts';
import { ITEM_ICON, ITEM_NAME, rollItem, touches, type ItemKind } from './world/items.ts';
import { movingD, type Obstacle } from './world/obstacles.ts';
import { TrackPath } from './world/path.ts';
import { buildTrack, type Track } from './world/track.ts';

installBend();
installGrade();

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

// Start sequence: "On your marks", then the 3-2-1 count (a beep a second, the
// clip starting at COUNT_AT); "set" on the 1 and the gun on its "GO".
const COUNT_AT = 0.4;
const GO_AT = COUNT_AT + COUNTDOWN_GO;
// What the player's footsteps sound like in each zone.
const SURFACE: Record<BiomeId, Surface> = {
  village: 'grass', forest: 'grass', candy: 'grass', harbor: 'wood', snow: 'snow',
  th_city: 'concrete', th_palace: 'concrete', th_market: 'concrete', th_fields: 'grass',
  cn_wall: 'concrete', cn_bamboo: 'grass', cn_town: 'concrete', cn_guilin: 'grass',
  jp_sakura: 'grass', jp_torii: 'grass', jp_tokyo: 'concrete', jp_snow: 'snow',
};
const MARKS_TIME = GO_AT - 1;
const LAUNCH_AT = 0.4; // everyone leaves the blocks together, this long after the gun
const BURST_TIME = 1.25;
const START_LEAD = 1.5; // online: the start sequence begins this long after the host presses start
const START_MIRROR = 1.2; // online: after the launch, a friend is drawn at least at our speed this long
const MAX_CATCH_UP = 0.25; // online: most race time (s) one frame may simulate to keep up with the shared clock

interface RivalEntry { sim: Rival | Remote; view: CharacterView; def: CharacterDef; lock: number; moveIndex: number; bubble: Bubble; shield: boolean; rocket: RocketPack; tag: ItemTag }

const POP_COLORS = [0x7ae0ff, 0xffffff, 0xbdf3ff];
const INK_COLORS = [0x120c24, 0x2a1f4d, 0x000000];
const BOX_COLORS = [0xffe066, 0xff9f1c, 0xff5d8f, 0xffffff];

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(65, 1, 0.1, 420);
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x8d7b68, 1.7);
  private debris = new Debris();
  private juice = new Juice();
  private crowd: Crowd | null = null;
  private itemBoxes: ItemBoxes | null = null;
  private playerBubble = new Bubble();
  private playerRocket = new RocketPack();
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
  private goAt = GO_AT; // when the gun fires
  private beat = 0; // count shown so far (1 = "3" … 3 = "1")
  private countPlayed = false;
  /** Online: the host's clock (ms) when the start sequence began (null offline). */
  private startAt: number | null = null;
  /** Online: the host's clock (ms) at the gun, for finish times both sides agree on. */
  private gunWall = 0;
  private phase: 'marks' | 'set' | 'go' = 'marks';
  private gunT = -1; // time since the gun
  private doneT = 0;
  private settleT = 0; // since the last runner crossed
  private shake = 0;
  private map: MapId = 'thai';
  private zone: BiomeId | null = null;
  private bot = import.meta.env.DEV && new URLSearchParams(location.search).has('bot');
  private online: Online | null = null;
  private remoteChar: string | null = null;
  private remote: Remote | null = null;
  /** The player is over the line and was told how many are still out (0 = not told). */
  private waitTold = 0;
  /** Menu: choosing between a new room and typing in a friend's code. */
  private joining = false;
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
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
    this.scene.add(this.debris.mesh, this.juice.root, this.playerBubble.mesh, this.playerRocket.root);
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
          focus: this.player.focus, item: this.player.item, shield: this.player.shield, calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles,
          views: this.views.size, x: +this.player.x.toFixed(2), y: +this.player.y.toFixed(2), map: this.map,
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
    for (const r of this.rivals) this.scene.remove(r.view.root, r.bubble.mesh, r.rocket.root, r.tag.sprite);
    this.rivals = [];

    this.track = buildTrack(seed, this.map);
    if (this.itemBoxes) {
      this.scene.remove(this.itemBoxes.mesh);
      this.itemBoxes.dispose();
    }
    this.itemBoxes = new ItemBoxes(this.track.items);
    this.scene.add(this.itemBoxes.mesh);
    if (this.crowd) {
      this.scene.remove(this.crowd.mesh);
      this.crowd.dispose();
    }
    this.crowd = new Crowd(seed);
    this.scene.add(this.crowd.mesh);
    this.path = new TrackPath(seed, this.track.biomes);
    setBendPath(this.path);
    this.juice.setPath(this.path);
    this.env = new Environment(seed, this.track.biomes, this.track, this.path);
    this.env.snapLook(0);
    this.scene.add(this.env.root);
    this.player = new Player();
    this.player.startSlot(START_SLOTS[PLAYER_SLOT], -1);
    this.t = 0;
    this.zone = null;
    this.waitTold = 0;
  }

  private setPlayerView(id: string) {
    if (this.playerView) this.scene.remove(this.playerView.root);
    this.playerView = new CharacterView(this.def(id));
    this.scene.add(this.playerView.root);
  }

  private showMenu() {
    this.state = 'menu';
    sound.setMusic('menu');
    this.quietBeds();
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
    }, () => this.onStartPressed(), () => { this.joining = true; this.updateLobby(); }, this.map, (map) => {
      this.map = map;
      try { localStorage.setItem('map', map); } catch { /* private mode */ }
      this.reset(1234);
      this.setPlayerView(this.selected);
      this.playerView!.play('idle');
    });
    this.updateLobby();
  }

  /** On the menu with no room open: safe to reload for a new version. */
  get idle() {
    return this.state === 'menu' && !this.online && !this.joining;
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
          this.startRace(m.seed, m.at);
        }
        break;
      case 'again':
        if (this.online?.role === 'host' && this.state === 'results') this.startRace();
        break;
      case 's':
        this.remote?.receive(m.d, m.x, m.y, m.v, this.sinceSent(m.v, m.w));
        if (m.f !== undefined && this.remote && !this.remote.finished) this.remote.finish(m.f);
        break;
      case 'm':
        this.remote?.move(m.m);
        break;
      case 'fin':
        this.remote?.finish(m.time);
        break;
      case 'ink':
        if (this.state === 'race') this.player.ink();
        break;
      case 'sh':
        if (this.remote) this.remote.shield = m.on;
        break;
      case 'rk':
        if (this.remote) this.remote.rocket = m.on;
        break;
      case 'it':
        if (this.remote) this.remote.item = m.k;
        break;
    }
  }

  private onStartPressed() {
    if (!this.online) { this.joining = false; sound.click(); this.startRace(); }
    else if (this.online.role === 'host' && this.online.connected) { sound.click(); this.startRace(); }
  }

  private updateLobby() {
    if (this.state !== 'menu') return;
    const o = this.online;
    if (!o) {
      if (this.joining) this.showJoin();
      else this.hud.setLobby(null);
      return;
    }
    const friend = this.remoteChar ? this.def(this.remoteChar).name : '…';
    const code = `<b class="code">${o.code.toUpperCase()}</b>`;
    // One compact line: what's going on on the left, a way out (✕) on the right.
    const line = (status: string, extra = '') =>
      `<div class="lob-row"><div class="lob-text">${status}</div>${extra}<button class="lob-x" data-act="leave" aria-label="ออกจากห้อง">✕</button></div>`;
    let html: string;
    let start: string;
    let ready = false;
    let actions: Record<string, () => void> = { leave: () => this.leaveOnline() };
    if (o.status === 'error' || o.status === 'closed') {
      html = line(`<span class="err">${o.status === 'error' ? o.error : 'เพื่อนออกจากห้องแล้ว'}</span>`);
      start = 'กด ✕ เพื่อเล่นคนเดียว';
    } else if (o.role === 'host' && !o.connected) {
      html = line(`<span>ห้อง ${code}</span><small>ส่งรหัสหรือลิงก์ให้เพื่อน</small>`, '<button class="lob-share" data-act="share">📋 แชร์</button>');
      actions = { ...actions, share: () => this.shareLink(o) };
      start = 'รอเพื่อนเข้าห้อง…';
    } else if (o.role === 'host') {
      html = line(`<span class="ok">✓ เพื่อนเข้าห้องแล้ว</span><small>เพื่อนเลือก <b>${friend}</b></small>`);
      start = 'เริ่มแข่ง!';
      ready = true;
    } else if (!o.connected) {
      html = line(`<span>กำลังเข้าห้อง ${code}…</span>`);
      start = 'กำลังเชื่อมต่อ…';
    } else {
      html = line(`<span class="ok">✓ เข้าห้อง ${code} แล้ว</span><small>เจ้าห้องเลือก <b>${friend}</b></small>`);
      start = 'รอเจ้าห้องกดเริ่ม…';
    }
    this.hud.setLobby({ html, start, ready, guest: o.role === 'guest', actions });
  }

  /** Play with a friend: open a new room, or type in the code of theirs. */
  private showJoin(error = '', typed = '') {
    const html = `<div class="lob-row"><button class="host-btn" data-act="host">🏠 สร้างห้อง</button><button class="lob-x" data-act="cancel" aria-label="ยกเลิก">✕</button></div>
      <div class="join-row"><input class="room-code" maxlength="40" placeholder="หรือกรอกรหัสห้องเพื่อน" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go"><button class="join-btn" data-act="join">เข้า</button></div>
      ${error ? `<div class="err">${error}</div>` : ''}`;
    this.hud.setLobby({
      html,
      start: 'เริ่มแข่งคนเดียว',
      ready: true,
      actions: {
        host: () => { this.joining = false; this.connect(Online.host()); },
        join: () => this.joinTyped(),
        cancel: () => { this.joining = false; this.updateLobby(); },
      },
    });
    const input = document.querySelector<HTMLInputElement>('.lobby .room-code');
    if (!input) return;
    input.value = typed;
    // Keys typed here are text, not menu shortcuts (Enter = join).
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.joinTyped(); }
    });
    if (error) input.focus();
  }

  private joinTyped() {
    const raw = document.querySelector<HTMLInputElement>('.lobby .room-code')?.value ?? '';
    const room = Online.parseCode(raw);
    if (!room) {
      this.showJoin(raw.trim() ? 'รหัสห้องไม่ถูกต้อง (5 ตัวอักษร เช่น ABC23)' : 'กรอกรหัสห้องก่อน', raw);
      return;
    }
    this.joining = false;
    const online = Online.join(room.code, room.broker);
    history.replaceState(null, '', online.link);
    this.connect(online);
  }

  private shareLink(o: Online) {
    const url = o.link;
    if (navigator.share) {
      navigator.share({ title: 'วิ่งซิ่งข้ามโลก', text: 'มาวิ่งแข่งกัน!', url }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(url).then(() => this.hud.flash('คัดลอกลิงก์แล้ว', 'good'), () => {});
    }
  }

  /** @param netAt online: when the start sequence begins, on the host's clock (ms) */
  private startRace(netSeed?: number, netAt?: number) {
    const params = new URLSearchParams(location.search);
    const seed = netSeed ?? (Number(params.get('seed')) || (Math.random() * 2 ** 31) | 0);
    const online = this.online?.connected ? this.online : null;
    // Online both sides run the start off the shared clock: a moment from now,
    // so the start message has time to reach the guest first.
    this.startAt = online ? netAt ?? online.now() + START_LEAD * 1000 : null;
    if (online?.role === 'host') online.send({ t: 'start', seed, map: this.map, at: this.startAt! });
    this.reset(seed);
    this.setPlayerView(this.selected);
    this.remote = null;
    this.startPath = [];
    this.tapItemAt = -1;
    if (online) {
      // Host in box 1 (merging left), guest in box 2 (merging to the middle).
      const mine = online.role === 'host' ? [0, -1] : [1, 0];
      const theirs = online.role === 'host' ? 1 : 0;
      this.player.startSlot(START_SLOTS[mine[0]], mine[1]);
      const def = this.def(this.remoteChar ?? this.chars[0].id);
      this.remote = new Remote(START_SLOTS[theirs]);
      const view = new CharacterView(def, { castShadow: false });
      const bubble = new Bubble(), rocket = new RocketPack(), tag = new ItemTag();
      this.scene.add(view.root, bubble.mesh, rocket.root, tag.sprite);
      this.rivals.push({ sim: this.remote, view, def, lock: 0, moveIndex: 0, bubble, shield: false, rocket, tag });
    } else {
      const rng = new Rng(seed ^ 0x5bd1e995);
      const pool = rng.shuffle(this.chars.filter((c) => c.id !== this.selected));
      for (let i = 0; i < Math.min(RIVAL_COUNT, pool.length); i++) {
        const [slot, lane] = RIVAL_SLOTS[i];
        const sim = new Rival(seed + i * 101, SKILLS[i], START_SLOTS[slot], lane);
        // Rivals use a cheap blob shadow: four shadow-casting characters cost ~60k tris.
        const view = new CharacterView(pool[i], { castShadow: false });
        const bubble = new Bubble(), rocket = new RocketPack(), tag = new ItemTag();
        this.scene.add(view.root, bubble.mesh, rocket.root, tag.sprite);
        this.rivals.push({ sim, view, def: pool[i], lock: 0, moveIndex: 0, bubble, shield: false, rocket, tag });
      }
    }
    sound.setMusic(null);
    this.focusHeard = 0;
    this.hud.startRace(this.racers());
    this.state = 'countdown';
    this.countdownT = 0;
    this.phase = 'marks';
    this.gunT = -1;
    this.goAt = GO_AT;
    this.beat = 0;
    this.countPlayed = false;
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
    const item = import.meta.env.DEV ? params.get('item') : null;
    if (item && item in ITEM_NAME && this.player.give(item as ItemKind)) this.player.itemRoll = 0;
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
    // Online, the race runs on the shared clock: a frame that stalls (a slow
    // phone, a hitch at the gun) is caught up, so neither side falls behind
    // the other just because its screen hiccupped.
    const lag = this.raceLag();
    if (lag !== null) this.acc = Math.min(lag, MAX_CATCH_UP);
    while (this.acc >= TICK) {
      this.step(TICK);
      this.acc -= TICK;
    }
    this.render(dt);
  }

  /**
   * Metres a friend has run since a packet left them: its age on the shared
   * clock (ignoring a wild reading) at the speed it carried. Through the pick-up
   * that speed is stale and low, but everyone accelerates alike, so they have
   * gone at least as far as we went over the same stretch of time.
   */
  private sinceSent(v: number, w?: number) {
    if (!w || !this.online) return 0;
    const age = Math.min(1, Math.max(0, (this.online.now() - w) / 1000));
    const then = this.startPath[Math.round((w - this.gunWall) / 1000 / TICK)];
    return Math.max(v * age, this.gunT < LAUNCH_AT + START_MIRROR && then !== undefined ? this.player.d - then : 0);
  }
  /** Online: the player's distance at each tick since the gun (for `sinceSent`). */
  private startPath: number[] = [];

  /** A single tap that may yet become a dash: the race time it turns into using the item. */
  private tapItemAt = -1;

  /**
   * A tap uses the held item, unless it is the first half of a double-tap dash.
   * Only when a dash is ready is there anything to tell apart, so only then does
   * the item wait a moment for a second tap.
   */
  private takeTaps(actions: Action[]) {
    const p = this.player;
    const out: Action[] = actions.filter((a) => a !== 'tap');
    if (out.includes('dash')) this.tapItemAt = -1;
    else if (actions.includes('tap')) {
      if (p.dashReady) this.tapItemAt = this.t + DOUBLE_GAP / 1000;
      else out.push('item');
    }
    if (this.tapItemAt >= 0 && this.t >= this.tapItemAt) {
      this.tapItemAt = -1;
      out.push('item');
    }
    return out;
  }

  /** Online: the shared-clock moment (ms) the game's race time stands for (a frame catching up runs behind now). */
  private raceWall() {
    return this.startAt !== null ? this.gunWall + this.t * 1000 : this.online!.now();
  }

  /** Online racing: shared-clock time since the gun minus the game's own, in seconds. */
  private raceLag() {
    if (this.state !== 'race' && this.state !== 'done') return null;
    if (!this.remote || !this.online || this.startAt === null) return null;
    return (this.online.now() - this.gunWall) / 1000 - this.t;
  }

  private step(dt: number) {
    if (this.state === 'countdown') {
      // Online the shared clock drives the start, so both guns fire together.
      const o = this.online;
      if (this.startAt !== null && o) this.countdownT = Math.max(0, (o.now() - this.startAt) / 1000);
      else this.countdownT += dt;
      this.input.drain(); // nothing to press in the blocks
      const into = this.countdownT - COUNT_AT;
      // Joined late (or the clip only just loaded): start it part-way, so "GO" still lands on the gun.
      if (!this.countPlayed && into >= 0) this.countPlayed = sound.play('countdown', { from: into }) || into > COUNTDOWN_GO;
      // 3, 2, 1 with the beeps.
      if (this.beat < 3 && into >= this.beat && this.countdownT < this.goAt) {
        this.beat = Math.min(3, Math.floor(into) + 1);
        this.hud.countdown(`${4 - this.beat}`, this.beat < 3 ? 'ON YOUR MARKS' : 'SET', `n${4 - this.beat}`);
      }
      if (this.phase === 'marks' && this.countdownT >= MARKS_TIME) {
        this.phase = 'set';
        this.playerView?.play('set');
        for (const r of this.rivals) r.view.play('set');
      }
      if (this.countdownT >= this.goAt) {
        this.state = 'race';
        this.phase = 'go';
        this.gunT = 0;
        if (this.startAt !== null) this.gunWall = this.startAt + this.goAt * 1000;
        this.shake = 0.12;
        this.juice.cannons(this.player.d + 3);
        sound.gun();
        sound.setMusic('race');
        this.hud.countdown('GO!', 'ปัง! ไป!', 'go');
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
    const actions = this.takeTaps(this.input.drain());
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
    if (this.bot && !p.finished && p.launched) actions.push(...botActions(p, this.track, this.t), ...(p.dashReady ? ['dash' as const] : []), ...(p.itemReady ? ['item' as const] : []));
    p.step(dt, this.t, actions, this.track);
    if (this.remote && this.gunT < LAUNCH_AT + START_MIRROR) this.startPath.push(p.d);
    if (!p.finished && p.d >= RACE_LENGTH) p.finish(this.finishClock());
    for (const e of p.events) this.onPlayerEvent(e);
    p.events.length = 0;

    if (this.online?.connected && this.remote && ++this.sendTick % 3 === 0) {
      // The finish time rides along on every packet too: a lone 'fin' lost on a flaky
      // connection would leave the friend waiting for us forever.
      this.online.send({ t: 's', d: +p.d.toFixed(2), x: +p.x.toFixed(2), y: +p.y.toFixed(2), v: +p.speed.toFixed(2), w: Math.round(this.raceWall()),
        ...(p.finished ? { f: p.finishTime } : {}) });
    }

    for (const r of this.rivals) {
      if (r.sim instanceof Remote) {
        // Same gun, same start: they leave with us and run like us until their first packet lands.
        // Through the pick-up their packets arrive bunched and already stale (still slow),
        // so until everyone is up to speed they run at least as fast as we do between them.
        if (p.launched) r.sim.launch();
        if (r.sim.predicting) r.sim.speed = p.speed;
        else if (this.gunT < LAUNCH_AT + START_MIRROR) r.sim.speed = Math.max(r.sim.speed, p.speed);
        r.sim.step(dt);
        continue;
      }
      r.sim.step(dt, this.track, p.d, this.traffic(r.sim));
      if (!r.sim.finished && r.sim.d >= RACE_LENGTH) r.sim.finish(this.t);
      for (const item of r.sim.fired) if (item === 'ink') this.splatAhead(r.sim);
      r.sim.fired.length = 0;
    }
    this.contacts();
    this.collectItems();

    if (this.state === 'race' && p.finished) {
      this.state = 'done';
      this.doneT = 0;
      this.settleT = 0;
      this.input.enabled = false;
    }
    if (this.state === 'done') {
      // Nobody's race is cut short: wait until every runner is over the line
      // (a friend who left the room isn't coming).
      const waiting = this.rivals.filter((r) => !r.sim.finished && (r.sim instanceof Rival || this.online?.connected)).length;
      this.doneT += dt;
      if (waiting) {
        this.settleT = 0;
        if (this.waitTold !== waiting && this.doneT > 2.2) {
          this.waitTold = waiting;
          this.hud.flash(`รอทุกคนเข้าเส้นชัย… (อีก ${waiting} คน)`, 'good', 60);
        }
      } else {
        // Don't leave "waiting for 1" up once they're all in (or the friend has gone).
        if (this.waitTold && this.rivals.every((r) => r.sim.finished)) this.hud.flash('ทุกคนเข้าเส้นชัยแล้ว!', 'good', 1.5);
        else if (this.waitTold) this.hud.unflash();
        this.waitTold = 0;
        this.settleT += dt;
      }
      // Everyone has crossed; give the last one a moment to pull up.
      if (this.doneT > 3 && this.settleT > 2) {
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
    this.juice.ceremonyShow();
    sound.fireworks();
    sound.setMusic('menu');
    this.scene.add(podium.root);
    this.cheer = [];
    this.standings.forEach((s, place) => {
      s.view.play(place < 3 ? 'idle' : 'defeat');
      s.view.root.visible = true;
      if (place < 3) podium.award(place, s.view);
    });
    podium.onMedal = (place) => {
      sound.medal(place);
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
    return this.remote && this.online && this.startAt !== null ? (this.online.now() - this.gunWall) / 1000 : this.t;
  }

  /** Finishing place for a finish time (1 = first). */
  private placeOf(time: number) {
    const times = [this.player, ...this.rivals.map((r) => r.sim)].filter((s) => s.finished).map((s) => s.finishTime);
    return 1 + times.filter((t) => t < time).length;
  }
  private menuCheer = 0;
  /** Focus level last heard, so only a rise plays the pluck. */
  private focusHeard = 0;

  /** Crowd, countryside and rocket beds off (back at the menu). */
  private quietBeds() {
    sound.loop('crowd-loop', 0);
    sound.loop('birds-loop', 0);
    sound.loop('rocket-loop', 0);
  }

  /** The crowd swells near the start and the finish; birds in between. */
  private beds() {
    const d = this.player.d;
    const near = Math.max(0, 1 - Math.min(Math.abs(d), Math.abs(RACE_LENGTH - d)) / 70);
    const racing = this.state === 'race' || this.state === 'done';
    const crowd = this.state === 'countdown' ? 0.5 : racing ? near * 0.55 : 0;
    const birds = racing ? 0.3 * (1 - near) : 0;
    if (Math.abs(crowd - this.bedLevels[0]) > 0.02 || (crowd === 0) !== (this.bedLevels[0] === 0)) sound.loop('crowd-loop', (this.bedLevels[0] = crowd));
    if (Math.abs(birds - this.bedLevels[1]) > 0.02 || (birds === 0) !== (this.bedLevels[1] === 0)) sound.loop('birds-loop', (this.bedLevels[1] = birds));
  }
  private bedLevels = [0, 0];
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

  /** Runners through item boxes (a friend online collects on their own screen). */
  /** The player has used an item at least once (stops the how-to hint). */
  private usedItem = false;

  private collectItems() {
    const runners: (Player | Rival)[] = [this.player];
    for (const r of this.rivals) if (r.sim instanceof Rival) runners.push(r.sim);
    const all = [this.player, ...this.rivals.map((r) => r.sim)];
    for (const s of runners) {
      if (s.finished) continue;
      for (const box of this.track.items) {
        if (box.d > s.d + 2) break;
        if (s.took.has(box.id) || !touches(box, s.x, s.y, s.d)) continue;
        // Further back = better odds of a boost; ink only with someone to hit.
        const ahead = all.filter((o) => o !== s && o.d > s.d).length;
        if (!s.give(rollItem(Math.random(), ahead / Math.max(1, all.length - 1), ahead > 0))) continue;
        s.took.add(box.id);
        this.debris.burst(laneX(box.lane), ITEM.boxY, box.d, BOX_COLORS, s === this.player ? 14 : 6, 0.6, s.speed * 0.6);
      }
    }
  }

  /** Ink: splatters every runner ahead of `from`. */
  private splatAhead(from: Player | Rival) {
    let hits = 0;
    const p = this.player;
    if (from !== p && !p.finished && p.d > from.d) { p.ink(); hits++; }
    for (const r of this.rivals) {
      const s = r.sim;
      if (s === from || s.finished || s.d <= from.d) continue;
      if (s instanceof Rival) s.ink();
      else if (from === p) this.online?.send({ t: 'ink' }); // the friend splatters their own screen
      else continue;
      hits++;
      this.debris.burst(s.x, s.y + 1.6, s.d, INK_COLORS, 14, 0.8, s.speed * 0.6);
    }
    return hits;
  }

  private onPlayerEvent(e: PlayerEvent) {
    const v = this.playerView;
    if (this.remote && this.online?.connected) {
      if (e.type === 'finish') this.online.send({ t: 'fin', time: this.player.finishTime });
      else if (['jump', 'bounce', 'slide', 'stumble', 'fall', 'dash', 'stunned'].includes(e.type)) this.online.send({ t: 'm', m: e.type as NetMove });
      else if (e.type === 'shoved') this.online.send({ t: 'm', m: 'stunned' }); // the friend sees the stagger
      else if (e.type === 'item' && e.item === 'shield') this.online.send({ t: 'sh', on: true });
      else if (e.type === 'shieldBlock') this.online.send({ t: 'sh', on: false });
      else if (e.type === 'item' && e.item === 'rocket') this.online.send({ t: 'rk', on: true });
      else if (e.type === 'rocketEnd') this.online.send({ t: 'rk', on: false });
      if (e.type === 'pickup' || e.type === 'item') this.online.send({ t: 'it', k: this.player.item });
    }
    switch (e.type) {
      case 'jump':
      case 'bounce':
        this.juice.takeoff(this.player);
        if (e.type === 'bounce') sound.spring();
        else sound.jump();
        v?.play('jump', e.airTime);
        this.playerLock = e.airTime;
        break;
      case 'slide':
        sound.slide();
        v?.play('slide', PLAYER.slideTime);
        this.playerLock = PLAYER.slideTime;
        break;
      case 'land':
        sound.land();
        if (!this.player.sliding) this.playerLock = 0;
        break;
      case 'stumble':
        sound.stumble();
        this.juice.hit(this.player, true, true);
        v?.play('stumble', 0.9);
        this.playerLock = 0.9;
        this.shake = 0.35;
        this.hud.flash('สะดุด!');
        this.hud.hit();
        break;
      case 'sidehit':
        sound.sideHit();
        this.juice.hit(this.player, false, true);
        this.shake = 0.15;
        this.hud.flash('ชนข้าง!');
        this.hud.hit();
        break;
      case 'fall':
        sound.fall();
        this.juice.dustCloud(this.player);
        v?.play('fall', 0.8);
        this.playerLock = 0.8;
        this.shake = 0.3;
        this.hud.flash('ตกหลุม!');
        this.hud.hit();
        break;
      case 'bump':
        sound.bump(e.side);
        this.shake = Math.max(this.shake, 0.1);
        this.hud.flash(e.side ? 'เบียด!' : 'ชน!');
        break;
      case 'smash':
        sound.smash();
        this.smashView(e.obstacle);
        if (this.player.dashing) this.shake = Math.max(this.shake, 0.12);
        break;
      case 'dash':
        sound.dash();
        this.juice.ring(this.player, 0x9be7ff, 12, 5);
        v?.play('burst', DASH.time);
        this.playerLock = DASH.time;
        this.shake = 0.25;
        this.hud.flash('DASH!!', 'good');
        this.hud.setFocus(this.player.focus);
        break;
      case 'dashReady':
        sound.dashReady();
        this.hud.flash(desktop ? 'แดชพร้อม! กด Shift' : 'แดชพร้อม! แตะจอ 2 ครั้ง', 'good');
        break;
      case 'shoved':
        sound.bump(false);
        this.juice.hit(this.player, false, true);
        v?.play('stumble', 0.35);
        this.playerLock = 0.35;
        this.shake = Math.max(this.shake, 0.18);
        this.hud.flash('โดนเบียด!');
        this.hud.hit();
        break;
      case 'barged':
        sound.bump(true);
        this.shake = Math.max(this.shake, 0.1);
        this.hud.flash('เบียดออกไป!', 'good');
        break;
      case 'stunned':
        sound.stumble();
        this.juice.hit(this.player, true, true);
        v?.play('stumble', 0.45);
        this.playerLock = 0.45;
        this.shake = 0.3;
        this.hud.flash('โดนพุ่งชน!');
        this.hud.hit();
        break;
      case 'pickup':
        sound.pickup();
        this.juice.pickup(this.player);
        // Until they've used one, remind them how.
        this.hud.flash(this.usedItem ? 'ได้ไอเท็ม!' : desktop ? 'ได้ไอเท็ม! กด Q เพื่อใช้' : 'ได้ไอเท็ม! แตะจอเพื่อใช้', 'good');
        break;
      case 'item': {
        const p = this.player;
        this.usedItem = true;
        this.juice.item(p, e.item);
        if (e.item === 'boost') {
          sound.boost();
          v?.play('burst', 0.6);
          this.playerLock = 0.6;
          this.shake = Math.max(this.shake, 0.15);
          this.hud.flash('บูสต์!', 'good');
        } else if (e.item === 'shield') {
          sound.shield();
          this.debris.burst(p.x, p.y + 1, p.d, POP_COLORS, 10, 0.8, p.speed);
          this.hud.flash('เปิดโล่!', 'good');
        } else if (e.item === 'ink') {
          sound.ink();
          const hits = this.splatAhead(p);
          this.hud.flash(hits ? `พ่นหมึกใส่ ${hits} คน!` : 'ไม่มีใครอยู่ข้างหน้า…', hits ? 'good' : 'bad');
        } else if (e.item === 'rocket') {
          sound.rocket(true);
          this.shake = Math.max(this.shake, 0.3);
          this.debris.burst(p.x, 0.2, p.d, [0xffa21f, 0xffe066, 0xdddddd], 18, 0.8, 0);
          this.hud.flash(`🚀 ${ITEM_NAME.rocket}! บิน ${ITEM.flyTime} วิ`, 'good');
        } else {
          sound.spring();
          this.debris.burst(p.x, 0.2, p.d, [0x9be564, 0xffffff, 0xffd166], 12, 0.6, p.speed * 0.5);
          this.hud.flash(`${ITEM_NAME.spring}!`, 'good');
        }
        break;
      }
      case 'rocketEnd':
        sound.rocket(false);
        this.hud.flash('จรวดหมด! ลงจอด', 'good');
        break;
      case 'shieldBlock':
        sound.shieldPop();
        this.juice.ring(this.player, 0x7ae0ff, 14, 3);
        this.shake = Math.max(this.shake, 0.15);
        this.debris.burst(this.player.x, this.player.y + 1, this.player.d + 0.6, POP_COLORS, 16, 0.9, this.player.speed);
        this.hud.flash('โล่กันไว้!', 'good');
        break;
      case 'inked':
        sound.inked();
        this.hud.ink(ITEM.inkTime);
        this.hud.flash('โดนหมึก!');
        this.hud.hit();
        break;
      case 'focus':
        if (e.level > this.focusHeard) sound.focus(e.level);
        this.focusHeard = e.level;
        this.hud.setFocus(e.level);
        if (e.level === 10) { this.hud.flash('FOCUS MAX!', 'good'); this.juice.focusMax(this.player); }
        break;
      case 'finish': {
        // A friend already over the line may not have sent their time yet.
        const place = 1 + this.rivals.filter((r) => r.sim.finished || (r.sim instanceof Remote && r.sim.d >= RACE_LENGTH)).length;
        // Run it out first; the pose comes once they've slowed (see render).
        this.endPose = place === 1 ? 'victory' : 'defeat';
        sound.finish(place);
        sound.setMusic(null);
        sound.rocket(false);
        this.juice.finishShow();
        sound.fireworks();
        this.playerLock = 99;
        this.hud.flash(place === 1 ? 'เข้าเส้นชัยที่ 1!' : `เข้าเส้นชัยที่ ${place}`, 'good');
        break;
      }
      case 'lane':
        sound.lane();
        break;
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
        // Well past it, it's only in the way of the view: gone.
        if (end < d - 3) v.root.visible = false;
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
        if (this.playerLock <= 0 && p.launched && (p.grounded || p.flying) && !p.sliding && !p.stunned && v.state !== 'run') v.play('run');
      } else if (this.state === 'done' && !this.podium) {
        this.playerLock -= dt;
        if (p.speed < STOP_SPEED) { if (v.state !== this.endPose) v.play(this.endPose); }
        else if (this.playerLock <= 0 && p.grounded && v.state !== 'run') v.play('run');
      }
      if (p.jolt) { v.kick(p.jolt); p.jolt = 0; }
      if (p.dashing || p.itemBoostT > 0) this.trail(p.x, p.y, p.d);
      this.playerBubble.update(p.shield && !this.podium, p.x, p.y, p.d, dt);
      this.playerRocket.update(p.flying && !this.podium, p.x, p.y, p.d, dt);
      if (p.flying) this.exhaust(p.x, p.y, p.d);
      if (!this.podium && (this.state === 'race' || this.state === 'done')) this.juice.runner(p, p.sliding, p.flying, 1, dt);
      if (!this.podium && (this.state === 'race' || this.state === 'done') && this.track) {
        sound.run(dt, p.speed, p.y < 0.06 && !p.flying && !p.sliding, SURFACE[biomeAt(this.track.biomes, p.d)]);
      }
      if (!this.podium) this.beds();
      v.update(dt, this.podium ? 0 : p.speed, this.podium ? 0 : p.laneVelocity);
    }
    this.debris.update(dt);
    this.crowd?.update(dt, p.d);
    setWind(this.clock.elapsedTime);
    if (this.track) this.juice.setGround(BIOMES[biomeAt(this.track.biomes, p.d)].ground);
    this.itemBoxes?.update(this.t, p.d, p.took);
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
        if (m === 'stumble') { r.view.play('stumble', 0.9); r.lock = 0.9; if (s.d > p.d - 1) this.juice.hit(s, true, false); }
        if (m === 'stunned' && s.d > p.d - 1) this.juice.hit(s, false, false);
      }
      r.lock -= dt;
      const started = s.launched;
      if (r.lock <= 0 && started && (this.state === 'race' || this.state === 'done')) {
        // Past the line they run it out, then the winner celebrates.
        const stopped = (s.finished || s.halted) && s.speed < STOP_SPEED;
        r.view.play(!stopped ? 'run' : !s.finished ? 'defeat' : this.placeOf(s.finishTime) === 1 ? 'victory' : 'idle');
      }
      if (!this.podium) r.view.root.position.set(s.x, s.y, -s.d);
      if ('jolt' in s && s.jolt) { r.view.kick(s.jolt); s.jolt = 0; }
      if (s.dashing || (s instanceof Rival && s.itemBoostT > 0)) this.trail(s.x, s.y, s.d);
      // Shield bubble; pops in a burst when it takes a hit.
      if (r.shield && !s.shield) this.debris.burst(s.x, s.y + 1, s.d + 0.6, POP_COLORS, 14, 0.9, s.speed);
      r.shield = s.shield;
      r.bubble.update(s.shield && !this.podium, s.x, s.y, s.d, dt);
      const flying = s instanceof Rival ? s.flyT > 0 : s.rocket;
      r.rocket.update(flying && !this.podium, s.x, s.y, s.d, dt);
      r.tag.update(this.podium || !s.item ? '' : ITEM_ICON[s.item], this.headAt(s.x, s.y, s.d), dt);
      if (flying) this.exhaust(s.x, s.y, s.d);
      if (!this.podium && (this.state === 'race' || this.state === 'done')) {
        // Only rivals ahead: dust behind the player would puff up at the camera.
        const ahead = s.d - p.d;
        this.juice.runner(s, 'sliding' in s && s.sliding, flying, ahead > 1 && ahead < 30 ? 0.7 : 0, dt);
      }
      // Ink dripping off a splattered rival.
      if (s instanceof Rival && s.inked && Math.random() < 0.3) this.debris.burst(s.x, s.y + 1.6, s.d, INK_COLORS, 1, 0.5, s.speed);
      // Rivals between the camera and the player would hide what's coming.
      const behind = p.d - s.d;
      const racing = this.state === 'race' || this.state === 'done';
      r.view.setOpacity(!racing || this.gunT < 1.5 ? 1 : behind > 1 && behind < 10 ? 0.15 : behind > -1.5 && behind < 10 ? 0.4 : 1, dt);
      r.view.update(dt, this.podium ? 0 : s.speed, this.podium ? 0 : s.laneVelocity);
    }
    if (this.podium) this.updateCeremony(dt);
    if (this.menuCheer > 0 && (this.menuCheer -= dt) <= 0 && this.state === 'menu') this.playerView?.play('idle');

    this.updateCamera(dt);
    {
      const racing = this.state === 'race' && !this.podium;
      const lines = !racing ? 0 : p.dashing ? 1 : p.flying || p.itemBoostT > 0 ? 0.8 : p.focus >= 10 ? 0.3 : 0;
      this.juice.update(dt, p, this.track?.items ?? null, p.took, this.camera, this.headAt(p.x, p.y + 0.15, p.d), lines);
    }
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
      this.hud.setItem(p.item, p.itemRoll > 0, this.t, p.items.length);
      // The held item rides over the runner's head, where it is tapped.
      const at = p.item && !this.podium ? this.headAt(p.x, p.y + 0.62, p.d).project(this.camera) : null;
      this.hud.placeItem(at && at.z < 1 ? { x: (at.x * 0.5 + 0.5) * innerWidth, y: (-at.y * 0.5 + 0.5) * innerHeight } : null);
      this.hud.setFlight(p.flyT);
    }
  }

  private head = new THREE.Vector3();

  /** Just over a runner's head, in (bent) world space. */
  private headAt(x: number, y: number, d: number) {
    return this.path.toWorld(x, y + PLAYER.height, d, this.head);
  }

  /** Speed streaks behind a dashing runner. */
  private trail(x: number, y: number, d: number) {
    for (let i = 0; i < 2; i++) this.debris.streak(x + (Math.random() - 0.5) * 0.9, y + 0.2 + Math.random() * 1.4, d - 0.6 - Math.random() * 0.8, Math.random() < 0.5 ? 0xffffff : 0xffd166);
  }

  /** Fire and smoke out of a rocket pack. */
  private exhaust(x: number, y: number, d: number) {
    this.debris.streak(x + (Math.random() - 0.5) * 0.3, y + 0.45, d - 0.35 - Math.random() * 0.6, Math.random() < 0.5 ? 0xffa21f : 0xffe066);
    if (Math.random() < 0.3) this.debris.burst(x, y + 0.5, d - 0.4, [0xdddddd, 0xbbbbbb], 1, 0.3, 0);
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

    if (!this.podium && this.state !== 'menu' && cam.view?.enabled) {
      cam.clearViewOffset();
      this.viewOffset.set(0, 0);
    }
    if (this.state === 'menu') {
      // Showcase the selected character from the front, whole, in the gap
      // between the logo and the panel.
      const w = innerWidth, h = innerHeight;
      const ins = this.hud.menuInsets();
      const fh = Math.max(0.3, (h - ins.top - ins.bottom) / h);
      cam.fov = portrait ? 60 : 45;
      const dist = 1.05 / (Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * fh); // ≈ 2.1 m of height in the gap
      t.lerp(new THREE.Vector3(p.x + dist * 0.25, 1.25, p.d + dist), k);
      look.set(p.x, 0.92, p.d);
      this.viewOffset.lerp(new THREE.Vector2(0, (ins.bottom - ins.top) / 2), k);
      cam.setViewOffset(w, h, this.viewOffset.x, this.viewOffset.y, w, h);
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
