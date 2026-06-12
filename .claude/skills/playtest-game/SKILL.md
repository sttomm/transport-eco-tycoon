---
name: playtest-game
description: Run, debug and programmatically play-test Transport Eco Tycoon in the browser. Use when asked to run the game, verify a change works, reproduce a bug, take screenshots, or simulate gameplay (build roads/stations/routes, fast-forward time, inspect grid/economy state).
---

# Play-testing Transport Eco Tycoon

## Start the game

Use the preview server (config name `game` in `.claude/launch.json`, port 8741):

```
mcp__Claude_Preview__preview_start name=game
```

Then `preview_screenshot` for visuals and `preview_console_logs level=error` for errors.

## CRITICAL: module cache

The browser caches ES modules against `python http.server`. **After editing any
`src/*.js`, a plain reload serves stale code.** Always force-refresh first:

```js
(async () => {
  const files = ['index.html','src/main.js','src/world.js','src/energy.js',
    'src/transport.js','src/ui.js','src/data.js','src/state.js','src/noise.js'];
  for (const f of files) await fetch('/' + f, { cache: 'reload' });
  location.reload();
})()
```

Verify the fix landed by checking the function source, e.g.
`window.DEBUG.canPlace.toString().includes('<new code>')`.

## In-game debug API (via preview_eval)

- `window.G` — the whole game state (see `src/state.js`): `G.money`, `G.supply`,
  `G.demand`, `G.batteryMWh`, `G.h2MWh`, `G.history` (48h of 15-min samples),
  `G.cities`, `G.industries`, `G.vehicles`, `G.firedTips`.
- `window.DEBUG` — `{ place, canPlace, tile, bulldoze, createRoute, buyVehicle, findPath, nameStation }`.
- `G.speed = 10` to fast-forward (1 game day ≈ 18 real seconds at 10×).

## Recipe: build a working freight line programmatically

```js
const D = window.DEBUG;
const mine = G.industries.find(i => i.type === 'mine');
// roads: place('road', i, j) tile by tile; water tiles become bridges.
// AVOID routing through building footprints (industries occupy 2×2) — check canPlace.
// stations need an adjacent road tile:
const s = D.place('truckStop', i, j); D.nameStation(s);
const r = D.createRoute(); r.stops.push(stopA, stopB);
const v = D.buyVehicle(r, 'truck');   // returns null if first stop has no road access
```

Then fast-forward and assert on: `G.incomeTransportToday > 0`, vehicle
`state`/`cargo`, industry `inStock`/`stock`/`running`.

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

## Waiting for sim time

Don't busy-poll preview_eval. Set `G.speed = 10`, wait with a background
`until [ -f /tmp/marker ]` + `(sleep N && touch /tmp/marker) &` pair, then
inspect once.
