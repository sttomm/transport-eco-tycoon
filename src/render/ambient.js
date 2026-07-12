// Ambient life: cosmetic cars & pedestrians wandering the city road grid.
// Split out of world.js — reads sim state from G (population gates how many
// agents are visible), never mutates it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from '../sim/state.js';
import { worldXZ, tileY, isRoad } from '../sim/grid.js';
import { noCull } from './meshes.js';
import { rand } from './rng.js';
import { ROAD_TOP, SIDEWALK_W } from './infrastructure.js';

let scene;
const ambient = { cars: null, peds: null, carList: [], pedList: [] };

// ---------- ambient life: cars & pedestrians ----------
export function initAmbient(sc) {
  scene = sc;
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

export function updateAmbient(dt) {
  // population determines how many ambient agents are visible
  for (const list of [ambient.carList, ambient.pedList]) {
    list.forEach((a, idx) => {
      const cityFactor = Math.min(1, a.city.pop / 6000);
      a.active = (idx % list.length) / list.length < cityFactor + 0.35;
    });
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
    _e.set(0, Math.atan2(dirx, dirz) - Math.PI / 2, 0); _q.setFromEuler(_e); // nose (+X) leads travel
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
}
