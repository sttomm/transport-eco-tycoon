// Shared DOM helpers for the HUD panel modules: the `$` id lookup, the hover
// tooltip and the speed control. setSpeed lives here (not in hud.js) so the
// welcome screen can use it without importing the coordinator — keeps the
// module graph acyclic.
import { G } from '../../sim/state.js';

export const $ = id => document.getElementById(id);

export function setSpeed(s) {
  if (s !== 0) G._lastSpeed = s;
  G.speed = s;
  document.querySelectorAll('#speeds button').forEach(b => b.classList.toggle('on', +b.dataset.s === s));
}

// ---------- tooltip ----------
export function showTooltip(e, html) {
  const t = $('tooltip');
  t.innerHTML = html;
  t.style.display = 'block';
  const r = e.currentTarget.getBoundingClientRect();
  t.style.left = Math.min(window.innerWidth - 320, r.left) + 'px';
  // flip below for elements near the top of the screen (topbar)
  if (r.top < window.innerHeight / 2) { t.style.top = (r.bottom + 8) + 'px'; t.style.bottom = 'auto'; }
  else { t.style.bottom = (window.innerHeight - r.top + 8) + 'px'; t.style.top = 'auto'; }
}
export function hideTooltip() { $('tooltip').style.display = 'none'; }
// tooltip whose content is computed live on hover
export function liveTip(el, fn) {
  if (!el) return;
  el.onmouseenter = e => showTooltip(e, fn());
  el.onmouseleave = hideTooltip;
}
