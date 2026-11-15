// "Touge Pass": a mountain road built for drifting. One closed loop of switchback hairpins, fast sweepers and a
// long climb back to the summit, plus an open-asphalt drift park in the valley. Shares the sky / lighting / collision
// hash of World, but replaces terrain, roads and props with its own spline-based versions.
import * as THREE from 'three';
import { World } from './world.js';
import { clamp, lerp, mulberry32 } from './util.js';
import * as T from './textures.js';

export const TRW = 14;                   // road width
const DS = 2;                            // spacing of road samples (m)
const CELLH = 12;                        // road-sample hash cell
const RAIL_OFF = TRW / 2 + 0.9;
export const PARK = { x: 190, z: 262, r: 82 };
const TOP = 92;                          // summit height
const GRID = 5, EXT = 520;               // terrain grid cell size / half extent

const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Centripetal-free Catmull-Rom through a closed list of points (uniform parameterisation, dense input). */
function catmull(pts, per) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
}

/** The centre line of the pass as control points (x, z). */
function controlPoints() {
  const P = [];
  const X = 250, R = 32, LEG = 64, Z0 = -340;
  for (let k = 0; k < 5; k++) {
    const z = Z0 + LEG * k, east = k % 2 === 0, x0 = east ? -X : X, x1 = east ? X : -X, len = Math.abs(x1 - x0);
    for (let d = 0; d < len; d += 25) {
      const t = d / len, taper = Math.min(1, t * 7, (1 - t) * 7);
      const wig = 11 * Math.sin(d * 0.034 + k * 1.7) * taper;
      P.push([x0 + (east ? d : -d), z + wig]);
    }
    if (k < 4) for (let a = 0; a < 180; a += 20) {            // hairpin
      const r = (a * Math.PI) / 180, sx = east ? 1 : -1;
      P.push([x1 + sx * R * Math.sin(r), z + R - R * Math.cos(r)]);
    }
  }
  // valley, the drift park and the long climb back to the summit
  for (const p of [[250, -84], [300, -80], [360, -30], [392, 50], [372, 140], [320, 215], [255, 290], [160, 335], [40, 345], [-90, 335], [-205, 300], [-300, 245], [-360, 165], [-390, 60], [-392, -60], [-382, -180], [-362, -290], [-350, -332], [-318, -352], [-284, -347]]) P.push(p);
  return P;
}

export class TougeWorld extends World {
  constructor(scene, renderer) { super(scene, renderer); this.driftTune = true; this.flatLayers = true; this.kind = 'touge'; }

  // ---------------------------------------------------------------- build
  _build() {
    this.bridges = []; this.blocks = []; this.buildingMat = { emissiveIntensity: 0 };
    this._buildSky(); this._buildLights();
    this.scene.fog.density = 0.0012;
    this._buildTrack();
    this._buildTerrain();
    this._buildRoadMesh();
    this._buildRails();
    this._buildPark();
    this._buildClips();
    this._buildStartLine();
    this._buildScenery();
    this.props.finishTrees();
    this._buildMinimap();
  }

  _buildTrack() {
    const pts = catmull(controlPoints(), 8);
    // resample at uniform arc length
    const xs = [], zs = []; let acc = 0, idx = 0, prev = pts[0]; xs.push(prev[0]); zs.push(prev[1]);
    const n = pts.length; let need = DS;
    for (let k = 1; k <= n; k++) {
      const q = pts[k % n]; let dx = q[0] - prev[0], dz = q[1] - prev[1], seg = Math.hypot(dx, dz);
      while (seg >= need) {
        const t = need / seg; prev = [prev[0] + dx * t, prev[1] + dz * t]; xs.push(prev[0]); zs.push(prev[1]);
        dx = q[0] - prev[0]; dz = q[1] - prev[1]; seg = Math.hypot(dx, dz); need = DS;
      }
      need -= seg; prev = q;
    }
    // drop a possible duplicate closing sample
    if (Math.hypot(xs[xs.length - 1] - xs[0], zs[zs.length - 1] - zs[0]) < DS * 0.5) { xs.pop(); zs.pop(); }
    const N = xs.length;
    // light smoothing of the polyline (removes any residual kinks)
    for (let pass = 0; pass < 3; pass++) { const ox = xs.slice(), oz = zs.slice(); for (let i = 0; i < N; i++) { const a = (i + N - 1) % N, b = (i + 1) % N; xs[i] = (ox[a] + 2 * ox[i] + ox[b]) / 4; zs[i] = (oz[a] + 2 * oz[i] + oz[b]) / 4; } }
    this.N = N; this.xs = Float32Array.from(xs); this.zs = Float32Array.from(zs);
    this.length = N * DS;
    // tangents / headings
    this.yaws = new Float32Array(N);
    for (let i = 0; i < N; i++) { const a = (i + N - 1) % N, b = (i + 1) % N; this.yaws[i] = Math.atan2(xs[b] - xs[a], zs[b] - zs[a]); }
    // which samples lie inside the drift park (+ margin)
    let first = -1, last = -1; const inPark = (i, m) => Math.hypot(xs[i] - PARK.x, zs[i] - PARK.z) < PARK.r + m;
    for (let i = 0; i < N; i++) if (inPark(i, 25)) { if (first < 0) first = i; last = i; }
    this.parkRange = [first, last];
    // elevation profile: summit -> long descent -> flat valley (park) -> climb back to the summit
    const iA = Math.max(10, first - 60), iB = Math.min(N - 10, last + 40), ys = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (i < iA) ys[i] = TOP * (0.5 + 0.5 * Math.cos(Math.PI * Math.pow(i / iA, 0.92)));
      else if (i <= iB) ys[i] = 0;
      else ys[i] = TOP * (0.5 - 0.5 * Math.cos(Math.PI * (i - iB) / (N - iB)));
    }
    this.ys = ys;
    // spatial hash of road segments
    this.rh = new Map();
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, x0 = Math.min(xs[i], xs[j]) - 1, x1 = Math.max(xs[i], xs[j]) + 1, z0 = Math.min(zs[i], zs[j]) - 1, z1 = Math.max(zs[i], zs[j]) + 1;
      for (let cx = Math.floor(x0 / CELLH); cx <= Math.floor(x1 / CELLH); cx++) for (let cz = Math.floor(z0 / CELLH); cz <= Math.floor(z1 / CELLH); cz++) {
        const k = cx * 4096 + cz; let a = this.rh.get(k); if (!a) this.rh.set(k, (a = [])); a.push(i);
      }
    }
  }

  /** Nearest road segment: sets this.ni (segment), this.nt (0..1), this.nd (distance). Search radius in cells. */
  _nearest(x, z, cells = 1) {
    const cx0 = Math.floor(x / CELLH), cz0 = Math.floor(z / CELLH); let best = 1e9, bi = -1, bt = 0;
    const xs = this.xs, zs = this.zs, N = this.N;
    for (let cx = cx0 - cells; cx <= cx0 + cells; cx++) for (let cz = cz0 - cells; cz <= cz0 + cells; cz++) {
      const a = this.rh.get(cx * 4096 + cz); if (!a) continue;
      for (let k = 0; k < a.length; k++) {
        const i = a[k], j = i + 1 === N ? 0 : i + 1, ax = xs[i], az = zs[i], dx = xs[j] - ax, dz = zs[j] - az;
        let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz); t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + dx * t - x, pz = az + dz * t - z, d = px * px + pz * pz;
        if (d < best) { best = d; bi = i; bt = t; }
      }
    }
    this.ni = bi; this.nt = bt; this.nd = bi < 0 ? 1e9 : Math.sqrt(best);
    return this.nd;
  }
  _roadY(i, t) { const j = i + 1 === this.N ? 0 : i + 1; return this.ys[i] + (this.ys[j] - this.ys[i]) * t; }
  inPark(x, z, m = 0) { return (x - PARK.x) ** 2 + (z - PARK.z) ** 2 < (PARK.r + m) ** 2; }

  // ---------------------------------------------------------------- terrain
  _noise(x, z) {
    const h = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
    const f = (x, z) => { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
      return lerp(lerp(h(ix, iz), h(ix + 1, iz), u), lerp(h(ix, iz + 1), h(ix + 1, iz + 1), u), v); };
    return f(x / 120, z / 120) * 0.6 + f(x / 45, z / 45) * 0.3 + f(x / 17, z / 17) * 0.1;
  }
  _buildTerrain() {
    const n = Math.round(EXT * 2 / GRID) + 1, N = this.N; this.gn = n;
    const H = new Float32Array(n * n), pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
    // coarse road samples for the base mountain shape (inverse-distance weighting)
    const cs = []; for (let i = 0; i < N; i += 8) cs.push(i);
    const grass = new THREE.Color(0x4f6b3a), rock = new THREE.Color(0x7d786f), dirt = new THREE.Color(0x5a5143), dark = new THREE.Color(0x2e4a2c), tmp = new THREE.Color();
    for (let gz = 0; gz < n; gz++) for (let gx = 0; gx < n; gx++) {
      const x = -EXT + gx * GRID, z = -EXT + gz * GRID;
      const dRoad = this._nearest(x, z, 3), ni = this.ni, nt = this.nt, yr = ni >= 0 ? this._roadY(ni, nt) : 0;
      let sw = 0, sy = 0, dmin = 1e9;
      for (let k = 0; k < cs.length; k++) { const i = cs[k], d2 = (x - this.xs[i]) ** 2 + (z - this.zs[i]) ** 2 + 400; const w = 1 / (d2 * d2); sw += w; sy += w * this.ys[i]; if (d2 < dmin) dmin = d2; }
      let base = sy / sw;
      const far = smooth(30, 260, Math.min(dRoad, 400));
      base = base * (1 - 0.8 * far) + (this._noise(x + 900, z) - 0.45) * 26 * smooth(8, 70, dRoad) + (this._noise(x, z + 500) - 0.5) * 9 * smooth(8, 40, dRoad);
      const edge = smooth(EXT - 90, EXT, Math.max(Math.abs(x), Math.abs(z)));
      base = lerp(base, -9, edge);
      const dPark = Math.hypot(x - PARK.x, z - PARK.z) - PARK.r;
      const w1 = smooth(TRW / 2 + 3, TRW / 2 + 30, dRoad), w2 = smooth(4, 34, dPark);
      let h = lerp(yr - 0.35, base, w1);
      h = lerp(-0.35, h, w2);
      H[gz * n + gx] = h; const o = (gz * n + gx) * 3; pos[o] = x; pos[o + 1] = h; pos[o + 2] = z;
    }
    this.H = H;
    // vertex colours by slope / altitude / distance to road
    for (let gz = 0; gz < n; gz++) for (let gx = 0; gx < n; gx++) {
      const i = gz * n + gx, x = -EXT + gx * GRID, z = -EXT + gz * GRID;
      const hx = H[gz * n + Math.min(n - 1, gx + 1)] - H[gz * n + Math.max(0, gx - 1)], hz = H[Math.min(n - 1, gz + 1) * n + gx] - H[Math.max(0, gz - 1) * n + gx];
      const slope = Math.hypot(hx, hz) / (2 * GRID), nz = this._noise(x * 3, z * 3);
      tmp.copy(grass).lerp(dark, smooth(0.2, 0.9, nz)).lerp(rock, smooth(0.32, 0.7, slope)).lerp(rock, smooth(60, 100, H[i]) * 0.5);
      const dRoad = this._nearest(x, z, 2); tmp.lerp(dirt, (1 - smooth(TRW / 2 + 1, TRW / 2 + 9, dRoad)) * 0.7);
      if (this.inPark(x, z, 8)) tmp.lerp(dirt, 0.6);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    const idx = []; for (let gz = 0; gz < n - 1; gz++) for (let gx = 0; gx < n - 1; gx++) { const a = gz * n + gx, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })); m.receiveShadow = true; this.terrain = m; this.root.add(m);
    const sk = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x24361f })); sk.position.y = -9.5; this.root.add(sk); this.skirt = sk;
  }
  terrainH(x, z) {
    const n = this.gn, fx = (x + EXT) / GRID, fz = (z + EXT) / GRID;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return -9;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, H = this.H, a = H[iz * n + ix], b = H[iz * n + ix + 1], c = H[(iz + 1) * n + ix], d = H[(iz + 1) * n + ix + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  // ---------------------------------------------------------------- road, rails
  _buildRoadMesh() {
    const N = this.N, xs = this.xs, zs = this.zs, ys = this.ys, yaws = this.yaws;
    const pos = [], uv = [], idx = []; let v = 0;
    const runs = []; let cur = null;
    for (let i = 0; i <= N; i++) {
      const k = i % N, skip = this.inPark(xs[k], zs[k], -3);
      if (skip) { cur = null; continue; }
      if (!cur) { cur = []; runs.push(cur); } cur.push(i);
    }
    for (const run of runs) {
      if (run.length < 2) continue; const base = v;
      for (const i of run) {
        const k = i % N, yw = yaws[k], lx = Math.cos(yw) * TRW / 2, lz = -Math.sin(yw) * TRW / 2, y = ys[k] + 0.05;
        pos.push(xs[k] + lx, y, zs[k] + lz, xs[k] - lx, y, zs[k] - lz); uv.push(i * DS / 32, 0, i * DS / 32, 1); v += 2;
      }
      for (let q = 0; q < run.length - 1; q++) { const a = base + q * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const rt = T.roadTexture(); rt.repeat.set(1, 1);
    this.roadMat = new THREE.MeshStandardMaterial({ map: rt, roughness: 0.8, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(g, this.roadMat); m.receiveShadow = true; this.root.add(m);
  }

  _buildRails() {
    const N = this.N, xs = this.xs, zs = this.zs, ys = this.ys, yaws = this.yaws, list = [];
    for (let i = 0; i < N; i++) for (const sd of [1, -1]) {
      const yw = yaws[i], x = xs[i] + Math.cos(yw) * RAIL_OFF * sd, z = zs[i] - Math.sin(yw) * RAIL_OFF * sd;
      if (this.inPark(x, z, -2)) continue;                 // only the strict interior of the park is open
      this.addCircle(x, z, 0.95, 0, null);
      if (i % 2 === 0) list.push([x, z, ys[i], yw, sd, i]);
    }
    const mk = (geo, mat, f) => { const m = new THREE.InstancedMesh(geo, mat, list.length); const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      list.forEach((r, k) => { const j = (r[5] + 2) % N, pitch = Math.atan2(ys[j] - ys[r[5]], DS * 2); e.set(-pitch, r[3] + Math.PI / 2, 0); q.setFromEuler(e); f(p, r); M.compose(p, q, s); m.setMatrixAt(k, M); });
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.root.add(m); return m; };
    const railMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.7, roughness: 0.35 });
    mk(new THREE.BoxGeometry(4.15, 0.3, 0.09), railMat, (p, r) => p.set(r[0], r[2] + 0.78, r[1]));
    mk(new THREE.BoxGeometry(4.15, 0.12, 0.07), railMat, (p, r) => p.set(r[0], r[2] + 0.4, r[1]));
    const post = new THREE.MeshStandardMaterial({ color: 0xe9e9ea, roughness: 0.6 });
    mk(new THREE.BoxGeometry(0.13, 0.95, 0.13), post, (p, r) => p.set(r[0], r[2] + 0.42, r[1]));
  }

  // ---------------------------------------------------------------- drift park
  _buildPark() {
    const { x, z, r } = PARK;
    const at = T.asphaltTexture(); at.repeat.set(24, 24);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: at, roughness: 0.78, color: 0xd0d0d6 }));
    disc.position.set(x, 0.03, z); disc.receiveShadow = true; this.root.add(disc);
    // donut zones: painted rings around tyre stacks (these give bonus points)
    this.zones = [{ x: x - 28, z: z - 14, r0: 9, r1: 24, name: 'DONUT ZONE' }, { x: x + 30, z: z + 22, r0: 8, r1: 22, name: 'DONUT ZONE' }];
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const tyre = new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.9 }), stripe = new THREE.MeshStandardMaterial({ color: 0xd8312b, roughness: 0.7 });
    for (const zn of this.zones) {
      for (const [a, b] of [[zn.r0 - 0.3, zn.r0 + 0.1], [zn.r1 - 0.3, zn.r1 + 0.1]]) { const ring = new THREE.Mesh(new THREE.RingGeometry(a, b, 72).rotateX(-Math.PI / 2), white); ring.position.set(zn.x, 0.06, zn.z); this.root.add(ring); }
      const st = new THREE.Group(); for (let k = 0; k < 4; k++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.5, 14), k % 2 ? stripe : tyre); t.position.y = 0.25 + k * 0.5; t.castShadow = true; st.add(t); } st.position.set(zn.x, 0, zn.z); this.root.add(st);
      this.addCircle(zn.x, zn.z, 1.6, 0, null);
    }
    // slalom: a line of cones across the pad
    for (let k = 0; k < 9; k++) this.props.add('cone', x - 52 + k * 13, z + 48 + (k % 2) * 3, 0);
    // tyre-barrier ring around the park (open where the road passes through)
    const bar = []; const step = 2.6 / r;
    for (let a = 0; a < Math.PI * 2; a += step) {
      const bx = x + Math.cos(a) * (r + 1.5), bz = z + Math.sin(a) * (r + 1.5);
      if (this._nearest(bx, bz, 2) < RAIL_OFF + 1.8) continue;     // leave only the road mouth open; the rails take over there
      bar.push([bx, bz]); this.addCircle(bx, bz, 1.2, 0, null);
    }
    const m = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.1, 1.1, 1.0, 12), tyre, bar.length * 2), M = new THREE.Matrix4(); let k = 0;
    for (const [bx, bz] of bar) for (let l = 0; l < 2; l++) { M.makeTranslation(bx, 0.5 + l, bz); m.setMatrixAt(k++, M); } m.castShadow = true; this.root.add(m);
    // floodlight towers (night)
    this.towers = [];
    for (const [tx, tz] of [[x - 60, z - 55], [x + 62, z - 50], [x - 62, z + 40], [x + 66, z + 52]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 16, 8), new THREE.MeshStandardMaterial({ color: 0x555a63 })); pole.position.set(tx, 8, tz); pole.castShadow = true; this.root.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 1.2), this.props.lampMat); lamp.position.set(tx, 16.2, tz); this.root.add(lamp);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(30, 24).rotateX(-Math.PI / 2), this.props.poolMat); pool.position.set(tx - Math.sign(tx - x) * 18, 0.09, tz - Math.sign(tz - z) * 14); this.root.add(pool);
      this.addCircle(tx, tz, 0.5, 0, null);
    }
  }
  /** Points multiplier for drifting inside a donut zone (1 elsewhere). */
  zoneAt(x, z) { for (const zn of this.zones) { const d = Math.hypot(x - zn.x, z - zn.z); if (d > zn.r0 && d < zn.r1) return 1.6; } return 1; }

  // ---------------------------------------------------------------- clipping points (apexes of the corners)
  _buildClips() {
    const N = this.N, yaws = this.yaws, kap = new Float32Array(N), W = 6;
    for (let i = 0; i < N; i++) { let d = yaws[(i + W) % N] - yaws[(i - W + N) % N]; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; kap[i] = d / (2 * W * DS); }
    const clips = []; let lastI = -999;
    for (let i = 0; i < N; i++) {
      const k = kap[i]; if (Math.abs(k) < 1 / 62) continue;
      let peak = true; for (let o = -18; o <= 18; o++) if (Math.abs(kap[(i + o + N) % N]) > Math.abs(k) + 1e-6) { peak = false; break; }
      if (!peak || i - lastI < 25) continue; lastI = i;
      if (this.inPark(this.xs[i], this.zs[i], 20)) continue;
      const sd = k > 0 ? 1 : -1, yw = yaws[i], off = TRW / 2 - 2.4;      // positive curvature = turning left: inside is on the left
      clips.push({ x: this.xs[i] + Math.cos(yw) * off * sd, z: this.zs[i] - Math.sin(yw) * off * sd, y: this.ys[i], i, t: -99, r: Math.abs(1 / k) });
    }
    this.clips = clips;
    const g = new THREE.CylinderGeometry(0.05, 0.5, 1.6, 8).translate(0, 0.9, 0);
    this.clipMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.clipMesh = new THREE.InstancedMesh(g, this.clipMat, Math.max(1, clips.length)); const M = new THREE.Matrix4(), c = new THREE.Color(0xffb62e);
    clips.forEach((p, k) => { M.makeTranslation(p.x, p.y, p.z); this.clipMesh.setMatrixAt(k, M); this.clipMesh.setColorAt(k, c); });
    this.clipMesh.frustumCulled = false; this.root.add(this.clipMesh);
    this.clipFlash = [];
  }
  hitClip(k, time) { this.clips[k].t = time; this.clipMesh.setColorAt(k, new THREE.Color(0x4dff88)); this.clipMesh.instanceColor.needsUpdate = true; setTimeout(() => { this.clipMesh.setColorAt(k, new THREE.Color(0xffb62e)); this.clipMesh.instanceColor.needsUpdate = true; }, 2500); }

  _buildStartLine() {
    const i0 = 4, x = this.xs[i0], z = this.zs[i0], y = this.ys[i0], yw = this.yaws[i0];
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 32; const g = cv.getContext('2d');
    for (let a = 0; a < 16; a++) for (let b = 0; b < 2; b++) { g.fillStyle = (a + b) % 2 ? '#111' : '#f2f2f2'; g.fillRect(a * 16, b * 16, 16, 16); }
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(TRW, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tx, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    strip.position.set(x, y + 0.07, z); strip.rotation.y = yw + Math.PI / 2; this.root.add(strip);
    const arch = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0x2a2d36, roughness: 0.6, metalness: 0.4 }), neon = new THREE.MeshBasicMaterial({ color: 0x19e6ff });
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), mat); p.position.set(s * (TRW / 2 + 1.2), 3.5, 0); p.castShadow = true; arch.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(TRW + 3.2, 1.3, 0.5), mat); beam.position.y = 7; arch.add(beam);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(TRW + 3, 0.18, 0.55), neon); glow.position.y = 6.3; arch.add(glow);
    arch.position.set(x, y, z); arch.rotation.y = yw + Math.PI / 2; arch.rotation.y = yw; this.root.add(arch);
    this.addCircle(x + Math.cos(yw) * (TRW / 2 + 1.2), z - Math.sin(yw) * (TRW / 2 + 1.2), 0.6, 0, null);
    this.addCircle(x - Math.cos(yw) * (TRW / 2 + 1.2), z + Math.sin(yw) * (TRW / 2 + 1.2), 0.6, 0, null);
  }

  _buildScenery() {
    const rng = mulberry32(99); let placed = 0, tries = 0;
    while (placed < 780 && tries++ < 6000) {
      const x = (rng() - 0.5) * 2 * (EXT - 30), z = (rng() - 0.5) * 2 * (EXT - 30);
      const d = this._nearest(x, z, 2); if (d < RAIL_OFF + 6 || this.inPark(x, z, 14)) continue;
      const y = this.terrainH(x, z); if (y < -6) continue;
      const pine = rng() < 0.7; this.props.addTree(x, z, 0.9 + rng() * 0.9, pine, y); placed++;
    }
    // a couple of observation signs / reflector boards on the outside of hairpins are the clip markers (see _buildClips)
  }

  // ---------------------------------------------------------------- minimap
  _buildMinimap() {
    const S = 760, half = EXT, scale = S / (half * 2), cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'); g.fillStyle = '#0f1a14'; g.fillRect(0, 0, S, S);
    const tx = (v) => (v + half) * scale;
    // height shading
    for (let gz = 0; gz < this.gn - 1; gz += 2) for (let gx = 0; gx < this.gn - 1; gx += 2) {
      const h = this.H[gz * this.gn + gx], t = clamp((h + 5) / 100, 0, 1);
      g.fillStyle = `rgb(${Math.round(18 + t * 30)},${Math.round(30 + t * 34)},${Math.round(24 + t * 26)})`; g.fillRect(tx(-EXT + gx * GRID), tx(-EXT + gz * GRID), GRID * 2 * scale + 1, GRID * 2 * scale + 1);
    }
    g.fillStyle = '#2a2540'; g.beginPath(); g.arc(tx(PARK.x), tx(PARK.z), PARK.r * scale, 0, 7); g.fill();
    g.strokeStyle = '#59647d'; g.lineWidth = TRW * scale * 1.15; g.lineJoin = 'round'; g.beginPath();
    for (let i = 0; i <= this.N; i++) { const k = i % this.N; if (i === 0) g.moveTo(tx(this.xs[k]), tx(this.zs[k])); else g.lineTo(tx(this.xs[k]), tx(this.zs[k])); } g.stroke();
    g.fillStyle = '#ffb62e'; for (const c of this.clips) { g.beginPath(); g.arc(tx(c.x), tx(c.z), 3, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; g.fillRect(tx(this.xs[4]) - 4, tx(this.zs[4]) - 2, 8, 4);
    this.minimap = { canvas: cv, scale, half };
  }

  // ---------------------------------------------------------------- queries used by physics / camera / game
  onRoad(x, z) { return this.inPark(x, z) || this._nearest(x, z, 1) <= TRW / 2; }
  blockAt() { return null; }
  grip(x, z) { if (this.inPark(x, z, -1)) return 0.97; return this._nearest(x, z, 1) <= TRW / 2 + 0.3 ? 1 : 0.55; }
  heightAt(x, z) {
    if (this.inPark(x, z, 2)) return 0;
    if (this._nearest(x, z, 1) < TRW / 2 + 3) return this._roadY(this.ni, this.nt);
    return this.terrainH(x, z);
  }
  underDeck() { return false; }
  nearBridge() { return false; }
  nearestNode() { return { i: 0, j: 0 }; }
  randomRoadPoint() { return null; }

  /** Index of the road segment nearest to (x,z), or -1 when far from the road. */
  roadIndex(x, z) { return this._nearest(x, z, 2) < 40 ? this.ni : -1; }
  poseAt(i, lane = 0) { const yw = this.yaws[i]; return { x: this.xs[i] + Math.cos(yw) * lane, z: this.zs[i] - Math.sin(yw) * lane, yaw: yw, y: this.ys[i] }; }
  /** Closest road pose, facing the same way as the car. Used for "recover". */
  recoverPose(car) {
    let best = 1e18, bi = 0;
    for (let i = 0; i < this.N; i += 2) { const d = (this.xs[i] - car.x) ** 2 + (this.zs[i] - car.z) ** 2; if (d < best) { best = d; bi = i; } }
    if (this.inPark(car.x, car.z, 0)) return { x: car.x, z: car.z, yaw: car.yaw };
    let yw = this.yaws[bi]; const dot = Math.sin(car.yaw) * Math.sin(yw) + Math.cos(car.yaw) * Math.cos(yw);
    if (dot < 0) { bi = (bi + 0) % this.N; yw += Math.PI; }
    return { x: this.xs[bi], z: this.zs[bi], yaw: yw };
  }
}
