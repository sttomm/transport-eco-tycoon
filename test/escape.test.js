// WP6: layered Escape / right-click-cancel priority. The DOM wiring (Escape
// keydown in ui/hud.js, the right-click pointerdown/up gesture in
// ui/input.js) is UI-only and verified in-browser, but the actual decision —
// "given the current state, which ONE layer comes next" — is a pure function
// (src/ui/hud/escape.js) with no DOM/G dependency, so the priority order
// itself is pinned here without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickEscapeLayer } from '../src/ui/hud/escape.js';

const none = { modalOpen: false, tool: null, routeEdit: null, selected: null, showDemand: false };

test('escape: modal beats every other layer', () => {
  assert.equal(pickEscapeLayer({ ...none, modalOpen: true, tool: 'solar', selected: {}, showDemand: true }), 'modal');
});

test('escape: an active tool beats selection and the demand overlay', () => {
  assert.equal(pickEscapeLayer({ ...none, tool: 'busStop', selected: {}, showDemand: true }), 'tool');
});

test('escape: route-edit counts as the tool layer even with G.tool null', () => {
  assert.equal(pickEscapeLayer({ ...none, routeEdit: { id: 1 }, selected: {}, showDemand: true }), 'tool');
});

test('escape: selection beats the demand overlay once no tool/route-edit is active', () => {
  assert.equal(pickEscapeLayer({ ...none, selected: { kind: 'station' }, showDemand: true }), 'selection');
});

test('escape: demand overlay is the last layer', () => {
  assert.equal(pickEscapeLayer({ ...none, showDemand: true }), 'demand');
});

test('escape: nothing open returns null (Escape is a no-op)', () => {
  assert.equal(pickEscapeLayer(none), null);
});

test('right-click cancel reuses the same function with modal/demand excluded — tool still wins over selection', () => {
  // input.js calls pickEscapeLayer({ modalOpen: false, ..., showDemand: false })
  assert.equal(pickEscapeLayer({ modalOpen: false, tool: 'road', routeEdit: null, selected: { kind: 'city' }, showDemand: false }), 'tool');
});

test('right-click cancel: no tool/route-edit falls through to clearing the selection', () => {
  assert.equal(pickEscapeLayer({ modalOpen: false, tool: null, routeEdit: null, selected: { kind: 'city' }, showDemand: false }), 'selection');
});

test('right-click cancel: nothing selected and no tool is a no-op', () => {
  assert.equal(pickEscapeLayer({ modalOpen: false, tool: null, routeEdit: null, selected: null, showDemand: false }), null);
});
