// Mesh & texture library: low-poly buildings, industries, vehicles, wagons
// and the procedural canvas textures they use. Pure "asset" code — no game
// logic, no scene management (that's src/render/world.js / vehicles.js).
import * as THREE from 'three';
import { modelInstance } from './assets.js';

// ---------- material / primitive helpers ----------
export const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o });
export const Mtex = (tex, o = {}) => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, ...o });

export function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
export function cyl(r, h, mat, x = 0, y = 0, z = 0, rt) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt ?? r, r, h, 16), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
// gabled roof: stretched 4-sided cone reads as a ridge roof from game distance
export function gableRoof(w, h, d, mat, x, y, z) {
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.71, h, 4), mat);
  roof.scale.set(w, 1, d);
  roof.position.set(x, y + h / 2, z);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  return roof;
}

// Instanced meshes get their bounding sphere from the (origin-centered, tiny)
// geometry, so three.js frustum-culls them as soon as the map center leaves the
// view — instances vanish while their shadows (different camera) survive.
// Disable culling for every world-spanning instanced mesh.
export const noCull = m => { m.frustumCulled = false; return m; };

// ---------- procedural canvas textures ----------
export function canvasTex(px, draw) {
  const cv = document.createElement('canvas'); cv.width = cv.height = px;
  draw(cv.getContext('2d'), px);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// tiled stripe texture — corrugated metal walls, wood planks, etc.
export function makeStripeTexture(c1, c2, stripes = 16, vertical = true) {
  const t = canvasTex(64, (cx, S) => {
    cx.fillStyle = c1; cx.fillRect(0, 0, S, S);
    cx.fillStyle = c2;
    const w = S / stripes;
    for (let k = 0; k < stripes; k += 2) {
      if (vertical) cx.fillRect(k * w, 0, w, S);
      else cx.fillRect(0, k * w, S, w);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// photovoltaic module: dark cells, busbars, aluminium frame
export function makeSolarTexture() {
  return canvasTex(128, (cx, S) => {
    cx.fillStyle = '#0c1626'; cx.fillRect(0, 0, S, S);
    const n = 6, c = S / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const g = cx.createLinearGradient(x * c, y * c, (x + 1) * c, (y + 1) * c);
      g.addColorStop(0, '#17335f'); g.addColorStop(0.55, '#0e2348'); g.addColorStop(1, '#1d3f72');
      cx.fillStyle = g;
      cx.fillRect(x * c + 2, y * c + 2, c - 4, c - 4);
      cx.strokeStyle = 'rgba(200,215,235,0.3)'; cx.lineWidth = 1;
      cx.beginPath(); cx.moveTo(x * c + c / 2, y * c + 3); cx.lineTo(x * c + c / 2, y * c + c - 3); cx.stroke();
    }
    cx.strokeStyle = '#c3cad2'; cx.lineWidth = 4; cx.strokeRect(0, 0, S, S);
  });
}

// poured concrete: speckle + formwork panel lines
export function makeConcreteTexture() {
  return canvasTex(64, (cx, S) => {
    cx.fillStyle = '#9aa1a6'; cx.fillRect(0, 0, S, S);
    for (let k = 0; k < 500; k++) {
      cx.fillStyle = `rgba(60,64,68,${Math.random() * 0.12})`;
      cx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
    cx.strokeStyle = 'rgba(50,55,60,0.35)'; cx.lineWidth = 1.5;
    for (const y of [S / 3, 2 * S / 3]) { cx.beginPath(); cx.moveTo(0, y); cx.lineTo(S, y); cx.stroke(); }
  });
}

// painted wooden planks (barn walls)
export function makePlankTexture(base = '#a8392c', dark = '#7e2a20') {
  return canvasTex(64, (cx, S) => {
    cx.fillStyle = base; cx.fillRect(0, 0, S, S);
    const w = S / 8;
    for (let k = 0; k < 8; k++) {
      cx.fillStyle = `rgba(0,0,0,${0.12 + Math.random() * 0.1})`;
      cx.fillRect(k * w, 0, 1.5, S);
      cx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      cx.fillRect(k * w + 2, 0, w - 3, S);
    }
    cx.fillStyle = dark;
    for (let k = 0; k < 60; k++) cx.fillRect(Math.random() * S, Math.random() * S, 2, 4);
  });
}

// ploughed field with crop rows
export function makeCropTexture() {
  return canvasTex(64, (cx, S) => {
    cx.fillStyle = '#8a6f42'; cx.fillRect(0, 0, S, S);
    for (let y = 2; y < S; y += 6) {
      cx.fillStyle = '#c9b34a';
      cx.fillRect(0, y, S, 3);
      cx.fillStyle = 'rgba(90,120,40,0.55)';
      cx.fillRect(0, y, S, 1.5);
    }
  });
}

// railway gravel
export function makeBallastTexture() {
  return canvasTex(64, (cx, S) => {
    cx.fillStyle = '#6e6a62'; cx.fillRect(0, 0, S, S);
    for (let k = 0; k < 700; k++) {
      const v = 85 + Math.random() * 60 | 0;
      cx.fillStyle = `rgba(${v},${v - 4},${v - 10},0.6)`;
      cx.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
    }
  });
}

// ---------- floating text sprites (labels, +€ FX, demand overlay) ----------
// Dedicated camera layer for these billboards. THREE.Sprite ignores
// scene.overrideMaterial (it always draws with its own program), so
// GTAOPass's normal/depth pre-pass — which only hides Points/Line objects,
// not Sprites — paints each sprite's own color texture straight into its
// AO input buffer and reads it back as bogus geometry: a camera-angle-
// dependent dark smudge hovering over every label (most visible on city
// names, since those are the only always-on sprites). Fix: put every
// makeTextSprite() sprite on UI_SPRITE_LAYER; postfx.js gives GTAOPass a
// camera that can't see that layer, so it never touches these at all. The
// main camera (scene.js) and labels.js's click-raycast both re-enable the
// layer so the sprites stay visible/clickable exactly as before.
export const UI_SPRITE_LAYER = 1;

export function makeTextSprite(lines, { color = '#ffffff', size = 2.4, bg = 'rgba(8,14,22,0.74)' } = {}) {
  if (!Array.isArray(lines)) lines = [lines];
  const font = '600 30px "Segoe UI", system-ui, sans-serif';
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = font;
  const w = Math.ceil(Math.max(...lines.map(l => meas.measureText(l.text ?? l).width)) + 30);
  const lh = 38, h = lines.length * lh + 16;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  if (bg) {
    cx.fillStyle = bg;
    cx.beginPath(); cx.roundRect(0, 0, w, h, 12); cx.fill();
  }
  cx.font = font; cx.textAlign = 'center'; cx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    cx.fillStyle = l.color || color;
    cx.fillText(l.text ?? l, w / 2, 8 + lh * i + lh / 2);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  const sH = lines.length * size + 0.4;
  sp.scale.set(sH * w / h, sH, 1);
  sp.renderOrder = 50;
  sp.layers.set(UI_SPRITE_LAYER); // keep off GTAOPass's g-buffer camera (see comment above)
  return sp;
}

// ---------- player buildings (plants & stations) ----------
// Returns a group with origin at ground center. Wind turbines expose their
// spinning part as group.userData.rotor.
export function buildPlantMesh(type) {
  // migrated types come from the glTF library; the procedural code below is
  // the fallback (and the source of truth for un-migrated types)
  const gltf = modelInstance(type);
  if (gltf) return gltf;
  const g = new THREE.Group();
  if (type === 'solar') {
    // three long panel tables on steel piles, PV-cell texture, repeated along the row
    const tex = makeSolarTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 1);
    const panelMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.22, metalness: 0.45 });
    const steel = M('#8b8f94', { metalness: 0.6, roughness: 0.4 });
    for (let r = 0; r < 3; r++) {
      const z = (r - 1) * 3.6;
      const table = new THREE.Group();
      const p = box(10.4, 0.12, 2.2, panelMat, 0, 1.05, 0);
      p.rotation.x = -0.45;
      table.add(p);
      for (const x of [-4.4, -1.5, 1.5, 4.4]) table.add(cyl(0.09, 1.0, steel, x, 0, 0));
      table.position.z = z;
      g.add(table);
    }
    g.add(box(1.3, 1.1, 0.9, M('#dfe3e7'), 4.6, 0, 5.0));   // inverter cabinet
    g.add(box(1.2, 0.12, 0.8, M('#9aa2a8'), 4.6, 1.1, 5.0));
  } else if (type === 'wind') {
    const towerMat = M('#e8eaec', { roughness: 0.55, metalness: 0.1 }); // matte paint — glossier whites spike past the bloom threshold in full sun
    g.add(cyl(0.55, 14, towerMat, 0, 0, 0, 0.3));
    g.add(cyl(0.6, 0.25, M('#c9cdd1'), 0, 0, 0));                                  // base flange
    const nac = box(1.7, 0.95, 0.95, M('#dfe2e5', { metalness: 0.25 }), 0, 13.55, 0); g.add(nac);
    // rotor hub sits in front of the nacelle (+x); blades sweep the y/z plane
    // and spin around the x axis — clear of the tower
    const rotor = new THREE.Group(); rotor.position.set(1.1, 14.0, 0);
    const hub = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.8, 10), M('#d2d6da'));
    hub.rotation.z = -Math.PI / 2; hub.position.x = 0.25; hub.castShadow = true;
    rotor.add(hub);
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 6.0, 0.55), M('#f2f4f6', { roughness: 0.55 }));
      blade.geometry.translate(0, 3.2, 0);
      blade.rotation.x = b * Math.PI * 2 / 3;
      blade.castShadow = true;
      rotor.add(blade);
    }
    g.add(rotor);
    g.userData.rotor = rotor;
  } else if (type === 'hydro') {
    const conc = Mtex(makeConcreteTexture(), { roughness: 0.9 });
    g.add(box(5, 3.2, 4, conc));                                       // powerhouse
    g.add(gableRoof(5.4, 1.0, 4.4, M('#5d6a73'), 0, 3.2, 0));
    g.add(box(5.6, 1, 1.4, conc, 0, 0, 2.6));                          // weir
    g.add(box(5.6, 0.25, 0.5, M('#46708e', { metalness: 0.4 }), 0, 1.0, 2.6));
    for (const x of [-1.6, 0, 1.6]) g.add(box(0.5, 1.6, 0.2, M('#3a4754', { metalness: 0.5 }), x, 0.4, 2.05)); // intake gates
    g.add(cyl(0.5, 4.4, M('#9fa8af', { metalness: 0.4 }), 1.6, 0, -1));
  } else if (type === 'battery') {
    const cont = Mtex(makeStripeTexture('#e9edf0', '#d6dce2', 14), { metalness: 0.35, roughness: 0.5 });
    for (let k = 0; k < 4; k++) {
      g.add(box(3.4, 1.5, 1.2, cont, 0, 0, (k - 1.5) * 1.7));
      g.add(box(0.5, 0.9, 0.08, M('#3a7d4f'), -1.2, 0.3, (k - 1.5) * 1.7 + 0.65)); // hv warning panel
    }
    g.add(box(1.2, 1.8, 1.2, M('#3a4754', { metalness: 0.4 }), 2.6, 0, 0));        // transformer
  } else if (type === 'electrolyzer') {
    for (let k = 0; k < 3; k++) g.add(cyl(0.8, 2.8, M('#3fae9c', { metalness: 0.4, roughness: 0.35 }), (k - 1) * 2.1, 0, 0));
    g.add(box(4.5, 0.25, 0.25, M('#c2c8cd'), 0, 2.6, 0));
    g.add(box(2.4, 1.6, 1.8, M('#dde2e6'), 0, 0, 2.2));
  } else if (type === 'h2tank') {
    const sph = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 18), M('#f1f3f5', { metalness: 0.45, roughness: 0.3 }));
    sph.position.y = 3.1; sph.castShadow = true; g.add(sph);
    for (let k = 0; k < 4; k++) g.add(cyl(0.16, 1.6, M('#9aa1a7'), Math.cos(k * 1.57) * 1.7, 0, Math.sin(k * 1.57) * 1.7));
  } else if (type === 'fuelcell') {
    g.add(box(4.4, 2.6, 3.2, M('#aab6c2', { metalness: 0.35 })));
    for (let k = 0; k < 5; k++) g.add(box(0.18, 2.0, 2.8, M('#7c8896'), -1.8 + k * 0.9, 2.62, 0));
  } else if (type === 'gas') {
    // the inherited fossil plant: corrugated turbine hall, gas skid, banded
    // smokestack — deliberately grubby next to the clean renewables
    const corr = Mtex(makeStripeTexture('#7c7468', '#6a6357', 24), { roughness: 0.75, metalness: 0.3 });
    g.add(box(5.4, 3.0, 3.8, corr, -0.6, 0, 0.4));                       // turbine hall
    g.add(gableRoof(5.8, 1.0, 4.2, M('#4e4a42'), -0.6, 3.0, 0.4));
    g.add(box(2.2, 1.6, 1.8, M('#9aa1a7', { metalness: 0.4 }), -1.0, 0, 3.0)); // gas pressure skid
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.6, 14), M('#c8ccd0', { metalness: 0.5, roughness: 0.35 }));
    tank.rotation.z = Math.PI / 2; tank.position.set(1.8, 0.9, 3.0); tank.castShadow = true;
    g.add(tank);                                                          // horizontal gas tank
    g.add(cyl(0.5, 9, Mtex(makeStripeTexture('#8a8378', '#787164', 8, false), { roughness: 0.7 }), 2.4, 0, -1.0, 0.4)); // smokestack
    g.add(cyl(0.44, 0.5, M('#c5483c'), 2.4, 8.6, -1.0));                  // red warning band
    // smoke puffs, shown & drifted by world.js while G.supply.gas > 0.3
    const smoke = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 8, 6),
        new THREE.MeshStandardMaterial({ color: '#b9b9b6', transparent: true, opacity: 0.55, roughness: 1, depthWrite: false }),
      );
      puff.userData.phase = k / 3;
      smoke.add(puff);
    }
    smoke.position.set(2.4, 9.3, -1.0);
    smoke.visible = false;
    g.add(smoke);
    g.userData.smoke = smoke;
  } else if (type === 'efuel') {
    // e-fuel refinery: synthesis columns, pipe rack, horizontal product tank
    const colM = M('#c8ccd0', { metalness: 0.55, roughness: 0.3 });
    for (const [x, h] of [[-1.6, 3.6], [-0.4, 4.2], [0.8, 3.2]]) g.add(cyl(0.55, h, colM, x, 0, -0.8));
    g.add(box(3.2, 0.16, 0.16, M('#9aa1a7', { metalness: 0.5 }), -0.4, 2.7, -0.8)); // pipe rack
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 2.4, 14), M('#d8b84a', { metalness: 0.35, roughness: 0.5 }));
    tank.rotation.z = Math.PI / 2; tank.position.set(1.4, 1.0, 1.6); tank.castShadow = true;
    g.add(tank);                                                          // e-fuel product tank
    g.add(box(2.2, 1.4, 1.4, M('#dde2e6'), -1.6, 0, 1.8));               // control building
  } else if (type === 'interconnector') {
    // HVDC converter station: valve hall, transformer yard, terminal pylon
    const hall = Mtex(makeStripeTexture('#aeb6be', '#9ca4ac', 20), { metalness: 0.3, roughness: 0.5 });
    g.add(box(4.2, 2.6, 3.0, hall, -1.2, 0, 0.6));                       // valve hall
    g.add(box(4.4, 0.22, 3.2, M('#7d858d'), -1.2, 2.6, 0.6));            // flat roof
    g.add(box(1.4, 1.5, 1.2, M('#3a4754', { metalness: 0.4 }), 1.9, 0, 2.0)); // transformer
    const steel = M('#8b9198', { metalness: 0.55, roughness: 0.4 });
    for (const x of [2.0, 3.0]) g.add(cyl(0.12, 7.2, steel, x, 0, -1.4)); // pylon legs
    g.add(box(3.0, 0.16, 0.16, steel, 2.5, 5.0, -1.4));                  // cross arms
    g.add(box(2.0, 0.14, 0.14, steel, 2.5, 6.4, -1.4));
    for (const x of [1.3, 2.5, 3.7]) g.add(cyl(0.07, 0.5, M('#4a7d5f'), x, 4.5, -1.4)); // insulators
  } else if (type === 'busStop') {
    g.add(box(2.4, 0.12, 1.4, M('#9aa2a8')));
    g.add(cyl(0.07, 2.4, M('#5b6266'), -0.9, 0, -0.4));
    g.add(box(2.2, 0.1, 1.0, M('#3f7fbf'), 0, 2.3, -0.2));
  } else if (type === 'truckStop') {
    g.add(box(3.6, 0.14, 3.6, M('#8d9499')));
    g.add(box(2.6, 1.8, 1.6, M('#c9742e'), 0, 0, -0.9));
    g.add(box(0.5, 1.2, 0.5, M('#4a5560'), 1.4, 0, 1.2)); // charger pillar
  } else if (type === 'trainStation') {
    g.add(box(7, 0.5, 2.4, M('#b9b2a4'), 0, 0, 1.6));               // platform
    g.add(box(4.2, 2.4, 2.6, Mtex(makeStripeTexture('#a8534a', '#934237', 10)), -1.2, 0, -1.4)); // station house
    g.add(box(4.8, 0.25, 3.1, M('#5a4f46'), -1.2, 2.4, -1.4));
    g.add(box(3.2, 0.16, 1.6, M('#dfe3e7'), 1.8, 2.0, 1.6));        // platform canopy
    g.add(cyl(0.09, 2.0, M('#6a7076'), 0.6, 0, 1.6));
    g.add(cyl(0.09, 2.0, M('#6a7076'), 3.0, 0, 1.6));
    g.add(box(0.4, 1.1, 0.1, M('#2c3e50'), -3.0, 0.5, 2.7));        // departures board
  }
  return g;
}

// ---------- industries ----------
export function buildIndustryMesh(type) {
  const gltf = modelInstance('ind_' + type);
  if (gltf) return gltf;
  const g = new THREE.Group();
  if (type === 'mine') {
    const rust = Mtex(makeStripeTexture('#7d6a58', '#6a5a4a', 18), { roughness: 0.8, metalness: 0.25 });
    g.add(box(4.6, 2.8, 3.6, rust, 0.4, 0, 0.2));                       // processing hall
    g.add(gableRoof(5.0, 1.1, 4.0, M('#4e463e'), 0.4, 2.8, 0.2));
    // headframe tower with sheave wheel over the shaft
    g.add(box(0.5, 5.4, 0.5, M('#5a5550'), 2.6, 0, -1.6));
    g.add(box(0.5, 5.4, 0.5, M('#5a5550'), 3.6, 0, -1.6));
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.2, 12), M('#3c3835', { metalness: 0.5 }));
    wheel.rotation.x = Math.PI / 2; wheel.position.set(3.1, 5.6, -1.6); wheel.castShadow = true; g.add(wheel);
    // conveyor ramp onto the ore heap
    const belt = box(4.2, 0.25, 0.8, M('#454744', { metalness: 0.4 }), -1.4, 0, 1.8);
    belt.rotation.z = 0.38; belt.position.y = 1.6; g.add(belt);
    const heap = cyl(2.2, 2.2, Mtex(makeBallastTexture(), { roughness: 1 }), -3.4, 0, 1.6, 0.25);
    g.add(heap);
  } else if (type === 'steel') {
    const corr = Mtex(makeStripeTexture('#646c78', '#545c68', 26), { metalness: 0.45, roughness: 0.5 });
    g.add(box(7, 4.6, 5, corr));                                         // main hall
    g.add(gableRoof(7.4, 1.4, 5.4, M('#454c56', { metalness: 0.4 }), 0, 4.6, 0));
    g.add(box(3.4, 2.2, 2.6, corr, -4.6, 0, 0.8));                       // annex
    // banded chimneys
    for (const [x, h] of [[-2, 9.5], [0, 8.5]]) {
      g.add(cyl(0.62, h, Mtex(makeStripeTexture('#8a929c', '#788089', 8, false), { metalness: 0.3 }), x, 0, -1.4, 0.5));
      g.add(cyl(0.66, 0.5, M('#c5483c'), x, h - 0.5, -1.4));
    }
    g.add(cyl(1.1, 3.2, Mtex(makeConcreteTexture()), 2.4, 0, -1.6));     // furnace tower
    const glow = box(2.4, 2.2, 0.4, new THREE.MeshStandardMaterial({ color: '#331a00', emissive: '#ff7a1a', emissiveIntensity: 1.6 }), 1.6, 0.6, 2.55);
    glow.name = 'glow'; g.add(glow);
  } else if (type === 'farm') {
    const planks = Mtex(makePlankTexture(), { roughness: 0.85 });
    g.add(box(3.6, 2.2, 2.8, planks, -1.6, 0, -1));                      // barn
    g.add(gableRoof(4.0, 1.5, 3.1, M('#6e4634'), -1.6, 2.2, -1));
    g.add(box(1.1, 1.6, 0.1, M('#54311f'), -1.6, 0, 0.42));              // barn door
    // grain silo with dome
    g.add(cyl(0.9, 3.4, Mtex(makeStripeTexture('#d9dde1', '#c4c9ce', 20, false), { metalness: 0.55, roughness: 0.35 }), 1.2, 0, -1.6));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M('#aeb4ba', { metalness: 0.5 }));
    dome.position.set(1.2, 3.4, -1.6); dome.castShadow = true; g.add(dome);
    // crop field with rows
    const field = box(5.6, 0.22, 4.6, Mtex(makeCropTexture(), { roughness: 1 }), 1.6, 0, 1.6);
    field.material.map.wrapS = field.material.map.wrapT = THREE.RepeatWrapping;
    field.material.map.repeat.set(2, 2);
    g.add(field);
  } else if (type === 'food') {
    const panel = Mtex(makeStripeTexture('#dde2e7', '#cdd3d9', 26), { roughness: 0.55, metalness: 0.2 });
    g.add(box(5.6, 3.2, 4.2, panel));                                    // hall
    g.add(box(5.8, 0.25, 4.4, M('#9aa2aa'), 0, 3.2, 0));                 // flat roof rim
    for (const z of [-1.2, 0.2, 1.4]) g.add(box(0.8, 0.55, 0.8, M('#8d959d', { metalness: 0.5 }), -1.4, 3.4, z)); // roof vents
    g.add(box(2.0, 1.1, 0.12, M('#3f7fbf'), 0, 1.6, 2.12));              // company sign
    // stainless silos with pipes
    for (const z of [0, 2.2]) {
      g.add(cyl(0.95, 4.4, M('#c8ced4', { metalness: 0.7, roughness: 0.25 }), 3.4, 0, z));
      g.add(cyl(0.12, 2.4, M('#9aa1a7', { metalness: 0.6 }), 2.6, 2.0, z));
    }
  }
  return g;
}

// ---------- vehicles ----------
export function buildVehicleMesh(kind) {
  const gltf = modelInstance('veh_' + kind);
  if (gltf) return gltf;
  const g = new THREE.Group();
  const Mv = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.4, ...o });
  const glassM = Mv('#18242f', { roughness: 0.12, metalness: 0.3 });
  const wheelM = Mv('#141618', { roughness: 0.9, metalness: 0 });
  const wheel = (x, z, r = 0.26) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.18, 10), wheelM);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, r, z);
    return w;
  };
  if (kind === 'train') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.3, 1.0, 1.0), Mv('#c8453c'));
    body.position.set(0, 0.7, 0);
    const nose1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.94), Mv('#a83830'));
    nose1.position.set(1.8, 0.58, 0);
    const nose2 = nose1.clone(); nose2.position.x = -1.8;
    const windows = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.34, 1.02), glassM);
    windows.position.set(0, 1.0, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.14, 0.92), Mv('#88909a'));
    roof.position.set(0, 1.28, 0);
    // pantograph reaching up to the (imaginary) catenary
    const panto = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), Mv('#3a4046'));
    panto.position.set(0.5, 1.65, 0); panto.rotation.z = 0.5;
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.9), Mv('#3a4046'));
    shoe.position.set(0.66, 1.95, 0);
    g.add(body, nose1, nose2, windows, roof, panto, shoe,
      wheel(1.3, 0.4, 0.2), wheel(1.3, -0.4, 0.2), wheel(-1.3, 0.4, 0.2), wheel(-1.3, -0.4, 0.2));
  } else if (kind === 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 1.1), Mv('#2e7d4f'));
    cab.position.set(1.05, 0.65, 0);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.38, 0.95), glassM);
    shield.position.set(1.5, 0.86, 0);
    const trailer = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 1.1, 1.1),
      new THREE.MeshStandardMaterial({ map: makeStripeTexture('#e8e4da', '#d6d2c6', 18), roughness: 0.5, metalness: 0.25 }),
    );
    trailer.position.set(-0.45, 0.75, 0);
    g.add(cab, shield, trailer,
      wheel(1.1, 0.46), wheel(1.1, -0.46), wheel(-0.1, 0.46), wheel(-0.1, -0.46),
      wheel(-1.1, 0.46), wheel(-1.1, -0.46));
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.0, 1.05), Mv('#2a78c2'));
    body.position.set(0, 0.7, 0);
    const windows = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.38, 1.08), glassM);
    windows.position.set(0.05, 0.92, 0);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.9), glassM);
    shield.position.set(1.4, 0.9, 0);
    const roofLine = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.18, 1.05), Mv('#dfe7ee'));
    roofLine.position.set(0, 1.28, 0);
    g.add(body, windows, shield, roofLine,
      wheel(0.95, 0.46), wheel(0.95, -0.46), wheel(-0.95, 0.46), wheel(-0.95, -0.46));
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function buildWagonMesh(type) {
  const gltf = modelInstance('wagon_' + (type === 'pax' ? 'pax' : 'freight'));
  if (gltf) return gltf;
  const g = new THREE.Group();
  const Mw = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.35, ...o });
  const wheel = (x, z) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 8), Mw('#141618', { roughness: 0.9, metalness: 0 }));
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.18, z);
    return w;
  };
  if (type === 'pax') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.9, 0.96), Mw('#3f7fbf'));
    body.position.set(0, 0.66, 0);
    const windows = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 1.0), Mw('#18242f', { roughness: 0.12 }));
    windows.position.set(0, 0.92, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.12, 0.88), Mw('#dfe7ee'));
    roof.position.set(0, 1.16, 0);
    g.add(body, windows, roof);
  } else {
    const tub = new THREE.Mesh(
      new THREE.BoxGeometry(2.9, 0.8, 0.96),
      new THREE.MeshStandardMaterial({ map: makeStripeTexture('#7a6a52', '#695a44', 12), roughness: 0.75 }),
    );
    tub.position.set(0, 0.6, 0);
    const load = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.25, 0.7), Mw('#55504a', { roughness: 0.95 }));
    load.position.set(0, 1.08, 0);
    load.name = 'load';
    g.add(tub, load);
  }
  g.add(wheel(1.1, 0.42), wheel(1.1, -0.42), wheel(-1.1, 0.42), wheel(-1.1, -0.42));
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
