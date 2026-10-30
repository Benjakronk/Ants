// LEARN TO ANT probe: the guided scenario and the first online matches'
// tips (js/learn.js). First the sim alone (plain Node, a vm): the
// scenario's world is the seed's own terrain but for a small hollow off the
// nest (cramped, rock-free, markable once dug out), and G.tutorial keeps it
// calm -- no predators, no red raids, no golden seed falling by itself, no
// asks -- while a normal world is as before. Then a browser page: the title
// menu's LEARN TO ANT opens the chapter list and starts the first chapter;
// each of the eight chapters' goals is met by playing it (keys into the
// client, the sim stepped frame by frame), its "why" shows, Enter goes on;
// the year's fast-forward flies the princesses and keeps the stars; the end
// screen sets the done flag; H and the pause menu skip, the chapter list
// jumps, LEAVE TUTORIAL saves nothing. Last, online (the server as a child
// process): the lobby (co-op and the 8-row versus) offers LEARN TO ANT to a
// newcomer only, L takes it; a first match's tips start with the job, H
// moves on, HINTS off in the menu silences them, and after COACH_MATCHES
// matches there are none. Screenshots test/shot-tut-*.png (EN, some NO).
//   node test/tutprobe.js [--no-browser]
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const NO_BROWSER = process.argv.includes('--no-browser');

const fails = [];
const check = (name, ok, info) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info !== undefined ? '  ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''));
  if (!ok) fails.push(name);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// the sim alone (learn.js loaded after it: its world-making needs only the sim)
// ---------------------------------------------------------------------------
function simCtx() {
  const ctx = vm.createContext({ console, Math: Object.create(Math), btoa, atob });
  for (const f of ['worldgen.js', 'terrain.js', 'entities.js', 'colony.js', 'game.js', 'save.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'learn.js'), 'utf8'), ctx, { filename: 'learn.js' });
  const run = code => vm.runInContext(code, ctx);
  run.json = code => JSON.parse(run(`JSON.stringify(${code})`));
  return run;
}

function simChecks() {
  const run = simCtx();
  // ---- the world: the seed's terrain, but for the hollow --------------------------
  const w = run.json(`(() => {
    const base = genNewWorld(LEARN_SEED).m;
    const p = learnWorld(), c = G.colony;
    let diff = 0, notAir = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    for (let i = 0; i < base.length; i++) {
      if (base[i] === T.m[i]) continue;
      diff++;
      if (T.m[i] !== M_AIR || base[i] === M_ROCK || base[i] === M_WOOD) notAir++;
      const x = i % WORLD_W, y = (i / WORLD_W) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const area = p ? c.areaAt(p.x, p.y, null) : 0;
    return { p, tut: G.tutorial, diff, notAir, box: [x0, y0, x1, y1], area, depth: p ? p.y - T.bgSurf[p.x] : 0,
      reach: p ? Math.abs(p.x - c.entrance.x) : 0, near: p ? !!c.chamberNear(p.x, p.y, CH_SPACING) : true,
      job: G.players[0].job, mode: G.mode, len: G.yearLen };
  })()`);
  check('the scenario world: a calm solo FULL year, with a job', w.tut === true && w.mode === 'solo' && w.len === 'full' && w.job === 'forager', w);
  check('...the seed\'s own terrain but for the hollow: only diggable pixels dug out, all by the nest',
    w.p && w.diff > 100 && w.notAir === 0 && w.box[2] - w.box[0] < 260 && w.box[3] - w.box[1] < 200, w);
  check('...the hollow: cramped still (a chamber needs ' + 300 + '), deep, within the chambers\' reach, clear of them',
    w.p && w.area >= 150 && w.area < 300 && w.depth >= 60 && w.reach < 440 && !w.near, w);
  // ...and it can be dug out and marked
  const mk = run.json(`(() => {
    const p = learnWorld(), c = G.colony, a = G.players[0].ant;
    let n = 0;
    while (c.areaAt(p.x, p.y, null) < CH_MIN_AREA && n < 40) { T.dig(p.x + (n % 2 ? 1 : -1) * (10 + n), p.y - 2, 4); n++; }
    a.x = p.x; a.y = p.y + 2; a.vx = a.vy = 0;
    G.events.length = 0;
    const n0 = c.chambers.length, food0 = c.caps.food;
    c.markChamber(a, 0);
    return { bites: n, marked: c.chambers.length - n0, food0, food: c.caps.food, msg: G.events.filter(e => e.t === 'msg').map(e => e.key) };
  })()`);
  check('...a few bites widen it, X marks it: a new storage, the food cap rises', mk.bites <= 12 && mk.marked === 1 && mk.food > mk.food0 &&
    mk.msg.includes('m_chamberNew'), mk);

  // ---- calm: predators, raids, the golden seed, the asks ------------------------------
  const calm = tut => run.json(`(() => {
    newWorld(4242, 1, 'solo', 1, 'full'); assignJobs();
    G.tutorial = ${tut};
    const out = {};
    // a third day's night: predators would come
    G.tick = Math.floor(DAY_LEN * 3.8);
    const R = Math.random; Math.random = () => 0.00001;
    const n0 = G.bugs.filter(b => b.predator).length;
    for (let i = 0; i < 50; i++) worldSpawns();
    out.preds = G.bugs.filter(b => b.predator).length - n0;
    // a red colony strong enough to raid, on a raiding day
    const r = G.rival; r.food = 200; r.lastRaidDay = -9;
    for (let i = 0; i < 20; i++) G.ants.push(new Ant(r.junction.x, r.junction.y, 'soldier', r));
    G.tick = Math.floor(DAY_LEN * 4.2);
    r.updateRaid(r.members().length);
    out.raid = !!r.raid;
    Math.random = R;
    // the season's golden seed, past halfway
    G.tick = Math.floor(SEASON_DAYS * DAY_LEN * 1.55);
    G.events.length = 0;
    updateRelics();
    out.relic = G.items.some(it => it.kind === 'relic');
    // the asks: the queen bitten, a nest threatened
    const c = G.colony; c.ask = null; c.queenHit = { col: 1, t: G.tick + 600 };
    G.events.length = 0;
    jobAsks();
    out.ask = G.events.some(e => e.t === 'msg' && /^ask_/.test(e.key));
    return out;
  })()`);
  const on = calm(true), off = calm(false);
  check('G.tutorial: no predators, no red raid, no golden seed by itself, no asks', on.preds === 0 && !on.raid && !on.relic && !on.ask, on);
  check('...a normal world as before (predators, a raid, the seed, an ask)', off.preds > 0 && off.raid && off.relic && off.ask, off);
  const reset = run.json(`(() => { G.tutorial = true; newWorld(4242, 1, 'solo', 1, 'full'); return G.tutorial; })()`);
  check('...and a new world is never calm by itself', reset === false);
}

// ---------------------------------------------------------------------------
// the server (for the page and the online part)
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

// ---------------------------------------------------------------------------
// a browser page: the scenario, chapter by chapter
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
  await page.waitForTimeout(800);
  await page.evaluate(() => localStorage.clear());
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(70); } };
  const snap = name => page.screenshot({ path: `test/shot-tut-${name}.png` });
  // (G.state 'shot' is no state: the loop neither steps nor draws, so the
  // picture is exactly the drawPlay() made here; then back to 'pause', which
  // the loop leaves be while the probe plays the frames itself)
  const shot = async name => {
    await page.evaluate(() => { G.state = 'shot'; drawPlay(); });
    await snap(name);
    await page.evaluate(() => { G.state = 'pause'; });
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    // ---- the title: LEARN TO ANT, third; the chapter list; the first chapter -------------
    await page.waitForFunction(() => G.state === 'title' && !Logo.blocking(), null, { timeout: 10000 });
    const ti = await ev(() => { const it = titleItems(); const k = it.findIndex(i => i.id === 'learn'); return { k, label: it[k].label, hot: it[k].hot }; });
    check('the title menu: LEARN TO ANT, third, standing out for a newcomer', ti.k === 2 && ti.label === 'LEARN TO ANT' && ti.hot, ti);
    await key('ArrowDown', 2);
    await snap('title');
    await key('Enter');
    const lm = await ev(() => ({ state: G.state, sel: G.learnSel }));
    check('...Enter opens the chapter list at the first chapter', lm.state === 'learnmenu' && lm.sel === 0, lm);
    await snap('menu');
    await key('Enter');
    await page.waitForFunction(() => G.state === 'play' && Learn.on, null, { timeout: 20000 });
    const st = await ev(() => ({ ch: Learn.ch, slot: G.slot, tut: G.tutorial, hints: Tut.active(), arrow: G.arrowOn, gate: !!localAnt() }));
    check('...Enter starts chapter 1 on a calm world of its own (no spring hints over it)', st.ch === 0 && st.slot === 'learn' && st.tut && st.hints === null && st.gate, st);

    // the probe plays the frames from here (see shot)
    await ev(() => {
      G.state = 'pause';
      window.play = (n, codes, once) => {
        for (let i = 0; i < n; i++) {
          for (const c of codes || []) { keys[c] = true; if (i === 0) pressed[c] = true; }
          for (const c of once && i === 0 ? once : []) pressed[c] = true;
          updatePlay();
          for (const k in pressed) pressed[k] = false;
        }
        for (const c of codes || []) keys[c] = false;
      };
      window.me = () => localAnt();
      window.standAt = (x, y) => {
        const a = localAnt();
        a.x = x; a.y = y; a.vx = a.vy = 0; a.climbing = a.ceiling = false;
        G.cam.fx = undefined;
        play(20);
        return a;
      };
      // Enter, once the chapter's "why" has been up a moment
      window.nextCh = () => { play(25); play(1, [], ['Enter']); return Learn.ch; };
    });
    await shot('1-body');

    // ---- 1 the body: walk, climb, dig ---------------------------------------------------
    const c1 = await ev(() => {
      const S = Learn.S, out = {};
      play(150, ['ArrowLeft']);
      out.walk = !!S.got.walk; out.moved = Math.round(S.moved);
      out.arrow = guideTarget();   // (now: a tree to climb)
      // the nearest tree: against its trunk, up
      const e = G.colony.entrance;
      let t = G.trees[0];
      for (const o of G.trees) if (Math.abs(o.x - e.x) < Math.abs(t.x - e.x)) t = o;
      let x = t.x;
      while (x > t.x - 30 && T.solid(x, T.surf[t.x] - 10)) x--;
      standAt(x - 4, T.surf[x - 4] - 4);
      play(60, ['ArrowRight', 'ArrowUp']);
      out.climb = !!S.got.climb;
      standAt(e.x - 40, T.surf[e.x - 40] - 4);
      play(120, ['Space', 'ArrowDown']);
      out.dig = !!S.got.dig; out.load = Math.round(me().soil + me().thatch);
      out.done = Learn.done;
      return out;
    });
    check('chapter 1: walking, climbing a tree and digging a load are each seen', c1.walk && c1.climb && c1.dig && c1.done, c1);
    check('...the arrow shows a tree to climb once walking is done', !!c1.arrow && c1.arrow.icon === '\x06', c1.arrow);
    await shot('1-done');
    const done1 = await ev(() => ({ ch: nextCh(), stored: localStorage.getItem('maur_learn_ch') }));
    check('...its "why", then Enter: chapter 2; the chapter remembered as done', done1.ch === 1 && done1.stored && done1.stored[0] === '1', done1);
    await shot('2-food');

    // ---- 2 food: pick it up, store it ----------------------------------------------------
    const c2 = await ev(() => {
      const S = Learn.S, c = G.colony, out = {};
      const t = guideTarget();
      out.arrowFood = !!t && t.icon === '\x03';
      const seed = G.items.filter(it => it.kind === 'seed' && !it.carried && !it.dead)
        .sort((a, b) => Math.abs(a.x - c.entrance.x) - Math.abs(b.x - c.entrance.x))[0];
      standAt(seed.x, seed.y - 3);
      play(1, [], ['KeyE']); play(2);
      out.pick = !!S.got.pick;
      c.food = 10;
      const a = me(); a.x = c.storage.x; a.y = c.storage.y - 2; a.vx = a.vy = 0;
      play(1, [], ['KeyE']); play(2);
      out.store = !!S.got.store; out.done = Learn.done;
      return out;
    });
    check('chapter 2: the arrow on food; E picks it up, E at the storage stores it', c2.arrowFood && c2.pick && c2.store && c2.done, c2);
    await shot('2-done');
    await ev(() => nextCh());

    // ---- 3 the nest: widen the hollow, mark it, make it a nursery ---------------------------
    await shot('3-nest');
    const c3 = await ev(() => {
      const S = Learn.S, c = G.colony, p = S.pocket, out = { p };
      const t = guideTarget();
      out.arrow = !!t;
      standAt(p.x, p.y);
      for (let k = 0; k < 6 && !S.got.widen; k++) { play(40, ['Space', k % 2 ? 'ArrowRight' : 'ArrowLeft']); standAt(p.x, p.y); }
      out.widen = !!S.got.widen; out.area = S.area;
      play(1, [], ['KeyX']); play(3);
      out.mark = !!S.got.mark;
      play(1, [], ['KeyX']); play(3);
      out.type = !!S.got.type; out.done = Learn.done;
      out.caps = [S.caps.food, S.capsNow && S.capsNow.food, S.caps.pop, S.capsNow && S.capsNow.pop];
      return out;
    });
    check('chapter 3: digging the hollow out to a chamber\'s room, X marks it, X again a nursery', c3.arrow && c3.widen && c3.mark && c3.type && c3.done, c3);
    check('...the room it made shows: the caps rose', c3.caps[3] > c3.caps[2], c3.caps);
    await shot('3-done');
    await ev(() => setLang(true));
    await shot('3-done-no');
    await ev(() => setLang(false));
    await ev(() => nextCh());

    // ---- 4 finding your way: M, O, G ----------------------------------------------------------
    await shot('4-way');
    const c4 = await ev(() => {
      const S = Learn.S, out = {};
      play(1, [], ['KeyM']); out.map = G.showMap; play(3); play(1, [], ['KeyM']);
      play(1, [], ['KeyO']); play(3); play(1, [], ['KeyO']);
      play(1, [], ['KeyG']); out.half = !!S.got.arrow; play(3); play(1, [], ['KeyG']); play(2);
      out.got = Object.assign({}, S.got); out.done = Learn.done;
      return out;
    });
    check('chapter 4: the map (M), the milestones (O), the arrow off and on again (G)', c4.map && !c4.half && c4.done, c4);
    await shot('4-done');
    await ev(() => nextCh());

    // ---- 5 building: F, R, a blueprint -----------------------------------------------------
    await shot('5-build');
    const c5 = await ev(() => {
      const S = Learn.S, c = G.colony, e = c.entrance, out = {};
      const a = standAt(e.x + 50, T.surf[e.x + 50] - 4);
      a.dir = 1;
      play(30, ['KeyF', 'ArrowUp']);
      out.build = !!S.got.build;
      play(1, [], ['KeyR']); play(2);
      out.mat = !!S.got.mat;
      play(1, [], ['KeyB']); out.planMode = G.planMode;
      play(25, ['Space', 'ArrowRight']);
      play(1, [], ['KeyB']); play(2);
      out.plan = !!S.got.plan; out.size = c.plan.size; out.done = Learn.done;
      return out;
    });
    check('chapter 5: F builds, R switches the material, B plans (Space paints) and B again is done', c5.build && c5.mat && c5.planMode && c5.plan && c5.done, c5);
    await shot('5-done');
    await ev(() => nextCh());

    // ---- 6 danger: switch to a soldier, rally, the spider -------------------------------------
    await shot('6-danger');
    const c6 = await ev(() => {
      const S = Learn.S, out = { spider: !!S.spider && G.bugs.includes(S.spider) };
      play(1, [], ['KeyC']);
      out.overlay = !!(G.takeover && G.takeover.live);
      G.takeover.sel = Math.max(0, G.takeover.types.findIndex(t => t.caste === 'soldier'));
      play(1, [], ['Enter']); play(2);
      out.soldier = !!S.got.soldier;
      play(1, [], ['KeyQ']); play(2);
      out.rally = !!S.got.rally;
      out.msgs = G.msgs.map(m => m.text).slice(-2);
      const b = S.spider;
      b.hp = 1;
      const a = standAt(b.x - 7, b.y);
      a.dir = 1;
      for (let i = 0; i < 6 && !S.got.spider; i++) { const s = S.spider; if (!s.dead) { a.x = s.x - 6; a.y = s.y; } play(15, ['Space']); }
      out.slain = !!S.got.spider; out.done = Learn.done;
      return out;
    });
    check('chapter 6: a spider comes; C to a soldier, Q rallies, the spider slain', c6.spider && c6.overlay && c6.soldier && c6.rally && c6.slain && c6.done, c6);
    await shot('6-done');
    await ev(() => nextCh());

    // ---- 7 the year in fast-forward: the princesses fly, the stars ------------------------------
    await shot('7-year');
    const c7 = await ev(() => {
      const S = Learn.S, out = { seasons: [] };
      for (let k = 0; k < 3; k++) { play(1, [], ['Enter']); play(5); out.seasons.push(G.season); }
      out.princesses = G.ants.filter(a => a.caste === 'princess' && a.hp > 0 && a.colony === G.colony).length;
      out.y = G.year;
      play(1, [], ['Enter']); play(40);
      out.flying = !!G.flight && G.flyers.length > 0;
      return out;
    });
    check('chapter 7: Enter leaps on a season at a time (summer, autumn with princesses, winter)',
      c7.seasons.join() === '1,2,3' && c7.princesses === 3 && c7.y === 1, c7);
    check('...then the nuptial flight in spring of year 2', c7.flying, c7);
    await shot('7-flight');
    const c7b = await ev(() => {
      play(FLIGHT_T + 10);
      const S = Learn.S;
      return { flight: S.flight, done: Learn.done, over: G.over, state: G.state, year: G.year, saved: Object.keys(localStorage).filter(k => k.startsWith('maur_world_')) };
    });
    check('...its stars kept, the chapter done; no end screen, nothing saved', c7b.flight && c7b.flight.stars >= 1 && c7b.flight.flown === 3 &&
      c7b.done && c7b.over === null && c7b.state === 'pause' && c7b.year === 2 && !c7b.saved.length, c7b);
    await shot('7-done');
    await ev(() => setLang(true));
    await shot('7-done-no');
    await ev(() => setLang(false));
    await ev(() => nextCh());

    // ---- 8 together: J, the job page, Tab, Z ------------------------------------------------
    await shot('8-together');
    const c8 = await ev(() => {
      const S = Learn.S, out = { seed: G.items.some(it => it.kind === 'relic' && !it.dead) };
      const j0 = G.players[LOCAL].job;
      play(1, [], ['KeyJ']); play(2);
      out.job = !!S.got.job; out.switched = G.players[LOCAL].job !== j0;
      play(1, [], ['KeyO']); play(1, [], ['ArrowRight']); play(1, [], ['ArrowRight']); play(2);
      out.jobpage = !!S.got.jobpage;
      play(1, [], ['KeyO']);
      play(10, ['Tab']);
      out.scores = !!S.got.scores;
      play(1, [], ['KeyZ']); play(2);
      out.raid = !!S.got.raid; out.done = Learn.done;
      return out;
    });
    check('chapter 8: a golden seed falls; J switches the job, O\'s job page, Tab, Z', c8.seed && c8.job && c8.switched && c8.jobpage && c8.scores && c8.raid && c8.done, c8);
    await shot('8-done');
    const fin = await ev(() => { nextCh(); return { state: G.state, on: Learn.on, running: G.running, flag: localStorage.getItem('maur_learn'), chs: localStorage.getItem('maur_learn_ch') }; });
    check('Enter after the last chapter: YOU\'RE READY, the scenario over, the done flag set', fin.state === 'learnend' && !fin.on && !fin.running &&
      fin.flag === 'done' && fin.chs === '11111111', fin);
    await page.waitForTimeout(150);
    await snap('end');
    await ev(() => setLang(true));
    await page.waitForTimeout(150);
    await snap('end-no');
    await ev(() => setLang(false));
    const after = await ev(() => {
      const it = titleItems().find(i => i.id === 'learn');
      // (and a new solo world after it gives no spring hints)
      Tut.start(true);
      return { label: it.label, hot: it.hot, hints: Tut.active() };
    });
    check('...the title ticks LEARN TO ANT off; a fresh solo world then gives no spring hints', after.label === 'LEARN TO ANT \x19' && !after.hot && after.hints === null, after);
    // the end screen's menu: PLAY SOLO to the world list
    await key('Enter');
    check('...the end screen\'s PLAY SOLO goes to the world list', await ev(() => G.state === 'slots'));
    await key('Escape');

    // ---- skipping, the chapter list from the menu, leaving -----------------------------------
    const sk = await ev(() => {
      Learn.begin(0);
      G.state = 'pause';
      const out = { at: Learn.ch };
      play(1, [], ['KeyH']);
      out.h = Learn.ch;
      const pick = id => { G.state = 'pause'; G.menuSel = pauseItems().findIndex(i => i.id === id); pressed.Enter = true; updatePause(); pressed.Enter = false; };
      out.items = pauseItems().map(i => i.id);
      pick('skip');
      out.skip = Learn.ch; out.skipState = G.state;
      pick('chapters');
      out.list = G.state; out.sel = G.learnSel;
      pressed.Escape = true; updateLearnMenu(); pressed.Escape = false;
      out.back = G.state;
      pick('leaveLearn');
      out.left = { state: G.state, on: Learn.on, running: G.running, sel: titleItems()[G.menuSel].id,
        saved: Object.keys(localStorage).filter(k => k.startsWith('maur_world_')) };
      return out;
    });
    check('H skips a chapter; the pause menu\'s SKIP CHAPTER too', sk.at === 0 && sk.h === 1 && sk.skip === 2 && sk.skipState === 'play' &&
      sk.items.join() === 'resume,skip,chapters,help,leaveLearn', sk);
    check('...CHAPTERS opens the list at the chapter played, Esc back to the menu', sk.list === 'learnmenu' && sk.sel === 2 && sk.back === 'pause', sk);
    check('...LEAVE TUTORIAL: to the title, nothing saved', sk.left.state === 'title' && !sk.left.on && !sk.left.running &&
      sk.left.sel === 'learn' && !sk.left.saved.length, sk.left);
    // a chapter picked from the list: a fresh world at it
    const jump = await ev(() => { G.learnSel = 6; G.state = 'learnmenu'; pressed.Enter = true; updateLearnMenu(); pressed.Enter = false; return { state: G.state, load: G.loadLearn }; });
    await page.waitForFunction(() => G.state === 'play' && Learn.on, null, { timeout: 20000 });
    const jm = await ev(() => ({ jump: G.loadLearn, ch: Learn.ch, year: G.year, season: G.season }));
    check('the chapter list jumps to a chapter (7, the year: a fresh spring of year 1)', jump.state === 'loading' && jump.load === 6 &&
      jm.ch === 6 && jm.year === 1 && jm.season === 0, { jump, jm });
    await page.waitForTimeout(300);
    await snap('7-live');
    await ev(() => Learn.leave());

    // ---- what is drawn fits ----------------------------------------------------------------
    const fit = await ev(() => {
      const bad = [], w = s => textWidth(String(s).replace(/\{\d\}/g, '888'));
      for (const lang of [0, 1]) {
        LANG = lang;
        for (const id of LEARN_IDS) {
          const def = LEARN_CH[id];
          if (w(L('tu_head', 8, 8, L('tt_' + id))) + 12 + w(L('tu_keys')) > LEARN_W - 12) bad.push('head ' + id);
          for (const k of ['ti_' + id, 'tw_' + id]) for (const line of L(k, 3).split('\n')) if (w(line) > LEARN_W - 14) bad.push(k + ': ' + line);
          for (const g of def.goals) if (w('\x19 ' + L('tg_' + g, 888, 888)) > (def.goals.length >= 4 ? 144 : LEARN_W - 14)) bad.push('tg_' + g);
          if (w(L('tt_' + id)) + 24 > 220) bad.push('tt_' + id + ' (list)');
        }
        for (const s of LEARN_STAGES) {
          for (const line of L('ty_' + s).split('\n')) if (w(line) > LEARN_W - 14) bad.push('ty_' + s);
          if (w(L('tu_enter', L('tg_' + s))) > LEARN_W - 14) bad.push('tu_enter ' + s);
        }
        if (w(L('tu_win')) + 12 + 24 + 12 + w(L('tu_keys')) > LEARN_W - 12) bad.push('tu_win + stars');
        if (w(L('tu_caps', 888, 888, 88, 88, 8, 8)) > LEARN_W - 14) bad.push('tu_caps');
        for (const line of L('le_text').split('\n')) if (w(line) > 316) bad.push('le_text: ' + line);
        if (w(L('le_title')) * 2 > 316 || w(L('ui_learn')) * 2 > 316) bad.push('le_title / ui_learn at double size');
        for (const k of ['ln_sub', 'ln_done', 'ln_keys', 'ln_keys2', 'ui_learnOffer']) if (w(L(k, 8, 8)) > 316) bad.push(k);
        for (const k of ['ui_skipCh', 'ui_chapters', 'ui_leaveLearn', 'ui_hints']) if (112 + w(L(k, L('w_off'))) > 228) bad.push(k + ': pause panel');
        // the tips: two lines in the 300 px panel, the head beside the keys
        for (const k of Object.keys(STR).filter(k => /^cc_/.test(k) && !/head|tip|keys/.test(k))) {
          for (const line of L(k, L('rl_enemyNest')).split('\n')) if (w(line) > 296) bad.push(k + ': ' + line);
        }
        if (14 + w(L('cc_head', 4, 4)) + 10 + w(L('cc_keys')) > 306) bad.push('cc_head + cc_keys');
      }
      LANG = 0;
      return bad;
    });
    check('every LEARN TO ANT and tip string fits where it is drawn (both languages)', !fit.length, fit);

    // ---- online: the lobby's offer, a first match's tips -------------------------------------
    await ev(() => { localStorage.removeItem('maur_learn'); localStorage.setItem('maur_coach', '0'); G.state = 'title'; G.menuSel = 1; });
    await key('Enter');
    await page.keyboard.type('Newbie'); await key('Enter');
    check('the online menu offers LEARN TO ANT to a newcomer', await ev(() => G.state === 'netmenu' && !learnDone()));
    await snap('netmenu');
    await key('ArrowDown'); await key('Enter');                                   // CREATE A MATCH
    await key('ArrowDown', 3); await key('Enter');                                 // co-op, CREATE
    await page.waitForFunction(() => G.state === 'lobby' && Net.code, null, { timeout: 8000 });
    await page.waitForTimeout(200);
    const lo = await ev(() => ({ offer: lobbyOffer(), host: Net.you === Net.host }));
    check('the lobby offers LEARN TO ANT to a newcomer, on a free key line', lo.offer && lo.offer.y === 172 && lo.host, lo);
    await snap('lobby');
    await ev(() => setLang(true));
    await page.waitForTimeout(100);
    await snap('lobby-no');
    await ev(() => setLang(false));
    await ev(() => localStorage.setItem('maur_learn', 'done'));
    check('...not to one who has done it', await ev(() => lobbyOffer() === null));
    await ev(() => localStorage.removeItem('maur_learn'));
    // L: off to LEARN TO ANT (the room left)
    await key('l');
    const ll = await ev(() => ({ state: G.state, online: G.online, net: Net.status }));
    check('...L leaves the room for LEARN TO ANT\'s chapter list', ll.state === 'learnmenu' && !ll.online, ll);
    // the 8-row versus lobby: the offer takes the bottom line in turn
    await ev(() => { G.state = 'title'; G.menuSel = 1; });
    await key('Enter'); await key('Enter');                                        // the name is remembered
    await key('ArrowDown'); await key('Enter');
    await key('Enter');                                                            // co-op -> versus
    await key('ArrowDown', 3); await key('Enter');
    await page.waitForFunction(() => G.state === 'lobby' && Net.code && Net.mode === 'versus', null, { timeout: 8000 });
    await page.waitForTimeout(200);
    const vo = await ev(() => { const lay = lobbyLayout(); G.frame = 300; return { compact: lay.compact, rows: lay.rows, offer: lobbyOffer(), off: (G.frame = 100, lobbyOffer()) }; });
    check('...the versus lobby (8 rows a side): the offer shares the bottom line', vo.compact && vo.rows === 8 && vo.offer && vo.offer.y === 182 && vo.off === null, vo);
    await page.waitForFunction(() => G.frame % 360 >= 250 && G.frame % 360 < 300, null, { timeout: 8000 });
    await snap('lobby-vs');
    await key('Escape');                                                           // back to the online menu
    await page.waitForTimeout(300);

    // a co-op match: the tips come, keyed to the job
    await ev(() => { G.menuSel = 1; G.crMode = 'coop'; });
    await key('Enter');                                                            // CREATE A MATCH
    await key('ArrowDown', 3); await key('Enter');
    await page.waitForFunction(() => G.state === 'lobby' && Net.code, null, { timeout: 8000 });
    await key('Enter');                                                            // start
    await page.waitForFunction(() => G.state === 'play' && Net.ready, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    if (await ev(() => !!G.takeover)) await key('Enter');
    await page.waitForFunction(() => Coach.cur === 'job', null, { timeout: 8000 }).catch(() => {});
    const co = await ev(() => ({ on: Coach.on, cur: Coach.cur, job: G.players[LOCAL].job, text: Coach.cur && Coach.text(), hints: Tut.active(),
      named: !!Coach.cur && Coach.text().includes(L('job_' + G.players[LOCAL].job)), count: localStorage.getItem('maur_coach'), showing: Coach.showing() }));
    check('a first online match: the tips start with your job (how to do it), no spring hints over them', co.on && co.cur === 'job' && co.showing &&
      co.job && co.named && co.hints === null && co.count === '1', co);
    await page.waitForTimeout(200);
    await snap('online-hint');
    await page.waitForTimeout(300);   // (a tip just up ignores H for a third of a second)
    await key('h');
    await page.waitForFunction(() => Coach.cur === 'arrow', null, { timeout: 5000 }).catch(() => {});
    check('...H moves on to the next tip (the arrow and the top line)', await ev(() => Coach.cur === 'arrow'));
    await ev(() => setLang(true));
    await page.waitForTimeout(150);
    await snap('online-hint-no');
    await ev(() => setLang(false));
    // the menu's HINTS: off
    await key('Escape');
    const pm = await ev(() => pauseItems().map(i => i.id));
    await ev(() => { G.menuSel = pauseItems().findIndex(i => i.id === 'hints'); });
    await key('Enter');
    await key('Escape');
    const off = await ev(() => ({ tut: Tut.on, showing: Coach.showing(), stored: localStorage.getItem('maur_hints') }));
    check('...the online menu has HINTS; off, the tips are gone', pm.join() === 'resume,help,hints,leave' && !off.tut && !off.showing && off.stored === 'off', { pm, off });
    const later = await ev(() => {
      Tut.setOn(true);
      localStorage.setItem('maur_coach', String(COACH_MATCHES));
      Coach.start();
      return { on: Coach.on, count: localStorage.getItem('maur_coach') };
    });
    check('...and after ' + 3 + ' matches there are no tips', !later.on && later.count === '3', later);
    check('no page errors', !errors.length, errors.slice(0, 5));
  } finally {
    await browser.close();
  }
}

(async () => {
  simChecks();
  if (!NO_BROWSER) {
    const port = await freePort();
    const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'maur-tut-'));
    const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
      env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', MAUR_DEV: '1', PERSIST_WORLDS: '0',
        DATA_DIR: DATA, MAX_ROOMS: '8', CPU_BUDGET_MS: '1000', MAX_PLAYERS: '8', SIDE_MAX: '8', ROOM_IDLE_MS: '1000' }),
    });
    let srvLog = '';
    srv.stdout.on('data', d => { srvLog += d; });
    srv.stderr.on('data', d => { srvLog += d; });
    for (let i = 0; i < 50; i++) { await sleep(100); try { await getJson(port, '/api/health'); break; } catch (e) { /* not yet */ } }
    try {
      await screens(port);
      check('no crash on the server', !srvLog.includes('CRASHED') && !srvLog.includes('uncaught'),
        srvLog.split('\n').filter(l => /CRASH|uncaught/.test(l)).slice(0, 3).join(' | '));
    } catch (e) {
      check('the probe ran to the end', false, e && e.stack || String(e));
    } finally {
      srv.kill();
      try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* in use */ }
    }
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})();
