// The opening logo: plays on page load (for a real browser), its frames look
// right, a skip key ends it without also choosing on the title menu, and the
// new copyright line is on the title. Playwright normally skips the logo
// (navigator.webdriver), so this probe pretends to be a normal browser.
//   node test/logoprobe.js
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const fails = [];
  const check = (name, ok, info) => {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  ' + info : ''));
    if (!ok) fails.push(name);
  };
  const errors = [];
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
    await page.goto(url);
    return page;
  };
  // the canvas's average brightness (the logo is gold on near-black)
  const bright = page => page.evaluate(() => {
    const d = document.getElementById('game').getContext('2d').getImageData(0, 0, 320, 200).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return s / (d.length / 4) / 3;
  });
  const frames = page => page.evaluate(() => G.frame);

  // 1. watch it play through
  let page = await open();
  await page.waitForTimeout(1500);
  check('title loop has not started during the logo', (await frames(page)) === 0);
  await page.screenshot({ path: 'test/shot-logo-foot.png' });
  await page.waitForTimeout(1300);
  const lit = await bright(page);
  check('footprint and name are drawn', lit > 3, 'brightness ' + lit.toFixed(1));
  await page.screenshot({ path: 'test/shot-logo.png' });
  await page.waitForTimeout(4500);
  check('the title starts after the logo', (await page.evaluate(() => G.state)) === 'title' && (await frames(page)) > 0);
  await page.screenshot({ path: 'test/shot-logo-title.png' });
  await page.close();

  // 2. skip it with Enter: straight to the title, and that Enter doesn't open SOLO
  page = await open();
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  check('Enter skips to the title', (await frames(page)) > 0);
  check('the skip key does not choose on the title menu', (await page.evaluate(() => G.state)) === 'title');
  await page.close();

  // 3. reduced motion: one fade, still ends on the title
  page = await browser.newPage({ viewport: { width: 960, height: 600 }, reducedMotion: 'reduce' });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  await page.goto(url);
  await page.waitForTimeout(700);
  check('reduced motion shows the whole logo at once', (await bright(page)) > 3);
  await page.waitForTimeout(2500);
  check('reduced motion ends on the title', (await frames(page)) > 0);
  await page.close();

  // 4. the automated-browser path the other tests rely on: no logo at all
  page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(300);
  check('automated browsers skip the logo', (await frames(page)) > 0);
  await page.close();

  console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log(fails.length || errors.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  await browser.close();
  process.exitCode = fails.length || errors.length ? 1 : 0;
})();
