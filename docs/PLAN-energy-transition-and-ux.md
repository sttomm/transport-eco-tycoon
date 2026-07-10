# Implementation plan — Energy transition arc + UX (July 2026)

Approved feature package (user decision 2026-07-10). Execute in a fresh session
with parallel subagents per the orchestration section at the bottom. Every
workstream follows CLAUDE.md's definition of done: tests → browser playtest →
docs → commit. **No big-bang merge — each feature lands as its own green
commit(s) on `main`.**

## Why (empirical basis, from headless sim experiments)

- The starter grid serves cleanly only ~4 days; from day 5 it blacks out
  4–24 h/day even in normal weather. Random Dunkelflautes (0.6 %/h after
  day 3) hit roughly weekly.
- A player who buys the full H₂ chain (~€220k) before day 4 still suffers
  ~20 h blackout in the first Dunkelflaute — tanks start empty. **There is
  currently no early-game defense.**
- Prototype numbers for the fossil bridge (validated headlessly): gas at
  €70/MWh fuel + 0.45 t CO₂/MWh has a carbon-price break-even of ~€33/t —
  above that it serves at a loss. 18 MW was undersized for the 8-city
  evening peak (~45 MW demand incl. industry); use ~30 MW.

## Feature specs

### F1 — Legacy fossil bridge (the centerpiece)

Story: the player inherits an old gas plant. It keeps the lights on early,
but a rising carbon price makes every MWh from it progressively worse — the
game becomes "phase this thing out without blackouts".

- **Building** `gas` in `data.js` BUILDINGS: `capMW: 30`, `upkeep: 400`,
  `fuelPerMWh: 70`, `co2PerMWh: 0.45`, flag `legacy: true` → **hidden from
  the build palette** (players must not be able to build more fossil; the
  teaching mission forbids solving scarcity with fossil expansion).
- **Placement**: in the `!loadedSave` starter block in `main.js`, near a city
  outskirt. Rendering: procedural mesh (box + smokestack + smoke puff when
  running) — **no new GLB** in v1 (see blender-headless-asset-traps memory).
- **Dispatch** (`energy.js` deficit branch, extends the pinned merit order):
  battery → fuel cell → **gas** → blackout. `gasMW = min(deficit, gasCap)`.
  Track `G.supply.gas`, `G.gasMWhToday`, `G.gasCostToday`.
- **Cost**: `gasMW × h × (fuelPerMWh + co2PerMWh × G.carbonPrice)` deducted
  from money each tick; revenue side unchanged (gas-served demand bills
  normally at the current power price). Net at start: 70 + 0.45×30 = €83.5
  vs €85 price → roughly break-even, then negative as carbon price rises.
- **Carbon price**: `G.carbonPrice`, starts €30/t, rises **€3 per game day**
  (tunable `CARBON` block in `data.js`). Shown in the dashboard with its
  trend ("€30/t, rising €3/day") — the road ahead must be visible.
- **CO₂ ledger**: new `G.co2EmittedTons` (gas) alongside existing
  `G.co2SavedTons`. Dashboard shows both.
- **Decommission**: button in the gas plant's infobox — one-time exit grant
  (€60k), plant removed, irreversible. Advisor tip on click explains the
  trade-off. New energy quest: **"Fossil-free week"** — 7 consecutive days
  with `gasMWhToday === 0` (works whether decommissioned or just unused) →
  €50k + celebration toast. This is the closest thing the game has to a win
  condition; make the toast feel like one.
- **Advisor tips** (data.js TIPS): first gas dispatch ("your legacy plant
  jumped in — at a loss of €X/MWh"), carbon price milestones (€50/€80),
  decommission, fossil-free week.
- **Save**: bump save version. Trap: the starter grid is placed only when
  `!loadedSave` — verify how starter placements interact with the save
  delta-replay before wiring decommission state in. Old saves (pre-gas) load
  without a gas plant; that's acceptable, they're mid-game survivors.
- **Tests**: extended merit order; fuel+carbon cost math; carbon ramp;
  decommission (grant paid, capacity gone, can't repeat); fossil-free
  counter resets on any gas use.
- **Docs**: `ENERGY-MODEL.md` gains a "Legacy gas & carbon price" section;
  `ARCHITECTURE.md` new ADR amending ADR 6 ("storage as only dispatchables"
  → "…plus a single legacy gas plant, phase-out is the game arc");
  README feature list.

### F2 — Weather forecast

Turns the Dunkelflaute from an ambush into a planning problem.

- **Sim**: weather events currently start instantly on the hourly roll.
  Change: the roll *schedules* a front instead — `G.weatherFront = { type:
  'dunkelflaute'|'storm', inHours: 10–14, durationH }`; `updateWeather`
  counts it down and applies it at zero. Forecast object `G.forecast`:
  next-24h solar window (deterministic from season), wind trend (the mean-
  reversion target), plus the scheduled front if any.
- **UI**: forecast strip in the dashboard (next 24–48 h, sun/wind icons) +
  a warning banner while a front is inbound ("⚠ Dunkelflaute in ~12 h —
  est. 40 h"). The existing `dunkelflaute` tip moves to fire at *schedule*
  time, not arrival ("charge everything now").
- **Tests**: lead time honored (front applies only after countdown); the
  forced-event debug path `G.dunkelflaute = 40` still works immediately
  (playtest recipes depend on it); forecast object shape.
- **Docs**: ENERGY-MODEL weather section; short ADR note (events get lead
  time — affects the day-3 grace analysis).

### F7 — Daily report card

- **Sim**: new `closeDay()` in the sim (called from the existing day-
  rollover in `main.js` next to `dailyUpkeep`) aggregates: energy income,
  transport income (per kind), upkeep, loan interest, gas cost, CO₂ emitted/
  avoided, blackout hours, curtailed MWh → pushes onto `G.reports` (keep 7)
  and emits `'dayReport'`.
- **UI**: dismissible end-of-day toast card + a "Yesterday" block at the top
  of the Dashboard tab. One advisor sentence chosen by priority rules:
  blackout hours > gas losses > storm/flaute recap > curtailment > "all
  green". Must not interrupt gameplay (no pause, auto-fade ~8 s).
- **Tests**: aggregation matches the daily counters; counters reset after
  close; report ring buffer caps at 7.

### F4 — Smart Market event (user's design: announced day 8, live day 10)

- **Timeline** (`MARKET` block in `data.js`): day 8 — announcement banner +
  advisor tip: *"pressure on the energy market is rising; in 2 days the
  regulator introduces the Smart Market — prices will follow supply and
  demand, making intelligent use of energy profitable."* Day 10 — activation
  tip + the flat €85/MWh is replaced by a dynamic price.
- **Price rule** (v1, teachable, in priority order):
  - unserved demand > 0 → scarcity price **€240**
  - gas running → **gas marginal cost + €15** (the merit-order lesson: the
    most expensive running plant sets the price)
  - curtailing surplus → **€25**
  - otherwise interpolate **€45→€120** by residual load (demand − renewables)
    relative to the evening peak.
  Revenue = billable MW × current price. Battery/fuel-cell discharge during
  scarcity now earns real money → storage arbitrage becomes the business
  model, exactly what the event announcement promises.
- **UI**: live €/MWh ticker in the topbar (color-coded), price line added to
  the dashboard history chart, tips for first scarcity-price battery
  discharge ("your battery just sold at €240/MWh").
- **Balance check** (before commit): 15-day headless run — total income
  within ±30 % of the pre-change baseline; if it explodes/crashes, tune the
  band constants, not the mechanism.
- **Tests**: flat price before day 10; announcement fires day 8; each price
  band; revenue math.
- **Docs**: new ADR (dynamic pricing supersedes the "no dynamic pricing"
  limitation note); ENERGY-MODEL pricing section; README.

### F3 — Climate feedback (CO₂ ledger consequences)

- **Sim**: extreme-event probability multiplier `1 + co2EmittedTons /
  CLIMATE.scaleTons`, capped at 2×, applied to storm rolls and the new
  **heatwave** event (summer only, 18–30 h: city demand +30 % (AC), wind
  low). Keep it gentle — teaching, not punishment; all constants in
  `data.js` CLIMATE.
- **UI**: "Climate" box in the dashboard: emitted vs avoided CO₂, event-risk
  indicator (calm/elevated/high). Advisor tips: first heatwave, first time
  risk goes elevated ("your gas habit is loading the weather dice").
- **Tests**: heatwave demand effect; multiplier math; summer-only gating.
- **Docs**: ENERGY-MODEL climate section; ADR note; README.

### F-UX — Routes panel cleanup (user's design)

- **Sim** (`transport.js`): `routeKind(route)` derived from stop station
  types — bus stops → `'bus'`, rail stations → `'rail'`, freight depots →
  `'cargo'` (mixed stop types: pick by majority, tie → `'cargo'`).
  `buyVehicle` **rejects** a vehicle whose kind doesn't match the route's
  kind (bus routes can't get trains etc.) — sim-level validation, not just
  UI hiding. Track per-route `cargoCarried` (set of cargo types actually
  delivered) for filtering.
- **UI** (routes tab): grouped, collapsible sections 🚌 Bus / 🚆 Rail /
  🚚 Cargo with counts; filter chips (All + per group); for cargo routes an
  additional filter by transported good; vehicle-buy buttons show only
  matching kinds. Existing per-route finance rows stay.
- **Migration**: existing saves may contain mismatched routes (e.g. a truck
  on a route that now derives as `'bus'`); grandfather existing vehicles —
  validation applies to *new* purchases only.
- **Tests**: kind derivation incl. mixed; buyVehicle rejection; cargoCarried
  tracking; grandfathering.
- **Docs**: README (routes section).

## Out of scope (backlog, explicitly not in this round)

Milestone-gated build-palette unlocks · H₂ offtake/e-fuel export industry ·
vehicle aging & auto-replace · grid-import interconnector · demand-response
tech. Proposed 2026-07-10, parked pending a later decision.

## Orchestration for the implementing session

Use parallel subagents in **git worktrees** (isolation: worktree), one per
workstream. Main thread owns Phase 0, merges, and final verification.

**Phase 0 (main thread, one commit).** Read this plan + CLAUDE.md + the
three project skills. Write the ADR entries (F1 amendment, F4 pricing ADR)
and pin the shared `G`-field contract so parallel agents don't collide:
`carbonPrice`, `co2EmittedTons`, `gasMWhToday`, `gasCostToday`,
`supply.gas`, `weatherFront`, `forecast`, `reports`, `marketLive`,
`price`. Commit: `docs: ADRs + G-field contract for energy-transition arc`.

**Phase 1 (parallel: 3 subagents).**
- **A — F1 fossil bridge** (energy.js, data.js, main.js, hud/infobox,
  quests, tests, docs)
- **B — F-UX routes panel** (transport.js, ui routes tab, tests) — fully
  disjoint from A
- **C — F7 daily report** (state fields per contract, closeDay(), ui,
  tests) — depends only on the Phase-0 field names

Merge order **A → B → C** (rebase B/C before merging; C picks up A's real
cost fields at rebase). Each merge: `npm test` + playtest + own commit(s),
suggested: `Legacy gas plant, carbon price and phase-out quest (ADR 21)`,
`Routes panel: group by kind, vehicle-type validation, cargo filters`,
`Daily report card`.

**Phase 2 (parallel: 2 subagents, after A is merged).**
- **D — F2 forecast** (updateWeather scheduling + forecast UI)
- **E — F4 smart market** (pricing in tickGrid + ticker/chart UI; uses gas
  marginal cost from A)

D and E touch different functions of energy.js — merge **D first**, E
rebases. Commits: `Weather fronts with 12h lead time + forecast strip`,
`Smart Market: dynamic electricity pricing event (day 8 announce, day 10
live) (ADR 22)`.

**Phase 3 (single subagent or main thread).**
- **F — F3 climate feedback** (needs A's ledger + D's event scheduling).
  Commit: `Climate feedback: CO₂-driven extreme weather + heatwave event`.
- Final pass: 20-day headless balance run (fresh state, forced flaute day 4,
  market live day 10) — income sane, no chronic blackout with gas, gas
  losses grow over time; full browser playtest of the arc; README sweep;
  save-version sanity (new game + load old save).

**Per-workstream ground rules** (from CLAUDE.md + memories, binding):
- Sim changes never import THREE/DOM; content/tuning numbers go in
  `data.js`.
- Teaching invariants stay: solar at night = 0, storms cut turbines,
  Dunkelflaute defeats battery-only grids — and new: **fossil must never be
  the profitable long-run answer** (assert gas margin < 0 once carbonPrice >
  €35/t).
- `npm test` after every change; register event listeners after
  `resetState()`, not before.
- Browser verification via the `playtest-game` skill: force-refresh the
  module cache first; the user may be PLAYING in the shared preview tab —
  snapshot/restore `G.speed`, never `clearSave()` over real progress.
- Save-version bump once (not per feature) — coordinate in Phase 0.
