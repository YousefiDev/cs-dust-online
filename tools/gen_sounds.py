#!/usr/bin/env python3
"""
Offline sound designer for CS Dust Online.

Renders layered, physically-inspired sound effects (guns, reloads, C4, grenades, footsteps, hits...)
into /public/audio/cs2/*.wav + manifest.json (and /public/audio/footstep_N.wav).
The game's audio.js automatically uses anything listed in manifest.json instead of the live synth.

Run:   python3 tools/gen_sounds.py            (needs numpy + scipy)
Tune:  edit GUNS / the functions below, re-run, refresh the game (Ctrl+F5).
"""
import os, json, wave, zlib
import numpy as np
from scipy import signal

SR = 44100
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'audio')
CS2 = os.path.join(ROOT, 'cs2')
os.makedirs(CS2, exist_ok=True)

# ------------------------------------------------------------------ DSP helpers
def rng(*key):
    return np.random.default_rng(zlib.crc32('|'.join(map(str, key)).encode()))

def _sos(kind, fc, order, sr=SR):
    return signal.butter(order, np.clip(fc, 15, sr / 2 * 0.97) / (sr / 2), btype=kind, output='sos')

def lp(x, fc, o=2): return signal.sosfilt(_sos('lowpass', fc, o), x)
def hp(x, fc, o=2): return signal.sosfilt(_sos('highpass', fc, o), x)
def bp(x, f1, f2, o=2):
    f1 = max(f1, 15); f2 = min(f2, SR / 2 * 0.97)
    return signal.sosfilt(signal.butter(o, [f1 / (SR / 2), f2 / (SR / 2)], btype='bandpass', output='sos'), x)

def nrm(x):
    m = np.max(np.abs(x)) if len(x) else 0
    return x / m if m > 1e-9 else x

def env(n, tau, atk=0.0004):
    t = np.arange(n) / SR
    return np.exp(-t / tau) * (1 - np.exp(-t / atk))

def sweep_lp(x, f0, f1, Tc, n=9, o=2):
    """time-varying low-pass: cutoff glides exponentially f0 -> f1 over Tc seconds"""
    N = len(x); t = np.arange(N) / SR
    fc = f0 * (f1 / f0) ** np.minimum(t / Tc, 1.0)
    lo, hi = min(f0, f1), max(f0, f1)
    if hi / lo < 1.05: return lp(x, lo, o)
    bank = np.geomspace(lo, hi, n)
    Y = np.stack([lp(x, f, o) for f in bank])
    pos = (np.log(fc) - np.log(lo)) / (np.log(hi) - np.log(lo)) * (n - 1)
    i = np.clip(np.floor(pos).astype(int), 0, n - 2); fr = pos - i
    k = np.arange(N)
    return Y[i, k] * (1 - fr) + Y[i + 1, k] * fr

def put(buf, x, t0, g=1.0):
    i = int(round(t0 * SR))
    if i < 0: x = x[-i:]; i = 0
    if i >= len(buf): return
    x = x[:len(buf) - i]
    buf[i:i + len(x)] += x * g

def sine_sweep(n, f0, f1, tau):
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / tau)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)

# ------------------------------------------------------------------ reverb
_IR = {}
def get_ir(rt60, bright=7000, early=()):
    key = (rt60, bright, tuple(early))
    if key in _IR: return _IR[key]
    r = rng('ir', rt60, bright)
    n = int(rt60 * 1.15 * SR); t = np.arange(n) / SR
    d = sweep_lp(r.standard_normal(n), bright, 450, rt60 * 0.9)
    d *= np.exp(-6.91 * t / rt60) * (1 - np.exp(-t / 0.008))
    d /= np.sqrt(np.sum(d ** 2))
    for dt, a in early:
        j = int(dt * SR)
        if j < n: d[j] += a
    _IR[key] = d
    return d

def reverb(x, rt60, wet, bright=7000, early=()):
    ir = get_ir(rt60, bright, early)
    w = signal.fftconvolve(x, ir)[:len(x)]
    return x + w * wet

# ------------------------------------------------------------------ small mechanical building blocks
def metal(f, lvl=1.0, r=None, dur=0.09, hard=1.0):
    """metal-on-metal tick: inharmonic damped modes + a sharp noise transient"""
    r = r or rng('metal', f)
    n = int(dur * SR); t = np.arange(n) / SR
    y = np.zeros(n)
    for ra, ta, a in zip([1, 2.32, 4.17, 6.93, 9.4], [.014, .009, .006, .0035, .002], [1, .65, .42, .26, .14]):
        ff = f * ra * r.uniform(.97, 1.03)
        if ff < SR / 2 * .9: y += a * np.exp(-t / ta) * np.sin(2 * np.pi * ff * t + r.uniform(0, 6.28))
    tr = hp(r.standard_normal(n), 1500) * np.exp(-t / 0.0007) * hard
    return (y * .5 + tr * .9) * lvl

def thump(f=110, lvl=1.0, tau=0.045, dur=0.2, r=None):
    r = r or rng('thump', f)
    n = int(dur * SR)
    body = sine_sweep(n, f * 1.6, f, 0.02) * env(n, tau, 0.002)
    skin = nrm(lp(r.standard_normal(n), 700)) * env(n, 0.012, 0.0008) * .5
    return (body + skin) * lvl

def friction(dur, f1, f2, lvl=0.3, r=None, rise=False):
    """sliding metal / plastic: band noise with a gritty, uneven amplitude"""
    r = r or rng('fr', f1, dur)
    n = int(dur * SR)
    w = bp(r.standard_normal(n), f1, f2)
    grit = np.abs(lp(r.standard_normal(n), 400)); grit = .55 + .45 * grit / (np.max(grit) + 1e-9)
    win = np.hanning(n)
    if rise: win = win * np.linspace(.5, 1.4, n)
    return nrm(w) * grit * win * lvl

def cloth(dur, lvl=0.1, r=None):
    r = r or rng('cloth', dur)
    n = int(dur * SR)
    return nrm(lp(r.standard_normal(n), 1400)) * np.hanning(n) * (.6 + .4 * np.abs(lp(r.standard_normal(n), 30)) / 0.1).clip(0, 1.4) * lvl

def piezo(f, dur, lvl=1.0, tail=0.006, r=None):
    """electronic buzzer: resonant piezo disc + plastic case tick"""
    r = r or rng('piezo', f)
    n = int((dur + .06) * SR); t = np.arange(n) / SR
    sq = signal.square(2 * np.pi * f * t)
    res = signal.sosfilt(signal.butter(2, [f * .82 / (SR / 2), f * 1.22 / (SR / 2)], btype='bandpass', output='sos'), sq)
    y = nrm(res) * .8 + lp(sq, 9000) * .18
    gate = np.clip(t / .0008, 0, 1) * np.where(t < dur, 1.0, np.exp(-(t - dur) / tail))
    y *= gate
    y += hp(r.standard_normal(n), 2200) * np.exp(-t / .0008) * .12
    y += np.sin(2 * np.pi * 1350 * t) * np.exp(-t / .012) * .05
    return y * lvl

# ------------------------------------------------------------------ output
def save(name, x, peak=0.9, sr=SR, folder=CS2, fade=0.02):
    x = np.nan_to_num(x.astype(np.float64))
    x = hp(x, 22, 1)
    x = nrm(x) * peak
    # trim trailing silence
    thr = 8e-4 * peak
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx): x = x[:min(len(x), idx[-1] + int(0.05 * SR))]
    f = int(fade * SR)
    if len(x) > f: x[-f:] *= np.linspace(1, 0, f) ** 2
    if sr != SR: x = signal.resample_poly(x, sr, SR)
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with wave.open(os.path.join(folder, name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
    return len(pcm) / sr

# ------------------------------------------------------------------ weapons
# cf/cg/ct = supersonic crack freq/gain/decay   bf0->bf1,bs,bt,bg = muzzle blast (lowpass glide, glide time, decay, gain)
# kf0->kf1,kt,kg = chest-thump (pitch-dropping sine)  kn = low noise body   ring = [(freq, decay, gain)] barrel/caliber tone
# rt/wet = room tail   slap = [(delay, gain)] echoes off walls   mech = action type   drive = saturation (punch)
GUNS = {
    'ak47':  dict(cf=1800, cg=.8, ct=.0014, bf0=7000, bf1=700, bs=.05, bt=.018, bg=1.0, kf0=190, kf1=75, kt=.09, kg=.9, kn=.5, ring=[(1100, .03, .25), (1900, .02, .15)], rt=.9, wet=.45, slap=[(.11, .16), (.23, .08)], mech='rifle', peak=.92, drive=2.2),
    'galil': dict(cf=2200, cg=.8, ct=.0012, bf0=7000, bf1=800, bs=.045, bt=.016, bg=.95, kf0=200, kf1=80, kt=.08, kg=.8, kn=.45, ring=[(1300, .028, .22), (2200, .02, .12)], rt=.85, wet=.42, slap=[(.11, .14)], mech='rifle', peak=.88, drive=2.1),
    'sg553': dict(cf=2000, cg=.9, ct=.0013, bf0=7500, bf1=700, bs=.05, bt=.019, bg=1.0, kf0=180, kf1=72, kt=.1, kg=.95, kn=.55, ring=[(1200, .03, .25), (2000, .02, .15)], rt=.95, wet=.46, slap=[(.12, .16), (.25, .08)], mech='rifle', peak=.92, drive=2.2),
    'm4a4':  dict(cf=2800, cg=.95, ct=.0010, bf0=8000, bf1=900, bs=.04, bt=.014, bg=.9, kf0=230, kf1=90, kt=.07, kg=.7, kn=.4, ring=[(2400, .02, .22), (3600, .012, .1)], rt=.8, wet=.4, slap=[(.1, .13)], mech='rifle', peak=.86, drive=2.0),
    'famas': dict(cf=3000, cg=.9, ct=.0009, bf0=8500, bf1=1000, bs=.035, bt=.011, bg=.8, kf0=250, kf1=105, kt=.05, kg=.55, kn=.3, ring=[(2800, .015, .2)], rt=.7, wet=.36, slap=[(.09, .12)], mech='rifle', peak=.8, drive=2.0),
    'aug':   dict(cf=2600, cg=.9, ct=.0011, bf0=8000, bf1=900, bs=.042, bt=.015, bg=.9, kf0=215, kf1=85, kt=.075, kg=.75, kn=.42, ring=[(2200, .022, .2)], rt=.82, wet=.4, slap=[(.1, .13)], mech='rifle', peak=.86, drive=2.0),
    'm4a1s': dict(cf=1500, cg=.06, ct=.001, bf0=3200, bf1=700, bs=.05, bt=.02, bg=.55, kf0=210, kf1=100, kt=.04, kg=.4, kn=.2, ring=[(1500, .012, .08)], rt=.5, wet=.25, slap=[(.1, .06)], mech='sup', peak=.55, drive=1.4, sup=1),
    'awp':   dict(cf=1500, cg=1.0, ct=.002, bf0=6000, bf1=400, bs=.08, bt=.04, bg=1.2, kf0=120, kf1=45, kt=.25, kg=1.4, kn=.8, ring=[(700, .06, .3), (1500, .04, .25)], rt=2.2, wet=.62, slap=[(.16, .22), (.31, .14), (.5, .08)], mech='bolt', peak=1.0, drive=2.4),
    'mac10': dict(cf=3200, cg=.7, ct=.0009, bf0=7500, bf1=1100, bs=.03, bt=.009, bg=.8, kf0=260, kf1=120, kt=.04, kg=.5, kn=.25, ring=[(2200, .012, .2)], rt=.5, wet=.3, slap=[(.08, .1)], mech='smg', peak=.72, drive=1.9),
    'mp9':   dict(cf=3600, cg=.7, ct=.0008, bf0=8000, bf1=1200, bs=.03, bt=.008, bg=.75, kf0=270, kf1=130, kt=.035, kg=.45, kn=.22, ring=[(2600, .01, .2)], rt=.5, wet=.3, slap=[(.08, .1)], mech='smg', peak=.7, drive=1.9),
    'p90':   dict(cf=4000, cg=.7, ct=.0007, bf0=9000, bf1=1500, bs=.025, bt=.007, bg=.7, kf0=290, kf1=150, kt=.03, kg=.35, kn=.15, ring=[(3000, .008, .2)], rt=.45, wet=.28, slap=[(.07, .09)], mech='smg', peak=.66, drive=1.8),
    'deagle': dict(cf=1700, cg=.9, ct=.0016, bf0=6500, bf1=550, bs=.06, bt=.03, bg=1.1, kf0=150, kf1=60, kt=.14, kg=1.2, kn=.7, ring=[(900, .05, .3), (1700, .03, .2)], rt=1.4, wet=.52, slap=[(.13, .2), (.27, .1)], mech='pistol', peak=.95, drive=2.3),
    'glock': dict(cf=3000, cg=.8, ct=.0009, bf0=7500, bf1=1000, bs=.03, bt=.008, bg=.8, kf0=250, kf1=110, kt=.035, kg=.55, kn=.25, ring=[(2300, .012, .2)], rt=.55, wet=.32, slap=[(.08, .1)], mech='pistol', peak=.72, drive=1.9),
    'usp':   dict(cf=1800, cg=.05, ct=.001, bf0=3000, bf1=800, bs=.04, bt=.016, bg=.5, kf0=270, kf1=130, kt=.03, kg=.35, kn=.15, ring=[(1800, .01, .06)], rt=.4, wet=.2, slap=[(.08, .05)], mech='sup', peak=.5, drive=1.4, sup=1),
}

def bolt_cycle(r, t0, buf, lvl=1.0):
    put(buf, friction(.05, 900, 2500, .25, r), t0 - .02)
    put(buf, metal(1900, .5 * lvl, r), t0)
    put(buf, friction(.09, 1000, 3000, .3 * lvl, r), t0 + .05)
    put(buf, metal(1500, .55 * lvl, r), t0 + .14)
    put(buf, friction(.06, 1000, 3000, .25 * lvl, r, rise=True), t0 + .26)
    put(buf, metal(2300, .6 * lvl, r), t0 + .32)
    put(buf, thump(90, .5 * lvl, r=r), t0 + .325)

def gunshot(name, p, v):
    r = rng('gun', name, v)
    j = lambda a=.06: r.uniform(1 - a, 1 + a)
    dur = 0.3 + p['rt'] + (1.1 if p['mech'] == 'bolt' else 0)
    n = int(dur * SR); t = np.arange(n) / SR
    crack = nrm(hp(r.standard_normal(n) * env(n, p['ct'] * j(.15), .0002), p['cf'] * j()))
    blast = nrm(sweep_lp(r.standard_normal(n) * env(n, p['bt'] * j(.12), .0004), p['bf0'] * j(), p['bf1'] * j(), p['bs']))
    thump_ = sine_sweep(n, p['kf0'] * j(), p['kf1'] * j(), .035) * env(n, p['kt'] * j(.1), .0015)
    low = nrm(lp(r.standard_normal(n), 260)) * env(n, .05, .001)
    ring = np.zeros(n)
    for f, tau, a in p['ring']:
        ring += a * np.sin(2 * np.pi * f * j(.04) * t + r.uniform(0, 6.28)) * env(n, tau, .0006) * (.7 + .3 * r.random())
    dry = crack * p['cg'] + blast * p['bg'] + thump_ * p['kg'] + low * p['kn'] + ring
    if p.get('sup'):   # gas "pfft" through the baffles
        dry += nrm(bp(r.standard_normal(n) * env(n, .035, .002), 1500, 6000)) * .22
    dry = np.tanh(dry * p['drive']) / np.tanh(p['drive'])
    # action noise
    m = p['mech']
    if m == 'rifle':
        put(dry, metal(1500 * j(), .35, r), .038); put(dry, metal(2300 * j(), .25, r), .072)
        put(dry, nrm(sine_sweep(int(.05 * SR), 420, 330, .03)) * .06, .04)
    elif m == 'smg':
        put(dry, metal(1700 * j(), .3, r), .026); put(dry, metal(2500 * j(), .2, r), .05)
    elif m == 'pistol':
        put(dry, metal(1900 * j(), .4, r), .03); put(dry, metal(2800 * j(), .28, r), .062); put(dry, thump(140, .15, r=r), .03)
    elif m == 'sup':
        put(dry, metal(1700 * j(), .75, r), .03); put(dry, metal(2400 * j(), .55, r), .062); put(dry, metal(1200 * j(), .35, r), .095)
        put(dry, thump(120, .25, r=r), .03)
    # room: tail + wall echoes
    out = reverb(dry, p['rt'], p['wet'], bright=6500)
    for d, a in p['slap']:
        k = int(d * SR)
        out[k:] += lp(dry, 2800)[:n - k] * a * j(.2)
    if m == 'bolt':
        bolt_cycle(r, .72, out, 1.0)
    return out

# ------------------------------------------------------------------ reloads
def mag_out(buf, t, r, big=True):
    put(buf, cloth(.16, .08, r), t - .06)
    put(buf, metal(3300, .5, r), t)                                  # release catch
    put(buf, friction(.08, 1300, 3200, .32, r), t + .03)             # mag sliding out
    put(buf, thump(125, .45, r=r), t + .12)                          # drops into hand
    for k in range(3): put(buf, metal(r.uniform(2800, 4200), .08, r, dur=.04), t + .125 + k * .014)   # rounds rattling

def mag_in(buf, t, r):
    put(buf, cloth(.12, .07, r), t - .08)
    put(buf, friction(.07, 1100, 2800, .28, r, rise=True), t)
    put(buf, thump(95, .75, r=r), t + .07)
    put(buf, metal(2600, .65, r), t + .068)
    put(buf, metal(1900, .38, r), t + .082)                          # latch

def charge(buf, t, r, short=False):
    put(buf, friction(.06 if short else .09, 1000, 3000, .3, r), t)
    put(buf, metal(1800, .5, r), t + (.06 if short else .09))
    f = t + (.14 if short else .2)
    put(buf, friction(.04, 1200, 3200, .22, r, rise=True), f)
    put(buf, metal(2400, .62, r), f + .05)
    put(buf, thump(85, .4, r=r), f + .05)

def reload_sound(kind, dur, seed):
    r = rng('reload', kind, dur, seed)
    buf = np.zeros(int((dur + .4) * SR))
    seq = {'rifle': [(.18, 'out'), (.5, 'in'), (.78, 'bolt')],
           'smg': [(.2, 'out'), (.55, 'in'), (.8, 'bolt')],
           'pistol': [(.2, 'out'), (.55, 'in'), (.8, 'slide')],
           'bolt': [(.08, 'lift'), (.3, 'out'), (.58, 'in'), (.84, 'drop')]}[kind]
    for f, ev in seq:
        t = dur * f
        if ev == 'out': mag_out(buf, t, r)
        elif ev == 'in': mag_in(buf, t, r)
        elif ev == 'bolt': charge(buf, t, r)
        elif ev == 'slide': charge(buf, t, r, short=True)
        elif ev == 'lift': put(buf, metal(1700, .45, r), t); put(buf, friction(.1, 900, 2600, .3, r), t + .05); put(buf, metal(1300, .5, r), t + .15)
        elif ev == 'drop': put(buf, friction(.08, 900, 2600, .3, r, rise=True), t); put(buf, metal(2100, .6, r), t + .1); put(buf, thump(80, .5, r=r), t + .1)
    return reverb(buf, .35, .12, bright=5000)

# ------------------------------------------------------------------ explosions & grenades
def debris(buf, r, count, t_start, t_end, lvl, decay):
    for _ in range(count):
        ti = t_start + r.exponential((t_end - t_start) / 3)
        if ti > t_end: continue
        a = lvl * np.exp(-(ti - t_start) / decay) * r.uniform(.15, .6)
        n = int(r.uniform(.015, .09) * SR)
        if r.random() < .75:   # rock / concrete clod
            put(buf, lp(r.standard_normal(n), r.uniform(300, 1400)) * env(n, r.uniform(.01, .035), .001) * 6, ti, a)
        else:                  # metal / glass ping
            put(buf, metal(r.uniform(1200, 3600), 1.0, r, dur=.12, hard=.5), ti, a * .6)

def explosion(kind, v=0):
    r = rng('boom', kind, v)
    big = kind == 'c4'
    dur = 6.5 if big else 3.2
    n = int(dur * SR); t = np.arange(n) / SR
    crack = nrm(hp(r.standard_normal(n) * env(n, .004, .0002), 1400))
    blast = nrm(sweep_lp(r.standard_normal(n) * env(n, .12 if big else .06, .0006), 9000, 250 if big else 400, .7 if big else .35))
    sub = sine_sweep(n, 80 if big else 95, 28 if big else 38, .4) * env(n, .95 if big else .4, .004)
    body = sine_sweep(n, 120, 58, .06) * env(n, .28 if big else .14, .002)
    slow = lp(r.standard_normal(n), 5); slow = .65 + .35 * slow / (np.std(slow) * 3 + 1e-9)
    rumble = nrm(sweep_lp(r.standard_normal(n), 1400, 90, 4.0 if big else 1.8)) * np.exp(-t / (1.7 if big else .8)) * np.clip(slow, .3, 1.3) * (1 - np.exp(-t / .05))
    x = crack * .8 + blast * 1.0 + sub * 1.1 + body * .9 + rumble * (.85 if big else .7)
    debris(x, r, 90 if big else 40, .22, 4.0 if big else 2.0, .45, 1.6 if big else .9)
    x = np.tanh(x * 1.7) / np.tanh(1.7)
    x = reverb(x, 3.3 if big else 1.5, .5 if big else .4, bright=5500, early=[(.045, .25), (.09, .18), (.17, .14)])
    return x

def flashbang(v=0):
    r = rng('flash', v); n = int(2.0 * SR); t = np.arange(n) / SR
    bang = nrm(sweep_lp(hp(r.standard_normal(n), 900) * env(n, .03, .0003), 14000, 2200, .25))
    pop = sine_sweep(n, 260, 110, .05) * env(n, .06, .001)
    crack = nrm(hp(r.standard_normal(n) * env(n, .002, .0002), 3000))
    x = bang * 1.0 + pop * .7 + crack * .7
    x = np.tanh(x * 1.8) / np.tanh(1.8)
    x = reverb(x, 1.1, .45, bright=8000, early=[(.03, .3), (.07, .2)])
    ring = (np.sin(2 * np.pi * 4300 * t) + .5 * np.sin(2 * np.pi * 6800 * t + 1)) * np.exp(-t / .5) * (1 - np.exp(-t / .03)) * .06
    return x + ring

def tinnitus(v=0):
    r = rng('ring', v); n = int(4.0 * SR); t = np.arange(n) / SR
    wob = 1 + .06 * np.sin(2 * np.pi * .7 * t)
    y = np.sin(2 * np.pi * 3950 * t) + .6 * np.sin(2 * np.pi * 5200 * t + 1) + .35 * np.sin(2 * np.pi * 7600 * t + 2) + .25 * np.sin(2 * np.pi * 1180 * t)
    y *= wob * np.exp(-t / 1.6) * (1 - np.exp(-t / .12))
    y += nrm(hp(r.standard_normal(n), 5000)) * .05 * np.exp(-t / 1.2)
    return y

def smoke(v=0):
    r = rng('smoke', v); n = int(2.6 * SR); t = np.arange(n) / SR
    pop = sine_sweep(n, 170, 68, .05) * env(n, .07, .001)
    puff = nrm(lp(r.standard_normal(n), 1400)) * env(n, .04, .001)
    gate = np.clip(t / .03, 0, 1) * np.exp(-np.maximum(t - .12, 0) / .65)
    hiss = nrm(bp(r.standard_normal(n), 1800, 8500)) * gate * (.7 + .3 * np.abs(lp(r.standard_normal(n), 25)) / .12).clip(0, 1.3)
    metal_pop = metal(1400, .5, r, dur=.1)
    x = pop * .9 + puff * .6 + hiss * .55
    put(x, metal_pop, .005, .6)
    return reverb(x, .7, .25, bright=6000)

def nade_throw(v=0):
    r = rng('throw', v); buf = np.zeros(int(.8 * SR))
    put(buf, cloth(.12, .08, r), 0)
    put(buf, friction(.06, 800, 2400, .25, r), .02)                       # pin sliding out
    put(buf, metal(4200, .5, r, dur=.2), .08)                             # pin "ting"
    put(buf, metal(2600, .5, r), .17)                                     # lever spring
    w = nrm(bp(r.standard_normal(int(.3 * SR)), 350, 2200)) * np.hanning(int(.3 * SR)) ** 1.5 * .28
    put(buf, w, .2)                                                       # whoosh
    return reverb(buf, .3, .08)

# ------------------------------------------------------------------ player feedback
def hit(head, v=0):
    r = rng('hit', head, v); n = int(.35 * SR)
    flesh = thump(150 if head else 120, 1.0, tau=.04, dur=.35, r=r)
    wet = nrm(lp(r.standard_normal(n), 1500)) * env(n, .02, .001) * .5
    x = flesh * .9 + wet
    if head:  # bone crack + helmet tink
        x += nrm(hp(r.standard_normal(n), 2500)) * env(n, .006, .0003) * .8
        put(x, metal(2100, .5, r, dur=.25, hard=.3), .002)
    return x

def grunt(r, dur=.24, f0=125):
    n = int(dur * SR); t = np.arange(n) / SR
    f = f0 * (1 - .28 * t / dur) * (1 + .015 * lp(r.standard_normal(n), 20) * 10)
    src = lp(signal.sawtooth(2 * np.pi * np.cumsum(f) / SR), 3000, 1) + r.standard_normal(n) * .08
    y = np.zeros(n)
    for fc, q, a in [(620, 7, 1.0), (1050, 9, .65), (2500, 12, .25)]:
        b, aa = signal.iirpeak(fc / (SR / 2), q); y += a * signal.lfilter(b, aa, src)
    return nrm(y) * np.clip(t / .025, 0, 1) * np.exp(-np.maximum(t - .05, 0) / .11)

def hurt(v=0):
    r = rng('hurt', v); buf = np.zeros(int(.5 * SR))
    put(buf, thump(105, 1.0, tau=.06, dur=.3, r=r), 0)
    put(buf, nrm(lp(r.standard_normal(int(.2 * SR)), 900)) * env(int(.2 * SR), .03, .001) * .5, 0)
    put(buf, grunt(r, .24, 120 + 12 * v) * .6, .03)
    put(buf, cloth(.2, .08, r), .02)
    return reverb(buf, .3, .08)

def dry_fire(v=0):
    r = rng('dry', v); buf = np.zeros(int(.2 * SR))
    put(buf, metal(3400, .8, r, dur=.06), 0)       # hammer falls on empty chamber
    put(buf, thump(200, .18, tau=.02, r=r), 0)
    put(buf, metal(2200, .25, r, dur=.05), .035)
    return reverb(buf, .25, .08)

def knife_swing(v=0):
    r = rng('knife', v); n = int(.32 * SR); t = np.arange(n) / SR
    w = r.standard_normal(n)
    fc = 500 + 2600 * np.sin(np.pi * np.clip(t / .3, 0, 1)) ** 1.2
    bank = [bp(w, f * .6, f * 1.5) for f in (500, 900, 1500, 2400, 3300)]
    pos = np.clip((fc - 500) / 2800 * 4, 0, 3.999); i = pos.astype(int); fr = pos - i; k = np.arange(n)
    Y = np.stack(bank); x = Y[i, k] * (1 - fr) + Y[i + 1, k] * fr
    x = nrm(x) * np.hanning(n) ** 1.3 * .6
    put(x, metal(5200, .08, r, dur=.12, hard=.1), .09)
    return x

def draw_sound(v=0):
    r = rng('draw', v); buf = np.zeros(int(.4 * SR))
    put(buf, cloth(.18, .1, r), 0)
    put(buf, friction(.06, 1000, 2800, .25, r), .05)
    put(buf, metal(2000, .45, r), .12)
    put(buf, metal(2900, .3, r), .15)
    put(buf, thump(110, .25, r=r), .12)
    return buf

def ui_click(v=0):
    r = rng('ui', v); buf = np.zeros(int(.12 * SR))
    put(buf, thump(260, .5, tau=.012, dur=.1, r=r), 0)
    put(buf, metal(1800, .35, r, dur=.06, hard=.4), 0)
    return buf

def money(v=0):
    r = rng('money', v); buf = np.zeros(int(1.0 * SR))
    for k, (f, d) in enumerate([(3100, 0), (4700, .055), (3700, .1), (6100, .14)]):
        put(buf, metal(f, .35, r, dur=.14, hard=.2), d)
    put(buf, metal(2637, .3, r, dur=.5, hard=.0), .17)    # register bell
    return reverb(buf, .4, .12, bright=8000)

# ------------------------------------------------------------------ C4
def c4_beep(fast=False):
    return piezo(3000 if fast else 2250, .06 if fast else .1, 1.0, tail=.005)

def c4_keypad(v=0):
    r = rng('keypad', v); buf = np.zeros(int(3.6 * SR))
    tones = [1900, 2150, 1750, 2350, 1850, 2050, 2500]
    for i, f in enumerate(tones):
        t0 = .12 + i * .41 + r.uniform(-.02, .02)
        put(buf, nrm(lp(r.standard_normal(int(.012 * SR)), 2500)) * env(int(.012 * SR), .004, .0003) * .5, t0 - .004)   # rubber key
        put(buf, thump(330, .25, tau=.01, dur=.05, r=r), t0 - .004)
        put(buf, piezo(f, .075, .85, r=r), t0)
    return reverb(buf, .25, .1)

def c4_planted(v=0):
    r = rng('planted', v); buf = np.zeros(int(1.3 * SR))
    for i, f in enumerate([1900, 2250, 2650]):
        put(buf, piezo(f, .1, .9, r=r), .02 + i * .16)
    put(buf, metal(1500, .7, r, dur=.1), .56)
    put(buf, thump(90, .6, r=r), .56)
    put(buf, piezo(1450, .35, .35, tail=.05, r=r), .62)
    return reverb(buf, .35, .12)

def c4_defuse(v=0):
    r = rng('defuse', v); total = 10.2; buf = np.zeros(int(total * SR))
    t = .15; i = 0
    while t < total - .3:
        put(buf, metal(2100 * r.uniform(.96, 1.04), .55, r, dur=.07), t)            # ratchet pawl
        put(buf, metal(850 * r.uniform(.95, 1.05), .3, r, dur=.06, hard=.2), t + .012)
        put(buf, thump(180, .12, tau=.012, dur=.05, r=r), t)
        if i % 4 == 3: put(buf, piezo(1650, .05, .3, r=r), t + .06)
        t += max(.15, .5 - i * .03); i += 1
    return reverb(buf, .3, .08)

def c4_defused(v=0):
    r = rng('defused', v); buf = np.zeros(int(1.0 * SR))
    put(buf, metal(1700, .7, r, dur=.1), 0); put(buf, thump(100, .6, r=r), 0)
    put(buf, piezo(1300, .13, .7, r=r), .12); put(buf, piezo(1750, .3, .75, tail=.04, r=r), .27)
    return reverb(buf, .3, .1)

# ------------------------------------------------------------------ footsteps (dusty concrete / packed sand)
def footstep(v):
    r = rng('step', v); n = int(.32 * SR); t = np.arange(n) / SR
    heel = nrm(lp(r.standard_normal(n), r.uniform(220, 360))) * env(n, r.uniform(.018, .03), .0012)
    body = sine_sweep(n, 120, r.uniform(62, 80), .02) * env(n, .05, .002)

    def grit(t0, scale, count):
        e = np.zeros(n)
        for _ in range(count):
            ti = t0 + r.uniform(0, .075) ** 1.2
            k = int(ti * SR)
            if k < n: e[k:] += r.uniform(.2, 1) * np.exp(-(t[:n - k]) / r.uniform(.002, .006))
        return nrm(hp(r.standard_normal(n), r.uniform(1100, 1900))) * e * scale

    y = heel * .9 + body * .6
    y += nrm(grit(0, .45, r.integers(12, 20)))
    t1 = r.uniform(.095, .14)                                   # toe rolls down
    k1 = int(t1 * SR)
    y[k1:] += (nrm(lp(r.standard_normal(n - k1), 520)) * env(n - k1, .02, .001)) * .38
    y += np.roll(grit(0, .22, r.integers(6, 11)), k1)
    put(y, cloth(.2, .03, r), 0)
    return lp(y, 9500)

# ------------------------------------------------------------------ build everything
def main():
    manifest = {}
    sizes = {}

    def reg(key, fname, x, **kw):
        d = save(fname, x, **kw)
        manifest.setdefault(key, [])
        if fname not in manifest[key]: manifest[key].append(fname)
        sizes[fname] = d

    for k, p in GUNS.items():
        for v in range(1, 4):
            reg(k, f'{k}_{v}.wav', gunshot(k, p, v), peak=p['peak'])
    for v in (1, 2): reg('knife', f'knife_{v}.wav', knife_swing(v), peak=.5)

    from_weapons = {'glock': ('pistol', 2.2), 'usp': ('pistol', 2.2), 'deagle': ('pistol', 2.2), 'mac10': ('smg', 2.6), 'mp9': ('smg', 2.1),
                    'p90': ('smg', 3.3), 'ak47': ('rifle', 2.5), 'galil': ('rifle', 3.0), 'famas': ('rifle', 3.3), 'm4a4': ('rifle', 3.1),
                    'm4a1s': ('rifle', 3.1), 'sg553': ('rifle', 2.8), 'aug': ('rifle', 3.8), 'awp': ('bolt', 3.7)}
    for k, (kind, dur) in from_weapons.items():
        reg(f'reload_{k}', f'reload_{k}.wav', reload_sound(kind, dur, 1), peak=.6, sr=22050)
    reg('reload', 'reload_generic.wav', reload_sound('rifle', 2.4, 2), peak=.6, sr=22050)

    for v in (1, 2): reg('dry', f'dry_{v}.wav', dry_fire(v), peak=.6)
    for v in (1, 2): reg('hit_head', f'hit_head_{v}.wav', hit(True, v), peak=.8)
    for v in (1, 2): reg('hit_body', f'hit_body_{v}.wav', hit(False, v), peak=.7)
    for v in (1, 2, 3): reg('hurt', f'hurt_{v}.wav', hurt(v), peak=.75)
    for v in (1, 2): reg('nade_throw', f'nade_throw_{v}.wav', nade_throw(v), peak=.6)
    reg('he', 'he_1.wav', explosion('he', 1), peak=.95)
    reg('he', 'he_2.wav', explosion('he', 2), peak=.95)
    reg('flash', 'flash_1.wav', flashbang(1), peak=.9)
    reg('ring', 'ring.wav', tinnitus(1), peak=.5, sr=22050)
    reg('smoke', 'smoke_1.wav', smoke(1), peak=.7)
    reg('draw', 'draw_1.wav', draw_sound(1), peak=.5); reg('draw', 'draw_2.wav', draw_sound(2), peak=.5)
    for v in (1, 2): reg('ui', f'ui_{v}.wav', ui_click(v), peak=.5)
    reg('money', 'money.wav', money(1), peak=.6)

    reg('c4_beep', 'c4_beep.wav', c4_beep(False), peak=.85)
    reg('c4_beep_fast', 'c4_beep_fast.wav', c4_beep(True), peak=.9)
    reg('c4_plant', 'c4_plant.wav', c4_keypad(1), peak=.8, sr=32000)
    reg('c4_planted', 'c4_planted.wav', c4_planted(1), peak=.9)
    reg('c4_defuse', 'c4_defuse.wav', c4_defuse(1), peak=.8, sr=32000)
    reg('c4_defused', 'c4_defused.wav', c4_defused(1), peak=.85)
    reg('c4_explode', 'c4_explode.wav', explosion('c4', 1), peak=1.0)

    for v in range(1, 7):
        save(f'footstep_{v}.wav', footstep(v), peak=.85, folder=ROOT, fade=.03)

    flat = {k: (v[0] if len(v) == 1 else v) for k, v in manifest.items()}
    with open(os.path.join(CS2, 'manifest.json'), 'w') as f: json.dump(flat, f, indent=1)
    total = 0
    for fn in sizes:
        total += os.path.getsize(os.path.join(CS2, fn))
    for v in range(1, 7): total += os.path.getsize(os.path.join(ROOT, f'footstep_{v}.wav'))
    print(f'{len(sizes)+6} files, {total/1e6:.1f} MB total')

if __name__ == '__main__':
    main()
