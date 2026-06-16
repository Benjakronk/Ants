// Probe: confirm the doubled world, the rival nest, and its garrison.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(800);
  await page.evaluate(() => localStorage.clear());
  await page.keyboard.press('Enter');           // title -> slots
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');           // new world
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space');           // skip intro
  await page.waitForTimeout(500);

  const info = await page.evaluate(() => {
    const defs = G.bugs.filter(b => b.kind === 'redant' && b.resident);
    return {
      worldW: WORLD_W, worldH: WORLD_H,
      colonyX: G.colony.x, rivalX: G.rival.x,
      rivalEntrance: G.rival.entrance,
      defenders: defs.length,
      defenderXs: defs.map(b => b.x | 0),
      gapColonyToLeftEdge: G.colony.x,
      gapRivalToRightEdge: WORLD_W - G.rival.x,
      gapBetween: G.rival.x - G.colony.x,
    };
  });
  console.log(JSON.stringify(info, null, 1));

  // verify it round-trips through save/load
  await page.evaluate(() => saveWorld(G.slot));
  await page.waitForTimeout(200);
  const afterLoad = await page.evaluate(() => {
    G.running = false;
    loadWorld(G.slot, 1);
    const defs = G.bugs.filter(b => b.kind === 'redant' && b.resident);
    return { rivalX: G.rival ? G.rival.x : null, residentDefenders: defs.length,
             homeXs: defs.map(b => b.homeX | 0) };
  });
  console.log('after reload:', JSON.stringify(afterLoad));

  console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
