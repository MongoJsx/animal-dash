// DOM overlay: menu, countdown, race HUD (progress, rank, Focus) and results.
import { FOCUS, RACE_LENGTH } from '../config.ts';
import type { CharacterDef } from '../render/character.ts';

export interface Racer {
  name: string;
  d: number;
  isPlayer: boolean;
  finished: boolean;
  finishTime: number;
  color: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, html = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  parent.appendChild(e);
  return e;
};

const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

export class Hud {
  private root: HTMLElement;
  private race: HTMLElement;
  private bar: HTMLElement;
  private dots: HTMLElement[] = [];
  private rank: HTMLElement;
  private dist: HTMLElement;
  private timer: HTMLElement;
  private pips: HTMLElement[] = [];
  private focusBox: HTMLElement;
  private toast: HTMLElement;
  private big: HTMLElement;
  private menu: HTMLElement;
  private results: HTMLElement;
  private toastTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.race = el('div', 'race hidden', this.root);
    const top = el('div', 'top', this.race);
    this.rank = el('div', 'rank', top);
    const right = el('div', 'top-right', top);
    this.timer = el('div', 'timer', right);
    this.dist = el('div', 'dist', right);
    this.bar = el('div', 'progress', this.race);
    el('div', 'flag', this.bar, '🏁');
    this.focusBox = el('div', 'focus', this.race);
    el('div', 'focus-label', this.focusBox, 'FOCUS');
    const pipRow = el('div', 'pips', this.focusBox);
    for (let i = 0; i < FOCUS.max; i++) this.pips.push(el('div', 'pip', pipRow));
    this.toast = el('div', 'toast', this.root);
    this.big = el('div', 'big', this.root);
    this.menu = el('div', 'menu hidden', this.root);
    this.results = el('div', 'results hidden', this.root);
  }

  showMenu(chars: CharacterDef[], selected: string, onPick: (id: string) => void, onStart: () => void, onOnline: () => void) {
    this.race.classList.add('hidden');
    this.results.classList.add('hidden');
    this.menu.classList.remove('hidden');
    this.menu.innerHTML = `
      <div class="title">วิ่งสุดใจ<small>ANIMAL DASH</small></div>
      <div class="hint">ปัด ← → เปลี่ยนเลน · ↑ กระโดด · ↓ สไลด์<br>ชน = ช้าลง · หลบต่อเนื่อง = FOCUS เร็วขึ้น</div>
      <div class="chars">${chars.map((c) => `<button class="char ${c.id === selected ? 'on' : ''}" data-id="${c.id}">${c.name}</button>`).join('')}</div>
      <div class="lobby"></div>
      <div class="row"><button class="start">เริ่มแข่ง</button><button class="online-btn">🌐 เล่นกับเพื่อน</button></div>`;
    this.menu.querySelectorAll<HTMLButtonElement>('.char').forEach((b) => {
      b.onclick = () => {
        this.menu.querySelectorAll('.char').forEach((x) => x.classList.toggle('on', x === b));
        onPick(b.dataset.id!);
      };
    });
    this.menu.querySelector<HTMLButtonElement>('.start')!.onclick = onStart;
    this.menu.querySelector<HTMLButtonElement>('.online-btn')!.onclick = onOnline;
  }

  /** Online room panel on the menu; `null` hides it and restores solo play. */
  setLobby(lobby: { html: string; start: string | null; actions: Record<string, () => void> } | null) {
    const box = this.menu.querySelector<HTMLElement>('.lobby');
    const start = this.menu.querySelector<HTMLButtonElement>('.start');
    const onlineBtn = this.menu.querySelector<HTMLButtonElement>('.online-btn');
    if (!box || !start || !onlineBtn) return;
    box.classList.toggle('hidden', !lobby);
    onlineBtn.classList.toggle('hidden', !!lobby);
    start.textContent = lobby ? (lobby.start ?? 'รอ…') : 'เริ่มแข่ง';
    start.disabled = !!lobby && lobby.start === null;
    box.innerHTML = lobby?.html ?? '';
    for (const [name, fn] of Object.entries(lobby?.actions ?? {})) {
      box.querySelectorAll<HTMLElement>(`[data-act="${name}"]`).forEach((b) => { b.onclick = fn; });
    }
  }

  startRace(racers: Racer[]) {
    this.menu.classList.add('hidden');
    this.results.classList.add('hidden');
    this.race.classList.remove('hidden');
    this.dots.forEach((d) => d.remove());
    this.dots = racers.map((r) => {
      const d = el('div', `dot ${r.isPlayer ? 'me' : ''}`, this.bar);
      d.style.background = r.color;
      return d;
    });
    this.setFocus(0);
  }

  countdown(text: string) {
    this.big.textContent = text;
    this.big.classList.remove('pop');
    void this.big.offsetWidth;
    this.big.classList.add('pop');
  }

  update(racers: Racer[], t: number, dt: number) {
    const sorted = [...racers].sort((a, b) =>
      a.finished && b.finished ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.d - a.d);
    racers.forEach((r, i) => {
      // Vertical bar: start at the bottom, finish at the top.
      this.dots[i].style.bottom = `${Math.min(1, r.d / RACE_LENGTH) * 100}%`;
    });
    const me = racers.find((r) => r.isPlayer)!;
    this.rank.innerHTML = `${sorted.indexOf(me) + 1}<small>/${racers.length}</small>`;
    this.dist.textContent = `${Math.max(0, Math.round(RACE_LENGTH - me.d))} m`;
    this.timer.textContent = fmtTime(Math.max(0, me.finished ? me.finishTime : t));
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
  }

  setFocus(level: number) {
    this.pips.forEach((p, i) => p.classList.toggle('on', i < level));
    this.focusBox.classList.toggle('max', level >= FOCUS.max);
    this.root.classList.toggle('zone', level >= FOCUS.max);
  }

  flash(text: string, kind: 'bad' | 'good' = 'bad') {
    this.toast.textContent = text;
    this.toast.className = `toast show ${kind}`;
    this.toastTimer = 0.8;
  }

  hit() {
    this.root.classList.remove('hit');
    void this.root.offsetWidth;
    this.root.classList.add('hit');
  }

  showResults(racers: Racer[], onAgain: (btn: HTMLButtonElement) => void, onMenu: () => void) {
    const sorted = [...racers].sort((a, b) =>
      a.finished && b.finished ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.d - a.d);
    const place = sorted.findIndex((r) => r.isPlayer) + 1;
    this.results.classList.remove('hidden');
    this.results.innerHTML = `
      <div class="place">${place === 1 ? '🏆 ชนะ!' : `อันดับ ${place}`}</div>
      <ol>${sorted.map((r) => `<li class="${r.isPlayer ? 'me' : ''}"><span class="sw" style="background:${r.color}"></span>${r.name}<b>${r.finished ? fmtTime(r.finishTime) : `${Math.round(RACE_LENGTH - r.d)} m`}</b></li>`).join('')}</ol>
      <div class="row"><button class="again">แข่งอีกครั้ง</button><button class="menu-btn">เปลี่ยนตัวละคร</button></div>`;
    const again = this.results.querySelector<HTMLButtonElement>('.again')!;
    again.onclick = () => onAgain(again);
    this.results.querySelector<HTMLButtonElement>('.menu-btn')!.onclick = onMenu;
  }
}
