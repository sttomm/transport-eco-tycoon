// Daily report card: closeDay() snapshots yesterday's daily counters into a
// report object on G.reports (ring buffer, last REPORT_KEEP days) and emits
// 'dayReport'. Each card carries a per-category ledger snapshot (WP3).
// trackDay() accumulates the per-day observations no other tick books anywhere
// (blackout / dunkelflaute / storm / heatwave hours). Pure sim — the end-of-day toast and
// the "Yesterday" dashboard block live in src/ui/hud.js.
//
// Call order in sim/tick.js rollOverDay() matters: closeDay() runs BEFORE the
// shared daily counters (income/expenses/curtailed/finance) are reset, so the
// report captures the finished day. closeDay() resets only the counters this
// module owns (blackoutHoursToday, flauteHoursToday, stormHoursToday,
// heatHoursToday).
import { G, emit } from './state.js';
import { LOAN_RATE } from './loans.js';
import { totalUpkeep } from './energy.js';

export const REPORT_KEEP = 28; // one game year (4 × 7-day seasons) of report cards

// Called every frame from main.js next to the other ticks (after tickGrid,
// so G.blackout reflects the current grid state).
export function trackDay(gameHours) {
  if (G.blackout) G.blackoutHoursToday += gameHours;
  if (G.dunkelflaute > 0) G.flauteHoursToday += gameHours;
  if (G.wind > 0.96) G.stormHoursToday += gameHours; // above turbine cut-out
  if (G.heatwave > 0) G.heatHoursToday += gameHours; // heat dome active (ADR 24)
}

// Aggregate the day that just ended into a report. CO₂ is stored as lifetime
// cumulatives; the daily delta is derived from the previous report (reports
// are persisted in saves, so the chain survives save/load; after resetState()
// both cumulatives and reports start at zero, so it stays consistent).
export function closeDay() {
  const prev = G.reports[G.reports.length - 1];
  // fixed daily costs (reported here; billed into the NEW day by dailyUpkeep)
  const upkeep = totalUpkeep();
  const f = G.finance.today;
  const report = {
    day: G.day,
    // income
    incomeEnergy: G.incomeEnergyToday,
    incomeBus: f.bus || 0,
    incomeTruck: f.truck || 0,
    incomeTrain: f.train || 0,
    incomeTransport: G.incomeTransportToday,
    // costs
    expenses: G.expensesToday,
    net: G.incomeEnergyToday + G.incomeTransportToday - G.expensesToday,
    upkeep,
    loanInterest: G.loan * LOAN_RATE,
    gasMWh: G.gasMWhToday,
    gasCost: G.gasCostToday,
    importMWh: G.importMWhToday,
    importCost: G.importCostToday,
    h2SoldMWh: G.h2SoldMWhToday,
    compCost: G.compCostToday,
    gridFee: G.gridFeeToday,
    // CO₂: daily deltas + lifetime cumulatives (the latter anchor the deltas)
    co2Emitted: G.co2EmittedTons - (prev ? prev.co2EmittedTotal || 0 : 0),
    co2Saved: G.co2SavedTons - (prev ? prev.co2SavedTotal || 0 : 0),
    co2EmittedTotal: G.co2EmittedTons,
    co2SavedTotal: G.co2SavedTons,
    // grid quality
    blackoutHours: G.blackoutHoursToday,
    curtailedMWh: G.curtailedTodayMWh,
    flauteHours: G.flauteHoursToday,
    stormHours: G.stormHoursToday,
    heatHours: G.heatHoursToday,
    // per-category ledger snapshot of the finished day (WP3) — the source for
    // the report's income/expense trees. Copied so the archived ledger.days
    // entry and this snapshot can't alias and drift.
    ledger: { ...G.ledger.today },
  };
  G.reports.push(report);
  while (G.reports.length > REPORT_KEEP) G.reports.shift();
  // reset only the counters this module owns — main.js resets the shared ones
  G.blackoutHoursToday = 0;
  G.flauteHoursToday = 0;
  G.stormHoursToday = 0;
  G.heatHoursToday = 0;
  emit('dayReport', report);
  return report;
}
