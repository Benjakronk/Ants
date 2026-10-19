// Headless probe for the caste-ability / switching / split-screen features.
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

  // boot a fresh 1P world
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);

  // --- live switch: Tab opens the type menu, Esc cancels, Enter switches ---
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  const sw = await page.evaluate(() => ({
    state: G.state, swap: !!(G.takeover && G.takeover.live),
    types: G.takeover ? G.takeover.types.map(t => t.caste) : [],
  }));
  check('switch menu opens with types', sw.state === 'play' && sw.swap && sw.types.length >= 3);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('switch menu cancels', await page.evaluate(() => G.state === 'play' && !G.takeover));

  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowDown'); // soldier
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const sw2 = await page.evaluate(() => ({
    state: G.state, caste: G.players[0].ant.caste,
    npcCount: G.ants.filter(a => a.playerIdx < 0 && a.hp > 0).length,
  }));
  check('switched to soldier', sw2.state === 'play' && sw2.caste === 'soldier');
  console.log('  npc ants after switch:', sw2.npcCount);

  // --- soldier rally: plant a spider next to the soldier, press Q ---
  await page.evaluate(() => {
    const a = G.players[0].ant;
    const s = new Bug(a.x + 30, a.y - 10, 'spider');
    G.bugs.push(s);
    // park two workers in range
    let n = 0;
    for (const w of G.ants) {
      if (w.playerIdx < 0 && w.caste === 'worker' && n < 2) { w.x = a.x - 20; w.y = a.y; w.carry = null; n++; }
    }
  });
  await page.keyboard.press('q');
  await page.waitForTimeout(300);
  const rally = await page.evaluate(() => ({
    cd: G.players[0].ant.abilCd,
    fighters: G.ants.filter(a => a.playerIdx < 0 && a.state === 'fight' && a.rallyT > 0).length,
    msgs: G.msgs.map(m => m.text),
  }));
  check('rally set cooldown + rallied ants', rally.cd > 0 && rally.fighters >= 1);
  console.log('  rally:', JSON.stringify(rally));

  // soldier stats
  const stats = await page.evaluate(() => ({ dmg: CASTE.soldier.dmg, digR: CASTE.soldier.digR }));
  check('soldier buffed', stats.dmg === 14 && stats.digR === 6.5);

  // --- nurse heal: switch to nurse, wound a worker beside her, press Q ---
  await page.evaluate(() => { for (const b of G.bugs) if (b.kind === 'spider') b.hp = 0; });
  await page.waitForTimeout(300);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  const nurseIdx = await page.evaluate(() => G.takeover.types.findIndex(t => t.caste === 'nurse'));
  for (let i = 0; i < nurseIdx; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  check('switched to nurse', await page.evaluate(() => G.players[0].ant.caste === 'nurse'));

  const healRes = await page.evaluate(() => {
    const a = G.players[0].ant;
    const w = G.ants.find(o => o.playerIdx < 0 && o.caste === 'worker');
    w.x = a.x + 8; w.y = a.y; w.hp = 5; w.rallyT = 0; w.state = 'idle';
    G.colony.food = 50;
    return { before: w.hp, id: w.id };
  });
  await page.keyboard.press('q');
  await page.waitForTimeout(200);
  const healed = await page.evaluate((id) => {
    const w = G.ants.find(o => o.id === id);
    return { after: w ? w.hp : -1, cd: G.players[0].ant.abilCd };
  }, healRes.id);
  check('nurse heal works', healed.after >= healRes.before + 9 && healed.cd > 0);
  console.log('  heal: hp', healRes.before, '->', healed.after);

  // --- nurse brood carry: stand on a larva, press E to lift, E to drop ---
  await page.evaluate(() => {
    const a = G.players[0].ant;
    // one no NPC nurse has on its back right now (or a fresh egg)
    let b = G.brood.find(b => !b.dead && !b.carried);
    if (!b) { b = new Brood(a.x, a.y, 'egg'); G.brood.push(b); }
    b.x = a.x + 2; b.y = a.y;
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(150);
  const carrying = await page.evaluate(() => {
    const c = G.players[0].ant.carry;
    return c ? c.kind : null;
  });
  check('nurse picks up brood', carrying === 'egg' || carrying === 'larva');
  await page.waitForTimeout(300);
  const rides = await page.evaluate(() => {
    const a = G.players[0].ant, c = a.carry;
    return c ? Math.abs(c.x - a.x) < 6 && c.y < a.y : false;
  });
  check('brood rides on back', rides);
  await page.keyboard.press('e');
  await page.waitForTimeout(150);
  check('brood drops', await page.evaluate(() => !G.players[0].ant.carry && !G.brood.some(b => b.carried)));

  // --- NPC nurse rescue: predator near nursery sends nurses into rescue ---
  const rescue = await page.evaluate(async () => {
    const col = G.colony;
    G.bugs.push(new Bug(col.nursery.x + 40, col.nursery.y - 10, 'centipede'));
    const nurses = G.ants.filter(a => a.playerIdx < 0 && a.caste === 'nurse');
    for (const n of nurses) { n.state = 'tend'; n.stateT = 400; n.rallyT = 0; n.x = col.nursery.x - 12; n.y = col.nursery.y - 4; }
    // some brood in the nursery to save (the queen lays by her chamber, and
    // a nurse with nothing left to ferry goes back to tending)
    for (const b of G.brood) if (!b.carried) { b.x = col.nursery.x; b.y = col.nursery.y; b.safeT = 0; }
    // every state the nurses pass through in the next 2 s
    const seen = new Set();
    const iv = setInterval(() => {
      for (const a of G.ants) if (a.playerIdx < 0 && a.caste === 'nurse') seen.add(a.state);
    }, 50);
    return new Promise(res => setTimeout(() => { clearInterval(iv); res([...seen]); }, 2000));
  });
  check('NPC nurse enters rescue', rescue.includes('rescue'));
  console.log('  nurse states:', JSON.stringify(rescue));

  console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  await browser.close();
  process.exit(errors.length || fails.length ? 1 : 0);
})();
