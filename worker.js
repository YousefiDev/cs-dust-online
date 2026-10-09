import { ServerCore } from './shared/core.js';

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
    if (url.pathname === '/api/maps/custom' && request.method === 'GET') {
      const maps = await this.state.storage.get('editorMaps') || {};
      return Response.json(Object.values(maps));
    }
    if (url.pathname === '/api/maps/save' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return Response.json({ok:false,error:'invalid_json'}, {status:400}); }
      const def = body?.map;
      if (!def || !/^[a-z0-9_-]{2,40}$/.test(String(def.id || '')) || !Array.isArray(def.areas) || !Array.isArray(def.crates) || !def.spawns) {
        return Response.json({ok:false,error:'invalid_map_definition'}, {status:400});
      }
      const maps = await this.state.storage.get('editorMaps') || {};
      maps[def.id] = structuredClone(def);
      await this.state.storage.put('editorMaps', maps);
      const packet = JSON.stringify({type:'map-saved', map:def, by: body.by || 'editor'});
      for (const ws of this.editorSockets) { try { if (ws.readyState === WebSocket.OPEN) ws.send(packet); } catch {} }
      return Response.json({ok:true, map:def});
    }
    if (url.pathname !== '/editor-ws' || request.headers.get('Upgrade') !== 'websocket') {
      if (url.pathname !== '/ws' || request.headers.get('Upgrade') !== 'websocket') return new Response('Not found', { status: 404 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    if (url.pathname === '/editor-ws') {
      this.editorSockets.add(server);
      server.addEventListener('message', async event => {
        let packet;
        try { packet = JSON.parse(event.data); } catch { return; }
        if (packet.type === 'hello') {
          const maps = await this.state.storage.get('editorMaps') || {};
          try { server.send(JSON.stringify({type:'hello', maps:Object.values(maps)})); } catch {}
        } else if (packet.type === 'edit' && packet.map && packet.map.id) {
          const maps = await this.state.storage.get('editorMaps') || {};
          maps[packet.map.id] = structuredClone(packet.map);
          await this.state.storage.put('editorMaps', maps);
          const out = JSON.stringify({type:'edit', map:packet.map, by:packet.by || 'editor'});
          for (const ws of this.editorSockets) if (ws !== server) { try { if (ws.readyState === WebSocket.OPEN) ws.send(out); } catch {} }
        }
      });
      const cleanup = () => this.editorSockets.delete(server);
      server.addEventListener('close', cleanup);
      server.addEventListener('error', cleanup);
      return new Response(null, { status: 101, webSocket: client });
    }

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
