// Eight-player probe: rooms of 8 and the balance by player count. First the
// sim alone (plain Node, a vm per world): one player keeps the old numbers
// (caps from the chambers, the milestones, the red household and raids),
// eight get room to grow (the queen lays at the start), bigger milestones,
// a bigger red rival; spawn spots on open ground; the count only rising
// (notePlayers); saves keeping it (v8) and older saves migrated; a fresh
// worker for a player with no free ant to take. Then the server as a child
// process with raw clients: 8 in a co-op room (distinct ants and colours),
// the 9th turned away, versus 8v8 (a 9th on a side refused), a mid-match
// joiner getting a fresh worker, a persistent world balanced for a moving
// average of the players in it. Last, a browser page: the lobby with 8 players
// (co-op) and 16 (versus), and play with several name tags, as screenshots.
//   node test/eightprobe.js [--no-browser]
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

// a world's numbers: caps (and what the chambers alone give), households,
// every season's milestone targets this year and next
const NUMBERS = `(() => {
  const raw = c => {
    const sum = { storage: 0, nursery: 0, barracks: 0, royal: 0 };
    for (const ch of c.chambers) if (ch.area >= CH_MIN_AREA && ch.type in sum) sum[ch.type] += ch.area;
    return { food: Math.max(40, Math.round(20 + sum.storage * 0.1)), brood: 1 + Math.floor(sum.nursery / 200),
      pop: Math.max(10, Math.floor((sum.nursery + sum.barracks) / 75)),
      eggT: Math.round(2700 * Math.max(0.5, Math.min(2.5, 1550 / Math.max(1, sum.royal)))) };
  };
  const house = c => { const n = {}; for (const a of c.members()) n[a.caste] = (n[a.caste] || 0) + 1; return n; };
  const needs = y => [0, 1, 2, 3].map(s => Object.fromEntries(newObjectives(y, s, 0).list.map(o => [o.id, o.need])));
  return { slots: playerSlots(), caps: G.colonies.map(c => c.caps), raw: G.colonies.map(raw), house: G.colonies.map(house),
    brood: G.colonies.map(c => c.broodCount()), needs: [needs(1), needs(2)] };
})()`;

function simChecks() {
  // ---- one player: the old numbers -------------------------------------------
  const BASE = [[{ storage2: 2, raise: 5, food100: 100 }, { mound: 250, pop25: 25, contested: 8 },
    { stockpile: 150, royal: 1800, princess: 1 }, { queen: 1, sealed: 45, centipedes: 3 }],
  [{ storage2: 3, raise: 5, food100: 150 }, { mound: 400, pop25: 35, contested: 12 },
    { stockpile: 200, royal: 2400, princess: 1 }, { queen: 1, sealed: 45, centipedes: 3 }]];
  const one = [];
  for (const seed of [3, 17, 29]) {
    const run = simCtx(seed);
    run(`newWorld(${seed * 7919}, 1, 'coop')`);
    one.push(run.json(NUMBERS));
  }
  const capsOk = n => n.caps.every((c, i) => c.food === n.raw[i].food && c.pop === n.raw[i].pop && c.brood === n.raw[i].brood && c.eggT === n.raw[i].eggT);
  check('1 player: the caps are the chambers\' alone (both colonies)', one.every(n => n.slots === 1 && capsOk(n)),
    one.map(n => [n.caps[0].pop, n.raw[0].pop, n.caps[1].pop, n.raw[1].pop]));
  check('1 player: the milestones as before (this year and next)', one.every(n => JSON.stringify(n.needs) === JSON.stringify(BASE)), one[0].needs);
  check('1 player: the red household as before (6 workers, 3 soldiers)', one.every(n => n.house[1].worker === 6 && n.house[1].soldier === 3 &&
    n.house[0].worker === 8 && n.house[0].soldier === 2), one.map(n => n.house));

  // ---- eight players: room, bigger targets, a bigger rival --------------------
  const eight = [];
  for (const seed of [3, 17, 29]) {
    const run = simCtx(seed);
    run(`newWorld(${seed * 7919}, 8, 'coop')`);
    const n = run.json(NUMBERS);
    n.spawn = run.json(`(() => {
      const ps = G.players.map(p => p.ant);
      const ground = a => { for (let d = 1; d <= 40; d++) if (T.boxSolid(a.x, a.y + d, a.hw, a.hh)) return true; return false; };
      return { n: ps.length, ids: new Set(ps.map(a => a.id)).size, idx: ps.map(a => a.playerIdx).join(), xsN: new Set(ps.map(a => a.x)).size,
        clear: ps.every(a => !T.boxSolid(a.x, a.y, a.hw, a.hh)), ground: ps.every(ground),
        spread: Math.max(...ps.map(a => a.x)) - Math.min(...ps.map(a => a.x)), e: G.colony.entrance.x,
        xs: ps.map(a => Math.round(a.x - G.colony.entrance.x)) };
    })()`);
    // the first egg comes (the queen isn't held back by the room)
    n.lay = run.json(`(() => { const c = G.colony, room = c.members().length + c.broodCount() < c.caps.pop;
      for (let i = 0; i < 4000 && !c.stats.eggsLaid; i++) { stepSim(); G.events.length = 0; }
      return { room, eggs: c.stats.eggsLaid, tick: G.tick }; })()`);
    eight.push(n);
  }
  check('8 players: 8 ants, distinct, side by side on open ground near the entrance', eight.every(n => n.spawn.n === 8 && n.spawn.ids === 8 &&
    n.spawn.idx === '0,1,2,3,4,5,6,7' && n.spawn.xsN === 8 && n.spawn.clear && n.spawn.ground && n.spawn.spread <= 100), eight.map(n => n.spawn.xs));
  check('8 players: room to grow -- pop cap +11, food cap +70, and the queen lays at the start', eight.every((n, i) =>
    n.caps[0].pop === one[i].caps[0].pop + 11 && n.caps[0].food === one[i].caps[0].food + 70 && n.lay.room && n.lay.eggs > 0),
  eight.map(n => [n.caps[0].pop, n.house[0], n.brood[0], n.lay]));
  const T8 = { raise: 10, food100: 205, mound: 513, pop25: 39, contested: 16, stockpile: 308, centipedes: 6,
    storage2: 2, royal: 1800, princess: 1, queen: 1, sealed: 45 };
  const flat = n => Object.assign({}, ...n.needs[0]);
  check('8 players: milestone targets x2.05 (pop25 +2 a player), the rest as they were', eight.every(n =>
    Object.keys(T8).every(k => flat(n)[k] === T8[k])), flat(eight[0]));
  check('8 players: next year\'s targets keep growing with the year', eight.every(n => n.needs[1][0].food100 === 308 && n.needs[1][1].pop25 === 49 &&
    n.needs[1][1].mound === 820), eight[0].needs[1]);
  check('8 players: a red rival to match -- 10 workers, 5 soldiers, its caps x1.7 (its queen lays at her old pace)', eight.every(n =>
    n.house[1].worker === 10 && n.house[1].soldier === 5 && n.caps[1].pop === Math.floor(n.raw[1].pop * 1.7) &&
    n.caps[1].food === Math.round(n.raw[1].food * 1.7) && n.caps[1].eggT === n.raw[1].eggT), eight.map(n => [n.caps[1], n.house[1]]));
  check('8 players: the black colony\'s household is the same as solo', eight.every((n, i) => n.house[0].worker === one[i].house[0].worker + 7 &&
    n.house[0].soldier === one[i].house[0].soldier && n.house[0].nurse === one[i].house[0].nurse));

  // raids: the party's size cap grows with the players (10 -> 17)
  const raid = [1, 8].map(k => {
    const run = simCtx(5);
    run(`newWorld(${5 * 7919}, ${k}, 'coop')`);
    return run(`G.rival.startRaid(G.colony, 99, 100)`);
  });
  check('raids: at most 10 raiders against 1 player, more against 8', raid[0] <= 10 && raid[0] >= 3 && raid[1] > 10, raid);
  // versus: the same rules for both sides
  const vs = simCtx(9);
  vs(`newWorld(${9 * 7919}, 0, 'versus', 4)`);
  const vn = vs.json(NUMBERS);
  check('versus 4v4: both sides alike (caps, household, milestones), no AI scaling', vn.slots === 4 &&
    JSON.stringify(vn.caps[0]) === JSON.stringify(vn.caps[1]) && JSON.stringify(vn.house[0]) === JSON.stringify(vn.house[1]) &&
    vn.caps[0].pop === vn.raw[0].pop + 5 && vs(`G.colonies[1].objectives.list[1].need`) === 7, { caps: vn.caps, house: vn.house });

  // ---- a match's count only rises; saves keep it ----------------------------------
  const run = simCtx(13);
  run(`newWorld(${13 * 7919}, 0, 'coop')`);
  const w0 = run.json(`[playerSlots(), G.objectives.list.find(o => o.id === 'raise').need]`);
  const up = run(`notePlayers(5)`);
  const w1 = run.json(`[playerSlots(), G.objectives.list.find(o => o.id === 'raise').need, G.objectives.list.find(o => o.id === 'storage2').need]`);
  const down = run(`notePlayers(3)`);
  const w2 = run(`playerSlots()`);
  check('a match: balanced for 1, raised to 5 (open milestones grow), never lowered', w0[0] === 1 && w0[1] === 5 && up === true &&
    w1[0] === 5 && w1[1] === 8 && w1[2] === 2 && down === false && w2 === 5, { w0, w1, w2 });
  const rt = run.json(`(() => {
    const d = serializeWorld();
    const ok = restoreWorld(JSON.parse(JSON.stringify(d)), 0);
    const after = playerSlots();
    const old = JSON.parse(JSON.stringify(d)); old.v = 7; delete old.slots; old.playerCount = 3;
    restoreWorld(old, 0);
    const v7 = playerSlots();
    const older = JSON.parse(JSON.stringify(d)); older.v = 6; delete older.slots; delete older.playerCount;
    restoreWorld(older, 0);
    const v6 = playerSlots();
    const huge = JSON.parse(JSON.stringify(d)); huge.slots = 99;
    restoreWorld(huge, 0);
    return { v: d.v, slots: d.slots, ok, after, v7, v6, huge: playerSlots(), need: G.objectives.list.find(o => o.id === 'raise').need };
  })()`);
  check('saves: v8 keeps the count; a v7 save gets its player count, an older one 1; never past 8', rt.v === 8 && rt.slots === 5 && rt.ok &&
    rt.after === 5 && rt.v7 === 3 && rt.v6 === 1 && rt.huge === 8, rt);

  // ---- a fresh worker when no ant is free -------------------------------------
  const fr = simCtx(21);
  fr(`newWorld(${21 * 7919}, 2, 'coop')`);
  const f = fr.json(`(() => {
    // every free ant of the colony gone (all taken, or none of a playable caste)
    for (const a of G.ants) if (a.colony === G.colony && a.playerIdx < 0 && PLAYABLE(a.caste)) a.hp = 0;
    stepSim(); G.events.length = 0;
    const n0 = G.ants.length;
    ensurePlayer(2);
    const opts = takeoverOptions(2);
    const e = G.colony.entrance;
    const a = takeOver(2, 'worker', e.x, e.y);
    const live = takeoverOptions(0);   // (player 0 still has its ant: no fresh one for a switch)
    // player 0's ant dies: a fresh one for it too
    G.players[0].ant.hp = 0; stepSim(); G.events.length = 0;
    const dead = takeoverOptions(0);
    const b = takeOver(0, 'worker', e.x, e.y);
    return { opts, got: !!a, idx: a && a.playerIdx, col: a && a.colony === G.colony, near: a && Math.abs(a.x - e.x) < 60 && Math.abs(a.y - e.y) < 40,
      clear: a && !T.boxSolid(a.x, a.y, a.hw, a.hh), more: G.ants.length > n0, live, dead, b: !!b && b.playerIdx === 0 && b !== a };
  })()`);
  check('no free ant: a newcomer is offered A NEW WORKER and gets one at the entrance, on open ground', f.opts.length === 1 && f.opts[0].fresh &&
    f.got && f.idx === 2 && f.col && f.near && f.clear && f.more, f);
  check('...never for a live switch (TAB); after a death, yes', f.live.length === 0 && f.dead.length === 1 && f.dead[0].fresh && f.b, f);
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

// a raw protocol client: its messages, its view of the players, dev hooks
function bot(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = { ws, name, msgs: [], you: -1, p: null, devR: null, closed: false };
  ws.on('message', d => {
    let m;
    try { m = JSON.parse(d.toString()); } catch (e) { return; }
    if (m.t === 's') { if (m.v && m.v.p) b.p = m.v.p; return; }
    if (m.t === 'dev') { b.devR = m; return; }
    if (m.t === 'lobby') b.you = m.you;
    b.msgs.push(m);
  });
  ws.on('close', () => { b.closed = true; });
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
  b.myAnt = () => b.p && b.p[b.you] ? b.p[b.you].a : 0;
  return b;
}
const bots = async (port, names) => {
  const bs = names.map(n => bot(port, n));
  await Promise.all(bs.map(b => b.hello()));
  return bs;
};

async function online() {
  const port = await freePort();
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'maur-eight-'));
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', MAUR_DEV: '1', PERSIST_WORLDS: 'MAURTUA',
      DATA_DIR: DATA, MAX_ROOMS: '8', CPU_BUDGET_MS: '1000', MAX_PLAYERS: '', RECONNECT_MS: '8000', ROOM_IDLE_MS: '1000' }),
  });
  let srvLog = '';
  srv.stdout.on('data', d => { srvLog += d; });
  srv.stderr.on('data', d => { srvLog += d; });
  let health = null;
  for (let i = 0; i < 50 && !health; i++) { await sleep(100); try { health = await getJson(port, '/api/health'); } catch (e) { /* not yet */ } }
  const all = [];
  try {
    // ---- the room browser: rooms of 8 ------------------------------------------
    const [L] = await bots(port, ['LISTER']);
    all.push(L);
    const wel = L.msgs.find(m => m.t === 'welcome');
    L.send({ t: 'list' });
    const ls = await L.wait(m => m.t === 'list');
    check('the server takes 8 a room by default; the world list says x/8', wel && wel.max === 8 && ls && ls.worlds[0].max === 8, { wel, w: ls && ls.worlds });

    // ---- co-op: 8 players, the 9th turned away --------------------------------
    const C = await bots(port, ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE']);
    all.push(...C);
    C[0].send({ t: 'create', mode: 'coop', pub: true });
    const lob = await C[0].wait(m => m.t === 'lobby');
    for (const b of C.slice(1, 8)) { b.send({ t: 'join', code: lob.code }); await b.wait(m => m.t === 'lobby'); }
    L.msgs = [];
    L.send({ t: 'list' });
    const ls2 = await L.wait(m => m.t === 'list');
    const om = ls2 && ls2.matches.find(m => m.code === lob.code);
    C[8].send({ t: 'join', code: lob.code });
    const full = await C[8].wait(m => m.t === 'error' && m.key === 'e_full');
    check('a co-op room takes 8 (each its own index) and turns the 9th away; a full room is no longer an open match', !!full &&
      C.slice(0, 8).map(b => b.you).join() === '0,1,2,3,4,5,6,7' && !om, { you: C.map(b => b.you), om });
    C[0].send({ t: 'start' });
    await Promise.all(C.slice(0, 8).map(b => b.wait(m => m.t === 'world', 20000)));
    for (let i = 0; i < 100 && !C.slice(0, 8).every(b => b.myAnt()); i++) await sleep(50);
    const ids = C.slice(0, 8).map(b => b.myAnt());
    const sv = await C[0].dev(`({ slots: playerSlots(), n: G.players.length,
      ants: G.players.map(p => p.ant && p.ant.colony === G.colony && p.ant.playerIdx), colors: PLAYER_COLORS.slice(),
      pop: G.colony.members().length, brood: G.colony.broodCount(), cap: G.colony.caps.pop,
      raise: G.objectives.list.find(o => o.id === 'raise').need, red: G.rival.members().length })`);
    check('8 players start a co-op match: 8 distinct ants, each its own', ids.every(Boolean) && new Set(ids).size === 8 &&
      sv && sv.ants.join() === '0,1,2,3,4,5,6,7', { ids, ants: sv && sv.ants });
    check('8 colours, all different', sv && sv.colors.length === 8 && new Set(sv.colors.map(c => c.toLowerCase())).size === 8, sv && sv.colors);
    check('the match is balanced for 8: room for the queen to lay, the milestones and red scaled', sv && sv.slots === 8 &&
      sv.pop + sv.brood < sv.cap && sv.raise === 10 && sv.red >= 16, sv);
    for (const b of C) b.ws.close();

    // ---- versus 8v8 ----------------------------------------------------------------
    const V = await bots(port, Array.from({ length: 17 }, (_, i) => 'V' + (i + 1)));
    all.push(...V);
    V[0].send({ t: 'create', mode: 'versus' });
    const vl = await V[0].wait(m => m.t === 'lobby');
    for (const b of V.slice(1, 15)) { b.send({ t: 'join', code: vl.code }); await b.wait(m => m.t === 'lobby'); }
    await sleep(200);
    const lastLobby = () => { const ms = V[0].msgs.filter(m => m.t === 'lobby'); return ms[ms.length - 1]; };
    const sides = () => lastLobby().players.filter(Boolean).map(p => p.f);
    const s15 = sides();
    // a red player tries black, where 8 already are
    const redBot = V.slice(1, 15).find(b => { const ms = b.msgs.filter(m => m.t === 'lobby'); return ms[ms.length - 1].faction === 'red'; });
    redBot.send({ t: 'side', f: 'black' });
    const sf = await redBot.wait(m => m.t === 'error' && m.key === 'e_sideFull');
    V[15].send({ t: 'join', code: vl.code });
    await V[15].wait(m => m.t === 'lobby');
    V[16].send({ t: 'join', code: vl.code });
    const vfull = await V[16].wait(m => m.t === 'error' && m.key === 'e_full');
    await sleep(200);
    const s16 = sides();
    const vlob = lastLobby();
    const hues = f => vlob.players.filter(p => p && p.f === f).map(p => p.h);
    check('versus: 15 players split 8 black, 7 red; a 9th on black is refused; the 16th goes red (8v8), the 17th is turned away',
      vlob.max === 16 && s15.filter(f => f === 'black').length === 8 && s15.filter(f => f === 'red').length === 7 && !!sf && !!vfull &&
      s16.filter(f => f === 'black').length === 8 && s16.filter(f => f === 'red').length === 8, { s15, s16, max: vlob.max });
    check('versus 8v8: 8 different colours on each side', new Set(hues('black')).size === 8 && new Set(hues('red')).size === 8 &&
      hues('black').concat(hues('red')).every(h => h >= 0 && h < 8), { black: hues('black'), red: hues('red') });
    V[0].send({ t: 'start' });
    await Promise.all(V.slice(0, 16).map(b => b.wait(m => m.t === 'world', 20000)));
    for (let i = 0; i < 100 && !V.slice(0, 16).every(b => b.myAnt()); i++) await sleep(50);
    const vsv = await V[0].dev(`({ slots: playerSlots(), cols: G.players.map(p => p.col), mine: G.players.every(p => p.ant && p.ant.colony === G.colonies[p.col]),
      pops: G.colonies.map(c => c.members().length), caps: G.colonies.map(c => c.caps.pop),
      free: G.colonies.map(c => G.ants.filter(a => a.hp > 0 && a.colony === c && a.playerIdx < 0 && a.caste === 'worker').length) })`);
    check('versus 8v8 starts: every player plays an ant of its own side, both sides alike, balanced for 8, NPC workers left on each side',
      vsv && vsv.slots === 8 && vsv.cols.filter(c => c === 0).length === 8 && vsv.cols.filter(c => c === 1).length === 8 && vsv.mine &&
      vsv.pops[0] === vsv.pops[1] && vsv.caps[0] === vsv.caps[1] && vsv.free[0] >= 5 && vsv.free[0] === vsv.free[1] &&
      new Set(V.slice(0, 16).map(b => b.myAnt())).size === 16, vsv);
    // (the snapshots carry each player's colour)
    const vh = await V[0].dev(`G.players.length`);
    check('versus 8v8: 16 players in the match', vh === 16, vh);
    for (const b of V) b.ws.close();

    // ---- a mid-match joiner with no free ant: a fresh worker ---------------------
    const M = await bots(port, ['M1', 'M2', 'M3']);
    all.push(...M);
    M[0].send({ t: 'create', mode: 'coop' });
    const ml = await M[0].wait(m => m.t === 'lobby');
    M[1].send({ t: 'join', code: ml.code });
    await M[1].wait(m => m.t === 'lobby');
    M[0].send({ t: 'start' });
    await M[0].wait(m => m.t === 'world', 20000);
    for (let i = 0; i < 100 && !M[0].myAnt(); i++) await sleep(50);
    // (no ant left free: every one of the colony's workers, soldiers and nurses but the players' is gone)
    await M[0].dev(`for (const a of G.ants) if (a.colony === G.colony && a.playerIdx < 0 && PLAYABLE(a.caste)) a.hp = 0`);
    await sleep(300);
    const before = await M[0].dev(`({ free: takeoverOptions(0).filter(o => !o.fresh).length, n: G.colony.members().length })`);
    M[2].send({ t: 'join', code: ml.code });
    await M[2].wait(m => m.t === 'world', 20000);
    for (let i = 0; i < 40 && !M[2].p; i++) await sleep(50);
    const noAnt = M[2].myAnt() === 0;
    M[2].send({ t: 'take', caste: 'worker' });
    for (let i = 0; i < 60 && !M[2].myAnt(); i++) await sleep(50);
    const got = await M[0].dev(`(() => { const a = G.players[2].ant, e = G.colony.entrance;
      return a && { caste: a.caste, black: a.colony === G.colony, dx: Math.round(a.x - e.x), dy: Math.round(a.y - e.y),
        n: G.colony.members().length, slots: playerSlots() }; })()`);
    check('a mid-match joiner with no free ant to take gets a fresh worker at the entrance', before && before.free === 0 && noAnt &&
      M[2].myAnt() > 0 && got && got.caste === 'worker' && got.black && Math.abs(got.dx) < 60 && got.n === before.n + 1 && got.slots === 3,
    { before, got });
    for (const b of M) b.ws.close();

    // ---- a persistent world: balanced for a moving average of the players in it ----
    const W = await bots(port, ['W1', 'W2', 'W3']);
    all.push(...W);
    W[0].send({ t: 'enter', name: 'MAURTUA' });
    await W[0].wait(m => m.t === 'world', 20000);
    const w1 = await W[0].dev('playerSlots()');
    W[1].send({ t: 'enter', name: 'MAURTUA' });
    W[2].send({ t: 'enter', name: 'MAURTUA' });
    await Promise.all(W.slice(1).map(b => b.wait(m => m.t === 'world', 20000)));
    // (followPlayers runs every in-game hour; here a few hours or days of them at once)
    const hours = n => W[0].dev(`(() => { for (let i = 0; i < ${n}; i++) followPlayers();
      return { s: playerSlots(), avg: +G.playerAvg.toFixed(2), present: G.present }; })()`);
    // (the average as it was when they came: the server's clock moves it meanwhile)
    const w3 = await W[0].dev('({ s: playerSlots(), present: G.present, avg: (G.playerAvg = 1) })');
    const brief = await hours(6);           // a quarter of a day with 3
    const long = await hours(66);           // three days with 3
    const raised = await W[0].dev(`G.colony.objectives.list.find(o => o.id === 'raise').need`);
    W[1].send({ t: 'leave' }); W[2].send({ t: 'leave' });
    await sleep(300);
    const left = await W[0].dev('({ s: playerSlots(), present: G.present })');
    const after = await hours(72);          // three days alone again
    const saved = await W[0].dev('(() => { const d = serializeWorld(); return { slots: d.slots, avg: +d.avg.toFixed(2) }; })()');
    const lowered = await W[0].dev(`G.colony.objectives.list.find(o => o.id === 'raise').need`);
    check('a persistent world: 3 players join a 1-player world -> still 1 at first, 1 after a brief while, 3 after days',
      w1 === 1 && w3.s === 1 && w3.present === 3 && brief.s === 1 && long.s === 3, { w1, w3, brief, long });
    check('... two leave -> 3 until the average falls, then 1 again (milestones follow; saved)',
      left.s === 3 && left.present === 1 && after.s === 1 && saved.slots === 1 && saved.avg < 1.5 && lowered < raised,
      { left, after, saved, raised, lowered });
    for (const b of W) b.ws.close();
    L.ws.close();

    if (!NO_BROWSER) await screens(port);
  } finally {
    for (const b of all) try { b.ws.close(); } catch (e) { /* gone */ }
    check('no crash on the server', !srvLog.includes('CRASHED') && !srvLog.includes('uncaught'), srvLog.split('\n').filter(l => /CRASH|uncaught/.test(l)).slice(0, 3).join(' | '));
    srv.kill();
  }
}

// ---------------------------------------------------------------------------
// a browser page: the lobby with 8, versus 4v4, name tags in play
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
  const key = async k => { await page.keyboard.press(k); await page.waitForTimeout(70); };
  const NAMES = ['BRAVOBRAVO12', 'CHARLIE', 'DELTA', 'ECHOECHO', 'FOXTROT', 'GOLFGOLFGOLF', 'HOTEL'];
  const NAMES16 = NAMES.concat(['INDIA', 'JULIETTJULIE', 'KILO', 'LIMA', 'MIKEMIKE', 'NOVEMBER', 'OSCAR', 'PAPA']);
  const others = [];
  try {
    // title -> ONLINE -> name -> CREATE (co-op) -> the lobby
    await key('ArrowDown'); await key('Enter');
    await page.keyboard.type('Alpha'); await key('Enter');
    await key('ArrowDown'); await key('Enter');      // CREATE A MATCH
    await key('ArrowDown'); await key('ArrowDown'); await key('Enter');   // (co-op, private) GO
    await page.waitForFunction(() => G.state === 'lobby' && Net.code, null, { timeout: 8000 });
    const code = await page.evaluate(() => Net.code);
    for (const n of NAMES) {
      const [b] = await bots(port, [n]);
      b.send({ t: 'join', code });
      await b.wait(m => m.t === 'lobby');
      others.push(b);
    }
    await page.waitForFunction(() => Net.players.filter(Boolean).length === 8, null, { timeout: 5000 }).catch(() => {});
    // one of them drops out: dimmed, tagged
    others[5].ws.close();
    await page.waitForFunction(() => Net.players[6] && !Net.players[6].on, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);
    const lp = await page.evaluate(() => lobbyPlaces().map(p => [p.i, p.x, p.y]));
    check('the lobby lays 8 players out in two columns of four', lp.length === 8 && lp.slice(0, 4).every(p => p[1] === 10) &&
      lp.slice(4).every(p => p[1] === 166) && lp.map(p => p[2]).join() === '104,114,124,134,104,114,124,134', lp);
    await page.screenshot({ path: 'test/shot-8-lobby.png' });
    // the match: the others' ants gathered around ours, their tags
    others.splice(5, 1);
    await key('Enter');
    await page.waitForFunction(() => G.state === 'play' && Net.ready, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    if (await page.evaluate(() => !!G.takeover)) await key('Enter');   // (the dropped-out player's ant aside, we have ours)
    await page.evaluate(() => { window.__dev = null; Net.send({ t: 'dev', id: 7, js: `(() => {
      const me = G.players[0].ant, xs = [-60, -35, -12, 14, 40, 66, 90];
      let k = 0;
      for (let i = 1; i < G.players.length; i++) {
        const a = G.players[i].ant;
        if (!a) continue;
        a.x = me.x + xs[k % xs.length]; a.y = T.surf[Math.round(a.x)] - a.hh - 2; a.vx = a.vy = 0; k++;
      }
      return k; })()` }); });
    await page.waitForTimeout(1500);
    // (the tags as drawNameTags lays them out: how many, and none over another)
    const tagRects = () => page.evaluate(() => {
      const v = playerView(), n0 = Labels.rects.length;
      drawNameTags(Math.round(G.cam.x), Math.round(G.cam.y), v.vw, v.vh);
      const rs = Labels.rects.splice(n0);
      const over = rs.some((r, i) => rs.some((o, j) => j !== i && r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h));
      return { others: G.players.filter((p, i) => i !== LOCAL && p.ant && p.name).length, tags: rs.length, over };
    });
    const tags = await tagRects();
    await page.screenshot({ path: 'test/shot-8-tags.png' });
    // all of them in one heap: tags that would overlap are left out
    await page.evaluate(() => { Net.send({ t: 'dev', id: 8, js: `(() => {
      const me = G.players[0].ant;
      for (let i = 1; i < G.players.length; i++) { const a = G.players[i].ant; if (a) { a.x = me.x + 6 + (i % 3) * 3; a.y = T.surf[Math.round(a.x)] - a.hh - 2; } }
      return 1; })()` }); });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test/shot-8-crowd.png' });
    const crowd = await tagRects();
    check('name tags: 6 others spread around us mostly tagged (they walk about); in a heap only the ones with room; never one over another',
      tags.others >= 6 && tags.tags >= 4 && !tags.over && crowd.tags >= 1 && crowd.tags < crowd.others && !crowd.over, { tags, crowd });
    for (const b of others) b.ws.close();
    await page.evaluate(() => { leaveOnline('title'); G.menuSel = 0; });
    await page.waitForTimeout(300);

    // versus: 8v8 in the lobby (the compact layout)
    await key('ArrowDown'); await key('Enter');
    await key('Enter');                               // (the name remembered)
    await key('ArrowDown'); await key('Enter');      // CREATE A MATCH
    await key('ArrowRight');                          // versus
    await key('ArrowDown'); await key('ArrowDown'); await key('Enter');
    await page.waitForFunction(() => G.state === 'lobby' && Net.code && Net.mode === 'versus', null, { timeout: 8000 });
    const vcode = await page.evaluate(() => Net.code);
    const vb = [];
    for (const n of NAMES16) {
      const [b] = await bots(port, [n]);
      b.send({ t: 'join', code: vcode });
      await b.wait(m => m.t === 'lobby');
      vb.push(b);
    }
    await page.waitForFunction(() => Net.players.filter(Boolean).length === 16, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);
    const vp = await page.evaluate(() => lobbyPlaces().map(p => [p.pl.f, p.x, p.y]));
    check('the versus lobby: black on the left, red on the right, 8 each, all clear of the notes below (y < 146)', vp.length === 16 &&
      vp.every(p => (p[0] === 'red') === (p[1] === 166)) && vp.filter(p => p[0] === 'red').length === 8 &&
      Math.max(...vp.map(p => p[2])) + 7 < 146 && new Set(vp.map(p => p[1] + ',' + p[2])).size === 16, vp);
    await page.screenshot({ path: 'test/shot-8-vs-lobby.png' });
    for (const b of vb) b.ws.close();
    // Norwegian: the same lobby's strings have their glyphs (langprobe checks every string)
  } finally {
    for (const b of others) try { b.ws.close(); } catch (e) { /* gone */ }
    check('no page errors', !errors.length, errors.slice(0, 5));
    await browser.close();
  }
}

(async () => {
  simChecks();
  await online();
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
