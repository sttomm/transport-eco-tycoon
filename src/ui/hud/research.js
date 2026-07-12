// ---------- research ----------
import { G, fmtMoney } from '../../sim/state.js';
import { TECHS } from '../../sim/data.js';
import { startResearch } from '../../sim/research.js';
import { $ } from './dom.js';
import { showTipText } from './toasts.js';

export function renderResearch() {
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
export function renderResearchLive() {
  if (!G.research) return;
  const bar = document.getElementById('prog-' + G.research.id);
  if (bar) bar.style.width = (G.research.progress * 100).toFixed(0) + '%';
  else renderResearch();
}
