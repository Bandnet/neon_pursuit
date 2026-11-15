// Arcade-simulation vehicle dynamics.
//
// Model: a planar rigid body with a "bicycle" tyre model. Each axle produces a lateral force from its slip
// angle (linear region + saturation) and the longitudinal force (drive/brake) shares the same friction
// circle, so power-oversteer, handbrake drifts and understeer under braking all emerge naturally.
// Load transfer shifts grip front/rear under acceleration and braking, which gives the car weight.
// Collisions use three circles per car and a full impulse solver (linear + angular) vs. statics and cars.
import { clamp, wrapAngle, lerp, damp } from './util.js';

const smoothS = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const G = 9.81;
const STEER_RATE = 7.5;
const TIRE_K = 2.2;   // global tyre stiffness multiplier (per-car kf/kr scale it)

export class Car {
  /**
   * @param spec handling spec (see data.js)
   * @param opts {upgrades, perf}
   */
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.x = 0; this.z = 0; this.y = 0; this.yaw = 0;
    this.vx = 0; this.vz = 0; this.w = 0;
    this.steer = 0; this.pitch = 0; this.roll = 0;
    this.damage = 0; this.wrecked = false;
    this.nitro = 1; this.nitroOn = false; this.nitroLock = false;
    this.input = { throttle: 0, brake: 0, steer: 0, hand: 0, nitro: false };
    this.perf = opts.perf || 1;             // AI difficulty scale (speed + power)
    this.layer = 0;
    this.drifting = false; this.slip = 0; this.slipF = 0; this.slipR = 0;
    this.longAcc = 0; this.latAcc = 0; this.axPrev = 0;
    this.pull = (Math.random() < 0.5 ? -1 : 1);
    this.lastHitT = -99; this.lastHitByPlayer = false;
    this.surface = 1;
    this.rpm = 0; this.gear = 1;
    this.heavy = opts.heavy || 1;
    this.tag = null;                       // owner object (AI controller)
    this.applyUpgrades(opts.upgrades);
    this.r = 0.92;                         // collision circle radius
    this.cd = 1.2;                         // circle offset along the axis
  }

  setDims(L, W) { this.r = W * 0.5 * 0.96; this.cd = Math.max(0, L / 2 - this.r); }

  applyUpgrades(u) {
    const e = u?.engine || 0, t = u?.tires || 0, a = u?.armor || 0, n = u?.nitro || 0;
    const s = this.spec;
    this.P = {
      power: s.power * (1 + 0.04 * e), vmax: s.vmax * (1 + 0.04 * e), mu: s.mu * (1 + 0.04 * t), brake: s.brake * (1 + 0.04 * t),
      dur: s.dur * (1 + 0.15 * a), nitroCap: 1 + 0.2 * n, nitroRegen: 1 + 0.2 * n,
    };
    this.iz = s.a * s.b * 0.5 + 0.75;       // yaw inertia per unit mass
    this.L = s.a + s.b;
  }

  setPose(x, z, yaw) { this.x = x; this.z = z; this.yaw = yaw; this.vx = this.vz = this.w = 0; this.y = 0; }
  fullRepair() { this.damage = 0; this.wrecked = false; this.nitro = 1; }

  get fx() { return Math.sin(this.yaw); }
  get fz() { return Math.cos(this.yaw); }
  get speed() { return Math.hypot(this.vx, this.vz); }
  /** Forward speed (m/s, negative when reversing). */
  get fwdSpeed() { return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw); }
  get mass() { return this.spec.mass * this.heavy; }

  /** Advance the dynamics by dt seconds. `world` supplies surface grip and bridge height. */
  step(dt, world) {
    const s = this.spec, P = this.P, inp = this.input;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const vl = this.vx * sy + this.vz * cy;               // forward speed
    const vy = this.vx * cy - this.vz * sy;               // leftward speed
    const speed = Math.hypot(vl, vy);
    const dmgF = this.damage / 100;
    const health = this.wrecked ? 0 : 1 - 0.42 * Math.pow(dmgF, 1.3);
    this.surface = world ? world.grip(this.x, this.z) : 1;
    const surf = this.spec.offroad ? lerp(this.surface, 1, 0.55) : this.surface;

    // ---- steering --------------------------------------------------------------------
    // steering lock shrinks with speed so that full lock never demands more than the tyres can give
    const vv = Math.max(Math.abs(vl), 3);
    let maxSteer = Math.min(s.steer, Math.atan(2.0 * (s.a + s.b) * P.mu * this.surface * G / (vv * vv)));
    // ---- powerslide state: handbrake starts it, throttle keeps it going, steering sets the angle. Everything below that
    // is flagged `tune` only applies while a powerslide is active, so normal driving is untouched.
    const bp0 = Math.atan2(Math.abs(vy), Math.abs(vl) + 0.5);
    if (!this.ps) { if (inp.hand && vl > 7 && !this.wrecked) { this.ps = true; this.psT = 0; this.psIdle = 0; this.psLow = 0; this.psDir = 0; } }
    else {
      this.psT += dt; this.psIdle = (inp.throttle < 0.15 && !inp.hand) ? this.psIdle + dt : 0;
      this.psLow = (bp0 < 0.1 && !inp.hand) ? this.psLow + dt : 0;          // slide has been steered out
      if (!this.psDir) { if (Math.abs(inp.steer) > 0.15) this.psDir = -Math.sign(inp.steer); else if (Math.abs(vy) > 0.8) this.psDir = Math.sign(vy); }   // side the tail slides to
      if (this.wrecked || vl < 5 || (inp.brake > 0.3 && !inp.hand) || this.psIdle > 0.3 || this.psLow > 0.5 || (this.psT > 1.2 && !this.psDir)) this.ps = false;
    }
    const tune = !!this.ps;
    if (tune && vl > 3) { const bp = Math.atan2(Math.abs(vy), Math.abs(vl) + 0.5); if (bp > 0.12) maxSteer = Math.min(s.steer, Math.max(maxSteer, bp * 1.15 + 0.05)); }   // enough lock to catch a slide
    let target = inp.steer * maxSteer;
    // powerslide: the front wheels counter-steer automatically (aligned with the direction of travel); the player's steering
    // only chooses the slide angle (handled by the regulator below), so full lock can never flick the car into a spin
    if (tune) target = clamp(Math.atan2(vy, Math.abs(vl) + 0.5) * 0.9 + inp.steer * 0.1, -s.steer, s.steer);
    if (dmgF > 0.4) target += this.pull * (dmgF - 0.4) * 0.09;
    target = clamp(target, -s.steer, s.steer);
    const rate = (Math.abs(target) < Math.abs(this.steer) ? STEER_RATE * 1.6 : STEER_RATE) * dt;
    this.steer += clamp(target - this.steer, -rate, rate);
    const delta = this.steer;

    // ---- drive / brake demand (per unit mass) ------------------------------------
    let drive = 0, brake = 0;
    if (inp.throttle > 0) drive = inp.throttle;
    if (inp.brake > 0) { if (vl > 1.2) brake = inp.brake; else drive = -inp.brake; }
    const boosting = inp.nitro && this.nitro > 0.01 && !this.nitroLock && drive > 0.1;
    if (boosting) this.nitro = Math.max(0, this.nitro - dt * 0.3 / P.nitroCap); else this.nitro = Math.min(P.nitroCap, this.nitro + dt * 0.05 * P.nitroRegen * (speed > 2 ? 1 : 0.4));
    if (this.nitro <= 0.01) this.nitroLock = true; else if (this.nitro > 0.25) this.nitroLock = false;
    this.nitroOn = boosting;
    const vmax = P.vmax * this.perf * (0.82 + 0.18 * health) * (boosting ? 1.28 : 1);
    let aDrive = 0;
    if (drive > 0) aDrive = P.power * this.perf * health * drive * Math.max(0, 1 - Math.pow(Math.max(vl, 0) / vmax, 2.3)) * (boosting ? 1.7 : 1);
    else if (drive < 0) aDrive = -P.power * 0.55 * health * -drive * Math.max(0, 1 - Math.pow(Math.max(-vl, 0) / (vmax * 0.28), 1.5));
    if (this.wrecked) aDrive = 0;
    const betaNow = Math.atan2(Math.abs(vy), Math.abs(vl) + 0.5);
    const scrub = speed > 1 ? (tune ? 6 : 7) * Math.sin(Math.min(betaNow, 1.3)) * clamp(speed / 10, 0, 1) : 0;   // tyre scrub: sliding sideways bleeds speed
    // a car that is sliding sideways cannot put its power down: drive force fades with slip angle
    if (aDrive > 0) aDrive *= 1 - (tune ? 0.3 : 0.75) * clamp((betaNow - 0.18) / 0.5, 0, 1);
    if (tune && aDrive > 0 && betaNow > 0.25) aDrive = Math.min(aDrive, scrub + 1.9);   // a powerslide holds speed but never gains it
    const sv = clamp(vl / 1.2, -1, 1);
    const brkAcc = P.brake * surf;

    // ---- axle loads with longitudinal weight transfer ---------------------------
    const L = this.L, h = 0.55;
    const Nf = Math.max(2, G * s.b / L - this.axPrev * h / L);
    const Nr = Math.max(2, G * s.a / L + this.axPrev * h / L);
    const sf = s.drive === 'fwd' ? 1 : s.drive === 'awd' ? 0.4 : 0;
    const sr = 1 - sf;
    const hand = inp.hand;
    const aero = 1 + 0.22 * Math.min(1, (speed * speed) / (P.vmax * P.vmax));
    const muF = P.mu * surf * aero, muR = P.mu * surf * aero * (hand ? 0.42 : 1.05);
    // drift tune: power on the rear axle breaks traction progressively (throttle = drift angle)
    const rwdAmt = s.drive === 'rwd' ? 1 : s.drive === 'awd' ? 0.6 : 0.3;
    const pwrOS = tune && !hand && drive > 0 ? 1 - 0.13 * drive * rwdAmt * clamp((speed - 6) / 10, 0, 1) : 1;
    // sliding hysteresis: once the rear is sliding, kinetic grip is lower than static grip, so a drift holds while the throttle stays on
    this.slideAmt = lerp(this.slideAmt || 0, tune ? (drive > 0.25 ? 0.8 : 0.3) : 0, Math.min(1, dt * 6));
    const muRd = muR * pwrOS * (1 - 0.3 * this.slideAmt * (drive > 0.25 ? 1 : 0.3));
    let Fxf = aDrive * sf - sv * brake * brkAcc * 0.62;
    let Fxr = aDrive * sr - sv * brake * brkAcc * 0.38 - sv * hand * 5;
    const capF = muF * Nf, capR = muRd * Nr;
    // ABS-like braking: the brakes never use up all of the tyres' grip, so you can still steer (and the tail stays put) while braking
    if (!hand) { Fxf = Math.max(Fxf, -0.9 * capF); Fxr = Math.max(Fxr, -0.62 * capR); }
    Fxf = clamp(Fxf, -capF, capF);
    Fxr = clamp(Fxr, -capR, capR);
    const lyF = Math.sqrt(Math.max(0, capF * capF - Fxf * Fxf)), lyR = Math.sqrt(Math.max(0, capR * capR - Fxr * Fxr));
    const FyMaxF = Math.max(0.22 * capF, lyF), FyMaxR = Math.max(0.2 * capR, lyR);

    // ---- slip angles and lateral forces ------------------------------------------
    // slip angles measured in each wheel's own frame, so steering and grip behave correctly in reverse too
    const vxs = Math.max(Math.abs(vl), 3);
    const sd0 = Math.sin(delta), cd0 = Math.cos(delta), vyF = vy + s.a * this.w;
    const latF = vyF * cd0 - vl * sd0, lonF = vl * cd0 + vyF * sd0;
    const alF = Math.atan2(latF, Math.max(Math.abs(lonF), vxs));
    const alR = Math.atan2(vy - s.b * this.w, vxs);
    let Fyf = clamp(-s.kf * TIRE_K * alF * (Nf / (G * s.b / L)) * 0.9, -FyMaxF, FyMaxF);
    let Fyr = clamp(-s.kr * TIRE_K * alR * (Nr / (G * s.a / L)) * 0.9, -FyMaxR, FyMaxR);
    this.slipF = alF; this.slipR = alR;

    // ---- resistances ----------------------------------------------------------------
    const roll = (this.surface < 0.9 ? 0.9 : 0.25) + 0.0;
    const resist = -s.drag * speed * vl - Math.sign(vl) * Math.min(Math.abs(vl) / dt * 0.5, roll + (drive === 0 && !brake ? 0.9 : 0));

    // ---- forces -> accelerations (local frame) -----------------------------------
    const cd = Math.cos(delta), sd = Math.sin(delta);
    const axL = Fxf * cd - Fyf * sd + Fxr + resist - (speed > 1 ? scrub * vl / speed : 0);
    const ayL = Fyf * cd + Fxf * sd + Fyr - (speed > 1 ? scrub * vy / speed : 0);
    let torque = (s.a * (Fyf * cd + Fxf * sd) - s.b * Fyr) / this.iz;
    let wDes = 0, wHold = 0;
    // drift assist: a gentle self-aligning torque keeps slides controllable instead of snapping into spins
    // normal driving: a stabilising torque turns the nose back towards the direction of travel, so lift-off and braking in a corner never snap into spins
    if (vl > 0 && !tune) torque += 4.5 * Math.atan2(vy, Math.abs(vl) + 3) * clamp(speed / 12, 0, 1) * (hand ? 0.3 : 1);
    // drift tune: past ~43 degrees of slip a restoring torque keeps the slide from becoming a spin
    if (tune && this.psDir && vl > 0 && speed > 6) {
      // powerslide regulator (PD on the slide angle): steering chooses the angle (into the turn = bigger, against = smaller),
      // the throttle keeps it alive; lifting off lets the car regrip.
      const sg = this.psDir, sSlip = Math.atan2(vy, Math.abs(vl) + 0.5), tgtB = clamp(0.38 - 0.28 * inp.steer * sg, 0.1, 0.62);
      const hold = (drive > 0.25 ? 1 : 0.35) * clamp(speed / 9, 0, 1), wv = this.latAcc / Math.max(speed, 6);
      wDes = clamp(wv + 4.5 * (sSlip - sg * tgtB), -3, 3); wHold = hold;
    }
    // drift tune: handbrake + steering flicks the tail out on every car (even grippy AWD / FWD ones)
    if (hand && vl > 6 && Math.abs(inp.steer) > 0.15) torque += Math.sign(inp.steer) * clamp(speed / 12, 0, 1) * 5 * Math.max(0, 1 - Math.abs(this.w) / 2.3);
    if (hand && Math.abs(this.w) > 2.4) torque -= (Math.abs(this.w) - 2.4) * 6 * Math.sign(this.w);   // keep handbrake slides controllable
    // arcade steering assist: pull the yaw rate towards what the driver asked for (never beyond what grip allows)
    // so the car turns in crisply at any speed, and fades out once the car is really sliding.
    if (!hand && !this.wrecked && !tune) {
      const wMax = Math.min(1.9, 0.92 * P.mu * aero * surf * G / Math.max(Math.abs(vl), 4));
      const wDes = inp.steer * wMax * (vl >= 0 ? 1 : -0.6);
      const slideFade = 1 - clamp((Math.atan2(Math.abs(vy), Math.abs(vl) + 0.5) - 0.3) / 0.35, 0, 1);
      torque += (wDes - this.w) * 5.5 * clamp(speed / 5, 0, 1) * slideFade;
    }
    this.axPrev = lerp(this.axPrev, axL, Math.min(1, dt * 8));
    this.longAcc = axL; this.latAcc = ayL;

    // local -> world, integrate
    this.vx += (sy * axL + cy * ayL) * dt;
    this.vz += (cy * axL - sy * ayL) * dt;
    this.w += torque * dt;
    if (wHold > 0) this.w += (wDes - this.w) * Math.min(1, dt * 10) * wHold;   // powerslide: yaw rate is driven towards the rate that gives the chosen slide angle
    this.w *= 1 - 0.25 * dt;
    // low-speed settling (prevents jitter when practically stopped)
    if (speed < 0.5 && drive === 0 && !brake) { const k = 1 - Math.min(1, 8 * dt); this.vx *= k; this.vz *= k; this.w *= k; }
    this.yaw = wrapAngle(this.yaw + this.w * dt);
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // ---- derived state ------------------------------------------------------------
    const beta = Math.atan2(Math.abs(vy), Math.abs(vl) + 0.01);
    this.slip = speed > 4 ? beta : 0;
    this.drifting = speed > 9 && beta > 0.26 && vl > 0;
    // engine model for sound / HUD: 6 gears across the speed range
    const frac = clamp(Math.abs(vl) / (P.vmax * 1.05), 0, 1);
    const gears = 6, gi = Math.min(gears - 1, Math.floor(frac * gears * 0.92));
    this.gear = vl < -0.5 ? -1 : gi + 1;
    const within = clamp((frac * gears * 0.92 - gi), 0, 1);
    const wheelspin = (aDrive !== 0 && Math.abs(Fxr) >= capR * 0.98) ? 0.15 : 0;
    this.rpm = clamp(0.18 + within * 0.72 + Math.abs(drive) * 0.07 + wheelspin, 0.15, 1);
    this.burnout = wheelspin > 0 && speed < 20;
    this.throttleIn = Math.max(drive, 0);
  }

  /** Suspension look (pitch / roll) and vertical position. Called once per frame. */
  updateBody(dt, world) {
    const hY = world ? world.heightAt(this.x, this.z, this.y) : 0;
    this.y = damp(this.y, hY, 14, dt);
    this.layer = world && world.flatLayers ? 0 : (this.y > 1.6 ? 1 : 0);   // bridge layer only exists in the city (the mountain road climbs high but is all one layer)
    this.pitch = damp(this.pitch, clamp(-this.axPrev * 0.0075, -0.07, 0.07), 7, dt);
    this.roll = damp(this.roll, clamp(this.latAcc * 0.0085, -0.09, 0.09), 7, dt);
    this.slope = damp(this.slope || 0, world ? clamp(world.slopeAt(this.x, this.z, this.yaw, this.y), -0.3, 0.3) : 0, 12, dt);
  }

  /** Apply collision damage. `closing` = speed along the normal (m/s). */
  hit(closing, otherMass, byPlayer, time) {
    if (closing < 4.5) return 0;
    const ratio = clamp(2 * otherMass / (otherMass + this.mass), 0.35, 1.7);
    const d = 0.016 * closing * closing * ratio / this.P.dur;
    this.lastHitT = time; this.lastHitByPlayer = byPlayer;
    this.damage = Math.min(100, this.damage + d);
    if (this.damage >= 100) this.wrecked = true;
    return d;
  }

  /** Circle centres used for collision. */
  circles(out) {
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    for (let i = 0; i < 3; i++) {
      const o = (i - 1) * this.cd;
      out[i * 2] = this.x + sy * o; out[i * 2 + 1] = this.z + cy * o;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------
// Collision solving
// ---------------------------------------------------------------------------------------
const _c = new Float32Array(6), _c2 = new Float32Array(6);

/**
 * Apply an impulse at contact offset (rx,rz) along normal n (pointing towards `car`).
 * `other` (optional) is the second dynamic body. Returns the closing speed along the normal.
 */
function impulse(car, other, rx, rz, nx, nz, e, orx = 0, orz = 0) {
  const mA = car.mass, iA = car.mass * car.iz;
  // velocity of contact point on the car
  const vax = car.vx + car.w * rz, vaz = car.vz - car.w * rx;
  let vbx = 0, vbz = 0, mB = 0, iB = 0;
  if (other) { vbx = other.vx + other.w * orz; vbz = other.vz - other.w * orx; mB = other.mass; iB = other.mass * other.iz; }
  const rvx = vax - vbx, rvz = vaz - vbz;
  const vn = rvx * nx + rvz * nz;
  if (vn >= 0) return 0;                          // separating
  const crA = rz * nx - rx * nz;
  let denom = 1 / mA + (crA * crA) / iA;
  let crB = 0;
  if (other) { crB = orz * nx - orx * nz; denom += 1 / mB + (crB * crB) / iB; }
  const j = -(1 + e) * vn / denom;
  const jx = j * nx, jz = j * nz;
  car.vx += jx / mA; car.vz += jz / mA; car.w += (jx * rz - jz * rx) / iA;
  if (other) { other.vx -= jx / mB; other.vz -= jz / mB; other.w -= (jx * orz - jz * orx) / iB; }
  // a little tangential friction so cars do not slide frictionlessly along walls
  const tx = -nz, tz = nx;
  const vt = rvx * tx + rvz * tz;
  const jt = clamp(-vt * 0.18 / denom, -j * 0.35, j * 0.35);
  car.vx += jt * tx / mA; car.vz += jt * tz / mA;
  if (other) { other.vx -= jt * tx / mB; other.vz -= jt * tz / mB; }
  return -vn;
}

/** Resolve one car against all nearby world colliders. Callback receives impact details. */
export function collideWorld(car, world, time, onImpact) {
  car.circles(_c);
  const r = car.r;
  for (let i = 0; i < 3; i++) {
    const cx = _c[i * 2], cz = _c[i * 2 + 1];
    const list = world.near(cx, cz, r + 1.5, car.layer);
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      let nx, nz, pen;
      if (c.t === 0) {
        const dx = cx - c.x, dz = cz - c.z, d = Math.hypot(dx, dz), rr = r + c.r;
        if (d >= rr) continue;
        if (d < 1e-4) { nx = 1; nz = 0; } else { nx = dx / d; nz = dz / d; }
        pen = rr - d;
      } else {
        const px = clamp(cx, c.x0, c.x1), pz = clamp(cz, c.z0, c.z1);
        let dx = cx - px, dz = cz - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = r - d; }
        else { // centre inside the box: push out through the nearest face
          const l = cx - c.x0, rgt = c.x1 - cx, t = cz - c.z0, b = c.z1 - cz, m = Math.min(l, rgt, t, b);
          if (m === l) { nx = -1; nz = 0; } else if (m === rgt) { nx = 1; nz = 0; } else if (m === t) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
          pen = m + r;
        }
      }
      // destructible props: knock them over instead of stopping dead when going fast enough
      if (c.dest) {
        const closing = -(car.vx * nx + car.vz * nz);
        if (closing > 2.2 && world.knock(c.dest, car, nx, nz)) {
          const resist = c.dest.kind.resist;
          const sp = car.speed;
          if (sp > 0.1) { const k = Math.max(0, 1 - resist / sp); car.vx *= k; car.vz *= k; }
          car.hit(closing * c.dest.kind.dmg, 400, car.tag?.isPlayer, time);
          onImpact(car, null, closing * 0.4, cx - nx * r, cz - nz * r, nx, nz, c.dest);
          continue;
        }
        if (c.dest.state !== 0) continue;
      }
      car.x += nx * pen * 0.85; car.z += nz * pen * 0.85;
      _c[i * 2] += nx * pen * 0.85; _c[i * 2 + 1] += nz * pen * 0.85;
      const px = cx - nx * r, pz = cz - nz * r;
      const closing = impulse(car, null, px - car.x, pz - car.z, nx, nz, 0.22);
      if (closing > 0.5) {
        car.hit(closing, 1e5 * 0.02, car.tag?.isPlayer, time);
        onImpact(car, null, closing, px, pz, nx, nz, null);
      }
    }
  }
}

/** Resolve a pair of cars (three circles each). */
export function collideCars(a, b, time, onImpact) {
  const dx0 = a.x - b.x, dz0 = a.z - b.z, reach = 4.2 + 4.2;
  if (dx0 * dx0 + dz0 * dz0 > reach * reach || a.layer !== b.layer) return;
  a.circles(_c); b.circles(_c2);
  const rr = a.r + b.r;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const ax = _c[i * 2] , az = _c[i * 2 + 1], bx = _c2[j * 2], bz = _c2[j * 2 + 1];
    const dx = ax - bx, dz = az - bz, d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2) || 1e-3, nx = dx / d, nz = dz / d, pen = rr - d;
    const ma = a.mass, mb = b.mass, tot = ma + mb;
    a.x += nx * pen * 0.5 * (mb / tot) * 1.7 * 0.5; a.z += nz * pen * 0.5 * (mb / tot) * 1.7 * 0.5;
    b.x -= nx * pen * 0.5 * (ma / tot) * 1.7 * 0.5; b.z -= nz * pen * 0.5 * (ma / tot) * 1.7 * 0.5;
    const px = bx + nx * b.r, pz = bz + nz * b.r;
    const closing = impulse(a, b, px - a.x, pz - a.z, nx, nz, 0.3, px - b.x, pz - b.z);
    if (closing > 0.5) {
      a.hit(closing, mb, b.tag?.isPlayer, time);
      b.hit(closing, ma, a.tag?.isPlayer, time);
      onImpact(a, b, closing, px, pz, nx, nz, null);
    }
    // refresh circle positions after the correction
    a.circles(_c); b.circles(_c2);
  }
}
