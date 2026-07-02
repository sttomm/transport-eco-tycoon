// Save round trip: snapshot() a played world, rebuild a fresh world,
// restore() — the player's infrastructure, economy and progress survive.
// (The world itself is deterministic from the seed, so only deltas persist.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/sim/state.js';
import { place, tile, isRail } from '../src/sim/grid.js';
import { createRoute, buyVehicle, addWagon } from '../src/sim/transport.js';
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

test('restore rejects unknown versions', () => {
  freshWorld();
  assert.equal(restore(null), false);
  assert.equal(restore({ v: 99 }), false);
});
