// Blueprint probe: plan mode, F filling the plan, the colony's stocks and
// its NPC builders, the plan online and in saves. First the sim alone (plain
// Node, a seeded vm per world): the plan input braces the ant, the cursor is
// held to its reach, the brush marks only open air (strokes without gaps),
// erases, takes the selected material and stops at the cap; F fills planned
// pixels in reach (only those, from the load, the held direction first,
// never walling an ant in) and falls back to the aimed stamp; spoil
// overflowing a full load and a load unloaded at the storage feed the
// stocks; idle workers build a plan in the nest over several seeds (and stop
// when the stock runs dry), never stuck in the errand; v9 saves keep plan
// and stocks, older ones load with none. Then the server as a child process
// (raw clients and a page): co-op players all see one plan (from the world
// message and the snapshots' small deltas; a page's plan mode paints it), a
// latecomer gets it whole, versus sides only ever get their own. Then a page
// offline: B, the cursor and its reach, Space and X, Esc (leaves plan mode
// before it pauses), the F preview, and screenshots test/shot-plan-*.png.
//   node test/planprobe.js [--no-net] [--no-browser]
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
const NO_NET = process.argv.includes('--no-net');
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
  // helpers in the sim's scope (as buildprobe has them in the page)
  run(`
    var H = {};
    H.simN = (n, held) => {
      const p = G.players[0];
      for (let i = 0; i < n; i++) { Object.assign(p.input, held || {}); stepSim(); }
      p.input = newInput();
    };
    // a block of dirt with an air ellipse dug out of it
    H.room = (cx, cy, rx, ry) => {
      for (let y = cy - ry - 14; y <= cy + ry + 14; y++) for (let x = cx - rx - 14; x <= cx + rx + 14; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        T.m[y * WORLD_W + x] = dx * dx + dy * dy <= 1 ? M_AIR : M_DIRT;
        T.wear.delete(y * WORLD_W + x);
      }
      for (const c of G.colonies) c.plan.clear();
    };
    H.stand = (x, y, dir) => {
      const a = G.players[0].ant;
      a.x = x; a.y = y + 6; a.vx = a.vy = 0; a.dir = dir || 1; a.climbing = a.ceiling = false; a.carry = null;
      H.simN(30);
      a.dir = dir || 1;
      return a;
    };
    H.planned = c => [...c.plan.keys()].map(i => ({ x: i % WORLD_W, y: (i / WORLD_W) | 0, v: c.plan.get(i), i }));
    // plan a rect of open air (as a painted plan would be)
    H.planRect = (c, x0, y0, x1, y1, mat) => {
      let n = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * WORLD_W + x;
        if (T.m[i] === M_AIR && c.planSet(i, mat)) n++;
      }
      return n;
    };
    H.msgs = key => G.events.filter(e => e.t === 'msg' && e.key === key).length;
  `);
  return { ctx, run, J: code => JSON.parse(run('JSON.stringify((() => {' + code + '})())')) };
}

function simChecks() {
  const S = simCtx(5);
  S.run('newWorld(5, 1); for (let i = 0; i < 60; i++) stepSim(); var c = G.colony, p = G.players[0], ROOM = { x: c.x - 420, y: T.surf[c.x - 420] + 140 };');

  // --- plan mode: the ant braces, the keys don't walk it ---
  const brace = S.J(`
    H.room(ROOM.x, ROOM.y, 40, 16);
    const a = H.stand(ROOM.x, ROOM.y, 1);
    const x0 = a.x, y0 = a.y;
    H.simN(40, { plan: true, dx: 1, dy: -1, px: a.x, py: a.y });
    const planX = a.x - x0, planY = a.y - y0;
    H.simN(20, { dx: 1 });
    return { planX, planY, walk: a.x - x0 };`);
  check('plan mode braces the ant (the keys don\'t walk it); out of it they walk again',
    Math.abs(brace.planX) < 0.5 && Math.abs(brace.planY) < 0.5 && brace.walk > 3, brace);

  // --- the cursor is held to the ant's reach; the brush marks only air ---
  const reach = S.J(`
    H.room(ROOM.x, ROOM.y, 120, 60);
    let a = H.stand(ROOM.x, ROOM.y + 50, 1);
    G.events.length = 0;
    // far beyond the reach (up and to the right, in a hall wider than it)
    H.simN(1, { plan: true, px: a.x + 400, py: a.y - 150, paint: 1 });
    const far = H.planned(c).map(q => Math.hypot(q.x - a.x, q.y - a.y));
    H.room(ROOM.x, ROOM.y, 40, 16);
    a = H.stand(ROOM.x, ROOM.y, 1);
    // then sweeping across the room's dirt wall
    H.simN(1, { plan: true, px: ROOM.x + 38, py: ROOM.y, paint: 1 });
    for (let k = 0; k < 10; k++) H.simN(1, { plan: true, px: ROOM.x + 38 + k, py: ROOM.y, paint: 1 });
    const pts = H.planned(c);
    return { farN: far.length, farMax: Math.max(...far), reach: PLAN_REACH + PLAN_BRUSH + 1,
      n: pts.length, solid: pts.filter(q => T.m[q.i] !== M_AIR).length, mats: [...new Set(pts.map(q => q.v))] };`);
  check('the cursor is held to PLAN_REACH of the ant', reach.farN > 0 && reach.farMax <= reach.reach, reach);
  check('the brush marks only open air (never the earth it sweeps over)', reach.n > 0 && reach.solid === 0, reach);

  // --- strokes, erasing, the material ---
  const brush = S.J(`
    H.room(ROOM.x, ROOM.y, 40, 16);
    const a = H.stand(ROOM.x, ROOM.y, 1);
    p.buildMat = M_PACKED;
    // a quick sweep: 20 px in one tick still leaves a line without gaps
    H.simN(1, { plan: true, px: a.x - 15, py: a.y - 12, paint: 1 });
    H.simN(1, { plan: true, px: a.x + 5, py: a.y - 12, paint: 1 });
    let gaps = 0;
    for (let x = Math.round(a.x - 15); x <= Math.round(a.x + 5); x++) if (!c.plan.has(Math.round(a.y - 12) * WORLD_W + x)) gaps++;
    const n1 = c.plan.size;
    // the next stroke: thatch, elsewhere
    p.buildMat = M_THATCH;
    H.simN(1, {});
    H.simN(3, { plan: true, px: a.x + 20, py: a.y - 4, paint: 1 });
    const th = H.planned(c).filter(q => q.v === M_THATCH).length;
    // X: erase where the first stroke went
    H.simN(1, { plan: true, px: a.x - 10, py: a.y - 12, paint: 2 });
    const erased = n1 + th - c.plan.size;
    const left = c.plan.has(Math.round(a.y - 12) * WORLD_W + Math.round(a.x - 10));
    return { n1, gaps, th, erased, left };`);
  check('a quick sweep paints a line without gaps', brush.n1 > 40 && brush.gaps === 0, brush);
  check('the brush takes the selected material (R)', brush.th > 10, brush);
  check('X erases planned pixels under the brush', brush.erased > 10 && !brush.left, brush);

  // --- the cap ---
  const cap = S.J(`
    c.plan.clear();
    // the sky over the room, planned almost full
    let n = 0;
    for (let y = 200; y < 900 && c.plan.size < PLAN_MAX - 5; y++) for (let x = ROOM.x - 300; x < ROOM.x + 300 && c.plan.size < PLAN_MAX - 5; x++) {
      const i = y * WORLD_W + x;
      if (T.m[i] === M_AIR) c.planSet(i, M_PACKED);
    }
    H.room(ROOM.x, ROOM.y, 40, 16);
    for (let y = 200; y < 900 && c.plan.size < PLAN_MAX - 5; y++) for (let x = ROOM.x - 300; x < ROOM.x + 300 && c.plan.size < PLAN_MAX - 5; x++) {
      const i = y * WORLD_W + x;
      if (T.m[i] === M_AIR) c.planSet(i, M_PACKED);
    }
    const a = H.stand(ROOM.x, ROOM.y, 1);
    G.events.length = 0;
    H.simN(10, { plan: true, px: a.x, py: a.y - 8, paint: 1 });
    const full = H.msgs('m_planFull');
    const size = c.plan.size;
    c.plan.clear();
    return { size, max: PLAN_MAX, full };`);
  check('a colony plans PLAN_MAX pixels at most, and the player is told once', cap.size === cap.max && cap.full === 1, cap);

  // --- F fills the plan: only planned pixels, from the load ---
  const fill = S.J(`
    H.room(ROOM.x, ROOM.y, 40, 16);
    const a = H.stand(ROOM.x, ROOM.y, 1);
    a.soil = 100; a.thatch = 0; p.buildMat = M_PACKED; p.stats.built = 0;
    // a shelf over the ant, in reach
    const n = H.planRect(c, Math.round(a.x - 8), Math.round(a.y - 11), Math.round(a.x + 8), Math.round(a.y - 9), M_PACKED);
    const before = new Uint8Array(T.m);
    const shelf = [...c.plan.keys()];
    // (held until the plan is done: then F would go on with the aimed stamp)
    for (let k = 0; k < 300 && c.plan.size; k++) H.simN(1, { build: true });
    let extra = 0, filled = 0;
    for (let y = ROOM.y - 30; y <= ROOM.y + 30; y++) for (let x = ROOM.x - 54; x <= ROOM.x + 54; x++) {
      const i = y * WORLD_W + x;
      if (before[i] === M_AIR && T.m[i] !== M_AIR) { if (shelf.includes(i)) filled++; else extra++; }
    }
    return { n, filled, extra, soilUsed: 100 - a.soil, built: p.stats.built, left: c.plan.size, mat: shelf.every(i => T.m[i] === M_PACKED || T.m[i] === M_AIR) };`);
  check('F by the plan fills its planned pixels (and nothing else)', fill.filled === fill.n && fill.extra === 0 && fill.mat, fill);
  check('...from the load, one pixel each; the scoreboard counts them; built pixels leave the plan',
    fill.soilUsed === fill.filled && fill.built === fill.filled && fill.left === 0, fill);

  // --- the held direction first; a thatch plan from the thatch load ---
  const aim = S.J(`
    H.room(ROOM.x, ROOM.y, 40, 16);
    const a = H.stand(ROOM.x, ROOM.y, 1);
    a.soil = 100; a.thatch = 100;
    const L0 = H.planRect(c, Math.round(a.x - 14), Math.round(a.y - 2), Math.round(a.x - 11), Math.round(a.y + 1), M_THATCH);
    const R0 = H.planRect(c, Math.round(a.x + 11), Math.round(a.y - 2), Math.round(a.x + 14), Math.round(a.y + 1), M_THATCH);
    H.simN(1, { build: true, dx: 1 });
    const left = H.planned(c).filter(q => q.x < a.x).length, right = H.planned(c).filter(q => q.x > a.x).length;
    return { L0, R0, left, right, thatch: a.thatch, soil: a.soil };`);
  check('F fills the planned pixels in the held direction first, from the thatch load for thatch',
    aim.left === aim.L0 && aim.right < aim.R0 && aim.thatch < 100 && aim.soil === 100, aim);

  // --- never walls in an ant ---
  const wall = S.J(`
    H.room(ROOM.x, ROOM.y, 40, 16);
    const a = H.stand(ROOM.x, ROOM.y, 1);
    a.soil = 100;
    const o = G.ants.find(q => q.playerIdx < 0 && q.caste === 'worker' && q.colony === c);
    o.x = a.x + 9; o.y = a.y; o.vx = o.vy = 0; o.state = 'idle'; o.stateT = 1e9;
    // plan the whole space around both ants
    H.planRect(c, Math.round(a.x - 17), Math.round(a.y - 14), Math.round(a.x + 17), Math.round(a.y + 4), M_PACKED);
    let buried = 0;
    for (let k = 0; k < 120; k++) {
      H.simN(1, { build: true });
      if (T.boxSolid(o.x, o.y, o.hw, o.hh, o.own) || T.boxSolid(a.x, a.y, a.hw, a.hh, a.own)) buried++;
    }
    const built = 100 - a.soil;
    o.stateT = 60;
    return { buried, built };`);
  check('F never walls an ant in (nor itself)', wall.buried === 0 && wall.built > 20, wall);

  // --- nothing planned in reach: the aimed stamp as before ---
  const stamp = S.J(`
    H.room(ROOM.x, ROOM.y, 40, 16);
    const a = H.stand(ROOM.x, ROOM.y, 1);
    a.soil = 100; p.buildMat = M_PACKED;
    H.planRect(c, Math.round(a.x - 34), Math.round(a.y - 4), Math.round(a.x - 30), Math.round(a.y), M_PACKED);
    const planned = c.plan.size;
    const { bx, by } = aimPoint(a, 0, 0);
    H.simN(1, { build: true });
    return { solid: T.solid(Math.round(bx), Math.round(by)), planned, left: c.plan.size, used: 100 - a.soil, next: planNext(a, c, 0, 0) };`);
  check('with nothing planned in reach F builds the aimed stamp as before (the far plan untouched)',
    stamp.solid && stamp.used > 0 && stamp.left === stamp.planned && stamp.next === null, stamp);

  // --- the stocks: a full load's overflow, E at the storage ---
  const stock = S.J(`
    H.room(ROOM.x, ROOM.y, 40, 16);
    const a = H.stand(ROOM.x + 30, ROOM.y, 1);
    c.stock.soil = 0; c.bank = c.constructor.prototype.bank;
    a.soil = LOAD_CAP;
    H.simN(40, { dx: 1, bite: true });
    const over = c.stock.soil;
    // empty-handed at the storage with a load: E unloads it
    c.stock.soil = 0; c.stock.thatch = 0;
    a.x = c.storage.x; a.y = c.storage.y; a.vx = a.vy = 0; a.carry = null; a.soil = 40; a.thatch = 7;
    for (const it of G.items) if (Math.hypot(it.x - a.x, it.y - a.y) < 14) it.dead = true;
    H.simN(2);
    G.events.length = 0;
    H.simN(1, { act: true });
    return { over, soil: c.stock.soil, thatch: c.stock.thatch, load: [a.soil, a.thatch], msg: H.msgs('m_stocked') };`);
  check('spoil that overflows a full load goes to the colony\'s stock', stock.over > 0, stock);
  check('E at the storage, empty-handed, unloads the loads into the stocks',
    stock.soil >= 40 && stock.thatch >= 7 && stock.load[0] === 0 && stock.load[1] === 0 && stock.msg === 1, stock);

  // --- saves: v9 keeps plan and stocks; older saves load with none ---
  const save = S.J(`
    H.room(ROOM.x, ROOM.y, 40, 16);
    c.plan.clear();
    H.planRect(c, ROOM.x - 30, ROOM.y - 10, ROOM.x - 10, ROOM.y + 6, M_PACKED);
    H.planRect(c, ROOM.x + 10, ROOM.y - 10, ROOM.x + 12, ROOM.y + 6, M_GATE);
    H.planRect(c, ROOM.x - 5, ROOM.y - 14, ROOM.x + 5, ROOM.y - 12, M_THATCH);
    c.stock.soil = 123; c.stock.thatch = 45;
    const before = JSON.stringify([...c.plan].sort((x, y) => x[0] - y[0]));
    const d = JSON.parse(JSON.stringify(serializeWorld()));
    const bytes = JSON.stringify(d.colonies[0].plan).length;
    const ok = restoreWorld(d, 1);
    const after = JSON.stringify([...G.colony.plan].sort((x, y) => x[0] - y[0]));
    const st = Object.assign({}, G.colony.stock);
    // the same save as a v8 one
    const old = JSON.parse(JSON.stringify(d));
    old.v = 8;
    const ok8 = restoreWorld(old, 1);
    const r = { v: d.v, ok, same: before === after, n: G.colony.plan.size, planned: JSON.parse(before).length, bytes, st,
      ok8, plan8: G.colony.plan.size, st8: Object.assign({}, G.colony.stock) };
    // a junk plan in a save is ignored, not trusted
    const junk = JSON.parse(JSON.stringify(d));
    junk.colonies[0].plan = [5, -3, 4, 'x', 1e12, 9];
    r.junk = restoreWorld(junk, 1) && G.colony.plan.size === 0;
    return r;`);
  check('saves are v9 and keep each colony\'s plan and stocks', save.v === 10 && save.ok && save.same && save.planned > 300 &&
    save.st.soil === 123 && save.st.thatch === 45, save);
  check('older saves load with no plan and empty stocks; a junk plan is dropped', save.ok8 && save.plan8 === 0 &&
    save.st8.soil === 0 && save.st8.thatch === 0 && save.junk, save);
  check('a plan saves compactly (runs of pixels)', save.bytes < save.planned * 1.5, save.bytes + ' bytes for ' + save.planned + ' px');

  // --- the packing round-trips ---
  const pack = S.J(`
    const e = [];
    for (let k = 0; k < 500; k++) e.push([Math.floor(Math.random() * WORLD_W * WORLD_H), [0, M_PACKED, M_THATCH, M_GATE][k % 4]]);
    const m = new Map(e);
    const out = new Map();
    planUnpack(planPack([...m]), (i, v) => out.set(i, v));
    return { same: [...m].every(([i, v]) => out.get(i) === v) && out.size === m.size };`);
  check('planPack / planUnpack round-trip', pack.same, pack);
}

// ---------------------------------------------------------------------------
// NPC builders, over several seeds
// ---------------------------------------------------------------------------
function builderChecks() {
  const res = [];
  for (const seed of [11, 22, 33]) {
    const S = simCtx(seed);
    const r = S.J(`
      newWorld(${seed}, 1);
      for (let i = 0; i < 600; i++) stepSim();
      const c = G.colony;
      // the plan: a 2-px shelf across the storage chamber's air above its
      // floor, a little wall stub off the junction, and thatch on the mound
      const s = c.storage, j = c.junction, e = c.entrance;
      let n = 0;
      n += H.planRect(c, s.x - 30, s.y - 16, s.x + 30, s.y - 15, M_PACKED);
      n += H.planRect(c, j.x + 14, j.y - 10, j.x + 16, j.y + 2, M_PACKED);
      n += H.planRect(c, e.x + 14, T.surf[e.x + 14] - 6, e.x + 26, T.surf[e.x + 14] - 1, M_THATCH);
      c.stock.soil = c.stockCap(); c.stock.thatch = c.stockCap();
      // (the player waits in the nest: the NPCs near it think every tick)
      const a = G.players[0].ant;
      a.x = j.x; a.y = j.y; a.vx = a.vy = 0;
      const food0 = c.stats.foodGathered;
      let maxRun = 0, builderTicks = 0, peak = 0;
      const run = new Map();
      for (let t = 0; t < 60 * 120; t++) {
        stepSim();
        let b = 0;
        for (const o of G.ants) {
          if (o.colony !== c) continue;
          if (o.state === 'build') { b++; const k = (run.get(o.id) || 0) + 1; run.set(o.id, k); if (k > maxRun) maxRun = k; }
          else run.delete(o.id);
        }
        builderTicks += b;
        if (b > peak) peak = b;
      }
      const workers = G.ants.filter(o => o.colony === c && o.caste === 'worker' && o.playerIdx < 0).length;
      const r = { n, left: c.plan.size, peak, workers, maxRun, avgBuilders: +(builderTicks / 7200).toFixed(2),
        food: Math.round(c.stats.foodGathered - food0), shunned: c.planShun.size };
      // the stock runs dry: the builders stop (no spoil coming in, for a clean count)
      c.bank = () => {};
      c.plan.clear();
      const n2 = H.planRect(c, s.x - 30, s.y - 16, s.x + 30, s.y - 13, M_PACKED);
      c.stock.soil = 30; c.stock.thatch = 0;
      for (const o of G.ants) if (o.state === 'build') o.endBuild(false);
      for (let t = 0; t < 60 * 60; t++) stepSim();
      r.dry = { n2, built: n2 - c.plan.size, stock: c.stock.soil, builders: G.ants.filter(o => o.state === 'build').length };
      return r;`);
    r.seed = seed;
    res.push(r);
    console.log('  seed ' + seed + ': ' + JSON.stringify(r));
  }
  check('NPC builders fill the nest\'s plan from the stocks (2 minutes, 3 seeds: most of it)',
    res.every(r => r.left <= r.n * 0.35 && r.peak >= 1), res.map(r => r.n - r.left + '/' + r.n));
  check('builders are few: at most 3, and no more than 15% of the workers (at least 1)',
    res.every(r => r.peak <= Math.min(3, Math.max(1, Math.floor(r.workers * 0.15)))), res.map(r => r.peak + ' of ' + r.workers));
  check('foraging goes on while they build', res.every(r => r.food > 0), res.map(r => r.food));
  check('no builder is stuck in its errand (none longer than its time limit and a spot\'s work)',
    res.every(r => r.maxRun < 2400 + 1800), res.map(r => r.maxRun));
  check('with the stock run dry the builders stop: no more built than the stock held',
    res.every(r => r.dry.built === 30 && r.dry.stock === 0 && r.dry.builders === 0), res.map(r => r.dry));
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
// a raw client that keeps the plans it is sent ([colony, packed runs]), as
// the browser's net.js does
function bot(port, name, P) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = { ws, msgs: [], name, devR: null, plans: {}, plBytes: [], plCols: new Set(), view: {} };
  const apply = (pl, whole) => {
    if (!Array.isArray(pl)) return;
    const ci = pl[0];
    if (whole || !b.plans[ci]) b.plans[ci] = new Map();
    const m = b.plans[ci];
    P.planUnpack(pl.slice(1), (i, v) => { if (v) m.set(i, v); else m.delete(i); });
    b.plCols.add(ci);
  };
  ws.on('message', d => {
    let m;
    try { m = JSON.parse(d.toString()); } catch (e) { return; }
    if (m.t === 's') {
      if (m.v) Object.assign(b.view, m.v);
      if (m.pl) { b.plBytes.push(JSON.stringify(m.pl).length); apply(m.pl, false); }
      return;
    }
    if (m.t === 'world') { b.plans = {}; if (m.plan) apply(m.plan, true); b.worldPlan = m.plan; }
    if (m.t === 'dev') { b.devR = m; return; }
    b.msgs.push(m);
  });
  ws.on('error', () => {});
  b.open = new Promise(r => ws.on('open', r));
  b.send = o => ws.send(JSON.stringify(o));
  b.hello = async () => { await b.open; b.send({ t: 'hello', v: 1, name }); return b.wait(m => m.t === 'welcome'); };
  b.wait = async (pred, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = b.msgs.find(pred); if (m) return m; await sleep(20); }
    return null;
  };
  b.dev = async js => {
    b.devR = null;
    b.send({ t: 'dev', js, id: 1 });
    const t0 = Date.now();
    while (!b.devR && Date.now() - t0 < 30000) await sleep(20);
    return b.devR && b.devR.r;
  };
  b.packed = ci => b.plans[ci] ? JSON.stringify([...b.plans[ci]].sort((x, y) => x[0] - y[0])) : '[]';
  return b;
}
// a raw player paints a stroke around its ant (paint 1) through its input
async function paint(b, you, dx0, dy0, dx1, dy1, mode) {
  const a = await b.dev(`(() => { const a = G.players[${you}].ant; return a ? [Math.round(a.x), Math.round(a.y)] : null; })()`);
  if (!a) return false;
  const steps = 12;
  for (let k = 0; k <= steps; k++) {
    const px = a[0] + dx0 + (dx1 - dx0) * k / steps, py = a[1] + dy0 + (dy1 - dy0) * k / steps;
    b.send({ t: 'in', dx: 0, dy: 0, bite: false, build: false, plan: 1, px: Math.round(px), py: Math.round(py), paint: mode || 1 });
    await sleep(40);
  }
  b.send({ t: 'in', dx: 0, dy: 0, bite: false, build: false });
  return true;
}
const serverPlan = (b, ci) => b.dev(`JSON.stringify([...G.colonies[${ci}].plan].sort((x, y) => x[0] - y[0]))`);

async function netChecks(browser) {
  // (the sim's packing, as the page has it)
  const P = simCtx(1).ctx;
  const port = await freePort();
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'maur-plan-'));
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', MAUR_DEV: '1', PERSIST_WORLDS: '0', DATA_DIR: DATA }),
  });
  let srvLog = '';
  srv.stdout.on('data', d => { srvLog += d; });
  srv.stderr.on('data', d => { srvLog += d; });
  for (let i = 0; i < 50; i++) { await sleep(100); try { await getJson(port, '/api/health'); break; } catch (e) { /* not yet */ } }
  try {
    // ---- co-op: A (raw, the host), a page joining by code, then a latecomer
    const A = bot(port, 'ALPHA', P);
    await A.hello();
    A.send({ t: 'create', mode: 'coop' });
    const lob = await A.wait(m => m.t === 'lobby');
    let page = null;
    const errors = [];
    if (browser) {
      const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
      page = await ctx.newPage();
      page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForTimeout(500);
      const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(70); } };
      await key('ArrowDown'); await key('Enter');                 // PLAY ONLINE
      await page.keyboard.type('Pagey'); await key('Enter');
      await key('ArrowDown', 2); await key('Enter');              // JOIN WITH A CODE
      await page.keyboard.type(lob.code); await key('Enter');
      await page.waitForFunction(() => G.state === 'lobby' && Net.players.length === 2, null, { timeout: 8000 });
    }
    A.send({ t: 'start' });
    await A.wait(m => m.t === 'world', 15000);
    if (page) await page.waitForFunction(() => G.state === 'play' && Net.ready && localAnt(), null, { timeout: 20000 });
    await sleep(500);
    // A paints a stroke over its ant
    await paint(A, 0, -20, -14, 20, -14, 1);
    await sleep(500);
    const s1 = await serverPlan(A, 0);
    const n1 = JSON.parse(s1).length;
    check('online: a player\'s plan input paints the colony\'s plan on the server', n1 > 60, n1);
    check('online: its own client gets the plan back (deltas)', A.packed(0) === s1);
    let pageSame = null;
    if (page) {
      pageSame = await page.evaluate(() => JSON.stringify([...G.colonies[0].plan].sort((x, y) => x[0] - y[0])));
      check('online co-op: the other player sees the plan (from the snapshots\' deltas)', pageSame === s1);
      // the page's own plan mode: B, the cursor up, Space held while it moves
      await page.keyboard.press('KeyB');
      await page.waitForTimeout(100);
      await page.keyboard.down('ArrowUp'); await page.waitForTimeout(250); await page.keyboard.up('ArrowUp');
      await page.keyboard.down('Space');
      await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(400); await page.keyboard.up('ArrowLeft');
      await page.keyboard.up('Space');
      await page.waitForTimeout(600);
      const s2 = await serverPlan(A, 0);
      const pg = await page.evaluate(() => ({ plan: JSON.stringify([...G.colonies[0].plan].sort((x, y) => x[0] - y[0])), mode: G.planMode }));
      check('online: a page\'s plan mode (B, cursor, Space) paints on the server, and both players have it',
        JSON.parse(s2).length > n1 + 20 && pg.plan === s2 && A.packed(0) === s2 && pg.mode, { n: JSON.parse(s2).length, was: n1 });
      await page.screenshot({ path: 'test/shot-plan-online.png' });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      check('online: Esc leaves plan mode (the menu stays shut)', await page.evaluate(() => !G.planMode && G.state === 'play'));
    }
    // the erase, and a pixel built over leaving the plan, reach the clients too
    await paint(A, 0, -20, -14, -10, -14, 2);
    await sleep(400);
    const built = await A.dev(`(() => { const c = G.colonies[0]; const i = c.plan.keys().next().value; T.placeAt([i], M_PACKED, null, 1); return i; })()`);
    await sleep(400);
    const s3 = await serverPlan(A, 0);
    check('online: erasing and building over reach the clients as deltas', A.packed(0) === s3 && !A.plans[0].has(built) &&
      (!page || await page.evaluate(s => JSON.stringify([...G.colonies[0].plan].sort((x, y) => x[0] - y[0])) === s, s3)));
    const pb = A.plBytes;
    check('online: plan deltas are small (only the pixels that changed)', pb.length > 0 && Math.max(...pb) < 1500,
      { snapshots: pb.length, max: Math.max(...pb), total: pb.reduce((x, y) => x + y, 0) });
    // the stocks reach the clients (a key of their own)
    check('online: the builders\' stocks reach the clients', A.view.k0 && typeof A.view.k0.soil === 'number', A.view.k0);
    // a latecomer gets the whole plan in the world message
    const C = bot(port, 'GAMMA', P);
    await C.hello();
    C.send({ t: 'join', code: lob.code });
    await C.wait(m => m.t === 'world', 15000);
    await sleep(300);
    check('online: a latecomer gets the whole plan with the world', C.worldPlan && C.packed(0) === await serverPlan(A, 0),
      C.worldPlan ? JSON.stringify(C.worldPlan).length + ' bytes' : 'none');
    for (const b of [A, C]) b.ws.close();
    if (page) await page.context().close();
    if (errors.length) console.log('  page errors:', errors.join('\n'));
    check('online co-op: no page errors', !errors.length);

    // ---- versus: each side only ever gets its own plan
    const X = bot(port, 'XRAY', P), Y = bot(port, 'YANKEE', P);
    await X.hello(); await Y.hello();
    X.send({ t: 'create', mode: 'versus' });
    const vl = await X.wait(m => m.t === 'lobby');
    Y.send({ t: 'join', code: vl.code });
    await Y.wait(m => m.t === 'lobby');
    await sleep(200);
    X.send({ t: 'start' });
    await X.wait(m => m.t === 'world', 15000);
    await Y.wait(m => m.t === 'world', 15000);
    await sleep(500);
    await paint(X, 0, -16, -12, 16, -12, 1);
    await paint(Y, 1, -16, -12, 16, -12, 1);
    await sleep(500);
    const b0 = await serverPlan(X, 0), r1 = await serverPlan(X, 1);
    check('versus: each side paints its own colony\'s plan', JSON.parse(b0).length > 40 && JSON.parse(r1).length > 40);
    check('versus: black gets only black\'s plan, red only red\'s', X.packed(0) === b0 && Y.packed(1) === r1 &&
      !X.plCols.has(1) && !Y.plCols.has(0) && X.worldPlan[0] === 0 && Y.worldPlan[0] === 1,
      { X: [...X.plCols], Y: [...Y.plCols] });
    check('versus: the enemy\'s stocks are never sent', X.view.k0 && !X.view.k1 && Y.view.k1 && !Y.view.k0);
    for (const b of [X, Y]) b.ws.close();
    check('online: the server stays up', !/CRASHED/.test(srvLog), srvLog.split('\n').filter(l => /CRASH|Error/.test(l)).slice(0, 3).join(' | '));
  } finally {
    srv.kill();
  }
}

// ---------------------------------------------------------------------------
// a page offline: the keys, the drawing, screenshots
// ---------------------------------------------------------------------------
async function pageChecks(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForTimeout(600);
  await page.evaluate(() => localStorage.clear());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  // the scene, out in daylight by the entrance: a thatched dome planned
  // over it (the left half already built), an ant gate across the shaft's
  // mouth; the stocks empty (and kept so) until the builders' turn
  await page.evaluate(() => {
    Tut.setOn(false);
    const c = G.colony;
    c.bank = () => {};
    c.stock.soil = 0; c.stock.thatch = 0;
    window.scene = () => {
      const e = c.entrance, g = T.surf[e.x], a = localAnt();
      c.plan.clear();
      const set = (x, y, m) => { const i = y * WORLD_W + x; if (T.m[i] === M_AIR) c.planSet(i, m); };
      for (let y = g - 34; y <= g + 2; y++) for (let x = e.x - 34; x <= e.x + 34; x++) {
        const r = Math.hypot(x - e.x, (y - g) * 1.25);
        if (r >= 27 && r <= 30 && y <= g) set(x, y, M_THATCH);
      }
      for (let y = e.y + 4; y <= e.y + 6; y++) for (let x = e.x - 8; x <= e.x + 8; x++) set(x, y, M_GATE);
      const half = [...c.plan.keys()].filter(i => i % WORLD_W < e.x - 4 && c.plan.get(i) === M_THATCH);
      T.placeAt(half, M_THATCH, null, 1e9);
      a.x = e.x + 40; a.y = T.surf[e.x + 40] - 4; a.vx = a.vy = 0; a.dir = -1; a.carry = null;
    };
    scene();
  });
  await page.waitForTimeout(400);
  // B: plan mode -- the ant braces, the cursor moves
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(100);
  const on = await page.evaluate(() => ({ mode: G.planMode, cur: G.planCur && { ...G.planCur }, ax: localAnt().x }));
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(350); await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(150); await page.keyboard.up('ArrowUp');
  const moved = await page.evaluate(() => ({ cur: { ...G.planCur }, ax: localAnt().x, inp: { ...G.players[LOCAL].input } }));
  check('page: B opens plan mode; the arrows move the cursor, not the ant', on.mode && moved.cur.x > on.cur.x + 10 &&
    Math.abs(moved.ax - on.ax) < 1 && moved.inp.plan && moved.inp.dx === 0, { on, moved });
  // the cursor is held to the reach (and the view)
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(1500); await page.keyboard.up('ArrowRight');
  const far = await page.evaluate(() => { const a = localAnt(), c = G.planCur, v = playerView();
    return { d: Math.hypot(c.x - a.x, c.y - a.y), inView: c.x >= G.cam.x && c.x < G.cam.x + v.vw && c.y >= G.cam.y && c.y < G.cam.y + v.vh }; });
  check('page: the cursor stays within PLAN_REACH of the ant and in view', far.d <= 90.5 && far.inView, far);
  // Space paints a stroke as the cursor moves (in the air over the ground); X erases
  await page.evaluate(() => { const a = localAnt(); G.planCur = { x: a.x + 20, y: a.y - 30 }; });
  const n0 = await page.evaluate(() => G.colony.plan.size);
  await page.keyboard.down('Space');
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(300); await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('Space');
  const n1 = await page.evaluate(() => G.colony.plan.size);
  await page.keyboard.down('KeyX');
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(300); await page.keyboard.up('ArrowRight');
  await page.keyboard.up('KeyX');
  const n2 = await page.evaluate(() => ({ n: G.colony.plan.size, ch: G.colony.chambers.length }));
  check('page: Space paints the plan, X erases it (and marks no chamber)', n1 > n0 + 20 && n2.n < n1, { n0, n1, n2 });
  // the shot: plan mode, the cursor painting a packed-earth wall beside the
  // half-built dome
  await page.evaluate(() => { scene(); const a = localAnt(); G.planCur = { x: a.x + 14, y: a.y - 26 }; G.players[LOCAL].buildMat = M_PACKED; });
  await page.waitForTimeout(300);
  await page.keyboard.down('Space');
  await page.keyboard.down('ArrowDown'); await page.waitForTimeout(260); await page.keyboard.up('ArrowDown');
  await page.waitForTimeout(80);
  await page.screenshot({ path: 'test/shot-plan-mode.png' });
  await page.keyboard.up('Space');
  // Esc: out of plan mode first, the pause menu only after
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const esc1 = await page.evaluate(() => ({ mode: G.planMode, state: G.state }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const esc2 = await page.evaluate(() => G.state);
  check('page: Esc leaves plan mode first; the next Esc pauses', !esc1.mode && esc1.state === 'play' && esc2 === 'pause', { esc1, esc2 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // F by the plan: the pixels it fills next blink; then it fills them
  await page.evaluate(() => { const a = localAnt(), e = G.colony.entrance; a.x = e.x + 26; a.y = T.surf[e.x + 26] - 4; a.soil = 100; a.thatch = 100; });
  await page.waitForTimeout(300);
  await page.keyboard.down('KeyF');
  await page.waitForTimeout(40);
  const nx = await page.evaluate(() => { const n = planNext(localAnt(), G.colony, 0, 0); return n && n.list.length; });
  await page.screenshot({ path: 'test/shot-plan-fill.png' });
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyF');
  const after = await page.evaluate(() => ({ thatch: localAnt().thatch, n: G.colony.plan.size }));
  check('page: holding F by the plan shows the pixels it fills next, and fills them', nx > 0 && after.thatch < 100, { nx, after });
  // the builders at work: stocks in, the dome's other half planned again
  await page.evaluate(() => {
    scene();
    const c = G.colony, a = localAnt(), e = c.entrance;
    c.stock.soil = 300; c.stock.thatch = 300;
    a.x = e.x + 36; a.y = T.surf[e.x + 36] - 4; a.vx = a.vy = 0;
  });
  const b0 = await page.evaluate(() => G.colony.plan.size);
  await page.waitForTimeout(20000);
  const b1 = await page.evaluate(() => ({ n: G.colony.plan.size, builders: G.ants.filter(o => o.state === 'build').length,
    food: Math.round(G.colony.food), stock: G.colony.stock, tick: G.tick, state: G.state,
    idle: G.ants.filter(o => o.colony === G.colony && o.caste === 'worker' && o.state === 'idle').length }));
  console.log('  builders on the dome: plan ' + b0 + ' -> ' + b1.n + ', building now ' + JSON.stringify(b1));
  await page.screenshot({ path: 'test/shot-plan-builders.png' });
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test/shot-plan-map.png' });
  await page.keyboard.press('KeyM');
  // the Norwegian bar fits too
  const fit = await page.evaluate(() => {
    const out = [];
    for (const k of ['ui_planKeys', 'ui_planCount', 'ui_stockShort', 'ui_stockLine', 'm_planFull', 'm_stocked', 'm_stockFull']) {
      for (const s of STR[k]) if (textWidth(s.replace(/\{\d\}/g, '8888')) > 296) out.push(k + ': ' + s);
    }
    for (const lang of [0, 1]) {
      LANG = lang;
      for (const m of ['solo', 'coop', 'versus', 'world']) for (const pg of helpPages(m)) {
        if (pg.lines.length > 16) out.push(m + ' ' + pg.title + ': ' + pg.lines.length + ' lines');
        for (const [l] of pg.lines) if (textWidth(l) > 296) out.push(pg.title + ': ' + l);   // (drawn at x = 24)
      }
      for (const l of L('h_build').split('\n')) if (textWidth(l) > 296) out.push('h_build: ' + l);
    }
    LANG = 0;
    return out;
  });
  check('page: the plan strings, the build hint and the help pages fit (both languages)', !fit.length, fit);
  // in Norwegian, for a look
  await page.evaluate(() => { setLang(true); });
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/shot-plan-no.png' });
  await page.keyboard.press('KeyB');
  await page.evaluate(() => { setLang(false); });
  if (errors.length) console.log('  page errors:', errors.join('\n'));
  check('page: no errors', !errors.length);
  await page.close();
}

(async () => {
  simChecks();
  builderChecks();
  const browser = NO_BROWSER ? null : await chromium.launch();
  if (!NO_NET) await netChecks(browser);
  if (browser) { await pageChecks(browser); await browser.close(); }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
