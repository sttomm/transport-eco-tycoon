// Smart Market pricing (ADR 22): flat €85/MWh until day 10, then a dynamic
// price set each tick by pay-as-clear merit-order rules, in priority order:
// scarcity €240 → gas marginal + €15 → curtailed surplus €25 → €45..€120
// interpolated by residual load. Revenue bills at G.price once live.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, resetState, on } from '../src/sim/state.js';
import { tickGrid, POWER_PRICE } from '../src/sim/energy.js';
import { BUILDINGS, CARBON, IND_CURTAIL, MARKET, TARIFF } from '../src/sim/data.js';

beforeEach(() => resetState());

const NOON = 12 * 60, MIDNIGHT = 0;
const solarPlant = mw => G.plants.push({ type: 'solar', def: { capMW: mw } });
const gasPlant = () => G.plants.push({ type: 'gas', def: BUILDINGS.gas });
const industry = mw => G.industries.push({ wantsPower: true, def: { powerMW: mw } });
const battery = (mwh, rateMW) => { G.batteryCapMWh = mwh; G.batteryMWh = mwh; G.batteryRateMW = rateMW; };
const carbonAt = day => CARBON.start + CARBON.perDay * (day - 1);

test('flat €85 before liveDay — even during a blackout', () => {
  G.day = MARKET.liveDay - 1;
  G.minutes = MIDNIGHT; G.wind = 0;   // no renewables at all
  industry(10);                       // → fully unserved
  tickGrid(1);
  assert.ok(G.unservedMW > 0, 'precondition: scarcity conditions exist');
  assert.equal(G.marketLive, false);
  assert.equal(G.price, POWER_PRICE);
});

test('marketLive flips exactly at liveDay — derived from G.day, works on loaded saves', () => {
  G.day = MARKET.liveDay - 1; tickGrid(0.01);
  assert.equal(G.marketLive, false);
  G.day = MARKET.liveDay; tickGrid(0.01);
  assert.equal(G.marketLive, true);
  // a restored day-12 save starts with the default marketLive=false and must
  // price dynamically on the very first tick — no persisted state involved
  resetState();
  G.day = 12; G.minutes = MIDNIGHT; G.wind = 0;
  industry(10);
  tickGrid(1);
  assert.equal(G.marketLive, true);
  assert.equal(G.price, MARKET.scarcity);
});

test('scarcity: any unserved demand prices at €240', () => {
  G.day = MARKET.liveDay;
  G.minutes = MIDNIGHT; G.wind = 0;
  industry(10);                       // no storage, no gas → blackout
  tickGrid(1);
  assert.equal(G.price, MARKET.scarcity);
});

test('scarcity beats gas: gas at its cap with unserved remainder still prices at €240', () => {
  G.day = MARKET.liveDay;
  G.minutes = MIDNIGHT; G.wind = 0;
  industry(45);                       // gas cap 30 → 15 MW unserved
  gasPlant();
  tickGrid(1);
  assert.ok(G.supply.gas > 0 && G.unservedMW > 0, 'precondition: gas running AND unserved');
  assert.equal(G.price, MARKET.scarcity);
});

test('gas sets the price: marginal cost + markup (the merit-order lesson)', () => {
  G.day = MARKET.liveDay;
  G.minutes = MIDNIGHT; G.wind = 0;
  industry(10);
  gasPlant();                         // gas covers everything → no scarcity
  tickGrid(1);
  const d = BUILDINGS.gas;
  const expected = d.fuelPerMWh + d.co2PerMWh * carbonAt(MARKET.liveDay) + MARKET.gasMarkup;
  assert.ok(Math.abs(G.price - expected) < 1e-9); // €70 + 0.45×€57 + €15 = €110.65
  assert.equal(G.unservedMW, 0);
});

test('curtailed surplus crashes the price to €25', () => {
  G.day = MARKET.liveDay;
  G.minutes = NOON; G.cloud = 0;
  solarPlant(25);                     // no storage, no demand → pure curtailment
  tickGrid(1);
  assert.ok(G.curtailedMW > 0, 'precondition: curtailing');
  assert.equal(G.price, MARKET.surplusPrice);
});

test('interpolation low end: renewables cover demand, surplus fully stored → bandLo', () => {
  G.day = MARKET.liveDay;
  G.minutes = NOON; G.cloud = 0;
  solarPlant(17);                     // ×1.15 summer amp ≈ 19.6 MW output
  industry(10);
  battery(20, 10); G.batteryMWh = 0;  // ~9.6 MW surplus fully absorbed, zero curtailment
  tickGrid(1);
  assert.equal(G.curtailedMW, 0, 'precondition: no curtailment');
  assert.equal(G.price, MARKET.bandLo); // residual load ≤ 0 clamps to 0 → €45
});

test('interpolation high end: residual load at/above peakMW → bandHi', () => {
  G.day = MARKET.liveDay;
  G.minutes = MIDNIGHT; G.wind = 0;   // zero renewables
  industry(MARKET.peakMW);            // residual = exactly the reference peak
  battery(200, 100);                  // battery covers it all — no gas, no scarcity
  tickGrid(1);
  assert.equal(G.unservedMW, 0);
  assert.equal(G.price, MARKET.bandHi);
  // above the peak it clamps
  resetState();
  G.day = MARKET.liveDay; G.minutes = MIDNIGHT; G.wind = 0;
  industry(MARKET.peakMW + 20);
  battery(300, 150);
  tickGrid(1);
  assert.equal(G.price, MARKET.bandHi);
});

test('interpolation midpoint: half the reference peak → halfway through the band', () => {
  G.day = MARKET.liveDay;
  G.minutes = MIDNIGHT; G.wind = 0;
  industry(MARKET.peakMW / 2);
  battery(200, 100);
  tickGrid(1);
  const expected = MARKET.bandLo + (MARKET.bandHi - MARKET.bandLo) * 0.5;
  assert.ok(Math.abs(G.price - expected) < 1e-9); // €82.5
});

test('revenue bills at G.price once the market is live — minus levy and grid fee', () => {
  G.day = MARKET.liveDay;
  G.minutes = MIDNIGHT; G.wind = 0;
  industry(10);
  gasPlant();
  const before = G.money;
  tickGrid(1);
  const d = BUILDINGS.gas;
  const price = d.fuelPerMWh + d.co2PerMWh * carbonAt(MARKET.liveDay) + MARKET.gasMarkup;
  const gasCost = 10 * (d.fuelPerMWh + d.co2PerMWh * carbonAt(MARKET.liveDay));
  // the windfall levy skims most of the price above levyStart before billing
  const eff = Math.min(price, TARIFF.levyStart) + TARIFF.levyKeep * Math.max(0, price - TARIFF.levyStart);
  assert.ok(Math.abs(G.incomeEnergyToday - 10 * eff) < 1e-6, 'revenue = billable MWh × levy-skimmed price');
  assert.ok(Math.abs(G.money - before - (10 * (eff - TARIFF.gridFeePerMWh) - gasCost)) < 1e-6);
});

test('windfall levy: scarcity billing is skimmed above levyStart', () => {
  G.day = MARKET.liveDay;
  G.minutes = MIDNIGHT; G.wind = 0;
  industry(10);
  battery(20, 5);                        // 5 MW served, 5 MW unserved → scarcity price
  tickGrid(1);
  assert.equal(G.price, MARKET.scarcity);
  const eff = TARIFF.levyStart + TARIFF.levyKeep * (MARKET.scarcity - TARIFF.levyStart);
  assert.ok(Math.abs(G.incomeEnergyToday - 5 * eff) < 1e-6, 'served half bills the skimmed scarcity price');
  assert.ok(G.compCostToday > 0, 'the unserved half is compensated — scarcity is no jackpot');
});

test('industrial demand response: crisis prices pause industry, with hysteresis', () => {
  G.day = MARKET.liveDay;
  G.minutes = MIDNIGHT; G.wind = 0;
  industry(10);                          // unserved → scarcity price 240
  tickGrid(1);
  assert.ok(G.price >= IND_CURTAIL.pauseAt, 'precondition: crisis price');
  assert.equal(G.indCurtailed, true, 'flag raised at crisis price');
  // price falls into the dead band — flag must hold (no flapping)
  G.industries.length = 0;
  solarPlant(0);                         // zero demand, zero supply → price in normal band
  G.minutes = NOON; G.cloud = 0;
  tickGrid(1);
  if (G.price > IND_CURTAIL.resumeAt) assert.equal(G.indCurtailed, true, 'dead band holds the flag');
  // deep price drop clears it
  G.plants.push({ type: 'solar', def: { capMW: 30 } });
  tickGrid(1);
  assert.ok(G.price <= IND_CURTAIL.resumeAt, 'precondition: glut price');
  assert.equal(G.indCurtailed, false, 'flag cleared below resume threshold');
});

test('announcement tip fires on day 8, activation tip on day 10, neither before', () => {
  const fired = [];
  on('tip', id => fired.push(id));    // registered AFTER resetState (see CLAUDE.md)
  G.day = MARKET.announceDay - 1; tickGrid(0.01);
  assert.ok(!fired.includes('marketAnnounce') && !fired.includes('marketLive'));
  G.day = MARKET.announceDay; tickGrid(0.01);
  assert.ok(fired.includes('marketAnnounce'), 'announce fires on day 8');
  assert.ok(!fired.includes('marketLive'));
  G.day = MARKET.liveDay; tickGrid(0.01);
  assert.ok(fired.includes('marketLive'), 'live tip fires on day 10');
});

test('scarcitySale tip: storage discharging into the €240 scarcity price', () => {
  const fired = [];
  on('tip', id => fired.push(id));
  G.day = MARKET.liveDay;
  G.minutes = MIDNIGHT; G.wind = 0;
  industry(20);
  battery(20, 10); G.batteryMWh = 20; // battery discharges 10 MW, 10 MW unserved → scarcity
  tickGrid(1);
  assert.equal(G.price, MARKET.scarcity);
  assert.ok(G.supply.battery > 0, 'precondition: battery selling');
  assert.ok(fired.includes('scarcitySale'));
  // no tip when nothing discharges into the scarcity price
  resetState();
  const fired2 = [];
  on('tip', id => fired2.push(id));
  G.day = MARKET.liveDay; G.minutes = MIDNIGHT; G.wind = 0;
  industry(20);
  tickGrid(1);
  assert.equal(G.price, MARKET.scarcity);
  assert.ok(!fired2.includes('scarcitySale'));
});
