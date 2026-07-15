// News ticker + history modal (WP1). The ticker is a one-line flash under the
// topbar for the latest unread headline; a 📰 badge keeps the unread count.
// Clicking either opens the reverse-chronological history modal where the
// player can 🗑 delete or 📌 keep (pin) past messages — the "let me re-read
// and curate what I missed" ask. Reads G.news; never contains game rules.
import { G } from '../../sim/state.js';
import { keepNews, deleteNews, markAllRead, unreadCount } from '../../sim/news.js';
import { $ } from './dom.js';
import { openModal } from './modal.js';

let tickerTimer = null;
let currentTickerId = null;

export function initNews() {
  $('newsbtn').onclick = () => openNewsHistory();
  $('newsticker').onclick = () => openNewsHistory(currentTickerId);
  updateBadge();
}

// bus 'news' handler (wired in hud.js)
export function onNews(entry) {
  showTicker(entry);
  updateBadge();
}

function updateBadge() {
  const b = $('newsbtn');
  if (!b) return;
  const n = unreadCount();
  b.classList.toggle('has-unread', n > 0);
  b.innerHTML = `📰${n > 0 ? `<span class="newscount">${n}</span>` : ''}`;
}

const catClass = { 'contract-expired': 'warn', energy: 'warn', 'contract-done': 'good', quest: 'good' };

function showTicker(entry) {
  const el = $('newsticker');
  if (!el) return;
  currentTickerId = entry.id;
  // anchor under the topbar with its live height (same trick as the weather banner)
  el.style.top = $('topbar').offsetHeight + 'px';
  el.className = 'shown ' + (catClass[entry.type] || '');
  el.innerHTML = `<span class="ni">${entry.icon}</span> <b>${entry.headline}</b> <span class="dim small">— click to read</span>`;
  clearTimeout(tickerTimer);
  tickerTimer = setTimeout(() => { el.className = ''; }, 12000);
}

const fmtWhen = n => `Day ${n.day} · ${String(Math.floor((n.minutes / 60) % 24)).padStart(2, '0')}:${String(Math.floor(n.minutes % 60)).padStart(2, '0')}`;

function renderList(container) {
  if (!G.news.length) {
    container.innerHTML = '<div class="dim" style="padding:14px;text-align:center">No news yet. Contract offers, objectives, weather fronts and city milestones will appear here.</div>';
    return;
  }
  container.innerHTML = [...G.news].reverse().map(n => `
    <div class="newsitem ${catClass[n.type] || ''}${n.kept ? ' kept' : ''}" data-id="${n.id}">
      <div class="news-ic">${n.icon}</div>
      <div class="news-txt">
        <div class="news-hd">${n.headline}</div>
        ${n.body ? `<div class="news-bd">${n.body}</div>` : ''}
        <div class="news-when dim small">${fmtWhen(n)}</div>
      </div>
      <div class="news-acts">
        <span class="news-keep" title="${n.kept ? 'Unpin' : 'Keep (never rotates out)'}">${n.kept ? '📌' : '📍'}</span>
        <span class="news-del" title="Delete">🗑</span>
      </div>
    </div>`).join('');
}

function openNewsHistory(focusId) {
  markAllRead();
  updateBadge();
  const body = document.createElement('div');
  body.className = 'newslist';
  renderList(body);
  openModal({ title: '📰 News &amp; notifications', body, id: 'newsmodal' });
  // delegated (the list re-renders on keep/delete)
  body.addEventListener('click', e => {
    const item = e.target.closest('.newsitem');
    if (!item) return;
    const id = +item.dataset.id;
    if (e.target.closest('.news-keep')) {
      const n = G.news.find(x => x.id === id);
      keepNews(id, !(n && n.kept));
      renderList(body);
    } else if (e.target.closest('.news-del')) {
      deleteNews(id);
      renderList(body);
    }
  });
  if (focusId != null) {
    const t = body.querySelector(`.newsitem[data-id="${focusId}"]`);
    if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); }
  }
}
