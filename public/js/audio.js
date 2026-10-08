// Procedural positional audio (WebAudio). Only footsteps use sample files.
const SHOT = {
  ak47: { f: 2600, d: 0.2, g: 1.0, thump: 70, q: 0.7 }, galil: { f: 2750, d: 0.17, g: 0.88, thump: 78, q: 0.7 }, m4a4: { f: 3200, d: 0.16, g: 0.9, thump: 85, q: 0.8 }, m4a1s: { f: 3400, d: 0.13, g: 0.65, thump: 92, q: 0.9 }, famas: { f: 3000, d: 0.14, g: 0.84, thump: 88, q: 0.8 }, sg553: { f: 2450, d: 0.2, g: 1.0, thump: 68, q: 0.7 }, aug: { f: 2850, d: 0.16, g: 0.9, thump: 82, q: 0.8 }, awp: { f: 1700, d: 0.75, g: 1.35, thump: 50, q: 0.6, tail: 1 },
  mac10: { f: 3600, d: 0.09, g: 0.7, thump: 110, q: 0.9 }, mp9: { f: 3800, d: 0.09, g: 0.7, thump: 120, q: 0.9 }, p90: { f: 3500, d: 0.1, g: 0.72, thump: 115, q: 0.9 }, deagle: { f: 2200, d: 0.3, g: 1.15, thump: 60, q: 0.7 },
  glock: { f: 3000, d: 0.11, g: 0.65, thump: 120, q: 1 }, usp: { f: 1100, d: 0.07, g: 0.45, thump: 150, q: 1.2 },
};
export class Sound {
  constructor() { this.ctx = null; this.vol = 0.7; this.steps = []; this.listener = { x: 0, y: 0, z: 0 }; this.plantSounds = new Map(); }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(this.ctx.destination);
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; this.master.disconnect(); this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.noise = b;
    for (let i = 1; i <= 6; i++) fetch(`/audio/footstep_${i}.wav`).then((r) => r.arrayBuffer()).then((a) => this.ctx.decodeAudioData(a)).then((buf) => this.steps.push(buf)).catch(() => {});
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  setListener(pos, f, up = [0, 1, 0]) {
    if (!this.ctx) return; const L = this.ctx.listener; this.listener = { x: pos.x, y: pos.y, z: pos.z };
    if (L.positionX) { L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z; L.forwardX.value = f[0]; L.forwardY.value = f[1]; L.forwardZ.value = f[2]; L.upX.value = up[0]; L.upY.value = up[1]; L.upZ.value = up[2]; }
    else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(f[0], f[1], f[2], up[0], up[1], up[2]); }
  }
  out(pos, gain = 1) { // returns an input node routed (optionally spatially) to master
    const c = this.ctx, g = c.createGain(); g.gain.value = gain;
    if (pos) {
      const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
      const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 1.1; p.maxDistance = 400;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(700, 16000 / (1 + d / 18));
      g.connect(lp); lp.connect(p); p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }
  noiseBurst(dest, t, dur, freq, q = 0.8, type = 'lowpass', gain = 1, rate = 1) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rate;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.25), t + dur); f.Q.value = q;
    const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(gain, t + 0.004); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(e); e.connect(dest); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  tone(dest, t, freq, dur, type = 'sine', gain = 0.5, endFreq) {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(gain, t + 0.005); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(e); e.connect(dest); o.start(t); o.stop(t + dur + 0.05);
    return { o, gain: e };
  }
  shot(k, pos) {
    if (!this.ctx) return; const s = SHOT[k]; const t = this.ctx.currentTime;
    if (k === 'knife') { const o = this.out(pos, 0.5); this.noiseBurst(o, t, 0.16, 4200, 2, 'bandpass', 0.6, 1.3); return; }
    if (!s) return; const o = this.out(pos, s.g);
    this.noiseBurst(o, t, s.d, s.f, s.q, 'lowpass', 1.0); this.noiseBurst(o, t, 0.03, 7000, 0.5, 'highpass', 0.5);
    this.tone(o, t, s.thump * 2, Math.min(0.25, s.d), 'sine', 0.9, s.thump * 0.6);
    if (s.tail) this.noiseBurst(o, t + 0.05, 1.2, 900, 0.4, 'lowpass', 0.35);
    else this.noiseBurst(o, t + 0.03, s.d * 2.5, 1400, 0.3, 'lowpass', 0.12);
  }
  nadeThrow(pos = null) { if (!this.ctx) return; this.click(0.28, 1150, pos); this.click(0.2, 1900, pos, 0.09); }
  heBlast(pos) { if (!this.ctx) return; const t = this.ctx.currentTime, o = this.out(pos, 1.5); this.noiseBurst(o, t, 0.55, 900, 0.5, 'lowpass', 1.0); this.tone(o, t, 75, 0.7, 'sine', 0.8, 35); }
  flashBang(pos) { if (!this.ctx) return; const t = this.ctx.currentTime, o = this.out(pos, 0.9); this.noiseBurst(o, t, 0.18, 5000, 1.2, 'highpass', 0.8); }
  smokePop(pos) { if (!this.ctx) return; this.noiseBurst(this.out(pos, 0.25), this.ctx.currentTime, 0.25, 850, 0.7, 'lowpass', 0.45); }
  ring(amount = 1) { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(this.out(null, 0.35), t, 1100, 0.35 + amount * 0.7, 'sine', 0.2, 300); }
  step(pos, gain = 0.5) {
    if (!this.ctx || !this.steps.length) return; const s = this.ctx.createBufferSource(); s.buffer = this.steps[Math.floor(Math.random() * this.steps.length)];
    s.playbackRate.value = 0.9 + Math.random() * 0.2; s.connect(this.out(pos, gain)); s.start();
  }
  click(gain = 0.3, f = 2400, pos = null, delay = 0) { if (!this.ctx) return; const t = this.ctx.currentTime + delay; this.noiseBurst(this.out(pos, gain), t, 0.04, f, 3, 'bandpass', 0.9); }
  reload(k, dur) { if (!this.ctx) return; this.click(0.35, 1800, null, dur * 0.25); this.click(0.4, 1500, null, dur * 0.6); this.click(0.45, 2600, null, dur * 0.85); }
  dry() { this.click(0.25, 3500); }
  hit(head) { if (!this.ctx) return; const t = this.ctx.currentTime, o = this.out(null, head ? 0.5 : 0.25); if (head) { this.tone(o, t, 2600, 0.35, 'sine', 0.5); this.tone(o, t, 3900, 0.25, 'sine', 0.25); } else this.tone(o, t, 1300, 0.06, 'square', 0.25); }
  hurt() { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(this.out(null, 0.5), t, 160, 0.18, 'sine', 0.8, 60); this.noiseBurst(this.out(null, 0.3), t, 0.12, 900, 1, 'lowpass', 0.8); }
  beep(pos, hi = false) { if (!this.ctx) return; this.tone(this.out(pos, 0.55), this.ctx.currentTime, hi ? 3100 : 2350, 0.09, 'square', 0.35); }
  keypad(pos, owner = 'local') {
    if (!this.ctx) return;
    this.cancelKeypad(owner);
    const nodes = new Set();
    this.plantSounds.set(owner, nodes);
    const t = this.ctx.currentTime;
    for (let i = 0; i < 7; i++) {
      const node = this.tone(this.out(pos, 0.3), t + i * 0.36, 1500 + Math.random() * 900, 0.07, 'square', 0.3);
      if (node) nodes.add(node);
    }
    setTimeout(() => { if (this.plantSounds.get(owner) === nodes) this.plantSounds.delete(owner); }, 900);
  }
  cancelKeypad(owner = 'local') {
    if (!this.ctx) return;
    const nodes = this.plantSounds.get(owner);
    if (!nodes) return;
    const t = this.ctx.currentTime;
    for (const node of nodes) {
      try {
        node.gain.gain.cancelScheduledValues(t);
        node.gain.gain.setValueAtTime(0.0001, t);
        node.o.stop(t);
      } catch (_) {}
    }
    this.plantSounds.delete(owner);
  }
  defuse(pos) { if (!this.ctx) return; const t = this.ctx.currentTime; for (let i = 0; i < 10; i++) this.noiseBurst(this.out(pos, 0.25), t + i * 0.12, 0.05, 2500, 4, 'bandpass', 0.8); }
  explosion(pos) {
    if (!this.ctx) return; const t = this.ctx.currentTime, o = this.out(pos, 2.2);
    this.noiseBurst(o, t, 2.8, 1600, 0.4, 'lowpass', 1); this.tone(o, t, 90, 1.6, 'sine', 1, 28); this.noiseBurst(o, t + 0.1, 3.5, 500, 0.3, 'lowpass', 0.6);
  }
  ui(f = 900) { if (!this.ctx) return; this.tone(this.out(null, 0.2), this.ctx.currentTime, f, 0.06, 'triangle', 0.3); }
  money() { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(this.out(null, 0.2), t, 1200, 0.08, 'triangle', 0.3); this.tone(this.out(null, 0.2), t + 0.07, 1800, 0.1, 'triangle', 0.3); }
  sting(win) {
    if (!this.ctx) return; const t = this.ctx.currentTime, o = this.out(null, 0.25), notes = win ? [523, 659, 784, 1046] : [392, 349, 311, 262];
    notes.forEach((n, i) => { this.tone(o, t + i * 0.14, n, 0.5, 'sawtooth', 0.12); this.tone(o, t + i * 0.14, n / 2, 0.5, 'triangle', 0.2); });
  }
}
export function radio(text, on) {
  if (!on || !window.speechSynthesis) return;
  try { const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; u.pitch = 0.8; u.volume = 0.8; const v = speechSynthesis.getVoices().find((v) => /en[-_](US|GB)/i.test(v.lang)); if (v) u.voice = v; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
}
