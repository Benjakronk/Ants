// The rival red colony as a living sim, headless in plain Node (the sim
// files plus save.js, with a stand-in localStorage), then a quick look at
// the client's map and O screen in the browser.
//   node test/rivalprobe.js [--no-browser]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const fails = [];
const check = (name, ok, info) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
  if (!ok) fails.push(name);
};

// a seeded Math.random: the run is the same every time
let s = 12345;
const M = Object.create(Math);
M.random = () => {
  s = (s + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const ctx = vm.createContext({ console, Math: M, btoa, atob, localStorage });
for (const f of ['worldgen.js', 'terrain.js', 'entities.js', 'colony.js', 'game.js', 'save.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const run = code => vm.runInContext(code, ctx);
const J = code => JSON.parse(run('JSON.stringify(' + code + ')'));
// step the sim n ticks, the player parked in its own nest (msg keys kept)
run(`var msgKeys = [];
  function simN(n, until) {
    for (let i = 0; i < n; i++) {
      if (i % 600 === 0) { const a = G.players[0].ant; if (a) { a.x = G.colony.queenCh.x + 20; a.y = G.colony.queenCh.y; } }
      stepSim();
      for (const e of G.events) if (e.t === 'msg') msgKeys.push(e.key);
      G.events.length = 0;
      if (until && until()) return i + 1;
    }
    return n;
  }
  function redAnts() { return G.ants.filter(a => a.hp > 0 && a.colony === G.rival); }`);

// --- old seeds: the generator is untouched, so the world is the same -------
// (FNV hash of seed 12345's terrain bytes, as Phase 2a generated it)
const hash = run(`(() => { const w = genWorld(12345); let h = 2166136261;
  for (let i = 0; i < w.m.length; i += 7) h = Math.imul(h ^ w.m[i], 16777619) >>> 0;
  return h; })()`);
check('old seed regenerates the same terrain', hash === 1793467002, hash);

// --- two colonies, one faction each ------------------------------------------
run('newWorld(4242, 1)');
const setup = J(`(() => {
  const r = G.rival, q = r.queen();
  return {
    n: G.colonies.length, factions: G.colonies.map(c => c.faction), alias: G.colony === G.colonies[0],
    player: G.colonies.map(c => c.player), rivalX: r.x, blackX: G.colony.x,
    types: r.chambers.map(c => c.type).sort(),
    queenInRoyal: !!q && !!r.chamberNear(q.x, q.y, 40, 'royal') && Math.hypot(q.x - r.queenCh.x, q.y - r.queenCh.y) < 40,
    queenHp: q ? q.maxHp : 0, blackQueenHp: G.colony.queen().maxHp,
    castes: redAnts().map(a => a.caste).sort().join(),
    redBrood: G.brood.filter(b => b.colony === r).length,
    caps: r.caps, objectives: r.objectives, bugs: G.bugs.filter(b => b.kind === 'redant').length,
  };
})()`);
check('G.colonies = [black, red], G.colony is the players\'', setup.n === 2 && setup.factions.join() === 'black,red' &&
  setup.alias && setup.player.join() === 'true,false' && setup.rivalX > setup.blackX + 1500, setup);
check('the generated red nest is red\'s chambers (storage, nursery, royal)',
  ['storage', 'nursery', 'royal'].every(t => setup.types.includes(t)) && setup.caps && setup.caps.pop >= 10, setup.types);
check('the red queen holds the red royal chamber, tough', setup.queenInRoyal && setup.queenHp >= setup.blackQueenHp * 1.5, setup);
check('red has workers, soldiers, nurses and brood; no red bugs, no milestones',
  /soldier/.test(setup.castes) && /worker/.test(setup.castes) && /nurse/.test(setup.castes) &&
  setup.redBrood > 0 && setup.bugs === 0 && !setup.objectives, setup.castes);
check('friend or foe by colony: gates and targets', run(`(() => {
  const red = redAnts()[0], blk = G.colony.members()[0];
  return blk.own && !red.own && G.nearestFoe(red.x, red.y, 1e5, red.colony) !== null &&
    G.nearestFoe(blk.x, blk.y, 1e5, G.colony).colony !== G.colony;
})()`));

// --- a day of red life: eggs, brood, foraging ------------------------------------
const t0 = Date.now();
const day = J(`(() => {
  const r = G.rival, s0 = Object.assign({}, r.stats);
  simN(DAY_LEN);
  return { eggs: r.stats.eggsLaid - s0.eggsLaid, born: r.stats.antsBorn - s0.antsBorn,
    gathered: Math.round(r.stats.foodGathered - s0.foodGathered), food: Math.round(r.food),
    pop: redAnts().length, blackPop: G.colony.members().length,
    redForagers: redAnts().filter(a => a.state === 'forage' || a.state === 'collect' || a.state === 'return').length,
    farFromHome: redAnts().filter(a => Math.abs(a.x - r.x) > FORAGE_R + 300 && !a.raiding).length };
})()`);
console.log('  a day (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s):', JSON.stringify(day));
check('the red queen lays and red brood emerges', day.eggs > 0 && day.born > 0, day);
check('red foragers deliver food to red storage', day.gathered > 20, day);
check('red forages on its own side of the map', day.farFromHome <= 2, day);

// --- a raid: out of the red nest, at the black nest, and home again ----------
const raid = J(`(() => {
  const r = G.rival, b = G.colony;
  r.food = Math.max(r.food, 80);
  const sent = r.startRaid(b, 6);
  const team = G.ants.filter(a => a.raiding && a.colony === r);
  const roles = team.map(a => a.raidRole).join();
  const startX = Math.round(team.reduce((s, a) => s + a.x, 0) / team.length);
  msgKeys.length = 0;
  let reached = 0, stoleAt = 0, food0 = b.food, minDist = 1e9;
  const n = simN(2 * DAY_LEN, () => {
    for (const a of team) if (a.hp > 0) minDist = Math.min(minDist, Math.abs(a.x - b.entrance.x));
    if (!reached && team.some(a => a.hp > 0 && a.nestIn() === b)) reached = G.tick;
    if (!stoleAt && r.raid && r.raid.stolen > 0) stoleAt = G.tick;
    return !r.raid;
  });
  const alive = team.filter(a => a.hp > 0);
  return { sent, roles, startX, rivalX: r.x, minDist, reached: !!reached,
    ticks: n, over: !r.raid, alive: alive.length, stillRaiding: alive.filter(a => a.raiding).length,
    home: alive.filter(a => Math.abs(a.x - r.x) < NEST_R).length,
    warned: msgKeys.includes('m_raid'), stolen: !!stoleAt, foodStolen: Math.round(b.stats.foodStolen || 0),
    raids: r.stats.raids };
})()`);
console.log('  raid:', JSON.stringify(raid));
check('a raid leaves the red nest (soldiers and thieves)', raid.sent >= 3 && Math.abs(raid.startX - raid.rivalX) < run('NEST_R') &&
  /fight/.test(raid.roles) && /steal/.test(raid.roles), raid);
// (black's soldiers meet them at the gates: getting inside is the fight)
check('the raiders reach the black nest\'s gates, and black is warned', raid.minDist < 250 && raid.warned, raid);
check('the raid ends and its survivors go home', raid.over && raid.stillRaiding === 0 && raid.home === raid.alive, raid);

// --- a thief at the stores carries the food home ---------------------------------
const theft = J(`(() => {
  const r = G.rival, b = G.colony;
  b.food = 100; r.food = 20;
  const w = redAnts().find(a => a.caste === 'worker');
  r.raid = { phase: 'march', t: 0, siege: 0, target: 0, n0: 1, stolen: 0, warned: true, home: 0 };
  w.raiding = true; w.raidRole = 'steal'; w.state = 'raid'; w.nav = null; w.carry = null;
  w.x = b.storage.x; w.y = b.storage.y - 3;
  // (black's ants out of the way for the heist: this is about the haul)
  const keep = G.ants.filter(a => a.colony === b);
  G.ants = G.ants.filter(a => a.colony !== b);
  for (let i = 0; i < 30; i++) { stepSim(); G.events.length = 0; }
  const took = { carrying: !!(w.carry && w.carry.value > 0), blackFood: Math.round(b.food), stolen: r.raid ? r.raid.stolen : -1 };
  G.ants.push(...keep);
  const red0 = r.food;
  simN(DAY_LEN, () => !w.raiding || w.hp <= 0);
  return Object.assign(took, { alive: w.hp > 0, home: !w.raiding && !w.carry, redGain: Math.round(r.food - red0) });
})()`);
console.log('  theft:', JSON.stringify(theft));
check('a raider steals from the black stores', theft.carrying && theft.blackFood < 100 && theft.stolen > 0, theft);
check('and carries the loot into the red stores', !theft.alive || (theft.home && theft.redGain > 0), theft);

// --- the contested food site -------------------------------------------------------
const site = J(`(() => {
  G.tick = SEASON_DAYS * DAY_LEN + Math.floor(DAY_LEN * 0.1);   // summer
  simN(1);
  const cs = G.contested, b = G.colony;
  const o = () => G.objectives.list.find(o => o.id === 'contested');
  const need = o().need;
  const pieces = G.items.filter(i => i.site && !i.dead);
  const mid = (b.x + G.rival.x) / 2;
  // black brings fruit in: each piece counts (red's don't count for black)
  const w = b.members().find(a => a.caste === 'worker');
  const rw = redAnts().find(a => a.caste === 'worker');
  b.food = 0; G.rival.food = 0;
  const redOne = pieces.pop();
  G.rival.deposit(redOne, rw);
  for (let i = 0; i < need && pieces.length; i++) b.deposit(pieces.pop(), w);
  return { fell: !!cs && cs.active && msgKeys.includes('m_siteFell'), between: Math.abs(cs.x - mid) < 400,
    n: o().n, need, done: o().done, got: cs.got, left: pieces.length };
})()`);
check('a contested fruit falls between the nests in summer', site.fell && site.between, site);
check('contested milestone: black brings N pieces home', site.done && site.n >= site.need && site.got[0] >= site.need &&
  site.got[1] === 1, site);
const siteRace = J(`(() => {
  // both colonies' foragers make for it (within a day: with food close
  // to home a forager only now and then sets out on the long trek)
  const seen = new Set();
  simN(DAY_LEN, () => { for (const a of G.ants) if (a.target && a.target.far) seen.add(a.colony.idx); return seen.size === 2; });
  return { both: seen.size === 2, got: G.contested.got };
})()`);
check('both colonies\' foragers go for the contested site', siteRace.both, siteRace);

// --- save / load round-trips both colonies ---------------------------------------
const rt = J(`(() => {
  const r = G.rival;
  r.raid = null; r.expandN = 2; r.lastExpandDay = G.day; r.queenSeen = true; r.food = 77.5;
  for (const a of G.ants) if (a.raiding) a.endRaid();
  const before = { black: G.colony.members().length, red: redAnts().length, redFood: r.food,
    redBrood: G.brood.filter(b => b.colony === r).length, redChambers: r.chambers.length,
    queenHp: Math.round(r.queen().hp), contested: G.contested && G.contested.got.join(), sites: G.items.filter(i => i.site).length };
  const ok = saveWorld(1);
  const d = loadWorldData(1);
  restoreWorld(d, 1);
  const r2 = G.rival;
  const after = { black: G.colony.members().length, red: G.ants.filter(a => a.hp > 0 && a.colony === r2).length,
    redFood: r2.food, redBrood: G.brood.filter(b => b.colony === r2).length, redChambers: r2.chambers.length,
    queenHp: Math.round(r2.queen().hp), contested: G.contested && G.contested.got.join(), sites: G.items.filter(i => i.site).length };
  return { ok, v: d.v, before, after, seen: r2.queenSeen, expandN: r2.expandN, player: G.players[0].ant.colony === G.colony };
})()`);
check('save v7 round-trips both colonies', rt.ok && rt.v === 7 && JSON.stringify(rt.before) === JSON.stringify(rt.after) &&
  rt.seen && rt.expandN === 2 && rt.player, rt);

// --- an old v4 save: the red bugs become the red colony ------------------------------
const v4 = J(`(() => {
  const d = JSON.parse(localStorage.getItem('maur_world_1'));
  d.v = 4; d.colony = d.colonies[0]; d.objectives = d.colony.objectives; delete d.colonies; delete d.contested;
  d.ants = d.ants.filter(s => !s.col).map(s => { delete s.col; return s; });
  d.brood = d.brood.filter(s => !s.col).map(s => { delete s.col; return s; });
  d.items = d.items.filter(s => !s.site);
  const e = G.rival.entrance;
  // the old garrison: three residents by the red mound, and two raiders out
  for (let i = 0; i < 3; i++) d.bugs.push({ id: 90000 + i, kind: 'redant', x: e.x - 30 + i * 30, y: T.surf[e.x] - 8, hp: i ? 28 : 14, resident: true, homeX: e.x });
  for (let i = 0; i < 2; i++) d.bugs.push({ id: 90010 + i, kind: 'redant', x: G.colony.x + 400, y: T.surf[G.colony.x + 400] - 8, hp: 28 });
  const black = d.ants.length;
  localStorage.setItem('maur_world_2', JSON.stringify(d));
  const ok = restoreWorld(loadWorldData(2), 1);
  const r = G.rival, reds = G.ants.filter(a => a.colony === r);
  return { ok, black, blackNow: G.ants.filter(a => a.colony === G.colony).length,
    queen: !!r.queen(), soldiers: reds.filter(a => a.caste === 'soldier').length,
    workers: reds.filter(a => a.caste === 'worker').length, homeward: reds.filter(a => a.raiding).length,
    hurt: reds.some(a => a.caste === 'soldier' && a.hp < a.maxHp * 0.6),
    redBugs: G.bugs.filter(b => b.kind === 'redant').length, info: slotInfo(2) };
})()`);
check('a v4 save migrates: red queen, workers, its garrison as soldiers', v4.ok && v4.queen && v4.soldiers === 5 &&
  v4.workers > 0 && v4.homeward === 2 && v4.hurt && v4.redBugs === 0 && v4.blackNow === v4.black, v4);
check('the migrated world runs on', run('simN(600); !G.over && isFinite(G.rival.food) && G.rival.members().length > 0'));

// --- a v4 summer save with the retired 'crystals' milestone already won ------------
const objMig = J(`(() => {
  const d = JSON.parse(localStorage.getItem('maur_world_1'));
  d.v = 4; d.colony = d.colonies[0]; delete d.colonies;
  const ob = JSON.parse(JSON.stringify(d.colony.objectives));
  const i = ob.list.findIndex(o => o.id === 'contested');
  ob.list[i] = { id: 'crystals', n: 2, need: 2, done: true };
  ob.yearDone = 4;
  d.objectives = ob;
  localStorage.setItem('maur_world_3', JSON.stringify(d));
  restoreWorld(loadWorldData(3), 1);
  const o = G.objectives.list[i];
  objEvent('contested', 99);
  return { season: G.season, id: o.id, done: o.done, yearDone: G.objectives.yearDone };
})()`);
check('a retired milestone already won is not counted twice', objMig.season === run('SUMMER') &&
  objMig.id === 'contested' && objMig.done && objMig.yearDone === 4, objMig);
run('restoreWorld(loadWorldData(2), 1)');

// --- the red queen dead of something else: red falls, but no bonus -----------------
run('saveWorld(4)');
const died = J(`(() => {
  const r = G.rival, b = G.colony;
  G.brood = G.brood.filter(x => !(x.colony === r && x.royal));
  G.ants = G.ants.filter(a => !(a.colony === r && a.caste === 'princess'));
  const score0 = b.score, cr0 = b.crystals;
  msgKeys.length = 0;
  r.queen().hurt(1e6, 0, 0, G.bugs.find(x => x.predator) || null);
  simN(3);
  return { defeated: r.defeated, slain: r.slain, died: msgKeys.includes('m_rivalDied'),
    slainMsg: msgKeys.includes('m_rivalSlain'), score: b.score - score0, crystals: b.crystals - cr0 };
})()`);
check('the red queen dead of other causes: defeated, no bonus, a plain message',
  died.defeated && !died.slain && died.died && !died.slainMsg && died.score === 0 && died.crystals === 0, died);
run('restoreWorld(loadWorldData(4), 1)');

// --- the bonus needs a real hand in her death: the wound ledger -----------------------
// a centipede wears her down and one of ours only bites at the end: no bonus;
// ours wear her down and a centipede finishes her: the bonus. The ledger
// is saved (v6) and fades with time.
const ledger = J(`(() => {
  const out = {};
  for (const plan of ['scratch', 'campaign']) {
    restoreWorld(loadWorldData(4), 1);
    const r = G.rival, b = G.colony, q = r.queen();
    G.brood = G.brood.filter(x => !(x.colony === r && x.royal));
    G.ants = G.ants.filter(a => !(a.colony === r && a.caste === 'princess'));
    const ours = b.members().find(a => a.caste === 'soldier' || a.caste === 'worker');
    const centi = new Bug(q.x + 30, q.y, 'centipede');
    const first = plan === 'scratch' ? centi : ours, last = plan === 'scratch' ? ours : centi;
    q.hurt(q.maxHp * 0.9, 0, 0, first);
    if (plan === 'campaign') {
      // (saved and loaded mid-fight: the ledger comes along)
      saveWorld(5); restoreWorld(loadWorldData(5), 1);
      out.saved = Math.round((G.rival.queenDmg[0] || 0));
    }
    G.rival.queen().hurt(1e6, 0, 0, last);
    simN(3);
    out[plan] = { defeated: G.rival.defeated, slain: G.rival.slain };
  }
  // the ledger fades: an old wound counts for less than a fresh one
  restoreWorld(loadWorldData(4), 1);
  const q = G.rival.queen();
  q.hurt(50, 0, 0, G.colony.members()[0]);
  const d0 = G.rival.queenDmg[0];
  simN(600);
  out.fades = G.rival.queenDmg[0] < d0;
  return out;
})()`);
check('a last scratch from our ants after a centipede wore her down earns no bonus',
  ledger.scratch.defeated && !ledger.scratch.slain, ledger);
check('our ants wearing her down earns the bonus even if something else finishes her (ledger saved)',
  ledger.campaign.defeated && ledger.campaign.slain && ledger.saved > 0, ledger);
check('the wound ledger fades with time', ledger.fades, ledger);
run('restoreWorld(loadWorldData(4), 1)');

// --- the red queen slain: red is defeated, the bonus is paid --------------------------
const win = J(`(() => {
  const r = G.rival, b = G.colony;
  G.brood = G.brood.filter(x => !(x.colony === r && x.royal));
  G.ants = G.ants.filter(a => !(a.colony === r && a.caste === 'princess'));
  r.food = 80;
  r.startRaid(b, 4);
  const score0 = b.score, cr0 = b.crystals;
  msgKeys.length = 0;
  r.queen().hurt(1e6, 0, 0, b.members().find(a => a.caste === 'soldier' || a.caste === 'worker'));
  simN(3);
  const raiders = G.ants.filter(a => a.colony === r && a.raiding && a.state === 'raid').length;
  const hp0 = redAnts().reduce((s, a) => s + a.hp, 0);
  simN(600);
  const hp1 = redAnts().reduce((s, a) => s + a.hp, 0);
  const lastDay = r.lastRaidDay;
  r.lastRaidDay = -1; r.food = 500;
  simN(1200);
  return { defeated: r.defeated, slain: r.slain, msg: msgKeys.includes('m_rivalSlain'), score: b.score - score0, crystals: b.crystals - cr0,
    stat: b.stats.rivalDefeated, raiders, wasting: hp1 < hp0, newRaid: !!(r.raid && r.raid.phase === 'march'),
    enemy: b.enemy() === null, over: G.over };
})()`);
check('killing the red queen defeats red, with a message and the bonus',
  win.defeated && win.slain && win.msg && win.score >= 1000 && win.crystals >= 5 && win.stat === 1 && !win.over, win);
check('leaderless red ants stop raiding and waste away', win.raiders === 0 && win.wasting && !win.newRaid && win.enemy, win);

console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'NODE PART PASS');

// --- the client: the rival on the map and the O screen ---------------------------
(async () => {
  if (process.argv.includes('--no-browser')) { process.exitCode = fails.length ? 1 : 0; return; }
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(800);
  await page.evaluate(() => localStorage.clear());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  const ui = await page.evaluate(() => {
    G.rival.queenSeen = true;
    G.objScreen = { page: 0, sel: 0 };
    drawPlay();
    const n = Math.max(5, Math.round(G.rival.members().length / 5) * 5);
    return { line: L('ui_rival', n), n };
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test/shot-rival-obj.png' });
  await page.evaluate(() => { G.objScreen = null; G.showMap = true; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/shot-rival-map.png' });
  const slain = await page.evaluate(() => {
    G.showMap = false;
    G.rival.queen().hp = 0;
    for (let i = 0; i < 5; i++) updatePlay();
    G.objScreen = { page: 0, sel: 0 };
    return { defeated: G.rival.defeated, line: L('ui_rivalSlain') };
  });
  await page.waitForTimeout(300);
  check('O screen rival line, map markers drawn without errors', ui.line.includes(String(ui.n)) && slain.defeated &&
    errors.length === 0, errors);
  console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
  await browser.close();
  process.exitCode = fails.length ? 1 : 0;
})();
