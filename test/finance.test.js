// Finance ledger (WP3): booking, day rollover ring, the two nets, and that
// the booked categories reconcile to the actual money delta over a played day.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, spend, earn } from '../src/sim/state.js';
import { book, rollLedgerDay, ledgerNets, ledgerTotals, LEDGER_KEEP } from '../src/sim/finance.js';
import { LEDGER_CATS } from '../src/sim/data.js';
import { placeStarterGrid } from '../src/sim/newGame.js';
import { freshWorld, playDays } from './helpers.js';

beforeEach(() => freshWorld());

test('book accumulates signed amounts per category into ledger.today', () => {
  book('energySale', 1000);
  book('energySale', 250);
  book('gasFuel', -300);
  assert.equal(G.ledger.today.energySale, 1250);
  assert.equal(G.ledger.today.gasFuel, -300);
  book('gridFee', 0); // zero is a no-op — no empty categories
  assert.ok(!('gridFee' in G.ledger.today));
});

test('spend and earn book under their category', () => {
  G.money = 100000;
  spend(4000, 'buildPlant');
  earn(9000, 'contractBonus');
  assert.equal(G.ledger.today.buildPlant, -4000);
  assert.equal(G.ledger.today.contractBonus, 9000);
  assert.equal(G.money, 100000 - 4000 + 9000);
  // a failed spend (not enough cash) books nothing
  G.money = 10;
  assert.equal(spend(999999, 'research'), false);
  assert.ok(!('research' in G.ledger.today));
});

test('rollLedgerDay archives today and starts fresh; ring caps at LEDGER_KEEP', () => {
  book('energySale', 500);
  rollLedgerDay();
  assert.equal(G.ledger.days.length, 1);
  assert.equal(G.ledger.days[0].energySale, 500);
  assert.deepEqual(G.ledger.today, {}, 'today reset after rollover');

  for (let i = 0; i < LEDGER_KEEP + 5; i++) { book('gasFuel', -i - 1); rollLedgerDay(); }
  assert.equal(G.ledger.days.length, LEDGER_KEEP, 'ring capped at LEDGER_KEEP');
  // the oldest were dropped: the last archived day is the most recent tally
  assert.equal(G.ledger.days[G.ledger.days.length - 1].gasFuel, -(LEDGER_KEEP + 5));
});

test('netOperating excludes investments; netTotal includes them; loans excluded from both', () => {
  book('energySale', 1000);
  book('gasFuel', -300);
  book('buildPlant', -5000); // invest
  book('loanDraw', 50000);   // balance sheet
  const { netOperating, netTotal } = ledgerNets();
  assert.equal(netOperating, 700, 'income − operating expense, no capex, no loans');
  assert.equal(netTotal, 700 - 5000, 'capex counts in the total net');
  // loans move neither net
  book('loanRepay', -50000);
  const after = ledgerNets();
  assert.equal(after.netOperating, 700);
  assert.equal(after.netTotal, -4300);
});

test('ledgerTotals can drop investments for the chart toggle', () => {
  book('energySale', 1000);
  book('buildPlant', -5000);
  const withInv = ledgerTotals(G.ledger.today, { includeInvest: true });
  assert.equal(withInv.income, 1000);
  assert.equal(withInv.expense, -5000);
  const noInv = ledgerTotals(G.ledger.today, { includeInvest: false });
  assert.equal(noInv.expense, 0, 'capex excluded');
});

test('every ledger category is well-formed data', () => {
  for (const [id, def] of Object.entries(LEDGER_CATS)) {
    assert.ok(def.label && def.icon && def.color, `${id} has label/icon/color`);
    assert.ok(def.kind === 'income' || def.kind === 'expense', `${id} has a kind`);
  }
});

test('booked categories reconcile to the money delta over played days', () => {
  placeStarterGrid();          // real starter grid, money-free (place() direct)
  const m0 = G.money;
  playDays(3);                 // full pipeline incl. day rollovers → ledger.days
  // sum every booked amount across the archive + the current day
  let sum = 0;
  for (const d of G.ledger.days) for (const c in d) sum += d[c];
  for (const c in G.ledger.today) sum += G.ledger.today[c];
  assert.ok(Math.abs(sum - (G.money - m0)) < 1e-6,
    `ledger (${sum.toFixed(2)}) must equal money delta (${(G.money - m0).toFixed(2)}) — a mutation is unbooked`);
});
