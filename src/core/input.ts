// Swipe + keyboard input, turned into discrete actions the player consumes.
export type Action = 'left' | 'right' | 'jump' | 'slide';

const KEYS: Record<string, Action> = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  ArrowDown: 'slide', KeyS: 'slide',
};

const SWIPE_MIN = 24; // px

export class Input {
  private queue: Action[] = [];
  private start: { x: number; y: number; id: number } | null = null;
  private fired = false;
  enabled = false;

  constructor(target: HTMLElement) {
    addEventListener('keydown', (e) => {
      const a = KEYS[e.code];
      if (!a) return;
      e.preventDefault();
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
