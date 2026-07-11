// Quest chains: completion pays out, unlocks the next objective, announces
// itself via the 'toast' event (the sim never touches the DOM).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, resetState, on } from '../src/sim/state.js';
import { QUESTS, isQuestActive, initQuestState, checkQuests } from '../src/sim/quests.js';

beforeEach(() => { resetState(); initQuestState(); });

test('quests without prerequisites start active; chained ones are locked', () => {
  const active = QUESTS.filter(isQuestActive).map(q => q.id);
  assert.ok(active.includes('localLine'));
  assert.ok(active.includes('grainChain'));
  assert.ok(active.includes('storagePlay'));
  assert.ok(active.includes('fossilFree'), 'the phase-out goal is visible from day 1');
  assert.ok(!active.includes('interLine'), 'needs localLine first');
});

test('fossil-free week: 7 clean days complete the de-facto win condition with a celebration', () => {
  const toasts = [];
  on('toast', t => toasts.push(t));
  G.fossilFreeDays = 6;
  checkQuests();
  assert.ok(!G.questsDone.fossilFree, 'six days are not enough');
  G.fossilFreeDays = 7;
  const before = G.money;
  checkQuests();
  assert.equal(G.questsDone.fossilFree, true);
  assert.equal(G.money, before + 100000);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0].title, /🏆/, 'win toast, not a plain objective toast');
  assert.match(toasts[0].text, /clean power/);
});

test('completing a quest pays the reward and unlocks its successor', () => {
  const toasts = [];
  on('toast', t => toasts.push(t.title));
  const before = G.money;
  G.stats.paxLocal = 40; // localLine target
  checkQuests();
  assert.equal(G.questsDone.localLine, true);
  assert.equal(G.money, before + 18000);
  assert.ok(isQuestActive(QUESTS.find(q => q.id === 'interLine')), 'chain advanced');
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /Crosstown/);
});

test('a completed quest never pays twice', () => {
  G.stats.paxLocal = 40;
  checkQuests();
  const after = G.money;
  checkQuests();
  assert.equal(G.money, after);
});

test('live-value quests read grid state (battery capacity)', () => {
  G.batteryCapMWh = 80;
  checkQuests();
  assert.equal(G.questsDone.storagePlay, true);
});

test('every quest has the fields the panel needs', () => {
  for (const q of QUESTS) {
    assert.ok(q.id && q.title && q.desc, q.id);
    assert.ok(q.target > 0, q.id);
    assert.ok(q.reward > 0, q.id);
    assert.equal(typeof q.value, 'function', q.id);
    if (q.req) assert.ok(QUESTS.some(x => x.id === q.req), `${q.id} req exists`);
  }
});
