/*
 * brain-hero — a real MRI volume as a mint hologram point cloud with procedural vasculature
 * and a vertical axial-slice scale. Self-contained: injects its own markup and CSS.
 *
 *   import { mountBrainHero } from './dist/brain-hero.js';
 *   const hero = mountBrainHero(document.querySelector('#brain'), { dataUrl: '/data/' });
 *   hero.setSlice(20); hero.reset(); hero.setPaused(true); hero.getView(); hero.setView(v); hero.resetZoom(); hero.destroy();
 *
 * CSS vars on the container: --brain-fit, --brain-offset-x/-y, --brain-glow, --brain-dot (dot size ×), --brain-dpr (pixel-ratio cap),
 *   --brain-zoom (max pinch zoom, >1 enables pinch + double tap), --brain-follow (0..1 turn to look at the mouse), --brain-drag, --brain-spin
 *
 * Options
 *   dataUrl       folder with brain_atlas.webp|png, brain_meta.json, poster.png   (default 'data/')
 *   points        number of dots                                                  (default 400000)
 *   scrollDriver  element whose scroll progress drives the slice (optional);
 *                 the container emits 'brainhero:scroll' with { progress } as it moves
 *
 * Layout: the container is filled by the canvas; the scale sits at its left edge. The brain is centred,
 * shift it with CSS custom properties on the container: --brain-offset-x / --brain-offset-y (world units,
 * roughly -1..1), e.g. inside a media query.
 */
import * as THREE from 'three';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';

/* ------------------------------------------------------------------ look */
const C = {   // mint theme, base #3DF5B8
  gm: '#a6f7d6', wm: '#1c9f78', dust: '#a8f7dc',   // grey matter (cortex) light, white matter deeper
  vessel: 0xdafff2, vesselEmis: 0x3df5b8, vein: 0x8fe0d6, veinEmis: 0x1fb39a, shell: '#bff8e4',
  cap: '#c4f2e0', capDark: [0.004, 0.02, 0.016], hemi: [0xe6fff6, 0x062a1e], fill: 0x3df5b8, clear: 0x050807,
  dotsOpacity: 0.3, dotSize: 3.2, exposure: 2.6, artOpacity: 0.16, veinOpacity: 0.12, capOpacity: 0.75, shellOpacity: 1,
  key: [-0.45, 0.62, 0.64], fillDir: [0.7, -0.35, 0.3],   // view-space light directions for the dots and the glass
};

const CSS = /* css */`
.bh{position:relative;width:100%;height:100%;overflow:hidden;--bh-fg:#f2f2f0;--bh-fg-2:rgba(242,242,240,.62);--bh-fg-3:rgba(242,242,240,.34);--bh-line:rgba(255,255,255,.10);--bh-pill:rgba(20,20,24,.72);--bh-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;--bh-gutter:clamp(16px,3vw,40px)}
.bh-stage{position:absolute;inset:0;touch-action:none;cursor:grab;outline:none}
.bh-stage.dragging{cursor:grabbing}
.bh-stage canvas{display:block;width:100%;height:100%;opacity:0;transition:opacity 1.4s cubic-bezier(.3,0,.2,1)}
.bh-stage.bh-in canvas{opacity:1}
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
// Dots: small soft sprites, coloured by tissue (grey/white matter) and lit by a key light + rim on the surface normal taken
// from the volume gradient (uLit 0 = the background dust, unlit). They add up in a float buffer, and a tone-map pass turns
// that sum into colour with a soft shoulder: dense folds read brighter without burning out to white.
const ptVert = /* glsl */`
  attribute float aVal, aTissue;
  attribute vec3 aNormal;
  uniform float uSize, uClipZ, uPixelRatio, uTime, uSpin, uSpinEnergy, uSliceEnergy, uSliceVel, uSizeZ;
  uniform float uAssemble, uFocusDepth, uPointerStrength, uAspect, uLit, uOpacity;
  uniform vec2 uPointer;
  uniform vec3 uColor, uColorDeep, uKey, uFill;
  varying vec3 vColor;
  varying float vAlpha;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  void main() {
    vec3 p = position;
    float h = hash(position);
    float clipped = step(uClipZ, p.z);
    // intro: fly in from a random direction
    vec3 scatter = normalize(vec3(hash(position.yzx), hash(position.zxy), h) - 0.5 + 1e-4);
    p += scatter * (0.18 + 0.45 * h) * uAssemble * uAssemble;
    // rotation: tangential smear + shimmer
    p += normalize(vec3(-p.y, p.x, 0.0) + 1e-4) * (0.25 + 0.75 * h) * uSpin * 0.06;
    vec3 n = vec3(sin(p.x * 27.3 + p.z * 15.9 + uTime * 2.1 + h), sin(p.y * 24.9 + p.x * 14.1 - uTime * 1.7 + h), sin(p.z * 23.7 + p.y * 18.3 + uTime * 2.6 + h));
    p += n * (0.004 + 0.008 * h) * uSpinEnergy;
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
    // depth: the far half darkens and shrinks
    float depth = -mv.z - uFocusDepth;
    float far = clamp(depth / 0.55, 0.0, 1.0), near = clamp(-depth / 0.55, 0.0, 1.0);
    float fog = 1.0 - 0.72 * far + 0.08 * near;
    // relief: Lambert key + soft fill + rim, on the normal from the volume gradient (aVal = how sure that normal is)
    vec3 nv = normalize(normalMatrix * aNormal + 1e-5), vd = normalize(-mv.xyz);
    float facing = dot(nv, vd);
    float shade = 0.2 + 0.95 * max(dot(nv, uKey), 0.0) + 0.18 * max(dot(nv, uFill), 0.0) + 0.25 * pow(1.0 - abs(facing), 2.5);
    shade *= mix(0.5, 1.0, smoothstep(-0.4, 0.2, facing));   // the inner side of a fold, seen through a gap, stays dim
    float lit = mix(1.0, mix(0.72, shade, aVal), uLit);

    float flicker = 0.75 + 0.25 * sin(uTime * (6.0 + 8.0 * h) + h * 6.283);
    float excite = 1.0 + uSpinEnergy * (0.12 + 0.25 * flicker) + kick * 0.9 + band * 0.35 + rip * 0.4;
    vColor = mix(uColorDeep, uColor, aTissue) * lit * fog * excite;
    vAlpha = (0.45 + 0.55 * aVal) * uOpacity * (1.0 - clipped) * (1.0 - 0.92 * uAssemble);
    gl_PointSize = max(1.0, uSize * uPixelRatio * (0.8 + 0.4 * aVal) * (1.0 + 0.15 * uSpinEnergy + 0.5 * kick + 0.25 * rip) * (1.0 - 0.25 * far) / -mv.z) * (1.0 - clipped);
  }`;
const ptFrag = /* glsl */`
  precision mediump float;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r = dot(q, q) * 4.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(vColor, (1.0 - smoothstep(0.15, 1.0, r)) * vAlpha);
  }`;
// Glass shell: the isosurface of the smoothed brain mask, only its near side, lit by fresnel + a specular glint.
// Cut by the slice like the dots; the cut edge glows.
const shellVert = /* glsl */`
  varying vec3 vN, vV;
  varying float vZ;
  void main() {
    vZ = position.z;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalMatrix * normal; vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const shellFrag = /* glsl */`
  precision mediump float;
  uniform vec3 uColor, uKey;
  uniform float uOpacity, uClipZ, uSizeZ;
  varying vec3 vN, vV;
  varying float vZ;
  void main() {
    if (vZ > uClipZ) discard;
    vec3 n = normalize(vN), v = normalize(vV);
    float nv = dot(n, v);
    if (nv < 0.0) discard;                                   // far side: the dots are in front of it anyway
    float fr = pow(1.0 - nv, 3.0);
    float spec = pow(max(dot(n, normalize(uKey + v)), 0.0), 48.0);
    float cz = (uClipZ - vZ) / (0.01 * uSizeZ);
    float cut = exp(-cz * cz) * step(uClipZ, 9.0);
    float a = (0.12 * fr + 0.12 * spec + 0.5 * cut) * uOpacity;
    gl_FragColor = vec4(uColor, a);
  }`;
const capVert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// Slice cap: the axial MRI frame. R = intensity, G = filled brain mask (so the ventricles read black, not see-through).
const capFrag = /* glsl */`
  precision mediump float;
  uniform sampler2D uSlice; uniform vec3 uTint, uDark; uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec2 s = texture2D(uSlice, vUv).rg;
    float a = smoothstep(0.3, 0.7, s.g) * uOpacity;
    if (a < 0.01) discard;
    float g = smoothstep(0.2, 0.94, s.r);
    float rim = 1.0 - smoothstep(0.0, 0.3, abs(s.g - 0.5));   // thin bright outline along the brain edge
    gl_FragColor = vec4(mix(uDark, uTint, g * g * (3.0 - 2.0 * g)) + uTint * rim * 0.35, a);
  }`;

// Tone map of the summed dots: hue kept, brightness 1 - exp(-k * sum), the hottest spots lean to white. Premultiplied out.
const toneVert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const toneFrag = /* glsl */`
  precision mediump float;
  uniform sampler2D uDots; uniform float uExposure;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(uDots, vUv).rgb;
    float l = max(max(c.r, c.g), c.b);
    if (l < 1e-4) discard;
    float t = 1.0 - exp(-uExposure * l);
    gl_FragColor = vec4(mix(c / l * t, vec3(t), 0.35 * t * t * t), t);
  }`;

/* ------------------------------------------------------------------ data */
const cache = new Map();   // dataUrl -> volume, and dataUrl|budget -> points: a second mount (the phone bubble) reuses them
function loadVolume(dataUrl) {
  if (!cache.has(dataUrl)) cache.set(dataUrl, (async () => {
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
    return { data, dims: [X, Y, Z], mm: meta.voxelMm || 1.4, landmarks: meta.landmarks };
  })());
  return cache.get(dataUrl);
}

// 3-tap [1 2 1]/4 blur along one axis (stride st, length len); the two end samples are copied
function blur3(src, dst, st, len) {
  const span = st * len;
  for (let a = 0; a < src.length; a += span) {
    for (let b = 0; b < st; b++) { dst[a + b] = src[a + b]; dst[a + span - st + b] = src[a + span - st + b]; }
    for (let i = a + st, e = a + span - st; i < e; i++) dst[i] = 0.5 * src[i] + 0.25 * (src[i - st] + src[i + st]);
  }
}
const smooth01 = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/* volume -> dots. Probability follows the intensity gradient where the dark side is fluid (the cortex surface, the walls
   of the sulci, the ventricles), strongest in the outer ~14 mm, so the folds of the cortex carry the picture.
   Per dot: aVal = edge strength, aNormal = outward normal (towards darker), aTissue = 1 cortex .. 0 deep.
   Gradients come from a 3-tap blurred copy. */
function buildPoints(d, [X, Y, Z], size, budget, mm, env) {
  const XY = X * Y, N = XY * Z, gs = 1.55 / mm;   // gradient per ~1.5 mm, so the thresholds hold for any voxel size
  let A = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) A[i] = d[i] / 255;
  blur3(A, B, 1, X); blur3(B, A, X, Y); blur3(A, B, XY, Z);
  const W = A; W.fill(0);                         // reuse the buffer for the weights
  let wsum = 0;
  for (let z = 1; z < Z - 1; z++) for (let y = 1; y < Y - 1; y++) {
    let i = z * XY + y * X;
    for (let x = 1; x < X - 1; x++) {
      i++;
      const v = B[i]; if (v < 0.02) continue;
      const gx = B[i + 1] - B[i - 1], gy = B[i + X] - B[i - X], gz = B[i + XY] - B[i - XY];
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz), g = gl * 0.5 * gs;
      if (g < 0.05) continue;
      const e = Math.min((g - 0.05) / 0.28, 1);
      // 2 voxels towards the darker side: fluid there (CSF) marks a real fold, not white-matter noise
      const dx = Math.round(x - 2 * gx / gl), dy = Math.round(y - 2 * gy / gl), dz = Math.round(z - 2 * gz / gl);
      const dark = dx < 0 || dy < 0 || dz < 0 || dx >= X || dy >= Y || dz >= Z ? 0 : B[dz * XY + dy * X + dx];
      const w = e * e * (1 - smooth01(0.25, 0.5, dark)) * Math.min(1, Math.max(0.25, 1.4 - env.depthAt(x, y, z) / 14));
      if (w > 0) { W[i] = w; wsum += w; }
    }
  }
  let seed = 1337; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const k = budget / wsum, cap = Math.ceil(budget * 1.05);
  const pos = new Float32Array(cap * 3), val = new Float32Array(cap), tis = new Float32Array(cap), nrm = new Int8Array(cap * 3);
  let n = 0;
  for (let z = 1; z < Z - 1; z++) for (let y = 1; y < Y - 1; y++) for (let x = 1; x < X - 1; x++) {
    const i = z * XY + y * X + x, w = W[i]; if (!w) continue;
    let m = w * k; if (m <= 0) continue;
    const gx = B[i + 1] - B[i - 1], gy = B[i + X] - B[i - X], gz = B[i + XY] - B[i - XY];
    const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    const e = Math.min(Math.max((gl * 0.5 * gs - 0.05) / 0.28, 0), 1);
    // tissue by depth below the outer surface: the cortex ribbon light, the floors of the sulci and the deep
    // structures darker (MRI intensity alone can't tell grey from white matter here: the scan is brighter at the bottom)
    const t = 1 - smooth01(3, 15, env.depthAt(x, y, z));
    for (; m > 0 && n < cap; m -= 1) if (rnd() < m) {
      pos[n * 3] = ((x + rnd()) / X - 0.5) * size.x; pos[n * 3 + 1] = ((y + rnd()) / Y - 0.5) * size.y; pos[n * 3 + 2] = ((z + rnd()) / Z - 0.5) * size.z;
      nrm[n * 3] = -127 * gx / gl; nrm[n * 3 + 1] = -127 * gy / gl; nrm[n * 3 + 2] = -127 * gz / gl;
      val[n] = e; tis[n] = t; n++;
    }
  }
  return { pos: pos.subarray(0, n * 3), val: val.subarray(0, n), tis: tis.subarray(0, n), nrm: nrm.subarray(0, n * 3) };
}

/* the brain's envelope on a 2 mm grid: filled occupancy (ventricles and other closed holes solid), the depth of each cell
   below the outer surface in mm (chamfer distance), and a smoothed copy of the occupancy for the glass shell */
function envelope(d, [X, Y, Z], mm) {
  const f = Math.max(1, Math.round(2 / mm)), p = 2;                       // block size, padding cells
  const nx = Math.ceil(X / f) + 2 * p, ny = Math.ceil(Y / f) + 2 * p, nz = Math.ceil(Z / f) + 2 * p, nxy = nx * ny, n = nxy * nz;
  let F = new Float32Array(n);
  const cx = new Int32Array(X), inv = 1 / (f * f * f);
  for (let x = 0; x < X; x++) cx[x] = Math.floor(x / f);
  for (let z = 0; z < Z; z++) for (let y = 0; y < Y; y++) {
    const o = z * X * Y + y * X, c = ((Math.floor(z / f) + p) * ny + Math.floor(y / f) + p) * nx + p;
    for (let x = 0; x < X; x++) if (d[o + x] > 30) F[c + cx[x]] += inv;
  }
  // fill: everything the outside can't reach through empty cells becomes solid. The padding keeps the brain off the
  // grid's border, so the border cells are all outside and the walks below never step off the grid.
  const out = new Uint8Array(n), stack = new Int32Array(n), step = [1, -1, nx, -nx, nxy, -nxy];
  let sp = 0;
  for (let i = 0; i < n; i++) {
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / nxy);
    if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) { out[i] = 1; stack[sp++] = i; }
  }
  while (sp) {
    const i = stack[--sp];
    for (let k = 0; k < 6; k++) { const j = i + step[k]; if (j >= 0 && j < n && !out[j] && F[j] < 0.5) { out[j] = 1; stack[sp++] = j; } }
  }
  for (let i = 0; i < n; i++) if (!out[i]) F[i] = Math.max(F[i], 1);
  // depth below the surface: 3D chamfer (1, √2, √3), forward + backward pass
  const D = new Float32Array(n);
  for (let i = 0; i < n; i++) D[i] = out[i] ? 0 : 1e6;
  const no = [], nw = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const o = dz * nxy + dy * nx + dx; if (o < 0) { no.push(o); nw.push(Math.hypot(dx, dy, dz)); }
  }
  for (let i = 0; i < n; i++) if (D[i]) { let m = D[i]; for (let k = 0; k < 13; k++) { const v = D[i + no[k]] + nw[k]; if (v < m) m = v; } D[i] = m; }
  for (let i = n - 1; i >= 0; i--) if (D[i]) { let m = D[i]; for (let k = 0; k < 13; k++) { const v = D[i - no[k]] + nw[k]; if (v < m) m = v; } D[i] = m; }
  for (let i = 0; i < n; i++) D[i] *= f * mm;
  let G = new Float32Array(n);
  for (let pass = 0; pass < 4; pass++) for (const [st, len] of [[1, nx], [nx, ny], [nxy, nz]]) { blur3(F, G, st, len); [F, G] = [G, F]; }
  return { F, D, f, p, nx, ny, nz, depthAt: (x, y, z) => D[((Math.floor(z / f) + p) * ny + Math.floor(y / f) + p) * nx + Math.floor(x / f) + p] };
}

/* glass shell: marching cubes over the smoothed envelope; positions in frame units */
function buildShell(env, [X, Y, Z], size) {
  const { F, f, p, nx, ny, nz } = env;
  const iso = 0.36, P = [], Nn = [];
  const corner = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const edge = [[0, 1], [1, 2], [3, 2], [0, 3], [4, 5], [5, 6], [7, 6], [4, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const nxy = nx * ny, co = corner.map(([a, b, c]) => c * nxy + b * nx + a);
  const toW = (g, ext, len) => (((g - p) * f + f / 2) / len - 0.5) * ext;  // grid coordinate -> frame units
  const gr = (i, k) => k === 0 ? F[i + 1] - F[i - 1] : k === 1 ? F[i + nx] - F[i - nx] : F[i + nxy] - F[i - nxy];
  const ev = new Array(12), v = new Float32Array(8);
  for (let z = 1; z < nz - 2; z++) for (let y = 1; y < ny - 2; y++) for (let x = 1; x < nx - 2; x++) {
    const i0 = z * nxy + y * nx + x;
    let idx = 0;
    for (let c = 0; c < 8; c++) { v[c] = F[i0 + co[c]]; if (v[c] < iso) idx |= 1 << c; }
    const bits = edgeTable[idx]; if (!bits) continue;
    for (let e = 0; e < 12; e++) if (bits & (1 << e)) {
      const [a, b] = edge[e], ca = corner[a], cb = corner[b], t = (iso - v[a]) / (v[b] - v[a] || 1e-6), ia = i0 + co[a], ib = i0 + co[b];
      ev[e] = [x + ca[0] + t * (cb[0] - ca[0]), y + ca[1] + t * (cb[1] - ca[1]), z + ca[2] + t * (cb[2] - ca[2]),
               -(gr(ia, 0) + t * (gr(ib, 0) - gr(ia, 0))), -(gr(ia, 1) + t * (gr(ib, 1) - gr(ia, 1))), -(gr(ia, 2) + t * (gr(ib, 2) - gr(ia, 2)))];
    }
    for (let i = idx * 16; triTable[i] !== -1; i++) {
      const q = ev[triTable[i]];
      P.push(toW(q[0], size.x, X), toW(q[1], size.y, Y), toW(q[2], size.z, Z));
      const l = Math.hypot(q[3], q[4], q[5]) || 1; Nn.push(q[3] / l, q[4] / l, q[5] / l);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(Nn), 3));
  return g;
}

/* the cap's frame: R = intensity, G = brain mask with closed sulci and filled holes (dilate 2, flood the outside, erode 2) */
function capFrame(src, X, Y, out) {
  const n = X * Y, m = new Uint8Array(n), dil = new Uint8Array(n), outside = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = src[i] > 24 ? 1 : 0;
  const R = 2;
  for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) {
    let on = 0;
    for (let dy = -R; dy <= R && !on; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < X && yy < Y && m[yy * X + xx]) { on = 1; break; }
    }
    dil[y * X + x] = on;
  }
  const st = [];
  for (let x = 0; x < X; x++) { st.push(x, (Y - 1) * X + x); }
  for (let y = 0; y < Y; y++) { st.push(y * X, y * X + X - 1); }
  while (st.length) {
    const i = st.pop(); if (outside[i] || dil[i]) continue; outside[i] = 1;
    const x = i % X, y = (i / X) | 0;
    if (x > 0) st.push(i - 1); if (x < X - 1) st.push(i + 1); if (y > 0) st.push(i - X); if (y < Y - 1) st.push(i + X);
  }
  for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) {   // erode the filled mask back by R
    let inside = 1;
    for (let dy = -R; dy <= R && inside; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= X || yy >= Y || outside[yy * X + xx]) { inside = 0; break; }
    }
    out[(y * X + x) * 2] = src[y * X + x]; out[(y * X + x) * 2 + 1] = inside || m[y * X + x] ? 255 : 0;
  }
}

function buildDust(n, r) {
  const pos = new Float32Array(n * 3), val = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos.set([(Math.random() - 0.5) * r * 2.6, (Math.random() - 0.5) * r * 2, (Math.random() - 0.5) * r * 2.6], i * 3);
    val[i] = Math.random();
  }
  return { pos, val, tis: new Float32Array(n).fill(1), nrm: new Int8Array(n * 3) };
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
    const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.3, roughness: 0.42, transparent: true, opacity, depthWrite: false, clippingPlanes: planes, blending: THREE.AdditiveBlending });  // additive: a vessel never darkens the dots under it
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
  const R = Object.fromEntries(Object.entries({ ica: 0.0068, mca: 0.0052, br: 0.0032, aca: 0.0044, pca: 0.0044, bas: 0.0062, vert: 0.0048, tr: 0.0062, ss: 0.0052, com: 0.0024 })
    .map(([k, r]) => [k, r * 0.7]));   // thin: the vessels are an accent, the dots carry the anatomy
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
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });  // transparent: the page shows through (translucent brain card on phones)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  el.stage.appendChild(renderer.domElement);
  // the dots add up in a half-float buffer that is tone-mapped onto the canvas (without float buffers: straight additive, dimmer)
  const hdr = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  const dotsRT = hdr ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }) : null;
  const _buf = new THREE.Vector2();

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  const rig = new THREE.Group(), tilt = new THREE.Group();
  scene.add(tilt); tilt.add(rig);
  if (hdr) {
    const tone = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: toneVert, fragmentShader: toneFrag,
      uniforms: { uDots: { value: dotsRT.texture }, uExposure: { value: C.exposure } }, transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false }));
    tone.frustumCulled = false; tone.renderOrder = -1; scene.add(tone);
  }
  const draw = () => {
    if (hdr) { renderer.setRenderTarget(dotsRT); camera.layers.set(1); renderer.render(scene, camera); renderer.setRenderTarget(null); camera.layers.set(0); }
    renderer.render(scene, camera);
  };
  scene.add(new THREE.HemisphereLight(C.hemi[0], C.hemi[1], 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-1.2, 1.6, 2.2); scene.add(key);
  const fill = new THREE.DirectionalLight(C.fill, 0.5); fill.position.set(1.5, -0.4, -1); scene.add(fill);

  const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10), growPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10);
  const fx = { uTime: { value: 0 }, uSpin: { value: 0 }, uSpinEnergy: { value: 0 }, uSliceEnergy: { value: 0 }, uSliceVel: { value: 0 }, uSizeZ: { value: 1 },
               uAssemble: { value: 1 }, uFocusDepth: { value: 3.3 }, uPointerStrength: { value: 0 }, uAspect: { value: 1 }, uPointer: { value: new THREE.Vector2() } };
  const pulse = { value: 0 };
  const layers = [];          // point-layer uniforms that follow the slice clip
  let dims, size, cap, capTex, capData, volData, capZ = -1, dust, shellU, raf = 0, destroyed = false;

  const S = {
    yaw: 0, pitch: 0.21, targetPitch: 0.21, vel: 0, dragging: false, lastX: 0, lastY: 0, lastT: 0, auto: prefersReduced ? 0 : 0.14, idle: 0, prevYaw: 0, spinEnergy: 0,
    slice: 1, sliceTarget: 1, sliceFloat: 1, count: 1, navVel: 0, navDrag: false, navLastT: 0, prevSlice: 1, sliceEnergy: 0,
    intro: 0, pointerOn: 0, pointerIdle: 9,
    zoom: 1, zoomTarget: 1, follow: 0,
    look: 0, lookIdle: 99, lookBlock: 0, px: 0, py: 0, lp: 0,   // look at the mouse: weight, time since the mouse moved, pause after a drag, pointer, pitch offset
  };
  let baseZ = 3.3, dotMul = 1;   // dotMul: live dot-size factor for transitions (setDot)

  async function init() {
    const vol = await loadVolume(dataUrl);
    dims = vol.dims; volData = vol.data;
    const longest = Math.max(...dims);
    size = new THREE.Vector3(dims[0] / longest, dims[1] / longest, dims[2] / longest);
    fx.uSizeZ.value = size.z;

    const frame = new THREE.Group();
    frame.rotation.set(-Math.PI / 2, Math.PI, 0, 'YXZ');   // superior -> +y, anterior -> +z
    rig.add(frame);

    const points = (pts, { gm, wm, size: sz, opacity, order, lit }) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pts.pos, 3));
      g.setAttribute('aVal', new THREE.BufferAttribute(pts.val, 1));
      g.setAttribute('aTissue', new THREE.BufferAttribute(pts.tis, 1));
      g.setAttribute('aNormal', new THREE.BufferAttribute(pts.nrm, 3, true));
      const u = { ...fx, uSize: { value: sz }, uClipZ: { value: 10 }, uPixelRatio: { value: renderer.getPixelRatio() * (renderer._bhK || 1) }, uLit: { value: lit ? 1 : 0 },
                  uColor: { value: new THREE.Color(gm) }, uColorDeep: { value: new THREE.Color(wm) }, uOpacity: { value: opacity * (renderer._bhG ?? 1) }, _o: opacity,
                  uKey: { value: new THREE.Vector3(...C.key).normalize() }, uFill: { value: new THREE.Vector3(...C.fillDir).normalize() } };
      const m = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: ptVert, fragmentShader: ptFrag, uniforms: u, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      m.renderOrder = order; if (lit) layers.push(u); return m;
    };
    const budget = opts.points ?? 400000, key = dataUrl + '|' + budget;
    if (!cache.has(key)) { const env = envelope(vol.data, dims, vol.mm); cache.set(key, { pts: buildPoints(vol.data, dims, size, budget, vol.mm, env), shell: buildShell(env, dims, size) }); }
    const built = cache.get(key);
    const dots = points(built.pts, { gm: C.gm, wm: C.wm, size: C.dotSize, opacity: C.dotsOpacity * (hdr ? 1 : 0.6), order: 2, lit: true });
    if (hdr) dots.layers.set(1);   // drawn into the float buffer, then tone-mapped onto the canvas
    frame.add(dots);
    dust = points(buildDust(140, 1.6), { gm: C.dust, wm: C.dust, size: 4, opacity: 0.22, order: 1, lit: false });
    scene.add(dust);

    frame.add(buildVasculature(size, [cutPlane, growPlane], vol.landmarks, pulse));

    shellU = { uColor: { value: new THREE.Color(C.shell) }, uKey: { value: new THREE.Vector3(...C.key).normalize() }, uOpacity: { value: 0 }, uClipZ: { value: 10 }, uSizeZ: fx.uSizeZ };
    const shell = new THREE.Mesh(built.shell, new THREE.ShaderMaterial({ vertexShader: shellVert, fragmentShader: shellFrag, uniforms: shellU,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    shell.renderOrder = 5; frame.add(shell);

    capData = new Uint8Array(dims[0] * dims[1] * 2);
    capTex = new THREE.DataTexture(capData, dims[0], dims[1], THREE.RGFormat, THREE.UnsignedByteType);
    capTex.minFilter = capTex.magFilter = THREE.LinearFilter; capTex.unpackAlignment = 1;
    cap = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y), new THREE.ShaderMaterial({
      vertexShader: capVert, fragmentShader: capFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uSlice: { value: capTex }, uTint: { value: new THREE.Color(C.cap) }, uDark: { value: new THREE.Vector3(...C.capDark) }, uOpacity: { value: C.capOpacity } },
    }));
    cap.renderOrder = 4; cap.visible = false; frame.add(cap);

    S.count = Math.round(dims[2] * vol.mm / 2.8);   // one tick per 2.8 mm, whatever the voxel size
    S.slice = S.sliceTarget = S.sliceFloat = S.prevSlice = S.count;
    buildTicks(); updateNav(); resize();
    el.loader.classList.add('hide');
    raf = requestAnimationFrame(tick);
    requestAnimationFrame(() => el.stage.classList.add('bh-in'));  // the dots fade in instead of popping up
  }

  /* layout: brain centred, CSS vars --brain-offset-x/-y shift it */
  function resize() {
    const w = el.stage.clientWidth, h = el.stage.clientHeight;
    if (!w || !h) return;
    const dprCap = parseFloat(getComputedStyle(root).getPropertyValue('--brain-dpr')) || 2;  // a small canvas needs fewer pixels
    renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix(); fx.uAspect.value = w / h;
    const cs = getComputedStyle(root);
    // --brain-fit (0..1): fit the brain's bounding sphere to that share of the container's shorter side
    const fit = parseFloat(cs.getPropertyValue('--brain-fit'));
    baseZ = fit > 0 ? 0.75 / (Math.tan(Math.PI / 12) * Math.min(1, w / h)) / fit : (h > w ? 5.2 : 3.3);
    camera.position.set(0, 0, baseZ / S.zoom); camera.lookAt(0, 0, 0);
    S.follow = prefersReduced ? 0 : parseFloat(cs.getPropertyValue('--brain-follow')) || 0;  // tilt towards the mouse, 0 = off
    if (!(parseFloat(cs.getPropertyValue('--brain-zoom')) > 1)) S.zoom = S.zoomTarget = 1;
    tilt.position.set(parseFloat(cs.getPropertyValue('--brain-offset-x')) || 0, parseFloat(cs.getPropertyValue('--brain-offset-y')) || 0, 0);
    // dots have a fixed pixel size, so a small canvas packs them densely: shrink them with the canvas (reference 720px),
    // and let --brain-glow (0..1) dim the dots and the glass
    renderer._bhK = Math.min(1, Math.max(0.15, Math.min(w, h) / 720)) * (parseFloat(cs.getPropertyValue('--brain-dot')) || 1);  // floor 0.15: the page's small bubble brain; --brain-dot multiplies the dot size
    const glow = parseFloat(cs.getPropertyValue('--brain-glow')); renderer._bhG = glow >= 0 ? glow : 1;
    S.auto = prefersReduced ? 0 : 0.14 * (parseFloat(cs.getPropertyValue('--brain-spin')) || 1);  // idle spin speed, --brain-spin multiplies it
    for (const u of layers) { u.uPixelRatio.value = renderer.getPixelRatio() * renderer._bhK * dotMul; if (u._o != null) u.uOpacity.value = u._o * renderer._bhG; }
    if (hdr) { renderer.getDrawingBufferSize(_buf); dotsRT.setSize(_buf.x, _buf.y); }
    if (dims && !paused) draw();  // redraw now: setSize cleared the canvas, a blank frame would flash
  }
  const ro = new ResizeObserver(resize); ro.observe(el.stage);

  /* drag to rotate + pointer ripple */
  let K = 0.0075;  // drag sensitivity; --brain-drag on the container multiplies it (read on each press)
  const setPointer = e => {
    const r = el.stage.getBoundingClientRect();
    fx.uPointer.value.set(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
    S.pointerOn = 1; S.pointerIdle = 0;
  };
  const pts2 = new Map();   // active touches, for pinch zoom
  let pinch = null, lastTap = null;
  const zoomMax = () => parseFloat(getComputedStyle(root).getPropertyValue('--brain-zoom')) || 1;
  const pinchDist = () => { const [a, b] = [...pts2.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  const zoomDown = e => {
    pts2.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    if (zoomMax() <= 1) return false;
    if (pts2.size === 2) { try { el.stage.setPointerCapture(e.pointerId); } catch {} pinch = { d: pinchDist(), z: S.zoomTarget }; S.dragging = false; S.vel = 0; lastTap = null; return true; }
    const now = performance.now();   // double tap: zoom in, or back to the whole brain
    if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      S.zoomTarget = S.zoomTarget > 1.05 ? 1 : Math.min(2, zoomMax()); if (S.zoomTarget === 1) S.targetPitch = 0.21; lastTap = null; return true;
    }
    lastTap = { t: now, x: e.clientX, y: e.clientY };
    return pts2.size > 2;
  };
  const onDown = e => { if (zoomDown(e)) return; K = 0.0075 * (parseFloat(getComputedStyle(root).getPropertyValue('--brain-drag')) || 1); S.dragging = true; el.stage.classList.add('dragging'); el.stage.setPointerCapture(e.pointerId); S.lastX = e.clientX; S.lastY = e.clientY; S.lastT = performance.now(); S.vel = 0; S.idle = 0; setPointer(e); };
  const onMove = e => {
    if (pts2.has(e.pointerId)) { const p = pts2.get(e.pointerId); p.x = e.clientX; p.y = e.clientY; if (lastTap && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) > 10) lastTap = null; }
    if (pinch) { if (pts2.size === 2) S.zoomTarget = THREE.MathUtils.clamp(pinch.z * pinchDist() / pinch.d, 1, zoomMax()); return; }
    setPointer(e);
    if (!S.dragging) return;
    const dx = e.clientX - S.lastX, dy = e.clientY - S.lastY, now = performance.now(), dt = Math.max(now - S.lastT, 1) / 1000;
    S.yaw += dx * K; S.targetPitch = THREE.MathUtils.clamp(S.targetPitch + dy * K * 0.6, -1.2, 1.2); S.vel = THREE.MathUtils.clamp(S.vel * 0.55 + dx * K / dt * 0.45, -14, 14);  // smoothed fling, not the last event's raw dx/dt
    S.lastX = e.clientX; S.lastY = e.clientY; S.lastT = now;
  };
  const onUp = e => {
    pts2.delete(e.pointerId);
    if (pinch) { if (pts2.size < 2) { pinch = null; S.dragging = false; S.vel = 0; } return; }
    onUp0();
  };
  const onUp0 = () => { if (S.dragging) { S.dragging = false; el.stage.classList.remove('dragging'); S.idle = 0; S.lookBlock = 1.2; if (performance.now() - S.lastT > 90) S.vel = 0; } };  // let a fling play out before the brain looks back at the mouse  // a pause before release stops the fling
  const onLeave = () => { S.pointerOn = 0; };
  const onKey = e => { if (e.key === 'ArrowLeft') S.yaw -= 0.15; if (e.key === 'ArrowRight') S.yaw += 0.15; };
  el.stage.addEventListener('pointerdown', onDown); el.stage.addEventListener('pointermove', onMove);
  el.stage.addEventListener('pointerup', onUp); el.stage.addEventListener('pointercancel', onUp);
  el.stage.addEventListener('pointerleave', onLeave); el.stage.addEventListener('keydown', onKey);
  // desktop: the brain turns its face to the mouse; when the mouse rests for LOOK_HOLD s or leaves the window, the idle spin comes back
  const LOOK_HOLD = 4, TAU = Math.PI * 2, _c = new THREE.Vector3();
  const onFollow = e => { if (e.pointerType !== 'mouse' || !S.follow) return; S.px = e.clientX; S.py = e.clientY; S.lookIdle = 0; };
  const onFollowOut = e => { if (!e.relatedTarget) S.lookIdle = LOOK_HOLD; };
  addEventListener('pointermove', onFollow, { passive: true }); document.addEventListener('mouseout', onFollowOut);

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
    if (z !== capZ) { capFrame(volData.subarray(z * X * Y, (z + 1) * X * Y), X, Y, capData); capTex.needsUpdate = true; capZ = z; }
  }

  /* loop */
  let last = performance.now();
  const easeOut = t => 1 - (1 - t) ** 3;
  const ease = (cur, target, dt, upK, downK) => cur + (target - cur) * Math.min(1, dt * (target > cur ? upK : downK));
  let paused = false, ticked = false;   // setPaused(true) stops rendering (an off-screen copy costs nothing)
  function tick(now) {
    if (destroyed) return;
    ticked = true;
    if (paused) { raf = 0; return; }
    const dt = Math.min((now - last) / 1000, 0.05); last = now;

    if (S.intro < 3) {                                            // intro: points assemble, vessels grow
      S.intro += dt;
      fx.uAssemble.value = prefersReduced ? 0 : 1 - easeOut(THREE.MathUtils.clamp(S.intro / 1.6, 0, 1));
      growPlane.constant = -0.7 + (prefersReduced ? 1 : easeOut(THREE.MathUtils.clamp((S.intro - 0.35) / 2, 0, 1))) * 1.5;
    }
    S.lookIdle += dt; S.lookBlock = Math.max(0, S.lookBlock - dt);   // look at the mouse: fade in fast, hand back to the spin slowly
    const want = S.follow && !S.dragging && !S.lookBlock && S.lookIdle < LOOK_HOLD ? 1 : 0;
    S.look += (want - S.look) * Math.min(1, dt * (want ? 2.2 : 0.8));
    let lyT = 0, lpT = 0, lookW = 0;
    if (S.look > 0.001) {                                         // angles from the brain's centre on screen to the pointer
      const r = el.stage.getBoundingClientRect();
      _c.copy(tilt.position).project(camera);
      const cx = r.left + (_c.x + 1) / 2 * r.width, cy = r.top + (1 - _c.y) / 2 * r.height, D = Math.max(innerWidth, innerHeight) * 0.65;
      lyT = THREE.MathUtils.clamp(Math.atan2(S.px - cx, D), -0.8, 0.8) * S.follow;
      lpT = THREE.MathUtils.clamp(Math.atan2(S.py - cy, D) * 0.8, -0.4, 0.4) * S.follow;
    }
    if (!S.dragging) {                                            // inertia -> slow auto rotation (or turning to the mouse)
      S.idle += dt; S.vel *= Math.exp(-dt * 3.2);
      let w = S.vel + THREE.MathUtils.smoothstep(S.idle, 0.4, 2) * S.auto * (1 - S.look);
      if (S.look > 0.001) {                                       // face front (yaw 0) + the look angle, the short way round
        const tgt = lyT + TAU * Math.round((S.yaw - lyT) / TAU);
        lookW = THREE.MathUtils.clamp((tgt - S.yaw) * 4, -5, 5) * S.look; w += lookW;
      }
      S.yaw += w * dt;
    }
    S.pitch += (S.targetPitch - S.pitch) * Math.min(1, dt * 6);
    S.lp += (lpT * S.look - S.lp) * Math.min(1, dt * 4);
    rig.rotation.y = S.yaw; tilt.rotation.x = S.pitch + S.lp;
    if (Math.abs(S.zoomTarget - S.zoom) > 1e-4) { S.zoom += (S.zoomTarget - S.zoom) * Math.min(1, dt * 12); camera.position.z = baseZ / S.zoom; }

    const extra = (S.yaw - S.prevYaw) / dt - (S.dragging ? 0 : S.auto * (1 - S.look)) - lookW;  // turning to the mouse is calm: no spin smear
    S.prevYaw = S.yaw;
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
    shellU.uClipZ.value = clipZ; shellU.uOpacity.value = C.shellOpacity * (renderer._bhG ?? 1) * (1 - fx.uAssemble.value);
    updateCap(f); updateNav();

    dust.rotation.y += dt * 0.02; dust.position.copy(tilt.position);
    draw();
    raf = requestAnimationFrame(tick);
  }

  init().catch(err => { console.error(err); el.loader.textContent = 'FAILED TO LOAD THE SCAN'; });

  return {
    setSlice: n => setSliceFloat(n),
    reset,
    // hand the view over to another copy, so two mounts read as one brain
    getView: () => ({ yaw: S.yaw, pitch: S.pitch, targetPitch: S.targetPitch, vel: S.vel, zoom: S.zoomTarget }),
    setView(v) { if (!v) return; S.yaw = S.prevYaw = v.yaw; S.pitch = v.pitch; S.targetPitch = v.targetPitch; S.vel = v.vel || 0; S.idle = 2; },
    resetZoom(smooth) { S.zoomTarget = 1; if (!smooth) { S.zoom = 1; camera.position.z = baseZ; } },
    // scale the dots live (a page transition that resizes the brain keeps them in step); 1 = normal
    setDot(k) { dotMul = k > 0 ? k : 1; for (const u of layers) u.uPixelRatio.value = renderer.getPixelRatio() * (renderer._bhK || 1) * dotMul; },
    // the numbers resize() uses, so a page transition can match two layouts exactly
    getLook() { return { k: renderer._bhK || 1, fit: parseFloat(getComputedStyle(root).getPropertyValue('--brain-fit')) || 1 }; },
    setPaused(v) {
      paused = !!v;
      if (!paused && ticked && !raf && !destroyed) { last = performance.now(); raf = requestAnimationFrame(tick); }
    },
    destroy() {
      destroyed = true; cancelAnimationFrame(raf); ro.disconnect(); removeEventListener('scroll', onScroll);
      removeEventListener('pointermove', onFollow); document.removeEventListener('mouseout', onFollowOut);
      dotsRT?.dispose(); renderer.dispose(); root.innerHTML = ''; root.classList.remove('bh');
    },
  };
}
