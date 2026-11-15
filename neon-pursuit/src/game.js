// Core game controller: renderer, main loop, run rules (wanted level, score, challenges), effects wiring.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { World, c, HALF } from './world.js';
import { TougeWorld, PARK } from './touge.js';
import { Vehicle } from './entity.js';
import { carDims } from './vehicles.js';
import { collideWorld, collideCars } from './physics.js';
import { TrafficManager } from './traffic.js';
import { PoliceManager } from './police.js';
import { FX } from './fx.js';
import { CameraRig } from './camera.js';
import { AudioEngine } from './audio.js';
import { glowTexture } from './textures.js';
import { VEHICLES, PAINTS, WANTED, ALL_CHALLENGES as CHALLENGES } from './data.js';
const CASH_PER_POINT = 0.15; // $ earned per point scored
import { loadSave, save, getSave, upgradesOf } from './save.js';
import { clamp, damp, wrapAngle } from './util.js';

const QUALITY = {
  low:    { pr: 0.8,  shadow: 0,    bloom: false, traffic: 10, far: 700 },
  medium: { pr: 1.25, shadow: 1024, bloom: false, traffic: 18, far: 1100 },
  high:   { pr: 1.75, shadow: 2048, bloom: true,  traffic: 26, far: 1500 },
};
const levelOf = (h) => { let l = 0; for (let i = 0; i < 5; i++) if (h >= WANTED.thresholds[i]) l = i + 1; return l; };
const TOD = { day: 12, dusk: 18.3, night: 23 };
let vid = 0;

export class Game {
  constructor(container) {
    this.container = container; this.state = 'boot'; this.ui = null;
    this.keys = new Set(); this.steerIn = 0; this.acc = 0; this.time = 0; this.todH = 17.4; this.todT = 0;
    this.run = null; this.vehicles = []; this.sim = []; this.hudT = 0; this.mapT = 0; this.lastNight = 0;
    this.help = true;
  }

  init() {
    const S = loadSave(); this.save = S;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(r.domElement);
    this.speedCv = document.getElementById('speedlines'); this.speedCtx = this.speedCv.getContext('2d');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.6, 1600);
    this.world = new World(this.scene, r);
    this.worlds = { city: this.world }; this.mapId = 'city';
    this.fx = new FX(this.scene);
    this.audio = new AudioEngine();
    this.glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xfff0c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.traffic = new TrafficManager(this.scene, this.world, this.glowMat);
    this.police = new PoliceManager(this.scene, this.world, this.glowMat);
    this.rig = new CameraRig(this.camera, this.world);
    this.rig.attachInput(r.domElement);
    this.world.props.onSmash = (it, car, sp) => this.onSmash(it, car, sp);
    this.police.takedownCb = (v, byPlayer) => this.onTakedown(v, byPlayer);
    this.onImpactBound = (a, b, sp, px, pz, nx, nz, d) => this.onImpact(a, b, sp, px, pz, nx, nz, d);
    this.setPlayerCar();
    this.applySettings();
    this.setTod();
    this.traffic.setCount(QUALITY[S.settings.quality].traffic, { x: 0, z: 0 });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.steerIn = 0; });   // never leave keys stuck when the window loses focus
    window.addEventListener('pagehide', () => save());
    window.addEventListener('beforeunload', () => save());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
    this.resize();
    this.renderer.compile(this.scene, this.camera);
    this.state = 'menu';
    this.last = performance.now();
    const loop = (t) => { requestAnimationFrame(loop); const dt = Math.min(0.05, (t - this.last) / 1000); this.last = t; this.frame(dt); };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ setup helpers
  resize() {
    const w = innerWidth, h = innerHeight, q = QUALITY[this.save.settings.quality];
    this.pr = Math.min(devicePixelRatio || 1, q.pr);
    this.renderer.setPixelRatio(this.pr); this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.speedCv.width = w; this.speedCv.height = h;
    if (this.composer) { this.composer.setPixelRatio(this.pr); this.composer.setSize(w, h); }
  }

  applySettings() {
    const s = this.save.settings, q = QUALITY[s.quality];
    this.audio.setVolumes(s.sfx, s.music);
    this.rig.sens = s.sens; this.rig.baseFov = s.fov;
    const r = this.renderer, wasShadow = r.shadowMap.enabled;
    r.shadowMap.enabled = q.shadow > 0;
    for (const w of Object.values(this.worlds)) { w.sun.castShadow = q.shadow > 0; if (q.shadow > 0 && w.sun.shadow.mapSize.x !== q.shadow) { w.sun.shadow.mapSize.set(q.shadow, q.shadow); w.sun.shadow.map?.dispose(); w.sun.shadow.map = null; } }
    if (wasShadow !== r.shadowMap.enabled) this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)); });
    this.camera.far = q.far; this.camera.updateProjectionMatrix();
    if (q.bloom && !this.composer) {
      const w = innerWidth, h = innerHeight;
      const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(r, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.5, 0.55, 0.88);
      this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    }
    this.useComposer = q.bloom;
    if (this.traffic) this.traffic.setCount(this.mapId === 'city' ? q.traffic : 0, this.player ? this.player.car : { x: 0, z: 0 });
    this.resize();
    this.setTod();
  }

  /** Switch the active map (the touge world is built the first time it is needed). */
  setMap(id) {
    if (this.mapId === id) return;
    if (!this.worlds[id]) this.worlds[id] = new TougeWorld(this.scene, this.renderer);
    const w = this.worlds[id];
    this.world.deactivate(); w.activate(); this.world = w; this.mapId = id;
    this.traffic.world = w; this.police.world = w; this.rig.world = w;
    w.props.onSmash = (it, car, sp) => this.onSmash(it, car, sp);
    this.police.clear();
    this.applySettings();
    this.traffic.setCount(id === 'city' ? QUALITY[this.save.settings.quality].traffic : 0, { x: 0, z: 0 });
    this.rig.snap = true;
  }

  setTod() {
    const m = this.save.settings.time;
    if (m !== 'cycle') this.todH = TOD[m] ?? 12;
    this.todMode = m;
    this.world.setTime(this.todH);
  }

  setPlayerCar(id = this.save.selected) {
    if (this.player) { this.player.destroy(); }
    const S = this.save, spec = VEHICLES[id];
    const paint = PAINTS[S.colors[id] ?? spec.color];
    const v = this.player = new Vehicle(this.scene, spec, spec.body, paint, { isPlayer: true, kind: 'player', upgrades: upgradesOf(id), glowMat: this.glowMat });
    v.id = vid++; v.car.heavy = 1;
    // real headlights for the player (intensity is driven by the night factor; count never changes)
    this.heads = [];
    for (const sx of [-0.6, 0.6]) {
      const sp = new THREE.SpotLight(0xfff0d0, 0, 90, 0.5, 0.6, 1.2); sp.position.set(sx, 0.8, v.model.dims.L / 2 - 0.2);
      sp.target.position.set(sx * 0.6, 0, v.model.dims.L / 2 + 25); v.model.group.add(sp, sp.target); this.heads.push(sp);
    }
    this.placeShowroom();
  }
  placeShowroom() { const p = this.player; p.car.setPose(-HALF + 45, -HALF + 45, 0); p.car.y = 0.14; p.setVisible(true); }

  // ------------------------------------------------------------------ input
  onKey(e, down) {
    const k = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down) return;
    if (this.state === 'playing') {
      if (k === 'Escape' || k === 'KeyP') this.pause();
      else if (k === 'KeyC') { const n = this.rig.cycle(); this.ui.camName(n); }
      else if (k === 'KeyR') this.recover();
      else if (k === 'KeyH') this.ui.toggleHelp();
    } else if (this.state === 'paused' && (k === 'Escape' || k === 'KeyP')) this.resume();
  }
  readInput(dt) {
    const K = this.keys, has = (...a) => a.some((x) => K.has(x));
    const inp = this.player.car.input;
    inp.throttle = has('KeyW', 'ArrowUp') ? 1 : 0; inp.brake = has('KeyS', 'ArrowDown') ? 1 : 0;
    const tgt = (has('KeyA', 'ArrowLeft') ? 1 : 0) - (has('KeyD', 'ArrowRight') ? 1 : 0);
    // keyboard steering ramps in/out to feel analogue; faster return when released
    const rate = (tgt === 0 || Math.sign(tgt) !== Math.sign(this.steerIn)) ? 9 : 4.5;
    this.steerIn += clamp(tgt - this.steerIn, -rate * dt, rate * dt);
    inp.steer = this.steerIn; inp.hand = has('Space', 'KeyX') ? 1 : 0; inp.nitro = has('ShiftLeft', 'ShiftRight');
  }

  // ------------------------------------------------------------------ run lifecycle
  startRun(mode, chId = null) {
    this.audio.init(); this.audio.startMusic(); this.audio.resume();
    const ch = chId ? CHALLENGES.find((x) => x.id === chId) : null;
    const tg = ch ? ch.map === 'touge' : (mode === 'tfree' || mode === 'trun' || mode === 'park');
    this.setMap(tg ? 'touge' : 'city');
    const car = this.player.car, S = this.save;
    car.applyUpgrades(upgradesOf(S.selected)); car.fullRepair(); car.nitro = car.P.nitroCap;
    this.police.clear();
    let startIdx = -1;
    if (tg) {
      if (mode === 'park' || (ch && ch.spawn === 'park')) car.setPose(PARK.x - 40, PARK.z + 30, -Math.PI / 2 + 0.5);
      else { startIdx = 24; const q = this.world.poseAt(startIdx, -2.5); car.setPose(q.x, q.z, q.yaw); car.y = q.y; }
    } else {
      const p = this.world.randomRoadPoint(0, 0, 20, 140) || { x: 0, z: 0, dir: 0 };
      const off = World.laneOff(p.dir, 4);
      car.setPose(p.alongX ? p.x : p.x + off[0], p.alongX ? p.z + off[1] : p.z, World.dirYaw(p.dir));
    }
    this.player.setVisible(true); this.steerIn = 0; this.acc = 0;
    const noPolice = tg || mode === 'free' || (ch && ch.noPolice);
    this.run = {
      mode, ch, map: tg ? 'touge' : 'city', lapProg: 0, lastIdx: -1, startIdx, lapDone: false, clips: 0, bestChain: 0, zonePts: 0, angHold: 0, fastHold: 0, maxAngle: 0, chainBonus: 0, spinT: 0, time: 0, score: 0, money: 0, dist: 0, takedowns: 0, driftBank: 0, driftChain: 0, driftMult: 1, driftIdle: 0, driftNow: 0,
      heat: noPolice ? 0 : mode === 'chase' ? 14 : ch ? ch.start : 0, level: 0, maxLevel: 0, escapes: 0, smashed: 0, bust: 0, hide: 0, cool: 0,
      nearMiss: 0, ended: false, policeOn: !noPolice, smashCombo: 0, smashT: 0, comboT: 0, shown: 0, lastPos: { x: car.x, z: car.z },
    };
    this.run.level = levelOf(this.run.heat); this.run.maxLevel = this.run.level;
    this.police.lastKnown.x = car.x; this.police.lastKnown.z = car.z; this.police.spawnT = 0.5; this.police.blockT = 15;
    this.traffic.reset(car);
    this.rig.snap = true; this.rig.mode = 0;
    this.state = 'playing';
    this.ui.showHud(this.run);
    this.ui.toast({ free: 'FREE ROAM', tfree: 'FREE DRIFT', trun: 'TOUGE RUN: ONE LAP', park: 'DRIFT PARK' }[mode] || (ch ? ch.name.toUpperCase() : 'POLICE CHASE'), 'good big');
    if (this.run.level > 0) this.ui.toast('POLICE ARE ON YOUR TAIL', 'bad');
  }

  pause() { if (this.state !== 'playing') return; this.state = 'paused'; this.audio.suspend(); this.ui.showPause(); }
  resume() { if (this.state !== 'paused') return; this.state = 'playing'; this.audio.resume(); this.ui.hidePause(); this.last = performance.now(); }
  quitToMenu(finish = true) {
    if (this.run && !this.run.ended && finish) this.endRun('quit');
    this.setMap('city');
    this.state = 'menu'; this.run = null; this.police.clear(); this.audio.resume(); this.ui.hideHud(); this.player.setVisible(false); this.fx.lights.forEach((l) => (l.intensity = 0));
    this.ui.showMain();
  }
  recover() {
    const car = this.player.car, w = this.world;
    if (w.recoverPose) { const q = w.recoverPose(car); car.setPose(q.x, q.z, q.yaw); car.y = w.heightAt(q.x, q.z, 0); this.rig.snap = true; this.ui.toast('RECOVERED', 'warn'); return; }
    const i = Math.round(car.x / 90 + 4), j = Math.round(car.z / 90 + 4);
    const lx = c(clamp(i, 0, 8)), lz = c(clamp(j, 0, 8));
    const alongZ = Math.abs(car.x - lx) < Math.abs(car.z - lz);
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
    let dir;
    if (alongZ) { dir = cy >= 0 ? 0 : 2; car.setPose(lx + World.laneOff(dir, 4)[0], clamp(car.z, -HALF, HALF), World.dirYaw(dir)); }
    else { dir = sy >= 0 ? 1 : 3; car.setPose(clamp(car.x, -HALF, HALF), lz + World.laneOff(dir, 4)[1], World.dirYaw(dir)); }
    this.rig.snap = true; this.ui.toast('RECOVERED', 'warn');
  }

  endRun(reason) {
    const run = this.run; if (run.ended) return; run.ended = true;
    const S = this.save;
    let reward = 0, success = null;
    if (run.ch && run.okCh) { reward = run.ch.reward; success = true; }
    else if (run.ch) success = false;
    let record = false;
    const total = Math.floor(run.money) + reward;
    S.money += reward;                      // run money was already banked while driving
    S.stats.runs++; S.stats.distance += run.dist; S.stats.takedowns += run.takedowns; S.stats.escapes += run.escapes; S.stats.smashed += run.smashed; S.stats.playTime += run.time;
    const TS = (S.scores.touge ||= { run: { score: 0, time: 0 }, park: { score: 0 }, free: { score: 0 } });
    if (run.map === 'touge' && !run.ch) {
      const key = run.mode === 'trun' ? 'run' : run.mode === 'park' ? 'park' : 'free';
      if (run.driftBank > (TS[key].score || 0)) { TS[key].score = Math.floor(run.driftBank); if (key === 'run' && run.lapDone) TS.run.time = Math.floor(run.time); record = true; }
    } else if (run.mode === 'chase') { if (run.score > S.scores.chase.score) { S.scores.chase = { score: Math.floor(run.score), time: Math.floor(run.time), level: run.maxLevel }; record = true; } }
    else if (run.mode === 'free') { if (run.dist > S.scores.free.distance) { S.scores.free.distance = Math.floor(run.dist); record = true; } }
    else if (run.score > S.scores.challenge.score) { S.scores.challenge.score = Math.floor(run.score); record = true; }
    if (run.ch && run.okCh) S.done[run.ch.id] = true;
    save();
    this.state = 'over'; this.overT = 0;
    const title = { busted: 'BUSTED', wrecked: 'WRECKED', quit: 'RUN ENDED', done: run.map === 'touge' && run.lapDone ? 'LAP COMPLETE' : 'COMPLETE', failed: 'FAILED' }[reason] || 'RUN ENDED';
    this.audio.alarm();
    this.ui.showSummary({ title, bad: reason === 'busted' || reason === 'wrecked' || reason === 'failed', run, total, reward, record, success });
  }

  // ------------------------------------------------------------------ gameplay events
  addScore(pts) { this.run.score += pts; this.bank(pts * CASH_PER_POINT); }
  /** Money is banked into the save immediately, so progress is never lost if the tab is closed mid-run. */
  bank(m) { this.run.money += m; this.save.money += m; this.dirty = true; }
  heat(v) { const r = this.run; if (!r || !r.policeOn || r.ended) return; r.heat = clamp(r.heat + v, 0, 100); }

  onImpact(a, b, speed, px, pz, nx, nz, dest) {
    const pl = this.player.car, mine = a === pl || b === pl;
    const dx = px - pl.x, dz = pz - pl.z, near = dx * dx + dz * dz < 2500;
    if (speed > 2.5 && near) this.fx.sparks(px, 0.55 + (a.y || 0), pz, nx, nz, speed);
    if (speed > 4 && near) this.audio.crash(clamp(speed / 26, 0.08, 1));
    if (!mine) return;
    this.rig.addShake(speed / 16);
    if (speed > 9) this.ui.flash(clamp(speed / 40, 0.15, 0.7));
    const run = this.run; if (!run || run.ended) return;
    if (run.driftChain > 0 && speed > 6) { if (run.map === 'touge') { run.driftChain = 0; run.driftNow = 0; run.chainBonus = 0; this.ui.toast('CHAIN LOST', 'bad'); } else run.driftChain *= 0.5; }
    const other = b && (a === pl ? b : a);
    if (other && speed > 3) {
      const ov = other.tag;
      if (ov && this.time - (ov.lastCrime || -9) > 1.5) {
        ov.lastCrime = this.time;
        if (ov.kind === 'traffic') { this.heat(3.5); this.addScore(15); if (run.level === 0 && run.policeOn && speed > 8) this.ui.toast('CRIMINAL ACTIVITY', 'warn'); }
        else if (ov.kind === 'police') { this.heat(1.5); this.addScore(25 + run.level * 10); }
      }
    }
  }

  onSmash(it, car, sp) {
    const mine = car === this.player.car; const near = Math.hypot(car.x - this.player.car.x, car.z - this.player.car.z) < 60;
    if (near) { this.audio.clang(); this.fx.debris(it.x, 1, it.z, car.vx, car.vz, it.kind.name === 'cone' ? 0xff6a10 : 0x9aa0aa); if (it.kind.tall) this.fx.sparks(it.x, 0.5, it.z, car.vx * 0.05, car.vz * 0.05, 6); }
    const run = this.run; if (!mine || !run || run.ended) return;
    run.smashed++; run.smashCombo++; run.smashT = 2.2;
    this.addScore(it.kind.score * Math.min(5, run.smashCombo));
    this.heat(0.25);
    this.rig.addShake(0.12);
  }

  onTakedown(v, byPlayer) {
    const run = this.run; if (!run || run.ended || !byPlayer) return;
    run.takedowns++;
    const pts = Math.round(250 * (1 + run.level * 0.5));
    this.addScore(pts); this.bank(40); this.heat(4);
    this.ui.toast(`TAKEDOWN  +${pts} PTS`, 'pts big'); this.audio.chime();
  }

  // ------------------------------------------------------------------ rules per frame
  updateRules(dt) {
    const run = this.run, P = this.player.car;
    run.time += dt;
    const step = Math.hypot(P.x - run.lastPos.x, P.z - run.lastPos.z); run.lastPos.x = P.x; run.lastPos.z = P.z;
    if (step < 20) { run.dist += step; this.addScore(step * 0.2); }
    this.addScore(dt * (2 + run.level * 4));
    const speed = P.speed;

    // --- drift scoring: chain points build while sliding, bank when the slide ends
    const tg = run.map === 'touge';
    const drifting = tg ? (P.slip > 0.2 && speed > 10 && P.fwdSpeed > 0 && !P.wrecked) : (P.drifting && speed > 9);
    if (drifting) {
      run.driftIdle = 0; run.driftNow += dt;
      run.driftMult = 1 + Math.min(4, run.driftNow * 0.35) + run.chainBonus;
      const ang = clamp(P.slip, 0, 1.2), zone = tg && this.world.zoneAt ? this.world.zoneAt(P.x, P.z) : 1;
      let rate = speed * ang * 3.2 * run.driftMult * zone;
      if (tg && ang > 1.0) rate *= 0.35;                        // spinning is not drifting
      run.driftChain += rate * dt;
      if (zone > 1) run.zonePts += rate * dt;
      if (tg) {
        run.maxAngle = Math.max(run.maxAngle, ang);
        run.angHold = run.ch && ang >= run.ch.angle ? run.angHold + dt : 0;
        run.fastHold = run.ch && speed >= run.ch.speed ? run.fastHold + dt : 0;
        run.spinT = P.slip > 1.3 ? run.spinT + dt : 0;
        if (run.spinT > 0.4) { run.driftChain = 0; run.driftNow = 0; run.chainBonus = 0; run.spinT = 0; this.ui.toast('SPUN OUT', 'bad'); }
        for (let k = 0; k < this.world.clips.length; k++) {
          const cl = this.world.clips[k];
          if (this.time - cl.t < 20) continue;
          if ((cl.x - P.x) ** 2 + (cl.z - P.z) ** 2 < 14) {
            this.world.hitClip(k, this.time); run.clips++; run.chainBonus += 0.5;
            const bonus = Math.round(150 * run.driftMult); run.driftChain += bonus; this.ui.toast(`CLIPPED  +${bonus} PTS`, 'pts'); this.audio.chime();
          }
        }
      }
    } else {
      run.angHold = 0; run.fastHold = 0;
      if (run.driftChain > 0) {
        run.driftIdle += dt;
        if (run.driftIdle > (tg ? 0.9 : 0.7)) { const pts = Math.round(run.driftChain); if (pts > 40) { this.addScore(pts); run.driftBank += pts; run.bestChain = Math.max(run.bestChain, pts); this.ui.toast(`DRIFT  +${pts} PTS`, 'pts'); } run.driftChain = 0; run.driftNow = 0; run.driftMult = 1; run.chainBonus = 0; }
      }
    }
    run.bestChain = Math.max(run.bestChain, run.driftChain);
    // --- lap progress along the mountain road
    if (tg) {
      const W = this.world, ri = W.roadIndex(P.x, P.z);
      if (ri >= 0) {
        if (run.lastIdx < 0) run.lastIdx = ri;
        let d = ri - run.lastIdx; if (d > W.N / 2) d -= W.N; if (d < -W.N / 2) d += W.N;
        if (Math.abs(d) < 40) run.lapProg += d; run.lastIdx = ri;
      }
      if (!run.lapDone && run.startIdx >= 0 && run.lapProg >= W.N - 30) {
        run.lapDone = true; const bonus = Math.round(Math.max(0, 420 - run.time) * 12); this.addScore(bonus);
        this.ui.toast(`LAP  ${Math.floor(run.time / 60)}:${String(Math.floor(run.time % 60)).padStart(2, '0')}   +${bonus} PTS`, 'pts big');
        if (run.mode === 'trun') { const pts = Math.round(run.driftChain); if (pts > 40) { this.addScore(pts); run.driftBank += pts; } this.endRun('done'); return; }
      }
    }
    if (run.smashT > 0) { run.smashT -= dt; if (run.smashT <= 0) run.smashCombo = 0; }

    // --- near misses with traffic
    if (speed > 24) for (const v of this.traffic.list) {
      const o = v.car, dx = o.x - P.x, dz = o.z - P.z, d2 = dx * dx + dz * dz;
      if (d2 > 16 || d2 < 2.2 * 2.2 && false) continue;
      if (this.time - (v.lastNear || -9) > 3 && d2 > 6.5 && o.layer === P.layer) { v.lastNear = this.time; run.nearMiss++; this.addScore(40); this.ui.toast('NEAR MISS +40 PTS', 'pts'); }
    }

    // --- wanted level
    if (run.policeOn) {
      const seen = this.police.seen;
      if (seen) { run.hide = 0; if (run.mode !== 'free') run.heat = clamp(run.heat + dt * (0.5 + run.level * 0.12), 0, 100); }
      else { run.hide += dt; if (run.hide > 4 && run.heat > 0) run.heat = Math.max(0, run.heat - dt * (3.2 + run.level * 0.4)); }
      // chase mode: after an escape, a new, harder wave begins
      if (run.mode !== 'free' && run.heat <= 0) {
        run.cool += dt;
        if (run.mode === 'chase' && run.cool > 9) { run.heat = 14 + run.escapes * 8; run.cool = 0; this.ui.toast('NEW PURSUIT', 'bad'); }
      } else run.cool = 0;
      const nl = levelOf(run.heat);
      if (nl !== run.level) {
        if (nl > run.level) { this.ui.toast(`WANTED LEVEL ${nl}`, 'bad big'); this.audio.alarm(); if (nl === 3) this.ui.toast('ROADBLOCKS AHEAD', 'warn'); if (nl === 4) this.ui.toast('HELICOPTER INBOUND', 'warn'); }
        else if (nl === 0) {
          run.escapes++; const bonus = 400 * run.maxLevel; this.addScore(bonus); this.bank(25 * run.maxLevel);
          this.ui.toast(`ESCAPED  +${bonus} PTS`, 'pts big'); this.audio.chime(); run.escapedFrom = run.maxLevel;
        } else this.ui.toast('HEAT DROPPING', 'good');
        run.level = nl; run.maxLevel = Math.max(run.maxLevel, nl);
      }
      // --- busted: police boxed in / touching while you are almost stopped
      let n = 0;
      for (const u of this.police.units) { if (u.car.wrecked || u.ai.mode === 'block') continue; if ((u.car.x - P.x) ** 2 + (u.car.z - P.z) ** 2 < 64) n++; }
      const slow = speed < 9 || (n >= 3 && speed < 15);
      run.bust = clamp(run.bust + (n > 0 && slow ? dt * 0.38 * n : -dt * 0.5), 0, 1);
      if (run.bust >= 1) { this.endRun('busted'); return; }
    }
    if (P.wrecked) { this.endRun('wrecked'); return; }
    this.checkChallenge();
  }

  checkChallenge() {
    const run = this.run, ch = run.ch, P = this.player.car; if (!ch || run.ended) return;
    let ok = false;
    switch (ch.type) {
      case 'escape': ok = run.maxLevel >= ch.level && run.level === 0 && run.escapes > 0; break;
      case 'survive': ok = run.time >= ch.target; break;
      case 'distance': ok = run.dist >= ch.target; break;
      case 'drift': ok = run.driftBank >= ch.target; break;
      case 'takedown': ok = run.takedowns >= ch.target; break;
      case 'chain': ok = run.bestChain >= ch.target; break;
      case 'clips': ok = run.clips >= ch.target; break;
      case 'angle': ok = run.angHold >= ch.hold; break;
      case 'fast': ok = run.fastHold >= ch.hold; break;
      case 'zone': ok = run.zonePts >= ch.target; break;
      case 'lap':
        if (ch.maxDmg != null && P.damage > ch.maxDmg) { this.endRun('failed'); return; }
        if (ch.maxTime && run.time > ch.maxTime) { this.endRun('failed'); return; }
        if (run.lapDone) { ok = !ch.minPts || run.driftBank + run.driftChain >= ch.minPts; if (!ok) { this.endRun('failed'); return; } }
        break;
      case 'clean':
        if (P.damage > ch.maxDmg) { this.endRun('failed'); return; }
        ok = run.maxLevel >= ch.level && run.level === 0 && run.escapes > 0; break;
    }
    if (ok) { run.okCh = true; this.endRun('done'); }
  }

  /** Progress text for the objective box. */
  objective() {
    const run = this.run, ch = run.ch; if (!ch) return null;
    const P = this.player.car;
    const t = { escape: `Reach ${ch.level}★ then escape · ${run.level}★ now`, survive: `${Math.floor(run.time)} / ${ch.target} s`, distance: `${(run.dist / 1000).toFixed(2)} / ${(ch.target / 1000).toFixed(1)} km`,
      drift: `${Math.floor(run.driftBank)} / ${ch.target} pts`, chain: `Best chain ${Math.floor(run.bestChain)} / ${ch.target}`, clips: `${run.clips} / ${ch.target} apexes`,
      angle: `Hold ≥ ${Math.round(ch.angle * 57.3)}° · ${run.angHold.toFixed(1)} / ${ch.hold} s`, fast: `Drift ≥ ${Math.round(ch.speed * 3.6)} km/h · ${run.fastHold.toFixed(1)} / ${ch.hold} s`, zone: `${Math.floor(run.zonePts)} / ${ch.target} zone pts`,
      lap: `Lap ${Math.min(100, Math.floor(run.lapProg / this.world.N * 100))}%${ch.minPts ? ` · ${Math.floor(run.driftBank)} / ${ch.minPts} pts` : ''}${ch.maxDmg != null ? ` · damage ${P.damage.toFixed(0)}% (max ${ch.maxDmg}%)` : ''}${ch.maxTime ? ` · limit ${Math.floor(ch.maxTime / 60)}:00` : ''}`, takedown: `${run.takedowns} / ${ch.target} wrecked`, clean: `Damage ${P.damage.toFixed(0)}% (max ${ch.maxDmg}%) · ${run.level}★` }[ch.type];
    return { title: ch.name, text: t };
  }

  // ------------------------------------------------------------------ main frame
  frame(dt) {
    const r = this.renderer;
    if (this.state === 'paused' || this.state === 'boot') { this.render(); return; }
    this.time += dt;
    // day / night cycle
    if (this.todMode === 'cycle') { this.todH = (this.todH + dt / 40) % 24; }
    this.todT -= dt; if (this.todT <= 0) { this.todT = 0.2; const { night } = this.world.setTime(this.todH); this.lastNight = night; }
    const night = this.lastNight;
    for (const h of this.heads) h.intensity = night * 220;
    this.glowMat.opacity = night * 0.42; this.fx.skid.mesh.material.opacity = 1;

    const P = this.player;
    if (this.state === 'playing') this.updatePlaying(dt, night);
    else this.updateIdle(dt, night);

    this.world.update(dt);
    const scale = this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.fx.update(dt, scale);
    this.render();
  }

  updateIdle(dt, night) {
    // menu / garage / game over: keep traffic alive and orbit the camera
    const focus = this.state === 'over' ? this.player.car : { x: 0, z: 0 };
    const tp = this.state === 'garage' ? { x: -HALF + 45, z: -HALF + 45 } : this.state === 'over' ? this.player.car : { x: 0, z: 0, vx: 0, vz: 0, y: 0 };
    if (this.state === 'menu' || this.state === 'garage') {
      this.traffic.update(dt, tp, this.trafficEveryone(tp));
      this.stepPhysics(dt, tp, true);
    }
    if (this.state === 'garage') {
      const car = this.player.car; car.yaw += dt * 0.0; car.y = 0.14;
      car.input.throttle = car.input.brake = 0; car.setPose(-HALF + 45, -HALF + 45, 0.5); this.player.setVisible(true);
      this.player.sync(dt, this.time, night, null); this.rig.turntable(dt, car.x, 0.14, car.z, Math.max(7.5, (carDims(VEHICLES[this.previewId || this.save.selected].body).L || 4.5) * 1.9 + 2.5), this.garageNdc || 0); this.world.updateShadow(car.x, car.z);
    } else if (this.state === 'over') {
      this.overT += dt; this.rig.turntable(dt, this.player.car.x, this.player.car.y, this.player.car.z);
      for (const v of this.vehicles) v.sync(dt, this.time, night, this.fx);
      this.world.updateShadow(this.player.car.x, this.player.car.z);
    } else {
      this.rig.orbit(dt, 0, 0, 400, 150, 0.035); this.world.updateShadow(0, 0);
      this.player.setVisible(false);
      for (const v of this.traffic.list) v.sync(dt, this.time, night, null);
    }
    this.audio.update({ rpm: 0.2, throttle: 0, slip: 0, speed: 0, nitro: false, active: false, sirens: [null, null], heli: null });
    this.speedCtx.clearRect(0, 0, this.speedCv.width, this.speedCv.height);
  }

  trafficEveryone(player) { return this.traffic.list; }

  updatePlaying(dt, night) {
    const P = this.player, car = P.car, run = this.run;
    this.readInput(dt);
    // AI
    const everyone = this.vehicles;
    this.traffic.update(dt, car, everyone);
    if (run.policeOn) {
      this.police.update(dt, { player: P, world: this.world, level: run.level, time: this.time, others: everyone, night, onRoadblock: () => this.ui.toast('ROADBLOCK AHEAD', 'warn') });
    } else if (this.police.units.length) this.police.clear();
    // active list
    this.vehicles = [P];
    for (const v of this.traffic.list) if (!v.far) this.vehicles.push(v);
    for (const v of this.police.units) if (v.active) this.vehicles.push(v);
    this.stepPhysics(dt, car, false);
    // visuals + effects
    for (const v of this.vehicles) {
      const near = (v.car.x - car.x) ** 2 + (v.car.z - car.z) ** 2;
      v.car.updateBody(dt, this.world);
      v.sync(dt, this.time, night, near < 120 * 120 ? this.fx : null);
      v.setShadow(near < 70 * 70 && this.renderer.shadowMap.enabled);
      v.model.group.visible = near < 420 * 420 && !v.far;
      if (near < 100 * 100) this.vehicleFx(v, dt);
    }
    this.world.updateShadow(car.x, car.z);
    this.fx.policeLights(this.police.units, car.x, car.z);
    this.rig.follow(car, dt, car.nitroOn);
    this.updateRules(dt);
    this.saveT = (this.saveT || 0) - dt;
    if (this.saveT <= 0) { this.saveT = 4; if (this.dirty) { save(); this.dirty = false; } }
    if (this.state !== 'playing') return;
    this.updateAudio(dt);
    this.speedLines(car);
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.06; this.ui.updateHud(this.hudData()); }
    this.ui.drawMinimap(this.mapData());
  }

  stepPhysics(dt, focus, idle) {
    const h = 1 / 180; this.acc += dt;
    const sim = this.sim; sim.length = 0;
    const consider = (v) => { if (v.far) return; const d2 = (v.car.x - focus.x) ** 2 + (v.car.z - focus.z) ** 2; if (d2 < 280 * 280) sim.push(v); };
    if (this.state === 'playing') { sim.push(this.player); for (const v of this.traffic.list) consider(v); for (const v of this.police.units) if (v.active) sim.push(v); }
    else { for (const v of this.traffic.list) consider(v); }
    let n = 0;
    while (this.acc >= h && n < 9) {
      for (let i = 0; i < sim.length; i++) sim[i].car.step(h, this.world);
      for (let i = 0; i < sim.length; i++) collideWorld(sim[i].car, this.world, this.time, this.onImpactBound);
      for (let i = 0; i < sim.length; i++) for (let j = i + 1; j < sim.length; j++) collideCars(sim[i].car, sim[j].car, this.time, this.onImpactBound);
      this.acc -= h; n++;
    }
    if (this.acc > h) this.acc = 0;
    if (idle) for (const v of sim) { v.car.updateBody(dt, this.world); }
  }

  /** Tyre smoke, skid marks, nitro flames for one vehicle. */
  vehicleFx(v, dt) {
    const car = v.car, m = v.model, sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
    const sliding = (car.slip > 0.22 && car.speed > 7) || car.burnout || (car.input.hand && car.speed > 6) || (car.input.brake > 0.9 && car.speed > 22);
    if (v.id === undefined) v.id = vid++;
    for (let i = 0; i < m.wheels.length; i++) {
      const w = m.wheels[i]; if (w.front && !(car.input.brake > 0.9 && car.speed > 22)) { this.fx.skid.release(v.id * 4 + i); continue; }
      if (!sliding) { this.fx.skid.release(v.id * 4 + i); continue; }
      const wx = car.x + cy * w.x + sy * w.z, wz = car.z - sy * w.x + cy * w.z;
      this.fx.skid.add(v.id * 4 + i, wx, car.y, wz, 0.45);
      if (Math.random() < 0.6) this.fx.tireSmoke(wx, car.y, wz, car.vx, car.vz, Math.min(1, car.speed / 30));
    }
    if (car.nitroOn) {
      const L = m.dims.L / 2;
      for (const sx of [-0.5, 0.5]) { const ex = car.x - sy * L + cy * sx, ez = car.z - cy * L - sy * sx; this.fx.flame(ex, car.y + 0.4, ez, -sy, -cy); }
    }
  }

  updateAudio(dt) {
    const car = this.player.car, sir = [null, null];
    const [a, b] = this.police.nearestTwo(car.x, car.z), ry = this.rig.yaw, rx = -Math.cos(ry), rz = Math.sin(ry);
    [a, b].forEach((e, i) => { if (!e) return; const dx = e.v.car.x - car.x, dz = e.v.car.z - car.z; sir[i] = { vol: Math.pow(clamp(1 - e.d / 260, 0, 1), 1.4), pan: (dx * rx + dz * rz) / (e.d + 1) }; });
    let heli = null; const H = this.police.heliObj;
    if (H) { const dx = H.x - car.x, dz = H.z - car.z, d = Math.hypot(dx, dz); heli = { vol: clamp(1 - d / 300, 0, 1), pan: (dx * rx + dz * rz) / (d + 1) }; }
    this.audio.update({ rpm: car.rpm, throttle: car.throttleIn || 0, slip: (car.slip > 0.2 && car.speed > 6 || car.burnout) ? clamp(car.slip * 1.6 + (car.burnout ? 0.6 : 0), 0, 1) : 0, speed: car.speed, nitro: car.nitroOn, active: !car.wrecked, small: this.save.selected === 'super', sirens: sir, heli });
  }

  speedLines(car) {
    const cv = this.speedCv, g = this.speedCtx, w = cv.width, h = cv.height;
    g.clearRect(0, 0, w, h);
    const k = clamp((car.speed - 38) / 28, 0, 1) + (car.nitroOn ? 0.35 : 0);
    if (k < 0.05) return;
    g.save(); g.translate(w / 2, h / 2); g.lineCap = 'round';
    const n = 46, R = Math.hypot(w, h) / 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, r0 = R * (0.42 + Math.random() * 0.25), r1 = r0 + R * (0.12 + Math.random() * 0.3) * k;
      g.strokeStyle = `rgba(190,230,255,${0.05 + Math.random() * 0.16 * k})`; g.lineWidth = 1 + Math.random() * 2;
      g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke();
    }
    g.restore();
  }

  hudData() {
    const run = this.run, car = this.player.car;
    return {
      speed: car.speed * 3.6, gear: car.gear, rpm: car.rpm, nitro: car.nitro / car.P.nitroCap, nitroOn: car.nitroOn, nitroLock: car.nitroLock, damage: car.damage,
      policeOn: run.policeOn, map: run.map, ang: Math.round(clamp(car.slip, 0, 1.6) * 57.3), best: Math.floor(run.bestChain), clips: run.clips, lap: run.map === 'touge' && run.startIdx >= 0 ? Math.min(1, run.lapProg / this.world.N) : -1,
      level: run.level, time: run.time, score: run.score, money: this.save.money, bust: run.bust, dist: run.dist, mode: run.mode,
      combo: run.driftChain > 40 ? { pts: Math.round(run.driftChain), mult: run.driftMult, ang: Math.round(clamp(car.slip, 0, 1.6) * 57.3) } : null, smash: run.smashCombo > 1 ? run.smashCombo : 0,
      status: !run.policeOn ? '' : run.heat <= 0 ? (run.mode === 'chase' ? 'Lay low... next pursuit incoming' : 'Clear') : this.police.seen ? 'SPOTTED' : run.hide > 4 ? 'Evading... heat dropping' : 'Searching for you...',
      hot: this.police.seen && run.level > 0, obj: this.objective(), policeCount: this.police.alive.length,
    };
  }
  mapData() {
    const car = this.player.car;
    return { x: car.x, z: car.z, yaw: car.yaw, units: this.police.units.filter((u) => u.active && !u.car.wrecked).map((u) => ({ x: u.car.x, z: u.car.z, f: u.flash, blk: u.ai.mode === 'block' })), heli: this.police.heliObj ? { x: this.police.heliObj.x, z: this.police.heliObj.z } : null, t: this.time };
  }

  render() {
    if (this.useComposer && this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }
}
