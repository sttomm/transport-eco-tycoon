// Freight economy end-to-end: industry production, station pickup, truck
// haulage, delivery payment and the stats counters that drive quests.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, on } from '../src/sim/state.js';
import { place, canPlace } from '../src/sim/grid.js';
import { INDUSTRY_TYPES, VEHICLES } from '../src/sim/data.js';
import { tickVehicles, createRoute, buyVehicle, purchaseVehicle, toggleRouteStop, vehicleUpkeep } from '../src/sim/transport.js';
import { dailyUpkeep } from '../src/sim/energy.js';
import { tickIndustries } from '../src/sim/industries.js';
import { stationCatchment, stationAccepts } from '../src/sim/stations.js';
import { freshWorld, buildRoad, fakeIndustry } from './helpers.js';

const J = 90; // quiet grass row in the south-west
let depotA, depotB, farm, food;

beforeEach(() => {
  freshWorld();
  buildRoad(2, J, 20, J);
  depotA = place('truckStop', 4, J - 1);
  depotB = place('truckStop', 16, J - 1);
  farm = fakeIndustry('farm', INDUSTRY_TYPES.farm, 4, J - 4);
  food = fakeIndustry('food', INDUSTRY_TYPES.food, 16, J - 4);
});

// one sim step at 10× speed, like the real frame loop
function step(n = 1) {
  const dt = 0.1;
  G.speed = 10;
  const gh = dt * 8 * G.speed / 60;
  for (let k = 0; k < n; k++) {
    tickIndustries(gh);
    tickVehicles(dt, gh);
  }
}

test('station catchment sees industries within radius 7', () => {
  const { producers, acceptors } = stationCatchment(depotA);
  assert.ok(producers.includes(farm));
  assert.ok(!producers.includes(food), 'food plant is 12 tiles away');
  assert.equal(acceptors.length, 0, 'farm accepts nothing');
  assert.ok(stationAccepts(depotB).has('grain'), 'food plant takes grain');
});

test('primary producers make stock; processors halt without input', () => {
  tickIndustries(1);
  // the depot in range pulls the fresh stock onto its platform in the same tick
  assert.ok(farm.stock + (depotA.cargo.grain || 0) > 9, 'farm produced ~10 grain in an hour');
  assert.equal(food.running, false, 'no grain yet');
  assert.equal(food.wantsPower, false, 'idle industry draws no power');
});

test('industry halts during a blackout', () => {
  G.servedFraction = 0.3;
  tickIndustries(1);
  assert.equal(farm.running, false);
  assert.equal(farm.stock, 0);
});

test('stations pull produced cargo from industries in range', () => {
  tickIndustries(1);
  tickIndustries(1);
  assert.ok((depotA.cargo.grain || 0) > 9, 'depot collected the grain');
});

test('toggleRouteStop: new station adds, a non-origin existing stop removes', () => {
  const r = createRoute();
  assert.deepEqual(r.stops, [], 'starts empty');
  assert.equal(toggleRouteStop(r, depotA), 'added');
  assert.equal(toggleRouteStop(r, depotB), 'added');
  assert.deepEqual(r.stops, [depotA, depotB], 'two clicks add two stops');
  // depotB is the non-origin (last) stop → toggles out
  assert.equal(toggleRouteStop(r, depotB), 'removed', 'clicking a non-origin stop removes it');
  assert.deepEqual(r.stops, [depotA]);
});

test('clicking the FIRST stop of a ≥2-stop route finishes editing (routes loop back)', () => {
  const r = createRoute();
  toggleRouteStop(r, depotA);
  toggleRouteStop(r, depotB);
  G.routeEdit = r;
  const toasts = [];
  on('toast', t => toasts.push(t));
  const res = toggleRouteStop(r, depotA); // first stop, length 2
  assert.equal(res, 'finished', 'signals the caller to stop editing');
  assert.deepEqual(r.stops, [depotA, depotB], 'origin neither re-added nor removed — no duplicate, no loss');
  assert.equal(G.routeEdit, null, 'editing ended, exactly like ✔ Done');
  assert.ok(toasts.some(t => /loop/i.test(t.title + ' ' + t.text)), 'told the player the loop is automatic');
});

test('a single-stop route: clicking that stop still just removes it', () => {
  const r = createRoute();
  toggleRouteStop(r, depotA);
  assert.equal(toggleRouteStop(r, depotA), 'removed', 'only ≥2-stop routes finish on a first-stop click');
  assert.deepEqual(r.stops, []);
});

test('per-route economics: purchase, daily upkeep and delivery all attribute to the route', () => {
  const r = createRoute();
  r.stops.push(depotA, depotB);
  assert.equal(r.spentTotal, 0, 'new route starts even');
  assert.equal(r.earnedTotal, 0);
  const truck = purchaseVehicle(r, 'truck'); // player path: charges AND books capex
  assert.ok(truck && typeof truck === 'object', 'road/kind ok, bought');
  assert.equal(r.spentTotal, VEHICLES.truck.cost, 'vehicle purchase booked to route capex');

  const beforeUpkeep = r.spentTotal;
  dailyUpkeep();
  assert.ok(Math.abs((r.spentTotal - beforeUpkeep) - vehicleUpkeep(truck)) < 1e-6,
    'daily upkeep adds exactly this vehicle’s upkeep to its route');

  step(600); // haul grain A→B and get paid
  assert.ok(r.earnedTotal > 0, 'delivery income accrues on the route');
  assert.ok(Math.abs(r.earnedTotal - G.finance.today.routes[r.id]) < 1e-6,
    'earnedTotal mirrors today’s per-route income within a single (un-rolled) day');
});

test('a truck hauls grain to the food plant: payment, stats, input stock', () => {
  const r = createRoute();
  r.stops.push(depotA, depotB);
  const truck = buyVehicle(r, 'truck');
  assert.ok(truck, 'road access ok');

  step(600);

  assert.ok(G.stats.grainToFood > 0, `grain delivered (got ${G.stats.grainToFood})`);
  assert.ok(G.incomeTransportToday > 0, 'delivery was paid');
  assert.equal(G.finance.today.truck, G.incomeTransportToday, 'booked under trucks');
  assert.ok(G.finance.today.routes[r.id] > 0, 'booked on the route');
  assert.ok(food.stock > 0, 'food plant is processing the grain');
});

test('routes record which goods they actually delivered (cargoCarried)', () => {
  const r = createRoute();
  r.stops.push(depotA, depotB);
  buyVehicle(r, 'truck');
  assert.deepEqual(r.cargoCarried, {}, 'nothing recorded before the first delivery');
  step(600);
  assert.equal(r.cargoCarried.grain, true, 'grain deliveries recorded for the routes filter');
  assert.ok(!r.cargoCarried.food, 'food never travelled on this route');
});

test('trucks only load cargo some other stop of the route accepts', () => {
  const r = createRoute();
  r.stops.push(depotA, depotB);
  const truck = buyVehicle(r, 'truck');
  // fill depot A with steel — nothing on this route accepts steel
  depotA.cargo.steel = 20;
  tickIndustries(1);
  step(200);
  assert.equal(depotA.cargo.steel, 20, 'steel stays on the platform');
  assert.ok(!truck.cargo.steel, 'truck refused pointless cargo');
});

test('steel boost: the works sips grid hydrogen for +50% output', () => {
  const steel = fakeIndustry('steel', INDUSTRY_TYPES.steel, 30, J - 4);
  steel.inStock = 100;
  G.h2MWh = 10;
  tickIndustries(1);
  const boosted = steel.stock;
  assert.ok(G.h2MWh < 10, 'hydrogen consumed');

  steel.stock = 0; steel.inStock = 100; G.h2MWh = 0;
  tickIndustries(1);
  assert.ok(Math.abs(boosted - steel.stock * 1.5) < 1e-6, '+50% with H₂');
});

// ---- industrial demand response (crisis prices pause production) ----------
test('industries pause while G.indCurtailed and resume when it clears', () => {
  G.indCurtailed = true;
  tickIndustries(1);
  assert.equal(farm.wantsPower, false, 'paused industry draws no power');
  assert.equal(farm.running, false);
  assert.equal(farm.stock, 0, 'no production while curtailed');
  G.indCurtailed = false;
  tickIndustries(1);
  assert.equal(farm.running, true);
  // the depot in range sweeps fresh stock within the same tick
  assert.ok(farm.stock + (depotA.cargo.grain || 0) > 0, 'production resumes below the resume threshold');
});
