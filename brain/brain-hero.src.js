/*
 * brain-hero — a real MRI volume as a mint hologram point cloud with procedural vasculature
 * and a vertical axial-slice scale. Self-contained: injects its own markup and CSS.
 *
 *   import { mountBrainHero } from './dist/brain-hero.js';
 *   const hero = mountBrainHero(document.querySelector('#brain'), { dataUrl: '/data/' });
 *   hero.setSlice(20); hero.reset(); hero.destroy();
 *
 * Options
 *   dataUrl       folder with brain_atlas.webp|png, brain_meta.json, poster.png   (default 'data/')
 *   points        number of hologram points                                       (default 110000)
 *   scrollDriver  element whose scroll progress drives the slice (optional);
 *                 the container emits 'brainhero:scroll' with { progress } as it moves
 *
 * Layout: the container is filled by the canvas; the scale sits at its left edge. The brain is centred,
 * shift it with CSS custom properties on the container: --brain-offset-x / --brain-offset-y (world units,
 * roughly -1..1), e.g. inside a media query.
 */
import * as THREE from 'three';

/* ------------------------------------------------------------------ look */
const C = {   // mint theme, base #3DF5B8
  dots: '#c2fbe6', deep: '#3df5b8', glow: '#19c98f', dust: '#a8f7dc',
  vessel: 0xdafff2, vesselEmis: 0x3df5b8, vein: 0x8fe0d6, veinEmis: 0x1fb39a,
  cap: '#cdfbea', capDark: [0.02, 0.14, 0.10], hemi: [0xe6fff6, 0x062a1e], fill: 0x3df5b8, clear: 0x050807,
  dotsOpacity: 0.7, glowOpacity: 0.05, artOpacity: 0.55, veinOpacity: 0.4, capOpacity: 0.7,
};

const CSS = /* css */`
.bh{position:relative;width:100%;height:100%;overflow:hidden;--bh-fg:#f2f2f0;--bh-fg-2:rgba(242,242,240,.62);--bh-fg-3:rgba(242,242,240,.34);--bh-line:rgba(255,255,255,.10);--bh-pill:rgba(20,20,24,.72);--bh-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;--bh-gutter:clamp(16px,3vw,40px)}
.bh-stage{position:absolute;inset:0;touch-action:none;cursor:grab;outline:none}
.bh-stage.dragging{cursor:grabbing}
.bh-stage canvas{display:block;width:100%;height:100%}
.bh-stage img{width:100%;height:100%;object-fit:contain;opacity:.9}
.bh-scale{position:absolute;z-index:2;left:var(--bh-gutter);top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:flex-start;gap:12px;user-select:none;-webkit-user-select:none}
.bh-label{font-family:var(--bh-mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--bh-fg-3)}
.bh-ticks{position:relative;height:min(300px,44vh);width:64px;touch-action:none;cursor:ns-resize;outline:none}
.bh-tick{position:absolute;left:0;height:1px;width:12px;background:var(--bh-fg-3);transition:width .35s cubic-bezier(.2,.7,.2,1),background .35s,opacity .35s}
.bh-tick.major{width:18px}.bh-tick.near{width:26px;background:var(--bh-fg-2)}.bh-tick.above{opacity:.35}
.bh-handle{position:absolute;left:0;width:40px;height:2px;background:var(--bh-fg);border-radius:2px;transform:translateY(-50%);box-shadow:0 0 12px rgba(255,255,255,.25);pointer-events:none}
.bh-readout{position:absolute;left:50px;transform:translateY(-50%);font-family:var(--bh-mono);font-size:11.5px;letter-spacing:.02em;color:var(--bh-fg);padding:5px 8px;border-radius:8px;background:var(--bh-pill);border:1px solid var(--bh-line);backdrop-filter:blur(10px);white-space:nowrap;pointer-events:none}
.bh-readout small{color:var(--bh-fg-3)}
.bh-reset{appearance:none;border:1px solid var(--bh-line);background:var(--bh-pill);color:var(--bh-fg-2);font:500 11.5px var(--bh-mono);letter-spacing:.06em;text-transform:uppercase;padding:8px 12px;border-radius:999px;backdrop-filter:blur(10px);cursor:pointer;display:inline-flex;gap:8px;align-items:center;transition:color .2s,border-color .2s}
.bh-reset:hover{color:var(--bh-fg);border-color:rgba(255,255,255,.22)}
.bh-reset svg{width:12px;height:12px}
.bh-loader{position:absolute;inset:0;z-index:3;display:grid;place-items:center;background:#050807;transition:opacity .6s ease;pointer-events:none;font-family:var(--bh-mono);font-size:12px;color:var(--bh-fg-3);letter-spacing:.08em;text-align:center;padding:24px}
.bh-loader.hide{opacity:0}
@media (max-width:720px){.bh{--bh-gutter:16px}.bh-scale{top:13%;transform:none;gap:8px}.bh-label{display:none}.bh-ticks{height:27vh;width:48px}.bh-tick{width:9px}.bh-tick.major{width:14px}.bh-tick.near{width:18px}.bh-tick:nth-child(odd of .bh-tick){display:none}.bh-handle{width:28px}.bh-readout{left:36px;font-size:10.5px;padding:4px 7px}.bh-reset{font-size:10.5px;padding:6px 10px}}
@media (max-width:720px) and (max-height:640px){.bh-ticks{height:22vh}}
`;

const HTML = /* html */`
<div class="bh-stage" data-stage aria-label="Interactive 3D MRI brain. Drag to rotate." role="img" tabindex="0"></div>
<aside class="bh-scale" aria-label="Axial slice depth">
  <span class="bh-label">Axial</span>
  <div class="bh-ticks" data-ticks role="slider" aria-valuemin="1" aria-valuenow="1" tabindex="0">
    <div class="bh-handle" data-handle></div>
    <div class="bh-readout" data-readout>—</div>
  </div>
  <button class="bh-reset" data-reset type="button">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a5 5 0 1 0 1.5-3.6"/><path d="M3 3v3h3"/></svg>Reset
  </button>
</aside>
<div class="bh-loader" data-loader>LOADING SCAN</div>`;

/* ------------------------------------------------------------------ shaders */
const ptVert = /* glsl */`
  attribute float aVal, aDeep;
  uniform float uSize, uClipZ, uPixelRatio, uTime, uSpin, uSpinEnergy, uSliceEnergy, uSliceVel, uSizeZ;
  uniform float uAssemble, uFocusDepth, uPointerStrength, uAspect;
  uniform vec2 uPointer;
  varying float vAlpha, vDeep;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  void main() {
    vec3 p = position;
    float h = hash(position);
    float clipped = step(uClipZ, p.z);
    // intro: fly in from a random direction
    vec3 scatter = normalize(vec3(hash(position.yzx), hash(position.zxy), h) - 0.5 + 1e-4);
    p += scatter * (0.18 + 0.45 * h) * uAssemble * uAssemble;
    // rotation: tangential smear + shimmer
    p += normalize(vec3(-p.y, p.x, 0.0) + 1e-4) * (0.25 + 0.75 * h) * uSpin * 0.09;
    vec3 n = vec3(sin(p.x * 27.3 + p.z * 15.9 + uTime * 2.1 + h), sin(p.y * 24.9 + p.x * 14.1 - uTime * 1.7 + h), sin(p.z * 23.7 + p.y * 18.3 + uTime * 2.6 + h));
    p += n * (0.006 + 0.012 * h) * uSpinEnergy;
    // slice: band near the cut lights up, points just below it scatter with the motion
    float dz = (uClipZ - p.z) / (0.035 * uSizeZ);
    float band = exp(-dz * dz) * (1.0 - clipped) * step(uClipZ, 9.0);
    float kick = band * uSliceEnergy;
    p.xy += n.xy * 0.02 * kick;
    p.z  -= (0.012 + 0.02 * h) * kick * sign(uSliceVel + 1e-4);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // pointer ripple in screen space
    vec2 dp = (gl_Position.xy / gl_Position.w - uPointer) * vec2(uAspect, 1.0);
    float rip = smoothstep(0.24, 0.0, length(dp)) * uPointerStrength;
    gl_Position.xy += normalize(dp + 1e-5) * rip * 0.03 * gl_Position.w * (0.4 + h);
    // depth: far side fades and shrinks
    float depth = -mv.z - uFocusDepth;
    float far = clamp(depth / 0.9, 0.0, 1.0), near = clamp(-depth / 0.9, 0.0, 1.0);
    float fog = 1.0 - 0.55 * far + 0.12 * near;

    float flicker = 0.75 + 0.25 * sin(uTime * (6.0 + 8.0 * h) + h * 6.283);
    float excite = 1.0 + uSpinEnergy * (0.245 + 0.455 * flicker) + kick * 1.6 + band * 0.45 + rip * 0.6;
    vAlpha = (0.45 + 0.55 * aVal) * excite * fog * (1.0 - clipped) * (1.0 - 0.92 * uAssemble);
    vDeep = aDeep;
    gl_PointSize = uSize * uPixelRatio * (0.8 + 0.5 * aVal) * (1.0 + 0.245 * uSpinEnergy + 0.6 * kick + 0.3 * rip) * (1.0 - 0.3 * far) / -mv.z * (1.0 - clipped);
  }`;
const ptFrag = /* glsl */`
  precision mediump float;
  uniform vec3 uColor, uColorDeep; uniform float uOpacity;
  varying float vAlpha, vDeep;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r = dot(q, q) * 4.0;
    if (r > 1.0) discard;
    float a = (1.0 - smoothstep(0.15, 1.0, r)) * vAlpha * uOpacity;
    gl_FragColor = vec4(mix(uColor, uColorDeep, vDeep) * a, a);
  }`;
const capVert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const capFrag = /* glsl */`
  precision mediump float;
  uniform sampler2D uSlice; uniform vec3 uTint, uDark; uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float d = texture2D(uSlice, vUv).r;
    float a = smoothstep(0.08, 0.26, d) * uOpacity;
    if (a < 0.02) discard;
    gl_FragColor = vec4(mix(uDark, uTint, 0.22 + 0.78 * smoothstep(0.10, 0.82, d)), a);
  }`;

/* ------------------------------------------------------------------ data */
async function loadVolume(dataUrl) {
  const meta = await (await fetch(dataUrl + 'brain_meta.json')).json();
  const [X, Y, Z] = meta.dims, [cols] = meta.tiles;
  const img = new Image();
  img.src = dataUrl + 'brain_atlas.webp';
  try { await img.decode(); } catch { img.src = dataUrl + 'brain_atlas.png'; await img.decode(); }
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const data = new Uint8Array(X * Y * Z);
  for (let z = 0; z < Z; z++) {
    const tr = Math.floor(z / cols), tc = z % cols;
    for (let row = 0; row < Y; row++) {
      const src = ((tr * Y + row) * c.width + tc * X) * 4, dst = z * X * Y + (Y - 1 - row) * X;
      for (let x = 0; x < X; x++) { const v = px[src + x * 4]; data[dst + x] = v < 7 ? 0 : v; }
    }
  }
  return { data, dims: [X, Y, Z], landmarks: meta.landmarks };
}

/* volume -> hologram points; probability follows the intensity gradient, aDeep = distance from the outer surface */
function buildPoints(d, [X, Y, Z], size, budget) {
  const at = (x, y, z) => d[z * X * Y + y * X + x] / 255;
  let seed = 1337; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const W = new Float32Array(X * Y * Z); let wsum = 0;
  for (let z = 1; z < Z - 1; z++) for (let y = 1; y < Y - 1; y++) for (let x = 1; x < X - 1; x++) {
    const v = at(x, y, z);
    const gx = at(x + 1, y, z) - at(x - 1, y, z), gy = at(x, y + 1, z) - at(x, y - 1, z), gz = at(x, y, z + 1) - at(x, y, z - 1);
    const g = Math.sqrt(gx * gx + gy * gy + gz * gz) * 0.5;
    if (v < 0.12 && g < 0.06) continue;
    const edge = Math.min(Math.max((g - 0.05) / 0.28, 0), 1);
    const w = edge * edge * (v > 0.2 ? 1 : 0.5) + (v > 0.3 ? 0.012 : 0);
    if (w > 0) { W[z * X * Y + y * X + x] = w; wsum += w; }
  }
  const k = budget / wsum, R = 7;
  const deepness = (x, y, z) => {
    let best = R;
    for (let i = 1; i <= R && i < best; i++) {
      if (x - i < 0 || x + i >= X || y - i < 0 || y + i >= Y || z - i < 0 || z + i >= Z ||
          at(x - i, y, z) < 0.12 || at(x + i, y, z) < 0.12 || at(x, y - i, z) < 0.12 || at(x, y + i, z) < 0.12 ||
          at(x, y, z - i) < 0.12 || at(x, y, z + i) < 0.12) best = i;
    }
    return Math.min(1, Math.max(0, (best - 2) / (R - 2)));
  };
  const P = [], I = [], D = [];
  for (let z = 1; z < Z - 1; z++) for (let y = 1; y < Y - 1; y++) for (let x = 1; x < X - 1; x++) {
    const w = W[z * X * Y + y * X + x]; if (!w) continue;
    let dp = -1;
    for (let n = w * k; n > 0; n -= 1) if (rnd() < n) {
      if (dp < 0) dp = deepness(x, y, z);
      P.push(((x + rnd()) / X - 0.5) * size.x, ((y + rnd()) / Y - 0.5) * size.y, ((z + rnd()) / Z - 0.5) * size.z);
      I.push(Math.min(1, w * 1.4)); D.push(dp);
    }
  }
  return { pos: new Float32Array(P), val: new Float32Array(I), deep: new Float32Array(D) };
}

function buildDust(n, r) {
  const pos = new Float32Array(n * 3), val = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos.set([(Math.random() - 0.5) * r * 2.6, (Math.random() - 0.5) * r * 2, (Math.random() - 0.5) * r * 2.6], i * 3);
    val[i] = Math.random();
  }
  return { pos, val, deep: new Float32Array(n) };
}

/* ------------------------------------------------------------------ vasculature
   Template in fractions of a typical brain bbox (x left-/right+, y post-/ant+, z inf-/sup+), warped piecewise-
   linearly so its circle of Willis, width, top/bottom and front/back land on the landmarks of this scan. */
const T = { cow: [0, 0.07, -0.115], half: 0.4, top: 0.45, bottom: -0.5, front: 0.45, back: -0.46 };
function makeWarp(lm) {
  if (!lm) return (x, y, z) => [x, y, z];
  const [cx, cy, cz] = lm.cow;
  const sx = THREE.MathUtils.clamp(lm.halfWidthAtCow / T.half, 0.8, 1.25);
  const zUp = (lm.top - cz) / (T.top - T.cow[2]), zDn = (cz - lm.bottom) / (T.cow[2] - T.bottom);
  const yFw = (lm.front - cy) / (T.front - T.cow[1]), yBk = (cy - lm.back) / (T.cow[1] - T.back);
  return (x, y, z) => [cx + x * sx, cy + (y - T.cow[1]) * (y >= T.cow[1] ? yFw : yBk), cz + (z - T.cow[2]) * (z >= T.cow[2] ? zUp : zDn)];
}
function buildVasculature(size, planes, lm, pulse) {
  const g = new THREE.Group(), warp = makeWarp(lm);
  const N = (x, y, z) => { const [a, b, c] = warp(x, y, z); return new THREE.Vector3(a * size.x, b * size.y, c * size.z); };
  const mk = (color, emissive, opacity) => {
    const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.55, roughness: 0.42, transparent: true, opacity, depthWrite: false, clippingPlanes: planes });
    m.onBeforeCompile = sh => {   // blood-flow pulse travelling up the tree
      sh.uniforms.uPulse = pulse;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjPos; uniform float uPulse;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat wv = 0.5 + 0.5 * sin(uPulse * 2.4 - (vObjPos.z + 0.5) * 11.0 - length(vObjPos.xy) * 4.0);\ntotalEmissiveRadiance *= 0.7 + 0.7 * wv * wv;');
    };
    return m;
  };
  const art = mk(C.vessel, C.vesselEmis, C.artOpacity), vein = mk(C.vein, C.veinEmis, C.veinOpacity);
  const tube = (pts, r, mat, seg = 48) => g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => N(...p)), false, 'centripetal', 0.6), seg, r, 7, false), mat));
  const both = (pts, r, mat, seg) => { tube(pts, r, mat, seg); tube(pts.map(([x, y, z]) => [-x, y, z]), r, mat, seg); };
  const R = { ica: 0.0068, mca: 0.0052, br: 0.0032, aca: 0.0044, pca: 0.0044, bas: 0.0062, vert: 0.0048, tr: 0.0062, ss: 0.0052, com: 0.0024 };
  // posterior circulation
  both([[0.05, -0.08, -0.5], [0.045, -0.07, -0.42], [0.03, -0.06, -0.34], [0.012, -0.05, -0.27]], R.vert, art);
  tube([[0, -0.05, -0.27], [0, -0.04, -0.2], [0, -0.03, -0.14], [0, -0.02, -0.105]], R.bas, art, 24);
  both([[0, -0.02, -0.105], [0.05, -0.03, -0.1], [0.11, -0.07, -0.095], [0.15, -0.14, -0.085], [0.17, -0.24, -0.07], [0.17, -0.34, -0.05], [0.14, -0.43, -0.02]], R.pca, art);
  both([[0.15, -0.14, -0.085], [0.22, -0.18, -0.11], [0.27, -0.26, -0.12]], R.br, art, 24);
  // anterior circulation
  both([[0.11, 0.07, -0.5], [0.11, 0.06, -0.38], [0.10, 0.10, -0.28], [0.095, 0.16, -0.22], [0.10, 0.12, -0.16], [0.11, 0.07, -0.115]], R.ica, art);
  both([[0.11, 0.07, -0.115], [0.18, 0.06, -0.11], [0.25, 0.05, -0.1], [0.31, 0.05, -0.085], [0.35, 0.02, -0.07]], R.mca, art, 32);
  for (const b of [
    [[0.31, 0.05, -0.085], [0.35, 0.10, 0.0], [0.35, 0.13, 0.10], [0.31, 0.11, 0.2], [0.24, 0.08, 0.29]],
    [[0.33, 0.03, -0.08], [0.37, -0.03, 0.02], [0.36, -0.09, 0.12], [0.31, -0.15, 0.22], [0.24, -0.2, 0.29]],
    [[0.35, 0.02, -0.07], [0.38, -0.08, -0.05], [0.37, -0.18, -0.02], [0.33, -0.28, 0.02], [0.27, -0.36, 0.06]],
    [[0.30, 0.05, -0.085], [0.32, 0.16, -0.06], [0.30, 0.26, -0.02], [0.25, 0.34, 0.04]],
  ]) both(b, R.br, art, 32);
  both([[0.11, 0.07, -0.115], [0.06, 0.12, -0.11], [0.02, 0.17, -0.1], [0.012, 0.28, -0.07], [0.012, 0.38, -0.01], [0.012, 0.42, 0.08], [0.012, 0.38, 0.17], [0.012, 0.25, 0.23], [0.012, 0.05, 0.25], [0.012, -0.15, 0.23]], R.aca, art, 64);
  both([[0.012, 0.38, 0.17], [0.03, 0.34, 0.28], [0.05, 0.25, 0.36]], R.br, art, 20);
  both([[0.012, 0.05, 0.25], [0.03, -0.02, 0.34], [0.05, -0.12, 0.38]], R.br, art, 20);
  tube([[0.02, 0.17, -0.1], [0, 0.175, -0.1], [-0.02, 0.17, -0.1]], R.com, art, 8);
  both([[0.11, 0.07, -0.115], [0.10, 0.0, -0.11], [0.08, -0.05, -0.1]], R.com, art, 12);
  // deep / posterior venous sinuses
  tube([[0, 0.02, 0.05], [0, -0.12, 0.06], [0, -0.28, 0.03], [0, -0.46, -0.03]], R.ss, vein, 24);
  both([[0, -0.46, -0.03], [0.14, -0.44, -0.05], [0.27, -0.38, -0.08], [0.34, -0.28, -0.12], [0.33, -0.18, -0.2], [0.27, -0.1, -0.3], [0.2, -0.05, -0.42]], R.tr, vein, 40);
  return g;
}

/* ------------------------------------------------------------------ mount */
export function mountBrainHero(root, opts = {}) {
  const dataUrl = opts.dataUrl ?? 'data/';
  if (!document.querySelector('style[data-brain-hero]')) {
    const st = document.createElement('style'); st.dataset.brainHero = ''; st.textContent = CSS; document.head.appendChild(st);
  }
  root.classList.add('bh'); root.innerHTML = HTML;
  const q = s => root.querySelector(s);
  const el = { stage: q('[data-stage]'), loader: q('[data-loader]'), ticks: q('[data-ticks]'), handle: q('[data-handle]'), readout: q('[data-readout]'), reset: q('[data-reset]') };
  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!document.createElement('canvas').getContext('webgl2')) {
    el.loader.remove();
    el.stage.innerHTML = `<img src="${dataUrl}poster.png" alt="Hologram render of an MRI brain">`;
    return { setSlice() {}, reset() {}, destroy() { root.innerHTML = ''; root.classList.remove('bh'); } };
  }

  /* scene */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(C.clear, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  el.stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  const rig = new THREE.Group(), tilt = new THREE.Group();
  scene.add(tilt); tilt.add(rig);
  scene.add(new THREE.HemisphereLight(C.hemi[0], C.hemi[1], 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-1.2, 1.6, 2.2); scene.add(key);
  const fill = new THREE.DirectionalLight(C.fill, 0.5); fill.position.set(1.5, -0.4, -1); scene.add(fill);

  const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10), growPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10);
  const fx = { uTime: { value: 0 }, uSpin: { value: 0 }, uSpinEnergy: { value: 0 }, uSliceEnergy: { value: 0 }, uSliceVel: { value: 0 }, uSizeZ: { value: 1 },
               uAssemble: { value: 1 }, uFocusDepth: { value: 3.3 }, uPointerStrength: { value: 0 }, uAspect: { value: 1 }, uPointer: { value: new THREE.Vector2() } };
  const pulse = { value: 0 };
  const layers = [];          // point-layer uniforms that follow the slice clip
  let dims, size, cap, capTex, capData, volData, capZ = -1, dust, raf = 0, destroyed = false;

  const S = {
    yaw: 0, pitch: 0.21, targetPitch: 0.21, vel: 0, dragging: false, lastX: 0, lastY: 0, lastT: 0, auto: prefersReduced ? 0 : 0.14, idle: 0, prevYaw: 0, spinEnergy: 0,
    slice: 1, sliceTarget: 1, sliceFloat: 1, count: 1, navVel: 0, navDrag: false, navLastT: 0, prevSlice: 1, sliceEnergy: 0,
    intro: 0, pointerOn: 0, pointerIdle: 9,
  };

  async function init() {
    const vol = await loadVolume(dataUrl);
    dims = vol.dims; volData = vol.data;
    const longest = Math.max(...dims);
    size = new THREE.Vector3(dims[0] / longest, dims[1] / longest, dims[2] / longest);
    fx.uSizeZ.value = size.z;

    const frame = new THREE.Group();
    frame.rotation.set(-Math.PI / 2, Math.PI, 0, 'YXZ');   // superior -> +y, anterior -> +z
    rig.add(frame);

    const points = (pts, color, deepColor, sz, opacity, order, clipped = true) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pts.pos, 3));
      g.setAttribute('aVal', new THREE.BufferAttribute(pts.val, 1));
      g.setAttribute('aDeep', new THREE.BufferAttribute(pts.deep, 1));
      const u = { ...fx, uSize: { value: sz }, uClipZ: { value: 10 }, uPixelRatio: { value: renderer.getPixelRatio() * (renderer._bhK || 1) },
                  uColor: { value: new THREE.Color(color) }, uColorDeep: { value: new THREE.Color(deepColor) }, uOpacity: { value: opacity * (renderer._bhG ?? 1) }, _o: opacity };
      const m = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: ptVert, fragmentShader: ptFrag, uniforms: u, transparent: true, depthWrite: false, depthTest: clipped, blending: THREE.AdditiveBlending }));
      m.renderOrder = order; if (clipped) layers.push(u); return m;
    };
    const pts = buildPoints(vol.data, dims, size, opts.points ?? 110000);
    frame.add(points(pts, C.dots, C.deep, 4.0, C.dotsOpacity, 3));
    const gn = Math.floor(pts.pos.length / 9), gl = { pos: new Float32Array(gn * 3), val: new Float32Array(gn), deep: new Float32Array(gn) };
    for (let i = 0; i < gn; i++) { gl.pos.set(pts.pos.subarray(i * 9, i * 9 + 3), i * 3); gl.val[i] = pts.val[i * 3]; }
    frame.add(points(gl, C.glow, C.glow, 24, C.glowOpacity, 2));            // soft glow: every 3rd point as a big faint sprite
    dust = points(buildDust(160, 1.6), C.dust, C.dust, 5.5, 0.35, 1, false);
    scene.add(dust);

    frame.add(buildVasculature(size, [cutPlane, growPlane], vol.landmarks, pulse));

    capData = new Uint8Array(dims[0] * dims[1]);
    capTex = new THREE.DataTexture(capData, dims[0], dims[1], THREE.RedFormat, THREE.UnsignedByteType);
    capTex.minFilter = capTex.magFilter = THREE.LinearFilter; capTex.unpackAlignment = 1;
    cap = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y), new THREE.ShaderMaterial({
      vertexShader: capVert, fragmentShader: capFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uSlice: { value: capTex }, uTint: { value: new THREE.Color(C.cap) }, uDark: { value: new THREE.Vector3(...C.capDark) }, uOpacity: { value: C.capOpacity } },
    }));
    cap.renderOrder = 4; cap.visible = false; frame.add(cap);

    S.count = Math.round(dims[2] / 2);
    S.slice = S.sliceTarget = S.sliceFloat = S.prevSlice = S.count;
    buildTicks(); updateNav(); resize();
    el.loader.classList.add('hide');
    raf = requestAnimationFrame(tick);
  }

  /* layout: brain centred, CSS vars --brain-offset-x/-y shift it */
  function resize() {
    const w = el.stage.clientWidth, h = el.stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix(); fx.uAspect.value = w / h;
    const cs = getComputedStyle(root);
    // --brain-fit (0..1): fit the brain's bounding sphere to that share of the container's shorter side
    const fit = parseFloat(cs.getPropertyValue('--brain-fit'));
    camera.position.set(0, 0, fit > 0 ? 0.75 / (Math.tan(Math.PI / 12) * Math.min(1, w / h)) / fit : (h > w ? 5.2 : 3.3)); camera.lookAt(0, 0, 0);
    tilt.position.set(parseFloat(cs.getPropertyValue('--brain-offset-x')) || 0, parseFloat(cs.getPropertyValue('--brain-offset-y')) || 0, 0);
    // points have a fixed pixel size, so a small canvas packs them densely and the additive blend burns to white:
    // shrink them with the canvas (reference 720px), and let --brain-glow (0..1) dim the dots and glow
    renderer._bhK = Math.min(1, Math.max(0.35, Math.min(w, h) / 720));
    const glow = parseFloat(cs.getPropertyValue('--brain-glow')); renderer._bhG = glow >= 0 ? glow : 1;
    for (const u of layers) { u.uPixelRatio.value = renderer.getPixelRatio() * renderer._bhK; if (u._o != null) u.uOpacity.value = u._o * renderer._bhG; }
  }
  const ro = new ResizeObserver(resize); ro.observe(el.stage);

  /* drag to rotate + pointer ripple */
  const K = 0.0075;
  const setPointer = e => {
    const r = el.stage.getBoundingClientRect();
    fx.uPointer.value.set(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
    S.pointerOn = 1; S.pointerIdle = 0;
  };
  const onDown = e => { S.dragging = true; el.stage.classList.add('dragging'); el.stage.setPointerCapture(e.pointerId); S.lastX = e.clientX; S.lastY = e.clientY; S.lastT = performance.now(); S.vel = 0; setPointer(e); };
  const onMove = e => {
    setPointer(e);
    if (!S.dragging) return;
    const dx = e.clientX - S.lastX, dy = e.clientY - S.lastY, now = performance.now(), dt = Math.max(now - S.lastT, 1) / 1000;
    S.yaw += dx * K; S.targetPitch = THREE.MathUtils.clamp(S.targetPitch + dy * K * 0.6, -1.2, 1.2); S.vel = dx * K / dt;
    S.lastX = e.clientX; S.lastY = e.clientY; S.lastT = now;
  };
  const onUp = () => { if (S.dragging) { S.dragging = false; el.stage.classList.remove('dragging'); S.idle = 0; } };
  const onLeave = () => { S.pointerOn = 0; };
  const onKey = e => { if (e.key === 'ArrowLeft') S.yaw -= 0.15; if (e.key === 'ArrowRight') S.yaw += 0.15; };
  el.stage.addEventListener('pointerdown', onDown); el.stage.addEventListener('pointermove', onMove);
  el.stage.addEventListener('pointerup', onUp); el.stage.addEventListener('pointercancel', onUp);
  el.stage.addEventListener('pointerleave', onLeave); el.stage.addEventListener('keydown', onKey);

  /* slice scale: drag with inertia, snap to major ticks, wheel, keys, optional scroll-link */
  function buildTicks() {
    for (let i = 0; i < S.count; i++) {
      const t = document.createElement('div');
      t.className = 'bh-tick' + (i % 5 === 0 ? ' major' : ''); t.style.top = `${(1 - i / (S.count - 1)) * 100}%`; t.dataset.i = i;
      el.ticks.appendChild(t);
    }
    el.ticks.setAttribute('aria-valuemax', S.count);
  }
  const setSliceFloat = v => { S.sliceFloat = THREE.MathUtils.clamp(v, 1, S.count); S.sliceTarget = Math.round(S.sliceFloat); };
  const sliceFromY = y => { const r = el.ticks.getBoundingClientRect(); return 1 + THREE.MathUtils.clamp(1 - (y - r.top) / r.height, 0, 1) * (S.count - 1); };
  const navDown = e => { S.navDrag = true; el.ticks.setPointerCapture(e.pointerId); S.navVel = 0; setSliceFloat(sliceFromY(e.clientY)); S.navLastT = performance.now(); };
  const navMove = e => {
    if (!S.navDrag) return;
    const now = performance.now(), dt = Math.max(now - S.navLastT, 1) / 1000, prev = S.sliceFloat;
    setSliceFloat(sliceFromY(e.clientY));
    S.navVel = THREE.MathUtils.clamp(S.navVel * 0.5 + (S.sliceFloat - prev) / dt * 0.5, -40, 40); S.navLastT = now;
  };
  const navUp = () => { S.navDrag = false; if (performance.now() - S.navLastT > 120) S.navVel = 0; };
  const navWheel = e => { e.preventDefault(); S.navVel = 0; setSliceFloat(S.sliceTarget - Math.sign(e.deltaY)); };
  const navKey = e => { if (e.key === 'ArrowUp') setSliceFloat(S.sliceTarget + 1); if (e.key === 'ArrowDown') setSliceFloat(S.sliceTarget - 1); };
  const reset = () => { S.navVel = 0; setSliceFloat(S.count); S.targetPitch = 0.21; };
  el.ticks.addEventListener('pointerdown', navDown); el.ticks.addEventListener('pointermove', navMove);
  el.ticks.addEventListener('pointerup', navUp); el.ticks.addEventListener('pointercancel', navUp);
  el.ticks.addEventListener('wheel', navWheel, { passive: false }); el.ticks.addEventListener('keydown', navKey);
  el.reset.addEventListener('click', reset);

  let scrollP = 0;
  const onScroll = () => {
    const drv = opts.scrollDriver; if (!drv || !dims) return;
    const range = drv.offsetHeight - root.offsetHeight; if (range <= 0) return;
    const p = THREE.MathUtils.clamp(-drv.getBoundingClientRect().top / range, 0, 1);
    if (Math.abs(p - scrollP) < 1e-4) return;
    scrollP = p; S.navVel = 0; setSliceFloat(S.count - p * (S.count - 1));
    root.dispatchEvent(new CustomEvent('brainhero:scroll', { detail: { progress: p } }));
  };
  if (opts.scrollDriver) addEventListener('scroll', onScroll, { passive: true });

  let tickEls = null, lastIdx = -1;
  function updateNav() {
    const i = Math.round(S.slice) - 1; if (i === lastIdx) return; lastIdx = i;
    tickEls ??= Array.from(el.ticks.querySelectorAll('.bh-tick'));
    const pct = `${(1 - i / (S.count - 1)) * 100}%`;
    el.handle.style.top = pct; el.readout.style.top = pct;
    el.readout.innerHTML = `${i + 1}<small>/${S.count}</small>`; el.ticks.setAttribute('aria-valuenow', i + 1);
    for (const t of tickEls) { const k = +t.dataset.i; t.classList.toggle('near', Math.abs(k - i) <= 1 && k !== i); t.classList.toggle('above', k > i); }
  }
  const up = new THREE.Vector3(), pt = new THREE.Vector3();
  function updateCap(f) {
    if (f >= 0.999) { cap.visible = false; capZ = -1; cutPlane.constant = 10; return; }
    const [X, Y, Z] = dims, zf = 0.03 + f * 0.97, z = Math.min(Z - 1, Math.max(0, Math.round(zf * Z - 0.5)));
    cap.visible = true; cap.position.z = (zf - 0.5) * size.z - 0.0015;
    cap.updateWorldMatrix(true, false);
    cutPlane.setFromNormalAndCoplanarPoint(up.set(0, 0, 1).transformDirection(cap.matrixWorld).negate(), pt.setFromMatrixPosition(cap.matrixWorld));
    if (z !== capZ) { capData.set(volData.subarray(z * X * Y, (z + 1) * X * Y)); capTex.needsUpdate = true; capZ = z; }
  }

  /* loop */
  let last = performance.now();
  const easeOut = t => 1 - (1 - t) ** 3;
  const ease = (cur, target, dt, upK, downK) => cur + (target - cur) * Math.min(1, dt * (target > cur ? upK : downK));
  function tick(now) {
    if (destroyed) return;
    const dt = Math.min((now - last) / 1000, 0.05); last = now;

    if (S.intro < 3) {                                            // intro: points assemble, vessels grow
      S.intro += dt;
      fx.uAssemble.value = prefersReduced ? 0 : 1 - easeOut(THREE.MathUtils.clamp(S.intro / 1.6, 0, 1));
      growPlane.constant = -0.7 + (prefersReduced ? 1 : easeOut(THREE.MathUtils.clamp((S.intro - 0.35) / 2, 0, 1))) * 1.5;
    }
    if (!S.dragging) {                                            // inertia -> slow auto rotation
      S.idle += dt; S.vel *= Math.exp(-dt * 3.2);
      S.yaw += (S.vel + THREE.MathUtils.smoothstep(S.idle, 0.4, 2) * S.auto) * dt;
    }
    S.pitch += (S.targetPitch - S.pitch) * Math.min(1, dt * 6);
    rig.rotation.y = S.yaw; tilt.rotation.x = S.pitch;

    const extra = (S.yaw - S.prevYaw) / dt - (S.dragging ? 0 : S.auto); S.prevYaw = S.yaw;
    S.spinEnergy = ease(S.spinEnergy, Math.min(1, Math.abs(extra) / 2.2), dt, 9, 1.1);
    fx.uSpinEnergy.value = THREE.MathUtils.smoothstep(S.spinEnergy, 0, 1);
    fx.uSpin.value = ease(fx.uSpin.value, THREE.MathUtils.clamp(extra / 3, -1, 1), dt, 8, 2.5);
    fx.uTime.value += dt; pulse.value += dt;
    S.pointerIdle += dt;
    fx.uPointerStrength.value = ease(fx.uPointerStrength.value, S.pointerOn * (S.pointerIdle < 0.5 ? 1 : 0), dt, 10, 1.6);
    fx.uFocusDepth.value = camera.position.distanceTo(tilt.position) * Math.cos(S.pitch * 0.3);

    if (!S.navDrag && Math.abs(S.navVel) > 0.01) {                // scale inertia + snap to major ticks
      S.sliceFloat = THREE.MathUtils.clamp(S.sliceFloat + S.navVel * dt, 1, S.count);
      S.navVel *= Math.exp(-dt * 5);
      if (Math.abs(S.navVel) < 2.5) {
        S.navVel = 0;
        const i = S.sliceFloat - 1, major = Math.round(i / 5) * 5;
        S.sliceFloat = Math.abs(major - i) < 1.2 && major < S.count ? major + 1 : Math.round(S.sliceFloat);
      }
      S.sliceTarget = Math.round(S.sliceFloat);
    }
    S.slice += (S.sliceTarget - S.slice) * Math.min(1, dt * 10);
    if (Math.abs(S.sliceTarget - S.slice) < 0.002) S.slice = S.sliceTarget;
    const sv = (S.slice - S.prevSlice) / dt; S.prevSlice = S.slice;
    S.sliceEnergy = ease(S.sliceEnergy, Math.min(1, Math.abs(sv) / 25), dt, 10, 1.3);
    fx.uSliceEnergy.value = THREE.MathUtils.smoothstep(S.sliceEnergy, 0, 1); fx.uSliceVel.value = sv;
    const f = (S.slice - 1) / (S.count - 1), clipZ = f >= 0.999 ? 10 : (-0.47 + f * 0.97) * size.z;
    for (const u of layers) u.uClipZ.value = clipZ;
    updateCap(f); updateNav();

    dust.rotation.y += dt * 0.02; dust.position.copy(tilt.position);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }

  init().catch(err => { console.error(err); el.loader.textContent = 'FAILED TO LOAD THE SCAN'; });

  return {
    setSlice: n => setSliceFloat(n),
    reset,
    destroy() {
      destroyed = true; cancelAnimationFrame(raf); ro.disconnect(); removeEventListener('scroll', onScroll);
      renderer.dispose(); root.innerHTML = ''; root.classList.remove('bh');
    },
  };
}
