// Authoritative CS-style round engine. Runs on the Node server (online) or inside the browser (offline practice).
import { TICK_RATE, PHYS, ROUND, ECON, BOT_NAMES, clamp, forward } from './constants.js';
import { getMap, inRect, siteAt, calloutAt } from './maps.js';
import { canOccupy, groundAt, rayWorld, rayPlayer, stepMove, hasLOS, heightAt, ceilAt } from './physics.js';
import { WEAPONS, WEAPON_KEYS, GEAR, defaultPistol, newWeapon, applyArmor, PART_MULT, NADES, NADE_LIMIT, newNades, nadeCount, firstNade } from './weapons.js';
import { getNav } from './nav.js';
import { rankForXp } from './ranks.js';
import { botThink, botRoundStart, botBuy, newBrain } from './bots.js';

const r2 = (v) => Math.round(v * 100) / 100;
const other = (t) => (t === 'T' ? 'CT' : 'T');
let botSeq = 1;

export class GameRoom {
  constructor(opts, out) {
    this.code = opts.code; this.title = String(opts.title || 'Dust II').slice(0, 24);
    this.mapId = opts.map || 'dust2'; this.map = getMap(this.mapId); this.nav = getNav(this.map);
    this.maxPlayers = clamp(opts.max | 0 || 10, 2, 16);
    this.botMode = opts.bots === 'none' ? 'none' : 'fill';
    this.difficulty = ['easy', 'normal', 'hard'].includes(opts.difficulty) ? opts.difficulty : 'normal';
    this.out = out; this.players = new Map(); this.profiles = opts.profiles || {}; this.addXp = opts.addXp || (()=>{}); this.moderation = opts.moderation || { mutes: {} }; this.saveData = opts.saveData || (()=>{}); this.drops = new Map(); this.dropSeq = 1;
    this.phase = 'warmup'; this.phaseEnd = 0; this.round = 0; this.score = { T: 0, CT: 0 }; this.loss = { T: 0, CT: 0 };
    this.bomb = { state: 'none' }; this.liveStart = 0; this.matchStartAt = 0; this.matchOver = false;
    this.now = Date.now(); this.last = this.now; this.lastRoster = 0; this.rosterDirty = true; this.spawnIdx = { T: 0, CT: 0 };
    this.tPlan = { site: 'A', route: 0 }; this.vote = null;
    this.nades = new Map(); this.nadeSeq = 1; this.smokes = []; this.weaponLimits = {
      awp: clamp(Number(opts.weaponLimits?.awp) || 0, 0, 8),
      sg553: clamp(Number(opts.weaponLimits?.sg553) || 0, 0, 8),
      aug: clamp(Number(opts.weaponLimits?.aug) || 0, 0, 8)
    };
  }
  // ---------- membership ----------
  get list() { return [...this.players.values()]; }
  humans() { return this.list.filter((p) => !p.bot); }
  team(t) { return this.list.filter((p) => p.team === t); }
  perTeam(team = null) {
    const half = this.maxPlayers / 2;
    if (team === 'T') return Math.ceil(half);
    if (team === 'CT') return Math.floor(half);
    return Math.ceil(half);
  }
  send(id, ev, d) { const p = this.players.get(id); if (p && !p.bot) this.out(id, ev, d); }
  broadcast(ev, d, except) { for (const p of this.players.values()) if (!p.bot && p.id !== except) this.out(p.id, ev, d); }
  teamcast(t, ev, d) { for (const p of this.players.values()) if (!p.bot && p.team === t) this.out(p.id, ev, d); }
  summary() {
    const h = this.humans();
    return { code: this.code, title: this.title, map: this.mapId, humans: h.length, bots: this.list.length - h.length, max: this.maxPlayers,
      phase: this.phase, round: this.round, score: this.score, botMode: this.botMode, difficulty: this.difficulty };
  }
  makePlayer(id, name, bot) {
    return { id, name, bot, team: 'SPEC', alive: false, hp: 0, armor: 0, helmet: false, kit: false, money: ECON.start, k: 0, d: 0, a: 0,
      x: 64, y: 3, z: 64, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false, yaw: 0, pitch: 0, speed: 0,
      w: { 1: null, 2: null, 3: newWeapon('knife') },
      rankXp: 0, rankName: 'Recruit', rankTag:'R1', g: newNades(), gk: null, active: 3, hasBomb: false, lastShot: 0, shots: 0, reloadEnd: 0, drawEnd: 0, scoped: 0,
      hist: [], lastSt: 0, cid: 1, dmgBy: new Map(), action: null, deadAt: 0, youDirty: true, ai: bot ? newBrain() : null, joinedAt: Date.now(), ping: 0, noclip: false, god: false };
  }
  applyProfile(p) {
    const key=String(p.name||'').toLowerCase(); const prof=this.profiles[key]||{}; const xp=Number(prof.xp)||0; const rr=rankForXp(xp);
    p.rankXp=xp; p.rankName=rr.name; p.rankTag=rr.tag;
    return p;
  }
  refreshPlayerProfile(name) { const key=String(name||'').toLowerCase(); for(const p of this.players.values()) if(!p.bot && String(p.name).toLowerCase()===key){ this.applyProfile(p); p.youDirty=true; this.rosterDirty=true; } }
  findSession(session) { if (!session) return null; for (const p of this.players.values()) if (!p.bot && p.session === session) return p; return null; }
  uniqueName(name) {
    const taken = new Set(this.humans().map((q) => String(q.name).toLowerCase())); if (!taken.has(String(name).toLowerCase())) return name;
    for (let i = 2; i < 99; i++) { const n = String(name).slice(0, 12) + ' (' + i + ')'; if (!taken.has(n.toLowerCase())) return n; } return name;
  }
  markDisconnected(id) {
    const p = this.players.get(id); if (!p || p.bot) return; p.dc = Date.now(); p.action = null; if (this.bomb.defuser === id) { this.bomb.defuser = null; this.bomb.defuseEnd = 0; this.broadcast('bomb', this.bombPublic()); }
    this.rosterDirty = true; this.broadcast('chat', { sys: true, msg: `${p.name} lost connection…` });
  }
  resume(oldId, newId) {
    const p = this.players.get(oldId); if (!p) return null;
    this.players.delete(oldId); p.id = newId; p.dc = 0; this.players.set(newId, p);
    const sw = (v) => (v === oldId ? newId : v);
    this.bomb.carrier = sw(this.bomb.carrier); this.bomb.defuser = sw(this.bomb.defuser); this.bomb.planter = sw(this.bomb.planter);
    for (const d of this.drops.values()) d.owner = sw(d.owner); for (const n of this.nades.values()) n.owner = sw(n.owner);
    for (const q of this.players.values()) { if (q.dmgBy.has(oldId)) { q.dmgBy.set(newId, q.dmgBy.get(oldId)); q.dmgBy.delete(oldId); } if (q.ai) { q.ai.target = sw(q.ai.target); q.ai.hurtBy = sw(q.ai.hurtBy); } }
    if (this.vote) { if (this.vote.eligible.delete(oldId)) this.vote.eligible.add(newId); if (oldId in this.vote.votes) { this.vote.votes[newId] = this.vote.votes[oldId]; delete this.vote.votes[oldId]; } }
    p.cid++; p.lastSt = 0; p.hist = [{ t: Date.now(), x: p.x, y: p.y, z: p.z, c: !!p.crouch }]; p.youDirty = true; this.rosterDirty = true;
    this.send(newId, 'init', { ...this.initPayload(newId), resumed: true });
    if (p.alive) this.send(newId, 'spawn', { x: p.x, y: p.y, z: p.z, yaw: p.yaw, cid: p.cid });
    this.broadcast('chat', { sys: true, msg: `${p.name} reconnected` }, newId);
    return p;
  }
  resetEmpty() {
    // Last human left: drop the bots and go back to warmup so the next visitor gets a fresh match.
    this.players.clear(); this.drops.clear(); this.nades.clear(); this.smokes = []; this.vote = null;
    this.phase = 'warmup'; this.phaseEnd = 0; this.round = 0; this.score = { T: 0, CT: 0 }; this.loss = { T: 0, CT: 0 }; this.bomb = { state: 'none' }; this.matchStartAt = 0; this.matchOver = false; this.rosterDirty = true;
  }
  addHuman(id, name, session = '') {
    name = this.uniqueName(name);
    const p = this.makePlayer(id, name, false); p.session = session; this.applyProfile(p); this.players.set(id, p);
    this.fillBots(); this.send(id, 'init', this.initPayload(id)); this.rosterDirty = true;
    this.broadcast('chat', { sys: true, msg: `${name} joined the server` }, id);
    return p;
  }
  initPayload(id) {
    const pp=this.players.get(id); const key=String(pp?.name||'').toLowerCase(); const prof=this.profiles[key]||{}; const rr=rankForXp(Number(prof.xp)||0); return { code: this.code, title: this.title, map: this.mapId, you: id, phase: this.phase, phaseEnd: this.phaseEnd, round: this.round, score: this.score,
      profile: {xp:Number(prof.xp)||0,rank:rr.name,rankTag:rr.tag}, roster: this.roster(), bomb: this.bombPublic(), drops: [...this.drops.values()], smokes: this.smokes, botMode: this.botMode, difficulty: this.difficulty, max: this.maxPlayers,
      perTeam: this.perTeam(), teamCaps: { T: this.perTeam('T'), CT: this.perTeam('CT') }, t: Date.now() };
  }
  roster() { return this.list.map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot, k: p.k, d: p.d, a: p.a, alive: p.alive, hp: p.hp, armor: p.armor, money: p.money, ping: p.ping, bomb: p.hasBomb, noclip: !!p.noclip, god: !!p.god, xp:p.rankXp, rank:p.rankName, rankTag:p.rankTag, dc: !!p.dc })); }
  removePlayer(id) {
    const p = this.players.get(id); if (!p) return;
    if (p.alive) this.dropAll(p);
    if (this.bomb.defuser === id) this.bomb.defuser = null;
    this.players.delete(id); this.rosterDirty = true;
    if (!p.bot) this.broadcast('chat', { sys: true, msg: `${p.name} left the server` });
    if (this.humans().length) { this.fillBots(); this.checkRoundEnd(); } else this.resetEmpty();
  }
  setTeam(id, team) {
    const p = this.players.get(id); if (!p) return { ok: false, error: 'not in room' };
    if (team === 'AUTO') {
      const hT = this.team('T').filter((q) => !q.bot && q.id !== id).length, hC = this.team('CT').filter((q) => !q.bot && q.id !== id).length;
      team = hT < hC ? 'T' : hC < hT ? 'CT' : Math.random() < 0.5 ? 'T' : 'CT';
    }
    if (!['T', 'CT', 'SPEC'].includes(team)) return { ok: false, error: 'bad team' };
    if (team === p.team) { if (!p.alive && team !== 'SPEC') this.maybeSpawnLate(p); return { ok: true, team }; }
    if (team !== 'SPEC') {
      const mates = this.team(team).filter((q) => q.id !== id);
      if (mates.filter((q) => !q.bot).length >= this.perTeam(team)) return { ok: false, error: 'TEAM_FULL' };
      if (mates.length >= this.perTeam(team)) { const b = mates.filter((q) => q.bot).sort((a, c) => a.alive - c.alive)[0]; if (b) this.removePlayer(b.id); }
    }
    if (p.alive) { this.dropAll(p); p.alive = false; this.resetLoadout(p); }
    const activeHumansBefore = this.humans().filter((q) => q.team !== 'SPEC' && q.id !== id).length;
    p.team = team; p.hasBomb = false; this.rosterDirty = true; p.youDirty = true;
    this.broadcast('chat', { sys: true, msg: `${p.name} joined ${team === 'SPEC' ? 'Spectators' : team === 'T' ? 'Terrorists' : 'Counter-Terrorists'}` });
    this.fillBots();
    if (team !== 'SPEC') {
      if (activeHumansBefore === 0 && this.phase !== 'warmup' && this.bothTeams()) this.startMatch('Match started');
      else this.maybeSpawnLate(p);
    }
    this.checkRoundEnd();
    return { ok: true, team };
  }
  maybeSpawnLate(p) {
    const now = Date.now();
    if (this.phase === 'warmup' || this.phase === 'freeze' || (this.phase === 'live' && now - this.liveStart < ROUND.lateSpawn * 1000)) { this.spawn(p); return true; }
    this.send(p.id, 'msg', { text: 'You will spawn next round', sub: 'Spectating — press Space to switch player' });
    return false;
  }
  bothTeams() { return this.team('T').length > 0 && this.team('CT').length > 0; }
  fillBots() {
    if (!this.humans().length) return;
    for (const t of ['T', 'CT']) {
      let list = this.team(t); const target = this.botMode === 'fill' ? this.perTeam(t) : list.filter((q) => !q.bot).length;
      while (list.length < target) { this.addBot(t); list = this.team(t); }
      while (list.length > target) { const b = list.filter((q) => q.bot).sort((a, c) => a.alive - c.alive)[0]; if (!b) break; this.removePlayer(b.id); list = this.team(t); }
    }
  }
  addBot(team) {
    const used = new Set(this.list.map((p) => p.name));
    const name = (BOT_NAMES.find((n) => !used.has('BOT ' + n)) ? 'BOT ' + BOT_NAMES.find((n) => !used.has('BOT ' + n)) : 'BOT ' + botSeq);
    const p = this.makePlayer('bot' + botSeq++, name, true); p.team = team; this.players.set(p.id, p);
    if (this.phase === 'warmup' || this.phase === 'freeze') { this.spawn(p); if (this.phase === 'freeze') botBuy(this, p); }
    this.rosterDirty = true; return p;
  }
  // ---------- spawning / loadout ----------
  resetLoadout(p) { p.g = newNades(); p.gk = null; p.w = { 1: null, 2: null, 3: newWeapon('knife') }; p.armor = 0; p.helmet = false; p.kit = false; p.hasBomb = false; p.active = 3; p.reloadEnd = 0; p.scoped = 0; }
  refillRoundAmmo(p) {
    for (const slot of [1, 2, 3]) {
      const it = p.w[slot]; if (!it) continue;
      const w = WEAPONS[it.k]; if (!w || w.melee || !w.mag) continue;
      it.mag = w.mag; it.res = w.res;
    }
    p.reloadEnd = 0; p.shots = 0;
  }
  spawn(p) {
    const pts = this.map.spawnPoints[p.team]; if (!pts) return;
    const taken = this.list.filter((q) => q.alive && q !== p);
    let pt = null;
    for (let k = 0; k < pts.length; k++) { const c = pts[(this.spawnIdx[p.team] + k) % pts.length]; if (!taken.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < 1.2)) { pt = c; this.spawnIdx[p.team] += k + 1; break; } }
    pt = pt || pts[(this.spawnIdx[p.team]++) % pts.length];
    Object.assign(p, { alive: true, hp: 100, x: pt.x, y: pt.y, z: pt.z, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false, yaw: pt.yaw, pitch: 0, shots: 0, action: null, reloadEnd: 0, scoped: 0 });
    p.spawnX = pt.x; p.spawnZ = pt.z; p.hist = [{ t: Date.now(), x: p.x, y: p.y, z: p.z, c: false }];
    if (!p.w[2]) p.w[2] = newWeapon(defaultPistol(p.team));
    if (!p.w[3]) p.w[3] = newWeapon('knife');
    if (this.phase === 'warmup') { p.money = 16000; }
    p.active = p.w[1] ? 1 : 2; p.drawEnd = Date.now() + 300; p.cid++; p.dmgBy.clear(); p.youDirty = true; this.rosterDirty = true;
    if (p.ai) Object.assign(p.ai, newBrain());
    this.send(p.id, 'spawn', { x: p.x, y: p.y, z: p.z, yaw: p.yaw, cid: p.cid });
  }
  startMatch(msg) {
    this.round = 0; this.score = { T: 0, CT: 0 }; this.loss = { T: 0, CT: 0 }; this.matchOver = false; this.matchStartAt = 0;
    for (const p of this.players.values()) { p.money = ECON.start; p.k = p.d = p.a = 0; this.resetLoadout(p); p.alive = false; }
    this.startRound(msg || 'Match started');
  }
  startRound(msg) {
    const now = Date.now(); this.round++;
    if (this.round === ROUND.half + 1) {
      for (const p of this.players.values()) if (p.team !== 'SPEC') { p.team = other(p.team); p.money = ECON.start; this.resetLoadout(p); p.alive = false; }
      this.score = { T: this.score.CT, CT: this.score.T }; this.loss = { T: 0, CT: 0 }; msg = 'Halftime — teams switched';
    }
    this.drops.clear(); this.bomb = { state: 'none' }; this.spawnIdx = { T: 0, CT: 0 }; this.nades.clear(); this.smokes = []; this.broadcast('smokes', []);
    this.phase = 'freeze'; this.phaseEnd = now + ROUND.freeze * 1000;
    for (const p of this.players.values()) { p.action = null; p.crouch = false; if (p.team === 'T' || p.team === 'CT') { if (!p.alive) this.resetLoadout(p); else this.refillRoundAmmo(p); p.hasBomb = false; this.spawn(p); this.refillRoundAmmo(p); } }
    const ts = this.team('T').filter((p) => p.alive);
    if (ts.length) { const humansT = ts.filter((p) => !p.bot); const pool = humansT.length && Math.random() < 0.6 ? humansT : ts; const c = pool[Math.floor(Math.random() * pool.length)] || ts[0]; c.hasBomb = true; this.bomb = { state: 'carried', carrier: c.id }; }
    botRoundStart(this);
    for (const p of this.players.values()) if (p.bot && p.alive) botBuy(this, p);
    this.broadcast('drops', []); this.broadcast('bomb', this.bombPublic());
    this.emitRound(msg ? { msg } : {}); this.rosterDirty = true;
  }
  emitRound(extra = {}) { this.broadcast('round', { phase: this.phase, phaseEnd: this.phaseEnd, round: this.round, score: this.score, liveStart: this.liveStart, matchOver: this.matchOver, ...extra }); }
  endRound(winner, reason) {
    if (this.phase === 'over') return;
    const now = Date.now(); const loser = other(winner);
    this.phase = 'over'; this.phaseEnd = now + ROUND.over * 1000; this.score[winner]++;
    for (const p of this.team(winner)) p.money = Math.min(ECON.max, p.money + ECON.win[reason]);
    this.loss[winner] = 0; this.loss[loser] = Math.min(5, this.loss[loser] + 1);
    const bonus = Math.min(ECON.lossMax, ECON.lossBase + ECON.lossStep * (this.loss[loser] - 1));
    const planted = this.bomb.state === 'planted' || this.bomb.state === 'defused';
    for (const p of this.team(loser)) p.money = Math.min(ECON.max, p.money + bonus + (loser === 'T' && planted ? ECON.plantBonus : 0));
    for (const p of this.players.values()) { p.action = null; p.youDirty = true; }
    if (this.score[winner] >= ROUND.winTo || this.round >= ROUND.maxRounds) { this.matchOver = true; this.phaseEnd = now + ROUND.matchOver * 1000; }
    const names = { T: 'Terrorists Win', CT: 'Counter-Terrorists Win' };
    const why = { elim: '', bomb: 'Target destroyed', defuse: 'The bomb has been defused', time: 'Target saved' }[reason];
    this.emitRound({ winner, reason, msg: this.matchOver ? `${winner === 'T' ? 'TERRORISTS' : 'COUNTER-TERRORISTS'} WIN THE MATCH` : names[winner], sub: why });
    this.rosterDirty = true;
  }
  checkRoundEnd() {
    if (this.phase !== 'live' && this.phase !== 'planted') return;
    const T = this.team('T'), C = this.team('CT'); const aT = T.filter((p) => p.alive).length, aC = C.filter((p) => p.alive).length;
    if (this.phase === 'live') { if (T.length && !aT) return this.endRound('CT', 'elim'); if (C.length && !aC) return this.endRound('T', 'elim'); }
    else if (C.length && !aC) return this.endRound('T', 'elim');
  }
  // ---------- combat ----------
  eye(p) { return [p.x, p.y + (p.crouch ? PHYS.crouchEye : PHYS.eye), p.z]; }
  rewind(q, t) {
    const h = q.hist; if (!h.length) return q;
    if (t >= h[h.length - 1].t) return h[h.length - 1];
    for (let i = h.length - 1; i > 0; i--) if (h[i - 1].t <= t) { const a = h[i - 1], b = h[i], f = (t - a.t) / Math.max(1, b.t - a.t); return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, crouch: f < 0.5 ? a.c : b.c }; }
    return h[0];
  }
  fire(p, o, d, t, wk, alt = false) {
    const now = Date.now(); const item = p.w[p.active]; const w = WEAPONS[wk];
    // Validate the client-provided ray before consuming ammo or advancing fire state.
    if (!Array.isArray(d) || d.length !== 3 || !d.every(Number.isFinite)) return false;
    if (!p.alive || !w || !item || item.k !== wk || this.phase === 'freeze' || this.phase === 'over' || wk === 'c4' || w.nade || p.active === 4) return false;
    if (now < p.drawEnd - 80 || p.reloadEnd) return false;
    const rpm = (w.melee && alt && w.altRpm) ? w.altRpm : w.rpm;
    const interval = 60000 / rpm; if (now - p.lastShot < interval * 0.8) return false;
    const L = Math.hypot(d[0], d[1], d[2]); if (!(L > 0.5)) return false;
    d = [d[0] / L, d[1] / L, d[2] / L];
    if (!w.melee) { if (item.mag <= 0) return false; item.mag--; }
    if (now - p.lastShot > interval * 1.6 + 150) p.shots = 0;
    p.shots++; p.lastShot = now; p.youDirty = true;
    const e = this.eye(p); if (!Array.isArray(o) || o.length !== 3 || !o.every(Number.isFinite) || Math.hypot(o[0] - e[0], o[1] - e[1], o[2] - e[2]) > 1.5) o = e;
    const fw = forward(p.yaw, p.pitch); if (fw[0] * d[0] + fw[1] * d[1] + fw[2] * d[2] < 0.9) d = fw; // reject wildly off-aim rays
    const range = w.melee ? ((alt && w.altRange) || w.range) : 220; const wall = rayWorld(this.map, o, d, range);
    const rt = clamp(t || now, now - 350, now); let best = null;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.team === p.team || q.team === 'SPEC') continue;
      const pos = q.bot ? q : this.rewind(q, rt); const hit = rayPlayer(o, d, pos, best ? best.t : wall.t);
      if (hit) best = { q, ...hit };
    }
    const T = best ? best.t : wall.t; const end = [r2(o[0] + d[0] * T), r2(o[1] + d[1] * T), r2(o[2] + d[2] * T)];
    this.broadcast('fx', { id: p.id, w: wk, o: o.map(r2), e: end, h: best ? 1 : wall.n ? 2 : 0, n: wall.n }, p.bot ? null : p.id);
    if (best) {
      const mult = w.melee ? (best.part === 'head' ? 1.4 : 1) : PART_MULT[best.part];
      const baseDmg = w.melee && alt && w.altDmg ? w.altDmg : w.dmg;
      const dmg = baseDmg * mult * Math.pow(w.falloff, best.t / 12.7);
      this.damage(best.q, p, dmg, best.part, wk);
    }
    if (p.bot && item.mag === 0 && !w.melee) this.reload(p);
    return true;
  }
  damage(v, a, dmg, part, wk) {
    if (v.god) return;
    const r = applyArmor(dmg, WEAPONS[wk] || { pen: 0.5 }, part, v.armor, v.helmet);
    const hp = Math.min(v.hp, r.hp); v.hp -= hp; v.armor = Math.max(0, v.armor - r.armor); v.youDirty = true;
    if (a) { v.dmgBy.set(a.id, (v.dmgBy.get(a.id) || 0) + hp); this.send(a.id, 'hit', { v: v.id, dmg: hp, hs: part === 'head', kill: v.hp <= 0 }); }
    this.send(v.id, 'hurt', { from: a ? a.id : null, x: a ? a.x : v.x, z: a ? a.z : v.z, dmg: hp, hs: part === 'head' });
    if (v.ai && a) { v.ai.hurtBy = a.id; v.ai.hurtAt = Date.now(); }
    if (v.hp <= 0) this.kill(v, a, wk, part === 'head');
  }
  kill(v, a, wk, hs) {
    if (!v.alive) return;
    v.alive = false; v.deadAt = Date.now(); v.d++; v.action = null; v.hp = 0;
    // Snap a player who dies mid-air onto the floor so the corpse does not freeze in a jump/fall pose.
    v.y = groundAt(this.map, v.x, v.z, 0.2); v.vx = 0; v.vy = 0; v.vz = 0; v.onGround = true; v.crouch = false;
    if (this.bomb.defuser === v.id) this.bomb.defuser = null;
    let assist = null;
    if (a && a !== v) {
      if (a.team !== v.team) { a.k++; a.money = Math.min(ECON.max, a.money + (WEAPONS[wk] ? WEAPONS[wk].reward : 300)); if(!a.bot) this.addXp(a.name, hs ? 120 : 100); this.applyProfile(a); }
      else { a.k--; a.money = Math.max(0, a.money - ECON.teamKillPenalty); }
      a.youDirty = true;
    }
    for (const [id, dmg] of v.dmgBy) { if (a && id === a.id) continue; const q = this.players.get(id); if (q && q.team !== v.team && dmg >= 40) { q.a++; assist = assist || q.name; } }
    v.dmgBy.clear();
    this.dropAll(v); this.resetLoadout(v); v.youDirty = true; this.rosterDirty = true;
    this.broadcast('kill', { k: a ? a.id : null, kn: a ? a.name : '', kt: a ? a.team : '', v: v.id, vn: v.name, vt: v.team, w: wk, hs: !!hs, as: assist });
    if (!this.exploding) this.checkRoundEnd();
  }
  // ---------- items ----------
  addDrop(k, item, x, y, z, owner) {
    const id = this.dropSeq++; const d = { id, k, mag: item ? item.mag : WEAPONS[k].mag, res: item ? item.res : WEAPONS[k].res, x: r2(x), y: r2(y), z: r2(z), t: Date.now(), owner };
    this.drops.set(id, d); this.broadcast('drops', [...this.drops.values()]); return d;
  }
  dropPoint(p, dist = 1.2) {
    const f = forward(p.yaw, 0); const x = p.x + f[0] * dist, z = p.z + f[2] * dist;
    if (canOccupy(this.map, x, z, p.y + 0.3, 0.5, 0.2)) return [x, groundAt(this.map, x, z, 0.2), z];
    return [p.x, p.y, p.z];
  }
  dropAll(p) {
    const slot = p.w[1] ? 1 : p.w[2] ? 2 : 0;
    if (slot) { const [x, y, z] = this.dropPoint(p, 0.6); this.addDrop(p.w[slot].k, p.w[slot], x, y, z, p.id); p.w[slot] = null; }
    if (p.hasBomb) this.dropBomb(p, 0.3);
    p.action = null;
  }
  dropBomb(p, dist = 1.2) {
    p.hasBomb = false; const [x, y, z] = this.dropPoint(p, dist);
    this.bomb = { state: 'dropped', x: r2(x), y: r2(y), z: r2(z), t: Date.now() }; this.broadcast('bomb', this.bombPublic());
    this.teamcast('T', 'chat', { sys: true, msg: 'The bomb has been dropped' }); this.rosterDirty = true;
  }
  bombPublic() { const b = this.bomb; return { state: b.state, carrier: b.carrier || null, x: b.x, y: b.y, z: b.z, site: b.site, explodeAt: b.explodeAt, defuser: b.defuser || null, defuseEnd: b.defuseEnd || 0 }; }
  bestSlot(p) { return p.w[1] ? 1 : p.w[2] ? 2 : 3; }
  buy(p, item) {
    const now = Date.now();
    if (!p || !p.alive || p.team === 'SPEC') return { ok: false, error: 'You are dead' };
    const canTime = this.phase === 'warmup' || this.phase === 'freeze' || (this.phase === 'live' && now - this.liveStart < ROUND.buy * 1000);
    if (!canTime) return { ok: false, error: 'Buy time has expired' };
    if (this.phase !== 'warmup' && !inRect(this.map.def.buy[p.team], p.x, p.z)) return { ok: false, error: 'You are not in a buy zone' };
    const w = WEAPONS[item];
    const limit = this.weaponLimits[item] || 0; if (w && limit > 0) { const same=this.team(p.team).filter(q=>q.w[1]?.k===item).length; if(same >= limit && p.w[1]?.k !== item) return {ok:false,error:`${item.toUpperCase()} limit reached`}; }
    if (w && !w.nade && !w.melee && w.mag > 0 && w.slot !== 5) {
      if (w.team && w.team !== p.team) return { ok:false, error:'Not available for your team' };
      if (p.w[w.slot] && p.w[w.slot].k === item) return { ok:false, error:'You already have this weapon' };
      const price = Number(w.price) || 0;
      if (p.money < price) return {ok:false,error:'Not enough money'};
      p.money -= price; if (p.w[w.slot]) { const [x,y,z]=this.dropPoint(p,0.8); this.addDrop(p.w[w.slot].k,p.w[w.slot],x,y,z,p.id); }
      p.w[w.slot]=newWeapon(item); p.active=w.slot; p.drawEnd=now+(w.draw||0.5)*1000; p.reloadEnd=0; p.scoped=0; p.youDirty=true; this.rosterDirty=true; return {ok:true,price};
    }
    if (w && w.nade) {
      if (p.g[item] >= w.max) return { ok: false, error: 'You cannot carry any more' };
      if (nadeCount(p.g) >= NADE_LIMIT) return { ok: false, error: 'Grenade limit reached' };
      if (p.money < w.price) return { ok: false, error: 'Not enough money' };
      p.money -= w.price; p.g[item]++; if (!p.gk) p.gk = item;
      p.youDirty = true; this.rosterDirty = true; return { ok: true };
    }
    if (w && w.price) {
      if (w.team && w.team !== p.team) return { ok: false, error: 'Not available for your team' };
      if (p.w[w.slot] && p.w[w.slot].k === item) return { ok: false, error: 'You already have this weapon' };
      if (p.money < w.price) return { ok: false, error: 'Not enough money' };
      p.money -= w.price;
      if (p.w[w.slot]) { const [x, y, z] = this.dropPoint(p, 0.8); this.addDrop(p.w[w.slot].k, p.w[w.slot], x, y, z, p.id); }
      p.w[w.slot] = newWeapon(item); p.active = w.slot; p.drawEnd = now + w.draw * 1000; p.reloadEnd = 0; p.scoped = 0;
    } else if (item === 'vest') {
      if (p.armor >= 100) return { ok: false, error: 'Already wearing kevlar' };
      if (p.money < 650) return { ok: false, error: 'Not enough money' }; p.money -= 650; p.armor = 100;
    } else if (item === 'vesthelm') {
      if (p.armor >= 100 && p.helmet) return { ok: false, error: 'Already wearing kevlar + helmet' };
      const price = p.armor >= 100 ? 350 : 1000; if (p.money < price) return { ok: false, error: 'Not enough money' };
      p.money -= price; p.armor = 100; p.helmet = true;
    } else if (item === 'kit') {
      if (p.team !== 'CT') return { ok: false, error: 'CT only' }; if (p.kit) return { ok: false, error: 'Already have a defuse kit' };
      if (p.money < 400) return { ok: false, error: 'Not enough money' }; p.money -= 400; p.kit = true;
    } else return { ok: false, error: 'Unknown item' };
    p.youDirty = true; this.rosterDirty = true; return { ok: true };
  }
  // ---------- grenades ----------
  throwNade(p, d, strong = true) {
    const now = Date.now(); const k = p.gk; const w = WEAPONS[k];
    if (!p.alive || p.active !== 4 || !w || !w.nade || !(p.g[k] > 0) || this.phase === 'freeze' || this.phase === 'over' || now < p.drawEnd - 80 || now - (p.lastThrow || 0) < 700) return false;
    if (!Array.isArray(d) || d.length !== 3 || !d.every(Number.isFinite)) d = forward(p.yaw, p.pitch);
    const L = Math.hypot(d[0], d[1], d[2]) || 1; d = [d[0] / L, d[1] / L, d[2] / L];
    const e = this.eye(p), v = strong ? 15.5 : 7.5;
    const n = { id: this.nadeSeq++, k, owner: p.id, team: p.team, x: e[0] + d[0] * 0.35, y: e[1] - 0.1, z: e[2] + d[2] * 0.35, vx: d[0] * v + (p.vx || 0) * 0.5, vy: d[1] * v + 2.2, vz: d[2] * v + (p.vz || 0) * 0.5, born: now, still: 0 };
    if (!canOccupy(this.map, n.x, n.z, n.y - 0.05, 0.1, 0.05)) { n.x = p.x; n.z = p.z; }
    this.nades.set(n.id, n); p.g[k]--; p.lastThrow = now; p.lastShot = now;
    this.broadcast('act', { id: p.id, type: 'throw', k });
    const next = p.g[k] > 0 ? k : firstNade(p.g, k);
    if (next) { p.gk = next; p.drawEnd = now + 600; } else { p.gk = null; p.active = this.bestSlot(p); p.drawEnd = now + 450; }
    p.youDirty = true; return true;
  }
  stepNade(n, dt, now) {
    const m = this.map, sub = 4, h = dt / sub;
    for (let i = 0; i < sub; i++) {
      n.vy -= 20 * h;
      const nx = n.x + n.vx * h; if (heightAt(m, nx, n.z) > n.y || ceilAt(m, nx, n.z) < n.y) { n.vx *= -0.45; n.vz *= 0.8; } else n.x = nx;
      const nz = n.z + n.vz * h; if (heightAt(m, n.x, nz) > n.y || ceilAt(m, n.x, nz) < n.y) { n.vz *= -0.45; n.vx *= 0.8; } else n.z = nz;
      let ny = n.y + n.vy * h; const g = heightAt(m, n.x, n.z) + 0.06, c = ceilAt(m, n.x, n.z) - 0.06;
      if (ny < g) { ny = g; if (n.vy < 0) n.vy = Math.abs(n.vy) < 1.2 ? 0 : -n.vy * 0.38; n.vx *= 0.62; n.vz *= 0.62; }
      if (ny > c) { ny = c; if (n.vy > 0) n.vy = -n.vy * 0.3; }
      n.y = ny;
    }
    const sp = Math.hypot(n.vx, n.vy, n.vz); n.still = sp < 0.6 ? n.still + dt : 0;
    const w = WEAPONS[n.k], age = (now - n.born) / 1000;
    if (n.k === 'smoke' ? (n.still > 0.25 && age > 0.8) || age > w.fuse + 2 : age >= w.fuse) this.detonate(n, now);
  }
  detonate(n, now) {
    this.nades.delete(n.id); const w = WEAPONS[n.k], c = [n.x, n.y + 0.15, n.z];
    this.broadcast('boom', { k: n.k, x: r2(n.x), y: r2(n.y), z: r2(n.z), owner: n.owner });
    const owner = this.players.get(n.owner);
    if (n.k === 'he') {
      // CS2-style smoke interaction: an HE grenade rapidly disperses smoke at
      // the blast point. A blast near the center collapses the whole cloud; a
      // blast near the edge leaves the rest of the smoke intact.
      this.disperseSmokeAt(c, Math.max(2.6, w.radius * 0.42), now);
      for (const q of [...this.players.values()]) {
        if (!q.alive) continue; if (owner && q.team === owner.team && q !== owner) continue;
        const ch = [q.x, q.y + 1.0, q.z], d = Math.hypot(ch[0] - c[0], ch[1] - c[1], ch[2] - c[2]); if (d > w.radius) continue;
        if (!hasLOS(this.map, c, ch) && !hasLOS(this.map, c, [q.x, q.y + 1.6, q.z])) continue;
        const dmg = w.dmg * Math.pow(1 - d / w.radius, 1.3); if (dmg < 1) continue;
        this.damage(q, owner && owner.alive !== undefined ? owner : null, dmg, 'chest', 'he');
      }
    } else if (n.k === 'flash') {
      for (const q of this.players.values()) {
        if (!q.alive || !q.ai) continue; const e = this.eye(q), d = Math.hypot(e[0] - c[0], e[1] - c[1], e[2] - c[2]); if (d > 32 || !hasLOS(this.map, e, c)) continue;
        const f = forward(q.yaw, q.pitch), dot = (f[0] * (c[0] - e[0]) + f[1] * (c[1] - e[1]) + f[2] * (c[2] - e[2])) / Math.max(0.01, d);
        const amt = (dot > 0.5 ? 1 : dot > 0 ? 0.55 : 0.2) * (1 - d / 32); q.ai.blindUntil = now + amt * 4500; q.ai.visible = false;
      }
    } else if (n.k === 'smoke') {
      // Smoke itself stays neutral like CS2; a very subtle team tint keeps CT/T
      // grenades distinguishable in this custom build without turning them neon.
      const smokeColor = n.team === 'CT' ? '#b8bec3' : '#b9b2aa';
      this.smokes.push({ id: n.id, x: r2(n.x), y: r2(n.y), z: r2(n.z), r: w.radius, end: now + w.life * 1000, color: smokeColor, holes: [] });
      this.broadcast('smokes', this.smokes);
    }
  }
  disperseSmokeAt(c, blastRadius, now) {
    if (!this.smokes.length) return false;
    let changed = false;
    const next = [];
    for (const s of this.smokes) {
      const d = Math.hypot(c[0] - s.x, c[2] - s.z);
      // Center hit: collapse the cloud immediately.
      if (d <= s.r * 0.42) { changed = true; continue; }
      // Edge hit: carve a temporary hole whose size depends on how deep the HE
      // lands inside the smoke. Multiple HEs can carve multiple holes.
      if (d <= s.r + blastRadius) {
        const strength = clamp(1 - Math.max(0, d - s.r * 0.35) / Math.max(0.1, s.r * 0.9), 0, 1);
        const hole = { x: r2(c[0]), y: r2(c[1]), z: r2(c[2]), r: r2(1.35 + strength * 2.65), end: now + 1450 };
        s.holes = Array.isArray(s.holes) ? s.holes.filter((h) => now < h.end) : [];
        s.holes.push(hole);
        changed = true;
      }
      next.push(s);
    }
    this.smokes = next;
    if (changed) this.broadcast('smokes', this.smokes);
    return changed;
  }
  smokeBlocks(a, b) {
    for (const s of this.smokes) {
      const cy = s.y + 1.4, dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L2 = dx * dx + dy * dy + dz * dz || 1;
      const t = clamp(((s.x - a[0]) * dx + (cy - a[1]) * dy + (s.z - a[2]) * dz) / L2, 0, 1);
      const qx = a[0] + dx * t, qy = a[1] + dy * t, qz = a[2] + dz * t;
      const px = qx - s.x, py = qy - cy, pz = qz - s.z;
      if (px * px + py * py * 0.6 + pz * pz >= s.r * s.r * 0.8) continue;
      const holes = Array.isArray(s.holes) ? s.holes : [];
      if (holes.some((h) => Date.now() < h.end && Math.hypot(qx - h.x, qz - h.z) < h.r && Math.abs(qy - h.y) < h.r * 1.15)) continue;
      return true;
    }
    return false;
  }
  reload(p) {
    const item = p.w[p.active]; if (!p.alive || !item || this.phase === 'over') return; const w = WEAPONS[item.k];
    if (!w || w.melee || !w.mag || item.mag >= w.mag || item.res <= 0 || p.reloadEnd) return;
    p.reloadEnd = Date.now() + w.reload * 1000; p.scoped = 0; p.youDirty = true; this.broadcast('act', { id: p.id, type: 'reload' }, p.id);
  }
  switchSlot(p, slot, k) {
    if (!p.alive) return;
    if (slot === 4) {
      const want = k && p.g[k] > 0 ? k : p.active === 4 ? firstNade(p.g, p.gk) : (p.gk && p.g[p.gk] > 0 ? p.gk : firstNade(p.g, null));
      if (!want) return; if (p.active === 4 && want === p.gk) return;
      p.gk = want; p.active = 4; p.reloadEnd = 0; p.scoped = 0; p.shots = 0; p.drawEnd = Date.now() + 500; p.youDirty = true; return;
    }
    if (p.active === slot) return;
    if (slot === 5 ? !p.hasBomb : !p.w[slot]) return;
    p.active = slot; p.reloadEnd = 0; p.scoped = 0; p.shots = 0; p.drawEnd = Date.now() + (WEAPONS[slot === 5 ? 'c4' : p.w[slot].k].draw || 0.4) * 1000; p.youDirty = true;
  }
  dropActive(p) {
    if (!p.alive) return;
    if (p.active === 5 && p.hasBomb) { this.dropBomb(p, 1.4); p.active = this.bestSlot(p); p.youDirty = true; return; }
    if (p.active !== 1 && p.active !== 2) return; const it = p.w[p.active]; if (!it) return;
    const [x, y, z] = this.dropPoint(p, 1.4); this.addDrop(it.k, it, x, y, z, p.id); p.w[p.active] = null;
    p.active = this.bestSlot(p); p.drawEnd = Date.now() + 400; p.reloadEnd = 0; p.youDirty = true;
  }
  use(p) {
    if (!p || !p.alive || p.action) return;
    const now = Date.now(), b = this.bomb;
    if (p.hasBomb && this.phase === 'live' && siteAt(this.map, p.x, p.z) && p.onGround !== false) {
      p.action = { type: 'plant', end: now + ROUND.plant * 1000, x: p.x, z: p.z, site: siteAt(this.map, p.x, p.z) }; p.active = 5; p.crouch = true;
      this.broadcast('act', { id: p.id, type: 'plant', end: p.action.end }); p.youDirty = true; return;
    }
    if (p.team === 'CT' && this.phase === 'planted' && b.state === 'planted' && !b.defuser && Math.hypot(p.x - b.x, p.z - b.z) < 2.0 && Math.abs(p.y - b.y) < 1.6) {
      p.action = { type: 'defuse', end: now + (p.kit ? ROUND.defuseKit : ROUND.defuse) * 1000, x: p.x, z: p.z }; b.defuser = p.id; b.defuseEnd = p.action.end;
      this.broadcast('act', { id: p.id, type: 'defuse', end: p.action.end, kit: p.kit }); this.broadcast('bomb', this.bombPublic()); return;
    }
    let best = null, bd = 1.7;
    for (const d of this.drops.values()) { const dd = Math.hypot(d.x - p.x, d.z - p.z); if (dd < bd && Math.abs(d.y - p.y) < 1.6) { bd = dd; best = d; } }
    if (best) {
      const slot = WEAPONS[best.k].slot;
      if (p.w[slot]) { const [x, y, z] = this.dropPoint(p, 0.5); this.addDrop(p.w[slot].k, p.w[slot], x, y, z, p.id); }
      this.takeDrop(p, best);
    }
  }
  takeDrop(p, d) {
    const slot = WEAPONS[d.k].slot; p.w[slot] = { k: d.k, mag: d.mag, res: d.res }; this.drops.delete(d.id);
    p.active = slot; p.drawEnd = Date.now() + 500; p.reloadEnd = 0; p.youDirty = true; this.broadcast('drops', [...this.drops.values()]);
  }
  unuse(p) {
    if (!p || !p.action) return;
    const wasPlant = p.action.type === 'plant';
    if (p.action.type === 'defuse') { this.bomb.defuser = null; this.bomb.defuseEnd = 0; this.broadcast('bomb', this.bombPublic()); }
    p.action = null; if (wasPlant) p.crouch = false; this.broadcast('act', { id: p.id, type: 'cancel' }); p.youDirty = true;
  }
  plant(p) {
    const now = Date.now(); p.hasBomb = false; p.crouch = false; p.action = null; p.money = Math.min(ECON.max, p.money + ECON.plantPersonal); p.active = this.bestSlot(p); p.youDirty = true;
    this.bomb = { state: 'planted', x: r2(p.x), y: r2(groundAt(this.map, p.x, p.z, 0.2)), z: r2(p.z), site: siteAt(this.map, p.x, p.z), plantedAt: now, explodeAt: now + ROUND.bomb * 1000, planter: p.id, defuser: null };
    this.phase = 'planted'; this.phaseEnd = this.bomb.explodeAt; this.rosterDirty = true;
    this.broadcast('bomb', this.bombPublic()); this.emitRound({ msg: 'Bomb has been planted', sub: `Bombsite ${this.bomb.site}`, planted: true });
    for (const q of this.players.values()) if (q.ai) q.ai.goal = null;
  }
  defuse(p) {
    p.action = null; p.money = Math.min(ECON.max, p.money + ECON.defusePersonal); this.bomb.state = 'defused'; this.bomb.defuser = null;
    this.broadcast('bomb', this.bombPublic()); this.endRound('CT', 'defuse');
  }
  explode() {
    const b = this.bomb; b.state = 'exploded'; this.broadcast('bomb', this.bombPublic());
    this.exploding = true;
    for (const q of this.players.values()) {
      if (!q.alive) continue; const d = Math.hypot(q.x - b.x, q.y - b.y, q.z - b.z); const dmg = 500 * Math.exp(-(d * d) / (2 * 11 * 11));
      if (dmg < 1) continue; let hp = q.armor > 0 ? dmg * 0.5 : dmg; q.armor = Math.max(0, q.armor - dmg * 0.25);
      q.hp -= Math.round(hp); q.youDirty = true; this.send(q.id, 'hurt', { from: null, x: b.x, z: b.z, dmg: Math.round(hp) });
      if (q.hp <= 0) this.kill(q, null, 'c4', false);
    }
    this.exploding = false;
    this.endRound('T', 'bomb');
  }
  // ---------- client input ----------
  handleState(p, s) {
    if (!p || p.bot || !s) return; const now = Date.now();
    const yaw = Number(s.yaw), pitch = Number(s.pitch);
    if (Number.isFinite(yaw)) p.yaw = yaw; if (Number.isFinite(pitch)) p.pitch = clamp(pitch, -1.55, 1.55);
    if (!p.alive || (s.cid | 0) !== p.cid) return;
    const x = Number(s.x), y = Number(s.y), z = Number(s.z); if (![x, y, z].every(Number.isFinite)) return;
    const dt = clamp((now - (p.lastSt || now - 50)) / 1000, 0.016, 1); p.lastSt = now;
    p.crouch = !!s.c; p.onGround = !!s.g; p.scoped = s.sc | 0;
    if (p.noclip) {
      const d = Math.hypot(x - p.x, z - p.z, y - p.y);
      if (d > 18 * dt + 1.5) return this.correct(p);
      p.speed = d / dt; p.x = x; p.y = y; p.z = z;
      p.hist.push({ t: now, x, y, z, c: p.crouch }); while (p.hist.length > 2 && now - p.hist[0].t > 1000) p.hist.shift();
      return;
    }
    if (this.phase === 'freeze' && Math.hypot(x - p.spawnX, z - p.spawnZ) > 1.0) return this.correct(p);
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > 8.5 * dt + 0.9) return this.correct(p);
    if (!canOccupy(this.map, x, z, y + 0.06, p.crouch ? PHYS.crouchHeight : PHYS.height, 0.3)) return this.correct(p);
    const g = groundAt(this.map, x, z, 0.3); if (y > g + 3.2 || y < g - 0.8) return this.correct(p);
    p.speed = d / dt; p.x = x; p.y = y; p.z = z;
    p.hist.push({ t: now, x, y, z, c: p.crouch }); while (p.hist.length > 2 && now - p.hist[0].t > 1000) p.hist.shift();
  }
  correct(p) { p.cid++; this.send(p.id, 'correct', { x: p.x, y: p.y, z: p.z, cid: p.cid }); }
  startVote(kind, value, initiator) {
    const eligible=this.humans().filter(p=>p.team!=='SPEC'); if(!eligible.length) return {ok:false,error:'no_voters'};
    this.vote={kind:String(kind),value:value||null,initiator:String(initiator||''),votes:{},eligible:new Set(eligible.map(p=>p.id)),startedAt:Date.now()};
    this.broadcast('vote',{kind:this.vote.kind,value:this.vote.value,yes:0,no:0,total:eligible.length}); return {ok:true};
  }
  castVote(id, yes) {
    if(!this.vote || !this.vote.eligible.has(id)) return {ok:false,error:'no_vote'}; this.vote.votes[id]=!!yes;
    const vals=Object.values(this.vote.votes), y=vals.filter(Boolean).length, n=vals.length-y, total=this.vote.eligible.size; this.broadcast('vote',{kind:this.vote.kind,value:this.vote.value,yes:y,no:n,total});
    if(y/Math.max(1,total)>=0.70){ const v=this.vote; this.vote=null; if(v.kind==='restart') this.startRound('Vote restarted the round'); else if(v.kind==='kick'){ const q=this.players.get(String(v.value)); if(q) this.adminSet(q.id,'kick',true); } else if(v.kind==='mute'){ const q=this.players.get(String(v.value)); if(q) this.adminSet(q.id,'mute',true); } this.broadcast('msg',{text:'Vote passed',sub:v.kind.toUpperCase()}); return {ok:true,passed:true}; }
    if(vals.length>=total){ const v=this.vote; this.vote=null; this.broadcast('msg',{text:'Vote failed',sub:v.kind.toUpperCase()}); }
    return {ok:true,passed:false};
  }
  // ---------- admin controls ----------
  adminRoster() {
    return this.list.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot, team: p.team, alive: !!p.alive,
      hp: Math.round(p.hp), armor: Math.round(p.armor), money: Math.round(p.money), k: p.k, d: p.d, a: p.a, xp:p.rankXp, rank:p.rankName, rankTag:p.rankTag,
      ping: p.ping, bomb: !!p.hasBomb, noclip: !!p.noclip, god: !!p.god, x: r2(p.x), y: r2(p.y), z: r2(p.z) }));
  }
  adminSet(id, action, value) {
    const p = this.players.get(String(id)); if (!p) return { ok:false, error:'player_not_found' };
    const n = Number(value);
    switch (action) {
      case 'hp': p.hp = clamp(Number.isFinite(n) ? n : 100, 0, 100); p.alive = p.hp > 0; if (!p.alive) p.deadAt = Date.now(); break;
      case 'armor': p.armor = clamp(Number.isFinite(n) ? n : 0, 0, 100); break;
      case 'xp': { const x=clamp(Number(value)||0,0,999999); this.profiles[String(p.name).toLowerCase()] ||= {}; this.profiles[String(p.name).toLowerCase()].xp=x; this.applyProfile(p); this.saveData(); break; }
      case 'give': { const k=String(value||''); if(!WEAPONS[k] || WEAPONS[k].nade || WEAPONS[k].melee) return {ok:false,error:'bad_weapon'}; p.w[WEAPONS[k].slot]=newWeapon(k); p.active=WEAPONS[k].slot; p.drawEnd=Date.now()+500; break; }
      case 'money': p.money = clamp(Number.isFinite(n) ? n : 0, 0, ECON.max); break;
      case 'team': return this.setTeam(p.id, String(value || 'SPEC'));
      case 'noclip': p.noclip = !!value; break;
      case 'god': p.god = !!value; break;
      case 'kill': if (p.alive) this.kill(p, null, 'knife', false); break;
      case 'respawn': if (p.team !== 'SPEC') { p.alive = false; this.spawn(p); } break;
      case 'teleport': {
        const q = value || {}; const x=Number(q.x), y=Number(q.y), z=Number(q.z);
        if (![x,y,z].every(Number.isFinite)) return {ok:false,error:'bad_position'};
        p.x=x; p.y=y; p.z=z; p.cid++; p.hist=[{t:Date.now(),x,y,z,c:!!p.crouch}]; p.youDirty=true; this.send(p.id,'spawn',{x,y,z,yaw:p.yaw,cid:p.cid});
        break;
      }
      case 'mute': case 'gag': case 'silence': { const k=String(p.name).toLowerCase(); this.moderation.mutes ||= {}; if(value) this.moderation.mutes[k]={type:action,at:Date.now()}; else delete this.moderation.mutes[k]; this.saveData(); break; }
      case 'kick': this.removePlayer(p.id); return {ok:true, kicked:true};
      default: return {ok:false,error:'bad_action'};
    }
    p.youDirty = true; this.rosterDirty = true; return {ok:true};
  }
  adminRoom(action, value) {
    switch (action) {
      case 'restart': this.startRound('Admin restarted the round'); return {ok:true};
      case 'newmatch': this.startMatch('Admin started a new match'); return {ok:true};
      case 'bots': this.botMode = value === 'none' ? 'none' : 'fill'; this.fillBots(); this.rosterDirty=true; return {ok:true};
      case 'difficulty': if (!['easy','normal','hard'].includes(value)) return {ok:false,error:'bad_difficulty'}; this.difficulty=value; return {ok:true};
      case 'max': this.maxPlayers=clamp(Number(value)||10,2,16); this.fillBots(); return {ok:true};
      case 'weaponLimit': { const v=value||{}; const k=String(v.weapon||''); if(!['awp','sg553','aug'].includes(k)) return {ok:false,error:'bad_weapon'}; this.weaponLimits[k]=clamp(Number(v.limit)||0,0,8); return {ok:true}; }
      case 'vote': { const v=value||{}; if(!['restart','mute','kick'].includes(String(v.kind||''))) return {ok:false,error:'bad_vote'}; return this.startVote(v.kind,v.value,'ADMIN'); }
      case 'say': { const msg=String(value||'').replace(/[<>]/g,'').slice(0,160); if(msg) this.broadcast('msg',{text:msg,sub:'ADMIN'}); return {ok:true}; }
      default: return {ok:false,error:'bad_action'};
    }
  }
  handle(id, ev, d, ack) {
    const p = this.players.get(id); if (!p) return;
    switch (ev) {
      case 'st': return this.handleState(p, d);
      case 'shot': if (d && Array.isArray(d.d)) this.fire(p, Array.isArray(d.o) ? d.o.map(Number) : null, d.d.map(Number), Number(d.t), String(d.w), !!d.alt); return;
      case 'buy': { const r = this.buy(p, String(d && d.item)); if (ack) ack(r); return; }
      case 'reload': return this.reload(p);
      case 'sw': return this.switchSlot(p, d && d.slot | 0, d && typeof d.k === 'string' ? d.k : null);
      case 'throw': this.throwNade(p, d && Array.isArray(d.d) ? d.d.map(Number) : null, !(d && d.soft)); return;
      case 'drop': return this.dropActive(p);
      case 'use': return this.use(p);
      case 'unuse': return this.unuse(p);
      case 'team': { const r = this.setTeam(id, String(d && d.team)); if (ack) ack(r); return; }
      case 'chat': {
        const msg = String(d && d.msg || '').replace(/[<>]/g, '').slice(0, 120).trim(); if (!msg) return;
        if (this.moderation?.mutes?.[String(p.name).toLowerCase()]) return; const pkt = { id, name: p.name, team: p.team, msg, teamOnly: !!(d && d.team), dead: !p.alive, chatColor:'gold' };
        if (pkt.teamOnly) this.teamcast(p.team, 'chat', pkt); else this.broadcast('chat', pkt); return;
      }
      case 'pingv': p.ping = clamp(d | 0, 0, 999); return;
      case 'vote': { const kind=String(d?.kind||''); if(!['restart','mute','kick'].includes(kind)) { ack?.({ok:false,error:'bad_vote'}); return; } const r=this.startVote(kind,d?.value,p.name); ack?.(r); return; }
      case 'vote:cast': return ack?.(this.castVote(p.id, !!d?.yes));
    }
  }
  // ---------- main loop ----------
  tick() {
    const now = Date.now(); const dt = clamp((now - this.last) / 1000, 0.001, 0.1); this.last = now;
    for (const p of [...this.players.values()]) if (p.dc && now - p.dc > 30000) this.removePlayer(p.id);
    if (!this.players.size) return;
    if (this.phase === 'warmup') {
      if (this.bothTeams() && this.humans().some((p) => p.team !== 'SPEC')) {
        if (!this.matchStartAt) { this.matchStartAt = now + 4000; this.broadcast('msg', { text: 'Match is starting', sub: 'Get ready' }); }
        else if (now >= this.matchStartAt) this.startMatch();
      } else this.matchStartAt = 0;
      for (const p of this.players.values()) if (!p.alive && p.team !== 'SPEC' && now - p.deadAt > ROUND.warmupRespawn * 1000) this.spawn(p);
    } else if (this.phase === 'freeze' && now >= this.phaseEnd) { this.phase = 'live'; this.liveStart = now; this.phaseEnd = now + ROUND.live * 1000; this.emitRound(); }
    else if (this.phase === 'live' && now >= this.phaseEnd) this.endRound('CT', 'time');
    else if (this.phase === 'planted' && now >= this.bomb.explodeAt) this.explode();
    else if (this.phase === 'over' && now >= this.phaseEnd) { if (this.matchOver) this.startMatch('New match'); else this.startRound(); }

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.active === 4 && !(p.gk && p.g[p.gk] > 0)) { const nx = firstNade(p.g, p.gk); if (nx) p.gk = nx; else { p.gk = null; p.active = this.bestSlot(p); } p.youDirty = true; }
      if (p.reloadEnd && now >= p.reloadEnd) { const it = p.w[p.active]; if (it) { const w = WEAPONS[it.k]; const take = Math.min(w.mag - it.mag, it.res); it.mag += take; it.res -= take; } p.reloadEnd = 0; p.youDirty = true; }
      if (p.action) {
        const a = p.action;
        if (a.type === 'plant') p.crouch = true;
        const moved = Math.hypot(p.x - a.x, p.z - a.z) > 0.6;
        if (moved || (a.type === 'plant' && (this.phase !== 'live' || !p.hasBomb)) || (a.type === 'defuse' && this.phase !== 'planted')) this.unuse(p);
        else if (now >= a.end) { if (a.type === 'plant') this.plant(p); else this.defuse(p); }
      }
      if (p.bot) {
        botThink(this, p, dt, now);
        p.hist.push({ t: now, x: p.x, y: p.y, z: p.z, c: p.crouch }); while (p.hist.length > 25) p.hist.shift();
      }
      // auto pick-ups
      {
        for (const d of this.drops.values()) {
          if (Math.hypot(d.x - p.x, d.z - p.z) < 1.0 && Math.abs(d.y - p.y) < 1.6 && !p.w[WEAPONS[d.k].slot] && (d.owner !== p.id || now - d.t > 2000)) { this.takeDrop(p, d); break; }
        }
        const b = this.bomb;
        if (b.state === 'dropped' && p.team === 'T' && Math.hypot(b.x - p.x, b.z - p.z) < 1.1 && Math.abs(b.y - p.y) < 1.6 && now - b.t > 600) {
          p.hasBomb = true; this.bomb = { state: 'carried', carrier: p.id }; this.broadcast('bomb', this.bombPublic()); p.youDirty = true; this.rosterDirty = true;
        }
      }
    }
    for (const n of [...this.nades.values()]) this.stepNade(n, dt, now);
    if (this.smokes.length) {
      let changedSmoke = false;
      for (const s of this.smokes) {
        const before = (s.holes || []).length;
        if (before) s.holes = s.holes.filter((h) => now < h.end);
        if (before !== (s.holes || []).length) changedSmoke = true;
      }
      const liveSmokes = this.smokes.filter((s) => now < s.end);
      if (liveSmokes.length !== this.smokes.length) changedSmoke = true;
      this.smokes = liveSmokes;
      if (changedSmoke) this.broadcast('smokes', this.smokes);
    }
    if (this.bomb.state === 'carried') { const c = this.players.get(this.bomb.carrier); if (!c || !c.alive || !c.hasBomb) { this.bomb = { state: 'none' }; } }
    // snapshot
    const snap = [];
    for (const p of this.players.values()) {
      if (p.team === 'SPEC') continue;
      const fl = (p.alive ? 1 : 0) | (p.crouch ? 2 : 0) | (p.onGround ? 4 : 0) | (p.hasBomb ? 8 : 0) | (p.action ? 16 : 0) | (p.scoped ? 32 : 0) | (p.reloadEnd ? 64 : 0);
      const it = p.active === 5 ? { k: 'c4' } : p.active === 4 ? { k: p.gk || 'he' } : p.w[p.active];
      snap.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), fl, WEAPON_KEYS.indexOf(it ? it.k : 'knife'), p.alive ? p.hp : 0]);
    }
    this.broadcast('snap', { t: now, p: snap, n: [...this.nades.values()].map((n) => [n.id, WEAPON_KEYS.indexOf(n.k), r2(n.x), r2(n.y), r2(n.z)]) });
    for (const p of this.players.values()) if (p.youDirty && !p.bot) { p.youDirty = false; this.send(p.id, 'you', this.youPayload(p)); }
    if (this.rosterDirty && now - this.lastRoster > 400) { this.rosterDirty = false; this.lastRoster = now; this.broadcast('roster', this.roster()); }
  }
  youPayload(p) {
    return { xp:p.rankXp, rank:p.rankName, rankTag:p.rankTag, hp: p.hp, ar: Math.round(p.armor), hm: p.helmet, kit: p.kit, money: p.money, w: { 1: p.w[1], 2: p.w[2], 3: p.w[3] }, g: { ...p.g }, gk: p.gk, a: p.active, b: p.hasBomb, al: p.alive, tm: p.team,
      rl: p.reloadEnd ? p.reloadEnd - Date.now() : 0, nc: !!p.noclip, god: !!p.god, act: p.action ? { type: p.action.type, end: p.action.end } : null, x: p.x, z: p.z };
  }
}
export { calloutAt };
