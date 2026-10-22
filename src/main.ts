import './style.css';
import { watchForUpdates } from './core/update.ts';
import { Game } from './game.ts';
import { loadCharacters } from './render/character.ts';
import { loadProps } from './render/props.ts';

let game: Game | null = null;
watchForUpdates(() => !game || game.idle);

const app = document.querySelector<HTMLDivElement>('#app')!;

// The loading screen lives in index.html so it shows before this script
// arrives; here it gets its progress, a tip every few seconds and a fade out.
const boot = document.querySelector<HTMLElement>('#boot');
const status = boot?.querySelector<HTMLElement>('.boot-status');
const pct = boot?.querySelector<HTMLElement>('.boot-pct');
const tip = boot?.querySelector<HTMLElement>('.boot-tip');
const TIPS = [
  'หลบให้ผ่านทุกแถว FOCUS จะขึ้น ยิ่งวิ่งยิ่งเร็ว',
  'ชนของแล้วเกจแดชจะเต็มไวขึ้น เต็มเมื่อไหร่แตะ 2 ครั้งพุ่งทะลุทุกอย่าง',
  'ตัวที่แข็งแกร่งกว่าเบียดคนอื่นออกจากเลนได้',
  'ความอึดสูง ชนแล้ว FOCUS ไม่หายหมด',
  'วิ่งชนกล่อง ? เพื่อสุ่มไอเท็ม ยิ่งตามหลังยิ่งได้ของดี',
  'ส่งลิงก์ห้องให้เพื่อน แล้วมาวิ่งแข่งกันสด ๆ',
];
let tipAt = 0;
const tipTimer = window.setInterval(() => {
  if (!tip) return;
  tipAt = (tipAt + 1) % TIPS.length;
  tip.innerHTML = `<span>${TIPS[tipAt]}</span>`;
}, 3200);
let shown = 0;
function progress(p: number, text?: string) {
  shown = Math.max(shown, Math.min(1, p));
  boot?.style.setProperty('--p', shown.toFixed(3));
  if (pct) pct.textContent = `${Math.round(shown * 100)}%`;
  if (text && status) status.textContent = text;
}
progress(0.08, 'กำลังโหลดนักวิ่ง…');

Promise.all([
  loadCharacters(),
  loadProps((done, total) => progress(0.1 + 0.85 * (done / Math.max(1, total)), 'กำลังจัดสนามแข่ง…')),
  // The podium paints its signs with the UI font.
  Promise.all(['900 40px Kanit', 'italic 900 40px Kanit', '800 40px Kanit'].map((f) => document.fonts.load(f))).catch(() => {}),
]).then(([chars]) => {
  progress(1, 'พร้อมแล้ว!');
  game = new Game(app, chars);
  // Let the first frames draw (shaders compile) behind the loader, then reveal.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.clearInterval(tipTimer);
    boot?.classList.add('out');
    window.setTimeout(() => boot?.remove(), 600);
  }));
});
