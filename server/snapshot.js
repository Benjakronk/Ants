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
// versus: the map's fog. A player's ant is sent to the other side only
// while one of that side's eyes is on it: a client's view (its camera,
// else its ant -- the 320x176 view, the camera's lean and a margin), a
// player's ant, or (nearer) any of its NPC ants. Out of sight it is gone
// from that side's model (and so from its map); the ant carrying a golden
// seed is always in plain view. What a hidden ant carries is hidden with
// it, and a seed lying loose shows to the other side only within sight.
const SIGHT_X = 220, SIGHT_Y = 140;
const NPC_SIGHT_X = 110, NPC_SIGHT_Y = 70;

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
// (vs: a versus match -- each side gets only the other colony's public face,
// and the other side's players only where it can see them; eyes: per side,
// its clients' points of view, see fog)
// ---------------------------------------------------------------------------
function buildFrame(sim, vs, eyes) {
  const G = sim.G, tick = G.tick;
  const hit = e => e.hitT !== undefined && tick - e.hitT < P.HIT_T;
  const ants = [], brood = [], bugs = [], items = [];
  // (e.hide: the sides an entity is kept from, a bit each)
  const fg = vs ? fog(G, eyes || [[], []]) : null;
  const hideOf = a => fg && a ? fg.hide.get(a.id) || 0 : 0;
  for (const a of G.ants) {
    if (a.hp <= 0) continue;
    const bits = (a.dir > 0 ? P.A_DIR : 0) | (a.climbing ? P.A_CLIMB : 0) | (a.ceiling ? P.A_CEIL : 0) |
      (a.flash > 0 ? P.A_FLASH : 0) | (a.biteAnim > 3 ? P.A_BITE : 0) | (a.raiding ? P.A_RAID : 0) |
      (a.raidRole === 'steal' ? P.A_STEAL : 0) | (hit(a) ? P.A_HIT : 0);
    const rec = [a.id, a.colony ? a.colony.idx : 0, CASTE_IDX[a.caste] | 0, q(a.x), q(a.y), bits, hpq(a.hp),
      a.carry ? a.carry.id : 0, a.playerIdx];
    ants.push({ id: a.id, x: a.x, y: a.y, rec, key: rec.join(','), hot: a.playerIdx >= 0, hide: hideOf(a) });
  }
  for (const b of G.brood) {
    if (b.dead) continue;
    const bits = (b.kind === 'larva' ? P.B_LARVA : 0) | (b.royal ? P.B_ROYAL : 0) |
      (b.hungry ? P.B_HUNGRY : 0) | (b.carried ? P.B_CARRIED : 0);
    const rec = [b.id, b.colony ? b.colony.idx : 0, q(b.x), q(b.y), bits];
    brood.push({ id: b.id, x: b.x, y: b.y, rec, key: rec.join(','), hide: b.carried ? hideOf(b.carried) : 0 });
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
    // (the last field: 1 a piece of the contested fruit, 2 + colony a golden seed)
    const rec = [it.id, ITEM_IDX[it.kind] | 0, q(it.x), q(it.y), it.carried ? it.carried.id : 0,
      it.site ? 1 : it.rcol !== undefined ? 2 + it.rcol : 0];
    let hide = it.carried ? hideOf(it.carried) : 0;
    if (fg && !it.carried && it.rcol !== undefined && !fg.seen(1 - it.rcol, it.x, it.y)) hide = 1 << (1 - it.rcol);
    items.push({ id: it.id, x: it.x, y: it.y, rec, key: rec.join(','), hide });
  }
  const frame = { tick, lists: { a: ants, b: brood, u: bugs, i: items }, view: buildView(sim), vs: !!vs };
  if (vs) frame.pub = publicView(frame.view);
  return frame;
}

// versus: who each side can see (see SIGHT_X). Returns { hide: ant id ->
// the bits of the sides it is hidden from, seen(side, x, y) }.
function fog(G, eyes) {
  const hide = new Map();
  const look = [[], []];   // per side: [x, y, half width, half height]
  for (let s = 0; s < 2; s++) for (const e of eyes[s] || []) look[s].push([e.x, e.y, SIGHT_X, SIGHT_Y]);
  const players = [];
  for (const a of G.ants) {
    const s = a.colony ? a.colony.idx : -1;
    if (a.hp <= 0 || s < 0 || s > 1) continue;
    if (a.playerIdx >= 0) { players.push(a); look[s].push([a.x, a.y, SIGHT_X, SIGHT_Y]); }
    else look[s].push([a.x, a.y, NPC_SIGHT_X, NPC_SIGHT_Y]);
  }
  const seen = (s, x, y) => {
    for (const l of look[s] || []) if (Math.abs(l[0] - x) < l[2] && Math.abs(l[1] - y) < l[3]) return true;
    return false;
  };
  for (const a of players) {
    const o = 1 - a.colony.idx;
    // (a golden seed glows: its carrier is in plain view)
    if (a.carry && a.carry.kind === 'relic') continue;
    if (!seen(o, a.x, a.y)) hide.set(a.id, 1 << o);
  }
  return { hide, seen };
}

// colony-level state, by key; a client is sent a key when its JSON changed
function buildView(sim) {
  const G = sim.G;
  const v = {};
  const cs = G.contested;
  v.g = { lfy: G.lastFlightYear, cs: cs ? { x: Math.round(cs.x), y: Math.round(cs.y), active: !!cs.active } : null, mode: G.mode };
  // (a persistent world's legacy and story)
  if (G.mode === 'world') Object.assign(v.g, { leg: G.legacy, gen: G.gen, hist: G.history.slice(-12) });
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
    // the builders' stocks, a key of their own (they change by the pixel
    // as the ants dig; the blueprint itself goes as deltas, see room.js)
    if (c.player) v['k' + c.idx] = { soil: Math.floor(c.stock.soil), thatch: Math.floor(c.stock.thatch) };
    if (c.objectives) v['o' + c.idx] = c.objectives;
    // (its golden seed: where it is and how it stands, this year's count --
    // its own side's to know, like the milestones)
    const rs = c.player && G.relics ? G.relics.side[c.idx] : null;
    if (c.player) v['r' + c.idx] = rs ? { ph: rs.ph, x: rs.x, y: rs.y, until: rs.until, got: rs.yr === G.year ? rs.got : 0, held: !!rs.held } : null;
    // (a done task counts down on the server; the client only needs "done")
    if (c.player) v['t' + c.idx] = c.tasks.map(t => Object.assign({}, t, { doneT: t.done ? 1 : 0 }));
  }
  return v;
}

// versus: what one side may know of the other colony -- what it could see
// for itself (the nest, its chambers and mound, its queen found or slain)
// but not its stores, crystals, upgrades, milestones or tasks (the food
// pile drawn at its storage is rounded off)
const PRIVATE = ['crystals', 'score', 'caps', 'upg', 'raid'];
function publicView(view) {
  const pub = {};
  for (const k in view) {
    if (k[0] !== 'c') continue;
    const o = Object.assign({}, view[k]);
    for (const f of PRIVATE) delete o[f];
    o.food = Math.floor(o.food / 30) * 30;
    o.chambers = o.chambers.map(ch => { const c = Object.assign({}, ch); delete c.leaves; return c; });
    pub[k] = o;
  }
  return pub;
}

// the view key for the scoreboard: each player's tally (see newPlayerStats),
// [kills, deaths, food, dug, built] -- the room refreshes it once a second
function scoresView(sim, slots) {
  return sim.G.players.map((p, i) => slots[i] && p.stats ?
    [p.stats.kills, p.stats.deaths, Math.round(p.stats.food), p.stats.dug, p.stats.built] : null);
}

// the view keys for the personal milestones: 'q' + colony index, by player
// index (null for players not on that side): [tiers (a digit a track, in
// PERSONAL's order), preds, care, frost (seconds), crystals, milked,
// planned, lives] -- the rest of the tally is the scoreboard's. Each side
// sees only its own key in versus (see clientSnapshot); the other side's
// show on the end screen only. Refreshed with the scores.
function personalView(sim, slots, vs) {
  const G = sim.G, out = {};
  const ids = sim.PERSONAL.map(t => t.id);
  for (const c of G.colonies) {
    if (!c.player) continue;
    out['q' + c.idx] = G.players.map((p, i) => {
      if (!slots[i] || !p.stats || (vs && (p.col || 0) !== c.idx)) return null;
      const s = p.stats;
      return [ids.map(id => s.pm[id] || 0).join(''), s.preds, s.care, Math.floor(s.frost / 60), s.crystals, s.milked, s.planned, s.lives];
    });
  }
  return out;
}

// the view key for the players (names, ants, loads), from the room's slots
function playersView(sim, slots) {
  return sim.G.players.map((p, i) => {
    const s = slots[i];
    if (!s) return null;
    const a = p.ant && p.ant.hp > 0 ? p.ant : null;
    return {
      n: s.name, on: s.connected ? 1 : 0, a: a ? a.id : 0, bm: p.buildMat, c: p.col || 0, h: s.hue,
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
    const side = 1 << (cl.colIdx || 0);
    for (const e of frame.lists[type]) {
      // (out of this side's sight, see fog: as if it weren't there)
      if (e.hide & side) continue;
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
    let v = frame.view[k], s = frame.viewJson[k];
    // (versus: the other side's colony only by its public face; its
    // milestones, tasks, stocks, personal milestones and golden seed not at all)
    if (frame.vs && 'cotkqr'.includes(k[0]) && Number(k.slice(1)) !== (cl.colIdx || 0)) {
      if (k[0] !== 'c') continue;
      v = frame.pub[k]; s = frame.pubJson[k];
    }
    if (d.view.get(k) === s) continue;
    d.view.set(k, s);
    view[k] = v;
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
  if (frame.pub) {
    frame.pubJson = {};
    for (const k in frame.pub) frame.pubJson[k] = JSON.stringify(frame.pub[k]);
  }
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

module.exports = { terrainHash, fog, SIGHT_X, SIGHT_Y, buildFrame, viewJson, playersView, scoresView, personalView, clientSnapshot, freshDelta, encodeEdits, mergeRects, NEAR_X, NEAR_Y };
