// MAUR server -- a room: a lobby with a code, then a match; or a persistent
// world. In a match the room runs its own simulation at 60 Hz and sends each
// player 20 snapshots a second. Modes:
//   'coop'    one colony, 1-8 players, one year
//   'versus'  black against red: every player slot has a faction, picked in
//             the lobby (1-4 a side); each side plays its own colony
//   'world'   a persistent world (server/server.js makes them at boot from
//             PERSIST_WORLDS): no lobby, players drop in and out, the sim
//             sleeps while nobody is in it and is saved to disk (store.js)
'use strict';

const crypto = require('crypto');
const path = require('path');
const zlib = require('zlib');
const cfg = require('./config');
const { createSim } = require('./sim');
const S = require('./snapshot');
const store = require('./store');
const P = require(path.join(cfg.JS_DIR, 'netproto.js'));

const STEP_MS = 1000 / 60;
const SNAP_TICKS = 3;        // a snapshot every 3 ticks: 20 Hz
const CATCH_UP = 5;          // ticks a late loop may run at once
const MODES = ['coop', 'versus'];   // (what a player may create; 'world' is the server's)
const FACTIONS = ['black', 'red'];  // by colony index
const SIDE_MAX = cfg.SIDE_MAX;   // versus: players a side at most (the room holds two sides)
const ONESHOTS = { act: 'act', abil: 'abil', mat: 'buildMat', mark: 'mark' };

// a uniform random 32-bit seed / an unguessable reconnect token
const randSeed = () => crypto.randomBytes(4).readUInt32LE(0);
const randToken = () => crypto.randomBytes(18).toString('base64url');

class Room {
  // opts: { pub } for a match (listed in OPEN MATCHES); { name, data } for
  // a persistent world (data: its save, or null for a new one)
  constructor(code, mode, log, opts) {
    opts = opts || {};
    this.code = code;
    this.mode = mode === 'world' || MODES.includes(mode) ? mode : 'coop';
    this.world = this.mode === 'world';
    this.name = opts.name || null;
    this.pub = !!opts.pub;
    this.log = log;
    this.state = 'lobby';     // lobby | play | over
    this.slots = [];          // by player index: { idx, name, token, client, connected, lostAt, antId, faction, ... }
    this.host = null;         // the slot that may start the match
    this.sim = null;
    this.base = null;         // the terrain as generated from the seed (joins get a diff against it)
    this.dirty = [];          // terrain rects edited since the last snapshot
    this.acc = 0;
    this.lastSnap = 0;
    this.snapN = 0;
    this.emptySince = null;
    this.overAt = null;
    this.closed = false;
    this.created = Date.now();
    this.stats = { tickMs: 0, tickMax: 0, snapMs: 0, ticks: 0, busyMs: 0, stepMs: 0 };
    // a persistent world: asleep while nobody is in it, saved now and then
    this.hibernating = false;
    this.savedAt = Date.now();
    this.saves = 0;
    if (this.world) this.bootWorld(opts.data);
  }

  // ---- membership ------------------------------------------------------------
  connectedSlots() { return this.slots.filter(s => s && s.connected); }
  playerCount() { return this.slots.filter(Boolean).length; }
  // the colony index a slot plays for
  colOf(slot) { return slot && slot.faction === 'red' ? 1 : 0; }
  // versus: the players on each side
  sides() {
    const n = [0, 0];
    for (const s of this.slots) if (s) n[this.colOf(s)]++;
    return n;
  }
  // the players the sim is to be balanced for (see playerSlots in
  // game.js): versus the bigger side (both colonies alike), else everyone
  // with a slot (a persistent world: everyone connected to it now, which
  // its moving average follows)
  balanceFor() {
    if (this.mode === 'versus') return Math.max(1, ...this.sides());
    return Math.max(1, this.world ? this.connectedSlots().length : this.playerCount());
  }

  // a colour for a player on side `faction` (see playerColor): the first
  // no one else on that side has (co-op: no one in the room)
  pickHue(faction, self) {
    const used = new Set();
    for (const s of this.slots) if (s && s !== self && (this.mode !== 'versus' || s.faction === faction)) used.add(s.hue);
    let h = 0;
    while (used.has(h)) h++;
    return h;
  }

  // players the room holds: versus two sides, else MAX_PLAYERS
  cap() { return this.mode === 'versus' ? 2 * SIDE_MAX : cfg.MAX_PLAYERS; }

  // a new player asks to join. Returns an error key, or null (joined).
  join(cl) {
    if (this.state === 'over') return 'e_over';
    if (this.world && this.playerCount() >= cfg.MAX_PLAYERS) {
      // a persistent world counts (and lists) the players connected: a
      // newcomer takes over the slot held longest for a lost player
      let old = null;
      for (const s of this.slots) if (s && !s.connected && (!old || s.lostAt < old.lostAt)) old = s;
      if (old) this.leave(old);
    }
    if (this.playerCount() >= this.cap()) return 'e_full';
    let idx = this.slots.findIndex(s => !s);
    if (idx < 0) idx = this.slots.length;
    // (versus: the side with fewer players)
    const sides = this.sides();
    const faction = this.mode === 'versus' && sides[1] < sides[0] ? 'red' : 'black';
    const slot = {
      idx, name: cl.name, token: randToken(), client: null, connected: false, lostAt: null,
      antId: 0, faction, hue: this.pickHue(faction, null), input: { dx: 0, dy: 0, bite: false, build: false },
      shots: { act: 0, abil: 0, mat: 0, mark: 0 }, buys: [], take: null,
      inL: null, inN: 0,
    };
    this.slots[idx] = slot;
    if (!this.world && (!this.host || !this.host.connected)) this.host = slot;
    this.attach(slot, cl);
    if (this.state === 'play') {
      const p = this.sim.ensurePlayer(idx);
      p.name = slot.name;
      p.stats = this.sim.newPlayerStats();   // (an old slot's tally isn't the newcomer's)
      p.col = this.colOf(slot);
      // (more players than the world was balanced for: it grows to match)
      if (this.sim.notePlayers(this.balanceFor())) this.log(`room ${this.label()}: now balanced for ${this.sim.playerSlots()} players`);
      this.sendWorld(cl);
    }
    this.broadcastLobby();
    this.log(`room ${this.label()}: ${slot.name} joined as player ${idx + 1}${this.mode === 'versus' ? ' (' + faction + ')' : ''}`);
    return null;
  }

  // a player who lost the connection comes back with its token. Returns an
  // error key, or null.
  resume(cl, token) {
    const slot = this.slots.find(s => s && s.token === token);
    if (!slot) return 'e_noSlot';
    if (slot.client && slot.client !== cl) {
      // (the same player in a second tab, or a socket not yet known dead)
      slot.client.send({ t: 'closed', key: 'e_elsewhere' });
      slot.client.room = null; slot.client.slot = null;
    }
    this.attach(slot, cl);
    if (this.state === 'play') {
      if (slot.antId) this.sim.reclaimAnt(slot.idx, slot.antId);
      slot.antId = 0;
      this.sim.notePlayers(this.balanceFor());
      this.sendWorld(cl);
    } else if (this.state === 'over') {
      cl.send({ t: 'over', over: this.sim.G.over });
    }
    this.broadcastLobby();
    this.log(`room ${this.label()}: ${slot.name} reconnected`);
    return null;
  }

  attach(slot, cl) {
    slot.client = cl;
    slot.connected = true;
    slot.lostAt = null;
    slot.inL = null; slot.inN = 0;
    cl.room = this; cl.slot = slot;
    cl.ready = false;
    if (cl.name) slot.name = cl.name;
    this.emptySince = null;
  }

  // the connection dropped: keep the slot RECONNECT_MS for its token; the
  // ant carries on as one of the colony's meanwhile
  lost(cl) {
    const slot = cl.slot;
    if (!slot || slot.client !== cl) return;
    slot.client = null; slot.connected = false; slot.lostAt = Date.now();
    cl.room = null; cl.slot = null;
    if (this.state === 'play') {
      const a = this.sim.releasePlayer(slot.idx);
      slot.antId = a ? a.id : 0;
      this.sim.notePlayers(this.balanceFor());   // (a persistent world: fewer in it now)
    }
    this.passHost();
    this.broadcastLobby();
    this.log(`room ${this.label()}: ${slot.name} lost the connection`);
  }

  // a player leaves for good (the menu's LEAVE, a lost slot expiring, a kick)
  leave(slot) {
    if (!slot || this.slots[slot.idx] !== slot) return;
    if (slot.client) { slot.client.room = null; slot.client.slot = null; }
    if (this.state === 'lobby') {
      // the lobby keeps its list compact: everyone after moves up
      this.slots.splice(slot.idx, 1);
      this.slots.forEach((s, i) => { s.idx = i; });
    } else {
      this.slots[slot.idx] = null;
      if (this.state === 'play') {
        this.sim.releasePlayer(slot.idx);
        this.sim.G.players[slot.idx].name = null;
        this.sim.notePlayers(this.balanceFor());
      }
    }
    if (this.host === slot) this.host = null;
    this.passHost();
    this.broadcastLobby();
    this.log(`room ${this.label()}: ${slot.name} left`);
  }

  passHost() {
    if (this.world) return;   // (a persistent world has no host)
    if (this.host && this.host.connected && this.slots.includes(this.host)) return;
    this.host = this.connectedSlots()[0] || this.slots.find(Boolean) || null;
  }

  // ---- the lobby's settings (the host's) ----------------------------------------
  // versus: a player picks its side (at most SIDE_MAX a side)
  setFaction(slot, f) {
    if (this.mode !== 'versus' || this.state !== 'lobby') return 'e_started';
    if (!FACTIONS.includes(f)) return null;
    if (slot.faction === f) return null;
    if (this.sides()[FACTIONS.indexOf(f)] >= SIDE_MAX) return 'e_sideFull';
    slot.faction = f;
    slot.hue = this.pickHue(f, slot);
    this.broadcastLobby();
    return null;
  }

  // public (listed under OPEN MATCHES) or private (by code only)
  setPublic(cl, on) {
    if (this.world || this.state !== 'lobby') return 'e_started';
    if (cl.slot !== this.host) return 'e_notHost';
    this.pub = !!on;
    this.broadcastLobby();
    return null;
  }

  // the host sends a player out of the lobby; it is told so
  kick(cl, idx) {
    if (this.world || this.state !== 'lobby') return 'e_started';
    if (cl.slot !== this.host) return 'e_notHost';
    const slot = this.slots[idx];
    if (!slot || slot === this.host) return null;
    const kc = slot.client;
    this.leave(slot);
    if (kc) kc.send({ t: 'closed', key: 'e_kicked' });
    this.log(`room ${this.label()}: ${slot.name} was kicked`);
    return null;
  }

  // what the room browser shows of this room
  listing() {
    if (this.world) {
      const G = this.sim.G;
      return {
        name: this.name, players: this.connectedSlots().length, max: cfg.MAX_PLAYERS,
        year: G.year, season: G.season, legacy: G.legacy, gen: G.gen, sleeping: this.hibernating,
      };
    }
    return { code: this.code, mode: this.mode, players: this.playerCount(), max: this.cap(),
      host: this.host ? this.host.name : '', on: this.state === 'play' ? 1 : 0 };
  }
  // listed under OPEN MATCHES: public, in the lobby or under way (a joiner
  // picks an ant, see join), someone (connected) in it, room to spare
  open() {
    return !this.world && !this.closed && this.pub && (this.state === 'lobby' || this.state === 'play') &&
      this.connectedSlots().length > 0 && this.playerCount() < this.cap();
  }

  broadcastLobby() {
    const players = this.slots.map(s => s && { n: s.name, on: s.connected ? 1 : 0, f: s.faction, h: s.hue });
    for (const s of this.slots) {
      if (!s || !s.client) continue;
      s.client.send({
        t: 'lobby', code: this.code, mode: this.mode, state: this.state, max: this.cap(),
        you: s.idx, host: this.host ? this.host.idx : -1, token: s.token, faction: s.faction, players,
        pub: this.pub ? 1 : 0, name: this.name,
      });
    }
  }

  // ---- the match ---------------------------------------------------------------
  // the host starts the match with everyone in the lobby (versus: a player on
  // each side, at most SIDE_MAX a side)
  start(cl) {
    if (this.state !== 'lobby') return 'e_started';
    if (cl.slot !== this.host) return 'e_notHost';
    const vs = this.mode === 'versus';
    if (vs) {
      const n = this.sides();
      if (!n[0] || !n[1]) return 'e_sides';
      if (n[0] > SIDE_MAX || n[1] > SIDE_MAX) return 'e_sideFull';
    }
    const sim = createSim();
    const seed = randSeed();
    // (versus: the players take workers their colonies already have)
    sim.newWorld(seed, vs ? 0 : this.slots.length, this.mode, this.balanceFor());
    this.base = new Uint8Array(sim.T.m);
    sim.T.onEdit = (x0, y0, x1, y1) => { this.dirty.push([x0, y0, x1, y1]); };
    this.sim = sim;
    this.seed = seed;
    this.state = 'play';
    this.acc = 0;
    this.lastSnap = sim.G.tick;
    for (const s of this.slots) {
      const p = sim.ensurePlayer(s.idx);
      p.name = s.name;
      p.col = this.colOf(s);
      if (vs) sim.joinColony(s.idx, p.col);
      // (someone who dropped out in the lobby finds its ant waiting)
      if (!s.connected) { const a = sim.releasePlayer(s.idx); s.antId = a ? a.id : 0; }
    }
    this.log(`room ${this.code}: ${this.mode} match started, ${this.slots.length} player(s)` +
      (vs ? ' (' + this.sides().join(' v ') + ')' : '') + `, seed ${seed}`);
    this.broadcastLobby();
    for (const s of this.slots) if (s.client) this.sendWorld(s.client);
    return null;
  }

  // the terrain (a diff against the seed's, deflated), the surface line and
  // the wear; the next snapshot after it is a full one
  sendWorld(cl, full) {
    const T = this.sim.T, G = this.sim.G;
    const diff = full ? T.m : P.xorInto(new Uint8Array(T.m.length), T.m, this.base);
    const z = zlib.deflateSync(diff, { level: 6 });
    cl.send({
      t: 'world', v: P.VERSION, seed: this.seed, tick: G.tick, mode: this.mode, name: this.name,
      you: cl.slot.idx, w: this.sim.WORLD_W, h: this.sim.WORLD_H,
      full: full ? 1 : 0, terr: z.toString('base64'), hash: P.hashBytes(T.m),
      surf: P.packInt16(T.surf), wear: T.wearList(),
    });
    cl.delta = S.freshDelta();
    cl.events = [];
    cl.colIdx = this.colOf(cl.slot);
    cl.ready = true;
  }

  // inputs from the network into the players' input structs
  applyInputs() {
    const sim = this.sim, G = sim.G;
    for (const s of this.slots) {
      if (!s || !s.connected) continue;
      const p = G.players[s.idx];
      if (!p) continue;
      const inp = p.input;
      inp.dx = s.input.dx; inp.dy = s.input.dy;
      inp.bite = s.input.bite; inp.build = s.input.build;
      if (s.inL !== null) s.inN++;
      // one-shot presses: one of each kind per tick, none lost
      for (const k in ONESHOTS) {
        if (s.shots[k] > 0 && !inp[ONESHOTS[k]]) { inp[ONESHOTS[k]] = true; s.shots[k]--; }
      }
      if (s.buys.length && inp.buy == null) inp.buy = s.buys.shift();
      if (s.take) {
        const caste = s.take;
        s.take = null;
        // (a newcomer's pick starts from its own colony's entrance)
        const ref = p.ant && p.ant.hp > 0 ? p.ant : p.deathPos || G.colonies[this.colOf(s)].entrance;
        sim.takeOver(s.idx, caste, ref.x, ref.y);
      }
    }
  }

  step() {
    const t0 = process.hrtime.bigint();
    this.applyInputs();
    this.sim.stepSim();
    this.drainEvents();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const st = this.stats;
    st.tickMs = st.ticks ? st.tickMs * 0.99 + ms * 0.01 : ms;
    st.tickMax = Math.max(st.tickMax * 0.999, ms);
    st.ticks++;
    st.busyMs += ms;
    st.stepMs += ms;
    const G = this.sim.G;
    if (G.over && this.state === 'play') {
      if (this.world) this.rebirth();
      else this.endMatch();
    }
  }

  // the sim's events go to the players they concern: a message to its
  // player (or everyone; one for a colony only to that colony's players),
  // sounds and particles to those near enough
  drainEvents() {
    const G = this.sim.G;
    if (!G.events.length) return;
    const cls = [];
    for (const s of this.slots) if (s && s.client && s.client.ready) cls.push(s.client);
    const mine = (c, e) => e.col === undefined || e.col < 0 || c.colIdx === e.col;
    for (const e of G.events) {
      if (e.t === 'msg') {
        const ev = ['m', e.key, e.args, e.color, e.to < 0 ? 0 : 1];
        if (e.to < 0) { for (const c of cls) if (mine(c, e)) c.events.push(ev); }
        else {
          const s = this.slots[e.to];
          if (s && s.client && s.client.ready) s.client.events.push(ev);
        }
      } else if (e.t === 'sfx') {
        const ev = ['s', e.k, e.x == null ? null : Math.round(e.x), e.y == null ? null : Math.round(e.y), e.r];
        for (const c of cls) if (mine(c, e) && (e.x == null || this.near(c, e.x, e.y, e.r + 40))) c.events.push(ev);
      } else if (e.t === 'fx') {
        const ev = ['f', e.k, Math.round(e.x), Math.round(e.y), e.n];
        for (const c of cls) if (mine(c, e) && (e.k === 'flight' || this.near(c, e.x, e.y, 420))) c.events.push(ev);
      }
    }
    G.events.length = 0;
  }

  near(cl, x, y, r) { return Math.hypot(cl.focus.x - x, cl.focus.y - y) < r; }

  // where a client is looking: the camera it reported lately, else its ant
  // (or where it died), else its nest's entrance
  updateFocus(cl) {
    if (cl.cam && Date.now() - cl.cam.t < 1000) { cl.focus.x = cl.cam.x; cl.focus.y = cl.cam.y; return; }
    const p = this.sim.G.players[cl.slot.idx];
    const f = p && p.ant && p.ant.hp > 0 ? p.ant : p && p.deathPos ? p.deathPos : this.sim.G.colonies[cl.colIdx || 0].entrance;
    cl.focus.x = f.x; cl.focus.y = f.y;
  }

  sendSnapshots() {
    const t0 = process.hrtime.bigint();
    const sim = this.sim;
    const frame = S.buildFrame(sim, this.mode === 'versus');
    frame.view.p = S.playersView(sim, this.slots);
    // (the scoreboard: once a second is plenty, and unchanged it isn't resent)
    // (a world started over has its clock back at the start: refresh then too)
    const sdt = sim.G.tick - (this.scoresT || 0);
    if (!this.scores || sdt >= 60 || sdt < 0) { this.scores = S.scoresView(sim, this.slots); this.scoresT = sim.G.tick; }
    frame.view.sc = this.scores;
    S.viewJson(frame);
    const edits = this.dirty.length ? S.encodeEdits(sim, this.dirty) : [];
    this.dirty = [];
    // (test builds: now and then a hash of the terrain as this snapshot
    // leaves it, for the clients' to be checked against)
    const th = cfg.DEV && ++this.snapN % 20 === 0 ? S.terrainHash(sim.T.m) : undefined;
    for (const s of this.slots) {
      const cl = s && s.client;
      if (!cl || !cl.ready) continue;
      this.updateFocus(cl);
      const msg = S.clientSnapshot(frame, cl, edits);
      // (the client tick the server's ant has caught up with, for prediction)
      if (s.inL !== null && s.inN > 0) msg.l = s.inL + s.inN - 1;
      if (th !== undefined) msg.th = th;
      cl.send(msg);
    }
    // (on the 3-tick beat even when a loop ran 2 ticks at once: 20 Hz)
    const late = sim.G.tick - this.lastSnap;
    this.lastSnap = late >= SNAP_TICKS && late < 4 * SNAP_TICKS ? sim.G.tick - late % SNAP_TICKS : sim.G.tick;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    this.stats.snapMs = this.stats.snapMs ? this.stats.snapMs * 0.95 + ms * 0.05 : ms;
    this.stats.busyMs += ms;
  }

  endMatch() {
    this.state = 'over';
    this.overAt = Date.now();
    this.sendSnapshots();
    const over = this.sim.G.over;
    for (const s of this.slots) if (s && s.client) s.client.send({ t: 'over', over });
    this.broadcastLobby();
    this.log(`room ${this.code}: match over (${over.versus ? 'winner ' + (FACTIONS[over.winner] || 'none') : over.win ? 'won' : 'lost'}, ${over.reason})`);
  }

  // ---- a persistent world ---------------------------------------------------------
  // its sim from the save on disk (or a new world); it starts asleep
  // (data: store.loadWorld's candidates, best first -- or one save)
  bootWorld(data) {
    let sim = createSim();
    let ok = false;
    const cands = Array.isArray(data) ? data : data ? [{ file: 'save', data }] : [];
    for (const c of cands) {
      try {
        ok = sim.restoreWorld(c.data, 0);
        if (!ok) this.log(`world ${this.name}: ${path.basename(c.file)} won't restore (a different map?)`);
      } catch (e) { this.log(`world ${this.name}: ${path.basename(c.file)} won't load: ${e && e.stack || e}`); }
      if (ok) {
        if (/\.bak$/.test(c.file)) {
          this.log(`world ${this.name}: loaded the backup`);
          store.quarantine(cfg.DATA_DIR, this.name, this.log, true);
        }
        break;
      }
      sim = createSim();   // (a half-restored sim isn't trusted)
    }
    if (!ok && cands.length) {
      // there are saves, and none of them loads: refuse to start over on top
      // of them unless they could be moved aside first
      if (!store.quarantine(cfg.DATA_DIR, this.name, this.log)) throw new Error('unloadable save, left in place');
    }
    if (ok) {
      sim.G.mode = 'world';
      this.seed = sim.G.seed;
      this.base = new Uint8Array(sim.genWorld(this.seed).m);
    } else {
      this.seed = randSeed();
      sim.newWorld(this.seed, 0, 'world');
      this.base = new Uint8Array(sim.T.m);
    }
    sim.T.onEdit = (x0, y0, x1, y1) => { this.dirty.push([x0, y0, x1, y1]); };
    this.sim = sim;
    this.state = 'play';
    this.lastSnap = sim.G.tick;
    this.hibernating = true;
    this.log(`world ${this.name}: ${ok ? 'loaded' : 'new'} (seed ${this.seed}, year ${sim.G.year}, legacy ${sim.G.legacy}, colony ${sim.G.gen})`);
    if (!ok) this.save('new');
  }

  // the world to disk (atomic, with a backup: see store.js)
  save(why) {
    if (!this.world || !this.sim) return false;
    const t0 = Date.now();
    let data;
    try {
      data = this.sim.serializeWorld();
      data.world = { name: this.name, savedAt: new Date().toISOString() };
    } catch (e) { this.log(`world ${this.name}: serialize failed: ${e && e.stack || e}`); return false; }
    const n = store.saveWorld(cfg.DATA_DIR, this.name, data, this.log);
    if (n < 0) return false;
    this.savedAt = Date.now();
    this.saves++;
    this.log(`world ${this.name}: saved (${why}, tick ${this.sim.G.tick}, ${Math.round(n / 1024)} KB, ${Date.now() - t0} ms)`);
    return true;
  }

  // the colony was lost with no heir: the world starts over (a new seed, a
  // fresh colony; the legacy and the history carry on) and everyone in it
  // gets the new world
  rebirth() {
    const sim = this.sim, o = sim.G.over;
    this.seed = randSeed();
    sim.rebirthWorld(this.seed);
    this.base = new Uint8Array(sim.T.m);
    this.dirty = [];
    this.lastSnap = sim.G.tick;
    for (const s of this.slots) {
      if (!s) continue;
      const p = sim.ensurePlayer(s.idx);
      p.name = s.name; p.col = 0;
      s.antId = 0;
      if (s.client) this.sendWorld(s.client);
    }
    this.log(`world ${this.name}: the colony was lost (${o && o.reason}); colony ${sim.G.gen} begins, seed ${this.seed}`);
    this.save('rebirth');
  }

  // ---- the loop -----------------------------------------------------------------
  // called by the server's loop with the time passed; returns false once the
  // room should be closed
  update(now, dtMs) {
    if (this.closed) return false;
    // lost players whose time ran out leave for good
    for (const s of this.slots.slice()) {
      if (s && !s.connected && s.lostAt && now - s.lostAt > cfg.RECONNECT_MS) this.leave(s);
    }
    if (this.world) return this.updateWorld(now, dtMs);
    // a lobby everyone left on purpose closes at once (its match slot free)
    if (this.state === 'lobby' && !this.playerCount()) { this.close('e_closed'); return false; }
    // (a player who lost the connection still holds the room: its slot is
    // kept RECONNECT_MS, so is the room)
    const waiting = this.slots.some(s => s && !s.connected && s.lostAt);
    if (this.connectedSlots().length || waiting) this.emptySince = null;
    else {
      if (this.emptySince === null) this.emptySince = now;
      if (now - this.emptySince > cfg.ROOM_IDLE_MS) { this.close('e_closed'); return false; }
    }
    if (this.state === 'over' && now - this.overAt > cfg.ROOM_OVER_MS) { this.close('e_closed'); return false; }
    if (this.state !== 'play') return true;
    return this.run(dtMs);
  }

  // a persistent world: asleep with nobody connected (no ticks at all, so
  // its colony can't die unattended), saved as it falls asleep and every
  // AUTOSAVE_MS while it runs
  updateWorld(now, dtMs) {
    const anyone = this.connectedSlots().length > 0;
    if (!anyone) {
      if (!this.hibernating) {
        this.hibernating = true;
        this.acc = 0;
        this.log(`world ${this.name}: nobody here, asleep at tick ${this.sim.G.tick}`);
        this.save('asleep');
      }
      return true;
    }
    if (this.hibernating) {
      this.hibernating = false;
      this.acc = 0;
      this.savedAt = now;
      this.log(`world ${this.name}: awake at tick ${this.sim.G.tick}`);
    }
    if (now - this.savedAt > cfg.AUTOSAVE_MS) this.save('autosave');
    return this.run(dtMs);
  }

  // the room's ticks for dtMs of real time, and the snapshots
  run(dtMs) {
    try {
      this.acc += dtMs;
      let n = 0;
      while (this.acc >= STEP_MS && n < CATCH_UP && this.state === 'play') {
        this.acc -= STEP_MS;
        this.step();
        n++;
      }
      // far behind (a stall): drop the backlog rather than race to catch up
      if (this.acc > STEP_MS * 30) this.acc = 0;
      if (this.state === 'play' && this.sim.G.tick - this.lastSnap >= SNAP_TICKS) this.sendSnapshots();
    } catch (e) {
      this.crash(e);
      return false;
    }
    return true;
  }

  // the sim threw: this room is done for (the process and the other rooms
  // carry on; a persistent world keeps its last save)
  crash(e) {
    this.log(`room ${this.label()}: CRASHED at tick ${this.sim ? this.sim.G.tick : '-'}: ${e && e.stack || e}`);
    for (const s of this.slots) if (s && s.client) s.client.send({ t: 'error', key: 'e_crash' });
    this.close('e_crash', true);
  }

  // close the room (a persistent world saves first, unless it crashed)
  close(key, crashed) {
    if (this.closed) return;
    if (this.world && !crashed) this.save('closing');
    this.closed = true;
    for (const s of this.slots) {
      if (!s || !s.client) continue;
      s.client.send({ t: 'closed', key });
      s.client.room = null; s.client.slot = null;
    }
    this.slots = [];
    this.sim = null; this.base = null;
    this.log(`room ${this.label()}: closed (${key})`);
  }

  label() { return this.world ? this.name : this.code; }

  // the CPU this room is using (ms per 16.7 ms frame; nothing while it
  // waits in the lobby or sleeps)
  load() {
    if (this.state !== 'play' || this.hibernating) return 0;
    return this.stats.tickMs + this.stats.snapMs / SNAP_TICKS;
  }

  info() {
    return {
      code: this.code, mode: this.mode, name: this.name, state: this.state, players: this.playerCount(),
      connected: this.connectedSlots().length, tick: this.sim ? this.sim.G.tick : 0,
      ants: this.sim ? this.sim.G.ants.length : 0, sleeping: this.hibernating, pub: this.pub,
      msTick: +this.stats.tickMs.toFixed(3), msTickMax: +this.stats.tickMax.toFixed(2),
      msSnap: +this.stats.snapMs.toFixed(3), ticks: this.stats.ticks, busyMs: +this.stats.busyMs.toFixed(1), stepMs: +this.stats.stepMs.toFixed(1),
      saves: this.saves,
    };
  }
}

module.exports = { Room, STEP_MS, MODES, FACTIONS };
