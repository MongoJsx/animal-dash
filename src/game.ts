// Ties simulation, rendering and UI together: menu → countdown → race → results.
import * as THREE from 'three';
import { BASE_STATS, BODY, fitLanes, DASH, ITEM, LANES, LANE_COUNT, PLAYER, laneX, RACE_LENGTH, TICK, TRACK_HALF, VIEW_AHEAD, VIEW_BEHIND, STOP_SPEED, setLaneCount, laneIndex, nearestLane } from './config.ts';
import { COUNTDOWN_GO, sound, type Surface } from './core/audio.ts';
import { Input } from './core/input.ts';
import { Rng } from './core/rng.ts';
import { profile, recordRace, saveProfile } from './core/profile.ts';
import { botActions } from './entities/bot.ts';
import { resolveContacts } from './entities/contact.ts';
import { Player, type PlayerEvent } from './entities/player.ts';
import { Rival, type RivalSkill, type Traffic } from './entities/rival.ts';
import { Online, ROOM_MAX, type BotState, type Member, type NetMove, type NetMsg, type NetRules, type Seat } from './net/online.ts';
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
import { Hud, byFinish, desktop, type Racer, type Rules } from './ui/hud.ts';
import { BIOMES, MAPS, biomeAt, isMapId, type BiomeId, type MapId } from './world/biomes.ts';
import { sunDirection } from './render/sky.ts';
import { ITEM_ICON, ITEM_KINDS, ITEM_NAME, rollItem, touches, type ItemKind } from './world/items.ts';
import { hitBoxes, movingD, spansTrack, type Box, type Obstacle } from './world/obstacles.ts';
import { TrackPath } from './world/path.ts';
import { buildTrack, type Track } from './world/track.ts';

installBend();
installGrade();

type State = 'menu' | 'pick' | 'countdown' | 'race' | 'done' | 'results';

const SKILLS: RivalSkill[] = [
  { mistake: 0.1, pace: 1.0 },
  { mistake: 0.18, pace: 0.99 },
  { mistake: 0.27, pace: 0.985 },
  { mistake: 0.22, pace: 0.99 },
];
const COLORS = ['#e04a3a', '#f6b73c', '#4fae6a', '#2a7fd4', '#8a6bd1', '#f07aa0', '#1fb5a8'];
/** Lanes (index from the left) in the order runners take them: the middle one first, then outwards. */
const laneOrder = (n: number) => {
  const mid = Math.floor((n - 1) / 2);
  return [0, 1, -1, 2, -2].map((k) => mid + k).filter((i) => i >= 0 && i < n);
};
/** Bots run under ids like this, so they never clash with a player's. */
const isBot = (id: string) => id.startsWith('~');
/** Solo, the player's id on the line. */
const SOLO_ID = 'me';
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

/** A runner other than the player: a bot simulated here, or someone else's runner (a bot of the host's, on a guest). `sent`: host, the bot's moves already passed on. */
interface RivalEntry { id: string; sim: Rival | Remote; view: CharacterView; def: CharacterDef; lock: number; moveIndex: number; sent: number; bubble: Bubble; shield: boolean; rocket: RocketPack; tag: ItemTag }

const POP_COLORS = [0x7ae0ff, 0xffffff, 0xbdf3ff];
const INK_COLORS = [0x120c24, 0x2a1f4d, 0x000000];
const BOX_COLORS = [0xffe066, 0xff9f1c, 0xff5d8f, 0xffffff];
const rivalBoxes: Box[] = [];

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
  /** Lanes on the track (3, 5 or 7) = runners in a solo race. */
  private laneCount = fitLanes(profile.lanes);
  /** Items switched on for the race (none: no item boxes on the track). */
  private itemsOn: ItemKind[] = ITEM_KINDS.filter((k) => !profile.items || profile.items.includes(k));
  /** Seed of the field standing on the line in the runner select. */
  private fieldSeed = 0;
  /** Bots wanted on the line (as many as fit beside the players). */
  private botCount = profile.bots ?? ROOM_MAX - 1;
  /** Everyone in the room, the host first (solo: just you). */
  private members: Member[] = [];
  /** Online: where the room is (the host's word for it on a guest). */
  private stage: 'lobby' | 'pick' | 'race' = 'lobby';
  /** Who stands in each lane (index from the left) for this race; null = empty. */
  private seats: (Seat | null)[] = [];
  /** The lane index you start in. */
  private myLane = 1;
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
  /** Other players' runners (and, on a guest, the host's bots), by id. */
  private remotes = new Map<string, Remote>();
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
    this.selected = chars.find((c) => c.id === (params.get('char') ?? profile.char))?.id ?? chars[0].id;
    if (params.get('lanes')) this.laneCount = Number(params.get('lanes'));
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
    // A tap uses the item at once if there is one to use (or one about to land).
    this.input.tapUses = () => {
      const p = this.player;
      return !!p.item && p.launched && !p.finished && p.itemRoll < PLAYER.inputBuffer;
    };
    this.hud = new Hud(container);
    this.hud.onDash = () => this.input.press('dash');
    this.hud.onUse = () => this.input.press('item');
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

    setLaneCount(this.laneCount);
    this.track = buildTrack(seed, this.map);
    if (!this.itemsOn.length) this.track.items = [];
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
    this.crowd = new Crowd(seed, this.track.biomes);
    this.scene.add(this.crowd.mesh);
    this.path = new TrackPath(seed, this.track.biomes);
    setBendPath(this.path);
    this.juice.setPath(this.path);
    this.env = new Environment(seed, this.track.biomes, this.track, this.path);
    this.env.snapLook(0);
    this.scene.add(this.env.root);
    this.player = new Player();
    const lane = LANES[Math.min(this.myLane, LANE_COUNT - 1)];
    this.player.startSlot(laneX(lane), lane);
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
    this.autoReady = false;
    sound.setMusic('menu');
    this.quietBeds();
    this.input.enabled = false;
    this.myLane = laneOrder(this.laneCount)[0];
    this.reset(1234);
    this.setPlayerView(this.selected);
    this.playerView!.play('idle');
    this.hud.showMenu({
      char: this.def(this.selected),
      onStart: () => this.onStartPressed(),
      onOnline: () => { this.joining = true; this.updateLobby(); },
      onSpin: (dx, held) => {
        this.spinHeld = held;
        if (!held) return;
        const turn = dx * 0.012;
        this.spin += turn;
        // Remember how fast it was turning, to coast on after letting go.
        this.spinVel = this.spinVel * 0.5 + (turn / Math.max(1 / 120, this.lastDt)) * 0.5;
      },
    });
    this.spin = this.spinVel = 0;
    if (this.isHost) this.stage = 'lobby';
    this.shareRoom();
    this.updateLobby();
  }

  /** On the menu with no room open: safe to reload for a new version. */
  get idle() {
    return this.state === 'menu' && !this.online && !this.joining;
  }

  // ── Online ──────────────────────────────────────────────────────────
  /** My id on the line: my id in the room online, or the solo one. */
  private get myId() {
    return this.online?.me ?? SOLO_ID;
  }

  /** Solo, or the host online: decides the line-up and runs the bots. */
  private get isHost() {
    return !this.online || this.online.role === 'host';
  }

  /** In a room with other players (a host with someone in, or a guest let in). */
  private get inRoom() {
    const o = this.online;
    return !!o?.connected && (o.role === 'guest' || o.peers.length > 0);
  }

  /** Racing other players over the network on the shared clock. */
  private get netRace() {
    return !!this.online && this.startAt !== null && [...this.remotes.values()].some((r) => !r.bot);
  }

  private member(id: string) {
    return this.members.find((m) => m.id === id);
  }

  /** A character id from the network, or the first one if we don't have it. */
  private defOf(id: string) {
    return this.chars.find((c) => c.id === id) ?? this.chars[0];
  }

  private connect(online: Online) {
    this.online?.close();
    this.online = online;
    this.members = [{ id: online.me, c: this.selected }];
    this.stage = 'lobby';
    online.onStatus = () => {
      if (online.connected && online.role === 'guest') online.send({ t: 'char', id: this.selected });
      if (online.status === 'closed') {
        for (const r of this.remotes.values()) r.gone = true;
        if (this.state !== 'menu') this.hud.flash('เจ้าห้องออกจากห้องแล้ว');
      }
      this.updateLobby();
    };
    online.onPeers = () => this.onPeers();
    online.onMessage = (m, from) => this.onNet(m, from);
    this.updateLobby();
  }

  private leaveOnline() {
    this.online?.close();
    this.online = null;
    this.members = [];
    this.stage = 'lobby';
    history.replaceState(null, '', location.pathname);
    this.updateLobby();
  }

  /** Host: someone came into the room or left it. */
  private onPeers() {
    const o = this.online!;
    const had = this.members.length;
    this.members = [this.members[0], ...o.peers.map((id) => this.member(id) ?? { id, c: this.chars[0].id })];
    for (const [id, r] of this.remotes) if (!r.bot && !o.peers.includes(id)) r.gone = true;
    // Everyone needs a lane: a fuller room widens the track.
    if (this.members.length > this.laneCount) this.laneCount = this.members.length;
    if (this.state !== 'menu') this.hud.flash(this.members.length > had ? 'มีเพื่อนเข้าห้อง' : 'มีเพื่อนออกจากห้อง', this.members.length > had ? 'good' : 'bad');
    if (this.state === 'pick') this.reseat();
    else this.shareRoom();
    this.updateLobby();
  }

  /** Host: tell everyone who's in, and the line-up in the runner select. */
  private shareRoom() {
    const o = this.online;
    if (!o?.connected || o.role !== 'host') return;
    o.send({ t: 'room', ps: this.members, stage: this.stage, seed: this.fieldSeed, rules: this.rules(), seats: this.seats });
  }

  private rules(): NetRules & { map: MapId } {
    return { map: this.map, lanes: this.laneCount, items: this.itemsOn, bots: this.botCount };
  }

  private onNet(m: NetMsg, from: string) {
    const o = this.online!;
    const host = o.role === 'host';
    const racing = this.state === 'race' || this.state === 'done';
    switch (m.t) {
      case 'room': {
        if (host || from !== o.hostId) break;
        this.members = m.ps;
        this.takeRules(m.rules);
        this.stage = m.stage;
        const seated = m.seats.some((s) => s?.id === this.myId);
        if (m.stage === 'pick' && seated) {
          this.seats = m.seats;
          if (this.state !== 'pick' || this.layoutKey(m.seed) !== this.builtKey) this.openPick(m.seed, true);
          else this.recastAll();
          this.updateReady();
        } else if (this.state === 'pick') this.showMenu();
        this.updateLobby();
        break;
      }
      case 'char': {
        const who = host && this.member(from);
        if (!who) break;
        const was = who.c;
        who.c = this.defOf(m.id).id;
        if (this.state === 'pick') {
          this.swapBot(who.c, was);
          this.reseat();
        } else this.shareRoom();
        this.updateLobby();
        break;
      }
      case 'ready': {
        const who = host && this.member(from);
        if (!who) break;
        who.r = m.on;
        this.shareRoom();
        this.updateReady();
        this.maybeGo();
        break;
      }
      case 'start':
        if (!host && from === o.hostId && this.state === 'pick' && this.fieldSeed === m.seed) this.beginCountdown(m.at);
        break;
      case 'again':
        if (host && this.state === 'results') this.onStartPressed();
        break;
      case 's': {
        const r = this.remotes.get(from);
        if (!r || r.bot) break;
        r.receive(m.d, m.x, m.y, m.v, this.sinceSent(m.v, m.w));
        if (m.f !== undefined && !r.finished) r.finish(m.f);
        break;
      }
      case 'bs':
        if (from !== o.hostId) break;
        for (const b of m.a) {
          const r = this.remotes.get(b.i);
          if (!r?.bot) continue;
          r.receive(b.d, b.x, b.y, b.v, this.sinceSent(b.v, m.w));
          if (b.f !== undefined && !r.finished) r.finish(b.f);
          r.shield = !!b.sh;
          r.rocket = !!b.rk;
          r.item = b.k ?? null;
        }
        break;
      case 'm':
        this.remotes.get(m.id ?? from)?.move(m.m);
        break;
      case 'fin':
        this.remotes.get(m.id ?? from)?.finish(m.time);
        break;
      case 'ink':
        if (!racing) break;
        if (m.hit.includes(this.myId) && this.state === 'race') this.player.ink();
        // Host: a player splattered our bots.
        for (const r of this.rivals) {
          if (!(r.sim instanceof Rival) || !m.hit.includes(r.id)) continue;
          r.sim.ink();
          this.debris.burst(r.sim.x, r.sim.y + 1.6, r.sim.d, INK_COLORS, 14, 0.8, r.sim.speed * 0.6);
        }
        break;
      case 'sh': {
        const r = this.remotes.get(from);
        if (r) r.shield = m.on;
        break;
      }
      case 'rk': {
        const r = this.remotes.get(from);
        if (r) r.rocket = m.on;
        break;
      }
      case 'it': {
        const r = this.remotes.get(from);
        if (r) r.item = m.k;
        break;
      }
      case 'ob': {
        const ob = this.track?.obstacles.find((x) => x.id === m.id);
        const by = this.remotes.get(m.by ?? from);
        if (ob && !ob.hit && racing) {
          ob.hit = true;
          this.smashView(ob, by?.x, by?.speed);
        }
        break;
      }
    }
  }

  /** "Start" on the home screen: into the runner select (online, the host takes the room along). */
  private onStartPressed() {
    if (!this.online) { this.joining = false; sound.click(); this.seats = []; this.openPick(); }
    else if (this.online.role === 'host' && this.inRoom) {
      sound.click();
      for (const m of this.members) m.r = false;
      this.seats = [];
      this.openPick();
    }
  }

  private updateLobby() {
    if (this.state !== 'menu') return;
    const o = this.online;
    if (!o) {
      if (this.joining) this.showJoin();
      else this.hud.setLobby(null);
      return;
    }
    const code = `<b class="code">${o.code.toUpperCase()}</b>`;
    const count = `👥 ${this.members.length}/${ROOM_MAX}`;
    const others = this.members.filter((m) => m.id !== o.me).map((m) => this.defOf(m.c).name).join(', ');
    // One compact line: what's going on on the left, a way out (✕) on the right.
    const line = (status: string, extra = '') =>
      `<div class="lob-row"><div class="lob-text">${status}</div>${extra}<button class="lob-x" data-act="leave" aria-label="ออกจากห้อง">✕</button></div>`;
    const share = '<button class="lob-share" data-act="share">📋 แชร์</button>';
    let html: string;
    let start: string;
    let ready = false;
    let actions: Record<string, () => void> = { leave: () => this.leaveOnline() };
    if (o.status === 'error' || o.status === 'closed') {
      html = line(`<span class="err">${o.status === 'error' ? o.error : 'เจ้าห้องออกจากห้องแล้ว'}</span>`);
      start = 'กด ✕ เพื่อเล่นคนเดียว';
    } else if (o.role === 'host' && !o.connected) {
      html = line(`<span>กำลังเปิดห้อง ${code}…</span>`);
      start = 'กำลังเชื่อมต่อ…';
    } else if (o.role === 'host') {
      actions = { ...actions, share: () => this.shareLink(o) };
      const left = ROOM_MAX - this.members.length;
      html = o.peers.length
        ? line(`<span class="ok">ห้อง ${code} · ${count}</span><small>${others}${left > 0 ? ` · เข้าได้อีก ${left}` : ' · เต็มแล้ว'}</small>`, share)
        : line(`<span>ห้อง ${code} · ${count}</span><small>ส่งรหัสหรือลิงก์ให้เพื่อน (สูงสุด ${ROOM_MAX} คน)</small>`, share);
      start = o.peers.length ? 'เริ่มแข่ง!' : 'รอเพื่อนเข้าห้อง…';
      ready = o.peers.length > 0;
    } else if (!o.connected) {
      html = line(`<span>กำลังเข้าห้อง ${code}…</span>`);
      start = 'กำลังเชื่อมต่อ…';
    } else if (this.stage !== 'lobby') {
      html = line(`<span class="ok">✓ เข้าห้อง ${code} แล้ว · ${count}</span><small>เพื่อนกำลังแข่งอยู่ รอรอบหน้า</small>`);
      start = 'รอรอบถัดไป…';
    } else {
      html = line(`<span class="ok">✓ เข้าห้อง ${code} แล้ว · ${count}</span><small>${others}</small>`);
      start = 'รอเจ้าห้องกดเริ่ม…';
    }
    this.hud.setLobby({ html, start, ready, guest: o.role === 'guest', actions });
  }

  /** Play with friends: open a new room, or type in the code of theirs. */
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

  // ── Runner select ───────────────────────────────────────────────────
  /**
   * Everyone onto the line, then the room: pick a runner and press ready.
   * @param keepSeats use the line-up already in `seats` (a guest's from the host, or the host's just worked out)
   */
  private openPick(seed = (Math.random() * 2 ** 31) | 0, keepSeats = false) {
    this.fieldSeed = seed;
    if (!this.online) this.members = [{ id: SOLO_ID, c: this.selected }];
    if (this.isHost && !keepSeats) this.seats = this.computeSeats(seed);
    this.setupField(seed);
    this.state = 'pick';
    if (this.isHost) this.stage = 'pick';
    this.input.enabled = false;
    sound.setMusic('menu');
    for (const v of [this.playerView!, ...this.rivals.map((r) => r.view)]) v.play('idle');
    this.hud.showPick({
      chars: this.chars, selected: this.selected, taken: this.taken(),
      rules: this.rules(), canEdit: this.isHost, players: this.online ? this.members.length : 1,
      onRules: (r) => this.setRules(r),
      onPick: (id) => this.pickRunner(id),
      onReady: () => this.onReady(),
      onBack: () => {
        if (this.online) this.leaveOnline();
        this.showMenu();
      },
    });
    this.pickTags();
    this.updateReady();
    this.shareRoom();
    if (this.autoReady) {
      this.autoReady = false;
      this.onReady();
    }
  }

  /**
   * Who runs in which lane: the players from the middle lane outwards (the
   * host first), then as many bots as wanted in the lanes left over, each on
   * a character nobody else has (a bot keeps the one it had if it still can).
   */
  private computeSeats(seed: number): (Seat | null)[] {
    const n = this.laneCount;
    const order = laneOrder(n);
    const humans = this.members.slice(0, n);
    const seats: (Seat | null)[] = Array(n).fill(null);
    humans.forEach((m, i) => { seats[order[i]] = { id: m.id, c: m.c }; });
    const used = new Set(humans.map((m) => m.c));
    const had = this.seats.filter((s): s is Seat => !!s && isBot(s.id)).map((s) => s.c);
    const pool = new Rng(seed ^ 0x5bd1e995).shuffle(this.chars.map((c) => c.id));
    const bots = Math.max(0, Math.min(this.botCount, n - humans.length));
    for (let k = 0; k < bots; k++) {
      const c = [had[k], ...pool].find((id) => id && !used.has(id)) ?? this.chars[k % this.chars.length].id;
      used.add(c);
      seats[order[humans.length + k]] = { id: `~${k}`, c };
    }
    return seats;
  }

  /** What the line on screen was built from (a change means building it again). */
  private builtKey = '';
  private layoutKey(seed = this.fieldSeed) {
    return `${seed}|${this.map}|${this.laneCount}|${this.itemsOn.join()}|${this.seats.map((s) => s?.id ?? '').join()}`;
  }

  /** Host (and solo): work the line-up out again; rebuild the line if who stands where changed, else just change characters. */
  private reseat() {
    this.seats = this.computeSeats(this.fieldSeed);
    if (this.layoutKey() !== this.builtKey) this.openPick(this.fieldSeed, true);
    else {
      this.recastAll();
      this.updateReady();
      this.shareRoom();
    }
  }

  /** A bot on the character a player just took gets the one they left. */
  private swapBot(taken: string, freed: string) {
    const bot = this.seats.find((s) => s && isBot(s.id) && s.c === taken);
    if (bot) bot.c = freed;
  }

  /** Runners on the line take the characters in `seats`. */
  private recastAll() {
    this.seats.forEach((s) => {
      const r = s && this.rivals.find((e) => e.id === s.id);
      if (r && r.def.id !== s.c) this.recast(r, this.defOf(s.c));
    });
    this.hud.setTaken(this.taken());
    this.pickTags();
  }

  /** Race settings changed in the room (solo, or the host online): save, tell everyone, rebuild the line. */
  private setRules(r: Rules) {
    if (r.map === this.map && r.lanes === this.laneCount && r.items.join() === this.itemsOn.join() && r.bots === this.botCount) return;
    this.map = r.map;
    this.laneCount = r.lanes;
    this.itemsOn = r.items;
    this.botCount = r.bots;
    profile.lanes = r.lanes;
    profile.items = r.items;
    profile.bots = r.bots;
    saveProfile();
    try { localStorage.setItem('map', r.map); } catch { /* private mode */ }
    this.openPick(this.fieldSeed);
  }

  /** The host's settings, as sent with the room. */
  private takeRules(m: Partial<NetRules>) {
    if (isMapId(m.map)) this.map = m.map;
    if (m.lanes) this.laneCount = m.lanes;
    if (m.items) this.itemsOn = ITEM_KINDS.filter((k) => m.items!.includes(k));
    if (m.bots !== undefined) this.botCount = m.bots;
  }

  /** Characters on the line other than yours: who's running them. */
  private taken() {
    const out: Record<string, string> = {};
    for (const r of this.rivals) out[r.def.id] = isBot(r.id) ? 'บอท' : 'เพื่อน';
    return out;
  }

  /** Name tags in lane order. */
  private pickTags() {
    const all = [{ x: this.player.x, name: this.def(this.selected).name, me: true, friend: false },
      ...this.rivals.map((r) => ({ x: r.sim.x, name: r.def.name, me: false, friend: !isBot(r.id) }))];
    this.hud.setPickTags(all.map((t) => ({ ...t, lane: LANE_COUNT - laneIndex(nearestLane(t.x)) })));
  }

  /** Swap runners: a bot already on that character takes the one you left. */
  private pickRunner(id: string) {
    const was = this.selected;
    this.selected = id;
    profile.char = id;
    saveProfile();
    this.setPlayerView(id);
    this.playerView!.play('victory');
    this.menuCheer = 1.1;
    this.player.stats = this.def(id).stats ?? BASE_STATS;
    const me = this.member(this.myId);
    if (me) me.c = id;
    const mine = this.seats.find((s) => s?.id === this.myId);
    if (mine) mine.c = id;
    if (this.isHost) {
      this.swapBot(id, was);
      this.reseat();
    } else this.online?.send({ t: 'char', id });
  }

  /** Put a different character on a runner already on the line. */
  private recast(r: RivalEntry, def: CharacterDef) {
    this.scene.remove(r.view.root);
    r.view = new CharacterView(def, { castShadow: false });
    r.view.play('idle');
    r.def = def;
    if (r.sim instanceof Rival) r.sim.stats = def.stats ?? BASE_STATS;
    else r.sim.strength = (def.stats ?? BASE_STATS).strength;
    this.scene.add(r.view.root);
  }

  private onReady() {
    const o = this.online;
    if (!this.inRoom) { this.beginCountdown(); return; }
    const me = this.member(this.myId);
    if (me) me.r = true;
    if (o!.role === 'guest') o!.send({ t: 'ready', on: true });
    else this.shareRoom();
    this.updateReady();
    this.maybeGo();
  }

  /** The players standing on the line. */
  private seatedPlayers() {
    return this.seats.filter((s): s is Seat => !!s && !isBot(s.id));
  }

  /** Host: everyone on the line is ready, so the race starts for all on the shared clock. */
  private maybeGo() {
    const o = this.online;
    if (!o?.connected || o.role !== 'host' || this.state !== 'pick') return;
    if (!this.seatedPlayers().every((s) => this.member(s.id)?.r)) return;
    const at = o.now() + START_LEAD * 1000;
    this.stage = 'race';
    o.send({ t: 'start', seed: this.fieldSeed, at });
    this.shareRoom();
    this.beginCountdown(at);
  }

  private updateReady() {
    if (this.state !== 'pick') return;
    if (!this.inRoom) { this.hud.setReady('พร้อม!', 'แตะเพื่อเริ่มนับถอยหลัง', true); return; }
    const seated = this.seatedPlayers();
    const n = seated.filter((s) => this.member(s.id)?.r).length;
    if (!this.member(this.myId)?.r) this.hud.setReady('พร้อม!', `พร้อมแล้ว ${n}/${seated.length} คน · กดพร้อมครบแล้วเริ่มเลย`, true);
    else this.hud.setReady('พร้อมแล้ว ✓', `รอเพื่อนกดพร้อม… (${n}/${seated.length})`, false, true);
  }

  /** Track, scenery and every runner standing on their block (no countdown yet). */
  private setupField(seed: number) {
    this.myLane = Math.max(0, this.seats.findIndex((s) => s?.id === this.myId));
    this.reset(seed);
    this.setPlayerView(this.selected);
    this.player.stats = this.def(this.selected).stats ?? BASE_STATS;
    this.remotes.clear();
    this.startPath = [];
    // Bots run here solo and on the host; a guest sees the host's, like any other player.
    this.seats.forEach((s, i) => {
      if (!s || s.id === this.myId || i >= LANES.length) return;
      const def = this.defOf(s.c);
      const lane = LANES[i];
      if (isBot(s.id) && this.isHost) {
        const k = Number(s.id.slice(1)) || 0;
        this.addRunner(s.id, new Rival(seed + k * 101, SKILLS[k % SKILLS.length], laneX(lane), lane, def.stats ?? BASE_STATS), def);
      } else {
        const r = new Remote(s.id, laneX(lane), isBot(s.id));
        r.strength = (def.stats ?? BASE_STATS).strength;
        this.remotes.set(s.id, r);
        this.addRunner(s.id, r, def);
      }
    });
    this.builtKey = this.layoutKey(seed);
  }

  private addRunner(id: string, sim: Rival | Remote, def: CharacterDef) {
    // Rivals use a cheap blob shadow: five shadow-casting characters cost ~75k tris.
    const view = new CharacterView(def, { castShadow: false });
    const bubble = new Bubble(), rocket = new RocketPack(), tag = new ItemTag();
    this.scene.add(view.root, bubble.mesh, rocket.root, tag.sprite);
    this.rivals.push({ id, sim, view, def, lock: 0, moveIndex: 0, sent: 0, bubble, shield: false, rocket, tag });
  }

  /** Straight to the count (dev ?autostart). */
  private startRace(seed?: number) {
    const params = new URLSearchParams(location.search);
    const s = seed ?? (Number(params.get('seed')) || (Math.random() * 2 ** 31) | 0);
    this.fieldSeed = s;
    if (!this.online) this.members = [{ id: SOLO_ID, c: this.selected }];
    this.seats = this.computeSeats(s);
    this.setupField(s);
    this.beginCountdown();
  }

  /** @param netAt online: when the start sequence begins, on the host's clock (ms) */
  private beginCountdown(netAt?: number) {
    const params = new URLSearchParams(location.search);
    const online = this.online?.connected ? this.online : null;
    // Online both sides run the start off the shared clock: a moment from now,
    // so the start message has time to reach the guest first.
    this.startAt = online ? netAt ?? online.now() + START_LEAD * 1000 : null;
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
    this.camTarget.set(THREE.MathUtils.clamp(this.player.x + side * 0.8, -TRACK_HALF + 0.6, TRACK_HALF - 0.6), 1.6, this.player.d + 4.5);
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
      ...this.rivals.map((r, i) => ({ name: isBot(r.id) ? r.def.name : `เพื่อน · ${r.def.name}`, d: r.sim.d, isPlayer: false, finished: r.sim.finished, finishTime: r.sim.finishTime, color: COLORS[i + 1] })),
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

  /** Online: the shared-clock moment (ms) the game's race time stands for (a frame catching up runs behind now). */
  private raceWall() {
    return this.startAt !== null ? this.gunWall + this.t * 1000 : this.online!.now();
  }

  /** Online racing: shared-clock time since the gun minus the game's own, in seconds. */
  private raceLag() {
    if (this.state !== 'race' && this.state !== 'done') return null;
    if (!this.netRace) return null;
    return (this.online!.now() - this.gunWall) / 1000 - this.t;
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
    if (this.bot && !p.finished && p.launched) actions.push(...botActions(p, this.track, this.t), ...(p.dashReady ? ['dash' as const] : []), ...(p.itemReady ? ['item' as const] : []));
    p.step(dt, this.t, actions, this.track);
    const net = this.netRace && this.online!.connected;
    if (net && this.gunT < LAUNCH_AT + START_MIRROR) this.startPath.push(p.d);
    if (!p.finished && p.d >= RACE_LENGTH) p.finish(this.crossedAt(p.d, p.speed));
    for (const e of p.events) this.onPlayerEvent(e);
    p.events.length = 0;

    if (net && ++this.sendTick % 3 === 0) {
      // The finish time rides along on every packet too: a lone 'fin' lost on a flaky
      // connection would leave the others waiting for us forever.
      const w = Math.round(this.raceWall());
      this.online!.send({ t: 's', d: +p.d.toFixed(2), x: +p.x.toFixed(2), y: +p.y.toFixed(2), v: +p.speed.toFixed(2), w,
        ...(p.finished ? { f: p.finishTime } : {}) });
      // The host runs the bots for everyone.
      const bots: BotState[] = [];
      for (const r of this.rivals) {
        const s = r.sim;
        if (!(s instanceof Rival)) continue;
        bots.push({ i: r.id, d: +s.d.toFixed(2), x: +s.x.toFixed(2), y: +s.y.toFixed(2), v: +s.speed.toFixed(2),
          ...(s.finished ? { f: s.finishTime } : {}), ...(s.shield ? { sh: 1 as const } : {}), ...(s.flyT > 0 ? { rk: 1 as const } : {}), ...(s.item ? { k: s.item } : {}) });
      }
      if (bots.length) this.online!.send({ t: 'bs', w, a: bots });
    }

    // Bots keep near the nearest player (online, whichever one that is).
    const people = [p.d, ...[...this.remotes.values()].filter((r) => !r.bot && !r.gone).map((r) => r.d)];

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
      const s = r.sim;
      const near = people.reduce((a, b) => (Math.abs(b - s.d) < Math.abs(a - s.d) ? b : a));
      s.step(dt, this.track, near, this.traffic(s));
      if (!s.finished && s.d >= RACE_LENGTH) {
        s.finish(this.crossedAt(s.d, s.speed));
        if (net) this.online!.send({ t: 'fin', time: s.finishTime, id: r.id });
      }
      for (const item of s.fired) if (item === 'ink') this.splatAhead(s);
      s.fired.length = 0;
      this.rivalSmash(s, r.id);
      // Everyone else sees the bot's moves as it makes them.
      for (; r.sent < s.moves.length; r.sent++) {
        const m = s.moves[r.sent];
        if (net && m !== 'lane') this.online!.send({ t: 'm', m, id: r.id });
      }
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
      // (someone who left the room isn't coming).
      const waiting = this.rivals.filter((r) => !r.sim.finished && (r.sim instanceof Rival || (this.online?.connected && !r.sim.gone))).length;
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
    const place = order.findIndex((i) => racers[i].isPlayer) + 1;
    const reward = recordRace(place, racers.length, this.player.finished ? this.player.finishTime : null, `${this.map}/${LANE_COUNT}`);
    this.hud.showResults(order.map((i) => racers[i]), `${MAPS[this.map].flag} ${MAPS[this.map].name}`, reward, (btn) => this.again(btn, true), (btn) => this.again(btn, false), () => this.showMenu());
  }

  private cheer: number[] = [];
  private endPose: AnimState = 'idle';

  /** The time to record at the line. Online it is real time since the gun: the
   *  game clock stalls when a device stutters or its tab sleeps, so two players'
   *  game times can put the one who crossed second in first place. */
  private finishClock() {
    return this.netRace ? (this.online!.now() - this.gunWall) / 1000 : this.t;
  }

  /** The moment a runner now `d` metres along at `v` m/s actually crossed the line:
   *  the tick only notices after the fact, up to 1/60 s late, which would round
   *  every time to the tick and tie runners a few hundredths apart. */
  private crossedAt(d: number, v: number) {
    return this.finishClock() - Math.min(TICK, Math.max(0, (d - RACE_LENGTH) / Math.max(v, 1)));
  }

  /** Finishing place for a finish time (1 = first). */
  private placeOf(time: number) {
    const times = [this.player, ...this.rivals.map((r) => r.sim)].filter((s) => s.finished).map((s) => s.finishTime);
    return 1 + times.filter((t) => t < time).length;
  }
  private menuCheer = 0;
  /** Home: how far your runner has been turned by dragging, and its coasting speed (rad/s). */
  private spin = 0;
  private spinVel = 0;
  private spinHeld = false;
  private lastDt = 1 / 60;
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

  /** Room tags over the runners on the line, you first then the others. */
  private placePickTags() {
    const w = innerWidth, h = innerHeight;
    const v = new THREE.Vector3();
    const heads = [this.player, ...this.rivals.map((r) => r.sim)];
    this.hud.placePickTags(heads.map((s) => {
      this.path.toWorld(s.x, 2.05, s.d, v).project(this.camera);
      return v.z < 1 ? { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h } : null;
    }));
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

  /** @param go ready at once (straight into the countdown solo); otherwise just back in the room */
  private again(btn: HTMLButtonElement, go: boolean) {
    const o = this.online;
    this.autoReady = go;
    if (o?.connected && o.role === 'guest') {
      o.send({ t: 'again' });
      btn.textContent = 'รอเจ้าห้อง…';
      for (const b of btn.parentElement!.querySelectorAll<HTMLButtonElement>('.again, .room-btn')) b.disabled = true;
      return;
    }
    // Back to the room with the same runner, for a new track.
    this.onStartPressed();
  }
  /** Pressed "race again": press ready as soon as the room opens. */
  private autoReady = false;

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

  /**
   * What a rival runs into is smashed and gone for everyone, as it is when the
   * player hits it: a dash ploughs through whatever it touches, a fumble
   * breaks the obstacle in its lane of that row.
   */
  private rivalSmash(s: Rival, id: string) {
    const row = this.track.rows[s.crashRow];
    if (row && s.d > row.d1 + 1) s.crashRow = -1;
    // A dash or a boost ploughs through whatever it touches.
    const plough = s.dashing || s.itemBoostT > 0;
    if (!plough && s.crashRow < 0) return;
    const hw = BODY.width / 2, hd = BODY.depth / 2;
    for (const o of this.track.obstacles) {
      if (o.d > s.d + 3) break;
      if (o.hit || o.d + o.length < s.d - 3 || o.kind === 'gap' || o.kind === 'slow' || o.kind === 'bounce') continue;
      // A fumble only breaks what sits in its own lane, not a hazard across the whole track.
      const crash = o.row === s.crashRow && !spansTrack(o.kind);
      if (!crash && !plough) continue;
      rivalBoxes.length = 0;
      hitBoxes(o, this.t, rivalBoxes);
      const hit = rivalBoxes.some((b) => s.x + hw > b.x0 && s.x - hw < b.x1 && s.d + hd > b.d0 && s.d - hd < b.d1 &&
        (crash || (s.y < b.y1 && s.y + PLAYER.height > b.y0)));
      if (!hit) continue;
      o.hit = true;
      if (crash) s.crashRow = -1;
      if (Math.abs(s.d - this.player.d) < 25) sound.smash();
      if (o.d < this.player.d + VIEW_AHEAD) this.smashView(o, s.x, s.speed);
      if (this.netRace) this.online!.send({ t: 'ob', id: o.id, by: id });
    }
  }

  /** Runners are solid (someone else's Remote has no bump methods, so it is never moved). */
  private contacts() {
    resolveContacts([this.player, ...this.rivals.map((r) => r.sim)]);
  }

  /** Runners through item boxes (other players collect on their own screens, the host's bots on the host's). */
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
        const item = rollItem(Math.random(), ahead / Math.max(1, all.length - 1), ahead > 0, this.itemsOn);
        if (!item || !s.give(item)) continue;
        s.took.add(box.id);
        this.debris.burst(laneX(box.lane), ITEM.boxY, box.d, BOX_COLORS, s === this.player ? 14 : 6, 0.6, s.speed * 0.6);
      }
    }
  }

  /** Ink: splatters every runner ahead of `from`. */
  private splatAhead(from: Player | Rival) {
    let hits = 0;
    const p = this.player;
    const far: string[] = [];
    if (from !== p && !p.finished && p.d > from.d) { p.ink(); hits++; }
    for (const r of this.rivals) {
      const s = r.sim;
      if (s === from || s.finished || s.d <= from.d) continue;
      if (s instanceof Rival) s.ink();
      else if (!s.gone) far.push(r.id); // they splatter on their own screen (the host's bots, on the host's)
      else continue;
      hits++;
      this.debris.burst(s.x, s.y + 1.6, s.d, INK_COLORS, 14, 0.8, s.speed * 0.6);
    }
    if (far.length && this.online?.connected) this.online.send({ t: 'ink', hit: far });
    return hits;
  }

  private onPlayerEvent(e: PlayerEvent) {
    const v = this.playerView;
    if (this.netRace && this.online!.connected) {
      const o = this.online!;
      if (e.type === 'finish') o.send({ t: 'fin', time: this.player.finishTime });
      else if (['jump', 'bounce', 'slide', 'stumble', 'fall', 'dash', 'stunned'].includes(e.type)) o.send({ t: 'm', m: e.type as NetMove });
      else if (e.type === 'shoved') o.send({ t: 'm', m: 'stunned' }); // the others see the stagger
      else if (e.type === 'item' && e.item === 'shield') o.send({ t: 'sh', on: true });
      else if (e.type === 'shieldEnd') o.send({ t: 'sh', on: false });
      else if (e.type === 'item' && e.item === 'rocket') o.send({ t: 'rk', on: true });
      else if (e.type === 'rocketEnd') o.send({ t: 'rk', on: false });
      if (e.type === 'pickup' || e.type === 'item') o.send({ t: 'it', k: this.player.item });
      if (e.type === 'smash') o.send({ t: 'ob', id: e.obstacle.id });
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
        this.hud.flash(desktop ? 'แดชพร้อม! กด Shift' : 'แดชพร้อม! กดปุ่ม ⚡', 'good');
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
          this.hud.flash(`บูสต์! ชนทะลุ · FOCUS +${ITEM.boostFocus}`, 'good');
        } else if (e.item === 'shield') {
          sound.shield();
          this.debris.burst(p.x, p.y + 1, p.d, POP_COLORS, 10, 0.8, p.speed);
          this.hud.flash(`เปิดโล่ ${ITEM.shieldTime} วิ!`, 'good');
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
          this.hud.flash(`ขา${ITEM_NAME.spring} ${ITEM.springTime} วิ! กระโดดสูง`, 'good');
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
      case 'shieldEnd':
        sound.shieldPop();
        this.debris.burst(this.player.x, this.player.y + 1, this.player.d + 0.6, POP_COLORS, 14, 0.9, this.player.speed);
        this.hud.flash('โล่หมดแล้ว');
        break;
      case 'springEnd':
        this.hud.flash('ขาสปริงหมดแล้ว');
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
      // Smashed by someone further ahead: already gone.
      if (o.hit && o.kind !== 'gap' && o.kind !== 'slow' && o.kind !== 'bounce') v.root.visible = false;
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
        const gait = p.flying ? 'fly' : 'run';
        if ((this.playerLock <= 0 || p.flying) && p.launched && (p.grounded || p.flying) && !p.sliding && !p.stunned && v.state !== gait) v.play(gait);
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
      const onRocket = s instanceof Rival ? s.flyT > 0 : s.rocket;
      if ((r.lock <= 0 || onRocket) && started && (this.state === 'race' || this.state === 'done')) {
        // Past the line they run it out, then the winner celebrates.
        const stopped = (s.finished || s.halted) && s.speed < STOP_SPEED;
        r.view.play(onRocket ? 'fly' : !stopped ? 'run' : !s.finished ? 'defeat' : this.placeOf(s.finishTime) === 1 ? 'victory' : 'idle');
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
      r.view.update(dt, this.podium ? 0 : s.speed, this.podium ? 0 : s.laneVelocity);
    }
    if (this.podium) this.updateCeremony(dt);
    this.lastDt = dt;
    if (this.playerView) {
      if (this.state === 'menu' && !this.spinHeld) {
        this.spinVel *= Math.exp(-dt * 3);
        this.spin += this.spinVel * dt;
      }
      this.playerView.root.rotation.y = this.state === 'menu' ? this.spin : 0;
    }
    if (this.menuCheer > 0 && (this.menuCheer -= dt) <= 0 && (this.state === 'menu' || this.state === 'pick')) this.playerView?.play('idle');

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
    if (this.state === 'pick') this.placePickTags();
    if (this.state === 'race' || this.state === 'done') {
      this.hud.update(this.racers(), this.t, dt);
      this.hud.setDash(p.dash / DASH.full, p.dashing);
      this.hud.setItem(p.item, p.itemRoll > 0, this.t, p.items.length);
      // The held item rides over the runner's head, where it is tapped.
      const at = p.item && !this.podium ? this.headAt(p.x, p.y + 0.62, p.d).project(this.camera) : null;
      this.hud.placeItem(at && at.z < 1 ? { x: (at.x * 0.5 + 0.5) * innerWidth, y: (-at.y * 0.5 + 0.5) * innerHeight } : null);
      this.hud.setTimers([['🚀', p.flyT], ['🛡️', p.shieldT], ['🦘', p.springT]]);
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
    this.debris.streak(x + (Math.random() - 0.5) * 0.3, y + 1.2, d - 0.55 - Math.random() * 0.6, Math.random() < 0.5 ? 0xffa21f : 0xffe066);
    if (Math.random() < 0.3) this.debris.burst(x, y + 1.2, d - 0.8, [0xdddddd, 0xbbbbbb], 1, 0.3, 0);
  }

  /** Smashed: pop the model and throw chunks in its colours. */
  private smashView(o: Obstacle, byX = this.player.x, bySpeed = this.player.speed) {
    this.views.get(o.id)?.smash();
    const pal = BIOMES[o.biome];
    const colors = [pal.a, pal.c, pal.b, 0xffffff];
    const x = spansTrack(o.kind) ? byX : laneX(o.lane);
    const fwd = bySpeed * 0.5;
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
    } else if (this.state === 'pick' && e.key === 'Enter') {
      e.preventDefault();
      document.querySelector<HTMLButtonElement>('.ready-btn:not(:disabled)')?.click();
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

    if (!this.podium && this.state !== 'menu' && this.state !== 'pick' && cam.view?.enabled) {
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
      this.viewOffset.lerp(new THREE.Vector2(ins.right / 2, (ins.bottom - ins.top) / 2), k);
      cam.setViewOffset(w, h, this.viewOffset.x, this.viewOffset.y, w, h);
    } else if (this.state === 'pick') {
      // The room: the whole start line from the front, every runner in their
      // lane, framed in the space the title and the panel leave free.
      const w = innerWidth, h = innerHeight;
      const ins = this.hud.pickInsets();
      const fw = Math.max(0.35, (w - ins.right) / w);
      const fh = Math.max(0.3, (h - ins.top - ins.bottom) / h);
      cam.fov = portrait ? 50 : 40;
      const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      // Fit the outer runners (not the kerbs) across the free width.
      const dist = Math.max((laneX(LANES[LANE_COUNT - 1]) + 0.9) / (tan * cam.aspect * fw), 1.75 / (tan * fh));
      t.lerp(new THREE.Vector3(0, 1.4 + dist * 0.1, p.d + dist), k);
      look.set(0, 1.15, p.d);
      this.viewOffset.lerp(new THREE.Vector2(ins.right / 2, (ins.bottom - ins.top) / 2), k);
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
      const cx = THREE.MathUtils.clamp(p.x + side * 0.8, -TRACK_HALF + 0.6, TRACK_HALF - 0.6);
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
