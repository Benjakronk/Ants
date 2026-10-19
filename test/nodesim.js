// Headless simulation in plain Node -- no browser, no DOM. Proves the sim can
// run on a server, and measures what one world costs per tick.
//   node test/nodesim.js [days]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// the browser loads these as plain scripts sharing one global scope; a vm
// context does the same. Nothing client-side (canvas, audio, lang) is loaded.
const SIM_FILES = ['worldgen.js', 'terrain.js', 'entities.js', 'colony.js', 'game.js'];
const ctx = vm.createContext({ console, Math });
for (const f of SIM_FILES) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const run = code => vm.runInContext(code, ctx);

const days = Number(process.argv[2]) || 3;
let t0 = Date.now();
run('newWorld(12345, 1)');
console.log('worldgen:', Date.now() - t0, 'ms');

// player input drives the ant through the same struct the network will fill
const x0 = run('G.players[0].ant.x');
run('G.players[0].input.dx = 1');
for (let i = 0; i < 60; i++) run('stepSim()');
run('G.players[0].input.dx = 0');
const moved = run('G.players[0].ant.x') - x0;
console.log('input moved ant:', moved > 5, '(' + moved.toFixed(1) + ' px)');

// building and chamber marking, all through the input struct
const fails = [];
const check = (name, ok, info) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  ' + info : ''));
  if (!ok) fails.push(name);
};
run(`{
  const a = G.players[0].ant, j = G.colony.junction;
  a.x = j.x; a.y = j.y; a.vx = a.vy = 0; a.soil = 0; a.thatch = 0;
  for (let i = 0; i < 40; i++) stepSim();   // settle onto the junction floor
}`);
// dig into the wall to the right: spoil goes into the soil load
run('G.players[0].input.dx = 1; G.players[0].input.bite = true');
for (let i = 0; i < 40; i++) run('stepSim()');
run('G.players[0].input.dx = 0; G.players[0].input.bite = false');
const soil0 = run('G.players[0].ant.soil');
check('digging fills the soil load', soil0 > 0 && soil0 <= run('LOAD_CAP'), 'soil ' + soil0);
// face back down the dug tunnel and build into it
const packedIn = 'G.colony.junction.x - 40, G.colony.junction.y - 40, 120, 80';
const countPacked = `((x0, y0, w, h) => { let n = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (T.get(x, y) === M_PACKED) n++;
  return n; })(${packedIn})`;
const packed0 = run(countPacked);
run('G.players[0].input.dx = -1'); run('stepSim()');
run('G.players[0].input.dx = 0; G.players[0].input.build = true');
for (let i = 0; i < 30; i++) run('stepSim()');
run('G.players[0].input.build = false');
const placed = run(countPacked) - packed0;
const soil1 = run('G.players[0].ant.soil');
check('build places packed earth from the load', placed > 0 && soil0 - soil1 === placed,
  placed + ' px placed, soil ' + soil0 + ' -> ' + soil1);
check('build never buries the builder', !run('{ const a = G.players[0].ant; T.boxSolid(a.x, a.y, a.hw, a.hh) }'));
// R: cycle the material
run('G.players[0].input.buildMat = true'); run('stepSim()');
check('buildMat cycles to thatch', run('G.players[0].buildMat === M_THATCH && !G.players[0].input.buildMat'));
run('G.players[0].input.buildMat = true'); run('stepSim()');
check('buildMat cycles to the ant gate', run('G.players[0].buildMat === M_GATE'));
run('G.players[0].input.buildMat = true'); run('stepSim()');
check('buildMat cycles back to packed earth', run('G.players[0].buildMat === M_PACKED'));
// X at the junction: the generated barracks marker cycles to royal, then
// (with two royals) to a fungus garden, and the next press removes it
const nCh = run('G.colony.chambers.length');
const markType = () => run(`(G.colony.chamberNear(G.players[0].ant.x, G.players[0].ant.y, CH_NEAR) || {}).type`);
run('G.players[0].input.mark = true'); run('stepSim()');
const t1 = markType();
run('G.players[0].input.mark = true'); run('stepSim()');
const t2 = markType();
run('G.players[0].input.mark = true'); run('stepSim()');
check('mark cycles and removes a chamber', t1 === 'royal' && t2 === 'fungus' &&
  run('G.colony.chambers.length') === nCh - 1,
  'barracks -> ' + t1 + ' -> ' + t2 + ', chambers ' + nCh + ' -> ' + run('G.colony.chambers.length'));
const caps = run('JSON.stringify(G.colony.caps)');
console.log('caps after removing the barracks:', caps);
// put the barracks back so the timing run below matches a fresh colony
run(`G.colony.addChamber('barracks', G.colony.junction.x, G.colony.junction.y); G.colony.recalcChambers()`);

// event stream: count what a client would be sent
const counts = {};
run('G.events.length = 0');

t0 = Date.now();
const ticks = days * run('DAY_LEN');
let slowest = 0;
for (let i = 0; i < ticks; i++) {
  // park the player in the nest so it doesn't skew survival
  if (i % 600 === 0) run('{ const a = G.players[0].ant; if (a) { a.x = G.colony.junction.x; a.y = G.colony.junction.y; } }');
  const s = process.hrtime.bigint();
  run('stepSim()');
  const dt = Number(process.hrtime.bigint() - s) / 1e6;
  if (dt > slowest) slowest = dt;
  for (const e of run('G.events')) counts[e.t] = (counts[e.t] || 0) + 1;
  run('G.events.length = 0');
  if (run('G.over')) { console.log('colony extinct on day', run('G.day')); break; }
  if (i % run('DAY_LEN') === 0 && i) {
    console.log(JSON.stringify(run(`({ day: G.day, food: Math.round(G.colony.food),
      ants: G.ants.length, brood: G.brood.length, bugs: G.bugs.length, items: G.items.length,
      born: G.colony.stats.antsBorn, died: G.colony.stats.antsDied })`)));
  }
}
const ms = Date.now() - t0;
console.log('simulated', days, 'days =', ticks, 'ticks in', ms, 'ms');
console.log('avg', (ms / ticks).toFixed(3), 'ms/tick, slowest', slowest.toFixed(1), 'ms',
  '-> one world uses ~' + (ms / ticks * 60 / 10).toFixed(1) + '% of a CPU core at 60 Hz');
console.log('events per second:', Object.entries(counts).map(([k, v]) => k + ' ' + (v / (ticks / 60)).toFixed(1)).join(', '));
console.log('final:', JSON.stringify(run(`({ day: G.day, food: Math.round(G.colony.food), ants: G.ants.length })`)));
check('no NaN in colony food', isFinite(run('G.colony.food')));

// the rest of the colony year, on to the first day of spring in year 2 (an
// idle player parked in the nest: the colony on its own). Stepped inside the
// vm for speed; one row as each season ends.
if (!process.argv.includes('--no-year')) {
  t0 = Date.now();
  const year = JSON.parse(run(`(() => {
    const log = [];
    const end = YEAR_DAYS * DAY_LEN + 600;
    let n = 0;
    while (G.tick < end) {
      if (n++ % 600 === 0) { const a = G.players[0].ant; if (a) { a.x = G.colony.junction.x; a.y = G.colony.junction.y; } }
      const s = G.season, food = G.colony.food, done = G.objectives.yearDone;
      stepSim();
      G.events.length = 0;
      if (G.season !== s) {
        log.push({ season: SEASON_KEYS[s], foodAtEnd: Math.round(food), ants: G.ants.length, brood: G.brood.length,
          born: G.colony.stats.antsBorn, died: G.colony.stats.antsDied, milestones: done,
          nan: !isFinite(G.colony.food) });
      }
      if (G.over) {
        log.push({ over: G.over.reason, win: G.over.win, stars: G.over.stars, canContinue: G.over.canContinue });
        if (!G.over.canContinue) break;
        continueYear();
      }
    }
    return JSON.stringify(log);
  })()`));
  console.log('the year (days 4-12, idle colony), ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s:');
  for (const r of year) console.log('  ' + JSON.stringify(r));
  const lost = year.find(r => r.over && !r.canContinue);
  check('the colony survives its first year', !lost, lost && lost.over);
  check('a year ends on the first day of spring in year 2', year.some(r => r.over && r.canContinue) &&
    run('G.year') === 2 && run('G.season') === 0);
  check('no NaN all year', year.every(r => !r.nan) && isFinite(run('G.colony.food')));
}

// the colony's own ants leave a thatched mound over the entrance standing:
// a fresh world, a dome with a gap in its side, half a day of summer
// foraging (stores kept low so the foragers keep coming and going)
if (!process.argv.includes('--no-mound')) {
  const mound = JSON.parse(run(`(() => {
    newWorld(777, 1);
    G.tick = SEASON_DAYS * DAY_LEN + Math.floor(DAY_LEN * 0.1);   // summer morning
    G.objectives = newObjectives(G.year, G.season, 0);
    const c = G.colony, e = c.entrance;
    const a = G.players[0].ant; a.x = c.queenCh.x; a.y = c.queenCh.y;
    for (let x = e.x - 40; x <= e.x + 40; x++) {
      for (let y = e.y - 45; y <= e.y + 2; y++) {
        const d = Math.hypot(x - e.x, y - e.y);
        if (d < 34 || d > 40 || (x > e.x && y > T.bgSurf[x] - 20)) continue;
        if (T.get(x, y) === M_AIR) T.m[y * WORLD_W + x] = M_THATCH;
      }
      T.raiseSurf(x);
    }
    c.recountMound();
    const size0 = c.mound.size, g0 = c.stats.foodGathered;
    for (let i = 0; i < DAY_LEN / 2; i++) {
      if (i % 1200 === 0) c.food = 20;
      stepSim();
      G.events.length = 0;
    }
    c.recountMound();
    return JSON.stringify({ size0, size: c.mound.size, gathered: Math.round(c.stats.foodGathered - g0) });
  })()`));
  check('NPC foragers leave the thatched mound standing', mound.size >= mound.size0 * 0.95 && mound.gathered > 0,
    JSON.stringify(mound));
}
console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
process.exitCode = fails.length ? 1 : 0;
