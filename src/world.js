import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, emit } from './state.js';
import { makeNoise } from './noise.js';
import { BUILDINGS, INDUSTRY_TYPES } from './data.js';

const noise = makeNoise(20260612);
const { fbm, rand } = noise;

export const WATER_Y = -0.35;
let scene;
let roadMesh, roadDirty = true;
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
  for (let k = 0; k < pos.count; k++) pos.setY(k, heightAt(pos.getX(k), pos.getZ(k)));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: bakeTerrainTexture(), roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);
}

// integer hash → [0,1) — cheap per-pixel grain
function hash2(x, y) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// Bake a biome texture over the whole map: river bed, wet/dry sand banks,
// mottled grass with dirt patches, striated rock — plus slope shading.
function bakeTerrainTexture() {
  const PX = 1024, S = G.N * G.TILE;
  const cv = document.createElement('canvas');
  cv.width = cv.height = PX;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(PX, PX);
  const d = img.data;
  const C = s => { const c = new THREE.Color(s); return [c.r * 255, c.g * 255, c.b * 255]; };
  const cBedHi = C('#9a9a72'), cBedLo = C('#4e5f55'), cWet = C('#a08a5e'), cSand = C('#d3c494'),
    cGrassA = C('#6fae5c'), cGrassB = C('#558f47'), cDirt = C('#8a7a52'), cRock = C('#9aa0a3'), cRockD = C('#767c80');
  const out = [0, 0, 0];
  const mix = (a, b, t) => { t = Math.max(0, Math.min(1, t)); out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return out; };
  const prevRow = new Float32Array(PX);
  for (let py = 0; py < PX; py++) {
    let left = 0;
    for (let px = 0; px < PX; px++) {
      const x = ((px + 0.5) / PX - 0.5) * S, z = ((py + 0.5) / PX - 0.5) * S;
      const h = heightAt(x, z);
      const slope = py && px ? Math.abs(h - left) + Math.abs(h - prevRow[px]) : 0;
      prevRow[px] = h; left = h;
      const grain = hash2(px, py) - 0.5;            // fine speckle
      let c;
      if (h < WATER_Y + 0.02) {                     // river bed, darker with depth
        c = mix(cBedHi, cBedLo, (WATER_Y - h) / 1.1 + grain * 0.15);
      } else if (h < WATER_Y + 0.24) {              // wet sand at the waterline
        c = mix(cWet, cSand, (h - WATER_Y) / 0.24 * 0.5 + grain * 0.3);
      } else {
        // irregular sand→grass border driven by noise
        const edge = (h - (WATER_Y + 0.65)) / 0.45 + (fbm(x * 0.22 + 31, z * 0.22, 2) - 0.5) * 1.4;
        if (edge < 1) {
          const sandC = mix(cSand, cWet, 0.18 + grain * 0.5);
          if (edge <= 0) c = sandC;
          else {
            const g0 = mix(cGrassA, cGrassB, fbm(x * 0.05 + 9, z * 0.05, 3));
            c = mix([sandC[0], sandC[1], sandC[2]], g0, edge);
          }
        } else {
          // grass: large patches + fine mottling + occasional dirt
          const patch = fbm(x * 0.05 + 9, z * 0.05, 3);
          const mottle = fbm(x * 0.6 + 200, z * 0.6, 2) - 0.5;
          c = mix(cGrassA, cGrassB, patch + mottle * 0.7 + grain * 0.35);
          const dirt = fbm(x * 0.13 + 77, z * 0.13, 3);
          if (dirt > 0.58) c = mix([c[0], c[1], c[2]], cDirt, (dirt - 0.58) * 6 + grain * 0.3);
          if (h > 2.6) { // rocky highland blend with striations
            const stria = Math.sin(h * 7 + fbm(x * 0.3, z * 0.3, 2) * 5) * 0.5 + 0.5;
            const rockC = mix(cRock, cRockD, stria * 0.7 + grain * 0.4);
            c = mix([c[0], c[1], c[2]], rockC, (h - 2.6) / 0.9);
          }
        }
      }
      // slope shading: steeper = darker (fake AO on river banks & hills)
      const shade = 1 - Math.min(0.3, slope * 0.55) + grain * 0.06;
      const k = (py * PX + px) * 4;
      d[k] = c[0] * shade; d[k + 1] = c[1] * shade; d[k + 2] = c[2] * shade; d[k + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

let waterMat, waterGeo, waterTime = 0;
// wave components: [amp, freqX, freqZ, speed]
const WAVES = [
  [0.045, 0.55, 0.22, 1.6],
  [0.035, -0.28, 0.62, 2.1],
  [0.025, 0.95, -0.7, 2.8],
];
function buildWater() {
  const S = G.N * G.TILE, SEG = 110;
  waterGeo = new THREE.PlaneGeometry(S, S, SEG, SEG).rotateX(-Math.PI / 2);
  waterMat = new THREE.MeshPhysicalMaterial({
    color: '#2e7aab', roughness: 0.14, metalness: 0, transparent: true, opacity: 0.84,
    transmission: 0, clearcoat: 1, clearcoatRoughness: 0.08,
    normalMap: makeWaterNormalTexture(), normalScale: new THREE.Vector2(0.5, 0.5),
  });
  waterMat.normalMap.repeat.set(16, 16);
  const mesh = new THREE.Mesh(waterGeo, waterMat);
  mesh.position.y = WATER_Y;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// tileable ripple normal map from a sum of integer-wavenumber sinusoids
function makeWaterNormalTexture() {
  const PX = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = PX;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(PX, PX);
  const comps = [];
  for (let k = 0; k < 9; k++) {
    comps.push({
      a: 1 + Math.floor(rand() * 6), b: 1 + Math.floor(rand() * 6),
      ph: rand() * Math.PI * 2, amp: 0.5 + rand(),
    });
  }
  for (let py = 0; py < PX; py++) for (let px = 0; px < PX; px++) {
    const u = px / PX, v = py / PX;
    let dx = 0, dy = 0;
    for (const c of comps) {
      const arg = Math.PI * 2 * (c.a * u + c.b * v) + c.ph;
      const cs = Math.cos(arg) * c.amp;
      dx += cs * c.a; dy += cs * c.b;
    }
    const k = (py * PX + px) * 4;
    img.data[k] = 128 + Math.max(-127, Math.min(127, dx * 7));
    img.data[k + 1] = 128 + Math.max(-127, Math.min(127, dy * 7));
    img.data[k + 2] = 255;
    img.data[k + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function updateWater(dt) {
  waterTime += dt;
  const t = waterTime;
  const pos = waterGeo.attributes.position, nor = waterGeo.attributes.normal;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    let y = 0, ddx = 0, ddz = 0;
    for (const [a, fx, fz, sp] of WAVES) {
      const arg = x * fx + z * fz + t * sp;
      y += a * Math.sin(arg);
      const c = a * Math.cos(arg);
      ddx += c * fx; ddz += c * fz;
    }
    pos.setY(k, y);
    const inv = 1 / Math.hypot(ddx, 1, ddz);
    nor.setXYZ(k, -ddx * inv, inv, -ddz * inv);
  }
  pos.needsUpdate = nor.needsUpdate = true;
  waterMat.normalMap.offset.set(t * 0.014, t * 0.009);
}

// ---------- cities ----------
const CITY_NAMES = ['Solhaven', 'Windburg', 'Hydrovale'];
const facadeMats = []; // emissive (lit windows) facade materials, dimmed by day
function buildCities() {
  const sites = [[22, 22], [24, 72], [62, 40]];
  // four facade styles, each [sideMat...roofMat] for the box faces
  const styles = ['concrete', 'brick', 'glass', 'plaster'].map(style => {
    const { map, emi, rough, metal } = makeFacadeTexture(style);
    const side = new THREE.MeshStandardMaterial({
      map, roughness: rough, metalness: metal,
      emissive: '#ffd97a', emissiveMap: emi, emissiveIntensity: 0,
    });
    facadeMats.push(side);
    const roof = new THREE.MeshStandardMaterial({ color: style === 'glass' ? '#4a5560' : '#6e6a64', roughness: 0.92 });
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z
    return [side, side, roof, roof, side, side];
  });

  sites.forEach(([ci, cj], idx) => {
    const city = {
      name: CITY_NAMES[idx], ci, cj, idx, pop: 2200 + Math.floor(rand() * 800),
      happiness: 0.7, roadTiles: [], blockTiles: [], food: 0, goods: 0, paxTimer: 0,
      paxLocal: 6, paxTo: [0, 0, 0],   // waiting travellers: within town / to each other city
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
    // instanced buildings for this city, split by facade style
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const byStyle = styles.map(() => []);
    boxes.forEach(b => byStyle[Math.floor(rand() * styles.length)].push(b));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    byStyle.forEach((group, si) => {
      if (!group.length) return;
      const inst = new THREE.InstancedMesh(geo, styles[si], group.length);
      inst.castShadow = inst.receiveShadow = true;
      group.forEach((b, k) => {
        const [x, z] = worldXZ(b.i, b.j);
        p.set(x, tileY(b.i, b.j) - 0.15, z);
        s.set(b.w, b.hgt, b.w);
        m.compose(p, q, s);
        inst.setMatrixAt(k, m);
        const tone = 0.8 + rand() * 0.2;
        col.setRGB(tone, tone * (0.96 + rand() * 0.06), tone * (0.92 + rand() * 0.1));
        inst.setColorAt(k, col);
      });
      inst.instanceColor.needsUpdate = true;
      scene.add(inst);
    });
    G.cities.push(city);
  });
}

// facade texture (day look) + matching emissive map (lit windows at night)
function makeFacadeTexture(style) {
  const W = 128, H = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  const ev = document.createElement('canvas'); ev.width = W; ev.height = H;
  const ex = ev.getContext('2d');
  ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
  let rough = 0.75, metal = 0.05;

  if (style === 'brick') {
    cx.fillStyle = '#9c5a44'; cx.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 6) {
      for (let x = (y / 6) % 2 ? -6 : 0; x < W; x += 12) {
        cx.fillStyle = `rgb(${140 + Math.random() * 35 | 0},${78 + Math.random() * 20 | 0},${58 + Math.random() * 15 | 0})`;
        cx.fillRect(x + 1, y + 1, 10, 4);
      }
    }
  } else if (style === 'glass') {
    cx.fillStyle = '#36444f'; cx.fillRect(0, 0, W, H);
    rough = 0.25; metal = 0.55;
  } else if (style === 'plaster') {
    cx.fillStyle = '#ddd3c2'; cx.fillRect(0, 0, W, H);
    for (let k = 0; k < 900; k++) { // stucco grain
      cx.fillStyle = `rgba(90,80,65,${Math.random() * 0.08})`;
      cx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
  } else { // concrete panels
    cx.fillStyle = '#c4beb2'; cx.fillRect(0, 0, W, H);
    for (let k = 0; k < 700; k++) {
      cx.fillStyle = `rgba(70,70,70,${Math.random() * 0.07})`;
      cx.fillRect(Math.random() * W, Math.random() * H, 3, 3);
    }
  }
  // floors & windows (12 floors, 4 columns)
  const rows = 12, cols = 4, fh = H / rows, fw = W / cols;
  for (let r = 0; r < rows; r++) {
    if (style !== 'glass') { // floor slab line
      cx.fillStyle = 'rgba(0,0,0,0.18)';
      cx.fillRect(0, r * fh, W, 2);
    }
    for (let c = 0; c < cols; c++) {
      const wx = c * fw + fw * 0.2, wy = r * fh + fh * 0.25, ww = fw * 0.6, wh = fh * 0.55;
      if (style === 'glass') {
        cx.fillStyle = `rgba(${120 + Math.random() * 40 | 0},${160 + Math.random() * 40 | 0},${190 + Math.random() * 30 | 0},0.9)`;
        cx.fillRect(c * fw + 2, r * fh + 2, fw - 4, fh - 4);
      } else {
        cx.fillStyle = 'rgba(30,40,55,0.92)';
        cx.fillRect(wx, wy, ww, wh);
        cx.fillStyle = 'rgba(255,255,255,0.25)'; // sill highlight
        cx.fillRect(wx, wy + wh, ww, 1.5);
      }
      if (Math.random() < 0.5) { // lit at night
        ex.fillStyle = Math.random() < 0.8 ? '#ffdc8e' : '#bfe3ff';
        if (style === 'glass') ex.fillRect(c * fw + 2, r * fh + 2, fw - 4, fh - 4);
        else ex.fillRect(wx, wy, ww, wh);
      }
    }
  }
  const mk = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  return { map: mk(cv), emi: new THREE.CanvasTexture(ev), rough, metal };
}

export function setNightAmount(n) { // 0 = day, 1 = night
  for (const m of facadeMats) m.emissiveIntensity = n * 1.6;
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

// tiled stripe texture — corrugated metal walls, wood planks, etc.
export function makeStripeTexture(c1, c2, stripes = 16, vertical = true) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const cx = cv.getContext('2d');
  cx.fillStyle = c1; cx.fillRect(0, 0, 64, 64);
  cx.fillStyle = c2;
  const w = 64 / stripes;
  for (let k = 0; k < stripes; k += 2) {
    if (vertical) cx.fillRect(k * w, 0, w, 64);
    else cx.fillRect(0, k * w, 64, w);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const Mtex = (tex, o = {}) => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, ...o });

function buildIndustryMesh(type) {
  const g = new THREE.Group();
  if (type === 'mine') {
    g.add(box(5, 3, 4, M('#7d7468')));
    const heap = cyl(2.4, 2.6, M('#9c7b60'), -3.4, 0, 1, 0.3);
    g.add(heap);
    g.add(box(0.6, 5, 0.6, M('#5a5550'), 2.5, 0, -1.5));
  } else if (type === 'steel') {
    g.add(box(7, 5, 5, Mtex(makeStripeTexture('#646c78', '#545c68', 22), { metalness: 0.4, roughness: 0.55 })));
    g.add(cyl(0.7, 9, M('#8a929c'), -2, 0, -1.4));
    g.add(cyl(0.7, 8, M('#8a929c'), 0, 0, -1.4));
    const glow = box(2.4, 2.2, 0.4, new THREE.MeshStandardMaterial({ color: '#331a00', emissive: '#ff7a1a', emissiveIntensity: 1.6 }), 1.6, 0.6, 2.55);
    glow.name = 'glow'; g.add(glow);
  } else if (type === 'farm') {
    g.add(box(3.4, 2.4, 2.6, Mtex(makeStripeTexture('#b5483a', '#9e3d31', 10), { roughness: 0.85 }), -1.6, 0, -1));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.4, 4), M('#7a322a'));
    roof.position.set(-1.6, 3.1, -1); roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    g.add(box(6, 0.18, 5, M('#c9b34a'), 1.6, 0, 1.4));
  } else if (type === 'food') {
    g.add(box(5.6, 3.4, 4.2, Mtex(makeStripeTexture('#dde2e7', '#cdd3d9', 22), { roughness: 0.6 })));
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
function makeAsphaltTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#3c4043'; cx.fillRect(0, 0, 64, 64);
  for (let k = 0; k < 600; k++) {
    const v = 50 + Math.random() * 40 | 0;
    cx.fillStyle = `rgba(${v},${v + 4},${v + 6},0.5)`;
    cx.fillRect(Math.random() * 64, Math.random() * 64, 1.5, 1.5);
  }
  cx.strokeStyle = 'rgba(20,22,24,0.55)'; // worn tile edges
  cx.lineWidth = 3;
  cx.strokeRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function initRoadMesh() {
  const geo = new THREE.BoxGeometry(G.TILE, 0.12, G.TILE);
  const mat = new THREE.MeshStandardMaterial({ map: makeAsphaltTexture(), roughness: 0.9 });
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
  // car = body + darker cabin, merged with vertex tints so instance colors only tint the body
  const carBody = new THREE.BoxGeometry(1.5, 0.42, 0.78);
  carBody.translate(0, 0.3, 0);
  const carCab = new THREE.BoxGeometry(0.82, 0.34, 0.72);
  carCab.translate(-0.08, 0.66, 0);
  const tint = (geom, v) => {
    const n = geom.attributes.position.count;
    geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(v), 3));
  };
  tint(carBody, 1); tint(carCab, 0.3);
  const carGeo = mergeGeometries([carBody, carCab]);
  const carMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5, vertexColors: true });
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
  updateWater(dt);
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
