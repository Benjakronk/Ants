// Headless probe for the colony year: seasons, winter cold and the mound,
// milestones, the objectives screen, queen rules and princesses, the nuptial
// flight and the end screens, crystal upgrades, ant gates, aphid shelters,
// fungus gardens, and saves (v4 round-trip + an old v3 save).
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const fails = [];
  const check = (name, ok, info) => {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
    if (!ok) fails.push(name);
  };

  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(600);
  await page.evaluate(() => localStorage.clear());
  await page.keyboard.press('Enter');   // title -> slots
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');   // new world in slot 1
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space');   // skip intro
  await page.waitForTimeout(400);

  // helpers (scripted steps run with G.state 'pause' so the frame loop
  // doesn't step the sim as well)
  await page.evaluate(() => {
    window.simN = (n, held) => {
      const p = G.players[0];
      for (let i = 0; i < n; i++) { Object.assign(p.input, held || {}); stepSim(); drainEvents(); }
      p.input = newInput();
    };
    window.msgKeys = [];
    const de = drainEvents;
    // remember the message keys the sim emits
    window.drainEvents = () => { for (const e of G.events) if (e.t === 'msg') msgKeys.push(e.key); de(); };
    window.makeRoom = (cx, cy, rx, ry) => {
      for (let y = cy - ry - 14; y <= cy + ry + 14; y++) {
        for (let x = cx - rx - 14; x <= cx + rx + 14; x++) {
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          T.m[y * WORLD_W + x] = dx * dx + dy * dy <= 1 ? M_AIR : M_DIRT;
          T.wear.delete(y * WORLD_W + x);
        }
      }
      T.onEdit(cx - rx - 14, cy - ry - 14, cx + rx + 14, cy + ry + 14);
    };
    window.standAt = (x, y, dir) => {
      const a = G.players[0].ant;
      a.x = x; a.y = y; a.vx = 0; a.vy = 0; a.dir = dir || 1;
      a.climbing = a.ceiling = false; a.carry = null;
      simN(30);
      a.dir = dir || 1;
      return a;
    };
    window.setSeason = (s, year) => {
      G.tick = ((year || 1) - 1) * YEAR_DAYS * DAY_LEN + s * SEASON_DAYS * DAY_LEN + Math.floor(DAY_LEN * 0.3);
      simN(1);
    };
    const c = G.colony;
    window.ROOM = { x: c.x - 420, y: T.surf[c.x - 420] + 140 };
    G.state = 'pause';
  });

  // --- seasons advance with G.tick, with a message and new milestones ---
  const seasons = await page.evaluate(() => {
    const out = [];
    for (const s of [1, 2, 3]) {
      msgKeys.length = 0;
      setSeason(s);
      out.push({ season: G.season, obj: G.objectives.season, list: G.objectives.list.map(o => o.id),
        msg: msgKeys.includes('m_season') });
    }
    setSeason(0);
    return out;
  });
  check('seasons advance with the tick (summer, autumn, winter)',
    seasons.map(s => s.season).join() === '1,2,3' && seasons.every(s => s.obj === s.season && s.msg), seasons);
  check('each season has its 3 milestones', seasons.every(s => s.list.length === 3) &&
    seasons[2].list.includes('centipedes'), seasons.map(s => s.list));
  check('a year is 12 days of 4 min (48 min)', await page.evaluate(() =>
    YEAR_DAYS === 12 && DAY_LEN * YEAR_DAYS / 3600 === 48));

  // --- winter: the surface cold hurts, but not under a thatched mound ---
  const cold = await page.evaluate(() => {
    setSeason(3);
    const c = G.colony, e = c.entrance;
    // out in the open, well away from the nest
    let x = c.x + 320;
    while (T.get(x, T.surf[x] - 10) !== M_AIR) x++;
    const a = standAt(x, T.surf[x] - 4, 1);
    a.hp = a.maxHp;
    simN(120);
    const openLoss = a.maxHp - a.hp;
    // a thatch roof over the entrance: the mound
    for (let tx = e.x - 34; tx <= e.x + 34; tx += 4) {
      T.place(tx, T.surf[tx] - 16, 3, M_THATCH, null, 100);
    }
    c.recountMound();
    const mx = e.x + 18;
    standAt(mx, T.surf[mx] - 4, 1);
    a.hp = a.maxHp;
    simN(120);
    const moundLoss = a.maxHp - a.hp;
    // underground is always warm
    const j = c.junction;
    standAt(j.x, j.y, 1);
    a.hp = a.maxHp;
    simN(60);
    return { openLoss, moundLoss, underLoss: a.maxHp - a.hp, mound: c.mound.size,
      boost: c.broodBoost, coldMsg: msgKeys.includes('m_cold') };
  });
  check('winter surface cold hurts an ant in the open', cold.openLoss > 0.8 && cold.coldMsg, cold);
  check('no cold under the thatched mound (or underground)', cold.moundLoss === 0 && cold.underLoss === 0, cold);
  check('mound size counted, brood grows faster', cold.mound >= 60 && cold.boost > 1, [cold.mound, cold.boost]);
  check('the mound counts for the summer milestone', await page.evaluate(() => {
    setSeason(1);
    updateObjectives();
    return G.objectives.list.find(o => o.id === 'mound').n === G.colony.mound.size;
  }));

  // --- winter: a sealed entrance counts toward its milestone ---
  const seal = await page.evaluate(() => {
    setSeason(3);
    const c = G.colony, e = c.entrance;
    // plug every opening near the ground around the shaft with packed earth
    const filled = [];
    for (let x = e.x - 70; x <= e.x + 70; x++) {
      for (let y = T.bgSurf[x] - 2; y <= T.bgSurf[x] + 14; y++) {
        const i = y * WORLD_W + x;
        if (T.m[i] === M_AIR) { T.m[i] = M_PACKED; filled.push(i); }
      }
    }
    T.onEdit(e.x - 70, e.y - 20, e.x + 70, e.y + 30);
    const o0 = G.objectives.list.find(o => o.id === 'sealed').n;
    simN(CH_RECALC * 3);
    const o = G.objectives.list.find(o => o.id === 'sealed');
    const out = { sealed: c.sealed, n0: o0, n: o.n, need: o.need };
    for (const i of filled) if (T.m[i] === M_PACKED) T.m[i] = M_AIR;
    T.onEdit(e.x - 70, e.y - 20, e.x + 70, e.y + 30);
    c.recalcChambers();
    out.reopened = !c.sealed;
    return out;
  });
  // (an ant still out in the frost may chew its way home before the end)
  check('a sealed winter entrance advances its milestone', seal.n >= seal.n0 + 2 &&
    seal.reopened, seal);

  // --- princesses keep out of fights (no rally, no chase, no flight) ---
  const prFight = await page.evaluate(() => {
    const c = G.colony, q = c.queenCh;
    const pr = new Ant(q.x, q.y, 'princess'); G.ants.push(pr);
    const so = new Ant(q.x + 6, q.y, 'soldier'); G.ants.push(so);
    const sp = new Bug(q.x + 40, q.y, 'spider'); G.bugs.push(sp);
    const n = rallyAllies(so, 150, sp);
    const rallied = pr.state === 'fight';
    pr.state = 'fight'; pr.target = sp;
    pr.npcThink();
    const after = pr.state;
    G.ants = G.ants.filter(a => a !== pr && a !== so);
    G.bugs = G.bugs.filter(b => b !== sp);
    return { n, rallied, after };
  });
  check('a princess is never rallied, and keeps to the royal chamber when a foe is near',
    !prFight.rallied && prFight.after === 'idle', prFight);

  // --- spring milestones progress and complete (score + crystals) ---
  const obj = await page.evaluate(() => {
    setSeason(0, 1);
    G.objectives = newObjectives(1, 0, 0);
    const c = G.colony;
    const s0 = c.score, c0 = c.crystals;
    // a second storage chamber
    makeRoom(ROOM.x, ROOM.y, 34, 14);
    const a = standAt(ROOM.x, ROOM.y + 6, 1);
    G.players[0].input.mark = true;
    simN(1);
    simN(60);
    const st = G.objectives.list.find(o => o.id === 'storage2');
    // five new ants raised
    for (let i = 0; i < 5; i++) c.spawnAdult(c.nursery.x, c.nursery.y - 4);
    const raise = G.objectives.list.find(o => o.id === 'raise');
    return { storage: [st.n, st.done], raise: [raise.n, raise.done], yearDone: G.objectives.yearDone,
      score: c.score - s0, crystals: c.crystals - c0, msg: msgKeys.includes('m_milestone') };
  });
  check('milestone: mark a 2nd storage chamber', obj.storage[1] && obj.storage[0] >= 2, obj.storage);
  check('milestone: raise 5 new ants', obj.raise[1] && obj.raise[0] === 5, obj.raise);
  check('milestones give score and crystals', obj.yearDone === 2 && obj.score >= 400 &&
    obj.crystals === 4 && obj.msg, obj);

  // --- the objectives screen: O opens it, the world keeps running ---
  await page.evaluate(() => { G.state = 'play'; });
  await page.keyboard.press('o');
  await page.waitForTimeout(150);
  const t0 = await page.evaluate(() => G.tick);
  await page.waitForTimeout(300);
  const os1 = await page.evaluate(t => ({ open: !!G.objScreen, page: G.objScreen && G.objScreen.page,
    runs: G.tick > t, state: G.state }), t0);
  await page.screenshot({ path: 'test/shot-objectives.png' });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const os2 = await page.evaluate(() => G.objScreen && G.objScreen.page);
  await page.screenshot({ path: 'test/shot-upgrades.png' });
  // buy through the screen (Enter on the first row: mandibles)
  await page.evaluate(() => { G.colony.crystals = 3; G.colony.upg.mandibles = 0; });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const bought = await page.evaluate(() => [G.colony.upg.mandibles, G.colony.crystals]);
  await page.keyboard.press('o');
  await page.waitForTimeout(150);
  const os3 = await page.evaluate(() => ({ open: !!G.objScreen, state: G.state }));
  check('O opens the objectives screen while the sim runs', os1.open && os1.page === 0 && os1.runs &&
    os1.state === 'play', os1);
  check('right switches to the upgrades page', os2 === 1);
  check('Enter on the upgrades page buys (through input.buy)', bought[0] === 1 && bought[1] === 0, bought);
  check('O closes it again', !os3.open && os3.state === 'play');
  await page.evaluate(() => { G.state = 'pause'; });

  // --- crystal upgrades: bought via the input struct, validated, applied ---
  const upg = await page.evaluate(() => {
    const c = G.colony;
    c.upg = { mandibles: 0, digging: 0, armor: 0, carry: 0 };
    c.crystals = 1;
    const w = new Ant(0, 0, 'worker'), s = new Ant(0, 0, 'soldier');
    const dmg0 = w.dmgNow(), r0 = w.digRNow(), cd0 = w.digCdNow();
    G.players[0].input.buy = 'mandibles'; simN(1);
    const poor = c.upg.mandibles === 0 && c.crystals === 1;
    c.crystals = 30;
    G.players[0].input.buy = 'mandibles'; simN(1);
    G.players[0].input.buy = 'digging'; simN(1);
    G.players[0].input.buy = 'armor'; simN(1);
    G.players[0].input.buy = 'bogus'; simN(1);
    s.hp = s.maxHp; s.hurt(10, 0, 0);
    const taken = s.maxHp - s.hp;
    for (let i = 0; i < 4; i++) { G.players[0].input.buy = 'mandibles'; simN(1); }
    return { poor, lv: Object.assign({}, c.upg), crystals: c.crystals,
      dmg: [dmg0, w.dmgNow()], digR: [r0, w.digRNow()], digCd: [cd0, w.digCdNow()], taken };
  });
  check('an upgrade needs the crystals', upg.poor);
  check('upgrades raise bite damage, dig reach and speed, soldier armor',
    upg.dmg[1] > upg.dmg[0] && upg.digR[1] > upg.digR[0] && upg.digCd[1] < upg.digCd[0] && upg.taken < 10, upg);
  check('3 levels max, rising costs', upg.lv.mandibles === 3 && upg.crystals === 30 - 3 - 2 - 3 - 5 - 8, upg);

  // --- the queen is never playable ---
  const q = await page.evaluate(() => ({
    opts: takeoverOptions().map(t => t.caste),
    take: takeOver(0, 'queen', 0, 0),
  }));
  check('queen not offered in takeover (and refused)', !q.opts.includes('queen') && q.take === null, q.opts);

  // --- princesses: royal eggs only in autumn, with a roomy royal chamber ---
  const pr = await page.evaluate(() => {
    const c = G.colony;
    const royal = c.chambers.find(ch => ch.type === 'royal');
    // dig the royal chamber out big (as a player would: claimed room)
    makeRoom(royal.x, royal.y, 30, 28);
    royal.claimed = 5000;
    c.recalcChambers();
    const q = G.ants.find(a => a.caste === 'queen');
    q.x = royal.x; q.y = royal.y + 20;
    const tryLay = () => {
      G.brood = [];
      c.food = c.caps.food;
      c.eggT = 1;
      c.caps.pop = 99;    // (the ants raised above filled the nest)
      simN(1);
      return G.brood.length ? G.brood[G.brood.length - 1].royal : null;
    };
    setSeason(1);
    const summer = tryLay();
    setSeason(2);
    const autumn = tryLay();
    const egg = G.brood.find(b => b.royal);
    // raise her: a fed royal larva grows up into a princess
    egg.kind = 'larva'; egg.feedCount = 5; egg.age = 7300; egg.hungry = false; egg.hungerT = 9999;
    simN(2);
    return { royalMax: c.caps.royalMax, cap: c.caps.princess, summer, autumn,
      princess: G.ants.filter(a => a.caste === 'princess').length, msg: msgKeys.includes('m_princess'),
      obj: (G.objectives.list.find(o => o.id === 'princess') || {}).done };
  });
  check('royal chamber roomy enough, princess cap from royal area', pr.royalMax >= 1800 && pr.cap >= 2, pr);
  check('no princess egg in summer, one in autumn', pr.summer === false && pr.autumn === true, pr);
  check('a royal larva grows into a princess (autumn milestone)', pr.princess === 1 && pr.msg && pr.obj, pr);

  // --- the queen dies with a princess alive: she is crowned ---
  const succ = await page.evaluate(() => {
    msgKeys.length = 0;
    const q = G.colony.queen();
    q.hp = 0;
    simN(2);
    const mine = a => a.colony === G.colony && a.hp > 0;
    return { queens: G.ants.filter(a => a.caste === 'queen' && mine(a)).length,
      princesses: G.ants.filter(a => a.caste === 'princess' && mine(a)).length,
      over: G.over, msg: msgKeys.includes('m_newQueen') };
  });
  check('queen dies with a princess: succession', succ.queens === 1 && succ.princesses === 0 &&
    !succ.over && succ.msg, succ);

  // --- save / load round-trips the year's state ---
  const saved = await page.evaluate(() => {
    const c = G.colony;
    setSeason(2);
    c.crystals = 7;
    c.upg = { mandibles: 2, digging: 1, armor: 0, carry: 3 };
    c.shelters = [{ x: c.x + 200, y: T.surf[c.x + 200] - 3, t: 300 }];
    const g = c.chambers.find(ch => ch.type === 'storage' && !ch.anchor);
    g.type = 'fungus'; g.leaves = 12.5;
    G.objectives.list[0].n = 42;
    G.lastFlightYear = 0;
    const b = new Brood(c.nursery.x, c.nursery.y - 2, 'larva'); b.royal = true; G.brood.push(b);
    G.ants.push(new Ant(c.queenCh.x + 6, c.queenCh.y, 'princess'));
    const seed = G.makeItem('seed', c.x + 150, T.surf[c.x + 150] - 8); seed.age = 5000; G.items.push(seed);
    const ok = saveWorld(1);
    const d = JSON.parse(localStorage.getItem('maur_world_1'));
    return { ok, v: d.v, season: G.season, year: G.year, crystals: 7,
      obj: JSON.stringify(G.objectives) };
  });
  const loaded = await page.evaluate(() => {
    G.running = false;
    const ok = startSavedWorld(1);
    G.state = 'pause';
    const c = G.colony;
    return { ok, season: G.season, year: G.year, crystals: c.crystals, upg: c.upg,
      shelters: c.shelters.length, garden: (c.chambers.find(ch => ch.type === 'fungus') || {}).leaves,
      obj: JSON.stringify(G.objectives), royal: G.brood.filter(b => b.royal).length,
      princess: G.ants.filter(a => a.caste === 'princess').length,
      ages: G.items.filter(i => i.kind === 'seed' && i.age >= 4990).length };
  });
  check('save is version 5', saved.ok && saved.v === 5);
  check('calendar round-trips (via the tick)', loaded.ok && loaded.season === saved.season && loaded.year === saved.year);
  check('crystals and upgrades round-trip', loaded.crystals === 7 && loaded.upg.mandibles === 2 &&
    loaded.upg.digging === 1 && loaded.upg.carry === 3, loaded.upg);
  check('milestones round-trip', loaded.obj === saved.obj);
  check('loose food keeps its rot timer', loaded.ages >= 1, loaded.ages);
  check('shelters, garden stock, royal brood, princesses round-trip', loaded.shelters === 1 &&
    loaded.garden === 12.5 && loaded.royal === 1 && loaded.princess === 1, loaded);

  // --- an old v3 save loads: spring of year 1, nothing of the new yet ---
  const v3 = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('maur_world_1'));
    d.v = 3; d.colony = d.colonies[0]; delete d.colonies;
    d.ants = d.ants.filter(s => !s.col); d.brood = d.brood.filter(s => !s.col);
    d.tick = 5 * DAY_LEN + 1234; d.day = 5;
    delete d.objectives; delete d.lastFlightYear; delete d.flight;
    delete d.colony.crystals; delete d.colony.upg; delete d.colony.shelters;
    for (const ch of d.colony.chambers) { delete ch.leaves; if (ch.type === 'fungus') ch.type = 'storage'; }
    for (const b of d.brood) delete b.royal;
    d.ants = d.ants.filter(a => a.caste !== 'princess' && a.caste !== 'queen');  // a queenless old colony
    localStorage.setItem('maur_world_2', JSON.stringify(d));
    G.running = false;
    const ok = startSavedWorld(2);
    G.state = 'pause';
    simN(120);
    return { ok, year: G.year, season: G.season, day: G.day, tod: G.tick % DAY_LEN - 120,
      obj: G.objectives.list.map(o => o.id + ':' + o.n), crystals: G.colony.crystals,
      earned: OBJ_CRYSTALS * G.objectives.yearDone,
      upg: G.colony.upg, queen: G.ants.some(a => a.caste === 'queen'), over: G.over, info: slotInfo(2) };
  });
  check('v3 save loads into spring of year 1', v3.ok && v3.year === 1 && v3.season === 0 && v3.day === 0 &&
    v3.tod === 1234, v3);
  // (the old colony may already meet spring milestones: it earns those at once)
  check('v3 save: fresh milestones, no crystals or upgrades', v3.obj.length === 3 && v3.crystals === v3.earned &&
    Object.values(v3.upg).every(l => l === 0), v3);
  check('v3 save without a queen gets one (and goes on)', v3.queen && !v3.over);

  // --- ant gate: our ants walk through, a bug can't ---
  const gate = await page.evaluate(() => {
    makeRoom(ROOM.x, ROOM.y, 40, 10);
    const gx = ROOM.x;
    for (let y = ROOM.y - 12; y <= ROOM.y + 12; y++) {
      for (let x = gx; x < gx + 4; x++) if (T.get(x, y) === M_AIR) T.m[y * WORLD_W + x] = M_GATE;
    }
    T.onEdit(gx, ROOM.y - 12, gx + 3, ROOM.y + 12);
    const a = standAt(gx - 20, ROOM.y + 6, 1);
    simN(150, { dx: 1 });
    const antX = a.x;
    standAt(gx - 30, ROOM.y + 6, -1);   // out of the bug's way
    const bug = new Bug(gx - 12, ROOM.y + 6, 'pillbug');
    G.bugs.push(bug);
    let maxX = -Infinity;
    for (let i = 0; i < 240; i++) { bug.dir = 1; bug.curl = 0; simN(1); maxX = Math.max(maxX, bug.x); }
    // a red ant walking at the gate (physics alone: the gate's `own` test)
    const red = new Ant(gx + 14, ROOM.y + 6, 'soldier', G.rival);
    let minX = Infinity;
    for (let i = 0; i < 240; i++) { red.vx = -0.5; red.dir = -1; physStep(red); minX = Math.min(minX, red.x); }
    const intact = (() => { let n = 0; for (let y = ROOM.y - 12; y <= ROOM.y + 12; y++) for (let x = gx; x < gx + 4; x++) if (T.get(x, y) === M_GATE) n++; return n; })();
    bug.hp = 0;
    simN(2);
    return { gx, antX, maxX, minX, intact, solidBug: T.solid(gx + 1, ROOM.y), solidAnt: T.solid(gx + 1, ROOM.y, true) };
  });
  check('ant gate: our ant walks through it', gate.antX > gate.gx + 8, gate);
  check('ant gate: a pillbug and a red ant are barred', gate.maxX < gate.gx && gate.minX > gate.gx + 3, gate);
  check('ant gate: solid to others, open to our ants, untouched by own ants', gate.solidBug && !gate.solidAnt &&
    gate.intact > 40, gate);
  check('gate is tough like packed earth', await page.evaluate(() => {
    const x = ROOM.x + 1, y = ROOM.y;
    const r1 = T.dig(x, y, 2, 1), r2 = T.dig(x, y, 2, 1), r3 = T.dig(x, y, 2, 1);
    return r1.worn > 0 && r2.worn > 0 && r3.count > 0;
  }));

  // --- aphid shelter: X by a tree with thatch around it ---
  const shelter = await page.evaluate(() => {
    setSeason(1);
    const c = G.colony;
    c.shelters = [];
    let t = G.trees.filter(t => Math.abs(t.x - c.x) < FORAGE_R).sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0];
    let x = t.x + 26;
    while (T.get(x, T.surf[x] - 12) !== M_AIR) x++;
    const a = standAt(x, T.surf[x] - 4, 1);
    msgKeys.length = 0;
    G.players[0].input.mark = true; simN(1);
    const refused = c.shelters.length === 0 && msgKeys.includes('m_shelterThatch');
    for (const dx of [-10, 10]) T.place(a.x + dx, a.y - 4, 4, M_THATCH, buildClear(a.x + dx, a.y - 4, 4), 100);
    G.players[0].input.mark = true; simN(1);
    const made = c.shelters.length === 1;
    const sh = c.shelters[0];
    const hd = () => G.items.filter(i => i.kind === 'honeydew' && Math.hypot(i.x - sh.x, i.y - sh.y) < 30).length;
    const h0 = hd();
    sh.t = 1; simN(2);
    const h1 = hd();
    setSeason(3);
    G.items = G.items.filter(i => i.kind !== 'honeydew');
    sh.t = 1; simN(2);
    const winter = hd();
    setSeason(1);
    return { refused, made, h0, h1, winter, thatch: c.thatchNear(sh.x, sh.y, SHELTER_R) };
  });
  check('aphid shelter needs thatch, then X makes one by a tree', shelter.refused && shelter.made, shelter);
  check('aphid shelter drips honeydew (not in winter)', shelter.h1 > shelter.h0 && shelter.winter === 0, shelter);

  // --- fungus garden: leaves in, food out (in winter too) ---
  const fungus = await page.evaluate(() => {
    const c = G.colony;
    const gx = ROOM.x + 600, gy = T.surf[ROOM.x + 600] + 160;
    makeRoom(gx, gy, 34, 14);
    const a = standAt(gx, gy + 6, 1);
    for (let i = 0; i < 5; i++) { G.players[0].input.mark = true; simN(1); }
    const ch = c.chamberNear(a.x, a.y, CH_NEAR);
    const type = ch && ch.type;
    // carry a leaf to it and press E
    const leaf = G.makeItem('leaf', a.x, a.y); G.items.push(leaf); leaf.carried = a; a.carry = leaf;
    G.players[0].input.act = true; simN(1);
    const afterLeaf = ch.leaves;
    // and a thatch load
    a.thatch = 60;
    G.players[0].input.act = true; simN(1);
    const afterThatch = ch.leaves;
    setSeason(3);
    c.food = 20;
    const f0 = c.food;
    G.colony.recalcChambers();
    // the garden alone (the colony's own comings and goings -- foragers
    // storing food, nurses spending it, leaves fed in -- would blur this)
    for (let i = 0; i < 900; i++) c.updateGardens();
    return { type, area: ch.area, afterLeaf, afterThatch, thatchLeft: a.thatch, leavesLeft: ch.leaves,
      gained: c.food - f0, leafDead: leaf.dead };
  });
  check('X cycles to a fungus garden', fungus.type === 'fungus' && fungus.area >= 300, fungus);
  check('leaves and thatch feed the garden', fungus.afterLeaf === 4 && fungus.leafDead &&
    fungus.afterThatch === 10 && fungus.thatchLeft === 0, fungus);
  check('the garden turns leaves into food, in winter too', fungus.leavesLeft < 10 && fungus.gained > 0, fungus);

  // winter look (snow, frost) for the screenshot
  await page.evaluate(() => {
    setSeason(3);
    const c = G.colony;
    standAt(c.entrance.x + 40, T.surf[c.entrance.x + 40] - 4, 1);
    G.players[0].ant.hp = G.players[0].ant.maxHp;
    G.cam.fx = undefined;
    G.state = 'play';
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test/shot-winter.png' });
  check('winter repaint of grass and leaves finished', await page.evaluate(() =>
    TerrainView.season === 3 && TerrainView.slow.length === 0));

  // --- the nuptial flight: princesses fly, the win screen, CONTINUE ---
  const flight = await page.evaluate(() => {
    G.state = 'pause';
    const c = G.colony;
    for (let i = 0; i < 3; i++) G.ants.push(new Ant(c.queenCh.x + i * 4, c.queenCh.y, 'princess'));
    G.lastFlightYear = 0;
    G.tick = YEAR_DAYS * DAY_LEN - 3;
    G.objectives = newObjectives(1, 3, 9);
    G.rival.defeated = true;   // (the rival star: the red queen slain)
    G.state = 'play';
    for (let i = 0; i < 60; i++) updatePlay();
    return { flight: !!G.flight, flyers: G.flyers.length,
      princesses: G.ants.filter(a => a.caste === 'princess').length, state: G.state };
  });
  check('nuptial flight starts on spring of year 2', flight.flight && flight.flyers === 3 &&
    flight.princesses === 0, flight);
  await page.evaluate(() => { for (let i = 0; i < 120; i++) updatePlay(); });
  await page.screenshot({ path: 'test/shot-flight.png' });
  const win = await page.evaluate(() => {
    for (let i = 0; i < 600 && G.state === 'play'; i++) updatePlay();
    return { state: G.state, s: G.gameOverStats, saved: !!slotInfo(G.slot) };
  });
  check('win screen after the flight: 3 stars, CONTINUE offered', win.state === 'gameover' && win.s.win &&
    win.s.stars === 3 && win.s.flown === 3 && win.s.canContinue && win.saved, win.s);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/shot-win.png' });
  await page.keyboard.press('Enter');   // CONTINUE
  await page.waitForTimeout(300);
  const cont = await page.evaluate(() => ({ state: G.state, over: G.over, year: G.year, season: G.season,
    running: G.running, obj: G.objectives.year }));
  check('CONTINUE: the colony goes on into year 2', cont.state === 'play' && !cont.over && cont.year === 2 &&
    cont.season === 0 && cont.running && cont.obj === 2, cont);
  const noRefly = await page.evaluate(() => {
    G.state = 'pause';
    G.ants.push(new Ant(G.colony.queenCh.x, G.colony.queenCh.y, 'princess'));
    simN(60);
    return !G.flight && !G.over;
  });
  check('only one flight per spring', noRefly);
  check('year 2: milestone targets grow, the names show them', await page.evaluate(() => {
    const y1 = newObjectives(1, 0).list, y2 = newObjectives(2, 0).list;
    const need = (l, id) => l.find(o => o.id === id).need;
    return need(y1, 'food100') === 100 && need(y2, 'food100') === 150 && need(y2, 'storage2') === 3 &&
      need(y2, 'raise') === 5 && msgText({ key: 'm_milestone', args: [{ key: 'o_food100', args: [150] }, 2] })
        .includes('150');
  }));
  check('one princess reads in the singular', await page.evaluate(() =>
    !L('r_flight1').includes('{0}') && !L('m_flight1').includes('PRINCESSES')));
  check('stars: 1 for a princess, +1 for 3 princesses or 8 milestones, +1 for the rival', await page.evaluate(() => {
    // rival: 'dead' (red queen slain), 'big' (red outnumbers us), 'small' (we outnumber red)
    const reds = G.ants.filter(a => a.colony === G.rival);
    const t = (n, ms, rival) => {
      G.ants = G.ants.filter(a => a.caste !== 'princess' && a.colony !== G.rival);
      for (let i = 0; i < n; i++) G.ants.push(new Ant(G.colony.queenCh.x, G.colony.queenCh.y, 'princess'));
      G.rival.defeated = rival === 'dead';
      const many = rival === 'big' ? G.colony.members().length + 5 : 2;
      for (let i = 0; i < many; i++) G.ants.push(new Ant(G.rival.junction.x, G.rival.junction.y, 'worker', G.rival));
      G.lastFlightYear = 0;
      startFlight(ms);
      const s = G.flight.stars; G.flight = null;
      return s;
    };
    const ok = t(1, 0, 'big') === 1 && t(3, 0, 'big') === 2 && t(1, 8, 'big') === 2 && t(0, 12, 'dead') === 0 &&
      t(3, 8, 'big') === 2 && t(1, 0, 'small') === 2 && t(1, 0, 'dead') === 2 && t(3, 8, 'small') === 3;
    G.ants = G.ants.filter(a => a.colony !== G.rival).concat(reds);
    G.rival.defeated = false;
    return ok;
  }));

  // --- the queen dies with no heir: the loss screen ---
  const lose = await page.evaluate(() => {
    G.running = false;
    deleteWorld(3);
    startNewWorld(3);
    saveWorld(3);
    G.state = 'play';
    G.ants.find(a => a.caste === 'queen').hp = 0;
    for (let i = 0; i < 10 && G.state === 'play'; i++) updatePlay();
    return { state: G.state, s: G.gameOverStats, saveGone: !slotInfo(3) };
  });
  check('queen dies with no princess: game over', lose.state === 'gameover' && !lose.s.win &&
    lose.s.reason === 'r_queen' && !lose.s.canContinue && lose.saveGone, lose.s);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/shot-lose.png' });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  check('loss screen returns to the title', await page.evaluate(() => G.state === 'title'));

  console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  await browser.close();
  process.exit(errors.length || fails.length ? 1 : 0);
})();
