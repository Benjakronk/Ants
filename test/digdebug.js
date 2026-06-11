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
    const x = G.colony.x - 30;
    a.x = x; a.y = T.surf[Math.floor(x)] - 4; a.vx = 0; a.vy = 0;
    const X = Math.round(a.x), Y = Math.round(a.y);
    log.push('ant at ' + a.x + ',' + a.y);

    // simulate exactly what the bite branch does
    const c = a.def;
    const bx = a.x, by = a.y + (a.hh + 3.5);
    log.push('bite point ' + bx + ',' + by + ' digR ' + c.digR);
    const res = T.dig(bx, by, c.digR);
    log.push('dig result ' + JSON.stringify(res));

    // column scan after one dig
    let cols = [];
    for (let dx = -4; dx <= 4; dx++) {
      let col = '';
      for (let dy = 0; dy <= 10; dy++) col += T.get(X + dx, Y + dy);
      cols.push(dx + ':' + col);
    }
    log.push('cols(after 1 dig) ' + cols.join(' '));

    // can the ant move down now?
    log.push('boxSolid(y+1)=' + T.boxSolid(a.x, a.y + 1, a.hw, a.hh)
      + ' boxSolid(y+2)=' + T.boxSolid(a.x, a.y + 2, a.hw, a.hh));

    // run 30 physics steps with gravity
    for (let i = 0; i < 30; i++) { a.climbing = false; physStep(a); }
    log.push('after 30 physteps y=' + a.y + ' onGround=' + a.onGround);
    return log;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
