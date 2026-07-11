// World rendering: terrain, water, city buildings, industries, trees,
// roads/rails and ambient life (cars & pedestrians). Reads sim state from G
// and stays in sync by listening to grid events ('placed', 'bulldozed',
// 'roadBuilt', 'railBuilt') — it never mutates sim state.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, on } from '../sim/state.js';
import { makeNoise } from '../sim/noise.js';
import { WORLD_SEED, WATER_Y, heightAt, worldXZ, tile, tileFromWorld, tileY, isRoad, isRail } from '../sim/grid.js';
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
let roadDirty = true;
let railBallast, railSegs, railDirty = true;
const ambient = { cars: null, peds: null, carList: [], pedList: [] };
const turbineRotors = [];
const smokeStacks = [];        // gas-plant smoke groups (meshes.js userData.smoke)
const groupOf = new Map();     // placed plant/station ref -> THREE.Group
const industryGroups = new Map(); // industry -> THREE.Group

export function initWorldRender(sc) {
  scene = sc;
  buildTerrainMesh();
  buildWater();
  buildCityMeshes();
  buildIndustryMeshes();
  buildTrees();
  buildGroundScatter();
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
  // Flat base colour + roughness from the Board 07 look-dev terrain node graph;
  // the real biome is computed procedurally in attachGroundShader's fragment
  // chunks, so the material itself carries no baked albedo texture (that big
  // canvas bake was the old "flat look" — it blurred badly at street level).
  const mat = new THREE.MeshStandardMaterial({ color: '#33501f', roughness: 0.92, metalness: 0 });
  attachGroundShader(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);
}

// integer hash → [0,1) — cheap per-pixel grain (micro-normal bake)
function hash2(x, y) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// ---------- procedural ground shader (Board 07 look-dev port) ----------
// The whole biome is a fragment-shader blend keyed off world position, ported
// from lookdev-blender.py's terrain node graph:
//   1. grass patchwork — two greens chosen by a macro noise field,
//   2. dirt breaks     — occasional bare-earth patches from a second noise,
//   3. rock on slopes  — where the geometric up-facing normal drops (look-dev
//      keyed normal.z 0.88→0.72),
//   4. sand at the shore — a height band just above the water plane.
// It is injected as onBeforeCompile chunks on a stock MeshStandardMaterial, so
// three's own fog / shadow-receive / lighting / envmap paths — and the
// screen-space GTAO pass — all run unchanged over the result (they read the
// final normal/depth and multiply fog last; none of that is touched here).
// Every term is a pure function of world XZ / height, so the look is fully
// deterministic from WORLD_SEED: nothing re-randomises per load. A tiling
// normal map supplies the micro bump; a hue-neutral detail texture adds
// close-up grain that fades out with distance so its repeat never shows.
const DETAIL_REPEAT = G.N;                         // micro-normal: one repeat per tile (4 wu)
const DETAIL_UV = 1 / G.TILE;                      // grain sampled per world unit → 1 tile / repeat

function attachGroundShader(mat) {
  const { albedo, normal } = makeGroundDetailMaps();
  mat.normalMap = normal;                          // micro bump (view-space, survives lighting)
  mat.normalScale = new THREE.Vector2(0.4, 0.4);

  mat.onBeforeCompile = shader => {
    shader.uniforms.uGroundDetail = { value: albedo };
    shader.uniforms.uWaterY = { value: WATER_Y };

    // world position varying (independent of the shadow/envmap-conditional
    // worldPosition three may or may not emit)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGroundPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGroundPos;
        uniform sampler2D uGroundDetail;
        uniform float uWaterY;
        float gHash(vec2 p){
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float gNoise(vec2 p){                       // smoothed value noise, [0,1]
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = gHash(i), b = gHash(i + vec2(1.0, 0.0));
          float c = gHash(i + vec2(0.0, 1.0)), d = gHash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float gFbm(vec2 p){
          float s = 0.0, a = 0.5;
          for (int k = 0; k < 4; k++){ s += a * gNoise(p); p *= 2.0; a *= 0.5; }
          return s;
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec2 wp = vGroundPos.xz;
        // geometric slope from world-position derivatives — the true macro
        // surface tilt, unaffected by the micro-bump normal map (y is up, so
        // |faceN.y| == 1 on flat ground, dropping toward 0 on cliffs)
        vec3 faceN = normalize(cross(dFdx(vGroundPos), dFdy(vGroundPos)));
        float upness = abs(faceN.y);

        // 1. grass patchwork: two greens over a macro noise field
        float macro = gNoise(wp * 0.05);
        vec3 col = mix(vec3(0.085, 0.22, 0.05), vec3(0.15, 0.30, 0.085),
                       smoothstep(0.40, 0.60, macro));
        col *= 0.92 + 0.16 * gFbm(wp * 0.35);       // within-patch mottle

        // 2. dirt breaks
        float dirt = gNoise(wp * 0.07 + 13.0);
        col = mix(col, vec3(0.35, 0.25, 0.13), smoothstep(0.60, 0.70, dirt));

        // 3. rock on steep slopes. Look-dev keyed normal.z 0.88 → 0.72, but this
        // world's heightfield is far gentler (min up-facing ~0.80 off-water), so
        // that ramp never fires here; shifted up to stay keyed to the genuinely
        // steepest slopes (river shoulders, hillsides) rather than never showing.
        col = mix(col, vec3(0.33, 0.32, 0.30), 1.0 - smoothstep(0.80, 0.92, upness));

        // 4. sand ringing the shoreline: a height band just above the water,
        // with a noisy edge so the waterline isn't a clean contour
        float above = (vGroundPos.y - uWaterY) + (gNoise(wp * 0.15 + 5.0) - 0.5) * 0.5;
        col = mix(col, vec3(0.52, 0.44, 0.27), 1.0 - smoothstep(0.15, 0.95, above));

        diffuseColor.rgb = col;

        // close-up grain (blade strokes on grass, granules on sand), faded out
        // with distance so the tiling repeat never shows
        float fade = 1.0 - smoothstep(60.0, 170.0, length(vViewPosition));
        if (fade > 0.001) {
          vec3 dA = texture2D(uGroundDetail, wp * ${DETAIL_UV}).rgb;
          vec3 dB = texture2D(uGroundDetail, wp * ${DETAIL_UV / 4.0} + 0.37).rgb;
          diffuseColor.rgb *= mix(vec3(1.0), dA * dB * 4.0, 0.4 * fade);
        }
      }`);
  };
}

// Tiling detail maps, generated once: a value-noise heightfield on wrapped
// lattices (so the texture tiles seamlessly), rendered as neutral-gray albedo
// grain with short blade strokes, plus a normal map derived from the same
// heightfield.
function makeGroundDetailMaps() {
  const S = 256;
  const lattice = (freq, seed) => {
    const L = new Float32Array(freq * freq);
    for (let i = 0; i < freq * freq; i++) L[i] = hash2((i % freq) + seed * 131, (i / freq | 0) + seed * 57);
    return (u, v) => {                             // smoothed bilinear, wrapped
      const x = u * freq, y = v * freq, x0 = Math.floor(x), y0 = Math.floor(y);
      let fx = x - x0, fy = y - y0;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const X0 = x0 % freq, X1 = (x0 + 1) % freq, Y0 = y0 % freq, Y1 = (y0 + 1) % freq;
      const a = L[Y0 * freq + X0], b = L[Y0 * freq + X1], c = L[Y1 * freq + X0], e = L[Y1 * freq + X1];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
    };
  };
  const octs = [[lattice(11, 1), 0.45], [lattice(23, 2), 0.28], [lattice(47, 3), 0.17], [lattice(97, 4), 0.10]];
  const H = new Float32Array(S * S);
  for (let py = 0; py < S; py++)
    for (let px = 0; px < S; px++) {
      const u = px / S, v = py / S;
      let h = 0;
      for (const [n, amp] of octs) h += n(u, v) * amp;
      H[py * S + px] = h;
    }

  // albedo: gray centered on 128 (multiplied ×2 in the shader → mean 1)
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(S, S);
  for (let k = 0; k < S * S; k++) {
    const g = 128 + (H[k] - 0.5) * 110 + (hash2(k, 7) - 0.5) * 40;
    img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = g;
    img.data[k * 4 + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  // short near-vertical strokes: blade hints on grass, drift marks on sand.
  // Each is drawn at 4 wrapped offsets so the texture still tiles.
  for (let s = 0; s < 900; s++) {
    const x = rand() * S, y = rand() * S, len = 2 + rand() * 3, tilt = (rand() - 0.5) * 1.6;
    cx.strokeStyle = rand() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.14)';
    for (const [ox, oy] of [[0, 0], [-S, 0], [0, -S], [-S, -S]]) {
      cx.beginPath();
      cx.moveTo(x + ox, y + oy);
      cx.lineTo(x + ox + tilt, y + oy + len);
      cx.stroke();
    }
  }
  const albedo = new THREE.CanvasTexture(cv);
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.anisotropy = 8;

  // normal map from the heightfield gradient (wrapped central differences)
  const nv = document.createElement('canvas');
  nv.width = nv.height = S;
  const nx = nv.getContext('2d');
  const nimg = nx.createImageData(S, S);
  const K = 2.2;                                   // bump strength
  for (let py = 0; py < S; py++)
    for (let px = 0; px < S; px++) {
      const dx = (H[py * S + (px + 1) % S] - H[py * S + (px + S - 1) % S]) * K;
      const dy = (H[((py + 1) % S) * S + px] - H[((py + S - 1) % S) * S + px]) * K;
      const il = 1 / Math.hypot(dx, dy, 1);
      const k = (py * S + px) * 4;
      nimg.data[k] = (-dx * il * 0.5 + 0.5) * 255;
      nimg.data[k + 1] = (-dy * il * 0.5 + 0.5) * 255;
      nimg.data[k + 2] = (il * 0.5 + 0.5) * 255;
      nimg.data[k + 3] = 255;
    }
  nx.putImageData(nimg, 0, 0);
  const normal = new THREE.CanvasTexture(nv);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.repeat.set(DETAIL_REPEAT, DETAIL_REPEAT);
  return { albedo, normal };
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
  counts.reeds = scatterInstances('scatter_reeds', REED_GEO, 150, (x, z, h) => {
    if (h < REED_LO || h > REED_HI) return false;
    const [i, j] = tileFromWorld(x, z);
    const t = tile(i, j);
    return !!t && !t.occ && (t.t === 'grass' || t.t === 'water');
  }, { scaleMin: 0.85, scaleMax: 1.5, yOff: 0.0, margin: 2 });

  if (typeof window !== 'undefined') window.__scatterCounts = counts; // playtest-game inspection
}

// ---------- street lamps (city sidewalks, lit at night) ----------
function initLamps() {
  const spots = [];
  for (const city of G.cities) {
    for (const t of city.roadTiles) {
      if (rand() > 0.3) continue;
      // only corners that actually carry a sidewalk (edges without a road neighbour)
      const swE = !isRoad(t.i + 1, t.j), swW = !isRoad(t.i - 1, t.j);
      const swN = !isRoad(t.i, t.j + 1), swS = !isRoad(t.i, t.j - 1);
      const corners = [];
      for (const sx of [1, -1]) for (const sz of [1, -1]) {
        if ((sx > 0 ? swE : swW) || (sz > 0 ? swN : swS)) corners.push([sx, sz]);
      }
      if (!corners.length) continue; // junction tile, all asphalt
      const [x, z] = worldXZ(t.i, t.j);
      const [sx, sz] = corners[Math.floor(rand() * corners.length)];
      spots.push({
        x: x + sx * (G.TILE / 2 - SIDEWALK_W / 2), y: tileY(t.i, t.j) + ROAD_TOP, z: z + sz * (G.TILE / 2 - SIDEWALK_W / 2),
        sx, sz, // corner direction the lamp sits toward — the arm reaches back the opposite way, over the road
      });
    }
  }
  if (!spots.length) return;
  // pole + arm + head, look-dev proportions (lookdev-blender.py make_lamp:
  // pole r0.05 h3.4, arm 0.7 long at the pole top, head 0.3x0.12x0.08 at the
  // arm tip) scaled to this pole's height.
  const POLE_H = 3.0, ARM_OUT = 0.30, ARM_LEN = 0.62;
  const pole = new THREE.CylinderGeometry(0.045, 0.06, POLE_H, 6);
  pole.translate(0, POLE_H / 2, 0);
  const arm = new THREE.BoxGeometry(ARM_LEN, 0.05, 0.05);
  arm.translate(ARM_OUT + ARM_LEN / 2, POLE_H, 0);
  const head = new THREE.SphereGeometry(0.17, 8, 6); // bigger + brighter than before so it reads clearly at night
  head.translate(ARM_OUT + ARM_LEN, POLE_H - 0.05, 0);
  const geo = mergeGeometries([pole, arm, head], true); // 3 groups -> [pole, arm, head] materials
  const darkMat = M('#3a4046');
  const headMat = new THREE.MeshStandardMaterial({
    color: '#f5efdf', roughness: 0.4,
    emissive: new THREE.Color(1.35, 1.05, 0.55), emissiveIntensity: 0, // >1 emissive so the head reads brighter than lit windows at the same night amount
  });
  facadeMats.push(headMat); // setNightAmount switches the lamps on
  const inst = noCull(new THREE.InstancedMesh(geo, [darkMat, darkMat, headMat], spots.length));
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0);
  spots.forEach(({ x, y, z, sx, sz }, k) => {
    p.set(x, y, z);
    q.setFromAxisAngle(UP, Math.atan2(sz, -sx)); // arm points inward from the corner, out over the road
    m.compose(p, q, s);
    inst.setMatrixAt(k, m);
  });
  scene.add(inst);
}

// ---------- roads (dynamic instanced meshes, one per connection mask) ----------
// asphalt spans the whole tile so connected streets read as one seamless
// surface; the sidewalk band is only drawn along edges that don't border
// another road tile. 16 texture variants keyed by the neighbour bitmask
// (bit0 = +x, bit1 = -x, bit2 = +z, bit3 = -z road neighbour).
export const SIDEWALK_W = 0.5;                    // world units, matches the texture border
// like the rail ballast bed: terrain height varies within a tile, so a thin
// slab at tile-center height clips into slopes. The deck top sits ROAD_TOP
// above tile height (just below the rails of a level crossing at ~0.285).
export const ROAD_TOP = 0.24;
const ROAD_DECK_H = 0.4;                          // deck bottom h-0.16 hides dips
const roadMeshes = [];                            // index = connection mask

// canvas orientation on the box top face: right = +x, top = -z (box UVs put
// z=-T/2 at v=1, which is the canvas top after flipY)
function makeAsphaltTexture(mask) {
  return canvasTex(128, (cx, S) => {
    const B = Math.round(S * SIDEWALK_W / G.TILE); // sidewalk band px
    // asphalt base over the whole tile
    cx.fillStyle = '#3c4043'; cx.fillRect(0, 0, S, S);
    // large-scale mottling: repair patches and tar stains
    for (let k = 0; k < 7; k++) {
      const v = 42 + Math.random() * 28 | 0;
      cx.fillStyle = `rgba(${v},${v + 3},${v + 5},0.35)`;
      cx.beginPath();
      cx.ellipse(Math.random() * S, Math.random() * S, 8 + Math.random() * 22, 8 + Math.random() * 22, Math.random() * Math.PI, 0, Math.PI * 2);
      cx.fill();
    }
    // dense aggregate speckle, two grain sizes
    for (let k = 0; k < 2600; k++) {
      const v = 46 + Math.random() * 46 | 0;
      cx.fillStyle = `rgba(${v},${v + 4},${v + 6},0.55)`;
      cx.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
    }
    for (let k = 0; k < 350; k++) {
      const v = 60 + Math.random() * 55 | 0;
      cx.fillStyle = `rgba(${v},${v + 4},${v + 6},0.4)`;
      cx.fillRect(Math.random() * S, Math.random() * S, 2.5, 2.5);
    }
    // hairline cracks — kept faint: same-mask tiles share one texture, so
    // bold cracks read as an obvious repeat on straight stretches
    cx.strokeStyle = 'rgba(22,24,26,0.3)'; cx.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      let x = Math.random() * S, y = Math.random() * S;
      cx.beginPath();
      cx.moveTo(x, y);
      for (let sgm = 0; sgm < 5; sgm++) { x += (Math.random() - 0.5) * 22; y += Math.random() * 14; cx.lineTo(x, y); }
      cx.stroke();
    }
    // dashed centre line between the two directions — one arm per connected
    // edge, meeting at the tile centre (an L on bends, a full line on straight
    // tiles). Junction tiles (3+ arms) stay unmarked like real intersections.
    // Dash phase starts with a half-gap at the edge so it tiles seamlessly.
    const arms = [[1, S, S / 2], [2, 0, S / 2], [4, S / 2, S], [8, S / 2, 0]].filter(([b]) => mask & b);
    if (arms.length && arms.length <= 2) {
      cx.strokeStyle = 'rgba(225,222,206,0.75)'; cx.lineWidth = 3;
      cx.setLineDash([10, 8]); cx.lineDashOffset = 14;
      for (const [, ex, ey] of arms) {
        cx.beginPath(); cx.moveTo(ex, ey); cx.lineTo(S / 2, S / 2); cx.stroke();
      }
      cx.setLineDash([]);
    }
    // sidewalk bands on unconnected edges: [x, y, w, h] in canvas px
    const bands = [];
    if (!(mask & 1)) bands.push([S - B, 0, B, S]);  // +x → canvas right
    if (!(mask & 2)) bands.push([0, 0, B, S]);      // -x → canvas left
    if (!(mask & 4)) bands.push([0, S - B, S, B]);  // +z → canvas bottom
    if (!(mask & 8)) bands.push([0, 0, S, B]);      // -z → canvas top
    // corner patches where two connected edges meet (junction mouths, inner
    // bend corners) — they join the neighbours' sidewalk bands around the turn
    if ((mask & 1) && (mask & 4)) bands.push([S - B, S - B, B, B]);
    if ((mask & 1) && (mask & 8)) bands.push([S - B, 0, B, B]);
    if ((mask & 2) && (mask & 4)) bands.push([0, S - B, B, B]);
    if ((mask & 2) && (mask & 8)) bands.push([0, 0, B, B]);
    for (const [bx, by, bw, bh] of bands) {
      cx.fillStyle = '#8f959b'; cx.fillRect(bx, by, bw, bh);
      const grain = Math.max(12, 140 * (bw * bh) / (S * B) | 0);
      for (let k = 0; k < grain; k++) { // paving grain
        const v = 125 + Math.random() * 40 | 0;
        cx.fillStyle = `rgba(${v},${v + 3},${v + 5},0.6)`;
        cx.fillRect(bx + Math.random() * bw, by + Math.random() * bh, 2, 2);
      }
      cx.strokeStyle = 'rgba(60,64,68,0.4)'; cx.lineWidth = 1; // slab joints
      if (bw > bh) for (let k = bx; k < bx + bw; k += 16) cx.strokeRect(k, by, 16, bh);
      else if (bh > bw) for (let k = by; k < by + bh; k += 16) cx.strokeRect(bx, k, bw, 16);
      // curb lines along the asphalt-facing edges (tile-border edges get none)
      cx.strokeStyle = 'rgba(20,22,24,0.7)'; cx.lineWidth = 2;
      cx.beginPath();
      if (bw < S) { const cxx = bx === 0 ? B : bx; cx.moveTo(cxx, by); cx.lineTo(cxx, by + bh); }
      if (bh < S) { const cy = by === 0 ? B : by; cx.moveTo(bx, cy); cx.lineTo(bx + bw, cy); }
      cx.stroke();
    }
  });
}

function initRoadMesh() {
  const geo = new THREE.BoxGeometry(G.TILE, ROAD_DECK_H, G.TILE);
  for (let mask = 0; mask < 16; mask++) {
    const mat = new THREE.MeshStandardMaterial({ map: makeAsphaltTexture(mask), roughness: 0.95 });
    const mesh = noCull(new THREE.InstancedMesh(geo, mat, 4500));
    mesh.receiveShadow = true;
    mesh.count = 0;
    roadMeshes[mask] = mesh;
    scene.add(mesh);
  }
  roadDirty = true;
}
function rebuildRoads() {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  for (const mesh of roadMeshes) mesh.count = 0;
  for (const t of G.tiles) {
    if (t.t !== 'road') continue;
    const mask = (isRoad(t.i + 1, t.j) ? 1 : 0) | (isRoad(t.i - 1, t.j) ? 2 : 0)
      | (isRoad(t.i, t.j + 1) ? 4 : 0) | (isRoad(t.i, t.j - 1) ? 8 : 0);
    const [x, z] = worldXZ(t.i, t.j);
    p.set(x, t.h + ROAD_TOP - ROAD_DECK_H / 2, z);
    m.compose(p, q, s);
    const mesh = roadMeshes[mask];
    mesh.setMatrixAt(mesh.count++, m);
  }
  for (const mesh of roadMeshes) mesh.instanceMatrix.needsUpdate = true;
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
  // Vertex-color convention for both instanced meshes: the RGB attribute is a
  // per-part MULTIPLIER, and InstancedMesh.setColorAt tints the whole agent on
  // top. So parts tinted to a fixed gray (glass, tyres, trousers) stay dark
  // whatever the instance color; parts tinted white take the full body color.
  const tintRGB = (geom, r, g = r, b = r) => {
    const n = geom.attributes.position.count, a = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { a[k * 3] = r; a[k * 3 + 1] = g; a[k * 3 + 2] = b; }
    geom.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return geom;
  };
  // car = lower body + greenhouse cabin + tinted glass band + 4 tyres
  const carParts = [];
  carParts.push(tintRGB(new THREE.BoxGeometry(1.55, 0.34, 0.8).translate(0, 0.26, 0), 1));       // body
  carParts.push(tintRGB(new THREE.BoxGeometry(0.86, 0.3, 0.72).translate(-0.05, 0.56, 0), 0.82)); // cabin
  carParts.push(tintRGB(new THREE.BoxGeometry(0.9, 0.2, 0.74).translate(-0.05, 0.55, 0), 0.14));  // glass
  carParts.push(tintRGB(new THREE.BoxGeometry(0.42, 0.14, 0.84).translate(0.5, 0.42, 0), 0.9));   // hood step
  const wheelG = () => new THREE.CylinderGeometry(0.17, 0.17, 0.12, 8).rotateX(Math.PI / 2);
  for (const wx of [0.5, -0.5]) for (const wz of [0.36, -0.36]) carParts.push(tintRGB(wheelG().translate(wx, 0.16, wz), 0.08));
  const carGeo = mergeGeometries(carParts);
  const carMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.45, vertexColors: true });
  ambient.cars = noCull(new THREE.InstancedMesh(carGeo, carMat, 160));
  ambient.cars.castShadow = true;

  // pedestrian = trousers (dark) + torso (shirt = instance color) + skin head
  const pedParts = [];
  pedParts.push(tintRGB(new THREE.BoxGeometry(0.2, 0.36, 0.16).translate(0, 0.18, 0), 0.34));      // legs/trousers
  pedParts.push(tintRGB(new THREE.BoxGeometry(0.24, 0.34, 0.18).translate(0, 0.5, 0), 1));          // torso/shirt
  pedParts.push(tintRGB(new THREE.SphereGeometry(0.12, 7, 6).translate(0, 0.76, 0), 1.0, 0.82, 0.66)); // head (skin)
  const pedGeo = mergeGeometries(pedParts);
  ambient.peds = noCull(new THREE.InstancedMesh(pedGeo, new THREE.MeshStandardMaterial({ roughness: 0.75, vertexColors: true }), 240));

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
    _p.set(x0 + dirx * c.prog + lx, tileY(c.i, c.j) + ROAD_TOP + 0.01, z0 + dirz * c.prog + lz);
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
    _p.set(x0 + dirx * p.prog + lx, tileY(p.i, p.j) + ROAD_TOP + 0.02, z0 + dirz * p.prog + lz);
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
