'use strict';
/**
 * gamegrid.js — تبدیل مش سه‌بعدی به «تعریف نقشه»ی خود بازی (heightfield شبکه‌ای ۱ متری)
 *
 * بازی فیزیک/بات/تیراندازی را روی یک شبکه‌ی ۱×۱ متری با ارتفاع کف و سقف هر خانه انجام می‌دهد.
 * این ماژول مش را voxel می‌کند (۰.۲۵ متر)، از هر خانه‌ی ۱ متری «کف قابل‌ایستادن، سقف و دیوار» را درمی‌آورد
 * و خروجی را به همان قالبی می‌دهد که buildMap() در shared/maps.js می‌فهمد (فیلد grid).
 */
const WALL = 99;          // باید با shared/constants.js یکی باشد
const STEP = 0.55;        // PHYS.step
const HEIGHT = 1.8;       // PHYS.height
const NONE = 32767;       // مقدار «دیوار / بدون سقف» در grid فشرده

// ───────────────────────── voxelization ─────────────────────────
// geoms: [{P: Float64Array(local), I: Uint32Array, inst:[{M}]}] — M ستون‌به‌ستون 4x4 و مختصات نهایی (گوشه‌ی مپ در 0,0,0)
function voxelize(geoms, W, H, ymax, vs, vsy, log) {
  const nx = Math.ceil(W / vs), nz = Math.ceil(H / vs), ny = Math.ceil(ymax / vsy) + 2;
  const total = nx * nz * ny;
  if (total > 1.6e9) throw new Error(`شبکه‌ی voxel خیلی بزرگ است (${total}); --voxel را بزرگ‌تر کن (مثلاً 0.5)`);
  const flags = new Uint8Array(total);
  const ds = Math.min(vs, vsy) * 0.8;
  let tris = 0;
  for (const g of geoms) {
    const P = g.P, I = g.I, nv = P.length / 3;
    const T = new Float64Array(nv * 3);
    for (const it of g.inst) {
      const M = it.M;
      const det = M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);
      const sgn = det < 0 ? -1 : 1;
      for (let i = 0; i < nv; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        T[i * 3] = M[0] * x + M[4] * y + M[8] * z + M[12];
        T[i * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
        T[i * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
      }
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const ax = T[a], ay = T[a + 1], az = T[a + 2];
        const ux = T[b] - ax, uy = T[b + 1] - ay, uz = T[b + 2] - az;
        const vx = T[c] - ax, vy = T[c + 1] - ay, vz = T[c + 2] - az;
        let nxn = uy * vz - uz * vy, nyn = uz * vx - ux * vz, nzn = ux * vy - uy * vx;
        const len = Math.hypot(nxn, nyn, nzn);
        if (len < 1e-10) continue;
        const up = (nyn * sgn) / len > 0.7 ? 1 : 2;
        const e1 = Math.hypot(ux, uy, uz), e2 = Math.hypot(vx, vy, vz), e3 = Math.hypot(vx - ux, vy - uy, vz - uz);
        const n = Math.max(1, Math.ceil(Math.max(e1, e2, e3) / ds));
        for (let i = 0; i <= n; i++) {
          for (let j = 0; j <= n - i; j++) {
            const px = ax + (ux * i + vx * j) / n, py = ay + (uy * i + vy * j) / n, pz = az + (uz * i + vz * j) / n;
            const ix = Math.floor(px / vs), iy = Math.floor(py / vsy), iz = Math.floor(pz / vs);
            if (ix < 0 || iz < 0 || iy < 0 || ix >= nx || iz >= nz || iy >= ny) continue;
            flags[(iz * nx + ix) * ny + iy] |= up;
          }
        }
        tris++;
      }
    }
  }
  if (log) log(`  voxel: ${nx}×${nz}×${ny}، ${tris.toLocaleString()} مثلث پردازش شد`);
  return { flags, nx, nz, ny, vs, vsy };
}

// ───────────────────────── columns → game cells ─────────────────────────
function columnsToCells(vox, W, H) {
  const { flags, nx, nz, ny, vs, vsy } = vox;
  const per = Math.round(1 / vs);                     // ستون‌های ریز در هر خانه (۴)
  const floor = new Float32Array(W * H).fill(NaN), ceil = new Float32Array(W * H).fill(1e9);
  const head = Math.ceil(HEIGHT / vsy);               // ~۱۸ لایه (۰.۱ متری)
  const skip = Math.max(2, Math.round(0.2 / vsy));    // ضخامت خود کف را نادیده بگیر
  const fl = new Float32Array(per * per), cl = new Float32Array(per * per);
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    let nvalid = 0;
    for (let dz = 0; dz < per; dz++) for (let dx = 0; dx < per; dx++) {
      const ix = cx * per + dx, iz = cz * per + dz;
      if (ix >= nx || iz >= nz) continue;
      const base = (iz * nx + ix) * ny;
      let lowFail = -1;                                     // پایین‌ترین کفی که سرش بسته بود (دیوار/جعبه)
      for (let k = 0; k < ny; k++) {
        if (!(flags[base + k] & 1)) continue;
        if (k + 1 < ny && (flags[base + k + 1] & 1)) continue; // فقط بالای هر دسته‌ی کف
        let ok = true;
        for (let t = k + skip; t <= Math.min(ny - 1, k + head); t++) if (flags[base + t]) { ok = false; break; }
        if (!ok) { if (lowFail < 0) lowFail = k; continue; }
        // سقف/لبه‌ی یک دیوار یا ساختمان توپر (خیلی بالاتر از زمینِ بسته‌شده) قابل‌ایستادن حساب نمی‌شود؛ جعبه تا ~۱.۶ متر می‌شود
        if (lowFail >= 0 && (k - lowFail) * vsy > 1.6) break;
        let c = 1e9;
        for (let t = k + head + 1; t < ny; t++) if (flags[base + t]) { c = t * vsy; break; }
        fl[nvalid] = (k + 0.5) * vsy; cl[nvalid] = c; nvalid++;
        break;
      }
    }
    const blockedCols = per * per - nvalid;
    if (blockedCols >= per || nvalid === 0) continue; // دیوار/بیرون از مپ
    const a = Array.from(fl.subarray(0, nvalid)).sort((p, q) => p - q);
    const i = cz * W + cx;
    floor[i] = a[nvalid >> 1];
    let c = 1e9; for (let t = 0; t < nvalid; t++) if (cl[t] < c) c = cl[t];
    ceil[i] = c;
  }
  return { floor, ceil };
}

// ───────────────────────── navigation helpers ─────────────────────────
const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function makeNav(W, H, floor, ceil) {
  const walk = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (!Number.isNaN(floor[i]) && ceil[i] - floor[i] >= HEIGHT + 0.05) walk[i] = 1;
  const passable = (i, j, dx, dz) => {
    if (!walk[j] || Math.abs(floor[j] - floor[i]) > STEP) return false;
    if (dx && dz) {
      const a = i + dx, b = i + dz * W;
      if (!walk[a] || !walk[b] || Math.abs(floor[a] - floor[i]) > STEP || Math.abs(floor[b] - floor[i]) > STEP) return false;
    }
    return true;
  };
  return { walk, passable };
}
function components(W, H, nav) {
  const comp = new Int32Array(W * H).fill(-1), sizes = [];
  const q = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!nav.walk[s] || comp[s] >= 0) continue;
    const id = sizes.length; let h = 0, t = 0; q[t++] = s; comp[s] = id;
    while (h < t) {
      const i = q[h++], x = i % W, z = (i / W) | 0;
      for (const [dx, dz] of D8) {
        const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
        const j = zz * W + xx; if (comp[j] >= 0 || !nav.passable(i, j, dx, dz)) continue;
        comp[j] = id; q[t++] = j;
      }
    }
    sizes.push(t);
  }
  return { comp, sizes };
}
function bfs(W, H, nav, src, mask) {
  const dist = new Int32Array(W * H).fill(-1), q = new Int32Array(W * H);
  let h = 0, t = 0; q[t++] = src; dist[src] = 0; let last = src;
  while (h < t) {
    const i = q[h++]; last = i; const x = i % W, z = (i / W) | 0;
    for (const [dx, dz] of D8) {
      const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
      const j = zz * W + xx; if (dist[j] >= 0 || (mask && !mask[j]) || !nav.passable(i, j, dx, dz)) continue;
      dist[j] = dist[i] + 1; q[t++] = j;
    }
  }
  return { dist, far: last };
}

// ───────────────────────── main entry ─────────────────────────
/**
 * @returns {{W,H,heights:Float32Array,ceil:Float32Array,groundRef:number,gameplay:object,report:string[]}}
 */
function buildGrid(geoms, W, H, ymax, opt, log) {
  const vox = voxelize(geoms, W, H, ymax, opt.voxel || 0.25, opt.voxelY || 0.1, log);
  let { floor, ceil } = columnsToCells(vox, W, H);
  let nav = makeNav(W, H, floor, ceil);
  let { comp, sizes } = components(W, H, nav);
  if (!sizes.length) throw new Error('هیچ سطح قابل‌ایستادنی در مپ پیدا نشد. مقیاس (--scale) یا جهت محورها (--z-up / --rot-y) را بررسی کن.');
  let main = 0; for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;
  const mainMask = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) if (comp[i] === main) mainMask[i] = 1;

  // خانه‌های غیرقابل‌دسترس: اگر تا ~۱.۱۵ متر بالاتر از همسایه‌ی اصلی‌اند (جعبه/لبه) بمانند، وگرنه تبدیل به دیوار توپر
  const JUMP = 1.15;
  const wallCell = new Uint8Array(W * H);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x;
    if (Number.isNaN(floor[i])) { wallCell[i] = 1; continue; }
    if (mainMask[i]) continue;
    let ref = Infinity;
    for (const [dx, dz] of D8) {
      const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
      const j = zz * W + xx; if (mainMask[j] && floor[j] < ref) ref = floor[j];
    }
    if (ref === Infinity || !(floor[i] <= ref + JUMP)) wallCell[i] = 1;
  }

  // ارتفاع مبنا: صدک ۵ام کف‌های قابل‌دسترس → صفر
  const mainFloors = []; for (let i = 0; i < W * H; i++) if (mainMask[i]) mainFloors.push(floor[i]);
  mainFloors.sort((a, b) => a - b);
  const groundRef = mainFloors[Math.floor(mainFloors.length * 0.05)] || 0;

  const heights = new Float32Array(W * H).fill(WALL);
  const cl = new Float32Array(W * H).fill(1e9);
  for (let i = 0; i < W * H; i++) {
    if (wallCell[i]) continue;
    heights[i] = Math.round((floor[i] - groundRef) * 100) / 100;
    cl[i] = ceil[i] >= 1e8 ? 1e9 : Math.round((ceil[i] - groundRef) * 100) / 100;
  }
  // پس‌پردازش: خانه‌های منفرد ۱×۱ که فقط ۱ همسایه‌ی باز دارند، سوراخ نشوند
  floor = heights; ceil = cl;
  nav = makeNav(W, H, floor.map((v) => (v >= WALL ? NaN : v)), ceil);

  // ─── gameplay defaults (اسپاون‌ها، سایت‌ها، منطقه‌ی خرید، ...) ───
  const report = [];
  const idx = (x, z) => z * W + x;
  const A = bfs(W, H, nav, mainFirst(mainMask), mainMask).far;
  const B1 = bfs(W, H, nav, A, mainMask);
  const Bc = B1.far;
  const dBA = B1.dist[Bc];
  let ends = [A, Bc].map((i) => [i % W, (i / W) | 0]);
  ends.sort((p, q) => q[1] - p[1]);                // T = جنوب (z بزرگ‌تر)، CT = شمال
  const [Tend, CTend] = ends;
  const clear = (x, z) => { for (const [dx, dz] of D8) { const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= W || zz >= H || !nav.walk[idx(xx, zz)]) return false; } return nav.walk[idx(x, z)] === 1; };
  const spawnsAround = (e, n) => {
    const cand = [];
    for (let z = e[1] - 9; z <= e[1] + 9; z++) for (let x = e[0] - 9; x <= e[0] + 9; x++) {
      if (x < 1 || z < 1 || x >= W - 1 || z >= H - 1 || !mainMask[idx(x, z)] || !clear(x, z)) continue;
      cand.push([x, z, Math.hypot(x - e[0], z - e[1])]);
    }
    cand.sort((p, q) => p[2] - q[2]);
    const out = [];
    for (const c of cand) { if (out.every((o) => Math.hypot(o[0] - c[0], o[1] - c[1]) >= 1.9)) out.push([c[0], c[1]]); if (out.length >= n) break; }
    if (out.length < n) for (const c of cand) { if (!out.some((o) => o[0] === c[0] && o[1] === c[1])) out.push([c[0], c[1]]); if (out.length >= n) break; }
    return out;
  };
  const spawns = { T: spawnsAround(Tend, 10), CT: spawnsAround(CTend, 10) };
  const yawTo = (a, b) => Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));
  const yaw = { T: yawTo(Tend, CTend), CT: yawTo(CTend, Tend) };
  const span = Math.max(W, H);

  // سایت‌ها: بازترین و هموارترین جاهای دور از اسپاون‌ها
  const R = 5;
  const openness = (x, z) => {
    let n = 0, mn = Infinity, mx = -Infinity;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
      const i = idx(xx, zz); if (!mainMask[i]) continue;
      n++; if (floor[i] < mn) mn = floor[i]; if (floor[i] > mx) mx = floor[i];
    }
    return { n: n / ((2 * R + 1) ** 2), flat: mx - mn };
  };
  const scored = [];
  for (let z = R; z < H - R; z += 2) for (let x = R; x < W - R; x += 2) {
    if (!mainMask[idx(x, z)]) continue;
    if (Math.hypot(x - Tend[0], z - Tend[1]) < span * 0.28 || Math.hypot(x - CTend[0], z - CTend[1]) < span * 0.18) continue;
    const o = openness(x, z); if (o.flat > 2.5) continue;
    scored.push([x, z, o.n - o.flat * 0.05]);
  }
  scored.sort((p, q) => q[2] - p[2]);
  const picks = [];
  for (const c of scored) { if (picks.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) >= span * 0.3)) picks.push(c); if (picks.length === 2) break; }
  while (picks.length < 2) picks.push([Math.round(W * (picks.length ? 0.3 : 0.7)), Math.round(H * 0.4), 0]);
  picks.sort((p, q) => q[0] - p[0]);              // A = شرقی‌تر (x بزرگ‌تر)
  const rect = (c, r) => [Math.max(0, Math.round(c[0] - r)), Math.max(0, Math.round(c[1] - r)), Math.min(W, Math.round(c[0] + r)), Math.min(H, Math.round(c[1] + r))];
  const sites = { A: rect(picks[0], 7), B: rect(picks[1], 7) };
  const bbox = (pts, pad) => [Math.max(0, Math.min(...pts.map((p) => p[0])) - pad), Math.max(0, Math.min(...pts.map((p) => p[1])) - pad), Math.min(W, Math.max(...pts.map((p) => p[0])) + 1 + pad), Math.min(H, Math.max(...pts.map((p) => p[1])) + 1 + pad)];
  const buy = { T: bbox(spawns.T, 3), CT: bbox(spawns.CT, 3) };
  const nearMain = (x, z) => { let best = null, bd = 1e9; for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) { const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= W || zz >= H || !mainMask[idx(xx, zz)]) continue; const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = [xx, zz]; } } return best || [x, z]; };
  const holdsFor = (r, lookAt) => {
    const cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2, pts = [];
    for (const [fx, fz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6], [0, 0]]) {
      const p = nearMain(Math.round(cx + fx * (r[2] - r[0]) / 2), Math.round(cz + fz * (r[3] - r[1]) / 2));
      pts.push([p[0], p[1], lookAt[0], lookAt[1] + 30]);
    }
    return pts;
  };
  const midC = nearMain(Math.round((Tend[0] + CTend[0]) / 2), Math.round((Tend[1] + CTend[1]) / 2));
  const holds = { A: holdsFor(sites.A, Tend), B: holdsFor(sites.B, Tend), MID: [[midC[0], midC[1], Tend[0], Tend[1] + 30]] };
  const routes = { A: [[]], B: [[]] };
  const callouts = [['A Site', ...sites.A], ['B Site', ...sites.B], ['T Spawn', ...buy.T], ['CT Spawn', ...buy.CT], ['Mid', 0, 0, W, H]];

  report.push(`  شبکه‌ی بازی: ${W}×${H} خانه‌ی ۱ متری، ${mainFloors.length} خانه‌ی قابل‌دسترس (قطعه‌ی اصلی)، طول مپ ≈ ${dBA} خانه`);
  report.push(`  ارتفاع مبنا (۰ بازی) = ${groundRef.toFixed(2)} متر از پایین‌ترین نقطه‌ی مش`);
  report.push(`  اسپاون T حوالی (${Tend}) ، CT حوالی (${CTend}) ؛ سایت A حوالی (${picks[0].slice(0, 2)}) ، B حوالی (${picks[1].slice(0, 2)})`);
  report.push('  ⚠ اسپاون‌ها/سایت‌ها/مناطق خرید حدسی‌اند؛ در مپ ادیتور (JSON سمت راست یا proxy های سه‌بعدی) اصلاحشان کن.');
  return { W, H, heights, ceil: cl, groundRef, gameplay: { spawns, yaw, sites, buy, routes, holds, callouts }, report };
}
function mainFirst(mask) { for (let i = 0; i < mask.length; i++) if (mask[i]) return i; return 0; }

// ───────────────────────── encoding for def.grid ─────────────────────────
function rleInt16(arr) {
  const out = []; let v = arr[0], c = 1;
  for (let i = 1; i < arr.length; i++) { if (arr[i] === v && c < 32767) c++; else { out.push(v, c); v = arr[i]; c = 1; } }
  out.push(v, c);
  return Buffer.from(Int16Array.from(out).buffer).toString('base64');
}
function encodeGrid(W, H, heights, ceil) {
  const h = new Int16Array(W * H), c = new Int16Array(W * H);
  for (let i = 0; i < W * H; i++) {
    h[i] = heights[i] >= WALL ? NONE : Math.max(-3000, Math.min(3000, Math.round(heights[i] * 100)));
    c[i] = ceil[i] >= 1e8 ? NONE : Math.max(-3000, Math.min(3000, Math.round(ceil[i] * 100)));
  }
  return { v: 1, w: W, h: H, hr: rleInt16(h), cr: rleInt16(c) };
}

module.exports = { buildGrid, encodeGrid, WALL };
