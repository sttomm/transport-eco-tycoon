// Bank loans: borrow in fixed steps up to a ceiling, pay daily interest
// (charged with the daily upkeep), repay any time you have the cash.
// Teaching angle: renewables are capital-intensive — nearly all cost is
// upfront and the "fuel" is free, so the cost of capital matters.
// Pure logic — the 🏦 box in the dashboard lives in src/ui/hud.js.
import { G, emit } from './state.js';

export const LOAN_STEP = 50000;
export const LOAN_MAX = 500000;
export const LOAN_RATE = 0.01;   // interest per game day on the outstanding loan

export function takeLoan(amount = LOAN_STEP) {
  amount = Math.min(amount, LOAN_MAX - G.loan);
  if (amount <= 0) return false;
  G.loan += amount;
  G.money += amount;
  emit('tip', 'firstLoan');
  return true;
}

// pays back min(amount, outstanding loan) — but only from cash on hand
export function repayLoan(amount = LOAN_STEP) {
  amount = Math.min(amount, G.loan, G.money);
  if (amount <= 0) return false;
  G.loan -= amount;
  G.money -= amount;
  return true;
}

// called once per game day from the main loop's day rollover
export function dailyLoanInterest() {
  const due = G.loan * LOAN_RATE;
  if (due <= 0) return 0;
  G.money -= due;
  G.expensesToday += due;
  return due;
}
