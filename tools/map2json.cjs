#!/usr/bin/env node
/**
 * map2json.js v2 — تبدیل خروجی Source 2 Viewer (glTF / GLB / OBJ) به فرمت سبک برای بازی
 * خروجی: <name>.json (فهرست کوچک) + <name>.bin (داده‌ی باینری فشرده) + پوشه‌ی تکسچرها
 *
 * استفاده:
 *   node map2json.js de_dust2.glb -o public/maps/dust2.json
 *   node map2json.js de_dust2.glb -o dust2.json --info          (فقط گزارش، بدون نوشتن)
 *   node map2json.js de_dust2.glb -o dust2.json --min-size 0.3 --no-uv
 *
 * چه چیزی حجم را کم می‌کند:
 *   • مدل‌های تکراری (prop ها) فقط یک بار ذخیره می‌شوند و با ماتریس instance می‌شوند
 *   • باینری: موقعیت float32، نرمال int8، ایندکس uint16 (وقتی ممکن است)
 *   • --min-size <متر>   حذف آبجکت‌های ریز (مثلاً 0.3)
 *   • --exclude <regex>  حذف با اسم مش/متریال/نود (مثلاً "grass|foliage|decal|lod[1-9]")
 *   • --no-uv / --no-normals  حذف UV یا نرمال‌ها
 *
 * گزینه‌ها:
 *   -o, --out <file>       مسیر خروجی .json
 *   --scale <n>            مقیاس (پیش‌فرض 1). برای واحد سورس به متر: 0.0254
 *   --z-up                 تبدیل Z-up به Y-up (برای OBJ خام سورس)
 *   --collision            جعبه‌ی برخورد AABB برای هر آبجکت (در json)
 *   --instance-min <n>     آبجکتی که حداقل n بار تکرار شده instance بماند (پیش‌فرض 2)؛ بقیه ادغام می‌شوند
 *   --no-default-exclude   فیلتر پیش‌فرض (tools / nodraw / trigger / skybox) غیرفعال
 *   --embed-textures       تکسچرها base64 داخل json
 *   --info                 فقط گزارش حجم و سنگین‌ترین آبجکت‌ها
 */
'use strict';
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const o = { input: null, out: null, scale: 1, zUp: false, collision: false, exclude: null,
              defaultExclude: true, embed: false, minSize: 0, noUV: false, noNormals: false,
              instanceMin: 2, info: false, keepUV: false, targetMb: 100 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') o.out = argv[++i];
    else if (a === '--scale') o.scale = parseFloat(argv[++i]);
    else if (a === '--z-up') o.zUp = true;
    else if (a === '--collision') o.collision = true;
    else if (a === '--exclude') o.exclude = new RegExp(argv[++i], 'i');
    else if (a === '--no-default-exclude') o.defaultExclude = false;
    else if (a === '--embed-textures') o.embed = true;
    else if (a === '--min-size') o.minSize = parseFloat(argv[++i]);
    else if (a === '--no-uv') o.noUV = true;
    else if (a === '--no-normals') o.noNormals = true;
    else if (a === '--instance-min') o.instanceMin = parseInt(argv[++i], 10);
    else if (a === '--info') o.info = true;
    else if (a === '--keep-uv') o.keepUV = true;
    else if (a === '--target-mb') o.targetMb = parseFloat(argv[++i]);
    else if (a === '--no-merge') { /* قدیمی، نادیده */ }
    else if (a === '-h' || a === '--help') o.help = true;
    else if (!a.startsWith('-')) o.input = a;
    else { console.error('Unknown option: ' + a); process.exit(1); }
  }
  return o;
}

// ───────────────────────── mat4 helpers (column-major) ─────────────────────────
const I4 = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function fromTRS(t = [0,0,0], q = [0,0,0,1], s = [1,1,1]) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function det3(m) {
  return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
}
// cofactor matrix of upper 3x3 (== inverse-transpose up to scale) — برای نرمال‌ها
function cofactor3(m) {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  return [
    e * i - f * h, -(d * i - f * g), d * h - e * g,
    -(b * i - c * h), a * i - c * g, -(a * h - b * g),
    b * f - c * e, -(a * f - c * d), a * e - b * d,
  ]; // row-major rows of cofactor
}

// ───────────────────────── glTF / GLB reader ─────────────────────────
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CSIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function loadGltf(file) {
  const buf = fs.readFileSync(file);
  const dir = path.dirname(file);
  let json, glbBin = null;
  if (buf.readUInt32LE(0) === 0x46546c67) { // 'glTF'
    let off = 12;
    while (off < buf.length) {
      const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
      const data = buf.subarray(off + 8, off + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
      else if (type === 0x004e4942) glbBin = data;
      off += 8 + len;
    }
  } else json = JSON.parse(buf.toString('utf8'));

  const buffers = (json.buffers || []).map((b, i) => {
    if (b.uri === undefined) return glbBin;
    if (b.uri.startsWith('data:')) return Buffer.from(b.uri.split(',')[1], 'base64');
    return fs.readFileSync(path.join(dir, decodeURIComponent(b.uri)));
  });
  return { json, buffers, dir };
}

function readAccessor(g, idx) {
  const { json, buffers } = g;
  const a = json.accessors[idx];
  const n = NCOMP[a.type], size = CSIZE[a.componentType];
  const out = new Float64Array(a.count * n);
  if (a.bufferView !== undefined) {
    const bv = json.bufferViews[a.bufferView];
    const b = buffers[bv.buffer];
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const stride = bv.byteStride || size * n;
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const rd = {
      5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o),
      5122: (o) => dv.getInt16(o, true), 5123: (o) => dv.getUint16(o, true),
      5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true),
    }[a.componentType];
    const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 0;
    for (let i = 0; i < a.count; i++)
      for (let j = 0; j < n; j++) {
        let v = rd(base + i * stride + j * size);
        if (norm) v = Math.max(v / norm, -1);
        out[i * n + j] = v;
      }
  }
  if (a.sparse) console.warn('! sparse accessor پشتیبانی نمی‌شود (نادیده گرفته شد)');
  return out;
}


// ───────────────────────── geometry collection ─────────────────────────
// خروجی هر لودر: geoms[] که هر کدام: {name, mat, P(Float64 local), N|null, U|null, I(Uint32), diag, inst:[{M, nodeName}]}
function makeGeom(name, mat, P, N, U, I) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  return { name, mat, P, N, U, I, bmin: mn, bmax: mx, diag: Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]), inst: [] };
}

function gltfGeoms(g, opt) {
  const { json } = g;
  if (!opt.noUV && !opt.keepUV && !(json.images && json.images.length)) {
    opt.noUV = true;
    console.log('i این glTF هیچ تکسچری ندارد، پس UV ذخیره نمی‌شود (برای نگه‌داشتن: --keep-uv)');
  }
  const accCache = new Map();
  const attr = (i) => { let a = accCache.get(i); if (!a) { a = readAccessor(g, i); accCache.set(i, a); } return a; };
  let scratch = new Int32Array(0);
  const matCache = new Map();
  const imageOf = (texInfo) => {
    if (!texInfo) return null;
    const tex = (json.textures || [])[texInfo.index];
    if (!tex || tex.source === undefined) return null;
    const img = json.images[tex.source];
    const key = 'img' + tex.source;
    if (img.uri !== undefined) {
      if (img.uri.startsWith('data:')) {
        const mime = img.uri.slice(5, img.uri.indexOf(';'));
        return { key, data: Buffer.from(img.uri.split(',')[1], 'base64'), ext: mime.includes('jpeg') ? 'jpg' : 'png', name: img.name };
      }
      const p = path.join(g.dir, decodeURIComponent(img.uri));
      return { key, file: p, ext: path.extname(p).slice(1) || 'png', name: img.name || path.basename(p, path.extname(p)) };
    }
    if (img.bufferView !== undefined) {
      const bv = json.bufferViews[img.bufferView];
      const b = g.buffers[bv.buffer];
      return { key, data: b.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength), ext: (img.mimeType || '').includes('jpeg') ? 'jpg' : 'png', name: img.name };
    }
    return null;
  };
  const getMat = (idx) => {
    const k = idx === undefined ? -1 : idx;
    if (matCache.has(k)) return matCache.get(k);
    let m;
    if (idx === undefined) m = { name: 'default', color: [0.6, 0.6, 0.6, 1], doubleSided: false, alphaMode: 'OPAQUE' };
    else {
      const gm = json.materials[idx], pbr = gm.pbrMetallicRoughness || {};
      m = { name: gm.name || 'material_' + idx, color: pbr.baseColorFactor || [1, 1, 1, 1],
        metallic: pbr.metallicFactor ?? 0, roughness: pbr.roughnessFactor ?? 1, emissive: gm.emissiveFactor || [0, 0, 0],
        doubleSided: !!gm.doubleSided, alphaMode: gm.alphaMode || 'OPAQUE', alphaCutoff: gm.alphaCutoff ?? 0.5,
        _map: imageOf(pbr.baseColorTexture), _normalMap: imageOf(gm.normalTexture) };
    }
    m._id = 'gltf' + k;
    matCache.set(k, m);
    return m;
  };

  const geoms = [], cache = new Map();
  const geomsOfMesh = (meshIdx, node) => {
    if (cache.has(meshIdx)) return cache.get(meshIdx);
    const mesh = json.meshes[meshIdx];
    const list = [];
    (mesh.primitives || []).forEach((p) => {
      if ((p.mode ?? 4) !== 4 || p.attributes.POSITION === undefined) return;
      const Pall = attr(p.attributes.POSITION);
      const Nall = p.attributes.NORMAL !== undefined ? attr(p.attributes.NORMAL) : null;
      const Uall = !opt.noUV && p.attributes.TEXCOORD_0 !== undefined ? attr(p.attributes.TEXCOORD_0) : null;
      let I;
      if (p.indices !== undefined) I = Uint32Array.from(readAccessor(g, p.indices));
      else { I = new Uint32Array(Pall.length / 3); for (let i = 0; i < I.length; i++) I[i] = i; }
      // چند primitive معمولاً یک vertex buffer مشترک دارند؛ فقط رأس‌های استفاده‌شده را نگه می‌داریم
      const nvAll = Pall.length / 3;
      if (scratch.length < nvAll) scratch = new Int32Array(nvAll).fill(-1);
      const order = new Int32Array(Math.min(nvAll, I.length));
      let cnt = 0;
      for (let k = 0; k < I.length; k++) { const v = I[k]; if (scratch[v] < 0) { scratch[v] = cnt; order[cnt++] = v; } }
      const P = new Float64Array(cnt * 3), N = Nall ? new Float64Array(cnt * 3) : null, U = Uall ? new Float64Array(cnt * 2) : null;
      for (let j = 0; j < cnt; j++) {
        const v = order[j];
        P[j * 3] = Pall[v * 3]; P[j * 3 + 1] = Pall[v * 3 + 1]; P[j * 3 + 2] = Pall[v * 3 + 2];
        if (N) { N[j * 3] = Nall[v * 3]; N[j * 3 + 1] = Nall[v * 3 + 1]; N[j * 3 + 2] = Nall[v * 3 + 2]; }
        if (U) { U[j * 2] = Uall[v * 2]; U[j * 2 + 1] = Uall[v * 2 + 1]; }
      }
      for (let k = 0; k < I.length; k++) I[k] = scratch[I[k]];
      for (let j = 0; j < cnt; j++) scratch[order[j]] = -1;
      const geo = makeGeom(mesh.name || node.name || 'mesh_' + meshIdx, getMat(p.material), P, N, U, I);
      geoms.push(geo); list.push(geo);
    });
    cache.set(meshIdx, list);
    return list;
  };

  const walk = (ni, parent) => {
    const n = json.nodes[ni];
    const local = n.matrix ? n.matrix.slice() : fromTRS(n.translation, n.rotation, n.scale);
    const M = mul(parent, local);
    if (n.mesh !== undefined) for (const geo of geomsOfMesh(n.mesh, n)) geo.inst.push({ M, nodeName: n.name || '' });
    (n.children || []).forEach((c) => walk(c, M));
  };
  let roots;
  if (json.scenes && json.scenes.length) roots = json.scenes[json.scene || 0].nodes || [];
  else {
    const child = new Set();
    (json.nodes || []).forEach((n) => (n.children || []).forEach((c) => child.add(c)));
    roots = (json.nodes || []).map((_, i) => i).filter((i) => !child.has(i));
  }
  roots.forEach((r) => walk(r, I4()));
  return geoms;
}

function objGeoms(file) {
  const dir = path.dirname(file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const V = [], VT = [], VN = [];
  const mtls = new Map();
  const loadMtl = (f) => {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) return;
    let cur = null;
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((ln) => {
      const t = ln.trim().split(/\s+/);
      if (t[0] === 'newmtl') { cur = { name: t.slice(1).join(' '), color: [1, 1, 1, 1], doubleSided: false, alphaMode: 'OPAQUE', _id: 'obj:' + t.slice(1).join(' ') }; mtls.set(cur.name, cur); }
      else if (!cur) return;
      else if (t[0] === 'Kd') cur.color = [+t[1], +t[2], +t[3], cur.color[3]];
      else if (t[0] === 'd') { cur.color[3] = +t[1]; if (+t[1] < 1) cur.alphaMode = 'BLEND'; }
      else if (t[0] === 'map_Kd') {
        const fp = path.join(dir, t.slice(1).join(' ').replace(/\\/g, '/'));
        cur._map = { key: 'objtex:' + fp, file: fp, ext: path.extname(fp).slice(1) || 'png', name: path.basename(fp, path.extname(fp)) };
      }
    });
  };
  const defMat = { name: 'default', color: [0.6, 0.6, 0.6, 1], doubleSided: false, alphaMode: 'OPAQUE', _id: 'obj:default' };
  let curMat = defMat, curName = 'obj';
  const groups = new Map();
  const getG = () => {
    const k = curMat._id + '|' + curName;
    if (!groups.has(k)) groups.set(k, { name: curName, mat: curMat, P: [], N: [], U: [], idx: [], map: new Map(), hasN: true, hasU: true });
    return groups.get(k);
  };
  const rel = (s, len) => { const i = parseInt(s, 10); return i < 0 ? len + i : i - 1; };
  for (const ln of lines) {
    const t = ln.trim().split(/\s+/);
    switch (t[0]) {
      case 'v': V.push([+t[1], +t[2], +t[3]]); break;
      case 'vt': VT.push([+t[1], +t[2]]); break;
      case 'vn': VN.push([+t[1], +t[2], +t[3]]); break;
      case 'mtllib': loadMtl(t.slice(1).join(' ')); break;
      case 'usemtl': curMat = mtls.get(t.slice(1).join(' ')) || { ...defMat, name: t.slice(1).join(' '), _id: 'obj:' + t.slice(1).join(' ') }; break;
      case 'o': case 'g': curName = t.slice(1).join(' ') || 'obj'; break;
      case 'f': {
        const g = getG();
        const ids = t.slice(1).map((tok) => {
          if (g.map.has(tok)) return g.map.get(tok);
          const [a, b, c] = tok.split('/');
          const v = V[rel(a, V.length)];
          g.P.push(v[0], v[1], v[2]);
          if (b) { const u = VT[rel(b, VT.length)]; g.U.push(u[0], 1 - u[1]); } else g.hasU = false; // v را برای قرارداد glTF برعکس می‌کنیم
          if (c) { const n = VN[rel(c, VN.length)]; g.N.push(n[0], n[1], n[2]); } else g.hasN = false;
          const id = g.P.length / 3 - 1;
          g.map.set(tok, id);
          return id;
        });
        for (let i = 1; i < ids.length - 1; i++) g.idx.push(ids[0], ids[i], ids[i + 1]);
        break;
      }
    }
  }
  return [...groups.values()].filter((g) => g.idx.length).map((g) => {
    const geo = makeGeom(g.name, g.mat, Float64Array.from(g.P),
      g.hasN && g.N.length === g.P.length ? Float64Array.from(g.N) : null,
      g.hasU && g.U.length / 2 === g.P.length / 3 ? Float64Array.from(g.U) : null,
      Uint32Array.from(g.idx));
    geo.inst.push({ M: I4(), nodeName: g.name });
    return geo;
  });
}

function computeNormals(P, idx) {
  const N = new Float64Array(P.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
  }
  return N;
}


const r3 = (x) => Math.round(x * 1e3) / 1e3;
const safe = (s) => String(s || 'tex').replace(/[^\w.-]+/g, '_').slice(0, 60);

// ادغام آبجکت‌های تک‌نمونه در world-space
const MAXV = 65535; // تا ایندکس‌ها uint16 بمانند
const grow = (a, n, T) => { const b = new T(n); b.set(a); return b; };
class Chunk {
  constructor(mat) { this.mat = mat; this.nv = 0; this.ni = 0; this.vcap = 4096; this.icap = 12288;
    this.P = new Float32Array(this.vcap * 3); this.N = new Float32Array(this.vcap * 3); this.U = new Float32Array(this.vcap * 2); this.I = new Uint32Array(this.icap); }
  reserve(av, ai) {
    if (this.nv + av > this.vcap) { while (this.nv + av > this.vcap) this.vcap *= 2;
      this.P = grow(this.P, this.vcap * 3, Float32Array); this.N = grow(this.N, this.vcap * 3, Float32Array); this.U = grow(this.U, this.vcap * 2, Float32Array); }
    if (this.ni + ai > this.icap) { while (this.ni + ai > this.icap) this.icap *= 2; this.I = grow(this.I, this.icap, Uint32Array); }
  }
}
function bake(chunk, geo, M) {
  const nv = geo.P.length / 3, ni = geo.I.length;
  chunk.reserve(nv, ni);
  const base = chunk.nv, C = cofactor3(M), P = geo.P, N = geo.N;
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], o = (base + i) * 3;
    chunk.P[o] = M[0] * x + M[4] * y + M[8] * z + M[12];
    chunk.P[o + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
    chunk.P[o + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
    if (N) {
      const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      let ax = C[0] * nx + C[1] * ny + C[2] * nz, ay = C[3] * nx + C[4] * ny + C[5] * nz, az = C[6] * nx + C[7] * ny + C[8] * nz;
      const l = Math.hypot(ax, ay, az) || 1;
      chunk.N[o] = ax / l; chunk.N[o + 1] = ay / l; chunk.N[o + 2] = az / l;
    }
    chunk.U[(base + i) * 2] = geo.U ? geo.U[i * 2] : 0;
    chunk.U[(base + i) * 2 + 1] = geo.U ? geo.U[i * 2 + 1] : 0;
  }
  const flip = det3(M) < 0;
  for (let i = 0; i < ni; i += 3) {
    chunk.I[chunk.ni + i] = geo.I[i] + base;
    chunk.I[chunk.ni + i + 1] = geo.I[i + (flip ? 2 : 1)] + base;
    chunk.I[chunk.ni + i + 2] = geo.I[i + (flip ? 1 : 2)] + base;
  }
  chunk.nv += nv; chunk.ni += ni;
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help || !opt.input) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace('#!/usr/bin/env node\n', '').replace('/**\n', ''));
    process.exit(opt.help ? 0 : 1);
  }
  if (!fs.existsSync(opt.input)) {
    console.error('فایل پیدا نشد: ' + path.resolve(opt.input));
    const dir = path.dirname(path.resolve(opt.input));
    const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(glb|gltf|obj)$/i.test(f)) : [];
    console.error(found.length ? 'فایل‌های قابل استفاده در این پوشه:\n  ' + found.join('\n  ') : 'هیچ فایل glb/gltf/obj در این پوشه نیست.');
    process.exit(1);
  }
  const ext = path.extname(opt.input).toLowerCase();
  const out = opt.out || opt.input.replace(/\.[^.]+$/, '') + '.json';
  const binPath = out.replace(/\.json$/i, '') + '.bin';

  let geoms;
  if (ext === '.glb' || ext === '.gltf') geoms = gltfGeoms(loadGltf(opt.input), opt);
  else if (ext === '.obj') geoms = objGeoms(opt.input);
  else { console.error('فرمت پشتیبانی نمی‌شود. از Source 2 Viewer خروجی glTF/GLB یا OBJ بگیر.'); process.exit(1); }

  const s = opt.scale;
  const G = opt.zUp ? [s, 0, 0, 0, 0, 0, -s, 0, 0, s, 0, 0, 0, 0, 0, 1] : [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
  const defEx = /tools\/|toolsnodraw|nodraw|toolstrigger|trigger|skybox|blocklight|toolsclip|toolsplayerclip|toolsinvisible/i;

  // آمار قبل از فیلتر
  let rawInst = 0, rawTris = 0;
  for (const g of geoms) { rawInst += g.inst.length; rawTris += (g.I.length / 3) * g.inst.length; }
  console.log(`ورودی: ${geoms.length} مدل یکتا، ${rawInst} نمونه، ${Math.round(rawTris).toLocaleString()} مثلث (با احتساب تکرار)`);

  // فیلتر + ماتریس نهایی
  let dropped = 0;
  for (const g of geoms) {
    g.inst = g.inst.filter((it) => {
      const str = g.name + ' ' + it.nodeName + ' ' + g.mat.name;
      if ((opt.defaultExclude && defEx.test(str)) || (opt.exclude && opt.exclude.test(str))) { dropped++; return false; }
      it.M = mul(G, it.M);
      it.size = g.diag * Math.max(Math.hypot(it.M[0], it.M[1], it.M[2]), Math.hypot(it.M[4], it.M[5], it.M[6]), Math.hypot(it.M[8], it.M[9], it.M[10]));
      return true;
    });
  }
  // تخمین حجم .bin برای یک حد کوچک‌ترین اندازه
  const estimate = (minSize, noUV) => {
    let bytes = 0, tris = 0;
    for (const g of geoms) {
      const nv = g.P.length / 3, ni = g.I.length;
      const n = g.inst.filter((it) => it.size >= minSize).length;
      if (!n) continue;
      tris += (ni / 3) * n;
      const per = nv * (6 + 3 + (noUV || !g.U ? 0 : 8)) + ni * (nv > 65535 ? 4 : 2);
      bytes += n >= opt.instanceMin ? per + 64 * n : per * n;
    }
    return { bytes, tris };
  };
  if (opt.targetMb > 0 && estimate(opt.minSize, opt.noUV).bytes > opt.targetMb * 1048576) {
    console.log(`\nحجم تخمینی بیشتر از هدف (${opt.targetMb} MB) است؛ تنظیم خودکار:`);
    if (!opt.noUV && geoms.some((g) => g.U) && estimate(opt.minSize, true).bytes <= opt.targetMb * 1048576) {
      console.log('  • UV حذف شد'); opt.noUV = true;
    } else {
      let ok = false;
      for (const ms of [0.05, 0.1, 0.2, 0.4, 0.8, 1.5, 3]) {
        if (ms <= opt.minSize) continue;
        if (estimate(ms, opt.noUV).bytes <= opt.targetMb * 1048576) { console.log(`  • --min-size ${ms} متر اعمال شد`); opt.minSize = ms; ok = true; break; }
      }
      if (!ok) { opt.minSize = 3; opt.noUV = true; console.log('  • ✖ به هدف نرسید؛ با min-size=3 و بدون UV ادامه می‌دهم (فیلتر --exclude بزن)'); }
    }
  }
  if (opt.minSize > 0) for (const g of geoms) g.inst = g.inst.filter((it) => { if (it.size < opt.minSize) { dropped++; return false; } return true; });
  geoms = geoms.filter((g) => g.inst.length);
  console.log(`حذف‌شده توسط فیلترها: ${dropped} نمونه`);

  // گزارش سنگین‌ترین‌ها
  const rank = geoms.map((g) => ({ name: g.name, mat: g.mat.name, n: g.inst.length, tris: g.I.length / 3, total: (g.I.length / 3) * g.inst.length }))
    .sort((a, b) => b.total - a.total).slice(0, 12);
  console.log('\nسنگین‌ترین آبجکت‌ها (مثلث × تعداد):');
  rank.forEach((r) => console.log(`  ${String(r.total).padStart(10)}  ${r.name} [${r.mat}]  ${r.tris} مثلث × ${r.n}`));
  // گروه‌بندی بر اساس پیشوند اسم (برای فهمیدن اینکه حجم از کجاست)
  const grp = new Map();
  for (const g of geoms) {
    const key = g.name.split('_').slice(0, 2).join('_').replace(/\d{3,}/g, '#');
    const e = grp.get(key) || { tris: 0, objs: 0 };
    e.tris += (g.I.length / 3) * g.inst.length; e.objs += g.inst.length; grp.set(key, e);
  }
  console.log('\nمجموع مثلث‌ها بر اساس پیشوند اسم:');
  [...grp.entries()].sort((a, b) => b[1].tris - a[1].tris).slice(0, 10)
    .forEach(([k, e]) => console.log(`  ${String(Math.round(e.tris)).padStart(11)}  ${k}  (${e.objs} آبجکت)`));

  const fin = estimate(0, opt.noUV);
  const estBytes = fin.bytes, finalTris = fin.tris;
  console.log(`\nمجموع مثلث بعد از فیلتر: ${Math.round(finalTris).toLocaleString()} — حجم تخمینی .bin: ${(estBytes / 1048576).toFixed(0)} MB`);
  try {
    const dirp = path.dirname(path.resolve(opt.out || opt.input));
    const st = fs.statfsSync(dirp);
    const free = st.bavail * st.bsize;
    console.log(`فضای خالی دیسک: ${(free / 1073741824).toFixed(2)} GB`);
    if (!opt.info && estBytes * 1.15 > free) {
      console.error('\n✖ فضای دیسک کافی نیست. فایل‌های خروجی قبلی (مثل json ۵ گیگی) را پاک کن یا خروجی را روی درایو دیگری بگیر (-o)، یا فیلترها را قوی‌تر کن.');
      process.exit(1);
    }
  } catch (e) { /* statfs در همه‌جا نیست */ }
  if (opt.info) { console.log('\n--info: چیزی نوشته نشد.'); return; }

  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  // متریال‌ها و تکسچرها
  const texDir = path.join(path.dirname(path.resolve(out)), path.basename(out, '.json') + '_textures');
  const texDone = new Map();
  const saveTex = (img) => {
    if (!img) return null;
    if (texDone.has(img.key)) return texDone.get(img.key);
    let data = img.data;
    if (!data && img.file && fs.existsSync(img.file)) data = fs.readFileSync(img.file);
    if (!data) { console.warn('! تکسچر پیدا نشد: ' + (img.file || img.name)); texDone.set(img.key, null); return null; }
    let ref;
    if (opt.embed) ref = `data:image/${img.ext === 'jpg' ? 'jpeg' : img.ext};base64,` + data.toString('base64');
    else {
      fs.mkdirSync(texDir, { recursive: true });
      const fn = safe(img.name || img.key) + '_' + texDone.size + '.' + img.ext;
      fs.writeFileSync(path.join(texDir, fn), data);
      ref = path.basename(texDir) + '/' + fn;
    }
    texDone.set(img.key, ref);
    return ref;
  };
  const matIndex = new Map(), materials = [];
  const matOf = (m) => {
    if (matIndex.has(m._id)) return matIndex.get(m._id);
    const o = { name: m.name, color: m.color.map(r3), doubleSided: m.doubleSided, alphaMode: m.alphaMode };
    if (m.alphaMode === 'MASK') o.alphaCutoff = m.alphaCutoff;
    if (m.metallic !== undefined) { o.metallic = m.metallic; o.roughness = m.roughness; }
    if (m.emissive && m.emissive.some((v) => v > 0)) o.emissive = m.emissive;
    const map = saveTex(m._map); if (map) o.map = map;
    const nm = saveTex(m._normalMap); if (nm) o.normalMap = nm;
    materials.push(o);
    matIndex.set(m._id, materials.length - 1);
    return materials.length - 1;
  };

  // نوشتن باینری
  const fd = fs.openSync(binPath, 'w');
  let off = 0;
  const addBin = (arr) => {
    const pad = (4 - (off % 4)) % 4;
    if (pad) { fs.writeSync(fd, Buffer.alloc(pad)); off += pad; }
    const start = off;
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    let w = 0;
    while (w < buf.length) w += fs.writeSync(fd, buf, w, Math.min(buf.length - w, 1 << 28));
    off += buf.length;
    return start;
  };
  const q8 = (src, n) => { const o = new Int8Array(n); for (let i = 0; i < n; i++) o[i] = Math.round(Math.max(-1, Math.min(1, src[i])) * 127); return o; };

  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const expand = (mn, mx) => { for (let k = 0; k < 3; k++) { if (mn[k] < min[k]) min[k] = mn[k]; if (mx[k] > max[k]) max[k] = mx[k]; } };
  const worldBox = (geo, M) => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      const x = c & 1 ? geo.bmax[0] : geo.bmin[0], y = c & 2 ? geo.bmax[1] : geo.bmin[1], z = c & 4 ? geo.bmax[2] : geo.bmin[2];
      const w = [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
      for (let k = 0; k < 3; k++) { if (w[k] < mn[k]) mn[k] = w[k]; if (w[k] > mx[k]) mx[k] = w[k]; }
    }
    return [mn, mx];
  };

  const outGeoms = [], colliders = [], chunkByMat = new Map(), chunks = [];
  let storedTris = 0, drawnTris = 0, instancedCount = 0, bakedCount = 0;

  const writeGeom = (name, mat, nv, P, N, U, I, instMats) => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const v = P[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    const rg = mx.map((v, k) => (v - mn[k]) || 1);
    const Q = new Uint16Array(nv * 3);
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) Q[i * 3 + k] = Math.round(((P[i * 3 + k] - mn[k]) / rg[k]) * 65535);
    const e = { name, material: mat, vertexCount: nv, indexCount: I.length, index32: nv > 65535, posMin: mn, posRange: rg, pos: addBin(Q) };
    if (N && !opt.noNormals) e.nrm = addBin(N);
    if (U && !opt.noUV) e.uv = addBin(U);
    e.idx = addBin(e.index32 ? I : Uint16Array.from(I));
    if (instMats) { e.inst = { offset: addBin(instMats), count: instMats.length / 16 }; }
    outGeoms.push(e);
  };

  for (const g of geoms) {
    const mat = matOf(g.mat);
    if (!g.N && !opt.noNormals) g.N = computeNormals(g.P, g.I);
    if (opt.collision) for (const it of g.inst) { const [mn, mx] = worldBox(g, it.M); colliders.push({ name: g.name, min: mn.map(r3), max: mx.map(r3) }); }
    const pos = g.inst.filter((it) => det3(it.M) >= 0), neg = g.inst.filter((it) => det3(it.M) < 0);
    let toBake = neg, toInst = pos;
    if (pos.length < opt.instanceMin) { toBake = g.inst; toInst = []; }
    if (toInst.length) {
      const nv = g.P.length / 3;
      const mats = new Float32Array(toInst.length * 16);
      toInst.forEach((it, i) => mats.set(it.M, i * 16));
      writeGeom(g.name, mat, nv, g.P, g.N ? q8(g.N, g.N.length) : null, g.U ? Float32Array.from(g.U) : null, g.I, mats);
      storedTris += g.I.length / 3; drawnTris += (g.I.length / 3) * toInst.length; instancedCount += toInst.length;
      for (const it of toInst) { const [mn, mx] = worldBox(g, it.M); expand(mn, mx); }
    }
    for (const it of toBake) {
      let c = chunkByMat.get(mat);
      const nv = g.P.length / 3;
      if (!c || (c.nv > 0 && c.nv + nv > MAXV)) { c = new Chunk(mat); chunkByMat.set(mat, c); chunks.push(c); }
      bake(c, g, it.M);
      storedTris += g.I.length / 3; drawnTris += g.I.length / 3; bakedCount++;
      const [mn, mx] = worldBox(g, it.M); expand(mn, mx);
    }
    // اگر chunk ها زیاد شدند، فوراً بنویس تا RAM پر نشود
    if (chunks.length > 64) { for (const c of chunks) flushChunk(c); chunks.length = 0; chunkByMat.clear(); }
  }
  function flushChunk(c) {
    if (!c.nv) return;
    writeGeom('merged:' + materials[c.mat].name, c.mat, c.nv, c.P.subarray(0, c.nv * 3), q8(c.N, c.nv * 3), c.U.subarray(0, c.nv * 2), c.I.subarray(0, c.ni), null);
    c.P = c.N = c.U = c.I = null;
  }
  for (const c of chunks) flushChunk(c);
  fs.closeSync(fd);

  const manifest = {
    format: 'cs-map-bin', version: 2, units: 'meters', up: 'Y', source: path.basename(opt.input),
    bin: path.basename(binPath),
    bounds: { min: min.map(r3), max: max.map(r3) },
    stats: { geometries: outGeoms.length, instancedObjects: instancedCount, bakedObjects: bakedCount, storedTriangles: Math.round(storedTris), drawnTriangles: Math.round(drawnTris) },
    materials, geometries: outGeoms,
  };
  if (opt.collision) manifest.colliders = colliders;
  fs.writeFileSync(out, JSON.stringify(manifest));
  const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
  console.log(`\n✔ ${out} (${mb(fs.statSync(out).size)}) + ${path.basename(binPath)} (${mb(fs.statSync(binPath).size)})`);
  console.log(`  ${outGeoms.length} geometry، ${instancedCount} instance، ${bakedCount} آبجکت ادغام‌شده، مثلث ذخیره‌شده ${Math.round(storedTris).toLocaleString()} / رندرشده ${Math.round(drawnTris).toLocaleString()}`);
  if (!opt.embed && texDone.size) console.log(`  تکسچرها: ${texDir}`);
}

main();
