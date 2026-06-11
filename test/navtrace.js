// Real-loop trace: park a worker at the storage chamber in 'forage' state and
// watch it navigate to the entrance via the real updatePlay.
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
    const a = G.ants.find(x => x.caste === 'worker' && x.playerIdx < 0);
    a.x = G.colony.storage.x; a.y = G.colony.storage.y; a.vx = 0; a.vy = 0;
    a.state = 'forage'; a.stateT = 99999; a.nav = null; a.target = null;
    // freeze the others so the picture stays clean
    for (const o of G.ants) if (o !== a && o.playerIdx < 0) { o.state = 'idle'; o.stateT = 99999; }
    const ent = G.colony.entrance;
    log.push('storage=' + G.colony.storage.x + ',' + G.colony.storage.y +
      ' junction=' + G.colony.junction.x + ',' + G.colony.junction.y +
      ' entrance=' + ent.x + ',' + ent.y);
    let surfaced = -1;
    for (let i = 0; i < 3600; i++) {
      updatePlay();
      const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, a.x)));
      if (surfaced < 0 && a.y < T.surf[sx] + 12) { surfaced = i; break; }
      if (i % 120 === 0) {
        const wp = a.nav && a.nav.pts[a.nav.i];
        log.push('f' + i + ' (' + a.x.toFixed(0) + ',' + a.y.toFixed(0) + ')' +
          ' dEnt=' + Math.hypot(a.x - ent.x, a.y - ent.y).toFixed(0) +
          ' navI=' + (a.nav ? a.nav.i + '/' + a.nav.pts.length : '-') +
          (wp ? ' wp=(' + wp.x + ',' + wp.y + ')' : '') +
          ' state=' + a.state + ' bT=' + a.blockedT);
      }
    }
    log.push(surfaced >= 0 ? 'SURFACED at frame ' + surfaced + ' (' + (surfaced / 60).toFixed(1) + 's)'
      : 'NEVER SURFACED in 60s');
    if (surfaced < 0) {
      const X = Math.round(a.x), Y = Math.round(a.y);
      log.push('ant exact: ' + a.x.toFixed(2) + ',' + a.y.toFixed(2) +
        ' vx=' + a.vx.toFixed(2) + ' blocked=' + a.blocked + ' onG=' + a.onGround +
        ' boxSolid(self)=' + T.boxSolid(a.x, a.y, a.hw, a.hh));
      for (let dy = -8; dy <= 8; dy++) {
        let row = '';
        for (let dx = -16; dx <= 24; dx++) {
          if (dx === 0 && dy === 0) { row += '@'; continue; }
          row += '.1R3W5'[T.get(X + dx, Y + dy)] || '?';
        }
        log.push(String(Y + dy).padStart(4) + ' ' + row);
      }
      const wp = a.nav && a.nav.pts[a.nav.i];
      if (wp) log.push('wp at dx=' + (wp.x - X) + ' dy=' + (wp.y - Y));
    }
    return log;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
