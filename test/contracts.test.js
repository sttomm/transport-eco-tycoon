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
  MAX_OFFERS, MAX_ACTIVE, PREMIUM,
} from '../src/sim/contracts.js';
import { tickIndustries, tickVehicles, createRoute, buyVehicle } from '../src/sim/transport.js';
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
      assert.ok(G.cities[o.fromCity].neighbors.includes(o.toCity), 'pax offers link neighbouring cities');
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
  assert.equal(G.contracts.completed, 1);
  assert.equal(G.contracts.active.length, 0);
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
  assert.equal(G.contracts.failed, 1);
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
