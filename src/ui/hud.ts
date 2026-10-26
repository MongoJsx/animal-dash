// DOM overlay: menu, countdown, race HUD (progress, rank, Focus) and results.
import { BASE_STATS, FOCUS, LANE_CHOICES, RACE_LENGTH, type Stats } from '../config.ts';
import { sound } from '../core/audio.ts';
import { profile } from '../core/profile.ts';
import type { CharacterDef } from '../render/character.ts';
import { MAPS, MAP_IDS, type MapId } from '../world/biomes.ts';
import { ITEM_ICON, ITEM_KINDS, ITEM_NAME, type ItemKind } from '../world/items.ts';

const STAT_NAMES: [keyof Stats, string][] = [['speed', 'ความเร็ว'], ['accel', 'ความเร่ง'], ['strength', 'แข็งแกร่ง'], ['stamina', 'ความอึด']];
const STAT_MAX = 5;
/** A few sakura petals drifting over the menu, each with its own lane, speed and start. */
const PETALS = Array.from({ length: 7 }, (_, i) =>
  `<i style="--x:${(8 + i * 14 + (i % 2) * 5).toFixed(0)}%;--d:${(9 + (i * 7) % 6).toFixed(0)}s;--w:${(-i * 1.7).toFixed(1)}s"></i>`).join('');
/** What a runner is good at, from their best stat ('all' when every stat is the same). */
type Role = keyof Stats | 'all';
const ROLE: Record<Role, string> = { speed: 'สายสปีด', accel: 'สายโฟกัส', strength: 'สายบู๊', stamina: 'สายอึด', all: 'สายสมดุล' };
const ROLE_ICON: Record<Role, string> = { speed: '⚡', accel: '🎯', strength: '💪', stamina: '🛡️', all: '⚖️' };
function bestStat(s: Stats): Role {
  const best = Math.max(s.speed, s.accel, s.strength, s.stamina);
  if (best === Math.min(s.speed, s.accel, s.strength, s.stamina)) return 'all';
  return STAT_NAMES.find(([k]) => s[k] === best)![0];
}
/** The race settings chosen in the room. */
export interface Rules { map: MapId; lanes: number; items: ItemKind[]; bots: number }
/** Bots that fit beside `players` players. */
const botsOn = (r: Rules, players: number) => Math.max(0, Math.min(r.bots, r.lanes - players));
/** "🇯🇵 ญี่ปุ่น · 5 เลน · 🤖 3 · ไอเท็ม 3/5" for the room's settings pill. */
const rulesLine = (r: Rules, players: number) => `${MAPS[r.map].flag} ${MAPS[r.map].name} · ${r.lanes} เลน · 🤖 ${botsOn(r, players)} · ${
  r.items.length === ITEM_KINDS.length ? 'ไอเท็มครบ' : r.items.length ? `ไอเท็ม ${r.items.length}/${ITEM_KINDS.length}` : 'ไม่มีไอเท็ม'}`;
const roleOf = (s: Stats) => `${ROLE_ICON[bestStat(s)]} ${ROLE[bestStat(s)]}`;

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
  private useBtn: HTMLElement;
  private useIcon: HTMLElement;
  /** Race buttons: the game wires these to the input. */
  onDash = () => {};
  onUse = () => {};
  private itemIcon: HTMLElement;
  private itemCount: HTMLElement;
  private itemKey = '';
  private inkBox: HTMLElement;
  private flight: HTMLElement;
  private flightShown = '';
  private menu: HTMLElement;
  private results: HTMLElement;
  private pick: HTMLElement;
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
    // Dash: a round thumb button in the bottom-left corner whose ring fills up; full, it glows and fires on touch.
    this.dashBar = el('button', 'dash-bar', this.race, `<i class="dash-fill"></i><b class="dash-ico">⚡</b><span class="dash-text">${desktop ? 'SHIFT' : 'DASH'}</span>`);
    this.dashBar.setAttribute('aria-label', 'แดช');
    // The held item again, as a thumb button in the bottom-right corner (a tap anywhere works too).
    this.useBtn = el('button', 'use-item', this.race, `<span class="use-icon"></span><span class="use-text">${desktop ? 'Q' : 'ใช้'}</span>`);
    this.useBtn.setAttribute('aria-label', 'ใช้ไอเท็ม');
    this.useIcon = this.useBtn.querySelector<HTMLElement>('.use-icon')!;
    // Touch-down fires at once, and the touch never also counts as a tap or swipe on the track.
    const press = (b: HTMLElement, fn: () => void) => b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); fn(); });
    press(this.dashBar, () => this.onDash());
    press(this.useBtn, () => this.onUse());
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
    this.pick = el('div', 'pick hidden', this.root);
  }

  /** Home: wallet and shortcuts on top, your runner, and the two ways to play. The race itself is set up in the room. */
  showMenu(o: { char: CharacterDef; onStart: () => void; onOnline: () => void; onSpin: (dx: number, held: boolean) => void }) {
    this.race.classList.add('hidden');
    this.results.classList.add('hidden');
    this.pick.classList.add('hidden');
    this.menu.classList.remove('hidden');
    this.root.classList.remove('zone', 'dashing');
    this.inkBox.classList.remove('show');
    const controls = desktop
      ? [['← →', 'เปลี่ยนเลน'], ['↑ / Space', 'กระโดด'], ['↓', 'สไลด์'], ['Shift', 'แดช'], ['Q', 'ใช้ไอเท็ม']]
      : [['ปัด ← →', 'เปลี่ยนเลน'], ['ปัด ↑', 'กระโดด'], ['ปัด ↓', 'สไลด์'], ['ปุ่ม ⚡ ซ้ายล่าง', 'แดช (เมื่อวงเต็ม)'], ['แตะจอ / ปุ่มขวาล่าง', 'ใช้ไอเท็ม']];
    this.menu.innerHTML = `
      <div class="petals">${PETALS}</div>
      <div class="topbar">
        <div class="profile"><span class="avatar">${ROLE_ICON[bestStat(o.char.stats ?? BASE_STATS)]}</span><span class="pname"><b>${profile.name}</b><small>ชนะ ${profile.wins} · แข่ง ${profile.races}</small></span></div>
        <div class="wallet">
          <span class="purse"><i class="coin"></i><b class="coins">${profile.coins.toLocaleString()}</b></span>
          <button class="purse" data-act="shop"><i>💎</i><b>${profile.gems}</b><em>+</em></button>
        </div>
      </div>
      <div class="side-btns left">
        <button class="side-btn" data-act="shop"><i>🛒</i><span>ร้านค้า</span></button>
        <button class="side-btn" data-act="rank"><i>🏆</i><span>อันดับ</span></button>
      </div>
      <div class="side-btns right">
        <button class="side-btn sound-btn" aria-label="เปิด/ปิดเสียง"><i>${sound.muted ? '🔇' : '🔊'}</i><span>เสียง</span></button>
        <button class="side-btn help-btn" aria-label="วิธีเล่น"><i class="q">?</i><span>วิธีเล่น</span></button>
      </div>
      <div class="menu-top">
        <div class="logo"><span class="logo-th">วิ่งสุดใจ</span><span class="logo-en">วิ่งซิ่งข้ามโลก</span></div>
      </div>
      <div class="spin-hint">⟲ ลากเพื่อหมุนดูรอบตัว</div>
      <div class="panel">
        <div class="who"><span class="who-label">${o.char.name}</span></div>
        <div class="lobby hidden"></div>
        <div class="row">
          <button class="start mode"><small class="start-kicker"></small><span class="start-label">เริ่มเกม</span></button>
          <button class="online-btn mode"><small>ออนไลน์</small><b>เล่นกับเพื่อน</b><small>ส่งลิงก์ชวนแข่ง</small></button>
        </div>
        ${desktop ? '<div class="keys"><kbd>Enter</kbd> เริ่มเกม</div>' : ''}
      </div>
      <div class="help modal hidden">
        <div class="help-card">
          <div class="help-title">วิธีเล่น</div>
          <div class="help-grid">${controls.map(([k, v]) => `<div class="help-item"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>
          <ul class="help-tips">
            <li><b>ออกตัว</b> — ทุกคนออกพร้อมกันเมื่อนับ 3-2-1 แล้ว “GO!” ไม่ต้องกดอะไร</li>
            <li><b>ชนของ</b> — ช้าลง แต่เติมเกจแดช</li>
            <li><b>หลบต่อเนื่อง</b> — สะสม FOCUS วิ่งเร็วขึ้นเรื่อย ๆ</li>
            <li><b>ค่าสถานะ</b> — ความเร็ว · ความเร่ง (FOCUS ขึ้นไว) · แข็งแกร่ง (เบียดชนะ) · ความอึด (ชนแล้ว FOCUS ลดน้อย)</li>
            <li><b>กล่อง ?</b> — วิ่งชนเพื่อสุ่มไอเท็ม: ⚡ บูสต์ชนทะลุ + FOCUS · 🛡️ โล่กันทุกอย่าง 5 วิ · 🦑 หมึกใส่คนข้างหน้า · 🦘 ขาสปริงกระโดดสูง 5 วิ · 🚀 จรวดบินข้ามทุกอย่าง 10 วิ</li>
            <li><b>เหรียญ</b> — แข่งจบได้เหรียญ ที่ 1 ได้ 100 · ที่ 2 ได้ 60</li>
          </ul>
          <div class="help-credits">เพลง: “Monkeys Spinning Monkeys”, “Hyperfun” โดย Kevin MacLeod (incompetech.com) · CC BY 4.0</div>
          <button class="help-close" data-close>เข้าใจแล้ว!</button>
        </div>
      </div>
      <div class="sheet modal hidden"><div class="help-card sheet-card"></div></div>`;
    this.soloKicker();
    // Drag anywhere off the buttons and panels to turn your runner round.
    let lastX: number | null = null;
    this.menu.onpointerdown = (e) => {
      if ((e.target as Element).closest('button, .panel, .topbar, .side-btns, .modal')) return;
      lastX = e.clientX;
      this.menu.setPointerCapture(e.pointerId);
      this.menu.classList.add('spun');
    };
    this.menu.onpointermove = (e) => {
      if (lastX === null) return;
      o.onSpin(e.clientX - lastX, true);
      lastX = e.clientX;
    };
    this.menu.onpointerup = this.menu.onpointercancel = () => {
      if (lastX === null) return;
      lastX = null;
      o.onSpin(0, false);
    };
    // Every dialog closes on its button or a tap outside the card.
    this.menu.querySelectorAll<HTMLElement>('.modal').forEach((m) => {
      m.onclick = (e) => { if (e.target === m || (e.target as Element).closest('[data-close]')) m.classList.add('hidden'); };
    });
    this.menu.querySelector<HTMLButtonElement>('.help-btn')!.onclick = () => this.menu.querySelector('.help')!.classList.remove('hidden');
    this.menu.querySelectorAll<HTMLButtonElement>('[data-act="shop"]').forEach((b) => { b.onclick = () => this.sheet('shop'); });
    this.menu.querySelector<HTMLButtonElement>('[data-act="rank"]')!.onclick = () => this.sheet('rank');
    const mute = this.menu.querySelector<HTMLButtonElement>('.sound-btn i')!;
    this.menu.querySelector<HTMLButtonElement>('.sound-btn')!.onclick = () => { mute.textContent = sound.toggleMute() ? '🔇' : '🔊'; };
    this.menu.querySelector<HTMLButtonElement>('.start')!.onclick = o.onStart;
    this.menu.querySelector<HTMLButtonElement>('.online-btn')!.onclick = o.onOnline;
  }

  private soloKicker() {
    const k = this.menu.querySelector<HTMLElement>('.start-kicker');
    if (k && !this.menu.classList.contains('online')) k.textContent = 'โหมดเดี่ยว · แข่งกับบอท';
  }

  /** Shop and ranking: placeholders for now (the ranking shows this device's best times). */
  private sheet(kind: 'shop' | 'rank') {
    sound.tap();
    const box = this.menu.querySelector<HTMLElement>('.sheet')!;
    const card = box.querySelector<HTMLElement>('.sheet-card')!;
    if (kind === 'shop') {
      const goods = [['🎽', 'ชุดนักวิ่ง', 500], ['👟', 'รองเท้าลายซากุระ', 300], ['✨', 'เอฟเฟกต์ฝีเท้า', 800], ['🏷️', 'ป้ายชื่อทอง', 200]] as const;
      card.innerHTML = `<div class="help-title">ร้านค้า</div>
        <div class="sheet-sub">มี <b><span class="coin"></span> ${profile.coins.toLocaleString()}</b> · ร้านเปิดเร็ว ๆ นี้</div>
        <div class="goods">${goods.map(([icon, name, price]) => `<div class="ware"><i>${icon}</i><b>${name}</b><span><span class="coin"></span> ${price}</span><em>เร็ว ๆ นี้</em></div>`).join('')}</div>
        <button class="help-close" data-close>ปิด</button>`;
    } else {
      const rows = MAP_IDS.map((m) => {
        const times = LANE_CHOICES.map((n) => profile.best[`${m}/${n}`]).filter((t): t is number => t !== undefined);
        const best = times.length ? Math.min(...times) : null;
        return `<li><span>${MAPS[m].flag} ${MAPS[m].name}</span><b>${best === null ? '—' : fmtTime(best)}</b></li>`;
      }).join('');
      card.innerHTML = `<div class="help-title">อันดับ</div>
        <div class="sheet-sub">สถิติของคุณ · ชนะ <b>${profile.wins}</b> จาก ${profile.races} การแข่ง</div>
        <ol class="ranks">${rows}</ol>
        <div class="sheet-note">🌏 อันดับออนไลน์ทั่วประเทศ เร็ว ๆ นี้</div>
        <button class="help-close" data-close>ปิด</button>`;
    }
    box.classList.remove('hidden');
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
    this.menu.classList.toggle('online', !!lobby);
    start.querySelector('.start-label')!.textContent = lobby ? lobby.start : 'เริ่มเกม';
    if (lobby) start.querySelector('.start-kicker')!.textContent = 'ห้องออนไลน์ · แข่งกับเพื่อน';
    else this.soloKicker();
    start.disabled = !!lobby && !lobby.ready;
    this.menu.classList.toggle('guest', !!lobby?.guest);
    box.innerHTML = lobby?.html ?? '';
    for (const [name, fn] of Object.entries(lobby?.actions ?? {})) {
      box.querySelectorAll<HTMLElement>(`[data-act="${name}"]`).forEach((b) => { b.onclick = fn; });
    }
  }

  // ── Runner select ("room"): the whole start line, a tag over every runner ─
  /**
   * @param o.taken who else is on the line, by character id (shown on the cards)
   * @param o.ready the ready button's text and whether it can be pressed
   */
  showPick(o: {
    chars: CharacterDef[]; selected: string; taken: Record<string, string>;
    /** players: people in the room (they each need a lane). */
    rules: Rules; canEdit: boolean; players: number; onRules: (r: Rules) => void;
    onPick: (id: string) => void; onReady: () => void; onBack: () => void;
  }) {
    this.menu.classList.add('hidden');
    this.results.classList.add('hidden');
    this.race.classList.add('hidden');
    this.pick.classList.remove('hidden');
    this.pick.innerHTML = `
      <div class="pick-top">
        <button class="back-btn" aria-label="กลับ">‹</button>
        <div class="pick-title"><b>เลือกนักวิ่ง</b>
          <button class="rules-btn" ${o.canEdit ? '' : 'disabled'}>${rulesLine(o.rules, o.players)}<i>${o.canEdit ? '⚙' : '🔒'}</i></button>
        </div>
      </div>
      <div class="rules modal hidden"><div class="help-card rules-card"></div></div>
      <div class="ltags"></div>
      <div class="pick-panel">
        <div class="pick-strip">${o.chars.map((c) => `<button class="pcard" data-id="${c.id}"><i>${ROLE_ICON[bestStat(c.stats ?? BASE_STATS)]}</i><b>${c.name}</b><em></em></button>`).join('')}</div>
        <div class="pick-info">
          <div class="pick-name"><b class="who-name"></b><span class="who-role"></span></div>
          <div class="stats">${STAT_NAMES.map(([k, label]) => `<div class="stat s-${k}" data-stat="${k}"><span>${label}</span><i>${'<b></b>'.repeat(STAT_MAX)}</i></div>`).join('')}</div>
        </div>
        <button class="ready-btn"><span class="ready-label">พร้อม!</span><small class="ready-note">แตะเพื่อเริ่มนับถอยหลัง</small></button>
      </div>`;
    const cards = [...this.pick.querySelectorAll<HTMLButtonElement>('.pcard')];
    const show = (id: string) => {
      const c = o.chars.find((ch) => ch.id === id)!;
      const stats = c.stats ?? BASE_STATS;
      const name = this.pick.querySelector<HTMLElement>('.who-name')!;
      name.textContent = c.name;
      this.pick.querySelector('.who-role')!.textContent = roleOf(stats);
      for (const [k] of STAT_NAMES) {
        this.pick.querySelectorAll(`.stat[data-stat="${k}"] b`).forEach((pip, i) => pip.classList.toggle('on', i < stats[k]));
      }
      cards.forEach((b) => b.classList.toggle('on', b.dataset.id === id));
      name.classList.remove('swap');
      void name.offsetWidth;
      name.classList.add('swap');
    };
    this.setTaken(o.taken);
    show(o.selected);
    cards.find((b) => b.dataset.id === o.selected)?.scrollIntoView({ inline: 'center', block: 'nearest' });
    cards.forEach((b) => {
      b.onclick = () => {
        if (b.classList.contains('on') || this.pick.classList.contains('locked')) return;
        sound.select();
        show(b.dataset.id!);
        o.onPick(b.dataset.id!);
      };
    });
    this.pick.querySelector<HTMLButtonElement>('.ready-btn')!.onclick = () => { sound.click(); o.onReady(); };
    if (o.canEdit) this.pick.querySelector<HTMLButtonElement>('.rules-btn')!.onclick = () => this.rulesSheet(o.rules, o.players, o.onRules);
    this.pick.querySelector<HTMLButtonElement>('.back-btn')!.onclick = () => { sound.tap(); o.onBack(); };
  }

  /** Race settings: map, lanes, bots and which items are in play. Applied when closed. */
  private rulesSheet(current: Rules, players: number, apply: (r: Rules) => void) {
    sound.tap();
    const r: Rules = { ...current, items: [...current.items] };
    const box = this.pick.querySelector<HTMLElement>('.rules')!;
    const card = box.querySelector<HTMLElement>('.rules-card')!;
    const draw = () => {
      const allOn = r.items.length === ITEM_KINDS.length;
      card.innerHTML = `<div class="help-title">ตั้งค่าการแข่ง</div>
        <div class="rule-h">ด่าน</div>
        <div class="maps">${MAP_IDS.map((m) => `<button class="map ${m === r.map ? 'on' : ''}" data-map="${m}"><span>${MAPS[m].flag}</span>${MAPS[m].name}</button>`).join('')}</div>
        <div class="rule-h">ลู่วิ่ง <small>${players > 1 ? `ผู้เล่น ${players} คน` : 'คนละเลน'}</small></div>
        <div class="lanes">${LANE_CHOICES.map((n) => `<button class="lane-n ${n === r.lanes ? 'on' : ''}" data-lanes="${n}" ${n < players ? 'disabled' : ''}><b>${n}</b> เลน<i>${'<u></u>'.repeat(n)}</i></button>`).join('')}</div>
        <div class="rule-h">บอท <small>รวม ${players + botsOn(r, players)} คนในสนาม</small></div>
        <div class="lanes bots" style="grid-template-columns: repeat(${r.lanes - players + 1}, 1fr)">${Array.from({ length: r.lanes - players + 1 }, (_, n) =>
          `<button class="lane-n ${n === botsOn(r, players) ? 'on' : ''}" data-bots="${n}"><b>${n}</b>${n ? ' 🤖' : ' ไม่มี'}</button>`).join('')}</div>
        <div class="rule-h">ไอเท็ม <button class="all-items ${allOn ? 'on' : ''}" data-all>${allOn ? 'ปิดทั้งหมด' : 'เปิดทั้งหมด'}</button></div>
        <div class="itoggles">${ITEM_KINDS.map((k) => `<button class="itog ${r.items.includes(k) ? 'on' : ''}" data-item="${k}"><i>${ITEM_ICON[k]}</i><span>${ITEM_NAME[k]}</span></button>`).join('')}</div>
        ${r.items.length ? '' : '<div class="sheet-note">ปิดไอเท็มหมด: ไม่มีกล่อง ? บนสนาม วัดกันที่ฝีเท้าล้วน ๆ</div>'}
        <button class="help-close" data-done>เสร็จ</button>`;
      card.querySelectorAll<HTMLButtonElement>('.map').forEach((b) => { b.onclick = () => { sound.select(); r.map = b.dataset.map as MapId; draw(); }; });
      card.querySelectorAll<HTMLButtonElement>('[data-lanes]').forEach((b) => { b.onclick = () => { sound.select(); r.lanes = Number(b.dataset.lanes); draw(); }; });
      card.querySelectorAll<HTMLButtonElement>('[data-bots]').forEach((b) => { b.onclick = () => { sound.select(); r.bots = Number(b.dataset.bots); draw(); }; });
      card.querySelectorAll<HTMLButtonElement>('.itog').forEach((b) => {
        b.onclick = () => {
          sound.select();
          const k = b.dataset.item as ItemKind;
          r.items = r.items.includes(k) ? r.items.filter((x) => x !== k) : ITEM_KINDS.filter((x) => x === k || r.items.includes(x));
          draw();
        };
      });
      card.querySelector<HTMLButtonElement>('[data-all]')!.onclick = () => { sound.select(); r.items = allOn ? [] : [...ITEM_KINDS]; draw(); };
      card.querySelector<HTMLButtonElement>('[data-done]')!.onclick = () => { box.classList.add('hidden'); apply(r); };
    };
    draw();
    box.onclick = (e) => { if (e.target === box) { box.classList.add('hidden'); apply(r); } };
    box.classList.remove('hidden');
  }

  /** Who else is standing on the line, by character id, written on their cards. */
  setTaken(taken: Record<string, string>) {
    this.pick.querySelectorAll<HTMLElement>('.pcard').forEach((b) => {
      b.querySelector('em')!.textContent = taken[b.dataset.id!] ?? '';
      b.classList.toggle('taken', !!taken[b.dataset.id!]);
    });
  }

  /** Ready button: label, the line under it, whether it can be pressed; `locked` stops further picks. */
  setReady(label: string, note: string, enabled: boolean, locked = false) {
    const b = this.pick.querySelector<HTMLButtonElement>('.ready-btn');
    if (!b) return;
    b.querySelector('.ready-label')!.textContent = label;
    b.querySelector('.ready-note')!.textContent = note;
    b.disabled = !enabled;
    this.pick.classList.toggle('locked', locked);
  }

  /** One tag per runner on the line: lane number, name, and "you" on yours. */
  setPickTags(tags: { lane: number; name: string; me: boolean; friend?: boolean }[]) {
    const box = this.pick.querySelector<HTMLElement>('.ltags');
    if (!box) return;
    box.innerHTML = tags.map((t) => `<div class="ltag ${t.me ? 'me' : t.friend ? 'friend' : ''}" data-lane="${t.lane}"><u>${t.lane}</u><span>${t.me ? 'คุณ' : t.friend ? 'เพื่อน' : 'บอท'}</span><b>${t.name}</b></div>`).join('');
  }

  /** Keep the tags over the runners' heads (screen px; null hides one). */
  placePickTags(points: ({ x: number; y: number } | null)[]) {
    this.pick.querySelectorAll<HTMLElement>('.ltag').forEach((t, i) => {
      const p = points[i];
      t.classList.toggle('on', !!p);
      // Neighbours' tags alternate in height so they never sit on top of each other.
      if (p) t.style.transform = `translate(${p.x.toFixed(1)}px, ${(p.y - (Number(t.dataset.lane) % 2) * 26).toFixed(1)}px) translate(-50%, -100%)`;
    });
  }

  /** Screen space the pick panel covers (bottom on phones, right on wide screens) and the title on top. */
  pickInsets() {
    const panel = this.pick.querySelector<HTMLElement>('.pick-panel');
    const top = this.pick.querySelector<HTMLElement>('.pick-top');
    const side = this.panelAtSide();
    return {
      top: top ? top.offsetTop + top.offsetHeight : 0,
      bottom: panel && !side ? innerHeight - panel.offsetTop : 0,
      right: panel && side ? innerWidth - panel.offsetLeft : 0,
    };
  }

  startRace(racers: Racer[]) {
    this.menu.classList.add('hidden');
    this.results.classList.add('hidden');
    this.pick.classList.add('hidden');
    this.race.classList.remove('hidden');
    this.dots.forEach((d) => d.remove());
    this.dots = racers.map((r) => {
      const d = el('div', `dot ${r.isPlayer ? 'me' : ''}`, this.bar);
      d.style.background = r.color;
      return d;
    });
    this.setFocus(0);
    this.setItem(null, false);
    this.setTimers([]);
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
    this.useIcon.textContent = icon;
    this.useBtn.className = `use-item ${!item ? '' : rolling ? 'show rolling' : 'show ready'}`;
  }

  /** Keep the item over the runner's head (screen px), or hide it with null. */
  placeItem(p: { x: number; y: number } | null) {
    this.itemBtn.style.visibility = p ? '' : 'hidden';
    if (p) this.itemBtn.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
  }

  /** Seconds left on the timed items (rocket, shield, spring); none running hides the chip. */
  setTimers(timers: [icon: string, left: number][]) {
    const text = timers.filter(([, left]) => left > 0).map(([icon, left]) => `${icon} ${Math.ceil(left)}`).join('  ');
    if (text === this.flightShown) return;
    this.flightShown = text;
    this.flight.classList.toggle('show', !!text);
    if (text) this.flight.textContent = text;
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
  showResults(sorted: Racer[], mapLabel: string, reward: number, onAgain: (btn: HTMLButtonElement) => void, onMenu: () => void) {
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
    this.pick.classList.add('hidden');
    this.results.classList.remove('hidden');
    this.results.className = `results p${Math.min(place, 4)}`;
    this.results.innerHTML = `
      <div class="res-top">
        <div class="res-kicker">${mapLabel} · ผลการแข่งขัน</div>
        <div class="res-title">${title}</div>
        <div class="res-sub">${sub} · <b>${result(me)}</b></div>
        ${reward ? `<div class="res-coins">+${reward} <span class="coin"></span></div>` : ''}
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

  /** Wide screens put the menu panel on the right instead of along the bottom. */
  private panelAtSide() {
    return matchMedia('(min-aspect-ratio: 5/4) and (min-width: 820px)').matches; // matches the CSS
  }

  /** Screen space the menu's logo (top) and panel (bottom or right) cover, for framing the runner beside them. */
  menuInsets() {
    const top = this.menu.querySelector<HTMLElement>('.menu-top');
    const panel = this.menu.querySelector<HTMLElement>('.panel');
    const side = !!panel && this.panelAtSide();
    return {
      top: top ? top.offsetTop + top.offsetHeight : 0,
      // The "choose a runner" chip pokes out above the panel.
      bottom: panel && !side ? innerHeight - panel.offsetTop + 22 : 0,
      right: panel && side ? innerWidth - panel.offsetLeft : 0,
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
