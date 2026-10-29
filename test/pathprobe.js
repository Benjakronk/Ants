// NPC pathfinding probe: runs headless worlds (plain Node, a vm context as in
// nodesim.js) and watches every NPC ant on its errands -- how much of the
// time it spends stalled (no progress toward where its errand takes it), how
// long food takes to reach the stores, how long a forager takes to climb out
// of the nest, how often it gives up (goto failures, shunned food, burrow
// rescues, the freeze detector). Natural worlds over several seeds, and the
// same worlds reshaped the way players shape them: zigzag and diagonal
// tunnels, wide halls, a crater over the nest, packed-earth walls, a thatch
// mound, an ant gate in the entrance shaft.
//   node test/pathprobe.js [days=2] [--seeds 11,22,33,44] [--only natural,dug,crater,built]
//                          [--far] [--quiet] [--worst] [--digs]
// (--worst: sample stuck ants, freezes and burrow rescues for a look with a
// debugger; --digs: where the NPCs' digging by the trees comes from)
// (--far: the player waits far away on the surface, so the NPCs think on
// the far-NPC throttle the server runs most of them on)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = Number(process.argv[2]) || 2;
const SEEDS = arg('--seeds', '11,22,33,44').split(',').map(Number);
const ONLY = arg('--only', null);
const FAR = process.argv.includes('--far');
const QUIET = process.argv.includes('--quiet');
// the thresholds. Before the fixes these worlds measured (4 seeds x 2 days,
// player in the nest / far away): errands stalled natural 3.1/4.6%, dug
// 14.7/3.1%, crater 55/58% (the colony paced the crater, food 24 a day),
// built 4.4/3.0%; the freeze detector fired 44-89 times a day. After:
// 0.1-1.4% stalled, 7-17 freezes a day.
const STALL_MAX = 2.5;    // % of errand-seconds getting nowhere
const FREEZE_MAX = 30;    // freeze-detector rescues a day

let rs = 1;
const M = Object.create(Math);
M.random = () => {
  rs = (rs + 0x6D2B79F5) | 0;
  let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const SIM_FILES = ['worldgen.js', 'terrain.js', 'entities.js', 'colony.js', 'game.js'];
const ctx = vm.createContext({ console, Math: M });
for (const f of SIM_FILES) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const run = code => vm.runInContext(code, ctx);
if (process.argv.includes('--digs')) run('var PB_STACKS = 1');

// ---- player-shaped terrain --------------------------------------------------
run(`
var PB = { STACKS: typeof PB_STACKS !== 'undefined' };
PB.dig = (x, y, r) => T.dig(x, y, r, 9, true);           // a player's bite (packed too)
PB.line = (x0, y0, x1, y1, r) => {                       // a dug tunnel
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
  for (let i = 0; i <= n; i++) PB.dig(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, r);
};
PB.hall = (cx, cy, rx, ry) => {                          // a wide chamber
  for (let y = -ry; y <= ry; y += 2) for (let x = -rx; x <= rx; x += 2)
    if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) PB.dig(cx + x, cy + y, 2.5);
};
PB.fill = (cx, cy, r, mat) => T.place(cx, cy, r, mat, null, 1e9);
PB.SCEN = {
  natural() {},
  // zigzag/diagonal tunnels and wide halls: a diagonal staircase from the
  // junction out under the storage, a zigzag down to a big hall beside the
  // royal chamber, the storage widened into a hall, a second diagonal shaft
  // up to the surface
  dug(c) {
    const j = c.junction, s = c.storage, q = c.queenCh, n = c.nursery;
    let x = j.x, y = j.y;
    for (let k = 0; k < 6; k++) { const nx = x + (k % 2 ? 18 : -22), ny = y + 14; PB.line(x, y, nx, ny, 4); x = nx; y = ny; }
    PB.hall(x - 30, y + 10, 45, 14);
    PB.line(s.x, s.y, s.x - 70, s.y + 40, 4);
    PB.hall(s.x - 10, s.y - 4, 48, 20);                   // storage widened into a hall
    PB.hall(q.x + 70, q.y, 40, 22);
    PB.line(q.x + 25, q.y, q.x + 70, q.y, 5);
    PB.line(n.x + 20, n.y, n.x + 60, T.bgSurf[n.x + 60] - 2, 4);  // a second way up, diagonal
    PB.line(j.x, j.y, j.x + 40, j.y - 50, 4);             // and a dead-end diagonal up
  },
  // a crater: the players dug the mound and the top of the shaft out wide
  crater(c) {
    const e = c.entrance;
    for (let y = e.y - 12; y < e.y + 45; y += 3) {
      const w = 50 - (y - e.y) * 0.6;
      PB.line(e.x - w, y, e.x + w, y, 3);
    }
  },
  // built: packed-earth walls with a gap, a thatch mound over the entrance,
  // an ant gate plugging the entrance shaft, a packed shelf (overhang) on
  // the surface, thatch walls left across a side tunnel
  built(c) {
    const e = c.entrance, j = c.junction, s = c.storage;
    // ant gate plug a little way down the shaft
    const ep = c.paths.entrance, gp = ep[Math.floor(ep.length * 0.6)];
    for (let dy = -3; dy <= 3; dy++) for (let dx = -8; dx <= 8; dx++) {
      const i = (gp.y + dy) * WORLD_W + gp.x + dx;
      if (T.m[i] === M_AIR) T.m[i] = M_GATE;
    }
    // thatch dome over the entrance with a doorway
    for (let x = e.x - 40; x <= e.x + 40; x++) {
      for (let y = e.y - 45; y <= e.y + 2; y++) {
        const d = Math.hypot(x - e.x, y - e.y);
        if (d < 34 || d > 40 || (x > e.x && y > T.bgSurf[x] - 20)) continue;
        if (T.get(x, y) === M_AIR) T.m[y * WORLD_W + x] = M_THATCH;
      }
      T.raiseSurf(x);
    }
    c.recountMound();
    // packed overhang shelves out on the forest floor on both sides
    for (const sx of [e.x - 140, e.x + 150]) {
      for (let x = sx; x < sx + 40; x++) for (let y = T.surf[x] - 16; y < T.surf[x] - 12; y++)
        if (T.get(x, y) === M_AIR) T.m[y * WORLD_W + x] = M_PACKED;
      PB.fill(sx, T.surf[sx] - 6, 4, M_PACKED);
    }
    // a packed wall half across the storage tunnel (a doorway left low) and
    // a full thatch wall across the far end of the storage hall
    const sp = c.paths.storage, mid = sp[Math.floor(sp.length / 2)];
    for (let y = mid.y - 10; y <= mid.y - 3; y++) for (let dx = -1; dx <= 1; dx++) {
      const i = y * WORLD_W + mid.x + dx; if (T.m[i] === M_AIR) T.m[i] = M_PACKED;
    }
    for (let y = s.y - 16; y <= s.y + 14; y++) for (let dx = 0; dx < 2; dx++) {
      const i = y * WORLD_W + s.x - 30 + dx; if (T.m[i] === M_AIR) T.m[i] = M_THATCH;
    }
  },
};

// ---- the probe ---------------------------------------------------------------
PB.run = (seed, scen, days, far) => {
  newWorld(seed, 1);
  const c = G.colony;
  PB.SCEN[scen](c);
  c.recalcChambers();
  const ERR = { forage: 1, collect: 1, return: 1, milk: 1, raid: 1, home: 1, shelter: 1, patrol: 1, rescue: 1, tend: 1 };
  const st = { antSec: 0, stalled: 0, stalledBy: {}, stalledAt: {}, trips: [], tripsLong: 0, outs: [], outsLong: 0,
    gotoFail: 0, burrows: 0, freezes: 0, freezeAt: {}, burrowAt: {}, worstB: [], dug: 0, dugTree: 0, digBy: {}, failAt: {}, worstF: [], shunned: 0, fed: 0, gathered: 0, worst: [] };
  const sfx = x => Math.floor(Math.max(0, Math.min(WORLD_W - 1, x)));
  const where = a => {
    const sx = sfx(a.x), col = a.colony, e = col.entrance;
    if (a.y < T.surf[sx] - 12) return 'tree/overhang';
    if (a.y < T.surf[sx] + 12) return Math.abs(a.x - e.x) < MOUND_R + 10 ? 'mound' : 'surface';
    if (Math.abs(a.x - e.x) < 30 && a.y < col.junction.y - 10) return 'shaft';
    if (Math.abs(a.x - col.x) < NEST_R) return 'nest';
    return 'underground';
  };
  // where an errand takes the ant (null: no fixed place)
  const dest = a => {
    const col = a.colony, sx = sfx(a.x);
    switch (a.state) {
      case 'return': return col.storage;
      case 'forage': return a.y > T.surf[sx] + 12 ? { x: col.entrance.x, y: col.entrance.y - 6 }
        : a.target ? { x: a.target.x, y: a.y } : null;
      case 'collect': case 'milk': return a.target;
      case 'home': case 'shelter': return col.junction;
      default: return null;
    }
  };
  // the earth the colony's NPCs chew away (natural pixels: built ones are
  // spared), and how much of it by the trees
  const origDig = T.dig, origUpd = Ant.prototype.update;
  let npc = null;
  Ant.prototype.update = function () { npc = this.playerIdx < 0 && this.colony === c ? this : null; origUpd.call(this); npc = null; };
  T.dig = function (cx, cy) {
    const r = origDig.apply(T, arguments);
    if (npc && r.natural) {
      st.dug += r.natural;
      if (cy < T.bgSurf[sfx(cx)] + 40 && G.trees.some(t => Math.abs(t.x - cx) < 40)) {
        st.dugTree += r.natural;
        if (PB.STACKS) {
          const fr = new Error().stack.split(String.fromCharCode(10)).slice(2, 5).map(l => (l.match(/entities[.]js:([0-9]+)/) || [])[1]).join('<');
          const k = npc.state + ' ' + fr; st.digBy[k] = (st.digBy[k] || 0) + r.natural;
        }
      }
    }
    return r;
  };
  const origGoto = Ant.prototype.goto;
  Ant.prototype.goto = function (tx, ty, dig) {
    const was = this.gotoFail, d = origGoto.call(this, tx, ty, dig);
    if (this.gotoFail && !was && this.colony === c && this.playerIdx < 0) { st.gotoFail++; const k = this.state + '@' + where(this); st.failAt[k] = (st.failAt[k] || 0) + 1; }
    return d;
  };
  const park = () => {
    for (const p of G.players) {
      const a = p.ant; if (!a) continue;
      if (far) { a.x = Math.max(20, Math.min(WORLD_W - 20, c.x + (c.x < WORLD_W / 2 ? 2600 : -2600))); a.y = T.surf[sfx(a.x)] - 4; }
      else { a.x = c.junction.x; a.y = c.junction.y; }
      a.vx = a.vy = 0;
    }
  };
  const end = G.tick + days * DAY_LEN;
  const g0 = c.stats.foodGathered;
  let n = 0;
  try {
    while (G.tick < end && !G.over) {
      if (n++ % 600 === 0) park();
      stepSim();
      G.events.length = 0;
      for (const a of G.ants) {
        if (a.playerIdx >= 0 || a.hp <= 0) continue;
        if (a.burrowT > 0 && !(a.pbBurrow > 0) && a.colony === c) { st.burrows++; const k = a.state + '@' + where(a); st.burrowAt[k] = (st.burrowAt[k] || 0) + 1;
          if (st.worstB.length < 20) st.worstB.push({ id: a.id, s: a.state, w: where(a), x: a.x | 0, y: a.y | 0, day: +(G.tick / DAY_LEN).toFixed(3), full: !!a.burrowFull }); }
        a.pbBurrow = a.burrowT;
        if (a.pbFreeze > 700 && a.freezeT === 0 && a.colony === c) {
          st.freezes++;
          const k = a.pbFS + '@' + where(a); st.freezeAt[k] = (st.freezeAt[k] || 0) + 1;
          if (st.worstF.length < 30) st.worstF.push({ id: a.id, caste: a.caste, s: a.pbFS, w: where(a), x: a.x | 0, y: a.y | 0, day: +(G.tick / DAY_LEN).toFixed(2) });
        }
        a.pbFreeze = a.freezeT; a.pbFS = a.state;
        // a load picked up (or a forager setting out from below): trip clocks
        if (a.carry && !a.pbCarry && a.colony === c) a.pbCarryT = G.tick;
        if (!a.carry && a.pbCarry && a.pbCarryT && a.colony === c && a.pbCarry.dead) {
          const t = (G.tick - a.pbCarryT) / 60; st.trips.push(t); if (t > 120) st.tripsLong++;
        }
        if (a.carry && a.carry !== a.pbCarry) a.pbCarryT = G.tick;
        a.pbCarry = a.carry;
        const deep = a.y > T.surf[sfx(a.x)] + 12;
        if (a.state === 'forage' && deep && !a.pbOutT) a.pbOutT = G.tick;
        if (a.pbOutT && (a.state !== 'forage' || !deep)) {
          if (a.state === 'forage') { const t = (G.tick - a.pbOutT) / 60; st.outs.push(t); if (t > 60) st.outsLong++; }
          a.pbOutT = 0;
        }
      }
      if (G.tick % 60) continue;
      // once a second: who is getting nowhere?
      for (const a of G.ants) {
        if (a.playerIdx >= 0 || a.hp <= 0 || a.caste === 'queen' || a.caste === 'princess') continue;
        if (a.colony !== c && !a.raiding) continue;   // the players' ants, and raiders coming at them
        const s = a.state;
        if (!ERR[s] || (s === 'return' && !a.carry && !a.raiding)) { a.pbS = null; continue; }
        // a nurse hanging about the nursery, a forager waiting out full
        // stores: not errands that go anywhere
        if (s === 'tend' && Math.abs(a.x - c.nursery.x) < 30 && Math.abs(a.y - c.nursery.y) < 30) { a.pbS = null; continue; }
        st.antSec++;
        const d = dest(a), dd = d ? Math.hypot(d.x - a.x, d.y - a.y) : 0;
        const key = s + (d ? (d.x | 0) + ',' + (d.y | 0) : '');
        if (a.pbS !== key) { a.pbS = key; a.pbBest = d ? dd : 0; a.pbT = 0; a.pbP = [a.x, a.y]; continue; }
        let prog;
        if (d) { prog = dd < a.pbBest - 3; if (prog) a.pbBest = dd; }
        else { prog = Math.hypot(a.x - a.pbP[0], a.y - a.pbP[1]) > 12; if (prog) a.pbP = [a.x, a.y]; }
        if (prog) { a.pbT = 0; continue; }
        if (++a.pbT >= 10) {
          st.stalled++;
          st.stalledBy[s] = (st.stalledBy[s] || 0) + 1;
          const w = where(a); st.stalledAt[w] = (st.stalledAt[w] || 0) + 1;
          if (a.pbT === 30 && st.worst.length < 40) st.worst.push({ id: a.id, caste: a.caste, s, w, x: a.x | 0, y: a.y | 0,
            day: +(G.tick / DAY_LEN).toFixed(2), dest: d && { x: d.x | 0, y: d.y | 0 } });
        }
      }
    }
  } finally { Ant.prototype.goto = origGoto; Ant.prototype.update = origUpd; T.dig = origDig; }
  for (const it of G.items) if (it.shunN) st.shunned += it.shunN;
  st.gathered = Math.round(c.stats.foodGathered - g0);
  st.over = G.over ? G.over.reason : null;
  return JSON.stringify(st);
};
`);

const scens = (ONLY ? ONLY.split(',') : ['natural', 'dug', 'crater', 'built']);
const tot = {};
const med = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p90 = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)]; };
const t0 = Date.now();
for (const scen of scens) {
  const T = tot[scen] = { antSec: 0, stalled: 0, by: {}, at: {}, trips: [], tripsLong: 0, outs: [], outsLong: 0,
    gotoFail: 0, burrows: 0, freezes: 0, shunned: 0, gathered: 0, dug: 0, dugTree: 0 };
  for (const seed of SEEDS) {
    rs = seed;
    const r = JSON.parse(run(`PB.run(${seed}, '${scen}', ${DAYS}, ${FAR})`));
    for (const k of ['antSec', 'stalled', 'tripsLong', 'outsLong', 'gotoFail', 'burrows', 'freezes', 'shunned', 'gathered', 'dug', 'dugTree']) T[k] += r[k];
    for (const k in r.stalledBy) T.by[k] = (T.by[k] || 0) + r.stalledBy[k];
    for (const k in r.stalledAt) T.at[k] = (T.at[k] || 0) + r.stalledAt[k];
    T.trips.push(...r.trips); T.outs.push(...r.outs);
    if (!QUIET) {
      console.log(`  ${scen} seed ${seed}: stalled ${(100 * r.stalled / Math.max(1, r.antSec)).toFixed(1)}% of ${r.antSec} errand-s,` +
        ` trips ${r.trips.length} (med ${med(r.trips).toFixed(0)} s, >2min ${r.tripsLong}), outs ${r.outs.length}` +
        ` (med ${med(r.outs).toFixed(0)} s, >1min ${r.outsLong}), gotoFail ${r.gotoFail}, burrows ${r.burrows},` +
        ` freezes ${r.freezes}, shunned ${r.shunned}, food ${r.gathered}, dug ${r.dug} (trees ${r.dugTree})${r.over ? ', OVER ' + r.over : ''}`);
      console.log('    by state ' + JSON.stringify(r.stalledBy) + ' at ' + JSON.stringify(r.stalledAt) + ' freezes ' + JSON.stringify(r.freezeAt));
      if (process.argv.includes('--digs')) console.log('    digs ' + JSON.stringify(Object.entries(r.digBy).sort((a, b) => b[1] - a[1]).slice(0, 14)));
      if (process.argv.includes('--worst')) console.log('    burrows ' + JSON.stringify(r.burrowAt) + ' gotoFail ' + JSON.stringify(r.failAt));
      if (process.argv.includes('--worst')) { for (const w of r.worst.slice(0, 12)) console.log('    ' + JSON.stringify(w)); for (const w of r.worstF.slice(0, 12)) console.log('    F ' + JSON.stringify(w)); for (const w of r.worstB.slice(0, 12)) console.log('    B ' + JSON.stringify(w)); }
    }
  }
}
console.log(`pathprobe: ${SEEDS.length} seeds x ${DAYS} day(s)${FAR ? ', player far away' : ''}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const fails = [];
const check = (name, ok, info) => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const days = SEEDS.length * DAYS;
for (const scen of scens) {
  const T = tot[scen];
  const pct = 100 * T.stalled / Math.max(1, T.antSec);
  const info = `stalled ${pct.toFixed(1)}% (${JSON.stringify(T.by)} at ${JSON.stringify(T.at)}), ` +
    `trips/day ${(T.trips.length / days).toFixed(0)} med ${med(T.trips).toFixed(0)} s p90 ${p90(T.trips).toFixed(0)} s >2min ${T.tripsLong}, ` +
    `outs med ${med(T.outs).toFixed(0)} s p90 ${p90(T.outs).toFixed(0)} s >1min ${T.outsLong}, ` +
    `per day: gotoFail ${(T.gotoFail / days).toFixed(0)} burrows ${(T.burrows / days).toFixed(1)} freezes ${(T.freezes / days).toFixed(1)} ` +
    `shunned ${(T.shunned / days).toFixed(1)} food ${(T.gathered / days).toFixed(0)} dug ${(T.dug / days).toFixed(0)} px (by trees ${(T.dugTree / days).toFixed(0)})`;
  check(`${scen}: NPC errands stall under ${STALL_MAX}% of the time`, pct < STALL_MAX, info);
  check(`${scen}: the freeze detector fires under ${FREEZE_MAX} times a day`, T.freezes / days < FREEZE_MAX,
    (T.freezes / days).toFixed(1));
  check(`${scen}: the slowest tenth of hauls home take under 90 s`, p90(T.trips) < 90 && T.trips.length > 0);
  check(`${scen}: the slowest tenth of foragers climb out in under 40 s`, p90(T.outs) < 40);
}
console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
process.exitCode = fails.length ? 1 : 0;
