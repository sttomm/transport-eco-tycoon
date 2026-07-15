// DOM HUD: topbar, toolbar, side-panel tabs (dashboard charts, research,
// routes, encyclopedia), advisor toasts, selection infobox, welcome screen.
// Reads sim state each tick; never contains game rules.
//
// Coordinating shell: owns the sim-event subscriptions, the tab router, the
// keyboard/speed controls and the update throttles. The panels themselves
// live in ./hud/*.js; this module re-exports the surface other files import.
import { G, on } from '../sim/state.js';
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
import { renderRoutes, renderRoutesLive } from './hud/routes.js';
import { renderLearn } from './hud/learn.js';
import { renderInfobox } from './hud/infobox.js';
import { initNews, onNews } from './hud/news.js';
import { closeTopModal, modalOpen } from './hud/modal.js';

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
  // delegated: the infobox re-renders every 0.25 s, so a handler on the button
  // itself could vanish between mousedown and click (same trick as the vehlist)
  $('infobox').addEventListener('click', e => {
    if (e.target.id !== 'decomgas') return;
    if (decommissionGas()) G.selected = null; // tip fires from the sim
  });

  $('speeds').addEventListener('click', e => {
    const s = e.target.dataset.s;
    if (s !== undefined) setSpeed(+s);
  });
  $('demandbtn').onclick = toggleDemand;
  document.addEventListener('keydown', e => {
    // Escape peels one layer: top modal first, then tool/route-edit, selection,
    // demand overlay (WP6 formalises the chain; the modal step lands here).
    if (e.key === 'Escape') {
      if (closeTopModal()) { e.preventDefault(); return; }
      selectTool(null);
      G.selected = null;
      if (G.showDemand) toggleDemand(); // also dismisses the demand arrows
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

// ---------- side panel tabs ----------
function buildTabs() {
  document.querySelectorAll('#tabbtns button').forEach(b => {
    b.onclick = () => {
      const tab = b.dataset.tab;
      activeTab = activeTab === tab ? null : tab;
      G.routeHover = null;
      document.querySelectorAll('#tabbtns button').forEach(x => x.classList.toggle('on', x.dataset.tab === activeTab));
      $('sidepanel').style.display = activeTab ? 'flex' : 'none';
      document.querySelectorAll('.tabpage').forEach(p => p.style.display = p.id === 'tab-' + activeTab ? 'block' : 'none');
      if (activeTab) notifyTutorial('tab:' + activeTab);
      if (activeTab === 'dashboard') { renderYesterday(); renderForecast(); renderClimate(); }
      if (activeTab === 'contracts') renderContracts();
      if (activeTab === 'research') { renderResearch(); showTip('research'); }
      if (activeTab === 'routes') renderRoutes();
      if (activeTab === 'learn') renderLearn();
    };
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
