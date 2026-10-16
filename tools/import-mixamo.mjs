// Turn Mixamo downloads into game assets (see docs/ANIMATION_PIPELINE.md).
//   assets-src/mixamo/rigged/<id>.fbx  (With Skin)    -> public/assets/characters/<id>.glb
//   assets-src/mixamo/anims/<clip>.fbx (Without Skin) -> public/assets/characters/anims.glb
// and points public/assets/characters/characters.json at the rigged models.
// Usage: npm run assets:mixamo
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('../', import.meta.url).pathname;
const BLENDER = existsSync('/Applications/Blender.app/Contents/MacOS/Blender') ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender';
const SCRIPT = `${root}tools/blender/mixamo_to_glb.py`;
const OUT = `${root}public/assets/characters`;
const TMP = `${root}assets-src/mixamo/.tmp`;
const gltf = (...args) => run('npx', ['gltf-transform', ...args], { cwd: root });

async function blender(...args) {
  const { stdout } = await run(BLENDER, ['-b', '-P', SCRIPT, '--', ...args], { maxBuffer: 1 << 26 });
  for (const line of stdout.split('\n')) if (line.startsWith('clip ')) console.log('   ', line);
}

await mkdir(TMP, { recursive: true });
const manifestPath = `${OUT}/characters.json`;
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const riggedDir = `${root}assets-src/mixamo/rigged`;
for (const f of existsSync(riggedDir) ? (await readdir(riggedDir)).filter((f) => f.toLowerCase().endsWith('.fbx')) : []) {
  const id = f.replace(/\.fbx$/i, '');
  console.log(`character ${id}`);
  await blender('character', `${riggedDir}/${f}`, `${TMP}/${id}.glb`);
  await gltf('optimize', `${TMP}/${id}.glb`, `${OUT}/${id}.glb`, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024', '--simplify', 'false');
  const entry = manifest.find((c) => c.id === id);
  if (entry) entry.model = `/assets/characters/${id}.glb`;
  else manifest.push({ id, name: id, model: `/assets/characters/${id}.glb` });
}

const animDir = `${root}assets-src/mixamo/anims`;
if (existsSync(animDir) && (await readdir(animDir)).some((f) => f.toLowerCase().endsWith('.fbx'))) {
  console.log('animations');
  await blender('anims', animDir, `${TMP}/anims.glb`);
  await gltf('optimize', `${TMP}/anims.glb`, `${OUT}/anims.glb`, '--compress', 'meshopt', '--simplify', 'false');
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
await rm(TMP, { recursive: true, force: true });
console.log('done');
