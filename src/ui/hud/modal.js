// Shared modal helper (D-B). One overlay pattern for the welcome screen, the
// daily report, the news history and the stats modal: a blurred backdrop, an
// optional pause of the sim, and a modal *stack* so Escape closes the top one.
//
// The welcome card (welcome.js) predates this and had the pattern inline:
// overlay `inset:0;z-index:50` + backdrop-blur, pause via `G._lastSpeed =
// G.speed; G.speed = 0`, keybind suppression by DOM presence. All of that now
// lives here. Speed is restored to G._lastSpeed on close (NOT hardcoded 1×),
// honouring the "restore G.speed after playtests" rule.
import { G } from '../../sim/state.js';
import { setSpeed } from './dom.js';

// active modals, oldest first. DOM refs never go in G (sim stays headless).
const stack = [];

export function modalOpen() { return stack.length > 0; }

// register an already-built overlay element into the stack (welcome.js uses
// this to keep its bespoke card markup). Returns a close() handle.
export function registerModal(el, { pause = true, onClose } = {}) {
  const entry = { el, onClose, pause };
  // `G.speed || 1`: if a lower modal already paused us, don't memorise 0
  if (pause) { G._lastSpeed = G.speed || G._lastSpeed || 1; G.speed = 0; }
  stack.push(entry);
  return () => closeEntry(entry);
}

function closeEntry(entry) {
  const ix = stack.indexOf(entry);
  if (ix < 0) return;
  stack.splice(ix, 1);
  entry.el.remove();
  // restore speed only once no pausing modal remains on the stack
  if (entry.pause && !stack.some(e => e.pause)) setSpeed(G._lastSpeed || 1);
  if (entry.onClose) entry.onClose();
}

// close the topmost modal; returns true if one was open (Escape handling)
export function closeTopModal() {
  if (!stack.length) return false;
  closeEntry(stack[stack.length - 1]);
  return true;
}

// build the standard chrome (overlay + card + header ✕ + body) and open it.
// `body` may be an element or an HTML string. Returns { overlay, card, body, close }.
export function openModal({ title = '', body, onClose, pause = true, wide = false, id } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  if (id) overlay.id = id;
  overlay.style.zIndex = 50 + stack.length * 2;

  const card = document.createElement('div');
  card.className = 'modal-card' + (wide ? ' modal-wide' : '');

  const head = document.createElement('div');
  head.className = 'modal-head';
  head.innerHTML = `<span class="modal-title">${title}</span><span class="modal-x" title="Close (Esc)">✕</span>`;

  const bodyEl = document.createElement('div');
  bodyEl.className = 'modal-body';
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  card.appendChild(head);
  card.appendChild(bodyEl);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = registerModal(overlay, { pause, onClose });
  head.querySelector('.modal-x').onclick = close;
  // click the backdrop (not the card) to dismiss
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  return { overlay, card, body: bodyEl, close };
}
