// Network geometry: A* over road/rail tiles, station access tiles, and the
// pose-along-a-path interpolation. Used by the vehicle sim for movement and
// by render/vehicles.js for mesh placement. No economy in here.
import { G } from './state.js';
import { isRoad, isRail, worldXZ } from './grid.js';

export function findPath(si, sj, ti, tj, passable = isRoad) {
  if (!passable(si, sj) || !passable(ti, tj)) return null;
  const key = (i, j) => j * G.N + i;
  const open = new Map(), came = new Map(), gScore = new Map();
  const h = (i, j) => Math.abs(i - ti) + Math.abs(j - tj);
  open.set(key(si, sj), h(si, sj));
  gScore.set(key(si, sj), 0);
  let guard = 20000;
  while (open.size && guard-- > 0) {
    let bestK = null, bestF = Infinity;
    for (const [k, f] of open) if (f < bestF) { bestF = f; bestK = k; }
    open.delete(bestK);
    const ci = bestK % G.N, cj = Math.floor(bestK / G.N);
    if (ci === ti && cj === tj) {
      const path = [[ci, cj]];
      let k = bestK;
      while (came.has(k)) { k = came.get(k); path.push([k % G.N, Math.floor(k / G.N)]); }
      return path.reverse();
    }
    const g = gScore.get(bestK);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = ci + di, nj = cj + dj;
      if (!passable(ni, nj)) continue;
      const nk = key(ni, nj);
      const ng = g + 1;
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng); came.set(nk, bestK);
        open.set(nk, ng + h(ni, nj));
      }
    }
  }
  return null;
}

// nearest road / rail tile adjacent to a station
export function stationRoadTile(st, passable = isRoad) {
  for (let d = -1; d <= st.fp; d++) {
    for (const [i, j] of [[st.i + d, st.j - 1], [st.i + d, st.j + st.fp], [st.i - 1, st.j + d], [st.i + st.fp, st.j + d]]) {
      if (passable(i, j)) return [i, j];
    }
  }
  return null;
}

// the network a vehicle drives on
export const passableFor = v => v.kind === 'train' ? isRail : isRoad;

// pose at distance d (in tiles) along a path; d < 0 extrapolates behind the
// start. Returns [x, z, yaw|null, tile] — used by the sim for arrival checks
// and by the renderer for vehicle & wagon placement.
export function pathPose(path, d) {
  const n = path.length;
  if (n < 2) {
    const [x, z] = worldXZ(path[0][0], path[0][1]);
    return [x, z, null, path[0]];
  }
  let idx = Math.floor(d), f = d - idx;
  if (idx < 0) { idx = 0; f = d; }
  else if (idx >= n - 1) { idx = n - 2; f = 1 + (d - (n - 1)); }
  const [i0, j0] = path[idx], [i1, j1] = path[idx + 1];
  const [x0, z0] = worldXZ(i0, j0), [x1, z1] = worldXZ(i1, j1);
  // meshes are authored nose (+X, headlights) forward; -π/2 points that nose
  // along the direction of travel (see tools/models/vehicles.py conventions).
  const yaw = (x1 !== x0 || z1 !== z0) ? Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2 : null;
  const onTile = f < 0.5 ? path[Math.max(0, Math.min(idx, n - 1))] : path[Math.max(0, Math.min(idx + 1, n - 1))];
  return [x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, yaw, onTile];
}
