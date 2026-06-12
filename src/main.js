import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { G, hourOfDay, spend, emit, on, season } from './state.js';
import { BUILDINGS } from './data.js';
import {
  initWorld, updateWorld, tile, tileFromWorld, worldXZ, tileY,
  canPlace, place, bulldoze, buildPlantMesh, setNightAmount,
} from './world.js';
import { updateWeather, tickGrid, sampleHistory, dailyUpkeep } from './energy.js';
import { initTransport, tickIndustries, tickVehicles, tickCities, createRoute, buyVehicle, addWagon, findPath, updateDemandOverlay, updateRouteHighlight } from './transport.js';
import { initUI, updateUI, selectTool, tickResearch, renderRoutes, showTipText, showWelcome } from './ui.js';
import { initQuests, tickQuests } from './quests.js';
import { loadGame, saveGame, initAutosave } from './save.js';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#bcd6e8', 220, 520);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 1200);
camera.position.set(-60, 70, 30);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-110, 0, -110);
camera.position.set(-110 - 50, 65, -110 + 55);
// left button is reserved for building/selecting; camera: right = pan, middle = rotate
controls.mouseButtons = { MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = 1.42;
controls.minDistance = 18;
controls.maxDistance = 380;
controls.screenSpacePanning = false;

// ---------- lights / sky ----------
const sun = new THREE.DirectionalLight('#ffffff', 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -190;
sun.shadow.camera.right = sun.shadow.camera.top = 190;
sun.shadow.camera.far = 600;
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

const hemi = new THREE.HemisphereLight('#cfe8ff', '#5a6b4a', 0.7);
scene.add(hemi);

const SKY = {
  night: new THREE.Color('#222e54'), dawn: new THREE.Color('#e89a6a'),
  day: new THREE.Color('#9cc8e8'), dusk: new THREE.Color('#d97a5a'),
};
const skyCol = new THREE.Color();

function updateDayNight() {
  const h = hourOfDay();
  const s = season();
  // sun elevation: negative at night, 1 around noon; day length follows the season
  const elev = Math.sin(Math.PI * (h - s.sunrise) / (s.sunset - s.sunrise));
  const az = (h / 24) * Math.PI * 2;
  const R = 320;
  sun.position.set(Math.cos(az) * R * 0.6, Math.max(elev, 0.04) * 260 + 20, Math.sin(az) * R * 0.6);
  sun.position.add(controls.target);
  sun.target.position.copy(controls.target);
  const dayAmount = THREE.MathUtils.clamp(elev * 2.2 + 0.15, 0, 1);
  // night keeps a generous moonlight floor so the map stays readable
  sun.intensity = 0.75 + dayAmount * 2.0;
  sun.color.set(elev < -0.05 ? '#aabdff' : elev < 0.25 ? '#ffb070' : '#fff6e8');
  hemi.intensity = 0.58 + dayAmount * 0.4;
  // sky color blending
  if (elev < -0.18) skyCol.copy(SKY.night);
  else if (elev < 0.12) {
    const f = (elev + 0.18) / 0.3;
    skyCol.lerpColors(SKY.night, h < 12 ? SKY.dawn : SKY.dusk, f);
  } else {
    const f = Math.min(1, (elev - 0.12) / 0.5);
    skyCol.lerpColors(h < 12 ? SKY.dawn : SKY.dusk, SKY.day, f);
  }
  scene.background = skyCol;
  scene.fog.color.copy(skyCol);
  setNightAmount(1 - dayAmount);
}

// ---------- init ----------
initWorld(scene);
initTransport(scene);
const loadedSave = loadGame();   // restore player progress before the UI reads it
initUI();
initQuests();

// ---------- camera fly-to (quest 📍 buttons etc.) ----------
let camTween = null;
on('flyTo', ({ i, j }) => {
  const [x, z] = worldXZ(i, j);
  const dir = camera.position.clone().sub(controls.target);
  if (dir.length() > 130) dir.setLength(130);
  camTween = {
    t: 0,
    fromT: controls.target.clone(), toT: new THREE.Vector3(x, 0, z),
    fromP: camera.position.clone(), toP: new THREE.Vector3(x, 0, z).add(dir),
  };
});
function tickCamTween(dt) {
  if (!camTween) return;
  camTween.t = Math.min(1, camTween.t + dt * 1.6);
  const k = camTween.t * camTween.t * (3 - 2 * camTween.t); // smoothstep
  controls.target.lerpVectors(camTween.fromT, camTween.toT, k);
  camera.position.lerpVectors(camTween.fromP, camTween.toP, k);
  if (camTween.t >= 1) camTween = null;
}

// ---------- keyboard camera pan (WASD + arrows) ----------
const keysDown = new Set();
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  keysDown.add(e.code);
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => keysDown.delete(e.code));
addEventListener('blur', () => keysDown.clear());

const panFwd = new THREE.Vector3(), panRight = new THREE.Vector3();
function keyboardPan(dt) {
  let mx = 0, mz = 0; // right / forward
  if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) mz += 1;
  if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) mz -= 1;
  if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) mx -= 1;
  if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) mx += 1;
  if (!mx && !mz) return;
  // camera-yaw-relative directions, projected on the ground plane
  camera.getWorldDirection(panFwd);
  panFwd.y = 0;
  if (panFwd.lengthSq() < 1e-6) return;
  panFwd.normalize();
  panRight.crossVectors(panFwd, camera.up).normalize();
  const speed = camera.position.distanceTo(controls.target) * 0.9 * dt; // zoom-scaled
  const move = panFwd.multiplyScalar(mz * speed).addScaledVector(panRight, mx * speed);
  controls.target.add(move);
  camera.position.add(move);
}

// Starter infrastructure: a small legacy grid so the lights are on at game start.
function placeStarter(type, ni, nj) {
  for (let r = 0; r < 14; r++) for (let j = nj - r; j <= nj + r; j++) for (let i = ni - r; i <= ni + r; i++) {
    if (canPlace(type, i, j)) { place(type, i, j); return true; }
  }
  return false;
}
if (!loadedSave) {
  // suppress build-tips while placing the legacy grid, then re-arm them for the player's own builds
  for (const id of ['firstSolar', 'firstWind', 'firstBattery']) G.firedTips[id] = true;
  placeStarter('hydro', 66, 22);     // at the river
  placeStarter('wind', 30, 14);
  placeStarter('wind', 33, 14);
  placeStarter('solar', 12, 28);
  placeStarter('battery', 14, 34);
  G.batteryMWh = G.batteryCapMWh * 0.5;
  for (const id of ['firstSolar', 'firstWind', 'firstBattery']) delete G.firedTips[id];
}
initAutosave();
showWelcome(loadedSave);

// ---------- build interaction ----------
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let ghost = null, ghostType = null, ghostOK = false, ghostTile = [0, 0];
let roadDrag = null; // {i0, j0, tiles:[]}
const hl = new THREE.Mesh(
  new THREE.PlaneGeometry(G.TILE, G.TILE).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#44ff66', transparent: true, opacity: 0.4, depthWrite: false })
);
hl.visible = false;
scene.add(hl);
const roadPreview = new THREE.Group();
scene.add(roadPreview);

function terrainHit(ev) {
  mouse.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const terr = scene.getObjectByName('terrain');
  const hits = ray.intersectObject(terr);
  return hits.length ? hits[0].point : null;
}

function refreshGhost() {
  if (!G.tool || BUILDINGS[G.tool].drag || G.tool === 'bulldoze') {
    if (ghost) { scene.remove(ghost); ghost = null; ghostType = null; }
    return;
  }
  if (ghostType !== G.tool) {
    if (ghost) scene.remove(ghost);
    ghost = buildPlantMesh(G.tool);
    ghost.traverse(o => {
      if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; o.castShadow = false; }
    });
    scene.add(ghost);
    ghostType = G.tool;
  }
}

function lShapedPath(i0, j0, i1, j1) {
  const tiles = [];
  const si = Math.sign(i1 - i0) || 1, sj = Math.sign(j1 - j0) || 1;
  for (let i = i0; i !== i1 + si; i += si) tiles.push([i, j0]);
  for (let j = j0 + sj; (sj > 0 ? j <= j1 : j >= j1); j += sj) tiles.push([i1, j]);
  return tiles;
}

const pvMat = { ok: new THREE.MeshBasicMaterial({ color: '#44ff66', transparent: true, opacity: 0.5 }), bad: new THREE.MeshBasicMaterial({ color: '#ff4444', transparent: true, opacity: 0.5 }) };
function showRoadPreview(tiles, tool) {
  roadPreview.clear();
  for (const [i, j] of tiles) {
    const t = tile(i, j);
    const ok = canPlace(tool, i, j) || (t && (tool === 'road' ? t.t === 'road' : t.rail));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(G.TILE, G.TILE).rotateX(-Math.PI / 2), ok ? pvMat.ok : pvMat.bad);
    const [x, z] = worldXZ(i, j);
    m.position.set(x, tileY(i, j) + 0.1, z);
    roadPreview.add(m);
  }
}

let downPos = null;
renderer.domElement.addEventListener('pointerdown', ev => {
  if (ev.button !== 0) return;
  downPos = [ev.clientX, ev.clientY];
  if (G.tool && BUILDINGS[G.tool] && BUILDINGS[G.tool].drag) {
    const p = terrainHit(ev);
    if (p) {
      const [i, j] = tileFromWorld(p.x, p.z);
      roadDrag = { tool: G.tool, i0: i, j0: j };
      controls.enabled = false;
    }
  }
});

renderer.domElement.addEventListener('pointermove', ev => {
  const p = terrainHit(ev);
  if (!p) { hl.visible = false; return; }
  const [i, j] = tileFromWorld(p.x, p.z);
  ghostTile = [i, j];
  refreshGhost();
  if (roadDrag) {
    showRoadPreview(lShapedPath(roadDrag.i0, roadDrag.j0, i, j), roadDrag.tool);
    return;
  }
  if (G.tool && !BUILDINGS[G.tool].drag) {
    const def = BUILDINGS[G.tool];
    ghostOK = canPlace(G.tool, i, j);
    const fp = def.footprint || 1;
    const [x, z] = worldXZ(i, j);
    const cx = x + (fp - 1) * G.TILE / 2, cz = z + (fp - 1) * G.TILE / 2;
    if (ghost) {
      ghost.position.set(cx, tileY(i, j) + 0.02, cz);
      ghost.traverse(o => { if (o.isMesh) o.material.color.offsetHSL(0, 0, 0); });
    }
    hl.visible = true;
    hl.scale.set(fp, 1, fp);
    hl.position.set(cx, tileY(i, j) + 0.08, cz);
    hl.material.color.set(ghostOK ? '#44ff66' : '#ff4444');
  } else if (G.tool) { // drag tools: road / rail
    hl.visible = true; hl.scale.set(1, 1, 1);
    const [x, z] = worldXZ(i, j);
    hl.position.set(x, tileY(i, j) + 0.08, z);
    hl.material.color.set(canPlace(G.tool, i, j) ? '#44ff66' : '#ff4444');
  } else if (G.tool === 'bulldoze') {
    hl.visible = true; hl.scale.set(1, 1, 1);
    const [x, z] = worldXZ(i, j);
    hl.position.set(x, tileY(i, j) + 0.08, z);
    hl.material.color.set('#ff8844');
  } else hl.visible = false;
});

renderer.domElement.addEventListener('pointerup', ev => {
  if (ev.button !== 0) return;
  const wasDrag = downPos && (Math.abs(ev.clientX - downPos[0]) + Math.abs(ev.clientY - downPos[1]) > 6);
  downPos = null;
  // finish road / rail drag
  if (roadDrag) {
    const p = terrainHit(ev);
    const dragTool = roadDrag.tool;
    controls.enabled = true;
    roadPreview.clear();
    if (p) {
      const [i1, j1] = tileFromWorld(p.x, p.z);
      const tiles = lShapedPath(roadDrag.i0, roadDrag.j0, i1, j1).filter(([i, j]) => canPlace(dragTool, i, j));
      const cost = tiles.reduce((sum, [i, j]) => sum + BUILDINGS[dragTool].cost * (tile(i, j).t === 'water' ? 5 : 1), 0);
      if (tiles.length && spend(cost)) tiles.forEach(([i, j]) => place(dragTool, i, j));
      else if (tiles.length) showTipText('Too expensive', `That ${BUILDINGS[dragTool].name.toLowerCase()} costs ${cost.toLocaleString()}.`);
    }
    roadDrag = null;
    return;
  }
  if (wasDrag) return; // was a camera pan
  const p = terrainHit(ev);
  if (!p) return;
  const [i, j] = tileFromWorld(p.x, p.z);

  if (G.tool === 'bulldoze') {
    const refund = bulldoze(i, j);
    if (refund > 0) G.money += refund;
    return;
  }
  if (G.tool && G.tool !== 'road') {
    const def = BUILDINGS[G.tool];
    if (!canPlace(G.tool, i, j)) return;
    if (!spend(def.cost)) { showTipText('Too expensive', `${def.name} costs ${def.cost.toLocaleString()}.`); return; }
    const ref = place(G.tool, i, j);
    if (ref.kind === 'station') nameStation(ref);
    return;
  }
  // no tool → selection / route editing
  const t = tile(i, j);
  if (!t) return;
  if (t.occ && t.occ.kind === 'station' && G.routeEdit) {
    const r = G.routeEdit;
    if (r.stops[r.stops.length - 1] !== t.occ) {
      r.stops.push(t.occ);
      renderRoutes();
    }
    G.selected = t.occ;
    return;
  }
  if (t.occ && ['industry', 'station', 'plant'].includes(t.occ.kind)) G.selected = t.occ;
  else if (t.occ && t.occ.kind === 'cityBlock') G.selected = { kind: 'city', ...t.occ.city, __ref: t.occ.city };
  else G.selected = null;
  if (G.selected && G.selected.kind === 'city') G.selected = Object.assign(t.occ.city, { kind: 'city' });
});

let stationSeq = {};
function nameStation(st) {
  let best = null, bestD = 1e9;
  for (const ind of G.industries) {
    const d = Math.hypot(ind.i - st.i, ind.j - st.j);
    if (d < bestD && d < 8) { bestD = d; best = ind.def.name; }
  }
  if (!best) {
    for (const c of G.cities) {
      const d = Math.hypot(c.ci - st.i, c.cj - st.j);
      if (d < bestD) { bestD = d; best = c.name; }
    }
  }
  stationSeq[best] = (stationSeq[best] || 0) + 1;
  const suffix = { bus: 'Stop', truck: 'Depot', train: 'Station' }[st.stype];
  st.name = `${best} ${suffix} ${stationSeq[best] > 1 ? stationSeq[best] : ''}`.trim();
}

// ---------- game loop ----------
const MIN_PER_SEC = 8; // game minutes per real second at 1x → 1 day = 3 real minutes
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.06);
  last = now;

  const gm = dt * MIN_PER_SEC * G.speed;     // game minutes this frame
  const gh = gm / 60;                        // game hours
  if (gm > 0) {
    G.minutes += gm;
    if (Math.floor(G.minutes / 1440) + 1 > G.day) {
      G.day = Math.floor(G.minutes / 1440) + 1;
      G.incomeTransportToday = 0; G.incomeEnergyToday = 0; G.expensesToday = 0;
      G.curtailedTodayMWh = 0;
      G.finance.prev = G.finance.today;   // keep yesterday for the finance drill-down
      G.finance.today = { bus: 0, truck: 0, train: 0, routes: {} };
      dailyUpkeep(); // after the reset, so upkeep shows in today's expenses
    }
    updateWeather(gh);
    tickGrid(gh);
    tickIndustries(gh);
    tickVehicles(dt, gh);
    tickCities(gh);
    tickResearch(gh);
    sampleHistory(gm);
  }
  updateWorld(dt, gm);
  updateDemandOverlay(dt);
  updateRouteHighlight(dt);
  tickQuests(dt);
  updateDayNight();
  keyboardPan(dt);
  tickCamTween(dt);
  controls.update();
  updateUI(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// expose for debugging
window.G = G;
window.DEBUG = { place, canPlace, tile, bulldoze, createRoute, buyVehicle, addWagon, findPath, nameStation, saveGame, scene, camera, controls, renderer };
