// MAUR -- save / load. The world as plain data (serializeWorld; the sim's
// restoreWorld rebuilds it), terrain RLE-packed. The first half is shared
// with the server, which keeps its persistent worlds as JSON files on disk;
// the second half is this browser's three save slots in localStorage.
'use strict';

const SAVE_PREFIX = 'maur_world_';
// v3: chambers, building loads, surface line, packed-earth wear, build
// material. v4: the calendar (implicit in tick), milestones, crystals and
// upgrades, aphid shelters, fungus garden stock, royal brood, the last
// nuptial flight. v5: every colony (G.colonies: the players' and the
// red rival, each with its milestones, raid and growth), each ant's and
// brood's colony, the contested food site. v6: each colony's ledger of
// who wounded its queen lately (the red-queen bonus needs a real hand in
// her death). v7: the world's mode (a persistent world on the server),
// its legacy points, history and generation. v8: the players the world is
// balanced for (G.playerSlots; older saves: their player count).
// restoreWorld still loads v2-v7 saves (missing fields get defaults).
const SAVE_VERSION = 8;

// run-length encode the terrain bytes: [val, lo(count), hi(count)] triplets
function rleEncode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let run = 1;
    while (i + run < arr.length && arr[i + run] === v && run < 65535) run++;
    out.push(v, run & 0xFF, (run >> 8) & 0xFF);
    i += run;
  }
  // bytes -> base64, chunked to avoid call-stack limits
  let bin = '';
  const CH = 8192;
  for (let o = 0; o < out.length; o += CH) {
    bin += String.fromCharCode.apply(null, out.slice(o, o + CH));
  }
  return btoa(bin);
}

function rleDecode(b64, len) {
  const bin = atob(b64);
  const arr = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i + 2 < bin.length; i += 3) {
    const v = bin.charCodeAt(i);
    const run = bin.charCodeAt(i + 1) | (bin.charCodeAt(i + 2) << 8);
    arr.fill(v, p, p + run);
    p += run;
  }
  return arr;
}

// the surface line (Int16 per column), as plain little-endian base64
function int16Encode(arr) {
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i] & 0xFF, (arr[i] >> 8) & 0xFF);
  return btoa(bin);
}
function int16Decode(b64, len) {
  const bin = atob(b64);
  const arr = new Int16Array(len);
  for (let i = 0; i < len && 2 * i + 1 < bin.length; i++) {
    arr[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16 >> 16;
  }
  return arr;
}

function serializeAnt(a) {
  const o = {
    id: a.id, caste: a.caste, x: Math.round(a.x), y: Math.round(a.y),
    hp: Math.round(a.hp * 10) / 10, playerIdx: a.playerIdx,
    carryId: a.carry ? a.carry.id : 0,
    soil: Math.round(a.soil || 0), thatch: Math.round(a.thatch || 0),
    col: a.colony ? a.colony.idx : 0,
  };
  if (a.raiding) { o.raiding = true; o.raidRole = a.raidRole; }
  return o;
}
function serializeBrood(b) {
  return {
    id: b.id, kind: b.kind, x: Math.round(b.x), y: Math.round(b.y),
    age: Math.round(b.age), feedCount: b.feedCount, hungry: b.hungry, hungerT: b.hungerT,
    royal: b.royal || false, col: b.colony ? b.colony.idx : 0,
  };
}
function serializeBug(b) {
  return {
    id: b.id, kind: b.kind, x: Math.round(b.x), y: Math.round(b.y),
    hp: Math.round(b.hp), fleeing: b.fleeing,
  };
}
function serializeItem(it) {
  const o = {
    id: it.id, kind: it.kind, x: Math.round(it.x), y: Math.round(it.y),
    value: it.value, carriedBy: it.carried ? it.carried.id : 0,
    age: Math.round(it.age || 0),   // the rot timer (older saves: fresh)
  };
  if (it.site) o.site = true;       // a piece of the contested site's fruit
  return o;
}
function serializeColony(c) {
  return {
    faction: c.faction,
    food: Math.round(c.food * 10) / 10, score: c.score,
    eggT: c.eggT, lastDigTaskDay: c.lastDigTaskDay,
    lastRaidDay: c.lastRaidDay || 0,
    lastCrystalTaskDay: c.lastCrystalTaskDay || 0,
    tasks: c.tasks.filter(t => !t.done),
    stats: c.stats,
    chambers: c.chambers.map(ch => {
      const o = { id: ch.id, type: ch.type, x: ch.x, y: ch.y, area: ch.area, claimed: ch.claimed };
      if (ch.anchor) o.anchor = true;
      if (ch.leaves) o.leaves = Math.round(ch.leaves * 10) / 10;
      return o;
    }),
    nextChamberId: c.nextChamberId,
    crystals: c.crystals,
    upg: Object.assign({}, c.upg),
    shelters: c.shelters.map(sh => ({ x: sh.x, y: sh.y, t: sh.t })),
    objectives: c.objectives,
    defeated: c.defeated, slain: c.slain, queenSeen: c.queenSeen,
    raid: c.raid, expandN: c.expandN, lastExpandDay: c.lastExpandDay, digJob: c.digJob,
    queenDmg: roundAll(c.queenDmg),
  };
}

// a { key: number } table with its numbers rounded to a tenth
function roundAll(t) {
  const o = {};
  for (const k in t || {}) o[k] = Math.round(t[k] * 10) / 10;
  return o;
}

// the whole world as plain data (JSON-safe)
function serializeWorld() {
  return {
    v: SAVE_VERSION,
    w: WORLD_W, h: WORLD_H,
    seed: G.seed,
    tick: G.tick,
    day: G.day,
    mode: G.mode,
    legacy: G.legacy, history: G.history, gen: G.gen,
    playerCount: G.players.length, slots: playerSlots(), avg: G.playerAvg,
    terrain: rleEncode(T.m),
    colonies: G.colonies.map(serializeColony),
    lastFlightYear: G.lastFlightYear,
    flight: G.flight,
    contested: G.contested,
    surf: int16Encode(T.surf),
    wear: T.wearList(),
    buildMats: G.players.map(p => p.buildMat),
    nextId: ENT_ID,
    ants: G.ants.filter(a => a.hp > 0).map(serializeAnt),
    brood: G.brood.filter(b => !b.dead).map(serializeBrood),
    bugs: G.bugs.filter(b => !b.dead).map(serializeBug),
    items: G.items.filter(i => !i.dead).map(serializeItem),
  };
}

// a saved world at a glance (the slot list, the server's world list)
function worldSummary(d) {
  // (v3 and older restart the calendar: year 1, spring)
  const day = d.v >= 4 ? d.day : 0;
  const c = d.v >= 5 ? d.colonies[0] : d.colony;
  return {
    day, ants: d.ants.filter(a => !a.col).length, food: Math.round(c.food),
    score: c.score, playerCount: d.playerCount,
    season: Math.floor(day / SEASON_DAYS) % 4, year: Math.floor(day / YEAR_DAYS) + 1,
    legacy: d.legacy || 0, gen: d.gen || 1,
  };
}

// ---------------------------------------------------------------------------
// this browser's save slots (client only)
// ---------------------------------------------------------------------------
function saveWorld(slot) {
  if (!G || !G.running) return false;
  try {
    localStorage.setItem(SAVE_PREFIX + slot, JSON.stringify(serializeWorld()));
    return true;
  } catch (e) {
    console.error('save failed', e);
    return false;
  }
}

function loadWorldData(slot) {
  const raw = localStorage.getItem(SAVE_PREFIX + slot);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function slotInfo(slot) {
  const raw = localStorage.getItem(SAVE_PREFIX + slot);
  if (!raw) return null;
  try { return worldSummary(JSON.parse(raw)); } catch (e) { return null; }
}

function deleteWorld(slot) {
  localStorage.removeItem(SAVE_PREFIX + slot);
}
