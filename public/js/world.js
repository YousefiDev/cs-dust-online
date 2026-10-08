// Builds the 3D scene for a shared map: merged wall/floor geometry, crates, tunnels, doors, sky, lights.
import * as THREE from 'three';
import { WALL, WALL_TOP } from '/shared/constants.js';
import { MAT } from '/shared/maps.js';
import { heightAt } from '/shared/physics.js';
import * as TX from './textures.js';

class Geo {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
  vert(x, y, z, n, u, v, c) { this.p.push(x, y, z); this.n.push(n[0], n[1], n[2]); this.u.push(u, v); this.c.push(c, c * 0.985, c * 0.96); return this.p.length / 3 - 1; }
  quad(a, b, c, d, n, uvs, cols) { // CCW as seen from the normal side
    const k = [a, b, c, d].map((v, j) => this.vert(v[0], v[1], v[2], n, uvs[j][0], uvs[j][1], cols[j]));
    this.i.push(k[0], k[1], k[2], k[0], k[2], k[3]);
  }
  wall(x0, z0, x1, z1, n, yb0, yb1, yt0, yt1, tile, cBot = 1, cTop = 1) { // vertical face between (x0,z0)-(x1,z1)
    const r = [n[2], 0, -n[0]]; let A = [x0, z0], B = [x1, z1];
    if (A[0] * r[0] + A[1] * r[2] > B[0] * r[0] + B[1] * r[2]) { [A, B] = [B, A]; [yb0, yb1] = [yb1, yb0]; [yt0, yt1] = [yt1, yt0]; }
    const ua = (A[0] * r[0] + A[1] * r[2]) / tile, ub = (B[0] * r[0] + B[1] * r[2]) / tile;
    this.quad([A[0], yb0, A[1]], [B[0], yb1, B[1]], [B[0], yt1, B[1]], [A[0], yt0, A[1]], n, [[ua, yb0 / tile], [ub, yb1 / tile], [ub, yt1 / tile], [ua, yt0 / tile]], [cBot, cBot, cTop, cTop]);
  }
  floor(x0, z0, x1, z1, y00, y10, y11, y01, tile, col = 1, down = false) {
    const ex = [x1 - x0, y10 - y00, 0], ez = [0, y01 - y00, z1 - z0];
    let n = [ex[1] * ez[2] - ex[2] * ez[1], ex[2] * ez[0] - ex[0] * ez[2], ex[0] * ez[1] - ex[1] * ez[0]]; const l = Math.hypot(...n); n = n.map((v) => -v / l);
    if (down) { n = n.map((v) => -v); this.quad([x0, y00, z0], [x1, y10, z0], [x1, y11, z1], [x0, y01, z1], n, [[x0 / tile, z0 / tile], [x1 / tile, z0 / tile], [x1 / tile, z1 / tile], [x0 / tile, z1 / tile]], [col, col, col, col]); }
    else this.quad([x0, y01, z1], [x1, y11, z1], [x1, y10, z0], [x0, y00, z0], n, [[x0 / tile, z1 / tile], [x1 / tile, z1 / tile], [x1 / tile, z0 / tile], [x0 / tile, z0 / tile]], [col, col, col, col]);
  }
  box(x0, y0, z0, x1, y1, z1, tile, col = 1, skipBottom = true) {
    this.floor(x0, z0, x1, z1, y1, y1, y1, y1, tile, col * 1.05);
    if (!skipBottom) this.floor(x0, z0, x1, z1, y0, y0, y0, y0, tile, col * 0.6, true);
    this.wall(x0, z0, x1, z0, [0, 0, -1], y0, y0, y1, y1, tile, col * 0.8, col); this.wall(x0, z1, x1, z1, [0, 0, 1], y0, y0, y1, y1, tile, col * 0.8, col);
    this.wall(x0, z0, x0, z1, [-1, 0, 0], y0, y0, y1, y1, tile, col * 0.8, col); this.wall(x1, z0, x1, z1, [1, 0, 0], y0, y0, y1, y1, tile, col * 0.8, col);
  }
  mesh(mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setIndex(this.i);
    g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
  }
}
function vnoise(x, z, seed = 1) {
  const h = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  return (h(ix, iz) * (1 - sx) + h(ix + 1, iz) * sx) * (1 - sz) + (h(ix, iz + 1) * (1 - sx) + h(ix + 1, iz + 1) * sx) * sz;
}
function greedy(W, H, keyAt, emit) {
  const seen = new Uint8Array(W * H);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x; if (seen[i]) continue; const k = keyAt(x, z); if (k === null) { seen[i] = 1; continue; }
    let w = 1; while (x + w < W && !seen[i + w] && keyAt(x + w, z) === k) w++;
    let h = 1; grow: while (z + h < H) { for (let q = 0; q < w; q++) { const j = (z + h) * W + x + q; if (seen[j] || keyAt(x + q, z + h) !== k) break grow; } h++; }
    for (let a = 0; a < h; a++) for (let b = 0; b < w; b++) seen[(z + a) * W + x + b] = 1;
    emit(x, z, w, h, k);
  }
}
export function buildWorld(scene, m, opts = {}) {
  const root = new THREE.Group(); root.name = 'world'; scene.add(root);
  const th = m.theme; const { W, H } = m;
  const hq = true;
  const texPBR = (make, rep, rough, strength) => {
    const map = make(); map.anisotropy = opts.quality === 'high' ? 16 : opts.quality === 'medium' ? 8 : 2;
    return { map, normalMap: hq ? TX.normalFrom(map, strength) : null, normalScale: hq ? new THREE.Vector2(0.42, 0.42) : new THREE.Vector2(0, 0), roughness: rough };
  };
  const blocks = texPBR(() => TX.sandstone(th.wall, 7), 1, 0.88, 0.72); blocks.map.repeat.set(1,1);
  const plaster = texPBR(() => TX.plaster('#dcc093', 3), 1, 0.92, 0.52);
  const sand = texPBR(() => TX.ground(th.floor, 11), 1, 0.98, 0.34);
  const tile = texPBR(() => TX.pavers('#c9ad83', 5, 4), 1, 0.84, 0.62);
  const tunnel = texPBR(() => TX.pavers('#a99273', 9, 3), 1, 0.9, 0.5);
  const plank = texPBR(() => TX.pavers('#a07a4e', 15, 6), 1, 0.78, 0.7);
  const dark = texPBR(() => TX.ground('#a98d68', 17), 1, 0.98, 0.32);
  const cobble = texPBR(() => TX.cobble('#b9a07c', 21), 1, 0.86, 0.82);
  const crateTex = texPBR(() => TX.crate(31), 1, 0.78, 0.62);
  const doorTex = texPBR(() => TX.blueDoor(41), 1, 0.66, 0.55);
  const mats = {
    blocks: new THREE.MeshStandardMaterial({ ...blocks, vertexColors: true }),
    plaster: new THREE.MeshStandardMaterial({ ...plaster, vertexColors: true }),
    sand: new THREE.MeshStandardMaterial({ ...sand, vertexColors: true }),
    tile: new THREE.MeshStandardMaterial({ ...tile, vertexColors: true }),
    tunnel: new THREE.MeshStandardMaterial({ ...tunnel, vertexColors: true }),
    plank: new THREE.MeshStandardMaterial({ ...plank, vertexColors: true }),
    dark: new THREE.MeshStandardMaterial({ ...dark, vertexColors: true }),
    cobble: new THREE.MeshStandardMaterial({ ...cobble, vertexColors: true }),
    crate: new THREE.MeshStandardMaterial({ ...crateTex }),
    cont: new THREE.MeshStandardMaterial({ color: th.cont || '#3b6fb6', roughness: 0.58, metalness: 0.22 }),
    door: new THREE.MeshStandardMaterial({ ...doorTex }),
    beam: new THREE.MeshStandardMaterial({ color: '#5a3d22', roughness: 0.82 }),
  };
  const floorMat = { [MAT.SAND]: 'sand', [MAT.TILE]: 'tile', [MAT.TUNNEL]: 'tunnel', [MAT.PLANK]: 'plank', [MAT.DARK]: 'dark', [MAT.COBBLE]: 'cobble', [MAT.CRATE]: 'sand' };
  const geos = {}; const G = (k) => (geos[k] = geos[k] || new Geo());
  const isWall = (x, z) => x < 0 || z < 0 || x >= W || z >= H || m.heights[z * W + x] >= WALL;
  // Wall heights vary like the real map's skyline.
  const wh = new Float32Array(W * H);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (!isWall(x, z)) continue; const edge = x < 2 || z < 2 || x >= W - 2 || z >= H - 2;
    wh[z * W + x] = edge ? 9 : Math.round((5.6 + vnoise(x / 11, z / 11) * 3.6) * 2) / 2;
  }
  const wallH = (x, z) => (x < 0 || z < 0 || x >= W || z >= H ? 0 : wh[z * W + x]);
  const style = (x, z) => (vnoise(x / 9 + 50, z / 9 + 50, 3) > 0.52 ? 'plaster' : 'blocks');
  const DIRS = [[0, -1, [0, 0, -1]], [0, 1, [0, 0, 1]], [-1, 0, [-1, 0, 0]], [1, 0, [1, 0, 0]]];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (!isWall(x, z)) continue; const hc = wh[z * W + x];
    for (const [dx, dz, n] of DIRS) {
      const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      let bot, nf = null;
      if (isWall(nx, nz)) { const hn = wallH(nx, nz); if (hn >= hc) continue; bot = hn; }
      else { nf = m.floor[nz * W + nx]; bot = Math.min(nf, m.heights[nz * W + nx]) - 0.4; }
      const x0 = dx === 1 ? x + 1 : x, x1 = dx === -1 ? x : dx === 1 ? x + 1 : x + 1, z0 = dz === 1 ? z + 1 : z, z1 = dz === -1 ? z : dz === 1 ? z + 1 : z + 1;
      const ax = dx === 0 ? x : x0, bx = dx === 0 ? x + 1 : x0, az = dz === 0 ? z : z0, bz = dz === 0 ? z + 1 : z0;
      const g = G(style(x, z));
      if (nf !== null) { const mid = Math.min(hc, nf + 1.3); g.wall(ax, az, bx, bz, n, bot, bot, mid, mid, 4, 0.55, 0.95); g.wall(ax, az, bx, bz, n, mid, mid, hc, hc, 4, 0.95, 1.06); }
      else g.wall(ax, az, bx, bz, n, bot, bot, hc, hc, 4, 0.92, 1.05);
    }
  }
  greedy(W, H, (x, z) => (isWall(x, z) ? wh[z * W + x] + ':' + style(x, z) : null), (x, z, w, h, k) => { const y = wh[z * W + x]; G(style(x, z)).floor(x, z, x + w, z + h, y, y, y, y, 4, 1.08); });
  // Floors (merged), darker under roofs.
  greedy(W, H, (x, z) => { const i = z * W + x; if (isWall(x, z) || m.rampIdx[i] >= 0) return null; return m.floor[i] + ':' + (floorMat[m.mat[i]] || 'sand') + ':' + (m.ceil[i] < 1e8 ? 1 : 0); },
    (x, z, w, h, k) => { const [y, mk, roof] = k.split(':'); const v = +y; G(mk).floor(x, z, x + w, z + h, v, v, v, v, mk === 'tile' || mk === 'tunnel' ? 3 : 4, roof === '1' ? 0.62 : 1); });
  for (const r of m.ramps) {
    const hx = (x, z) => (r.axis === 'x' ? r.h0 + (r.h1 - r.h0) * (x - r.x0) / (r.x1 - r.x0) : r.h0 + (r.h1 - r.h0) * (z - r.z0) / (r.z1 - r.z0));
    const i = r.z0 * W + r.x0, mk = floorMat[m.mat[i]] || 'sand', roof = m.ceil[i] < 1e8 ? 0.62 : 1;
    G(mk).floor(r.x0, r.z0, r.x1, r.z1, hx(r.x0, r.z0), hx(r.x1, r.z0), hx(r.x1, r.z1), hx(r.x0, r.z1), 3, roof);
  }
  // Step faces between floor levels (platforms, pit, ramp sides).
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x; if (isWall(x, z) || m.mat[i] === MAT.CRATE) continue;
    for (const [dx, dz, n] of DIRS) {
      const nx = x + dx, nz = z + dz; if (isWall(nx, nz)) continue; const j = nz * W + nx; if (m.mat[j] === MAT.CRATE) continue;
      const ax = dx === 1 ? x + 1 : x, az = dz === 1 ? z + 1 : z, bx = dx === 0 ? x + 1 : ax, bz = dz === 0 ? z + 1 : az;
      const inset = 0.02, ix = -dx * inset, iz = -dz * inset;
      const ta = heightAt(m, ax + ix + (dx === 0 ? 0.01 : 0), az + iz + (dz === 0 ? 0.01 : 0)), tb = heightAt(m, bx + ix - (dx === 0 ? 0.01 : 0), bz + iz - (dz === 0 ? 0.01 : 0));
      const ba = heightAt(m, ax - ix + (dx === 0 ? 0.01 : 0), az - iz + (dz === 0 ? 0.01 : 0)), bb = heightAt(m, bx - ix - (dx === 0 ? 0.01 : 0), bz - iz - (dz === 0 ? 0.01 : 0));
      if (ta - ba < 0.02 && tb - bb < 0.02) continue;
      G('blocks').wall(ax, az, bx, bz, n, Math.min(ba, ta), Math.min(bb, tb), ta, tb, 4, 0.7, 0.9);
    }
  }
  // Tunnel roofs / archways: solid blocks from the ceiling up to the skyline, with beams underneath.
  for (const [x0, z0, x1, z1, c] of m.def.roofs || []) {
    const top = Math.max(c + 1.6, WALL_TOP - 0.8);
    const g = G('plaster'); g.box(x0, c, z0, x1, top, z1, 4, 1); g.floor(x0, z0, x1, z1, c, c, c, c, 4, 0.5, true);
    const along = (x1 - x0) > (z1 - z0);
    const beam = G('beam');
    if (along) for (let x = x0 + 1.5; x < x1 - 0.5; x += 3) beam.box(x - 0.15, c - 0.32, z0, x + 0.15, c, z1, 1, 1, false);
    else for (let z = z0 + 1.5; z < z1 - 0.5; z += 3) beam.box(x0, c - 0.32, z - 0.15, x1, c, z + 0.15, 1, 1, false);
  }
  for (const k in geos) root.add(geos[k].mesh(mats[k] || mats.blocks));
  // Crates
  const crateGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const c of m.crates) {
    const layers = Math.max(1, Math.round(c.h / 1.1)), lh = c.h / layers;
    for (let L = 0; L < layers; L++) {
      const cw = c.w >= 4 ? 2 : c.w, cd = c.d >= 4 ? 2 : c.d;
      for (let ox = 0; ox < c.w; ox += cw) for (let oz = 0; oz < c.d; oz += cd) {
        const b = new THREE.Mesh(crateGeo, c.kind === 'cont' ? mats.cont : mats.crate); const shrink = L ? 0.08 : 0.01;
        b.scale.set(cw - shrink * 2, lh - 0.005, cd - shrink * 2); b.position.set(c.x + ox + cw / 2, c.base + lh * L + lh / 2, c.z + oz + cd / 2);
        b.rotation.y = L ? (Math.sin(c.x * 3 + c.z) * 0.06) : 0; b.castShadow = b.receiveShadow = true; root.add(b);
      }
    }
  }
  // Cheap landmark props give the authored layouts their CS2 read without
  // turning low-end phones into a slideshow.
  const propMat = {
    green: new THREE.MeshStandardMaterial({ color: '#3f6b3a', roughness: 0.95 }),
    clay: new THREE.MeshStandardMaterial({ color: '#a7603e', roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: '#30363d', roughness: 0.55, metalness: 0.35 }),
    cloth: new THREE.MeshStandardMaterial({ color: th.shutter || '#3a7182', roughness: 0.8 }),
    sandbag: new THREE.MeshStandardMaterial({ color: '#bca77c', roughness: 1 }),
  };
  const propBox = (w, h, d, material, x, y, z, rot = 0) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    o.position.set(x, y, z); o.rotation.y = rot; o.castShadow = o.receiveShadow = opts.quality !== 'low'; root.add(o); return o;
  };
  const propCyl = (r, h, material, x, y, z, seg = 8) => {
    const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, h, seg), material);
    o.position.set(x, y, z); o.castShadow = o.receiveShadow = opts.quality !== 'low'; root.add(o); return o;
  };
  for (const [kind, x, z, a = 0, size = 1] of m.def.props || []) {
    const y = Math.max(0, heightAt(m, x, z)) + 0.02;
    if (kind === 'barrel' || kind === 'pot') {
      const h = kind === 'pot' ? 0.38 : 0.75;
      propCyl(kind === 'pot' ? 0.34 * size : 0.28 * size, h, kind === 'pot' ? propMat.clay : propMat.metal, x, y + h / 2, z);
    } else if (kind === 'palm') {
      propCyl(0.12 * size, 2.5 * size, propMat.clay, x, y + 1.25 * size, z, 7);
      for (let i = 0; i < 6; i++) {
        const leaf = propBox(0.12 * size, 0.035, 1.25 * size, propMat.green, x, y + 2.55 * size, z, i * Math.PI / 3);
        leaf.position.x += Math.sin(i * 1.7) * 0.28 * size; leaf.position.z += Math.cos(i * 1.7) * 0.28 * size;
      }
    } else if (kind === 'awning') {
      const w = Math.max(2, size || 3), rot = a ? Math.PI / 2 : 0;
      propBox(w, 0.08, 1.3, propMat.cloth, x, y + 2.4, z, rot);
      propBox(0.06, 2.4, 0.06, propMat.metal, x - (rot ? 0.58 : w / 2 - 0.15), y + 1.2, z);
      propBox(0.06, 2.4, 0.06, propMat.metal, x + (rot ? 0.58 : w / 2 - 0.15), y + 1.2, z);
    } else if (kind === 'sandbags') {
      for (let i = 0; i < 5; i++) propBox(0.7, 0.38, 0.42, propMat.sandbag, x + (i - 2) * 0.62, y + 0.19 + (i % 2) * 0.32, z, 0.1 * (i - 2));
    } else if (kind === 'wires' && opts.quality !== 'low') {
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 7, 5), propMat.metal);
      wire.position.set(x, y + 3.1, z); wire.rotation.z = Math.PI / 2.2; wire.rotation.y = a || 0; root.add(wire);
    }
  }
  // Soft contact shadows keep stacked crates and props visually grounded on high quality.
  if (opts.quality === 'high') {
    const shadowTex = TX.radial('rgba(25,18,10,0.42)', 'rgba(25,18,10,0)');
    for (const c of m.crates) {
      const s = Math.min(5.5, Math.max(c.w, c.d) * 0.95);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.75 }));
      sh.rotation.x = -Math.PI / 2; sh.position.set(c.x + c.w / 2, c.base + 0.012, c.z + c.d / 2); sh.renderOrder = 1; root.add(sh);
    }
  }
  // Iconic blue doors
  for (const [x0, z0, x1, z1, h] of m.def.doors || []) {
    const fx = x1 - x0 < 0.5, base = Math.min(heightAt(m, x0 + (fx ? -0.5 : 0.5), z0 + (fx ? 0.5 : -0.5)), heightAt(m, x0 + (fx ? 0.5 : 0.5), z0 + (fx ? 0.5 : 0.5)));
    const b = new THREE.Mesh(new THREE.BoxGeometry(fx ? 0.1 : x1 - x0, h, fx ? z1 - z0 : 0.1), mats.door);
    b.position.set((x0 + x1) / 2, Math.max(0, base) + h / 2 - 0.05, (z0 + z1) / 2); b.castShadow = true; b.receiveShadow = true; root.add(b);
  }
  // Bombsite graffiti
  for (const [k, r] of Object.entries(m.def.sites)) {
    let best = null; const cx = Math.floor((r[0] + r[2]) / 2);
    for (let z = r[1]; z < r[3]; z++) { if (isWall(cx, z - 1) && !isWall(cx, z)) { best = z; break; } }
    if (best === null) continue; const fy = m.floor[best * W + cx];
    const d = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshStandardMaterial({ map: TX.siteDecal(k), transparent: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
    d.position.set(cx + 0.5, fy + 2.6, best + 0.02); root.add(d);
  }
  // Lamps
  const bulbMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0' });
  for (const [x, z, y] of m.def.lamps || []) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), bulbMat); b.position.set(x, y - 0.4, z); root.add(b);
    const l = new THREE.PointLight('#ffc78a', 6, 13, 1.8); l.position.copy(b.position); root.add(l);
  }
  // Outside ground + distant dunes
  const og = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: TX.ground('#c4a273', 77), roughness: 1 }));
  og.material.map.repeat.set(140, 140); og.rotation.x = -Math.PI / 2; og.position.set(W / 2, -0.6, H / 2); og.receiveShadow = true; root.add(og);
  const dunes = new THREE.BufferGeometry(), pos = [], seg = 96;
  for (let s = 0; s < seg; s++) {
    const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2, R = 230;
    const h0 = 14 + vnoise(s / 6, 3, 9) * 38, h1 = 14 + vnoise((s + 1) / 6, 3, 9) * 38;
    const P = (a, r, y) => [W / 2 + Math.cos(a) * r, y, H / 2 + Math.sin(a) * r];
    pos.push(...P(a0, R, -1), ...P(a1, R, -1), ...P(a1, R + 30, h1), ...P(a0, R, -1), ...P(a1, R + 30, h1), ...P(a0, R + 30, h0));
  }
  dunes.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); dunes.computeVertexNormals();
  root.add(new THREE.Mesh(dunes, new THREE.MeshStandardMaterial({ color: '#cfa774', roughness: 1, side: THREE.DoubleSide })));
  // Sky dome: gradient + sun glow + drifting fbm clouds (animated through uniforms.time).
  const sunDir = new THREE.Vector3(-0.45, 0.62, 0.64).normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#3f86c9') }, mid: { value: new THREE.Color(th.sky) }, hor: { value: new THREE.Color(th.haze) }, sun: { value: sunDir }, time: { value: 0 }, clouds: { value: opts.low ? 0.0 : 1.0 } },
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 sun; uniform float time; uniform float clouds; varying vec3 vp;
      float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n2(p); p*=2.03; a*=0.5; } return v; }
      void main(){ vec3 d = normalize(vp); float h = d.y; vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
        float s = max(dot(d, sun), 0.0);
        if (clouds > 0.5 && h > 0.02) {
          vec2 uv = d.xz / (h + 0.18) * 1.6 + vec2(time * 0.006, time * 0.0025);
          float cl = smoothstep(0.52, 0.86, fbm(uv)) * smoothstep(0.02, 0.22, h);
          vec3 cc = mix(vec3(0.97,0.93,0.86), vec3(1.0,0.97,0.9), pow(s,4.0)); c = mix(c, cc, cl * 0.72);
        }
        c += vec3(1.0,0.86,0.6) * pow(s, 18.0) * 0.45 + vec3(1.0,0.95,0.85) * pow(s, 900.0) * 3.0 + vec3(1.0,0.8,0.55) * pow(s, 4.0) * 0.08;
        if (h < 0.0) c = hor * 0.92; gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), skyMat);
  sky.position.set(W / 2, 0, H / 2); sky.renderOrder = -1; sky.frustumCulled = false; root.add(sky);
  // Lighting
  scene.fog = new THREE.Fog(th.haze, opts.quality === 'high' ? 105 : opts.quality === 'medium' ? 82 : 65, opts.quality === 'high' ? 520 : opts.quality === 'medium' ? 380 : 250);
  const hemi = new THREE.HemisphereLight('#cfe3ff', '#b08a5a', opts.low ? 1.25 : 1.1); root.add(hemi);
  const sun = new THREE.DirectionalLight(th.sun, opts.quality === 'high' ? 3.25 : opts.quality === 'medium' ? 3.0 : 2.75);
  sun.position.set(W / 2 - 60, 85, H / 2 + 75); sun.target.position.set(W / 2, 0, H / 2); root.add(sun, sun.target);
  // Warm bounce from the sand: fills the shadow side of walls so corners don't go flat grey.
  const bounce = new THREE.DirectionalLight('#e8b47a', 0.45); bounce.position.set(W / 2 + 60, 12, H / 2 - 75); bounce.target.position.set(W / 2, 0, H / 2); bounce.visible = opts.quality !== 'low'; root.add(bounce, bounce.target);
  const SH = opts.quality === 'high' ? 58 : 44;
  {
    sun.castShadow = opts.quality !== 'low'; sun.shadow.mapSize.set(opts.quality === 'high' ? 4096 : 2048, opts.quality === 'high' ? 4096 : 2048); const sc = sun.shadow.camera; sc.left = -SH; sc.right = SH; sc.top = SH; sc.bottom = -SH; sc.near = 5; sc.far = 260; sc.updateProjectionMatrix();
    sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.035; if (hq) sun.shadow.radius = 2.5;
  }
  const sunOff = sunDir.clone().multiplyScalar(110);
  // Floating dust motes around the camera (cheap Points, high/medium only).
  let motes = null;
  if (!opts.low) {
    const N = hq ? 700 : 350, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 36; pos[i * 3 + 1] = Math.random() * 7; pos[i * 3 + 2] = (Math.random() - 0.5) * 36; seed[i] = Math.random() * 6.28; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,236,200,1)'); gr.addColorStop(1, 'rgba(255,236,200,0)'); x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    motes = new THREE.Points(g, new THREE.PointsMaterial({ map: tex, size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffe2b0' }));
    motes.frustumCulled = false; motes.visible = opts.quality !== 'low'; motes.userData = { seed, base: pos.slice() }; root.add(motes);
  }
  let t = 0;
  const _c = new THREE.Vector3();
  function update(dt, cam) {
    t += dt; skyMat.uniforms.time.value = t;
    if (sun.castShadow && cam) {
      // Shadow frustum follows the camera, snapped to shadow texels so edges don't shimmer.
      const step = (SH * 2) / sun.shadow.mapSize.x * 4; _c.set(Math.round(cam.x / step) * step, 0, Math.round(cam.z / step) * step);
      sun.target.position.copy(_c); sun.position.copy(_c).add(sunOff); sun.target.updateMatrixWorld();
    }
    if (motes && cam) {
      const p = motes.geometry.attributes.position, b = motes.userData.base, sd = motes.userData.seed;
      for (let i = 0; i < sd.length; i++) {
        let x = b[i * 3] + Math.sin(t * 0.21 + sd[i]) * 0.9 + t * 0.35, z = b[i * 3 + 2] + Math.cos(t * 0.17 + sd[i]) * 0.9 + t * 0.12;
        x = ((x - cam.x) % 36 + 54) % 36 - 18 + cam.x; z = ((z - cam.z) % 36 + 54) % 36 - 18 + cam.z;
        p.array[i * 3] = x; p.array[i * 3 + 1] = (b[i * 3 + 1] + Math.sin(t * 0.3 + sd[i] * 2) * 0.35) + Math.max(0, cam.y - 3); p.array[i * 3 + 2] = z;
      }
      p.needsUpdate = true;
    }
  }
  function setQuality(q) {
    const low = q === 'low', high = q === 'high';
    scene.fog.near = high ? 105 : q === 'medium' ? 82 : 65;
    scene.fog.far = high ? 520 : q === 'medium' ? 380 : 250;
    sun.intensity = high ? 3.25 : q === 'medium' ? 3.0 : 2.75;
    sun.castShadow = !low;
    sun.shadow.mapSize.set(high ? 4096 : 2048, high ? 4096 : 2048);
    bounce.visible = !low;
    if (motes) motes.visible = !low;
    if (motes) motes.geometry.setDrawRange(0, high ? 700 : q === 'medium' ? 350 : 0);
    for (const m of Object.values(mats)) if (m?.isMeshStandardMaterial && m.normalMap) m.normalScale.set(low ? 0 : high ? 0.42 : 0.24, low ? 0 : high ? 0.42 : 0.24);
  }
  return { root, mats, sun, sky, update, setQuality };
}
