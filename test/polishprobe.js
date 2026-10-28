// Headless probe for the Phase 3 polish: the tutorial hints (they advance on
// the right actions, can be skipped and turned off, and remember where they
// were), the guide arrow (it points toward the target and toggles with G),
// the raid alert and the theft notice, health bars on hurt enemies, the
// plural helper in both languages, the O screen with the toasts held back,
// the map's icons, gate rims and the two factions' colours. Screenshots for
// review: test/shot-polish-*.png.
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
  // (G.state 'shot' is no state at all: the frame loop neither steps nor
  // draws, so the picture is exactly the drawPlay() made here)
  const shot = async name => {
    await page.evaluate(() => { G.state = 'shot'; drawPlay(); });
    await page.screenshot({ path: path.join(__dirname, 'shot-polish-' + name + '.png') });
    await page.evaluate(() => { G.state = 'pause'; });
  };

  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(600);
  await page.evaluate(() => localStorage.clear());
  await page.keyboard.press('Enter');   // title -> slots
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');   // new world in slot 1
  await page.waitForTimeout(2500);
  check('the intro states the year goal', await page.evaluate(() => introText().join(' ').includes('YEAR 2') &&
    (LANG = 1, introText().join(' ').includes('ÅR 2')) && (LANG = 0, true)));
  await page.keyboard.press('Space');   // skip intro
  await page.waitForTimeout(400);

  // helpers: the client's own tick with keys held (the frame loop is
  // stopped by G.state 'pause'; we play the 'play' state by hand)
  await page.evaluate(() => {
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
    window.standAt = (x, y) => {
      const a = G.players[0].ant;
      a.x = x; a.y = y; a.vx = a.vy = 0; a.climbing = a.ceiling = false; a.carry = null;
      G.cam.fx = undefined;
      play(20);
      return a;
    };
    window.makeRoom = (cx, cy, rx, ry) => {
      for (let y = cy - ry - 14; y <= cy + ry + 14; y++) {
        for (let x = cx - rx - 14; x <= cx + rx + 14; x++) {
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          T.m[y * WORLD_W + x] = dx * dx + dy * dy <= 1 ? M_AIR : M_DIRT;
        }
      }
      T.onEdit(cx - rx - 14, cy - ry - 14, cx + rx + 14, cy + ry + 14);
    };
    window.px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    window.hasColor = (x0, y0, w, h, rgb, tol) => {
      const d = ctx.getImageData(x0, y0, w, h).data;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - rgb[0]) <= tol && Math.abs(d[i + 1] - rgb[1]) <= tol && Math.abs(d[i + 2] - rgb[2]) <= tol) return true;
      }
      return false;
    };
    // a quiet world: no raids or predators unless a test makes them
    G.rival.lastRaidDay = 99;
    G.bugs = G.bugs.filter(b => !b.predator);
  });

  // --- the tutorial: each hint waits for its action ---------------------------------
  const t0 = await page.evaluate(() => ({ on: Tut.on, step: Tut.step, active: Tut.active(), stored: localStorage.getItem('maur_tut_1') }));
  check('a new world starts the hints at the first one', t0.on && t0.step === 0 && t0.active === 'move' && t0.stored === '0', t0);
  await shot('hint');
  const waitGap = () => page.evaluate(() => { play(TUT_GAP + 2); return { step: Tut.step, active: Tut.active() }; });

  // 1 move + climb: up the shaft at the junction, then along
  const mv = await page.evaluate(() => {
    // a long flat tunnel of our own: climb in it (up, underground), then walk
    const c = G.colony;
    const x = c.x + 420, y = T.surf[c.x + 420] + 150;
    makeRoom(x, y, 95, 8);
    standAt(x + 70, y + 6);
    play(30, ['ArrowUp']);
    play(30);
    play(150, ['ArrowLeft']);
    return { gap: Tut.gapT > 0 || Tut.step > 0, climbed: Tut.climbed, moved: Math.round(Tut.moved) };
  });
  check('hint 1 (move and climb) completes on moving and climbing', mv.gap, mv);
  let st = await waitGap();
  check('then hint 2 (dig)', st.active === 'dig', st);

  // 2 dig: bite into the wall until the soil load fills
  const dg = await page.evaluate(() => {
    const j = G.colony.junction;
    const a = standAt(j.x, j.y); a.soil = 0;
    play(60, ['Space', 'ArrowRight']);
    return { soil: Math.round(a.soil), gap: Tut.gapT > 0 };
  });
  check('hint 2 completes when digging fills the soil load', dg.gap && dg.soil >= 20, dg);
  st = await waitGap();
  check('then hint 3 (food to the stores)', st.active === 'food', st);

  // the guide arrow follows the food hint: food first, then the stores
  const ar = await page.evaluate(() => {
    const a = G.players[0].ant;
    const t1 = guideTarget();
    const seed = G.makeItem('seed', a.x, a.y); G.items.push(seed);
    seed.carried = a; a.carry = seed;
    const t2 = guideTarget();
    const s = storageTarget(a);
    return { food: !!t1 && t1.color === '#a8e8a0', store: !!t2 && t2.x === s.x && t2.y === s.y };
  });
  check('during the food hint the arrow points at food, then (laden) at the stores', ar.food && ar.store, ar);

  // 3 food: carry it to the storage and press E
  const fd = await page.evaluate(() => {
    const c = G.colony; c.food = 10;
    const a = G.players[0].ant, seed = a.carry;
    a.x = c.storage.x; a.y = c.storage.y - 2; a.vx = a.vy = 0;
    play(1, [], ['KeyE']);
    return { stored: !a.carry && seed.dead, gap: Tut.gapT > 0 };
  });
  check('hint 3 completes on storing food with E', fd.stored && fd.gap, fd);
  st = await waitGap();
  check('then hint 4 (build, switch material)', st.active === 'build', st);

  // 4 build with F, switch with R
  const bd = await page.evaluate(() => {
    const j = G.colony.junction;
    const a = standAt(j.x, j.y); a.soil = 60; a.dir = -1;
    play(30, ['KeyF']);
    const built = Tut.did.built;
    play(1, [], ['KeyR']);
    play(1, [], ['KeyR']); play(1, [], ['KeyR']);   // (back to packed earth)
    return { built, cycled: Tut.did.cycled, gap: Tut.gapT > 0 };
  });
  check('hint 4 completes after building and switching material', bd.built && bd.cycled && bd.gap, bd);
  st = await waitGap();
  check('then hint 5 (mark a chamber)', st.active === 'mark', st);

  // 5 mark: a hollow deep down, X in it (but first a peek at the O screen,
  // ahead of its hint: remembered for hint 6)
  const mk = await page.evaluate(() => {
    play(1, [], ['KeyO']); play(1, [], ['KeyO']);
    const early = Tut.gapT > 0 || Tut.active() !== 'mark';
    const c = G.colony;
    const x = c.x - 420, y = T.surf[c.x - 420] + 140;
    makeRoom(x, y, 26, 13);
    standAt(x, y + 8);
    const n0 = c.chambers.length;
    play(1, [], ['KeyX']);
    return { early, marked: c.chambers.length === n0 + 1, gap: Tut.gapT > 0 };
  });
  check('hint 5 completes on marking a chamber with X (not on O)', !mk.early && mk.marked && mk.gap, mk);
  st = await waitGap();
  check('then hint 6 (the O screen)', st.active === 'obj', st);

  // 6 the O screen: already opened during hint 5, so the hint shows a
  // moment to be read and ticks itself off
  const ob = await page.evaluate(() => {
    play(30);
    const early = Tut.gapT > 0;
    play(TUT_KNOWN);
    return { early, gap: Tut.gapT > 0, closed: !G.objScreen };
  });
  check('hint 6, done ahead of time, shows a moment and then completes', !ob.early && ob.gap && ob.closed, ob);
  st = await waitGap();
  check('then hint 7 (Tab)', st.active === 'tab', st);

  // 7 Tab to another ant
  const tb = await page.evaluate(() => {
    play(1, [], ['KeyC']);
    const menu = !!(G.takeover && G.takeover.live);
    play(1, [], ['Enter']);
    return { menu, gap: Tut.gapT > 0, stored: localStorage.getItem('maur_tut_1') };
  });
  check('hint 7 completes on switching ants with Tab', tb.menu && tb.gap, tb);
  st = await waitGap();
  check('then the closing hint, and the steps are remembered', st.active === 'done' &&
    (await page.evaluate(() => localStorage.getItem('maur_tut_1'))) === String(7), st);
  const gone = await page.evaluate(() => { play(TUT_END + 2); return Tut.active(); });
  check('the closing hint goes away by itself', gone === null, gone);

  // skipping with H; turning hints off from the pause menu (and back on)
  const sk = await page.evaluate(() => {
    Tut.start(true);
    const a0 = Tut.active();
    play(1, [], ['KeyH']);
    const a1 = Tut.active();
    // the pause menu's HINTS item
    G.state = 'pause';
    const idx = pauseItems().findIndex(i => i.id === 'hints');
    G.menuSel = idx;
    pressed.Enter = true; updatePause(); pressed.Enter = false;
    const off = { on: Tut.on, stored: localStorage.getItem('maur_hints'), active: Tut.active() };
    G.state = 'pause';
    drawPlay();
    const drawn = drawHint();
    Tut.setOn(true);
    return { a0, a1, off, drawn };
  });
  check('H skips the current hint', sk.a0 === 'move' && sk.a1 === 'dig', sk);
  check('the pause menu turns the hints off (remembered, nothing drawn)',
    sk.off.on === false && sk.off.stored === 'off' && sk.off.active === null && sk.drawn === false, sk.off);
  const title = await page.evaluate(() => {
    // and the title menu has the switch too
    G.state = 'title'; G.menuSel = titleItems().findIndex(i => i.id === 'hints');
    pressed.Enter = true; updateTitle(); pressed.Enter = false;
    const off = Tut.on;
    pressed.Enter = true; updateTitle(); pressed.Enter = false;
    G.state = 'pause';
    return { off, on: Tut.on };
  });
  check('the title menu turns the hints off and on', title.off === false && title.on === true, title);
  // a saved world from before the hints, past its first day, doesn't start them
  const old = await page.evaluate(() => {
    localStorage.removeItem('maur_tut_1');
    const t = G.tick; G.tick = DAY_LEN * 2;
    Tut.start(false);
    const r = Tut.active();
    G.tick = t;
    Tut.step = TUT_STEPS.length; Tut.endT = 0;
    return r;
  });
  check('an old save past day 1 gets no hints', old === null, old);

  // --- the guide arrow ----------------------------------------------------------------
  const ga = await page.evaluate(() => {
    const c = G.colony;
    c.food = 100; c.tasks = [];      // (no gather task: it would point at food)
    G.objectives.list.forEach(o => { o.done = o.id !== 'raise'; });   // the active one: raise -> the nursery
    const a = standAt(c.x - 700, T.surf[c.x - 700] - 4);
    for (let i = 0; i < 200; i++) updateCamera();
    const t = guideTarget();
    const camx = Math.round(G.cam.x), camy = Math.round(G.cam.y);
    const v = playerView();
    const sp = edgeSpot(t.x, t.y, camx, camy, v.vw, v.vh);
    drawPlay();
    // the arrow is drawn there (its pixels in one of its two blink colours)
    const near = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) near.push(px(Math.round(sp.x) + dx, Math.round(sp.y) + dy));
    const lit = near.some(p => (p[0] > 200 && p[1] > 200) || (p[0] > 200 && p[1] > 200 && p[2] > 180));
    // (once down in the nest, the nursery itself)
    const j = c.junction, a2 = standAt(j.x, j.y), t2 = guideTarget();
    standAt(a.x, a.y);
    for (let i = 0; i < 200; i++) updateCamera();
    return { target: { x: t.x, y: t.y }, nursery: { x: c.nursery.x, y: c.nursery.y }, sp,
      entrance: { x: c.entrance.x, y: c.entrance.y }, inside: { x: t2.x, y: t2.y },
      pointsRight: Math.cos(sp.a) > 0.5, lit, onEdge: !sp.sight && sp.x > 300 };
  });
  check('the arrow points at the active milestone\'s place (raise -> the nursery, by the entrance from outside)',
    ga.target.x === ga.entrance.x && ga.target.y === ga.entrance.y && ga.inside.x === ga.nursery.x && ga.inside.y === ga.nursery.y, ga);
  check('off screen it sits on the viewport edge and points toward it', ga.onEdge && ga.pointsRight && ga.lit, ga.sp);
  await shot('arrow');
  const tog = await page.evaluate(() => {
    const a = G.players[0].ant;
    play(1, [], ['KeyG']);
    const off = { on: G.arrowOn, stored: localStorage.getItem('maur_arrow') };
    drawPlay();
    play(1, [], ['KeyG']);
    return { off, on: G.arrowOn, stored: localStorage.getItem('maur_arrow') };
  });
  check('G toggles the arrow (default on, remembered)', tog.off.on === false && tog.off.stored === 'off' &&
    tog.on === true && tog.stored === 'on', tog);
  const near = await page.evaluate(() => {
    const c = G.colony;
    const a = standAt(c.nursery.x - 60, c.nursery.y);
    for (let i = 0; i < 200; i++) updateCamera();
    const t = guideTarget();
    const v = playerView();
    return edgeSpot(t.x, t.y, Math.round(G.cam.x), Math.round(G.cam.y), v.vw, v.vh);
  });
  check('in sight, the arrow bobs over the target', near.sight && Math.abs(Math.sin(near.a) - 1) < 1e-6, near);

  // --- the raid alert ------------------------------------------------------------------
  const rd = await page.evaluate(() => {
    const c = G.colony, r = G.rival;
    r.food = 300;
    const n = r.startRaid(c, 6);
    const al = raidAlert();
    // far off and not yet warned of: just the edge marker, no banner
    G.msgs = [];
    drawPlay();
    const early = hasColor(0, 125, VIEW_W, 50, [0x7a, 0x14, 0x08], 2) || hasColor(0, 125, VIEW_W, 50, [0x4a, 0x0c, 0x04], 2);
    r.raid.warned = true;
    drawPlay();
    // the banner's dark red band, low on the screen
    const band = hasColor(0, 150, VIEW_W, 24, [0x7a, 0x14, 0x08], 2) || hasColor(0, 150, VIEW_W, 24, [0x4a, 0x0c, 0x04], 2);
    // a thief at the stores: food stolen, and a short notice
    const th = G.ants.find(a => a.colony === r && a.raiding && a.raidRole === 'steal');
    c.food = 80;
    th.x = c.storage.x; th.y = c.storage.y;
    r.steal(th, c);
    drainEvents();
    // done stealing, the raid turns home: the laden thieves still show
    r.raid.phase = 'retreat';
    const fl = raidAlert();
    const flee = !!(fl && fl.flee && fl.n === 1 && fl.banner);
    r.raid.phase = 'march';
    return { n, alert: !!al, early, flee, band, notice: G.msgs.some(m => m.text.startsWith('FOOD STOLEN')), key: raidAlert() && raidAlert().stolen };
  });
  check('a raid on the nest raises the alert banner (once close)', rd.n >= 3 && rd.alert && !rd.early && rd.band, rd);
  check('thieves fleeing with our food keep the alert', rd.flee, rd);
  check('a theft shows a short FOOD STOLEN notice', rd.notice && rd.key > 0, rd);
  await shot('raid');
  await page.evaluate(() => {
    const r = G.rival;
    r.raid = null;
    for (const a of G.ants) if (a.raiding) { a.raiding = false; a.raidRole = null; a.state = 'idle'; }
  });

  // --- enemy health bars ----------------------------------------------------------------
  const hb = await page.evaluate(() => {
    const a = G.players[0].ant;
    const sp = new Bug(a.x + 40, a.y, 'spider'); G.bugs.push(sp);
    const camx = Math.round(G.cam.x), camy = Math.round(G.cam.y);
    const before = drawFoeBars(camx, camy, VIEW_W, VIEW_H - HUD_H, a);
    sp.hurt(10, 0, 0);
    const after = drawFoeBars(camx, camy, VIEW_W, VIEW_H - HUD_H, a);
    G.bugs = G.bugs.filter(b => b !== sp);
    return { before, after };
  });
  check('a hurt predator near the player shows a health bar', hb.before === 0 && hb.after === 1, hb);

  // --- plurals ---------------------------------------------------------------------------
  const pl = await page.evaluate(() => {
    const out = {};
    for (const lang of [0, 1]) {
      LANG = lang;
      out[lang] = [Ln('ui_survived', 1), Ln('ui_survived', 3), Ln('ui_daysLeft', 1), Ln('ui_daysLeft', 2),
        msgText({ key: 'm_rally', args: [1] }), msgText({ key: 'm_rally', args: [4] }),
        msgText({ key: 'm_follow', args: [1] }), Ln('ui_colonySize', 1)];
    }
    LANG = 0;
    // every singular has its plural, in both languages
    const orphans = Object.keys(STR).filter(k => k.endsWith('_1') && (!STR[k.slice(0, -2)] || STR[k].length !== 2));
    return { en: out[0], no: out[1], orphans };
  });
  check('plurals in English', pl.en[0] === 'SURVIVED 1 DAY' && pl.en[1] === 'SURVIVED 3 DAYS' && pl.en[2] === '1 DAY LEFT' &&
    pl.en[3] === '2 DAYS LEFT' && pl.en[4] === 'RALLY! 1 ANT ANSWERS THE CALL' && pl.en[5].includes('4 ANTS ANSWER') &&
    pl.en[6] === 'TO ME! 1 SOLDIER FOLLOWS YOU' && pl.en[7] === 'COLONY: 1 ANT', pl.en);
  check('plurals in Norwegian', pl.no[0] === 'OVERLEVDE 1 DAG' && pl.no[1] === 'OVERLEVDE 3 DAGER' && pl.no[2] === '1 DAG IGJEN' &&
    pl.no[3] === '2 DAGER IGJEN' && pl.no[6] === 'TIL MEG! 1 SOLDAT FØLGER DEG', pl.no);
  check('every singular string has its plural', pl.orphans.length === 0, pl.orphans);

  // --- the O screen: the toasts wait under it, and show after -------------------------------
  const os = await page.evaluate(() => {
    G.msgs = [];
    pushMsg('TOAST TEST', '#00ff00');
    const t0 = G.msgs[0].t;
    G.objScreen = { page: 0, sel: 0 };
    play(90);
    const mine = G.msgs.find(m => m.text === 'TOAST TEST');
    const held = !!mine && mine.t === t0;
    G.msgs = G.msgs.filter(m => m !== mine).concat([mine]);   // (the newest, for the status line)
    drawPlay();
    // the toast's pure green isn't drawn up top (the panel's status line
    // shows the newest message lower down, clear of the keys)
    const top = hasColor(0, 18, VIEW_W, 50, [0, 255, 0], 0);
    const status = hasColor(0, 160, VIEW_W, 18, [0, 255, 0], 0);
    G.objScreen = null;
    drawPlay();
    const after = hasColor(0, 18, VIEW_W, 50, [0, 255, 0], 0);
    play(10);
    return { held, top, status, after, counting: mine.t < t0 };
  });
  check('toasts wait while the O screen is open', os.held && !os.top && os.status, os);
  check('...and show once it closes', os.after && os.counting, os);
  await page.evaluate(() => { G.objScreen = { page: 0, sel: 0 }; });
  await shot('objectives');
  await page.evaluate(() => { G.objScreen = null; });

  // --- the map: icons, the nest close up, the legend; gates in it ---------------------------
  const mp = await page.evaluate(() => {
    const c = G.colony, j = c.junction;
    // an ant gate across a bit of tunnel by the junction (dug out first)
    for (let y = j.y - 6; y <= j.y + 2; y++) {
      for (let x = j.x + 6; x <= j.x + 26; x++) T.m[y * WORLD_W + x] = x >= j.x + 14 && x <= j.x + 17 ? M_GATE : M_AIR;
    }
    T.onEdit(j.x + 4, j.y - 8, j.x + 28, j.y + 4);
    c.shelters.push({ x: c.x + 300, y: T.surf[c.x + 300] - 2, t: 999 });
    G.showMap = true; G.gatesT = 0;
    drawPlay();
    const gates = G.gates.length;
    const look = (rgb) => hasColor(0, 0, VIEW_W, VIEW_H - HUD_H, rgb, 2);
    const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const res = { gates, storage: look(hex(CH_LOOK.storage.color)), royal: look(hex(CH_LOOK.royal.color)),
      gateIcon: look([0xd8, 0xa8, 0x60]), shelter: look([0x8c, 0xc8, 0x5a]), redFlag: look([0xe0, 0x38, 0x28]),
      ourFlag: look([0xff, 0xe0, 0x80]) };
    return res;
  });
  check('the map draws chamber, gate, shelter and nest icons', mp.gates >= 1 && mp.storage && mp.royal &&
    mp.gateIcon && mp.shelter && mp.redFlag && mp.ourFlag, mp);
  await shot('map');
  await page.evaluate(() => { G.showMap = false; });

  // a gate's edge against the air is lit (TerrainView's rim), its heart woven
  const rim = await page.evaluate(() => {
    const j = G.colony.junction;
    TerrainView.flush();
    const d = TerrainView.terCtx.getImageData(j.x + 14, j.y - 6, 4, 9).data;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 160) bright++;
    return bright;
  });
  check('an ant gate has a bright rim where it meets a tunnel', rim >= 4, rim);

  // --- a player soldier's rally: the soldiers near fall in behind it -----------------------
  const fl = await page.evaluate(() => {
    const c = G.colony;
    const x = c.x + 420, y = T.surf[c.x + 420] + 150;   // the probe's long tunnel
    const me = takeOver(0, 'soldier', x, y) || G.players[0].ant;
    me.x = x + 60; me.y = y + 6; me.vx = me.vy = 0;
    G.bugs = G.bugs.filter(b => !b.predator);
    const esc = [];
    for (const a of G.ants) {
      if (a.colony === c && a.caste === 'soldier' && a.playerIdx < 0 && esc.length < 2) {
        a.x = x - 20 - esc.length * 10; a.y = y + 6; a.vx = a.vy = 0; a.state = 'patrol'; esc.push(a);
      }
    }
    while (esc.length < 2) {   // (a young colony may have just the one)
      const a = new Ant(x - 20 - esc.length * 10, y + 6, 'soldier', c); a.state = 'patrol';
      G.ants.push(a); esc.push(a);
    }
    me.abilCd = 0;
    G.msgs = [];
    play(1, [], ['KeyQ']);
    const answered = esc.filter(a => a.followT > 0 && a.followIdx === 0).length;
    const msg = G.msgs.some(m => m.text.startsWith('TO ME!'));
    const d0 = esc.map(a => Math.abs(a.x - me.x));
    play(300);
    const d1 = esc.map(a => Math.abs(a.x - G.players[0].ant.x));
    return { answered, msg, d0, d1, states: esc.map(a => a.state) };
  });
  check('Q as a soldier with no foe near: the soldiers near follow the player', fl.answered === 2 && fl.msg &&
    fl.d1.every((d, i) => d < fl.d0[i] || d < 26), fl);

  // --- friend and foe -------------------------------------------------------------------
  const fo = await page.evaluate(() => {
    const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const black = ['worker', 'soldier', 'nurse'].map(k => Math.round(lum(CASTE[k].color)));
    const red = ['worker', 'soldier', 'nurse'].map(k => RED_COLOR[k]);
    return { black, redOk: red.every(c => c[0] > 200 && c[1] < 90 && c[2] < 70) };
  });
  check('black ants are dark, red ants a clear scarlet', fo.black.every(l => l < 90) && fo.redOk, fo);

  // building into solid earth says why nothing happened
  const nr = await page.evaluate(() => {
    const j = G.colony.junction;
    // (no other ant buried by the pocket's walls, digging its way out)
    G.ants = G.ants.filter(o => o === G.players[0].ant || o.caste === 'queen' ||
      Math.abs(o.x - j.x) > 40 || Math.abs(o.y - j.y) > 40);
    const a = standAt(j.x, j.y); a.soil = 60;
    // a pocket just the ant's size: solid all round (whole-pixel centre:
    // makeRoom indexes the terrain with it)
    makeRoom(Math.round(a.x), Math.round(a.y), 4, 3);
    standAt(a.x, a.y);
    G.msgs = [];
    play(20, ['KeyF']);
    drainEvents();
    return { soil: Math.round(a.soil), msg: G.msgs.some(m => m.text.startsWith('NO ROOM THERE')) };
  });
  check('F with no room to build: a NO ROOM toast', nr.soil === 60 && nr.msg, nr);

  // a new body gets a ring for a moment
  const yr = await page.evaluate(() => {
    You.ant = null;
    drawPlay();
    const t0 = You.t;
    for (let i = 0; i < YOU_T + 5; i++) drawPlay();
    return { t0, t1: You.t };
  });
  check('switching to a new ant rings it for a moment', yr.t0 > 0 && yr.t1 === 0, yr);

  // an escort at heel is not taken for a stuck ant (the freeze detector
  // would dig it loose, into the mound)
  const hl = await page.evaluate(() => {
    const c = G.colony, e = c.entrance;
    G.bugs = G.bugs.filter(b => !b.predator);   // (no foes about to fight:
    G.ants = G.ants.filter(o => o.colony === c || o.caste === 'queen'); //  red raiders left from the raid test too)
    const a = standAt(e.x + 30, T.surf[e.x + 30] - 4);
    const s = new Ant(a.x - 8, a.y, 'soldier', c); G.ants.push(s);
    s.state = 'follow'; s.followIdx = 0; s.followT = 99999;
    for (let i = 0; i < 900; i++) { a.x = e.x + 30; a.vx = 0; stepSim(); }
    const t = s.target;
    const r = { state: s.state, freezeT: s.freezeT,
      target: t ? { kind: t.caste || t.kind, red: t.colony && t.colony !== c, dx: Math.round(t.x - s.x), dy: Math.round(t.y - s.y) } : null };
    s.hp = 0;
    return r;
  });
  check('an escort at heel stays at heel (no freeze dig)', hl.state === 'follow' && hl.freezeT < 720, hl);

  // the red queen: a bite long faded, then death by hunger: not slain by us
  const qs = await page.evaluate(() => {
    const r = G.rival, q = r.queen(), me = G.players[0].ant;
    r.queenDmg = {};
    q.hurt(3, 0, 0, me);
    for (let i = 0; i < 600; i++) for (const k in r.queenDmg) r.queenDmg[k] *= QDMG_FADE;
    // she starves a little (logged as no one's), then dies
    const f = r.food; r.food = 0; r.update(); r.food = f;
    const hunger = r.queenDmg[-1] > 0;
    q.hp = 0;
    for (let i = 0; i < 5; i++) stepSim();
    drainEvents();
    return { hunger, defeated: r.defeated, slain: r.slain, score: G.colony.score };
  });
  check('a faded bite does not make a starved red queen slain by us', qs.hunger && qs.defeated && !qs.slain, qs);

  // the HUD in Norwegian, for review
  await page.evaluate(() => { setLang(true); G.msgs = []; });
  await shot('hud-no');
  await page.evaluate(() => { setLang(false); });

  check('no page errors', errors.length === 0, errors);
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  await browser.close();
  process.exitCode = fails.length ? 1 : 0;
})();
