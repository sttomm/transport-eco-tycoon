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
import { G, emit, fmtMoney } from './state.js';
import { LOAN_RATE } from './loans.js';
import { totalUpkeep } from './energy.js';
import { REPORT_ALERTS } from './data.js';
import { happinessFactors } from './cities.js';
import { isCityServed } from './stations.js';
import { contractLabel, contractDest } from './contracts.js';
import { pushNews } from './news.js';

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
  // per-city snapshot for tomorrow's yesterday↔today diff. `peak` carries the
  // all-time happiness high forward through the report chain (survives saves).
  report.cityStats = G.cities.map(c => {
    const was = prev && prev.cityStats ? prev.cityStats.find(s => s.name === c.name) : null;
    return {
      name: c.name,
      happiness: c.happiness,
      foodLevel: c.foodLevel || 0,
      goodsLevel: c.goodsLevel || 0,
      peak: Math.max(c.happiness, was ? was.peak || 0 : 0),
    };
  });
  // problems & achievements: diff yesterday↔today, store on the card AND push
  // to the news feed (type:'city') so nothing passes unseen (WP2).
  const { problems, achievements } = detectReportEvents(report, prev);
  report.problems = problems;
  report.achievements = achievements;
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

// Build one problem/achievement record AND drop it in the news feed (type
// 'city'). The returned object is what the report card and the modal render.
function alert(list, icon, headline, body, refs = null) {
  list.push({ icon, headline, body, refs });
  pushNews({ type: 'city', icon, headline, body, refs });
}

// Diff the finished day against the previous report to surface what changed.
// Pure sim — no DOM. `prev` is yesterday's card (undefined on day 1 / after a
// reset), so every check tolerates a missing baseline.
function detectReportEvents(report, prev) {
  const A = REPORT_ALERTS;
  const problems = [], achievements = [];
  const before = name => (prev && prev.cityStats) ? prev.cityStats.find(s => s.name === name) : null;

  for (const c of G.cities) {
    // Only scold/celebrate cities the player actually serves (has a bus stop,
    // freight depot or train station within reach) — a city with no coverage
    // yet isn't something the player can act on. Aggregate stats (cityStats,
    // happiness itself) still cover every city; this only gates which
    // per-city entries turn into problems/achievements/news.
    if (!isCityServed(c)) continue;
    const was = before(c.name);
    // problem: happiness fell more than the threshold — name the dominant gap
    if (was && c.happiness < was.happiness - A.happinessDrop) {
      const worst = happinessFactors(c)
        .map(f => ({ label: f.label, gap: f.max - f.got }))
        .filter(x => x.gap > 0)
        .sort((a, b) => b.gap - a.gap)[0];
      const drop = Math.round((was.happiness - c.happiness) * 100);
      alert(problems, '🏙', `${c.name} is getting unhappy`,
        `Happiness fell ${drop} pts to ${Math.round(c.happiness * 100)}%` +
        (worst ? ` — biggest shortfall: ${worst.label.toLowerCase()}.` : '.'),
        { i: c.ci, j: c.cj, name: c.name });
    }
    if (was) {
      // achievement: food / goods crossed the well-supplied threshold upward
      for (const [key, label] of [['foodLevel', 'Food'], ['goodsLevel', 'Goods']]) {
        if ((was[key] || 0) < A.supplyThreshold && (c[key] || 0) >= A.supplyThreshold)
          alert(achievements, '📦', `${c.name} is well supplied`,
            `${label} in ${c.name} crossed ${Math.round(A.supplyThreshold * 100)}% — happiness will climb.`,
            { i: c.ci, j: c.cj, name: c.name });
      }
      // achievement: a new happiness high (only celebrated once it's genuinely high)
      if (c.happiness >= A.happyRecordMin && c.happiness > (was.peak || 0) + 1e-4)
        alert(achievements, '🌟', `${c.name} happiness record`,
          `${c.name} reached a new high of ${Math.round(c.happiness * 100)}% happiness.`,
          { i: c.ci, j: c.cj, name: c.name });
    }
  }

  // problem: blackout hours logged today
  if (report.blackoutHours > A.blackoutHours)
    alert(problems, '⚠', 'Blackouts on the grid',
      `${report.blackoutHours.toFixed(1)} h of blackout today` +
      ((report.compCost || 0) > 500 ? ` — ${fmtMoney(report.compCost)} paid in compensation` : '') +
      ' — add generation or storage before the peak.');

  // problem: a signed contract whose deadline is now within a day
  for (const c of G.contracts.active) {
    if (c.deadline == null) continue;
    const left = c.deadline - G.minutes;
    if (left > 0 && left <= A.contractDeadlineMin)
      alert(problems, '📜', 'Contract deadline approaching',
        `${contractLabel(c)} — ${Math.round(c.progress)}/${Math.round(c.amount)} delivered, deadline in under a day.`,
        contractDest(c));
  }

  // achievement: fossil-free streak milestone. rollFossilFreeDay() runs AFTER
  // closeDay(), so derive the streak this clean day WILL produce.
  const streak = report.gasMWh === 0 ? G.fossilFreeDays + 1 : 0;
  if (A.fossilFreeMilestones.includes(streak))
    alert(achievements, '🌱', `${streak}-day fossil-free streak`,
      `The grid ran ${streak} day${streak === 1 ? '' : 's'} straight without firing the gas plant.`);

  return { problems, achievements };
}
