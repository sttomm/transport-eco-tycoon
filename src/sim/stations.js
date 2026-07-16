// Station queries: what a station serves (catchment), what can be sold there,
// and station naming. Shared by the vehicle, industry and city sims.
import { G } from './state.js';
import { STATION_SUFFIX } from './data.js';

export const STATION_RADIUS = 7;
export const LOCAL_MIN_DIST = 5; // min tiles between stops for a "local" trip

// what does a station serve? (industries / cities in radius)
export function stationCatchment(st) {
  const producers = [], acceptors = [], cities = [];
  for (const ind of G.industries) {
    const d = Math.hypot(ind.i - st.i, ind.j - st.j);
    if (d <= STATION_RADIUS) {
      producers.push(ind);
      if (ind.def.accepts) acceptors.push(ind);
    }
  }
  for (const c of G.cities) {
    if (Math.hypot(c.ci - st.i, c.cj - st.j) <= STATION_RADIUS + 4) cities.push(c);
  }
  return { producers, acceptors, cities };
}

// Is this city served by ANY placed station (bus stop, freight depot, or
// train station) — i.e. does it fall in at least one station's catchment?
// Used to scope per-city report/news noise (reports.js) to cities the player
// has actually started serving, rather than every city on the map.
export function isCityServed(c) {
  for (const st of G.stations) {
    if (Math.hypot(c.ci - st.i, c.cj - st.j) <= STATION_RADIUS + 4) return true;
  }
  return false;
}

// All cities currently served by at least one station (see isCityServed).
export function servedCities() {
  return G.cities.filter(isCityServed);
}

// which cargo types can be delivered (sold) at this station?
export function stationAccepts(st) {
  const { acceptors, cities } = stationCatchment(st);
  const set = new Set();
  for (const a of acceptors) set.add(a.def.accepts);
  if (cities.length) { set.add('food'); set.add('steel'); set.add('pax'); }
  return set;
}

// ---------- station naming (nearest industry, else nearest city) ----------
const stationSeq = {};
export function nameStation(st) {
  let best = null, bestD = 1e9;
  for (const ind of G.industries) {
    const d = Math.hypot(ind.i - st.i, ind.j - st.j);
    if (d < bestD && d < 8) { bestD = d; best = ind.def.name; }
  }
  if (!best) {
    for (const c of G.cities) {
      const d = Math.hypot(c.ci - st.i, c.cj - st.j);
      if (d < bestD) { bestD = d; best = c.name; }
    }
  }
  stationSeq[best] = (stationSeq[best] || 0) + 1;
  st.name = `${best} ${STATION_SUFFIX[st.stype]} ${stationSeq[best] > 1 ? stationSeq[best] : ''}`.trim();
}
