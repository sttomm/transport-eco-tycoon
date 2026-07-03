// Composition root: wires sim → render → ui and runs the game loop.
// Layering rule: sim/ never imports render/ or ui/; they communicate through
// the event emitter in sim/state.js. See docs/ARCHITECTURE.md.
import { G } from './sim/state.js';
import { initGrid, canPlace, place, bulldoze, tile } from './sim/grid.js';
import { updateWeather, tickGrid, sampleHistory, dailyUpkeep } from './sim/energy.js';
import {
  tickIndustries, tickVehicles, tickCities,
  createRoute, buyVehicle, addWagon, findPath, nameStation,
} from './sim/transport.js';
import { loadGame, saveGame, initAutosave } from './sim/save.js';
import { initScene, updateDayNight, tickCamTween, keyboardPan, scene, camera, controls, renderer } from './render/scene.js';
import { initPostFX, renderPostFX, setPostFX, PFX } from './render/postfx.js';
import { loadModels } from './render/assets.js';
import { initWorldRender, updateWorldRender } from './render/world.js';
import { initVehicleRender, updateVehicleRender } from './render/vehicles.js';
import { initUI, updateUI, tickResearch, showWelcome } from './ui/hud.js';
import { initQuestPanel, updateQuestPanel } from './ui/quests.js';
import { initInput } from './ui/input.js';

// ---------- init (order matters: renderers subscribe to sim events before
// the save file / starter grid replays place() calls) ----------
initGrid();
initScene();
initPostFX(renderer, scene, camera, controls);
await loadModels();   // top-level await: 'placed' listeners need models before the save replays
initWorldRender(scene);
initVehicleRender(scene);
const loadedSave = loadGame();   // restore player progress before the UI reads it
initUI();
initQuestPanel();
initInput();

// Starter infrastructure: a small legacy grid so the lights are on at game start.
function placeStarter(type, ni, nj) {
  for (let r = 0; r < 14; r++) for (let j = nj - r; j <= nj + r; j++) for (let i = ni - r; i <= ni + r; i++) {
    if (canPlace(type, i, j)) { place(type, i, j); return true; }
  }
  return false;
}
if (!loadedSave) {
  // suppress build-tips while placing the legacy grid, then re-arm them for the player's own builds
  for (const id of ['firstSolar', 'firstWind', 'firstBattery']) G.firedTips[id] = true;
  placeStarter('hydro', 66, 22);     // at the river
  placeStarter('wind', 30, 14);
  placeStarter('wind', 33, 14);
  placeStarter('solar', 12, 28);
  placeStarter('battery', 14, 34);
  G.batteryMWh = G.batteryCapMWh * 0.5;
  for (const id of ['firstSolar', 'firstWind', 'firstBattery']) delete G.firedTips[id];
}
initAutosave();
showWelcome(loadedSave);

// ---------- game loop ----------
const MIN_PER_SEC = 8; // game minutes per real second at 1x → 1 day = 3 real minutes
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.06);
  last = now;

  const gm = dt * MIN_PER_SEC * G.speed;     // game minutes this frame
  const gh = gm / 60;                        // game hours
  if (gm > 0) {
    G.minutes += gm;
    if (Math.floor(G.minutes / 1440) + 1 > G.day) {
      G.day = Math.floor(G.minutes / 1440) + 1;
      G.incomeTransportToday = 0; G.incomeEnergyToday = 0; G.expensesToday = 0;
      G.curtailedTodayMWh = 0;
      G.finance.prev = G.finance.today;   // keep yesterday for the finance drill-down
      G.finance.today = { bus: 0, truck: 0, train: 0, routes: {} };
      dailyUpkeep(); // after the reset, so upkeep shows in today's expenses
    }
    updateWeather(gh);
    tickGrid(gh);
    tickIndustries(gh);
    tickVehicles(dt, gh);
    tickCities(gh);
    tickResearch(gh);
    sampleHistory(gm);
  }
  updateWorldRender(dt);
  updateVehicleRender(dt);
  updateQuestPanel(dt);
  updateDayNight();
  keyboardPan(dt);
  tickCamTween(dt);
  controls.update();
  updateUI(dt);
  renderPostFX();
}
requestAnimationFrame(frame);

// expose for debugging & programmatic play-testing (see the playtest-game skill)
window.G = G;
window.DEBUG = { place, canPlace, tile, bulldoze, createRoute, buyVehicle, addWagon, findPath, nameStation, saveGame, scene, camera, controls, renderer, setPostFX, PFX };
