// State census every 30s of sim: where is the workforce?
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

  for (let block = 0; block < 10; block++) {
    const r = await page.evaluate(() => {
      const pa = G.players[0].ant;
      if (pa) { pa.x = G.colony.junction.x; pa.y = G.colony.junction.y - 20; pa.hp = 30; }
      for (let i = 0; i < 1800 && G.state === 'play'; i++) updatePlay();
      const workers = G.ants.filter(a => a.caste === 'worker' && a.playerIdx < 0 && a.hp > 0);
      const hist = {};
      let inNest = 0, surf = 0;
      for (const w of workers) {
        hist[w.state] = (hist[w.state] || 0) + 1;
        const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, w.x)));
        if (w.y > T.surf[sx] + 12) inNest++; else surf++;
      }
      // detail the foragers on the surface: how far is the nearest item?
      const det = workers.filter(w => w.state === 'forage').slice(0, 8).map(w => {
        let nd = 1e9;
        for (const it of G.items) {
          if (it.dead || it.carried) continue;
          const d = Math.hypot(it.x - w.x, it.y - w.y);
          if (d < nd) nd = d;
        }
        return (w.x | 0) + ',' + (w.y | 0) + ':' + (nd | 0);
      });
      return {
        t: (G.tick / DAY_LEN).toFixed(2), state: G.state,
        food: Math.round(G.colony.food), dep: Math.round(G.colony.stats.foodGathered),
        hist, under: inNest, surf,
        items: G.items.filter(i => !i.dead && !i.carried).length,
        foragersNearestItem: det,
      };
    });
    console.log(JSON.stringify(r));
    if (r.state !== 'play') break;
  }
  await browser.close();
})();
