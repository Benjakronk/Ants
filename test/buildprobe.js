// Headless probe for building and chambers: soil loads, packed earth and
// thatch, chamber marking, capacity, and saves (v3 round-trip + old v2).
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

  // test helpers, installed in the page. Scripted steps run with the game
  // paused (G.state 'pause') so the frame loop doesn't step the sim too.
  await page.evaluate(() => {
    // n ticks with the given held input
    window.simN = (n, held) => {
      const p = G.players[0];
      for (let i = 0; i < n; i++) { Object.assign(p.input, held || {}); stepSim(); drainEvents(); }
      p.input = newInput();
    };
    // a clean test room: a block of dirt with an air ellipse dug out of it
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
    window.countMat = (mat, cx, cy, r) => {
      let n = 0;
      for (let y = Math.floor(cy - r); y <= cy + r; y++) {
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && T.get(x, y) === mat) n++;
        }
      }
      return n;
    };
    // the player's ant, standing on the room floor at (x, cy)
    window.standIn = (x, cy, dir) => {
      const a = G.players[0].ant;
      a.x = x; a.y = cy + 6; a.vx = 0; a.vy = 0; a.dir = dir || 1;
      a.climbing = a.ceiling = false; a.carry = null;
      simN(30);
      a.dir = dir || 1;
      return a;
    };
    // the test site: well away from the nest, deep underground
    const c = G.colony;
    window.ROOM = { x: c.x - 420, y: T.surf[c.x - 420] + 140 };
    G.state = 'pause';
  });

  // --- digging fills the soil load (players only) ---
  const dig = await page.evaluate(() => {
    makeRoom(ROOM.x, ROOM.y, 34, 14);
    const a = standIn(ROOM.x + 24, ROOM.y, 1);
    a.soil = 0; a.thatch = 0;
    const npc = G.ants.find(o => o.playerIdx < 0 && o.caste === 'worker');
    const npcSoil = npc.soil;
    simN(40, { dx: 1, bite: true });
    return { soil: a.soil, cap: LOAD_CAP, npcSoil: npc.soil - npcSoil };
  });
  check('digging gives soil', dig.soil > 0 && dig.soil <= dig.cap, dig);
  check('NPCs collect nothing', dig.npcSoil === 0);

  // --- F places packed earth: solid, from the load, several bites to break ---
  const build = await page.evaluate(() => {
    makeRoom(ROOM.x, ROOM.y, 34, 14);
    const a = standIn(ROOM.x, ROOM.y, 1);
    a.soil = 100;
    G.players[0].buildMat = M_PACKED;
    const { bx, by } = aimPoint(a, 0, 0);
    const before = countMat(M_PACKED, bx, by, 4);
    simN(1, { build: true });
    const placed = countMat(M_PACKED, bx, by, 4) - before;
    const r = { placed, soilUsed: 100 - a.soil, solid: T.solid(Math.round(bx), Math.round(by)) };
    // worker bites until the blob is gone
    const counts = [];
    for (let k = 0; k < 6 && countMat(M_PACKED, bx, by, 4) > 0; k++) {
      a.biteCd = 0;
      simN(1, { bite: true });
      counts.push(countMat(M_PACKED, bx, by, 4));
    }
    r.workerBites = counts.length;
    r.counts = counts;
    // a soldier's bite is stronger: two bites
    T.place(bx, by, BUILD_R, M_PACKED, null, 100);
    const s1 = T.dig(bx, by, CASTE.soldier.digR, CASTE.soldier.digPow).worn;
    const s2 = countMat(M_PACKED, bx, by, 4);
    T.dig(bx, by, CASTE.soldier.digR, CASTE.soldier.digPow);
    r.soldier = [s1 > 0, s2 > 0, countMat(M_PACKED, bx, by, 4) === 0];
    return r;
  });
  check('F places packed earth', build.placed > 0 && build.solid, build);
  check('one load unit per pixel', build.soilUsed === build.placed);
  check('packed earth takes 3 worker bites', build.workerBites === 3 &&
    build.counts[0] === build.placed && build.counts[1] === build.placed && build.counts[2] === 0, build.counts);
  check('packed earth takes 2 soldier bites', build.soldier.every(Boolean), build.soldier);

  // --- empty load: nothing placed, one message ---
  const empty = await page.evaluate(() => {
    makeRoom(ROOM.x, ROOM.y, 34, 14);
    const a = standIn(ROOM.x, ROOM.y, 1);
    a.soil = 0;
    const { bx, by } = aimPoint(a, 0, 0);
    G.msgs = [];
    simN(40, { build: true });
    return { placed: countMat(M_PACKED, bx, by, 4), msgs: G.msgs.map(m => m.text) };
  });
  check('empty load places nothing, warns once', empty.placed === 0 &&
    empty.msgs.filter(m => m === 'NO SOIL - DIG FIRST').length === 1, empty);

  // --- R cycles the material (real key presses) ---
  await page.evaluate(() => { G.state = 'play'; G.players[0].buildMat = M_PACKED; });
  await page.keyboard.press('r');
  await page.waitForTimeout(120);
  const mat1 = await page.evaluate(() => G.players[0].buildMat === M_THATCH);
  await page.keyboard.press('r');
  await page.waitForTimeout(120);
  const mat2 = await page.evaluate(() => G.players[0].buildMat === M_GATE);
  await page.keyboard.press('r');
  await page.waitForTimeout(120);
  const mat3 = await page.evaluate(() => G.players[0].buildMat === M_PACKED);
  check('R cycles packed earth -> thatch -> gate -> packed earth', mat1 && mat2 && mat3);
  await page.evaluate(() => { G.state = 'pause'; });

  // --- thatch: one bite, and the bite gives thatch back ---
  const thatch = await page.evaluate(() => {
    makeRoom(ROOM.x, ROOM.y, 34, 14);
    const a = standIn(ROOM.x, ROOM.y, -1);
    a.thatch = 60;
    G.players[0].buildMat = M_THATCH;
    const { bx, by } = aimPoint(a, 0, 0);
    simN(1, { build: true });
    const placed = countMat(M_THATCH, bx, by, 4);
    const left = a.thatch;
    a.biteCd = 0;
    simN(1, { bite: true });
    G.players[0].buildMat = M_PACKED;
    return { placed, after: countMat(M_THATCH, bx, by, 4), got: a.thatch - left };
  });
  check('thatch builds and breaks in one bite, refunding thatch',
    thatch.placed > 0 && thatch.after === 0 && thatch.got >= thatch.placed, thatch);

  // --- building never buries anyone ---
  const bury = await page.evaluate(() => {
    makeRoom(ROOM.x, ROOM.y, 34, 14);
    const a = standIn(ROOM.x, ROOM.y, 1);
    const { bx, by } = aimPoint(a, 0, 0);
    const w = G.ants.find(o => o.playerIdx < 0 && o.caste === 'worker');
    // (a teleported ant drops whatever climb it was in: climbers may hug a
    // wall a pixel deep, which the box test below would misread as buried)
    w.x = bx + 1; w.y = by - 1; w.vx = w.vy = 0; w.state = 'idle'; w.stateT = 9999; w.nav = null;
    w.climbing = w.ceiling = false; w.climbT = w.crotchT = w.burrowT = 0;
    if (w.carry) { w.carry.carried = null; w.carry = null; }
    const larva = new Brood(bx - 1, by - 2, 'larva');
    G.brood.push(larva);
    const bug = new Bug(bx, by - 4, 'pillbug');
    G.bugs.push(bug);
    simN(20);   // everyone settles onto the floor first
    const clearBefore = [a, w, larva, bug].every(e => !T.boxSolid(e.x, e.y, e.hw, e.hh));
    let buried = [];
    for (let i = 0; i < 40; i++) {
      a.soil = 100;
      simN(1, { build: true });
      for (const e of [a, w, larva, bug]) {
        if (!e.dead && T.boxSolid(e.x, e.y, e.hw, e.hh)) {
          buried.push(e.kind + (e === a ? '(player)' : '') + (e.climbing ? '(climbing)' : '') + '@' + i);
        }
      }
    }
    // nothing lands outside the world
    const outside = T.place(-20, -20, 4, M_PACKED, null, 100) + T.place(WORLD_W + 10, 100, 4, M_PACKED, null, 100);
    larva.hp = 0; bug.hp = 0;
    w.state = 'idle'; w.stateT = 60;
    return { clearBefore, buried, outside };
  });
  check('build never buries an ant, brood or bug', bury.clearBefore && bury.buried.length === 0, bury.buried.slice(0, 5));
  check('nothing placed outside the world', bury.outside === 0);

  // --- the surface line rises when building on top of the ground ---
  const surf = await page.evaluate(() => {
    let x = ROOM.x + 200;
    while (T.get(x, T.surf[x] - 8) !== M_AIR || T.get(x, T.surf[x] - 1) === M_WOOD) x++;  // open sky
    const s0 = T.surf[x];
    T.place(x, s0 - 3, 2.5, M_PACKED, null, 100);
    const s1 = T.surf[x];
    T.dig(x, s1 + 2, 6, 9);   // bite it away again, hard
    return { s0, s1, s2: T.surf[x] };
  });
  check('surface rises over built earth (and drops when dug)', surf.s1 < surf.s0 && surf.s2 >= surf.s0, surf);

  // --- X creates a storage chamber and cycles it; capacity follows ---
  const pre = await page.evaluate(() => {
    makeRoom(ROOM.x, ROOM.y, 34, 14);
    standIn(ROOM.x, ROOM.y, 1);
    G.colony.recalcChambers();
    G.state = 'play';
    return { n: G.colony.chambers.length, caps: Object.assign({}, G.colony.caps) };
  });
  const seq = [];
  for (let k = 0; k < 7; k++) {
    await page.keyboard.press('x');
    await page.waitForTimeout(120);
    seq.push(await page.evaluate(() => {
      const a = G.players[0].ant;
      const ch = G.colony.chamberNear(a.x, a.y, CH_NEAR);
      return { n: G.colony.chambers.length, type: ch ? ch.type : null, area: ch ? ch.area : 0,
        caps: Object.assign({}, G.colony.caps) };
    }));
  }
  await page.evaluate(() => { G.state = 'pause'; });
  check('X creates a storage chamber', seq[0].n === pre.n + 1 && seq[0].type === 'storage' && seq[0].area >= 250, seq[0]);
  check('X cycles storage -> nursery -> barracks -> royal -> fungus -> removed -> storage',
    seq.map(s => s.type || 'null').join(',') === 'storage,nursery,barracks,royal,fungus,null,storage',
    seq.map(s => s.type));
  check('storage area raises food capacity', seq[0].caps.food > pre.caps.food + 50,
    [pre.caps.food, seq[0].caps.food]);
  check('nursery area raises brood + population caps', seq[1].caps.brood > pre.caps.brood &&
    seq[1].caps.pop > pre.caps.pop, [pre.caps.brood, seq[1].caps.brood, pre.caps.pop, seq[1].caps.pop]);
  check('barracks area raises population cap + soldier share', seq[2].caps.pop > pre.caps.pop &&
    seq[2].caps.soldiers > pre.caps.soldiers);
  check('royal area speeds up egg laying', seq[3].caps.eggT < pre.caps.eggT, [pre.caps.eggT, seq[3].caps.eggT]);
  // (NPCs digging in the nest meanwhile may shift the other areas a little)
  check('removing the marker restores capacity', Math.abs(seq[5].caps.food - pre.caps.food) <= 8,
    [pre.caps.food, seq[5].caps.food]);

  const more = await page.evaluate(() => {
    // NPC path-digging inside the chamber claims nothing: capacity holds
    const food0 = G.colony.caps.food;
    for (let x = -40; x <= 40; x += 4) T.dig(ROOM.x + x, ROOM.y + 14, 5, 9);
    G.colony.recalcChambers();
    const foodNpc = G.colony.caps.food;
    // a player digging the chamber out bigger claims the room (as
    // controlPlayer does): capacity grows with the area
    for (let x = -40; x <= 40; x += 4) {
      const res = T.dig(ROOM.x + x, ROOM.y - 14, 5, 9);
      G.colony.claimDug(ROOM.x + x, ROOM.y - 14, res.natural);
    }
    G.colony.recalcChambers();
    const food1 = G.colony.caps.food;
    // the generated anchors cycle but never disappear, and the last royal stays
    const c = G.colony;
    const st = c.chambers.find(ch => ch.anchor && ch.type === 'storage');
    const a = G.players[0].ant;
    const ax = a.x, ay = a.y;
    const tryMark = (ch, n) => { a.x = ch.x; a.y = ch.y; for (let i = 0; i < n; i++) c.markChamber(a, 0); };
    tryMark(st, 4);
    const anchorKept = c.chambers.includes(st) && st.type === 'storage';
    const royals = c.chambers.filter(ch => ch.type === 'royal');
    tryMark(royals[0], 1);
    const royalKept = c.chambers.filter(ch => ch.type === 'royal').length === 1;
    // marking near the surface or in a tiny pocket does nothing
    const n0 = c.chambers.length;
    a.x = ax + 300; a.y = T.bgSurf[Math.round(ax + 300)] + 10; c.markChamber(a, 0);
    makeRoom(ROOM.x + 150, ROOM.y + 60, 5, 3);
    a.x = ROOM.x + 150; a.y = ROOM.y + 60; c.markChamber(a, 0);
    const noJunk = c.chambers.length === n0;
    a.x = ax; a.y = ay;
    simN(5);
    return { food0, foodNpc, food1, anchorKept, royalKept, noJunk, msgs: G.msgs.map(m => m.text) };
  });
  check('NPC digging in a chamber leaves its capacity alone', more.foodNpc === more.food0,
    [more.food0, more.foodNpc]);
  check('a player digging a chamber bigger raises its capacity', more.food1 > more.foodNpc,
    [more.foodNpc, more.food1]);
  check('generated anchors cycle but are never removed', more.anchorKept);
  check('the last royal chamber is kept', more.royalKept);
  check('no marker near the surface or in a cramped pocket', more.noJunk, more.msgs);

  // --- full stores refuse deposits; any storage marker takes food ---
  const dep = await page.evaluate(() => {
    const a = G.players[0].ant, col = G.colony;
    const seed = G.makeItem('seed', a.x, a.y);
    G.items.push(seed); seed.carried = a; a.carry = seed;
    col.food = col.caps.food;
    G.msgs = [];
    G.players[0].input.act = true; stepSim(); drainEvents();
    const refused = a.carry === seed && G.msgs.some(m => m.text.startsWith('STORAGE FULL'));
    // a second E straight after a refusal puts the item down instead
    G.players[0].input.act = true; stepSim(); drainEvents();
    const droppedOnRetry = !a.carry && !seed.dead;
    seed.carried = a; a.carry = seed;
    G.players[0].refuseT = 0;
    col.food = 10;
    G.players[0].input.act = true; stepSim(); drainEvents();
    return { refused, droppedOnRetry, deposited: !a.carry && col.food > 14,
      farFromMain: Math.hypot(a.x - col.storage.x, a.y - col.storage.y) > 100 };
  });
  check('full stores refuse a deposit (item kept)', dep.refused);
  check('E again after a refusal drops the item', dep.droppedOnRetry);
  check('food deposits at a player-marked storage chamber', dep.deposited && dep.farFromMain, dep);

  // screenshot: chamber sign, label and the new HUD
  await page.evaluate(() => {
    const a = G.players[0].ant;
    a.soil = 70; a.thatch = 25;
    T.place(a.x + 12, a.y - 6, 3, M_PACKED, buildClear(a.x + 12, a.y - 6, 3), 100);
    T.place(a.x - 14, a.y - 6, 3, M_THATCH, buildClear(a.x - 14, a.y - 6, 3), 100);
    G.cam.fx = undefined;
    G.state = 'play';
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'test/shot-build.png' });
  await page.keyboard.press('m');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test/shot-build-map.png' });
  await page.keyboard.press('m');

  // --- save / load round-trips chambers, loads and wear ---
  const saved = await page.evaluate(() => {
    G.state = 'pause';
    const a = G.players[0].ant;
    a.soil = 37; a.thatch = 12;
    G.players[0].buildMat = M_THATCH;
    // a packed blob with one bite of wear in it
    const bx = ROOM.x + 20, by = ROOM.y;
    T.place(bx, by, BUILD_R, M_PACKED, null, 100);
    T.dig(bx, by, 4, 1);
    window.BLOB = { x: bx, y: by };
    // a mound built on the ground raises the surface line; it must persist
    const sx = ROOM.x + 300;
    T.place(sx, T.surf[sx] - 3, 4, M_PACKED, null, 100);
    window.surfSum = () => { let h = 0; for (let x = 0; x < WORLD_W; x++) h = (h * 31 + T.surf[x]) | 0; return h; };
    const surfHash = surfSum();
    const ok = saveWorld(1);
    const d = JSON.parse(localStorage.getItem('maur_world_1'));
    return {
      ok, v: d.v,
      chambers: G.colony.chambers.map(c => [c.id, c.type, c.x, c.y].join(':')),
      packed: countMat(M_PACKED, bx, by, 4), wear: T.wear.size, surfHash,
    };
  });
  const loaded = await page.evaluate(() => {
    G.running = false;
    const ok = startSavedWorld(1);
    G.state = 'pause';
    const a = G.players[0].ant;
    return {
      ok,
      chambers: G.colony.chambers.map(c => [c.id, c.type, c.x, c.y].join(':')),
      soil: a.soil, thatch: a.thatch, mat: G.players[0].buildMat === M_THATCH,
      packed: countMat(M_PACKED, BLOB.x, BLOB.y, 4), wear: T.wear.size,
      caps: G.colony.caps, surfHash: surfSum(),
    };
  });
  check('save is version 5', saved.ok && saved.v === 5, saved.v);
  check('chambers round-trip', loaded.ok && loaded.chambers.join() === saved.chambers.join(), loaded.chambers);
  check('loads round-trip', loaded.soil === 37 && loaded.thatch === 12 && loaded.mat);
  check('packed earth and its wear round-trip', loaded.packed === saved.packed && loaded.packed > 0 &&
    loaded.wear === saved.wear && loaded.wear > 0, [saved.packed, loaded.packed, saved.wear, loaded.wear]);
  check('capacity recomputed on load', loaded.caps && loaded.caps.food > 0);
  check('surface line round-trips', loaded.surfHash === saved.surfHash);

  // --- an old v2 save (no chambers, loads or wear) still loads ---
  const v2 = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('maur_world_1'));
    // (an old save had one colony: the players')
    d.v = 2; d.colony = d.colonies[0]; delete d.colonies;
    d.ants = d.ants.filter(s => !s.col); d.brood = d.brood.filter(s => !s.col);
    delete d.colony.chambers; delete d.colony.nextChamberId;
    delete d.wear; delete d.buildMats; delete d.surf;
    for (const s of d.ants) { delete s.soil; delete s.thatch; }
    localStorage.setItem('maur_world_2', JSON.stringify(d));
    G.running = false;
    const ok = startSavedWorld(2);
    G.state = 'pause';
    simN(120);
    const a = G.players[0].ant;
    return {
      ok, types: G.colony.chambers.map(c => c.type).sort(),
      soil: a ? a.soil : -1, caps: G.colony.caps, food: G.colony.food,
    };
  });
  check('v2 save loads with generated chambers', v2.ok &&
    ['nursery', 'royal', 'storage'].every(t => v2.types.includes(t)), v2.types);
  check('v2 save: loads default to 0, capacity sane', v2.soil === 0 &&
    v2.caps.food >= 100 && v2.caps.food <= 220 && v2.caps.brood >= 4 && isFinite(v2.food), v2.caps);

  // the generated nest's starting capacity matches the old hard limits
  const fresh = await page.evaluate(() => {
    G.running = false;
    deleteWorld(3);
    startNewWorld(3);
    G.state = 'pause';
    return { caps: G.colony.caps, chambers: G.colony.chambers.map(c => c.type + ':' + c.area) };
  });
  console.log('  fresh nest:', JSON.stringify(fresh));
  check('fresh nest capacity ~ old limits', fresh.caps.food >= 110 && fresh.caps.food <= 200 &&
    fresh.caps.brood >= 5 && fresh.caps.brood <= 9 && fresh.caps.pop >= 15 && fresh.caps.pop <= 32);

  console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  await browser.close();
  process.exit(errors.length || fails.length ? 1 : 0);
})();
