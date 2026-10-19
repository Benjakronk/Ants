// Multi-seed colony check in plain Node: runs several worlds headlessly (an
// idle player parked in the nest) and reports food, deliveries and foragers
// per day -- or per season for runs of a year -- for the players' colony
// and the red rival beside it (its size, raids, food stolen). Each seed runs in its own
// process, with a seeded Math.random so a run is reproducible.
//   node test/forageseeds.js [days] [seeds...]      (default 3 days, seeds 1-8)
//   node test/forageseeds.js 13                      a whole year and a day
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fork } = require('child_process');

const args = process.argv.slice(2);
const one = args.includes('--one');
const nums = args.filter(a => a !== '--one').map(Number);
const days = nums[0] || 3;
const seeds = nums.length > 1 ? nums.slice(1) : [1, 2, 3, 4, 5, 6, 7, 8];

function runWorld(seed) {
  let s = (seed * 2654435761) >>> 0;
  const rand = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const M = Object.create(Math); M.random = rand;
  const ctx = vm.createContext({ console, Math: M });
  for (const f of ['worldgen.js', 'terrain.js', 'entities.js', 'colony.js', 'game.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  const run = code => vm.runInContext(code, ctx);
  run(`newWorld(${seed}, 1)`);
  const rows = [];
  const DAY = run('DAY_LEN');
  const every = days > 6 ? DAY * run('SEASON_DAYS') : DAY;   // a row per season on long runs
  const row = () => run(`(() => {
    const surfRet = G.ants.filter(a => a.state === 'return' && a.playerIdx < 0 &&
      a.y < T.surf[Math.floor(a.x)] + 12).length;
    const loose = G.items.filter(i => !i.dead && !i.carried && ITEM_DEF[i.kind] && ITEM_DEF[i.kind].food).length;
    return { day: G.day, season: G.season, food: Math.round(G.colony.food), got: Math.round(G.colony.stats.foodGathered),
      ants: G.ants.length, brood: G.brood.length, loose, surfRet,
      ret: G.ants.filter(a => a.state === 'return').length, died: G.colony.stats.antsDied,
      blk: G.colony.members().length, red: G.rival.members().length, rfood: Math.round(G.rival.food),
      raids: G.rival.stats.raids, stolen: Math.round(G.colony.stats.foodStolen || 0), redDown: G.rival.defeated };
  })()`);
  const t0 = run('G.tick');
  for (let i = 1; i <= days * DAY; i++) {
    if (i % 600 === 1) run('{ const a = G.players[0].ant; if (a) { a.x = G.colony.junction.x; a.y = G.colony.junction.y; } }');
    // (a period's last tick: at a season's end, what the next one starts with)
    if ((t0 + i) % every === 0) rows.push(row());
    run('stepSim(); G.events.length = 0');
    if (run('G.over')) {
      rows.push(Object.assign(row(), { over: run('G.over.reason'), canContinue: run('G.over.canContinue') }));
      if (!run('G.over.canContinue')) break;
      run('continueYear()');
    }
  }
  return rows;
}

if (one) {
  process.send(runWorld(seeds[0]));
} else {
  const t0 = Date.now();
  let left = seeds.length;
  const out = {};
  const SEASON = ['spr', 'sum', 'aut', 'win'];
  for (const seed of seeds) {
    const ch = fork(__filename, [String(days), String(seed), '--one']);
    ch.on('message', rows => { out[seed] = rows; });
    ch.on('exit', () => {
      if (--left) return;
      let lost = 0, starving = 0, gotSum = 0, redMax = 0, redGone = 0, raids = 0;
      for (const sd of seeds) {
        const rows = out[sd] || [];
        console.log('seed ' + sd + ': ' + rows.map(r => r.over
          ? `[${r.over} d${r.day}]`
          : `d${r.day} ${SEASON[r.season]} food ${r.food} got ${r.got} ants ${r.blk} died ${r.died}` +
            ` red ${r.red}/${r.rfood} raids ${r.raids} stolen ${r.stolen}` +
            (days <= 6 ? ` loose ${r.loose} ret ${r.ret}/${r.surfRet}` : '')).join(' | '));
        const last = rows.filter(r => !r.over).pop() || {};
        if (rows.some(r => r.over && !r.canContinue)) lost++;
        else if (last.food < 5) starving++;
        gotSum += last.got || 0;
        redMax = Math.max(redMax, ...rows.map(r => r.red || 0));
        if (!last.red) redGone++;
        raids += last.raids || 0;
      }
      console.log(`seeds ${seeds.length}: lost ${lost}, starving at the end ${starving}, ` +
        `avg food delivered ${Math.round(gotSum / seeds.length)}; red: largest ${redMax} ants, ` +
        `died out ${redGone}, raids ${raids} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    });
  }
}
