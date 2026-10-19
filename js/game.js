// MAUR -- game simulation: world state, world setup, player actions, the
// per-tick step. No DOM, canvas, audio or translation in here -- the sim talks
// to whoever renders it (the browser client now, a server later) through
// G.events, and reads each player's intent from G.players[i].input.
'use strict';

// ---------------------------------------------------------------------------
// global game object (simulation state; the client adds its own UI fields)
// ---------------------------------------------------------------------------
const G = {
  running: false,
  seed: 0,
  tick: 0,
  players: [],        // { ant, input, deathPos }
  ants: [], brood: [], bugs: [], items: [],
  pheromones: [],
  trees: [],
  colonies: [],       // [the players' black colony, the rival red one] (colony.js)
  events: [],         // outgoing: { t: 'msg'|'sfx'|'fx', ... }, drained by the client
  over: null,         // set when the year ends: { win, reason, stars, day, score, stats, ... }
  flight: null,       // the nuptial flight under way: { t, n, stars, milestones, pop, rival, rivalDead }
  lastFlightYear: 0,  // the year of the last nuptial flight (one per spring)
  contested: null,    // this summer's contested food site (colony.js)

  // the players' colony, the rival, and the players' milestones
  get colony() { return this.colonies[0] || null; },
  get rival() { return this.colonies[1] || null; },
  get objectives() { return this.colonies[0] ? this.colonies[0].objectives : null; },
  set objectives(v) { if (this.colonies[0]) this.colonies[0].objectives = v; },

  get day() { return Math.floor(this.tick / DAY_LEN); },
  tod() { return (this.tick % DAY_LEN) / DAY_LEN; },
  isNight() { return this.tod() >= 0.7; },
  // the calendar: 0 spring, 1 summer, 2 autumn, 3 winter; years count from 1
  get season() { return Math.floor(this.day / SEASON_DAYS) % 4; },
  get year() { return Math.floor(this.day / YEAR_DAYS) + 1; },
  get seasonDay() { return this.day % SEASON_DAYS; },   // 0-based day within the season
  isWinter() { return this.season === WINTER; },

  // a message by string key (translated by the client). args may hold name
  // tokens like { caste } or { bug }. `to` = a player index, or omit for all.
  msg(key, args, color, to) {
    this.events.push({ t: 'msg', key, args: args || [], color: color || null, to: to == null ? -1 : to });
  },
  // a sound; with x,y it is only heard by players within range r
  sfx(k, x, y, r) {
    this.events.push({ t: 'sfx', k, x: x == null ? null : x, y, r: r || 300 });
  },
  // a cosmetic particle burst ('dirt', 'blood', 'sparkle', 'clank')
  fx(k, x, y, n) {
    this.events.push({ t: 'fx', k, x, y, n });
  },

  makeItem(kind, x, y, value) { return new Item(kind, x, y, value); },

  nearPlayer(x, y) {
    let best = Infinity;
    for (const p of this.players) {
      if (!p.ant || p.ant.hp <= 0) continue;
      const d = Math.hypot(p.ant.x - x, p.ant.y - y);
      if (d < best) best = d;
    }
    return best;
  },

  nearestItem(x, y, r) {
    let best = null, bd = r * r;
    for (const it of this.items) {
      if (it.dead || it.carried) continue;
      const d = dist2(x, y, it.x, it.y);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  },

  nearestPredator(x, y, r) {
    let best = null, bd = r * r;
    for (const b of this.bugs) {
      if (b.dead || !b.predator || b.fleeing) continue;
      const d = dist2(x, y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  },

  // the nearest enemy of colony `col` within r: a predator, or a living ant
  // of another colony (`armed`: only the ones that threaten, see Ant.armed;
  // `spareQueen`: not a queen -- raiders come for the stores, not the crown)
  nearestFoe(x, y, r, col, armed, spareQueen) {
    let best = this.nearestPredator(x, y, r);
    let bd = best ? dist2(x, y, best.x, best.y) : r * r;
    for (const a of this.ants) {
      if (a.hp <= 0 || a.colony === col || (spareQueen && a.caste === 'queen')) continue;
      const d = dist2(x, y, a.x, a.y);
      if (d < bd && (!armed || a.armed())) { bd = d; best = a; }
    }
    return best;
  },

  nearestAnt(x, y, r, undergroundOnly) {
    let best = null, bd = r * r;
    for (const a of this.ants) {
      if (a.hp <= 0) continue;
      if (undergroundOnly && a.y < T.surf[Math.floor(Math.max(0, Math.min(WORLD_W - 1, a.x)))] + 30) continue;
      const d = dist2(x, y, a.x, a.y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  },
};

function newInput() {
  // dx/dy/bite/build are held state; act/abil/buildMat/mark are one-shot
  // presses the sim consumes; buy is a one-shot upgrade id (or null)
  return {
    dx: 0, dy: 0, bite: false, act: false, abil: false,
    build: false, buildMat: false, mark: false, buy: null,
  };
}

// what the build key places, in cycle order (gates cost soil)
const BUILD_MATS = [M_PACKED, M_THATCH, M_GATE];
const BUILD_R = 2.5, BUILD_CD = 8;

function newPlayer(ant) {
  // buildMat: selected building material; buildWarned: told "load empty"
  // (or "no room") during this press already; buildFailT: quiet time after a "nothing to
  // build on" clank; refuseT: a refused deposit lets the next E (within
  // this many ticks) just put the item down
  // col: the index of the player's colony in G.colonies (0 until versus)
  return {
    ant, input: newInput(), deathPos: null, buildMat: M_PACKED, buildWarned: false,
    buildFailT: 0, refuseT: 0, coldT: 0, col: 0,
  };
}

// the colony player pIdx plays for
function playerColony(pIdx) {
  const p = G.players[pIdx];
  return G.colonies[p ? p.col || 0 : 0];
}

// ---------------------------------------------------------------------------
// world setup
// ---------------------------------------------------------------------------
function resetWorldState(world, seed) {
  T.init(world);
  G.seed = seed;
  G.trees = world.trees;
  // both nests from the generator: the players' and the rival's (the rival
  // nest's storage, nursery and royal chamber become the red colony's)
  G.colonies = [new Colony(world.colony, 0), new Colony(world.rival, 1)];
  G.ants = []; G.brood = []; G.bugs = []; G.items = [];
  G.pheromones = []; G.events = []; G.over = null;
  G.players = [];
  G.flight = null; G.lastFlightYear = 0;
  G.contested = null;
}

// a colony's founding household: the queen, `workers` workers, `soldiers`
// soldiers, two nurses and a little brood
function populateColony(c, workers, soldiers) {
  G.ants.push(new Ant(c.queenCh.x, c.queenCh.y, 'queen', c));
  for (let i = 0; i < workers; i++) {
    const spots = [c.junction, c.storage, c.nursery];
    const s = spots[i % spots.length];
    G.ants.push(new Ant(s.x + (Math.random() - 0.5) * 20, s.y - 4, 'worker', c));
  }
  for (let i = 0; i < soldiers; i++) G.ants.push(new Ant(c.junction.x + (Math.random() - 0.5) * 16, c.junction.y, 'soldier', c));
  for (let i = 0; i < 2; i++) G.ants.push(new Ant(c.nursery.x + (Math.random() - 0.5) * 16, c.nursery.y - 4, 'nurse', c));
  for (let i = 0; i < 2; i++) {
    const l = new Brood(c.nursery.x + (Math.random() - 0.5) * 20, c.nursery.y - 2, 'larva', c);
    l.age = 600; G.brood.push(l);
  }
  G.brood.push(new Brood(c.nursery.x, c.nursery.y - 2, 'egg', c));
}

// the rival's starting numbers (its soldiers are its nest's defenders)
const RED_WORKERS = 6, RED_SOLDIERS = 3;

function newWorld(seed, playerCount) {
  const world = genWorld(seed);
  resetWorldState(world, seed);
  G.tick = Math.floor(DAY_LEN * 0.08); // start in the morning
  ENT_ID = 1;

  const c = G.colony;
  // the royal households: ours, and the rival's across the forest
  populateColony(c, 7, 2);
  populateColony(G.rival, RED_WORKERS, RED_SOLDIERS);

  // player ants
  for (let p = 0; p < playerCount; p++) {
    const a = new Ant(c.entrance.x + (p ? 8 : -8), c.entrance.y - 8, 'worker');
    a.playerIdx = p;
    G.ants.push(a);
    G.players.push(newPlayer(a));
  }

  // scatter food & fauna
  for (let i = 0; i < 18; i++) {
    const x = 40 + Math.random() * (WORLD_W - 80);
    G.items.push(G.makeItem('seed', x, T.surf[Math.floor(x)] - 8));
  }
  for (let i = 0; i < 5; i++) {
    const x = 40 + Math.random() * (WORLD_W - 80);
    G.items.push(G.makeItem('leaf', x, T.surf[Math.floor(x)] - 6));
  }
  for (const t of G.trees.slice(0, 7)) {
    G.bugs.push(new Bug(t.x + (Math.random() < 0.5 ? -5 : 5),
      T.surf[t.x] - 10 - Math.random() * 40, 'aphid'));
  }
  for (let i = 0; i < 5; i++) {
    const x = 60 + Math.random() * (WORLD_W - 120);
    G.bugs.push(new Bug(x, T.surf[Math.floor(x)] - 6, 'pillbug'));
  }
  for (let i = 0; i < 5; i++) {
    const x = 100 + Math.random() * (WORLD_W - 200);
    G.bugs.push(new Bug(x, T.surf[Math.floor(x)] + 200 + Math.random() * 400, 'worm'));
  }

  for (const col of G.colonies) col.recalcChambers();
  G.objectives = newObjectives(G.year, G.season, 0);
  G.running = true;
}


/// rebuild a world from saved data (see save.js). Returns false if the save
// can't be used with this build.
function restoreWorld(d, playerCount) {
  // saves from a different world size can't be reconciled with the new map
  if (d.w !== WORLD_W || d.h !== WORLD_H) return false;
  const world = genWorld(d.seed);
  world.m = rleDecode(d.terrain, WORLD_W * WORLD_H);
  resetWorldState(world, d.seed);
  const v = d.v || 2;
  // v3 and older had no calendar: their colony starts the year now, on the
  // first day of spring (keeping the time of day)
  G.tick = v >= 4 ? d.tick : d.tick % DAY_LEN;
  // v5 saves every colony; older ones only the players' (the rival was
  // terrain and a garrison of red bugs, migrated below)
  const saved = v >= 5 && Array.isArray(d.colonies) ? d.colonies : [d.colony];
  for (let i = 0; i < G.colonies.length; i++) if (saved[i]) restoreColony(G.colonies[i], saved[i], v);
  // the players' milestones (an old season's list is kept, its retired
  // milestones swapped for this build's)
  const ob = v >= 5 ? saved[0].objectives : d.objectives;
  G.objectives = v >= 4 && ob && Array.isArray(ob.list) && ob.year === G.year && ob.season === G.season
    ? ob : newObjectives(G.year, G.season, ob && ob.year === G.year ? ob.yearDone : 0);
  const fresh = newObjectives(G.year, G.season, 0).list;
  // (a retired milestone already won hands its credit to its replacement,
  // so it can't be counted a second time)
  G.objectives.list = G.objectives.list.map((o, i) => {
    if (objDef(o.id) || !fresh[i]) return o;
    if (o.done) { fresh[i].n = fresh[i].need; fresh[i].done = true; }
    return fresh[i];
  });
  for (const c of G.colonies) if (!c.player) c.objectives = null;
  G.lastFlightYear = d.lastFlightYear || 0;
  G.flight = d.flight || null;
  const cs = d.contested;
  G.contested = cs && typeof cs.x === 'number' ? Object.assign({ got: [] }, cs) : null;
  // the surface line as dug and built (v2 saves: the generated one). Older
  // builds let it sink down open shafts: hold it to a shallow scrape.
  if (d.surf) T.surf.set(int16Decode(d.surf, WORLD_W));
  for (let x = 0; x < WORLD_W; x++) T.surf[x] = Math.min(T.surf[x], T.bgSurf[x] + SURF_SINK);
  T.loadWear(d.wear);

  const byId = {};
  for (const s of d.ants) {
    if (!CASTE[s.caste]) continue;
    const a = new Ant(s.x, s.y, s.caste, G.colonies[s.col | 0] || G.colony);
    a.id = s.id; a.hp = Math.min(a.maxHp, s.hp); a.playerIdx = -1;
    a.soil = Math.max(0, Math.min(LOAD_CAP, s.soil || 0));
    a.thatch = Math.max(0, Math.min(LOAD_CAP, s.thatch || 0));
    if (s.raiding) { a.raiding = true; a.raidRole = s.raidRole === 'steal' ? 'steal' : 'fight'; }
    G.ants.push(a); byId[a.id] = a;
  }
  for (const s of d.brood) {
    const b = new Brood(s.x, s.y, s.kind, G.colonies[s.col | 0] || G.colony);
    b.id = s.id; b.age = s.age; b.feedCount = s.feedCount;
    b.hungry = s.hungry; b.hungerT = s.hungerT;
    b.royal = !!s.royal;
    G.brood.push(b);
  }
  const redBugs = [];
  for (const s of d.bugs) {
    if (s.kind === 'redant') { redBugs.push(s); continue; }   // (v4: the rival's garrison)
    if (!BUG_DEF[s.kind]) continue;
    const b = new Bug(s.x, s.y, s.kind);
    b.id = s.id; b.hp = s.hp; b.fleeing = s.fleeing;
    G.bugs.push(b);
  }
  for (const s of d.items) {
    if (!ITEM_DEF[s.kind]) continue;
    const it = new Item(s.kind, s.x, s.y, s.value);
    it.id = s.id;
    it.age = s.age || 0;
    if (s.site) it.site = true;
    if (s.carriedBy && byId[s.carriedBy]) {
      it.carried = byId[s.carriedBy];
      byId[s.carriedBy].carry = it;
    }
    G.items.push(it);
  }
  ENT_ID = d.nextId || 10000;
  // older rules let a colony carry on without its queen; under the new ones
  // that ends the game at once, so such a save gets a new queen
  if (v < 4 && !G.colony.queen()) {
    G.ants.push(new Ant(G.colony.queenCh.x, G.colony.queenCh.y, 'queen', G.colony));
  }
  // v4 and older: the rival becomes a living colony, its garrison of red
  // bugs its soldiers
  if (v < 5) migrateRival(redBugs);

  // reattach players (never to the queen or a princess, nor to a rival ant)
  for (let p = 0; p < playerCount; p++) {
    const mine = a => a.colony === G.colony && a.playerIdx < 0 && a.hp > 0;
    let ant = null;
    const sp = d.ants.find(s => s.playerIdx === p);
    const sa = sp && byId[sp.id];
    if (sa && mine(sa) && PLAYABLE(sa.caste)) ant = sa;
    if (!ant) ant = G.ants.find(a => mine(a) && a.caste === 'worker');
    if (!ant) ant = G.ants.find(a => mine(a) && PLAYABLE(a.caste));
    if (ant) {
      ant.playerIdx = p;
      ant.state = 'idle';
      ant.raiding = false;
    }
    const pl = newPlayer(ant);
    const bm = d.buildMats && d.buildMats[p];
    if (BUILD_MATS.includes(bm)) pl.buildMat = bm;
    G.players.push(pl);
  }

  for (const c of G.colonies) c.recalcChambers();
  G.running = true;
  return true;
}

// one colony's saved data onto the colony the world generator made (v2-v4:
// the players' colony, from d.colony; missing fields keep their defaults)
function restoreColony(col, cd, v) {
  const freshStats = Object.assign({}, col.stats);
  const genChambers = col.chambers;
  const keep = { idx: col.idx, faction: col.faction, player: col.player, gates: col.gates };
  Object.assign(col, cd, keep);
  // (a v4 hunt for one of the old red-ant bugs has nothing left to hunt)
  col.tasks = col.player && Array.isArray(cd.tasks) ? cd.tasks.filter(t => t.kind !== 'redant') : [];
  // v2 saves have no chambers: the generated nest's markers (made by the
  // Colony constructor) stand in for them. Chambers without `claimed` get
  // their current area as claimed on the recount.
  if (!Array.isArray(col.chambers) || !col.chambers.length) col.chambers = genChambers;
  col.nextChamberId = Math.max(col.nextChamberId || 1, ...col.chambers.map(c => c.id + 1));
  for (const ch of col.chambers) if (!CH_TYPES.includes(ch.type)) ch.type = 'storage';
  // v4: crystals as currency, upgrades, aphid shelters (older saves: none)
  col.food = Number(cd.food) || 0;
  col.crystals = Math.max(0, Math.floor(Number(cd.crystals) || 0));
  const upg = cd.upg || {};
  col.upg = {};
  for (const id of UPGRADE_IDS) col.upg[id] = Math.max(0, Math.min(UPGRADES[id].length, Math.floor(Number(upg[id]) || 0)));
  col.shelters = Array.isArray(cd.shelters) ? cd.shelters.map(sh => ({ x: sh.x, y: sh.y, t: sh.t || SHELTER_T })) : [];
  col.stats = Object.assign(freshStats, cd.stats || {});
  if (v < 4) col.lastDigTaskDay = col.lastRaidDay = col.lastCrystalTaskDay = 0;
  // v5: the rival as a living colony
  col.defeated = !!cd.defeated;
  col.slain = col.defeated && cd.slain !== false;   // (earlier v5 saves: all slain)
  col.queenSeen = !!cd.queenSeen;
  col.raid = cd.raid && cd.raid.phase && G.colonies[cd.raid.target] ? cd.raid : null;
  col.expandN = Math.max(0, Math.floor(Number(cd.expandN) || 0));
  col.lastExpandDay = Math.max(0, Math.floor(Number(cd.lastExpandDay) || 0));
  col.digJob = cd.digJob && Array.isArray(cd.digJob.pts) ? cd.digJob : null;
  // v6: who wounded the queen lately (older saves: nobody yet)
  col.queenDmg = {};
  if (cd.queenDmg && typeof cd.queenDmg === 'object') {
    for (const k in cd.queenDmg) if (G.colonies[k] !== undefined || k === '-1') {
      const v = Number(cd.queenDmg[k]);
      if (isFinite(v) && v > 0) col.queenDmg[k] = v;
    }
  }
  col.fullT = 0;
  col.caps = null;
}

// a v4 world's rival: the generated red nest gets its queen, workers,
// nurses and brood; the red bugs that garrisoned it (and any raiders out)
// become its soldiers, as hale as they were
function migrateRival(redBugs) {
  const r = G.rival;
  if (!r || G.ants.some(a => a.colony === r)) return;
  populateColony(r, RED_WORKERS, 0);
  r.food = 60;
  let n = 0;
  for (const s of redBugs) {
    const a = new Ant(s.x, s.y, 'soldier', r);
    a.hp = a.maxHp * Math.max(0.2, Math.min(1, (s.hp || 28) / 28));
    // raiders caught out on the old map walk home
    if (!s.resident) { a.raiding = true; a.raidRole = 'fight'; a.state = 'home'; }
    G.ants.push(a);
    n++;
  }
  for (; n < 2; n++) G.ants.push(new Ant(r.junction.x + (Math.random() - 0.5) * 16, r.junction.y, 'soldier', r));
}

// ---------------------------------------------------------------------------
// player actions
// ---------------------------------------------------------------------------

// a soldier's call to arms: nearby ants of its colony turn on the soldier's
// closest enemy. Returns the number of ants rallied, or -1 if there was no
// enemy in range (an armed one first: not a thief running off with loot
// while a soldier picks the defenders off).
function rallyAllies(soldier, radius, foe) {
  foe = foe || G.nearestFoe(soldier.x, soldier.y, 400, soldier.colony, true) ||
    G.nearestFoe(soldier.x, soldier.y, 400, soldier.colony);
  if (!foe) return -1;
  let n = 0;
  for (const a of G.ants) {
    // never the queen, nor a princess: they're the colony's future
    if (a === soldier || a.hp <= 0 || a.playerIdx >= 0 || a.colony !== soldier.colony ||
        a.caste === 'queen' || a.caste === 'princess') continue;
    if (dist2(a.x, a.y, soldier.x, soldier.y) > radius * radius) continue;
    if (a.carry) continue; // laden ants finish their errand
    a.state = 'fight';
    a.target = foe;
    a.nav = null;
    a.rallyT = 600; // courage: don't immediately flee the thing we charge
    n++;
  }
  return n;
}

// a player soldier's call to arms (Q): it reaches this far, and the soldiers
// it reaches then keep at the player's side for FOLLOW_T ticks -- an escort
// to take into the red nest (they fight whatever they meet on the way)
const RALLY_R = 280;
const FOLLOW_T = 60 * 45;
const FOLLOW_MAX = 8;

// the soldiers of the leader's colony near it fall in behind player pIdx.
// Returns how many answered.
function rallyFollow(leader, pIdx, radius) {
  let n = 0;
  for (const a of G.ants) {
    if (n >= FOLLOW_MAX) break;
    if (a === leader || a.hp <= 0 || a.playerIdx >= 0 || a.colony !== leader.colony ||
        a.caste !== 'soldier' || a.raiding) continue;
    if (dist2(a.x, a.y, leader.x, leader.y) > radius * radius) continue;
    a.followIdx = pIdx;
    a.followT = FOLLOW_T;
    if (a.state !== 'fight') { a.state = 'follow'; a.target = null; a.nav = null; }
    n++;
  }
  return n;
}

// where a player's bite or build lands: the held direction, or straight
// ahead when idle, just past the front of the body
function aimPoint(a, dx, dy) {
  let ux = dx, uy = dy;
  if (ux === 0 && uy === 0) ux = a.dir;
  const len = Math.hypot(ux, uy);
  ux /= len; uy /= len;
  return { ux, uy, bx: a.x + ux * (a.hw + 3.5), by: a.y + uy * (a.hh + 3.5) };
}

// where a build stamp goes: the aim point, stepped outward (up to BUILD_REACH
// px) past solid ground or an earlier stamp to the first spot with open air
// at its middle. Returns null when there's nothing but solid in reach.
const BUILD_REACH = 8;
function buildAim(a, dx, dy) {
  const { ux, uy, bx, by } = aimPoint(a, dx, dy);
  for (let k = 0; k <= BUILD_REACH; k += 2) {
    const x = bx + ux * k, y = by + uy * k;
    if (!T.solid(x, y)) return { bx: x, by: y };
  }
  return null;
}

// a pixel test for T.place: never wall anything in. Rejects pixels within a
// pixel of any ant, brood, bug (and worm/centipede segment) or loose item.
function buildClear(cx, cy, r) {
  const reach = r + 16;
  const boxes = [];
  const near = e => Math.abs(e.x - cx) < reach && Math.abs(e.y - cy) < reach;
  const add = e => { if (near(e)) boxes.push(e.x, e.y, e.hw + 1, e.hh + 1); };
  for (const a of G.ants) if (a.hp > 0) add(a);
  for (const b of G.brood) if (!b.dead) add(b);
  for (const it of G.items) if (!it.dead) add(it);
  for (const b of G.bugs) {
    if (b.dead) continue;
    add(b);
    for (const t of b.trail) if (near(t)) boxes.push(t.x, t.y, 2.5, 2.5);
  }
  return (x, y) => {
    for (let k = 0; k < boxes.length; k += 4) {
      if (Math.abs(x - boxes[k]) <= boxes[k + 2] && Math.abs(y - boxes[k + 1]) <= boxes[k + 3]) return false;
    }
    return true;
  };
}

// lang key naming a build material (for messages and the HUD)
function buildMatKey(m) { return m === M_THATCH ? 'mat_thatch' : m === M_GATE ? 'mat_gate' : 'mat_packed'; }

function controlPlayer(pIdx) {
  const p = G.players[pIdx];
  const a = p.ant;
  const inp = p.input;
  const col = playerColony(pIdx);
  // crystal upgrades are bought for the whole colony (alive or not)
  if (inp.buy) {
    col.buyUpgrade(inp.buy, pIdx);
    inp.buy = null;
  }
  if (!a || a.hp <= 0) { inp.act = inp.abil = inp.buildMat = inp.mark = false; return; }
  const c = a.def;

  const dx = inp.dx, dy = inp.dy;

  const SPEED = a.speedNow() * 1.5;
  a.vx = dx * SPEED;
  if (dx !== 0) a.dir = dx;

  // climbing: ants go up walls and hang from ceilings. Underground the
  // walls are implied -- every passage is a chewed-out tunnel, so holding
  // up always climbs even in wide dug-out chambers.
  a.climbing = false;
  a.ceiling = false;
  if (dy < 0) {
    let wallDir = 0;
    if (sideWall(a, a.dir)) wallDir = a.dir;
    else if (sideWall(a, -a.dir)) wallDir = -a.dir;
    else if (wallNear(a, a.dir, 5)) wallDir = a.dir;
    else if (wallNear(a, -a.dir, 5)) wallDir = -a.dir;
    const ceil = ceilAbove(a, 4);
    if (wallDir && (dx === 0 || dx === wallDir || !ceil)) {
      a.climbing = true; a.climbV = -SPEED * 1.1;
      a.dir = wallDir;
      if (dx === 0) a.vx = wallDir * SPEED * 0.6; // drift onto the wall
    } else if (ceil) {
      a.ceiling = true; // hang from the roof; crawl with left/right
    } else if (underground(a)) {
      a.climbing = true; a.climbV = -SPEED * 1.1; // tunnel climb, no wall needed
    } else if (a.onGround) {
      a.vy = -1.9; // hop
    }
  } else if (dy > 0 && !a.onGround &&
      (underground(a) ||
       sideWall(a, a.dir) || sideWall(a, -a.dir) || wallNear(a, 1, 5) || wallNear(a, -1, 5))) {
    a.climbing = true; a.climbV = SPEED * 1.1;
  }

  // bite / dig
  if (inp.bite && a.biteCd <= 0) {
    a.biteCd = a.digCdNow();
    a.biteAnim = 8;
    const { ux, uy, bx, by } = aimPoint(a, dx, dy);

    // bite a bug, or an ant of another colony?
    let bit = null, bd = 90;
    for (const bug of G.bugs) {
      if (bug.dead) continue;
      const d = dist2(bx, by, bug.x, bug.y);
      if (d < bd) { bd = d; bit = bug; }
    }
    for (const o of G.ants) {
      if (o.hp <= 0 || o.colony === a.colony) continue;
      const d = dist2(bx, by, o.x, o.y);
      if (d < bd) { bd = d; bit = o; }
    }
    if (bit) {
      bit.hurt(a.dmgNow(), ux * 1.2, uy * 0.6 - 0.3, a);
      bit.lastHitBy = 'player';
      G.sfx('bite', a.x, a.y);
    } else {
      const digR = a.digRNow();
      const res = T.dig(bx, by, digR, c.digPow);
      // second pass right at the body so the ant can sink into its own shaft
      // (power 0: packed earth only yields to the real bite)
      const res2 = T.dig(a.x + ux * 2, a.y + uy * 2, digR * 0.8, 0);
      res.count += res2.count; res.leaves += res2.leaves;
      res.fungi += res2.fungi; res.crystals += res2.crystals;
      res.natural += res2.natural;
      // the spoil goes into the mandibles as building material
      a.soil = Math.min(LOAD_CAP, a.soil + res.soil + res2.soil);
      a.thatch = Math.min(LOAD_CAP, a.thatch + res.thatch + res2.thatch);
      if (res.count > 0) {
        G.fx('dirt', bx, by, 4);
        G.sfx('dig', a.x, a.y);
        // expansion: digging out natural ground inside a marked chamber
        // claims that room for it (and counts for the dig task). Re-biting
        // your own packed earth or thatch doesn't.
        if (col.claimDug(bx, by, res.natural)) col.progress('dig', res.natural);
        // underground harvest: crystals and mushrooms tumble out of the wall
        if (res.crystals > 1) {
          G.items.push(G.makeItem('crystal', bx, by));
          G.fx('sparkle', bx, by, 6);
          G.msg('m_crystalFound', [], '#80e0ff', pIdx);
          G.sfx('task', a.x, a.y);
        } else if (res.fungi > 1 && Math.random() < 0.6) {
          G.items.push(G.makeItem('fungus', bx, by));
        } else if (res.leaves > 0 && Math.random() < 0.3 && !a.carry) {
          const it = G.makeItem('leaf', bx, by);
          G.items.push(it);
        }
      } else if (res.worn > 0) {
        // packed earth: it cracks, but holds for now
        G.fx('dirt', bx, by, 2);
        G.sfx('dig', a.x, a.y);
      } else if (T.digHitsHard(bx, by, c.digR)) {
        G.sfx('clank', a.x, a.y);
        G.fx('clank', bx, by, 1);
      }
    }
  }

  // building: R picks the material, F (held) lays it where the ant aims
  if (inp.buildMat) {
    inp.buildMat = false;
    const i = BUILD_MATS.indexOf(p.buildMat);
    p.buildMat = BUILD_MATS[(i + 1) % BUILD_MATS.length];
    G.msg('m_buildMat', [{ key: buildMatKey(p.buildMat) }], '#e0c080', pIdx);
    G.sfx('menu', a.x, a.y);
  }
  if (!inp.build) p.buildWarned = false;
  if (inp.build && a.buildCd <= 0) {
    const load = p.buildMat === M_THATCH ? 'thatch' : 'soil';
    if (a[load] < 1) {
      if (!p.buildWarned) {
        p.buildWarned = true;
        G.msg(load === 'soil' ? 'm_noSoil' : 'm_noThatch', [], '#ff8040', pIdx);
      }
    } else {
      a.buildCd = BUILD_CD;
      const aim = buildAim(a, dx, dy);
      const n = aim ? T.place(aim.bx, aim.by, BUILD_R, p.buildMat,
        buildClear(aim.bx, aim.by, BUILD_R), Math.floor(a[load])) : 0;
      if (n > 0) {
        a[load] -= n;
        a.biteAnim = 5;
        G.fx('dirt', aim.bx, aim.by, 2);
        G.sfx('build', a.x, a.y);
      } else if (p.buildFailT <= 0) {
        // no room there (solid, or someone in the way): say so, softly
        // (and once a press, why)
        p.buildFailT = 40;
        G.sfx('clank', a.x, a.y);
        if (!p.buildWarned) {
          p.buildWarned = true;
          G.msg('m_noRoom', [], '#ff8040', pIdx);
        }
      }
    }
  }
  if (p.buildFailT > 0) p.buildFailT--;
  if (p.refuseT > 0) p.refuseT--;

  // mark the chamber underfoot (or claim this cavity as a new one)
  if (inp.mark) {
    inp.mark = false;
    col.markChamber(a, pIdx);
  }

  // caste ability: soldiers rally, nurses heal
  if (inp.abil) {
    inp.abil = false;
    if (a.caste === 'soldier') {
      if (a.abilCd > 0) {
        // still catching its breath
      } else {
        // with a foe in sight everyone near turns on it; either way the
        // soldiers near fall in behind the player
        const n = rallyAllies(a, RALLY_R);
        const f = rallyFollow(a, pIdx, RALLY_R);
        if (n < 0 && f === 0) {
          G.msg('m_noRally', [], null, pIdx);
        } else {
          a.abilCd = 600;
          if (n >= 0) G.msg(n > 0 ? 'm_rally' : 'm_rallyAlone', [n], '#ff8040', pIdx);
          else G.msg('m_follow', [f], '#ff8040', pIdx);
          G.sfx('danger', a.x, a.y);
        }
      }
    } else if (a.caste === 'nurse') {
      if (a.abilCd <= 0) {
        if (col.food < 2) {
          G.msg('m_noFood', [], '#ff8040', pIdx);
        } else {
          let healed = 0;
          for (const o of G.ants) {
            if (o.hp <= 0 || o.hp >= o.maxHp || o.colony !== col) continue;
            if (dist2(a.x, a.y, o.x, o.y) > 40 * 40) continue;
            o.hp = Math.min(o.maxHp, o.hp + 10);
            G.fx('sparkle', o.x, o.y - 4, 4);
            healed++;
          }
          if (healed > 0) {
            col.food -= 2;
            a.abilCd = 360;
            G.msg('m_healed', [healed], '#80ff80', pIdx);
            G.sfx('milk', a.x, a.y);
          } else {
            G.msg('m_noWounded', [], null, pIdx);
          }
        }
      }
    }
  }

  // interact
  if (inp.act) {
    inp.act = false;
    const garden = col.chamberNear(a.x, a.y, 30, 'fungus');
    if (a.carry && a.carry.kind === 'leaf' && garden) {
      // leaves for the fungus garden
      feedGardenBy(a, pIdx, garden, LEAF_UNITS, () => { a.carry.dead = true; a.carry = null; });
    } else if (a.carry) {
      const it = a.carry;
      // the main cache, or any chamber marked as storage
      const nearStorage = Math.hypot(a.x - col.storage.x, a.y - col.storage.y) < 28 ||
        !!col.chamberNear(a.x, a.y, 30, 'storage');
      const larva = G.brood.find(l => l.kind === 'larva' && l.hungry && !l.dead && l.colony === col &&
        dist2(a.x, a.y, l.x, l.y) < 144);
      // a refused deposit (stores full) falls through to feeding a larva;
      // pressing E again straight after just puts the item down
      const tryStore = nearStorage && ITEM_DEF[it.kind] && p.refuseT <= 0;
      if (tryStore && col.deposit(it, a)) {
        // stored
      } else if (larva && ITEM_DEF[it.kind]) {
        larva.feed();
        it.dead = true; a.carry = null;
        col.progress('feed', 1);
        G.msg('m_fed', [], null, pIdx);
        G.sfx('milk', a.x, a.y);
      } else if (tryStore) {
        p.refuseT = 120;
      } else {
        it.carried = null; a.carry = null;
        it.vx = a.dir * 0.6; it.vy = -0.5;
        G.sfx('drop', a.x, a.y);
      }
    } else {
      const it = G.nearestItem(a.x, a.y, 10);
      // nurses can scoop up eggs and larvae and carry them to safety
      let broodNear = null;
      if (!it && a.caste === 'nurse') {
        let bd = 100;
        for (const br of G.brood) {
          if (br.dead || br.carried || br.colony !== col) continue;
          const d = dist2(a.x, a.y, br.x, br.y);
          if (d < bd) { bd = d; broodNear = br; }
        }
      }
      if (it) {
        it.carried = a; a.carry = it;
        G.sfx('pickup', a.x, a.y);
      } else if (broodNear) {
        broodNear.carried = a; a.carry = broodNear;
        G.msg('m_carrying', [{ brood: broodNear.kind }], null, pIdx);
        G.sfx('pickup', a.x, a.y);
      } else if (garden && a.thatch >= THATCH_PER_UNIT) {
        // a thatch load makes good garden mulch too
        feedGardenBy(a, pIdx, garden, Math.floor(a.thatch / THATCH_PER_UNIT),
          u => { a.thatch -= u * THATCH_PER_UNIT; });
      } else {
        // milk an aphid?
        const aphid = G.bugs.find(bg => bg.kind === 'aphid' && !bg.dead &&
          bg.milkCd <= 0 && dist2(a.x, a.y, bg.x, bg.y) < 150);
        if (aphid) {
          aphid.milkCd = 1800;
          const hd = G.makeItem('honeydew', a.x, a.y);
          hd.carried = a; a.carry = hd;
          G.items.push(hd);
          G.msg('m_milked', [], null, pIdx);
          G.sfx('milk', a.x, a.y);
        }
      }
    }
  }
}

// player feeds a fungus garden n units; done(u) takes them from the ant
function feedGardenBy(a, pIdx, garden, n, done) {
  if (garden.area < CH_MIN_AREA) { G.msg('m_markCramped', [], '#ff8040', pIdx); return; }
  const u = a.colony.feedGarden(garden, n);
  if (u <= 0) { G.msg('m_gardenFull', [], '#ff8040', pIdx); G.sfx('clank', a.x, a.y); return; }
  done(u);
  G.msg('m_gardenFed', [Math.round(garden.leaves)], '#a8e0b0', pIdx);
  G.sfx('deposit', a.x, a.y);
  G.fx('sparkle', a.x, a.y - 6, 3);
}

// ---------------------------------------------------------------------------
// taking over ants: on death, or a live switch. Players pick a CASTE (not an
// individual); they get the nearest free ant of that caste in their own
// colony. The queen and the princesses are never playable.
// ---------------------------------------------------------------------------
const CASTE_ORDER = ['worker', 'soldier', 'nurse'];
function PLAYABLE(caste) { return CASTE_ORDER.includes(caste); }

function takeoverOptions(pIdx) {
  const col = playerColony(pIdx || 0);
  const counts = {};
  for (const a of G.ants) {
    if (a.hp > 0 && a.playerIdx < 0 && a.colony === col && PLAYABLE(a.caste)) counts[a.caste] = (counts[a.caste] || 0) + 1;
  }
  return CASTE_ORDER.filter(c => counts[c]).map(c => ({ caste: c, count: counts[c] }));
}

// player pIdx takes the free ant of `caste` nearest (refX, refY). A living
// current ant is handed back to the colony. Returns the new ant, or null.
function takeOver(pIdx, caste, refX, refY) {
  if (!PLAYABLE(caste)) return null;
  const col = playerColony(pIdx);
  let a = null, bd = Infinity;
  for (const c of G.ants) {
    if (c.hp <= 0 || c.playerIdx >= 0 || c.caste !== caste || c.colony !== col) continue;
    const d = dist2(c.x, c.y, refX, refY);
    if (d < bd) { bd = d; a = c; }
  }
  if (!a) return null;
  const p = G.players[pIdx];
  const prev = p.ant;
  if (prev && prev.hp > 0) {
    prev.playerIdx = -1;
    prev.state = 'idle'; prev.stateT = 120;
    prev.target = null; prev.nav = null;
    prev.climbing = false; prev.ceiling = false;
  }
  a.playerIdx = pIdx;
  a.state = 'idle';
  if (a.raiding) a.endRaid();
  a.climbing = false;

  a.ceiling = false;
  a.nav = null;
  p.ant = a;
  p.deathPos = null;
  p.input = newInput();
  G.msg('m_nowPlaying', [{ caste: a.caste }], pIdx === 0 ? '#ffe080' : '#80d0ff', pIdx);
  return a;
}

// ---------------------------------------------------------------------------
// one simulation tick (1/60 s)
// ---------------------------------------------------------------------------
function stepSim() {
  G.tick++;

  for (let p = 0; p < G.players.length; p++) controlPlayer(p);

  // ants
  for (const a of G.ants) {
    if (a.hp > 0) a.update();
    if (a.playerIdx >= 0 && a.climbing) {
      // stubborn overhang: shimmy sideways, away from the wall first
      if (a.vBlocked && a.climbV < 0) {
        const vhw = Math.max(1, a.hw - 1.5);
        for (const s of [-1, -2, 1, 2]) {
          const nx = a.x + a.dir * s;
          if (!T.boxSolid(nx, a.y - 1, vhw, a.hh, a.own)) { a.x = nx; a.y -= 1; break; }
        }
      }
      a.vBlocked = false;
      // ledge-boost: only once no wall remains in grab reach -- and never
      // underground, where wall-less climbing is the whole point
      if (a.climbV < 0 && !underground(a) &&
          !wallNear(a, a.dir, 5) && !wallNear(a, -a.dir, 5)) {
        a.climbing = false; a.vy = -1.5; a.vx = a.dir * 0.8;
      }
    }
  }
  // deaths
  for (const a of G.ants) {
    if (a.hp <= 0 && !a.dead) {
      a.dead = true;
      if (a.carry) { a.carry.carried = null; a.carry = null; }
      G.items.push(G.makeItem('corpse', a.x, a.y));
      a.colony.stats.antsDied++;
      if (a.playerIdx >= 0) {
        const pIdx = a.playerIdx;
        G.sfx('die', a.x, a.y, 9999);
        for (let q = 0; q < G.players.length; q++) {
          if (q === pIdx) G.msg('m_youDied', [], '#ff5040', q);
          else G.msg('m_pDied', [pIdx + 1], '#ff5040', q);
        }
        G.players[pIdx].ant = null;
        G.players[pIdx].deathPos = { x: a.x, y: a.y };
      } else if (!a.colony.player) {
        // a rival down: the players' tally (their queen's fall is told by
        // the defeat, in updateYear)
        G.colony.stats.rivalsSlain = (G.colony.stats.rivalsSlain || 0) + 1;
        if (a.caste !== 'queen' && G.nearPlayer(a.x, a.y) < 300) G.sfx('kill', a.x, a.y);
      } else if (a.caste === 'queen') {
        G.msg('m_queenDead', [], '#ff4030');
        G.sfx('danger');
      } else if (G.nearPlayer(a.x, a.y) < 300) {
        G.msg('m_antDied', [], '#c08070');
        G.sfx('kill', a.x, a.y);
      }
    }
  }
  G.ants = G.ants.filter(a => !a.dead);

  // brood
  for (const b of G.brood) {
    b.update();
    if (b.hp <= 0 && !b.dead) {
      b.dead = true;
      G.fx('blood', b.x, b.y, 4);
      b.colony.say('m_larvaDied', [], '#c08070');
    }
  }
  G.brood = G.brood.filter(b => !b.dead);

  // bugs
  for (const b of G.bugs) {
    b.update();
    if (b.hp <= 0 && !b.dead) {
      b.dead = true;
      const it = G.makeItem(b.predator || b.kind === 'worm' ? 'bigcorpse' : 'corpse', b.x, b.y, BUG_DEF[b.kind].corpse);
      G.items.push(it);
      G.fx('blood', b.x, b.y, 8);
      if (b.kind === 'centipede') objEvent('centipedes', 1);
      if (b.predator) {
        G.colony.stats.predatorsSlain++;
        G.msg('m_slain', [{ bug: b.kind }], '#ffe040');
        G.sfx('kill');
      } else {
        G.sfx('kill', b.x, b.y, 250);
      }
    }
  }
  G.bugs = G.bugs.filter(b => !b.dead);

  // items
  for (const it of G.items) if (!it.dead) it.update();
  G.items = G.items.filter(i => !i.dead);

  // pheromone trails from laden ants
  if (G.tick % 8 === 0) {
    for (const a of G.ants) {
      if (a.carry && a.hp > 0) {
        G.pheromones.push({ x: a.x, y: a.y + 2, t: 900 });
      }
    }
    if (G.pheromones.length > 700) G.pheromones.splice(0, G.pheromones.length - 700);
  }
  for (const ph of G.pheromones) ph.t--;
  if (G.tick % 30 === 0) G.pheromones = G.pheromones.filter(p => p.t > 0);

  for (const c of G.colonies) c.update();
  worldSpawns();
  updateYear();
  updateContested();   // (after the year: summer's news comes before the fruit's)

  // extinction: the players' colony is gone to its last ant
  if (!G.over && !G.ants.some(a => a.hp > 0 && a.colony === G.colony)) gameOver(false, 'r_extinct');
}

// ---------------------------------------------------------------------------
// the year: the seasons turning, winter's cold, the queens' succession, and
// the nuptial flight that crowns it
// ---------------------------------------------------------------------------
const FLIGHT_T = 420;   // ticks the flight plays out before the year's end
const SEASON_COLOR = ['#a0e070', '#ffe060', '#e09040', '#c0e0ff'];

// the world's story ends (for now): the client shows the end screen
function gameOver(win, reason, extra) {
  G.over = Object.assign({
    win, reason, day: G.day, year: G.year, season: G.season,
    score: G.colony.score, stats: Object.assign({}, G.colony.stats),
    stars: 0, flown: 0, milestones: G.objectives ? G.objectives.yearDone : 0,
    canContinue: false,
  }, extra || {});
}

// after a nuptial flight the colony may carry on into the next year
function continueYear() {
  if (G.over && G.over.canContinue) G.over = null;
}

function updateYear() {
  // a new season (or a jump in time): judge the old milestones, set the new
  const ob = G.objectives;
  if (ob.year !== G.year || ob.season !== G.season) {
    closeObjectives(G.colony);
    G.msg('m_season', [{ key: 'season_' + SEASON_KEYS[G.season] }, G.year], SEASON_COLOR[G.season]);
    G.sfx('task');
    if (G.season === SPRING && G.year >= 2 && G.lastFlightYear < G.year) startFlight(ob.yearDone);
    G.objectives = newObjectives(G.year, G.season, ob.year === G.year ? ob.yearDone : 0);
  }

  // the flight plays out, then the year's end screen
  if (G.flight && --G.flight.t <= 0) {
    const f = G.flight;
    G.flight = null;
    gameOver(f.n > 0, f.n > 1 ? 'r_flight' : f.n === 1 ? 'r_flight1' : 'r_noFlight',
      { stars: f.stars, flown: f.n, milestones: f.milestones, pop: f.pop, rival: f.rival,
        rivalDead: !!f.rivalDead, canContinue: true });
  }

  // winter: the surface is deadly cold, except within a thatched mound
  if (G.isWinter()) {
    for (const a of G.ants) {
      if (a.hp > 0 && !sheltered(a)) {
        if (a.caste === 'queen' && a.colony) a.colony.woundQueen(-1, Math.min(COLD_DMG, a.hp));
        a.hp -= COLD_DMG;
      }
    }
    for (let i = 0; i < G.players.length; i++) {
      const p = G.players[i];
      if (p.coldT > 0) p.coldT--;
      if (p.ant && p.ant.hp > 0 && !sheltered(p.ant) && p.coldT <= 0) {
        p.coldT = 600;
        G.msg('m_cold', [], '#ffffff', i);
      }
    }
  }

  // each queen's line: a princess takes her place, or the colony is doomed
  // (the players' world ends; a rival colony is defeated)
  for (const c of G.colonies) {
    if (c.defeated || (c.player && G.over) || c.queen()) continue;
    const heir = G.ants.find(a => a.caste === 'princess' && a.hp > 0 && a.colony === c);
    if (heir) crown(heir);
    else if (!G.brood.some(b => b.royal && !b.dead && b.colony === c)) {
      if (c.player) gameOver(false, 'r_queen');
      else defeatColony(c);
    }
  }
}

// a princess becomes her colony's new queen
function crown(a) {
  const frac = Math.max(0.2, a.hp / a.maxHp);
  a.caste = 'queen';
  a.hw = 3 * CASTE.queen.size; a.hh = 2 * CASTE.queen.size;
  a.maxHp = CASTE.queen.hp * (a.colony.player ? 1 : RED_QUEEN_HP); a.hp = a.maxHp * frac;
  a.state = 'idle'; a.stateT = 60; a.nav = null; a.target = null;
  a.colony.queenDmg = {};   // (a new queen's wounds are her own)
  a.colony.say('m_newQueen', [], '#ff90e0');
  G.sfx('task');
}

// the rival's queen is dead with no heir: its colony falls apart. Its ants
// stop raiding and waste away. If the players' ants had a real hand in her
// death (at least SLAIN_SHARE of the wounds she took lately, see
// Colony.queenDmg, which logs hunger and cold too) each player colony gets
// the bonus; dead of anything else (a centipede, hunger, a scratch from us at
// the very end, a bite long faded), nobody does.
function defeatColony(c) {
  c.defeated = true;
  c.slain = playersSlew(c);
  if (c.raid) c.raid.phase = 'retreat';
  for (const a of G.ants) {
    if (a.colony === c && a.raiding && a.state !== 'return') { a.state = 'home'; a.target = null; }
  }
  for (const o of G.colonies) {
    if (o === c || !o.player) continue;
    o.stats.rivalDefeated = 1;
    if (!c.slain) continue;
    o.score += RIVAL_SCORE;
    o.crystals += RIVAL_CRYSTALS;
  }
  if (c.slain) G.msg('m_rivalSlain', [RIVAL_SCORE, RIVAL_CRYSTALS], '#ffe040');
  else G.msg('m_rivalDied', [], '#e0c080');
  G.sfx('task');
}

// did the player colonies' ants deal at least SLAIN_SHARE of the damage
// colony c's queen took lately? (with no ledger -- an old save -- her last
// wound decides, as it used to)
function playersSlew(c) {
  const qd = c.queenDmg || {};
  let total = 0, ours = 0;
  for (const k in qd) {
    total += qd[k];
    const o = G.colonies[k];
    if (o && o.player) ours += qd[k];
  }
  if (total <= 0) {
    const qh = c.queenHit;
    const killer = qh && G.tick - qh.t < SLAIN_T ? G.colonies[qh.col] : null;
    return !!(killer && killer.player);
  }
  // (a bite long ago has faded to nothing: it no longer counts)
  const full = CASTE.queen.hp * (c.player ? 1 : RED_QUEEN_HP);
  return ours >= total * SLAIN_SHARE && ours >= full * SLAIN_MIN;
}

// is colony c ahead of every rival? (each one defeated, or outnumbered)
function rivalBeaten(c) {
  const pop = c.members().length;
  return G.colonies.every(o => o === c || o.defeated || pop > o.members().length);
}

// the nuptial flight: every adult princess takes wing from the entrance.
// Stars (none without a princess flown): one for a princess flown; one for
// 3+ princesses or 8+ of the year's 12 milestones; one for the rival
// status -- the red queen slain, or more ants than the red colony.
function startFlight(milestones) {
  const c = G.colony;
  const flyers = G.ants.filter(a => a.caste === 'princess' && a.hp > 0 && a.colony === c);
  G.ants = G.ants.filter(a => !flyers.includes(a));
  const n = flyers.length;
  const pop = c.members().length;
  const rival = rivalBeaten(c);
  const rivalDead = G.colonies.some(o => o !== c && o.defeated);
  let stars = 0;
  if (n > 0) stars = 1 + (n >= 3 || milestones >= 8 ? 1 : 0) + (rival ? 1 : 0);
  c.stats.flown = (c.stats.flown || 0) + n;
  c.score += n * 500;
  G.lastFlightYear = G.year;
  G.flight = { t: FLIGHT_T, n, stars, milestones, pop, rival, rivalDead };
  if (n > 0) G.fx('flight', c.entrance.x, c.entrance.y - 4, n);
  G.msg(n > 1 ? 'm_flight' : n === 1 ? 'm_flight1' : 'm_noFlight', [n], '#ff90e0');
  G.sfx(n > 0 ? 'task' : 'starve');
}
