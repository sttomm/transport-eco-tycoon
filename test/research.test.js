// Research (sim/research.js): one project at a time, paid up front,
// progresses with game time, applies its effects exactly once on completion.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, resetState, on } from '../src/sim/state.js';
import { startResearch, tickResearch } from '../src/sim/research.js';
import { TECHS } from '../src/sim/data.js';

beforeEach(() => resetState());

const rootTech = () => TECHS.find(t => !t.req);
const childTech = () => TECHS.find(t => t.req);

test('startResearch spends the cost and opens the project', () => {
  const t = rootTech();
  const before = G.money;
  assert.equal(startResearch(t.id), true);
  assert.equal(G.money, before - t.cost);
  assert.deepEqual(G.research, { id: t.id, progress: 0, days: t.days });
});

test('startResearch refuses: busy lab, empty wallet, unknown/locked/done techs', () => {
  const t = rootTech();
  G.money = t.cost - 1;
  assert.equal(startResearch(t.id), 'poor');
  G.money = 1e9;
  assert.equal(startResearch('no-such-tech'), 'invalid');
  const locked = childTech();
  assert.equal(startResearch(locked.id), 'invalid', 'prerequisite not researched yet');
  assert.equal(startResearch(t.id), true);
  assert.equal(startResearch(rootTech().id), 'busy', 'one project at a time');
  G.techs[t.id] = true; G.research = null;
  assert.equal(startResearch(t.id), 'invalid', 'already researched');
});

test('tickResearch progresses linearly and completes after days×24 game hours', () => {
  const t = rootTech();
  startResearch(t.id);
  tickResearch(t.days * 24 / 2);
  assert.ok(Math.abs(G.research.progress - 0.5) < 1e-9, 'halfway after half the time');
  const events = [];
  on('researchDone', x => events.push(x.id));
  on('toast', x => events.push('toast:' + x.title));
  tickResearch(t.days * 24 / 2);
  assert.equal(G.research, null);
  assert.equal(G.techs[t.id], true);
  assert.deepEqual(events, ['toast:Research complete!', t.id], 'completion announced via the bus');
});

test('completing a prerequisite unlocks its child tech', () => {
  const locked = childTech();
  G.techs[locked.req] = true;
  assert.equal(startResearch(locked.id), true);
});

test('completion applies the tech effect to G.mult exactly once', () => {
  const t = rootTech();
  const before = JSON.stringify(G.mult);
  startResearch(t.id);
  tickResearch(t.days * 24 + 1);
  const after = JSON.stringify(G.mult);
  assert.notEqual(after, before, 'fx mutated the multipliers');
  tickResearch(10);
  assert.equal(JSON.stringify(G.mult), after, 'no research active — no further effect');
});
