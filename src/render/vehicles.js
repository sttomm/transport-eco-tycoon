// Vehicle & overlay rendering: vehicle/wagon meshes (created/removed via the
// sim's 'vehicleBought' / 'wagonAdded' / 'vehicleSold' events, posed each
// frame from sim path state), floating +€ income FX, the passenger demand
// overlay (V key) and the route highlight while editing/hovering a route.
import * as THREE from 'three';
import { G, on } from '../sim/state.js';
import { worldXZ, tileY, isRoad, isRail } from '../sim/grid.js';
import { routeColor, routeKind } from '../sim/transport.js';
import { pathPose, findPath, stationRoadTile } from '../sim/pathfinding.js';
import { buildVehicleMesh, buildWagonMesh, makeTextSprite } from './meshes.js';

// vehicles ride above the surface; trains higher, on top of the raised ballast bed
const VEH_Y = 0.25, TRAIN_Y = 0.40; // VEH_Y just above the road deck top (world.js ROAD_TOP)
const vehY = v => v.kind === 'train' ? TRAIN_Y : VEH_Y;
const WAGON_SPACING = 0.85;
// right-hand-traffic lane offset (WP8, render-only presentation — the sim
// path stays the centerline, pathfinding.js pathPose). yaw follows pathPose's
// convention (mesh nose +X forward at yaw=0); the right-of-travel direction
// in this renderer's right-handed, Y-up axes is cross(forward, up) =
// (sin(yaw), cos(yaw)) — that keeps a vehicle right of the centerline in the
// direction it's driving (German right-hand traffic). Trains/rails never
// call this (single track, no passing).
const LANE_L = 0.28 * G.TILE;
export function laneOffset(yaw) {
  return [Math.sin(yaw) * LANE_L, Math.cos(yaw) * LANE_L];
}

let scene;
const vehMesh = new Map();   // vehicle -> THREE.Group
const wagonMesh = new Map(); // wagon -> THREE.Group

export function initVehicleRender(sc) {
  scene = sc;
  on('vehicleBought', v => {
    const mesh = buildVehicleMesh(v.kind);
    const [x, z] = worldXZ(v.i, v.j);
    mesh.position.set(x, tileY(v.i, v.j) + vehY(v), z);
    scene.add(mesh);
    vehMesh.set(v, mesh);
  });
  on('wagonAdded', ({ vehicle, wagon }) => {
    const mesh = buildWagonMesh(wagon.type);
    const vm = vehMesh.get(vehicle);
    if (vm) { mesh.position.copy(vm.position); mesh.rotation.copy(vm.rotation); }
    scene.add(mesh);
    wagonMesh.set(wagon, mesh);
  });
  on('vehicleSold', v => {
    const mesh = vehMesh.get(v);
    if (mesh) scene.remove(mesh);
    vehMesh.delete(v);
    for (const w of v.wagons || []) {
      const wm = wagonMesh.get(w);
      if (wm) scene.remove(wm);
      wagonMesh.delete(w);
    }
  });
  on('moneyFx', ({ i, j, pay }) => spawnMoneyFx(i, j, pay));
}

// pose every vehicle (and its wagons) from the sim's path state
function syncVehiclePoses() {
  for (const v of G.vehicles) {
    const mesh = vehMesh.get(v);
    if (!mesh) continue;
    if (v.path && v.path.length) {
      const D = v.pathPos + Math.min(v.prog, 1);
      const [x, z, yaw, ti] = pathPose(v.path, D);
      // trains stay on the centerline (single track); road vehicles (bus/
      // truck) keep right of it. Only trains carry wagons, and those never
      // get an offset either.
      const [ox, oz] = (v.kind !== 'train' && yaw !== null) ? laneOffset(yaw) : [0, 0];
      mesh.position.set(x + ox, tileY(ti[0], ti[1]) + vehY(v), z + oz);
      if (yaw !== null) mesh.rotation.y = yaw;
      v.wagons.forEach((w, k) => {
        const wm = wagonMesh.get(w);
        if (!wm) return;
        const [wx, wz, wyaw, wti] = pathPose(v.path, D - (k + 1) * WAGON_SPACING);
        wm.position.set(wx, tileY(wti[0], wti[1]) + TRAIN_Y, wz);
        if (wyaw !== null) wm.rotation.y = wyaw;
      });
    }
  }
}

// ---------- floating +€ income text ----------
const fxList = [];
function spawnMoneyFx(i, j, pay) {
  const [x, z] = worldXZ(i, j);
  const sp = makeTextSprite('+€' + Math.round(pay).toLocaleString(), { color: '#9fe87e', size: 2.1, bg: null });
  sp.position.set(x, tileY(i, j) + 4, z);
  scene.add(sp);
  fxList.push({ sp, t: 0 });
}
function updateFx(dt) {
  for (let k = fxList.length - 1; k >= 0; k--) {
    const f = fxList[k];
    f.t += dt;
    f.sp.position.y += dt * 2.4;
    f.sp.material.opacity = Math.max(0, 1 - f.t / 1.8);
    if (f.t > 1.8) {
      scene.remove(f.sp);
      f.sp.material.map.dispose(); f.sp.material.dispose();
      fxList.splice(k, 1);
    }
  }
}

// ---------- passenger demand overlay (V key / 👥 button) ----------
let overlayGroup = null, overlayTimer = 9;
function updateDemandOverlay(dt) {
  overlayTimer += dt;
  // visible while toggled on OR while a city is selected
  const show = G.showDemand || (G.selected && G.selected.kind === 'city');
  if (!show) { if (overlayGroup) disposeOverlay(); return; }
  if (overlayGroup && overlayTimer < 1.2) return;
  overlayTimer = 0;
  disposeOverlay();
  overlayGroup = new THREE.Group();
  // city labels: who is waiting, and where they want to go
  for (const c of G.cities) {
    const total = Math.round(c.paxLocal + c.paxTo.reduce((a, b) => a + b, 0));
    const lines = [
      { text: `${c.name} · 👥 ${total} waiting · 😊 ${Math.round(c.happiness * 100)}%`, color: '#ffffff' },
      { text: `${Math.round(c.paxLocal)} around town`, color: '#9fd0ff' },
    ];
    G.cities.forEach((o, oi) => {
      if (o !== c && c.paxTo[oi] >= 1) lines.push({ text: `${Math.round(c.paxTo[oi])} → ${o.name}`, color: '#f0c64a' });
    });
    const sp = makeTextSprite(lines, { size: 2.6 });
    const [x, z] = worldXZ(c.ci, c.cj);
    sp.position.set(x, tileY(c.ci, c.cj) + 26, z);
    overlayGroup.add(sp);
  }
  // arcs: intercity travel demand between city pairs
  for (let a = 0; a < G.cities.length; a++) for (let b = a + 1; b < G.cities.length; b++) {
    const ca = G.cities[a], cb = G.cities[b];
    const n = ca.paxTo[b] + cb.paxTo[a];
    if (n < 3) continue;
    const [xa, za] = worldXZ(ca.ci, ca.cj), [xb, zb] = worldXZ(cb.ci, cb.cj);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(xa, 8, za),
      new THREE.Vector3((xa + xb) / 2, 30 + n * 0.1, (za + zb) / 2),
      new THREE.Vector3(xb, 8, zb),
    );
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 24, Math.min(0.8, 0.15 + n / 70), 6),
      new THREE.MeshBasicMaterial({ color: '#f0a23c', transparent: true, opacity: 0.6, depthWrite: false }),
    );
    overlayGroup.add(tube);
  }
  // bus stop / rail station badges, colored by crowding
  for (const st of G.stations) {
    if ((st.stype !== 'bus' && st.stype !== 'train') || !st.pax) continue;
    const n = Math.round(st.cargo.pax || 0);
    const color = n >= 30 ? '#ff6b5e' : n >= 15 ? '#f0c64a' : '#9fe87e';
    const sp = makeTextSprite(`${st.stype === 'bus' ? '🚏' : '🚉'} ${n}`, { color, size: 1.8 });
    const [x, z] = worldXZ(st.i, st.j);
    sp.position.set(x, tileY(st.i, st.j) + 5, z);
    overlayGroup.add(sp);
  }
  scene.add(overlayGroup);
}
function disposeOverlay() {
  if (!overlayGroup) return;
  overlayGroup.traverse(o => {
    if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    if (o.geometry) o.geometry.dispose();
  });
  scene.remove(overlayGroup);
  overlayGroup = null;
}

// ---------- route highlight (while editing / hovering a route) ----------
let hlGroup = null, hlSig = '', hlPulse = 0;
const vehRings = [];
// addable-station markers (ring + light beam + bouncing gem), rebuilt in
// rebuildHl() alongside hlGroup; animated per-frame in updateRouteHighlight()
// since their bob/spin needs a stable per-marker Y baseline, not just opacity
let addMarkers = [];

function disposeHl() {
  addMarkers = [];
  if (!hlGroup) return;
  hlGroup.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
  });
  scene.remove(hlGroup);
  hlGroup = null;
}

function ensureVehRings() {
  if (vehRings.length) return;
  const geo = new THREE.TorusGeometry(1.6, 0.14, 6, 24).rotateX(-Math.PI / 2);
  for (let k = 0; k < 14; k++) {
    const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthTest: false }));
    ring.renderOrder = 40;
    ring.visible = false;
    scene.add(ring);
    vehRings.push(ring);
  }
}

// path between two consecutive stops, on the network the stations imply
function stopPath(a, b) {
  const useRail = a.stype === 'train' && b.stype === 'train';
  const passable = useRail ? isRail : isRoad;
  const ta = stationRoadTile(a, passable), tb = stationRoadTile(b, passable);
  if (!ta || !tb) return null;
  return findPath(ta[0], ta[1], tb[0], tb[1], passable);
}

function rebuildHl(r) {
  disposeHl();
  if (!r || !r.stops.length) return;
  hlGroup = new THREE.Group();
  const col = new THREE.Color(routeColor(r));
  const lineMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.65, depthWrite: false });
  lineMat.userData = { pulse: true };
  const arrowGeo = new THREE.ConeGeometry(0.55, 1.4, 6);
  const up = new THREE.Vector3(0, 1, 0);

  const pairs = [];
  for (let k = 0; k < r.stops.length; k++) {
    const a = r.stops[k], b = r.stops[(k + 1) % r.stops.length];
    if (a === b) continue;
    pairs.push([a, b]);
    if (r.stops.length === 2) break; // out-and-back: one segment is enough
  }
  for (const [a, b] of pairs) {
    const path = stopPath(a, b);
    if (path && path.length >= 2) {
      const pts = path.map(([i, j]) => {
        const [x, z] = worldXZ(i, j);
        return new THREE.Vector3(x, tileY(i, j) + 0.7, z);
      });
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 2), 0.22, 5), lineMat);
      hlGroup.add(tube);
      // direction arrows every ~6 tiles
      for (let d = 3; d < path.length - 1; d += 6) {
        const u = d / (path.length - 1);
        const pos = curve.getPointAt(u), tan = curve.getTangentAt(u);
        const cone = new THREE.Mesh(arrowGeo, lineMat);
        cone.position.copy(pos);
        cone.quaternion.setFromUnitVectors(up, tan.normalize());
        hlGroup.add(cone);
      }
    } else {
      // no road/rail connection yet → dashed red straight line as a hint
      const [xa, za] = worldXZ(a.i, a.j), [xb, zb] = worldXZ(b.i, b.j);
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xa, tileY(a.i, a.j) + 1.2, za),
        new THREE.Vector3(xb, tileY(b.i, b.j) + 1.2, zb),
      ]);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: '#ff6b5e', dashSize: 1.6, gapSize: 1.2, transparent: true, opacity: 0.8 }));
      line.computeLineDistances();
      hlGroup.add(line);
    }
  }
  // stop markers with order number
  r.stops.forEach((st, k) => {
    const [x, z] = worldXZ(st.i, st.j);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.2, 6, 28).rotateX(-Math.PI / 2), lineMat);
    ring.position.set(x, tileY(st.i, st.j) + 0.5, z);
    hlGroup.add(ring);
    const tag = makeTextSprite(`${k + 1}`, { color: '#ffffff', size: 2.0, bg: routeColor(r) + 'd0' });
    tag.position.set(x, tileY(st.i, st.j) + 6.5, z);
    hlGroup.add(tag);
  });
  // while EDITING: a big, hard-to-miss marker over stations you can still
  // add — those matching this route's kind (a kindless empty route accepts
  // any) and not yet a stop. Teaches "click these to add them" (WP5).
  // Three parts, all sharing one bright green identity but each reading
  // differently so it pops from any camera distance: a large pulsing ring on
  // the ground, a translucent light-beam column standing over the station
  // (visible over rooftops/trees from across the map), and a small gem that
  // bounces + spins at the top of the beam. Distinct from the thin per-
  // vehicle rings (routeColor-tinted, radius 1.6, ground-hugging) and the
  // per-stop order rings (radius 2.0, no beam/gem) elsewhere in this
  // function. Read-only view of state.
  if (r === G.routeEdit) {
    const rk = routeKind(r);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#9dffc0', transparent: true, opacity: 0.85, depthWrite: false });
    ringMat.userData = { pulse: true, base: 0.7, amp: 0.3 }; // 0.4–1.0: much stronger swing than the route line's 0.3–0.8
    const beamMat = new THREE.MeshBasicMaterial({
      color: '#8fe89a', transparent: true, opacity: 0.3, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    beamMat.userData = { pulse: true, base: 0.32, amp: 0.16, speed: 0.6 }; // slower, softer glow
    const gemMat = new THREE.MeshBasicMaterial({ color: '#eafff2' });
    const ringGeo = new THREE.TorusGeometry(3.2, 0.26, 8, 32).rotateX(-Math.PI / 2); // was 2.5/0.16 — bigger, thicker
    const beamGeo = new THREE.CylinderGeometry(0.22, 0.65, 9, 10, 1, true); // open-ended: no cap disc to read wrong side-on
    const gemGeo = new THREE.OctahedronGeometry(0.7, 0);
    for (const st of G.stations) {
      if (r.stops.includes(st)) continue;
      const sk = st.stype === 'bus' ? 'bus' : st.stype === 'train' ? 'rail' : 'cargo';
      if (rk && sk !== rk) continue; // non-matching kind: not addable to this route
      const [x, z] = worldXZ(st.i, st.j);
      const baseY = tileY(st.i, st.j);

      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(x, baseY + 0.4, z);
      ring.renderOrder = 20;
      hlGroup.add(ring);

      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(x, baseY + 5, z); // spans ~ground+0.5 to ground+9.5
      beam.renderOrder = 19;
      hlGroup.add(beam);

      const gemBaseY = baseY + 10;
      const gem = new THREE.Mesh(gemGeo, gemMat);
      gem.position.set(x, gemBaseY, z);
      gem.renderOrder = 21;
      hlGroup.add(gem);
      addMarkers.push({ gem, baseY: gemBaseY });
    }
  }
  scene.add(hlGroup);
}

function updateRouteHighlight(dt) {
  const r = G.routeEdit || G.routeHover;
  // the edit/hover flag is in the signature so starting to edit an already-
  // hovered route rebuilds and reveals the addable-station rings
  const sig = r ? `${r === G.routeEdit ? 'E' : 'H'}${r.id}:${r.stops.map(s => s.i + ',' + s.j).join(';')}:${G.stations.length}` : '';
  if (sig !== hlSig) { hlSig = sig; rebuildHl(r); }
  if (!r) { for (const ring of vehRings) ring.visible = false; return; }
  hlPulse += dt * 3.5;
  const op = 0.55 + Math.sin(hlPulse) * 0.25;
  // each pulsing material can override the base/amplitude/speed of the swing
  // (the add-station ring/beam pulse harder and slower than this default —
  // see rebuildHl) so they read as more urgent than the route line itself
  if (hlGroup) hlGroup.traverse(o => {
    const ud = o.material && o.material.userData;
    if (!ud || !ud.pulse) return;
    o.material.opacity = ud.base === undefined
      ? op
      : ud.base + Math.sin(hlPulse * (ud.speed ?? 1)) * ud.amp;
  });
  // bounce + spin the addable-station gems (beam/ring pulse via the material
  // loop above; the gem needs its own per-frame transform, not just opacity)
  for (const m of addMarkers) {
    m.gem.position.y = m.baseY + Math.sin(hlPulse * 1.6) * 0.9;
    m.gem.rotation.y += dt * 2.2;
  }
  // glowing rings under the route's vehicles
  ensureVehRings();
  const col = new THREE.Color(routeColor(r));
  let k = 0;
  for (const v of r.vehicles) {
    if (k >= vehRings.length) break;
    const mesh = vehMesh.get(v);
    if (!mesh) continue;
    const ring = vehRings[k++];
    ring.visible = true;
    ring.material.color.copy(col);
    ring.material.opacity = 0.5 + Math.sin(hlPulse) * 0.3;
    ring.position.set(mesh.position.x, mesh.position.y + 0.15, mesh.position.z);
  }
  for (; k < vehRings.length; k++) vehRings[k].visible = false;
}

export function updateVehicleRender(dt) {
  syncVehiclePoses();
  updateFx(dt);
  updateDemandOverlay(dt);
  updateRouteHighlight(dt);
}
