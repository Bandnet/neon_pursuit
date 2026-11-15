// Third-person chase camera with speed-based distance/FOV, drift lag, collision avoidance,
// acceleration kick, impact shake and optional mouse-drag orbit. Includes a menu "fly-over" mode.
import * as THREE from 'three';
import { clamp, damp, dampAngle, angleDiff } from './util.js';

export class CameraRig {
  constructor(camera, world) {
    this.cam = camera; this.world = world; this.mode = 0;
    this.yaw = 0; this.pos = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.shake = 0; this.kick = 0; this.fov = 62; this.baseFov = 62; this.sens = 1;
    this.orbitYaw = 0; this.orbitPitch = 0; this.dragging = false; this.t = 0;
    this.names = ['Chase', 'Far', 'Hood'];
    this.snap = true;
  }
  cycle() { this.mode = (this.mode + 1) % 3; this.snap = true; return this.names[this.mode]; }
  addShake(v) { this.shake = Math.min(1.6, this.shake + v); }

  attachInput(el) {
    el.addEventListener('mousedown', (e) => { this.dragging = true; this.lx = e.clientX; this.ly = e.clientY; });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.orbitYaw -= (e.clientX - this.lx) * 0.006 * this.sens; this.orbitPitch = clamp(this.orbitPitch + (e.clientY - this.ly) * 0.004 * this.sens, -0.4, 0.9);
      this.lx = e.clientX; this.ly = e.clientY;
    });
  }

  /** Follow the player's car. */
  follow(car, dt, nitro) {
    const speed = car.speed, vl = car.fwdSpeed;
    // heading the camera looks along: blend of body yaw and travel direction (drifts reveal the slide)
    const velYaw = speed > 5 && vl > 0 ? Math.atan2(car.vx, car.vz) : car.yaw;
    const target = car.yaw + clamp(angleDiff(velYaw, car.yaw), -0.9, 0.9) * 0.45;
    this.yaw = this.snap ? target : dampAngle(this.yaw, target, speed < 6 ? 3 : 5.5, dt);
    if (!this.dragging) { this.orbitYaw = damp(this.orbitYaw, 0, 2.2, dt); this.orbitPitch = damp(this.orbitPitch, 0, 2.2, dt); }
    const yaw = this.yaw + this.orbitYaw;
    this.kick = damp(this.kick, clamp(car.longAcc * 0.035, -0.8, 1.0), 4, dt);
    this.shake = damp(this.shake, 0, 4.5, dt);
    const cy = car.y;
    let desired, look;
    if (this.mode === 2) {
      const f = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
      desired = new THREE.Vector3(car.x + f.x * 0.35, cy + 1.08, car.z + f.z * 0.35);
      const ly = car.yaw + this.orbitYaw;
      look = new THREE.Vector3(desired.x + Math.sin(ly) * 20, desired.y - 0.5 + this.orbitPitch * -8, desired.z + Math.cos(ly) * 20);
      this.pos.copy(desired); this.look.copy(look);
    } else {
      const far = this.mode === 1;
      const dist = (far ? 11.5 : 7.4) + speed * 0.055 + (nitro ? 1.4 : 0) + this.kick * 0.6;
      const h = (far ? 5.4 : 2.9) + speed * 0.012 + this.orbitPitch * 6;
      const dx = Math.sin(yaw), dz = Math.cos(yaw);
      look = new THREE.Vector3(car.x + dx * 4.5, cy + 1.3, car.z + dz * 4.5);
      desired = new THREE.Vector3(car.x - dx * dist, cy + h, car.z - dz * dist);
      // keep the camera out of buildings
      const t = this.world.clipCamera(car.x, cy + 1.5, car.z, desired.x, desired.y, desired.z);
      desired.set(car.x + (desired.x - car.x) * t, cy + 1.5 + (desired.y - cy - 1.5) * t, car.z + (desired.z - car.z) * t);
      desired.y = Math.max(desired.y, this.world.heightAt(desired.x, desired.z, cy) + 0.8);
      if (car.y < 2.6 && this.world.underDeck(car.x, car.z)) desired.y = Math.min(desired.y, 4.3);   // stay beneath a bridge deck
      if (this.snap) this.pos.copy(desired); else { const k = 1 - Math.exp(-(speed > 25 ? 14 : 9) * dt); this.pos.lerp(desired, k); }
      this.look.lerp(look, this.snap ? 1 : 1 - Math.exp(-14 * dt));
    }
    this.snap = false;
    this.t += dt;
    const s = this.shake * 0.35 + (speed > 40 ? (speed - 40) * 0.0035 : 0) * (nitro ? 2 : 1);
    this.cam.position.set(this.pos.x + (Math.sin(this.t * 53) + Math.sin(this.t * 31)) * s * 0.5, this.pos.y + Math.sin(this.t * 47) * s * 0.5, this.pos.z + Math.cos(this.t * 41) * s * 0.5);
    this.cam.lookAt(this.look);
    const wantFov = this.baseFov + clamp(speed, 0, 70) * 0.2 + (nitro ? 9 : 0) + (this.mode === 2 ? 6 : 0);
    this.fov = damp(this.fov, wantFov, 4, dt);
    if (Math.abs(this.cam.fov - this.fov) > 0.05) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
  }

  /** Slow cinematic orbit used behind the main menu. */
  orbit(dt, cx, cz, radius, height, speed = 0.05) {
    this.t += dt; const a = this.t * speed;
    this.cam.position.set(cx + Math.cos(a) * radius, height, cz + Math.sin(a) * radius);
    this.cam.lookAt(cx, 12, cz);
    if (this.cam.fov !== this.baseFov) { this.cam.fov = this.baseFov; this.cam.updateProjectionMatrix(); }
    this.snap = true;
  }
  /** Showroom turntable around a car. */
  turntable(dt, x, y, z, r = 7.5, ndcX = 0) {
    this.t += dt; const a = this.t * 0.5;
    this.cam.position.set(x + Math.cos(a) * r, y + r * 0.3, z + Math.sin(a) * r);
    this.cam.lookAt(x, y + 0.7, z);
    if (ndcX) {   // slide the view sideways so the car sits in the free part of the screen
      const d = Math.hypot(r, r * 0.3), shift = -ndcX * d * Math.tan(22.5 * Math.PI / 180) * (this.cam.aspect || 1.6);
      const right = new THREE.Vector3(); this.cam.getWorldDirection(right); right.cross(this.cam.up).normalize();
      this.cam.position.addScaledVector(right, shift); this.cam.lookAt(new THREE.Vector3(x, y + 0.7, z).addScaledVector(right, shift));
    }
    if (this.cam.fov !== 45) { this.cam.fov = 45; this.cam.updateProjectionMatrix(); }
    this.snap = true;
  }
}
