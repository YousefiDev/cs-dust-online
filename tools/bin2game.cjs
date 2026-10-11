#!/usr/bin/env node
'use strict';
/**
 * bin2game.cjs — خروجی map2json (<name>.json + <name>.bin) -> مپ قابل‌بازی (فیلد grid)
 *
 * چرا لازم است؟
 *   خروجی map2json (format: "cs-map-bin") فقط «مش برای نمایش» است. بازی با مش کار نمی‌کند؛
 *   فیزیک/بات/تیراندازی روی یک شبکه‌ی ۱×۱ متری با ارتفاع کف و سقف هر خانه (def.grid) اجرا می‌شود
 *   و به spawns / sites / buy / holds / theme هم نیاز دارد. این ابزار مش را voxel می‌کند و همه‌ی اینها را می‌سازد.
 *
 * pipeline:
 *   Source 2 Viewer (glb/gltf/obj) --map2json.cjs--> dust2.json + dust2.bin --bin2game.cjs--> dust2_game.json
 *   --> ادیتور مپ، «ورود JSON» (نه «بارگذاری JSON مپ (CS2)») --> ذخیره --> بازی
 *
 * استفاده:
 *   node tools/bin2game.cjs dust2.json -o maps/dust2_game.json --id dust2_game --name "Dust II"
 *   node tools/bin2game.cjs dust2.json --info                       (فقط محدوده/آمار، بدون voxel)
 *   node tools/bin2game.cjs dust2.json --bounds -50,-101,115,75 --ymin -9 --ymax 37
 *   node tools/bin2game.cjs dust2.json --gameplay maps/dust2_cs.json   (اسپاون/سایت/تم از یک JSON قبلی با همان مبدأ مختصات)
 *
 * گزینه‌ها:
 *   -o <file>              خروجی (پیش‌فرض: <id>.json کنار ورودی)
 *   --bin <file>           فایل .bin اگر کنار json نیست
 *   --id / --name          شناسه (a-z 0-9 _ - ، ۲ تا ۳۲ حرف) و نام مپ
 *   --bounds x0,z0,x1,z1   محدوده‌ی مپ به متر (مختصات جهانی). پیش‌فرض: خودکار (صدک ۰.۲٪..۹۹.۸٪ مثلث‌ها + حاشیه)
 *   --ymin / --ymax        محدوده‌ی ارتفاع. پیش‌فرض: خودکار (حداکثر ۹۰ متر)
 *   --voxel <m>            اندازه‌ی voxel افقی (باید ۱ را عادلانه تقسیم کند؛ پیش‌فرض 0.25)
 *   --voxel-y <m>          اندازه‌ی voxel عمودی (پیش‌فرض 0.1)
 *   --exclude <regex>      حذف با اسم مش/متریال
 *   --no-junk              فیلتر پیش‌فرض آبجکت‌های بی‌اثر (سیم، پنجره، علف، ...) غیرفعال
 *   --keep-blend           متریال‌های شفاف (شیشه/دکال) هم حساب شوند (پیش‌فرض: حذف)
 *   --gameplay <json>      spawns/yaw/sites/buy/routes/holds/callouts/theme/areas را از این JSON بردار
 *   --info                 فقط گزارش
 */
const fs = require('fs'), path = require('path');
const { pathToFileURL } = require('url');
const { buildGrid, encodeGrid, DEFAULT_THEME } = require('./gamegrid.cjs');

// ───────────── args ─────────────
const o = { voxel: 0.25, voxelY: 0.1, junk: true, keepBlend: false, info: false };
const a = process.argv.slice(2);
for (let i = 0; i < a.length; i++) {
  const k = a[i];
  if (k === '-o' || k === '--out') o.out = a[++i];
  else if (k === '--bin') o.bin = a[++i];
  else if (k === '--id') o.id = a[++i];
  else if (k === '--name') o.name = a[++i];
  else if (k === '--bounds') o.bounds = a[++i].split(',').map(Number);
  else if (k === '--ymin') o.ymin = +a[++i];
  else if (k === '--ymax') o.ymax = +a[++i];
  else if (k === '--voxel') o.voxel = +a[++i];
  else if (k === '--voxel-y') o.voxelY = +a[++i];
  else if (k === '--exclude') o.exclude = new RegExp(a[++i], 'i');
  else if (k === '--no-junk') o.junk = false;
  else if (k === '--keep-blend') o.keepBlend = true;
  else if (k === '--gameplay') o.gp = a[++i];
  else if (k === '--info') o.info = true;
  else if (k === '-h' || k === '--help') o.help = true;
  else if (!k.startsWith('-')) o.input = k;
  else { console.error('گزینه‌ی ناشناخته: ' + k); process.exit(1); }
}
if (o.help || !o.input) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, '').replace('/**\n', ''));
  process.exit(o.help ? 0 : 1);
}
const fail = (m) => { console.error('✖ ' + m); process.exit(1); };
if (!fs.existsSync(o.input)) fail('فایل پیدا نشد: ' + path.resolve(o.input));
if (Math.abs(1 / o.voxel - Math.round(1 / o.voxel)) > 1e-6) fail('--voxel باید ۱ متر را عادلانه تقسیم کند (۰.۱۲۵ / ۰.۲ / ۰.۲۵ / ۰.۵ / ۱)');

// ───────────── manifest + bin ─────────────
const man = JSON.parse(fs.readFileSync(o.input, 'utf8'));
if (man.grid) fail('این فایل از قبل یک مپ قابل‌بازی (def.grid) است؛ مستقیم در ادیتور «ورود JSON» کن.');
if (man.format !== 'cs-map-bin') fail('این فایل خروجی map2json نیست (format=' + man.format + '). اگر world.gltf خام است از tools/gltf2game.cjs استفاده کن.');
const binPath = o.bin || path.resolve(path.dirname(o.input), man.bin);
if (!fs.existsSync(binPath)) fail('فایل .bin پیدا نشد: ' + binPath + ' (با --bin مسیرش را بده)');
const raw = fs.readFileSync(binPath);
const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength); // کپی تراز‌شده برای typed array
console.log(`ورودی: ${path.basename(o.input)} — ${man.geometries.length} geometry، ${man.materials.length} متریال، ${(raw.length / 1048576).toFixed(1)} MB bin`);

// فقط چیزهایی که برای برخورد/ایستادن اهمیت ندارند (همان فهرست gltf2game)
const JUNK = /blocklight|overlay|steam|lightshaft|palm_frond|wire|power_pole|hammer_mesh|lantern|satellite|chainlink|window_bars|ladder|cart_|awning|garbage|electric|breeze|dust_door_|rollupdoor|window_frame|windows_|kasbah_windows|window_insets|vents|braces|rope|ornament|trim_decoractive|metal_trim|foliage|grass|decal|glass/i;
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const items = []; // {P, I, M[], tris, boxes[]}
let skipped = 0, skippedInst = 0;
for (const g of man.geometries) {
  const mat = man.materials[g.material] || {};
  const label = g.name + ' ' + (mat.name || '');
  const nInst = g.inst ? g.inst.count : 1;
  if ((o.junk && JUNK.test(label)) || (o.exclude && o.exclude.test(label)) || (!o.keepBlend && mat.alphaMode === 'BLEND')) { skipped++; skippedInst += nInst; continue; }
  const q = new Uint16Array(ab, g.pos, g.vertexCount * 3);
  const P = new Float64Array(q.length);
  const [mx, my, mz] = g.posMin, [rx, ry, rz] = g.posRange.map((v) => v / 65535);
  for (let i = 0; i < q.length; i += 3) { P[i] = mx + q[i] * rx; P[i + 1] = my + q[i + 1] * ry; P[i + 2] = mz + q[i + 2] * rz; }
  const I = g.index32 ? Uint32Array.from(new Uint32Array(ab, g.idx, g.indexCount)) : Uint32Array.from(new Uint16Array(ab, g.idx, g.indexCount));
  const Ms = [];
  if (g.inst) for (let i = 0; i < g.inst.count; i++) Ms.push(Array.from(new Float32Array(ab, g.inst.offset + i * 64, 16)));
  else Ms.push(IDENT.slice());
  const lo = g.posMin, hi = [mx + g.posRange[0], my + g.posRange[1], mz + g.posRange[2]];
  const boxes = Ms.map((M) => {
    const mn = [Infinity, Infinity, Infinity], mxx = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      const x = c & 1 ? hi[0] : lo[0], y = c & 2 ? hi[1] : lo[1], z = c & 4 ? hi[2] : lo[2];
      const w = [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
      for (let k = 0; k < 3; k++) { if (w[k] < mn[k]) mn[k] = w[k]; if (w[k] > mxx[k]) mxx[k] = w[k]; }
    }
    return [mn, mxx];
  });
  items.push({ P, I, Ms, boxes, tris: I.length / 3, name: g.name });
}
if (!items.length) fail('بعد از فیلترها هیچ هندسه‌ای نماند (--no-junk را امتحان کن).');
console.log(`فیلتر: ${skipped} geometry (${skippedInst} نمونه) حذف شد (سیم/پنجره/علف/شیشه/...)، ${items.length} ماند`);

// ───────────── bounds ─────────────
function wq(vals, wts, p) { // صدک وزنی
  const idx = vals.map((_, i) => i).sort((x, y) => vals[x] - vals[y]);
  let tot = 0; for (const w of wts) tot += w;
  let c = 0; for (const i of idx) { c += wts[i]; if (c >= tot * p) return vals[i]; }
  return vals[idx[idx.length - 1]];
}
let [bx0, bz0, bx1, bz1] = o.bounds || [];
let ymin = o.ymin, ymax = o.ymax;
if (!o.bounds || ymin === undefined || ymax === undefined) {
  const cx = [], cz = [], y0 = [], y1 = [], w = [];
  for (const it of items) it.boxes.forEach(([mn, mx]) => { cx.push((mn[0] + mx[0]) / 2); cz.push((mn[2] + mx[2]) / 2); y0.push(mn[1]); y1.push(mx[1]); w.push(it.tris); });
  if (!o.bounds) {
    const PAD = 6;
    bx0 = Math.floor(wq(cx, w, 0.002) - PAD); bx1 = Math.ceil(wq(cx, w, 0.998) + PAD);
    bz0 = Math.floor(wq(cz, w, 0.002) - PAD); bz1 = Math.ceil(wq(cz, w, 0.998) + PAD);
  }
  if (ymin === undefined) ymin = Math.floor(wq(y0, w, 0.002) - 1);
  if (ymax === undefined) ymax = Math.ceil(wq(y1, w, 0.998) + 1);
  if (ymax - ymin > 90) { console.log(`! ارتفاع خودکار ${ymax - ymin} متر شد؛ به ۹۰ متر محدود شد (--ymin/--ymax بده)`); ymax = ymin + 90; }
}
const W = Math.ceil(bx1 - bx0), H = Math.ceil(bz1 - bz0);
console.log(`محدوده‌ی مپ (متر): x ${bx0}..${bx1} ، z ${bz0}..${bz1} ، y ${ymin}..${ymax}  →  شبکه‌ی ${W}×${H}`);
console.log(`  (bounds ثبت‌شده در json: x ${man.bounds.min[0]}..${man.bounds.max[0]} ، z ${man.bounds.min[2]}..${man.bounds.max[2]} ، y ${man.bounds.min[1]}..${man.bounds.max[1]})`);
if (W < 20 || H < 20) fail('مپ خیلی کوچک شد؛ --bounds را دستی بده.');
if (W > 500 || H > 500) console.log('! شبکه خیلی بزرگ است؛ احتمالاً اسکای‌باکس/آبجکت دور وارد محدوده شده. با --bounds محدود کن.');
if (o.info) { console.log('--info: چیزی نوشته نشد.'); process.exit(0); }

// ───────────── geoms برای buildGrid ─────────────
const geoms = []; let inst = 0, outside = 0;
for (const it of items) {
  const list = [];
  it.Ms.forEach((M, i) => {
    const [mn, mx] = it.boxes[i];
    if (mx[0] < bx0 || mn[0] > bx1 || mx[2] < bz0 || mn[2] > bz1 || mx[1] < ymin - 2 || mn[1] > ymax + 2) { outside++; return; }
    const N = M.slice(); N[12] -= bx0; N[13] -= ymin; N[14] -= bz0; list.push({ M: N }); inst++;
  });
  if (list.length) geoms.push({ P: it.P, I: it.I, inst: list });
}
console.log(`نمونه‌ها: ${inst} داخل محدوده، ${outside} بیرون محدوده (نادیده)`);
if (!inst) fail('هیچ نمونه‌ای داخل محدوده نیست؛ --bounds را بررسی کن.');
console.log('voxelizing (ممکن است چند دقیقه طول بکشد)...');
const r = buildGrid(geoms, W, H, ymax - ymin, { voxel: o.voxel, voxelY: o.voxelY }, (s) => console.log(s));
r.report.forEach((s) => console.log(s));

// ───────────── def ─────────────
let id = (o.id || path.basename(o.input, path.extname(o.input))).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 32);
if (id.length < 2) id = id.padEnd(2, '_');
const def = { id, name: o.name || id, size: [W, H], scale: 1, cs2: true, areas: [], ramps: [], roofs: [], crates: [], doors: [], lamps: [], props: [], grid: encodeGrid(W, H, r.heights, r.ceil) };
if (o.gp) {
  const g = JSON.parse(fs.readFileSync(o.gp, 'utf8'));
  for (const k of ['theme', 'spawns', 'yaw', 'sites', 'buy', 'routes', 'holds', 'callouts', 'areas']) if (g[k]) def[k] = g[k]; // areas: فقط برای جنس کف
} else Object.assign(def, r.gameplay);
def.theme = def.theme || DEFAULT_THEME;

const out = o.out || path.join(path.dirname(path.resolve(o.input)), id + '.json');
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const text = JSON.stringify(def);
fs.writeFileSync(out, text);
console.log(`\n✔ wrote ${out} (${(text.length / 1024).toFixed(0)} KB) — id=${id}`);
if (text.length > 1900000) console.log('! حجم JSON از حد سرور (۱.۹ میلیون کاراکتر) بیشتر است؛ ذخیره در Worker رد می‌شود. --voxel 0.5 یا محدوده‌ی کوچک‌تر بزن.');

// ───────────── اعتبارسنجی با خود موتور بازی ─────────────
(async () => {
  try {
    const { buildMap } = await import(pathToFileURL(path.resolve(__dirname, '../shared/maps.js')).href);
    const m = buildMap(def), { W: mw, H: mh } = m, WALL = 99;
    const ok = (i) => m.heights[i] < WALL && m.ceil[i] - m.floor[i] >= 1.85;
    let walk = 0; for (let i = 0; i < mw * mh; i++) if (ok(i)) walk++;
    const reach = (sx, sz) => {
      const seen = new Uint8Array(mw * mh), q = [sz * mw + sx]; seen[q[0]] = 1;
      for (let h = 0; h < q.length; h++) {
        const i = q[h], x = i % mw, z = (i / mw) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= mw || zz >= mh) continue;
          const j = zz * mw + xx; if (seen[j] || !ok(j) || Math.abs(m.floor[j] - m.floor[i]) > 0.55) continue;
          seen[j] = 1; q.push(j);
        }
      }
      return seen;
    };
    const t0 = def.spawns.T[0], seen = reach(t0[0], t0[1]);
    const spawnOk = ['T', 'CT'].every((t) => def.spawns[t].every(([x, z]) => ok(z * mw + x)));
    const toCT = def.spawns.CT.some(([x, z]) => seen[z * mw + x]);
    const toSite = Object.fromEntries(Object.entries(def.sites).map(([k, rc]) => { let n = 0; for (let z = rc[1]; z < rc[3]; z++) for (let x = rc[0]; x < rc[2]; x++) if (seen[z * mw + x]) n++; return [k, n > 0]; }));
    console.log(`\nبررسی با موتور بازی: خانه‌ی قابل‌ایستادن=${walk} | اسپاون‌ها روی زمین=${spawnOk ? 'بله' : 'خیر ✖'} | T→CT=${toCT ? 'بله' : 'خیر ✖'} | T→سایت‌ها=${JSON.stringify(toSite)}`);
    if (!spawnOk || !toCT) console.log('! مپ درست قابل‌بازی نیست: bounds/ymin/ymax یا --voxel را عوض کن، یا اسپاون‌ها را در ادیتور اصلاح کن.');
  } catch (e) { console.log('! اعتبارسنجی انجام نشد: ' + e.message); }
})();
