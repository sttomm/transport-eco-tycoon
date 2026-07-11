// Save / load the game to localStorage. The world is procedurally generated
// from a fixed seed, so we only persist the player's changes and the economy —
// on restore everything is rebuilt through the normal place()/buyVehicle()
// paths (which re-emit the events the renderer listens to).
// snapshot()/restore() are pure of browser APIs and unit-tested in Node.
import { G } from './state.js';
import { TECHS } from './data.js';
import { place, canPlace } from './grid.js';
import { createRoute, buyVehicle, addWagon } from './transport.js';

// v2: 192×192 world with 8 cities — v1 saves store tile coords of the old
// 96×96 map and would silently mis-restore, so they are left under their old key.
// v3: energy-transition arc (legacy gas, carbon price, weather fronts, daily
// reports). Same world seed, so v2 saves still restore — they just load
// without a gas plant (it is only placed for new games) and get the new
// fields' defaults.
const KEY = 'transport-eco-tycoon-save-v2';
const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);

export function hasSave() {
  try { return !!storage()?.getItem(KEY); } catch { return false; }
}
let saveDisabled = false;
export function clearSave() {
  saveDisabled = true; // block the pagehide autosave from resurrecting the save
  try { storage()?.removeItem(KEY); } catch { /* ignore */ }
}

// the serializable snapshot of everything the player changed
export function snapshot() {
  const stIx = st => G.stations.indexOf(st);
  return {
    v: 3,
    minutes: G.minutes, day: G.day, money: G.money, co2: G.co2SavedTons,
    loan: G.loan, contracts: G.contracts, // contracts hold only indices → plain JSON
    carbonPrice: G.carbonPrice, co2Emitted: G.co2EmittedTons,
    gasMWhToday: G.gasMWhToday, gasCostToday: G.gasCostToday,
    fossilFreeDays: G.fossilFreeDays, gasDecommissioned: G.gasDecommissioned,
    reports: G.reports,
    wind: G.wind, cloud: G.cloud, dunkelflaute: G.dunkelflaute,
    heatwave: G.heatwave, weatherFront: G.weatherFront,
    batteryMWh: G.batteryMWh, h2MWh: G.h2MWh,
    incomeT: G.incomeTransportToday, incomeE: G.incomeEnergyToday,
    expenses: G.expensesToday, curtailed: G.curtailedTodayMWh,
    blackoutH: G.blackoutHoursToday, flauteH: G.flauteHoursToday, stormH: G.stormHoursToday,
    heatH: G.heatHoursToday,
    techs: G.techs, research: G.research,
    questsDone: G.questsDone || {}, stats: G.stats, firedTips: G.firedTips,
    finance: G.finance,
    roads: G.tiles.filter(t => t.t === 'road' && !t.cityStreet).map(t => [t.i, t.j]),
    rails: G.tiles.filter(t => t.rail).map(t => [t.i, t.j]),
    plants: G.plants.map(p => ({ type: p.type, i: p.i, j: p.j })),
    stations: G.stations.map(s => ({ type: s.type, i: s.i, j: s.j, name: s.name, cargo: s.cargo, pax: s.pax })),
    industries: G.industries.map(d => ({ stock: d.stock, inStock: d.inStock })),
    cities: G.cities.map(c => ({
      pop: c.pop, happiness: c.happiness, paxLocal: c.paxLocal, paxTo: c.paxTo,
      foodLevel: c.foodLevel || 0, goodsLevel: c.goodsLevel || 0,
    })),
    routes: G.routes.map(r => ({
      name: r.name, stops: r.stops.map(stIx), cargoCarried: r.cargoCarried || {},
      vehicles: r.vehicles.map(v => ({
        kind: v.kind, battery: v.battery, cargo: v.cargo,
        stopIndex: v.stopIndex, wagons: v.wagons.map(w => w.type),
      })),
    })),
  };
}

// apply a snapshot onto a freshly generated world; returns true on success
export function restore(d) {
  if (!d || (d.v !== 2 && d.v !== 3)) return false;

  G.minutes = d.minutes; G.day = d.day; G.money = d.money;
  G.co2SavedTons = d.co2 || 0;
  G.loan = d.loan || 0;
  if (d.contracts) G.contracts = d.contracts; // pre-contract saves keep the fresh default
  // v3 energy-transition fields — v2 saves keep the initialState defaults
  if (d.carbonPrice != null) G.carbonPrice = d.carbonPrice;
  G.co2EmittedTons = d.co2Emitted || 0;
  G.gasMWhToday = d.gasMWhToday || 0;
  G.gasCostToday = d.gasCostToday || 0;
  G.fossilFreeDays = d.fossilFreeDays || 0;
  G.gasDecommissioned = !!d.gasDecommissioned;
  if (d.reports) G.reports = d.reports;
  G.weatherFront = d.weatherFront || null;
  G.wind = d.wind; G.cloud = d.cloud; G.dunkelflaute = d.dunkelflaute || 0;
  G.heatwave = d.heatwave || 0; // pre-climate v3 saves: no heatwave active
  G.incomeTransportToday = d.incomeT || 0; G.incomeEnergyToday = d.incomeE || 0;
  G.expensesToday = d.expenses || 0; G.curtailedTodayMWh = d.curtailed || 0;
  G.blackoutHoursToday = d.blackoutH || 0;
  G.flauteHoursToday = d.flauteH || 0; G.stormHoursToday = d.stormH || 0;
  G.heatHoursToday = d.heatH || 0;
  G.questsDone = d.questsDone || {};
  Object.assign(G.stats, d.stats);
  G.firedTips = d.firedTips || {};
  G.research = d.research || null;
  if (d.finance && d.finance.today) G.finance = d.finance;
  for (const id of Object.keys(d.techs || {})) {
    const t = TECHS.find(x => x.id === id);
    if (t && !G.techs[id]) { t.fx(G.mult); G.techs[id] = true; }
  }

  for (const [i, j] of d.roads || []) if (canPlace('road', i, j)) place('road', i, j);
  for (const [i, j] of d.rails || []) if (canPlace('rail', i, j)) place('rail', i, j);
  for (const p of d.plants || []) if (canPlace(p.type, p.i, p.j)) place(p.type, p.i, p.j);

  // stations: keep index alignment with the saved routes' stop lists
  const placed = (d.stations || []).map(s => {
    if (!canPlace(s.type, s.i, s.j)) return null;
    const ref = place(s.type, s.i, s.j);
    ref.name = s.name;
    ref.cargo = s.cargo || {};
    if (s.pax) ref.pax = s.pax;
    return ref;
  });

  (d.industries || []).forEach((s, k) => {
    const ind = G.industries[k];
    if (ind) { ind.stock = s.stock; ind.inStock = s.inStock; }
  });
  (d.cities || []).forEach((s, k) => {
    const c = G.cities[k];
    if (c) Object.assign(c, s);
  });

  for (const rd of d.routes || []) {
    const r = createRoute();
    r.name = rd.name;
    r.stops = rd.stops.map(ix => placed[ix]).filter(Boolean);
    r.cargoCarried = rd.cargoCarried || {}; // pre-routeKind saves: rebuilt on next delivery
    for (const vd of rd.vehicles || []) {
      // skipKindCheck grandfathers vehicles whose kind no longer matches the
      // route's derived kind — validation applies to new purchases only
      const v = buyVehicle(r, vd.kind, { skipKindCheck: true });
      if (!v) continue;
      v.battery = vd.battery;
      v.cargo = vd.cargo || {};
      v.stopIndex = Math.min(vd.stopIndex || 0, Math.max(0, r.stops.length - 1));
      for (const w of vd.wagons || []) addWagon(v, w);
    }
  }

  // storage levels after the plants exist (capacities are set by place())
  G.batteryMWh = Math.min(d.batteryMWh || 0, G.batteryCapMWh);
  G.h2MWh = Math.min(d.h2MWh || 0, G.h2CapMWh);
  return true;
}

export function saveGame() {
  if (saveDisabled) return;
  try { storage()?.setItem(KEY, JSON.stringify(snapshot())); } catch { /* storage full / blocked */ }
}

// returns true when a save was found and restored
export function loadGame() {
  let d;
  try { d = JSON.parse(storage()?.getItem(KEY)); } catch { return false; }
  return restore(d);
}

export function initAutosave() {
  setInterval(saveGame, 10000);          // every 10 real seconds
  addEventListener('pagehide', saveGame); // and when the tab closes
}
