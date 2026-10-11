import * as THREE from 'three';

// Loader for the project's cs-map-bin v2 format. Offsets are byte offsets in dust2.bin.
export async function loadMapFromFiles(files) {
  const jsonFile = files.find(f => /\.json$/i.test(f.name));
  const binFile = files.find(f => /\.bin$/i.test(f.name));
  if (!jsonFile) throw new Error('فایل JSON مپ انتخاب نشده است.');
  if (!binFile) throw new Error('فایل BIN متناظر با مپ هم باید انتخاب شود.');
  let data;
  try { data = JSON.parse(await jsonFile.text()); }
  catch (e) { throw new Error('JSON قابل‌خواندن نیست: ' + e.message); }
  if (data.format !== 'cs-map-bin' || data.version !== 2 || !Array.isArray(data.geometries))
    throw new Error('فرمت مپ پشتیبانی نمی‌شود؛ فایل cs-map-bin نسخهٔ 2 لازم است.');
  const buffer = await binFile.arrayBuffer();
  const bytes = new DataView(buffer);
  const group = new THREE.Group();
  let vertexCount = 0, drawnTriangles = 0;
  const geometries = [];
  const need = (offset, length, label) => {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 0 || offset + length > buffer.byteLength)
      throw new Error('اطلاعات هندسه خارج از محدودهٔ فایل BIN است: ' + label);
  };
  for (const entry of data.geometries) {
    const vc = Number(entry.vertexCount), ic = Number(entry.indexCount);
    if (!Number.isInteger(vc) || vc < 3 || !Number.isInteger(ic) || ic < 3) continue;
    need(entry.pos, vc * 6, entry.name + ' positions');
    need(entry.nrm, vc * 3, entry.name + ' normals');
    const indexBytes = entry.index32 ? 4 : 2;
    need(entry.idx, ic * indexBytes, entry.name + ' indices');
    const positions = new Float32Array(vc * 3);
    const normals = new Float32Array(vc * 3);
    const pmin = entry.posMin || [0,0,0], prange = entry.posRange || [1,1,1];
    for (let i=0;i<vc;i++) {
      for (let axis=0;axis<3;axis++) {
        const q=bytes.getUint16(entry.pos + i*6 + axis*2, true);
        positions[i*3+axis] = Number(pmin[axis]) + (q/65535)*Number(prange[axis]);
        let n=bytes.getInt8(entry.nrm + i*3 + axis);
        normals[i*3+axis] = Math.max(-1, n/127);
      }
    }
    const indices = entry.index32 ? new Uint32Array(ic) : new Uint16Array(ic);
    for (let i=0;i<ic;i++) indices[i] = entry.index32 ? bytes.getUint32(entry.idx+i*4,true) : bytes.getUint16(entry.idx+i*2,true);
    if (Array.from(indices).some(n => n >= vc)) throw new Error('اندیس‌های هندسه نامعتبر است: ' + entry.name);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals,3));
    geometry.setIndex(new THREE.BufferAttribute(indices,1));
    const matInfo = (data.materials || [])[entry.material] || {};
    const color = Array.isArray(matInfo.color) ? new THREE.Color(Number(matInfo.color[0]),Number(matInfo.color[1]),Number(matInfo.color[2])) : new THREE.Color(0xc5cbd0);
    const material = new THREE.MeshStandardMaterial({ color, roughness:0.92, metalness:0, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(geometry, material)); geometries.push(geometry);
    vertexCount += vc; drawnTriangles += ic/3;
  }
  if (!geometries.length) throw new Error('هیچ هندسه‌ای از فایل‌های انتخاب‌شده خوانده نشد.');
  const bounds = new THREE.Box3().setFromObject(group);
  if (bounds.isEmpty()) throw new Error('محدودهٔ معتبر برای مپ پیدا نشد.');
  return { group, bounds, data: { ...data, geometries, bounds: {min:bounds.min.toArray(),max:bounds.max.toArray()}, stats: {...(data.stats||{}),vertexCount,drawnTriangles} } };
}
