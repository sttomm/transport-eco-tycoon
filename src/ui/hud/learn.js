// ---------- learn tab ----------
import { LEARN } from '../../sim/data.js';
import { $ } from './dom.js';

export function renderLearn() {
  const el = $('tab-learn');
  if (el.dataset.done) return;
  el.dataset.done = 1;
  el.innerHTML = '<h3>📚 Energy Encyclopedia</h3>' + LEARN.map(([t, b]) =>
    `<details class="learn"><summary>${t}</summary><div class="small">${b}</div></details>`).join('');
}
