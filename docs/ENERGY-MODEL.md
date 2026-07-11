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
- **Fronts & forecast** (ADR 23): both events are *scheduled* 10–14 h ahead
  on `G.weatherFront` and applied when the countdown hits zero — never
  weakened, only visible. Mirrors reality: numerical weather prediction is
  reliable on that horizon, and grid operators dispatch storage against the
  day-ahead forecast. `G.forecast` (derived each tick, not saved) exposes a
  24 h outlook — per-3h solar factor from the deterministic season/day curve
  under cloud persistence, the wind mean-reversion target, and the inbound
  front. The advisor's Dunkelflaute warning fires at schedule time: the lead
  time is the window to top up batteries and H₂. Constants: `data.js`
  FORECAST. Setting `G.dunkelflaute` directly (debug/playtest path) still
  applies instantly, bypassing the front machinery.

## Climate feedback (ADR 24)

Burning gas doesn't just cost money — it loads the weather dice. The lifetime
`G.co2EmittedTons` multiplies the probability of **extreme** events:

| Number | Game | Real-world anchor |
|---|---|---|
| Risk multiplier | `min(2, 1 + emitted / 1500 t)` on the hourly storm & heatwave rolls (`data.js` CLIMATE, `energy.js#climateRiskMult`) | climate **attribution science**: a warmer atmosphere makes heatwaves and severe storms measurably more frequent and more intense; the effect is on the *frequency of extremes*, not on everyday weather |
| Base Dunkelflaute roll | **unscaled** (0.6%/h after day 3) | a dark calm is ordinary winter weather variability, not a warming signature — and the teaching must stay "emissions load the dice for extremes" |
| Heatwave | summer only, ~0.5%/h × risk, 18–30 h, scheduled 10–14 h ahead like every front | heatwaves are the most confidently attributed extreme; forecasts see them days out |
| Heat dome effects | city demand ×1.3 (AC), wind drift target capped at 0.25, clear skies (solar strong) | a heat dome is a stagnant high-pressure system: peak AC load arrives *together with* calm air (Texas 2023, Europe 2022), while cloudless skies keep PV delivering — batteries charged at noon carry the hot evening |

The multiplier is deliberately gentle (caps at 2× after ~1,500 t, i.e. weeks
of heavy gas reliance): the loop gas → CO₂ → worse weather → harder grid should
be *felt*, not fatal. The dashboard 🌡 Climate box shows emitted vs avoided
CO₂ and the risk band (calm < 1.15× ≤ elevated < 1.5× ≤ high). During a
heatwave the active-event state is `G.heatwave` (hours remaining, like
`G.dunkelflaute`); heatwave hours land in the daily report as `heatHours`.

## Demand

- Cities: `pop/1000 × 1.1 MW × daily curve` — double-peaked (Gaussian bumps at
  08:00 and 19:30, night valley ~0.62) — the classic load shape behind the
  "duck curve" when solar is netted off.
- **Demand response** (research): the tech sets `mult.demandResponse = 0.25`,
  which compresses the city curve 25% toward its 24 h mean (0.822) — peaks
  shaved, valleys filled, total energy unchanged. Anchor: real DR programs
  shift flexible loads (EV charging, heat pumps, cold storage) in time; they
  don't reduce consumption. Pinned energy-neutral by `test/energy.test.js`.
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
surplus < 0:  battery discharge → fuel cell (burns H₂/0.58) → IMPORT (interconnector) → GAS (legacy) → UNSERVED (blackout)
```

## Legacy gas & carbon price (ADR 21)

Every new game inherits exactly one 30 MW open-cycle gas plant (`legacy: true`
— hidden from the build palette, fossil capacity can never be expanded). It is
the last dispatchable before blackout and the whole game arc is phasing it out.

| Number | Game | Real-world anchor |
|---|---|---|
| Capacity | 30 MW | sized to the 8-city evening peak (~45 MW incl. industry) minus storage |
| Fuel cost | €70/MWh | gas peaker fuel cost at recent European gas prices (~€35-40/MWh_th ÷ ~40% OCGT efficiency, incl. O&M) |
| Emissions | 0.45 t CO₂/MWh | open-cycle gas turbine ~0.4-0.5 t/MWh |
| Carbon price | starts €30/t, +€3 per game day (`data.js` CARBON) | EU-ETS-style rising CO₂ price; the ramp is compressed to game pace |
| Break-even | (85 − 70) / 0.45 ≈ **€33.3/t** → day 2-3 | above that, every gas MWh sells at a loss (pinned by test: margin < 0 for >€35/t) |

Mechanics: gas-served demand bills normally at €85/MWh, but the plant burns
`fuel + 0.45 × carbonPrice` per MWh (booked into expenses and
`G.gasCostToday`). Gas MWh accrue `G.co2EmittedTons` and earn **no** avoided-CO₂
credit — `co2SavedTons` only counts non-gas served energy. A one-time €60k
exit grant decommissions the plant irreversibly (infobox button); the
**Fossil-free week** quest (7 consecutive days with `gasMWhToday === 0`,
tracked by `G.fossilFreeDays`) is the de-facto win condition and works whether
the plant was decommissioned or merely idle.

Blackout (`served < 97%`): industry halts, charging stops, city happiness
falls (population shrinks), energy revenue lost.

## Grid imports (Interconnector, ADR 25)

A buildable 12 MW HVDC link to the neighbouring region, dispatched after
storage and **before** the legacy gas plant:

| Number | Game | Real-world anchor |
|---|---|---|
| Capacity | 12 MW per interconnector | HVDC links (NordLink, Viking Link…) are GW-class; scaled to the region |
| Import price | €95/MWh normal (`data.js` INTERCONNECT) | neighbour day-ahead price + fees; above your €85 flat tariff → imports are insurance, not profit |
| Import CO₂ | 0.25 t/MWh onto `co2EmittedTons` (no avoided credit, climate dice included) | average European grid mix ~0.2–0.3 t/MWh — imported power is only as clean as the neighbour's mix |
| Event throttle | during a Dunkelflaute/heatwave: capacity × 0.3, price €220/MWh | Dunkelflauten are synoptic-scale (continental): interconnected neighbours are short in the same hours, and scarcity propagates through coupled markets |
| Smart Market | importing sets the price at import cost + €10 if it is the most expensive running source | pay-as-clear across coupled zones |

Teaching: interconnection is the fourth tool of real grid planning — it lets
you retire the gas plant without blackouts, but it can't carry a Dunkelflaute
(the throttle is the lesson) and it isn't emissions-free. Fossil-free-week
streaks ignore imports (the quest is about *your* plant); the CO₂ ledger does not.

## Pricing (Smart Market, ADR 22)

Until game day 10 every served MWh bills at a flat **€85/MWh** (`POWER_PRICE`).
On day 8 the regulator announces, and on day 10 activates, the **Smart
Market**: `G.price` is set every tick after dispatch, in priority order —
the most expensive running source sets the price, as in real pay-as-clear
(merit-order) electricity markets. All constants live in `data.js` `MARKET`.

| Rule (priority order) | Game | Real-world anchor |
|---|---|---|
| Scarcity: unserved demand > 0 | **€240/MWh** | scarcity pricing when supply can't clear demand; real day-ahead caps are €3,000-15,000/MWh — compressed to game scale |
| Gas running | **gas marginal cost + €15** = €70 + 0.45 × carbonPrice + 15 | pay-as-clear: the most expensive dispatched plant sets the clearing price for *everyone* — in Europe that plant is usually gas, which is why gas prices drove power prices in 2022 |
| Curtailing surplus | **€25/MWh** | renewable-glut hours drive day-ahead prices to near zero or below; €25 stands in for the negative-price hours real markets see on sunny Sundays |
| Otherwise | **€45→€120** linear in residual load: `clamp((demand − renewables)/45 MW, 0, 1)` | day-ahead prices track residual load (demand minus wind+solar); 45 MW is the region's reference evening peak incl. industry |

Revenue = billable MW × hours × `G.price`. Consequences, all intended
teaching: storage discharge into scarcity hours earns ~3× the old tariff
(storage arbitrage — the business model of real grid batteries); the gas
plant briefly earns its €15 markup as the price-setter (real peakers live off
exactly such hours) but the €3/day carbon ramp, its €400/day upkeep and the
fossil-free quest still make phasing it out the winning strategy; and heavy
solar overbuild now sees its midday revenue crash to €25 (price cannibalization).
`marketLive` and `price` are derived from `G.day` each tick — nothing is
saved, loaded saves price correctly from the first tick. Balance is pinned by
a 15-day headless starter-kit run: total energy income within ±30% of the
flat-tariff baseline (measured ≈ −0.3% on average across 5 seeds, spread
−12%…+16% depending on weather).

## Economics

- Energy price: flat €85/MWh until day 10, then the Smart Market price above
  (cities + industry pay; your own fleet charges free).
- CO₂ avoided: 0.4 t/MWh served (typical displaced fossil mix) — purely a
  score/teaching metric.
- Cargo payment: `base × amount × (1 + distance/45)`.
