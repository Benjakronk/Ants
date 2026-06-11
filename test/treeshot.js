// Screenshot a tree to eyeball the new generation.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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

  const info = await page.evaluate(() => {
    const t = G.trees[0];
    const a = G.players[0].ant;
    a.x = t.x + 30; a.y = T.surf[t.x + 30] - 6;
    const p = G.players[0];
    p.cam.x = t.x - 160; p.cam.y = t.topY - 30;
    p.fx = a.x; p.fy = a.y;
    G.tick = Math.floor(DAY_LEN * 0.3); // midday light
    return { tree: t, count: G.trees.length };
  });
  console.log('trees:', info.count, 'first:', JSON.stringify(info.tree));
  // freeze camera on the tree for the shot
  await page.evaluate(() => {
    const t = G.trees[0], p = G.players[0];
    p.cam.x = Math.max(0, t.x - 160); p.cam.y = Math.max(0, t.topY - 40);
    p.fx = p.cam.x + 160; p.fy = p.cam.y + 88;
  });
  await page.waitForTimeout(120);
  await page.screenshot({ path: 'test/shot-tree.png' });
  await browser.close();
})();
