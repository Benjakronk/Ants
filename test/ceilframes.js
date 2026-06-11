// Frame-by-frame ceiling grab debug: simulate W held, log decisions.
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
    const cx = G.colony.x - 250;
    const cy = T.surf[cx] + 60;
    for (let x = cx - 30; x <= cx + 30; x += 2) T.dig(x, cy, 5);
    const a = G.players[0].ant;
    a.x = cx - 20; a.y = cy + 2; a.vx = 0; a.vy = 0;
    for (let i = 0; i < 10; i++) updatePlay(); // settle
    keys['KeyW'] = true;
    for (let i = 0; i < 40; i++) {
      updatePlay();
      log.push('f' + i + ' y=' + a.y.toFixed(1) + ' vy=' + a.vy.toFixed(2) +
        ' climb=' + a.climbing + ' ceil=' + a.ceiling + ' onG=' + a.onGround +
        ' sideR=' + sideWall(a, 1) + ' sideL=' + sideWall(a, -1) +
        ' nearR=' + wallNear(a, 1, 5) + ' nearL=' + wallNear(a, -1, 5) +
        ' ceilAb=' + ceilAbove(a, 5));
    }
    keys['KeyW'] = false;
    return log;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
