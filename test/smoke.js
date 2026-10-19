// Headless smoke test: boot the game, start a world, play, dig, save, reload.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(url);
  await page.waitForTimeout(800);
  await page.evaluate(() => localStorage.clear());

  const state0 = await page.evaluate(() => G.state);
  console.log('boot state:', state0);
  await page.screenshot({ path: 'test/shot-title.png' });

  // title -> START GAME -> slots
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  console.log('after enter:', await page.evaluate(() => G.state));
  await page.screenshot({ path: 'test/shot-slots.png' });

  // new world, 1 player
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500); // worldgen + canvas build
  console.log('after slot enter:', await page.evaluate(() => G.state));

  // skip intro
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({
    state: G.state, ants: G.ants.length, brood: G.brood.length,
    bugs: G.bugs.length, items: G.items.length,
    player: G.players[0].ant ? { x: G.players[0].ant.x | 0, y: G.players[0].ant.y | 0, hp: G.players[0].ant.hp } : null,
    food: G.colony.food, seed: G.seed,
  }));
  console.log('play state:', JSON.stringify(st));
  await page.screenshot({ path: 'test/shot-play.png' });

  // walk right for 2s
  await page.keyboard.down('d');
  await page.waitForTimeout(2000);
  await page.keyboard.up('d');
  const afterWalk = await page.evaluate(() => ({ x: G.players[0].ant.x | 0, y: G.players[0].ant.y | 0 }));
  console.log('after walk:', JSON.stringify(afterWalk), 'moved:', afterWalk.x !== st.player.x);

  // dig down: hold S + Space
  const before = await page.evaluate(() => ({ x: G.players[0].ant.x | 0, y: G.players[0].ant.y | 0 }));
  await page.keyboard.down('s');
  await page.keyboard.down(' ');
  await page.waitForTimeout(4000);
  await page.keyboard.up(' ');
  await page.keyboard.up('s');
  const after = await page.evaluate(() => ({ x: G.players[0].ant.x | 0, y: G.players[0].ant.y | 0 }));
  console.log('dig: before y=', before.y, 'after y=', after.y, 'dug down:', after.y > before.y + 5);
  const repaint = await page.evaluate(() => {
    const a = G.players[0].ant;
    const x = Math.round(a.x), y = Math.round(a.y);
    return { mat: T.get(x, y), alpha: TerrainView.terCtx.getImageData(x, y, 1, 1).data[3] };
  });
  console.log('dug pixel repainted:', repaint.mat === 0 && repaint.alpha === 0, JSON.stringify(repaint));
  await page.screenshot({ path: 'test/shot-dug.png' });

  // climb back up: hold W (against tunnel wall)
  await page.keyboard.down('w');
  await page.waitForTimeout(2500);
  await page.keyboard.up('w');
  const climbed = await page.evaluate(() => ({ y: G.players[0].ant.y | 0 }));
  console.log('climb: y', after.y, '->', climbed.y, 'climbed:', climbed.y < after.y - 5);

  // let the sim run a while; NPCs should act
  await page.waitForTimeout(5000);
  const sim = await page.evaluate(() => ({
    states: G.ants.map(a => a.caste + ':' + (a.playerIdx >= 0 ? 'PLAYER' : a.state)),
    msgs: G.msgs.map(m => m.text),
    tasks: G.colony.tasks.map(t => t.text + ' ' + t.n + '/' + t.need),
    pheromones: G.pheromones.length,
    tick: G.tick, day: G.day,
  }));
  console.log('sim:', JSON.stringify(sim, null, 1));

  // pause + save
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowDown'); // SAVE GAME
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => !!localStorage.getItem('maur_world_1'));
  const saveSize = await page.evaluate(() => (localStorage.getItem('maur_world_1') || '').length);
  console.log('saved:', saved, 'size:', (saveSize / 1024).toFixed(1) + 'KB', 'state:', await page.evaluate(() => G.state));

  // test minimap
  await page.keyboard.press('m');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/shot-map.png' });
  await page.keyboard.press('m');

  // remember position, reload page, continue
  const posBefore = await page.evaluate(() => ({ x: G.players[0].ant.x | 0, tick: G.tick, food: Math.round(G.colony.food) }));
  await page.reload();
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter'); // start game -> slots
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter'); // load world 1
  await page.waitForTimeout(2500);
  const posAfter = await page.evaluate(() => ({
    state: G.state, x: G.players[0].ant ? G.players[0].ant.x | 0 : -1,
    tick: G.tick, food: Math.round(G.colony.food), ants: G.ants.length,
  }));
  console.log('reload: before', JSON.stringify(posBefore), 'after', JSON.stringify(posAfter));
  console.log('load restored:', posAfter.state === 'play' && Math.abs(posAfter.x - posBefore.x) < 30 && posAfter.tick >= posBefore.tick);
  await page.screenshot({ path: 'test/shot-loaded.png' });

  // fresh world 2 (arrow keys drive the ant too)
  await page.evaluate(() => { G.state = 'title'; G.running = false; G.menuSel = 0; });
  await page.keyboard.press('Enter'); // start -> slots
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowDown'); // world 2
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space'); // skip intro
  await page.waitForTimeout(400);
  const x0 = await page.evaluate(() => G.players[0].ant.x);
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowLeft');
  console.log('world 2:', await page.evaluate(() => G.state), 'players:', await page.evaluate(() => G.players.length),
    'arrow moved:', await page.evaluate(x => G.players[0].ant.x < x - 3, x0));

  // live switch with Tab: the world keeps running under the overlay
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  const t0 = await page.evaluate(() => G.tick);
  await page.waitForTimeout(300);
  console.log('switch overlay:', await page.evaluate(() => !!G.takeover && G.takeover.live),
    'sim runs underneath:', await page.evaluate(t => G.tick > t, t0));
  await page.screenshot({ path: 'test/shot-switch.png' });
  await page.keyboard.press('ArrowDown'); // soldier
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  console.log('switched to:', await page.evaluate(() => G.players[0].ant && G.players[0].ant.caste));

  // kill the player's ant to test the takeover screen
  await page.evaluate(() => { G.players[0].ant.hp = 0; });
  await page.waitForTimeout(500);
  console.log('takeover open:', await page.evaluate(() => !!G.takeover && !G.takeover.live),
    'types:', await page.evaluate(() => G.takeover ? JSON.stringify(G.takeover.types) : 'none'));
  await page.screenshot({ path: 'test/shot-takeover.png' });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  console.log('after takeover:', await page.evaluate(() => G.state),
    'p1 ant:', await page.evaluate(() => !!G.players[0].ant), 'overlay closed:', await page.evaluate(() => !G.takeover));

  console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
