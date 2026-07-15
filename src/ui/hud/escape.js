// Escape-layer priority (WP6): one Escape (or a right-click cancel) peels
// exactly ONE layer, in a fixed order. Kept as a pure, dependency-free
// function — no DOM, no G import — so the priority order itself is
// unit-testable without a browser (see test/escape.test.js); hud.js and
// input.js only translate the returned layer into the actual side effect
// (closeTopModal() / selectTool(null) / G.selected = null / toggleDemand()).
export function pickEscapeLayer({ modalOpen, tool, routeEdit, selected, showDemand }) {
  if (modalOpen) return 'modal';
  if (tool || routeEdit) return 'tool';
  if (selected) return 'selection';
  if (showDemand) return 'demand';
  return null;
}
