# Energy Model — Realism Notes

The game's numbers are tuned for playability but every mechanism is anchored
to a real-world figure. This file is the source of truth for those anchors;
if you change `data.js` or `energy.js`, keep this in sync.

## Units

- Power: **MW** · Energy: **MWh** · 1 game tick integrates `MW × gameHours`.
- Hydrogen is tracked as **MWh of chemical energy (LHV)**. 1 t H₂ ≈ 33.3 MWh,
  which is how the dashboard converts the tank level to tonnes.

## Generation

| Source | Game | Real-world anchor |
|---|---|---|
| Solar farm | 5 MWp; output = cap × sin-curve(05:30–18:30) × (1 − 0.82·cloud) | Utility PV ~20-24% panel efficiency; output is weather-scaled irradiance; zero at night |
| Wind turbine | 4 MW; cut-in at 12% wind (≈11 km/h), cubic ramp to rated at ~67% (≈43 km/h), cut-out >96% (≈90 km/h) | Power ∝ v³ below rated; storm cut-out is real and can drop GWs in an hour |
| Hydro | 8 MW × 0.55 constant | Run-of-river capacity factor ~40-60%, steady |

Research multipliers mirror real learning curves: TOPCon (+18%) and perovskite
tandem (+30%) for solar; taller towers (+22%) and longer blades (+20%) for wind.

## Storage

| Asset | Game | Anchor |
|---|---|---|
| Battery | 20 MWh / 10 MW, **92% round trip** (applied on charge) | Li-ion grid storage 85-95% RT; expensive per MWh → daily cycling |
| Electrolyzer | 5 MW input, **68% → 75%** (PEM research) | PEM ~60-70% today, ~50 kWh/kg H₂ |
| H₂ tank | 150 MWh per tank, cheap | Storage cost per MWh is tiny vs batteries → economic for days/weeks |
| Fuel cell | 5 MW, **58% → 64%** (SOFC research) | FC/H₂ turbines 50-60% |

**The headline lesson:** H₂ round trip = 0.68 × 0.58 ≈ **39%** (research →
~48%) vs battery 92%. Hydrogen loses on efficiency but wins on storage
*capacity cost*, so the optimal grid uses batteries for the day/night cycle
and hydrogen for rare multi-day gaps. The game's weather makes the player
discover this.

## Weather

- Wind & cloud are mean-reverting random walks (per-hour drift + noise).
- **Dunkelflaute**: random event (~0.6%/h after day 3), forces wind→6%,
  cloud→92% for 36-54 game hours. The defining stress test of renewable grids.
- **Storm**: random gust to 100% wind → turbines cut out (zero output at
  maximum wind — counterintuitive and true).

## Demand

- Cities: `pop/1000 × 1.1 MW × daily curve` — double-peaked (Gaussian bumps at
  08:00 and 19:30, night valley ~0.62) — the classic load shape behind the
  "duck curve" when solar is netted off.
- Industry: mine 2.5 MW, food plant 4 MW, farm 0.4 MW, **green steel 13 MW**
  (the deliberate monster load). Real H₂-DRI + EAF steel ≈ 3.5 MWh/t.
  The steel works also consumes grid H₂ (0.8 MWh/h) for +50% output when
  available — modeling hydrogen as industrial feedstock, not just storage.
- EV charging: trucks 0.8 MW, buses 0.5 MW while loading at stations
  (megawatt-charging research doubles it). Charging pauses during blackouts.
- Rail traction: locomotives draw 1.0 MW + 0.15 MW/wagon **live from the grid**
  while moving (no battery — catenary feed, like real electrified rail where a
  regional EMU averages ~1-2 MW). Counted in the "charging" demand slice.
  Train speed scales with `servedFraction`: a strained grid slows trains, a
  blackout stops them.

## Dispatch (energy.js#tickGrid)

```
surplus = (solar + wind + hydro) − (city + industry + charging)
surplus > 0:  battery charge (rate-limited) → electrolyzer (flexible load) → CURTAIL
surplus < 0:  battery discharge → fuel cell (burns H₂/0.58) → UNSERVED (blackout)
```

Blackout (`served < 97%`): industry halts, charging stops, city happiness
falls (population shrinks), energy revenue lost.

## Economics

- Energy price: €85/MWh served (cities + industry pay; your own fleet charges free).
- CO₂ avoided: 0.4 t/MWh served (typical displaced fossil mix) — purely a
  score/teaching metric.
- Cargo payment: `base × amount × (1 + distance/45)`.
