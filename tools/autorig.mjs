// Rig characters without Mixamo (see docs/ANIMATION_PIPELINE.md).
//   assets-src/mixamo/upload/<id>.fbx + tools/blender/rig-joints.json
//     -> public/assets/characters/<id>.glb (skinned, Mixamo bone names)
// and points characters.json at the rigged models. The game animates them in
// code (src/render/rig.ts) until real Mixamo clips are imported.
// Usage: npm run assets:rig [-- <id> ...]   (add --preview to render a test pose)
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('../', import.meta.url).pathname;
const BLENDER = existsSync('/Applications/Blender.app/Contents/MacOS/Blender') ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender';
const OUT = `${root}public/assets/characters`;
const TMP = `${root}assets-src/mixamo/.tmp-rig`;
const args = process.argv.slice(2);
const preview = args.includes('--preview');

const joints = JSON.parse(await readFile(`${root}tools/blender/rig-joints.json`, 'utf8'));
const ids = args.filter((a) => !a.startsWith('--'));
const todo = ids.length ? ids : Object.keys(joints).filter((k) => !k.startsWith('_'));

await mkdir(TMP, { recursive: true });
const manifestPath = `${OUT}/characters.json`;
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

for (const id of todo) {
  console.log(`rig ${id}`);
  const source = `${root}assets-src/characters/${id}.glb`;
  const extra = [...(existsSync(source) ? [source] : []), ...(preview ? [`${root}assets-src/mixamo/upload/${id}_runpose`] : [])];
  const { stdout } = await run(BLENDER, [
    '-b', '-P', `${root}tools/blender/autorig.py`, '--',
    id, `${root}assets-src/mixamo/upload/${id}.fbx`, `${TMP}/${id}.glb`, ...extra,
  ], { maxBuffer: 1 << 26 });
  for (const line of stdout.split('\n')) if (/^(RIG|proxy)/.test(line)) console.log('   ', line);
  await run('npx', ['gltf-transform', 'optimize', `${TMP}/${id}.glb`, `${OUT}/${id}.glb`,
    '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024', '--simplify', 'false'], { cwd: root });
  const entry = manifest.find((c) => c.id === id);
  if (entry) entry.model = `/assets/characters/${id}.glb`;
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
await rm(TMP, { recursive: true, force: true });
console.log('done');
