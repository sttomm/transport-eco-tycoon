// sim/tick.js: the heartbeat main.js runs every frame — clock advance, the
// pinned tick order, and the order-sensitive day rollover.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/sim/state.js';
import { tickSim, rollOverDay, MIN_PER_SEC } from '../src/sim/tick.js';
import { freshWorld } from './helpers.js';

beforeEach(() => {
  freshWorld();
  // isolate the clock/rollover mechanics from grid & city noise: no demand,
  // no supply, no industries — tickGrid runs but moves no money
  G.cities.length = 0;
  G.industries.length = 0;
});

test('tickSim advances the clock by dt × 8 game-minutes × speed', () => {
  const t0 = G.minutes;
  G.speed = 1;
  tickSim(1);
  assert.ok(Math.abs(G.minutes - t0 - MIN_PER_SEC) < 1e-9);
  G.speed = 10;
  tickSim(1);
  assert.ok(Math.abs(G.minutes - t0 - MIN_PER_SEC * 11) < 1e-9);
});

test('paused game (speed 0) ticks nothing', () => {
  G.speed = 0;
  const snapshot = { minutes: G.minutes, money: G.money, wind: G.wind };
  tickSim(5);
  assert.equal(G.minutes, snapshot.minutes);
  assert.equal(G.money, snapshot.money);
  assert.equal(G.wind, snapshot.wind, 'weather frozen too');
});

test('crossing midnight rolls the day: report first, then resets, then new-day billing', () => {
  G.minutes = 1439; // 23:59 of day 1
  G.speed = 1;
  G.incomeEnergyToday = 500;
  G.incomeTransportToday = 120;
  G.plants.push({ type: 'solar', def: { upkeep: 100 }, i: 0, j: 0 });
  const financeYesterday = G.finance.today;
  tickSim(1); // +8 game minutes → day 2

  assert.equal(G.day, 2);
  assert.equal(G.reports.length, 1, 'closeDay captured the finished day');
  const r = G.reports[0];
  assert.equal(r.day, 1, 'report belongs to the day that just ended');
  assert.equal(r.incomeEnergy, 500, 'captured BEFORE the counter reset');
  assert.equal(r.incomeTransport, 120);
  assert.equal(G.incomeEnergyToday, 0, 'shared counters reset for the new day');
  assert.equal(G.incomeTransportToday, 0);
  assert.equal(G.expensesToday, 100, 'upkeep billed AFTER the reset, into the new day');
  assert.equal(G.finance.prev, financeYesterday, 'finance drill-down keeps yesterday');
});

test('rollOverDay extends the fossil-free streak only on gas-free days', () => {
  G.minutes = 2000; // day 2 by clock
  G.gasMWhToday = 0;
  rollOverDay();
  assert.equal(G.fossilFreeDays, 1);
  G.minutes = 4000;
  G.gasMWhToday = 3;
  rollOverDay();
  assert.equal(G.fossilFreeDays, 0, 'any gas use resets the streak');
});

test('a multi-day headless run stays consistent: days, reports, finite money', () => {
  G.speed = 10;
  for (let left = 3 * 1440; left > 0; left -= 0.1 * MIN_PER_SEC * G.speed) tickSim(0.1);
  assert.ok(G.day >= 4, 'three days passed');
  assert.equal(G.reports.length, G.day - 1, 'one report per finished day');
  assert.ok(Number.isFinite(G.money));
  assert.ok(G.history.length > 0, 'chart history sampled');
});
