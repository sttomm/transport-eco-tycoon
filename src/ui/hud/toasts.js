// ---------- advisor toasts ----------
import { G } from '../../sim/state.js';
import { TIPS } from '../../sim/data.js';
import { $ } from './dom.js';

// shared toast DOM: header with dismiss ✕ + body, stacked in the advisor corner
function makeToast(head, body) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="toast-head">${head}<span class="toast-x">✕</span></div><div class="toast-body">${body}</div>`;
  el.querySelector('.toast-x').onclick = () => el.remove();
  $('advisor').appendChild(el);
  return el;
}

// one-shot teaching tip from TIPS (fires once per game via G.firedTips)
export function showTip(id) {
  if (G.firedTips[id] || !TIPS[id]) return;
  G.firedTips[id] = true;
  const tip = TIPS[id];
  const el = makeToast(`💡 ${tip.title}`, tip.text);
  setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 1200); }, 26000);
}

export function showTipText(title, text) {
  const el = makeToast(`💡 ${title}`, text);
  setTimeout(() => el.remove(), 9000);
}
