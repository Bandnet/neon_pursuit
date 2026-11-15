// Fully procedural audio (Web Audio API): engine, tyres, wind, nitro, sirens, helicopter, impacts and a
// synthwave music loop. No external files are needed; replace any voice with a sample if desired.
import { clamp } from './util.js';

export class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; this.sfx = 0.8; this.music = 0.4; this.musicOn = false; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    const comp = ctx.createDynamicsCompressor(); comp.connect(this.master); this.sfxBus.disconnect(); this.sfxBus.connect(comp);
    // shared noise buffer
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    this._engine(); this._screech(); this._wind(); this._nitro(); this._sirens(); this._heli();
    this.setVolumes(this.sfx, this.music);
    this.ready = true;
  }
  setVolumes(sfx, music) {
    this.sfx = sfx; this.music = music;
    if (!this.ctx) return;
    this.sfxBus.gain.value = sfx; this.musicBus.gain.value = music * 0.55;
  }
  suspend() { this.ctx && this.ctx.suspend(); }
  resume() { this.ctx && this.ctx.resume(); }

  _noise(loop = true) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = loop; return s; }
  _osc(type, freq) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq; return o; }

  _engine() {
    const c = this.ctx;
    this.eng = { o1: this._osc('sawtooth', 60), o2: this._osc('square', 30), o3: this._osc('triangle', 120), f: c.createBiquadFilter(), g: c.createGain() };
    this.eng.f.type = 'lowpass'; this.eng.f.Q.value = 2;
    const g1 = c.createGain(), g2 = c.createGain(), g3 = c.createGain(); g1.gain.value = 0.5; g2.gain.value = 0.3; g3.gain.value = 0.25;
    this.eng.o1.connect(g1).connect(this.eng.f); this.eng.o2.connect(g2).connect(this.eng.f); this.eng.o3.connect(g3).connect(this.eng.f);
    this.eng.f.connect(this.eng.g).connect(this.sfxBus); this.eng.g.gain.value = 0;
    this.eng.o1.start(); this.eng.o2.start(); this.eng.o3.start();
  }
  _screech() {
    const c = this.ctx, n = this._noise(), bp = c.createBiquadFilter(), g = c.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 6; g.gain.value = 0;
    n.connect(bp).connect(g).connect(this.sfxBus); n.start(); this.scr = { bp, g };
  }
  _wind() {
    const c = this.ctx, n = this._noise(), lp = c.createBiquadFilter(), g = c.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 600; g.gain.value = 0; n.connect(lp).connect(g).connect(this.sfxBus); n.start(); this.wind = { lp, g };
  }
  _nitro() {
    const c = this.ctx, n = this._noise(), hp = c.createBiquadFilter(), g = c.createGain();
    hp.type = 'highpass'; hp.frequency.value = 900; g.gain.value = 0; n.connect(hp).connect(g).connect(this.sfxBus); n.start(); this.nit = { hp, g };
  }
  _sirens() {
    const c = this.ctx; this.sir = [];
    for (let i = 0; i < 2; i++) {
      const o = this._osc('sawtooth', 900), lfo = this._osc('sine', i ? 3.2 : 0.55), lg = c.createGain(), f = c.createBiquadFilter(), g = c.createGain(), p = c.createStereoPanner();
      lg.gain.value = i ? 260 : 330; f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.7; g.gain.value = 0;
      lfo.connect(lg).connect(o.frequency); o.connect(f).connect(g).connect(p).connect(this.sfxBus); o.start(); lfo.start();
      this.sir.push({ g, p, o });
    }
  }
  _heli() {
    const c = this.ctx, n = this._noise(), lp = c.createBiquadFilter(), g = c.createGain(), am = c.createGain(), lfo = this._osc('sine', 17), lg = c.createGain(), p = c.createStereoPanner();
    lp.type = 'lowpass'; lp.frequency.value = 500; am.gain.value = 0.5; lg.gain.value = 0.5; g.gain.value = 0;
    lfo.connect(lg).connect(am.gain); n.connect(lp).connect(am).connect(g).connect(p).connect(this.sfxBus); n.start(); lfo.start(); this.heli = { g, p };
  }

  /** Per-frame continuous sounds. */
  update(p) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, e = this.eng;
    const rpm = p.rpm, f = 38 + rpm * 125 * (p.small ? 1.3 : 1);
    e.o1.frequency.setTargetAtTime(f, t, 0.04); e.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04); e.o3.frequency.setTargetAtTime(f * 2.01, t, 0.04);
    e.f.frequency.setTargetAtTime(300 + rpm * 1500 + p.throttle * 900, t, 0.05);
    e.g.gain.setTargetAtTime(p.active ? 0.16 + p.throttle * 0.1 : 0, t, 0.08);
    this.scr.g.gain.setTargetAtTime(clamp(p.slip, 0, 1) * 0.22, t, 0.05);
    this.scr.bp.frequency.setTargetAtTime(1400 + p.slip * 900, t, 0.1);
    this.wind.g.gain.setTargetAtTime(clamp(p.speed / 60, 0, 1) ** 1.5 * 0.2, t, 0.1);
    this.wind.lp.frequency.setTargetAtTime(300 + p.speed * 14, t, 0.1);
    this.nit.g.gain.setTargetAtTime(p.nitro ? 0.16 : 0, t, 0.06);
    for (let i = 0; i < 2; i++) { const s = this.sir[i], v = p.sirens[i]; s.g.gain.setTargetAtTime(v ? v.vol * 0.05 : 0, t, 0.08); if (v) s.p.pan.setTargetAtTime(clamp(v.pan, -1, 1), t, 0.1); }
    this.heli.g.gain.setTargetAtTime(p.heli ? p.heli.vol * 0.7 : 0, t, 0.1); if (p.heli) this.heli.p.pan.setTargetAtTime(clamp(p.heli.pan, -1, 1), t, 0.1);
  }

  /** Crash sound; `power` 0..1. */
  crash(power) {
    if (!this.ready) return; const c = this.ctx, t = c.currentTime;
    const n = this._noise(false), lp = c.createBiquadFilter(), g = c.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 600 + power * 3500; g.gain.setValueAtTime(0.1 + power * 0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + power * 0.4);
    n.connect(lp).connect(g).connect(this.sfxBus); n.start(t, Math.random()); n.stop(t + 0.9);
    const o = this._osc('sine', 110 - power * 50), og = c.createGain(); og.gain.setValueAtTime(0.5 * power + 0.1, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.3); o.connect(og).connect(this.sfxBus); o.start(t); o.stop(t + 0.4);
  }
  clang() {
    if (!this.ready) return; const c = this.ctx, t = c.currentTime, o = this._osc('triangle', 700 + Math.random() * 300), g = c.createGain();
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35); o.frequency.exponentialRampToValueAtTime(220, t + 0.3);
    o.connect(g).connect(this.sfxBus); o.start(t); o.stop(t + 0.4);
  }
  blip(freq = 880, dur = 0.12, vol = 0.2, type = 'square') {
    if (!this.ready) return; const c = this.ctx, t = c.currentTime, o = this._osc(type, freq), g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g).connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.02);
  }
  chime() { this.blip(660, 0.12, 0.15, 'triangle'); setTimeout(() => this.blip(990, 0.2, 0.15, 'triangle'), 90); }
  alarm() { this.blip(500, 0.15, 0.2, 'sawtooth'); setTimeout(() => this.blip(400, 0.2, 0.2, 'sawtooth'), 140); }
  click() { this.blip(520, 0.05, 0.12, 'triangle'); }

  // ---------------- music -------------------------------------------------------------------
  startMusic() {
    if (!this.ctx || this.musicOn) return; this.musicOn = true;
    this.step = 0; this.next = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this._schedule(), 80);
  }
  stopMusic() { this.musicOn = false; clearInterval(this.timer); }
  _schedule() {
    const c = this.ctx; if (!c) return;
    const bpm = 108, sixteenth = 60 / bpm / 4;
    while (this.next < c.currentTime + 0.25) { this._step(this.step++, this.next, sixteenth); this.next += sixteenth; }
  }
  _step(s, t, len) {
    const c = this.ctx, bar = ((s / 16) | 0) % 4, st = s % 16;
    const roots = [45, 41, 48, 43], root = roots[bar];                    // A F C G (midi)
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const mb = this.musicBus;
    if (st % 4 === 0) { const o = this._osc('sine', 120), g = c.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); o.connect(g).connect(mb); o.start(t); o.stop(t + 0.2); }
    if (st % 4 === 2) { const n = this._noise(false), hp = c.createBiquadFilter(), g = c.createGain(); hp.type = 'highpass'; hp.frequency.value = 7000; g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); n.connect(hp).connect(g).connect(mb); n.start(t, Math.random()); n.stop(t + 0.08); }
    if (st === 4 || st === 12) { const n = this._noise(false), bp = c.createBiquadFilter(), g = c.createGain(); bp.type = 'bandpass'; bp.frequency.value = 1800; g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14); n.connect(bp).connect(g).connect(mb); n.start(t, Math.random()); n.stop(t + 0.2); }
    // bass (offbeat 8ths)
    if (st % 2 === 0) { const o = this._osc('sawtooth', hz(root)), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(180, t + len * 1.8); g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.001, t + len * 1.9); o.connect(f).connect(g).connect(mb); o.start(t); o.stop(t + len * 2); }
    // arpeggio
    const arp = [0, 7, 12, 15, 12, 7, 3, 7][st % 8] + (bar === 1 || bar === 3 ? 0 : 0);
    { const o = this._osc('square', hz(root + 24 + arp)), g = c.createGain(), f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400; g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.001, t + len * 0.9); o.connect(f).connect(g).connect(mb); o.start(t); o.stop(t + len); }
    // pad on the bar start
    if (st === 0) for (const iv of [0, 7, 12, 16]) { const o = this._osc('sawtooth', hz(root + 24 + iv)), g = c.createGain(), f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.045, t + 0.4); g.gain.linearRampToValueAtTime(0.0001, t + len * 16); o.detune.value = (Math.random() - 0.5) * 14; o.connect(f).connect(g).connect(mb); o.start(t); o.stop(t + len * 16 + 0.1); }
  }
}
