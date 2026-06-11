// Run ~1.5 days, then dump every carrying ant's nav state + local terrain.
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
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);

  const out = await page.evaluate(() => {
    const log = [];
    const pa = G.players[0].ant;
    if (pa) { pa.x = G.colony.junction.x; pa.y = G.colony.junction.y; }
    // 1.5 days
    for (let i = 0; i < DAY_LEN * 1.5 && G.state === 'play'; i++) updatePlay();
    log.push('tick=' + G.tick + ' food=' + Math.round(G.colony.food) +
      ' deposits=' + Math.round(G.colony.stats.foodGathered) +
      ' items=' + G.items.length);
    // snapshot carriers over 20s to see if they move
    const pos0 = {};
    for (const a of G.ants) if (a.carry) pos0[a.id] = { x: a.x, y: a.y };
    for (let i = 0; i < 1200 && G.state === 'play'; i++) updatePlay();
    for (const a of G.ants) {
      if (!a.carry || a.playerIdx >= 0) continue;
      const p0 = pos0[a.id];
      const moved = p0 ? Math.hypot(a.x - p0.x, a.y - p0.y).toFixed(1) : 'new';
      const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, a.x)));
      log.push('ant#' + a.id + ' ' + a.caste + ' state=' + a.state +
        ' at ' + a.x.toFixed(0) + ',' + a.y.toFixed(0) +
        ' surfY=' + T.surf[sx] +
        ' moved20s=' + moved +
        ' carry=' + a.carry.kind +
        ' nav=' + (a.nav ? a.nav.key + ' i=' + a.nav.i + '/' + a.nav.pts.length : 'none') +
        ' navStuck=' + (a.navStuck || 0) +
        ' blockedT=' + a.blockedT + ' noProgT=' + (a.noProgT || 0) +
        ' climbing=' + a.climbing + ' ceiling=' + a.ceiling + ' onGround=' + a.onGround);
      if (p0 && Math.hypot(a.x - p0.x, a.y - p0.y) < 6) {
        const X = Math.round(a.x), Y = Math.round(a.y);
        for (let dy = -8; dy <= 8; dy++) {
          let row = '';
          for (let dx = -24; dx <= 24; dx++) {
            if (dx === 0 && dy === 0) { row += '@'; continue; }
            row += '.1R3W5'[T.get(X + dx, Y + dy)] || '?';
          }
          log.push(String(Y + dy).padStart(5) + ' ' + row);
        }
      }
    }
    // also count states across all ants
    const states = {};
    for (const a of G.ants) states[a.state] = (states[a.state] || 0) + 1;
    log.push('states: ' + JSON.stringify(states));
    log.push('storage: ' + G.colony.storage.x + ',' + G.colony.storage.y);
    return log;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
