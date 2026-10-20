// MAUR server -- a room: a lobby with a code, then a match. In a match the
// room runs its own simulation at 60 Hz and sends each player 20 snapshots
// a second. A room has a mode ('coop' now; 'versus' and persistent worlds
// come later) and every player slot a faction (all 'black' in co-op).
'use strict';

const crypto = require('crypto');
const path = require('path');
const zlib = require('zlib');
const cfg = require('./config');
const { createSim } = require('./sim');
const S = require('./snapshot');
const P = require(path.join(cfg.JS_DIR, 'netproto.js'));

const STEP_MS = 1000 / 60;
const SNAP_TICKS = 3;        // a snapshot every 3 ticks: 20 Hz
const CATCH_UP = 5;          // ticks a late loop may run at once
const MODES = ['coop'];
const ONESHOTS = { act: 'act', abil: 'abil', mat: 'buildMat', mark: 'mark' };

// a uniform random 32-bit seed / an unguessable reconnect token
const randSeed = () => crypto.randomBytes(4).readUInt32LE(0);
const randToken = () => crypto.randomBytes(18).toString('base64url');

class Room {
  constructor(code, mode, log) {
    this.code = code;
    this.mode = MODES.includes(mode) ? mode : 'coop';
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
    this.stats = { tickMs: 0, tickMax: 0, snapMs: 0, ticks: 0 };
  }

  // ---- membership ------------------------------------------------------------
  connectedSlots() { return this.slots.filter(s => s && s.connected); }
  playerCount() { return this.slots.filter(Boolean).length; }

  // a new player asks to join. Returns an error key, or null (joined).
  join(cl) {
    if (this.state === 'over') return 'e_over';
    if (this.playerCount() >= cfg.MAX_PLAYERS) return 'e_full';
    let idx = this.slots.findIndex(s => !s);
    if (idx < 0) idx = this.slots.length;
    const slot = {
      idx, name: cl.name, token: randToken(), client: null, connected: false, lostAt: null,
      antId: 0, faction: 'black', input: { dx: 0, dy: 0, bite: false, build: false },
      shots: { act: 0, abil: 0, mat: 0, mark: 0 }, buys: [], take: null,
      inL: null, inN: 0,
    };
    this.slots[idx] = slot;
    if (!this.host || !this.host.connected) this.host = slot;
    this.attach(slot, cl);
    if (this.state === 'play') {
      const p = this.sim.ensurePlayer(idx);
      p.name = slot.name;
      p.col = 0;
      this.sendWorld(cl);
    }
    this.broadcastLobby();
    this.log(`room ${this.code}: ${slot.name} joined as player ${idx + 1}`);
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
      this.sendWorld(cl);
    } else if (this.state === 'over') {
      cl.send({ t: 'over', over: this.sim.G.over });
    }
    this.broadcastLobby();
    this.log(`room ${this.code}: ${slot.name} reconnected`);
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
    }
    this.passHost();
    this.broadcastLobby();
    this.log(`room ${this.code}: ${slot.name} lost the connection`);
  }

  // a player leaves for good (the menu's LEAVE, or a lost slot expiring)
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
      }
    }
    if (this.host === slot) this.host = null;
    this.passHost();
    this.broadcastLobby();
    this.log(`room ${this.code}: ${slot.name} left`);
  }

  passHost() {
    if (this.host && this.host.connected && this.slots.includes(this.host)) return;
    this.host = this.connectedSlots()[0] || this.slots.find(Boolean) || null;
  }

  broadcastLobby() {
    const players = this.slots.map(s => s && { n: s.name, on: s.connected ? 1 : 0 });
    for (const s of this.slots) {
      if (!s || !s.client) continue;
      s.client.send({
        t: 'lobby', code: this.code, mode: this.mode, state: this.state, max: cfg.MAX_PLAYERS,
        you: s.idx, host: this.host ? this.host.idx : -1, token: s.token, faction: s.faction, players,
      });
    }
  }

  // ---- the match ---------------------------------------------------------------
  // the host starts the match with everyone in the lobby
  start(cl) {
    if (this.state !== 'lobby') return 'e_started';
    if (cl.slot !== this.host) return 'e_notHost';
    const sim = createSim();
    const seed = randSeed();
    sim.newWorld(seed, this.slots.length);
    this.base = new Uint8Array(sim.T.m);
    sim.T.onEdit = (x0, y0, x1, y1) => { this.dirty.push([x0, y0, x1, y1]); };
    this.sim = sim;
    this.seed = seed;
    this.state = 'play';
    this.acc = 0;
    this.lastSnap = sim.G.tick;
    for (const s of this.slots) {
      const p = sim.G.players[s.idx];
      p.name = s.name;
      p.col = 0;
      // (someone who dropped out in the lobby finds its ant waiting)
      if (!s.connected) { const a = sim.releasePlayer(s.idx); s.antId = a ? a.id : 0; }
    }
    this.log(`room ${this.code}: match started, ${this.slots.length} player(s), seed ${seed}`);
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
      t: 'world', v: P.VERSION, seed: this.seed, tick: G.tick, mode: this.mode,
      you: cl.slot.idx, w: this.sim.WORLD_W, h: this.sim.WORLD_H,
      full: full ? 1 : 0, terr: z.toString('base64'), hash: P.hashBytes(T.m),
      surf: P.packInt16(T.surf), wear: T.wearList(),
    });
    cl.delta = S.freshDelta();
    cl.events = [];
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
        const ref = p.ant && p.ant.hp > 0 ? p.ant : p.deathPos || G.colony.entrance;
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
    if (this.sim.G.over && this.state === 'play') this.endMatch();
  }

  // the sim's events go to the players they concern: a message to its
  // player (or everyone), sounds and particles to those near enough
  drainEvents() {
    const G = this.sim.G;
    if (!G.events.length) return;
    const cls = [];
    for (const s of this.slots) if (s && s.client && s.client.ready) cls.push(s.client);
    for (const e of G.events) {
      if (e.t === 'msg') {
        const ev = ['m', e.key, e.args, e.color, e.to < 0 ? 0 : 1];
        if (e.to < 0) { for (const c of cls) c.events.push(ev); }
        else {
          const s = this.slots[e.to];
          if (s && s.client && s.client.ready) s.client.events.push(ev);
        }
      } else if (e.t === 'sfx') {
        const ev = ['s', e.k, e.x == null ? null : Math.round(e.x), e.y == null ? null : Math.round(e.y), e.r];
        for (const c of cls) if (e.x == null || this.near(c, e.x, e.y, e.r + 40)) c.events.push(ev);
      } else if (e.t === 'fx') {
        const ev = ['f', e.k, Math.round(e.x), Math.round(e.y), e.n];
        for (const c of cls) if (e.k === 'flight' || this.near(c, e.x, e.y, 420)) c.events.push(ev);
      }
    }
    G.events.length = 0;
  }

  near(cl, x, y, r) { return Math.hypot(cl.focus.x - x, cl.focus.y - y) < r; }

  // where a client is looking: the camera it reported lately, else its ant
  // (or where it died), else the nest's entrance
  updateFocus(cl) {
    if (cl.cam && Date.now() - cl.cam.t < 1000) { cl.focus.x = cl.cam.x; cl.focus.y = cl.cam.y; return; }
    const p = this.sim.G.players[cl.slot.idx];
    const f = p && p.ant && p.ant.hp > 0 ? p.ant : p && p.deathPos ? p.deathPos : this.sim.G.colony.entrance;
    cl.focus.x = f.x; cl.focus.y = f.y;
  }

  sendSnapshots() {
    const t0 = process.hrtime.bigint();
    const sim = this.sim;
    const frame = S.buildFrame(sim);
    frame.view.p = S.playersView(sim, this.slots);
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
  }

  endMatch() {
    this.state = 'over';
    this.overAt = Date.now();
    this.sendSnapshots();
    const over = this.sim.G.over;
    for (const s of this.slots) if (s && s.client) s.client.send({ t: 'over', over });
    this.broadcastLobby();
    this.log(`room ${this.code}: match over (${over.win ? 'won' : 'lost'}, ${over.reason})`);
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
  // carry on)
  crash(e) {
    this.log(`room ${this.code}: CRASHED at tick ${this.sim ? this.sim.G.tick : '-'}: ${e && e.stack || e}`);
    for (const s of this.slots) if (s && s.client) s.client.send({ t: 'error', key: 'e_crash' });
    this.close('e_crash');
  }

  close(key) {
    if (this.closed) return;
    this.closed = true;
    for (const s of this.slots) {
      if (!s || !s.client) continue;
      s.client.send({ t: 'closed', key });
      s.client.room = null; s.client.slot = null;
    }
    this.slots = [];
    this.sim = null; this.base = null;
    this.log(`room ${this.code}: closed (${key})`);
  }

  info() {
    return {
      code: this.code, mode: this.mode, state: this.state, players: this.playerCount(),
      connected: this.connectedSlots().length, tick: this.sim ? this.sim.G.tick : 0,
      ants: this.sim ? this.sim.G.ants.length : 0,
      msTick: +this.stats.tickMs.toFixed(3), msTickMax: +this.stats.tickMax.toFixed(2),
      msSnap: +this.stats.snapMs.toFixed(3),
    };
  }
}

module.exports = { Room, STEP_MS, MODES };
