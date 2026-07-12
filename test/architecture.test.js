// Architecture guards: the layering, file-budget and docs-stay-true rules
// from CLAUDE.md, enforced instead of remembered (ADR 33). Every assertion
// message says exactly what to fix — if one fails, do what it says rather
// than weakening the guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (name.endsWith('.js')) out.push(rel);
  }
  return out;
}
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
// drop comment-only lines so prose mentioning window/document can't false-positive
const codeOf = rel => read(rel).split('\n')
  .filter(l => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
  .join('\n');

const SRC = walk('src');
const SIM = SRC.filter(f => f.startsWith('src/sim/'));
const ARCH = read('docs/ARCHITECTURE.md');

// ---- layering ---------------------------------------------------------------

test('sim layer is headless: no three.js, no DOM, no browser timers', () => {
  const FORBIDDEN = [
    [/from ['"]three['"]/, "imports three.js — render concerns live in src/render/"],
    [/\bdocument\./, 'touches document — DOM belongs in src/ui/'],
    [/\bwindow\./, 'touches window — browser globals belong in main.js or src/ui/'],
    [/\baddEventListener\s*\(/, 'registers a browser event listener — do that in main.js/ui and call a sim function'],
    [/\bsetInterval\s*\(|\bsetTimeout\s*\(/, 'uses browser timers — the sim advances only through tickSim(gameHours)'],
    [/\brequestAnimationFrame\b/, 'uses rAF — the frame loop lives in main.js'],
  ];
  for (const f of SIM) {
    const code = codeOf(f);
    for (const [re, why] of FORBIDDEN) {
      assert.ok(!re.test(code), `${f} ${why}`);
    }
    if (f !== 'src/sim/save.js') {
      assert.ok(!/\blocalStorage\b/.test(code),
        `${f} uses localStorage — persistence goes through sim/save.js (which guards it for Node)`);
    }
  }
});

test('sim never imports from render/, ui/ or main.js', () => {
  for (const f of SIM) {
    assert.ok(!/from ['"]\.\.?\/(render|ui|main)/.test(codeOf(f)),
      `${f} imports a view layer — data flows down, events flow up (emit/on in state.js)`);
  }
});

// ---- file budgets (mega-file regrowth guard) --------------------------------

const LINE_BUDGET = 600; // hud.js hit 1073 and world.js 1460 before the ADR 32 split
test(`no source file grows past ${LINE_BUDGET} lines (data.js exempt — content is data)`, () => {
  for (const f of SRC) {
    if (f === 'src/sim/data.js') continue;
    const lines = read(f).split('\n').length;
    assert.ok(lines <= LINE_BUDGET,
      `${f} is ${lines} lines — split it into cohesive modules like ADR 32 did (transport→domains, world→terrain/scatter/…, hud→panels) and update the ARCHITECTURE.md diagram`);
  }
});

test('main.js stays a composition root', () => {
  const lines = read('src/main.js').split('\n').length;
  assert.ok(lines <= 150,
    `src/main.js is ${lines} lines — it only wires layers and runs the frame loop; sim logic goes in sim/tick.js, seeding in sim/newGame.js`);
});

// ---- docs stay true ----------------------------------------------------------

test('every source module is accounted for in docs/ARCHITECTURE.md', () => {
  for (const f of SRC) {
    if (f.startsWith('src/ui/hud/')) {
      assert.ok(ARCH.includes('ui/hud/'),
        'ARCHITECTURE.md no longer mentions ui/hud/ — restore it to the module map');
      continue;
    }
    assert.ok(ARCH.includes(basename(f)),
      `${f} is not mentioned in docs/ARCHITECTURE.md — add the new module to the overview diagram (and an ADR if it embodies a decision)`);
  }
});

test('every event on the bus is documented in the ARCHITECTURE.md event table', () => {
  const names = new Set();
  for (const f of SRC) {
    for (const m of codeOf(f).matchAll(/emit\('([a-zA-Z]+)'/g)) names.add(m[1]);
  }
  assert.ok(names.size >= 15, `sanity: found only ${names.size} emitted events — did the emit() scan break?`);
  for (const n of names) {
    assert.ok(ARCH.includes('`' + n + '`'),
      `event '${n}' is emitted but missing from the event table in docs/ARCHITECTURE.md — add a row (emitted by / consumed by)`);
  }
});

test('README test-count claim never overstates the suite', () => {
  const readme = read('README.md');
  const m = readme.match(/(\d+)\+ tests/);
  assert.ok(m, "README.md should describe the suite as 'N+ tests' (a floor, so it can't go stale)");
  const claimed = +m[1];
  const actual = walk('test').reduce((a, f) => a + (read(f).match(/^test\(/gm) || []).length, 0);
  assert.ok(actual >= claimed,
    `README claims ${claimed}+ tests but only ${actual} exist — the suite shrank; update the README (and ask why tests were deleted)`);
});
