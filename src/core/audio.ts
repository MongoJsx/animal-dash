// Sound: recorded effects for every action, crowd and countryside loops, and
// music. Effects are small clips decoded into memory; the two music tracks
// stream through media elements (minutes of decoded audio would cost tens of
// MB on a phone). Everything runs through one Web Audio graph, so the mute
// button covers it all. Browsers only allow sound after the first tap or key
// press, so the context is made then. Sources and licences: assets/CREDITS.md.
import { assetUrl } from './asset.ts';

const SFX = [
  'tap', 'select', 'swipe', 'confirm',
  'countdown', 'cheer', 'crowd-loop', 'birds-loop',
  'step-grass', 'step-concrete', 'step-wood', 'step-snow',
  'whoosh', 'jump', 'land', 'slide', 'hit', 'bump', 'smash', 'fall', 'dash', 'ready', 'pluck',
  'pickup', 'boost', 'shield', 'shield-pop', 'ink', 'splat', 'spring', 'rocket', 'rocket-loop', 'rocket-end',
  'fanfare-win', 'fanfare-good', 'fanfare-lose', 'you-win', 'medal', 'popper', 'fireworks',
] as const;
export type Clip = typeof SFX[number];
export type Surface = 'grass' | 'concrete' | 'wood' | 'snow';
type Loop = 'crowd-loop' | 'birds-loop' | 'rocket-loop';
type Track = 'menu' | 'race';

/** In the countdown clip: beeps with "3", "2", "1" at 0, 1 and 2 s, "GO!" and the gun at this time. */
export const COUNTDOWN_GO = 3;
// Each footstep clip holds five steps, one every half second.
const STEP_GAP = 0.5, STEP_LEN = 0.4;
const STRIDE = 2.1; // metres between footfalls (matches the dust in juice.ts)
const MUSIC_VOL: Record<Track, number> = { menu: 0.55, race: 0.32 };

interface PlayOpts { vol?: number; rate?: number; from?: number; length?: number; delay?: number }

class Sound {
  muted = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  /** Clip files, fetched at once; decoded once there's a context. */
  private files = new Map<Clip, Promise<ArrayBuffer>>();
  private clips = new Map<Clip, AudioBuffer>();
  private loops = new Map<Loop, { src: AudioBufferSourceNode; gain: GainNode }>();
  private wantLoops = new Map<Loop, number>();
  private tracks = new Map<Track, { el: HTMLAudioElement; gain: GainNode }>();
  private wantTrack: Track | null = null;
  private stride = 0;
  private foot = 0;

  constructor() {
    try { this.muted = localStorage.getItem('muted') === '1'; } catch { /* private mode */ }
    for (const name of SFX) {
      this.files.set(name, fetch(assetUrl(`/assets/sounds/${name}.mp3`)).then((r) => r.arrayBuffer()));
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
      // A gentle limiter so a pile-up of hits never clips.
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -6;
      limit.ratio.value = 8;
      limit.attack.value = 0.003;
      limit.release.value = 0.15;
      this.master.connect(limit).connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.gain.value = 0.85;
      this.music = ctx.createGain();
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      for (const [name, file] of this.files) {
        file.then((b) => ctx.decodeAudioData(b)).then((buf) => {
          this.clips.set(name, buf);
          if (this.wantLoops.has(name as Loop)) this.loop(name as Loop, this.wantLoops.get(name as Loop)!);
        }, () => {});
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.wantTrack) this.startTrack(this.wantTrack);
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('muted', this.muted ? '1' : '0'); } catch { /* private mode */ }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  /**
   * Play a clip: `from` seconds in (to catch up when it starts late), faded
   * out after `length` s if given. False if it isn't loaded yet, so the
   * caller can try again.
   */
  play(name: Clip, o: PlayOpts = {}) {
    const ctx = this.ctx, buf = this.clips.get(name);
    if (!ctx || !buf || ctx.state !== 'running') return false;
    const from = o.from ?? 0;
    if (this.muted || from >= buf.duration) return true;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf;
    src.playbackRate.value = o.rate ?? 1;
    g.gain.value = o.vol ?? 1;
    src.connect(g).connect(this.sfx);
    const t = ctx.currentTime + (o.delay ?? 0);
    // A sound going wrong must never take the game loop down with it.
    try {
      src.start(t, Math.max(0, from));
      if (o.length) {
        g.gain.setValueAtTime(o.vol ?? 1, t + o.length * 0.6);
        g.gain.linearRampToValueAtTime(0, t + o.length);
        src.stop(t + o.length + 0.05);
      }
    } catch { /* skip this one */ }
    return true;
  }

  /** The same sound a little different each time: pitch and level wander. */
  private vary(name: Clip, vol: number, spread = 0.08, o: PlayOpts = {}) {
    return this.play(name, { ...o, vol: vol * (0.85 + Math.random() * 0.15), rate: (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * spread) });
  }

  // ── Menu ───────────────────────────────────────────────────────────
  /** Any button. */
  tap() { this.vary('tap', 1, 0.05); }
  /** A character or a map picked. */
  select() { this.vary('select', 1, 0.03); }
  /** Flicking through the characters. */
  swipe() { this.vary('swipe', 1, 0.06); }

  /**
   * Pressed start. The press may be the page's first tap, which is what makes
   * the audio context, so the clip may still be decoding: try for a moment.
   */
  click(tries = 8) {
    if (!this.play('confirm') && tries > 0) setTimeout(() => this.click(tries - 1), 40);
  }

  // ── Running ────────────────────────────────────────────────────────
  /** Footfalls for the player's run: call every frame. */
  run(dt: number, speed: number, grounded: boolean, surface: Surface) {
    if (!grounded || speed < 2) { this.stride = STRIDE * 0.7; return; }
    this.stride += speed * dt;
    if (this.stride < STRIDE) return;
    this.stride -= STRIDE;
    this.foot = (this.foot + 1 + Math.floor(Math.random() * 3)) % 5;
    // Left and right feet land a touch differently.
    this.vary(`step-${surface}`, this.foot % 2 ? 1 : 0.8, 0.07, { from: this.foot * STEP_GAP, length: STEP_LEN });
  }

  jump() { this.vary('jump', 1, 0.06); }
  land() { this.vary('land', 0.8, 0.08); }
  lane() { this.vary('whoosh', 0.6, 0.1, { rate: 1.35 }); }
  slide() { this.vary('slide', 1, 0.06); }
  /** Tripped over something or knocked down. */
  stumble() { this.vary('hit', 1, 0.04); }
  sideHit() { this.vary('bump', 1, 0.06); }
  bump(soft: boolean) { this.vary('bump', soft ? 0.55 : 0.85, 0.1); }
  smash() { this.vary('smash', 1, 0.08); }
  /** Down a hole: a falling whistle, then the landing. */
  fall() { this.play('fall'); }
  dash() { this.play('dash'); }
  dashReady() { this.play('ready'); }
  /** A clean pass: a pluck that climbs with the Focus level. */
  focus(level: number) { this.play('pluck', { vol: 0.8, rate: 2 ** ((level - 1) * 2 / 12) }); }

  // ── Items ──────────────────────────────────────────────────────────
  pickup() { this.vary('pickup', 1, 0.03); }
  boost() { this.play('boost'); }
  shield() { this.play('shield'); }
  shieldPop() { this.play('shield-pop'); }
  ink() { this.play('ink'); }
  inked() { this.vary('splat', 1, 0.05); }
  spring() { this.vary('spring', 1, 0.04); }
  rocket(on: boolean) {
    if (on) {
      this.play('rocket');
      this.loop('rocket-loop', 0.8);
    } else {
      this.loop('rocket-loop', 0);
      this.play('rocket-end');
    }
  }

  // ── Start, finish, podium ──────────────────────────────────────────
  /** The gun: the crowd at the start roars. */
  gun() { this.play('cheer', { vol: 0.6, length: 4 }); }
  /** Over the line. */
  finish(place: number) {
    this.play('cheer');
    if (place === 1) this.play('you-win', { delay: 0.35 });
    this.play(place === 1 ? 'fanfare-win' : place <= 3 ? 'fanfare-good' : 'fanfare-lose', { delay: place === 1 ? 1.3 : 0.4 });
  }
  medal(place: number) {
    this.vary('medal', 1, 0.02, { rate: place === 0 ? 1 : place === 1 ? 0.94 : 0.89 });
    if (place === 0) this.play('popper', { delay: 0.1 });
  }
  fireworks() { this.play('fireworks', { vol: 0.8 }); }

  // ── Loops and music ────────────────────────────────────────────────
  /** Fade a looping bed (crowd, countryside, rocket) to `vol`; 0 stops it. */
  loop(name: Loop, vol: number) {
    if (vol > 0) this.wantLoops.set(name, vol);
    else this.wantLoops.delete(name);
    const ctx = this.ctx;
    if (!ctx) return;
    let l = this.loops.get(name);
    if (!l && vol > 0) {
      const buf = this.clips.get(name);
      if (!buf) return; // starts once decoded
      const src = ctx.createBufferSource(), gain = ctx.createGain();
      src.buffer = buf;
      src.loop = true;
      gain.gain.value = 0;
      src.connect(gain).connect(this.sfx);
      src.start(ctx.currentTime, Math.random() * buf.duration);
      this.loops.set(name, (l = { src, gain }));
    }
    if (!l) return;
    l.gain.gain.setTargetAtTime(vol, ctx.currentTime, 0.25);
    if (vol <= 0) {
      const old = l;
      this.loops.delete(name);
      setTimeout(() => { try { old.src.stop(); } catch { /* already */ } }, 1500);
    }
  }

  /** Which music plays: the menu tune, the race tune or none. Crossfades. */
  setMusic(track: Track | null) {
    this.wantTrack = track;
    for (const [name, t] of this.tracks) if (name !== track) this.fadeTrack(t, 0);
    if (track) this.startTrack(track);
  }

  /** Kept for callers from before the race had its own tune. */
  menuMusic(on: boolean) {
    this.setMusic(on ? 'menu' : null);
  }

  private startTrack(name: Track) {
    const ctx = this.ctx;
    if (!ctx) return;
    let t = this.tracks.get(name);
    if (!t) {
      const el = new Audio(assetUrl(`/assets/sounds/music-${name}.mp3`));
      el.loop = true;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(this.music);
      this.tracks.set(name, (t = { el, gain }));
    }
    // The race tune starts from the top each race; a tap mid-race only resumes it.
    if (t.el.paused) {
      if (name === 'race') t.el.currentTime = 0;
      void t.el.play().catch(() => {});
    }
    this.fadeTrack(t, MUSIC_VOL[name]);
  }

  private fadeTrack(t: { el: HTMLAudioElement; gain: GainNode }, vol: number) {
    const ctx = this.ctx!;
    t.gain.gain.cancelScheduledValues(ctx.currentTime);
    t.gain.gain.setTargetAtTime(vol, ctx.currentTime, vol ? 0.3 : 0.15);
    if (!vol) setTimeout(() => { if (t.gain.gain.value < 0.01) t.el.pause(); }, 900);
  }
}

export const sound = new Sound();
