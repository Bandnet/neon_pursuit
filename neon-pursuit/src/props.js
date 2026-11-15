// Instanced street props. Everything here is drawn with InstancedMesh (one draw call per part);
// destructible props can be knocked over by cars and then simulated until they come to rest.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildParkedCarGeometry, SharedMats } from './vehicles.js';

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _m = new THREE.Matrix4(), _ax = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

function colored(geo, color) {
  const c = new THREE.Color(color), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
const B = (w, h, d, x, y, z, col) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), col);
const C = (r, h, x, y, z, col, seg = 8) => colored(new THREE.CylinderGeometry(r, r, h, seg).translate(x, y, z), col);

export class Props {
  constructor(scene, glowTex) {
    this.scene = scene;
    this.kinds = {};
    this.active = [];
    this.onSmash = null;
    this.world = null;

    // ----- destructible kinds -----------------------------------------------------
    const metal = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.55 });
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
    const pole = mergeGeometries([C(0.11, 9, 0, 4.5, 0, 0x5d636e), C(0.24, 0.7, 0, 0.35, 0, 0x4a4f58), B(2.0, 0.12, 0.12, 0.95, 8.9, 0, 0x5d636e)]);
    this.addKind('light', [{ geo: pole, mat: metal }, { geo: B(1.1, 0.16, 0.44, 1.9, 8.82, 0, 0xffffff), mat: this.lampMat }], 900, { r: 0.36, resist: 3.4, dmg: 0.35, score: 12, tall: true });
    const spole = C(0.05, 2.7, 0, 1.35, 0, 0x8a8f99);
    this.addKind('sign', [{ geo: spole, mat: metal }, { geo: B(0.8, 0.8, 0.05, 0, 2.45, 0, 0xffffff), mat: plateMat, tint: true }], 400, { r: 0.3, resist: 1.8, dmg: 0.12, score: 6, tall: true });
    const fence = mergeGeometries([B(3.8, 0.07, 0.07, 0, 0.5, 0, 0xb9bdc6), B(3.8, 0.07, 0.07, 0, 0.98, 0, 0xb9bdc6), B(0.1, 1.15, 0.1, -1.85, 0.58, 0, 0x8d929c), B(0.1, 1.15, 0.1, 1.85, 0.58, 0, 0x8d929c), B(3.7, 0.5, 0.02, 0, 0.74, 0, 0x9aa0ab)]);
    this.addKind('fence', [{ geo: fence, mat: metal }], 1500, { r: 1.45, resist: 1.0, dmg: 0.05, score: 3, tall: false });
    const cone = mergeGeometries([colored(new THREE.ConeGeometry(0.2, 0.65, 8).translate(0, 0.36, 0), 0xff6a10), B(0.5, 0.04, 0.5, 0, 0.02, 0, 0x222222), colored(new THREE.CylinderGeometry(0.1, 0.13, 0.1, 8).translate(0, 0.35, 0), 0xffffff)]);
    this.addKind('cone', [{ geo: cone, mat: metal }], 400, { r: 0.28, resist: 0.35, dmg: 0.02, score: 1, tall: false });

    // ----- static kinds ----------------------------------------------------------------
    const trunk = C(0.22, 2.4, 0, 1.2, 0, 0x5b4630);
    this.treeT = this._inst(trunk, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 900);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
    const leaf1 = new THREE.IcosahedronGeometry(1.9, 1).translate(0, 4.0, 0);
    this.treeL = this._inst(leaf1, leafMat, 900); this.treeL.castShadow = true;
    this.treeP = this._inst(new THREE.ConeGeometry(1.7, 5.2, 7).translate(0, 4.2, 0), leafMat, 400); this.treeP.castShadow = true;
    this.treeT.castShadow = true;
    this.nTrees = 0; this.nPines = 0;

    // parked cars (tinted via instanceColor)
    this.parked = this._inst(buildParkedCarGeometry(), SharedMats.parked, 220); this.parked.castShadow = true; this.nParked = 0;

    // light pools on the road (additive, night only)
    const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffcf80, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.poolMat = poolMat;
    this.pools = this._inst(new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2), poolMat, 900);
    this.pools.frustumCulled = false; this.pools.renderOrder = 3;
    this.nPools = 0;
    this.kinds.light.pool = this.pools;
  }

  _inst(geo, mat, max) {
    const m = new THREE.InstancedMesh(geo, mat, max);
    m.count = 0; m.frustumCulled = false; this.scene.add(m);
    return m;
  }

  addKind(name, parts, max, o) {
    const k = { name, ...o, items: [], parts: [], dirty: false };
    for (const p of parts) {
      const mesh = this._inst(p.geo, p.mat, max);
      mesh.castShadow = name !== 'cone';
      k.parts.push({ mesh, tint: !!p.tint });
    }
    this.kinds[name] = k;
  }

  /** Add one prop and its collider. Returns the item. */
  add(name, x, z, yaw = 0, color = null) {
    const k = this.kinds[name];
    if (k.items.length >= k.parts[0].mesh.instanceMatrix.count) return null;
    const it = { kind: k, idx: k.items.length, x, z, y: 0, yaw, state: 0, vx: 0, vz: 0, vy: 0, tilt: 0, tiltV: 0, axx: 0, axz: 1, pool: -1, t: 0 };
    k.items.push(it);
    this._write(it);
    for (const p of k.parts) { p.mesh.count = k.items.length; if (p.tint) p.mesh.setColorAt(it.idx, new THREE.Color(color ?? 0xffffff)); }
    for (const p of k.parts) if (p.tint && p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    if (name === 'light') {
      // pool of light on the ground, offset along the arm
      const px = x + Math.cos(yaw) * 1.9, pz = z - Math.sin(yaw) * 1.9;
      _p.set(px, 0.09, pz); _q.identity(); _m.compose(_p, _q, _s);
      it.pool = this.nPools; this.pools.setMatrixAt(this.nPools++, _m); this.pools.count = this.nPools; this.pools.instanceMatrix.needsUpdate = true;
    }
    it.col = this.world.addCircle(x, z, k.r, 0, it);
    return it;
  }

  _write(it) {
    _p.set(it.x, it.y, it.z);
    _q.setFromAxisAngle(_up, it.yaw);
    if (it.tilt !== 0) { _ax.set(it.axx, 0, it.axz); _q2.setFromAxisAngle(_ax, it.tilt); _q.premultiply(_q2); }
    _m.compose(_p, _q, _s);
    for (const p of it.kind.parts) p.mesh.setMatrixAt(it.idx, _m);
    it.kind.dirty = true;
  }

  addTree(x, z, scale = 1, pine = false, y = 0) {
    if (this.nTrees >= 900) return;
    const i = this.nTrees++;
    const col = pine ? new THREE.Color().setHSL(0.36 + Math.random() * 0.03, 0.45, 0.2 + Math.random() * 0.08) : new THREE.Color().setHSL(0.24 + Math.random() * 0.1, 0.5, 0.26 + Math.random() * 0.12);
    _p.set(x, y, z); _q.setFromAxisAngle(_up, Math.random() * 6.28);
    _s.set(scale, scale * (0.9 + Math.random() * 0.3), scale); _m.compose(_p, _q, _s);
    this.treeT.setMatrixAt(i, _m);
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    if (pine) {
      this.treeL.setMatrixAt(i, hidden); this.treeL.setColorAt(i, col);
      if (this.nPines < 400) { this.treeP.setMatrixAt(this.nPines, _m); this.treeP.setColorAt(this.nPines, col); this.nPines++; }
    } else { this.treeL.setMatrixAt(i, _m); this.treeL.setColorAt(i, col); }
    _s.set(1, 1, 1);
    this.treeT.count = this.treeL.count = this.nTrees; this.treeP.count = this.nPines;
    this.world.addCircle(x, z, 0.5 * scale, 0, null);
  }
  finishTrees() {
    // foliage meshes share the trunk index range; pines only use their own list so hide leaf spheres for pine slots
    for (const m of [this.treeT, this.treeL, this.treeP, this.parked]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  addParkedCar(x, z, yaw, color) {
    if (this.nParked >= 220) return;
    _p.set(x, 0.14, z); _q.setFromAxisAngle(_up, yaw); _s.set(1, 1, 1); _m.compose(_p, _q, _s);
    this.parked.setMatrixAt(this.nParked, _m); this.parked.setColorAt(this.nParked, new THREE.Color(color));
    this.nParked++; this.parked.count = this.nParked;
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    for (const o of [-1.3, 1.3]) this.world.addCircle(x + sy * o, z + cy * o, 1.0, 0, null);
    this.parked.instanceMatrix.needsUpdate = true; if (this.parked.instanceColor) this.parked.instanceColor.needsUpdate = true;
  }

  /** Called by the car collision code. Returns true if the prop was knocked over. */
  knock(it, car) {
    if (it.state !== 0) return false;
    const k = it.kind, sp = car.speed || 1;
    it.state = 1;
    const dx = car.vx / sp, dz = car.vz / sp;
    it.vx = car.vx * 0.6; it.vz = car.vz * 0.6;
    it.vy = k.tall ? 0.5 : 2.5 + sp * 0.18;
    it.axx = dz; it.axz = -dx;
    it.tiltV = k.tall ? 1.2 : 6 + sp * 0.2;
    it.spin = (Math.random() - 0.5) * 10;
    this.active.push(it);
    if (it.pool >= 0) { _m.makeScale(0, 0, 0); this.pools.setMatrixAt(it.pool, _m); this.pools.instanceMatrix.needsUpdate = true; }
    if (this.onSmash) this.onSmash(it, car, sp);
    return true;
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const it = this.active[i], k = it.kind;
      it.t += dt;
      it.vy -= 22 * dt;
      it.y += it.vy * dt;
      let grounded = false;
      if (it.y <= 0) { it.y = 0; if (it.vy < -2) it.vy = -it.vy * 0.3; else it.vy = 0; grounded = true; }
      const fr = Math.max(0, 1 - (grounded ? 3.5 : 0.3) * dt);
      it.vx *= fr; it.vz *= fr;
      it.x += it.vx * dt; it.z += it.vz * dt;
      it.tiltV += (k.tall ? 7 : 0) * dt;
      it.tilt = Math.min(1.5, it.tilt + it.tiltV * dt);
      if (!k.tall) it.yaw += it.spin * dt * (grounded ? 0.3 : 1);
      this._write(it);
      if (it.tilt >= 1.5 && grounded && Math.abs(it.vx) + Math.abs(it.vz) < 0.4) { it.state = 2; this.active.splice(i, 1); }
    }
    for (const k of Object.values(this.kinds)) if (k.dirty) { for (const p of k.parts) p.mesh.instanceMatrix.needsUpdate = true; k.dirty = false; }
  }
}
