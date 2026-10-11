// mapLoader.js (v2) — لود فرمت json + bin تولیدشده توسط map2json.js در three.js
// دو راه:
//   const r = await loadMap('/maps/dust2.json');                 // از روی سرور
//   const r = await loadMapFromFiles(inputEl.files);             // از روی فایل‌هایی که کاربر انتخاب کرده (json + bin [+ تکسچرها])
//   scene.add(r.group);
import * as THREE from 'three';

export async function loadMap(url, opts = {}) {
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  const data = await (await fetch(url)).json();
  const buf = await (await fetch(base + data.bin)).arrayBuffer();
  return buildMap(data, buf, (ref) => (ref.startsWith('data:') ? ref : base + ref), opts);
}

// files: FileList یا آرایه‌ای از File — باید شامل <name>.json و <name>.bin باشد؛ تکسچرها اختیاری‌اند
export async function loadMapFromFiles(files, opts = {}) {
  const list = Array.from(files);
  const jsonFile = list.find((f) => /\.json$/i.test(f.name));
  if (!jsonFile) throw new Error('فایل .json مپ انتخاب نشده');
  const data = JSON.parse(await jsonFile.text());
  const binFile = list.find((f) => f.name === data.bin) || list.find((f) => /\.bin$/i.test(f.name));
  if (!binFile) throw new Error('فایل ' + data.bin + ' هم باید همراه json انتخاب بشه');
  const buf = await binFile.arrayBuffer();
  const urls = new Map(list.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name)).map((f) => [f.name, URL.createObjectURL(f)]));
  const resolve = (ref) => (ref.startsWith('data:') ? ref : urls.get(ref.split('/').pop()) || null);
  return buildMap(data, buf, resolve, opts);
}

function buildMap(data, buf, resolveTex, { castShadow = false, receiveShadow = true } = {}) {
  const texLoader = new THREE.TextureLoader();
  const cache = new Map();
  const tex = (ref, srgb) => {
    if (!ref) return null;
    if (cache.has(ref)) return cache.get(ref);
    const u = resolveTex(ref);
    if (!u) return null;
    const t = texLoader.load(u);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.flipY = false; // uv ها به سبک glTF
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    cache.set(ref, t);
    return t;
  };

  const materials = data.materials.map((m) => {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(m.color[0], m.color[1], m.color[2]),
      map: tex(m.map, true),
      normalMap: tex(m.normalMap, false),
      metalness: m.metallic ?? 0,
      roughness: m.roughness ?? 1,
      side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (m.emissive) mat.emissive = new THREE.Color(...m.emissive);
    if (m.alphaMode === 'MASK') mat.alphaTest = m.alphaCutoff ?? 0.5;
    if (m.alphaMode === 'BLEND') { mat.transparent = true; mat.opacity = m.color[3]; mat.depthWrite = false; }
    return mat;
  });

  const group = new THREE.Group();
  group.name = data.source || 'map';

  for (const g of data.geometries) {
    const geo = new THREE.BufferGeometry();
    // موقعیت‌ها uint16 فشرده‌اند؛ به float32 برمی‌گردانیم
    const q = new Uint16Array(buf, g.pos, g.vertexCount * 3);
    const pos = new Float32Array(q.length);
    const [mx, my, mz] = g.posMin, [rx, ry, rz] = g.posRange.map((v) => v / 65535);
    for (let i = 0; i < q.length; i += 3) { pos[i] = mx + q[i] * rx; pos[i + 1] = my + q[i + 1] * ry; pos[i + 2] = mz + q[i + 2] * rz; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (g.nrm !== undefined) geo.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf, g.nrm, g.vertexCount * 3), 3, true));
    if (g.uv !== undefined) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf, g.uv, g.vertexCount * 2), 2));
    const IdxArr = g.index32 ? Uint32Array : Uint16Array;
    geo.setIndex(new THREE.BufferAttribute(new IdxArr(buf, g.idx, g.indexCount), 1));
    if (g.nrm === undefined) geo.computeVertexNormals();
    geo.computeBoundingSphere();

    let obj;
    if (g.inst) {
      obj = new THREE.InstancedMesh(geo, materials[g.material], g.inst.count);
      obj.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(buf, g.inst.offset, g.inst.count * 16), 16);
      obj.frustumCulled = false;
    } else {
      obj = new THREE.Mesh(geo, materials[g.material]);
    }
    obj.name = g.name;
    obj.castShadow = castShadow;
    obj.receiveShadow = receiveShadow;
    group.add(obj);
  }

  const colliders = (data.colliders || []).map((c) => new THREE.Box3(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max)));
  const bounds = new THREE.Box3(new THREE.Vector3(...data.bounds.min), new THREE.Vector3(...data.bounds.max));
  return { group, colliders, bounds, data };
}
