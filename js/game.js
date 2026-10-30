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
  flight: null,       // the nuptial flights under way: { t, res: [per played colony
                      // { col, n, stars, milestones, pop, rival, rivalDead }] }
  lastFlightYear: 0,  // the year of the last nuptial flight (one per spring)
  contested: null,    // this summer's contested food site (colony.js)
  relics: null,       // the season's golden seeds, one per played colony (updateRelics)
  // 'solo' (this browser), 'coop' (an online match), 'versus' (an online
  // match, black against red: both colonies played) or 'world' (a
  // persistent world on the server: the years go on, flights bank legacy)
  mode: 'solo',
  // the year's length: 'full' (48 minutes), 'short' (24) or 'quick' (16) --
  // how long a day lasts (DAY_LEN, see setYearLen); pace: how much quicker
  // its brood and queens are (yearPace, 1 in a FULL year). Saved, and sent
  // to the clients with the world (their clock and calendar run by it).
  yearLen: 'full',
  pace: 1,
  legacy: 0,          // a persistent world's legacy points, banked by each nuptial flight
  history: [],        // ...and its story: { gen, year, out, stars, flown, legacy }
  gen: 1,             // ...and how many colonies it has seen (a lost one starts it over)
  // the players the world is balanced for (1-MAX_SLOTS, see playerSlots):
  // set by newWorld, raised by notePlayers (saved); a persistent world's
  // follows playerAvg instead
  playerSlots: 1,
  playerAvg: 1,       // a persistent world: the players in it lately (a moving average, saved)
  present: 0,         // a persistent world: the players connected now (the server's)
  // online (the server sets it): the colonies note the plan pixels that
  // change, for the snapshots' deltas (see Colony.planSet)
  planSync: false,
  // LEARN TO ANT (the client's guided scenario, js/learn.js): a calm world --
  // no predators but the one a chapter brings, no red raids, no golden seed
  // falling by itself, no asks for hands. Never saved, never set online.
  tutorial: false,
  // whose eyes G.colony / G.rival / G.objectives see through: 0 in the sim
  // (the players' black colony, the red rival); a red player's client in
  // versus sets 1, and its HUD, map and arrow take the red colony's side
  colIdx: 0,

  // the (viewer's) colony, its rival, and its milestones
  get colony() { return this.colonies[this.colIdx] || this.colonies[0] || null; },
  get rival() { return this.colonies[this.colIdx ? 0 : 1] || null; },
  get objectives() { const c = this.colony; return c ? c.objectives : null; },
  set objectives(v) { const c = this.colony; if (c) c.objectives = v; },

  get day() { return Math.floor(this.tick / DAY_LEN); },
  tod() { return (this.tick % DAY_LEN) / DAY_LEN; },
  isNight() { return this.tod() >= 0.7; },
  // the calendar: 0 spring, 1 summer, 2 autumn, 3 winter; years count from 1
  get season() { return Math.floor(this.day / SEASON_DAYS) % 4; },
  get year() { return Math.floor(this.day / YEAR_DAYS) + 1; },
  get seasonDay() { return this.day % SEASON_DAYS; },   // 0-based day within the season
  isWinter() { return this.season === WINTER; },

  // a message by string key (translated by the client). args may hold name
  // tokens like { caste } or { bug }. `to` = a player index, or omit for all;
  // `col` = a colony index: only that colony's players (versus) get it.
  msg(key, args, color, to, col) {
    this.events.push({ t: 'msg', key, args: args || [], color: color || null, to: to == null ? -1 : to, col: col == null ? -1 : col });
  },
  // a sound; with x,y it is only heard by players within range r (with
  // `col` only by that colony's players; `to`, a player index: only by it)
  sfx(k, x, y, r, col, to) {
    this.events.push({ t: 'sfx', k, x: x == null ? null : x, y, r: r || 300, col: col == null ? -1 : col, to: to == null ? -1 : to });
  },
  // a cosmetic particle burst ('dirt', 'blood', 'sparkle', 'clank'), or a
  // colony's nuptial flight ('flight', for `col`'s players)
  fx(k, x, y, n, col) {
    this.events.push({ t: 'fx', k, x, y, n, col: col == null ? -1 : col });
  },

  makeItem(kind, x, y, value) { return new Item(kind, x, y, value); },

  // the distance to the nearest player's ant (col: only that colony's
  // players -- a colony's own news mustn't leak to the other side in versus)
  nearPlayer(x, y, col) {
    let best = Infinity;
    for (const p of this.players) {
      if (!p.ant || p.ant.hp <= 0) continue;
      if (col && p.ant.colony !== col) continue;
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
  // presses the sim consumes; buy is a one-shot upgrade id (or null).
  // Plan mode (held state too): plan -- the ant braces and the keys move the
  // client's cursor instead; px, py -- the cursor in world pixels; paint --
  // 1 while it paints the blueprint, 2 while it erases. job: a one-shot J
  // (the next job, see cycleJob); jobSet: a job picked by name on the O
  // screen (one-shot, like buy)
  return {
    dx: 0, dy: 0, bite: false, act: false, abil: false,
    build: false, buildMat: false, mark: false, raid: false, buy: null,
    job: false, jobSet: null,
    plan: false, px: 0, py: 0, paint: 0,
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
  // col: the index of the player's colony in G.colonies (0 until versus);
  // name: what the others call this player online (null offline);
  // stats: the scoreboard's tally (see newPlayerStats); planLast: where the
  // plan brush last painted in this stroke ({ x, y, mode }, or null);
  // planWarned: told "the plan is full" in this stroke already; job: the
  // player's job (JOBS, or null until one is given), jobPref: the one it
  // asked for in the lobby (null: any), jb: the season's base for the job
  // goals (see noteJobSeason), jgDone: the goals met this season (a bit a
  // job), callT: when a forager may next call workers to a find
  return {
    ant, input: newInput(), deathPos: null, buildMat: M_PACKED, buildWarned: false,
    buildFailT: 0, refuseT: 0, coldT: 0, col: 0, name: null, stats: newPlayerStats(),
    planLast: null, planWarned: false,
    job: null, jobPref: null, jb: null, jgDone: 0, callT: 0,
  };
}

// a player's tally for the scoreboard (held Tab): ants and bugs it gave the
// killing blow (or the last bite, KILL_CREDIT ticks before), its deaths, food
// it carried into the storage, earth it dug and built (pixels). A newcomer
// taking an old slot starts from nothing (see the server's join). The rest
// counts toward the personal milestones (PERSONAL, below): predators slain,
// care (ants healed or rallied, larvae fed by hand), ticks out on the
// winter surface, crystals carried home, aphids milked, plan pixels painted,
// seasons lived through without dying (and whether it died this season);
// pm: the tier reached in each track; pmLog: [track, tier, year] as earned.
// The jobs' tallies (see JOBS; counted whatever the job, as the rest are):
// guard -- foes killed near home (TERRITORY; 2 for a predator or an armed
// ant) and raids turned back while there; patrol -- seconds on the GUARD
// job near home; seek -- crystals home 1, a golden seed home 3, denied 1, a
// raid called 2; digTasks -- the colony's dig tasks this player's digging
// finished; jobGoals -- job goals met
function newPlayerStats() {
  return {
    kills: 0, deaths: 0, food: 0, dug: 0, built: 0,
    preds: 0, care: 0, frost: 0, crystals: 0, milked: 0, planned: 0, lives: 0, diedSeason: false,
    guard: 0, patrol: 0, seek: 0, digTasks: 0, jobGoals: 0,
    pm: {}, pmLog: [], yb: null,
  };
}
// a saved tally (v10) as a fresh one with the saved numbers in it
function restoreStats(s) {
  const st = newPlayerStats();
  if (!s || typeof s !== 'object') return st;
  for (const k in st) {
    if (typeof st[k] === 'number') st[k] = Math.max(0, Number(s[k]) || 0);
  }
  st.diedSeason = !!s.diedSeason;
  for (const t of PERSONAL) st.pm[t.id] = Math.max(0, Math.min(t.tiers.length, Math.floor(Number(s.pm && s.pm[t.id]) || 0)));
  st.pmLog = Array.isArray(s.pmLog) ? s.pmLog.filter(e => Array.isArray(e) && PERSONAL.some(t => t.id === e[0])).slice(-60) : [];
  if (s.yb && typeof s.yb === 'object') {
    st.yb = {};
    for (const k in s.yb) st.yb[k] = Math.max(0, Number(s.yb[k]) || 0);
  }
  return st;
}
const KILL_CREDIT = 300;
// the player who gets the kill of `e` (a dying ant or bug), or null
function killerOf(e) {
  if (!(e.lastHitIdx >= 0) || G.tick - e.lastHitT > KILL_CREDIT) return null;
  return G.players[e.lastHitIdx] || null;
}

// ---------------------------------------------------------------------------
// personal milestones: each player's own, apart from the colony's -- small
// goals for every way of playing, three tiers each. A tier reached tells
// only that player (a toast in its colour) and gives the colony a little
// score; the third tier of most tracks a crystal (not the digging and
// building ones, which a player could run up idly), at most PM_GEMS a side a
// year so a big side's medals don't flood it with crystals. Checked once a second
// from the player's tally; a persistent world's slot keeps them until a
// newcomer takes it (the tally starts over then, as the scoreboard's does).
// value(st): the track's count from a tally (frost in ticks: seconds shown)
// ---------------------------------------------------------------------------
const PERSONAL = [
  { id: 'hunter', tiers: [1, 5, 15], gem: true, value: st => st.kills },
  { id: 'slayer', tiers: [1, 3, 6], gem: true, value: st => st.preds },
  { id: 'forager', tiers: [20, 100, 300], gem: true, value: st => Math.floor(st.food) },
  { id: 'digger', tiers: [500, 3000, 10000], value: st => st.dug },
  { id: 'builder', tiers: [150, 800, 3000], value: st => st.built },   // (built only: painting and erasing a plan is free)
  { id: 'carer', tiers: [3, 15, 40], gem: true, value: st => st.care },
  { id: 'frost', tiers: [15, 40, 90], gem: true, value: st => Math.floor(st.frost / 60) },
  { id: 'prospector', tiers: [1, 3, 6], gem: true, value: st => st.crystals },
  { id: 'milker', tiers: [1, 5, 15], value: st => st.milked },
  { id: 'survivor', tiers: [1, 2, 4], gem: true, value: st => st.lives },
];
const PM_SCORE = [25, 50, 100];   // the colony's score for a tier
const PM_GEMS = 4;                // personal-milestone crystals a side gets a year
// a player's personal milestones reached, all tiers counted
function pmCount(st) {
  let n = 0;
  if (st && st.pm) for (const k in st.pm) n += st.pm[k] || 0;
  return n;
}

// player pIdx's tally against the tracks: every tier newly reached is
// logged, told and rewarded
function checkPersonal(pIdx) {
  const p = G.players[pIdx];
  if (!p || !p.stats) return;
  const st = p.stats, col = playerColony(pIdx);
  for (const t of PERSONAL) {
    const v = t.value(st);
    let tier = st.pm[t.id] || 0;
    while (tier < t.tiers.length && v >= t.tiers[tier]) {
      tier++;
      st.pm[t.id] = tier;
      st.pmLog.push([t.id, tier, G.year]);
      if (st.pmLog.length > 60) st.pmLog.shift();
      let gem = t.gem && tier === t.tiers.length && !!col;
      if (col) {
        if (col.pmGemYear !== G.year) { col.pmGemYear = G.year; col.pmGems = 0; }
        if (col.pmGems >= PM_GEMS) gem = false;
        col.score += PM_SCORE[tier - 1];
        if (gem) { col.crystals++; col.pmGems++; }
      }
      // (the colour token: the client draws it in this player's colour)
      G.msg(gem ? 'm_pmGem' : 'm_pm', [{ key: 'pm_' + t.id }, '\x15'.repeat(tier), { key: 'pmd_' + t.id, args: [t.tiers[tier - 1]] }],
        '@' + pIdx, pIdx);
      const a = p.ant;
      G.sfx('task', a ? a.x : null, a ? a.y : null, 300, -1, pIdx);
    }
  }
}

// the seasons a player lives through without dying (the survivor track):
// counted as each one ends, for every player with a living ant then
function noteSeasonLived() {
  for (const p of G.players) {
    if (!p.stats) continue;
    if (p.ant && p.ant.hp > 0 && !p.stats.diedSeason) p.stats.lives++;
    p.stats.diedSeason = false;
  }
}

// ---------------------------------------------------------------------------
// jobs: every player has one -- a nudge toward where the colony needs hands,
// never a lock (J, or the O screen's job page, switches it: free, any time).
// A job sets where the guide arrow points (the client's jobTarget), the
// player's goal for the season (the HUD's top line: jobGoal) and a small
// perk while the player does that job where it is done (sim-side, so the
// server's word): FORAGER +25% food in each load it stores (JOB_CARRY),
// BUILDER a build stamp or blueprint fill every JOB_BUILD_CD ticks instead
// of BUILD_CD (+33%), GUARD +20% bite (JOB_BITE) within TERRITORY of its own
// nest, SEEKER +15% walking speed (JOB_SPEED) beyond it. Its colony's NPCs
// follow lightly: a GUARD's rally (Q) near home sends the soldiers on
// patrol round the nest rather than at its heels into the forest, and a
// FORAGER that picks up food where more lies calls up to FORAGE_CALL_N
// idle workers of its colony there. Nursing stays the nurse caste's, on
// any job. Who gets what: assignJobs at a match's start (the lobby's
// preferences first, then by JOB_FILL and what the colony needs, see
// colonyNeed), pickJob for a late joiner (what the side lacks most); and
// the colony asks for hands when its need shifts (jobAsks: toasts to the
// side, rate-limited).
// ---------------------------------------------------------------------------
const JOBS = ['forager', 'builder', 'guard', 'seeker'];
// the caste a job suits (the takeover screen preselects it; any will do)
const JOB_CASTE = { forager: 'worker', builder: 'worker', guard: 'soldier', seeker: 'soldier' };
// a team's jobs by its size: the first n of these (8: three foragers, two
// builders, two guards, a seeker; fewer than four: the colony's need takes
// the last place if it isn't among them -- one player: just the need)
const JOB_FILL = ['forager', 'builder', 'guard', 'forager', 'seeker', 'builder', 'guard', 'forager'];
const TERRITORY = 600;      // px (x) from its own nest: home ground (the guard's perk, the seeker's beyond)
const JOB_CARRY = 1.25;     // FORAGER: food a load is worth in the stores
const JOB_BITE = 1.2;       // GUARD: bite damage near home
const JOB_SPEED = 1.15;     // SEEKER: walking speed away from home
const JOB_BUILD_CD = 6;     // BUILDER: ticks between build stamps (everyone else BUILD_CD, 8)
// the season's goal in a FULL year (a shorter year's seasons are shorter:
// x the square root of its share -- SHORT 0.71, QUICK 0.58): food stored;
// px built plus a quarter of the px dug (or one of the colony's dig tasks
// finished); guard points; seeker points (see newPlayerStats)
const JOB_GOAL = { forager: 60, builder: 300, guard: 8, seeker: 3 };
const JOB_GOAL_SCORE = 50;  // the colony's score for a goal met
// a forager's call: up to this many idle workers, within this of the find,
// at most once in this many ticks, to a spot with more food within FORAGE_RICH_R
const FORAGE_CALL_N = 3, FORAGE_CALL_R = 700, FORAGE_CALL_CD = 60 * 20, FORAGE_RICH_R = 160;
// the colony's asks: at most one in ASK_GAP ticks, the same one in ASK_SAME
const ASK_GAP = 60 * 45, ASK_SAME = 60 * 180;

// the season's number since the world began (the job goals' clock)
function seasonKey() { return (G.year - 1) * 4 + G.season; }

// what a tally has done for `job`, all told (see JOB_GOAL)
function jobValue(st, job) {
  if (!st) return 0;
  switch (job) {
    case 'forager': return Math.floor(st.food || 0);
    case 'builder': return Math.floor((st.built || 0) + (st.dug || 0) / 4);
    case 'guard': return (st.guard || 0) + Math.floor((st.patrol || 0) / 60);
    case 'seeker': return st.seek || 0;
  }
  return 0;
}
function jobNeed(job) { return Math.max(1, Math.round((JOB_GOAL[job] || 1) * Math.sqrt(yearShare()))); }

// a new season (or a player new to its job goals): every job's count
// starts from what the tally has now
function noteJobSeason(p) {
  const k = seasonKey();
  if (p.jb && p.jb.k === k) return;
  p.jb = { k, dt: p.stats ? p.stats.digTasks || 0 : 0 };
  for (const j of JOBS) p.jb[j] = jobValue(p.stats, j);
  p.jgDone = 0;
}

// player p's goal this season: { job, n, need, done } (null without a job)
function jobGoal(p) {
  if (!p || !JOBS.includes(p.job) || !p.stats) return null;
  noteJobSeason(p);
  const need = jobNeed(p.job);
  let n = Math.max(0, jobValue(p.stats, p.job) - (p.jb[p.job] || 0));
  // (a builder whose digging finished one of the colony's dig tasks: done)
  if (p.job === 'builder' && (p.stats.digTasks || 0) > p.jb.dt) n = Math.max(n, need);
  return { job: p.job, n: Math.min(n, need), need, done: !!(p.jgDone & (1 << JOBS.indexOf(p.job))) };
}

// once a second for each player: a guard's rounds, and its goal met?
function checkJob(pIdx) {
  const p = G.players[pIdx];
  if (!p || !p.job || !p.stats) return;
  const col = playerColony(pIdx), a = p.ant && p.ant.hp > 0 ? p.ant : null;
  // (a guard near home is on its rounds: a point a minute)
  if (p.job === 'guard' && a && col && Math.abs(a.x - col.x) < TERRITORY) p.stats.patrol++;
  const g = jobGoal(p);
  if (!g || g.done || g.n < g.need) return;
  // (the score once a season: switching jobs to meet a second goal is
  // still told, but pays nothing more)
  if (col && !p.jgDone) col.score += JOB_GOAL_SCORE;
  p.jgDone |= 1 << JOBS.indexOf(p.job);
  p.stats.jobGoals++;
  G.msg('m_jobGoal', [{ key: 'job_' + p.job }, JOB_GOAL_SCORE], '@' + pIdx, pIdx);
  G.sfx('task', a ? a.x : null, a ? a.y : null, 300, -1, pIdx);
}

// does ant `a` belong to a player on `job`? (an NPC never has one)
function onJob(a, job) {
  const p = a && a.playerIdx >= 0 ? G.players[a.playerIdx] : null;
  return !!p && p.job === job;
}
// on its own colony's home ground?
function atHome(a) { return !!a.colony && Math.abs(a.x - a.colony.x) < TERRITORY; }
// the perks (see JOBS): a seeker's pace away from home (steerAnt -- the
// online client predicts its own ant with it too), a guard's bite at home
function jobSpeed(a) { return onJob(a, 'seeker') && !atHome(a) ? JOB_SPEED : 1; }
function jobBite(a) { return onJob(a, 'guard') && atHome(a) ? JOB_BITE : 1; }

// player pIdx takes up `job`; why: the message telling it so (none: quiet).
// Returns true if that is a change.
function setJob(pIdx, job, why) {
  const p = G.players[pIdx];
  if (!p || !JOBS.includes(job)) return false;
  const was = p.job;
  p.job = job;
  if (!p.stats) p.stats = newPlayerStats();
  noteJobSeason(p);
  if (why) G.msg(why, [{ key: 'job_' + job }, { key: 'jt_' + job }], '@' + pIdx, pIdx);
  return was !== job;
}
// J: the next job in turn
function cycleJob(pIdx) {
  const p = G.players[pIdx];
  if (!p) return;
  const i = JOBS.indexOf(p.job);
  setJob(pIdx, JOBS[(i + 1) % JOBS.length], 'm_jobNow');
  const a = p.ant;
  G.sfx('menu', a ? a.x : null, a ? a.y : null, 300, -1, pIdx);
}

// something threatens colony c's nest: an enemy raid on the march toward
// it, an enemy carrying a golden seed near it, its queen bitten lately
// (a reason key, or null)
function nestThreat(c) {
  for (const o of G.colonies) if (o !== c && o.raid && o.raid.target === c.idx && o.raid.phase === 'march') return 'raid';
  if (relicThreat(c)) return 'seed';
  const qh = c.queenHit;
  if (qh && qh.col !== c.idx && G.tick - qh.t < 300 && c.queen()) return 'queen';
  return null;
}
// late autumn with the stores short of what the winter wants
function winterShort(c) {
  return G.season === AUTUMN && seasonFrac() >= 0.5 && c.food < 0.6 * objNeed(objDef('stockpile'), G.year);
}
// the job colony c needs most now
function colonyNeed(c) {
  if (!c) return 'forager';
  if (nestThreat(c)) return 'guard';
  if (G.isWinter() && !c.sealed) return 'builder';
  const rs = G.relics && G.relics.side[c.idx];
  if (rs && rs.ph === 'lying') return 'seeker';
  if (winterShort(c) || c.food < 40) return 'forager';
  if (c.plan.size >= 200) return 'builder';
  return 'forager';
}
// how many of each job a team of n wants (see JOB_FILL)
function jobWants(n, c) {
  const list = JOB_FILL.slice(0, Math.max(1, Math.min(JOB_FILL.length, n)));
  const need = colonyNeed(c);
  if (list.length < 4 && !list.includes(need)) list[list.length - 1] = need;
  // (more than eight a side: round again)
  for (let k = JOB_FILL.length; k < n; k++) list.push(JOB_FILL[k % JOB_FILL.length]);
  const want = {};
  for (const j of JOBS) want[j] = 0;
  for (const j of list) want[j]++;
  return want;
}
// the job colony c's team lacks most, with `have` of each (ties: what the
// colony needs, then JOB_FILL's order)
function lackingJob(want, have, c) {
  const need = colonyNeed(c);
  let best = null, bd = -Infinity;
  for (const j of [need].concat(JOB_FILL)) {
    const d = want[j] - (have[j] || 0);
    if (d > bd) { bd = d; best = j; }
  }
  return best;
}
// the players on colony c's side (by index)
function sidePlayers(c) {
  const out = [];
  G.players.forEach((p, i) => { if (p && playerColony(i) === c && (G.mode === 'solo' || p.name)) out.push(i); });
  return out;
}

// a match begins: every played colony's players get their jobs -- those
// who asked for one in the lobby first (p.jobPref), the rest what the team
// still lacks for its size. Each is told.
function assignJobs() {
  for (const c of G.colonies) {
    if (!c.player) continue;
    const team = sidePlayers(c);
    if (!team.length) continue;
    const want = jobWants(team.length, c), have = {};
    const give = (i, j) => { setJob(i, j, 'm_jobIs'); have[j] = (have[j] || 0) + 1; };
    for (const i of team) if (JOBS.includes(G.players[i].jobPref)) give(i, G.players[i].jobPref);
    for (const i of team) if (!JOBS.includes(G.players[i].jobPref)) give(i, lackingJob(want, have, c));
  }
}
// a player joins a match under way (or a persistent world): its own
// preference, else what its side lacks most
function pickJob(pIdx) {
  const p = G.players[pIdx];
  if (!p) return null;
  const c = playerColony(pIdx);
  let j = JOBS.includes(p.jobPref) ? p.jobPref : null;
  if (!j) {
    const team = sidePlayers(c).filter(i => i !== pIdx);
    const have = {};
    for (const i of team) { const o = G.players[i].job; if (o) have[o] = (have[o] || 0) + 1; }
    j = lackingJob(jobWants(team.length + 1, c), have, c);
  }
  p.jb = null;   // (its goals count from now)
  setJob(pIdx, j, 'm_jobIs');
  return j;
}

// the colony asks for hands as its need shifts: a toast to its side,
// for anyone to answer -- the nest threatened (guards), its golden seed
// fallen (seekers), winter with the nest open (builders), late autumn short
// of stores (foragers). Rate-limited (ASK_GAP, ASK_SAME), and not while
// every player of the side already has that job (or none has a job yet).
// Every second.
function jobAsks() {
  if (G.tutorial) return;
  for (const c of G.colonies) {
    if (!c.player || c.defeated) continue;
    const team = sidePlayers(c).filter(i => G.players[i].job);
    if (!team.length) continue;
    const ask = c.ask || (c.ask = { t: -1e9, k: {}, rid: 0 });
    const rs = G.relics && G.relics.side[c.idx];
    let key = null, job = null;
    if (nestThreat(c)) { key = 'ask_guard'; job = 'guard'; }
    else if (rs && rs.ph === 'lying' && rs.id && !rs.held && ask.rid !== rs.id) { key = 'ask_seek'; job = 'seeker'; }
    else if (G.isWinter() && !c.sealed) { key = 'ask_build'; job = 'builder'; }
    else if (winterShort(c)) { key = 'ask_forage'; job = 'forager'; }
    if (!key || team.every(i => G.players[i].job === job)) continue;
    if (G.tick - ask.t < ASK_GAP || G.tick - (ask.k[key] || -1e9) < ASK_SAME) continue;
    ask.t = G.tick; ask.k[key] = G.tick;
    if (key === 'ask_seek') ask.rid = rs.id;
    c.say(key, [], '#ffd890');
  }
}

// a guard soldier's rally near home (Q): the soldiers near it go round the
// nest on patrol (their usual rounds, at once and for longer) instead of
// falling in behind it; an escort it had is let go. Returns how many.
function rallyPatrol(leader, radius) {
  let n = 0;
  for (const a of G.ants) {
    if (n >= FOLLOW_MAX) break;
    if (a === leader || a.hp <= 0 || a.playerIdx >= 0 || a.colony !== leader.colony ||
        a.caste !== 'soldier' || a.raiding) continue;
    if (dist2(a.x, a.y, leader.x, leader.y) > radius * radius) continue;
    a.followIdx = -1; a.followT = 0;
    if (a.state !== 'fight') { a.state = 'patrol'; a.stateT = FOLLOW_T; a.target = null; a.nav = null; a.patrolI = a.id; }
    n++;
  }
  return n;
}

// a forager picked up food (or milked an aphid) at (x, y): if more lies
// there, up to FORAGE_CALL_N idle workers of its colony within
// FORAGE_CALL_R go and forage there (the forage state walks them out and
// they pick what they find). Not in winter. Returns how many came.
function forageCall(p, pIdx, col, x, y) {
  if (G.isWinter() || G.tick < (p.callT || 0)) return 0;
  const R2 = FORAGE_RICH_R * FORAGE_RICH_R;
  let more = 0;
  for (const it of G.items) {
    if (it.dead || it.carried || !ITEM_DEF[it.kind] || !ITEM_DEF[it.kind].food) continue;
    if (dist2(it.x, it.y, x, y) < R2) more++;
  }
  for (const b of G.bugs) if (b.kind === 'aphid' && !b.dead && b.milkCd <= 0 && dist2(b.x, b.y, x, y) < R2) more++;
  if (!more) return 0;
  const cand = [];
  for (const o of G.ants) {
    if (o.hp <= 0 || o.colony !== col || o.playerIdx >= 0 || o.caste !== 'worker' || o.raiding || o.carry) continue;
    if (o.state !== 'idle' && !(o.state === 'forage' && !(o.target && o.target.called))) continue;
    const d = dist2(o.x, o.y, x, y);
    if (d < FORAGE_CALL_R * FORAGE_CALL_R) cand.push([d, o]);
  }
  cand.sort((u, v) => u[0] - v[0]);
  const n = Math.min(FORAGE_CALL_N, more, cand.length);
  for (let k = 0; k < n; k++) {
    const o = cand[k][1];
    o.state = 'forage'; o.nav = null; o.stateT = 0;
    o.target = { x: Math.max(20, Math.min(WORLD_W - 20, x + (k - 1) * 12)), y: 0, far: Math.abs(o.x - x) > MARCH_R, called: true };
  }
  if (n) {
    p.callT = G.tick + FORAGE_CALL_CD;
    G.msg('m_forageCall', [n], '#a8e8a0', pIdx);
  }
  return n;
}

// a player's kill: near its own nest, a point (2 for a predator or an armed
// ant) for the guard tally
function guardKill(killer, victim, big) {
  const c = G.colonies[killer.col || 0];
  if (c && Math.abs(victim.x - c.x) < TERRITORY) killer.stats.guard += big ? 2 : 1;
}
// a raid on colony c turned back: its players at home then share the credit
function raidRepelled(c) {
  G.players.forEach((p, i) => {
    const a = p && p.ant;
    if (a && a.hp > 0 && p.stats && playerColony(i) === c && Math.abs(a.x - c.x) < TERRITORY) p.stats.guard += 2;
  });
}

// ---------------------------------------------------------------------------
// the end of a match (or a persistent world's year): each player's numbers
// and the awards. MVP: a weighted score of everything (MVP_W); TOP DIGGER,
// BUILDER and FORAGER, MOST KILLS: the most of each (none for nothing);
// SURVIVOR: the fewest deaths (with something done -- an MVP score of at
// least SURVIVOR_MIN; ties go to the bigger MVP score, then the lower
// player index). yearOnly: a persistent world's flight counts the year
// just gone only, from each tally's `yb` (its numbers at the year's start,
// pmN: its pmLog's length then; see noteYearBase). Returns { players:
// [{ i, n (name), c (colony), j (its job at the end), st: [kills, deaths,
// food, dug, built, care, preds, guard points, seeker points], mvp, pm
// (tiers reached in all), pmNew: [[track, tier]] }], awards: [{ k, i, v }]
// } -- the players with a slot (online: a name) only. The jobs' awards:
// TOP FORAGER and TOP BUILDER are the old ones (food stored, px built);
// BEST GUARD and TOP SEEKER count the guard and seeker points (see
// jobValue) -- whatever the job, like the rest.
// ---------------------------------------------------------------------------
const MVP_W = { kills: 30, preds: 60, food: 2, dug: 0.02, built: 0.1, care: 12, crystals: 40, deaths: -15, pm: 20 };
const SURVIVOR_MIN = 100;
const AWARDS = [
  { k: 'mvp', v: r => r.mvp },
  { k: 'digger', v: r => r.st[3] },
  { k: 'builder', v: r => r.st[4] },
  { k: 'forager', v: r => r.st[2] },
  { k: 'killer', v: r => r.st[0] },
  { k: 'survivor', v: r => -r.st[1], ok: r => r.mvp >= SURVIVOR_MIN },
  { k: 'guard', v: r => r.st[7] },
  { k: 'seeker', v: r => r.st[8] },
];
function matchHighlights(yearOnly) {
  const rows = [];
  G.players.forEach((p, i) => {
    if (!p || !p.stats || (G.mode !== 'solo' && !p.name)) return;
    const s = p.stats, b = yearOnly ? s.yb : null;
    const d = k => Math.max(0, (Number(s[k]) || 0) - (b ? Number(b[k]) || 0 : 0));
    const pmNew = s.pmLog.slice(b ? Math.min(s.pmLog.length, b.pmN || 0) : 0).map(e => [e[0], e[1]]);
    const st = [d('kills'), d('deaths'), Math.round(d('food')), d('dug'), d('built'), d('care'), d('preds'),
      d('guard') + Math.floor(d('patrol') / 60), d('seek')];
    let mvp = st[0] * MVP_W.kills + st[6] * MVP_W.preds + st[2] * MVP_W.food + st[3] * MVP_W.dug +
      st[4] * MVP_W.built + st[5] * MVP_W.care + d('crystals') * MVP_W.crystals + st[1] * MVP_W.deaths + pmNew.length * MVP_W.pm;
    rows.push({ i, n: p.name || null, c: p.col || 0, j: p.job || null, st, mvp: Math.max(0, Math.round(mvp)), pm: pmCount(s), pmNew });
  });
  const awards = [];
  for (const a of AWARDS) {
    let best = null;
    for (const r of rows) {
      if (a.ok && !a.ok(r)) continue;
      const v = a.v(r);
      if (!best || v > best.v || (v === best.v && r.mvp > best.r.mvp)) best = { r, v };
    }
    if (best && (a.k === 'survivor' || best.v > 0)) awards.push({ k: a.k, i: best.r.i, v: Math.abs(best.v) });
  }
  return { players: rows, awards };
}

// a persistent world's year begins (its flight has flown): each tally's
// numbers now, for the next flight's highlights to count from
function noteYearBase() {
  for (const p of G.players) {
    const s = p && p.stats;
    if (!s) continue;
    s.yb = { pmN: s.pmLog.length };
    for (const k of ['kills', 'deaths', 'food', 'dug', 'built', 'care', 'preds', 'crystals', 'guard', 'patrol', 'seek']) s.yb[k] = s[k];
  }
}

// online players come and go while the world runs. A slot (an index into
// G.players) exists for every player who ever joined; one who left keeps an
// empty slot (ant null) that the next newcomer takes.
function ensurePlayer(pIdx) {
  while (G.players.length <= pIdx) G.players.push(newPlayer(null));
  return G.players[pIdx];
}

// an ant a player lets go of carries on as one of the colony's own
function handBack(a) {
  a.playerIdx = -1;
  a.state = 'idle'; a.stateT = 120;
  a.target = null; a.nav = null;
  a.climbing = false; a.ceiling = false;
}

// player pIdx steps away (left, or lost the connection): its ant goes back
// to the colony meanwhile. Returns the ant it had (or null).
function releasePlayer(pIdx) {
  const p = G.players[pIdx];
  if (!p) return null;
  const a = p.ant && p.ant.hp > 0 ? p.ant : null;
  if (a) handBack(a);
  p.ant = null; p.deathPos = null;
  p.input = newInput();
  return a;
}

// player pIdx takes back the very ant it let go of (a reconnect), if that
// ant still lives, is one of its colony's and nobody else has taken it
function reclaimAnt(pIdx, id) {
  const p = ensurePlayer(pIdx);
  const a = G.ants.find(o => o.id === id);
  if (!a || a.hp <= 0 || a.playerIdx >= 0 || !PLAYABLE(a.caste) || a.colony !== playerColony(pIdx)) return null;
  a.playerIdx = pIdx;
  a.state = 'idle'; a.nav = null; a.target = null;
  if (a.raiding) a.endRaid();
  p.ant = a; p.deathPos = null;
  p.input = newInput();
  return a;
}

// the colony player pIdx plays for
function playerColony(pIdx) {
  const p = G.players[pIdx];
  return G.colonies[p ? p.col || 0 : 0];
}

// ---------------------------------------------------------------------------
// the player count the world is balanced for (G.playerSlots): co-op the
// players who started it, versus the bigger side, a persistent world the
// players who have been in it lately. Each player beyond the first gives the
// colonies room (their caps), raises the milestones a little, and in co-op
// makes the red rival bigger and bolder (see SLOT_* in colony.js). A match's
// only ever rises -- it doesn't get easier when players leave; a persistent
// world's follows a moving average of the players connected, so a crowd for
// a few minutes doesn't make it a crowd's world for good. With one player
// every factor is exactly 1.
// ---------------------------------------------------------------------------
const MAX_SLOTS = 8;
function playerSlots() { return Math.max(1, Math.min(MAX_SLOTS, Math.floor(G.playerSlots) || 1)); }

// n players are in the world now: balance a match for that many, if more
// than before (a persistent world only notes it: see followPlayers)
function notePlayers(n) {
  n = Math.max(1, Math.min(MAX_SLOTS, Math.floor(n) || 1));
  if (G.mode === 'world') { G.present = n; return false; }
  if (n <= playerSlots()) return false;
  setSlots(n);
  return true;
}

// a persistent world: every in-game hour the average moves toward the
// players connected, by an in-game day's time constant (~4 minutes of play;
// asleep, nothing is counted), and the world is balanced for it rounded
const AVG_STEP = DAY_LEN / 24, AVG_TAU = DAY_LEN;
function followPlayers() {
  if (!G.present) return false;
  G.playerAvg += (G.present - G.playerAvg) * AVG_STEP / AVG_TAU;
  const n = Math.max(1, Math.min(MAX_SLOTS, Math.round(G.playerAvg)));
  if (n === playerSlots()) return false;
  setSlots(n);
  return true;
}

// balance the world for n players: the caps follow, and the season's open
// milestones (a lowered one is met at its next count)
function setSlots(n) {
  G.playerSlots = n;
  for (const c of G.colonies) {
    c.recalcChambers();
    const ob = c.objectives;
    if (!ob) continue;
    for (const o of ob.list) {
      const def = objDef(o.id);
      if (def && !o.done) o.need = objNeed(def, ob.year);
    }
  }
}

// the year's length (see YEAR_LENS in colony.js): sets the day's length
// every sim file reads, and the brood's pace. An unknown one is FULL.
// Called before anything reads the calendar (a new world, a save, the
// online client's world message).
function setYearLen(k) {
  G.yearLen = YEAR_LENS[k] ? k : 'full';
  DAY_LEN = YEAR_LENS[G.yearLen];
  G.pace = yearPace();
  return G.yearLen;
}

// ---------------------------------------------------------------------------
// world setup
// ---------------------------------------------------------------------------
function resetWorldState(world, seed) {
  T.init(world);
  G.seed = seed;
  G.colIdx = 0;
  G.tutorial = false;
  G.trees = world.trees;
  // both nests from the generator: the players' and the rival's (the rival
  // nest's storage, nursery and royal chamber become the red colony's)
  G.colonies = [new Colony(world.colony, 0), new Colony(world.rival, 1)];
  // a planned pixel built over (by anyone, with anything) leaves the plan
  T.onSolid = i => { for (const c of G.colonies) if (c.plan.size && c.plan.has(i)) c.planSet(i, 0); };
  G.ants = []; G.brood = []; G.bugs = []; G.items = [];
  G.pheromones = []; G.events = []; G.over = null;
  G.players = [];
  G.flight = null; G.lastFlightYear = 0;
  G.contested = null;
  G.relics = newRelics();
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
const BLACK_WORKERS = 7, BLACK_SOLDIERS = 2;

// who plays which colony in `mode` (see G.mode). In versus both colonies
// are played -- tasks, milestones and messages for each, no AI raids or AI
// growth -- and an ant gate belongs to the nest it was built nearer to: a
// colony's ants pass only their own side's gates (Colony.gates 1 or 2, see
// T.gateOpen). Otherwise the players' colony passes every gate.
function setupFactions(mode) {
  G.mode = mode || 'solo';
  const vs = G.mode === 'versus';
  for (const c of G.colonies) {
    c.player = c.idx === 0 || vs;
    c.gates = vs ? c.idx + 1 : c.idx === 0;
  }
  T.gateSplit = vs && G.colonies[1] ? Math.round((G.colonies[0].x + G.colonies[1].x) / 2) : null;
}

// the colony whose nest is nearest x
function nestNearest(x) {
  let best = G.colonies[0];
  for (const c of G.colonies) if (Math.abs(c.x - x) < Math.abs(best.x - x)) best = c;
  return best;
}

// versus: both nests come from the same generator, but caves cut into one
// or the other at random. Each chamber of one nest is paired with the other
// nest's chamber of the same type, and both count only the smaller one's
// room (the claim, see Colony.recalcChambers): the same capacities on
// either side, from the seed alone. A chamber with no partner counts for
// nothing until it is dug out further.
function equalizeNests() {
  const [a, b] = G.colonies;
  for (const type of CH_TYPES) {
    const ca = a.chambers.filter(ch => ch.type === type), cb = b.chambers.filter(ch => ch.type === type);
    for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
      const m = ca[i] && cb[i] ? Math.min(ca[i].claimed, cb[i].claimed) : 0;
      if (ca[i]) ca[i].claimed = m;
      if (cb[i]) cb[i].claimed = m;
    }
  }
  for (const c of G.colonies) c.recalcChambers();
}

// where a new player's ant starts on colony c's mound: the k-th spot of
// SPAWN_DX beside the entrance (the next free one if it's no good), lifted
// clear of any earth there and with ground not far below -- not over the
// open shaft, never inside the terrain. used: x's already taken.
const SPAWN_DX = [-8, 8, -16, 16, -24, 24, -32, 32, -40, 40, -48, 48];
function spawnSpot(c, k, hw, hh, used) {
  const e = c.entrance;
  for (let j = 0; j < SPAWN_DX.length; j++) {
    const x = e.x + SPAWN_DX[(k + j) % SPAWN_DX.length];
    if (used && used.includes(x)) continue;
    let y = e.y - 8;
    for (let up = 0; up < 32 && T.boxSolid(x, y, hw, hh); up++) y--;
    if (T.boxSolid(x, y, hw, hh)) continue;
    let ground = false;
    for (let d = 1; d <= 40 && !ground; d++) ground = T.boxSolid(x, y + d, hw, hh);
    if (ground) return { x, y };
  }
  return { x: e.x + SPAWN_DX[k % SPAWN_DX.length], y: e.y - 8 };
}

// seed: the world; playerCount: the players' ants to add at the entrance
// (co-op and solo: extra workers; versus and persistent worlds: none, their
// players take ants the colony has); slots: the players it is balanced for
// (default playerCount, at least 1 -- see playerSlots); len: the year's
// length (setYearLen; a persistent world is always FULL)
function newWorld(seed, playerCount, mode, slots, len) {
  const world = genNewWorld(seed);   // (with the contested crystal field, see crystalField)
  resetWorldState(world, seed);
  setupFactions(mode);
  setYearLen(G.mode === 'world' ? 'full' : len);
  G.legacy = 0; G.history = []; G.gen = 1;
  G.playerSlots = slots || playerCount || 1;
  G.playerSlots = playerSlots();
  G.playerAvg = G.playerSlots; G.present = 0;
  G.tick = Math.floor(DAY_LEN * 0.08); // start in the morning
  ENT_ID = 1;

  const c = G.colonies[0];
  const vs = G.mode === 'versus';
  // the royal households: ours, and the rival's across the forest (in
  // versus the same household on both sides, a worker more for each player
  // beyond the first on the bigger side -- its players take ants the colony
  // has, and an 8v8 would otherwise leave hardly any to forage; in co-op a
  // rival grown to match the players, see SLOT_RIVAL)
  const vw = vs ? BLACK_WORKERS + playerSlots() - 1 : BLACK_WORKERS;
  populateColony(c, vw, BLACK_SOLDIERS);
  const rx = n => n + Math.round(n * (slotScale(SLOT_RIVAL) - 1));
  populateColony(G.colonies[1], vs ? vw : rx(RED_WORKERS), vs ? BLACK_SOLDIERS : rx(RED_SOLDIERS));

  // player ants, side by side at the entrance
  const used = [];
  for (let p = 0; p < playerCount; p++) {
    const a = new Ant(c.entrance.x, c.entrance.y - 8, 'worker');
    const s = spawnSpot(c, p, a.hw, a.hh, used);
    a.x = s.x; a.y = s.y;
    used.push(s.x);
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
  if (vs) equalizeNests();
  for (const col of G.colonies) col.objectives = col.player ? newObjectives(G.year, G.season, 0) : null;
  G.running = true;
}

// player pIdx joins colony colIdx and plays one of its workers (versus: a
// worker the colony already has, so a side's numbers don't depend on how
// many play it). Returns the ant (or null).
function joinColony(pIdx, colIdx) {
  const p = ensurePlayer(pIdx);
  p.col = colIdx;
  const e = G.colonies[colIdx].entrance;
  return takeOver(pIdx, 'worker', e.x, e.y);
}

// a persistent world whose colony was lost starts over: a new seed and a
// fresh colony. Its legacy, its history (the loss written into it) and its
// players (who pick new ants) carry over.
const HISTORY_MAX = 40;
function rebirthWorld(seed) {
  const o = G.over || {};
  const keep = {
    legacy: G.legacy, gen: G.gen, names: G.players.map(p => p.name), slots: playerSlots(), avg: G.playerAvg,
    jobs: G.players.map(p => p.job),   // (the players keep their jobs into the new colony)
    history: G.history.concat([{ gen: G.gen, year: G.year, out: 'lost', reason: o.reason || 'r_extinct', legacy: 0 }]),
  };
  // (balanced for as many players as the old colony was)
  newWorld(seed, 0, 'world', keep.slots);
  G.playerAvg = keep.avg;
  G.legacy = keep.legacy;
  G.gen = keep.gen + 1;
  G.history = keep.history.slice(-HISTORY_MAX);
  keep.names.forEach((n, i) => { ensurePlayer(i).name = n; });
  keep.jobs.forEach((j, i) => { if (j) setJob(i, j); });
  // (why, then what now: the players read them in that order)
  G.msg(o.reason === 'r_queen' ? 'r_queen' : 'r_extinct', [], '#ff7060');
  G.msg('m_reborn', [G.gen, G.legacy], '#ffb040');
  G.sfx('task');
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
  // v7: a persistent world's mode, legacy and history (older: a solo world)
  setupFactions(d.mode === 'world' ? 'world' : 'solo');
  // v10: the year's length (older saves, and every persistent world: FULL)
  setYearLen(v >= 10 && G.mode !== 'world' ? d.yearLen : 'full');
  G.legacy = Math.max(0, Math.floor(Number(d.legacy) || 0));
  G.history = Array.isArray(d.history) ? d.history.filter(h => h && typeof h === 'object').slice(-HISTORY_MAX) : [];
  G.gen = Math.max(1, Math.floor(Number(d.gen) || 1));
  // v8: the players it is balanced for (older: as many as it had players)
  G.playerSlots = v >= 8 ? Number(d.slots) || 1 : Number(d.playerCount) || 1;
  G.playerSlots = playerSlots();
  const avg = Number(d.avg);
  G.playerAvg = avg >= 1 && avg <= MAX_SLOTS ? avg : G.playerSlots;
  G.present = 0;
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
  // (v6 and older: one colony's flight under way, not a list of them)
  if (G.flight && !Array.isArray(G.flight.res)) G.flight = { t: G.flight.t, res: [Object.assign({ col: 0 }, G.flight)] };
  const cs = d.contested;
  G.contested = cs && typeof cs.x === 'number' ? Object.assign({ got: [] }, cs) : null;
  // v11: the golden seeds (older saves: none has fallen yet -- this season's
  // falls on time, or at once if its time has passed)
  G.relics = restoreRelics(v >= 11 ? d.relics : null);
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
    // (v11: a golden seed's colony; one that lost it isn't one any more)
    if (s.kind === 'relic') {
      if (!G.colonies[s.rcol]) { it.dead = true; continue; }
      it.rcol = s.rcol | 0; it.dropped = !!s.dropped;
    }
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
    // v10: the player's tally and personal milestones (older: from nothing)
    if (v >= 10 && Array.isArray(d.pstats)) pl.stats = restoreStats(d.pstats[p]);
    // v12: its job and the season's goals so far (older: a job given afresh, below)
    const pj = v >= 12 && Array.isArray(d.pjobs) ? d.pjobs[p] : null;
    if (pj && JOBS.includes(pj.j)) {
      pl.job = pj.j;
      if (pj.b && typeof pj.b === 'object' && Number.isFinite(Number(pj.b.k))) {
        pl.jb = { k: Math.floor(Number(pj.b.k)), dt: Math.max(0, Number(pj.b.dt) || 0) };
        for (const j of JOBS) pl.jb[j] = Math.max(0, Number(pj.b[j]) || 0);
      }
      pl.jgDone = Math.max(0, Math.floor(Number(pj.d) || 0)) & 15;
    }
    G.players.push(pl);
  }
  G.players.forEach((p, i) => { if (!p.job) pickJob(i); });

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
  // v9: the blueprint (packed, see planPack) and the builders' stocks
  // (older saves: no plan, empty stocks)
  col.planLoadPacked(v >= 9 ? cd.plan : null);
  col.planShun = new Map();
  const st = (v >= 9 && cd.stock) || {};
  const stock = k => Math.max(0, Math.min(col.stockCap(), Math.floor(Number(st[k]) || 0)));
  col.stock = { soil: stock('soil'), thatch: stock('thatch') };
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

// ---------------------------------------------------------------------------
// blueprints (see PLAN_* in colony.js): plan mode paints them, F and the
// colony's builders fill them
// ---------------------------------------------------------------------------

// the plan cursor (a player's input, untrusted online) held to PLAN_REACH
// of its ant and to the world
function planCursor(a, px, py) {
  let x = Number(px), y = Number(py);
  if (!isFinite(x) || !isFinite(y)) return { x: a.x, y: a.y };
  const dx = x - a.x, dy = y - a.y, d = Math.hypot(dx, dy);
  if (d > PLAN_REACH) { x = a.x + dx / d * PLAN_REACH; y = a.y + dy / d * PLAN_REACH; }
  return { x: Math.max(0, Math.min(WORLD_W - 1, x)), y: Math.max(0, Math.min(WORLD_H - 1, y)) };
}

// one dab of the plan brush at (cx, cy): `mat` on the open air under it
// (mat 0: rub the plan out there). Returns false once the plan is full.
function planDab(col, cx, cy, mat) {
  const R = PLAN_BRUSH, x0 = Math.round(cx), y0 = Math.round(cy);
  let room = true;
  for (let y = y0 - R; y <= y0 + R; y++) {
    if (y < 0 || y >= WORLD_H) continue;
    for (let x = x0 - R; x <= x0 + R; x++) {
      if (x < 0 || x >= WORLD_W || (x - x0) * (x - x0) + (y - y0) * (y - y0) > R * R + 1) continue;
      const i = y * WORLD_W + x;
      if (!mat) { if (col.plan.has(i)) col.planSet(i, 0); continue; }
      // (only open air: solid ground and gates are no place for a plan)
      if (T.m[i] !== M_AIR) continue;
      if (!col.plan.has(i) && col.plan.size >= PLAN_MAX) { room = false; continue; }
      col.planSet(i, mat);
    }
  }
  return room;
}

// player p's brush, held this tick at the cursor: a stroke from where it
// last painted (a line of dabs, so a quick sweep leaves no gaps however
// rarely the cursor arrives), or a fresh dab
function planStroke(p, pIdx, col, a, inp) {
  const mode = inp.paint === 2 ? 2 : inp.paint ? 1 : 0;
  if (!inp.plan || !mode) { p.planLast = null; p.planWarned = false; return; }
  const c = planCursor(a, inp.px, inp.py);
  const mat = mode === 2 ? 0 : p.buildMat;
  const l = p.planLast && p.planLast.mode === mode ? p.planLast : null;
  const d = l ? Math.hypot(c.x - l.x, c.y - l.y) : 0;
  if (l && d < 0.5) return;
  let room = true;
  const had = col.plan.size;
  if (l && d <= PLAN_JUMP) {
    const n = Math.ceil(d / 1.5);
    for (let k = 1; k <= n; k++) room = planDab(col, l.x + (c.x - l.x) * k / n, l.y + (c.y - l.y) * k / n, mat) && room;
  } else {
    room = planDab(col, c.x, c.y, mat);
  }
  p.planLast = { x: c.x, y: c.y, mode };
  // (what it adds to the plan counts for its builder track)
  if (mat && col.plan.size > had) p.stats.planned += col.plan.size - had;
  if (!room && !p.planWarned) {
    p.planWarned = true;
    G.msg('m_planFull', [PLAN_MAX], '#ff8040', pIdx);
  }
}

// the planned pixels F fills next for ant `a` (direction dx, dy held): the
// open ones of its colony's blueprint within PLAN_FILL_R of its middle that
// nobody stands in -- the nearest first, any in the held direction before
// the rest -- and the clump of that one's material around it (the load must
// have some of it). Returns null when nothing is planned in reach (F builds
// as it always did), else { mat, list (pixel indices, best first), load }
// -- list empty when all of it is blocked (someone in the way) or there is
// nothing to build it with (load: the load it would take).
function planNext(a, col, dx, dy) {
  if (!col || !col.plan.size) return null;
  const R = PLAN_FILL_R, W = WORLD_W, cx = Math.round(a.x), cy = Math.round(a.y);
  const len = Math.hypot(dx, dy), ux = len ? dx / len : 0, uy = len ? dy / len : 0;
  let any = false, clear = null, best = null, bs = Infinity, want = null, blk = null;
  const cand = [];
  for (let y = Math.max(0, cy - R); y <= Math.min(WORLD_H - 1, cy + R); y++) {
    for (let x = Math.max(0, cx - R); x <= Math.min(W - 1, cx + R); x++) {
      const ox = x - a.x, oy = y - a.y, d2 = ox * ox + oy * oy;
      if (d2 > R * R) continue;
      const i = y * W + x, v = col.plan.get(i);
      if (!v || T.m[i] !== M_AIR) continue;
      any = true;
      const load = planLoad(v);
      if (!(a[load] >= 1)) { want = want || load; continue; }
      if (!clear) clear = buildClear(a.x, a.y, R);
      if (!clear(x, y)) { blk = blk || load; continue; }
      // (aimed: the held direction's half of the reach comes first)
      const s = Math.sqrt(d2) + (len && ox * ux + oy * uy <= 0 ? 1000 : 0);
      cand.push(i, x, y, v);
      if (s < bs) { bs = s; best = cand.length - 4; }
    }
  }
  if (!any) return null;
  // (blocked, with the load to build it: "no room"; else what's missing)
  if (best === null) return { mat: 0, list: [], load: blk || want || 'soil' };
  const mat = cand[best + 3], bx = cand[best + 1], by = cand[best + 2];
  const near = [];
  for (let k = 0; k < cand.length; k += 4) {
    if (cand[k + 3] !== mat) continue;
    const d2 = dist2(cand[k + 1], cand[k + 2], bx, by);
    if (d2 <= PLAN_CLUMP * PLAN_CLUMP) near.push([d2, cand[k]]);
  }
  near.sort((p, q) => p[0] - q[0]);
  return { mat, list: near.map(e => e[1]).slice(0, PLAN_FILL_N), load: planLoad(mat) };
}

// a player's held direction steers its ant: walking, climbing walls and
// tunnels, hanging from roofs, hopping. (The online client runs it too, to
// predict its own ant between the server's snapshots.) build: the build key
// is held -- an ant with a footing (on the ground, on a wall, under a roof)
// braces and stands still, and the direction keys only aim the stamp
function steerAnt(a, dx, dy, build) {
  if (build && (a.onGround || a.climbing || a.ceiling)) {
    a.vx = 0;
    if (a.climbing) a.climbV = 0;           // cling where it is
    else if (dx !== 0) a.dir = dx;          // turn to face the aim
    return;
  }
  const SPEED = a.speedNow() * 1.5 * jobSpeed(a);   // (a seeker's pace away from home)
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
}

// after a player ant's physics step: a climber stuck under an overhang
// shimmies sideways, and one that topped out boosts over the ledge
function climbFix(a) {
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
  // the job (J: the next one; the O screen: one by name) -- dead or alive
  if (inp.job) { inp.job = false; cycleJob(pIdx); }
  if (inp.jobSet) {
    const j = inp.jobSet;
    inp.jobSet = null;
    if (JOBS.includes(j) && j !== p.job) { setJob(pIdx, j, 'm_jobNow'); G.sfx('menu', a ? a.x : null, a ? a.y : null, 300, -1, pIdx); }
  }
  if (!a || a.hp <= 0) { inp.act = inp.abil = inp.buildMat = inp.mark = inp.raid = false; p.planLast = null; return; }
  const c = a.def;

  // (plan mode: the ant braces, and the keys only move the cursor)
  const dx = inp.plan ? 0 : inp.dx, dy = inp.plan ? 0 : inp.dy;
  steerAnt(a, dx, dy, inp.build || inp.plan);
  planStroke(p, pIdx, col, a, inp);

  // bite / dig
  if (inp.bite && !inp.plan && a.biteCd <= 0) {
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
      // (a guard bites harder at home, see jobBite)
      bit.hurt(a.dmgNow() * jobBite(a), ux * 1.2, uy * 0.6 - 0.3, a);
      bit.lastHitBy = 'player';
      bit.lastHitIdx = pIdx; bit.lastHitT = G.tick;   // (for the scoreboard's kills)
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
      // the spoil goes into the mandibles as building material (what a full
      // load can't hold goes to the colony's stocks, for its builders)
      const soil = a.soil + res.soil + res2.soil, thatch = a.thatch + res.thatch + res2.thatch;
      a.soil = Math.min(LOAD_CAP, soil);
      p.stats.dug += res.count;
      a.thatch = Math.min(LOAD_CAP, thatch);
      col.bank(soil - a.soil, thatch - a.thatch);
      if (res.count > 0) {
        G.fx('dirt', bx, by, 4);
        G.sfx('dig', a.x, a.y);
        // expansion: digging out natural ground inside a marked chamber
        // claims that room for it (and counts for the dig task). Re-biting
        // your own packed earth or thatch doesn't.
        if (col.claimDug(bx, by, res.natural)) {
          const dt = col.active('dig');
          col.progress('dig', res.natural);
          // (the bite that finished the dig task: a builder's goal for the season)
          if (dt && dt.done) p.stats.digTasks++;
        }
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
  if (inp.build && !inp.plan && a.buildCd <= 0) {
    // the colony's blueprint in reach: F fills it (the planned pixels, in
    // their materials, from the load each takes); else the aimed stamp
    const next = planNext(a, col, dx, dy);
    const load = next ? next.load : p.buildMat === M_THATCH ? 'thatch' : 'soil';
    if (a[load] < 1) {
      if (!p.buildWarned) {
        p.buildWarned = true;
        G.msg(load === 'soil' ? 'm_noSoil' : 'm_noThatch', [], '#ff8040', pIdx);
      }
    } else {
      a.buildCd = p.job === 'builder' ? JOB_BUILD_CD : BUILD_CD;   // (a builder's perk)
      let n = 0, fx = null;
      if (next) {
        const placed = next.list.length ? T.placeAt(next.list, next.mat, null, Math.floor(a[load])) : [];
        n = placed.length;
        if (n) fx = { bx: placed[0] % WORLD_W, by: (placed[0] / WORLD_W) | 0 };
      } else {
        const aim = buildAim(a, dx, dy);
        n = aim ? T.place(aim.bx, aim.by, BUILD_R, p.buildMat,
          buildClear(aim.bx, aim.by, BUILD_R), Math.floor(a[load])) : 0;
        fx = aim;
      }
      if (n > 0) {
        a[load] -= n;
        p.stats.built += n;
        a.biteAnim = 5;
        G.fx('dirt', fx.bx, fx.by, 2);
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

  // mark the chamber underfoot (or claim this cavity as a new one; in plan
  // mode X erases instead, and the press is dropped)
  if (inp.mark) {
    inp.mark = false;
    if (!inp.plan) col.markChamber(a, pIdx);
  }
  // call a raid on the enemy's nest (the colony's NPCs march; see callRaid)
  if (inp.raid) {
    inp.raid = false;
    // (a raid called is seeker's work)
    if (col.callRaid(pIdx)) p.stats.seek += 2;
  }

  // caste ability: soldiers rally, nurses heal
  if (inp.abil) {
    inp.abil = false;
    if (a.caste === 'soldier') {
      if (a.abilCd > 0) {
        // still catching its breath
      } else {
        // with a foe in sight everyone near turns on it; either way the
        // soldiers near fall in behind the player -- a guard at home sends
        // them round the nest on patrol instead (see rallyPatrol)
        const n = rallyAllies(a, RALLY_R);
        const guard = p.job === 'guard' && atHome(a);
        const f = guard ? rallyPatrol(a, RALLY_R) : rallyFollow(a, pIdx, RALLY_R);
        if (n < 0 && f === 0) {
          G.msg('m_noRally', [], null, pIdx);
        } else {
          a.abilCd = 600;
          p.stats.care += Math.max(0, n) + f;
          if (n >= 0) G.msg(n > 0 ? 'm_rally' : 'm_rallyAlone', [n], '#ff8040', pIdx);
          else G.msg(guard ? 'm_patrol' : 'm_follow', [f], '#ff8040', pIdx);
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
            p.stats.care += healed;
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
      } else if (larva && ITEM_DEF[it.kind] && it.kind !== 'relic') {   // (a golden seed is no larva's meal)
        larva.feed();
        it.dead = true; a.carry = null;
        col.progress('feed', 1);
        p.stats.care++;
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
        // (a forager's find: idle workers come to forage there too)
        if (p.job === 'forager' && ITEM_DEF[it.kind] && ITEM_DEF[it.kind].food) forageCall(p, pIdx, col, it.x, it.y);
      } else if (broodNear) {
        broodNear.carried = a; a.carry = broodNear;
        G.msg('m_carrying', [{ brood: broodNear.kind }], null, pIdx);
        G.sfx('pickup', a.x, a.y);
      } else if (garden && a.thatch >= THATCH_PER_UNIT) {
        // a thatch load makes good garden mulch too
        feedGardenBy(a, pIdx, garden, Math.floor(a.thatch / THATCH_PER_UNIT),
          u => { a.thatch -= u * THATCH_PER_UNIT; });
      } else if ((a.soil >= 1 || a.thatch >= 1) && (Math.hypot(a.x - col.storage.x, a.y - col.storage.y) < 28 ||
                 !!col.chamberNear(a.x, a.y, 30, 'storage'))) {
        // empty-handed at the storage: the loads go to the colony's stocks,
        // for its builders (as much as they have room for)
        const cap = col.stockCap();
        const s = Math.floor(Math.max(0, Math.min(a.soil, cap - col.stock.soil)));
        const t = Math.floor(Math.max(0, Math.min(a.thatch, cap - col.stock.thatch)));
        if (s + t > 0) {
          a.soil -= s; a.thatch -= t;
          col.bank(s, t);
          G.msg('m_stocked', [s, t], '#e0c080', pIdx);
          G.sfx('deposit', a.x, a.y);
        } else {
          G.msg('m_stockFull', [], '#ff8040', pIdx);
          G.sfx('clank', a.x, a.y);
        }
      } else {
        // milk an aphid?
        const aphid = G.bugs.find(bg => bg.kind === 'aphid' && !bg.dead &&
          bg.milkCd <= 0 && dist2(a.x, a.y, bg.x, bg.y) < 150);
        if (aphid) {
          aphid.milkCd = 1800;
          const hd = G.makeItem('honeydew', a.x, a.y);
          hd.carried = a; a.carry = hd;
          G.items.push(hd);
          p.stats.milked++;
          G.msg('m_milked', [], null, pIdx);
          G.sfx('milk', a.x, a.y);
          if (p.job === 'forager') forageCall(p, pIdx, col, aphid.x, aphid.y);
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
  const out = CASTE_ORDER.filter(c => counts[c]).map(c => ({ caste: c, count: counts[c] }));
  // (no free ant at all for a player without one -- a newcomer to a colony
  // whose ants are all played, or one whose ant died: a new worker)
  if (!out.length && canFresh(pIdx || 0)) out.push({ caste: 'worker', count: 0, fresh: true });
  return out;
}

// may player pIdx have a fresh worker? Only with no living ant of its own
// and none free in its colony (the caller checks that), and while the
// colony lives on (its queen or a princess; with no ant left it is lost)
function canFresh(pIdx) {
  const p = G.players[pIdx], col = playerColony(pIdx);
  if (!col || G.over || (p && p.ant && p.ant.hp > 0)) return false;
  return G.ants.some(a => a.hp > 0 && a.colony === col && (a.caste === 'queen' || a.caste === 'princess'));
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
  // nobody free at all: a fresh worker comes out of the entrance for it
  if (!a && caste === 'worker' && takeoverOptions(pIdx).some(o => o.fresh)) {
    a = new Ant(col.entrance.x, col.entrance.y - 8, 'worker', col);
    const s = spawnSpot(col, pIdx, a.hw, a.hh);
    a.x = s.x; a.y = s.y;
    G.ants.push(a);
  }
  if (!a) return null;
  const p = G.players[pIdx];
  const prev = p.ant;
  if (prev && prev.hp > 0) handBack(prev);
  a.playerIdx = pIdx;
  a.state = 'idle';
  if (a.raiding) a.endRaid();
  a.climbing = false;

  a.ceiling = false;
  a.nav = null;
  p.ant = a;
  p.deathPos = null;
  p.input = newInput();
  G.msg('m_nowPlaying', [{ caste: a.caste }], playerColor(pIdx), pIdx);
  return a;
}

// ---------------------------------------------------------------------------
// one simulation tick (1/60 s)
// ---------------------------------------------------------------------------
function stepSim() {
  G.tick++;
  if (G.mode === 'world' && G.tick % AVG_STEP === 0) followPlayers();
  // (the personal milestones and the job goals: once a second, the players
  // in turn; the colonies' asks for hands once a second)
  for (let p = G.tick % 60; p < G.players.length; p += 60) { checkPersonal(p); checkJob(p); }
  if (G.tick % 60 === 30) jobAsks();

  for (let p = 0; p < G.players.length; p++) controlPlayer(p);

  // ants
  for (const a of G.ants) {
    if (a.hp > 0) a.update();
    if (a.playerIdx >= 0 && a.climbing) climbFix(a);
  }
  // deaths
  for (const a of G.ants) {
    if (a.hp <= 0 && !a.dead) {
      a.dead = true;
      if (a.carry) { a.carry.carried = null; a.carry = null; }
      G.items.push(G.makeItem('corpse', a.x, a.y));
      a.colony.stats.antsDied++;
      const killer = killerOf(a);
      if (killer) {
        killer.stats.kills++;
        guardKill(killer, a, a.caste === 'soldier' || a.caste === 'queen' || a.raiding);
      }
      // (versus: every ant down is a rival slain for the other side)
      if (G.mode === 'versus') for (const o of G.colonies) if (o !== a.colony) o.stats.rivalsSlain = (o.stats.rivalsSlain || 0) + 1;
      if (a.playerIdx >= 0) {
        const pIdx = a.playerIdx;
        G.sfx('die', a.x, a.y, 9999);
        for (let q = 0; q < G.players.length; q++) {
          if (q === pIdx) G.msg('m_youDied', [], '#ff5040', q);
          else if (playerColony(q) === a.colony) G.msg('m_pDied', [{ player: pIdx }], '#ff5040', q);
        }
        G.players[pIdx].ant = null;
        G.players[pIdx].deathPos = { x: a.x, y: a.y };
        G.players[pIdx].stats.deaths++;
        G.players[pIdx].stats.diedSeason = true;
      } else if (!a.colony.player) {
        // a rival down: the players' tally (their queen's fall is told by
        // the defeat, in updateYear)
        G.colony.stats.rivalsSlain = (G.colony.stats.rivalsSlain || 0) + 1;
        if (a.caste !== 'queen' && G.nearPlayer(a.x, a.y) < 300) G.sfx('kill', a.x, a.y);
      } else if (a.caste === 'queen') {
        a.colony.say('m_queenDead', [], '#ff4030');
        a.colony.sfx('danger');
      } else if (G.nearPlayer(a.x, a.y, a.colony) < 300) {
        a.colony.say('m_antDied', [], '#c08070');
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
      const killer = killerOf(b);
      if (killer) { killer.stats.kills++; guardKill(killer, b, b.predator); }
      if (killer && b.predator) killer.stats.preds++;
      // (versus: the kill counts for the nest it was nearer to)
      const by = G.mode === 'versus' ? nestNearest(b.x) : G.colonies[0];
      if (b.kind === 'centipede') objEvent('centipedes', 1, by);
      if (b.predator) {
        by.stats.predatorsSlain++;
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

  // pheromone trails from laden ants (cosmetic: they fade 8 ticks at a time)
  if (G.tick % 8 === 0) {
    for (const ph of G.pheromones) ph.t -= 8;
    if (G.tick % 32 === 0) G.pheromones = G.pheromones.filter(p => p.t > 0);
    for (const a of G.ants) {
      if (a.carry && a.hp > 0) {
        G.pheromones.push({ x: a.x, y: a.y + 2, t: 900 });
      }
    }
    if (G.pheromones.length > 700) G.pheromones.splice(0, G.pheromones.length - 700);
  }

  for (const c of G.colonies) c.update();
  worldSpawns();
  updateYear();
  updateContested();   // (after the year: summer's news comes before the fruit's)
  updateRelics();      // (the golden seeds, see colony.js)

  // extinction: the players' colony is gone to its last ant (versus:
  // either side's, and the other side has won)
  for (const c of G.colonies) {
    if (G.over || !c.player || G.ants.some(a => a.hp > 0 && a.colony === c)) continue;
    if (G.mode === 'versus') { c.defeated = true; versusOver(1 - c.idx, 'r_vsExtinct'); }
    else gameOver(false, 'r_extinct');
  }
}

// ---------------------------------------------------------------------------
// the year: the seasons turning, winter's cold, the queens' succession, and
// the nuptial flight that crowns it
// ---------------------------------------------------------------------------
const FLIGHT_T = 420;   // ticks the flight plays out before the year's end
const SEASON_COLOR = ['#a0e070', '#ffe060', '#e09040', '#c0e0ff'];

// the world's story ends (for now): the client shows the end screen
// (hl: the players' numbers and the awards, see matchHighlights; len: the
// year's length, for the end screen)
function gameOver(win, reason, extra) {
  const c = G.colonies[0];
  for (let p = 0; p < G.players.length; p++) checkPersonal(p);
  G.over = Object.assign({
    win, reason, day: G.day, year: G.year, season: G.season,
    score: c.score, stats: Object.assign({}, c.stats),
    stars: 0, flown: 0, milestones: c.objectives ? c.objectives.yearDone : 0,
    canContinue: false, hl: matchHighlights(false), len: G.yearLen,
  }, extra || {});
}

// a versus match is decided: `winner` is the winning colony's index (-1: a
// draw). Both sides' numbers go on the end screen (each client reads its
// own side's win from it); res: the nuptial flights, when they decided it.
function versusOver(winner, reason, res) {
  gameOver(false, reason, {
    versus: true, winner,
    sides: G.colonies.map((c, i) => ({
      faction: c.faction, score: c.score, pop: c.members().length, defeated: !!c.defeated,
      milestones: c.objectives ? c.objectives.yearDone : 0, stats: Object.assign({}, c.stats),
      stars: res && res[i] ? res[i].stars : 0, flown: res && res[i] ? res[i].n : 0,
      relics: res && res[i] ? res[i].relics : relicsHome(c),
    })),
  });
}

// after a nuptial flight the colony may carry on into the next year
function continueYear() {
  if (G.over && G.over.canContinue) G.over = null;
}

function updateYear() {
  // a new season (or a jump in time): every played colony judges its old
  // milestones and sets the new (they all turn together)
  const ob = G.colonies[0].objectives;
  if (ob.year !== G.year || ob.season !== G.season) {
    const obs = G.colonies.map(c => c.objectives);
    for (const c of G.colonies) if (c.objectives) closeObjectives(c);
    noteSeasonLived();
    const flight = G.season === SPRING && G.year >= 2 && G.lastFlightYear < G.year;
    // (versus: that flight decides the match -- no new year to announce)
    if (!(flight && G.mode === 'versus')) {
      G.msg('m_season', [{ key: 'season_' + SEASON_KEYS[G.season] }, G.year], SEASON_COLOR[G.season]);
      G.sfx('task');
    }
    if (flight) {
      const res = [];
      for (const c of G.colonies) if (obs[c.idx]) res.push(startFlight(c, obs[c.idx].yearDone));
      G.lastFlightYear = G.year;
      G.flight = { t: FLIGHT_T, res };
    }
    for (const c of G.colonies) {
      const o = obs[c.idx];
      if (o) c.objectives = newObjectives(G.year, G.season, o.year === G.year ? o.yearDone : 0);
    }
  }

  // the flight plays out, then the year's end
  if (G.flight && --G.flight.t <= 0) {
    const res = G.flight.res;
    G.flight = null;
    endFlight(res);
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
      // (the frost track: time out on the winter surface, mound or not)
      if (p.ant && p.ant.hp > 0 && p.stats && !underground(p.ant)) p.stats.frost++;
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
      if (c.player && G.mode !== 'versus') gameOver(false, 'r_queen');
      else defeatColony(c);
    }
  }
}

// the year's nuptial flights have flown (res: one per played colony)
function endFlight(res) {
  if (G.mode === 'versus') {
    // the side with more stars wins; then more princesses flown, then more ants
    const [a, b] = res;
    let w = -1;
    // (the golden seeds brought home break a tie of princesses, see updateRelics)
    for (const k of ['stars', 'n', 'relics', 'pop']) if (a[k] !== b[k]) { w = a[k] > b[k] ? a.col : b.col; break; }
    versusOver(w, w < 0 ? 'r_vsDraw' : 'r_vsFlight', res);
    return;
  }
  const f = res[0];
  if (G.mode === 'world') { bankLegacy(f); return; }
  gameOver(f.n > 0, f.n > 1 ? 'r_flight' : f.n === 1 ? 'r_flight1' : 'r_noFlight',
    { stars: f.stars, flown: f.n, milestones: f.milestones, relics: f.relics, pop: f.pop, rival: f.rival,
      rivalDead: !!f.rivalDead, canContinue: true });
}

// a persistent world's flight: the year's stars and princesses flown become
// legacy points, and the colony carries on into its next year (whose
// milestones are bigger, see newObjectives)
const LEGACY_STAR = 100, LEGACY_FLOWN = 50;
function bankLegacy(f) {
  const pts = f.stars * LEGACY_STAR + f.n * LEGACY_FLOWN;
  G.legacy += pts;
  G.history.push({ gen: G.gen, year: G.year - 1, out: f.n > 0 ? 'flight' : 'noFlight', stars: f.stars, flown: f.n, legacy: pts });
  if (G.history.length > HISTORY_MAX) G.history.splice(0, G.history.length - HISTORY_MAX);
  G.msg('m_legacy', [pts, G.legacy], '#ff90e0');
  G.sfx('task');
  yearHighlights();
}

// a persistent world's year is over: its MVP told to everyone, and each
// player its own awards and the personal milestones it earned this year;
// the next year counts from here
function yearHighlights() {
  for (let p = 0; p < G.players.length; p++) checkPersonal(p);
  const hl = matchHighlights(true);
  const mvp = hl.awards.find(a => a.k === 'mvp');
  if (mvp) G.msg('m_yearMvp', [{ player: mvp.i }], '#ffe040');
  for (const r of hl.players) {
    const mine = hl.awards.filter(a => a.i === r.i && a.k !== 'mvp').map(a => ({ key: 'aw_' + a.k }));
    if (mine.length) G.msg('m_yourAwards', [mine.length > 1 ? { key: 'aw_two', args: [mine[0], mine[1]] } : mine[0]], '@' + r.i, r.i);
    G.msg('m_yourYear', [r.pmNew.length], '@' + r.i, r.i);
  }
  noteYearBase();
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
  a.colony.sfx('task');
}

// the rival's queen is dead with no heir: its colony falls apart. Its ants
// stop raiding and waste away. If the players' ants had a real hand in her
// death (at least SLAIN_SHARE of the wounds she took lately, see
// Colony.queenDmg, which logs hunger and cold too) each player colony gets
// the bonus; dead of anything else (a centipede, hunger, a scratch from us at
// the very end, a bite long faded), nobody does.
function defeatColony(c) {
  c.defeated = true;
  // versus: the other side has won, at once
  if (G.mode === 'versus') { c.slain = true; versusOver(1 - c.idx, 'r_vsQueen'); return; }
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
// 3+ princesses or 8+ of the year's 12 milestones (each golden seed brought
// home last year counts as one more, see updateRelics); one for the rival
// status -- the red queen slain, or more ants than the red colony.
function startFlight(c, milestones) {
  const flyers = G.ants.filter(a => a.caste === 'princess' && a.hp > 0 && a.colony === c);
  G.ants = G.ants.filter(a => !flyers.includes(a));
  const n = flyers.length;
  const pop = c.members().length;
  const rival = rivalBeaten(c);
  const rivalDead = G.colonies.some(o => o !== c && o.defeated);
  const relics = relicsHome(c, G.year - 1);
  let stars = 0;
  if (n > 0) stars = 1 + (n >= 3 || milestones + relics >= 8 ? 1 : 0) + (rival ? 1 : 0);
  c.stats.flown = (c.stats.flown || 0) + n;
  c.score += n * 500;
  if (n > 0) G.fx('flight', c.entrance.x, c.entrance.y - 4, n, c.idx);
  c.say(n > 1 ? 'm_flight' : n === 1 ? 'm_flight1' : 'm_noFlight', [n], '#ff90e0');
  c.sfx(n > 0 ? 'task' : 'starve');
  return { col: c.idx, n, stars, milestones, pop, rival, rivalDead, relics };
}
