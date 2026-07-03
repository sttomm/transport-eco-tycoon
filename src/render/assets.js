// glTF asset library (graphics phase 2). Loads the Blender-built models from
// assets/models/ once at startup; buildPlantMesh & friends take instances via
// modelInstance() and keep their procedural path as fallback for un-migrated
// types (and for load failures — the game must still run without assets).
//
// Contracts the models follow (enforced in tools/models/*.py):
//   - origin at ground center, 1 Blender unit = 1 game unit
//   - a node named "rotor" (if any) spins around its local +X and exports
//     with identity rotation — world.js animates `rotor.rotation.x` directly
//   - node & material names are stable across regenerations
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyTexture, facadeTexture, grainTexture } from './textures.js';

// building/vehicle type -> asset file; add entries as types are migrated
const MODEL_FILES = {
  wind: 'assets/models/wind_turbine.glb',
};
const BUILDINGS_FILE = 'assets/models/buildings.glb';
// library files: every top-level node registers as a model under its own
// name (node translations are layout-only and get zeroed)
const LIBRARY_FILES = [
  'assets/models/vehicles.glb',
  'assets/models/plants.glb',
  'assets/models/industries.glb',
  'assets/models/stations.glb',
];
const TREES_FILE = 'assets/models/trees.glb';

const models = {}; // name -> prepared THREE.Group (the shared original, never in-scene)
let buildingLib = null; // { models: [{name, style, tier, geometry, materials}], windowMat }
let treeLib = null; // { models: [{name, geometry}], material }

// Called from main.js before initWorldRender — the render layer's 'placed'
// listeners must not run before models are ready (save replay fires place()
// during init). A failed file only warns: that type falls back to procedural.
export async function loadModels() {
  const loader = new GLTFLoader();
  await Promise.all([
    ...Object.entries(MODEL_FILES).map(async ([name, url]) => {
      try {
        const gltf = await loader.loadAsync(url);
        gltf.scene.traverse(o => {
          if (o.isMesh) {
            o.castShadow = o.receiveShadow = true;
            applyTexture(o.material);
          }
        });
        models[name] = gltf.scene;
      } catch (err) {
        console.warn(`assets: ${url} failed to load — procedural fallback for '${name}'`, err);
      }
    }),
    ...LIBRARY_FILES.map(async url => {
      try {
        const gltf = await loader.loadAsync(url);
        for (const node of [...gltf.scene.children]) {
          node.position.set(0, 0, 0);
          node.traverse(o => {
            if (o.isMesh) {
              o.castShadow = o.receiveShadow = true;
              applyTexture(o.material);
            }
          });
          models[node.name] = node;
        }
      } catch (err) {
        console.warn(`assets: ${url} failed to load — procedural fallback`, err);
      }
    }),
    prepareBuildings(loader),
    prepareTrees(loader),
  ]);
}

// bake a mesh's flat material color into a vertex-color attribute (lets many
// materials collapse into one vertexColors material for instancing)
function bakeVertexColor(geometry, color) {
  const n = geometry.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) { col[k * 3] = color.r; col[k * 3 + 1] = color.g; col[k * 3 + 2] = color.b; }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geometry;
}

// tree species merge into one geometry each — the forest is a single
// InstancedMesh per species (world.js buildTrees)
async function prepareTrees(loader) {
  let gltf;
  try {
    gltf = await loader.loadAsync(TREES_FILE);
  } catch (err) {
    console.warn('assets: trees.glb failed to load — procedural tree fallback', err);
    return;
  }
  const models = [];
  for (const node of gltf.scene.children) {
    const parts = [];
    node.traverse(o => {
      if (o.isMesh) parts.push(bakeVertexColor(o.geometry, o.material.color));
    });
    models.push({ name: node.name, geometry: mergeGeometries(parts) });
  }
  treeLib = { models, material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }) };
}

export function treeSet() { return treeLib; }

// ---------- city building set ----------
// buildings.glb holds 9 buildings named <style>_<tier>, each authored at the
// ground center (node translations are layout-only). For instancing, each
// building is merged into ONE geometry with a material group per texture
// category (per-model `materials` array matches the group order):
//   flat    — trims/roofs/doors: Blender colors baked into vertex colors,
//             one shared material with a near-white grain detail map
//   brick / plaster — wall faces: shared material whose canvas texture
//             (textures.js facadeTexture) carries the color; verts are white
//   window  — "bldg_window" faces: shared glass material whose emissiveMap
//             is an 8x8 cell atlas of randomly lit windows; every window's
//             UVs sit on one cell, so it is uniformly lit or dark. world.js
//             drives the intensity via setNightAmount.
async function prepareBuildings(loader) {
  let gltf;
  try {
    gltf = await loader.loadAsync(BUILDINGS_FILE);
  } catch (err) {
    console.warn('assets: buildings.glb failed to load — procedural city fallback', err);
    return;
  }
  const windowMat = new THREE.MeshStandardMaterial({
    color: '#20303f', roughness: 0.18, metalness: 0.35,
    emissive: '#ffffff', emissiveMap: makeWindowLightsTexture(), emissiveIntensity: 0,
  });
  const flatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, map: grainTexture(1.7) });
  const wallMats = {}; // brick/plaster: lazily built from the loaded material's own color
  const wallMat = (kind, src) => {
    if (!wallMats[kind]) {
      const { map, bump } = facadeTexture[kind === 'brick' ? 'brick' : 'stucco']('#' + src.color.getHexString());
      const period = kind === 'brick' ? 1.8 : 2.4;
      map.repeat.set(1 / period, 1 / period);
      bump.repeat.set(1 / period, 1 / period);
      wallMats[kind] = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: src.roughness, map, bumpMap: bump,
        bumpScale: kind === 'brick' ? 0.3 : 0.12,
      });
    }
    return wallMats[kind];
  };
  const libModels = [];
  for (const node of gltf.scene.children) {
    const parts = { flat: [], brick: [], plaster: [], window: [] };
    const mats = { flat: flatMat, window: windowMat };
    node.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry; // transforms inside a building are identity — authored in place
      const name = o.material.name;
      const cat = name === 'bldg_window' ? 'window'
        : name === 'bldg_brick' ? 'brick'
          : name === 'bldg_plaster' ? 'plaster' : 'flat';
      if (cat === 'brick' || cat === 'plaster') mats[cat] = wallMat(cat, o.material);
      // walls & windows get white vertex colors (texture/glass carries the
      // look); flat parts keep their Blender color. The attribute must exist
      // on every part for merging.
      bakeVertexColor(g, cat === 'flat' ? o.material.color : { r: 1, g: 1, b: 1 });
      parts[cat].push(g);
    });
    const cats = ['flat', 'brick', 'plaster', 'window'].filter(c => parts[c].length);
    const geometry = mergeGeometries(cats.map(c => mergeGeometries(parts[c])), true);
    const [style, tier] = node.name.split('_');
    libModels.push({ name: node.name, style, tier, geometry, materials: cats.map(c => mats[c]) });
  }
  buildingLib = { models: libModels, windowMat };
}

// 8x8 atlas: each cell is one window's night state. UV rows 0-1 are the dim
// zone for LARGE glazing (glass-tower floor bands, shopfronts, lobbies):
// sparse and always below the bloom threshold — a lit full-floor quad at
// bloom strength turns the city into a white blob. Rows 2-7 are small
// windows: brighter, and only the brightest cross the threshold and glow.
function makeWindowLightsTexture() {
  const S = 128, C = S / 8;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#000';
  cx.fillRect(0, 0, S, S);
  const paint = (r, g, b, k) => `rgb(${r * k | 0},${g * k | 0},${b * k | 0})`;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const y = S - (j + 1) * C; // UV v is bottom-up, canvas y top-down
    if (j < 2) {
      if (Math.random() < 0.35) cx.fillStyle = paint(255, 214, 140, 0.28 + Math.random() * 0.14);
      else continue;
    } else if (Math.random() < 0.32) {
      // mostly warm interior light below the bloom threshold; only the
      // brightest ~quarter of lit windows glow (threshold 3.4 / intensity 4.5)
      const k = 0.4 + Math.random() * 0.45;
      cx.fillStyle = Math.random() < 0.8 ? paint(255, 220, 142, k) : paint(191, 227, 255, k);
    } else continue;
    cx.fillRect(i * C, y, C, C);
  }
  return new THREE.CanvasTexture(cv);
}

export function buildingSet() { return buildingLib; }

// Fresh scene-graph clone (geometry & materials shared across instances),
// or null if the type has no glTF model. Wires userData.rotor for world.js.
export function modelInstance(name) {
  const src = models[name];
  if (!src) return null;
  const g = src.clone(true);
  const rotor = g.getObjectByName('rotor');
  if (rotor) g.userData.rotor = rotor;
  const glow = g.getObjectByName('glow');
  if (glow) glow.material = glow.material.clone(); // per-instance emissive drive
  return g;
}
