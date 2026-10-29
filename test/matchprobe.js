// Match probe: the year's length, the season's goal in view, personal
// milestones and the end-of-match highlights. First the sim alone (plain
// Node, a vm per world): FULL / SHORT / QUICK days and milestone targets (a
// FULL year exactly as before, a persistent world always FULL), the calendar
// turning at the short pace, a SHORT year fast-forwarded to its flight;
// personal milestones reached through play (a kill, a predator, the winter
// cold, a season survived) and from a tally, each told only to its player in
// its colour, rewarded, never twice; the highlights' awards; a persistent
// world's year told; v10 saves (the length, the tallies) and v9 ones. Then
// the server with raw clients: CREATE with LENGTH SHORT (OPEN MATCHES and the
// lobby say so, the world message too, the room's sim runs short), a junk
// length falling back to FULL, a personal milestone's toast and sound only
// for its player, the personal view of each side only for that side
// (versus), a fast-forwarded short year ending in a flight with the
// highlights. Last a browser page: CREATE's LENGTH row, the lobby, the goal
// strip at the top right (clear of the task and milestone lines, the name
// tags and the toasts) in spring and in winter, the O screen's PERSONAL
// MILESTONES page, a toast in the player's colour, the scoreboard's column,
// and the end screen (result + HIGHLIGHTS) after a co-op match of 8 and a
// versus match of 16, in English and Norwegian, as screenshots.
//   node test/matchprobe.js [--no-browser]
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
  return run;
}

function simChecks() {
  // ---- the year's length ------------------------------------------------------
  const run = simCtx(1);
  const lens = {};
  for (const len of ['full', 'short', 'quick', 'nonsense']) {
    run(`newWorld(4242, 1, 'solo', 1, '${len}')`);
    lens[len] = run.json(`({ len: G.yearLen, day: DAY_LEN, pace: +G.pace.toFixed(3), min: YEAR_DAYS * DAY_LEN / 3600,
      tick: G.tick, needs: [0, 1, 2, 3].map(s => newObjectives(1, s, 0).list.map(o => o.need).join(',')).join(' ') })`);
  }
  check('FULL: 4-minute days, a 48-minute year, the milestones as they were', lens.full.day === 14400 && lens.full.min === 48 &&
    lens.full.pace === 1 && lens.full.needs === '2,5,100 250,25,8 150,1800,1 1,45,3', lens.full);
  check('SHORT: 2-minute days (24 min), brood x1.41, the seasonal targets scaled', lens.short.day === 7200 && lens.short.min === 24 &&
    lens.short.pace === 1.414 && lens.short.needs === '2,4,70 175,22,4 105,1800,1 1,23,2', lens.short);
  check('QUICK: 80-second days (16 min), brood x1.73', lens.quick.day === 4800 && lens.quick.min === 16 &&
    lens.quick.pace === 1.732 && lens.quick.needs === '2,3,60 145,20,3 85,1800,1 1,15,1', lens.quick);
  check('an unknown length is a FULL year; a persistent world is always FULL', lens.nonsense.len === 'full' &&
    run(`newWorld(4242, 0, 'world', 1, 'short'), G.yearLen + DAY_LEN`) === 'full14400');
  // more players scale on top (8 players, SHORT: food 70 x 2.05)
  run(`newWorld(4242, 8, 'coop', 8, 'short')`);
  check('SHORT with 8 players: the player scaling on top', run(`newObjectives(1, 0, 0).list.find(o => o.id === 'food100').need`) === 144 &&
    run(`newObjectives(1, 1, 0).list.find(o => o.id === 'pop25').need`) === 22 + 14);

  // the calendar turns at the short pace: summer six minutes in, the new
  // year (and its flight) at 24 minutes
  run(`newWorld(4242, 1, 'solo', 1, 'short')`);
  const cal = run.json(`(() => {
    const out = {};
    G.tick = 3 * DAY_LEN - 5;
    for (let i = 0; i < 10; i++) { stepSim(); if (G.events.some(e => e.t === 'msg' && e.key === 'm_season')) out.summerAt = G.tick; G.events.length = 0; }
    out.season = G.season; out.min = out.summerAt / 3600;
    out.dayAt = { d: G.day, sd: G.seasonDay };
    return out;
  })()`);
  check('SHORT: summer comes 6 minutes in (tick 21600), day 4 of 12', cal.summerAt === 21600 && cal.season === 1 && cal.min === 6 &&
    cal.dayAt.d === 3 && cal.dayAt.sd === 0, cal);

  // a SHORT year fast-forwarded to the first day of spring in year 2: the
  // flight, its stars, the highlights on the end screen
  run(`newWorld(4242, 1, 'solo', 1, 'short')`);
  const fl = run.json(`(() => {
    const c = G.colony;
    G.ants.push(new Ant(c.queenCh.x, c.queenCh.y, 'princess', c));
    G.ants.push(new Ant(c.queenCh.x + 4, c.queenCh.y, 'princess', c));
    G.tick = 3 * SEASON_DAYS * DAY_LEN + 10;   // winter (the season turns now)
    stepSim(); G.events.length = 0;
    G.tick = YEAR_DAYS * DAY_LEN - 600;
    const t0 = G.tick;
    let flightAt = 0;
    while (!G.over && G.tick < t0 + 2000) {
      stepSim();
      if (G.flight && !flightAt) flightAt = G.tick;
      G.events.length = 0;
    }
    const o = G.over || {};
    return { flightAt, year: G.year, season: G.season, win: o.win, stars: o.stars, flown: o.flown, len: o.len, cont: o.canContinue,
      hl: o.hl && { n: o.hl.players.length, awards: o.hl.awards.map(a => a.k) } };
  })()`);
  check('SHORT: the year ends at 24 minutes with the nuptial flight (stars, CONTINUE, the length and highlights in G.over)',
    fl.flightAt === 12 * 7200 && fl.win && fl.stars >= 1 && fl.flown === 2 && fl.len === 'short' && fl.cont && fl.year === 2 &&
    fl.hl && fl.hl.n === 1, fl);

  // ---- personal milestones ----------------------------------------------------
  run(`newWorld(777, 2, 'coop', 2, 'full'); G.players[0].name = 'ALPHA'; G.players[1].name = 'BETA';`);
  const pm = run.json(`(() => {
    const out = {};
    const take = () => { const e = G.events.filter(e => e.key === 'm_pm' || e.key === 'm_pmGem' || (e.t === 'sfx' && e.to >= 0)); G.events.length = 0; return e; };
    const steps = n => { for (let i = 0; i < n; i++) stepSim(); };
    G.events.length = 0;
    const score0 = G.colony.score, cr0 = G.colony.crystals;
    G.players[0].stats.kills = 1;
    steps(61);
    out.first = take().map(e => [e.t, e.key || e.k, e.to, e.color, e.args && e.args[1]]);
    out.tier = G.players[0].stats.pm.hunter;
    out.score = G.colony.score - score0;
    // once only: nothing more for the same tally
    steps(120);
    out.again = take().length;
    // to the top tier at once: tiers 2 and 3, the third with a crystal
    G.players[0].stats.kills = 15;
    steps(61);
    out.top = take().filter(e => e.t === 'msg').map(e => [e.key, e.to, e.args[1].length]);
    out.crystals = G.colony.crystals - cr0;
    out.log = G.players[0].stats.pmLog.map(e => e[0] + e[1]).join();
    out.p1 = G.players[1].stats.pm.hunter;
    // through play: player 1 bites a spider to death (the kill and the predator)
    const b = G.players[1].ant;
    const sp = new Bug(b.x + 6, b.y, 'spider');
    G.bugs.push(sp);
    sp.lastHitIdx = 1; sp.lastHitT = G.tick; sp.hp = 0;
    steps(61);
    const ev = take().filter(e => e.t === 'msg');
    out.spider = { kills: G.players[1].stats.kills, preds: G.players[1].stats.preds, to: ev.map(e => e.to).join(),
      keys: ev.map(e => e.args[0].key).join(), colors: ev.map(e => e.color).join() };
    // the winter cold: 16 s on the winter surface
    G.tick = 3 * SEASON_DAYS * DAY_LEN + 100;
    steps(1); G.events.length = 0;
    const a = G.players[0].ant;
    a.hp = a.maxHp;
    for (let i = 0; i < 16 * 60; i++) { a.x = G.colony.entrance.x + 200; a.y = T.surf[a.x] - a.hh - 1; a.hp = a.maxHp; stepSim(); }
    out.frost = { s: Math.floor(G.players[0].stats.frost / 60), tier: G.players[0].stats.pm.frost };
    // a season survived (both alive as winter came: counted as it began)
    out.lives = G.players.map(p => p.stats.lives).join();
    G.events.length = 0;
    return out;
  })()`);
  check('a personal milestone: a toast only for its player, in its colour (@0), one star, its own sound, +25 score',
    pm.first.length === 2 && pm.first.some(e => e[0] === 'msg' && e[1] === 'm_pm' && e[2] === 0 && e[3] === '@0' && e[4] === '\x15') &&
    pm.first.some(e => e[0] === 'sfx' && e[2] === 0) && pm.tier === 1 && pm.score === 25, pm);
  check('...never twice; the top tier at once gives tiers 2 and 3, the third a crystal; the other player untouched',
    pm.again === 0 && pm.top.length === 2 && pm.top[1][0] === 'm_pmGem' && pm.top.every(t => t[1] === 0) && pm.crystals === 1 &&
    pm.log === 'hunter1,hunter2,hunter3' && !pm.p1, pm);
  check('...through play: a spider bitten to death is player 1\'s kill and predator (HUNTER, SLAYER, in its colour)',
    pm.spider.kills === 1 && pm.spider.preds === 1 && pm.spider.to === '1,1' && pm.spider.keys === 'pm_hunter,pm_slayer' &&
    pm.spider.colors === '@1,@1', pm.spider);
  check('...16 s out in the winter cold: FROSTBITE 1; a season lived through: SURVIVOR', pm.frost.s >= 15 && pm.frost.tier === 1 &&
    pm.lives === '1,1', { frost: pm.frost, lives: pm.lives });

  // ---- the highlights ---------------------------------------------------------
  run(`newWorld(778, 3, 'coop', 3); ['ANNA', 'BOB', 'CY'].forEach((n, i) => { G.players[i].name = n; });`);
  const hl = run.json(`(() => {
    const st = G.players.map(p => p.stats);
    Object.assign(st[0], { kills: 9, deaths: 3, food: 20, dug: 500, built: 50 });
    Object.assign(st[1], { kills: 1, deaths: 0, food: 300, dug: 9000, built: 10 });
    Object.assign(st[2], { kills: 0, deaths: 0, food: 5, dug: 100, built: 2400, planned: 600 });
    G.players[2].name = 'CY';
    for (let p = 0; p < 3; p++) checkPersonal(p);
    G.events.length = 0;
    const h = matchHighlights(false);
    return { awards: h.awards.map(a => a.k + ':' + a.i + ':' + a.v).join(' '), mvp: h.players.map(r => r.mvp), pm: h.players.map(r => r.pmNew.length) };
  })()`);
  check('the awards: MVP, TOP DIGGER, TOP BUILDER, TOP FORAGER, MOST KILLS, SURVIVOR (fewest deaths, the bigger MVP score)',
    /^mvp:1:\d+ digger:1:9000 builder:2:2400 forager:1:300 killer:0:9 survivor:1:0$/.test(hl.awards) && hl.pm.every(n => n > 0), hl);

  // ---- a persistent world's year: the MVP told, each player its own year ------
  run(`newWorld(779, 0, 'world'); ensurePlayer(0).name = 'ANNA'; ensurePlayer(1).name = 'BOB';`);
  const wy = run.json(`(() => {
    G.players[0].stats.food = 150; G.players[1].stats.kills = 2;
    checkPersonal(0); checkPersonal(1); G.events.length = 0;
    yearHighlights();
    const ev = G.events.filter(e => e.t === 'msg').map(e => [e.key, e.to]);
    G.events.length = 0;
    // the next year counts from here: nothing new, no MVP
    const again = matchHighlights(true);
    return { ev, yb: G.players.map(p => p.stats.yb && p.stats.yb.food), again: again.awards.length, newPm: again.players.map(r => r.pmNew.length) };
  })()`);
  check('a persistent world\'s flight: the year\'s MVP to everyone, each player its awards and its year, the next year from zero',
    wy.ev.some(e => e[0] === 'm_yearMvp' && e[1] === -1) && wy.ev.filter(e => e[0] === 'm_yourYear').map(e => e[1]).join() === '0,1' &&
    wy.ev.some(e => e[0] === 'm_yourAwards') && wy.yb[0] === 150 && wy.again === 0 && wy.newPm.join() === '0,0', wy);

  // ---- saves: v10 keeps the length and the tallies; v9 loads as FULL ----------
  run(`newWorld(780, 1, 'solo', 1, 'short')`);
  const sv = run.json(`(() => {
    G.players[0].stats.kills = 5; G.players[0].stats.frost = 900; checkPersonal(0); G.events.length = 0;
    for (let i = 0; i < 300; i++) stepSim();
    const d = JSON.parse(JSON.stringify(serializeWorld()));
    const tick = G.tick, season = G.season;
    newWorld(1, 1);
    const ok = restoreWorld(JSON.parse(JSON.stringify(d)), 1);
    const back = { ok, v: d.v, len: G.yearLen, day: DAY_LEN, pace: G.pace, tick: G.tick === tick, season: G.season === season,
      kills: G.players[0].stats.kills, tiers: pmCount(G.players[0].stats), log: G.players[0].stats.pmLog.length };
    const old = JSON.parse(JSON.stringify(d)); old.v = 9; delete old.yearLen; delete old.pstats;
    newWorld(2, 1, 'solo', 1, 'quick');
    const ok9 = restoreWorld(old, 1);
    back.v9 = { ok: ok9, len: G.yearLen, day: DAY_LEN, kills: G.players[0].stats.kills, pm: pmCount(G.players[0].stats) };
    back.summary = worldSummary(d).len;
    return back;
  })()`);
  check('v10 saves keep the year\'s length and each player\'s tally and personal milestones', sv.ok && sv.v === 10 && sv.len === 'short' &&
    sv.day === 7200 && sv.tick && sv.season && sv.kills === 5 && sv.tiers === 3 && sv.log === 3 && sv.summary === 'short', sv);
  check('...a v9 save loads as a FULL year with fresh tallies', sv.v9.ok && sv.v9.len === 'full' && sv.v9.day === 14400 &&
    sv.v9.kills === 0 && sv.v9.pm === 0, sv.v9);
}

// ---------------------------------------------------------------------------
// online
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

// a raw protocol client: its messages, the snapshots' events and view keys
// it was sent, dev hooks
function bot(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = { ws, name, msgs: [], ev: [], keys: new Set(), view: {}, you: -1, devR: null };
  ws.on('message', d => {
    let m;
    try { m = JSON.parse(d.toString()); } catch (e) { return; }
    if (m.t === 's') {
      if (m.e) b.ev.push(...m.e);
      if (m.v) for (const k in m.v) { b.keys.add(k); b.view[k] = m.v[k]; }
      return;
    }
    if (m.t === 'dev') { b.devR = m; return; }
    if (m.t === 'lobby') b.you = m.you;
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

// the end of the year, now: two princesses in colony c and the clock at the
// eve of year 2 (the flight decides)
const TO_FLIGHT = c => `(() => { const c = G.colonies[${c}];
  for (let i = 0; i < 2; i++) G.ants.push(new Ant(c.queenCh.x + i * 4, c.queenCh.y, 'princess', c));
  G.tick = YEAR_DAYS * DAY_LEN - 60; return G.tick; })()`;

async function online(port) {
  const all = [];
  try {
    // ---- CREATE with LENGTH SHORT --------------------------------------------
    const [H, J, L] = await bots(port, ['HOST', 'JOINER', 'LISTER']);
    all.push(H, J, L);
    H.send({ t: 'create', mode: 'coop', pub: true, len: 'short' });
    const lb = await H.wait(m => m.t === 'lobby');
    L.send({ t: 'list' });
    const ls = await L.wait(m => m.t === 'list');
    const row = ls && ls.matches.find(r => r.code === (lb && lb.code));
    check('CREATE with LENGTH SHORT: the lobby and OPEN MATCHES say so', lb && lb.len === 'short' && row && row.len === 'short', { lobby: lb && lb.len, row });
    J.send({ t: 'join', code: lb.code });
    await J.wait(m => m.t === 'lobby');
    H.send({ t: 'start' });
    const wm = await H.wait(m => m.t === 'world');
    const jw = await J.wait(m => m.t === 'world');
    await sleep(300);
    const simLen = await H.dev('G.yearLen + DAY_LEN + "," + Math.round(G.pace * 100) + "," + newObjectives(1, 1, 0).list.map(o => o.need).join("/")');
    check('the match runs SHORT: the world message says so, the room\'s sim has 2-minute days and short targets',
      wm && wm.len === 'short' && jw && jw.len === 'short' && simLen === 'short7200,141,201/24/5', { len: wm && wm.len, simLen });
    // a junk length is a FULL year
    const [X] = await bots(port, ['JUNK']);
    all.push(X);
    X.send({ t: 'create', mode: 'versus', len: 'eternal' });
    const xl = await X.wait(m => m.t === 'lobby');
    check('...a junk length is a FULL year', xl && xl.len === 'full', xl && xl.len);
    X.send({ t: 'leave' });

    // ---- a personal milestone: only its player hears of it ----------------------
    await sleep(500);
    H.ev.length = 0; J.ev.length = 0;
    await H.dev(`G.players[${J.you}].stats.kills = 1`);
    await sleep(2600);
    const jm = J.ev.filter(e => e[0] === 'm' && e[1] === 'm_pm'), hm = H.ev.filter(e => e[0] === 'm' && e[1] === 'm_pm');
    const js = J.ev.filter(e => e[0] === 's' && e[1] === 'task'), hs = H.ev.filter(e => e[0] === 's' && e[1] === 'task');
    const q = J.view.q0;
    check('online: a personal milestone\'s toast (in the player\'s colour) and sound reach only that player',
      jm.length === 1 && jm[0][3] === '@' + J.you && !hm.length && js.length >= 1 && hs.length < js.length, { jm, hm: hm.length, js: js.length, hs: hs.length });
    check('...and the co-op side\'s personal view (q0) has its tier', q && q[J.you] && q[J.you][0][0] === '1' && q[H.you][0] === '0000000000', q);

    // ---- a fast-forwarded short year: the flight, the highlights ---------------
    await H.dev(TO_FLIGHT(0));
    const ov = await H.wait(m => m.t === 'over', 15000);
    const o = ov && ov.over;
    check('online: the SHORT year ends with the flight; everyone gets the highlights (players, awards) and the length',
      o && o.win && o.len === 'short' && o.hl && o.hl.players.length === 2 && o.hl.awards.some(a => a.k === 'mvp') &&
      o.hl.players.every(r => r.n), o && { win: o.win, len: o.len, hl: o.hl });

    // ---- versus: each side's personal view only for that side -------------------
    const [B, R] = await bots(port, ['BLACKY', 'REDDY']);
    all.push(B, R);
    B.send({ t: 'create', mode: 'versus', len: 'quick' });
    const vl = await B.wait(m => m.t === 'lobby');
    R.send({ t: 'join', code: vl.code });
    await R.wait(m => m.t === 'lobby' && m.faction === 'red');
    B.send({ t: 'start' });
    await B.wait(m => m.t === 'world');
    await R.wait(m => m.t === 'world');
    await B.dev(`G.players[${R.you}].stats.food = 25; G.players[${B.you}].stats.kills = 1`);
    await sleep(1800);
    check('versus: each side gets only its own side\'s personal milestones (q0 black, q1 red)',
      B.keys.has('q0') && !B.keys.has('q1') && R.keys.has('q1') && !R.keys.has('q0') &&
      R.view.q1[R.you][0][2] === '1' && B.view.q0[B.you][0][0] === '1' && B.view.q0[R.you] === null,
      { b: [...B.keys].filter(k => k[0] === 'q'), r: [...R.keys].filter(k => k[0] === 'q') });
    const rm = R.ev.filter(e => e[0] === 'm' && e[1] === 'm_pm'), bm = B.ev.filter(e => e[0] === 'm' && e[1] === 'm_pm');
    check('...and its toasts only for its player', rm.length === 1 && bm.length === 1 && rm[0][3] === '@' + R.you && bm[0][3] === '@' + B.you,
      { rm, bm });
    // the end: the enemy's personal milestones only now
    await B.dev(`(() => { const q = G.colonies[1].queen(); q.hp = 0; return 1; })()`);
    const vo = await R.wait(m => m.t === 'over', 10000);
    const vh = vo && vo.over && vo.over.hl;
    check('versus: the end screen\'s highlights show both sides (the enemy\'s milestones only there)',
      vh && vh.players.length === 2 && vh.players.some(r => r.c === 0 && r.pmNew.length === 1) && vh.players.some(r => r.c === 1 && r.pmNew.length === 1),
      vh);
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
  const NAMES = ['BRAVOBRAVO12', 'CHARLIE', 'DELTA', 'ECHOECHO', 'FOXTROT', 'GOLFGOLFGOLF', 'HOTEL'];
  const NAMES16 = NAMES.concat(['INDIA', 'JULIETTJULIE', 'KILO', 'LIMA', 'MIKEMIKE', 'NOVEMBER', 'OSCAR', 'PAPA']);
  const others = [];
  // every player's tally made up for the end screen (the room's sim)
  const STATS = `(() => { G.players.forEach((p, i) => { if (!p || !p.stats) return;
      Object.assign(p.stats, { kills: (i * 7) % 11, deaths: i % 3, food: 40 + i * 37, dug: 300 + ((i * 1777) % 9000), built: (i * 211) % 1500,
        care: i % 4 * 5, milked: i % 5, crystals: i % 2 });
      checkPersonal(i); }); return G.players.length; })()`;
  try {
    // title -> ONLINE -> name -> CREATE: co-op, LENGTH SHORT, private
    await key('ArrowDown'); await key('Enter');
    await page.keyboard.type('Alpha'); await key('Enter');
    await key('ArrowDown'); await key('Enter');                // CREATE A MATCH
    await key('ArrowDown'); await key('ArrowRight');           // LENGTH: SHORT
    const cr = await page.evaluate(() => ({ len: G.crLen, sel: G.crSel }));
    await page.screenshot({ path: 'test/shot-match-create.png' });
    check('CREATE A MATCH has a LENGTH row (FULL / SHORT / QUICK)', cr.len === 'short' && cr.sel === 1, cr);
    await key('ArrowDown'); await key('ArrowDown'); await key('Enter');   // CREATE
    await page.waitForFunction(() => G.state === 'lobby' && Net.code, null, { timeout: 8000 });
    const code = await page.evaluate(() => Net.code);
    for (const n of NAMES) {
      const [b] = await bots(port, [n]);
      b.send({ t: 'join', code });
      await b.wait(m => m.t === 'lobby');
      others.push(b);
    }
    await page.waitForFunction(() => Net.players.filter(Boolean).length === 8, null, { timeout: 5000 }).catch(() => {});
    check('the lobby says SHORT', await page.evaluate(() => Net.len === 'short'));
    await page.screenshot({ path: 'test/shot-match-lobby.png' });
    await key('Enter');
    await page.waitForFunction(() => G.state === 'play' && Net.ready, null, { timeout: 20000 });
    await page.waitForTimeout(600);
    if (await page.evaluate(() => !!G.takeover)) await key('Enter');
    // the HUD: the goal strip at the top right, the calendar at the short pace
    await page.evaluate(() => { Tut.on = false; });
    await page.waitForTimeout(400);
    const hud = await page.evaluate(() => {
      const t = topLayout();
      const over = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      const rs = t.rects;
      return { len: G.yearLen, day: DAY_LEN, strip: t.strip && t.strip.segs.map(s => s[0]).join(''), y: t.strip && t.strip.y,
        right: t.strip && t.strip.x + t.strip.w, overlap: rs.some((r, i) => rs.some((o, j) => j > i && over(r, o))),
        belowMsgs: rs.every(r => r.y + r.h <= 23) };
    });
    check('the goal strip: the season, its milestones x/3, the time left -- at the top right, clear of the task and milestone lines',
      hud.len === 'short' && hud.day === 7200 && /^.SPRING \d\/3 .\d+:\d\d$/.test(hud.strip) && hud.right <= 316 && !hud.overlap && hud.belowMsgs, hud);
    await page.screenshot({ path: 'test/shot-match-hud.png' });
    // the other players' tags keep clear of it: everyone along the top of
    // the view (the render model's ants, moved for one layout)
    const tags = await page.evaluate(() => {
      const cx = Math.round(G.cam.x), cy = Math.round(G.cam.y);
      G.msgs = [];   // (the toasts are kept clear of too: none now)
      let k = 0;
      for (let i = 0; i < G.players.length; i++) {
        const a = G.players[i].ant;
        if (!a || i === LOCAL) continue;
        a.x = cx + 20 + k * 44; a.y = cy + 14; k++;
      }
      const v = playerView(), n0 = Labels.rects.length;
      drawNameTags(Math.round(G.cam.x), Math.round(G.cam.y), v.vw, v.vh);
      const rs = Labels.rects.splice(n0), top = topLayout().rects;
      const over = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      return { n: rs.length, hit: rs.some(r => top.some(o => over(r, o))) };
    });
    check('...the name tags never cover the top lines (they go under their ants)', !tags.hit && tags.n >= 3, tags);
    // winter: the princesses for the flight, the time to it
    await dev(`(() => { const c = G.colonies[0]; G.ants.push(new Ant(c.queenCh.x, c.queenCh.y, 'princess', c));
      G.tick = 3 * SEASON_DAYS * DAY_LEN + 600; return G.tick; })()`);
    await page.waitForTimeout(1200);
    const win = await page.evaluate(() => { const t = topLayout(); return t.strip && t.strip.segs.map(s => s[0]).join(''); });
    check('...in winter: the princesses raised and the time to the flight', /\x111 /.test(win) && /FLIGHT IN \d+:\d\d|\x1A\d+:\d\d/.test(win), win);
    await page.screenshot({ path: 'test/shot-match-hud-winter.png' });
    // a personal milestone: a toast in our colour; the O screen's page; the scoreboard
    await dev(`G.players[0].stats.kills = 5; G.players[0].stats.food = 25; 1`);
    await page.waitForTimeout(1500);
    const toast = await page.evaluate(() => G.msgs.filter(m => m.text.startsWith('\x1B')).map(m => [m.text, m.color === playerColor(LOCAL)]));
    check('a personal milestone shows as a toast in the player\'s own colour', toast.length >= 2 && toast.every(t => t[1]), toast);
    await page.screenshot({ path: 'test/shot-match-toast.png' });
    await key('o'); await key('ArrowLeft');
    const pg = await page.evaluate(() => ({ id: objPageIds()[G.objScreen.page], n: pmCount(G.players[LOCAL].stats) }));
    check('the O screen\'s last page: PERSONAL MILESTONES (hunter 2 tiers, forager 1, and more)', pg.id === 'pm' && pg.n >= 3, pg);
    await page.screenshot({ path: 'test/shot-match-personal.png' });
    await key('Escape');
    await page.keyboard.down('Tab');
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'test/shot-match-scores.png' });
    await page.keyboard.up('Tab');
    // the end: 8 players' tallies, the flight
    await dev(STATS);
    await page.waitForTimeout(1200);
    await dev(TO_FLIGHT(0));
    await page.waitForFunction(() => G.state === 'gameover', null, { timeout: 20000 });
    await page.waitForTimeout(300);
    const eo = await page.evaluate(() => ({ hl: !!(G.gameOverStats && G.gameOverStats.hl), n: G.gameOverStats.hl.players.length,
      awards: G.gameOverStats.hl.awards.map(a => a.k).join() }));
    check('the co-op end screen: the result with the MVP; 8 players in the highlights', eo.hl && eo.n === 8 && eo.awards.startsWith('mvp'), eo);
    await page.screenshot({ path: 'test/shot-match-over-coop.png' });
    await key('ArrowRight');
    check('RIGHT: the highlights page', await page.evaluate(() => G.overPage === 1));
    await page.screenshot({ path: 'test/shot-match-hl-coop.png' });
    await page.evaluate(() => setLang(true));
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'test/shot-match-hl-no.png' });
    await key('ArrowLeft');
    await page.screenshot({ path: 'test/shot-match-over-no.png' });
    await page.evaluate(() => setLang(false));
    for (const b of others) b.ws.close();
    others.length = 0;
    await key('Enter');
    await page.waitForTimeout(400);

    // versus 8v8: the page on black, 15 bots
    await page.evaluate(() => { G.state = 'title'; G.menuSel = 0; G.crLen = 'full'; });
    await key('ArrowDown'); await key('Enter');
    await key('Enter');                               // (the name remembered)
    await key('ArrowDown'); await key('Enter');      // CREATE A MATCH
    await key('ArrowRight');                          // versus
    await key('ArrowDown'); await key('ArrowRight', 2);   // QUICK
    await key('ArrowDown'); await key('ArrowDown'); await key('Enter');
    await page.waitForFunction(() => G.state === 'lobby' && Net.code && Net.mode === 'versus', null, { timeout: 8000 });
    const vcode = await page.evaluate(() => Net.code);
    for (const n of NAMES16) {
      const [b] = await bots(port, [n]);
      b.send({ t: 'join', code: vcode });
      await b.wait(m => m.t === 'lobby');
      others.push(b);
    }
    await page.waitForFunction(() => Net.players.filter(Boolean).length === 16, null, { timeout: 8000 }).catch(() => {});
    check('the versus lobby: QUICK, 16 players', await page.evaluate(() => Net.len === 'quick' && Net.players.filter(Boolean).length === 16));
    await page.screenshot({ path: 'test/shot-match-vs-lobby.png' });
    await key('Enter');
    await page.waitForFunction(() => G.state === 'play' && Net.ready, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    await dev(STATS);
    await page.waitForTimeout(1200);
    await dev(TO_FLIGHT(0));
    await page.waitForFunction(() => G.state === 'gameover', null, { timeout: 20000 });
    await page.waitForTimeout(300);
    const vo = await page.evaluate(() => { const s = G.gameOverStats; return { vs: s.versus, n: s.hl.players.length, sides: [0, 1].map(c => s.hl.players.filter(r => r.c === c).length) }; });
    check('the versus end screen: 16 players, a side a column in the highlights', vo.vs && vo.n === 16 && vo.sides.join() === '8,8', vo);
    await page.screenshot({ path: 'test/shot-match-over-vs.png' });
    await key('ArrowRight');
    await page.screenshot({ path: 'test/shot-match-hl-vs.png' });
    check('no page errors', !errors.length, errors.slice(0, 5));
  } finally {
    for (const b of others) try { b.ws.close(); } catch (e) { /* gone */ }
    await browser.close();
  }
}

(async () => {
  simChecks();
  const port = await freePort();
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'maur-match-'));
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
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  process.exitCode = fails.length ? 1 : 0;
})();
