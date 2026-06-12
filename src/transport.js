import * as THREE from 'three';
import { G, emit } from './state.js';
import { VEHICLES, WAGONS, CARGO } from './data.js';
import { tile, isRoad, isRail, worldXZ, tileY, makeStripeTexture } from './world.js';

const STATION_RADIUS = 7;
let scene;

export function initTransport(sc) { scene = sc; }

// ---------- pathfinding (A* over road or rail tiles) ----------
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
// the network a vehicle drives on, and the stop tile on that network
const passableFor = v => v.kind === 'train' ? isRail : isRoad;
const stopTileFor = (v, st) => stationRoadTile(st, passableFor(v));

// how many passengers / cargo units a vehicle can hold (trains: from wagons)
export function paxCapacity(v) {
  if (v.kind === 'bus') return v.def.capacity;
  if (v.kind === 'train') return v.wagons.filter(w => w.type === 'pax').length * WAGONS.pax.capacity;
  return 0;
}
export function freightCapacity(v) {
  if (v.kind === 'truck') return v.def.capacity;
  if (v.kind === 'train') return v.wagons.filter(w => w.type === 'freight').length * WAGONS.freight.capacity;
  return 0;
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
  // bus stops & rail stations collect waiting travellers from their home city's demand pool
  for (const st of G.stations) {
    if (st.stype !== 'bus' && st.stype !== 'train') continue;
    const { cities } = stationCatchment(st);
    if (!cities.length) continue;
    let home = cities[0], bd = Infinity;
    for (const c of cities) {
      const d = Math.hypot(c.ci - st.i, c.cj - st.j);
      if (d < bd) { bd = d; home = c; }
    }
    st.paxHome = home;
    st.pax = st.pax || { local: 0, inter: {} };
    // people only walk to a stop if a route with a passenger vehicle can take them where they want to go
    const served = { local: false, inter: new Set() };
    for (const r of G.routes) {
      if (!r.stops.includes(st) || !r.vehicles.some(v => paxCapacity(v) > 0)) continue;
      const s = routeServes(r, st);
      if (s.local) served.local = true;
      for (const c of s.inter) served.inter.add(c);
    }
    const stopsOfCity = G.stations.filter(s => (s.stype === 'bus' || s.stype === 'train') && s.paxHome === home).length || 1;
    const flow = 16 * gameHours / stopsOfCity;   // travellers walking to each stop per hour
    const waiting = () => st.pax.local + Object.values(st.pax.inter).reduce((a, b) => a + b, 0);
    if (served.local) {
      const take = Math.min(home.paxLocal, flow, Math.max(0, 40 - waiting()));
      home.paxLocal -= take; st.pax.local += take;
    }
    G.cities.forEach((dest, di) => {
      if (dest === home || !served.inter.has(dest)) return;
      const t2 = Math.min(home.paxTo[di], flow * 0.6, Math.max(0, 40 - waiting()));
      home.paxTo[di] -= t2;
      st.pax.inter[dest.name] = (st.pax.inter[dest.name] || 0) + t2;
    });
    st.cargo.pax = waiting(); // mirror for UI / infobox
  }
  // freight stations & rail stations pull from producers in range
  for (const st of G.stations) {
    if (st.stype !== 'truck' && st.stype !== 'train') continue;
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
  const road = stationRoadTile(st, kind === 'train' ? isRail : isRoad);
  if (!road) return null;
  const v = {
    def, kind, route, stopIndex: 0, state: 'travel',
    i: road[0], j: road[1], path: null, pathPos: 0, prog: 0,
    battery: def.batteryKWh, cargo: {}, charging: false, waitTimer: 0,
    wagons: [],
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
  const glassM = M('#18242f', { roughness: 0.12, metalness: 0.3 });
  const wheelM = M('#141618', { roughness: 0.9, metalness: 0 });
  const wheel = (x, z, r = 0.26) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.18, 10), wheelM);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, r, z);
    return w;
  };
  if (kind === 'train') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.3, 1.0, 1.0), M('#c8453c'));
    body.position.set(0, 0.7, 0);
    const nose1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.94), M('#a83830'));
    nose1.position.set(1.8, 0.58, 0);
    const nose2 = nose1.clone(); nose2.position.x = -1.8;
    const windows = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.34, 1.02), glassM);
    windows.position.set(0, 1.0, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.14, 0.92), M('#88909a'));
    roof.position.set(0, 1.28, 0);
    // pantograph reaching up to the (imaginary) catenary
    const panto = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), M('#3a4046'));
    panto.position.set(0.5, 1.65, 0); panto.rotation.z = 0.5;
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.9), M('#3a4046'));
    shoe.position.set(0.66, 1.95, 0);
    g.add(body, nose1, nose2, windows, roof, panto, shoe,
      wheel(1.3, 0.4, 0.2), wheel(1.3, -0.4, 0.2), wheel(-1.3, 0.4, 0.2), wheel(-1.3, -0.4, 0.2));
  } else if (kind === 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 1.1), M('#2e7d4f'));
    cab.position.set(1.05, 0.65, 0);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.38, 0.95), glassM);
    shield.position.set(1.5, 0.86, 0);
    const trailer = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 1.1, 1.1),
      new THREE.MeshStandardMaterial({ map: makeStripeTexture('#e8e4da', '#d6d2c6', 18), roughness: 0.5, metalness: 0.25 }),
    );
    trailer.position.set(-0.45, 0.75, 0);
    g.add(cab, shield, trailer,
      wheel(1.1, 0.46), wheel(1.1, -0.46), wheel(-0.1, 0.46), wheel(-0.1, -0.46),
      wheel(-1.1, 0.46), wheel(-1.1, -0.46));
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.0, 1.05), M('#2a78c2'));
    body.position.set(0, 0.7, 0);
    const windows = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.38, 1.08), glassM);
    windows.position.set(0.05, 0.92, 0);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.9), glassM);
    shield.position.set(1.4, 0.9, 0);
    const roofLine = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.18, 1.05), M('#dfe7ee'));
    roofLine.position.set(0, 1.28, 0);
    g.add(body, windows, shield, roofLine,
      wheel(0.95, 0.46), wheel(0.95, -0.46), wheel(-0.95, 0.46), wheel(-0.95, -0.46));
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function buildWagonMesh(type) {
  const g = new THREE.Group();
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.35, ...o });
  const wheel = (x, z) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 8), M('#141618', { roughness: 0.9, metalness: 0 }));
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.18, z);
    return w;
  };
  if (type === 'pax') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.9, 0.96), M('#3f7fbf'));
    body.position.set(0, 0.66, 0);
    const windows = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 1.0), M('#18242f', { roughness: 0.12 }));
    windows.position.set(0, 0.92, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.12, 0.88), M('#dfe7ee'));
    roof.position.set(0, 1.16, 0);
    g.add(body, windows, roof);
  } else {
    const tub = new THREE.Mesh(
      new THREE.BoxGeometry(2.9, 0.8, 0.96),
      new THREE.MeshStandardMaterial({ map: makeStripeTexture('#7a6a52', '#695a44', 12), roughness: 0.75 }),
    );
    tub.position.set(0, 0.6, 0);
    const load = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.25, 0.7), M('#55504a', { roughness: 0.95 }));
    load.position.set(0, 1.08, 0);
    load.name = 'load';
    g.add(tub, load);
  }
  g.add(wheel(1.1, 0.42), wheel(1.1, -0.42), wheel(-1.1, 0.42), wheel(-1.1, -0.42));
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function addWagon(v, type) {
  if (v.kind !== 'train' || v.wagons.length >= v.def.maxWagons || !WAGONS[type]) return null;
  const mesh = buildWagonMesh(type);
  mesh.position.copy(v.mesh.position);
  mesh.rotation.copy(v.mesh.rotation);
  scene.add(mesh);
  const w = { type, mesh };
  v.wagons.push(w);
  return w;
}

export function sellVehicle(v) {
  scene.remove(v.mesh);
  for (const w of v.wagons || []) scene.remove(w.mesh);
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

// pose at distance d (in tiles) along a path; d < 0 extrapolates behind the start
const WAGON_SPACING = 0.85;
function pathPose(path, d) {
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
  const yaw = (x1 !== x0 || z1 !== z0) ? Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2 : null;
  const onTile = f < 0.5 ? path[Math.max(0, Math.min(idx, n - 1))] : path[Math.max(0, Math.min(idx + 1, n - 1))];
  return [x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, yaw, onTile];
}

function updateTrainWagons(v) {
  if (!v.path || !v.path.length) return;
  const D = v.pathPos + Math.min(v.prog, 1);
  v.wagons.forEach((w, k) => {
    const [x, z, yaw, ti] = pathPose(v.path, D - (k + 1) * WAGON_SPACING);
    w.mesh.position.set(x, tileY(ti[0], ti[1]) + 0.12, z);
    if (yaw !== null) w.mesh.rotation.y = yaw;
  });
}

export function tickVehicles(dt, gameHours) {
  updateFx(dt);
  for (const v of G.vehicles) {
    const m = G.mult;
    const isTrain = v.kind === 'train';
    if (v.state === 'travel') {
      v.charging = false;
      if (!v.path) {
        const st = v.route.stops[v.stopIndex];
        if (!st) { v.state = 'wait'; continue; }
        const target = stopTileFor(v, st);
        if (!target) { v.state = 'wait'; continue; }
        v.path = findPath(v.i, v.j, target[0], target[1], passableFor(v));
        v.pathPos = 0; v.prog = 0;
        if (!v.path) { v.state = 'stranded'; v.noRoute = true; continue; }
        v.noRoute = false;
      }
      if (!isTrain && v.battery <= 0) { v.state = 'stranded'; continue; }
      let speed = v.def.speed * m.vehicleSpeed * Math.min(G.speed, 10);
      // trains feed off the live grid: a strained grid slows them, a blackout stops them
      if (isTrain) speed *= Math.max(0, (G.servedFraction - 0.2) / 0.8);
      v.prog += dt * speed / G.TILE;
      while (v.prog >= 1 && v.pathPos < v.path.length - 1) {
        v.prog -= 1; v.pathPos++;
        [v.i, v.j] = v.path[v.pathPos];
        if (!isTrain) v.battery -= v.def.usePerTile * m.vehicleUse;
      }
      // position & heading
      const cur = v.path[v.pathPos];
      const nxt = v.path[Math.min(v.pathPos + 1, v.path.length - 1)];
      const [x0, z0] = worldXZ(cur[0], cur[1]);
      const [x1, z1] = worldXZ(nxt[0], nxt[1]);
      const f = Math.min(v.prog, 1);
      v.mesh.position.set(x0 + (x1 - x0) * f, tileY(cur[0], cur[1]) + 0.12, z0 + (z1 - z0) * f);
      if (x1 !== x0 || z1 !== z0) v.mesh.rotation.y = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
      if (isTrain) updateTrainWagons(v);
      if (v.pathPos >= v.path.length - 1) {
        v.path = null;
        v.state = 'loading';
        v.waitTimer = 0;
        arriveAtStation(v);
      }
    } else if (v.state === 'loading') {
      // charge from the grid while loading (this demand hits the grid!)
      // gate only on real blackouts — a slightly strained grid still charges
      v.charging = !isTrain && v.battery < v.def.batteryKWh && G.servedFraction > 0.85;
      if (v.charging) {
        v.battery = Math.min(v.def.batteryKWh, v.battery + v.def.chargeMW * m.chargeRate * 1000 * gameHours);
        emit('tip', 'chargingLoad');
      }
      v.waitTimer += gameHours;
      // trains don't charge — they just load and go
      const charged = isTrain ? v.waitTimer > 0.6 : v.battery > v.def.batteryKWh * 0.85;
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

// what passenger destinations can this route deliver from stop st?
const LOCAL_MIN_DIST = 5;
export function routeServes(route, st) {
  const home = st.paxHome;
  const res = { local: false, inter: [] };
  for (const o of route.stops) {
    if (o === st) continue;
    const { cities } = stationCatchment(o);
    for (const c of cities) {
      if (c === home) {
        if (Math.hypot(o.i - st.i, o.j - st.j) >= LOCAL_MIN_DIST) res.local = true;
      } else if (!res.inter.includes(c)) res.inter.push(c);
    }
  }
  return res;
}

function arriveAtStation(v) {
  const st = v.route.stops[v.stopIndex];
  if (!st) return;
  const { acceptors, cities } = stationCatchment(st);
  const dist = v.lastStop ? Math.hypot(st.i - v.lastStop.i, st.j - v.lastStop.j) : 10;
  let paidHere = 0;
  const pCap = paxCapacity(v), fCap = freightCapacity(v);

  if (pCap > 0) {
    // --- unload passenger groups whose destination this stop serves
    v.pax = v.pax || [];
    const keep = [];
    for (const grp of v.pax) {
      const ride = Math.hypot(st.i - grp.fi, st.j - grp.fj);
      const deliver = grp.type === 'local'
        ? cities.includes(grp.from) && ride >= LOCAL_MIN_DIST
        : cities.includes(grp.dest);
      if (deliver) {
        const rate = grp.type === 'local' ? CARGO.pax.payLocal : CARGO.pax.pay;
        const pay = rate * grp.n * (1 + ride / 50);
        G.money += pay; G.incomeTransportToday += pay; paidHere += pay;
        G.stats[grp.type === 'local' ? 'paxLocal' : 'paxInter'] += grp.n;
        if (v.kind === 'train') G.stats.railUnits += grp.n;
        const cityRef = grp.type === 'local' ? grp.from : grp.dest;
        cityRef.happiness = Math.min(1, cityRef.happiness + grp.n * 0.0015);
        if (grp.type === 'inter') cityRef.pop += Math.floor(grp.n * 0.08);
      } else keep.push(grp);
    }
    v.pax = keep;
    // --- board only travellers this route can actually deliver
    if (st.pax && st.paxHome) {
      const serves = routeServes(v.route, st);
      const room = () => pCap - v.pax.reduce((a, g) => a + g.n, 0);
      if (serves.local && st.pax.local >= 1 && room() >= 1) {
        const n = Math.floor(Math.min(st.pax.local, room()));
        if (n) { st.pax.local -= n; v.pax.push({ type: 'local', n, from: st.paxHome, fi: st.i, fj: st.j }); }
      }
      for (const dest of serves.inter) {
        const n = Math.floor(Math.min(st.pax.inter[dest.name] || 0, room()));
        if (n >= 1) { st.pax.inter[dest.name] -= n; v.pax.push({ type: 'inter', n, dest, from: st.paxHome, fi: st.i, fj: st.j }); }
      }
      st.cargo.pax = st.pax.local + Object.values(st.pax.inter).reduce((a, b) => a + b, 0);
    }
  }
  if (fCap > 0) {
    // --- unload: anything accepted here
    for (const [cid, amt] of Object.entries(v.cargo)) {
      if (amt <= 0) continue;
      let accepted = false;
      if (cid === 'food' || cid === 'steel') {
        if (cities.length) {
          accepted = true;
          cities[0].happiness = Math.min(1, cities[0].happiness + amt * 0.002);
          G.stats[cid + 'ToCity'] += amt;
        }
        const acc = acceptors.find(a => a.def.accepts === cid);
        if (acc) { acc.inStock += amt; accepted = true; }
      } else {
        const acc = acceptors.find(a => a.def.accepts === cid);
        if (acc) {
          acc.inStock += amt; accepted = true;
          if (cid === 'grain') G.stats.grainToFood += amt;
          if (cid === 'ore') G.stats.oreToSteel += amt;
        }
      }
      if (accepted) {
        paidHere += payDelivery(cid, amt, dist);
        if (v.kind === 'train') G.stats.railUnits += amt;
        v.cargo[cid] = 0;
      }
    }
    // --- load: only cargo that some OTHER stop on this route accepts
    const wanted = new Set();
    for (const other of v.route.stops) {
      if (other === st) continue;
      for (const cid of stationAccepts(other)) wanted.add(cid);
    }
    const freeCap = () => fCap - Object.values(v.cargo).reduce((a, b) => a + b, 0);
    for (const cid of Object.keys(st.cargo)) {
      if (cid === 'pax' || !wanted.has(cid)) continue;
      const take = Math.min(st.cargo[cid] || 0, freeCap());
      if (take > 0) { v.cargo[cid] = (v.cargo[cid] || 0) + take; st.cargo[cid] -= take; }
    }
  }
  if (paidHere > 0.5) spawnMoneyFx(st, paidHere);
  v.lastStop = st;
}

// ---------- floating text & demand overlay ----------
function makeTextSprite(lines, { color = '#ffffff', size = 2.4, bg = 'rgba(8,14,22,0.74)' } = {}) {
  if (!Array.isArray(lines)) lines = [lines];
  const font = '600 30px "Segoe UI", system-ui, sans-serif';
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = font;
  const w = Math.ceil(Math.max(...lines.map(l => meas.measureText(l.text ?? l).width)) + 30);
  const lh = 38, h = lines.length * lh + 16;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  if (bg) {
    cx.fillStyle = bg;
    cx.beginPath(); cx.roundRect(0, 0, w, h, 12); cx.fill();
  }
  cx.font = font; cx.textAlign = 'center'; cx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    cx.fillStyle = l.color || color;
    cx.fillText(l.text ?? l, w / 2, 8 + lh * i + lh / 2);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  const sH = lines.length * size + 0.4;
  sp.scale.set(sH * w / h, sH, 1);
  sp.renderOrder = 50;
  return sp;
}

const fxList = [];
function spawnMoneyFx(st, pay) {
  const [x, z] = worldXZ(st.i, st.j);
  const sp = makeTextSprite('+€' + Math.round(pay).toLocaleString(), { color: '#9fe87e', size: 2.1, bg: null });
  sp.position.set(x, tileY(st.i, st.j) + 4, z);
  scene.add(sp);
  fxList.push({ sp, t: 0 });
}
function updateFx(dt) {
  for (let k = fxList.length - 1; k >= 0; k--) {
    const f = fxList[k];
    f.t += dt;
    f.sp.position.y += dt * 2.4;
    f.sp.material.opacity = Math.max(0, 1 - f.t / 1.8);
    if (f.t > 1.8) {
      scene.remove(f.sp);
      f.sp.material.map.dispose(); f.sp.material.dispose();
      fxList.splice(k, 1);
    }
  }
}

let overlayGroup = null, overlayTimer = 9;
export function updateDemandOverlay(dt) {
  overlayTimer += dt;
  if (!G.showDemand) { if (overlayGroup) disposeOverlay(); return; }
  if (overlayGroup && overlayTimer < 1.2) return;
  overlayTimer = 0;
  disposeOverlay();
  overlayGroup = new THREE.Group();
  // city labels: who is waiting, and where they want to go
  for (const c of G.cities) {
    const total = Math.round(c.paxLocal + c.paxTo.reduce((a, b) => a + b, 0));
    const lines = [
      { text: `${c.name} · 👥 ${total} waiting`, color: '#ffffff' },
      { text: `${Math.round(c.paxLocal)} around town`, color: '#9fd0ff' },
    ];
    G.cities.forEach((o, oi) => {
      if (o !== c && c.paxTo[oi] >= 1) lines.push({ text: `${Math.round(c.paxTo[oi])} → ${o.name}`, color: '#f0c64a' });
    });
    const sp = makeTextSprite(lines, { size: 2.6 });
    const [x, z] = worldXZ(c.ci, c.cj);
    sp.position.set(x, tileY(c.ci, c.cj) + 26, z);
    overlayGroup.add(sp);
  }
  // arcs: intercity travel demand between city pairs
  for (let a = 0; a < G.cities.length; a++) for (let b = a + 1; b < G.cities.length; b++) {
    const ca = G.cities[a], cb = G.cities[b];
    const n = ca.paxTo[b] + cb.paxTo[a];
    if (n < 3) continue;
    const [xa, za] = worldXZ(ca.ci, ca.cj), [xb, zb] = worldXZ(cb.ci, cb.cj);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(xa, 8, za),
      new THREE.Vector3((xa + xb) / 2, 30 + n * 0.1, (za + zb) / 2),
      new THREE.Vector3(xb, 8, zb),
    );
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 24, Math.min(0.8, 0.15 + n / 70), 6),
      new THREE.MeshBasicMaterial({ color: '#f0a23c', transparent: true, opacity: 0.6, depthWrite: false }),
    );
    overlayGroup.add(tube);
  }
  // bus stop / rail station badges, colored by crowding
  for (const st of G.stations) {
    if ((st.stype !== 'bus' && st.stype !== 'train') || !st.pax) continue;
    const n = Math.round(st.cargo.pax || 0);
    const color = n >= 30 ? '#ff6b5e' : n >= 15 ? '#f0c64a' : '#9fe87e';
    const sp = makeTextSprite(`${st.stype === 'bus' ? '🚏' : '🚉'} ${n}`, { color, size: 1.8 });
    const [x, z] = worldXZ(st.i, st.j);
    sp.position.set(x, tileY(st.i, st.j) + 5, z);
    overlayGroup.add(sp);
  }
  scene.add(overlayGroup);
}
function disposeOverlay() {
  if (!overlayGroup) return;
  overlayGroup.traverse(o => {
    if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    if (o.geometry) o.geometry.dispose();
  });
  scene.remove(overlayGroup);
  overlayGroup = null;
}

// city food/happiness/growth, once per game-hour
export function tickCities(gameHours) {
  for (const c of G.cities) {
    // travel demand: ~0.5% of population per hour wants to go somewhere
    const want = c.pop * 0.005 * gameHours;
    c.paxLocal = Math.min(c.paxLocal + want * 0.6, 90);
    const others = Math.max(1, G.cities.length - 1);
    G.cities.forEach((o, oi) => {
      if (o !== c) c.paxTo[oi] = Math.min(c.paxTo[oi] + want * 0.4 / others, 60);
    });
    const power = G.servedFraction;
    c.happiness += ((power > 0.97 ? 0.75 : 0.2) - c.happiness) * 0.02 * gameHours;
    if (G.blackout) c.happiness = Math.max(0.05, c.happiness - 0.03 * gameHours);
    // big stranded crowds make people grumpy — bus service fixes it
    const stuck = c.paxLocal + c.paxTo.reduce((a, b) => a + b, 0);
    if (stuck > 150) c.happiness = Math.max(0.05, c.happiness - 0.004 * gameHours);
    const growth = (c.happiness - 0.45) * 6 * gameHours;
    c.pop = Math.max(400, c.pop + growth); // keep fractional — flooring here froze growth & nuked declines
  }
}
