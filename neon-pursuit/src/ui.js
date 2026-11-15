// All DOM user interface: HUD, minimap, menus, garage, challenges, settings, pause and summary screens.
import { VEHICLES, VEHICLE_ORDER, PAINTS, STAT_MAX, UPGRADES, MAX_UPGRADE, upgradeCost, CHALLENGES, TOUGE_CHALLENGES, MAPS, CATS } from './data.js';
import { save, upgradesOf } from './save.js';
import { fmtTime, fmtNum, clamp } from './util.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class UI {
  constructor(game) {
    this.g = game; this.backFn = null; this.root = document.getElementById('ui'); this.hud = document.getElementById('hud');
    this.cache = {}; this.helpT = 0; this.prev = null;
    this._buildHud();
    window.addEventListener('keydown', (e) => {
      if (this.backFn && (e.code === 'Escape' || e.code === 'Backspace')) { e.preventDefault(); e.stopImmediatePropagation(); this.g.audio.init(); this.g.audio.click(); this.backFn(); }
    }, true);
  }

  // ===================================================================== HUD
  _buildHud() {
    this.hud.innerHTML = `
      <div class="hud-left"><div class="hud-tl box"><div class="big" id="h-score">0</div><div class="ptlabel">POINTS</div>
        <div class="row"><span>Distance</span><b id="h-dist">0 m</b></div>
        <div class="row"><span id="h-l3">Takedowns</span><b id="h-td">0</b></div></div>
      <div class="hud-obj box hidden" id="h-obj"></div></div>
      <div class="hud-tc"><div class="stars" id="h-stars"></div><div class="timer" id="h-time">00:00</div><div class="status" id="h-status"></div></div>
      <div class="hud-tr box"><div class="moneylabel">CASH EARNED</div><div class="money" id="h-money">$0</div><div class="sub" id="h-mode"></div></div>
      <div class="hud-cam" id="h-cam"></div>
      <div class="hud-bl"><canvas id="minimap" width="400" height="400"></canvas></div>
      <div class="hud-br box">
        <div class="speed"><span class="gear" id="h-gear">N</span><span class="num" id="h-speed">0</span><span class="unit">km/h</span></div>
        <div class="bar rpm"><i id="h-rpm"></i></div>
        <div class="barlabel"><span>Damage</span><span id="h-dmgn">0%</span></div><div class="bar dmg"><i id="h-dmg"></i></div>
        <div class="barlabel"><span>Nitro</span><span id="h-nitn">100%</span></div><div class="bar nitro"><i id="h-nit"></i></div>
      </div>
      <div class="hud-bust hidden" id="h-bust"><div class="t">BUSTING...</div><div class="bar"><i id="h-bustb"></i></div></div>
      <div id="toasts"></div>
      <div class="combo" id="h-combo"></div>
      <div class="hud-help box" id="h-help"><span><b>W/↑</b> Accelerate</span><span><b>S/↓</b> Brake/Reverse</span><span><b>A D/←→</b> Steer</span><span><b>Space/X</b> Handbrake</span><span><b>Shift</b> Nitro</span><span><b>C</b> Camera</span><span><b>R</b> Recover</span><span><b>Esc</b> Pause</span></div>`;
    const q = (id) => document.getElementById(id);
    this.el = {}; for (const id of ['h-score', 'h-dist', 'h-td', 'h-l3', 'h-stars', 'h-time', 'h-status', 'h-money', 'h-mode', 'h-obj', 'h-cam', 'h-gear', 'h-speed', 'h-rpm', 'h-dmg', 'h-dmgn', 'h-nit', 'h-nitn', 'h-bust', 'h-bustb', 'toasts', 'h-combo', 'h-help']) this.el[id] = q(id);
    this.map = q('minimap'); this.mctx = this.map.getContext('2d');
    this.flashEl = document.getElementById('flash');
  }
  showHud(run) {
    this.hud.classList.remove('hidden'); this.root.innerHTML = ''; this.prev = {};
    this.el['h-mode'].textContent = run.ch ? 'Challenge' : { free: 'Free roam', chase: 'Police chase', tfree: 'Free drift', trun: 'Touge run', park: 'Drift park' }[run.mode];
    this.el['h-l3'].textContent = run.map === 'touge' ? 'Best chain' : 'Takedowns';
    this.el['h-help'].style.opacity = 1; clearTimeout(this.helpT); this.helpT = setTimeout(() => (this.el['h-help'].style.opacity = 0), 9000);
    this.el['toasts'].innerHTML = '';
  }
  hideHud() { this.hud.classList.add('hidden'); }
  toggleHelp() { const h = this.el['h-help']; h.style.opacity = h.style.opacity === '1' ? 0 : 1; }
  camName(n) { const e = this.el['h-cam']; e.textContent = 'Camera: ' + n; clearTimeout(this.camT); this.camT = setTimeout(() => (e.textContent = ''), 1500); }
  toast(text, cls = '') {
    const t = document.createElement('div'); t.className = 'toast ' + cls; t.textContent = text; const box = this.el['toasts'];
    box.appendChild(t); while (box.children.length > 4) box.firstChild.remove(); setTimeout(() => t.remove(), 2600);
  }
  flash(a) { this.flashEl.style.opacity = a; setTimeout(() => (this.flashEl.style.opacity = 0), 120); }
  _set(id, v) { if (this.prev[id] !== v) { this.prev[id] = v; this.el[id].textContent = v; } }
  updateHud(d) {
    this._set('h-score', fmtNum(d.score) + ' PTS'); this._set('h-dist', d.dist < 1000 ? Math.floor(d.dist) + ' m' : (d.dist / 1000).toFixed(2) + ' km');
    this._set('h-td', d.map === 'touge' ? fmtNum(d.best) : this.g.run.takedowns); this._set('h-time', fmtTime(d.time)); this._set('h-money', '$' + fmtNum(d.money));
    this._set('h-speed', Math.round(d.speed)); this._set('h-gear', d.gear < 0 ? 'R' : d.speed < 2 ? 'N' : d.gear);
    this.el['h-rpm'].style.width = (d.rpm * 100).toFixed(0) + '%';
    this.el['h-dmg'].style.width = d.damage.toFixed(0) + '%'; this._set('h-dmgn', d.damage.toFixed(0) + '%');
    this.el['h-nit'].style.width = (d.nitro * 100).toFixed(0) + '%'; this._set('h-nitn', d.nitroLock ? 'RECHARGING' : (d.nitro * 100).toFixed(0) + '%');
    let stars = ''; for (let i = 1; i <= 5; i++) stars += `<span class="${i <= d.level ? 'on' : 'off'}">★</span>`;
    const sKey = d.level + (d.hot ? 'h' : ''); if (this.prev.stars !== sKey) { this.prev.stars = sKey; this.el['h-stars'].innerHTML = d.mode === 'free' || !d.policeOn ? '' : stars; this.el['h-stars'].className = 'stars' + (d.hot ? ' flash' : ''); }
    this._set('h-status', d.map === 'touge' ? (d.lap >= 0 ? `LAP ${Math.round(d.lap * 100)}%  ·  APEXES ${d.clips}` : d.mode === 'park' ? 'DRIFT PARK' : `APEXES ${d.clips}`) : d.status); this.el['h-status'].className = 'status' + (d.hot ? ' hot' : d.status.startsWith('Evading') ? ' cool' : '');
    const bust = d.bust > 0.02; this.el['h-bust'].classList.toggle('hidden', !bust); if (bust) this.el['h-bustb'].style.width = (d.bust * 100).toFixed(0) + '%';
    const cb = this.el['h-combo'];
    if (d.combo) { cb.style.opacity = 1; const t = `DRIFT ${fmtNum(d.combo.pts)}<small>x${d.combo.mult.toFixed(1)}${d.map === 'touge' ? ' · ' + d.combo.ang + '°' : ''}</small>`; if (this.prev.combo !== t) { this.prev.combo = t; cb.innerHTML = t; } }
    else if (d.smash) { cb.style.opacity = 1; const t = `SMASH x${d.smash}`; if (this.prev.combo !== t) { this.prev.combo = t; cb.innerHTML = t; } } else cb.style.opacity = 0;
    const ob = this.el['h-obj']; if (d.obj) { ob.classList.remove('hidden'); const t = `<div class="t">${d.obj.title}</div><div class="p">${d.obj.text}</div>`; if (this.prev.obj !== t) { this.prev.obj = t; ob.innerHTML = t; } } else ob.classList.add('hidden');
  }

  /** Heading-up circular minimap with police / helicopter markers. */
  drawMinimap(d) {
    const g = this.mctx, W = 400, R = 200, M = this.g.world.minimap, ppm = 1.25, k = ppm / M.scale;
    g.save(); g.clearRect(0, 0, W, W); g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.clip();
    g.fillStyle = '#0a0d14'; g.fillRect(0, 0, W, W);
    g.translate(R, R); g.rotate(Math.PI + d.yaw);
    g.drawImage(M.canvas, -(d.x + M.half) * M.scale * k, -(d.z + M.half) * M.scale * k, M.canvas.width * k, M.canvas.height * k);
    const pulse = 0.5 + 0.5 * Math.sin(d.t * 10);
    for (const u of d.units) {
      const x = (u.x - d.x) * ppm, y = (u.z - d.z) * ppm, r2 = x * x + y * y; let px = x, py = y;
      if (r2 > (R - 14) ** 2) { const s = (R - 14) / Math.sqrt(r2); px *= s; py *= s; }
      g.fillStyle = u.f >= 0 ? '#ff3030' : '#3b6bff'; g.shadowColor = g.fillStyle; g.shadowBlur = 10;
      g.beginPath(); if (u.blk) g.rect(px - 5, py - 5, 10, 10); else g.arc(px, py, 5.5 + (r2 > (R - 14) ** 2 ? -1.5 : 0), 0, 7); g.fill(); g.shadowBlur = 0;
    }
    if (d.heli) { const x = (d.heli.x - d.x) * ppm, y = (d.heli.z - d.z) * ppm; g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 7, y + 6); g.lineTo(x - 7, y + 6); g.closePath(); g.fill(); g.strokeStyle = `rgba(255,255,255,${0.3 + pulse * 0.5})`; g.beginPath(); g.arc(x, y, 11 + pulse * 4, 0, 7); g.stroke(); }
    g.restore();
    // player arrow (always points up)
    g.save(); g.translate(R, R); g.fillStyle = '#19e6ff'; g.shadowColor = '#19e6ff'; g.shadowBlur = 12; g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.restore();
    g.strokeStyle = 'rgba(120,200,255,.35)'; g.lineWidth = 3; g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.stroke();
  }

  // ===================================================================== Screens
  screen(html, cls = 'dim') { this.backFn = null; this.root.innerHTML = `<div class="screen ${cls}">${html}</div>`; return this.root.firstChild; }
  clear() { this.root.innerHTML = ''; this.backFn = null; }
  /** Full-screen page: header with a big Back button (also Esc / Backspace), title, money, scrollable content. */
  page(title, body, back, { label = 'Back', cls = '', sub = '' } = {}) {
    const r = this.screen(`<div class="page ${cls}"><header>${back ? `<button class="backbtn" data-act="back"><i>←</i> ${label}</button>` : ''}<div class="ttl"><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="grow"></div><div class="money-pill static">$${fmtNum(this.g.save.money)}</div></header><main>${body}</main></div>`, 'bare');
    this.backFn = back || null; return r;
  }
  on(root, acts) {
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]'); if (!t || t.disabled || t.classList.contains('disabled')) return;
      this.g.audio.init(); this.g.audio.click();
      const fn = acts[t.dataset.act]; if (fn) fn(t.dataset.arg, t);
    });
  }
  moneyPill() { return `<div class="money-pill">$${fmtNum(this.g.save.money)}</div>`; }

  showLoading() { this.screen(`<div class="logo"><span>NEON</span> <em>PURSUIT</em></div><div class="barwrap"><i id="ld" style="width:30%"></i></div>`, 'loading'); }

  showMain() {
    const g = this.g, S = g.save; g.state = 'menu'; g.setPlayerCar(); g.player.setVisible(false);
    const hs = S.scores.chase;
    const r = this.screen(`
      <div class="menu-col">
        <div class="logo"><span>NEON</span><br><em>PURSUIT</em></div>
        <div class="tag">Police chases · mountain drifting</div>
        <button class="btn" data-act="play">Play</button>
        <button class="btn pink" data-act="garage">Garage</button>
        <button class="btn" data-act="challenges">Challenges</button>
        <button class="btn pink" data-act="settings">Settings</button>
        <button class="btn" data-act="controls">Controls</button>
        <div class="stats"><div><small>Best chase</small><b>${fmtNum(hs.score)} PTS</b></div><div><small>Free roam</small><b>${(S.scores.free.distance / 1000).toFixed(1)} KM</b></div><div><small>Touge run</small><b>${fmtNum((S.scores.touge || { run: { score: 0 } }).run.score)} PTS</b></div><div><small>Cars owned</small><b>${S.owned.length} / ${VEHICLE_ORDER.length}</b></div></div>
      </div>${this.moneyPill()}`, 'side');
    this.on(r, { play: () => this.showPlay(), garage: () => this.showGarage(), challenges: () => this.showChallenges('city'), settings: () => this.showSettings(() => this.showMain()), controls: () => this.showControls(() => this.showMain()) });
  }

  /** Step 1 of playing: choose the map. */
  showPlay() {
    const S = this.g.save, TS = S.scores.touge || { run: { score: 0, time: 0 }, park: { score: 0 }, free: { score: 0 } };
    const r = this.page('Choose map', `<div class="cards big two">
      <div class="card map city" data-act="map" data-arg="city"><div class="art"></div><h4>${MAPS.city.name}</h4><div class="tagline">${MAPS.city.tag}</div><p>${MAPS.city.desc}</p><div class="chips"><span>Free roam</span><span>Police chase</span><span>${CHALLENGES.length} challenges</span></div><div class="best">Best chase ${fmtNum(S.scores.chase.score)} PTS</div></div>
      <div class="card map touge" data-act="map" data-arg="touge"><div class="art"></div><h4>${MAPS.touge.name}</h4><div class="tagline">${MAPS.touge.tag}</div><p>${MAPS.touge.desc}</p><div class="chips"><span>Free drift</span><span>Touge run</span><span>Drift park</span><span>${TOUGE_CHALLENGES.length} challenges</span></div><div class="best">Best run ${fmtNum(TS.run.score)} PTS</div></div></div>`, () => this.showMain(), { label: 'Main menu' });
    this.on(r, { map: (id) => this.showModes(id), back: () => this.showMain() });
  }

  /** Step 2: choose what to do on that map. */
  showModes(map) {
    const g = this.g;
    if (map === 'city') {
      const r = this.page(MAPS.city.name, `<div class="cards big three">
        <div class="card" data-act="free"><h4>Free Roam</h4><p>Explore the city with no objective. No police, just traffic, drifting and destruction.</p></div>
        <div class="card" data-act="chase"><h4>Police Chase</h4><p>Survive as long as you can. Police escalate from patrol cars to roadblocks and helicopters.</p><div class="best">Best ${fmtNum(g.save.scores.chase.score)} PTS</div></div>
        <div class="card" data-act="ch"><h4>Challenges</h4><p>Specific objectives with cash rewards: escapes, drifts, distance and more.</p></div></div>`, () => this.showPlay(), { label: 'Maps', sub: MAPS.city.tag });
      this.on(r, { free: () => g.startRun('free'), chase: () => g.startRun('chase'), ch: () => this.showChallenges('city'), back: () => this.showPlay() });
    } else {
      const TS = g.save.scores.touge || { run: { score: 0, time: 0 }, park: { score: 0 }, free: { score: 0 } };
      const r = this.page(MAPS.touge.name, `<div class="cards big four">
        <div class="card" data-act="tfree"><h4>Free Drift</h4><p>Cruise the whole mountain with no timer. Chain slides, clip the orange apex markers and build your multiplier.</p><div class="best">Best ${fmtNum(TS.free.score)} PTS</div></div>
        <div class="card" data-act="trun"><h4>Touge Run</h4><p>One full lap from the summit. Your banked drift points plus a time bonus make your score.</p><div class="best">Best ${fmtNum(TS.run.score)} PTS${TS.run.time ? ' · ' + fmtTime(TS.run.time) : ''}</div></div>
        <div class="card" data-act="park"><h4>Drift Park</h4><p>A big open asphalt lot with painted donut zones (x1.6 points) and a cone slalom. Pure freestyle.</p><div class="best">Best ${fmtNum(TS.park.score)} PTS</div></div>
        <div class="card" data-act="ch"><h4>Challenges</h4><p>${TOUGE_CHALLENGES.length} drift objectives: apexes, long chains, angle holds, laps and more.</p></div></div>`, () => this.showPlay(), { label: 'Maps', sub: MAPS.touge.tag });
      this.on(r, { tfree: () => g.startRun('tfree'), trun: () => g.startRun('trun'), park: () => g.startRun('park'), ch: () => this.showChallenges('touge'), back: () => this.showPlay() });
    }
  }

  showChallenges(map = 'city') {
    const S = this.g.save, list = map === 'touge' ? TOUGE_CHALLENGES : CHALLENGES;
    const done = list.filter((c) => S.done[c.id]).length;
    const cards = list.map((c) => `<div class="card ${S.done[c.id] ? 'done' : ''}" data-act="ch" data-arg="${c.id}"><h4>${c.name}</h4><p>${c.desc}</p><div class="reward">$${fmtNum(c.reward)}${S.done[c.id] ? ' · completed' : ''}</div></div>`).join('');
    const tabs = ['city', 'touge'].map((m) => `<button class="tab ${m === map ? 'on' : ''}" data-act="tab" data-arg="${m}">${MAPS[m].name}</button>`).join('');
    const r = this.page('Challenges', `<div class="tabs">${tabs}<span class="count">${done} / ${list.length} completed</span></div><div class="cards big">${cards}</div>`, () => this.showMain(), { label: 'Main menu' });
    this.on(r, { ch: (id) => this.g.startRun('challenge', id), tab: (m) => this.showChallenges(m), back: () => this.showMain() });
  }

  // ---------------------------------------------------------------- garage
  showGarage(sel) {
    const g = this.g, S = g.save; g.state = 'garage';
    sel = sel || S.selected;
    if (!g.player || g.previewId !== sel) { g.previewId = sel; g.setPlayerCar(sel); }
    const spec = VEHICLES[sel], owned = S.owned.includes(sel), up = upgradesOf(sel);
    const e = up.engine, t = up.tires, a = up.armor;
    const stat = (label, base, bonus, max) => `<div class="statrow"><span>${label}</span><div class="b"><i style="width:${clamp((base + bonus) / max * 100, 0, 100)}%"></i></div><span>${Math.round((base + bonus) / max * 100)}</span></div>`;
    const handling = (s, tt) => (s.mu * (1 + 0.04 * tt) / 1.6) * 50 + s.steer / 0.55 * 30 + (s.kf + s.kr) / 160 * 20;
    let lastCat = ''; const list = VEHICLE_ORDER.map((id) => (VEHICLES[id].cat !== lastCat ? (lastCat = VEHICLES[id].cat, `<div class="cat">${CATS[lastCat]}</div>`) : '') + `<div class="item ${id === sel ? 'sel' : ''}" data-act="sel" data-arg="${id}"><span>${VEHICLES[id].name}</span><small>${S.owned.includes(id) ? (S.selected === id ? 'EQUIPPED' : 'OWNED') : '$' + fmtNum(VEHICLES[id].price)}</small><em>${VEHICLES[id].rating}</em></div>`).join('');
    const sw = PAPER(PAINTS, S.colors[sel] ?? spec.color);
    const ups = Object.keys(UPGRADES).map((k) => {
      const lvl = up[k], maxed = lvl >= MAX_UPGRADE, cost = upgradeCost(k, lvl);
      let pips = ''; for (let i = 0; i < MAX_UPGRADE; i++) pips += `<i class="${i < lvl ? 'on' : ''}"></i>`;
      return `<div class="up-row"><div>${UPGRADES[k].name}<span class="pips">${pips}</span><small>${UPGRADES[k].desc}</small></div>
        <button class="btn sm ${!owned || maxed || S.money < cost ? 'disabled' : ''}" data-act="up" data-arg="${k}">${maxed ? 'MAX' : '$' + fmtNum(cost)}</button></div>`;
    }).join('');
    const action = owned ? (S.selected === sel ? `<button class="btn disabled">Equipped</button>` : `<button class="btn" data-act="equip">Select</button>`) : `<button class="btn ${S.money < spec.price ? 'disabled' : ''}" data-act="buy">Buy · $${fmtNum(spec.price)}</button>`;
    const keep = this.root.querySelector('.garage .list'), keepTop = keep ? keep.scrollTop : 0;
    const r = this.page('Garage', `<div class="garage"><div class="panel list">${list}</div>
      <div class="panel detail"><h2>${spec.name}</h2><div class="rate">RATING <b>${spec.rating}</b> · ${CATS[spec.cat]}</div><p style="color:var(--dim);font-size:13px;margin-bottom:10px">${spec.desc}</p>
        ${stat('Top speed', spec.vmax, spec.vmax * 0.04 * e, STAT_MAX.vmax * 1.25)}${stat('Acceleration', spec.power, spec.power * 0.04 * e, STAT_MAX.power * 1.2)}
        ${stat('Handling', handling(spec, 0), handling(spec, t) - handling(spec, 0), STAT_MAX.handling * 1.1)}${stat('Braking', spec.brake, spec.brake * 0.04 * t, STAT_MAX.brake * 1.25)}${stat('Durability', spec.dur, spec.dur * 0.15 * a, STAT_MAX.dur * 1.6)}
        <h3>Paint</h3><div class="swatches">${sw}</div><h3>Upgrades</h3>${ups}<div style="margin-top:14px">${action}</div></div></div>`, () => { g.previewId = null; this.showMain(); }, { label: 'Main menu', cls: 'side' });
    { const dt = r.querySelector('.detail'), W = window.innerWidth; g.garageNdc = dt && W > 900 ? ((dt.getBoundingClientRect().right + W) / 2) / W * 2 - 1 : 0; }
    const nl = r.querySelector('.garage .list'); if (nl) nl.scrollTop = keepTop;
    this.on(r, {
      sel: (id) => this.showGarage(id),
      back: () => { g.previewId = null; this.showMain(); },
      equip: () => { S.selected = sel; save(); this.showGarage(sel); },
      buy: () => { if (S.money >= spec.price) { S.money -= spec.price; S.owned.push(sel); S.selected = sel; save(); g.audio.chime(); } this.showGarage(sel); },
      up: (k) => { const lvl = up[k], cost = upgradeCost(k, lvl); if (owned && lvl < MAX_UPGRADE && S.money >= cost) { S.money -= cost; up[k]++; save(); g.audio.chime(); g.player.car.applyUpgrades(up); } this.showGarage(sel); },
      paint: (i) => { S.colors[sel] = +i; save(); g.setPlayerCar(sel); this.showGarage(sel); },
    });
  }

  // ---------------------------------------------------------------- settings / controls
  showSettings(back) {
    const g = this.g, s = g.save.settings;
    const sl = (id, label, min, max, step, val, fmt) => `<div class="field"><label>${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output id="${id}o">${fmt(val)}</output></div>`;
    const pct = (v) => Math.round(v * 100) + '%';
    const r = this.page('Settings', `<div class="panel wide">
      <div class="field"><label>Graphics quality</label><select id="s-q"><option value="low">Low (fastest)</option><option value="medium">Medium</option><option value="high">High (shadows + bloom)</option></select></div>
      <div class="field"><label>Time of day</label><select id="s-t"><option value="cycle">Day / night cycle</option><option value="day">Always day</option><option value="dusk">Always dusk</option><option value="night">Always night</option></select></div>
      ${sl('s-sfx', 'Sound volume', 0, 1, 0.05, s.sfx, pct)}${sl('s-mus', 'Music volume', 0, 1, 0.05, s.music, pct)}
      ${sl('s-sens', 'Mouse sensitivity', 0.3, 2.5, 0.1, s.sens, (v) => (+v).toFixed(1))}${sl('s-fov', 'Field of view', 50, 90, 1, s.fov, (v) => v + '°')}
      <button class="btn sm" data-act="fs">Toggle fullscreen</button><button class="btn sm pink" data-act="reset">Reset progress</button><br>
      </div>`, back);
    r.querySelector('#s-q').value = s.quality; r.querySelector('#s-t').value = s.time;
    const bind = (id, key, fmt, apply = true) => r.querySelector('#' + id).addEventListener('input', (e) => { s[key] = key === 'quality' || key === 'time' ? e.target.value : +e.target.value; const o = r.querySelector('#' + id + 'o'); if (o) o.textContent = fmt(s[key]); if (apply) g.applySettings(); save(); });
    bind('s-q', 'quality', String); bind('s-t', 'time', String); bind('s-sfx', 'sfx', pct); bind('s-mus', 'music', pct); bind('s-sens', 'sens', (v) => v.toFixed(1)); bind('s-fov', 'fov', (v) => v + '°');
    this.on(r, { back, fs: () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); },
      reset: () => { if (confirm('Reset all progress (money, cars, upgrades, scores)?')) { import('./save.js').then((m) => { m.resetSave(); g.save = m.getSave(); g.setPlayerCar(); g.applySettings(); this.showSettings(back); }); } } });
  }

  showControls(back) {
    const r = this.page('Controls', `<div class="panel wide"><div class="keys">
      <kbd>W / ↑</kbd><span>Accelerate</span><kbd>S / ↓</kbd><span>Brake / reverse</span><kbd>A D / ← →</kbd><span>Steer</span>
      <kbd>Space / X</kbd><span>Handbrake: starts a powerslide</span><kbd>Shift</kbd><span>Nitro boost</span><kbd>C</kbd><span>Change camera</span>
      <kbd>R</kbd><span>Recover onto the road</span><kbd>H</kbd><span>Show / hide key hints</span><kbd>Esc</kbd><span>Pause</span><kbd>Mouse drag</kbd><span>Look around</span></div>
      <h3>Powerslide</h3><p style="font-size:13px;color:var(--dim);line-height:1.5">Tap the handbrake while steering, then hold the throttle: the car slides. Steer into the turn for a bigger angle, steer against it for a smaller one. Lift off or brake to regrip.</p>
      <h3>Tips</h3><p style="font-size:13px;color:var(--dim);line-height:1.5">Break line of sight and stay hidden to cool the heat. Police box you in: keep moving, a stationary car gets busted. Smash props, drift and near-miss traffic for score. Money is earned from everything you do.</p>
      </div>`, back);
    this.on(r, { back });
  }

  showPause() {
    const r = this.screen(`<div class="panel center" style="min-width:320px"><h2>Paused</h2>
      <button class="btn" data-act="resume">Resume</button><button class="btn pink" data-act="settings">Settings</button><button class="btn" data-act="controls">Controls</button><button class="btn pink" data-act="quit">End run</button></div>`);
    this.on(r, { resume: () => this.g.resume(), settings: () => this.showSettings(() => this.showPause()), controls: () => this.showControls(() => this.showPause()), quit: () => { this.g.state = 'playing'; this.g.audio.resume(); this.g.quitToMenu(true); } });
  }
  hidePause() { this.clear(); }

  showSummary(s) {
    const run = s.run, g = this.g;
    const r = this.screen(`<div class="panel summary"><div class="title ${s.bad ? 'bad' : 'good'}">${s.title}</div>
      ${s.record ? '<div style="color:var(--amber);letter-spacing:.2em">★ NEW PERSONAL BEST ★</div>' : ''}
      ${s.success === true ? `<div style="color:var(--cash);margin-top:6px">Challenge complete: ${run.ch.name}  +$${fmtNum(s.reward)}</div>` : s.success === false ? `<div style="color:var(--red);margin-top:6px">Challenge not completed</div>` : ''}
      <div class="sumgrid"><div>Points<b class="ptsc">${fmtNum(run.score)}</b></div><div>Time<b>${fmtTime(run.time)}</b></div><div>Distance<b>${(run.dist / 1000).toFixed(2)} km</b></div>${run.map === 'touge' ? `<div>Best chain<b>${fmtNum(run.bestChain)}</b></div>
        <div>Apexes<b>${run.clips}</b></div><div>Max angle<b>${Math.round(run.maxAngle * 57.3)}°</b></div><div>Props smashed<b>${run.smashed}</b></div>` : `<div>Max wanted<b>${run.maxLevel}★</b></div>
        <div>Takedowns<b>${run.takedowns}</b></div><div>Escapes<b>${run.escapes}</b></div><div>Props smashed<b>${run.smashed}</b></div>`}<div>Drift points<b>${fmtNum(run.driftBank)}</b></div></div>
      <div class="payout"><span class="pts">${fmtNum(run.score)} PTS</span><span class="arrow">→</span><span class="cash">$${fmtNum(Math.floor(run.money))}</span>${s.reward ? `<span class="plus">+ <span class="cash">$${fmtNum(s.reward)}</span> challenge</span>` : ''}<div class="tot">TOTAL EARNED <span class="cash">$${fmtNum(s.total)}</span></div></div>
      <button class="btn" data-act="retry">Retry</button><button class="btn pink" data-act="garage">Garage</button><button class="btn" data-act="menu">Main menu</button></div>`);
    this.on(r, { retry: () => g.startRun(run.mode, run.ch ? run.ch.id : null), garage: () => { g.quitToMenu(false); this.showGarage(); }, menu: () => g.quitToMenu(false) });
  }
}

function PAPER(paints, sel) { return paints.map((c, i) => `<i class="${i === sel ? 'sel' : ''}" style="background:${hex(c)}" data-act="paint" data-arg="${i}"></i>`).join(''); }
