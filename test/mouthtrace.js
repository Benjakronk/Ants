// Find the most-stalled NPC worker after a few minutes; dump terrain + intents.
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
    log.push('entrance ' + G.colony.entrance.x + ',' + G.colony.entrance.y +
      ' storage ' + G.colony.storage.x + ',' + G.colony.storage.y);
    // run 1.5 days, then measure movement over the next 30s
    for (let i = 0; i < DAY_LEN * 1.5 && G.state === 'play'; i++) updatePlay();
    const kinds = {};
    for (const it of G.items) kinds[it.kind] = (kinds[it.kind] || 0) + 1;
    log.push('items by kind: ' + JSON.stringify(kinds));
    const pos0 = {};
    for (const w of G.ants) if (w.playerIdx < 0) pos0[w.id] = { x: w.x, y: w.y, st: w.state };
    for (let i = 0; i < 1800 && G.state === 'play'; i++) updatePlay();
    let worst = null, wd = 1e9;
    for (const w of G.ants) {
      if (w.playerIdx >= 0 || w.caste === 'queen' || !pos0[w.id]) continue;
      const p = pos0[w.id];
      const moved = Math.hypot(w.x - p.x, w.y - p.y);
      log.push('  #' + w.id + ' ' + w.caste + ' ' + w.state +
        ' at ' + (w.x | 0) + ',' + (w.y | 0) +
        ' moved30s=' + moved.toFixed(0) +
        ' carry=' + (w.carry ? w.carry.kind : '-') +
        ' surf=' + T.surf[Math.floor(Math.max(0, Math.min(WORLD_W - 1, w.x)))]);
      if (moved < wd) { wd = moved; worst = w; }
    }
    if (!worst) { log.push('no npc found'); return log; }
    const a = worst;
    log.push('dep=' + Math.round(G.colony.stats.foodGathered) +
      ' food=' + Math.round(G.colony.food));
    log.push('stalled ant#' + a.id + ' ' + a.caste + ' state=' + a.state +
      ' (was ' + pos0[a.id].st + ') moved30s=' + wd.toFixed(1) +
      ' at ' + a.x.toFixed(1) + ',' + a.y.toFixed(1) +
      ' surfHere=' + T.surf[Math.floor(a.x)] +
      ' carry=' + (a.carry ? a.carry.kind : 'no') +
      ' nav=' + (a.nav ? a.nav.key + ' i=' + a.nav.i + '/' + a.nav.pts.length : 'none') +
      ' target=' + (a.target ? (a.target.x | 0) + ',' + (a.target.y | 0) : 'none'));
    const X = Math.round(a.x), Y = Math.round(a.y);
    for (let dy = -14; dy <= 14; dy++) {
      let row = '';
      for (let dx = -22; dx <= 22; dx++) {
        if (dx === 0 && dy === 0) { row += '@'; continue; }
        row += '.1R3W5'[T.get(X + dx, Y + dy)] || '?';
      }
      log.push(String(Y + dy).padStart(4) + ' ' + row);
    }
    for (let i = 0; i < 90; i++) {
      updatePlay();
      if (i % 6 === 0) log.push('f' + i + ' pos ' + a.x.toFixed(1) + ',' + a.y.toFixed(1) +
        ' vx=' + a.vx.toFixed(2) + ' vy=' + a.vy.toFixed(2) +
        ' climb=' + a.climbing + ' ceil=' + a.ceiling +
        ' blocked=' + a.blocked + ' bT=' + a.blockedT + ' onG=' + a.onGround +
        ' navStuck=' + (a.navStuck || 0) + ' burrow=' + (a.burrowT || 0) +
        ' noProg=' + (a.noProgT || 0) + ' state=' + a.state);
    }
    return log;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
