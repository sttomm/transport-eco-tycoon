// Save round trip: snapshot() a played world, rebuild a fresh world,
// restore() — the player's infrastructure, economy and progress survive.
// (The world itself is deterministic from the seed, so only deltas persist.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/sim/state.js';
import { place, tile, isRail } from '../src/sim/grid.js';
import { createRoute, buyVehicle, addWagon, routeKind } from '../src/sim/transport.js';
import { snapshot, restore } from '../src/sim/save.js';
import { freshWorld, buildRoad, buildRail, findSpot } from './helpers.js';

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
  G.contracts.completed = 3; G.contracts.seq = 5;

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
  assert.equal(G.contracts.completed, 3);
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

test('v3 round-trips the energy-transition fields', () => {
  freshWorld();
  G.carbonPrice = 54;
  G.co2EmittedTons = 87.5;
  G.gasMWhToday = 12; G.gasCostToday = 990;
  G.fossilFreeDays = 3;
  G.gasDecommissioned = true;
  G.weatherFront = { type: 'dunkelflaute', inHours: 11, durationH: 40 };
  G.reports = [{ day: 4, energyIncome: 1000 }];

  const snap = JSON.parse(JSON.stringify(snapshot()));
  assert.equal(snap.v, 3);
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

test('v2 saves (pre-gas) restore with energy-transition defaults', () => {
  freshWorld();
  const snap = JSON.parse(JSON.stringify(snapshot()));
  snap.v = 2; // strip the arc fields like a real pre-arc save
  delete snap.carbonPrice; delete snap.co2Emitted; delete snap.gasMWhToday;
  delete snap.gasCostToday; delete snap.fossilFreeDays; delete snap.gasDecommissioned;
  delete snap.reports; delete snap.weatherFront;

  freshWorld();
  assert.equal(restore(snap), true);
  assert.equal(G.carbonPrice, 30);
  assert.equal(G.co2EmittedTons, 0);
  assert.equal(G.gasDecommissioned, false);
  assert.equal(G.weatherFront, null);
  assert.deepEqual(G.reports, []);
});
