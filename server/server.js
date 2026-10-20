// MAUR server -- one Node process: the game's static files (for local play;
// nginx serves them in production), GET /api/health, and the WebSocket on
// /ws where the rooms live. Every room runs its own authoritative
// simulation; clients send inputs and draw the snapshots they get back.
// The persistent worlds (PERSIST_WORLDS) are rooms too, made at boot from
// their saves in DATA_DIR, asleep while nobody is in them; the CPU every
// running room uses is watched, and over CPU_BUDGET_MS new matches and
// joins are turned away.
//   cd server && npm install && npm start      (PORT 3006, HOST 127.0.0.1)
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const cfg = require('./config');
const { Room, STEP_MS, MODES, FACTIONS } = require('./room');
const store = require('./store');
const P = require(path.join(cfg.JS_DIR, 'netproto.js'));

const started = Date.now();
const log = msg => console.log(new Date().toISOString().slice(0, 19).replace('T', ' ') + '  ' + msg);

const rooms = new Map();   // code -> Room (the matches and the persistent worlds)
const worlds = [];         // the persistent worlds, in PERSIST_WORLDS order
const conns = new Set();   // every live connection (client objects)
let nextConnId = 1;

// the server's load: the CPU the running rooms spent, in ms per 16.7 ms
// frame, summed over the rooms and smoothed over a few seconds
const load = { ms: 0, busy: new Map(), at: Date.now() };
setInterval(() => {
  const now = Date.now(), frames = (now - load.at) / STEP_MS;
  load.at = now;
  let ms = 0;
  for (const r of rooms.values()) {
    const b = r.stats.busyMs, was = load.busy.has(r) ? load.busy.get(r) : b;
    load.busy.set(r, b);
    if (frames > 0) ms += (b - was) / frames;
  }
  for (const r of load.busy.keys()) if (!rooms.has(r.code) || rooms.get(r.code) !== r) load.busy.delete(r);
  load.ms = load.ms * 0.6 + ms * 0.4;
}, 1000).unref();
// over the budget: no new matches, no newcomers (players coming back are let in)
const serverFull = () => load.ms > cfg.CPU_BUDGET_MS;
const matchCount = () => [...rooms.values()].filter(r => !r.world).length;

// ---------------------------------------------------------------------------
// HTTP: health, dev stats, static files (only the game's own: index.html, js/)
// ---------------------------------------------------------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };
const STATIC_OK = /^\/(index\.html|js\/[A-Za-z0-9_-]+\.js)$/;

function countPlayers() {
  let n = 0;
  for (const r of rooms.values()) n += r.connectedSlots().length;
  return n;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); res.end(); return; }
  const p = url.pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  if (p === '/api/health') {
    sendJson(res, 200, {
      ok: true, rooms: matchCount(), players: countPlayers(), uptime: Math.round((Date.now() - started) / 1000),
      load: +load.ms.toFixed(2), budget: cfg.CPU_BUDGET_MS, full: serverFull(),
      worlds: worlds.filter(w => !w.closed).map(w => Object.assign({ tick: w.sim ? w.sim.G.tick : 0 }, w.listing())),
    });
    return;
  }
  if (p === '/api/stats' && cfg.DEV) {
    const cpu = process.cpuUsage();
    sendJson(res, 200, {
      uptime: (Date.now() - started) / 1000, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
      rssMB: Math.round(process.memoryUsage().rss / 1048576), load: load.ms,
      rooms: [...rooms.values()].filter(r => !r.world).map(r => r.info()), worlds: worlds.map(w => w.info()),
      conns: [...conns].map(c => ({ id: c.id, room: c.room ? c.room.code : null, sentBytes: c.sentBytes,
        wireBytes: c.ws._socket ? c.ws._socket.bytesWritten : 0, msgs: c.sentMsgs })),
    });
    return;
  }
  const file = p === '/' ? '/index.html' : p;
  if (!STATIC_OK.test(file)) { res.writeHead(404); res.end('not found'); return; }
  const full = path.join(cfg.STATIC_DIR, file);
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

// ---------------------------------------------------------------------------
// WebSocket on exactly /ws
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 4096,               // clients only send small things
  perMessageDeflate: {             // snapshots are JSON: deflate them on the wire
    threshold: 200,
    zlibDeflateOptions: { level: 3 },
    concurrencyLimit: 4,
  },
});

server.on('upgrade', (req, socket, head) => {
  let p = '';
  try { p = new URL(req.url, 'http://x').pathname; } catch (e) { /* bad url */ }
  if (p !== '/ws' || conns.size >= cfg.MAX_CONNS) {
    socket.write('HTTP/1.1 ' + (p !== '/ws' ? '404 Not Found' : '503 Service Unavailable') + '\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

// rate limit: a token bucket per connection (inputs come at most once a
// frame); a client that keeps flooding is cut off
const BUCKET = 160, REFILL = 90;   // messages, messages per second

wss.on('connection', ws => {
  const cl = {
    id: nextConnId++, ws, name: '', room: null, slot: null, ready: false,
    delta: null, events: [], focus: { x: 0, y: 0 }, cam: null,
    tokens: BUCKET, tokT: Date.now(), dropped: 0, alive: true, hello: false,
    sentBytes: 0, sentMsgs: 0,
    send(obj) {
      if (ws.readyState !== 1) return;
      const s = JSON.stringify(obj);
      this.sentBytes += s.length; this.sentMsgs++;
      ws.send(s);
    },
  };
  conns.add(cl);
  ws.on('pong', () => { cl.alive = true; });
  ws.on('message', (data, isBinary) => {
    // budget
    const now = Date.now();
    cl.tokens = Math.min(BUCKET, cl.tokens + (now - cl.tokT) * REFILL / 1000);
    cl.tokT = now;
    if (cl.tokens < 1) {
      if (++cl.dropped > 400) { ws.close(1008, 'flood'); }
      return;
    }
    cl.tokens--;
    if (isBinary) return;
    let m;
    try { m = JSON.parse(data.toString()); } catch (e) { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    try { handle(cl, m); } catch (e) { log(`message ${m.t} from #${cl.id} failed: ${e && e.stack || e}`); }
  });
  ws.on('close', () => {
    conns.delete(cl);
    if (cl.room) cl.room.lost(cl);
  });
  ws.on('error', () => {});
});

// heartbeat: a socket that stops answering pings is closed (its slot waits)
setInterval(() => {
  for (const cl of conns) {
    if (!cl.alive) { cl.ws.terminate(); continue; }
    cl.alive = false;
    try { cl.ws.ping(); } catch (e) { /* closing */ }
  }
}, 30000).unref();

const bool = v => v === true || v === 1;
const dir = v => (typeof v === 'number' && isFinite(v) ? Math.sign(Math.round(v)) : 0);
const clampNum = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

function newCode() {
  for (let i = 0; i < 200; i++) {
    const c = P.makeCode(Math.random);
    if (!rooms.has(c)) return c;
  }
  return null;
}

function fail(cl, key) { cl.send({ t: 'error', key }); }

// the room browser: the persistent worlds, and the public matches still
// in their lobby with room to spare
function listing() {
  return {
    // (full: no new match can be made -- the CPU budget, or MAX_ROOMS)
    t: 'list', full: serverFull() || matchCount() >= cfg.MAX_ROOMS ? 1 : 0,
    worlds: worlds.filter(w => !w.closed).map(w => w.listing()),
    matches: [...rooms.values()].filter(r => r.open()).map(r => r.listing()),
  };
}

// one client message (already parsed; every field still untrusted)
function handle(cl, m) {
  const room = cl.room, slot = cl.slot;
  switch (m.t) {
    case 'hello': {
      if (m.v !== P.VERSION) { fail(cl, 'e_version'); return; }
      cl.name = P.cleanName(m.name) || 'ANT';
      cl.hello = true;
      cl.send({ t: 'welcome', v: P.VERSION, max: cfg.MAX_PLAYERS });
      return;
    }
    case 'ping':
      cl.send({ t: 'pong', c: clampNum(m.c, 0, 1e15) });
      return;
  }
  if (!cl.hello) { fail(cl, 'e_hello'); return; }

  switch (m.t) {
    case 'list':
      cl.send(listing());
      return;
    case 'create': {
      if (room) { fail(cl, 'e_inRoom'); return; }
      const mode = typeof m.mode === 'string' ? m.mode : 'coop';
      if (!MODES.includes(mode)) { fail(cl, 'e_mode'); return; }
      if (matchCount() >= cfg.MAX_ROOMS || serverFull()) { fail(cl, 'e_busy'); return; }
      const code = newCode();
      if (!code) { fail(cl, 'e_busy'); return; }
      const r = new Room(code, mode, log, { pub: bool(m.pub) });
      rooms.set(code, r);
      r.join(cl);
      log(`room ${code}: ${mode} (${r.pub ? 'public' : 'private'}) created by ${cl.name} (${matchCount()} match(es))`);
      return;
    }
    case 'join': {
      if (room) { fail(cl, 'e_inRoom'); return; }
      const code = P.normCode(m.code);
      const r = code && rooms.get(code);
      if (!r || r.closed) { fail(cl, 'e_noRoom'); return; }
      // (a match under way, or a sleeping world, would add to the load)
      if (serverFull() && (r.state === 'play' || r.world)) { fail(cl, 'e_busy'); return; }
      const err = r.join(cl);
      if (err) fail(cl, err);
      return;
    }
    case 'enter': {
      // a persistent world, by name
      if (room) { fail(cl, 'e_inRoom'); return; }
      const w = typeof m.name === 'string' && worlds.find(x => !x.closed && x.name === m.name.toUpperCase());
      if (!w) { fail(cl, 'e_noWorld'); return; }
      if (w.connectedSlots().length >= cfg.MAX_PLAYERS) { fail(cl, 'e_full'); return; }
      if (serverFull()) { fail(cl, 'e_busy'); return; }
      const err = w.join(cl);
      if (err) fail(cl, err);
      return;
    }
    case 'resume': {
      if (room) { fail(cl, 'e_inRoom'); return; }
      const code = P.normCode(m.code);
      const r = code && rooms.get(code);
      // (no such room -- the server restarted, or it closed: the match is gone)
      if (!r || r.closed) { cl.send({ t: 'closed', key: 'e_closed' }); return; }
      if (typeof m.token !== 'string' || m.token.length > 64) { fail(cl, 'e_noSlot'); return; }
      const err = r.resume(cl, m.token);
      if (err) fail(cl, err);
      return;
    }
    case 'dev': {
      // test hooks: run code in the room's simulation (MAUR_DEV=1 only)
      if (!cfg.DEV || !room || !room.sim || typeof m.js !== 'string') return;
      let r;
      try { r = room.sim.run(m.js); } catch (e) { r = 'ERR ' + e.message; }
      let out;
      try { out = JSON.parse(JSON.stringify(r === undefined ? null : r)); } catch (e) { out = String(r); }
      cl.send({ t: 'dev', id: m.id, r: out });
      return;
    }
  }
  if (!room || !slot) return;   // everything below needs a room

  switch (m.t) {
    case 'leave': room.leave(slot); cl.send({ t: 'left' }); return;
    case 'start': {
      const err = room.state === 'lobby' && serverFull() ? 'e_busy' : room.start(cl);
      if (err) fail(cl, err);
      return;
    }
    // the lobby: a side (versus), public or private, a kick (the host's)
    case 'side': {
      const err = typeof m.f === 'string' && FACTIONS.includes(m.f) ? room.setFaction(slot, m.f) : null;
      if (err) fail(cl, err);
      return;
    }
    case 'pub': { const err = room.setPublic(cl, bool(m.on)); if (err) fail(cl, err); return; }
    case 'kick': {
      const err = Number.isInteger(m.idx) ? room.kick(cl, m.idx) : null;
      if (err) fail(cl, err);
      return;
    }
    case 'full':  // the client's world from the seed didn't match: all of it, then
      if (room.state === 'play' && cl.ready) room.sendWorld(cl, true);
      return;
  }
  if (room.state !== 'play') return;   // match input from here on
  switch (m.t) {
    case 'in': {
      const inp = slot.input;
      inp.dx = dir(m.dx); inp.dy = dir(m.dy);
      inp.bite = bool(m.bite); inp.build = bool(m.build);
      // (the client's tick this input was first used on: each snapshot tells
      // the client which of its ticks the server's ant has reached)
      const l = clampNum(m.l, 0, 1e9);
      if (l !== null) { slot.inL = Math.floor(l); slot.inN = 0; }
      const cx = clampNum(m.cx, 0, room.sim.WORLD_W), cy = clampNum(m.cy, 0, room.sim.WORLD_H);
      if (cx !== null && cy !== null) cl.cam = { x: cx, y: cy, t: Date.now() };
      return;
    }
    case 'act': case 'abil': case 'mat': case 'mark':
      slot.shots[m.t] = Math.min(3, slot.shots[m.t] + 1);
      return;
    case 'buy':
      if (typeof m.id === 'string' && room.sim.UPGRADE_IDS.includes(m.id) && slot.buys.length < 4) slot.buys.push(m.id);
      return;
    case 'take':
      if (typeof m.caste === 'string' && room.sim.CASTE_ORDER.includes(m.caste)) slot.take = m.caste;
      return;
  }
}

// ---------------------------------------------------------------------------
// the loop: every room steps at 60 Hz on its own clock
// ---------------------------------------------------------------------------
let last = process.hrtime.bigint();
function loop() {
  const t = process.hrtime.bigint();
  const dt = Math.min(1000, Number(t - last) / 1e6);
  last = t;
  const now = Date.now();
  let wait = 50;
  for (const [code, r] of rooms) {
    let keep = false;
    try { keep = r.update(now, dt); } catch (e) { log(`room ${code}: update failed: ${e && e.stack || e}`); r.close('e_crash'); }
    if (!keep) { rooms.delete(code); continue; }
    if (r.state === 'play' && !r.hibernating) wait = Math.min(wait, Math.max(1, Math.floor(STEP_MS - r.acc)));
  }
  setTimeout(loop, wait);
}

process.on('uncaughtException', e => log('uncaught: ' + (e && e.stack || e)));

// the persistent worlds, from their saves (asleep until someone comes)
function bootWorlds() {
  for (const name of cfg.PERSIST_WORLDS) {
    const code = newCode();
    let w;
    try {
      w = new Room(code, 'world', log, { name, data: store.loadWorld(cfg.DATA_DIR, name, log) });
    } catch (e) { log(`world ${name}: failed to start: ${e && e.stack || e}`); continue; }
    rooms.set(code, w);
    worlds.push(w);
  }
}

server.listen(cfg.PORT, cfg.HOST, () => {
  log(`maur listening on ${cfg.HOST}:${cfg.PORT} (static ${cfg.STATIC_DIR}${cfg.DEV ? ', DEV hooks on' : ''})`);
  bootWorlds();
  if (worlds.length) log(`${worlds.length} persistent world(s) in ${cfg.DATA_DIR}: ${worlds.map(w => w.name).join(', ')}`);
  setTimeout(loop, 10);
});

// a graceful stop (pm2 restart, Ctrl+C): every persistent world is saved
// (synchronously) before the process goes
let stopping = false;
function shutdown(why) {
  if (stopping) return;
  stopping = true;
  log('shutting down (' + why + ')');
  for (const r of rooms.values()) r.close('e_closed');
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// (Windows has no signals: pm2 there -- and the tests -- send a message instead)
process.on('message', m => { if (m === 'shutdown') shutdown('shutdown message'); });
