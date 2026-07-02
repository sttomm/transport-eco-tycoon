// The grid dispatch is the heart of the game's teaching mission — these tests
// pin down the merit order documented in docs/ENERGY-MODEL.md:
// surplus:  battery charge → electrolyzer → curtail
// deficit:  battery discharge → fuel cell → blackout
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, resetState } from '../src/sim/state.js';
import { solarFactor, windFactor, tickGrid, dailyUpkeep, POWER_PRICE } from '../src/sim/energy.js';

// energy tests run on an empty world: no cities/industries unless we add them
beforeEach(() => resetState());

const NOON = 12 * 60, MIDNIGHT = 0;
const solarPlant = mw => G.plants.push({ type: 'solar', def: { capMW: mw } });
const industry = mw => G.industries.push({ wantsPower: true, def: { powerMW: mw } });

test('solar follows the sun: full at clear spring noon, zero at night', () => {
  G.minutes = NOON; G.cloud = 0;
  assert.ok(Math.abs(solarFactor() - 1.0) < 1e-9); // spring noon, amp 1.0
  G.minutes = MIDNIGHT;
  assert.equal(solarFactor(), 0);
});

test('clouds attenuate solar output', () => {
  G.minutes = NOON; G.cloud = 1;
  assert.ok(Math.abs(solarFactor() - 0.18) < 1e-9); // 1 - 0.82·cloud
});

test('wind power curve: cut-in, rated cap, storm cut-out', () => {
  G.wind = 0.05; assert.equal(windFactor(), 0);      // below cut-in
  G.wind = 0.5; assert.equal(windFactor(), 1);       // rated
  G.wind = 0.2; assert.ok(windFactor() > 0 && windFactor() < 0.2); // cubic ramp
  G.wind = 0.99; assert.equal(windFactor(), 0);      // storm cut-out
});

test('surplus: battery charges first (92% in), rest is curtailed', () => {
  G.minutes = NOON; G.cloud = 0;
  solarPlant(25);
  G.batteryCapMWh = 20; G.batteryRateMW = 10;
  tickGrid(1);
  assert.ok(Math.abs(G.batteryMWh - 9.2) < 1e-6);   // 10 MW × 1 h × 0.92
  assert.ok(Math.abs(G.curtailedMW - 15) < 1e-6);   // 25 − 10 charged
  assert.equal(G.unservedMW, 0);
  assert.equal(G.blackout, false);
});

test('electrolyzer soaks surplus AFTER the battery, before curtailment', () => {
  G.minutes = NOON; G.cloud = 0;
  solarPlant(25);
  G.batteryCapMWh = 20; G.batteryRateMW = 10;
  G.h2CapMWh = 150; G.elecCapMW = 5;
  tickGrid(1);
  assert.ok(Math.abs(G.demand.electrolyzer - 5) < 1e-6);
  assert.ok(Math.abs(G.h2MWh - 5 * G.mult.elecEff) < 1e-6); // 68% efficient
  assert.ok(Math.abs(G.curtailedMW - 10) < 1e-6);           // 25 − 10 − 5
});

test('deficit: battery discharges, then fuel cell burns H₂, no blackout', () => {
  G.minutes = MIDNIGHT; G.wind = 0;                  // no renewables at all
  industry(10);
  G.batteryCapMWh = 20; G.batteryRateMW = 10; G.batteryMWh = 5;
  G.h2CapMWh = 150; G.h2MWh = 10; G.fcCapMW = 5;
  const moneyBefore = G.money;
  tickGrid(1);
  assert.ok(Math.abs(G.batteryMWh) < 1e-6);                       // 5 MWh drained
  assert.ok(Math.abs(G.supply.fuelcell - 5) < 1e-6);              // fc covers the rest
  assert.ok(Math.abs(G.h2MWh - (10 - 5 / G.mult.fcEff)) < 1e-6);  // 58% efficient out
  assert.equal(G.unservedMW, 0);
  assert.equal(G.servedFraction, 1);
  // industry pays for every served MWh
  assert.ok(Math.abs(G.money - moneyBefore - 10 * POWER_PRICE) < 1e-6);
});

test('blackout: demand unserved without storage, revenue forfeited, flag set', () => {
  G.minutes = MIDNIGHT; G.wind = 0;
  industry(10);
  const moneyBefore = G.money;
  tickGrid(1);
  assert.ok(Math.abs(G.unservedMW - 10) < 1e-6);
  assert.equal(G.servedFraction, 0);
  assert.equal(G.blackout, true);
  assert.ok(Math.abs(G.money - moneyBefore) < 1e-6); // nothing served, nothing earned
});

test('vehicle charging is own consumption — never billed', () => {
  G.minutes = NOON; G.cloud = 0;
  solarPlant(5);
  G.vehicles.push({ charging: true, def: { chargeMW: 0.8 } });
  const moneyBefore = G.money;
  tickGrid(1);
  assert.ok(Math.abs(G.demand.charging - 0.8) < 1e-6);
  assert.ok(Math.abs(G.money - moneyBefore) < 1e-6);
});

test('research multipliers scale generation', () => {
  G.minutes = NOON; G.cloud = 0;
  solarPlant(5);
  G.mult.solar = 1.18; // TOPCon
  tickGrid(1);
  assert.ok(Math.abs(G.supply.solar - 5.9) < 1e-6);
});

test('dailyUpkeep bills plants and vehicles', () => {
  G.plants.push({ def: { upkeep: 120 } });
  G.vehicles.push({ def: { upkeep: 45 } });
  const before = G.money;
  const cost = dailyUpkeep();
  assert.equal(cost, 165);
  assert.equal(G.money, before - 165);
  assert.equal(G.expensesToday, 165);
});
