// Procedural canvas textures (no external assets needed).
import * as THREE from 'three';
import { mulberry32 } from './util.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, repeat = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}
function noise(ctx, w, h, amount, rng, alpha = 0.12) {
  for (let i = 0; i < amount; i++) {
    const v = (rng() * 255) | 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
  }
}

/** Road strip: 32m along (u) x 16m across (v). 16px per metre. */
export function roadTexture() {
  const W = 512, H = 256, c = canvas(W, H), g = c.getContext('2d'), rng = mulberry32(7);
  g.fillStyle = '#2c2f37'; g.fillRect(0, 0, W, H);
  noise(g, W, H, 5000, rng, 0.07);
  // tyre-worn lanes
  for (const cy of [H * 0.25, H * 0.75]) { const gr = g.createLinearGradient(0, cy - 28, 0, cy + 28); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(.5, 'rgba(0,0,0,.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, cy - 28, W, 56); }
  // edge lines
  g.fillStyle = 'rgba(235,235,235,.85)'; g.fillRect(0, 10, W, 4); g.fillRect(0, H - 14, W, 4);
  // centre dashes (double yellow broken)
  g.fillStyle = '#e8b820';
  for (let x = 0; x < W; x += 128) { g.fillRect(x, H / 2 - 5, 64, 3); g.fillRect(x, H / 2 + 2, 64, 3); }
  // cracks
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) { g.beginPath(); let x = rng() * W, y = rng() * H; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += 8 + rng() * 20; y += (rng() - 0.5) * 18; g.lineTo(x, y); } g.stroke(); }
  return tex(c);
}

/** Plain asphalt (intersections, parking, drift pads). */
export function asphaltTexture(lines = false) {
  const W = 256, c = canvas(W, W), g = c.getContext('2d'), rng = mulberry32(lines ? 11 : 3);
  g.fillStyle = '#2f323a'; g.fillRect(0, 0, W, W);
  noise(g, W, W, 3500, rng, 0.08);
  if (lines) { // parking bays: 2.5m wide slots, tile = 8m
    g.fillStyle = 'rgba(240,240,240,.8)';
    for (let x = 0; x < W; x += 80) g.fillRect(x, 0, 3, W * 0.5);
    g.fillRect(0, W * 0.5 - 1, W, 3);
  }
  return tex(c);
}

/** Drift pad with big painted circles. */
export function driftTexture() {
  const W = 512, c = canvas(W, W), g = c.getContext('2d'), rng = mulberry32(5);
  g.fillStyle = '#34363e'; g.fillRect(0, 0, W, W);
  noise(g, W, W, 6000, rng, 0.08);
  g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,.7)';
  for (const [r, col] of [[220, 'rgba(255,255,255,.55)'], [140, 'rgba(255,200,50,.65)'], [60, 'rgba(255,46,136,.7)']]) { g.strokeStyle = col; g.beginPath(); g.arc(W / 2, W / 2, r, 0, 7); g.stroke(); }
  g.setLineDash([22, 18]); g.strokeStyle = 'rgba(25,230,255,.6)'; g.beginPath(); g.arc(W / 2, W / 2, 190, 0, 7); g.stroke();
  g.setLineDash([]); g.strokeStyle = 'rgba(255,255,255,.35)'; g.strokeRect(14, 14, W - 28, W - 28);
  const t = tex(c, false); return t;
}

/** Building facade tile: 16m wide x 12.8m high, 4x4 windows. Returns {map, emissive}. */
export function buildingTextures() {
  const S = 256, c = canvas(S, S), e = canvas(S, S), g = c.getContext('2d'), ge = e.getContext('2d'), rng = mulberry32(21);
  g.fillStyle = '#d6d9e0'; g.fillRect(0, 0, S, S);
  noise(g, S, S, 1800, rng, 0.06);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  const cell = S / 4;
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const x = col * cell + 9, y = row * cell + 11, w = cell - 18, h = cell - 24;
    const gr = g.createLinearGradient(x, y, x, y + h);
    gr.addColorStop(0, '#46587a'); gr.addColorStop(.55, '#1c263d'); gr.addColorStop(1, '#2a3652');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, w, 3); // sill highlight
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y + h, w, 5);  // shadow under window
    if (rng() < 0.42) { ge.fillStyle = rng() < 0.8 ? '#ffd592' : '#bfe6ff'; ge.fillRect(x, y, w, h); }
  }
  return { map: tex(c), emissive: tex(e) };
}

/** Soft radial glow used for light pools and halos. */
export function glowTexture() {
  const S = 128, c = canvas(S, S), g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return tex(c, false);
}

export function grassTexture() {
  const S = 256, c = canvas(S, S), g = c.getContext('2d'), rng = mulberry32(9);
  g.fillStyle = '#35592f'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 4000; i++) { const l = 30 + rng() * 25; g.fillStyle = `hsla(${95 + rng() * 25},45%,${l}%,.35)`; g.fillRect(rng() * S, rng() * S, 2, 2 + rng() * 3); }
  return tex(c);
}

export function concreteTexture() {
  const S = 128, c = canvas(S, S), g = c.getContext('2d'), rng = mulberry32(13);
  g.fillStyle = '#8b8e96'; g.fillRect(0, 0, S, S);
  noise(g, S, S, 1200, rng, 0.1);
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.strokeRect(0, 0, S, S);
  return tex(c);
}
