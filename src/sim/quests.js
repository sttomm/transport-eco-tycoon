// Quest / objective system: three parallel chains (passengers, freight, energy)
// so the player always has 2-4 concrete goals. Progress is read from G.stats
// counters and live grid state; rewards are cash. Pure logic — the panel UI
// lives in src/ui/quests.js and listens for the 'toast' event emitted here.
import { G, emit } from './state.js';

const stat = k => () => G.stats[k];
const MWh = v => v.toFixed(0) + ' MWh';

// destination helpers for the 📍 jump button — return [{i, j, name}, ...]
const ind = (...types) => () =>
  G.industries.filter(x => types.includes(x.type)).map(x => ({ i: x.i, j: x.j, name: x.def.name }));
const allCities = () => G.cities.map(c => ({ i: c.ci, j: c.cj, name: c.name }));
const saddestCity = () => {
  const c = [...G.cities].sort((a, b) => a.happiness - b.happiness)[0];
  return c ? [{ i: c.ci, j: c.cj, name: `${c.name} (${Math.round(c.happiness * 100)}% happy)` }] : [];
};
const plants = (...types) => () =>
  G.plants.filter(p => types.includes(p.type)).map(p => ({ i: p.i, j: p.j, name: p.def.name }));

export const QUESTS = [
  // --- passenger chain
  {
    id: 'localLine', where: allCities, title: '🚌 Crosstown traffic', target: 40, reward: 18000,
    desc: 'People want to get across town. Build two bus stops in the SAME city at least 5 tiles apart (e.g. the west and east side), connect them with a route and buy an e-bus. Carry 25 local passengers.',
    value: stat('paxLocal'),
  },
  {
    id: 'interLine', where: allCities, req: 'localLine', title: '🌉 Connect the cities', target: 60, reward: 30000,
    desc: 'Many travellers want to visit ANOTHER city — press V to see who wants to go where. Run a bus route between two cities and carry 40 intercity passengers.',
    value: stat('paxInter'),
  },
  {
    id: 'busBoom', where: allCities, req: 'interLine', title: '🚏 Transit network', target: 400, reward: 45000,
    desc: 'Carry 250 passengers in total. Watch the stop badges in the demand overlay — red means overcrowded, add buses or stops.',
    value: () => G.stats.paxLocal + G.stats.paxInter,
  },
  {
    id: 'happy', where: saddestCity, req: 'interLine', title: '🏙 Happy region', target: 70, reward: 40000,
    desc: 'Get EVERY city to at least 70% happiness. Reliable power, food deliveries and bus service keep citizens happy — and happy cities grow.',
    value: () => Math.min(...G.cities.map(c => c.happiness)) * 100,
    fmt: v => v.toFixed(0) + '%',
  },
  // --- freight chain
  {
    id: 'grainChain', where: ind('farm', 'food'), title: '🌾 Feed the food plant', target: 30, reward: 20000,
    desc: 'The Food Plant is idle without grain. Build a Freight Depot near the Farm and one near the Food Plant, connect them with a road and a truck route. Deliver 30 grain.',
    value: stat('grainToFood'),
  },
  {
    id: 'feedCities', where: ind('food'), req: 'grainChain', title: '🥫 Food to the people', target: 60, reward: 25000,
    desc: 'Cities buy food at a premium. Add a depot near a city to your food route and deliver 60 food.',
    value: stat('foodToCity'),
  },
  {
    id: 'oreChain', where: ind('mine', 'steel'), req: 'feedCities', title: '⛏ Green steel supply', target: 60, reward: 35000,
    desc: 'The Steel Works needs iron ore from the mine in the east. You may need a bridge over the river (5× road cost). Deliver 60 ore. Warning: a running steel works is a 13 MW load — grow your grid!',
    value: stat('oreToSteel'),
  },
  {
    id: 'steelCities', where: ind('steel'), req: 'oreChain', title: '🏗 Steel for the build-out', target: 40, reward: 35000,
    desc: 'Deliver 40 green steel to a city — the most valuable cargo in the region.',
    value: stat('steelToCity'),
  },
  {
    id: 'railAge', where: allCities, req: 'grainChain', title: '🚆 The electric railway', target: 120, reward: 50000,
    desc: 'Steel wheels on steel rails move a tonne with ~10× less energy than trucks. Lay track between two Rail Stations, buy a locomotive, add wagons (passenger or freight) and move 120 units by rail. The loco draws ~1 MW live from your grid!',
    value: stat('railUnits'),
  },
  // --- energy chain
  {
    id: 'fossilFree', where: plants('gas'), title: '🌱 Fossil-free week', target: 7, reward: 50000,
    desc: 'Your inherited gas plant keeps the lights on — at a rising carbon cost. Go 7 consecutive days without a single gas MWh: build enough storage that it never has to run, or decommission it outright (click the plant). This is the energy transition in one objective.',
    value: () => G.fossilFreeDays, fmt: v => v.toFixed(0) + ' days',
    win: true,
    winText: 'Seven straight days of 100% clean power — the region\'s energy transition is complete. Real grids call this the endgame: firm renewables and storage made the fossil bridge obsolete.',
  },
  {
    id: 'storagePlay', where: plants('battery', 'solar'), title: '🔋 Store the sun', target: 80, reward: 25000,
    desc: 'Solar peaks at noon, demand peaks in the evening. Reach 80 MWh of battery capacity to shift the surplus (build batteries or research LFP).',
    value: () => G.batteryCapMWh, fmt: MWh,
  },
  {
    id: 'h2Reserve', where: plants('electrolyzer', 'h2tank'), req: 'storagePlay', title: '🫧 Hydrogen reserve', target: 80, reward: 40000,
    desc: 'Batteries cover hours, not weeks. Build an Electrolyzer and an H₂ tank, then stockpile 80 MWh of hydrogen for the next Dunkelflaute.',
    value: () => G.h2MWh, fmt: MWh,
  },
  {
    id: 'h2Export', where: plants('efuel'), req: 'h2Reserve', title: '🛢 Hydrogen economy', target: 300, reward: 45000,
    desc: 'Hydrogen isn\'t just storage — it\'s a product. Build an E-Fuel Refinery and sell 300 MWh of hydrogen into e-fuel contracts. It only sells above a 40% tank reserve, so your Dunkelflaute stash stays untouched.',
    value: () => G.h2SoldMWh, fmt: MWh,
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

export const isQuestActive = q => !G.questsDone[q.id] && (!q.req || G.questsDone[q.req]);

export function initQuestState() {
  G.questsDone = G.questsDone || {};
}

// check active quests for completion; pays rewards and emits 'toast' +
// 'questDone'. Throttled by the caller (UI panel calls it ~2×/s).
export function checkQuests() {
  for (const q of QUESTS) {
    if (!isQuestActive(q)) continue;
    if (q.value() >= q.target) {
      G.questsDone[q.id] = true;
      G.money += q.reward;
      const next = QUESTS.filter(x => x.req === q.id && isQuestActive(x));
      // quests flagged `win` are milestone victories — celebrate accordingly
      emit('toast', {
        title: q.win ? `🏆🎉 ${q.title} — YOU DID IT!` : `🎯 Objective complete: ${q.title}`,
        text: (q.winText ? q.winText + ' ' : '') + `Reward: €${q.reward.toLocaleString()}.` +
          (next.length ? ` New objective: ${next.map(n => n.title).join(', ')}` : ''),
      });
      emit('questDone', q);
    }
  }
}
