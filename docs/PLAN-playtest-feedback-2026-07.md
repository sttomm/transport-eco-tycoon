# Plan: Playtest feedback round — 2026-07-12

Source: full playtest brain dump by Stefan on 2026-07-12. ~35 feedback items
split into 10 work packages (WP1–WP10), ordered by dependency, each sized for
one focused session / one sub-agent. Design decisions below are grounded in a
code exploration pass (file:line anchors verified 2026-07-12).

Every package follows the repo's definition of done (CLAUDE.md): tests in
`test/`, browser verification via the `playtest-game` skill, docs updated,
then commit. Layering rule applies throughout: game rules in `src/sim/`,
visuals in `src/render/`, DOM in `src/ui/`.

**Model legend** — `Opus 4.8`: cross-layer design, new data models, balance
work. `Sonnet 5`: well-scoped mechanical/polish work with a clear spec.

---

## Cross-cutting decisions (read before any WP)

**D-A · One save bump, v5 → v6, additive.** WP1 (news history), WP3
(ledger), WP4 (contract history), WP5 (route lifetime counters) all add
persisted fields. Whoever lands first increments `v: 5` → `6` in
`snapshot()`/`restore()` (`src/sim/save.js:46,91`) and makes `restore()`
**accept v5 with defaults for missing fields** (non-worldgen bump = additive
migration, per the versioning comment block save.js:11-29). Later WPs add
fields inside v6 with the same default-if-missing rule. Never a second bump
this round.

**D-B · A shared modal helper is extracted first.** `welcome.js` already has
the full pattern: overlay `position:absolute;inset:0;z-index:50` +
backdrop-blur (styles.css:192-196), pause via `G._lastSpeed = G.speed;
G.speed = 0` (welcome.js:92-93), and keybind suppression via DOM-presence
check (`hud.js:66`). WP1 extracts this into `src/ui/hud/modal.js`:
`openModal({title, bodyEl, onClose, pause: true})` / `closeTopModal()`, a
modal *stack*, restore `G._lastSpeed` on close (NOT hardcoded 1× — fixes a
latent bug in welcome.js:117 and honors the "restore G.speed" memory rule).
Escape closes the top modal (wired centrally in `hud.js` keydown, before the
existing tool-clear branch). Welcome, daily report, news history, and the
stats modal all use it.

**D-C · Toasts stay, but demoted.** `#advisor` toasts (bottom-left) remain
for immediate ephemeral feedback (action errors, tips). Everything with
lasting relevance ALSO goes through the new news feed (WP1). No sim event
should be *only* a toast anymore if the player could regret missing it.

---

## Wave 1 — foundations

### WP1 · Notification & news system — **Opus 4.8**

Problem: contracts appear/complete unseen; bottom-left toasts vanish; no way
to re-read a past message.

Decisions:
- **Sim**: new `src/sim/news.js` with `pushNews({type, icon, headline, body,
  refs})` → appends `{id, day, minutes, type, icon, headline, body, refs,
  kept: false}` to `G.news` (ring, cap ~120; `kept` entries never rotate
  out), emits `'news'` on the bus. Categories: `contract-offer`,
  `contract-done`, `contract-expired`, `quest`, `city` (problems &
  achievements from WP2), `energy` (weather fronts, blackout), `tutorial`.
- **Producers**: `contracts.js` (offer spawned / fulfilled / expired — today
  fulfilled is only a toast, contracts.js:146), `quests.js:118`
  (questDone), weather-front scheduling in `energy.js:71-92`. Keep the
  existing `emit('toast')` lines; add `pushNews` beside them (D-C).
- **UI ticker**: new `#newsticker` div, top-center, anchored under the topbar
  with the same live `offsetHeight` trick the weather banner uses
  (`topbar.js:98-102`). Shows the latest unread headline as one line;
  click → opens the **news history modal** scrolled to that item. Auto-hides
  after ~12 s; a small 📰 badge with unread count stays.
- **History modal** (via D-B): reverse-chronological list, per-item
  **🗑 delete** (splice from `G.news`) and **📌 keep** (sets `kept`, exempt
  from rotation). This answers "I want to re-read and curate past messages".
- **Persistence**: `G.news` in snapshot/restore (D-A). `state.js`
  `initialState()` gains `news: []`.
- **Docs/tests**: add `news` to the event table in `docs/ARCHITECTURE.md`
  (architecture test enforces it); sim tests for ring cap, `kept` exemption,
  producer wiring (offer → news entry exists).

### WP3 · Finance & stats overhaul — **Opus 4.8** (largest package)

Problem: `G.expensesToday` is one lump (state.js); build costs vanish into
it; report rows are "all gray, all minus"; gas penalty invisible; energy
hover is a flat text list.

Decisions:
- **Ledger, not scattered counters.** New `src/sim/finance.js`:
  `book(category, amount)` (+ = income, − = expense) writing into
  `G.ledger.today[category]`; `rollOverDay()` pushes today into
  `G.ledger.days` (ring, keep 28 = one year) before reset. Category set
  (data-defined in `data.js` as `LEDGER_CATS`, with label/icon/color and an
  `invest: true` flag): `transportBus/Truck/Train`, `energySale`, `h2Sale`,
  `contractBonus`, `questReward`, `grant`, || `gasFuel`, `importCost`,
  `gridFee`, `blackoutComp`, `upkeepPlants`, `upkeepVehicles`,
  `loanInterest`, || invest: `buildPlant`, `buyVehicle`, `buyWagon`,
  `research`, `replaceFleet`. Loans draw/repay tracked but excluded from
  both nets (they're balance-sheet, not P&L).
- **Wiring**: extend `spend(v)` → `spend(v, cat)` (state.js:143) and add
  `earn(v, cat)`; convert the ~22 `G.money` mutation sites (inventory in the
  exploration brief: grid.js:305, research.js:13, transport.js:17/121/128/
  135/156, energy.js:284/298/312/329/387/390/453, contracts.js:145,
  loans.js:16/26/34, quests.js:118, tutorial.js:112/117, grid.js:362).
  Existing scalars (`incomeEnergyToday`, `gasCostToday`, …) stay for
  compat — derived or dual-written; `G.finance.today` (per-route transport
  income, state.js:88) stays as-is, WP5 builds on it.
- **Two nets everywhere**: `netOperating` (excl. `invest` cats) and `netTotal`.
  This is what makes the gas penalty finally legible: `gasFuel` (incl. the
  CO₂-price share, energy.js:298) becomes a visible red line item instead of
  disappearing into the lump.
- **Stats modal** (via D-B): new `src/ui/hud/statsModal.js`, opened from a
  topbar button + money hover "more…". Tabs:
  1. *Dashboard* — headline KPIs (money, net op today, happiness min/avg,
     CO₂, fossil-free streak), top 3 problems.
  2. *Finance* — expandable income tree and expense tree (per LEDGER_CATS),
     both nets, and a **stacked per-day bar chart** (28-day `ledger.days`)
     with an "include investments" toggle. Chart = canvas, reusing the
     drawing style of `dashboard.js:124-186`; colors from `LEDGER_CATS`.
  3. *Energy* — the existing power stacked-area chart + storage, relocated.
  4. *Cities* — table: name, pop, happiness (with factor breakdown from
     `happinessFactors`, cities.js:29-47), waiting pax, supply levels.
- **Money hover**: `liveTip` on `#money` (pattern topbar.js:8-53) → mini
  breakdown of today-so-far: top 4 income + top 4 expense categories + both
  nets.
- **Energy hover diagram**: rebuild the `#gridstat` tooltip (topbar.js:34-40)
  as HTML mini bar rows — icon + name + horizontal bar (width ∝ MW) + MW
  number, one row per `G.supply` source (energy.js:399), demand rows below;
  colors reused from the dashboard `SERIES` legend so the game speaks one
  color language.
- **Persistence**: `G.ledger` in save (D-A). Report objects (reports.js)
  gain `ledger` snapshot per day; `REPORT_KEEP` rises 7 → 28 (small data).
- **Tests**: booking categories sum to money delta over a played day
  (`playDays()` helper); investment exclusion; ledger survives save/load.

---

## Wave 2 — consumers of Wave 1

### WP2 · Daily report as pausing modal + problems/achievements — **Opus 4.8**
*Depends on WP1 (modal helper, news feed) + WP3 (ledger).*

Decisions:
- **Modal, pausing**: replace `showDayReport`'s auto-fading toast
  (dashboard.js:47-57 — explicitly "never pauses") with a D-B modal on
  `'dayReport'`: pause on open, restore prior speed on close. Exception:
  while the tutorial is active, keep the old toast (don't interrupt the
  scripted flow); switch to the modal from tutorial completion onward.
- **Content**: income tree / expense tree from the day's ledger snapshot
  (green +, red −, no more all-gray-all-minus), `netOperating` and
  `netTotal` side by side, CO₂ + grid-quality row, then:
- **Problems & achievements**: computed in `closeDay()` (reports.js) by
  diffing yesterday↔today: city happiness dropped >5 pts (with the dominant
  negative factor from `happinessFactors` named — "not enough energy",
  "too many waiting passengers" via the `CITY.overcrowdAt` penalty),
  blackout hours > 0, contract deadline within 1 day; achievements: a city's
  `foodLevel`/`goodsLevel` crossing supply threshold ("+X% happiness"),
  happiness record, fossil-free day streaks. Each also lands in the news
  feed (`type: 'city'`).
- The dashboard-tab "Yesterday" block (dashboard.js:60-78) stays as the
  passive recap.
- **Tests**: problem/achievement detection with scripted city states; modal
  pause/restore of `G.speed`.

### WP4 · Contracts & long-distance demand — **Opus 4.8**
*Depends on WP1. Balance-sensitive — verify with headless multi-day policy
runs (ADR 30), not by feel.*

Decisions:
- **Move tuning to data.js** (CLAUDE.md rule; today `MAX_OFFERS`, `PREMIUM`,
  `SIZES` etc. are hardcoded in contracts.js:10-23): new `CONTRACTS` block.
- **Longer, richer contracts**: `days` per cargo 2.5–3 → **3–6**; `amount`
  scaled up ~proportionally so required throughput stays similar; the ×1.5
  delivery premium (already paid per delivery = income over time — keep)
  plus completion bonus raised from ≈2× to **≈4× base cargo value** so a
  contract is worth chasing. Track `c.earned` (accumulated premium) on the
  contract object.
- **Fulfilled history**: `G.contracts.history` array (`{...contract,
  outcome: 'done'|'expired', closedDay, earned, bonus}`), replaces the bare
  `completed`/`failed` counters as source of truth (counters derived).
  Persisted (D-A). Contracts tab gets a "Completed" section listing outcome
  + total money made per contract — answers "I totally missed that I
  fulfilled one".
- **Visibility**: fulfillment/expiry/new-offer → news feed with the ticker
  flash (WP1); fulfillment additionally gets a `moneyFx`-style celebratory
  toast.
- **Long-distance demand** — the real gap: intercity demand exists only
  between *graph neighbors*; non-neighbor `paxTo` slots are actively zeroed
  every tick (cities.js:64). Decision: **express pairs**. At worldgen,
  deterministically (seed) assign each city 1–2 "express destinations" —
  non-neighbor cities at distance > `PAX.expressMinDist` (~60 tiles).
  `tickCities` routes a share (`PAX.expressShare ≈ 0.15`) of `want` into
  `paxTo[expressCity]` (stop zeroing those slots), with its own cap. Pay
  already scales with distance (`1 + rideDist/50`, transport.js:286), so
  express passengers are naturally lucrative — rail's niche. `routeServes`
  (transport.js:252) needs no change: any city on the route qualifies.
  Additionally: **long-haul pax contracts** between express pairs enter the
  contract pool. This keeps demand alive after "all neighbors connected".
- **Happy Region**: `reward: 40000` → **`250000`** at quests.js:39 (reward is
  hardcoded there, NOT in data.js — don't hunt data.js for it).
- **Tests**: express-pair determinism & non-neighbor demand flows; contract
  history entries on done/expired; updated SIZES structure assertions;
  30-day headless run: signing 2 contracts beats ignoring them, but total
  economy stays within ADR-30 drift bounds.

---

## Wave 3 — route UX & interaction

### WP5 · Route management UX — **Opus 4.8**
*Soft dependency on WP3 (ledger) for cost attribution.*

Decisions:
- **Roundtrip — UX fix, not a data-model change.** Exploration finding:
  traversal is already circular (`v.stopIndex = (v.stopIndex+1) %
  stops.length`, transport.js:237) — A→B→C already drives C→A. The user's
  frustration is `toggleRouteStop` (transport.js:52-57) *removing* the first
  stop when clicked to "close the loop". Decision: while editing, clicking
  the **first** stop of a ≥2-stop route **finishes editing** (equivalent to
  ✔ Done) with a toast "Routes loop back automatically ↻"; route cards draw
  the stop list as a cycle (… → C ↻ A). Only middle stops toggle-remove.
  No duplicate-stop entries, no save impact.
- **Highlight addable stations**: render layer reads `G.routeEdit` each
  update tick (no new event needed): pulsing ring/sprite over every station
  matching `routeKind(route)` (transport.js:65) and not already in
  `route.stops`; dim non-matching ones. Implement beside the existing
  station-badge code (vehicles.js:142).
- **Per-route economics**: income per route already exists
  (`G.finance.today.routes[id]`, transport.js:16-22). Add cost attribution:
  vehicle purchase/wagon/replace booked to `r.spentTotal` at buy time;
  `dailyUpkeep` adds each vehicle's upkeep to its route; `r.earnedTotal`
  accumulates credits. Persist both (D-A). Route card shows: profit badge
  (earnedTotal − spentTotal), today's income, waiting pax **per stop**
  (`st.pax.local` + Σ`st.pax.inter`, industries.js:46-67), load factor bar.
- **Click-through**: city infobox overcrowding warning → "show busiest stop"
  button → `emit('flyTo', …)` (scene.js:172 already listens) +
  `G.selected = station`; station infobox lists routes serving it (scan
  `G.routes` for membership) with "✎ edit" and "+ vehicle" actions calling
  the exported routes-panel functions.
- **Panel overlap fix**: `#sidepanel`'s hardcoded `bottom:70px`
  (styles.css:73) loses to the toolbar's real height. Fix: JS-anchor
  `#sidepanel.style.bottom = toolbar.offsetHeight + 10 + 'px'` on
  resize/build (same pattern as topbar.js:98-102).
- **Restyle**: keep the DOM/card structure (`routeCard`, delegated handlers
  routes.js:122-138 — they exist because the list re-renders every 0.25 s;
  don't break that). Visual pass: kind-colored left border + icon chip,
  stop chips as a connected chain, mini profit sparkline, chunkier buttons.
  Style tokens shared with WP6's tutorial restyle.

### WP6 · Input & responsive HUD — **Sonnet 5**
*Depends on WP1's modal stack for Escape semantics.*

Decisions:
- **Right-click cancel**: right button currently = camera pan
  (scene.js:34), no contextmenu handler exists anywhere. Decision: on
  `pointerdown` (button 2) record position; on `pointerup` (button 2) with
  movement < 5 px (i.e. a click, not a pan) → if `G.tool`/`G.routeEdit`
  → `selectTool(null)`; else if `G.selected` → clear selection. Add
  `contextmenu` preventDefault on the canvas. Pan drags are untouched.
- **Escape, layered**: extend hud.js:72-76 to a priority chain: (1) close
  top modal via `closeTopModal()`, (2) clear tool/route-edit, (3) clear
  selection, (4) demand overlay off. One Escape = one layer.
- **Responsive toolbar**: the toolbar is a centered, non-wrapping flex row
  with no overflow handling (styles.css:52-57) and the project has **zero
  media queries** — this introduces the first. Breakpoint ~920 px: hide the
  full bar; show a single "🔨 Build" button that opens a **bottom sheet**
  (full-width, scrollable grid of the same `button.tool` elements —
  `buildToolbar()` renders into whichever container is active, so locks/
  tooltips/selection logic stay identical). 920–1200 px: allow
  `flex-wrap` + reduced paddings as a soft fallback. Also `#sidepanel`
  width → `min(360px, calc(100vw - 12px))`. Verify with `resize_window`
  mobile preset.
- **Tutorial objectives restyle**: `src/ui/tutorial.js` card gets the WP5
  style tokens (colored progress bar, step icon, reward chip). Cosmetic
  only; no flow changes.

### WP7 · Placement rules & city labels — **Sonnet 5**

Decisions:
- **Tree removal under construction**: scatter.js is a one-shot builder with
  zero event subscriptions — trees clip through later builds. Decision:
  while building the instanced meshes, record `Map("i,j" → [{mesh, index}])`;
  subscribe to `'placed'`, `'roadBuilt'`, `'railBuilt'` (the exact events
  infrastructure.js/buildings.js already use) and hide affected instances
  with the established zero-scale-matrix idiom (`ambient.js:81,93,112`) +
  `instanceMatrix.needsUpdate`. Save replay re-fires these events through
  `place()`, so restores stay consistent for free. No sim change, no save
  bump.
- **Turbine spacing**: sim rule in `canPlace()` (grid.js): a `wind` plant
  needs no other `wind` within Chebyshev radius 2 (constant
  `BUILDINGS.wind.minSpacing: 2` in data.js). **Save-compat trap**: restore
  replays through `place()` — old saves may hold adjacent turbines and the
  new rule would silently drop them. Decision: `canPlace(…, {lenient:true})`
  flag used only by save.js replay, skipping the spacing rule. UI shows the
  red ghost + hint "too close to another turbine".
- **City name labels**: persistent `makeTextSprite(c.name)` (meshes.js:135,
  depthTest already false) per city at `worldXZ(c.ci, c.cj)` + Y offset,
  created once in a small new `render/labels.js` from `initWorldRender` —
  NOT the demand overlay's rebuild-every-1.2 s pattern (vehicles.js:96-119).
  Distance-attenuated scale, slight fade when very close (city is obvious
  then). Click: include label sprites in input.js's raycast pick; hit →
  `G.selected = city` (infobox already renders city stats). Demand-overlay
  labels merge into these (highlight state instead of duplicates).

---

## Wave 4 — polish & balance

### WP8 · Rendering polish — **Sonnet 5** (read `edit-graphics` skill first)

Decisions:
- **Day/night smoothing**: lighting is already continuous *except* two
  spots — `sun.color` is a hard 3-branch ternary on elevation
  (scene.js:151) and the PMREM environment rebake is throttled at
  elev-delta 0.08 (scene.js:126, perf comment). Fix: lerp sun color through
  the same 3 stops (mirroring the skyCol `lerpColors` pattern,
  scene.js:156-165); try tightening the env threshold to ~0.05 and keep only
  if frame-time survives (it was throttled for hitches — respect that).
- **Turbines face the camera**: no rotation is ever set on placed plants
  (buildings.js:26-28); nacelle is authored +X (meshes.js:196). Add
  `g.rotation.y = Math.PI` for `type === 'wind'` (glTF and procedural
  branches). Rotor spin is local-X (buildings.js:236-239) — unaffected.
- **Gas plant detail**: the gas plant is procedural-only (meshes.js:237-262;
  there is no coal type — "Flint/coal plant" = the gas peaker). Decision:
  author `assets/models/gas_plant.glb` through the Blender pipeline (add to
  `MODEL_FILES`, assets.js:18) at house-level detail: turbine hall with
  ribbed cladding, twin banded stacks, pipe rack, transformer yard, night
  emissive windows. Respect the pipeline traps (memory): no float-suffix
  object names, no gltf-transform join/flatten; keep a node named `smoke`
  as the smoke anchor (mirrors the `rotor` name contract, assets.js:9-10).
  Procedural mesh stays as fallback.
- **Zoom blur**: single knob at postfx.js:97 — `smoothstep(dist, 90, 380) *
  0.0035`. Decision: start later and weaker, `smoothstep(dist, 170, 560) *
  0.0022`, verify by screenshot at mid and max zoom (maxDistance 720).
- **Right-hand traffic**: real transit vehicles have **no lane offset**
  (`pathPose` returns tile-centerline, pathfinding.js:57-73) and ambient
  cars have an offset of unverified handedness (ambient.js:102-104).
  Decision: apply the offset in the **render** layer (it's presentation):
  `syncVehiclePoses` (vehicles.js:51-69) shifts buses/trucks (+wagons)
  perpendicular-right of travel: `x += sin(yaw)·L, z += cos(yaw)·L` sign
  chosen so vehicles keep right in the direction of travel (Germany), lane
  `L ≈ 0.28` tile. Trains/rails: **no offset** (single track). Fix ambient
  cars' sign to the same handedness. No collision logic (explicitly fine).
  Verify visually: two vehicles passing on one road segment.

### WP9 · Seasons, weather realism & calendar — **Opus 4.8** (read `tune-energy-model`)

Decisions:
- **Seasonal Dunkelflaute**: today's trigger is a flat
  `CLIMATE.flauteRisk = 0.006` per hourly roll, no season input
  (energy.js:33-40). Decision: add `flauteMul` per season in the `SEASONS`
  table (state.js:121-132): Spring 0.5, **Summer 0.05** (≈ never — "there is
  always some sun left"), Autumn 1.3, Winter 2.2; AND lower the base risk to
  ~0.004; AND add a post-event cooldown (`G.flauteCooldownH ≈ 96h`) so
  flautes can't chain back-to-back — together: rarer overall, winter-shaped.
  `eventThresholds()` becomes `flaute: base * season().flauteMul` (climate
  multiplier still excluded, preserving the ADR teaching point).
- **Pinned invariants are safe by construction**: the integration test
  forces `G.dunkelflaute = 40` directly (integration.test.js:63-77), never
  rolling probability — battery-defeat teaching stays pinned untouched.
  **`test/climate.test.js:45-57` WILL break** (asserts summer flaute risk
  `=== CLIMATE.flauteRisk` exactly): update it to assert the new shape —
  winter ≫ summer, summer ≈ 0, climate multiplier still not applied.
  That's a legitimate expectation update, not a weakened guard.
- **Calendar — display-only months, sim keeps days.** No month/year concept
  exists; the year is implicitly 4 × `DAYS_PER_SEASON`(7) = 28 days
  (seasonOf, state.js:129). Changing season length would silently rebalance
  the carbon ramp (+3 €/day) and quest pacing — not worth it. Decision:
  pure presentation mapping in state.js: `calendarDate(day)` → 12 months
  over the 28-day year (Mar/Apr/May = Spring … Dec/Jan/Feb = Winter,
  month advances every ~2⅓ days). Topbar shows "🗓 April · Y1" instead of
  "Day 14"; tooltip keeps exact day + season progress + what the season does
  (solar/wind/demand multipliers — tooltip exists, topbar.js:21-33). The
  month name gives "August → autumn soon" intuition for free; `G.day` stays
  canonical everywhere in sim/tests/saves.
- **Docs**: `docs/ENERGY-MODEL.md` weather section (seasonal risk table,
  cooldown); README player-visible calendar note.
- **Tests**: seasonal threshold shape; cooldown blocks immediate re-roll;
  `calendarDate` mapping table; updated climate.test.js expectations.

### WP10 · Contract/objective discoverability polish — **Sonnet 5**
*After WP1 + WP4 land.*

- First contract offer triggers a one-shot spotlight: news ticker line +
  advisor tip pointing at the contracts tab (`TIPS` entry exists —
  'firstContract', contracts.js; make it point at the new surfaces).
- Sweep after the reworks: any remaining information that only ever appears
  bottom-left, any modal missing Escape-close, copy polish.

---

## Suggested session/agent schedule

| Wave | Packages | Parallel? |
|------|----------|-----------|
| 1 | WP1 (Opus), WP3 (Opus) | yes — WP1 owns modal.js + save bump (D-A/D-B land here); WP3 rebases on it. Both touch topbar.js — sequence merges. |
| 2 | WP2 (Opus), WP4 (Opus) | yes |
| 3 | WP5 (Opus), WP6 (Sonnet), WP7 (Sonnet) | yes — WP5/WP6 both touch input.js + hud.js keydown; coordinate or sequence |
| 4 | WP8 (Sonnet), WP9 (Opus), WP10 (Sonnet) | yes |

Coordinator notes:
- Give each agent: this file's WP section + the cross-cutting decisions,
  CLAUDE.md, the matching project skill, and the definition of done. Agents
  commit their own work.
- Exploration/lookup subtasks run on Sonnet or Haiku (cost); implementation
  per the model column above.
- Use worktree isolation when running packages of one wave in parallel.
- After each wave: `npm test`, then a browser playtest pass on main
  (`playtest-game` skill; restore `G.speed`, never clobber the real save).
