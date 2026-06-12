---
name: add-game-content
description: Add new content to Transport Eco Tycoon — buildings/power plants, industries, cargo types, vehicles, research techs, or advisor teaching tips. Use when asked to add, extend or rebalance game content.
---

# Adding content to Transport Eco Tycoon

All content is data-driven from `src/data.js`. Most additions are: data entry
→ (mesh) → done. Keep `docs/ENERGY-MODEL.md` in sync when numbers have a
real-world anchor, and add an advisor tip if the content teaches something.

## New buildable (power plant / storage / station)

1. **`src/data.js` → `BUILDINGS`**: add entry with `name, icon, cost, upkeep,
   footprint, category` (`energy`|`storage`|`transport` — decides toolbar group) and
   the capability field the sim reads:
   - generator: `capMW` (then wire its output in `energy.js#tickGrid` — only
     solar/wind/hydro exist, a new type needs a term there)
   - battery-like: `storeMWh` + `rateMW` · electrolyzer-like: `elecMW`
   - H₂ tank: `h2MWh` · fuel cell: `fcMW`
   - station: `nearRoad: true` · water-bound: `nearWater: true`
   - `desc` doubles as tooltip AND teaching text — include the real-world fact.
2. **`src/world.js` → `buildPlantMesh(type)`**: add a low-poly mesh branch.
   Use the `box()`/`cyl()`/`M()` helpers; sizes ~1-14 units, origin at ground
   center. Animated parts: see the wind turbine's `userData.rotor` pattern.
3. Capacity registration/deregistration on place/bulldoze is automatic for the
   capability fields above (`world.js#place`/`bulldoze`).
4. Add a one-shot teaching tip in `TIPS` and fire it from the `plantBuilt`
   listener map in `src/ui.js#initUI`.

## New industry + cargo chain

1. `data.js → CARGO`: `{ name, color, pay }`.
2. `data.js → INDUSTRY_TYPES`: `{ name, icon, powerMW, produces, rate,
   accepts, perOutput, desc }`. `accepts: null` = primary producer.
3. `src/world.js → buildIndustries()`: add a spawn location to `spots` (check
   it's on grass, away from the river ~ i≈55-79 unless intended), and a mesh
   branch in `buildIndustryMesh(type)`.
4. Delivery acceptance: `transport.js#stationAccepts` — cargo sold to cities
   must be added to the city set there AND in `arriveAtStation`'s unload logic.
5. Production loop is generic (`transport.js#tickIndustries`); special
   behavior (like steel's H₂ boost) goes there.

## New vehicle

`data.js → VEHICLES`: `{ name, icon, cost, upkeep, capacity, speed,
batteryKWh, usePerTile, chargeMW, desc }` + mesh branch in
`transport.js#buildVehicleMesh`. Buy buttons in the routes panel are generated
from the `VEHICLES` keys (`ui.js#renderRoutes` hardcodes `['truck','bus']` —
extend that list).

## New research tech

`data.js → TECHS`: `{ id, name, cost, days, cat, req?, fx: m => ..., desc }`.
`fx` mutates `G.mult` once on completion. Available multipliers:
`solar, wind, batteryCap, elecEff, fcEff, cityDemand, industryDemand,
vehicleUse, vehicleSpeed, chargeRate` (see `state.js`). A new multiplier must
be read somewhere in `energy.js`/`transport.js` to have an effect.
`desc` must cite the real technology (the research tree is part of the teaching).

## Balance guardrails

- Starting money €600k; a starter kit (~€300k of plants) is placed in
  `main.js`. New content should be affordable mid-game, not turn one.
- City demand ~8-11 MW total at start; the steel works (13 MW) is deliberately
  the biggest single load — don't dwarf it casually.
- Energy price €85/MWh and cargo `pay` rates set the two income streams to
  rival each other (requirement: both games matter).

## Verify

Use the `playtest-game` skill: place the new content via `window.DEBUG`,
fast-forward, assert on sim state. Remember the module-cache force-refresh.
