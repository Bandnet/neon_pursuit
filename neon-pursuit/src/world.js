// The procedural city: road grid, blocks (towers / parks / lots / drift pads), bridges, props,
// spatial-hash collision world, day/night lighting and sky.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mulberry32, clamp, lerp } from './util.js';
import * as T from './textures.js';
import { Props } from './props.js';

export const PITCH = 90, RW = 16, NR = 9, HALF = 360, BOUND = 392, BS = 74;
export const c = (i) => (i - 4) * PITCH;                    // road centre coordinate
const CELL = 16;
const BRIDGES = [{ ax: 'x', cx: c(2), cz: c(4) }, { ax: 'z', cx: c(6), cz: c(3) }];
const DECK_H = 6, FLAT = 15, RAMP_END = 50;

const WALLS = [0xc9ccd4, 0xd8c9b0, 0xb4bfd0, 0xe0d6c8, 0x9aa4b4, 0xcfb9a6, 0xbfc7bb, 0xa9a39a];

export class World {
  constructor(scene, renderer, quality) {
    this.scene = scene; this.renderer = renderer;
    this.root = new THREE.Group(); scene.add(this.root);   // everything of this map lives under one group so maps can be swapped
    this.hash = new Map(); this.stamp = 0; this.out = [];
    this.blocks = [];            // {i,j,x0,z0,type}
    this.rng = mulberry32(1337);
    this.glow = T.glowTexture();
    this.props = new Props(this.root, this.glow);
    this.props.world = this;
    this.onSmash = null;
    this.timeH = 12; this.night = 0;
    this.bridges = BRIDGES;
    this._build();
  }

  /** Make this map the visible one (shared scene state: fog, background, reflections). */
  activate() { this.root.visible = true; this.scene.fog = this.fogObj; this.scene.background = this.bgObj; this.scene.environment = this.envTex; }
  deactivate() { this.root.visible = false; }

  // ---------------- collision hash -------------------------------------------------------
  _key(cx, cz) { return (cx + 128) * 512 + (cz + 128); }
  _insert(col, x0, z0, x1, z1) {
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = this._key(cx, cz); let a = this.hash.get(k); if (!a) this.hash.set(k, (a = [])); a.push(col);
      }
  }
  addCircle(x, z, r, layer = 0, dest = null) {
    const col = { t: 0, x, z, r, layer, dest, stamp: 0 };
    if (dest) dest.kind && (col.dest = dest);
    this._insert(col, x - r, z - r, x + r, z + r); return col;
  }
  addBox(x0, z0, x1, z1, layer = 0, h = 4, los = false) {
    const col = { t: 1, x0, x1, z0, z1, layer, h, los, stamp: 0, dest: null };
    this._insert(col, x0, z0, x1, z1); return col;
  }
  /** Live colliders within r of (x,z) on `layer`. Result array is reused between calls. */
  near(x, z, r, layer = 0) {
    const out = this.out; out.length = 0; const st = ++this.stamp;
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const a = this.hash.get(this._key(cx, cz)); if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const col = a[i];
          if (col.stamp === st || col.layer !== layer) continue;
          col.stamp = st;
          if (col.dest && col.dest.state !== 0) continue;
          out.push(col);
        }
      }
    return out;
  }
  knock(item, car) { return this.props.knock(item, car); }

  /** True if a circle at (x,z) overlaps a solid (non-destructible) collider. Used by AI feelers. */
  blockedAt(x, z, r, layer = 0) {
    const list = this.near(x, z, r, layer);
    for (let i = 0; i < list.length; i++) {
      const col = list[i];
      if (col.dest) continue;
      if (col.t === 0) { const d = Math.hypot(x - col.x, z - col.z); if (d < r + col.r) return true; }
      else { const px = clamp(x, col.x0, col.x1), pz = clamp(z, col.z0, col.z1); if ((x - px) ** 2 + (z - pz) ** 2 < r * r) return true; }
    }
    return false;
  }
  /** Line of sight test over buildings (2-D march). */
  hasLOS(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz), n = Math.ceil(d / 6);
    for (let i = 1; i < n; i++) {
      const t = i / n, x = ax + dx * t, z = az + dz * t, list = this.near(x, z, 0.5, 0);
      for (let k = 0; k < list.length; k++) { const col = list[k]; if (col.los && x > col.x0 && x < col.x1 && z > col.z0 && z < col.z1) return false; }
    }
    return true;
  }
  /** Camera-collision helper: shortens the segment a->b (a is the look target) if a building is in the way. */
  clipCamera(ax, ay, az, bx, by, bz) {
    const n = 10; let best = 1;
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ay + (by - ay) * t;
      const list = this.near(x, z, 1.2, 0);
      let hit = false;
      for (let k = 0; k < list.length; k++) { const col = list[k]; if (col.t === 1 && col.h > y && x > col.x0 - 0.8 && x < col.x1 + 0.8 && z > col.z0 - 0.8 && z < col.z1 + 0.8) { hit = true; break; } }
      if (hit) { best = Math.max(0.12, (i - 1.5) / n); break; }
    }
    return best;
  }

  // ---------------- terrain / road queries ----------------------------------------------
  _lineDist(v) { const m = (((v + HALF) % PITCH) + PITCH) % PITCH; return Math.min(m, PITCH - m); }
  inCity(v) { return v > -HALF - 8 && v < HALF + 8; }
  onRoad(x, z) { return (this.inCity(z) && this._lineDist(x) <= RW / 2) || (this.inCity(x) && this._lineDist(z) <= RW / 2); }
  blockAt(x, z) {
    if (x < -HALF || x > HALF || z < -HALF || z > HALF) return null;
    const i = Math.floor((x + HALF) / PITCH), j = Math.floor((z + HALF) / PITCH);
    if (i > 7 || j > 7) return null;
    return this.blocks[j * 8 + i];
  }
  /** Tyre grip multiplier. */
  grip(x, z) {
    if (this.onRoad(x, z)) return 1;
    const b = this.blockAt(x, z);
    if (!b) return 0.7;
    return b.type === 'park' ? 0.68 : b.type === 'drift' || b.type === 'lot' ? 0.98 : 0.9;
  }
  _bridgeUV(b, x, z) { return b.ax === 'x' ? [x - b.cx, z - b.cz] : [z - b.cz, x - b.cx]; }
  /** Ground / deck height at (x,z). `curY` lets cars pass under a deck they are not on. */
  heightAt(x, z, curY = 0) {
    for (const b of this.bridges) {
      const [u, v] = this._bridgeUV(b, x, z), au = Math.abs(u);
      if (Math.abs(v) < RW / 2 + 1 && au < RAMP_END) {
        if (au <= FLAT) return curY > 2.6 ? DECK_H : 0;
        return DECK_H * (RAMP_END - au) / (RAMP_END - FLAT);
      }
    }
    if (this.onRoad(x, z)) return 0;
    return this.blockAt(x, z) ? 0.14 : 0;
  }
  /** True when (x,z) is beneath a bridge deck (used to keep the camera below the deck). */
  underDeck(x, z) {
    for (const b of this.bridges) { const [u, v] = this._bridgeUV(b, x, z); if (Math.abs(v) < RW / 2 + 3 && Math.abs(u) < FLAT + 6) return true; }
    return false;
  }
  slopeAt(x, z, yaw, curY = 0) {
    const d = 1.5, sy = Math.sin(yaw), cy = Math.cos(yaw);
    return Math.atan2(this.heightAt(x + sy * d, z + cy * d, curY) - this.heightAt(x - sy * d, z - cy * d, curY), d * 2);
  }

  // ---------------- road graph helpers ---------------------------------------------------
  nearestNode(x, z) { return { i: clamp(Math.round(x / PITCH + 4), 0, NR - 1), j: clamp(Math.round(z / PITCH + 4), 0, NR - 1) }; }
  nodePos(i, j) { return { x: c(i), z: c(j) }; }
  /** A random road point with heading and lane (right-hand traffic). */
  randomRoadPoint(cx, cz, minD, maxD, tries = 12) {
    for (let t = 0; t < tries; t++) {
      const ang = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      let x = cx + Math.cos(ang) * d, z = cz + Math.sin(ang) * d;
      x = clamp(x, -HALF + 10, HALF - 10); z = clamp(z, -HALF + 10, HALF - 10);
      const alongX = Math.random() < 0.5;       // snap to a road line
      if (alongX) z = c(Math.round(z / PITCH + 4)); else x = c(Math.round(x / PITCH + 4));
      // keep away from bridge ramps and intersections
      if (this.nearBridge(x, z)) continue;
      const dist = Math.hypot(x - cx, z - cz); if (dist < minD * 0.8) continue;
      const dir = alongX ? (Math.random() < 0.5 ? 1 : 3) : (Math.random() < 0.5 ? 0 : 2);
      return { x, z, dir, alongX };
    }
    return null;
  }
  nearBridge(x, z) { for (const b of this.bridges) { const [u, v] = this._bridgeUV(b, x, z); if (Math.abs(u) < RAMP_END + 20 && Math.abs(v) < 20) return true; } return false; }
  static dirYaw(dir) { return [0, Math.PI / 2, Math.PI, -Math.PI / 2][dir]; }
  static dirVec(dir) { return [[0, 1], [1, 0], [0, -1], [-1, 0]][dir]; }
  /** Offset to the right-hand lane for a heading `dir`. */
  static laneOff(dir, w = 4) { const yaw = World.dirYaw(dir); return [-Math.cos(yaw) * w, Math.sin(yaw) * w]; }

  // ---------------- building the city ---------------------------------------------------
  _build() {
    const scene = this.scene, rng = this.rng;
    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildRoads();
    this._buildBlocks(rng);
    this._buildBridges();
    this._buildStreetProps(rng);
    this._buildBoundary();
    this.props.finishTrees();
    this._buildMinimap();
  }

  _buildLights() {
    const scene = this.scene;
    this.hemi = new THREE.HemisphereLight(0xaac8ff, 0x3a3a40, 0.7); this.root.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.05;
    this.root.add(this.sun, this.sun.target);
    const pm = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5; this.envTex = scene.environment;
    pm.dispose();
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(1400, 24, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x3d7fd1) }, horizon: { value: new THREE.Color(0x9cc7e8) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(1, 0.9, 0.7) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; uniform vec3 top, horizon, sunCol, sunDir;
        void main(){ float h = clamp(vP.y, 0.0, 1.0); vec3 col = mix(horizon, top, pow(h, 0.55));
          float s = max(dot(normalize(vP), sunDir), 0.0); col += sunCol * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.25);
          if (vP.y < 0.0) col = horizon; gl_FragColor = vec4(col, 1.0); }`,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat); this.sky.renderOrder = -10; this.root.add(this.sky);
    // stars
    const n = 700, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const th = Math.random() * 6.28, ph = Math.acos(Math.random() * 0.95 + 0.05); p[i * 3] = Math.sin(ph) * Math.cos(th) * 1300; p[i * 3 + 1] = Math.cos(ph) * 1300; p[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 1300; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat); this.root.add(this.stars);
    // distant hills for a skyline
    const hm = new THREE.MeshBasicMaterial({ color: 0x1a2230, fog: true });
    this.hillMat = hm;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2, d = 780 + Math.random() * 120, h = 60 + Math.random() * 140;
      const m = new THREE.Mesh(new THREE.ConeGeometry(90 + Math.random() * 90, h, 5), hm); m.position.set(Math.cos(a) * d, h / 2 - 4, Math.sin(a) * d); this.root.add(m);
    }
    this.scene.fog = new THREE.FogExp2(0x9cc7e8, 0.0016);
    this.scene.background = new THREE.Color(0x9cc7e8);
    this.fogObj = this.scene.fog; this.bgObj = this.scene.background;
  }

  _buildGround() {
    const g = T.grassTexture(); g.repeat.set(300, 300);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: g, roughness: 1, color: 0x9aa890 }));
    m.receiveShadow = true; this.ground = m; this.root.add(m);
  }

  _buildRoads() {
    const rt = T.roadTexture(); const len = HALF * 2 + 16;
    rt.repeat.set(len / 32, 1);
    const roadMat = new THREE.MeshStandardMaterial({ map: rt, roughness: 0.82, metalness: 0.05 });
    const interMat = new THREE.MeshStandardMaterial({ map: T.asphaltTexture(), roughness: 0.85 });
    this.roadMat = roadMat;
    const strip = new THREE.PlaneGeometry(len, RW).rotateX(-Math.PI / 2);
    for (let i = 0; i < NR; i++) {
      const a = new THREE.Mesh(strip, roadMat); a.position.set(0, 0.03, c(i)); a.receiveShadow = true; this.root.add(a);
      const b = new THREE.Mesh(strip, roadMat); b.rotation.y = Math.PI / 2; b.position.set(c(i), 0.031, 0); b.receiveShadow = true; this.root.add(b);
    }
    // intersections + crosswalks (merged)
    const quads = [], zebra = [];
    for (let i = 0; i < NR; i++) for (let j = 0; j < NR; j++) {
      quads.push(new THREE.PlaneGeometry(RW, RW).rotateX(-Math.PI / 2).translate(c(i), 0.05, c(j)));
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + dx, nj = j + dz; if (ni < 0 || nj < 0 || ni >= NR || nj >= NR) continue;
        for (let s = -6; s <= 6; s++) {
          const w = dx !== 0 ? 3 : 0.7, d = dx !== 0 ? 0.7 : 3;
          zebra.push(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(c(i) + dx * (RW / 2 + 2.2) + (dx === 0 ? s * 1.2 : 0), 0.07, c(j) + dz * (RW / 2 + 2.2) + (dz === 0 ? s * 1.2 : 0)));
        }
      }
    }
    const im = new THREE.Mesh(mergeGeometries(quads), interMat); im.receiveShadow = true; this.root.add(im);
    const zm = new THREE.Mesh(mergeGeometries(zebra), new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.8 })); zm.receiveShadow = true; this.root.add(zm);
  }

  // ---------------- blocks ------------------------------------------------------------------
  _blockType(i, j) {
    if ((i === 0 && j === 0) || (i === 7 && j === 7)) return 'drift';
    if ((i === 0 && j === 7) || (i === 7 && j === 0)) return 'lot';
    if (i >= 3 && i <= 4 && j >= 3 && j <= 4) return 'downtown';
    if ((i === 1 && j === 1) || (i === 6 && j === 6) || (i === 5 && j === 2) || (i === 2 && j === 5) || (i === 3 && j === 0) || (i === 4 && j === 7)) return 'park';
    if ((i === 2 && j === 1) || (i === 5 && j === 6) || (i === 1 && j === 4) || (i === 6 && j === 3) || (i === 4 && j === 2)) return 'lot';
    if ((i === 7 && j === 3) || (i === 0 && j === 4) || (i === 7 && j === 5) || (i === 0 && j === 2)) return 'industrial';
    return 'city';
  }

  _buildBlocks(rng) {
    const bld = []; // geometry list for the one merged building mesh
    const trim = [];
    const slabs = [];
    const parks = [], paved = [], lotsA = [], driftQ = [], water = [];
    const tex = T.buildingTextures();
    const bMat = new THREE.MeshStandardMaterial({ map: tex.map, emissiveMap: tex.emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 0.65, metalness: 0.15 });
    this.buildingMat = bMat;
    const rnd = (a, b) => a + rng() * (b - a);

    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const type = this._blockType(i, j);
      const x0 = -HALF + i * PITCH + (PITCH - BS) / 2, z0 = -HALF + j * PITCH + (PITCH - BS) / 2;
      const b = { i, j, x0, z0, x1: x0 + BS, z1: z0 + BS, type }; this.blocks.push(b);
      const cx = x0 + BS / 2, cz = z0 + BS / 2;
      // raised sidewalk slab under every block
      slabs.push(new THREE.BoxGeometry(BS + 8, 0.14, BS + 8).translate(cx, 0.07, cz));
      const dCenter = Math.hypot(i - 3.5, j - 3.5);

      if (type === 'park') {
        parks.push(new THREE.PlaneGeometry(BS, BS).rotateX(-Math.PI / 2).translate(cx, 0.145, cz));
        // pond + path
        water.push(new THREE.CircleGeometry(9, 20).rotateX(-Math.PI / 2).translate(cx + rnd(-12, 12), 0.16, cz + rnd(-12, 12)));
        for (let k = 0; k < 34; k++) {
          const tx = rnd(x0 + 4, x0 + BS - 4), tz = rnd(z0 + 4, z0 + BS - 4);
          if (Math.hypot(tx - cx, tz - cz) < 11) continue;
          this.props.addTree(tx, tz, rnd(0.8, 1.4), rng() < 0.4);
        }
        this._fence(x0 + 1, z0 + 1, x0 + BS - 1, z0 + BS - 1, 14);
      } else if (type === 'drift') {
        driftQ.push({ cx, cz });
        for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; this.props.add('cone', cx + Math.cos(a) * 15, cz + Math.sin(a) * 15, 0); }
        for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; this.props.add('cone', cx + Math.cos(a) * 43, cz + Math.sin(a) * 43, 0); }
        this._fence(x0 + 1, z0 + 1, x0 + BS - 1, z0 + BS - 1, 22);
        // tyre-wall style bollards at the corners
        for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) this.props.add('light', cx + sx * 33, cz + sz * 33, Math.atan2(-(-sz), -sx));
      } else if (type === 'lot') {
        lotsA.push(new THREE.PlaneGeometry(BS, BS).rotateX(-Math.PI / 2).translate(cx, 0.146, cz));
        for (let row = 0; row < 3; row++) {
          const zz = z0 + 10 + row * 24;
          for (let s = 0; s < 12; s++) {
            if (rng() < 0.45) continue;
            const px = x0 + 7 + s * 5.5;
            this.props.addParkedCar(px, zz + 3.5, 0, 0x000000 + Math.floor(rng() * 0xffffff) | 0x303030);
            if (rng() < 0.5) this.props.addParkedCar(px, zz - 3.5 + 0.0, Math.PI, Math.floor(rng() * 0xffffff));
          }
        }
        this._fence(x0 + 1, z0 + 1, x0 + BS - 1, z0 + BS - 1, 16);
        for (const [sx, sz] of [[-1, -1], [1, 1]]) this.props.add('light', cx + sx * 30, cz + sz * 30, Math.atan2(-(-sz), -sx));
      } else {
        // buildings
        const downtown = type === 'downtown', industrial = type === 'industrial';
        const cells = downtown ? 2 : 2;
        const cs = (BS - 6) / cells;
        for (let a = 0; a < cells; a++) for (let d = 0; d < cells; d++) {
          if (!downtown && rng() < 0.08) { // small plaza
            this.props.addTree(x0 + 3 + cs * (a + 0.5), z0 + 3 + cs * (d + 0.5), 1.1);
            continue;
          }
          const lx0 = x0 + 3 + a * cs + 1.5, lz0 = z0 + 3 + d * cs + 1.5;
          const w = cs - 3 - rnd(0, 6), dp = cs - 3 - rnd(0, 6);
          const bx = lx0 + rnd(0, cs - 3 - w), bz = lz0 + rnd(0, cs - 3 - dp);
          let h;
          if (downtown) h = rnd(55, 105); else if (industrial) h = rnd(7, 13); else h = rnd(9, 20) + Math.max(0, 5 - dCenter) * rnd(2, 8);
          const col = WALLS[(rng() * WALLS.length) | 0];
          const ind = industrial;
          this._addBuilding(bld, trim, bx, bz, w, dp, h, col, rng, ind);
          this.addBox(bx, bz, bx + w, bz + dp, 0, h, true);
          if (downtown && rng() < 0.7) { // stepped tower
            const w2 = w * 0.6, d2 = dp * 0.6, h2 = rnd(20, 40);
            this._addBuilding(bld, trim, bx + (w - w2) / 2, bz + (dp - d2) / 2, w2, d2, h2, col, rng, false, h);
          }
        }
        // street trees / bins along the sidewalk edge
        for (let k = 0; k < 6; k++) { const side = (rng() * 4) | 0, t = rnd(8, BS - 8); const p = [[x0 + t, z0 + 1.2], [x0 + t, z0 + BS - 1.2], [x0 + 1.2, z0 + t], [x0 + BS - 1.2, z0 + t]][side]; if (!downtown || rng() < 0.4) this.props.addTree(p[0], p[1], rnd(0.7, 1), rng() < 0.2); }
        if (industrial) { this._fence(x0 + 1, z0 + 1, x0 + BS - 1, z0 + BS - 1, 12); }
      }
    }
    // merge static geometry
    const mk = (geos, mat, shadow = false, recv = true) => { if (!geos.length) return; const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = shadow; m.receiveShadow = recv; this.root.add(m); return m; };
    const swMat = new THREE.MeshStandardMaterial({ map: (() => { const t = T.concreteTexture(); t.repeat.set(12, 12); return t; })(), roughness: 0.95, color: 0xb0b3ba });
    mk(slabs, swMat);
    const gt = T.grassTexture(); gt.repeat.set(10, 10);
    const grassMat = new THREE.MeshStandardMaterial({ map: gt, roughness: 1, color: 0xa8c89a });
    const pm = mk(parks.map((g) => { this._fixUV(g, 10); return g; }), grassMat);
    mk(water, new THREE.MeshStandardMaterial({ color: 0x1b4a6e, roughness: 0.05, metalness: 0.9 }));
    const lotTex = T.asphaltTexture(true); lotTex.repeat.set(9, 9);
    mk(lotsA.map((g) => { this._fixUV(g, 9); return g; }), new THREE.MeshStandardMaterial({ map: lotTex, roughness: 0.85 }));
    const dt = T.driftTexture();
    for (const d of driftQ) { const m = new THREE.Mesh(new THREE.PlaneGeometry(BS, BS).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: dt, roughness: 0.85 })); m.position.set(d.cx, 0.146, d.cz); m.receiveShadow = true; this.root.add(m); }
    const bm = mk(bld, bMat, true, true);
    mk(trim, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.2 }), true, true);
  }

  _fixUV(g, rep) { const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 1, uv.getY(k) * 1); }

  /** Box with facade UVs: windows tile every 16m x 12.8m. Roof/bottom sample a plain wall pixel. */
  _addBuilding(list, trim, x, z, w, d, h, color, rng, industrial, y0 = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, off = ((rng() * 4) | 0) / 4;
    const faceW = [d, d, 0, 0, w, w];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const idx = f * 4 + k;
      if (f === 2 || f === 3) uv.setXY(idx, 0.01, 0.01);
      else uv.setXY(idx, uv.getX(idx) * faceW[f] / 16 + off, uv.getY(idx) * h / 12.8 + (y0 % 12.8) / 12.8);
    }
    g.translate(x + w / 2, y0 + h / 2, z + d / 2);
    const cc = new THREE.Color(industrial ? 0x9aa0a8 : color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = cc.r; arr[i * 3 + 1] = cc.g; arr[i * 3 + 2] = cc.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); g.deleteAttribute('uv1');
    list.push(g);
    // roof details
    const top = y0 + h, rc = new THREE.Color(0x5e636c);
    const add = (bw, bh, bd, bx, bz, col) => { const t = new THREE.BoxGeometry(bw, bh, bd).translate(bx, top + bh / 2, bz); const cl = new THREE.Color(col), nn = t.attributes.position.count, a = new Float32Array(nn * 3); for (let i = 0; i < nn; i++) { a[i * 3] = cl.r; a[i * 3 + 1] = cl.g; a[i * 3 + 2] = cl.b; } t.setAttribute('color', new THREE.BufferAttribute(a, 3)); trim.push(t); };
    for (let k = 0; k < 2 + ((rng() * 2) | 0); k++) add(2 + rng() * 2.5, 1.2, 2 + rng() * 2, x + 2 + rng() * (w - 4), z + 2 + rng() * (d - 4), 0x70757e);
    if (h > 45) { add(0.4, 9, 0.4, x + w / 2, z + d / 2, 0xaaaaaa); }
    add(w + 0.4, 0.5, 0.4, x + w / 2, z, 0x888d96); add(w + 0.4, 0.5, 0.4, x + w / 2, z + d, 0x888d96);
    add(0.4, 0.5, d + 0.4, x, z + d / 2, 0x888d96); add(0.4, 0.5, d + 0.4, x + w, z + d / 2, 0x888d96);
  }

  _fence(x0, z0, x1, z1, gap) {
    const seg = 3.8;
    const run = (ax, az, bx, bz) => {
      const L = Math.hypot(bx - ax, bz - az), n = Math.floor(L / seg), yaw = Math.atan2(-(bz - az), bx - ax);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, off = Math.abs(t - 0.5) * L;
        if (off < gap / 2) continue;                      // entrance
        this.props.add('fence', ax + (bx - ax) * t, az + (bz - az) * t, yaw);
      }
    };
    run(x0, z0, x1, z0); run(x0, z1, x1, z1); run(x0, z0, x0, z1); run(x1, z0, x1, z1);
  }

  // ---------------- bridges ---------------------------------------------------------------------
  _buildBridges() {
    const deckMat = new THREE.MeshStandardMaterial({ map: (() => { const t = T.roadTexture(); return t; })(), roughness: 0.8, side: THREE.DoubleSide });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8e9199, roughness: 0.9, side: THREE.DoubleSide });
    for (const b of this.bridges) {
      const top = [], side = [], bot = [], hw = RW / 2 + 1;
      const pos = [], idx = [], uvs = [];
      const N = Math.round(RAMP_END * 2 / 2.5);
      const map = (u, v) => (b.ax === 'x' ? [b.cx + u, b.cz + v] : [b.cx + v, b.cz + u]);
      const hAt = (u) => { const au = Math.abs(u); return au <= FLAT ? DECK_H : DECK_H * (RAMP_END - au) / (RAMP_END - FLAT); };
      // vertices per station: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right
      for (let k = 0; k <= N; k++) {
        const u = -RAMP_END + (k / N) * RAMP_END * 2, h = hAt(u);
        for (const [v, y] of [[-hw, h + 0.12], [hw, h + 0.12], [-hw, h - 0.9], [hw, h - 0.9]]) { const [x, z] = map(u, v); pos.push(x, Math.max(y, -0.5), z); uvs.push((u + RAMP_END) / 32, v / RW + 0.5); }
      }
      const q = (a, bb, cc, d) => idx.push(a, bb, cc, a, cc, d);
      const mkMesh = (indices, mat, ts) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(indices); g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = true; this.root.add(m); };
      const ti = [], si = [];
      for (let k = 0; k < N; k++) {
        const a = k * 4, n = (k + 1) * 4;
        ti.push(a, n, n + 1, a, n + 1, a + 1);                       // top
        si.push(a, a + 2, n + 2, a, n + 2, n);                        // left side
        si.push(a + 1, n + 1, n + 3, a + 1, n + 3, a + 3);            // right side
        si.push(a + 2, a + 3, n + 3, a + 2, n + 3, n + 2);            // bottom
      }
      mkMesh(ti, deckMat); mkMesh(si, concrete);
      // guard rails (instanced-free: two long merged boxes per side) + colliders on the upper layer
      for (const sv of [-1, 1]) {
        const segs = [];
        for (let k = 0; k < N; k++) {
          const u0 = -RAMP_END + (k / N) * RAMP_END * 2, u1 = u0 + RAMP_END * 2 / N, h0 = hAt(u0), h1 = hAt(u1);
          const [x0, z0] = map(u0, sv * (hw - 0.15)), [x1, z1] = map(u1, sv * (hw - 0.15));
          const len = Math.hypot(x1 - x0, z1 - z0), g = new THREE.BoxGeometry(b.ax === 'x' ? len : 0.3, 0.9, b.ax === 'x' ? 0.3 : len);
          g.rotateX(0); const slope = Math.atan2(h1 - h0, len);
          if (b.ax === 'x') g.rotateZ(slope); else g.rotateX(-slope * Math.sign(1));
          g.translate((x0 + x1) / 2, (h0 + h1) / 2 + 0.55, (z0 + z1) / 2); segs.push(g);
        }
        const m = new THREE.Mesh(mergeGeometries(segs), new THREE.MeshStandardMaterial({ color: 0xb8bcc6, roughness: 0.6, metalness: 0.4 })); m.castShadow = true; this.root.add(m);
        const [ax, az] = map(-RAMP_END, sv * (hw - 0.15)), [bx, bz] = map(RAMP_END, sv * (hw - 0.15));
        this.addBox(Math.min(ax, bx) - 0.2, Math.min(az, bz) - 0.2, Math.max(ax, bx) + 0.2, Math.max(az, bz) + 0.2, 1, 9, false);
      }
      // pillars
      for (const su of [-1, 1]) for (const sv of [-1, 1]) {
        const [px, pz] = map(su * (FLAT - 1), sv * (hw + 0.8));
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, DECK_H, 10), concrete); col.position.set(px, DECK_H / 2 - 0.3, pz); col.castShadow = true; this.root.add(col);
        this.addCircle(px, pz, 1.05, 0, null);
      }
    }
  }

  // ---------------- street props -------------------------------------------------------------
  _buildStreetProps(rng) {
    const P = this.props, signCols = [0xd62828, 0x1f5fbf, 0x1f8a4c, 0xf2c200, 0xffffff];
    const faceYaw = (dx, dz) => Math.atan2(-dz, dx);
    for (let i = 0; i < NR; i++) for (let j = 0; j < NR; j++) {
      const x = c(i), z = c(j);
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const px = x + sx * 10.5, pz = z + sz * 10.5;
        if (Math.abs(px) > HALF + 8 || Math.abs(pz) > HALF + 8) continue;
        if (this.nearBridge(px, pz)) continue;
        // lamp arms point to the intersection centre
        if ((sx + sz + i + j) % 2 === 0 || true) P.add('light', px, pz, faceYaw(-sx, -sz));
      }
      // signs
      for (const [sx, sz] of [[1, 1], [-1, -1]]) {
        const px = x + sx * 9.3, pz = z + sz * 14;
        if (Math.abs(px) < HALF + 8 && Math.abs(pz) < HALF + 8 && !this.nearBridge(px, pz) && rng() < 0.9) P.add('sign', px, pz, 0, signCols[(rng() * 5) | 0]);
        const qx = x + sx * 14, qz = z + sz * 9.3;
        if (Math.abs(qx) < HALF + 8 && Math.abs(qz) < HALF + 8 && !this.nearBridge(qx, qz) && rng() < 0.6) P.add('sign', qx, qz, 0, signCols[(rng() * 5) | 0]);
      }
    }
    // mid-block lights
    for (let i = 0; i < NR; i++) for (let j = 0; j < NR - 1; j++) {
      const mid = (c(j) + c(j + 1)) / 2;
      for (const sd of [-1, 1]) {
        if (!this.nearBridge(c(i) + sd * 9.5, mid)) P.add('light', c(i) + sd * 9.5, mid, faceYaw(-sd, 0));
        if (!this.nearBridge(mid, c(i) + sd * 9.5)) P.add('light', mid, c(i) + sd * 9.5, faceYaw(0, -sd));
      }
    }
  }

  _buildBoundary() {
    const m = new THREE.MeshStandardMaterial({ color: 0x6d7078, roughness: 0.9 }), t = BOUND, th = 1.5, hgt = 3.2;
    for (const [x0, z0, x1, z1] of [[-t, -t, t, -t + th], [-t, t - th, t, t], [-t, -t, -t + th, t], [t - th, -t, t, t]]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, hgt, z1 - z0), m); mesh.position.set((x0 + x1) / 2, hgt / 2, (z0 + z1) / 2); mesh.castShadow = true; this.root.add(mesh);
      this.addBox(x0, z0, x1, z1, 0, hgt, false);
      this.addBox(x0, z0, x1, z1, 1, hgt, false);
    }
    // outer strip: pines along the wall
    for (let k = 0; k < 90; k++) { const a = Math.random() * 4 | 0, p = (Math.random() - 0.5) * 2 * (HALF + 5), o = HALF + 14 + Math.random() * 10; const pt = [[p, -o], [p, o], [-o, p], [o, p]][a]; this.props.addTree(pt[0], pt[1], 1 + Math.random() * 0.6, true); }
  }

  // ---------------- minimap base ------------------------------------------------------------------
  _buildMinimap() {
    const S = 600, scale = S / 800, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'); g.fillStyle = '#10151f'; g.fillRect(0, 0, S, S);
    const tx = (v) => (v + 400) * scale;
    for (const b of this.blocks) {
      g.fillStyle = { park: '#17331f', drift: '#2a2540', lot: '#1d2433', industrial: '#202632', downtown: '#2b3345', city: '#1c2332' }[b.type];
      g.fillRect(tx(b.x0 - 4), tx(b.z0 - 4), (BS + 8) * scale, (BS + 8) * scale);
    }
    g.strokeStyle = '#59647d'; g.lineWidth = RW * scale;
    for (let i = 0; i < NR; i++) { g.beginPath(); g.moveTo(tx(-HALF - 8), tx(c(i))); g.lineTo(tx(HALF + 8), tx(c(i))); g.stroke(); g.beginPath(); g.moveTo(tx(c(i)), tx(-HALF - 8)); g.lineTo(tx(c(i)), tx(HALF + 8)); g.stroke(); }
    g.strokeStyle = '#ffc531'; g.lineWidth = 3;
    for (const b of this.bridges) { g.beginPath(); const [ax, az] = b.ax === 'x' ? [b.cx - RAMP_END, b.cz] : [b.cx, b.cz - RAMP_END], [bx, bz] = b.ax === 'x' ? [b.cx + RAMP_END, b.cz] : [b.cx, b.cz + RAMP_END]; g.moveTo(tx(ax), tx(az)); g.lineTo(tx(bx), tx(bz)); g.stroke(); }
    this.minimap = { canvas: cv, scale, half: 400 };
  }

  // ---------------- day / night ------------------------------------------------------------------------
  /** Set the time of day (hours, 0..24) and update every light-dependent material. */
  setTime(h) {
    this.timeH = h;
    const el = ((h - 6) / 12) * Math.PI;                      // sun elevation angle across the day
    const sinEl = Math.sin(el), az = (h - 6) / 24 * Math.PI * 2;
    const day = clamp((sinEl + 0.12) / 0.4, 0, 1), night = 1 - day;
    this.night = night;
    const dusk = clamp(1 - Math.abs(sinEl) / 0.35, 0, 1) * (sinEl > -0.25 ? 1 : 0);
    const sunDir = new THREE.Vector3(Math.cos(az) * Math.cos(el) * 0.6, Math.max(sinEl, -0.3), Math.sin(az) * Math.cos(el) * 0.6 + 0.4).normalize();
    this.sunDir = sunDir;
    const horizon = new THREE.Color(0x070b1c).lerp(new THREE.Color(0x9cc7e8), day).lerp(new THREE.Color(0xff8a50), dusk * 0.7 * (0.3 + day));
    const topC = new THREE.Color(0x02040c).lerp(new THREE.Color(0x3d7fd1), day).lerp(new THREE.Color(0x2a3a78), dusk * 0.5);
    this.skyMat.uniforms.top.value.copy(topC); this.skyMat.uniforms.horizon.value.copy(horizon);
    this.skyMat.uniforms.sunDir.value.copy(sunDir);
    this.skyMat.uniforms.sunCol.value.set(1, 0.85 - dusk * 0.3, 0.6 - dusk * 0.3).multiplyScalar(day);
    this.scene.background.copy(horizon); this.scene.fog.color.copy(horizon); this.scene.fog.density = lerp(0.0014, 0.0024, night);
    this.starMat.opacity = clamp(night * 1.3 - 0.2, 0, 1);
    this.hillMat.color.copy(horizon).multiplyScalar(0.55);
    this.hemi.color.set(0x8fb4ff).lerp(new THREE.Color(0x24305a), night); this.hemi.groundColor.set(0x4a4a50).lerp(new THREE.Color(0x0c0d14), night);
    this.hemi.intensity = lerp(0.35, 0.8, day);
    // directional light: sun by day, moon by night
    this.sun.color.set(0xfff0d8).lerp(new THREE.Color(0xff9a50), dusk * 0.8).lerp(new THREE.Color(0x7f9cff), night);
    this.sun.intensity = lerp(0.55, 2.5, day) * (0.75 + 0.25 * (1 - dusk));
    this.sunLightDir = day > 0.05 ? sunDir : new THREE.Vector3(-0.3, 0.8, 0.5).normalize();
    this.scene.environmentIntensity = lerp(0.12, 0.55, day);
    this.buildingMat.emissiveIntensity = night * 1.3;
    this.props.lampMat.color.setScalar(lerp(0.5, 1, night)).multiply(new THREE.Color(1, 0.88, 0.66));
    this.props.poolMat.opacity = night * 0.55;
    this.renderer.toneMappingExposure = lerp(0.95, 1.05, day);
    return { day, night };
  }

  /** Keep the shadow frustum centred on the player (snapped to avoid shimmering). */
  updateShadow(x, z) {
    const s = 90 / 1024 * 2; // texel size
    const sx = Math.round(x / s) * s, sz = Math.round(z / s) * s;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.copy(this.sunLightDir).multiplyScalar(160).add(this.sun.target.position);
    this.sun.target.updateMatrixWorld();
    this.sky.position.set(x, 0, z); this.stars.position.set(x, 0, z);
  }

  update(dt) { this.props.update(dt); }
}
