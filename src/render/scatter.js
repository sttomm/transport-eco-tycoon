// Vegetation & decoration scatter: trees (glTF species + procedural
// fallback), WP7 ground scatter (grass tufts, wildflowers, bushes, boulders,
// reeds) and WP8 farm-field patchwork. Split out of world.js — purely visual
// worldgen decoration, reads sim state from G and never mutates it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, on } from '../sim/state.js';
import { makeNoise } from '../sim/noise.js';
import { WORLD_SEED, WATER_Y, heightAt, worldXZ, tile, tileFromWorld } from '../sim/grid.js';
import { M, noCull } from './meshes.js';
import { treeSet } from './assets.js';
import { fbm, rand, hash2 } from './rng.js';

let scene;

export function initScatter(sc) {
  scene = sc;
  buildTrees();
  buildGroundScatter();
  buildFarmFields();
  initConstructionClearing();
}

// ---------- construction clearing (WP7) ----------
// scatter.js is a one-shot builder: trees and ground cover placed at worldgen
// used to clip straight through anything built on top of them later, because
// nothing here ever subscribed to sim events. Every instance registered below
// (trees + ground scatter; farm fields are deliberately NOT tracked — see
// buildFarmFields' comment, they're far from any buildable spot and clipping
// there was already an accepted look) is keyed by its source tile, so a
// 'placed'/'roadBuilt'/'railBuilt' event can hide exactly the instances whose
// tile became occupied — same zero-scale-matrix idiom ambient.js uses to hide
// inactive cars/pedestrians. Save replay re-fires 'placed'/'roadBuilt'/
// 'railBuilt' through place(), so restores clear the same trees for free; no
// sim change, no save bump.
const tileInstances = new Map(); // "i,j" -> [{inst, index}]
const HIDDEN_SCALE = new THREE.Matrix4().makeScale(0, 0, 0);
const clearedTiles = new Set();

function trackInstance(i, j, inst, index) {
  const key = i + ',' + j;
  let arr = tileInstances.get(key);
  if (!arr) tileInstances.set(key, arr = []);
  arr.push({ inst, index });
}

function clearTile(key) {
  if (clearedTiles.has(key)) return;
  const arr = tileInstances.get(key);
  if (!arr) return;
  clearedTiles.add(key);
  const touched = new Set();
  for (const { inst, index } of arr) { inst.setMatrixAt(index, HIDDEN_SCALE); touched.add(inst); }
  for (const inst of touched) inst.instanceMatrix.needsUpdate = true;
}

// 'placed' carries the exact footprint (fp x fp from ref.i/ref.j) — clear
// just those tiles.
function onPlaced(ref) {
  const fp = ref.fp || 1;
  for (let dj = 0; dj < fp; dj++) for (let di = 0; di < fp; di++) clearTile((ref.i + di) + ',' + (ref.j + dj));
}
// 'roadBuilt'/'railBuilt' carry no payload (grid.js just marks the instanced
// layer dirty) — sweep the tiles we actually track and clear any that turned
// into road/rail/occupied since the last sweep. Cheap: bounded by the fixed
// scatter instance count, not the whole 192×192 grid.
function sweepBuiltTiles() {
  for (const key of tileInstances.keys()) {
    if (clearedTiles.has(key)) continue;
    const [i, j] = key.split(',').map(Number);
    const t = tile(i, j);
    if (t && (t.occ || t.t === 'road' || t.t === 'rail')) clearTile(key);
  }
}
function initConstructionClearing() {
  on('placed', onPlaced);
  on('roadBuilt', sweepBuiltTiles);
  on('railBuilt', sweepBuiltTiles);
}

// ---------- trees ----------
function buildTrees() {
  const spots = [];
  for (let j = 1; j < G.N - 1; j++) for (let i = 1; i < G.N - 1; i++) {
    const t = tile(i, j);
    if (t.t !== 'grass' || t.occ) continue;
    if (fbm(i * 0.11 + 40, j * 0.11, 3) > 0.58 && rand() < 0.5) spots.push(t);
  }
  const lib = treeSet();
  if (lib) return buildTreesGLTF(lib, spots);
  buildTreesProcedural(spots);
}

// glTF species (ADR 16): whole forest = one InstancedMesh per species.
// Conifers cluster on high ground, oaks in the lowlands, birches and
// poplars sprinkled in as minority accents.
function buildTreesGLTF(lib, spots) {
  const byName = Object.fromEntries(lib.models.map(m => [m.name, m]));
  const lists = new Map(lib.models.map(m => [m, []]));
  for (const t of spots) {
    const r = rand();
    const conifer = t.h > 1.9 ? 0.75 : 0.35; // altitude bias
    let m;
    if (r < conifer) m = byName.tree_conifer;
    else {
      const rr = (r - conifer) / (1 - conifer); // renormalize remainder to [0, 1)
      m = rr < 0.72 ? byName.tree_oak : rr < 0.90 ? byName.tree_birch : byName.tree_poplar;
    }
    lists.get(m).push(t);
  }
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(),
    s = new THREE.Vector3(), e = new THREE.Euler();
  const col = new THREE.Color();
  for (const [model, tiles] of lists) {
    if (!tiles.length) continue;
    const inst = noCull(new THREE.InstancedMesh(model.geometry, lib.material, tiles.length));
    inst.castShadow = true;
    tiles.forEach((t, k) => {
      const [x, z] = worldXZ(t.i, t.j);
      p.set(x + (rand() - 0.5) * 2.4, t.h, z + (rand() - 0.5) * 2.4);
      e.set(0, rand() * Math.PI * 2, 0);
      q.setFromEuler(e);
      const sc = 0.75 + rand() * 0.6;
      s.set(sc, sc * (0.9 + rand() * 0.25), sc);
      m4.compose(p, q, s);
      inst.setMatrixAt(k, m4);
      trackInstance(t.i, t.j, inst, k);
      const tone = 0.8 + rand() * 0.35;
      col.setRGB(tone, tone * (0.95 + rand() * 0.1), tone * 0.95);
      inst.setColorAt(k, col);
    });
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);
  }
}

function buildTreesProcedural(spots) {
  const trunkG = new THREE.CylinderGeometry(0.12, 0.18, 1, 5);
  const crownG = new THREE.ConeGeometry(0.9, 2.2, 7);
  const trunks = noCull(new THREE.InstancedMesh(trunkG, M('#6b4a32'), spots.length));
  const crowns = noCull(new THREE.InstancedMesh(crownG, M('#3e7d3a'), spots.length));
  crowns.castShadow = true;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const col = new THREE.Color();
  spots.forEach((t, k) => {
    const [x, z] = worldXZ(t.i, t.j);
    const ox = (rand() - 0.5) * 2.4, oz = (rand() - 0.5) * 2.4, sc = 0.8 + rand() * 0.9;
    p.set(x + ox, t.h + 0.5 * sc, z + oz); s.set(sc, sc, sc);
    m.compose(p, q, s); trunks.setMatrixAt(k, m);
    p.y = t.h + (1 + 1.1) * sc; m.compose(p, q, s); crowns.setMatrixAt(k, m);
    trackInstance(t.i, t.j, trunks, k);
    trackInstance(t.i, t.j, crowns, k);
    col.setHSL(0.31 + rand() * 0.06, 0.45, 0.3 + rand() * 0.12);
    crowns.setColorAt(k, col);
  });
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  scene.add(trunks, crowns);
}

// ---------- ground scatter (WP7): grass tufts, wildflower patches, bushes,
// boulders, reeds — cosmetic-only InstancedMesh layers ported from
// lookdev-blender.py's ground-cover prefabs (make_tuft/make_flowers/make_bush/
// make_rock/make_reeds). One InstancedMesh per type; each authored prefab is a
// small merged shape with baked, absolute vertex colours (fixed hues from the
// look-dev palette). Per-instance InstancedMesh.setColorAt is used only for a
// near-neutral brightness jitter (like buildTreesGLTF's tone), never a hue
// swap — a saturated instance tint would multiply through every part of the
// shape uniformly and turn green stems the same colour as a tinted blossom.
//
// Placement draws from a DEDICATED rand stream — the split-stream discipline
// WP6 used for the river spline (own salt off WORLD_SEED). Drawing from the
// shared `rand` above would shift every downstream draw (trees, building
// tint, lamps, ambient life) and re-scatter the whole world the next time
// this file changes.
const scatterNoise = makeNoise(WORLD_SEED ^ 0x5c47a1);
const { rand: srand } = scatterNoise;

// terrain gradient magnitude at a world position — same central-difference
// recipe as lookdev-blender.py's slope_of(), used to bias boulders toward
// steep ground (river shoulders, hillsides), matching WP5's rock-on-slope shader.
function slopeAt(x, z) {
  const e = 0.8;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

// clear, unoccupied grass: excludes roads (city streets AND rural), rail,
// city blocks and every industry/plant/station footprint — all of those set
// tile.occ (grid.js occupy()) or tile.t = 'road', which buildTrees already
// keys off with the same test.
function clearGrassAt(x, z) {
  const [i, j] = tileFromWorld(x, z);
  const t = tile(i, j);
  return !!t && t.t === 'grass' && !t.occ;
}

// draw `count` world positions satisfying `test(x, z, h)`, sampled uniformly
// over the map interior on the dedicated scatter stream
function scatterSpots(count, test, margin = 3) {
  const half = (G.N * G.TILE) / 2 - margin;
  const spots = [];
  let tries = 0;
  const maxTries = count * 60;
  while (spots.length < count && tries < maxTries) {
    tries++;
    const x = (srand() * 2 - 1) * half, z = (srand() * 2 - 1) * half;
    const h = heightAt(x, z);
    if (!test(x, z, h)) continue;
    spots.push({ x, z, h });
  }
  return spots;
}

function vcolor(geo, r, g, b) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) { a[k * 3] = r; a[k * 3 + 1] = g; a[k * 3 + 2] = b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

// thin tapered blade, root at local origin, growing +Y then tilted/placed
function bladeGeo(topR, botR, h, x, z, tiltX, tiltZ) {
  const g = new THREE.CylinderGeometry(topR, botR, h, 5);
  g.translate(0, h / 2, 0);
  g.rotateX(tiltX); g.rotateZ(tiltZ);
  g.translate(x, 0, z);
  return g;
}

// irregular rounded lobe (bush/rock clump) — displaced icosphere, the cheap
// JS analog of lookdev-blender.py's blobify(): a per-vertex hash-noise bump
// so lobes read as rounded-but-irregular rather than perfect spheres.
function lobeGeo(r, x, y, z, sx, sy, sz, seed) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const pos = g.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const vx = pos.getX(k), vy = pos.getY(k), vz = pos.getZ(k);
    const n = hash2(Math.floor((vx + seed) * 37 + 1000), Math.floor((vy + vz + seed) * 53 + 1000)) - 0.5;
    const bump = 1 + n * 0.35;
    pos.setXYZ(k, vx * bump, vy * bump, vz * bump);
  }
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  g.computeVertexNormals();
  return g;
}

// grass tuft: 6 thin blades fanned in a small radial cluster, two look-dev
// greens (tuftm / tuft2m)
const GRASS_TUFT_GEO = (() => {
  const parts = [];
  const cols = [[0.16, 0.36, 0.09], [0.28, 0.44, 0.12]];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const r = 0.05 + (k % 3) * 0.02;
    const h = 0.22 + (k % 3) * 0.06;
    const g = bladeGeo(0.006, 0.045, h, Math.cos(a) * r, Math.sin(a) * r,
      k % 2 ? 0.22 : -0.22, k % 3 ? 0.18 : -0.18);
    vcolor(g, ...cols[k % 2]);
    parts.push(g);
  }
  return mergeGeometries(parts);
})();

// wildflower patch: 7 stems + blossoms, the three look-dev hues (fl_white/
// fl_yellow/fl_red) mixed within one clump so a single InstancedMesh still
// reads as varied ground cover
const WILDFLOWER_GEO = (() => {
  const parts = [];
  const heads = [[0.9, 0.9, 0.85], [0.9, 0.7, 0.12], [0.75, 0.15, 0.12]];
  const stemCol = [0.2, 0.42, 0.12];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.4;
    const r = 0.12 + (k % 2) * 0.14;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const stem = new THREE.CylinderGeometry(0.014, 0.018, 0.22, 4).toNonIndexed(); // match the (inherently non-indexed) icosahedron head so mergeGeometries doesn't reject the mix
    stem.translate(x, 0.11, z);
    vcolor(stem, ...stemCol);
    parts.push(stem);
    const head = new THREE.IcosahedronGeometry(0.05, 0);
    head.translate(x, 0.24, z);
    vcolor(head, ...heads[k % 3]);
    parts.push(head);
  }
  return mergeGeometries(parts);
})();

// bush: 3 overlapping lobes, look-dev leaf tones (leaf1b/leaf2b/birchleaf)
const BUSH_GEO = (() => {
  const parts = [
    lobeGeo(0.36, 0, 0.30, 0, 1, 0.85, 1, 1),
    lobeGeo(0.3, 0.22, 0.24, 0.1, 1, 0.8, 1, 2),
    lobeGeo(0.28, -0.2, 0.22, -0.12, 1, 0.8, 1, 3),
  ];
  const cols = [[0.14, 0.33, 0.08], [0.19, 0.38, 0.10], [0.25, 0.42, 0.12]];
  parts.forEach((g, k) => vcolor(g, ...cols[k]));
  return mergeGeometries(parts);
})();

// boulder: 2 flattened, irregular lobes, look-dev rock tones (rockm/rock2m)
const BOULDER_GEO = (() => {
  const parts = [
    lobeGeo(0.5, 0, 0.22, 0, 1, 0.55, 0.9, 5),
    lobeGeo(0.32, 0.32, 0.14, 0.12, 1, 0.5, 0.85, 8),
  ];
  const cols = [[0.36, 0.35, 0.33], [0.30, 0.28, 0.25]];
  parts.forEach((g, k) => vcolor(g, ...cols[k]));
  return mergeGeometries(parts);
})();

// reed clump: 9 stalks ringing lake + river shores, alternating tufted tops
// (reedm/reedtopm)
const REED_GEO = (() => {
  const parts = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.3;
    const r = 0.14 + (k % 3) * 0.09;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 0.7 + (k % 4) * 0.15;
    const stalk = new THREE.CylinderGeometry(0.014, 0.03, h, 5);
    stalk.translate(x, h / 2, z);
    vcolor(stalk, 0.42, 0.46, 0.18);
    parts.push(stalk);
    if (k % 2 === 0) {
      const top = new THREE.CylinderGeometry(0.05, 0.022, 0.22, 5);
      top.translate(x, h + 0.1, z);
      vcolor(top, 0.48, 0.36, 0.20);
      parts.push(top);
    }
  }
  return mergeGeometries(parts);
})();

function scatterInstances(name, geo, count, test, opts = {}) {
  const { margin = 3, scaleMin = 0.8, scaleMax = 1.5, yOff = -0.02 } = opts;
  const spots = scatterSpots(count, test, margin);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const inst = noCull(new THREE.InstancedMesh(geo, mat, spots.length));
  inst.name = name;
  inst.castShadow = true;
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(),
    s = new THREE.Vector3(), e = new THREE.Euler();
  const col = new THREE.Color();
  spots.forEach((spot, k) => {
    p.set(spot.x, spot.h + yOff, spot.z);
    e.set(0, srand() * Math.PI * 2, 0);
    q.setFromEuler(e);
    const sc = scaleMin + srand() * (scaleMax - scaleMin);
    s.set(sc, sc * (0.85 + srand() * 0.3), sc);
    m4.compose(p, q, s);
    inst.setMatrixAt(k, m4);
    const [ti, tj] = tileFromWorld(spot.x, spot.z);
    trackInstance(ti, tj, inst, k);
    const tone = 0.85 + srand() * 0.3; // near-neutral: brightness jitter only, hue stays the baked vertex colour
    col.setRGB(tone, tone, tone);
    inst.setColorAt(k, col);
  });
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  scene.add(inst);
  return spots.length;
}

function buildGroundScatter() {
  // shore height-band: |h - waterline| test, same idea as the ground
  // shader's sand band — catches both the lake perimeter and the WP6 river
  // banks without needing a dedicated river-distance query
  const REED_LO = WATER_Y - 0.5, REED_HI = WATER_Y + 0.75;
  const clearAndDry = (x, z, h) => h > WATER_Y + 0.15 && clearGrassAt(x, z);

  const counts = {};
  counts.tuft = scatterInstances('scatter_tuft', GRASS_TUFT_GEO, 850, clearAndDry);
  counts.wildflower = scatterInstances('scatter_wildflower', WILDFLOWER_GEO, 140, clearAndDry,
    { scaleMin: 0.75, scaleMax: 1.4 });
  counts.bush = scatterInstances('scatter_bush', BUSH_GEO, 170, clearAndDry,
    { scaleMin: 0.7, scaleMax: 1.5 });
  counts.boulder = scatterInstances('scatter_boulder', BOULDER_GEO, 90, (x, z, h) => {
    if (!clearAndDry(x, z, h)) return false;
    return slopeAt(x, z) > 0.30 || srand() < 0.12;
  }, { scaleMin: 0.6, scaleMax: 1.6 });
  // dense enough that the river banks read as "reeded" from the reference
  // aerial's altitude — 150 spread over every shoreline left the banks bare
  counts.reeds = scatterInstances('scatter_reeds', REED_GEO, 420, (x, z, h) => {
    if (h < REED_LO || h > REED_HI) return false;
    const [i, j] = tileFromWorld(x, z);
    const t = tile(i, j);
    return !!t && !t.occ && (t.t === 'grass' || t.t === 'water');
  }, { scaleMin: 0.85, scaleMax: 1.5, yOff: 0.0, margin: 2 });

  if (typeof window !== 'undefined') window.__scatterCounts = counts; // playtest-game inspection
}

// ---------- farmland patchwork (WP8): fenced crop fields near farm
// industries — ported from lookdev-blender.py's field() (wheat/plow/cabbage
// row strips + post-and-rail perimeter). Purely visual worldgen decoration:
// it never touches tile.occ/tile.t, so it carries no sim meaning and a player
// building over a field later is fine (same as trees/WP7 scatter today).
//
// Own dedicated rand stream (own salt off WORLD_SEED, never the shared `rand`
// or WP7's `srand`) — same split-stream discipline as WP6/WP7, so this layer
// can be added without reshuffling any earlier draw.
const farmNoise = makeNoise(WORLD_SEED ^ 0xa17c33);
const { rand: frand } = farmNoise;

const FIELD_ROW_SPACING = 1.15;     // world units between row strips (look-dev pitch)
const FIELD_FENCE_POST_GAP = 2.4;   // world units between fence posts
// two-tone row palettes, straight from lookdev-blender.py's wheatm/wheat2,
// soilm/soil2m, cabbagem materials
const FIELD_CROPS = {
  wheat: [[0.72, 0.58, 0.24], [0.60, 0.47, 0.18]],
  plow: [[0.34, 0.24, 0.13], [0.28, 0.19, 0.10]],
  cabbage: [[0.22, 0.42, 0.14], [0.34, 0.24, 0.13]],
};
const FENCE_COLOR = [0.35, 0.26, 0.16];

// axis-aligned field footprint (w along X, d along Z) — kept unrotated so the
// exclusion sampling below is a plain grid instead of needing a rotated-rect
// test; still reads as a natural patchwork since size/position/crop all vary
function fieldFootprintClear(cx, cz, w, d) {
  if (heightAt(cx, cz) < WATER_Y + 0.4) return false;
  const stepX = w / Math.ceil(w / 1.6), stepZ = d / Math.ceil(d / 1.6);
  for (let lz = -d / 2; lz <= d / 2 + 1e-6; lz += stepZ) {
    for (let lx = -w / 2; lx <= w / 2 + 1e-6; lx += stepX) {
      if (!clearGrassAt(cx + lx, cz + lz)) return false;
    }
  }
  return true;
}

// push the box specs (rows + perimeter rail + posts) for one field into
// `elements`; every box samples heightAt at its own position so it follows
// the terrain (rows per-row, fence per-side for the rail, per-post for posts)
function addField(elements, cx, cz, w, d, crop) {
  const rows = Math.max(3, Math.round(d / FIELD_ROW_SPACING));
  const colors = FIELD_CROPS[crop];
  for (let k = 0; k < rows; k++) {
    const rz = cz - d / 2 + (k + 0.5) * d / rows;
    const h = heightAt(cx, rz);
    elements.push({ x: cx, y: h + 0.11, z: rz, sx: w - 0.7, sy: 0.22, sz: 0.82, color: colors[k % 2] });
  }
  const sides = [
    { x: cx, z: cz - d / 2, len: w, horiz: true },
    { x: cx, z: cz + d / 2, len: w, horiz: true },
    { x: cx - w / 2, z: cz, len: d, horiz: false },
    { x: cx + w / 2, z: cz, len: d, horiz: false },
  ];
  for (const side of sides) {
    const h = heightAt(side.x, side.z);
    elements.push({
      x: side.x, y: h + 0.62, z: side.z,
      sx: side.horiz ? side.len : 0.07, sy: 0.06, sz: side.horiz ? 0.07 : side.len,
      color: FENCE_COLOR,
    });
    const n = Math.max(1, Math.round(side.len / FIELD_FENCE_POST_GAP));
    for (let k = 0; k <= n; k++) {
      const t = -side.len / 2 + k * side.len / n;
      const px = side.horiz ? side.x + t : side.x, pz = side.horiz ? side.z : side.z + t;
      const ph = heightAt(px, pz);
      elements.push({ x: px, y: ph + 0.37, z: pz, sx: 0.09, sy: 0.75, sz: 0.09, color: FENCE_COLOR });
    }
  }
}

function buildFarmFields() {
  const farms = G.industries.filter(ind => ind.type === 'farm');
  if (!farms.length) return;
  const cropCycle = ['wheat', 'plow', 'cabbage'];
  const half = (G.N * G.TILE) / 2 - 4;
  const placed = []; // {x, z, r} — keeps fields (across every farm) from overlapping
  const elements = [];
  let fieldCount = 0;

  farms.forEach((ind, fi) => {
    const [ax, az] = worldXZ(ind.i, ind.j);
    const fcx = ax + G.TILE / 2, fcz = az + G.TILE / 2; // footprint centre, matches buildIndustryMeshes
    for (let slot = 0; slot < 3; slot++) {
      for (let tries = 0; tries < 18; tries++) {
        const dirAng = frand() * Math.PI * 2;
        const dist = 13 + frand() * 20;
        const cx = fcx + Math.cos(dirAng) * dist, cz = fcz + Math.sin(dirAng) * dist;
        if (Math.abs(cx) > half || Math.abs(cz) > half) continue;
        let w = 9 + frand() * 7, d = 7 + frand() * 5;
        if (frand() < 0.5) [w, d] = [d, w]; // shape variety without rotation math
        const r = Math.max(w, d) / 2;
        if (placed.some(p => Math.hypot(cx - p.x, cz - p.z) < r + p.r + 2)) continue;
        if (!fieldFootprintClear(cx, cz, w, d)) continue;
        const crop = cropCycle[(fi + slot) % 3];
        addField(elements, cx, cz, w, d, crop);
        placed.push({ x: cx, z: cz, r });
        fieldCount++;
        break;
      }
    }
  });
  if (!elements.length) return;

  const geo = vcolor(new THREE.BoxGeometry(1, 1, 1), 1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const inst = noCull(new THREE.InstancedMesh(geo, mat, elements.length));
  inst.name = 'scatter_farmfield';
  inst.castShadow = true;
  inst.receiveShadow = true;
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const col = new THREE.Color();
  elements.forEach((el, k) => {
    p.set(el.x, el.y, el.z);
    s.set(el.sx, el.sy, el.sz);
    m4.compose(p, q, s); // no rotation: fields are axis-aligned
    inst.setMatrixAt(k, m4);
    col.setRGB(...el.color);
    inst.setColorAt(k, col);
  });
  inst.instanceColor.needsUpdate = true;
  scene.add(inst);

  if (typeof window !== 'undefined') window.__farmFieldCount = fieldCount; // playtest-game inspection
}
