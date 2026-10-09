import { ServerCore } from './shared/core.js';
import { MAP_DEFS } from './public/shared/maps.js';

const DEFAULT_SERVERS = [
  { title: 'Dust II · Public', map: 'dust2', bots: 'fill', difficulty: 'normal', max: 10 },
  { title: 'Mirage · Public', map: 'mirage', bots: 'fill', difficulty: 'normal', max: 10 },
  { title: 'Inferno · Public', map: 'inferno', bots: 'fill', difficulty: 'normal', max: 10 },
];

function send(ws, event, data) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ event, data })); } catch {}
  }
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
    this.editorReady = this.state.storage.get('customMaps').then(v => { this.customMaps = v || {}; });
    this.readyDone = false;
    this.core = new ServerCore();
    this.core.onSaveData = (data) => this.state.storage.put('data', structuredClone(data));
    this.ready = this.state.storage.get('data').then(data => {
      if (data) {
        this.core.data = {
          ...this.core.data,
          ...data,
          profiles: data.profiles || {},
          permissions: data.permissions || {},
          servers: data.servers || {},
          bans: data.bans || {},
          mutes: data.mutes || {},
          settings: data.settings || this.core.data.settings
        };
        this.core.rooms.clear();
        this.core.loadManagedRooms();
      } else if (env.DEFAULT_SERVERS !== '0') {
        this.core.ensureDefaultServers(DEFAULT_SERVERS);
      }
      this.readyDone = true;
    });
    this.timer = setInterval(() => {
      if (this.readyDone) {
        try { this.core.tick(); } catch (e) { console.error('[tick]', e); }
      }
    }, 50);
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
    if (url.pathname === '/api/maps/definitions' && request.method === 'GET') return new Response(JSON.stringify(MAP_DEFS), { headers });
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
      this.customMaps = clean; await this.state.storage.put('customMaps', clean);
      this.broadcastEditor({ type:'maps-updated', maps: clean });
      return Response.json({ ok:true, count:Object.keys(clean).length }, { headers });
    }
    return Response.json({ ok:false, error:'not_found' }, { status:404, headers });
  }

  async editorWebSocket(request) {
    const pair = new WebSocketPair(); const client = pair[0], server = pair[1]; server.accept();
    const peer = { ws: server, id: crypto.randomUUID(), name: 'Player' + Math.floor(Math.random()*900+100) };
    this.editorSockets.add(peer);
    server.send(JSON.stringify({ type:'hello', id:peer.id, maps:this.customMaps, baseMaps:MAP_DEFS, peers:[...this.editorSockets].map(p=>({id:p.id,name:p.name})) }));
    this.broadcastEditor({ type:'peer-joined', peer:{id:peer.id,name:peer.name} }, peer);
    server.addEventListener('message', async e => {
      try {
        const m=JSON.parse(e.data);
        if (m.type==='join') { peer.name=String(m.name||peer.name).slice(0,24); this.broadcastEditor({type:'peer-name',peer:{id:peer.id,name:peer.name}}); }
        else if (m.type==='edit' && m.mapId && m.object) this.broadcastEditor({type:'edit', mapId:m.mapId, object:m.object, from:peer.id}, peer);
        else if (m.type==='live-map' && /^[a-z0-9_-]{2,32}$/.test(String(m.mapId||'')) && m.map && typeof m.map==='object' && m.map.id===m.mapId && Array.isArray(m.map.size) && Array.isArray(m.map.areas) && Array.isArray(m.map.crates)) this.broadcastEditor({type:'live-map',mapId:m.mapId,map:m.map,from:peer.id},peer);
        else if (m.type==='cursor') this.broadcastEditor({type:'cursor',from:peer.id,position:m.position},peer);
        else if (m.type==='snapshot-request') server.send(JSON.stringify({type:'snapshot',maps:this.customMaps,baseMaps:MAP_DEFS}));
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
        let r;
        if (ev === 'admin:global') r = this.core.adminGlobal(d?.action, d?.value);
        else if (ev === 'admin:moderation') r = { ok: true, ...this.core.adminModeration() };
        else if (ev === 'admin:list') r = { ok: true, rooms: this.core.adminRooms() };
        else if (ev === 'admin:get') r = this.core.adminGet(d);
        else if (ev === 'admin:server') {
          const v = d || {};
          if (v.action === 'create') r = this.core.adminCreateServer(v.value);
          else if (v.action === 'start') r = this.core.adminStartServer(v.code);
          else if (v.action === 'stop') r = this.core.adminStopServer(v.code);
          else if (v.action === 'delete') r = this.core.adminDeleteServer(v.code);
          else r = { ok: false, error: 'bad_action' };
        } else if (ev === 'admin:player') {
          r = this.core.adminPlayer(d?.code, d?.id, d?.action, d?.value);
        } else if (ev === 'admin:room') {
          r = this.core.adminRoom(d?.code, d?.action, d?.value);
        } else {
          r = { ok: false, error: 'bad_action' };
        }
        this.core.saveData();
        reply(conn.ws, id, r);
        for (const c of this.sockets.values()) if (c.admin) send(c.ws, 'admin:changed', { code: d?.code || r?.server?.code || null });
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
    if (url.pathname === '/ws' || url.pathname === '/editor-ws' || url.pathname.startsWith('/api/maps/')) {
      const id = env.GAME.idFromName('global');
      return env.GAME.get(id).fetch(request);
    }
    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'cs-dust-online', runtime: 'cloudflare-durable-object' });
    }
    return env.ASSETS.fetch(request);
  }
};
