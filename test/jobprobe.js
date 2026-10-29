// Job probe: every player has a job (FORAGER, BUILDER, GUARD, SEEKER) -- a
// nudge, never a lock. First the sim alone (plain Node, a vm per world):
// the jobs handed out by team size (1-8) and by the colony's need, the
// lobby's preferences first, a late joiner given what the side lacks, J
// and the O screen's pick switching (told to that player only), each perk
// only on its job and where it applies (a forager's load worth +25%, a
// guard's bite +20% at home, a seeker +15% faster away from home, a
// builder's stamps 6 ticks apart instead of 8), the NPCs following lightly
// (a guard's rally at home sends soldiers on patrol, away it still makes an
// escort; a forager's find calls up to 3 idle workers, not again at once),
// the season's goal met once (and counted afresh next season), the guard
// and seeker tallies, the colony's asks rate-limited (and not while all
// have the job), the highlights' job awards, a persistent world's joiner
// and rebirth, and v12 saves (an older one gets its jobs afresh). Then the
// server with raw clients: the lobby's preference message (each side sees
// only its own side's in versus), the jobs at the start and for a late
// joiner in the j0 view key, J and the job page's pick through the
// protocol, each side's jobs only to that side. Last a browser page: the
// lobby with preferences, the HUD's job line, the O screen's job and
// personal pages, the switch overlay preselecting the job's caste, the
// scoreboard's icons and the highlights' job awards, in English and
// Norwegian, as screenshots that must fit 320x200.
//   node test/jobprobe.js [--no-browser]
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const WebSocket = require(path.join(ROOT, 'server', 'node_modules', 'ws'));
const NO_BROWSER = process.argv.includes('--no-browser');

const fails = [];
const check = (name, ok, info) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info !== undefined ? '  ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''));
  if (!ok) fails.push(name);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// the sim alone
// ---------------------------------------------------------------------------
function simCtx(seed) {
  let s = (seed * 2654435761) >>> 0;
  const M = Object.create(Math);
  M.random = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ctx = vm.createContext({ console, Math: M, btoa, atob });
  for (const f of ['worldgen.js', 'terrain.js', 'entities.js', 'colony.js', 'game.js', 'save.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  }
  const run = code => vm.runInContext(code, ctx);
  run.json = code => JSON.parse(run(`JSON.stringify(${code})`));
  // (helpers inside the world: the messages since the last look, an ant
  // stood still at a spot)
  run(`var msgs = () => { const m = G.events.filter(e => e.t === 'msg').map(e => ({ k: e.key, to: e.to, col: e.col, args: e.args })); G.events.length = 0; return m; };
    var standAt = (a, x, y) => { a.x = x; a.y = y; a.vx = a.vy = 0; a.climbing = a.ceiling = false; a.hp = a.maxHp; return a; };
    var named = n => { for (let i = 0; i < n; i++) ensurePlayer(i).name = 'P' + i; };`);
  return run;
}

function simChecks() {
  // ---- assignment by team size ---------------------------------------------
  const run = simCtx(1);
  const sizes = {};
  for (let n = 1; n <= 8; n++) {
    run(`newWorld(4242, ${n}, 'coop', ${n}, 'full'); named(${n}); G.events.length = 0; assignJobs();`);
    sizes[n] = run.json(`(() => { const c = {}; for (const p of G.players) c[p.job] = (c[p.job] || 0) + 1;
      return { c, told: G.events.filter(e => e.t === 'msg' && e.key === 'm_jobIs').map(e => e.to).sort().join() }; })()`);
  }
  const cnt = (n, j) => sizes[n].c[j] || 0;
  check('1 player: the job the colony needs most (spring, nothing amiss: FORAGER)', cnt(1, 'forager') === 1, sizes[1].c);
  check('2-3 players: forager, builder (, guard)', cnt(2, 'forager') === 1 && cnt(2, 'builder') === 1 &&
    cnt(3, 'forager') === 1 && cnt(3, 'builder') === 1 && cnt(3, 'guard') === 1, [sizes[2].c, sizes[3].c]);
  check('4-7 players: two foragers first, then a seeker, a second builder and guard', cnt(4, 'forager') === 2 && cnt(5, 'seeker') === 1 &&
    cnt(6, 'builder') === 2 && cnt(7, 'guard') === 2, [4, 5, 6, 7].map(n => sizes[n].c));
  check('8 players: 3 foragers, 2 builders, 2 guards, 1 seeker', cnt(8, 'forager') === 3 && cnt(8, 'builder') === 2 &&
    cnt(8, 'guard') === 2 && cnt(8, 'seeker') === 1, sizes[8].c);
  check('...each player told its job, only it', sizes[8].told === '0,1,2,3,4,5,6,7' && sizes[3].told === '0,1,2', sizes[8].told);
  // need: one player with the nest threatened gets GUARD; in winter, the nest open, BUILDER
  const need = run.json(`(() => {
    newWorld(4242, 1, 'coop', 1, 'full'); named(1);
    const c = G.colony, out = {};
    c.queenHit = { col: 1, t: G.tick }; c.queen().hp = c.queen().maxHp;
    assignJobs(); out.threat = G.players[0].job;
    c.queenHit = null;
    G.tick = 3 * SEASON_DAYS * DAY_LEN + 600; c.sealed = false;
    assignJobs(); out.winter = G.players[0].job;
    G.tick = 2 * SEASON_DAYS * DAY_LEN + Math.floor(SEASON_DAYS * DAY_LEN * 0.8); c.food = 10;
    out.autumn = colonyNeed(c);
    return out;
  })()`);
  check('the need decides a lone player\'s job: GUARD with the queen bitten, BUILDER in winter with the nest open, FORAGER late in a lean autumn',
    need.threat === 'guard' && need.winter === 'builder' && need.autumn === 'forager', need);

  // ---- the lobby's preferences first; a late joiner gets what's lacking -------
  const pref = run.json(`(() => {
    newWorld(4242, 4, 'coop', 4, 'full'); named(4);
    G.players[1].jobPref = 'guard'; G.players[2].jobPref = 'guard'; G.players[3].jobPref = 'seeker';
    assignJobs();
    const jobs = G.players.map(p => p.job);
    // a fifth joins the match under way (no preference): the side lacks a forager most
    ensurePlayer(4).name = 'P4';
    G.events.length = 0;
    const late = pickJob(4);
    const told = msgs().filter(m => m.k === 'm_jobIs').map(m => m.to);
    // ...and a sixth that asked for BUILDER gets it
    ensurePlayer(5).name = 'P5'; G.players[5].jobPref = 'builder';
    return { jobs, late, told, pref: pickJob(5) };
  })()`);
  check('preferences honoured first (two GUARDs, a SEEKER), the rest by need', pref.jobs.join() === 'forager,guard,guard,seeker', pref.jobs);
  check('a late joiner gets the job its side lacks most (FORAGER), and is told', pref.late === 'forager' && pref.told.join() === '4', pref);
  check('...one with a preference gets that', pref.pref === 'builder');

  // ---- J and the O screen's pick ---------------------------------------------
  const sw = run.json(`(() => {
    newWorld(4242, 2, 'coop', 2, 'full'); named(2); assignJobs(); stepSim(); G.events.length = 0;
    const p = G.players[0], out = { from: p.job };
    p.input.job = true; stepSim();
    out.next = p.job; out.m = msgs().filter(m => m.k === 'm_jobNow');
    for (let i = 0; i < 3; i++) { p.input.job = true; stepSim(); }
    out.round = p.job;
    p.input.jobSet = 'seeker'; stepSim(); out.set = p.job;
    p.input.jobSet = 'nonsense'; stepSim(); out.junk = p.job;
    // (dead, it still switches)
    p.ant.hp = 0; stepSim(); p.input.job = true; stepSim(); out.dead = p.job;
    return out;
  })()`);
  check('J: the next job (forager -> builder), told only to that player', sw.from === 'forager' && sw.next === 'builder' &&
    sw.m.length === 1 && sw.m[0].to === 0, sw);
  check('...round the four and back; the O screen picks one by name, junk ignored; dead or alive', sw.round === 'forager' &&
    sw.set === 'seeker' && sw.junk === 'seeker' && sw.dead === 'forager', sw);

  // ---- the perks: only on the job, only where it applies ------------------------
  const pk = run.json(`(() => {
    newWorld(4242, 1, 'coop', 1, 'full'); named(1); assignJobs(); stepSim();
    const c = G.colony, p = G.players[0], out = {};
    // forager: a seed (5 food) into the stores
    const store = job => {
      p.job = job; const a = standAt(p.ant, c.storage.x, c.storage.y);
      c.food = 20; const it = G.makeItem('seed', a.x, a.y); G.items.push(it); it.carried = a; a.carry = it;
      p.input.act = true; p.refuseT = 0; stepSim(); return +(c.food - 20).toFixed(3);
    };
    out.store = { forager: store('forager'), builder: store('builder') };
    // guard: a bite on a red worker, at home and far out
    const bite = (job, x) => {
      p.job = job; const a = standAt(p.ant, x, T.surf[x] - 4); a.dir = 1; a.biteCd = 0;
      const foe = new Ant(a.x + a.hw + 3.5, a.y, 'worker', G.colonies[1]); foe.hp = foe.maxHp = 500; G.ants.push(foe);
      p.input.bite = true; controlPlayer(0); p.input.bite = false;
      const d = +(500 - foe.hp).toFixed(3); foe.hp = 0; foe.dead = true; G.ants = G.ants.filter(o => o !== foe);
      return d;
    };
    out.bite = { home: bite('guard', c.x + 100), far: bite('guard', c.x + 1200), other: bite('forager', c.x + 100) };
    // seeker: walking speed away from home and at home
    const speed = (job, x) => { p.job = job; const a = standAt(p.ant, x, T.surf[x] - 4); a.carry = null; steerAnt(a, 1, 0, false); return +a.vx.toFixed(4); };
    out.speed = { far: speed('seeker', c.x + 1200), home: speed('seeker', c.x + 100), other: speed('guard', c.x + 1200) };
    // builder: the stamp's cooldown
    const build = job => {
      p.job = job; const x = c.x + 160; const a = standAt(p.ant, x, T.surf[x] - 4); a.dir = 1;
      a.soil = 60; a.buildCd = 0; p.input.build = true; p.input.dx = 1; controlPlayer(0); p.input.build = false; p.input.dx = 0;
      return { cd: a.buildCd, used: 60 - a.soil };
    };
    out.build = { builder: build('builder'), other: build('forager') };
    return out;
  })()`);
  // (less the colony's eating that tick)
  check('FORAGER: a load is worth 25% more in the stores (5 -> 6.25); other jobs as ever', Math.abs(pk.store.forager - 6.25) < 0.01 &&
    Math.abs(pk.store.builder - 5) < 0.01, pk.store);
  check('GUARD: +20% bite at home, not far out, not for other jobs', Math.abs(pk.bite.home / pk.bite.other - 1.2) < 1e-6 &&
    pk.bite.far === pk.bite.other && pk.bite.other > 0, pk.bite);
  check('SEEKER: +15% walking speed away from home, not at home, not for other jobs', Math.abs(pk.speed.far / pk.speed.home - 1.15) < 1e-3 &&
    pk.speed.other === pk.speed.home, pk.speed);
  check('BUILDER: stamps 6 ticks apart instead of 8 (+33%)', pk.build.builder.cd === 6 && pk.build.other.cd === 8 &&
    pk.build.builder.used > 0 && pk.build.other.used > 0, pk.build);

  // ---- the NPCs follow lightly --------------------------------------------------
  const rl = run.json(`(() => {
    newWorld(4242, 1, 'coop', 1, 'full'); named(1); assignJobs(); stepSim();
    const c = G.colony, p = G.players[0], out = {};
    // the player becomes a soldier; three soldiers of ours stand by it
    const rally = (job, x) => {
      takeOver(0, 'soldier', c.x, c.entrance.y);
      if (!p.ant) { const s = new Ant(c.x, c.entrance.y, 'soldier', c); G.ants.push(s); takeOver(0, 'soldier', c.x, c.entrance.y); }
      p.job = job;
      const a = standAt(p.ant, x, T.surf[x] - 4); a.abilCd = 0;
      const sols = [];
      for (let k = 0; k < 3; k++) { const s = new Ant(x + 20 + k * 8, a.y, 'soldier', c); s.state = 'idle'; G.ants.push(s); sols.push(s); }
      // (no foe anywhere near)
      G.bugs = G.bugs.filter(b => !b.predator); for (const o of G.ants) if (o.colony !== c) { o.x = Math.max(o.x, c.x + 2000); }
      G.events.length = 0;
      p.input.abil = true; controlPlayer(0);
      const r = { states: sols.map(s => s.state).join(), follow: sols.filter(s => s.followIdx === 0).length, m: msgs().map(m => m.k) };
      for (const s of sols) { s.hp = 0; s.dead = true; }
      G.ants = G.ants.filter(o => !o.dead);
      return r;
    };
    out.home = rally('guard', c.x + 120);
    out.far = rally('guard', c.x + 1500);
    out.other = rally('seeker', c.x + 120);
    return out;
  })()`);
  check('a GUARD\'s rally at home: the soldiers go on patrol round the nest (no escort), told so', rl.home.states === 'patrol,patrol,patrol' &&
    rl.home.follow === 0 && rl.home.m.includes('m_patrol'), rl.home);
  check('...away from home (or another job) it is the escort as before', rl.far.states === 'follow,follow,follow' && rl.far.follow === 3 &&
    rl.other.follow === 3 && rl.other.m.includes('m_follow'), { far: rl.far, other: rl.other });
  const fc = run.json(`(() => {
    newWorld(4242, 1, 'coop', 1, 'full'); named(1); assignJobs(); stepSim();
    const c = G.colony, p = G.players[0], out = {};
    const x = c.x + 260, y = T.surf[x] - 4;
    const a = standAt(p.ant, x, y); a.carry = null;
    // food at the spot (more than one piece), idle workers in the nest
    G.items = G.items.filter(it => it.kind === 'relic');
    for (let k = 0; k < 5; k++) G.items.push(G.makeItem('seed', x + k * 6, y + 2));
    const idle = G.ants.filter(o => o.colony === c && o.caste === 'worker' && o.playerIdx < 0).slice(0, 5);
    for (const o of idle) { o.state = 'idle'; o.stateT = 900; o.target = null; o.carry = null; }
    G.events.length = 0;
    p.input.act = true; controlPlayer(0);
    const called = G.ants.filter(o => o.colony === c && o.state === 'forage' && o.target && o.target.called);
    out.n = called.length; out.m = msgs().map(m => m.k + ':' + m.args[0]);
    out.toward = called.every(o => Math.abs(o.target.x - x) < 30);
    out.carry = !!a.carry;
    // put it down and pick it up again at once: no second call yet
    const unCall = () => { for (const o of G.ants) if (o.target && o.target.called) { o.state = 'idle'; o.stateT = 900; o.target = null; } };
    a.carry.carried = null; a.carry = null;
    unCall();
    p.input.act = true; controlPlayer(0);
    out.again = G.ants.filter(o => o.colony === c && o.state === 'forage' && o.target && o.target.called).length;
    // a builder's pick-up calls nobody
    a.carry.carried = null; a.carry = null; p.callT = 0; p.job = 'builder';
    unCall();
    p.input.act = true; controlPlayer(0);
    out.builder = G.ants.filter(o => o.colony === c && o.state === 'forage' && o.target && o.target.called).length;
    // the called workers go and forage (a few seconds on, they head out or carry)
    p.job = 'forager'; a.carry.carried = null; a.carry = null; p.callT = 0;
    for (const o of called) { o.state = 'idle'; o.target = null; }
    p.input.act = true; controlPlayer(0);
    for (let t = 0; t < 60 * 20; t++) stepSim();
    out.after = called.map(o => o.state).join();
    return out;
  })()`);
  check('a FORAGER\'s find calls up to 3 idle workers there (told)', fc.n === 3 && fc.toward && fc.carry && fc.m.includes('m_forageCall:3'), fc);
  check('...not again straight away; a builder\'s find calls nobody', fc.again === 0 && fc.builder === 0, fc);
  check('...and they forage (no one stuck idle)', fc.after.split(',').every(s => ['forage', 'collect', 'return', 'milk', 'idle'].includes(s)) &&
    fc.after.split(',').some(s => s !== 'idle'), fc.after);

  // ---- the season's goal; the tallies ------------------------------------------
  const gl = run.json(`(() => {
    newWorld(4242, 1, 'coop', 1, 'full'); named(1); assignJobs(); stepSim(); G.events.length = 0;
    const c = G.colony, p = G.players[0], out = {};
    out.need = jobGoal(p).need;
    const s0 = c.score;
    p.stats.food += 61;
    for (let t = 0; t < 130; t++) stepSim();
    out.m = msgs().filter(m => m.k === 'm_jobGoal').map(m => m.to);
    out.score = c.score - s0;
    out.g = jobGoal(p);
    p.stats.food += 100;
    for (let t = 0; t < 130; t++) stepSim();
    out.twice = msgs().filter(m => m.k === 'm_jobGoal').length;
    // next season: from nothing again
    G.tick = SEASON_DAYS * DAY_LEN + 5; stepSim();
    out.next = jobGoal(p);
    // guard: a red soldier killed by the player near home; a minute on the rounds
    p.job = 'guard';
    const g0 = jobGoal(p).n;
    const foe = new Ant(c.x + 50, T.surf[c.x + 50] - 4, 'soldier', G.colonies[1]); G.ants.push(foe);
    foe.lastHitIdx = 0; foe.lastHitT = G.tick; foe.hp = 0;
    stepSim();
    out.guardKill = p.stats.guard;
    standAt(p.ant, c.x + 30, T.surf[c.x + 30] - 4);
    const pt0 = p.stats.patrol;
    for (let t = 0; t < 60 * 62; t++) { stepSim(); p.ant.hp = p.ant.maxHp; }
    out.patrol = p.stats.patrol - pt0;
    out.guardN = jobGoal(p).n - g0;
    // seeker: a crystal home
    p.job = 'seeker';
    const a = standAt(p.ant, c.storage.x, c.storage.y);
    const cr = G.makeItem('crystal', a.x, a.y); G.items.push(cr); cr.carried = a; a.carry = cr;
    p.input.act = true; p.refuseT = 0; stepSim();
    out.seek = p.stats.seek;
    // builder: the bite that finished a dig task meets the goal at once
    p.job = 'builder';
    p.stats.digTasks++;
    out.builder = jobGoal(p);
    return out;
  })()`);
  check('the season\'s goal (FORAGER 60 food in a FULL year): met once, told, +50 to the colony', gl.need === 60 && gl.m.join() === '0' &&
    gl.score >= 50 && gl.g.done && gl.twice === 0, gl);
  check('...and next season it counts from nothing again', gl.next && gl.next.n === 0 && !gl.next.done, gl.next);
  check('GUARD: a red soldier slain near home is 2 points, a minute on the rounds 1', gl.guardKill === 2 && gl.patrol >= 60 && gl.guardN >= 3, gl);
  check('SEEKER: a crystal home is a point; BUILDER: a dig task finished meets the goal', gl.seek === 1 && gl.builder.n === gl.builder.need, gl);
  // shorter years: shorter goals
  check('the goals follow the year\'s length (SHORT x0.71, QUICK x0.58)', run(`setYearLen('short'); [jobNeed('forager'), jobNeed('guard'), jobNeed('seeker')].join()`) === '42,6,2' &&
    run(`setYearLen('quick'); [jobNeed('forager'), jobNeed('builder')].join()`) === '35,173' && run(`setYearLen('full'); jobNeed('builder')`) === 300);

  // ---- the colony's asks ---------------------------------------------------------
  const ak = run.json(`(() => {
    newWorld(4242, 2, 'coop', 2, 'full'); named(2); assignJobs(); stepSim(); G.events.length = 0;
    const c = G.colony, out = { asks: [] };
    // the queen bitten again and again for five minutes
    for (let t = 0; t < 60 * 300; t++) {
      c.queenHit = { col: 1, t: G.tick }; const q = c.queen(); if (q) q.hp = q.maxHp;
      stepSim();
      for (const e of G.events) if (e.t === 'msg' && e.key.startsWith('ask_')) out.asks.push([e.key, Math.round(t / 60), e.col]);
      G.events.length = 0;
    }
    // ...not when everyone is a guard already
    for (const p of G.players) p.job = 'guard';
    c.ask = null;
    let n = 0;
    for (let t = 0; t < 60 * 60; t++) {
      c.queenHit = { col: 1, t: G.tick }; stepSim();
      n += G.events.filter(e => e.t === 'msg' && e.key.startsWith('ask_')).length; G.events.length = 0;
    }
    out.allGuards = n;
    // winter, the nest open, nobody building: BUILDERS
    for (const p of G.players) p.job = 'forager';
    c.queenHit = null; c.ask = null;
    G.tick = 3 * SEASON_DAYS * DAY_LEN + 100; c.sealed = false;
    const w = [];
    for (let t = 0; t < 120; t++) { stepSim(); c.sealed = false; for (const e of G.events) if (e.t === 'msg' && e.key.startsWith('ask_')) w.push(e.key); G.events.length = 0; }
    out.winter = w;
    return out;
  })()`);
  const gk = ak.asks.filter(a => a[0] === 'ask_guard');
  check('the colony asks THE NEST NEEDS GUARDS when its queen is bitten -- to its side, rate-limited (3 minutes the same ask)',
    gk.length === 2 && gk[0][1] <= 2 && gk[1][1] - gk[0][1] >= 180 && gk.every(a => a[2] === 0), ak.asks);
  check('...not while everyone already guards; in winter with the nest open, BUILDERS: SEAL THE NEST', ak.allGuards === 0 &&
    ak.winter.join() === 'ask_build', { all: ak.allGuards, winter: ak.winter });
  const sk = run.json(`(() => {
    newWorld(4242, 1, 'coop', 1, 'full'); named(1); assignJobs(); stepSim(); G.events.length = 0;
    G.tick = Math.floor(SEASON_DAYS * DAY_LEN * 0.5) - 30;
    const keys = [];
    for (let t = 0; t < 200; t++) { stepSim(); for (const e of G.events) if (e.t === 'msg' && /^(ask_|m_relicFell)/.test(e.key)) keys.push(e.key); G.events.length = 0; }
    return keys;
  })()`);
  check('the golden seed falls: A GOLDEN SEED FELL: SEEKERS!', sk.join() === 'm_relicFell,ask_seek', sk);

  // ---- the highlights' awards ------------------------------------------------------
  const hl = run.json(`(() => {
    newWorld(4242, 3, 'coop', 3, 'full'); named(3); assignJobs();
    G.players[1].stats.guard = 9; G.players[2].stats.seek = 4; G.players[0].stats.patrol = 60 * 12;
    const h = matchHighlights(false);
    return { aw: h.awards.map(a => a.k + ':' + a.i + ':' + a.v), jobs: h.players.map(r => r.j), st: h.players.map(r => r.st.slice(7)) };
  })()`);
  check('highlights: BEST GUARD (guard points, patrol minutes too), TOP SEEKER; each player\'s job', hl.aw.includes('guard:0:12') &&
    hl.aw.includes('seeker:2:4') && hl.jobs.join() === 'forager,builder,guard', hl);

  // ---- a persistent world: a joiner, the rebirth ---------------------------------------
  const pw = run.json(`(() => {
    newWorld(4242, 0, 'world', 1);
    ensurePlayer(0).name = 'A'; ensurePlayer(1).name = 'B';
    const out = { a: pickJob(0), b: pickJob(1) };
    rebirthWorld(99);
    out.kept = G.players.map(p => p.job);
    return out;
  })()`);
  check('a persistent world: joiners get jobs (forager, then builder) and keep them through a rebirth', pw.a === 'forager' && pw.b === 'builder' &&
    pw.kept.join() === 'forager,builder', pw);

  // ---- saves: v12 keeps the job and its season; v11 gets jobs afresh -------------------------
  const sv = run.json(`(() => {
    newWorld(4242, 1, 'solo', 1, 'full'); assignJobs();
    const p = G.players[0];
    setJob(0, 'guard'); p.stats.guard = 3; p.stats.seek = 2; p.jgDone = 4;
    const d = JSON.parse(JSON.stringify(serializeWorld()));
    const out = { v: d.v };
    restoreWorld(JSON.parse(JSON.stringify(d)), 1);
    const q = G.players[0];
    out.v12 = { job: q.job, guard: q.stats.guard, seek: q.stats.seek, done: q.jgDone, k: q.jb && q.jb.k };
    const old = JSON.parse(JSON.stringify(d)); old.v = 11; delete old.pjobs;
    G.events.length = 0;
    restoreWorld(old, 1);
    out.v11 = { job: G.players[0].job, told: G.events.some(e => e.t === 'msg' && e.key === 'm_jobIs') };
    return out;
  })()`);
  check('save v12: the job, its tallies and the season\'s goals come back', sv.v === 12 && sv.v12.job === 'guard' && sv.v12.guard === 3 &&
    sv.v12.seek === 2 && sv.v12.done === 4 && sv.v12.k === 0, sv);
  check('...a v11 save gets a job afresh (told)', sv.v11.job === 'forager' && sv.v11.told, sv.v11);
}

// ---------------------------------------------------------------------------
// the server, raw clients
// ---------------------------------------------------------------------------
function freePort() {
  return new Promise(res => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
function getJson(port, p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path: p }, r => {
      let b = '';
      r.on('data', d => { b += d; });
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
function bot(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = { ws, name, msgs: [], ev: [], keys: new Set(), view: {}, you: -1, devR: null, lobby: null };
  ws.on('message', d => {
    let m;
    try { m = JSON.parse(d.toString()); } catch (e) { return; }
    if (m.t === 's') {
      if (m.e) b.ev.push(...m.e);
      if (m.v) for (const k in m.v) { b.keys.add(k); b.view[k] = m.v[k]; }
      return;
    }
    if (m.t === 'dev') { b.devR = m; return; }
    if (m.t === 'lobby') { b.you = m.you; b.lobby = m; }
    b.msgs.push(m);
  });
  ws.on('error', () => {});
  b.open = new Promise(r => ws.on('open', r));
  b.send = o => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  b.wait = async (pred, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = b.msgs.find(pred); if (m) return m; await sleep(20); }
    return null;
  };
  b.until = async (pred, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(20); } return false; };
  b.hello = async () => { await b.open; b.send({ t: 'hello', v: 1, name }); return b.wait(m => m.t === 'welcome'); };
  b.dev = async js => {
    b.devR = null;
    b.send({ t: 'dev', js, id: 1 });
    const t0 = Date.now();
    while (!b.devR && Date.now() - t0 < 20000) await sleep(20);
    return b.devR && b.devR.r;
  };
  return b;
}
const bots = async (port, names) => {
  const bs = names.map(n => bot(port, n));
  await Promise.all(bs.map(b => b.hello()));
  return bs;
};
const JOBS = ['forager', 'builder', 'guard', 'seeker'];
const jobOf = (b, i, k) => { const r = b.view[k || 'j0']; return r && r[i] ? JOBS[r[i][0]] : null; };

async function online(port) {
  const all = [];
  try {
    // ---- co-op: a preference in the lobby, the jobs at the start ------------------
    const [H, A, B] = await bots(port, ['HOST', 'ALFA', 'BETA']);
    all.push(H, A, B);
    H.send({ t: 'create', mode: 'coop' });
    const lb = await H.wait(m => m.t === 'lobby');
    for (const b of [A, B]) { b.send({ t: 'join', code: lb.code }); await b.wait(m => m.t === 'lobby'); }
    A.send({ t: 'jobpref', j: 'seeker' });
    B.send({ t: 'jobpref', j: 'nonsense' });
    await H.until(() => H.lobby && H.lobby.players[A.you] && H.lobby.players[A.you].j === 'seeker');
    check('lobby: a player\'s preferred job is on the list (junk: any)', H.lobby.players[A.you].j === 'seeker' && H.lobby.players[B.you].j === null,
      H.lobby.players.map(p => p && p.j));
    H.send({ t: 'start' });
    await H.wait(m => m.t === 'world'); await A.wait(m => m.t === 'world');
    await H.until(() => H.view.j0 && H.view.j0.filter(Boolean).length === 3);
    const j0 = [0, 1, 2].map(i => jobOf(H, i));
    check('the match starts: SEEKER for the one who asked, the rest by team size (forager, builder)', j0[A.you] === 'seeker' &&
      j0.filter(j => j === 'forager').length === 1 && j0.filter(j => j === 'builder').length === 1, j0);
    await A.until(() => A.ev.some(e => e[0] === 'm' && e[1] === 'm_jobIs'));
    const told = A.ev.filter(e => e[0] === 'm' && e[1] === 'm_jobIs');
    check('...each told its own (YOUR JOB)', told.length === 1 && told[0][4] === 1 && told[0][2][0].key === 'job_seeker', told);
    const g = H.view.j0[H.you];
    check('...and the j0 key carries its goal this season (done, needed, met)', g && g[1] === 0 && g[2] === 60 && g[3] === 0, g);
    // J through the protocol, and the job page's pick
    A.send({ t: 'job' });
    await H.until(() => jobOf(H, A.you) === 'forager');
    check('J (the job one-shot): the next job, seen by the side at once', jobOf(H, A.you) === 'forager', H.view.j0[A.you]);
    A.send({ t: 'jobset', j: 'guard' });
    A.send({ t: 'jobset', j: 'king' });
    await H.until(() => jobOf(H, A.you) === 'guard');
    check('the job page\'s pick (jobset): GUARD; a junk name ignored', jobOf(H, A.you) === 'guard');
    // a late joiner: what the side lacks most
    const [C] = await bots(port, ['CHARLIE']);
    all.push(C);
    C.send({ t: 'join', code: lb.code });
    await C.wait(m => m.t === 'world');
    await H.until(() => jobOf(H, C.you));
    const cj = jobOf(H, C.you);
    check('a late joiner gets the job its side lacks most', ['forager', 'guard', 'seeker'].includes(cj) && cj !== 'builder', { cj, all: H.view.j0 });
    // the perk is the server's: a forager's seed into the stores counts 6.25
    const fd = await H.dev(`(() => { const p = G.players[${H.you}]; setJob(${H.you}, 'forager'); const c = G.colony, a = p.ant;
      a.x = c.storage.x; a.y = c.storage.y; a.vx = a.vy = 0; c.food = 20;
      const it = G.makeItem('seed', a.x, a.y); G.items.push(it); it.carried = a; a.carry = it; p.refuseT = 0; p.input.act = true;
      controlPlayer(${H.you}); return c.food; })()`);
    check('online: the forager\'s perk applies in the room\'s sim', fd === 26.25, fd);

    // ---- versus: each side its own jobs, its own preferences --------------------------
    const [V, R, R2] = await bots(port, ['VBLACK', 'VRED', 'VRED2']);
    all.push(V, R, R2);
    V.send({ t: 'create', mode: 'versus', len: 'quick' });
    const vl = await V.wait(m => m.t === 'lobby');
    R.send({ t: 'join', code: vl.code }); await R.wait(m => m.t === 'lobby' && m.faction === 'red');
    R2.send({ t: 'join', code: vl.code }); await R2.wait(m => m.t === 'lobby');
    await sleep(200);
    R2.send({ t: 'side', f: 'red' });
    V.send({ t: 'jobpref', j: 'guard' });
    R.send({ t: 'jobpref', j: 'builder' });
    await R2.until(() => R2.lobby && R2.lobby.players[R.you] && R2.lobby.players[R.you].j === 'builder' && R2.lobby.players[R2.you].f === 'red');
    await V.until(() => V.lobby && V.lobby.players[V.you] && V.lobby.players[V.you].j === 'guard');
    check('versus lobby: the preferences seen by their own side only', R2.lobby.players[R.you].j === 'builder' && R2.lobby.players[V.you].j === null &&
      V.lobby.players[V.you].j === 'guard' && V.lobby.players[R.you].j === null, { red: R2.lobby.players.map(p => p && p.j), black: V.lobby.players.map(p => p && p.j) });
    V.send({ t: 'start' });
    await V.wait(m => m.t === 'world'); await R.wait(m => m.t === 'world');
    await V.until(() => V.view.j0 && R.view.j1 && R.view.j1.filter(Boolean).length === 2, 6000);
    check('versus: each side gets only its own jobs (j0 black, j1 red)', V.keys.has('j0') && !V.keys.has('j1') && R.keys.has('j1') && !R.keys.has('j0') &&
      jobOf(V, V.you) === 'guard' && jobOf(R, R.you, 'j1') === 'builder' && V.view.j0[R.you] === null,
      { b: V.view.j0, r: R.view.j1 });
    // the asks: to each side only
    V.ev.length = 0; R.ev.length = 0;
    await V.dev(`(() => { const c = G.colonies[1]; c.ask = null; c.queenHit = { col: 0, t: G.tick + 600 }; return 1; })()`);
    await R.until(() => R.ev.some(e => e[0] === 'm' && e[1] === 'ask_guard'), 3000);
    check('versus: red\'s ask for guards goes to red only', R.ev.some(e => e[0] === 'm' && e[1] === 'ask_guard') &&
      !V.ev.some(e => e[0] === 'm' && e[1] === 'ask_guard'));
  } finally {
    for (const b of all) try { b.ws.close(); } catch (e) { /* gone */ }
  }
}

// ---------------------------------------------------------------------------
// a browser page
// ---------------------------------------------------------------------------
async function screens(port) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const orig = Net.handle.bind(Net);
    Net.handle = async m => { if (m.t === 'dev') { window.__dev = m; return; } return orig(m); };
  });
  let devId = 100;
  const dev = async js => {
    const id = ++devId;
    await page.evaluate(([js, id]) => { window.__dev = null; Net.send({ t: 'dev', js, id }); }, [js, id]);
    await page.waitForFunction(id => window.__dev && window.__dev.id === id, id, { timeout: 8000 });
    return page.evaluate(() => window.__dev.r);
  };
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(70); } };
  const shot = async name => page.screenshot({ path: `test/shot-job-${name}.png` });
  // (every string drawn: inside the 320 px screen)
  const others = [];
  try {
    // ---- solo: the job given, J switching, the HUD line, the arrow ---------------------
    await page.evaluate(() => localStorage.clear());
    await key('Enter'); await page.waitForTimeout(300);   // title -> slots
    await key('Enter');                                    // a new world in slot 1
    await page.waitForFunction(() => G.state === 'intro' || G.state === 'play', null, { timeout: 20000 });
    await page.waitForTimeout(300);
    if (await page.evaluate(() => G.state === 'intro')) await key('Space');
    await page.waitForFunction(() => G.state === 'play', null, { timeout: 8000 });
    await page.evaluate(() => { Tut.setOn(false); });
    await page.waitForTimeout(300);
    const s0 = await page.evaluate(() => ({ job: G.players[0].job, msg: G.msgs.map(m => m.text).find(t => t.startsWith('YOUR JOB')) }));
    check('solo: the lone player gets the job the colony needs (FORAGER), told', s0.job === 'forager' && /^YOUR JOB: FORAGER - BRING FOOD HOME$/.test(s0.msg), s0);
    await key('j');
    await page.waitForTimeout(150);
    const s1 = await page.evaluate(() => { const t = topLayout(); return { job: G.players[0].job, line: t.job && t.job.str, strip: !!t.strip, w: t.job && textWidth(t.job.str) }; });
    check('J switches the job (BUILDER); the HUD\'s top line shows the job and its goal', s1.job === 'builder' && /^\x1E BUILDER: BUILT 0\/300$/.test(s1.line) && s1.strip, s1);
    // the arrow per job (solo, from the nest's mound)
    const ar = await page.evaluate(() => {
      const p = G.players[0], a = p.ant, c = G.colony, out = {};
      a.x = c.entrance.x - 40; a.y = T.surf[Math.round(a.x)] - 4; a.carry = null;
      c.tasks = []; c.queenHit = null;
      for (const j of JOBS) { p.job = j; const t = guidePoint(a); out[j] = t && { x: Math.round(t.x), y: Math.round(t.y), icon: t.icon }; }
      // builder with a blueprint: its nearest pixel
      p.job = 'builder';
      const bx = Math.round(a.x + 30), by = Math.round(a.y - 10);
      c.planSet(by * WORLD_W + bx, M_PACKED);
      PlanSeek.f = -99;
      const bt = guidePoint(a); out.plan = bt && { x: bt.x, y: bt.y, want: [bx, by] };
      c.planSet(by * WORLD_W + bx, 0);
      // guard with an intruder at home
      p.job = 'guard';
      const foe = new Ant(c.x + 80, T.surf[c.x + 80] - 4, 'worker', G.colonies[1]); G.ants.push(foe);
      const gt = guidePoint(a); out.intruder = gt && gt.x === foe.x;
      foe.hp = 0; G.ants = G.ants.filter(o => o !== foe);
      // seeker: the crystal field midway between the nests
      out.mid = Math.round((c.x + G.rival.x) / 2);
      p.job = 'builder';
      return out;
    });
    check('the arrow per job: FORAGER food, GUARD the nest, SEEKER the crystal field midway', ar.forager && ar.forager.icon === '\x03' &&
      ar.guard && ar.seeker && Math.abs(ar.seeker.x - ar.mid) <= 1 && ar.seeker.icon === '\x13', ar);
    check('...BUILDER the blueprint\'s nearest pixel; GUARD an intruder at home first', ar.plan && ar.plan.x === ar.plan.want[0] && ar.plan.y === ar.plan.want[1] &&
      ar.intruder, ar);
    await page.waitForTimeout(200);
    await shot('hud');
    // the O screen's job page (third), Enter takes the selected one
    await key('o'); await key('ArrowRight'); await key('ArrowRight');
    const op = await page.evaluate(() => ({ id: objPageIds()[G.objScreen.page], n: objPages() }));
    check('the O screen has a job page (third of four)', op.id === 'job' && op.n === 4, op);
    await key('ArrowDown');   // builder -> guard
    await key('Enter');
    await page.waitForTimeout(150);
    check('...UP/DOWN + ENTER takes a job (GUARD)', await page.evaluate(() => G.players[0].job === 'guard'));
    await shot('page');
    await page.evaluate(() => setLang(true));
    await page.waitForTimeout(100);
    await shot('page-no');
    await page.evaluate(() => setLang(false));
    await key('ArrowRight');
    const pm = await page.evaluate(() => objPageIds()[G.objScreen.page]);
    await shot('personal');
    check('...and the personal page next (the guard\'s tracks first)', pm === 'pm');
    await key('Escape');
    // C: the switch overlay preselects the job's caste (GUARD: a soldier)
    await key('c');
    await page.waitForTimeout(150);
    const tk = await page.evaluate(() => G.takeover && { sel: G.takeover.types[G.takeover.sel].caste });
    check('the switch overlay preselects the caste the job suits (GUARD: SOLDIER)', tk && tk.sel === 'soldier', tk);
    await shot('takeover');
    await key('Escape');
    // Norwegian HUD
    await page.evaluate(() => setLang(true));
    await page.waitForTimeout(150);
    await shot('hud-no');
    await page.evaluate(() => setLang(false));

    // ---- strings that must fit ---------------------------------------------------------
    const fit = await page.evaluate(() => {
      const bad = [], w = s => textWidth(String(s).replace(/\{\d\}/g, '888'));
      for (const lang of [0, 1]) {
        LANG = lang;
        for (const j of JOBS) {
          if (w(L('jd_' + j)) > 264) bad.push('jd_' + j);
          const line = JOB_ICON[j] + ' ' + L('jg_' + j, 888, 888);
          if (4 + w(line) + 8 + 120 > 316) bad.push('jg_' + j + ' + strip');
          if (w(L('m_jobIs', jobName(j), L('jt_' + j))) > 316) bad.push('m_jobIs ' + j);
          if (w(L('m_jobNow', jobName(j), L('jt_' + j))) > 316) bad.push('m_jobNow ' + j);
          if (w(L('m_jobGoal', jobName(j), 50)) > 316) bad.push('m_jobGoal ' + j);
          if (w(L('ui_jobNeed', jobName(j))) > 284) bad.push('ui_jobNeed ' + j);
          if (36 + w(jobName(j)) + 12 + w(L('ui_jobCaste', casteName(JOB_CASTE[j]))) > 300) bad.push('ui_jobCaste ' + j);
          if (w(L('ui_jobSuits', 'X' + jobName(j), casteName(JOB_CASTE[j]))) > 170) bad.push('ui_jobSuits ' + j);
          if (w(L('ui_lobbyLeave', jobName(j))) > 316) bad.push('ui_lobbyLeave ' + j);
        }
        for (const k of ['ask_guard', 'ask_forage', 'ask_seek', 'ask_build', 'm_patrol', 'm_forageCall', 'ui_jobKeys', 'ui_lobbyLeave']) if (w(L(k, jobName(null))) > 316) bad.push(k);
        for (const k of ['aw_guard', 'aw_seeker']) if (w(L(k)) > 82) bad.push(k);
      }
      LANG = 0;
      return bad;
    });
    check('every job string fits where it is drawn (both languages)', !fit.length, fit);

    // ---- online: a lobby with preferences -----------------------------------------------
    await page.evaluate(() => { G.state = 'title'; G.menuSel = 0; G.running = false; });
    await key('ArrowDown'); await key('Enter');
    await page.keyboard.type('Alpha'); await key('Enter');
    await key('ArrowDown'); await key('Enter');                // CREATE A MATCH
    await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown'); await key('Enter');   // CREATE
    await page.waitForFunction(() => G.state === 'lobby' && Net.code, null, { timeout: 8000 });
    const code = await page.evaluate(() => Net.code);
    const NAMES = ['BRAVOBRAVO12', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL'];
    const PREFS = ['guard', null, 'seeker', 'builder', null, 'forager', 'guard'];
    for (let k = 0; k < NAMES.length; k++) {
      const [b] = await bots(port, [NAMES[k]]);
      b.send({ t: 'join', code });
      await b.wait(m => m.t === 'lobby');
      if (PREFS[k]) b.send({ t: 'jobpref', j: PREFS[k] });
      others.push(b);
    }
    await key('j'); await key('j');                            // our own: ANY -> FORAGER -> BUILDER
    await page.waitForFunction(() => Net.players.filter(Boolean).length === 8 && Net.players[Net.you].j === 'builder', null, { timeout: 5000 }).catch(() => {});
    const lj = await page.evaluate(() => ({ mine: Net.players[Net.you].j, prefs: Net.players.map(p => p && p.j) }));
    check('lobby: J picks our preferred job (BUILDER); the others\' show by their names', lj.mine === 'builder' && lj.prefs.filter(Boolean).length === 6, lj);
    await shot('lobby');
    await page.evaluate(() => setLang(true));
    await page.waitForTimeout(100);
    await shot('lobby-no');
    await page.evaluate(() => setLang(false));
    await key('Enter');
    await page.waitForFunction(() => G.state === 'play' && Net.ready, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    if (await page.evaluate(() => !!G.takeover)) await key('Enter');
    await page.evaluate(() => { Tut.on = false; });
    await page.waitForTimeout(500);
    const oj = await page.evaluate(() => ({ job: G.players[LOCAL].job, line: topLayout().job && topLayout().job.str,
      all: G.players.map(p => p && p.job) }));
    check('online: our job from the lobby (BUILDER) on the HUD; the whole team has jobs', oj.job === 'builder' && /BUILDER: BUILT/.test(oj.line) &&
      oj.all.filter(Boolean).length === 8, oj);
    await shot('online-hud');
    // J online
    await key('j');
    await page.waitForFunction(() => G.players[LOCAL].job === 'guard', null, { timeout: 3000 }).catch(() => {});
    check('online: J switches the job through the server (GUARD)', await page.evaluate(() => G.players[LOCAL].job === 'guard'));
    // the scoreboard with icons
    await page.keyboard.down('Tab');
    await page.waitForTimeout(250);
    await shot('scores');
    await page.keyboard.up('Tab');
    // the end: job tallies, the flight, the highlights with the job awards
    await dev(`(() => { G.players.forEach((p, i) => { if (!p || !p.stats) return;
      Object.assign(p.stats, { kills: (i * 7) % 11, deaths: i % 3, food: 40 + i * 37, dug: 300 + ((i * 1777) % 9000), built: (i * 211) % 1500,
        care: i % 4 * 5, guard: (i * 5) % 9, seek: (i * 3) % 7 }); }); return 1; })()`);
    await dev(`(() => { const c = G.colonies[0];
      for (let i = 0; i < 2; i++) G.ants.push(new Ant(c.queenCh.x + i * 4, c.queenCh.y, 'princess', c));
      G.tick = YEAR_DAYS * DAY_LEN - 60; return G.tick; })()`);
    await page.waitForFunction(() => G.state === 'gameover', null, { timeout: 20000 });
    await page.waitForTimeout(300);
    await key('ArrowRight');
    const hl = await page.evaluate(() => { const h = G.gameOverStats.hl; return { aw: h.awards.map(a => a.k), jobs: h.players.map(r => r.j).filter(Boolean).length }; });
    check('the highlights: BEST GUARD and TOP SEEKER among the awards; every player\'s job', hl.aw.includes('guard') && hl.aw.includes('seeker') && hl.jobs === 8, hl);
    await shot('highlights');
    await page.evaluate(() => setLang(true));
    await page.waitForTimeout(100);
    await shot('highlights-no');
    await page.evaluate(() => setLang(false));
    check('no page errors', !errors.length, errors.slice(0, 5));
  } finally {
    for (const b of others) try { b.ws.close(); } catch (e) { /* gone */ }
    await browser.close();
  }
}

(async () => {
  simChecks();
  const port = await freePort();
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'maur-job-'));
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', MAUR_DEV: '1', PERSIST_WORLDS: '0',
      DATA_DIR: DATA, MAX_ROOMS: '8', CPU_BUDGET_MS: '1000', MAX_PLAYERS: '8', SIDE_MAX: '8', ROOM_IDLE_MS: '1000' }),
  });
  let srvLog = '';
  srv.stdout.on('data', d => { srvLog += d; });
  srv.stderr.on('data', d => { srvLog += d; });
  for (let i = 0; i < 50; i++) { await sleep(100); try { await getJson(port, '/api/health'); break; } catch (e) { /* not yet */ } }
  try {
    await online(port);
    if (!NO_BROWSER) await screens(port);
    check('no crash on the server', !srvLog.includes('CRASHED') && !srvLog.includes('uncaught'),
      srvLog.split('\n').filter(l => /CRASH|uncaught/.test(l)).slice(0, 3).join(' | '));
  } catch (e) {
    check('the probe ran to the end', false, e && e.stack || String(e));
  } finally {
    srv.kill();
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* in use */ }
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})();
