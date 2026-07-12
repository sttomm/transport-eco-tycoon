# Transport Eco Tycoon — working rules

Browser tycoon game teaching renewable-grid economics. No build step, no
dependencies: plain ES modules + Three.js from CDN. The code is meant to be
self-explanatory — this file only pins the rules that aren't visible in any
single file.

## Layering (the one architectural rule)

```
src/sim/     game logic. NEVER imports three.js or touches the DOM. Tested in Node.
src/render/  Three.js views. Read state G + subscribe to sim events. No game rules.
src/ui/      DOM panels & pointer input. Call sim functions. No game rules.
src/main.js  composition root + frame loop. The only file that knows all layers.
```

- Shared state is the single object `G` (`src/sim/state.js`); sim → view
  communication is the `emit`/`on` event bus in the same file.
- `src/sim/tick.js#tickSim()` is the heartbeat: clock, pinned tick order, day
  rollover. Extend the pipeline THERE (never in main.js) — tests and playtest
  fast-forward drive the same function.
- New game rules go in `src/sim/` — if a change there needs a DOM or THREE
  import, it's in the wrong layer. New visuals react to state/events.
- Game content AND tuning knobs (buildings, vehicles, industries, techs,
  tips, PAX/CITY/MARKET/… constant blocks) are data in `src/sim/data.js`,
  not code.
- Module map + all design decisions (ADRs 1–33): `docs/ARCHITECTURE.md`.

## Definition of done — every feature or fix

1. **Tests updated.** New sim behavior gets new assertions in `test/`
   (Node built-in runner, no deps). Changed behavior updates the pinned
   expectations. `npm test` must pass (~100 ms, run it constantly).
2. **Manually verified in the browser** via the preview server — use the
   `playtest-game` skill (start server, force-reload modules, drive the game
   through `window.DEBUG` / `window.G`, check console for errors).
3. **Docs stay true.** Energy numbers → `docs/ENERGY-MODEL.md`; architecture
   decisions → `docs/ARCHITECTURE.md`; player-visible features → `README.md`.
   `test/architecture.test.js` ENFORCES the layering, the module map, the
   event table and file budgets — when it fails, do what its message says
   (update the doc / split the file); never weaken or delete a guard.
4. **Commit** with a descriptive message — only after 1–3 pass. Never commit
   red tests or an unverified change.

## Project skills (read the matching one before starting)

- `playtest-game` — run/debug/verify in the browser; the DEBUG API and the
  module-cache force-reload trick.
- `add-game-content` — checklists for new buildings, industries, vehicles,
  techs, tips — plus how to persist new fields and add bus events.
- `tune-energy-model` — invariants of the grid simulation (merit order,
  units, efficiencies) and verification recipes.
- `edit-graphics` — render-layer map, the glTF/Blender asset pipeline and its
  name/material contracts, look verification.

## Traps that aren't obvious from the code

- Browsers cache ES modules; after edits, a plain reload can run a stale mix.
  Always force-refresh (see `playtest-game`).
- The world is deterministic from `WORLD_SEED`; saves store only player
  deltas and replay them through `place()`/`buyVehicle()`. If you change
  worldgen, old saves silently mis-restore — bump the save version.
- `G` is reset between tests with `resetState()`; register event listeners
  after reset, not before. Test helpers: `freshWorld()`, `playDays()` (full
  pipeline incl. rollovers), `scriptRandom()` — see `test/helpers.js`.
- Units: grid power is **MW**, storage is **MWh** (convert via `gameHours`),
  vehicle packs are **kWh** (×1000). Mixing them is a silent 60×/1000× bug.
- Tests assert against `data.js` constants (`BUILDINGS.x.cost`,
  `CITY.weights…`), not hard-coded literals — rebalances must not break
  structure tests.
- The teaching mission outranks balance: solar at night must be zero, storms
  must cut out turbines, Dunkelflaute must defeat battery-only grids
  (pinned every tick by `test/integration.test.js`).
