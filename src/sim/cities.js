// City life: passenger demand pools, happiness (explicit factor list shared
// with the city infobox) and population growth.
import { G, hourOfDay } from './state.js';
import { PAX, CITY } from './data.js';
import { stationCatchment, LOCAL_MIN_DIST } from './stations.js';
import { paxCapacity } from './transport.js';

// structural check: which passenger services does this city actually have?
export function transitServices(c) {
  const res = { local: false, inter: new Set() };
  for (const r of G.routes) {
    if (!r.vehicles.some(v => paxCapacity(v) > 0)) continue;
    const mine = [], others = new Set();
    for (const s of r.stops) {
      if (s.stype !== 'bus' && s.stype !== 'train') continue;
      const { cities } = stationCatchment(s);
      if (cities.includes(c)) mine.push(s);
      for (const o of cities) if (o !== c) others.add(o);
    }
    if (mine.length) for (const o of others) res.inter.add(o);
    for (let a = 0; a < mine.length; a++) for (let b = a + 1; b < mine.length; b++)
      if (Math.hypot(mine[a].i - mine[b].i, mine[a].j - mine[b].j) >= LOCAL_MIN_DIST) res.local = true;
  }
  return res;
}

// Happiness is a sum of explicit factors so the player can see what a city
// needs — used by the simulation AND the city infobox.
export function happinessFactors(c) {
  const W = CITY.weights;
  const f = [];
  const power = Math.max(0, (G.servedFraction - 0.5) / 0.5);
  f.push({ label: 'Reliable power', max: W.power, got: Math.round(W.power * power), hint: 'keep the grid stable, avoid blackouts' });
  f.push({ label: 'Food supply', max: W.food, got: Math.round(W.food * Math.min(1, c.foodLevel || 0)), hint: 'deliver Food from the Food Plant to this city (truck or train)' });
  f.push({ label: 'Goods (steel)', max: W.goods, got: Math.round(W.goods * Math.min(1, c.goodsLevel || 0)), hint: 'deliver Green Steel to this city' });
  const svc = transitServices(c);
  f.push({ label: 'Local transit', max: W.localTransit, got: svc.local ? W.localTransit : 0, hint: 'route with 2 stops in this city ≥5 tiles apart + a bus/train' });
  for (const oi of c.neighbors) {
    const o = G.cities[oi];
    f.push({ label: 'Link to ' + o.name, max: W.neighborLink, got: svc.inter.has(o) ? W.neighborLink : 0, hint: 'passenger route connecting this city with ' + o.name });
  }
  const stuck = c.paxLocal + c.paxTo.reduce((a, b) => a + b, 0);
  if (stuck > CITY.overcrowdAt) f.push({ label: 'Overcrowded stops', max: 0, got: CITY.overcrowdPenalty, hint: 'too many people stranded — add buses or stops' });
  return f;
}
export const happinessTarget = c =>
  Math.max(0.05, Math.min(1, CITY.baseHappiness + happinessFactors(c).reduce((a, x) => a + x.got, 0) / 100));

// city food/happiness/growth, once per game-hour
export function tickCities(gameHours) {
  // people travel mostly by day; a trickle at night
  const hod = hourOfDay();
  const tod = hod > 6.5 && hod < 22 ? PAX.dayFactor : PAX.nightFactor;
  for (const c of G.cities) {
    // travel demand: a small share of the population per (daytime) hour wants to go somewhere
    const want = c.pop * PAX.wantFrac * tod * gameHours;
    c.paxLocal = Math.min(c.paxLocal + want * PAX.localShare, Math.min(90, 25 + c.pop * 0.02));
    // intercity demand: people only travel to NEIGHBOURING cities (see
    // buildCityNeighbors in grid.js) — remote trips happen via the towns in
    // between. Within the neighbourhood a gravity model applies: bigger and
    // closer cities attract more travellers, each pair with its own cap.
    // non-neighbour pools stay empty — EXCEPT this city's express destinations
    // (ADR 35). Also drains pools restored from saves made when the pair was
    // (or graph rules were) different.
    const express = c.express || [];
    c.paxTo.forEach((n, oi) => {
      if (n && !c.neighbors.includes(oi) && !express.includes(oi)) c.paxTo[oi] = 0;
    });
    const totalPop = c.neighbors.reduce((a, oi) => a + G.cities[oi].pop, 0) || 1;
    for (const oi of c.neighbors) {
      const o = G.cities[oi];
      const dist = Math.hypot(o.ci - c.ci, o.cj - c.cj);
      const attract = (o.pop / totalPop) * (1.4 - Math.min(0.8, dist / 110));
      const cap = 12 + o.pop * 0.012;
      c.paxTo[oi] = Math.min(c.paxTo[oi] + want * PAX.interShare * attract, cap);
    }
    // express (long-haul) demand: a share of `want` streams to each far
    // express destination, with its own cap. Pay scales with distance, so
    // these are the lucrative trips electric rail is built for.
    if (express.length) {
      const perDest = want * PAX.expressShare / express.length;
      for (const oi of express) c.paxTo[oi] = Math.min(c.paxTo[oi] + perDest, PAX.expressCap);
    }
    // supply levels decay — cities need a steady stream, not one delivery
    c.foodLevel = Math.max(0, (c.foodLevel || 0) - CITY.foodDecay * gameHours);
    c.goodsLevel = Math.max(0, (c.goodsLevel || 0) - CITY.goodsDecay * gameHours);
    c.happiness += (happinessTarget(c) - c.happiness) * CITY.happinessRate * gameHours;
    if (G.blackout) c.happiness = Math.max(0.05, c.happiness - CITY.blackoutHit * gameHours);
    const growth = (c.happiness - CITY.growthPivot) * CITY.growthRate * gameHours;
    c.pop = Math.max(CITY.minPop, c.pop + growth); // keep fractional — flooring here froze growth & nuked declines
  }
}
