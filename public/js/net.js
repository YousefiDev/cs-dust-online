// Two transports with the same API: native WebSocket (online) and an in-browser server core (offline practice).
function wsUrl() {
  const p = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${p}//${location.host}/ws`;
}

export async function connectOnline(onStatus) {
  const ws = new WebSocket(wsUrl());
  const listeners = new Map();
  const pending = new Map();
  let seq = 0;
  let opened = false;

  const emitLocal = (ev, data) => {
    for (const fn of listeners.get(ev) || []) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  };
  const on = (ev, fn) => {
    const list = listeners.get(ev) || [];
    list.push(fn);
    listeners.set(ev, list);
  };
  const off = (ev, fn) => {
    const list = listeners.get(ev) || [];
    listeners.set(ev, list.filter(x => x !== fn));
  };
  const emit = (ev, data, ack) => {
    if (ws.readyState !== WebSocket.OPEN) {
      if (typeof ack === 'function') ack({ ok: false, error: 'not_connected' });
      return;
    }
    const id = typeof ack === 'function' ? String(++seq) : undefined;
    if (id) pending.set(id, ack);
    try {
      ws.send(JSON.stringify({ id, event: ev, data }));
    } catch (e) {
      if (id) pending.delete(id);
      if (typeof ack === 'function') ack({ ok: false, error: 'send_failed' });
    }
  };

  ws.addEventListener('open', () => {
    opened = true;
    onStatus?.('ok', 'متصل به سرور');
    emitLocal('connect');
  });
  ws.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.ack !== undefined) {
      const fn = pending.get(String(msg.ack));
      if (fn) { pending.delete(String(msg.ack)); fn(msg.data); }
      return;
    }
    if (msg.event) emitLocal(msg.event, msg.data);
  });
  ws.addEventListener('close', () => {
    for (const fn of pending.values()) {
      try { fn({ ok: false, error: 'disconnected' }); } catch {}
    }
    pending.clear();
    onStatus?.('bad', 'اتصال قطع شد؛ تلاش دوباره…');
    emitLocal('disconnect');
  });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 9000);
    ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
    ws.addEventListener('error', () => {
      if (!opened) { clearTimeout(t); reject(new Error('connect_error')); }
    }, { once: true });
  });

  return {
    get id() { return ws._id || null; },
    offline: false,
    emit,
    on,
    off,
    close() { ws.close(); },
    connected: () => ws.readyState === WebSocket.OPEN,
    raw: {
      on,
      once(ev, fn) {
        const f = (...args) => { off(ev, f); fn(...args); };
        on(ev, f);
      },
      emit,
      get connected() { return ws.readyState === WebSocket.OPEN; }
    }
  };
}

export async function connectOffline() {
  const { ServerCore } = await import('/shared/core.js');
  const core = new ServerCore(), handlers = {}, queue = []; let scheduled = false;
  const flush = () => {
    scheduled = false;
    const q = queue.splice(0);
    for (const [ev, d] of q) {
      const l = handlers[ev];
      if (l) for (const f of l.slice()) f(d);
    }
  };
  const deliver = (ev, d) => {
    queue.push([ev, d]);
    if (!scheduled) { scheduled = true; queueMicrotask(flush); }
  };
  const id = 'local';
  const c = core.connect(id, (ev, d) => deliver(ev, structuredClone(d)), { offline: true });
  const timer = setInterval(() => core.tick(), 50);
  return {
    id, offline: true, core,
    emit(ev, d, ack) {
      c.handle(ev, d === undefined ? d : structuredClone(d), ack ? (r) => {
        queue.push(['__ack', () => ack(r)]);
        if (!scheduled) { scheduled = true; queueMicrotask(flush); }
      } : undefined);
    },
    on(ev, f) { (handlers[ev] = handlers[ev] || []).push(f); },
    off(ev, f) { handlers[ev] = (handlers[ev] || []).filter((x) => x !== f); },
    close() { clearInterval(timer); c.close(); },
    connected: () => true,
    _init() { this.on('__ack', (fn) => fn()); return this; },
  }._init();
}
