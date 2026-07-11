import { G, emit, hourOfDay, season } from './state.js';
import { BUILDINGS, CARBON, CLIMATE, FORECAST, H2OFFTAKE, INTERCONNECT, MARKET } from './data.js';

// Flat electricity tariff per MWh served — the price until the Smart Market
// goes live on day MARKET.liveDay; after that G.price is set dynamically each
// tick in tickGrid (ADR 22).
export const POWER_PRICE = 85;
export const CO2_PER_MWH = 0.4; // tonnes avoided vs fossil mix

// ---- weather ----------------------------------------------------------
// Wind & cloud are mean-reverting random walks; occasionally a multi-day
// "Dunkelflaute" (dark calm), a storm front or a summer heatwave (ADR 24)
// rolls through. Fronts are not
// applied instantly: the hourly roll SCHEDULES them on G.weatherFront with
// 10-14 h lead time (ADR 23) so the forecast can warn the player. The forced
// debug path `G.dunkelflaute = 40` bypasses the front machinery and applies
// on the very next tick (playtest recipes depend on it).
const windTrendTarget = () => 0.42 * season().windMul + 0.25 * Math.sin(G.day * 0.7);

// ---- climate feedback (ADR 24) ------------------------------------------
// Emitted CO₂ loads the weather dice: the more the gas plant has burned, the
// more often EXTREME events roll — capped at 2× so it teaches, not punishes.
export function climateRiskMult() {
  return Math.min(CLIMATE.maxMult, 1 + G.co2EmittedTons / CLIMATE.scaleTons);
}

// Per-hourly-roll probabilities for the three scheduled events. Factored out
// (and exported) so tests can pin the climate feedback on the thresholds
// without fighting Math.random. The base Dunkelflaute is deliberately NOT
// risk-scaled — it is normal weather variability; climate change loads the
// dice for storms and heatwaves. Heatwaves are summer-only heat domes.
export function eventThresholds() {
  const risk = climateRiskMult();
  return {
    flaute: G.day > 3 ? CLIMATE.flauteRisk : 0,
    storm: CLIMATE.stormRisk * risk,
    heatwave: season().name === 'Summer' ? CLIMATE.heatRisk * risk : 0,
  };
}

let weatherTimer = 0;
export function updateWeather(gameHours) {
  weatherTimer += gameHours;
  const drift = (target, v, rate) => v + (target - v) * rate * gameHours + (Math.random() - 0.5) * 0.08 * Math.sqrt(gameHours);

  if (G.dunkelflaute > 0) {
    G.dunkelflaute -= gameHours;
    G.wind = drift(0.06, G.wind, 0.5);
    G.cloud = drift(0.92, G.cloud, 0.5);
  } else if (G.heatwave > 0) {
    // heat dome (ADR 24): stagnant high-pressure air — wind pinned low,
    // skies stay clear (strong solar). The demand side lives in tickGrid.
    G.heatwave -= gameHours;
    G.wind = drift(Math.min(CLIMATE.heatWindCap, windTrendTarget()), G.wind, 0.4);
    G.cloud = drift(0.08, G.cloud, 0.4);
  } else {
    // windier in autumn/winter, calmer in summer (seasonal storm tracks)
    G.wind = drift(windTrendTarget(), G.wind, 0.15);
    G.cloud = drift(0.35, G.cloud, 0.12);
    if (G.weatherFront) {
      // a front is inbound: count the lead time down, apply at zero
      G.weatherFront.inHours -= gameHours;
      if (G.weatherFront.inHours <= 0) {
        const f = G.weatherFront;
        G.weatherFront = null;
        if (f.type === 'dunkelflaute') G.dunkelflaute = f.durationH;
        else if (f.type === 'heatwave') { G.heatwave = f.durationH; emit('tip', 'heatwave'); }
        else { G.wind = 1.0; emit('tip', 'storm'); } // gust → cut-out on arrival
      }
    } else if (weatherTimer > 1) {
      // rare events, evaluated roughly hourly — no new roll while a front is
      // scheduled (branch above) or a flaute/heatwave is active (outer branches).
      // Storm & heatwave thresholds carry the climate-risk multiplier (ADR 24).
      weatherTimer = 0;
      const th = eventThresholds();
      const lead = FORECAST.leadHmin + Math.random() * (FORECAST.leadHmax - FORECAST.leadHmin);
      if (Math.random() < th.flaute) {
        G.weatherFront = {
          type: 'dunkelflaute', inHours: lead,
          durationH: FORECAST.flauteHmin + Math.random() * (FORECAST.flauteHmax - FORECAST.flauteHmin),
        };
        emit('tip', 'dunkelflaute'); // warn at schedule time — charge everything now
      } else if (Math.random() < th.storm) {
        G.weatherFront = { type: 'storm', inHours: lead, durationH: FORECAST.stormH };
      } else if (Math.random() < th.heatwave) {
        G.weatherFront = {
          type: 'heatwave', inHours: lead,
          durationH: CLIMATE.heatHmin + Math.random() * (CLIMATE.heatHmax - CLIMATE.heatHmin),
        };
      }
    }
  }
  G.wind = Math.max(0, Math.min(1, G.wind));
  G.cloud = Math.max(0, Math.min(1, G.cloud));
  buildForecast();
}

// ---- forecast -----------------------------------------------------------
// Rebuilt every updateWeather call; derived, never saved (rebuilds on the
// first tick after load). Deterministic short-term outlook, like real
// numerical weather prediction: the day/season solar curve is known exactly,
// clouds are assumed to persist, wind shows the mean-reversion target, and a
// scheduled front (which IS deterministic once rolled) is passed through.
function buildForecast() {
  const s = season();
  const now = hourOfDay();
  // hours (from now) during which a dunkelflaute darkens the outlook
  let flStart = Infinity, flEnd = -Infinity;
  if (G.dunkelflaute > 0) { flStart = 0; flEnd = G.dunkelflaute; }
  else if (G.weatherFront?.type === 'dunkelflaute') {
    flStart = G.weatherFront.inHours; flEnd = flStart + G.weatherFront.durationH;
  }
  // hours during which a heatwave (active or scheduled) bakes the outlook
  let hwStart = Infinity, hwEnd = -Infinity;
  if (G.heatwave > 0) { hwStart = 0; hwEnd = G.heatwave; }
  else if (G.weatherFront?.type === 'heatwave') {
    hwStart = G.weatherFront.inHours; hwEnd = hwStart + G.weatherFront.durationH;
  }
  const stormAt = G.weatherFront?.type === 'storm' ? G.weatherFront.inHours : NaN;

  const slots = [];
  for (let t = 0; t < FORECAST.horizonH; t += FORECAST.slotH) {
    const flaute = t < flEnd && t + FORECAST.slotH > flStart;
    const heat = t < hwEnd && t + FORECAST.slotH > hwStart;
    const storm = stormAt >= t && stormAt < t + FORECAST.slotH;
    const h = (now + t + FORECAST.slotH / 2) % 24; // slot midpoint, wall-clock
    const night = h < s.sunrise || h > s.sunset;
    const cloud = flaute ? 0.92 : heat ? 0.08 : G.cloud; // cloud-persistence assumption; heat domes are clear
    const sun = night ? 0
      : Math.max(0, Math.sin(Math.PI * (h - s.sunrise) / (s.sunset - s.sunrise))) * s.solarAmp * (1 - cloud * 0.82);
    slots.push({ hour: Math.floor(h), sun, night, flaute, storm, heat });
  }
  G.forecast = {
    slots,                        // 8 × 3 h: { hour, sun (relative factor), night, flaute, storm, heat }
    // where the wind walk is drifting (0..~1) — pinned low under a heat dome
    windTrend: G.heatwave > 0 ? Math.min(CLIMATE.heatWindCap, windTrendTarget()) : windTrendTarget(),
    front: G.weatherFront ? { ...G.weatherFront } : null,
  };
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
// 24 h mean of the load curve below — the demand-response tech compresses
// the curve toward this value (peaks shaved into the valleys, energy-neutral)
const DEMAND_MEAN = 0.822;
export function cityDemandCurve() {
  const h = hourOfDay();
  // morning & evening peaks, night valley — the classic load shape
  let f = 0.62;
  f += 0.5 * Math.exp(-((h - 8) ** 2) / 4.5);
  f += 0.75 * Math.exp(-((h - 19.5) ** 2) / 5);
  // demand response (research): flexible loads move out of the peaks into
  // the valleys — consumption shifts in time, it doesn't disappear
  return f + (DEMAND_MEAN - f) * (G.mult.demandResponse || 0);
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
  // Smart Market timeline (ADR 22) — one-shot tips, deduped by the UI
  if (G.day >= MARKET.announceDay && G.day < MARKET.liveDay) emit('tip', 'marketAnnounce');
  // climate feedback (ADR 24): warn once when emissions push event risk past "elevated"
  if (climateRiskMult() >= CLIMATE.elevatedAt) emit('tip', 'climateRisk');
  // --- supply available from renewables
  const solarMW = capacity('solar') * solarFactor() * m.solar;
  const windMW = capacity('wind') * windFactor() * m.wind;
  const hydroMW = capacity('hydro') * 0.55;

  // --- inflexible demand
  let cityMW = 0;
  // winter heating raises city demand, mild seasons lower it; an active
  // heatwave adds air-conditioning load on top (ADR 24)
  const seasonDemand = season().demandMul * (G.heatwave > 0 ? CLIMATE.heatDemand : 1);
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
  // interconnector conditions (ADR 25): a Dunkelflaute/heatwave is continental
  // — the neighbours are short too, so the link thins out and its price spikes
  const importEvent = G.dunkelflaute > 0 || G.heatwave > 0;
  const importPrice = importEvent ? INTERCONNECT.eventPrice : INTERCONNECT.price;

  let batteryMW = 0, fcMW = 0, elecMW = 0, impMW = 0, gasMW = 0, curtailMW = 0, unservedMW = 0;
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
    // 3) imports over the interconnector (ADR 25) — they clear before your
    // own gas peaker (whose marginal cost passes the import price within days
    // of the carbon ramp). The neighbour bills you their price and their mix
    // CO₂ lands on your emitted ledger; during a region-wide event the link
    // carries only a trickle at near-scarcity prices.
    impMW = Math.min(deficit, G.importCapMW * (importEvent ? INTERCONNECT.eventCapFactor : 1));
    deficit -= impMW;
    if (impMW > 0) {
      const cost = impMW * gameHours * importPrice;
      G.money -= cost;
      G.expensesToday += cost;
      G.importCostToday += cost;
      G.importMWhToday += impMW * gameHours;
      G.co2EmittedTons += impMW * gameHours * INTERCONNECT.co2PerMWh;
      if (impMW > 0.3) emit('tip', 'firstImport');
    }
    // 4) the legacy gas plant is the last dispatchable before blackout (ADR 21).
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
    // 5) blackout
    unservedMW = Math.max(0, deficit);
    if (unservedMW > 0.3) emit('tip', 'firstBlackout');
  }
  G.batteryMWh = Math.min(G.batteryMWh, G.batteryCapMWh);
  G.h2MWh = Math.min(G.h2MWh, G.h2CapMWh);

  // --- H₂ offtake (ADR 26): the e-fuel refinery sells hydrogen above the
  // strategic tank reserve — the Dunkelflaute insurance is never for sale.
  // Chemical sales, not grid dispatch: they never touch the electricity price.
  let offMW = 0;
  if (G.offtakeCapMW > 0 && gameHours > 0) {
    const reserve = G.h2CapMWh * H2OFFTAKE.reserveFrac;
    offMW = Math.min(G.offtakeCapMW, Math.max(0, (G.h2MWh - reserve) / gameHours));
    if (offMW > 0.01) {
      G.h2MWh -= offMW * gameHours;
      const rev = offMW * gameHours * H2OFFTAKE.pricePerMWh;
      G.money += rev;
      G.incomeEnergyToday += rev;
      G.h2SoldMWhToday += offMW * gameHours;
      G.h2SoldMWh += offMW * gameHours;
      // e-fuels displace fossil kerosene/diesel downstream — avoided CO₂
      G.co2SavedTons += offMW * gameHours * H2OFFTAKE.co2PerMWh;
      emit('tip', 'firstOfftake');
    } else offMW = 0;
  }
  G.h2OfftakeMW = offMW;

  const servedMW = inflex - unservedMW;
  G.servedFraction = inflex > 0.01 ? servedMW / inflex : 1;
  G.blackout = G.servedFraction < 0.97;

  // --- Smart Market price (ADR 22): flat tariff until day MARKET.liveDay,
  // then the most expensive running source sets the price each tick
  // (pay-as-clear merit-order pricing), in priority order:
  G.marketLive = G.day >= MARKET.liveDay;
  if (!G.marketLive) {
    G.price = POWER_PRICE;
  } else if (unservedMW > 0) {
    G.price = MARKET.scarcity;                 // scarcity: demand goes unserved
  } else if (gasMW > 0 || impMW > 0) {
    // the most expensive running dispatchable sets the price (pay-as-clear)
    const d = BUILDINGS.gas;
    const gasAsk = gasMW > 0 ? d.fuelPerMWh + d.co2PerMWh * G.carbonPrice + MARKET.gasMarkup : 0;
    const impAsk = impMW > 0 ? importPrice + INTERCONNECT.markup : 0;
    G.price = Math.max(gasAsk, impAsk);
  } else if (curtailMW > 0) {
    G.price = MARKET.surplusPrice;             // glut: clean power is being thrown away
  } else {
    // normal band, interpolated by residual load (demand renewables don't cover)
    const residual = Math.max(0, Math.min(1, (inflex - renewable) / MARKET.peakMW));
    G.price = MARKET.bandLo + (MARKET.bandHi - MARKET.bandLo) * residual;
  }
  if (G.marketLive) {
    emit('tip', 'marketLive');
    // storage discharging into the scarcity price: the arbitrage teaching moment
    if (G.price === MARKET.scarcity && (batteryMW > 0.05 || fcMW > 0.05)) emit('tip', 'scarcitySale');
  }

  // --- money: cities & industries pay for served energy; charging is your own cost (free)
  const billableMW = (cityMW + indMW) * G.servedFraction;
  const revenue = billableMW * gameHours * G.price;
  G.money += revenue;
  G.incomeEnergyToday += revenue;
  // gas-served and imported MWh are not your renewables — they avoid nothing
  G.co2SavedTons += Math.max(0, servedMW - gasMW - impMW) * gameHours * CO2_PER_MWH;

  // expose live values
  G.supply = { solar: solarMW, wind: windMW, hydro: hydroMW, battery: Math.max(0, batteryMW), fuelcell: fcMW, gas: gasMW, import: impMW };
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
    price: G.price,
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
  // import counters roll with the same energy day (they don't touch the
  // fossil-free streak — that quest is about YOUR plant; the CO₂ ledger and
  // climate dice still see imports)
  G.importMWhToday = 0;
  G.importCostToday = 0;
  G.h2SoldMWhToday = 0;
}

export function dailyUpkeep() {
  let cost = 0;
  for (const p of G.plants) cost += p.def.upkeep || 0;
  for (const v of G.vehicles) cost += v.def.upkeep || 0;
  G.money -= cost;
  G.expensesToday += cost;
  return cost;
}
