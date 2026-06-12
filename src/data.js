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
  solar: {
    name: 'Solar Farm', icon: '☀️', cost: 42000, upkeep: 120, footprint: 3, category: 'energy', capMW: 5,
    desc: '5 MWp photovoltaic park. Output follows the sun and drops with cloud cover. Zero output at night — pair with storage.',
  },
  wind: {
    name: 'Wind Turbine', icon: '🌬', cost: 38000, upkeep: 160, footprint: 1, category: 'energy', capMW: 4,
    desc: '4 MW onshore turbine. Needs wind: cut-in ~11 km/h, rated ~43 km/h, storm cut-out ~90 km/h.',
  },
  hydro: {
    name: 'Hydro Plant', icon: '💧', cost: 130000, upkeep: 250, footprint: 2, category: 'energy', capMW: 8, nearWater: true,
    desc: '8 MW run-of-river plant. Steady renewable baseload. Must be built at the river.',
  },
  battery: {
    name: 'Battery Storage', icon: '🔋', cost: 52000, upkeep: 90, footprint: 2, category: 'storage',
    storeMWh: 20, rateMW: 10,
    desc: '20 MWh / 10 MW lithium grid battery, ~92% round trip. Perfect for shifting solar noon → evening peak.',
  },
  electrolyzer: {
    name: 'Electrolyzer', icon: '⚡', cost: 60000, upkeep: 140, footprint: 2, category: 'storage', elecMW: 5,
    desc: '5 MW PEM electrolyzer. Turns surplus power into hydrogen (~68% efficient). A flexible load that soaks up cheap midday solar.',
  },
  h2tank: {
    name: 'H₂ Storage Tank', icon: '🫧', cost: 28000, upkeep: 60, footprint: 2, category: 'storage', h2MWh: 150,
    desc: 'Stores 150 MWh of hydrogen (chemical energy). Cheap per MWh — built for days or weeks of reserve, not hours.',
  },
  fuelcell: {
    name: 'Fuel Cell Plant', icon: '♻️', cost: 52000, upkeep: 130, footprint: 2, category: 'storage', fcMW: 5,
    desc: '5 MW fuel-cell plant. Converts stored hydrogen back to power (~58% efficient). Your insurance for dark, windless weeks.',
  },
  bulldoze: {
    name: 'Bulldoze', icon: '🧨', cost: 0, footprint: 1, category: 'transport',
    desc: 'Demolish your buildings & roads (30% refund).',
  },
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
  ore:   { name: 'Iron Ore', color: '#b07050', pay: 28 },
  grain: { name: 'Grain', color: '#d8b84a', pay: 24 },
  steel: { name: 'Green Steel', color: '#8fa8c0', pay: 75 },
  food:  { name: 'Food', color: '#7ec97e', pay: 55 },
  pax:   { name: 'Passengers', color: '#e8e0d0', pay: 16 },
};

export const TECHS = [
  { id: 'topcon', name: 'TOPCon Solar Cells', cost: 45000, days: 3, cat: 'Solar',
    fx: m => m.solar *= 1.18,
    desc: 'Tunnel-oxide passivated contacts push panel efficiency from ~21% to ~24%. +18% solar output.' },
  { id: 'perovskite', name: 'Perovskite Tandem', cost: 110000, days: 6, cat: 'Solar', req: 'topcon',
    fx: m => m.solar *= 1.3,
    desc: 'Perovskite-on-silicon tandem cells reach ~30% lab efficiency. +30% solar output.' },
  { id: 'tallTowers', name: 'Taller Wind Towers', cost: 50000, days: 3, cat: 'Wind',
    fx: m => m.wind *= 1.22,
    desc: 'Higher hubs reach steadier wind — capacity factor rises sharply with height. +22% wind output.' },
  { id: 'bladeAero', name: 'Advanced Blade Aero', cost: 95000, days: 5, cat: 'Wind', req: 'tallTowers',
    fx: m => m.wind *= 1.2,
    desc: 'Longer carbon blades sweep more area; power scales with the square of rotor diameter. +20% wind.' },
  { id: 'lfp', name: 'LFP Cell Density', cost: 60000, days: 4, cat: 'Storage',
    fx: m => m.batteryCap *= 1.35,
    desc: 'Lithium-iron-phosphate packs got ~3x cheaper in a decade. +35% capacity on all batteries.' },
  { id: 'pemEff', name: 'PEM Stack Efficiency', cost: 70000, days: 4, cat: 'Hydrogen',
    fx: m => m.elecEff = 0.75,
    desc: 'Better catalysts & membranes: electrolyzer efficiency 68% → 75%. More H₂ per surplus MWh.' },
  { id: 'sofc', name: 'Solid Oxide Fuel Cells', cost: 80000, days: 5, cat: 'Hydrogen',
    fx: m => m.fcEff = 0.64,
    desc: 'High-temperature SOFC raises reconversion efficiency 58% → 64%. H₂ round trip reaches ~48%.' },
  { id: 'heatpumps', name: 'City Heat Pumps & LED', cost: 55000, days: 4, cat: 'Efficiency',
    fx: m => m.cityDemand *= 0.85,
    desc: 'Heat pumps deliver 3-4 units of heat per unit of electricity. City demand −15%.' },
  { id: 'indEff', name: 'Industrial Efficiency', cost: 65000, days: 4, cat: 'Efficiency',
    fx: m => m.industryDemand *= 0.85,
    desc: 'Waste-heat recovery & process electrification. Industry demand −15%.' },
  { id: 'fastCharge', name: 'Megawatt Charging', cost: 48000, days: 3, cat: 'Transport',
    fx: m => m.chargeRate *= 2,
    desc: 'MCS megawatt charging standard: trucks charge twice as fast (and spike your grid harder).' },
  { id: 'lightVeh', name: 'Efficient Drivetrains', cost: 52000, days: 3, cat: 'Transport',
    fx: m => { m.vehicleUse *= 0.78; m.vehicleSpeed *= 1.15; },
    desc: 'Better motors, SiC inverters, aero. −22% energy per km, +15% speed.' },
];

// Contextual teaching moments. Triggered once each by simulation events.
export const TIPS = {
  welcome: {
    title: 'Welcome, Director!',
    text: 'You run both transport AND the power grid of this region. Every truck, bus, factory and home runs on electricity — and you sell it to them. Build a Solar Farm and a Wind Turbine to get started, then connect industries with roads, depots and trucks.',
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
    text: 'Demand exceeded supply and the grid went down: factories halted, charging stopped, citizens are furious. A reliable grid needs dispatchable power for when sun and wind are away — batteries for hours, hydrogen for days.',
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
  dunkelflaute: {
    title: 'Dunkelflaute warning!',
    text: 'A high-pressure system brings ~2 days of thick clouds AND almost no wind. This is the hardest test of any renewable grid. Your batteries alone won\'t last — this is exactly what hydrogen reserves are for. Check your H₂ tank level!',
  },
  storm: {
    title: 'Storm cut-out',
    text: 'Wind speeds passed ~90 km/h, so turbines feathered their blades and shut down to protect themselves — a real effect that can drop gigawatts off a grid within an hour. Storage bridges the gap.',
  },
  steelHungry: {
    title: 'Green steel is power-hungry',
    text: 'Your Steel Works uses hydrogen direct reduction + an electric arc furnace — like real plants in Sweden (HYBRIT) and Germany. Real green steel needs ~3.5 MWh per tonne, ~10x a household\'s daily use per single tonne. Industry, not homes, is the big electrification challenge.',
  },
  chargingLoad: {
    title: 'Vehicle charging hits the grid',
    text: 'Your electric fleet charges at stations — see the "Charging" slice in the Dashboard. Smart timing matters: in reality, fleets charge at midday (solar surplus) or at night (cheap wind), not during the evening peak.',
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
  ['Efficiency', 'Heat pumps (300-400% "efficient"), LED, waste-heat recovery: every MWh not consumed needs no generation, no storage, no grid. Cheapest energy is the energy you don\'t use.'],
  ['CO₂ accounting', 'Each renewable MWh that replaces fossil generation avoids roughly 0.4-0.8 t CO₂ (this game uses 0.4 t/MWh, a typical gas/coal-mix figure).'],
];
