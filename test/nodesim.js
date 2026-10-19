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
// X at the junction: the generated barracks marker cycles to royal, then
// (with two royals) the next press removes it
const nCh = run('G.colony.chambers.length');
run('G.players[0].input.mark = true'); run('stepSim()');
const t1 = run(`(G.colony.chamberNear(G.players[0].ant.x, G.players[0].ant.y, CH_NEAR) || {}).type`);
run('G.players[0].input.mark = true'); run('stepSim()');
check('mark cycles and removes a chamber', t1 === 'royal' && run('G.colony.chambers.length') === nCh - 1,
  'barracks -> ' + t1 + ', chambers ' + nCh + ' -> ' + run('G.colony.chambers.length'));
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
console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
process.exitCode = fails.length ? 1 : 0;
