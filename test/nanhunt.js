// Find what poisons colony.food with NaN.
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

    // trap every write to colony.food
    let _food = G.colony.food;
    Object.defineProperty(G.colony, 'food', {
      get() { return _food; },
      set(v) {
        if (!isFinite(v) && isFinite(_food)) {
          log.push('FOOD WENT NaN: ' + _food + ' -> ' + v + ' at tick ' + G.tick);
          log.push(new Error('trace').stack.split('\n').slice(1, 6).join(' | '));
        }
        _food = v;
      }
    });

    for (let i = 0; i < 4 * DAY_LEN && G.state === 'play'; i++) {
      updatePlay();
      if (log.length > 0 && log.length < 99) { log.push('stopping early'); break; }
    }
    log.push('end: food=' + _food + ' state=' + G.state + ' day=' + (G.tick / DAY_LEN).toFixed(2) +
      ' dep=' + G.colony.stats.foodGathered + ' ants=' + G.ants.filter(a => a.hp > 0).length);
    return log;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
