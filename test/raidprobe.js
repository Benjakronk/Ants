// Raid probe: a players' colony calls its own raids (Z) and a player's
// chamber markers stay near the nest. The sim alone (plain Node, a vm per
// world): Z sends the colony's fit NPCs (soldiers and thieves) on the
// march, the whole colony is told; a second call while it runs, a call
// again before the colony has mustered, and one in winter are refused; the
// raid plays out (march, the enemy warned, food carried off, home) and the
// players hear their raiders turn for home. Versus: black's raiders warn red
// as ENEMY raiders, not red ones. Chambers: a hollow far from the nest, and
// one past the cap, are refused; a near one is marked.
//   node test/raidprobe.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

const fails = [];
const check = (name, ok, info) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info !== undefined ? '  ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''));
  if (!ok) fails.push(name);
};

function simCtx(seed) {
  let s = (seed * 2654435761) >>> 0;
  const M = Object.create(Math);
  M.random = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ctx = vm.createContext({ console, Math: M, btoa, atob });
  for (const f of ['worldgen.js', 'terrain.js', 'entities.js', 'colony.js', 'game.js', 'save.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  }
  const run = code => vm.runInContext(code, ctx);
  run.json = code => JSON.parse(run(`JSON.stringify(${code})`));
  return run;
}

// ---- co-op: Z against the red AI ---------------------------------------------
{
  const run = simCtx(11);
  run(`newWorld(4711, 1, 'coop', 1, 'full');`);
  const r = run.json(`(() => {
    const out = {};
    const col = G.colony, p = G.players[0];
    const msgs = () => { const m = G.events.filter(e => e.t === 'msg').map(e => e.key); G.events.length = 0; return m; };
    const press = () => { p.input.raid = true; stepSim(); return msgs(); };
    G.tick = SEASON_DAYS * DAY_LEN + 600;   // summer
    stepSim(); msgs();
    out.first = press();
    out.raiders = G.ants.filter(a => a.raiding && a.colony === col).map(a => a.raidRole);
    out.again = press();
    out.foodRed0 = Math.round(G.colonies[1].food);
    let back = false, t = 0;
    for (; t < 60 * 60 * 9 && col.raid; t++) {
      stepSim();
      if (G.events.some(e => e.t === 'msg' && e.key === 'm_raidBack')) back = true;
      G.events.length = 0;
    }
    out.over = !col.raid; out.back = back; out.min = +(t / 3600).toFixed(1);
    out.stolen = col.stats.raids;
    out.foodRed1 = Math.round(G.colonies[1].food);
    out.wait = press();
    col.raidReadyT = 0;
    G.tick = 3 * SEASON_DAYS * DAY_LEN + 600;   // winter
    stepSim(); msgs();
    out.winter = press();
    return out;
  })()`);
  check('Z: the colony is told RAID!, soldiers and thieves march', r.first.includes('m_raidGo') &&
    r.raiders.length >= 3 && r.raiders.includes('fight') && r.raiders.includes('steal'), { first: r.first, raiders: r.raiders });
  check('a second Z while it runs: already under way', r.again.includes('m_raidOn'), r.again);
  check('the raid plays out and the raiders turn for home (told)', r.over && r.back, { min: r.min, back: r.back, red: [r.foodRed0, r.foodRed1] });
  check('Z again before the colony has mustered: wait', r.wait.includes('m_raidWait'), r.wait);
  check('Z in winter: no raids', r.winter.includes('m_raidWinter'), r.winter);
}

// ---- versus: black's raiders are ENEMY raiders to red ------------------------
{
  const run = simCtx(12);
  run(`newWorld(4712, 2, 'versus', 2, 'full');`);
  const v = run.json(`(() => {
    const black = G.colonies[0], red = G.colonies[1];
    const pB = G.players.findIndex((p, i) => playerColony(i) === black);
    G.tick = SEASON_DAYS * DAY_LEN + 600;
    stepSim(); G.events.length = 0;
    G.players[pB].input.raid = true;
    let warn = null;
    for (let t = 0; t < 60 * 60 * 6 && !warn; t++) {
      stepSim();
      const e = G.events.find(e => e.t === 'msg' && /^m_raid(P)?$/.test(e.key));
      if (e) warn = { key: e.key, col: e.col };
      G.events.length = 0;
    }
    return { warn, red: red.idx, sent: G.ants.filter(a => a.raiding && a.colony === black).length };
  })()`);
  check('versus: red is warned of ENEMY raiders (not red ones)', v.warn && v.warn.key === 'm_raidP' && v.warn.col === v.red, v);
}

// ---- chambers: near the nest, and not without end -----------------------------
{
  const run = simCtx(13);
  run(`newWorld(4713, 1, 'coop', 1, 'full');`);
  const c = run.json(`(() => {
    const col = G.colony, p = G.players[0], a = p.ant;
    const msgs = () => { const m = G.events.filter(e => e.t === 'msg').map(e => e.key); G.events.length = 0; return m; };
    // a roomy hollow dug at x, deep enough for a chamber
    const hollow = x => {
      const y = Math.round(T.surf[x] + 120);
      for (let dx = -26; dx <= 26; dx += 3) for (let dy = -12; dy <= 12; dy += 3) T.dig(x + dx, y + dy, 5, 99);
      return y;
    };
    const markAt = x => {
      const y = hollow(x);
      a.x = x; a.y = y + 8; a.vx = a.vy = 0; a.hp = a.maxHp;
      col.markChamber(a, 0);
      return msgs();
    };
    G.events.length = 0;
    const out = {};
    out.far = markAt(Math.round(col.x + CH_REACH + 120));
    out.near = markAt(Math.round(col.x - CH_REACH + 60));
    while (col.chambers.length < CH_MAX) col.addChamber('storage', col.x, 0, false);
    out.many = markAt(Math.round(col.x + CH_REACH - 60));
    out.n = col.chambers.length;
    return out;
  })()`);
  check('a hollow far from the nest: too far for a chamber', c.far.includes('m_markFar'), c.far);
  check('a hollow near the nest: marked', c.near.includes('m_chamberNew'), c.near);
  check('past the cap: the nest has all the chambers it can keep', c.many.includes('m_markMany') && c.n === run('CH_MAX'), c);
}

console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
