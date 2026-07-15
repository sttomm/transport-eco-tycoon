// Runtime material textures for the glTF assets (graphics phase 2).
//
// The GLBs carry no images — every texture here is a small tileable canvas
// generated at load, attached to a loaded material by NAME (material names
// are stable load-time API, see tools/models/*.py). The Blender scripts
// box/cylinder-project UVs in world space (1 UV unit = 1 world unit,
// common.py box_uv/cyl_uv), so `period` below is simply "world units per
// texture tile" and texel density matches across parts of any size.
//
// Each generator takes the material's own base color and paints around it,
// then applyTexture() resets material.color to white — the palette (tuned
// against ACES/bloom, ADR 15/16) stays exactly as authored, the texture only
// adds the pattern. Mean brightness of every texture ≈ the base color.
import * as THREE from 'three';

// ---------- canvas & color helpers ----------
function makeCanvas(S) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  return cv;
}

function toTex(cv, srgb = true) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const clamp01 = v => Math.max(0, Math.min(1, v));
const _c = new THREE.Color(), _hsl = { h: 0, s: 0, l: 0 };

// base hex shifted in HSL (dl lightness, ds saturation, dh hue), as css.
// All HSL math happens in sRGB space — the working space is linear, where
// dark colors have tiny lightness values and small offsets would blow the
// albedo far past the authored palette (bloom/ACES tuning, ADR 15/16).
const SRGB = THREE.SRGBColorSpace;
function tone(hex, dl = 0, ds = 0, dh = 0) {
  _c.set(hex).getHSL(_hsl, SRGB);
  _c.setHSL((_hsl.h + dh + 1) % 1, clamp01(_hsl.s + ds), clamp01(_hsl.l + dl), SRGB);
  return _c.getStyle(SRGB);
}

const _rgb = { r: 0, g: 0, b: 0 };
function toneA(hex, dl, a) {
  _c.set(hex).getHSL(_hsl, SRGB);
  _c.setHSL(_hsl.h, _hsl.s, clamp01(_hsl.l + dl), SRGB);
  _c.getRGB(_rgb, SRGB);
  return `rgba(${_rgb.r * 255 | 0},${_rgb.g * 255 | 0},${_rgb.b * 255 | 0},${a})`;
}

const gray = (v, a = 1) => `rgba(${v},${v},${v},${a})`;

// paired color + bump canvases so every generator can draw into both
function pair(S = 128) {
  const cv = makeCanvas(S), bv = makeCanvas(S);
  const cx = cv.getContext('2d'), bx = bv.getContext('2d');
  bx.fillStyle = gray(128);
  bx.fillRect(0, 0, S, S);
  return { S, cv, bv, cx, bx, done: () => ({ map: toTex(cv), bump: toTex(bv, false) }) };
}

function speckle(cx, S, n, color, sz = 2) {
  for (let k = 0; k < n; k++) {
    cx.fillStyle = color();
    cx.fillRect(Math.random() * S, Math.random() * S, sz, sz);
  }
}

// ---------- generators (each: baseHex -> {map, bump}) ----------

// running-bond brickwork: 10 courses per tile, mortar derived from the base
function brick(hex) {
  const p = pair(), { S, cx, bx } = p;
  const rows = 10, bh = S / rows, bw = S / 4;
  cx.fillStyle = tone(hex, 0.16, -0.25); // mortar
  cx.fillRect(0, 0, S, S);
  bx.fillStyle = gray(40);               // mortar recessed
  bx.fillRect(0, 0, S, S);
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? -bw / 2 : 0;
    for (let x = off; x < S; x += bw) {
      const dark = Math.random() < 0.12 ? -0.09 : 0;
      cx.fillStyle = tone(hex, dark + (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.012);
      cx.fillRect(x + 1, r * bh + 1, bw - 2, bh - 2);
      bx.fillStyle = gray(120 + Math.random() * 60 | 0);
      bx.fillRect(x + 1, r * bh + 1, bw - 2, bh - 2);
    }
  }
  speckle(cx, S, 350, () => toneA(hex, (Math.random() - 0.5) * 0.3, 0.12), 1.5);
  return p.done();
}

// stucco/plaster: grain + soft weathering blotches
function stucco(hex) {
  const p = pair(), { S, cx, bx } = p;
  cx.fillStyle = tone(hex);
  cx.fillRect(0, 0, S, S);
  speckle(cx, S, 1400, () => toneA(hex, (Math.random() - 0.5) * 0.16, 0.25), 1.5);
  speckle(bx, S, 1400, () => gray(100 + Math.random() * 56 | 0, 0.5), 1.5);
  for (let k = 0; k < 6; k++) { // large soft stains
    const x = Math.random() * S, y = Math.random() * S, r = 15 + Math.random() * 30;
    const g = cx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, toneA(hex, -0.06, 0.10));
    g.addColorStop(1, toneA(hex, -0.06, 0));
    cx.fillStyle = g;
    cx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return p.done();
}

// vertical boards with grain streaks, gaps and the odd knot
function planks(hex) {
  const p = pair(), { S, cx, bx } = p;
  const n = 6, bw = S / n;
  for (let b = 0; b < n; b++) {
    cx.fillStyle = tone(hex, (Math.random() - 0.5) * 0.09, (Math.random() - 0.5) * 0.08);
    cx.fillRect(b * bw, 0, bw, S);
    for (let k = 0; k < 9; k++) { // grain streaks along the board
      cx.fillStyle = toneA(hex, (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.08), 0.35);
      cx.fillRect(b * bw + 1 + Math.random() * (bw - 2), 0, 1, S);
    }
    cx.fillStyle = toneA(hex, -0.16, 0.9); // gap shadow
    cx.fillRect(b * bw, 0, 1.5, S);
    bx.fillStyle = gray(15);
    bx.fillRect(b * bw, 0, 1.5, S);
  }
  for (let k = 0; k < 3; k++) { // knots
    cx.fillStyle = toneA(hex, -0.13, 0.8);
    cx.beginPath();
    cx.ellipse(Math.random() * S, Math.random() * S, 2.2, 3.2, 0, 0, Math.PI * 2);
    cx.fill();
  }
  return p.done();
}

// corrugated sheet: vertical sinusoidal ridges + panel seams
function corrugated(hex, depth = 0.30) {
  const p = pair(), { S, cx, bx } = p;
  const period = 16;
  for (let x = 0; x < S; x++) {
    const w = 0.5 + 0.5 * Math.cos((x % period) / period * Math.PI * 2);
    cx.fillStyle = tone(hex, (w - 0.5) * depth);
    cx.fillRect(x, 0, 1, S);
    bx.fillStyle = gray(128 + (w - 0.5) * 220 * depth | 0);
    bx.fillRect(x, 0, 1, S);
  }
  cx.fillStyle = toneA(hex, -0.10, 0.5); // horizontal panel seams
  cx.fillRect(0, 0, S, 2);
  cx.fillRect(0, S / 2, S, 2);
  speckle(cx, S, 200, () => toneA(hex, (Math.random() - 0.5) * 0.12, 0.2), 2);
  return p.done();
}

// corrugated + rust streaks bleeding down from seams
function rustyCorr(hex) {
  const p0 = corrugated(hex, 0.30);
  const cv = p0.map.image, cx = cv.getContext('2d'), S = cv.width;
  for (let k = 0; k < 26; k++) {
    const x = Math.random() * S, y0 = Math.random() * S * 0.6, len = 15 + Math.random() * 60;
    const g = cx.createLinearGradient(0, y0, 0, y0 + len);
    const rust = `rgba(122,62,30,${0.10 + Math.random() * 0.22})`;
    g.addColorStop(0, rust);
    g.addColorStop(1, 'rgba(122,62,30,0)');
    cx.fillStyle = g;
    cx.fillRect(x, y0, 1.5 + Math.random() * 3.5, len);
  }
  p0.map.needsUpdate = true;
  return p0;
}

// pre-weathered concrete: grain, panel joints, run-off stains
function concrete(hex) {
  const p = pair(), { S, cx, bx } = p;
  cx.fillStyle = tone(hex);
  cx.fillRect(0, 0, S, S);
  speckle(cx, S, 1100, () => toneA(hex, (Math.random() - 0.5) * 0.12, 0.3), 2);
  speckle(bx, S, 900, () => gray(105 + Math.random() * 46 | 0, 0.5), 2);
  cx.strokeStyle = toneA(hex, -0.12, 0.55); // formwork joints
  cx.lineWidth = 1.5;
  for (const t of [0, S / 2]) { cx.strokeRect(-2, t, S + 4, S / 2); cx.strokeRect(t, -2, S / 2, S + 4); }
  for (let k = 0; k < 5; k++) { // vertical weather streaks
    const x = Math.random() * S, len = 20 + Math.random() * 70;
    const g = cx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, toneA(hex, -0.08, 0.18));
    g.addColorStop(1, toneA(hex, -0.08, 0));
    cx.fillStyle = g;
    cx.fillRect(x, 0, 2 + Math.random() * 4, len);
  }
  return p.done();
}

// clean painted panels: faint brushing, seam grid, rivet dots
function metalPanel(hex) {
  const p = pair(), { S, cx, bx } = p;
  cx.fillStyle = tone(hex);
  cx.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 2) { // vertical brushing
    cx.fillStyle = toneA(hex, (Math.random() - 0.5) * 0.05, 0.5);
    cx.fillRect(x, 0, 1, S);
  }
  cx.fillStyle = toneA(hex, -0.09, 0.6);
  const seam = S / 3;
  for (let t = 0; t < S; t += seam) { cx.fillRect(t, 0, 1.5, S); cx.fillRect(0, t, S, 1.5); }
  bx.fillStyle = gray(80);
  for (let t = 0; t < S; t += seam) { bx.fillRect(t, 0, 1.5, S); bx.fillRect(0, t, S, 1.5); }
  cx.fillStyle = toneA(hex, -0.13, 0.8); // rivets along seams
  for (let t = 0; t < S; t += seam) {
    for (let s = 5; s < S; s += 11) { cx.fillRect(t + 3.5, s, 1.5, 1.5); cx.fillRect(s, t + 3.5, 1.5, 1.5); }
  }
  return p.done();
}

// photovoltaic module: dark cell grid, silver frame lines, thin busbars.
// Stays matte-dark on purpose — "solar at night/under cloud is weak" must
// stay readable and PV must never bloom (ADR 15).
function solar(hex) {
  const p = pair(), { S, cx } = p;
  cx.fillStyle = tone(hex, -0.03);
  cx.fillRect(0, 0, S, S);
  const n = 8, c = S / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    cx.fillStyle = tone(hex, 0.01 + Math.random() * 0.03, 0.1, (Math.random() - 0.5) * 0.02);
    cx.fillRect(i * c + 1, j * c + 1, c - 2, c - 2);
    cx.fillStyle = toneA(hex, 0.18, 0.35); // busbars
    cx.fillRect(i * c + c / 3, j * c + 1, 1, c - 2);
    cx.fillRect(i * c + 2 * c / 3, j * c + 1, 1, c - 2);
  }
  cx.strokeStyle = gray(120, 0.6); // cell grid
  cx.lineWidth = 1;
  for (let t = 0; t <= n; t++) {
    cx.strokeRect(t * c, -2, 0.5, S + 4);
    cx.strokeRect(-2, t * c, S + 4, 0.5);
  }
  return p.done();
}

// offset shingle courses with shadowed lower edges
function shingles(hex) {
  const p = pair(), { S, cx, bx } = p;
  const rows = 8, rh = S / rows, sw = S / 4;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? -sw / 2 : 0;
    for (let x = off; x < S; x += sw) {
      cx.fillStyle = tone(hex, (Math.random() - 0.5) * 0.10, (Math.random() - 0.5) * 0.06);
      cx.fillRect(x, r * rh, sw - 1, rh);
      bx.fillStyle = gray(110 + Math.random() * 50 | 0);
      bx.fillRect(x, r * rh, sw - 1, rh);
    }
    cx.fillStyle = toneA(hex, -0.14, 0.85); // course shadow
    cx.fillRect(0, (r + 1) * rh - 2, S, 2);
    bx.fillStyle = gray(20);
    bx.fillRect(0, (r + 1) * rh - 2, S, 2);
  }
  return p.done();
}

// big paving slabs with joints (station platforms & pads)
function pave(hex) {
  const p = pair(), { S, cx, bx } = p;
  const n = 4, c = S / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    cx.fillStyle = tone(hex, (Math.random() - 0.5) * 0.07);
    cx.fillRect(i * c, j * c, c, c);
  }
  speckle(cx, S, 700, () => toneA(hex, (Math.random() - 0.5) * 0.14, 0.3), 1.5);
  cx.fillStyle = toneA(hex, -0.13, 0.7);
  bx.fillStyle = gray(40);
  for (let t = 0; t <= n; t++) {
    cx.fillRect(t * c - 0.5, 0, 1.5, S); cx.fillRect(0, t * c - 0.5, S, 1.5);
    bx.fillRect(t * c - 0.5, 0, 1.5, S); bx.fillRect(0, t * c - 0.5, S, 1.5);
  }
  return p.done();
}

// asphalt: dense aggregate speckle + hairline cracks
function asphalt(hex) {
  const p = pair(), { S, cx, bx } = p;
  cx.fillStyle = tone(hex);
  cx.fillRect(0, 0, S, S);
  speckle(cx, S, 2000, () => toneA(hex, (Math.random() - 0.4) * 0.14, 0.4), 1.5);
  speckle(bx, S, 1200, () => gray(100 + Math.random() * 56 | 0, 0.6), 1.5);
  cx.strokeStyle = toneA(hex, -0.10, 0.5);
  cx.lineWidth = 1;
  for (let k = 0; k < 3; k++) { // cracks
    let x = Math.random() * S, y = Math.random() * S;
    cx.beginPath();
    cx.moveTo(x, y);
    for (let s = 0; s < 5; s++) { x += (Math.random() - 0.5) * 26; y += Math.random() * 16; cx.lineTo(x, y); }
    cx.stroke();
  }
  return p.done();
}

// loose rock/ore/gravel heaps
function gravel(hex) {
  const p = pair(), { S, cx, bx } = p;
  cx.fillStyle = tone(hex, -0.06);
  cx.fillRect(0, 0, S, S);
  for (let k = 0; k < 420; k++) {
    const x = Math.random() * S, y = Math.random() * S, r = 1.5 + Math.random() * 3.5;
    cx.fillStyle = tone(hex, (Math.random() - 0.45) * 0.22, (Math.random() - 0.5) * 0.1);
    bx.fillStyle = gray(90 + Math.random() * 90 | 0);
    for (const c of [cx, bx]) {
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  }
  return p.done();
}

// ploughed soil: furrow rows + clods
function soil(hex) {
  const p = pair(), { S, cx, bx } = p;
  cx.fillStyle = tone(hex);
  cx.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 10) {
    cx.fillStyle = toneA(hex, -0.09, 0.7);
    cx.fillRect(0, y + Math.sin(y) * 2, S, 3);
    bx.fillStyle = gray(80);
    bx.fillRect(0, y + Math.sin(y) * 2, S, 3);
  }
  speckle(cx, S, 900, () => toneA(hex, (Math.random() - 0.5) * 0.16, 0.4), 2);
  return p.done();
}

// crop rows: dense vertical stalk strokes
function crop(hex) {
  const p = pair(), { S, cx } = p;
  cx.fillStyle = tone(hex, -0.04);
  cx.fillRect(0, 0, S, S);
  for (let k = 0; k < 1500; k++) {
    cx.fillStyle = toneA(hex, (Math.random() - 0.4) * 0.2, 0.5);
    cx.fillRect(Math.random() * S, Math.random() * S, 1, 3 + Math.random() * 4);
  }
  return p.done();
}

// automotive paint: smooth base + fine metallic flake + a faint clear-coat
// micro-speckle. Stays matte (small lightness spread, near-flat bump) so
// painted bodies keep their authored albedo and never bloom in full sun.
function vehiclePaint(hex) {
  const p = pair(64), { S, cx, bx } = p;
  cx.fillStyle = tone(hex);
  cx.fillRect(0, 0, S, S);
  // metallic flake: dense sub-pixel sparkle, half lighter / half darker
  for (let k = 0; k < 900; k++) {
    const up = Math.random() < 0.5;
    cx.fillStyle = toneA(hex, (up ? 1 : -1) * (0.03 + Math.random() * 0.06), 0.18);
    cx.fillRect(Math.random() * S, Math.random() * S, 1, 1);
  }
  // faint horizontal body crease + a soft top sheen band
  cx.fillStyle = toneA(hex, -0.05, 0.4);
  cx.fillRect(0, S * 0.62, S, 1);
  const g = cx.createLinearGradient(0, 0, 0, S * 0.5);
  g.addColorStop(0, toneA(hex, 0.05, 0.10));
  g.addColorStop(1, toneA(hex, 0.05, 0));
  cx.fillStyle = g;
  cx.fillRect(0, 0, S, S * 0.5);
  bx.fillStyle = gray(128); bx.fillRect(0, 0, S, S); // effectively flat
  return p.done();
}

// tyre rubber: circumferential grooves + angled tread lugs, raised in bump
function tyre(hex) {
  const p = pair(64), { S, cx, bx } = p;
  cx.fillStyle = tone(hex);
  cx.fillRect(0, 0, S, S);
  bx.fillStyle = gray(90); bx.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 6) {          // tread lugs across the tread
    const on = (x / 6) % 2 === 0;
    cx.fillStyle = toneA(hex, on ? 0.06 : -0.05, 0.6);
    cx.fillRect(x, 0, 4, S);
    bx.fillStyle = gray(on ? 175 : 70);
    bx.fillRect(x, 0, 4, S);
  }
  for (const y of [S * 0.28, S * 0.72]) {   // two circumferential grooves
    cx.fillStyle = toneA(hex, -0.1, 0.8);
    cx.fillRect(0, y, S, 3);
    bx.fillStyle = gray(30);
    bx.fillRect(0, y, S, 3);
  }
  return p.done();
}

// near-white multiplicative grain — detail for vertex-colored facade parts
export function grainTexture(period = 1.6) {
  const S = 128, cv = makeCanvas(S), cx = cv.getContext('2d');
  cx.fillStyle = '#fff';
  cx.fillRect(0, 0, S, S);
  speckle(cx, S, 2200, () => gray(190 + Math.random() * 65 | 0, 0.35), 1.5);
  const t = toTex(cv);
  t.repeat.set(1 / period, 1 / period);
  return t;
}

// colored generators for the instanced building set (assets.js merges those
// meshes and discards their materials, so it asks for textures directly)
export const facadeTexture = { brick, stucco };

// ---------- material name -> [generator, period (world units/tile), bumpScale] ----------
const SPECS = {
  // power & storage buildings
  plant_panel: [solar, 1.15, 0],
  plant_concrete: [concrete, 2.6, 0.12],
  plant_concrete_dark: [concrete, 2.6, 0.12],
  plant_container: [metalPanel, 1.5, 0.06],
  plant_cabinet: [metalPanel, 1.2, 0.06],
  plant_roof: [metalPanel, 0.9, 0.08],
  plant_teal: [metalPanel, 1.3, 0.06],
  // industries
  ind_rust: [rustyCorr, 1.3, 0.35],
  ind_corr: [corrugated, 1.0, 0.35],
  ind_corr_dark: [corrugated, 1.0, 0.35],
  ind_dark_roof: [corrugated, 1.0, 0.3],
  ind_timber: [planks, 0.8, 0.2],
  ind_planks: [planks, 1.3, 0.25],
  ind_barn_roof: [shingles, 1.3, 0.25],
  ind_barn_door: [planks, 0.9, 0.2],
  ind_ore: [gravel, 1.6, 0.4],
  ind_concrete: [concrete, 2.6, 0.12],
  ind_chimney: [concrete, 2.0, 0.08],
  ind_soil: [soil, 2.2, 0.25],
  ind_crop: [crop, 1.4, 0],
  ind_panel: [metalPanel, 1.6, 0.06],
  ind_silo: [c => corrugated(c, 0.12), 0.8, 0.15],
  ind_stainless: [metalPanel, 1.2, 0.05],
  // legacy gas plant (WP8)
  gas_corrugated: [corrugated, 1.0, 0.35],
  gas_rib: [metalPanel, 0.8, 0.06],
  gas_roof: [corrugated, 1.0, 0.3],
  gas_steel: [metalPanel, 1.2, 0.06],
  gas_stack: [c => corrugated(c, 0.15), 0.8, 0.15],
  gas_tank: [metalPanel, 1.3, 0.05],
  gas_dark_steel: [metalPanel, 1.0, 0.06],
  gas_yard_steel: [metalPanel, 1.0, 0.08],
  gas_control_wall: [concrete, 2.0, 0.10],
  // stations
  sta_brick_red: [brick, 1.6, 0.3],
  sta_pave: [pave, 2.0, 0.15],
  sta_platform: [pave, 2.0, 0.15],
  sta_asphalt: [asphalt, 2.4, 0.12],
  sta_roof: [shingles, 1.2, 0.25],
  sta_depot_orange: [corrugated, 1.0, 0.3],
  sta_shelter: [metalPanel, 1.2, 0.05],
  sta_canopy: [metalPanel, 1.2, 0.05],
  // vehicles: painted bodies get a subtle metallic-flake paint, tyres a
  // tread, cargo surfaces keep their coarse relief
  veh_bus_blue: [vehiclePaint, 0.6, 0],
  veh_truck_green: [vehiclePaint, 0.6, 0],
  veh_train_red: [vehiclePaint, 0.6, 0],
  veh_wagon_blue: [vehiclePaint, 0.6, 0],
  veh_tire: [tyre, 0.32, 0.12],
  veh_box_white: [c => corrugated(c, 0.10), 0.55, 0.1],
  veh_wagon_brown: [planks, 0.7, 0.15],
  veh_load: [gravel, 0.9, 0.3],
};

// Attach the canvas texture matching this material's name (idempotent, safe
// to call for every mesh — materials are shared per glTF file). The base
// color moves into the texture; material.color becomes white so lighting
// and instance tints keep working unchanged.
export function applyTexture(mat) {
  if (!mat || mat.userData.textured) return;
  const spec = SPECS[mat.name];
  if (!spec) return;
  mat.userData.textured = true;
  const [gen, period, bumpScale] = spec;
  const { map, bump } = gen('#' + mat.color.getHexString());
  const rep = 1 / period;
  map.repeat.set(rep, rep);
  mat.map = map;
  if (bumpScale) {
    bump.repeat.set(rep, rep);
    mat.bumpMap = bump;
    mat.bumpScale = bumpScale;
  }
  mat.color.set('#ffffff');
  mat.needsUpdate = true;
}
