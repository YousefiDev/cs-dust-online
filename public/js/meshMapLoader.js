import * as THREE from 'three';

function asPositions(value) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null;
  const arr = Array.from(value, Number);
  if (arr.length < 9 || arr.length % 3 !== 0 || arr.some(n => !Number.isFinite(n))) return null;
  return arr;
}
function geometryFromEntry(entry) {
  const positions = asPositions(entry.positions ?? entry.vertices ?? entry.vertexPositions ?? entry.position);
  if (!positions) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const indices = entry.indices ?? entry.triangles ?? entry.faces;
  if (Array.isArray(indices) && indices.length >= 3) {
    const flat = indices.flat(Infinity).map(Number);
    if (flat.every(Number.isInteger) && flat.every(n => n >= 0 && n < positions.length / 3)) geometry.setIndex(flat);
  }
  geometry.computeVertexNormals();
  return geometry;
}
function collectEntries(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const key of ['geometries','meshes','parts','objects','chunks']) if (Array.isArray(data[key])) return data[key];
  if (data.positions || data.vertices || data.vertexPositions || data.position) return [data];
  return [];
}
export async function loadMapFromFiles(files) {
  const jsonFile = files.find(f => /\.json$/i.test(f.name));
  const binFile = files.find(f => /\.bin$/i.test(f.name));
  if (!jsonFile) throw new Error('فایل JSON پیدا نشد. فایل JSON و BIN مربوط به یک مپ را با هم انتخاب کن.');
  let data;
  try { data = JSON.parse(await jsonFile.text()); }
  catch (e) { throw new Error('JSON قابل‌خواندن نیست: ' + e.message); }
  const entries = collectEntries(data);
  const group = new THREE.Group();
  let geometries = [];
  let vertexCount = 0, drawnTriangles = 0;
  for (const entry of entries) {
    const geometry = geometryFromEntry(entry);
    if (!geometry) continue;
    const material = new THREE.MeshStandardMaterial({ color: 0xc5cbd0, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh); geometries.push(geometry);
    vertexCount += geometry.getAttribute('position').count;
    drawnTriangles += geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
  }
  if (!geometries.length) {
    const detail = binFile ? 'فایل BIN انتخاب شده، اما ساختار JSON این پروژه نشانی قابل‌تشخیصی برای اتصال هندسه به BIN ندارد.' : 'فایل BIN متناظر هم انتخاب نشده است.';
    throw new Error('ساختار این JSON با قالب عمومی هندسه سازگار نیست. ' + detail + ' برای پشتیبانی از فرمت اختصاصی، نمونهٔ همین دو فایل لازم است.');
  }
  const bounds = new THREE.Box3().setFromObject(group);
  if (bounds.isEmpty()) throw new Error('هندسهٔ مپ محدودهٔ معتبر ندارد.');
  return { group, bounds, data: { geometries, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, stats: { vertexCount, drawnTriangles, storedTriangles: drawnTriangles } } };
}
