// Search Sketchfab for downloadable candidates per category and write
// tools/asset-candidates.json for asset-picker.html.
// Usage: node tools/sketchfab-search.mjs
import { writeFile } from 'node:fs/promises';

const PER_QUERY = 8;
// Real brands can't ship in the game.
const BRANDS = /lays\b|hershey|coca|pepsi|nike|mcdonald|starbucks|kitkat|oreo/i;

// [category id, label, query, max faces]
const QUERIES = [
  ['pack', 'แพ็คชุดใหญ่ (สไตล์เดียวกันทั้งเกม)', 'kaykit', 200000],
  ['pack', 'แพ็คชุดใหญ่ (สไตล์เดียวกันทั้งเกม)', 'quaternius', 200000],
  ['pack', 'แพ็คชุดใหญ่ (สไตล์เดียวกันทั้งเกม)', 'low poly fantasy village pack', 200000],
  ['road', 'พื้นทาง / ถนน', 'low poly modular road stylized', 20000],
  ['road', 'พื้นทาง / ถนน', 'low poly path tiles', 20000],
  ['village', 'ฉาก: หมู่บ้านนิทาน', 'stylized fairy tale house', 20000],
  ['village', 'ฉาก: หมู่บ้านนิทาน', 'low poly medieval village props', 50000],
  ['forest', 'ฉาก: ป่ามหัศจรรย์', 'stylized giant mushroom', 15000],
  ['forest', 'ฉาก: ป่ามหัศจรรย์', 'low poly stylized tree', 15000],
  ['candy', 'ฉาก: แดนขนมหวาน', 'low poly candy', 20000],
  ['candy', 'ฉาก: แดนขนมหวาน', 'low poly lollipop', 10000],
  ['candy', 'ฉาก: แดนขนมหวาน', 'stylized cake', 15000],
  ['harbor', 'ฉาก: ท่าเรือโจรสลัด', 'low poly pirate props', 30000],
  ['harbor', 'ฉาก: ท่าเรือโจรสลัด', 'stylized wooden dock pier', 20000],
  ['snow', 'ฉาก: ภูเขาหิมะ', 'low poly winter snow props', 30000],
  ['snow', 'ฉาก: ภูเขาหิมะ', 'stylized snowman', 10000],
  ['ob-jump', 'อุปสรรค: กระโดดข้าม', 'low poly wooden fence', 5000],
  ['ob-jump', 'อุปสรรค: กระโดดข้าม', 'stylized log', 5000],
  ['ob-jump', 'อุปสรรค: กระโดดข้าม', 'hay bale', 5000],
  ['ob-slide', 'อุปสรรค: สไลด์ลอด', 'hanging sign', 8000],
  ['ob-slide', 'อุปสรรค: สไลด์ลอด', 'low poly wooden arch', 10000],
  ['ob-slide', 'อุปสรรค: สไลด์ลอด', 'low poly gate', 10000],
  ['ob-slide', 'อุปสรรค: สไลด์ลอด', 'low poly bunting flags', 8000],
  ['ob-block', 'อุปสรรค: ขวางเลน (ต้องหลบ)', 'stylized wooden cart', 10000],
  ['ob-block', 'อุปสรรค: ขวางเลน (ต้องหลบ)', 'low poly crates', 8000],
  ['ob-block', 'อุปสรรค: ขวางเลน (ต้องหลบ)', 'low poly stone wall', 8000],
  ['ob-ride', 'อุปสรรค: ขบวนยาว วิ่งบนหลังคาได้', 'low poly wagon carriage', 15000],
  ['ob-ride', 'อุปสรรค: ขบวนยาว วิ่งบนหลังคาได้', 'stylized cartoon train', 20000],
  ['ob-move', 'อุปสรรค: เคลื่อนที่', 'stylized barrel', 5000],
  ['ob-move', 'อุปสรรค: เคลื่อนที่', 'low poly windmill', 10000],
  ['ob-move', 'อุปสรรค: เคลื่อนที่', 'low poly wrecking ball', 10000],
  ['ob-move', 'อุปสรรค: เคลื่อนที่', 'low poly obstacle course', 30000],
  ['ob-move', 'อุปสรรค: เคลื่อนที่', 'low poly boulder rock', 5000],
  ['ob-floor', 'อุปสรรค: พื้นพิเศษ', 'low poly trampoline', 5000],
  ['ob-floor', 'อุปสรรค: พื้นพิเศษ', 'low poly spike trap', 5000],
  ['pickup', 'ของเก็บ / พาวเวอร์อัพ', 'low poly gold coin', 3000],
  ['pickup', 'ของเก็บ / พาวเวอร์อัพ', 'low poly magnet', 3000],
  ['pickup', 'ของเก็บ / พาวเวอร์อัพ', 'stylized power up', 5000],
];

async function search(q, maxFaces) {
  const url = new URL('https://api.sketchfab.com/v3/search');
  url.search = new URLSearchParams({
    type: 'models', q, downloadable: 'true', sort_by: '-likeCount',
    max_face_count: String(maxFaces), count: String(PER_QUERY),
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for "${q}"`);
  return (await res.json()).results;
}

const thumb = (images) =>
  [...images].sort((a, b) => a.width - b.width).find((i) => i.width >= 400)?.url ?? images[0]?.url;

const categories = new Map();
const seen = new Set();
for (const [id, label, q, maxFaces] of QUERIES) {
  const results = await search(q, maxFaces);
  if (!categories.has(id)) categories.set(id, { id, label, items: [] });
  for (const r of results) {
    if (seen.has(r.uid) || r.isAgeRestricted || BRANDS.test(r.name)) continue;
    seen.add(r.uid);
    categories.get(id).items.push({
      uid: r.uid,
      name: r.name,
      author: r.user.displayName || r.user.username,
      license: r.license?.label ?? 'unknown',
      faces: r.faceCount,
      likes: r.likeCount,
      animated: r.animationCount > 0,
      thumb: thumb(r.thumbnails.images),
      url: r.viewerUrl,
      query: q,
    });
  }
  console.log(`${q}: ${results.length}`);
}

await writeFile(
  new URL('./asset-candidates.json', import.meta.url),
  JSON.stringify({ generatedAt: new Date().toISOString(), categories: [...categories.values()] }, null, 2),
);
