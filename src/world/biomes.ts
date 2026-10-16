import { BIOME_LENGTH, RACE_LENGTH } from '../config.ts';
import type { Rng } from '../core/rng.ts';

export type BiomeId = 'village' | 'forest' | 'candy' | 'harbor' | 'snow';

export interface Palette {
  name: string;
  sky: number;
  ground: number;
  groundAlt: number;
  side: number;
  a: number; // main prop colour
  b: number; // secondary
  c: number; // accent
  d: number; // dark detail
}

export const BIOMES: Record<BiomeId, Palette> = {
  village: { name: 'หมู่บ้านนิทาน', sky: 0x9fd3ff, ground: 0xc2ab8c, groundAlt: 0xb39b7b, side: 0x86b86b, a: 0xa0683a, b: 0xf2e2c4, c: 0xd1495b, d: 0x5c3d2e },
  forest: { name: 'ป่ามหัศจรรย์', sky: 0xbfe3c9, ground: 0x8a7457, groundAlt: 0x7c6a4f, side: 0x4f8f45, a: 0x6b4a2b, b: 0x2f6b2f, c: 0xe63946, d: 0x3b2a1a },
  candy: { name: 'แดนขนมหวาน', sky: 0xffe0ef, ground: 0xf3d2a2, groundAlt: 0xe8c38e, side: 0xffc8dd, a: 0xff70a6, b: 0x70d6ff, c: 0xffd670, d: 0x6f4e37 },
  harbor: { name: 'ท่าเรือโจรสลัด', sky: 0xa8dadc, ground: 0xa47148, groundAlt: 0x936340, side: 0x2a9d8f, a: 0x8d5a34, b: 0xd4a373, c: 0xe63946, d: 0x3d405b },
  snow: { name: 'ภูเขาหิมะ', sky: 0xcfe8ff, ground: 0xe8f1f8, groundAlt: 0xd8e6f2, side: 0xffffff, a: 0x7f5539, b: 0xa2d2ff, c: 0xe63946, d: 0x4a4e69 },
};

/** Four different biomes for one race, one per BIOME_LENGTH stretch. */
export function pickBiomes(rng: Rng): BiomeId[] {
  const ids = rng.shuffle(Object.keys(BIOMES) as BiomeId[]);
  return ids.slice(0, Math.ceil(RACE_LENGTH / BIOME_LENGTH));
}

export const biomeAt = (biomes: BiomeId[], d: number): BiomeId =>
  biomes[Math.min(biomes.length - 1, Math.max(0, Math.floor(d / BIOME_LENGTH)))];
