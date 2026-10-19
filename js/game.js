// MAUR -- game simulation: world state, world setup, player actions, the
// per-tick step. No DOM, canvas, audio or translation in here -- the sim talks
// to whoever renders it (the browser client now, a server later) through
// G.events, and reads each player's intent from G.players[i].input.
'use strict';

// ---------------------------------------------------------------------------
// global game object (simulation state; the client adds its own UI fields)
// ---------------------------------------------------------------------------
const G = {
  running: false,
  seed: 0,
  tick: 0,
  players: [],        // { ant, input, deathPos }
  ants: [], brood: [], bugs: [], items: [],
  pheromones: [],
  trees: [],
  colony: null,
  rival: null,        // rival red-ant nest { x, entrance, ... } (terrain + defenders)
  events: [],         // outgoing: { t: 'msg'|'sfx'|'fx', ... }, drained by the client
  over: null,         // set when the colony is extinct: { day, score, stats }

  get day() { return Math.floor(this.tick / DAY_LEN); },
  tod() { return (this.tick % DAY_LEN) / DAY_LEN; },
  isNight() { return this.tod() >= 0.7; },

  // a message by string key (translated by the client). args may hold name
  // tokens like { caste } or { bug }. `to` = a player index, or omit for all.
  msg(key, args, color, to) {
    this.events.push({ t: 'msg', key, args: args || [], color: color || null, to: to == null ? -1 : to });
  },
  // a sound; with x,y it is only heard by players within range r
  sfx(k, x, y, r) {
    this.events.push({ t: 'sfx', k, x: x == null ? null : x, y, r: r || 300 });
  },
  // a cosmetic particle burst ('dirt', 'blood', 'sparkle', 'clank')
  fx(k, x, y, n) {
    this.events.push({ t: 'fx', k, x, y, n });
  },

  makeItem(kind, x, y, value) { return new Item(kind, x, y, value); },

  nearPlayer(x, y) {
    let best = Infinity;
    for (const p of this.players) {
      if (!p.ant || p.ant.hp <= 0) continue;
      const d = Math.hypot(p.ant.x - x, p.ant.y - y);
      if (d < best) best = d;
    }
    return best;
  },

  nearestItem(x, y, r) {
    let best = null, bd = r * r;
    for (const it of this.items) {
      if (it.dead || it.carried) continue;
      const d = dist2(x, y, it.x, it.y);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  },

  nearestPredator(x, y, r) {
    let best = null, bd = r * r;
    for (const b of this.bugs) {
      if (b.dead || !b.predator || b.fleeing) continue;
      const d = dist2(x, y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  },

  nearestAnt(x, y, r, undergroundOnly) {
    let best = null, bd = r * r;
    for (const a of this.ants) {
      if (a.hp <= 0) continue;
      if (undergroundOnly && a.y < T.surf[Math.floor(Math.max(0, Math.min(WORLD_W - 1, a.x)))] + 30) continue;
      const d = dist2(x, y, a.x, a.y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  },
};

function newInput() {
  // dx/dy/bite are held state; act/abil are one-shot presses the sim consumes
  return { dx: 0, dy: 0, bite: false, act: false, abil: false };
}

function newPlayer(ant) {
  return { ant, input: newInput(), deathPos: null };
}

// ---------------------------------------------------------------------------
// world setup
// ---------------------------------------------------------------------------
function resetWorldState(world, seed) {
  T.init(world);
  G.seed = seed;
  G.trees = world.trees;
  G.colony = new Colony(world.colony);
  G.rival = world.rival;
  G.ants = []; G.brood = []; G.bugs = []; G.items = [];
  G.pheromones = []; G.events = []; G.over = null;
  G.players = [];
}

function newWorld(seed, playerCount) {
  const world = genWorld(seed);
  resetWorldState(world, seed);
  G.tick = Math.floor(DAY_LEN * 0.08); // start in the morning
  ENT_ID = 1;

  const c = G.colony;
  // the royal household
  const queen = new Ant(c.queenCh.x, c.queenCh.y, 'queen');
  G.ants.push(queen);
  for (let i = 0; i < 7; i++) {
    const spots = [c.junction, c.storage, c.nursery];
    const s = spots[i % spots.length];
    G.ants.push(new Ant(s.x + (Math.random() - 0.5) * 20, s.y - 4, 'worker'));
  }
  for (let i = 0; i < 2; i++) G.ants.push(new Ant(c.junction.x + (Math.random() - 0.5) * 16, c.junction.y, 'soldier'));
  for (let i = 0; i < 2; i++) G.ants.push(new Ant(c.nursery.x + (Math.random() - 0.5) * 16, c.nursery.y - 4, 'nurse'));
  for (let i = 0; i < 2; i++) {
    const l = new Brood(c.nursery.x + (Math.random() - 0.5) * 20, c.nursery.y - 2, 'larva');
    l.age = 600; G.brood.push(l);
  }
  G.brood.push(new Brood(c.nursery.x, c.nursery.y - 2, 'egg'));

  // player ants
  for (let p = 0; p < playerCount; p++) {
    const a = new Ant(c.entrance.x + (p ? 8 : -8), c.entrance.y - 8, 'worker');
    a.playerIdx = p;
    G.ants.push(a);
    G.players.push(newPlayer(a));
  }

  // scatter food & fauna
  for (let i = 0; i < 18; i++) {
    const x = 40 + Math.random() * (WORLD_W - 80);
    G.items.push(G.makeItem('seed', x, T.surf[Math.floor(x)] - 8));
  }
  for (let i = 0; i < 5; i++) {
    const x = 40 + Math.random() * (WORLD_W - 80);
    G.items.push(G.makeItem('leaf', x, T.surf[Math.floor(x)] - 6));
  }
  for (const t of G.trees.slice(0, 7)) {
    G.bugs.push(new Bug(t.x + (Math.random() < 0.5 ? -5 : 5),
      T.surf[t.x] - 10 - Math.random() * 40, 'aphid'));
  }
  for (let i = 0; i < 5; i++) {
    const x = 60 + Math.random() * (WORLD_W - 120);
    G.bugs.push(new Bug(x, T.surf[Math.floor(x)] - 6, 'pillbug'));
  }
  for (let i = 0; i < 5; i++) {
    const x = 100 + Math.random() * (WORLD_W - 200);
    G.bugs.push(new Bug(x, T.surf[Math.floor(x)] + 200 + Math.random() * 400, 'worm'));
  }

  // the rival colony's red-ant defenders, garrisoned on their far-side mound
  const r = G.rival;
  for (let i = 0; i < 5; i++) {
    const rx = Math.max(20, Math.min(WORLD_W - 20, r.entrance.x + (Math.random() - 0.5) * 90));
    const def = new Bug(rx, T.surf[Math.floor(rx)] - 8, 'redant');
    def.resident = true; def.homeX = r.entrance.x;
    G.bugs.push(def);
  }

  G.running = true;
}

// rebuild a world from saved data (see save.js). Returns false if the save
// can't be used with this build.
function restoreWorld(d, playerCount) {
  // saves from a different world size can't be reconciled with the new map
  if (d.w !== WORLD_W || d.h !== WORLD_H) return false;
  const world = genWorld(d.seed);
  world.m = rleDecode(d.terrain, WORLD_W * WORLD_H);
  resetWorldState(world, d.seed);
  G.tick = d.tick;
  Object.assign(G.colony, d.colony);
  G.colony.tasks = d.colony.tasks || [];
  G.colony.stats = d.colony.stats;

  const byId = {};
  for (const s of d.ants) {
    const a = new Ant(s.x, s.y, s.caste);
    a.id = s.id; a.hp = s.hp; a.playerIdx = -1;
    G.ants.push(a); byId[a.id] = a;
  }
  for (const s of d.brood) {
    const b = new Brood(s.x, s.y, s.kind);
    b.id = s.id; b.age = s.age; b.feedCount = s.feedCount;
    b.hungry = s.hungry; b.hungerT = s.hungerT;
    G.brood.push(b);
  }
  for (const s of d.bugs) {
    const b = new Bug(s.x, s.y, s.kind);
    b.id = s.id; b.hp = s.hp; b.fleeing = s.fleeing;
    b.resident = s.resident || false;
    if (s.homeX != null) b.homeX = s.homeX;
    G.bugs.push(b);
  }
  for (const s of d.items) {
    const it = new Item(s.kind, s.x, s.y, s.value);
    it.id = s.id;
    if (s.carriedBy && byId[s.carriedBy]) {
      it.carried = byId[s.carriedBy];
      byId[s.carriedBy].carry = it;
    }
    G.items.push(it);
  }
  ENT_ID = d.nextId || 10000;

  // reattach players
  for (let p = 0; p < playerCount; p++) {
    let ant = null;
    const sp = d.ants.find(s => s.playerIdx === p);
    if (sp && byId[sp.id] && byId[sp.id].hp > 0) ant = byId[sp.id];
    if (!ant) ant = G.ants.find(a => a.playerIdx < 0 && a.caste !== 'queen' && a.hp > 0);
    if (!ant) ant = G.ants.find(a => a.playerIdx < 0 && a.hp > 0);
    if (ant) {
      ant.playerIdx = p;
      ant.state = 'idle';
    }
    G.players.push(newPlayer(ant));
  }

  G.running = true;
  return true;
}

// ---------------------------------------------------------------------------
// player actions
// ---------------------------------------------------------------------------

// a soldier's call to arms: nearby ants turn on the soldier's closest enemy.
// Returns the number of ants rallied, or -1 if there was no enemy in range.
function rallyAllies(soldier, radius, foe) {
  foe = foe || G.nearestPredator(soldier.x, soldier.y, 400);
  if (!foe) return -1;
  let n = 0;
  for (const a of G.ants) {
    if (a === soldier || a.hp <= 0 || a.playerIdx >= 0 || a.caste === 'queen') continue;
    if (dist2(a.x, a.y, soldier.x, soldier.y) > radius * radius) continue;
    if (a.carry) continue; // laden ants finish their errand
    a.state = 'fight';
    a.target = foe;
    a.nav = null;
    a.rallyT = 600; // courage: don't immediately flee the thing we charge
    n++;
  }
  return n;
}

function controlPlayer(pIdx) {
  const p = G.players[pIdx];
  const a = p.ant;
  const inp = p.input;
  if (!a || a.hp <= 0) { inp.act = inp.abil = false; return; }
  const c = a.def;

  const dx = inp.dx, dy = inp.dy;

  const SPEED = c.speed * 1.5;
  a.vx = dx * SPEED;
  if (dx !== 0) a.dir = dx;

  // climbing: ants go up walls and hang from ceilings. Underground the
  // walls are implied -- every passage is a chewed-out tunnel, so holding
  // up always climbs even in wide dug-out chambers.
  a.climbing = false;
  a.ceiling = false;
  if (dy < 0) {
    let wallDir = 0;
    if (sideWall(a, a.dir)) wallDir = a.dir;
    else if (sideWall(a, -a.dir)) wallDir = -a.dir;
    else if (wallNear(a, a.dir, 5)) wallDir = a.dir;
    else if (wallNear(a, -a.dir, 5)) wallDir = -a.dir;
    const ceil = ceilAbove(a, 4);
    if (wallDir && (dx === 0 || dx === wallDir || !ceil)) {
      a.climbing = true; a.climbV = -SPEED * 1.1;
      a.dir = wallDir;
      if (dx === 0) a.vx = wallDir * SPEED * 0.6; // drift onto the wall
    } else if (ceil) {
      a.ceiling = true; // hang from the roof; crawl with left/right
    } else if (underground(a)) {
      a.climbing = true; a.climbV = -SPEED * 1.1; // tunnel climb, no wall needed
    } else if (a.onGround) {
      a.vy = -1.9; // hop
    }
  } else if (dy > 0 && !a.onGround &&
      (underground(a) ||
       sideWall(a, a.dir) || sideWall(a, -a.dir) || wallNear(a, 1, 5) || wallNear(a, -1, 5))) {
    a.climbing = true; a.climbV = SPEED * 1.1;
  }

  // bite / dig
  if (inp.bite && a.biteCd <= 0) {
    a.biteCd = c.digCd;
    a.biteAnim = 8;
    let ux = dx, uy = dy;
    if (ux === 0 && uy === 0) ux = a.dir;
    const len = Math.hypot(ux, uy);
    ux /= len; uy /= len;
    const bx = a.x + ux * (a.hw + 3.5), by = a.y + uy * (a.hh + 3.5);

    // bite a bug?
    let bit = null, bd = 90;
    for (const bug of G.bugs) {
      if (bug.dead) continue;
      const d = dist2(bx, by, bug.x, bug.y);
      if (d < bd) { bd = d; bit = bug; }
    }
    if (bit) {
      bit.hurt(c.dmg, ux * 1.2, uy * 0.6 - 0.3);
      bit.lastHitBy = 'player';
      G.sfx('bite', a.x, a.y);
    } else {
      const res = T.dig(bx, by, c.digR);
      // second pass right at the body so the ant can sink into its own shaft
      const res2 = T.dig(a.x + ux * 2, a.y + uy * 2, c.digR * 0.8);
      res.count += res2.count; res.leaves += res2.leaves;
      res.fungi += res2.fungi; res.crystals += res2.crystals;
      if (res.count > 0) {
        G.fx('dirt', bx, by, 4);
        G.sfx('dig', a.x, a.y);
        // expansion task: only digging below the surface counts
        const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, bx)));
        if (by > T.surf[sx] + 40) G.colony.progress('dig', res.count);
        // underground harvest: crystals and mushrooms tumble out of the wall
        if (res.crystals > 1) {
          G.items.push(G.makeItem('crystal', bx, by));
          G.fx('sparkle', bx, by, 6);
          G.msg('m_crystalFound', [], '#80e0ff', pIdx);
          G.sfx('task', a.x, a.y);
        } else if (res.fungi > 1 && Math.random() < 0.6) {
          G.items.push(G.makeItem('fungus', bx, by));
        } else if (res.leaves > 0 && Math.random() < 0.3 && !a.carry) {
          const it = G.makeItem('leaf', bx, by);
          G.items.push(it);
        }
      } else if (T.digHitsHard(bx, by, c.digR)) {
        G.sfx('clank', a.x, a.y);
        G.fx('clank', bx, by, 1);
      }
    }
  }

  // caste ability: soldiers rally, nurses heal
  if (inp.abil) {
    inp.abil = false;
    if (a.caste === 'soldier') {
      if (a.abilCd > 0) {
        // still catching its breath
      } else {
        const n = rallyAllies(a, 280);
        if (n < 0) {
          G.msg('m_noEnemy', [], null, pIdx);
        } else {
          a.abilCd = 600;
          G.msg(n > 0 ? 'm_rally' : 'm_rallyAlone', [n], '#ff8040', pIdx);
          G.sfx('danger', a.x, a.y);
        }
      }
    } else if (a.caste === 'nurse') {
      if (a.abilCd <= 0) {
        if (G.colony.food < 2) {
          G.msg('m_noFood', [], '#ff8040', pIdx);
        } else {
          let healed = 0;
          for (const o of G.ants) {
            if (o.hp <= 0 || o.hp >= o.maxHp) continue;
            if (dist2(a.x, a.y, o.x, o.y) > 40 * 40) continue;
            o.hp = Math.min(o.maxHp, o.hp + 10);
            G.fx('sparkle', o.x, o.y - 4, 4);
            healed++;
          }
          if (healed > 0) {
            G.colony.food -= 2;
            a.abilCd = 360;
            G.msg('m_healed', [healed], '#80ff80', pIdx);
            G.sfx('milk', a.x, a.y);
          } else {
            G.msg('m_noWounded', [], null, pIdx);
          }
        }
      }
    }
  }

  // interact
  if (inp.act) {
    inp.act = false;
    const col = G.colony;
    if (a.carry) {
      const it = a.carry;
      const nearStorage = Math.hypot(a.x - col.storage.x, a.y - col.storage.y) < 28;
      const larva = G.brood.find(l => l.kind === 'larva' && l.hungry && !l.dead &&
        dist2(a.x, a.y, l.x, l.y) < 144);
      if (nearStorage && ITEM_DEF[it.kind]) {
        col.deposit(it, a);
      } else if (larva && ITEM_DEF[it.kind]) {
        larva.feed();
        it.dead = true; a.carry = null;
        col.progress('feed', 1);
        G.msg('m_fed', [], null, pIdx);
        G.sfx('milk', a.x, a.y);
      } else {
        it.carried = null; a.carry = null;
        it.vx = a.dir * 0.6; it.vy = -0.5;
        G.sfx('drop', a.x, a.y);
      }
    } else {
      const it = G.nearestItem(a.x, a.y, 10);
      // nurses can scoop up eggs and larvae and carry them to safety
      let broodNear = null;
      if (!it && a.caste === 'nurse') {
        let bd = 100;
        for (const br of G.brood) {
          if (br.dead || br.carried) continue;
          const d = dist2(a.x, a.y, br.x, br.y);
          if (d < bd) { bd = d; broodNear = br; }
        }
      }
      if (it) {
        it.carried = a; a.carry = it;
        G.sfx('pickup', a.x, a.y);
      } else if (broodNear) {
        broodNear.carried = a; a.carry = broodNear;
        G.msg('m_carrying', [{ brood: broodNear.kind }], null, pIdx);
        G.sfx('pickup', a.x, a.y);
      } else {
        // milk an aphid?
        const aphid = G.bugs.find(bg => bg.kind === 'aphid' && !bg.dead &&
          bg.milkCd <= 0 && dist2(a.x, a.y, bg.x, bg.y) < 150);
        if (aphid) {
          aphid.milkCd = 1800;
          const hd = G.makeItem('honeydew', a.x, a.y);
          hd.carried = a; a.carry = hd;
          G.items.push(hd);
          G.msg('m_milked', [], null, pIdx);
          G.sfx('milk', a.x, a.y);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// taking over ants: on death, or a live switch. Players pick a CASTE (not an
// individual); they get the nearest free ant of that caste.
// ---------------------------------------------------------------------------
const CASTE_ORDER = ['worker', 'soldier', 'nurse', 'queen'];

function takeoverOptions() {
  const counts = {};
  for (const a of G.ants) {
    if (a.hp > 0 && a.playerIdx < 0) counts[a.caste] = (counts[a.caste] || 0) + 1;
  }
  return CASTE_ORDER.filter(c => counts[c]).map(c => ({ caste: c, count: counts[c] }));
}

// player pIdx takes the free ant of `caste` nearest (refX, refY). A living
// current ant is handed back to the colony. Returns the new ant, or null.
function takeOver(pIdx, caste, refX, refY) {
  let a = null, bd = Infinity;
  for (const c of G.ants) {
    if (c.hp <= 0 || c.playerIdx >= 0 || c.caste !== caste) continue;
    const d = dist2(c.x, c.y, refX, refY);
    if (d < bd) { bd = d; a = c; }
  }
  if (!a) return null;
  const p = G.players[pIdx];
  const prev = p.ant;
  if (prev && prev.hp > 0) {
    prev.playerIdx = -1;
    prev.state = 'idle'; prev.stateT = 120;
    prev.target = null; prev.nav = null;
    prev.climbing = false; prev.ceiling = false;
  }
  a.playerIdx = pIdx;
  a.state = 'idle';
  a.climbing = false;
  a.ceiling = false;
  a.nav = null;
  p.ant = a;
  p.deathPos = null;
  p.input = newInput();
  G.msg('m_nowPlaying', [{ caste: a.caste }], pIdx === 0 ? '#ffe080' : '#80d0ff', pIdx);
  return a;
}

// ---------------------------------------------------------------------------
// one simulation tick (1/60 s)
// ---------------------------------------------------------------------------
function stepSim() {
  G.tick++;

  for (let p = 0; p < G.players.length; p++) controlPlayer(p);

  // ants
  for (const a of G.ants) {
    if (a.hp > 0) a.update();
    if (a.playerIdx >= 0 && a.climbing) {
      // stubborn overhang: shimmy sideways, away from the wall first
      if (a.vBlocked && a.climbV < 0) {
        const vhw = Math.max(1, a.hw - 1.5);
        for (const s of [-1, -2, 1, 2]) {
          const nx = a.x + a.dir * s;
          if (!T.boxSolid(nx, a.y - 1, vhw, a.hh)) { a.x = nx; a.y -= 1; break; }
        }
      }
      a.vBlocked = false;
      // ledge-boost: only once no wall remains in grab reach -- and never
      // underground, where wall-less climbing is the whole point
      if (a.climbV < 0 && !underground(a) &&
          !wallNear(a, a.dir, 5) && !wallNear(a, -a.dir, 5)) {
        a.climbing = false; a.vy = -1.5; a.vx = a.dir * 0.8;
      }
    }
  }
  // deaths
  for (const a of G.ants) {
    if (a.hp <= 0 && !a.dead) {
      a.dead = true;
      if (a.carry) { a.carry.carried = null; a.carry = null; }
      G.items.push(G.makeItem('corpse', a.x, a.y));
      G.colony.stats.antsDied++;
      if (a.playerIdx >= 0) {
        const pIdx = a.playerIdx;
        G.sfx('die', a.x, a.y, 9999);
        for (let q = 0; q < G.players.length; q++) {
          if (q === pIdx) G.msg('m_youDied', [], '#ff5040', q);
          else G.msg('m_pDied', [pIdx + 1], '#ff5040', q);
        }
        G.players[pIdx].ant = null;
        G.players[pIdx].deathPos = { x: a.x, y: a.y };
      } else {
        if (a.caste === 'queen') {
          G.msg('m_queenDead', [], '#ff4030');
          G.sfx('danger');
        } else if (G.nearPlayer(a.x, a.y) < 300) {
          G.msg('m_antDied', [], '#c08070');
          G.sfx('kill', a.x, a.y);
        }
      }
    }
  }
  G.ants = G.ants.filter(a => !a.dead);

  // brood
  for (const b of G.brood) {
    b.update();
    if (b.hp <= 0 && !b.dead) {
      b.dead = true;
      G.fx('blood', b.x, b.y, 4);
      G.msg('m_larvaDied', [], '#c08070');
    }
  }
  G.brood = G.brood.filter(b => !b.dead);

  // bugs
  for (const b of G.bugs) {
    b.update();
    if (b.hp <= 0 && !b.dead) {
      b.dead = true;
      const it = G.makeItem(b.predator || b.kind === 'worm' ? 'bigcorpse' : 'corpse', b.x, b.y, BUG_DEF[b.kind].corpse);
      G.items.push(it);
      G.fx('blood', b.x, b.y, 8);
      if (b.predator) {
        G.colony.stats.predatorsSlain++;
        G.msg('m_slain', [{ bug: b.kind }], '#ffe040');
        G.sfx('kill');
      } else {
        G.sfx('kill', b.x, b.y, 250);
      }
    }
  }
  G.bugs = G.bugs.filter(b => !b.dead);

  // items
  for (const it of G.items) if (!it.dead) it.update();
  G.items = G.items.filter(i => !i.dead);

  // pheromone trails from laden ants
  if (G.tick % 8 === 0) {
    for (const a of G.ants) {
      if (a.carry && a.hp > 0) {
        G.pheromones.push({ x: a.x, y: a.y + 2, t: 900 });
      }
    }
    if (G.pheromones.length > 700) G.pheromones.splice(0, G.pheromones.length - 700);
  }
  for (const ph of G.pheromones) ph.t--;
  if (G.tick % 30 === 0) G.pheromones = G.pheromones.filter(p => p.t > 0);

  G.colony.update();

  // extinction
  if (!G.over && G.ants.filter(a => a.hp > 0).length === 0) {
    G.over = {
      day: G.day,
      score: G.colony.score,
      stats: Object.assign({}, G.colony.stats),
    };
  }
}
