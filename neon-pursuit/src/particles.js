// Pooled GPU-point particle systems (smoke / sparks / debris) and a ring-buffer skid-mark decal mesh.
import * as THREE from 'three';

export class ParticleSystem {
  constructor(scene, cap, { additive = false, gravity = 0, soft = true } = {}) {
    this.cap = cap; this.i = 0; this.gravity = gravity;
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap); this.alpha = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.s0 = new Float32Array(cap); this.s1 = new Float32Array(cap); this.a0 = new Float32Array(cap); this.drag = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
      uniforms: { uScale: { value: 800 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; ${soft ? 'float a = smoothstep(1.0, 0.0, r);' : 'float a = step(r, 1.0);'} if (a * vA < 0.01) discard; gl_FragColor = vec4(vC, a * vA); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5; scene.add(this.points);
    this.geo = g;
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, color, a0 = 1, drag = 1) {
    const k = this.i; this.i = (this.i + 1) % this.cap;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.vel[k * 3] = vx; this.vel[k * 3 + 1] = vy; this.vel[k * 3 + 2] = vz;
    this.life[k] = this.max[k] = life; this.s0[k] = s0; this.s1[k] = s1; this.a0[k] = a0; this.drag[k] = drag;
    this.col[k * 3] = ((color >> 16) & 255) / 255; this.col[k * 3 + 1] = ((color >> 8) & 255) / 255; this.col[k * 3 + 2] = (color & 255) / 255;
  }
  update(dt, scale) {
    this.mat.uniforms.uScale.value = scale;
    const g = this.gravity;
    for (let k = 0; k < this.cap; k++) {
      if (this.life[k] <= 0) { this.size[k] = 0; this.alpha[k] = 0; continue; }
      this.life[k] -= dt;
      const t = 1 - this.life[k] / this.max[k], d = Math.max(0, 1 - this.drag[k] * dt);
      this.vel[k * 3] *= d; this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * d - g * dt; this.vel[k * 3 + 2] *= d;
      this.pos[k * 3] += this.vel[k * 3] * dt; this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt; this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      if (this.pos[k * 3 + 1] < 0.05 && g > 0) { this.pos[k * 3 + 1] = 0.05; this.vel[k * 3 + 1] *= -0.35; }
      this.size[k] = this.s0[k] + (this.s1[k] - this.s0[k]) * t;
      this.alpha[k] = this.a0[k] * (1 - t) * (t < 0.1 ? t * 10 : 1);
    }
    for (const n of ['position', 'aColor', 'aSize', 'aAlpha']) this.geo.attributes[n].needsUpdate = true;
  }
}

/** Dark tyre marks: a ring buffer of flat quads in a single mesh. */
export class SkidMarks {
  constructor(scene, cap = 1400) {
    this.cap = cap; this.n = 0;
    this.pos = new Float32Array(cap * 12); this.alpha = new Float32Array(cap * 4);
    const idx = []; for (let i = 0; i < cap; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.02,0.02,0.025, vA); }' });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; scene.add(this.mesh); this.geo = g;
    this.last = new Map();
  }
  /** Extend the mark for a wheel id from its previous position to (x,z). */
  add(id, x, y, z, intensity, width = 0.28) {
    const prev = this.last.get(id);
    this.last.set(id, { x, z });
    if (!prev) return;
    const dx = x - prev.x, dz = z - prev.z, d = Math.hypot(dx, dz);
    if (d < 0.25 || d > 4) return;
    const nx = -dz / d * width, nz = dx / d * width, k = this.n; this.n = (this.n + 1) % this.cap;
    const o = k * 12, yy = y + 0.075;
    const p = this.pos;
    p[o] = prev.x + nx; p[o + 1] = yy; p[o + 2] = prev.z + nz; p[o + 3] = prev.x - nx; p[o + 4] = yy; p[o + 5] = prev.z - nz;
    p[o + 6] = x - nx; p[o + 7] = yy; p[o + 8] = z - nz; p[o + 9] = x + nx; p[o + 10] = yy; p[o + 11] = z + nz;
    this.alpha[k * 4] = this.alpha[k * 4 + 1] = this.alpha[k * 4 + 2] = this.alpha[k * 4 + 3] = Math.min(0.6, intensity);
    this.dirty = true;
  }
  release(id) { this.last.delete(id); }
  update() {
    if (!this.dirty) return; this.dirty = false;
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aA.needsUpdate = true;
  }
}
