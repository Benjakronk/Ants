// Headless probe: wall-free underground climbing, hop clamp, cave riches.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const fails = [];
  const check = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); if (!ok) fails.push(name); };

  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(url);
  await page.waitForTimeout(600);
  await page.evaluate(() => localStorage.clear());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);

  // --- worldgen riches exist ---
  const mats = await page.evaluate(() => {
    let fungus = 0, crystal = 0;
    for (let i = 0; i < T.m.length; i++) {
      if (T.m[i] === M_FUNGUS) fungus++;
      else if (T.m[i] === M_CRYSTAL) crystal++;
    }
    return { fungus, crystal };
  });
  check('fungus generated', mats.fungus > 100);
  check('crystals generated', mats.crystal > 50);
  console.log('  pixels:', JSON.stringify(mats));

  // --- wall-free climbing in a dug-out cavern ---
  const cavern = await page.evaluate(() => {
    // carve a huge chamber below the junction: no walls anywhere near
    const c = G.colony.junction;
    const cx = c.x, cy = c.y + 120;
    for (let r = 0; r < 6; r++) T.dig(cx + (r % 3 - 1) * 30, cy + (r / 3 | 0) * 30 - 15, 28);
    const a = G.players[0].ant;
    a.x = cx; a.y = cy + 20; a.vy = 0;
    return { y: a.y, underground: underground(a) };
  });
  check('cavern spot is underground', cavern.underground);
  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
  await page.keyboard.up('w');
  const climbed = await page.evaluate(() => G.players[0].ant.y);
  check('player climbs without walls underground', climbed < cavern.y - 25);
  console.log('  climb: y', cavern.y.toFixed(0), '->', climbed.toFixed(0));

  // --- NPC climbs without walls underground (goto upward in open chamber) ---
  const npc = await page.evaluate(async () => {
    const c = G.colony.junction;
    const w = G.ants.find(a => a.playerIdx < 0 && a.caste === 'worker');
    w.x = c.x; w.y = c.y + 140; w.vy = 0; w.state = 'idle'; w.stateT = 9999;
    const startY = w.y;
    return new Promise(res => {
      let n = 0;
      const t = setInterval(() => {
        w.state = 'idle'; w.stateT = 9999; // keep the state machine quiet
        w.goto(c.x, c.y + 60, true);       // target 80px straight up, no walls
        if (++n >= 150) { clearInterval(t); res({ startY, endY: w.y }); }
      }, 16);
    });
  });
  check('NPC climbs without walls underground', npc.endY < npc.startY - 25);
  console.log('  npc climb: y', npc.startY.toFixed(0), '->', npc.endY.toFixed(0));

  // --- hop clamp: no super-launches ---
  const clampOk = await page.evaluate(() => {
    const a = G.players[0].ant;
    a.vy = -12; // something has flung the ant
    physStep(a);
    return a.vy >= -2.7;
  });
  check('upward velocity clamped', clampOk);

  // --- crystal: dig drops an item, depositing scores ---
  const dug = await page.evaluate(() => {
    // find a crystal pixel and dig it out via the harvest path
    let cxp = -1, cyp = -1;
    outer: for (let y = 0; y < WORLD_H; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        if (T.m[y * WORLD_W + x] === M_CRYSTAL) { cxp = x; cyp = y; break outer; }
      }
    }
    const res = T.dig(cxp, cyp, 4);
    return { found: cxp >= 0, crystals: res.crystals };
  });
  check('digging a vein reports crystals', dug.found && dug.crystals > 1);

  const score = await page.evaluate(() => {
    const a = G.players[0].ant;
    const before = G.colony.score;
    const it = G.makeItem('crystal', a.x, a.y);
    G.items.push(it);
    it.carried = a; a.carry = it;
    G.colony.deposit(it, a);
    return { before, after: G.colony.score, carryCleared: !a.carry, msg: G.msgs.map(m => m.text).pop() };
  });
  check('crystal deposit scores +80', score.after === score.before + 80 && score.carryCleared);
  console.log('  msg:', score.msg);

  // --- crystal task translates ---
  const t = await page.evaluate(() => taskText({ type: 'crystal' }));
  check('crystal task text', t === 'FIND A CRYSTAL BELOW');

  // --- fungus item is food ---
  check('fungus is food', await page.evaluate(() => ITEM_DEF.fungus.food === true && ITEM_DEF.fungus.value === 12));

  console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  await browser.close();
  process.exit(errors.length || fails.length ? 1 : 0);
})();
