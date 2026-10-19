// MAUR -- save / load. Three slots in localStorage, terrain RLE-packed.
'use strict';

const SAVE_PREFIX = 'maur_world_';

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
  return {
    id: a.id, caste: a.caste, x: Math.round(a.x), y: Math.round(a.y),
    hp: Math.round(a.hp * 10) / 10, playerIdx: a.playerIdx,
    carryId: a.carry ? a.carry.id : 0,
    soil: Math.round(a.soil || 0), thatch: Math.round(a.thatch || 0),
  };
}
function serializeBrood(b) {
  return {
    id: b.id, kind: b.kind, x: Math.round(b.x), y: Math.round(b.y),
    age: b.age, feedCount: b.feedCount, hungry: b.hungry, hungerT: b.hungerT,
  };
}
function serializeBug(b) {
  return {
    id: b.id, kind: b.kind, x: Math.round(b.x), y: Math.round(b.y),
    hp: Math.round(b.hp), fleeing: b.fleeing,
    resident: b.resident || false,
    homeX: b.homeX == null ? null : Math.round(b.homeX),
  };
}
function serializeItem(it) {
  return {
    id: it.id, kind: it.kind, x: Math.round(it.x), y: Math.round(it.y),
    value: it.value, carriedBy: it.carried ? it.carried.id : 0,
  };
}

function saveWorld(slot) {
  if (!G || !G.running) return false;
  const c = G.colony;
  // v3: chambers, building loads, surface line, packed-earth wear, build
  // material.
  // restoreWorld still loads v2 saves (missing fields get defaults).
  const data = {
    v: 3,
    w: WORLD_W, h: WORLD_H,
    seed: G.seed,
    tick: G.tick,
    day: G.day,
    playerCount: G.players.length,
    terrain: rleEncode(T.m),
    colony: {
      food: Math.round(c.food * 10) / 10, score: c.score,
      eggT: c.eggT, lastDigTaskDay: c.lastDigTaskDay,
      lastRaidDay: c.lastRaidDay || 0,
      lastCrystalTaskDay: c.lastCrystalTaskDay || 0,
      tasks: c.tasks.filter(t => !t.done),
      stats: c.stats,
      chambers: c.chambers.map(ch => {
        const o = { id: ch.id, type: ch.type, x: ch.x, y: ch.y, area: ch.area, claimed: ch.claimed };
        if (ch.anchor) o.anchor = true;
        return o;
      }),
      nextChamberId: c.nextChamberId,
    },
    surf: int16Encode(T.surf),
    wear: T.wearList(),
    buildMats: G.players.map(p => p.buildMat),
    nextId: ENT_ID,
    ants: G.ants.filter(a => a.hp > 0).map(serializeAnt),
    brood: G.brood.filter(b => !b.dead).map(serializeBrood),
    bugs: G.bugs.filter(b => !b.dead).map(serializeBug),
    items: G.items.filter(i => !i.dead).map(serializeItem),
  };
  try {
    localStorage.setItem(SAVE_PREFIX + slot, JSON.stringify(data));
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
  try {
    const d = JSON.parse(raw);
    return {
      day: d.day, ants: d.ants.length, food: Math.round(d.colony.food),
      score: d.colony.score, playerCount: d.playerCount,
    };
  } catch (e) { return null; }
}

function deleteWorld(slot) {
  localStorage.removeItem(SAVE_PREFIX + slot);
}
