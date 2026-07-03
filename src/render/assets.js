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
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// building/vehicle type -> asset file; add entries as types are migrated
const MODEL_FILES = {
  wind: 'assets/models/wind_turbine.glb',
};

const models = {}; // name -> prepared THREE.Group (the shared original, never in-scene)

// Called from main.js before initWorldRender — the render layer's 'placed'
// listeners must not run before models are ready (save replay fires place()
// during init). A failed file only warns: that type falls back to procedural.
export async function loadModels() {
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(MODEL_FILES).map(async ([name, url]) => {
    try {
      const gltf = await loader.loadAsync(url);
      gltf.scene.traverse(o => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
      });
      models[name] = gltf.scene;
    } catch (err) {
      console.warn(`assets: ${url} failed to load — procedural fallback for '${name}'`, err);
    }
  }));
}

// Fresh scene-graph clone (geometry & materials shared across instances),
// or null if the type has no glTF model. Wires userData.rotor for world.js.
export function modelInstance(name) {
  const src = models[name];
  if (!src) return null;
  const g = src.clone(true);
  const rotor = g.getObjectByName('rotor');
  if (rotor) g.userData.rotor = rotor;
  return g;
}
