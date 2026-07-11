// The grid dispatch is the heart of the game's teaching mission — these tests
// pin down the merit order documented in docs/ENERGY-MODEL.md:
// surplus:  battery charge → electrolyzer → curtail
// deficit:  battery discharge → fuel cell → blackout
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, resetState } from '../src/sim/state.js';
import { solarFactor, windFactor, tickGrid, dailyUpkeep, rollFossilFreeDay, cityDemandCurve, POWER_PRICE } from '../src/sim/energy.js';
import { AGING, BUILDINGS, CARBON, H2OFFTAKE, INTERCONNECT, MARKET, TARIFF, TECHS, VOLL } from '../src/sim/data.js';

// energy tests run on an empty world: no cities/industries unless we add them
beforeEach(() => resetState());

const NOON = 12 * 60, MIDNIGHT = 0;
const solarPlant = mw => G.plants.push({ type: 'solar', def: { capMW: mw } });
const gasPlant = () => G.plants.push({ type: 'gas', def: BUILDINGS.gas });
const industry = mw => G.industries.push({ wantsPower: true, def: { powerMW: mw } });
// what the player nets per served MWh: price (levy-skimmed above levyStart) minus grid fee
const netPerMWh = (p = POWER_PRICE) =>
  Math.min(p, TARIFF.levyStart) + TARIFF.levyKeep * Math.max(0, p - TARIFF.levyStart) - TARIFF.gridFeePerMWh;

test('solar follows the sun: full at clear spring noon, zero at night', () => {
  G.minutes = NOON; G.cloud = 0;
  assert.ok(Math.abs(solarFactor() - 1.0) < 1e-9); // spring noon, amp 1.0
  G.minutes = MIDNIGHT;
  assert.equal(solarFactor(), 0);
});

test('clouds attenuate solar output', () => {
  G.minutes = NOON; G.cloud = 1;
  assert.ok(Math.abs(solarFactor() - 0.18) < 1e-9); // 1 - 0.82·cloud
});

test('wind power curve: cut-in, rated cap, storm cut-out', () => {
  G.wind = 0.05; assert.equal(windFactor(), 0);      // below cut-in
  G.wind = 0.5; assert.equal(windFactor(), 1);       // rated
  G.wind = 0.2; assert.ok(windFactor() > 0 && windFactor() < 0.2); // cubic ramp
  G.wind = 0.99; assert.equal(windFactor(), 0);      // storm cut-out
});

test('surplus: battery charges first (92% in), rest is curtailed', () => {
  G.minutes = NOON; G.cloud = 0;
  solarPlant(25);
  G.batteryCapMWh = 20; G.batteryRateMW = 10;
  tickGrid(1);
  assert.ok(Math.abs(G.batteryMWh - 9.2) < 1e-6);   // 10 MW × 1 h × 0.92
  assert.ok(Math.abs(G.curtailedMW - 15) < 1e-6);   // 25 − 10 charged
  assert.equal(G.unservedMW, 0);
  assert.equal(G.blackout, false);
});

test('electrolyzer soaks surplus AFTER the battery, before curtailment', () => {
  G.minutes = NOON; G.cloud = 0;
  solarPlant(25);
  G.batteryCapMWh = 20; G.batteryRateMW = 10;
  G.h2CapMWh = 150; G.elecCapMW = 5;
  tickGrid(1);
  assert.ok(Math.abs(G.demand.electrolyzer - 5) < 1e-6);
  assert.ok(Math.abs(G.h2MWh - 5 * G.mult.elecEff) < 1e-6); // 68% efficient
  assert.ok(Math.abs(G.curtailedMW - 10) < 1e-6);           // 25 − 10 − 5
});

test('deficit: battery discharges, then fuel cell burns H₂, no blackout', () => {
  G.minutes = MIDNIGHT; G.wind = 0;                  // no renewables at all
  industry(10);
  G.batteryCapMWh = 20; G.batteryRateMW = 10; G.batteryMWh = 5;
  G.h2CapMWh = 150; G.h2MWh = 10; G.fcCapMW = 5;
  const moneyBefore = G.money;
  tickGrid(1);
  assert.ok(Math.abs(G.batteryMWh) < 1e-6);                       // 5 MWh drained
  assert.ok(Math.abs(G.supply.fuelcell - 5) < 1e-6);              // fc covers the rest
  assert.ok(Math.abs(G.h2MWh - (10 - 5 / G.mult.fcEff)) < 1e-6);  // 58% efficient out
  assert.equal(G.unservedMW, 0);
  assert.equal(G.servedFraction, 1);
  // industry pays for every served MWh — net of the grid operations fee
  assert.ok(Math.abs(G.money - moneyBefore - 10 * netPerMWh()) < 1e-6);
});

test('blackout: unserved demand earns nothing and costs VoLL compensation', () => {
  G.minutes = MIDNIGHT; G.wind = 0;
  industry(10);
  const moneyBefore = G.money;
  tickGrid(1);
  assert.ok(Math.abs(G.unservedMW - 10) < 1e-6);
  assert.equal(G.servedFraction, 0);
  assert.equal(G.blackout, true);
  // nothing served, nothing earned — and every unserved MWh is compensated
  assert.ok(Math.abs(G.money - moneyBefore + 10 * VOLL) < 1e-6);
  assert.ok(Math.abs(G.compCostToday - 10 * VOLL) < 1e-6, 'compensation booked for the report card');
});

test('grid operations fee is booked per served MWh', () => {
  G.minutes = MIDNIGHT; G.wind = 0;
  industry(10);
  G.batteryCapMWh = 40; G.batteryRateMW = 20; G.batteryMWh = 40;
  tickGrid(1);
  assert.ok(Math.abs(G.gridFeeToday - 10 * TARIFF.gridFeePerMWh) < 1e-6);
  assert.ok(Math.abs(G.incomeEnergyToday - 10 * POWER_PRICE) < 1e-6, 'income shows the gross tariff');
});

test('vehicle charging is own consumption — never billed', () => {
  G.minutes = NOON; G.cloud = 0;
  solarPlant(5);
  G.vehicles.push({ charging: true, def: { chargeMW: 0.8 } });
  const moneyBefore = G.money;
  tickGrid(1);
  assert.ok(Math.abs(G.demand.charging - 0.8) < 1e-6);
  assert.ok(Math.abs(G.money - moneyBefore) < 1e-6);
});

test('demand response shaves peaks into valleys, 24h energy unchanged', () => {
  const at = (h, dr) => { G.minutes = h * 60; G.mult.demandResponse = dr; return cityDemandCurve(); };
  assert.ok(at(19.5, 0.25) < at(19.5, 0), 'evening peak shaved');
  assert.ok(at(8, 0.25) < at(8, 0), 'morning peak shaved');
  assert.ok(at(3, 0.25) > at(3, 0), 'night valley filled');
  const integral = dr => {
    let e = 0;
    for (let h = 0; h < 24; h += 0.25) e += at(h, dr);
    return e;
  };
  const shift = Math.abs(integral(0.25) - integral(0)) / integral(0);
  assert.ok(shift < 0.005, `energy-neutral shift, drift ${(shift * 100).toFixed(2)}%`);
});

test('research multipliers scale generation', () => {
  G.minutes = NOON; G.cloud = 0;
  solarPlant(5);
  G.mult.solar = 1.18; // TOPCon
  tickGrid(1);
  assert.ok(Math.abs(G.supply.solar - 5.9) < 1e-6);
});

// ---- legacy gas bridge (ADR 21) -----------------------------------------
// extended merit order: battery → fuel cell → GAS → blackout

test('gas serves only after battery and fuel cell; blackout only past its cap', () => {
  G.minutes = MIDNIGHT; G.wind = 0;                  // no renewables
  industry(45);
  G.batteryCapMWh = 20; G.batteryRateMW = 10; G.batteryMWh = 5;
  G.h2CapMWh = 150; G.h2MWh = 10; G.fcCapMW = 5;
  gasPlant();
  tickGrid(1);
  assert.ok(Math.abs(G.supply.battery - 5) < 1e-6, 'battery discharges first');
  assert.ok(Math.abs(G.supply.fuelcell - 5) < 1e-6, 'fuel cell second');
  assert.ok(Math.abs(G.supply.gas - 30) < 1e-6, 'gas covers the rest up to 30 MW cap');
  assert.ok(Math.abs(G.unservedMW - 5) < 1e-6, 'blackout only beyond the gas cap');
});

test('gas stays off while storage can cover the deficit', () => {
  G.minutes = MIDNIGHT; G.wind = 0;
  industry(8);
  G.batteryCapMWh = 20; G.batteryRateMW = 10; G.batteryMWh = 20;
  gasPlant();
  tickGrid(1);
  assert.equal(G.supply.gas, 0);
  assert.equal(G.gasMWhToday, 0);
  assert.equal(G.co2EmittedTons, 0);
});

test('gas economics: fuel + carbon cost deducted, demand still billed, CO₂ booked as emitted not avoided', () => {
  G.minutes = MIDNIGHT; G.wind = 0; G.day = 1;
  industry(10);
  gasPlant();
  const before = G.money;
  tickGrid(1);
  // 10 MWh × (€70 fuel + 0.45 t × €30/t carbon) = €835 cost, €850 revenue
  const cost = 10 * (70 + 0.45 * 30);
  assert.ok(Math.abs(G.gasCostToday - cost) < 1e-6);
  assert.ok(Math.abs(G.money - before - (10 * netPerMWh() - cost)) < 1e-6);
  assert.ok(Math.abs(G.expensesToday - cost - 10 * TARIFF.gridFeePerMWh) < 1e-6, 'gas cost + grid fee show in expenses');
  assert.ok(Math.abs(G.gasMWhToday - 10) < 1e-6);
  assert.ok(Math.abs(G.co2EmittedTons - 4.5) < 1e-6);          // 10 MWh × 0.45 t
  assert.equal(G.co2SavedTons, 0, 'gas-served MWh avoids nothing');
  assert.equal(G.unservedMW, 0);
  assert.equal(G.blackout, false);
});

test('carbon price ramps €3/day from €30: day 1 → €30, day 11 → €60', () => {
  G.day = 1; tickGrid(0.01);
  assert.equal(G.carbonPrice, 30);
  G.day = 11; tickGrid(0.01);
  assert.equal(G.carbonPrice, 60);
});

test('INVARIANT: gas margin is negative once carbonPrice > €35/t — fossil never wins long-run', () => {
  const d = BUILDINGS.gas;
  const margin = cp => POWER_PRICE - d.fuelPerMWh - d.co2PerMWh * cp;
  assert.ok(margin(35) < 0);
  assert.ok(margin(36) < 0);
  assert.ok(margin(80) < 0);
  // break-even sits below €35/t (≈ €33.3 with the shipped numbers) …
  assert.ok((POWER_PRICE - d.fuelPerMWh) / d.co2PerMWh < 35);
  // … and the ramp passes it within the first days of a game
  assert.ok(CARBON.start + 2 * CARBON.perDay > (POWER_PRICE - d.fuelPerMWh) / d.co2PerMWh);
});

// ---- H₂ offtake (ADR 26) --------------------------------------------------
// the e-fuel refinery sells hydrogen ONLY above the strategic tank reserve

test('H₂ offtake sells above the reserve at the contract price, avoided CO₂ credited', () => {
  G.minutes = MIDNIGHT; G.wind = 0; // grid idle — pure chemical sale
  G.h2CapMWh = 100; G.h2MWh = 60; G.offtakeCapMW = 4;
  const before = G.money;
  tickGrid(1);
  assert.ok(Math.abs(G.h2OfftakeMW - 4) < 1e-6, 'sells at full offtake capacity');
  assert.ok(Math.abs(G.h2MWh - 56) < 1e-6);
  assert.ok(Math.abs(G.money - before - 4 * H2OFFTAKE.pricePerMWh) < 1e-6);
  assert.ok(Math.abs(G.h2SoldMWhToday - 4) < 1e-6);
  assert.ok(Math.abs(G.h2SoldMWh - 4) < 1e-6);
  assert.ok(Math.abs(G.co2SavedTons - 4 * H2OFFTAKE.co2PerMWh) < 1e-6, 'displaced fossil fuel is avoided CO₂');
});

test('H₂ offtake never touches the reserve — the flaute insurance stays', () => {
  G.minutes = MIDNIGHT; G.wind = 0;
  G.h2CapMWh = 100; G.offtakeCapMW = 4;
  // just above the 40-MWh reserve: only the excess sells (rate-limited by it)
  G.h2MWh = 41.5;
  tickGrid(1);
  assert.ok(Math.abs(G.h2OfftakeMW - 1.5) < 1e-6, 'sells only down to the reserve');
  assert.ok(Math.abs(G.h2MWh - 40) < 1e-6);
  // at the reserve: sales pause entirely
  tickGrid(1);
  assert.equal(G.h2OfftakeMW, 0);
  assert.ok(Math.abs(G.h2MWh - 40) < 1e-6);
});

// ---- grid-import interconnector (ADR 25) ---------------------------------
// merit order gains a step: battery → fuel cell → IMPORT → gas → blackout

test('imports fill the deficit after storage and before gas', () => {
  G.minutes = MIDNIGHT; G.wind = 0;
  industry(45);
  G.batteryCapMWh = 20; G.batteryRateMW = 10; G.batteryMWh = 5;
  G.h2CapMWh = 150; G.h2MWh = 10; G.fcCapMW = 5;
  G.importCapMW = 12;
  gasPlant();
  tickGrid(1);
  assert.ok(Math.abs(G.supply.battery - 5) < 1e-6, 'battery first');
  assert.ok(Math.abs(G.supply.fuelcell - 5) < 1e-6, 'fuel cell second');
  assert.ok(Math.abs(G.supply.import - 12) < 1e-6, 'import before gas');
  assert.ok(Math.abs(G.supply.gas - 23) < 1e-6, 'gas covers only the rest');
  assert.equal(G.unservedMW, 0);
  // import bill and CO₂ of the neighbour mix
  assert.ok(Math.abs(G.importMWhToday - 12) < 1e-6);
  assert.ok(Math.abs(G.importCostToday - 12 * INTERCONNECT.price) < 1e-6);
  assert.ok(Math.abs(G.co2EmittedTons - (12 * INTERCONNECT.co2PerMWh + 23 * BUILDINGS.gas.co2PerMWh)) < 1e-6);
});

test('imported MWh bill normally but avoid no CO₂', () => {
  G.minutes = MIDNIGHT; G.wind = 0;
  industry(10);
  G.importCapMW = 12;
  const before = G.money;
  tickGrid(1);
  assert.ok(Math.abs(G.supply.import - 10) < 1e-6);
  assert.equal(G.unservedMW, 0);
  // revenue 10 × net tariff, cost 10 × €95 import → a loss (insurance, not profit)
  assert.ok(Math.abs(G.money - before - (10 * netPerMWh() - 10 * INTERCONNECT.price)) < 1e-6);
  assert.equal(G.co2SavedTons, 0, 'imports avoid nothing');
});

test('a region-wide event throttles the link and spikes its price', () => {
  G.minutes = MIDNIGHT; G.wind = 0; G.dunkelflaute = 10;
  industry(10);
  G.importCapMW = 10;
  tickGrid(1);
  assert.ok(Math.abs(G.supply.import - 10 * INTERCONNECT.eventCapFactor) < 1e-6, 'capacity cut to 30%');
  assert.ok(Math.abs(G.unservedMW - 7) < 1e-6, 'the flaute still bites — imports are no escape');
  assert.ok(Math.abs(G.importCostToday - 3 * INTERCONNECT.eventPrice) < 1e-6, 'near-scarcity import price');
});

test('Smart Market: the most expensive running dispatchable sets the price (import vs gas)', () => {
  // import only, normal weather → price = import cost + markup
  G.day = MARKET.liveDay; G.minutes = MIDNIGHT; G.wind = 0;
  industry(10);
  G.importCapMW = 12;
  tickGrid(1);
  assert.ok(Math.abs(G.price - (INTERCONNECT.price + INTERCONNECT.markup)) < 1e-6);
  // gas also running and more expensive → gas sets the price
  resetState();
  G.day = MARKET.liveDay; G.minutes = MIDNIGHT; G.wind = 0;
  industry(40);
  G.importCapMW = 12;
  gasPlant();
  tickGrid(1);
  const gasAsk = BUILDINGS.gas.fuelPerMWh + BUILDINGS.gas.co2PerMWh * G.carbonPrice + MARKET.gasMarkup;
  assert.ok(gasAsk > INTERCONNECT.price + INTERCONNECT.markup, 'gas ask above import ask by day 10');
  assert.ok(Math.abs(G.price - gasAsk) < 1e-6);
});

test('fossil-free streak: zero-gas days count up, any gas use resets it', () => {
  G.gasMWhToday = 0;
  rollFossilFreeDay();
  rollFossilFreeDay();
  assert.equal(G.fossilFreeDays, 2);
  G.gasMWhToday = 3.2; G.gasCostToday = 280;
  rollFossilFreeDay();
  assert.equal(G.fossilFreeDays, 0, 'streak broken by gas use');
  assert.equal(G.gasMWhToday, 0, 'daily gas counters reset');
  assert.equal(G.gasCostToday, 0);
  rollFossilFreeDay();
  assert.equal(G.fossilFreeDays, 1, 'streak restarts');
  // imports roll with the same day but never touch the streak (ADR 25)
  G.importMWhToday = 8; G.importCostToday = 760;
  rollFossilFreeDay();
  assert.equal(G.fossilFreeDays, 2, 'imports do not break the fossil-free streak');
  assert.equal(G.importMWhToday, 0, 'daily import counters reset');
  assert.equal(G.importCostToday, 0);
  // H₂ sales roll daily too (lifetime counter untouched)
  G.h2SoldMWhToday = 12; G.h2SoldMWh = 40;
  rollFossilFreeDay();
  assert.equal(G.h2SoldMWhToday, 0);
  assert.equal(G.h2SoldMWh, 40);
});

test('dailyUpkeep bills plants and vehicles — aged vehicles at their ramped rate', () => {
  G.plants.push({ def: { upkeep: 120 } });
  G.vehicles.push({ def: { upkeep: 45 } });
  const before = G.money;
  const cost = dailyUpkeep();
  assert.equal(cost, 165);
  assert.equal(G.money, before - 165);
  assert.equal(G.expensesToday, 165);
  // an aged vehicle costs more (ADR 27): 15 days past grace → 45 × 2.5
  G.vehicles[0].ageDays = AGING.graceDays + 15;
  assert.equal(dailyUpkeep(), 120 + 45 * 2.5);
});

// ---- research retrofits (data contract for hud.js tickResearch) -----------
test('LFP research retrofits already-built batteries via its apply hook', () => {
  const lfp = TECHS.find(t => t.id === 'lfp');
  G.batteryCapMWh = 40;
  lfp.fx(G.mult);
  lfp.apply(G);
  assert.ok(Math.abs(G.batteryCapMWh - 54) < 1e-6, 'existing capacity scaled by +35%');
  assert.ok(Math.abs(G.mult.batteryCap - 1.35) < 1e-6, 'future placements scaled too');
});
