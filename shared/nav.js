// Grid navigation: walkable cells + cached Dijkstra flow fields toward target regions.
import { PHYS, WALL } from './constants.js';
import { heightAt } from './physics.js';

const navCache = new Map();
export function getNav(m) {
  if (navCache.has(m.id)) return navCache.get(m.id);
  const { W, H } = m, N = W * H, walk = new Uint8Array(N), h = new Float32Array(N);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x; h[i] = heightAt(m, x + 0.5, z + 0.5);
    if (h[i] >= WALL || m.ceil[i] - h[i] < PHYS.height + 0.05) continue;
    walk[i] = 1;
  }
  // Clearance: keep bots one cell away from walls where possible (soft cost).
  const near = new Uint8Array(N);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x; if (!walk[i]) continue;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
      const j = zz * W + xx; if (!walk[j] || Math.abs(h[j] - h[i]) > PHYS.step) near[i] = 1;
    }
  }
  const nav = { m, W, H, walk, h, near, fields: new Map() };
  navCache.set(m.id, nav); return nav;
}
const DIRS = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];
export function passable(nav, i, j, dx, dz) {
  if (!nav.walk[j] || Math.abs(nav.h[j] - nav.h[i]) > PHYS.step) return false;
  if (dx && dz) { const a = i + dx, b = i + dz * nav.W; if (!nav.walk[a] || !nav.walk[b] || Math.abs(nav.h[a] - nav.h[i]) > PHYS.step || Math.abs(nav.h[b] - nav.h[i]) > PHYS.step) return false; }
  return true;
}
// Dijkstra from a set of target cells. Returns Int32Array distances (-1 unreachable).
export function field(nav, key, cells) {
  if (key && nav.fields.has(key)) return nav.fields.get(key);
  const { W, H } = nav, N = W * H, dist = new Int32Array(N).fill(-1);
  let heap = [];
  const push = (i, d) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let s = k; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === k) break; [heap[s], heap[k]] = [heap[k], heap[s]]; k = s; } } return top; };
  for (const i of cells) if (nav.walk[i]) { dist[i] = 0; push(i, 0); }
  while (heap.length) {
    const [d, i] = pop(); if (d > dist[i] && dist[i] >= 0) continue;
    const x = i % W, z = (i / W) | 0;
    for (const [dx, dz, c] of DIRS) {
      const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
      const j = zz * W + xx; if (!passable(nav, i, j, dx, dz)) continue;
      const nd = d + c + (nav.near[j] ? 6 : 0);
      if (dist[j] < 0 || nd < dist[j]) { dist[j] = nd; push(j, nd); }
    }
  }
  if (key) { if (nav.fields.size > 64) nav.fields.clear(); nav.fields.set(key, dist); }
  return dist;
}
export function rectCells(nav, r) { const out = []; for (let z = r[1]; z < r[3]; z++) for (let x = r[0]; x < r[2]; x++) { const i = z * nav.W + x; if (nav.walk[i]) out.push(i); } return out; }
export function pointField(nav, x, z, rad = 1) {
  const cx = Math.floor(x), cz = Math.floor(z), cells = [];
  for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) { const xx = cx + dx, zz = cz + dz; if (xx >= 0 && zz >= 0 && xx < nav.W && zz < nav.H) cells.push(zz * nav.W + xx); }
  return field(nav, `p${cx},${cz},${rad}`, cells);
}
// Walk the flow field a few cells ahead and return a steering point (cell centre).
export function nextWaypoint(nav, dist, x, z, look = 5) {
  const W = nav.W; let i = Math.floor(z) * W + Math.floor(x);
  if (dist[i] < 0) { // off-grid: find nearest reachable neighbour
    let best = -1, bd = 1e9;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const j = i + dz * W + dx; if (j >= 0 && j < dist.length && dist[j] >= 0 && dist[j] < bd) { bd = dist[j]; best = j; } }
    if (best < 0) return null; i = best;
  }
  if (dist[i] === 0) return { x: (i % W) + 0.5, z: ((i / W) | 0) + 0.5, done: true };
  let cur = i;
  for (let s = 0; s < look; s++) {
    const cx = cur % W, cz = (cur / W) | 0; let best = -1, bd = dist[cur];
    for (const [dx, dz] of DIRS) { const xx = cx + dx, zz = cz + dz; if (xx < 0 || zz < 0 || xx >= W || zz >= nav.H) continue; const j = zz * W + xx; if (dist[j] >= 0 && dist[j] < bd && passable(nav, cur, j, dx, dz)) { bd = dist[j]; best = j; } }
    if (best < 0) break; cur = best; if (dist[cur] === 0) break;
  }
  return { x: (cur % W) + 0.5, z: ((cur / W) | 0) + 0.5, done: dist[cur] === 0 };
}
