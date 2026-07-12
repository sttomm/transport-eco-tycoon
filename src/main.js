// Composition root: wires sim → render → ui and runs the game loop.
// Layering rule: sim/ never imports render/ or ui/; they communicate through
// the event emitter in sim/state.js. See docs/ARCHITECTURE.md.
import { G } from './sim/state.js';
import { tickSim } from './sim/tick.js';
import { initGrid, canPlace, place, bulldoze, decommissionGas, tile } from './sim/grid.js';
import { createRoute, buyVehicle, addWagon, replaceVehicle, autoReplaceFleet } from './sim/transport.js';
import { placeStarterGrid } from './sim/newGame.js';
import { findPath } from './sim/pathfinding.js';
import { nameStation } from './sim/stations.js';
import { signContract, tickContracts } from './sim/contracts.js';
import { takeLoan, repayLoan } from './sim/loans.js';
import { loadGame, saveGame } from './sim/save.js';
import { initScene, updateDayNight, tickCamTween, keyboardPan, scene, camera, controls, renderer } from './render/scene.js';
import { initPostFX, renderPostFX, setPostFX, PFX } from './render/postfx.js';
import { loadModels } from './render/assets.js';
import { initWorldRender, updateWorldRender } from './render/world.js';
import { initVehicleRender, updateVehicleRender } from './render/vehicles.js';
import { initUI, updateUI, showWelcome } from './ui/hud.js';
import { initQuestPanel, updateQuestPanel } from './ui/quests.js';
import { initTutorialPanel, updateTutorialPanel } from './ui/tutorial.js';
import { startTutorial, skipTutorial } from './sim/tutorial.js';
import { startResearch } from './sim/research.js';
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
initTutorialPanel();
initInput();

// Starter infrastructure: a small legacy grid so the lights are on at game
// start (sim/newGame.js — shared with the integration tests).
if (!loadedSave) placeStarterGrid();

// autosave: browser-only concern, so it lives here and not in sim/save.js
setInterval(saveGame, 10000);           // every 10 real seconds
addEventListener('pagehide', saveGame); // and when the tab closes
showWelcome(loadedSave);

// ---------- game loop ----------
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.06);
  last = now;

  tickSim(dt); // the whole sim: clock, day rollover, every tick (sim/tick.js)
  updateWorldRender(dt);
  updateVehicleRender(dt);
  updateQuestPanel(dt);
  updateTutorialPanel(dt);
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
window.DEBUG = { tickSim, place, canPlace, tile, bulldoze, decommissionGas, createRoute, buyVehicle, addWagon, findPath, nameStation, replaceVehicle, autoReplaceFleet, saveGame, signContract, tickContracts, takeLoan, repayLoan, startResearch, startTutorial, skipTutorial, scene, camera, controls, renderer, setPostFX, PFX };
