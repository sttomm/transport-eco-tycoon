// ---------- toolbar (WP-B: compact two-layer build menu) ----------
// Layer 1 is a compact bar: one button per category + any standalone
// utility tools (bulldoze). Layer 2 is a flyout panel, opened by clicking a
// category button, that shows that category's building buttons — same
// icon/name/cost/lock info the old flat toolbar always showed.
import { G, fmtMoney } from '../../sim/state.js';
import { BUILDINGS } from '../../sim/data.js';
import { isUnlocked, unlockHint } from '../../sim/grid.js';
import { $, showTooltip, hideTooltip } from './dom.js';
import { showTipText } from './toasts.js';

// Category label/icon in ONE place. Every `category` value used in
// data.js MUST have an entry here — buildToolbar() below derives the actual
// list of categories (and their button order) straight from BUILDINGS, so a
// new category can never silently drop its buildings from the palette, but
// an unlabelled one falls back to a generic icon and warns in the console
// (add the missing entry here instead of ignoring the warning).
const CAT_META = {
  transport: { label: 'Transport', icon: '🚆' },
  energy: { label: 'Generation', icon: '⚡' },
  storage: { label: 'Storage', icon: '🔋' },
};
// Utility tools that stay on the compact bar itself rather than being tucked
// behind a category flyout (today: just the bulldozer).
const STANDALONE = new Set(['bulldoze']);

let openCat = null; // dataset.cat of the currently open flyout, or null

export function buildToolbar() {
  const bar = $('toolbar');
  bar.innerHTML = '';

  // categories, in first-seen order from data.js — nothing hardcoded here
  const cats = [];
  for (const [id, def] of Object.entries(BUILDINGS)) {
    if (def.legacy || STANDALONE.has(id)) continue;
    if (!cats.includes(def.category)) cats.push(def.category);
  }

  const catbar = document.createElement('div');
  catbar.className = 'catbar';
  bar.appendChild(catbar);

  for (const cat of cats) {
    const meta = CAT_META[cat];
    if (!meta) console.warn(`toolbar: category "${cat}" has no CAT_META entry in src/ui/hud/toolbar.js — add one`);
    const label = meta ? meta.label : cat, icon = meta ? meta.icon : '🏗';

    const catBtn = document.createElement('button');
    catBtn.className = 'cat';
    catBtn.dataset.cat = cat;
    catBtn.innerHTML = `<span class="ticon">${icon}</span><span class="tname">${label}</span>`;
    catBtn.onclick = () => toggleFlyout(cat);
    catbar.appendChild(catBtn);

    const flyout = document.createElement('div');
    flyout.className = 'flyout';
    flyout.dataset.flyoutfor = cat;
    flyout.innerHTML = `<div class="toolgroup-label">${label}</div>`;
    const row = document.createElement('div');
    row.className = 'toolrow';
    for (const [id, def] of Object.entries(BUILDINGS)) {
      if (def.category !== cat || def.legacy || STANDALONE.has(id)) continue;
      row.appendChild(makeToolButton(id, def));
    }
    flyout.appendChild(row);
    bar.appendChild(flyout);
  }

  // standalone utility tools live directly on the compact bar, after the categories
  for (const [id, def] of Object.entries(BUILDINGS)) {
    if (STANDALONE.has(id)) catbar.appendChild(makeToolButton(id, def));
  }

  // close the open flyout on an outside click or Escape; only one open at a time
  document.addEventListener('click', e => { if (openCat && !bar.contains(e.target)) closeFlyout(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && openCat) closeFlyout(); });

  updateToolbarLocks();
}

function makeToolButton(id, def) {
  const b = document.createElement('button');
  b.className = 'tool';
  b.dataset.tool = id;
  b.innerHTML = `<span class="ticon">${def.icon}</span><span class="tname">${def.name}</span><span class="tcost">${def.cost ? fmtMoney(def.cost) : ''}</span>`;
  b.onclick = () => {
    if (!isUnlocked(id)) { showTipText(`🔒 ${def.name} — not available yet`, unlockHint(id)); return; }
    selectTool(G.tool === id ? null : id);
    closeFlyout();
  };
  b.onmouseenter = e => showTooltip(e, `<b>${def.name}</b> ${def.cost ? '— ' + fmtMoney(def.cost) : ''}${def.upkeep ? ` (+${def.upkeep}/day)` : ''}<br>${def.desc}` +
    (isUnlocked(id) ? '' : `<br><span class="warn">🔒 ${unlockHint(id)}</span>`));
  b.onmouseleave = hideTooltip;
  return b;
}

function toggleFlyout(cat) {
  openCat = openCat === cat ? null : cat;
  document.querySelectorAll('.flyout').forEach(f => f.classList.toggle('open', f.dataset.flyoutfor === openCat));
  document.querySelectorAll('.cat').forEach(b => b.classList.toggle('open', b.dataset.cat === openCat));
}
function closeFlyout() {
  openCat = null;
  document.querySelectorAll('.flyout').forEach(f => f.classList.remove('open'));
  document.querySelectorAll('.cat').forEach(b => b.classList.remove('open'));
}

// ---------- build-palette unlocks (ADR 28) ----------
// lock state is derived each UI tick; a lock→unlock transition during play
// gets a one-shot celebration toast (module state — a loaded save that is
// already past a milestone starts unlocked without fanfare). Building buttons
// stay in the DOM (inside their flyout, hidden via CSS) even when their
// flyout is closed, so this querySelector keeps working and the toast still
// fires exactly once no matter which flyout is open.
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
  syncCatGlowHints();
}

// A tutorial step can point '.tut-glow' at a building button (e.g.
// '.tool[data-tool="solar"]', see src/ui/tutorial.js) that's currently
// hidden inside an unopened flyout. Mirror the glow onto that flyout's
// category button so the pulse stays visible until the player opens it.
function syncCatGlowHints() {
  document.querySelectorAll('.flyout').forEach(f => {
    const hasGlow = !f.classList.contains('open') && !!f.querySelector('.tut-glow');
    const catBtn = document.querySelector(`.cat[data-cat="${f.dataset.flyoutfor}"]`);
    if (catBtn) catBtn.classList.toggle('cat-glow', hasGlow);
  });
}

export function selectTool(id) {
  G.tool = id;
  G.routeEdit = null;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
  // category button shows when the selected tool lives in its flyout
  // (standalone tools like bulldoze don't belong to any flyout, even though
  // they still carry a `category` in data.js for other purposes)
  const activeCat = (id && !STANDALONE.has(id) && BUILDINGS[id]) ? BUILDINGS[id].category : null;
  document.querySelectorAll('.cat').forEach(b => b.classList.toggle('active-cat', b.dataset.cat === activeCat));
  $('toolhint').textContent = id
    ? (BUILDINGS[id].drag ? `Click & drag to build ${BUILDINGS[id].name.toLowerCase()}. ESC to cancel.` : `Click the map to place ${BUILDINGS[id].name}. ESC to cancel.`)
    : '';
  // picking (or clearing) a tool is the natural moment to dismiss the narrow-
  // viewport bottom sheet — no-op on desktop, where the class is never set
  $('toolbar').classList.remove('sheet-open');
}
