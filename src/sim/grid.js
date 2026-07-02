// World grid: terrain heights, procedural cities & industries, tile occupancy
// and all placement/bulldoze rules. Pure logic — the renderer listens to the
// events emitted here ('placed', 'bulldozed', 'roadBuilt', 'railBuilt') and
// keeps the Three.js scene in sync.
import { G, emit } from './state.js';
import { makeNoise } from './noise.js';
import { BUILDINGS, INDUSTRY_TYPES } from './data.js';

export const WORLD_SEED = 20260612;
export const WATER_Y = -0.35;

const noise = makeNoise(WORLD_SEED);
const { fbm, rand } = noise;

// ---------- coordinates ----------
export function worldXZ(i, j) {
  return [(i - G.N / 2 + 0.5) * G.TILE, (j - G.N / 2 + 0.5) * G.TILE];
}
export function tileFromWorld(x, z) {
  return [Math.floor(x / G.TILE + G.N / 2), Math.floor(z / G.TILE + G.N / 2)];
}
export function tile(i, j) {
  if (i < 0 || j < 0 || i >= G.N || j >= G.N) return null;
  return G.tiles[j * G.N + i];
}
export function isRoad(i, j) { const t = tile(i, j); return !!t && t.t === 'road'; }
// rail lives in a flag, not the tile type, so a road tile can also carry a level crossing
export function isRail(i, j) { const t = tile(i, j); return !!t && !!t.rail; }

function riverX(j) { return G.N * 0.7 + Math.sin(j * 0.075) * 7 + Math.sin(j * 0.021) * 5; }

export function heightAt(x, z) {
  const i = x / G.TILE + G.N / 2, j = z / G.TILE + G.N / 2;
  let h = fbm(i * 0.045, j * 0.045, 4) * 7 - 1.6;
  // carve river
  const d = Math.abs(i - riverX(j));
  if (d < 2.2) h = Math.min(h, WATER_Y - 0.7);
  else if (d < 5) h = Math.min(h, WATER_Y - 0.7 + (d - 2.2) * 0.9);
  return h;
}
export function tileY(i, j) { const t = tile(i, j); return t ? t.h : 0; }

// ---------- init: terrain grid, cities, industries ----------
export function initGrid() {
  G.tiles = new Array(G.N * G.N);
  for (let j = 0; j < G.N; j++) for (let i = 0; i < G.N; i++) {
    const [x, z] = worldXZ(i, j);
    const h = heightAt(x, z);
    G.tiles[j * G.N + i] = { i, j, t: h < WATER_Y ? 'water' : 'grass', h: Math.max(h, WATER_Y + 0.05), occ: null };
  }
  buildCities();
  buildIndustries();
}

const CITY_NAMES = ['Solhaven', 'Windburg', 'Hydrovale'];
const CITY_SITES = [[22, 22], [24, 72], [62, 40]];

function buildCities() {
  CITY_SITES.forEach(([ci, cj], idx) => {
    const city = {
      name: CITY_NAMES[idx], ci, cj, idx, pop: 2200 + Math.floor(rand() * 800),
      happiness: 0.7, roadTiles: [], blockTiles: [], food: 0, goods: 0, paxTimer: 0,
      foodLevel: 0, goodsLevel: 0,   // recent supply levels (0..1+), decay over days
      paxLocal: 6, paxTo: [0, 0, 0],   // waiting travellers: within town / to each other city
    };
    const R = 8;
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
      const t = tile(i, j);
      if (!t || t.t !== 'grass') continue;
      const di = i - ci, dj = j - cj;
      if (Math.hypot(di, dj) > R + 0.5) continue;
      if (((di % 3) + 3) % 3 === 0 || ((dj % 3) + 3) % 3 === 0) {
        t.t = 'road'; t.cityStreet = true; city.roadTiles.push(t);
      } else {
        if (rand() < 0.12) continue; // little parks
        t.t = 'city'; t.occ = { kind: 'cityBlock', city };
        city.blockTiles.push(t);
      }
    }
    G.cities.push(city);
  });
}

function buildIndustries() {
  const spots = {
    mine: [[78, 14]], steel: [[70, 60]], farm: [[10, 48]], food: [[40, 10]],
  };
  for (const [type, list] of Object.entries(spots)) {
    for (const [i, j] of list) {
      const spot = findFlatNear(i, j, 2);
      if (!spot) continue;
      const def = INDUSTRY_TYPES[type];
      const ind = {
        kind: 'industry', type, def, i: spot[0], j: spot[1],
        stock: 0, inStock: 0, running: false, producedToday: 0,
      };
      occupy(spot[0], spot[1], 2, ind);
      G.industries.push(ind);
    }
  }
}

function findFlatNear(ci, cj, fp) {
  for (let r = 0; r < 8; r++) for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
    if (areaFree(i, j, fp)) return [i, j];
  }
  return null;
}
function areaFree(i, j, fp) {
  for (let dj = 0; dj < fp; dj++) for (let di = 0; di < fp; di++) {
    const t = tile(i + di, j + dj);
    if (!t || t.t !== 'grass' || t.occ) return false;
  }
  return true;
}
function occupy(i, j, fp, ref) {
  for (let dj = 0; dj < fp; dj++) for (let di = 0; di < fp; di++) {
    const t = tile(i + di, j + dj);
    t.occ = ref; if (t.t === 'grass') t.t = 'used';
  }
}
function free(i, j, fp) {
  for (let dj = 0; dj < fp; dj++) for (let di = 0; di < fp; di++) {
    const t = tile(i + di, j + dj);
    if (t) { t.occ = null; if (t.t === 'used') t.t = 'grass'; }
  }
}

// ---------- placement ----------
export function canPlace(toolId, i, j) {
  const def = BUILDINGS[toolId];
  if (!def) return false;
  if (toolId === 'bulldoze') {
    const t = tile(i, j);
    return !!t && !!(t.rail || (t.t === 'road' && !t.cityStreet) || (t.occ && t.occ.removable));
  }
  if (toolId === 'road') {
    const t = tile(i, j);
    return !!t && (t.t === 'grass' || t.t === 'water' || (t.t === 'rail' && !t.bridge)) && !t.occ;
  }
  if (toolId === 'rail') {
    const t = tile(i, j);
    return !!t && !t.rail && (t.t === 'grass' || t.t === 'water' || t.t === 'road') && !t.occ;
  }
  const fp = def.footprint;
  if (!areaFree(i, j, fp)) return false;
  if (def.nearRoad) {
    let ok = false;
    for (let d = -1; d <= fp; d++) {
      if (isRoad(i + d, j - 1) || isRoad(i + d, j + fp) || isRoad(i - 1, j + d) || isRoad(i + fp, j + d)) ok = true;
    }
    if (!ok) return false;
  }
  if (def.nearRail) {
    let ok = false;
    for (let d = -1; d <= fp; d++) {
      if (isRail(i + d, j - 1) || isRail(i + d, j + fp) || isRail(i - 1, j + d) || isRail(i + fp, j + d)) ok = true;
    }
    if (!ok) return false;
  }
  if (def.nearWater) {
    let ok = false;
    for (let dj = -1; dj <= fp; dj++) for (let di = -1; di <= fp; di++) {
      const t = tile(i + di, j + dj);
      if (t && t.t === 'water') ok = true;
    }
    if (!ok) return false;
  }
  return true;
}

export function place(toolId, i, j) {
  const def = BUILDINGS[toolId];
  if (toolId === 'road') {
    const t = tile(i, j);
    if (t.t === 'water') { t.bridge = true; t.h = WATER_Y + 0.55; } // bridge deck over the river
    t.t = 'road';
    emit('roadBuilt');
    if (t.rail) emit('railBuilt'); // became a level crossing — rail layer redraws without ballast
    return { kind: 'road' };
  }
  if (toolId === 'rail') {
    const t = tile(i, j);
    if (t.t === 'water') { t.bridge = true; t.h = WATER_Y + 0.55; t.t = 'rail'; }
    else if (t.t === 'grass') t.t = 'rail';
    // on a road tile, t.t stays 'road' → level crossing
    t.rail = true;
    emit('railBuilt');
    return { kind: 'rail' };
  }
  const STYPE = { busStop: 'bus', truckStop: 'truck', trainStation: 'train' };
  const fp = def.footprint;
  const ref = {
    kind: STYPE[toolId] ? 'station' : 'plant',
    type: toolId, def, i, j, fp, removable: true,
  };
  occupy(i, j, fp, ref);
  if (ref.kind === 'plant') {
    G.plants.push(ref);
    if (def.storeMWh) { G.batteryCapMWh += def.storeMWh * G.mult.batteryCap; G.batteryRateMW += def.rateMW; }
    if (def.h2MWh) G.h2CapMWh += def.h2MWh;
    if (def.elecMW) G.elecCapMW += def.elecMW;
    if (def.fcMW) G.fcCapMW += def.fcMW;
    emit('placed', ref);
    emit('plantBuilt', ref);
  } else {
    ref.cargo = {}; ref.queue = [];
    ref.stype = STYPE[toolId];
    G.stations.push(ref);
    emit('placed', ref);
    emit('stationBuilt', ref);
  }
  return ref;
}

export function bulldoze(i, j) {
  const t = tile(i, j);
  if (!t) return 0;
  if (t.rail) { // remove the rail first; on a crossing the road survives
    t.rail = false;
    if (t.t === 'rail') {
      if (t.bridge) { t.t = 'water'; t.bridge = false; t.h = WATER_Y + 0.05; }
      else t.t = 'grass';
    }
    emit('railBuilt'); // net change to the rail layer → renderer rebuilds it
    return BUILDINGS.rail.cost * 0.3;
  }
  if (t.t === 'road' && !t.cityStreet) {
    if (t.bridge) { t.t = 'water'; t.bridge = false; t.h = WATER_Y + 0.05; }
    else t.t = 'grass';
    emit('roadBuilt');
    return BUILDINGS.road.cost * 0.3;
  }
  const occ = t.occ;
  if (occ && occ.removable) {
    free(occ.i, occ.j, occ.fp);
    if (occ.kind === 'plant') {
      G.plants = G.plants.filter(p => p !== occ);
      const d = occ.def;
      if (d.storeMWh) { G.batteryCapMWh -= d.storeMWh * G.mult.batteryCap; G.batteryRateMW -= d.rateMW; }
      if (d.h2MWh) G.h2CapMWh -= d.h2MWh;
      if (d.elecMW) G.elecCapMW -= d.elecMW;
      if (d.fcMW) G.fcCapMW -= d.fcMW;
    } else {
      G.stations = G.stations.filter(s => s !== occ);
      G.routes.forEach(r => r.stops = r.stops.filter(s => s !== occ));
    }
    emit('bulldozed', occ);
    return occ.def.cost * 0.3;
  }
  return 0;
}

// ---------- build helpers shared by input UI and save/load ----------
// L-shaped drag path between two tiles (leg along i, then along j)
export function lShapedPath(i0, j0, i1, j1) {
  const tiles = [];
  const si = Math.sign(i1 - i0) || 1, sj = Math.sign(j1 - j0) || 1;
  for (let i = i0; i !== i1 + si; i += si) tiles.push([i, j0]);
  for (let j = j0 + sj; (sj > 0 ? j <= j1 : j >= j1); j += sj) tiles.push([i1, j]);
  return tiles;
}
// total cost of a road/rail drag; water tiles become bridges at 5× cost
export function dragCost(tiles, toolId) {
  return tiles.reduce((sum, [i, j]) => sum + BUILDINGS[toolId].cost * (tile(i, j).t === 'water' ? 5 : 1), 0);
}
