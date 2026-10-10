// Client game: local prediction, remote interpolation, shooting, effects, spectating, HUD glue.
import * as THREE from 'three';
import { PHYS, ROUND, clamp, forward, angDiff } from '/shared/constants.js';
import { calloutAt, inRect } from '/shared/maps.js';
import { stepMove, rayWorld, rayPlayer, hasLOS } from '/shared/physics.js';
import { WEAPONS, WEAPON_KEYS, NADES, inaccuracy, spreadDir } from '/shared/weapons.js';
import { makeSoldier, setRigWeapon, animateRig, makeGun, makeViewArms } from './models.js';
import * as TX from './textures.js';
import { radio } from './audio.js';

const INTERP = 100;
const $ = (id) => document.getElementById(id);
const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const TEAMNAME = { T: 'Terrorists', CT: 'Counter-Terrorists' };

export class Game {
  constructor(ctx) {
    Object.assign(this, ctx);
    this.remotes = new Map(); this.dropMeshes = new Map(); this.nadeMeshes = new Map(); this.smokeFx = new Map(); this.blind = 0; this.blindMax = 0; this.effects = []; this.decals = []; this.decalIdx = 0;
    this.keys = {}; this.mouseL = false; this.inRoom = false; this.offset = 0; this.rtt = 0;
    this.roster = []; this.rosterMap = new Map(); this.score = { T: 0, CT: 0 }; this.round = 0; this.phase = 'warmup'; this.phaseEnd = 0; this.liveStart = 0;
    this.bomb = { state: 'none' }; this.you = null; this.s = { x: 64, y: 0, z: 64, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false };
    this.yaw = 0; this.pitch = 0; this.cid = 0; this.eyeH = PHYS.eye; this.alive = false;
    this.nextFire = 0; this.drawEnd = 0; this.shotsFired = 0; this.lastShotT = 0; this.trigger = false; this.punchP = 0; this.punchY = 0; this.scope = 0; this.reloadUntil = 0;
    this.lastLocalShot = 0; this.pendingSwitch = 0; this.lastSend = 0; this.stepAcc = 0; this.menuPaused = false; this.buyOpen = false; this.sbOpen = false; this.chatOpen = false; this.locked = false;
    this.specId = null; this.specMode = 'fp'; this.deathAt = 0; this.killerId = null; this.shake = 0; this.lastBeep = 0; this.spotted = new Map(); this.lastSpot = 0; this.hudTick = 0;
    this.vm = null; this.vmGun = null; this.vmKey = null; this.vmTeam = null; this.vmKick = 0; this.vmBob = 0; this.swayX = 0; this.swayY = 0;
    this.initFx();
  }
  // ---------------- networking ----------------
  attach(net) {
    this.net = net; this.offset = 0;
    const on = (ev, f) => net.on(ev, f.bind(this));
    on('init', this.onInit); on('roster', this.onRoster); on('snap', this.onSnap); on('you', this.onYou); on('spawn', this.onSpawn); on('correct', this.onCorrect);
    on('round', this.onRound); on('bomb', this.onBomb); on('drops', this.onDrops); on('fx', this.onFx); on('hit', this.onHit); on('hurt', this.onHurt);
    on('kill', this.onKill); on('profile', this.onProfile); on('vote', this.onVote); on('act', this.onAct); on('boom', this.onBoom); on('smokes', this.onSmokes);
    on('server:closed', this.onServerClosed); on('msg', (d) => this.hud.center(d.text, d.sub || '', '', 2600)); on('chat', (d) => this.hud.chat(d));
    if (!net.offline) { clearInterval(this.pingTimer); this.pingTimer = setInterval(() => this.ping(), 2000); this.ping(); }
  }
  onServerClosed() {
    this.cleanup();
    this.onLeave && this.onLeave();
  }
  ping() {
    if (!this.net || this.net.offline) return; const t0 = Date.now();
    this.net.emit('ping', null, (st) => { const rtt = Date.now() - t0; this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt; const off = st + rtt / 2 - Date.now(); this.offset = this.offsetInit ? this.offset * 0.8 + off * 0.2 : off; this.offsetInit = true; if (this.inRoom) this.net.emit('pingv', Math.round(this.rtt)); });
  }
  serverNow() { return Date.now() + this.offset; }
  onInit(d) {
    if (!this.net.offline && !this.pingTimer) { this.pingTimer = setInterval(() => this.ping(), 2000); this.ping(); }
    this.room = d; this.meId = d.you; this.inRoom = true; this.score = d.score; this.round = d.round; this.phase = d.phase; this.phaseEnd = d.phaseEnd;
    if (!this.offsetInit && this.net.offline) this.offset = 0; else if (!this.offsetInit) this.offset = d.t - Date.now();
    this.onRoster(d.roster); this.rankProfile = d.profile || null; this.onBomb(d.bomb); this.onDrops(d.drops); this.onSmokes(d.smokes || []); this.alive = false; this.you = null;
    this.onMap && this.onMap(d.map); this.hud.show(true); this.hud.buildRadar(this.map); $('p-code').textContent = `SERVER ${d.code}`; $('ts-room').textContent = `${d.title} · ${d.code}`;
    this.onEnter && this.onEnter(d);
    const me = this.rosterMap.get(this.meId);
    if (d.resumed && me && me.team !== 'SPEC') { this.closeMenus(); $('teamsel').hidden = true; this.team = me.team; this.lock(); this.hud.toast('دوباره وصل شدی'); }
    else this.openTeamSelect();
  }
  onRoster(r) {
    this.roster = r; this.rosterMap = new Map(r.map((p) => [p.id, p]));
    const me = this.rosterMap.get(this.meId); if (me) this.team = me.team;
    for (const [id, rem] of this.remotes) { const info = this.rosterMap.get(id); if (!info || info.team === 'SPEC') this.removeRemote(id); else if (info.team !== rem.team) this.removeRemote(id); }
    this.updateTeamCounts(); if (this.sbOpen) this.hud.scoreboard(true, this.roster, this.meId, this.score, this.room);
  }
  onSnap(s) {
    const seen = new Set();
    for (const e of s.p) {
      const [id, x, y, z, yaw, pitch, fl, wi, hp] = e; seen.add(id); if (id === this.meId) { this.meFlags = fl; continue; }
      const r = this.ensureRemote(id); if (!r) continue;
      r.buf.push({ t: s.t, x, y, z, yaw, pitch, fl, wi, hp }); if (r.buf.length > 40) r.buf.shift();
    }
    for (const id of this.remotes.keys()) if (!seen.has(id)) this.removeRemote(id);
    // grenades in flight
    const live = new Set();
    for (const [id, ki, x, y, z] of s.n || []) {
      live.add(id); let g = this.nadeMeshes.get(id);
      if (!g) { g = makeGun(WEAPON_KEYS[ki] || 'he'); g.scale.setScalar(1.8); g.position.set(x, y, z); this.scene.add(g); this.nadeMeshes.set(id, g); }
      g.userData.to = new THREE.Vector3(x, y, z);
    }
    for (const [id, g] of this.nadeMeshes) if (!live.has(id)) { this.scene.remove(g); this.nadeMeshes.delete(id); }
  }
  onBoom(b) {
    const p = new THREE.Vector3(b.x, b.y + 0.15, b.z);
    if (b.k === 'he') { this.sound.heBlast(p); this.blastFx(p, 0.55); }
    else if (b.k === 'flash') {
      this.sound.flashBang(p); this.flashAt(p, true); this.flashLight.intensity = 120; this.flashLight.distance = 30; this.flashT = 0.12;
      const eye = this.alive ? [this.s.x, this.s.y + this.eyeH, this.s.z] : [this.camera.position.x, this.camera.position.y, this.camera.position.z];
      const c = [p.x, p.y, p.z], d = Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]);
      if (d < 34 && hasLOS(this.map, eye, c) && !this.smokeBetween(eye, c)) {
        const fw = new THREE.Vector3(); this.camera.getWorldDirection(fw);
        const dot = (fw.x * (c[0] - eye[0]) + fw.y * (c[1] - eye[1]) + fw.z * (c[2] - eye[2])) / Math.max(0.01, d);
        const amt = (dot > 0.5 ? 1 : dot > 0 ? 0.6 : 0.25) * Math.min(1, 1.25 - d / 34);
        const dur = Math.max(0, amt) * 4.8; if (dur > this.blind) { this.blind = dur; this.blindMax = dur; } this.sound.ring(Math.min(1, amt));
      }
    } else if (b.k === 'smoke') this.sound.smokePop(p);
  }
  smokeBetween(a, b) {
    for (const s of this.smokeList || []) {
      const cy = s.y + 1.4, dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L2 = dx * dx + dy * dy + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((s.x - a[0]) * dx + (cy - a[1]) * dy + (s.z - a[2]) * dz) / L2));
      const px = a[0] + dx * t - s.x, py = a[1] + dy * t - cy, pz = a[2] + dz * t - s.z; if (px * px + py * py * 0.6 + pz * pz < s.r * s.r * 0.8) return true;
    }
    return false;
  }
  onSmokes(list) {
    this.smokeList = list || []; const ids = new Set(this.smokeList.map((s) => s.id));
    for (const [id, fx] of this.smokeFx) if (!ids.has(id)) { fx.fade = true; }
    for (const s of this.smokeList) {
      let fx = this.smokeFx.get(s.id);
      if (fx) {
        fx.holes = Array.isArray(s.holes) ? s.holes.map((h) => ({ ...h })) : [];
        fx.color = s.color || '#b7b7b2';
        fx.puffs.forEach((p) => p.material.color.set(fx.color));
        continue;
      }
      const g = new THREE.Group(); g.position.set(s.x, s.y, s.z); const puffs = [];
      for (let i = 0; i < 42; i++) {
        const m = new THREE.SpriteMaterial({ map: this.texSmoke, color: new THREE.Color(s.color || '#b7b7b2'), transparent: true, depthWrite: false, opacity: 0 });
        const sp = new THREE.Sprite(m); const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s.r * 0.82;
        sp.userData = { x: Math.cos(a) * r, y: 0.35 + Math.random() * 2.8, z: Math.sin(a) * r, size: 3.0 + Math.random() * 2.5, rot: (Math.random() - 0.5) * 0.3 };
        sp.position.set(0, 0.3, 0); sp.scale.setScalar(0.5); g.add(sp); puffs.push(sp);
      }
      this.scene.add(g); this.smokeFx.set(s.id, { g, puffs, t: 0, fade: false, k: 1, holes: Array.isArray(s.holes) ? s.holes.map((h) => ({ ...h })) : [], color: s.color || '#b7b7b2' });
    }
  }
  updateNades(dt) {
    for (const g of this.nadeMeshes.values()) { if (g.userData.to) g.position.lerp(g.userData.to, Math.min(1, dt * 18)); g.rotation.x += dt * 9; g.rotation.y += dt * 5; }
    for (const [id, fx] of this.smokeFx) {
      fx.t += dt; const grow = Math.min(1, fx.t / 1.6), e = 1 - Math.pow(1 - grow, 3);
      if (fx.fade) { fx.k -= dt / 2.5; if (fx.k <= 0) { this.scene.remove(fx.g); fx.puffs.forEach((p) => p.material.dispose()); this.smokeFx.delete(id); continue; } }
      for (const p of fx.puffs) {
        const u = p.userData; p.position.set(u.x * e, 0.3 + (u.y - 0.3) * e, u.z * e); p.scale.setScalar(u.size * (0.35 + 0.65 * e));
        const wx = fx.g.position.x + u.x * e, wy = fx.g.position.y + (0.3 + (u.y - 0.3) * e), wz = fx.g.position.z + u.z * e;
        let clear = 0;
        for (const h of fx.holes || []) {
          const d = Math.hypot(wx - h.x, wz - h.z);
          if (d < h.r) clear = Math.max(clear, 1 - d / Math.max(0.01, h.r));
        }
        p.material.opacity = 0.93 * e * fx.k * (1 - clear * 0.98);
        p.material.rotation += u.rot * dt;
      }
    }
    if (this.blind > 0) this.blind = Math.max(0, this.blind - dt);
    const el = $('flashed'); if (el) { const o = this.blind > 0 ? Math.min(1, this.blind / Math.min(1.4, this.blindMax || 1)) : 0; el.style.opacity = o.toFixed(3); }
  }
  blastFx(p, scale = 1) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    ball.position.copy(p); this.addFx(ball, 0.45, (fx, k) => { ball.scale.setScalar((1 + (1 - k) * 6) * scale); ball.material.opacity = k * k; });
    for (let i = 0; i < 7; i++) { const q = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.8, (Math.random() - 0.5) * 3)); this.puff(q, this.texDust, 2.5 + Math.random() * 2.5, 1.4 + Math.random(), 0.6); }
    this.flashLight.position.copy(p); this.flashLight.intensity = 160; this.flashLight.distance = 25; this.flashT = 0.25;
    const d = this.camera.position.distanceTo(p); this.shake = Math.max(this.shake, Math.max(0, 0.08 - d / 300));
  }
  onVote(d) { this.activeVote=d; this.hud.center(`VOTE: ${d.kind}`, `${d.yes}/${d.total} YES · 70% needed`, '', 2500); }
  onProfile(d) { this.rankProfile=d||this.rankProfile; this.updateRankHud(); }
  updateRankHud() { const p=this.rankProfile || this.you; if(!p) return; const x=Number(p.xp??this.you?.xp??0), name=p.rank??this.you?.rank??'Recruit', tag=p.rankTag??this.you?.rankTag??'R1'; const el=$('rankhud'); if(el){el.hidden=false; $('rank-tag').textContent=tag; $('rank-name').textContent=name; $('rank-xp').textContent=x+' XP';} }
  onYou(d) {
    const now = performance.now(); const prev = this.you;
    if (prev && !this.roundAmmoReset && now - this.lastLocalShot < 300) { for (const k of [1, 2]) if (d.w[k] && prev.w[k] && d.w[k].k === prev.w[k].k) d.w[k].mag = Math.min(d.w[k].mag, prev.w[k].mag); }
    if (prev && now - this.pendingSwitch < 350) d.a = prev.a;
    if (this.roundAmmoReset) this.roundAmmoReset = false;
    this.you = d; this.team = d.tm;
    this.hud.lastNades = d.g || {};
    if (!d.al && this.alive) this.die(null);
    if (d.act?.type !== 'plant' && this.s.crouch && !this.keys.KeyC && !this.keys.ControlLeft && !this.touchCrouch) this.s.crouch = false;
    if (d.rl > 0 && !this.reloadUntil) this.reloadUntil = now + d.rl;
    if (!d.rl && this.reloadUntil && now > this.reloadUntil - 50) this.reloadUntil = 0;
    this.hud.setVitals(d); this.rankProfile=d; this.updateRankHud();
    if (this.buyOpen) this.renderBuy();
  }
  onSpawn(d) {
    Object.assign(this.s, { x: d.x, y: d.y, z: d.z, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false });
    this.yaw = d.yaw; this.pitch = 0; this.cid = d.cid; this.alive = true; this.scope = 0; this.punchP = this.punchY = 0; this.reloadUntil = 0; this.shotsFired = 0;
    this.specId = null; this.deathAt = 0; this.drawEnd = performance.now() + 300; $('death').hidden = true; $('spec').hidden = true; this.deathCamPos = null;
  }
  onCorrect(d) { this.s.x = d.x; this.s.y = d.y; this.s.z = d.z; this.s.vx = this.s.vz = this.s.vy = 0; this.cid = d.cid; }
  onRound(d) {
    const prevPhase = this.phase; this.phase = d.phase; this.phaseEnd = d.phaseEnd; this.round = d.round; this.score = d.score; this.liveStart = d.liveStart || this.liveStart;
    if (d.msg) {
      const cls = d.winner || (d.planted ? 'red' : ''); this.hud.center(d.msg, d.sub || '', cls, d.winner ? 4500 : 3000);
      if (d.winner) { radio(d.winner === 'T' ? 'Terrorists win' : 'Counter-Terrorists win', this.settings.radio); this.sound.sting(d.winner === this.team); }
      else if (d.planted) radio('The bomb has been planted', this.settings.radio);
    }
    if (d.phase === 'freeze' && prevPhase !== 'freeze') { this.roundAmmoReset = true; this.reloadUntil = 0; this.shotsFired = 0; this.trigger = false; this.altTrigger = false; this.c4Held = false; this.s.crouch = false; this.clearDecals(); for (const r of this.remotes.values()) r.buf.length = 0; if (!d.msg) this.hud.center(`ROUND ${d.round}`, 'Buy time', '', 1800); }
    if (d.phase === 'live' && prevPhase === 'freeze') { radio(this.team === 'CT' ? 'Go go go' : "Let's move", this.settings.radio); }
    if (this.sbOpen) this.hud.scoreboard(true, this.roster, this.meId, this.score, this.room);
  }
  onBomb(b) {
    const prev = this.bomb; this.bomb = b || { state: 'none' };
    if (!this.bombMesh) { this.bombMesh = makeGun('c4'); this.bombMesh.scale.setScalar(1.7); this.scene.add(this.bombMesh); const led = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texGlow, color: '#ff2a2a', blending: THREE.AdditiveBlending, depthWrite: false })); led.scale.setScalar(0.22); led.position.copy(this.bombMesh.userData.led || new THREE.Vector3(0.05, 0.08, -0.15)); this.bombMesh.add(led); this.bombLed = led; }
    const show = b.state === 'planted' || b.state === 'dropped';
    this.bombMesh.visible = show; this.bombLed.visible = b.state === 'planted';
    if (show) { this.bombMesh.position.set(b.x, b.y + 0.06, b.z); this.bombMesh.rotation.set(0, 0.6, 0); }
    if (b.state === 'planted' && prev.state !== 'planted') { this.lastBeep = 0; this.sound.planted(new THREE.Vector3(b.x, b.y + 0.2, b.z)); }
    if (b.state === 'exploded' && prev.state !== 'exploded') this.explosionFx(prev.x ?? b.x, prev.y ?? b.y, prev.z ?? b.z);
    if (b.state === 'defused' && prev.state !== 'defused') { radio('Bomb has been defused', this.settings.radio); this.sound.defused(new THREE.Vector3(b.x, b.y + 0.2, b.z)); }
  }
  onDrops(list) {
    const ids = new Set(list.map((d) => d.id));
    for (const [id, m] of this.dropMeshes) if (!ids.has(id)) { this.scene.remove(m); this.dropMeshes.delete(id); }
    for (const d of list) {
      if (this.dropMeshes.has(d.id)) continue; const g = makeGun(d.k); g.scale.setScalar(1.15);
      g.rotation.set(0, (d.id * 2.4) % 6.28, Math.PI / 2); g.position.set(d.x, d.y + 0.07, d.z); g.userData.drop = d; this.scene.add(g); this.dropMeshes.set(d.id, g);
    }
  }
  onFx(f) {
    const pos = new THREE.Vector3(f.o[0], f.o[1], f.o[2]); const r = this.remotes.get(f.id); if (r) r.lastShot = performance.now();
    this.sound.shot(f.w, pos);
    if (f.w === 'knife') return;
    if (r && r.rig.gun) { const mz = r.rig.gun.localToWorld(r.rig.gun.userData.muzzle.clone()); this.flashAt(mz, true); this.tracer(mz, new THREE.Vector3(...f.e)); }
    else this.tracer(pos, new THREE.Vector3(...f.e));
    if (f.h === 2 && f.n) this.impact(new THREE.Vector3(...f.e), new THREE.Vector3(...f.n), false);
    else if (f.h === 1) this.blood(new THREE.Vector3(...f.e));
  }
  onHit(h) { this.hud.hitmarker(h.hs); this.sound.hit(h.hs); }
  onHurt(h) {
    const ang = Math.atan2(-(h.x - this.s.x), -(h.z - this.s.z)); const rel = angDiff(this.yaw, ang);
    this.hud.hurt(-rel, h.dmg); this.sound.hurt(); this.punchP += Math.min(0.06, h.dmg / 900); this.s.vx *= 0.5; this.s.vz *= 0.5;
  }
  onKill(e) {
    this.hud.kill(e, this.meId);
    if (e.v === this.meId) this.die(e);
    if (e.k === this.meId && e.v !== this.meId) this.sound.money();
    if (this.specId === e.v) this.specSwitchAt = performance.now() + 1800;
  }
  onAct(a) {
    const r = this.remotes.get(a.id); const pos = r ? r.rig.root.position.clone() : new THREE.Vector3(this.s.x, this.s.y, this.s.z);
    if (a.type === 'plant') this.sound.keypad(pos, a.id);
    else if (a.type === 'cancel') this.sound.cancelKeypad(a.id);
    else if (a.type === 'defuse') this.sound.defuse(pos, a.id);
    else if (a.type === 'reload' && r) this.sound.reload(null, 2.4, pos);
    else if (a.type === 'throw' && r) this.sound.nadeThrow(pos);
  }
  resetFrameClock() {
    // A settings/render change must not consume a stale frame delta.
    this._settingsFrameReset = true;
  }
  setMenuPaused(v) {
    this.menuPaused = !!v;
    this.keys = {}; this.mouseL = false; this.mouseR = false; this.touchFire = false; this.touchFireAlt = false; this.touchJump = false; this.touchCrouch = false;
    if (this.menuPaused) { this.closeMenus(); document.exitPointerLock?.(); }
    $('pause').hidden = !this.menuPaused;
  }
  toggleMenuPause() { if (!this.inRoom) return; this.setMenuPaused(!this.menuPaused); }
  // ---------------- team / room ----------------
  updateTeamCounts() {
    if (!this.room) return; const caps = this.room.teamCaps || { T: this.room.perTeam || 5, CT: this.room.perTeam || 5 };
    for (const t of ['T', 'CT']) {
      const list = this.roster.filter((p) => p.team === t), h = list.filter((p) => !p.bot).length, b = list.length - h;
      const el = $('ts-' + t); if (el) el.textContent = `${h} player${h === 1 ? '' : 's'}${b ? ` + ${b} bot${b === 1 ? '' : 's'}` : ''} · max ${caps[t]}`;
      const card = document.querySelector(`.team-card.${t.toLowerCase()}`); if (card) card.classList.toggle('full', h >= caps[t] && this.team !== t);
    }
  }
  openTeamSelect() { this.closeMenus(); document.exitPointerLock?.(); $('teamsel').hidden = false; $('ts-err').hidden = true; this.updateTeamCounts(); }
  chooseTeam(team) {
    this.sound.init(); this.sound.ui();
    this.net.emit('team', { team }, (r) => {
      if (!r || !r.ok) { $('ts-err').hidden = false; $('ts-err').textContent = r && r.error === 'TEAM_FULL' ? 'این تیم پر است. تیم دیگر را انتخاب کن.' : 'انتخاب تیم انجام نشد.'; return; }
      $('teamsel').hidden = true; this.team = r.team; this.lock();
      if (r.team === 'SPEC') { this.alive = false; this.specMode = 'tp'; }
    });
  }
  leave() {
    if (this.net) this.net.emit('leave', null, () => {});
    this.cleanup(); this.onLeave && this.onLeave();
  }
  cleanup() {
    clearInterval(this.pingTimer); this.pingTimer = null;
    this._modal = false; document.body.classList.remove('ui-modal');
    this.inRoom = false; this.alive = false; this.you = null; this.room = null; this.closeMenus(); document.exitPointerLock?.();
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    for (const m of this.dropMeshes.values()) this.scene.remove(m); this.dropMeshes.clear(); for (const g of this.nadeMeshes.values()) this.scene.remove(g); this.nadeMeshes.clear(); this.onSmokes([]); for (const fx of this.smokeFx.values()) this.scene.remove(fx.g); this.smokeFx.clear(); this.blind = 0; if (this.bombMesh) this.bombMesh.visible = false;
    this.clearDecals(); this.hud.show(false); $('teamsel').hidden = true; $('pause').hidden = true; if (this.vm) this.vm.group.visible = false;
  }
  closeMenus() { this.buyOpen = false; this.hud.buyMenu(false); this.sbOpen = false; this.hud.scoreboard(false); this.closeChat(); $('pause').hidden = true; }
  lock() { if (this.touch) return; const c = this.renderer.domElement; try { const p = c.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => c.requestPointerLock()); } catch (e) { c.requestPointerLock(); } }
  // ---------------- remotes ----------------
  ensureRemote(id) {
    const info = this.rosterMap.get(id); if (!info || info.team === 'SPEC') return null; let r = this.remotes.get(id);
    if (r && r.team !== info.team) { this.removeRemote(id); r = null; }
    if (!r) {
      const rig = makeSoldier(info.team); this.scene.add(rig.root);
      const tag = this.makeTag(info.name, info.team); tag.position.y = 2.25; rig.root.add(tag);
      r = { id, rig, team: info.team, name: info.name, buf: [], tag, alive: true, stepAcc: 0, speed: 0, lx: 0, lz: 0, lastShot: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fl: 0, hp: 100 };
      this.remotes.set(id, r);
    }
    return r;
  }
  removeRemote(id) { const r = this.remotes.get(id); if (!r) return; this.scene.remove(r.rig.root); this.remotes.delete(id); if (this.specId === id) this.specId = null; }
  makeTag(name, team) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 48; const x = c.getContext('2d'); x.font = '700 28px "Libre Franklin",Arial'; x.textAlign = 'center';
    x.fillStyle = 'rgba(0,0,0,.55)'; const w = Math.min(250, x.measureText(name).width + 24); x.fillRect(128 - w / 2, 4, w, 40); x.fillStyle = team === 'T' ? '#eab14d' : '#73a7e6'; x.fillText(name, 128, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true })); s.scale.set(1.5, 0.28, 1); return s;
  }
  updateRemotes(dt, snow) {
    const rt = snow - INTERP; const myTeam = this.team;
    for (const r of this.remotes.values()) {
      const b = r.buf; if (!b.length) { r.rig.root.visible = false; continue; }
      let a = b[0], c = b[b.length - 1], f = 0;
      if (rt <= b[0].t) { a = c = b[0]; } else if (rt >= c.t) { a = c; } else { for (let i = b.length - 1; i > 0; i--) if (b[i - 1].t <= rt) { a = b[i - 1]; c = b[i]; f = (rt - a.t) / Math.max(1, c.t - a.t); break; } }
      const x = a.x + (c.x - a.x) * f, y = a.y + (c.y - a.y) * f, z = a.z + (c.z - a.z) * f; const yaw = a.yaw + angDiff(a.yaw, c.yaw) * f, pitch = a.pitch + (c.pitch - a.pitch) * f; const s = f < 0.5 ? a : c;
      const sp = Math.hypot(x - r.x, z - r.z) / Math.max(dt, 1e-3); r.speed = r.speed * 0.8 + Math.min(12, sp) * 0.2;
      r.x = x; r.y = y; r.z = z; r.yaw = yaw; r.pitch = pitch; r.fl = s.fl; r.hp = s.hp; const alive = !!(s.fl & 1);
      if (r.alive && !alive) { r.rig.deadDir = Math.random() < 0.5 ? 1 : -1; } r.alive = alive;
      const root = r.rig.root; root.visible = !(this.specId === r.id && this.specMode === 'fp' && !this.alive);
      root.position.set(x, y, z); root.rotation.y = yaw;
      const wk = WEAPON_KEYS[s.wi] || 'knife'; setRigWeapon(r.rig, wk); r.rig.bombPack.visible = !!(s.fl & 8) && wk !== 'c4';
      animateRig(r.rig, { speed: r.speed, crouch: !!(s.fl & 2), pitch, air: !(s.fl & 4), dt, alive });
      r.tag.visible = alive && (myTeam === r.team || myTeam === 'SPEC') && Math.hypot(x - this.camera.position.x, z - this.camera.position.z) < 45;
      if (alive && (s.fl & 4) && r.speed > 3.6) { r.stepAcc += r.speed * dt; if (r.stepAcc > 2.3) { r.stepAcc = 0; this.sound.step(new THREE.Vector3(x, y, z), 0.55); } }
    }
  }
  // ---------------- local player ----------------
  activeItem() { if (!this.you) return null; if (this.you.a === 4) return this.you.gk && this.you.g ? { k: this.you.gk, mag: this.you.g[this.you.gk] || 0, res: 0, nade: true } : null; return this.you.a === 5 ? { k: 'c4' } : this.you.w[this.you.a]; }
  activeW() { const it = this.activeItem(); return it ? WEAPONS[it.k] : null; }
  canMove() { return this.alive && this.phase !== 'freeze' && !(this.you && this.you.act) && !this.chatOpen; }
  canBuy() {
    if (!this.you || !this.alive || !this.room) return false; const snow = this.serverNow();
    const t = this.phase === 'warmup' || this.phase === 'freeze' || (this.phase === 'live' && snow - this.liveStart < ROUND.buy * 1000);
    return t && (this.phase === 'warmup' || inRect(this.map.def.buy[this.team] || [0, 0, 0, 0], this.s.x, this.s.z));
  }
  updateLocal(dt, now) {
    const s = this.s, w = this.activeW(), k = this.keys;
    const planting = this.you?.act?.type === 'plant';
    if (planting) s.crouch = true;
    let f = 0, r = 0;
    if (this.canMove()) { f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0); r = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0); if (this.touchMove) { f += this.touchMove.f; r += this.touchMove.r; } }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = -sy * f + cy * r, wz = -cy * f - sy * r;
    let speed = (w && w.speed) || 6.35; if (this.scope && w && w.scopedSpeed) speed = w.scopedSpeed;
    if (this.you?.nc) {
      const v = (k.ShiftLeft || k.ShiftRight) ? speed * 1.8 : speed * 1.35;
      s.x += wx * v * dt; s.z += wz * v * dt;
      if (k.Space || this.touchJump) s.y += v * dt;
      if (k.ControlLeft || k.KeyC || this.touchCrouch) s.y -= v * dt;
      s.vx = wx * v; s.vz = wz * v; s.vy = ((k.Space || this.touchJump) ? v : 0) - ((k.ControlLeft || k.KeyC || this.touchCrouch) ? v : 0);
      s.onGround = false; s.crouch = false;
    } else {
      const steps = Math.ceil(dt / 0.017), h = dt / steps;
      for (let i = 0; i < steps; i++) stepMove(this.map, s, { wx, wz, jump: (k.Space || this.touchJump) && this.canMove(), crouch: (k.KeyC || k.ControlLeft || this.touchCrouch) && this.alive, walk: k.ShiftLeft || k.ShiftRight, speed }, h);
    }
    if (s.landed) { s.landed = false; this.sound.step(null, 0.5); }
    const hs = Math.hypot(s.vx, s.vz);
    if (s.onGround && hs > 3.6) { this.stepAcc += hs * dt; if (this.stepAcc > 2.4) { this.stepAcc = 0; this.sound.step(null, 0.32); } }
    this.eyeH += ((s.crouch ? PHYS.crouchEye : PHYS.eye) - this.eyeH) * Math.min(1, dt * 14);
    if (now - this.lastSend > 33) { this.lastSend = now; this.net.emit('st', { x: +s.x.toFixed(3), y: +s.y.toFixed(3), z: +s.z.toFixed(3), yaw: +this.yaw.toFixed(4), pitch: +this.pitch.toFixed(4), c: (s.crouch || planting) ? 1 : 0, g: s.onGround ? 1 : 0, sc: this.scope, cid: this.cid }); }
    // firing
    const fireHeld = (this.mouseL && this.locked && !this.buyOpen && !this.chatOpen) || this.touchFire;
    const altHeld = (this.mouseR && this.locked && !this.buyOpen && !this.chatOpen) || this.touchFireAlt;
    if (fireHeld) this.tryFire(now, false); else if (altHeld && this.activeW()?.melee) this.tryFire(now, true); else { this.trigger = false; this.altTrigger = false; this.dry = false; if (this.c4Held) { this.c4Held = false; this.net.emit('unuse'); } }
    if (this.reloadUntil && now >= this.reloadUntil) { this.reloadUntil = 0; const it = this.activeItem(); if (it && w && w.mag) { const take = Math.min(w.mag - it.mag, it.res); it.mag += take; it.res -= take; } }
    const recover = now - this.lastShotT > 120 ? 9 : 1.5; this.punchP *= Math.exp(-dt * recover); this.punchY *= Math.exp(-dt * recover);
    if (this.scope && this.awpRescope && now >= this.awpRescope) { this.awpRescope = 0; }
  }
  tryFire(now, alt = false) {
    const it = this.activeItem(), w = this.activeW(); if (!it || !w || !this.alive) return;
    if (this.you.a === 5) { if (!this.c4Held) { this.c4Held = true; this.net.emit('use'); } return; }
    if (this.you.a === 4) { if (!this.trigger) this.throwNade(now, false); this.trigger = true; return; }
    if (this.phase === 'freeze' || now < this.nextFire || now < this.drawEnd || this.reloadUntil) return;
    if (!w.auto && this.trigger && !w.melee) return;
    if (w.melee && alt && this.altTrigger) return;
    if (!w.melee && it.mag <= 0) { if (!this.dry) { this.dry = true; this.sound.dry(); if (it.res > 0) this.reload(); } return; }
    if (w.melee) this.trigger = !alt;
    if (w.melee) this.altTrigger = alt;
    const rpm = (w.melee && alt && w.altRpm) ? w.altRpm : w.rpm;
    const interval = 60000 / rpm; this.nextFire = now + interval;
    if (now - this.lastShotT > interval * 1.6 + 150) this.shotsFired = 0; this.shotsFired++; this.lastShotT = now; this.lastLocalShot = now;
    if (!w.melee) it.mag--;
    const s = this.s, eye = [s.x, s.y + this.eyeH, s.z];
    const inac = inaccuracy(w, { speed: Math.hypot(s.vx, s.vz), grounded: s.onGround, crouch: s.crouch, shots: this.shotsFired, scoped: this.scope > 0 });
    const dir = w.melee ? forward(this.yaw, this.pitch) : spreadDir(forward(this.yaw + this.punchY, this.pitch + this.punchP), inac);
    this.net.emit('shot', { o: eye.map((v) => +v.toFixed(3)), d: dir.map((v) => +v.toFixed(5)), t: Math.round(this.serverNow() - INTERP), w: it.k, alt: !!alt });
    this.sound.shot(it.k, null);
    // local effects (prediction only, damage is server-side)
    const range = w.melee ? ((alt && w.altRange) || w.range) : 220; const wall = rayWorld(this.map, eye, dir, range); let best = null;
    for (const r of this.remotes.values()) { if (!r.alive || r.team === this.team) continue; const h = rayPlayer(eye, dir, { x: r.x, y: r.y, z: r.z, crouch: !!(r.fl & 2) }, best ? best.t : wall.t); if (h) best = h; }
    const T = best ? best.t : wall.t, end = new THREE.Vector3(eye[0] + dir[0] * T, eye[1] + dir[1] * T, eye[2] + dir[2] * T);
    if (w.melee) { this.vmKick = alt ? 1.35 : 1; this.vmKnifeAlt = !!alt; if (!best && wall.t < range && wall.n) this.impact(end, new THREE.Vector3(...wall.n), true); if (best) this.blood(end); return; }
    const mz = this.camera.localToWorld(new THREE.Vector3(0.22, -0.18, -0.9));
    if (this.shotsFired % 2 === 1 || !w.auto) this.tracer(mz, end);
    this.flashAt(this.camera.position, false); this.vmFlash = now + 45; this.vmKick = 1;
    if (best) this.blood(end); else if (wall.n) this.impact(end, new THREE.Vector3(...wall.n), true);
    const n = Math.min(this.shotsFired, 12);
    this.punchP += w.kick * (1 + n * 0.05); this.punchY += (Math.random() - 0.5) * w.side * 2 + (n > 4 ? Math.sin(n * 0.8) * w.side * 1.6 : 0);
    if (it.k === 'awp' && this.scope) { this.scope = 0; this.awpRescope = now + interval; }
  }
  throwNade(now, soft) {
    const it = this.activeItem(); if (!it || !it.nade || !this.alive || this.phase === 'freeze' || now < this.drawEnd || now < this.nextFire || it.mag <= 0) return;
    this.nextFire = now + 800; this.vmKick = 1; this.net.emit('throw', { d: forward(this.yaw, this.pitch).map((v) => +v.toFixed(4)), soft: !!soft }); this.sound.nadeThrow();
    this.drawEnd = now + 650;
  }
  reload() {
    const it = this.activeItem(), w = this.activeW(); if (!it || !w || w.melee || !w.mag || it.mag >= w.mag || it.res <= 0 || this.reloadUntil || this.you.a === 5) return;
    this.net.emit('reload'); this.reloadUntil = performance.now() + w.reload * 1000; this.scope = 0; this.sound.reload(it.k, w.reload);
  }
  switchSlot(slot) {
    if (!this.you || !this.alive) return;
    if (slot === 4) {
      const g = this.you.g || {}, have = NADES.filter((n) => g[n] > 0); if (!have.length) return;
      let k = this.you.gk && g[this.you.gk] > 0 ? this.you.gk : have[0];
      if (this.you.a === 4) { if (have.length < 2) return; k = have[(have.indexOf(k) + 1) % have.length]; } else this.lastSlot = this.you.a;
      this.you.a = 4; this.you.gk = k; this.pendingSwitch = performance.now(); this.net.emit('sw', { slot: 4, k });
      this.drawEnd = performance.now() + 500; this.scope = 0; this.reloadUntil = 0; this.shotsFired = 0; this.sound.click(0.2, 1200); return;
    }
    if (slot === 5 ? !this.you.b : !this.you.w[slot]) return; if (this.you.a === slot) return;
    this.lastSlot = this.you.a; this.you.a = slot; this.pendingSwitch = performance.now(); this.net.emit('sw', { slot });
    const w = WEAPONS[slot === 5 ? 'c4' : this.you.w[slot].k]; this.drawEnd = performance.now() + (w.draw || 0.4) * 1000; this.scope = 0; this.reloadUntil = 0; this.shotsFired = 0; this.sound.click(0.2, 1200);
  }
  cycleSlot(dir) { if (!this.you) return; const g = this.you.g || {}; const order = [1, 2, 3, 4, 5].filter((s) => (s === 5 ? this.you.b : s === 4 ? NADES.some((n) => g[n] > 0) : this.you.w[s])); const i = order.indexOf(this.you.a); this.switchSlot(order[(i + dir + order.length) % order.length]); }
  toggleScope() { const w = this.activeW(); if (!w || !w.scope || this.reloadUntil || !this.alive) { this.scope = 0; return; } this.scope = (this.scope + 1) % (w.scope.length + 1); this.sound.click(0.15, 3000); }
  die(e) {
    if (!this.alive && this.deathAt) return; this.alive = false; this.deathAt = performance.now(); this.scope = 0; this.closeMenus();
    this.killerId = e ? e.k : null; this.deathCamPos = this.camera.position.clone(); this.specId = null;
    if (e && e.kn) { $('death').hidden = false; $('death-k').textContent = e.kn; $('death-w').textContent = `${e.w === 'c4' ? 'C4' : (WEAPONS[e.w] || {}).name || e.w}${e.hs ? ' · HEADSHOT' : ''}`; }
  }
  specCandidates() {
    const list = [...this.remotes.values()].filter((r) => r.alive && r.buf.length && (r.x || r.z));
    const mine = list.filter((r) => r.team === this.team); return this.team === 'SPEC' ? list : mine.length ? mine : [];
  }
  specNext(dir = 1) { const c = this.specCandidates(); if (!c.length) { this.specId = null; return; } const i = c.findIndex((r) => r.id === this.specId); this.specId = c[(i + dir + c.length) % c.length].id; }
  // ---------------- camera ----------------
  updateCamera(dt, now) {
    const cam = this.camera; let fov = this.settings.fov;
    if (this.alive) {
      cam.position.set(this.s.x, this.s.y + this.eyeH, this.s.z);
      const sh = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0; this.shake = Math.max(0, this.shake - dt * 1.5);
      cam.rotation.set(this.pitch + this.punchP * 0.5 + sh, this.yaw + this.punchY * 0.5 + sh * 0.5, 0, 'YXZ');
      if (this.scope) { const sw = this.activeW(); if (sw && sw.scope && sw.scope[this.scope - 1]) fov = sw.scope[this.scope - 1]; else this.scope = 0; }
    } else if (this.deathAt && now - this.deathAt < 2600 && this.deathCamPos) {
      cam.position.lerp(this.deathCamPos.clone().add(new THREE.Vector3(0, -0.9, 0)), Math.min(1, dt * 3));
      const k = this.remotes.get(this.killerId); if (k) { const tgt = new THREE.Vector3(k.x, k.y + 1.4, k.z); const m = new THREE.Matrix4().lookAt(cam.position, tgt, new THREE.Vector3(0, 1, 0)); const q = new THREE.Quaternion().setFromRotationMatrix(m); cam.quaternion.slerp(q, Math.min(1, dt * 4)); }
    } else {
      if (!this.specId || !this.remotes.get(this.specId)?.alive) { if (!this.specSwitchAt || now > this.specSwitchAt) { this.specNext(1); this.specSwitchAt = 0; } }
      const r = this.remotes.get(this.specId);
      if (r) {
        if (this.specMode === 'fp') { cam.position.set(r.x, r.y + (r.fl & 2 ? PHYS.crouchEye : PHYS.eye), r.z); cam.rotation.set(r.pitch, r.yaw, 0, 'YXZ'); }
        else {
          const back = forward(r.yaw, -0.25), eye = [r.x, r.y + 1.7, r.z], d = [-back[0], -back[1] + 0.25, -back[2]]; const L = Math.hypot(...d); const dn = d.map((v) => v / L);
          const hit = rayWorld(this.map, eye, dn, 3.6); const t = Math.max(0.4, hit.t - 0.25);
          cam.position.set(eye[0] + dn[0] * t, eye[1] + dn[1] * t, eye[2] + dn[2] * t); cam.lookAt(r.x, r.y + 1.45, r.z);
        }
      } else { const t = now / 1000 * 0.05; cam.position.set(64 + Math.cos(t) * 52, 42, 64 + Math.sin(t) * 52); cam.lookAt(64, 0, 64); }
    }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const fw = new THREE.Vector3(); cam.getWorldDirection(fw); this.sound.setListener(cam.position, [fw.x, fw.y, fw.z]);
  }
  // ---------------- view model ----------------
  updateViewModel(dt, now) {
    if (!this.vm) { this.vm = { group: new THREE.Group() }; this.vmScene.add(this.vm.group); }
    const it = this.activeItem(); const g = this.vm.group;
    g.visible = this.alive && !this.scope && !!it && (this.team === 'T' || this.team === 'CT');
    if (!g.visible) return;
    if (this.vmKey !== it.k || this.vmTeam !== this.team) {
      if (this.vmGun) g.remove(this.vmGun); if (this.vmArms) g.remove(this.vmArms);
      this.vmGun = makeGun(it.k); if (['he', 'flash', 'smoke'].includes(it.k)) this.vmGun.scale.setScalar(1.35); this.vmGun.traverse((o) => { if (o.isMesh) o.castShadow = false; }); g.add(this.vmGun);
      this.vmArms = makeViewArms(this.team, it.k); g.add(this.vmArms); this.vmKey = it.k; this.vmTeam = this.team;
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texStar, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); flash.scale.setScalar(0.32); flash.position.copy(this.vmGun.userData.muzzle); flash.visible = false; this.vmGun.add(flash); this.vmFlashSprite = flash;
    }
    const w = WEAPONS[it.k], s = this.s, sp = Math.hypot(s.vx, s.vz);
    this.vmBob += dt * (s.onGround ? sp * 1.6 : 0); const bobA = Math.min(1, sp / 6) * (s.onGround ? 1 : 0.2);
    this.vmKick = Math.max(0, this.vmKick - dt * (w.melee ? 3.5 : 9));
    this.swayX *= Math.exp(-dt * 8); this.swayY *= Math.exp(-dt * 8);
    const big = w.slot === 1; let x = (big ? 0.17 : 0.15) + Math.cos(this.vmBob) * 0.012 * bobA + this.swayX, y = (big ? -0.2 : -0.17) - Math.abs(Math.sin(this.vmBob)) * 0.012 * bobA + this.swayY, z = (big ? -0.36 : -0.42) + this.vmKick * (w.melee ? -0.12 : 0.05);
    let rx = this.vmKick * (w.melee ? -0.9 : 0.12), ry = w.melee ? this.vmKick * 0.7 : 0, rz = 0;
    if (w.melee && this.vmKnifeAlt) { rx += this.vmKick * 0.55; ry -= this.vmKick * 0.9; rz += this.vmKick * 0.35; }
    if (now < this.drawEnd) { const t = (this.drawEnd - now) / ((w.draw || 0.4) * 1000); y -= t * 0.25; rx -= t * 0.6; }
    if (this.reloadUntil) { const t = 1 - (this.reloadUntil - now) / (w.reload * 1000); const k = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI); y -= k * 0.12; rx -= k * 0.5; rz += k * 0.4; }
    if (this.s.crouch) y += 0.01;
    g.position.set(x, y, z); g.rotation.set(rx + 0.06, ry + (w.melee ? 0.35 : 0.16), rz - 0.04);
    if (this.vmFlashSprite) { this.vmFlashSprite.visible = now < this.vmFlash; this.vmFlashSprite.material.rotation = Math.random() * 6; }
    this.vmCamera.fov = 62; this.vmCamera.aspect = this.camera.aspect; this.vmCamera.updateProjectionMatrix();
  }
  // ---------------- effects ----------------
  initFx() {
    this.texGlow = TX.radial(); this.texStar = TX.muzzleStar(); this.texHole = TX.bulletHole(); this.texDust = TX.radial('rgba(225,200,160,0.9)', 'rgba(200,170,120,0)'); this.texBlood = TX.radial('rgba(150,10,10,1)', 'rgba(90,0,0,0)'); this.texSmoke = TX.radial('rgba(235,235,232,1)', 'rgba(220,220,215,0)');
    this.flashLight = new THREE.PointLight('#ffb35c', 0, 9, 2); this.scene.add(this.flashLight);
    this.holeMat = new THREE.MeshBasicMaterial({ map: this.texHole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }); this.holeGeo = new THREE.PlaneGeometry(0.13, 0.13);
    this.tracerMat = new THREE.LineBasicMaterial({ color: '#ffe2a0', transparent: true, opacity: 0.55 });
  }
  addFx(obj, life, update) { this.scene.add(obj); this.effects.push({ obj, life, max: life, update }); }
  flashAt(pos, remote) { this.flashLight.position.copy(pos); this.flashLight.intensity = remote ? 18 : 10; this.flashT = 0.05; if (remote) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texStar, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.position.copy(pos); s.scale.setScalar(0.5); s.material.rotation = Math.random() * 6; this.addFx(s, 0.05); } }
  tracer(a, b) { const g = new THREE.BufferGeometry().setFromPoints([a, b]); const l = new THREE.Line(g, this.tracerMat.clone()); this.addFx(l, 0.07, (fx, k) => { l.material.opacity = 0.55 * k; }); }
  puff(pos, tex, size, life, rise = 0.4) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true })); s.position.copy(pos); s.scale.setScalar(size * 0.4); this.addFx(s, life, (fx, k) => { s.material.opacity = k; s.scale.setScalar(size * (1.4 - k)); s.position.y += rise * 0.016; }); }
  impact(p, n, local) {
    let d = this.decals[this.decalIdx]; if (!d) { d = new THREE.Mesh(this.holeGeo, this.holeMat); this.scene.add(d); this.decals[this.decalIdx] = d; }
    this.decalIdx = (this.decalIdx + 1) % 160; d.visible = true; d.position.copy(p).addScaledVector(n, 0.012); d.lookAt(p.clone().add(n)); d.rotateZ(Math.random() * 6);
    this.puff(p.clone().addScaledVector(n, 0.08), this.texDust, 0.55, 0.5);
  }
  clearDecals() { for (const d of this.decals) if (d) d.visible = false; }
  blood(p) { for (let i = 0; i < 2; i++) this.puff(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2)), this.texBlood, 0.5, 0.35, -0.2); }
  explosionFx(x, y, z) {
    const p = new THREE.Vector3(x, (y || 0) + 1, z); this.sound.explosion(p);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    ball.position.copy(p); this.addFx(ball, 1.1, (fx, k) => { ball.scale.setScalar(2 + (1 - k) * 14); ball.material.opacity = k * k; });
    for (let i = 0; i < 18; i++) { const q = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8)); this.puff(q, this.texDust, 6 + Math.random() * 6, 2.5 + Math.random() * 1.5, 1.2); }
    this.flashLight.position.copy(p); this.flashLight.intensity = 400; this.flashLight.distance = 60; this.flashT = 0.5;
    const d = this.camera.position.distanceTo(p); this.shake = Math.max(this.shake, Math.max(0, 0.12 - d / 400));
  }
  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) { const e = this.effects[i]; e.life -= dt; if (e.life <= 0) { this.scene.remove(e.obj); e.obj.geometry?.dispose?.(); e.obj.material?.dispose?.(); this.effects.splice(i, 1); continue; } if (e.update) e.update(e, e.life / e.max); }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flashLight.intensity = 0; this.flashLight.distance = 9; } }
    // C4 beeps
    const b = this.bomb;
    if (b.state === 'planted' && b.explodeAt) {
      const left = (b.explodeAt - this.serverNow()) / 1000, interval = left < 2 ? 0.1 : Math.max(0.15, Math.min(1, left / 40));
      const now = performance.now() / 1000; if (now - this.lastBeep > interval) { this.lastBeep = now; this.sound.beep(new THREE.Vector3(b.x, b.y + 0.2, b.z), left < 5); if (this.bombLed) this.bombLed.visible = true; }
      if (this.bombLed && now - this.lastBeep > 0.08) this.bombLed.visible = false;
    }
  }
  // ---------------- HUD ----------------
  updateHUD(now) {
    if (now - this.hudTick < 60) return; this.hudTick = now; const snow = this.serverNow(), hud = this.hud;
    let timer = '', low = false; const left = (this.phaseEnd - snow) / 1000;
    if (this.phase === 'warmup') timer = 'WARMUP'; else if (this.phase === 'planted') timer = ''; else { timer = fmt(left); low = this.phase === 'live' && left < 10; }
    const alive = { T: [], CT: [] }; for (const p of this.roster) if (p.team === 'T' || p.team === 'CT') alive[p.team].push(p.alive);
    hud.setTop(this.score, this.round, timer, low, this.phase === 'planted', alive);
    const me = this.you;
    if (me) { const it = this.activeItem(); hud.lastNades = me.g || {}; hud.setAmmo(it, it ? WEAPONS[it.k] : null, me.w, me.a, me.b); }
    $('buyzone').hidden = !this.canBuy();
    $('loc').textContent = calloutAt(this.map, this.alive ? this.s.x : this.camera.position.x, this.alive ? this.s.z : this.camera.position.z);
    // crosshair
    const w = this.activeW(); let gap = 4;
    if (w && !w.melee && this.alive) { const inac = inaccuracy(w, { speed: Math.hypot(this.s.vx, this.s.vz), grounded: this.s.onGround, crouch: this.s.crouch, shots: this.shotsFired + (now - this.lastShotT < 300 ? 1 : 0), scoped: this.scope > 0 }); gap = 3 + inac * (innerHeight / 2) / Math.tan(this.camera.fov * Math.PI / 360) * 0.9; }
    hud.crosshair(Math.min(80, gap), !this.alive || this.scope > 0 || this.buyOpen);
    $('scope').hidden = !(this.alive && this.scope > 0);
    // progress
    const act = me && me.act;
    if (act && this.alive) { const total = act.type === 'plant' ? ROUND.plant : me.kit ? ROUND.defuseKit : ROUND.defuse; hud.progress(act.type === 'plant' ? 'PLANTING C4' : 'DEFUSING', 1 - (act.end - snow) / 1000 / total); }
    else hud.progress('', null);
    // spectate bar
    const spec = !this.alive && this.inRoom && !(this.deathAt && now - this.deathAt < 2600);
    $('spec').hidden = !spec; if (spec) { const r = this.remotes.get(this.specId), info = r && this.rosterMap.get(r.id); $('spec-n').textContent = info ? info.name : 'Free camera'; $('spec-n').style.color = r ? (r.team === 'T' ? 'var(--t)' : 'var(--ct)') : ''; $('spec-h').textContent = r ? `${r.hp} HP` : ''; }
    // Touch controls belong only to the live player. Hide the entire mobile layer
    // during death/spectator mode so it cannot sit over the player being watched.
    const touchLayer = $('touch');
    if (touchLayer && !document.body.classList.contains('ui-editing')) touchLayer.classList.toggle('touch-dead', !this.alive);
    if (this.alive) $('death').hidden = true;
    const modal = this.buyOpen || this.chatOpen || !$('pause').hidden || !$('teamsel').hidden || !$('settings').hidden;
    if (modal !== this._modal) { this._modal = modal; document.body.classList.toggle('ui-modal', modal); }
    $('clickplay').hidden = this.locked || this.touch || !$('teamsel').hidden || this.buyOpen || !$('pause').hidden || !this.inRoom;
    if (this.buyOpen && !this.canBuy()) this.toggleBuy(false);
    if (this.buyOpen) { const t = $('buymenu').querySelector('.bm-time'); if (t) t.textContent = this.buyTimeLeft(); }
  }
  updateRadar() {
    const blips = [], now = performance.now(), me = this.alive ? this.s : { x: this.camera.position.x, z: this.camera.position.z };
    const eye = [this.camera.position.x, this.camera.position.y, this.camera.position.z]; const doSpot = now - this.lastSpot > 120; if (doSpot) this.lastSpot = now;
    for (const r of this.remotes.values()) {
      const mate = r.team === this.team || this.team === 'SPEC';
      if (mate) { blips.push({ x: r.x, z: r.z, yaw: r.alive ? r.yaw : undefined, dead: !r.alive, color: r.team === 'T' ? '#eab14d' : '#73a7e6' }); continue; }
      if (!r.alive) continue;
      if (doSpot) { const vis = Math.hypot(r.x - eye[0], r.z - eye[2]) < 90 && hasLOS(this.map, eye, [r.x, r.y + 1.3, r.z]); if (vis || now - r.lastShot < 1500) this.spotted.set(r.id, now); }
      if (now - (this.spotted.get(r.id) || 0) < 1500) blips.push({ x: r.x, z: r.z, color: '#ff4b4b' });
    }
    let bomb = null; const b = this.bomb;
    if (b.state === 'planted' || (b.state === 'dropped' && this.team !== 'CT')) bomb = { x: b.x, z: b.z, planted: b.state === 'planted' };
    else if (b.state === 'carried' && this.team === 'T') { const c = b.carrier === this.meId ? this.s : this.remotes.get(b.carrier); if (c) bomb = { x: c.x, z: c.z }; }
    this.hud.drawRadar(me, this.alive ? this.yaw : (this.remotes.get(this.specId)?.yaw ?? 0), blips, bomb);
  }
  buyTimeLeft() { if (this.phase === 'warmup') return 'WARMUP'; const end = this.phase === 'freeze' ? this.phaseEnd + ROUND.buy * 1000 : this.liveStart + ROUND.buy * 1000; return fmt((end - this.serverNow()) / 1000) + ' left'; }
  renderBuy() { if (!this.you) return; this.hud._rerenderBuy = () => this.renderBuy(); this.hud.buyMenu(true, this.you, this.team, this.buyTimeLeft(), (k) => this.buy(k), () => this.toggleBuy(false)); }
  buy(k) { this.sound.ui(1100); this.net.emit('buy', { item: k }, (r) => { if (!r || !r.ok) { this.hud.toast(r && r.error ? r.error : 'Cannot buy'); this.sound.ui(300); } else this.sound.money(); }); }
  toggleBuy(v = !this.buyOpen) {
    if (v && !this.canBuy()) { this.hud.toast(this.alive ? 'You are not in a buy zone / buy time is over' : 'You are dead'); return; }
    this.buyOpen = v; if (v) { document.exitPointerLock?.(); this.renderBuy(); } else { this.hud.buyMenu(false); this.lock(); }
  }
  openChat(team) { this.chatOpen = true; this.chatTeam = team; const i = $('chat-in'), send = $('chat-send'); i.hidden = false; if (send) send.hidden = false; i.placeholder = team ? 'Team: ' : 'All: '; $('chat').classList.add('open'); this.keys = {}; setTimeout(() => i.focus(), 0); }
  closeChat() { this.chatOpen = false; const i = $('chat-in'), send = $('chat-send'); i.hidden = true; if (send) send.hidden = true; i.value = ''; i.blur(); $('chat').classList.remove('open'); }
  sendChat() { const v = $('chat-in')?.value.trim(); if (v) this.net.emit('chat', { msg: v, team: this.chatTeam }); this.closeChat(); }
  // ---------------- input ----------------
  onKeyDown(e) {
    if (!this.inRoom) return;
    if (this.chatOpen) { if (e.code === 'Enter') { e.preventDefault(); this.sendChat(); } else if (e.code === 'Escape') this.closeChat(); return; }
    if (!$('teamsel').hidden || !$('settings').hidden) return;
    if (e.code === 'Tab') { e.preventDefault(); this.sbOpen = true; this.hud.scoreboard(true, this.roster, this.meId, this.score, this.room); return; }
    if (e.repeat) return;
    this.keys[e.code] = true;
    switch (e.code) {
      case 'KeyB': this.toggleBuy(); break;
      case 'Escape': if (this.buyOpen) this.toggleBuy(false); break;
      case 'KeyY': e.preventDefault(); this.openChat(false); break;
      case 'KeyU': e.preventDefault(); this.openChat(true); break;
      case 'Digit1': this.switchSlot(1); break; case 'Digit2': this.switchSlot(2); break; case 'Digit3': this.switchSlot(3); break; case 'Digit4': this.switchSlot(4); break; case 'Digit5': this.switchSlot(5); break;
      case 'KeyQ': if (this.lastSlot) this.switchSlot(this.lastSlot); break;
      case 'KeyR': this.reload(); break;
      case 'KeyG': if (this.alive) { this.net.emit('drop'); this.sound.click(0.2, 900); } break;
      case 'KeyE': if (this.alive) this.net.emit('use'); break;
      // C/Control are crouch keys and must not toggle spectator camera.
      // Spectator camera toggle uses V so C+W/Ctrl+W stays a movement chord.
      case 'KeyV': if (!this.alive) this.specMode = this.specMode === 'fp' ? 'tp' : 'fp'; break;
      case 'ControlLeft': case 'ControlRight': case 'KeyC': this.s.crouch = !!this.alive; break;
      case 'KeyM': this.openTeamSelect(); break;
      case 'F3': if(this.activeVote) this.net.emit('vote:cast',{yes:true}); break;
      case 'F4': if(this.activeVote) this.net.emit('vote:cast',{yes:false}); break;
      case 'Space': if (!this.alive) this.specNext(1); break;
    }
  }
  onKeyUp(e) {
    this.keys[e.code] = false;
    if ((e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC') && !this.keys.ControlLeft && !this.keys.ControlRight && !this.keys.KeyC) this.s.crouch = false;
    if (e.code === 'Tab') { this.sbOpen = false; this.hud.scoreboard(false); }
    if (e.code === 'KeyE' && this.inRoom) this.net.emit('unuse');
  }
  onMouseDown(e) {
    if (!this.inRoom) return;
    if (!this.locked) return;
    if (e.button === 0) { this.mouseL = true; if (!this.alive) this.specNext(1); }
    if (e.button === 2) { if (this.alive && this.you && this.you.a === 4) this.throwNade(performance.now(), true); else if (this.alive && this.activeW()?.melee) { this.mouseR = true; this.tryFire(performance.now(), true); } else if (this.alive) this.toggleScope(); else this.specNext(-1); }
  }
  onMouseUp(e) { if (e.button === 0) this.mouseL = false; if (e.button === 2) this.mouseR = false; }
  onMouseMove(e) {
    if (!this.locked || !this.alive) return; const k = 0.0022 * this.settings.sens * (this.scope ? this.camera.fov / this.settings.fov : 1);
    this.yaw -= e.movementX * k; this.pitch = clamp(this.pitch - e.movementY * k, -1.53, 1.53);
    this.swayX = clamp(this.swayX - e.movementX * 0.00006, -0.03, 0.03); this.swayY = clamp(this.swayY + e.movementY * 0.00006, -0.03, 0.03);
  }
  onWheel(e) { if (this.inRoom && this.locked && this.alive) this.cycleSlot(e.deltaY > 0 ? 1 : -1); }
  // ---------------- frame ----------------
  update(dt) {
    if (!this.inRoom) return;
    if (this.menuPaused) { this.updateCamera(0, performance.now()); this.updateHUD(performance.now()); return; } const now = performance.now(), snow = this.serverNow();
    if (this.alive) this.updateLocal(dt, now); else if (this.mouseL && this.touchFire) this.specNext(1);
    this.updateRemotes(dt, snow); this.updateNades(dt); this.updateCamera(dt, now); this.updateViewModel(dt, now); this.updateEffects(dt);
    const tw = this.activeW(), tf = $('t-fire'), tf2 = $('t-fire2');
    if (tf && tf2) { tf.textContent = tw?.melee ? 'LMB' : 'FIRE'; tf2.textContent = tw?.melee ? 'RMB' : 'ALT'; tf2.hidden = !tw?.melee; }
    this.updateHUD(now);
    if (now - (this.radarT || 0) > 33) { this.radarT = now; this.updateRadar(); }
  }
}
