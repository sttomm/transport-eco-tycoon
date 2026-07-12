// Passenger demand pools: travellers only walk to stops that a staffed route
// can actually serve, buses board typed groups (local / intercity) and get
// paid on delivery. Uses the real generated cities.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/sim/state.js';
import { place } from '../src/sim/grid.js';
import {
  tickIndustries, tickVehicles, tickCities, createRoute, buyVehicle,
  routeServes, transitServices, happinessFactors, stationRoadTile, findPath,
} from '../src/sim/transport.js';
import { CITY } from '../src/sim/data.js';
import { freshWorld, stationSpotNearCity } from './helpers.js';

let solhaven, windburg;

beforeEach(() => {
  freshWorld();
  [solhaven, windburg] = G.cities;
});

function step(n = 1) {
  const dt = 0.1;
  G.speed = 10;
  const gh = dt * 8 * G.speed / 60;
  for (let k = 0; k < n; k++) {
    tickCities(gh);
    tickIndustries(gh);
    tickVehicles(dt, gh);
  }
}

function twoStopsInCity(city) {
  const a = stationSpotNearCity(city, 'busStop');
  const b = stationSpotNearCity(city, 'busStop', a, 6);
  assert.ok(a && b, 'found two stop sites ≥6 tiles apart');
  return [place('busStop', a[0], a[1]), place('busStop', b[0], b[1])];
}

test('cities accumulate local and intercity travel demand', () => {
  G.minutes = 12 * 60; // daytime
  const before = solhaven.paxLocal;
  tickCities(2);
  assert.ok(solhaven.paxLocal > before, 'local pool grows');
  assert.ok(solhaven.paxTo.some(n => n > 0), 'people want to visit other cities');
});

test('travel demand streams only between neighbouring cities', () => {
  G.minutes = 12 * 60;
  tickCities(24); // a full day of demand
  for (const c of G.cities) {
    assert.ok(c.neighbors.length >= 1, `${c.name} has a neighbour`);
    c.paxTo.forEach((n, oi) => {
      if (c.neighbors.includes(oi)) assert.ok(n > 0, `${c.name} → ${G.cities[oi].name} flows`);
      else if (oi !== c.idx) assert.equal(n, 0, `${c.name} → ${G.cities[oi].name} must stay empty`);
    });
    // happiness only asks for links to neighbours
    const links = happinessFactors(c).filter(f => f.label.startsWith('Link to '));
    assert.equal(links.length, c.neighbors.length);
  }
});

test('nobody waits at a stop no staffed route serves', () => {
  const [stopA] = twoStopsInCity(solhaven);
  G.minutes = 12 * 60;
  step(20);
  assert.equal(stopA.pax?.local ?? 0, 0, 'no route, no vehicle → nobody walks over');
});

test('routeServes: local needs a 2nd stop ≥5 tiles away in the same city', () => {
  const [stopA, stopB] = twoStopsInCity(solhaven);
  const r = createRoute();
  r.stops.push(stopA, stopB);
  buyVehicle(r, 'bus');
  tickIndustries(0.1); // assigns paxHome
  const s = routeServes(r, stopA);
  assert.equal(s.local, true);
  assert.equal(s.inter.length, 0, 'route never leaves town');
});

test('a bus line carries local passengers and gets paid', () => {
  const [stopA, stopB] = twoStopsInCity(solhaven);
  const r = createRoute();
  r.stops.push(stopA, stopB);
  const bus = buyVehicle(r, 'bus');
  assert.ok(bus);
  // sanity: the two stops are connected by the city street grid
  const [ai, aj] = stationRoadTile(stopA), [bi, bj] = stationRoadTile(stopB);
  assert.ok(findPath(ai, aj, bi, bj), 'stops connected via streets');

  G.minutes = 12 * 60;
  step(800);

  assert.ok(G.stats.paxLocal > 0, `local passengers delivered (got ${G.stats.paxLocal})`);
  assert.ok(G.finance.today.bus > 0, 'fares booked under buses');
  assert.equal(transitServices(solhaven).local, true);
  const local = happinessFactors(solhaven).find(f => f.label === 'Local transit');
  assert.equal(local.got, CITY.weights.localTransit, 'local transit contributes to happiness');
});

test('happiness factors reward power, food and transit explicitly', () => {
  G.servedFraction = 1;
  solhaven.foodLevel = 1;
  const f = happinessFactors(solhaven);
  assert.equal(f.find(x => x.label === 'Reliable power').got, CITY.weights.power);
  assert.equal(f.find(x => x.label === 'Food supply').got, CITY.weights.food);
  assert.equal(f.find(x => x.label === 'Local transit').got, 0, 'no transit yet');
  assert.ok(f.some(x => x.label.startsWith('Link to ')), 'intercity links listed per city');
});

test('blackouts make citizens miserable', () => {
  G.servedFraction = 0;
  G.blackout = true;
  const before = solhaven.happiness;
  tickCities(5);
  assert.ok(solhaven.happiness < before);
});
