// DOM HUD: topbar, toolbar, side-panel tabs (dashboard charts, research,
// routes, encyclopedia), advisor toasts, selection infobox, welcome screen.
// Reads sim state each tick; never contains game rules.
//
// Coordinating shell: owns the sim-event subscriptions, the tab router, the
// keyboard/speed controls and the update throttles. The panels themselves
// live in ./hud/*.js; this module re-exports the surface other files import.
import { G, on, emit } from '../sim/state.js';
import { decommissionGas } from '../sim/grid.js';
import { notifyTutorial } from '../sim/tutorial.js';
import { $, setSpeed } from './hud/dom.js';
import { showTip, showTipText } from './hud/toasts.js';
import { buildToolbar, updateToolbarLocks, selectTool } from './hud/toolbar.js';
import { initTopbarTooltips, updateTopbar } from './hud/topbar.js';
import {
  showDayReport, renderYesterday, renderForecast, renderClimate,
  drawPowerChart, drawFinance, initLoanBox, updateLoanBox,
} from './hud/dashboard.js';
import { renderResearch, renderResearchLive } from './hud/research.js';
import { renderContracts, renderContractsLive } from './hud/contracts.js';
import { renderRoutes, renderRoutesLive, quickBuyVehicle, focusRoute } from './hud/routes.js';
import { renderLearn } from './hud/learn.js';
import { renderInfobox } from './hud/infobox.js';
import { initNews, onNews } from './hud/news.js';
import { initStats } from './hud/statsModal.js';
import { closeTopModal, modalOpen } from './hud/modal.js';
import { pickEscapeLayer } from './hud/escape.js';

// external surface (main.js, input.js) — unchanged by the ./hud/ split
export { showTipText } from './hud/toasts.js';
export { selectTool } from './hud/toolbar.js';
export { renderRoutes } from './hud/routes.js';
export { showWelcome } from './hud/welcome.js';

let activeTab = null;

export function initUI() {
  buildToolbar();
  buildTabs();
  on('tip', showTip);
  on('toast', t => showTipText(t.title, t.text));
  on('plantBuilt', p => {
    const map = { solar: 'firstSolar', wind: 'firstWind', battery: 'firstBattery', electrolyzer: 'firstElectrolyzer', fuelcell: 'firstFuelcell' };
    if (map[p.type]) showTip(map[p.type]);
  });
  on('stationBuilt', st => {
    if (st.stype === 'bus') showTip('firstBusStop');
    if (st.stype === 'train') showTip('firstTrainStation');
  });
  on('railBuilt', () => showTip('firstRail'));
  on('vehicleBought', v => { if (v.kind === 'train') showTip('firstTrain'); });
  on('contractsChanged', () => { if (activeTab === 'contracts') renderContracts(); });
  on('researchDone', () => { if (activeTab === 'research') renderResearch(); });
  on('dayReport', showDayReport);
  on('news', onNews);
  initLoanBox();
  initTopbarTooltips();
  initNews();
  initStats();
  anchorSidePanel();
  window.addEventListener('resize', anchorSidePanel);
  // delegated: the infobox re-renders every 0.25 s, so a handler on the button
  // itself could vanish between mousedown and click (same trick as the vehlist)
  $('infobox').addEventListener('click', e => {
    if (e.target.id === 'decomgas') { if (decommissionGas()) G.selected = null; return; } // tip fires from the sim
    const btn = e.target.closest('button');
    if (!btn) return;
    // WP5 click-through: city "show busiest stop", station "edit"/"+ vehicle"
    if (btn.dataset.flySt !== undefined) {
      const st = G.stations[+btn.dataset.flySt];
      if (st) { emit('flyTo', { i: st.i, j: st.j }); G.selected = st; }
      return;
    }
    // click-through: switch to the route's kind filter, expand only that
    // route (collapsing the rest) and scroll it into view — focusRoute()
    // owns the routes-tab state, hud.js just triggers it (WP-T)
    if (btn.dataset.editroute !== undefined) {
      const r = G.routes.find(x => x.id === +btn.dataset.editroute);
      if (r) { G.routeEdit = r; focusRoute(r); openTab('routes', true); }
      return;
    }
    if (btn.dataset.addveh !== undefined) {
      const r = G.routes.find(x => x.id === +btn.dataset.addveh);
      if (r) { quickBuyVehicle(r); focusRoute(r); openTab('routes', true); }
    }
  });

  $('speeds').addEventListener('click', e => {
    const s = e.target.dataset.s;
    if (s !== undefined) setSpeed(+s);
  });
  $('demandbtn').onclick = toggleDemand;
  // narrow-viewport bottom sheet (WP6/ADR 38): reuses the exact #toolbar built
  // by buildToolbar() above — no separate render, so locks/tooltips/selection
  // stay identical between the docked bar and the sheet
  $('buildbtn').onclick = () => $('toolbar').classList.toggle('sheet-open');
  document.addEventListener('keydown', e => {
    // Escape peels exactly ONE layer per press, in priority order: top modal,
    // then tool/route-edit, then selection, then the demand overlay
    // (pickEscapeLayer — WP6; shared with input.js's right-click cancel).
    if (e.key === 'Escape') {
      e.preventDefault();
      const layer = pickEscapeLayer({
        modalOpen: modalOpen(), tool: G.tool, routeEdit: G.routeEdit, selected: G.selected, showDemand: G.showDemand,
      });
      if (layer === 'modal') closeTopModal();
      else if (layer === 'tool') selectTool(null);
      else if (layer === 'selection') G.selected = null;
      else if (layer === 'demand') toggleDemand(); // also dismisses the demand arrows
      return;
    }
    if (modalOpen()) return; // game is paused behind a modal (welcome, report, …)
    if (e.key === ' ') { setSpeed(G.speed === 0 ? (G._lastSpeed || 1) : 0); e.preventDefault(); }
    if (e.key === '1') setSpeed(1);
    if (e.key === '2') setSpeed(3);
    if (e.key === '3') setSpeed(10);
    if (e.key === 'v' || e.key === 'V') toggleDemand();
  });
}

function toggleDemand() {
  G.showDemand = !G.showDemand;
  $('demandbtn').classList.toggle('on', G.showDemand);
}

// The side panel's CSS `bottom` is a static fallback that loses to the real
// toolbar height (which grows when the bar wraps). Anchor it to the live
// height — same trick topbar.js uses for the weather banner (WP5).
function anchorSidePanel() {
  const tb = $('toolbar');
  if (tb) $('sidepanel').style.bottom = (tb.offsetHeight + 10) + 'px';
}

// ---------- side panel tabs ----------
// Open (or, when it's already open, toggle shut) a side-panel tab. Exported so
// click-throughs (e.g. the station infobox "✎ edit" button) can jump straight
// to the routes tab. `force` keeps a tab open instead of toggling it.
export function openTab(tab, force = false) {
  activeTab = (!force && activeTab === tab) ? null : tab;
  G.routeHover = null;
  document.querySelectorAll('#tabbtns button').forEach(x => x.classList.toggle('on', x.dataset.tab === activeTab));
  $('sidepanel').style.display = activeTab ? 'flex' : 'none';
  document.querySelectorAll('.tabpage').forEach(p => p.style.display = p.id === 'tab-' + activeTab ? 'block' : 'none');
  if (activeTab) { notifyTutorial('tab:' + activeTab); anchorSidePanel(); }
  if (activeTab === 'dashboard') { renderYesterday(); renderForecast(); renderClimate(); }
  if (activeTab === 'contracts') renderContracts();
  if (activeTab === 'research') { renderResearch(); showTip('research'); }
  if (activeTab === 'routes') renderRoutes();
  if (activeTab === 'learn') renderLearn();
}
function buildTabs() {
  document.querySelectorAll('#tabbtns button').forEach(b => {
    b.onclick = () => openTab(b.dataset.tab);
  });
}

// ---------- topbar / live HUD ----------
let hudTimer = 0, chartTimer = 0;
export function updateUI(dt) {
  hudTimer += dt;
  if (hudTimer > 0.25) {
    hudTimer = 0;
    updateTopbar();
    updateToolbarLocks();
    renderInfobox();
    if (activeTab === 'routes') renderRoutesLive();
    if (activeTab === 'research') renderResearchLive();
    if (activeTab === 'contracts') renderContractsLive();
  }
  chartTimer += dt;
  if (chartTimer > 0.6 && activeTab === 'dashboard') {
    chartTimer = 0;
    renderForecast();
    drawPowerChart();
    renderClimate();
    drawFinance();
    updateLoanBox();
  }
}
