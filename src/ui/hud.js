// DOM HUD: topbar, toolbar, side-panel tabs (dashboard charts, research,
// routes, encyclopedia), advisor toasts, selection infobox, welcome screen.
// Reads sim state each tick; never contains game rules.
import { G, on, emit, fmtMoney, fmtTime, season, seasonOf, DAYS_PER_SEASON } from '../sim/state.js';
import { AGING, BUILDINGS, CARBON, CLIMATE, H2OFFTAKE, INTERCONNECT, MARKET, VEHICLES, WAGONS, TECHS, TIPS, LEARN, CARGO } from '../sim/data.js';
import { decommissionGas, isUnlocked, unlockHint } from '../sim/grid.js';
import { createRoute, purchaseVehicle, purchaseWagon, sellVehicle, routeColor, routeKind, vehicleUpkeep, effectiveBatteryKWh, replaceVehicle } from '../sim/transport.js';
import { happinessFactors } from '../sim/cities.js';
import { signContract, contractLabel, contractDest, MAX_ACTIVE, MAX_OFFERS } from '../sim/contracts.js';
import { takeLoan, repayLoan, LOAN_STEP, LOAN_MAX, LOAN_RATE } from '../sim/loans.js';
import {
  solarFactor, climateRiskMult, POWER_PRICE,
  gasMarginalCost, importEventActive, importCapNow, importPriceNow, h2Reserve, h2Sellable,
} from '../sim/energy.js';
import { clearSave } from '../sim/save.js';
import { startTutorial, skipTutorial, notifyTutorial } from '../sim/tutorial.js';
import { startResearch } from '../sim/research.js';

const $ = id => document.getElementById(id);
let activeTab = null;

export function initUI() {
  buildToolbar();
  buildTabs();
  on('tip', showTip);
  on('toast', t => showTipText(t.title, t.text));
  on('plantBuilt', p => {
    const map = { solar: 'firstSolar', wind: 'firstWind', battery: 'firstBattery', electrolyzer: 'firstElectrolyzer', fuelcell: 'firstFuelcell' };
    if (map[p.type]) showTip(map[p.type]);
  });
  on('stationBuilt', st => {
    if (st.stype === 'bus') showTip('firstBusStop');
    if (st.stype === 'train') showTip('firstTrainStation');
  });
  on('railBuilt', () => showTip('firstRail'));
  on('vehicleBought', v => { if (v.kind === 'train') showTip('firstTrain'); });
  on('contractsChanged', () => { if (activeTab === 'contracts') renderContracts(); });
  on('researchDone', () => { if (activeTab === 'research') renderResearch(); });
  on('dayReport', showDayReport);
  initLoanBox();
  initTopbarTooltips();
  // delegated: the infobox re-renders every 0.25 s, so a handler on the button
  // itself could vanish between mousedown and click (same trick as the vehlist)
  $('infobox').addEventListener('click', e => {
    if (e.target.id !== 'decomgas') return;
    if (decommissionGas()) G.selected = null; // tip fires from the sim
  });

  $('speeds').addEventListener('click', e => {
    const s = e.target.dataset.s;
    if (s !== undefined) setSpeed(+s);
  });
  $('demandbtn').onclick = toggleDemand;
  document.addEventListener('keydown', e => {
    if ($('welcome')) return; // game is paused behind the welcome screen
    if (e.key === ' ') { setSpeed(G.speed === 0 ? (G._lastSpeed || 1) : 0); e.preventDefault(); }
    if (e.key === '1') setSpeed(1);
    if (e.key === '2') setSpeed(3);
    if (e.key === '3') setSpeed(10);
    if (e.key === 'v' || e.key === 'V') toggleDemand();
    if (e.key === 'Escape') {
      selectTool(null);
      G.selected = null;
      if (G.showDemand) toggleDemand(); // also dismisses the demand arrows
    }
  });
}

function toggleDemand() {
  G.showDemand = !G.showDemand;
  $('demandbtn').classList.toggle('on', G.showDemand);
}

function setSpeed(s) {
  if (s !== 0) G._lastSpeed = s;
  G.speed = s;
  document.querySelectorAll('#speeds button').forEach(b => b.classList.toggle('on', +b.dataset.s === s));
}

// ---------- toolbar ----------
function buildToolbar() {
  const bar = $('toolbar');
  const cats = { transport: 'Transport', energy: 'Generation', storage: 'Storage' };
  for (const [cat, label] of Object.entries(cats)) {
    const grp = document.createElement('div');
    grp.className = 'toolgroup';
    grp.innerHTML = `<div class="toolgroup-label">${label}</div>`;
    const row = document.createElement('div');
    row.className = 'toolrow';
    for (const [id, def] of Object.entries(BUILDINGS)) {
      if (def.category !== cat) continue;
      if (def.legacy) continue; // inherited-only (gas): players can't build fossil
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.tool = id;
      b.innerHTML = `<span class="ticon">${def.icon}</span><span class="tname">${def.name}</span><span class="tcost">${def.cost ? fmtMoney(def.cost) : ''}</span>`;
      b.onclick = () => {
        if (!isUnlocked(id)) { showTipText(`🔒 ${def.name} — not available yet`, unlockHint(id)); return; }
        selectTool(G.tool === id ? null : id);
      };
      b.onmouseenter = e => showTooltip(e, `<b>${def.name}</b> ${def.cost ? '— ' + fmtMoney(def.cost) : ''}${def.upkeep ? ` (+${def.upkeep}/day)` : ''}<br>${def.desc}` +
        (isUnlocked(id) ? '' : `<br><span class="warn">🔒 ${unlockHint(id)}</span>`));
      b.onmouseleave = hideTooltip;
      row.appendChild(b);
    }
    grp.appendChild(row);
    bar.appendChild(grp);
  }
  updateToolbarLocks();
}

// ---------- build-palette unlocks (ADR 28) ----------
// lock state is derived each UI tick; a lock→unlock transition during play
// gets a one-shot celebration toast (module state — a loaded save that is
// already past a milestone starts unlocked without fanfare)
const lockedTools = new Set();
function updateToolbarLocks() {
  for (const btn of document.querySelectorAll('.tool')) {
    const id = btn.dataset.tool;
    const locked = !isUnlocked(id);
    btn.classList.toggle('locked', locked);
    if (locked) lockedTools.add(id);
    else if (lockedTools.has(id)) {
      lockedTools.delete(id);
      showTipText(`🔓 Unlocked: ${BUILDINGS[id].icon} ${BUILDINGS[id].name}`, BUILDINGS[id].desc);
    }
  }
}

export function selectTool(id) {
  G.tool = id;
  G.routeEdit = null;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
  $('toolhint').textContent = id
    ? (BUILDINGS[id].drag ? `Click & drag to build ${BUILDINGS[id].name.toLowerCase()}. ESC to cancel.` : `Click the map to place ${BUILDINGS[id].name}. ESC to cancel.`)
    : '';
}

// ---------- tooltip ----------
function showTooltip(e, html) {
  const t = $('tooltip');
  t.innerHTML = html;
  t.style.display = 'block';
  const r = e.currentTarget.getBoundingClientRect();
  t.style.left = Math.min(window.innerWidth - 320, r.left) + 'px';
  // flip below for elements near the top of the screen (topbar)
  if (r.top < window.innerHeight / 2) { t.style.top = (r.bottom + 8) + 'px'; t.style.bottom = 'auto'; }
  else { t.style.bottom = (window.innerHeight - r.top + 8) + 'px'; t.style.top = 'auto'; }
}
function hideTooltip() { $('tooltip').style.display = 'none'; }
// tooltip whose content is computed live on hover
function liveTip(el, fn) {
  if (!el) return;
  el.onmouseenter = e => showTooltip(e, fn());
  el.onmouseleave = hideTooltip;
}

// ---------- topbar explainer tooltips ----------
function initTopbarTooltips() {
  liveTip($('money'), () => `<b>💰 Company funds</b><br>Cash for building, vehicles and research. You earn from transport deliveries and from selling every served MWh of electricity (currently €${G.price.toFixed(0)}/MWh).`);
  liveTip($('pricestat'), () => G.marketLive
    ? `<b>💶 Smart Market price: €${G.price.toFixed(0)}/MWh</b><br>
      Set every moment by the most expensive running source (pay-as-clear merit order):<br>
      <span class="bad">€${MARKET.scarcity}</span> scarcity (demand unserved) ·
      <span class="warn">gas cost + €${MARKET.gasMarkup}</span> while the gas plant runs ·
      <span class="good">€${MARKET.surplusPrice}</span> while clean surplus is curtailed ·
      otherwise €${MARKET.bandLo}–€${MARKET.bandHi} rising with residual load (demand minus renewables).<br>
      <span class="dim">Sell storage into expensive hours, charge in cheap ones — flexibility is the business model.</span>`
    : `<b>💶 Power price: flat €${POWER_PRICE}/MWh</b><br>${G.day >= MARKET.announceDay
      ? `The regulator switches on the <b>Smart Market</b> on day ${MARKET.liveDay} — the price will then follow supply and demand (€${MARKET.surplusPrice} in a glut, up to €${MARKET.scarcity} in scarcity). Charge your storage!`
      : `Every served MWh is billed at a flat tariff — for now. Word is the regulator is planning a market reform…`}`);
  liveTip($('clock'), () => {
    const s = season();
    const into = ((G.day - 1) % DAYS_PER_SEASON) + 1;
    return `<b>📅 Game time</b><br>1 game day ≈ 3 real minutes at 1× speed.<br><br>Current season: <b>${s.icon} ${s.name}</b> (day ${into}/${DAYS_PER_SEASON}) — seasons change day length, solar yield, wind and heating demand.`;
  });
  liveTip($('season'), () => {
    const s = season();
    return `<b>${s.icon} ${s.name}</b> — seasons last ${DAYS_PER_SEASON} days and change the energy system:<br>
      ☀️ Solar peak: <b>${Math.round(s.solarAmp * 100)}%</b> · daylight ${(s.sunset - s.sunrise).toFixed(1)} h (${fmtH(s.sunrise)}–${fmtH(s.sunset)})<br>
      🌬 Wind level: <b>${Math.round(s.windMul * 100)}%</b><br>
      🏠 City demand: <b>${Math.round(s.demandMul * 100)}%</b> (winter heating!)<br>
      <span class="dim">Winter is the test: short days, little sun, high demand — plan storage ahead.</span>`;
  });
  liveTip($('gridstat'), () => {
    const sup = G.supply, dem = G.demand;
    return `<b>⚡ Grid: supply / demand (MW)</b><br>
      Generation right now — Solar ${sup.solar.toFixed(1)}, Wind ${sup.wind.toFixed(1)}, Hydro ${sup.hydro.toFixed(1)}, Battery ${sup.battery.toFixed(1)}, Fuel cell ${sup.fuelcell.toFixed(1)}${G.gasDecommissioned ? '' : `, Gas ${(sup.gas || 0).toFixed(1)}`}${G.importCapMW > 0 ? `, Import ${(sup.import || 0).toFixed(1)}` : ''}.<br>
      Demand — Cities ${dem.city.toFixed(1)}, Industry ${dem.industry.toFixed(1)}, Vehicle charging ${dem.charging.toFixed(1)}.<br>
      <span class="dim">Green = stable · yellow = curtailing surplus · red = blackout.</span>`;
  });
  liveTip($('storemini'), () => `<b>Energy storage</b><br>
    🔋 Battery: ${G.batteryMWh.toFixed(1)} / ${G.batteryCapMWh.toFixed(0)} MWh — charges on surplus, covers the evening peak (~92% round trip).<br>
    🫧 Hydrogen: ${G.h2MWh.toFixed(0)} / ${G.h2CapMWh.toFixed(0)} MWh — made by electrolyzers from surplus, burned in fuel cells during dark calm spells.`);
  liveTip($('solarstat'), () => {
    const s = season();
    return `<b>☀️ Solar output now: ${(solarFactor() * 100).toFixed(0)}%</b> of installed panel capacity.<br>
      Follows the sun (0% at night!), drops with cloud cover (currently ${(G.cloud * 100).toFixed(0)}%), and varies by season — ${s.name.toLowerCase()} peaks at ${Math.round(s.solarAmp * 100)}% with daylight ${fmtH(s.sunrise)}–${fmtH(s.sunset)}.`;
  });
  liveTip($('windstat'), () => `<b>🌬 Wind speed: ${(G.wind * 90).toFixed(0)} km/h</b><br>
    Turbines need ~11 km/h to start, reach full power around 43 km/h and shut down above ~90 km/h (storm protection). Output grows with the cube of wind speed.`);
  liveTip($('pop'), () => `<b>👥 Region population</b><br>Sum of all cities. Happy cities (power, food, transit) grow — and more people mean more passengers and more electricity demand.`);
  liveTip($('co2'), () => `<b>🌍 CO₂ avoided</b><br>Every renewable MWh you serve replaces fossil generation (~0.4 t CO₂ per MWh). This counter is your climate scoreboard.`);
}
const fmtH = h => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

// ---------- advisor toasts ----------
function showTip(id) {
  if (G.firedTips[id] || !TIPS[id]) return;
  G.firedTips[id] = true;
  const tip = TIPS[id];
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="toast-head">💡 ${tip.title}<span class="toast-x">✕</span></div><div class="toast-body">${tip.text}</div>`;
  el.querySelector('.toast-x').onclick = () => el.remove();
  $('advisor').appendChild(el);
  setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 1200); }, 26000);
}

export function showTipText(title, text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="toast-head">💡 ${title}<span class="toast-x">✕</span></div><div class="toast-body">${text}</div>`;
  el.querySelector('.toast-x').onclick = () => el.remove();
  $('advisor').appendChild(el);
  setTimeout(() => el.remove(), 9000);
}

// ---------- daily report card ----------
// One advisor sentence per report, picked by priority (see docs/PLAN F7):
// blackout > gas losses > weather recap > curtailment > all green.
function reportAdvice(r) {
  if (r.blackoutHours > 0.05)
    return `⚠ ${r.blackoutHours.toFixed(1)} h of blackout${(r.compCost || 0) > 500 ? ` — ${fmtMoney(r.compCost)} paid in compensation` : ''} — add generation or storage before the evening peak.`;
  if (r.gasCost > 1000)
    return `🏭 The gas plant burned ${fmtMoney(r.gasCost)} in fuel and carbon costs — every renewable MWh you add shrinks that bill.`;
  if (r.flauteHours > 0.05 || r.stormHours > 0.05 || (r.heatHours || 0) > 0.05)
    return r.flauteHours > 0.05
      ? `🌫 A Dunkelflaute covered ${r.flauteHours.toFixed(0)} h of the day — hydrogen reserves are what carry you through these.`
      : (r.heatHours || 0) > 0.05
      ? `🔥 A heatwave baked ${r.heatHours.toFixed(0)} h of the day: ACs pushed city demand +${Math.round((CLIMATE.heatDemand - 1) * 100)}% while turbines idled — noon solar into batteries carries the hot evening.`
      : `🌪 Storm gusts forced turbine cut-outs for ${r.stormHours.toFixed(1)} h — batteries bridge those gaps.`;
  if (r.curtailedMWh > 20)
    return `♻ ${r.curtailedMWh.toFixed(0)} MWh of clean power was curtailed — batteries or electrolyzers could turn that surplus into money.`;
  return '🌱 All green — the grid ran stable and clean. Keep it up!';
}

const reportRow = (n, v, cls = '') =>
  `<div class="reportrow"><span>${n}</span><span class="${cls}">${v}</span></div>`;

function reportRows(r) {
  const co2 = (r.co2Emitted > 0.05 ? `<span class="bad">+${r.co2Emitted.toFixed(1)} t emitted</span> · ` : '') +
    `<span class="good">${r.co2Saved.toFixed(1)} t avoided</span>`;
  const grid = r.blackoutHours > 0.05
    ? `<span class="bad">${r.blackoutHours.toFixed(1)} h blackout</span>`
    : r.curtailedMWh > 0.5 ? `<span class="warn">${r.curtailedMWh.toFixed(0)} MWh curtailed</span>` : '<span class="good">stable</span>';
  return reportRow('Income', fmtMoney(r.incomeEnergy + r.incomeTransport), 'good') +
    reportRow('Expenses', '−' + fmtMoney(r.expenses), 'bad') +
    reportRow('<b>Net</b>', `<b>${fmtMoney(r.net)}</b>`, r.net >= 0 ? 'good' : 'bad') +
    reportRow('CO₂', co2) +
    reportRow('Grid', grid);
}

// end-of-day toast: dismissible, auto-fades after ~8 s, never pauses the game
function showDayReport(r) {
  const el = document.createElement('div');
  el.className = 'toast report-toast';
  el.innerHTML = `<div class="toast-head">📋 Day ${r.day} report<span class="toast-x">✕</span></div>
    <div class="toast-body">${reportRows(r)}
      <div class="report-advice small">${reportAdvice(r)}</div></div>`;
  el.querySelector('.toast-x').onclick = () => el.remove();
  $('advisor').appendChild(el);
  setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 1200); }, 8000);
  renderYesterday(); // keep the dashboard block in sync
}

// "Yesterday" block at the top of the dashboard tab (hidden until day 2)
function renderYesterday() {
  const el = $('yesterday');
  if (!el) return;
  const r = G.reports[G.reports.length - 1];
  if (!r) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const perKind = [['🚌', r.incomeBus], ['🚚', r.incomeTruck], ['🚆', r.incomeTrain]]
    .map(([ic, v]) => `${ic} ${fmtMoney(v)}`).join(' · ');
  el.innerHTML = `<h3>📋 Yesterday <span class="dim small">(day ${r.day})</span></h3>
    ${reportRows(r)}
    ${reportRow('<span class="dim">— transport by kind</span>', `<span class="dim small">${perKind}</span>`)}
    ${reportRow('<span class="dim">— fixed costs</span>', `<span class="dim small">upkeep ${fmtMoney(r.upkeep)}${r.loanInterest > 0 ? ' · interest ' + fmtMoney(r.loanInterest) : ''}</span>`)}
    ${r.gasMWh > 0.05 ? reportRow('<span class="dim">— gas</span>', `<span class="dim small">${r.gasMWh.toFixed(0)} MWh · ${fmtMoney(r.gasCost)}</span>`) : ''}
    ${(r.importMWh || 0) > 0.05 ? reportRow('<span class="dim">— imports</span>', `<span class="dim small">${r.importMWh.toFixed(0)} MWh · ${fmtMoney(r.importCost)}</span>`) : ''}
    ${(r.gridFee || 0) > 0.5 ? reportRow('<span class="dim">— grid operations</span>', `<span class="dim small">${fmtMoney(r.gridFee)}</span>`) : ''}
    ${(r.compCost || 0) > 0.5 ? reportRow('<span class="dim">— blackout compensation</span>', `<span class="bad small">${fmtMoney(r.compCost)}</span>`) : ''}
    ${(r.h2SoldMWh || 0) > 0.05 ? reportRow('<span class="dim">— H₂ sold</span>', `<span class="dim small">${r.h2SoldMWh.toFixed(0)} MWh · ${fmtMoney(r.h2SoldMWh * H2OFFTAKE.pricePerMWh)}</span>`) : ''}
    <div class="report-advice small">${reportAdvice(r)}</div>`;
}

// ---------- side panel tabs ----------
function buildTabs() {
  document.querySelectorAll('#tabbtns button').forEach(b => {
    b.onclick = () => {
      const tab = b.dataset.tab;
      activeTab = activeTab === tab ? null : tab;
      G.routeHover = null;
      document.querySelectorAll('#tabbtns button').forEach(x => x.classList.toggle('on', x.dataset.tab === activeTab));
      $('sidepanel').style.display = activeTab ? 'flex' : 'none';
      document.querySelectorAll('.tabpage').forEach(p => p.style.display = p.id === 'tab-' + activeTab ? 'block' : 'none');
      if (activeTab) notifyTutorial('tab:' + activeTab);
      if (activeTab === 'dashboard') { renderYesterday(); renderForecast(); renderClimate(); }
      if (activeTab === 'contracts') renderContracts();
      if (activeTab === 'research') { renderResearch(); showTip('research'); }
      if (activeTab === 'routes') renderRoutes();
      if (activeTab === 'learn') renderLearn();
    };
  });
}

// ---------- topbar / live HUD ----------
let hudTimer = 0, chartTimer = 0;
export function updateUI(dt) {
  hudTimer += dt;
  if (hudTimer > 0.25) {
    hudTimer = 0;
    $('money').textContent = fmtMoney(G.money);
    $('money').className = G.money < 0 ? 'bad' : '';
    $('clock').textContent = fmtTime();
    const sup = G.supply, dem = G.demand;
    const totalSup = sup.solar + sup.wind + sup.hydro + sup.battery + sup.fuelcell + (sup.gas || 0) + (sup.import || 0);
    const totalDem = dem.city + dem.industry + dem.charging;
    const grid = $('gridstat');
    grid.innerHTML = `⚡ ${totalSup.toFixed(1)} / ${totalDem.toFixed(1)} MW`;
    grid.className = G.blackout ? 'bad blink' : (G.curtailedMW > 0.5 ? 'warn' : 'good');
    // €/MWh ticker: dim flat tariff → countdown once announced → color-coded live price
    const pr = $('pricestat');
    pr.innerHTML = `💶 €${G.price.toFixed(0)}/MWh` +
      (!G.marketLive && G.day >= MARKET.announceDay ? ` <span class="warn">market day ${MARKET.liveDay}</span>` : '');
    pr.className = 'small ' + (!G.marketLive ? 'dim'
      : G.price >= MARKET.scarcity ? 'bad blink'
      : G.supply.gas > 0.05 || G.supply.import > 0.05 ? 'warn'
      : G.price <= MARKET.bandLo ? 'good' : '');
    const sf = solarFactor();
    $('solarstat').innerHTML = `${sf <= 0 ? '🌙' : G.cloud > 0.6 ? '☁️' : G.cloud > 0.3 ? '🌤' : '☀️'} ${(sf * 100).toFixed(0)}%`;
    $('windstat').innerHTML = `🌬 ${(G.wind * 90).toFixed(0)} km/h` +
      (G.dunkelflaute > 0 ? ' <span class="bad blink">DUNKELFLAUTE</span>'
        : G.heatwave > 0 ? ' <span class="warn blink">HEATWAVE</span>' : '');
    const sn = season();
    $('season').textContent = `${sn.icon} ${sn.name}`;
    const pop = Math.floor(G.cities.reduce((a, c) => a + c.pop, 0));
    $('pop').textContent = `👥 ${pop.toLocaleString()}`;
    $('co2').textContent = `🌍 ${G.co2SavedTons.toFixed(0)} t CO₂ avoided`;
    // storage minis
    $('storemini').innerHTML =
      `🔋 ${pct(G.batteryMWh, G.batteryCapMWh)} <span class="dim">${G.batteryMWh.toFixed(0)}/${G.batteryCapMWh.toFixed(0)} MWh</span>` +
      ` &nbsp; 🫧 ${pct(G.h2MWh, G.h2CapMWh)} <span class="dim">${G.h2MWh.toFixed(0)}/${G.h2CapMWh.toFixed(0)} MWh</span>`;
    updateWeatherBanner();
    updateToolbarLocks();
    renderInfobox();
    if (activeTab === 'routes') renderRoutesLive();
    if (activeTab === 'research') renderResearchLive();
    if (activeTab === 'contracts') renderContractsLive();
  }
  chartTimer += dt;
  if (chartTimer > 0.6 && activeTab === 'dashboard') {
    chartTimer = 0;
    renderForecast();
    drawPowerChart();
    renderClimate();
    drawFinance();
    updateLoanBox();
  }
}
const pct = (v, c) => c > 0 ? Math.round(v / c * 100) + '%' : '—';

// ---------- weather forecast (ADR 23) ----------
// warning banner under the topbar while a front is inbound — updates live
// with the countdown, hidden when nothing is scheduled
function updateWeatherBanner() {
  const el = $('weatherbanner');
  // the topbar wraps to two lines on narrower viewports (it grew a price
  // ticker) — anchor the under-topbar overlays to its real height
  const tbH = $('topbar').offsetHeight + 'px';
  el.style.top = tbH;
  $('toolhint').style.top = tbH;
  const f = G.weatherFront;
  if (!f) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const eta = Math.max(1, Math.round(f.inHours));
  el.textContent = f.type === 'dunkelflaute'
    ? `⚠ Dunkelflaute in ~${eta} h — est. ${Math.round(f.durationH)} h of dark calm. Charge batteries & H₂ now!`
    : f.type === 'heatwave'
    ? `🔥 Heatwave in ~${eta} h — city demand +${Math.round((CLIMATE.heatDemand - 1) * 100)}% (AC), wind low for ~${Math.round(f.durationH)} h. Solar stays strong — charge storage at noon.`
    : `⚠ Storm front in ~${eta} h — turbines will cut out. Storage bridges the gap.`;
}

// dashboard strip: one cell per 3 h slot of G.forecast (see energy.js)
function slotIcon(sl) {
  if (sl.storm) return '🌪';
  if (sl.flaute) return '🌫';
  if (sl.heat) return '🔥';
  if (sl.night) return '🌙';
  return sl.sun > 0.55 ? '☀️' : sl.sun > 0.25 ? '🌤' : '☁️';
}
const FRONT_LABEL = { dunkelflaute: '🌫 Dunkelflaute', storm: '🌪 Storm', heatwave: '🔥 Heatwave' };
function renderForecast() {
  const fc = G.forecast;
  if (!fc) return;
  $('forecaststrip').innerHTML = fc.slots.map(sl =>
    `<div class="fslot${sl.flaute || sl.storm || sl.heat ? ' warnslot' : ''}">
      <div class="fi">${slotIcon(sl)}</div><div class="fh">${String(sl.hour).padStart(2, '0')}h</div></div>`).join('');
  const dw = fc.windTrend - G.wind;
  const arrow = dw > 0.06 ? '↗ picking up' : dw < -0.06 ? '↘ easing' : '→ steady';
  $('forecastwind').innerHTML = `🌬 Wind trend: ${arrow}` +
    (fc.front ? ` · <span class="warn">${FRONT_LABEL[fc.front.type]} in ~${Math.max(1, Math.round(fc.front.inHours))} h</span>` : '');
}

// ---------- climate box (ADR 24) ----------
// emitted vs avoided CO₂ side by side + the extreme-event risk band derived
// from climateRiskMult(): calm (< elevatedAt) / elevated (< highAt) / high
function renderClimate() {
  const el = $('climatebox');
  if (!el) return;
  const risk = climateRiskMult();
  const [band, cls] = risk >= CLIMATE.highAt ? ['high', 'bad']
    : risk >= CLIMATE.elevatedAt ? ['elevated', 'warn'] : ['calm', 'good'];
  el.innerHTML = `<h3>🌡 Climate</h3>
    <div class="kpirow">
      ${kpi('CO₂ emitted (gas)', `<span class="${G.co2EmittedTons > 0.5 ? 'bad' : 'dim'}">${G.co2EmittedTons.toFixed(0)} t</span>`)}
      ${kpi('CO₂ avoided', `<span class="good">${G.co2SavedTons.toFixed(0)} t</span>`)}
    </div>
    <div class="finrow"><span>Extreme-event risk <span class="dim small">(storms & heatwaves ×${risk.toFixed(2)})</span></span><span class="${cls}"><b>${band}</b></span></div>`;
  liveTip(el, () => `<b>🌡 Climate feedback</b><br>
    Every gas MWh emits CO₂ — and a warmer atmosphere rolls more extreme weather. Your emitted
    ${G.co2EmittedTons.toFixed(0)} t multiply the storm & heatwave probability by
    <b>${risk.toFixed(2)}×</b> (capped at ${CLIMATE.maxMult}× at ${CLIMATE.scaleTons} t). Ordinary
    Dunkelflauten are unaffected — they're normal weather; climate change loads the dice for the <i>extremes</i>.`);
}

// ---------- dashboard charts ----------
const SERIES = [
  ['solar', '#f5c542', 'Solar'], ['wind', '#5fd4d0', 'Wind'], ['hydro', '#4a90d9', 'Hydro'],
  ['battery', '#7ed87e', 'Battery'], ['fuelcell', '#c08ae0', 'Fuel cell'], ['gas', '#c2604a', 'Gas'],
  ['import', '#d99a3f', 'Import'],
];
function drawPowerChart() {
  const cv = $('powerchart'); const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const hist = G.history;
  if (hist.length < 2) { ctx.fillStyle = '#999'; ctx.fillText('Collecting data…', 10, 20); return; }
  let maxY = 4;
  for (const s of hist) maxY = Math.max(maxY, s.solar + s.wind + s.hydro + s.battery + s.fuelcell + (s.gas || 0) + (s.import || 0), s.demandTotal + s.elec);
  maxY *= 1.15;
  const x = i => i / (G.histMax - 1) * W;
  const y = v => H - v / maxY * H;
  // night shading (seasonal day length)
  ctx.fillStyle = 'rgba(40,50,90,0.25)';
  hist.forEach((s, i) => {
    const h = (s.t / 60) % 24;
    const sn = seasonOf(Math.floor(s.t / 1440) + 1);
    if (h < sn.sunrise || h > sn.sunset) ctx.fillRect(x(i), 0, W / G.histMax + 1, H);
  });
  // stacked areas
  let base = hist.map(() => 0);
  for (const [key, color] of SERIES) {
    ctx.beginPath();
    hist.forEach((s, i) => { const v = base[i] + (s[key] || 0); i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(0), y(v)); });
    for (let i = hist.length - 1; i >= 0; i--) ctx.lineTo(x(i), y(base[i]));
    ctx.closePath();
    ctx.fillStyle = color + 'cc';
    ctx.fill();
    base = base.map((b, i) => b + (hist[i][key] || 0));
  }
  // demand line (incl. electrolyzer as dashed extension)
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8; ctx.beginPath();
  hist.forEach((s, i) => i ? ctx.lineTo(x(i), y(s.demandTotal)) : ctx.moveTo(x(0), y(s.demandTotal)));
  ctx.stroke();
  ctx.strokeStyle = '#3fae9c'; ctx.setLineDash([4, 3]); ctx.beginPath();
  hist.forEach((s, i) => i ? ctx.lineTo(x(i), y(s.demandTotal + s.elec)) : ctx.moveTo(x(0), y(s.demandTotal + s.elec)));
  ctx.stroke(); ctx.setLineDash([]);
  // unserved = red ticks
  ctx.fillStyle = '#ff5555';
  hist.forEach((s, i) => { if (s.unserved > 0.2) ctx.fillRect(x(i), 0, 2, 8); });
  // electricity price line (own right-hand scale: 0 → scarcity price, ADR 22)
  const priceOf = s => s.price ?? POWER_PRICE; // pre-market samples have no price field
  const yP = v => H - v / (MARKET.scarcity * 1.08) * H;
  ctx.strokeStyle = '#e86fc3'; ctx.lineWidth = 1.4; ctx.beginPath();
  hist.forEach((s, i) => i ? ctx.lineTo(x(i), yP(priceOf(s))) : ctx.moveTo(x(0), yP(priceOf(s))));
  ctx.stroke();
  // labels
  ctx.fillStyle = '#ccc'; ctx.font = '10px sans-serif';
  ctx.fillText(maxY.toFixed(0) + ' MW', 4, 10);
  const lastP = priceOf(hist[hist.length - 1]);
  ctx.fillStyle = '#e86fc3';
  ctx.fillText(`€${lastP.toFixed(0)}`, W - 30, Math.max(10, Math.min(H - 3, yP(lastP) - 4)));
  // legend
  const lg = $('chartlegend');
  if (!lg.dataset.done) {
    lg.dataset.done = 1;
    lg.innerHTML = SERIES.map(([k, c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join('') +
      '<span><i style="background:#fff"></i>Demand</span><span><i style="background:#3fae9c"></i>+Electrolyzer</span><span><i style="background:#ff5555"></i>Unserved</span><span><i style="background:#e86fc3"></i>Price €/MWh</span>';
  }
  // storage bars
  drawBar($('battbar'), G.batteryCapMWh ? G.batteryMWh / G.batteryCapMWh : 0, '#7ed87e',
    `Battery ${G.batteryMWh.toFixed(1)} / ${G.batteryCapMWh.toFixed(0)} MWh`);
  drawBar($('h2bar'), G.h2CapMWh ? G.h2MWh / G.h2CapMWh : 0, '#c08ae0',
    `Hydrogen ${G.h2MWh.toFixed(0)} / ${G.h2CapMWh.toFixed(0)} MWh (≈${(G.h2MWh / 33.3).toFixed(1)} t H₂)`);
  // KPIs
  const sup = G.supply;
  const ren = sup.solar + sup.wind + sup.hydro;
  const tot = ren + sup.battery + sup.fuelcell + (sup.gas || 0) + (sup.import || 0); // gas & imports dilute the renewable share
  $('kpis').innerHTML =
    kpi('Renewable share', tot > 0 ? Math.round(ren / tot * 100) + '%' : '—') +
    kpi('Curtailed today', G.curtailedTodayMWh.toFixed(1) + ' MWh') +
    kpi('Grid served', Math.round(G.servedFraction * 100) + '%') +
    kpi('H₂ round trip', Math.round(G.mult.elecEff * G.mult.fcEff * 100) + '%') +
    kpi('Battery round trip', '92%') +
    kpi('Power price', `€${G.price.toFixed(0)}/MWh <span class="dim small">${G.marketLive ? `dynamic since day ${MARKET.liveDay}` : `flat until day ${MARKET.liveDay}`}</span>`) +
    kpi('Carbon price', `€${G.carbonPrice}/t <span class="dim small">▲ €${CARBON.perDay}/day</span>`) +
    (G.gasCostToday > 0 ? kpi('Gas cost today', fmtMoney(-G.gasCostToday)) : '') +
    (G.h2SoldMWhToday > 0.05 ? kpi('H₂ sold today', `${G.h2SoldMWhToday.toFixed(0)} MWh <span class="dim small">${fmtMoney(G.h2SoldMWhToday * H2OFFTAKE.pricePerMWh)}</span>`) : '');
  // emitted/avoided CO₂ moved into the 🌡 Climate box below (ADR 24)
}
const kpi = (n, v) => `<div class="kpi"><div class="kpi-v">${v}</div><div class="kpi-n">${n}</div></div>`;

function drawBar(cv, f, color, label) {
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#222a33'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = color; ctx.fillRect(0, 0, cv.width * Math.max(0, Math.min(1, f)), cv.height);
  ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif';
  ctx.fillText(label, 6, cv.height / 2 + 4);
}

const finOpen = new Set(); // which <details> stay open across re-renders
function drawFinance() {
  const cv = $('moneychart'); const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const h = G.moneyHistory;
  if (h.length < 2) return;
  const min = Math.min(...h), max = Math.max(...h), range = Math.max(1, max - min);
  ctx.strokeStyle = '#f0d264'; ctx.lineWidth = 1.6; ctx.beginPath();
  h.forEach((v, i) => {
    const px = i / (h.length - 1) * cv.width, py = cv.height - 4 - (v - min) / range * (cv.height - 10);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  });
  ctx.stroke();

  const f = G.finance.today, fp = G.finance.prev;
  const routeRows = G.routes.map(r => {
    const today = f.routes[r.id] || 0;
    const prev = fp && fp.routes ? fp.routes[r.id] : null;
    return `<div class="finrow finsub2"><span><i class="rdot" style="background:${routeColor(r)}"></i>${r.name}</span>
      <span class="good">${fmtMoney(today)}${prev != null ? ` <span class="dim">/ ${fmtMoney(prev)}</span>` : ''}</span></div>`;
  }).join('') || '<div class="finrow finsub2 dim">no routes yet</div>';
  $('finrows').innerHTML =
    `<details class="findet" data-k="transport">
      <summary class="finrow"><span>▸ Transport income (today)</span><span class="good">${fmtMoney(G.incomeTransportToday)}</span></summary>
      ${finrow('🚌 Buses (passengers)', f.bus || 0, 'good', 'finsub')}
      ${finrow('🚚 Trucks (freight)', f.truck || 0, 'good', 'finsub')}
      ${finrow('🚆 Trains (pax + freight)', f.train || 0, 'good', 'finsub')}
      <details class="findet" data-k="routes">
        <summary class="finrow finsub"><span>▸ By route — today${fp ? ' / <span class="dim">yesterday</span>' : ''}</span><span></span></summary>
        ${routeRows}
      </details>
    </details>` +
    finrow('Energy sales (today)', G.incomeEnergyToday, 'good') +
    finrow('Expenses (today)', -G.expensesToday, 'bad');
  // re-apply + track open state (the panel re-renders every 0.6 s)
  $('finrows').querySelectorAll('details').forEach(d => {
    d.open = finOpen.has(d.dataset.k);
    d.addEventListener('toggle', () => d.open ? finOpen.add(d.dataset.k) : finOpen.delete(d.dataset.k));
  });
}
const finrow = (n, v, cls, extra = '') => `<div class="finrow ${extra}"><span>${n}</span><span class="${cls}">${fmtMoney(v)}</span></div>`;

// ---------- research ----------
function renderResearch() {
  const el = $('tab-research');
  el.innerHTML = '<h3>🔬 Research</h3><div class="dim small">One project at a time. Effects are permanent.</div><div id="techlist"></div>';
  const list = el.querySelector('#techlist');
  for (const t of TECHS) {
    const done = G.techs[t.id];
    const locked = t.req && !G.techs[t.req];
    const active = G.research && G.research.id === t.id;
    const d = document.createElement('div');
    d.className = 'tech' + (done ? ' done' : '') + (locked ? ' locked' : '');
    d.innerHTML = `<div class="tech-head"><b>${t.name}</b><span class="dim">${t.cat}</span></div>
      <div class="small">${t.desc}</div>
      <div class="tech-foot">${done ? '✅ Researched' : locked ? '🔒 Requires ' + TECHS.find(x => x.id === t.req).name :
        active ? `<div class="prog"><div id="prog-${t.id}" style="width:${(G.research.progress * 100).toFixed(0)}%"></div></div>` :
          `<button data-tech="${t.id}">${fmtMoney(t.cost)} · ${t.days} days</button>`}</div>`;
    const btn = d.querySelector('button');
    if (btn) btn.onclick = () => {
      const r = startResearch(t.id); // sim decides; we only explain refusals
      if (r === 'busy') { showTipText('Lab busy', 'Your researchers are already working on ' + TECHS.find(x => x.id === G.research.id).name + '.'); return; }
      if (r === 'poor') { showTipText('Too expensive', 'Not enough funds for this project.'); return; }
      renderResearch();
    };
    list.appendChild(d);
  }
}
function renderResearchLive() {
  if (!G.research) return;
  const bar = document.getElementById('prog-' + G.research.id);
  if (bar) bar.style.width = (G.research.progress * 100).toFixed(0) + '%';
  else renderResearch();
}

// ---------- special contracts ----------
const fmtDur = min => min >= 1440 ? (min / 1440).toFixed(1) + ' days' : Math.max(1, Math.ceil(min / 60)) + ' h';

function contractCard(c, signed) {
  const left = signed ? c.deadline - G.minutes : c.expires - G.minutes;
  const pct = Math.min(100, c.progress / c.amount * 100);
  const prem = Math.round((c.mult - 1) * 100);
  return `<div class="tech">
    <div class="tech-head"><b>${CARGO[c.cargoId].name === 'Passengers' ? '🧍' : '📦'} ${contractLabel(c)}</b>
      <button class="quest-jump" data-cjump="${c.id}" title="Jump to destination">📍</button></div>
    <div class="small">+${prem}% on matching deliveries · bonus <b class="good">${fmtMoney(c.bonus)}</b> on completion</div>
    ${signed
      ? `<div class="prog" style="margin-top:5px"><div style="width:${pct.toFixed(1)}%"></div></div>
         <div class="small dim">${Math.floor(c.progress)} / ${c.amount} delivered · <span class="${left < 720 ? 'warn' : ''}">deadline in ${fmtDur(left)}</span></div>`
      : `<div class="tech-foot"><button data-sign="${c.id}">✍️ Sign — ${fmtDur(left)} left to decide · ${c.days} days to deliver</button></div>`}
  </div>`;
}

function renderContracts() {
  const el = $('tab-contracts');
  const cs = G.contracts;
  el.innerHTML = `<h3>📜 Special Contracts</h3>
    <div class="dim small">Cities and industries post time-limited offers. Sign one to earn a premium on every matching delivery, plus a bonus for hitting the target before the deadline. Unsigned offers expire and new ones appear over time.</div>
    <h3 style="margin-top:8px">✍️ Signed <span class="dim small">(${cs.active.length}/${MAX_ACTIVE})</span></h3>
    ${cs.active.map(c => contractCard(c, true)).join('') || '<div class="small dim">No signed contracts.</div>'}
    <h3 style="margin-top:8px">Open offers <span class="dim small">(${cs.offers.length}/${MAX_OFFERS})</span></h3>
    ${cs.offers.map(c => contractCard(c, false)).join('') || '<div class="small dim">Nothing on the board — new offers appear within a few hours.</div>'}
    ${cs.completed + cs.failed ? `<div class="small dim" style="margin-top:6px">✅ ${cs.completed} fulfilled · ✖ ${cs.failed} expired</div>` : ''}`;
  el.querySelectorAll('[data-sign]').forEach(b => b.onclick = () => {
    const c = cs.offers.find(x => x.id === +b.dataset.sign);
    if (!c) return;
    if (cs.active.length >= MAX_ACTIVE) { showTipText('Portfolio full', `You can run at most ${MAX_ACTIVE} contracts at once — finish one first.`); return; }
    signContract(c);
  });
  el.querySelectorAll('[data-cjump]').forEach(b => b.onclick = () => {
    const c = cs.active.find(x => x.id === +b.dataset.cjump) || cs.offers.find(x => x.id === +b.dataset.cjump);
    if (c) emit('flyTo', contractDest(c));
  });
}
// re-render only when progress/countdowns visibly change (~hourly granularity)
let lastContractSig = '';
function renderContractsLive() {
  const cs = G.contracts;
  const sig = cs.active.map(c => `${c.id}:${Math.floor(c.progress)}:${Math.floor((c.deadline - G.minutes) / 60)}`).join() + '|' +
    cs.offers.map(c => `${c.id}:${Math.floor((c.expires - G.minutes) / 60)}`).join();
  if (sig === lastContractSig) return;
  lastContractSig = sig;
  renderContracts();
}

// ---------- bank loan (dashboard finances) ----------
function initLoanBox() {
  const el = $('loanbox');
  el.innerHTML = `<div class="finrow"><span>🏦 Loan <span class="dim small">(${(LOAN_RATE * 100).toFixed(0)}%/day interest)</span></span><span id="loanstat"></span></div>
    <div style="display:flex;gap:6px;margin-top:5px">
      <button id="borrowbtn" style="flex:1">Borrow ${fmtMoney(LOAN_STEP)}</button>
      <button id="repaybtn" style="flex:1">Repay ${fmtMoney(LOAN_STEP)}</button>
    </div>`;
  liveTip(el, () => `<b>🏦 Bank loan</b><br>Borrow up to ${fmtMoney(LOAN_MAX)} in ${fmtMoney(LOAN_STEP)} steps. Interest of ${(LOAN_RATE * 100).toFixed(0)}% per day on the outstanding amount is charged with the daily upkeep. Repay any time you have the cash.`);
  $('borrowbtn').onclick = () => {
    if (!takeLoan()) showTipText('Credit limit reached', `The bank lends at most ${fmtMoney(LOAN_MAX)}.`);
    updateLoanBox();
  };
  $('repaybtn').onclick = () => {
    if (!repayLoan()) showTipText('Nothing to repay', G.loan > 0 ? 'Not enough cash on hand.' : 'You have no outstanding loan.');
    updateLoanBox();
  };
  updateLoanBox();
}
function updateLoanBox() {
  const s = $('loanstat');
  if (!s) return;
  s.innerHTML = G.loan > 0
    ? `<span class="bad">${fmtMoney(G.loan)}</span> <span class="dim small">−${fmtMoney(G.loan * LOAN_RATE)}/day</span>`
    : '<span class="dim">debt-free</span>';
  $('borrowbtn').disabled = G.loan >= LOAN_MAX;
  $('repaybtn').disabled = G.loan <= 0;
}

// ---------- routes ----------
// module-level UI state (display only — never saved, game rules live in the sim)
const ROUTE_GROUPS = [['bus', '🚌', 'Bus'], ['rail', '🚆', 'Rail'], ['cargo', '🚚', 'Cargo']];
const KIND_BUTTONS = { bus: ['bus'], rail: ['train'], cargo: ['truck'] }; // routeKind → buyable vehicle kinds
let routeFilter = 'all';      // 'all' | 'bus' | 'rail' | 'cargo'
let cargoFilter = null;       // cargo id — narrows the cargo group to routes that delivered it
const routeGroupClosed = {};  // routeKind → true when the section is collapsed

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
    renderRoutes();
  };

  // group routes by their derived kind; stop-less routes have no kind yet
  const grouped = { bus: [], rail: [], cargo: [], none: [] };
  for (const r of G.routes) grouped[routeKind(r) || 'none'].push(r);

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

// one route card: name, stops, vehicle-buy buttons (only kinds matching the
// route's derived kind), finance-relevant vehicle list
function routeCard(r) {
  const d = document.createElement('div');
  d.className = 'route' + (G.routeEdit === r ? ' editing' : '');
  d.style.borderLeft = `4px solid ${routeColor(r)}`;
  d.onmouseenter = () => { G.routeHover = r; };
  d.onmouseleave = () => { if (G.routeHover === r) G.routeHover = null; };
  const stops = r.stops.map(s => s.name || s.def.name).join(' → ') || '<i class="dim">click stations on the map…</i>';
  const rk = routeKind(r);
  const kinds = rk ? KIND_BUTTONS[rk] : ['truck', 'bus', 'train']; // kindless route: all options open
  d.innerHTML = `<div class="route-head"><b>${r.name}</b>
      ${G.routeEdit === r ? '<button data-a="done">✔ Done</button>' : '<button data-a="edit">✎</button>'}
      <button data-a="del">🗑</button></div>
    <div class="small">${stops}</div>
    <div class="route-veh">
      ${kinds.map(k => `<button data-a="${k}">+ ${VEHICLES[k].icon} ${fmtMoney(VEHICLES[k].cost)}</button>`).join('')}
    </div>
    ${r.vehicles.length ? `<label class="small dim" style="display:block;margin-top:3px"><input type="checkbox" data-a="auto"${r.autoReplace ? ' checked' : ''}> 🔧 auto-replace aged vehicles (at ${AGING.autoAtDays} days, ${Math.round(AGING.replaceFrac * 100)}% of list price)</label>` : ''}
    <div class="vehlist" data-r="${r.id}"></div>`;
  d.querySelector('[data-a=del]').onclick = () => {
    [...r.vehicles].forEach(sellVehicle);
    G.routes = G.routes.filter(x => x !== r);
    if (G.routeEdit === r) G.routeEdit = null;
    renderRoutes();
  };
  const eb = d.querySelector('[data-a=edit]');
  if (eb) eb.onclick = () => { G.routeEdit = r; renderRoutes(); };
  const db = d.querySelector('[data-a=done]');
  if (db) db.onclick = () => { G.routeEdit = null; renderRoutes(); };
  const ab = d.querySelector('[data-a=auto]');
  if (ab) ab.onchange = e => { r.autoReplace = e.target.checked; };
  for (const kind of kinds) {
    d.querySelector(`[data-a=${kind}]`).onclick = () => {
      const v = purchaseVehicle(r, kind); // sim validates & charges; we translate refusals
      if (v === 'short') showTipText('Route too short', 'Add at least 2 stops first (click ✎, then click stations on the map).');
      else if (v === 'poor') showTipText('Too expensive', 'Not enough funds.');
      else if (v === 'kind') {
        const rk2 = routeKind(r);
        showTipText('Wrong vehicle type', `${r.name} is a ${rk2} route — its stops only serve ${KIND_BUTTONS[rk2].map(k => VEHICLES[k].name.toLowerCase() + 's').join('/')}.`);
      } else if (v === 'access') {
        showTipText(kind === 'train' ? 'No rail access' : 'No road access',
          kind === 'train' ? 'The first stop has no adjacent rail track — trains need Rail Stations connected by track.' : 'The first stop has no adjacent road.');
      }
      renderRoutes();
    };
  }
  // wagon & replace buttons live inside the constantly re-rendered vehlist → delegate clicks
  d.querySelector('.vehlist').onclick = e => {
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
function renderRoutesLive() {
  for (const r of G.routes) {
    const el = document.querySelector(`.vehlist[data-r="${r.id}"]`);
    if (!el) continue;
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
      if (v.kind === 'train') {
        const st = v.state === 'stranded' ? '⚠️ no rail connection!' : v.state === 'loading' ? 'loading' : G.blackout ? '🚫 no traction power!' : '▶';
        const nPax = v.wagons.filter(w => w.type === 'pax').length, nFr = v.wagons.length - nPax;
        const wag = v.wagons.length ? `${nPax ? nPax + '×🧍' : ''} ${nFr ? nFr + '×📦' : ''}`.trim() : '<span class="warn">no wagons!</span>';
        return `<div class="veh small">${v.def.icon} ${st} · ${wag} · ${carg}${ageTag}<br>
          <button data-w="pax" data-vi="${vi}">+ ${WAGONS.pax.icon} Car ${fmtMoney(WAGONS.pax.cost)}</button>
          <button data-w="freight" data-vi="${vi}">+ ${WAGONS.freight.icon} Wagon ${fmtMoney(WAGONS.freight.cost)}</button>${repBtn}</div>`;
      }
      const st = v.state === 'stranded' ? (v.noRoute ? '⚠️ no road connection!' : '🪫 stranded!') : v.state === 'loading' ? (v.charging ? '⚡charging' : 'loading') : '▶';
      const packKWh = effectiveBatteryKWh(v);
      const wear = packKWh < v.def.batteryKWh - 0.5 ? ` <span class="warn" title="pack worn to ${Math.round(packKWh / v.def.batteryKWh * 100)}% of original">▾</span>` : '';
      return `<div class="veh small">${v.def.icon} ${st} · 🔋${Math.round(v.battery / packKWh * 100)}%${wear} · ${carg}${ageTag}${repBtn}</div>`;
    }).join('');
  }
}

// ---------- learn tab ----------
function renderLearn() {
  const el = $('tab-learn');
  if (el.dataset.done) return;
  el.dataset.done = 1;
  el.innerHTML = '<h3>📚 Energy Encyclopedia</h3>' + LEARN.map(([t, b]) =>
    `<details class="learn"><summary>${t}</summary><div class="small">${b}</div></details>`).join('');
}

// ---------- welcome screen ----------
// stylised scene: sun→solar, wind, hydro, storage feeding a city + e-transport
const WELCOME_SVG = `
<svg viewBox="0 0 640 240" xmlns="http://www.w3.org/2000/svg" style="width:100%;border-radius:10px;display:block">
  <defs>
    <linearGradient id="wsky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b3a5c"/><stop offset="0.55" stop-color="#3a7ca8"/><stop offset="1" stop-color="#8ec9e8"/>
    </linearGradient>
    <linearGradient id="wgrass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6fae5c"/><stop offset="1" stop-color="#4a7d3e"/>
    </linearGradient>
  </defs>
  <rect width="640" height="240" fill="url(#wsky)"/>
  <circle cx="80" cy="56" r="26" fill="#ffd95e"/>
  <g stroke="#ffd95e" stroke-width="3" opacity="0.8">
    <line x1="80" y1="14" x2="80" y2="26"/><line x1="80" y1="86" x2="80" y2="98"/>
    <line x1="38" y1="56" x2="50" y2="56"/><line x1="110" y1="56" x2="122" y2="56"/>
    <line x1="50" y1="26" x2="59" y2="35"/><line x1="101" y1="77" x2="110" y2="86"/>
    <line x1="50" y1="86" x2="59" y2="77"/><line x1="101" y1="35" x2="110" y2="26"/>
  </g>
  <rect y="170" width="640" height="70" fill="url(#wgrass)"/>
  <!-- city skyline -->
  <g>
    <rect x="468" y="92" width="34" height="80" fill="#5a6b7d"/>
    <rect x="508" y="72" width="40" height="100" fill="#48586a"/>
    <rect x="554" y="104" width="30" height="68" fill="#62758a"/>
    <rect x="590" y="86" width="36" height="86" fill="#52647a"/>
    <g fill="#ffd97a">
      <rect x="514" y="80" width="7" height="8"/><rect x="528" y="80" width="7" height="8"/>
      <rect x="514" y="96" width="7" height="8"/><rect x="528" y="112" width="7" height="8"/>
      <rect x="474" y="100" width="6" height="7"/><rect x="486" y="116" width="6" height="7"/>
      <rect x="596" y="94" width="7" height="8"/><rect x="610" y="110" width="7" height="8"/>
      <rect x="560" y="112" width="6" height="7"/><rect x="572" y="128" width="6" height="7"/>
    </g>
  </g>
  <!-- wind turbines -->
  <g stroke="#eef2f5" stroke-width="5" stroke-linecap="round">
    <line x1="180" y1="170" x2="180" y2="84"/><line x1="252" y1="170" x2="252" y2="104"/>
  </g>
  <g fill="#f4f7f9">
    <g transform="translate(180,84)"><path d="M0 0 L8 -52 L-8 -52 Z"/><path d="M0 0 L8 -52 L-8 -52 Z" transform="rotate(120)"/><path d="M0 0 L8 -52 L-8 -52 Z" transform="rotate(240)"/><circle r="6" fill="#dfe5ea"/></g>
    <g transform="translate(252,104) rotate(40)"><path d="M0 0 L6 -40 L-6 -40 Z"/><path d="M0 0 L6 -40 L-6 -40 Z" transform="rotate(120)"/><path d="M0 0 L6 -40 L-6 -40 Z" transform="rotate(240)"/><circle r="5" fill="#dfe5ea"/></g>
  </g>
  <!-- solar farm -->
  <g transform="translate(50,150)">
    <g transform="skewX(-18)">
      <rect x="0" y="0" width="54" height="22" rx="2" fill="#16335f" stroke="#c3cad2" stroke-width="2"/>
      <line x1="18" y1="0" x2="18" y2="22" stroke="#3b6db0" stroke-width="1.5"/>
      <line x1="36" y1="0" x2="36" y2="22" stroke="#3b6db0" stroke-width="1.5"/>
    </g>
    <g transform="translate(64,0) skewX(-18)">
      <rect x="0" y="0" width="54" height="22" rx="2" fill="#16335f" stroke="#c3cad2" stroke-width="2"/>
      <line x1="18" y1="0" x2="18" y2="22" stroke="#3b6db0" stroke-width="1.5"/>
      <line x1="36" y1="0" x2="36" y2="22" stroke="#3b6db0" stroke-width="1.5"/>
    </g>
  </g>
  <!-- battery -->
  <g transform="translate(300,142)">
    <rect width="46" height="28" rx="4" fill="#dfe5ea"/><rect x="46" y="9" width="5" height="10" rx="2" fill="#dfe5ea"/>
    <rect x="4" y="4" width="24" height="20" rx="2" fill="#7ed87e"/>
    <text x="14" y="19" font-size="14" font-weight="700" fill="#19405c">⚡</text>
  </g>
  <!-- power line: plants → city -->
  <path d="M 130 160 C 220 120 360 120 470 140" fill="none" stroke="#ffd95e" stroke-width="3" stroke-dasharray="7 6" opacity="0.9"/>
  <!-- road + e-bus & truck -->
  <rect y="196" width="640" height="26" fill="#3c4043"/>
  <g stroke="#e8edf2" stroke-width="2" stroke-dasharray="14 12"><line x1="0" y1="209" x2="640" y2="209"/></g>
  <g transform="translate(360,184)">
    <rect width="64" height="24" rx="5" fill="#2a78c2"/><rect x="6" y="5" width="52" height="9" rx="2" fill="#bfe3ff"/>
    <circle cx="14" cy="26" r="6" fill="#16191c"/><circle cx="50" cy="26" r="6" fill="#16191c"/>
  </g>
  <g transform="translate(120,186)">
    <rect width="26" height="20" rx="3" fill="#2e7d4f"/><rect x="28" y="2" width="38" height="18" rx="2" fill="#e8e4da"/>
    <circle cx="12" cy="22" r="5.5" fill="#16191c"/><circle cx="36" cy="22" r="5.5" fill="#16191c"/><circle cx="56" cy="22" r="5.5" fill="#16191c"/>
  </g>
  <!-- rail + train -->
  <rect y="228" width="640" height="4" fill="#6e6a62"/>
  <g transform="translate(470,206)">
    <rect width="90" height="20" rx="5" fill="#c8453c"/><rect x="8" y="4" width="74" height="7" rx="2" fill="#18242f"/>
    <line x1="20" y1="0" x2="26" y2="-10" stroke="#3a4046" stroke-width="2"/>
    <circle cx="16" cy="22" r="5" fill="#16191c"/><circle cx="40" cy="22" r="5" fill="#16191c"/><circle cx="74" cy="22" r="5" fill="#16191c"/>
  </g>
</svg>`;

export function showWelcome(hasSaveFlag) {
  G._lastSpeed = G.speed || 1;
  G.speed = 0; // pause behind the overlay
  const el = document.createElement('div');
  el.id = 'welcome';
  el.innerHTML = `<div id="welcome-card">
    ${WELCOME_SVG}
    <h1>🌍 Transport Eco Tycoon</h1>
    <p class="wlead">You run this region's <b>transport company</b> — and its <b>100% renewable power grid</b>.</p>
    <div class="wgrid">
      <div>☀️🌬💧 <b>Generate</b> clean power with solar, wind & hydro — and sell every MWh to cities and industry.</div>
      <div>🔋🫧 <b>Store</b> the surplus: batteries for the evening, hydrogen for dark, windless weeks.</div>
      <div>🚌🚚🚆 <b>Move</b> people & goods with e-buses, e-trucks and electric trains — they all run on your grid.</div>
      <div>🎯 <b>Grow</b>: follow the Objectives, research better tech and keep your cities happy.</div>
    </div>
    <p class="wcontrols dim">🖱 Right-drag: move map · Middle-drag: rotate · Wheel: zoom · WASD: pan · V: passenger demand · Space: pause</p>
    <div class="wbtns">
      ${hasSaveFlag
        ? '<button id="w-continue" class="wprimary">▶ Continue game</button><button id="w-new">↺ Start new game</button>'
        : '<button id="w-tutorial" class="wprimary">🎓 Start the tutorial <span class="wsub">recommended · ~5 min · pays €90k</span></button><button id="w-start">▶ Free play <span class="wsub">I know tycoon games</span></button>'}
    </div>
  </div>`;
  document.body.appendChild(el);
  // withTutorial: guided steps for new players; otherwise the tutorial is
  // marked done (silently) and the classic welcome tip fires instead
  const start = withTutorial => {
    el.remove();
    setSpeed(1);
    if (hasSaveFlag) return;
    if (withTutorial) startTutorial();
    else { skipTutorial(); showTip('welcome'); }
  };
  const bs = el.querySelector('#w-start'), bt = el.querySelector('#w-tutorial'),
    bc = el.querySelector('#w-continue'), bn = el.querySelector('#w-new');
  if (bs) bs.onclick = () => start(false);
  if (bt) bt.onclick = () => start(true);
  if (bc) bc.onclick = () => start(false);
  if (bn) bn.onclick = () => {
    if (!confirm('Delete the saved game and start over?')) return;
    clearSave();
    location.reload();
  };
}

// ---------- selection infobox ----------
function renderInfobox() {
  const el = $('infobox');
  const s = G.selected;
  if (!s) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  let html = '';
  if (s.kind === 'industry') {
    const d = s.def;
    html = `<b>${d.icon} ${d.name}</b><div class="small">${d.desc}</div>
      <div class="small">Power: ${d.powerMW} MW · ${s.running ? '<span class="good">running</span>' : '<span class="bad">halted</span>'}</div>
      <div class="small">Output stock: ${s.stock.toFixed(0)} ${CARGO[d.produces].name}${d.accepts ? ` · Input: ${s.inStock.toFixed(0)} ${CARGO[d.accepts].name}` : ''}</div>`;
  } else if (s.kind === 'plant') {
    const d = s.def;
    html = `<b>${d.icon} ${d.name}</b><div class="small">${d.desc}</div>`;
    if (s.type === 'gas' && !G.gasDecommissioned) {
      const marginal = gasMarginalCost();
      const priceRef = G.marketLive ? G.price : POWER_PRICE; // live market: current price, else flat tariff
      const margin = priceRef - marginal;
      html += `<div class="small" style="margin-top:4px">Marginal cost: <b class="${margin < 0 ? 'bad' : 'warn'}">€${marginal.toFixed(1)}/MWh</b>
          (€${d.fuelPerMWh} fuel + €${(d.co2PerMWh * G.carbonPrice).toFixed(1)} carbon @ €${G.carbonPrice}/t) vs €${priceRef.toFixed(0)} ${G.marketLive ? 'market price' : 'price'}
          → ${margin < 0 ? `<b class="bad">−€${(-margin).toFixed(1)}/MWh loss</b>` : `€${margin.toFixed(1)}/MWh margin`}${G.marketLive ? `<span class="dim"> — while it runs, it sets the market price at its cost + €${MARKET.gasMarkup}</span>` : ''}</div>
        <div class="small dim">Today: ${G.gasMWhToday.toFixed(1)} MWh burned · ${fmtMoney(G.gasCostToday)} cost · fossil-free streak ${G.fossilFreeDays} days</div>
        <button id="decomgas" class="big" style="margin-top:5px">🌱 Decommission — collect ${fmtMoney(CARBON.exitGrant)} exit grant</button>
        <div class="small dim">Irreversible: no fossil backstop afterwards — deficits your storage can't cover become blackouts.</div>`;
    }
    if (s.type === 'efuel') {
      const reserve = h2Reserve();
      const above = h2Sellable();
      html += `<div class="small" style="margin-top:4px">Selling <b>${(G.h2OfftakeMW || 0).toFixed(1)} / ${G.offtakeCapMW.toFixed(1)} MW</b> @ €${H2OFFTAKE.pricePerMWh}/MWh${above > 0.5 ? '' : ' <span class="warn">— tank at the reserve, sales paused</span>'}</div>
        <div class="small dim">Reserve (never sold): ${reserve.toFixed(0)} MWh · today ${G.h2SoldMWhToday.toFixed(1)} MWh sold · ${fmtMoney(G.h2SoldMWhToday * H2OFFTAKE.pricePerMWh)}</div>`;
    }
    if (s.type === 'interconnector') {
      const event = importEventActive();
      const cap = importCapNow();
      const price = importPriceNow();
      html += `<div class="small" style="margin-top:4px">Importing <b>${(G.supply.import || 0).toFixed(1)} / ${cap.toFixed(1)} MW</b> @ €${price}/MWh${event ? ' <span class="bad">— region-wide event, link throttled!</span>' : ''}</div>
        <div class="small dim">Today: ${G.importMWhToday.toFixed(1)} MWh imported · ${fmtMoney(G.importCostToday)} bill · +${(INTERCONNECT.co2PerMWh * G.importMWhToday).toFixed(1)} t CO₂ (neighbour mix)</div>`;
    }
  } else if (s.kind === 'station') {
    const parts = [];
    if ((s.stype === 'bus' || s.stype === 'train') && s.pax) {
      if (s.pax.local >= 1) parts.push(`${Math.round(s.pax.local)} travelling within ${s.paxHome ? s.paxHome.name : 'town'}`);
      for (const [name, n] of Object.entries(s.pax.inter)) if (n >= 1) parts.push(`${Math.round(n)} → ${name}`);
    }
    if (s.stype !== 'bus') {
      for (const [c, a] of Object.entries(s.cargo)) if (c !== 'pax' && a > 0.5) parts.push(`${CARGO[c].name}: ${a.toFixed(0)}`);
    }
    const carg = parts.join(' · ') || 'nothing waiting';
    html = `<b>${s.def.icon} ${s.name || s.def.name}</b><div class="small">Waiting: ${carg}</div>
      ${s.stype === 'bus' ? '<div class="small dim">Buses only board passengers their route can deliver — local trips need a 2nd stop ≥5 tiles away in the same city; intercity trips need a stop at the destination. Press V for the demand overlay.</div>' : ''}
      ${s.stype === 'train' ? '<div class="small dim">Serves passengers AND freight in radius 7. Trains only board what their wagons can carry and their route can deliver.</div>' : ''}
      <div class="small dim">${G.routeEdit ? (G.routeEdit.stops.includes(s) ? 'Click again to remove from ' + G.routeEdit.name : 'Click to add to ' + G.routeEdit.name) : ''}</div>`;
  } else if (s.kind === 'city') {
    const hp = Math.round(s.happiness * 100);
    const cls = hp >= 70 ? 'good' : hp >= 45 ? 'warn' : 'bad';
    const facts = happinessFactors(s).map(x => {
      if (x.got >= x.max && x.max > 0)
        return `<div class="hfact good">✓ ${x.label} <b>+${x.got}%</b></div>`;
      if (x.got < 0)
        return `<div class="hfact bad">⚠ ${x.label} <b>${x.got}%</b> — ${x.hint}</div>`;
      return `<div class="hfact dim">○ ${x.label} <b>+${x.got}/${x.max}%</b> — ${x.hint}</div>`;
    }).join('');
    html = `<b>🏙 ${s.name}</b><div class="small">Population ${Math.floor(s.pop).toLocaleString()} · Happiness <b class="${cls}">${hp}%</b></div>
      <div class="small" style="margin-top:4px"><b>Happiness factors</b> <span class="dim">(base 35%)</span></div>
      ${facts}
      <div class="small dim" style="margin-top:3px">Happy cities grow — more people, more passengers, more power sales.</div>`;
  }
  el.innerHTML = html + '<div class="small dim" style="margin-top:4px">(click elsewhere to deselect)</div>';
}
