// Online probe: the server as a child process, two browser pages (B with an
// artificial 80 ms round trip) and raw Node WebSocket clients.
//   node test/netprobe.js
// Room by code, lobby, start, terrain + snapshots, input moving the other
// player's ant, a dig showing up in the other page's terrain, takeover per
// player, a message to one player only, a dropped connection (and a page
// reload) reclaiming the slot, the match's end screen, the empty room
// closing, malformed messages and floods, a full room, /api/health.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
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

// a raw protocol client (no browser)
function bot(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = { ws, msgs: [], closed: false, name };
  ws.on('message', d => { try { b.msgs.push(JSON.parse(d.toString())); } catch (e) { /* not json */ } });
  ws.on('close', () => { b.closed = true; });
  ws.on('error', () => {});
  b.open = new Promise(r => ws.on('open', r));
  b.send = o => ws.send(typeof o === 'string' ? o : JSON.stringify(o));
  b.wait = async (pred, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = b.msgs.find(pred);
      if (m) return m;
      await sleep(20);
    }
    return null;
  };
  return b;
}

(async () => {
  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(port), HOST: '127.0.0.1', MAUR_DEV: '1',
      ROOM_IDLE_MS: '3000', RECONNECT_MS: '10000', ROOM_OVER_MS: '60000', MAX_ROOMS: '6',
    }),
  });
  let srvLog = '';
  srv.stdout.on('data', d => { srvLog += d; });
  srv.stderr.on('data', d => { srvLog += d; });
  let health = null;
  for (let i = 0; i < 50 && !health; i++) { await sleep(100); try { health = await getJson(port, '/api/health'); } catch (e) { /* not yet */ } }
  check('/api/health answers', health && health.ok === true && health.rooms === 0 && health.players === 0 &&
    typeof health.uptime === 'number', health);

  const browser = await chromium.launch();
  const errors = [];
  const mkPage = async (q) => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
    await page.goto(`http://127.0.0.1:${port}/${q || ''}`);
    await page.waitForTimeout(500);
    // a hook for the server's test answers
    await page.evaluate(() => {
      const orig = Net.handle.bind(Net);
      Net.handle = async m => { if (m.t === 'dev') { window.__dev = m; return; } return orig(m); };
    });
    return page;
  };
  // run code in the room's simulation (MAUR_DEV), through a page in the room
  let devId = 0;
  const dev = async (page, js) => {
    const id = ++devId;
    await page.evaluate(([js, id]) => { window.__dev = null; Net.send({ t: 'dev', js, id }); }, [js, id]);
    await page.waitForFunction(id => window.__dev && window.__dev.id === id, id, { timeout: 5000 });
    return page.evaluate(() => window.__dev.r);
  };

  const A = await mkPage();
  const B = await mkPage('?lag=80');

  // A: title -> ONLINE -> name -> CREATE
  await A.keyboard.press('ArrowDown');
  await A.keyboard.press('Enter');
  await A.waitForTimeout(100);
  check('the title offers ONLINE (second item)', await A.evaluate(() => G.state === 'netname'));
  await A.waitForTimeout(100);
  await A.keyboard.type('Alpha');
  await A.keyboard.press('Enter');
  await A.waitForTimeout(100);
  await A.keyboard.press('Enter');   // CREATE A MATCH
  await A.waitForFunction(() => G.state === 'lobby' && Net.code, null, { timeout: 5000 });
  const code = await A.evaluate(() => Net.code);
  check('creating a match gives a 4-letter room code', /^[A-HJ-NP-Z]{4}$/.test(code), code);
  check('the name is remembered', await A.evaluate(() => localStorage.getItem('maur_name') === 'ALPHA'));

  // B: join with the code, typed in lower case
  await B.keyboard.press('ArrowDown');
  await B.keyboard.press('Enter');
  await B.waitForTimeout(100);
  await B.keyboard.type('beta');
  await B.keyboard.press('Enter');
  await B.waitForTimeout(100);
  await B.keyboard.press('ArrowDown');
  await B.keyboard.press('Enter');   // JOIN WITH A CODE
  await B.waitForTimeout(100);
  await B.keyboard.type(code.toLowerCase());
  await B.keyboard.press('Enter');
  await B.waitForFunction(() => G.state === 'lobby' && Net.players.length === 2, null, { timeout: 5000 })
    .catch(async e => { console.log('B:', await B.evaluate(() => ({ s: G.state, err: Net.err, code: G.codeBuf, name: G.nameBuf }))); throw e; });
  await A.waitForFunction(() => Net.players.filter(Boolean).length === 2, null, { timeout: 5000 });
  const lob = await A.evaluate(() => ({ names: Net.players.map(p => p.n), you: Net.you, host: Net.host }));
  check('the lobby shows both players (code case-insensitive)', lob.names.join() === 'ALPHA,BETA' && lob.host === 0, lob);
  await A.screenshot({ path: 'test/shot-net-lobby.png' });
  check('only the host may start', await B.evaluate(() => Net.you === 1 && Net.host === 0));

  // A starts
  await A.keyboard.press('Enter');
  await A.waitForFunction(() => G.state === 'play' && Net.ready, null, { timeout: 20000 });
  await B.waitForFunction(() => G.state === 'play' && Net.ready, null, { timeout: 20000 });
  // the terrain, checked against the server's: in test builds every 20th
  // snapshot carries a hash of the terrain as it leaves it (NPCs dig all
  // the time, so only the same tick compares). Checked all through the test.
  for (const p of [A, B]) {
    await p.evaluate(() => {
      window.__th = { ok: 0, bad: [] };
      const orig = Net.snap.bind(Net);
      Net.snap = m => {
        orig(m);
        if (m.th === undefined || !Net.inMatch) return;
        let h = 0x811c9dc5 | 0;
        for (let i = 0; i < T.m.length; i += 7) h = Math.imul(h ^ T.m[i], 16777619);
        if ((h >>> 0) === m.th) window.__th.ok++; else window.__th.bad.push(m.k);
      };
    });
  }
  await A.waitForTimeout(2500);
  const th1 = await Promise.all([A, B].map(p => p.evaluate(() => window.__th)));
  check('both pages hold the server\'s terrain (same tick, same hash)', th1.every(t => t.ok >= 2 && !t.bad.length), th1);
  const st = await Promise.all([A, B].map(p => p.evaluate(() => ({
    snaps: Net.stats.snaps, ants: G.ants.length, you: LOCAL, mine: !!localAnt(), online: G.online,
    caps: !!G.colony.caps, players: G.players.map(p => p.name),
  }))));
  check('both pages get snapshots: ants, their own ant, the players', st.every((s, i) => s.snaps > 5 && s.ants > 15 &&
    s.you === i && s.mine && s.online && s.caps && s.players.join() === 'ALPHA,BETA'), st);
  await A.screenshot({ path: 'test/shot-net-play.png' });

  // B walks right: the server moves B's ant, A sees it go
  const srvB0 = await dev(A, 'G.players[1].ant.x');
  const seenB0 = await A.evaluate(() => G.players[1].ant.x);
  // (B's drawn x, every frame of the walk and the stop after it)
  await B.evaluate(() => {
    window.__xs = [];
    const f = () => { const me = localAnt(); if (me) window.__xs.push(me.x); if (window.__xs.length < 200) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await B.keyboard.down('d');
  // (prediction: the drawn ant answers the key at once, despite the lag)
  await B.waitForTimeout(70);
  const predB = await B.evaluate(x0 => localAnt().x - x0, seenB0);
  await B.waitForTimeout(1400);
  await B.keyboard.up('d');
  await B.waitForTimeout(1200);
  const xsB = await B.evaluate(() => window.__xs);
  const srvB1 = await dev(A, 'G.players[1].ant.x');
  const seenB1 = await A.evaluate(() => G.players[1].ant.x);
  const ownB1 = await B.evaluate(() => localAnt().x);
  check('input from B moves B\'s ant on the server', srvB1 - srvB0 > 20, (srvB1 - srvB0).toFixed(1) + ' px');
  check('A sees B\'s ant move', Math.abs((seenB1 - seenB0) - (srvB1 - srvB0)) < 12 && seenB1 - seenB0 > 20,
    { seen: +(seenB1 - seenB0).toFixed(1), server: +(srvB1 - srvB0).toFixed(1) });
  check('B\'s own ant moves at once under 80 ms lag (prediction)', predB > 0.5, predB.toFixed(2) + ' px after 70 ms');
  check('B\'s predicted ant settles where the server has it', Math.abs(ownB1 - srvB1) < 3, { own: ownB1, server: srvB1 });
  // (and gets there smoothly: it never runs on past where the server stops,
  // nor jumps back when the key is let go)
  let jumpB = 0;
  for (let i = 1; i < xsB.length; i++) jumpB = Math.max(jumpB, Math.abs(xsB[i] - xsB[i - 1]));
  const overB = Math.max(...xsB) - srvB1;
  check('B\'s predicted walk under 80 ms lag: no overshoot, no snap back', xsB.length > 100 && overB < 4 && jumpB < 3,
    { frames: xsB.length, overshoot: +overB.toFixed(1), maxStep: +jumpB.toFixed(1) });
  check('A draws B\'s name tag', await A.evaluate(() => G.players[1].name === 'BETA' && G.players[1].ant.playerIdx === 1));

  // A digs down: B's terrain shows the hole
  const box = await dev(A, '(() => { const a = G.players[0].ant; return { x: Math.round(a.x), y: Math.round(a.y) }; })()');
  const airIn = `((x0, y0) => { let n = 0; for (let y = y0; y < y0 + 30; y++) for (let x = x0 - 10; x <= x0 + 10; x++) if (T.m[y * WORLD_W + x] === 0) n++; return n; })(${box.x}, ${box.y})`;
  const airB0 = await B.evaluate(airIn);
  await A.keyboard.down('s');
  await A.keyboard.down(' ');
  await A.waitForTimeout(2500);
  await A.keyboard.up(' ');
  await A.keyboard.up('s');
  await A.waitForTimeout(500);
  const airB1 = await B.evaluate(airIn), airA1 = await A.evaluate(airIn), airS1 = await dev(A, airIn);
  check('a dig by A appears in B\'s terrain', airB1 > airB0 + 20 && airB1 === airS1 && airA1 === airS1,
    { before: airB0, B: airB1, A: airA1, server: airS1 });
  // (every hole in the material map is clear on B's terrain canvas)
  const stale = await B.evaluate(([x0, y0]) => {
    TerrainView.flush();
    const img = TerrainView.terCtx.getImageData(x0 - 10, y0, 21, 30).data;
    let n = 0;
    for (let y = 0; y < 30; y++) for (let x = 0; x < 21; x++) {
      const air = T.m[(y0 + y) * WORLD_W + x0 - 10 + x] === 0, clear = img[(y * 21 + x) * 4 + 3] === 0;
      if (air !== clear) n++;
    }
    return n;
  }, [box.x, box.y]);
  check('B\'s terrain view repainted it', stale === 0, stale + ' stale pixels');
  check('the server reports both players\' soil loads', (await A.evaluate(() => localAnt().soil)) > 0);

  // takeover per player: A switches (Tab), B keeps its ant
  const ids0 = await dev(A, 'G.players.map(p => p.ant && p.ant.id)');
  await A.keyboard.press('Tab');
  await A.waitForTimeout(150);
  const tkOpen = await A.evaluate(() => !!G.takeover && G.takeover.live);
  await A.keyboard.press('ArrowDown');   // a soldier
  await A.keyboard.press('Enter');
  await A.waitForFunction(id => localAnt() && localAnt().id !== id && localAnt().caste === 'soldier', ids0[0], { timeout: 4000 }).catch(() => {});
  const ids1 = await dev(A, 'G.players.map(p => p.ant && p.ant.id)');
  const tk = await A.evaluate(() => ({ id: localAnt() && localAnt().id, caste: localAnt() && localAnt().caste }));
  check('takeover works per player (A switched, B kept its ant)', tkOpen && ids1[0] !== ids0[0] && ids1[1] === ids0[1] &&
    tk.id === ids1[0] && tk.caste === 'soldier', { ids0, ids1, tk });
  check('no two players control the same ant', ids1[0] !== ids1[1] &&
    await dev(A, 'G.ants.filter(a => a.playerIdx >= 0).length') === 2);

  // a message to one player reaches only that player
  await A.evaluate(() => { G.msgs = []; });
  await B.evaluate(() => { G.msgs = []; });
  await dev(A, "G.msg('m_milked', [], null, 1); G.msg('m_fed', [], null, 0); G.msg('m_eggLaid', [])");
  await A.waitForTimeout(700);
  const mA = await A.evaluate(() => G.msgs.map(m => m.text)), mB = await B.evaluate(() => G.msgs.map(m => m.text));
  check('an event message reaches only its target (and a broadcast both)',
    mB.includes('MILKED THE APHID! +HONEYDEW') && !mA.includes('MILKED THE APHID! +HONEYDEW') &&
    mA.includes('FED THE LARVA') && !mB.includes('FED THE LARVA') &&
    mA.includes('THE QUEEN HAS LAID AN EGG') && mB.includes('THE QUEEN HAS LAID AN EGG'), { A: mA, B: mB });
  // a player's death is told to the other by name
  await dev(A, "G.players[1].ant.hp = 0");
  await A.waitForTimeout(700);
  check('A hears of B\'s death by name', (await A.evaluate(() => G.msgs.map(m => m.text))).includes('BETA DIED!'));
  await B.waitForFunction(() => G.takeover && !G.takeover.live, null, { timeout: 3000 }).catch(() => {});
  check('B, dead, gets the takeover overlay', await B.evaluate(() => !!G.takeover && !G.takeover.live));
  await B.keyboard.press('Enter');
  await B.waitForFunction(() => !!localAnt(), null, { timeout: 4000 }).catch(() => {});
  check('B takes over a new ant', await B.evaluate(() => !!localAnt() && !G.takeover));

  // B's connection drops: its ant carries on as an NPC, the token takes it back
  const bAnt = await dev(A, 'G.players[1].ant.id');
  await B.evaluate(() => Net.ws.close());
  await B.waitForTimeout(400);
  const lost = await dev(A, `({ ant: G.players[1].ant, npc: (G.ants.find(a => a.id === ${bAnt}) || {}).playerIdx })`);
  const lostUi = await B.evaluate(() => Net.status);
  await B.screenshot({ path: 'test/shot-net-lost.png' });
  check('a dropped player\'s ant carries on as one of the colony', lost.ant === null && lost.npc === -1, lost);
  check('the client shows CONNECTION LOST and retries', lostUi === 'lost');
  await B.waitForFunction(() => Net.status === 'open' && Net.ready, null, { timeout: 8000 }).catch(() => {});
  await B.waitForTimeout(500);
  const back = await dev(A, 'G.players[1].ant && G.players[1].ant.id');
  check('reconnecting with the token reclaims the slot and the ant', back === bAnt &&
    await B.evaluate(() => LOCAL === 1 && G.state === 'play' && !!localAnt()), { back, bAnt });
  // a reload: the tab's session finds the room again
  await B.reload();
  await B.waitForTimeout(300);
  await B.evaluate(() => {
    const orig = Net.handle.bind(Net);
    Net.handle = async m => { if (m.t === 'dev') { window.__dev = m; return; } return orig(m); };
  });
  await B.waitForFunction(() => G.state === 'play' && Net.ready, null, { timeout: 15000 }).catch(() => {});
  const rl = await B.evaluate(() => ({ state: G.state, you: LOCAL, ant: localAnt() && localAnt().id }));
  check('a page reload rejoins the match in the same slot', rl.state === 'play' && rl.you === 1 && rl.ant === bAnt, rl);
  check('the server counts 2 players in 1 room', (await getJson(port, '/api/health')).players === 2);

  // a third player joins the running match: it picks its ant from the overlay
  const C = await mkPage();
  await C.keyboard.press('ArrowDown');
  await C.keyboard.press('Enter');
  await C.waitForTimeout(100);
  await C.keyboard.type('Gamma');
  await C.keyboard.press('Enter');
  await C.waitForTimeout(100);
  await C.keyboard.press('ArrowDown');
  await C.keyboard.press('Enter');
  await C.waitForTimeout(100);
  await C.keyboard.type(code);
  await C.keyboard.press('Enter');
  await C.waitForFunction(() => G.state === 'play' && Net.ready, null, { timeout: 20000 }).catch(() => {});
  await C.waitForTimeout(300);
  const cj = await C.evaluate(() => ({ state: G.state, you: LOCAL, ant: !!localAnt(), overlay: !!G.takeover && !G.takeover.live,
    fresh: !G.players[LOCAL].deathPos }));
  await C.screenshot({ path: 'test/shot-net-join.png' });
  check('joining mid-match: a fresh slot and the JOIN THE COLONY overlay', cj.state === 'play' && cj.you === 2 && !cj.ant &&
    cj.overlay && cj.fresh, cj);
  await C.keyboard.press('Enter');
  await C.waitForFunction(() => !!localAnt(), null, { timeout: 4000 }).catch(async () => {
    console.log('C:', await C.evaluate(() => ({ tk: G.takeover, st: G.state, you: LOCAL, wait: Net.takeWait, p: G.players.map(p => p && [p.name, p.antId]) })));
    console.log('srv:', await dev(A, 'G.players.map(p => [p.name, p.ant && p.ant.id, p.col])'));
  });
  const cAnt = await C.evaluate(() => ({ ant: localAnt() && localAnt().id, idx: localAnt() && localAnt().playerIdx, you: LOCAL,
    tk: !!G.takeover, st: G.state }));
  check('the newcomer gets an ant', cAnt.ant && cAnt.idx === 2 && !cAnt.tk, cAnt);
  if (!(cAnt.ant && cAnt.idx === 2)) {
    console.log('srv:', await dev(A, 'G.players.map(p => [p.name, p.ant && p.ant.id])'), await dev(A, 'G.ants.filter(a => a.playerIdx >= 0).map(a => [a.id, a.playerIdx])'));
    console.log('C:', await C.evaluate(() => G.players.map(p => [p.name, p.antId, p.ant && p.ant.id])));
  }
  await A.waitForTimeout(400);
  check('the others are told who joined', (await A.evaluate(() => G.msgs.map(m => m.text))).includes('GAMMA JOINED THE COLONY'));
  // any player buys upgrades for the colony with its crystals
  await dev(A, 'G.colony.crystals = 10');
  await C.waitForTimeout(300);
  await C.keyboard.press('o');
  await C.waitForTimeout(100);
  await C.keyboard.press('ArrowRight');
  await C.waitForTimeout(100);
  await C.keyboard.press('Enter');
  await C.waitForTimeout(600);
  const up = await dev(A, '({ lv: G.colony.upg.mandibles, cr: G.colony.crystals })');
  const upA = await A.evaluate(() => ({ lv: G.colony.upg.mandibles, cr: G.colony.crystals }));
  check('an upgrade bought by one player is the colony\'s (all see it)', up.lv === 1 && up.cr < 10 && upA.lv === 1 && upA.cr === up.cr, { up, upA });
  await C.keyboard.press('Escape');   // close O
  await C.waitForTimeout(150);
  // C leaves by the menu: its slot empties, the others are told
  await C.keyboard.press('Escape');
  await C.waitForTimeout(150);
  await C.keyboard.press('ArrowDown');
  await C.keyboard.press('Enter');
  await C.waitForTimeout(600);
  check('LEAVE MATCH goes to the title', await C.evaluate(() => G.state === 'title' && !G.online));
  check('the slot is freed and the others are told', (await dev(A, 'G.players[2].name')) === null &&
    (await A.evaluate(() => G.msgs.map(m => m.text))).includes('GAMMA LEFT THE MATCH'));
  await C.close();
  // the map and the guide arrow online
  await A.keyboard.press('m');
  await A.waitForTimeout(200);
  await A.screenshot({ path: 'test/shot-net-map.png' });
  check('the map opens online', await A.evaluate(() => G.showMap));
  await A.keyboard.press('m');

  const th2 = await A.evaluate(() => window.__th);
  check('A\'s terrain matched the server\'s all along (digging, building, NPCs)', th2.ok > th1[0].ok + 5 && !th2.bad.length, th2);

  // the online pause menu: the world keeps running
  const t0 = await A.evaluate(() => G.tick);
  await A.keyboard.press('Escape');
  await A.waitForTimeout(600);
  const pm = await A.evaluate(() => ({ state: G.state, items: pauseItems().map(i => i.id) }));
  const t1 = await A.evaluate(() => G.tick);
  check('online pause: RESUME / LEAVE MATCH, and the world runs on', pm.state === 'pause' &&
    pm.items.join() === 'resume,leave' && t1 > t0 + 20, { pm, ticks: t1 - t0 });
  await A.screenshot({ path: 'test/shot-net-pause.png' });
  await A.keyboard.press('Escape');

  // the match ends: both see the end screen, then go back to the title
  await dev(A, "gameOver(false, 'r_extinct')");
  await A.waitForFunction(() => G.state === 'gameover', null, { timeout: 4000 }).catch(() => {});
  await B.waitForFunction(() => G.state === 'gameover', null, { timeout: 4000 }).catch(() => {});
  const ov = await Promise.all([A, B].map(p => p.evaluate(() => ({ state: G.state, reason: G.gameOverStats && G.gameOverStats.reason }))));
  check('the match end shows on every page', ov.every(o => o.state === 'gameover' && o.reason === 'r_extinct'), ov);
  await A.screenshot({ path: 'test/shot-net-over.png' });
  await A.keyboard.press('Enter');
  await A.waitForTimeout(200);
  check('the end screen goes back to the title', await A.evaluate(() => G.state === 'title' && !G.online));
  // a reload on the end screen: the online end screen again (no CONTINUE
  // into a world that isn't there)
  await B.reload();
  await B.waitForFunction(() => G.state === 'gameover', null, { timeout: 8000 }).catch(() => {});
  const ovB = await B.evaluate(() => ({ state: G.state, online: G.online }));
  await B.keyboard.press('Enter');
  await B.waitForTimeout(300);
  const ovB2 = await B.evaluate(() => ({ state: G.state, online: G.online, running: G.running }));
  check('a reload on the end screen shows it online, and Enter goes to the title', ovB.state === 'gameover' && ovB.online &&
    ovB2.state === 'title' && !ovB2.online && !ovB2.running, { ovB, ovB2 });
  await B.close();
  // the room is empty now: it closes
  let h2 = null;
  for (let i = 0; i < 60; i++) { await sleep(200); h2 = await getJson(port, '/api/health'); if (h2.rooms === 0) break; }
  check('the room closes when empty', h2 && h2.rooms === 0, h2);

  // ---- raw clients: errors, malformed messages, floods, a full room --------
  const x = bot(port, 'X');
  await x.open;
  x.send({ t: 'create' });
  check('nothing before hello', !!(await x.wait(m => m.t === 'error' && m.key === 'e_hello')));
  x.send({ t: 'hello', v: 999, name: 'x' });
  check('a client of another version is told so', !!(await x.wait(m => m.t === 'error' && m.key === 'e_version')));
  x.send({ t: 'hello', v: 1, name: '<script>alert(1)</script>VERYLONGNAMEINDEED' });
  await x.wait(m => m.t === 'welcome');
  x.send({ t: 'join', code: 'ZZZZ' });
  check('an unknown code is refused', !!(await x.wait(m => m.t === 'error' && m.key === 'e_noRoom')));
  x.send({ t: 'resume', code: 'ZZZZ', token: 'abc' });
  check('resuming into a room that is gone: the match was closed', !!(await x.wait(m => m.t === 'closed' && m.key === 'e_closed')));
  x.send({ t: 'create', mode: 'versus' });
  check('an unknown mode is refused (versus is Phase 4b)', !!(await x.wait(m => m.t === 'error' && m.key === 'e_mode')));
  for (const junk of ['', 'null', '[]', '{"t":5}', '{"t":"in","dx":"NaN"}', '{"t":"join","code":{}}', '{"t":"take","caste":"queen"}',
    '{"t":"buy","id":"__proto__"}', '{"t":"resume","code":"ABCD","token":' + JSON.stringify('x'.repeat(100)) + '}',
    '{"t":"dev","js":"process.exit(1)"}', '\u0000\u0001\u0002', '{"t":"start"}', '{"t":"leave"}']) x.send(junk);
  x.ws.send(Buffer.from([1, 2, 3, 4]));
  x.send({ t: 'create' });
  const lb = await x.wait(m => m.t === 'lobby');
  check('after junk the server still works (and names are cleaned)', lb && lb.players[0].n === 'SCRIPTALERT1', lb && lb.players[0]);
  // fill the room: 4 players, the 5th is turned away
  const others = [];
  for (const n of ['Y', 'Z', 'W', 'V']) {
    const o = bot(port, n);
    await o.open;
    o.send({ t: 'hello', v: 1, name: n });
    o.send({ t: 'join', code: lb.code.toLowerCase() });
    others.push(o);
  }
  await sleep(400);
  check('a room takes 4 players and turns the 5th away', others.slice(0, 3).every(o => o.msgs.some(m => m.t === 'lobby')) &&
    others[3].msgs.some(m => m.t === 'error' && m.key === 'e_full'));
  // in a running match, junk input is clamped and a flood is cut off
  x.send({ t: 'start' });
  await x.wait(m => m.t === 's', 15000);
  for (const junk of [{ t: 'in', dx: 1e9, dy: -Infinity, bite: 'yes', cx: -5, cy: 1e12 }, { t: 'in', dx: null },
    { t: 'take', caste: 'princess' }, { t: 'buy', id: 'constructor' }, { t: 'act', extra: 'x'.repeat(3000) }]) x.send(junk);
  x.send('x'.repeat(10000));   // over maxPayload: the server drops this socket
  await sleep(300);
  check('an oversized message closes only that socket', x.closed && !others[0].closed);
  const fl = others[0];
  for (let i = 0; i < 1500; i++) fl.send({ t: 'in', dx: i % 2 ? 1 : -1, dy: 0 });
  await sleep(500);
  check('a flood is cut off', fl.closed);
  const h3 = await getJson(port, '/api/health');
  check('the server survives it all', h3.ok === true && srv.exitCode === null, h3);
  const dead = srvLog.includes('CRASHED') || srvLog.includes('uncaught');
  check('no room crashed, nothing uncaught', !dead);
  for (const o of others) o.ws.close();

  console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
  if (fails.length) console.log('--- server log ---\n' + srvLog.split('\n').slice(-40).join('\n'));
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  await browser.close();
  srv.kill();
  process.exit(errors.length || fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
