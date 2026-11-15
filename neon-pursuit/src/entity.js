// A Vehicle couples the physics body (Car) with its 3D model, lights and visual effects.
import * as THREE from 'three';
import { Car } from './physics.js';
import { buildCar } from './vehicles.js';
import { damp, clamp } from './util.js';

const DARKEN = new THREE.Color(0x1a1512);

export class Vehicle {
  constructor(scene, spec, bodyKind, paint, o = {}) {
    this.scene = scene;
    this.car = new Car(spec, { upgrades: o.upgrades, perf: o.perf, heavy: o.heavy });
    this.car.tag = this;
    this.model = buildCar(bodyKind, paint);
    this.car.setDims(this.model.dims.L, this.model.dims.W);
    this.basePaint = new THREE.Color(paint);
    this.isPlayer = !!o.isPlayer; this.kind = o.kind || 'traffic';
    this.model.group.rotation.order = 'YXZ';
    scene.add(this.model.group);
    this.phase = Math.random() * 10;
    this.shadow = null; this.active = true;
    this.wheelAngle = 0; this.braking = false;
    // headlight pool on the road (night)
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), o.glowMat);
    this.glow.scale.set(7, 1, 15); this.glow.frustumCulled = false; this.glow.renderOrder = 3;
    scene.add(this.glow);
    this.smokeT = 0;
  }
  get x() { return this.car.x; } get z() { return this.car.z; }
  setShadow(on) {
    if (this.shadow === on) return; this.shadow = on;
    this.model.body.children.forEach((m) => { if (m.isMesh) m.castShadow = on; });
  }
  setVisible(v) { this.model.group.visible = v; if (!v) this.glow.visible = false; }
  destroy() { this.scene.remove(this.model.group); this.scene.remove(this.glow); }

  /** Sync the mesh with the physics state. `t` = elapsed time. */
  sync(dt, t, night, fx) {
    const car = this.car, m = this.model, g = m.group;
    g.position.set(car.x, car.y, car.z);
    g.rotation.set(-(car.slope || 0), car.yaw, 0);
    m.body.rotation.set(car.pitch, 0, car.roll);
    const vl = car.fwdSpeed;
    this.wheelAngle += vl * dt;
    for (const w of m.wheels) {
      if (w.front) w.pivot.rotation.y = car.steer;
      w.mesh.rotation.x = this.wheelAngle / m.dims.wr;
    }
    // damage tint
    const dmg = car.damage / 100;
    m.paintMat.color.copy(this.basePaint).lerp(DARKEN, dmg * 0.55);
    // brake / tail lights
    const braking = (car.input.brake > 0.1 && vl > 1) || car.input.hand;
    m.tailMat.color.setScalar(braking ? 1 : 0.5 + night * 0.25).multiply(new THREE.Color(1, 0.12, 0.1).addScalar(braking ? 0.1 : 0));
    // police flashers
    if (m.barRMat) {
      const on = Math.floor((t + this.phase) * 8) % 2 === 0;
      const on2 = Math.floor((t + this.phase) * 8 + 1) % 2 === 0;
      m.barRMat.color.setRGB(on ? 1 : 0.12, 0, 0); m.barBMat.color.setRGB(0, 0, on2 ? 1 : 0.14);
      this.flash = on ? 1 : on2 ? -1 : 0;
    }
    // headlight pool
    const showG = night > 0.12 && !car.wrecked;
    this.glow.visible = showG && g.visible;
    if (showG) { this.glow.position.set(car.x + Math.sin(car.yaw) * 10, car.y + 0.1, car.z + Math.cos(car.yaw) * 10); this.glow.rotation.y = car.yaw; }
    // damage smoke / fire
    if (dmg > 0.45 && fx) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = dmg > 0.8 ? 0.04 : 0.1;
        const fxp = car.x + Math.sin(car.yaw) * m.dims.L * 0.3, fzp = car.z + Math.cos(car.yaw) * m.dims.L * 0.3;
        fx.smoke(fxp, car.y + 1.0, fzp, dmg > 0.8 ? 0x1a1a1a : 0x777777, dmg > 0.8 ? 1.6 : 1.1);
        if (dmg > 0.85 && Math.random() < 0.5) fx.fire(fxp, car.y + 0.9, fzp);
      }
    }
  }
}
