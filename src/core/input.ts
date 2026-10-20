// Swipe + keyboard input, turned into discrete actions the player consumes.
// 'dash' fires the dash when the meter is full; 'item' uses the held item.
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

export class Input {
  private queue: Action[] = [];
  private start: { x: number; y: number; id: number } | null = null;
  private fired = false;
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
      this.start = { x: e.clientX, y: e.clientY, id: e.pointerId };
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
    const end = () => { this.start = null; };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  /** On-screen buttons (dash, item). */
  press(a: Action) {
    this.push(a);
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
  }
}
