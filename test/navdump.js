// Inspect nav/watchdog internals of stuck foragers.
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
    const pa = G.players[0].ant;
    if (pa) { pa.x = G.colony.junction.x; pa.y = G.colony.junction.y - 20; }
    for (let i = 0; i < 7200; i++) updatePlay(); // 2 min
    const workers = G.ants.filter(a => a.caste === 'worker' && a.playerIdx < 0 && a.hp > 0 && a.state === 'forage');
    log.push('foragers: ' + workers.length);
    for (const w of workers.slice(0, 3)) {
      log.push('ant#' + w.id + ' (' + w.x.toFixed(1) + ',' + w.y.toFixed(1) + ') state=' + w.state +
        ' nav=' + (w.nav ? w.nav.key + ' i=' + w.nav.i + '/' + w.nav.pts.length + ' t=' + w.nav.t : 'NULL') +
        ' navBestKey=' + w.navBestKey + ' navBest=' + (w.navBest && w.navBest.toFixed ? w.navBest.toFixed(1) : w.navBest) +
        ' navStuck=' + w.navStuck +
        ' noProgT=' + w.noProgT + ' gotoBest=' + (w.gotoBest && w.gotoBest.toFixed ? w.gotoBest.toFixed(1) : w.gotoBest) +
        ' blockedT=' + w.blockedT + ' climbing=' + w.climbing);
      const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, w.x)));
      log.push('  surf=' + T.surf[sx] + ' underground=' + (w.y > T.surf[sx] + 12) +
        ' dEnt=' + Math.hypot(w.x - G.colony.entrance.x, w.y - G.colony.entrance.y).toFixed(0));
    }
    // track one for 300 frames
    const w = workers[0];
    if (w) {
      for (let i = 0; i < 300; i++) {
        updatePlay();
        if (i % 60 === 0) log.push('f' + i + ' (' + w.x.toFixed(1) + ',' + w.y.toFixed(1) + ')' +
          ' navStuck=' + w.navStuck + ' navBest=' + (w.navBest ? w.navBest.toFixed(1) : w.navBest) +
          ' noProgT=' + w.noProgT + ' state=' + w.state);
      }
    }
    return log;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
