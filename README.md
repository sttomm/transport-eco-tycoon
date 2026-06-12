# Transport Eco Tycoon — Renewable Grid Edition

A browser-based transport tycoon in the spirit of OpenTTD, rendered in modern 3D
(Three.js: real-time shadows, day/night cycle, living cities) — with a twist:
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

**You earn money two ways:**
1. **Transport** — build roads (drag; crossing the river builds bridges), place
   Freight Depots / Bus Stops next to roads, create routes (🚌 tab → New Route →
   click stations on the map), buy electric trucks & buses.
   Cargo chains: Iron Ore Mine → Green Steel Works → city, Farm → Food Plant → city,
   plus passengers between the three cities.
2. **Energy** — every home, factory and charging vehicle pays you €85 per MWh
   served. Blackouts cost you revenue, halt industry and shrink your cities.

**Controls:** left-drag pan · right-drag rotate · wheel zoom · Space pause ·
1/2/3 speed · ESC cancel tool.

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

The weather brings real phenomena: multi-day **Dunkelflaute** (dark calm) events
that batteries can't bridge, and storms that force turbine cut-outs. The
**Energy Advisor** explains each concept (duck curve, curtailment, flexible
demand, …) the moment it first happens to you, and the 📚 tab has a small
encyclopedia.

**Research** (🔬 tab) mirrors real learning curves: better solar cells
(TOPCon, perovskite tandems), taller wind towers, LFP batteries, PEM stack
efficiency, heat pumps, megawatt charging.

**Insight** (📊 tab): 48-hour stacked generation chart vs. demand, storage
levels, curtailment, renewable share, CO₂ avoided, finances.

## Tech

Plain ES modules, no framework, no build. `src/`:

- `world.js` — procedural terrain/river/cities/industries, ambient cars & pedestrians
- `energy.js` — weather + grid dispatch (merit order: renewables → battery → electrolyzer → curtail / battery → fuel cell → blackout)
- `transport.js` — A* pathfinding, stations, routes, EV fleet with battery & charging
- `ui.js` — HUD, dashboard charts, research, routes, advisor
- `main.js` — renderer, day/night lighting, input, game loop

## Documentation

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — the original brief & functional requirements
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module map + design decisions (ADRs)
- [docs/ENERGY-MODEL.md](docs/ENERGY-MODEL.md) — every game number and its real-world anchor

For Claude Code users, three project skills live in `.claude/skills/`:

- **playtest-game** — run/debug the game, programmatic play-testing via the in-browser `DEBUG` API
- **add-game-content** — checklists for new buildings, industries, vehicles, techs
- **tune-energy-model** — invariants & verification recipes for the grid simulation

## Roadmap ideas

- Save/load (localStorage)
- Rail & electric trains, ships
- Transmission constraints (regional grids instead of one copper plate)
- Demand response & dynamic pricing
- Seasons (winter solar droop — the real argument for H₂)
