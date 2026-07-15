// Pointer build interaction on the 3D map: placement ghost, road/rail drag
// with cost preview, bulldozing, and selecting stations/industries/cities
// (incl. adding stops while editing a route). Translates clicks into sim
// calls (canPlace/place/bulldoze) — no game rules live here.
import * as THREE from 'three';
import { G, spend, earn } from '../sim/state.js';
import { BUILDINGS } from '../sim/data.js';
import {
  tile, tileFromWorld, worldXZ, tileY, canPlace, place, purchaseBuilding, bulldoze, lShapedPath, dragCost,
} from '../sim/grid.js';
import { toggleRouteStop } from '../sim/transport.js';
import { nameStation } from '../sim/stations.js';
import { scene, camera, renderer, controls } from '../render/scene.js';
import { buildPlantMesh } from '../render/meshes.js';
import { renderRoutes, showTipText, selectTool } from './hud.js';
import { pickEscapeLayer } from './hud/escape.js';

const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let ghost = null, ghostType = null, ghostOK = false;
let roadDrag = null; // {tool, i0, j0}
let hl, roadPreview;
const pvMat = {
  ok: new THREE.MeshBasicMaterial({ color: '#44ff66', transparent: true, opacity: 0.5 }),
  bad: new THREE.MeshBasicMaterial({ color: '#ff4444', transparent: true, opacity: 0.5 }),
};

export function initInput() {
  hl = new THREE.Mesh(
    new THREE.PlaneGeometry(G.TILE, G.TILE).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#44ff66', transparent: true, opacity: 0.4, depthWrite: false })
  );
  hl.visible = false;
  scene.add(hl);
  roadPreview = new THREE.Group();
  scene.add(roadPreview);

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  // right button is camera pan (scene.js); suppress the browser menu so a
  // right-click-to-cancel gesture (below) doesn't also pop up a context menu
  renderer.domElement.addEventListener('contextmenu', ev => ev.preventDefault());
}

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

function showRoadPreview(tiles, tool) {
  roadPreview.clear();
  for (const [i, j] of tiles) {
    const t = tile(i, j);
    const ok = canPlace(tool, i, j) || (t && (tool === 'road' ? t.t === 'road' : t.rail));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(G.TILE, G.TILE).rotateX(-Math.PI / 2), ok ? pvMat.ok : pvMat.bad);
    const [x, z] = worldXZ(i, j);
    m.position.set(x, tileY(i, j) + 0.3, z); // above the raised road deck (world.js ROAD_TOP)
    roadPreview.add(m);
  }
}

let downPos = null;
let rightDownPos = null; // right-click cancel (WP6): recorded on down, resolved on up
function onPointerDown(ev) {
  if (ev.button === 2) { rightDownPos = [ev.clientX, ev.clientY]; return; }
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
}

function onPointerMove(ev) {
  const p = terrainHit(ev);
  if (!p) { hl.visible = false; return; }
  const [i, j] = tileFromWorld(p.x, p.z);
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
    if (ghost) ghost.position.set(cx, tileY(i, j) + 0.02, cz);
    hl.visible = true;
    hl.scale.set(fp, 1, fp);
    hl.position.set(cx, tileY(i, j) + 0.3, cz);
    hl.material.color.set(ghostOK ? '#44ff66' : '#ff4444');
  } else if (G.tool) { // drag tools: road / rail
    hl.visible = true; hl.scale.set(1, 1, 1);
    const [x, z] = worldXZ(i, j);
    hl.position.set(x, tileY(i, j) + 0.3, z);
    hl.material.color.set(canPlace(G.tool, i, j) ? '#44ff66' : '#ff4444');
  } else hl.visible = false;
}

function onPointerUp(ev) {
  if (ev.button === 2) {
    // a right-click (movement < 5 px, i.e. not a camera pan) cancels the
    // active tool/route-edit, else clears the current selection — one layer,
    // same priority as Escape's first two layers (pickEscapeLayer, WP6)
    const p = rightDownPos;
    rightDownPos = null;
    if (!p) return;
    const dx = ev.clientX - p[0], dy = ev.clientY - p[1];
    if (Math.hypot(dx, dy) >= 5) return; // was a pan drag, not a click
    const layer = pickEscapeLayer({ modalOpen: false, tool: G.tool, routeEdit: G.routeEdit, selected: G.selected, showDemand: false });
    if (layer === 'tool') selectTool(null);
    else if (layer === 'selection') G.selected = null;
    return;
  }
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
      const cost = dragCost(tiles, dragTool);
      if (tiles.length && spend(cost, 'buildPlant')) tiles.forEach(([i, j]) => place(dragTool, i, j));
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
    if (refund > 0) earn(refund, 'buildPlant'); // demolition refund offsets construction capex
    return;
  }
  if (G.tool && G.tool !== 'road') {
    const def = BUILDINGS[G.tool];
    const ref = purchaseBuilding(G.tool, i, j); // sim validates & charges
    if (ref === 'blocked') return;
    if (ref === 'poor') { showTipText('Too expensive', `${def.name} costs ${def.cost.toLocaleString()}.`); return; }
    if (ref.kind === 'station') nameStation(ref);
    return;
  }
  // no tool → selection / route editing
  const t = tile(i, j);
  if (!t) return;
  if (t.occ && t.occ.kind === 'station' && G.routeEdit) {
    // add / remove a stop; clicking the first stop of a ≥2-stop route finishes
    // editing (routes loop back automatically — see toggleRouteStop)
    const res = toggleRouteStop(G.routeEdit, t.occ);
    renderRoutes();
    if (res !== 'finished') G.selected = t.occ;
    return;
  }
  if (t.occ && ['industry', 'station', 'plant'].includes(t.occ.kind)) G.selected = t.occ;
  else if (t.occ && t.occ.kind === 'cityBlock') G.selected = Object.assign(t.occ.city, { kind: 'city' });
  else G.selected = null;
}
