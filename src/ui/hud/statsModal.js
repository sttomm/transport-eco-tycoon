// Statistics & finance modal (WP3). Opened from the 📈 topbar button and the
// money-hover "more…" link; uses the shared modal helper (pauses the sim while
// open — the tabs are a snapshot, no live timer needed). Four tabs:
//   Dashboard — headline KPIs + top problems
//   Finance   — income/expense trees from the ledger + a 28-day stacked bar
//               chart (LEDGER_CATS colors) with an "include investments" toggle
//   Energy    — the dashboard power chart, relocated here
//   Cities    — per-city table (pop, happiness + factor breakdown, pax, supply)
// Reads G + sim/finance selectors; never contains game rules.
import { G, fmtMoney } from '../../sim/state.js';
import { LEDGER_CATS } from '../../sim/data.js';
import { ledgerNets, ledgerTotals } from '../../sim/finance.js';
import { happinessFactors } from '../../sim/cities.js';
import { $, liveTip } from './dom.js';
import { openModal } from './modal.js';
import { drawPowerChartOn } from './dashboard.js';

let currentTab = 'dashboard';
let bodyEl = null;
let includeInvest = true;

export function initStats() {
  const b = $('statsbtn');
  if (b) b.onclick = () => openStats('dashboard');
  const m = $('money');
  if (m) {
    m.style.cursor = 'pointer';
    m.title = 'Statistics & finance';
    m.onclick = () => openStats('finance');
    liveTip(m, moneyTip);
  }
}

// money-hover mini-breakdown: top income + top expense categories of the day
// so far + both nets, with a nudge to the full modal (WP3).
function moneyTip() {
  const day = G.ledger.today;
  const inc = [], exp = [];
  for (const [id, def] of Object.entries(LEDGER_CATS)) {
    const v = day[id];
    if (!v || def.balance) continue;
    (v > 0 ? inc : exp).push([id, v]);
  }
  inc.sort((a, b) => b[1] - a[1]);
  exp.sort((a, b) => a[1] - b[1]);
  const { netOperating, netTotal } = ledgerNets(day);
  const row = ([id, v]) => `${LEDGER_CATS[id].icon} ${LEDGER_CATS[id].label}: <b class="${v >= 0 ? 'good' : 'bad'}">${fmtMoney(v)}</b>`;
  const list = arr => arr.slice(0, 4).map(row).join('<br>') || '<span class="dim">—</span>';
  return `<b>💰 Today so far</b><br>
    <span class="dim small">Income</span><br>${list(inc)}<br>
    <span class="dim small">Expenses</span><br>${list(exp)}<br>
    <b class="${netOperating >= 0 ? 'good' : 'bad'}">Net op ${fmtMoney(netOperating)}</b>
    · Net total ${fmtMoney(netTotal)}<br>
    <span class="dim small">Click for full statistics →</span>`;
}

const TABS = [
  ['dashboard', '📊 Overview'], ['finance', '💰 Finance'],
  ['energy', '⚡ Energy'], ['cities', '🏙 Cities'],
];

export function openStats(tab = 'dashboard') {
  currentTab = tab;
  const body = document.createElement('div');
  body.className = 'statsmodal';
  body.innerHTML = `<div class="statstabs"></div><div class="statscontent"></div>`;
  const handle = openModal({ title: '📈 Statistics', body, wide: true, id: 'statsmodal' });
  bodyEl = body;
  body.querySelector('.statstabs').innerHTML = TABS
    .map(([id, label]) => `<button data-t="${id}" class="${id === currentTab ? 'on' : ''}">${label}</button>`).join('');
  body.querySelector('.statstabs').addEventListener('click', e => {
    const id = e.target.dataset.t;
    if (!id) return;
    currentTab = id;
    body.querySelectorAll('.statstabs button').forEach(x => x.classList.toggle('on', x.dataset.t === id));
    renderTab();
  });
  renderTab();
  return handle;
}

function renderTab() {
  const c = bodyEl && bodyEl.querySelector('.statscontent');
  if (!c) return;
  if (currentTab === 'dashboard') renderDashboard(c);
  else if (currentTab === 'finance') renderFinance(c);
  else if (currentTab === 'energy') renderEnergy(c);
  else if (currentTab === 'cities') renderCities(c);
}

const kpi = (n, v) => `<div class="kpi"><div class="kpi-v">${v}</div><div class="kpi-n">${n}</div></div>`;

// ---------- Overview ----------
function renderDashboard(c) {
  const { netOperating } = ledgerNets(G.ledger.today);
  const happ = G.cities.map(x => x.happiness);
  const hMin = happ.length ? Math.min(...happ) : 0;
  const hAvg = happ.length ? happ.reduce((a, b) => a + b, 0) / happ.length : 0;
  c.innerHTML = `<div class="statskpis">
      ${kpi('Company funds', fmtMoney(G.money))}
      ${kpi('Net operating today', `<span class="${netOperating >= 0 ? 'good' : 'bad'}">${fmtMoney(netOperating)}</span>`)}
      ${kpi('Happiness (min / avg)', `${Math.round(hMin * 100)}% / ${Math.round(hAvg * 100)}%`)}
      ${kpi('CO₂ avoided', `<span class="good">${G.co2SavedTons.toFixed(0)} t</span>`)}
      ${kpi('Fossil-free streak', `${G.fossilFreeDays} day${G.fossilFreeDays === 1 ? '' : 's'}`)}
      ${kpi('Loan', G.loan > 0 ? `<span class="bad">${fmtMoney(G.loan)}</span>` : '<span class="dim">none</span>')}
    </div>
    <h3>Top issues</h3>${problemsHtml()}`;
}

// lightweight problem scan — the same signals the daily report will use (WP2)
function problemsHtml() {
  const out = [];
  for (const c of G.cities) {
    if (c.happiness < 0.55) {
      const worst = happinessFactors(c).filter(f => f.got < f.max)
        .sort((a, b) => (a.got - a.max) - (b.got - b.max))[0];
      out.push({ sev: 1 - c.happiness, icon: '🏙',
        txt: `${c.name} at ${Math.round(c.happiness * 100)}% happiness${worst ? ` — needs: ${worst.label.toLowerCase()}` : ''}` });
    }
  }
  if (G.blackoutHoursToday > 0.05) out.push({ sev: 5, icon: '⚠', txt: `${G.blackoutHoursToday.toFixed(1)} h of blackout today — add generation or storage` });
  if (G.gasMWhToday > 0.5) out.push({ sev: 2, icon: '🔥', txt: `Gas plant burned ${G.gasMWhToday.toFixed(0)} MWh today (${fmtMoney(G.gasCostToday)})` });
  if (G.curtailedTodayMWh > 20) out.push({ sev: 1.5, icon: '♻', txt: `${G.curtailedTodayMWh.toFixed(0)} MWh clean power curtailed — add storage` });
  out.sort((a, b) => b.sev - a.sev);
  if (!out.length) return '<div class="dim" style="padding:8px">🌱 All green — nothing needs attention.</div>';
  return out.slice(0, 3).map(p => `<div class="finrow"><span>${p.icon} ${p.txt}</span></div>`).join('');
}

// ---------- Finance ----------
function catRow(id, amt) {
  const d = LEDGER_CATS[id];
  return `<div class="finrow finsub"><span>${d.icon} ${d.label}</span>
    <span class="${amt >= 0 ? 'good' : 'bad'}">${fmtMoney(amt)}</span></div>`;
}
function treeSection(title, entries, cls) {
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const rows = entries.length ? entries.map(([id, v]) => catRow(id, v)).join('')
    : '<div class="finrow finsub dim">nothing yet today</div>';
  return `<div class="finrow"><span><b>${title}</b></span><span class="${cls}"><b>${fmtMoney(total)}</b></span></div>${rows}`;
}

function renderFinance(c) {
  const day = G.ledger.today;
  const inc = [], opEx = [], invEx = [];
  for (const [id, def] of Object.entries(LEDGER_CATS)) {
    const v = day[id];
    if (!v || def.balance) continue;
    if (def.kind === 'income') inc.push([id, v]);
    else if (def.invest) invEx.push([id, v]);
    else opEx.push([id, v]);
  }
  const bySize = (a, b) => Math.abs(b[1]) - Math.abs(a[1]);
  inc.sort(bySize); opEx.sort(bySize); invEx.sort(bySize);
  const { netOperating, netTotal } = ledgerNets(day);

  c.innerHTML = `<div class="dim small" style="margin-bottom:6px">Today so far — income, operating costs and investments.</div>
    ${treeSection('Income', inc, 'good')}
    ${treeSection('Operating expenses', opEx, 'bad')}
    ${treeSection('Investments (capex)', invEx, 'bad')}
    <div class="finrow" style="margin-top:6px"><span><b>Net operating</b> <span class="dim small">(excl. investments)</span></span>
      <span class="${netOperating >= 0 ? 'good' : 'bad'}"><b>${fmtMoney(netOperating)}</b></span></div>
    <div class="finrow"><span><b>Net total</b></span>
      <span class="${netTotal >= 0 ? 'good' : 'bad'}"><b>${fmtMoney(netTotal)}</b></span></div>
    <h3 style="margin-top:10px">Last ${G.ledger.days.length + 1} days
      <label class="statstoggle small"><input type="checkbox" id="statsinv" ${includeInvest ? 'checked' : ''}> include investments</label></h3>
    <canvas id="ledgerbars" class="chart" width="772" height="150"></canvas>
    <div id="ledgerlegend" class="statslegend"></div>`;

  const cb = c.querySelector('#statsinv');
  cb.onchange = () => { includeInvest = cb.checked; drawLedgerBars(c.querySelector('#ledgerbars')); renderLedgerLegend(c.querySelector('#ledgerlegend')); };
  drawLedgerBars(c.querySelector('#ledgerbars'));
  renderLedgerLegend(c.querySelector('#ledgerlegend'));
}

// per-day stacked bars: income up from the zero line, expenses down, one
// coloured segment per LEDGER_CATS category (dashboard.js drawing style).
function drawLedgerBars(cv) {
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const days = [...G.ledger.days, G.ledger.today];
  const cats = Object.entries(LEDGER_CATS).filter(([, d]) => !d.balance && !(d.invest && !includeInvest));
  let maxUp = 1, maxDn = 1;
  for (const d of days) {
    let up = 0, dn = 0;
    for (const [id] of cats) { const v = d[id] || 0; if (v > 0) up += v; else dn -= v; }
    maxUp = Math.max(maxUp, up); maxDn = Math.max(maxDn, dn);
  }
  const range = maxUp + maxDn;
  const zeroY = (maxUp / range) * H;
  const s = H / range;
  const bw = W / days.length;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(W, zeroY); ctx.stroke();
  days.forEach((d, i) => {
    const x = i * bw + 1, w = Math.max(1, bw - 2);
    let up = zeroY, dn = zeroY;
    for (const [id, def] of cats) {
      const v = d[id] || 0;
      if (v > 0) { const h = v * s; up -= h; ctx.fillStyle = def.color; ctx.fillRect(x, up, w, h); }
      else if (v < 0) { const h = -v * s; ctx.fillStyle = def.color; ctx.fillRect(x, dn, w, h); dn += h; }
    }
  });
  ctx.fillStyle = '#ccc'; ctx.font = '10px sans-serif';
  ctx.fillText('▲ income', 4, 11);
  ctx.fillText('▼ expense', 4, H - 4);
}

function renderLedgerLegend(el) {
  if (!el) return;
  const cats = Object.entries(LEDGER_CATS).filter(([, d]) => !d.balance && !(d.invest && !includeInvest));
  el.innerHTML = cats.map(([, d]) => `<span><i style="background:${d.color}"></i>${d.label}</span>`).join('');
}

// ---------- Energy ----------
function renderEnergy(c) {
  c.innerHTML = `<canvas id="statspower" class="chart" width="772" height="240"></canvas>
    <div class="statskpis">
      ${kpi('Battery', `${G.batteryMWh.toFixed(0)} / ${G.batteryCapMWh.toFixed(0)} MWh`)}
      ${kpi('Hydrogen', `${G.h2MWh.toFixed(0)} / ${G.h2CapMWh.toFixed(0)} MWh`)}
      ${kpi('Power price', `€${G.price.toFixed(0)}/MWh`)}
      ${kpi('Grid served', `${Math.round(G.servedFraction * 100)}%`)}
      ${kpi('Curtailed today', `${G.curtailedTodayMWh.toFixed(1)} MWh`)}
      ${kpi('Carbon price', `€${G.carbonPrice}/t`)}
    </div>
    <div class="dim small">Live grid (last 48 h): stacked generation, demand line and €/MWh price. Full legend on the 📊 Dashboard tab.</div>`;
  drawPowerChartOn(c.querySelector('#statspower'));
}

// ---------- Cities ----------
function renderCities(c) {
  if (!G.cities.length) { c.innerHTML = '<div class="dim">No cities.</div>'; return; }
  const rows = G.cities.map(city => {
    const waiting = Math.round(city.paxLocal + city.paxTo.reduce((a, b) => a + b, 0));
    const factors = happinessFactors(city);
    const short = factors.filter(f => f.got < f.max).map(f => f.label).slice(0, 2).join(', ') || '—';
    return `<tr>
      <td>${city.name}</td>
      <td>${Math.round(city.pop).toLocaleString()}</td>
      <td class="${city.happiness < 0.5 ? 'bad' : city.happiness < 0.7 ? 'warn' : 'good'}">${Math.round(city.happiness * 100)}%</td>
      <td>${waiting}</td>
      <td>${Math.round(Math.min(1, city.foodLevel || 0) * 100)}% / ${Math.round(Math.min(1, city.goodsLevel || 0) * 100)}%</td>
      <td class="dim small">${short}</td>
    </tr>`;
  }).join('');
  c.innerHTML = `<table class="statstable">
    <thead><tr><th>City</th><th>Pop</th><th>Happy</th><th>Waiting</th><th>Food/Goods</th><th>Needs</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}
