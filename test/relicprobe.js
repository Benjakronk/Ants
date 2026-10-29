// Relic probe (match round 2): the contested crystal field, the golden seed
// and the map's fog. First the sim alone (plain Node, a vm per world): the
// generator as HEAD has it (its terrain hash, seed by seed, against HEAD's
// own worldgen.js), the field a pass after it (most of the crystals between
// the nests, mirrored about their midpoint, shallower than the deep veins,
// the outer veins thinned by as much, the same on every run, a saved world
// keeping the terrain it was saved with); the seed falling halfway through
// spring, summer and autumn (warned before) on a FULL and a SHORT clock,
// none in winter, beyond the rival's nest (versus: one each side); its
// carrier slowed; brought home (crystals, score, the count, a milestone's
// worth at the flight, versus the tie-break after the princesses) or denied
// in the enemy's stores; dropped where its carrier dies; the home side's
// soldiers running an enemy carrier down (an AI colony with fewer), workers
// fetching a dropped seed near their nest (home, or denied); crumbling when
// left lying too long and when the next one falls; v11 saves and v10 ones.
// Then the server with raw clients (versus): the r0/r1 keys each only for
// its side, a far rival player gone from the other side's snapshots (and
// what it carries), back in sight when near, a seed's carrier always shown,
// a loose seed only within sight. Last a browser page (versus, on black):
// the terrain from the seed (no hash mismatch), the goal strip, the O
// screen, the map with our seed and an enemy carrier (the far rival player
// not in the page's model at all), the help page, in English and Norwegian,
// as screenshots.
//   node test/relicprobe.js [--no-browser]
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const WebSocket = require(path.join(ROOT, 'server', 'node_modules', 'ws'));
const NO_BROWSER = process.argv.includes('--no-browser');

const fails = [];
const check = (name, ok, info) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info !== undefined ? '  ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''));
  if (!ok) fails.push(name);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// the sim alone
// ---------------------------------------------------------------------------
const SIM_FILES = ['worldgen.js', 'terrain.js', 'entities.js', 'colony.js', 'game.js', 'save.js'];
function simCtx(seed, src) {
  let s = (seed * 2654435761) >>> 0;
  const M = Object.create(Math);
  M.random = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ctx = vm.createContext({ console, Math: M, btoa, atob });
  for (const f of src ? ['worldgen.js'] : SIM_FILES) {
    const code = src && f === 'worldgen.js' ? src : fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
  const run = code => vm.runInContext(code, ctx);
  run.json = code => JSON.parse(run(`JSON.stringify(${code})`));
  return run;
}
const HASH = `(m => { let h = 2166136261; for (let i = 0; i < m.length; i += 7) h = Math.imul(h ^ m[i], 16777619) >>> 0; return h; })`;

function fieldChecks() {
  // ---- the generator is HEAD's: the same terrain for every seed ---------------
  let headSrc = null;
  try { headSrc = execSync('git show HEAD:js/worldgen.js', { cwd: ROOT, maxBuffer: 4 << 20 }).toString(); } catch (e) { /* no git */ }
  const head = headSrc ? simCtx(1, headSrc) : null;
  const run = simCtx(1);
  const seeds = [1, 2, 3, 777, 12345];
  const same = seeds.map(s => head ? head(`${HASH}(genWorld(${s}).m)`) === run(`${HASH}(genWorld(${s}).m)`) : false);
  check('genWorld is untouched: the same terrain as HEAD\'s generator for every seed', same.every(Boolean), same);
  check('...and seed 12345 is the old seed it always was', run(`${HASH}(genWorld(12345).m)`) === 1793467002);

  // ---- the field: a pass of its own after genWorld ------------------------------
  const stats = seeds.slice(0, 4).map(s => run.json(`(() => {
    const a = genWorld(${s}), b = genNewWorld(${s});
    const mid = Math.round((a.colony.x + a.rival.x) / 2), W = WORLD_W;
    let na = 0, nb = 0, ma = 0, mb = 0, left = 0, right = 0, depth = 0, nd = 0, deep = 0, outerA = 0, outerB = 0;
    for (let i = 0; i < a.m.length; i++) {
      const ca = a.m[i] === M_CRYSTAL, cb = b.m[i] === M_CRYSTAL;
      if (!ca && !cb) continue;
      const x = i % W, y = (i / W) | 0, inMid = x >= 0.4 * W && x < 0.6 * W;
      if (ca) { na++; if (inMid) ma++; if (Math.abs(x - mid) > 0.1 * W) outerA++; }
      if (cb) { nb++; if (inMid) mb++; if (Math.abs(x - mid) > 0.1 * W) outerB++; }
      if (cb && !ca) {   // the field's own pixels
        if (x < mid) left++; else right++;
        depth += y - a.surf[x]; nd++;
      }
      if (ca && !cb) deep += y - a.surf[x];
      // (only crystal and dirt change)
    }
    let other = 0;
    for (let i = 0; i < a.m.length; i++) if (a.m[i] !== b.m[i] && !((a.m[i] === M_CRYSTAL && b.m[i] === M_DIRT) || (a.m[i] === M_DIRT && b.m[i] === M_CRYSTAL))) other++;
    return { na, nb, midA: +(ma / na).toFixed(2), midB: +(mb / nb).toFixed(2), left, right, depth: Math.round(depth / Math.max(1, nd)),
      outerA, outerB, other, again: ${HASH}(genNewWorld(${s}).m) === ${HASH}(b.m) };
  })()`));
  check('the crystal field: about as many crystals in all (within 10%)', stats.every(t => Math.abs(t.nb - t.na) <= t.na * 0.1), stats.map(t => [t.na, t.nb]));
  check('...most of them now in the middle (0.4-0.6 of the width; before: few)', stats.every(t => t.midB >= 0.5 && t.midA <= 0.3), stats.map(t => [t.midA, t.midB]));
  check('...the field mirrored about the nests\' midpoint (as many pixels on either side, give or take a vein\'s rim)',
    stats.every(t => t.left > 0 && Math.abs(t.left - t.right) <= 0.25 * Math.max(t.left, t.right)), stats.map(t => [t.left, t.right]));
  check('...shallower than the deep veins (200-380 px down, the deep ones 420+)', stats.every(t => t.depth >= 200 && t.depth <= 385), stats.map(t => t.depth));
  check('...the outer veins thinned, only crystal and dirt changed, and the same on every run',
    stats.every(t => t.outerB < t.outerA && t.outerB > 0 && t.other === 0 && t.again), stats.map(t => [t.outerA, t.outerB, t.other, t.again]));
  // a new world has it; a saved one keeps its own terrain
  const nw = run.json(`(() => {
    newWorld(4242, 1, 'solo', 1, 'full');
    const fresh = ${HASH}(T.m) === ${HASH}(genNewWorld(4242).m);
    const d = JSON.parse(JSON.stringify(serializeWorld()));
    d.terrain = rleEncode(genWorld(4242).m);   // (a world from before the field)
    newWorld(1, 1);
    const ok = restoreWorld(d, 1);
    return { fresh, ok, kept: ${HASH}(T.m) === ${HASH}(genWorld(4242).m) };
  })()`);
  check('a new world has the field; a saved world keeps the terrain it was saved with', nw.fresh && nw.ok && nw.kept, nw);
}

// the season's share gone at G.tick (as updateRelics sees it)
const FRAC = `((G.day % SEASON_DAYS) * DAY_LEN + G.tick % DAY_LEN) / (SEASON_DAYS * DAY_LEN)`;

function relicChecks() {
  const run = simCtx(3);
  // ---- when it falls: halfway through the season, the warning before ----------
  for (const len of ['full', 'short']) {
    const t = run.json(`(() => {
      newWorld(4242, 1, 'solo', 1, '${len}');
      const SL = SEASON_DAYS * DAY_LEN, out = [];
      for (let s = 0; s < 4; s++) {
        // from a little before the warning to a little after the fall, a tick at a time
        G.tick = s * SL + Math.floor(SL * ${0.4}) - 20;
        G.events.length = 0;
        let warn = -1, fell = -1;
        const wk = G.relics.wk, k = G.relics.k;
        for (let i = 0; i < Math.ceil(SL * 0.1) + 60; i++) {
          stepSim();
          if (warn < 0 && G.relics.wk !== wk) warn = G.tick - s * SL;
          if (fell < 0 && G.relics.k !== k) fell = G.tick - s * SL;
        }
        const it = G.items.find(i => i.kind === 'relic' && !i.dead);
        const msgs = G.events.filter(e => e.t === 'msg').map(e => e.key);
        out.push({ s, warn, fell, warnAt: Math.ceil(SL * 0.4), fallAt: Math.ceil(SL * 0.5),
          beyond: it ? Math.round((it.x - G.rival.x) * Math.sign(G.rival.x - G.colony.x)) : null,
          until: it ? G.relics.side[0].until - G.tick : null, msgs: msgs.filter(k => /^m_relic/.test(k)) });
      }
      return { day: DAY_LEN, out };
    })()`);
    const ok = t.out.slice(0, 3).every(o => Math.abs(o.warn - o.warnAt) <= 1 && Math.abs(o.fell - o.fallAt) <= 1 &&
      o.beyond >= 380 && o.beyond <= 700 && o.msgs.join() === 'm_relicSoon,m_relicFell') && t.out[3].fell < 0 && t.out[3].warn < 0;
    check(`${len.toUpperCase()}: a golden seed halfway through spring, summer and autumn (told at 0.4), beyond the red nest; none in winter`,
      ok, t.out.map(o => [o.s, o.warn, o.warnAt, o.fell, o.fallAt, o.beyond, o.msgs.join('+')]));
    check(`${len.toUpperCase()}: it lasts a season`, t.out.slice(0, 3).every(o => Math.abs(o.until - 3 * t.day) <= 120), t.out.map(o => o.until));
  }

  // ---- versus: one for each side, beyond the other's nest -----------------------
  const vs = run.json(`(() => {
    newWorld(4242, 0, 'versus', 1, 'full');
    G.tick = Math.floor(SEASON_DAYS * DAY_LEN * 0.5) - 2;
    G.events.length = 0;
    for (let i = 0; i < 5; i++) stepSim();
    const r = G.items.filter(i => i.kind === 'relic');
    const [b, rd] = G.colonies;
    return { n: r.length, black: r.filter(i => i.rcol === 0).map(i => Math.round(i.x - rd.x)), red: r.filter(i => i.rcol === 1).map(i => Math.round(b.x - i.x)),
      fell: G.events.filter(e => e.t === 'msg' && /^m_relicFell/.test(e.key)).map(e => e.key + ':' + e.col).sort() };
  })()`);
  check('versus: a seed for each side, black\'s beyond the red nest, red\'s beyond the black one, each side told of both',
    vs.n === 2 && vs.black[0] >= 380 && vs.black[0] <= 700 && vs.red[0] >= 380 && vs.red[0] <= 700 &&
    vs.fell.join() === 'm_relicFell:0,m_relicFell:1,m_relicFellFoe:0,m_relicFellFoe:1', vs);

  // ---- carrying it home: slow, then the reward -------------------------------------
  const home = run.json(`(() => {
    newWorld(4242, 1, 'solo', 1, 'full');
    G.tick = Math.floor(SEASON_DAYS * DAY_LEN * 0.5);
    stepSim();
    const it = G.items.find(i => i.kind === 'relic'), a = G.players[0].ant, c = G.colony;
    const v0 = a.speedNow();
    a.x = it.x; a.y = it.y - 3; G.players[0].input.act = true;
    for (let i = 0; i < 12; i++) stepSim();
    const v1 = a.speedNow(), ph1 = G.relics.side[0].ph;
    const cr = c.crystals, sc = c.score;
    G.events.length = 0;
    a.x = c.storage.x; a.y = c.storage.y - 3; a.hp = a.maxHp; G.players[0].input.act = true;
    for (let i = 0; i < 12; i++) stepSim();
    const st = G.relics.side[0];
    return { carry: ph1, slow: +(v1 / v0).toFixed(2), ph: st.ph, got: st.got, dc: c.crystals - cr, ds: c.score - sc, gone: !G.items.some(i => i.kind === 'relic'),
      msgs: G.events.filter(e => e.t === 'msg').map(e => e.key).filter(k => /^m_relic/.test(k)), stat: c.stats.relics };
  })()`);
  check('picked up, it slows its carrier (x0.7); into our storage: +3 crystals, +300, counted (1/3)',
    home.carry === 'carried' && home.slow === 0.7 && home.ph === 'home' && home.got === 1 && home.dc >= 3 && home.ds >= 300 &&
    home.gone && home.msgs.includes('m_relicHome') && home.stat === 1, home);
  // the flight: a seed is a milestone's worth for the second star; versus the tie-break
  const fl = run.json(`(() => {
    newWorld(4242, 1, 'solo', 1, 'full');
    const c = G.colony;
    G.tick = YEAR_DAYS * DAY_LEN + 30;   // (the first day of year 2: last year's seeds count)
    const fly = got => {
      G.relics.side[0] = { ph: 'home', id: 0, x: 0, y: 0, until: 0, got, yr: 1 };
      G.ants.push(new Ant(c.queenCh.x, c.queenCh.y, 'princess', c));
      return startFlight(c, 7);
    };
    const without = fly(0), withOne = fly(1);
    G.mode = 'versus';
    endFlight([{ col: 0, stars: 2, n: 1, relics: 2, pop: 10 }, { col: 1, stars: 2, n: 1, relics: 1, pop: 30 }]);
    const tie = G.over && G.over.winner;
    G.over = null;
    endFlight([{ col: 0, stars: 2, n: 2, relics: 0, pop: 10 }, { col: 1, stars: 2, n: 1, relics: 3, pop: 30 }]);
    return { s0: without.stars, s1: withOne.stars, r1: withOne.relics, tie, prin: G.over && G.over.winner };
  })()`);
  check('at the flight a seed brought home counts as a milestone (7 + 1 of 12: the second star)', fl.s1 === fl.s0 + 1 && fl.r1 === 1, fl);
  check('versus: more seeds break a tie of stars and princesses (not more princesses)', fl.tie === 0 && fl.prin === 0, fl);

  // ---- denied: the enemy's seed into our stores ---------------------------------
  const den = run.json(`(() => {
    newWorld(4242, 0, 'versus', 1, 'full');
    for (let p = 0; p < 2; p++) joinColony(p, p);
    G.tick = Math.floor(SEASON_DAYS * DAY_LEN * 0.5);
    stepSim();
    const it = G.items.find(i => i.kind === 'relic' && i.rcol === 0);   // black's, behind the red nest
    const a = G.players[1].ant, r = G.colonies[1];
    a.x = it.x; a.y = it.y - 3; G.players[1].input.act = true;
    for (let i = 0; i < 12; i++) stepSim();
    const taken = G.relics.side[0].ph;
    const sc = r.score;
    G.events.length = 0;
    a.x = r.storage.x; a.y = r.storage.y - 3; a.hp = a.maxHp; G.players[1].input.act = true;
    for (let i = 0; i < 12; i++) stepSim();
    return { taken, ph: G.relics.side[0].ph, got: G.relics.side[0].got, ds: r.score - sc, gone: !G.items.some(i => i.id === it.id),
      msgs: G.events.filter(e => e.t === 'msg' && /^m_relic/.test(e.key)).map(e => e.key + ':' + e.col) };
  })()`);
  check('versus: the enemy\'s seed carried into our storage is denied (+100 for us, theirs DESTROYED, uncounted)',
    den.taken === 'taken' && den.ph === 'denied' && den.got === 0 && den.ds >= 100 && den.gone &&
    den.msgs.includes('m_relicDeniedUs:1') && den.msgs.includes('m_relicDenied:0'), den);

  // ---- its carrier dies: it drops where it fell ---------------------------------
  const die = run.json(`(() => {
    newWorld(4242, 1, 'solo', 1, 'full');
    G.tick = Math.floor(SEASON_DAYS * DAY_LEN * 0.5);
    stepSim();
    const it = G.items.find(i => i.kind === 'relic'), a = G.players[0].ant;
    a.x = it.x; a.y = it.y - 3; G.players[0].input.act = true;
    for (let i = 0; i < 12; i++) stepSim();
    const x = a.x;
    G.events.length = 0;
    a.hp = 0;
    for (let i = 0; i < 40; i++) stepSim();
    return { ph: G.relics.side[0].ph, dx: Math.round(Math.abs(it.x - x)), loose: !it.carried && !it.dead, dropped: !!it.dropped,
      msgs: G.events.filter(e => e.t === 'msg' && /^m_relic/.test(e.key)).map(e => e.key) };
  })()`);
  check('its carrier killed: the seed lies where it fell (dropped, OUR GOLDEN SEED IS DOWN)',
    die.ph === 'lying' && die.dx < 12 && die.loose && die.dropped && die.msgs.includes('m_relicDown'), die);

  // ---- the NPCs: the home side's soldiers, the workers by their nests -------------
  // (a carrier pinned near a nest, kept alive: how many of that nest's
  // soldiers turn on it, at most)
  const guards = mode => run.json(`(() => {
    newWorld(4242, ${mode === 'versus' ? 0 : 1}, '${mode}', 1, 'full');
    ${mode === 'versus' ? 'for (let p = 0; p < 2; p++) joinColony(p, p);' : ''}
    const r = G.colonies[1];
    // (plenty of red soldiers home)
    for (let i = 0; i < 6; i++) G.ants.push(new Ant(r.junction.x + i * 3, r.junction.y, 'soldier', r));
    G.tick = Math.floor(SEASON_DAYS * DAY_LEN * 0.5);
    stepSim();
    const it = G.items.find(i => i.kind === 'relic' && i.rcol === 0), a = G.players[0].ant;
    a.x = it.x; a.y = it.y - 3; G.players[0].input.act = true;
    stepSim(); stepSim();
    // (beyond the 450 px every nest guards anyway: only the seed calls them)
    const px = Math.round(r.x + 600 * Math.sign(r.x - G.colonies[0].x));
    let most = 0, first = -1;
    for (let t = 0; t < 1800; t++) {
      a.x = px; a.y = T.surf[px] - 6; a.vx = a.vy = 0; a.hp = a.maxHp;
      stepSim();
      const n = G.ants.filter(o => o.colony === r && o.state === 'fight' && o.target === a).length;
      if (n > 0 && first < 0) first = t;
      most = Math.max(most, n);
    }
    return { carrying: a.carry === it, most, first };
  })()`);
  const gc = guards('coop'), gv = guards('versus');
  check('the AI\'s soldiers run down a carrier near their nest, lightly (2 at most)', gc.carrying && gc.most >= 1 && gc.most <= 2, gc);
  check('versus: the home side\'s soldiers run it down (3 at most)', gv.carrying && gv.most >= 1 && gv.most <= 3, gv);
  // a dropped seed near a nest: that nest's workers fetch it
  const fetch = (mode, nest) => run.json(`(() => {
    newWorld(4242, ${mode === 'versus' ? 0 : 1}, '${mode}', 1, 'full');
    ${mode === 'versus' ? 'for (let p = 0; p < 2; p++) joinColony(p, p);' : ''}
    G.tick = Math.floor(SEASON_DAYS * DAY_LEN * 0.5);
    stepSim();
    const it = G.items.find(i => i.kind === 'relic' && i.rcol === 0), n = G.colonies[${nest}];
    const x = Math.round(n.x + 140 * Math.sign(n.x - (n.idx ? G.colonies[0].x : G.colonies[1].x)));
    it.x = x; it.y = T.surf[x] - 8; it.dropped = true;
    G.relics.side[0].held = true;
    // (the players' ants out of the way, at the far edge)
    for (const p of G.players) if (p.ant) { p.ant.x = 30; p.ant.y = T.surf[30] - 8; }
    let by = null, t = 0;
    for (; t < 9000 && ['lying', 'carried', 'taken'].includes(G.relics.side[0].ph); t++) {
      stepSim();
      for (const p of G.players) if (p.ant) { p.ant.x = 30; p.ant.y = T.surf[30] - 8; p.ant.hp = p.ant.maxHp; }
      if (it.carried && !by) by = { col: it.carried.colony.idx, caste: it.carried.caste, npc: it.carried.playerIdx < 0 };
    }
    return { ph: G.relics.side[0].ph, by, t };
  })()`);
  const fh = fetch('coop', 0);
  check('a seed dropped near our nest: one of our workers brings it home', fh.ph === 'home' && fh.by && fh.by.col === 0 && fh.by.npc && fh.by.caste === 'worker', fh);
  const fd = fetch('versus', 1);
  check('versus: our seed dropped near the enemy nest: their workers take it in, and it is denied', fd.ph === 'denied' && fd.by && fd.by.col === 1 && fd.by.npc, fd);
  // a fresh seed, never carried, is left for the players
  const left = run.json(`(() => {
    newWorld(4242, 1, 'solo', 1, 'full');
    G.tick = Math.floor(SEASON_DAYS * DAY_LEN * 0.5);
    stepSim();
    const it = G.items.find(i => i.kind === 'relic');
    const x = Math.round(G.rival.x + 140); it.x = x; it.y = T.surf[x] - 8;   // (right by the red nest)
    for (let t = 0; t < 3000; t++) stepSim();
    return { ph: G.relics.side[0].ph, loose: !it.carried && !it.dead };
  })()`);
  check('...but a seed not yet carried is the players\' errand: no NPC touches it', left.ph === 'lying' && left.loose, left);

  // ---- it crumbles: left lying too long, or when the next one falls --------------
  const crumble = run.json(`(() => {
    newWorld(4242, 1, 'solo', 1, 'full');
    G.tick = Math.floor(SEASON_DAYS * DAY_LEN * 0.5);
    stepSim();
    const it = G.items.find(i => i.kind === 'relic'), st = G.relics.side[0];
    st.until = G.tick + 20;
    G.events.length = 0;
    for (let i = 0; i < 40; i++) stepSim();
    const lost = { ph: st.ph, dead: it.dead, msg: G.events.some(e => e.key === 'm_relicLost') };
    // next season's falls while last season's is still in its carrier's jaws
    G.tick = Math.floor(SEASON_DAYS * DAY_LEN * 1.5) - 3;
    G.relics.k = 0;
    const old = G.makeItem('relic', 100, 100); old.rcol = 0; G.items.push(old);
    const a = G.players[0].ant; old.carried = a; a.carry = old; st.id = old.id; st.ph = 'carried';
    for (let i = 0; i < 6; i++) stepSim();
    const fresh = G.items.find(i => i.kind === 'relic' && !i.dead);
    return { lost, oldDead: old.dead, carry: a.carry, fresh: fresh && fresh.id !== old.id, ph: st.ph, season: G.season };
  })()`);
  check('left lying past its season it crumbles (CRUMBLED TO DUST)', crumble.lost.ph === 'lost' && crumble.lost.dead && crumble.lost.msg, crumble.lost);
  check('...and last season\'s, still out when the next falls, crumbles in its carrier\'s jaws', crumble.oldDead && crumble.carry === null && crumble.fresh && crumble.ph === 'lying', crumble);

  // ---- saves: v11 keeps the seeds; v10 has none out --------------------------------
  const sv = run.json(`(() => {
    newWorld(4242, 1, 'solo', 1, 'short');
    G.tick = Math.floor(SEASON_DAYS * DAY_LEN * 0.5);
    stepSim();
    const it = G.items.find(i => i.kind === 'relic');
    it.dropped = true; G.relics.side[0].got = 2; G.relics.side[0].held = true;
    for (let i = 0; i < 20; i++) stepSim();
    const d = JSON.parse(JSON.stringify(serializeWorld()));
    const st0 = JSON.stringify(G.relics);
    newWorld(1, 1);
    const ok = restoreWorld(JSON.parse(JSON.stringify(d)), 1);
    const same = JSON.stringify(G.relics) === st0;
    const it2 = G.items.find(i => i.kind === 'relic');
    for (let i = 0; i < 20; i++) stepSim();
    const back = { v: d.v, ok, same, item: it2 && { rcol: it2.rcol, dropped: it2.dropped, id: it2.id === it.id },
      ph: G.relics.side[0].ph, got: relicsHome(G.colony) };
    const old = JSON.parse(JSON.stringify(d)); old.v = 10; delete old.relics; old.items = old.items.filter(i => i.kind !== 'relic');
    newWorld(2, 1);
    back.v10 = { ok: restoreWorld(old, 1), relics: JSON.stringify(G.relics), items: G.items.filter(i => i.kind === 'relic').length };
    const junk = JSON.parse(JSON.stringify(d)); junk.relics = { k: 'x', side: [{ ph: 'nope', got: 99, until: -5 }, 7] };
    newWorld(3, 1);
    restoreWorld(junk, 1);
    back.junk = G.relics.side[0];
    return back;
  })()`);
  check('v11 saves keep the seeds (each side\'s state, the year\'s count, the item\'s colony and drop)', sv.v >= 11 && sv.ok && sv.same &&
    sv.item && sv.item.rcol === 0 && sv.item.dropped && sv.item.id && sv.ph === 'lying' && sv.got === 2, sv);
  check('...a v10 save loads with none out yet; junk is cleaned', sv.v10.ok && sv.v10.relics === '{"k":-1,"wk":-1,"side":[]}' && sv.v10.items === 0 &&
    sv.junk.ph === 'wait' && sv.junk.got === 3 && sv.junk.until === 0, sv);
}

// ---------------------------------------------------------------------------
// online (versus, raw clients)
// ---------------------------------------------------------------------------
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

// a raw protocol client: its messages, the view keys it was sent, the ants
// and items in its model (as the snapshots leave it), dev hooks
function bot(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = { ws, name, msgs: [], ev: [], keys: new Set(), view: {}, ants: new Map(), items: new Map(), you: -1, devR: null };
  ws.on('message', d => {
    let m;
    try { m = JSON.parse(d.toString()); } catch (e) { return; }
    if (m.t === 's') {
      if (m.e) b.ev.push(...m.e);
      if (m.v) for (const k in m.v) { b.keys.add(k); b.view[k] = m.v[k]; }
      for (const r of m.a || []) b.ants.set(r[0], r);
      for (const id of m.ra || []) b.ants.delete(id);
      for (const r of m.i || []) b.items.set(r[0], r);
      for (const id of m.ri || []) b.items.delete(id);
      return;
    }
    if (m.t === 'dev') { b.devR = m; return; }
    if (m.t === 'lobby') b.you = m.you;
    b.msgs.push(m);
  });
  ws.on('error', () => {});
  b.open = new Promise(r => ws.on('open', r));
  b.send = o => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  b.wait = async (pred, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = b.msgs.find(pred); if (m) return m; await sleep(20); }
    return null;
  };
  b.hello = async () => { await b.open; b.send({ t: 'hello', v: 1, name }); return b.wait(m => m.t === 'welcome'); };
  b.dev = async js => {
    b.devR = null;
    b.send({ t: 'dev', js, id: 1 });
    const t0 = Date.now();
    while (!b.devR && Date.now() - t0 < 20000) await sleep(20);
    return b.devR && b.devR.r;
  };
  // a player's ant in this client's model (ant record [8] is the player)
  b.playerAnt = i => [...b.ants.values()].find(r => r[8] === i) || null;
  return b;
}
const bots = async (port, names) => {
  const bs = names.map(n => bot(port, n));
  await Promise.all(bs.map(b => b.hello()));
  return bs;
};

// dev snippets: player p's ant to x (on the surface), held still
const PUT = (p, x) => `(() => { const a = G.players[${p}].ant; if (!a) return -1; a.x = ${x}; a.y = T.surf[Math.round(${x})] - 6;
  a.vx = a.vy = 0; a.climbing = a.ceiling = false; return Math.round(a.x); })()`;

async function online(port) {
  const all = [];
  try {
    const [B, R] = await bots(port, ['BLACKY', 'REDDY']);
    all.push(B, R);
    B.send({ t: 'create', mode: 'versus', len: 'full' });
    const vl = await B.wait(m => m.t === 'lobby');
    R.send({ t: 'join', code: vl.code });
    await R.wait(m => m.t === 'lobby' && m.faction === 'red');
    B.send({ t: 'start' });
    await B.wait(m => m.t === 'world');
    await R.wait(m => m.t === 'world');
    await sleep(600);
    // our ants: black at its nest, red far out beyond its own (no black ant
    // anywhere near)
    const geo = JSON.parse(await B.dev(`JSON.stringify({ bx: G.colonies[0].x, rx: G.colonies[1].x, W: WORLD_W })`));
    const far = geo.rx + 900;
    await B.dev(PUT(B.you, geo.bx + 30));
    await B.dev(PUT(R.you, far));
    await sleep(1500);
    const nb = await B.dev(`G.ants.filter(a => a.colony === G.colonies[0] && Math.abs(a.x - ${far}) < 400).length`);
    check('versus: a far rival player is gone from the other side\'s snapshots (but in its own side\'s)',
      nb === 0 && !B.playerAnt(R.you) && !!R.playerAnt(R.you) && !!B.playerAnt(B.you) && !!R.playerAnt(B.you) === false,
      { blackNear: nb, blackSeesRed: !!B.playerAnt(R.you), redSeesRed: !!R.playerAnt(R.you), redSeesBlack: !!R.playerAnt(B.you) });
    // (the red NPCs out there still show: only players are fogged)
    check('...the rival\'s NPC ants still come (only players are fogged)', [...B.ants.values()].some(r => r[1] === 1 && r[8] < 0));
    // near: back in sight
    await B.dev(PUT(R.you, geo.bx + 90));
    await sleep(800);
    check('...in sight of one of our ants it is sent again', !!B.playerAnt(R.you));
    // a seed's carrier: always in view, and what it carries
    await B.dev(`(() => { const a = G.players[${R.you}].ant; const it = G.makeItem('relic', a.x, a.y); it.rcol = 1;
      it.carried = a; a.carry = it; G.items.push(it); G.__probeSeed = it.id; return it.id; })()`);
    await B.dev(PUT(R.you, far));
    await sleep(1500);
    const seedId = await B.dev('G.__probeSeed');
    check('a golden seed\'s carrier is shown to the other side wherever it is (and the seed with it)',
      !!B.playerAnt(R.you) && B.items.has(seedId) && B.items.get(seedId)[5] === 3 && Math.abs(B.playerAnt(R.you)[3] / 2 - far) < 30,
      { seen: !!B.playerAnt(R.you), item: B.items.get(seedId) });
    // dropped out there and walked away from: the seed, and its carrier, out of sight
    await B.dev(`(() => { const a = G.players[${R.you}].ant; a.carry.carried = null; a.carry = null; return 1; })()`);
    await B.dev(PUT(R.you, far + 400));
    await sleep(1500);
    check('...a seed lying out of the other side\'s sight isn\'t sent to it (its own side has it)',
      !B.items.has(seedId) && R.items.has(seedId) && !B.playerAnt(R.you), { black: B.items.has(seedId), red: R.items.has(seedId) });
    // the seeds' view keys: each side only its own
    await B.dev(`(() => { G.tick = Math.floor(SEASON_DAYS * DAY_LEN * 0.5) - 3; return G.tick; })()`);
    await sleep(1200);
    check('the r0/r1 keys: each side only its own seed (lying, beyond the other\'s nest)',
      B.keys.has('r0') && !B.keys.has('r1') && R.keys.has('r1') && !R.keys.has('r0') && B.view.r0 && B.view.r0.ph === 'lying' &&
      R.view.r1 && R.view.r1.ph === 'lying' && B.view.r0.x > geo.rx && R.view.r1.x < geo.bx,
      { b: B.view.r0, r: R.view.r1, bk: [...B.keys].filter(k => k[0] === 'r'), rk: [...R.keys].filter(k => k[0] === 'r') });
    const msg = k => B.ev.filter(e => e[0] === 'm' && e[1] === k).length;
    check('...and the news of both: ours fell, theirs fell behind our nest', msg('m_relicFell') === 1 && msg('m_relicFellFoe') === 1,
      { fell: msg('m_relicFell'), foe: msg('m_relicFellFoe') });
  } finally {
    for (const b of all) try { b.ws.close(); } catch (e) { /* gone */ }
  }
}

// ---------------------------------------------------------------------------
// a browser page (versus, on black)
// ---------------------------------------------------------------------------
async function screens(port) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const errors = [], warns = [];
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); if (/mismatch/.test(m.text())) warns.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const orig = Net.handle.bind(Net);
    Net.handle = async m => { if (m.t === 'dev') { window.__dev = m; return; } return orig(m); };
  });
  let devId = 100;
  const dev = async js => {
    const id = ++devId;
    await page.evaluate(([js, id]) => { window.__dev = null; Net.send({ t: 'dev', js, id }); }, [js, id]);
    await page.waitForFunction(id => window.__dev && window.__dev.id === id, id, { timeout: 8000 });
    return page.evaluate(() => window.__dev.r);
  };
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(70); } };
  const shot = name => page.screenshot({ path: path.join(__dirname, 'shot-relic-' + name + '.png') });
  const others = [];
  try {
    // title -> ONLINE -> name -> CREATE: versus
    await key('ArrowDown'); await key('Enter');
    await page.keyboard.type('Alpha'); await key('Enter');
    await key('ArrowDown'); await key('Enter');                // CREATE A MATCH
    await key('ArrowRight');                                    // versus
    await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown'); await key('Enter');
    await page.waitForFunction(() => G.state === 'lobby' && Net.code && Net.mode === 'versus', null, { timeout: 8000 });
    const code = await page.evaluate(() => Net.code);
    const [R] = await bots(port, ['REDDY']);
    others.push(R);
    R.send({ t: 'join', code });
    await R.wait(m => m.t === 'lobby' && m.faction === 'red');
    await page.waitForTimeout(300);
    await key('Enter');
    await page.waitForFunction(() => G.state === 'play' && Net.ready, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    if (await page.evaluate(() => !!G.takeover)) await key('Enter');
    await page.evaluate(() => { Tut.on = false; G.msgs = []; });
    check('the page builds the new world\'s terrain from the seed itself (the crystal field too: no hash mismatch)', !warns.length, warns);
    // our seed falls; the red player stands far out past its nest
    const geo = JSON.parse(await dev(`JSON.stringify({ bx: G.colonies[0].x, rx: G.colonies[1].x })`));
    await dev(`(() => { G.tick = Math.floor(SEASON_DAYS * DAY_LEN * 0.5) - 3; return 1; })()`);
    await dev(PUT(R.you, geo.rx + 900));
    await page.waitForTimeout(1500);
    const hud = await page.evaluate(() => {
      const t = topLayout();
      const over = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      const rs = t.rects;
      return { strip: t.strip && t.strip.segs.map(s => s[0]).join(''), right: t.strip && t.strip.x + t.strip.w, left: t.strip && t.strip.x,
        overlap: rs.some((r, i) => rs.some((o, j) => j > i && over(r, o))), rs: relicState() };
    });
    check('the goal strip shows the seed (\\x1C 0/3, gold while it lies out there), within the screen and clear of the top lines',
      /\x1C0\/3 /.test(hud.strip || '') && hud.right <= 316 && hud.left >= 0 && !hud.overlap && hud.rs && hud.rs.ph === 'lying', hud);
    await shot('hud');
    await key('o');
    await page.waitForTimeout(200);
    const ob = await page.evaluate(() => relicStatus(relicState()));
    check('the O screen: BEYOND THE ENEMY NEST, HOME 0/3', ob === 'BEYOND THE ENEMY NEST', ob);
    await shot('obj');
    await page.evaluate(() => setLang(true));
    await page.waitForTimeout(150);
    await shot('obj-no');
    await page.evaluate(() => setLang(false));
    await key('Escape');
    // the map: our seed; the far red player not in the page's model at all;
    // then a red carrier with its own seed, far out -- shown
    const fogged = await page.evaluate(you => !G.ants.some(a => a.playerIdx === you), R.you);
    check('the map: the far red player is in no part of the page\'s model', fogged);
    await key('m');
    await page.waitForTimeout(300);
    await shot('map-fog');
    await key('m');
    await dev(`(() => { const a = G.players[${R.you}].ant; const it = G.makeItem('relic', a.x, a.y); it.rcol = 1;
      it.carried = a; a.carry = it; G.items.push(it); return it.id; })()`);
    await page.waitForTimeout(1500);
    const shown = await page.evaluate(you => { const a = G.ants.find(a => a.playerIdx === you); return !!(a && a.carry && a.carry.kind === 'relic'); }, R.you);
    check('...a red player carrying its seed shows (with the seed) wherever it goes', shown);
    await key('m');
    await page.waitForTimeout(300);
    await shot('map-carrier');
    await page.evaluate(() => setLang(true));
    await page.waitForTimeout(150);
    await shot('map-no');
    await page.evaluate(() => setLang(false));
    await key('m');
    // our own player carrying ours: CARRIED HOME
    await dev(`(() => { const it = G.items.find(i => i.kind === 'relic' && i.rcol === 0); const a = G.players[0].ant;
      a.x = it.x; a.y = it.y - 3; it.carried = a; a.carry = it; return 1; })()`);
    await page.waitForTimeout(1200);
    const carried = await page.evaluate(() => relicState() && relicState().ph);
    check('our player picks up our seed: CARRIED (the strip white)', carried === 'carried', carried);
    await shot('carried');
    // the help pages: versus, co-op, in both languages
    const help = await page.evaluate(() => {
      const out = [];
      for (const lang of [0, 1]) {
        LANG = lang;
        for (const m of ['coop', 'versus', 'world', 'solo']) {
          const pg = helpPages(m).find(p => /GOLDEN SEED|GULLFRØET/.test(p.title));
          out.push({ m, lang, has: !!pg, wide: pg ? pg.lines.filter(([l]) => 24 + textWidth(l) > 318).map(([l]) => l) : [], n: pg ? pg.lines.length : 0 });
        }
      }
      LANG = 0;
      return out;
    });
    check('the help has a GOLDEN SEED page in every mode, both languages, every line on the screen (16 at most)',
      help.every(h => h.has && !h.wide.length && h.n <= 16), help.filter(h => !h.has || h.wide.length || h.n > 16));
    await page.evaluate(() => { G.prevState = 'play'; G.state = 'help'; G.help = { mode: 'versus', page: 1 }; });
    await page.waitForTimeout(200);
    await shot('help-vs');
    await page.evaluate(() => { G.help = { mode: 'coop', page: 1 }; setLang(true); });
    await page.waitForTimeout(200);
    await shot('help-coop-no');
    await page.evaluate(() => { setLang(false); G.help = null; G.state = 'play'; });
    check('no page errors', !errors.length, errors.slice(0, 5));
  } finally {
    for (const b of others) try { b.ws.close(); } catch (e) { /* gone */ }
    await browser.close();
  }
}

(async () => {
  fieldChecks();
  relicChecks();
  const port = await freePort();
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'maur-relic-'));
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', MAUR_DEV: '1', PERSIST_WORLDS: '0',
      DATA_DIR: DATA, MAX_ROOMS: '8', CPU_BUDGET_MS: '1000', MAX_PLAYERS: '8', SIDE_MAX: '8', ROOM_IDLE_MS: '1000' }),
  });
  let srvLog = '';
  srv.stdout.on('data', d => { srvLog += d; });
  srv.stderr.on('data', d => { srvLog += d; });
  for (let i = 0; i < 50; i++) { await sleep(100); try { await getJson(port, '/api/health'); break; } catch (e) { /* not yet */ } }
  try {
    await online(port);
    if (!NO_BROWSER) await screens(port);
    check('no crash on the server', !srvLog.includes('CRASHED') && !srvLog.includes('uncaught'),
      srvLog.split('\n').filter(l => /CRASH|uncaught|Error/.test(l)).slice(0, 3).join(' | '));
  } catch (e) {
    check('the probe ran to the end', false, e && e.stack || String(e));
  } finally {
    srv.kill();
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  process.exitCode = fails.length ? 1 : 0;
})();
