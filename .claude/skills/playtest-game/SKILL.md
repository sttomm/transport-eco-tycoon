---
name: playtest-game
description: Run, debug and programmatically play-test Transport Eco Tycoon in the browser. Use when asked to run the game, verify a change works, reproduce a bug, take screenshots, or simulate gameplay (build roads/stations/routes, fast-forward time, inspect grid/economy state).
---

# Play-testing Transport Eco Tycoon

Run `npm test` before any browser session — it catches sim regressions in
~100 ms. The browser pass is for rendering, UI and integration.

## Start the game

Use the preview server (config name `game` in `.claude/launch.json`, port 8741):

```
mcp__Claude_Preview__preview_start name=game
```

Then `preview_screenshot` for visuals and `preview_console_logs level=error` for errors.
The welcome screen pauses the game — dismiss it first:
`document.getElementById('w-start')?.click()` (or `w-continue`).

## CRITICAL: module cache

Browsers cache ES modules. **After editing any `src/**/*.js`, a plain reload
can serve a stale old/new mix.** Always force-refresh first:

```js
(async () => {
  const files = ['index.html','styles.css','src/main.js',
    'src/sim/state.js','src/sim/data.js','src/sim/noise.js','src/sim/grid.js',
    'src/sim/energy.js','src/sim/transport.js','src/sim/quests.js','src/sim/save.js',
    'src/render/meshes.js','src/render/world.js','src/render/vehicles.js','src/render/scene.js','src/render/postfx.js',
    'src/render/assets.js','assets/models/wind_turbine.glb','assets/models/buildings.glb',
    'src/ui/hud.js','src/ui/quests.js','src/ui/input.js'];
  for (const f of files) await fetch('/' + f, { cache: 'reload' });
  location.reload();
})()
```

Verify the fix landed by checking the function source, e.g.
`window.DEBUG.canPlace.toString().includes('<new code>')`.

## In-game debug API (via preview_eval)

- `window.G` — the whole game state (see `src/sim/state.js`): `G.money`,
  `G.supply`, `G.demand`, `G.batteryMWh`, `G.h2MWh`, `G.history` (48h of
  15-min samples), `G.cities`, `G.industries`, `G.vehicles`, `G.firedTips`.
- `window.DEBUG` — `{ place, canPlace, tile, bulldoze, createRoute, buyVehicle,
  addWagon, findPath, nameStation, saveGame, scene, camera, ... }`.
- `G.speed = 10` to fast-forward (1 game day ≈ 18 real seconds at 10×).

## Fast-forwarding without waiting (hidden tabs / determinism)

`requestAnimationFrame` is throttled in hidden tabs, so wall-clock waiting is
unreliable. Drive the sim directly — the modules are shared with the running
game, so the world updates and the renderer catches up next frame:

```js
(async () => {
  const { tickGrid, updateWeather, sampleHistory } = await import('/src/sim/energy.js');
  const { tickIndustries, tickVehicles, tickCities } = await import('/src/sim/transport.js');
  const dt = 0.1, gh = dt * 8 * 10 / 60;         // one 10×-speed frame
  for (let k = 0; k < 450; k++) {                 // ≈ 6 game hours
    G.minutes += gh * 60;
    updateWeather(gh); tickGrid(gh); tickIndustries(gh);
    tickVehicles(dt, gh); tickCities(gh); sampleHistory(gh * 60);
  }
})()
```

## Recipe: build a working freight line programmatically

```js
const D = window.DEBUG;
const farm = G.industries.find(i => i.type === 'farm');
// roads: D.place('road', i, j) tile by tile; water tiles become bridges.
// AVOID routing through building footprints (industries occupy 2×2) —
// check D.canPlace and verify connectivity with D.findPath before trusting it.
const s = D.place('truckStop', i, j); D.nameStation(s);
const r = D.createRoute(); r.stops.push(stopA, stopB);
const v = D.buyVehicle(r, 'truck');   // null if first stop has no road access
```

Then fast-forward and assert on: `G.incomeTransportToday > 0`, vehicle
`state`/`cargo`, industry `inStock`/`stock`/`running`, `G.stats` counters.

## Recipe: verify the energy cycle

After ≥1 game day, check `G.history` aggregates:

```js
const h = G.history;
({ battDischarge: h.filter(s=>s.battery>0.1).length,   // battery used
   fuelcell:      h.filter(s=>s.fuelcell>0.1).length,  // H2 reconversion
   elec:          h.filter(s=>s.elec>0.5).length,      // surplus → H2
   curtailed:     h.filter(s=>s.curtailed>0.5).length,
   unserved:      h.filter(s=>s.unserved>0.1).length })
```

A healthy default grid: battery cycles daily, electrolyzer runs midday,
occasional curtailment, near-zero unserved. To force a stress test:
`G.dunkelflaute = 40` (40 h dark calm) and watch H₂ drain.

## Save hygiene

Autosave writes to localStorage every 10 s and on pagehide. To leave a clean
state after a playtest: `(await import('/src/sim/save.js')).clearSave()` then
reload (clearSave also disables the pagehide autosave for this page).
