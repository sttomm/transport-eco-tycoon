// Post-processing chain: GTAO (contact shadows between buildings), bloom
// (emissive windows / signal lights), and a zoom-scaled tilt-shift blur that
// gives the classic city-builder "miniature" look when zoomed out.
// Render order: scene → AO → bloom (HDR) → tone map/sRGB → tilt-shift (LDR).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

let composer, gtaoPass, bloomPass, tiltH, tiltV;
let renderer, scene, camera, controls;
let enabled = true;

// 9-tap gaussian blur along one axis, ramping up with distance from a
// horizontal focus band — cheap two-pass tilt-shift.
const tiltShiftShader = (dx, dy) => ({
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0 },      // max blur offset in UV units
    focus: { value: 0.5 },     // screen-space y of the sharp band
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float amount;
    uniform float focus;
    varying vec2 vUv;
    void main() {
      float d = clamp(abs(vUv.y - focus) * 2.4, 0.0, 1.0);
      vec2 step = vec2(${dx}, ${dy}) * amount * d * d;
      vec4 c = texture2D(tDiffuse, vUv) * 0.1633;
      c += (texture2D(tDiffuse, vUv + step)       + texture2D(tDiffuse, vUv - step))       * 0.1531;
      c += (texture2D(tDiffuse, vUv + step * 2.0) + texture2D(tDiffuse, vUv - step * 2.0)) * 0.12245;
      c += (texture2D(tDiffuse, vUv + step * 3.0) + texture2D(tDiffuse, vUv - step * 3.0)) * 0.0918;
      c += (texture2D(tDiffuse, vUv + step * 4.0) + texture2D(tDiffuse, vUv - step * 4.0)) * 0.051;
      gl_FragColor = c;
    }`,
});

export function initPostFX(r, s, cam, ctl) {
  renderer = r; scene = s; camera = cam; controls = ctl;
  const size = renderer.getSize(new THREE.Vector2()).multiplyScalar(renderer.getPixelRatio());

  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4, // MSAA — composer render targets get no antialiasing otherwise
  });
  composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  gtaoPass = new GTAOPass(scene, camera, size.x, size.y);
  gtaoPass.updateGtaoMaterial({
    radius: 1.6,            // world units; tiles are ~2, buildings 2–9 tall
    distanceExponent: 1,
    thickness: 1,
    scale: 1.2,
    samples: 8, // 16 halves the frame rate; the denoise pass hides the difference
    distanceFallOff: 1,
    screenSpaceRadius: false,
  });
  gtaoPass.blendIntensity = 0.9;
  composer.addPass(gtaoPass);

  // threshold must clear sun-lit whites (HDR, pre-tonemap; they reach ~2.8)
  // so only hot emissives (night windows, furnaces) and the sun disc bloom
  bloomPass = new UnrealBloomPass(size, 0.45, 0.35, 3.4);
  composer.addPass(bloomPass);

  composer.addPass(new OutputPass()); // tone mapping + sRGB; blur below runs in LDR

  tiltH = new ShaderPass(tiltShiftShader('1.0', '0.0'));
  tiltV = new ShaderPass(tiltShiftShader('0.0', '1.0'));
  composer.addPass(tiltH);
  composer.addPass(tiltV);

  addEventListener('resize', () =>
    composer.setSize(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio()));
  Object.assign(PFX, { composer, gtaoPass, bloomPass, tiltH, tiltV });
}

export function setPostFX(on) { enabled = on; } // escape hatch for weak GPUs (DEBUG.setPostFX)
export const PFX = {}; // live-tuning handle for playtests (DEBUG.PFX)

const focusV = new THREE.Vector3();
export function renderPostFX() {
  if (!enabled) { renderer.render(scene, camera); return; }
  // miniature look: sharp band at the camera target, blur grows with zoom-out
  const dist = camera.position.distanceTo(controls.target);
  // WP8: start later and weaker — the old (90, 380)*0.0035 curve blurred the
  // playable mid-zoom range too aggressively
  const amount = THREE.MathUtils.smoothstep(dist, 170, 560) * 0.0022;
  focusV.copy(controls.target).project(camera);
  const focus = THREE.MathUtils.clamp(focusV.y * 0.5 + 0.5, 0.15, 0.85);
  for (const p of [tiltH, tiltV]) {
    p.enabled = amount > 0.0002;
    p.uniforms.amount.value = amount;
    p.uniforms.focus.value = focus;
  }
  composer.render();
}
