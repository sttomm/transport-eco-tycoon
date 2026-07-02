// Renderer, camera, lights and the day/night cycle. Also owns camera motion:
// WASD/arrow panning and the smooth fly-to tween (quest 📍 buttons emit
// 'flyTo'). Build-tool pointer input lives in src/ui/input.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { G, hourOfDay, on, season } from '../sim/state.js';
import { worldXZ } from '../sim/grid.js';
import { setNightAmount } from './world.js';

export let renderer, scene, camera, controls;

export function initScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  // 1.5 instead of full retina 2.0: the post stack (GTAO especially) scales
  // with pixel count and halves the frame rate at 2.0 for no visible gain
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft is deprecated in r185+ and its lazy fallback breaks shadow compilation
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('app').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#bcd6e8', 220, 520);

  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 4000);

  controls = new OrbitControls(camera, renderer.domElement);
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

  initLights();
  initSky();
  initKeyboardPan();
  initFlyTo();

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  return scene;
}

// ---------- lights / sky ----------
let sun, hemi;
const SKY = {
  night: new THREE.Color('#222e54'), dawn: new THREE.Color('#e89a6a'),
  day: new THREE.Color('#9cc8e8'), dusk: new THREE.Color('#d97a5a'),
};
const skyCol = new THREE.Color();

function initLights() {
  sun = new THREE.DirectionalLight('#ffffff', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -190;
  sun.shadow.camera.right = sun.shadow.camera.top = 190;
  sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  // env map (below) carries most of the ambient now; hemi is a readability floor
  hemi = new THREE.HemisphereLight('#cfe8ff', '#5a6b4a', 0.35);
  scene.add(hemi);
}

// ---------- atmospheric sky + image-based lighting ----------
// A physical Sky dome renders the visible sky; a second Sky instance is baked
// into a PMREM environment map whenever the sun has moved enough, so PBR
// materials pick up sky/sun bounce light (this is what keeps them from
// looking flat under pure analytic lights).
let sky, envSky, envScene, pmrem, envRT;
let lastEnvElev = Infinity;
const sunDir = new THREE.Vector3();

// the Sky shader is calibrated for the three.js example's exposure (~0.5);
// at this scene's exposure its horizon blows out to white, so halve its output
const dimSky = s => {
  s.material.fragmentShader = s.material.fragmentShader
    .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * 0.5, 1.0 );');
};

function initSky() {
  sky = new Sky();
  sky.scale.setScalar(3000);
  dimSky(sky);
  scene.add(sky);
  const u = sky.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.85;
  u.cloudDensity.value = 0.55;

  envSky = new Sky();
  dimSky(envSky);
  // no sun disc in the env bake — its extreme luminance would torch every
  // glossy surface via specular; the directional light already is the sun.
  // No clouds either: the ambient bake should stay smooth.
  envSky.material.uniforms.showSunDisc.value = 0;
  envSky.material.uniforms.cloudCoverage.value = 0;
  envScene = new THREE.Scene();
  envScene.add(envSky);
  pmrem = new THREE.PMREMGenerator(renderer);
  scene.environmentIntensity = 0.55;
}

function updateSky(elev, az) {
  // true elevation (may be below horizon) so nights actually darken the dome
  sunDir.set(Math.cos(az) * 0.6, elev, Math.sin(az) * 0.6).normalize();
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  // clouds mirror the sim's weather: an overcast sky is WHY solar is low
  sky.material.uniforms.cloudCoverage.value = 0.1 + G.cloud * 0.6;
  sky.material.uniforms.time.value = G.minutes * 0.02; // game time, keeps saves deterministic
  if (Math.abs(elev - lastEnvElev) > 0.08) { // ~1 bake per few real seconds; tighter thresholds cause visible hitches
    lastEnvElev = elev;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'])
      envSky.material.uniforms[k].value = sky.material.uniforms[k].value;
    envSky.material.uniforms.sunPosition.value.copy(sunDir);
    const rt = pmrem.fromScene(envScene);
    scene.environment = rt.texture;
    envRT?.dispose();
    envRT = rt;
  }
}

export function updateDayNight() {
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
  sun.intensity = 0.85 + dayAmount * 1.75;
  sun.color.set(elev < -0.05 ? '#aabdff' : elev < 0.25 ? '#ffb070' : '#fff6e8');
  // at day the env map carries the ambient; at night hemi is the moonlight
  // floor that keeps the map readable (teaching mission > realism)
  hemi.intensity = 0.55;
  updateSky(elev, az);
  // fog color follows the horizon mood (the visible sky itself is the Sky dome)
  if (elev < -0.18) skyCol.copy(SKY.night);
  else if (elev < 0.12) {
    const f = (elev + 0.18) / 0.3;
    skyCol.lerpColors(SKY.night, h < 12 ? SKY.dawn : SKY.dusk, f);
  } else {
    const f = Math.min(1, (elev - 0.12) / 0.5);
    skyCol.lerpColors(h < 12 ? SKY.dawn : SKY.dusk, SKY.day, f);
  }
  scene.fog.color.copy(skyCol);
  setNightAmount(1 - dayAmount);
}

// ---------- camera fly-to (quest 📍 buttons etc.) ----------
let camTween = null;
function initFlyTo() {
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
}
export function tickCamTween(dt) {
  if (!camTween) return;
  camTween.t = Math.min(1, camTween.t + dt * 1.6);
  const k = camTween.t * camTween.t * (3 - 2 * camTween.t); // smoothstep
  controls.target.lerpVectors(camTween.fromT, camTween.toT, k);
  camera.position.lerpVectors(camTween.fromP, camTween.toP, k);
  if (camTween.t >= 1) camTween = null;
}

// ---------- keyboard camera pan (WASD + arrows) ----------
const keysDown = new Set();
function initKeyboardPan() {
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    keysDown.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  addEventListener('keyup', e => keysDown.delete(e.code));
  addEventListener('blur', () => keysDown.clear());
}

const panFwd = new THREE.Vector3(), panRight = new THREE.Vector3();
export function keyboardPan(dt) {
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
