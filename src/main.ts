import './style.css';
import { watchForUpdates } from './core/update.ts';
import { Game } from './game.ts';
import { loadCharacters } from './render/character.ts';
import { loadProps } from './render/props.ts';

let game: Game | null = null;
watchForUpdates(() => !game || game.idle);

const app = document.querySelector<HTMLDivElement>('#app')!;
const loading = document.createElement('div');
loading.className = 'loading';
loading.textContent = 'กำลังโหลด…';
app.appendChild(loading);

Promise.all([
  loadCharacters(),
  loadProps((done, total) => { loading.textContent = `กำลังโหลดฉาก ${done}/${total}`; }),
  // The podium paints its signs with the UI font.
  Promise.all(['900 40px Kanit', 'italic 900 40px Kanit', '800 40px Kanit'].map((f) => document.fonts.load(f))).catch(() => {}),
]).then(([chars]) => {
  loading.remove();
  game = new Game(app, chars);
});
