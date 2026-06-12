// Quest / objective system: three parallel chains (passengers, freight, energy)
// so the player always has 2-4 concrete goals. Progress is read from G.stats
// counters and live grid state; rewards are cash.
import { G } from './state.js';
import { showTipText } from './ui.js';

const stat = k => () => G.stats[k];
const MWh = v => v.toFixed(0) + ' MWh';

export const QUESTS = [
  // --- passenger chain
  {
    id: 'localLine', title: '🚌 Crosstown traffic', target: 40, reward: 18000,
    desc: 'People want to get across town. Build two bus stops in the SAME city at least 5 tiles apart (e.g. the west and east side), connect them with a route and buy an e-bus. Carry 25 local passengers.',
    value: stat('paxLocal'),
  },
  {
    id: 'interLine', req: 'localLine', title: '🌉 Connect the cities', target: 60, reward: 30000,
    desc: 'Many travellers want to visit ANOTHER city — press V to see who wants to go where. Run a bus route between two cities and carry 40 intercity passengers.',
    value: stat('paxInter'),
  },
  {
    id: 'busBoom', req: 'interLine', title: '🚏 Transit network', target: 400, reward: 45000,
    desc: 'Carry 250 passengers in total. Watch the stop badges in the demand overlay — red means overcrowded, add buses or stops.',
    value: () => G.stats.paxLocal + G.stats.paxInter,
  },
  {
    id: 'happy', req: 'interLine', title: '🏙 Happy region', target: 70, reward: 40000,
    desc: 'Get EVERY city to at least 70% happiness. Reliable power, food deliveries and bus service keep citizens happy — and happy cities grow.',
    value: () => Math.min(...G.cities.map(c => c.happiness)) * 100,
    fmt: v => v.toFixed(0) + '%',
  },
  // --- freight chain
  {
    id: 'grainChain', title: '🌾 Feed the food plant', target: 30, reward: 20000,
    desc: 'The Food Plant is idle without grain. Build a Freight Depot near the Farm and one near the Food Plant, connect them with a road and a truck route. Deliver 30 grain.',
    value: stat('grainToFood'),
  },
  {
    id: 'feedCities', req: 'grainChain', title: '🥫 Food to the people', target: 60, reward: 25000,
    desc: 'Cities buy food at a premium. Add a depot near a city to your food route and deliver 60 food.',
    value: stat('foodToCity'),
  },
  {
    id: 'oreChain', req: 'feedCities', title: '⛏ Green steel supply', target: 60, reward: 35000,
    desc: 'The Steel Works needs iron ore from the mine in the east. You may need a bridge over the river (5× road cost). Deliver 60 ore. Warning: a running steel works is a 13 MW load — grow your grid!',
    value: stat('oreToSteel'),
  },
  {
    id: 'steelCities', req: 'oreChain', title: '🏗 Steel for the build-out', target: 40, reward: 35000,
    desc: 'Deliver 40 green steel to a city — the most valuable cargo in the region.',
    value: stat('steelToCity'),
  },
  {
    id: 'railAge', req: 'grainChain', title: '🚆 The electric railway', target: 120, reward: 50000,
    desc: 'Steel wheels on steel rails move a tonne with ~10× less energy than trucks. Lay track between two Rail Stations, buy a locomotive, add wagons (passenger or freight) and move 120 units by rail. The loco draws ~1 MW live from your grid!',
    value: stat('railUnits'),
  },
  // --- energy chain
  {
    id: 'storagePlay', title: '🔋 Store the sun', target: 40, reward: 25000,
    desc: 'Solar peaks at noon, demand peaks in the evening. Reach 40 MWh of battery capacity to shift the surplus (build batteries or research LFP).',
    value: () => G.batteryCapMWh, fmt: MWh,
  },
  {
    id: 'h2Reserve', req: 'storagePlay', title: '🫧 Hydrogen reserve', target: 80, reward: 40000,
    desc: 'Batteries cover hours, not weeks. Build an Electrolyzer and an H₂ tank, then stockpile 80 MWh of hydrogen for the next Dunkelflaute.',
    value: () => G.h2MWh, fmt: MWh,
  },
  {
    id: 'researchOne', req: 'storagePlay', title: '🔬 Fund the lab', target: 1, reward: 20000,
    desc: 'Complete any research project (🔬 tab). Real-world solar got ~90% cheaper in a decade — research pays compound interest.',
    value: () => Object.keys(G.techs).length,
  },
  {
    id: 'co2', req: 'h2Reserve', title: '🌍 Climate dividend', target: 2500, reward: 50000,
    desc: 'Avoid 2,500 t of CO₂ by serving the region with renewables (top bar counter).',
    value: () => G.co2SavedTons, fmt: v => v.toFixed(0) + ' t',
  },
];

const $ = id => document.getElementById(id);
let dirty = true, tickTimer = 0;

export function initQuests() {
  G.questsDone = G.questsDone || {};
  $('quests').innerHTML = '<div id="quest-head">🎯 Objectives <span id="quest-fold">▾</span></div><div id="quest-list"></div>';
  $('quest-head').onclick = () => {
    const l = $('quest-list');
    const open = l.style.display !== 'none';
    l.style.display = open ? 'none' : 'block';
    $('quest-fold').textContent = open ? '▸' : '▾';
  };
  renderQuests();
}

const isActive = q => !G.questsDone[q.id] && (!q.req || G.questsDone[q.req]);

export function tickQuests(dt) {
  tickTimer += dt;
  if (tickTimer < 0.5) return;
  tickTimer = 0;
  for (const q of QUESTS) {
    if (!isActive(q)) continue;
    if (q.value() >= q.target) {
      G.questsDone[q.id] = true;
      G.money += q.reward;
      const next = QUESTS.filter(x => x.req === q.id && isActive(x));
      showTipText(`🎯 Objective complete: ${q.title}`,
        `Reward: €${q.reward.toLocaleString()}.` +
        (next.length ? ` New objective: ${next.map(n => n.title).join(', ')}` : ''));
      dirty = true;
    }
  }
  renderQuests();
}

let lastBars = '';
function renderQuests() {
  const active = QUESTS.filter(isActive);
  const doneCount = Object.keys(G.questsDone).length;
  // cheap change detection so we don't rebuild DOM every tick
  const sig = active.map(q => q.id + '|' + Math.min(q.value(), q.target).toFixed(1)).join() + doneCount;
  if (!dirty && sig === lastBars) return;
  lastBars = sig; dirty = false;
  const list = $('quest-list');
  list.innerHTML = active.map(q => {
    const v = Math.min(q.value(), q.target);
    const f = q.fmt || (x => Math.floor(x).toLocaleString());
    return `<div class="quest" data-q="${q.id}">
      <div class="quest-title">${q.title} <span class="quest-reward">€${(q.reward / 1000).toFixed(0)}k</span></div>
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
}
