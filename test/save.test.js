// Save round trip: snapshot() a played world, rebuild a fresh world,
// restore() — the player's infrastructure, economy and progress survive.
// (The world itself is deterministic from the seed, so only deltas persist.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/sim/state.js';
import { place, tile, isRail } from '../src/sim/grid.js';
import { createRoute, buyVehicle, addWagon, routeKind } from '../src/sim/transport.js';
import { snapshot, restore } from '../src/sim/save.js';
import { freshWorld, buildRoad, buildRail, findSpot, findWater } from './helpers.js';

const J = 90;

test('snapshot → fresh world → restore preserves the whole game', () => {
  freshWorld();
  // build a little empire
  buildRoad(2, J, 20, J);
  buildRail(2, J - 6, 20, J - 6);
  const depotA = place('truckStop', 4, J - 1);
  depotA.name = 'Farm Depot';
  const depotB = place('truckStop', 16, J - 1);
  depotB.name = 'City Depot';
  const [bi, bj] = findSpot('battery');
  place('battery', bi, bj);
  const r = createRoute();
  r.name = 'Grain Express';
  r.stops.push(depotA, depotB);
  const truck = buyVehicle(r, 'truck');
  truck.cargo = { grain: 7 };
  r.spentTotal = 34000; r.earnedTotal = 51000; // WP5 lifetime counters
  // some progress
  G.money = 123456;
  G.day = 9; G.minutes = 9 * 1440 + 60;
  G.stats.grainToFood = 42;
  G.questsDone = { grainChain: true };
  G.co2SavedTons = 321;
  G.batteryMWh = 12;
  G.techs.topcon = true; G.mult.solar = 1.18;
  G.loan = 150000;
  G.contracts.offers.push({ id: 1, kind: 'cargo', cargoId: 'grain', fromCity: null, toCity: null, toInd: 2, amount: 40, mult: 1.5, bonus: 1500, progress: 0, days: 2.5, expires: G.minutes + 500, deadline: null });
  G.contracts.active.push({ id: 2, kind: 'pax', cargoId: 'pax', fromCity: 0, toCity: 1, toInd: null, amount: 30, mult: 1.5, bonus: 1000, progress: 12, days: 2.5, expires: 0, deadline: G.minutes + 900 });
  G.contracts.history.push({ id: 9, kind: 'cargo', cargoId: 'grain', outcome: 'done', closedDay: 8, earned: 900, bonus: 5000 });
  G.contracts.seq = 5;

  const snap = JSON.parse(JSON.stringify(snapshot())); // through-JSON like localStorage

  // fresh world, then restore
  freshWorld();
  assert.equal(restore(snap), true);

  assert.equal(G.money, 123456);
  assert.equal(G.day, 9);
  assert.equal(G.stats.grainToFood, 42);
  assert.equal(G.questsDone.grainChain, true);
  assert.equal(G.co2SavedTons, 321);
  assert.ok(Math.abs(G.mult.solar - 1.18) < 1e-9, 'tech effect re-applied');
  assert.equal(G.loan, 150000, 'loan restored');
  assert.equal(G.contracts.offers.length, 1, 'open offers restored');
  assert.equal(G.contracts.active[0].progress, 12, 'signed contract progress restored');
  assert.equal(G.contracts.history.length, 1, 'contract history restored');
  assert.equal(G.contracts.history[0].outcome, 'done');
  assert.equal(G.contracts.seq, 5, 'id sequence continues');

  assert.equal(tile(10, J).t, 'road', 'roads rebuilt');
  assert.equal(isRail(10, J - 6), true, 'rails rebuilt');
  assert.equal(G.plants.length, 1, 'battery rebuilt');
  assert.equal(G.batteryCapMWh, 20);
  assert.ok(Math.abs(G.batteryMWh - 12) < 1e-9, 'charge level restored');

  assert.equal(G.stations.length, 2);
  assert.deepEqual(G.stations.map(s => s.name), ['Farm Depot', 'City Depot']);
  assert.equal(G.routes.length, 1);
  assert.equal(G.routes[0].name, 'Grain Express');
  assert.equal(G.routes[0].stops.length, 2);
  assert.equal(G.routes[0].vehicles.length, 1);
  assert.deepEqual(G.routes[0].vehicles[0].cargo, { grain: 7 });
  assert.equal(G.routes[0].spentTotal, 34000, 'route lifetime spend restored (WP5)');
  assert.equal(G.routes[0].earnedTotal, 51000, 'route lifetime earnings restored (WP5)');
});

test('v5 saves (pre-WP5) restore route counters as 0, not undefined', () => {
  freshWorld();
  buildRoad(2, J, 20, J);
  const a = place('truckStop', 4, J - 1);
  const b = place('truckStop', 16, J - 1);
  const r = createRoute();
  r.stops.push(a, b);
  buyVehicle(r, 'truck');
  const snap = JSON.parse(JSON.stringify(snapshot()));
  snap.v = 5;                              // pretend it predates WP5
  delete snap.routes[0].spentTotal;        // …and the fields didn't exist yet
  delete snap.routes[0].earnedTotal;
  freshWorld();
  assert.equal(restore(snap), true, 'additive bump: v5 still loads');
  assert.equal(G.routes[0].spentTotal, 0, 'defaulted, not undefined');
  assert.equal(G.routes[0].earnedTotal, 0);
});

test('trains restore with their wagons', () => {
  freshWorld();
  buildRail(2, J, 20, J);
  const a = place('trainStation', 4, J - 2);
  const b = place('trainStation', 14, J - 2);
  const r = createRoute();
  r.stops.push(a, b);
  const train = buyVehicle(r, 'train');
  addWagon(train, 'pax');
  addWagon(train, 'freight');

  const snap = JSON.parse(JSON.stringify(snapshot()));
  freshWorld();
  assert.equal(restore(snap), true);

  const t2 = G.routes[0].vehicles[0];
  assert.equal(t2.kind, 'train');
  assert.deepEqual(t2.wagons.map(w => w.type), ['pax', 'freight']);
});

test('restore grandfathers vehicles that mismatch the route kind, keeps cargoCarried', () => {
  freshWorld();
  buildRoad(2, J, 20, J);
  const a = place('busStop', 4, J - 1);
  const b = place('busStop', 16, J - 1);
  const r = createRoute();
  r.stops.push(a, b);
  // like a pre-validation save: a truck living on what now derives as a bus route
  const truck = buyVehicle(r, 'truck', { skipKindCheck: true });
  assert.ok(truck, 'fixture vehicle created');
  r.cargoCarried = { grain: true };

  const snap = JSON.parse(JSON.stringify(snapshot()));
  freshWorld();
  assert.equal(restore(snap), true);

  assert.equal(routeKind(G.routes[0]), 'bus');
  assert.equal(G.routes[0].vehicles.length, 1, 'mismatched truck survives the load');
  assert.equal(G.routes[0].vehicles[0].kind, 'truck');
  assert.deepEqual(G.routes[0].cargoCarried, { grain: true }, 'delivered-goods memory round-trips');

  // saves from before cargoCarried existed get the safe default
  delete snap.routes[0].cargoCarried;
  freshWorld();
  assert.equal(restore(snap), true);
  assert.deepEqual(G.routes[0].cargoCarried, {});
});

test('restore rejects unknown versions', () => {
  freshWorld();
  assert.equal(restore(null), false);
  assert.equal(restore({ v: 99 }), false);
});

// PINNED v4-save policy (WP6): the river became a seeded meander into a lake,
// so water/grass tiles MOVED. A v2–v4 save replays its deltas onto the fresh
// world, and construction on a now-water tile would silently corrupt (roads
// turn into bridges, plants/stations get dropped by canPlace). We chose the
// safer, simpler break — REJECT every pre-v5 save and start fresh — matching
// the v1→v2 worldgen-change rule. This test locks that in: if someone loosens
// the version gate to "migrate" a worldgen bump, it fails here.
test('pre-v5 saves are rejected (WP6 worldgen change — no silent mis-restore)', () => {
  freshWorld();
  const snap = JSON.parse(JSON.stringify(snapshot()));
  assert.equal(snap.v, 6, 'new saves are v6');
  for (const v of [2, 3, 4]) {
    assert.equal(restore({ ...snap, v }), false, `v${v} save must be rejected, not migrated`);
  }
});

// v6 is an ADDITIVE bump (news feed, ledger, contract history, route counters)
// on the SAME worldgen as v5, so v5 saves must still load — with defaults for
// the fields v5 never had. This is the non-worldgen migration path (save.js
// version block); the pre-v5 rejection above stays untouched.
test('v5 saves still restore (additive v6 bump — news feed defaults empty)', () => {
  freshWorld();
  const snap = JSON.parse(JSON.stringify(snapshot()));
  delete snap.news;      // a genuine v5 payload had no news field
  freshWorld();
  assert.equal(restore({ ...snap, v: 5 }), true, 'v5 accepted, not rejected');
  assert.deepEqual(G.news, [], 'missing news defaults to an empty feed');
});

test('v6 round-trips the news feed', () => {
  freshWorld();
  G.news = [
    { id: 3, day: 2, minutes: 100, type: 'contract-offer', icon: '📜', headline: 'Offer', body: '', refs: null, kept: true, read: false },
  ];
  const snap = JSON.parse(JSON.stringify(snapshot()));
  freshWorld();
  assert.equal(restore(snap), true);
  assert.equal(G.news.length, 1);
  assert.equal(G.news[0].kept, true);
  assert.equal(G.news[0].headline, 'Offer');
});

test('v6 round-trips the finance ledger; v5 saves default it empty', () => {
  freshWorld();
  G.ledger.today = { energySale: 1200, gasFuel: -300, buildPlant: -5000 };
  G.ledger.days = [{ energySale: 900 }, { gridFee: -120 }];
  const snap = JSON.parse(JSON.stringify(snapshot()));
  freshWorld();
  assert.equal(restore(snap), true);
  assert.equal(G.ledger.today.energySale, 1200);
  assert.equal(G.ledger.today.buildPlant, -5000);
  assert.equal(G.ledger.days.length, 2);
  assert.equal(G.ledger.days[1].gridFee, -120);

  // a genuine v5 payload had no ledger → default empty, not undefined
  delete snap.ledger;
  freshWorld();
  assert.equal(restore({ ...snap, v: 5 }), true);
  assert.deepEqual(G.ledger, { today: {}, days: [] }, 'missing ledger defaults empty');
});

test('v5 round-trips vehicle age, route auto-replace and the import/H₂ counters', () => {
  freshWorld();
  buildRoad(2, J, 20, J);
  const a = place('truckStop', 4, J - 1);
  const b = place('truckStop', 16, J - 1);
  const r = createRoute();
  r.stops.push(a, b);
  r.autoReplace = true;
  const v = buyVehicle(r, 'truck');
  v.ageDays = 17.5;
  G.importMWhToday = 6; G.importCostToday = 570;
  G.h2SoldMWh = 220; G.h2SoldMWhToday = 14;

  const snap = JSON.parse(JSON.stringify(snapshot()));
  freshWorld();
  assert.equal(restore(snap), true);
  assert.equal(G.routes[0].autoReplace, true);
  assert.equal(G.routes[0].vehicles[0].ageDays, 17.5);
  assert.equal(G.importMWhToday, 6);
  assert.equal(G.importCostToday, 570);
  assert.equal(G.h2SoldMWh, 220);
  assert.equal(G.h2SoldMWhToday, 14);
});

test('v5 round-trips the energy-transition fields', () => {
  freshWorld();
  G.carbonPrice = 54;
  G.co2EmittedTons = 87.5;
  G.gasMWhToday = 12; G.gasCostToday = 990;
  G.fossilFreeDays = 3;
  G.gasDecommissioned = true;
  G.weatherFront = { type: 'dunkelflaute', inHours: 11, durationH: 40 };
  G.reports = [{ day: 4, energyIncome: 1000 }];

  const snap = JSON.parse(JSON.stringify(snapshot()));
  assert.equal(snap.v, 6);
  assert.ok(!('forecast' in snap), 'forecast is derived — never saved, rebuilt by updateWeather after load');

  freshWorld();
  assert.equal(restore(snap), true);
  assert.equal(G.carbonPrice, 54);
  assert.equal(G.co2EmittedTons, 87.5);
  assert.equal(G.gasMWhToday, 12);
  assert.equal(G.gasCostToday, 990);
  assert.equal(G.fossilFreeDays, 3);
  assert.equal(G.gasDecommissioned, true);
  assert.deepEqual(G.weatherFront, { type: 'dunkelflaute', inHours: 11, durationH: 40 });
  assert.deepEqual(G.reports, [{ day: 4, energyIncome: 1000 }]);
});

// WP7 (ADR 39): canPlace() gained a wind-turbine minSpacing rule, but place()
// itself never enforced it (only canPlace-gated callers do), so a save made
// before the rule existed can hold turbines closer together than it allows.
// restore() must grandfather them in via canPlace(..., { lenient: true }),
// not silently drop the "extra" one the new rule would otherwise reject.
test('save replay grandfathers turbines placed closer than minSpacing', () => {
  freshWorld();
  const [wi, wj] = findSpot('wind');
  place('wind', wi, wj);       // place() has no placement-rule check — this
  place('wind', wi + 1, wj);   // simulates a pre-rule save's adjacent turbines
  assert.equal(G.plants.filter(p => p.type === 'wind').length, 2, 'fixture: two adjacent turbines');

  const snap = JSON.parse(JSON.stringify(snapshot()));
  freshWorld();
  assert.equal(restore(snap), true);
  assert.equal(G.plants.filter(p => p.type === 'wind').length, 2,
    'both turbines survive replay — lenient replay skips the spacing rule');
});

test('a bridge over the river round-trips through v5 (water tiles restore)', () => {
  freshWorld();
  const [wi, wj] = findWater();          // a river/lake tile
  place('road', wi, wj);                  // roads over water become bridges
  assert.equal(tile(wi, wj).bridge, true, 'fixture is a bridge');

  const snap = JSON.parse(JSON.stringify(snapshot()));
  freshWorld();
  assert.equal(restore(snap), true);
  assert.equal(tile(wi, wj).t, 'road', 'bridge tile restored as road');
  assert.equal(tile(wi, wj).bridge, true, 'bridge flag re-derived from the (unchanged) water tile');
});
