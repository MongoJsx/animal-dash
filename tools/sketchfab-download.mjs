// Download the models listed in tools/selected-assets.json into
// assets-src/sketchfab/<cat>/<slug>/ and regenerate public/assets/CREDITS.md.
// Needs a Sketchfab API token (https://sketchfab.com/settings/password),
// either in the SKETCHFAB_TOKEN env var or in .env.local as SKETCHFAB_TOKEN=...
// Usage: npm run assets:download
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = new URL('../', import.meta.url);
const run = promisify(execFile);

async function token() {
  if (process.env.SKETCHFAB_TOKEN) return process.env.SKETCHFAB_TOKEN;
  try {
    const env = await readFile(new URL('.env.local', root), 'utf8');
    return env.match(/^SKETCHFAB_TOKEN=(.+)$/m)?.[1].trim();
  } catch { return undefined; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sketchfab rate-limits the download endpoint (HTTP 429): wait and retry.
async function fetchRetry(url, opts, tries = 8) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, opts);
    if (res.status !== 429 || i >= tries) return res;
    const wait = Number(res.headers.get('retry-after')) * 1000 || Math.min(120_000, 10_000 * 2 ** i);
    console.log(`   rate limited, waiting ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const exists = (p) => access(p).then(() => true, () => false);

const TOKEN = await token();
if (!TOKEN) {
  console.error('Missing SKETCHFAB_TOKEN. Put it in .env.local (SKETCHFAB_TOKEN=xxxx).');
  process.exit(1);
}

const assets = JSON.parse(await readFile(new URL('tools/selected-assets.json', root), 'utf8'));
const failed = [];

for (const [n, a] of assets.entries()) {
  // Same names (e.g. four "wood fence with snow") get the uid suffix to stay unique.
  const dir = new URL(`assets-src/sketchfab/${a.cat}/${slug(a.name)}-${a.uid.slice(0, 6)}/`, root);
  const tag = `[${n + 1}/${assets.length}] ${a.name}`;
  // source.json is written last, so it marks a complete download.
  if (await exists(new URL('source.json', dir))) {
    console.log(`${tag}: already downloaded`);
    continue;
  }
  try {
    const res = await fetchRetry(`https://api.sketchfab.com/v3/models/${a.uid}/download`, {
      headers: { Authorization: `Token ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`download info ${res.status}`);
    const links = await res.json();
    // Prefer a single .glb; fall back to the zipped glTF.
    const pick = links.glb ? ['glb', links.glb] : links.gltf ? ['gltf', links.gltf] : null;
    if (!pick) throw new Error(`no glb/gltf (has: ${Object.keys(links).join(', ')})`);
    const [kind, { url, size }] = pick;
    await mkdir(dir, { recursive: true });
    const file = await fetch(url);
    if (!file.ok) throw new Error(`file ${file.status}`);
    const buf = Buffer.from(await file.arrayBuffer());
    if (kind === 'glb') {
      await writeFile(new URL('model.glb', dir), buf);
    } else {
      const zip = new URL('gltf.zip', dir);
      await writeFile(zip, buf);
      await run('unzip', ['-oq', zip.pathname, '-d', new URL('gltf/', dir).pathname]);
    }
    await writeFile(new URL('source.json', dir), JSON.stringify({ ...a, url: `https://sketchfab.com/3d-models/${a.uid}` }, null, 2));
    console.log(`${tag}: ${kind} ${(size / 1e6).toFixed(1)} MB`);
    await sleep(1500);
  } catch (e) {
    failed.push(a.name);
    console.error(`${tag}: FAILED — ${e.message}`);
  }
}

const rows = assets.map((a) =>
  `| ${a.name.replace(/\|/g, '\\|')} | ${a.author} | ${a.license} | https://sketchfab.com/3d-models/${a.uid} | ${a.cat} |`);
await writeFile(new URL('public/assets/CREDITS.md', root),
  `# Asset Credits\n\nEvery Sketchfab model used in the game must be listed here (required by CC-BY).\n\n` +
  `| Asset | Author | License | Source | Category |\n|---|---|---|---|---|\n${rows.join('\n')}\n`);

console.log(failed.length ? `\nDone with ${failed.length} failures:\n- ${failed.join('\n- ')}` : '\nAll downloaded.');
