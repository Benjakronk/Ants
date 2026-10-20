// Online load: one room, 4 bot players sending random input for ~2 minutes
// on a mid-game colony; reports the server's ms per tick (the sim's step
// averaged over the whole run, and the snapshots on top), its CPU use, the
// load the server's guard sees (/api/health), and the bytes per second each
// client receives (JSON, and on the wire after permessage-deflate).
//   node test/netload.js [seconds=120] [--natural]
// (--natural: the colony as a day of play left it, ~35 ants; by default it
// is crowded up to a busy summer nest, 45 black + 35 red)
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const WebSocket = require(path.join(ROOT, 'server', 'node_modules', 'ws'));

const SECONDS = Number(process.argv[2]) || 120;
const NATURAL = process.argv.includes('--natural');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, info) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
  if (!ok) fails.push(name);
};

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

function bot(port, name, idx) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = { ws, name, idx, json: 0, snaps: 0, msgs: [], antId: 0, you: -1, devR: null };
  ws.on('message', d => {
    b.json += d.length;
    const m = JSON.parse(d.toString());
    if (m.t === 's') {
      b.snaps++;
      if (m.v && m.v.p && m.v.p[b.you]) b.antId = m.v.p[b.you].a;
    } else if (m.t === 'dev') b.devR = m;
    else { b.msgs.push(m); if (m.t === 'lobby') b.you = m.you; }
  });
  ws.on('error', () => {});
  b.open = new Promise(r => ws.on('open', r));
  b.send = o => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  b.wait = async (pred, ms = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = b.msgs.find(pred); if (m) return m; await sleep(20); }
    return null;
  };
  b.dev = async (js, ms = 120000) => {
    b.devR = null;
    b.send({ t: 'dev', js, id: 1 });
    const t0 = Date.now();
    while (!b.devR && Date.now() - t0 < ms) await sleep(50);
    return b.devR && b.devR.r;
  };
  // random play: a new urge every 0.2-0.8 s, presses now and then, a new ant when dead
  b.play = () => {
    let next = 0;
    b.timer = setInterval(() => {
      const now = Date.now();
      if (now < next) return;
      next = now + 200 + Math.random() * 600;
      const r = Math.random;
      b.send({ t: 'in', dx: [-1, 0, 1][Math.floor(r() * 3)], dy: r() < 0.25 ? -1 : r() < 0.3 ? 1 : 0, bite: r() < 0.35, build: r() < 0.1 });
      if (r() < 0.15) b.send({ t: 'act' });
      if (r() < 0.03) b.send({ t: 'mat' });
      if (r() < 0.03) b.send({ t: 'mark' });
      if (r() < 0.03) b.send({ t: 'abil' });
      if (!b.antId && r() < 0.3) b.send({ t: 'take', caste: ['worker', 'soldier', 'nurse'][Math.floor(r() * 3)] });
    }, 50);
  };
  return b;
}

(async () => {
  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), MAUR_DEV: '1', PERSIST_WORLDS: '0' }),
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 50; i++) { await sleep(100); try { await getJson(port, '/api/health'); break; } catch (e) { /* not yet */ } }

  const bots = [0, 1, 2, 3].map(i => bot(port, 'BOT' + (i + 1), i));
  await Promise.all(bots.map(b => b.open));
  for (const b of bots) b.send({ t: 'hello', v: 1, name: b.name });
  bots[0].send({ t: 'create' });
  const lobby = await bots[0].wait(m => m.t === 'lobby');
  for (const b of bots.slice(1)) b.send({ t: 'join', code: lobby.code });
  await Promise.all(bots.slice(1).map(b => b.wait(m => m.t === 'lobby')));
  bots[0].send({ t: 'start' });
  await Promise.all(bots.map(b => b.wait(m => m.t === 'world', 20000)));

  // a mid-game colony: a day on, then the numbers of a summer nest (both
  // colonies) -- the room's clock catches up afterwards
  const t0 = Date.now();
  const mid = await bots[0].dev(`(() => {
    for (let i = 0; i < DAY_LEN; i++) { stepSim(); G.events.length = 0; }
    const add = (c, n) => { for (let i = 0; i < n; i++) {
      const s = [c.junction, c.storage, c.nursery][i % 3];
      G.ants.push(new Ant(s.x + (Math.random() - 0.5) * 20, s.y - 4, ['worker', 'worker', 'soldier', 'nurse'][i % 4], c)); } };
    if (!${NATURAL}) add(G.colony, Math.max(0, 45 - G.colony.members().length));
    if (!${NATURAL}) add(G.rival, Math.max(0, 35 - G.rival.members().length));
    for (const c of G.colonies) c.recalcChambers();
    return { day: G.day, black: G.colony.members().length, red: G.rival.members().length, bugs: G.bugs.length, items: G.items.length };
  })()`);
  console.log('mid-game colony after', ((Date.now() - t0) / 1000).toFixed(0), 's of fast-forward:', JSON.stringify(mid));
  await sleep(3000);   // (settle: the catch-up and a burst of full snapshots)

  for (const b of bots) b.play();
  await sleep(3000);
  const s0 = await getJson(port, '/api/stats');
  const w0 = bots.map(b => ({ json: b.json, wire: b.ws._socket.bytesRead, snaps: b.snaps }));
  const tA = Date.now();
  console.log(`playing for ${SECONDS} s...`);
  let maxTick = 0;
  for (let s = 0; s < SECONDS; s += 10) {
    await sleep(Math.min(10, SECONDS - s) * 1000);
    const st = await getJson(port, '/api/stats');
    const r = st.rooms[0];
    if (r) maxTick = Math.max(maxTick, r.msTickMax);
    process.stdout.write(`  t+${s + 10}s tick ${r ? r.tick : '-'} ants ${r ? r.ants : '-'} ${r ? r.msTick : '-'} ms/tick\n`);
  }
  const s1 = await getJson(port, '/api/stats');
  const secs = (Date.now() - tA) / 1000;
  const per = bots.map((b, i) => ({
    name: b.name,
    jsonKBs: +((b.json - w0[i].json) / secs / 1024).toFixed(1),
    wireKBs: +((b.ws._socket.bytesRead - w0[i].wire) / secs / 1024).toFixed(1),
    snapsPerSec: +((b.snaps - w0[i].snaps) / secs).toFixed(1),
  }));
  const room = s1.rooms[0], r0 = s0.rooms[0];
  const cpu = ((s1.cpuUserMs + s1.cpuSystemMs) - (s0.cpuUserMs + s0.cpuSystemMs)) / (secs * 1000) * 100;
  const ticks = room.tick - r0.tick;
  const avgStep = (room.stepMs - r0.stepMs) / Math.max(1, room.ticks - r0.ticks);
  const avgSnap = ((room.busyMs - r0.busyMs) - (room.stepMs - r0.stepMs)) / Math.max(1, room.ticks - r0.ticks);
  const health = await getJson(port, '/api/health');
  console.log('\nRESULTS over ' + secs.toFixed(0) + ' s, ' + room.ants + ' ants:');
  console.log('  server: ' + avgStep.toFixed(3) + ' ms/tick (sim step, the whole run; EWMA now ' + room.msTick + '), slowest ' + maxTick +
    ' ms, snapshots ' + avgSnap.toFixed(3) + ' ms/tick, ' + (ticks / secs).toFixed(1) + ' ticks/s, CPU ' + cpu.toFixed(1) +
    '% of a core, RSS ' + s1.rssMB + ' MB, guard load ' + health.load + ' of ' + health.budget + ' ms/frame');
  for (const p of per) console.log(`  ${p.name}: ${p.jsonKBs} KB/s JSON, ${p.wireKBs} KB/s on the wire, ${p.snapsPerSec} snapshots/s`);
  check('the room keeps 60 ticks a second', ticks / secs > 57, +(ticks / secs).toFixed(1));
  check('every client gets ~20 snapshots a second', per.every(p => p.snapsPerSec > 18), per.map(p => p.snapsPerSec));
  check('every client under 40 KB/s on the wire', per.every(p => p.wireKBs < 40), per.map(p => p.wireKBs));
  check('the server spends well under a core', cpu < 60, +cpu.toFixed(1));
  check('no crash', !log.includes('CRASHED') && !log.includes('uncaught'));
  for (const b of bots) { clearInterval(b.timer); b.ws.close(); }
  srv.kill();
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
