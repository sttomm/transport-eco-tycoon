// Infrastructure: street lamps, roads (asphalt textures + curbs) and rails
// (ballast + track segments). Split out of world.js — stays in sync by
// listening to the 'roadBuilt' / 'railBuilt' grid events, which mark the
// instanced meshes dirty for a rebuild on the next frame.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, on } from '../sim/state.js';
import { worldXZ, tileY, isRoad, isRail } from '../sim/grid.js';
import { M, canvasTex, makeBallastTexture, noCull } from './meshes.js';
import { rand } from './rng.js';
import { facadeMats } from './buildings.js';

let scene;
let roadDirty = true;
let railBallast, railSegs, railDirty = true;
let curbMesh;

export function initInfrastructure(sc) {
  scene = sc;
  initLamps();
  initRoadMesh();
  initRailMesh();

  on('roadBuilt', () => { roadDirty = true; });
  on('railBuilt', () => { railDirty = true; });
}

// per-frame: rebuild the instanced road/rail meshes when marked dirty
export function updateInfrastructure() {
  if (roadDirty) rebuildRoads();
  if (railDirty) rebuildRails();
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
// surface. Every road tile — city street or inter-city/rural — shares the
// same asphalt and gets a dashed centre line (WP9: unify, no gravel variant
// anywhere). City streets (tile.cityStreet) additionally get a sidewalk band
// + curb line baked into the texture, a raised 3D curb lip along the same
// edges (curbMesh below), and zebra crosswalk bands at junction tiles.
// Rural roads stay plain asphalt running flush to the grass, matching
// board07-aerial.jpg. 32 texture variants: 16 neighbour bitmasks (bit0 = +x,
// bit1 = -x, bit2 = +z, bit3 = -z road neighbour) x {rural, city}.
export const SIDEWALK_W = 0.5;                    // world units, matches the texture border
// like the rail ballast bed: terrain height varies within a tile, so a thin
// slab at tile-center height clips into slopes. The deck top sits ROAD_TOP
// above tile height (just below the rails of a level crossing at ~0.285).
export const ROAD_TOP = 0.24;
const ROAD_DECK_H = 0.4;                          // deck bottom h-0.16 hides dips
const ROAD_CAP = 4500;                            // instances per (mask, city) bucket — same headroom as pre-WP9
const CITY_BIT = 16;                              // bucket index offset: mask + CITY_BIT for city streets
const roadMeshes = [];                            // index = mask + (cityStreet ? CITY_BIT : 0)
const CURB_W = 0.16, CURB_H = 0.10;                // raised curb strip: width x height, world units
const CURB_CAP = 6000;                            // up to 4 curb strips per city street tile

// canvas orientation on the box top face: right = +x, top = -z (box UVs put
// z=-T/2 at v=1, which is the canvas top after flipY)
function makeAsphaltTexture(mask, isCity) {
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
    // sidewalk bands on unconnected edges: [x, y, w, h] in canvas px.
    // Rural (inter-city) roads skip this entirely — asphalt runs flush to the
    // edge, matching board07-aerial.jpg; only city streets get a sidewalk +
    // curb (the raised 3D curb lip lives in curbMesh, built off the same
    // neighbour mask in rebuildRoads).
    const bands = [];
    if (isCity) {
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
    }
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
    // Junction tiles (3-4 arms) are deliberately left as plain asphalt — no
    // centre line (handled above) and no crosswalk markings. The painted
    // ladders that used to sit here read as four large squares around the
    // intersection, so they were removed; the sidewalk bands and curbs still
    // frame the crossing.
  });
}

// ---------- curbs (raised 3D strip, city streets only) ----------
// A thin box along the outer edge of each city street tile that doesn't
// border another road tile — no curb across a junction mouth, matching the
// texture-baked sidewalk band above. Rural roads never get one.
function initCurbMesh() {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: '#9aa0a5', roughness: 0.85 });
  curbMesh = noCull(new THREE.InstancedMesh(geo, mat, CURB_CAP));
  curbMesh.castShadow = curbMesh.receiveShadow = true;
  curbMesh.count = 0;
  scene.add(curbMesh);
}

function initRoadMesh() {
  const geo = new THREE.BoxGeometry(G.TILE, ROAD_DECK_H, G.TILE);
  for (let city = 0; city < 2; city++) {
    for (let mask = 0; mask < 16; mask++) {
      const mat = new THREE.MeshStandardMaterial({ map: makeAsphaltTexture(mask, !!city), roughness: 0.95 });
      const mesh = noCull(new THREE.InstancedMesh(geo, mat, ROAD_CAP));
      mesh.receiveShadow = true;
      mesh.count = 0;
      roadMeshes[mask + city * CITY_BIT] = mesh;
      scene.add(mesh);
    }
  }
  initCurbMesh();
  roadDirty = true;
}
function rebuildRoads() {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  const cm = new THREE.Matrix4(), cp = new THREE.Vector3(), cs = new THREE.Vector3();
  for (const mesh of roadMeshes) mesh.count = 0;
  curbMesh.count = 0;
  const inset = G.TILE / 2 - SIDEWALK_W; // world offset from tile centre to the curb line
  for (const t of G.tiles) {
    if (t.t !== 'road') continue;
    const mask = (isRoad(t.i + 1, t.j) ? 1 : 0) | (isRoad(t.i - 1, t.j) ? 2 : 0)
      | (isRoad(t.i, t.j + 1) ? 4 : 0) | (isRoad(t.i, t.j - 1) ? 8 : 0);
    const [x, z] = worldXZ(t.i, t.j);
    p.set(x, t.h + ROAD_TOP - ROAD_DECK_H / 2, z);
    m.compose(p, q, s);
    const mesh = roadMeshes[mask + (t.cityStreet ? CITY_BIT : 0)];
    mesh.setMatrixAt(mesh.count++, m);

    // raised curb strips: city streets only, one per unconnected edge (a
    // junction mouth toward another road tile never gets one). Bridges and
    // player-placed rural roads never set cityStreet, so they stay curb-free.
    if (t.cityStreet) {
      const curbY = t.h + ROAD_TOP + CURB_H / 2;
      if (!(mask & 1)) { cp.set(x + inset, curbY, z); cs.set(CURB_W, CURB_H, G.TILE); cm.compose(cp, q, cs); curbMesh.setMatrixAt(curbMesh.count++, cm); }
      if (!(mask & 2)) { cp.set(x - inset, curbY, z); cs.set(CURB_W, CURB_H, G.TILE); cm.compose(cp, q, cs); curbMesh.setMatrixAt(curbMesh.count++, cm); }
      if (!(mask & 4)) { cp.set(x, curbY, z + inset); cs.set(G.TILE, CURB_H, CURB_W); cm.compose(cp, q, cs); curbMesh.setMatrixAt(curbMesh.count++, cm); }
      if (!(mask & 8)) { cp.set(x, curbY, z - inset); cs.set(G.TILE, CURB_H, CURB_W); cm.compose(cp, q, cs); curbMesh.setMatrixAt(curbMesh.count++, cm); }
    }
  }
  for (const mesh of roadMeshes) mesh.instanceMatrix.needsUpdate = true;
  curbMesh.instanceMatrix.needsUpdate = true;
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
