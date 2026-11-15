// Procedural vehicle models. Every car is a handful of merged meshes (paint / glass / trim / lights
// + 4 wheels) so that dozens of cars stay cheap to draw. Side profiles are extruded across the car width.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---- Body profiles (metres). z runs rear(-) -> front(+). ---------------------------------
// cabR/cabRT = rear glass base / top z, cabFT/cabF = windshield top / base z, in fractions of length from rear.
const SPECS = {
  sports:      { L: 4.4, W: 1.9,  cl: 0.15, belt: 0.82, roof: 1.2,  cabR: 0.2,  cabRT: 0.36, cabFT: 0.62, cabF: 0.74, nose: 0.55, wr: 0.34, ww: 0.28, spoiler: 'lip' },
  muscle:      { L: 4.9, W: 1.95, cl: 0.17, belt: 0.95, roof: 1.32, cabR: 0.16, cabRT: 0.27, cabFT: 0.52, cabF: 0.6,  nose: 0.78, wr: 0.36, ww: 0.32, scoop: true, stripes: true },
  super:       { L: 4.5, W: 2.0,  cl: 0.12, belt: 0.7,  roof: 1.08, cabR: 0.28, cabRT: 0.42, cabFT: 0.6,  cabF: 0.76, nose: 0.42, wr: 0.35, ww: 0.32, spoiler: 'wing', intakes: true },
  suv:         { L: 4.7, W: 1.95, cl: 0.27, belt: 1.1,  roof: 1.78, cabR: 0.05, cabRT: 0.1,  cabFT: 0.62, cabF: 0.7,  nose: 0.95, wr: 0.41, ww: 0.3,  rack: true },
  offroad:     { L: 4.2, W: 1.92, cl: 0.38, belt: 1.05, roof: 1.76, cabR: 0.08, cabRT: 0.12, cabFT: 0.58, cabF: 0.66, nose: 0.95, wr: 0.46, ww: 0.36, bull: true, spare: true, roofLights: true },
  interceptor: { L: 4.8, W: 1.95, cl: 0.16, belt: 0.88, roof: 1.28, cabR: 0.17, cabRT: 0.3,  cabFT: 0.58, cabF: 0.68, nose: 0.66, wr: 0.35, ww: 0.3,  spoiler: 'lip', police: 'sleek' },
  patrol:      { L: 4.7, W: 1.85, cl: 0.2,  belt: 0.9,  roof: 1.42, cabR: 0.14, cabRT: 0.24, cabFT: 0.6,  cabF: 0.7,  nose: 0.8,  wr: 0.34, ww: 0.24, police: 'patrol' },
  swat:        { L: 5.2, W: 2.1,  cl: 0.3,  belt: 1.2,  roof: 2.15, cabR: 0.02, cabRT: 0.04, cabFT: 0.7,  cabF: 0.78, nose: 1.1,  wr: 0.42, ww: 0.32, police: 'swat', rack: false },
  classic:     { L: 4.7, W: 1.82, cl: 0.17, belt: 0.88, roof: 1.3, cabR: 0.2, cabRT: 0.3, cabFT: 0.5, cabF: 0.58, nose: 0.82, wr: 0.34, ww: 0.24, stripes: true },
  rally:       { L: 4.0, W: 1.85, cl: 0.22, belt: 0.86, roof: 1.42, cabR: 0.05, cabRT: 0.1, cabFT: 0.6, cabF: 0.7, nose: 0.72, wr: 0.36, ww: 0.28, spoiler: 'wing', roofLights: true },
  hyper:       { L: 4.6, W: 2.05, cl: 0.1, belt: 0.66, roof: 1.0, cabR: 0.3, cabRT: 0.44, cabFT: 0.62, cabF: 0.8, nose: 0.36, wr: 0.36, ww: 0.34, spoiler: 'wing', intakes: true },
  monster:     { L: 5.0, W: 2.3, cl: 0.62, belt: 1.5, roof: 2.35, cabR: 0.2, cabRT: 0.26, cabFT: 0.6, cabF: 0.68, nose: 1.4, wr: 0.78, ww: 0.55, bull: true, roofLights: true },
  sedan:       { L: 4.5, W: 1.8,  cl: 0.2,  belt: 0.88, roof: 1.42, cabR: 0.15, cabRT: 0.26, cabFT: 0.6,  cabF: 0.7,  nose: 0.75, wr: 0.32, ww: 0.22 },
  hatch:       { L: 3.8, W: 1.7,  cl: 0.2,  belt: 0.85, roof: 1.45, cabR: 0.04, cabRT: 0.12, cabFT: 0.58, cabF: 0.7,  nose: 0.7,  wr: 0.3,  ww: 0.2 },
  van:         { L: 5.0, W: 2.0,  cl: 0.28, belt: 1.15, roof: 2.2,  cabR: 0.02, cabRT: 0.03, cabFT: 0.76, cabF: 0.86, nose: 1.0,  wr: 0.36, ww: 0.24, cargo: true },
  pickup:      { L: 5.2, W: 1.95, cl: 0.3,  belt: 1.0,  roof: 1.7,  cabR: 0.4,  cabRT: 0.42, cabFT: 0.64, cabF: 0.74, nose: 0.9,  wr: 0.38, ww: 0.26, bed: true },
  // ---- extra bodies: regular, drift, hyper and meme cars
  micro:       { L: 2.5, W: 1.45, cl: 0.18, belt: 0.8,  roof: 1.55, cabR: 0.08, cabRT: 0.12, cabFT: 0.6,  cabF: 0.72, nose: 0.75, wr: 0.27, ww: 0.18 },
  kei:         { L: 3.4, W: 1.45, cl: 0.24, belt: 0.95, roof: 1.62, cabR: 0.45, cabRT: 0.47, cabFT: 0.62, cabF: 0.72, nose: 0.9,  wr: 0.28, ww: 0.18, bed: true },
  wagon:       { L: 4.9, W: 1.82, cl: 0.2,  belt: 0.88, roof: 1.45, cabR: 0.03, cabRT: 0.1,  cabFT: 0.6,  cabF: 0.7,  nose: 0.76, wr: 0.33, ww: 0.22, rack: true },
  taxi:        { L: 4.5, W: 1.8,  cl: 0.2,  belt: 0.88, roof: 1.42, cabR: 0.15, cabRT: 0.26, cabFT: 0.6,  cabF: 0.7,  nose: 0.75, wr: 0.32, ww: 0.22, sign: 'taxi', checker: true },
  minivan:     { L: 4.6, W: 1.9,  cl: 0.22, belt: 1.0,  roof: 1.85, cabR: 0.03, cabRT: 0.06, cabFT: 0.7,  cabF: 0.8,  nose: 0.95, wr: 0.34, ww: 0.22 },
  compact:     { L: 4.0, W: 1.72, cl: 0.14, belt: 0.8,  roof: 1.28, cabR: 0.22, cabRT: 0.36, cabFT: 0.6,  cabF: 0.72, nose: 0.62, wr: 0.31, ww: 0.24, spoiler: 'lip', stripes: true },
  coupe:       { L: 4.5, W: 1.82, cl: 0.13, belt: 0.78, roof: 1.24, cabR: 0.2,  cabRT: 0.36, cabFT: 0.6,  cabF: 0.72, nose: 0.6,  wr: 0.33, ww: 0.26, spoiler: 'wing' },
  jdm:         { L: 4.6, W: 1.85, cl: 0.14, belt: 0.82, roof: 1.3,  cabR: 0.2,  cabRT: 0.34, cabFT: 0.6,  cabF: 0.72, nose: 0.64, wr: 0.34, ww: 0.3,  spoiler: 'wing', intakes: true, scoop: true },
  wedge:       { L: 4.4, W: 2.05, cl: 0.09, belt: 0.58, roof: 0.98, cabR: 0.34, cabRT: 0.5,  cabFT: 0.66, cabF: 0.84, nose: 0.3,  wr: 0.35, ww: 0.34, spoiler: 'wing', intakes: true },
  longtail:    { L: 5.0, W: 2.0,  cl: 0.1,  belt: 0.64, roof: 1.02, cabR: 0.3,  cabRT: 0.46, cabFT: 0.62, cabF: 0.78, nose: 0.38, wr: 0.35, ww: 0.34, spoiler: 'wing', intakes: true },
  cart:        { L: 2.7, W: 1.25, cl: 0.22, belt: 0.7,  roof: 1.75, cabR: 0.05, cabRT: 0.08, cabFT: 0.85, cabF: 0.92, nose: 0.8,  wr: 0.24, ww: 0.14 },
  icecream:    { L: 5.0, W: 2.0,  cl: 0.28, belt: 1.15, roof: 2.2,  cabR: 0.02, cabRT: 0.03, cabFT: 0.76, cabF: 0.86, nose: 1.0,  wr: 0.36, ww: 0.24, cargo: true, cone: true },
  bus:         { L: 8.2, W: 2.4,  cl: 0.4,  belt: 1.1,  roof: 2.75, cabR: 0.03, cabRT: 0.04, cabFT: 0.9,  cabF: 0.95, nose: 1.3,  wr: 0.5,  ww: 0.3,  pillars: 7, busStripe: true },
  pizza:       { L: 3.8, W: 1.7,  cl: 0.2,  belt: 0.85, roof: 1.45, cabR: 0.04, cabRT: 0.12, cabFT: 0.58, cabF: 0.7,  nose: 0.7,  wr: 0.3,  ww: 0.2, sign: 'pizza' },
};
export const BODY_KINDS = Object.keys(SPECS);

const _m = new THREE.Matrix4();
const WHITE = new THREE.Color(0xffffff);

/** Prepare a geometry for merging: non-indexed, tinted with vertex colours. */
function prep(geo, color, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (matrix) g.applyMatrix4(matrix);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
const box = (w, h, l, x, y, z, color, rx = 0, ry = 0) => {
  _m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(1, 1, 1));
  return prep(new THREE.BoxGeometry(w, h, l), color, _m);
};
const cyl = (r, h, x, y, z, color, axis = 'x', seg = 12) => {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return prep(g, color);
};
/** Extrude a side-profile polygon (z,y points) across the car width (centered on x=0). */
function extrudeProfile(points, width, color, bevel = 0.05) {
  const s = new THREE.Shape();
  points.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);
  return prep(g, color);
}

const cache = {};

/** Build (and cache) the merged geometry sets for a body kind. */
function buildParts(kind) {
  if (cache[kind]) return cache[kind];
  const S = SPECS[kind];
  const { L, W, cl, belt, roof } = S;
  const zr = -L / 2, zf = L / 2;
  const z = (f) => zr + L * f;
  const paint = [], glass = [], trim = [], lights = [], tail = [], barR = [], barB = [];
  const DARK = 0x15161a, GREY = 0x4a4d55, SILVER = 0xc9ced8;

  // main body shell
  const rearDeck = S.bed ? belt - 0.18 : belt - 0.02;
  const shell = [
    [zr, cl], [zr, rearDeck - 0.06], [zr + 0.1 * L, rearDeck], [z(S.cabR), S.bed ? rearDeck : belt], [z(S.cabF), belt],
    [zf - 0.12 * L, belt - 0.07 * (S.nose > 0.9 ? 0.3 : 1)], [zf, S.nose], [zf, cl + 0.1], [zf - 0.2, cl],
  ];
  paint.push(extrudeProfile(shell, W, 0xffffff, 0.06));
  // greenhouse (glass) + painted roof slab
  const cabW = W * 0.9;
  const cabin = [[z(S.cabR), belt - 0.02], [z(S.cabRT), roof], [z(S.cabFT), roof], [z(S.cabF), belt - 0.02]];
  glass.push(extrudeProfile(cabin, cabW, 0xffffff, 0.02));
  const roofLen = L * (S.cabFT - S.cabRT);
  paint.push(box(cabW * 0.92, 0.07, roofLen + 0.04, 0, roof + 0.02, z((S.cabRT + S.cabFT) / 2), 0xffffff));
  // pillars (paint) to break up the glass
  const pz = z(S.cabR + (S.cabF - S.cabR) * 0.5);
  paint.push(box(cabW + 0.02, roof - belt, 0.1, 0, (roof + belt) / 2 - 0.01, pz, 0xffffff));
  if (S.cargo) paint.push(box(W - 0.02, roof - belt - 0.05, L * 0.55, 0, (roof + belt) / 2, z(0.3), 0xffffff));

  // bumpers / grille / sills
  trim.push(box(W * 0.98, 0.26, 0.28, 0, cl + 0.16, zf - 0.08, DARK));
  trim.push(box(W * 0.98, 0.26, 0.28, 0, cl + 0.16, zr + 0.08, DARK));
  trim.push(box(W * 0.56, 0.16, 0.06, 0, S.nose - 0.17, zf + 0.01, 0x0a0a0c));
  trim.push(box(W + 0.02, 0.1, L * 0.5, 0, cl + 0.1, 0, DARK));
  // mirrors
  for (const sx of [-1, 1]) trim.push(box(0.1, 0.12, 0.2, sx * (cabW / 2 + 0.1), belt + 0.12, z(S.cabF) - 0.18, DARK));

  // lights
  const hlY = S.nose - 0.14;
  for (const sx of [-1, 1]) {
    lights.push(box(0.42, 0.13, 0.08, sx * (W / 2 - 0.35), hlY, zf + 0.0, 0xfff6d8));
    tail.push(box(0.46, 0.12, 0.07, sx * (W / 2 - 0.34), rearDeck - 0.2, zr - 0.005, 0xff1a1a));
  }
  if (kind === 'sports' || kind === 'muscle' || kind === 'super' || kind === 'interceptor') tail.push(box(W * 0.5, 0.05, 0.06, 0, rearDeck - 0.2, zr - 0.01, 0xaa0f0f));

  // details
  if (S.spoiler === 'lip') trim.push(box(W * 0.8, 0.05, 0.28, 0, rearDeck + 0.1, zr + 0.2, DARK, 0.15));
  if (S.spoiler === 'wing') {
    trim.push(box(W * 0.95, 0.05, 0.5, 0, belt + 0.38, zr + 0.2, DARK, -0.1));
    for (const sx of [-1, 1]) trim.push(box(0.06, 0.34, 0.2, sx * (W * 0.32), belt + 0.2, zr + 0.25, DARK));
  }
  if (S.intakes) for (const sx of [-1, 1]) trim.push(box(0.05, 0.22, 0.7, sx * (W / 2 + 0.005), belt - 0.22, z(0.5), 0x050506));
  if (S.scoop) paint.push(box(0.5, 0.1, 0.6, 0, belt + 0.07, z(0.78), 0xffffff));
  if (S.stripes) for (const sx of [-0.2, 0.2]) {
    trim.push(box(0.2, 0.012, L * 0.26, sx, belt + 0.043, z(0.82), 0xf2f2f2));
    trim.push(box(0.2, 0.012, roofLen, sx, roof + 0.062, z((S.cabRT + S.cabFT) / 2), 0xf2f2f2));
    trim.push(box(0.2, 0.012, L * 0.12, sx, rearDeck + 0.012, z(0.08), 0xf2f2f2));
  }
  if (S.rack) {
    for (const sx of [-1, 1]) trim.push(box(0.05, 0.05, roofLen, sx * cabW * 0.4, roof + 0.1, z((S.cabRT + S.cabFT) / 2), DARK));
    for (const zz of [0.3, 0.5, 0.7]) trim.push(box(cabW * 0.82, 0.04, 0.05, 0, roof + 0.1, z(S.cabRT + (S.cabFT - S.cabRT) * zz), DARK));
  }
  if (S.bull) {
    trim.push(box(W * 0.8, 0.07, 0.07, 0, cl + 0.5, zf + 0.15, GREY));
    for (const sx of [-0.3, 0.3]) trim.push(box(0.07, 0.45, 0.07, sx * W, cl + 0.38, zf + 0.12, GREY));
  }
  if (S.spare) trim.push(cyl(0.4, 0.22, 0, belt + 0.2, zr - 0.2, DARK, 'z'));
  if (S.roofLights) {
    trim.push(box(W * 0.7, 0.1, 0.16, 0, roof + 0.17, z(S.cabFT) - 0.1, DARK));
    for (let i = -2; i <= 2; i++) lights.push(box(0.2, 0.07, 0.05, i * 0.28, roof + 0.17, z(S.cabFT) - 0.01, 0xfff6d8));
  }
  if (S.bed) for (const sx of [-1, 1]) trim.push(box(0.06, 0.28, L * (S.cabR - 0.02), sx * (W / 2 - 0.05), rearDeck + 0.12, z(S.cabR / 2), DARK));
  if (S.bed) trim.push(box(W - 0.1, 0.28, 0.06, 0, rearDeck + 0.12, zr + 0.05, DARK));

  if (S.sign === 'taxi') lights.push(box(0.62, 0.17, 0.28, 0, roof + 0.16, z((S.cabRT + S.cabFT) / 2), 0xfff0a0));
  if (S.sign === 'pizza') { trim.push(box(0.9, 0.06, 0.9, 0, roof + 0.1, z(0.5), 0x2a2a2a)); trim.push(cyl(0.38, 0.14, 0, roof + 0.2, z(0.5), 0xffb52e, 'y', 16)); lights.push(cyl(0.12, 0.16, 0.12, roof + 0.22, z(0.5) + 0.1, 0xd8312b, 'y', 8)); }
  if (S.cone) {
    const cone = new THREE.ConeGeometry(0.34, 0.95, 12); cone.rotateX(Math.PI); cone.translate(0, roof + 0.62, z(0.35));
    trim.push(prep(cone, 0xe0b46a));
    for (const [yy, c] of [[0.38, 0xff8fc0], [0.56, 0xfff3c8]]) { const sp = new THREE.SphereGeometry(0.34 - (yy - 0.38) * 0.3, 12, 8); sp.translate(0, roof + 1.1 + yy - 0.38, z(0.35)); trim.push(prep(sp, c)); }
  }
  if (S.pillars) {
    for (let k = 1; k < S.pillars; k++) paint.push(box(cabW + 0.02, roof - belt, 0.09, 0, (roof + belt) / 2 - 0.01, z(S.cabR + (S.cabF - S.cabR) * k / S.pillars), 0xffffff));
    if (S.busStripe) { trim.push(box(W + 0.02, 0.1, L * 0.96, 0, belt + 0.3, 0, DARK)); trim.push(box(W + 0.02, 0.1, L * 0.96, 0, cl + 0.5, 0, DARK)); lights.push(box(0.3, 0.12, 0.05, -0.8, roof - 0.15, zf + 0.0, 0xff8a1e), box(0.3, 0.12, 0.05, 0.8, roof - 0.15, zf + 0.0, 0xff8a1e)); }
  }
  // police livery + light bars
  if (S.police) {
    const barZ = z((S.cabRT + S.cabFT) / 2);
    trim.push(box(0.95, 0.08, 0.34, 0, roof + 0.1, barZ, 0x111114));
    barR.push(box(0.42, 0.1, 0.3, -0.26, roof + 0.16, barZ, 0xffffff));
    barB.push(box(0.42, 0.1, 0.3, 0.26, roof + 0.16, barZ, 0xffffff));
    // white door panels
    for (const sx of [-1, 1]) trim.push(box(0.02, 0.42, L * 0.34, sx * (W / 2 + 0.012), belt - 0.26, z(0.5), 0xf4f4f6));
    trim.push(box(W * 0.6, 0.02, 0.5, 0, belt + 0.01 + (kind === 'swat' ? 0.0 : 0), z(0.8), 0x0f0f12));
    // grille-mounted flashers
    barR.push(box(0.3, 0.07, 0.05, -0.4, S.nose - 0.1, zf + 0.02, 0xffffff));
    barB.push(box(0.3, 0.07, 0.05, 0.4, S.nose - 0.1, zf + 0.02, 0xffffff));
  }
  if (kind === 'swat') trim.push(box(W * 0.9, 0.5, 0.06, 0, belt - 0.2, zf + 0.03, GREY));

  // wheels (shared geometry, 4 separate meshes at runtime)
  const wheelGeo = mergeGeometries([cyl(S.wr, S.ww, 0, 0, 0, 0x101012, 'x', 18), cyl(S.wr * 0.66, S.ww + 0.02, 0, 0, 0, SILVER, 'x', 14), cyl(S.wr * 0.3, S.ww + 0.04, 0, 0, 0, 0x2a2c32, 'x', 8)]);
  const axleF = zf - S.wr - (kind === 'bus' ? 1.4 : 0.55) - (kind === 'suv' || kind === 'swat' ? 0.15 : 0);
  const axleR = zr + S.wr + (kind === 'bus' ? 1.1 : 0.55) + (S.bed ? 0.15 : 0);
  const track = W / 2 - S.ww / 2 + 0.03;
  // dark wheel-arch discs on the body sides
  for (const zz of [axleF, axleR]) for (const sx of [-1, 1]) trim.push(cyl(S.wr * 1.2, 0.04, sx * (W / 2 - 0.005), S.wr, zz, 0x050506, 'x', 14));

  const m = (arr) => (arr.length ? mergeGeometries(arr) : null);
  cache[kind] = {
    spec: S, paint: m(paint), glass: m(glass), trim: m(trim), lights: m(lights), tail: m(tail), barR: m(barR), barB: m(barB),
    wheel: wheelGeo, axleF, axleR, track, dims: { L, W, H: roof + 0.25, wr: S.wr, hlY, tailY: rearDeck - 0.2 },
  };
  return cache[kind];
}

// Shared materials ---------------------------------------------------------------------
export const SharedMats = {
  glass: new THREE.MeshStandardMaterial({ color: 0x0b1220, metalness: 0.9, roughness: 0.06, envMapIntensity: 1.2 }),
  trim: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.45 }),
  lights: new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xcccccc }),
  wheel: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.5 }),
  parked: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.4 }),
};

/** Create a car instance: returns the scene graph plus handles used by the physics/visual code. */
export function buildCar(kind, paintColor = 0xcc2222) {
  const P = buildParts(kind);
  const group = new THREE.Group();
  const body = new THREE.Group();          // rolls / pitches with the suspension
  group.add(body);
  const paintMat = new THREE.MeshPhysicalMaterial({ color: paintColor, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, vertexColors: false });
  const mk = (geo, mat, shadow = true) => { if (!geo) return null; const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = shadow; body.add(mesh); return mesh; };
  // paint geometry has white vertex colours which we ignore (paintMat has no vertexColors)
  const paint = mk(P.paint, paintMat);
  mk(P.glass, SharedMats.glass);
  mk(P.trim, SharedMats.trim);
  mk(P.lights, SharedMats.lights, false);
  const tailMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x992222 });
  mk(P.tail, tailMat, false);
  let barRMat = null, barBMat = null;
  if (P.barR) { barRMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x330000 }); mk(P.barR, barRMat, false); }
  if (P.barB) { barBMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x000033 }); mk(P.barB, barBMat, false); }

  const wheels = [];
  for (const [zz, front] of [[P.axleF, true], [P.axleR, false]]) {
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * P.track, P.spec.wr, zz);
      const mesh = new THREE.Mesh(P.wheel, SharedMats.wheel);
      mesh.castShadow = false;
      if (sx > 0) mesh.rotation.y = Math.PI; // keep rim detail facing outward
      pivot.add(mesh);
      group.add(pivot);
      wheels.push({ pivot, mesh, front, side: sx, z: zz, x: sx * P.track });
    }
  }
  return { group, body, paintMat, tailMat, barRMat, barBMat, wheels, dims: P.dims, kind, police: !!P.spec.police };
}

/** One merged, vertex-coloured sedan used for instanced parked cars (tinted by instanceColor). */
export function buildParkedCarGeometry() {
  const P = buildParts('sedan');
  const parts = [];
  const tint = (g, c) => {
    const col = g.attributes.color; const cc = new THREE.Color(c);
    for (let i = 0; i < col.count; i++) col.setXYZ(i, cc.r, cc.g, cc.b);
    return g;
  };
  parts.push(P.paint.clone());                  // stays white -> instanceColor paints it
  parts.push(tint(P.glass.clone(), 0x0a0e18));
  parts.push(P.trim.clone());
  for (const sx of [-1, 1]) for (const zz of [P.axleF, P.axleR]) {
    const w = P.wheel.clone(); w.translate(sx * P.track, P.spec.wr, zz); parts.push(w);
  }
  return mergeGeometries(parts);
}

export function carDims(kind) { return buildParts(kind).dims; }

/** Police helicopter. */
export function buildHelicopter() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x14181f, metalness: 0.6, roughness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8ecf4, metalness: 0.3, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), mat); body.scale.set(1, 0.9, 1.7); g.add(body);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), new THREE.MeshStandardMaterial({ color: 0x0a1220, metalness: 0.9, roughness: 0.05 })); nose.position.set(0, 0.1, 1.5); nose.scale.set(1, 0.9, 1); g.add(nose);
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 5.5), mat); boom.position.set(0, 0.35, -4); g.add(boom);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.9), white); fin.position.set(0, 1.0, -6.6); g.add(fin);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.2, 2.2), white); stripe.position.set(0, -0.1, 0); g.add(stripe);
  for (const sx of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3.4), mat); skid.position.set(sx * 1.2, -1.45, 0.2); g.add(skid);
    for (const zz of [-0.8, 1.2]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), mat); s.position.set(sx * 1.2, -1.1, zz); g.add(s); }
  }
  const rotor = new THREE.Group(); rotor.position.set(0, 1.65, 0);
  for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.05, 0.35), mat); b.rotation.y = i * Math.PI / 2; rotor.add(b); }
  g.add(rotor);
  const tailRotor = new THREE.Group(); tailRotor.position.set(0.25, 1.0, -6.7);
  const tb = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2, 0.15), mat); tailRotor.add(tb); g.add(tailRotor);
  const red = new THREE.MeshBasicMaterial({ color: 0x330000 }), blue = new THREE.MeshBasicMaterial({ color: 0x000033 });
  const lr = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), red); lr.position.set(-1.1, -0.9, 0.3);
  const lb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), blue); lb.position.set(1.1, -0.9, 0.3);
  g.add(lr, lb);
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return { group: g, rotor, tailRotor, red, blue };
}
