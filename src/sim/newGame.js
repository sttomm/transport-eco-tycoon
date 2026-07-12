// New-game seeding: the inherited starter grid every fresh game begins with.
// Called by main.js when no save was restored; the integration tests use it
// to play the same game the player gets.
import { G } from './state.js';
import { canPlace, place } from './grid.js';

// place near [ni,nj]: scan growing rings until the placement rules say yes
function placeStarter(type, ni, nj) {
  for (let r = 0; r < 14; r++) for (let j = nj - r; j <= nj + r; j++) for (let i = ni - r; i <= ni + r; i++) {
    if (canPlace(type, i, j)) { place(type, i, j); return true; }
  }
  return false;
}

export function placeStarterGrid() {
  // suppress build-tips while placing the legacy grid, then re-arm them for the player's own builds
  for (const id of ['firstSolar', 'firstWind', 'firstBattery']) G.firedTips[id] = true;
  // deliberately UNDERSIZED for the 8-city region (~23 MW evening peak): the
  // legacy gas plant has to run every evening from day 1, so the rising
  // carbon price turns the inherited status quo into a bleed the player must
  // build their way out of — the energy transition as the profit motive.
  placeStarter('hydro', 22, 42);     // at the pond north of Windburg
  placeStarter('wind', 34, 50);
  placeStarter('wind', 37, 50);
  placeStarter('wind', 40, 48);
  placeStarter('wind', 56, 56);
  placeStarter('solar', 30, 70);
  placeStarter('solar', 36, 72);
  placeStarter('solar', 24, 66);
  placeStarter('battery', 34, 66);
  // the inherited legacy gas plant (ADR 21) on Solhaven's eastern outskirts —
  // the early-game safety net the whole energy-transition arc phases out
  placeStarter('gas', 57, 66);
  G.batteryMWh = G.batteryCapMWh * 0.5;
  for (const id of ['firstSolar', 'firstWind', 'firstBattery']) delete G.firedTips[id];
}
