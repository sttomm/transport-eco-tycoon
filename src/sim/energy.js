import { G, emit, hourOfDay, season } from './state.js';
import { BUILDINGS, CARBON } from './data.js';

// Electricity price paid by cities & industries per MWh served.
export const POWER_PRICE = 85;
export const CO2_PER_MWH = 0.4; // tonnes avoided vs fossil mix

// ---- weather ----------------------------------------------------------
// Wind & cloud are mean-reverting random walks; occasionally a multi-day
// "Dunkelflaute" (dark calm) or a storm front rolls through.
let weatherTimer = 0;
export function updateWeather(gameHours) {
  weatherTimer += gameHours;
  const drift = (target, v, rate) => v + (target - v) * rate * gameHours + (Math.random() - 0.5) * 0.08 * Math.sqrt(gameHours);

  if (G.dunkelflaute > 0) {
    G.dunkelflaute -= gameHours;
    G.wind = drift(0.06, G.wind, 0.5);
    G.cloud = drift(0.92, G.cloud, 0.5);
  } else {
    // windier in autumn/winter, calmer in summer (seasonal storm tracks)
    G.wind = drift(0.42 * season().windMul + 0.25 * Math.sin(G.day * 0.7), G.wind, 0.15);
    G.cloud = drift(0.35, G.cloud, 0.12);
    // rare events, evaluated roughly hourly
    if (weatherTimer > 1) {
      weatherTimer = 0;
      if (G.day > 3 && Math.random() < 0.006) {
        G.dunkelflaute = 36 + Math.random() * 18;
        emit('tip', 'dunkelflaute');
      } else if (Math.random() < 0.005) {
        G.wind = 1.0; // storm gust → cut-out
        emit('tip', 'storm');
      }
    }
  }
  G.wind = Math.max(0, Math.min(1, G.wind));
  G.cloud = Math.max(0, Math.min(1, G.cloud));
}

// ---- generation curves -------------------------------------------------
export function solarFactor() {
  const s = season();
  const h = hourOfDay();
  if (h < s.sunrise || h > s.sunset) return 0; // no sun, no solar
  const x = Math.sin(Math.PI * (h - s.sunrise) / (s.sunset - s.sunrise));
  return Math.max(0, x) * s.solarAmp * (1 - G.cloud * 0.82);
}
export function windFactor() {
  const w = G.wind;
  if (w < 0.12) return 0;          // below cut-in
  if (w > 0.96) return 0;          // storm cut-out
  const x = Math.min(1, (w - 0.12) / 0.55);
  return Math.min(1, x * x * x * 3.2); // cubic ramp up to rated power, then capped
}

function capacity(type) {
  let mw = 0;
  for (const p of G.plants) if (p.type === type) mw += p.def.capMW;
  return mw;
}

// ---- demand ------------------------------------------------------------
function cityDemandCurve() {
  const h = hourOfDay();
  // morning & evening peaks, night valley — the classic load shape
  let f = 0.62;
  f += 0.5 * Math.exp(-((h - 8) ** 2) / 4.5);
  f += 0.75 * Math.exp(-((h - 19.5) ** 2) / 5);
  return f;
}

// ---- main grid tick ----------------------------------------------------
// gameHours: elapsed game time in hours since last tick.
export function tickGrid(gameHours) {
  const m = G.mult;
  // carbon price ramps €3/day (EU-ETS-style) — derived from the day so it
  // works headless and survives save/load without drift (ADR 21)
  G.carbonPrice = CARBON.start + CARBON.perDay * (G.day - 1);
  if (G.carbonPrice >= 50) emit('tip', 'carbon50');
  if (G.carbonPrice >= 80) emit('tip', 'carbon80');
  // --- supply available from renewables
  const solarMW = capacity('solar') * solarFactor() * m.solar;
  const windMW = capacity('wind') * windFactor() * m.wind;
  const hydroMW = capacity('hydro') * 0.55;

  // --- inflexible demand
  let cityMW = 0;
  // winter heating raises city demand, mild seasons lower it
  const seasonDemand = season().demandMul;
  for (const c of G.cities) cityMW += (c.pop / 1000) * 1.1 * cityDemandCurve() * m.cityDemand * seasonDemand;
  let indMW = 0;
  for (const ind of G.industries) if (ind.wantsPower) indMW += ind.def.powerMW * m.industryDemand;
  let chargeMW = 0;
  for (const v of G.vehicles) {
    if (v.charging) chargeMW += v.def.chargeMW * m.chargeRate;
    // electric trains draw traction power live from the catenary while moving
    else if (v.kind === 'train' && v.state === 'travel') chargeMW += v.def.tractionMW + 0.15 * v.wagons.length;
  }

  const renewable = solarMW + windMW + hydroMW;
  const inflex = cityMW + indMW + chargeMW;

  let batteryMW = 0, fcMW = 0, elecMW = 0, gasMW = 0, curtailMW = 0, unservedMW = 0;
  let surplus = renewable - inflex;

  if (surplus > 0) {
    // 1) charge batteries (92% round trip, applied on charge)
    const room = (G.batteryCapMWh - G.batteryMWh) / gameHours;
    const chg = Math.min(surplus, G.batteryRateMW, Math.max(0, room));
    G.batteryMWh += chg * gameHours * 0.92;
    surplus -= chg;
    batteryMW = -chg;
    // 2) run electrolyzers — flexible demand soaking up the rest
    const h2room = (G.h2CapMWh - G.h2MWh) / gameHours / m.elecEff;
    elecMW = Math.min(surplus, G.elecCapMW, Math.max(0, h2room));
    G.h2MWh += elecMW * gameHours * m.elecEff;
    surplus -= elecMW;
    if (elecMW > 0.05) emit('tip', 'firstElectrolyzerRun');
    // 3) leftover is curtailed
    curtailMW = Math.max(0, surplus);
    if (curtailMW > 0.5) emit('tip', 'firstCurtail');
    G.curtailedTodayMWh += curtailMW * gameHours;
  } else {
    let deficit = -surplus;
    // 1) discharge batteries
    const avail = G.batteryMWh / gameHours;
    batteryMW = Math.min(deficit, G.batteryRateMW, avail);
    G.batteryMWh -= batteryMW * gameHours;
    deficit -= batteryMW;
    // 2) fuel cells burn hydrogen
    const h2avail = (G.h2MWh * m.fcEff) / gameHours;
    fcMW = Math.min(deficit, G.fcCapMW, h2avail);
    G.h2MWh -= (fcMW / m.fcEff) * gameHours;
    deficit -= fcMW;
    // 3) the legacy gas plant is the last dispatchable before blackout (ADR 21).
    // It bills its demand normally but burns fuel + carbon-priced CO₂ — a loss
    // once the carbon price passes ~€33/t.
    gasMW = Math.min(deficit, capacity('gas'));
    deficit -= gasMW;
    if (gasMW > 0) {
      const d = BUILDINGS.gas;
      const cost = gasMW * gameHours * (d.fuelPerMWh + d.co2PerMWh * G.carbonPrice);
      G.money -= cost;
      G.expensesToday += cost;
      G.gasCostToday += cost;
      G.gasMWhToday += gasMW * gameHours;
      G.co2EmittedTons += gasMW * gameHours * d.co2PerMWh;
      if (gasMW > 0.3) emit('tip', 'firstGas');
    }
    // 4) blackout
    unservedMW = Math.max(0, deficit);
    if (unservedMW > 0.3) emit('tip', 'firstBlackout');
  }
  G.batteryMWh = Math.min(G.batteryMWh, G.batteryCapMWh);
  G.h2MWh = Math.min(G.h2MWh, G.h2CapMWh);

  const servedMW = inflex - unservedMW;
  G.servedFraction = inflex > 0.01 ? servedMW / inflex : 1;
  G.blackout = G.servedFraction < 0.97;

  // --- money: cities & industries pay for served energy; charging is your own cost (free)
  const billableMW = (cityMW + indMW) * G.servedFraction;
  const revenue = billableMW * gameHours * POWER_PRICE;
  G.money += revenue;
  G.incomeEnergyToday += revenue;
  // gas-served MWh is fossil generation — it avoids nothing
  G.co2SavedTons += Math.max(0, servedMW - gasMW) * gameHours * CO2_PER_MWH;

  // expose live values
  G.supply = { solar: solarMW, wind: windMW, hydro: hydroMW, battery: Math.max(0, batteryMW), fuelcell: fcMW, gas: gasMW };
  G.demand = { city: cityMW, industry: indMW, charging: chargeMW, electrolyzer: elecMW };
  G.unservedMW = unservedMW;
  G.curtailedMW = curtailMW;
  G.batteryChargeMW = Math.max(0, -batteryMW);
}

// upkeep + history sampling, called every 15 game minutes
let sampleTimer = 0;
export function sampleHistory(gameMinutes) {
  sampleTimer += gameMinutes;
  if (sampleTimer < 15) return;
  sampleTimer = 0;
  G.history.push({
    t: G.minutes, ...G.supply,
    demandTotal: G.demand.city + G.demand.industry + G.demand.charging,
    elec: G.demand.electrolyzer, unserved: G.unservedMW, curtailed: G.curtailedMW,
    batt: G.batteryCapMWh ? G.batteryMWh / G.batteryCapMWh : 0,
    h2: G.h2CapMWh ? G.h2MWh / G.h2CapMWh : 0,
  });
  if (G.history.length > G.histMax) G.history.shift();
  G.moneyHistory.push(G.money);
  if (G.moneyHistory.length > 240) G.moneyHistory.shift();
}

// Day-rollover bookkeeping for the fossil-free-week quest: a full day without
// a single gas MWh extends the streak, any gas use resets it. Called from
// main.js before the other daily counters reset.
export function rollFossilFreeDay() {
  G.fossilFreeDays = G.gasMWhToday === 0 ? G.fossilFreeDays + 1 : 0;
  G.gasMWhToday = 0;
  G.gasCostToday = 0;
}

export function dailyUpkeep() {
  let cost = 0;
  for (const p of G.plants) cost += p.def.upkeep || 0;
  for (const v of G.vehicles) cost += v.def.upkeep || 0;
  G.money -= cost;
  G.expensesToday += cost;
  return cost;
}
