---
name: tune-energy-model
description: Modify the renewable energy simulation of Transport Eco Tycoon — generation curves, storage, weather, dispatch order, demand shapes, prices. Use when asked to change grid behavior, add an energy source/storage tier, rebalance the energy economy, or improve realism.
---

# Tuning the energy model

The model lives in `src/energy.js` (dispatch + weather + curves) with all
capacities/efficiencies in `src/data.js`. **Realism is a feature**: every
number has a real-world anchor documented in `docs/ENERGY-MODEL.md` — update
that file in the same change, and check whether an advisor tip in
`data.js → TIPS` or an encyclopedia entry in `LEARN` states the old number.

## Invariants to preserve

1. **Merit order** (`tickGrid`): renewables → battery → electrolyzer → curtail
   on surplus; battery → fuel cell → unserved on deficit. The electrolyzer
   must remain a *flexible load that only consumes surplus* — that's the
   core teaching mechanic. Don't let it draw from batteries or cause blackouts.
2. **Units**: power MW, energy MWh, integration `MW × gameHours`. H₂ is MWh
   chemical (LHV); electrolyzer multiplies by `mult.elecEff` going in, fuel
   cell divides by `mult.fcEff` coming out. 1 t H₂ = 33.3 MWh (UI conversion).
3. **Battery efficiency** is applied once, on charge (×0.92).
4. **Teaching beats balance**: solar MUST be worthless at night, storms MUST
   cut out turbines, Dunkelflaute MUST exhaust batteries-only grids. Don't
   "fix" these frustrations; they are the curriculum.
5. Rates are read fresh each tick from `G.mult` so research applies instantly;
   capacities (`batteryCapMWh` etc.) are registered at place/bulldoze time in
   `world.js` — a retroactive capacity tech must walk `G.plants`.

## Shape reference

- `solarFactor()`: sine arc 05:30–18:30 × `(1 − 0.82·cloud)`
- `windFactor()`: 0 below w=0.12, `min(1, ((w−0.12)/0.55)³·3.2)`, 0 above 0.96
- `cityDemandCurve()`: 0.62 base + Gaussians at 08:00 (0.5) and 19:30 (0.75)
- Weather: mean-reverting walks; Dunkelflaute event (wind→0.06, cloud→0.92,
  36-54 h, ~0.6%/h after day 3); storm event (wind→1.0 → cut-out)
- Money: `(cityMW + indMW) × servedFraction × hours × €85`; fleet charging is
  unbilled; CO₂ counter +0.4 t/MWh served

## Verification recipe

Use the `playtest-game` skill. The fast assertions:

```js
// instant: is the balance sane right now?
({ supply: G.supply, demand: G.demand, unserved: G.unservedMW, curtailed: G.curtailedMW })

// 48h behavior after G.speed=10 soak:
const h = G.history;
({ battCycles: h.filter(s=>s.battery>0.1).length, fc: h.filter(s=>s.fuelcell>0.1).length,
   elec: h.filter(s=>s.elec>0.5).length, unserved: h.filter(s=>s.unserved>0.1).length })

// stress test long-duration storage:
G.dunkelflaute = 40   // then verify H2 drains before blackouts begin
```

Sanity targets for the starter grid (1 hydro, 2 wind, 1 solar, 1 battery):
near-zero unserved on normal days, battery cycling daily between roughly
15-100%, some curtailment on sunny+windy days. If a change makes the starter
grid blackout nightly or never stresses storage at all, rebalance.

## Common pitfalls

- Dividing by `gameHours` when it can be ~0 on a paused/first frame — guard rates.
- Forgetting `G.batteryMWh`/`G.h2MWh` clamps after a new flow.
- New supply/demand component not added to `sampleHistory` → invisible in the
  dashboard chart (`ui.js#SERIES` for colors/legend) — the "insights"
  requirement says every flow must be visible.
