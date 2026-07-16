// Daily report card: closeDay() aggregates the finished day's counters into
// G.reports (ring buffer of 7) and emits 'dayReport'; trackDay() accumulates
// blackout / dunkelflaute / storm hours between rollovers.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, resetState, on } from '../src/sim/state.js';
import { closeDay, trackDay, REPORT_KEEP } from '../src/sim/reports.js';
import { LOAN_RATE } from '../src/sim/loans.js';
import { REPORT_ALERTS } from '../src/sim/data.js';
import { isCityServed, servedCities, STATION_RADIUS } from '../src/sim/stations.js';

beforeEach(() => resetState());

// minimal city good enough for happinessFactors() (no routes/neighbors)
function makeCity(name, over = {}) {
  return { name, ci: 5, cj: 5, neighbors: [], paxLocal: 0, paxTo: [],
    happiness: 0.6, foodLevel: 0.5, goodsLevel: 0.5, ...over };
}
const cityNews = () => G.news.filter(n => n.type === 'city');
// WP-S: report/news problems & achievements only fire for cities the player
// actually serves (isCityServed, sim/stations.js) — a station's catchment
// covers cities within STATION_RADIUS+4 (11 tiles). Drop a minimal fake
// station right on the city's tile so it counts as served, without needing
// a full freshWorld()/place() setup.
function serveCity(c) {
  G.stations.push({ stype: 'bus', i: c.ci, j: c.cj });
}

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

test('report ring buffer keeps the last REPORT_KEEP days', () => {
  const N = REPORT_KEEP + 2;
  for (let d = 1; d <= N; d++) { G.day = d; closeDay(); }
  assert.equal(G.reports.length, REPORT_KEEP);
  assert.equal(REPORT_KEEP, 28, 'WP3 raised the report ring to one game year');
  assert.equal(G.reports[0].day, N - REPORT_KEEP + 1, 'oldest days dropped');
  assert.equal(G.reports[REPORT_KEEP - 1].day, N);
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

// ---- isCityServed / servedCities (WP-S) ------------------------------------

test('isCityServed is false with no stations, true once one is within STATION_RADIUS+4', () => {
  const c = makeCity('Solhaven');
  G.cities = [c];
  assert.equal(isCityServed(c), false);
  G.stations.push({ stype: 'bus', i: c.ci + STATION_RADIUS + 5, j: c.cj }); // just outside
  assert.equal(isCityServed(c), false);
  G.stations[0].i = c.ci + STATION_RADIUS; // well within range
  assert.equal(isCityServed(c), true);
  assert.deepEqual(servedCities(), [c]);
});

test('isCityServed counts any station kind (bus, truck, train)', () => {
  const c = makeCity('Solhaven');
  for (const stype of ['bus', 'truck', 'train']) {
    G.stations = [{ stype, i: c.ci, j: c.cj }];
    assert.equal(isCityServed(c), true, `${stype} stop should count as coverage`);
  }
});

// ---- problems & achievements (WP2) -----------------------------------------

test('report card always carries problems & achievements arrays', () => {
  const r = closeDay();
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.achievements, []);
});

test('day 1 has no baseline, so no happiness diff fires', () => {
  G.cities = [makeCity('Solhaven', { happiness: 0.3 })];
  const r = closeDay();
  assert.equal(r.problems.length, 0, 'nothing to diff against on the first day');
  assert.ok(r.cityStats[0].peak >= 0.3, 'peak seeded from day 1');
});

test('happiness dropping more than the threshold raises a problem + city news', () => {
  G.cities = [makeCity('Solhaven', { happiness: 0.8 })];
  serveCity(G.cities[0]);
  closeDay();                       // day 1 baseline (peak 0.8)
  G.day = 2;
  G.cities[0].happiness = 0.8 - REPORT_ALERTS.happinessDrop - 0.05; // clear drop
  const before = cityNews().length;
  const r = closeDay();
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0].headline, /unhappy/i);
  assert.ok(r.problems[0].body.includes('shortfall'), 'names the dominant factor');
  assert.equal(cityNews().length, before + 1, "also pushed as type:'city' news");
});

test('a happiness drop AT OR BELOW the threshold does not fire', () => {
  G.cities = [makeCity('Solhaven', { happiness: 0.8 })];
  serveCity(G.cities[0]);
  closeDay();
  G.day = 2;
  G.cities[0].happiness = 0.8 - REPORT_ALERTS.happinessDrop * 0.5; // small dip
  const r = closeDay();
  assert.equal(r.problems.length, 0);
});

test('a happiness drop in a city with no station coverage raises no problem (WP-S)', () => {
  G.cities = [makeCity('Solhaven', { happiness: 0.8 })]; // never served — no station pushed
  closeDay();                       // day 1 baseline (peak 0.8)
  G.day = 2;
  G.cities[0].happiness = 0.8 - REPORT_ALERTS.happinessDrop - 0.05; // clear drop, same as the served case above
  const before = cityNews().length;
  const r = closeDay();
  assert.equal(r.problems.length, 0, 'unserved cities stay quiet even on a real happiness drop');
  assert.equal(cityNews().length, before, 'no city news either');
  // aggregate stats keep tracking the city regardless of coverage
  assert.equal(r.cityStats[0].happiness, G.cities[0].happiness);
});

test('food crossing the supply threshold upward is an achievement', () => {
  G.cities = [makeCity('Solhaven', { foodLevel: REPORT_ALERTS.supplyThreshold - 0.2 })];
  serveCity(G.cities[0]);
  closeDay();
  G.day = 2;
  G.cities[0].foodLevel = REPORT_ALERTS.supplyThreshold + 0.1; // crossed up
  const r = closeDay();
  assert.equal(r.achievements.length, 1);
  assert.match(r.achievements[0].headline, /well supplied/i);
  assert.equal(cityNews().at(-1).type, 'city');
});

test('food crossing the supply threshold in an unserved city stays quiet (WP-S)', () => {
  G.cities = [makeCity('Solhaven', { foodLevel: REPORT_ALERTS.supplyThreshold - 0.2 })];
  closeDay();
  G.day = 2;
  G.cities[0].foodLevel = REPORT_ALERTS.supplyThreshold + 0.1; // crossed up, same as above
  const r = closeDay();
  assert.equal(r.achievements.length, 0, 'no station near this city yet, so no achievement');
});

test('a new happiness high above the celebration floor is an achievement', () => {
  G.cities = [makeCity('Solhaven', { happiness: 0.72 })]; // below happyRecordMin
  serveCity(G.cities[0]);
  closeDay();                                             // peak 0.72, no record (day1)
  G.day = 2;
  G.cities[0].happiness = 0.9; // new high, above the floor
  const r = closeDay();
  assert.ok(r.achievements.some(a => /record/i.test(a.headline)));
});

test('blackout hours today raise a problem', () => {
  G.blackoutHoursToday = 3.2;
  const r = closeDay();
  assert.ok(r.problems.some(p => /blackout/i.test(p.headline)));
});

test('a fossil-free streak milestone is an achievement', () => {
  G.fossilFreeDays = REPORT_ALERTS.fossilFreeMilestones[1] - 1; // e.g. 6 → will be 7
  G.gasMWhToday = 0;                                            // clean day just ended
  const r = closeDay();
  assert.ok(r.achievements.some(a => /fossil-free/i.test(a.headline)));
});

test('a non-milestone fossil-free streak stays quiet', () => {
  G.fossilFreeDays = 0; // this clean day makes it 1 — not a milestone
  G.gasMWhToday = 0;
  const r = closeDay();
  assert.equal(r.achievements.filter(a => /fossil-free/i.test(a.headline)).length, 0);
});

test('a contract deadline within a day raises a problem', () => {
  G.cities = [makeCity('Solhaven')];
  G.minutes = 5000;
  G.contracts.active = [{ kind: 'cargo', cargoId: 'food', toCity: 0, toInd: null,
    amount: 100, progress: 40, deadline: G.minutes + 600 }]; // < 1440 min left
  const r = closeDay();
  assert.ok(r.problems.some(p => /deadline/i.test(p.headline)));
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
