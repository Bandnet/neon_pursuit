// Police system: pursuit AI (intercept / flank / block / ram), road-graph pathfinding when the player is
// out of sight, dynamic spawning by wanted level, roadblocks and a tracking helicopter.
import * as THREE from 'three';
import { Vehicle } from './entity.js';
import { World, c, NR, HALF } from './world.js';
import { buildHelicopter } from './vehicles.js';
import { POLICE_TYPES, WANTED } from './data.js';
import { clamp, angleDiff, wrapAngle, rand, pick, damp, lerp } from './util.js';

// ---- BFS on the 9x9 intersection graph ------------------------------------------------------
const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
function bfs(si, sj, ti, tj) {
  if (si === ti && sj === tj) return [[si, sj]];
  const prev = new Int16Array(NR * NR).fill(-1), q = [si * NR + sj]; prev[si * NR + sj] = si * NR + sj;
  while (q.length) {
    const cur = q.shift(), ci = (cur / NR) | 0, cj = cur % NR;
    if (ci === ti && cj === tj) break;
    for (const [dx, dz] of DIRS) {
      const ni = ci + dx, nj = cj + dz; if (ni < 0 || nj < 0 || ni >= NR || nj >= NR) continue;
      const n = ni * NR + nj; if (prev[n] !== -1) continue; prev[n] = cur; q.push(n);
    }
  }
  const out = []; let cur = ti * NR + tj; if (prev[cur] === -1) return [[si, sj]];
  while (cur !== si * NR + sj) { out.push([(cur / NR) | 0, cur % NR]); cur = prev[cur]; }
  out.push([si, sj]); return out.reverse();
}

class PoliceAI {
  constructor(v, type) {
    this.v = v; this.type = type; this.role = 'chaser'; this.side = 1; this.mode = 'pursue';
    this.path = []; this.pathT = 0; this.wp = 0; this.stuck = 0; this.rev = 0; this.los = false; this.losT = 0; this.wreckT = 0;
    this.leave = 0; this.hit = false;
  }
  reset(role) { this.role = role; this.side = Math.random() < 0.5 ? -1 : 1; this.path = []; this.pathT = 0; this.stuck = 0; this.rev = 0; this.wreckT = 0; this.mode = 'pursue'; }

  update(dt, ctx) {
    const v = this.v, car = v.car, inp = car.input, P = ctx.player.car, w = ctx.world, L = ctx.level;
    inp.nitro = false; inp.hand = 0;
    if (car.wrecked) { inp.throttle = 0; inp.brake = 1; inp.steer = 0; this.wreckT += dt; return; }
    if (this.mode === 'block') { inp.throttle = 0; inp.brake = 1; inp.steer = 0; return; }
    const dx = P.x - car.x, dz = P.z - car.z, dist = Math.hypot(dx, dz);
    const aggr = WANTED.aggr[Math.max(1, L)];
    car.perf = (WANTED.speed[Math.max(1, L)] || 1) * (this.type === 'interceptor' ? 1.04 : 1);

    this.losT -= dt;
    if (this.losT <= 0) { this.los = w.hasLOS(car.x, car.z, P.x, P.z); this.losT = 0.25 + Math.random() * 0.2; }
    const sees = (this.los && dist < 160) || dist < 35;
    const known = sees || ctx.heli;
    v.sees = sees;

    let tx, tz, vt = car.P.vmax * car.perf, mode = 'direct';
    const pvx = P.vx, pvz = P.vz, ps = Math.hypot(pvx, pvz);
    const hx = ps > 3 ? pvx / ps : Math.sin(P.yaw), hz = ps > 3 ? pvz / ps : Math.cos(P.yaw);
    if (sees) {
      const lead = clamp(dist / Math.max(car.speed + 6, 12), 0, 2.2) * (this.role === 'rammer' ? 1.1 : 0.9);
      tx = P.x + pvx * lead; tz = P.z + pvz * lead;
      const px = -hz, pz = hx;                                    // perpendicular to player heading
      if (this.role === 'flanker') {
        const off = this.side * (dist > 22 ? clamp(dist * 0.22, 4, 11) : 2.4);
        tx += px * off; tz += pz * off;
      } else if (this.role === 'blocker') {
        const ahead = clamp(30 + ps * 0.9, 30, 75);
        tx = P.x + hx * ahead; tz = P.z + hz * ahead;
        if (Math.hypot(tx - car.x, tz - car.z) < 14) { tx = P.x; tz = P.z; vt = Math.min(vt, 4); }
      } else if (this.role === 'rammer') {
        tx = P.x + pvx * 0.15; tz = P.z + pvz * 0.15;
      }
      if (dist < 24 && this.role === 'chaser' && aggr < 0.6) vt = Math.min(vt, Math.max(ps * 1.1 + 4, 8));
      if (!w.hasLOS(car.x, car.z, tx, tz) && dist > 25) mode = 'path';
    } else mode = 'path';

    if (mode === 'path') {
      this.pathT -= dt;
      const a = w.nearestNode(car.x, car.z);
      let goal = known ? P : ctx.lastKnown;
      if (!known) {   // lost visual contact: sweep the area around the last known position
        if (!this.search || Math.hypot(w.nodePos(this.search.i, this.search.j).x - car.x, w.nodePos(this.search.i, this.search.j).z - car.z) < 25) {
          const n = w.nearestNode(goal.x, goal.z);
          this.search = { i: clamp(n.i + ((Math.random() * 7) | 0) - 3, 0, NR - 1), j: clamp(n.j + ((Math.random() * 7) | 0) - 3, 0, NR - 1) };
        }
        const sp = w.nodePos(this.search.i, this.search.j); goal = sp; vt *= 0.7;
      }
      const b = w.nearestNode(goal.x, goal.z);
      if (this.pathT <= 0) { this.path = bfs(a.i, a.j, b.i, b.j); this.pathT = 0.8; this.wp = 0; }
      // advance waypoints
      const arr = 8 + car.speed * 0.28;
      while (this.wp < this.path.length - 1) {
        const [ni, nj] = this.path[this.wp], np = w.nodePos(ni, nj);
        if (Math.hypot(np.x - car.x, np.z - car.z) < arr) this.wp++; else break;
      }
      const [ni, nj] = this.path[Math.min(this.wp, this.path.length - 1)], np = w.nodePos(ni, nj);
      tx = np.x; tz = np.z;
      if (known && this.wp >= this.path.length - 1 && Math.hypot(tx - car.x, tz - car.z) < arr) { tx = P.x; tz = P.z; }
      // slow for sharp junction turns
      const nx = this.path[this.wp + 1];
      if (nx) {
        const n2 = w.nodePos(nx[0], nx[1]);
        const a1 = Math.atan2(tx - car.x, tz - car.z), a2 = Math.atan2(n2.x - tx, n2.z - tz);
        const turn = Math.abs(angleDiff(a2, a1)), dN = Math.hypot(tx - car.x, tz - car.z);
        if (dN < 25 + car.speed * 1.5) vt = Math.min(vt, lerp(car.P.vmax * car.perf, 15, clamp(turn / 1.3, 0, 1)));
      }
    }
    v.mode = mode;

    // ---- steering toward the target ----
    const err = angleDiff(Math.atan2(tx - car.x, tz - car.z), car.yaw);
    let steer = clamp(err * 2.2, -1, 1);
    const aerr = Math.abs(err);
    vt *= 1 - 0.6 * clamp((aerr - 0.25) / 1.1, 0, 1);

    // ---- avoidance feelers: static geometry + non-player cars ----
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw), La = 7 + car.speed * 0.7;
    const probe = (ang, len) => {
      const a = car.yaw + ang, px = car.x + Math.sin(a) * len, pz = car.z + Math.cos(a) * len;
      return w.blockedAt(px, pz, 1.4, car.layer) || w.blockedAt(car.x + Math.sin(a) * len * 0.5, car.z + Math.cos(a) * len * 0.5, 1.2, car.layer);
    };
    const bc = probe(0, La), bl = probe(0.5, La * 0.85), br = probe(-0.5, La * 0.85);
    if (bc || bl || br) {
      if (bl && !br) steer = Math.min(steer, -0.55); else if (br && !bl) steer = Math.max(steer, 0.55);
      if (bc) { steer = !bl ? 1 : !br ? -1 : (err > 0 ? 1 : -1); vt = Math.min(vt, bl && br ? 5 : 13); }
    }
    for (const o of ctx.others) {
      const oc = o.car; if (oc === car || o === ctx.player || oc.layer !== car.layer) continue;
      const rx = oc.x - car.x, rz = oc.z - car.z; if (rx * rx + rz * rz > 900) continue;
      const lf = rx * sy + rz * cy, lt = rx * cy - rz * sy;
      if (lf > 0 && lf < La * 0.8 && Math.abs(lt) < 2.8) { steer = clamp(steer - Math.sign(lt || 1) * 0.7, -1, 1); vt = Math.min(vt, Math.max(6, oc.fwdSpeed * 0.9 + 4)); }
    }

    // ---- stuck handling ----
    if (this.rev > 0) {
      this.rev -= dt; inp.throttle = 0; inp.brake = 1; inp.steer = -Math.sign(err || 1) * 0.9; return;
    }
    const fs = car.fwdSpeed;
    if (fs < 1.5 && !(dist < 12 && this.role !== 'rammer') && vt > 5) { this.stuck += dt; if (this.stuck > 1.1) { this.stuck = 0; this.rev = 1.0; } } else this.stuck = Math.max(0, this.stuck - dt);

    inp.steer = steer;
    const m = vt - (car.slip > 0.25 ? Math.max(fs, car.speed * 0.9) : fs);
    inp.throttle = m > 0 && car.slip < 0.55 ? clamp(m * 0.5, 0, 1) * (1 - clamp((car.slip - 0.25) / 0.3, 0, 1)) : 0;
    inp.brake = m < -3 ? clamp((-m - 3) * 0.12, 0, 1) : 0;
    // nitro-less, but at high aggression the car boosts power briefly via perf in car.perf
  }
}

export class PoliceManager {
  constructor(scene, world, glowMat) {
    this.scene = scene; this.world = world; this.glowMat = glowMat;
    this.units = []; this.pool = { patrol: [], interceptor: [], swat: [] };
    this.blocks = []; this.spawnT = 0; this.blockT = 10;
    this.heli = null; this.heliObj = null;
    this.takedownCb = null;
    this.glowTex = null; this.maxUnits = 9; this.lastKnown = { x: 0, z: 0 }; this.seen = false;
  }
  get alive() { return this.units.filter((u) => !u.car.wrecked); }

  _acquire(type) {
    let v = this.pool[type].pop();
    if (!v) {
      const S = POLICE_TYPES[type];
      const paint = type === 'swat' ? 0x24272d : type === 'interceptor' ? 0x15171b : 0x101114;
      v = new Vehicle(this.scene, S, S.body, paint, { kind: 'police', glowMat: this.glowMat });
      v.ai = new PoliceAI(v, type); v.type = type;
    }
    v.car.damage = 0; v.car.wrecked = false; v.car.layer = 0; v.car.heavy = 1; v.sees = false; v.setVisible(true); v.active = true; v.counted = false;
    return v;
  }
  _release(v) { v.setVisible(false); v.active = false; v.car.vx = v.car.vz = 0; this.pool[v.type].push(v); }

  pickType(L) {
    const r = Math.random();
    if (L <= 1) return 'patrol';
    if (L === 2) return r < 0.6 ? 'patrol' : 'interceptor';
    if (L === 3) return r < 0.3 ? 'patrol' : r < 0.85 ? 'interceptor' : 'swat';
    return r < 0.15 ? 'patrol' : r < 0.6 ? 'interceptor' : 'swat';
  }
  pickRole(L) {
    const r = Math.random(), a = WANTED.aggr[Math.max(1, L)];
    if (r < 0.4 - a * 0.1) return 'chaser';
    if (r < 0.7) return 'flanker';
    if (r < 0.7 + 0.12 + a * 0.05) return 'blocker';
    return 'rammer';
  }

  spawn(player, L) {
    const p = this.world.randomRoadPoint(player.car.x, player.car.z, 110, 200);
    if (!p) return false;
    const type = this.pickType(L), v = this._acquire(type), car = v.car;
    // face the road direction that points towards the player
    const toX = player.car.x - p.x, toZ = player.car.z - p.z;
    let dir = p.alongX ? (toX > 0 ? 1 : 3) : (toZ > 0 ? 0 : 2);
    const [ox, oz] = World.laneOff(dir, 3.5);
    car.setPose(p.alongX ? p.x : p.x + ox, p.alongX ? p.z + oz : p.z, World.dirYaw(dir));
    const [dx, dz] = World.dirVec(dir); car.vx = dx * 12; car.vz = dz * 12;
    v.ai.reset(this.pickRole(L));
    this.units.push(v); return true;
  }

  /** Per-frame: spawning, AI, roadblocks, helicopter. */
  update(dt, ctx) {
    const { player, level: L } = ctx;
    ctx.lastKnown = this.lastKnown;
    const want = L > 0 ? Math.min(this.maxUnits, WANTED.units[L]) : 0;
    ctx.heli = !!(this.heliObj && this.heliObj.tracking);
    // remove far / long-wrecked units
    for (let i = this.units.length - 1; i >= 0; i--) {
      const v = this.units[i], car = v.car, d = Math.hypot(car.x - player.car.x, car.z - player.car.z);
      if (car.wrecked && !v.counted) { v.counted = true; if (this.takedownCb) this.takedownCb(v, car.lastHitByPlayer && ctx.time - car.lastHitT < 5); }
      const surplus = this.alive.length > want + 1 && d > 140 && L === 0;
      if ((car.wrecked && v.ai.wreckT > 6 && d > 30) || d > 340 || (L === 0 && d > 120)) { this.units.splice(i, 1); this._release(v); }
    }
    this.spawnT -= dt;
    if (this.alive.length < want && this.spawnT <= 0) { if (this.spawn(player, L)) this.spawnT = 1.6 - L * 0.15; else this.spawnT = 0.5; }
    // retire surplus when the heat drops: units far away despawn above
    let seen = ctx.heli;
    for (const v of this.units) { v.ai.update(dt, ctx); if (v.sees && !v.car.wrecked && v.ai.mode !== 'block') seen = true; }
    this.seen = !!seen;
    if (seen) { this.lastKnown.x = player.car.x; this.lastKnown.z = player.car.z; }
    this._roadblocks(dt, ctx);
    this._heli(dt, ctx);
  }

  _roadblocks(dt, ctx) {
    const { player, level: L, time } = ctx, car = player.car;
    // expire
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i]; b.age += dt;
      const d = Math.hypot(b.x - car.x, b.z - car.z);
      if (b.age > 55 || (d > 230 && b.age > 8) || L < 3) { for (const v of b.cars) { const k = this.units.indexOf(v); if (k >= 0) this.units.splice(k, 1); this._release(v); } this.blocks.splice(i, 1); }
    }
    if (L < 3) return;
    this.blockT -= dt;
    if (this.blockT > 0 || this.blocks.length >= 1 || car.speed < 9) return;
    this.blockT = 22 - L * 2;
    const hx = car.vx / car.speed, hz = car.vz / car.speed, ax = Math.abs(hx) > Math.abs(hz);
    const px = car.x + hx * 210, pz = car.z + hz * 210;
    let bx, bz;
    if (ax) { const i = clamp(Math.floor((px + HALF) / 90), 0, 7); bx = c(i) + 45; bz = c(clamp(Math.round(car.z / 90 + 4), 0, 8)); }
    else { const j = clamp(Math.floor((pz + HALF) / 90), 0, 7); bz = c(j) + 45; bx = c(clamp(Math.round(car.x / 90 + 4), 0, 8)); }
    if (this.world.nearBridge(bx, bz) || Math.hypot(bx - car.x, bz - car.z) < 110) return;
    const b = { x: bx, z: bz, age: 0, cars: [] };
    for (const o of [-5.2, 0, 5.2]) {
      const v = this._acquire(o === 0 ? 'interceptor' : 'patrol'), cc = v.car;
      const jx = (Math.random() - 0.5) * 1.2, yaw = (ax ? 0 : Math.PI / 2) + (Math.random() - 0.5) * 0.25;
      cc.setPose(bx + (ax ? jx : o), bz + (ax ? o : jx), yaw);
      v.ai.reset('blocker'); v.ai.mode = 'block'; cc.heavy = 1.6;
      this.units.push(v); b.cars.push(v);
    }
    this.blocks.push(b);
    ctx.onRoadblock && ctx.onRoadblock(b);
  }

  _heli(dt, ctx) {
    const { player, level: L } = ctx, car = player.car;
    if (L >= 4 && !this.heliObj) {
      const h = buildHelicopter(); this.scene.add(h.group);
      const a = Math.random() * 6.28;
      const beam = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 20, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const spot = new THREE.Mesh(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xdff0ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
      beam.frustumCulled = false; spot.frustumCulled = false; this.scene.add(beam, spot);
      this.heliObj = { ...h, x: car.x + Math.cos(a) * 280, z: car.z + Math.sin(a) * 280, y: 36, vx: 0, vz: 0, yaw: 0, beam, spot, sx: car.x, sz: car.z, tracking: false, t: 0, leaving: 0 };
    }
    const H = this.heliObj; if (!H) return;
    H.t += dt;
    if (L < 4) { H.leaving += dt; } else H.leaving = 0;
    const ang = H.t * 0.45, tgtX = car.x + car.vx * 0.9 + Math.cos(ang) * 16, tgtZ = car.z + car.vz * 0.9 + Math.sin(ang) * 16;
    let ax = tgtX - H.x, az = tgtZ - H.z; const d = Math.hypot(ax, az) || 1;
    if (H.leaving > 0) { const aw = Math.atan2(H.z - car.z, H.x - car.x); ax = Math.cos(aw) * 400; az = Math.sin(aw) * 400; }
    const maxV = 58 + L * 2, want = Math.min(maxV, d * 0.9 + 4);
    H.vx = damp(H.vx, (ax / d) * want, 1.4, dt); H.vz = damp(H.vz, (az / d) * want, 1.4, dt);
    H.x += H.vx * dt; H.z += H.vz * dt; H.y = 34 + Math.sin(H.t * 0.7) * 2;
    const sp = Math.hypot(H.vx, H.vz);
    if (sp > 3) H.yaw = Math.atan2(H.vx, H.vz);
    H.group.position.set(H.x, H.y, H.z); H.group.rotation.set(clamp(sp * 0.006, 0, 0.3), H.yaw, 0, 'YXZ');
    H.rotor.rotation.y += dt * 30; H.tailRotor.rotation.x += dt * 35;
    const on = Math.floor(H.t * 6) % 2 === 0; H.red.color.setRGB(on ? 1 : 0.15, 0, 0); H.blue.color.setRGB(0, 0, on ? 0.15 : 1);
    const dh = Math.hypot(H.x - car.x, H.z - car.z);
    H.tracking = H.leaving === 0 && dh < 110;
    // searchlight on the ground (lags behind the car a little)
    H.sx = damp(H.sx, car.x + car.vx * 0.2, 4, dt); H.sz = damp(H.sz, car.z + car.vz * 0.2, 4, dt);
    const night = ctx.night;
    H.beam.visible = H.spot.visible = H.leaving < 3;
    const sdx = H.sx - H.x, sdz = H.sz - H.z, len = Math.hypot(sdx, sdz, H.y);
    H.beam.position.set(H.x, H.y - 1.2, H.z);
    H.beam.scale.set(3.2, 3.2, len); H.beam.lookAt(H.sx, 0, H.sz);
    H.beam.material.opacity = 0.012 + night * 0.05;
    H.spot.position.set(H.sx, 0.2, H.sz); H.spot.scale.set(5, 1, 5); H.spot.material.opacity = 0.05 + night * 0.14;
    if (H.leaving > 8) { this.scene.remove(H.group, H.beam, H.spot); this.heliObj = null; }
  }

  nearestTwo(px, pz) {
    let a = null, b = null, da = 1e9, db = 1e9;
    for (const v of this.units) {
      if (v.car.wrecked || !v.active || v.ai.mode === 'block' && false) continue;
      const d = Math.hypot(v.car.x - px, v.car.z - pz);
      if (d < da) { b = a; db = da; a = v; da = d; } else if (d < db) { b = v; db = d; }
    }
    return [a && { v: a, d: da }, b && { v: b, d: db }];
  }
  clear() {
    for (const v of this.units) this._release(v); this.units.length = 0; this.blocks.length = 0;
    if (this.heliObj) { this.scene.remove(this.heliObj.group, this.heliObj.beam, this.heliObj.spot); this.heliObj = null; }
  }
}
