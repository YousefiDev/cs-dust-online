// Boot: renderer, Dust II world, lobby flyover, settings, connection and the frame loop.
import * as THREE from 'three';
import { getMap } from '/shared/maps.js';
import { buildWorld } from './world.js';
import { Sound } from './audio.js';
import { HUD } from './hud.js';
import { Game } from './game.js';
import { connectOnline, connectOffline } from './net.js';
import { TouchEditor, normalizeLayout, applyLayout, setupGate } from './touchui.js';

const $ = (id) => document.getElementById(id);
const FA = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const DEF = { map: 'dust2', name: '', sens: 1.2, touchSens: 1, gyro: false, fov: 74, vol: 0.7, ch: 6, chcolor: '#3cff6f', quality: 'high', radio: 'on', bots: 'fill', difficulty: 'normal', max: '10', touchLayout: {} };
const settings = Object.assign({}, DEF, JSON.parse(localStorage.getItem('cs-dust2') || '{}'));
const save = () => localStorage.setItem('cs-dust2', JSON.stringify(settings));
const isMobile = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}
const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window && innerWidth < 1100;
if (touch) document.body.classList.add('is-touch');
if (touch && !localStorage.getItem('cs-dust2')) settings.quality = 'medium';
if (!['high', 'medium', 'low'].includes(settings.quality)) settings.quality = 'high';
settings.touchSens = Number(settings.touchSens || 1); settings.gyro = !!settings.gyro; settings.touchLayout ||= {};

// ---------- renderer ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: false });
let Q = settings.quality; renderer.setPixelRatio(Math.min(devicePixelRatio, Q === 'high' ? (touch ? 1.5 : 2) : Q === 'medium' ? 1.25 : 1));
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = Q === 'low' ? 1.0 : 1.1;
renderer.shadowMap.enabled = Q !== 'low'; renderer.shadowMap.type = Q === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap; renderer.autoClear = false;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#9aa9b8'); scene.fog = new THREE.Fog('#9aa9b8', 110, 650); const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 1500); camera.rotation.order = 'YXZ';
const vmScene = new THREE.Scene(), vmCamera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.01, 10);
vmScene.add(new THREE.HemisphereLight('#e9f1ff', '#8a6a44', 1.7)); const vmSun = new THREE.DirectionalLight('#fff3dc', 2.8); vmSun.position.set(-1, 2, 1); vmSun.castShadow = Q === 'high'; vmSun.shadow.mapSize.set(1024,1024); vmSun.shadow.camera.near=0.1; vmSun.shadow.camera.far=20; vmScene.add(vmSun);
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = vmCamera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); vmCamera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();
let world = null, worldId = null;
function loadMap(id, force = false) {
  if (worldId === id && !force) return getMap(id);
  if (world) { scene.remove(world.root); world.root.traverse((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose?.(); m.normalMap?.dispose?.(); m.roughnessMap?.dispose?.(); m.aoMap?.dispose?.(); m.dispose?.(); }); }); }
  const bt = document.getElementById('brand-map'); if (bt) bt.textContent = ({ dust2: 'DUST II', mirage: 'MIRAGE', inferno: 'INFERNO', warehouse: 'WAREHOUSE', bazaar: 'BAZAAR', arena: 'ARENA' })[id] || 'DUST II';
  const m = getMap(id); world = buildWorld(scene, m, { low: Q === 'low', quality: Q }); worldId = m.id; game && (game.map = m); return m;
}
let game = null;
const map = loadMap(['dust2', 'mirage', 'inferno', 'warehouse', 'bazaar', 'arena'].includes(settings.map) ? settings.map : 'dust2');
const sound = new Sound(); sound.setVolume(settings.vol);
const hud = new HUD();
game = new Game({ renderer, scene, camera, vmScene, vmCamera, sound, hud, settings, map, touch });
game.onMap = (id) => { game.map = loadMap(id); };
game.onLeave = () => showLobby();
game.onEnter = () => { $('lobby').hidden = true; $('settings').hidden = true; $('reconnect').hidden = true; if (touch) $('touch').hidden = false; };
requestAnimationFrame(() => $('loading').classList.add('done'));

// ---------- lobby ----------
let net = null, mode = null;
function setStatus(kind, text) { const s = $('net-status'); s.className = 'status ' + (kind || ''); s.textContent = text; }
function showLobby() {
  $('lobby').hidden = false; hud.show(false); $('teamsel').hidden = true; $('reconnect').hidden = true; $('touch').hidden = true; rejoin = null; refreshRooms();
}
$('name').value = settings.name || '';
$('name').addEventListener('input', () => { settings.name = $('name').value.trim().slice(0, 16); save(); });
const playerName = () => (settings.name || $('name').value || 'Player' + Math.floor(Math.random() * 900 + 100)).trim();
document.querySelectorAll('.seg').forEach((seg) => {
  const key = seg.dataset.name; const btns = seg.querySelectorAll('button');
  const sync = () => btns.forEach((b) => b.classList.toggle('on', String(settings[key]) === b.dataset.v)); sync();
  btns.forEach((b) => b.addEventListener('click', () => { const prev = settings[key]; settings[key] = b.dataset.v; save(); sync(); applySettings(); sound.ui(); if (key === 'map' && !game.inRoom) { loadMap(b.dataset.v); flyT = 0; }
    if (key === 'quality' && prev !== b.dataset.v) { applyQuality(); } }));
});
let connecting = null;
async function ensureOnline() {
  if (net && !net.offline && net.connected()) return net;
  if (connecting) return connecting;
  if (net && net.offline) { net.close(); net = null; }
  if (net && !net.offline) { // socket exists but is reconnecting: wait for it instead of opening a second one
    connecting = new Promise((res, rej) => { const t = setTimeout(() => { connecting = null; rej(new Error('timeout')); }, 8000); net.raw.once('connect', () => { clearTimeout(t); connecting = null; res(net); }); });
    return connecting;
  }
  setStatus('', 'در حال اتصال…');
  connecting = (async () => {
    try {
      const n = await connectOnline(setStatus); net = n; game.attach(net);
      n.raw.on('disconnect', (reason) => {
        if (!game.inRoom || net !== n || !game.room || reason === 'io client disconnect') return;
        if (reason === 'io server disconnect') { game.cleanup(); showLobby(); setStatus('bad', 'سرور اتصال را بست'); return; }
        // Keep the scene; the server holds our player for a short grace period.
        rejoin = { code: game.room.code, until: Date.now() + 28000 }; game.keys = {}; game.touchFire = false; game.touchFireAlt = false; game.mouseR = false; game.touchMove = null; $('reconnect').hidden = false;
        clearTimeout(rejoinTimer); rejoinTimer = setTimeout(() => { if (rejoin) { game.cleanup(); showLobby(); setStatus('bad', 'ارتباط با سرور قطع شد'); } }, 28000);
      });
      n.raw.on('connect', async () => {
        if (!rejoin || net !== n) return; const code = rejoin.code;
        await hello();
        n.emit('join', { code, name: playerName(), session: sessionId }, (r) => {
          clearTimeout(rejoinTimer); rejoin = null; $('reconnect').hidden = true;
          if (!r || !r.ok) { game.cleanup(); showLobby(); setStatus('bad', 'برگشت به سرور انجام نشد'); }
        });
      });
      mode = 'online'; setStatus('ok', 'متصل به سرور'); await hello(); return net;
    }
    catch (e) { setStatus('bad', 'سرور در دسترس نیست — حالت آفلاین را امتحان کن'); throw e; }
    finally { connecting = null; }
  })();
  return connecting;
}
let rejoin = null, rejoinTimer = 0;
const sessionId = (() => { let v = localStorage.getItem('cs-session'); if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)); localStorage.setItem('cs-session', v); } return v; })();
$('rc-leave').addEventListener('click', () => { rejoin = null; clearTimeout(rejoinTimer); game.cleanup(); showLobby(); });
function hello() { return new Promise((res) => net.emit('hello', { name: playerName(), session: sessionId }, (r) => { if (r && r.t && !net.offline) game.offset = r.t - Date.now(); res(r); })); }
function roomRow(r) {
  const el = document.createElement('div'); el.className = 'room';
  const phase = r.phase === 'warmup' ? 'Warmup' : `Round ${r.round} · ${r.score.CT}-${r.score.T}`;
  const mapLabel = ({ dust2: 'Dust II', mirage: 'Mirage', warehouse: 'Warehouse', bazaar: 'Bazaar', arena: 'Arena' })[r.map] || r.map;
  el.innerHTML = `<div><div class="rt"></div><div class="rc">${r.code}</div></div><div class="rm">${mapLabel}</div><div class="rp"><b>${r.humans}</b> / ${r.max}${r.bots ? ` <small>+${r.bots} bots</small>` : ''}</div><div class="rs">${phase}</div><button>JOIN</button>`;
  el.querySelector('.rt').textContent = r.title; el.querySelector('button').addEventListener('click', () => join(r.code)); return el;
}
async function refreshRooms() {
  if ($('lobby').hidden || !net || net.offline || !net.connected()) return;
  net.emit('rooms', null, (list) => {
    const box = $('rooms'); box.innerHTML = '';
    if (!list || !list.length) { box.innerHTML = '<div class="empty">هنوز سروری ساخته نشده. اولین نفر باش.</div>'; return; }
    for (const r of list) box.appendChild(roomRow(r));
  });
}
setInterval(refreshRooms, 2500);
async function create(offline) {
  sound.init(); sound.ui(); const btn = offline ? $('btn-offline') : $('btn-create'); if (!btn) return; btn.disabled = true;
  try {
    if (offline) { if (net) net.close(); net = await connectOffline(); game.attach(net); mode = 'offline'; await hello(); setStatus('ok', 'حالت آفلاین'); }
    else await ensureOnline();
    if (offline) {
      net.emit('create', { name: playerName(), map: settings.map, bots:'fill', difficulty:settings.difficulty, max:Number(settings.max), title:'Practice' }, (r) => { btn.disabled=false; if(!r?.ok) setStatus('bad','تمرین آفلاین اجرا نشد'); });
    } else {
      btn.disabled = false; setStatus('bad', 'ساخت سرور فقط از پنل ادمین امکان‌پذیر است');
    }
  } catch (e) { btn.disabled = false; console.error(e); }
}
async function join(code) {
  sound.init(); sound.ui(); code = String(code || '').trim().toUpperCase(); if (!code) return;
  try { await ensureOnline(); } catch (e) { return; }
  net.emit('join', { code, name: playerName(), session: sessionId }, (r) => { if (!r || !r.ok) setStatus('bad', r && r.error === 'Room not found' ? 'سروری با این کد پیدا نشد' : r && r.error === 'BANNED' ? 'از این سرور بن شده‌ای' : r && r.error === 'Room is full' ? 'سرور پر است' : 'ورود انجام نشد'); });
}
$('btn-create')?.addEventListener('click', () => create(false));
$('btn-offline').addEventListener('click', () => create(true));
$('btn-join').addEventListener('click', () => join($('code').value));
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join($('code').value); });
// team select
document.querySelectorAll('#teamsel [data-team]').forEach((b) => b.addEventListener('click', () => game.chooseTeam(b.dataset.team)));
$('ts-leave').addEventListener('click', () => game.leave());
// pause
$('p-resume').addEventListener('click', () => { game.setMenuPaused(false); if (!touch) game.lock(); });
$('p-team').addEventListener('click', () => { game.setMenuPaused(false); game.openTeamSelect(); });
$('p-settings').addEventListener('click', () => { $('pause').hidden = true; openSettings(); });
$('p-leave').addEventListener('click', () => { game.setMenuPaused(false); game.leave(); });
// settings
function applyQuality() {
  const next = ['high', 'medium', 'low'].includes(settings.quality) ? settings.quality : 'high';
  Q = next;
  // High keeps the crisp look, but caps mobile DPR so the GPU is not asked to
  // shade four times as many pixels on a small phone.
  const ratio = Math.min(devicePixelRatio, Q === 'high' ? (touch ? 1.5 : 2) : Q === 'medium' ? 1.25 : 1);
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMappingExposure = Q === 'low' ? 1.0 : 1.1;
  // Shadow-map type is fixed when WebGL shadow resources are first created;
  // changing it on a live renderer can invalidate GPU state. Keep the renderer
  // stable and only toggle the enabled flag here.
  renderer.shadowMap.enabled = Q !== 'low';
  if (vmSun) vmSun.castShadow = Q === 'high';
  world?.setQuality?.(Q);
  // Never rebuild the live map while a round is running. Replacing the world
  // root here invalidates live collision/render references and can leave the
  // local player visually/collision-wise stuck after a graphics change.
  // Quality is intentionally applied to the renderer/view-model in place.
  if (game && game.inRoom) {
    game.resetFrameClock?.();
  }
}
function applySettings() {
  const r = document.documentElement.style; r.setProperty('--ch', settings.chcolor); r.setProperty('--chs', settings.ch + 'px');
  sound.setVolume(+settings.vol); settings.sens = +settings.sens; settings.fov = +settings.fov; settings.radio = settings.radio !== 'off';
  camera.fov = settings.fov; camera.updateProjectionMatrix();
  applyQuality();
}
function openSettings() {
  $('settings').hidden = false;
  for (const [id, key, f] of [['s-sens', 'sens', (v) => (+v).toFixed(2)], ['s-fov', 'fov', (v) => v + '°'], ['s-vol', 'vol', (v) => Math.round(v * 100) + '%'], ['s-ch', 'ch', (v) => v]]) {
    const el = $(id); el.value = settings[key]; $(id + '-v').textContent = f(settings[key]); el.oninput = () => { settings[key] = +el.value; $(id + '-v').textContent = f(el.value); save(); applySettings(); };
  }
  const gyro = $('s-gyro'); gyro.checked = !!settings.gyro; gyro.onchange = () => { settings.gyro = gyro.checked; save(); if (settings.gyro) enableGyro(); };
  const ts = $('s-touch-sens'); ts.value = settings.touchSens; $('s-touch-sens-v').textContent = (+settings.touchSens).toFixed(2); ts.oninput = () => { settings.touchSens = +ts.value; $('s-touch-sens-v').textContent = (+ts.value).toFixed(2); save(); };
}
$('btn-settings').addEventListener('click', openSettings);
$('s-layout').addEventListener('click', () => { $('settings').hidden = true; openEditor(); });
const closeSettings = (saveChanges = true) => {
  $('settings').hidden = true;
  if (saveChanges) save();
  applySettings();
  // Settings can be opened from the pause screen. That screen leaves
  // menuPaused=true; clear it before returning control to the player,
  // otherwise the render loop keeps the player frozen after saving.
  if (game.inRoom) {
    game.setMenuPaused(false);
    if ($('teamsel').hidden) game.lock();
  }
};
$('s-close').addEventListener('click', () => closeSettings(true));
$('s-dismiss').addEventListener('click', () => closeSettings(true));
$('s-x').addEventListener('click', () => closeSettings(true));
applySettings();
// ---------- input ----------
// Keep gameplay keyboard input inside the game surface. Without this capture
// layer, browser shortcuts can see combinations such as Ctrl+W/Ctrl+R while
// the player is crouching and moving, which can close/reload the game tab.
// Text fields keep their normal browser/editor shortcuts.
const isEditableTarget = (el) => {
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};
const gameplayKeyGuard = (e) => {
  if (!game.inRoom || isEditableTarget(e.target)) return;
  // Block the browser's default action, but NEVER stop propagation here: the
  // game input handler below must still receive Tab/Ctrl/C/other movement keys.
  // This is especially important for Tab (scoreboard) and Control (crouch).
  if (e.code === 'Tab' || e.ctrlKey || e.altKey || e.metaKey) e.preventDefault();
};
addEventListener('keydown', gameplayKeyGuard, true);
addEventListener('keyup', gameplayKeyGuard, true);
addEventListener('keydown', (e) => { if (isEditableTarget(e.target) && e.target.id !== 'chat-in') return; game.onKeyDown(e); });
addEventListener('keyup', (e) => game.onKeyUp(e));
canvas.addEventListener('mousedown', (e) => { sound.init(); if (game.inRoom && !game.locked && $('teamsel').hidden && !game.buyOpen && !touch) { game.lock(); return; } game.onMouseDown(e); });
addEventListener('mousedown', (e) => { if (e.target !== canvas) return; });
addEventListener('mouseup', (e) => game.onMouseUp(e));
addEventListener('mousemove', (e) => game.onMouseMove(e));
addEventListener('wheel', (e) => game.onWheel(e), { passive: true });
addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  game.locked = document.pointerLockElement === canvas;
  if (!game.locked) { game.mouseL = false; game.mouseR = false; game.keys = {}; }
  // Losing pointer lock while the page is hidden is expected when switching to
  // another tab/window. Do not turn that into a gameplay pause; visibilitychange
  // restores the clock and input state when the player comes back.
  if (!game.locked && !document.hidden && game.inRoom && !game.buyOpen && !game.chatOpen && $('teamsel').hidden && $('settings').hidden && !game.menuPaused && !touch) game.setMenuPaused(true);
  if (game.locked) { $('pause').hidden = true; canvas.focus({ preventScroll: true }); }
});
addEventListener('blur', () => { game.keys = {}; game.mouseL = false; game.mouseR = false; });
let wasHidden = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    wasHidden = true;
    game._pauseBeforeHidden = game.menuPaused;
    game.keys = {}; game.mouseL = false; game.mouseR = false;
    game.touchFire = false; game.touchFireAlt = false; game.touchMove = null;
  } else {
    // rAF may have been suspended while hidden; never let that missing time
    // freeze prediction or create a huge simulation jump on resume.
    last = performance.now();
    if (wasHidden && game.inRoom && !game._pauseBeforeHidden && game.menuPaused && !$('settings').hidden && $('teamsel').hidden && !game.buyOpen && !game.chatOpen) game.setMenuPaused(false);
    wasHidden = false;
  }
});
// ---------- mobile: start gate, touch controls, UI editor ----------
settings.touchLayout = normalizeLayout(settings.touchLayout);
let editorReturn = null;
const sendChatMobile = (e) => { e.preventDefault(); e.stopPropagation(); game.sendChat(); };
$('chat-send')?.addEventListener('click', sendChatMobile);
$('chat-send')?.addEventListener('pointerup', sendChatMobile, { passive: false });
$('chat-send')?.addEventListener('touchend', sendChatMobile, { passive: false });

const editor = new TouchEditor({
  getLayout: () => settings.touchLayout,
  setLayout: (l) => { settings.touchLayout = normalizeLayout(l); save(); },
  onOpen: () => { game.keys = {}; game.touchFire = false; game.touchFireAlt = false; game.mouseR = false; game.touchMove = null; },
  onClose: (saved) => {
    if (editorReturn === 'lobby') { $('lobby').hidden = false; $('touch').hidden = true; }
    editorReturn = null; hud.toast && saved && hud.toast('چیدمان ذخیره شد');
  },
});
function openEditor() {
  editorReturn = game.inRoom ? 'game' : 'lobby';
  if (editorReturn === 'lobby') $('lobby').hidden = true;
  if (game.inRoom) { game.setMenuPaused(false); game.closeMenus(); }
  editor.open();
}
$('btn-uiedit').addEventListener('click', openEditor);
$('p-uiedit').addEventListener('click', openEditor);
const editing = () => editor.active;
function enableGyro() {
  if (!touch || !settings.gyro || window.__gyroEnabled) return;
  const run = () => { window.__gyroEnabled=true; addEventListener('deviceorientation', e => { if(!game.inRoom || !game.alive || editing() || !settings.gyro) return; const gamma=e.gamma||0, beta=e.beta||0; game.yaw -= gamma * 0.00075 * settings.touchSens; game.pitch=Math.max(-1.5,Math.min(1.5,game.pitch + (beta-45)*0.00012*settings.touchSens)); }); };
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().then(x=>{if(x==='granted')run();}).catch(()=>{}); else run();
}
setupGate({ touch, onEnter: () => { sound.init(); } });
if (touch) {
  game.touch = true; applyLayout(settings.touchLayout);
  $('touch').hidden = !game.inRoom;
  const stick = $('t-stick'), knob = stick.querySelector('i'); let sid = null, sx = 0, sy = 0, lid = null, lx = 0, ly = 0;
  stick.addEventListener('touchstart', (e) => { if (editing()) return; const t = e.changedTouches[0]; sid = t.identifier; const r = stick.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2; e.preventDefault(); }, { passive: false });
  addEventListener('touchmove', (e) => {
    if (editing()) return;
    for (const t of e.changedTouches) {
      if (t.identifier === sid) { const sc = settings.touchLayout['t-stick'].s; let dx = (t.clientX - sx) / sc, dy = (t.clientY - sy) / sc; const l = Math.hypot(dx, dy), m = 60; if (l > m) { dx *= m / l; dy *= m / l; } knob.style.transform = `translate(${dx}px,${dy}px)`; game.touchMove = { f: -dy / m, r: dx / m }; }
      if (t.identifier === lid) { const k = 0.005 * settings.sens * settings.touchSens * (game.scope ? camera.fov / settings.fov : 1); game.yaw -= (t.clientX - lx) * k; game.pitch = Math.max(-1.5, Math.min(1.5, game.pitch - (t.clientY - ly) * k)); lx = t.clientX; ly = t.clientY; }
    }
  }, { passive: false });
  const end = (e) => { for (const t of e.changedTouches) { if (t.identifier === sid) { sid = null; knob.style.transform = ''; game.touchMove = null; } if (t.identifier === lid) lid = null; } };
  addEventListener('touchend', end); addEventListener('touchcancel', end);
  $('t-look').addEventListener('touchstart', (e) => { if (editing()) return; const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY; sound.init(); }, { passive: true });
  // Buttons that also steer: a finger that presses FIRE can keep dragging to aim (like CODM/PUBG).
  const aimWith = (e) => { if (lid === null) { const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY; } };
  const hold = (id, on, off, aim) => { const b = $(id); if (!b) return;
    b.addEventListener('touchstart', (e) => { e.preventDefault(); if (editing()) return; sound.init(); if (aim) aimWith(e); on(); }, { passive: false });
    b.addEventListener('touchend', (e) => { e.preventDefault(); if (editing()) return; off && off(); }, { passive: false });
    b.addEventListener('touchcancel', () => { if (!editing()) off && off(); }); };
  const fireOn = () => { game.touchFire = true; if (!game.alive) game.specNext(1); }, fireOff = () => { game.touchFire = false; };
  const altOn = () => { if (game.alive && game.activeW()?.melee) game.touchFireAlt = true; }, altOff = () => { game.touchFireAlt = false; };
  hold('t-fire', fireOn, fireOff, true); hold('t-fire2', altOn, altOff, true);
  hold('t-jump', () => game.touchJump = true, () => game.touchJump = false);
  hold('t-crouch', () => game.touchCrouch = !game.touchCrouch);
  hold('t-reload', () => game.reload()); hold('t-scope', () => game.toggleScope()); hold('t-next', () => game.cycleSlot(1));
  hold('t-nade', () => game.switchSlot && game.switchSlot(4)); hold('t-drop', () => game.net && game.net.emit('drop'));
  hold('t-use', () => game.net && game.net.emit('use'), () => game.net && game.net.emit('unuse'));
  hold('t-buy', () => game.toggleBuy());
  hold('t-chat', (e) => { utility.hidden = true; game.openChat(false); });
  hold('t-score', () => { game.sbOpen = !game.sbOpen; hud.scoreboard(game.sbOpen, game.roster, game.meId, game.score, game.room); });
  hold('t-pause', () => game.toggleMenuPause());
  const utility = $('t-utility'), more = $('t-more');
  hold('t-more', () => { utility.hidden = !utility.hidden; });
  addEventListener('pointerdown', (e) => { if (!utility.hidden && !utility.contains(e.target) && e.target !== more) utility.hidden = true; });
  addEventListener('resize', () => { if (!editing()) applyLayout(settings.touchLayout); });
  if (settings.gyro) enableGyro();
}
// ---------- loop ----------
let last = performance.now(), flyT = 0;
// Cinematic drone shots over iconic spots: [lookX, lookZ, camX, camY, camZ]
const SHOTS_BY = { dust2: [[95, 16, 62, 9, 44], [62, 66, 70, 7, 100], [20, 18, 44, 8, 40], [104, 52, 96, 10, 84], [60, 112, 74, 12, 92], [22, 80, 34, 9, 58]],
  mirage: [[50, 104, 90, 10, 80], [60, 62, 104, 9, 62], [22, 22, 60, 10, 40], [112, 64, 84, 12, 44], [40, 104, 20, 9, 70]],
  inferno: [[28, 110, 48, 10, 60], [34, 42, 68, 9, 34], [50, 16, 34, 9, 20], [92, 58, 68, 10, 34], [16, 92, 34, 10, 52]] };
function lobbyCam(dt) {
  flyT += dt; const D = 11, i = Math.floor(flyT / D), k = (flyT % D) / D, e = k * k * (3 - 2 * k);
  const SHOTS = SHOTS_BY[worldId] || SHOTS_BY.dust2; const [lx, lz, cx, cy, cz] = SHOTS[i % SHOTS.length]; const dx = lx - cx, dz = lz - cz;
  camera.position.set(cx + dx * e * 0.35 + -dz * 0.12 * (e - 0.5), cy - e * 2, cz + dz * e * 0.35 + dx * 0.12 * (e - 0.5));
  camera.lookAt(lx, 1.2, lz); if (camera.fov !== 58) { camera.fov = 58; camera.updateProjectionMatrix(); }
}
function frame(now) {
  requestAnimationFrame(frame);
  if (game._settingsFrameReset) { game._settingsFrameReset = false; last = now; }
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
  if (game.inRoom) game.update(dt); else lobbyCam(dt);
  if (world && world.update) world.update(dt, camera.position);
  renderer.clear(); renderer.render(scene, camera);
  if (game.inRoom && game.alive && game.vm && game.vm.group.visible) { renderer.clearDepth(); renderer.render(vmScene, vmCamera); }
}
requestAnimationFrame(frame);
ensureOnline().then(refreshRooms).catch(() => {});
window.__game = game; window.__three = { renderer, scene, camera };
