# Animation Pipeline

ตอนนี้ตัวละครทุกตัว **มีกระดูกแล้ว และวิ่งได้เลยโดยไม่ต้องใช้ Mixamo** (ดูหัวข้อ "ริกอัตโนมัติ + ท่าจากโค้ด" ด้านล่าง) ส่วนขั้นตอน Mixamo ยังใช้ได้ ถ้าอยากได้ท่า motion-capture จริงมาแทน

## ริกอัตโนมัติ + ท่าจากโค้ด (ค่าเริ่มต้น)
```
assets-src/mixamo/upload/<id>.fbx + tools/blender/rig-joints.json
        │  npm run assets:rig   (Blender: สร้างกระดูกชื่อแบบ Mixamo + skin weights)
        ▼
public/assets/characters/<id>.glb  → src/render/rig.ts ขยับกระดูกเองทุกเฟรม
```
- **ตัวละครที่สร้างจากโค้ด:** ฮิปโปซิ่ง (`hippo_runner`) ปั้นจากรูปทรงพื้นฐานใน `tools/blender/model_hippo.py` (หัวฮิปโปการ์ตูน ตัวคนใส่เสื้อกล้าม กางเกงวิ่ง รองเท้าผ้าใบ) → `blender -b -P tools/blender/model_hippo.py -- assets-src/characters/hippo_runner.glb` แล้วทำต่อด้วย `glb_to_mixamo_fbx.py` และ `npm run assets:rig -- hippo_runner` เหมือนตัวอื่น (สคริปต์พิมพ์ค่า scale/dy ไว้แปลงตำแหน่งข้อต่อ)
- **ตำแหน่งข้อต่อ** วัดด้วยมือจากภาพด้านหน้า/ด้านข้าง เก็บไว้ใน `tools/blender/rig-joints.json` (เหมือนการวางจุดใน Mixamo) ถ้าเพิ่มตัวละครใหม่ให้เพิ่มรายการที่นี่
- **Skin weights**: คำนวณ heat weights บนโมเดลสำเนาแบบ voxel (กันปัญหาเมชไม่ปิด) แล้วโอนกลับมาที่โมเดลจริง วัสดุดึงจากไฟล์ต้นฉบับ `assets-src/characters/<id>.glb`
- `hemZ` (ไม่บังคับ): ความสูงชายเสื้อแจ็กเก็ต ให้ชายเสื้อขยับตามสะโพกแทนการถูกต้นขาดึง (ใช้กับม้าแจ็ค)
- `npm run assets:rig -- <id> --preview` เรนเดอร์ท่าวิ่งทดสอบไว้ที่ `assets-src/mixamo/upload/<id>_runpose_*.png`

**ท่าวิ่ง (`src/render/rig.ts`)** สร้างแบบที่นักแอนิเมตทำ run cycle:
- เท้าเดินตามเส้นทางของนักวิ่งระยะสั้น (ลงเท้า → ถีบปลายเท้า → ส้นเตะขึ้นหลัง → ยกเข่าสูง → เหยียดไปข้างหน้าแล้วตะกุยลง) แก้มุมเข่าด้วย IK สองท่อน จึงใช้ได้กับขาทุกความยาว
- ข้อเท้ากระดกตามจังหวะ นิ้วเท้างอตอนถีบตัว
- สะโพกยุบสองครั้งต่อรอบ บิดตามขาที่ก้าว และตกฝั่งที่ลอย ลำตัวบิดสวน และโน้มตัวมากขึ้นตอนเร่ง
- แขนแกว่งสวนขา งอศอกราว 80° หัวนิ่ง ตาจ้องทาง
- ความถี่ก้าวและช่วงก้าวปรับตามความเร็วจริง มีแรงกระแทกตอนลงพื้นหลังกระโดด เอนตัวตอนเปลี่ยนเลน
- ท่าอื่นมีครบ ได้แก่ idle, jump (ก้าวกระโดดยกเข่า), slide (สไลด์แบบเบสบอล), stumble, fall, victory, defeat และ crossfade ระหว่างท่า
- ปรับรายตัวได้ใน `characters.json` → `anim`: `armSpread` (กางแขนเพิ่ม/องศา สำหรับตัวพุงใหญ่ เช่น พี่หมู) และ `armSwing` (ลดการแกว่งแขน สำหรับเมชที่แขนติดลำตัว)

**หน้าตรวจท่า (dev):** `/anim-lab.html` แสดงตัวละครทุกตัววิ่งพร้อมกันบนพื้นที่เลื่อนตามความเร็ว มีปุ่มเปลี่ยนท่า กล้อง (side/front/three/chase) ความเร็ว และ slow-mo (`?char=velkara` ดูตัวเดียว)

# Mixamo (ไม่บังคับ: ท่า motion-capture)

ตัวละครทุกตัวใช้ **โครงกระดูกมาตรฐาน Mixamo** ร่วมกัน เพราะฉะนั้นดาวน์โหลดท่า **ชุดเดียว** แล้วใช้ได้กับทุกตัว ท่าเป็นท่า motion-capture จริง จึงดูเป็นธรรมชาติแบบเกมมืออาชีพ

```
assets-src/characters/*.glb       (โมเดลต้นฉบับ)
        │  blender: tools/blender/glb_to_mixamo_fbx.py   (ทำไว้ให้แล้ว)
        ▼
assets-src/mixamo/upload/*.fbx    → อัปโหลดขึ้น Mixamo
        │  Mixamo: auto-rig + ดาวน์โหลด
        ▼
assets-src/mixamo/rigged/<id>.fbx   (ตัวละคร With Skin)
assets-src/mixamo/anims/<clip>.fbx  (ท่า Without Skin)
        │  npm run assets:mixamo
        ▼
public/assets/characters/<id>.glb + anims.glb   → เกมใช้ทันที
```

## ขั้นที่ 1: ใส่กระดูกตัวละคร (ทำทีละตัว)
1. เข้า https://www.mixamo.com แล้วล็อกอินด้วย Adobe ID (ฟรี)
2. กด **Upload Character** แล้วเลือกไฟล์จาก `assets-src/mixamo/upload/<id>.fbx`
3. วางจุด **Chin, Wrists, Elbows, Knees, Groin** ให้ตรงกับร่าง
   - ถ้าหัวสัตว์ใหญ่ ให้วาง Chin ไว้ที่ใต้คาง ไม่ใช่ที่ปลายจมูก
   - Skeleton LOD: เลือก **Standard Skeleton (65)** ถ้ามือมีนิ้วชัดเจน ถ้ามือเป็นก้อนให้เลือก **No Fingers**
4. กด Next แล้วรอให้ Mixamo ประมวลผล จากนั้นลองดูท่าตัวอย่างว่าแขนขาบิดผิดรูปไหม ถ้าผิดให้กลับไปวางจุดใหม่
5. กด **Download** แล้วตั้งค่า: Format = **FBX Binary(.fbx)**, Pose = **T-pose**
6. บันทึกไฟล์เป็น `assets-src/mixamo/rigged/<id>.fbx` โดยใช้ชื่อเดียวกับไฟล์ที่อัปโหลด เช่น `luobotu.fbx`

## ขั้นที่ 2: ดาวน์โหลดท่า (ทำครั้งเดียว ใช้ได้ทุกตัว)
เลือกตัวละครตัวใดก็ได้บน Mixamo แล้วค้นหาท่าตามตารางนี้

| ไฟล์ที่ต้องบันทึก | คำค้นใน Mixamo (เลือกท่าที่ชอบ) | ตั้งค่า |
|---|---|---|
| `run.fbx` | Fast Run, Running, Sprint | ✅ **In Place** |
| `jump.fbx` | Running Jump, Jump | ✅ In Place |
| `slide.fbx` | Running Slide, Baseball Slide | ✅ In Place |
| `stumble.fbx` | Stumble, Trip, Hit Reaction | ✅ In Place (ถ้ามี) |
| `fall.fbx` | Falling, Fall Flat, Knocked Down | |
| `idle.fbx` | Idle, Breathing Idle | |
| `victory.fbx` | Victory, Cheering | |
| `defeat.fbx` | Defeated, Disappointed | |
| `strafe_left.fbx` / `strafe_right.fbx` *(ไม่บังคับ)* | Left Strafe / Right Strafe | ✅ In Place |

ตั้งค่าตอนดาวน์โหลดท่า:
- Format = **FBX Binary(.fbx)**
- Skin = **Without Skin** (ไฟล์เล็กมาก)
- Frames per Second = **30**
- Keyframe Reduction = **none**

บันทึกทุกไฟล์ไว้ที่ `assets-src/mixamo/anims/` **ชื่อไฟล์จะกลายเป็นชื่อท่าในเกม** จึงต้องตั้งชื่อตามตารางให้ตรง

> **เคล็ดลับให้ดูโปร:**
> - ท่าวิ่งเลือก **Fast Run** หรือ Sprint ที่ตัวโน้มไปข้างหน้า จะเข้ากับความเร็วของเกมแนวนี้มากกว่า
> - ท่ากระโดดเลือกแบบ "Running Jump" ที่ไม่มีช่วงย่อตัวยาวก่อนกระโดด เพราะเกมจะยืดหรือหดท่าให้พอดีกับเวลาที่ลอยอยู่กลางอากาศเอง (ประมาณ 0.66 วิ)
> - ปรับ **Character Arm-Space** ใน Mixamo ให้แขนไม่ทะลุลำตัวของตัวละครที่ตัวอ้วน เช่น พี่หมู

## ขั้นที่ 3: นำเข้าเกม
```bash
npm run assets:mixamo
```
สคริปต์จะทำสามอย่าง:
- แปลงไฟล์ตัวละครทุกตัวใน `rigged/` และท่าทั้งหมดใน `anims/` เป็น GLB แล้วบีบอัด
- อัปเดต `characters.json` ให้ชี้ไปที่ตัวละครที่มีกระดูกแล้ว
- เกมจะใช้คลิปจาก Mixamo แทนท่าจากโค้ด (`rig.ts`) ทันที

## การทำงานในเกม (`src/render/character.ts`)
- **Crossfade 0.12 วิ** ระหว่างท่า
- **วิ่ง**: ความเร็วท่าแปรตามความเร็ววิ่งจริง เท้าจึงไม่ไถลบนพื้น
- **กระโดด สไลด์ สะดุด**: ยืดหรือหดท่าให้พอดีกับเวลาในเกม เช่น เวลาที่ลอยอยู่กลางอากาศ
- **เอนตัว**: ตัวละครเอนตัวตามการเปลี่ยนเลน ทำด้วยโค้ดซ้อนบนท่า
- **ตัวละครสัดส่วนต่างกัน**: ปรับระยะการเด้งของสะโพกตามความสูงสะโพกของแต่ละตัว เช่น พี่หมูตัวเตี้ยกว่าตัวอื่น
