// Map definitions. Areas/ramps use design units (x scale) and are carved out of solid rock;
// crates, roofs, zones and spawns are in meters. North is -z, CT side; T side is +z.
import { WALL } from './constants.js';

export const MAT = { WALL: 0, SAND: 1, TILE: 2, TUNNEL: 3, CRATE: 4, PLANK: 5, DARK: 6, COBBLE: 7 };

// ---------------------------------------------------------------------------------------------
// CS2 competitive layouts (v3). Authored on a 2 m design grid (64 x 64 cells = 128 m) so the
// proportions follow the official radar overviews. gridDef() converts every gameplay field
// (crates, roofs, spawns, zones, bot knowledge, props) to meters; areas/ramps stay in design units.
// ---------------------------------------------------------------------------------------------
const S2 = 2;
const sc = (v) => Math.round(v * S2 * 100) / 100;
const scR = (r) => r.map((v, i) => (i < 4 ? sc(v) : v));
function gridDef(d) {
  const S = d.scale = S2;
  const pt = ([x, z]) => [sc(x), sc(z)];
  d.roofs = (d.roofs || []).map(([x0, z0, x1, z1, c]) => [sc(x0), sc(z0), sc(x1), sc(z1), c]);
  d.crates = (d.crates || []).map(([x, z, w, dd, h, k]) => [Math.round(x * S), Math.round(z * S), Math.max(1, Math.round(w * S)), Math.max(1, Math.round(dd * S)), h, k || 'crate']);
  d.doors = (d.doors || []).map(([x0, z0, x1, z1, h]) => [sc(x0), sc(z0), sc(x1), sc(z1), h]);
  d.lamps = (d.lamps || []).map(([x, z, y]) => [sc(x), sc(z), y]);
  d.props = (d.props || []).map(([k, x, z, ...rest]) => [k, sc(x), sc(z), ...rest]);
  for (const t of ['T', 'CT']) d.spawns[t] = d.spawns[t].map(([x, z]) => [Math.floor(x * S), Math.floor(z * S)]);
  for (const k in d.sites) d.sites[k] = d.sites[k].map(sc);
  for (const k in d.buy) d.buy[k] = d.buy[k].map(sc);
  for (const k in d.routes) d.routes[k] = d.routes[k].map((r) => r.map(pt));
  for (const k in d.holds) d.holds[k] = d.holds[k].map((h) => h.map(sc));
  d.callouts = d.callouts.map(([n, ...r]) => [n, ...r.map(sc)]);
  return d;
}

// ============================== DUST II ==============================
// T spawn south (+z), CT spawn north-east, A site north-east, B site north-west.
const DUST2 = gridDef({
  id: 'dust2', name: 'Dust II', size: [128, 128], cs2: true,
  theme: { sky: '#86bfe8', haze: '#e9d2a6', sun: '#fff0d2', wall: '#d9b67f', wall2: '#cfa46c', plaster: '#dfc496', floor: '#ccad80', trim: '#b98f5a', shutter: '#3a7fa8' },
  areas: [
    // T side
    [18, 52, 40, 62, 1.5, 1],   // T spawn
    [12, 52, 18, 56, 1.5, 1],   // T -> outside tunnels
    [3, 44, 12, 56, 1.5, 1],    // Outside tunnels
    [3, 34, 8, 44, 1.5, 3],     // Upper tunnels
    [3, 16, 8, 34, 0, 3],       // B tunnels (slope)
    [3, 14, 8, 16, 0, 7],       // Tunnel exit / B close
    [8, 34, 11, 37, 1.5, 3],    // Tunnel junction
    [11, 34, 15, 37, 0, 3],     // Lower tunnel stairs
    [15, 34, 26, 37, 0, 3],     // Lower tunnels
    [26, 34, 27, 37, 0, 2],     // Lower exit
    // Mid
    [27, 14, 32, 42, 0, 2],     // Mid
    [26, 42, 34, 48, 0, 2],     // Top mid ramp
    [26, 48, 36, 52, 1.5, 1],   // Top mid
    [22, 40, 24, 52, 0, 1],     // Suicide
    [24, 40, 27, 42, 0, 2],     // Suicide -> mid
    [29, 12, 31, 14, 0, 2],     // Mid doors
    [24, 9, 37, 12, 0, 2],      // CT mid
    [30, 7, 35, 9, 0, 7],       // CT spawn -> mid stairs
    [30, 2, 38, 7, 1.0, 7],     // CT spawn
    [38, 2, 42, 6, 1.0, 7],     // CT ramp to A
    // B
    [2, 2, 18, 14, 0, 7],       // B site
    [2, 2, 7, 5, 1.0, 5],       // Back plat
    [7, 2, 9, 5, 1.0, 5],       // Back plat steps
    [18, 7, 19, 10, 0, 7],      // B doors
    [19, 7, 24, 11, 0, 2],      // Mid to B
    [20, 3, 23, 7, 0, 2],       // B window room
    [18, 4, 20, 6, 1.4, 7],     // B window sill
    // Catwalk / short / A
    [32, 15, 35, 28, 1.5, 2],   // Catwalk
    [32, 28, 35, 32, 0, 2],     // Catwalk stairs (xbox)
    [35, 15, 41, 18, 1.5, 2],   // Short stairs
    [41, 13, 46, 18, 2.0, 2],   // Short / A elevated
    [42, 2, 58, 13, 2.0, 2],    // A site
    [50, 13, 58, 18, 2.0, 1],   // A ramp
    // Long
    [52, 18, 60, 30, 0.5, 1],   // Long A
    [52, 30, 60, 36, 0.5, 1],   // Long slope
    [46, 36, 60, 42, 1.5, 1],   // Long corner
    [47, 42, 49, 44, 1.5, 1],   // Long doors
    [45, 44, 51, 52, 1.5, 1],   // Outside long
    [38, 52, 51, 58, 1.5, 1],   // Outside long -> T spawn
    [60, 12, 63, 20, -0.4, 6],  // Pit
  ],
  ramps: [
    [3, 16, 8, 34, 0, 1.5, 'z', 3],      // B tunnel slope
    [11, 34, 15, 37, 1.5, 0, 'x', 3],    // Lower tunnel stairs
    [26, 42, 34, 48, 0, 1.5, 'z', 2],    // Top mid
    [22, 40, 24, 52, 0, 1.5, 'z', 1],    // Suicide
    [30, 7, 35, 9, 1.0, 0, 'z', 7],      // CT -> mid
    [38, 2, 42, 6, 1.0, 2.0, 'x', 7],    // CT ramp -> A
    [60, 17, 63, 20, -0.4, 0.5, 'z', 6], // Pit slope
    [7, 2, 9, 5, 1.0, 0, 'x', 5],        // Back plat
    [32, 28, 35, 32, 1.5, 0, 'z', 2],    // Catwalk stairs
    [35, 15, 41, 18, 1.5, 2.0, 'x', 2],  // Short stairs
    [50, 13, 58, 18, 2.0, 0.5, 'z', 1],  // A ramp
    [52, 30, 60, 36, 0.5, 1.5, 'z', 1],  // Long slope
  ],
  roofs: [
    [3, 30, 11, 44, 4.7], [3, 18, 8, 30, 4.4], [11, 34, 26, 37, 3.7],
    [18, 7, 19, 10, 3.3], [29, 12, 31, 14, 3.4], [47, 42, 49, 44, 4.7], [12, 52, 15, 56, 4.8],
  ],
  crates: [
    [46, 4, 1, 1, 1.1], [47, 4, 1, 1, 2.2], [46, 5, 1, 1, 1.1], [53, 8, 1.5, 1, 1.3], [55, 3, 1, 1, 1.1], [44, 12, 1, 1, 1.1], [50, 3, 1, 1, 1.1, 'barrel'],
    [56, 38, 1, 2, 2.6, 'cont'], [57, 23, 1, 2, 1.3, 'cont'], [53, 20, 1, 1, 1.1], [58, 41, 1, 1, 1.1, 'barrel'],
    [31, 24, 1, 1, 1.1], [30, 49, 1.5, 1, 1.3, 'cont'], [27, 15, 0.5, 0.5, 1.1, 'barrel'],
    [10, 7, 1, 1, 2.2], [11, 7, 1, 1, 1.1], [10, 8, 1, 1, 1.1], [13, 11, 1, 2, 1.3, 'cont'], [16, 9, 1, 1, 1.1], [3, 12, 1, 1, 1.1], [16, 3, 0.5, 0.5, 1.1, 'barrel'],
    [36, 3, 1, 1, 1.1], [24, 56, 1, 1, 1.1], [34, 58, 1, 1, 1.1], [30, 55, 1, 1.5, 1.3, 'cont'],
    [48, 48, 1, 1, 1.1], [6, 48, 1, 1, 1.1], [7, 48, 1, 1, 2.2], [10, 54, 0.5, 0.5, 1.1, 'barrel'],
  ],
  doors: [
    [47, 42, 47.05, 43.4, 3.4], [48.95, 42, 49, 43.4, 3.4],
    [29, 12, 29.05, 13.3, 3.2], [30.95, 12, 31, 13.3, 3.2],
    [18, 7, 19, 7.05, 3.0], [18, 9.95, 19, 10, 3.0],
  ],
  lamps: [[5, 40, 4.4], [5, 24, 3.9], [20, 35.5, 3.4], [13.5, 54, 4.5]],
  props: [['palm', 39.4, 61.4, 1.1], ['palm', 18.6, 61.3, 1], ['awning', 21, 52, 0, 3], ['awning', 47, 44, 0, 2.2], ['awning', 40.5, 18, 0, 2.4], ['sandbags', 34, 15.2, 0], ['wires', 30, 30], ['wires', 55, 26], ['wires', 10, 50]],
  spawns: {
    T: [[25, 57], [27, 58], [29, 57], [31, 58], [33, 57], [26, 59.5], [28, 60], [30, 59.5], [32, 60], [34, 59.5]],
    CT: [[30.5, 2.5], [32, 2.5], [33.5, 2.5], [30.5, 4], [32, 4], [33.5, 4], [30.5, 5.5], [32, 5.5], [33.5, 5.5], [35, 5]],
  },
  yaw: { T: 0, CT: Math.PI },
  sites: { A: [42, 2, 58, 13], B: [2, 2, 18, 14] },
  buy: { T: [18, 52, 40, 62], CT: [30, 2, 42, 9] },
  routes: {
    A: [[[48, 50], [52, 39], [56, 26]], [[30, 47], [30, 34], [33, 24], [38, 16]], [[48, 50], [53, 40], [56, 22]]],
    B: [[[8, 50], [5, 38], [5, 20]], [[30, 47], [29, 30], [29, 13], [21, 9]], [[8, 52], [5, 32], [5, 18]]],
  },
  holds: {
    A: [[50, 8, 55, 20], [46, 7, 37, 16], [56, 4, 55, 20], [44, 11, 36, 16]],
    B: [[12, 9, 5, 17], [4, 3.5, 5, 17], [15, 10, 5, 17], [10, 12, 18, 8]],
    MID: [[30, 10, 30, 30], [34, 18, 30, 40]],
  },
  callouts: [
    ['Pit', 60, 12, 63, 20], ['A Ramp', 50, 13, 58, 18], ['Goose', 54, 2, 58, 5], ['A Site', 42, 2, 58, 13], ['Short', 35, 13, 46, 18],
    ['Catwalk', 32, 15, 35, 32], ['Xbox', 30, 23, 33, 26], ['Mid Doors', 28, 12, 32, 14], ['CT Mid', 24, 9, 37, 12], ['CT Spawn', 30, 2, 42, 9],
    ['B Window', 18, 3, 23, 7], ['B Doors', 18, 7, 24, 11], ['Back Plat', 2, 2, 9, 5], ['B Site', 2, 2, 18, 14], ['B Tunnels', 3, 14, 8, 34],
    ['Upper Tunnels', 3, 34, 11, 44], ['Lower Tunnels', 11, 34, 27, 37], ['Outside Tunnels', 3, 44, 18, 56], ['Suicide', 22, 40, 24, 52],
    ['Top Mid', 26, 42, 36, 52], ['Mid', 27, 14, 32, 42], ['Long A', 52, 18, 60, 36], ['Long Corner', 46, 36, 60, 42], ['Long Doors', 47, 42, 49, 44],
    ['Outside Long', 38, 44, 51, 58], ['T Spawn', 18, 52, 40, 62],
  ],
});

// ============================== MIRAGE ==============================
// T spawn east (+x), CT spawn west, A site south-west, B site north-west.
const MIRAGE = gridDef({
  id: 'mirage', name: 'Mirage', size: [128, 128], cs2: true,
  theme: { sky: '#92c2e6', haze: '#ecd5ae', sun: '#ffeacb', wall: '#dcb588', wall2: '#cf9d6b', plaster: '#e3c9a0', floor: '#d1b48e', trim: '#a87a4c', shutter: '#2f8a7a' },
  areas: [
    [52, 22, 62, 36, 1.5, 1],   // T spawn
    [56, 36, 62, 44, 1.5, 1],   // T street
    [56, 44, 62, 48, 1.5, 1],   // Palace entrance
    [44, 27, 52, 32, 0, 2],     // Top mid
    [20, 27, 44, 32, 0, 2],     // Mid
    [14, 26, 20, 31, 2.0, 5],   // Window (sniper nest)
    [10, 28, 14, 32, 0.5, 7],   // Window stairs
    [30, 32, 33, 40, 0, 2],     // Connector
    [24, 40, 33, 44, 1.0, 2],   // Jungle
    [12, 38, 20, 42, 0.5, 7],   // Stairs hall
    [20, 38, 24, 42, 0.5, 7],   // Stairs
    [14, 44, 36, 60, 0.5, 7],   // A site
    [42, 40, 56, 44, 0.5, 1],   // T ramp
    [36, 44, 44, 50, 0.5, 1],   // Tetris / A ramp
    [56, 48, 62, 52, 1.5, 5],   // Palace stairs
    [52, 52, 62, 60, 2.5, 5],   // Palace
    [36, 56, 52, 60, 2.5, 5],   // Palace balcony
    [2, 24, 12, 46, 0.5, 7],    // CT spawn
    [12, 44, 14, 52, 0.5, 7],   // CT -> A (ticket booth)
    [23, 18, 28, 27, 1.0, 2],   // Short
    [14, 15, 28, 18, 1.0, 2],   // Short -> B (catwalk)
    [2, 2, 18, 15, 0.5, 1],     // B site
    [5, 15, 9, 24, 0.5, 7],     // Market
    [54, 10, 60, 24, 2.5, 3],   // T apartments
    [30, 10, 54, 14, 2.5, 3],   // Apartments hall
    [24, 10, 30, 14, 0.5, 3],   // Apartments stairs
    [18, 6, 24, 14, 0.5, 3],    // B apartments
    [34, 14, 38, 27, 0, 3],     // Underpass
  ],
  ramps: [
    [44, 27, 52, 32, 0, 1.5, 'x', 2],     // Top mid
    [10, 28, 14, 32, 0.5, 2.0, 'x', 7],   // Window stairs
    [30, 32, 33, 40, 0, 1.0, 'z', 2],     // Connector
    [20, 38, 24, 42, 0.5, 1.0, 'x', 7],   // Jungle stairs
    [42, 40, 56, 44, 0.5, 1.5, 'x', 1],   // T ramp
    [56, 48, 62, 52, 1.5, 2.5, 'z', 5],   // Palace stairs
    [23, 24, 28, 27, 1.0, 0, 'z', 2],     // Short stairs
    [54, 18, 60, 24, 2.5, 1.5, 'z', 3],   // T apps stairs
    [24, 10, 30, 14, 0.5, 2.5, 'x', 3],   // B apps stairs
    [34, 14, 38, 20, 2.5, -1.0, 'z', 3],  // Underpass down
    [34, 20, 38, 23, -1.0, -1.0, 'z', 3], // Underpass floor
    [34, 23, 38, 27, -1.0, 0, 'z', 3],    // Underpass up
  ],
  roofs: [
    [54, 10, 60, 24, 5.6], [30, 10, 54, 14, 5.4], [18, 6, 30, 14, 5.0], [34, 14, 38, 18, 5.0], [34, 18, 38, 26, 2.4],
    [52, 52, 62, 60, 5.4], [44, 56, 52, 60, 5.2], [56, 48, 62, 52, 5.0], [30, 33, 33, 40, 3.9], [27, 40, 33, 43, 4.3], [14, 26, 20, 31, 5.0],
  ],
  crates: [
    [26, 50, 1, 1, 1.1], [20, 54, 1, 1, 1.1], [21, 54, 1, 1, 2.2], [37, 46, 1.5, 1, 1.3], [24, 56, 1, 1, 1.1], [14, 45, 1, 1.5, 2.6, 'cont'], [31, 57, 0.5, 0.5, 1.1, 'barrel'],
    [38, 28, 1, 1, 1.1], [22, 30, 1, 1, 1.1], [42, 31, 0.5, 0.5, 1.1, 'barrel'],
    [8, 6, 2, 1, 1.6, 'cont'], [12, 10, 1, 1, 1.1], [6, 11, 1, 1, 1.1], [7, 11, 1, 1, 2.2], [16, 3, 0.5, 0.5, 1.1, 'barrel'],
    [56, 30, 1, 1, 1.1], [58, 34, 1, 1, 2.2], [6, 34, 1, 1, 1.1], [3, 42, 0.5, 0.5, 1.1, 'barrel'],
  ],
  doors: [[23.95, 6, 24, 7.6, 3.0], [12, 37.95, 13.6, 38, 3.0], [52, 23.95, 53.6, 24, 3.0]],
  lamps: [[44, 12, 4.9], [36, 21, 1.9], [57, 56, 4.9], [31.5, 36, 3.4], [21, 10, 4.4]],
  props: [['palm', 61.4, 43.4, 1.1], ['palm', 61.4, 22.6, 1], ['palm', 2.6, 24.6, 1], ['palm', 35.4, 59.4, 1.05], ['awning', 30, 32, 0, 3], ['awning', 13, 38, 1, 2.4], ['awning', 6, 15, 0, 2.6], ['wires', 32, 29.5], ['wires', 46, 40], ['wires', 8, 35]],
  spawns: {
    T: [[56, 25], [56, 27.5], [56, 30], [56, 32.5], [56, 35], [59, 25], [59, 27.5], [59, 30], [59, 32.5], [59, 35]],
    CT: [[4, 30], [4, 33], [4, 36], [4, 39], [4, 42], [8, 33], [8, 36], [8, 39], [8, 42], [7, 30]],
  },
  yaw: { T: Math.PI / 2, CT: -Math.PI / 2 },
  sites: { A: [14, 44, 36, 60], B: [2, 2, 18, 15] },
  buy: { T: [52, 22, 62, 36], CT: [2, 24, 12, 46] },
  routes: {
    A: [[[59, 40], [59, 50], [56, 56], [44, 58], [30, 52]], [[59, 40], [50, 42], [40, 47], [30, 50]], [[46, 30], [31, 30], [31, 38], [26, 46]]],
    B: [[[57, 22], [42, 12], [26, 12], [12, 8]], [[46, 30], [26, 26], [22, 16], [10, 9]], [[46, 30], [36, 25], [36, 16], [26, 12], [12, 8]]],
  },
  holds: {
    A: [[18, 50, 38, 50], [24, 58, 44, 58], [16, 47, 34, 48], [28, 48, 31, 40]],
    B: [[8, 9, 24, 12], [12, 4, 24, 12], [6, 13, 20, 16], [14, 12, 24, 16]],
    MID: [[16, 28, 40, 30], [11, 34, 22, 30]],
  },
  callouts: [
    ['Palace', 52, 48, 62, 60], ['Balcony', 36, 56, 52, 60], ['T Ramp', 42, 40, 56, 44], ['Tetris', 36, 44, 44, 50], ['T Street', 56, 36, 62, 48], ['Jungle', 24, 40, 33, 44],
    ['Connector', 30, 32, 33, 40], ['Stairs', 12, 38, 24, 42], ['Ticket Booth', 12, 44, 16, 50], ['A Site', 14, 44, 36, 60], ['Window', 10, 26, 20, 32],
    ['Top Mid', 44, 27, 52, 32], ['Mid', 20, 27, 44, 32], ['Underpass', 34, 14, 38, 27], ['Short', 14, 15, 28, 27], ['B Apartments', 18, 6, 30, 14],
    ['Apartments', 30, 10, 54, 14], ['T Apartments', 54, 10, 60, 24], ['Market', 5, 15, 9, 24], ['B Site', 2, 2, 18, 15], ['CT Spawn', 2, 24, 12, 46], ['T Spawn', 52, 22, 62, 36],
  ],
});

// ============================== INFERNO ==============================
// T spawn south-west, CT spawn north-east, B site north (via Banana), A site east.
const INFERNO = gridDef({
  id: 'inferno', name: 'Inferno', size: [128, 128], cs2: true,
  theme: { sky: '#9cc8ec', haze: '#ead6b8', sun: '#fff1da', wall: '#dcbf98', wall2: '#c78a5f', plaster: '#e2c7a2', floor: '#b9a487', trim: '#7d5434', shutter: '#3f6b3a', roof: '#b4553a' },
  areas: [
    [2, 46, 14, 62, 0, 1],      // T spawn
    [10, 40, 20, 46, 0, 7],     // Lower banana
    [14, 16, 20, 40, 0, 7],     // Banana
    [8, 2, 30, 16, 1.0, 7],     // B site
    [30, 4, 44, 10, 1.0, 7],    // CT -> B
    [44, 2, 62, 14, 1.0, 1],    // CT spawn
    [14, 48, 30, 54, 0, 2],     // Second mid
    [30, 30, 36, 54, 0, 2],     // Mid
    [30, 22, 36, 30, 0, 2],     // Top mid
    [30, 18, 46, 22, 1.0, 1],   // Arch
    [38, 14, 46, 18, 1.0, 1],   // Arch -> CT
    [52, 14, 58, 22, 1.0, 1],   // Library / CT -> A
    [44, 22, 60, 36, 0.5, 7],   // A site
    [36, 34, 44, 38, 0.5, 2],   // Short
    [58, 36, 62, 44, -0.5, 6],  // Pit
    [14, 56, 44, 60, 2.0, 3],   // Apartments
    [44, 40, 50, 60, 2.0, 3],   // Boiler
    [46, 36, 50, 40, 0.5, 2],   // Balcony stairs
  ],
  ramps: [
    [14, 16, 20, 24, 1.0, 0, 'z', 7],     // Banana -> B
    [30, 22, 36, 30, 1.0, 0, 'z', 2],     // Top mid -> arch
    [14, 56, 20, 60, 0, 2.0, 'x', 3],     // Apartments stairs
    [46, 36, 50, 40, 0.5, 2.0, 'z', 2],   // Boiler stairs
    [58, 36, 62, 39, 0.5, -0.5, 'z', 6],  // Pit slope
  ],
  roofs: [[20, 56, 44, 60, 5.1], [44, 40, 50, 60, 5.1], [38, 18, 46, 22, 4.6], [30, 4, 34, 10, 4.4], [52, 14, 58, 18, 4.6]],
  crates: [
    [18, 8, 1, 1, 1.1], [19, 8, 1, 1, 2.2], [24, 10, 2, 1, 1.4, 'cont'], [12, 4, 1, 1, 1.1], [27, 4, 1, 1, 1.1], [10, 13, 0.5, 0.5, 1.1, 'barrel'],
    [16, 30, 1, 2, 1.3, 'cont'], [18.5, 36, 0.5, 0.5, 1.1, 'barrel'],
    [50, 28, 1, 1, 1.1], [51, 28, 1, 1, 2.2], [56, 25, 1, 1, 1.1], [46, 24, 0.5, 0.5, 1.1, 'barrel'],
    [34, 44, 1, 1, 1.1], [34, 26, 0.5, 0.5, 1.1, 'barrel'], [48, 6, 1, 1, 1.1], [6, 50, 1, 1, 1.1],
  ],
  doors: [[30, 3.95, 31.6, 4, 3.0], [44, 39.95, 45.6, 40, 3.0], [52, 13.95, 53.6, 14, 3.0]],
  lamps: [[30, 58, 4.8], [47, 50, 4.8], [42, 20, 4.3]],
  props: [['pot', 21, 48.4], ['pot', 29, 53.6], ['pot', 44.4, 22.6], ['pot', 8.6, 15.4], ['palm', 2.6, 61.4, 0.9], ['awning', 31, 30, 0, 3], ['awning', 20, 40, 1, 2.4], ['wires', 17, 28], ['wires', 33, 42], ['wires', 52, 30]],
  spawns: {
    T: [[5, 52], [8, 52], [11, 52], [5, 55], [8, 55], [11, 55], [5, 58], [8, 58], [11, 58], [8, 60]],
    CT: [[48, 4], [51, 4], [54, 4], [57, 4], [48, 8], [51, 8], [54, 8], [57, 8], [60, 6], [46, 6]],
  },
  yaw: { T: 0, CT: Math.PI },
  sites: { A: [44, 22, 60, 36], B: [8, 2, 30, 16] },
  buy: { T: [2, 46, 14, 62], CT: [44, 2, 62, 14] },
  routes: {
    A: [[[22, 51], [33, 40], [40, 36], [50, 30]], [[17, 58], [40, 58], [47, 50], [48, 38], [52, 30]], [[22, 51], [33, 28], [40, 20], [55, 18], [52, 26]]],
    B: [[[15, 43], [17, 30], [17, 18], [21, 6]], [[13, 44], [17, 34], [18, 20], [22, 12]]],
  },
  holds: {
    A: [[52, 26, 46, 38], [56, 30, 48, 38], [48, 24, 40, 36], [58, 24, 47, 46]],
    B: [[18, 6, 17, 20], [24, 7, 17, 20], [11, 6, 17, 20], [28, 13, 17, 24]],
    MID: [[34, 24, 33, 46], [40, 18, 33, 30]],
  },
  callouts: [
    ['Banana', 14, 16, 20, 40], ['Lower Banana', 10, 40, 20, 46], ['B Site', 8, 2, 30, 16], ['CT', 30, 4, 44, 10], ['CT Spawn', 44, 2, 62, 14],
    ['Second Mid', 14, 48, 30, 54], ['Mid', 30, 30, 36, 54], ['Top Mid', 30, 22, 36, 30], ['Arch', 30, 14, 46, 22], ['Library', 52, 14, 58, 22],
    ['A Site', 44, 22, 60, 36], ['Short', 36, 34, 44, 38], ['Pit', 58, 36, 62, 44], ['Apartments', 14, 56, 44, 60], ['Boiler', 44, 36, 50, 60], ['T Spawn', 2, 46, 14, 62],
  ],
});

// ---- Maps ported from Counter-Strike Online Ready (grid -> heightfield, 3 m per cell) ----
const WAREHOUSE = {"id": "warehouse", "name": "Warehouse", "size": [132, 132], "scale": 3, "theme": {"sky": "#8b98a5", "haze": "#6b7078", "sun": "#f2f4ff", "wall": "#7d848c", "wall2": "#5d636b", "floor": "#8a9099", "crate": "#8a5a2b", "cont": "#b4492f"}, "areas": [[3, 3, 16, 13, 0.0, 2], [17, 3, 28, 10, 0.0, 2], [29, 3, 42, 13, 0.0, 2], [16, 5, 17, 8, 0.0, 2], [28, 5, 29, 8, 0.0, 2], [20, 10, 25, 43, 0.0, 2], [3, 13, 7, 42, 0.0, 2], [10, 13, 15, 42, 0.0, 2], [30, 13, 35, 42, 0.0, 2], [37, 13, 41, 42, 0.0, 2], [8, 16, 10, 42, 0.0, 2], [15, 16, 20, 43, 0.0, 2], [25, 16, 30, 43, 0.0, 2], [35, 16, 36, 42, 0.0, 2], [7, 24, 8, 27, 0.0, 2], [36, 24, 37, 27, 0.0, 2], [7, 37, 8, 42, 0.0, 2], [36, 37, 37, 42, 0.0, 2], [14, 42, 15, 43, 0.0, 2], [30, 42, 31, 43, 0.0, 2]], "ramps": [], "roofs": [], "crates": [[39, 12, 6, 6, 1.3, "crate"], [90, 12, 6, 6, 1.3, "crate"], [24, 18, 6, 6, 1.3, "crate"], [102, 18, 6, 6, 1.3, "crate"], [12, 30, 9, 6, 2.6, "cont"], [114, 30, 9, 6, 2.6, "cont"], [63, 54, 9, 3, 1.3, "crate"], [36, 57, 6, 12, 2.6, "cont"], [90, 57, 6, 12, 2.6, "cont"], [9, 60, 3, 6, 1.3, "crate"], [54, 60, 6, 12, 2.6, "cont"], [72, 60, 6, 12, 2.6, "cont"], [63, 75, 6, 6, 2.6, "cont"], [120, 81, 3, 6, 1.3, "crate"], [42, 84, 6, 12, 2.6, "cont"], [84, 84, 6, 12, 2.6, "cont"], [63, 90, 6, 3, 1.3, "crate"], [30, 96, 3, 6, 1.3, "crate"], [51, 96, 3, 3, 1.3, "crate"], [78, 96, 3, 3, 1.3, "crate"], [99, 96, 3, 6, 1.3, "crate"], [48, 114, 3, 3, 1.3, "crate"], [84, 114, 3, 3, 1.3, "crate"], [60, 120, 9, 3, 2.6, "cont"]], "doors": [], "lamps": [[93, 15, 4.0], [15, 15, 4.0]], "spawns": {"T": [[67, 118], [70, 121], [70, 118], [64, 118], [67, 124], [67, 115], [70, 124], [70, 115], [64, 124], [64, 115]], "CT": [[67, 16], [67, 19], [64, 16], [70, 16], [64, 19], [70, 19], [67, 13], [67, 22], [64, 13], [70, 13]]}, "yaw": {"T": 0, "CT": 3.14159}, "sites": {"A": [87, 9, 126, 39], "B": [9, 9, 48, 39]}, "routes": {"A": [[[115.5, 61.5]], [[97.5, 79.5]], [[67.5, 85.5]]], "B": [[[13.5, 61.5]], [[37.5, 79.5]], [[67.5, 85.5]]]}, "holds": {"A": [[106.5, 28.5, 67.3, 119.2], [97.5, 43.5, 67.3, 119.2], [96.75, 24.0, 67.3, 119.2], [116.25, 24.0, 67.3, 119.2]], "B": [[28.5, 28.5, 67.3, 119.2], [37.5, 43.5, 67.3, 119.2], [18.75, 24.0, 67.3, 119.2], [38.25, 24.0, 67.3, 119.2]], "MID": [[67.5, 37.5, 67.3, 119.2], [64.5, 52.5, 67.3, 119.2], [37.5, 43.5, 67.3, 119.2]]}, "buy": {"T": [42, 111, 93, 129], "CT": [51, 6, 84, 30]}, "callouts": [["A Site", 87, 9, 126, 39], ["B Site", 9, 9, 48, 39], ["T Spawn", 42, 111, 93, 129], ["CT Spawn", 51, 6, 84, 30], ["Containers", 36, 48, 108, 108], ["West Hall", 9, 39, 24, 126], ["East Hall", 108, 39, 126, 126], ["Mid", 0, 0, 132, 132]], "ported": true};
const BAZAAR = {"id": "bazaar", "name": "Bazaar", "size": [132, 132], "scale": 3, "theme": {"sky": "#e8c9a0", "haze": "#c9a06a", "sun": "#ffe6c2", "wall": "#d98f5b", "wall2": "#b4673a", "floor": "#c28a52", "crate": "#7a4a22", "cont": "#2f7f6f"}, "areas": [[3, 3, 16, 13, 0.5, 1], [17, 3, 28, 10, 0.0, 7], [29, 3, 42, 13, 0.5, 1], [16, 5, 17, 8, 0.0, 7], [28, 5, 29, 8, 0.0, 7], [20, 10, 25, 43, 0.0, 7], [5, 13, 10, 42, 0.0, 7], [35, 13, 40, 42, 0.0, 7], [12, 18, 18, 24, 0.0, 7], [26, 18, 32, 24, 0.0, 7], [14, 24, 16, 35, 0.0, 7], [28, 24, 30, 35, 0.0, 7], [10, 26, 14, 29, 0.0, 7], [16, 26, 20, 29, 0.0, 7], [25, 26, 28, 29, 0.0, 7], [30, 26, 35, 29, 0.0, 7], [12, 30, 14, 35, 0.0, 7], [16, 30, 18, 35, 0.0, 7], [26, 30, 28, 35, 0.0, 7], [30, 30, 32, 35, 0.0, 7], [10, 37, 20, 42, 0.0, 7], [25, 37, 35, 42, 0.0, 7], [14, 42, 20, 43, 0.0, 7], [25, 42, 31, 43, 0.0, 7]], "ramps": [], "roofs": [], "crates": [[117, 12, 9, 6, 2.6, "cont"], [24, 18, 9, 9, 1.3, "crate"], [99, 18, 9, 9, 1.3, "crate"], [12, 30, 6, 6, 2.6, "cont"], [66, 45, 3, 6, 1.3, "crate"], [87, 57, 3, 6, 1.3, "crate"], [21, 60, 3, 6, 1.3, "crate"], [111, 60, 3, 6, 1.3, "crate"], [21, 93, 3, 6, 1.3, "crate"], [39, 93, 3, 6, 1.3, "crate"], [66, 96, 3, 6, 1.3, "crate"], [72, 114, 9, 3, 1.3, "crate"], [54, 117, 6, 6, 2.6, "cont"]], "doors": [], "lamps": [[93, 15, 4.0], [15, 15, 4.0]], "spawns": {"T": [[67, 121], [67, 118], [70, 121], [70, 118], [64, 121], [64, 118], [67, 124], [67, 115], [70, 124], [64, 124]], "CT": [[67, 16], [67, 19], [64, 16], [70, 16], [64, 19], [70, 19], [67, 13], [67, 22], [64, 13], [70, 13]]}, "yaw": {"T": 0, "CT": 3.14159}, "sites": {"A": [87, 9, 126, 39], "B": [9, 9, 48, 39]}, "routes": {"A": [[[109.5, 58.5]], [[67.5, 43.5]], [[67.5, 82.5]]], "B": [[[19.5, 58.5]], [[67.5, 43.5]], [[67.5, 82.5]]]}, "holds": {"A": [[106.5, 28.5, 67.0, 120.4], [96.75, 24.0, 67.0, 120.4], [116.25, 24.0, 67.0, 120.4]], "B": [[28.5, 28.5, 67.0, 120.4], [18.75, 24.0, 67.0, 120.4], [38.25, 24.0, 67.0, 120.4]], "MID": [[67.5, 43.5, 67.0, 120.4], [67.5, 73.5, 67.0, 120.4], [22.5, 82.5, 67.0, 120.4]]}, "buy": {"T": [15, 111, 120, 129], "CT": [51, 6, 84, 30]}, "callouts": [["A Site", 87, 9, 126, 39], ["B Site", 9, 9, 48, 39], ["T Spawn", 15, 111, 120, 129], ["CT Spawn", 51, 6, 84, 30], ["West Shops", 30, 54, 60, 105], ["East Shops", 75, 54, 105, 105], ["Market Street", 15, 78, 120, 87], ["West Alley", 15, 39, 30, 126], ["East Alley", 105, 39, 120, 126], ["Mid", 0, 0, 132, 132]], "ported": true};
const ARENA = {"id": "arena", "name": "Arena", "size": [132, 132], "scale": 3, "theme": {"sky": "#a9c4d8", "haze": "#b7bcc2", "sun": "#fff6e8", "wall": "#c7ccd2", "wall2": "#9aa1a8", "floor": "#aab0b6", "crate": "#d1a23a", "cont": "#3a6ea5"}, "areas": [[14, 3, 30, 10, 0.0, 2], [16, 10, 28, 20, 0.0, 2], [8, 12, 16, 16, 0.0, 2], [28, 12, 36, 16, 0.0, 2], [8, 16, 11, 34, 0.0, 2], [13, 16, 16, 34, 0.0, 2], [28, 16, 31, 34, 0.0, 2], [33, 16, 36, 34, 0.0, 2], [11, 18, 13, 28, 0.0, 2], [31, 18, 33, 28, 0.0, 2], [19, 20, 25, 26, 1.5, 5], [16, 21, 17, 26, 0.0, 2], [17, 21, 18, 25, 0.5, 5], [18, 21, 19, 25, 1.0, 5], [25, 21, 26, 25, 1.0, 5], [26, 21, 27, 25, 0.5, 5], [27, 21, 28, 26, 0.0, 2], [17, 25, 19, 26, 0.0, 2], [25, 25, 27, 26, 0.0, 2], [19, 26, 25, 42, 0.0, 2], [16, 27, 19, 42, 0.0, 2], [25, 27, 28, 42, 0.0, 2], [11, 30, 13, 34, 0.0, 2], [31, 30, 33, 34, 0.0, 2], [14, 35, 16, 42, 0.0, 2], [28, 35, 30, 42, 0.0, 2]], "ramps": [], "roofs": [], "crates": [[27, 36, 6, 6, 1.3, "crate"], [99, 36, 6, 6, 1.3, "crate"], [45, 42, 6, 3, 1.3, "crate"], [81, 42, 6, 3, 1.3, "crate"], [60, 45, 12, 3, 2.6, "cont"], [60, 90, 12, 3, 2.6, "cont"], [45, 93, 6, 3, 1.3, "crate"], [81, 93, 6, 3, 1.3, "crate"], [27, 96, 6, 6, 1.3, "crate"], [99, 96, 6, 6, 1.3, "crate"]], "doors": [], "lamps": [[30, 54, 4.0], [90, 54, 4.0]], "spawns": {"T": [[64, 115], [67, 115], [64, 112], [67, 112], [64, 118], [67, 118], [61, 115], [70, 115], [61, 112], [70, 112]], "CT": [[64, 19], [67, 19], [64, 16], [67, 16], [64, 22], [67, 22], [61, 19], [70, 19], [61, 16], [70, 16]]}, "yaw": {"T": 0, "CT": 3.14159}, "sites": {"A": [24, 48, 48, 81], "B": [84, 48, 108, 81]}, "routes": {"A": [[[37.5, 91.5]], [[67.5, 67.5]], [[67.5, 94.5]]], "B": [[[94.5, 91.5]], [[67.5, 67.5]], [[67.5, 94.5]]]}, "holds": {"A": [[37.5, 43.5, 65.5, 114.4], [31.5, 64.5, 65.5, 114.4], [30.0, 64.5, 65.5, 114.4], [42.0, 64.5, 65.5, 114.4]], "B": [[94.5, 43.5, 65.5, 114.4], [100.5, 64.5, 65.5, 114.4], [90.0, 64.5, 65.5, 114.4], [102.0, 64.5, 65.5, 114.4]], "MID": [[37.5, 43.5, 65.5, 114.4], [94.5, 43.5, 65.5, 114.4], [67.5, 40.5, 65.5, 114.4]]}, "buy": {"T": [42, 105, 90, 126], "CT": [42, 9, 90, 30]}, "callouts": [["A Site", 24, 48, 48, 81], ["B Site", 84, 48, 108, 81], ["T Spawn", 42, 105, 90, 126], ["CT Spawn", 42, 9, 90, 30], ["Platform", 51, 57, 81, 81], ["Mid", 0, 0, 132, 132]], "ported": true};

export const MAP_DEFS = { dust2: DUST2, mirage: MIRAGE, inferno: INFERNO, warehouse: WAREHOUSE, bazaar: BAZAAR, arena: ARENA };
// Custom maps are persisted by the server and loaded by both the authoritative server and browsers.
let CUSTOM_MAPS = {};
try {
  if (typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node) {
    const fs = await import('node:fs/promises');
    const url = await import('node:url');
    const file = url.fileURLToPath(new URL('../custom-maps.json', import.meta.url));
    try { CUSTOM_MAPS = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
  } else if (typeof window !== 'undefined') {
    const response = await fetch('/api/maps/custom');
    if (response.ok) CUSTOM_MAPS = await response.json();
  }
} catch (err) { console.warn('Custom maps could not be loaded', err); }
for (const [id, def] of Object.entries(CUSTOM_MAPS || {})) {
  if (def && typeof def === 'object' && def.id === id && Array.isArray(def.areas) && def.spawns && Array.isArray(def.spawns.T) && Array.isArray(def.spawns.CT)) MAP_DEFS[id] = def;
}
export const MAP_LIST = Object.values(MAP_DEFS).map((d) => ({ id: d.id, name: d.name }));
export const mapName = (id) => (MAP_DEFS[id] ? MAP_DEFS[id].name : 'Dust II');

const cache = new Map();
export function getMap(id) {
  if (!MAP_DEFS[id]) id = 'dust2';
  if (cache.has(id)) return cache.get(id);
  const m = buildMap(MAP_DEFS[id]); cache.set(id, m); return m;
}

export function buildMap(def) {
  const S = def.scale || 1, [W, H] = def.size, N = W * H;
  const heights = new Float32Array(N).fill(WALL), floor = new Float32Array(N).fill(WALL);
  const ceil = new Float32Array(N).fill(1e9), mat = new Uint8Array(N), rampIdx = new Int16Array(N).fill(-1);
  const each = (x0, z0, x1, z1, fn) => {
    for (let z = Math.max(0, Math.floor(z0)); z < Math.min(H, Math.ceil(z1)); z++)
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) fn(z * W + x, x, z);
  };
  for (const [x0, z0, x1, z1, h, mt = 1] of def.areas) each(x0 * S, z0 * S, x1 * S, z1 * S, (i) => { heights[i] = floor[i] = h; mat[i] = mt; });
  const ramps = [];
  for (const [x0, z0, x1, z1, h0, h1, axis, mt = 1] of def.ramps) {
    const r = { x0: x0 * S, z0: z0 * S, x1: x1 * S, z1: z1 * S, h0, h1, axis }; const ri = ramps.push(r) - 1;
    each(r.x0, r.z0, r.x1, r.z1, (i) => { rampIdx[i] = ri; heights[i] = Math.max(h0, h1); floor[i] = Math.min(h0, h1); mat[i] = mt; });
  }
  for (const [x0, z0, x1, z1, c] of def.roofs || []) each(x0, z0, x1, z1, (i) => { if (heights[i] < WALL) ceil[i] = c; });
  const crates = [];
  for (const [x, z, w, d, h, kind = 'crate'] of def.crates || []) {
    const base = floor[z * W + x];
    if (base >= WALL) continue;
    crates.push({ x, z, w, d, base, h, kind });
    each(x, z, x + w, z + d, (i) => { heights[i] = base + h; mat[i] = MAT.CRATE; rampIdx[i] = -1; });
  }
  const m = { id: def.id, name: def.name, def, W, H, heights, floor, ceil, mat, ramps, rampIdx, crates, theme: def.theme };
  m.spawnPoints = {};
  for (const t of ['T', 'CT']) m.spawnPoints[t] = def.spawns[t].map(([x, z]) => ({ x: x + 0.5, z: z + 0.5, y: floor[z * W + x], yaw: def.yaw[t] }));
  return m;
}
export const inRect = (r, x, z) => x >= r[0] && x < r[2] && z >= r[1] && z < r[3];
export function calloutAt(m, x, z) { for (const c of m.def.callouts) if (x >= c[1] && x < c[3] && z >= c[2] && z < c[4]) return c[0]; return ''; }
export function siteAt(m, x, z) { for (const k in m.def.sites) if (inRect(m.def.sites[k], x, z)) return k; return null; }
