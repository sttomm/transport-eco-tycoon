import * as THREE from 'three';
import { G, emit } from './state.js';
import { makeNoise } from './noise.js';
import { BUILDINGS, INDUSTRY_TYPES } from './data.js';

const noise = makeNoise(20260612);
const { fbm, rand } = noise;

export const WATER_Y = -0.35;
let scene;
let roadMesh, roadDirty = true;
let cityBuildingMat;
let ambient = { cars: null, peds: null, carList: [], pedList: [] };
const turbineRotors = [];

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

function riverX(j) { return G.N * 0.7 + Math.sin(j * 0.075) * 7 + Math.sin(j * 0.021) * 5; }

function heightAt(x, z) {
  const i = x / G.TILE + G.N / 2, j = z / G.TILE + G.N / 2;
  let h = fbm(i * 0.045, j * 0.045, 4) * 7 - 1.6;
  // carve river
  const d = Math.abs(i - riverX(j));
  if (d < 2.2) h = Math.min(h, WATER_Y - 0.7);
  else if (d < 5) h = Math.min(h, WATER_Y - 0.7 + (d - 2.2) * 0.9);
  return h;
}
export function tileY(i, j) { const t = tile(i, j); return t ? t.h : 0; }

// ---------- init ----------
export function initWorld(sc) {
  scene = sc;
  G.tiles = new Array(G.N * G.N);
  for (let j = 0; j < G.N; j++) for (let i = 0; i < G.N; i++) {
    const [x, z] = worldXZ(i, j);
    const h = heightAt(x, z);
    G.tiles[j * G.N + i] = { i, j, t: h < WATER_Y ? 'water' : 'grass', h: Math.max(h, WATER_Y + 0.05), occ: null };
  }
  buildTerrainMesh();
  buildWater();
  buildCities();
  buildIndustries();
  buildTrees();
  initRoadMesh();
  initAmbient();
}

function buildTerrainMesh() {
  const S = G.N * G.TILE, SEG = G.N * 2;
  const geo = new THREE.PlaneGeometry(S, S, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cWater = new THREE.Color('#8a8f6a'), cSand = new THREE.Color('#cbbd8f'),
    cGrass = new THREE.Color('#6fae5c'), cGrass2 = new THREE.Color('#5d9a4e'), cRock = new THREE.Color('#9aa0a3');
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    const h = heightAt(x, z);
    pos.setY(k, h);
    if (h < WATER_Y + 0.08) c.copy(cWater);
    else if (h < WATER_Y + 0.5) c.copy(cSand);
    else if (h > 3.4) c.copy(cRock);
    else c.lerpColors(cGrass, cGrass2, fbm(x * 0.05 + 9, z * 0.05, 3));
    colors[k * 3] = c.r; colors[k * 3 + 1] = c.g; colors[k * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);
}

let waterMat;
function buildWater() {
  const S = G.N * G.TILE;
  waterMat = new THREE.MeshPhysicalMaterial({
    color: '#2a6f9e', roughness: 0.12, metalness: 0, transparent: true, opacity: 0.86,
    transmission: 0, clearcoat: 1, clearcoatRoughness: 0.1,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2), waterMat);
  mesh.position.y = WATER_Y;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// ---------- cities ----------
const CITY_NAMES = ['Solhaven', 'Windburg', 'Hydrovale'];
function buildCities() {
  const sites = [[22, 22], [24, 72], [62, 40]];
  // procedural window texture shared by all buildings
  const tex = makeWindowTexture();
  cityBuildingMat = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 0.6, metalness: 0.15,
    emissive: '#ffd97a', emissiveMap: tex, emissiveIntensity: 0,
  });

  sites.forEach(([ci, cj], idx) => {
    const city = {
      name: CITY_NAMES[idx], ci, cj, pop: 2200 + Math.floor(rand() * 800),
      happiness: 0.7, roadTiles: [], blockTiles: [], food: 0, goods: 0, paxTimer: 0,
    };
    const R = 8;
    const boxes = [];
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
        const dist = Math.hypot(di, dj) / R;
        const hgt = (1 - dist) * (6 + rand() * 16) + 2.5;
        boxes.push({ i, j, hgt, w: G.TILE * (0.62 + rand() * 0.22) });
      }
    }
    // instanced buildings for this city
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const inst = new THREE.InstancedMesh(geo, cityBuildingMat, boxes.length);
    inst.castShadow = inst.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    boxes.forEach((b, k) => {
      const [x, z] = worldXZ(b.i, b.j);
      p.set(x, tileY(b.i, b.j) - 0.15, z);
      s.set(b.w, b.hgt, b.w);
      m.compose(p, q, s);
      inst.setMatrixAt(k, m);
      const tone = 0.72 + rand() * 0.25;
      col.setRGB(tone, tone * (0.96 + rand() * 0.06), tone * (0.92 + rand() * 0.1));
      inst.setColorAt(k, col);
    });
    inst.instanceColor.needsUpdate = true;
    scene.add(inst);
    G.cities.push(city);
  });
}

function makeWindowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#000'; cx.fillRect(0, 0, 128, 128);
  for (let y = 8; y < 120; y += 14) for (let x = 8; x < 120; x += 12) {
    if (Math.random() < 0.55) {
      cx.fillStyle = Math.random() < 0.8 ? '#ffdc8e' : '#bfe3ff';
      cx.fillRect(x, y, 6, 8);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function setNightAmount(n) { // 0 = day, 1 = night
  if (cityBuildingMat) cityBuildingMat.emissiveIntensity = n * 1.6;
}

// ---------- industries ----------
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
      const g = buildIndustryMesh(type);
      const [x, z] = worldXZ(spot[0], spot[1]);
      g.position.set(x + G.TILE / 2, tileY(spot[0], spot[1]), z + G.TILE / 2);
      scene.add(g);
      ind.group = g;
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

// ---------- meshes ----------
const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o });
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function cyl(r, h, mat, x = 0, y = 0, z = 0, rt) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt ?? r, r, h, 16), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function buildIndustryMesh(type) {
  const g = new THREE.Group();
  if (type === 'mine') {
    g.add(box(5, 3, 4, M('#7d7468')));
    const heap = cyl(2.4, 2.6, M('#9c7b60'), -3.4, 0, 1, 0.3);
    g.add(heap);
    g.add(box(0.6, 5, 0.6, M('#5a5550'), 2.5, 0, -1.5));
  } else if (type === 'steel') {
    g.add(box(7, 5, 5, M('#5c6470', { metalness: 0.4 })));
    g.add(cyl(0.7, 9, M('#8a929c'), -2, 0, -1.4));
    g.add(cyl(0.7, 8, M('#8a929c'), 0, 0, -1.4));
    const glow = box(2.4, 2.2, 0.4, new THREE.MeshStandardMaterial({ color: '#331a00', emissive: '#ff7a1a', emissiveIntensity: 1.6 }), 1.6, 0.6, 2.55);
    glow.name = 'glow'; g.add(glow);
  } else if (type === 'farm') {
    g.add(box(3.4, 2.4, 2.6, M('#b5483a'), -1.6, 0, -1));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.4, 4), M('#7a322a'));
    roof.position.set(-1.6, 3.1, -1); roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    g.add(box(6, 0.18, 5, M('#c9b34a'), 1.6, 0, 1.4));
  } else if (type === 'food') {
    g.add(box(5.6, 3.4, 4.2, M('#d8dde2')));
    g.add(cyl(1, 4.6, M('#aeb6bd', { metalness: 0.5 }), 3.4, 0, 0));
    g.add(cyl(1, 4.6, M('#aeb6bd', { metalness: 0.5 }), 3.4, 0, 2.2));
  }
  return g;
}

export function buildPlantMesh(type) {
  const g = new THREE.Group();
  if (type === 'solar') {
    const panel = new THREE.MeshStandardMaterial({ color: '#16263e', roughness: 0.25, metalness: 0.7 });
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
      const p = box(3.0, 0.12, 1.5, panel, (c - 1) * 3.6, 0.7, (r - 1.5) * 2.6);
      p.rotation.x = -0.42;
      g.add(p);
      g.add(cyl(0.08, 0.7, M('#8b8f94'), (c - 1) * 3.6, 0, (r - 1.5) * 2.6));
    }
  } else if (type === 'wind') {
    g.add(cyl(0.55, 14, M('#e8eaec'), 0, 0, 0, 0.3));
    const nac = box(1.6, 0.9, 0.9, M('#dfe2e5'), 0, 13.6, 0); g.add(nac);
    const rotor = new THREE.Group(); rotor.position.set(0.95, 14.05, 0);
    for (let b = 0; b < 3; b++) {
      const blade = box(0.18, 6.2, 0.5, M('#f2f4f6'));
      blade.position.y = 0; blade.geometry.translate(0, 3.1, 0);
      blade.rotation.x = b * Math.PI * 2 / 3;
      rotor.add(blade);
    }
    rotor.rotation.y = Math.PI / 2;
    g.add(rotor); turbineRotors.push(rotor);
    g.userData.rotor = rotor;
  } else if (type === 'hydro') {
    g.add(box(5, 3.2, 4, M('#7e8a93')));
    g.add(box(5.6, 1, 1.4, M('#46708e'), 0, 0, 2.6));
    g.add(cyl(0.5, 4.4, M('#9fa8af'), 1.6, 0, -1));
  } else if (type === 'battery') {
    for (let k = 0; k < 4; k++) g.add(box(3.4, 1.5, 1.2, M(k % 2 ? '#e9edf0' : '#dfe5ea', { metalness: 0.3 }), 0, 0, (k - 1.5) * 1.7));
    g.add(box(1.2, 1.8, 1.2, M('#3a4754'), 2.6, 0, 0));
  } else if (type === 'electrolyzer') {
    for (let k = 0; k < 3; k++) g.add(cyl(0.8, 2.8, M('#3fae9c', { metalness: 0.4, roughness: 0.35 }), (k - 1) * 2.1, 0, 0));
    g.add(box(4.5, 0.25, 0.25, M('#c2c8cd'), 0, 2.6, 0));
    g.add(box(2.4, 1.6, 1.8, M('#dde2e6'), 0, 0, 2.2));
  } else if (type === 'h2tank') {
    const sph = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 18), M('#f1f3f5', { metalness: 0.45, roughness: 0.3 }));
    sph.position.y = 3.1; sph.castShadow = true; g.add(sph);
    for (let k = 0; k < 4; k++) g.add(cyl(0.16, 1.6, M('#9aa1a7'), Math.cos(k * 1.57) * 1.7, 0, Math.sin(k * 1.57) * 1.7));
  } else if (type === 'fuelcell') {
    g.add(box(4.4, 2.6, 3.2, M('#aab6c2', { metalness: 0.35 })));
    for (let k = 0; k < 5; k++) g.add(box(0.18, 2.0, 2.8, M('#7c8896'), -1.8 + k * 0.9, 2.62, 0));
  } else if (type === 'busStop') {
    g.add(box(2.4, 0.12, 1.4, M('#9aa2a8')));
    g.add(cyl(0.07, 2.4, M('#5b6266'), -0.9, 0, -0.4));
    g.add(box(2.2, 0.1, 1.0, M('#3f7fbf'), 0, 2.3, -0.2));
  } else if (type === 'truckStop') {
    g.add(box(3.6, 0.14, 3.6, M('#8d9499')));
    g.add(box(2.6, 1.8, 1.6, M('#c9742e'), 0, 0, -0.9));
    g.add(box(0.5, 1.2, 0.5, M('#4a5560'), 1.4, 0, 1.2)); // charger pillar
  }
  return g;
}

// ---------- trees ----------
function buildTrees() {
  const spots = [];
  for (let j = 1; j < G.N - 1; j++) for (let i = 1; i < G.N - 1; i++) {
    const t = tile(i, j);
    if (t.t !== 'grass' || t.occ) continue;
    if (fbm(i * 0.11 + 40, j * 0.11, 3) > 0.58 && rand() < 0.5) spots.push(t);
  }
  const trunkG = new THREE.CylinderGeometry(0.12, 0.18, 1, 5);
  const crownG = new THREE.ConeGeometry(0.9, 2.2, 7);
  const trunks = new THREE.InstancedMesh(trunkG, M('#6b4a32'), spots.length);
  const crowns = new THREE.InstancedMesh(crownG, M('#3e7d3a'), spots.length);
  crowns.castShadow = true;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const col = new THREE.Color();
  spots.forEach((t, k) => {
    const [x, z] = worldXZ(t.i, t.j);
    const ox = (rand() - 0.5) * 2.4, oz = (rand() - 0.5) * 2.4, sc = 0.8 + rand() * 0.9;
    p.set(x + ox, t.h + 0.5 * sc, z + oz); s.set(sc, sc, sc);
    m.compose(p, q, s); trunks.setMatrixAt(k, m);
    p.y = t.h + (1 + 1.1) * sc; m.compose(p, q, s); crowns.setMatrixAt(k, m);
    col.setHSL(0.31 + rand() * 0.06, 0.45, 0.3 + rand() * 0.12);
    crowns.setColorAt(k, col);
    t.tree = true;
  });
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  scene.add(trunks, crowns);
}

// ---------- roads (dynamic instanced mesh) ----------
function initRoadMesh() {
  const geo = new THREE.BoxGeometry(G.TILE, 0.12, G.TILE);
  const mat = new THREE.MeshStandardMaterial({ color: '#3c4043', roughness: 0.9 });
  roadMesh = new THREE.InstancedMesh(geo, mat, 4500);
  roadMesh.receiveShadow = true;
  roadMesh.count = 0;
  scene.add(roadMesh);
  roadDirty = true;
}
export function refreshRoads() { roadDirty = true; }
function rebuildRoads() {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (const t of G.tiles) {
    if (t.t !== 'road') continue;
    const [x, z] = worldXZ(t.i, t.j);
    p.set(x, t.h + 0.05, z);
    m.compose(p, q, s);
    roadMesh.setMatrixAt(k++, m);
  }
  roadMesh.count = k;
  roadMesh.instanceMatrix.needsUpdate = true;
  roadDirty = false;
}

// ---------- placement ----------
export function canPlace(toolId, i, j) {
  const def = BUILDINGS[toolId];
  if (!def) return false;
  if (toolId === 'bulldoze') {
    const t = tile(i, j);
    return !!t && ((t.t === 'road' && !t.cityStreet) || (t.occ && t.occ.removable));
  }
  if (toolId === 'road') {
    const t = tile(i, j);
    return !!t && (t.t === 'grass' || t.t === 'water') && !t.occ;
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
    t.t = 'road'; if (t.tree) t.tree = false;
    refreshRoads();
    emit('roadBuilt');
    return { kind: 'road' };
  }
  const fp = def.footprint;
  const ref = {
    kind: toolId === 'busStop' || toolId === 'truckStop' ? 'station' : 'plant',
    type: toolId, def, i, j, fp, removable: true,
  };
  occupy(i, j, fp, ref);
  const g = buildPlantMesh(toolId);
  const [x, z] = worldXZ(i, j);
  const cx = x + (fp - 1) * G.TILE / 2, cz = z + (fp - 1) * G.TILE / 2;
  g.position.set(cx, tileY(i, j) + 0.02, cz);
  scene.add(g);
  ref.group = g;
  if (ref.kind === 'plant') {
    G.plants.push(ref);
    if (def.storeMWh) { G.batteryCapMWh += def.storeMWh * G.mult.batteryCap; G.batteryRateMW += def.rateMW; }
    if (def.h2MWh) G.h2CapMWh += def.h2MWh;
    if (def.elecMW) G.elecCapMW += def.elecMW;
    if (def.fcMW) G.fcCapMW += def.fcMW;
    emit('plantBuilt', ref);
  } else {
    ref.cargo = {}; ref.queue = [];
    ref.stype = toolId === 'busStop' ? 'bus' : 'truck';
    G.stations.push(ref);
    emit('stationBuilt', ref);
  }
  return ref;
}

export function bulldoze(i, j) {
  const t = tile(i, j);
  if (!t) return 0;
  if (t.t === 'road' && !t.cityStreet) {
    if (t.bridge) { t.t = 'water'; t.bridge = false; t.h = WATER_Y + 0.05; }
    else t.t = 'grass';
    refreshRoads();
    return BUILDINGS.road.cost * 0.3;
  }
  const occ = t.occ;
  if (occ && occ.removable) {
    free(occ.i, occ.j, occ.fp);
    scene.remove(occ.group);
    if (occ.kind === 'plant') {
      G.plants = G.plants.filter(p => p !== occ);
      const d = occ.def;
      if (d.storeMWh) { G.batteryCapMWh -= d.storeMWh * G.mult.batteryCap; G.batteryRateMW -= d.rateMW; }
      if (d.h2MWh) G.h2CapMWh -= d.h2MWh;
      if (d.elecMW) G.elecCapMW -= d.elecMW;
      if (d.fcMW) G.fcCapMW -= d.fcMW;
      if (occ.group.userData.rotor) {
        const ix = turbineRotors.indexOf(occ.group.userData.rotor);
        if (ix >= 0) turbineRotors.splice(ix, 1);
      }
    } else {
      G.stations = G.stations.filter(s => s !== occ);
      G.routes.forEach(r => r.stops = r.stops.filter(s => s !== occ));
    }
    return occ.def.cost * 0.3;
  }
  return 0;
}

// ---------- ambient life: cars & pedestrians ----------
function initAmbient() {
  const carGeo = new THREE.BoxGeometry(1.5, 0.55, 0.75);
  carGeo.translate(0, 0.35, 0);
  const carMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 });
  ambient.cars = new THREE.InstancedMesh(carGeo, carMat, 160);
  ambient.cars.castShadow = true;

  const pedGeo = new THREE.CapsuleGeometry(0.13, 0.42, 2, 6);
  pedGeo.translate(0, 0.34, 0);
  ambient.peds = new THREE.InstancedMesh(pedGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), 240);

  const carCols = ['#d8dadc', '#2f3338', '#b33a3a', '#3a6fb3', '#c9c94a', '#e0e3e6', '#587158'];
  const pedCols = ['#caa', '#8aa', '#a98', '#99b', '#b89', '#789', '#ba9', '#a89'];
  const col = new THREE.Color();
  for (const city of G.cities) {
    for (let k = 0; k < 40; k++) {
      const t = city.roadTiles[Math.floor(rand() * city.roadTiles.length)];
      ambient.carList.push({ city, i: t.i, j: t.j, ti: t.i, tj: t.j, prog: rand(), speed: 2.2 + rand() * 1.6, active: false });
    }
    for (let k = 0; k < 65; k++) {
      const t = city.roadTiles[Math.floor(rand() * city.roadTiles.length)];
      ambient.pedList.push({
        city, x: 0, z: 0, i: t.i, j: t.j, ti: t.i, tj: t.j, prog: rand(),
        off: (rand() - 0.5) * 2.6, speed: 0.35 + rand() * 0.3, active: false,
      });
    }
  }
  ambient.carList.forEach((c, k) => { col.set(carCols[k % carCols.length]); ambient.cars.setColorAt(k, col); });
  ambient.pedList.forEach((p, k) => { col.set(pedCols[k % pedCols.length]); ambient.peds.setColorAt(k, col); });
  scene.add(ambient.cars, ambient.peds);
}

function pickNextRoad(ci, cj, pi, pj) {
  const opts = [];
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ni = ci + di, nj = cj + dj;
    if (isRoad(ni, nj) && !(ni === pi && nj === pj)) opts.push([ni, nj]);
  }
  if (!opts.length) return [pi, pj];
  return opts[Math.floor(Math.random() * opts.length)];
}

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(),
  _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler(), _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export function updateWorld(dt, gameDt) {
  if (roadDirty) rebuildRoads();
  // turbines spin with wind
  const windPow = G.wind;
  const spin = windPow < 0.12 || windPow > 0.96 ? 0 : (0.5 + windPow * 3.2);
  for (const r of turbineRotors) r.rotation.x += spin * dt;

  // population determines how many ambient agents are visible
  for (const list of [ambient.carList, ambient.pedList]) {
    for (const a of list) {
      const cityFactor = Math.min(1, a.city.pop / 6000);
      a.active = (list.indexOf(a) % list.length) / list.length < cityFactor + 0.35;
    }
  }
  // cars
  ambient.carList.forEach((c, k) => {
    if (!c.active || G.speed === 0) { if (!c.active) ambient.cars.setMatrixAt(k, _hidden); return; }
    c.prog += dt * c.speed * Math.min(G.speed, 3) / G.TILE;
    if (c.prog >= 1) {
      c.prog = 0;
      const [ni, nj] = pickNextRoad(c.ti, c.tj, c.i, c.j);
      c.i = c.ti; c.j = c.tj; c.ti = ni; c.tj = nj;
    }
    const [x0, z0] = worldXZ(c.i, c.j), [x1, z1] = worldXZ(c.ti, c.tj);
    const dirx = x1 - x0, dirz = z1 - z0;
    const lane = 0.9;
    const lx = dirz !== 0 ? Math.sign(dirz) * lane : 0, lz = dirx !== 0 ? -Math.sign(dirx) * lane : 0;
    _p.set(x0 + dirx * c.prog + lx, tileY(c.i, c.j) + 0.12, z0 + dirz * c.prog + lz);
    _e.set(0, Math.atan2(dirx, dirz) + Math.PI / 2, 0); _q.setFromEuler(_e);
    _m.compose(_p, _q, _s);
    ambient.cars.setMatrixAt(k, _m);
  });
  ambient.cars.instanceMatrix.needsUpdate = true;
  // pedestrians walk along sidewalk edges
  ambient.pedList.forEach((p, k) => {
    if (!p.active || G.speed === 0) { if (!p.active) ambient.peds.setMatrixAt(k, _hidden); return; }
    p.prog += dt * p.speed * Math.min(G.speed, 3) / G.TILE;
    if (p.prog >= 1) {
      p.prog = 0;
      // pedestrians drift toward bus stops sometimes
      let target = null;
      if (Math.random() < 0.25 && G.stations.length) {
        const stops = G.stations.filter(s => s.stype === 'bus' && Math.hypot(s.i - p.ti, s.j - p.tj) < 10);
        if (stops.length) target = stops[0];
      }
      let ni, nj;
      if (target) {
        ni = p.ti + Math.sign(target.i - p.ti); nj = p.tj;
        if (!isRoad(ni, nj)) { ni = p.ti; nj = p.tj + Math.sign(target.j - p.tj); }
        if (!isRoad(ni, nj)) [ni, nj] = pickNextRoad(p.ti, p.tj, p.i, p.j);
      } else[ni, nj] = pickNextRoad(p.ti, p.tj, p.i, p.j);
      p.i = p.ti; p.j = p.tj; p.ti = ni; p.tj = nj;
    }
    const [x0, z0] = worldXZ(p.i, p.j), [x1, z1] = worldXZ(p.ti, p.tj);
    _p.set(x0 + (x1 - x0) * p.prog + p.off * 0.7, tileY(p.i, p.j) + 0.1, z0 + (z1 - z0) * p.prog + (p.off > 0 ? 1.6 : -1.6));
    _q.identity();
    _m.compose(_p, _q, _s);
    ambient.peds.setMatrixAt(k, _m);
  });
  ambient.peds.instanceMatrix.needsUpdate = true;

  // steel works glow only when running
  for (const ind of G.industries) {
    if (ind.type === 'steel') {
      const glow = ind.group.getObjectByName('glow');
      if (glow) glow.material.emissiveIntensity = ind.running ? 1.8 : 0.15;
    }
  }
}
