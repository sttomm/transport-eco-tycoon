// Industry production and station loading: producers make goods (paused by
// crisis prices / blackouts), stations collect waiting travellers from their
// home city's demand pool and pull freight from producers in range.
import { G, emit } from './state.js';
import { PAX, FREIGHT } from './data.js';
import { stationCatchment } from './stations.js';
import { routeServes, paxCapacity } from './transport.js';

export function tickIndustries(gameHours) {
  for (const ind of G.industries) {
    const def = ind.def;
    let can = true;
    if (def.accepts && ind.inStock < 0.5) can = false;
    if (G.indCurtailed) can = false; // demand response: paused while prices are at crisis levels
    ind.wantsPower = can;
    ind.running = can && G.servedFraction > 0.5;
    if (!ind.running) continue;
    let rate = def.rate * G.servedFraction;
    // green steel: sips grid hydrogen for a +50% H2-DRI boost
    if (ind.type === 'steel' && G.h2MWh > 1) {
      const h2Use = 0.8 * gameHours;
      if (G.h2MWh > h2Use) { G.h2MWh -= h2Use; rate *= 1.5; }
      emit('tip', 'steelHungry');
    }
    const out = rate * gameHours;
    if (def.accepts) {
      const need = out * (def.perOutput || 1);
      const used = Math.min(need, ind.inStock);
      ind.inStock -= used;
      ind.stock += used / (def.perOutput || 1);
    } else {
      ind.stock += out;
    }
    ind.stock = Math.min(ind.stock, FREIGHT.industryStockCap);
  }
  // bus stops & rail stations collect waiting travellers from their home city's demand pool
  for (const st of G.stations) {
    if (st.stype !== 'bus' && st.stype !== 'train') continue;
    const { cities } = stationCatchment(st);
    if (!cities.length) continue;
    let home = cities[0], bd = Infinity;
    for (const c of cities) {
      const d = Math.hypot(c.ci - st.i, c.cj - st.j);
      if (d < bd) { bd = d; home = c; }
    }
    st.paxHome = home;
    st.pax = st.pax || { local: 0, inter: {} };
    // people only walk to a stop if a route with a passenger vehicle can take them where they want to go
    const served = { local: false, inter: new Set() };
    for (const r of G.routes) {
      if (!r.stops.includes(st) || !r.vehicles.some(v => paxCapacity(v) > 0)) continue;
      const s = routeServes(r, st);
      if (s.local) served.local = true;
      for (const c of s.inter) served.inter.add(c);
    }
    const stopsOfCity = G.stations.filter(s => (s.stype === 'bus' || s.stype === 'train') && s.paxHome === home).length || 1;
    const flow = PAX.stopFlowPerHour * gameHours / stopsOfCity; // travellers walking to each stop per hour
    const waiting = () => st.pax.local + Object.values(st.pax.inter).reduce((a, b) => a + b, 0);
    if (served.local) {
      const take = Math.min(home.paxLocal, flow, Math.max(0, PAX.stopWaitingCap - waiting()));
      home.paxLocal -= take; st.pax.local += take;
    }
    G.cities.forEach((dest, di) => {
      if (dest === home || !served.inter.has(dest)) return;
      const t2 = Math.min(home.paxTo[di], flow * PAX.interFlowFrac, Math.max(0, PAX.stopWaitingCap - waiting()));
      home.paxTo[di] -= t2;
      st.pax.inter[dest.name] = (st.pax.inter[dest.name] || 0) + t2;
    });
    st.cargo.pax = waiting(); // mirror for UI / infobox
  }
  // freight stations & rail stations pull from producers in range
  for (const st of G.stations) {
    if (st.stype !== 'truck' && st.stype !== 'train') continue;
    const { producers } = stationCatchment(st);
    for (const ind of producers) {
      if (ind.stock > 1) {
        const take = Math.min(ind.stock, FREIGHT.stationCap - (st.cargo[ind.def.produces] || 0));
        if (take > 0) {
          st.cargo[ind.def.produces] = (st.cargo[ind.def.produces] || 0) + take;
          ind.stock -= take;
        }
      }
    }
  }
}
