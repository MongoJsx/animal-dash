// Sound: recorded clips (the 3-2-1-go count, stumble thud, finish voice and the
// menu music) plus a couple of effects synthesized with Web Audio. Browsers
// only allow sound after the first tap or key press, so the audio context is
// made then, and the music starts if the menu is still up.
import { assetUrl } from './asset.ts';

const CLIPS = {
  countdown: '/assets/sounds/countdown.mp3',
  finish: '/assets/sounds/finish.mp3',
  thud: '/assets/sounds/thud.mp3',
  menu: '/assets/sounds/menu.mp3',
  click: '/assets/sounds/click.mp3',
};
export type Clip = keyof typeof CLIPS;
/** In the countdown clip: beeps at 0, 1 and 2 s, "GO" at this time. */
export const COUNTDOWN_GO = 3;
// The thud's hit comes after a short silence, then rumbles for 3 s: take the hit, fade the rest.
const THUD = { from: 0.28, length: 1 };
// The music's sound runs this span of the file: loop it without the silent ends.
const MENU_LOOP = [0.03, 28.92];

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

class Sound {
  muted = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private wantMusic = false;
  private musicSrc: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** Clip files, fetched at once; decoded once there's a context. */
  private files = new Map<Clip, Promise<ArrayBuffer>>();
  private clips = new Map<Clip, AudioBuffer>();

  constructor() {
    try { this.muted = localStorage.getItem('muted') === '1'; } catch { /* private mode */ }
    for (const [name, url] of Object.entries(CLIPS) as [Clip, string][]) {
      this.files.set(name, fetch(assetUrl(url)).then((r) => r.arrayBuffer()));
    }
    // Kept for good: iOS suspends the context again after calls and the like.
    for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, () => this.unlock(), { capture: true });
  }

  private unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.gain.value = 0.9;
      this.music = ctx.createGain();
      this.music.gain.value = 0.5;
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      for (const [name, file] of this.files) {
        file.then((b) => ctx.decodeAudioData(b)).then((buf) => {
          this.clips.set(name, buf);
          if (name === 'menu' && this.wantMusic) this.startMusic();
        }, () => {});
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.wantMusic) this.startMusic();
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('muted', this.muted ? '1' : '0'); } catch { /* private mode */ }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  /** Time to schedule at, or null when there's nothing to hear. */
  private now() {
    return this.ctx && this.ctx.state === 'running' && !this.muted ? this.ctx.currentTime : null;
  }

  private tone(f: number, at: number, dur: number, type: OscillatorType = 'square', vol = 0.2, to = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.sfx);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  /** A burst of filtered noise. */
  private hiss(at: number, dur: number, vol: number, freq: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    f.type = 'lowpass';
    f.frequency.value = freq;
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.02);
  }

  // ── Effects ────────────────────────────────────────────────────────
  /** Ran through an item box: a quick sparkly arpeggio. */
  pickup() {
    const t = this.now();
    if (t === null) return;
    [84, 88, 91, 96].forEach((n, i) => this.tone(midi(n), t + i * 0.055, 0.14, 'square', 0.09));
    this.tone(midi(103), t + 0.22, 0.25, 'sine', 0.07);
  }

  /**
   * Pressed start. The press may be the page's first tap, which is what makes
   * the audio context, so the clip may still be decoding: try for a moment.
   */
  click(tries = 8) {
    if (!this.play('click') && tries > 0) setTimeout(() => this.click(tries - 1), 40);
  }

  /** Tripped over something or knocked down: the thud. */
  stumble() {
    this.play('thud', THUD.from, THUD.length);
  }

  /** Down a hole: a falling slide whistle, then the landing. */
  fall() {
    const t = this.now();
    if (t === null) return;
    this.tone(900, t, 0.5, 'triangle', 0.14, 160);
    this.hiss(t + 0.45, 0.25, 0.55, 500);
    this.tone(120, t + 0.45, 0.22, 'sine', 0.35, 40);
  }

  /**
   * Play a recorded clip, `from` seconds into it (to catch up when it starts
   * late), faded out after `length` s if given. False if it isn't loaded yet,
   * so the caller can try again.
   */
  play(name: Clip, from = 0, length = 0) {
    const ctx = this.ctx, buf = this.clips.get(name);
    if (!ctx || !buf || ctx.state !== 'running') return false;
    if (this.muted || from >= buf.duration) return true;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf;
    src.connect(g).connect(this.sfx);
    const t = ctx.currentTime;
    if (length) {
      g.gain.setValueAtTime(1, t + length * 0.6);
      g.gain.linearRampToValueAtTime(0, t + length);
      src.stop(t + length + 0.05);
    }
    src.start(t, Math.max(0, from));
    return true;
  }

  // ── Menu music ─────────────────────────────────────────────────────
  menuMusic(on: boolean) {
    this.wantMusic = on;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  private startMusic() {
    const ctx = this.ctx, buf = this.clips.get('menu');
    if (this.musicSrc || !ctx || !buf) return;
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = buf;
    src.loop = true;
    [src.loopStart, src.loopEnd] = MENU_LOOP;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.8);
    src.connect(gain).connect(this.music);
    src.start(ctx.currentTime, MENU_LOOP[0]);
    this.musicSrc = { src, gain };
  }

  /** Fade the music out quickly (the race is starting). */
  private stopMusic() {
    const m = this.musicSrc, ctx = this.ctx;
    if (!m || !ctx) return;
    this.musicSrc = null;
    m.gain.gain.cancelScheduledValues(ctx.currentTime);
    m.gain.gain.setValueAtTime(m.gain.gain.value, ctx.currentTime);
    m.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    m.src.stop(ctx.currentTime + 0.45);
  }
}

export const sound = new Sound();
