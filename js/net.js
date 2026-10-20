// MAUR -- online client: the connection to the server, the lobby, and the
// render model. In an online match the browser runs no simulation: it sends
// the local player's input and turns the server's snapshots into the same G
// the renderer draws offline (G.ants, G.bugs, G.colonies...), its entities
// drawn ~100 ms in the past, between the last two snapshots. The local ant
// is predicted ahead with the sim's own steering and physics.
'use strict';

const NET_INTERP = 6;        // ticks the world is drawn behind the newest snapshot (100 ms)
const NET_SEND_MS = 100;     // input is re-sent at least this often
const NET_RETRY_MS = 2000;   // between reconnect attempts...
const NET_GIVEUP_MS = 115000; // ...for this long (the server keeps the slot 2 minutes)
const NET_SNAP = 24;         // a predicted ant this far off the server's is put right at once

const Net = {
  ws: null,
  status: 'off',       // off | connecting | open | lost
  intent: null,        // what to do once connected: { t: 'create' } / { t: 'join', code } / { t: 'enter', name } / { t: 'list' } / { t: 'resume' }
  name: '',
  err: null,           // lang key of the last error, shown by the menus
  welcomed: false,     // the server has said hello on this connection
  list: null,          // the room browser: { worlds, matches, full } as the server last said
  listT: 0,
  // the room (worldName: a persistent world's; faction: ours in versus;
  // pub: listed under OPEN MATCHES)
  code: null, token: null, you: -1, host: -1, roomState: null, players: [], max: 8, mode: 'coop',
  worldName: null, faction: 'black', pub: false,
  reborn: false,      // the last world was ours starting over (see world())
  // the match
  inMatch: false, seed: null, base: null, ready: false, awaitFirst: false,
  ents: { a: new Map(), b: new Map(), u: new Map(), i: new Map() },
  latest: 0, prevTick: 0, recvAt: 0, clock: null, renderTick: 0,
  evq: [],             // events waiting for the drawn time to reach them [tick, event]
  sent: { dx: 0, dy: 0, bite: false, build: false }, sendT: 0,
  rtt: 0, pingT: 0, takeWait: 0,
  pred: null, hist: [], predOn: true, ltick: 0,
  echo: null,          // the client tick the newest snapshot's local ant stands at (the server says)
  queue: [], busy: false,
  lostAt: 0, retryT: 0, leaving: false,
  lag: 0,              // test aid: an artificial round trip (ms), from ?lag=
  stats: { bytes: 0, snaps: 0, t0: 0 },

  serverUrl() {
    const q = new URLSearchParams(location.search);
    if (q.get('server')) return q.get('server');
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    }
    return 'ws://localhost:3006/ws';
  },

  // ---- the connection -------------------------------------------------------
  // open a connection and do `intent` once the server has said hello
  start(intent) {
    this.close();
    this.intent = intent;
    this.err = null;
    this.leaving = false;
    this.lag = Math.max(0, Number(new URLSearchParams(location.search).get('lag')) || 0);
    this.connect();
  },

  connect() {
    this.status = 'connecting';
    this.welcomed = false;
    let ws;
    try { ws = new WebSocket(this.serverUrl()); } catch (e) { this.onDown(); return; }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      // (back from a lost connection: still 'lost' until the room has taken
      // us back -- see lobby())
      if (this.status !== 'lost') this.status = 'open';
      this.send({ t: 'hello', v: NetProto.VERSION, name: this.name });
    };
    ws.onmessage = ev => {
      if (this.ws !== ws) return;
      this.stats.bytes += ev.data.length;
      const push = () => {
        // (a pong is timed as it arrives, not after the queue ahead of it --
        // the world's terrain can hold that up for a second)
        if (ev.data.startsWith('{"t":"pong"')) { this.pong(ev.data); return; }
        this.queue.push(ev.data);
        if (!this.busy) this.pump();
      };
      if (this.lag) setTimeout(push, this.lag / 2); else push();
    };
    ws.onclose = () => { if (this.ws === ws) this.onDown(); };
    ws.onerror = () => {};
  },

  send(obj) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    const s = JSON.stringify(obj);
    if (this.lag) setTimeout(() => { if (ws.readyState === 1) ws.send(s); }, this.lag / 2);
    else ws.send(s);
  },

  close() {
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; try { ws.close(); } catch (e) { /* gone */ } }
    this.status = 'off';
    this.welcomed = false;
    this.queue = [];
  },

  // do `intent` on the connection already open (the room browser's), or
  // open one for it
  request(intent) {
    if (this.ws && this.status === 'open' && this.welcomed) {
      this.intent = intent;
      this.err = null;
      this.send(intent);
    } else this.start(intent);
  },

  // the room browser: the list now and then (every 2 s while it's shown)
  askList() {
    const now = performance.now();
    if (this.status === 'open' && this.welcomed && now - this.listT > 2000) {
      this.listT = now;
      this.send({ t: 'list' });
    }
  },

  // the socket went down: in a room we keep trying to get back in
  onDown() {
    this.ws = null;
    if (this.leaving) { this.status = 'off'; return; }
    if (this.code && this.token && (this.inMatch || this.roomState)) {
      if (this.status !== 'lost') { this.status = 'lost'; this.lostAt = performance.now(); }
      this.retryT = performance.now() + NET_RETRY_MS;
      this.intent = { t: 'resume' };
      return;
    }
    this.status = 'off';
    netOnError(this.intent && this.intent.t === 'resume' ? 'e_lost' : 'e_conn');
  },

  // once a frame: reconnect attempts, pings
  poll() {
    const now = performance.now();
    if (this.status === 'lost' && now >= this.retryT && !this.ws) {
      if (now - this.lostAt > NET_GIVEUP_MS) { this.giveUp('e_lost'); return; }
      this.retryT = now + NET_RETRY_MS;
      this.connect();
      this.status = 'lost';
    }
    if (this.status === 'open' && now - this.pingT > 2000) {
      this.pingT = now;
      this.send({ t: 'ping', c: now });
    }
  },

  giveUp(key) {
    this.forget();
    this.close();
    netOnClosed(key);
  },

  // leave the room (and the match) for good
  leave() {
    this.leaving = true;
    this.send({ t: 'leave' });
    const ws = this.ws;
    this.ws = null;
    if (ws) setTimeout(() => { try { ws.close(); } catch (e) { /* gone */ } }, 200 + this.lag);
    this.status = 'off';
    this.forget();
  },

  forget() {
    this.code = this.token = null;
    this.roomState = null; this.inMatch = false; this.ready = false;
    try { sessionStorage.removeItem('maur_net'); } catch (e) { /* no storage */ }
  },

  // a page reload mid-match: the tab's session still knows the room
  savedSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem('maur_net') || 'null');
      if (s && s.code && s.token && Date.now() - s.t < NET_GIVEUP_MS) return s;
    } catch (e) { /* none */ }
    return null;
  },
  resumeSaved(s) {
    this.code = s.code; this.token = s.token; this.name = s.name || this.name;
    this.start({ t: 'resume' });
  },
  remember() {
    try { sessionStorage.setItem('maur_net', JSON.stringify({ code: this.code, token: this.token, name: this.name, t: Date.now() })); } catch (e) { /* no storage */ }
  },

  // ---- incoming --------------------------------------------------------------
  // messages are handled one at a time, in order (the world needs an await)
  async pump() {
    this.busy = true;
    while (this.queue.length) {
      let m;
      try { m = JSON.parse(this.queue.shift()); } catch (e) { continue; }
      try { await this.handle(m); } catch (e) { console.error('net: ' + (m && m.t), e); }
    }
    this.busy = false;
  },

  async handle(m) {
    switch (m.t) {
      case 'welcome':
        this.welcomed = true;
        if (this.intent.t === 'list') this.listT = performance.now();
        if (this.intent.t === 'resume') this.send({ t: 'resume', code: this.code, token: this.token });
        else this.send(this.intent);
        return;
      case 'list': this.list = m; return;
      case 'lobby': return this.lobby(m);
      case 'world': return this.world(m);
      case 's': return this.snap(m);
      case 'over': this.inMatch = false; netOnOver(m.over); return;
      case 'left': return;
      case 'closed': this.giveUp(m.key || 'e_closed'); return;
      case 'error':
        if (m.key === 'e_noSlot' || m.key === 'e_crash') { this.giveUp(m.key); return; }
        this.err = m.key;
        netOnError(m.key);
        return;
    }
  },

  pong(data) {
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (typeof m.c !== 'number') return;
    const r = performance.now() - m.c;
    // (a sample held up -- a busy frame -- counts for less than a quick one)
    this.rtt = !this.rtt ? r : r < this.rtt ? this.rtt * 0.5 + r * 0.5 : this.rtt * 0.8 + r * 0.2;
  },

  lobby(m) {
    const back = this.status === 'lost';
    this.code = m.code; this.token = m.token; this.you = m.you; this.host = m.host;
    this.players = m.players || []; this.max = m.max || 8; this.mode = m.mode;
    this.worldName = m.name || null; this.faction = m.faction === 'red' ? 'red' : 'black'; this.pub = !!m.pub;
    this.roomState = m.state;
    this.status = 'open';
    this.remember();
    if (back) this.lostAt = 0;
    netOnLobby(m);
  },

  // the world: the seed's terrain, then the server's diff over it
  async world(m) {
    if (m.w !== WORLD_W || m.h !== WORLD_H || m.v !== NetProto.VERSION) { this.giveUp('e_version'); return; }
    this.ready = false;
    const diff = await inflate(m.terr);
    const regen = this.seed !== m.seed || !this.base;
    if (regen) {
      const world = genWorld(m.seed);
      this.base = new Uint8Array(world.m);
      this.seed = m.seed;
      this.genWorld = world;
    }
    const tm = m.full ? diff : NetProto.xorInto(diff, diff, this.base);
    if (NetProto.hashBytes(tm) !== m.hash) {
      // our generator disagrees with the server's: ask for all of it
      console.warn('net: terrain hash mismatch, asking for the full terrain');
      this.send({ t: 'full' });
      return;
    }
    // a fresh world unless this is a reconnect into the match G still holds
    // (not after solo play in between, which replaced G)
    const fresh = regen || !G.online || G.seed !== m.seed || !G.colonies.length;
    // (a new seed for the persistent world we're playing in: it started over)
    this.reborn = fresh && G.online && G.mode === 'world' && m.mode === 'world' && G.colonies.length > 0 &&
      this.worldName === (m.name || null) && G.seed !== m.seed;
    if (fresh) {
      const world = this.genWorld || genWorld(m.seed);
      world.m = tm;
      resetWorldState(world, m.seed);
      // (who plays which colony; versus: each side's own ant gates)
      setupFactions(m.mode === 'versus' || m.mode === 'world' ? m.mode : 'coop');
      // (a world swapped in mid-play -- a persistent world starting over --
      // isn't drawn or played until its first snapshot links the players)
      this.ready = false;
      netOnWorldSwap();
      this.genWorld = null;
      this.matchSeed = m.seed;
    } else {
      T.m.set(tm);
    }
    NetProto.unpackInt16(m.surf, T.surf);
    T.loadWear(m.wear);
    G.tick = m.tick;
    LOCAL = m.you;
    this.you = m.you;
    this.mode = m.mode || this.mode;
    this.worldName = m.name || null;
    this.resetModel();
    this.latest = this.prevTick = m.tick;
    this.clock = null;
    this.inMatch = true;
    this.awaitFirst = true;
    this.newMatch = fresh;
    this.stats = { bytes: 0, snaps: 0, t0: performance.now() };
  },

  resetModel() {
    for (const k in this.ents) this.ents[k].clear();
    G.ants = []; G.brood = []; G.bugs = []; G.items = []; G.pheromones = [];
    G.events = [];
    this.evq = [];
    this.pred = null; this.hist = [];
    this.takeWait = 0;
  },

  // ---- snapshots into the render model ---------------------------------------
  snap(m) {
    if (!this.inMatch) return;
    const k = m.k;
    this.prevTick = this.latest;
    this.latest = k;
    this.recvAt = performance.now();
    this.echo = typeof m.l === 'number' ? m.l : null;
    if (this.clock === null) this.clock = k;
    this.stats.snaps++;
    const P = NetProto;
    let changed = false;
    const apply = (type, list, gone, make, update) => {
      const map = this.ents[type];
      if (list) for (const rec of list) {
        let e = map.get(rec[0]);
        if (!e) { e = make(rec); map.set(rec[0], e); changed = true; }
        update(e, rec, k);
      }
      if (gone) for (const id of gone) if (map.delete(id)) changed = true;
    };
    apply('a', m.a, m.ra, () => Object.assign(Object.create(Ant.prototype), { kind: 'ant', _s: [], phase: Math.random() * 10, caste: null }), (e, r) => {
      e.id = r[0];
      e.colony = G.colonies[r[1]] || G.colonies[0];
      const caste = P.CASTES[r[2]] || 'worker';
      if (e.caste !== caste) {
        const c = CASTE[caste];
        e.caste = caste; e.hw = 3 * c.size; e.hh = 2 * c.size;
        e.maxHp = c.hp * (caste === 'queen' && !e.colony.player ? RED_QUEEN_HP : 1);
      }
      this.sample(e, k, r[3] / 2, r[4] / 2);
      const b = r[5];
      e.dir = b & P.A_DIR ? 1 : -1;
      e.climbing = !!(b & P.A_CLIMB); e.ceiling = !!(b & P.A_CEIL);
      e.flash = b & P.A_FLASH ? 6 : 0; e.biteAnim = b & P.A_BITE ? 6 : 0;
      e.raiding = !!(b & P.A_RAID); e.raidRole = e.raiding ? (b & P.A_STEAL ? 'steal' : 'fight') : null;
      e.hitT = b & P.A_HIT ? G.tick + 1e9 : -1e9;   // (bar shown while the server says so)
      e.hp = r[6]; e.carryId = r[7]; e.playerIdx = r[8];
    });
    apply('b', m.b, m.rb, () => Object.assign(Object.create(Brood.prototype), { _s: [], phase: Math.random() * 10, hw: 2, hh: 1.5, dir: 1 }), (e, r) => {
      e.id = r[0];
      e.colony = G.colonies[r[1]] || G.colonies[0];
      this.sample(e, k, r[2] / 2, r[3] / 2);
      const b = r[4];
      e.kind = b & P.B_LARVA ? 'larva' : 'egg';
      e.royal = !!(b & P.B_ROYAL); e.hungry = !!(b & P.B_HUNGRY);
      e.carried = b & P.B_CARRIED ? true : null;
      e.hp = 10;
    });
    apply('u', m.u, m.ru, () => Object.assign(Object.create(Bug.prototype), { _s: [], phase: Math.random() * 10, trail: [], kind: null }), (e, r) => {
      e.id = r[0];
      const kind = P.BUGS[r[1]] || 'pillbug';
      if (e.kind !== kind) {
        e.kind = kind;
        e.hw = (kind === 'spider' || kind === 'beetle') ? 5 : kind === 'wasp' ? 4 : 3;
        e.hh = (kind === 'spider' || kind === 'beetle') ? 3 : 2;
        e.maxHp = BUG_DEF[kind].hp;
      }
      this.sample(e, k, r[2] / 2, r[3] / 2);
      const b = r[4];
      e.dir = b & P.U_DIR ? 1 : -1;
      e.flash = b & P.U_FLASH ? 6 : 0; e.curl = b & P.U_CURL ? 1 : 0;
      e.fleeing = !!(b & P.U_FLEE); e.climbing = !!(b & P.U_CLIMB);
      e.hitT = b & P.U_HIT ? G.tick + 1e9 : -1e9;
      e.hp = r[5];
      const tr = [];
      for (let j = 6; j + 1 < r.length; j += 2) tr.push({ x: r[j] / 2, y: r[j + 1] / 2 });
      e.trail = tr;
    });
    apply('i', m.i, m.ri, () => Object.assign(Object.create(Item.prototype), { _s: [], dead: false, hw: 1.5, hh: 1.5, dir: 1 }), (e, r) => {
      e.id = r[0];
      e.kind = P.ITEMS[r[1]] || 'seed';
      e.value = ITEM_DEF[e.kind] ? ITEM_DEF[e.kind].value : 0;
      this.sample(e, k, r[2] / 2, r[3] / 2);
      e.carrierId = r[4];
      e.site = !!r[5];
    });
    if (changed) {
      G.ants = [...this.ents.a.values()];
      G.brood = [...this.ents.b.values()];
      G.bugs = [...this.ents.u.values()];
      G.items = [...this.ents.i.values()];
    }
    // who carries what
    for (const a of G.ants) a.carry = a.carryId ? this.ents.i.get(a.carryId) || this.ents.b.get(a.carryId) || null : null;
    for (const it of G.items) it.carried = it.carrierId ? this.ents.a.get(it.carrierId) || null : null;
    if (m.v) for (const key in m.v) this.view(key, m.v[key]);
    this.linkPlayers();
    if (m.e) for (const ev of m.e) this.evq.push([k, ev]);
    // (a hidden tab draws nothing and lets nothing out: keep only the latest)
    if (this.evq.length > 300) this.evq.splice(0, this.evq.length - 300);
    if (m.ed) for (const ed of m.ed) this.edit(ed);
    this.reconcile();
    if (this.awaitFirst && G.colony && G.colony.caps) {   // (our own colony: versus hides the enemy's caps)
      this.awaitFirst = false;
      this.ready = true;
      netOnWorldReady(this.newMatch);
    }
  },

  // a position sample for interpolation; one that comes after a quiet spell
  // first gets a sample of where it stood until the last snapshot
  sample(e, k, x, y) {
    const s = e._s;
    const last = s[s.length - 1];
    if (last && last[0] < this.prevTick && (last[1] !== x || last[2] !== y)) s.push([this.prevTick, last[1], last[2]]);
    if (last && last[0] === k) { last[1] = x; last[2] = y; } else s.push([k, x, y]);
    if (s.length > 6) s.shift();
    if (e.x === undefined) { e.x = x; e.y = y; }
  },

  // colony-level state by key (see server/snapshot.js buildView)
  view(key, v) {
    if (key === 'g') {
      G.lastFlightYear = v.lfy || 0;
      G.contested = v.cs;
      // (a persistent world's legacy and story)
      G.legacy = v.leg || 0; G.gen = v.gen || 1; G.history = v.hist || [];
    } else if (key === 'p') {
      this.playersView(v);
    } else {
      const c = G.colonies[Number(key.slice(1))];
      if (!c) return;
      if (key[0] === 'c') Object.assign(c, v);
      else if (key[0] === 'o') c.objectives = v;
      else if (key[0] === 't') c.tasks = v;
    }
  },

  playersView(list) {
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const p = ensurePlayer(i);
      const was = { name: p.name, on: p.online };
      if (!v) {
        p.name = null; p.online = false; p.antId = 0; p.deathPos = null;
      } else {
        p.name = v.n; p.online = !!v.on; p.antId = v.a; p.buildMat = v.bm;
        p.soil = v.so; p.thatch = v.th; p.deathPos = v.dp; p.col = v.c || 0;
      }
      // (versus: a red player sees through the red colony's eyes)
      if (i === LOCAL) G.colIdx = p.col || 0;
      // tell the others who came, went, dropped out and came back
      if (i !== LOCAL && this.ready) {
        if (v && !was.name) { pushMsg(L('m_netJoined', v.n), PLAYER_COLORS[i % PLAYER_COLORS.length]); Sfx.play('select'); }
        else if (!v && was.name) { pushMsg(L('m_netLeft', was.name), '#c0a080'); Sfx.play('menu'); }
        else if (v && was.on && !v.on) { pushMsg(L('m_netDropped', v.n), '#c0a080'); Sfx.play('menu'); }
        else if (v && !was.on && v.on) { pushMsg(L('m_netBack', v.n), PLAYER_COLORS[i % PLAYER_COLORS.length]); Sfx.play('select'); }
      }
    }
    G.players.length = Math.max(list.length, LOCAL + 1);
  },

  linkPlayers() {
    for (let i = 0; i < G.players.length; i++) {
      const p = ensurePlayer(i);
      const a = p.antId ? this.ents.a.get(p.antId) : null;
      p.ant = a && a.hp > 0 ? a : null;
      if (p.ant) { p.ant.soil = p.soil || 0; p.ant.thatch = p.thatch || 0; }
    }
    if (G.players[LOCAL] && G.players[LOCAL].ant) this.takeWait = 0;
  },

  // a terrain edit: [x0, y0, x1, y1, bytes, surf, wear]
  edit(ed) {
    const [x0, y0, x1, y1, data, surf, wear] = ed;
    if (!NetProto.unpackRect(T.m, WORLD_W, WORLD_H, x0, y0, x1, y1, data)) return;
    NetProto.unpackInt16(surf, T.surf.subarray(x0, x1 + 1));
    if (T.wear.size || (wear && wear.length)) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) T.wear.delete(y * WORLD_W + x);
      const w = x1 - x0 + 1;
      for (let j = 0; j + 1 < wear.length; j += 2) {
        T.wear.set((y0 + Math.floor(wear[j] / w)) * WORLD_W + x0 + wear[j] % w, wear[j + 1] / 10);
      }
    }
    if (T.onEdit) T.onEdit(x0, y0, x1, y1);
  },

  // ---- each tick of an online match (60 Hz, instead of stepSim) ---------------
  frame() {
    this.poll();
    if (!this.ready) return;
    const inp = G.players[LOCAL].input;
    this.sendInput(inp);
    // the drawn time: just behind the newest snapshot, smoothly
    this.clock += 1;
    const target = this.latest + (performance.now() - this.recvAt) * 0.06;
    const err = target - this.clock;
    if (Math.abs(err) > 30) this.clock = target; else this.clock += err * 0.05;
    this.renderTick = this.clock - NET_INTERP;
    G.tick = Math.max(0, Math.floor(this.renderTick));
    const rt = this.renderTick;
    const me = this.predOn && G.players[LOCAL].ant;   // (drawn where predicted instead)
    for (const a of G.ants) if (a !== me) this.place(a, rt, 0.6, a.climbing ? 0.4 : 0);
    for (const b of G.brood) { this.place(b, rt, 0, 0.05); }
    for (const b of G.bugs) this.place(b, rt, 0.7, 0.05);
    for (const it of G.items) this.place(it, rt, 0, 0);
    this.predict(inp);
    this.pheromones();
    // the events whose moment has come
    let n = 0;
    while (n < this.evq.length && this.evq[n][0] <= rt + 1) n++;
    for (const [, ev] of this.evq.splice(0, n)) G.events.push(this.event(ev));
    if (this.takeWait > 0) this.takeWait--;
  },

  // an entity's drawn position at tick rt, between its samples (a jump
  // farther than 40 px -- a takeover, a teleport -- isn't smeared)
  place(e, rt, stride, idle) {
    const s = e._s;
    let x, y;
    const last = s[s.length - 1];
    if (rt >= last[0]) { x = last[1]; y = last[2]; }
    else if (rt <= s[0][0]) { x = s[0][1]; y = s[0][2]; }
    else {
      let i = s.length - 2;
      while (i > 0 && s[i][0] > rt) i--;
      const a = s[i], b = s[i + 1];
      const f = (rt - a[0]) / Math.max(1, b[0] - a[0]);
      if (Math.abs(b[1] - a[1]) > 40 || Math.abs(b[2] - a[2]) > 40) { x = f < 0.5 ? a[1] : b[1]; y = f < 0.5 ? a[2] : b[2]; }
      else { x = a[1] + (b[1] - a[1]) * f; y = a[2] + (b[2] - a[2]) * f; }
    }
    e.phase += Math.abs(x - e.x) * stride + idle;
    e.x = x; e.y = y;
  },

  event(ev) {
    switch (ev[0]) {
      case 'm': return { t: 'msg', key: ev[1], args: ev[2] || [], color: ev[3], to: ev[4] ? LOCAL : -1 };
      case 's': return { t: 'sfx', k: ev[1], x: ev[2], y: ev[3], r: ev[4] };
      default: return { t: 'fx', k: ev[1], x: ev[2], y: ev[3], n: ev[4] };
    }
  },

  // input to the server: held keys when they change (and every 100 ms, with
  // where the camera looks), presses as messages of their own
  sendInput(inp) {
    const s = this.sent, now = performance.now();
    if (inp.dx !== s.dx || inp.dy !== s.dy || inp.bite !== s.bite || inp.build !== s.build || now - this.sendT > NET_SEND_MS) {
      s.dx = inp.dx; s.dy = inp.dy; s.bite = inp.bite; s.build = inp.build;
      this.sendT = now;
      const v = playerView();
      // (l: the tick predict() first steers with it -- see reconcile)
      this.send({ t: 'in', dx: inp.dx, dy: inp.dy, bite: inp.bite, build: inp.build, l: this.ltick + 1,
        cx: Math.round(G.cam.x + v.vw / 2), cy: Math.round(G.cam.y + v.vh / 2) });
    }
    if (inp.act) { inp.act = false; this.send({ t: 'act' }); }
    if (inp.abil) { inp.abil = false; this.send({ t: 'abil' }); }
    if (inp.buildMat) { inp.buildMat = false; this.send({ t: 'mat' }); }
    if (inp.mark) { inp.mark = false; this.send({ t: 'mark' }); }
    if (inp.buy) { this.send({ t: 'buy', id: inp.buy }); inp.buy = null; }
  },

  // the window lost focus (or the tab was hidden, when no frames run to
  // send anything): let go of every key on the server at once
  idle() {
    if (!this.ready || !this.inMatch) return;
    const s = this.sent;
    s.dx = s.dy = 0; s.bite = s.build = false;
    this.sendT = performance.now();
    this.send({ t: 'in', dx: 0, dy: 0, bite: false, build: false, l: this.ltick + 1 });
  },

  // take over an ant of `caste` (the server picks the one nearest us)
  take(caste) {
    this.send({ t: 'take', caste });
    this.takeWait = 90 + Math.round(this.rtt * 0.06);
  },

  // ---- the local ant, predicted ---------------------------------------------
  // steered by the local input through the sim's own steerAnt + physStep on
  // the local terrain, and pulled toward where the server had it a round
  // trip ago
  predict(inp) {
    this.ltick++;
    const me = G.players[LOCAL] && G.players[LOCAL].ant;
    if (!this.predOn || !me) { this.pred = null; this.hist = []; return; }
    let P = this.pred;
    const last = me._s[me._s.length - 1];
    if (!P || P.id !== me.id) {
      P = this.pred = Object.assign(Object.create(Ant.prototype), {
        id: me.id, kind: 'ant', x: last[1], y: last[2], vx: 0, vy: 0, onGround: false,
        climbing: false, ceiling: false, climbV: 0, dir: me.dir, playerIdx: LOCAL,
      });
      this.hist = [];
    }
    P.caste = me.caste; P.colony = me.colony; P.carry = me.carry; P.hw = me.hw; P.hh = me.hh;
    steerAnt(P, inp.dx, inp.dy);
    physStep(P);
    if (P.climbing) climbFix(P);
    this.hist.push([this.ltick, P.x, P.y]);
    if (this.hist.length > 90) this.hist.shift();
    // the drawn ant is the predicted one
    me.phase += Math.abs(P.x - me.x) * 0.6 + (P.climbing ? 0.4 : 0);
    me.x = P.x; me.y = P.y; me.dir = P.dir; me.climbing = P.climbing; me.ceiling = P.ceiling;
  },

  reconcile() {
    const P = this.pred;
    const me = G.players[LOCAL] && G.players[LOCAL].ant;
    if (!P || !me || P.id !== me.id) return;
    const last = me._s[me._s.length - 1];
    // the predicted position to hold the server's against: at the tick the
    // server says its ant has reached, else a round trip ago
    const lag = Math.max(1, Math.min(60, Math.round(this.rtt * 0.06) + 2));
    const want = this.echo !== null ? this.echo : this.ltick - lag;
    let h = null;
    for (let i = this.hist.length - 1; i >= 0; i--) if (this.hist[i][0] <= want) { h = this.hist[i]; break; }
    if (!h) h = this.hist[0];
    if (!h) return;
    const ex = last[1] - h[1], ey = last[2] - h[2];
    if (Math.abs(ex) > NET_SNAP || Math.abs(ey) > NET_SNAP || T.boxSolid(P.x, P.y, P.hw, P.hh, P.own)) {
      P.x = last[1]; P.y = last[2]; P.vx = P.vy = 0;
      this.hist = [];
      return;
    }
    // ease a fifth of the way there (and the history with it), each axis on
    // its own: a sliver of a pixel down must not sink the ant into the floor
    // (positions come in half pixels), nor stop the sideways pull
    // (sideways up or down a slope: lift it over the bump, as physStep does)
    const cx = ex * 0.2, cy = Math.abs(ey) < 0.75 ? 0 : ey * 0.2;
    let moved = !cx;
    if (cx) {
      for (const up of [0, -1, -2, -3]) {
        if (T.boxSolid(P.x + cx, P.y + up, P.hw, P.hh, P.own)) continue;
        P.x += cx; P.y += up;
        for (const e of this.hist) { e[1] += cx; e[2] += up; }
        moved = true;
        break;
      }
    }
    if (cy && !T.boxSolid(P.x, P.y + cy, P.hw, P.hh, P.own)) {
      P.y += cy;
      for (const e of this.hist) e[2] += cy;
    }
    // off by a little for a long time (it can't get there): just go there
    // (or a wall the server's ant stopped at stands in the way)
    P.offN = Math.abs(ex) > 2 || Math.abs(ey) > 2 ? (P.offN || 0) + 1 : 0;
    P.wallN = !moved && Math.abs(ex) > 1 ? (P.wallN || 0) + 1 : 0;
    if (P.offN > 20 || P.wallN > 3) { P.x = last[1]; P.y = last[2]; P.vx = P.vy = 0; P.offN = P.wallN = 0; this.hist = []; }
  },

  // the scent trails of laden ants (cosmetic, as the sim lays them)
  pheromones() {
    if (G.tick % 8 === 0) {
      for (const a of G.ants) if (a.carry && a.hp > 0) G.pheromones.push({ x: a.x, y: a.y + 2, t: 900 });
      if (G.pheromones.length > 700) G.pheromones.splice(0, G.pheromones.length - 700);
    }
    for (const ph of G.pheromones) ph.t--;
    if (G.tick % 30 === 0) G.pheromones = G.pheromones.filter(p => p.t > 0);
  },

  // bytes received per second since the world arrived
  bytesPerSec() {
    const dt = (performance.now() - this.stats.t0) / 1000;
    return dt > 0 ? this.stats.bytes / dt : 0;
  },
};

// deflated base64 -> bytes (the browser's own zlib)
async function inflate(b64) {
  const bytes = NetProto.fromB64(b64);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
