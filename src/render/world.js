// World rendering: terrain, water, city buildings, industries, trees,
// roads/rails and ambient life (cars & pedestrians). Reads sim state from G
// and stays in sync by listening to grid events ('placed', 'bulldozed',
// 'roadBuilt', 'railBuilt') — it never mutates sim state.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, on } from '../sim/state.js';
import { makeNoise } from '../sim/noise.js';
import { WORLD_SEED, WATER_Y, heightAt, worldXZ, tile, tileY, isRoad, isRail } from '../sim/grid.js';
import {
  M, Mtex, box, cyl, noCull, canvasTex,
  makeBallastTexture, buildPlantMesh, buildIndustryMesh,
} from './meshes.js';
import { buildingSet, treeSet } from './assets.js';

// Cosmetic randomness only (building heights, tree scatter, water ripples).
// Same seed as the sim so the terrain fbm matches, but a separate rand stream —
// the sim's stream must not depend on what the renderer draws.
const noise = makeNoise(WORLD_SEED);
const { fbm, rand } = noise;

let scene;
let roadMesh, roadDirty = true;
let railBallast, railSegs, railDirty = true;
const ambient = { cars: null, peds: null, carList: [], pedList: [] };
const turbineRotors = [];
const groupOf = new Map();     // placed plant/station ref -> THREE.Group
const industryGroups = new Map(); // industry -> THREE.Group

export function initWorldRender(sc) {
  scene = sc;
  buildTerrainMesh();
  buildWater();
  buildCityMeshes();
  buildIndustryMeshes();
  buildTrees();
  initLamps();
  initRoadMesh();
  initRailMesh();
  initAmbient();

  on('placed', ref => {
    const g = buildPlantMesh(ref.type);
    const [x, z] = worldXZ(ref.i, ref.j);
    const cx = x + (ref.fp - 1) * G.TILE / 2, cz = z + (ref.fp - 1) * G.TILE / 2;
    g.position.set(cx, tileY(ref.i, ref.j) + 0.02, cz);
    scene.add(g);
    groupOf.set(ref, g);
    if (g.userData.rotor) turbineRotors.push(g.userData.rotor);
  });
  on('bulldozed', ref => {
    const g = groupOf.get(ref);
    if (!g) return;
    if (g.userData.rotor) {
      const ix = turbineRotors.indexOf(g.userData.rotor);
      if (ix >= 0) turbineRotors.splice(ix, 1);
    }
    scene.remove(g);
    groupOf.delete(ref);
  });
  on('roadBuilt', () => { roadDirty = true; });
  on('railBuilt', () => { railDirty = true; });
}

// ---------- terrain ----------
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

// ---------- water ----------
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

  // ocean to the horizon: grounds the island and hides the sky dome below
  // the horizon line (the Sky shader produces garbage values down there)
  const ocean = new THREE.Mesh(
    new THREE.CircleGeometry(3500, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#255e88', roughness: 0.55 }), // matte-ish: glossy water mirrors the bright horizon into a white sheet
  );
  ocean.position.y = WATER_Y - 0.06;
  scene.add(ocean);
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

// ---------- city buildings ----------
const facadeMats = []; // emissive (lit windows) materials, dimmed by day
function buildCityMeshes() {
  const lib = buildingSet();
  if (lib) return buildCityMeshesGLTF(lib);
  buildCityMeshesProcedural();
}

// glTF building set (ADR 16): one InstancedMesh per (city, model). Tier by
// distance from the center — towers downtown, low blocks at the edge — with
// jitter; scale/rotation/tint jitter hides the 9-model repetition.
function buildCityMeshesGLTF(lib) {
  facadeMats.push(lib.windowMat); // setNightAmount lights the window cells
  const byTier = { low: [], mid: [], high: [] };
  for (const model of lib.models) byTier[model.tier].push(model);
  const R = 8;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(),
    p = new THREE.Vector3(), e = new THREE.Euler();
  const col = new THREE.Color();
  for (const city of G.cities) {
    const lists = new Map(); // model -> tiles
    for (const t of city.blockTiles) {
      const dist = Math.hypot(t.i - city.ci, t.j - city.cj) / R;
      let tier = dist < 0.34 ? 'high' : dist < 0.72 ? 'mid' : 'low';
      if (rand() < 0.18) tier = tier === 'high' ? 'mid' : 'low'; // break the rings up
      const options = byTier[tier];
      const model = options[Math.floor(rand() * options.length)];
      if (!lists.has(model)) lists.set(model, []);
      lists.get(model).push(t);
    }
    for (const [model, tiles] of lists) {
      const inst = new THREE.InstancedMesh(model.geometry, lib.materials, tiles.length);
      inst.frustumCulled = false;
      inst.castShadow = inst.receiveShadow = true;
      tiles.forEach((t, k) => {
        const [x, z] = worldXZ(t.i, t.j);
        p.set(x, tileY(t.i, t.j) - 0.15, z);
        e.set(0, Math.floor(rand() * 4) * Math.PI / 2, 0);
        q.setFromEuler(e);
        const w = 0.88 + rand() * 0.2;
        s.set(w, 0.94 + rand() * 0.14, w); // near-uniform: y-stretch would smear the windows
        m.compose(p, q, s);
        inst.setMatrixAt(k, m);
        const tone = 0.82 + rand() * 0.18;
        col.setRGB(tone, tone * (0.96 + rand() * 0.06), tone * (0.92 + rand() * 0.1));
        inst.setColorAt(k, col);
      });
      inst.instanceColor.needsUpdate = true;
      scene.add(inst);
    }
  }
}

// procedural fallback (pre-phase-2 look) — kept while types migrate
function buildCityMeshesProcedural() {
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

  const R = 8;
  for (const city of G.cities) {
    const boxes = city.blockTiles.map(t => {
      const dist = Math.hypot(t.i - city.ci, t.j - city.cj) / R;
      return { i: t.i, j: t.j, hgt: (1 - dist) * (6 + rand() * 16) + 2.5, w: G.TILE * (0.62 + rand() * 0.22) };
    });
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
      inst.frustumCulled = false;
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
  }
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
  for (const m of facadeMats) m.emissiveIntensity = n * 4.5; // well above the bloom threshold so lit windows glow
}

// ---------- industries ----------
function buildIndustryMeshes() {
  for (const ind of G.industries) {
    const g = buildIndustryMesh(ind.type);
    const [x, z] = worldXZ(ind.i, ind.j);
    g.position.set(x + G.TILE / 2, tileY(ind.i, ind.j), z + G.TILE / 2);
    scene.add(g);
    industryGroups.set(ind, g);
  }
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
// Conifers cluster on high ground, oaks in the lowlands, poplars sprinkled.
function buildTreesGLTF(lib, spots) {
  const byName = Object.fromEntries(lib.models.map(m => [m.name, m]));
  const lists = new Map(lib.models.map(m => [m, []]));
  for (const t of spots) {
    const r = rand();
    const conifer = t.h > 1.9 ? 0.75 : 0.35; // altitude bias
    const m = r < conifer ? byName.tree_conifer : r < 0.9 ? byName.tree_oak : byName.tree_poplar;
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
    col.setHSL(0.31 + rand() * 0.06, 0.45, 0.3 + rand() * 0.12);
    crowns.setColorAt(k, col);
  });
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  scene.add(trunks, crowns);
}

// ---------- street lamps (city sidewalks, lit at night) ----------
function initLamps() {
  const spots = [];
  for (const city of G.cities) {
    for (const t of city.roadTiles) {
      if (rand() > 0.3) continue;
      const [x, z] = worldXZ(t.i, t.j);
      const sx = rand() < 0.5 ? 1 : -1, sz = rand() < 0.5 ? 1 : -1;
      spots.push([x + sx * (G.TILE / 2 - SIDEWALK_W / 2), tileY(t.i, t.j), z + sz * (G.TILE / 2 - SIDEWALK_W / 2)]);
    }
  }
  if (!spots.length) return;
  const pole = new THREE.CylinderGeometry(0.045, 0.06, 3.0, 6);
  pole.translate(0, 1.5, 0);
  const head = new THREE.SphereGeometry(0.14, 8, 6);
  head.translate(0, 3.05, 0);
  const geo = mergeGeometries([pole, head], true); // 2 groups -> [pole, head] materials
  const headMat = new THREE.MeshStandardMaterial({
    color: '#f5efdf', roughness: 0.4, emissive: '#ffd9a0', emissiveIntensity: 0,
  });
  facadeMats.push(headMat); // setNightAmount switches the lamps on
  const inst = noCull(new THREE.InstancedMesh(geo, [M('#3a4046'), headMat], spots.length));
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  spots.forEach(([x, y, z], k) => {
    p.set(x, y, z);
    m.compose(p, q, s);
    inst.setMatrixAt(k, m);
  });
  scene.add(inst);
}

// ---------- roads (dynamic instanced mesh) ----------
// sidewalk band (light) around the tile edge, asphalt in the middle
export const SIDEWALK_W = 0.5;                    // world units, matches the texture border
function makeAsphaltTexture() {
  return canvasTex(64, (cx, S) => {
    const B = Math.round(S * SIDEWALK_W / G.TILE); // border px
    // sidewalk base with paving grain
    cx.fillStyle = '#8f959b'; cx.fillRect(0, 0, S, S);
    for (let k = 0; k < 250; k++) {
      const v = 125 + Math.random() * 40 | 0;
      cx.fillStyle = `rgba(${v},${v + 3},${v + 5},0.6)`;
      cx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
    // paving slab joints along the border
    cx.strokeStyle = 'rgba(60,64,68,0.4)'; cx.lineWidth = 1;
    for (let k = 0; k < S; k += 8) {
      cx.strokeRect(k, 0, 8, B); cx.strokeRect(k, S - B, 8, B);
      cx.strokeRect(0, k, B, 8); cx.strokeRect(S - B, k, B, 8);
    }
    // asphalt middle
    cx.fillStyle = '#3c4043'; cx.fillRect(B, B, S - 2 * B, S - 2 * B);
    for (let k = 0; k < 500; k++) {
      const v = 50 + Math.random() * 40 | 0;
      cx.fillStyle = `rgba(${v},${v + 4},${v + 6},0.5)`;
      cx.fillRect(B + Math.random() * (S - 2 * B), B + Math.random() * (S - 2 * B), 1.5, 1.5);
    }
    cx.strokeStyle = 'rgba(20,22,24,0.6)'; // curb line
    cx.lineWidth = 1.5;
    cx.strokeRect(B, B, S - 2 * B, S - 2 * B);
  });
}

function initRoadMesh() {
  const geo = new THREE.BoxGeometry(G.TILE, 0.12, G.TILE);
  const mat = new THREE.MeshStandardMaterial({ map: makeAsphaltTexture(), roughness: 0.9 });
  roadMesh = noCull(new THREE.InstancedMesh(geo, mat, 4500));
  roadMesh.receiveShadow = true;
  roadMesh.count = 0;
  scene.add(roadMesh);
  roadDirty = true;
}
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

// ---------- rails (ballast pads + per-connection track segments) ----------
// rails sit on a raised ballast bed: terrain height varies within a tile, so a
// thin pad at tile-center height clips into slopes. The thick bed (top ~0.28
// above tile height) keeps the track visible everywhere.
const BALLAST_H = 0.36, BALLAST_Y = 0.10, RAIL_Y = 0.17, RAIL_CROSSING_Y = 0.07;

function initRailMesh() {
  // square gravel pad per rail tile (skipped on road crossings — rails sit on asphalt there)
  const padGeo = new THREE.BoxGeometry(G.TILE, BALLAST_H, G.TILE);
  railBallast = noCull(new THREE.InstancedMesh(padGeo, new THREE.MeshStandardMaterial({ map: makeBallastTexture(), roughness: 0.95 }), 3000));
  railBallast.receiveShadow = true;
  railBallast.count = 0;
  // half-tile track segment from tile center toward +x: 2 rails + 3 ties, merged
  const parts = [];
  const L = G.TILE / 2;
  for (const z of [-0.55, 0.55]) {
    const r = new THREE.BoxGeometry(L, 0.09, 0.12);
    r.translate(L / 2, 0.17, z);
    parts.push(r);
  }
  for (let k = 0; k < 3; k++) {
    const tie = new THREE.BoxGeometry(0.28, 0.05, 1.6);
    tie.translate(L * (k + 0.5) / 3, 0.11, 0);
    parts.push(tie);
  }
  // vertex tint: rails bright (steel), ties dark (wood) — one material, vertexColors
  parts.forEach((g, gi) => {
    const n = g.attributes.position.count;
    const v = gi < 2 ? 1 : 0.32;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(v), 3));
  });
  const segGeo = mergeGeometries(parts);
  const segMat = new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.45, metalness: 0.55, vertexColors: true });
  railSegs = noCull(new THREE.InstancedMesh(segGeo, segMat, 9000));
  railSegs.castShadow = true;
  railSegs.count = 0;
  scene.add(railBallast, railSegs);
  railDirty = true;
}
function rebuildRails() {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(),
    s = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
  let kp = 0, ks = 0;
  for (const t of G.tiles) {
    if (!t.rail) continue;
    const [x, z] = worldXZ(t.i, t.j);
    const segY = t.h + (t.t === 'road' ? RAIL_CROSSING_Y : RAIL_Y);
    if (t.t !== 'road') {
      p.set(x, t.h + BALLAST_Y, z);
      q.identity();
      m.compose(p, q, s);
      railBallast.setMatrixAt(kp++, m);
    }
    let any = false;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!isRail(t.i + di, t.j + dj)) continue;
      any = true;
      p.set(x, segY, z);
      e.set(0, Math.atan2(-dj, di), 0); q.setFromEuler(e);
      m.compose(p, q, s);
      railSegs.setMatrixAt(ks++, m);
    }
    if (!any) { // isolated tile: draw an east-west stub so it's visible
      for (const yaw of [0, Math.PI]) {
        p.set(x, segY, z);
        e.set(0, yaw, 0); q.setFromEuler(e);
        m.compose(p, q, s);
        railSegs.setMatrixAt(ks++, m);
      }
    }
  }
  railBallast.count = kp;
  railSegs.count = ks;
  railBallast.instanceMatrix.needsUpdate = true;
  railSegs.instanceMatrix.needsUpdate = true;
  railDirty = false;
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
  ambient.cars = noCull(new THREE.InstancedMesh(carGeo, carMat, 160));
  ambient.cars.castShadow = true;

  const pedGeo = new THREE.CapsuleGeometry(0.13, 0.42, 2, 6);
  pedGeo.translate(0, 0.34, 0);
  ambient.peds = noCull(new THREE.InstancedMesh(pedGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), 240));

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

export function updateWorldRender(dt) {
  if (roadDirty) rebuildRoads();
  if (railDirty) rebuildRails();
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
    // walk on the sidewalk: offset perpendicular to the walking direction,
    // onto the light paving band at the tile edge
    const dirx = x1 - x0, dirz = z1 - z0;
    const len = Math.hypot(dirx, dirz);
    const lat = (G.TILE / 2 - SIDEWALK_W / 2 - 0.08) * (p.off > 0 ? 1 : -1) * (1 + Math.abs(p.off) * 0.05);
    const lx = len ? (dirz / len) * lat : lat, lz = len ? (-dirx / len) * lat : 0;
    _p.set(x0 + dirx * p.prog + lx, tileY(p.i, p.j) + 0.13, z0 + dirz * p.prog + lz);
    _q.identity();
    _m.compose(_p, _q, _s);
    ambient.peds.setMatrixAt(k, _m);
  });
  ambient.peds.instanceMatrix.needsUpdate = true;

  // steel works glow only when running
  for (const ind of G.industries) {
    if (ind.type === 'steel') {
      const glow = industryGroups.get(ind)?.getObjectByName('glow');
      if (glow) glow.material.emissiveIntensity = ind.running ? 1.8 : 0.15;
    }
  }
}
