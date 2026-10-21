// Swipe + keyboard input, turned into discrete actions the player consumes.
// A tap anywhere is 'tap' (the game turns it into using the held item) and a
// double tap is 'dash' (fires when the meter is full); Q is 'item' outright.
export type Action = 'left' | 'right' | 'jump' | 'slide' | 'dash' | 'item' | 'tap';

const KEYS: Record<string, Action> = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  ArrowDown: 'slide', KeyS: 'slide',
  ShiftLeft: 'dash', ShiftRight: 'dash', KeyE: 'dash', Enter: 'dash',
  KeyQ: 'item', KeyF: 'item',
};

const SWIPE_MIN = 24; // px
const TAP_TIME = 300; // ms a finger may stay down and still be a tap
export const DOUBLE_GAP = 320; // ms from the first tap's lift to the second touch
const DOUBLE_SPREAD = 90; // px between the two taps

export class Input {
  private queue: Action[] = [];
  private start: { x: number; y: number; id: number; t: number; double: boolean } | null = null;
  private fired = false;
  /** The last tap that could open a double tap (lift time and place). */
  private tap: { t: number; x: number; y: number } | null = null;
  enabled = false;

  constructor(target: HTMLElement) {
    addEventListener('keydown', (e) => {
      // e.key as a fallback for keyboards that report an odd code.
      const a = KEYS[e.code] ?? KEYS[e.key];
      if (!a || !this.enabled) return;
      e.preventDefault();
      // A focused menu button must not also "click" on Space/Enter.
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (!e.repeat) this.push(a);
    });
    target.addEventListener('pointerdown', (e) => {
      const t = this.tap;
      this.tap = null;
      const double = !!t && e.timeStamp - t.t < DOUBLE_GAP && Math.hypot(e.clientX - t.x, e.clientY - t.y) < DOUBLE_SPREAD;
      this.start = { x: e.clientX, y: e.clientY, id: e.pointerId, t: e.timeStamp, double };
      this.fired = false;
    });
    // Fire as soon as the finger has travelled far enough, not on release:
    // this shaves ~80 ms off every dodge on a phone.
    target.addEventListener('pointermove', (e) => {
      if (!this.start || this.fired || e.pointerId !== this.start.id) return;
      const dx = e.clientX - this.start.x;
      const dy = e.clientY - this.start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
      this.fired = true;
      if (Math.abs(dx) > Math.abs(dy)) this.push(dx < 0 ? 'left' : 'right');
      else this.push(dy < 0 ? 'jump' : 'slide');
    });
    target.addEventListener('pointerup', (e) => {
      const s = this.start;
      this.start = null;
      // A quick touch that didn't swipe is a tap; a second one close behind is a dash.
      // (A failed swipe then a real one is not a double tap.)
      if (!s || e.pointerId !== s.id || this.fired || e.timeStamp - s.t > TAP_TIME) return;
      if (s.double) this.push('dash');
      else {
        this.push('tap');
        this.tap = { t: e.timeStamp, x: s.x, y: s.y };
      }
    });
    target.addEventListener('pointercancel', () => { this.start = null; this.tap = null; });
  }

  private push(a: Action) {
    if (this.enabled) this.queue.push(a);
  }

  drain(): Action[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  clear() {
    this.queue = [];
    this.tap = null;
  }
}
