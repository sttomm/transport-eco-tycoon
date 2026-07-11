// Special transport contracts (à la Transport Tycoon subsidies, but signed):
// cities & industries post time-limited offers to move a specific cargo from
// A to B. Up to MAX_OFFERS are open at a time; unsigned offers expire and are
// replaced. A signed contract pays a premium on every matching delivery plus
// a completion bonus if the target amount arrives before the deadline.
// Pure logic — the 📜 tab UI lives in src/ui/hud.js.
import { G, emit } from './state.js';
import { CARGO } from './data.js';

export const MAX_OFFERS = 3;      // open offers to pick from
export const MAX_ACTIVE = 3;      // signed contracts running in parallel
export const OFFER_DAYS = 1.5;    // how long an unsigned offer stays on the board
export const PREMIUM = 1.5;       // matching deliveries pay ×1.5 while signed
const SPAWN_HOURS = 8;            // a new offer appears at most every 8 game hours

// per-cargo contract sizing: target units and completion window (days)
const SIZES = {
  pax:   { base: 30, days: 2.5 },
  grain: { base: 45, days: 2.5 },
  ore:   { base: 40, days: 3 },
  food:  { base: 35, days: 2.5 },
  steel: { base: 20, days: 3 },
};

// "Food Plant near Solhaven" — industries share names, so anchor to a city
export function industryLabel(ind) {
  let best = null, bd = Infinity;
  for (const c of G.cities) {
    const d = Math.hypot(c.ci - ind.i, c.cj - ind.j);
    if (d < bd) { bd = d; best = c; }
  }
  return `${ind.def.name}${best ? ' near ' + best.name : ''}`;
}

// human-readable relation, shared by the panel and toasts
export function contractLabel(c) {
  const from = c.kind === 'pax' ? G.cities[c.fromCity].name : CARGO[c.cargoId].name;
  const to = c.toCity != null ? G.cities[c.toCity].name : industryLabel(G.industries[c.toInd]);
  return c.kind === 'pax'
    ? `${Math.round(c.amount)} passengers ${from} → ${to}`
    : `${Math.round(c.amount)} ${from} → ${to}`;
}
// map coordinates of the destination (📍 fly-to)
export function contractDest(c) {
  if (c.toCity != null) { const t = G.cities[c.toCity]; return { i: t.ci, j: t.cj, name: t.name }; }
  const ind = G.industries[c.toInd];
  return { i: ind.i, j: ind.j, name: industryLabel(ind) };
}

// one random offer from the relations that actually exist in this world.
// Contracts store only indices → they serialize as plain JSON (save.js).
function makeOffer(rnd = Math.random) {
  const kinds = ['pax', 'grain', 'ore', 'food', 'steel'];
  for (let tries = 0; tries < 12; tries++) {
    const cargoId = kinds[Math.floor(rnd() * kinds.length)];
    const c = { kind: cargoId === 'pax' ? 'pax' : 'cargo', cargoId, fromCity: null, toCity: null, toInd: null };
    if (cargoId === 'pax') {
      const a = G.cities[Math.floor(rnd() * G.cities.length)];
      if (!a || !a.neighbors.length) continue;
      c.fromCity = a.idx;
      c.toCity = a.neighbors[Math.floor(rnd() * a.neighbors.length)];
    } else if (cargoId === 'grain' || cargoId === 'ore') {
      const accType = cargoId === 'grain' ? 'food' : 'steel';
      const targets = G.industries.filter(x => x.type === accType);
      if (!targets.length) continue;
      c.toInd = G.industries.indexOf(targets[Math.floor(rnd() * targets.length)]);
    } else {
      c.toCity = Math.floor(rnd() * G.cities.length);
    }
    // no duplicate relation on the board or in the portfolio
    const same = x => x.cargoId === c.cargoId && x.fromCity === c.fromCity &&
      x.toCity === c.toCity && x.toInd === c.toInd;
    if (G.contracts.offers.some(same) || G.contracts.active.some(same)) continue;
    const size = SIZES[cargoId];
    c.amount = Math.round(size.base * (0.75 + rnd() * 0.5));
    c.days = size.days;
    c.mult = PREMIUM;
    // completion bonus ≈ 2× what the cargo itself would pay — a real prize
    // for rearranging your network before the deadline, not a jackpot
    c.bonus = Math.round(c.amount * (CARGO[cargoId].pay || 24) * 2 / 500) * 500;
    c.progress = 0;
    c.expires = G.minutes + OFFER_DAYS * 1440;
    c.deadline = null;
    c.id = G.contracts.seq++;
    return c;
  }
  return null;
}

// sign an open offer → it becomes an active contract with a hard deadline
export function signContract(offer) {
  const cs = G.contracts;
  if (!cs.offers.includes(offer) || cs.active.length >= MAX_ACTIVE) return false;
  cs.offers = cs.offers.filter(o => o !== offer);
  offer.deadline = G.minutes + offer.days * 1440;
  cs.active.push(offer);
  cs.offerTimer = Math.max(cs.offerTimer, 4); // the freed slot refills after a pause
  emit('contractsChanged');
  return true;
}

// offer rotation + deadline enforcement, called from the main loop
export function tickContracts(gameHours) {
  const cs = G.contracts;
  for (const c of [...cs.active]) {
    if (G.minutes > c.deadline) {
      cs.active = cs.active.filter(x => x !== c);
      cs.failed++;
      emit('toast', { title: '📜 Contract expired', text: `${contractLabel(c)} — the deadline passed at ${Math.round(c.progress)}/${c.amount} delivered. No penalty, but the bonus is gone.` });
      emit('contractsChanged');
    }
  }
  const before = cs.offers.length;
  cs.offers = cs.offers.filter(o => G.minutes < o.expires);
  if (cs.offers.length !== before) emit('contractsChanged');
  cs.offerTimer -= gameHours;
  if (cs.offerTimer <= 0 && cs.offers.length < MAX_OFFERS) {
    const o = makeOffer();
    if (o) {
      cs.offers.push(o);
      cs.offerTimer = SPAWN_HOURS;
      emit('tip', 'firstContract');
      emit('contractsChanged');
    }
  }
}

// called by transport.js after a paid delivery. dest carries what is known
// about where the load ended up (city index and/or accepting industry index).
// Returns the premium (extra pay on top of basePay) earned from signed
// contracts matching this relation; completion bonuses are paid out here.
export function contractDelivery(cargoId, dest, amount, basePay) {
  let extra = 0;
  for (const c of [...G.contracts.active]) {
    if (c.cargoId !== cargoId) continue;
    if (c.kind === 'pax' && (c.fromCity !== dest.fromCity || c.toCity !== dest.toCity)) continue;
    if (c.kind === 'cargo' &&
      !(c.toCity != null && c.toCity === dest.toCity) &&
      !(c.toInd != null && c.toInd === dest.toInd)) continue;
    c.progress += amount;
    extra += basePay * (c.mult - 1);
    if (c.progress >= c.amount) {
      G.contracts.active = G.contracts.active.filter(x => x !== c);
      G.contracts.completed++;
      G.money += c.bonus;
      G.incomeTransportToday += c.bonus;
      emit('toast', { title: '📜 Contract fulfilled!', text: `${contractLabel(c)} — bonus €${c.bonus.toLocaleString()} paid out.` });
      emit('contractDone', c);
      emit('contractsChanged');
    }
  }
  return extra;
}
