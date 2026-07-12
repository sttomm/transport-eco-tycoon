// Vehicle lifecycle: purchase rules, battery/stranding, wagons, and the
// train's live coupling to the grid (no battery — blackout stops it).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, on } from '../src/sim/state.js';
import { place } from '../src/sim/grid.js';
import { tickVehicles, createRoute, buyVehicle, addWagon, purchaseVehicle, purchaseWagon, sellVehicle, paxCapacity, freightCapacity, routeKind, vehicleUpkeep, effectiveBatteryKWh, replaceVehicle, autoReplaceFleet } from '../src/sim/transport.js';
import { AGING, VEHICLES, WAGONS } from '../src/sim/data.js';
import { freshWorld, buildRoad, buildRail } from './helpers.js';

const J = 90;

beforeEach(() => freshWorld());

function roadRoute(stype = 'truckStop') {
  buildRoad(2, J, 20, J);
  const a = place(stype, 4, J - 1);
  const b = place(stype, 16, J - 1);
  const r = createRoute();
  r.stops.push(a, b);
  return r;
}

function railRoute() {
  buildRail(2, J, 20, J);
  const a = place('trainStation', 4, J - 2);
  const b = place('trainStation', 14, J - 2);
  const r = createRoute();
  r.stops.push(a, b);
  return r;
}

function step(n = 1, dt = 0.1) {
  G.speed = 10;
  const gh = dt * 8 * G.speed / 60;
  for (let k = 0; k < n; k++) tickVehicles(dt, gh);
}

test('buyVehicle refuses routes with fewer than 2 stops or no network access', () => {
  const r = createRoute();
  assert.equal(buyVehicle(r, 'truck'), null);
  // stations in the middle of nowhere: no adjacent road
  r.stops.push({ i: 40, j: 90, fp: 1 }, { i: 44, j: 90, fp: 1 });
  assert.equal(buyVehicle(r, 'truck'), null);
});

test('buying a vehicle emits the event the renderer listens to', () => {
  const events = [];
  on('vehicleBought', v => events.push(v));
  const r = roadRoute();
  const v = buyVehicle(r, 'truck');
  assert.deepEqual(events, [v]);
  assert.equal(G.vehicles.length, 1);
});

test('an empty truck drives the route and keeps its battery topped up', () => {
  const r = roadRoute();
  const v = buyVehicle(r, 'truck');
  step(300);
  assert.ok(v.battery > 0, 'charging at stops keeps it alive');
  assert.ok(['travel', 'loading'].includes(v.state));
});

test('a drained vehicle strands, the service van revives it', () => {
  const r = roadRoute();
  const v = buyVehicle(r, 'truck');
  v.battery = 0;
  step(1);
  assert.equal(v.state, 'stranded');
  step(200); // service van tops up 40 kWh per game hour
  assert.notEqual(v.state, 'stranded');
});

test('routeKind derives from stop station types (majority, tie → cargo)', () => {
  buildRoad(2, J, 20, J);
  const bus1 = place('busStop', 4, J - 1), bus2 = place('busStop', 8, J - 1);
  const depot = place('truckStop', 12, J - 1);
  buildRail(2, J - 6, 20, J - 6);
  const rail1 = place('trainStation', 4, J - 8);

  const r = createRoute();
  assert.equal(routeKind(r), null, 'no stops → no kind yet');
  r.stops.push(bus1);
  assert.equal(routeKind(r), 'bus');
  r.stops.push(bus2, depot);
  assert.equal(routeKind(r), 'bus', 'majority of bus stops wins');
  r.stops.length = 0;
  r.stops.push(rail1, rail1);
  assert.equal(routeKind(r), 'rail');
  r.stops.length = 0;
  r.stops.push(depot, bus1);
  assert.equal(routeKind(r), 'cargo', 'mixed tie resolves to cargo');
  r.stops.length = 0;
  r.stops.push(bus1, rail1);
  assert.equal(routeKind(r), 'cargo', 'bus/rail tie also resolves to cargo');
});

test('buyVehicle rejects a vehicle kind that mismatches the route kind', () => {
  const r = roadRoute(); // truck stops → cargo route
  const before = G.money;
  assert.equal(buyVehicle(r, 'bus'), null, 'no buses on a cargo route');
  assert.equal(buyVehicle(r, 'train'), null, 'no trains on a cargo route');
  assert.equal(G.money, before, 'nothing charged');
  assert.equal(G.vehicles.length, 0);
  assert.ok(buyVehicle(r, 'truck'), 'matching kind accepted');
});

test('bus routes take buses; the restore-only bypass grandfathers mismatches', () => {
  const r = roadRoute('busStop');
  assert.equal(routeKind(r), 'bus');
  assert.ok(buyVehicle(r, 'bus'));
  assert.equal(buyVehicle(r, 'truck'), null, 'new purchases are validated');
  const v = buyVehicle(r, 'truck', { skipKindCheck: true });
  assert.ok(v, 'save-restore bypass keeps legacy vehicles alive');
  assert.equal(v.kind, 'truck');
});

test('capacity comes from the vehicle type; trains from their wagons', () => {
  buildRoad(2, J, 20, J);
  const rb = createRoute();
  rb.stops.push(place('busStop', 4, J - 1), place('busStop', 16, J - 1));
  const rt = createRoute();
  rt.stops.push(place('truckStop', 6, J - 1), place('truckStop', 18, J - 1));
  const bus = buyVehicle(rb, 'bus');
  const truck = buyVehicle(rt, 'truck');
  assert.equal(paxCapacity(bus), 30);
  assert.equal(freightCapacity(bus), 0);
  assert.equal(freightCapacity(truck), 18);
  assert.equal(paxCapacity(truck), 0);
});

test('trains: wagons give capacity, capped at maxWagons', () => {
  const r = railRoute();
  const train = buyVehicle(r, 'train');
  assert.ok(train, 'rail access ok');
  assert.equal(paxCapacity(train), 0, 'a bare locomotive carries nothing');
  addWagon(train, 'pax');
  addWagon(train, 'freight');
  assert.equal(paxCapacity(train), 40);
  assert.equal(freightCapacity(train), 30);
  for (let k = 0; k < 10; k++) addWagon(train, 'freight');
  assert.equal(train.wagons.length, train.def.maxWagons);
});

test('a blackout stops trains; a healthy grid moves them', () => {
  const r = railRoute();
  const train = buyVehicle(r, 'train');

  G.servedFraction = 0; // total blackout — no traction power
  step(50);
  assert.equal(train.pathPos, 0, 'train frozen without grid power');

  G.servedFraction = 1;
  step(50);
  assert.ok(train.pathPos > 0, 'train moves again');
});

// ---- aging & fleet renewal (ADR 27) ---------------------------------------

test('vehicles age with game time; upkeep ramps after the grace period, capped', () => {
  const r = roadRoute();
  const v = buyVehicle(r, 'truck');
  assert.equal(v.ageDays, 0);
  step(90); // 90 × 0.1333 gh = 12 gh = half a day
  assert.ok(Math.abs(v.ageDays - 0.5) < 0.01, 'calendar age accrues');
  v.ageDays = AGING.graceDays;
  assert.equal(vehicleUpkeep(v), v.def.upkeep, 'list upkeep through the grace period');
  v.ageDays = AGING.graceDays + 10;
  assert.ok(Math.abs(vehicleUpkeep(v) - v.def.upkeep * 2) < 1e-9, '+10%/day past grace');
  v.ageDays = 999;
  assert.equal(vehicleUpkeep(v), v.def.upkeep * AGING.maxUpkeepMult, 'capped at 3×');
});

test('EV packs wear with age, floored at 65% of original capacity', () => {
  const r = roadRoute();
  const v = buyVehicle(r, 'truck');
  assert.equal(effectiveBatteryKWh(v), v.def.batteryKWh);
  v.ageDays = AGING.graceDays + 10;
  assert.ok(Math.abs(effectiveBatteryKWh(v) - v.def.batteryKWh * 0.85) < 1e-9);
  v.ageDays = 999;
  assert.ok(Math.abs(effectiveBatteryKWh(v) - v.def.batteryKWh * (1 - AGING.battWearMax)) < 1e-9);
});

test('replaceVehicle: trade-in price, resets age and pack; refuses without funds', () => {
  const r = roadRoute();
  const v = buyVehicle(r, 'truck');
  v.ageDays = 30; v.battery = 12;
  G.money = 100;
  assert.equal(replaceVehicle(v), false, 'no funds, no trade-in');
  assert.equal(v.ageDays, 30);
  G.money = 100000;
  const before = G.money;
  assert.equal(replaceVehicle(v), true);
  assert.equal(G.money, before - v.def.cost * AGING.replaceFrac);
  assert.equal(v.ageDays, 0);
  assert.equal(v.battery, v.def.batteryKWh, 'factory-fresh pack');
});

test('autoReplaceFleet renews only opted-in routes and only aged vehicles', () => {
  const rA = roadRoute();
  const young = buyVehicle(rA, 'truck');
  const old = buyVehicle(rA, 'truck');
  old.ageDays = AGING.autoAtDays + 1;
  const rB = createRoute();
  rB.stops.push(rA.stops[0], rA.stops[1]);
  const oldB = buyVehicle(rB, 'truck', { skipKindCheck: true });
  oldB.ageDays = AGING.autoAtDays + 5;

  rA.autoReplace = true; // rB stays opted out
  assert.equal(autoReplaceFleet(), 1, 'one vehicle qualified');
  assert.equal(old.ageDays, 0, 'aged vehicle on the opted-in route renewed');
  assert.equal(young.ageDays, 0, 'young vehicle untouched (was already 0)');
  assert.equal(oldB.ageDays, AGING.autoAtDays + 5, 'opted-out route keeps its clunker');

  G.money = 0;
  old.ageDays = AGING.autoAtDays + 1;
  assert.equal(autoReplaceFleet(), 0, 'no funds, no renewal');
});

test('selling a vehicle refunds 40% and removes it everywhere', () => {
  const r = roadRoute();
  const v = buyVehicle(r, 'truck');
  const events = [];
  on('vehicleSold', x => events.push(x));
  const before = G.money;
  sellVehicle(v);
  assert.equal(G.money, before + v.def.cost * 0.4);
  assert.equal(G.vehicles.length, 0);
  assert.equal(r.vehicles.length, 0);
  assert.deepEqual(events, [v]);
});

// ---------- player purchase wrappers (sim charges & explains refusals) ----------

test('purchaseVehicle charges the sim-side cost and reports refusal reasons', () => {
  assert.equal(purchaseVehicle(createRoute(), 'truck'), 'short');
  const r = roadRoute();
  assert.equal(purchaseVehicle(r, 'bus'), 'kind', 'truck depots derive a cargo route');
  G.money = VEHICLES.truck.cost - 1;
  assert.equal(purchaseVehicle(r, 'truck'), 'poor');
  assert.equal(G.vehicles.length, 0, 'a refusal buys nothing');
  G.money = VEHICLES.truck.cost;
  const v = purchaseVehicle(r, 'truck');
  assert.equal(v.kind, 'truck');
  assert.equal(G.money, 0, 'cost charged by the sim, not the UI');
});

test('purchaseVehicle refuses stops with no adjacent network as access', () => {
  const r = createRoute();
  r.stops.push({ i: 40, j: 90, fp: 1 }, { i: 44, j: 90, fp: 1 });
  assert.equal(purchaseVehicle(r, 'truck'), 'access');
});

test('purchaseWagon charges, and refuses full trains and empty wallets', () => {
  const r = railRoute();
  const v = buyVehicle(r, 'train');
  const before = G.money;
  assert.equal(purchaseWagon(v, 'pax').type, 'pax');
  assert.equal(G.money, before - WAGONS.pax.cost);
  while (v.wagons.length < v.def.maxWagons) addWagon(v, 'freight');
  assert.equal(purchaseWagon(v, 'pax'), 'full');
  v.wagons.length = 0;
  G.money = 0;
  assert.equal(purchaseWagon(v, 'pax'), 'poor');
});
