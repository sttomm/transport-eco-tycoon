// The sim heartbeat: tickSim() advances the clock and runs every sim system
// in the pinned order below. main.js calls it once per frame; tests call it
// directly to play whole game days headless (test/helpers.js `playDays`).
//
// Tick order is load-bearing:
//   updateWeather → tickGrid   (grid dispatch needs current weather)
//   tickGrid → trackDay        (report counters read the fresh G.blackout)
//   tickGrid → tickIndustries  (industries read LAST tick's indCurtailed /
//                               servedFraction — the one-tick lag is by design)
import { G } from './state.js';
import { updateWeather, tickGrid, sampleHistory, dailyUpkeep, rollFossilFreeDay } from './energy.js';
import { tickVehicles, autoReplaceFleet } from './transport.js';
import { tickIndustries } from './industries.js';
import { tickCities } from './cities.js';
import { tickContracts } from './contracts.js';
import { tickResearch } from './research.js';
import { dailyLoanInterest } from './loans.js';
import { closeDay, trackDay } from './reports.js';
import { rollLedgerDay } from './finance.js';

export const MIN_PER_SEC = 8; // game minutes per real second at 1× → 1 day = 3 real minutes

// Advance the sim by dtSeconds of real time (scaled by G.speed).
export function tickSim(dtSeconds) {
  const gm = dtSeconds * MIN_PER_SEC * G.speed; // game minutes this step
  if (gm <= 0) return;
  const gh = gm / 60;                           // game hours
  G.minutes += gm;
  if (Math.floor(G.minutes / 1440) + 1 > G.day) rollOverDay();
  updateWeather(gh);
  tickGrid(gh);
  trackDay(gh);
  tickIndustries(gh);
  tickVehicles(dtSeconds, gh);
  tickCities(gh);
  tickContracts(gh);
  tickResearch(gh);
  sampleHistory(gm);
}

// Day rollover. Order is load-bearing:
//   1. closeDay() captures the finished day BEFORE any counter resets
//   2. rollLedgerDay() archives the finished day's ledger tally (closeDay
//      already snapshotted it into the report) so upkeep/interest below book
//      into the NEW day, matching the report's convention
//   3. rollFossilFreeDay() reads gasMWhToday, so it too runs before the resets
//   4. shared daily counters reset (energy/transport/report modules own theirs)
//   5. upkeep & loan interest book AFTER the reset, into the new day
export function rollOverDay() {
  closeDay();
  rollLedgerDay();
  G.day = Math.floor(G.minutes / 1440) + 1;
  rollFossilFreeDay();
  G.incomeTransportToday = 0; G.incomeEnergyToday = 0; G.expensesToday = 0;
  G.curtailedTodayMWh = 0;
  G.finance.prev = G.finance.today; // keep yesterday for the finance drill-down
  G.finance.today = { bus: 0, truck: 0, train: 0, routes: {} };
  dailyUpkeep();
  dailyLoanInterest();
  autoReplaceFleet(); // renew opted-in routes' aged vehicles (ADR 27)
}
