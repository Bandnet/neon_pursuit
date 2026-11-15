// Visual effects hub: smoke, sparks, fire, tyre marks and pooled police point lights.
import * as THREE from 'three';
import { ParticleSystem, SkidMarks } from './particles.js';
import { rand } from './util.js';

export class FX {
  constructor(scene) {
    this.smokeP = new ParticleSystem(scene, 700, { soft: true });
    this.sparkP = new ParticleSystem(scene, 600, { additive: true, gravity: 16, soft: false });
    this.fireP = new ParticleSystem(scene, 260, { additive: true, soft: true });
    this.skid = new SkidMarks(scene, 1600);
    // three pooled point lights for the nearest police cars (kept always in the scene: no shader recompiles)
    this.lights = [];
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xff2020, 0, 30, 1.6); scene.add(l); this.lights.push(l); }
  }
  smoke(x, y, z, color = 0xcccccc, size = 1, alpha = 0.4) {
    this.smokeP.emit(x + rand(-0.2, 0.2), y, z + rand(-0.2, 0.2), rand(-0.6, 0.6), rand(0.8, 2.2), rand(-0.6, 0.6), rand(0.8, 1.5), 0.8 * size, 3.4 * size, color, alpha, 1.1);
  }
  tireSmoke(x, y, z, vx, vz, power) {
    this.smokeP.emit(x, y + 0.15, z, vx * 0.25 + rand(-0.7, 0.7), rand(0.5, 1.6), vz * 0.25 + rand(-0.7, 0.7), rand(0.7, 1.3), 0.7, 2.6 + power, 0xe6e6e6, 0.3 + power * 0.1, 1.4);
  }
  fire(x, y, z) { this.fireP.emit(x + rand(-0.3, 0.3), y, z + rand(-0.3, 0.3), rand(-0.4, 0.4), rand(1.5, 3), rand(-0.4, 0.4), rand(0.3, 0.6), 1.3, 0.2, 0xff7a1a, 0.9, 0.5); }
  /** Impact sparks flying along the surface normal. */
  sparks(x, y, z, nx, nz, power) {
    const n = Math.min(26, 4 + (power | 0));
    for (let i = 0; i < n; i++) {
      const s = rand(4, 10 + power * 0.4);
      this.sparkP.emit(x, y, z, nx * s + rand(-4, 4), rand(1, 6), nz * s + rand(-4, 4), rand(0.25, 0.7), 0.18, 0.08, i % 3 ? 0xffc040 : 0xfff0c0, 1, 0.8);
    }
    for (let i = 0; i < Math.min(8, n * 0.4); i++) this.smokeP.emit(x, y, z, nx * 2 + rand(-1, 1), rand(0.5, 2), nz * 2 + rand(-1, 1), rand(0.6, 1.1), 0.7, 2.4, 0x9a9a9a, 0.3, 1);
  }
  debris(x, y, z, vx, vz, color = 0x888888) { for (let i = 0; i < 5; i++) this.sparkP.emit(x, y, z, vx * 0.5 + rand(-3, 3), rand(2, 7), vz * 0.5 + rand(-3, 3), rand(0.5, 1.1), 0.22, 0.12, color, 1, 0.3); }
  flame(x, y, z, bx, bz) { // nitro exhaust flame
    this.fireP.emit(x, y, z, bx * 8 + rand(-0.6, 0.6), rand(-0.3, 0.5), bz * 8 + rand(-0.6, 0.6), rand(0.12, 0.22), 0.7, 0.15, 0x3aa0ff, 0.9, 1);
    this.fireP.emit(x, y, z, bx * 6 + rand(-0.6, 0.6), rand(-0.2, 0.5), bz * 6 + rand(-0.6, 0.6), rand(0.1, 0.18), 0.5, 0.1, 0xffc060, 0.9, 1);
  }
  update(dt, pxScale) { this.smokeP.update(dt, pxScale); this.sparkP.update(dt, pxScale); this.fireP.update(dt, pxScale); this.skid.update(); }

  /** Assign the pooled lights to the nearest police cars. */
  policeLights(units, px, pz) {
    const near = units.filter((u) => u.active && !u.car.wrecked).map((u) => ({ u, d: (u.car.x - px) ** 2 + (u.car.z - pz) ** 2 })).sort((a, b) => a.d - b.d).slice(0, 3);
    for (let i = 0; i < 3; i++) {
      const l = this.lights[i], e = near[i];
      if (!e) { l.intensity = 0; continue; }
      const car = e.u.car;
      l.position.set(car.x, car.y + 2.4, car.z);
      l.color.set(e.u.flash > 0 ? 0xff1c1c : e.u.flash < 0 ? 0x2a4bff : 0x000000);
      l.intensity = e.u.flash === 0 ? 0 : 40;
    }
  }
}
