import { BIOME_LENGTH, RACE_LENGTH } from '../config.ts';
import type { Rng } from '../core/rng.ts';

export type CountryId = 'th' | 'cn' | 'jp';
export type ClassicBiome = 'village' | 'forest' | 'candy' | 'harbor' | 'snow';
export type BiomeId =
  | ClassicBiome
  | 'th_city' | 'th_palace' | 'th_market' | 'th_fields'
  | 'cn_wall' | 'cn_bamboo' | 'cn_town' | 'cn_guilin'
  | 'jp_sakura' | 'jp_torii' | 'jp_tokyo' | 'jp_snow';

export type Particles = 'petals' | 'snow' | 'lanterns' | 'leaves' | 'confetti' | 'fireflies' | 'mist';

export interface Palette {
  name: string;
  country?: CountryId;
  sky: number; // horizon / fog colour
  skyTop?: number;
  ground: number;
  groundAlt: number;
  side: number;
  a: number; // main prop colour
  b: number; // secondary
  c: number; // accent
  d: number; // dark detail
  // Lighting and atmosphere (defaults suit the classic daylight biomes).
  sun?: number;
  sunI?: number;
  sunAngle?: number; // sun elevation in radians
  hemiSky?: number;
  hemiGround?: number;
  hemiI?: number;
  fog?: [near: number, far: number];
  hills?: number; // elevation swing of the track in metres
  sideY?: number; // height of the land beside the track
  particles?: Particles;
}

export const BIOMES: Record<BiomeId, Palette> = {
  village: { name: 'หมู่บ้านนิทาน', sky: 0x9fd3ff, ground: 0xc2ab8c, groundAlt: 0xb39b7b, side: 0x86b86b, a: 0xa0683a, b: 0xf2e2c4, c: 0xd1495b, d: 0x5c3d2e },
  forest: { name: 'ป่ามหัศจรรย์', sky: 0xbfe3c9, ground: 0x8a7457, groundAlt: 0x7c6a4f, side: 0x4f8f45, a: 0x6b4a2b, b: 0x2f6b2f, c: 0xe63946, d: 0x3b2a1a, particles: 'leaves' },
  candy: { name: 'แดนขนมหวาน', sky: 0xffe0ef, ground: 0xf3d2a2, groundAlt: 0xe8c38e, side: 0xffc8dd, a: 0xff70a6, b: 0x70d6ff, c: 0xffd670, d: 0x6f4e37, particles: 'confetti' },
  harbor: { name: 'ท่าเรือโจรสลัด', sky: 0xa8dadc, ground: 0xa47148, groundAlt: 0x936340, side: 0x2a9d8f, a: 0x8d5a34, b: 0xd4a373, c: 0xe63946, d: 0x3d405b, hills: 0, sideY: -0.6 },
  snow: { name: 'ภูเขาหิมะ', sky: 0xcfe8ff, ground: 0xe8f1f8, groundAlt: 0xd8e6f2, side: 0xffffff, a: 0x7f5539, b: 0xa2d2ff, c: 0xe63946, d: 0x4a4e69, particles: 'snow' },

  // ── Thailand ──────────────────────────────────────────────────────────
  th_city: {
    name: 'ถนนกรุงเทพฯ', country: 'th', sky: 0xffd9a8, skyTop: 0x4fa3e0, ground: 0x4a4a52, groundAlt: 0x5a5a63, side: 0x8f8a80,
    a: 0x1f6fb2, b: 0xffd23f, c: 0xe63946, d: 0x2b2d42, sun: 0xffe2b8, sunI: 2.4, sunAngle: 0.75, hemiSky: 0xcfe7ff, hemiGround: 0x9a8670, hemiI: 1.5,
    fog: [60, 210], hills: 1.2,
  },
  th_palace: {
    name: 'วัดพระแก้ว', country: 'th', sky: 0xd6ecff, skyTop: 0x2f86d6, ground: 0xeee6d6, groundAlt: 0xdcd2bf, side: 0x6fae4f,
    a: 0xf3c13a, b: 0xffffff, c: 0xd9480f, d: 0x1e6b52, sun: 0xfff2d6, sunI: 2.6, sunAngle: 0.9, hemiSky: 0xd8ecff, hemiGround: 0xb59a6a, hemiI: 1.6,
    fog: [70, 230], hills: 0.6,
  },
  th_market: {
    name: 'ตลาดน้ำ', country: 'th', sky: 0xcdeee6, skyTop: 0x3c9fd0, ground: 0x9c6b43, groundAlt: 0x87593a, side: 0x2e8b7a,
    a: 0x8d5a34, b: 0xf4a259, c: 0xe63946, d: 0x3d2b1f, sun: 0xfff0d0, sunI: 2.4, sunAngle: 0.8, hemiSky: 0xd0f0ff, hemiGround: 0x5f8a6a, hemiI: 1.6,
    fog: [60, 210], hills: 0, sideY: -0.9, particles: 'fireflies',
  },
  th_fields: {
    name: 'อยุธยายามเย็น', country: 'th', sky: 0xffb26b, skyTop: 0x6a5acd, ground: 0xb4693e, groundAlt: 0xa05c35, side: 0x7dbb3c,
    a: 0xb5523b, b: 0x8fd14f, c: 0xffcf56, d: 0x5a2e1e, sun: 0xffb36b, sunI: 2.5, sunAngle: 0.28, hemiSky: 0xffc89a, hemiGround: 0x6b5a3a, hemiI: 1.35,
    fog: [55, 200], hills: 1.6, particles: 'lanterns',
  },

  // ── China ─────────────────────────────────────────────────────────────
  cn_wall: {
    name: 'กำแพงเมืองจีน', country: 'cn', sky: 0xdfe9ef, skyTop: 0x5e9ad6, ground: 0x9b9184, groundAlt: 0x8a8174, side: 0x5f8f4e,
    a: 0x8c8274, b: 0xb5ab9c, c: 0xc0392b, d: 0x4a443d, sun: 0xfff3dc, sunI: 2.5, sunAngle: 0.7, hemiSky: 0xdff0ff, hemiGround: 0x6b7a55, hemiI: 1.55,
    fog: [60, 220], hills: 4.5, sideY: -7, particles: 'mist',
  },
  cn_bamboo: {
    name: 'ป่าไผ่หมอกจาง', country: 'cn', sky: 0xd4ead2, skyTop: 0x8cc5a8, ground: 0x8e8a78, groundAlt: 0x7e7a69, side: 0x4f8a3c,
    a: 0x6cae3e, b: 0x2f6b2f, c: 0xc0392b, d: 0x3b3a30, sun: 0xf6ffe0, sunI: 2.0, sunAngle: 0.95, hemiSky: 0xe0ffe8, hemiGround: 0x4a6a3a, hemiI: 1.7,
    fog: [35, 170], hills: 2, particles: 'leaves',
  },
  cn_town: {
    name: 'เมืองโบราณตรุษจีน', country: 'cn', sky: 0xffb38a, skyTop: 0x3a2a6b, ground: 0x8a4b3a, groundAlt: 0x7a4032, side: 0x6d5a4a,
    a: 0xc0392b, b: 0x3a3f47, c: 0xffc93c, d: 0x2b2124, sun: 0xffa36b, sunI: 2.0, sunAngle: 0.25, hemiSky: 0xffc3a0, hemiGround: 0x4a3030, hemiI: 1.4,
    fog: [50, 200], hills: 0.8, particles: 'confetti',
  },
  cn_guilin: {
    name: 'ขุนเขากุ้ยหลิน', country: 'cn', sky: 0xd9eef0, skyTop: 0x6fb3d9, ground: 0xa89f8c, groundAlt: 0x968d7a, side: 0x3e9a8a,
    a: 0x5aa05a, b: 0x2f7d6d, c: 0xe07a3f, d: 0x3a4a3f, sun: 0xfff6e0, sunI: 2.3, sunAngle: 0.65, hemiSky: 0xe0f4ff, hemiGround: 0x4a7a6a, hemiI: 1.6,
    fog: [50, 210], hills: 0, sideY: -0.9, particles: 'mist',
  },

  // ── Japan ─────────────────────────────────────────────────────────────
  jp_sakura: {
    name: 'ถนนซากุระ', country: 'jp', sky: 0xffe6ef, skyTop: 0x7ab8f0, ground: 0xd9c7a8, groundAlt: 0xcbb795, side: 0x8cc06a,
    a: 0xffb7c9, b: 0xff8fb1, c: 0xd7263d, d: 0x4a3328, sun: 0xfff1e6, sunI: 2.5, sunAngle: 0.8, hemiSky: 0xffeaf2, hemiGround: 0x8a9a6a, hemiI: 1.65,
    fog: [60, 220], hills: 1.4, particles: 'petals',
  },
  jp_torii: {
    name: 'อุโมงค์โทริอิ', country: 'jp', sky: 0xffe2c2, skyTop: 0x7fb0d8, ground: 0xb9a990, groundAlt: 0xa99880, side: 0x3f7a3a,
    a: 0xe8461e, b: 0x1a1a1a, c: 0xffd23f, d: 0x2b2b2b, sun: 0xffe0b0, sunI: 2.4, sunAngle: 0.55, hemiSky: 0xfff0d8, hemiGround: 0x5a6a3a, hemiI: 1.55,
    fog: [45, 190], hills: 3, particles: 'leaves',
  },
  jp_tokyo: {
    name: 'โตเกียวยามค่ำ', country: 'jp', sky: 0xff8fa3, skyTop: 0x1d1b4a, ground: 0x2f3040, groundAlt: 0x3a3b4e, side: 0x3a3a48,
    a: 0xf2f2f2, b: 0x3a86ff, c: 0xff006e, d: 0x1a1a24, sun: 0xffb0c0, sunI: 1.5, sunAngle: 0.2, hemiSky: 0x9a8cff, hemiGround: 0x403050, hemiI: 1.45,
    fog: [45, 200], hills: 0.8,
  },
  jp_snow: {
    name: 'หมู่บ้านหิมะ', country: 'jp', sky: 0xd8e4f5, skyTop: 0x5a78b0, ground: 0xeef3fa, groundAlt: 0xdfe8f4, side: 0xf7faff,
    a: 0x6b4a32, b: 0xa8c8f0, c: 0xd7263d, d: 0x3a3f55, sun: 0xffe2c4, sunI: 2.0, sunAngle: 0.4, hemiSky: 0xe0ecff, hemiGround: 0x9aa6c0, hemiI: 1.6,
    fog: [40, 190], hills: 2.2, particles: 'snow',
  },
};

export type MapId = 'thai' | 'china' | 'japan' | 'fable';

export interface MapDef {
  name: string;
  flag: string;
  zones?: BiomeId[]; // fixed order; without it four classic biomes are drawn at random
}

export const MAPS: Record<MapId, MapDef> = {
  thai: { name: 'ไทย', flag: '🇹🇭', zones: ['th_city', 'th_palace', 'th_market', 'th_fields'] },
  china: { name: 'จีน', flag: '🇨🇳', zones: ['cn_wall', 'cn_bamboo', 'cn_town', 'cn_guilin'] },
  japan: { name: 'ญี่ปุ่น', flag: '🇯🇵', zones: ['jp_sakura', 'jp_torii', 'jp_tokyo', 'jp_snow'] },
  fable: { name: 'นิทาน', flag: '🏰' },
};

export const MAP_IDS = Object.keys(MAPS) as MapId[];
export const isMapId = (v: unknown): v is MapId => typeof v === 'string' && v in MAPS;

const CLASSIC: ClassicBiome[] = ['village', 'forest', 'candy', 'harbor', 'snow'];

/** Four biomes for one race, one per BIOME_LENGTH stretch. */
export function pickBiomes(rng: Rng, map: MapId = 'fable'): BiomeId[] {
  const zones = MAPS[map].zones;
  if (zones) return [...zones];
  return rng.shuffle([...CLASSIC]).slice(0, Math.ceil(RACE_LENGTH / BIOME_LENGTH));
}

export const biomeAt = (biomes: BiomeId[], d: number): BiomeId =>
  biomes[Math.min(biomes.length - 1, Math.max(0, Math.floor(d / BIOME_LENGTH)))];
