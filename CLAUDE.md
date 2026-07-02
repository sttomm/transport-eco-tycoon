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
- New game rules go in `src/sim/` — if a change there needs a DOM or THREE
  import, it's in the wrong layer. New visuals react to state/events.
- Game content (buildings, vehicles, industries, techs, advisor tips) is
  data in `src/sim/data.js`, not code.

## Definition of done — every feature or fix

1. **Tests updated.** New sim behavior gets new assertions in `test/`
   (Node built-in runner, no deps). Changed behavior updates the pinned
   expectations. `npm test` must pass (~100 ms, run it constantly).
2. **Manually verified in the browser** via the preview server — use the
   `playtest-game` skill (start server, force-reload modules, drive the game
   through `window.DEBUG` / `window.G`, check console for errors).
3. **Docs stay true.** Energy numbers → `docs/ENERGY-MODEL.md`; architecture
   decisions → `docs/ARCHITECTURE.md`; player-visible features → `README.md`.
4. **Commit** with a descriptive message — only after 1–3 pass. Never commit
   red tests or an unverified change.

## Project skills (read the matching one before starting)

- `playtest-game` — run/debug/verify in the browser; the DEBUG API and the
  module-cache force-reload trick.
- `add-game-content` — checklists for new buildings, industries, vehicles,
  techs, tips.
- `tune-energy-model` — invariants of the grid simulation (merit order,
  units, efficiencies) and verification recipes.

## Traps that aren't obvious from the code

- Browsers cache ES modules; after edits, a plain reload can run a stale mix.
  Always force-refresh (see `playtest-game`).
- The world is deterministic from `WORLD_SEED`; saves store only player
  deltas and replay them through `place()`/`buyVehicle()`. If you change
  worldgen, old saves silently mis-restore — bump the save version.
- `G` is reset between tests with `resetState()`; register event listeners
  after reset, not before.
- The teaching mission outranks balance: solar at night must be zero, storms
  must cut out turbines, Dunkelflaute must defeat battery-only grids.
