import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isRail } from '../src/sim/grid.js';
import { findPath } from '../src/sim/transport.js';
import { freshWorld, buildRoad, buildRail } from './helpers.js';

// a quiet corner in the south-west: grass, far from cities and the river
const J = 90;

beforeEach(() => freshWorld());

test('A* finds a straight road path', () => {
  buildRoad(2, J, 12, J);
  const path = findPath(2, J, 12, J);
  assert.ok(path, 'path found');
  assert.equal(path.length, 11);
  assert.deepEqual(path[0], [2, J]);
  assert.deepEqual(path.at(-1), [12, J]);
});

test('A* follows an L-shaped network around the corner', () => {
  buildRoad(2, J, 10, J);
  buildRoad(10, J, 10, J - 8);
  const path = findPath(2, J, 10, J - 8);
  assert.ok(path);
  assert.equal(path.length, 9 + 8); // manhattan distance + 1
  // every step is 4-connected
  for (let k = 1; k < path.length; k++) {
    const d = Math.abs(path[k][0] - path[k - 1][0]) + Math.abs(path[k][1] - path[k - 1][1]);
    assert.equal(d, 1);
  }
});

test('no connection → null (disconnected segments)', () => {
  buildRoad(2, J, 5, J);
  buildRoad(9, J, 12, J); // gap at 6-8
  assert.equal(findPath(2, J, 12, J), null);
});

test('rail and road are separate networks', () => {
  buildRoad(2, J, 12, J);
  buildRail(2, J - 2, 12, J - 2);
  assert.equal(findPath(2, J - 2, 12, J - 2), null, 'rail tiles are not roads');
  const railPath = findPath(2, J - 2, 12, J - 2, isRail);
  assert.ok(railPath, 'but trains can path over them');
  assert.equal(railPath.length, 11);
});

test('start or goal off-network → null', () => {
  buildRoad(2, J, 12, J);
  assert.equal(findPath(2, J, 12, J + 1), null);
});
