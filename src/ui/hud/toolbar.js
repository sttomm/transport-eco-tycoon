// ---------- toolbar ----------
import { G, fmtMoney } from '../../sim/state.js';
import { BUILDINGS } from '../../sim/data.js';
import { isUnlocked, unlockHint } from '../../sim/grid.js';
import { $, showTooltip, hideTooltip } from './dom.js';
import { showTipText } from './toasts.js';

export function buildToolbar() {
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
export function updateToolbarLocks() {
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
