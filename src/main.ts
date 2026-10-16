import './style.css';
import { Game } from './game.ts';
import { loadCharacters } from './render/character.ts';
import { loadProps } from './render/props.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
const loading = document.createElement('div');
loading.className = 'loading';
loading.textContent = 'กำลังโหลด…';
app.appendChild(loading);

Promise.all([
  loadCharacters(),
  loadProps((done, total) => { loading.textContent = `กำลังโหลดฉาก ${done}/${total}`; }),
]).then(([chars]) => {
  loading.remove();
  new Game(app, chars);
});
