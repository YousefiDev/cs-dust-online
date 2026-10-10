// Transport-agnostic server core: rooms, lobby and routing. Used by server.js (Socket.IO) and the offline mode.
import { GameRoom } from './game.js';
import { MAP_DEFS, MAP_LIST } from './maps.js';
import { RANKS, rankForXp, rankIndex } from './ranks.js';

// The same core runs in Node and in the browser's offline practice mode.
// Static Node imports make every browser import fail before the lobby loads.
const RUNNING_IN_BROWSER = typeof window !== 'undefined';
const RUNNING_IN_NODE = typeof process !== 'undefined' && !!process.versions?.node;
const fsModule = RUNNING_IN_NODE ? await import('node:fs') : null;
const pathModule = RUNNING_IN_NODE ? await import('node:path') : null;
const fs = fsModule?.default || fsModule;
const path = pathModule?.default || pathModule;
const CTRL = /[<>\x00-\x1f]/g;
const cleanName = (v) => String(v || '').replace(CTRL, '').trim().slice(0, 16) || 'Player';
const makeCode = () => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };
const LIMITS = { st: 70, shot: 25 };

export class ServerCore {
  constructor(opts = {}) {
    this.clients = new Map(); this.rooms = new Map();
    // Keep persistence beside the app even when the server is started from
    // another working directory.
    this.dataFile = opts.dataFile || (RUNNING_IN_BROWSER ? 'cs-dust-online-data' : RUNNING_IN_NODE ? path.join(process.cwd(), 'server-data.json') : 'cs-dust-online-data');
    this.data = { bans: {}, mutes: {}, profiles: {}, permissions: {}, servers: {}, settings: { weaponLimits: { awp: 0, sg553: 0, aug: 0 } } };
    try {
      const raw = RUNNING_IN_BROWSER ? localStorage.getItem(this.dataFile) : RUNNING_IN_NODE ? (fs.existsSync(this.dataFile) ? fs.readFileSync(this.dataFile, 'utf8') : null) : null;
      if (raw) this.data = { ...this.data, ...JSON.parse(raw) };
      this.data.profiles ||= {}; this.data.permissions ||= {}; this.data.servers ||= {};
    } catch {}
    this.out = (id, ev, d) => { const c = this.clients.get(id); if (c) c.send(ev, d); };
    this.loadManagedRooms();
  }
  saveData() {
    try {
      // A host-provided persistence hook (Cloudflare Durable Object) always wins, whatever globals the runtime exposes.
      if (typeof this.onSaveData === 'function') { this.onSaveData(this.data); return; }
      const raw = JSON.stringify(this.data, null, 2);
      if (RUNNING_IN_BROWSER) localStorage.setItem(this.dataFile, raw);
      else if (RUNNING_IN_NODE) fs.writeFileSync(this.dataFile, raw);
    } catch (e) {
      console.error('[data]', e && e.message);
    }
  }
  profile(name) { const k=String(name||'').toLowerCase(); return this.data.profiles[k] ||= { xp:0 }; }
  playerProfile(name) { const k=String(name||'').toLowerCase(); const pr=this.profile(k); const xp=Number(pr.xp)||0; const r=rankForXp(xp); return { name:k, xp, rank:r.name, rankTag:r.tag, rankIndex:rankIndex(xp), nextXp:RANKS[rankIndex(xp)+1]?.xp||null }; }
  addXp(name, amount) { const pr=this.profile(name); pr.xp=Math.max(0,Math.round((Number(pr.xp)||0)+(Number(amount)||0))); this.saveData(); return this.playerProfile(name); }
  connect(id, send, meta = {}) {
    const c = { id, send, name: 'Player', session: '', room: null, ip: meta.ip || '', offline: !!meta.offline, bucket: {}, bucketAt: Date.now() }; this.clients.set(id, c);
    return { handle: (ev, d, ack) => this.handle(c, ev, d, ack), close: () => this.disconnect(c) };
  }
  disconnect(c) {
    // Online players get a grace period so a flaky mobile connection can resume the same player.
    const r = c.room && this.rooms.get(c.room);
    if (r && !c.offline && c.session) r.markDisconnected(c.id); else this.leave(c);
    c.room = null; this.clients.delete(c.id);
  }
  leave(c) { const r = c.room && this.rooms.get(c.room); if (r) r.removePlayer(c.id); c.room = null; }
  list() { return [...this.rooms.values()].map((r) => r.summary()).sort((a, b) => b.humans - a.humans); }
  makeRoomConfig(d = {}, code = null) { const c = code || makeCode(); return { code:c, title:cleanName(d.title || 'Community Server').slice(0,24), map:MAP_DEFS[d.map] ? d.map : 'dust2', bots:d.bots === 'none' ? 'none' : 'fill', difficulty:['easy','normal','hard'].includes(d.difficulty) ? d.difficulty : 'normal', max:Math.max(2, Math.min(16, Number(d.max)||10)), weaponLimits:{awp:0,sg553:0,aug:0}, enabled:true, createdAt:Date.now() }; }
  bootRoom(cfg) { if (!cfg || !cfg.enabled || this.rooms.has(cfg.code)) return null; try { return this.bootRoomUnsafe(cfg); } catch (e) { console.error('[boot]', cfg.code, cfg.map, e && e.message); if (cfg.map !== 'dust2') { try { return this.bootRoomUnsafe({ ...cfg, map: 'dust2' }); } catch (e2) { console.error('[boot-fallback]', e2 && e2.message); } } return null; } }
  bootRoomUnsafe(cfg) { const room = new GameRoom({ code:cfg.code, map:cfg.map, title:cfg.title, bots:cfg.bots, difficulty:cfg.difficulty, max:cfg.max, weaponLimits:{...(this.data.settings?.weaponLimits||{}), ...(cfg.weaponLimits||{})}, profiles:this.data.profiles, moderation:this.data, saveData:()=>this.saveData(), addXp:(name,n)=>this.addXp(name,n) }, this.out); this.rooms.set(cfg.code, room); return room; }
  loadManagedRooms() { for (const cfg of Object.values(this.data.servers || {})) if (cfg.enabled) this.bootRoom(cfg); }
  ensureDefaultServers(list) {
    // First boot: create public servers so friends can join right away without opening the admin panel.
    if (Object.keys(this.data.servers || {}).length) return 0; let n = 0;
    for (const v of list) { const cfg = this.makeRoomConfig(v); this.data.servers[cfg.code] = cfg; this.bootRoom(cfg); n++; }
    this.saveData(); return n;
  }
  limited(c, ev) {
    const now = Date.now(); if (now - c.bucketAt > 1000) { c.bucket = {}; c.bucketAt = now; }
    const k = LIMITS[ev] ? ev : 'other'; c.bucket[k] = (c.bucket[k] || 0) + 1; return c.bucket[k] > (LIMITS[ev] || 30);
  }
  handle(c, ev, d, ack) {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      if (this.limited(c, ev)) return;
      switch (ev) {
        case 'hello': c.name = cleanName(d && d.name); if (d && typeof d.session === 'string') c.session = d.session.replace(/[^\w-]/g, '').slice(0, 64); if (this.isBanned(c.name, c.ip)) return reply({ ok:false, error:'BANNED' }); return reply({ ok: true, id: c.id, t: Date.now(), maps: MAP_LIST });
        case 'ping': return reply(Date.now());
        case 'rooms': return reply(this.list());
        case 'create': { if (!c.offline) return reply({ ok:false, error:'SERVER_CREATION_DISABLED' }); this.leave(c); if (d && d.name) c.name=cleanName(d.name); let code=makeCode(); while(this.rooms.has(code)) code=makeCode(); const room=new GameRoom({code,map:MAP_DEFS[d?.map]?d.map:'dust2',title:'Practice',bots:'fill',difficulty:d?.difficulty,max:d?.max,profiles:this.data.profiles,moderation:this.data,saveData:()=>this.saveData(),addXp:(name,n)=>this.addXp(name,n)},this.out); this.rooms.set(code,room); c.room=code; room.addHuman(c.id,c.name); return reply({ok:true,code}); }
        case 'join': {
          const code = String(d && d.code || '').trim().toUpperCase(); const room = this.rooms.get(code);
          if (!room) return reply({ ok: false, error: 'Room not found' });
          if (room.humans().length >= room.maxPlayers) return reply({ ok: false, error: 'Room is full' });
          if (d && d.name) c.name = cleanName(d.name);
          if (this.isBanned(c.name, c.ip)) return reply({ ok:false, error:'BANNED' });
          if (d && typeof d.session === 'string') c.session = d.session.replace(/[^\w-]/g, '').slice(0, 64);
          if (c.room !== code) {
            this.leave(c);
            const prev = c.session && room.findSession(c.session);
            if (prev && prev.id !== c.id) {
              const old = this.clients.get(prev.id); if (old) { old.room = null; old.send('server:closed', { code, reason: 'resumed_elsewhere' }); }
              c.room = code; room.resume(prev.id, c.id); return reply({ ok: true, code, resumed: true });
            }
            c.room = code; room.addHuman(c.id, c.name, c.session);
          }
          return reply({ ok: true, code });
        }
        case 'leave': this.leave(c); return reply({ ok: true });
        default: { const r = c.room && this.rooms.get(c.room); if (r) r.handle(c.id, ev, d, reply); }
      }
    } catch (e) { console.error('[core]', ev, e); reply({ ok: false, error: 'Server error' }); }
  }
  adminRooms() { const out=[]; for(const cfg of Object.values(this.data.servers||{})){ const r=this.rooms.get(cfg.code); out.push(r ? {...r.summary(), managed:true, enabled:true} : {code:cfg.code,title:cfg.title,map:cfg.map,max:cfg.max,humans:0,bots:0,phase:'offline',round:0,score:{T:0,CT:0},botMode:cfg.bots,difficulty:cfg.difficulty,managed:true,enabled:false}); } return out.sort((a,b)=>(b.enabled-a.enabled)||(b.humans-a.humans)); }
  adminCreateServer(value) { let cfg=this.makeRoomConfig(value||{}); while(this.data.servers[cfg.code]) cfg=this.makeRoomConfig(value||{}); this.data.servers[cfg.code]=cfg; this.saveData(); const r=this.bootRoom(cfg); return r ? {ok:true,server:r.summary()} : {ok:false,error:'server_create_failed'}; }
  adminStartServer(code) { const cfg=this.data.servers[String(code||'').toUpperCase()]; if(!cfg) return {ok:false,error:'server_not_found'}; cfg.enabled=true; this.saveData(); const r=this.bootRoom(cfg); return {ok:true,server:r?.summary()||this.rooms.get(cfg.code)?.summary()}; }
  adminStopServer(code) { const c=String(code||'').toUpperCase(), cfg=this.data.servers[c]; if(!cfg) return {ok:false,error:'server_not_found'}; const r=this.rooms.get(c); if(r) { for(const p of [...r.humans()]) { const cl=this.clients.get(p.id); if(cl){ cl.room=null; cl.send('server:closed',{code:c}); } } this.rooms.delete(c); } cfg.enabled=false; this.saveData(); return {ok:true}; }
  adminDeleteServer(code) { const c=String(code||'').toUpperCase(); if(!this.data.servers[c]) return {ok:false,error:'server_not_found'}; this.adminStopServer(c); delete this.data.servers[c]; this.saveData(); return {ok:true}; }
  adminGet(code) { const r=this.rooms.get(String(code||'').toUpperCase()); return r ? { ok:true, room:r.summary(), players:r.adminRoster() } : {ok:false,error:'room_not_found'}; }
  adminPlayer(code,id,action,value) { const c=String(code||'').toUpperCase(), r=this.rooms.get(c); if(!r) return {ok:false,error:'room_not_found'}; const res=r.adminSet(id,action,value); if(res.kicked){ const cl=this.clients.get(String(id)); if(cl){ cl.room=null; cl.send('server:closed',{code:c,reason:'kicked'}); } } return res; }
  adminProfiles() { const names=new Set(Object.keys(this.data.profiles)); return [...names].map(name=>this.playerProfile(name)); }
  adminModeration() { return { permissions:Object.entries(this.data.permissions||{}).map(([name,v])=>({name,...v})), profiles: this.adminProfiles(), bans: Object.entries(this.data.bans).map(([name,v]) => ({name,...v})), mutes: Object.keys(this.data.mutes) }; }
  isBanned(name, ip='') { const k=String(name||'').toLowerCase(); return !!(this.data.bans[k] || (ip && this.data.bans['ip:'+ip])); }
  adminGlobal(action, value) {
    const d=value||{}; const name=String(d.name||'').trim().toLowerCase();
    if (action==='ban' || action==='unban') { if(!name) return {ok:false,error:'name_required'}; if(action==='ban') this.data.bans[name]={reason:String(d.reason||'Banned by admin').slice(0,120), at:Date.now()}; else delete this.data.bans[name]; this.saveData(); for(const r of this.rooms.values()) for(const p of r.list) if(!p.bot && String(p.name).toLowerCase()===name && action==='ban') { const cl=this.clients.get(p.id); r.adminSet(p.id,'kick',true); if(cl){ cl.room=null; cl.send('server:closed',{code:r.code,reason:'banned'}); } } return {ok:true}; }
    if (action==='xp') {
      if (!name) return {ok:false,error:'name_required'};
      const xp = Number(d.xp);
      if (!Number.isFinite(xp)) return {ok:false,error:'bad_xp'};
      const profile = this.profile(name);
      profile.xp = Math.round(Math.max(0, Math.min(999999, xp)));
      this.saveData();
      for (const r of this.rooms.values()) r.refreshPlayerProfile(name);
      return {ok:true, profile:this.playerProfile(name)};
    }
    if (action==='permission') {
      if (!name) return {ok:false,error:'name_required'};
      const role = String(d.role || 'none').toLowerCase();
      if (!['owner','admin','moderator','none'].includes(role)) return {ok:false,error:'bad_role'};
      if (role === 'none') delete this.data.permissions[name];
      else this.data.permissions[name] = { role, updatedAt: Date.now() };
      this.saveData();
      return {ok:true};
    }
    return {ok:false,error:'bad_action'};
  }
  adminRoom(code,action,value) {
    const key=String(code||'').toUpperCase(), r=this.rooms.get(key), cfg=this.data.servers[key];
    if (!r) return {ok:false,error:'room_not_found'};
    const result=r.adminRoom(action,value);
    if (result.ok && cfg) {
      cfg.max=r.maxPlayers; cfg.difficulty=r.difficulty; cfg.bots=r.botMode; cfg.weaponLimits={...r.weaponLimits};
      this.saveData();
    }
    return result;
  }
  tick() { for (const r of this.rooms.values()) { try { if (r.players.size && r.humans().length) r.tick(); else r.last = Date.now(); } catch (e) { console.error('[tick]', r.code, e); } } }
  stats() { let humans = 0, bots = 0; for (const r of this.rooms.values()) for (const p of r.players.values()) p.bot ? bots++ : humans++; return { rooms: this.rooms.size, clients: this.clients.size, humans, bots }; }
}
