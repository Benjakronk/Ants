// Player ceiling-climb probe: dig a pocket, hang from its roof, crawl along it.
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

  // carve a low gallery in solid dirt and stand the player in it
  const spot = await page.evaluate(() => {
    const cx = G.colony.x - 250;
    const cy = T.surf[cx] + 60;
    for (let x = cx - 30; x <= cx + 30; x += 4) T.dig(x, cy, 5); // long gallery
    const a = G.players[0].ant;
    a.x = cx - 20; a.y = cy + 2; a.vx = 0; a.vy = 0;
    return { cx, cy };
  });
  await page.waitForTimeout(300);

  // hold W: hop, grab the roof, hang upside-down
  await page.keyboard.down('w');
  await page.waitForTimeout(1000);
  const hang = await page.evaluate(() => {
    const a = G.players[0].ant;
    return { y: a.y.toFixed(1), ceiling: a.ceiling, climbing: a.climbing, onGround: a.onGround };
  });
  console.log('hang:', JSON.stringify(hang), '(gallery center y=' + spot.cy + ')');

  // hold W+D: crawl right along the roof, sampling along the way
  const s0 = await page.evaluate(() => ({ x: G.players[0].ant.x, y: G.players[0].ant.y }));
  await page.keyboard.down('d');
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => {
      const a = G.players[0].ant;
      return { x: a.x | 0, y: a.y | 0, ceiling: a.ceiling, onGround: a.onGround };
    });
    console.log('crawl sample', i, JSON.stringify(s));
  }
  await page.keyboard.up('d');

  // release W: drop back to the floor
  await page.keyboard.up('w');
  await page.waitForTimeout(800);
  const drop = await page.evaluate(() => {
    const a = G.players[0].ant;
    return { y: a.y.toFixed(1), onGround: a.onGround, ceiling: a.ceiling };
  });
  console.log('drop:', JSON.stringify(drop));
  await browser.close();
})();
