// Routes & vehicles: route editing, vehicle purchase/aging/replacement, and
// tickVehicles — movement, charging, loading and delivery pay.
// Siblings: pathfinding.js (A*/poses), stations.js (catchment/naming),
// industries.js (production & station loading), cities.js (demand/happiness).
// Pure logic — vehicle/wagon meshes and overlays live in src/render/, driven
// by the events emitted here ('vehicleBought', 'wagonAdded', 'vehicleSold',
// 'vehicleReplaced', 'moneyFx').
import { G, emit, spend, earn, fmtMoney } from './state.js';
import { AGING, VEHICLES, WAGONS, CARGO, ROUTE_COLORS } from './data.js';
import { book } from './finance.js';
import { isRoad, isRail } from './grid.js';
import { contractDelivery } from './contracts.js';
import { findPath, stationRoadTile, passableFor } from './pathfinding.js';
import { stationCatchment, stationAccepts, LOCAL_MIN_DIST } from './stations.js';

// which ledger category each vehicle kind's delivery income books under
const INCOME_CAT = { bus: 'transportBus', truck: 'transportTruck', train: 'transportTrain' };

// money earned by a vehicle → today's totals, per-kind and per-route breakdown,
// plus the route's lifetime earnings (WP5 per-route economics; persisted).
function credit(v, pay) {
  G.money += pay;
  G.incomeTransportToday += pay;
  book(INCOME_CAT[v.kind], pay);
  const f = G.finance.today;
  f[v.kind] = (f[v.kind] || 0) + pay;
  f.routes[v.route.id] = (f.routes[v.route.id] || 0) + pay;
  v.route.earnedTotal = (v.route.earnedTotal || 0) + pay;
}

// the stop tile on the network a vehicle drives on
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

// ---------- routes & vehicles ----------
let routeSeq = 1;
export function createRoute() {
  // spentTotal / earnedTotal: lifetime cost & income attributed to this route
  // (WP5). Persisted; the route card shows profit = earnedTotal − spentTotal.
  const r = { id: routeSeq++, name: 'Route ' + routeSeq, stops: [], vehicles: [], cargoCarried: {}, spentTotal: 0, earnedTotal: 0 };
  G.routes.push(r);
  return r;
}

// Add / remove / finish while editing a route's stop list. Returns a status:
//   'finished' — clicked the FIRST stop of a ≥2-stop route: traversal already
//                loops back automatically (stopIndex wraps modulo length), so
//                re-adding the origin to "close the loop" is never needed. This
//                finishes editing (like ✔ Done) and toasts the player why. The
//                origin is NOT re-added — no duplicate stops, no save impact.
//   'removed'  — clicked an existing (non-origin) stop: toggle it out.
//   'added'    — clicked a new station: append it.
export function toggleRouteStop(route, station) {
  if (route.stops.length >= 2 && station === route.stops[0]) {
    if (G.routeEdit === route) G.routeEdit = null;
    emit('toast', { title: '↻ Route loops back', text: 'Routes return to the first stop automatically — no need to re-add it.' });
    return 'finished';
  }
  const at = route.stops.lastIndexOf(station);
  if (at !== -1) { route.stops.splice(at, 1); return 'removed'; }
  route.stops.push(station);
  return 'added';
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
  if (!spend(VEHICLES[kind].cost, 'buyVehicle')) return 'poor';
  route.spentTotal = (route.spentTotal || 0) + VEHICLES[kind].cost; // WP5 per-route capex
  return buyVehicle(route, kind);
}

export function purchaseWagon(v, type) {
  if (v.kind !== 'train' || !WAGONS[type]) return 'kind';
  if (v.wagons.length >= v.def.maxWagons) return 'full';
  if (!spend(WAGONS[type].cost, 'buyWagon')) return 'poor';
  v.route.spentTotal = (v.route.spentTotal || 0) + WAGONS[type].cost; // WP5
  return addWagon(v, type);
}

export function sellVehicle(v) {
  v.route.vehicles = v.route.vehicles.filter(x => x !== v);
  G.vehicles = G.vehicles.filter(x => x !== v);
  const tradeIn = v.def.cost * 0.4;
  earn(tradeIn, 'buyVehicle'); // trade-in credit offsets vehicle capex
  v.route.spentTotal = Math.max(0, (v.route.spentTotal || 0) - tradeIn); // recover route capex
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
  const cost = v.def.cost * AGING.replaceFrac;
  if (!spend(cost, 'replaceFleet')) return false;
  if (v.route) v.route.spentTotal = (v.route.spentTotal || 0) + cost; // WP5 per-route capex
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

// route display color (shared by routes panel, finance rows and map highlight)
export const routeColor = r => ROUTE_COLORS[r.id % ROUTE_COLORS.length];
