// Build game-ready prop models from assets-src/picks.json
// ([{slot, biome, dir, index, rank, what}]): extract each piece with Blender,
// compress it, write public/assets/props/manifest.json and CREDITS.md.
// Usage: npm run assets:props
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('../', import.meta.url).pathname;
const BLENDER = existsSync('/Applications/Blender.app/Contents/MacOS/Blender') ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender';
const OUT = `${root}public/assets/props`;
const TMP = `${root}assets-src/.props-tmp`;

// Which way a piece's long side should run, and its triangle budget.
const AXIS = { lowbar: 'x', highbar: 'x', sweeper: 'x', rolling: 'x', trainCar: 'z', oncoming: 'z' };
// Decor is instanced many times along the track, so it gets a tight budget.
const BUDGET = { decorLarge: 1000, decorSmall: 500 };
const budgetOf = (slot) => BUDGET[slot] ?? 4000;

const picks = JSON.parse(await readFile(`${root}assets-src/picks.json`, 'utf8'));
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await mkdir(TMP, { recursive: true });

const manifest = { obstacles: {}, decor: { large: {}, small: {} } };
const built = new Map(); // "dir#index#axis#flip#budget" -> file name, so shared pieces are built once
const sizes = new Map(); // file name -> [x, y, z] bounds in metres
const used = new Map(); // dir -> Set of uses, for credits

for (const p of [...picks].sort((a, b) => a.rank - b.rank)) {
  const axis = AXIS[p.slot] ?? 'none';
  const key = `${p.dir}#${p.index}#${axis}#${p.flip ? 'flip' : ''}#${budgetOf(p.slot)}`;
  let file = built.get(key);
  if (!file) {
    file = `${p.slot}-${p.biome}-${built.size}.glb`;
    const raw = `${TMP}/${file}`;
    const { stdout } = await run(BLENDER, ['-b', '-P', `${root}tools/blender/extract_piece.py`, '--', `${root}${p.dir}`, String(p.index), raw, axis, p.flip ? 'flip' : '', String(budgetOf(p.slot))], { maxBuffer: 1 << 26 });
    const line = stdout.split('\n').find((l) => l.startsWith('EXTRACTED'));
    if (!line) throw new Error(`extract failed for ${key}\n${stdout.slice(-2000)}`);
    const tris = Number(line.match(/tris=(\d+)/)[1]);
    sizes.set(file, line.match(/size\(x,y_up,z\)=\(([^)]+)\)/)[1].split(',').map(Number));
    // Blender already decimated to the budget; keep the shape intact here.
    const args = ['optimize', raw, `${OUT}/${file}`, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '512', '--simplify', 'false'];
    await run('npx', ['gltf-transform', ...args], { cwd: root });
    built.set(key, file);
    console.log(`${file}  ${p.what}  (${tris} tris)`);
  }
  // Non-candy models used in candy land get a pastel tint at runtime.
  const entry = { url: `/assets/props/${file}`, size: sizes.get(file), ...(p.biome === 'candy' && !p.dir.includes('/candy/') ? { tint: 'candy' } : {}) };
  const bucket = p.slot === 'decorLarge' ? manifest.decor.large : p.slot === 'decorSmall' ? manifest.decor.small : (manifest.obstacles[p.slot] ??= {});
  const list = (bucket[p.biome] ??= []);
  if (!list.some((e) => e.url === entry.url)) list.push(entry);
  if (!used.has(p.dir)) used.set(p.dir, new Set());
  used.get(p.dir).add(p.slot.startsWith('decor') ? 'scenery' : p.slot);
}

await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');

const rows = [];
for (const [dir, uses] of used) {
  const s = JSON.parse(await readFile(`${root}${dir}/source.json`, 'utf8'));
  rows.push(`| ${s.name.replace(/\|/g, '\\|')} | ${s.author} | ${s.license} | https://sketchfab.com/3d-models/${s.uid} | ${[...uses].join(', ')} |`);
}
await writeFile(`${root}public/assets/CREDITS.md`,
  `# Asset Credits\n\nSketchfab models used in the game (CC-BY requires this attribution).\n\n` +
  `| Asset | Author | License | Source | Used as |\n|---|---|---|---|---|\n${rows.sort().join('\n')}\n`);
await rm(TMP, { recursive: true, force: true });
console.log(`\n${built.size} models, ${used.size} source assets credited`);
