// Versus probe: black against red. First the sim alone (plain Node, a vm
// per world): both nests equal from the seed (capacities, households), each
// side's own gates, no AI raids, the red queen as tough as the black, the
// flight deciding the match (stars, then princesses, then ants). Then the
// server as a child process with two browser pages (A black, the host; B
// red) and two raw clients (C red, D black): CREATE A MATCH -> versus, the
// lobby's sides and the start rule, a 2v2 match, takeover only within one's
// own colony (never the queen), each side's milestones and HUD from its own
// colony (the enemy's private numbers never sent), messages that stay on
// their side, and the enemy queen slain ending the match for everyone with
// the right winner.
//   node test/versusprobe.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const WebSocket = require(path.join(ROOT, 'server', 'node_modules', 'ws'));

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
  const ctx = vm.createContext({ console, Math: M });
  for (const f of ['worldgen.js', 'terrain.js', 'entities.js', 'colony.js', 'game.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  }
  return code => vm.runInContext(code, ctx);
}

function simChecks() {
  // both nests equal, from the seed alone (several seeds; caves cut into
  // one nest or the other at random)
  const eq = [];
  for (const seed of [11, 22, 33, 44, 55, 66]) {
    const run = simCtx(seed);
    run(`newWorld(${seed * 7919}, 0, 'versus')`);
    eq.push(JSON.parse(run(`JSON.stringify(G.colonies.map(c => ({ caps: c.caps, ants: c.members().map(a => a.caste).sort().join(),
      brood: c.broodCount(), food: c.food, player: c.player, obj: !!c.objectives, chambers: c.chambers.map(ch => ch.type + ch.area).join() })))`)));
  }
  const same = eq.every(([a, b]) => JSON.stringify(a.caps) === JSON.stringify(b.caps) && a.ants === b.ants &&
    a.brood === b.brood && a.food === b.food && a.player && b.player && a.obj && b.obj && a.chambers === b.chambers);
  check('versus: both nests equal on every seed (capacities, chambers, household, food, milestones)', same,
    eq.map(([a, b]) => [a.caps.pop, b.caps.pop, a.caps.food, b.caps.food]));
  // (and in co-op the generated nests are left as they were)
  const run = simCtx(7);
  run(`newWorld(${4 * 7919}, 1, 'coop')`);
  const coop = JSON.parse(run(`JSON.stringify({ pops: G.colonies.map(c => c.caps.pop), red: G.rival.player, redAnts: G.rival.members().length,
    redQ: G.rival.queen().maxHp, gates: G.colonies.map(c => c.gates), split: T.gateSplit })`));
  check('co-op keeps the old rules (red is the AI, its queen 1.5x, black passes every gate)', !coop.red && coop.redAnts === 12 &&
    coop.redQ === 180 && coop.gates[0] === true && coop.gates[1] === false && coop.split === null, coop);

  run(`newWorld(${4 * 7919}, 0, 'versus')`);
  const vs = JSON.parse(run(`(() => {
    const [b, r] = G.colonies;
    // a gate built on each side of the line between the nests
    const gx = [b.x + 300, r.x - 300], gy = [T.surf[b.x + 300] - 3, T.surf[r.x - 300] - 3];
    for (let i = 0; i < 2; i++) T.m[gy[i] * WORLD_W + gx[i]] = M_GATE;
    return JSON.stringify({ gates: G.colonies.map(c => c.gates), split: T.gateSplit,
      blackGate: [T.solid(gx[0], gy[0], b.gates), T.solid(gx[0], gy[0], r.gates)],
      redGate: [T.solid(gx[1], gy[1], b.gates), T.solid(gx[1], gy[1], r.gates)],
      queens: G.colonies.map(c => c.queen().maxHp) });
  })()`));
  check('versus: each side passes only its own ant gates', vs.blackGate[0] === false && vs.blackGate[1] === true &&
    vs.redGate[0] === true && vs.redGate[1] === false && vs.split > 0, vs);
  check('versus: the queens are equal (no 1.5x red queen)', vs.queens[0] === vs.queens[1] && vs.queens[0] === 120, vs.queens);
  // no AI raids: a strong red colony in summer never sends one
  const raid = JSON.parse(run(`(() => {
    const r = G.rival;
    r.food = 120;
    for (let i = 0; i < 12; i++) G.ants.push(new Ant(r.junction.x, r.junction.y, 'soldier', r));
    G.tick = DAY_LEN * 4;
    for (let i = 0; i < DAY_LEN / 2; i++) { stepSim(); G.events.length = 0; }
    return JSON.stringify({ raids: G.colonies.map(c => c.stats.raids), raiding: G.ants.filter(a => a.raiding).length, over: G.over });
  })()`));
  check('versus: no AI raids on either side', raid.raids[0] === 0 && raid.raids[1] === 0 && raid.raiding === 0 && !raid.over, raid);
  // each side its own milestones, its seasons turning together
  const ms = JSON.parse(run(`JSON.stringify(G.colonies.map(c => c.objectives && [c.objectives.year, c.objectives.season, c.objectives.list.map(o => o.id).join()]))`));
  check('versus: both colonies have their own milestones, in step', ms[0] && ms[1] && ms[0].join() === ms[1].join() && ms[0][1] === 1, ms);

  // the flight decides: red flies 2 princesses, black 1 (stars equal on
  // nothing else) -> red wins on princesses or stars
  run(`newWorld(${5 * 7919}, 0, 'versus')`);
  const fl = JSON.parse(run(`(() => {
    const [b, r] = G.colonies;
    G.ants.push(new Ant(b.queenCh.x, b.queenCh.y, 'princess', b));
    for (let i = 0; i < 3; i++) G.ants.push(new Ant(r.queenCh.x, r.queenCh.y, 'princess', r));
    G.tick = YEAR_DAYS * DAY_LEN - 3;
    // (the deciding flight announces no new year, hands out no new tasks)
    let quiet = 0;
    for (let i = 0; i < FLIGHT_T + 20 && !G.over; i++) {
      stepSim();
      // (from the turn of the year: the jump to its eve has news of its own)
      if (G.tick >= YEAR_DAYS * DAY_LEN) quiet += G.events.filter(e => e.t === 'msg' && (e.key === 'm_season' || e.key === 'm_newTask')).length;
      G.events.length = 0;
    }
    return JSON.stringify(Object.assign({ quiet }, G.over));
  })()`));
  check('versus: at the year 2 flight the side with more stars wins', fl && fl.versus && fl.winner === 1 && fl.reason === 'r_vsFlight' &&
    fl.sides[1].stars > fl.sides[0].stars && fl.sides[1].flown === 3 && fl.sides[0].flown === 1, fl && { winner: fl.winner, sides: fl.sides.map(s => [s.stars, s.flown, s.pop]) });
  check('versus: the deciding flight brings no new-year or new-task messages', fl && fl.quiet === 0, fl && fl.quiet);
  // equal flights: then the bigger colony (both empty-handed: 0 stars, 0 flown)
  run(`newWorld(${6 * 7919}, 0, 'versus')`);
  const tie = JSON.parse(run(`(() => {
    const [b, r] = G.colonies;
    G.ants.push(new Ant(b.junction.x, b.junction.y, 'worker', b));
    G.tick = YEAR_DAYS * DAY_LEN - 3;
    for (let i = 0; i < FLIGHT_T + 20 && !G.over; i++) { stepSim(); G.events.length = 0; }
    return JSON.stringify(G.over);
  })()`));
  check('versus: stars and princesses tied -> the bigger colony wins', tie && tie.winner === 0 && tie.sides[0].pop > tie.sides[1].pop,
    tie && { winner: tie.winner, sides: tie.sides.map(s => [s.stars, s.flown, s.pop]) });
  // a queen with an heir is succeeded; one without loses the match
  run(`newWorld(${6 * 7919}, 0, 'versus')`);
  const heir = JSON.parse(run(`(() => {
    const r = G.colonies[1];
    G.ants.push(new Ant(r.queenCh.x, r.queenCh.y, 'princess', r));
    r.queen().hp = 0;
    for (let i = 0; i < 5; i++) { stepSim(); G.events.length = 0; }
    const crowned = !!r.queen() && !G.over;
    G.colonies[0].queen().hp = 0;
    for (let i = 0; i < 5; i++) { stepSim(); G.events.length = 0; }
    return JSON.stringify({ crowned, over: G.over && { winner: G.over.winner, reason: G.over.reason } });
  })()`));
  check('versus: a princess succeeds her queen; a queen with no heir loses the match at once', heir.crowned &&
    heir.over && heir.over.winner === 1 && heir.over.reason === 'r_vsQueen', heir);
  // a colony's own news isn't triggered by the other side's players (a
  // black ant killed by red, no black player near: black isn't told); an
  // enemy biting the queen warns her side (once in a while)
  run(`newWorld(${6 * 7919}, 0, 'versus')`);
  const news = JSON.parse(run(`(() => {
    ensurePlayer(0).col = 0; joinColony(0, 0);
    ensurePlayer(1).col = 1; joinColony(1, 1);
    const [b, r] = G.colonies, blk = G.players[0].ant, red = G.players[1].ant;
    const w = G.ants.find(a => a.colony === b && a.caste === 'worker' && a.playerIdx < 0);
    red.x = w.x + 10; red.y = w.y; blk.x = r.x; blk.y = r.entrance.y - 10;
    w.hp = 0; G.events.length = 0;
    stepSim();
    const died = G.events.filter(e => e.t === 'msg' && e.key === 'm_antDied').length;
    G.events.length = 0;
    const q = b.queen();
    q.hurt(1, 0, 0, red); q.hurt(1, 0, 0, red);
    const warn = G.events.filter(e => e.t === 'msg' && e.key === 'm_queenAttacked').map(e => e.col);
    G.events.length = 0;
    q.hurt(1, 0, 0, null);   // (the cold, a bug: no enemy colony)
    const other = G.events.filter(e => e.t === 'msg' && e.key === 'm_queenAttacked').length;
    return JSON.stringify({ died, warn, other });
  })()`));
  check("versus: no colony news from the enemy's players; an enemy at the queen warns her side", news.died === 0 &&
    news.warn.length === 1 && news.warn[0] === 0 && news.other === 0, news);
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
function bot(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = { ws, msgs: [], view: {}, events: [], keys: new Set(), snaps: 0, name, devR: null };
  ws.on('message', d => {
    let m;
    try { m = JSON.parse(d.toString()); } catch (e) { return; }
    if (m.t === 's') {
      b.snaps++;
      if (m.v) for (const k in m.v) { b.view[k] = m.v[k]; b.keys.add(k); }
      if (m.e) b.events.push(...m.e);
      return;
    }
    if (m.t === 'dev') { b.devR = m; return; }
    b.msgs.push(m);
  });
  ws.on('error', () => {});
  b.open = new Promise(r => ws.on('open', r));
  b.send = o => ws.send(JSON.stringify(o));
  b.wait = async (pred, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = b.msgs.find(pred); if (m) return m; await sleep(20); }
    return null;
  };
  b.last = t => { for (let i = b.msgs.length - 1; i >= 0; i--) if (b.msgs[i].t === t) return b.msgs[i]; return null; };
  b.dev = async js => {
    b.devR = null;
    b.send({ t: 'dev', js, id: 1 });
    const t0 = Date.now();
    while (!b.devR && Date.now() - t0 < 30000) await sleep(20);
    return b.devR && b.devR.r;
  };
  return b;
}

(async () => {
  simChecks();

  const port = await freePort();
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'maur-vs-'));
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', MAUR_DEV: '1', PERSIST_WORLDS: '0', DATA_DIR: DATA,
      // (rooms of 4: at most 2 a side -- 4v4 in rooms of 8 is test/eightprobe.js's)
      MAX_PLAYERS: '4', SIDE_MAX: '2' }),
  });
  let srvLog = '';
  srv.stdout.on('data', d => { srvLog += d; });
  srv.stderr.on('data', d => { srvLog += d; });
  for (let i = 0; i < 50; i++) { await sleep(100); try { await getJson(port, '/api/health'); break; } catch (e) { /* not yet */ } }

  const browser = await chromium.launch();
  const errors = [];
  const mkPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const orig = Net.handle.bind(Net);
      Net.handle = async m => { if (m.t === 'dev') { window.__dev = m; return; } return orig(m); };
    });
    return page;
  };
  let devId = 0;
  const dev = async (page, js) => {
    const id = ++devId;
    await page.evaluate(([js, id]) => { window.__dev = null; Net.send({ t: 'dev', js, id }); }, [js, id]);
    await page.waitForFunction(id => window.__dev && window.__dev.id === id, id, { timeout: 8000 });
    return page.evaluate(() => window.__dev.r);
  };
  const key = async (p, k, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(k); await p.waitForTimeout(60); } };
  const toMenu = async (p, name) => {
    await key(p, 'ArrowDown'); await key(p, 'Enter');
    await p.keyboard.type(name); await key(p, 'Enter');
  };

  // A: ONLINE -> CREATE A MATCH -> versus, public -> CREATE
  const A = await mkPage();
  await toMenu(A, 'Alpha');
  await key(A, 'ArrowDown'); await key(A, 'Enter');    // CREATE A MATCH
  check('CREATE A MATCH opens its options', await A.evaluate(() => G.state === 'netcreate'));
  await key(A, 'ArrowRight');                           // MODE: VERSUS
  await key(A, 'ArrowDown');                            // (LENGTH: FULL, as it is)
  await key(A, 'ArrowDown'); await key(A, 'ArrowRight'); // VISIBILITY: PUBLIC
  await key(A, 'ArrowDown');
  await A.screenshot({ path: 'test/shot-vs-create.png' });
  await key(A, 'Enter');                                 // CREATE
  await A.waitForFunction(() => G.state === 'lobby' && Net.code, null, { timeout: 6000 });
  const la = await A.evaluate(() => ({ mode: Net.mode, f: Net.faction, pub: Net.pub, code: Net.code }));
  check('a versus match is created (public), the host on black', la.mode === 'versus' && la.f === 'black' && la.pub, la);
  // the start rule: not with one side empty
  // (the page doesn't even ask: the 'a player on each side' note flashes red)
  await key(A, 'Enter');
  await A.waitForTimeout(300);
  check('the host cannot start with nobody on red', await A.evaluate(() => G.state === 'lobby' && G.sidesWarnT > G.frame &&
    Net.roomState === 'lobby'));
  await A.screenshot({ path: 'test/shot-vs-sides.png' });

  // B joins by code: put on red (the smaller side)
  const B = await mkPage();
  await toMenu(B, 'Beta');
  await key(B, 'ArrowDown', 2); await key(B, 'Enter');  // JOIN WITH A CODE
  await B.keyboard.type(la.code); await key(B, 'Enter');
  await B.waitForFunction(() => G.state === 'lobby' && Net.players.length === 2, null, { timeout: 6000 });
  check('a joiner goes to the smaller side (red)', await B.evaluate(() => Net.faction === 'red' && Net.players[1].f === 'red'));
  // B switches to black and back: the host sees it
  await key(B, 'ArrowLeft');
  await A.waitForFunction(() => Net.players[1] && Net.players[1].f === 'black', null, { timeout: 3000 }).catch(() => {});
  const swapped = await A.evaluate(() => Net.players[1].f);
  await key(B, 'ArrowRight');
  await A.waitForFunction(() => Net.players[1] && Net.players[1].f === 'red', null, { timeout: 3000 }).catch(() => {});
  check('a player picks its side in the lobby (LEFT/RIGHT), the others see it', swapped === 'black' &&
    await A.evaluate(() => Net.players[1].f === 'red'));
  // C and D (raw): C to red, D tries red too (full: 2 a side)
  const C = bot(port, 'GAMMA'), D = bot(port, 'DELTA');
  await Promise.all([C.open, D.open]);
  for (const b of [C, D]) b.send({ t: 'hello', v: 1, name: b.name });
  await sleep(200);
  C.send({ t: 'join', code: la.code });
  await C.wait(m => m.t === 'lobby');
  C.send({ t: 'side', f: 'red' });
  await sleep(200);
  D.send({ t: 'join', code: la.code });
  await D.wait(m => m.t === 'lobby');
  D.send({ t: 'side', f: 'red' });
  const full = await D.wait(m => m.t === 'error' && m.key === 'e_sideFull');
  await sleep(300);
  const lob = await A.evaluate(() => Net.players.map(p => p.n + ':' + p.f));
  check('a side takes 2 at most (2v2)', full && lob.join() === 'ALPHA:black,BETA:red,GAMMA:red,DELTA:black', lob);
  await A.screenshot({ path: 'test/shot-vs-lobby.png' });

  // the match: 2 v 2
  await key(A, 'Enter');
  await A.waitForFunction(() => G.state === 'play' && Net.ready, null, { timeout: 20000 }).catch(async e => {
    console.log('A:', await A.evaluate(() => ({ s: G.state, err: Net.err, rs: Net.roomState, host: Net.host, you: Net.you })));
    console.log(srvLog.split('\n').slice(-15).join('\n'));
    throw e;
  });
  await B.waitForFunction(() => G.state === 'play' && Net.ready, null, { timeout: 20000 }).catch(async e => {
    console.log('B:', await B.evaluate(() => ({ s: G.state, err: Net.err, rs: Net.roomState, ready: Net.ready, inM: Net.inMatch,
      st: Net.status, snaps: Net.stats.snaps, tk: !!G.takeover, cols: G.colonies.length, caps: !!(G.colonies[0] && G.colonies[0].caps) })));
    console.log(errors.join('\n'));
    throw e;
  });
  await Promise.all([C.wait(m => m.t === 'world', 15000), D.wait(m => m.t === 'world', 15000)]);
  await sleep(1200);
  const sv = await dev(A, `({ mode: G.mode, cols: G.players.map(p => p.col), ants: G.players.map(p => p.ant && p.ant.colony.idx),
    castes: G.players.map(p => p.ant && p.ant.caste), pops: G.colonies.map(c => c.members().length),
    caps: G.colonies.map(c => JSON.stringify(c.caps)) })`);
  check('the match starts 2v2: each player plays a worker of its own colony, the colonies equal', sv.mode === 'versus' &&
    sv.cols.join() === '0,1,1,0' && sv.ants.join() === '0,1,1,0' && sv.castes.every(c => c === 'worker') &&
    sv.pops[0] === sv.pops[1] && sv.caps[0] === sv.caps[1], sv);
  const pa = await A.evaluate(() => ({ col: G.colIdx, mine: localAnt() && localAnt().colony.idx, colony: G.colony.idx, rival: G.rival.idx }));
  const pb = await B.evaluate(() => ({ col: G.colIdx, mine: localAnt() && localAnt().colony.idx, colony: G.colony.idx, rival: G.rival.idx,
    faction: G.colony.faction, hints: !!Tut.active(), gates: G.colonies.map(c => c.gates) }));
  check('each page sees through its own colony (G.colony / G.rival)', pa.col === 0 && pa.mine === 0 && pa.colony === 0 && pa.rival === 1 &&
    pb.col === 1 && pb.mine === 1 && pb.colony === 1 && pb.rival === 0 && pb.faction === 'red', { pa, pb });
  check('no hints in versus; the client knows the gate sides', !pb.hints && pb.gates.join() === '1,2', pb);
  await B.screenshot({ path: 'test/shot-vs-red.png' });

  // takeover: only within one's own colony, never the queen
  const optsB = await B.evaluate(() => takeoverOptions(LOCAL));
  const redFree = await dev(A, `(() => { const o = {}; for (const a of G.ants) if (a.colony.idx === 1 && a.playerIdx < 0 && a.hp > 0 && PLAYABLE(a.caste)) o[a.caste] = (o[a.caste] || 0) + 1; return o; })()`);
  check('the red player\'s switch overlay lists only red ants', optsB.length > 0 && optsB.every(t => redFree[t.caste] === t.count), { optsB, redFree });
  await key(B, 'KeyC');
  await key(B, 'ArrowDown');   // soldier
  await key(B, 'Enter');
  await B.waitForFunction(() => localAnt() && localAnt().caste === 'soldier', null, { timeout: 4000 }).catch(() => {});
  const tb = await dev(A, '({ caste: G.players[1].ant && G.players[1].ant.caste, col: G.players[1].ant && G.players[1].ant.colony.idx })');
  check('B switches to a soldier of its own (red) colony', tb.caste === 'soldier' && tb.col === 1, tb);
  C.send({ t: 'take', caste: 'queen' });
  await sleep(300);
  const tc = await dev(A, '({ caste: G.players[2].ant && G.players[2].ant.caste, queens: G.ants.filter(a => a.caste === "queen").map(a => a.playerIdx) })');
  check('nobody can play the queen', tc.caste === 'worker' && tc.queens.every(i => i < 0), tc);

  // each side's milestones, crystals and upgrades; the enemy's private numbers are never sent
  await dev(A, 'G.colonies[0].crystals = 7; G.colonies[1].crystals = 3; G.colonies[1].food = 99');
  await sleep(1300);
  const oa = await A.evaluate(() => ({ cr: G.colony.crystals, list: G.objectives.list.map(o => o.id + o.n).join(), enemyCr: G.rival.crystals }));
  const ob = await B.evaluate(() => ({ cr: G.colony.crystals, list: G.objectives.list.map(o => o.id + o.n).join(), enemyCr: G.rival.crystals }));
  const srvObj = await dev(A, 'G.colonies.map(c => c.objectives.list.map(o => o.id + o.n).join())');
  check('each side sees its own milestones and crystals (HUD, O screen)', oa.cr === 7 && ob.cr === 3 && oa.list === srvObj[0] && ob.list === srvObj[1] &&
    oa.list !== ob.list && /food1009\d/.test(ob.list), { oa, ob, srvObj });
  check('the enemy colony\'s crystals, milestones and tasks are not sent', !('o1' in D.view) && !('t1' in D.view) && !('o0' in C.view) &&
    !('t0' in C.view) && D.view.c1 && D.view.c1.crystals === undefined && D.view.c0.crystals === 7 && C.view.c0.crystals === undefined &&
    C.view.c1.crystals === 3 && oa.enemyCr === 0, { D: [...D.keys].sort().join(), C: [...C.keys].sort().join() });
  // a red purchase is red's
  B.evaluate(() => { G.players[LOCAL].input.buy = 'digging'; });
  await sleep(600);
  const up = await dev(A, 'G.colonies.map(c => c.upg.digging + "/" + c.crystals)');
  check('upgrades are bought for one\'s own colony', up.join() === '0/7,1/1', up);
  await key(B, 'o');
  await B.waitForTimeout(200);
  await B.screenshot({ path: 'test/shot-vs-objectives.png' });
  await key(B, 'Escape');

  // messages stay on their side
  C.events = []; D.events = [];
  await A.evaluate(() => { G.msgs = []; });
  await B.evaluate(() => { G.msgs = []; });
  await dev(A, `G.colonies[0].say('m_eggLaid'); G.colonies[1].say('m_nestFull'); G.colonies[1].sfx('task'); G.msg('m_siteFell')`);
  await sleep(700);
  const ea = await A.evaluate(() => G.msgs.map(m => m.text)), eb = await B.evaluate(() => G.msgs.map(m => m.text));
  const keysOf = b => b.events.filter(e => e[0] === 'm').map(e => e[1]);
  check('a colony\'s messages reach only its own players (a world event everyone)',
    keysOf(D).includes('m_eggLaid') && !keysOf(D).includes('m_nestFull') && keysOf(C).includes('m_nestFull') && !keysOf(C).includes('m_eggLaid') &&
    keysOf(C).includes('m_siteFell') && keysOf(D).includes('m_siteFell') &&
    C.events.some(e => e[0] === 's' && e[1] === 'task') && !D.events.some(e => e[0] === 's' && e[1] === 'task' && e[2] === null),
  { C: keysOf(C), D: keysOf(D) });
  check('...and on the pages', ea.some(t => t.includes('EGG')) && !eb.some(t => t.includes('EGG')), { ea, eb });

  // the enemy queen slain (no heir): the match ends for everyone, red wins
  await dev(A, `G.brood = G.brood.filter(b => !b.royal); G.ants = G.ants.filter(a => a.caste !== 'princess'); G.colonies[0].queen().hp = 0`);
  await A.waitForFunction(() => G.state === 'gameover', null, { timeout: 5000 }).catch(() => {});
  await B.waitForFunction(() => G.state === 'gameover', null, { timeout: 5000 }).catch(() => {});
  const overC = await C.wait(m => m.t === 'over', 5000), overD = await D.wait(m => m.t === 'over', 5000);
  const ga = await A.evaluate(() => ({ s: G.state, w: G.gameOverStats && G.gameOverStats.winner, r: G.gameOverStats && G.gameOverStats.reason, sides: G.gameOverStats && G.gameOverStats.sides.length }));
  const gb = await B.evaluate(() => ({ s: G.state, w: G.gameOverStats && G.gameOverStats.winner }));
  check('the black queen slain with no heir: the match ends for all four, red wins', ga.s === 'gameover' && gb.s === 'gameover' &&
    ga.w === 1 && gb.w === 1 && ga.r === 'r_vsQueen' && ga.sides === 2 && overC && overD && overC.over.winner === 1, { ga, gb });
  await A.screenshot({ path: 'test/shot-vs-defeat.png' });
  await B.screenshot({ path: 'test/shot-vs-victory.png' });
  await key(B, 'Enter');
  await B.waitForTimeout(300);
  check('the end screen goes back to the title', await B.evaluate(() => G.state === 'title' && !G.online && G.colIdx === 0));

  check('no crash, nothing uncaught', !/CRASHED|uncaught/.test(srvLog));
  console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
  if (fails.length) console.log('--- server log ---\n' + srvLog.split('\n').slice(-25).join('\n'));
  await browser.close();
  srv.kill();
  for (const b of [C, D]) b.ws.close();
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* leave it */ }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  process.exit(errors.length || fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
