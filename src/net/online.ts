// Online races for up to five players through a public MQTT broker (over
// WebSocket, so it gets through any home or mobile network; no game server of
// our own). Everyone in a room publishes to their own topic and listens to the
// whole room, so each packet reaches every other player in one hop. The host
// owns the room: it lets players in (up to the room size), keeps the member
// list, picks the seed, runs the bots and starts each race. Every player
// simulates their own runner and streams its state to the rest. Guests keep
// their clock in step with the host's, so a race starts at the same moment on
// every screen however long the start message took to get there.
import mqtt, { type MqttClient } from 'mqtt';
import type { ItemKind } from '../world/items.ts';

const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const PREFIX = 'animaldash/v2/';
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const HEARTBEAT = 1; // s
const TIMEOUT = 8; // s without a packet = gone
const JOIN_TIMEOUT = 25;
/** A broker that hasn't let us in by now is skipped for the next one… */
const BROKER_WAIT = 12;
/** …as is one where a guest knocks this long with no answer (the room isn't on it). */
const KNOCK_WAIT = 5;
/** Most players in a room (one per lane on the widest track). */
export const ROOM_MAX = 5;

export type NetMove = 'jump' | 'bounce' | 'slide' | 'stumble' | 'fall' | 'launch' | 'dash' | 'stunned';

export interface NetRules { map: string; lanes: number; items: ItemKind[]; bots: number }
/** A player in the room: id, character, pressed ready in the runner select. */
export interface Member { id: string; c: string; r?: boolean }
/** A runner on the line, by lane index from the left: a player's id or a bot's ("b0", "b1", …), and its character. */
export interface Seat { id: string; c: string }

/** Bot state from the host, one per bot (w: host clock when sent; f: finish time; flags for drawing). */
export interface BotState { i: string; d: number; x: number; y: number; v: number; f?: number; sh?: 1; rk?: 1; k?: ItemKind }

export type NetMsg =
  // Host → everyone: who's in, and (in the runner select) the line-up for the race.
  | { t: 'room'; ps: Member[]; stage: 'lobby' | 'pick' | 'race'; seed: number; rules: NetRules; seats: (Seat | null)[] }
  | { t: 'char'; id: string } // I picked this runner
  | { t: 'ready'; on: boolean } // I'm ready
  | { t: 'start'; seed: number; at: number } // at: host clock (ms) when the start sequence begins
  | { t: 'again' }
  | { t: 's'; d: number; x: number; y: number; v: number; w?: number; f?: number } // my runner (f: my finish time, once over the line)
  | { t: 'bs'; w: number; a: BotState[] } // host: the bots
  | { t: 'm'; m: NetMove; id?: string } // a move (id: the host's bot that made it)
  | { t: 'fin'; time: number; id?: string }
  | { t: 'ink'; hit: string[] } // these runners were ahead when I (or the host's bot) used ink
  | { t: 'sh'; on: boolean } // my shield went up / popped
  | { t: 'rk'; on: boolean } // my rocket lit / ran out
  | { t: 'it'; k: ItemKind | null } // the item I'm holding
  | { t: 'ob'; id: number; by?: string }; // smashed this obstacle (by: the host's bot): it's gone for everyone

/** Joining: a guest knocks, the host lets them in (or says the room is full). Clock sync: the guest sends `a` (its clock), the host answers with `b` (its own). */
type Wire = NetMsg | { t: 'hello'; host?: boolean } | { t: 'full' } | { t: 'ping' } | { t: 'bye' } | { t: 'sync'; a: number; b?: number };

export type NetStatus = 'waiting' | 'connecting' | 'connected' | 'closed' | 'error';

export class Online {
  readonly role: 'host' | 'guest';
  readonly code: string;
  /** Which broker the room is on (the host moves on to the next if one is down). */
  broker: number;
  /** My id in the room. */
  readonly me = Math.random().toString(36).slice(2, 10);
  status: NetStatus;
  error = '';
  /** Host: players let in (not counting the host), in the order they came. */
  readonly peers: string[] = [];
  hostId: string | null = null;
  onMessage: (m: NetMsg, from: string) => void = () => {};
  onStatus: () => void = () => {};
  /** Host: a player came in or left. */
  onPeers: () => void = () => {};
  private client!: MqttClient;
  private heard = new Map<string, number>();
  private timer: number;
  /** Host clock minus ours (ms), from the quickest round trip so far. */
  private offset = 0;
  private bestRtt = Infinity;

  private constructor(role: 'host' | 'guest', code: string, broker: number) {
    this.role = role;
    this.code = code;
    this.broker = broker;
    this.status = role === 'host' ? 'waiting' : 'connecting';
    if (role === 'host') this.hostId = this.me;
    this.open();
    this.timer = window.setInterval(() => this.tick(), HEARTBEAT * 1000);
  }

  private open() {
    const client = mqtt.connect(BROKERS[this.broker] ?? BROKERS[0], {
      clientId: `ad_${this.me}`,
      reconnectPeriod: 2000,
      connectTimeout: 20000,
      will: { topic: this.topic(this.me), payload: JSON.stringify({ t: 'bye', from: this.me }), qos: 0, retain: false },
    });
    this.client = client;
    this.opened = performance.now();
    client.on('connect', () => {
      this.inAt = performance.now();
      client.subscribe(this.topic('+'));
      if (this.role === 'host') this.set('connected');
      else this.post({ t: 'hello' });
    });
    client.on('message', (_topic, buf) => {
      let w: Wire & { from?: string; to?: string };
      try { w = JSON.parse(buf.toString()); } catch { return; }
      this.receive(w);
    });
  }
  private opened = 0;
  private inAt = 0;
  /** Brokers given up on so far. */
  private tried = 0;

  static host() {
    let code = '';
    for (let i = 0; i < 5; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    return new Online('host', code, 0);
  }

  /**
   * A room typed in by hand: the 5-character code (any case, spaces ignored)
   * or a whole invite link pasted in. Null if it can't be a room.
   */
  static parseCode(text: string): { code: string; broker?: number } | null {
    let raw = text.trim();
    let broker: number | undefined;
    const link = raw.match(/[?&]room=([^&#\s]+)/i);
    if (link) {
      broker = Number(raw.match(/[?&]b=(\d+)/)?.[1]) || 0;
      raw = link[1];
    }
    const code = raw.toLowerCase().replace(/[\s-]/g, '');
    if (code.length !== 5 || [...code].some((c) => !CODE_CHARS.includes(c))) return null;
    return { code, broker };
  }

  /** @param broker the one the invite link names; without it every broker is tried in turn */
  static join(code: string, broker?: number) {
    const o = new Online('guest', code.toLowerCase(), broker ?? 0);
    if (broker !== undefined) o.tried = BROKERS.length - 1;
    return o;
  }

  get link() {
    const url = new URL(location.href);
    url.search = `?room=${this.code}${this.broker ? `&b=${this.broker}` : ''}`;
    url.hash = '';
    return url.toString();
  }

  /** The host's clock (ms): the same moment reads the same on every device. */
  now() {
    return Date.now() + this.offset;
  }

  /** In the room: the host's room is open, or a guest has been let in. */
  get connected() {
    return this.status === 'connected';
  }

  private topic(id: string) {
    return `${PREFIX}${this.code}/${id}`;
  }

  private receive(w: Wire & { from?: string; to?: string }) {
    const from = w.from;
    if (!from || from === this.me || (w.to && w.to !== this.me)) return;
    if (this.role === 'host') {
      if (w.t === 'hello') {
        if (!this.peers.includes(from)) {
          if (this.peers.length + 1 >= ROOM_MAX) { this.post({ t: 'full', to: from }); return; }
          this.peers.push(from);
          this.heard.set(from, performance.now());
          this.onPeers();
        }
        this.post({ t: 'hello', host: true, to: from });
        return;
      }
      if (!this.peers.includes(from)) return;
    } else {
      if (w.t === 'full' && this.status === 'connecting') { this.fail('ห้องเต็มแล้ว'); return; }
      if (w.t === 'hello' && w.host && !this.hostId) {
        this.hostId = from;
        this.post({ t: 'sync', a: Date.now() });
        this.set('connected');
      }
      if (!this.hostId) return;
    }
    this.heard.set(from, performance.now());
    switch (w.t) {
      case 'hello':
      case 'ping':
        break;
      case 'bye':
        if (this.role === 'host') this.drop(from);
        else if (from === this.hostId) this.set('closed');
        // Another guest leaving: the host's next member list says so.
        break;
      case 'sync':
        if (this.role === 'host' && w.b === undefined) this.post({ t: 'sync', a: w.a, b: Date.now(), to: from });
        else if (this.role === 'guest' && w.b !== undefined && from === this.hostId) {
          const now = Date.now(), rtt = now - w.a;
          // The quickest answer is the one least skewed by a slow leg.
          if (rtt >= 0 && rtt <= this.bestRtt) {
            this.bestRtt = rtt;
            this.offset = w.b + rtt / 2 - now;
          }
        }
        break;
      case 'full':
        break;
      default:
        this.onMessage(w, from);
    }
  }

  /** Host: a player left (or went quiet). */
  private drop(id: string) {
    const i = this.peers.indexOf(id);
    if (i < 0) return;
    this.peers.splice(i, 1);
    this.heard.delete(id);
    this.onPeers();
  }

  private tick() {
    const now = performance.now();
    if (this.connected) {
      this.post({ t: 'ping' });
      if (this.role === 'guest') {
        this.post({ t: 'sync', a: Date.now(), to: this.hostId! });
        if (now - (this.heard.get(this.hostId!) ?? 0) > TIMEOUT * 1000) this.set('closed');
      } else {
        for (const id of [...this.peers]) if (now - (this.heard.get(id) ?? 0) > TIMEOUT * 1000) this.drop(id);
      }
    } else if (this.tried < BROKERS.length - 1 && (this.status === 'waiting' || this.status === 'connecting') && (this.client.connected
      ? this.role === 'guest' && now - this.inAt > KNOCK_WAIT * 1000
      : now - this.opened > BROKER_WAIT * 1000)) {
      // This broker is down or blocked here (or, for a guest, the room isn't on it):
      // try the next one. The host's link says which one the room ended up on.
      this.tried++;
      this.client.end(true);
      this.broker = (this.broker + 1) % BROKERS.length;
      this.open();
      this.onStatus();
    } else if (!this.client.connected && this.status !== 'closed' && now - this.opened > JOIN_TIMEOUT * 1000) {
      this.fail('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง');
    } else if (this.role === 'guest' && this.status === 'connecting') {
      // The host may not have been subscribed yet: keep knocking for a while.
      if (now - this.opened > JOIN_TIMEOUT * 1000) this.fail('ไม่พบห้องนี้ (เจ้าห้องอาจปิดไปแล้ว)');
      else if (this.client.connected) this.post({ t: 'hello' });
    }
  }

  private post(w: Wire & { to?: string }, qos: 0 | 1 = 0) {
    // Lossy state goes only while connected; the rest (finish, items, …) is queued
    // through a reconnect by the client rather than dropped.
    if (this.client.connected || qos === 1) this.client.publish(this.topic(this.me), JSON.stringify({ ...w, from: this.me }), { qos });
  }

  private set(s: NetStatus) {
    if (this.status === s || this.status === 'error') return;
    this.status = s;
    this.onStatus();
  }

  private fail(msg: string) {
    this.error = msg;
    this.status = 'error';
    this.onStatus();
  }

  send(m: NetMsg) {
    if (this.connected) this.post(m, m.t === 's' || m.t === 'bs' ? 0 : 1);
  }

  close() {
    this.onStatus = () => {};
    this.onMessage = () => {};
    this.onPeers = () => {};
    clearInterval(this.timer);
    this.post({ t: 'bye' });
    this.client.end();
  }
}
