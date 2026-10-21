// Sound effects and the menu tune, all synthesized with Web Audio (nothing to
// download). Browsers only allow sound after the first tap or key press, so the
// audio context is made then, and the tune starts if the menu is still up.

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// Menu tune: four bars of eighth notes over C – Am – F – G (0 = rest).
const TEMPO = 132;
const STEP = 60 / TEMPO / 2;
const MELODY = [
  76, 0, 79, 76, 72, 74, 76, 0,
  76, 0, 72, 69, 72, 0, 76, 74,
  72, 0, 77, 72, 69, 72, 77, 79,
  79, 0, 77, 76, 74, 0, 71, 74,
];
const ROOTS = [48, 45, 41, 43];
const BASS = [0, 7, 12, 7]; // on the beats: root, fifth, octave, fifth

class Sound {
  muted = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private wantMusic = false;
  private timer = 0;
  private nextAt = 0;
  private step = 0;

  constructor() {
    try { this.muted = localStorage.getItem('muted') === '1'; } catch { /* private mode */ }
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
      this.music.gain.value = 0.45;
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.wantMusic) this.startLoop();
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

  private tone(f: number, at: number, dur: number, type: OscillatorType = 'square', vol = 0.2, to = 0, out = this.sfx) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  /** A burst of filtered noise (thuds, hi-hats, crowd). */
  private hiss(at: number, dur: number, vol: number, freq: number, filter: BiquadFilterType = 'lowpass', out = this.sfx) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    f.type = filter;
    f.frequency.value = freq;
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(out);
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

  /** Tripped over something: a thud and a wobbly drop. */
  stumble() {
    const t = this.now();
    if (t === null) return;
    this.hiss(t, 0.18, 0.5, 600);
    this.tone(160, t, 0.2, 'sine', 0.35, 45);
    this.tone(520, t + 0.05, 0.28, 'triangle', 0.1, 220);
  }

  /** Down a hole: a falling slide whistle, then the landing. */
  fall() {
    const t = this.now();
    if (t === null) return;
    this.tone(900, t, 0.5, 'triangle', 0.14, 160);
    this.hiss(t + 0.45, 0.25, 0.55, 500);
    this.tone(120, t + 0.45, 0.22, 'sine', 0.35, 40);
  }

  /** Over the line: a fanfare (a bigger one for first place) and a cheer. */
  finish(win: boolean) {
    const t = this.now();
    if (t === null) return;
    const notes = win ? [67, 72, 76, 79, 84] : [67, 72, 76];
    notes.forEach((n, i) => this.tone(midi(n), t + i * 0.12, 0.2, 'square', 0.1));
    const end = t + notes.length * 0.12;
    for (const n of win ? [72, 76, 79, 84] : [72, 76, 79]) this.tone(midi(n), end, win ? 1.1 : 0.7, 'triangle', 0.09);
    this.hiss(end, win ? 1.8 : 1.1, 0.12, 1800, 'bandpass');
  }

  // ── Menu tune ──────────────────────────────────────────────────────
  menuMusic(on: boolean) {
    this.wantMusic = on;
    if (on && this.ctx) this.startLoop();
    else if (!on) this.stopLoop();
  }

  private startLoop() {
    if (this.timer || !this.ctx) return;
    this.step = 0;
    this.nextAt = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private stopLoop() {
    clearInterval(this.timer);
    this.timer = 0;
  }

  /** Queue the notes due in the next moment (a timer alone would drift). */
  private schedule() {
    const ctx = this.ctx!;
    // Back from a background tab: pick up from now rather than catch up.
    if (this.nextAt < ctx.currentTime - 0.2) this.nextAt = ctx.currentTime + 0.05;
    while (this.nextAt < ctx.currentTime + 0.12) {
      const i = this.step % MELODY.length, at = this.nextAt;
      const m = MELODY[i];
      if (m) this.tone(midi(m), at, STEP * 0.9, 'square', 0.07, 0, this.music);
      if (i % 2 === 0) this.tone(midi(ROOTS[i >> 3] + BASS[(i >> 1) % 4]), at, STEP * 1.8, 'triangle', 0.16, 0, this.music);
      if (i % 4 === 0) this.tone(140, at, 0.14, 'sine', 0.22, 45, this.music); // kick
      else if (i % 2 === 1) this.hiss(at, 0.04, 0.05, 7000, 'highpass', this.music); // hi-hat
      this.step++;
      this.nextAt += STEP;
    }
  }
}

export const sound = new Sound();
