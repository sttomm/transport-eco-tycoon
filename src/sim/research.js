// Research progression: one project at a time, effects are permanent.
// startResearch() is the player action (called by the research tab);
// tickResearch() advances the active project each sim tick.
import { G, emit, spend } from './state.js';
import { TECHS } from './data.js';
import { pushNews } from './news.js';

// Returns true when the project started, or a reason string the UI can
// explain: 'busy' (lab occupied) | 'poor' (can't afford) | 'invalid'.
export function startResearch(id) {
  const t = TECHS.find(x => x.id === id);
  if (!t || G.techs[id] || (t.req && !G.techs[t.req])) return 'invalid';
  if (G.research) return 'busy';
  if (!spend(t.cost, 'research')) return 'poor';
  G.research = { id: t.id, progress: 0, days: t.days };
  return true;
}

export function tickResearch(gameHours) {
  if (!G.research) return;
  G.research.progress += gameHours / (G.research.days * 24);
  if (G.research.progress >= 1) {
    const t = TECHS.find(x => x.id === G.research.id);
    t.fx(G.mult);
    if (t.apply) t.apply(G); // retrofit existing builds (e.g. LFP upgrades placed batteries)
    G.techs[t.id] = true;
    G.research = null;
    emit('toast', { title: 'Research complete!', text: `${t.name} — ${t.desc}` });
    // permanent, easy-to-miss progress (WP10 sweep, D-C) — file it beside the
    // toast so a finished tech shows up in the 📰 feed, not just a fading toast
    pushNews({ type: 'research', icon: '🔬', headline: 'Research complete', body: `${t.name} — ${t.desc}` });
    emit('researchDone', t);
  }
}
