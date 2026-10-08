// DOM HUD: radar, killfeed, scoreboard, buy menu, chat, messages.
import { WEAPONS, GEAR, BUY_MENU } from '/shared/weapons.js';
import { WALL } from '/shared/constants.js';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export class HUD {
  constructor() {
    this.el = $('hud'); this.radar = $('radar'); this.rctx = this.radar.getContext('2d'); this.centerTimer = 0; this.toastTimer = 0; this.moneyTimer = 0; this.lastMoney = null;
  }
  show(v) { this.el.hidden = !v; }
  buildRadar(m) {
    const S = 2, c = document.createElement('canvas'); c.width = m.W * S; c.height = m.H * S; const x = c.getContext('2d');
    const img = x.createImageData(c.width, c.height);
    for (let z = 0; z < m.H; z++) for (let X = 0; X < m.W; X++) {
      const i = z * m.W + X, h = m.heights[i]; let col;
      if (h >= WALL) col = [0, 0, 0, 0];
      else if (m.mat[i] === 4) col = [120, 110, 95, 255];
      else { const v = 150 + m.floor[i] * 26; col = [v * 0.95, v * 0.9, v * 0.78, 235]; if (m.ceil[i] < 1e8) col = [col[0] * 0.7, col[1] * 0.7, col[2] * 0.7, 235]; }
      for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) { const o = ((z * S + a) * c.width + X * S + b) * 4; img.data.set(col, o); }
    }
    x.putImageData(img, 0, 0);
    // outline
    x.globalCompositeOperation = 'destination-over'; x.shadowColor = 'rgba(0,0,0,0)';
    x.globalCompositeOperation = 'source-over'; x.font = 'bold 22px "Libre Franklin",Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (const [k, r] of Object.entries(m.def.sites)) { x.fillStyle = 'rgba(230,80,60,.9)'; x.fillText(k, ((r[0] + r[2]) / 2) * S, ((r[1] + r[3]) / 2) * S); }
    this.radarImg = c; this.radarScale = S;
  }
  drawRadar(me, yaw, blips, bomb) {
    const g = this.rctx, W = this.radar.width, zoom = 2.3; g.clearRect(0, 0, W, W);
    if (!this.radarImg) return;
    g.save(); g.beginPath(); g.rect(0, 0, W, W); g.clip();
    g.translate(W / 2, W / 2); g.rotate(yaw); g.scale(zoom / this.radarScale, zoom / this.radarScale); g.translate(-me.x * this.radarScale, -me.z * this.radarScale);
    g.globalAlpha = 0.95; g.drawImage(this.radarImg, 0, 0); g.globalAlpha = 1;
    const S = this.radarScale;
    for (const b of blips) {
      g.fillStyle = b.color; g.beginPath(); g.arc(b.x * S, b.z * S, b.dead ? 2.2 * S : 3.2 * S, 0, 7); g.fill();
      if (b.dead) { g.strokeStyle = b.color; g.lineWidth = S; g.beginPath(); g.moveTo(b.x * S - 3 * S, b.z * S - 3 * S); g.lineTo(b.x * S + 3 * S, b.z * S + 3 * S); g.moveTo(b.x * S + 3 * S, b.z * S - 3 * S); g.lineTo(b.x * S - 3 * S, b.z * S + 3 * S); g.stroke(); }
      else if (b.yaw !== undefined) { g.strokeStyle = b.color; g.lineWidth = S * 1.2; g.beginPath(); g.moveTo(b.x * S, b.z * S); g.lineTo((b.x - Math.sin(b.yaw) * 6) * S, (b.z - Math.cos(b.yaw) * 6) * S); g.stroke(); }
    }
    if (bomb) { g.fillStyle = bomb.planted ? (Date.now() % 600 < 300 ? '#ff3b3b' : '#7a1010') : '#ffb23b'; g.fillRect(bomb.x * S - 3 * S, bomb.z * S - 2 * S, 6 * S, 4 * S); }
    g.restore();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(W / 2, W / 2 - 9); g.lineTo(W / 2 + 6, W / 2 + 6); g.lineTo(W / 2, W / 2 + 2); g.lineTo(W / 2 - 6, W / 2 + 6); g.closePath(); g.fill();
  }
  setVitals(you) {
    $('hp-v').textContent = Math.max(0, you.hp | 0); $('hpbox').querySelector('.hp').classList.toggle('low', you.hp <= 25);
    $('ar-v').textContent = you.ar | 0; $('hm').textContent = you.hm ? 'H' : '';
    if (this.lastMoney !== null && you.money !== this.lastMoney) {
      const d = you.money - this.lastMoney, em = $('money-d'); em.textContent = (d > 0 ? '+' : '−') + '$' + Math.abs(d); em.style.color = d > 0 ? '#c6ffcf' : '#ffb4b4';
      em.classList.add('show'); clearTimeout(this.moneyTimer); this.moneyTimer = setTimeout(() => em.classList.remove('show'), 1600);
    }
    this.lastMoney = you.money; $('money-v').textContent = you.money;
  }
  setAmmo(item, w, slots, active, hasBomb) {
    const name = active === 5 ? 'C4' : active === 4 && w ? w.name : w ? w.name : ''; $('wname').textContent = name;
    if (!item || !w || w.melee || w.nade || active === 5) { $('mag').textContent = '—'; $('res').textContent = ''; $('mag').classList.remove('low'); }
    else { $('mag').textContent = item.mag; $('res').textContent = '/ ' + item.res; $('mag').classList.toggle('low', item.mag <= Math.ceil(w.mag * 0.2)); }
    const html = [1, 2, 3].filter((s) => slots[s]).map((s) => `<div class="slot ${active === s ? 'on' : ''}"><b>${s}</b>${esc(WEAPONS[slots[s].k].name)}</div>`);
    const grenades = ['he', 'flash', 'smoke'].filter((k) => this.lastNades?.[k] > 0);
    if (active === 4 || grenades.length) html.push(`<div class="slot nade ${active === 4 ? 'on' : ''}"><b>4</b>${active === 4 && w ? esc(w.name) : 'Grenades'}</div>`);
    if (hasBomb) html.push(`<div class="slot bomb ${active === 5 ? 'on' : ''}"><b>5</b>C4</div>`);
    const h = html.join(''); if (h !== this._slots) { $('slots').innerHTML = h; this._slots = h; }
  }
  setTop(score, round, timer, low, planted, alive) {
    $('sc-ct').textContent = score.CT; $('sc-t').textContent = score.T; $('round-no').textContent = 'ROUND ' + Math.max(1, round);
    $('timer').textContent = timer; $('timer').classList.toggle('low', low); $('bomb-ind').hidden = !planted;
    for (const t of ['T', 'CT']) { const h = alive[t].map((a) => `<i class="${a ? '' : 'dead'}"></i>`).join(''); if (this['_al' + t] !== h) { $(t === 'T' ? 'al-t' : 'al-ct').innerHTML = h; this['_al' + t] = h; } }
  }
  kill(e, meId) {
    const div = document.createElement('div'); div.className = 'kf' + (e.k === meId || e.v === meId ? ' me' : '');
    div.innerHTML = (e.kn ? `<span class="${e.kt}">${esc(e.kn)}</span>${e.as ? `<span class="as">+ ${esc(e.as)}</span>` : ''}` : '') + `<span class="w">${esc(e.w === 'c4' ? 'C4' : (WEAPONS[e.w] || {}).name || e.w)}</span>${e.hs ? '<span class="hs">◉ HS</span>' : ''}<span class="${e.vt}">${esc(e.vn)}</span>`;
    const kf = $('killfeed'); kf.appendChild(div); while (kf.children.length > 6) kf.firstChild.remove();
    setTimeout(() => div.remove(), 7000);
  }
  center(text, sub = '', cls = '', ms = 3200) {
    const c = $('center'), t = $('center-t'); t.textContent = text; t.className = cls; $('center-s').textContent = sub; c.classList.add('show');
    clearTimeout(this.centerTimer); this.centerTimer = setTimeout(() => c.classList.remove('show'), ms);
  }
  toast(text) { const t = $('toast'); t.textContent = text; t.classList.add('show'); clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => t.classList.remove('show'), 1800); }
  hitmarker(hs) { const h = $('hitmark'); h.classList.remove('on', 'hs'); void h.offsetWidth; h.classList.add('on'); if (hs) h.classList.add('hs'); }
  hurt(angle, dmg) {
    const d = document.createElement('div'); d.className = 'dd'; d.style.transform = `rotate(${angle}rad)`; $('dmgdir').appendChild(d);
    requestAnimationFrame(() => { d.style.opacity = '0'; }); setTimeout(() => d.remove(), 1000);
    const v = $('vignette'); v.style.boxShadow = `inset 0 0 ${120 + dmg * 2}px rgba(200,0,0,${Math.min(0.75, 0.25 + dmg / 120)})`; clearTimeout(this.vt); this.vt = setTimeout(() => (v.style.boxShadow = 'inset 0 0 160px rgba(200,0,0,0)'), 250);
  }
  progress(label, frac) { const p = $('progress'); if (frac === null) { p.hidden = true; return; } p.hidden = false; $('prog-l').textContent = label; $('prog-b').style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%'; }
  crosshair(gapPx, hide) { const c = $('crosshair'); c.classList.toggle('hide', !!hide); c.style.setProperty('--gap', gapPx.toFixed(1) + 'px'); }
  chat(e) {
    const log = $('chat-log'), d = document.createElement('div');
    if (e.sys) { d.className = 'cm sys'; d.textContent = e.msg; }
    else { d.className = 'cm'; d.innerHTML = `${e.dead ? '<span style="color:#aaa">*DEAD* </span>' : ''}${e.teamOnly ? '<span style="color:#aaa">(Team) </span>' : ''}<span class="n ${e.team}">${esc(e.name)}</span>: ${esc(e.msg)}`; }
    log.appendChild(d); while (log.children.length > 8) log.firstChild.remove(); setTimeout(() => d.classList.add('old'), 9000);
  }
  scoreboard(show, roster, meId, score, room) {
    const sb = $('scoreboard'); sb.hidden = !show; if (!show) return;
    const me = roster.find((p) => p.id === meId); const rows = (t) => roster.filter((p) => p.team === t).sort((a, b) => b.k - a.k || a.d - b.d).map((p) =>
      `<div class="sb-row ${p.id === meId ? 'me' : ''} ${p.alive ? '' : 'dead'}"><div>${esc(p.name)}${p.bot ? '<span class="bt">BOT</span>' : ''}${p.bomb && me && me.team === 'T' ? ' <span style="color:#ff6b6b">C4</span>' : ''}</div><span>${me && (me.team === t || me.team === 'SPEC') ? '$' + p.money : ''}</span><span>${p.k}</span><span>${p.a}</span><span>${p.d}</span><span>${p.bot ? 'BOT' : p.ping || ''}</span><span>${p.alive ? '' : 'DEAD'}</span></div>`).join('');
    const hdr = '<div class="sb-row hdr"><div>PLAYER</div><span>MONEY</span><span>K</span><span>A</span><span>D</span><span>PING</span><span></span></div>';
    const spec = roster.filter((p) => p.team === 'SPEC').map((p) => esc(p.name)).join(', ');
    const mapLabel = ({ dust2: 'DUST II', mirage: 'MIRAGE', inferno: 'INFERNO', warehouse: 'WAREHOUSE', bazaar: 'BAZAAR', arena: 'ARENA' })[room.map] || String(room.map || '').toUpperCase();
    sb.innerHTML = `<div class="sb-head"><span>${esc(room.title)} · ${esc(room.code)}</span><span>${mapLabel}</span></div>
      <div class="sb-team CT"><h4><span>COUNTER-TERRORISTS</span><span>${score.CT}</span></h4>${hdr}${rows('CT')}</div>
      <div class="sb-team T"><h4><span>TERRORISTS</span><span>${score.T}</span></h4>${hdr}${rows('T')}</div>${spec ? `<div class="sb-head"><span>SPECTATORS: ${spec}</span></div>` : ''}`;
  }
  buyMenu(show, you, team, timeLeft, onBuy, onClose) {
    const bm = $('buymenu'); bm.hidden = !show; if (!show) { this._bmHtml = ''; return; }
    this._onBuy = onBuy; this._onClose = onClose;
    const owned = new Set([you.w[1] && you.w[1].k, you.w[2] && you.w[2].k]);
    const item = (k) => {
      const w = WEAPONS[k], g = GEAR[k], it = w || g; const tm = it.team; if (tm && tm !== team) return '';
      const price = it.price;
      const locked = false;
      if (k === 'vesthelm' && you.ar >= 100 && !you.hm) price = 350;
      const own = owned.has(k) || (k === 'vest' && you.ar >= 100) || (k === 'vesthelm' && you.ar >= 100 && you.hm) || (k === 'kit' && you.kit) || (w && w.nade && (you.g?.[k] || 0) >= w.max);
      const no = !own && you.money < price;
      const info = w ? (w.nade ? `${you.g?.[k] || 0}/${w.max}` : `${w.dmg} dmg · ${w.rpm} rpm${w.mag ? ' · ' + w.mag + '/' + w.res : ''}`) : k === 'kit' ? 'defuse in 5s' : 'armor 100';
      return `<button class="bm-item ${no ? 'no' : ''} ${own ? 'own' : ''}" data-k="${k}"><b>${esc(it.name)}</b><span>$${price}</span><small>${info}</small></button>`;
    };
    const cats = BUY_MENU.map((c) => ({ ...c, html: c.items.map(item).join('') })).filter((c) => c.html);
    if (!cats.some((c) => c.title === this.bmTab)) this.bmTab = cats.find((c) => c.title === 'Rifles') ? 'Rifles' : cats[0]?.title;
    const html = `<div class="bm-head"><h3>BUY MENU</h3><span class="bm-time"></span><span class="bm-money">$${you.money}</span><button class="bm-close" data-close="1" aria-label="close">×</button></div>
      <div class="bm-tabs">${cats.map((c) => `<button data-tab="${c.title}" class="${c.title === this.bmTab ? 'on' : ''}">${c.title}</button>`).join('')}</div>
      <div class="bm-cols">${cats.map((c) => `<div class="bm-col ${c.title === this.bmTab ? 'on' : ''}"><h4>${c.title}</h4>${c.html}</div>`).join('')}</div>
      <div class="bm-foot">Click to buy · B / Esc to close</div>`;
    // Only rebuild when something actually changed, otherwise a tap that lands during a re-render is lost.
    if (html !== this._bmHtml) {
      const sc = bm.querySelector('.bm-cols')?.scrollTop || 0;
      bm.innerHTML = html; this._bmHtml = html; const cols = bm.querySelector('.bm-cols'); if (cols) cols.scrollTop = sc;
    }
    const t = bm.querySelector('.bm-time'); if (t) t.textContent = timeLeft;
    if (!bm._wired) {
      bm._wired = true;
      bm.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-tab]'); if (tab) { this.bmTab = tab.dataset.tab; this._bmHtml = ''; this._rerenderBuy && this._rerenderBuy(); return; }
        if (e.target.closest('[data-close]')) { this._onClose && this._onClose(); return; }
        const it = e.target.closest('.bm-item'); if (it && this._onBuy) this._onBuy(it.dataset.k);
      });
    }
  }
}
