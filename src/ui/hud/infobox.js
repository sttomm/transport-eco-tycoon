// ---------- selection infobox ----------
import { G, fmtMoney } from '../../sim/state.js';
import { CARBON, CARGO, H2OFFTAKE, INTERCONNECT, MARKET } from '../../sim/data.js';
import {
  POWER_PRICE, gasMarginalCost, importEventActive, importCapNow, importPriceNow, h2Reserve, h2Sellable,
} from '../../sim/energy.js';
import { happinessFactors } from '../../sim/cities.js';
import { $ } from './dom.js';

export function renderInfobox() {
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
