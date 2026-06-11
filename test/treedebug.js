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
    const t = G.trees[0];
    a.x = t.x - 8; a.y = T.surf[Math.floor(a.x)] - 4; a.vx = 0; a.vy = 0; a.dir = 1;
    log.push('tree x=' + t.x + ' ant=' + (a.x | 0) + ',' + (a.y | 0));
    // map around the ant: 16 wide, 12 tall
    const X = Math.round(a.x), Y = Math.round(a.y);
    for (let dy = -6; dy <= 6; dy++) {
      let row = '';
      for (let dx = -4; dx <= 14; dx++) {
        const m = T.get(X + dx, Y + dy);
        row += (dx === 0 && dy === 0) ? '@' : '.1R3W5'[m] || '?';
      }
      log.push((Y + dy) + ' ' + row);
    }
    log.push('sideWall(+1)=' + sideWall(a, 1) + ' wallNear(+1,5)=' + wallNear(a, 1, 5));
    log.push('boxSolid(up1)=' + T.boxSolid(a.x, a.y - 1, a.hw, a.hh));

    // simulate exactly what holding W does for 120 frames
    const SPEED = a.def.speed * 1.5;
    for (let i = 0; i < 120; i++) {
      a.vx = 0;
      a.climbing = false;
      let wallDir = 0;
      if (sideWall(a, a.dir)) wallDir = a.dir;
      else if (sideWall(a, -a.dir)) wallDir = -a.dir;
      else if (wallNear(a, a.dir, 5)) wallDir = a.dir;
      else if (wallNear(a, -a.dir, 5)) wallDir = -a.dir;
      if (wallDir) {
        a.climbing = true; a.climbV = -SPEED * 1.1; a.dir = wallDir;
        a.vx = wallDir * SPEED * 0.6;
      } else if (a.onGround) a.vy = -1.9;
      physStep(a);
      if (i % 20 === 0) log.push('f' + i + ' y=' + a.y.toFixed(1) + ' x=' + a.x.toFixed(1) +
        ' climb=' + a.climbing + ' wallDir=' + wallDir + ' onG=' + a.onGround + ' vBlocked=' + !!a.vBlocked);
      a.vBlocked = false;
    }
    return log;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
