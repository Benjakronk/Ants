// Run sim until ants are stuck, then dump terrain + goto internals around one.
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
    if (pa) { pa.x = G.colony.junction.x; pa.y = G.colony.junction.y; }
    // run 60s, snapshot positions every 10s to find a frozen ant
    const hist = {};
    for (let s = 0; s < 6; s++) {
      for (let i = 0; i < 600; i++) updatePlay();
      for (const a of G.ants) {
        if (a.playerIdx >= 0 || a.caste !== 'worker') continue;
        const k = a.id;
        (hist[k] = hist[k] || []).push(Math.round(a.x) + ',' + Math.round(a.y));
      }
    }
    // a worker whose last 3 samples are identical
    let stuck = null;
    for (const a of G.ants) {
      const h = hist[a.id];
      if (h && h.length >= 3 && h[h.length-1] === h[h.length-2] && h[h.length-2] === h[h.length-3]) { stuck = a; break; }
    }
    if (!stuck) { log.push('no frozen worker found'); return log; }
    const a = stuck;
    log.push('stuck: ' + a.state + ' at ' + a.x.toFixed(1) + ',' + a.y.toFixed(1) +
      ' carry=' + !!a.carry + ' nav=' + (a.nav ? a.nav.key + ' i=' + a.nav.i + '/' + a.nav.pts.length + ' t=' + a.nav.t : 'none') +
      ' blockedT=' + a.blockedT + ' climbing=' + a.climbing + ' onGround=' + a.onGround);
    if (a.nav && a.nav.pts[a.nav.i]) {
      const wp = a.nav.pts[a.nav.i];
      log.push('waypoint: ' + wp.x + ',' + wp.y + ' (d=' + Math.hypot(wp.x-a.x, wp.y-a.y).toFixed(1) + ')');
    }
    log.push('colony: entr=' + G.colony.entrance.x + ',' + G.colony.entrance.y +
      ' junc=' + G.colony.junction.x + ',' + G.colony.junction.y +
      ' stor=' + G.colony.storage.x + ',' + G.colony.storage.y +
      ' nurs=' + G.colony.nursery.x + ',' + G.colony.nursery.y);
    const X = Math.round(a.x), Y = Math.round(a.y);
    for (let dy = -10; dy <= 10; dy++) {
      let row = '';
      for (let dx = -20; dx <= 20; dx++) {
        if (dx === 0 && dy === 0) { row += '@'; continue; }
        row += '.1R3W5'[T.get(X + dx, Y + dy)] || '?';
      }
      log.push(String(Y + dy).padStart(4) + ' ' + row);
    }
    // simulate 40 more frames logging movement intents
    for (let i = 0; i < 40; i++) {
      const px = a.x, py = a.y;
      updatePlay();
      if (i % 8 === 0) log.push('f' + i + ' pos ' + a.x.toFixed(1) + ',' + a.y.toFixed(1) +
        ' vx=' + a.vx.toFixed(2) + ' vy=' + a.vy.toFixed(2) + ' blocked=' + a.blocked +
        ' climbing=' + a.climbing + ' bT=' + a.blockedT + ' digCd=' + a.digCd);
    }
    return log;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
