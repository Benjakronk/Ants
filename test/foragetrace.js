// Trace forager state machines to find why food never reaches the storage chamber.
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
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);

  const out = await page.evaluate(() => {
    const log = [];
    const a = G.players[0].ant;
    if (a) { a.x = G.colony.junction.x; a.y = G.colony.junction.y; }
    const st = G.colony.storage;
    log.push('storage at ' + st.x + ',' + st.y + ' entrance ' + G.colony.entrance.x + ',' + G.colony.entrance.y);
    for (let block = 0; block < 24; block++) {
      for (let i = 0; i < 600; i++) updatePlay();
      const workers = G.ants.filter(x => x.caste === 'worker' && x.playerIdx < 0 && x.hp > 0);
      const row = workers.slice(0, 6).map(w =>
        w.state.substr(0, 4) + '(' + (w.x | 0) + ',' + (w.y | 0) + ')'
        + (w.carry ? '*' : '') + 'bT' + w.blockedT
        + 'dSt' + (Math.hypot(w.x - st.x, w.y - st.y) | 0));
      log.push('t' + (G.tick / 60 | 0) + 's food=' + (G.colony.food | 0)
        + ' dep=' + (G.colony.stats.foodGathered | 0) + ' | ' + row.join(' '));
      if (G.state !== 'play') { log.push('LEFT PLAY: ' + G.state); break; }
    }
    return log;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
