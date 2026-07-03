// Shared test helpers. Every test starts from freshWorld(): a reset state
// plus the procedurally generated world (fixed seed → deterministic layout:
// 192×192 tiles, 8 cities — Solhaven at [46,62] first — river around i≈134,
// 9 industries; the south-west around [2..21, 84..92] is empty grass for
// synthetic road/rail fixtures).
import { G, resetState } from '../src/sim/state.js';
import { initGrid, tile, canPlace, place } from '../src/sim/grid.js';

export function freshWorld() {
  resetState();
  initGrid();
  return G;
}

// first tile where the given tool can be placed (scan order: row-major)
export function findSpot(toolId) {
  for (let j = 0; j < G.N; j++) for (let i = 0; i < G.N; i++) {
    if (canPlace(toolId, i, j)) return [i, j];
  }
  return null;
}

export function findGrass() {
  for (const t of G.tiles) if (t.t === 'grass' && !t.occ && !t.rail) return [t.i, t.j];
  return null;
}

export function findWater() {
  for (const t of G.tiles) if (t.t === 'water' && !t.occ) return [t.i, t.j];
  return null;
}

// lay a straight road along one axis (all tiles must be placeable)
export function buildRoad(i0, j0, i1, j1) {
  const si = Math.sign(i1 - i0), sj = Math.sign(j1 - j0);
  let i = i0, j = j0;
  for (;;) {
    if (canPlace('road', i, j)) place('road', i, j);
    if (i === i1 && j === j1) break;
    i += si; j += sj;
  }
}

export function buildRail(i0, j0, i1, j1) {
  const si = Math.sign(i1 - i0), sj = Math.sign(j1 - j0);
  let i = i0, j = j0;
  for (;;) {
    if (canPlace('rail', i, j)) place('rail', i, j);
    if (i === i1 && j === j1) break;
    i += si; j += sj;
  }
}

// a station tile adjacent to a city's street grid (for passenger tests)
export function stationSpotNearCity(city, toolId = 'busStop', minDistFrom = null, minDist = 0) {
  for (const rt of city.roadTiles) {
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = rt.i + di, j = rt.j + dj;
      if (!canPlace(toolId, i, j)) continue;
      if (minDistFrom && Math.hypot(i - minDistFrom[0], j - minDistFrom[1]) < minDist) continue;
      return [i, j];
    }
  }
  return null;
}

// fake industry next to a location — keeps freight tests independent of the
// generated industry positions
export function fakeIndustry(type, def, i, j) {
  const ind = { kind: 'industry', type, def, i, j, stock: 0, inStock: 0, running: false };
  G.industries.push(ind);
  return ind;
}
