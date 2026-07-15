// Finance ledger (WP3). Every money mutation is booked into a per-category
// tally so the daily report, the money-hover breakdown and the Finance stats
// tab can show WHERE the money went — not one gray "expenses" lump.
//
//   book(cat, amount)  — + = income, − = expense, into G.ledger.today[cat]
//   rollLedgerDay()    — archive today's tally into the 28-day ring, then reset
//
// Categories are data (data.js LEDGER_CATS): `invest` marks capex (out of the
// operating net), `balance` marks loan draw/repay (out of BOTH nets — they are
// balance-sheet, not P&L). Pure logic — state.js#spend/earn call book(); the
// stats modal (ui/hud/statsModal.js) renders the tallies.
import { G } from './state.js';
import { LEDGER_CATS } from './data.js';

export const LEDGER_KEEP = 28; // days of history kept (one game year = 4 × 7)

export function book(cat, amount) {
  if (!cat || !amount) return;
  const t = G.ledger.today;
  t[cat] = (t[cat] || 0) + amount;
}

// day rollover: archive today's tally (called from sim/tick.js#rollOverDay,
// AFTER closeDay() has snapshotted it into the report card so the archived
// day and the report agree) and start a fresh empty day.
export function rollLedgerDay() {
  G.ledger.days.push(G.ledger.today);
  while (G.ledger.days.length > LEDGER_KEEP) G.ledger.days.shift();
  G.ledger.today = {};
}

// the two P&L nets for a day tally. netOperating excludes `invest` (capex)
// categories; both exclude `balance` (loan draw/repay) — the gas penalty and
// upkeep become legible against real income instead of vanishing into a lump.
export function ledgerNets(day = G.ledger.today) {
  let netOperating = 0, netTotal = 0;
  for (const cat in day) {
    const def = LEDGER_CATS[cat];
    if (!def || def.balance) continue;
    netTotal += day[cat];
    if (!def.invest) netOperating += day[cat];
  }
  return { netOperating, netTotal };
}

// income / expense totals for a day tally (loans always excluded; invest
// optional so the Finance chart's "include investments" toggle can drop capex).
export function ledgerTotals(day = G.ledger.today, { includeInvest = true } = {}) {
  let income = 0, expense = 0;
  for (const cat in day) {
    const def = LEDGER_CATS[cat];
    if (!def || def.balance) continue;
    if (def.invest && !includeInvest) continue;
    if (day[cat] >= 0) income += day[cat]; else expense += day[cat];
  }
  return { income, expense };
}
