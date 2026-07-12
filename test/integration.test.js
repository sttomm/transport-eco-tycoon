// Integration: the REAL game, headless. Multi-day runs through sim/tick.js
// (the exact pipeline main.js drives every frame) on the generated world with
// the real starter grid — energy, transport, economy and weather interacting.
// These tests pin cross-system invariants, not tuned numbers, so they survive
// rebalances; the teaching mission invariants here outrank balance (CLAUDE.md).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, season } from '../src/sim/state.js';
import { tickSim, MIN_PER_SEC } from '../src/sim/tick.js';
import { placeStarterGrid } from '../src/sim/newGame.js';
import { place } from '../src/sim/grid.js';
import { createRoute, buyVehicle } from '../src/sim/transport.js';
import { snapshot, restore } from '../src/sim/save.js';
import { MARKET } from '../src/sim/data.js';
import { REPORT_KEEP } from '../src/sim/reports.js';
import { freshWorld, stationSpotNearCity } from './helpers.js';

beforeEach(() => freshWorld());

// run `days` game days at speed 10 through the full pipeline, checking the
// always-true invariants after every tick (that's the point of integration)
function playAndCheck(days) {
  G.speed = 10;
  const dt = 0.1, gmPerTick = dt * MIN_PER_SEC * G.speed;
  for (let left = days * 1440; left > 0; left -= gmPerTick) {
    tickSim(dt);
    const s = season();
    const h = (G.minutes / 60) % 24;
    // teaching invariant: no sun, no solar (checked away from the boundary)
    if (h < s.sunrise - 0.2 || h > s.sunset + 0.2) {
      assert.equal(G.supply.solar, 0, `solar must be zero at night (h=${h.toFixed(1)})`);
    }
    // teaching invariant: storms cut turbines out
    if (G.wind > 0.96) assert.equal(G.supply.wind, 0, 'storm cut-out');
    // physical sanity
    assert.ok(Number.isFinite(G.money), 'money stays a number');
    assert.ok(G.servedFraction >= 0 && G.servedFraction <= 1);
    assert.ok(G.batteryMWh >= -1e-9 && G.batteryMWh <= G.batteryCapMWh + 1e-9, 'battery within capacity');
    assert.ok(G.h2MWh >= -1e-9 && G.h2MWh <= G.h2CapMWh + 1e-9, 'H2 within tank');
    // market prices stay inside the designed band
    if (G.marketLive) assert.ok(G.price >= MARKET.surplusPrice && G.price <= MARKET.scarcity, `price ${G.price} within [surplus, scarcity]`);
  }
}

test('12 passive days on the real starter grid: stable economy, consistent day chain', () => {
  placeStarterGrid();
  playAndCheck(12);

  assert.ok(G.day >= 13, 'twelve days passed');
  assert.equal(G.reports.length, Math.min(G.day - 1, REPORT_KEEP), 'one report per finished day (ring-buffered)');
  for (let k = 1; k < G.reports.length; k++) {
    assert.equal(G.reports[k].day, G.reports[k - 1].day + 1, 'report chain has no gaps');
  }
  assert.ok(G.money > 0, 'the inherited grid does not bankrupt a passive player');
  assert.ok(G.history.length > 0, 'chart history sampled');
  // ADR 21: the undersized starter grid needs the gas bridge, which emits
  assert.ok(G.co2EmittedTons > 0, 'legacy gas ran at some point');
  assert.equal(G.carbonPrice, 30 + 3 * (G.day - 1), 'carbon ramp follows the day');
  // ADR 22: the Smart Market went live on schedule
  assert.equal(G.marketLive, G.day >= MARKET.liveDay);
});

test('teaching invariant: a Dunkelflaute defeats a battery-only grid', () => {
  // renewables + battery, deliberately NO gas plant and no H2 chain
  placeStarterGrid();
  G.plants = G.plants.filter(p => p.type !== 'gas'); // simulate a decommissioned bridge
  G.gasDecommissioned = true;
  G.dunkelflaute = 40; // forced-event debug path: applies on the next tick
  G.speed = 10;
  let blackoutH = 0;
  const dt = 0.1;
  for (let left = 2 * 1440; left > 0; left -= dt * MIN_PER_SEC * G.speed) {
    tickSim(dt);
    if (G.blackout) blackoutH += dt * MIN_PER_SEC * G.speed / 60;
  }
  assert.ok(blackoutH > 1, `battery-only grid must black out in a 40h dark calm (got ${blackoutH.toFixed(1)}h)`);
});

test('a bus line runs inside the full pipeline: riders delivered, fares earned, grid charges the bus', () => {
  placeStarterGrid();
  const solhaven = G.cities[0];
  const a = stationSpotNearCity(solhaven, 'busStop');
  const b = stationSpotNearCity(solhaven, 'busStop', a, 6);
  assert.ok(a && b, 'two stop sites in the first city');
  const r = createRoute();
  r.stops.push(place('busStop', a[0], a[1]), place('busStop', b[0], b[1]));
  const bus = buyVehicle(r, 'bus');
  assert.ok(bus);

  G.minutes = 9 * 60; // start in the morning so demand pools fill
  playAndCheck(2);

  assert.ok(G.stats.paxLocal > 0, `passengers delivered through the real tick order (got ${G.stats.paxLocal})`);
  const busIncome = (G.finance.today.bus || 0) + G.reports.reduce((a2, rep) => a2 + (rep.incomeBus || 0), 0);
  assert.ok(busIncome > 0, 'fares booked');
});

test('save round-trip mid-game: restore rebuilds the empire and the sim keeps running', () => {
  placeStarterGrid();
  const solhaven = G.cities[0];
  const a = stationSpotNearCity(solhaven, 'busStop');
  const b = stationSpotNearCity(solhaven, 'busStop', a, 6);
  const r = createRoute();
  r.stops.push(place('busStop', a[0], a[1]), place('busStop', b[0], b[1]));
  buyVehicle(r, 'bus');
  playAndCheck(3);

  const before = {
    day: G.day, money: G.money, plants: G.plants.length,
    stations: G.stations.length, routes: G.routes.length, vehicles: G.vehicles.length,
    co2: G.co2EmittedTons, reports: G.reports.length,
  };
  const d = JSON.parse(JSON.stringify(snapshot())); // through JSON like localStorage would

  freshWorld();
  assert.equal(restore(d), true, 'v5 snapshot restores onto a fresh world');
  assert.equal(G.day, before.day);
  assert.equal(G.money, before.money);
  assert.equal(G.plants.length, before.plants, 'every plant replayed');
  assert.equal(G.stations.length, before.stations);
  assert.equal(G.routes.length, before.routes);
  assert.equal(G.vehicles.length, before.vehicles);
  assert.equal(G.co2EmittedTons, before.co2);
  assert.equal(G.reports.length, before.reports, 'report history survives');

  playAndCheck(1); // and the restored game keeps simulating cleanly
  assert.ok(G.day >= before.day + 1);
  assert.ok(G.stats.paxLocal >= 0 && Number.isFinite(G.money));
});
