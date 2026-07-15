// ---------- topbar / live HUD ----------
import { G, fmtMoney, fmtTime, season, DAYS_PER_SEASON } from '../../sim/state.js';
import { CLIMATE, MARKET } from '../../sim/data.js';
import { solarFactor, POWER_PRICE } from '../../sim/energy.js';
import { $, liveTip } from './dom.js';
import { SERIES } from './dashboard.js';

// supply-source colors, reused from the dashboard power chart so the whole
// game speaks one color language (WP3); demand rows get their own muted tones.
const SUP_COLOR = Object.fromEntries(SERIES.map(([k, c]) => [k, c]));
const DEM_COLOR = { city: '#e8e0d0', industry: '#c08ae0', charging: '#3fae9c' };

// ---------- topbar explainer tooltips ----------
export function initTopbarTooltips() {
  // #money hover + click are wired in ui/hud/statsModal.js (finance breakdown)
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
    const supRows = [['solar', 'Solar'], ['wind', 'Wind'], ['hydro', 'Hydro'], ['battery', 'Battery'], ['fuelcell', 'Fuel cell']];
    if (!G.gasDecommissioned) supRows.push(['gas', 'Gas']);
    if (G.importCapMW > 0) supRows.push(['import', 'Import']);
    const demRows = [['city', 'Cities'], ['industry', 'Industry'], ['charging', 'Charging']];
    const maxV = Math.max(1,
      ...supRows.map(([k]) => sup[k] || 0),
      ...demRows.map(([k]) => dem[k] || 0));
    const bar = (v, color) => `<span class="gbar"><i style="width:${Math.round((v / maxV) * 100)}%;background:${color}"></i></span>`;
    const gRow = (label, v, color) => `<div class="grow"><span class="glbl">${label}</span>${bar(v, color)}<span class="gval">${v.toFixed(1)}</span></div>`;
    const supHtml = supRows.map(([k, label]) => gRow(label, sup[k] || 0, SUP_COLOR[k])).join('');
    const demHtml = demRows.map(([k, label]) => gRow(label, dem[k] || 0, DEM_COLOR[k])).join('');
    return `<b>⚡ Grid — supply / demand (MW)</b>
      <div class="dim small" style="margin:3px 0 1px">Generation now</div>${supHtml}
      <div class="dim small" style="margin:4px 0 1px">Demand now</div>${demHtml}
      <div class="dim small" style="margin-top:4px">Green = stable · yellow = curtailing surplus · red = blackout.</div>`;
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

// the 0.25 s topbar refresh (called from updateUI in hud.js)
export function updateTopbar() {
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
