// Civilian traffic: lane-following cars on the road grid with simple obstacle braking.
import * as THREE from 'three';
import { Vehicle } from './entity.js';
import { World, c, NR, HALF } from './world.js';
import { clamp, angleDiff, pick, rand } from './util.js';
import { COLORS_TRAFFIC } from './data.js';

const TYPES = [
  { body: 'sedan', mass: 1400, power: 9, vmax: 22, kf: 56, kr: 60, mu: 1.1, brake: 18, steer: 0.5, dur: 1, drive: 'fwd', a: 1.35, b: 1.4, drag: 0.0013, nitro: 0 },
  { body: 'hatch', mass: 1100, power: 9.5, vmax: 21, kf: 58, kr: 62, mu: 1.1, brake: 18, steer: 0.52, dur: 0.9, drive: 'fwd', a: 1.15, b: 1.2, drag: 0.0013, nitro: 0 },
  { body: 'van', mass: 2300, power: 7, vmax: 19, kf: 54, kr: 58, mu: 1.05, brake: 16, steer: 0.45, dur: 1.4, drive: 'rwd', a: 1.6, b: 1.6, drag: 0.0015, nitro: 0 },
  { body: 'pickup', mass: 2000, power: 8, vmax: 22, kf: 54, kr: 58, mu: 1.05, brake: 17, steer: 0.48, dur: 1.3, drive: 'rwd', a: 1.6, b: 1.6, drag: 0.0014, nitro: 0 },
];

class TrafficAI {
  constructor(v) { this.v = v; this.dir = 0; this.cruise = 13; this.pending = null; this.decided = -1; this.stuck = 0; this.rev = 0; }
  place(x, z, dir) {
    this.dir = dir; this.pending = null; this.decided = -1; this.stuck = 0; this.rev = 0;
    const [ox, oz] = World.laneOff(dir);
    const car = this.v.car;
    const i = Math.round(x / 90 + 4), j = Math.round(z / 90 + 4);
    const px = dir % 2 === 0 ? c(i) + ox : x, pz = dir % 2 === 1 ? c(j) + oz : z;
    car.setPose(px, pz, World.dirYaw(dir)); car.fullRepair(); car.damage = 0;
    const sp = this.cruise * 0.8, [dx, dz] = World.dirVec(dir); car.vx = dx * sp; car.vz = dz * sp;
  }
  update(dt, world, others) {
    const v = this.v, car = v.car, inp = car.input;
    if (car.wrecked || car.damage > 88) { inp.throttle = 0; inp.brake = 1; inp.steer = 0; return; }
    const dir = this.dir, [dx, dz] = World.dirVec(dir), alongZ = dir % 2 === 0;
    const spd = car.speed, fs = car.fwdSpeed;
    const look = 9 + spd * 0.55;
    const [ox, oz] = World.laneOff(dir);
    const s = alongZ ? car.z : car.x, k = s / 90 + 4, sgn = dx + dz;
    const nodeIdx = sgn > 0 ? Math.ceil(k - 0.02) : Math.floor(k + 0.02);
    const dN = Math.abs(c(nodeIdx) - s);
    const cross = Math.round((alongZ ? car.x : car.z) / 90 + 4);
    // decide a manoeuvre when approaching an intersection
    const key = nodeIdx * 100 + cross + dir * 10000;
    if (this.decided !== key && dN < 26 && nodeIdx >= 0 && nodeIdx < NR) {
      this.decided = key;
      const opts = [];
      const right = (dir + 3) % 4, left = (dir + 1) % 4;
      const ok = (d) => { const [ex, ez] = World.dirVec(d); const ni = (alongZ ? cross : nodeIdx) + ex, nj = (alongZ ? nodeIdx : cross) + ez; return ni >= 0 && ni < NR && nj >= 0 && nj < NR; };
      if (ok(dir)) opts.push(dir, dir, dir); if (ok(right)) opts.push(right); if (ok(left)) opts.push(left);
      // never turn while on a bridge ramp / deck: the only exits are the two ends
      if (car.y > 1.2) this.pending = { node: nodeIdx, dir };
      else this.pending = opts.length ? { node: nodeIdx, dir: pick(opts) } : { node: nodeIdx, dir: right };
    }
    if (this.pending && this.pending.dir !== dir) {
      const turnRight = this.pending.dir === (dir + 3) % 4, trig = turnRight ? 8.5 : 6;
      if (dN < trig) { this.dir = this.pending.dir; this.pending = null; }
    } else if (this.pending && dN < 3) this.pending = null;
    // pure-pursuit target on the (possibly new) lane
    const d2 = this.dir, [ex, ez] = World.dirVec(d2), [lx, lz] = World.laneOff(d2), az = d2 % 2 === 0;
    const ci = Math.round(car.x / 90 + 4), cj = Math.round(car.z / 90 + 4);
    const tx = az ? c(ci) + lx : car.x + ex * look, tz = az ? car.z + ez * look : c(cj) + lz;
    const err = angleDiff(Math.atan2(tx - car.x, tz - car.z), car.yaw);
    inp.steer = clamp(err * 1.9, -1, 1);
    // speed management
    let vt = this.cruise;
    if (this.pending && this.pending.dir !== this.dir && dN < 30) vt = Math.min(vt, 7.5);
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
    for (let i = 0; i < others.length; i++) {
      const o = others[i].car; if (o === car || o.layer !== car.layer) continue;
      const rx = o.x - car.x, rz = o.z - car.z; if (rx * rx + rz * rz > 1100) continue;
      const lf = rx * sy + rz * cy, lt = rx * cy - rz * sy;
      if (lf > 0 && Math.abs(lt) < 2.6 + Math.min(1.5, Math.abs(err) * 3)) {
        const gap = lf - 5, sf = 4 + Math.max(0, fs) * 0.9;
        if (gap < sf) vt = Math.min(vt, Math.max(0, o.fwdSpeed * 0.9 + (gap - 1.5) * 0.9));
      }
    }
    // reverse out of a jam
    if (this.rev > 0) { this.rev -= dt; inp.throttle = 0; inp.brake = 1; inp.steer = -inp.steer; return; }
    if (fs < 0.8 && vt > 3) { this.stuck += dt; if (this.stuck > 3) { this.stuck = 0; this.rev = 1.3; } } else this.stuck = 0;
    const m = vt - (car.slip > 0.25 ? Math.max(fs, spd * 0.9) : fs);
    inp.throttle = car.slip > 0.4 ? 0 : m > 0.5 ? clamp(m * 0.35, 0, 0.75) : 0;
    inp.brake = m < -1.5 ? clamp(-m * 0.22, 0, 1) : 0;
    inp.hand = 0; inp.nitro = false;
  }
}

export class TrafficManager {
  constructor(scene, world, glowMat) {
    this.scene = scene; this.world = world; this.glowMat = glowMat; this.list = []; this.cars = [];
  }
  setCount(n, player) {
    while (this.list.length < n) {
      const T = pick(TYPES);
      const v = new Vehicle(this.scene, T, T.body, pick(COLORS_TRAFFIC), { kind: 'traffic', glowMat: this.glowMat });
      const ai = new TrafficAI(v); ai.cruise = rand(11, 17);
      v.ai = ai; v.car.tag = v; this.list.push(v); this._respawn(v, player, 60, 300);
    }
    while (this.list.length > n) this.list.pop().destroy();
  }
  _respawn(v, player, minD, maxD) {
    const p = this.world.randomRoadPoint(player.x, player.z, minD, maxD);
    if (!p) { v.setVisible(false); v.far = true; return; }
    v.ai.place(p.x, p.z, p.dir); v.car.layer = 0; v.car.y = 0; v.setVisible(true); v.far = false; v.car.input.brake = 0;
  }
  /** Re-seed all traffic around a position (new run). */
  reset(player) { for (const v of this.list) this._respawn(v, player, 40, 280); }
  update(dt, player, everyone) {
    for (const v of this.list) {
      const car = v.car, d = Math.hypot(car.x - player.x, car.z - player.z);
      if (d > 330 || (car.wrecked && d > 90) || v.far) { this._respawn(v, player, 170, 300); continue; }
      v.ai.update(dt, this.world, everyone);
    }
  }
}
