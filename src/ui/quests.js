// Objectives panel (top left): renders active quests with progress bars and
// the 📍 fly-to buttons, and drives sim/quests.js completion checks. Quest
// definitions and completion logic live in src/sim/quests.js.
import { G, emit } from '../sim/state.js';
import { QUESTS, isQuestActive, initQuestState, checkQuests } from '../sim/quests.js';

const $ = id => document.getElementById(id);
let dirty = true, tickTimer = 0;

export function initQuestPanel() {
  initQuestState();
  $('quests').innerHTML = '<div id="quest-head">🎯 Objectives <span id="quest-fold">▾</span></div><div id="quest-list"></div>';
  $('quest-head').onclick = () => {
    const l = $('quest-list');
    const open = l.style.display !== 'none';
    l.style.display = open ? 'none' : 'block';
    $('quest-fold').textContent = open ? '▸' : '▾';
  };
  renderQuests();
}

export function updateQuestPanel(dt) {
  tickTimer += dt;
  if (tickTimer < 0.5) return;
  tickTimer = 0;
  const doneBefore = Object.keys(G.questsDone).length;
  checkQuests();
  if (Object.keys(G.questsDone).length !== doneBefore) dirty = true;
  renderQuests();
}

let lastBars = '';
function renderQuests() {
  const active = QUESTS.filter(isQuestActive);
  const doneCount = Object.keys(G.questsDone).length;
  // cheap change detection so we don't rebuild DOM every tick
  const sig = active.map(q => q.id + '|' + Math.min(q.value(), q.target).toFixed(1)).join() + doneCount;
  if (!dirty && sig === lastBars) return;
  lastBars = sig; dirty = false;
  const list = $('quest-list');
  list.innerHTML = active.map(q => {
    const v = Math.min(q.value(), q.target);
    const f = q.fmt || (x => Math.floor(x).toLocaleString());
    const jump = q.where && q.where().length
      ? `<button class="quest-jump" data-q="${q.id}" title="Jump to destination">📍</button>` : '';
    return `<div class="quest" data-q="${q.id}">
      <div class="quest-title">${q.title} <span class="quest-spacer"></span>${jump}<span class="quest-reward">€${(q.reward / 1000).toFixed(0)}k</span></div>
      <div class="quest-desc small dim">${q.desc}</div>
      <div class="quest-prog"><div style="width:${(v / q.target * 100).toFixed(1)}%"></div></div>
      <div class="quest-nums small">${f(v)} / ${f(q.target)}</div>
    </div>`;
  }).join('') +
    (doneCount ? `<div class="small dim" style="margin-top:4px">✅ ${doneCount} of ${QUESTS.length} completed</div>` : '');
  // click a quest to expand/collapse its description
  list.querySelectorAll('.quest').forEach(el => {
    el.onclick = () => el.classList.toggle('open');
  });
  // 📍 flies the camera to the quest's destination; repeated clicks cycle
  // through multiple destinations (e.g. farm → food plant)
  list.querySelectorAll('.quest-jump').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const q = QUESTS.find(x => x.id === b.dataset.q);
      const targets = q.where();
      if (!targets.length) return;
      jumpIx[q.id] = ((jumpIx[q.id] ?? -1) + 1) % targets.length;
      const t = targets[jumpIx[q.id]];
      emit('flyTo', t);
      b.title = `Jump to: ${t.name}${targets.length > 1 ? ' (click again for next)' : ''}`;
    };
  });
}
const jumpIx = {};
