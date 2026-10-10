import { ServerCore } from './shared/core.js';
import { MAP_DEFS, registerCustomMaps } from './shared/maps.js';
import { dropNav } from './shared/nav.js';

// Pristine built-in maps (MAP_DEFS gets custom maps merged into it at runtime).
const BASE_DEFS = { ...MAP_DEFS };

const DEFAULT_SERVERS = [
  { title: 'Dust II · Public', map: 'dust2', bots: 'fill', difficulty: 'normal', max: 10 },
  { title: 'Mirage · Public', map: 'mirage', bots: 'fill', difficulty: 'normal', max: 10 },
  { title: 'Inferno · Public', map: 'inferno', bots: 'fill', difficulty: 'normal', max: 10 },
];

// A room broadcast calls send() once per player with the SAME data object. Serialise it once per tick
// instead of once per recipient (the cache is dropped at the end of the current synchronous run).
let sendCache = null;
function send(ws, event, data) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    let raw;
    if (sendCache && sendCache.data === data && sendCache.event === event) raw = sendCache.raw;
    else {
      raw = JSON.stringify({ event, data });
      if (data && typeof data === 'object') {
        if (!sendCache) queueMicrotask(() => { sendCache = null; });
        sendCache = { event, data, raw };
      }
    }
    ws.send(raw);
  } catch {}
}
function reply(ws, id, data) {
  if (id === undefined || id === null) return;
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ ack: id, data })); } catch {}
  }
}

export class GameServer {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Map();
    this.editorSockets = new Set();
    this.customMaps = {};
    this.readyDone = false;
    this.lastSaved = new Map();   // top-level data key -> last persisted JSON
    this.saveTimer = null;
    this.core = new ServerCore();
    this.core.onSaveData = () => this.scheduleSave();
    this.ready = this.boot(env);
    this.editorReady = this.ready;
    this.timer = setInterval(() => {
      if (this.readyDone) {
        try { this.core.tick(); } catch (e) { console.error('[tick]', e); }
      }
    }, 50);
  }

  // Load everything from Durable Object storage. Custom maps are registered BEFORE rooms are booted,
  // so servers that run an editor map come back on that map after every restart/redeploy.
  async boot(env) {
    try {
      const st = this.state.storage;
      const [custom, legacy, split] = await Promise.all([st.get('customMaps'), st.get('data'), st.list({ prefix: 'd:' })]);
      this.customMaps = custom || {};
      this.applyCustomMaps();
      let data = null;
      if (split.size) { data = {}; for (const [k, v] of split) { data[k.slice(2)] = v; this.lastSaved.set(k.slice(2), JSON.stringify(v)); } }
      else if (legacy) { data = legacy; this.scheduleSave(); } // migrate the old single-key format
      if (data) {
        this.core.data = {
          ...this.core.data, ...data,
          profiles: data.profiles || {}, permissions: data.permissions || {}, servers: data.servers || {},
          bans: data.bans || {}, mutes: data.mutes || {}, settings: data.settings || this.core.data.settings
        };
        this.core.rooms.clear();
        this.core.loadManagedRooms();
      } else if (env.DEFAULT_SERVERS !== '0') {
        this.core.ensureDefaultServers(DEFAULT_SERVERS);
      }
    } catch (e) { console.error('[boot]', e && e.message); }
    this.readyDone = true;
  }
  applyCustomMaps() { for (const id of registerCustomMaps(this.customMaps)) dropNav(id); }
  scheduleSave() { if (this.saveTimer) return; this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush().catch((e) => console.error('[save]', e && e.message)); }, 300); }
  // Writes only the top-level keys that changed (profiles XP no longer rewrites the server list, and vice versa).
  async flush() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const batch = {}, sigs = [];
    for (const [k, v] of Object.entries(this.core.data)) { const j = JSON.stringify(v); if (this.lastSaved.get(k) !== j) { batch['d:' + k] = v; sigs.push([k, j]); } }
    if (!sigs.length) return;
    await this.state.storage.put(batch);
    for (const [k, j] of sigs) this.lastSaved.set(k, j);
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/maps')) return this.handleMapsApi(request, url);
    if (url.pathname === '/editor-ws' && request.headers.get('Upgrade') === 'websocket') return this.editorWebSocket(request);
    if (url.pathname !== '/ws' || request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket endpoint', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const id = crypto.randomUUID();
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const conn = {
      id, ws: server, admin: false,
      core: this.core.connect(id, (ev, data) => send(server, ev, data), { ip })
    };
    this.sockets.set(id, conn);

    server.addEventListener('message', event => this.onMessage(conn, event.data));
    server.addEventListener('close', () => this.onClose(conn));
    server.addEventListener('error', () => this.onClose(conn));

    return new Response(null, { status: 101, webSocket: client });
  }


  async handleMapsApi(request, url) {
    await this.editorReady;
    const headers = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: { ...headers, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' } });
    if (url.pathname === '/api/maps/auth' && request.method === 'POST') {
      let body; try { body = await request.json(); } catch { return Response.json({ ok:false, error:'invalid_json' }, { status:400, headers }); }
      const ok = !!this.env.ADMIN_KEY && typeof body.key === 'string' && body.key === this.env.ADMIN_KEY;
      return Response.json({ ok, error: ok ? null : 'unauthorized' }, { status: ok ? 200 : 401, headers });
    }
    if (url.pathname === '/api/maps/definitions' && request.method === 'GET') return new Response(JSON.stringify(BASE_DEFS), { headers });
    if (url.pathname === '/api/maps/list' && request.method === 'GET') return new Response(JSON.stringify(Object.values(MAP_DEFS).map((d) => ({ id: d.id, name: d.name }))), { headers });
    if (url.pathname === '/api/maps/custom' && request.method === 'GET') return new Response(JSON.stringify(this.customMaps), { headers });
    if (url.pathname === '/api/maps/save' && request.method === 'POST') {
      let body; try { body = await request.json(); } catch { return Response.json({ ok:false, error:'invalid_json' }, { status:400, headers }); }
      if (!this.env.ADMIN_KEY || body.key !== this.env.ADMIN_KEY) return Response.json({ ok:false, error:'unauthorized' }, { status:401, headers });
      if (!body.maps || typeof body.maps !== 'object' || Array.isArray(body.maps)) return Response.json({ ok:false, error:'invalid_maps' }, { status:400, headers });
      const clean = {};
      for (const [id, def] of Object.entries(body.maps)) {
        if (!/^[a-z0-9_-]{2,32}$/.test(id) || !def || typeof def !== 'object' || def.id !== id || !Array.isArray(def.size) || !Array.isArray(def.areas) || !Array.isArray(def.crates)) return Response.json({ ok:false, error:'invalid_map:' + id }, { status:400, headers });
        clean[id] = def;
      }
      this.customMaps = clean; await this.state.storage.put('customMaps', clean); this.applyCustomMaps();
      this.broadcastEditor({ type:'maps-updated', maps: clean });
      return Response.json({ ok:true, count:Object.keys(clean).length }, { headers });
    }
    return Response.json({ ok:false, error:'not_found' }, { status:404, headers });
  }

  async editorWebSocket(request) {
    const pair = new WebSocketPair(); const client = pair[0], server = pair[1]; server.accept();
    const peer = { ws: server, id: crypto.randomUUID(), name: 'Player' + Math.floor(Math.random()*900+100) };
    this.editorSockets.add(peer);
    server.send(JSON.stringify({ type:'hello', id:peer.id, maps:this.customMaps, baseMaps:BASE_DEFS, peers:[...this.editorSockets].map(p=>({id:p.id,name:p.name})) }));
    this.broadcastEditor({ type:'peer-joined', peer:{id:peer.id,name:peer.name} }, peer);
    server.addEventListener('message', async e => {
      try {
        const m=JSON.parse(e.data);
        if (m.type==='join') { peer.name=String(m.name||peer.name).slice(0,24); this.broadcastEditor({type:'peer-name',peer:{id:peer.id,name:peer.name}}); }
        else if (m.type==='edit' && m.mapId && m.object) this.broadcastEditor({type:'edit', mapId:m.mapId, object:m.object, from:peer.id}, peer);
        else if (m.type==='live-map' && /^[a-z0-9_-]{2,32}$/.test(String(m.mapId||'')) && m.map && typeof m.map==='object' && m.map.id===m.mapId && Array.isArray(m.map.size) && Array.isArray(m.map.areas) && Array.isArray(m.map.crates)) this.broadcastEditor({type:'live-map',mapId:m.mapId,map:m.map,from:peer.id},peer);
        else if (m.type==='cursor') this.broadcastEditor({type:'cursor',from:peer.id,position:m.position},peer);
        else if (m.type==='snapshot-request') server.send(JSON.stringify({type:'snapshot',maps:this.customMaps,baseMaps:BASE_DEFS}));
      } catch {}
    });
    const close=()=>{this.editorSockets.delete(peer);this.broadcastEditor({type:'peer-left',id:peer.id});};
    server.addEventListener('close',close); server.addEventListener('error',close);
    return new Response(null,{status:101,webSocket:client});
  }
  broadcastEditor(message, except=null) { const raw=JSON.stringify(message); for(const p of this.editorSockets) if(p!==except && p.ws.readyState===WebSocket.OPEN) try{p.ws.send(raw)}catch{} }

  async onMessage(conn, raw) {
    await this.ready;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const ev = String(msg.event || '');
    const d = msg.data;
    const id = msg.id;

    try {
      if (ev === 'admin:auth') {
        conn.admin = typeof d === 'string' && d === this.env.ADMIN_KEY;
        if (conn.admin) send(conn.ws, 'admin:status', { ok: true });
        return reply(conn.ws, id, { ok: conn.admin, error: conn.admin ? null : 'invalid_admin_key' });
      }

      if (ev.startsWith('admin:')) {
        if (!conn.admin) return reply(conn.ws, id, { ok: false, error: 'unauthorized' });
        let r, durable = false, listChanged = false;
        if (ev === 'admin:player') r = this.core.adminPlayer(d?.code, d?.id, d?.action, d?.value);   // hot path: no storage work, no broadcast
        else if (ev === 'admin:get') r = this.core.adminGet(d);
        else if (ev === 'admin:list') r = { ok: true, rooms: this.core.adminRooms() };
        else if (ev === 'admin:moderation') r = { ok: true, ...this.core.adminModeration() };
        else if (ev === 'admin:global') { r = this.core.adminGlobal(d?.action, d?.value); durable = true; }
        else if (ev === 'admin:server') {
          const v = d || {};
          if (v.action === 'create') r = this.core.adminCreateServer(v.value);
          else if (v.action === 'start') r = this.core.adminStartServer(v.code);
          else if (v.action === 'stop') r = this.core.adminStopServer(v.code);
          else if (v.action === 'delete') r = this.core.adminDeleteServer(v.code);
          else r = { ok: false, error: 'bad_action' };
          durable = listChanged = true;
        } else if (ev === 'admin:room') {
          r = this.core.adminRoom(d?.code, d?.action, d?.value);
          durable = ['bots', 'difficulty', 'max', 'weaponLimit'].includes(d?.action);
        } else r = { ok: false, error: 'bad_action' };
        // Server list / bans / settings must be on disk before we confirm, so a restart can never lose them.
        if (durable) await this.flush();
        reply(conn.ws, id, r);
        if (listChanged) for (const c of this.sockets.values()) if (c.admin && c !== conn) send(c.ws, 'admin:changed', { code: d?.code || r?.server?.code || null });
        return;
      }

      const ack = result => reply(conn.ws, id, result);
      conn.core.handle(ev, d, ack);
    } catch (e) {
      console.error('[worker]', ev, e);
      reply(conn.ws, id, { ok: false, error: 'Server error' });
    }
  }

  onClose(conn) {
    if (!this.sockets.has(conn.id)) return;
    this.sockets.delete(conn.id);
    try { conn.core.close(); } catch {}
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type'
    };

    // These lightweight endpoints are handled directly by the Worker. This makes
    // deployment/routing diagnosable without depending on the Durable Object API router.
    if (url.pathname === '/api/maps/health') {
      return Response.json({ ok: true, service: 'cs-dust-online', route: 'worker-api', authConfigured: !!env.ADMIN_KEY }, { headers });
    }
    if (url.pathname === '/api/maps/auth') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405, headers });
      let body;
      try { body = await request.json(); }
      catch { return Response.json({ ok: false, error: 'invalid_json' }, { status: 400, headers }); }
      const ok = !!env.ADMIN_KEY && typeof body.key === 'string' && body.key === env.ADMIN_KEY;
      return Response.json({ ok, error: ok ? null : 'unauthorized' }, { status: ok ? 200 : 401, headers });
    }

    if (url.pathname === '/ws' || url.pathname === '/editor-ws' || url.pathname === '/api/maps' || url.pathname.startsWith('/api/maps/')) {
      const id = env.GAME.idFromName('global');
      return env.GAME.get(id).fetch(request);
    }
    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'cs-dust-online', runtime: 'cloudflare-durable-object' });
    }
    return env.ASSETS.fetch(request);
  }
};
