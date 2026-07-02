// World generation and every placement/bulldoze rule.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, on } from '../src/sim/state.js';
import { tile, canPlace, place, bulldoze, isRail, isRoad, lShapedPath, dragCost } from '../src/sim/grid.js';
import { BUILDINGS } from '../src/sim/data.js';
import { freshWorld, findSpot, findGrass, findWater } from './helpers.js';

beforeEach(() => freshWorld());

test('world generation: 3 named cities, 4 industries, a river, street grids', () => {
  assert.equal(G.cities.length, 3);
  assert.deepEqual(G.cities.map(c => c.name), ['Solhaven', 'Windburg', 'Hydrovale']);
  assert.equal(G.industries.length, 4);
  assert.ok(G.tiles.some(t => t.t === 'water'), 'river exists');
  for (const c of G.cities) {
    assert.ok(c.roadTiles.length > 10, `${c.name} has streets`);
    assert.ok(c.blockTiles.length > 10, `${c.name} has buildings`);
    assert.ok(c.pop >= 2200);
  }
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
