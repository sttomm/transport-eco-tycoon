// Transport & economy simulation: A* pathfinding, stations, routes, vehicles,
// industry production, passenger demand pools, city happiness & growth.
// Pure logic — vehicle/wagon meshes and overlays live in src/render/, driven
// by the events emitted here ('vehicleBought', 'wagonAdded', 'vehicleSold',
// 'moneyFx').
import { G, emit, hourOfDay, spend, fmtMoney } from './state.js';
import { AGING, VEHICLES, WAGONS, CARGO, PAX, FREIGHT, CITY, ROUTE_COLORS, STATION_SUFFIX } from './data.js';
import { tile, isRoad, isRail, worldXZ } from './grid.js';
import { contractDelivery } from './contracts.js';

export const STATION_RADIUS = 7;
export const LOCAL_MIN_DIST = 5; // min tiles between stops for a "local" trip

// money earned by a vehicle → today's totals, per-kind and per-route breakdown
function credit(v, pay) {
  G.money += pay;
  G.incomeTransportToday += pay;
  const f = G.finance.today;
  f[v.kind] = (f[v.kind] || 0) + pay;
  f.routes[v.route.id] = (f.routes[v.route.id] || 0) + pay;
}

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
export const passableFor = v => v.kind === 'train' ? isRail : isRoad;
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
    if (G.indCurtailed) can = false; // demand response: paused while prices are at crisis levels
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
    ind.stock = Math.min(ind.stock, FREIGHT.industryStockCap);
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
    const flow = PAX.stopFlowPerHour * gameHours / stopsOfCity; // travellers walking to each stop per hour
    const waiting = () => st.pax.local + Object.values(st.pax.inter).reduce((a, b) => a + b, 0);
    if (served.local) {
      const take = Math.min(home.paxLocal, flow, Math.max(0, PAX.stopWaitingCap - waiting()));
      home.paxLocal -= take; st.pax.local += take;
    }
    G.cities.forEach((dest, di) => {
      if (dest === home || !served.inter.has(dest)) return;
      const t2 = Math.min(home.paxTo[di], flow * PAX.interFlowFrac, Math.max(0, PAX.stopWaitingCap - waiting()));
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
        const take = Math.min(ind.stock, FREIGHT.stationCap - (st.cargo[ind.def.produces] || 0));
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
  const r = { id: routeSeq++, name: 'Route ' + routeSeq, stops: [], vehicles: [], cargoCarried: {} };
  G.routes.push(r);
  return r;
}

// Toggle a station in a route's stop list: clicking a station that's already
// a stop removes that occurrence (undo / remove-a-stop), otherwise it's
// appended. Removing the last occurrence means a station can't be added twice
// in a row, which is fine — a two-stop route already ping-pongs because
// vehicles wrap stopIndex modulo stops.length. Returns the mutated list.
export function toggleRouteStop(route, station) {
  const at = route.stops.lastIndexOf(station);
  if (at !== -1) route.stops.splice(at, 1);
  else route.stops.push(station);
  return route.stops;
}

// which route kind each vehicle type belongs on
export const VEHICLE_ROUTE_KIND = { bus: 'bus', train: 'rail', truck: 'cargo' };

// A route's kind is derived from its stops' station types: bus stops → 'bus',
// rail stations → 'rail', freight depots → 'cargo'. Mixed stops: majority
// wins, ties go to 'cargo'. No stops yet → null (no kind, no validation).
export function routeKind(route) {
  if (!route.stops.length) return null;
  const counts = { bus: 0, rail: 0, cargo: 0 };
  for (const st of route.stops) {
    counts[st.stype === 'bus' ? 'bus' : st.stype === 'train' ? 'rail' : 'cargo']++;
  }
  const max = Math.max(counts.bus, counts.rail, counts.cargo);
  const winners = Object.keys(counts).filter(k => counts[k] === max);
  return winners.length > 1 ? 'cargo' : winners[0];
}

// opts.skipKindCheck is ONLY for save-restore: it grandfathers vehicles bought
// before route kinds existed (a hard reject would silently delete them on load).
export function buyVehicle(route, kind, opts = {}) {
  const def = VEHICLES[kind];
  if (route.stops.length < 2) return null;
  if (!opts.skipKindCheck) {
    const rk = routeKind(route);
    if (rk && VEHICLE_ROUTE_KIND[kind] !== rk) return null;
  }
  const st = route.stops[0];
  const road = stationRoadTile(st, kind === 'train' ? isRail : isRoad);
  if (!road) return null;
  const v = {
    def, kind, route, stopIndex: 0, state: 'travel',
    i: road[0], j: road[1], path: null, pathPos: 0, prog: 0,
    battery: def.batteryKWh, cargo: {}, charging: false, waitTimer: 0,
    wagons: [], ageDays: 0,
  };
  route.vehicles.push(v);
  G.vehicles.push(v);
  emit('vehicleBought', v);
  return v;
}

export function addWagon(v, type) {
  if (v.kind !== 'train' || v.wagons.length >= v.def.maxWagons || !WAGONS[type]) return null;
  const w = { type };
  v.wagons.push(w);
  emit('wagonAdded', { vehicle: v, wagon: w });
  return w;
}

// Player purchase wrappers: pay, then buy. They return the new object, or a
// reason string the UI turns into a message. buyVehicle()/addWagon() stay
// money-free — the save replay and DEBUG go through them directly.
//   'short'  route has fewer than 2 stops
//   'kind'   wrong vehicle type for the route's derived kind
//   'access' first stop has no adjacent road (rail for trains)
//   'full'   train already pulls its maximum wagons
//   'poor'   can't afford it
export function purchaseVehicle(route, kind) {
  if (route.stops.length < 2) return 'short';
  const rk = routeKind(route);
  if (rk && VEHICLE_ROUTE_KIND[kind] !== rk) return 'kind';
  if (!stationRoadTile(route.stops[0], kind === 'train' ? isRail : isRoad)) return 'access';
  if (!spend(VEHICLES[kind].cost)) return 'poor';
  return buyVehicle(route, kind);
}

export function purchaseWagon(v, type) {
  if (v.kind !== 'train' || !WAGONS[type]) return 'kind';
  if (v.wagons.length >= v.def.maxWagons) return 'full';
  if (!spend(WAGONS[type].cost)) return 'poor';
  return addWagon(v, type);
}

export function sellVehicle(v) {
  v.route.vehicles = v.route.vehicles.filter(x => x !== v);
  G.vehicles = G.vehicles.filter(x => x !== v);
  G.money += v.def.cost * 0.4;
  emit('vehicleSold', v);
}

// ---------- aging & fleet renewal (ADR 27) ----------
// vehicles accrue calendar age in tickVehicles; past the grace period upkeep
// ramps (vehicleUpkeep, billed by energy.js dailyUpkeep) and EV packs lose
// usable capacity (effectiveBatteryKWh). Replacement resets the clock.
const agePast = v => Math.max(0, (v.ageDays || 0) - AGING.graceDays);

export function vehicleUpkeep(v) {
  return (v.def.upkeep || 0) * Math.min(AGING.maxUpkeepMult, 1 + agePast(v) * AGING.upkeepPerDay);
}

export function effectiveBatteryKWh(v) {
  if (!v.def.batteryKWh) return 0;
  return v.def.batteryKWh * (1 - Math.min(AGING.battWearMax, agePast(v) * AGING.battWearPerDay));
}

// trade in the old vehicle for a factory-fresh one (same kind, wagons stay)
export function replaceVehicle(v) {
  if (!spend(v.def.cost * AGING.replaceFrac)) return false;
  v.ageDays = 0;
  v.battery = v.def.batteryKWh;
  emit('vehicleReplaced', v);
  return true;
}

// day-rollover hook (main.js): renew opted-in routes' aged vehicles
export function autoReplaceFleet() {
  let count = 0, cost = 0;
  for (const r of G.routes) {
    if (!r.autoReplace) continue;
    for (const v of r.vehicles) {
      if ((v.ageDays || 0) >= AGING.autoAtDays && replaceVehicle(v)) {
        count++;
        cost += v.def.cost * AGING.replaceFrac;
      }
    }
  }
  if (count) emit('toast', {
    title: '🔧 Fleet renewal',
    text: `${count} aged vehicle${count > 1 ? 's' : ''} auto-replaced overnight for ${fmtMoney(cost)} — fresh packs, base upkeep.`,
  });
  return count;
}

function payDelivery(v, cargoId, amount, dist) {
  const pay = CARGO[cargoId].pay * amount * (1 + dist / 45);
  credit(v, pay);
  return pay;
}

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

export function tickVehicles(dt, gameHours) {
  for (const v of G.vehicles) {
    const m = G.mult;
    const isTrain = v.kind === 'train';
    // calendar aging (ADR 27) — the advisor tip is one-shot in the UI
    v.ageDays = (v.ageDays || 0) + gameHours / 24;
    if (v.ageDays > AGING.graceDays) emit('tip', 'vehicleAging');
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
      if (v.pathPos >= v.path.length - 1) {
        v.path = null;
        v.state = 'loading';
        v.waitTimer = 0;
        arriveAtStation(v);
      }
    } else if (v.state === 'loading') {
      // charge from the grid while loading (this demand hits the grid!)
      // gate only on real blackouts — a slightly strained grid still charges.
      // an aged pack holds less (ADR 27), so old vehicles run shorter legs
      const packKWh = effectiveBatteryKWh(v);
      v.charging = !isTrain && v.battery < packKWh && G.servedFraction > 0.85;
      if (v.charging) {
        v.battery = Math.min(packKWh, v.battery + v.def.chargeMW * m.chargeRate * 1000 * gameHours);
        emit('tip', 'chargingLoad');
      }
      v.waitTimer += gameHours;
      // trains don't charge — they just load and go
      const charged = isTrain ? v.waitTimer > 0.6 : v.battery > packKWh * 0.85;
      if (v.waitTimer > 0.5 && (charged || v.waitTimer > 3)) {
        v.stopIndex = (v.stopIndex + 1) % v.route.stops.length;
        v.state = 'travel';
        v.charging = false;
      }
    } else if (v.state === 'stranded') {
      // a service van tops it up slowly
      v.battery += 40 * gameHours;
      if (v.battery > effectiveBatteryKWh(v) * 0.25) { v.state = 'travel'; v.path = null; }
    } else if (v.state === 'wait') {
      if (v.route.stops.length >= 2) { v.state = 'travel'; v.path = null; }
    }
  }
}

// what passenger destinations can this route deliver from stop st?
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
        credit(v, pay); paidHere += pay;
        if (grp.type === 'inter') {
          const extra = contractDelivery('pax', { fromCity: grp.from.idx, toCity: grp.dest.idx }, grp.n, pay);
          if (extra) { credit(v, extra); paidHere += extra; }
        }
        G.stats[grp.type === 'local' ? 'paxLocal' : 'paxInter'] += grp.n;
        v.route.cargoCarried.pax = true;
        if (v.kind === 'train') G.stats.railUnits += grp.n;
        if (grp.type === 'inter') grp.dest.pop += Math.floor(grp.n * 0.08);
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
      let accepted = false, destCity = null, destInd = null;
      if (cid === 'food' || cid === 'steel') {
        if (cities.length) {
          accepted = true;
          destCity = cities[0].idx;
          const lvl = cid === 'food' ? 'foodLevel' : 'goodsLevel';
          cities[0][lvl] = Math.min(1.5, (cities[0][lvl] || 0) + amt * 0.02);
          G.stats[cid + 'ToCity'] += amt;
        }
        const acc = acceptors.find(a => a.def.accepts === cid);
        if (acc) { acc.inStock += amt; accepted = true; destInd = G.industries.indexOf(acc); }
      } else {
        const acc = acceptors.find(a => a.def.accepts === cid);
        if (acc) {
          acc.inStock += amt; accepted = true; destInd = G.industries.indexOf(acc);
          if (cid === 'grain') G.stats.grainToFood += amt;
          if (cid === 'ore') G.stats.oreToSteel += amt;
        }
      }
      if (accepted) {
        v.route.cargoCarried[cid] = true; // goods actually delivered on this route (UI filter)
        const pay = payDelivery(v, cid, amt, dist);
        paidHere += pay;
        const extra = contractDelivery(cid, { toCity: destCity, toInd: destInd }, amt, pay);
        if (extra) { credit(v, extra); paidHere += extra; }
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
  if (paidHere > 0.5) emit('moneyFx', { i: st.i, j: st.j, pay: paidHere });
  v.lastStop = st;
}

// ---------- happiness ----------
// Happiness is a sum of explicit factors so the player can see what a city
// needs. Base 35% + each factor's contribution; happiness drifts toward that.

// structural check: which passenger services does this city actually have?
export function transitServices(c) {
  const res = { local: false, inter: new Set() };
  for (const r of G.routes) {
    if (!r.vehicles.some(v => paxCapacity(v) > 0)) continue;
    const mine = [], others = new Set();
    for (const s of r.stops) {
      if (s.stype !== 'bus' && s.stype !== 'train') continue;
      const { cities } = stationCatchment(s);
      if (cities.includes(c)) mine.push(s);
      for (const o of cities) if (o !== c) others.add(o);
    }
    if (mine.length) for (const o of others) res.inter.add(o);
    for (let a = 0; a < mine.length; a++) for (let b = a + 1; b < mine.length; b++)
      if (Math.hypot(mine[a].i - mine[b].i, mine[a].j - mine[b].j) >= LOCAL_MIN_DIST) res.local = true;
  }
  return res;
}

// factor list for one city — used by the simulation AND the city infobox
export function happinessFactors(c) {
  const W = CITY.weights;
  const f = [];
  const power = Math.max(0, (G.servedFraction - 0.5) / 0.5);
  f.push({ label: 'Reliable power', max: W.power, got: Math.round(W.power * power), hint: 'keep the grid stable, avoid blackouts' });
  f.push({ label: 'Food supply', max: W.food, got: Math.round(W.food * Math.min(1, c.foodLevel || 0)), hint: 'deliver Food from the Food Plant to this city (truck or train)' });
  f.push({ label: 'Goods (steel)', max: W.goods, got: Math.round(W.goods * Math.min(1, c.goodsLevel || 0)), hint: 'deliver Green Steel to this city' });
  const svc = transitServices(c);
  f.push({ label: 'Local transit', max: W.localTransit, got: svc.local ? W.localTransit : 0, hint: 'route with 2 stops in this city ≥5 tiles apart + a bus/train' });
  for (const oi of c.neighbors) {
    const o = G.cities[oi];
    f.push({ label: 'Link to ' + o.name, max: W.neighborLink, got: svc.inter.has(o) ? W.neighborLink : 0, hint: 'passenger route connecting this city with ' + o.name });
  }
  const stuck = c.paxLocal + c.paxTo.reduce((a, b) => a + b, 0);
  if (stuck > CITY.overcrowdAt) f.push({ label: 'Overcrowded stops', max: 0, got: CITY.overcrowdPenalty, hint: 'too many people stranded — add buses or stops' });
  return f;
}
export const happinessTarget = c =>
  Math.max(0.05, Math.min(1, CITY.baseHappiness + happinessFactors(c).reduce((a, x) => a + x.got, 0) / 100));

// route display color (shared by routes panel, finance rows and map highlight)
export const routeColor = r => ROUTE_COLORS[r.id % ROUTE_COLORS.length];

// city food/happiness/growth, once per game-hour
export function tickCities(gameHours) {
  // people travel mostly by day; a trickle at night
  const hod = hourOfDay();
  const tod = hod > 6.5 && hod < 22 ? PAX.dayFactor : PAX.nightFactor;
  for (const c of G.cities) {
    // travel demand: a small share of the population per (daytime) hour wants to go somewhere
    const want = c.pop * PAX.wantFrac * tod * gameHours;
    c.paxLocal = Math.min(c.paxLocal + want * PAX.localShare, Math.min(90, 25 + c.pop * 0.02));
    // intercity demand: people only travel to NEIGHBOURING cities (see
    // buildCityNeighbors in grid.js) — remote trips happen via the towns in
    // between. Within the neighbourhood a gravity model applies: bigger and
    // closer cities attract more travellers, each pair with its own cap.
    // non-neighbour pools stay empty — also drains pools restored from saves
    // made when the pair was (or graph rules were) different
    c.paxTo.forEach((n, oi) => { if (n && !c.neighbors.includes(oi)) c.paxTo[oi] = 0; });
    const totalPop = c.neighbors.reduce((a, oi) => a + G.cities[oi].pop, 0) || 1;
    for (const oi of c.neighbors) {
      const o = G.cities[oi];
      const dist = Math.hypot(o.ci - c.ci, o.cj - c.cj);
      const attract = (o.pop / totalPop) * (1.4 - Math.min(0.8, dist / 110));
      const cap = 12 + o.pop * 0.012;
      c.paxTo[oi] = Math.min(c.paxTo[oi] + want * PAX.interShare * attract, cap);
    }
    // supply levels decay — cities need a steady stream, not one delivery
    c.foodLevel = Math.max(0, (c.foodLevel || 0) - CITY.foodDecay * gameHours);
    c.goodsLevel = Math.max(0, (c.goodsLevel || 0) - CITY.goodsDecay * gameHours);
    c.happiness += (happinessTarget(c) - c.happiness) * CITY.happinessRate * gameHours;
    if (G.blackout) c.happiness = Math.max(0.05, c.happiness - CITY.blackoutHit * gameHours);
    const growth = (c.happiness - CITY.growthPivot) * CITY.growthRate * gameHours;
    c.pop = Math.max(CITY.minPop, c.pop + growth); // keep fractional — flooring here froze growth & nuked declines
  }
}

// ---------- station naming (nearest industry, else nearest city) ----------
const stationSeq = {};
export function nameStation(st) {
  let best = null, bestD = 1e9;
  for (const ind of G.industries) {
    const d = Math.hypot(ind.i - st.i, ind.j - st.j);
    if (d < bestD && d < 8) { bestD = d; best = ind.def.name; }
  }
  if (!best) {
    for (const c of G.cities) {
      const d = Math.hypot(c.ci - st.i, c.cj - st.j);
      if (d < bestD) { bestD = d; best = c.name; }
    }
  }
  stationSeq[best] = (stationSeq[best] || 0) + 1;
  st.name = `${best} ${STATION_SUFFIX[st.stype]} ${stationSeq[best] > 1 ? stationSeq[best] : ''}`.trim();
}
