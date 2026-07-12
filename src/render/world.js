// World rendering: terrain, water, city buildings, industries, trees,
// roads/rails and ambient life (cars & pedestrians). Reads sim state from G
// and stays in sync by listening to grid events ('placed', 'bulldozed',
// 'roadBuilt', 'railBuilt') — it never mutates sim state.
//
// This file is the composition facade: the actual meshes live in terrain.js,
// buildings.js, scatter.js, infrastructure.js and ambient.js. The init calls
// below run in the SAME order the monolith did — most modules draw from the
// one shared cosmetic rand stream (rng.js), so reordering them re-scatters
// the whole world.
import { initTerrain, updateWater } from './terrain.js';
import { initBuildings, updateBuildings } from './buildings.js';
import { initScatter } from './scatter.js';
import { initInfrastructure, updateInfrastructure } from './infrastructure.js';
import { initAmbient, updateAmbient } from './ambient.js';

// re-exports so importers keep reading these off world.js (scene.js pulls
// setNightAmount; ROAD_TOP/SIDEWALK_W were part of the public surface)
export { setNightAmount } from './buildings.js';
export { ROAD_TOP, SIDEWALK_W } from './infrastructure.js';

export function initWorldRender(sc) {
  initTerrain(sc);         // terrain mesh + water
  initBuildings(sc);       // city buildings, industries + 'placed'/'bulldozed' handlers
  initScatter(sc);         // trees, ground scatter, farm fields
  initInfrastructure(sc);  // lamps, roads, rails + 'roadBuilt'/'railBuilt' handlers
  initAmbient(sc);         // ambient cars & pedestrians
}

export function updateWorldRender(dt) {
  updateInfrastructure();  // rebuild road/rail instancing when marked dirty
  updateWater(dt);
  updateBuildings(dt);     // turbine spin, gas smoke, steel-works glow
  updateAmbient(dt);       // ambient car/ped movement & visibility
}
