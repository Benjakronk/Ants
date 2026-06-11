// Focused probe: what's under the ant, and does digging straight down work on dirt?
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(500);
  await page.evaluate(() => localStorage.clear());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // world 3, empty
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);

  // teleport the player onto plain dirt: colony mound center
  const setup = await page.evaluate(() => {
    const a = G.players[0].ant;
    const x = G.colony.x - 30;
    a.x = x; a.y = T.surf[Math.floor(x)] - 4;
    a.vx = 0; a.vy = 0;
    const mats = [];
    for (let dy = 0; dy < 8; dy++) mats.push(T.get(a.x, a.y + dy));
    return { x: a.x | 0, y: a.y | 0, matsBelow: mats };
  });
  console.log('setup:', JSON.stringify(setup));

  await page.keyboard.down('s');
  await page.keyboard.down(' ');
  await page.waitForTimeout(3000);
  await page.keyboard.up(' ');
  await page.keyboard.up('s');

  const after = await page.evaluate(() => {
    const a = G.players[0].ant;
    return { x: a.x | 0, y: a.y | 0, biteCd: a.biteCd, onGround: a.onGround };
  });
  console.log('after 3s dig-down:', JSON.stringify(after), 'descended:', after.y - setup.y, 'px');

  // also verify sideways digging
  const b0 = await page.evaluate(() => ({ x: G.players[0].ant.x | 0 }));
  await page.keyboard.down('d');
  await page.keyboard.down(' ');
  await page.waitForTimeout(2500);
  await page.keyboard.up(' ');
  await page.keyboard.up('d');
  const b1 = await page.evaluate(() => ({ x: G.players[0].ant.x | 0, y: G.players[0].ant.y | 0 }));
  console.log('sideways: x', b0.x, '->', b1.x);

  // climb out of the shaft we just made
  const c0 = await page.evaluate(() => ({ y: G.players[0].ant.y | 0 }));
  await page.keyboard.down('w');
  await page.waitForTimeout(3500);
  await page.keyboard.up('w');
  const c1 = await page.evaluate(() => ({ y: G.players[0].ant.y | 0, climbing: G.players[0].ant.climbing }));
  console.log('climb: y', c0.y, '->', c1.y, 'rose:', c0.y - c1.y, 'px');

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
