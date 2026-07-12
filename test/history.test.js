// sampleHistory: the 48h ring buffer feeding the dashboard charts, and
// pathPose: the position/heading interpolation every vehicle mesh rides on.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { G, resetState } from '../src/sim/state.js';
import { sampleHistory } from '../src/sim/energy.js';
import { pathPose } from '../src/sim/pathfinding.js';
import { worldXZ } from '../src/sim/grid.js';

beforeEach(() => resetState());

test('sampleHistory records every 15 game minutes, not every call', () => {
  G.supply.solar = 3; G.price = 85;
  sampleHistory(10);
  assert.equal(G.history.length, 0, 'below the 15-minute sampling interval');
  sampleHistory(6); // accumulated 16 minutes
  assert.equal(G.history.length, 1);
  const s = G.history[0];
  assert.equal(s.solar, 3, 'captures the live supply');
  assert.equal(s.price, 85, 'captures the market price');
  assert.equal(s.demandTotal, 0);
});

test('history is a ring buffer capped at histMax (48h window)', () => {
  for (let k = 0; k < G.histMax + 20; k++) sampleHistory(15);
  assert.equal(G.history.length, G.histMax);
  assert.equal(G.moneyHistory.length <= 240, true, 'money history capped too');
});

test('sampleHistory normalizes storage fill to 0..1 (0 when no storage built)', () => {
  sampleHistory(15);
  assert.equal(G.history[0].batt, 0, 'no battery capacity → 0, not NaN');
  G.batteryCapMWh = 20; G.batteryMWh = 5;
  sampleHistory(15);
  assert.equal(G.history[1].batt, 0.25);
});

// ---- pathPose --------------------------------------------------------------

const path = [[10, 10], [11, 10], [12, 10], [12, 11]];

test('pathPose interpolates position along the path', () => {
  const [x0, z0] = worldXZ(10, 10);
  const [x1, z1] = worldXZ(11, 10);
  const p = pathPose(path, 0.5);
  assert.ok(Math.abs(p[0] - (x0 + x1) / 2) < 1e-9, 'halfway between the first two tiles');
  assert.ok(Math.abs(p[1] - (z0 + z1) / 2) < 1e-9);
});

test('pathPose reports the tile under the vehicle and turns the nose with the path', () => {
  const early = pathPose(path, 0.2);
  assert.deepEqual(early[3], [10, 10], 'still on the start tile');
  const late = pathPose(path, 0.8);
  assert.deepEqual(late[3], [11, 10], 'past the midpoint → next tile');
  const straight = pathPose(path, 0.5)[2];
  const corner = pathPose(path, 2.5)[2];
  assert.notEqual(straight, null);
  assert.notEqual(corner, null);
  assert.notEqual(straight, corner, 'heading changes at the corner');
});

test('pathPose extrapolates behind the start (wagons trailing off-path) and past the end', () => {
  const behind = pathPose(path, -0.5);
  const [sx] = worldXZ(10, 10);
  assert.ok(behind[0] < sx, 'behind the first tile along the first segment');
  const past = pathPose(path, path.length); // beyond the last index
  assert.ok(Number.isFinite(past[0]) && Number.isFinite(past[1]));
});

test('pathPose degrades gracefully on a single-tile path', () => {
  const p = pathPose([[5, 5]], 3);
  const [x, z] = worldXZ(5, 5);
  assert.deepEqual([p[0], p[1], p[2]], [x, z, null], 'pinned to the tile, no heading');
});
