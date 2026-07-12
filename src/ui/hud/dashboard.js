// Dashboard tab: daily report card + "Yesterday" block, weather forecast
// strip, climate box, power/finance canvas charts and the bank loan box.
import { G, fmtMoney, seasonOf } from '../../sim/state.js';
import { CARBON, CLIMATE, H2OFFTAKE, MARKET } from '../../sim/data.js';
import { climateRiskMult, POWER_PRICE } from '../../sim/energy.js';
import { routeColor } from '../../sim/transport.js';
import { takeLoan, repayLoan, LOAN_STEP, LOAN_MAX, LOAN_RATE } from '../../sim/loans.js';
import { $, liveTip } from './dom.js';
import { showTipText } from './toasts.js';

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
export function showDayReport(r) {
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
export function renderYesterday() {
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

// dashboard strip: one cell per 3 h slot of G.forecast (see energy.js)
function slotIcon(sl) {
  if (sl.storm) return '🌪';
  if (sl.flaute) return '🌫';
  if (sl.heat) return '🔥';
  if (sl.night) return '🌙';
  return sl.sun > 0.55 ? '☀️' : sl.sun > 0.25 ? '🌤' : '☁️';
}
const FRONT_LABEL = { dunkelflaute: '🌫 Dunkelflaute', storm: '🌪 Storm', heatwave: '🔥 Heatwave' };
export function renderForecast() {
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
export function renderClimate() {
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
export function drawPowerChart() {
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
export function drawFinance() {
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

// ---------- bank loan (dashboard finances) ----------
export function initLoanBox() {
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
export function updateLoanBox() {
  const s = $('loanstat');
  if (!s) return;
  s.innerHTML = G.loan > 0
    ? `<span class="bad">${fmtMoney(G.loan)}</span> <span class="dim small">−${fmtMoney(G.loan * LOAN_RATE)}/day</span>`
    : '<span class="dim">debt-free</span>';
  $('borrowbtn').disabled = G.loan >= LOAN_MAX;
  $('repaybtn').disabled = G.loan <= 0;
}
