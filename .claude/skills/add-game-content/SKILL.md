---
name: add-game-content
description: Add new content to Transport Eco Tycoon — buildings/power plants, industries, cargo types, vehicles, research techs, or advisor teaching tips. Use when asked to add, extend or rebalance game content.
---

# Adding content to Transport Eco Tycoon

All content is data-driven from `src/sim/data.js`. Most additions are: data
entry → mesh branch → test → done. Keep `docs/ENERGY-MODEL.md` in sync when
numbers have a real-world anchor, and add an advisor tip if the content
teaches something. Every addition extends `test/` (see CLAUDE.md).

## New buildable (power plant / storage / station)

1. **`src/sim/data.js` → `BUILDINGS`**: add entry with `name, icon, cost, upkeep,
   footprint, category` (`energy`|`storage`|`transport` — decides toolbar group) and
   the capability field the sim reads:
   - generator: `capMW` (then wire its output in `src/sim/energy.js#tickGrid` — only
     solar/wind/hydro exist, a new type needs a term there)
   - battery-like: `storeMWh` + `rateMW` · electrolyzer-like: `elecMW`
   - H₂ tank: `h2MWh` · fuel cell: `fcMW`
   - station: `nearRoad: true` (or `nearRail`) · water-bound: `nearWater: true`
   - `desc` doubles as tooltip AND teaching text — include the real-world fact.
2. **`src/render/meshes.js` → `buildPlantMesh(type)`**: add a low-poly mesh branch.
   Use the `box()`/`cyl()`/`M()` helpers; sizes ~1-14 units, origin at ground
   center. Animated parts: expose via `group.userData` like the wind turbine's
   `rotor` (spun in `src/render/world.js#updateWorldRender`).
3. Capacity registration/deregistration on place/bulldoze is automatic for the
   capability fields above (`src/sim/grid.js#place`/`bulldoze`).
4. Add a one-shot teaching tip in `TIPS` and fire it from the `plantBuilt`
   listener map in `src/ui/hud.js#initUI`.
5. **Test**: extend `test/grid.test.js` (placement rule + capacity
   registration) and `test/energy.test.js` if it generates or stores.

## New industry + cargo chain

1. `src/sim/data.js → CARGO`: `{ name, color, pay }`.
2. `src/sim/data.js → INDUSTRY_TYPES`: `{ name, icon, powerMW, produces, rate,
   accepts, perOutput, desc }`. `accepts: null` = primary producer.
3. `src/sim/grid.js → buildIndustries()`: add a spawn location to `spots` (check
   it's on grass, away from the river ~ i≈55-79 unless intended). Mesh branch in
   `src/render/meshes.js → buildIndustryMesh(type)`.
4. Delivery acceptance: `src/sim/transport.js#stationAccepts` — cargo sold to
   cities must be added to the city set there AND in `arriveAtStation`'s unload
   logic (incl. its `G.stats` counter if a quest should track it).
5. Production loop is generic (`src/sim/transport.js#tickIndustries`); special
   behavior (like steel's H₂ boost) goes there.
6. **Test**: `test/transport.test.js` — use `fakeIndustry()` from
   `test/helpers.js` to place the chain next to depots and assert the haul.

## New vehicle

`src/sim/data.js → VEHICLES`: `{ name, icon, cost, upkeep, capacity, speed,
batteryKWh, usePerTile, chargeMW, desc }` + mesh branch in
`src/render/meshes.js#buildVehicleMesh`. Buy buttons in the routes panel are
generated per kind in `src/ui/hud.js#renderRoutes` (extend the
`['truck','bus','train']` list). Capacity rules live in
`src/sim/transport.js#paxCapacity`/`freightCapacity`.
**Test**: `test/vehicles.test.js`.

## New research tech

`src/sim/data.js → TECHS`: `{ id, name, cost, days, cat, req?, fx: m => ..., desc }`.
`fx` mutates `G.mult` once on completion. Available multipliers:
`solar, wind, batteryCap, elecEff, fcEff, cityDemand, industryDemand,
vehicleUse, vehicleSpeed, chargeRate` (see `src/sim/state.js`). A new multiplier
must be read somewhere in `sim/energy.js`/`sim/transport.js` to have an effect.
`desc` must cite the real technology (the research tree is part of the teaching).
**Test**: `test/energy.test.js` has a multiplier example.

## Balance guardrails

- Starting money €600k; a starter kit (~€300k of plants) is placed in
  `main.js`. New content should be affordable mid-game, not turn one.
- City demand ~8-11 MW total at start; the steel works (13 MW) is deliberately
  the biggest single load — don't dwarf it casually.
- Energy price €85/MWh and cargo `pay` rates set the two income streams to
  rival each other (requirement: both games matter).

## Verify

`npm test` first. Then the `playtest-game` skill: place the new content via
`window.DEBUG`, fast-forward, assert on sim state. Remember the module-cache
force-refresh.
