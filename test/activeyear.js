// A scripted "active player" through a whole colony year, in plain Node (no
// browser): a bot that does what a decent player does, at a human pace --
// digs out and marks a chamber or two a day (one bite every BITE ticks, the
// ant walking from bite to bite), thatches the mound in summer, carries
// pieces of the contested fruit home, enlarges the royal chamber in autumn,
// gates the entrance for winter and spends its crystals. Reports milestones,
// stars and the colony's size per season, for a few seeds.
//   node test/activeyear.js [seeds...] [--pace N] [--casual] [--idle] [--len short|quick]   (default seeds 1 2 3)
// --idle: the player's ant handed back to the colony (players as NPCs);
// --len: a SHORT (24 min) or QUICK (16 min) year instead of a FULL one.
// --casual plays a first-timer instead: a second storage in spring, a
// nursery in summer, the royal chamber widened in autumn -- nothing else.
// It checks the year can be won: the colony survives and princesses fly;
// the full bot must earn 2+ stars, the casual one 1+.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const args = process.argv.slice(2);
const pi = args.indexOf('--pace');
const BITE = pi >= 0 ? Number(args[pi + 1]) : 24;     // ticks per bite (a player digs ~2-3 bites a second)
const CASUAL = args.includes('--casual');
const IDLE = args.includes('--idle');
const li = args.indexOf('--len');
const LEN = li >= 0 ? args[li + 1] : 'full';
const seeds = args.filter((a, i) => /^\d+$/.test(a) && (pi < 0 || i !== pi + 1)).map(Number);
if (!seeds.length) seeds.push(1, 2, 3);

function year(seed) {
  let s = (seed * 2654435761) >>> 0;
  const M = Object.create(Math);
  M.random = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ctx = vm.createContext({ console, Math: M });
  for (const f of ['worldgen.js', 'terrain.js', 'entities.js', 'colony.js', 'game.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  const run = code => vm.runInContext(code, ctx);
  run(`newWorld(${seed}, 1, 'solo', 1, '${LEN}')`);
  run(`globalThis.BITE = ${BITE}; globalThis.CASUAL = ${CASUAL};`);
  if (IDLE) run('releasePlayer(0)');
  // the bot lives inside the sim's context (it reads and drives the same G)
  run(`
  globalThis.Bot = {
    jobs: [], job: null, t: 0, did: {}, fruitT: 0, log: [],
    me() { return G.players[0].ant || takeOver(0, 'worker', G.colony.junction.x, G.colony.junction.y); },
    // a spot for a new chamber off the junction: clear of the others, no rock
    spot(dyMin, dyMax) {
      const c = G.colony, j = c.junction;
      for (let k = 0; k < 40; k++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const x = Math.round(j.x + side * (90 + Math.random() * 160));
        const y = Math.round(j.y + dyMin + Math.random() * (dyMax - dyMin));
        if (c.chamberNear(x, y, CH_SPACING * 1.6) || T.digHitsHard(x, y, 20)) continue;
        return { x, y };
      }
      return null;
    },
    // a chamber: a tunnel from the junction, a hollow, then X (and X again
    // to cycle it to the type wanted)
    chamber(type) {
      const c = G.colony, j = c.junction, p = this.spot(30, 150);
      if (!p) return;
      const pts = [];
      const n = Math.ceil(Math.hypot(p.x - j.x, p.y - j.y) / 6);
      for (let i = 1; i <= n; i++) pts.push({ x: j.x + (p.x - j.x) * i / n, y: j.y + (p.y - j.y) * i / n });
      for (let dy = -12; dy <= 12; dy += 6) for (let dx = -24; dx <= 24; dx += 6) pts.push({ x: p.x + dx, y: p.y + dy });
      this.jobs.push({ pts, i: 0, mark: { x: p.x, y: p.y + 6, type } });
    },
    // widen the roomiest royal chamber (inside its disk: claimed room),
    // a ring further out each time
    royal(k) {
      const c = G.colony;
      const ch = c.chambers.filter(h => h.type === 'royal').sort((a, b) => b.area - a.area)[0];
      if (!ch) return;
      const pts = [], rx = 22 + 4 * k, ry = 14 + 3 * k;
      for (let dy = -ry; dy <= ry; dy += 5) for (let dx = -rx; dx <= rx; dx += 5) {
        if ((dx / rx) * (dx / rx) + (dy / ry) * (dy / ry) <= 1) pts.push({ x: ch.x + dx, y: ch.y + dy });
      }
      this.jobs.push({ pts, i: 0 });
    },
    // the bot's ant bites at (x, y) the way a player's bite does
    bite(x, y) {
      const a = this.me(); if (!a) return;
      a.x = x; a.y = y; a.vx = a.vy = 0;
      const res = T.dig(x, y, a.digRNow(), a.def.digPow);
      a.soil = Math.min(LOAD_CAP, a.soil + res.soil);
      a.thatch = Math.min(LOAD_CAP, a.thatch + res.thatch);
      if (G.colony.claimDug(x, y, res.natural)) G.colony.progress('dig', res.natural);
    },
    mark(m) {
      const a = this.me(); if (!a) return;
      a.x = m.x; a.y = m.y; a.vx = a.vy = 0;
      const n0 = G.colony.chambers.length;
      controlMark(a);
      const ch = G.colony.markTarget(a.x, a.y);
      for (let k = 0; ch && k < 5 && ch.type !== m.type; k++) controlMark(a);
      this.log.push('d' + G.day + ' ' + (ch ? ch.type + ' ' + ch.area : 'refused'));
    },
    // the thatched mound: a shell of thatch over the entrance (not the shaft)
    mound(need) {
      const c = G.colony, e = c.entrance;
      let put = 0;
      for (let r = 30; r <= 46 && c.mound.size < need; r += 3) {
        for (let k = 0; k <= 40; k++) {
          const ang = Math.PI * (k / 40);
          const x = e.x + Math.cos(ang) * r * 1.5, y = e.y + 2 - Math.sin(ang) * r;
          if (Math.abs(x - e.x) < 7) continue;
          put += T.place(x, y, 3, M_THATCH, buildClear(x, y, 3), 30);
        }
        c.recountMound();
      }
      this.log.push('d' + G.day + ' mound ' + c.mound.size);
    },
    // winter: an ant gate filling the shaft a little below the entrance
    gate() {
      const c = G.colony, e = c.entrance;
      for (let y = e.y + 6; y <= e.y + 14; y++) {
        for (let x = e.x - 24; x <= e.x + 24; x++) if (T.get(x, y) === M_AIR) T.place(x, y, 0.5, M_GATE, buildClear(x, y, 0.5), 1);
      }
      c.recalcChambers();
      this.log.push('d' + G.day + ' gate sealed=' + c.sealed);
    },
    // summer: fetch a piece of the fallen fruit (the walk there and back
    // takes the bot a while: one piece per FRUIT_T ticks)
    fruit() {
      const a = this.me(); if (!a || a.carry) return;
      const it = G.items.find(i => i.site && !i.dead && !i.carried);
      if (!it) return;
      a.x = G.colony.storage.x; a.y = G.colony.storage.y;
      it.carried = a; a.carry = it;
      G.colony.deposit(it, a);
      if (a.carry === it) { it.carried = null; a.carry = null; it.x = a.x; }
    },
    buy() {
      const c = G.colony;
      for (const id of ['mandibles', 'armor', 'digging', 'carry']) if (c.upgradeCost(id) <= c.crystals) c.buyUpgrade(id, 0);
    },
    // a day's plan, by season (a day is 4 minutes: one or two chambers)
    plan() {
      const c = G.colony, d = G.seasonDay, s = G.season, key = G.day;
      // (autumn: the royal chamber until it's roomy enough for princesses)
      if (s === AUTUMN && !this.job && !this.jobs.length && c.caps.royalMax < PRINCESS_ROYAL + 150 && (this.royalK || 0) < 5) {
        this.royal(this.royalK = (this.royalK || 0) + 1);
      }
      if (this.did[key]) return;
      this.did[key] = true;
      if (CASUAL) {
        if (s === SPRING && d === 1) this.chamber('storage');
        if (s === SUMMER && d === 1) this.chamber('nursery');
        return;
      }
      if (s === SPRING) { this.chamber(d === 0 ? 'storage' : 'nursery'); if (d === 1) this.chamber('barracks'); }
      if (s === SUMMER) { if (d === 0) this.mound(OBJECTIVES[1][0].need + 150 * (G.year - 1) + 20); this.chamber('nursery'); if (d === 1) this.chamber('storage'); }
      if (s === AUTUMN) { if (d === 0) this.chamber('storage'); else this.chamber('nursery'); }
      if (s === WINTER && d === 0) this.gate();
      this.buy();
    },
    step() {
      this.plan();
      if (!CASUAL && G.season === SUMMER && ++this.fruitT >= 1500) { this.fruitT = 0; this.fruit(); }
      if (!this.job && this.jobs.length) this.job = this.jobs.shift();
      const j = this.job;
      if (!j || ++this.t < BITE) return;
      this.t = 0;
      if (j.i < j.pts.length) { const p = j.pts[j.i++]; this.bite(p.x, p.y); return; }
      if (j.mark) this.mark(j.mark);
      this.job = null;
    },
  };
  // the mark key, through the input struct like a player's press
  globalThis.controlMark = a => { G.players[0].input.mark = true; G.colony.markChamber(a, 0); G.players[0].input.mark = false; };
  `);
  const rows = [];
  const end = run('YEAR_DAYS * DAY_LEN + 600');
  run(`(() => {
    const out = [];
    while (G.tick < ${end}) {
      const s = G.season, done = G.objectives.yearDone, food = G.colony.food;
      if (!${IDLE}) Bot.step();
      stepSim();
      G.events.length = 0;
      if (G.season !== s) {
        const c = G.colony;
        out.push({ season: SEASON_KEYS[s], milestones: done, food: Math.round(food), ants: c.members().length,
          cap: c.caps.pop, brood: c.broodCount(), princesses: G.ants.filter(a => a.caste === 'princess' && a.colony === c).length,
          royal: c.caps.royalMax, red: G.rival.members().length, died: c.stats.antsDied, crystals: c.crystals,
          stolen: Math.round(c.stats.foodStolen || 0), raids: G.rival.stats.raids,
          upg: Object.values(c.upg).join('') });
      }
      if (G.over) { out.push({ over: G.over.reason, win: G.over.win, stars: G.over.stars, flown: G.over.flown,
        milestones: G.over.milestones, pop: G.over.pop, rival: G.over.rival }); break; }
    }
    globalThis.OUT = out;
  })()`);
  return { rows: JSON.parse(run('JSON.stringify(OUT)')), log: JSON.parse(run('JSON.stringify(Bot.log)')) };
}

const fails = [];
const check = (name, ok, info) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  ' + info : ''));
  if (!ok) fails.push(name);
};
const t0 = Date.now();
const ends = [];
for (const sd of seeds) {
  const r = year(sd);
  console.log('seed ' + sd + ' (' + LEN + ', ' + (IDLE ? 'idle' : (CASUAL ? 'casual, ' : '') + 'bite every ' + BITE + ' ticks') + '):');
  for (const row of r.rows) console.log('  ' + JSON.stringify(row));
  console.log('  bot: ' + r.log.join(' | '));
  ends.push(r.rows[r.rows.length - 1]);
}
console.log('(' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
check('the active colony survives its year', ends.every(e => e.over && e.over !== 'r_queen' && e.over !== 'r_extinct'),
  ends.map(e => e.over).join());
check('princesses fly in spring of year 2 (1+ star)', ends.every(e => e.stars >= 1), ends.map(e => e.stars).join());
if (!CASUAL && !IDLE) check('an active player earns 2+ stars', ends.every(e => e.stars >= 2), ends.map(e => e.stars + '*/' + e.milestones + 'm').join(' '));
console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS');
process.exitCode = fails.length ? 1 : 0;
