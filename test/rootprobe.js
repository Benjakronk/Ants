// Verify tree roots exist underground and can be chewed through.
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

  const r = await page.evaluate(() => {
    // census materials under the first few trees
    let roots = 0, woodBelowGround = 0, sample = null;
    for (const t of G.trees) {
      for (let x = t.x - 40; x <= t.x + 40; x++) {
        for (let y = T.surf[t.x] + 2; y < T.surf[t.x] + 70; y++) {
          const m = T.get(x, y);
          if (m === M_ROOT) { roots++; if (!sample) sample = { x, y }; }
          if (m === M_WOOD && y > T.surf[t.x] + 8) woodBelowGround++;
        }
      }
    }
    // chew a root
    let dug = null;
    if (sample) {
      const res = T.dig(sample.x, sample.y, 3);
      dug = { removed: res.count, nowAir: T.get(sample.x, sample.y) === M_AIR };
    }
    return { roots, woodBelowGround, dug };
  });
  console.log(JSON.stringify(r));
  await browser.close();
})();
