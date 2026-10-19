// Roadside scenery for the country maps, one 25 m chunk at a time: the road
// surface and its markings, then houses, temples, trees and set pieces that
// make each zone read as a place (Bangkok street, Grand Palace, floating
// market, Ayutthaya; Great Wall, bamboo, lantern town, Guilin; sakura avenue,
// Fushimi Inari, Tokyo by night, a snowed-in village).
import { LANE_WIDTH } from '../config.ts';
import type { Rng } from '../core/rng.ts';
import type { BiomeId, Palette } from '../world/biomes.ts';
import {
  GOLD, ball, bamboo, battlements, blob, boat, buffalo, castle, cedar, chedi, cherryTree, cnHouse, coconutPalm,
  cone, cylinder, foodCart, rod, gassho, karst, kitsune, lanternLine, mountain, pagoda, panda, paddy, pine, powerPole,
  prang, roundTree, shophouse, stiltHouse, stoneLantern, streetLamp, sugarPalm, thaiFlag, thaiHall,
  tokyoBuilding, torii, vending, watchtower, wire, yaksha, zebra, type Batch,
} from './kit.ts';

export const TRACK_HALF = LANE_WIDTH * 1.5 + 0.3;
export const CHUNK = 25;

export interface ChunkCtx extends Batch {
  rng: Rng;
  biome: BiomeId;
  p: Palette;
  d0: number;
  /** True when nothing tall or airborne (pendulum, drops, bounce pads) is near [d0, d1]. */
  clear: (d0: number, d1: number) => boolean;
}

const Z = (d: number) => -d;

/** Ground planes either side, cut along z so they follow the bends. */
function sides(c: ChunkCtx, color: number, y: number, from = TRACK_HALF + 0.4, width = 60) {
  const zc = Z(c.d0 + CHUNK / 2);
  for (const s of [-1, 1]) c.lit.long(color, s * (from + width / 2), y - 0.1, zc, width, 0.2, CHUNK);
}

function road(c: ChunkCtx, color: number, y = -0.1) {
  c.lit.long(color, 0, y, Z(c.d0 + CHUNK / 2), TRACK_HALF * 2, 0.2, CHUNK);
}

/** Dashed lane separators. */
function laneDashes(c: ChunkCtx, color: number, dash = 3, gap = 3) {
  for (let d = 0; d < CHUNK; d += dash + gap) {
    for (const x of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) c.lit.box(color, x, 0.006, Z(c.d0 + d + dash / 2), 0.13, 0.02, dash);
  }
}

function edgeLines(c: ChunkCtx, color: number, x = TRACK_HALF - 0.25) {
  for (const s of [-1, 1]) c.lit.long(color, s * x, 0.006, Z(c.d0 + CHUNK / 2), 0.14, 0.02, CHUNK);
}

/** Thai kerb: alternating red and white blocks. */
function stripedKerb(c: ChunkCtx, a: number, b: number, x = TRACK_HALF + 0.2, h = 0.3, w = 0.4) {
  for (let i = 0; i < CHUNK; i++) {
    for (const s of [-1, 1]) c.lit.box(i % 2 ? a : b, s * x, h / 2 - 0.1, Z(c.d0 + i + 0.5), w, h, 1);
  }
}

function plainKerb(c: ChunkCtx, color: number, x = TRACK_HALF + 0.2, h = 0.3, w = 0.4) {
  for (const s of [-1, 1]) c.lit.long(color, s * x, h / 2 - 0.1, Z(c.d0 + CHUNK / 2), w, h, CHUNK);
}

/** Cross stripes every `step` metres (paving joints, planks, steps). */
function joints(c: ChunkCtx, color: number, step: number, width = 0.12, half = TRACK_HALF - 0.1) {
  for (let d = step / 2; d < CHUNK; d += step) c.lit.box(color, 0, 0.004, Z(c.d0 + d), half * 2, 0.01, width);
}

/** Evenly spaced positions along the chunk with a little jitter. */
function along(c: ChunkCtx, step: number, jitter: number, fn: (d: number) => void) {
  for (let d = c.rng.range(0, step); d < CHUNK; d += step + c.rng.range(-jitter, jitter)) fn(c.d0 + d);
}

// ── Thailand ────────────────────────────────────────────────────────────
function thCity(c: ChunkCtx) {
  const { lit, rng, p } = c;
  road(c, p.ground);
  laneDashes(c, 0xf4f4f4);
  edgeLines(c, 0xffd23f);
  stripedKerb(c, 0xd62828, 0xf4f4f4);
  // Sidewalk with tiles, then the shophouse row.
  const zc = Z(c.d0 + CHUNK / 2);
  for (const s of [-1, 1]) {
    lit.long(0xb9b3a8, s * 5.95, 0.02, zc, 3.6, 0.24, CHUNK);
    for (let d = 0.6; d < CHUNK; d += 1.2) lit.box(0xa59f94, s * 5.95, 0.15, Z(c.d0 + d), 3.6, 0.01, 0.06);
  }
  sides(c, p.side, 0, 7.75, 40);
  for (const s of [-1, 1]) {
    for (let d = 0; d < CHUNK - 0.1; d += 5) shophouse(c, rng, 7.75, s, Z(c.d0 + d + 2.5), 5);
    // Power poles with the famous tangle of cables to the next pole.
    const poleD = c.d0 + (s < 0 ? 4 : 16);
    const px = s * 4.9;
    const top = powerPole(lit, px, Z(poleD), s);
    for (let k = 0; k < 5; k++) {
      wire(lit, 0x1a1a1a, px - s * (0.2 + k * 0.15), top - k * 0.12, Z(poleD), px - s * (0.2 + k * 0.15), top - k * 0.12, Z(poleD + CHUNK), 0.5 + k * 0.12, 0.025);
    }
    if (rng.chance(0.5)) foodCart(lit, rng, s * 6.6, Z(c.d0 + rng.range(6, 12)));
    if (rng.chance(0.6)) thaiFlag(lit, s * 4.5, Z(c.d0 + 10), 5.5, rng.chance(0.4));
  }
  // Towers rising behind the shophouses.
  for (const s of [-1, 1]) {
    if (!rng.chance(0.45)) continue;
    const x = s * rng.range(30, 45), z = Z(c.d0 + rng.range(0, CHUNK)), h = rng.range(30, 70), w = rng.range(8, 14);
    lit.box(rng.pick([0x9fb6c9, 0xb8c6d2, 0x8aa3b8, 0xd0d6dc]), x, h / 2, z, w, h, w);
    for (let y = 4; y < h - 2; y += 3.2) c.glow.box(0xcfe8ff, x - s * (w / 2 + 0.02), y, z, 0.04, 1.2, w * 0.8);
  }
}

function thPalace(c: ChunkCtx) {
  const { lit, rng, p } = c;
  road(c, p.ground);
  // Checkered marble paving.
  for (let d = 0; d < CHUNK; d += 1.5) {
    for (let i = 0; i < 5; i++) {
      if ((Math.floor(d / 1.5) + i) % 2) lit.box(p.groundAlt, -TRACK_HALF + 0.75 + i * 1.5, 0.003, Z(c.d0 + d + 0.75), 1.5, 0.01, 1.5);
    }
  }
  plainKerb(c, 0xd6c79f, TRACK_HALF + 0.2, 0.22);
  sides(c, p.side, 0, TRACK_HALF + 0.4, 50);
  const zc = Z(c.d0 + CHUNK / 2);
  // White crenellated palace walls with a gold band.
  for (const s of [-1, 1]) {
    const wx = s * 9.5;
    lit.long(0xfbf8f0, wx, 1.6, zc, 0.8, 3.2, CHUNK);
    lit.long(GOLD, wx - s * 0.42, 2.7, zc, 0.06, 0.25, CHUNK);
    lit.long(0xd9480f, wx - s * 0.42, 0.25, zc, 0.06, 0.5, CHUNK);
    for (let d = 0.5; d < CHUNK; d += 1.25) lit.box(0xfbf8f0, wx, 3.45, Z(c.d0 + d), 0.8, 0.5, 0.6);
    // Topiary and gold lamp posts inside the wall.
    along(c, 6.25, 0.5, (d) => {
      blob(lit, rng.pick([0x2e7d32, 0x388e3c]), s * rng.range(6, 7.6), 0.9, Z(d), 0.8, 0.9, 0.8, true);
      lit.box(0xe9dfc9, s * 6.8, 0.15, Z(d), 1.4, 0.3, 1.4);
    });
    if (rng.chance(0.7)) {
      const d = c.d0 + rng.range(3, 22);
      cylinder(lit, GOLD, s * 5.0, 0, Z(d), 0.08, 3.4, 8);
      c.glow.box(0xfff1c4, s * 5.0, 3.6, Z(d), 0.35, 0.45, 0.35);
      cone(lit, GOLD, s * 5.0, 3.85, Z(d), 0.25, 0.6, 6);
    }
  }
  // Behind the wall: halls, golden chedis and prangs.
  for (const s of [-1, 1]) {
    const r = rng.next();
    if (r < 0.45) thaiHall(lit, s * rng.range(17, 21), Z(c.d0 + 12.5), rng.range(8, 10), rng.range(14, 18));
    else if (r < 0.8) chedi(lit, s * rng.range(16, 24), Z(c.d0 + rng.range(5, 20)), rng.range(18, 28));
    else prang(lit, s * rng.range(16, 22), Z(c.d0 + rng.range(5, 20)), rng.range(16, 24), 0xf1e9da, 0xd9480f);
    if (rng.chance(0.4)) chedi(lit, s * rng.range(28, 40), Z(c.d0 + rng.range(0, 25)), rng.range(14, 22), 0xf7f1e3, GOLD);
  }
  // Yaksha guardians stand in pairs now and then.
  if (rng.chance(0.3)) {
    const d = c.d0 + rng.range(5, 20);
    const body = rng.pick([0x2a9d8f, 0xd62828, 0x3a86ff, 0x6a994e]);
    yaksha(lit, -5.6, Z(d), 5.2, body, 1);
    yaksha(lit, 5.6, Z(d), 5.2, body, -1);
  }
}

function thMarket(c: ChunkCtx) {
  const { lit, rng, p } = c;
  const waterY = -0.9;
  road(c, p.ground, -0.12);
  joints(c, p.groundAlt, 0.6, 0.05, TRACK_HALF);
  plainKerb(c, p.a, TRACK_HALF + 0.15, 0.25, 0.3);
  // Pier posts and the khlong.
  for (const s of [-1, 1]) for (let d = 2; d < CHUNK; d += 4) cylinder(lit, 0x4a3324, s * TRACK_HALF, waterY - 0.5, Z(c.d0 + d), 0.2, 0.8, 6);
  sides(c, 0x3f9e8a, waterY, TRACK_HALF + 0.3, 16);
  for (const s of [-1, 1]) for (let d = 3; d < CHUNK; d += 7) lit.box(0x62b8a6, s * rng.range(6, 16), waterY + 0.01, Z(c.d0 + d), rng.range(2, 4), 0.02, 0.15);
  sides(c, 0x6aa34a, -0.2, TRACK_HALF + 16.3, 40);
  for (const s of [-1, 1]) {
    c.lit.long(0x8a6a4a, s * (TRACK_HALF + 16.3), -0.5, Z(c.d0 + CHUNK / 2), 0.8, 1.0, CHUNK);
    along(c, 7, 1.5, (d) => boat(lit, rng, s * rng.range(5.6, 9), waterY - 0.15, Z(d), rng.range(3.5, 5), rng.chance(0.7)));
    if (rng.chance(0.75)) stiltHouse(c, rng, s * rng.range(14, 17), Z(c.d0 + rng.range(5, 20)), s, waterY);
    along(c, 9, 2, (d) => coconutPalm(lit, rng, s * rng.range(20, 30), Z(d), rng.range(7, 11), s * rng.range(0.05, 0.25)));
    if (rng.chance(0.5)) roundTree(lit, rng, s * rng.range(24, 34), Z(c.d0 + rng.range(0, 25)), rng.range(6, 9), [0x4f9a3c, 0x3d7f31]);
  }
  // Bunting across the canal.
  if (rng.chance(0.6) && c.clear(c.d0 + 10, c.d0 + 14)) {
    const z = Z(c.d0 + 12);
    wire(lit, 0x333333, -TRACK_HALF - 1.5, 6.8, z, TRACK_HALF + 1.5, 6.8, z, 0.6, 0.02);
    for (const s of [-1, 1]) cylinder(lit, 0x6b4a2b, s * (TRACK_HALF + 1.5), 0, z, 0.1, 7, 6);
    for (let i = 0; i < 9; i++) {
      const t = (i + 0.5) / 9, x = -TRACK_HALF - 1.5 + t * (2 * TRACK_HALF + 3);
      cone(lit, [0xe63946, 0xffd166, 0x06d6a0, 0x118ab2][i % 4], x, 6.8 - Math.sin(t * Math.PI) * 0.6 - 0.75, z, 0.25, 0.6, 6, Math.PI);
    }
  }
}

function thFields(c: ChunkCtx) {
  const { lit, rng, p } = c;
  road(c, p.ground);
  // Tyre ruts and grassy verges.
  for (const x of [-LANE_WIDTH, 0, LANE_WIDTH]) for (const o of [-0.45, 0.45]) lit.long(p.groundAlt, x + o, 0.004, Z(c.d0 + CHUNK / 2), 0.25, 0.01, CHUNK);
  for (const s of [-1, 1]) lit.long(0x6f9e3a, s * (TRACK_HALF + 0.3), 0.02, Z(c.d0 + CHUNK / 2), 0.8, 0.12, CHUNK);
  sides(c, 0x8a6a45, -0.1, TRACK_HALF + 0.7, 50);
  // Rice paddies, some flooded and mirroring the sunset.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const w = rng.range(6, 9);
      const x = s * (TRACK_HALF + 1.5 + i * 9 + w / 2);
      const flooded = rng.chance(0.3);
      paddy(lit, x, Z(c.d0 + 12.5), w, 12, flooded ? 0xffb27a : rng.pick([0x8fd14f, 0x7dbb3c, 0xa4d65e]), -0.05);
      paddy(lit, x, Z(c.d0 + 25 - 0.1), w, 12, rng.pick([0x8fd14f, 0x9ad85a, 0x76b83a]), -0.05);
    }
    along(c, 10, 3, (d) => sugarPalm(lit, rng, s * rng.range(6, 26), Z(d), rng.range(9, 14)));
    if (rng.chance(0.25)) buffalo(lit, s * rng.range(9, 20), Z(c.d0 + rng.range(4, 20)), rng.range(0, 6));
  }
  // Ayutthaya ruins: brick chedis and prangs.
  for (const s of [-1, 1]) {
    if (!rng.chance(0.55)) continue;
    const x = s * rng.range(18, 34), d = c.d0 + rng.range(4, 21);
    if (rng.chance(0.5)) chedi(lit, x, Z(d), rng.range(12, 22), 0xa8553a, 0x7a3a28);
    else prang(lit, x, Z(d), rng.range(14, 20), 0xa8553a, 0x7a3a28);
    for (let i = 0; i < 4; i++) lit.box(0x9a4a32, x + rng.range(-6, 6), 0.6, Z(d + rng.range(-6, 6)), rng.range(1, 3), rng.range(0.6, 1.6), rng.range(0.6, 1.2));
  }
}

// ── China ───────────────────────────────────────────────────────────────
function cnWall(c: ChunkCtx) {
  const { lit, rng, p } = c;
  const drop = p.sideY ?? -7;
  road(c, p.ground);
  // Brick courses across the walkway.
  joints(c, p.groundAlt, 1.0, 0.08);
  for (let d = 0.5; d < CHUNK; d += 2) for (let i = -2; i <= 2; i++) lit.box(p.groundAlt, i * 1.5 + ((d * 2) % 2 ? 0.75 : 0), 0.004, Z(c.d0 + d), 0.06, 0.01, 1.0);
  for (const s of [-1, 1]) {
    battlements(lit, s * (TRACK_HALF + 0.3), Z(c.d0), CHUNK, s, p.b, p.d);
    // The wall body falls away to the valley.
    lit.long(p.a, s * (TRACK_HALF + 0.9), drop / 2, Z(c.d0 + CHUNK / 2), 1.2, -drop, CHUNK);
    lit.long(p.d, s * (TRACK_HALF + 1.52), drop / 2, Z(c.d0 + CHUNK / 2), 0.05, -drop - 0.4, CHUNK);
  }
  sides(c, 0x5f8f4e, drop, TRACK_HALF + 1.5, 50);
  for (const s of [-1, 1]) {
    along(c, 8, 2, (d) => roundTree(lit, rng, s * rng.range(8, 16), Z(d), rng.range(5, 8), [0x4f8a4a, 0x3f7a42, 0x5f9a55], 0x6b4a2b, drop));
    // Hills right beside the wall make it feel like a ridge.
    if (rng.chance(0.7)) mountain(lit, rng, s * rng.range(22, 42), drop, Z(c.d0 + rng.range(0, 25)), rng.range(9, 16), rng.range(10, 22), [0x5f9a55, 0x4f8a4a, 0x6aa060]);
  }
  // A watchtower straddles the wall every so often.
  const towerD = c.d0 + 12.5;
  if (Math.floor(c.d0 / CHUNK) % 4 === 1 && c.clear(towerD - 5, towerD + 5)) watchtower(lit, Z(towerD), TRACK_HALF + 0.6, p.b, p.d);
}

function cnBamboo(c: ChunkCtx) {
  const { lit, rng, p } = c;
  road(c, 0x6f8a52);
  // Irregular stone slabs.
  for (let d = 0.6; d < CHUNK; d += 1.25) {
    for (let i = 0; i < 4; i++) {
      const w = rng.range(1.3, 1.8);
      lit.box(rng.pick([p.ground, p.groundAlt, 0x9a9684]), -TRACK_HALF + 0.95 + i * 1.85 + rng.range(-0.1, 0.1), 0.02, Z(c.d0 + d), w, 0.06, 1.05);
    }
  }
  sides(c, 0x557a3a, 0);
  for (const s of [-1, 1]) {
    along(c, 3.2, 0.8, (d) => {
      const n = rng.int(3, 5);
      const cx = s * rng.range(TRACK_HALF + 1.6, TRACK_HALF + 7);
      for (let i = 0; i < n; i++) {
        bamboo(lit, rng, cx + rng.range(-0.8, 0.8), Z(d + rng.range(-0.8, 0.8)), rng.range(9, 15), -s * rng.range(0, 0.12), rng.range(-0.05, 0.05));
      }
    });
    along(c, 6, 1.5, (d) => bamboo(lit, rng, s * rng.range(12, 22), Z(d), rng.range(10, 16), rng.range(-0.08, 0.08)));
    if (rng.chance(0.25)) panda(lit, s * (TRACK_HALF + 1.4), Z(c.d0 + rng.range(4, 21)), 0.9, s > 0 ? -0.6 : 0.6);
    if (rng.chance(0.35)) {
      const x = s * (TRACK_HALF + 1.2), z = Z(c.d0 + rng.range(4, 21));
      cylinder(lit, 0x8f8a80, x, 0, z, 0.3, 1.2, 6);
      c.glow.box(0xffd27a, x, 1.4, z, 0.35, 0.3, 0.35);
      lit.eaves(0x6d6a66, x, 1.55, z, 0.9, 0.9, 0.4);
    }
    for (let i = 0; i < 3; i++) blob(lit, rng.pick([0x8f8a80, 0x7f7a70]), s * rng.range(TRACK_HALF + 0.6, TRACK_HALF + 3), 0.1, Z(c.d0 + rng.range(0, 25)), rng.range(0.3, 0.7), rng.range(0.2, 0.4));
  }
  // Culms leaning over the path from both sides form a green arch.
  if (rng.chance(0.4)) {
    const d = c.d0 + rng.range(4, 21);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) bamboo(lit, rng, s * (TRACK_HALF + 1.2 + i * 0.5), Z(d + i * 0.6), rng.range(12, 15), -s * 0.32);
  }
}

function cnTown(c: ChunkCtx) {
  const { lit, rng, p } = c;
  road(c, p.ground);
  for (let d = 0.5; d < CHUNK; d += 1) for (let i = 0; i < 5; i++) if ((i + Math.floor(d)) % 2) lit.box(p.groundAlt, -TRACK_HALF + 0.75 + i * 1.5, 0.003, Z(c.d0 + d), 1.5, 0.01, 1);
  plainKerb(c, 0x6d6a66, TRACK_HALF + 0.2, 0.25);
  const zc = Z(c.d0 + CHUNK / 2);
  for (const s of [-1, 1]) lit.long(0x9a8f84, s * 5.3, 0.02, zc, 2.6, 0.24, CHUNK);
  sides(c, p.side, 0, 6.6, 50);
  for (const s of [-1, 1]) {
    for (let d = 0; d < CHUNK - 0.1; d += 6.25) cnHouse(c, rng, 6.6, s, Z(c.d0 + d + 3.125), 6.25);
    if (rng.chance(0.3)) pagoda(c, s * rng.range(24, 34), Z(c.d0 + rng.range(5, 20)), rng.int(5, 7), rng.range(5, 7), 0xb22222, 0x2f3b45, GOLD, true);
  }
  // Lantern strings over the street.
  for (const d of [c.d0 + 6, c.d0 + 18.5]) {
    if (!c.clear(d - 1.5, d + 1.5)) continue;
    lanternLine(c, Z(d), 6.4, 6.9);
  }
}

function cnGuilin(c: ChunkCtx) {
  const { lit, rng, p } = c;
  const waterY = p.sideY ?? -0.9;
  road(c, p.ground, -0.1);
  joints(c, p.groundAlt, 1.1, 0.08);
  plainKerb(c, 0x7f7a70, TRACK_HALF + 0.2, 0.35, 0.45);
  for (const s of [-1, 1]) c.lit.long(0x8f8a80, s * (TRACK_HALF + 0.5), (waterY - 0.1) / 2, Z(c.d0 + CHUNK / 2), 0.6, -waterY + 0.1, CHUNK);
  // River on the left, terraces on the right.
  c.lit.long(0x3e9a8a, -(TRACK_HALF + 0.8 + 30), waterY, Z(c.d0 + CHUNK / 2), 60, 0.2, CHUNK);
  for (let d = 3; d < CHUNK; d += 6) lit.box(0x6fc0b0, -rng.range(6, 24), waterY + 0.11, Z(c.d0 + d), rng.range(2, 5), 0.02, 0.15);
  // Terraces stepping up the hillside.
  for (let i = 0; i < 5; i++) {
    const x = TRACK_HALF + 0.8 + i * 5 + 2.5;
    const top = 0.15 + i * 0.9;
    lit.long(0x7a6a50, x, (top - 0.6) / 2, Z(c.d0 + CHUNK / 2), 5, top + 0.6, CHUNK);
    lit.long(rng.pick([0x8fd14f, 0x7dbb3c, 0x9ad85a]), x - 0.2, top + 0.04, Z(c.d0 + CHUNK / 2), 4.6, 0.08, CHUNK);
  }
  if (rng.chance(0.5)) {
    const x = -rng.range(7, 18), z = Z(c.d0 + rng.range(4, 20));
    for (let i = 0; i < 6; i++) cylinder(lit, 0xc9b26b, x - 0.5 + i * 0.2, waterY, z, 0.1, 0.12, 6);
    lit.box(0xc9b26b, x, waterY + 0.12, z, 1.3, 0.12, 4.5);
    lit.box(0x1d3557, x, waterY + 0.7, z + 1.2, 0.35, 0.9, 0.3);
    ball(lit, 0xc68b59, x, waterY + 1.3, z + 1.2, 0.15);
    cone(lit, 0xe9c46a, x, waterY + 1.42, z + 1.2, 0.5, 0.28, 8);
    rod(lit, 0x6b4a2b, x + 0.3, waterY + 0.6, z + 1.0, x + 0.6, waterY + 3.4, z - 1.0, 0.03);
  }
  // Karst towers, close and far.
  for (const s of [-1, 1]) {
    if (rng.chance(0.75)) karst(lit, rng, s * rng.range(28, 45), Z(c.d0 + rng.range(0, 25)), rng.range(6, 10), rng.range(20, 38), s < 0 ? waterY : -0.5);
    if (rng.chance(0.4)) karst(lit, rng, s * rng.range(48, 60), Z(c.d0 + rng.range(0, 25)), rng.range(7, 12), rng.range(26, 45), s < 0 ? waterY : -0.5);
    if (s > 0) along(c, 9, 2, (d) => roundTree(lit, rng, rng.range(26, 30), Z(d), rng.range(4, 7), [0x4f8a4a, 0x5f9a55]));
  }
  if (rng.chance(0.2)) {
    const x = 9, z = Z(c.d0 + 12);
    for (const px of [-1.4, 1.4]) for (const pz of [-1.4, 1.4]) cylinder(lit, 0xb22222, x + px, 4.6, z + pz, 0.13, 2.6, 8);
    lit.box(0x7a6a50, x, 4.5, z, 3.6, 0.2, 3.6);
    lit.eaves(0x2f3b45, x, 7.1, z, 4.6, 4.6, 1.8);
  }
}

// ── Japan ───────────────────────────────────────────────────────────────
function jpSakura(c: ChunkCtx) {
  const { lit, rng, p } = c;
  road(c, p.ground);
  // Raked gravel lines and stone edging.
  for (const x of [-2.4, -1.2, 0, 1.2, 2.4]) lit.long(p.groundAlt, x, 0.004, Z(c.d0 + CHUNK / 2), 0.08, 0.01, CHUNK);
  for (const s of [-1, 1]) for (let d = 0.5; d < CHUNK; d += 1) lit.box(rng.pick([0x9a958c, 0xa8a399, 0x8f8a80]), s * (TRACK_HALF + 0.2), 0.08, Z(c.d0 + d), 0.45, 0.32, 0.95);
  sides(c, p.side, 0);
  // Pink petal drifts on the grass.
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) blob(lit, rng.pick([0xffc6d6, 0xffb7c9, 0xffd6e2]), s * rng.range(TRACK_HALF + 0.9, 10), 0, Z(c.d0 + rng.range(0, 25)), rng.range(0.5, 1.4), 0.04, rng.range(0.5, 1.4), true);
  for (const s of [-1, 1]) {
    along(c, 6.25, 0.8, (d) => cherryTree(lit, rng, s * rng.range(TRACK_HALF + 3, TRACK_HALF + 4.2), Z(d), rng.range(6.5, 8), -s * rng.range(0.3, 0.8)));
    along(c, 8, 2, (d) => cherryTree(lit, rng, s * rng.range(11, 20), Z(d), rng.range(6, 9), 0, true));
    if (rng.chance(0.55)) stoneLantern(c, s * (TRACK_HALF + 1.1), Z(c.d0 + rng.range(2, 23)), 1);
    // Bamboo fence behind the trees.
    lit.long(0xc2a46b, s * 9, 0.6, Z(c.d0 + CHUNK / 2), 0.12, 1.2, CHUNK);
    for (let d = 0.5; d < CHUNK; d += 1.2) cylinder(lit, 0x8b6b3a, s * 9, 0, Z(c.d0 + d), 0.06, 1.35, 6);
    if (rng.chance(0.25)) pagoda(c, s * rng.range(26, 36), Z(c.d0 + rng.range(5, 20)), 5, 5.5, 0xb83a2b, 0x3a3f47, 0xf2ead8);
  }
}

function jpTorii(c: ChunkCtx) {
  const { lit, rng, p } = c;
  road(c, p.ground);
  // Stone steps rhythm.
  joints(c, p.groundAlt, 1.6, 0.25);
  for (const s of [-1, 1]) lit.long(0x6f8a52, s * (TRACK_HALF + 0.4), 0.01, Z(c.d0 + CHUNK / 2), 0.8, 0.1, CHUNK);
  sides(c, 0x3f6a32, 0, TRACK_HALF + 0.8);
  // The tunnel: open stretches let the light in now and then.
  const section = Math.floor(c.d0 / CHUNK) % 5;
  if (section !== 4) {
    for (let d = 1.3; d < CHUNK; d += 2.5) {
      if (!c.clear(c.d0 + d - 0.6, c.d0 + d + 0.6)) continue;
      torii(lit, Z(c.d0 + d), TRACK_HALF + 0.65, 7.6, p.a, p.b);
    }
  }
  for (const s of [-1, 1]) {
    along(c, 3.5, 1, (d) => cedar(lit, rng, s * rng.range(TRACK_HALF + 3, TRACK_HALF + 12), Z(d), rng.range(14, 22)));
    along(c, 5, 1, (d) => roundTree(lit, rng, s * rng.range(14, 26), Z(d), rng.range(7, 11), [0x2f6b2f, 0x3a7d44, 0x245a2a]));
    if (rng.chance(0.4)) kitsune(lit, s * (TRACK_HALF + 1.6), Z(c.d0 + rng.range(3, 22)), s);
    if (rng.chance(0.35)) stoneLantern(c, s * (TRACK_HALF + 1.5), Z(c.d0 + rng.range(3, 22)), 0.9);
  }
}

function jpTokyo(c: ChunkCtx) {
  const { lit, rng, p } = c;
  road(c, p.ground);
  laneDashes(c, 0xe8e8e8, 2.5, 2.5);
  edgeLines(c, 0xf4f4f4);
  if (Math.floor(c.d0 / CHUNK) % 3 === 0) zebra(lit, Z(c.d0 + 12.5), TRACK_HALF - 0.2);
  plainKerb(c, 0x9a9aa6, TRACK_HALF + 0.2, 0.25);
  const zc = Z(c.d0 + CHUNK / 2);
  for (const s of [-1, 1]) {
    lit.long(0x6b6b78, s * 6.1, 0.02, zc, 4, 0.24, CHUNK);
    for (let d = 0.75; d < CHUNK; d += 1.5) lit.box(0x5d5d6a, s * 6.1, 0.15, Z(c.d0 + d), 4, 0.01, 0.05);
  }
  sides(c, p.side, 0, 8.1, 40);
  for (const s of [-1, 1]) {
    let d = 0;
    while (d < CHUNK - 3) {
      const w = Math.min(CHUNK - d, rng.range(6, 10));
      tokyoBuilding(c, rng, 8.1, s, Z(c.d0 + d + w / 2), w);
      d += w;
    }
    streetLamp(c, s * 4.6, Z(c.d0 + (s < 0 ? 5 : 17)), s, 6.5, 0xfff3c4);
    if (rng.chance(0.6)) vending(c, rng, s * 7.6, Z(c.d0 + rng.range(3, 22)), s);
    const top = powerPole(lit, s * 4.9, Z(c.d0 + (s < 0 ? 15 : 3)), s);
    for (let k = 0; k < 3; k++) wire(lit, 0x14141a, s * (4.7 - k * 0.15), top - k * 0.15, Z(c.d0 + (s < 0 ? 15 : 3)), s * (4.7 - k * 0.15), top - k * 0.15, Z(c.d0 + (s < 0 ? 40 : 28)), 0.45, 0.025);
  }
}

function jpSnow(c: ChunkCtx) {
  const { lit, rng, p } = c;
  road(c, p.ground);
  for (const x of [-LANE_WIDTH, 0, LANE_WIDTH]) for (const o of [-0.4, 0.4]) lit.long(0xc9d6e8, x + o, 0.004, Z(c.d0 + CHUNK / 2), 0.3, 0.01, CHUNK);
  // Snowbanks pushed to the edges.
  for (const s of [-1, 1]) for (let d = 0.8; d < CHUNK; d += 1.6) blob(lit, rng.pick([0xffffff, 0xf2f6fc]), s * (TRACK_HALF + 0.55), 0, Z(c.d0 + d), 0.8, rng.range(0.35, 0.55), 1.0, true);
  sides(c, p.side, 0.05);
  for (const s of [-1, 1]) {
    if (rng.chance(0.7)) gassho(c, rng, s * rng.range(12, 16), Z(c.d0 + rng.range(6, 19)), s);
    along(c, 5, 1.5, (d) => pine(lit, rng, s * rng.range(TRACK_HALF + 3, TRACK_HALF + 9), Z(d), rng.range(5, 9), true));
    along(c, 7, 2, (d) => pine(lit, rng, s * rng.range(20, 32), Z(d), rng.range(8, 13), true));
    if (rng.chance(0.5)) stoneLantern(c, s * (TRACK_HALF + 1.4), Z(c.d0 + rng.range(3, 22)), 1, true);
    if (rng.chance(0.3)) mountain(lit, rng, s * rng.range(40, 55), -1, Z(c.d0 + rng.range(0, 25)), rng.range(12, 18), rng.range(14, 26), [0xdfe8f4, 0xc9d6e8], 0.5);
  }
}

const BUILD: Partial<Record<BiomeId, (c: ChunkCtx) => void>> = {
  th_city: thCity, th_palace: thPalace, th_market: thMarket, th_fields: thFields,
  cn_wall: cnWall, cn_bamboo: cnBamboo, cn_town: cnTown, cn_guilin: cnGuilin,
  jp_sakura: jpSakura, jp_torii: jpTorii, jp_tokyo: jpTokyo, jp_snow: jpSnow,
};

/** Build one chunk of a country zone; false for classic biomes. */
export function buildCountryChunk(c: ChunkCtx): boolean {
  const fn = BUILD[c.biome];
  if (!fn) return false;
  fn(c);
  return true;
}

/** One-off landmarks placed once per race (the castle, Fuji-side shrine...). */
export function countryLandmarks(b: Batch, biomes: BiomeId[], zoneStart: (i: number) => number) {
  biomes.forEach((id, i) => {
    const d = zoneStart(i);
    if (id === 'jp_snow') castle(b, -58, Z(d + 260), 1.4);
    if (id === 'cn_town') pagoda(b, 40, Z(d + 300), 9, 9, 0xb22222, 0x2f3b45, GOLD, true);
    if (id === 'th_palace') chedi(b.lit, -44, Z(d + 250), 46);
    if (id === 'th_fields') for (const [x, dd, h] of [[-30, 120, 26], [34, 330, 30]]) prang(b.lit, x, Z(d + dd), h, 0xa8553a, 0x7a3a28);
  });
}

