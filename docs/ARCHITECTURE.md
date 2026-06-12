# Architecture & Design Decisions

## Overview

```
index.html              UI shell (DOM panels, CSS, import map)
src/
  state.js              single shared mutable state object `G` + tiny event emitter
  data.js               ALL game data: buildings, vehicles, industries, techs, tips
  noise.js              seeded value-noise (terrain, masks) — deterministic worlds
  world.js              terrain/river/cities/industries, meshes, placement, ambient life
  energy.js             weather + grid dispatch simulation
  transport.js          A* pathfinding, stations, routes, vehicles, industry production,
                        passenger demand pools + demand overlay + floating income FX
  quests.js             objective chains (transport / freight / energy) + quest panel
  ui.js                 HUD, dashboard charts, research, routes panel, advisor toasts
  main.js               renderer, lighting/day-night, camera (mouse + WASD/arrows), game loop
```

Data flow per frame (`main.js#frame`):

```
real dt → game minutes (8 min/s × speed)
  updateWeather → tickGrid → tickIndustries → tickVehicles → tickCities
  → tickResearch → sampleHistory
  updateWorld (ambient cars/peds, turbine spin) → updateDayNight → render → updateUI
```

## Key decisions (ADR-style)

### 1. Browser + Three.js, no build step
**Decision:** Plain ES modules, Three.js via CDN import map, served statically.
**Why:** "Run instantly on the user's machine" beat tooling comfort. No
node_modules, no bundler config, no version churn; `python3 -m http.server` is
the whole toolchain. Three.js gives the modern look (PCF soft shadows, ACES
tonemapping, fog, emissive night windows) at zero install cost.
**Trade-off:** no TypeScript, no tree-shaking, CDN needed on first load.
**Consequence for contributors:** browsers cache modules aggressively against
`http.server`; force-refresh with `fetch(file, {cache:'reload'})` then reload
(see the `playtest-game` skill).

### 2. One shared state object instead of ECS/framework
**Decision:** `state.js` exports a single mutable `G`; modules import and
mutate it. A 5-line emitter (`on`/`emit`) decouples sim events from UI
(advisor tips, build notifications).
**Why:** The sim is small (a few hundred entities); an ECS or store layer
would be ceremony. Everything inspectable as `window.G` in DevTools — which is
also how the game is play-tested programmatically.

### 3. All tuning data lives in `data.js`
**Decision:** buildings, vehicles, industry chains, research tree, advisor
texts and encyclopedia are pure data in one file.
**Why:** The teaching mission means numbers get revised against reality often;
balance changes must not require touching sim code. The file's header comment
documents the real-world anchor for every number.

### 4. Single "copper plate" grid, no transmission
**Decision:** One region-wide energy balance; no power lines or grid topology.
**Why:** The lesson hierarchy is: (1) variability of renewables, (2) storage
economics (battery vs H₂), (3) flexible demand. Transmission is lesson #4 and
would double UI complexity (line building, congestion). Deliberately deferred
— see roadmap.

### 5. Merit-order dispatch with storage as the only dispatchables
**Decision:** every tick: renewables → (surplus: battery charge → electrolyzer
→ curtail) / (deficit: battery discharge → fuel cell → blackout).
**Why:** This mirrors how a 100%-renewable grid actually balances, and each
branch of the dispatch IS a teaching moment (curtailment tip, blackout tip,
flexible-demand tip). The electrolyzer is modeled as *flexible load that only
consumes surplus* — the single most important modern-grid concept the game
teaches.

### 6. The player is the utility
**Decision:** cities & industries pay the player €85/MWh served; blackouts
forfeit revenue, halt industry and shrink cities.
**Why:** In OpenTTD energy would be a cost line; making it a *revenue stream*
makes the energy game a first-class economic loop instead of a chore, and
naturally rewards reliability — exactly the real-world incentive.

### 7. Tile world + graph roads, full 3D rendering
**Decision:** 96×96 logical tile grid (placement, A*, occupancy) under a
continuous displaced-plane terrain; cities generate their own street grids
which player roads connect to; rivers crossable via bridges (5× road cost).
**Why:** Tiles keep simulation and placement trivial (OpenTTD heritage);
the smooth mesh + lighting carry the visual ambition. Vehicles do A* over
road tiles, so player roads, city streets and bridges form one network.

### 8. Ambient life is cosmetic and instanced
**Decision:** ambient cars/pedestrians are `InstancedMesh` agents doing random
walks on street tiles (peds drift toward bus stops), count scaled by
population. They are not simulated citizens.
**Why:** The requirement is the world *feels* alive. Agent-based citizen sim
(CS2-style) costs enormous complexity for no teaching value. Two instanced
draw calls give hundreds of moving entities at negligible cost.

### 9a. Passengers are demand pools with destinations
**Decision:** each city accumulates travellers (60% local, 40% split to the
other cities); they walk to a bus stop only if a vehicle-staffed route through
that stop can actually deliver them (local = 2nd stop ≥5 tiles away in the same
city; intercity = a stop near the destination). Buses carry typed groups and
get paid per delivered passenger (€9 local / €24 intercity, distance bonus).
**Why:** "carry pax between two cities" alone made intra-city lines useless and
demand invisible. Pools + the 👥 demand overlay (V) turn passenger work into a
read-the-map puzzle, and the no-clogging rule keeps stops from filling with
travellers nobody serves.

### 9b. Quest chains as guidance
**Decision:** `quests.js` defines three parallel objective chains (bus lines →
intercity; grain → food → ore → steel; storage → hydrogen → research → CO₂)
with progress bars and cash rewards, rendered in an always-visible panel.
**Why:** Playtesting showed the sandbox needs direction: quests sequence the
teaching arc (transport first, then the grid grows with the load) without
gating the sandbox.

### 9. Teaching via event-triggered advisor, not tutorial gates
**Decision:** ~15 one-shot tips fire when the *simulation* first produces the
phenomenon (first curtailment, first blackout, Dunkelflaute warning, storm
cut-out…), plus a passive encyclopedia tab.
**Why:** Concepts land when the player just experienced them. No forced
tutorial sequence; the game stays a sandbox.

### 10. Time scale
**Decision:** 1 game day = 3 real minutes at 1× (speeds ×1/×3/×10, pause).
**Why:** Solar's day cycle is the core rhythm; it must be observable within a
play session, but slow enough that the dashboard's 48 h window reads as a
story (duck curve, night discharge, Dunkelflaute survival).

## Known limitations / roadmap

- No save/load yet (state is one object — localStorage serialization is the
  natural next step)
- No rail/trains or ships
- Transmission constraints (ADR #4) deferred
- No seasons — winter solar droop is the strongest real-world argument for
  hydrogen and would deepen the lesson
- Road L-path drag can silently skip blocked tiles (preview shows red, but a
  gap check would be friendlier)
