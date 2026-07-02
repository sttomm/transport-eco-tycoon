import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, resetState, on, emit, spend, fmtMoney, hourOfDay, seasonOf, DAYS_PER_SEASON } from '../src/sim/state.js';

beforeEach(() => resetState());

test('resetState restores a pristine game state', () => {
  G.money = 0;
  G.cities.push({ name: 'x' });
  resetState();
  assert.equal(G.money, 600000);
  assert.equal(G.cities.length, 0);
  assert.equal(G.speed, 1);
});

test('emitter delivers payloads to subscribers', () => {
  const seen = [];
  on('boom', p => seen.push(p));
  emit('boom', 42);
  emit('other', 1);
  assert.deepEqual(seen, [42]);
});

test('spend deducts money and books the expense, refuses when broke', () => {
  assert.equal(spend(1000), true);
  assert.equal(G.money, 599000);
  assert.equal(G.expensesToday, 1000);
  assert.equal(spend(1e9), false);
  assert.equal(G.money, 599000);
});

test('hourOfDay wraps at midnight', () => {
  G.minutes = 25 * 60;
  assert.equal(hourOfDay(), 1);
});

test('seasons rotate every DAYS_PER_SEASON days and wrap after a year', () => {
  assert.equal(seasonOf(1).name, 'Spring');
  assert.equal(seasonOf(DAYS_PER_SEASON).name, 'Spring');
  assert.equal(seasonOf(DAYS_PER_SEASON + 1).name, 'Summer');
  assert.equal(seasonOf(4 * DAYS_PER_SEASON).name, 'Winter');
  assert.equal(seasonOf(4 * DAYS_PER_SEASON + 1).name, 'Spring'); // new year
});

test('winter has shorter days and higher demand than summer', () => {
  const summer = seasonOf(DAYS_PER_SEASON + 1), winter = seasonOf(3 * DAYS_PER_SEASON + 1);
  assert.ok(winter.sunset - winter.sunrise < summer.sunset - summer.sunrise);
  assert.ok(winter.demandMul > summer.demandMul);
  assert.ok(winter.solarAmp < summer.solarAmp);
});

test('fmtMoney picks sensible units', () => {
  assert.equal(fmtMoney(950), '€950');
  assert.equal(fmtMoney(12500), '€12.5k');
  assert.equal(fmtMoney(2_400_000), '€2.40M');
});
