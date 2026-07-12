---
name: playtest-game
description: Run, debug and programmatically play-test Transport Eco Tycoon in the browser. Use when asked to run the game, verify a change works, reproduce a bug, take screenshots, or simulate gameplay (build roads/stations/routes, fast-forward time, inspect grid/economy state).
---

# Play-testing Transport Eco Tycoon

Run `npm test` before any browser session — it catches sim regressions in
~100 ms (including multi-day integration runs). The browser pass is for
rendering, UI and pointer input.

## Start the game

Start the dev server with your session's preview/browser tools using the
launch.json config name `game` (port 8741), e.g. `preview_start {name: "game"}`.
Then use the browser tools: screenshot for visuals, console messages
(errors only) for regressions, and the JavaScript-eval tool for everything below.

The welcome screen pauses the game — dismiss it first:
`document.getElementById('w-continue')?.click()` to keep the existing save, or
`w-start` for free play on a new game (`w-tutorial` starts the guided tutorial).

**The preview tab may hold the user's real progress.** Prefer `w-continue`,
never `clearSave()` over a save you didn't create, and restore `G.speed` to
what you found when you're done. If you must experiment destructively, rescue
first: `const bak = (await import('/src/sim/save.js')).snapshot()` and restore
it afterwards.

## CRITICAL: module cache

Browsers cache ES modules. **After editing any `src/**/*.js`, a plain reload
can serve a stale old/new mix.** Force-refresh everything the page has loaded
(self-maintaining — no file list to keep in sync; newly created files were
never cached and load fresh anyway):

```js
(async () => {
  const files = [...new Set(performance.getEntriesByType('resource')
    .map(e => new URL(e.name).pathname)
    .filter(p => p.startsWith('/src/') || p.startsWith('/assets/')))];
  for (const f of ['/index.html', '/styles.css', ...files]) await fetch(f, { cache: 'reload' });
  location.reload();
})()
```

Verify the fix landed by checking the function source, e.g.
`window.DEBUG.canPlace.toString().includes('<new code>')`.

## In-game debug API (via JS eval)

- `window.G` — the whole game state (see `src/sim/state.js`): `G.money`,
  `G.supply`, `G.demand`, `G.batteryMWh`, `G.h2MWh`, `G.history` (48h of
  15-min samples), `G.cities`, `G.industries`, `G.vehicles`, `G.reports`,
  `G.price`, `G.firedTips`.
- `window.DEBUG` — `{ tickSim, place, canPlace, tile, bulldoze, decommissionGas,
  createRoute, buyVehicle, addWagon, findPath, nameStation, replaceVehicle,
  autoReplaceFleet, saveGame, signContract, tickContracts, takeLoan, repayLoan,
  startResearch, startTutorial, skipTutorial, scene, camera, controls,
  renderer, setPostFX, PFX }`. `place`/`buyVehicle` are money-free primitives;
  the paid player paths are `purchaseBuilding`/`purchaseVehicle` (import from
  `/src/sim/grid.js` / `/src/sim/transport.js` if you need them).
- `G.speed = 10` to fast-forward live (1 game day ≈ 18 real seconds at 10×).

## Fast-forwarding without waiting (hidden tabs)

`requestAnimationFrame` is suspended in hidden tabs — the frame loop (and all
UI updates) freeze while the preview tab is not visible. Symptoms: game clock
stuck, topbar stale, infobox never renders. Drive the sim (and, if needed, the
UI) directly — modules are shared with the running game:

```js
(async () => {
  const D = window.DEBUG;
  const prev = G.speed;
  G.speed = 10;
  for (let k = 0; k < 1350; k++) D.tickSim(0.1); // 1350 ≈ 1 game day incl. rollover
  G.speed = prev;
  (await import('/src/ui/hud.js')).updateUI(0.7); // repaint HUD while hidden
})()
```

`tickSim` is the real pipeline (weather → grid → industries → vehicles →
cities → contracts → research + the midnight rollover) — identical to what
`test/integration.test.js` runs headless in Node. If your check doesn't need
the renderer, prefer writing it as an integration test instead.

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

A healthy starter grid: battery cycles daily, gas runs in the evenings (that's
the ADR 21 design), near-zero unserved. To force a stress test:
`G.dunkelflaute = 40` (40 h dark calm) and watch storage drain.

## Save hygiene

Autosave writes to localStorage every 10 s and on pagehide (`main.js`). To
leave a clean state after a playtest of a NEW game you created:
`(await import('/src/sim/save.js')).clearSave()` then reload (clearSave also
disables the pagehide autosave for this page). Never do this over the user's
real progress — see the warning at the top.
