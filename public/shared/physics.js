// Grid heightfield physics + raycasts shared by the client (local player) and the server (bots, validation, hits).
import { WALL, WALL_TOP, PHYS, clamp } from './constants.js';

export function heightAt(m, x, z) {
  const cx = Math.floor(x), cz = Math.floor(z);
  if (cx < 0 || cz < 0 || cx >= m.W || cz >= m.H) return WALL;
  const i = cz * m.W + cx, r = m.rampIdx[i];
  if (r >= 0) { const R = m.ramps[r]; const t = R.axis === 'x' ? (x - R.x0) / (R.x1 - R.x0) : (z - R.z0) / (R.z1 - R.z0); return R.h0 + (R.h1 - R.h0) * clamp(t, 0, 1); }
  return m.heights[i];
}
export function ceilAt(m, x, z) {
  const cx = Math.floor(x), cz = Math.floor(z);
  if (cx < 0 || cz < 0 || cx >= m.W || cz >= m.H) return -1e9;
  return m.ceil[cz * m.W + cx];
}
const PTS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
export function groundAt(m, x, z, r = PHYS.radius) { let h = -1e9; for (const [a, b] of PTS) { const v = heightAt(m, x + a * r, z + b * r); if (v > h) h = v; } return h; }
function ceilMin(m, x, z, r) { let c = 1e9; for (const [a, b] of PTS) { const v = ceilAt(m, x + a * r, z + b * r); if (v < c) c = v; } return c; }
export function canOccupy(m, x, z, feet, height, r = PHYS.radius) {
  for (const [a, b] of PTS) {
    const px = x + a * r, pz = z + b * r;
    if (heightAt(m, px, pz) > feet + PHYS.step) return false;
    if (ceilAt(m, px, pz) < feet + height - 0.02) return false;
  }
  return true;
}
// Advance a character. s: {x,y,z,vx,vy,vz,onGround,crouch}; inp: {wx,wz (world wish dir), jump, crouch, walk, speed}
export function stepMove(m, s, inp, dt) {
  const wantCrouch = !!inp.crouch;
  if (!wantCrouch && s.crouch && ceilMin(m, s.x, s.z, PHYS.radius) < s.y + PHYS.height) s.crouch = true; else s.crouch = wantCrouch;
  const height = s.crouch ? PHYS.crouchHeight : PHYS.height;
  let wl = Math.hypot(inp.wx || 0, inp.wz || 0); const wx = wl > 0 ? inp.wx / wl : 0, wz = wl > 0 ? inp.wz / wl : 0;
  const maxSpeed = (inp.speed || 6.35) * (s.crouch ? 0.34 : inp.walk ? 0.52 : 1) * (wl > 0 ? 1 : 0);
  if (s.onGround) {
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > 0) { const drop = Math.max(sp, 1.6) * PHYS.friction * dt; const ns = Math.max(0, sp - drop) / sp; s.vx *= ns; s.vz *= ns; }
    const cur = s.vx * wx + s.vz * wz, add = maxSpeed - cur;
    if (add > 0) { const a = Math.min(add, PHYS.accel * maxSpeed * dt); s.vx += wx * a; s.vz += wz * a; }
    if (inp.jump) { s.vy = PHYS.jumpV; s.onGround = false; }
  } else {
    const ws = Math.min(maxSpeed, PHYS.airCap), cur = s.vx * wx + s.vz * wz, add = ws - cur;
    if (add > 0) { const a = Math.min(add, PHYS.airAccel * maxSpeed * dt); s.vx += wx * a; s.vz += wz * a; }
  }
  const dist = Math.hypot(s.vx, s.vz) * dt, n = Math.max(1, Math.ceil(dist / 0.2));
  for (let k = 0; k < n; k++) {
    const nx = s.x + (s.vx * dt) / n; if (canOccupy(m, nx, s.z, s.y, height)) s.x = nx; else s.vx = 0;
    const nz = s.z + (s.vz * dt) / n; if (canOccupy(m, s.x, nz, s.y, height)) s.z = nz; else s.vz = 0;
  }
  const g = groundAt(m, s.x, s.z);
  if (s.onGround) {
    if (g >= s.y - 0.6 && g <= s.y + PHYS.step + 0.01) s.y = g; else s.onGround = false;
  }
  if (!s.onGround) {
    s.vy -= PHYS.gravity * dt; s.y += s.vy * dt;
    if (s.y <= g) { s.y = g; s.vy = 0; s.onGround = true; s.landed = true; }
  }
  const c = ceilMin(m, s.x, s.z, PHYS.radius);
  if (s.y + height > c) { s.y = Math.max(g, c - height); if (s.vy > 0) s.vy = 0; }
  return s;
}
function cellTop(m, cx, cz) {
  const i = cz * m.W + cx, h = m.heights[i];
  return h >= WALL ? WALL_TOP : h;
}
// Ray vs world. Returns {t, n:[x,y,z]} where t = maxDist if nothing hit.
export function rayWorld(m, o, d, maxDist) {
  let cx = Math.floor(o[0]), cz = Math.floor(o[2]);
  const sx = d[0] > 0 ? 1 : -1, sz = d[2] > 0 ? 1 : -1;
  const tdx = d[0] !== 0 ? Math.abs(1 / d[0]) : Infinity, tdz = d[2] !== 0 ? Math.abs(1 / d[2]) : Infinity;
  let tmx = d[0] !== 0 ? ((cx + (d[0] > 0 ? 1 : 0)) - o[0]) / d[0] : Infinity;
  let tmz = d[2] !== 0 ? ((cz + (d[2] > 0 ? 1 : 0)) - o[2]) / d[2] : Infinity;
  let t = 0, axis = -1;
  for (let it = 0; it < 512; it++) {
    if (cx < 0 || cz < 0 || cx >= m.W || cz >= m.H) return { t, n: axis === 0 ? [-sx, 0, 0] : [0, 0, -sz] };
    const tn = Math.min(tmx, tmz, maxDist), top = cellTop(m, cx, cz), cl = m.ceil[cz * m.W + cx];
    const y0 = o[1] + d[1] * t, y1 = o[1] + d[1] * tn;
    if (t > 0 && (y0 < top - 1e-4 || y0 > cl + 1e-4)) return { t, n: axis === 0 ? [-sx, 0, 0] : [0, 0, -sz] };
    if (y1 < top && d[1] < 0) { const th = (top - o[1]) / d[1]; if (th >= t - 1e-6) return { t: Math.max(t, th), n: [0, 1, 0] }; }
    if (y1 > cl && d[1] > 0) { const th = (cl - o[1]) / d[1]; if (th >= t - 1e-6) return { t: Math.max(t, th), n: [0, -1, 0] }; }
    if (tn >= maxDist) return { t: maxDist, n: null };
    if (tmx < tmz) { t = tmx; tmx += tdx; cx += sx; axis = 0; } else { t = tmz; tmz += tdz; cz += sz; axis = 2; }
  }
  return { t: maxDist, n: null };
}
export function hasLOS(m, a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]);
  if (L < 1e-3) return true; d[0] /= L; d[1] /= L; d[2] /= L;
  return rayWorld(m, a, d, L).t >= L - 0.05;
}
// Hitboxes: head sphere + body cylinder. p: {x,y,z,crouch}
export function hitShape(p) {
  const H = p.crouch ? PHYS.crouchHeight : PHYS.height;
  // Match the visible character head more closely. The old 0.17m sphere
  // was too small/high, so shots aimed at the forehead could fall through
  // to the neck/upper body.
  const hr = p.crouch ? 0.18 : 0.20;
  return { H, hy: p.y + H - 0.13, hr, top: p.y + H - 0.34, r: 0.27 };
}
export function rayPlayer(o, d, p, maxT) {
  const s = hitShape(p); let best = null;
  // head
  const ox = o[0] - p.x, oy = o[1] - s.hy, oz = o[2] - p.z;
  const b = ox * d[0] + oy * d[1] + oz * d[2], c = ox * ox + oy * oy + oz * oz - s.hr * s.hr, disc = b * b - c;
  if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < maxT) best = { t, part: 'head' }; }
  // body cylinder (vertical)
  const a2 = d[0] * d[0] + d[2] * d[2];
  if (a2 > 1e-8) {
    const bx = o[0] - p.x, bz = o[2] - p.z, bb = bx * d[0] + bz * d[2], cc = bx * bx + bz * bz - s.r * s.r, dd = bb * bb - a2 * cc;
    if (dd >= 0) {
      const t = (-bb - Math.sqrt(dd)) / a2, y = o[1] + d[1] * t;
      if (t > 0 && t < maxT && y >= p.y && y <= s.top && (!best || t < best.t)) {
        const f = (y - p.y) / s.H; best = { t, part: f > 0.6 ? 'chest' : f > 0.45 ? 'stomach' : 'legs' };
      }
    }
  }
  if (d[1] < 0) { // through the shoulders from above
    const t = (s.top - o[1]) / d[1];
    if (t > 0 && t < maxT && (!best || t < best.t)) { const x = o[0] + d[0] * t - p.x, z = o[2] + d[2] * t - p.z; if (x * x + z * z <= s.r * s.r) best = { t, part: 'chest' }; }
  }
  return best;
}
