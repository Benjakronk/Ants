// Spawn each new enemy near the colony and watch it behave for a while.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));

  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(500);
  await page.evaluate(() => localStorage.clear());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);

  const out = await page.evaluate(() => {
    const log = [];
    const pa = G.players[0].ant;
    if (pa) { pa.x = G.colony.junction.x; pa.y = G.colony.junction.y; }
    const cx = G.colony.x;
    log.push('world ' + WORLD_W + 'x' + WORLD_H + ' colony at ' + cx +
      ' trees=' + G.trees.length);
    // spawn the new trio near the mound
    G.bugs.push(new Bug(cx - 200, T.surf[cx - 200] - 70, 'wasp'));
    G.bugs.push(new Bug(cx + 250, T.surf[cx + 250] - 8, 'beetle'));
    // and a red raiding party (the rival's own soldiers, see Colony.startRaid)
    const reds = [];
    for (let i = 0; i < 4; i++) {
      const a = new Ant(cx - 320 - i * 8, T.surf[cx - 320] - 8, 'soldier', G.rival);
      a.raiding = true; a.raidRole = 'fight'; a.state = 'raid';
      G.ants.push(a); reds.push(a);
    }
    G.rival.raid = { phase: 'march', t: 0, siege: 0, target: 0, n0: 4, stolen: 0, warned: false, home: 0 };
    const snap = () => {
      const o = {};
      for (const b of G.bugs) {
        if (!['wasp', 'beetle'].includes(b.kind)) continue;
        const k = b.kind;
        (o[k] = o[k] || []).push((b.x | 0) + ',' + (b.y | 0) +
          (b.dead ? ' DEAD' : b.fleeing ? ' flee' : '') + ' hp' + Math.ceil(b.hp));
      }
      o.red = reds.map(a => (a.x | 0) + ',' + (a.y | 0) + (a.hp <= 0 ? ' DEAD' : ' ' + a.state) + ' hp' + Math.ceil(a.hp));
      return JSON.stringify(o);
    };
    for (let s = 0; s < 8; s++) {
      for (let i = 0; i < 600 && G.state === 'play'; i++) updatePlay();
      log.push('t+' + ((s + 1) * 10) + 's ants=' + G.ants.filter(a => a.hp > 0).length +
        ' died=' + G.colony.stats.antsDied +
        ' slain=' + G.colony.stats.predatorsSlain + ' ' + snap());
      if (G.state !== 'play') { log.push('LEFT PLAY: ' + G.state); break; }
    }
    log.push('msgs: ' + G.msgs.map(m => m.text).join(' | '));
    return log;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
