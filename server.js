// Counter-Strike: Dust II Online — authoritative game server (Express + Socket.IO).
import express from 'express';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import crypto from 'crypto';
import fs from 'fs';
import { ServerCore } from './shared/core.js';
import { TICK_RATE } from './shared/constants.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_KEY_FILE = path.join(root, '.admin-key');
function loadAdminKey(){ if(process.env.ADMIN_KEY) return process.env.ADMIN_KEY; try { if(fs.existsSync(ADMIN_KEY_FILE)) return fs.readFileSync(ADMIN_KEY_FILE,'utf8').trim(); } catch {} const k=crypto.randomBytes(18).toString('hex'); try { fs.writeFileSync(ADMIN_KEY_FILE,k,{mode:0o600}); } catch {} return k; }
const ADMIN_KEY = loadAdminKey();
const app = express();
app.disable('x-powered-by');
app.use('/shared', express.static(path.join(root, 'shared'), { maxAge: 0 }));
app.use(express.static(path.join(root, 'public'), { maxAge: 0 }));
app.get('/health', (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()), ...core.stats(), servers: core.list() }));
app.get('/admin', (_req, res) => res.sendFile(path.join(root, 'public', 'admin.html')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 5000, pingTimeout: 12000, perMessageDeflate: false, maxHttpBufferSize: 64 * 1024 });
const core = new ServerCore({ dataFile: path.join(root, 'server-data.json') });
if (process.env.DEFAULT_SERVERS !== '0') {
  const made = core.ensureDefaultServers([
    { title: 'Dust II · Public', map: 'dust2', bots: 'fill', difficulty: 'normal', max: 10 },
    { title: 'Mirage · Public', map: 'mirage', bots: 'fill', difficulty: 'normal', max: 10 },
    { title: 'Inferno · Public', map: 'inferno', bots: 'fill', difficulty: 'normal', max: 10 },
  ]);
  if (made) console.log(`  Created ${made} default public servers (disable with DEFAULT_SERVERS=0)`);
}

io.on('connection', (socket) => {
  const client = core.connect(socket.id, (ev, data) => (ev === 'snap' ? socket.volatile.emit(ev, data) : socket.emit(ev, data)), { ip: socket.handshake.address });
  let admin = false;
  socket.on('admin:auth', (key, ack) => {
    admin = typeof key === 'string' && key === ADMIN_KEY;
    if (admin) socket.emit('admin:status', { ok:true });
    if (typeof ack === 'function') ack({ ok: admin, error: admin ? null : 'invalid_admin_key' });
  });
  socket.on('admin:global', (data, ack) => { if (!admin) return ack?.({ok:false,error:'unauthorized'}); ack?.(core.adminGlobal(data?.action, data?.value)); });
  socket.on('admin:moderation', (ack) => { if (!admin) return ack?.({ok:false,error:'unauthorized'}); ack?.({ok:true, ...core.adminModeration()}); });
  socket.on('admin:list', (ack) => { if (!admin) return ack?.({ok:false,error:'unauthorized'}); ack?.({ok:true, rooms:core.adminRooms()}); });
  socket.on('admin:server', (data, ack) => { if (!admin) return ack?.({ok:false,error:'unauthorized'}); const d=data||{}; let r; if(d.action==='create') r=core.adminCreateServer(d.value); else if(d.action==='start') r=core.adminStartServer(d.code); else if(d.action==='stop') r=core.adminStopServer(d.code); else if(d.action==='delete') r=core.adminDeleteServer(d.code); else r={ok:false,error:'bad_action'}; ack?.(r); });
  socket.on('admin:get', (code, ack) => { if (!admin) return ack?.({ok:false,error:'unauthorized'}); ack?.(core.adminGet(code)); });
  socket.on('admin:player', (data, ack) => {
    if (!admin) return ack?.({ok:false,error:'unauthorized'});
    const d=data||{}; const r=core.adminPlayer(d.code,d.id,d.action,d.value); ack?.(r);
    if (r.ok) socket.emit('admin:changed', { code:d.code });
  });
  socket.on('admin:room', (data, ack) => {
    if (!admin) return ack?.({ok:false,error:'unauthorized'});
    const d=data||{}; const r=core.adminRoom(d.code,d.action,d.value); ack?.(r);
    if (r.ok) socket.emit('admin:changed', { code:d.code });
  });
  socket.onAny((ev, ...args) => {
    if (ev.startsWith('admin:')) return;
    const ack = typeof args[args.length - 1] === 'function' ? args.pop() : null; client.handle(ev, args[0], ack);
  });
  socket.on('disconnect', () => client.close());
});
// Drift-corrected fixed-rate loop (setInterval slowly drifts under load and makes the tick rate uneven).
const STEP = 1000 / TICK_RATE; let nextTick = Date.now();
(function loop() { const now = Date.now(); if (now - nextTick > 1000) nextTick = now; core.tick(); nextTick += STEP; setTimeout(loop, Math.max(0, nextTick - Date.now())); })();
function shutdown(sig) {
  console.log(`\n  ${sig}: saving data and closing…`);
  try { core.saveData(); } catch {}
  io.emit('server:closed', { reason: 'shutdown' }); io.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT')); process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => console.error('[uncaught]', e)); process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
server.on('error', (e) => { if (e.code === 'EADDRINUSE') { console.error(`\n  Port ${PORT} is already in use. Close the other server or run with PORT=3001.`); process.exit(1); } throw e; });

server.listen(PORT, HOST, () => {
  console.log(`\n  Counter-Strike: Dust II Online is running`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  Network: http://${n.address}:${PORT}   (share this with friends on your network)`);
  console.log(`  Tailscale: http://<your-tailscale-ip>:${PORT}`);
  console.log(`  Tailscale IP (if installed): run \"tailscale ip -4\"`);
  console.log(`  Admin:   http://localhost:${PORT}/admin`);
  console.log(`  Admin key: ${ADMIN_KEY}`);
  console.log('');
});
