// Global game state shared by all modules. Pure data — no THREE, no DOM —
// so the whole simulation can run headless in Node (see test/).
import { book } from './finance.js';

function initialState() {
  return {
    // time
    minutes: 8 * 60,          // game time in minutes, start 08:00 day 1
    day: 1,
    speed: 1,                 // 0 = paused, 1/3/10
    // economy
    money: 600000,
    incomeTransportToday: 0,
    incomeEnergyToday: 0,
    expensesToday: 0,
    co2SavedTons: 0,
    loan: 0,                  // outstanding bank loan (see sim/loans.js)
    // energy-transition arc (shared field contract — see docs/ARCHITECTURE.md ADR 21/22)
    carbonPrice: 30,          // €/t CO₂, rises daily (data.js CARBON)
    co2EmittedTons: 0,        // lifetime emissions from the legacy gas plant
    gasMWhToday: 0,           // gas generation today (fossil-free-week tracking)
    gasCostToday: 0,          // today's gas fuel + carbon cost
    importMWhToday: 0,        // interconnector imports today (ADR 25)
    importCostToday: 0,       // today's import bill
    fossilFreeDays: 0,        // consecutive days with zero gas use
    gasDecommissioned: false, // legacy plant bought out (irreversible)
    price: 85,                // live electricity price €/MWh (flat until the Smart Market)
    marketLive: false,        // Smart Market active (dynamic pricing, day 10+)
    compCostToday: 0,         // today's blackout compensation (VoLL, energy.js)
    gridFeeToday: 0,          // today's grid operating costs (per MWh served)
    indCurtailed: false,      // industries paused by crisis prices (demand response)
    reports: [],              // last N daily report cards (closeDay())
    news: [],                 // notification feed ring (sim/news.js)
    // finance ledger (sim/finance.js): per-category income/expense tallies.
    // `today` accumulates the current day; `days` is the 28-day archive ring.
    ledger: { today: {}, days: [] },
    // special transport offers & signed contracts (see sim/contracts.js).
    // `history` is the ledger of record (done/expired); counters are derived.
    contracts: { offers: [], active: [], history: [], offerTimer: 0, seq: 1 },
    // weather (0..1)
    wind: 0.5,
    cloud: 0.25,
    dunkelflaute: 0,          // remaining hours of low-wind overcast event
    flauteCooldownH: 0,       // hours left before another Dunkelflaute may roll (post-event cooldown)
    heatwave: 0,              // remaining hours of heat-dome event (high demand, low wind — ADR 24)
    weatherFront: null,       // scheduled front { type: 'dunkelflaute'|'storm'|'heatwave', inHours, durationH }
    forecast: null,           // next-24h outlook (derived each tick by updateWeather, not saved)
    // world
    tiles: null,              // Int/obj grid
    N: 192,
    TILE: 4,
    cities: [],
    industries: [],
    plants: [],               // player energy buildings
    stations: [],
    routes: [],
    vehicles: [],
    // energy live values (MW)
    supply: { solar: 0, wind: 0, hydro: 0, battery: 0, fuelcell: 0, gas: 0, import: 0 },
    demand: { city: 0, industry: 0, charging: 0, electrolyzer: 0 },
    unservedMW: 0,
    curtailedMW: 0,
    servedFraction: 1,
    blackout: false,
    // storage
    batteryMWh: 0, batteryCapMWh: 0, batteryRateMW: 0,
    h2MWh: 0, h2CapMWh: 0, elecCapMW: 0, fcCapMW: 0,
    importCapMW: 0,           // interconnector link capacity (ADR 25)
    offtakeCapMW: 0,          // e-fuel refinery H₂ offtake capacity (ADR 26)
    h2OfftakeMW: 0,           // live H₂ sales rate (MW chemical)
    h2SoldMWh: 0,             // lifetime H₂ sold (quest)
    h2SoldMWhToday: 0,        // today's H₂ sales (report card)
    curtailedTodayMWh: 0,
    blackoutHoursToday: 0,    // daily-report counters, owned by sim/reports.js
    flauteHoursToday: 0, stormHoursToday: 0, heatHoursToday: 0,
    // research
    techs: {},                // id -> true when done
    research: null,           // {id, progress(0..1)}
    // multipliers from tech
    mult: {
      solar: 1, wind: 1, batteryCap: 1, elecEff: 0.68, fcEff: 0.58,
      cityDemand: 1, industryDemand: 1, vehicleUse: 1, vehicleSpeed: 1, chargeRate: 1,
      demandResponse: 0, // 0..1: fraction of the city load curve shifted peak → valley
    },
    // history ring buffers for charts (sample every 15 game minutes, 48h window)
    history: [],
    histMax: 192,
    moneyHistory: [],
    // lifetime delivery counters (quests & insights)
    stats: {
      paxLocal: 0, paxInter: 0,
      grainToFood: 0, oreToSteel: 0, foodToCity: 0, steelToCity: 0,
      railUnits: 0,   // passengers + cargo units delivered by train
    },
    // income breakdown for the finance drill-down (reset daily, prev = yesterday).
    // routes: per-route income today; routeCosts: per-route upkeep booked today
    // (dailyUpkeep bills into the NEW day right after rollover — see tick.js).
    // `prev` archives the whole object at rollover, so it holds the LAST
    // completed day's income+cost pair per route (the routes-tab "yesterday" badge).
    finance: {
      today: { bus: 0, truck: 0, train: 0, routes: {}, routeCosts: {} },
      prev: null,
    },
    // ui / interaction
    showDemand: false,        // passenger demand overlay
    tool: null,               // active build tool id
    routeEdit: null,          // route being edited
    routeHover: null,         // route hovered in the routes tab (map highlight)
    selected: null,
    // emitter for advisor triggers
    firedTips: {},
    listeners: {},
  };
}

export const G = initialState();

// Reset G in place (all modules share the same reference). Used by tests.
export function resetState() {
  for (const k of Object.keys(G)) delete G[k];
  Object.assign(G, initialState());
}

export function emit(name, payload) {
  (G.listeners[name] || []).forEach(fn => fn(payload));
}
export function on(name, fn) {
  (G.listeners[name] = G.listeners[name] || []).push(fn);
}

export function hourOfDay() { return (G.minutes / 60) % 24; }

// ---- seasons: 7 game days each, year starts in spring -------------------
// sunrise/sunset are kept symmetric around 12:00 so the sun-elevation curve
// stays continuous across midnight.
export const DAYS_PER_SEASON = 7;
// flauteMul: per-season factor on the BASE Dunkelflaute roll (energy.js
// eventThresholds). Summer ≈ never ("there's always some sun left"), winter is
// the dark-calm season. Shapes when dark calms strike without touching the
// climate-risk multiplier (which stays excluded from the flaute roll by design).
export const SEASONS = [
  { name: 'Spring', icon: '🌸', solarAmp: 1.0, sunrise: 5.5, sunset: 18.5, windMul: 1.0, demandMul: 1.0, flauteMul: 0.5 },
  { name: 'Summer', icon: '☀️', solarAmp: 1.15, sunrise: 4.5, sunset: 19.5, windMul: 0.85, demandMul: 0.95, flauteMul: 0.05 },
  { name: 'Autumn', icon: '🍂', solarAmp: 0.8, sunrise: 6.5, sunset: 17.5, windMul: 1.15, demandMul: 1.05, flauteMul: 1.3 },
  { name: 'Winter', icon: '❄️', solarAmp: 0.55, sunrise: 8, sunset: 16, windMul: 1.25, demandMul: 1.3, flauteMul: 2.2 },
];
export function seasonOf(day) { return SEASONS[Math.floor((day - 1) / DAYS_PER_SEASON) % 4]; }
export function season() { return seasonOf(G.day); }

export function fmtMoney(v) {
  const a = Math.abs(v);
  const s = a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : v.toFixed(0);
  return '€' + s;
}
// spend(cost, cat): charge the player if affordable, booking it as an expense
// under `cat` (data.js LEDGER_CATS). earn(v, cat): credit + book as income.
// `cat` is optional so the money-free primitives (place/buyVehicle) callers
// that don't want a ledger entry can omit it.
export function spend(v, cat) {
  if (G.money < v) return false;
  G.money -= v; G.expensesToday += v;
  book(cat, -v);
  return true;
}
export function earn(v, cat) {
  G.money += v;
  book(cat, v);
  return true;
}
