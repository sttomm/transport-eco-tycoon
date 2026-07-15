// Express (long-haul) pairs & long-distance passenger demand (ADR 35).
// Worldgen assigns each city 1–2 far, non-neighbour "express destinations";
// tickCities streams a share of demand to them (other non-neighbour pools
// still drain to zero), and long-haul pax contracts can target them.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/sim/state.js';
import { initGrid } from '../src/sim/grid.js';
import { PAX } from '../src/sim/data.js';
import { tickCities } from '../src/sim/cities.js';
import { contractDelivery, PREMIUM } from '../src/sim/contracts.js';
import { freshWorld } from './helpers.js';

beforeEach(() => freshWorld());

const dist = (a, b) => Math.hypot(a.ci - b.ci, a.cj - b.cj);

test('every city gets 1–2 valid express destinations', () => {
  for (const c of G.cities) {
    assert.ok(c.express.length >= 1 && c.express.length <= 2,
      `${c.name} has 1–2 express destinations (got ${c.express.length})`);
    for (const oi of c.express) {
      const o = G.cities[oi];
      assert.ok(oi !== c.idx, 'not itself');
      assert.ok(!c.neighbors.includes(oi), `${o.name} is not already a neighbour of ${c.name}`);
      assert.ok(dist(c, o) > PAX.expressMinDist, `${c.name}→${o.name} is a long haul (> ${PAX.expressMinDist})`);
      assert.ok(o.express.includes(c.idx), 'express links are symmetric (one route serves both ways)');
    }
  }
});

test('express pairs are deterministic from the world seed', () => {
  const a = G.cities.map(c => c.express.join(','));
  freshWorld();
  const b = G.cities.map(c => c.express.join(','));
  assert.deepEqual(a, b);
});

test('demand flows to express (non-neighbour) cities; other non-neighbours stay empty', () => {
  G.minutes = 12 * 60; // daytime
  tickCities(24);      // a full day of demand
  let sawExpressFlow = false;
  for (const c of G.cities) {
    c.paxTo.forEach((n, oi) => {
      if (oi === c.idx) return;
      const isNb = c.neighbors.includes(oi), isExp = c.express.includes(oi);
      if (isExp) { assert.ok(n > 0, `${c.name} ⇒ ${G.cities[oi].name} express demand flows`); sawExpressFlow = true; }
      else if (!isNb) assert.equal(n, 0, `${c.name} → ${G.cities[oi].name} (neither) stays empty`);
    });
  }
  assert.ok(sawExpressFlow, 'at least one express pool accumulated demand');
});

test('express demand respects its own cap', () => {
  G.minutes = 12 * 60;
  for (let d = 0; d < 30; d++) tickCities(24); // saturate the pools
  for (const c of G.cities) {
    for (const oi of c.express) {
      assert.ok(c.paxTo[oi] <= PAX.expressCap + 1e-9,
        `${c.name} ⇒ ${G.cities[oi].name} capped at ${PAX.expressCap}`);
    }
  }
});

test('long-haul passenger contracts match an express (non-neighbour) pair', () => {
  // pick a city and one of its express (non-neighbour) destinations
  const from = G.cities.find(c => c.express.length);
  const toIdx = from.express[0];
  assert.ok(!from.neighbors.includes(toIdx), 'the pair is a genuine long haul, not a neighbour');
  const c = { id: 42, kind: 'pax', cargoId: 'pax', fromCity: from.idx, toCity: toIdx,
    toInd: null, amount: 10, mult: PREMIUM, bonus: 3000, progress: 0, earned: 0,
    days: 4, expires: 0, deadline: G.minutes + 4 * 1440 };
  G.contracts.active.push(c);
  // wrong direction ignored; correct direction accrues premium + progress
  assert.equal(contractDelivery('pax', { fromCity: toIdx, toCity: from.idx }, 5, 200), 0);
  const before = G.money;
  const extra = contractDelivery('pax', { fromCity: from.idx, toCity: toIdx }, 10, 400);
  assert.ok(extra > 0, 'premium paid on the matching long-haul delivery');
  assert.equal(G.money, before + 3000, 'completion bonus paid');
  assert.equal(G.contracts.history.at(-1).outcome, 'done');
});
