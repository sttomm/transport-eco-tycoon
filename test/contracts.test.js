// Special transport contracts: offer rotation, signing, premium payments on
// matching deliveries, completion bonus and deadline failure — plus the hook
// in the freight path (arriveAtStation → contractDelivery).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, on } from '../src/sim/state.js';
import { place } from '../src/sim/grid.js';
import { INDUSTRY_TYPES, CARGO } from '../src/sim/data.js';
import {
  tickContracts, signContract, contractDelivery, contractLabel, contractDest,
  contractsDone, contractsExpired,
  MAX_OFFERS, MAX_ACTIVE, PREMIUM,
} from '../src/sim/contracts.js';
import { CONTRACTS } from '../src/sim/data.js';
import { tickVehicles, createRoute, buyVehicle } from '../src/sim/transport.js';
import { tickIndustries } from '../src/sim/industries.js';
import { freshWorld, buildRoad, fakeIndustry } from './helpers.js';

beforeEach(() => freshWorld());

// a synthetic signed contract, bypassing the random generator
function activeContract(over = {}) {
  const c = {
    id: 999, kind: 'cargo', cargoId: 'grain', fromCity: null, toCity: null, toInd: 0,
    amount: 10, mult: PREMIUM, bonus: 5000, progress: 0, days: 2,
    expires: G.minutes + 1440, deadline: G.minutes + 2 * 1440, ...over,
  };
  G.contracts.active.push(c);
  return c;
}

test('tickContracts fills the board with offers that reference real relations', () => {
  for (let i = 0; i < 10; i++) tickContracts(8);
  assert.equal(G.contracts.offers.length, MAX_OFFERS);
  for (const o of G.contracts.offers) {
    assert.ok(o.amount > 0 && o.bonus > 0 && o.mult > 1, 'priced');
    assert.ok(o.expires > G.minutes, 'signing window open');
    assert.equal(o.deadline, null, 'not signed yet');
    if (o.kind === 'pax') {
      const from = G.cities[o.fromCity];
      assert.ok(from.neighbors.includes(o.toCity) || from.express.includes(o.toCity),
        'pax offers link a neighbour OR a far express city (ADR 35)');
    } else if (o.cargoId === 'grain' || o.cargoId === 'ore') {
      const want = o.cargoId === 'grain' ? 'food' : 'steel';
      assert.equal(G.industries[o.toInd].type, want, 'cargo goes to the right processor');
    } else {
      assert.ok(G.cities[o.toCity], 'food/steel offers target a city');
    }
    assert.ok(contractLabel(o).includes('→'), 'has a readable label');
    assert.ok(contractDest(o).name, 'has a fly-to destination');
  }
});

test('unsigned offers expire and are replaced later', () => {
  tickContracts(1);
  const first = G.contracts.offers[0];
  G.minutes = first.expires + 1;
  tickContracts(0.1);
  assert.ok(!G.contracts.offers.includes(first), 'expired offer removed');
});

test('signing moves an offer to active with a hard deadline; portfolio is capped', () => {
  for (let i = 0; i < 10; i++) tickContracts(8);
  const offer = G.contracts.offers[0];
  assert.equal(signContract(offer), true);
  assert.ok(G.contracts.active.includes(offer));
  assert.equal(offer.deadline, G.minutes + offer.days * 1440);
  assert.equal(signContract(offer), false, 'cannot sign twice');
  for (let i = 0; i < MAX_ACTIVE - 1; i++) activeContract({ id: 100 + i });
  for (let i = 0; i < 10; i++) tickContracts(8);
  const next = G.contracts.offers[0];
  assert.equal(signContract(next), false, 'portfolio full');
  assert.ok(G.contracts.offers.includes(next), 'offer stays on the board');
});

test('matching deliveries pay the premium and complete the contract with a bonus', () => {
  const toasts = [];
  on('toast', t => toasts.push(t.title));
  const c = activeContract({ toInd: 3, amount: 10, bonus: 5000 });
  // wrong destination: no premium, no progress
  assert.equal(contractDelivery('grain', { toCity: null, toInd: 4 }, 6, 600), 0);
  assert.equal(contractDelivery('ore', { toCity: null, toInd: 3 }, 6, 600), 0, 'wrong cargo');
  assert.equal(c.progress, 0);
  // matching delivery: +50% of base pay
  assert.equal(contractDelivery('grain', { toCity: null, toInd: 3 }, 6, 600), 300);
  assert.equal(c.progress, 6);
  const before = G.money;
  contractDelivery('grain', { toCity: null, toInd: 3 }, 4, 400);
  assert.equal(G.money, before + 5000, 'completion bonus paid');
  assert.equal(contractsDone(), 1);
  assert.equal(G.contracts.active.length, 0);
  assert.equal(G.contracts.history.length, 1, 'archived to history');
  assert.equal(G.contracts.history[0].outcome, 'done');
  assert.equal(G.contracts.history[0].bonus, 5000);
  assert.ok(G.contracts.history[0].earned > 0, 'accumulated premium recorded');
  assert.match(toasts.join(), /fulfilled/);
});

test('passenger contracts match the exact direction city A → city B', () => {
  const c = activeContract({ kind: 'pax', cargoId: 'pax', fromCity: 0, toCity: 1, amount: 30 });
  assert.equal(contractDelivery('pax', { fromCity: 1, toCity: 0 }, 5, 200), 0, 'reverse direction ignored');
  assert.ok(contractDelivery('pax', { fromCity: 0, toCity: 1 }, 5, 200) > 0);
  assert.equal(c.progress, 5);
});

test('a missed deadline fails the contract without a money penalty', () => {
  const toasts = [];
  on('toast', t => toasts.push(t.title));
  activeContract({ deadline: G.minutes - 1 });
  const before = G.money;
  tickContracts(0.1);
  assert.equal(G.contracts.active.length, 0);
  assert.equal(contractsExpired(), 1);
  assert.equal(G.contracts.history[0].outcome, 'expired');
  assert.equal(G.contracts.history[0].bonus, 0, 'no bonus on expiry');
  assert.equal(G.money, before, 'no penalty');
  assert.match(toasts.join(), /expired/);
});

test('end to end: a signed grain contract boosts a real truck delivery', () => {
  const J = 90;
  buildRoad(2, J, 20, J);
  const depotA = place('truckStop', 4, J - 1);
  const depotB = place('truckStop', 16, J - 1);
  fakeIndustry('farm', INDUSTRY_TYPES.farm, 4, J - 4);
  const food = fakeIndustry('food', INDUSTRY_TYPES.food, 16, J - 4);
  // huge target so the contract stays open for the whole run
  const c = activeContract({ toInd: G.industries.indexOf(food), amount: 1e5, bonus: 0 });

  const r = createRoute();
  r.stops.push(depotA, depotB);
  buyVehicle(r, 'truck');
  G.speed = 10;
  const gh = 0.1 * 8 * G.speed / 60;
  for (let k = 0; k < 600; k++) { tickIndustries(gh); tickVehicles(0.1, gh); }

  assert.ok(c.progress > 0, `deliveries counted (got ${c.progress})`);
  assert.equal(c.progress, G.stats.grainToFood, 'every delivered unit counted');
  // the premium lands in the same finance books as the base pay
  assert.ok(G.incomeTransportToday > 0, 'delivery + premium paid');
  assert.equal(G.finance.today.truck, G.incomeTransportToday, 'premium booked under trucks');
});

// run the SAME grain truck operation from a fresh world, signing `n` matching
// contracts (sized to complete), and return the money earned over the run.
function grainRunEarnings(n) {
  freshWorld();
  const J = 90;
  buildRoad(2, J, 20, J);
  const depotA = place('truckStop', 4, J - 1);
  const depotB = place('truckStop', 16, J - 1);
  fakeIndustry('farm', INDUSTRY_TYPES.farm, 4, J - 4);
  const food = fakeIndustry('food', INDUSTRY_TYPES.food, 16, J - 4);
  const toInd = G.industries.indexOf(food);
  for (let k = 0; k < n; k++) {
    G.contracts.active.push({
      id: 500 + k, kind: 'cargo', cargoId: 'grain', fromCity: null, toCity: null,
      toInd, amount: 18, mult: PREMIUM, bonus: 5000, progress: 0, earned: 0,
      days: 6, expires: 0, deadline: G.minutes + 6 * 1440,
    });
  }
  const r = createRoute();
  r.stops.push(depotA, depotB);
  buyVehicle(r, 'truck'); // money-free (purchase wrapper charges; this doesn't)
  G.speed = 10;
  const gh = 0.1 * 8 * G.speed / 60;
  const start = G.money;
  for (let k = 0; k < 900; k++) { tickIndustries(gh); tickVehicles(0.1, gh); }
  return G.money - start;
}

test('headless run: signing 2 contracts clearly beats ignoring them', () => {
  const none = grainRunEarnings(0);
  const two = grainRunEarnings(2);
  assert.ok(none > 0, `baseline delivery income exists (${Math.round(none)})`);
  // two completed contracts add both €5,000 bonuses plus a +50% premium on
  // every matching delivery — the signed operation must win comfortably.
  assert.ok(two > none + 9000,
    `signing 2 contracts (${Math.round(two)}) must beat ignoring them (${Math.round(none)}) by ≥ the two bonuses`);
  assert.equal(contractsDone(), 2, 'both contracts completed within the deadline');
});
