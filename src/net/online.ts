// Two-player online races through a public MQTT broker (over WebSocket, so it
// gets through any home or mobile network; no game server of our own). The
// host owns a room code; host and guest each publish to their own topic and
// listen on the other's. The host picks the seed and starts each race; both
// sides simulate their own runner and stream its state to the other.
import mqtt, { type MqttClient } from 'mqtt';

const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const PREFIX = 'animaldash/v1/';
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const HEARTBEAT = 1; // s
const TIMEOUT = 8; // s without a packet = friend gone
const JOIN_TIMEOUT = 15;

export type NetMove = 'jump' | 'bounce' | 'slide' | 'stumble' | 'fall' | 'launch' | 'dash' | 'stunned';

export type NetMsg =
  | { t: 'char'; id: string }
  | { t: 'start'; seed: number; map?: string }
  | { t: 'again' }
  | { t: 's'; d: number; x: number; y: number; v: number }
  | { t: 'm'; m: NetMove }
  | { t: 'fin'; time: number }
  | { t: 'ink' } // you were ahead of me when I used ink
  | { t: 'sh'; on: boolean } // my shield went up / popped
  | { t: 'rk'; on: boolean }; // my rocket lit / ran out

type Wire = NetMsg | { t: 'hello' } | { t: 'ping' } | { t: 'bye' };

export type NetStatus = 'waiting' | 'connecting' | 'connected' | 'closed' | 'error';

export class Online {
  readonly role: 'host' | 'guest';
  readonly code: string;
  readonly broker: number;
  status: NetStatus;
  error = '';
  onMessage: (m: NetMsg) => void = () => {};
  onStatus: () => void = () => {};
  private client: MqttClient;
  private me = Math.random().toString(36).slice(2, 10);
  private friend: string | null = null;
  private lastHeard = 0;
  private started = performance.now();
  private timer: number;

  private constructor(role: 'host' | 'guest', code: string, broker: number) {
    this.role = role;
    this.code = code;
    this.broker = broker;
    this.status = role === 'host' ? 'waiting' : 'connecting';
    const out = this.topic(role);
    this.client = mqtt.connect(BROKERS[broker] ?? BROKERS[0], {
      clientId: `ad_${this.me}`,
      reconnectPeriod: 2000,
      connectTimeout: 10000,
      will: { topic: out, payload: JSON.stringify({ t: 'bye', from: this.me }), qos: 0, retain: false },
    });
    this.client.on('connect', () => {
      this.client.subscribe(this.topic(role === 'host' ? 'guest' : 'host'));
      if (role === 'guest') this.post({ t: 'hello' });
    });
    this.client.on('message', (_topic, buf) => {
      let w: Wire & { from?: string };
      try { w = JSON.parse(buf.toString()); } catch { return; }
      this.receive(w);
    });
    this.timer = window.setInterval(() => this.tick(), HEARTBEAT * 1000);
  }

  static host() {
    let code = '';
    for (let i = 0; i < 5; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    return new Online('host', code, 0);
  }

  /**
   * A room typed in by hand: the 5-character code (any case, spaces ignored)
   * or a whole invite link pasted in. Null if it can't be a room.
   */
  static parseCode(text: string): { code: string; broker: number } | null {
    let raw = text.trim();
    let broker = 0;
    const link = raw.match(/[?&]room=([^&#\s]+)/i);
    if (link) {
      broker = Number(raw.match(/[?&]b=(\d+)/)?.[1]) || 0;
      raw = link[1];
    }
    const code = raw.toLowerCase().replace(/[\s-]/g, '');
    if (code.length !== 5 || [...code].some((c) => !CODE_CHARS.includes(c))) return null;
    return { code, broker };
  }

  static join(code: string, broker: number) {
    return new Online('guest', code.toLowerCase(), broker);
  }

  get link() {
    const url = new URL(location.href);
    url.search = `?room=${this.code}${this.broker ? `&b=${this.broker}` : ''}`;
    url.hash = '';
    return url.toString();
  }

  get connected() {
    return this.status === 'connected';
  }

  private topic(role: 'host' | 'guest') {
    return `${PREFIX}${this.code}/${role}`;
  }

  private receive(w: Wire & { from?: string }) {
    if (!w.from || w.from === this.me) return;
    if (this.role === 'host' && !this.friend && w.t === 'hello') this.friend = w.from; // first guest gets the room
    if (this.role === 'guest' && !this.friend && w.t === 'hello') this.friend = w.from;
    if (w.from !== this.friend) return;
    this.lastHeard = performance.now();
    switch (w.t) {
      case 'hello':
        if (this.role === 'host') this.post({ t: 'hello' });
        this.set('connected');
        break;
      case 'bye':
        this.set('closed');
        break;
      case 'ping':
        if (this.status !== 'connected' && this.status !== 'closed') this.set('connected');
        break;
      default:
        this.onMessage(w);
    }
  }

  private tick() {
    const now = performance.now();
    if (this.connected) {
      this.post({ t: 'ping' });
      if (now - this.lastHeard > TIMEOUT * 1000) this.set('closed');
    } else if (!this.client.connected && this.status !== 'closed' && now - this.started > JOIN_TIMEOUT * 1000) {
      this.fail('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง');
    } else if (this.role === 'guest' && this.status === 'connecting') {
      // The host may not have been subscribed yet: keep knocking for a while.
      if (now - this.started > JOIN_TIMEOUT * 1000) this.fail('ไม่พบห้องนี้ (เจ้าห้องอาจปิดไปแล้ว)');
      else if (this.client.connected) this.post({ t: 'hello' });
    }
  }

  private post(w: Wire, qos: 0 | 1 = 0) {
    if (this.client.connected) this.client.publish(this.topic(this.role), JSON.stringify({ ...w, from: this.me }), { qos });
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
    if (this.connected) this.post(m, m.t === 's' ? 0 : 1);
  }

  close() {
    this.onStatus = () => {};
    this.onMessage = () => {};
    clearInterval(this.timer);
    this.post({ t: 'bye' });
    this.client.end();
  }
}
