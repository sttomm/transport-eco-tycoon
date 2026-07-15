// Climate feedback (ADR 24): emitted CO₂ multiplies the EXTREME-event rolls
// (storm + heatwave) up to 2×, and the summer heatwave — scheduled through the
// same front pipeline as flaute/storm — pushes city demand up (AC) while a
// stagnant heat dome pins wind low. The base Dunkelflaute roll stays
// unscaled: normal weather variability, not a climate consequence.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, resetState, on, seasonOf } from '../src/sim/state.js';
import {
  updateWeather, tickGrid, climateRiskMult, eventThresholds, solarFactor,
} from '../src/sim/energy.js';
import { CLIMATE, FORECAST } from '../src/sim/data.js';
import { trackDay, closeDay } from '../src/sim/reports.js';

beforeEach(() => resetState());

const realRandom = Math.random;
afterEach(() => { Math.random = realRandom; });

// scripted Math.random: pops queued values, then falls back to 0.5
// (0.5 zeroes the weather-drift noise term → deterministic mean reversion)
const script = (...vals) => { Math.random = () => vals.length ? vals.shift() : 0.5; };

const SUMMER_DAY = 10, WINTER_DAY = 24; // seasons are 7 days: 8-14 Summer, 22-28 Winter
const NOON = 12 * 60;

test('season fixture sanity: the test days really are summer / winter', () => {
  assert.equal(seasonOf(SUMMER_DAY).name, 'Summer');
  assert.equal(seasonOf(WINTER_DAY).name, 'Winter');
});

// ---- risk multiplier ------------------------------------------------------

test('climateRiskMult: 1× at zero emissions, 2× at scaleTons, capped at maxMult', () => {
  G.co2EmittedTons = 0;
  assert.equal(climateRiskMult(), 1);
  G.co2EmittedTons = CLIMATE.scaleTons / 2;
  assert.ok(Math.abs(climateRiskMult() - 1.5) < 1e-9);
  G.co2EmittedTons = CLIMATE.scaleTons;
  assert.equal(climateRiskMult(), CLIMATE.maxMult);
  G.co2EmittedTons = CLIMATE.scaleTons * 10;
  assert.equal(climateRiskMult(), CLIMATE.maxMult, 'hard cap — gentle by design');
});

test('risk multiplier scales storm & heatwave rolls but NOT the season-shaped Dunkelflaute', () => {
  G.day = SUMMER_DAY;
  G.co2EmittedTons = 0;
  const base = eventThresholds();
  // WP9: the flaute base is now shaped by the season (× flauteMul), never by
  // the climate-risk multiplier — the ADR teaching point (ordinary dark calms
  // are normal weather, not a climate consequence) survives the reshape.
  assert.equal(base.flaute, CLIMATE.flauteRisk * seasonOf(SUMMER_DAY).flauteMul, 'flaute = base × season mul');
  assert.equal(base.storm, CLIMATE.stormRisk);
  assert.equal(base.heatwave, CLIMATE.heatRisk);
  G.co2EmittedTons = CLIMATE.scaleTons; // → 2×
  const loaded = eventThresholds();
  assert.equal(loaded.storm, CLIMATE.stormRisk * 2, 'storm dice loaded');
  assert.equal(loaded.heatwave, CLIMATE.heatRisk * 2, 'heatwave dice loaded');
  assert.equal(loaded.flaute, CLIMATE.flauteRisk * seasonOf(SUMMER_DAY).flauteMul,
    'climate change does NOT load the ordinary dark-calm dice — only the season shapes it');
});

test('Dunkelflaute risk is winter-shaped: winter ≫ summer, summer ≈ never', () => {
  G.co2EmittedTons = 0;
  G.day = WINTER_DAY;
  const winter = eventThresholds().flaute;
  G.day = SUMMER_DAY;
  const summer = eventThresholds().flaute;
  assert.ok(winter > summer * 10, `winter dark calms far more likely than summer (${winter} vs ${summer})`);
  assert.ok(summer > 0 && summer < 0.001, 'summer ≈ never — there is always some sun left — but not impossible');
  assert.equal(winter, CLIMATE.flauteRisk * seasonOf(WINTER_DAY).flauteMul, 'winter = base × winter mul');
});

test('post-event cooldown shuts the flaute roll off entirely, then reopens', () => {
  G.day = WINTER_DAY; // a season that would otherwise roll readily
  assert.ok(eventThresholds().flaute > 0, 'open by default (no cooldown pending)');
  G.flauteCooldownH = 50;
  assert.equal(eventThresholds().flaute, 0, 'no re-roll while the cooldown burns down');
  G.flauteCooldownH = 0;
  assert.ok(eventThresholds().flaute > 0, 'reopens once the cooldown elapses');
});

test('an ending Dunkelflaute arms the cooldown, blocking a back-to-back re-roll', () => {
  script(); // constant 0.5 → deterministic, no drift noise, no stray event rolls
  G.day = WINTER_DAY;
  G.dunkelflaute = 2;
  updateWeather(1);
  assert.equal(G.flauteCooldownH, 0, 'still running — no cooldown yet');
  updateWeather(1.5); // drains past zero → the calm breaks this tick
  assert.ok(G.dunkelflaute <= 0, 'calm over');
  assert.equal(G.flauteCooldownH, CLIMATE.flauteCooldownH, 'cooldown armed on the ending tick');
  assert.equal(eventThresholds().flaute, 0, 'immediate re-roll blocked');
  for (let i = 0; i < CLIMATE.flauteCooldownH + 1; i++) updateWeather(1); // burn it down
  assert.equal(G.flauteCooldownH, 0);
  assert.ok(eventThresholds().flaute > 0, 'winter rolls resume afterwards');
});

test('heatwave roll is summer-only; the flaute roll keeps its day-3 grace', () => {
  G.day = WINTER_DAY;
  assert.equal(eventThresholds().heatwave, 0, 'no heatwaves in winter');
  assert.ok(eventThresholds().storm > 0, 'storms roll year-round');
  G.day = 2;
  assert.equal(eventThresholds().flaute, 0, 'no flaute rolls before day 4');
});

// ---- roll wiring: the hourly roll schedules a heatwave FRONT ---------------

test('summer roll schedules a heatwave front through the forecast pipeline, applies on arrival', () => {
  const tips = [];
  on('tip', id => tips.push(id));
  G.day = SUMMER_DAY;
  // random draws in updateWeather: wind noise, cloud noise, lead,
  // flaute roll (miss), storm roll (miss), heatwave roll (hit), duration
  script(0.5, 0.5, 0.5, 0.9, 0.9, 0.0001, 0.5);
  updateWeather(1.2);
  const f = G.weatherFront;
  assert.ok(f, 'front scheduled, not applied instantly');
  assert.equal(f.type, 'heatwave');
  assert.ok(f.inHours >= FORECAST.leadHmin && f.inHours <= FORECAST.leadHmax, 'same lead time as other fronts');
  assert.ok(f.durationH >= CLIMATE.heatHmin && f.durationH <= CLIMATE.heatHmax, 'duration in range');
  assert.equal(G.heatwave, 0, 'not active during the lead time');
  assert.ok(G.forecast.slots.some(sl => sl.heat), 'forecast slots after arrival flagged 🔥');
  assert.equal(G.forecast.slots[0].heat, false, 'slots before arrival are not');
  assert.deepEqual(G.forecast.front, { ...f }, 'front passes through the forecast');

  const dur = f.durationH;
  for (let i = 0; i < 14; i++) updateWeather(1); // run down the ~12 h lead
  assert.equal(G.weatherFront, null, 'front cleared on arrival');
  assert.ok(Math.abs(G.heatwave - dur) < 2.001, 'full duration applied (minus ticks since arrival)');
  assert.ok(G.heatwave > 0, 'heatwave active');
  assert.ok(tips.includes('heatwave'), 'advisor explains the heat dome on arrival');
});

test('winter: the same dice never schedule a heatwave', () => {
  G.day = WINTER_DAY;
  script(0.5, 0.5, 0.5, 0.9, 0.9, 0.0001);
  updateWeather(1.2);
  assert.equal(G.weatherFront, null, 'heatwave threshold is zero outside summer');
});

// ---- active-heatwave physics ------------------------------------------------

test('heatwave demand: city demand ×heatDemand while active, back to normal after', () => {
  G.minutes = NOON; G.day = SUMMER_DAY;
  G.cities.push({ pop: 10000 });
  tickGrid(1);
  const normal = G.demand.city;
  G.heatwave = 10;
  tickGrid(1);
  assert.ok(Math.abs(G.demand.city - normal * CLIMATE.heatDemand) < 1e-9, 'ACs push demand +30%');
  G.heatwave = 0;
  tickGrid(1);
  assert.ok(Math.abs(G.demand.city - normal) < 1e-9, 'normal again once the dome breaks');
});

test('heat dome pins wind low (turbines idle) and clears the sky (solar strong)', () => {
  G.day = SUMMER_DAY; G.heatwave = 40;
  G.wind = 0.9; G.cloud = 0.7;
  script(); // constant 0.5 → zero drift noise
  for (let i = 0; i < 30; i++) updateWeather(1);
  assert.ok(G.wind <= CLIMATE.heatWindCap + 0.01, `wind converges below the ${CLIMATE.heatWindCap} cap (got ${G.wind.toFixed(3)})`);
  assert.ok(G.cloud < 0.15, 'clear skies — solar keeps delivering');
  assert.ok(G.forecast.windTrend <= CLIMATE.heatWindCap + 1e-9, 'forecast wind trend pinned low too');
  assert.equal(G.weatherFront, null, 'no new fronts roll while the dome sits');
});

test('TEACHING INVARIANT: solar is still zero at night, heatwave or not', () => {
  G.day = SUMMER_DAY; G.heatwave = 20; G.minutes = 0; G.cloud = 0;
  assert.equal(solarFactor(), 0);
});

// ---- elevated-risk advisor tip ---------------------------------------------

test("tickGrid emits the 'climateRisk' tip once risk crosses the elevated band", () => {
  const tips = [];
  on('tip', id => tips.push(id));
  G.co2EmittedTons = (CLIMATE.elevatedAt - 1) * CLIMATE.scaleTons - 1; // just below
  tickGrid(0.01);
  assert.ok(!tips.includes('climateRisk'));
  G.co2EmittedTons = (CLIMATE.elevatedAt - 1) * CLIMATE.scaleTons + 1; // just above
  tickGrid(0.01);
  assert.ok(tips.includes('climateRisk'), 'the gas habit loads the weather dice');
});

// ---- daily report ------------------------------------------------------------

test('trackDay counts heatwave hours; closeDay reports and resets them', () => {
  G.heatwave = 6;
  trackDay(2);
  assert.equal(G.heatHoursToday, 2);
  G.heatwave = 0;
  trackDay(3);
  assert.equal(G.heatHoursToday, 2, 'nothing added without an active heatwave');
  const r = closeDay();
  assert.equal(r.heatHours, 2);
  assert.equal(G.heatHoursToday, 0, 'counter owned (and reset) by closeDay');
});

// ---- persistence ---------------------------------------------------------------

test('active heatwave, heat hours and a scheduled heatwave front survive save/load', async () => {
  const { snapshot, restore } = await import('../src/sim/save.js');
  const { freshWorld } = await import('./helpers.js');
  freshWorld();
  G.heatwave = 14.5;
  G.heatHoursToday = 3.5;
  G.weatherFront = { type: 'heatwave', inHours: 11, durationH: 24 };
  const snap = JSON.parse(JSON.stringify(snapshot()));
  assert.equal(snap.v, 6, 'current save version (v6 — additive playtest-feedback bump)');

  freshWorld();
  assert.equal(restore(snap), true);
  assert.equal(G.heatwave, 14.5);
  assert.equal(G.heatHoursToday, 3.5);
  assert.deepEqual(G.weatherFront, { type: 'heatwave', inHours: 11, durationH: 24 });

  // pre-climate v3 saves lack the fields → safe defaults
  delete snap.heatwave; delete snap.heatH;
  freshWorld();
  assert.equal(restore(snap), true);
  assert.equal(G.heatwave, 0);
  assert.equal(G.heatHoursToday, 0);
});
