// Headless 30-day policy runs — the balance harness referenced by ADR 30.
//
//   node tools/policy-runs.mjs
//
// Runs six scripted player policies from a fresh world + starter grid through
// the REAL sim pipeline (tickSim at speed 10 / dt 0.1, exactly like
// test/integration.test.js) for 30 game days each, then prints a comparison
// table: end money, % gain, active-income share. Read-only w.r.t. the repo
// and the browser save — it never touches files or localStorage.
//
// Scenarios:
//   1. PASSIVE          starter grid only, do nothing
//   2. PASSIVE-WINTER   same, but the clock starts on the first winter day
//                       (day 22 — seasons are 7 days, year is 28)
//   2b. WINTER ROBUSTNESS  5-seed spring-vs-winter passive re-roll (see caveat)
//   3. BUS-CITY         2 bus stops + 2 buses in city 0
//   4. FREIGHT-CHAIN    farm → food factory → city truck chain
//   5. EXPRESS-RAIL     rail line between the closest express city pair
//   6. CONTRACT-CHASE   scenario 4's chain + auto-sign matching cargo offers
//
// CAVEAT — weather RNG is unseeded. energy.js's weather scheduler
// (Dunkelflaute/storm/heatwave rolls) draws from Math.random(), not the
// seeded world PRNG, so every scenario is one independent weather draw:
// cross-scenario END-MONEY deltas bundle the policy effect with "got a
// calmer/harsher 30 days" noise and need multi-seed averaging to trust
// (scenario 2b does exactly that for the winter question). The
// weather-INDEPENDENT signal is the isolated route P&L
// (route.earnedTotal − route.spentTotal, plus contract completion bonuses
// for scenario 6) — prefer it when judging a transport policy.
//
// Reference numbers (2026-07-16, post-WP1–10 balance): PASSIVE ≈ +92%,
// PASSIVE-WINTER ≈ +59%, FREIGHT-CHAIN ≈ +204%, contract-chasing nets
// ≈ +€95–130k over the plain freight chain. Single-run end-money figures
// wander with the weather draw; large deviations in route P&L are the
// signal that a rebalance actually moved something.
import { G, resetState, seasonOf } from '../src/sim/state.js';
import { initGrid, canPlace, place, lShapedPath, isRoad, isRail } from '../src/sim/grid.js';
import { tickSim, MIN_PER_SEC } from '../src/sim/tick.js';
import { placeStarterGrid } from '../src/sim/newGame.js';
import { createRoute, purchaseVehicle, purchaseWagon } from '../src/sim/transport.js';
import { findPath } from '../src/sim/pathfinding.js';
import { signContract } from '../src/sim/contracts.js';
import { VEHICLES, PAX } from '../src/sim/data.js';

// ---------------------------------------------------------------------------
// generic helpers (cribbed from test/helpers.js + grid.js's own lShapedPath)
// ---------------------------------------------------------------------------
function freshWorld() { resetState(); initGrid(); return G; }

// j-then-i variant of grid.js's lShapedPath (i-then-j), used as a fallback
// elbow when the default order collides with something built/occupied.
function lPathAlt(i0, j0, i1, j1) {
  const si = Math.sign(i1 - i0) || 1, sj = Math.sign(j1 - j0) || 1;
  const tiles = [];
  for (let j = j0; j !== j1 + sj; j += sj) tiles.push([i0, j]);
  for (let i = i0 + si; (si > 0 ? i <= i1 : i >= i1); i += si) tiles.push([i1, j1]);
  return tiles;
}

// lay a road/rail path tile-by-tile, skipping tiles that can't be placed
// (occupied by a city block, industry footprint, existing feature, etc).
function layPath(toolId, pts) {
  for (const [i, j] of pts) {
    if (canPlace(toolId, i, j)) place(toolId, i, j);
  }
}

// connect two anchor points with road/rail, trying the default L-elbow first
// and the alternate elbow if the default leaves the endpoints disconnected.
function connect(toolId, a, b, passable) {
  layPath(toolId, lShapedPath(a[0], a[1], b[0], b[1]));
  if (findPath(a[0], a[1], b[0], b[1], passable)) return true;
  layPath(toolId, lPathAlt(a[0], a[1], b[0], b[1]));
  return !!findPath(a[0], a[1], b[0], b[1], passable);
}

// place a station adjacent to a road/rail anchor tile (scans the 4 neighbours,
// then diagonals, for the first placeable spot).
function stationNear(toolId, anchor) {
  const offs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]];
  for (const [di, dj] of offs) {
    const i = anchor[0] + di, j = anchor[1] + dj;
    if (canPlace(toolId, i, j)) return place(toolId, i, j);
  }
  return null;
}

// a point `dist` tiles from `center`, along the ray toward `towards` — used to
// land anchors just clear of a 2x2 industry footprint on the side FACING the
// next stop (so the connecting road never crosses back through the footprint),
// and to land city stations just outside the built-up radius (~9 tiles) but
// still inside the station catchment (11 tiles), clear of the procedurally
// generated street grid / city blocks.
function anchorTowards(center, towards, dist) {
  const dx = towards[0] - center[0], dy = towards[1] - center[1];
  const len = Math.hypot(dx, dy) || 1;
  return [Math.round(center[0] + dx / len * dist), Math.round(center[1] + dy / len * dist)];
}

// run `days` game days through the REAL pipeline, speed 10 / dt 0.1, exactly
// like test/integration.test.js's playAndCheck but collecting daily report
// cards ourselves (G.reports is a 28-entry ring buffer; we want all 30).
// `onTick`, if given, runs every frame — used by CONTRACT-CHASE to auto-sign.
function runDays(days, onTick = null, { speed = 10, dt = 0.1 } = {}) {
  const reports = [];
  G.listeners.dayReport = [(r) => reports.push(r)];
  G.speed = speed;
  const gmPerTick = dt * MIN_PER_SEC * speed;
  for (let left = days * 1440; left > 0; left -= gmPerTick) {
    tickSim(dt);
    if (onTick) onTick();
  }
  return reports;
}

function summarize(reports) {
  if (!reports.length) return null;
  const nets = reports.map(r => r.net);
  const sum = a => a.reduce((x, y) => x + y, 0);
  return {
    days: reports.length,
    netMin: Math.min(...nets), netMax: Math.max(...nets), netAvg: sum(nets) / nets.length,
    blackoutH: sum(reports.map(r => r.blackoutHours)),
    flauteH: sum(reports.map(r => r.flauteHours)),
    incomeEnergy: sum(reports.map(r => r.incomeEnergy)),
    incomeTransport: sum(reports.map(r => r.incomeTransport)),
    incomeBus: sum(reports.map(r => r.incomeBus)),
    incomeTruck: sum(reports.map(r => r.incomeTruck)),
    incomeTrain: sum(reports.map(r => r.incomeTrain)),
    co2Emitted: sum(reports.map(r => r.co2Emitted)),
  };
}

const money = n => '€' + Math.round(n).toLocaleString('en-US');
const pct = n => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

const results = {};

function report(name, startMoney, reports, extra = {}) {
  const s = summarize(reports);
  const endMoney = G.money;
  const gainPct = (endMoney - startMoney) / startMoney * 100;
  const activeShare = s && (s.incomeEnergy + s.incomeTransport) > 0
    ? s.incomeTransport / (s.incomeEnergy + s.incomeTransport) * 100 : 0;
  results[name] = { startMoney, endMoney, gainPct, s, activeShare, extra };

  console.log(`\n==================== ${name} ====================`);
  if (!s) { console.log('  NO DAILY REPORTS COLLECTED (run degenerate) — skipping'); return; }
  console.log(`  days simulated (reports): ${s.days}`);
  console.log(`  start money: ${money(startMoney)}   end money: ${money(endMoney)}   gain: ${pct(gainPct)}`);
  console.log(`  net/day  min ${money(s.netMin)}  max ${money(s.netMax)}  avg ${money(s.netAvg)}`);
  console.log(`  blackout hours (total): ${s.blackoutH.toFixed(1)}h   dunkelflaute hours: ${s.flauteH.toFixed(1)}h`);
  console.log(`  CO2 emitted (30d delta): ${s.co2Emitted.toFixed(1)} t`);
  console.log(`  income — energy: ${money(s.incomeEnergy)}  transport: ${money(s.incomeTransport)} (bus ${money(s.incomeBus)}, truck ${money(s.incomeTruck)}, train ${money(s.incomeTrain)})`);
  console.log(`  active-income share (transport / (transport+energy)): ${activeShare.toFixed(1)}%`);
  for (const [k, v] of Object.entries(extra)) console.log(`  ${k}: ${v}`);
}

function skip(name, why) {
  console.log(`\n==================== ${name} ====================`);
  console.log(`  SKIPPED: ${why}`);
}

// build the farm → food factory → nearest-city truck chain used by scenarios
// 4 and 6. Returns { route, farm, food, city, foodIdx, cityIdx } on success,
// or { fail: reason } if the world layout defeated the road-builder.
function buildFreightChain() {
  const farms = G.industries.filter(x => x.type === 'farm');
  const foods = G.industries.filter(x => x.type === 'food');
  let best = null;
  for (const f of farms) for (const d of foods) {
    const dist = Math.hypot(f.i - d.i, f.j - d.j);
    if (!best || dist < best.dist) best = { farm: f, food: d, dist };
  }
  if (!best) return { fail: 'no farm/food industry pair in this world' };
  const { farm, food } = best;
  let city = null, cd = Infinity;
  for (const c of G.cities) {
    const d = Math.hypot(c.ci - food.i, c.cj - food.j);
    if (d < cd) { cd = d; city = c; }
  }
  console.log(`[setup] chain: farm@[${farm.i},${farm.j}] -> food@[${food.i},${food.j}] (${best.dist.toFixed(0)} tiles) -> ${city.name}@[${city.ci},${city.cj}] (${cd.toFixed(0)} tiles)`);

  const anchorFarm = anchorTowards([farm.i, farm.j], [food.i, food.j], 4);
  const anchorFood = anchorTowards([food.i, food.j], [farm.i, farm.j], 4);
  const anchorCity = anchorTowards([city.ci, city.cj], [food.i, food.j], 9);

  const ok1 = connect('road', anchorFarm, anchorFood, isRoad);
  const ok2 = connect('road', anchorFood, anchorCity, isRoad);
  if (!ok1 || !ok2) return { fail: `road connectivity: farm->food ${ok1}, food->city ${ok2}` };

  const depotFarm = stationNear('truckStop', anchorFarm);
  const depotFood = stationNear('truckStop', anchorFood);
  const depotCity = stationNear('truckStop', anchorCity);
  if (!depotFarm || !depotFood || !depotCity) return { fail: 'could not place all three truck stops' };

  const route = createRoute();
  route.stops.push(depotFarm, depotFood, depotCity);
  const t1 = purchaseVehicle(route, 'truck');
  const t2 = purchaseVehicle(route, 'truck');
  const t3 = purchaseVehicle(route, 'truck');
  if (typeof t1 !== 'object' || typeof t2 !== 'object') {
    return { fail: `truck purchase refused (${t1}, ${t2}, ${t3})` };
  }
  return { route, farm, food, city, foodIdx: G.industries.indexOf(food), cityIdx: city.idx };
}

// ---------------------------------------------------------------------------
// 1. PASSIVE
// ---------------------------------------------------------------------------
{
  freshWorld();
  placeStarterGrid();
  const start = G.money;
  const reports = runDays(30);
  report('1. PASSIVE', start, reports);
}

// ---------------------------------------------------------------------------
// 2. PASSIVE-WINTER — jump the clock to day 22 (first winter day, 7-day
// seasons: Spring 1-7 / Summer 8-14 / Autumn 15-21 / Winter 22-28) before
// playing. A straight day-jump leaves the carbon ramp / market-live flag
// slightly stale for the first tick; we deliberately don't fix that up —
// the point is what a winter-start run looks like, warts and all.
// ---------------------------------------------------------------------------
{
  freshWorld();
  placeStarterGrid();
  G.day = 22;
  G.minutes = 21 * 1440 + 8 * 60; // day 22, 08:00 — same time-of-day as a normal new game
  console.log(`\n[setup] PASSIVE-WINTER starts at day ${G.day}, season = ${seasonOf(G.day).name}`);
  const start = G.money;
  const reports = runDays(30);
  report('2. PASSIVE-WINTER', start, reports);
}

// ---------------------------------------------------------------------------
// 2b. WINTER ROBUSTNESS CHECK — because the weather scheduler is unseeded
// (see header), a single winter-vs-spring comparison is one noisy draw:
// winter has a 4.4x higher flaute roll multiplier than spring
// (CLIMATE.flauteMul 2.2 vs 0.5), but that's a probability, not a guarantee,
// over one 20-day sample. Re-roll 5 independent draws of each and average.
// ---------------------------------------------------------------------------
{
  console.log('\n==================== 2b. WINTER ROBUSTNESS (5 seeds x 20 days, passive) ====================');
  const springFlaute = [], winterFlaute = [], springNetMin = [], winterNetMin = [];
  for (let seed = 0; seed < 5; seed++) {
    freshWorld(); placeStarterGrid();
    const ss = summarize(runDays(20));
    springFlaute.push(ss.flauteH); springNetMin.push(ss.netMin);

    freshWorld(); placeStarterGrid();
    G.day = 22; G.minutes = 21 * 1440 + 8 * 60;
    const sw = summarize(runDays(20));
    winterFlaute.push(sw.flauteH); winterNetMin.push(sw.netMin);
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`  spring-start flaute hours per seed: [${springFlaute.map(x => x.toFixed(0)).join(', ')}]  avg ${avg(springFlaute).toFixed(1)}h`);
  console.log(`  winter-start flaute hours per seed: [${winterFlaute.map(x => x.toFixed(0)).join(', ')}]  avg ${avg(winterFlaute).toFixed(1)}h`);
  console.log(`  spring-start worst-day net per seed: [${springNetMin.map(x => money(x)).join(', ')}]`);
  console.log(`  winter-start worst-day net per seed: [${winterNetMin.map(x => money(x)).join(', ')}]`);
  results.__winterRobust = { springFlauteAvg: avg(springFlaute), winterFlauteAvg: avg(winterFlaute), springNetMinAvg: avg(springNetMin), winterNetMinAvg: avg(winterNetMin) };
}

// ---------------------------------------------------------------------------
// 3. BUS-CITY — 2 bus stops + 2 buses in city 0, cribbed from
// test/integration.test.js's bus-line test.
// ---------------------------------------------------------------------------
{
  freshWorld();
  placeStarterGrid();
  const city0 = G.cities[0];
  const stopSpot = (from) => {
    for (const rt of city0.roadTiles) {
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const i = rt.i + di, j = rt.j + dj;
        if (!canPlace('busStop', i, j)) continue;
        if (from && Math.hypot(i - from[0], j - from[1]) < 6) continue;
        return [i, j];
      }
    }
    return null;
  };
  const a = stopSpot(null);
  const b = stopSpot(a);
  if (!a || !b) {
    skip('3. BUS-CITY', `could not find two 6-tile-apart bus stop sites in ${city0.name}`);
  } else {
    const r = createRoute();
    r.stops.push(place('busStop', a[0], a[1]), place('busStop', b[0], b[1]));
    purchaseVehicle(r, 'bus');
    purchaseVehicle(r, 'bus');
    G.minutes = 9 * 60; // morning, demand pools already filling
    const start = G.money;
    const reports = runDays(30);
    report('3. BUS-CITY', start, reports, {
      'bus fares (route earnedTotal)': money(r.earnedTotal),
      'route spend (capex+upkeep)': money(r.spentTotal),
      'passengers delivered (paxLocal)': G.stats.paxLocal,
    });
    results['3. BUS-CITY'].transportProfit = r.earnedTotal - r.spentTotal;
  }
}

// ---------------------------------------------------------------------------
// 4. FREIGHT-CHAIN — real generated industries: nearest farm→food pair, then
// food→nearest city, connected by a custom road (see buildFreightChain).
// ---------------------------------------------------------------------------
{
  freshWorld();
  placeStarterGrid();
  console.log('\n[setup] FREIGHT-CHAIN');
  const chain = buildFreightChain();
  if (chain.fail) {
    skip('4. FREIGHT-CHAIN', chain.fail);
  } else {
    const start = G.money;
    const reports = runDays(30);
    const r = chain.route;
    report('4. FREIGHT-CHAIN', start, reports, {
      'truck income (route earnedTotal)': money(r.earnedTotal),
      'route spend (capex+upkeep)': money(r.spentTotal),
      'grainToFood delivered': G.stats.grainToFood.toFixed(0),
      'foodToCity delivered': G.stats.foodToCity.toFixed(0),
    });
    results['4. FREIGHT-CHAIN'].transportProfit = r.earnedTotal - r.spentTotal;
  }
}

// ---------------------------------------------------------------------------
// 5. EXPRESS-RAIL — shortest express (long-haul) pair in the world; rail line
// anchored just outside each city's built radius (same anchorTowards trick).
// ---------------------------------------------------------------------------
{
  freshWorld();
  placeStarterGrid();

  let bestPair = null;
  for (const c of G.cities) for (const oi of c.express) {
    if (oi < c.idx) continue; // dedupe symmetric pairs
    const o = G.cities[oi];
    const dist = Math.hypot(c.ci - o.ci, c.cj - o.cj);
    if (!bestPair || dist < bestPair.dist) bestPair = { a: c, b: o, dist };
  }
  if (!bestPair) {
    skip('5. EXPRESS-RAIL', 'no express city pair in this world');
  } else {
    const { a: cityA, b: cityB, dist } = bestPair;
    console.log(`\n[setup] EXPRESS-RAIL: ${cityA.name}@[${cityA.ci},${cityA.cj}] <-> ${cityB.name}@[${cityB.ci},${cityB.cj}], ${dist.toFixed(0)} tiles (expressMinDist=${PAX.expressMinDist})`);

    const anchorA = anchorTowards([cityA.ci, cityA.cj], [cityB.ci, cityB.cj], 9);
    const anchorB = anchorTowards([cityB.ci, cityB.cj], [cityA.ci, cityA.cj], 9);
    const ok = connect('rail', anchorA, anchorB, isRail);

    let fail = null, route = null;
    if (!ok) {
      fail = 'rail connectivity between the two express cities';
    } else {
      const stA = stationNear('trainStation', anchorA);
      const stB = stationNear('trainStation', anchorB);
      if (!stA || !stB) {
        fail = 'could not place both train stations';
      } else {
        route = createRoute();
        route.stops.push(stA, stB);
        const tr1 = purchaseVehicle(route, 'train');
        if (typeof tr1 !== 'object') {
          fail = `train purchase refused (${tr1})`;
        } else {
          purchaseWagon(tr1, 'pax'); purchaseWagon(tr1, 'pax');
          const tr2 = purchaseVehicle(route, 'train');
          if (typeof tr2 === 'object') { purchaseWagon(tr2, 'pax'); purchaseWagon(tr2, 'pax'); }
        }
      }
    }

    if (fail) {
      skip('5. EXPRESS-RAIL', fail);
    } else {
      const start = G.money;
      const reports = runDays(30);
      report('5. EXPRESS-RAIL', start, reports, {
        'train income (route earnedTotal)': money(route.earnedTotal),
        'route spend (capex+upkeep)': money(route.spentTotal),
        'route profit (earned - spent)': money(route.earnedTotal - route.spentTotal),
        'express pax delivered (paxInter)': G.stats.paxInter.toFixed(0),
        'trains running': route.vehicles.length,
      });
      results['5. EXPRESS-RAIL'].transportProfit = route.earnedTotal - route.spentTotal;
    }
  }
}

// ---------------------------------------------------------------------------
// 6. CONTRACT-CHASE — same chain as scenario 4, plus: from day 2 onward,
// auto-sign any open cargo offer whose relation the chain already serves
// (grain -> our food plant, or food -> our city).
// ---------------------------------------------------------------------------
{
  freshWorld();
  placeStarterGrid();
  console.log('\n[setup] CONTRACT-CHASE');
  const chain = buildFreightChain();
  if (chain.fail) {
    skip('6. CONTRACT-CHASE', chain.fail);
  } else {
    const { route, foodIdx, cityIdx } = chain;
    const start = G.money;
    let signedCount = 0;
    const reports = runDays(30, () => {
      if (G.day <= 2) return;
      for (const offer of [...G.contracts.offers]) {
        const servesGrain = offer.cargoId === 'grain' && offer.toInd === foodIdx;
        const servesFood = offer.cargoId === 'food' && offer.toCity === cityIdx;
        if (servesGrain || servesFood) { if (signContract(offer)) signedCount++; }
      }
    });
    const done = G.contracts.history.filter(h => h.outcome === 'done');
    const expired = G.contracts.history.filter(h => h.outcome === 'expired');
    const totalBonus = done.reduce((a, h) => a + (h.bonus || 0), 0);
    const totalPremium = G.contracts.history.reduce((a, h) => a + (h.earned || 0), 0);
    report('6. CONTRACT-CHASE', start, reports, {
      'truck income (route earnedTotal)': money(route.earnedTotal),
      'route spend (capex+upkeep)': money(route.spentTotal),
      'contracts signed (matching relation)': signedCount,
      'contracts done / expired (all, matching+other)': `${done.length} / ${expired.length}`,
      'completion bonuses earned': money(totalBonus),
      'delivery premiums earned': money(totalPremium),
      'vs scenario 4 baseline end money': results['4. FREIGHT-CHAIN'] ? money(G.money - results['4. FREIGHT-CHAIN'].endMoney) : 'n/a (scenario 4 skipped)',
    });
    // route.earnedTotal already includes delivery pay + contract PREMIUMS
    // (transport.js credit() books both); completion BONUSES bypass credit()
    // (paid straight to G.money in contracts.js), so add them separately here
    // for an energy-noise-free "is this route/policy worth it" number.
    results['6. CONTRACT-CHASE'].transportProfit = route.earnedTotal - route.spentTotal + totalBonus;
    results['6. CONTRACT-CHASE'].signedCount = signedCount;
    results['6. CONTRACT-CHASE'].doneCount = done.length;
    results['6. CONTRACT-CHASE'].expiredCount = expired.length;
  }
}

// ---------------------------------------------------------------------------
// final comparison table + observations
// ---------------------------------------------------------------------------
console.log('\n\n==================== COMPARISON ====================');
const rows = Object.entries(results).filter(([name]) => !name.startsWith('__'));
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('scenario', 22) + pad('end money', 16) + pad('% gain', 10) + 'active-income share');
console.log('-'.repeat(70));
for (const [name, r] of rows) {
  console.log(pad(name, 22) + pad(money(r.endMoney), 16) + pad(pct(r.gainPct), 10) + r.activeShare.toFixed(1) + '%');
}

console.log('\nObservations:');
const passive = results['1. PASSIVE'];
const winter = results['2. PASSIVE-WINTER'];
const bus = results['3. BUS-CITY'];
const freight = results['4. FREIGHT-CHAIN'];
const express = results['5. EXPRESS-RAIL'];
const chase = results['6. CONTRACT-CHASE'];

console.log('- Caveat: the weather scheduler is unseeded (see file header), so every scenario is one');
console.log('  independent weather draw — end-money deltas between scenarios bundle "policy effect"');
console.log('  with weather noise. The isolated route P&L figures below are weather-independent.');
if (passive) console.log(`- Passive 30-day gain: ${pct(passive.gainPct)} (ADR 30 intent ≈ +75%/30d as a "thin drift" baseline).`);
if (bus && passive) console.log(`- Bus-only margin over passive: ${pct(bus.gainPct - passive.gainPct)} end-money (isolated route P&L: ${money(bus.transportProfit)}), ${bus.activeShare.toFixed(1)}% of income from transport.`);
if (freight && passive) console.log(`- Freight-chain margin over passive: ${pct(freight.gainPct - passive.gainPct)} end-money (isolated route P&L: ${money(freight.transportProfit)}), ${freight.activeShare.toFixed(1)}% of income from transport — per ADR 30, transport should be the profit engine and this is its strongest single lever.`);
if (express && passive) {
  const railVerdict = express.transportProfit < 0
    ? `the isolated route P&L is NEGATIVE (${money(express.transportProfit)}: ${money(VEHICLES.train.cost)}/loco + wagons + upkeep outrun fares from a 2-city, 2-train service in 30 days) — express rail reads as a slow-payback play, not a quick profit engine over one month`
    : `the isolated route P&L is positive (${money(express.transportProfit)}) — it clears its own capex+upkeep within the 30 days`;
  console.log(`- Express-rail margin over passive: ${pct(express.gainPct - passive.gainPct)} end-money, and ${railVerdict}.`);
}
if (chase && freight && chase.transportProfit != null && freight.transportProfit != null) {
  const delta = chase.transportProfit - freight.transportProfit;
  console.log(`- Contract-chasing, isolated (route P&L + bonuses, weather-independent): ${money(chase.transportProfit)} vs ${money(freight.transportProfit)} for the same chain without chasing = ${delta >= 0 ? '+' : ''}${money(delta)} from signing ${chase.signedCount} matching offers (${chase.doneCount} done / ${chase.expiredCount} expired). Reference band 2026-07-16: +€95–130k.`);
}
if (winter && passive) console.log(`- Winter-start passive run (single draw): ${pct(winter.gainPct)} gain, ${winter.s ? winter.s.flauteH.toFixed(1) : '?'}h Dunkelflaute vs ${passive.s ? passive.s.flauteH.toFixed(1) : '?'}h in the spring-start baseline — trust the 5-seed averages below over this single draw.`);
const wr = results.__winterRobust;
if (wr) {
  const bites = wr.winterFlauteAvg > wr.springFlauteAvg * 1.2;
  console.log(`- 5-seed robustness check: avg flaute hours/20d spring ${wr.springFlauteAvg.toFixed(1)}h vs winter ${wr.winterFlauteAvg.toFixed(1)}h; avg worst-day net spring ${money(wr.springNetMinAvg)} vs winter ${money(wr.winterNetMinAvg)} — ${bites ? 'winter reliably bites harder once the weather-RNG noise is averaged out.' : 'winter is NOT reliably worse across these draws; 20-day samples are too noisy to prove the flauteMul weighting single-run.'}`);
}
