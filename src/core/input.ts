// Swipe + keyboard input, turned into discrete actions the player consumes.
// A double tap anywhere is 'dash' (fires when the meter is full); 'item' uses
// the held item (the icon over the runner's head, or Q).
export type Action = 'left' | 'right' | 'jump' | 'slide' | 'dash' | 'item';

const KEYS: Record<string, Action> = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  ArrowDown: 'slide', KeyS: 'slide',
  ShiftLeft: 'dash', ShiftRight: 'dash', KeyE: 'dash', Enter: 'dash',
  KeyQ: 'item', KeyF: 'item',
};

const SWIPE_MIN = 24; // px
/** The held item drawn over the runner's head (see Hud). */
const ITEM_SELECTOR = '.head-item';
const TAP_TIME = 260; // ms a finger may stay down and still be a tap
const DOUBLE_GAP = 320; // ms from the first tap's lift to the second touch
const DOUBLE_SPREAD = 90; // px between the two taps
const ITEM_TAP_TIME = 500; // ms: a tap on the item over the head may be a slower press

export class Input {
  private queue: Action[] = [];
  private start: { x: number; y: number; id: number; t: number; double: boolean; item: boolean } | null = null;
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
      // A touch on the item over the head uses it if it stays a tap; it can still swipe.
      const item = !!(e.target as Element | null)?.closest?.(ITEM_SELECTOR);
      const t = this.tap;
      this.tap = null;
      const double = !item && !!t && e.timeStamp - t.t < DOUBLE_GAP && Math.hypot(e.clientX - t.x, e.clientY - t.y) < DOUBLE_SPREAD;
      this.start = { x: e.clientX, y: e.clientY, id: e.pointerId, t: e.timeStamp, double, item };
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
      // Two quick touches that didn't swipe: dash. A failed swipe then a real one is not a double tap.
      if (!s || e.pointerId !== s.id || this.fired) return;
      if (s.item) {
        if (e.timeStamp - s.t < ITEM_TAP_TIME) this.push('item');
        return;
      }
      if (e.timeStamp - s.t > TAP_TIME) return;
      if (s.double) this.push('dash');
      else this.tap = { t: e.timeStamp, x: s.x, y: s.y };
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
