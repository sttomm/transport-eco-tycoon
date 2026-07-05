// Bank loans: borrow up to the ceiling, daily interest as an expense,
// repayment limited by cash on hand and outstanding debt.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, resetState } from '../src/sim/state.js';
import { takeLoan, repayLoan, dailyLoanInterest, LOAN_STEP, LOAN_MAX, LOAN_RATE } from '../src/sim/loans.js';

beforeEach(() => resetState());

test('borrowing adds cash and debt, in steps up to the ceiling', () => {
  const cash = G.money;
  assert.equal(takeLoan(), true);
  assert.equal(G.loan, LOAN_STEP);
  assert.equal(G.money, cash + LOAN_STEP);
  while (G.loan < LOAN_MAX) assert.equal(takeLoan(), true);
  assert.equal(G.loan, LOAN_MAX);
  assert.equal(takeLoan(), false, 'ceiling reached');
  assert.equal(G.loan, LOAN_MAX, 'debt unchanged');
});

test('daily interest is charged on the outstanding amount as an expense', () => {
  takeLoan(200000);
  const cash = G.money, exp = G.expensesToday;
  const due = dailyLoanInterest();
  assert.equal(due, 200000 * LOAN_RATE);
  assert.equal(G.money, cash - due);
  assert.equal(G.expensesToday, exp + due);
  G.loan = 0;
  assert.equal(dailyLoanInterest(), 0, 'debt-free means no interest');
});

test('repayment is limited by debt and by cash on hand', () => {
  takeLoan(100000);
  assert.equal(repayLoan(), true);
  assert.equal(G.loan, 100000 - LOAN_STEP);
  // broke: only what is in the till can go to the bank
  G.money = 20000;
  assert.equal(repayLoan(), true);
  assert.equal(G.money, 0, 'paid all available cash');
  assert.equal(G.loan, 30000, 'partial repayment');
  assert.equal(repayLoan(), false, 'no cash left');
  G.money = 1e6;
  assert.equal(repayLoan(LOAN_MAX), true);
  assert.equal(G.loan, 0, 'never overpays past zero');
  assert.equal(G.money, 1e6 - 30000);
  assert.equal(repayLoan(), false, 'nothing left to repay');
});
