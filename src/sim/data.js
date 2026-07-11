// Static game data: buildable items, vehicles, research tree, advisor tips.
// Numbers are tuned for gameplay but anchored to real-world magnitudes:
//  - utility solar farm  ~5 MWp, capacity factor ~12-25% (sun curve x clouds)
//  - onshore wind turbine ~4 MW rated, cut-in/rated/cut-out power curve
//  - run-of-river hydro   ~8 MW, steady
//  - grid battery         ~20 MWh / 10 MW, ~92% round trip
//  - PEM electrolyzer     ~5 MW, ~68% efficient (improvable to 75%)
//  - fuel cell / H2 plant ~5 MW, ~58% efficient (improvable to 64%)
//  → hydrogen round trip ~39%: bad for daily cycling, great for weeks of storage.

export const BUILDINGS = {
  road: {
    name: 'Road', icon: '🛣', cost: 60, footprint: 1, category: 'transport', drag: true,
    desc: 'Connect cities, industries and stations. Drag to build. Crossing the river builds a bridge (5× cost).',
  },
  busStop: {
    name: 'Bus Stop', icon: '🚏', cost: 1200, footprint: 1, category: 'transport', nearRoad: true,
    desc: 'Picks up passengers from nearby city blocks (radius 7).',
  },
  truckStop: {
    name: 'Freight Depot', icon: '📦', cost: 2500, footprint: 1, category: 'transport', nearRoad: true,
    desc: 'Transfers cargo with industries & cities in radius 7. Trucks fast-charge here (grid power!).',
  },
  rail: {
    name: 'Rail Track', icon: '🛤', cost: 140, footprint: 1, category: 'transport', drag: true,
    desc: 'Drag to lay electrified track. Crosses roads at level crossings; crossing the river builds a rail bridge (5× cost).',
  },
  trainStation: {
    name: 'Rail Station', icon: '🚉', cost: 9000, footprint: 2, category: 'transport', nearRail: true,
    desc: 'Serves BOTH passengers and freight in radius 7. Must touch a rail track. Connect two stations with track, then buy a locomotive in the Routes tab.',
  },
  solar: {
    name: 'Solar Farm', icon: '☀️', cost: 34000, upkeep: 120, footprint: 3, category: 'energy', capMW: 5,
    desc: '5 MWp photovoltaic park. Output follows the sun and drops with cloud cover. Zero output at night — pair with storage.',
  },
  wind: {
    name: 'Wind Turbine', icon: '🌬', cost: 30000, upkeep: 160, footprint: 1, category: 'energy', capMW: 4,
    desc: '4 MW onshore turbine. Needs wind: cut-in ~11 km/h, rated ~43 km/h, storm cut-out ~90 km/h.',
  },
  hydro: {
    name: 'Hydro Plant', icon: '💧', cost: 110000, upkeep: 250, footprint: 2, category: 'energy', capMW: 8, nearWater: true,
    desc: '8 MW run-of-river plant. Steady renewable baseload. Must be built at the river.',
  },
  interconnector: {
    name: 'Interconnector', icon: '🔌', cost: 75000, upkeep: 200, footprint: 2, category: 'energy', importMW: 12,
    desc: '12 MW HVDC link to the neighbouring region. Imports power when your grid runs short — at the neighbour\'s price (~€95/MWh) and with the CO₂ of their part-fossil mix. Beware: Dunkelflauten are continental — during one the link thins to 30% and the price nears scarcity.',
  },
  battery: {
    name: 'Battery Storage', icon: '🔋', cost: 40000, upkeep: 90, footprint: 2, category: 'storage',
    storeMWh: 20, rateMW: 10,
    desc: '20 MWh / 10 MW lithium grid battery, ~92% round trip. Perfect for shifting solar noon → evening peak.',
  },
  electrolyzer: {
    name: 'Electrolyzer', icon: '⚡', cost: 48000, upkeep: 140, footprint: 2, category: 'storage', elecMW: 5,
    desc: '5 MW PEM electrolyzer. Turns surplus power into hydrogen (~68% efficient). A flexible load that soaks up cheap midday solar.',
  },
  h2tank: {
    name: 'H₂ Storage Tank', icon: '🫧', cost: 24000, upkeep: 60, footprint: 2, category: 'storage', h2MWh: 150,
    desc: 'Stores 150 MWh of hydrogen (chemical energy). Cheap per MWh — built for days or weeks of reserve, not hours.',
  },
  fuelcell: {
    name: 'Fuel Cell Plant', icon: '♻️', cost: 42000, upkeep: 130, footprint: 2, category: 'storage', fcMW: 5,
    desc: '5 MW fuel-cell plant. Converts stored hydrogen back to power (~58% efficient). Your insurance for dark, windless weeks.',
  },
  efuel: {
    name: 'E-Fuel Refinery', icon: '🛢', cost: 58000, upkeep: 150, footprint: 2, category: 'storage', offtakeMW: 4,
    desc: 'Sells up to 4 MW of your hydrogen into e-fuel contracts at €95/MWh — but only above a 40% tank reserve: your Dunkelflaute insurance is never for sale. Surplus power → H₂ → product: sector coupling.',
  },
  gas: {
    // legacy: true → hidden from the build palette. Every new game inherits
    // exactly ONE of these (placed in main.js); players can never build more
    // fossil capacity — the game arc is phasing this plant out.
    name: 'Legacy Gas Plant', icon: '🔥', cost: 0, upkeep: 400, footprint: 2, category: 'energy',
    capMW: 30, fuelPerMWh: 70, co2PerMWh: 0.45, legacy: true,
    desc: 'The 30 MW open-cycle gas plant you inherited. It jumps in when storage runs dry and keeps the lights on — but every MWh burns ~€70 of gas and emits 0.45 t CO₂, taxed at the rising carbon price. Phase it out before it eats your margin.',
  },
  bulldoze: {
    name: 'Bulldoze', icon: '🧨', cost: 0, footprint: 1, category: 'transport',
    desc: 'Demolish your buildings & roads (30% refund).',
  },
};

// Carbon price (€/t CO₂): starts at `start` on day 1 and rises `perDay` each
// game day — an EU-ETS-style ramp. Even at the starting price a gas MWh
// (~€83.5) costs more than the net tariff (€85 − €18 grid fee), and the ramp
// deepens the loss ~€1.35/MWh per day: the inherited status quo is a bleed
// the player must build their way out of. `exitGrant` is the one-time payout
// for decommissioning the plant (see grid.js#decommissionGas).
export const CARBON = { start: 30, perDay: 3, exitGrant: 60000 };

// Weather fronts & forecast (ADR 23): events are scheduled `leadHmin`–`leadHmax`
// hours ahead on G.weatherFront, so the forecast can warn the player before a
// Dunkelflaute or storm hits. Duration ranges match the classic events.
export const FORECAST = {
  leadHmin: 10, leadHmax: 14,     // hours between scheduling and arrival
  flauteHmin: 36, flauteHmax: 54, // Dunkelflaute duration (h)
  stormH: 2,                      // rough gust duration shown in the forecast (h)
  slotH: 3, horizonH: 24,         // forecast outlook: 8 slots of 3 h
};

// Climate feedback (ADR 24): emitted CO₂ loads the weather dice. The hourly
// extreme-event rolls (storm + heatwave, NOT the base Dunkelflaute — that is
// normal weather variability) are multiplied by
// `min(maxMult, 1 + co2EmittedTons / scaleTons)` (energy.js#climateRiskMult).
// The heatwave (summer only) is a heat dome: stagnant air caps wind low while
// air conditioning pushes city demand up — skies stay clear, solar stays strong.
// Gentle by design: teaching, not punishment.
export const CLIMATE = {
  scaleTons: 1500,    // emitted tons at which extreme-event risk doubles (= the cap)
  maxMult: 2,         // risk multiplier ceiling
  flauteRisk: 0.006,  // Dunkelflaute per hourly roll (day 4+) — base variability, NOT risk-scaled
  stormRisk: 0.005,   // storm per hourly roll — × risk multiplier
  heatRisk: 0.005,    // heatwave per hourly roll, summer only — × risk multiplier
  heatHmin: 18, heatHmax: 30, // heatwave duration (h); scheduled with the FORECAST lead time
  heatDemand: 1.3,    // city demand × while a heatwave is active (air conditioning)
  heatWindCap: 0.25,  // wind drift target cap during a heatwave (heat domes are stagnant)
  elevatedAt: 1.15, highAt: 1.5, // dashboard risk-indicator bands (calm / elevated / high)
};

// Smart Market (ADR 22): announced on day `announceDay`, live from `liveDay`.
// From then on the flat €85/MWh tariff is replaced by a dynamic price set each
// tick by pay-as-clear merit-order rules (see energy.js#tickGrid):
// scarcity → gas marginal + markup → surplus → €bandLo..bandHi by residual load.
export const MARKET = {
  announceDay: 8,     // regulator announcement (2-day warning to prepare storage)
  liveDay: 10,        // dynamic pricing starts
  scarcity: 240,      // €/MWh while any demand goes unserved (scarcity pricing)
  gasMarkup: 15,      // €/MWh above gas marginal cost when gas sets the price
  surplusPrice: 25,   // €/MWh while clean surplus is being curtailed (glut)
  bandLo: 45,         // €/MWh at zero residual load (renewables cover everything)
  bandHi: 120,        // €/MWh at full residual load (renewables cover nothing)
  peakMW: 45,         // reference evening peak incl. industry for the interpolation
};

// Retail economics: what the player actually keeps per MWh billed.
// - gridFeePerMWh: wires, metering, balancing, service — network costs are
//   ~40% of a real retail bill. Booked as a cost on every MWh served, so
//   selling energy has a margin, not a jackpot.
// - Windfall levy (EU, 2022): when the market price spikes past levyStart,
//   the regulator skims most of the excess from inframarginal generators.
//   The player keeps levyKeep of everything above the threshold — high
//   prices still reward storage, but scarcity is no longer a business model.
export const TARIFF = { gridFeePerMWh: 18, levyStart: 100, levyKeep: 0.2 };

// Blackout compensation (VoLL): every unserved MWh costs the utility real
// money — regulators fine outages and industry claims damages. Real "value of
// lost load" studies land at €4,000-10,000/MWh; the game uses a gentler figure
// that still makes any blackout a clear net loss even while the scarcity
// price (€240) is being billed for the load that IS served.
export const VOLL = 500; // €/MWh unserved, booked as "blackout compensation"

// Industrial demand response: factories are price-sensitive — when the market
// spikes to crisis levels they pause production rather than pay (real-world
// aluminium smelters and steel mills curtail exactly like this). Hysteresis
// keeps the flag from flapping tick to tick.
export const IND_CURTAIL = { pauseAt: 150, resumeAt: 100 }; // €/MWh

// Grid interconnector (ADR 25): an HVDC link to the neighbouring region.
// Imports fill deficits BEFORE the legacy gas plant (they displace your own
// peaker; the gas marginal cost passes the import price within days of the
// carbon ramp) — but weather systems are continental: while a Dunkelflaute or
// heatwave is active the neighbours are short too, so available capacity
// collapses and the import price spikes toward scarcity. Imported power
// carries the neighbour's mix CO₂ on YOUR emitted ledger and avoids nothing.
export const INTERCONNECT = {
  price: 95,           // €/MWh normal import price (neighbour day-ahead + fees)
  eventPrice: 220,     // €/MWh while a flaute/heatwave grips the whole region
  eventCapFactor: 0.3, // fraction of link capacity available during such events
  co2PerMWh: 0.25,     // t CO₂/MWh — the neighbour's average (part-fossil) mix
  markup: 10,          // Smart Market: importing sets the price at cost + markup
};

// H₂ offtake (ADR 26): the e-fuel refinery sells grid hydrogen on long-term
// contracts — but only the amount above a strategic tank reserve, so the
// Dunkelflaute insurance is never sold out from under the fuel cells. The
// €95/MWh chemical price sits deliberately between the value of surplus power
// (€25 glut) and a scarcity fuel-cell discharge (0.58 × €240 ≈ €139/MWh):
// selling routine surplus pays, hoarding for emergencies pays better.
export const H2OFFTAKE = {
  pricePerMWh: 95,   // €/MWh chemical (LHV) ≈ €3.2/kg — real green-H₂ offtake deals run €3-6/kg
  reserveFrac: 0.4,  // fraction of tank capacity that is never sold
  co2PerMWh: 0.25,   // t CO₂ avoided downstream per MWh chemical (e-fuel displaces fossil kerosene/diesel)
};

export const VEHICLES = {
  truck: {
    name: 'E-Truck', icon: '🚚', cost: 32000, upkeep: 45, capacity: 18, speed: 9,
    batteryKWh: 600, usePerTile: 2.2, chargeMW: 0.8,
    desc: 'Electric freight truck, 600 kWh pack. Charges at freight depots — that demand hits your grid.',
  },
  bus: {
    name: 'E-Bus', icon: '🚌', cost: 26000, upkeep: 35, capacity: 30, speed: 10,
    batteryKWh: 400, usePerTile: 1.4, chargeMW: 0.5,
    desc: 'Electric city bus, 400 kWh pack. Charges at bus stops.',
  },
  train: {
    name: 'E-Locomotive', icon: '🚆', cost: 95000, upkeep: 140, capacity: 0, speed: 14,
    batteryKWh: 0, usePerTile: 0, chargeMW: 0, tractionMW: 1.0, maxWagons: 6,
    desc: 'Electric locomotive fed by overhead line — ~1 MW straight from your grid while moving, no battery. Add wagons for passengers or freight. Rail moves a tonne with ~10× less energy than road, but a blackout stops every train.',
  },
};

// Build-palette unlocks (ADR 28): advanced buildings appear as play
// progresses. Derived LIVE from game state (quests done, game day) — never
// stored, so saves need nothing and loading recomputes them. Only the palette
// is gated: place() stays lock-free (save replay, starter grid, DEBUG).
// Anything not listed here is available from turn one.
export const UNLOCKS = [
  { tool: 'rail', hint: 'Complete "🌾 Feed the food plant" — master road freight before the railway age', when: G => !!G.questsDone?.grainChain },
  { tool: 'trainStation', hint: 'Complete "🌾 Feed the food plant" — master road freight before the railway age', when: G => !!G.questsDone?.grainChain },
  { tool: 'electrolyzer', hint: 'Complete "🔋 Store the sun" (80 MWh of battery) — daily storage before seasonal storage', when: G => !!G.questsDone?.storagePlay },
  { tool: 'h2tank', hint: 'Complete "🔋 Store the sun" (80 MWh of battery) — daily storage before seasonal storage', when: G => !!G.questsDone?.storagePlay },
  { tool: 'fuelcell', hint: 'Complete "🔋 Store the sun" (80 MWh of battery) — daily storage before seasonal storage', when: G => !!G.questsDone?.storagePlay },
  { tool: 'efuel', hint: 'Complete "🫧 Hydrogen reserve" — stockpile hydrogen before you sell it', when: G => !!G.questsDone?.h2Reserve },
  { tool: 'interconnector', hint: `The Smart Market opens cross-border power trading on day ${MARKET.liveDay}`, when: G => G.day >= MARKET.liveDay },
];

// Vehicle aging (ADR 27): vehicles run at list conditions while young, then
// O&M creeps up and EV packs lose capacity — fleet renewal becomes a real
// decision. Replacement (Routes tab, or per-route auto-replace on the day
// rollover) costs a fraction of list price and resets the clock.
export const AGING = {
  graceDays: 10,         // no wear before this age
  upkeepPerDay: 0.10,    // +10% of base upkeep per day past grace…
  maxUpkeepMult: 3,      // …capped at 3×
  battWearPerDay: 0.015, // EV pack capacity lost per day past grace…
  battWearMax: 0.35,     // …floored at 65% of original capacity
  replaceFrac: 0.75,     // replacement cost as fraction of list price (trade-in)
  autoAtDays: 22,        // per-route auto-replace triggers at this age
};

// Wagons hooked behind a locomotive. A train's capacity = sum of its wagons.
export const WAGONS = {
  pax: { name: 'Passenger Car', icon: '🧍', cost: 9000, capacity: 40 },
  freight: { name: 'Freight Wagon', icon: '📦', cost: 11000, capacity: 30 },
};

// Industry archetypes placed by the world generator.
export const INDUSTRY_TYPES = {
  mine: {
    name: 'Iron Ore Mine', icon: '⛏', powerMW: 2.5,
    produces: 'ore', rate: 8, accepts: null,
    desc: 'Electric mining machinery. Produces iron ore — feed it to the Green Steel Works.',
  },
  steel: {
    name: 'Green Steel Works', icon: '🏭', powerMW: 13,
    produces: 'steel', rate: 5, accepts: 'ore', perOutput: 1.6,
    desc: 'H₂-direct-reduction + electric arc furnace. The single biggest load on your grid — real green steel needs ~3.5 MWh per tonne. Consumes a little grid hydrogen for +50% output.',
  },
  farm: {
    name: 'Farm', icon: '🌾', powerMW: 0.4,
    produces: 'grain', rate: 10, accepts: null,
    desc: 'Produces grain for the food plant.',
  },
  food: {
    name: 'Food Plant', icon: '🥫', powerMW: 4,
    produces: 'food', rate: 6, accepts: 'grain', perOutput: 1.4,
    desc: 'Electrified food processing (industrial heat pumps). Turns grain into food for the cities.',
  },
};

export const CARGO = {
  ore:   { name: 'Iron Ore', color: '#b07050', pay: 42 },
  grain: { name: 'Grain', color: '#d8b84a', pay: 36 },
  steel: { name: 'Green Steel', color: '#8fa8c0', pay: 110 },
  food:  { name: 'Food', color: '#7ec97e', pay: 80 },
  pax:   { name: 'Passengers', color: '#e8e0d0', pay: 34, payLocal: 13 }, // pay = intercity rate
};

export const TECHS = [
  { id: 'topcon', name: 'TOPCon Solar Cells', cost: 30000, days: 3, cat: 'Solar',
    fx: m => m.solar *= 1.18,
    desc: 'Tunnel-oxide passivated contacts push panel efficiency from ~21% to ~24%. +18% solar output.' },
  { id: 'perovskite', name: 'Perovskite Tandem', cost: 75000, days: 6, cat: 'Solar', req: 'topcon',
    fx: m => m.solar *= 1.3,
    desc: 'Perovskite-on-silicon tandem cells reach ~30% lab efficiency. +30% solar output.' },
  { id: 'tallTowers', name: 'Taller Wind Towers', cost: 34000, days: 3, cat: 'Wind',
    fx: m => m.wind *= 1.22,
    desc: 'Higher hubs reach steadier wind — capacity factor rises sharply with height. +22% wind output.' },
  { id: 'bladeAero', name: 'Advanced Blade Aero', cost: 64000, days: 5, cat: 'Wind', req: 'tallTowers',
    fx: m => m.wind *= 1.2,
    desc: 'Longer carbon blades sweep more area; power scales with the square of rotor diameter. +20% wind.' },
  { id: 'lfp', name: 'LFP Cell Density', cost: 40000, days: 4, cat: 'Storage',
    fx: m => m.batteryCap *= 1.35,
    // retrofit already-built batteries on LIVE completion only; on save-restore
    // the multiplier is applied before placements replay, so apply must not run
    apply: G => { G.batteryCapMWh *= 1.35; },
    desc: 'Lithium-iron-phosphate packs got ~3x cheaper in a decade. +35% capacity on all batteries.' },
  { id: 'pemEff', name: 'PEM Stack Efficiency', cost: 47000, days: 4, cat: 'Hydrogen',
    fx: m => m.elecEff = 0.75,
    desc: 'Better catalysts & membranes: electrolyzer efficiency 68% → 75%. More H₂ per surplus MWh.' },
  { id: 'sofc', name: 'Solid Oxide Fuel Cells', cost: 54000, days: 5, cat: 'Hydrogen',
    fx: m => m.fcEff = 0.64,
    desc: 'High-temperature SOFC raises reconversion efficiency 58% → 64%. H₂ round trip reaches ~48%.' },
  { id: 'heatpumps', name: 'City Heat Pumps & LED', cost: 37000, days: 4, cat: 'Efficiency',
    fx: m => m.cityDemand *= 0.85,
    desc: 'Heat pumps deliver 3-4 units of heat per unit of electricity. City demand −15%.' },
  { id: 'indEff', name: 'Industrial Efficiency', cost: 44000, days: 4, cat: 'Efficiency',
    fx: m => m.industryDemand *= 0.85,
    desc: 'Waste-heat recovery & process electrification. Industry demand −15%.' },
  { id: 'demandResponse', name: 'Demand Response', cost: 50000, days: 5, cat: 'Efficiency', req: 'heatpumps',
    fx: m => m.demandResponse = 0.25,
    desc: 'Smart meters shift flexible loads (EV charging, heat pumps, cold storage) out of the peaks into the valleys. City peaks shrink 25% toward the daily average — the energy moves in time, it doesn\'t disappear.' },
  { id: 'fastCharge', name: 'Megawatt Charging', cost: 32000, days: 3, cat: 'Transport',
    fx: m => m.chargeRate *= 2,
    desc: 'MCS megawatt charging standard: trucks charge twice as fast (and spike your grid harder).' },
  { id: 'lightVeh', name: 'Efficient Drivetrains', cost: 35000, days: 3, cat: 'Transport',
    fx: m => { m.vehicleUse *= 0.78; m.vehicleSpeed *= 1.15; },
    desc: 'Better motors, SiC inverters, aero. −22% energy per km, +15% speed.' },
];

// Contextual teaching moments. Triggered once each by simulation events.
export const TIPS = {
  welcome: {
    title: 'Welcome, Director!',
    text: 'You run both transport AND the power grid of this region. Every truck, bus, factory and home runs on electricity — and you sell it to them. Your first goals are in the 🎯 Objectives panel (top left) — click one to read how to do it, then hit 📍 to fly to the destination. Pan with the right mouse button or WASD, rotate with the middle button, press V to see passenger demand.',
  },
  firstSolar: {
    title: 'Solar: cheap but sun-shaped',
    text: 'Solar is the cheapest electricity in history — but it produces in a bell curve around noon and NOTHING at night. Watch the Dashboard: you will soon have midday surplus and evening shortage. That gap is what storage is for.',
  },
  firstWind: {
    title: 'Wind: strong but moody',
    text: 'Wind often blows when the sun doesn\'t — solar and wind complement each other. But wind comes in multi-day weather systems. Real grids plan for "Dunkelflaute": dark, windless spells lasting days.',
  },
  firstCurtail: {
    title: 'You are curtailing power!',
    text: 'Your renewables just produced more than anyone could use, so the surplus was thrown away ("curtailment"). Real grids curtail gigawatt-hours every sunny Sunday. Build Battery Storage to capture it — or an Electrolyzer to turn it into hydrogen.',
  },
  firstBlackout: {
    title: 'Blackout!',
    text: 'Demand exceeded supply and the grid went down: factories halted, charging stopped, citizens are furious — and every unserved MWh costs you €500 in blackout compensation (regulators fine outages, industry claims damages; real "value of lost load" studies say €4,000+). A reliable grid needs dispatchable power for when sun and wind are away — batteries for hours, hydrogen for days.',
  },
  indCurtail: {
    title: 'Factories are fleeing the price',
    text: 'The electricity price hit crisis levels (≥€150/MWh), so your industries paused production rather than pay it — exactly what real aluminium smelters and steel mills do. They restart below €100/MWh. Note the chain reaction: idle factories produce nothing, so your trucks and trains soon run empty. Cheap, stable power isn\'t just grid hygiene — it is what keeps your whole transport business fed.',
  },
  firstBattery: {
    title: 'Batteries: the daily workhorse',
    text: 'Grid batteries are ~92% efficient round-trip — store 10 MWh, get 9.2 back. Ideal for shifting noon solar into the evening peak (the famous "duck curve"). But at 20 MWh each, they\'re too expensive to cover whole dark weeks.',
  },
  firstElectrolyzer: {
    title: 'Hydrogen: the seasonal piggy bank',
    text: 'Your electrolyzer only runs on SURPLUS power — it\'s a flexible load that makes overbuilding solar profitable. The chain costs you: 68% electrolysis × 58% fuel cell ≈ 39% round trip. Sounds bad? Tanks are so cheap per MWh that hydrogen still wins for storing energy across days and weeks.',
  },
  firstFuelcell: {
    title: 'Closing the hydrogen loop',
    text: 'Fuel cells reconvert hydrogen when batteries run dry. Strategy used by real grid planners: batteries cycle daily, hydrogen sits in reserve for the rare dark-calm week. You now have both!',
  },
  firstGas: {
    title: 'Your legacy plant jumped in',
    text: 'Storage ran dry, so the inherited gas plant is covering the gap. Do the math: ~€70/MWh fuel + 0.45 t CO₂ × the carbon price, against the €85/MWh tariff minus €18 grid costs. It\'s already underwater — and the carbon price rises €3 every day, so the hole deepens ~€1.35/MWh daily. Real utilities face exactly this squeeze; every renewable MWh you add displaces a gas MWh and pockets the difference.',
  },
  firstOfftake: {
    title: 'Hydrogen is now a product',
    text: 'Your refinery just sold hydrogen into an e-fuel contract at €95/MWh. This is sector coupling: surplus wind and solar become molecules for ships, planes and chemistry — real projects sign exactly such offtake deals (≈€3–5/kg green H₂). Note the guard rail: it only sells above a 40% tank reserve, because selling your Dunkelflaute insurance would be a very expensive mistake. Every MWh sold displaces fossil fuel downstream and counts on your avoided-CO₂ ledger.',
  },
  firstImport: {
    title: 'Importing power',
    text: 'Your interconnector is buying from the neighbouring region — imports jump in after storage but before your gas plant, at the neighbour\'s price (~€95/MWh) and with the CO₂ of their mix (0.25 t/MWh, booked on YOUR emitted ledger). One warning from real grids: Dunkelflauten span whole continents. When one hits, everyone is short — the link thins to 30% capacity and the price nears scarcity. Interconnection helps, but it can\'t replace your own storage.',
  },
  carbon50: {
    title: 'Carbon price hits €50/t',
    text: 'A gas MWh now costs ~€70 fuel + €22.50 carbon ≈ €93 — while a billed MWh nets you ~€67 after grid costs. Your legacy plant loses ~€26 every MWh it runs, and the carbon price keeps climbing €3/day. This is the EU-ETS mechanism in miniature: emitting gets steadily more expensive until clean alternatives win.',
  },
  carbon80: {
    title: 'Carbon price hits €80/t',
    text: 'Gas generation now costs over €106/MWh to produce, rising €1.35/MWh every day — deep in loss territory. If it still runs regularly, your storage is undersized. But careful with the wrecking ball: an idle plant costs only €400/day and every blackout it prevents saves €500/MWh in compensation. Decommission it (click the plant, €60k exit grant) only once batteries, hydrogen and the interconnector can carry a winter Dunkelflaute alone — that is the real endgame.',
  },
  gasDecommissioned: {
    title: 'Fossil-free — no safety net',
    text: 'The gas plant is gone and the exit grant is in your account. The trade-off: deficits now go straight from fuel cells to blackout — there is no fossil backstop anymore. Keep your H₂ tanks stocked before winter and Dunkelflautes. This is the real endgame of the energy transition: firm clean capacity replaces fossil reserve.',
  },
  marketAnnounce: {
    title: 'Smart Market announced',
    text: 'Pressure on the energy market is rising: in 2 days the regulator introduces the Smart Market — prices will follow supply and demand, making intelligent use of energy profitable. Scarce hours will pay up to €240/MWh, glut hours as little as €25. Two days to prepare: charged batteries and full H₂ tanks are about to become a business.',
  },
  marketLive: {
    title: 'The Smart Market is live!',
    text: 'The flat €85/MWh tariff is history — the price now moves with supply and demand (watch the 💶 ticker in the top bar). The most expensive running source sets the price: blackouts spike it to €240/MWh, the gas plant sets it at its cost + €15, and curtailed surplus crashes it to €25. One catch, straight from the EU\'s 2022 playbook: a windfall levy skims 80% of any price above €100/MWh — flexibility earns real money, engineered scarcity doesn\'t.',
  },
  scarcitySale: {
    title: 'Your storage just sold at €240/MWh!',
    text: 'Demand outran supply, the price hit the €240/MWh scarcity cap — and your battery/fuel cell discharged straight into it. After the windfall levy that still nets ~€128/MWh, roughly double a normal hour. This is storage arbitrage, the business model of real grid batteries: buy (charge) when power is nearly free, sell when the grid is desperate — and every MWh it delivers also spares you €500 in blackout compensation.',
  },
  dunkelflaute: {
    // fires at SCHEDULE time (~10-14 h before arrival), not at arrival — the
    // lead time is the preparation window (see energy.js updateWeather, ADR 23)
    title: 'Dunkelflaute inbound!',
    text: 'The forecast shows a high-pressure system arriving in ~12 hours: ~2 days of thick clouds AND almost no wind. This is the hardest test of any renewable grid — your batteries alone won\'t last, this is exactly what hydrogen reserves are for. Use the lead time: charge everything now and check your H₂ tank level!',
  },
  heatwave: {
    // fires when the heatwave front ARRIVES (the banner already warned during
    // the lead time) — the phenomenon needs to be observable to be teachable
    title: 'Heatwave — a heat dome sits over the region',
    text: 'Air conditioners are pushing city demand +30% — while your turbines idle, because heat domes are stagnant high-pressure air, not wind. The one mercy: cloudless skies mean strong solar. This is a classic climate-change stress test for real grids (Texas 2023, Europe 2022): peak demand and calm air arrive together. Batteries charged at noon carry the hot evening.',
  },
  climateRisk: {
    title: 'The weather dice are loaded',
    text: 'Your gas habit is catching up with you: emitted CO₂ has pushed extreme-event risk to "elevated" — storms and heatwaves now roll noticeably more often (up to 2× at high emissions, see the 📊 Climate box). This is climate attribution in miniature: a warmer atmosphere makes extreme weather more frequent and more intense. Every gas MWh you avoid keeps the dice fairer.',
  },
  storm: {
    title: 'Storm cut-out',
    text: 'Wind speeds passed ~90 km/h, so turbines feathered their blades and shut down to protect themselves — a real effect that can drop gigawatts off a grid within an hour. Storage bridges the gap.',
  },
  steelHungry: {
    title: 'Green steel is power-hungry',
    text: 'Your Steel Works uses hydrogen direct reduction + an electric arc furnace — like real plants in Sweden (HYBRIT) and Germany. Real green steel needs ~3.5 MWh per tonne, ~10x a household\'s daily use per single tonne. Industry, not homes, is the big electrification challenge.',
  },
  firstBusStop: {
    title: 'Passengers have destinations',
    text: 'People wait in cities to travel — some across town, some to another city. Press V (or the 👥 Demand button) to see who waits where and where they want to go. A bus only boards passengers its route can actually deliver, so connect two stops in the same city (≥5 tiles apart) for local trips, or two cities for intercity trips.',
  },
  firstRail: {
    title: 'The most efficient way to move anything',
    text: 'Steel wheel on steel rail has ~10× less rolling resistance than rubber on asphalt — that\'s why rail moves a tonne of freight for a fraction of a truck\'s energy. Lay track between two Rail Stations (tracks cross roads at level crossings), then buy a locomotive in the Routes tab.',
  },
  firstTrainStation: {
    title: 'Rail stations do both jobs',
    text: 'A Rail Station serves passengers AND freight in radius 7 — one station can sit between a city and a factory. It must touch your track. The capacity comes from wagons: add Passenger Cars or Freight Wagons to each locomotive in the Routes tab.',
  },
  firstTrain: {
    title: 'No battery — straight from the catenary',
    text: 'Most electric railways skip the battery entirely: power flows from the grid through the overhead line to the motors. Your locomotive draws ~1 MW while moving (see the "Charging" slice in the Dashboard) — and during a blackout, trains roll to a stop. Reliable grid, reliable railway.',
  },
  vehicleAging: {
    title: 'Your fleet is aging',
    text: 'A vehicle just passed 10 days of service. From here its daily upkeep creeps up (to 3× at worst) and EV packs lose usable capacity (down to 65%) — shorter legs, longer charging stops. Fleet economics: at some point replacing (75% of list price, 🔧 in the Routes tab) beats maintaining — real fleet operators plan exactly this trade-off. Tick "auto-replace" on a route to let your depot handle it overnight.',
  },
  chargingLoad: {
    title: 'Vehicle charging hits the grid',
    text: 'Your electric fleet charges at stations — see the "Charging" slice in the Dashboard. Smart timing matters: in reality, fleets charge at midday (solar surplus) or at night (cheap wind), not during the evening peak.',
  },
  firstContract: {
    title: 'Special contracts on offer',
    text: 'Cities and industries post time-limited transport contracts — check the 📜 Contracts tab. Sign one and every matching delivery pays a +50% premium, plus a cash bonus if you hit the target before the deadline. Unsigned offers rotate out after a while, and a missed deadline costs nothing but the bonus.',
  },
  firstLoan: {
    title: 'Debt: leverage with a price tag',
    text: 'Renewables are capital-intensive: nearly all the cost is upfront and the "fuel" is free — so the cost of capital matters. Your loan charges 1% interest per day on the outstanding amount (see Expenses). Borrow to build early, but repay from the Finances panel before the interest eats your margin.',
  },
  research: {
    title: 'Research pays compound interest',
    text: 'Real-world solar got ~90% cheaper since 2010, batteries ~85%. The Research tab gives you the same curve: efficiency techs lower demand, generation techs raise output. Efficiency is the invisible power plant!',
  },
  richGrid: {
    title: 'Energy seller!',
    text: 'Your grid revenue now rivals your transport income. In this game — as in reality — clean power is a product. Every MWh you serve replaces fossil generation: you\'ve avoided real CO₂ (top bar).',
  },
};

// Encyclopedia entries for the Learn tab.
export const LEARN = [
  ['The 24h problem', 'Demand peaks in the morning and evening; solar peaks at noon. The mismatch — the "duck curve" — is THE core puzzle of renewable grids. Solve it with storage, flexible loads, and a generation mix.'],
  ['Solar PV', 'Photovoltaics convert ~20-24% of sunlight to power (modern panels). Output = capacity × sun elevation × (1 − cloud cover). Cheapest energy source ever measured, but zero at night.'],
  ['Wind power', 'Power grows with the CUBE of wind speed until rated speed, then is capped; above ~90 km/h turbines cut out for safety. Onshore capacity factor ~25-35%; complements solar (more wind in winter & at night).'],
  ['Run-of-river hydro', 'Uses river flow without a big dam. Steady, predictable output around the clock — valuable "baseload" renewable, but limited by geography.'],
  ['Battery storage (Li-ion)', '~92% round-trip efficiency, instant response. Cost per stored MWh is high, so batteries shine for HOURS of shifting (noon→evening), cycling daily to earn their keep.'],
  ['Hydrogen & electrolyzers', 'Electrolyzers split water into H₂ using surplus power (~68% eff., research → 75%). H₂ tanks store energy cheaply per MWh, so hydrogen wins for DAYS-to-WEEKS storage despite a ~39% round trip via fuel cell.'],
  ['Curtailment', 'When production exceeds demand + storage intake, surplus is discarded. Some curtailment is economically optimal — but persistent curtailment says: add storage or flexible demand (like your electrolyzer).'],
  ['Dunkelflaute', 'German for "dark calm": overcast AND windless for days. Rare but defining for system design — this is why grids keep long-duration reserves (hydrogen, in this game) even if rarely used.'],
  ['Green steel', 'Steel = ~7% of world CO₂. Green route: hydrogen direct reduction (H₂-DRI) + electric arc furnace ≈ 3.5 MWh per tonne of steel. Pioneers: HYBRIT (Sweden), Stegra, Thyssenkrupp.'],
  ['Electric transport', 'EVs are ~3x more energy-efficient than combustion vehicles. Fleet charging is a big but FLEXIBLE load — charge when power is abundant and it stabilizes the grid instead of stressing it.'],
  ['Electrified rail', 'Steel-on-steel rolling resistance is ~10× lower than tyre-on-road, so rail moves a tonne-km on a fraction of the energy. Most electric trains have no battery: traction power flows live from the grid via the catenary (overhead line) — grid reliability IS railway reliability.'],
  ['Efficiency', 'Heat pumps (300-400% "efficient"), LED, waste-heat recovery: every MWh not consumed needs no generation, no storage, no grid. Cheapest energy is the energy you don\'t use.'],
  ['CO₂ accounting', 'Each renewable MWh that replaces fossil generation avoids roughly 0.4-0.8 t CO₂ (this game uses 0.4 t/MWh, a typical gas/coal-mix figure).'],
  ['Value of lost load', 'What one undelivered MWh costs society — studies say €4,000-10,000. Utilities pay fines and damages for outages (this game: €500/MWh "blackout compensation"), which is why grids hold reserves that rarely run.'],
  ['Windfall levy', 'In the 2022 price crisis the EU capped "inframarginal" revenues: generators whose costs hadn\'t risen were skimmed above a threshold. Here: above €100/MWh you keep 20 cents on the euro — reliability pays, scarcity profiteering doesn\'t.'],
  ['Grid fees', 'Roughly 40% of a real electricity bill is not energy: wires, transformers, metering, balancing. Your €18/MWh grid operations cost models that — selling power is a margin business, and efficiency techs widen the margin.'],
  ['Industrial demand response', 'Electricity-intensive industry (aluminium, steel, chlorine) pauses production when prices spike — cheaper than paying crisis prices. In the game your factories halt above €150/MWh and restart below €100: keep power cheap or your freight dries up.'],
];
