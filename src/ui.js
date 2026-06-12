import { G, on, fmtMoney, fmtTime, spend } from './state.js';
import { BUILDINGS, VEHICLES, TECHS, TIPS, LEARN, CARGO } from './data.js';
import { createRoute, buyVehicle, sellVehicle } from './transport.js';

const $ = id => document.getElementById(id);
let activeTab = null;

export function initUI() {
  buildToolbar();
  buildTabs();
  on('tip', showTip);
  on('plantBuilt', p => {
    const map = { solar: 'firstSolar', wind: 'firstWind', battery: 'firstBattery', electrolyzer: 'firstElectrolyzer', fuelcell: 'firstFuelcell' };
    if (map[p.type]) showTip(map[p.type]);
  });
  on('stationBuilt', st => { if (st.stype === 'bus') showTip('firstBusStop'); });
  setTimeout(() => showTip('welcome'), 800);

  $('speeds').addEventListener('click', e => {
    const s = e.target.dataset.s;
    if (s !== undefined) setSpeed(+s);
  });
  $('demandbtn').onclick = toggleDemand;
  document.addEventListener('keydown', e => {
    if (e.key === ' ') { setSpeed(G.speed === 0 ? (G._lastSpeed || 1) : 0); e.preventDefault(); }
    if (e.key === '1') setSpeed(1);
    if (e.key === '2') setSpeed(3);
    if (e.key === '3') setSpeed(10);
    if (e.key === 'v' || e.key === 'V') toggleDemand();
    if (e.key === 'Escape') selectTool(null);
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
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.tool = id;
      b.innerHTML = `<span class="ticon">${def.icon}</span><span class="tname">${def.name}</span><span class="tcost">${def.cost ? fmtMoney(def.cost) : ''}</span>`;
      b.onclick = () => selectTool(G.tool === id ? null : id);
      b.onmouseenter = e => showTooltip(e, `<b>${def.name}</b> ${def.cost ? '— ' + fmtMoney(def.cost) : ''}${def.upkeep ? ` (+${def.upkeep}/day)` : ''}<br>${def.desc}`);
      b.onmouseleave = hideTooltip;
      row.appendChild(b);
    }
    grp.appendChild(row);
    bar.appendChild(grp);
  }
}

export function selectTool(id) {
  G.tool = id;
  G.routeEdit = null;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
  $('toolhint').textContent = id
    ? (id === 'road' ? 'Click & drag to build road. ESC to cancel.' : `Click the map to place ${BUILDINGS[id].name}. ESC to cancel.`)
    : '';
}

// ---------- tooltip ----------
function showTooltip(e, html) {
  const t = $('tooltip');
  t.innerHTML = html;
  t.style.display = 'block';
  const r = e.target.getBoundingClientRect();
  t.style.left = Math.min(window.innerWidth - 320, r.left) + 'px';
  t.style.bottom = (window.innerHeight - r.top + 8) + 'px';
}
function hideTooltip() { $('tooltip').style.display = 'none'; }

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

// ---------- side panel tabs ----------
function buildTabs() {
  document.querySelectorAll('#tabbtns button').forEach(b => {
    b.onclick = () => {
      const tab = b.dataset.tab;
      activeTab = activeTab === tab ? null : tab;
      document.querySelectorAll('#tabbtns button').forEach(x => x.classList.toggle('on', x.dataset.tab === activeTab));
      $('sidepanel').style.display = activeTab ? 'flex' : 'none';
      document.querySelectorAll('.tabpage').forEach(p => p.style.display = p.id === 'tab-' + activeTab ? 'block' : 'none');
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
    const totalSup = sup.solar + sup.wind + sup.hydro + sup.battery + sup.fuelcell;
    const totalDem = dem.city + dem.industry + dem.charging;
    const grid = $('gridstat');
    grid.innerHTML = `⚡ ${totalSup.toFixed(1)} / ${totalDem.toFixed(1)} MW`;
    grid.className = G.blackout ? 'bad blink' : (G.curtailedMW > 0.5 ? 'warn' : 'good');
    grid.title = G.blackout ? 'BLACKOUT — demand unserved!' : G.curtailedMW > 0.5 ? `Curtailing ${G.curtailedMW.toFixed(1)} MW` : 'Grid stable';
    $('weather').innerHTML =
      `${G.cloud > 0.6 ? '☁️' : G.cloud > 0.3 ? '🌤' : '☀️'} ${(100 - G.cloud * 100).toFixed(0)}%` +
      ` &nbsp; 🌬 ${(G.wind * 90).toFixed(0)} km/h` +
      (G.dunkelflaute > 0 ? ' <span class="bad blink">DUNKELFLAUTE</span>' : '');
    const pop = Math.floor(G.cities.reduce((a, c) => a + c.pop, 0));
    $('pop').textContent = `👥 ${pop.toLocaleString()}`;
    $('co2').textContent = `🌍 ${G.co2SavedTons.toFixed(0)} t CO₂ avoided`;
    // storage minis
    $('storemini').innerHTML =
      `🔋 ${pct(G.batteryMWh, G.batteryCapMWh)} <span class="dim">${G.batteryMWh.toFixed(0)}/${G.batteryCapMWh.toFixed(0)} MWh</span>` +
      ` &nbsp; 🫧 ${pct(G.h2MWh, G.h2CapMWh)} <span class="dim">${G.h2MWh.toFixed(0)}/${G.h2CapMWh.toFixed(0)} MWh</span>`;
    renderInfobox();
    if (activeTab === 'routes') renderRoutesLive();
    if (activeTab === 'research') renderResearchLive();
    // rich-grid teaching moment
    if (G.incomeEnergyToday > 12000 && G.incomeEnergyToday > G.incomeTransportToday) showTip('richGrid');
  }
  chartTimer += dt;
  if (chartTimer > 0.6 && activeTab === 'dashboard') {
    chartTimer = 0;
    drawPowerChart();
    drawFinance();
  }
}
const pct = (v, c) => c > 0 ? Math.round(v / c * 100) + '%' : '—';

// ---------- dashboard charts ----------
const SERIES = [
  ['solar', '#f5c542', 'Solar'], ['wind', '#5fd4d0', 'Wind'], ['hydro', '#4a90d9', 'Hydro'],
  ['battery', '#7ed87e', 'Battery'], ['fuelcell', '#c08ae0', 'Fuel cell'],
];
function drawPowerChart() {
  const cv = $('powerchart'); const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const hist = G.history;
  if (hist.length < 2) { ctx.fillStyle = '#999'; ctx.fillText('Collecting data…', 10, 20); return; }
  let maxY = 4;
  for (const s of hist) maxY = Math.max(maxY, s.solar + s.wind + s.hydro + s.battery + s.fuelcell, s.demandTotal + s.elec);
  maxY *= 1.15;
  const x = i => i / (G.histMax - 1) * W;
  const y = v => H - v / maxY * H;
  // night shading
  ctx.fillStyle = 'rgba(40,50,90,0.25)';
  hist.forEach((s, i) => {
    const h = (s.t / 60) % 24;
    if (h < 5.5 || h > 18.5) ctx.fillRect(x(i), 0, W / G.histMax + 1, H);
  });
  // stacked areas
  let base = hist.map(() => 0);
  for (const [key, color] of SERIES) {
    ctx.beginPath();
    hist.forEach((s, i) => { const v = base[i] + s[key]; i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(0), y(v)); });
    for (let i = hist.length - 1; i >= 0; i--) ctx.lineTo(x(i), y(base[i]));
    ctx.closePath();
    ctx.fillStyle = color + 'cc';
    ctx.fill();
    base = base.map((b, i) => b + hist[i][key]);
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
  // labels
  ctx.fillStyle = '#ccc'; ctx.font = '10px sans-serif';
  ctx.fillText(maxY.toFixed(0) + ' MW', 4, 10);
  // legend
  const lg = $('chartlegend');
  if (!lg.dataset.done) {
    lg.dataset.done = 1;
    lg.innerHTML = SERIES.map(([k, c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join('') +
      '<span><i style="background:#fff"></i>Demand</span><span><i style="background:#3fae9c"></i>+Electrolyzer</span><span><i style="background:#ff5555"></i>Unserved</span>';
  }
  // storage bars
  drawBar($('battbar'), G.batteryCapMWh ? G.batteryMWh / G.batteryCapMWh : 0, '#7ed87e',
    `Battery ${G.batteryMWh.toFixed(1)} / ${G.batteryCapMWh.toFixed(0)} MWh`);
  drawBar($('h2bar'), G.h2CapMWh ? G.h2MWh / G.h2CapMWh : 0, '#c08ae0',
    `Hydrogen ${G.h2MWh.toFixed(0)} / ${G.h2CapMWh.toFixed(0)} MWh (≈${(G.h2MWh / 33.3).toFixed(1)} t H₂)`);
  // KPIs
  const sup = G.supply;
  const ren = sup.solar + sup.wind + sup.hydro;
  const tot = ren + sup.battery + sup.fuelcell;
  $('kpis').innerHTML =
    kpi('Renewable share', tot > 0 ? Math.round(ren / tot * 100) + '%' : '—') +
    kpi('Curtailed today', G.curtailedTodayMWh.toFixed(1) + ' MWh') +
    kpi('Grid served', Math.round(G.servedFraction * 100) + '%') +
    kpi('H₂ round trip', Math.round(G.mult.elecEff * G.mult.fcEff * 100) + '%') +
    kpi('Battery round trip', '92%') +
    kpi('Power price', '€85/MWh');
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
  $('finrows').innerHTML =
    finrow('Transport income (today)', G.incomeTransportToday, 'good') +
    finrow('Energy sales (today)', G.incomeEnergyToday, 'good') +
    finrow('Expenses (today)', -G.expensesToday, 'bad');
}
const finrow = (n, v, cls) => `<div class="finrow"><span>${n}</span><span class="${cls}">${fmtMoney(v)}</span></div>`;

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
      if (G.research) { showTipText('Lab busy', 'Your researchers are already working on ' + TECHS.find(x => x.id === G.research.id).name + '.'); return; }
      if (!spend(t.cost)) { showTipText('Too expensive', 'Not enough funds for this project.'); return; }
      G.research = { id: t.id, progress: 0, days: t.days };
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
export function showTipText(title, text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="toast-head">💡 ${title}<span class="toast-x">✕</span></div><div class="toast-body">${text}</div>`;
  el.querySelector('.toast-x').onclick = () => el.remove();
  $('advisor').appendChild(el);
  setTimeout(() => el.remove(), 9000);
}

// research progression, called daily-ish from main loop
export function tickResearch(gameHours) {
  if (!G.research) return;
  G.research.progress += gameHours / (G.research.days * 24);
  if (G.research.progress >= 1) {
    const t = TECHS.find(x => x.id === G.research.id);
    t.fx(G.mult);
    G.techs[t.id] = true;
    G.research = null;
    showTipText('Research complete!', `${t.name} — ${t.desc}`);
    if (activeTab === 'research') renderResearch();
  }
}

// ---------- routes ----------
export function renderRoutes() {
  const el = $('tab-routes');
  el.innerHTML = `<h3>🚌 Routes</h3>
    <div class="dim small">1. Build stations near industries/cities (toolbar). 2. Create a route, click stations on the map to add stops. 3. Buy vehicles.</div>
    <button id="newroute" class="big">+ New Route</button><div id="routelist"></div>`;
  el.querySelector('#newroute').onclick = () => {
    if (!G.stations.length) { showTipText('No stations yet', 'Place a Freight Depot or Bus Stop next to a road first.'); return; }
    const r = createRoute();
    G.routeEdit = r;
    G.tool = null;
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('on'));
    renderRoutes();
  };
  const list = el.querySelector('#routelist');
  for (const r of G.routes) {
    const d = document.createElement('div');
    d.className = 'route' + (G.routeEdit === r ? ' editing' : '');
    const stops = r.stops.map(s => s.name || s.def.name).join(' → ') || '<i class="dim">click stations on the map…</i>';
    d.innerHTML = `<div class="route-head"><b>${r.name}</b>
        ${G.routeEdit === r ? '<button data-a="done">✔ Done</button>' : '<button data-a="edit">✎</button>'}
        <button data-a="del">🗑</button></div>
      <div class="small">${stops}</div>
      <div class="route-veh">
        <button data-a="truck">+ ${VEHICLES.truck.icon} ${fmtMoney(VEHICLES.truck.cost)}</button>
        <button data-a="bus">+ ${VEHICLES.bus.icon} ${fmtMoney(VEHICLES.bus.cost)}</button>
      </div><div class="vehlist" data-r="${r.id}"></div>`;
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
    for (const kind of ['truck', 'bus']) {
      d.querySelector(`[data-a=${kind}]`).onclick = () => {
        if (r.stops.length < 2) { showTipText('Route too short', 'Add at least 2 stops first (click ✎, then click stations on the map).'); return; }
        if (!spend(VEHICLES[kind].cost)) { showTipText('Too expensive', 'Not enough funds.'); return; }
        const v = buyVehicle(r, kind);
        if (!v) { G.money += VEHICLES[kind].cost; showTipText('No road access', 'The first stop has no adjacent road.'); }
        renderRoutes();
      };
    }
    list.appendChild(d);
  }
  renderRoutesLive();
}
function renderRoutesLive() {
  for (const r of G.routes) {
    const el = document.querySelector(`.vehlist[data-r="${r.id}"]`);
    if (!el) continue;
    el.innerHTML = r.vehicles.map(v => {
      let carg;
      if (v.kind === 'bus') {
        const groups = (v.pax || []).filter(g => g.n >= 1);
        carg = groups.length
          ? `👥 ${groups.reduce((a, g) => a + g.n, 0)} (${groups.map(g => g.type === 'local' ? `${g.n} in ${g.from.name}` : `${g.n} → ${g.dest.name}`).join(', ')})`
          : 'empty';
      } else {
        carg = Object.entries(v.cargo).filter(([, a]) => a > 0).map(([c, a]) => `${CARGO[c].name} ${a.toFixed(0)}`).join(', ') || 'empty';
      }
      const st = v.state === 'stranded' ? (v.noRoute ? '⚠️ no road connection!' : '🪫 stranded!') : v.state === 'loading' ? (v.charging ? '⚡charging' : 'loading') : '▶';
      return `<div class="veh small">${v.def.icon} ${st} · 🔋${Math.round(v.battery / v.def.batteryKWh * 100)}% · ${carg}</div>`;
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
  } else if (s.kind === 'station') {
    let carg;
    if (s.stype === 'bus' && s.pax) {
      const parts = [];
      if (s.pax.local >= 1) parts.push(`${Math.round(s.pax.local)} travelling within ${s.paxHome ? s.paxHome.name : 'town'}`);
      for (const [name, n] of Object.entries(s.pax.inter)) if (n >= 1) parts.push(`${Math.round(n)} → ${name}`);
      carg = parts.join(' · ') || 'nobody waiting';
    } else {
      carg = Object.entries(s.cargo).filter(([, a]) => a > 0.5).map(([c, a]) => `${CARGO[c].name}: ${a.toFixed(0)}`).join(' · ') || 'nothing waiting';
    }
    html = `<b>${s.def.icon} ${s.name || s.def.name}</b><div class="small">Waiting: ${carg}</div>
      ${s.stype === 'bus' ? '<div class="small dim">Buses only board passengers their route can deliver — local trips need a 2nd stop ≥5 tiles away in the same city; intercity trips need a stop at the destination. Press V for the demand overlay.</div>' : ''}
      <div class="small dim">${G.routeEdit ? 'Click to add to ' + G.routeEdit.name : ''}</div>`;
  } else if (s.kind === 'city') {
    html = `<b>🏙 ${s.name}</b><div class="small">Population ${Math.floor(s.pop).toLocaleString()} · Happiness ${(s.happiness * 100).toFixed(0)}%</div>
      <div class="small dim">Cities grow with reliable power, food, goods & bus service. They pay you for every MWh.</div>`;
  }
  el.innerHTML = html + '<div class="small dim" style="margin-top:4px">(click elsewhere to deselect)</div>';
}
