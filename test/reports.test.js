// Daily report card: closeDay() aggregates the finished day's counters into
// G.reports (ring buffer of 7) and emits 'dayReport'; trackDay() accumulates
// blackout / dunkelflaute / storm hours between rollovers.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, resetState, on } from '../src/sim/state.js';
import { closeDay, trackDay, REPORT_KEEP } from '../src/sim/reports.js';
import { LOAN_RATE } from '../src/sim/loans.js';

beforeEach(() => resetState());

function playDay() {
  G.incomeEnergyToday = 5000;
  G.finance.today = { bus: 300, truck: 500, train: 700, routes: {} };
  G.incomeTransportToday = 1500;
  G.expensesToday = 2200;
  G.gasMWhToday = 12;
  G.gasCostToday = 990;
  G.co2EmittedTons = 5.4;
  G.co2SavedTons = 130;
  G.blackoutHoursToday = 2.5;
  G.curtailedTodayMWh = 33;
  G.flauteHoursToday = 6;
  G.stormHoursToday = 0.5;
  G.heatHoursToday = 4;
}

test('closeDay aggregates the daily counters into a report', () => {
  playDay();
  G.loan = 100000;
  G.plants.push({ type: 'solar', def: { upkeep: 120 } }, { type: 'wind', def: { upkeep: 80 } });
  G.vehicles.push({ kind: 'bus', def: { upkeep: 30 } });
  const r = closeDay();

  assert.equal(r.day, G.day);
  assert.equal(r.incomeEnergy, 5000);
  assert.equal(r.incomeBus, 300);
  assert.equal(r.incomeTruck, 500);
  assert.equal(r.incomeTrain, 700);
  assert.equal(r.incomeTransport, 1500);
  assert.equal(r.expenses, 2200);
  assert.equal(r.net, 5000 + 1500 - 2200);
  assert.equal(r.upkeep, 230, 'same formula as dailyUpkeep: plant + vehicle upkeep');
  assert.equal(r.loanInterest, 100000 * LOAN_RATE);
  assert.equal(r.gasMWh, 12);
  assert.equal(r.gasCost, 990);
  assert.equal(r.co2EmittedTotal, 5.4);
  assert.equal(r.co2SavedTotal, 130);
  assert.equal(r.blackoutHours, 2.5);
  assert.equal(r.curtailedMWh, 33);
  assert.equal(r.flauteHours, 6);
  assert.equal(r.stormHours, 0.5);
  assert.equal(r.heatHours, 4);
  assert.equal(G.reports[G.reports.length - 1], r, 'report pushed onto G.reports');
});

test('CO₂ daily deltas derive from the previous report across two days', () => {
  G.co2EmittedTons = 5;
  G.co2SavedTons = 100;
  const r1 = closeDay();
  assert.equal(r1.co2Emitted, 5, 'first day: delta from zero');
  assert.equal(r1.co2Saved, 100);
  // second day: cumulatives grow
  G.co2EmittedTons = 8;
  G.co2SavedTons = 180;
  const r2 = closeDay();
  assert.equal(r2.co2Emitted, 3);
  assert.equal(r2.co2Saved, 80);
  assert.equal(r2.co2EmittedTotal, 8);
  assert.equal(r2.co2SavedTotal, 180);
});

test('closeDay resets only its own counters; shared ones are captured, not touched', () => {
  playDay();
  closeDay();
  // owned by reports.js → reset
  assert.equal(G.blackoutHoursToday, 0);
  assert.equal(G.flauteHoursToday, 0);
  assert.equal(G.stormHoursToday, 0);
  assert.equal(G.heatHoursToday, 0);
  // shared daily counters → main.js's rollover resets them, not closeDay
  assert.equal(G.incomeEnergyToday, 5000);
  assert.equal(G.incomeTransportToday, 1500);
  assert.equal(G.expensesToday, 2200);
  assert.equal(G.curtailedTodayMWh, 33);
  assert.equal(G.gasMWhToday, 12);
});

test('report ring buffer keeps the last 7 days', () => {
  for (let d = 1; d <= 9; d++) { G.day = d; closeDay(); }
  assert.equal(G.reports.length, REPORT_KEEP);
  assert.equal(REPORT_KEEP, 7);
  assert.equal(G.reports[0].day, 3, 'oldest days dropped');
  assert.equal(G.reports[6].day, 9);
});

test("closeDay emits 'dayReport' with the report", () => {
  let got = null;
  on('dayReport', r => { got = r; }); // registered after resetState (beforeEach)
  const r = closeDay();
  assert.equal(got, r);
  assert.equal(got.day, G.day);
});

test('trackDay accumulates blackout, dunkelflaute, storm and heatwave hours', () => {
  G.blackout = true;
  G.dunkelflaute = 10;
  G.wind = 1.0; // above storm cut-out
  G.heatwave = 8;
  trackDay(2);
  assert.equal(G.blackoutHoursToday, 2);
  assert.equal(G.flauteHoursToday, 2);
  assert.equal(G.stormHoursToday, 2);
  assert.equal(G.heatHoursToday, 2);
  G.blackout = false;
  G.dunkelflaute = 0;
  G.wind = 0.5;
  G.heatwave = 0;
  trackDay(3);
  assert.equal(G.blackoutHoursToday, 2, 'stable grid adds nothing');
  assert.equal(G.flauteHoursToday, 2);
  assert.equal(G.stormHoursToday, 2);
  assert.equal(G.heatHoursToday, 2);
});

test('report counters survive a save/load round trip', async () => {
  const { snapshot, restore } = await import('../src/sim/save.js');
  const { freshWorld } = await import('./helpers.js');
  freshWorld();
  G.blackoutHoursToday = 1.5;
  G.flauteHoursToday = 4;
  G.stormHoursToday = 0.25;
  G.reports = [{ day: 2, net: 100, co2EmittedTotal: 1, co2SavedTotal: 9 }];
  const snap = JSON.parse(JSON.stringify(snapshot()));
  freshWorld();
  assert.equal(restore(snap), true);
  assert.equal(G.blackoutHoursToday, 1.5);
  assert.equal(G.flauteHoursToday, 4);
  assert.equal(G.stormHoursToday, 0.25);
  assert.deepEqual(G.reports, [{ day: 2, net: 100, co2EmittedTotal: 1, co2SavedTotal: 9 }]);
});
