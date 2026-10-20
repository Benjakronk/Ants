// MAUR server -- what a room's clients are sent 20 times a second. Each
// snapshot carries, per client, only what changed since that client's last
// one: entity records that differ (all of them near the player's view, the
// rest of the world a tenth as often -- the map and the guide arrow still
// see it), the ids of entities gone, the colony-level state that changed,
// this client's share of the sim's events, and the terrain edited.
'use strict';

const path = require('path');
const { JS_DIR } = require('./config');
const P = require(path.join(JS_DIR, 'netproto.js'));

const NEAR_X = 480, NEAR_Y = 360;   // around the player's view: every snapshot
const FAR_EVERY = 10;               // the rest of the world: every 10th (2 Hz)
const EVENTS_MAX = 80;              // events a client gets per snapshot at most

const CASTE_IDX = Object.fromEntries(P.CASTES.map((c, i) => [c, i]));
const BUG_IDX = Object.fromEntries(P.BUGS.map((c, i) => [c, i]));
const ITEM_IDX = Object.fromEntries(P.ITEMS.map((c, i) => [c, i]));

const q = v => Math.round(v * 2);                 // half pixels
const r1 = v => Math.round(v * 10) / 10;
const pt = p => ({ x: Math.round(p.x), y: Math.round(p.y) });
// health as a whole number, never 0 while alive (bars, "dead")
const hpq = hp => hp > 0 ? Math.max(1, Math.floor(hp)) : 0;

// ---------------------------------------------------------------------------
// the world as records, built once per snapshot and shared by every client
// ---------------------------------------------------------------------------
function buildFrame(sim) {
  const G = sim.G, tick = G.tick;
  const hit = e => e.hitT !== undefined && tick - e.hitT < P.HIT_T;
  const ants = [], brood = [], bugs = [], items = [];
  for (const a of G.ants) {
    if (a.hp <= 0) continue;
    const bits = (a.dir > 0 ? P.A_DIR : 0) | (a.climbing ? P.A_CLIMB : 0) | (a.ceiling ? P.A_CEIL : 0) |
      (a.flash > 0 ? P.A_FLASH : 0) | (a.biteAnim > 3 ? P.A_BITE : 0) | (a.raiding ? P.A_RAID : 0) |
      (a.raidRole === 'steal' ? P.A_STEAL : 0) | (hit(a) ? P.A_HIT : 0);
    const rec = [a.id, a.colony ? a.colony.idx : 0, CASTE_IDX[a.caste] | 0, q(a.x), q(a.y), bits, hpq(a.hp),
      a.carry ? a.carry.id : 0, a.playerIdx];
    ants.push({ id: a.id, x: a.x, y: a.y, rec, key: rec.join(','), hot: a.playerIdx >= 0 });
  }
  for (const b of G.brood) {
    if (b.dead) continue;
    const bits = (b.kind === 'larva' ? P.B_LARVA : 0) | (b.royal ? P.B_ROYAL : 0) |
      (b.hungry ? P.B_HUNGRY : 0) | (b.carried ? P.B_CARRIED : 0);
    const rec = [b.id, b.colony ? b.colony.idx : 0, q(b.x), q(b.y), bits];
    brood.push({ id: b.id, x: b.x, y: b.y, rec, key: rec.join(',') });
  }
  for (const b of G.bugs) {
    if (b.dead) continue;
    const bits = (b.dir > 0 ? P.U_DIR : 0) | (b.flash > 0 ? P.U_FLASH : 0) | (b.curl > 0 ? P.U_CURL : 0) |
      (b.fleeing ? P.U_FLEE : 0) | (hit(b) ? P.U_HIT : 0) | (b.climbing ? P.U_CLIMB : 0);
    const rec = [b.id, BUG_IDX[b.kind] | 0, q(b.x), q(b.y), bits, hpq(b.hp)];
    if (b.kind === 'worm' || b.kind === 'centipede') for (const t of b.trail) rec.push(q(t.x), q(t.y));
    bugs.push({ id: b.id, x: b.x, y: b.y, rec, key: rec.join(',') });
  }
  for (const it of G.items) {
    if (it.dead) continue;
    const rec = [it.id, ITEM_IDX[it.kind] | 0, q(it.x), q(it.y), it.carried ? it.carried.id : 0, it.site ? 1 : 0];
    items.push({ id: it.id, x: it.x, y: it.y, rec, key: rec.join(',') });
  }
  return { tick, lists: { a: ants, b: brood, u: bugs, i: items }, view: buildView(sim) };
}

// colony-level state, by key; a client is sent a key when its JSON changed
function buildView(sim) {
  const G = sim.G;
  const v = {};
  const cs = G.contested;
  v.g = { lfy: G.lastFlightYear, cs: cs ? { x: Math.round(cs.x), y: Math.round(cs.y), active: !!cs.active } : null };
  for (const c of G.colonies) {
    v['c' + c.idx] = {
      food: r1(c.food), crystals: c.crystals, score: c.score, caps: c.caps,
      mound: c.mound, sealed: c.sealed, upg: c.upg,
      defeated: !!c.defeated, slain: !!c.slain, queenSeen: !!c.queenSeen,
      raid: c.raid ? { phase: c.raid.phase, target: c.raid.target, stolen: r1(c.raid.stolen || 0), warned: !!c.raid.warned } : null,
      x: Math.round(c.x), entrance: pt(c.entrance), junction: pt(c.junction), storage: pt(c.storage),
      nursery: pt(c.nursery), queenCh: pt(c.queenCh),
      chambers: c.chambers.map(ch => {
        const o = { id: ch.id, type: ch.type, x: ch.x, y: ch.y, area: ch.area };
        if (ch.anchor) o.anchor = true;
        if (ch.leaves) o.leaves = r1(ch.leaves);
        return o;
      }),
      shelters: c.shelters.map(sh => ({ x: sh.x, y: sh.y })),
    };
    if (c.objectives) v['o' + c.idx] = c.objectives;
    // (a done task counts down on the server; the client only needs "done")
    if (c.player) v['t' + c.idx] = c.tasks.map(t => Object.assign({}, t, { doneT: t.done ? 1 : 0 }));
  }
  return v;
}

// the view key for the players (names, ants, loads), from the room's slots
function playersView(sim, slots) {
  return sim.G.players.map((p, i) => {
    const s = slots[i];
    if (!s) return null;
    const a = p.ant && p.ant.hp > 0 ? p.ant : null;
    return {
      n: s.name, on: s.connected ? 1 : 0, a: a ? a.id : 0, bm: p.buildMat,
      so: a ? Math.round(a.soil) : 0, th: a ? Math.round(a.thatch) : 0,
      dp: p.deathPos ? pt(p.deathPos) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// one client's snapshot from the shared frame (and its delta state)
// ---------------------------------------------------------------------------
function freshDelta() {
  return { a: new Map(), b: new Map(), u: new Map(), i: new Map(), view: new Map(), n: 0 };
}

function clientSnapshot(frame, cl, edits) {
  const d = cl.delta;
  const fx = cl.focus.x, fy = cl.focus.y;
  const msg = { t: 's', k: frame.tick };
  for (const type of ['a', 'b', 'u', 'i']) {
    const sent = d[type];
    const up = [];
    const seen = new Set();
    for (const e of frame.lists[type]) {
      seen.add(e.id);
      const was = sent.get(e.id);
      if (was === e.key) continue;
      // (the players' own ants always: who plays which ant must never lag
      // behind the players' list)
      const near = e.hot || (Math.abs(e.x - fx) < NEAR_X && Math.abs(e.y - fy) < NEAR_Y);
      // (anything new is sent at once, wherever it is)
      if (!near && was !== undefined && (d.n + e.id) % FAR_EVERY !== 0) continue;
      sent.set(e.id, e.key);
      up.push(e.rec);
    }
    const gone = [];
    // (sent holds every id seen: anything more is gone)
    if (sent.size > seen.size) {
      for (const id of sent.keys()) if (!seen.has(id)) gone.push(id);
      for (const id of gone) sent.delete(id);
    }
    if (up.length) msg[type] = up;
    if (gone.length) msg['r' + type] = gone;
  }
  const view = {};
  let nv = 0;
  for (const k in frame.view) {
    const s = frame.viewJson[k];
    if (d.view.get(k) === s) continue;
    d.view.set(k, s);
    view[k] = frame.view[k];
    nv++;
  }
  if (nv) msg.v = view;
  if (cl.events.length) {
    msg.e = cl.events.length > EVENTS_MAX ? cl.events.slice(-EVENTS_MAX) : cl.events;
    cl.events = [];
  }
  if (edits.length) msg.ed = edits;
  d.n++;
  return msg;
}

// the view's keys as JSON (once per frame, compared per client)
function viewJson(frame) {
  frame.viewJson = {};
  for (const k in frame.view) frame.viewJson[k] = JSON.stringify(frame.view[k]);
}

// ---------------------------------------------------------------------------
// terrain edits: the rects T.onEdit reported since the last snapshot,
// merged where they touch, each sent with its current bytes
// ---------------------------------------------------------------------------
function mergeRects(rects) {
  const out = [];
  for (const r of rects) {
    let cur = r.slice();
    let merged = true;
    while (merged) {
      merged = false;
      for (let k = 0; k < out.length; k++) {
        const o = out[k];
        if (cur[0] > o[2] + 4 || o[0] > cur[2] + 4 || cur[1] > o[3] + 4 || o[1] > cur[3] + 4) continue;
        const u = [Math.min(cur[0], o[0]), Math.min(cur[1], o[1]), Math.max(cur[2], o[2]), Math.max(cur[3], o[3])];
        const area = rc => (rc[2] - rc[0] + 1) * (rc[3] - rc[1] + 1);
        // (two far-apart corners of one big box would send a lot of nothing)
        if (area(u) > 1.6 * (area(cur) + area(o)) + 256) continue;
        cur = u;
        out.splice(k, 1);
        merged = true;
        break;
      }
    }
    out.push(cur);
  }
  return out;
}

// [x0, y0, x1, y1, bytes, surf (columns x0..x1), wear [index in rect, wear*10, ...]]
function encodeEdits(sim, rects) {
  const T = sim.T, W = sim.WORLD_W, H = sim.WORLD_H;
  const out = [];
  for (const r of mergeRects(rects)) {
    const x0 = Math.max(0, r[0]), y0 = Math.max(0, r[1]);
    const x1 = Math.min(W - 1, r[2]), y1 = Math.min(H - 1, r[3]);
    if (x1 < x0 || y1 < y0) continue;
    const wear = [];
    if (T.wear.size) {
      const w = x1 - x0 + 1;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const v = T.wear.get(y * W + x);
          if (v) wear.push((y - y0) * w + (x - x0), Math.round(v * 10));
        }
      }
    }
    out.push([x0, y0, x1, y1, P.packRect(T.m, W, x0, y0, x1, y1), P.packInt16(T.surf.subarray(x0, x1 + 1)), wear]);
  }
  return out;
}

// a quick hash of every 7th terrain byte (test builds compare it with the
// clients'; test/netprobe.js computes the same)
function terrainHash(m) {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < m.length; i += 7) h = Math.imul(h ^ m[i], 16777619);
  return h >>> 0;
}

module.exports = { terrainHash, buildFrame, viewJson, playersView, clientSnapshot, freshDelta, encodeEdits, mergeRects, NEAR_X, NEAR_Y };
