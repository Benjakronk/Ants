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

  const start = await page.evaluate(() => {
    const a = G.players[0].ant;
    const x = G.colony.x - 30;
    a.x = x; a.y = T.surf[Math.floor(x)] - 4; a.vx = 0; a.vy = 0;
    return { x: a.x | 0, y: a.y | 0 };
  });

  // dig straight down 4s
  await page.keyboard.down('s');
  await page.keyboard.down(' ');
  await page.waitForTimeout(4000);
  await page.keyboard.up(' ');
  await page.keyboard.up('s');
  const bottom = await page.evaluate(() => ({ y: G.players[0].ant.y | 0 }));
  console.log('dug from', start.y, 'to', bottom.y, '(' + (bottom.y - start.y) + 'px shaft)');

  // climb straight back up the shaft, just holding W
  await page.keyboard.down('w');
  await page.waitForTimeout(5000);
  await page.keyboard.up('w');
  const top = await page.evaluate(() => ({ y: G.players[0].ant.y | 0, climbing: G.players[0].ant.climbing }));
  console.log('climbed from', bottom.y, 'to', top.y, '(rose ' + (bottom.y - top.y) + 'px)',
    'back at surface:', top.y <= start.y + 6);

  // climb a tree: teleport next to a trunk and hold W
  const tree = await page.evaluate(() => {
    const a = G.players[0].ant;
    const t = G.trees[0];
    a.x = t.x - 7; a.y = T.surf[Math.floor(a.x)] - 4; a.vx = 0; a.vy = 0;
    a.dir = 1;
    return { tx: t.x, topY: t.topY, antY: a.y | 0 };
  });
  await page.keyboard.down('d');
  await page.waitForTimeout(300);
  await page.keyboard.up('d');
  await page.keyboard.down('w');
  await page.waitForTimeout(4000);
  await page.keyboard.up('w');
  const up = await page.evaluate(() => ({ y: G.players[0].ant.y | 0, x: G.players[0].ant.x | 0 }));
  console.log('tree climb: from y', tree.antY, 'to', up.y, '(rose ' + (tree.antY - up.y) + 'px)');

  await browser.close();
})();
