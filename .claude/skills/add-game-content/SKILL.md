---
name: add-game-content
description: Add new content to Transport Eco Tycoon — buildings/power plants, industries, cargo types, vehicles, research techs, or advisor teaching tips. Use when asked to add, extend or rebalance game content.
---

# Adding content to Transport Eco Tycoon

All content AND tuning constants are data-driven from `src/sim/data.js`
(buildings, vehicles, industries, techs, tips, plus the PAX/CITY/FREIGHT/
MARKET/TARIFF/CLIMATE/AGING knob blocks — rebalances should touch data.js
only). Most additions are: data entry → mesh branch → test → done. Keep
`docs/ENERGY-MODEL.md` in sync when numbers have a real-world anchor, and add
an advisor tip if the content teaches something. Every addition extends
`test/` (see CLAUDE.md).

## New buildable (power plant / storage / station)

1. **`src/sim/data.js` → `BUILDINGS`**: add entry with `name, icon, cost, upkeep,
   footprint, category` (`energy`|`storage`|`transport` — decides toolbar group) and
   the capability field the sim reads:
   - generator: `capMW` (then wire its output in `src/sim/energy.js#tickGrid` — only
     solar/wind/hydro exist, a new type needs a term there)
   - battery-like: `storeMWh` + `rateMW` · electrolyzer-like: `elecMW`
   - H₂ tank: `h2MWh` · fuel cell: `fcMW`
   - grid import: `importMW` (ADR 25) · H₂ offtake: `offtakeMW` (ADR 26)
   - station: `nearRoad: true` (or `nearRail`) · water-bound: `nearWater: true`
   - `desc` doubles as tooltip AND teaching text — include the real-world fact.
   - if the building should be *earned*, add an entry to `UNLOCKS` (data.js,
     ADR 28) with a `when(G)` predicate + player-facing `hint` — the palette
     greys it out until then; `place()` itself is never gated.
2. **`src/render/meshes.js` → `buildPlantMesh(type)`**: add a low-poly mesh branch
   (fallback look). Use the `box()`/`cyl()`/`M()` helpers; sizes ~1-14 units,
   origin at ground center. Animated parts: expose via `group.userData` like
   the wind turbine's `rotor` (spun in `src/render/buildings.js`). For a real
   glTF asset, see the `edit-graphics` skill.
3. Capacity registration/deregistration on place/bulldoze is automatic for the
   capability fields above (`src/sim/grid.js#place`/`bulldoze`).
4. Add a one-shot teaching tip in `TIPS` and fire it from the `plantBuilt`
   listener map in `src/ui/hud.js#initUI`.
5. **Test**: extend `test/grid.test.js` (placement rule + capacity
   registration — read `BUILDINGS.x.capMW` etc. in assertions, don't pin
   literals) and `test/energy.test.js` if it generates or stores.

## New industry + cargo chain

1. `src/sim/data.js → CARGO`: `{ name, color, pay }`.
2. `src/sim/data.js → INDUSTRY_TYPES`: `{ name, icon, powerMW, produces, rate,
   accepts, perOutput, desc }`. `accepts: null` = primary producer.
3. `src/sim/grid.js → buildIndustries()`: add a spawn location to `spots` (check
   it's on grass, away from the river ~ i≈132-140 unless intended). Mesh branch
   in `src/render/meshes.js → buildIndustryMesh(type)`.
4. Delivery acceptance: `src/sim/stations.js#stationAccepts` — cargo sold to
   cities must be added to the city set there AND in
   `src/sim/transport.js#arriveAtStation`'s unload logic (incl. its `G.stats`
   counter if a quest should track it).
5. Production loop is generic (`src/sim/industries.js#tickIndustries`); special
   behavior (like steel's H₂ boost) goes there.
6. **Test**: `test/transport.test.js` — use `fakeIndustry()` from
   `test/helpers.js` to place the chain next to depots and assert the haul.

## New vehicle

`src/sim/data.js → VEHICLES`: `{ name, icon, cost, upkeep, capacity, speed,
batteryKWh, usePerTile, chargeMW, desc }` + mesh branch in
`src/render/meshes.js#buildVehicleMesh`. Buy buttons in the routes panel are
generated per kind in `src/ui/hud/routes.js` (extend `KIND_BUTTONS`; the
purchase path is `purchaseVehicle` in `src/sim/transport.js`). Capacity rules
live in `src/sim/transport.js#paxCapacity`/`freightCapacity`.
**Test**: `test/vehicles.test.js`.

## New research tech

`src/sim/data.js → TECHS`: `{ id, name, cost, days, cat, req?, fx: m => ..., desc }`.
Progression logic lives in `src/sim/research.js` (`startResearch`/`tickResearch`);
`fx` mutates `G.mult` once on completion. Available multipliers:
`solar, wind, batteryCap, elecEff, fcEff, cityDemand, industryDemand,
vehicleUse, vehicleSpeed, chargeRate, demandResponse` (see `src/sim/state.js`).
A new multiplier must be read somewhere in `sim/energy.js`/`sim/transport.js`
to have an effect. `desc` must cite the real technology.
**TRAP:** an optional `apply(G)` hook retrofits already-built things (see LFP)
— but on save-restore only `fx` is replayed, never `apply` (the multiplier
must exist before `place()` replays builds). Design `apply` so skipping it on
load is correct, or store its outcome in the save.
**Test**: `test/research.test.js` (start/refusals/completion) and
`test/energy.test.js` for the multiplier's effect.

## Persisting new state (fields on G or on saved entities)

1. Add the field to `snapshot()` in `src/sim/save.js`.
2. Restore it with a default so older v5 saves still load: `G.x = d.x || 0`.
3. Add a round-trip assertion to `test/save.test.js`.
4. **No version bump** for plain field additions. Bump `v` (and reject older
   saves) ONLY when worldgen changes — see the version policy in
   `docs/ARCHITECTURE.md` ("Persistence") and the frozen-KEY note in save.js.

## New sim → view event

`emit('name', payload)` in the sim module; `on('name', fn)` in the view's init
function (render or ui). Add the event to the table in `docs/ARCHITECTURE.md`.
In tests, register listeners AFTER `resetState()` — it wipes `G.listeners`.

## Balance guardrails

- Starting money €600k; the starter kit (~€300k of plants incl. the legacy
  gas bridge) is placed by `src/sim/newGame.js`. New content should be
  affordable mid-game, not turn one.
- Flat tariff €85/MWh until day 10, then the Smart Market prices each tick
  (data.js MARKET, ADR 22) — net of windfall levy + €18/MWh grid fee
  (TARIFF) and €500/MWh blackout compensation (VOLL, ADR 30). Don't re-tune
  the economy by feel: extend `test/integration.test.js` with a headless
  policy run instead.
- City demand ~23 MW evening peak across 8 cities; the steel works is
  deliberately the biggest single industrial load.

## Verify

`npm test` first. Then the `playtest-game` skill: place the new content via
`window.DEBUG`, fast-forward with `DEBUG.tickSim`, assert on sim state.
Remember the module-cache force-refresh.
