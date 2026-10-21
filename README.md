# วิ่งซิ่งข้ามโลก (ชื่อชั่วคราว)

เกมวิ่งแข่งสัตว์ครึ่งคน 3 เลน ข้ามประเทศไทย จีน ญี่ปุ่น บนมือถือแนวตั้ง — Three.js + Vite + TypeScript

## รัน
```bash
npm install
npm run dev          # http://localhost:5173  (เปิดบนมือถือในวง Wi-Fi เดียวกัน: npm run dev -- --host)
```

URL พารามิเตอร์สำหรับทดสอบ (dev):
- `?seed=42` — แทร็กเดิมทุกครั้ง
- `?map=thai` / `china` / `japan` / `fable` — เลือกแมพ
- `?at=1200&nocount` — เริ่มกลางแทร็ก ข้ามการออกตัว · `?hold` — ค้างท่า "ระวัง" ไว้ถ่ายภาพ · `?dash` — เกจแดชเต็มตั้งแต่เริ่ม · `?item=shield` — ถือไอเท็มตั้งแต่เริ่ม (`boost` / `shield` / `ink` / `spring` / `rocket`)
- `?char=luobotu` — เลือกตัวละคร
- `?autostart` — ข้ามเมนู
- `?bot` — ให้บอทวิ่งหลบเอง

## เล่นออนไลน์กับเพื่อน (2 คน)
หน้าเมนู → **🌐 เล่นกับเพื่อน** → **🏠 สร้างห้องใหม่** → ส่งลิงก์หรือรหัสห้อง 5 ตัวให้เพื่อน → เพื่อนเปิดลิงก์ หรือกด 🌐 เล่นกับเพื่อน แล้ว**กรอกรหัสห้อง** (วางลิงก์ทั้งอันก็ได้) → เลือกตัวละคร → เจ้าห้องกด **เริ่มแข่ง!**

ส่งข้อมูลผ่าน MQTT broker สาธารณะ (`src/net/online.ts`) ไม่ต้องมีเซิร์ฟเวอร์ของเราเอง แต่ละฝั่งจำลองนักวิ่งของตัวเองแล้วส่งตำแหน่งให้อีกฝั่ง ~20 ครั้ง/วินาที

Deploy: push ขึ้น `main` แล้ว GitHub Actions (`.github/workflows/pages.yml`) จะ build และขึ้น GitHub Pages ให้อัตโนมัติ

## คำสั่ง
| คำสั่ง | ทำอะไร |
|---|---|
| `npm run check:track` | ตรวจ 300 seeds: ทุกจุดมีทางผ่าน, seed เดิมได้แทร็กเดิม |
| `npm run check:contacts` | จำลอง 60 การแข่ง (เบียด + แดช): นักวิ่งชนกันได้แต่ไม่ซ้อนทับกัน |
| `npm run check:items` | ตรวจกล่องไอเท็ม: seed เดิมได้ตำแหน่งเดิม ไม่ทับแถวอุปสรรค และไอเท็มทุกชนิดทำงานในการแข่งจำลอง |
| `npm run assets:search` | ค้นหา asset บน Sketchfab → `asset-picker.html` |
| `npm run assets:download` | ดาวน์โหลด asset ที่เลือก (ต้องมี `SKETCHFAB_TOKEN` ใน `.env.local`) |
| `npm run assets:catalog` | แตกแพ็คเป็นชิ้น + ทำภาพรวมมีเลขกำกับ (`assets-src/sketchfab/*/*/sheet_labeled.png`) |
| `python3 tools/curate-picks.py` | รวมผลคัดเลือก + กฎคัดกรอง → `assets-src/picks.json` |
| `npm run assets:props` | สร้างโมเดลเกมจาก picks → `public/assets/props/` + manifest + CREDITS |
| `npm run assets:rig` | ใส่กระดูกตัวละครอัตโนมัติ (ไม่ต้องใช้ Mixamo) ท่าวิ่งสร้างจากโค้ด |
| `npm run assets:mixamo` | นำเข้าตัวละคร/ท่าจาก Mixamo (ดู `docs/ANIMATION_PIPELINE.md`) |

หน้าตรวจงาน (dev):
- `/prop-gallery.html` แสดงอุปสรรคทุกแบบ × ทุกฉาก พร้อมกล่องชน (`?kind=wall`, `?t=1.2`)
- `/anim-lab.html` แสดงตัวละครทุกตัววิ่ง/กระโดด/สไลด์ พร้อมปุ่มเปลี่ยนท่า กล้อง ความเร็ว slow-mo

## เอกสาร
- [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) — ดีไซน์เกม
- [docs/ANIMATION_PIPELINE.md](docs/ANIMATION_PIPELINE.md) — ริกตัวละคร + ระบบท่าวิ่ง (และ Mixamo ถ้าต้องการ)
