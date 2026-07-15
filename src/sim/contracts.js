// Special transport contracts (à la Transport Tycoon subsidies, but signed):
// cities & industries post time-limited offers to move a specific cargo from
// A to B. Up to MAX_OFFERS are open at a time; unsigned offers expire and are
// replaced. A signed contract pays a premium on every matching delivery plus
// a completion bonus if the target amount arrives before the deadline.
// Pure logic — the 📜 tab UI lives in src/ui/hud.js.
import { G, emit } from './state.js';
import { CARGO, CONTRACTS } from './data.js';
import { pushNews } from './news.js';
import { book } from './finance.js';

// tuning lives in data.js (CONTRACTS); these re-exports keep the UI/tests that
// name the old constants working, sourced from the single data block.
export const MAX_OFFERS = CONTRACTS.maxOffers;   // open offers to pick from
export const MAX_ACTIVE = CONTRACTS.maxActive;   // signed contracts in parallel
export const OFFER_DAYS = CONTRACTS.offerDays;   // unsigned-offer shelf life (days)
export const PREMIUM = CONTRACTS.premium;        // matching deliveries pay ×PREMIUM

// completed/expired counts are DERIVED from G.contracts.history (the ledger of
// record, ADR 35) — no separate counters to drift out of sync.
export const contractsDone = () => G.contracts.history.filter(h => h.outcome === 'done').length;
export const contractsExpired = () => G.contracts.history.filter(h => h.outcome === 'expired').length;

// close an active contract into the bounded history ring, recording the
// outcome, the day it closed, the premium accumulated and any bonus paid.
function archiveContract(c, outcome, bonus) {
  G.contracts.active = G.contracts.active.filter(x => x !== c);
  const rec = { ...c, outcome, closedDay: G.day, earned: c.earned || 0, bonus };
  G.contracts.history.push(rec);
  while (G.contracts.history.length > CONTRACTS.historyKeep) G.contracts.history.shift();
  return rec;
}

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
      // destinations include neighbours AND far express cities (ADR 35), so
      // long-haul passenger contracts enter the pool.
      const dests = a ? [...(a.neighbors || []), ...(a.express || [])] : [];
      if (!dests.length) continue;
      c.fromCity = a.idx;
      c.toCity = dests[Math.floor(rnd() * dests.length)];
    } else if (cargoId === 'grain' || cargoId === 'ore') {
      const accType = cargoId === 'grain' ? 'food' : 'steel';
      const targets = G.industries.filter(x => x.type === accType);
      if (!targets.length) continue;
      c.toInd = G.industries.indexOf(targets[Math.floor(rnd() * targets.length)]);
    } else {
      if (!G.cities.length) continue; // food/steel need a destination city
      c.toCity = Math.floor(rnd() * G.cities.length);
    }
    // no duplicate relation on the board or in the portfolio
    const same = x => x.cargoId === c.cargoId && x.fromCity === c.fromCity &&
      x.toCity === c.toCity && x.toInd === c.toInd;
    if (G.contracts.offers.some(same) || G.contracts.active.some(same)) continue;
    const size = CONTRACTS.sizes[cargoId];
    c.amount = Math.round(size.base * (1 - CONTRACTS.amountJitter / 2 + rnd() * CONTRACTS.amountJitter));
    c.days = size.days;
    c.mult = CONTRACTS.premium;
    // completion bonus ≈ 4× what the cargo itself would pay — a real prize
    // worth rerouting your network for before the deadline, not a jackpot
    c.bonus = Math.round(c.amount * (CARGO[cargoId].pay || 24) * CONTRACTS.bonusMult / CONTRACTS.bonusRound) * CONTRACTS.bonusRound;
    c.progress = 0;
    c.earned = 0;   // premium accumulated on matching deliveries (ADR 35)
    c.expires = G.minutes + CONTRACTS.offerDays * 1440;
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
      archiveContract(c, 'expired', 0);
      emit('toast', { title: '📜 Contract expired', text: `${contractLabel(c)} — the deadline passed at ${Math.round(c.progress)}/${c.amount} delivered. No penalty, but the bonus is gone.` });
      pushNews({ type: 'contract-expired', icon: '📜', headline: 'Contract expired',
        body: `${contractLabel(c)} — deadline passed at ${Math.round(c.progress)}/${c.amount} delivered. No penalty, but the bonus is gone.`,
        refs: contractDest(c) });
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
      cs.offerTimer = CONTRACTS.spawnHours;
      emit('tip', 'firstContract');
      pushNews({ type: 'contract-offer', icon: '📜', headline: 'New contract offer',
        body: `${contractLabel(o)} — pays ×${o.mult} per delivery plus a €${o.bonus.toLocaleString()} bonus if filled in ${o.days} days. Sign it in the 📜 tab.`,
        refs: contractDest(o) });
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
    const prem = basePay * (c.mult - 1);
    extra += prem;
    c.earned = (c.earned || 0) + prem; // accumulated premium (ADR 35)
    if (c.progress >= c.amount) {
      archiveContract(c, 'done', c.bonus);
      G.money += c.bonus;
      G.incomeTransportToday += c.bonus;
      book('contractBonus', c.bonus);
      const dest = contractDest(c);
      // celebratory floating money at the destination (news fires below too)
      emit('moneyFx', { i: dest.i, j: dest.j, pay: c.bonus });
      emit('toast', { title: '📜 Contract fulfilled!', text: `${contractLabel(c)} — bonus €${c.bonus.toLocaleString()} paid out.` });
      pushNews({ type: 'contract-done', icon: '🎉', headline: 'Contract fulfilled!',
        body: `${contractLabel(c)} — €${c.bonus.toLocaleString()} completion bonus paid out (+€${Math.round(c.earned).toLocaleString()} in delivery premiums).`,
        refs: dest });
      emit('contractDone', c);
      emit('contractsChanged');
    }
  }
  return extra;
}
