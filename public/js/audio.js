// CS2-style layered audio (WebAudio, positional).
// Every sound is built from layers (crack + body + boom + tail + mechanical) with a shared room reverb.
// REAL SAMPLES: if you have your own CS2 sound files, drop them in /audio/cs2/ and list them in
// /audio/cs2/manifest.json (see /audio/cs2/README.txt). Any sound found there replaces the synthesized one.
const SHOT = {
  // g=overall gain  cf/cg=crack freq/gain  bf/bd/bg=body freq/dur/gain  kf/kd/kg=boom freq/dur/gain  td/tg/tf=tail dur/gain/freq  mech=action clack  sup=suppressed
  ak47:  { g: 1.0,  cf: 2200, cg: 0.9,  bf: 1800, bd: 0.16, bg: 1.0,  kf: 150, kd: 0.14, kg: 1.0,  td: 0.45, tg: 0.35, tf: 1400, mech: 0.25 },
  galil: { g: 0.92, cf: 2400, cg: 0.85, bf: 2000, bd: 0.15, bg: 0.95, kf: 160, kd: 0.13, kg: 0.85, td: 0.4,  tg: 0.3,  tf: 1500, mech: 0.25 },
  sg553: { g: 1.0,  cf: 2100, cg: 0.95, bf: 1700, bd: 0.17, bg: 1.0,  kf: 140, kd: 0.15, kg: 1.0,  td: 0.5,  tg: 0.35, tf: 1400, mech: 0.25 },
  m4a4:  { g: 0.92, cf: 3000, cg: 0.9,  bf: 2600, bd: 0.12, bg: 0.9,  kf: 190, kd: 0.11, kg: 0.75, td: 0.4,  tg: 0.3,  tf: 1700, mech: 0.25 },
  famas: { g: 0.86, cf: 3200, cg: 0.8,  bf: 2800, bd: 0.1,  bg: 0.85, kf: 200, kd: 0.1,  kg: 0.7,  td: 0.35, tg: 0.28, tf: 1800, mech: 0.2 },
  aug:   { g: 0.9,  cf: 2600, cg: 0.85, bf: 2200, bd: 0.13, bg: 0.9,  kf: 170, kd: 0.12, kg: 0.85, td: 0.4,  tg: 0.3,  tf: 1600, mech: 0.25 },
  m4a1s: { g: 0.9,  cf: 1500, cg: 0.22, bf: 1500, bd: 0.12, bg: 0.8,  kf: 220, kd: 0.08, kg: 0.5,  td: 0.16, tg: 0.12, tf: 1000, mech: 0.6, sup: 1 },
  awp:   { g: 1.4,  cf: 1800, cg: 1.2,  bf: 1200, bd: 0.35, bg: 1.1,  kf: 90,  kd: 0.5,  kg: 1.3,  td: 1.6,  tg: 0.6,  tf: 900,  bolt: 1 },
  mac10: { g: 0.75, cf: 3400, cg: 0.7,  bf: 2800, bd: 0.08, bg: 0.8,  kf: 230, kd: 0.07, kg: 0.55, td: 0.2,  tg: 0.2,  tf: 1800, mech: 0.2 },
  mp9:   { g: 0.72, cf: 3600, cg: 0.7,  bf: 3000, bd: 0.08, bg: 0.8,  kf: 250, kd: 0.07, kg: 0.5,  td: 0.2,  tg: 0.2,  tf: 1900, mech: 0.2 },
  p90:   { g: 0.7,  cf: 3800, cg: 0.6,  bf: 3200, bd: 0.08, bg: 0.75, kf: 260, kd: 0.07, kg: 0.45, td: 0.18, tg: 0.18, tf: 2000, mech: 0.2 },
  deagle:{ g: 1.2,  cf: 2000, cg: 1.0,  bf: 1300, bd: 0.22, bg: 1.1,  kf: 110, kd: 0.22, kg: 1.2,  td: 0.9,  tg: 0.45, tf: 1100 },
  glock: { g: 0.72, cf: 3300, cg: 0.8,  bf: 2600, bd: 0.08, bg: 0.8,  kf: 240, kd: 0.07, kg: 0.6,  td: 0.22, tg: 0.2,  tf: 1700, mech: 0.2 },
  usp:   { g: 0.8,  cf: 1800, cg: 0.2,  bf: 1600, bd: 0.08, bg: 0.7,  kf: 300, kd: 0.06, kg: 0.45, td: 0.12, tg: 0.1,  tf: 1100, mech: 0.6, sup: 1 },
};
const RELOAD_CLASS = { awp: 'bolt', deagle: 'pistol', glock: 'pistol', usp: 'pistol', mac10: 'smg', mp9: 'smg', p90: 'smg' };
const RELOAD_SEQ = {
  rifle: [[0.18, 'out'], [0.5, 'in'], [0.78, 'bolt']],
  smg: [[0.2, 'out'], [0.55, 'in'], [0.8, 'bolt']],
  pistol: [[0.2, 'out'], [0.55, 'in'], [0.8, 'slide']],
  bolt: [[0.1, 'bolt'], [0.35, 'out'], [0.6, 'in'], [0.85, 'bolt']],
};
const DTMF_ROWS = [697, 770, 852, 941], DTMF_COLS = [1209, 1336, 1477];
const G = (v) => Math.max(0.0001, v);

export class Sound {
  constructor() { this.ctx = null; this.vol = 0.7; this.steps = []; this.listener = { x: 0, y: 0, z: 0 }; this.plantSounds = new Map(); this.samples = new Map(); }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.vol;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(c.destination);
    // shared noise source (looped so long bursts never cut off)
    const len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.noise = b;
    // synthetic room reverb
    const rl = Math.floor(c.sampleRate * 1.8), ir = c.createBuffer(2, rl, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const x = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < rl; i++) { lp += ((Math.random() * 2 - 1) - lp) * (0.6 - 0.5 * i / rl); x[i] = lp * Math.pow(1 - i / rl, 3.2) * 2.2; } }
    this.revIn = c.createGain(); const conv = c.createConvolver(); conv.buffer = ir; const wet = c.createGain(); wet.gain.value = 0.55;
    this.revIn.connect(conv); conv.connect(wet); wet.connect(this.master);
    // Use the movement/footstep samples bundled with the supplied CS2_WAV pack.
    // Keep the previous local footsteps as a fallback if a CS2 sample cannot load.
    const loadStep = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`Missing step sample: ${url}`); return r.arrayBuffer(); }).then((a) => this.ctx.decodeAudioData(a));
    Promise.all([1, 2, 3].map((i) => loadStep(`/audio/cs2/source/weapons/movement${i}.wav`)))
      .then((buffers) => { this.steps = buffers; })
      .catch(() => Promise.all([1, 2, 3, 4, 5, 6].map((i) => loadStep(`/audio/footstep_${i}.wav`).catch(() => null)))
        .then((buffers) => { this.steps = buffers.filter(Boolean); }));
    this.loadSamples();
  }
  // optional real CS2 sample override: /audio/cs2/manifest.json  ->  { "ak47": "ak47.wav", "c4_beep": ["beep1.wav","beep2.wav"] }
  loadSamples() {
    fetch('/audio/cs2/manifest.json').then((r) => (r.ok ? r.json() : {})).then((m) => {
      for (const [name, files] of Object.entries(m || {})) {
        for (const f of [].concat(files)) {
          fetch(`/audio/cs2/${f}`).then((r) => { if (!r.ok) throw 0; return r.arrayBuffer(); }).then((a) => this.ctx.decodeAudioData(a))
            .then((buf) => { if (!this.samples.has(name)) this.samples.set(name, []); this.samples.get(name).push(buf); }).catch(() => {});
        }
      }
    }).catch(() => {});
  }
  playSample(name, pos = null, gain = 1, wet = 0.3, rate = 1) {
    const list = this.samples.get(name); if (!list || !list.length) return false;
    const s = this.ctx.createBufferSource(); s.buffer = list[Math.floor(Math.random() * list.length)]; s.playbackRate.value = rate * (0.985 + Math.random() * 0.03);
    const g = this.out(pos, gain, wet); s.connect(g); s.start(); return { o: s, gain: g };   // handle so long sounds can be cancelled
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  setListener(pos, f, up = [0, 1, 0]) {
    if (!this.ctx) return; const L = this.ctx.listener; this.listener = { x: pos.x, y: pos.y, z: pos.z };
    if (L.positionX) { L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z; L.forwardX.value = f[0]; L.forwardY.value = f[1]; L.forwardZ.value = f[2]; L.upX.value = up[0]; L.upY.value = up[1]; L.upZ.value = up[2]; }
    else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(f[0], f[1], f[2], up[0], up[1], up[2]); }
  }
  out(pos, gain = 1, wet = 0) { // input node routed (optionally spatially) to master, with optional reverb send
    const c = this.ctx, g = c.createGain(); g.gain.value = gain;
    let d = 0;
    if (pos) {
      d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
      const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 1.1; p.maxDistance = 400;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(700, 16000 / (1 + d / 18));
      g.connect(lp); lp.connect(p); p.connect(this.master);
    } else g.connect(this.master);
    if (wet > 0 && this.revIn) { const w = c.createGain(); w.gain.value = wet * Math.pow(4 / (4 + d), 1.1); g.connect(w); w.connect(this.revIn); }
    return g;
  }
  noiseBurst(dest, t, dur, freq, q = 0.8, type = 'lowpass', gain = 1, rate = 1, atk = 0.004, endMul = 0.25) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; s.loop = true; s.playbackRate.value = rate;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(120, freq * endMul), t + dur); f.Q.value = q;
    const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(G(gain), t + atk); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(e); e.connect(dest); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return { o: s, gain: e };
  }
  tone(dest, t, freq, dur, type = 'sine', gain = 0.5, endFreq) {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(G(gain), t + 0.005); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(e); e.connect(dest); o.start(t); o.stop(t + dur + 0.05);
    return { o, gain: e };
  }
  // ---- small mechanical building blocks ----
  clack(dest, t, gain = 0.5, f = 3000) { this.noiseBurst(dest, t, 0.03, f, 2.5, 'bandpass', gain, 1, 0.001, 0.6); this.tone(dest, t, f * 0.8, 0.04, 'triangle', gain * 0.35, f * 0.45); }
  mech(dest, t, kind) {
    if (kind === 'out') { this.noiseBurst(dest, t, 0.05, 1400, 1.5, 'bandpass', 0.7, 1, 0.002, 0.5); this.tone(dest, t, 180, 0.08, 'sine', 0.5, 90); this.clack(dest, t + 0.03, 0.35, 2400); }
    else if (kind === 'in') { this.tone(dest, t, 220, 0.09, 'sine', 0.6, 110); this.noiseBurst(dest, t, 0.04, 1800, 1, 'bandpass', 0.6, 1, 0.002, 0.5); this.clack(dest, t + 0.012, 0.5, 3000); }
    else if (kind === 'bolt') { this.noiseBurst(dest, t, 0.09, 1800, 1.2, 'bandpass', 0.4, 0.8, 0.01, 0.7); this.clack(dest, t + 0.09, 0.6, 2200); this.clack(dest, t + 0.16, 0.5, 3200); }
    else { this.noiseBurst(dest, t, 0.07, 2000, 1.2, 'bandpass', 0.4, 0.8, 0.01, 0.7); this.clack(dest, t + 0.07, 0.6, 2600); }
  }
  // ---- weapons ----
  shot(k, pos) {
    if (!this.ctx) return; if (this.playSample(k, pos, 1, 0.16)) return;
    const t = this.ctx.currentTime;
    if (k === 'knife') { const o = this.out(pos, 0.5); this.noiseBurst(o, t, 0.16, 4200, 2, 'bandpass', 0.6, 1.3); return; }
    const s = SHOT[k]; if (!s) return;
    const j = 0.94 + Math.random() * 0.12, o = this.out(pos, s.g, s.sup ? 0.12 : 0.5);
    this.noiseBurst(o, t, 0.025, s.cf * j, 0.7, 'highpass', s.cg, 1.4, 0.001, 1);                       // crack
    this.noiseBurst(o, t, s.bd, s.bf * j, 0.8, 'lowpass', s.bg, 1, 0.002, 0.15);                         // body
    this.tone(o, t, s.kf * 1.8 * j, s.kd, 'sine', s.kg, s.kf * 0.45);                                    // boom
    this.tone(o, t, s.kf * 3 * j, s.kd * 0.6, 'triangle', s.kg * 0.3, s.kf);
    this.noiseBurst(o, t + 0.02, s.td, s.tf, 0.4, 'lowpass', s.tg, 0.8, 0.01, 0.2);                      // tail
    if (s.mech) this.clack(o, t + 0.045, s.mech, 3200);                                                  // action
    if (s.bolt) { const b = this.out(pos, 0.5); this.mech(b, t + 0.6, 'bolt'); this.clack(b, t + 0.9, 0.5, 2800); }
  }
  reload(k, dur, pos = null) {
    if (!this.ctx) return; if (this.playSample(`reload_${k}`, pos, pos ? 0.9 : 1.3, 0.05) || this.playSample('reload', pos, pos ? 0.9 : 1.3, 0.05)) return;
    const seq = RELOAD_SEQ[RELOAD_CLASS[k] || 'rifle'], t = this.ctx.currentTime, o = this.out(pos, pos ? 0.9 : 1.4, 0.05);
    for (const [f, kind] of seq) this.mech(o, t + dur * f, kind);
  }
  draw() { if (!this.ctx) return; if (this.playSample('draw', null, 0.8, 0)) return; this.click(0.2, 1200); }
  dry() { if (!this.ctx) return; if (this.playSample('dry')) return; this.clack(this.out(null, 1.2), this.ctx.currentTime, 0.5, 3500); }
  click(gain = 0.3, f = 2400, pos = null, delay = 0) { if (!this.ctx) return; const t = this.ctx.currentTime + delay; this.noiseBurst(this.out(pos, gain), t, 0.04, f, 3, 'bandpass', 0.9); }
  hit(head) {
    if (!this.ctx) return; if (this.playSample(head ? 'hit_head' : 'hit_body')) return;
    const t = this.ctx.currentTime, o = this.out(null, head ? 0.8 : 0.6);
    if (head) { this.tone(o, t, 2600, 0.35, 'sine', 0.5); this.tone(o, t, 3900, 0.25, 'sine', 0.25); this.clack(o, t, 0.5, 4500); }
    else { this.tone(o, t, 1300, 0.05, 'square', 0.2); this.tone(o, t, 260, 0.09, 'sine', 0.6, 120); }
  }
  hurt() { if (!this.ctx) return; if (this.playSample('hurt')) return; const t = this.ctx.currentTime; this.tone(this.out(null, 0.5), t, 160, 0.18, 'sine', 0.8, 60); this.noiseBurst(this.out(null, 0.3), t, 0.12, 900, 1, 'lowpass', 0.8); }
  // ---- grenades ----
  nadeThrow(pos = null) {
    if (!this.ctx) return; if (this.playSample('nade_throw', pos, 0.9, 0.1)) return;
    const t = this.ctx.currentTime, o = this.out(pos, 1.2, 0.1); this.clack(o, t, 0.5, 2200); this.tone(o, t + 0.12, 3000, 0.09, 'triangle', 0.25, 1900); this.noiseBurst(o, t + 0.12, 0.08, 4000, 1.5, 'bandpass', 0.2);
  }
  heBlast(pos) {
    if (!this.ctx) return; if (this.playSample('he', pos, 1.1, 0.25)) return;
    const t = this.ctx.currentTime, o = this.out(pos, 1.25, 0.7);
    this.noiseBurst(o, t, 0.08, 5500, 0.6, 'highpass', 0.9, 1.3, 0.001, 0.4);
    this.noiseBurst(o, t, 0.6, 1800, 0.5, 'lowpass', 1.0, 1, 0.003, 0.1);
    this.tone(o, t, 95, 0.9, 'sine', 0.9, 32); this.noiseBurst(o, t + 0.08, 1.2, 500, 0.3, 'lowpass', 0.5, 0.7, 0.03, 0.3);
    for (let i = 0; i < 8; i++) this.noiseBurst(o, t + 0.2 + Math.random() * 0.8, 0.03, 1500 + Math.random() * 3000, 2, 'bandpass', 0.12, 1);
  }
  flashBang(pos) {
    if (!this.ctx) return; if (this.playSample('flash', pos, 0.9, 0.2)) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.95, 0.6);
    this.noiseBurst(o, t, 0.06, 7000, 0.6, 'highpass', 0.9, 1.4, 0.001, 0.5); this.noiseBurst(o, t, 0.28, 4500, 1.2, 'highpass', 0.7, 1, 0.002, 0.4); this.tone(o, t, 3400, 0.4, 'sine', 0.12);
  }
  smokePop(pos) {
    if (!this.ctx) return; if (this.playSample('smoke', pos, 0.8, 0.2)) return;
    const t = this.ctx.currentTime, o = this.out(pos, 0.5, 0.3);
    this.tone(o, t, 140, 0.25, 'sine', 0.6, 60); this.noiseBurst(o, t, 0.25, 850, 0.7, 'lowpass', 0.45); this.noiseBurst(o, t + 0.05, 0.9, 3000, 0.5, 'bandpass', 0.14, 1, 0.08, 0.6);
  }
  ring(amount = 1) { if (!this.ctx) return; const h = this.playSample('ring', null, 0.9 * Math.min(1, amount), 0); if (h) { const t0 = this.ctx.currentTime, g = h.gain.gain; g.setValueAtTime(0.9 * Math.min(1, amount), t0); g.setValueAtTime(0.9 * Math.min(1, amount), t0 + 0.2 + amount * 1.2); g.linearRampToValueAtTime(0.0001, t0 + 0.8 + amount * 2.6); return; } const t = this.ctx.currentTime; this.tone(this.out(null, 0.35), t, 1100, 0.35 + amount * 0.7, 'sine', 0.2, 300); }
  step(pos, gain = 0.5) {
    if (!this.ctx || !this.steps.length) return; const s = this.ctx.createBufferSource(); s.buffer = this.steps[Math.floor(Math.random() * this.steps.length)];
    s.playbackRate.value = 0.93 + Math.random() * 0.14; s.connect(this.out(pos, gain, pos ? 0.06 : 0)); s.start();
  }
  // ---- bomb ----
  beep(pos, hi = false) { // C4 countdown beep
    if (!this.ctx) return; if (this.playSample(hi ? 'c4_beep_fast' : 'c4_beep', pos, 1.3, 0.12)) return;
    const t = this.ctx.currentTime, o = this.out(pos, 1.5, 0.2), f = hi ? 2900 : 2300;
    this.tone(o, t, f, 0.11, 'sine', 0.55); this.tone(o, t, f * 2, 0.05, 'square', 0.07); this.noiseBurst(o, t, 0.012, 6000, 1, 'highpass', 0.2, 1, 0.001, 1);
  }
  keypad(pos, owner = 'local') { // planting: keypad tones (DTMF style)
    if (!this.ctx) return;
    this.cancelKeypad(owner);
    const nodes = new Set(); this.plantSounds.set(owner, nodes);
    const hp = this.playSample('c4_plant', pos, 1.0, 0.1); if (hp) { nodes.add(hp); setTimeout(() => { if (this.plantSounds.get(owner) === nodes) this.plantSounds.delete(owner); }, 3600); return; }
    const t = this.ctx.currentTime;
    for (let i = 0; i < 7; i++) {
      const o = this.out(pos, 0.8, 0.15), tt = t + i * 0.36, r = DTMF_ROWS[Math.floor(Math.random() * 4)], c = DTMF_COLS[Math.floor(Math.random() * 3)];
      nodes.add(this.tone(o, tt, r, 0.09, 'sine', 0.35)); nodes.add(this.tone(o, tt, c, 0.09, 'sine', 0.35)); nodes.add(this.noiseBurst(o, tt, 0.012, 3500, 1, 'bandpass', 0.15, 1, 0.001, 1));
    }
    setTimeout(() => { if (this.plantSounds.get(owner) === nodes) this.plantSounds.delete(owner); }, 7 * 360 + 600);
  }
  cancelKeypad(owner = 'local') {
    if (!this.ctx) return;
    const nodes = this.plantSounds.get(owner); if (!nodes) return;
    const t = this.ctx.currentTime;
    for (const node of nodes) { try { node.gain.gain.cancelScheduledValues(t); node.gain.gain.setTargetAtTime(0.0001, t, 0.012); node.o.stop(t + 0.08); } catch (_) {} }
    this.plantSounds.delete(owner);
  }
  cancelAll() { for (const k of [...this.plantSounds.keys()]) this.cancelKeypad(k); }
  planted(pos) { // bomb planted confirmation
    if (!this.ctx) return; if (this.playSample('c4_planted', pos, 1.1, 0.2)) return;
    const t = this.ctx.currentTime, o = this.out(pos, 1.3, 0.3);
    for (let i = 0; i < 3; i++) { this.tone(o, t + i * 0.15, 1900 + i * 250, 0.1, 'sine', 0.5); this.tone(o, t + i * 0.15, 3800 + i * 500, 0.05, 'square', 0.06); }
    this.tone(o, t + 0.5, 140, 0.18, 'sine', 0.7, 70); this.clack(o, t + 0.5, 0.4, 2000);
  }
  defuse(pos, owner = 'local') { // defusing: ratcheting ticks that speed up
    if (!this.ctx) return;
    this.cancelKeypad(owner);
    const nodes = new Set(); this.plantSounds.set(owner, nodes);
    const hd = this.playSample('c4_defuse', pos, 1.0, 0.1); if (hd) { nodes.add(hd); setTimeout(() => { if (this.plantSounds.get(owner) === nodes) this.plantSounds.delete(owner); }, 10300); return; }
    const t = this.ctx.currentTime; let tt = t;
    for (let i = 0; i < 22; i++) {
      const o = this.out(pos, 0.9, 0.1);
      nodes.add(this.noiseBurst(o, tt, 0.04, 2500, 4, 'bandpass', 0.8)); nodes.add(this.tone(o, tt, 620 + (i % 2) * 90, 0.05, 'triangle', 0.18));
      tt += Math.max(0.16, 0.5 - i * 0.025);
    }
    setTimeout(() => { if (this.plantSounds.get(owner) === nodes) this.plantSounds.delete(owner); }, 8000);
  }
  defused(pos) { // successful defuse
    if (!this.ctx) return; this.cancelAll(); if (this.playSample('c4_defused', pos, 1.1, 0.2)) return;
    const t = this.ctx.currentTime, o = this.out(pos, 1.2, 0.3);
    this.clack(o, t, 0.6, 2600); this.tone(o, t + 0.08, 1320, 0.25, 'sine', 0.4); this.tone(o, t + 0.2, 1760, 0.4, 'sine', 0.4); this.tone(o, t + 0.2, 880, 0.4, 'triangle', 0.2);
  }
  explosion(pos) { // C4 detonation
    if (!this.ctx) return; if (this.playSample('c4_explode', pos, 1.2, 0.25)) return;
    const t = this.ctx.currentTime, o = this.out(pos, 1.6, 0.9);
    this.noiseBurst(o, t, 0.12, 6000, 0.5, 'highpass', 1.0, 1.2, 0.001, 0.3);                           // initial crack
    this.noiseBurst(o, t, 1.4, 2400, 0.4, 'lowpass', 1.0, 1, 0.003, 0.08);                              // blast
    this.tone(o, t, 110, 2.2, 'sine', 1.2, 22); this.tone(o, t, 55, 1.2, 'triangle', 0.6, 25);          // sub boom
    this.noiseBurst(o, t + 0.12, 3.8, 420, 0.3, 'lowpass', 0.7, 0.6, 0.05, 0.3);                        // rumble
    for (let i = 0; i < 26; i++) { const tt = t + 0.25 + Math.random() * 2.4; this.noiseBurst(o, tt, 0.02 + Math.random() * 0.04, 1500 + Math.random() * 3500, 2, 'bandpass', (0.15 + Math.random() * 0.25) * (1 - (tt - t) / 3), 1); } // debris
  }
  ui(f = 900) { if (!this.ctx) return; if (this.playSample('ui', null, 0.8, 0, f / 900)) return; this.tone(this.out(null, 0.2), this.ctx.currentTime, f, 0.06, 'triangle', 0.3); }
  money() { if (!this.ctx) return; if (this.playSample('money', null, 0.7, 0)) return; const t = this.ctx.currentTime; this.tone(this.out(null, 0.2), t, 1200, 0.08, 'triangle', 0.3); this.tone(this.out(null, 0.2), t + 0.07, 1800, 0.1, 'triangle', 0.3); }
  sting(win) {
    if (!this.ctx) return; const t = this.ctx.currentTime, o = this.out(null, 0.25), notes = win ? [523, 659, 784, 1046] : [392, 349, 311, 262];
    notes.forEach((n, i) => { this.tone(o, t + i * 0.14, n, 0.5, 'sawtooth', 0.12); this.tone(o, t + i * 0.14, n / 2, 0.5, 'triangle', 0.2); });
  }
}
export function radio(text, on) {
  if (!on || !window.speechSynthesis) return;
  try { const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; u.pitch = 0.8; u.volume = 0.8; const v = speechSynthesis.getVoices().find((v) => /en[-_](US|GB)/i.test(v.lang)); if (v) u.voice = v; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
}
