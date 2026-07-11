// Weather fronts with lead time (ADR 23): the hourly roll SCHEDULES events on
// G.weatherFront ~10-14 h ahead instead of applying them instantly — the
// Dunkelflaute stays exactly as hard (teaching invariant), it just becomes
// visible in advance. The forced debug path `G.dunkelflaute = 40` must keep
// applying immediately (playtest recipes and tune-energy-model depend on it).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, resetState, on } from '../src/sim/state.js';
import { updateWeather, windFactor } from '../src/sim/energy.js';
import { FORECAST } from '../src/sim/data.js';

beforeEach(() => resetState());

const realRandom = Math.random;
afterEach(() => { Math.random = realRandom; });

test('scheduled dunkelflaute front honors its lead time, then applies in full', () => {
  G.weatherFront = { type: 'dunkelflaute', inHours: 12, durationH: 40 };
  for (let i = 0; i < 11; i++) updateWeather(1);
  assert.equal(G.dunkelflaute, 0, 'not active before the countdown ends');
  assert.ok(G.weatherFront && G.weatherFront.inHours <= 1.001, 'countdown ran down');
  updateWeather(2);
  assert.equal(G.weatherFront, null, 'front cleared on arrival');
  assert.equal(G.dunkelflaute, 40, 'full duration applied — lead time never weakens the event');
});

test('scheduled storm front applies the cut-out gust on arrival and emits the storm tip', () => {
  const tips = [];
  on('tip', id => tips.push(id));
  G.weatherFront = { type: 'storm', inHours: 1, durationH: FORECAST.stormH };
  updateWeather(1.5);
  assert.equal(G.weatherFront, null);
  assert.equal(G.wind, 1, 'gust to 100% wind');
  assert.equal(windFactor(), 0, 'turbines cut out — the teaching moment survives');
  assert.ok(tips.includes('storm'), 'storm tip fires at arrival');
});

test('forced debug path: G.dunkelflaute = 40 applies immediately, bypassing fronts', () => {
  G.dunkelflaute = 40;
  updateWeather(1);
  updateWeather(1);
  updateWeather(1);
  assert.equal(G.dunkelflaute, 37, 'counts down from the forced value');
  assert.ok(G.wind < 0.2, 'wind collapses toward the flaute target');
  assert.ok(G.cloud > 0.7, 'overcast builds up');
  assert.equal(G.weatherFront, null, 'no front machinery involved');
});

test('the hourly roll schedules a front with 10-14 h lead and fires the tip at SCHEDULE time', () => {
  const tips = [];
  on('tip', id => tips.push(id));
  Math.random = () => 0.0001; // force the dunkelflaute roll deterministically
  G.day = 5;                  // rolls only start after day 3
  updateWeather(1.2);         // > 1 h → the roll runs
  const f = G.weatherFront;
  assert.ok(f, 'front scheduled instead of applied');
  assert.equal(f.type, 'dunkelflaute');
  assert.ok(f.inHours >= FORECAST.leadHmin - 1.2 && f.inHours <= FORECAST.leadHmax, 'lead time in range');
  assert.ok(f.durationH >= FORECAST.flauteHmin && f.durationH <= FORECAST.flauteHmax, 'duration in range');
  assert.equal(G.dunkelflaute, 0, 'NOT active yet — this is the preparation window');
  assert.deepEqual(tips, ['dunkelflaute'], 'advisor warns when the front is scheduled, not on arrival');
});

test('no double-scheduling while a front is pending', () => {
  Math.random = () => 0.0001; // every roll would fire if evaluated
  G.day = 5;
  G.weatherFront = { type: 'storm', inHours: 6, durationH: FORECAST.stormH };
  updateWeather(1.2);
  updateWeather(1.2);
  assert.equal(G.weatherFront.type, 'storm', 'pending front not replaced');
  assert.ok(Math.abs(G.weatherFront.inHours - 3.6) < 1e-9, 'same front, still counting down');
});

test('no scheduling while a dunkelflaute is active', () => {
  Math.random = () => 0.0001;
  G.day = 5;
  G.dunkelflaute = 30;
  updateWeather(1.2);
  assert.equal(G.weatherFront, null);
});

test('forecast shape: 8 slots of 3 h with sun/night flags, wind trend, front passthrough', () => {
  G.minutes = 12 * 60; // noon
  updateWeather(0.5);
  const fc = G.forecast;
  assert.ok(fc, 'forecast rebuilt every updateWeather call');
  assert.equal(fc.slots.length, FORECAST.horizonH / FORECAST.slotH);
  for (const sl of fc.slots) {
    assert.equal(typeof sl.hour, 'number');
    assert.ok(sl.sun >= 0 && sl.sun <= 1.2, 'sun is a relative solar factor');
    assert.equal(typeof sl.night, 'boolean');
    assert.equal(typeof sl.flaute, 'boolean');
    assert.equal(typeof sl.storm, 'boolean');
    if (sl.night) assert.equal(sl.sun, 0, 'no sun at night — ever');
  }
  assert.ok(fc.slots.some(sl => sl.night), 'a 24 h outlook always crosses a night');
  assert.ok(fc.slots.some(sl => !sl.night && sl.sun > 0), 'and some daylight');
  assert.equal(typeof fc.windTrend, 'number');
  assert.ok(fc.windTrend >= 0 && fc.windTrend <= 1.2);
  assert.equal(fc.front, null, 'no front → null passthrough');

  G.weatherFront = { type: 'dunkelflaute', inHours: 11, durationH: 44 };
  updateWeather(0.1);
  assert.deepEqual(G.forecast.front,
    { type: 'dunkelflaute', inHours: G.weatherFront.inHours, durationH: 44 },
    'scheduled front passes through the forecast');
  assert.ok(G.forecast.slots.some(sl => sl.flaute), 'slots after arrival are flagged flaute');
  assert.equal(G.forecast.slots[0].flaute, false, 'slots before arrival are not');
});

test('forecast darkens during an active dunkelflaute', () => {
  G.dunkelflaute = 10;
  updateWeather(0.5);
  const sl = G.forecast.slots;
  assert.equal(sl[0].flaute, true, 'now is inside the flaute');
  assert.equal(sl[7].flaute, false, '24 h out the flaute is over (10 h left)');
});

test('forecast is derived state — rebuilt each tick, so a loaded save regains it', () => {
  G.forecast = null; // what restore() leaves behind
  updateWeather(0.5);
  assert.ok(G.forecast, 'first updateWeather after load rebuilds it');
});
