// Transport & economy simulation: A* pathfinding, stations, routes, vehicles,
// industry production, passenger demand pools, city happiness & growth.
// Pure logic — vehicle/wagon meshes and overlays live in src/render/, driven
// by the events emitted here ('vehicleBought', 'wagonAdded', 'vehicleSold',
// 'moneyFx').
import { G, emit, hourOfDay } from './state.js';
import { VEHICLES, WAGONS, CARGO } from './data.js';
import { tile, isRoad, isRail, worldXZ } from './grid.js';

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

export function sellVehicle(v) {
  v.route.vehicles = v.route.vehicles.filter(x => x !== v);
  G.vehicles = G.vehicles.filter(x => x !== v);
  G.money += v.def.cost * 0.4;
  emit('vehicleSold', v);
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
  const yaw = (x1 !== x0 || z1 !== z0) ? Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2 : null;
  const onTile = f < 0.5 ? path[Math.max(0, Math.min(idx, n - 1))] : path[Math.max(0, Math.min(idx + 1, n - 1))];
  return [x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, yaw, onTile];
}

export function tickVehicles(dt, gameHours) {
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
        G.stats[grp.type === 'local' ? 'paxLocal' : 'paxInter'] += grp.n;
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
      let accepted = false;
      if (cid === 'food' || cid === 'steel') {
        if (cities.length) {
          accepted = true;
          const lvl = cid === 'food' ? 'foodLevel' : 'goodsLevel';
          cities[0][lvl] = Math.min(1.5, (cities[0][lvl] || 0) + amt * 0.02);
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
        paidHere += payDelivery(v, cid, amt, dist);
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
  const f = [];
  const power = Math.max(0, (G.servedFraction - 0.5) / 0.5);
  f.push({ label: 'Reliable power', max: 25, got: Math.round(25 * power), hint: 'keep the grid stable, avoid blackouts' });
  f.push({ label: 'Food supply', max: 15, got: Math.round(15 * Math.min(1, c.foodLevel || 0)), hint: 'deliver Food from the Food Plant to this city (truck or train)' });
  f.push({ label: 'Goods (steel)', max: 5, got: Math.round(5 * Math.min(1, c.goodsLevel || 0)), hint: 'deliver Green Steel to this city' });
  const svc = transitServices(c);
  f.push({ label: 'Local transit', max: 10, got: svc.local ? 10 : 0, hint: 'route with 2 stops in this city ≥5 tiles apart + a bus/train' });
  for (const o of G.cities) {
    if (o === c) continue;
    f.push({ label: 'Link to ' + o.name, max: 5, got: svc.inter.has(o) ? 5 : 0, hint: 'passenger route connecting this city with ' + o.name });
  }
  const stuck = c.paxLocal + c.paxTo.reduce((a, b) => a + b, 0);
  if (stuck > 120) f.push({ label: 'Overcrowded stops', max: 0, got: -10, hint: 'too many people stranded — add buses or stops' });
  return f;
}
export const happinessTarget = c =>
  Math.max(0.05, Math.min(1, 0.35 + happinessFactors(c).reduce((a, x) => a + x.got, 0) / 100));

// route display color (shared by routes panel, finance rows and map highlight)
const ROUTE_COLORS = ['#4fc3f7', '#f0c64a', '#7ed87e', '#ff6b5e', '#c08ae0', '#f0a23c', '#5fd4d0', '#e87ab0'];
export const routeColor = r => ROUTE_COLORS[r.id % ROUTE_COLORS.length];

// city food/happiness/growth, once per game-hour
export function tickCities(gameHours) {
  // people travel mostly by day; a trickle at night
  const hod = hourOfDay();
  const tod = hod > 6.5 && hod < 22 ? 1.25 : 0.3;
  for (const c of G.cities) {
    // travel demand: ~0.5% of population per (daytime) hour wants to go somewhere
    const want = c.pop * 0.005 * tod * gameHours;
    c.paxLocal = Math.min(c.paxLocal + want * 0.55, Math.min(90, 25 + c.pop * 0.02));
    // intercity demand follows a gravity model: bigger and closer cities
    // attract more travellers, and each pair has its own cap — so the numbers
    // differ per connection instead of all saturating at the same value
    const totalPop = G.cities.reduce((a, o) => a + (o === c ? 0 : o.pop), 0) || 1;
    G.cities.forEach((o, oi) => {
      if (o === c) return;
      const dist = Math.hypot(o.ci - c.ci, o.cj - c.cj);
      const attract = (o.pop / totalPop) * (1.4 - Math.min(0.8, dist / 110));
      const cap = 12 + o.pop * 0.012;
      c.paxTo[oi] = Math.min(c.paxTo[oi] + want * 0.45 * attract, cap);
    });
    // supply levels decay — cities need a steady stream, not one delivery
    c.foodLevel = Math.max(0, (c.foodLevel || 0) - 0.014 * gameHours);
    c.goodsLevel = Math.max(0, (c.goodsLevel || 0) - 0.010 * gameHours);
    c.happiness += (happinessTarget(c) - c.happiness) * 0.03 * gameHours;
    if (G.blackout) c.happiness = Math.max(0.05, c.happiness - 0.03 * gameHours);
    const growth = (c.happiness - 0.45) * 6 * gameHours;
    c.pop = Math.max(400, c.pop + growth); // keep fractional — flooring here froze growth & nuked declines
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
  const suffix = { bus: 'Stop', truck: 'Depot', train: 'Station' }[st.stype];
  st.name = `${best} ${suffix} ${stationSeq[best] > 1 ? stationSeq[best] : ''}`.trim();
}
