// Persistent worlds probe: the server as a child process with two worlds
// (MAURTUA, ENGA) in a temporary DATA_DIR, raw WebSocket clients.
//   node test/persistprobe.js
// The worlds boot from config and are saved at once; they sleep (no ticks)
// with nobody in them and wake on a join; the room browser lists them; a
// running world autosaves atomically (temp file + rename, one .bak); a
// nuptial flight banks legacy points and the colony carries on; a colony
// lost with no heir starts the world over (new seed, legacy and history
// kept); leaving puts it back to sleep (saved); a graceful stop (SIGTERM,
// or pm2's shutdown message on Windows) saves the running state, and a
// restarted server loads it back the same; a corrupt save falls back to
// the backup. Last, a browser page: the world list, JOIN THE COLONY, the
// legacy and the WORLD HISTORY page of the O screen, LEAVE WORLD.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const WebSocket = require(path.join(ROOT, 'server', 'node_modules', 'ws'));

const fails = [];
const check = (name, ok, info) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info !== undefined ? '  ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''));
  if (!ok) fails.push(name);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function freePort() {
  return new Promise(res => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
function getJson(port, p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path: p }, r => {
      let b = '';
      r.on('data', d => { b += d; });
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

// a raw protocol client
function bot(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = { ws, msgs: [], snaps: 0, events: [], view: {}, closed: false, name, devR: null };
  ws.on('message', d => {
    let m;
    try { m = JSON.parse(d.toString()); } catch (e) { return; }
    if (m.t === 's') {
      b.snaps++;
      if (m.v) Object.assign(b.view, m.v);
      if (m.e) b.events.push(...m.e);
      return;
    }
    if (m.t === 'dev') { b.devR = m; return; }
    b.msgs.push(m);
  });
  ws.on('close', () => { b.closed = true; });
  ws.on('error', () => {});
  b.open = new Promise(r => ws.on('open', r));
  b.send = o => ws.send(JSON.stringify(o));
  b.wait = async (pred, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = b.msgs.find(pred);
      if (m) return m;
      await sleep(20);
    }
    return null;
  };
  b.dev = async (js, ms = 60000) => {
    b.devR = null;
    b.send({ t: 'dev', js, id: 1 });
    const t0 = Date.now();
    while (!b.devR && Date.now() - t0 < ms) await sleep(20);
    return b.devR && b.devR.r;
  };
  b.hello = async () => { await b.open; b.send({ t: 'hello', v: 1, name }); await b.wait(m => m.t === 'welcome'); };
  return b;
}

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'maur-worlds-'));
const FILE = path.join(DATA, 'maurtua.json');
const readSave = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));

let port, srv, srvLog = '';
async function startServer() {
  port = await freePort();
  srvLog = '';
  srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(port), HOST: '127.0.0.1', MAUR_DEV: '1', DATA_DIR: DATA,
      PERSIST_WORLDS: 'MAURTUA,ENGA', AUTOSAVE_MS: '3000', RECONNECT_MS: '1500',
    }),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  srv.stdout.on('data', d => { srvLog += d; });
  srv.stderr.on('data', d => { srvLog += d; });
  for (let i = 0; i < 80; i++) {
    await sleep(100);
    try { const h = await getJson(port, '/api/health'); if (h.worlds && h.worlds.length === 2) return h; } catch (e) { /* not yet */ }
  }
  return null;
}
// a graceful stop: SIGTERM (POSIX) or the shutdown message (Windows, as pm2 sends)
async function stopServer() {
  const done = new Promise(r => srv.on('exit', code => r(code)));
  if (process.platform === 'win32') srv.send('shutdown'); else srv.kill('SIGTERM');
  return Promise.race([done, sleep(8000).then(() => 'timeout')]);
}
const world = (h, name) => h.worlds.find(w => w.name === name);

(async () => {
  // ---- boot: both worlds from config, saved at once, asleep -----------------
  let h = await startServer();
  check('the server boots both persistent worlds from PERSIST_WORLDS', h && world(h, 'MAURTUA') && world(h, 'ENGA') &&
    h.rooms === 0, h && h.worlds.map(w => w.name));
  check('a new world is saved at once (DATA_DIR)', fs.existsSync(FILE) && fs.existsSync(path.join(DATA, 'enga.json')));
  const t0 = world(h, 'MAURTUA').tick, e0 = world(h, 'ENGA').tick;
  await sleep(1500);
  h = await getJson(port, '/api/health');
  check('with nobody in it a world sleeps: its tick stands still', world(h, 'MAURTUA').sleeping && world(h, 'MAURTUA').tick === t0 &&
    world(h, 'ENGA').tick === e0 && h.load === 0, { t0, t1: world(h, 'MAURTUA').tick, load: h.load });

  // ---- the room browser lists the worlds; a player drops in -------------------
  const A = bot(port, 'ALPHA');
  await A.hello();
  A.send({ t: 'list' });
  const list = await A.wait(m => m.t === 'list');
  const lw = list && list.worlds.find(w => w.name === 'MAURTUA');
  check('the room browser lists the worlds (players, year, season, legacy)', lw && lw.players === 0 && lw.max === 4 &&
    lw.year === 1 && lw.season === 0 && lw.legacy === 0 && list.worlds.length === 2, list && list.worlds);
  A.send({ t: 'enter', name: 'maurtua' });
  const wm = await A.wait(m => m.t === 'world', 15000);
  const lob = await A.wait(m => m.t === 'lobby');
  check('entering a world: its terrain and the lobby state (mode world, its name)', wm && wm.mode === 'world' && wm.name === 'MAURTUA' &&
    lob && lob.state === 'play' && lob.mode === 'world' && lob.host === -1, lob && { mode: lob.mode, state: lob.state, host: lob.host });
  await sleep(800);
  h = await getJson(port, '/api/health');
  check('the world wakes and runs while someone is in it', !world(h, 'MAURTUA').sleeping && world(h, 'MAURTUA').tick > t0 + 20 &&
    world(h, 'MAURTUA').players === 1 && world(h, 'ENGA').tick === e0 && A.snaps > 5,
  { tick: world(h, 'MAURTUA').tick, snaps: A.snaps });
  check('a newcomer starts with no ant (JOIN THE COLONY)', A.view.p && A.view.p[lob.you] && A.view.p[lob.you].a === 0);
  A.send({ t: 'take', caste: 'worker' });
  await sleep(500);
  check('...and takes one', A.view.p[lob.you].a > 0);
  check('the world view carries mode, legacy and colony number', A.view.g && A.view.g.mode === 'world' && A.view.g.leg === 0 && A.view.g.gen === 1, A.view.g);

  // ---- autosave: atomic, with one backup -----------------------------------------
  const m0 = fs.statSync(FILE).mtimeMs;
  await sleep(4200);
  const files = fs.readdirSync(DATA).sort();
  let saveOk = false, bakOk = false;
  try { saveOk = readSave().v === 7 && readSave().mode === 'world'; } catch (e) { /* bad */ }
  try { bakOk = !!JSON.parse(fs.readFileSync(FILE + '.bak', 'utf8')).terrain; } catch (e) { /* bad */ }
  check('a running world autosaves (AUTOSAVE_MS), a whole v7 save with a .bak and no temp file left',
    /saved \(autosave/.test(srvLog) && fs.statSync(FILE).mtimeMs > m0 && saveOk && bakOk && !files.some(f => f.endsWith('.tmp')), files);

  // ---- a nuptial flight banks legacy, and the colony carries on --------------------
  const fl = await A.dev(`(() => {
    const c = G.colony;
    for (let i = 0; i < 2; i++) G.ants.push(new Ant(c.queenCh.x, c.queenCh.y, 'princess', c));
    G.tick = YEAR_DAYS * DAY_LEN - 3;
    for (let i = 0; i < FLIGHT_T + 20; i++) stepSim();
    return { legacy: G.legacy, hist: G.history, over: G.over, year: G.year, season: G.season, flight: G.flight,
      princesses: G.ants.filter(a => a.caste === 'princess').length, queen: !!c.queen() };
  })()`);
  check('the nuptial flight banks legacy (stars x 100 + princesses x 50) and the world goes on', fl && fl.legacy >= 200 && !fl.over &&
    fl.hist.length === 1 && fl.hist[0].out === 'flight' && fl.hist[0].flown === 2 && fl.hist[0].legacy === fl.legacy &&
    fl.year === 2 && fl.season === 0 && fl.queen, fl);
  await sleep(600);
  check('the players hear of it (legacy toast) and see it in the world view', A.events.some(e => e[0] === 'm' && e[1] === 'm_legacy') &&
    A.view.g.leg === fl.legacy && A.view.g.hist.length === 1);
  h = await getJson(port, '/api/health');
  check('the world list shows the legacy and year 2', world(h, 'MAURTUA').legacy === fl.legacy && world(h, 'MAURTUA').year === 2);
  // (the next year's milestones are bigger)
  const ob = await A.dev('G.objectives.list.map(o => o.need)');
  check('year 2 has bigger milestones', ob && ob[0] === 3 && ob[2] === 150, ob);

  // ---- the colony lost with no heir: the world starts over ---------------------------
  const seed0 = wm.seed;
  A.msgs = [];
  A.events = [];
  await A.dev(`G.brood = G.brood.filter(b => !b.royal); G.ants = G.ants.filter(a => a.caste !== 'princess'); G.colony.queen().hp = 0`);
  const wm2 = await A.wait(m => m.t === 'world', 15000);
  await sleep(800);
  const rb = await A.dev('({ seed: G.seed, legacy: G.legacy, gen: G.gen, hist: G.history, year: G.year, over: G.over, queen: !!G.colony.queen(), mine: G.players[0].ant })');
  check('a colony lost with no heir starts the world over: a new seed, legacy and history kept',
    wm2 && wm2.seed !== seed0 && rb.seed === wm2.seed && rb.legacy === fl.legacy && rb.gen === 2 && rb.hist.length === 2 &&
    rb.hist[1].out === 'lost' && rb.hist[1].reason === 'r_queen' && rb.year === 1 && !rb.over && rb.queen && rb.mine === null, rb);
  check('the players are told (the world reborn) and get the new world', A.events.some(e => e[0] === 'm' && e[1] === 'm_reborn') &&
    !A.msgs.some(m => m.t === 'over'));
  check('the rebirth is saved', /saved \(rebirth/.test(srvLog) && readSave().seed === wm2.seed && readSave().gen === 2);

  // ---- leaving: the world falls asleep, saved ----------------------------------------
  A.send({ t: 'leave' });
  await sleep(800);
  h = await getJson(port, '/api/health');
  const tz = world(h, 'MAURTUA').tick;
  await sleep(1200);
  const h2 = await getJson(port, '/api/health');
  check('left alone it falls asleep again (saved), and stays put', world(h2, 'MAURTUA').sleeping && world(h2, 'MAURTUA').tick === tz &&
    /asleep at tick/.test(srvLog) && readSave().tick === tz, { tz, now: world(h2, 'MAURTUA').tick, saved: readSave().tick });
  A.ws.close();

  // ---- a graceful stop saves the running state; a restart loads it ------------------------
  const B = bot(port, 'BETA');
  await B.hello();
  B.send({ t: 'enter', name: 'MAURTUA' });
  await B.wait(m => m.t === 'world', 15000);
  await sleep(500);
  const before = await B.dev(`(() => { G.colony.crystals = 4242; G.colony.food = 77.7;
    return { tick: G.tick, ants: G.ants.length, seed: G.seed, legacy: G.legacy, gen: G.gen, hist: G.history.length }; })()`);
  const code = await stopServer();
  const saved = readSave();
  check('a graceful stop (SIGTERM / shutdown message) saves the running world and exits cleanly', code === 0 &&
    /shutting down/.test(srvLog) && /saved \(closing/.test(srvLog) && saved.colonies[0].crystals === 4242 &&
    saved.tick >= before.tick, { code, saved: saved.tick, before: before.tick });
  h = await startServer();
  const w2 = h && world(h, 'MAURTUA');
  check('after a restart the world is back as it was saved (asleep)', w2 && w2.sleeping && w2.tick === saved.tick &&
    w2.legacy === before.legacy && w2.gen === 2, w2);
  const C = bot(port, 'GAMMA');
  await C.hello();
  C.send({ t: 'enter', name: 'MAURTUA' });
  const wm3 = await C.wait(m => m.t === 'world', 15000);
  const after = await C.dev(`({ tick: G.tick, ants: G.ants.length, seed: G.seed, legacy: G.legacy, gen: G.gen, hist: G.history.length,
    crystals: G.colony.crystals, food: G.colony.food, mode: G.mode })`);
  check('...the same seed, ants, legacy, history, colony state', wm3 && wm3.seed === before.seed && after.seed === before.seed &&
    after.ants === saved.ants.length && after.legacy === before.legacy && after.gen === before.gen && after.hist === before.hist &&
    after.crystals === 4242 && Math.abs(after.food - 77.7) < 0.2 && after.mode === 'world' &&
    after.tick >= saved.tick && after.tick < saved.tick + 600, { before, after });
  C.ws.close();
  await sleep(600);

  // ---- a corrupt save falls back to the backup ------------------------------------------------
  // (and ENGA: a save that parses but won't restore, with no backup that
  // does -- moved aside, never rotated into the .bak by the new world)
  await stopServer();
  fs.writeFileSync(FILE, '{"v":7,"terr');
  const EFILE = path.join(DATA, 'enga.json');
  const eBad = JSON.parse(fs.readFileSync(EFILE, 'utf8'));
  eBad.ants = null; eBad.legacy = 999;
  fs.writeFileSync(EFILE, JSON.stringify(eBad));
  try { fs.unlinkSync(EFILE + '.bak'); } catch (e) { /* none */ }
  h = await startServer();
  check('a corrupt save: the world loads from its .bak', h && world(h, 'MAURTUA') && world(h, 'MAURTUA').gen === 2 &&
    /loaded the backup|corrupt/.test(srvLog), h && world(h, 'MAURTUA'));
  const badF = fs.readdirSync(DATA).filter(f => f.startsWith('enga.json.bad-'));
  let badLegacy = -1;
  try { badLegacy = JSON.parse(fs.readFileSync(path.join(DATA, badF[0]), 'utf8')).legacy; } catch (e) { /* none */ }
  check('a save that won\'t restore is moved aside before a new world is saved', h && world(h, 'ENGA') &&
    world(h, 'ENGA').legacy === 0 && badF.length === 1 && badLegacy === 999, badF);

  // ---- in the browser: the world list, joining, the history page, leaving ----
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 960, height: 600 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + ' ' + String(e.stack).split('\n').slice(1, 4).join(' | ')));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(400);
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(70); } };
  await key('ArrowDown'); await key('Enter');
  await page.keyboard.type('Omega'); await key('Enter');
  await key('Enter');                      // PERSISTENT WORLDS
  await page.waitForFunction(() => G.state === 'networlds' && Net.list && Net.list.worlds.length === 2, null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/shot-net-worlds.png' });
  const rows = await page.evaluate(() => Net.list.worlds.map(w => w.name + ':' + w.legacy + ':' + w.gen));
  check('the page lists the worlds with their legacy and colony number', rows.join() === 'MAURTUA:200:2,ENGA:0:1', rows);
  await key('Enter');                      // MAURTUA
  await page.waitForFunction(() => G.state === 'play' && Net.ready, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const pj = await page.evaluate(() => ({ s: G.state, mode: G.mode, tk: !!G.takeover && !G.takeover.live, legacy: G.legacy, gen: G.gen,
    hist: G.history.length, msgs: G.msgs.map(m => m.text), title: Net.worldName }));
  check('entering MAURTUA: JOIN THE COLONY, the welcome with its colony and year', pj.s === 'play' && pj.mode === 'world' && pj.tk &&
    pj.legacy === 200 && pj.gen === 2 && pj.hist === 2 && pj.msgs.some(t => t.startsWith('WELCOME TO MAURTUA - COLONY 2')), pj);
  await page.screenshot({ path: 'test/shot-world-join.png' });
  await key('Enter');                      // an ant
  await page.waitForFunction(() => !!localAnt(), null, { timeout: 5000 }).catch(() => {});
  await key('o');
  const op = await page.evaluate(() => objPages());
  await key('ArrowLeft');                  // (back round to page 3: WORLD HISTORY)
  await page.waitForTimeout(150);
  const hp = await page.evaluate(() => G.objScreen && G.objScreen.page);
  await page.screenshot({ path: 'test/shot-world-history.png' });
  check('the O screen has a WORLD HISTORY page in a persistent world', op === 3 && hp === 2);
  await key('Escape');
  // the world starts over under the page: JOIN THE COLONY says why, no
  // welcome and no tutorial again; once an ant is picked, the reason first
  const tut0 = await page.evaluate(() => Tut.step);
  const D = bot(port, 'DELTA');
  await D.hello();
  D.send({ t: 'enter', name: 'MAURTUA' });
  await D.wait(m => m.t === 'world', 15000);
  await D.dev(`G.brood = G.brood.filter(b => !b.royal); G.ants = G.ants.filter(a => a.caste !== 'princess'); G.colony.queen().hp = 0`);
  await page.waitForFunction(() => G.gen === 3 && !!G.takeover, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test/shot-world-reborn.png' });
  const rb1 = await page.evaluate(() => ({ gen: G.gen, note: G.rebornNote, tk: !!G.takeover, tut: Tut.step, reborn: Net.reborn,
    msgs: G.msgs.map(m => m.text) }));
  check('a rebirth: JOIN THE COLONY shows the reason, no welcome, the tutorial left alone', rb1.gen === 3 && rb1.tk && rb1.reborn &&
    rb1.note && rb1.note.reason === 'r_queen' && rb1.note.gen === 3 && rb1.tut === tut0 &&
    !rb1.msgs.some(t => t.startsWith('WELCOME')), rb1);
  await key('Enter');                      // an ant
  await page.waitForFunction(() => !!localAnt(), null, { timeout: 5000 }).catch(() => {});
  const rb2 = await page.evaluate(() => G.msgs.map(m => m.text));
  const iq = rb2.indexOf('THE QUEEN DIED WITH NO HEIR'), ir = rb2.findIndex(t => t.startsWith('THE COLONY IS LOST - COLONY 3'));
  check('...then the reason, then the new colony', iq >= 0 && ir > iq, rb2);
  D.send({ t: 'leave' }); D.ws.close();
  await key('Escape');
  const pm = await page.evaluate(() => pauseItems().map(i => i.label));
  check('the online menu says LEAVE WORLD', pm.join() === 'RESUME,LEAVE WORLD', pm);
  await key('ArrowDown'); await key('Enter');
  await page.waitForTimeout(1500);
  h = await getJson(port, '/api/health');
  check('leaving from the menu: back to the world list, and the world sleeps again',
    (await page.evaluate(() => G.state === 'networlds' && !G.online && !!Net.list && Net.list.worlds.length === 2)) &&
    world(h, 'MAURTUA').sleeping && world(h, 'MAURTUA').players === 0);
  check('no page errors', !errors.length, errors);
  await browser.close();

  check('no crash, nothing uncaught', !/CRASHED|uncaught/.test(srvLog));
  await stopServer();
  if (fails.length) console.log('--- server log ---\n' + srvLog.split('\n').slice(-30).join('\n'));
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* leave it */ }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); try { srv.kill(); } catch (x) { /* gone */ } process.exit(1); });
