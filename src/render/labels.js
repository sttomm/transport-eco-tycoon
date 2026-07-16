// City name labels (WP7): one persistent text sprite per city, created ONCE
// at init — unlike vehicles.js's demand overlay (which tears down and
// rebuilds every ~1.2 s), these never rebuild; they just reposition/rescale
// every frame from G.cities, which worldgen never resizes or reorders after
// initGrid(). Read-only view of sim state, never mutates it.
import * as THREE from 'three';
import { G } from '../sim/state.js';
import { worldXZ, tileY } from '../sim/grid.js';
import { makeTextSprite, UI_SPRITE_LAYER } from './meshes.js';
import { camera } from './scene.js';

const LABEL_Y = 15;           // world units above ground
const NEAR = 18, FAR_SCALE = 220; // fade-in-close / grow-with-distance tuning

const labels = []; // { sprite, city, baseW, baseH }

export function initLabels(sc) {
  for (const city of G.cities) {
    const sprite = makeTextSprite(city.name, { size: 3.2, color: '#fff3d6' });
    const [x, z] = worldXZ(city.ci, city.cj);
    sprite.position.set(x, tileY(city.ci, city.cj) + LABEL_Y, z);
    sprite.userData.city = city; // input.js raycast pick reads this back
    sc.add(sprite);
    labels.push({ sprite, city, baseW: sprite.scale.x, baseH: sprite.scale.y });
  }
}

// distance-attenuated scale (readable from far away without growing giant up
// close) + a fade when the camera is right on top of the city, where the 3D
// buildings already make it obvious which city this is
export function updateLabels() {
  for (const { sprite, baseW, baseH } of labels) {
    const d = camera.position.distanceTo(sprite.position);
    const k = THREE.MathUtils.clamp(d / FAR_SCALE, 0.65, 2.4);
    sprite.scale.set(baseW * k, baseH * k, 1);
    sprite.material.opacity = THREE.MathUtils.clamp((d - NEAR) / 30, 0.2, 1);
  }
}

// input.js's click handler: does this ray hit a city label? Returns the city
// object (or null). Callers add `.kind = 'city'` themselves, same convention
// as clicking a cityBlock tile. Label sprites live on UI_SPRITE_LAYER (see
// meshes.js — keeps them off GTAOPass's g-buffer camera), which a plain
// `new THREE.Raycaster()` (input.js's default layer 0 only) can't see by
// default; enable it here for the intersect test only, then restore the
// caller's mask so this doesn't leak into whatever else `ray` is used for.
export function pickCityLabel(ray) {
  const prevMask = ray.layers.mask;
  ray.layers.enable(UI_SPRITE_LAYER);
  ray.camera = camera; // three.js requires this to raycast sprites
  const hit = ray.intersectObjects(labels.map(l => l.sprite))[0];
  ray.layers.mask = prevMask;
  return hit ? hit.object.userData.city : null;
}
