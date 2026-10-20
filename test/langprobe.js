// Headless probe: Norwegian language option + P2 Norwegian-layout keys.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const fails = [];
  const check = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); if (!ok) fails.push(name); };

  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(url);
  await page.waitForTimeout(600);
  await page.evaluate(() => localStorage.clear());

  // font has the Norwegian glyphs
  check('font has Æ Ø Å', await page.evaluate(() =>
    !!(FONT_GLYPHS['Æ'] && FONT_GLYPHS['Ø'] && FONT_GLYPHS['Å'])));

  // every UI string, in both languages, is drawable with the bitmap font
  const missing = await page.evaluate(() => {
    const out = new Set();
    const scan = s => {
      for (const ch of String(s).replace(/\{\d+\}/g, '').toUpperCase()) {
        if (!FONT_GLYPHS[ch] && ch !== '\n') out.add(ch);
      }
    };
    for (const k in STR) STR[k].forEach(scan);
    for (const t of [CASTE_NAME, BUG_NAME_DEF, BROOD_NAME_DEF]) for (const k in t) t[k].forEach(scan);
    for (const lang of [0, 1]) {
      LANG = lang;
      introText().forEach(scan);
      helpText().forEach(([line]) => scan(line));
    }
    LANG = 0;
    return [...out];
  });
  check('font has glyphs for every UI string', missing.length === 0);
  if (missing.length) console.log('  missing glyphs:', JSON.stringify(missing));

  // title menu: 5th item toggles language
  check('boots in english', await page.evaluate(() => LANG === 0 && L('ui_start') === 'PLAY SOLO'));
  for (let i = 0; i < 5; i++) { // down to LANGUAGE
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const no = await page.evaluate(() => ({
    lang: LANG, stored: localStorage.getItem('maur_lang'),
    start: L('ui_start'), tag: L('ui_tagline'),
    intro: introText()[0], help: helpText()[0][0],
  }));
  check('toggles to norwegian + persists', no.lang === 1 && no.stored === 'no' && no.start === 'SPILL ALENE');
  console.log('  tagline:', no.tag, '| intro:', no.intro, '| help:', no.help);
  await page.screenshot({ path: 'test/shot-title-no.png' });

  // language survives reload
  await page.reload();
  await page.waitForTimeout(600);
  check('norwegian after reload', await page.evaluate(() => LANG === 1));

  // start a game in Norwegian
  await page.keyboard.press('Enter'); // SPILL ALENE -> slots
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space'); // skip intro
  await page.waitForTimeout(400);
  const msgs = await page.evaluate(() => G.msgs.map(m => m.text));
  check('norwegian start message', msgs.includes('SANK MAT TIL KOLONIEN'));

  // task text translated at render time
  const task = await page.evaluate(() => {
    G.colony.tasks.push({ type: 'gather', n: 0, need: 5, reward: 50 });
    return taskText(G.colony.tasks[G.colony.tasks.length - 1]);
  });
  check('task text norwegian', task === 'SANK MAT');

  // takeover menu shows Norwegian caste names
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  const castes = await page.evaluate(() =>
    G.takeover ? G.takeover.types.map(t => casteName(t.caste)) : []);
  // (the queen is never playable, so she isn't offered)
  check('norwegian caste names', castes.includes('ARBEIDER') && castes.includes('SOLDAT') &&
    !castes.includes('DRONNING'));
  check('norwegian season and milestone', await page.evaluate(() =>
    L('season_winter') === 'VINTER' && L('o_queen') === 'HOLD DRONNINGEN I LIVE'));
  await page.screenshot({ path: 'test/shot-switch-no.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // switch back to English for good measure
  await page.evaluate(() => setLang(false));
  check('back to english', await page.evaluate(() => L('ui_start') === 'PLAY SOLO'));

  console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  await browser.close();
  process.exit(errors.length || fails.length ? 1 : 0);
})();
