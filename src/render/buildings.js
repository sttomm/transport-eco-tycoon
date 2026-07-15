// City buildings (glTF set + procedural fallback + facade textures),
// industries, and the placed plant/station meshes. Split out of world.js —
// stays in sync by listening to the 'placed' / 'bulldozed' grid events, and
// owns their per-frame animation (turbine spin, gas smoke, steel glow).
import * as THREE from 'three';
import { G, on } from '../sim/state.js';
import { worldXZ, tileY } from '../sim/grid.js';
import { buildPlantMesh, buildIndustryMesh } from './meshes.js';
import { buildingSet } from './assets.js';
import { rand } from './rng.js';

let scene;
const turbineRotors = [];
const smokeStacks = [];        // gas-plant smoke groups (meshes.js userData.smoke)
const groupOf = new Map();     // placed plant/station ref -> THREE.Group
const industryGroups = new Map(); // industry -> THREE.Group

export function initBuildings(sc) {
  scene = sc;
  buildCityMeshes();
  buildIndustryMeshes();

  on('placed', ref => {
    const g = buildPlantMesh(ref.type);
    const [x, z] = worldXZ(ref.i, ref.j);
    const cx = x + (ref.fp - 1) * G.TILE / 2, cz = z + (ref.fp - 1) * G.TILE / 2;
    g.position.set(cx, tileY(ref.i, ref.j) + 0.02, cz);
    // turbines are authored nacelle-forward on +X (meshes.js / wind_turbine.py);
    // turn the whole placed group 180° so the nacelle/rotor face the camera's
    // usual approach instead of the tower's blind side (WP8, both the glTF and
    // procedural branches go through this same group)
    if (ref.type === 'wind') g.rotation.y = Math.PI;
    scene.add(g);
    groupOf.set(ref, g);
    if (g.userData.rotor) {
      // random initial phase so neighbouring turbines never spin in sync —
      // cosmetic only (no sim meaning), fine to be non-deterministic per load
      g.userData.rotor.rotation.x = Math.random() * Math.PI * 2;
      turbineRotors.push(g.userData.rotor);
    }
    if (g.userData.smoke) smokeStacks.push(g.userData.smoke);
  });
  on('bulldozed', ref => {
    const g = groupOf.get(ref);
    if (!g) return;
    if (g.userData.rotor) {
      const ix = turbineRotors.indexOf(g.userData.rotor);
      if (ix >= 0) turbineRotors.splice(ix, 1);
    }
    if (g.userData.smoke) {
      const ix = smokeStacks.indexOf(g.userData.smoke);
      if (ix >= 0) smokeStacks.splice(ix, 1);
    }
    scene.remove(g);
    groupOf.delete(ref);
  });
}

// ---------- city buildings ----------
export const facadeMats = []; // emissive (lit windows) materials, dimmed by day
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
      const inst = new THREE.InstancedMesh(model.geometry, model.materials, tiles.length);
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

// per-frame animation for everything this module owns
export function updateBuildings(dt) {
  // turbines spin with wind
  const windPow = G.wind;
  const spin = windPow < 0.12 || windPow > 0.96 ? 0 : (0.5 + windPow * 3.2);
  for (const r of turbineRotors) r.rotation.x += spin * dt;

  // gas plant smoke: puffs rise, grow and fade while the plant is dispatched
  const gasOn = G.supply.gas > 0.3;
  for (const smoke of smokeStacks) {
    smoke.visible = gasOn;
    if (!gasOn) continue;
    for (const puff of smoke.children) {
      puff.userData.phase = (puff.userData.phase + dt * 0.35) % 1;
      const t = puff.userData.phase;
      puff.position.set(t * 0.8, t * 3.2, t * 0.4);            // drift up & leeward
      puff.scale.setScalar(0.6 + t * 1.6);
      puff.material.opacity = 0.5 * (1 - t);
    }
  }

  // steel works glow only when running
  for (const ind of G.industries) {
    if (ind.type === 'steel') {
      const glow = industryGroups.get(ind)?.getObjectByName('glow');
      if (glow) glow.material.emissiveIntensity = ind.running ? 1.8 : 0.15;
    }
  }
}
