// CS:GO-inspired weapon table. Speeds in m/s (250u/s ~= 6.35m/s), spread in radians.
export const WEAPONS = {
  knife:  { name: 'Knife', slot: 3, price: 0, team: null, dmg: 40, altDmg: 65, pen: 0.85, rpm: 140, altRpm: 70, mag: 0, res: 0, reload: 0, speed: 6.35, reward: 1500, auto: true, melee: true, range: 2.05, altRange: 1.72, head: 1, falloff: 1, spread: 0, move: 0, air: 0, spray: 0, sprayMax: 0, kick: 0, side: 0, draw: 0.3 },
  glock:  { name: 'Glock-18', slot: 2, price: 200, team: 'T', dmg: 30, pen: 0.47, rpm: 400, mag: 20, res: 120, reload: 2.2, speed: 6.1, reward: 300, auto: false, head: 4, falloff: 0.85, spread: 0.010, move: 0.035, air: 0.15, spray: 0.012, sprayMax: 0.05, kick: 0.012, side: 0.004, draw: 0.35 },
  usp:    { name: 'USP-S', slot: 2, price: 200, team: 'CT', dmg: 35, pen: 0.505, rpm: 352, mag: 12, res: 24, reload: 2.2, speed: 6.1, reward: 300, auto: false, head: 4, falloff: 0.91, spread: 0.006, move: 0.03, air: 0.15, spray: 0.012, sprayMax: 0.05, kick: 0.013, side: 0.003, draw: 0.35 },
  deagle: { name: 'Desert Eagle', slot: 2, price: 700, team: null, dmg: 63, pen: 0.932, rpm: 267, mag: 7, res: 35, reload: 2.2, speed: 5.84, reward: 300, auto: false, head: 4, falloff: 0.88, spread: 0.008, move: 0.09, air: 0.25, spray: 0.04, sprayMax: 0.09, kick: 0.035, side: 0.01, draw: 0.45 },
  mac10:  { name: 'MAC-10', slot: 1, price: 1050, team: 'T', dmg: 29, pen: 0.575, rpm: 800, mag: 30, res: 100, reload: 2.6, speed: 6.1, reward: 600, auto: true, head: 4, falloff: 0.78, spread: 0.014, move: 0.03, air: 0.2, spray: 0.005, sprayMax: 0.05, kick: 0.007, side: 0.005, draw: 0.5 },
  mp9:    { name: 'MP9', slot: 1, price: 1250, team: 'CT', dmg: 26, pen: 0.6, rpm: 857, mag: 30, res: 120, reload: 2.1, speed: 6.1, reward: 600, auto: true, head: 4, falloff: 0.82, spread: 0.012, move: 0.028, air: 0.2, spray: 0.005, sprayMax: 0.045, kick: 0.007, side: 0.005, draw: 0.5 },
  ak47:   { name: 'AK-47', slot: 1, price: 2700, team: 'T', dmg: 36, pen: 0.775, rpm: 600, mag: 30, res: 90, reload: 2.5, speed: 5.47, reward: 300, auto: true, head: 4, falloff: 0.98, spread: 0.0035, move: 0.11, air: 0.3, spray: 0.0045, sprayMax: 0.04, kick: 0.016, side: 0.007, draw: 0.75 },
  m4a4:   { name: 'M4A4', slot: 1, price: 3100, team: 'CT', dmg: 33, pen: 0.7, rpm: 666, mag: 30, res: 90, reload: 3.1, speed: 5.72, reward: 300, auto: true, head: 4, falloff: 0.97, spread: 0.003, move: 0.09, air: 0.3, spray: 0.004, sprayMax: 0.035, kick: 0.013, side: 0.006, draw: 0.75 },
  awp:    { name: 'AWP', slot: 1, price: 4750, team: null, dmg: 115, pen: 0.975, rpm: 41, mag: 10, res: 30, reload: 3.7, speed: 5.3, scopedSpeed: 2.5, reward: 100, auto: false, head: 4, falloff: 0.99, spread: 0.07, scoped: 0.0012, move: 0.25, air: 0.4, spray: 0, sprayMax: 0, kick: 0.05, side: 0, draw: 1.0, scope: [40, 15] },
  c4:     { name: 'C4 Explosive', slot: 5, price: 0, team: 'T', speed: 6.35, draw: 0.3 },
  // ---- added in the merged build (ported from Counter-Strike Online Ready) ----
  p90:    { name: 'P90', slot: 1, price: 2350, team: null, dmg: 26, pen: 0.69, rpm: 857, mag: 50, res: 100, reload: 3.3, speed: 5.97, reward: 300, auto: true, head: 4, falloff: 0.84, spread: 0.013, move: 0.03, air: 0.2, spray: 0.004, sprayMax: 0.045, kick: 0.0065, side: 0.005, draw: 0.6 },
  galil:  { name: 'Galil AR', slot: 1, price: 1800, team: 'T', dmg: 30, pen: 0.775, rpm: 666, mag: 35, res: 90, reload: 3.0, speed: 5.84, reward: 300, auto: true, head: 4, falloff: 0.98, spread: 0.0045, move: 0.1, air: 0.3, spray: 0.0048, sprayMax: 0.042, kick: 0.0145, side: 0.007, draw: 0.75 },
  famas:  { name: 'FAMAS', slot: 1, price: 2050, team: 'CT', dmg: 30, pen: 0.7, rpm: 666, mag: 25, res: 90, reload: 3.3, speed: 5.84, reward: 300, auto: true, head: 4, falloff: 0.96, spread: 0.0042, move: 0.095, air: 0.3, spray: 0.0046, sprayMax: 0.04, kick: 0.0135, side: 0.0065, draw: 0.75 },
  m4a1s:  { name: 'M4A1-S', slot: 1, price: 2900, team: 'CT', dmg: 38, pen: 0.7, rpm: 600, mag: 20, res: 80, reload: 3.1, speed: 5.72, reward: 300, auto: true, head: 4, falloff: 0.94, spread: 0.0028, move: 0.085, air: 0.3, spray: 0.0038, sprayMax: 0.032, kick: 0.0115, side: 0.0045, draw: 0.75 },
  sg553:  { name: 'SG 553', slot: 1, price: 3000, team: 'T', dmg: 30, pen: 1.0, rpm: 545, mag: 30, res: 90, reload: 2.8, speed: 5.3, scopedSpeed: 3.8, reward: 300, auto: true, head: 4, falloff: 0.98, spread: 0.0042, scoped: 0.0016, move: 0.11, air: 0.3, spray: 0.0045, sprayMax: 0.04, kick: 0.015, side: 0.006, draw: 0.75, scope: [45] },
  aug:    { name: 'AUG', slot: 1, price: 3300, team: 'CT', dmg: 28, pen: 0.9, rpm: 666, mag: 30, res: 90, reload: 3.8, speed: 5.5, scopedSpeed: 3.8, reward: 300, auto: true, head: 4, falloff: 0.98, spread: 0.0036, scoped: 0.0015, move: 0.1, air: 0.3, spray: 0.0042, sprayMax: 0.038, kick: 0.0135, side: 0.0055, draw: 0.75, scope: [45] },
  he:     { name: 'HE Grenade', slot: 4, price: 300, team: null, nade: true, max: 1, dmg: 98, pen: 0.575, radius: 9, fuse: 1.6, speed: 6.1, reward: 300, rpm: 60, draw: 0.5 },
  flash:  { name: 'Flashbang', slot: 4, price: 200, team: null, nade: true, max: 2, fuse: 1.6, speed: 6.1, reward: 0, rpm: 60, draw: 0.5 },
  smoke:  { name: 'Smoke Grenade', slot: 4, price: 300, team: null, nade: true, max: 1, fuse: 3.0, life: 18, radius: 4.2, speed: 6.1, reward: 0, rpm: 60, draw: 0.5 },
};
export const NADES = ['he', 'flash', 'smoke'];
export const NADE_LIMIT = 4;
export const WEAPON_KEYS = Object.keys(WEAPONS);
export const GEAR = {
  vest:  { name: 'Kevlar Vest', price: 650 },
  vesthelm: { name: 'Kevlar + Helmet', price: 1000 },
  kit:   { name: 'Defuse Kit', price: 400, team: 'CT' },
};
export const BUY_MENU = [
  { title: 'Pistols', items: ['glock', 'usp', 'deagle'] },
  { title: 'SMGs', items: ['mac10', 'mp9', 'p90'] },
  { title: 'Rifles', items: ['galil', 'famas', 'ak47', 'm4a4', 'm4a1s', 'sg553', 'aug', 'awp'] },
  { title: 'Grenades', items: ['he', 'flash', 'smoke'] },
  { title: 'Gear', items: ['vest', 'vesthelm', 'kit'] },
];
export const defaultPistol = (team) => (team === 'T' ? 'glock' : 'usp');
export const newWeapon = (k) => ({ k, mag: WEAPONS[k].mag || 0, res: WEAPONS[k].res || 0 });
export const newNades = () => ({ he: 0, flash: 0, smoke: 0 });
export const nadeCount = (g) => (g ? g.he + g.flash + g.smoke : 0);
export const firstNade = (g, after) => { if (!g) return null; const i = NADES.indexOf(after); for (let k = 1; k <= 3; k++) { const n = NADES[(i + k + 3) % 3]; if (g[n] > 0) return n; } return null; };

// Inaccuracy model shared by client prediction and server bots.
export function inaccuracy(w, { speed = 0, grounded = true, crouch = false, shots = 0, scoped = false }) {
  if (!w || w.melee) return 0;
  let s = (scoped && w.scoped) ? w.scoped : w.spread;
  if (crouch) s *= 0.75;
  const maxSp = w.speed || 6;
  const moveFrac = Math.max(0, Math.min(1, (speed - maxSp * 0.34) / (maxSp * 0.66)));
  s += w.move * moveFrac;
  if (!grounded) s += w.air;
  s += Math.min(w.sprayMax, w.spray * Math.max(0, shots - 1));
  return s;
}
export function spreadDir(d, s, rnd = Math.random) {
  if (s <= 0) return d;
  const a = rnd() * Math.PI * 2, r = s * rnd();
  // Build an orthonormal basis around d.
  const up = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  let ux = up[1] * d[2] - up[2] * d[1], uy = up[2] * d[0] - up[0] * d[2], uz = up[0] * d[1] - up[1] * d[0];
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = d[1] * uz - d[2] * uy, vy = d[2] * ux - d[0] * uz, vz = d[0] * uy - d[1] * ux;
  const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
  const x = d[0] + ux * ca + vx * sa, y = d[1] + uy * ca + vy * sa, z = d[2] + uz * ca + vz * sa;
  const l = Math.hypot(x, y, z); return [x / l, y / l, z / l];
}
// Armor-aware damage (CS formula, simplified).
export function applyArmor(dmg, w, part, armor, helmet) {
  const protectedPart = part === 'head' ? helmet : part !== 'legs';
  if (armor <= 0 || !protectedPart) return { hp: Math.round(dmg), armor: 0 };
  let hp = dmg * w.pen; let ad = (dmg - hp) * 0.5;
  if (ad > armor) { hp = dmg - armor * 2; ad = armor; }
  return { hp: Math.round(hp), armor: Math.round(ad) };
}
export const PART_MULT = { head: 4, chest: 1, stomach: 1.25, legs: 0.75 };
