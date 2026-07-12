// Terrain + water: the terrain mesh with its procedural ground shader
// (Board 07 look-dev port) and detail-map bake, plus the animated water
// surface with its tileable ripple normal bake. Split out of world.js —
// reads sim state from G, never mutates it.
import * as THREE from 'three';
import { G } from '../sim/state.js';
import { WATER_Y, heightAt } from '../sim/grid.js';
import { rand, hash2 } from './rng.js';

let scene;

export function initTerrain(sc) {
  scene = sc;
  buildTerrainMesh();
  buildWater();
}

// ---------- terrain ----------
function buildTerrainMesh() {
  const S = G.N * G.TILE, SEG = G.N * 2;
  const geo = new THREE.PlaneGeometry(S, S, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) pos.setY(k, heightAt(pos.getX(k), pos.getZ(k)));
  geo.computeVertexNormals();
  // Flat base colour + roughness from the Board 07 look-dev terrain node graph;
  // the real biome is computed procedurally in attachGroundShader's fragment
  // chunks, so the material itself carries no baked albedo texture (that big
  // canvas bake was the old "flat look" — it blurred badly at street level).
  const mat = new THREE.MeshStandardMaterial({ color: '#33501f', roughness: 0.92, metalness: 0 });
  attachGroundShader(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);
}

// ---------- procedural ground shader (Board 07 look-dev port) ----------
// The whole biome is a fragment-shader blend keyed off world position, ported
// from lookdev-blender.py's terrain node graph:
//   1. grass patchwork — two greens chosen by a macro noise field,
//   2. dirt breaks     — occasional bare-earth patches from a second noise,
//   3. rock on slopes  — where the geometric up-facing normal drops (look-dev
//      keyed normal.z 0.88→0.72),
//   4. sand at the shore — a height band just above the water plane.
// It is injected as onBeforeCompile chunks on a stock MeshStandardMaterial, so
// three's own fog / shadow-receive / lighting / envmap paths — and the
// screen-space GTAO pass — all run unchanged over the result (they read the
// final normal/depth and multiply fog last; none of that is touched here).
// Every term is a pure function of world XZ / height, so the look is fully
// deterministic from WORLD_SEED: nothing re-randomises per load. A tiling
// normal map supplies the micro bump; a hue-neutral detail texture adds
// close-up grain that fades out with distance so its repeat never shows.
const DETAIL_REPEAT = G.N;                         // micro-normal: one repeat per tile (4 wu)
const DETAIL_UV = 1 / G.TILE;                      // grain sampled per world unit → 1 tile / repeat

function attachGroundShader(mat) {
  const { albedo, normal } = makeGroundDetailMaps();
  mat.normalMap = normal;                          // micro bump (view-space, survives lighting)
  mat.normalScale = new THREE.Vector2(0.4, 0.4);

  mat.onBeforeCompile = shader => {
    shader.uniforms.uGroundDetail = { value: albedo };
    shader.uniforms.uWaterY = { value: WATER_Y };

    // world position varying (independent of the shadow/envmap-conditional
    // worldPosition three may or may not emit)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGroundPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGroundPos;
        uniform sampler2D uGroundDetail;
        uniform float uWaterY;
        float gHash(vec2 p){
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float gNoise(vec2 p){                       // smoothed value noise, [0,1]
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = gHash(i), b = gHash(i + vec2(1.0, 0.0));
          float c = gHash(i + vec2(0.0, 1.0)), d = gHash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float gFbm(vec2 p){
          float s = 0.0, a = 0.5;
          for (int k = 0; k < 4; k++){ s += a * gNoise(p); p *= 2.0; a *= 0.5; }
          return s;
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec2 wp = vGroundPos.xz;
        // geometric slope from world-position derivatives — the true macro
        // surface tilt, unaffected by the micro-bump normal map (y is up, so
        // |faceN.y| == 1 on flat ground, dropping toward 0 on cliffs)
        vec3 faceN = normalize(cross(dFdx(vGroundPos), dFdy(vGroundPos)));
        float upness = abs(faceN.y);

        // 1. grass patchwork: two greens over a macro noise field
        float macro = gNoise(wp * 0.05);
        vec3 col = mix(vec3(0.085, 0.22, 0.05), vec3(0.15, 0.30, 0.085),
                       smoothstep(0.40, 0.60, macro));
        col *= 0.92 + 0.16 * gFbm(wp * 0.35);       // within-patch mottle

        // 2. dirt breaks — look-dev drives this with fractal noise (TexNoise
        // detail 4, ramp 0.565→0.645) whose values cluster near 0.5, so bare
        // patches are occasional; a single-octave mask at the same ramp covers
        // ~a third of the map and washes the whole world out. Use the fbm and
        // a raised ramp so coverage matches the Board 07 boards.
        float dirt = gFbm(wp * 0.07 + 13.0);
        col = mix(col, vec3(0.35, 0.25, 0.13), smoothstep(0.60, 0.68, dirt));

        // 3. rock on steep slopes. Look-dev keyed normal.z 0.88 → 0.72, but this
        // world's heightfield is far gentler (min up-facing ~0.80 off-water), so
        // that ramp never fires here; shifted up to stay keyed to the genuinely
        // steepest slopes (river shoulders, hillsides) rather than never showing.
        col = mix(col, vec3(0.33, 0.32, 0.30), 1.0 - smoothstep(0.80, 0.92, upness));

        // 4. sand ringing the shoreline: a height band just above the water,
        // with a noisy edge so the waterline isn't a clean contour. Keep the
        // band tight: look-dev clamps its land well above the full-sand line,
        // so open lowlands there only ever pick up a faint tint — a wide band
        // here turns every pond basin into a huge pale beach.
        float above = (vGroundPos.y - uWaterY) + (gNoise(wp * 0.15 + 5.0) - 0.5) * 0.35;
        col = mix(col, vec3(0.52, 0.44, 0.27), 1.0 - smoothstep(0.10, 0.45, above));

        diffuseColor.rgb = col;

        // close-up grain (blade strokes on grass, granules on sand), faded out
        // with distance so the tiling repeat never shows
        float fade = 1.0 - smoothstep(60.0, 170.0, length(vViewPosition));
        if (fade > 0.001) {
          vec3 dA = texture2D(uGroundDetail, wp * ${DETAIL_UV}).rgb;
          vec3 dB = texture2D(uGroundDetail, wp * ${DETAIL_UV / 4.0} + 0.37).rgb;
          diffuseColor.rgb *= mix(vec3(1.0), dA * dB * 4.0, 0.4 * fade);
        }
      }`);
  };
}

// Tiling detail maps, generated once: a value-noise heightfield on wrapped
// lattices (so the texture tiles seamlessly), rendered as neutral-gray albedo
// grain with short blade strokes, plus a normal map derived from the same
// heightfield.
function makeGroundDetailMaps() {
  const S = 256;
  const lattice = (freq, seed) => {
    const L = new Float32Array(freq * freq);
    for (let i = 0; i < freq * freq; i++) L[i] = hash2((i % freq) + seed * 131, (i / freq | 0) + seed * 57);
    return (u, v) => {                             // smoothed bilinear, wrapped
      const x = u * freq, y = v * freq, x0 = Math.floor(x), y0 = Math.floor(y);
      let fx = x - x0, fy = y - y0;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const X0 = x0 % freq, X1 = (x0 + 1) % freq, Y0 = y0 % freq, Y1 = (y0 + 1) % freq;
      const a = L[Y0 * freq + X0], b = L[Y0 * freq + X1], c = L[Y1 * freq + X0], e = L[Y1 * freq + X1];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
    };
  };
  const octs = [[lattice(11, 1), 0.45], [lattice(23, 2), 0.28], [lattice(47, 3), 0.17], [lattice(97, 4), 0.10]];
  const H = new Float32Array(S * S);
  for (let py = 0; py < S; py++)
    for (let px = 0; px < S; px++) {
      const u = px / S, v = py / S;
      let h = 0;
      for (const [n, amp] of octs) h += n(u, v) * amp;
      H[py * S + px] = h;
    }

  // albedo: gray centered on 128 (multiplied ×2 in the shader → mean 1)
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(S, S);
  for (let k = 0; k < S * S; k++) {
    const g = 128 + (H[k] - 0.5) * 110 + (hash2(k, 7) - 0.5) * 40;
    img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = g;
    img.data[k * 4 + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  // short near-vertical strokes: blade hints on grass, drift marks on sand.
  // Each is drawn at 4 wrapped offsets so the texture still tiles.
  for (let s = 0; s < 900; s++) {
    const x = rand() * S, y = rand() * S, len = 2 + rand() * 3, tilt = (rand() - 0.5) * 1.6;
    cx.strokeStyle = rand() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.14)';
    for (const [ox, oy] of [[0, 0], [-S, 0], [0, -S], [-S, -S]]) {
      cx.beginPath();
      cx.moveTo(x + ox, y + oy);
      cx.lineTo(x + ox + tilt, y + oy + len);
      cx.stroke();
    }
  }
  const albedo = new THREE.CanvasTexture(cv);
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.anisotropy = 8;

  // normal map from the heightfield gradient (wrapped central differences)
  const nv = document.createElement('canvas');
  nv.width = nv.height = S;
  const nx = nv.getContext('2d');
  const nimg = nx.createImageData(S, S);
  const K = 2.2;                                   // bump strength
  for (let py = 0; py < S; py++)
    for (let px = 0; px < S; px++) {
      const dx = (H[py * S + (px + 1) % S] - H[py * S + (px + S - 1) % S]) * K;
      const dy = (H[((py + 1) % S) * S + px] - H[((py + S - 1) % S) * S + px]) * K;
      const il = 1 / Math.hypot(dx, dy, 1);
      const k = (py * S + px) * 4;
      nimg.data[k] = (-dx * il * 0.5 + 0.5) * 255;
      nimg.data[k + 1] = (-dy * il * 0.5 + 0.5) * 255;
      nimg.data[k + 2] = (il * 0.5 + 0.5) * 255;
      nimg.data[k + 3] = 255;
    }
  nx.putImageData(nimg, 0, 0);
  const normal = new THREE.CanvasTexture(nv);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.repeat.set(DETAIL_REPEAT, DETAIL_REPEAT);
  return { albedo, normal };
}

// ---------- water ----------
let waterMat, waterGeo, waterTime = 0;
// wave components: [amp, freqX, freqZ, speed]
const WAVES = [
  [0.045, 0.55, 0.22, 1.6],
  [0.035, -0.28, 0.62, 2.1],
  [0.025, 0.95, -0.7, 2.8],
];
function buildWater() {
  const S = G.N * G.TILE, SEG = 110;
  waterGeo = new THREE.PlaneGeometry(S, S, SEG, SEG).rotateX(-Math.PI / 2);
  // Board 07 water is dark, calm blue-grey. A strong clearcoat with the ripple
  // normals stretched over few repeats mirrors the bright sky as huge white
  // sheen blobs — keep the coat weak/rough and the ripples fine so the sheen
  // reads as sparkle on deep water instead.
  waterMat = new THREE.MeshPhysicalMaterial({
    color: '#154257', roughness: 0.4, metalness: 0, transparent: true, opacity: 0.95,
    transmission: 0, clearcoat: 0.25, clearcoatRoughness: 0.35,
    normalMap: makeWaterNormalTexture(), normalScale: new THREE.Vector2(0.22, 0.22),
  });
  waterMat.normalMap.repeat.set(40, 40);
  const mesh = new THREE.Mesh(waterGeo, waterMat);
  mesh.position.y = WATER_Y;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // ocean to the horizon: grounds the island and hides the sky dome below
  // the horizon line (the Sky shader produces garbage values down there)
  const ocean = new THREE.Mesh(
    new THREE.CircleGeometry(3500, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#1c4d6e', roughness: 0.55 }), // matte-ish: glossy water mirrors the bright horizon into a white sheet
  );
  ocean.position.y = WATER_Y - 0.06;
  scene.add(ocean);
}

// tileable ripple normal map from a sum of integer-wavenumber sinusoids
function makeWaterNormalTexture() {
  const PX = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = PX;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(PX, PX);
  const comps = [];
  for (let k = 0; k < 9; k++) {
    comps.push({
      a: 1 + Math.floor(rand() * 6), b: 1 + Math.floor(rand() * 6),
      ph: rand() * Math.PI * 2, amp: 0.5 + rand(),
    });
  }
  for (let py = 0; py < PX; py++) for (let px = 0; px < PX; px++) {
    const u = px / PX, v = py / PX;
    let dx = 0, dy = 0;
    for (const c of comps) {
      const arg = Math.PI * 2 * (c.a * u + c.b * v) + c.ph;
      const cs = Math.cos(arg) * c.amp;
      dx += cs * c.a; dy += cs * c.b;
    }
    const k = (py * PX + px) * 4;
    img.data[k] = 128 + Math.max(-127, Math.min(127, dx * 7));
    img.data[k + 1] = 128 + Math.max(-127, Math.min(127, dy * 7));
    img.data[k + 2] = 255;
    img.data[k + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function updateWater(dt) {
  waterTime += dt;
  const t = waterTime;
  const pos = waterGeo.attributes.position, nor = waterGeo.attributes.normal;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    let y = 0, ddx = 0, ddz = 0;
    for (const [a, fx, fz, sp] of WAVES) {
      const arg = x * fx + z * fz + t * sp;
      y += a * Math.sin(arg);
      const c = a * Math.cos(arg);
      ddx += c * fx; ddz += c * fz;
    }
    pos.setY(k, y);
    const inv = 1 / Math.hypot(ddx, 1, ddz);
    nor.setXYZ(k, -ddx * inv, inv, -ddz * inv);
  }
  pos.needsUpdate = nor.needsUpdate = true;
  waterMat.normalMap.offset.set(t * 0.014, t * 0.009);
}
