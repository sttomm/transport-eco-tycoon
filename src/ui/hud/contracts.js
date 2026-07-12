// ---------- special contracts ----------
import { G, emit, fmtMoney } from '../../sim/state.js';
import { CARGO } from '../../sim/data.js';
import { signContract, contractLabel, contractDest, MAX_ACTIVE, MAX_OFFERS } from '../../sim/contracts.js';
import { $ } from './dom.js';
import { showTipText } from './toasts.js';

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

export function renderContracts() {
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
export function renderContractsLive() {
  const cs = G.contracts;
  const sig = cs.active.map(c => `${c.id}:${Math.floor(c.progress)}:${Math.floor((c.deadline - G.minutes) / 60)}`).join() + '|' +
    cs.offers.map(c => `${c.id}:${Math.floor((c.expires - G.minutes) / 60)}`).join();
  if (sig === lastContractSig) return;
  lastContractSig = sig;
  renderContracts();
}
