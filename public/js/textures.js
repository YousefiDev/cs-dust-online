// Procedural canvas textures: Dust II sandstone, pavers, crates, blue doors. No image downloads required.
import * as THREE from 'three';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function noiseLayer(ctx, w, h, r, amount, seed, scale = 1) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data, R = rng(seed);
  const gw = Math.ceil(w / (8 * scale)) + 2, gh = Math.ceil(h / (8 * scale)) + 2, g = new Float32Array(gw * gh).map(() => R());
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = x / (8 * scale), fy = y / (8 * scale), ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
    const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], e = g[(iy + 1) * gw + ix + 1];
    const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
    const n = (v - 0.5) * amount + (R() - 0.5) * r; const i = (y * w + x) * 4;
    d[i] += n; d[i + 1] += n * 0.95; d[i + 2] += n * 0.85;
  }
  ctx.putImageData(img, 0, 0);
}
function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, rep = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep);
  t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}

// Build a lightweight tangent-space normal map from the procedural texture itself.
// This gives the high/medium presets small-scale brick, plaster and stone relief
// without shipping large external image assets.
export function normalFrom(colorTex, strength = 0.55) {
  const c = colorTex?.image;
  if (!c || !c.getContext) return null;
  const key = `${c.width}x${c.height}:${strength}:${colorTex.uuid}`;
  colorTex.userData ||= {};
  if (colorTex.userData[key]) return colorTex.userData[key];
  const ctx = c.getContext('2d');
  const src = ctx.getImageData(0, 0, c.width, c.height).data;
  const out = document.createElement('canvas'); out.width = c.width; out.height = c.height;
  const ox = out.getContext('2d'); const img = ox.createImageData(c.width, c.height); const d = img.data;
  const W = c.width, H = c.height;
  const lum = (i) => (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xm = (x - 1 + W) % W, xp = (x + 1) % W, ym = (y - 1 + H) % H, yp = (y + 1) % H;
    const dx = (lum((y * W + xp) * 4) - lum((y * W + xm) * 4)) * strength;
    const dy = (lum((yp * W + x) * 4) - lum((ym * W + x) * 4)) * strength;
    const l = Math.hypot(dx, dy, 1) || 1, i = (y * W + x) * 4;
    d[i] = (dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ox.putImageData(img, 0, 0);
  const n = new THREE.CanvasTexture(out); n.wrapS = n.wrapT = THREE.RepeatWrapping; n.repeat.copy(colorTex.repeat); n.anisotropy = colorTex.anisotropy; n.needsUpdate = true;
  colorTex.userData[key] = n; return n;
}
export function sandstone(base = '#d8b47c', seed = 7) {
  const S = 512, [c, x] = canvas(S); x.fillStyle = base; x.fillRect(0, 0, S, S);
  const R = rng(seed); const rowH = 64;
  for (let row = 0; row < S / rowH; row++) {
    let px = -Math.floor(R() * 80);
    while (px < S) {
      const bw = 90 + Math.floor(R() * 90), tint = (R() - 0.5) * 26;
      x.fillStyle = `rgba(${tint > 0 ? 255 : 60},${tint > 0 ? 235 : 40},${tint > 0 ? 200 : 20},${Math.abs(tint) / 160})`;
      x.fillRect(px + 2, row * rowH + 2, bw - 4, rowH - 4);
      x.fillStyle = 'rgba(90,60,30,0.45)'; x.fillRect(px, row * rowH, bw, 3); x.fillRect(px, row * rowH, 3, rowH);
      x.fillStyle = 'rgba(255,240,210,0.18)'; x.fillRect(px + 3, row * rowH + 3, bw - 6, 2);
      if (R() < 0.35) { x.fillStyle = 'rgba(80,50,25,0.25)'; x.beginPath(); x.arc(px + R() * bw, row * rowH + R() * rowH, 3 + R() * 9, 0, 7); x.fill(); }
      px += bw;
    }
  }
  noiseLayer(x, S, S, 18, 34, seed + 1, 2);
  return tex(c);
}
export function plaster(base = '#e0c597', seed = 3) {
  const S = 512, [c, x] = canvas(S); x.fillStyle = base; x.fillRect(0, 0, S, S);
  noiseLayer(x, S, S, 14, 40, seed, 4); const R = rng(seed + 9);
  x.strokeStyle = 'rgba(110,80,45,0.35)'; x.lineWidth = 1.2;
  for (let k = 0; k < 7; k++) { x.beginPath(); let px = R() * S, py = R() * S; x.moveTo(px, py); for (let j = 0; j < 8; j++) { px += (R() - 0.5) * 50; py += R() * 30; x.lineTo(px, py); } x.stroke(); }
  for (let k = 0; k < 18; k++) { x.fillStyle = `rgba(120,85,50,${0.08 + R() * 0.12})`; x.fillRect(R() * S, R() * S, 20 + R() * 90, 10 + R() * 40); }
  return tex(c);
}
export function ground(base = '#cdb085', seed = 11) {
  const S = 512, [c, x] = canvas(S); x.fillStyle = base; x.fillRect(0, 0, S, S);
  noiseLayer(x, S, S, 26, 46, seed, 3); const R = rng(seed);
  for (let k = 0; k < 900; k++) { const v = R(); x.fillStyle = v < 0.5 ? `rgba(110,80,50,${0.15 + R() * 0.3})` : `rgba(255,240,215,${0.1 + R() * 0.2})`; x.beginPath(); x.arc(R() * S, R() * S, 0.6 + R() * 2.4, 0, 7); x.fill(); }
  return tex(c);
}
export function pavers(base = '#c8ab80', seed = 5, n = 4) {
  const S = 512, [c, x] = canvas(S); x.fillStyle = base; x.fillRect(0, 0, S, S); const R = rng(seed), q = S / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const t = (R() - 0.5) * 30; x.fillStyle = `rgba(${t > 0 ? '255,240,215' : '70,50,30'},${Math.abs(t) / 120})`; x.fillRect(i * q + 3, j * q + 3, q - 6, q - 6);
    x.strokeStyle = 'rgba(80,58,35,0.55)'; x.lineWidth = 4; x.strokeRect(i * q + 1, j * q + 1, q - 2, q - 2);
  }
  noiseLayer(x, S, S, 20, 30, seed + 2, 2); return tex(c);
}
export function cobble(base = '#b9a07c', seed = 21) {
  const S = 512, [c, x] = canvas(S); x.fillStyle = '#6f5c45'; x.fillRect(0, 0, S, S); const R = rng(seed);
  for (let k = 0; k < 260; k++) { const px = R() * S, py = R() * S, r = 14 + R() * 16; const t = 0.85 + R() * 0.3;
    x.fillStyle = `rgb(${185 * t | 0},${160 * t | 0},${124 * t | 0})`; x.beginPath(); x.ellipse(px, py, r, r * (0.7 + R() * 0.3), R() * 3, 0, 7); x.fill(); }
  noiseLayer(x, S, S, 18, 26, seed, 2); return tex(c);
}
export function crate(seed = 31) {
  const S = 256, [c, x] = canvas(S); x.fillStyle = '#a77b45'; x.fillRect(0, 0, S, S); const R = rng(seed);
  for (let i = 0; i < 8; i++) { const t = 0.85 + R() * 0.25; x.fillStyle = `rgb(${170 * t | 0},${124 * t | 0},${72 * t | 0})`; x.fillRect(0, i * 32 + 1, S, 30); }
  noiseLayer(x, S, S, 22, 18, seed, 1);
  x.fillStyle = '#6e4a24'; const b = 22; x.fillRect(0, 0, S, b); x.fillRect(0, S - b, S, b); x.fillRect(0, 0, b, S); x.fillRect(S - b, 0, b, S);
  x.save(); x.translate(S / 2, S / 2); x.rotate(Math.PI / 4); x.fillRect(-S * 0.7, -b / 2, S * 1.4, b); x.restore();
  x.fillStyle = 'rgba(40,25,10,0.5)'; for (const [px, py] of [[11, 11], [S - 11, 11], [11, S - 11], [S - 11, S - 11]]) { x.beginPath(); x.arc(px, py, 3, 0, 7); x.fill(); }
  x.strokeStyle = 'rgba(30,20,10,0.6)'; x.lineWidth = 2; x.strokeRect(1, 1, S - 2, S - 2);
  return tex(c);
}
export function blueDoor(seed = 41) {
  const S = 256, [c, x] = canvas(S, 512); x.fillStyle = '#2e6f9c'; x.fillRect(0, 0, S, 512); const R = rng(seed);
  for (let i = 0; i < 6; i++) { x.fillStyle = `rgba(10,30,50,0.5)`; x.fillRect(i * 43, 0, 3, 512); }
  for (let k = 0; k < 160; k++) { x.fillStyle = `rgba(200,170,120,${0.1 + R() * 0.4})`; x.fillRect(R() * S, R() * 512, 2 + R() * 14, 1 + R() * 5); }
  x.fillStyle = '#1d4766'; x.fillRect(0, 60, S, 14); x.fillRect(0, 420, S, 14);
  noiseLayer(x, S, 512, 16, 24, seed, 2); return tex(c);
}
export function siteDecal(letter) {
  const S = 256, [c, x] = canvas(S); x.clearRect(0, 0, S, S);
  x.font = '900 210px Impact, "Arial Black", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = 'rgba(185,40,30,0.88)'; x.fillText(letter, S / 2, S / 2 + 10);
  x.globalCompositeOperation = 'destination-out'; const R = rng(letter.charCodeAt(0));
  for (let k = 0; k < 500; k++) { x.fillStyle = `rgba(0,0,0,${R() * 0.6})`; x.fillRect(R() * S, R() * S, 1 + R() * 4, 1 + R() * 4); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function radial(inner = 'rgba(255,240,200,1)', outer = 'rgba(255,160,40,0)') {
  const S = 128, [c, x] = canvas(S); const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner); g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.6)')); g.addColorStop(1, outer); x.fillStyle = g; x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function muzzleStar() {
  const S = 128, [c, x] = canvas(S); x.translate(S / 2, S / 2);
  for (let k = 0; k < 7; k++) { x.rotate((Math.PI * 2) / 7); const g = x.createLinearGradient(0, 0, 60, 0); g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(1, 'rgba(255,150,30,0)'); x.fillStyle = g; x.beginPath(); x.moveTo(0, -7); x.lineTo(62, 0); x.lineTo(0, 7); x.fill(); }
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 30); g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(1, 'rgba(255,170,60,0)'); x.fillStyle = g; x.beginPath(); x.arc(0, 0, 30, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function bulletHole() {
  const S = 64, [c, x] = canvas(S); const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(15,10,5,1)'); g.addColorStop(0.18, 'rgba(25,18,10,0.95)'); g.addColorStop(0.3, 'rgba(70,50,30,0.6)'); g.addColorStop(1, 'rgba(90,70,40,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
