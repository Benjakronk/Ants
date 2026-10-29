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
      for (const m of ['solo', 'coop', 'versus', 'world']) for (const pg of helpPages(m)) { scan(pg.title); pg.lines.forEach(([line]) => scan(line)); }
    }
    LANG = 0;
    return [...out];
  });
  check('font has glyphs for every UI string', missing.length === 0);
  if (missing.length) console.log('  missing glyphs:', JSON.stringify(missing));

  // the online strings of Phase 4b (persistent worlds, versus, the room
  // browser, SERVER FULL): both languages, different words, and they fit
  // the 320 px screen (with a long number in place of each {n})
  const online = await page.evaluate(() => {
    const keys = Object.keys(STR).filter(k => /^(ui_(worlds|openMatches|.*Note|listing|noWorlds|noOpen|asleep|legacy|worldColony|serverFull|mode|hostIs|cr|public|private|lobbyP|lobbyH|sideKeys|needSides|black|red$|leaveWorld|history|noHistory|histNote|enemy|vs)|m_(vs|worldWelcome|legacy|reborn|queenFoundVs)|h_|r_vs|lg_enemy|e_(kicked|sides|sideFull|noWorld|busy|mode|notHost|started))/.test(k));
    const bad = [];
    for (const k of keys) {
      const [en, no] = STR[k];
      if (!en || !no) bad.push(k + ': missing');
      for (const s of [en, no]) if (textWidth(String(s).replace(/\{\d+\}/g, '8888')) > 316) bad.push(k + ': too wide: ' + s);
    }
    return { n: keys.length, bad, same: keys.filter(k => STR[k][0] === STR[k][1] && !/\{/.test(STR[k][0])) };
  });
  check('the new online strings: English and Norwegian, and they fit the screen', online.n >= 60 && !online.bad.length,
    online.n + ' strings');
  if (online.bad.length) console.log('  ', JSON.stringify(online.bad));
  if (online.same.length) console.log('  (same in both languages: ' + online.same.join(', ') + ')');

  // the match round's strings (the year's length, the goal strip, personal
  // milestones, the highlights): both languages, different words where they
  // should be, the font's glyphs (above), and each fits where it is drawn --
  // a track's name and next goal in the O screen's columns, a toast, an
  // award's label and value, the goal strip's longest form beside a task
  const mr = await page.evaluate(() => {
    const bad = [], w = s => textWidth(String(s));
    const keys = Object.keys(STR).filter(k => /^(len_|ui_(crLen|lenNote|lenTag|lobbyTitle|slotLenKey|personal|pmTotal|pmNote|highlights|hl|youWon|yourPm|noPm|matchOverHl)|hud_|pm_|pmd_|m_pm|m_year|m_your|aw_|awv_)/.test(k));
    for (const lang of [0, 1]) {
      LANG = lang;
      for (const k of keys) {
        if (!STR[k][lang]) bad.push(k + ': missing');
        if (w(String(STR[k][lang]).replace(/\{\d+\}/g, '8888')) > 316) bad.push(k + ': too wide');
      }
      for (const t of PERSONAL) {
        const top = t.tiers[t.tiers.length - 1];
        if (w(L('pm_' + t.id)) > 74) bad.push('pm_' + t.id + ': name too wide for its column');
        if (w(Ln('pmd_' + t.id, top)) + w(top + '/' + top) + 6 > 180) bad.push('pmd_' + t.id + ': goal too wide for its column');
        const toast = msgText({ key: 'm_pmGem', args: [{ key: 'pm_' + t.id }, '\x15\x15\x15', { key: 'pmd_' + t.id, args: [top] }] });
        if (w(toast) > 316) bad.push('m_pmGem/' + t.id + ': toast too wide');
      }
      for (const k of ['mvp', 'digger', 'builder', 'forager', 'killer', 'survivor']) {
        if (w(L('aw_' + k)) > 90) bad.push('aw_' + k + ': label too wide');
        if (w(Ln('awv_' + k, 99999)) > 96) bad.push('awv_' + k + ': value too wide');
      }
      // the goal strip's longest form (winter: princesses and the flight; it
      // drops to its short form where a row has no room for it)
      const strip = '\x16' + L('season_winter') + ' 3/3 \x119 ' + L('hud_flightIn', '11:59');
      if (w(strip) > 190) bad.push('goal strip too long: ' + strip);
      for (const len of ['full', 'short', 'quick']) {
        if (w('< ' + L('ui_crLen', L('len_' + len)) + ' >') > 300) bad.push('ui_crLen/' + len);
        if (w(L('ui_lobbyTitle', L('ui_modeVersus'), L('len_' + len))) * 2 > 316) bad.push('ui_lobbyTitle/' + len + ' (at double size)');
      }
    }
    LANG = 0;
    return { n: keys.length, bad, same: keys.filter(k => STR[k][0] === STR[k][1] && !/\{/.test(STR[k][0])) };
  });
  check('the match round\'s strings: both languages, and they fit where they are drawn', mr.n >= 60 && !mr.bad.length, mr.n + ' strings');
  if (mr.bad.length) console.log('  ', JSON.stringify(mr.bad));
  if (mr.same.length) console.log('  (same in both languages: ' + mr.same.join(', ') + ')');

  // match round 2: the golden seed's strings -- both languages, different
  // words, and each fits where it is drawn: a toast (with its tokens and a
  // player's long name), the O screen's row (the status left, HOME n/3
  // right, between x 20 and 300), the map legend's second column, the goal
  // strip's longest form with the seed's segment beside a task
  const rl = await page.evaluate(() => {
    const bad = [], w = s => textWidth(String(s));
    const keys = Object.keys(STR).filter(k => /^(rl_|m_relic|rs_|ui_relicsHome|lg_relic)/.test(k));
    for (const lang of [0, 1]) {
      LANG = lang;
      for (const k of keys) {
        if (!STR[k][lang]) bad.push(k + ': missing');
        const full = L(k, k === 'm_relicOurs' ? 'JULIETTJULIE' : /Soon$|Fell$/.test(k) ? L('rl_enemyNest') : '888', '3');
        if (w(full) > 316) bad.push(k + ': toast too wide: ' + full);
        if (k.startsWith('rs_') && w('\x1C ' + L(k)) + 6 + w(L('ui_relicsHome', 3, 3)) > 280) bad.push(k + ': O row too wide');
      }
      if (w(L('lg_relic')) > 66) bad.push('lg_relic: too wide for the legend');
      const strip = '\x04' + L('season_summer') + ' 3/3 \x1C3/3 \x1A11:59';
      if (w(strip) > 190) bad.push('goal strip with the seed too long: ' + strip);
    }
    LANG = 0;
    return { n: keys.length, bad, same: keys.filter(k => STR[k][0] === STR[k][1] && !/\{/.test(STR[k][0])) };
  });
  check('the golden seed\'s strings: both languages, and they fit where they are drawn', rl.n >= 30 && !rl.bad.length && !rl.same.length, rl.n + ' strings');
  if (rl.bad.length) console.log('  ', JSON.stringify(rl.bad));
  if (rl.same.length) console.log('  (same in both languages: ' + rl.same.join(', ') + ')');

  // the jobs' strings (see JOBS in game.js): both languages, different
  // words, the font's glyphs (above, the job icons among them), and each
  // fits where it is drawn -- the HUD's job line beside the goal strip, the
  // toasts (with their tokens), the O screen's job page (a line from x 36,
  // the caste right of the name), the switch overlay's line, the awards,
  // the lobby's key line with each preference
  const jb = await page.evaluate(() => {
    const bad = [], w = s => textWidth(String(s).replace(/\{\d\}/g, '888'));
    const keys = Object.keys(STR).filter(k => /^(job_|jt_|jd_|jg_|ask_|m_job|m_patrol|m_forageCall|ui_job|aw_guard|aw_seeker|awv_guard|awv_seeker)/.test(k));
    for (const lang of [0, 1]) {
      LANG = lang;
      for (const k of keys) {
        if (!STR[k][lang]) bad.push(k + ': missing');
        // (the job toasts' tokens are checked with the real words below)
        if (w(L(k, 'SEEKER', 888)) > 316) bad.push(k + ': too wide');
      }
      for (const j of JOBS) {
        for (const ch of JOB_ICON[j]) if (!FONT_GLYPHS[ch]) bad.push(j + ': no icon glyph');
        if (4 + w(JOB_ICON[j] + ' ' + L('jg_' + j, 888, 888)) + 8 + w('\x04' + L('season_summer') + ' 3/3 \x1C3/3 \x1A11:59') > 316) bad.push('jg_' + j + ': beside the goal strip');
        for (const m of ['m_jobIs', 'm_jobNow']) if (w(msgText({ key: m, args: [{ key: 'job_' + j }, { key: 'jt_' + j }] })) > 316) bad.push(m + '/' + j);
        if (w(msgText({ key: 'm_jobGoal', args: [{ key: 'job_' + j }, 50] })) > 316) bad.push('m_jobGoal/' + j);
        if (w(L('jd_' + j)) > 264) bad.push('jd_' + j + ': O page line');
        if (36 + w(jobName(j)) + 12 + w(L('ui_jobCaste', casteName(JOB_CASTE[j]))) > 300) bad.push('ui_jobCaste/' + j);
        if (w(L('ui_jobSuits', JOB_ICON[j] + jobName(j), casteName(JOB_CASTE[j]))) > 172) bad.push('ui_jobSuits/' + j + ': takeover panel');
        if (w(L('ui_jobNeed', jobName(j))) > 284) bad.push('ui_jobNeed/' + j);
      }
      for (const j of JOBS.concat([null])) if (w(L('ui_lobbyLeave', jobName(j))) > 316) bad.push('ui_lobbyLeave/' + j);
      for (const k of ['guard', 'seeker']) {
        if (w(L('aw_' + k)) > 90) bad.push('aw_' + k + ': label too wide');
        if (w(Ln('awv_' + k, 99999)) > 96) bad.push('awv_' + k + ': value too wide');
      }
    }
    LANG = 0;
    return { n: keys.length, bad, same: keys.filter(k => STR[k][0] === STR[k][1] && !/\{/.test(STR[k][0])) };
  });
  check('the jobs\' strings: both languages, different words, and they fit where they are drawn', jb.n >= 40 && !jb.bad.length && !jb.same.length, jb.n + ' strings');
  if (jb.bad.length) console.log('  ', JSON.stringify(jb.bad));
  if (jb.same.length) console.log('  (same in both languages: ' + jb.same.join(', ') + ')');

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
  await page.keyboard.press('KeyC');
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
