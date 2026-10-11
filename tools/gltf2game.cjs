#!/usr/bin/env node
'use strict';
/**
 * gltf2game.cjs — خروجی Source 2 Viewer (world.gltf + .bin یا .glb) -> مپ قابل‌بازی (فیلد grid)
 *
 * node tools/gltf2game.cjs world.gltf --bin de_dust2.bin -o dust2_cs.json \
 *      --bounds -50,-101,115,75 --gameplay dust2_real.json
 *
 *  --bin <file>        فایل .bin (اگر مسیر داخل gltf درست نبود)
 *  --bounds x0,z0,x1,z1  محدوده‌ی مپ به متر (مختصات جهانی glTF)؛ بیرونش نادیده گرفته می‌شود
 *  --ymin / --ymax     محدوده‌ی ارتفاع (پیش‌فرض -9 تا 37)
 *  --gameplay <json>   اسپاون/سایت/مسیر/متریال را از یک JSON ساخته‌شده‌ی قبلی (با همان مبدأ مختصات) بردار
 *  --id / --name       شناسه و نام مپ
 *  --voxel <m>         اندازه‌ی voxel افقی (پیش‌فرض 0.25)
 */
const fs = require('fs'), path = require('path');
const { buildGrid, encodeGrid } = require('./gamegrid.cjs');
const a = process.argv.slice(2); const o = { id: 'dust2_cs', name: 'Dust II (CS)', bounds: [-50, -101, 115, 75], ymin: -9, ymax: 37, voxel: 0.25 };
for (let i = 0; i < a.length; i++) {
  const k = a[i];
  if (k === '-o') o.out = a[++i]; else if (k === '--bin') o.bin = a[++i]; else if (k === '--bounds') o.bounds = a[++i].split(',').map(Number);
  else if (k === '--ymin') o.ymin = +a[++i]; else if (k === '--ymax') o.ymax = +a[++i]; else if (k === '--gameplay') o.gp = a[++i];
  else if (k === '--id') o.id = a[++i]; else if (k === '--name') o.name = a[++i]; else if (k === '--voxel') o.voxel = +a[++i];
  else if (!k.startsWith('-')) o.input = k;
}
if (!o.input) { console.error('usage: node tools/gltf2game.cjs world.gltf --bin de_dust2.bin -o out.json'); process.exit(1); }
o.out = o.out || o.id + '.json';
const gj = JSON.parse(fs.readFileSync(o.input, 'utf8'));
const binPath = o.bin || path.resolve(path.dirname(o.input), gj.buffers[0].uri);
console.log('reading', binPath); const bin = fs.readFileSync(binPath);
const JUNK = /blocklight|overlay|steam|lightshaft|palm_frond|wire|power_pole|hammer_mesh|lantern|satellite|chainlink|window_bars|ladder|cart_|awning|garbage|electric|breeze|dust_door_|rollupdoor|window_frame|windows_|kasbah_windows|window_insets|vents|braces|rope|ornament|trim_decoractive|metal_trim/i;
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function acc(i, Type) {
  const A = gj.accessors[i], bv = gj.bufferViews[A.bufferView], n = NC[A.type], es = Type.BYTES_PER_ELEMENT;
  const off = (bv.byteOffset || 0) + (A.byteOffset || 0), stride = bv.byteStride || n * es;
  if (stride === n * es && off % es === 0) return new Type(bin.buffer, bin.byteOffset + off, A.count * n).slice();
  const out = new Type(A.count * n); const dv = new DataView(bin.buffer, bin.byteOffset);
  for (let k = 0; k < A.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = Type === Float32Array ? dv.getFloat32(off + k * stride + c * 4, true) : dv.getUint32(off + k * stride + c * 4, true);
  return out;
}
const [bx0, bz0, bx1, bz1] = o.bounds, W = Math.ceil(bx1 - bx0), H = Math.ceil(bz1 - bz0), ymax = o.ymax - o.ymin;
const geoms = []; let kept = 0, dropped = 0;
for (const n of gj.nodes) {
  if (n.mesh === undefined) continue;
  if (JUNK.test(n.name || '') || JUNK.test(gj.meshes[n.mesh].name || '')) { dropped++; continue; }
  const M = (n.matrix || [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]).slice(); M[12] -= bx0; M[13] -= o.ymin; M[14] -= bz0;
  for (const p of gj.meshes[n.mesh].primitives) {
    const P = Float64Array.from(acc(p.attributes.POSITION, Float32Array)), I = acc(p.indices, Uint32Array);
    geoms.push({ P, I, inst: [{ M }] }); kept++;
  }
}
console.log(`primitives kept ${kept}, nodes dropped ${dropped}; grid ${W}x${H}, y 0..${ymax}`);
console.log('voxelizing (a few minutes)...');
const r = buildGrid(geoms, W, H, ymax, { voxel: o.voxel, voxelY: 0.1 }, (s) => console.log(s));
r.report.forEach((s) => console.log(s));
const def = { id: o.id, name: o.name, size: [W, H], scale: 1, cs2: true, areas: [], ramps: [], roofs: [], crates: [], doors: [], lamps: [], props: [], grid: encodeGrid(W, H, r.heights, r.ceil) };
if (o.gp) {
  const g = JSON.parse(fs.readFileSync(o.gp, 'utf8'));
  for (const k of ['theme', 'spawns', 'yaw', 'sites', 'buy', 'routes', 'holds', 'callouts', 'areas']) if (g[k]) def[k] = g[k]; // areas: فقط برای جنس کف
} else Object.assign(def, r.gameplay);
fs.writeFileSync(o.out, JSON.stringify(def));
console.log('wrote', o.out, (fs.statSync(o.out).size / 1024).toFixed(0) + ' KB');
