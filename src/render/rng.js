// Shared cosmetic randomness for the world-render modules (terrain, buildings,
// scatter, infrastructure, ambient). This is ONE sequential stream consumed in
// a fixed order during initWorldRender — reordering any consumer re-scatters
// the whole world (modules with heavy draws use their own salted streams, see
// scatter.js).
//
// Cosmetic randomness only (building heights, tree scatter, water ripples).
// Same seed as the sim so the terrain fbm matches, but a separate rand stream —
// the sim's stream must not depend on what the renderer draws.
import { makeNoise } from '../sim/noise.js';
import { WORLD_SEED } from '../sim/grid.js';

export const noise = makeNoise(WORLD_SEED);
export const { fbm, rand } = noise;

// integer hash → [0,1) — cheap per-pixel grain (micro-normal bake)
export function hash2(x, y) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
