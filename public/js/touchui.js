// Mobile layer: fullscreen start gate + drag/resize/opacity UI editor for touch controls.
// Layout is stored as viewport fractions so it survives rotation and different phones.
const $ = (id) => document.getElementById(id);

export const CONTROLS = [
  { id: 't-stick', name: 'جوی‌استیک حرکت', x: 0.14, y: 0.76 },
  { id: 't-fire', name: 'شلیک', x: 0.88, y: 0.77 },
  { id: 't-fire2', name: 'شلیک دوم / چاقو', x: 0.72, y: 0.84 },
  { id: 't-jump', name: 'پرش', x: 0.94, y: 0.56 },
  { id: 't-crouch', name: 'نشستن', x: 0.84, y: 0.89 },
  { id: 't-scope', name: 'اسکوپ', x: 0.74, y: 0.66 },
  { id: 't-reload', name: 'ریلود', x: 0.64, y: 0.84 },
  { id: 't-use', name: 'عملیات / استفاده', x: 0.57, y: 0.73 },
  { id: 't-next', name: 'تعویض اسلحه', x: 0.52, y: 0.90 },
  { id: 't-nade', name: 'نارنجک', x: 0.46, y: 0.76 },
  { id: 't-drop', name: 'انداختن', x: 0.45, y: 0.90 },
  { id: 't-buy', name: 'خرید', x: 0.17, y: 0.34 },
  { id: 't-score', name: 'جدول امتیاز', x: 0.17, y: 0.23 },
  { id: 't-chat', name: 'چت', x: 0.34, y: 0.90 },
  { id: 't-pause', name: 'منو', x: 0.06, y: 0.08 },
  { id: 't-more', name: 'ابزارهای بیشتر', x: 0.30, y: 0.90 },
];
const DEF = Object.fromEntries(CONTROLS.map((c) => [c.id, { x: c.x, y: c.y, s: 1, o: 0.9, h: !!c.hidden }]));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function normalizeLayout(raw) {
  const out = {};
  for (const c of CONTROLS) {
    const d = DEF[c.id], v = raw && typeof raw[c.id] === 'object' ? raw[c.id] : {};
    // Old builds stored CSS strings ({l:'12px',t:'40px'}); those are discarded in favour of the new format.
    const ok = Number.isFinite(v.x) && Number.isFinite(v.y);
    out[c.id] = { x: ok ? clamp(v.x, 0.02, 0.98) : d.x, y: ok ? clamp(v.y, 0.03, 0.97) : d.y, s: clamp(Number(v.s) || d.s, 0.6, 1.8), o: clamp(Number(v.o) || d.o, 0.2, 1), h: typeof v.h === 'boolean' ? v.h : d.h };
  }
  return out;
}

export function applyLayout(layout, editing = false) {
  for (const c of CONTROLS) {
    const el = $(c.id); if (!el) continue; const v = layout[c.id];
    Object.assign(el.style, { left: v.x * 100 + '%', top: v.y * 100 + '%', right: 'auto', bottom: 'auto', transform: `translate(-50%,-50%) scale(${v.s})`, opacity: editing && v.h ? 0.35 : v.o });
    el.hidden = !editing && v.h; el.classList.toggle('ghost-hidden', editing && v.h);
  }
}

// ------------------------------------------------------------------ UI editor
export class TouchEditor {
  constructor({ getLayout, setLayout, onOpen, onClose }) {
    Object.assign(this, { getLayout, setLayout, onOpen, onClose });
    this.active = false; this.sel = null; this.draft = null; this.snap = true;
    this.bar = $('ui-editor'); this.drag = null;
    $('ue-size').addEventListener('input', (e) => this.patch({ s: +e.target.value }));
    $('ue-opacity').addEventListener('input', (e) => this.patch({ o: +e.target.value }));
    $('ue-hide').addEventListener('click', () => { if (this.sel) this.patch({ h: !this.draft[this.sel].h }); });
    $('ue-snap').addEventListener('click', () => { this.snap = !this.snap; this.syncBar(); });
    $('ue-reset').addEventListener('click', () => { this.draft = normalizeLayout({}); this.render(); });
    $('ue-cancel').addEventListener('click', () => this.close(false));
    $('ue-save').addEventListener('click', () => this.close(true));
    for (const c of CONTROLS) {
      const el = $(c.id); if (!el) continue;
      el.addEventListener('pointerdown', (e) => this.down(e, c.id), true);
    }
    addEventListener('pointermove', (e) => this.move(e), { passive: false });
    addEventListener('pointerup', () => { this.drag = null; });
    addEventListener('pointercancel', () => { this.drag = null; });
  }
  open() {
    this.active = true; this.draft = normalizeLayout(this.getLayout()); this.sel = 't-fire';
    $('touch').hidden = false; $('touch').classList.add('editing'); this.bar.hidden = false; document.body.classList.add('ui-editing');
    this.render(); this.onOpen && this.onOpen();
  }
  close(save) {
    if (!this.active) return; this.active = false; this.drag = null;
    if (save) this.setLayout(this.draft);
    $('touch').classList.remove('editing'); this.bar.hidden = true; document.body.classList.remove('ui-editing');
    for (const c of CONTROLS) $(c.id)?.classList.remove('ue-sel');
    applyLayout(normalizeLayout(this.getLayout())); this.onClose && this.onClose(save);
  }
  down(e, id) {
    if (!this.active) return; e.preventDefault(); e.stopPropagation();
    this.sel = id; const v = this.draft[id];
    this.drag = { id, px: e.clientX, py: e.clientY, x: v.x, y: v.y };
    try { e.target.setPointerCapture?.(e.pointerId); } catch {}
    this.render();
  }
  move(e) {
    if (!this.active || !this.drag) return; e.preventDefault();
    const d = this.drag; let x = d.x + (e.clientX - d.px) / innerWidth, y = d.y + (e.clientY - d.py) / innerHeight;
    if (this.snap) { x = Math.round(x * 80) / 80; y = Math.round(y * 50) / 50; }
    this.draft[d.id].x = clamp(x, 0.02, 0.98); this.draft[d.id].y = clamp(y, 0.03, 0.97); applyLayout(this.draft, true);
  }
  patch(p) { if (!this.sel) return; Object.assign(this.draft[this.sel], p); this.render(); }
  render() {
    applyLayout(this.draft, true);
    for (const c of CONTROLS) $(c.id)?.classList.toggle('ue-sel', c.id === this.sel);
    this.syncBar();
  }
  syncBar() {
    const c = CONTROLS.find((q) => q.id === this.sel), v = this.sel && this.draft[this.sel];
    $('ue-name').textContent = c ? c.name : 'یک دکمه را انتخاب کن';
    if (v) { $('ue-size').value = v.s; $('ue-opacity').value = v.o; $('ue-size-v').textContent = Math.round(v.s * 100) + '%'; $('ue-opacity-v').textContent = Math.round(v.o * 100) + '%'; $('ue-hide').textContent = v.h ? 'نمایش دکمه' : 'مخفی کردن'; }
    $('ue-snap').classList.toggle('on', this.snap);
  }
}

// ------------------------------------------------------------------ fullscreen gate
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
const canFullscreen = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
const standalone = () => matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || navigator.standalone;
export async function goFullscreen() {
  const d = document.documentElement;
  try { if (!fsEl()) await (d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : d.webkitRequestFullscreen()); } catch {}
  try { await screen.orientation?.lock?.('landscape'); } catch {}
}
export function setupGate({ touch, onEnter }) {
  const gate = $('gate'); if (!gate) return;
  if (!touch || standalone()) { gate.remove(); onEnter && onEnter(); return; }
  gate.hidden = false; document.body.classList.add('gated');
  let entered = false;
  $('gate-btn').addEventListener('click', async () => {
    await goFullscreen(); gate.hidden = true; document.body.classList.remove('gated');
    if (!entered) { entered = true; onEnter && onEnter(); }
  });
  if (!canFullscreen()) $('gate-sub').textContent = 'برای تمام‌صفحهٔ کامل در iPhone، بازی را با Add to Home Screen نصب کن.';
  // Leaving fullscreen (back gesture, notification…) brings the single button back.
  const onFs = () => { if (entered && canFullscreen() && !fsEl()) { gate.hidden = false; document.body.classList.add('gated'); } };
  document.addEventListener('fullscreenchange', onFs); document.addEventListener('webkitfullscreenchange', onFs);
}
