// Global game state shared by all modules.
export const G = {
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
  // weather (0..1)
  wind: 0.5,
  cloud: 0.25,
  dunkelflaute: 0,          // remaining hours of low-wind overcast event
  // world
  tiles: null,              // Int/obj grid
  N: 96,
  TILE: 4,
  cities: [],
  industries: [],
  plants: [],               // player energy buildings
  stations: [],
  routes: [],
  vehicles: [],
  // energy live values (MW)
  supply: { solar: 0, wind: 0, hydro: 0, battery: 0, fuelcell: 0 },
  demand: { city: 0, industry: 0, charging: 0, electrolyzer: 0 },
  unservedMW: 0,
  curtailedMW: 0,
  servedFraction: 1,
  blackout: false,
  // storage
  batteryMWh: 0, batteryCapMWh: 0, batteryRateMW: 0,
  h2MWh: 0, h2CapMWh: 0, elecCapMW: 0, fcCapMW: 0,
  curtailedTodayMWh: 0,
  // research
  techs: {},                // id -> true when done
  research: null,           // {id, progress(0..1)}
  // multipliers from tech
  mult: {
    solar: 1, wind: 1, batteryCap: 1, elecEff: 0.68, fcEff: 0.58,
    cityDemand: 1, industryDemand: 1, vehicleUse: 1, vehicleSpeed: 1, chargeRate: 1,
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
  // ui / interaction
  showDemand: false,        // passenger demand overlay
  tool: null,               // active build tool id
  routeEdit: null,          // route being edited
  selected: null,
  // emitter for advisor triggers
  firedTips: {},
  listeners: {},
};

export function emit(name, payload) {
  (G.listeners[name] || []).forEach(fn => fn(payload));
}
export function on(name, fn) {
  (G.listeners[name] = G.listeners[name] || []).push(fn);
}

export function hourOfDay() { return (G.minutes / 60) % 24; }

export function fmtMoney(v) {
  const a = Math.abs(v);
  const s = a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : v.toFixed(0);
  return '€' + s;
}
export function fmtTime() {
  const h = Math.floor(hourOfDay()), m = Math.floor(G.minutes % 60);
  return `Day ${G.day}  ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function spend(v) {
  if (G.money < v) return false;
  G.money -= v; G.expensesToday += v;
  return true;
}
