// Vehicle lifecycle: purchase rules, battery/stranding, wagons, and the
// train's live coupling to the grid (no battery — blackout stops it).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, on } from '../src/sim/state.js';
import { place } from '../src/sim/grid.js';
import { tickVehicles, createRoute, buyVehicle, addWagon, sellVehicle, paxCapacity, freightCapacity } from '../src/sim/transport.js';
import { freshWorld, buildRoad, buildRail } from './helpers.js';

const J = 90;

beforeEach(() => freshWorld());

function roadRoute() {
  buildRoad(2, J, 20, J);
  const a = place('truckStop', 4, J - 1);
  const b = place('truckStop', 16, J - 1);
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

test('capacity comes from the vehicle type; trains from their wagons', () => {
  const r = roadRoute();
  const bus = buyVehicle(r, 'bus');
  const truck = buyVehicle(r, 'truck');
  assert.equal(paxCapacity(bus), 30);
  assert.equal(freightCapacity(bus), 0);
  assert.equal(freightCapacity(truck), 18);
  assert.equal(paxCapacity(truck), 0);
});

test('trains: wagons give capacity, capped at maxWagons', () => {
  buildRail(2, J, 20, J);
  const a = place('trainStation', 4, J - 2);
  const b = place('trainStation', 14, J - 2);
  const r = createRoute();
  r.stops.push(a, b);
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
  buildRail(2, J, 20, J);
  const a = place('trainStation', 4, J - 2);
  const b = place('trainStation', 14, J - 2);
  const r = createRoute();
  r.stops.push(a, b);
  const train = buyVehicle(r, 'train');

  G.servedFraction = 0; // total blackout — no traction power
  step(50);
  assert.equal(train.pathPos, 0, 'train frozen without grid power');

  G.servedFraction = 1;
  step(50);
  assert.ok(train.pathPos > 0, 'train moves again');
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
