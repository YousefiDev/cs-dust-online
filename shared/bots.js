// Server-side bots: perception (FOV + line of sight + hearing), reaction time, aim error, objectives, economy.
import { PHYS, angDiff, clamp, forward } from './constants.js';
import { WEAPONS, inaccuracy } from './weapons.js';
import { hasLOS, stepMove } from './physics.js';
import { field, rectCells, pointField, nextWaypoint } from './nav.js';
import { inRect, siteAt } from './maps.js';

const DIFF = {
  easy:   { react: 0.6, err: 0.16, settle: 2.0, turn: 3.2, hs: 0.12, fireTol: 0.07, burst: 3 },
  normal: { react: 0.38, err: 0.09, settle: 3.2, turn: 5.5, hs: 0.28, fireTol: 0.05, burst: 5 },
  hard:   { react: 0.24, err: 0.045, settle: 5.0, turn: 8.5, hs: 0.5, fireTol: 0.035, burst: 7 },
};
export const newBrain = () => ({ target: null, visible: false, reactAt: 0, errY: 0, errP: 0, head: false, nextScan: 0, lastSeen: null, hurtBy: null, hurtAt: 0,
  goal: null, via: [], hold: null, sweep: Math.random() * 6, strafe: 1, strafeAt: 0, burst: 0, pauseUntil: 0, stuckAt: 0, stuckX: 0, stuckZ: 0, unstuckUntil: 0, unstuckDir: 0, role: null, waitUntil: 0, blindUntil: 0, throwAt: 0, throwAim: null });

export function botRoundStart(room) {
  const def = room.map.def, sites = Object.keys(def.sites);
  const site = sites[Math.floor(Math.random() * sites.length)]; const routes = def.routes[site] || [[]];
  room.tPlan = { site, routes };
  const cts = room.team('CT').filter((p) => p.bot); const plan = ['A', 'B', 'A', 'B', 'MID', 'A', 'B', 'MID'];
  cts.forEach((p, i) => { p.ai.role = plan[i % plan.length]; const hs = def.holds[p.ai.role] || def.holds.A; p.ai.hold = hs[Math.floor(Math.random() * hs.length)]; p.ai.waitUntil = Date.now() + 6000 + Math.random() * 2500; });
  room.team('T').filter((p) => p.bot).forEach((p, i) => { const r = routes[i % routes.length]; p.ai.via = r.map((v) => [...v]); p.ai.role = site; p.ai.waitUntil = Date.now() + 6000 + Math.random() * 3000; });
}
export function botBuy(room, p) {
  const m = () => p.money, T = p.team === 'T', pistolRound = room.round === 1 || room.round === 13;
  const buy = (k) => room.buy(p, k).ok;
  if (pistolRound) { if (m() >= 650 && Math.random() < 0.6) buy('vest'); else if (m() >= 700 && Math.random() < 0.4) buy('deagle'); return; }
  if (!p.w[1]) {
    const awpTaken = room.team(p.team).some((q) => q !== p && q.w[1] && q.w[1].k === 'awp');
    if (m() >= 5750 && !awpTaken && Math.random() < 0.3) buy('awp');
    else if (T ? m() >= 3700 : m() >= 4100) buy(T ? (Math.random() < 0.15 ? 'sg553' : 'ak47') : (Math.random() < 0.45 ? 'm4a1s' : Math.random() < 0.2 ? 'aug' : 'm4a4'));
    else if (m() >= (T ? 2700 : 3100) + 650 && Math.random() < 0.7) buy(T ? 'ak47' : 'm4a4');
    else if (m() >= (T ? 1800 : 2050) + 650 && Math.random() < 0.6) buy(T ? 'galil' : 'famas');
    else if (m() >= 2350 && Math.random() < 0.25) buy('p90');
    else if (m() >= 2000 && Math.random() < 0.6) buy(T ? 'mac10' : 'mp9');
  }
  if (m() >= 1000 && !(p.armor >= 100 && p.helmet)) buy('vesthelm'); else if (m() >= 650 && p.armor < 100) buy('vest');
  if (!T && m() >= 400 && Math.random() < 0.6) buy('kit');
  if (m() >= 300 && Math.random() < 0.45) buy('he');
  if (!p.w[1] && m() >= 700 && Math.random() < 0.5) buy('deagle');
}
const eyeOf = (p) => [p.x, p.y + (p.crouch ? PHYS.crouchEye : PHYS.eye), p.z];
function scan(room, p, ai, now, prof) {
  const e = eyeOf(p); let best = null, bd = 1e9;
  // Engagement range depends on the weapon in hand, so pistol bots no longer freeze in 80 m standoffs.
  const it = p.w[p.active], wk = it ? it.k : 'knife', wd = WEAPONS[wk] || {};
  const reach = wk === 'awp' ? 90 : wd.scope ? 75 : wd.slot === 1 && wd.rpm < 700 ? 65 : wd.slot === 1 ? 42 : wd.slot === 2 ? 38 : 28;
  for (const q of room.players.values()) {
    if (!q.alive || q.team === p.team || q.team === 'SPEC') continue;
    const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz); if (d > reach && !(ai.hurtBy === q.id && now - ai.hurtAt < 1500)) continue;
    const ang = Math.abs(angDiff(p.yaw, Math.atan2(-dx, -dz)));
    const heard = (now - q.lastShot < 1200 && d < 45) || (ai.hurtBy === q.id && now - ai.hurtAt < 1500);
    if (ang > 1.25 && !heard && d > 3) continue;
    const head = [q.x, q.y + (q.crouch ? 1.15 : 1.62), q.z], chest = [q.x, q.y + (q.crouch ? 0.85 : 1.2), q.z];
    if (!hasLOS(room.map, e, head) && !hasLOS(room.map, e, chest)) continue;
    if (room.smokes.length && room.smokeBlocks(e, head) && room.smokeBlocks(e, chest) && d > 2.5) continue;
    const score = d + (ang > 1.25 ? 25 : 0) + (ai.target === q.id ? -8 : 0);
    if (score < bd) { bd = score; best = q; }
  }
  if (best) {
    if (ai.target !== best.id || !ai.visible) {
      const fov = Math.abs(angDiff(p.yaw, Math.atan2(-(best.x - p.x), -(best.z - p.z)))) < 1.25;
      const still = Math.hypot(p.vx, p.vz) < 1.5, tgtMoving = Math.hypot(best.vx || 0, best.vz || 0) > 2 || (best.speed || 0) > 2;
      const hold = (still ? 0.65 : 1.2) * (tgtMoving ? 0.9 : 1.1);
      ai.reactAt = now + prof.react * 1000 * (0.7 + Math.random() * 0.6) * (fov ? 1 : 1.5) * hold + (ai.target === best.id ? -150 : 0);
      ai.errY = (Math.random() - 0.5) * 2 * prof.err * (fov ? 1 : 2) * (still ? 0.75 : 1.15); ai.errP = (Math.random() - 0.5) * prof.err; ai.head = Math.random() < prof.hs; ai.burst = 0;
    }
    ai.target = best.id; ai.visible = true; ai.lastSeen = { x: best.x, z: best.z, t: now };
  } else ai.visible = false;
}
function turnTo(p, yaw, pitch, rate, dt) {
  const dy = angDiff(p.yaw, yaw), dp = pitch - p.pitch, step = rate * dt;
  p.yaw += clamp(dy, -step, step); p.pitch += clamp(dp, -step, step);
  if (p.yaw > Math.PI) p.yaw -= Math.PI * 2; if (p.yaw < -Math.PI) p.yaw += Math.PI * 2;
}
function goalField(room, p, ai, now) {
  const nav = room.nav, def = room.map.def, b = room.bomb;
  if (room.phase === 'warmup') return { f: field(nav, 'buy' + (p.team === 'T' ? 'CT' : 'T'), rectCells(nav, def.buy[p.team === 'T' ? 'CT' : 'T'])) };
  if (p.team === 'T') {
    if (b.state === 'planted') return { f: pointField(nav, b.x, b.z, 3), hold: true, look: [b.x, b.z], guard: true };
    if (b.state === 'dropped') { const ts = room.team('T').filter((q) => q.alive && q.bot); const near = ts.sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))[0]; if (near === p) return { f: pointField(nav, b.x, b.z, 0) }; }
    if (ai.via.length) { const v = ai.via[0]; if (Math.hypot(p.x - v[0], p.z - v[1]) < 3) ai.via.shift(); else return { f: pointField(nav, v[0], v[1], 1) }; }
    const site = room.tPlan.site, r = def.sites[site];
    if (p.hasBomb) return { f: field(nav, 'site' + site, rectCells(nav, [r[0] + 4, r[1] + 4, r[2] - 4, r[3] - 4])), plant: true };
    if (!ai.hold || ai.hold.site !== site) { const hs = def.holds[site]; const h = hs[Math.floor(Math.random() * hs.length)]; ai.hold = { site, x: h[0] + (Math.random() - 0.5) * 4, z: h[1] + (Math.random() - 0.5) * 4, lx: h[2], lz: h[3] - 30 }; }
    return { f: pointField(nav, ai.hold.x, ai.hold.z, 1), hold: true, look: [def.buy.CT[0] + 12, def.buy.CT[1] + 8] };
  }
  if (b.state === 'planted') return { f: pointField(nav, b.x, b.z, 0), defuse: true };
  const h = ai.hold || def.holds.A[0];
  return { f: pointField(nav, h[0], h[1], 1), hold: true, look: [h[2], h[3]] };
}
export function botThink(room, p, dt, now) {
  const ai = p.ai, prof = DIFF[room.difficulty] || DIFF.normal; const item = p.w[p.active]; const wk = p.active === 5 ? 'c4' : item ? item.k : 'knife'; const w = WEAPONS[wk];
  let wx = 0, wz = 0, jump = false, crouch = false, walk = false;
  const speed = (w && w.speed) || 6.35;
  if (room.phase === 'freeze') { stepMove(room.map, p, { wx: 0, wz: 0, speed }, dt); return; }
  if (ai.throwAt) {
    if (p.active !== 4) { ai.throwAt = 0; }
    else if (now >= ai.throwAt) {
      const a = ai.throwAim, dx = a[0] - p.x, dz = a[1] - p.z, hd = Math.hypot(dx, dz), v = 15.5;
      const pitch = clamp(0.5 * Math.asin(clamp(20 * hd / (v * v), 0, 1)) - 0.12, -0.1, 0.75), yaw = Math.atan2(-dx, -dz);
      p.yaw = yaw; p.pitch = pitch; room.throwNade(p, forward(yaw, pitch)); ai.throwAt = 0;
    } else { stepMove(room.map, p, { wx: 0, wz: 0, speed }, dt); return; }
  }
  if (p.active === 4 && !ai.throwAt) { if (p.w[1]) room.switchSlot(p, 1); else if (p.w[2]) room.switchSlot(p, 2); else room.switchSlot(p, 3); }
  if (now < ai.blindUntil) { ai.visible = false; }
  else if (now >= ai.nextScan) { ai.nextScan = now + 90 + Math.random() * 40; scan(room, p, ai, now, prof); }
  const tgt = ai.target ? room.players.get(ai.target) : null;
  if (p.active === 3 && p.w[1]) room.switchSlot(p, 1); else if (p.active === 3 && p.w[2] && p.w[2].mag + p.w[2].res > 0) room.switchSlot(p, 2);
  if (p.active === 1 && item && item.mag === 0 && item.res === 0 && p.w[2]) room.switchSlot(p, 2);
  if (tgt && tgt.alive && ai.visible) {
    const e = eyeOf(p); const aimY = tgt.y + (ai.head ? (tgt.crouch ? 1.12 : 1.6) : (tgt.crouch ? 0.8 : 1.15));
    const dx = tgt.x - e[0], dz = tgt.z - e[2], dy = aimY - e[1], hd = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz) + ai.errY, pitch = Math.atan2(dy, hd) + ai.errP;
    ai.errY *= Math.exp(-dt * prof.settle); ai.errP *= Math.exp(-dt * prof.settle);
    turnTo(p, yaw, pitch, prof.turn, dt);
    const err = Math.hypot(angDiff(p.yaw, yaw - ai.errY), p.pitch - (pitch - ai.errP));
    if (p.action) room.unuse(p);
    if (w && w.melee) { wx = dx; wz = dz; } // knife: rush
    else if (hd < 10 || wk === 'deagle') { if (now > ai.strafeAt) { ai.strafe = -ai.strafe; ai.strafeAt = now + 350 + Math.random() * 500; } const f = forward(p.yaw, 0); wx = -f[2] * ai.strafe; wz = f[0] * ai.strafe; if (ai.burst > 2) { wx = wz = 0; } }
    if (hd > 18 && w && !w.melee && Math.random() < 0.002) crouch = true;
    if (p.g && p.g.he > 0 && hd > 9 && hd < 24 && now >= ai.reactAt && Math.random() < 0.012) { room.switchSlot(p, 4, 'he'); if (p.active === 4) { ai.throwAt = now + 650; ai.throwAim = [tgt.x, tgt.z]; } }
    const tol = Math.max(prof.fireTol, 0.6 / Math.max(1, hd));
    const ready = now >= ai.reactAt && now >= ai.pauseUntil && err < tol;
    if (ready && w && !w.melee && item && item.mag > 0) {
      const sp = Math.hypot(p.vx, p.vz); if (sp > speed * 0.4 && hd > 10) { wx = wz = 0; }
      else {
        const s = inaccuracy(w, { speed: sp, grounded: p.onGround, crouch: p.crouch, shots: p.shots + 1, scoped: wk === 'awp' });
        const a = Math.random() * Math.PI * 2, r = s * Math.random(), f = forward(p.yaw + Math.cos(a) * r, p.pitch + Math.sin(a) * r);
        if (room.fire(p, e, f, now, wk)) {
          p.pitch += (w.kick || 0) * 0.35; ai.burst++;
          const burstMax = hd > 25 ? 2 : hd > 12 ? prof.burst - 2 : prof.burst + 6;
          if (!w.auto || ai.burst >= burstMax) { ai.burst = 0; ai.pauseUntil = now + (w.auto ? 220 + Math.random() * 200 : 60000 / w.rpm + 60 + Math.random() * 150); }
        }
      }
    } else if (ready && w && w.melee && hd < 1.9) room.fire(p, e, forward(p.yaw, p.pitch), now, wk);
    if (item && item.mag === 0 && !w.melee) room.reload(p);
  } else {
    if (ai.visible === false && tgt && ai.lastSeen && now - ai.lastSeen.t > 2500) ai.target = null;
    const g = goalField(room, p, ai, now);
    let lookYaw = null;
    if (ai.hurtBy && now - ai.hurtAt < 1200) { const a = room.players.get(ai.hurtBy); if (a) lookYaw = Math.atan2(-(a.x - p.x), -(a.z - p.z)); }
    const chase = ai.lastSeen && now - ai.lastSeen.t < 4000 && !(g.defuse) && !(g.plant && siteAt(room.map, p.x, p.z));
    const fld = chase ? pointField(room.nav, ai.lastSeen.x, ai.lastSeen.z, 1) : g.f;
    const wp = fld ? nextWaypoint(room.nav, fld, p.x, p.z, 4) : null;
    const atSite = g.plant && siteAt(room.map, p.x, p.z) === room.tPlan.site;
    const waiting = now < ai.waitUntil && room.phase === 'live' && now - room.liveStart < 15000 && g.hold && !chase;
    if (g.plant && atSite && p.onGround && (!wp || wp.done)) { if (!p.action) room.use(p); }
    else if (g.plant && atSite && !p.action && Math.random() < 0.05) room.use(p);
    if (p.action) { wx = wz = 0; crouch = true; }
    else if (g.defuse && Math.hypot(p.x - room.bomb.x, p.z - room.bomb.z) < 1.5) { room.use(p); wx = wz = 0; crouch = true; }
    else if (wp && !(wp.done && g.hold) && !(waiting && false)) {
      wx = wp.x - p.x; wz = wp.z - p.z; if (Math.hypot(wx, wz) < 0.15) { wx = wz = 0; }
      walk = chase && ai.lastSeen && Math.hypot(ai.lastSeen.x - p.x, ai.lastSeen.z - p.z) < 14;
      if (Math.hypot(wx, wz) > 0.1) lookYaw = lookYaw ?? Math.atan2(-wx, -wz);
    } else if (g.look) {
      ai.sweep += dt * 0.6; lookYaw = lookYaw ?? Math.atan2(-(g.look[0] - p.x), -(g.look[1] - p.z)) + Math.sin(ai.sweep) * 0.45;
    }
    if (lookYaw !== null) turnTo(p, lookYaw, 0, prof.turn * 0.7, dt);
    if (item && !w.melee && WEAPONS[item.k].mag && item.mag < WEAPONS[item.k].mag * 0.5 && item.res > 0 && !p.reloadEnd && (!ai.lastSeen || now - ai.lastSeen.t > 1500)) room.reload(p);
  }
  // unstuck
  const moving = Math.hypot(wx, wz) > 0.1;
  if (now > ai.stuckAt) {
    if (moving && Math.hypot(p.x - ai.stuckX, p.z - ai.stuckZ) < 0.35) { ai.unstuckUntil = now + 600; ai.unstuckDir = Math.random() < 0.5 ? 1 : -1; jump = Math.random() < 0.5; }
    ai.stuckAt = now + 900; ai.stuckX = p.x; ai.stuckZ = p.z;
  }
  if (now < ai.unstuckUntil && moving) { const l = Math.hypot(wx, wz); const px = -wz / l * ai.unstuckDir, pz = wx / l * ai.unstuckDir; wx = wx / l * 0.3 + px; wz = wz / l * 0.3 + pz; }
  stepMove(room.map, p, { wx, wz, jump: jump && p.onGround, crouch, walk, speed: wk === 'awp' && p.scoped ? 2.5 : speed }, dt);
}
