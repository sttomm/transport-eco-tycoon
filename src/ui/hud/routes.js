// ---------- routes ----------
import { G, fmtMoney } from '../../sim/state.js';
import { AGING, CARGO, VEHICLES, WAGONS } from '../../sim/data.js';
import { createRoute, purchaseVehicle, purchaseWagon, sellVehicle, vehicleSellRefund, routeColor, routeKind, vehicleUpkeep, effectiveBatteryKWh, replaceVehicle, paxCapacity, freightCapacity } from '../../sim/transport.js';
import { $ } from './dom.js';
import { showTipText } from './toasts.js';

// module-level UI state (display only — never saved, game rules live in the sim)
const ROUTE_GROUPS = [['bus', '🚌', 'Bus'], ['rail', '🚆', 'Rail'], ['cargo', '🚚', 'Cargo']];
const KIND_BUTTONS = { bus: ['bus'], rail: ['train'], cargo: ['truck'] }; // routeKind → buyable vehicle kinds
const KIND_ICON = { bus: '🚌', rail: '🚆', cargo: '🚚' };
let routeFilter = 'all';      // 'all' | 'bus' | 'rail' | 'cargo'
let cargoFilter = null;       // cargo id — narrows the cargo group to routes that delivered it
const routeGroupClosed = {};  // routeKind → true when the section is collapsed
const routeCollapsed = {};    // route id → true when its card is collapsed to a header row

export function renderRoutes() {
  const el = $('tab-routes');
  el.innerHTML = `<h3>🚌 Routes</h3>
    <div class="dim small">1. Build stations near industries/cities (toolbar). 2. Create a route, click stations on the map to add stops. 3. Buy vehicles. Trains need Rail Stations linked by track — add wagons to give them capacity.</div>
    <button id="newroute" class="big">+ New Route</button>
    <div id="routefilters" class="chiprow"></div>
    <div id="cargofilters" class="chiprow"></div>
    <div id="routelist"></div>`;
  el.querySelector('#newroute').onclick = () => {
    if (!G.stations.length) { showTipText('No stations yet', 'Place a Freight Depot or Bus Stop next to a road first.'); return; }
    const r = createRoute();
    G.routeEdit = r;
    G.tool = null;
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('on'));
    focusRoute(r); // newest route on top, expanded, everything else collapsed (re-renders)
  };

  // group routes by their derived kind; stop-less routes have no kind yet.
  // Newest first for display — iterate a reversed COPY so G.routes (save
  // order semantics) is never mutated.
  const grouped = { bus: [], rail: [], cargo: [], none: [] };
  for (const r of [...G.routes].reverse()) grouped[routeKind(r) || 'none'].push(r);

  // filter chips: All + one per group
  const fEl = el.querySelector('#routefilters');
  if (G.routes.length) {
    fEl.innerHTML = [['all', 'All', G.routes.length], ...ROUTE_GROUPS.map(([k, icon, name]) => [k, `${icon} ${name}`, grouped[k].length])]
      .map(([k, label, n]) => `<button class="chip${routeFilter === k ? ' on' : ''}" data-f="${k}">${label} <span class="chip-n">${n}</span></button>`).join('');
    fEl.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { routeFilter = b.dataset.f; renderRoutes(); });
  }

  // cargo routes: extra filter row by transported good (goods actually delivered)
  const goods = [...new Set(grouped.cargo.flatMap(r => Object.keys(r.cargoCarried || {})))].filter(c => c !== 'pax');
  if (cargoFilter && !goods.includes(cargoFilter)) cargoFilter = null;
  const cEl = el.querySelector('#cargofilters');
  if ((routeFilter === 'all' || routeFilter === 'cargo') && goods.length) {
    cEl.innerHTML = `<span class="dim small">Goods:</span>` +
      [['', 'any'], ...goods.map(c => [c, CARGO[c].name])]
        .map(([c, label]) => `<button class="chip${(cargoFilter || '') === c ? ' on' : ''}" data-c="${c}">${label}</button>`).join('');
    cEl.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { cargoFilter = b.dataset.c || null; renderRoutes(); });
  }

  const list = el.querySelector('#routelist');
  G.routeHover = null;
  // routes without stops yet are being set up — always visible, above the groups
  for (const r of grouped.none) list.appendChild(routeCard(r));
  for (const [k, icon, name] of ROUTE_GROUPS) {
    if (routeFilter !== 'all' && routeFilter !== k) continue;
    let rs = grouped[k];
    if (k === 'cargo' && cargoFilter) rs = rs.filter(r => (r.cargoCarried || {})[cargoFilter]);
    if (!rs.length) continue;
    const head = document.createElement('div');
    head.className = 'rgroup-head';
    head.innerHTML = `<span class="rgroup-arrow">${routeGroupClosed[k] ? '▸' : '▾'}</span> ${icon} ${name} <span class="dim">(${rs.length})</span>`;
    head.onclick = () => { routeGroupClosed[k] = !routeGroupClosed[k]; renderRoutes(); };
    list.appendChild(head);
    if (!routeGroupClosed[k]) for (const r of rs) list.appendChild(routeCard(r));
  }
  renderRoutesLive();
}

// buy one vehicle of `kind` for a route; translate the sim's refusal codes into
// advisor toasts. Shared by the route card buttons and the station click-through.
function buyVehicleFeedback(r, kind) {
  const v = purchaseVehicle(r, kind); // sim validates & charges
  if (v === 'short') showTipText('Route too short', 'Add at least 2 stops first (click ✎, then click stations on the map).');
  else if (v === 'poor') showTipText('Too expensive', 'Not enough funds.');
  else if (v === 'kind') {
    const rk2 = routeKind(r);
    showTipText('Wrong vehicle type', `${r.name} is a ${rk2} route — its stops only serve ${KIND_BUTTONS[rk2].map(k => VEHICLES[k].name.toLowerCase() + 's').join('/')}.`);
  } else if (v === 'access') {
    showTipText(kind === 'train' ? 'No rail access' : 'No road access',
      kind === 'train' ? 'The first stop has no adjacent rail track — trains need Rail Stations connected by track.' : 'The first stop has no adjacent road.');
  }
  return v;
}

// ---------- click-through from the station infobox ----------
// routes whose stop list includes this station (infobox "routes serving here")
export function routesServingStation(st) {
  return G.routes.filter(r => r.stops.includes(st));
}
// buy the route's derived-kind vehicle (station infobox "+ vehicle"); the tab
// switch is the caller's job (avoids a routes.js → hud.js import cycle)
export function quickBuyVehicle(r) {
  if (!r) return;
  const rk = routeKind(r);
  buyVehicleFeedback(r, rk ? KIND_BUTTONS[rk][0] : 'bus');
  renderRoutes();
}

// Bring a route to the player's attention: switch the filter chip to its kind
// group, make sure that group is expanded, collapse every OTHER route's card
// so this one isn't buried, then scroll it into view. Used both by "+ New
// Route" (new route on top, focused) and the station-infobox click-through
// (hud.js) — a single place owns the state knowledge instead of hud.js
// reaching into routeFilter/routeGroupClosed/routeCollapsed itself.
export function focusRoute(r) {
  if (!r) return;
  const rk = routeKind(r);
  if (rk) { routeFilter = rk; routeGroupClosed[rk] = false; cargoFilter = null; }
  for (const other of G.routes) routeCollapsed[other.id] = other !== r;
  renderRoutes();
  requestAnimationFrame(() => {
    const el = document.querySelector(`.route[data-route="${r.id}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

// stop list drawn as a cycle: A → B → C ↻ A (routes loop back automatically)
function stopChainHTML(r) {
  if (!r.stops.length) return '<i class="dim">click stations on the map…</i>';
  const name = s => s.name || s.def.name;
  const nodes = r.stops.map(s => `<span class="chain-node">${name(s)}</span>`).join('<span class="chain-link">→</span>');
  const loop = r.stops.length >= 2
    ? `<span class="chain-loop" title="routes loop back automatically">↻</span><span class="chain-node origin">${name(r.stops[0])}</span>`
    : '';
  return `<div class="chip-chain">${nodes}${loop}</div>`;
}

// one route card: name, kind chip, profit/live metrics, stops as a chain,
// vehicle-buy buttons (only kinds matching the route's derived kind), fleet
// list. Collapsible (WP-T): a collapsed card is just the header row — a
// route being edited (G.routeEdit) always renders expanded regardless.
function routeCard(r) {
  const d = document.createElement('div');
  const editing = G.routeEdit === r;
  const collapsed = !editing && !!routeCollapsed[r.id];
  d.className = 'route' + (editing ? ' editing' : '') + (collapsed ? ' collapsed' : '');
  d.dataset.route = r.id; // focusRoute() scroll target
  d.style.borderLeft = `4px solid ${routeColor(r)}`;
  d.onmouseenter = () => { G.routeHover = r; };
  d.onmouseleave = () => { if (G.routeHover === r) G.routeHover = null; };
  const rk = routeKind(r);
  const kinds = rk ? KIND_BUTTONS[rk] : ['truck', 'bus', 'train']; // kindless route: all options open
  const nStops = r.stops.length;

  const headHTML = `<div class="route-head">
      <span class="collapse-arrow">${collapsed ? '▸' : '▾'}</span>
      <span class="icon-chip" style="background:${routeColor(r)}22;border-color:${routeColor(r)}">${rk ? KIND_ICON[rk] : '📍'}</span>
      <b>${r.name}</b>
      <span class="dim small">${nStops} stop${nStops === 1 ? '' : 's'}</span>
      ${collapsed ? `<span data-rm="${r.id}"></span>` : ''}
      ${!collapsed ? (editing ? '<button class="pill-btn" data-a="done">✔ Done</button>' : '<button class="pill-btn" data-a="edit">✎</button>') : ''}
      ${!collapsed ? '<button class="pill-btn" data-a="del">🗑</button>' : ''}
    </div>`;

  d.innerHTML = collapsed ? headHTML : `${headHTML}
    ${stopChainHTML(r)}
    <div class="route-metrics" data-rm="${r.id}"></div>
    <div class="route-veh">
      ${kinds.map(k => `<button class="pill-btn" data-a="${k}">+ ${VEHICLES[k].icon} ${fmtMoney(VEHICLES[k].cost)}</button>`).join('')}
    </div>
    ${r.vehicles.length ? `<label class="small dim" style="display:block;margin-top:3px"><input type="checkbox" data-a="auto"${r.autoReplace ? ' checked' : ''}> 🔧 auto-replace aged vehicles (at ${AGING.autoAtDays} days, ${Math.round(AGING.replaceFrac * 100)}% of list price)</label>` : ''}
    <div class="vehlist" data-r="${r.id}"></div>`;

  // header click toggles collapse — but not while editing, and not when the
  // click actually landed on one of the head's own buttons
  d.querySelector('.route-head').onclick = e => {
    if (editing || e.target.closest('button')) return;
    routeCollapsed[r.id] = !collapsed;
    renderRoutes();
  };
  if (collapsed) return d; // nothing else exists in a collapsed card

  d.querySelector('[data-a=del]').onclick = () => {
    [...r.vehicles].forEach(sellVehicle);
    G.routes = G.routes.filter(x => x !== r);
    if (G.routeEdit === r) G.routeEdit = null;
    delete routeCollapsed[r.id];
    renderRoutes();
  };
  const eb = d.querySelector('[data-a=edit]');
  if (eb) eb.onclick = () => { G.routeEdit = r; renderRoutes(); };
  const db = d.querySelector('[data-a=done]');
  if (db) db.onclick = () => { G.routeEdit = null; renderRoutes(); };
  const ab = d.querySelector('[data-a=auto]');
  if (ab) ab.onchange = e => { r.autoReplace = e.target.checked; };
  for (const kind of kinds) {
    d.querySelector(`[data-a=${kind}]`).onclick = () => { buyVehicleFeedback(r, kind); renderRoutes(); };
  }
  // wagon / replace / sell buttons live inside the constantly re-rendered
  // vehlist → delegate clicks
  d.querySelector('.vehlist').onclick = e => {
    const sellIx = e.target.dataset.sell;
    if (sellIx !== undefined) {
      const v = r.vehicles[+sellIx];
      if (!v) return;
      const refund = vehicleSellRefund(v);
      const wagonNote = v.kind === 'train' && v.wagons.length ? ' (including its wagons)' : '';
      if (confirm(`Sell this ${v.def.name}${wagonNote}? Refunds ${fmtMoney(refund)} — 90% of list price.`)) {
        sellVehicle(v);
        renderRoutesLive();
      }
      return;
    }
    const rv = e.target.dataset.rv;
    if (rv !== undefined) {
      const v = r.vehicles[+rv];
      if (v && !replaceVehicle(v)) showTipText('Too expensive', 'Not enough funds to replace this vehicle.');
      renderRoutesLive();
      return;
    }
    const w = e.target.dataset.w;
    if (!w) return;
    const v = r.vehicles[+e.target.dataset.vi];
    if (!v || v.kind !== 'train') return;
    const res = purchaseWagon(v, w);
    if (res === 'full') { showTipText('Train full', `A locomotive pulls at most ${v.def.maxWagons} wagons.`); return; }
    if (res === 'poor') { showTipText('Too expensive', 'Not enough funds.'); return; }
    renderRoutesLive();
  };
  return d;
}
// yesterday's NET balance badge (income − vehicle upkeep for the last
// COMPLETED day, per G.finance.prev — WP-T). Lifetime profit moves to the
// badge's tooltip; routes with no completed day yet (brand new, or an old
// save missing the field) fall back to today's income so far, or "new".
function yesterdayBadgeHTML(r) {
  const profit = (r.earnedTotal || 0) - (r.spentTotal || 0);
  const tip = `title="lifetime earnings − costs: ${fmtMoney(profit)}"`;
  const prev = G.finance.prev;
  const prevRoutes = (prev && prev.routes) || {};
  const prevCosts = (prev && prev.routeCosts) || {};
  const hadYesterday = Object.prototype.hasOwnProperty.call(prevRoutes, r.id) ||
    Object.prototype.hasOwnProperty.call(prevCosts, r.id);
  if (hadYesterday) {
    const net = (prevRoutes[r.id] || 0) - (prevCosts[r.id] || 0);
    return `<span class="stat-badge ${net >= 0 ? 'pos' : 'neg'}" ${tip}>${net >= 0 ? '▲' : '▼'} ${fmtMoney(net)} yesterday</span>`;
  }
  const todaySoFar = (G.finance.today.routes || {})[r.id] || 0;
  if (todaySoFar >= 0.5) return `<span class="stat-badge pos" ${tip}>▲ ${fmtMoney(todaySoFar)} today</span>`;
  return `<span class="stat-badge" ${tip}>new route</span>`;
}

// live per-route economics: yesterday-balance badge, today's income,
// load-factor meter, waiting pax/cargo per stop. Rebuilt every 0.25 s
// (renderRoutesLive).
function routeMetricsHTML(r) {
  const badge = yesterdayBadgeHTML(r);
  const today = (G.finance.today.routes || {})[r.id] || 0;
  let cap = 0, load = 0;
  for (const v of r.vehicles) {
    cap += paxCapacity(v) + freightCapacity(v);
    load += (v.pax || []).reduce((a, g) => a + g.n, 0) + Object.values(v.cargo || {}).reduce((a, b) => a + b, 0);
  }
  const lf = cap > 0 ? Math.min(1, load / cap) : 0;
  const waits = r.stops.map(st => {
    let w = 0;
    if (st.pax) w = (st.pax.local || 0) + Object.values(st.pax.inter || {}).reduce((a, b) => a + b, 0);
    else w = Object.entries(st.cargo || {}).filter(([c]) => c !== 'pax').reduce((a, [, n]) => a + n, 0);
    return { name: st.name || st.def.name, w: Math.round(w) };
  }).filter(x => x.w >= 1);
  const todayTag = `<span class="metric-today" title="income booked to this route today">today ${today >= 0.5 ? '+' + fmtMoney(today) : '—'}</span>`;
  const meter = r.vehicles.length
    ? `<div class="meter" title="average fleet load ${Math.round(lf * 100)}%"><i style="width:${Math.round(lf * 100)}%"></i></div>`
    : '';
  const waitLine = waits.length
    ? `<div class="route-waits small dim" title="travellers / cargo waiting per stop">${waits.map(x => `${x.name}: <b>${x.w}</b>`).join(' · ')}</div>`
    : '';
  return `<div class="metric-row">${badge}${todayTag}</div>${meter}${waitLine}`;
}

export function renderRoutesLive() {
  for (const r of G.routes) {
    const mEl = document.querySelector(`[data-rm="${r.id}"]`);
    if (mEl) {
      const collapsed = G.routeEdit !== r && !!routeCollapsed[r.id];
      mEl.innerHTML = collapsed ? yesterdayBadgeHTML(r) : routeMetricsHTML(r);
    }
    const el = document.querySelector(`.vehlist[data-r="${r.id}"]`);
    if (!el) continue; // collapsed cards have no fleet list in the DOM
    el.innerHTML = r.vehicles.map((v, vi) => {
      const parts = [];
      const groups = (v.pax || []).filter(g => g.n >= 1);
      if (groups.length) parts.push(`👥 ${groups.reduce((a, g) => a + g.n, 0)} (${groups.map(g => g.type === 'local' ? `${g.n} in ${g.from.name}` : `${g.n} → ${g.dest.name}`).join(', ')})`);
      const freight = Object.entries(v.cargo).filter(([, a]) => a > 0).map(([c, a]) => `${CARGO[c].name} ${a.toFixed(0)}`).join(', ');
      if (freight) parts.push(freight);
      const carg = parts.join(' · ') || 'empty';
      // aging (ADR 27): show the age; past grace, upkeep ramps → offer a trade-in
      const aged = (v.ageDays || 0) > AGING.graceDays;
      const ageTag = ` · ${Math.floor(v.ageDays || 0)}d${aged ? ` <span class="warn" title="upkeep ${fmtMoney(vehicleUpkeep(v))}/day">⛭</span>` : ''}`;
      const repBtn = aged ? ` <button data-rv="${vi}" title="Trade in for a factory-fresh vehicle">🔧 Replace ${fmtMoney(v.def.cost * AGING.replaceFrac)}</button>` : '';
      const sellBtn = ` <button data-sell="${vi}" title="Sell — refunds ${fmtMoney(vehicleSellRefund(v))} (90% of list price)">💶 Sell</button>`;
      if (v.kind === 'train') {
        const st = v.state === 'stranded' ? '⚠️ no rail connection!' : v.state === 'loading' ? 'loading' : G.blackout ? '🚫 no traction power!' : '▶';
        const nPax = v.wagons.filter(w => w.type === 'pax').length, nFr = v.wagons.length - nPax;
        const wag = v.wagons.length ? `${nPax ? nPax + '×🧍' : ''} ${nFr ? nFr + '×📦' : ''}`.trim() : '<span class="warn">no wagons!</span>';
        return `<div class="veh small">${v.def.icon} ${st} · ${wag} · ${carg}${ageTag}<br>
          <button data-w="pax" data-vi="${vi}">+ ${WAGONS.pax.icon} Car ${fmtMoney(WAGONS.pax.cost)}</button>
          <button data-w="freight" data-vi="${vi}">+ ${WAGONS.freight.icon} Wagon ${fmtMoney(WAGONS.freight.cost)}</button>${repBtn}${sellBtn}</div>`;
      }
      const st = v.state === 'stranded' ? (v.noRoute ? '⚠️ no road connection!' : '🪫 stranded!') : v.state === 'loading' ? (v.charging ? '⚡charging' : 'loading') : '▶';
      const packKWh = effectiveBatteryKWh(v);
      const wear = packKWh < v.def.batteryKWh - 0.5 ? ` <span class="warn" title="pack worn to ${Math.round(packKWh / v.def.batteryKWh * 100)}% of original">▾</span>` : '';
      return `<div class="veh small">${v.def.icon} ${st} · 🔋${Math.round(v.battery / packKWh * 100)}%${wear} · ${carg}${ageTag}${repBtn}${sellBtn}</div>`;
    }).join('');
  }
}
