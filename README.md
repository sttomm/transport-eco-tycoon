# Transport Eco Tycoon — Renewable Grid Edition

A browser-based transport tycoon in the spirit of OpenTTD, rendered in modern 3D
(Three.js: atmospheric sky with weather-driven clouds, ambient occlusion, glowing
night cities, tilt-shift "miniature" look, real-time shadows and day/night cycle)
in a hand-crafted low-poly art style. Detailed buildings carry real window
reveals, balconies, cornices, plinths and rooftop AC units; three-blade wind
turbines, four species of layered trees (oaks, conifers, birches, poplars),
brick / timber / corrugated-metal and solar-cell surface detail all come from
scripted Blender plus procedural textures. The living landscape blends grass,
dirt, rock and sand across the terrain, with a meandering river running into a
south-east lake, ground scatter (grass tufts, wildflowers, bushes, boulders and
reeded shores), fenced farmland patchwork, and asphalt streets with curbs and
dashed center lines (junctions stay plain) — with a twist:
**you also run the region's 100% renewable power grid**, and everything in the
world runs on your electricity.

## Run it

No build step. Serve the folder and open it:

```bash
cd transport-eco-tycoon
python3 serve.py 8741
# → http://localhost:8741
```

(`serve.py` is `http.server` plus `Cache-Control: no-cache` — with a plain
static server, browsers cache the ES modules and a reload after a `git pull`
or local edit can load a stale old/new mix that breaks on import. Any static
server works if it disables caching. Three.js is loaded from a CDN, so you
need internet on first load.)

## How to play

**New here? Take the tutorial.** A new game offers a guided **🎓 tutorial**
(~5 minutes, skippable any time): nine hands-on steps — move the camera, read
the grid dashboard, build your first solar farm and battery, open a bus line
and carry your first riders. Each step is completed by actually doing the
thing, pays a cash reward (≈€90k total incl. the graduation bonus), and
highlights the exact button it talks about. The sandbox is never paused or
locked while it runs.

**You earn money two ways:**
1. **Transport** — build roads (drag; crossing the river builds bridges), place
   Freight Depots / Bus Stops next to roads, create routes (🚌 tab → New Route →
   click stations on the map to add stops, click a stop again to remove it),
   buy electric trucks & buses.
   The routes tab groups routes into collapsible 🚌 Bus / 🚆 Rail / 🚚 Cargo
   sections (a route's kind follows its stops' station types) with filter
   chips, and cargo routes can additionally be filtered by the goods they have
   delivered. Each route only offers the matching vehicle type — a bus route
   won't sell you a truck.
   Cargo chains: Iron Ore Mine → Green Steel Works → city, Farm → Food Plant → city,
   plus passengers between neighbouring cities (press V to see who wants to go
   where — central towns make natural transfer hubs). Every cargo chain has
   several producers and processors spread across the region — both mines lie
   east of the river, so western steel routes need a bridge.
2. **Energy** — every home and factory pays you €85 per MWh served (your own
   fleet charges free). It's a margin business: each served MWh carries
   **€18 grid operating costs**, and blackouts don't just lose revenue — every
   unserved MWh costs **€500 blackout compensation** and unhappy cities
   shrink. Keep prices out of crisis territory, too: above **€150/MWh** your
   industries pause production rather than pay (restarting below €100), and
   idle factories starve your freight routes.

**Special contracts (📜 tab):** cities and industries post up to three
time-limited offers to move a specific cargo or passenger relation (à la
Transport Tycoon subsidies). Sign one (max 3 at once) and every matching
delivery pays a **+50% premium**, plus a cash bonus if the target amount
arrives before the deadline. Unsigned offers expire and fresh ones appear over
time; a missed deadline costs nothing but the bonus.

**Daily report card:** at midnight a dismissible toast sums up the finished
day — income, expenses, net, CO₂, blackout/curtailment — with one advisor
sentence on the biggest issue (blackouts > gas losses > weather > curtailment).
The 📊 dashboard keeps a "Yesterday" block with the full breakdown; the last
7 days are stored in the save.

**Fleet aging:** vehicles are cheap to run while young; past ~10 days of
service their upkeep creeps up (to 3× at worst) and EV packs lose usable
capacity (down to 65% — shorter legs, longer charging stops). Replace a
clunker for 75% of list price (🔧 in the Routes tab) or tick **auto-replace**
on a route and the depot renews aged vehicles overnight.

**Bank loans (📊 tab → Finances):** borrow up to €500k in €50k steps at
**1% interest per game day**, repay whenever you have the cash. Renewables are
capital-intensive — all the cost is upfront and the fuel is free — so cheap
early leverage can pay for itself, but standing debt eats your margin.

**Progression:** the build palette grows with you — rail unlocks after your
first freight chain, the hydrogen chain after you've mastered batteries, the
e-fuel refinery after your first H₂ stockpile, and the interconnector when
the Smart Market opens. Locked tools show a 🔒 with exactly what earns them.

**Controls:** right-drag pan · middle-drag rotate · WASD/arrows pan · wheel
zoom · Space pause · 1/2/3 speed · V passenger demand · ESC cancel tool.

## The energy game (and what it teaches)

All numbers are anchored to real-world magnitudes:

| Asset | In game | Reality check |
|---|---|---|
| Solar farm | 5 MWp, sun-curve × cloud cover, zero at night | cheapest power in history, but sun-shaped |
| Wind turbine | 4 MW, cubic power curve, storm cut-out | output ∝ wind speed³ up to rated |
| Hydro (run-of-river) | 8 MW steady | renewable baseload, geography-limited |
| Grid battery | 20 MWh / 10 MW, 92% round trip | daily cycling: noon solar → evening peak |
| Electrolyzer | 5 MW, 68% → 75% with research | flexible load that soaks up surplus |
| H₂ tank + fuel cell | 150 MWh storage, 58% → 64% reconversion | ~39% round trip, but cheap per stored MWh → seasonal storage |
| Green steel works | 13 MW + grid H₂ for +50% output | H₂-DRI + EAF ≈ 3.5 MWh/t (HYBRIT, Stegra) |
| Interconnector | 12 MW import link, €95/MWh + neighbour-mix CO₂; throttled to 30% at €220 during region-wide events | HVDC interconnection helps — but Dunkelflauten are continental, everyone is short at once |
| E-Fuel Refinery | sells H₂ at €95/MWh above a hard 40% tank reserve | sector coupling: green H₂ offtake deals (€3–6/kg) turn surplus power into molecules |

**The fossil bridge:** every new game inherits one 30 MW **legacy gas plant**
and a deliberately undersized renewable fleet — the plant has to run every
evening from day 1. A carbon price that starts at €30/t and rises €3 per day
makes every gas MWh a deepening loss against your ~€67/MWh net tariff. You
can't build more fossil capacity, only build your way out: each renewable MWh
you add displaces a gas MWh and pockets the difference. Decommissioning pays
a one-time exit grant, but an idle plant costs only €400/day — cheap insurance
against €500/MWh blackout compensation until your storage, hydrogen and
interconnector can carry a winter Dunkelflaute alone. Seven consecutive
fossil-free days complete the **Fossil-free week** objective — the closest
thing the region has to victory.

**The Smart Market:** on day 8 the regulator announces — and on day 10
activates — dynamic electricity pricing. The flat €85/MWh tariff is replaced
by a live price set by the most expensive running source (pay-as-clear merit
order, like real power exchanges): blackout hours spike to **€240/MWh**, the
gas plant sets the price at its cost + €15 while it runs, and curtailed
surplus crashes it to **€25/MWh**; in between it tracks residual load
(€45–120). Watch the 💶 ticker in the top bar and the price line in the
dashboard chart — discharging storage into scarce hours now earns real money,
so storage arbitrage becomes the business model. One rule from the EU's 2022
playbook: a **windfall levy** skims 80% of any price above €100/MWh, so
flexibility pays but engineered scarcity doesn't.

The weather brings real phenomena: multi-day **Dunkelflaute** (dark calm) events
that batteries can't bridge, storms that force turbine cut-outs, and summer
**heatwaves** — stagnant heat domes where air conditioning pushes city demand
+30% while turbines idle (solar, at least, shines on). Fronts
announce themselves 10–14 h ahead in the dashboard **weather forecast** and a
warning banner — enough time to charge everything, never enough to escape.
And the climate feeds back: every tonne of CO₂ your gas plant emits loads the
weather dice, multiplying storm and heatwave risk up to 2× (watch the 🌡
Climate box on the dashboard) — burn fossil, get worse weather. The
**Energy Advisor** explains each concept (duck curve, curtailment, flexible
demand, …) the moment it first happens to you, and the 📚 tab has a small
encyclopedia.

**Research** (🔬 tab) mirrors real learning curves: better solar cells
(TOPCon, perovskite tandems), taller wind towers, LFP batteries, PEM stack
efficiency, heat pumps, megawatt charging — and **demand response**, which
shifts flexible city loads out of the peaks into the valleys (the energy
moves in time, it doesn't disappear).

**Insight** (📊 tab): 48-hour stacked generation chart vs. demand, storage
levels, curtailment, renewable share, CO₂ avoided, finances.

## Tech

Plain ES modules, no framework, no build, no dependencies. Three layers
(see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture):

- `src/sim/` — the whole game logic, browser-free and unit-tested in Node:
  world grid & placement rules, weather + grid dispatch (merit order:
  renewables → battery → electrolyzer → curtail / battery → fuel cell →
  imports → legacy gas → blackout), A* pathfinding, vehicles, industries, passengers, quests, saves
- `src/render/` — Three.js views of the sim state (terrain, cities, vehicles,
  overlays), kept in sync via sim events; 3D assets are `.glb` files in
  `assets/models/`, generated by the headless-Blender scripts in
  `tools/models/` (`tools/build-models.sh` regenerates them — players never
  run any tooling)
- `src/ui/` — DOM panels: HUD, dashboard charts, research, routes, advisor
- `src/main.js` — composition root + game loop

## Testing

```bash
npm test        # Node's built-in runner, ~100 ms, zero dependencies
```

160 tests pin the simulation: dispatch merit order (incl. the legacy gas,
import and H₂-offtake steps), storage efficiencies, placement rules & palette
unlocks, pathfinding, freight & passenger economics, route-kind validation,
vehicle aging, quests, the guided tutorial, special contracts, loans, weather
fronts & forecast, dynamic pricing, climate feedback, daily reports, and the
save round trip.
New features extend the suite (see [CLAUDE.md](CLAUDE.md)).

## Documentation

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — the original brief & functional requirements
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module map + design decisions (ADRs)
- [docs/ENERGY-MODEL.md](docs/ENERGY-MODEL.md) — every game number and its real-world anchor

[CLAUDE.md](CLAUDE.md) holds the working rules (layering, definition of done).
For Claude Code users, three project skills live in `.claude/skills/`:

- **playtest-game** — run/debug the game, programmatic play-testing via the in-browser `DEBUG` API
- **add-game-content** — checklists for new buildings, industries, vehicles, techs
- **tune-energy-model** — invariants & verification recipes for the grid simulation

## Roadmap ideas

- Transmission constraints (regional grids instead of one copper plate)
- Ships & waterways
