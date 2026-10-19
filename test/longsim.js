// Fast-forward 3 in-game days without rendering; check colony balance.
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

  for (let day = 0; day < 3; day++) {
    const r = await page.evaluate(() => {
      const log = [];
      // park the player ant safely in the nest so it doesn't skew survival
      const a = G.players[0].ant;
      if (a) { a.x = G.colony.junction.x; a.y = G.colony.junction.y; }
      const QUARTER = DAY_LEN / 4;
      for (let q = 0; q < 4; q++) {
        for (let i = 0; i < QUARTER && G.state === 'play'; i++) updatePlay();
        log.push({
          t: (G.tick / DAY_LEN).toFixed(2),
          state: G.state,
          food: Math.round(G.colony.food),
          ants: G.colony.members().length,
          brood: G.colony.broodCount(),
          red: G.rival.members().length + '/' + Math.round(G.rival.food) + (G.rival.raid ? ' RAID' : ''),
          items: G.items.length,
          bugs: G.bugs.map(b => b.kind).join(','),
          carrying: G.ants.filter(x => x.carry).length,
          deposits: Math.round(G.colony.stats.foodGathered),
          died: G.colony.stats.antsDied,
          born: G.colony.stats.antsBorn,
          msgs: G.msgs.map(m => m.text),
        });
      }
      return log;
    });
    for (const row of r) console.log(JSON.stringify(row));
    if (r.some(x => x.state !== 'play')) { console.log('LEFT PLAY STATE'); break; }
  }
  await browser.close();
})();
