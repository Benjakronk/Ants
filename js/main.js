// MAUR -- main: game state, input, player control, rendering, menus.
'use strict';

const VIEW_W = 320, VIEW_H = 200, HUD_H = 24;

// key bindings per player (KeyboardEvent.code)
const BIND = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', bite: 'Space', act: 'KeyE' },
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', bite: 'Period', act: 'Comma' },
];

// ---------------------------------------------------------------------------
// global game object
// ---------------------------------------------------------------------------
const G = {
  state: 'title',     // title | slots | intro | help | play | pause | dead | gameover
  running: false,
  seed: 0,
  slot: 1,
  tick: 0,
  playerCount: 1,
  players: [],        // { ant, cam:{x,y} }
  ants: [], brood: [], bugs: [], items: [],
  pheromones: [],
  stars: [],
  trees: [],
  colony: null,
  msgs: [],
  deadQueue: [],      // player indices waiting for takeover
  takeover: null,     // { pIdx, list, sel }
  menuSel: 0,
  slotSel: 0,
  eraseArm: -1,
  autosaveT: 0,
  introLine: 0,
  showMap: false,
  prevState: 'title',
  gameOverStats: null,

  get day() { return Math.floor(this.tick / DAY_LEN); },
  tod() { return (this.tick % DAY_LEN) / DAY_LEN; },
  isNight() { return this.tod() >= 0.7; },

  msg(text, color) {
    this.msgs.push({ text, color: color || '#e8e0c8', t: 300 });
    if (this.msgs.length > 4) this.msgs.shift();
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

  particles: {
    list: [],
    add(x, y, vx, vy, life, color) {
      if (this.list.length > 400) this.list.shift();
      this.list.push({ x, y, vx, vy, life, max: life, color });
    },
    dirt(x, y, n) {
      for (let i = 0; i < n; i++) {
        this.add(x, y, (Math.random() - 0.5) * 1.6, -Math.random() * 1.4,
          20 + Math.random() * 16, Math.random() < 0.5 ? '#6b4226' : '#8a5a34');
      }
    },
    blood(x, y, n) {
      for (let i = 0; i < n; i++) {
        this.add(x, y, (Math.random() - 0.5) * 1.4, -Math.random() * 1.2,
          18 + Math.random() * 14, Math.random() < 0.5 ? '#9acd32' : '#7aa824');
      }
    },
    sparkle(x, y, n) {
      for (let i = 0; i < n; i++) {
        this.add(x, y, (Math.random() - 0.5) * 0.8, -Math.random() * 0.8 - 0.2,
          24 + Math.random() * 12, Math.random() < 0.5 ? '#ffe040' : '#fff8a0');
      }
    },
    update() {
      for (const p of this.list) {
        p.vy += 0.08;
        p.x += p.vx; p.y += p.vy;
        if (T.solid(p.x, p.y)) { p.vx = 0; p.vy = 0; }
        p.life--;
      }
      this.list = this.list.filter(p => p.life > 0);
    },
    draw(ctx, camx, camy) {
      for (const p of this.list) {
        const ex = Math.round(p.x - camx), ey = Math.round(p.y - camy);
        if (ex < 0 || ex > VIEW_W || ey < 0 || ey > VIEW_H) continue;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.min(1, p.life / (p.max * 0.5));
        ctx.fillRect(ex, ey, 1, 1);
        ctx.globalAlpha = 1;
      }
    }
  },
};

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------
const keys = {};
const pressed = {};

window.addEventListener('keydown', e => {
  if (!keys[e.code]) pressed[e.code] = true;
  keys[e.code] = true;
  Sfx.init(); Sfx.resume();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function tookPress(code) {
  if (pressed[code]) { pressed[code] = false; return true; }
  return false;
}

// ---------------------------------------------------------------------------
// world setup
// ---------------------------------------------------------------------------
function newWorld(slot, playerCount) {
  const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
  const world = genWorld(seed);
  T.init(world);
  G.seed = seed;
  G.slot = slot;
  G.tick = Math.floor(DAY_LEN * 0.08); // start in the morning
  G.playerCount = playerCount;
  G.trees = world.trees;
  G.colony = new Colony(world.colony);
  G.ants = []; G.brood = []; G.bugs = []; G.items = [];
  G.pheromones = []; G.msgs = []; G.deadQueue = []; G.takeover = null;
  G.particles.list = [];
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
  G.players = [];
  for (let p = 0; p < playerCount; p++) {
    const a = new Ant(c.entrance.x + (p ? 8 : -8), c.entrance.y - 8, 'worker');
    a.playerIdx = p;
    G.ants.push(a);
    G.players.push({ ant: a, cam: { x: a.x - VIEW_W / 2, y: a.y - 60 } });
  }

  // scatter food & fauna
  for (let i = 0; i < 12; i++) {
    const x = 40 + Math.random() * (WORLD_W - 80);
    G.items.push(G.makeItem('seed', x, T.surf[Math.floor(x)] - 8));
  }
  for (let i = 0; i < 3; i++) {
    const x = 40 + Math.random() * (WORLD_W - 80);
    G.items.push(G.makeItem('leaf', x, T.surf[Math.floor(x)] - 6));
  }
  for (const t of G.trees.slice(0, 5)) {
    G.bugs.push(new Bug(t.x + 4, t.topY + 25 + Math.random() * 30, 'aphid'));
  }
  for (let i = 0; i < 3; i++) {
    const x = 60 + Math.random() * (WORLD_W - 120);
    G.bugs.push(new Bug(x, T.surf[Math.floor(x)] - 6, 'pillbug'));
  }
  for (let i = 0; i < 3; i++) {
    const x = 100 + Math.random() * (WORLD_W - 200);
    G.bugs.push(new Bug(x, T.surf[Math.floor(x)] + 200 + Math.random() * 400, 'worm'));
  }

  // stars
  G.stars = [];
  for (let i = 0; i < 90; i++) {
    G.stars.push({ x: Math.random() * WORLD_W, y: Math.random() * 280 });
  }

  G.running = true;
  G.autosaveT = 7200;
}

function loadWorld(slot, playerCount) {
  const d = loadWorldData(slot);
  if (!d) return false;
  const world = genWorld(d.seed);
  world.m = rleDecode(d.terrain, WORLD_W * WORLD_H);
  T.init(world);
  G.seed = d.seed;
  G.slot = slot;
  G.tick = d.tick;
  G.playerCount = playerCount || d.playerCount;
  G.trees = world.trees;
  G.colony = new Colony(world.colony);
  Object.assign(G.colony, d.colony);
  G.colony.tasks = d.colony.tasks || [];
  G.colony.stats = d.colony.stats;
  G.ants = []; G.brood = []; G.bugs = []; G.items = [];
  G.pheromones = []; G.msgs = []; G.deadQueue = []; G.takeover = null;
  G.particles.list = [];

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
  G.players = [];
  const savedPlayers = d.ants.filter(s => s.playerIdx >= 0).sort((a, b) => a.playerIdx - b.playerIdx);
  for (let p = 0; p < G.playerCount; p++) {
    let ant = null;
    const sp = savedPlayers.find(s => s.playerIdx === p);
    if (sp && byId[sp.id] && byId[sp.id].hp > 0) ant = byId[sp.id];
    if (!ant) ant = G.ants.find(a => a.playerIdx < 0 && a.caste !== 'queen' && a.hp > 0);
    if (!ant) ant = G.ants.find(a => a.playerIdx < 0 && a.hp > 0);
    if (ant) {
      ant.playerIdx = p;
      ant.state = 'idle';
      G.players.push({ ant, cam: { x: ant.x - VIEW_W / 2, y: ant.y - 60 } });
    } else {
      G.players.push({ ant: null, cam: { x: 0, y: 0 } });
      G.deadQueue.push(p);
    }
  }

  G.stars = [];
  const srng = mulberry32(d.seed ^ 0x5747);
  for (let i = 0; i < 90; i++) G.stars.push({ x: srng() * WORLD_W, y: srng() * 280 });

  G.running = true;
  G.autosaveT = 7200;
  return true;
}

// ---------------------------------------------------------------------------
// player control
// ---------------------------------------------------------------------------
function controlPlayer(pIdx) {
  const p = G.players[pIdx];
  const a = p.ant;
  if (!a || a.hp <= 0) return;
  const b = BIND[pIdx];
  const c = a.def;

  let dx = (keys[b.right] ? 1 : 0) - (keys[b.left] ? 1 : 0);
  let dy = (keys[b.down] ? 1 : 0) - (keys[b.up] ? 1 : 0);

  const SPEED = c.speed * 1.5;
  a.vx = dx * SPEED;
  if (dx !== 0) a.dir = dx;

  // climbing: ants go up walls
  a.climbing = false;
  if (dy < 0) {
    let wallDir = 0;
    if (sideWall(a, a.dir)) wallDir = a.dir;
    else if (sideWall(a, -a.dir)) wallDir = -a.dir;
    else if (wallNear(a, a.dir, 5)) wallDir = a.dir;
    else if (wallNear(a, -a.dir, 5)) wallDir = -a.dir;
    if (wallDir) {
      a.climbing = true; a.climbV = -SPEED * 1.1;
      a.dir = wallDir;
      if (dx === 0) a.vx = wallDir * SPEED * 0.6; // drift onto the wall
    } else if (a.onGround) {
      a.vy = -1.9; // hop
    }
  } else if (dy > 0 && !a.onGround &&
      (sideWall(a, a.dir) || sideWall(a, -a.dir) || wallNear(a, 1, 5) || wallNear(a, -1, 5))) {
    a.climbing = true; a.climbV = SPEED * 1.1;
  }

  // bite / dig
  if (keys[b.bite] && a.biteCd <= 0) {
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
      Sfx.play('bite');
    } else {
      const res = T.dig(bx, by, c.digR);
      // second pass right at the body so the ant can sink into its own shaft
      const res2 = T.dig(a.x + ux * 2, a.y + uy * 2, c.digR * 0.8);
      res.count += res2.count; res.leaves += res2.leaves;
      if (res.count > 0) {
        G.particles.dirt(bx, by, 4);
        Sfx.play('dig');
        // expansion task: only digging below the surface counts
        const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, bx)));
        if (by > T.surf[sx] + 40) G.colony.progress('dig', res.count);
        if (res.leaves > 0 && Math.random() < 0.3 && !a.carry) {
          const it = G.makeItem('leaf', bx, by);
          G.items.push(it);
        }
      } else if (T.digHitsHard(bx, by, c.digR)) {
        Sfx.play('clank');
        G.particles.add(bx, by, (Math.random() - 0.5), -0.5, 10, '#c0c0c8');
      }
    }
  }

  // interact
  if (tookPress(b.act)) {
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
        G.msg('FED THE LARVA');
        Sfx.play('milk');
      } else {
        it.carried = null; a.carry = null;
        it.vx = a.dir * 0.6; it.vy = -0.5;
        Sfx.play('drop');
      }
    } else {
      const it = G.nearestItem(a.x, a.y, 10);
      if (it) {
        it.carried = a; a.carry = it;
        Sfx.play('pickup');
      } else {
        // milk an aphid?
        const aphid = G.bugs.find(bg => bg.kind === 'aphid' && !bg.dead &&
          bg.milkCd <= 0 && dist2(a.x, a.y, bg.x, bg.y) < 150);
        if (aphid) {
          aphid.milkCd = 1800;
          const hd = G.makeItem('honeydew', a.x, a.y);
          hd.carried = a; a.carry = hd;
          G.items.push(hd);
          G.msg('MILKED THE APHID! +HONEYDEW');
          Sfx.play('milk');
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// play update
// ---------------------------------------------------------------------------
function updatePlay() {
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
      // ledge-boost: only once no wall remains in grab reach
      if (a.climbV < 0 && !wallNear(a, a.dir, 5) && !wallNear(a, -a.dir, 5)) {
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
        Sfx.play('die');
        G.msg(G.playerCount > 1 ? 'PLAYER ' + (a.playerIdx + 1) + ' DIED!' : 'YOU DIED!', '#ff5040');
        G.deadQueue.push(a.playerIdx);
        G.players[a.playerIdx].ant = null;
      } else {
        if (a.caste === 'queen') {
          G.msg('THE QUEEN IS DEAD!', '#ff4030');
          Sfx.play('danger');
        } else if (G.nearPlayer(a.x, a.y) < 300) {
          G.msg('AN ANT HAS DIED', '#c08070');
          Sfx.play('kill');
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
      G.particles.blood(b.x, b.y, 4);
      G.msg('A LARVA HAS PERISHED', '#c08070');
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
      G.particles.blood(b.x, b.y, 8);
      if (b.predator) {
        G.colony.stats.predatorsSlain++;
        G.msg('THE ' + b.kind.toUpperCase() + ' IS SLAIN!', '#ffe040');
        Sfx.play('kill');
      } else if (G.nearPlayer(b.x, b.y) < 250) {
        Sfx.play('kill');
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

  G.particles.update();
  G.colony.update();

  // messages
  for (const m of G.msgs) m.t--;
  G.msgs = G.msgs.filter(m => m.t > 0);

  // cameras
  for (const p of G.players) {
    if (!p.ant) continue;
    const vh = G.playerCount > 1 ? (VIEW_H - HUD_H) / 2 : VIEW_H - HUD_H;
    const tx = p.ant.x - VIEW_W / 2 + p.ant.dir * 24;
    const ty = p.ant.y - vh / 2 - 8;
    p.cam.x += (tx - p.cam.x) * 0.08;
    p.cam.y += (ty - p.cam.y) * 0.08;
    p.cam.x = Math.max(0, Math.min(WORLD_W - VIEW_W, p.cam.x));
    p.cam.y = Math.max(0, Math.min(WORLD_H - vh, p.cam.y));
  }

  // takeover queue
  if (G.deadQueue.length > 0 && !G.takeover) {
    const pIdx = G.deadQueue[0];
    const candidates = G.ants
      .filter(a => a.hp > 0 && a.playerIdx < 0)
      .sort((x, y) => {
        // queen last
        if (x.caste === 'queen') return 1;
        if (y.caste === 'queen') return -1;
        return 0;
      })
      .slice(0, 6);
    if (candidates.length === 0) {
      endWorld();
      return;
    }
    G.takeover = { pIdx, list: candidates, sel: 0 };
    G.state = 'dead';
  }

  // extinction check
  if (G.ants.filter(a => a.hp > 0).length === 0) {
    endWorld();
    return;
  }

  // autosave
  G.autosaveT--;
  if (G.autosaveT <= 0) {
    G.autosaveT = 7200;
    if (saveWorld(G.slot)) { G.msg('GAME SAVED', '#80c0ff'); Sfx.play('save'); }
  }

  if (tookPress('KeyM')) G.showMap = !G.showMap;
  if (tookPress('Escape') || tookPress('KeyP')) {
    G.state = 'pause'; G.menuSel = 0; Sfx.play('menu');
  }
}

function endWorld() {
  G.gameOverStats = {
    day: G.day,
    score: G.colony.score,
    stats: Object.assign({}, G.colony.stats),
  };
  deleteWorld(G.slot);
  G.running = false;
  G.state = 'gameover';
  Sfx.play('die');
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

function skyColor(tod) {
  const stops = [
    [0.00, [148, 100, 92]],
    [0.08, [110, 165, 220]],
    [0.45, [125, 185, 235]],
    [0.62, [185, 140, 85]],
    [0.70, [70, 55, 95]],
    [0.80, [20, 20, 44]],
    [0.95, [22, 22, 48]],
    [1.00, [148, 100, 92]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    if (tod >= stops[i][0] && tod <= stops[i + 1][0]) {
      const t = (tod - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      const a = stops[i][1], b = stops[i + 1][1];
      return [
        a[0] + (b[0] - a[0]) * t | 0,
        a[1] + (b[1] - a[1]) * t | 0,
        a[2] + (b[2] - a[2]) * t | 0,
      ];
    }
  }
  return stops[1][1];
}

function drawViewport(p, vx, vy, vw, vh) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(vx, vy, vw, vh);
  ctx.clip();
  ctx.translate(vx, vy);

  const camx = Math.round(p.cam.x), camy = Math.round(p.cam.y);
  const tod = G.tod();

  // sky
  const sc = skyColor(tod);
  ctx.fillStyle = `rgb(${sc[0]},${sc[1]},${sc[2]})`;
  ctx.fillRect(0, 0, vw, vh);

  // stars
  if (tod > 0.68 || tod < 0.04) {
    ctx.fillStyle = '#e8e8ff';
    for (const s of G.stars) {
      const ex = Math.round(s.x - camx * 0.9), ey = Math.round(s.y - camy * 0.9);
      if (ex >= 0 && ex < vw && ey >= 0 && ey < vh) {
        if ((pxHash(s.x | 0, G.tick >> 5) % 13) !== 0) ctx.fillRect(ex, ey, 1, 1);
      }
    }
  }

  // sun / moon ride across the sky (world-positioned, parallax 0.85)
  const isDayTime = tod < 0.7;
  const ct = isDayTime ? tod / 0.7 : (tod - 0.7) / 0.3;
  const bodyX = ct * (WORLD_W + 200) - 100;
  const bodyY = 180 - Math.sin(ct * Math.PI) * 150;
  const bx = Math.round(bodyX - camx * 0.85), by = Math.round(bodyY - camy * 0.85);
  if (bx > -10 && bx < vw + 10 && by > -10 && by < vh + 10) {
    if (isDayTime) {
      ctx.fillStyle = '#ffe860';
      ctx.fillRect(bx - 3, by - 2, 6, 5);
      ctx.fillRect(bx - 2, by - 3, 4, 7);
      ctx.fillStyle = '#fff8c0';
      ctx.fillRect(bx - 2, by - 1, 3, 2);
    } else {
      ctx.fillStyle = '#d8d8e8';
      ctx.fillRect(bx - 3, by - 2, 6, 5);
      ctx.fillRect(bx - 2, by - 3, 4, 7);
      ctx.fillStyle = '#a8a8c0';
      ctx.fillRect(bx, by - 1, 2, 2);
    }
  }

  // world
  ctx.drawImage(T.bgCan, camx, camy, vw, vh, 0, 0, vw, vh);
  ctx.drawImage(T.terCan, camx, camy, vw, vh, 0, 0, vw, vh);

  // the food cache, piled by prosperity
  const col = G.colony;
  const pile = Math.min(24, Math.floor(col.food / 6));
  ctx.fillStyle = '#d8b878';
  for (let i = 0; i < pile; i++) {
    const h = pxHash(i * 17, 3);
    const px2 = col.storage.x - 10 + (h % 21);
    const py2 = col.storage.y + 8 - (Math.floor(h / 64) % 5) - Math.floor(Math.abs(px2 - col.storage.x) / 4);
    ctx.fillRect(Math.round(px2 - camx), Math.round(py2 - camy), 2, 1);
  }

  // pheromones
  ctx.fillStyle = '#c04848';
  for (const ph of G.pheromones) {
    const ex = Math.round(ph.x - camx), ey = Math.round(ph.y - camy);
    if (ex < 0 || ex > vw || ey < 0 || ey > vh) continue;
    ctx.globalAlpha = Math.min(0.35, ph.t / 900 * 0.35);
    ctx.fillRect(ex, ey, 1, 1);
  }
  ctx.globalAlpha = 1;

  // entities
  for (const it of G.items) if (!it.carried) drawItem(ctx, it, camx, camy);
  for (const b of G.brood) b.draw(ctx, camx, camy);
  for (const b of G.bugs) b.draw(ctx, camx, camy);
  for (const a of G.ants) if (a.playerIdx < 0) a.draw(ctx, camx, camy);
  for (const pp of G.players) if (pp.ant) pp.ant.draw(ctx, camx, camy);

  G.particles.draw(ctx, camx, camy);

  // darkness: depth + night, with a pool of sight around your ant
  if (p.ant) {
    const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, p.ant.x)));
    const depth = Math.max(0, p.ant.y - T.bgSurf[sx]);
    let amb = Math.min(0.86, depth / 90 * 0.86);
    if (G.isNight()) amb = Math.max(amb, 0.55);
    else if (tod > 0.62) amb = Math.max(amb, (tod - 0.62) / 0.08 * 0.4);
    if (amb > 0.03) {
      const px2 = Math.round(p.ant.x - camx), py2 = Math.round(p.ant.y - camy);
      const grad = ctx.createRadialGradient(px2, py2, 18, px2, py2, 90);
      grad.addColorStop(0, 'rgba(4,2,8,0)');
      grad.addColorStop(0.7, `rgba(4,2,8,${amb * 0.55})`);
      grad.addColorStop(1, `rgba(4,2,8,${amb})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, vw, vh);
    }
  }

  ctx.restore();
}

function bevelPanel(x, y, w, h) {
  ctx.fillStyle = '#4a3826';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#7a6044';
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = '#241a10';
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x + w - 1, y, 1, h);
}

function drawHpBar(x, y, w, pct) {
  ctx.fillStyle = '#1a1008';
  ctx.fillRect(x, y, w, 5);
  const fw = Math.max(0, Math.round((w - 2) * pct));
  ctx.fillStyle = pct > 0.5 ? '#40c040' : pct > 0.25 ? '#e0c020' : '#e03020';
  ctx.fillRect(x + 1, y + 1, fw, 3);
}

function drawHud() {
  const y = VIEW_H - HUD_H;
  bevelPanel(0, y, VIEW_W, HUD_H);
  const col = G.colony;

  // player panels
  for (let i = 0; i < G.playerCount; i++) {
    const px2 = i === 0 ? 4 : VIEW_W - 86;
    const p = G.players[i];
    drawText(ctx, 'P' + (i + 1), px2, y + 4, i === 0 ? '#ffe080' : '#80d0ff');
    if (p.ant) {
      drawHpBar(px2 + 14, y + 5, 40, Math.max(0, p.ant.hp / p.ant.maxHp));
      drawText(ctx, p.ant.caste, px2 + 14, y + 13, '#b0a080');
      if (p.ant.carry) {
        drawItem(ctx, { kind: p.ant.carry.kind, x: 0, y: 0 },
          -(px2 + 62), -(y + 8));
      }
    } else {
      drawText(ctx, 'DEAD', px2 + 14, y + 5, '#e03020');
    }
  }

  // colony status, center
  const cx = VIEW_W / 2;
  const ants = G.ants.filter(a => a.hp > 0).length;
  drawText(ctx, '\x02' + ants, cx - 56, y + 4, '#e8c8a0');
  drawText(ctx, '\x03' + Math.floor(col.food), cx - 22, y + 4, '#d8b878');
  drawText(ctx, (G.isNight() ? '\x05' : '\x04') + 'DAY ' + (G.day + 1), cx + 14, y + 4, '#c0c0d8');
  drawText(ctx, 'SCORE ' + col.score, cx - 56, y + 14, '#a0c8a0');
  const brood = G.brood.length;
  drawText(ctx, 'BROOD ' + brood, cx + 14, y + 14, '#d0c8b0');
}

function drawTaskAndMsgs() {
  // current task, top left
  const t = G.colony.tasks.find(t => !t.done) || G.colony.tasks.find(t => t.done && t.doneT > 0);
  if (t) {
    let str;
    if (t.done) str = t.text + ' - COMPLETE!';
    else if (t.type === 'dig') str = t.text + ' ' + Math.floor(t.n) + '/' + t.need;
    else str = t.text + ' ' + t.n + '/' + t.need;
    const blink = t.done && (G.tick >> 3) % 2;
    if (!blink) drawTextS(ctx, str, 4, 3, t.done ? '#ffe040' : '#a8e8a0');
  }

  // messages
  let my = 14;
  for (const m of G.msgs) {
    ctx.globalAlpha = Math.min(1, m.t / 60);
    drawTextCS(ctx, m.text, VIEW_W / 2, my, m.color);
    ctx.globalAlpha = 1;
    my += 10;
  }
}

function drawMinimap() {
  const mw = 256, mh = 160;
  const mx = (VIEW_W - mw) / 2, my = (VIEW_H - mh) / 2 - 6;
  bevelPanel(mx - 3, my - 3, mw + 6, mh + 6);
  ctx.fillStyle = '#101418';
  ctx.fillRect(mx, my, mw, mh);
  ctx.drawImage(T.bgCan, 0, 0, WORLD_W, WORLD_H, mx, my, mw, mh);
  ctx.drawImage(T.terCan, 0, 0, WORLD_W, WORLD_H, mx, my, mw, mh);
  const sx = mw / WORLD_W, sy = mh / WORLD_H;
  for (const a of G.ants) {
    if (a.hp <= 0) continue;
    ctx.fillStyle = a.playerIdx === 0 ? '#ffff40' : a.playerIdx === 1 ? '#40d0ff'
      : a.caste === 'queen' ? '#ff40c0' : '#e0a060';
    const sz = a.playerIdx >= 0 && (G.tick >> 3) % 2 ? 3 : 2;
    ctx.fillRect(mx + a.x * sx - 1, my + a.y * sy - 1, sz, sz);
  }
  ctx.fillStyle = '#ff3020';
  for (const b of G.bugs) {
    if (b.predator) ctx.fillRect(mx + b.x * sx - 1, my + b.y * sy - 1, 2, 2);
  }
}

function drawPlay() {
  if (G.playerCount === 1) {
    drawViewport(G.players[0], 0, 0, VIEW_W, VIEW_H - HUD_H);
  } else {
    const vh = (VIEW_H - HUD_H - 2) / 2;
    drawViewport(G.players[0], 0, 0, VIEW_W, vh);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, vh, VIEW_W, 2);
    drawViewport(G.players[1], 0, vh + 2, VIEW_W, vh);
  }
  drawHud();
  drawTaskAndMsgs();
  if (G.showMap) drawMinimap();
}

// ---------------------------------------------------------------------------
// menus & screens
// ---------------------------------------------------------------------------
function menuNav(n) {
  let moved = false;
  if (tookPress('ArrowUp') || tookPress('KeyW')) { G.menuSel = (G.menuSel + n - 1) % n; moved = true; }
  if (tookPress('ArrowDown') || tookPress('KeyS')) { G.menuSel = (G.menuSel + 1) % n; moved = true; }
  if (moved) Sfx.play('menu');
  return tookPress('Enter') || tookPress('Space');
}

// a little troupe of title-screen ants
const titleAnts = [];
for (let i = 0; i < 5; i++) {
  titleAnts.push({ x: -i * 40 - Math.random() * 30, y: 168, phase: Math.random() * 10 });
}

function drawTitle() {
  // backdrop: night soil layers
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  for (let y = 0; y < VIEW_H; y += 2) {
    const t = y / VIEW_H;
    ctx.fillStyle = `rgb(${12 + t * 30 | 0},${8 + t * 18 | 0},${5 + t * 10 | 0})`;
    ctx.fillRect(0, y, VIEW_W, 2);
  }
  // speckle
  ctx.fillStyle = '#2a1c10';
  for (let i = 0; i < 200; i++) {
    const h = pxHash(i, 999);
    ctx.fillRect(h % VIEW_W, 40 + (h >> 9) % 160, 1, 1);
  }

  // logo
  const ly = 38;
  drawTextC(ctx, 'MAUR', VIEW_W / 2 + 3, ly + 3, '#3a1408', 6);
  drawTextC(ctx, 'MAUR', VIEW_W / 2, ly, '#d86020', 6);
  drawTextC(ctx, 'MAUR', VIEW_W / 2 - 1, ly - 1, '#ffa040', 6);
  drawTextCS(ctx, 'AN ANT COLONY UNDER YOUR COMMAND', VIEW_W / 2, ly + 50, '#b09060');

  // menu
  const items = ['START GAME', 'HELP',
    'SOUND: ' + (Sfx.muted ? 'OFF' : 'ON'),
    'CRT: ' + (document.getElementById('crt').classList.contains('off') ? 'OFF' : 'ON')];
  const my = 118;
  for (let i = 0; i < items.length; i++) {
    const sel = i === G.menuSel;
    if (sel) drawTextC(ctx, '\x06', VIEW_W / 2 - textWidth(items[i]) / 2 - 12, my + i * 12, '#ffe040');
    drawTextCS(ctx, items[i], VIEW_W / 2, my + i * 12, sel ? '#ffe040' : '#c8b890');
  }

  // marching ants
  ctx.save();
  for (const ta of titleAnts) {
    ta.x += 0.4;
    ta.phase += 0.25;
    if (ta.x > VIEW_W + 20) ta.x = -20 - Math.random() * 40;
    const fake = {
      x: ta.x, y: ta.y, dir: 1, phase: ta.phase, def: CASTE.worker,
      caste: 'worker', flash: 0, biteAnim: 0, climbing: false, carry: null, playerIdx: -1,
      draw: Ant.prototype.draw,
    };
    fake.draw(ctx, 0, 0);
  }
  ctx.restore();

  drawTextC(ctx, '(C) 1998 BENSOFT INTERACTIVE', VIEW_W / 2, VIEW_H - 12, '#605040');
}

function updateTitle() {
  if (menuNav(4)) {
    Sfx.play('select');
    switch (G.menuSel) {
      case 0: G.state = 'slots'; G.slotSel = 0; G.eraseArm = -1; break;
      case 1: G.prevState = 'title'; G.state = 'help'; break;
      case 2: Sfx.toggleMute(); break;
      case 3: document.getElementById('crt').classList.toggle('off'); break;
    }
  }
}

function drawSlots() {
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawTextCS(ctx, 'CHOOSE A WORLD', VIEW_W / 2, 18, '#ffa040', 2);

  for (let i = 0; i < 3; i++) {
    const info = slotInfo(i + 1);
    const sy = 52 + i * 34;
    const sel = i === G.slotSel;
    bevelPanel(40, sy - 4, 240, 28);
    if (sel) {
      ctx.fillStyle = '#ffe040';
      ctx.fillRect(40, sy - 4, 240, 1);
      ctx.fillRect(40, sy + 23, 240, 1);
      ctx.fillRect(40, sy - 4, 1, 28);
      ctx.fillRect(279, sy - 4, 1, 28);
      drawText(ctx, '\x06', 28, sy + 5, '#ffe040');
    }
    drawText(ctx, 'WORLD ' + (i + 1), 48, sy, sel ? '#ffe040' : '#c8b890');
    if (info) {
      drawText(ctx, 'DAY ' + (info.day + 1) + '  \x02' + info.ants + '  \x03' + info.food + '  SCORE ' + info.score,
        48, sy + 10, '#a09070');
      if (G.eraseArm === i) drawText(ctx, 'X AGAIN TO ERASE!', 180, sy, '#ff5040');
    } else {
      drawText(ctx, 'EMPTY - A NEW COLONY AWAITS', 48, sy + 10, '#706050');
    }
  }
  drawTextC(ctx, 'ENTER: 1 PLAYER    T: 2 PLAYERS', VIEW_W / 2, 164, '#b0a080');
  drawTextC(ctx, 'X: ERASE    ESC: BACK', VIEW_W / 2, 176, '#706050');
}

function updateSlots() {
  if (tookPress('ArrowUp') || tookPress('KeyW')) { G.slotSel = (G.slotSel + 2) % 3; G.eraseArm = -1; Sfx.play('menu'); }
  if (tookPress('ArrowDown') || tookPress('KeyS')) { G.slotSel = (G.slotSel + 1) % 3; G.eraseArm = -1; Sfx.play('menu'); }
  if (tookPress('Escape')) { G.state = 'title'; return; }
  if (tookPress('KeyX')) {
    if (G.eraseArm === G.slotSel && slotInfo(G.slotSel + 1)) {
      deleteWorld(G.slotSel + 1);
      G.eraseArm = -1;
      Sfx.play('kill');
    } else if (slotInfo(G.slotSel + 1)) {
      G.eraseArm = G.slotSel;
      Sfx.play('menu');
    }
  }
  let pc = 0;
  if (tookPress('Enter') || tookPress('Space')) pc = 1;
  if (tookPress('KeyT')) pc = 2;
  if (pc) {
    Sfx.play('select');
    const slot = G.slotSel + 1;
    if (slotInfo(slot)) {
      if (loadWorld(slot, pc)) { G.state = 'play'; G.msg('WELCOME BACK TO THE COLONY'); }
    } else {
      newWorld(slot, pc);
      G.state = 'intro';
      G.introLine = 0;
    }
  }
}

const INTRO_TEXT = [
  'SPRING. THE THAW HAS COME.',
  '',
  'DEEP BENEATH THE FOREST FLOOR,',
  'A YOUNG QUEEN STIRS. HER COLONY',
  'IS SMALL, HUNGRY, AND SURROUNDED',
  'BY THINGS THAT BITE.',
  '',
  'YOU ARE ONE OF HER WORKERS.',
  '',
  'DIG. FORAGE. FEED THE BROOD.',
  'DEFEND THE NEST.',
  '',
  'THE COLONY MUST SURVIVE.',
];

function drawIntro() {
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  G.introLine += 0.4;
  const shown = Math.min(INTRO_TEXT.length, Math.floor(G.introLine / 6) + 1);
  let y = 30;
  for (let i = 0; i < shown; i++) {
    drawTextC(ctx, INTRO_TEXT[i], VIEW_W / 2, y, i === INTRO_TEXT.length - 1 ? '#ffa040' : '#c8b890');
    y += 11;
  }
  if (shown >= INTRO_TEXT.length && (G.tick >> 4) % 2 === 0) {
    drawTextC(ctx, 'PRESS SPACE', VIEW_W / 2, 182, '#ffe040');
  }
  G.tick++;
}

function updateIntro() {
  if (tookPress('Space') || tookPress('Enter')) {
    G.state = 'play';
    G.msg('GATHER FOOD FOR THE COLONY', '#80ff80');
    Sfx.play('select');
  }
}

const HELP_TEXT = [
  ['PLAYER 1', '#ffe080'],
  ['  W A S D ....... MOVE / CLIMB', '#c8b890'],
  ['  SPACE ......... BITE / DIG', '#c8b890'],
  ['  E ............. PICK UP / USE', '#c8b890'],
  ['PLAYER 2', '#80d0ff'],
  ['  ARROWS ........ MOVE / CLIMB', '#c8b890'],
  ['  . ............. BITE / DIG', '#c8b890'],
  ['  , ............. PICK UP / USE', '#c8b890'],
  ['', ''],
  ['M: MAP   ESC: PAUSE   HOLD UP AT WALLS TO CLIMB', '#a09070'],
  ['BRING FOOD TO THE STORAGE CHAMBER.', '#a8e8a0'],
  ['FEED LARVAE. MILK APHIDS. SLAY SPIDERS.', '#a8e8a0'],
];

function drawHelp() {
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawTextCS(ctx, 'HOW TO ANT', VIEW_W / 2, 12, '#ffa040', 2);
  let y = 40;
  for (const [line, color] of HELP_TEXT) {
    if (line) drawText(ctx, line, 24, y, color);
    y += 11;
  }
  drawTextC(ctx, 'ESC: BACK', VIEW_W / 2, 186, '#706050');
}

function updateHelp() {
  if (tookPress('Escape') || tookPress('Enter') || tookPress('Space')) {
    G.state = G.prevState === 'pause' ? 'pause' : G.prevState;
    Sfx.play('menu');
  }
}

function drawPause() {
  drawPlay();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  bevelPanel(100, 56, 120, 88);
  drawTextCS(ctx, 'PAUSED', VIEW_W / 2, 64, '#ffa040', 2);
  const items = ['RESUME', 'SAVE GAME', 'HELP', 'SAVE + QUIT'];
  for (let i = 0; i < items.length; i++) {
    const sel = i === G.menuSel;
    if (sel) drawText(ctx, '\x06', 110, 88 + i * 12, '#ffe040');
    drawText(ctx, items[i], 122, 88 + i * 12, sel ? '#ffe040' : '#c8b890');
  }
}

function updatePause() {
  if (tookPress('Escape')) { G.state = 'play'; return; }
  if (menuNav(4)) {
    Sfx.play('select');
    switch (G.menuSel) {
      case 0: G.state = 'play'; break;
      case 1:
        if (saveWorld(G.slot)) { G.msg('GAME SAVED', '#80c0ff'); Sfx.play('save'); }
        G.state = 'play';
        break;
      case 2: G.prevState = 'pause'; G.state = 'help'; break;
      case 3:
        saveWorld(G.slot);
        G.running = false;
        G.state = 'title'; G.menuSel = 0;
        break;
    }
  }
}

function drawDead() {
  drawPlay();
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const tk = G.takeover;
  if (!tk) return;
  bevelPanel(70, 30, 180, 140);
  const pcol = tk.pIdx === 0 ? '#ffe080' : '#80d0ff';
  drawTextCS(ctx, (G.playerCount > 1 ? 'PLAYER ' + (tk.pIdx + 1) + ' ' : '') + 'YOU DIED', VIEW_W / 2, 38, '#ff5040', 2);
  drawTextC(ctx, 'THE COLONY LIVES ON.', VIEW_W / 2, 58, '#c8b890');
  drawTextC(ctx, 'CONTINUE AS:', VIEW_W / 2, 70, pcol);
  for (let i = 0; i < tk.list.length; i++) {
    const a = tk.list[i];
    const sel = i === tk.sel;
    const label = a.caste.toUpperCase() + '  HP ' + Math.ceil(a.hp) + '/' + a.maxHp;
    if (sel) drawText(ctx, '\x06', 92, 84 + i * 12, '#ffe040');
    drawText(ctx, label, 104, 84 + i * 12, sel ? '#ffe040' : '#c8b890');
  }
  drawTextC(ctx, 'ENTER: TAKE OVER', VIEW_W / 2, 160, '#a09070');
}

function updateDead() {
  const tk = G.takeover;
  if (!tk) { G.state = 'play'; return; }
  // prune list of any who died while menu open
  tk.list = tk.list.filter(a => a.hp > 0);
  if (tk.list.length === 0) { endWorld(); return; }
  tk.sel = Math.min(tk.sel, tk.list.length - 1);

  if (tookPress('ArrowUp') || tookPress('KeyW')) { tk.sel = (tk.sel + tk.list.length - 1) % tk.list.length; Sfx.play('menu'); }
  if (tookPress('ArrowDown') || tookPress('KeyS')) { tk.sel = (tk.sel + 1) % tk.list.length; Sfx.play('menu'); }
  if (tookPress('Enter') || tookPress('Space')) {
    const a = tk.list[tk.sel];
    a.playerIdx = tk.pIdx;
    a.state = 'idle';
    a.climbing = false;
    G.players[tk.pIdx].ant = a;
    G.players[tk.pIdx].cam = { x: a.x - VIEW_W / 2, y: a.y - 60 };
    G.deadQueue.shift();
    G.takeover = null;
    G.state = 'play';
    G.msg('NOW PLAYING: ' + a.caste.toUpperCase(), tk.pIdx === 0 ? '#ffe080' : '#80d0ff');
    Sfx.play('select');
  }
}

function drawGameOver() {
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const s = G.gameOverStats;
  drawTextCS(ctx, 'THE COLONY', VIEW_W / 2, 24, '#ff5040', 2);
  drawTextCS(ctx, 'HAS PERISHED', VIEW_W / 2, 42, '#ff5040', 2);
  if (s) {
    const lines = [
      ['SURVIVED ' + (s.day + 1) + ' DAYS', '#c8b890'],
      ['FINAL SCORE: ' + s.score, '#ffe040'],
      ['FOOD GATHERED: ' + Math.floor(s.stats.foodGathered), '#a09070'],
      ['TASKS DONE: ' + s.stats.tasksDone, '#a09070'],
      ['ANTS BORN: ' + s.stats.antsBorn, '#a09070'],
      ['ANTS LOST: ' + s.stats.antsDied, '#a09070'],
      ['PREDATORS SLAIN: ' + s.stats.predatorsSlain, '#a09070'],
    ];
    let y = 74;
    for (const [line, color] of lines) { drawTextC(ctx, line, VIEW_W / 2, y, color); y += 12; }
  }
  if ((G.tick >> 4) % 2 === 0) drawTextC(ctx, 'PRESS ENTER', VIEW_W / 2, 178, '#ffe040');
  G.tick++;
}

function updateGameOver() {
  if (tookPress('Enter') || tookPress('Space') || tookPress('Escape')) {
    G.state = 'title'; G.menuSel = 0;
    Sfx.play('select');
  }
}

// ---------------------------------------------------------------------------
// global toggles + loop
// ---------------------------------------------------------------------------
function globalKeys() {
  if (tookPress('KeyC')) document.getElementById('crt').classList.toggle('off');
  if (tookPress('KeyN')) {
    const m = Sfx.toggleMute();
    if (G.state === 'play') G.msg('SOUND ' + (m ? 'OFF' : 'ON'), '#80c0ff');
  }
}

let last = 0, acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!last) last = now;
  acc += Math.min(100, now - last);
  last = now;
  const STEP = 1000 / 60;
  let steps = 0;
  while (acc >= STEP && steps < 4) {
    acc -= STEP;
    steps++;
    globalKeys();
    switch (G.state) {
      case 'title': updateTitle(); break;
      case 'slots': updateSlots(); break;
      case 'intro': updateIntro(); break;
      case 'help': updateHelp(); break;
      case 'play': updatePlay(); break;
      case 'pause': updatePause(); break;
      case 'dead': updateDead(); break;
      case 'gameover': updateGameOver(); break;
    }
    // clear one-shot presses each sim step
    for (const k in pressed) pressed[k] = false;
  }

  switch (G.state) {
    case 'title': drawTitle(); break;
    case 'slots': drawSlots(); break;
    case 'intro': drawIntro(); break;
    case 'help': drawHelp(); break;
    case 'play': drawPlay(); break;
    case 'pause': drawPause(); break;
    case 'dead': drawDead(); break;
    case 'gameover': drawGameOver(); break;
  }
}

// integer-scale the canvas to the window
function fitCanvas() {
  const scale = Math.max(1, Math.min(
    Math.floor(window.innerWidth / VIEW_W),
    Math.floor(window.innerHeight / VIEW_H)));
  const stage = document.getElementById('stage');
  stage.style.width = (VIEW_W * scale) + 'px';
  stage.style.height = (VIEW_H * scale) + 'px';
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

window.addEventListener('beforeunload', () => {
  if (G.running) saveWorld(G.slot);
});

requestAnimationFrame(frame);
