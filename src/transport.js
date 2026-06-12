import * as THREE from 'three';
import { G, emit } from './state.js';
import { VEHICLES, CARGO } from './data.js';
import { tile, isRoad, worldXZ, tileY } from './world.js';

const STATION_RADIUS = 7;
let scene;

export function initTransport(sc) { scene = sc; }

// ---------- pathfinding (A* over road tiles) ----------
export function findPath(si, sj, ti, tj) {
  if (!isRoad(si, sj) || !isRoad(ti, tj)) return null;
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
      if (!isRoad(ni, nj)) continue;
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

// nearest road tile adjacent to a station
export function stationRoadTile(st) {
  for (let d = -1; d <= st.fp; d++) {
    for (const [i, j] of [[st.i + d, st.j - 1], [st.i + d, st.j + st.fp], [st.i - 1, st.j + d], [st.i + st.fp, st.j + d]]) {
      if (isRoad(i, j)) return [i, j];
    }
  }
  return null;
}

// which cargo types can be delivered (sold) at this station?
export function stationAccepts(st) {
  const { acceptors, cities } = stationCatchment(st);
  const set = new Set();
  for (const a of acceptors) set.add(a.def.accepts);
  if (cities.length) { set.add('food'); set.add('steel'); set.add('pax'); }
  return set;
}

// what does a station serve? (industries / cities in radius)
export function stationCatchment(st) {
  const producers = [], acceptors = [], cities = [];
  for (const ind of G.industries) {
    const d = Math.hypot(ind.i - st.i, ind.j - st.j);
    if (d <= STATION_RADIUS) {
      producers.push(ind);
      if (ind.def.accepts) acceptors.push(ind);
    }
  }
  for (const c of G.cities) {
    if (Math.hypot(c.ci - st.i, c.cj - st.j) <= STATION_RADIUS + 4) cities.push(c);
  }
  return { producers, acceptors, cities };
}

// ---------- industry production ----------
export function tickIndustries(gameHours) {
  for (const ind of G.industries) {
    const def = ind.def;
    let can = true;
    if (def.accepts && ind.inStock < 0.5) can = false;
    ind.wantsPower = can;
    ind.running = can && G.servedFraction > 0.5;
    if (!ind.running) continue;
    let rate = def.rate * G.servedFraction;
    // green steel: sips grid hydrogen for a +50% H2-DRI boost
    if (ind.type === 'steel' && G.h2MWh > 1) {
      const h2Use = 0.8 * gameHours;
      if (G.h2MWh > h2Use) { G.h2MWh -= h2Use; rate *= 1.5; }
      emit('tip', 'steelHungry');
    }
    const out = rate * gameHours;
    if (def.accepts) {
      const need = out * (def.perOutput || 1);
      const used = Math.min(need, ind.inStock);
      ind.inStock -= used;
      ind.stock += used / (def.perOutput || 1);
    } else {
      ind.stock += out;
    }
    ind.stock = Math.min(ind.stock, 120);
  }
  // cities generate passengers at bus stations in range
  for (const st of G.stations) {
    if (st.stype !== 'bus') continue;
    const { cities } = stationCatchment(st);
    for (const c of cities) {
      st.cargo.pax = Math.min((st.cargo.pax || 0) + c.pop * 0.004 * gameHours, 60);
      st.paxHome = c;
    }
  }
  // freight stations pull from producers in range
  for (const st of G.stations) {
    if (st.stype !== 'truck') continue;
    const { producers } = stationCatchment(st);
    for (const ind of producers) {
      if (ind.stock > 1) {
        const take = Math.min(ind.stock, 40 - (st.cargo[ind.def.produces] || 0));
        if (take > 0) {
          st.cargo[ind.def.produces] = (st.cargo[ind.def.produces] || 0) + take;
          ind.stock -= take;
        }
      }
    }
  }
}

// ---------- routes & vehicles ----------
let routeSeq = 1;
export function createRoute() {
  const r = { id: routeSeq++, name: 'Route ' + routeSeq, stops: [], vehicles: [] };
  G.routes.push(r);
  return r;
}

export function buyVehicle(route, kind) {
  const def = VEHICLES[kind];
  if (route.stops.length < 2) return null;
  const st = route.stops[0];
  const road = stationRoadTile(st);
  if (!road) return null;
  const v = {
    def, kind, route, stopIndex: 0, state: 'travel',
    i: road[0], j: road[1], path: null, pathPos: 0, prog: 0,
    battery: def.batteryKWh, cargo: {}, charging: false, waitTimer: 0,
    mesh: buildVehicleMesh(kind),
  };
  const [x, z] = worldXZ(v.i, v.j);
  v.mesh.position.set(x, tileY(v.i, v.j) + 0.1, z);
  scene.add(v.mesh);
  route.vehicles.push(v);
  G.vehicles.push(v);
  emit('vehicleBought', v);
  return v;
}

function buildVehicleMesh(kind) {
  const g = new THREE.Group();
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.4, ...o });
  if (kind === 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 1.1), M('#2e7d4f'));
    cab.position.set(1.05, 0.65, 0);
    const trailer = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 1.1), M('#e8e4da'));
    trailer.position.set(-0.45, 0.75, 0);
    g.add(cab, trailer);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.0, 1.05), M('#2a78c2'));
    body.position.set(0, 0.7, 0);
    const roofLine = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.18, 1.05), M('#dfe7ee'));
    roofLine.position.set(0, 1.28, 0);
    g.add(body, roofLine);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function sellVehicle(v) {
  scene.remove(v.mesh);
  v.route.vehicles = v.route.vehicles.filter(x => x !== v);
  G.vehicles = G.vehicles.filter(x => x !== v);
  G.money += v.def.cost * 0.4;
}

function payDelivery(cargoId, amount, dist) {
  const pay = CARGO[cargoId].pay * amount * (1 + dist / 45);
  G.money += pay;
  G.incomeTransportToday += pay;
  return pay;
}

export function tickVehicles(dt, gameHours) {
  for (const v of G.vehicles) {
    const m = G.mult;
    if (v.state === 'travel') {
      v.charging = false;
      if (!v.path) {
        const st = v.route.stops[v.stopIndex];
        if (!st) { v.state = 'wait'; continue; }
        const target = stationRoadTile(st);
        if (!target) { v.state = 'wait'; continue; }
        v.path = findPath(v.i, v.j, target[0], target[1]);
        v.pathPos = 0; v.prog = 0;
        if (!v.path) { v.state = 'stranded'; v.noRoute = true; continue; }
        v.noRoute = false;
      }
      if (v.battery <= 0) { v.state = 'stranded'; continue; }
      const speed = v.def.speed * m.vehicleSpeed * Math.min(G.speed, 10);
      v.prog += dt * speed / G.TILE;
      while (v.prog >= 1 && v.pathPos < v.path.length - 1) {
        v.prog -= 1; v.pathPos++;
        [v.i, v.j] = v.path[v.pathPos];
        v.battery -= v.def.usePerTile * m.vehicleUse;
      }
      // position & heading
      const cur = v.path[v.pathPos];
      const nxt = v.path[Math.min(v.pathPos + 1, v.path.length - 1)];
      const [x0, z0] = worldXZ(cur[0], cur[1]);
      const [x1, z1] = worldXZ(nxt[0], nxt[1]);
      const f = Math.min(v.prog, 1);
      v.mesh.position.set(x0 + (x1 - x0) * f, tileY(cur[0], cur[1]) + 0.12, z0 + (z1 - z0) * f);
      if (x1 !== x0 || z1 !== z0) v.mesh.rotation.y = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
      if (v.pathPos >= v.path.length - 1) {
        v.path = null;
        v.state = 'loading';
        v.waitTimer = 0;
        arriveAtStation(v);
      }
    } else if (v.state === 'loading') {
      // charge from the grid while loading (this demand hits the grid!)
      v.charging = v.battery < v.def.batteryKWh && G.servedFraction > 0.97;
      if (v.charging) {
        v.battery = Math.min(v.def.batteryKWh, v.battery + v.def.chargeMW * m.chargeRate * 1000 * gameHours);
        emit('tip', 'chargingLoad');
      }
      v.waitTimer += gameHours;
      const charged = v.battery > v.def.batteryKWh * 0.85;
      if (v.waitTimer > 0.5 && (charged || v.waitTimer > 3)) {
        v.stopIndex = (v.stopIndex + 1) % v.route.stops.length;
        v.state = 'travel';
        v.charging = false;
      }
    } else if (v.state === 'stranded') {
      // a service van tops it up slowly
      v.battery += 40 * gameHours;
      if (v.battery > v.def.batteryKWh * 0.25) { v.state = 'travel'; v.path = null; }
    } else if (v.state === 'wait') {
      if (v.route.stops.length >= 2) { v.state = 'travel'; v.path = null; }
    }
  }
}

function arriveAtStation(v) {
  const st = v.route.stops[v.stopIndex];
  if (!st) return;
  const { acceptors, cities } = stationCatchment(st);
  const dist = v.lastStop ? Math.hypot(st.i - v.lastStop.i, st.j - v.lastStop.j) : 10;

  // --- unload: anything accepted here
  for (const [cid, amt] of Object.entries(v.cargo)) {
    if (amt <= 0) continue;
    let accepted = false;
    if (cid === 'pax') {
      // passengers want a DIFFERENT city than where they boarded
      const target = cities.find(c => c !== v.paxFrom);
      if (target) {
        accepted = true;
        target.happiness = Math.min(1, target.happiness + 0.01);
        target.pop += Math.floor(amt * 0.1);
      }
    } else if (cid === 'food' || cid === 'steel') {
      if (cities.length) {
        accepted = true;
        cities[0].happiness = Math.min(1, cities[0].happiness + amt * 0.002);
      }
      // factories also accept their inputs
      const acc = acceptors.find(a => a.def.accepts === cid);
      if (acc) { acc.inStock += amt; accepted = true; }
    } else {
      const acc = acceptors.find(a => a.def.accepts === cid);
      if (acc) { acc.inStock += amt; accepted = true; }
    }
    if (accepted) {
      payDelivery(cid, amt, dist);
      v.cargo[cid] = 0;
    }
  }
  // --- load: only cargo that some OTHER stop on this route accepts
  const wanted = new Set();
  for (const other of v.route.stops) {
    if (other === st) continue;
    for (const cid of stationAccepts(other)) wanted.add(cid);
  }
  const freeCap = () => v.def.capacity - Object.values(v.cargo).reduce((a, b) => a + b, 0);
  if (v.kind === 'bus') {
    // passengers only board if another stop reaches a different city
    const otherCity = v.route.stops.some(o => o !== st && stationCatchment(o).cities.some(c => c !== st.paxHome));
    const take = otherCity ? Math.min(st.cargo.pax || 0, freeCap()) : 0;
    if (take > 0) {
      v.cargo.pax = (v.cargo.pax || 0) + take;
      st.cargo.pax -= take;
      v.paxFrom = st.paxHome;
    }
  } else {
    for (const cid of Object.keys(st.cargo)) {
      if (cid === 'pax' || !wanted.has(cid)) continue;
      const take = Math.min(st.cargo[cid] || 0, freeCap());
      if (take > 0) { v.cargo[cid] = (v.cargo[cid] || 0) + take; st.cargo[cid] -= take; }
    }
  }
  v.lastStop = st;
}

// city food/happiness/growth, once per game-hour
export function tickCities(gameHours) {
  for (const c of G.cities) {
    const power = G.servedFraction;
    c.happiness += ((power > 0.97 ? 0.75 : 0.2) - c.happiness) * 0.02 * gameHours;
    if (G.blackout) c.happiness = Math.max(0.05, c.happiness - 0.03 * gameHours);
    const growth = (c.happiness - 0.45) * 4 * gameHours;
    c.pop = Math.max(400, Math.floor(c.pop + growth));
  }
}
