// News feed (WP1): the ring buffer, the `kept`-pin rotation exemption, the
// bus event, and that the sim producers (contracts, quests) actually file news.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, on } from '../src/sim/state.js';
import { pushNews, keepNews, deleteNews, unreadCount, NEWS_CAP } from '../src/sim/news.js';
import { contractDelivery, tickContracts, PREMIUM } from '../src/sim/contracts.js';
import { checkQuests } from '../src/sim/quests.js';
import { freshWorld } from './helpers.js';

beforeEach(() => freshWorld());

test('pushNews appends a shaped entry and emits the bus event', () => {
  const seen = [];
  on('news', n => seen.push(n));
  const e = pushNews({ type: 'quest', icon: '🎯', headline: 'Hi', body: 'there' });
  assert.equal(G.news.length, 1);
  assert.equal(G.news[0], e);
  assert.equal(e.day, G.day);
  assert.equal(e.kept, false);
  assert.equal(e.read, false);
  assert.equal(seen.length, 1, 'emitted once');
  assert.equal(seen[0].headline, 'Hi');
});

test('unread count tracks entries until marked read', () => {
  pushNews({ type: 'quest', headline: 'a' });
  pushNews({ type: 'quest', headline: 'b' });
  assert.equal(unreadCount(), 2);
  G.news.forEach(n => (n.read = true));
  assert.equal(unreadCount(), 0);
});

test('the ring is capped, rotating out the oldest non-kept entries', () => {
  for (let i = 0; i < NEWS_CAP + 25; i++) pushNews({ type: 'quest', headline: 'n' + i });
  assert.equal(G.news.length, NEWS_CAP, 'capped at NEWS_CAP');
  // the very first ones rotated out; the newest survive
  assert.equal(G.news[G.news.length - 1].headline, 'n' + (NEWS_CAP + 24));
  assert.ok(!G.news.some(n => n.headline === 'n0'), 'oldest rotated out');
});

test('kept entries are exempt from rotation', () => {
  const pinned = pushNews({ type: 'city', headline: 'important' });
  keepNews(pinned.id, true);
  for (let i = 0; i < NEWS_CAP + 50; i++) pushNews({ type: 'quest', headline: 'x' + i });
  assert.equal(G.news.length, NEWS_CAP);
  assert.ok(G.news.includes(pinned), 'pinned entry never rotated out');
});

test('deleteNews removes a single entry', () => {
  const a = pushNews({ type: 'quest', headline: 'a' });
  pushNews({ type: 'quest', headline: 'b' });
  deleteNews(a.id);
  assert.equal(G.news.length, 1);
  assert.equal(G.news[0].headline, 'b');
});

test('producer wiring: a fulfilled contract files a contract-done entry', () => {
  G.contracts.active.push({
    id: 1, kind: 'cargo', cargoId: 'grain', fromCity: null, toCity: null, toInd: 0,
    amount: 5, mult: PREMIUM, bonus: 5000, progress: 0, days: 2,
    expires: G.minutes + 1440, deadline: G.minutes + 2880,
  });
  contractDelivery('grain', { toCity: null, toInd: 0 }, 5, 500);
  assert.ok(G.news.some(n => n.type === 'contract-done'), 'fulfilment filed to the feed');
});

test('producer wiring: a new offer files a contract-offer entry', () => {
  for (let i = 0; i < 10; i++) tickContracts(8);
  assert.ok(G.news.some(n => n.type === 'contract-offer'), 'offer spawns filed to the feed');
});

test('producer wiring: completing a quest files a quest entry', () => {
  G.questsDone = {};      // checkQuests reads this map (initQuestState in prod)
  G.stats.paxLocal = 999; // trip the localLine objective (target 40)
  checkQuests();
  assert.ok(G.news.some(n => n.type === 'quest'), 'quest completion filed to the feed');
});
