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
