// World generation and every placement/bulldoze rule.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, on } from '../src/sim/state.js';
import { tile, canPlace, place, bulldoze, decommissionGas, isRail, isRoad, isUnlocked, unlockHint, lShapedPath, dragCost, WATER_Y } from '../src/sim/grid.js';
import { BUILDINGS, CARBON, MARKET, UNLOCKS } from '../src/sim/data.js';
import { freshWorld, findSpot, findGrass, findWater } from './helpers.js';

beforeEach(() => freshWorld());

test('world generation: 8 named cities, 9 industries, a river, street grids', () => {
  assert.equal(G.cities.length, 8);
  assert.deepEqual(
    G.cities.map(c => c.name),
    ['Solhaven', 'Windburg', 'Hydrovale', 'Voltfurt', 'Gridholm', 'Ampfeld', 'Wattstad', 'Ohmsberg'],
  );
  assert.equal(G.industries.length, 9);
  // every cargo chain has at least two producers/processors to connect
  const byType = {};
  for (const d of G.industries) byType[d.type] = (byType[d.type] || 0) + 1;
  assert.deepEqual(byType, { mine: 2, steel: 2, farm: 3, food: 2 });
});

test('city neighbour graph: symmetric, connected, and sparse', () => {
  const edges = G.cities.reduce((a, c) => a + c.neighbors.length, 0) / 2;
  assert.ok(Number.isInteger(edges), 'symmetric (every edge counted from both ends)');
  for (const c of G.cities) {
    for (const oi of c.neighbors) {
      assert.ok(G.cities[oi].neighbors.includes(c.idx), `${c.name} ↔ ${G.cities[oi].name} is mutual`);
    }
  }
  // sparse: real neighbourhoods, not the complete graph
  const all = G.cities.length * (G.cities.length - 1) / 2;
  assert.ok(edges < all, `${edges} edges < ${all} all-pairs`);
  // connected: every city reachable via neighbour hops (RNG ⊇ MST)
  const seen = new Set([0]), q = [0];
  while (q.length) for (const n of G.cities[q.shift()].neighbors) if (!seen.has(n)) { seen.add(n); q.push(n); }
  assert.equal(seen.size, G.cities.length);
  assert.ok(G.tiles.some(t => t.t === 'water'), 'river exists');
  for (const c of G.cities) {
    assert.ok(c.roadTiles.length > 10, `${c.name} has streets`);
    assert.ok(c.blockTiles.length > 10, `${c.name} has buildings`);
    assert.ok(c.pop >= 2200);
  }
});

test('river (WP6): seeded meander enters the north edge and empties into a SE lake', () => {
  // water reaches the top (north) edge — the river mouth
  const northWater = [];
  for (let i = 0; i < G.N; i++) if (tile(i, G.N - 1).t === 'water') northWater.push(i);
  assert.ok(northWater.length > 0, 'river touches the north edge');
  assert.ok(northWater.every(i => i > G.N / 2), 'the mouth is in the eastern half');

  // a lake basin exists in the south-east: a broad cluster of water tiles
  let lake = 0;
  for (let j = 12; j < 34; j++) for (let i = 128; i < 150; i++) if (tile(i, j).t === 'water') lake++;
  assert.ok(lake > 60, `SE lake basin present (${lake} water tiles)`);

  // the channel keeps the east mines and the west-bank steel apart (oreChain
  // bridge lesson): the mine at i≈150 is east, the steel at i≈118 is west
  const mineE = G.industries.find(d => d.type === 'mine' && d.i > 140);
  const steelW = G.industries.find(d => d.type === 'steel' && d.i < 130);
  assert.ok(mineE && steelW, 'east mine + west steel still generate');

  // the SW fixture corner stays dry grass for the road/rail tests
  assert.equal(tile(10, 90).t, 'grass', 'SW corner untouched by the river');
});

test('river (WP6): worldgen is deterministic — same seed → identical water', () => {
  const a = G.tiles.map(t => t.t === 'water').join('');
  freshWorld();
  const b = G.tiles.map(t => t.t === 'water').join('');
  assert.equal(a, b, 'two fresh worlds carve the exact same river/lake');
});

test('river (WP6): water is unbuildable for buildings; road/rail cross only as a bridge', () => {
  const [wi, wj] = findWater();
  // no building footprint may sit on water
  assert.equal(canPlace('solar', wi, wj), false, 'solar rejected on water');
  assert.equal(canPlace('hydro', wi, wj), false, 'even hydro cannot occupy the water itself');
  // but a road/rail may cross — it becomes a raised bridge deck
  assert.equal(canPlace('road', wi, wj), true);
  place('road', wi, wj);
  assert.equal(tile(wi, wj).bridge, true, 'road over water is a bridge');
  assert.ok(tile(wi, wj).h > WATER_Y, 'bridge deck raised above the water plane');
});

test('roads: placeable on grass, not on occupied tiles; water becomes a bridge', () => {
  const [i, j] = findGrass();
  assert.equal(canPlace('road', i, j), true);
  place('road', i, j);
  assert.equal(tile(i, j).t, 'road');
  assert.equal(canPlace('road', i, j), false); // already road

  const blocked = G.cities[0].blockTiles[0];
  assert.equal(canPlace('road', blocked.i, blocked.j), false);

  const [wi, wj] = findWater();
  assert.equal(canPlace('road', wi, wj), true);
  place('road', wi, wj);
  assert.equal(tile(wi, wj).bridge, true);
  assert.ok(tile(wi, wj).h > 0 - 1, 'bridge deck raised above water');
});

test('rail over a road tile forms a level crossing; bulldoze removes rail first', () => {
  const [i, j] = findGrass();
  place('road', i, j);
  assert.equal(canPlace('rail', i, j), true);
  place('rail', i, j);
  assert.equal(tile(i, j).t, 'road', 'road survives under the crossing');
  assert.equal(isRail(i, j), true);

  const refund = bulldoze(i, j);
  assert.equal(refund, BUILDINGS.rail.cost * 0.3);
  assert.equal(isRail(i, j), false);
  assert.equal(isRoad(i, j), true, 'road still there after removing the rail');
});

test('stations require an adjacent road; rail stations an adjacent rail', () => {
  const [i, j] = findGrass();
  assert.equal(canPlace('busStop', i, j), false, 'no road nearby yet');
  place('road', i, j);
  // some neighbor of the road tile is now valid
  const ok = [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].some(([a, b]) => canPlace('busStop', a, b));
  assert.equal(ok, true);
  assert.equal(findSpot('trainStation'), null, 'no rail on the map → nowhere to put a rail station');
});

test('hydro must touch water; solar/wind must not overlap anything', () => {
  const [hi, hj] = findSpot('hydro');
  let touchesWater = false;
  for (let dj = -1; dj <= 2; dj++) for (let di = -1; di <= 2; di++) {
    const t = tile(hi + di, hj + dj);
    if (t && t.t === 'water') touchesWater = true;
  }
  assert.equal(touchesWater, true);

  const [si, sj] = findSpot('solar');
  place('solar', si, sj);
  assert.equal(canPlace('solar', si, sj), false, 'footprint now occupied');
});

test('storage buildings register capacity on place and deregister on bulldoze', () => {
  const [i, j] = findSpot('battery');
  place('battery', i, j);
  assert.equal(G.batteryCapMWh, 20);
  assert.equal(G.batteryRateMW, 10);

  const [ei, ej] = findSpot('electrolyzer');
  place('electrolyzer', ei, ej);
  const [ti, tj] = findSpot('h2tank');
  place('h2tank', ti, tj);
  const [fi, fj] = findSpot('fuelcell');
  place('fuelcell', fi, fj);
  assert.equal(G.elecCapMW, 5);
  assert.equal(G.h2CapMWh, 150);
  assert.equal(G.fcCapMW, 5);

  const refund = bulldoze(i, j);
  assert.equal(refund, BUILDINGS.battery.cost * 0.3);
  assert.equal(G.batteryCapMWh, 0);
  assert.equal(G.batteryRateMW, 0);
  assert.equal(G.plants.length, 3);
});

test('interconnector registers import capacity on place, deregisters on bulldoze (ADR 25)', () => {
  const [i, j] = findSpot('interconnector');
  place('interconnector', i, j);
  assert.equal(G.importCapMW, 12);
  bulldoze(i, j);
  assert.equal(G.importCapMW, 0);
});

test('e-fuel refinery registers offtake capacity on place, deregisters on bulldoze (ADR 26)', () => {
  const [i, j] = findSpot('efuel');
  place('efuel', i, j);
  assert.equal(G.offtakeCapMW, 4);
  bulldoze(i, j);
  assert.equal(G.offtakeCapMW, 0);
});

test('LFP research multiplies capacity of batteries placed afterwards', () => {
  G.mult.batteryCap = 1.35;
  const [i, j] = findSpot('battery');
  place('battery', i, j);
  assert.ok(Math.abs(G.batteryCapMWh - 27) < 1e-9);
});

test('bulldozing a station removes it from every route', () => {
  const [i, j] = findGrass();
  place('road', i, j);
  const spot = [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].find(([a, b]) => canPlace('truckStop', a, b));
  const st = place('truckStop', spot[0], spot[1]);
  G.routes.push({ id: 1, stops: [st], vehicles: [] });
  const events = [];
  on('bulldozed', r => events.push(r));
  bulldoze(st.i, st.j);
  assert.equal(G.stations.length, 0);
  assert.equal(G.routes[0].stops.length, 0);
  assert.deepEqual(events, [st], 'renderer is told to drop the mesh');
});

test('build-palette unlocks derive from progress; placement stays lock-free (ADR 28)', () => {
  // every gated tool must exist (and carry a player-facing hint)
  for (const u of UNLOCKS) {
    assert.ok(BUILDINGS[u.tool], `unknown tool ${u.tool}`);
    assert.ok(u.hint.length > 10, `hint missing for ${u.tool}`);
  }
  // fresh game: the basics are open, the advanced tiers are locked
  for (const id of ['road', 'busStop', 'truckStop', 'solar', 'wind', 'hydro', 'battery']) {
    assert.ok(isUnlocked(id), `${id} should be open from turn one`);
  }
  assert.equal(isUnlocked('rail'), false);
  assert.equal(isUnlocked('trainStation'), false);
  assert.equal(isUnlocked('electrolyzer'), false);
  assert.equal(isUnlocked('efuel'), false);
  assert.equal(isUnlocked('interconnector'), false);
  assert.ok(unlockHint('rail').includes('Feed the food plant'));
  // milestones flip them
  G.questsDone = { grainChain: true };
  assert.ok(isUnlocked('rail') && isUnlocked('trainStation'), 'rail age after the first freight chain');
  G.questsDone.storagePlay = true;
  assert.ok(isUnlocked('electrolyzer') && isUnlocked('h2tank') && isUnlocked('fuelcell'), 'H₂ chain after batteries');
  assert.equal(isUnlocked('efuel'), false, 'refinery still needs the H₂ reserve');
  G.questsDone.h2Reserve = true;
  assert.ok(isUnlocked('efuel'));
  G.day = MARKET.liveDay;
  assert.ok(isUnlocked('interconnector'), 'cross-border trading with the Smart Market');
  // the SIM never locks: save replay / starter grid / DEBUG go through place()
  G.questsDone = {}; G.day = 1;
  const [i, j] = findSpot('h2tank');
  assert.ok(canPlace('h2tank', i, j), 'canPlace ignores palette locks');
  assert.ok(place('h2tank', i, j), 'place ignores palette locks');
});

test('legacy gas plant: placeable (save replay path) though hidden from the palette', () => {
  assert.equal(BUILDINGS.gas.legacy, true, 'flag the toolbar filters on');
  const [i, j] = findSpot('gas');
  assert.ok(i != null, 'canPlace works for the legacy type');
  const ref = place('gas', i, j);
  assert.equal(ref.kind, 'plant');
  assert.ok(G.plants.some(p => p.type === 'gas'));
});

test('decommissionGas: grant paid once, plant + capacity gone, mesh dropped, second call a no-op', () => {
  const [i, j] = findSpot('gas');
  place('gas', i, j);
  const events = [];
  on('bulldozed', r => events.push(r.type));
  const before = G.money;
  assert.equal(decommissionGas(), true);
  assert.equal(G.money, before + CARBON.exitGrant, 'exit grant, no 30% refund on top');
  assert.equal(G.gasDecommissioned, true);
  assert.equal(G.plants.filter(p => p.type === 'gas').length, 0, 'capacity gone');
  assert.deepEqual(events, ['gas'], 'renderer told to drop the mesh');
  assert.equal(tile(i, j).t, 'grass', 'tiles freed');

  const after = G.money;
  assert.equal(decommissionGas(), false, 'irreversible, cannot repeat');
  assert.equal(G.money, after, 'no second grant');
});

test('bulldozing the gas plant routes through decommission (grant instead of refund)', () => {
  const [i, j] = findSpot('gas');
  place('gas', i, j);
  const before = G.money;
  const refund = bulldoze(i, j);
  assert.equal(refund, 0, 'no bulldoze refund');
  assert.equal(G.money, before + CARBON.exitGrant, 'grant paid via the bulldoze path');
  assert.equal(G.gasDecommissioned, true);
  assert.equal(decommissionGas(), false);
});

test('city streets are protected from the bulldozer', () => {
  const street = G.cities[0].roadTiles[0];
  assert.equal(canPlace('bulldoze', street.i, street.j), false);
  assert.equal(bulldoze(street.i, street.j), 0);
});

test('lShapedPath covers both legs; dragCost bills bridges 5×', () => {
  const path = lShapedPath(2, 2, 5, 4);
  assert.deepEqual(path[0], [2, 2]);
  assert.deepEqual(path.at(-1), [5, 4]);
  assert.equal(path.length, 6); // 4 tiles along i, then 2 more along j

  const [gi, gj] = findGrass();
  assert.equal(dragCost([[gi, gj]], 'road'), BUILDINGS.road.cost);
  const [wi, wj] = findWater();
  assert.equal(dragCost([[wi, wj]], 'road'), BUILDINGS.road.cost * 5);
});
