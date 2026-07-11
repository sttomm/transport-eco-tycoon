// Guided onboarding tutorial (ADR 29): opt-in step sequence, completion
// detected from live game state relative to baselines captured at start,
// rewards paid per step plus a graduation bonus. Never gates the sandbox.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, on } from '../src/sim/state.js';
import { place } from '../src/sim/grid.js';
import { createRoute, buyVehicle } from '../src/sim/transport.js';
import {
  TUTORIAL_STEPS, TUTORIAL_BONUS, initTutorialState, startTutorial,
  skipTutorial, notifyTutorial, checkTutorial,
} from '../src/sim/tutorial.js';
import { snapshot, restore } from '../src/sim/save.js';
import { freshWorld, findSpot, stationSpotNearCity } from './helpers.js';

beforeEach(() => { freshWorld(); initTutorialState(); });

const step = () => TUTORIAL_STEPS[G.tutorial.step];

test('fresh state: tutorial is neither active nor done — the welcome screen decides', () => {
  assert.equal(G.tutorial.active, false);
  assert.equal(G.tutorial.done, false);
});

test('startTutorial captures baselines so pre-existing infrastructure never counts', () => {
  place('solar', 2, 84);
  G.batteryCapMWh = 40;
  startTutorial();
  assert.equal(G.tutorial.active, true);
  assert.equal(G.tutorial.base.solar, 1);
  assert.equal(G.tutorial.base.batteryCap, 40);
  // the solar step must NOT complete from the pre-tutorial farm
  G.tutorial.step = TUTORIAL_STEPS.findIndex(s => s.id === 'solar');
  const before = G.tutorial.step;
  checkTutorial();
  assert.equal(G.tutorial.step, before, 'baseline solar does not complete the step');
});

test('notifyTutorial flags only register while the tutorial is active', () => {
  notifyTutorial('cameraMoved');
  assert.equal(G.tutorial.flags.cameraMoved, undefined);
  startTutorial();
  notifyTutorial('cameraMoved');
  assert.equal(G.tutorial.flags.cameraMoved, true);
});

test('completing a step pays its reward, advances, and announces via toast', () => {
  startTutorial();
  const toasts = [];
  on('toast', t => toasts.push(t.title));
  const before = G.money;
  notifyTutorial('cameraMoved');
  checkTutorial();
  assert.equal(G.tutorial.step, 1);
  assert.equal(G.money, before + TUTORIAL_STEPS[0].reward);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /✅/);
});

test('an unmet step neither pays nor advances', () => {
  startTutorial();
  const before = G.money;
  checkTutorial();
  assert.equal(G.tutorial.step, 0);
  assert.equal(G.money, before);
});

test('full playthrough: every step completes off real sim actions, finale pays the bonus', () => {
  startTutorial();
  const done = [];
  on('tutorialDone', d => done.push(d));
  const expectReward = [];

  // 1. look around
  notifyTutorial('cameraMoved');
  // 2. dashboard tab
  notifyTutorial('tab:dashboard');
  // 3. solar farm
  place('solar', ...findSpot('solar'));
  // 4. battery
  place('battery', ...findSpot('battery'));
  // 5. two bus stops in Solhaven
  const city = G.cities[0];
  const a = stationSpotNearCity(city, 'busStop');
  const stopA = place('busStop', ...a);
  const stopB = place('busStop', ...stationSpotNearCity(city, 'busStop', a, 6));
  // 6. route with both stops
  const r = createRoute();
  r.stops.push(stopA, stopB);
  // 7. buy a bus
  assert.ok(buyVehicle(r, 'bus'), 'bus route is drivable');
  // 8. carry 5 passengers
  G.stats.paxLocal += 5;
  // 9. read an objective
  notifyTutorial('questOpened');

  const before = G.money;
  for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
    expectReward.push(TUTORIAL_STEPS[G.tutorial.step].reward);
    checkTutorial(); // advances exactly one step per call
  }
  assert.equal(G.tutorial.done, true);
  assert.equal(G.tutorial.active, false);
  assert.equal(done.length, 1);
  assert.equal(G.money, before + expectReward.reduce((x, y) => x + y, 0) + TUTORIAL_BONUS);
  checkTutorial(); // done tutorials never pay again
  assert.equal(G.money, before + expectReward.reduce((x, y) => x + y, 0) + TUTORIAL_BONUS);
});

test('skipTutorial marks it done without paying anything', () => {
  startTutorial();
  const before = G.money;
  skipTutorial();
  assert.equal(G.tutorial.done, true);
  assert.equal(G.tutorial.active, false);
  assert.equal(G.money, before);
});

test('save/restore keeps a tutorial in progress, including flags and baselines', () => {
  startTutorial();
  notifyTutorial('cameraMoved');
  checkTutorial();
  const snap = JSON.parse(JSON.stringify(snapshot()));
  freshWorld();
  assert.ok(restore(snap));
  assert.equal(G.tutorial.active, true);
  assert.equal(G.tutorial.step, 1);
  assert.equal(G.tutorial.flags.cameraMoved, true);
  assert.ok(G.tutorial.base, 'baselines survive the round trip');
});

test('pre-tutorial saves restore as done — existing players are never onboarded', () => {
  const snap = JSON.parse(JSON.stringify(snapshot()));
  delete snap.tutorial;
  freshWorld();
  assert.ok(restore(snap));
  assert.equal(G.tutorial.done, true);
  assert.equal(G.tutorial.active, false);
});

test('every step has the fields the card needs, and highlights the tutorial can rely on', () => {
  const ids = new Set();
  for (const s of TUTORIAL_STEPS) {
    assert.ok(s.id && s.title && s.text && s.task, s.id);
    assert.ok(s.reward > 0, s.id);
    assert.equal(typeof s.check, 'function', s.id);
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    ids.add(s.id);
  }
});
