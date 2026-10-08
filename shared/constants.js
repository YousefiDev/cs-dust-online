// Shared simulation constants (server + browser). Units are meters and seconds.
export const TICK_RATE = 20;
export const WALL = 99;
export const WALL_TOP = 7.5;
export const PHYS = {
  radius: 0.4, height: 1.8, crouchHeight: 1.3, eye: 1.64, crouchEye: 1.18,
  step: 0.55, gravity: 20, jumpV: 6.7, accel: 9, airAccel: 9, airCap: 0.8, friction: 6,
};
export const ROUND = {
  freeze: 6, live: 115, bomb: 40, over: 6, buy: 25, maxRounds: 24, half: 12, winTo: 13,
  plant: 3.2, defuse: 10, defuseKit: 5, warmupRespawn: 3, matchOver: 12, lateSpawn: 20,
};
export const ECON = {
  start: 800, max: 16000, win: { elim: 3250, bomb: 3500, defuse: 3500, time: 3250 },
  lossBase: 1400, lossStep: 500, lossMax: 3400, plantBonus: 800, plantPersonal: 300, defusePersonal: 300, teamKillPenalty: 300,
};
export const BOT_NAMES = ['Rip','Shark','Vitaliy','Moe','Hank','Cliffe','Gunner','Pablo','Brett','Wolf','Yogi','Kurt','Ringo','Zach','Doc','Rock','Stone','Crusher','Finn','Ivan','Quinn','Koston','Navarro','Elliot'];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
export const forward = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
