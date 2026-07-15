// News & notification feed (WP1). A single append-only ring of noteworthy
// events the player might otherwise miss when the bottom-left toast fades:
// contract offers/results, quest wins, city problems & achievements, weather
// fronts, blackouts. Producers call pushNews() beside their existing
// emit('toast') (decision D-C: nothing with lasting relevance is toast-only).
// Pure logic — the ticker + history modal live in src/ui/hud/*.
import { G, emit } from './state.js';

export const NEWS_CAP = 120;          // ring size; kept entries never rotate out
let seq = 1;

// {type, icon, headline, body, refs}. `refs` is an optional {i,j,name} (or
// array) map target for a future fly-to. Returns the created entry.
export function pushNews({ type, icon = '📰', headline, body = '', refs = null }) {
  const entry = {
    id: seq++, day: G.day, minutes: G.minutes,
    type, icon, headline, body, refs,
    kept: false, read: false,
  };
  G.news.push(entry);
  // rotate out the oldest NON-kept entries once over cap
  while (G.news.length > NEWS_CAP) {
    const ix = G.news.findIndex(n => !n.kept);
    if (ix < 0) break; // everything is pinned — leave it be
    G.news.splice(ix, 1);
  }
  emit('news', entry);
  return entry;
}

// after a load, continue ids past the restored ones so pushNews stays unique
export function syncNewsSeq() {
  seq = G.news.reduce((m, n) => Math.max(m, n.id + 1), seq);
}

export function markAllRead() { for (const n of G.news) n.read = true; }
export function unreadCount() { return G.news.reduce((a, n) => a + (n.read ? 0 : 1), 0); }

export function keepNews(id, keep = true) {
  const n = G.news.find(x => x.id === id);
  if (n) n.kept = keep;
}
export function deleteNews(id) {
  const ix = G.news.findIndex(x => x.id === id);
  if (ix >= 0) G.news.splice(ix, 1);
}
