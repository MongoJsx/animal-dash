// DOM overlay: menu, countdown, race HUD (progress, rank, Focus) and results.
import { FOCUS, RACE_LENGTH } from '../config.ts';
import { sound } from '../core/audio.ts';
import type { CharacterDef } from '../render/character.ts';
import { MAPS, MAP_IDS, type MapId } from '../world/biomes.ts';
import { ITEM_ICON, type ItemKind } from '../world/items.ts';

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

/** Mouse/trackpad machine: show key names instead of swipes. */
export const desktop = typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches;

const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

/** Finishing order: finishers by time, then everyone else by distance. */
export const byFinish = (a: Racer, b: Racer) =>
  a.finished && b.finished ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.d - a.d;

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
  private sub: HTMLElement;
  private zone: HTMLElement;
  private zoneTimer = 0;
  private dashBar: HTMLElement;
  private dashFill = -1;
  private dashState = '';
  /** The held item, over the runner's head (a tap anywhere uses it). */
  private itemBtn: HTMLButtonElement;
  private itemIcon: HTMLElement;
  private itemCount: HTMLElement;
  private itemKey = '';
  private inkBox: HTMLElement;
  private flight: HTMLElement;
  private flightShown = 0;
  private menu: HTMLElement;
  private results: HTMLElement;
  private toastTimer = 0;

  constructor(parent: HTMLElement) {
    // The plain buttons click; picks, arrows and start have their own sounds.
    parent.addEventListener('click', (e) => {
      if ((e.target as Element).closest?.('.help-btn, .help-close, .sound-btn, .online-btn, .again, .menu-btn, [data-act]')) sound.tap();
    }, true);
    this.root = el('div', 'hud', parent);
    el('div', 'vignette', this.root);
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
    this.sub = el('div', 'big-sub', this.root);
    // Dash meter up the left edge; full, it says how to fire it, written along the bar.
    this.dashBar = el('div', 'dash-bar', this.race, `<div class="dash-fill"></div><span class="dash-text">${desktop ? 'SHIFT · DASH' : 'DOUBLE TAP'}</span><b class="dash-ico">⚡</b>`);
    // Just a sign: a tap anywhere uses it.
    this.itemBtn = el('button', 'head-item', this.race, '<i class="ring"></i><i class="ring"></i><i class="ring"></i><span class="item-icon"></span>');
    this.itemBtn.setAttribute('aria-label', 'ใช้ไอเท็ม');
    this.itemIcon = this.itemBtn.querySelector<HTMLElement>('.item-icon')!;
    this.itemCount = el('span', 'item-count', this.itemBtn);
    // Splats over the view of the track ahead.
    this.inkBox = el('div', 'ink', this.root, '<i></i><i></i><i></i><i></i><i></i><i></i>');
    this.flight = el('div', 'flight', this.race);
    this.zone = el('div', 'zone-title', this.root);
    this.menu = el('div', 'menu hidden', this.root);
    this.results = el('div', 'results hidden', this.root);
    addEventListener('resize', () => this.placeArrows());
  }

  showMenu(chars: CharacterDef[], selected: string, onPick: (id: string) => void, onStart: () => void, onOnline: () => void,
    map: MapId, onMap: (m: MapId) => void) {
    this.race.classList.add('hidden');
    this.results.classList.add('hidden');
    this.menu.classList.remove('hidden');
    this.root.classList.remove('zone', 'dashing');
    this.inkBox.classList.remove('show');
    const controls = desktop
      ? [['← →', 'เปลี่ยนเลน'], ['↑ / Space', 'กระโดด'], ['↓', 'สไลด์'], ['Shift', 'แดช'], ['Q', 'ใช้ไอเท็ม']]
      : [['ปัด ← →', 'เปลี่ยนเลน'], ['ปัด ↑', 'กระโดด'], ['ปัด ↓', 'สไลด์'], ['แตะ 2 ครั้ง', 'แดช (เกจซ้ายล่างเต็ม)'], ['แตะ 1 ครั้ง', 'ใช้ไอเท็ม']];
    this.menu.innerHTML = `
      <div class="menu-top">
        <div class="logo"><span class="logo-th">วิ่งสุดใจ</span><span class="logo-en">วิ่งซิ่งข้ามโลก</span></div>
      </div>
      <button class="help-btn" aria-label="วิธีเล่น">?</button>
      <button class="sound-btn" aria-label="เปิด/ปิดเสียง">${sound.muted ? '🔇' : '🔊'}</button>
      <button class="arrow prev" aria-label="ตัวก่อนหน้า"></button>
      <button class="arrow next" aria-label="ตัวถัดไป"></button>
      <div class="panel">
        <div class="who">
          <span class="who-label">เลือกนักวิ่ง</span>
          <b class="who-name"></b>
          <div class="dots">${chars.map((c) => `<button class="char ${c.id === selected ? 'on' : ''}" data-id="${c.id}" aria-label="${c.name}"></button>`).join('')}</div>
        </div>
        <div class="maps">${MAP_IDS.map((m) => `<button class="map ${m === map ? 'on' : ''}" data-map="${m}"><span>${MAPS[m].flag}</span>${MAPS[m].name}</button>`).join('')}</div>
        <div class="lobby hidden"></div>
        <div class="row"><button class="start"><span class="start-label">เริ่มแข่ง</span></button><button class="online-btn"><span>🌐</span>เล่นกับเพื่อน</button></div>
        ${desktop ? '<div class="keys"><kbd>Enter</kbd> เริ่มแข่ง · <kbd>←</kbd><kbd>→</kbd> เปลี่ยนตัวละคร</div>' : ''}
      </div>
      <div class="help hidden">
        <div class="help-card">
          <div class="help-title">วิธีเล่น</div>
          <div class="help-grid">${controls.map(([k, v]) => `<div class="help-item"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>
          <ul class="help-tips">
            <li><b>ออกตัว</b> — ทุกคนออกพร้อมกันเมื่อนับ 3-2-1 แล้ว “GO!” ไม่ต้องกดอะไร</li>
            <li><b>ชนของ</b> — ช้าลง แต่เติมเกจแดช</li>
            <li><b>หลบต่อเนื่อง</b> — สะสม FOCUS วิ่งเร็วขึ้นเรื่อย ๆ</li>
            <li><b>กล่อง ?</b> — วิ่งชนเพื่อสุ่มไอเท็ม: ⚡ บูสต์ · 🛡️ โล่กันชน 1 ครั้ง · 🦑 หมึกใส่คนข้างหน้า · 🦘 สปริงกระโดดข้าม · 🚀 จรวดบินข้ามทุกอย่าง 10 วิ</li>
          </ul>
          <div class="help-credits">เพลง: “Monkeys Spinning Monkeys”, “Hyperfun” โดย Kevin MacLeod (incompetech.com) · CC BY 4.0</div>
          <button class="help-close">เข้าใจแล้ว!</button>
        </div>
      </div>`;
    const dots = [...this.menu.querySelectorAll<HTMLButtonElement>('.char')];
    const name = this.menu.querySelector<HTMLElement>('.who-name')!;
    const show = (id: string) => {
      name.textContent = chars.find((c) => c.id === id)?.name ?? '';
      name.classList.remove('swap');
      void name.offsetWidth;
      name.classList.add('swap');
    };
    show(selected);
    const pick = (b: HTMLButtonElement) => {
      dots.forEach((x) => x.classList.toggle('on', x === b));
      show(b.dataset.id!);
      onPick(b.dataset.id!);
    };
    dots.forEach((b) => {
      b.onclick = () => { sound.select(); pick(b); };
    });
    const step = (dir: number) => {
      sound.swipe();
      const i = dots.findIndex((b) => b.classList.contains('on'));
      pick(dots[(i + dir + dots.length) % dots.length]);
    };
    this.menu.querySelector<HTMLButtonElement>('.prev')!.onclick = () => step(-1);
    this.menu.querySelector<HTMLButtonElement>('.next')!.onclick = () => step(1);
    this.menu.querySelectorAll<HTMLButtonElement>('.map').forEach((b) => {
      b.onclick = () => {
        sound.select();
        this.menu.querySelectorAll('.map').forEach((x) => x.classList.toggle('on', x === b));
        onMap(b.dataset.map as MapId);
      };
    });
    const help = this.menu.querySelector<HTMLElement>('.help')!;
    this.menu.querySelector<HTMLButtonElement>('.help-btn')!.onclick = () => help.classList.remove('hidden');
    help.onclick = (e) => { if (e.target === help) help.classList.add('hidden'); };
    this.menu.querySelector<HTMLButtonElement>('.help-close')!.onclick = () => help.classList.add('hidden');
    const mute = this.menu.querySelector<HTMLButtonElement>('.sound-btn')!;
    mute.onclick = () => { mute.textContent = sound.toggleMute() ? '🔇' : '🔊'; };
    this.menu.querySelector<HTMLButtonElement>('.start')!.onclick = onStart;
    this.menu.querySelector<HTMLButtonElement>('.online-btn')!.onclick = onOnline;
    this.placeArrows();
  }

  /**
   * Online room panel on the menu; `null` hides it and restores solo play.
   * @param lobby.start the big button's label; `ready` whether it can be pressed
   * @param lobby.guest the host picks the map, so a guest doesn't see the picker
   */
  setLobby(lobby: { html: string; start: string; ready: boolean; guest?: boolean; actions: Record<string, () => void> } | null) {
    const box = this.menu.querySelector<HTMLElement>('.lobby');
    const start = this.menu.querySelector<HTMLButtonElement>('.start');
    const onlineBtn = this.menu.querySelector<HTMLButtonElement>('.online-btn');
    if (!box || !start || !onlineBtn) return;
    box.classList.toggle('hidden', !lobby);
    onlineBtn.classList.toggle('hidden', !!lobby);
    start.querySelector('.start-label')!.textContent = lobby ? lobby.start : 'เริ่มแข่ง';
    start.disabled = !!lobby && !lobby.ready;
    this.menu.classList.toggle('guest', !!lobby?.guest);
    box.innerHTML = lobby?.html ?? '';
    for (const [name, fn] of Object.entries(lobby?.actions ?? {})) {
      box.querySelectorAll<HTMLElement>(`[data-act="${name}"]`).forEach((b) => { b.onclick = fn; });
    }
    this.placeArrows();
  }

  /** The character arrows sit in the clear space between the logo and the panel, whatever the panel's height. */
  placeArrows() {
    const top = this.menu.querySelector<HTMLElement>('.menu-top');
    const panel = this.menu.querySelector<HTMLElement>('.panel');
    if (!top || !panel) return;
    // The "choose a runner" chip pokes out above the panel.
    const mid = (top.offsetTop + top.offsetHeight + panel.offsetTop - 22) / 2;
    this.menu.style.setProperty('--arrow-y', `${Math.round(mid)}px`);
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
    this.setItem(null, false);
    this.setFlight(0);
    this.inkBox.classList.remove('show');
  }

  /** Item slot: `rolling` spins through the icons before it lands on `item`. */
  setItem(item: ItemKind | null, rolling: boolean, t = 0, count = item ? 1 : 0) {
    const icons = Object.values(ITEM_ICON);
    const icon = !item ? '' : rolling ? icons[Math.floor(t * 14) % icons.length] : ITEM_ICON[item];
    const key = `${icon}|${rolling}|${count}`;
    if (key === this.itemKey) return;
    this.itemKey = key;
    this.itemIcon.textContent = icon;
    this.itemCount.textContent = count > 1 ? `×${count}` : '';
    this.itemBtn.className = `head-item ${!item ? '' : rolling ? 'show rolling' : 'show ready'}`;
  }

  /** Keep the item over the runner's head (screen px), or hide it with null. */
  placeItem(p: { x: number; y: number } | null) {
    this.itemBtn.style.visibility = p ? '' : 'hidden';
    if (p) this.itemBtn.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
  }

  /** Rocket fuel left (s); 0 hides the gauge. */
  setFlight(left: number) {
    const shown = left > 0 ? Math.ceil(left) : 0;
    if (shown === this.flightShown) return;
    this.flightShown = shown;
    this.flight.classList.toggle('show', shown > 0);
    if (shown) this.flight.textContent = `🚀 ${shown}`;
  }

  /** Ink over the screen for `time` seconds. */
  ink(time: number) {
    const box = this.inkBox;
    box.style.setProperty('--t', `${time}s`);
    // Fresh splats in new spots every time.
    box.querySelectorAll<HTMLElement>('i').forEach((s) => {
      s.style.left = `${10 + Math.random() * 65}%`;
      s.style.top = `${18 + Math.random() * 45}%`;
      s.style.setProperty('--s', `${0.7 + Math.random() * 0.8}`);
    });
    box.classList.remove('show');
    void box.offsetWidth;
    box.classList.add('show');
  }

  /** @param tone 'n3' | 'n2' | 'n1' | 'go': the big bouncy count, coloured per beat */
  countdown(text: string, sub = '', tone = '') {
    this.big.textContent = text;
    this.sub.textContent = sub;
    this.big.dataset.tone = tone;
    this.sub.dataset.tone = tone;
    for (const e of [this.big, this.sub]) {
      e.classList.remove('pop');
      void e.offsetWidth;
      e.classList.add('pop');
    }
  }

  /** Dash meter (0..1); `active` while dashing. */
  setDash(fill: number, active: boolean) {
    const state = active ? 'active' : fill >= 1 ? 'ready' : '';
    const q = Math.round(fill * 50) / 50;
    if (q !== this.dashFill) {
      this.dashFill = q;
      this.dashBar.style.setProperty('--p', `${q}`);
    }
    if (state !== this.dashState) {
      this.dashState = state;
      this.dashBar.className = `dash-bar ${state}`;
      this.root.classList.toggle('dashing', active);
    }
  }


  /** Name of the zone you just ran into. */
  zoneTitle(text: string) {
    this.zone.textContent = text;
    this.zone.classList.remove('show');
    void this.zone.offsetWidth;
    this.zone.classList.add('show');
    this.zoneTimer = 2.6;
  }

  update(racers: Racer[], t: number, dt: number) {
    const sorted = [...racers].sort(byFinish);
    racers.forEach((r, i) => {
      // Vertical bar: start at the bottom, finish at the top.
      this.dots[i].style.bottom = `${Math.min(1, r.d / RACE_LENGTH) * 100}%`;
    });
    const me = racers.find((r) => r.isPlayer)!;
    this.rank.innerHTML = `${sorted.indexOf(me) + 1}<small>/${racers.length}</small>`;
    this.dist.textContent = `${Math.max(0, Math.round(RACE_LENGTH - me.d))} m`;
    this.timer.textContent = fmtTime(Math.max(0, me.finished ? me.finishTime : t));
    if (this.zoneTimer > 0) {
      this.zoneTimer -= dt;
      if (this.zoneTimer <= 0) this.zone.classList.remove('show');
    }
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

  flash(text: string, kind: 'bad' | 'good' = 'bad', time = 0.8) {
    this.toast.textContent = text;
    this.toast.className = `toast show ${kind}`;
    this.toastTimer = time;
  }

  unflash() {
    this.toast.classList.remove('show');
    this.toastTimer = 0;
  }

  hit() {
    this.root.classList.remove('hit');
    void this.root.offsetWidth;
    this.root.classList.add('hit');
  }

  /** Ceremony overlay; `sorted` is the finishing order. Tags follow the podium via `placeTags`. */
  showResults(sorted: Racer[], mapLabel: string, onAgain: (btn: HTMLButtonElement) => void, onMenu: () => void) {
    const place = sorted.findIndex((r) => r.isPlayer) + 1;
    const me = sorted[place - 1];
    const best = sorted[0].finished ? sorted[0].finishTime : 0;
    const title = ['แชมป์!', 'เหรียญเงิน!', 'เหรียญทองแดง!'][place - 1] ?? `อันดับ ${place}`;
    const sub = place === 1 ? 'เร็วที่สุดในสนาม' : place <= 3 ? 'ขึ้นโพเดียมแล้ว!' : 'เกือบแล้ว! อีกนิดเดียว';
    const medal = (i: number) => `<span class="medal m${Math.min(i, 3)}">${i + 1}</span>`;
    const result = (r: Racer) => r.finished ? fmtTime(r.finishTime) : `เหลือ ${Math.max(0, Math.round(RACE_LENGTH - r.d))} m`;
    const gap = (r: Racer, i: number) => i === 0 || !r.finished ? '' : `+${(r.finishTime - best).toFixed(2)}`;
    this.race.classList.add('hidden');
    this.root.classList.remove('zone', 'dashing');
    this.inkBox.classList.remove('show');
    this.results.classList.remove('hidden');
    this.results.className = `results p${Math.min(place, 4)}`;
    this.results.innerHTML = `
      <div class="res-top">
        <div class="res-kicker">${mapLabel} · ผลการแข่งขัน</div>
        <div class="res-title">${title}</div>
        <div class="res-sub">${sub} · <b>${result(me)}</b></div>
      </div>
      <div class="tags">${sorted.map((r, i) => `<div class="tag ${r.isPlayer ? 'me' : ''} t${Math.min(i, 3)}">${medal(i)}<span>${r.name}</span></div>`).join('')}</div>
      <div class="res-panel">
        <ol>${sorted.map((r, i) => `<li class="${r.isPlayer ? 'me' : ''}" style="--i:${i}">${medal(i)}<span class="nm">${r.name}${r.isPlayer ? '<em>คุณ</em>' : ''}</span><span class="tm"><b>${result(r)}</b><small>${gap(r, i)}</small></span></li>`).join('')}</ol>
        <div class="row"><button class="again">แข่งอีกครั้ง</button><button class="menu-btn">เมนูหลัก</button></div>
      </div>`;
    const again = this.results.querySelector<HTMLButtonElement>('.again')!;
    again.onclick = () => onAgain(again);
    this.results.querySelector<HTMLButtonElement>('.menu-btn')!.onclick = onMenu;
  }

  /** Screen space the 3D podium should avoid: the title above and the panel below/right. */
  podiumInsets() {
    // Layout boxes, not client rects: the panel's entry animation mustn't move the camera.
    const top = this.results.querySelector<HTMLElement>('.res-top');
    const panel = this.results.querySelector<HTMLElement>('.res-panel');
    const side = matchMedia('(min-aspect-ratio: 5/4)').matches; // matches the CSS side-panel layout
    return {
      top: top ? top.offsetTop + top.offsetHeight : 0,
      bottom: panel && !side ? innerHeight - panel.offsetTop : 0,
      right: panel && side ? innerWidth - panel.offsetLeft : 0,
    };
  }

  /** Screen space the menu's logo (top) and panel (bottom) cover, for framing the runner between them. */
  menuInsets() {
    const top = this.menu.querySelector<HTMLElement>('.menu-top');
    const panel = this.menu.querySelector<HTMLElement>('.panel');
    return {
      top: top ? top.offsetTop + top.offsetHeight : 0,
      // The "choose a runner" chip pokes out above the panel.
      bottom: panel ? innerHeight - panel.offsetTop + 22 : 0,
    };
  }

  /** Name tags over the runners' heads (screen px; null = off screen / not up yet). */
  placeTags(points: ({ x: number; y: number } | null)[]) {
    this.results.querySelectorAll<HTMLElement>('.tag').forEach((t, i) => {
      const p = points[i];
      t.classList.toggle('on', !!p);
      if (p) t.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    });
  }
}
