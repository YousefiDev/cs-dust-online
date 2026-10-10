// Procedural low/mid-poly models: soldiers (T / CT), weapons, grenades and the CS2-style C4.
// Everything is built from three.js primitives + canvas textures (no downloads).
// Conventions: weapons point down -Z with the origin at the firing-hand grip; characters face -Z.
import * as THREE from 'three';

// ---------------------------------------------------------------- materials / textures
const mats = {};
const mat = (k, c, r = 0.8, m = 0) => (mats[k] = mats[k] || new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }));
const texCache = {};
const hasDOM = typeof document !== 'undefined';
function canvasTex(key, w, h, draw, rep) {
  if (!hasDOM) return null; if (texCache[key]) return texCache[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } // extruded profiles have UVs in metres
  t.needsUpdate = true; return (texCache[key] = t);
}
const texMat = (k, map, r = 0.7, m = 0, extra = {}) => (mats[k] = mats[k] || new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : '#777', map, roughness: r, metalness: m, ...extra }));
function speckle(x, w, h, n, a) { for (let i = 0; i < n; i++) { x.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.6})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }

// ---------------------------------------------------------------- geometry helpers
const geos = new Map();
const G = (key, make) => { let g = geos.get(key); if (!g) { g = make(); geos.set(key, g); } return g; };
function rrect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2; r = Math.max(0.0001, Math.min(r, w / 2, h / 2));
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
// Box with rounded edges (w along x, h along y, d along z), centred.
function rboxGeo(w, h, d, r) {
  const b = Math.min(r, w * 0.45, h * 0.45, d * 0.45);
  return G(`rb${w},${h},${d},${b}`, () => {
    const g = new THREE.ExtrudeGeometry(rrect(w - 2 * b, h - 2 * b, b * 0.6), { depth: Math.max(0.0005, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 3 });
    g.center(); g.computeVertexNormals(); return g;
  });
}
function mesh(geo, material, x = 0, y = 0, z = 0, parent) { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.castShadow = true; if (parent) parent.add(m); return m; }
function box(w, h, d, material, x = 0, y = 0, z = 0, parent) { return mesh(G(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), material, x, y, z, parent); }
function rbox(w, h, d, r, material, x = 0, y = 0, z = 0, parent) { return mesh(rboxGeo(w, h, d, r), material, x, y, z, parent); }
function cyl(r, len, material, x = 0, y = 0, z = 0, parent, axis = 'z', seg = 14, r2 = r) {
  const m = mesh(G(`c${r},${r2},${len},${seg}`, () => new THREE.CylinderGeometry(r, r2, len, seg)), material, x, y, z, parent);
  if (axis === 'z') m.rotation.x = Math.PI / 2; else if (axis === 'x') m.rotation.z = Math.PI / 2; return m;
}
function sphere(r, material, x = 0, y = 0, z = 0, parent, ws = 16, hs = 12) { return mesh(G(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)), material, x, y, z, parent); }
function torus(R, t, material, x, y, z, parent) { return mesh(G(`t${R},${t}`, () => new THREE.TorusGeometry(R, t, 6, 18)), material, x, y, z, parent); }
// Side profile extrusion: pts are [z, y] pairs, extruded symmetrically along X with a soft bevel.
function prof(pts, width, material, parent, bevel = 0.003) {
  const key = 'p' + width + ':' + bevel + ':' + pts.join(';');
  const geo = G(key, () => {
    const s = new THREE.Shape(); pts.forEach(([u, v], i) => (i ? s.lineTo(u, v) : s.moveTo(u, v)));
    const depth = Math.max(0.001, width - 2 * bevel);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 4 });
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, depth / 2, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1)); g.computeVertexNormals(); return g;
  });
  return mesh(geo, material, 0, 0, 0, parent);
}
// Capsule/limb segment between two points.
const UP = new THREE.Vector3(0, 1, 0);
function limbSeg(a, b, r, material, parent) {
  const d = b.clone().sub(a), L = d.length(); const len = Math.max(0.001, L - r * 0.6);
  const m = mesh(G(`cap${r.toFixed(3)},${len.toFixed(3)}`, () => new THREE.CapsuleGeometry(r, len, 3, 10)), material, 0, 0, 0, parent);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); return m;
}
function capsule(r, len, material, x, y, z, parent) { return mesh(G(`cap${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 3, 10)), material, x, y, z, parent); }
// Two-bone IK: returns elbow position for shoulder S, target T, bone lengths a,b and a pole hint.
function solveElbow(S, T, a, b, pole) {
  const dv = T.clone().sub(S); let d = Math.max(0.05, dv.length()); const dir = dv.normalize();
  if (d > (a + b) * 0.995) { const k = d / ((a + b) * 0.995); a *= k; b *= k; }
  const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return S.clone().addScaledVector(dir, x).addScaledVector(p, h);
}

// ---------------------------------------------------------------- textures (canvas)
const T = {
  grip: () => canvasTex('grip', 64, 64, (x, w, h) => { x.fillStyle = '#26272a'; x.fillRect(0, 0, w, h); for (let i = 0; i < w; i += 4) for (let j = 0; j < h; j += 4) { x.fillStyle = (i + j) % 8 ? '#1b1c1e' : '#323336'; x.fillRect(i, j, 3, 3); } }, [34, 34]),
  wood: () => canvasTex('wood', 128, 128, (x, w, h) => {
    x.fillStyle = '#8c4f25'; x.fillRect(0, 0, w, h);
    for (let j = 0; j < h; j++) { const a = Math.sin(j * 0.55) * 0.5 + Math.sin(j * 1.7 + 2) * 0.3; x.fillStyle = a > 0 ? `rgba(255,190,120,${a * 0.14})` : `rgba(40,16,4,${-a * 0.3})`; x.fillRect(0, j, w, 1); }
    for (let i = 0; i < 70; i++) { x.strokeStyle = `rgba(48,20,6,${0.1 + Math.random() * 0.2})`; x.lineWidth = 0.7; const y0 = Math.random() * h; x.beginPath(); x.moveTo(0, y0); for (let px = 0; px <= w; px += 16) x.lineTo(px, y0 + Math.sin(px * 0.05 + i) * 2 + (Math.random() - 0.5) * 0.8); x.stroke(); }
  }, [3, 16]),
  he: () => canvasTex('he', 256, 128, (x, w, h) => {
    x.fillStyle = '#4a5639'; x.fillRect(0, 0, w, h); speckle(x, w, h, 900, 0.08);
    x.fillStyle = '#d9b62a'; x.fillRect(0, 22, w, 7); x.fillStyle = '#2d3523';
    for (let i = 0; i < 4; i++) { x.font = 'bold 15px Arial'; x.fillText('GRENADE, HAND, FRAG', i * 128 + 8, 70); }
    x.fillStyle = '#d9b62a'; x.font = 'bold 18px Arial'; for (let i = 0; i < 2; i++) x.fillText('HE', i * 128 + 54, 96);
  }),
  flash: () => canvasTex('flash', 256, 160, (x, w, h) => {
    x.fillStyle = '#9da19c'; x.fillRect(0, 0, w, h); speckle(x, w, h, 800, 0.06);
    x.fillStyle = '#2a2c2b'; x.fillRect(0, 0, w, 12); x.fillRect(0, h - 12, w, 12);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) { const cx = c * (w / 12) + (r % 2 ? w / 24 : 0) + 10, cy = 34 + r * 30; x.fillStyle = '#1a1b1b'; x.beginPath(); x.ellipse(cx, cy, 5.5, 8, 0, 0, Math.PI * 2); x.fill(); x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(cx - 5, cy + 7, 10, 1.5); }
    x.fillStyle = '#e8e8e2'; x.font = 'bold 11px Arial'; x.fillText('M84 STUN', 8, h - 16); x.fillText('M84 STUN', 136, h - 16);
  }),
  smoke: () => canvasTex('smoke', 256, 160, (x, w, h) => {
    x.fillStyle = '#56604e'; x.fillRect(0, 0, w, h); speckle(x, w, h, 900, 0.07);
    x.fillStyle = '#d8d8cf'; x.fillRect(0, 54, w, 46); x.fillStyle = '#2b2f29'; x.font = 'bold 30px Arial'; x.fillText('SMOKE', 14, 89); x.fillText('SMOKE', 142, 89);
    x.fillStyle = '#1d211b'; for (let c = 0; c < 16; c++) { x.beginPath(); x.arc(c * 16 + 8, 22, 4, 0, Math.PI * 2); x.fill(); x.beginPath(); x.arc(c * 16 + 8, h - 22, 4, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = 'rgba(255,255,255,0.7)'; x.font = '10px Arial'; x.fillText('GRENADE, SMOKE, WHITE', 20, 120); x.fillText('GRENADE, SMOKE, WHITE', 148, 120);
  }),
  brick: () => canvasTex('brick', 128, 96, (x, w, h) => {
    x.fillStyle = '#c3ad84'; x.fillRect(0, 0, w, h); speckle(x, w, h, 500, 0.06);
    x.strokeStyle = 'rgba(70,55,30,0.45)'; x.lineWidth = 2; x.strokeRect(6, 6, w - 12, h - 12);
    x.fillStyle = 'rgba(60,45,25,0.85)'; x.font = 'bold 13px Arial'; x.fillText('CHARGE, DEMOLITION', 10, 34); x.fillText('M112  1 1/4 LB', 10, 52); x.font = 'bold 22px Arial'; x.fillText('C-4', 44, 82);
  }),
  lcd: () => canvasTex('lcd', 256, 72, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1d3b14'); g.addColorStop(1, '#0d1f09'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.font = 'bold 50px "Courier New", monospace'; x.fillStyle = 'rgba(120,255,90,0.12)'; x.fillText('8888888', 14, 54); x.fillStyle = '#8dff5c'; x.shadowColor = '#8dff5c'; x.shadowBlur = 10; x.fillText('7355608', 14, 54);
  }),
  keypad: () => canvasTex('keypad', 192, 256, (x, w, h) => {
    x.fillStyle = '#151617'; x.fillRect(0, 0, w, h); const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
    keys.forEach((k, i) => { const cx = (i % 3) * 62 + 6, cy = Math.floor(i / 3) * 62 + 6; const g = x.createLinearGradient(0, cy, 0, cy + 52); g.addColorStop(0, '#7b7f84'); g.addColorStop(1, '#4b4e52'); x.fillStyle = g; x.beginPath(); x.roundRect(cx, cy, 54, 52, 9); x.fill(); x.fillStyle = '#121314'; x.font = 'bold 30px Arial'; x.textAlign = 'center'; x.fillText(k, cx + 27, cy + 37); });
  }),
  tape: () => canvasTex('tape', 64, 64, (x, w, h) => { x.fillStyle = '#2c2d2c'; x.fillRect(0, 0, w, h); for (let i = 0; i < 18; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; x.fillRect(0, Math.random() * h, w, 1 + Math.random() * 2); } }),
};

// ---------------------------------------------------------------- pistols
function sights(g, m, yTop, zFront, zRear, dot) {
  box(0.006, 0.008, 0.008, m, 0, yTop + 0.004, zFront, g); sphere(0.0017, dot, 0, yTop + 0.0065, zFront + 0.0042, g, 6, 4);
  box(0.0075, 0.009, 0.007, m, -0.0075, yTop + 0.0045, zRear, g); box(0.0075, 0.009, 0.007, m, 0.0075, yTop + 0.0045, zRear, g);
  sphere(0.0015, dot, -0.0075, yTop + 0.006, zRear + 0.0037, g, 6, 4); sphere(0.0015, dot, 0.0075, yTop + 0.006, zRear + 0.0037, g, 6, 4);
}
function serrations(g, m, z0, z1, n, y, h, w) { for (let i = 0; i < n; i++) box(w, h, 0.0018, m, 0, y, z0 + (z1 - z0) * (i / (n - 1)), g); }
function triggerGuard(g, m, zr, zf, yTop, yBot, w) {
  prof([[zr, yTop], [zf + 0.006, yTop], [zf, yTop - 0.008], [zf, yBot + 0.006], [zf + 0.008, yBot], [zr + 0.004, yBot], [zr, yBot + 0.004], [zr + 0.006, yBot + 0.005], [zf + 0.01, yBot + 0.005], [zf + 0.006, yBot + 0.01], [zf + 0.006, yTop - 0.006], [zr, yTop - 0.006]], w, m, g, 0.0015);
}
function makeGlock(g) {
  const slide = mat('glslide', '#3c4046', 0.45, 0.35), frame = mat('glframe', '#2e3036', 0.7, 0.05), dark = mat('gldark', '#111214', 0.6, 0.3);
  const grip = texMat('glgrip', T.grip(), 0.9, 0.05), dot = mat('sightdot', '#e8ffe0', 0.3, 0, { emissive: '#6fe36a', emissiveIntensity: 0.6 });
  // slide
  prof([[0.047, 0.031], [0.047, 0.07], [0.041, 0.078], [-0.128, 0.078], [-0.137, 0.071], [-0.139, 0.052], [-0.137, 0.031]], 0.026, slide, g, 0.0035);
  serrations(g, dark, 0.018, 0.04, 7, 0.056, 0.032, 0.0266);
  box(0.011, 0.004, 0.034, dark, 0.004, 0.0785, -0.02, g); // ejection port
  box(0.004, 0.006, 0.014, mat('brass', '#b08a3a', 0.35, 0.9), 0.006, 0.0795, -0.022, g);
  cyl(0.0068, 0.004, dark, 0, 0.054, -0.139, g); cyl(0.0042, 0.005, mat('bore', '#050505', 0.9), 0, 0.054, -0.1405, g);
  sights(g, dark, 0.078, -0.123, 0.038, dot);
  // frame + rail
  prof([[0.04, 0.032], [-0.131, 0.032], [-0.133, 0.018], [-0.06, 0.014], [-0.02, 0.012], [0.04, 0.014]], 0.024, frame, g, 0.0025);
  for (let i = 0; i < 3; i++) box(0.026, 0.004, 0.006, dark, 0, 0.02, -0.12 + i * 0.012, g);
  // grip with stippling insert
  prof([[0.04, 0.03], [0.052, 0.022], [0.056, 0.012], [0.074, -0.086], [0.068, -0.098], [0.02, -0.1], [0.014, -0.09], [0.006, -0.056], [0.002, -0.048], [0.001, -0.034], [-0.004, -0.026], [-0.006, 0.012]], 0.029, frame, g, 0.004);
  const gi = prof([[0.044, 0.002], [0.064, -0.084], [0.024, -0.086], [0.01, -0.03], [0.008, 0.0]], 0.0305, grip, g, 0.001); gi.renderOrder = 1;
  const mb = rbox(0.031, 0.008, 0.052, 0.003, dark, 0, -0.101, 0.045, g); mb.rotation.x = -0.21;
  triggerGuard(g, frame, -0.002, -0.05, 0.013, -0.02, 0.02);
  const tr = box(0.006, 0.02, 0.005, dark, 0, 0.0, -0.022, g); tr.rotation.x = 0.25;
  box(0.004, 0.006, 0.01, dark, 0.015, 0.024, -0.03, g); // slide stop
  return { muzzle: new THREE.Vector3(0, 0.054, -0.145), support: new THREE.Vector3(-0.03, -0.035, 0.012) };
}
function makeUSP(g) {
  const slide = mat('uspslide', '#454a51', 0.42, 0.35), frame = mat('uspframe', '#303237', 0.7, 0.05), dark = mat('uspdark', '#121315', 0.55, 0.4);
  const grip = texMat('uspgrip', T.grip(), 0.9, 0.05), dot = mat('sightdot', '#e8ffe0', 0.3, 0, { emissive: '#6fe36a', emissiveIntensity: 0.6 }), sil = mat('uspsil', '#2a2d31', 0.5, 0.3);
  prof([[0.05, 0.031], [0.05, 0.068], [0.043, 0.079], [-0.13, 0.079], [-0.14, 0.069], [-0.141, 0.031]], 0.027, slide, g, 0.0055);
  serrations(g, dark, 0.02, 0.042, 8, 0.056, 0.03, 0.0275);
  box(0.011, 0.004, 0.032, dark, 0.004, 0.0795, -0.025, g);
  sights(g, dark, 0.079, -0.128, 0.04, dot);
  // hammer
  const hm = box(0.008, 0.016, 0.01, dark, 0, 0.068, 0.054, g); hm.rotation.x = -0.4;
  prof([[0.044, 0.032], [-0.136, 0.032], [-0.138, 0.016], [-0.06, 0.014], [-0.02, 0.012], [0.044, 0.014]], 0.025, frame, g, 0.0025);
  for (let i = 0; i < 4; i++) box(0.027, 0.004, 0.005, dark, 0, 0.021, -0.128 + i * 0.011, g);
  prof([[0.044, 0.03], [0.056, 0.024], [0.062, 0.012], [0.08, -0.088], [0.072, -0.1], [0.022, -0.102], [0.012, -0.05], [0.0, -0.024], [-0.006, 0.012]], 0.03, frame, g, 0.0045);
  prof([[0.048, 0.002], [0.069, -0.087], [0.026, -0.089], [0.012, -0.03], [0.01, 0.0]], 0.0315, grip, g, 0.001);
  const mb = rbox(0.032, 0.008, 0.054, 0.003, dark, 0, -0.103, 0.048, g); mb.rotation.x = -0.22;
  triggerGuard(g, frame, -0.002, -0.054, 0.013, -0.021, 0.02);
  const tr = box(0.006, 0.02, 0.005, dark, 0, 0.0, -0.024, g); tr.rotation.x = 0.25;
  box(0.004, 0.007, 0.016, dark, 0.0155, 0.024, -0.02, g); box(0.004, 0.009, 0.01, dark, 0.0155, 0.04, 0.04, g); // decocker / stop
  // suppressor
  cyl(0.0075, 0.016, dark, 0, 0.054, -0.148, g);
  cyl(0.0158, 0.175, sil, 0, 0.054, -0.244, g, 'z', 20);
  for (const z of [-0.163, -0.326]) cyl(0.0165, 0.008, dark, 0, 0.054, z, g, 'z', 20);
  for (let i = 0; i < 5; i++) cyl(0.0161, 0.0025, mat('uspring', '#2c2f33', 0.4, 0.7), 0, 0.054, -0.19 - i * 0.022, g, 'z', 20);
  cyl(0.004, 0.003, mat('bore', '#050505', 0.9), 0, 0.054, -0.3305, g);
  return { muzzle: new THREE.Vector3(0, 0.054, -0.335), support: new THREE.Vector3(-0.031, -0.036, 0.012) };
}
function makeDeagle(g) {
  const steel = mat('dgsteel', '#a9aeb4', 0.3, 0.45), dsteel = mat('dgdark', '#6c7178', 0.4, 0.45), dark = mat('dgblk', '#121315', 0.55, 0.4);
  const grip = texMat('dggrip', T.grip(), 0.95, 0), dot = mat('sightdot', '#e8ffe0', 0.3, 0, { emissive: '#6fe36a', emissiveIntensity: 0.6 });
  // rear slide
  prof([[0.058, 0.03], [0.058, 0.078], [0.05, 0.09], [-0.065, 0.09], [-0.065, 0.03]], 0.035, steel, g, 0.004);
  serrations(g, dark, 0.026, 0.05, 8, 0.06, 0.04, 0.0355);
  // triangular barrel
  const tri = G('dgtri', () => { const s = new THREE.Shape(); s.moveTo(-0.017, 0.0); s.lineTo(0.017, 0.0); s.lineTo(0.0095, -0.048); s.lineTo(-0.0095, -0.048); s.closePath(); const e = new THREE.ExtrudeGeometry(s, { depth: 0.13, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 }); e.translate(0, 0, -0.13); e.computeVertexNormals(); return e; });
  mesh(tri, steel, 0, 0.088, -0.063, g);
  box(0.012, 0.006, 0.17, dsteel, 0, 0.092, -0.06, g); for (let i = 0; i < 8; i++) box(0.0125, 0.0035, 0.004, dark, 0, 0.094, -0.13 + i * 0.012, g);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) box(0.002, 0.012, 0.006, dark, s * 0.0135, 0.07, -0.178 + i * 0.01, g); // ports
  cyl(0.0085, 0.006, dark, 0, 0.064, -0.193, g); cyl(0.0055, 0.006, mat('bore', '#050505', 0.9), 0, 0.064, -0.1945, g);
  box(0.011, 0.006, 0.042, dark, 0.005, 0.0905, 0.005, g); // ejection
  sights(g, dark, 0.095, -0.186, 0.05, dot);
  const hm = box(0.01, 0.02, 0.012, dark, 0, 0.074, 0.064, g); hm.rotation.x = -0.5;
  // frame + guard + grip
  prof([[0.05, 0.034], [-0.17, 0.034], [-0.172, 0.018], [-0.07, 0.014], [-0.02, 0.012], [0.05, 0.014]], 0.032, dsteel, g, 0.003);
  triggerGuard(g, dsteel, -0.002, -0.064, 0.013, -0.025, 0.022);
  const tr = box(0.007, 0.022, 0.006, dark, 0, -0.002, -0.026, g); tr.rotation.x = 0.25;
  prof([[0.05, 0.032], [0.062, 0.024], [0.068, 0.012], [0.088, -0.094], [0.08, -0.106], [0.024, -0.108], [0.012, -0.05], [0.0, -0.024], [-0.006, 0.012]], 0.034, dsteel, g, 0.004);
  prof([[0.052, 0.006], [0.074, -0.094], [0.026, -0.097], [0.012, -0.03], [0.01, 0.004]], 0.0375, grip, g, 0.0015);
  const mb = rbox(0.034, 0.009, 0.058, 0.003, dark, 0, -0.109, 0.053, g); mb.rotation.x = -0.22;
  return { muzzle: new THREE.Vector3(0, 0.064, -0.2), support: new THREE.Vector3(-0.034, -0.038, 0.014) };
}

// ---------------------------------------------------------------- grenades (real-ish size, ~7 cm)
function fuseAssembly(g, yTop, R) {
  const metal = mat('nfuse', '#7b7f73', 0.45, 0.7), dark = mat('nfdark', '#3b3e37', 0.6, 0.5), ring = mat('nring', '#c8ccd0', 0.25, 0.95);
  cyl(0.011, 0.014, metal, 0, yTop + 0.007, 0, g, 'y'); cyl(0.013, 0.006, dark, 0, yTop + 0.016, 0, g, 'y'); cyl(0.008, 0.008, metal, 0, yTop + 0.022, 0, g, 'y');
  // spoon / lever running down the +Z side (visible to the thrower)
  const pts = []; const ro = R + 0.0045, ri = R + 0.0015, n = 9;
  pts.push([0.006, yTop + 0.02], [0.012, yTop + 0.021]);
  for (let i = 0; i <= n; i++) { const a = (i / n) * 1.25; pts.push([ri * Math.sin(a) + 0.003 + 0.0, yTop - (1 - Math.cos(a)) * ro * 1.15 - 0.001]); }
  for (let i = n; i >= 0; i--) { const a = (i / n) * 1.25; pts.push([ro * Math.sin(a) + 0.006, yTop - (1 - Math.cos(a)) * ro * 1.15 + 0.002]); }
  pts.push([0.016, yTop + 0.025], [0.005, yTop + 0.024]);
  prof(pts, 0.014, mat('nspoon', '#9aa087', 0.45, 0.6), g, 0.0008);
  // pin + pull ring
  cyl(0.0012, 0.03, ring, 0.006, yTop + 0.012, 0.0, g, 'x', 6);
  const tr = torus(0.0105, 0.0016, ring, 0.026, yTop + 0.006, 0.0, g); tr.rotation.y = Math.PI / 2 + 0.3; tr.rotation.x = 0.4;
}
function makeHE(g) {
  const R = 0.032, body = mesh(G('hebody', () => new THREE.SphereGeometry(R, 22, 16)), texMat('he', T.he(), 0.62, 0.15), 0, 0, 0, g); body.scale.set(1, 1.12, 1);
  cyl(0.013, 0.008, mat('nfuse', '#7b7f73', 0.45, 0.7), 0, R * 1.08, 0, g, 'y');
  fuseAssembly(g, R * 1.1, R);
  sphere(0.006, mat('heb', '#3c4630', 0.6, 0.2), 0, -R * 1.1, 0, g, 8, 6);
}
function makeFlash(g) {
  const R = 0.024, H = 0.098;
  const body = cyl(R, H, texMat('flash', T.flash(), 0.5, 0.35), 0, 0, 0, g, 'y', 24); body.rotation.y = -Math.PI / 2;
  cyl(R + 0.0015, 0.008, mat('flcap', '#2a2c2b', 0.5, 0.6), 0, H / 2 + 0.002, 0, g, 'y', 24); cyl(R + 0.0015, 0.008, mat('flcap', '#2a2c2b', 0.5, 0.6), 0, -H / 2 - 0.002, 0, g, 'y', 24);
  fuseAssembly(g, H / 2 + 0.006, R);
}
function makeSmoke(g) {
  const R = 0.027, H = 0.108;
  const body = cyl(R, H, texMat('smoke', T.smoke(), 0.75, 0.1), 0, 0, 0, g, 'y', 24); body.rotation.y = -Math.PI / 2;
  cyl(R * 0.85, 0.006, mat('smcap', '#3d4438', 0.6, 0.4), 0, H / 2 + 0.003, 0, g, 'y', 24); cyl(R + 0.001, 0.006, mat('smcap', '#3d4438', 0.6, 0.4), 0, -H / 2, 0, g, 'y', 24);
  fuseAssembly(g, H / 2 + 0.006, R);
}

// ---------------------------------------------------------------- CS2-style C4
function makeC4(g) {
  const brickM = texMat('c4brick', T.brick(), 0.85, 0), brickSide = mat('c4side', '#bba57b', 0.9), tape = texMat('c4tape', T.tape(), 0.7, 0.05);
  const plastic = mat('c4plastic', '#1d1f21', 0.55, 0.15), trim = mat('c4trim', '#3a3d40', 0.45, 0.5);
  const cz = -0.08, by = -0.008;
  // 2 x 3 brick bundle
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
    const b = rbox(0.078, 0.044, 0.064, 0.006, brickSide, s * 0.0405, by, cz + (i - 1) * 0.066, g);
    const top = mesh(G('c4lbl', () => new THREE.PlaneGeometry(0.064, 0.05)), brickM, s * 0.0405, by + 0.0225, cz + (i - 1) * 0.066, g); top.rotation.x = -Math.PI / 2; top.castShadow = false;
    b.rotation.y = (Math.random() - 0.5) * 0.03;
  }
  // tape straps wrapping the bundle
  for (const z of [cz - 0.05, cz + 0.055]) rbox(0.172, 0.05, 0.024, 0.004, tape, 0, by, z, g);
  rbox(0.024, 0.05, 0.205, 0.004, tape, 0, by, cz, g);
  // timer / detonator unit
  const dy = by + 0.022 + 0.015;
  rbox(0.11, 0.03, 0.132, 0.006, plastic, 0, dy, cz + 0.004, g);
  rbox(0.116, 0.008, 0.138, 0.003, trim, 0, dy - 0.013, cz + 0.004, g);
  const lcdFrame = rbox(0.084, 0.006, 0.034, 0.002, trim, 0, dy + 0.016, cz - 0.038, g);
  const lcd = mesh(G('c4lcd', () => new THREE.PlaneGeometry(0.076, 0.024)), (mats.c4lcd = mats.c4lcd || new THREE.MeshBasicMaterial({ map: T.lcd(), color: T.lcd() ? '#ffffff' : '#7dff4f', toneMapped: false })), 0, dy + 0.0195, cz - 0.038, g);
  lcd.rotation.x = -Math.PI / 2; lcd.castShadow = false;
  const kp = mesh(G('c4kp', () => new THREE.PlaneGeometry(0.06, 0.072)), texMat('c4keypad', T.keypad(), 0.6, 0.1), -0.008, dy + 0.0155, cz + 0.025, g); kp.rotation.x = -Math.PI / 2; kp.castShadow = false;
  // LED + buttons
  const led = sphere(0.0055, (mats.c4led = mats.c4led || new THREE.MeshStandardMaterial({ color: '#ff2b2b', emissive: '#ff1a1a', emissiveIntensity: 1.6, roughness: 0.3 })), 0.038, dy + 0.016, cz + 0.05, g, 10, 8);
  cyl(0.0075, 0.004, trim, 0.038, dy + 0.014, cz + 0.05, g, 'y');
  rbox(0.014, 0.006, 0.014, 0.002, mat('c4btn', '#b3261e', 0.5, 0.1), 0.038, dy + 0.017, cz + 0.022, g);
  // antenna + wires into the bricks
  cyl(0.003, 0.05, plastic, -0.048, dy + 0.035, cz + 0.06, g, 'y', 8); sphere(0.0045, plastic, -0.048, dy + 0.06, cz + 0.06, g, 8, 6);
  const wires = [['#c62a1e', -0.03], ['#d8b21f', 0.0], ['#2b5fc4', 0.03]];
  for (const [c, x] of wires) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, dy, cz - 0.066), new THREE.Vector3(x * 1.2, dy + 0.004, cz - 0.09), new THREE.Vector3(x * 1.4, by + 0.01, cz - 0.104), new THREE.Vector3(x * 1.5, by - 0.004, cz - 0.095)]);
    mesh(G('c4w' + x, () => new THREE.TubeGeometry(curve, 12, 0.0022, 6, false)), mat('wire' + c, c, 0.5), 0, 0, 0, g);
  }
  return { led: new THREE.Vector3(0.038, dy + 0.022, cz + 0.05) };
}

// ---------------------------------------------------------------- rifles & SMGs (CS2-style side-profile builds)
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
function rifleMats() {
  return {
    steel: mat('rfsteel', '#3b3f46', 0.42, 0.42), hi: mat('rfhi', '#a2a9b2', 0.28, 0.6), dark: mat('rfdark', '#17181b', 0.5, 0.3),
    poly: mat('rfpoly', '#2b2d32', 0.68, 0.05), poly2: mat('rfpoly2', '#42454b', 0.6, 0.08), rub: mat('rfrub', '#1b1c1e', 0.95, 0.02),
    bore: mat('bore', '#050505', 0.9), brass: mat('brass', '#b08a3a', 0.35, 0.9),
    dot: (mats.rfdot = mats.rfdot || new THREE.MeshStandardMaterial({ color: '#e8ffe0', emissive: '#6fe36a', emissiveIntensity: 0.7, roughness: 0.3 })),
    grip: texMat('rfgrip', T.grip(), 0.9, 0.05), wood: texMat('rfwood', T.wood(), 0.55, 0.02),
  };
}
// Picatinny-style rail: base bar + dark cross slots.
function railSeg(g, m, z0, z1, y, w, n) {
  const L = z0 - z1, zc = (z0 + z1) / 2; box(w, 0.007, L, m.steel, 0, y, zc, g);
  for (let i = 0; i < n; i++) box(w + 0.0016, 0.0032, (L / n) * 0.42, m.dark, 0, y + 0.0036, z1 + (L / n) * (i + 0.5), g);
}
function ventSlots(g, mt, x, zs, y, h, d) { for (const z of zs) for (const s of [-1, 1]) box(0.0026, h, d, mt, s * x, y, z, g); }
function ribBands(g, mt, x, pts, w, h) { for (const [y, z, a] of pts) for (const s of [-1, 1]) { const b = box(0.0024, h, w, mt, s * x, y, z, g); b.rotation.x = a; } }

function makeAK47(g) {
  const m = rifleMats(), steel = m.steel, wood = m.wood, P = (pts, w, mt, b) => prof(pts, w, mt, g, b), yb = 0.072;
  const magM = mat('akmag', '#2e3034', 0.5, 0.4);
  // receiver, trunnion, magwell
  P([[0.09, 0.02], [0.09, 0.083], [0.074, 0.098], [-0.06, 0.104], [-0.22, 0.101], [-0.335, 0.093], [-0.335, 0.02]], 0.044, steel, 0.003);
  P([[0.088, 0.03], [0.088, 0.012], [-0.12, 0.012], [-0.12, 0.03]], 0.05, steel, 0.003);
  P([[-0.12, 0.03], [-0.12, -0.012], [-0.235, -0.012], [-0.235, 0.03]], 0.052, steel, 0.003);
  P([[-0.32, 0.098], [-0.32, 0.022], [-0.375, 0.025], [-0.375, 0.094]], 0.05, steel, 0.003);
  for (const s of [-1, 1]) { box(0.003, 0.012, 0.2, m.hi, s * 0.0225, 0.085, -0.13, g); box(0.003, 0.03, 0.006, m.dark, s * 0.0225, 0.06, -0.03, g); }
  box(0.003, 0.008, 0.12, m.hi, 0.0235, 0.058, -0.06, g); // selector
  cyl(0.006, 0.03, m.hi, 0.03, 0.09, -0.12, g, 'x', 8); sphere(0.0085, m.hi, 0.046, 0.09, -0.12, g, 8, 6); // charging handle
  // trigger group
  triggerGuard(g, steel, 0.025, -0.12, 0.022, -0.03, 0.012); const tr = box(0.006, 0.022, 0.006, m.dark, 0, 0.0, -0.045, g); tr.rotation.x = 0.28;
  P([[0.052, 0.026], [0.064, 0.004], [0.079, -0.062], [0.084, -0.104], [0.066, -0.13], [0.034, -0.128], [0.026, -0.1], [0.016, -0.04], [0.008, 0.002], [0.008, 0.026]], 0.036, wood, 0.0045);
  P([[0.036, -0.125], [0.07, -0.125], [0.068, -0.134], [0.033, -0.134]], 0.034, steel, 0.001);
  // banana magazine with ribs
  P([[-0.14, 0.03], [-0.215, 0.03], [-0.222, -0.06], [-0.246, -0.13], [-0.29, -0.195], [-0.345, -0.23], [-0.338, -0.246], [-0.268, -0.244], [-0.215, -0.19], [-0.172, -0.13], [-0.148, -0.06]], 0.04, magM, 0.003);
  ribBands(g, m.dark, 0.0205, [[-0.04, -0.181, 0.1], [-0.085, -0.19, 0.22], [-0.13, -0.209, 0.4], [-0.175, -0.237, 0.62]], 0.075, 0.004);
  // wooden furniture
  P([[-0.335, 0.072], [-0.335, 0.032], [-0.352, 0.024], [-0.5, 0.026], [-0.536, 0.04], [-0.536, 0.072]], 0.05, wood, 0.004);
  P([[-0.352, 0.072], [-0.352, 0.106], [-0.375, 0.116], [-0.54, 0.114], [-0.572, 0.098], [-0.572, 0.072]], 0.046, wood, 0.004);
  P([[0.088, 0.09], [0.215, 0.071], [0.338, 0.058], [0.35, 0.04], [0.348, -0.03], [0.334, -0.06], [0.22, -0.016], [0.098, 0.016], [0.088, 0.02]], 0.042, wood, 0.004);
  P([[0.337, 0.058], [0.352, 0.05], [0.352, -0.034], [0.338, -0.06]], 0.044, steel, 0.001);
  cyl(0.0235, 0.01, steel, 0, yb, -0.541, g, 'z', 16); // handguard ferrule
  // gas system, barrel, sights, slant brake
  cyl(0.0105, 0.07, steel, 0, 0.1, -0.607, g, 'z', 12);
  rbox(0.024, 0.044, 0.05, 0.004, steel, 0, 0.092, -0.625, g);
  cyl(0.0105, 0.27, steel, 0, yb, -0.66, g, 'z', 14);
  P([[-0.7, 0.07], [-0.7, 0.1], [-0.722, 0.134], [-0.746, 0.134], [-0.752, 0.1], [-0.752, 0.07]], 0.014, steel, 0.002);
  for (const s of [-1, 1]) box(0.003, 0.026, 0.014, steel, s * 0.0095, 0.118, -0.735, g);
  P([[-0.37, 0.114], [-0.37, 0.126], [-0.392, 0.13], [-0.47, 0.119], [-0.47, 0.114]], 0.016, steel, 0.002); // rear sight leaf
  cyl(0.0148, 0.05, m.dark, 0, yb, -0.765, g, 'z', 14); cyl(0.0105, 0.01, steel, 0, yb, -0.742, g, 'z', 12);
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) box(0.003, 0.014, 0.007, steel, s * 0.0148, yb, -0.772 - i * 0.01, g);
  cyl(0.006, 0.004, m.bore, 0, yb, -0.791, g);
  return { muzzle: V3(0, yb, -0.79), support: V3(0, 0.0, -0.38) };
}

function makeM4(g, sil) {
  const m = rifleMats(), P = (pts, w, mt, b) => prof(pts, w, mt, g, b), yb = 0.068;
  const body = mat(sil ? 'm4sbody' : 'm4body', sil ? '#3a3d43' : '#33363c', 0.5, 0.4), magM = mat('m4mag', '#34373c', 0.55, 0.35);
  P([[0.125, 0.046], [0.125, 0.098], [0.104, 0.108], [-0.265, 0.108], [-0.265, 0.046]], 0.046, body, 0.003);
  P([[0.125, 0.05], [0.125, 0.012], [0.068, 0.0], [-0.11, 0.0], [-0.115, -0.012], [-0.22, -0.012], [-0.225, 0.0], [-0.265, 0.012], [-0.265, 0.05]], 0.044, body, 0.003);
  box(0.003, 0.022, 0.075, m.dark, 0.0235, 0.082, -0.03, g); box(0.0032, 0.01, 0.01, m.hi, -0.0235, 0.03, -0.17, g); // ejection port / mag release
  P([[0.12, 0.114], [0.124, 0.127], [0.145, 0.127], [0.145, 0.114]], 0.026, m.steel, 0.002); // charging handle
  triggerGuard(g, body, 0.03, -0.115, 0.002, -0.032, 0.012); const tr = box(0.006, 0.022, 0.006, m.dark, 0, -0.012, -0.045, g); tr.rotation.x = 0.28;
  P([[0.058, 0.006], [0.069, -0.03], [0.086, -0.098], [0.08, -0.128], [0.048, -0.132], [0.03, -0.124], [0.028, -0.09], [0.014, -0.03], [0.004, 0.006]], 0.034, m.grip, 0.0045);
  P([[-0.12, 0.0], [-0.19, 0.0], [-0.202, -0.08], [-0.224, -0.17], [-0.214, -0.178], [-0.146, -0.178], [-0.138, -0.08]], 0.032, magM, 0.003);
  ribBands(g, m.dark, 0.0165, [[-0.05, -0.16, 0.05], [-0.095, -0.168, 0.12], [-0.14, -0.178, 0.2]], 0.06, 0.003);
  P([[-0.148, -0.17], [-0.222, -0.17], [-0.215, -0.185], [-0.15, -0.185]], 0.034, m.dark, 0.001);
  // stock
  P([[0.125, 0.07], [0.2, 0.076], [0.345, 0.07], [0.352, 0.05], [0.352, -0.02], [0.34, -0.05], [0.3, -0.052], [0.24, -0.03], [0.2, -0.005], [0.125, 0.002]], 0.04, m.poly, 0.004);
  P([[0.346, 0.068], [0.36, 0.06], [0.362, -0.02], [0.348, -0.048]], 0.042, m.rub, 0.001);
  for (let i = 0; i < 4; i++) box(0.0415, 0.003, 0.01, m.dark, 0, 0.0, 0.22 + i * 0.026, g).position.y = 0.035 - i * 0.002;
  // rail, handguard, barrel
  railSeg(g, m, 0.12, sil ? -0.5 : -0.6, 0.111, 0.022, sil ? 14 : 17);
  const hz = sil ? -0.5 : -0.6;
  P([[-0.265, 0.1], [-0.265, 0.028], [-0.3, 0.022], [hz + 0.03, 0.026], [hz, 0.04], [hz, 0.092], [hz + 0.02, 0.1]], 0.052, sil ? m.poly2 : m.poly, 0.004);
  ventSlots(g, m.dark, 0.0265, sil ? [-0.33, -0.37, -0.41, -0.45] : [-0.33, -0.375, -0.42, -0.465, -0.51, -0.555], 0.062, 0.016, 0.024);
  cyl(0.0105, 0.22, m.steel, 0, yb, -0.7, g, 'z', 14);
  P([[0.04, 0.114], [0.04, 0.134], [0.052, 0.14], [0.07, 0.14], [0.078, 0.134], [0.078, 0.114]], 0.016, m.steel, 0.002); // rear flip sight
  box(0.0045, 0.006, 0.01, m.dark, 0, 0.134, 0.062, g);
  if (!sil) {
    P([[-0.57, 0.114], [-0.57, 0.146], [-0.58, 0.154], [-0.597, 0.154], [-0.6, 0.114]], 0.012, m.steel, 0.002); // front sight tower
    cyl(0.0155, 0.055, m.dark, 0, yb, -0.83, g, 'z', 14);
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) box(0.0034, 0.012, 0.008, m.steel, s * 0.0155, yb, -0.82 - i * 0.012, g);
    cyl(0.006, 0.004, m.bore, 0, yb, -0.8585, g);
    return { muzzle: V3(0, yb, -0.86), support: V3(0, 0.0, -0.38) };
  }
  // M4A1-S: long integral suppressor + threaded barrel nut
  cyl(0.0225, 0.4, mat('m4sup', '#26282c', 0.45, 0.5), 0, yb, -0.7, g, 'z', 22);
  for (const z of [-0.52, -0.62, -0.72, -0.82]) cyl(0.0232, 0.006, m.hi, 0, yb, z, g, 'z', 22);
  cyl(0.0235, 0.012, m.steel, 0, yb, -0.894, g, 'z', 22); cyl(0.007, 0.004, m.bore, 0, yb, -0.9, g);
  P([[-0.5, 0.114], [-0.5, 0.13], [-0.52, 0.134], [-0.54, 0.114]], 0.012, m.steel, 0.002);
  return { muzzle: V3(0, yb, -0.9), support: V3(0, 0.0, -0.36) };
}

function makeAWP(g) {
  const m = rifleMats(), P = (pts, w, mt, b) => prof(pts, w, mt, g, b), yb = 0.066;
  const ol = mat('awpol', '#64765a', 0.55, 0.1), ol2 = mat('awpol2', '#4a5a40', 0.6, 0.1);
  // stock, grip, forend
  P([[0.12, 0.075], [0.2, 0.082], [0.3, 0.09], [0.4, 0.083], [0.425, 0.07], [0.43, -0.07], [0.4, -0.1], [0.33, -0.095], [0.25, -0.04], [0.12, -0.02]], 0.044, ol, 0.005);
  P([[0.42, 0.07], [0.446, 0.06], [0.45, -0.07], [0.424, -0.08]], 0.046, m.rub, 0.002);
  P([[0.095, 0.0], [0.11, -0.05], [0.135, -0.11], [0.1, -0.13], [0.055, -0.125], [0.045, -0.07], [0.025, 0.0]], 0.04, ol, 0.005);
  P([[-0.1, 0.07], [-0.1, -0.01], [-0.18, -0.035], [-0.46, -0.03], [-0.52, 0.0], [-0.52, 0.036], [-0.3, 0.05]], 0.046, ol, 0.005);
  // receiver + bolt
  P([[0.12, 0.025], [0.12, 0.1], [0.1, 0.108], [-0.3, 0.108], [-0.3, 0.025]], 0.044, m.steel, 0.003);
  cyl(0.017, 0.11, m.dark, 0, 0.088, 0.075, g, 'z', 14); cyl(0.0045, 0.05, m.hi, 0.04, 0.09, 0.085, g, 'x', 8); sphere(0.0125, m.hi, 0.07, 0.09, 0.085, g, 10, 8);
  triggerGuard(g, ol, 0.02, -0.1, 0.022, -0.04, 0.012); const tr = box(0.006, 0.022, 0.006, m.dark, 0, 0.0, -0.03, g); tr.rotation.x = 0.28;
  P([[-0.1, 0.03], [-0.1, -0.075], [-0.19, -0.075], [-0.19, 0.03]], 0.036, m.dark, 0.003); // box magazine
  // barrel with flutes + muzzle brake
  cyl(0.0145, 0.6, m.steel, 0, yb, -0.66, g, 'z', 16);
  for (let i = 0; i < 6; i++) cyl(0.0152, 0.012, m.dark, 0, yb, -0.42 - i * 0.055, g, 'z', 16);
  cyl(0.0185, 0.07, m.dark, 0, yb, -0.945, g, 'z', 16);
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) box(0.004, 0.012, 0.01, m.bore, s * 0.0185, yb, -0.93 - i * 0.014, g);
  cyl(0.007, 0.004, m.bore, 0, yb, -0.98, g);
  // scope
  const sc = mat('awpscope', '#17181a', 0.35, 0.7);
  cyl(0.03, 0.3, sc, 0, 0.165, -0.1, g, 'z', 22); cyl(0.032, 0.07, sc, 0, 0.165, -0.285, g, 'z', 22, 0.043); cyl(0.04, 0.05, sc, 0, 0.165, 0.09, g, 'z', 22, 0.03);
  cyl(0.0105, 0.022, m.hi, 0, 0.2, -0.1, g, 'y', 12); cyl(0.0105, 0.022, m.hi, 0.036, 0.165, -0.08, g, 'x', 12);
  for (const z of [-0.18, -0.02]) rbox(0.03, 0.05, 0.03, 0.005, m.steel, 0, 0.13, z, g);
  return { muzzle: V3(0, yb, -0.98), support: V3(0, 0.0, -0.34) };
}

function makeMAC10(g) {
  const m = rifleMats(), P = (pts, w, mt, b) => prof(pts, w, mt, g, b), yb = 0.07, body = mat('macbody', '#383b41', 0.5, 0.4);
  P([[0.1, 0.1], [0.1, 0.02], [0.075, 0.01], [-0.2, 0.01], [-0.2, 0.085], [-0.18, 0.1]], 0.05, body, 0.003);
  P([[0.075, 0.1], [0.075, 0.116], [0.0, 0.122], [-0.15, 0.122], [-0.17, 0.1]], 0.034, m.steel, 0.003);
  cyl(0.006, 0.05, m.hi, 0, 0.128, -0.02, g, 'x', 8); for (const s of [-1, 1]) box(0.004, 0.02, 0.012, m.dark, s * 0.012, 0.126, 0.07, g); box(0.004, 0.02, 0.012, m.dark, 0, 0.126, -0.19, g);
  P([[0.062, 0.012], [0.075, -0.03], [0.083, -0.18], [0.025, -0.185], [0.018, -0.03], [0.008, 0.012]], 0.036, body, 0.004);
  rbox(0.04, 0.01, 0.065, 0.002, m.dark, 0, -0.19, 0.054, g);
  triggerGuard(g, body, 0.012, -0.07, 0.012, -0.03, 0.012); P([[-0.07, 0.012], [-0.07, -0.05], [-0.12, -0.05], [-0.12, 0.012]], 0.02, body, 0.003);
  const tr = box(0.006, 0.02, 0.006, m.dark, 0, -0.004, -0.02, g); tr.rotation.x = 0.28;
  cyl(0.0125, 0.12, m.steel, 0, yb, -0.26, g, 'z', 14); for (let i = 0; i < 5; i++) cyl(0.0138, 0.004, m.dark, 0, yb, -0.22 - i * 0.016, g, 'z', 14);
  cyl(0.017, 0.03, m.dark, 0, yb, -0.285, g, 'z', 14); cyl(0.006, 0.004, m.bore, 0, yb, -0.3, g);
  for (const s of [-1, 1]) cyl(0.0035, 0.2, m.hi, s * 0.024, 0.045, 0.17, g, 'z', 6);
  rbox(0.062, 0.07, 0.01, 0.003, m.hi, 0, 0.045, 0.272, g);
  return { muzzle: V3(0, yb, -0.3), support: V3(0, -0.02, -0.17) };
}

function makeMP9(g) {
  const m = rifleMats(), P = (pts, w, mt, b) => prof(pts, w, mt, g, b), yb = 0.07;
  P([[0.07, 0.1], [0.07, 0.02], [0.04, 0.012], [-0.25, 0.012], [-0.27, 0.06], [-0.27, 0.1], [-0.24, 0.108], [0.0, 0.108]], 0.044, m.poly, 0.004);
  railSeg(g, m, 0.06, -0.24, 0.114, 0.02, 11);
  P([[-0.2, 0.118], [-0.2, 0.135], [-0.212, 0.138], [-0.222, 0.118]], 0.01, m.steel, 0.002); P([[0.03, 0.118], [0.03, 0.136], [0.046, 0.14], [0.052, 0.118]], 0.012, m.steel, 0.002);
  box(0.003, 0.02, 0.07, m.dark, 0.0225, 0.085, -0.04, g);
  P([[0.052, 0.014], [0.063, -0.03], [0.08, -0.12], [0.074, -0.15], [0.03, -0.152], [0.018, -0.03], [0.006, 0.014]], 0.034, m.grip, 0.004);
  rbox(0.04, 0.01, 0.07, 0.002, m.dark, 0, -0.158, 0.058, g);
  triggerGuard(g, m.poly, 0.016, -0.08, 0.014, -0.032, 0.012); const tr = box(0.006, 0.02, 0.006, m.dark, 0, -0.002, -0.025, g); tr.rotation.x = 0.28;
  P([[-0.105, 0.014], [-0.108, -0.07], [-0.15, -0.076], [-0.152, 0.014]], 0.026, m.poly, 0.004); // forward vertical grip
  cyl(0.011, 0.1, m.steel, 0, yb, -0.3, g, 'z', 12); cyl(0.016, 0.04, m.dark, 0, yb, -0.325, g, 'z', 14); cyl(0.006, 0.004, m.bore, 0, yb, -0.347, g);
  for (const s of [-1, 1]) cyl(0.0035, 0.1, m.hi, s * 0.022, 0.07, 0.12, g, 'z', 6);
  rbox(0.056, 0.05, 0.01, 0.003, m.hi, 0, 0.07, 0.172, g);
  return { muzzle: V3(0, yb, -0.35), support: V3(0, -0.07, -0.13) };
}

function makeP90(g) {
  const m = rifleMats(), P = (pts, w, mt, b) => prof(pts, w, mt, g, b), top = mat('p90top', '#6a7882', 0.35, 0.4), body = mat('p90body', '#2f3237', 0.62, 0.1);
  P([[0.19, 0.13], [-0.36, 0.13], [-0.41, 0.1], [-0.41, 0.06], [-0.34, 0.045], [-0.3, 0.005], [-0.275, -0.03], [-0.22, -0.065], [-0.15, -0.06], [-0.12, 0.0], [-0.08, 0.04], [0.09, 0.05], [0.14, 0.02], [0.19, 0.03]], 0.058, body, 0.006);
  P([[0.17, 0.13], [0.17, 0.152], [0.1, 0.163], [-0.3, 0.163], [-0.35, 0.152], [-0.355, 0.13]], 0.05, top, 0.004); // magazine / top cover
  P([[0.2, 0.12], [0.215, 0.1], [0.215, 0.0], [0.2, 0.03]], 0.06, m.rub, 0.003);
  P([[0.05, 0.05], [0.06, -0.03], [0.065, -0.115], [0.025, -0.12], [0.015, -0.03], [0.008, 0.05]], 0.034, m.grip, 0.004);
  triggerGuard(g, body, 0.012, -0.1, 0.045, -0.02, 0.012); const tr = box(0.006, 0.02, 0.006, m.dark, 0, 0.02, -0.04, g); tr.rotation.x = 0.28;
  mesh(G('p90ring', () => new THREE.TorusGeometry(0.022, 0.0045, 8, 22)), m.steel, 0, 0.19, 0.075, g); box(0.03, 0.02, 0.05, m.steel, 0, 0.166, 0.075, g);
  P([[-0.2, 0.166], [-0.2, 0.178], [-0.225, 0.18], [-0.24, 0.166]], 0.01, m.steel, 0.002);
  ventSlots(g, m.dark, 0.0295, [-0.12, -0.16, -0.2, -0.24], 0.1, 0.02, 0.014);
  cyl(0.0105, 0.1, m.steel, 0, 0.09, -0.4, g, 'z', 12); cyl(0.016, 0.07, m.dark, 0, 0.09, -0.43, g, 'z', 14); cyl(0.006, 0.004, m.bore, 0, 0.09, -0.46, g);
  return { muzzle: V3(0, 0.09, -0.46), support: V3(0, -0.05, -0.2) };
}

function makeGalil(g) {
  const m = rifleMats(), P = (pts, w, mt, b) => prof(pts, w, mt, g, b), yb = 0.072, fur = mat('galfur', '#59634b', 0.65, 0.08), magM = mat('galmag', '#34362f', 0.6, 0.12);
  P([[0.09, 0.02], [0.09, 0.09], [0.07, 0.1], [-0.34, 0.1], [-0.34, 0.02]], 0.044, m.steel, 0.003);
  P([[-0.32, 0.098], [-0.32, 0.022], [-0.375, 0.025], [-0.375, 0.094]], 0.05, m.steel, 0.003); P([[-0.12, 0.03], [-0.12, -0.012], [-0.235, -0.012], [-0.235, 0.03]], 0.05, m.steel, 0.003);
  for (const s of [-1, 1]) { box(0.003, 0.012, 0.2, m.hi, s * 0.0225, 0.085, -0.12, g); box(0.003, 0.03, 0.006, m.dark, s * 0.0225, 0.06, -0.03, g); }
  triggerGuard(g, m.steel, 0.025, -0.12, 0.022, -0.03, 0.012); const tr = box(0.006, 0.022, 0.006, m.dark, 0, 0.0, -0.045, g); tr.rotation.x = 0.28;
  P([[0.052, 0.026], [0.064, 0.004], [0.079, -0.062], [0.084, -0.104], [0.066, -0.13], [0.034, -0.128], [0.026, -0.1], [0.016, -0.04], [0.008, 0.002], [0.008, 0.026]], 0.036, fur, 0.0045);
  P([[-0.14, 0.03], [-0.215, 0.03], [-0.222, -0.06], [-0.24, -0.12], [-0.27, -0.17], [-0.3, -0.19], [-0.294, -0.205], [-0.245, -0.2], [-0.205, -0.165], [-0.172, -0.12], [-0.148, -0.06]], 0.04, magM, 0.003);
  P([[-0.335, 0.1], [-0.335, 0.02], [-0.545, 0.026], [-0.575, 0.04], [-0.575, 0.09], [-0.55, 0.1]], 0.05, fur, 0.004);
  ventSlots(g, m.dark, 0.0255, [-0.38, -0.42, -0.46, -0.5], 0.062, 0.03, 0.012);
  cyl(0.0105, 0.22, m.steel, 0, yb, -0.68, g, 'z', 14); cyl(0.0105, 0.07, m.steel, 0, 0.102, -0.61, g, 'z', 12); rbox(0.022, 0.04, 0.04, 0.004, m.steel, 0, 0.092, -0.625, g);
  P([[-0.71, 0.07], [-0.71, 0.1], [-0.726, 0.132], [-0.748, 0.132], [-0.752, 0.1], [-0.752, 0.07]], 0.014, m.steel, 0.002);
  P([[-0.37, 0.108], [-0.37, 0.12], [-0.392, 0.124], [-0.46, 0.114], [-0.46, 0.108]], 0.014, m.steel, 0.002); P([[0.0, 0.1], [0.0, 0.115], [-0.03, 0.12], [-0.06, 0.1]], 0.018, m.steel, 0.002);
  cyl(0.0155, 0.045, m.dark, 0, yb, -0.757, g, 'z', 14); for (let i = 0; i < 3; i++) for (const s of [-1, 1]) box(0.003, 0.012, 0.006, m.steel, s * 0.0155, yb, -0.768 - i * 0.01, g);
  cyl(0.006, 0.004, m.bore, 0, yb, -0.78, g);
  // skeleton stock
  P([[0.09, 0.09], [0.34, 0.07], [0.34, 0.05], [0.09, 0.07]], 0.016, m.hi, 0.002); P([[0.09, 0.03], [0.34, -0.036], [0.34, -0.056], [0.09, 0.01]], 0.016, m.hi, 0.002);
  P([[0.338, 0.07], [0.356, 0.062], [0.356, -0.05], [0.338, -0.058]], 0.04, m.rub, 0.002);
  return { muzzle: V3(0, yb, -0.78), support: V3(0, 0.0, -0.38) };
}

function makeFAMAS(g) {
  const m = rifleMats(), P = (pts, w, mt, b) => prof(pts, w, mt, g, b), yb = 0.065, ol = mat('famol', '#5e6e50', 0.6, 0.1), ol2 = mat('famol2', '#485640', 0.62, 0.1);
  P([[0.29, 0.1], [0.3, 0.09], [0.3, 0.012], [0.282, -0.006], [-0.2, -0.006], [-0.4, 0.016], [-0.5, 0.036], [-0.5, 0.078], [-0.4, 0.09], [-0.2, 0.098], [0.2, 0.1]], 0.052, ol, 0.006);
  P([[0.2, 0.1], [0.19, 0.135], [0.14, 0.155], [-0.12, 0.155], [-0.16, 0.135], [-0.18, 0.1]], 0.05, ol, 0.005); P([[0.15, 0.11], [0.14, 0.14], [-0.1, 0.14], [-0.12, 0.11]], 0.052, m.dark, 0.001);
  P([[0.298, 0.098], [0.318, 0.09], [0.318, 0.0], [0.298, 0.01]], 0.05, m.rub, 0.002);
  P([[0.012, 0.0], [0.026, -0.05], [0.036, -0.12], [-0.005, -0.125], [-0.018, -0.05], [-0.02, 0.0]], 0.036, m.grip, 0.004);
  triggerGuard(g, ol2, -0.015, -0.1, -0.006, -0.042, 0.012); const tr = box(0.006, 0.02, 0.006, m.dark, 0, -0.012, -0.05, g); tr.rotation.x = 0.28;
  P([[0.07, 0.0], [0.07, -0.1], [0.075, -0.165], [0.145, -0.165], [0.14, -0.1], [0.14, 0.0]], 0.032, m.poly2, 0.003);
  ribBands(g, m.dark, 0.0165, [[-0.05, 0.108, 0], [-0.1, 0.109, 0], [-0.145, 0.11, 0]], 0.06, 0.003);
  ventSlots(g, m.dark, 0.0285, [-0.3, -0.34, -0.38, -0.42], 0.048, 0.02, 0.018);
  cyl(0.011, 0.3, m.steel, 0, yb, -0.67, g, 'z', 14); cyl(0.0155, 0.04, m.dark, 0, yb, -0.8, g, 'z', 14); cyl(0.006, 0.004, m.bore, 0, yb, -0.82, g);
  P([[-0.75, 0.074], [-0.75, 0.11], [-0.762, 0.116], [-0.778, 0.116], [-0.782, 0.074]], 0.012, m.steel, 0.002);
  for (const s of [-1, 1]) cyl(0.003, 0.14, m.hi, s * 0.03, 0.02, -0.57, g, 'z', 6);
  return { muzzle: V3(0, yb, -0.82), support: V3(0, 0.0, -0.3) };
}

function makeSG553(g) {
  const m = rifleMats(), P = (pts, w, mt, b) => prof(pts, w, mt, g, b), yb = 0.075, fur = mat('sgfur', '#33363b', 0.65, 0.08), tan = mat('sgtan', '#6f6a55', 0.6, 0.15);
  P([[0.09, 0.02], [0.09, 0.098], [0.07, 0.108], [-0.34, 0.108], [-0.34, 0.02]], 0.046, m.steel, 0.003);
  P([[-0.32, 0.104], [-0.32, 0.022], [-0.375, 0.025], [-0.375, 0.1]], 0.05, m.steel, 0.003); P([[-0.12, 0.03], [-0.12, -0.012], [-0.235, -0.012], [-0.235, 0.03]], 0.05, fur, 0.003);
  for (const s of [-1, 1]) box(0.003, 0.012, 0.2, m.hi, s * 0.0235, 0.09, -0.12, g);
  box(0.003, 0.02, 0.07, m.dark, 0.0245, 0.08, -0.04, g);
  triggerGuard(g, fur, 0.025, -0.12, 0.022, -0.03, 0.012); const tr = box(0.006, 0.022, 0.006, m.dark, 0, 0.0, -0.045, g); tr.rotation.x = 0.28;
  P([[0.056, 0.022], [0.066, 0.004], [0.08, -0.062], [0.082, -0.104], [0.064, -0.13], [0.034, -0.128], [0.026, -0.1], [0.016, -0.04], [0.008, 0.002], [0.008, 0.026]], 0.036, m.grip, 0.0045);
  P([[-0.14, 0.03], [-0.215, 0.03], [-0.222, -0.06], [-0.24, -0.12], [-0.27, -0.17], [-0.3, -0.19], [-0.294, -0.205], [-0.245, -0.2], [-0.205, -0.165], [-0.172, -0.12], [-0.148, -0.06]], 0.04, fur, 0.003);
  railSeg(g, m, 0.08, -0.34, 0.114, 0.022, 10);
  P([[-0.335, 0.108], [-0.335, 0.02], [-0.55, 0.026], [-0.58, 0.04], [-0.58, 0.098], [-0.56, 0.108]], 0.05, fur, 0.004);
  ventSlots(g, m.dark, 0.0255, [-0.38, -0.42, -0.46, -0.5, -0.54], 0.066, 0.028, 0.012);
  cyl(0.0105, 0.24, m.steel, 0, yb, -0.7, g, 'z', 14); cyl(0.0105, 0.07, m.steel, 0, 0.108, -0.62, g, 'z', 12); rbox(0.022, 0.04, 0.045, 0.004, m.steel, 0, 0.098, -0.63, g);
  P([[-0.7, 0.078], [-0.7, 0.108], [-0.718, 0.134], [-0.74, 0.134], [-0.744, 0.108], [-0.744, 0.078]], 0.014, m.steel, 0.002);
  cyl(0.0155, 0.07, m.dark, 0, yb, -0.805, g, 'z', 14); for (let i = 0; i < 4; i++) for (const s of [-1, 1]) box(0.003, 0.012, 0.007, m.steel, s * 0.0155, yb, -0.78 - i * 0.012, g);
  cyl(0.006, 0.004, m.bore, 0, yb, -0.84, g);
  // optic
  const sc = mat('sgscope', '#17181a', 0.35, 0.7); cyl(0.0185, 0.15, sc, 0, 0.152, -0.15, g, 'z', 18); cyl(0.0185, 0.04, sc, 0, 0.152, -0.245, g, 'z', 18, 0.026); cyl(0.027, 0.03, sc, 0, 0.152, -0.06, g, 'z', 18, 0.0185);
  for (const z of [-0.2, -0.1]) rbox(0.024, 0.03, 0.022, 0.004, m.steel, 0, 0.125, z, g);
  // skeleton stock
  P([[0.09, 0.094], [0.34, 0.074], [0.34, 0.054], [0.09, 0.074]], 0.016, m.hi, 0.002); P([[0.09, 0.03], [0.34, -0.04], [0.34, -0.06], [0.09, 0.01]], 0.016, m.hi, 0.002);
  P([[0.338, 0.074], [0.356, 0.066], [0.356, -0.054], [0.338, -0.062]], 0.04, m.rub, 0.002);
  return { muzzle: V3(0, yb, -0.84), support: V3(0, 0.0, -0.38) };
}

function makeAUG(g) {
  const m = rifleMats(), P = (pts, w, mt, b) => prof(pts, w, mt, g, b), yb = 0.07, ol = mat('augol', '#62724f', 0.6, 0.08), ol2 = mat('augol2', '#4a5840', 0.62, 0.08), mag = mat('augmag', '#4f565e', 0.3, 0.15);
  P([[0.27, 0.105], [0.28, 0.095], [0.28, 0.0], [0.25, -0.012], [-0.35, -0.012], [-0.45, 0.018], [-0.45, 0.082], [-0.35, 0.098], [-0.2, 0.105]], 0.054, ol, 0.006);
  P([[0.12, 0.105], [0.12, 0.15], [0.09, 0.175], [-0.1, 0.175], [-0.13, 0.15], [-0.13, 0.105]], 0.052, m.dark, 0.005); // integral optic
  cyl(0.022, 0.03, m.dark, 0, 0.15, -0.14, g, 'z', 18); cyl(0.0165, 0.004, mat('auglens', '#2a4a6a', 0.1, 0.9), 0, 0.15, -0.157, g, 'z', 18);
  P([[0.1, 0.175], [0.08, 0.186], [-0.08, 0.186], [-0.1, 0.175]], 0.034, m.steel, 0.003);
  P([[0.278, 0.103], [0.298, 0.095], [0.298, 0.0], [0.278, 0.008]], 0.052, m.rub, 0.002);
  P([[0.012, 0.0], [0.026, -0.05], [0.036, -0.12], [-0.005, -0.125], [-0.018, -0.05], [-0.02, 0.0]], 0.036, m.grip, 0.004);
  triggerGuard(g, ol2, -0.015, -0.1, -0.012, -0.045, 0.012); const tr = box(0.006, 0.02, 0.006, m.dark, 0, -0.016, -0.05, g); tr.rotation.x = 0.28;
  P([[0.07, -0.012], [0.07, -0.1], [0.076, -0.168], [0.15, -0.168], [0.142, -0.1], [0.14, -0.012]], 0.034, mag, 0.003); // translucent-look mag
  P([[-0.24, -0.012], [-0.24, -0.1], [-0.3, -0.105], [-0.3, -0.012]], 0.028, ol2, 0.004); // forward vertical grip
  ventSlots(g, m.dark, 0.0295, [-0.34, -0.37, -0.4], 0.05, 0.02, 0.014);
  cyl(0.0105, 0.34, m.steel, 0, yb, -0.62, g, 'z', 14); cyl(0.0155, 0.05, m.dark, 0, yb, -0.805, g, 'z', 14); cyl(0.006, 0.004, m.bore, 0, yb, -0.83, g);
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) box(0.003, 0.012, 0.008, m.steel, s * 0.0155, yb, -0.795 - i * 0.012, g);
  P([[-0.72, 0.074], [-0.72, 0.104], [-0.732, 0.11], [-0.748, 0.11], [-0.752, 0.074]], 0.012, m.steel, 0.002);
  return { muzzle: V3(0, yb, -0.83), support: V3(0, -0.06, -0.27) };
}

// ---------------------------------------------------------------- weapons
const PISTOLS = new Set(['glock', 'usp', 'deagle']), NADE_KEYS = new Set(['he', 'flash', 'smoke']);
const RIFLES = new Set(['ak47','m4a4','awp','mac10','mp9','p90','galil','famas','m4a1s','sg553','aug']);
export function makeGun(k) {
  const g = new THREE.Group(); g.name = 'gun:' + k;
  const blk = mat('blk', '#2a2d31', 0.45, 0.55), gun = mat('gunm', '#3a3e44', 0.38, 0.65), wood = mat('wood', '#7b4a22', 0.65), wood2 = mat('wood2', '#5d3417', 0.7);
  const tan = mat('tan', '#b59a6a', 0.8), olive = mat('olive', '#4d5b3c', 0.6, 0.2), silver = mat('silver', '#b9bcc0', 0.25, 0.9), poly = mat('poly', '#33332f', 0.65);
  let muzzle = new THREE.Vector3(0, 0.05, -0.5), support = null, led = null;
  const S = (x, y, z) => new THREE.Vector3(x, y, z);
  switch (k) {
    case 'ak47': ({ muzzle, support } = makeAK47(g)); break;
    case 'm4a4': ({ muzzle, support } = makeM4(g, false)); break;
    case 'm4a1s': ({ muzzle, support } = makeM4(g, true)); break;
    case 'awp': ({ muzzle, support } = makeAWP(g)); break;
    case 'mac10': ({ muzzle, support } = makeMAC10(g)); break;
    case 'mp9': ({ muzzle, support } = makeMP9(g)); break;
    case 'p90': ({ muzzle, support } = makeP90(g)); break;
    case 'galil': ({ muzzle, support } = makeGalil(g)); break;
    case 'famas': ({ muzzle, support } = makeFAMAS(g)); break;
    case 'sg553': ({ muzzle, support } = makeSG553(g)); break;
    case 'aug': ({ muzzle, support } = makeAUG(g)); break;
    case 'deagle': ({ muzzle, support } = makeDeagle(g)); break;
    case 'usp': ({ muzzle, support } = makeUSP(g)); break;
    case 'glock': ({ muzzle, support } = makeGlock(g)); break;
    case 'he': makeHE(g); muzzle.set(0, 0, -0.05); break;
    case 'flash': makeFlash(g); muzzle.set(0, 0, -0.05); break;
    case 'smoke': makeSmoke(g); muzzle.set(0, 0, -0.05); break;
    case 'knife': {
      // Slim, compact tactical knife: narrow blade, short handle, no spoon-like bulk.
      const blade = mat('knifeBlade', '#66788f', 0.16, 0.98);
      const bladeEdge = mat('knifeBladeEdge', '#e7edf2', 0.06, 1.0);
      const bladeDark = mat('knifeBladeDark', '#2d3947', 0.18, 0.95);
      const frame = mat('knifeFrame', '#3a424b', 0.20, 0.92);
      const frameHi = mat('knifeFrameHi', '#aeb8c2', 0.13, 0.95);
      const grip = mat('knifeGrip2', '#20262c', 0.68, 0.10);
      const gripHi = mat('knifeGripHi2', '#59646e', 0.44, 0.28);
      const accent = mat('knifeAccent', '#8aa6c5', 0.12, 0.92);
      rbox(0.048, 0.058, 0.205, 0.010, grip, 0, 0.02, 0.075, g);
      for (let i = 0; i < 4; i++) {
        const ring = rbox(0.051, 0.006, 0.030, 0.0025, gripHi, 0, 0.009, i * 0.040, g);
        ring.rotation.x = -0.14;
      }
      box(0.053, 0.010, 0.215, frameHi, 0, 0.032, 0.075, g);
      box(0.059, 0.009, 0.205, frame, 0, -0.031, 0.075, g);
      cyl(0.025, 0.034, frameHi, 0, 0.001, 0.182, g, 'z', 16);
      box(0.092, 0.014, 0.028, frameHi, 0, 0.002, -0.035, g);
      box(0.018, 0.030, 0.034, frame, 0, -0.008, -0.035, g);
      torus(0.020, 0.0035, accent, 0, 0.001, 0.182, g);
      // Narrow pointed blade; much slimmer than the previous broad karambit.
      prof([
        [-0.055, 0.010], [-0.15, 0.028], [-0.27, 0.043], [-0.40, 0.050],
        [-0.53, 0.046], [-0.64, 0.032], [-0.73, 0.012], [-0.79, -0.004],
        [-0.72, -0.012], [-0.59, -0.009], [-0.43, 0.002], [-0.27, 0.010], [-0.10, 0.009]
      ], 0.026, blade, g, 0.003);
      prof([
        [-0.07, 0.008], [-0.22, 0.001], [-0.38, -0.006], [-0.55, -0.013],
        [-0.70, -0.012], [-0.79, -0.004], [-0.70, 0.005], [-0.57, 0.010],
        [-0.41, 0.017], [-0.24, 0.019], [-0.08, 0.015]
      ], 0.028, bladeEdge, g, 0.0018);
      prof([
        [-0.09, 0.030], [-0.24, 0.038], [-0.39, 0.040], [-0.53, 0.033],
        [-0.65, 0.021], [-0.52, 0.027], [-0.37, 0.029], [-0.19, 0.022]
      ], 0.028, bladeDark, g, 0.0015);
      for (let i = 0; i < 2; i++) {
        const cut = box(0.007, 0.005, 0.038, frameHi, 0, 0.044, -0.39 - i * 0.055, g);
        cut.rotation.y = -0.18;
      }
      const loop = torus(0.030, 0.007, frameHi, 0, 0.003, 0.202, g);
      loop.rotation.x = Math.PI / 2;
      muzzle.set(0, 0.006, -0.79);
      support = S(0, -0.010, -0.18);
      // Extra compact pass: keep the knife clearly smaller than the previous slim version.
      g.scale.setScalar(0.72);
      break;
    }
    case 'c4': ({ led } = makeC4(g)); muzzle.set(0, 0, -0.2); break;
    default: box(0.05, 0.08, 0.3, gun, 0, 0.05, -0.1, g);
  }
  if (NADE_KEYS.has(k)) g.children.forEach((c) => { c.position.z -= 0.035; c.position.y += 0.02; }); // sit in the palm, slightly ahead of the grip point
  g.userData.muzzle = muzzle; g.userData.support = support; if (led) g.userData.led = led;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------------------------------------------------------------- characters
const LOOK = {
  T: { pants: '#8a7a58', shirt: '#6b5638', vest: '#4a3f2c', vest2: '#3a3122', mask: '#1f1f1f', skin: '#c79a74', glove: '#2b241c', boot: '#3b2e1f', accent: '#a38351', band: '#7a2b20' },
  CT: { pants: '#33404f', shirt: '#3d4e66', vest: '#2a3442', vest2: '#20272f', mask: '#2b3644', skin: '#c79a74', glove: '#1a1c20', boot: '#17191c', accent: '#5b7aa6', band: '#2d6bb5' },
};
export function makeSoldier(team) {
  const L = LOOK[team] || LOOK.CT; const k = team + ':';
  const pants = mat(k + 'p', L.pants, 0.92), shirt = mat(k + 's', L.shirt, 0.9), vest = mat(k + 'v', L.vest, 0.82), vest2 = mat(k + 'v2', L.vest2, 0.85);
  const skin = mat('skin', L.skin, 0.65), mask = mat(k + 'mask', L.mask, 0.85), glove = mat(k + 'g', L.glove, 0.75), boot = mat(k + 'b', L.boot, 0.7);
  const acc = mat(k + 'a', L.accent, 0.7), lens = mat('lens', '#0d0f12', 0.12, 0.8), strap = mat('strap', '#1a1a1a', 0.8), band = mat(k + 'band', L.band, 0.6);
  const root = new THREE.Group(), hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
  rbox(0.33, 0.17, 0.22, 0.05, pants, 0, 0.0, 0, hips);
  rbox(0.35, 0.05, 0.235, 0.015, strap, 0, 0.075, 0, hips);
  rbox(0.05, 0.035, 0.02, 0.006, mat('buckle', '#8c8c86', 0.4, 0.8), 0, 0.075, -0.12, hips);
  const legs = [];
  for (const s of [-1, 1]) {
    const thigh = new THREE.Group(); thigh.position.set(0.095 * s, -0.03, 0); hips.add(thigh);
    capsule(0.082, 0.3, pants, 0, -0.2, 0, thigh);
    rbox(0.04, 0.12, 0.11, 0.015, pants, 0.085 * s, -0.22, 0.0, thigh); // cargo pocket
    if (s === 1) rbox(0.05, 0.14, 0.08, 0.015, vest2, 0.085, -0.12, 0.02, thigh); // holster
    const shin = new THREE.Group(); shin.position.y = -0.42; thigh.add(shin);
    capsule(0.068, 0.3, pants, 0, -0.2, 0, shin);
    rbox(0.12, 0.12, 0.055, 0.02, team === 'CT' ? vest2 : acc, 0, 0.0, -0.065, shin); // knee pad
    rbox(0.125, 0.11, 0.27, 0.03, boot, 0, -0.455, -0.035, shin);
    rbox(0.13, 0.025, 0.28, 0.008, mat('sole', '#121212', 0.9), 0, -0.505, -0.035, shin);
    legs.push({ thigh, shin });
  }
  // torso
  const torso = new THREE.Group(); hips.add(torso);
  rbox(0.3, 0.22, 0.19, 0.06, shirt, 0, 0.18, 0, torso);
  rbox(0.42, 0.3, 0.23, 0.08, shirt, 0, 0.42, 0, torso);
  rbox(0.4, 0.32, 0.27, 0.05, vest, 0, 0.38, 0, torso);
  for (const x of [-0.11, 0, 0.11]) { rbox(0.095, 0.11, 0.05, 0.012, vest2, x, 0.31, -0.155, torso); box(0.08, 0.025, 0.054, vest, x, 0.355, -0.155, torso); }
  rbox(0.07, 0.12, 0.05, 0.012, vest2, 0.15, 0.47, -0.14, torso); // radio
  cyl(0.004, 0.12, strap, 0.17, 0.58, -0.14, torso, 'y', 5);
  if (team === 'CT') { const p = box(0.07, 0.045, 0.004, band, -0.12, 0.47, -0.163, torso); p.castShadow = false; box(0.06, 0.012, 0.005, mat('patchw', '#e8e8e8', 0.8), -0.12, 0.47, -0.164, torso); }
  else { rbox(0.44, 0.06, 0.29, 0.02, mat('Tbando', '#5a4a2e', 0.9), 0, 0.29, 0, torso).rotation.z = 0.5; }
  rbox(0.3, 0.3, 0.12, 0.03, mat(k + 'pack', team === 'T' ? '#3b3324' : '#232a33', 0.9), 0, 0.4, 0.18, torso);
  const bombPack = makeGun('c4'); bombPack.rotation.x = Math.PI / 2; bombPack.position.set(0, 0.28, 0.255); bombPack.scale.setScalar(0.95); bombPack.visible = false; torso.add(bombPack);
  cyl(0.06, 0.08, skin, 0, 0.6, 0, torso, 'y');
  // head
  const neck = new THREE.Group(); neck.position.y = 0.62; torso.add(neck);
  const head = sphere(0.11, team === 'T' ? mask : skin, 0, 0.12, 0, neck, 18, 14); head.scale.set(0.92, 1.08, 1.0);
  if (team === 'T') {
    rbox(0.15, 0.042, 0.04, 0.012, skin, 0, 0.13, -0.088, neck); // eye slit
    for (const s of [-1, 1]) { const l = cyl(0.022, 0.016, lens, s * 0.038, 0.132, -0.108, neck, 'z', 12); l.castShadow = false; }
    box(0.02, 0.012, 0.01, strap, 0, 0.132, -0.108, neck);
    const st = torus(0.104, 0.007, strap, 0, 0.13, 0, neck); st.rotation.x = Math.PI / 2; st.scale.set(0.95, 1.05, 1);
    rbox(0.24, 0.035, 0.23, 0.015, band, 0, 0.2, 0.01, neck); // headband
  } else {
    sphere(0.016, skin, 0, 0.095, -0.11, neck, 8, 6); // nose
    box(0.04, 0.006, 0.01, mat('mouth', '#6b3d33', 0.8), 0, 0.055, -0.1, neck);
    const helm = mesh(G('helm', () => new THREE.SphereGeometry(0.128, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52)), mat(k + 'helm', '#3a4552', 0.55, 0.15), 0, 0.15, 0.008, neck); helm.scale.set(0.98, 1.0, 1.06);
    const rim = torus(0.122, 0.008, mat(k + 'rim', '#2a323c', 0.6, 0.2), 0, 0.15, 0.008, neck); rim.rotation.x = Math.PI / 2;
    rbox(0.05, 0.03, 0.03, 0.006, strap, 0, 0.235, -0.115, neck); // NVG mount
    for (const s of [-1, 1]) { cyl(0.045, 0.035, mat('headset', '#2b2f2a', 0.6, 0.2), s * 0.112, 0.11, 0.005, neck, 'x', 14); rbox(0.02, 0.06, 0.04, 0.008, strap, s * 0.11, 0.17, 0.0, neck); }
    rbox(0.17, 0.04, 0.025, 0.012, lens, 0, 0.128, -0.1, neck); // goggles
    const gs = torus(0.11, 0.006, strap, 0, 0.13, 0.0, neck); gs.rotation.x = Math.PI / 2;
  }
  // arms (shoulder joints live in an aim group so the whole upper body follows pitch)
  const arms = new THREE.Group(); arms.position.y = 0.52; torso.add(arms);
  const hand = new THREE.Group(); arms.add(hand);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  const rig = { root, hips, legs, torso, neck, arms, hand, bombPack, gun: null, gunKey: null, phase: 0, dead: 0, deadDir: 1, team, armMesh: null, look: { shirt, glove, skin, vest } };
  buildArms(rig, null);
  return rig;
}
// Pose presets in the arms (aim) frame. grip = firing hand, off = support-hand override.
function poseFor(k, gun) {
  if (PISTOLS.has(k)) return { grip: [0.035, 0.07, -0.5], lsh: [-0.17, 0, -0.04], useSupport: true };
  if (NADE_KEYS.has(k)) return { grip: [0.21, 0.06, -0.28], off: [-0.13, -0.08, -0.36], lsh: [-0.2, 0, 0] };
  if (k === 'knife') return { grip: [0.19, -0.055, -0.27], off: [-0.17, -0.28, -0.10], lsh: [-0.18, 0, 0] };
  if (k === 'c4') return { grip: [0.085, -0.13, -0.3], off: [-0.085, -0.13, -0.38], lsh: [-0.2, 0, 0], gunOffset: [-0.085, 0, 0] };
  if (!k) return { grip: [0.22, -0.48, -0.08], off: [-0.22, -0.48, -0.08], lsh: [-0.2, 0, 0] };
  return { grip: [0.085, 0.05, -0.32], lsh: [-0.17, 0, -0.07], useSupport: true };
}
const GUN_SCALE = 0.85;
function buildArms(rig, k) {
  if (rig.armMesh) rig.arms.remove(rig.armMesh);
  const grp = new THREE.Group(); rig.armMesh = grp; rig.arms.add(grp);
  const P = poseFor(k, rig.gun); const V = (a) => new THREE.Vector3(...a);
  const grip = V(P.grip); rig.hand.position.copy(grip); if (P.gunOffset) rig.hand.position.add(V(P.gunOffset));
  rig.hand.rotation.set(0, 0, 0);
  let off = P.off ? V(P.off) : null;
  if (P.useSupport && rig.gun && rig.gun.userData.support) off = rig.gun.userData.support.clone().multiplyScalar(GUN_SCALE).add(grip);
  if (!off) off = V([-0.22, -0.46, -0.06]);
  const { shirt, glove, skin, vest } = rig.look; const isT = rig.team === 'T';
  const arm = (S, Tg, side) => {
    const E = solveElbow(S, Tg, 0.28, 0.27, new THREE.Vector3(0.55 * side, -1, 0.25));
    rbox(0.13, 0.11, 0.15, 0.04, vest, S.x * 0.92, S.y + 0.02, S.z, grp); // shoulder pad
    limbSeg(S, E, 0.06, shirt, grp);
    const wrist = Tg.clone().addScaledVector(Tg.clone().sub(E).normalize(), -0.035);
    limbSeg(E, wrist, 0.05, isT ? skin : shirt, grp);
    if (isT) { const cuff = limbSeg(E, E.clone().lerp(wrist, 0.18), 0.058, shirt, grp); cuff.castShadow = false; }
    const h = rbox(0.06, 0.08, 0.095, 0.022, glove, Tg.x, Tg.y, Tg.z, grp); h.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), Tg.clone().sub(E).normalize());
  };
  const lsh = V(P.lsh);
  arm(new THREE.Vector3(0.2, 0, 0), grip, 1);
  arm(lsh, off, -1);
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
}
export function setRigWeapon(rig, k) {
  if (rig.gunKey === k) return; if (rig.gun) rig.hand.remove(rig.gun);
  rig.gun = makeGun(k); rig.gun.scale.setScalar(GUN_SCALE); rig.hand.add(rig.gun); rig.gunKey = k;
  buildArms(rig, k);
}
// Pose the rig. a: {speed, crouch, pitch, air, dt, alive}
export function animateRig(rig, a) {
  const dt = a.dt || 0.016;
  if (!a.alive) {
    rig.dead = Math.min(1, rig.dead + dt * 2.6); const e = 1 - Math.pow(1 - rig.dead, 3);
    rig.root.rotation.x = -e * 1.45 * rig.deadDir; rig.hips.position.y = 0.95 - e * 0.68; rig.torso.rotation.x = 0; rig.arms.rotation.x = -e * 0.6;
    rig.legs.forEach((l, i) => { l.thigh.rotation.x = e * (0.25 + i * 0.15) * rig.deadDir; l.shin.rotation.x = -e * 0.35; });
    return;
  }
  rig.dead = 0; rig.root.rotation.x = 0;
  const sp = Math.min(1.2, a.speed / 6); rig.phase += dt * (4 + a.speed * 1.45) * (sp > 0.05 ? 1 : 0);
  const sw = Math.sin(rig.phase) * 0.7 * sp, bob = Math.abs(Math.cos(rig.phase)) * 0.035 * sp;
  if (a.crouch) {
    rig.hips.position.y = 0.6; rig.legs.forEach((l, i) => { const s = (i ? sw : -sw) * 0.3; l.thigh.rotation.x = (i ? 1.0 : 1.25) + s; l.shin.rotation.x = (i ? -1.82 : -1.83) - s * 0.5; }); rig.torso.rotation.x = -0.22;
  } else if (a.air) {
    rig.hips.position.y = 0.97; rig.legs.forEach((l, i) => { l.thigh.rotation.x = 0.55 + i * 0.25; l.shin.rotation.x = -0.95 - i * 0.2; }); rig.torso.rotation.x = -0.06;
  } else {
    rig.hips.position.y = 0.95 + bob - 0.01 * sp; rig.legs.forEach((l, i) => { const s = i ? sw : -sw; l.thigh.rotation.x = s; l.shin.rotation.x = -(0.06 + Math.max(0, -s) * 1.15 + Math.max(0, s) * 0.15); }); rig.torso.rotation.x = -0.05 * sp;
  }
  const p = Math.max(-1.1, Math.min(1.1, a.pitch || 0));
  rig.arms.rotation.x = p * 0.9 - rig.torso.rotation.x; rig.neck.rotation.x = p * 0.5 - rig.torso.rotation.x * 0.5; rig.torso.rotation.y = Math.sin(rig.phase) * 0.05 * sp;
}

// ---------------------------------------------------------------- first-person view model
const supportCache = {};
function supportOf(k) { if (!(k in supportCache)) { const g = makeGun(k); supportCache[k] = g.userData.support ? g.userData.support.toArray() : null; } return supportCache[k]; }
export function makeViewArms(team, k) {
  const L = LOOK[team] || LOOK.CT; const g = new THREE.Group(); const isT = team === 'T';
  const sleeve = mat('vm' + team + 's', L.shirt, 0.9), cuff = mat('vm' + team + 'c', L.vest, 0.85), glove = mat('vm' + team + 'g', L.glove, 0.7), skin = mat('skin', L.skin, 0.65), knuckle = mat('vm' + team + 'k', isT ? '#3a3026' : '#2a2e35', 0.6);
  const limb = (wrist, elbow, w) => {
    const a = new THREE.Vector3(...wrist), b = new THREE.Vector3(...elbow), dir = b.clone().sub(a).normalize();
    const cuffStart = a.clone().addScaledVector(dir, 0.05);
    limbSeg(cuffStart, b, w * 0.55, isT ? skin : sleeve, g);
    limbSeg(a.clone().addScaledVector(dir, isT ? 0.17 : 0.06), a.clone().addScaledVector(dir, isT ? 0.24 : 0.1), w * 0.62, isT ? sleeve : cuff, g);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const palm = rbox(w * 0.85, w * 1.05, 0.085, 0.02, glove, 0, 0, 0, g); palm.position.copy(a); palm.quaternion.copy(q);
    const kn = rbox(w * 0.9, w * 0.5, 0.035, 0.012, knuckle, 0, 0, 0, g); kn.position.copy(a).addScaledVector(dir, -0.04).add(new THREE.Vector3(0, w * 0.3, 0)); kn.quaternion.copy(q);
    limbSeg(a.clone().addScaledVector(dir, 0.02), a.clone().addScaledVector(dir, 0.02).add(new THREE.Vector3(-0.025, 0.02, -0.04)), 0.011, glove, g); // thumb
  };
  limb([0.0, -0.04, 0.02], [0.13, -0.3, 0.42], 0.075);
  let lh;
  if (k === 'knife' || NADE_KEYS.has(k)) lh = null;
  else if (k === 'c4') lh = [-0.09, -0.02, -0.06];
  else if (PISTOLS.has(k)) lh = [-0.03, -0.055, 0.0];
  else { const s = supportOf(k); lh = s ? [s[0] - 0.005, s[1] - 0.025, s[2]] : [-0.035, -0.06, 0.0]; }
  if (lh) limb(lh, [-0.26, -0.3, 0.32], 0.07);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}
