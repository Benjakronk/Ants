// MAUR -- colony simulation: food, brood cycle, tasks, ambient spawning.
'use strict';

const DAY_LEN = 60 * 240; // 4 minutes of frames per day

// chambers: marked cavities whose dug-out area sets the colony's capacity
const CH_TYPES = ['storage', 'nursery', 'barracks', 'royal'];
const CH_R = 32;          // a chamber's area is the air inside this disk
const CH_MIN_AREA = 300;  // smaller is cramped: counts as zero
const CH_ROOM = 4;        // only air within reach of a (2*4+1) px open square
                          // counts: a room, not the tunnels running through it
const CH_NEAR = 40;       // X within this of a marker (in sight) cycles its type
const CH_SPACING = 50;    // new markers keep this far from the others
const CH_DEPTH = 30;      // markers go at least this far below the ground
const CH_RECALC = 480;    // ticks between area recounts

// scratch grids for roomyGrid(): a square around a marker, wide enough for
// the opening to see every pixel of the disk
const ROOM_R = CH_R + 2 * CH_ROOM;
const ROOM_S = 2 * ROOM_R + 1;
const ROOM_A = new Uint8Array(ROOM_S * ROOM_S);
const ROOM_B = new Uint8Array(ROOM_S * ROOM_S);

// is there open air all along the line between two points? (the last few
// pixels at each end are let off: a marker may sit in a settled floor)
function airLine(x0, y0, x1, y1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let k = 3; k <= n - 3; k++) {
    const t = k / n;
    if (T.solid(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

// one sliding-window pass over the grid, along rows (dir 1) or columns
// (dir ROOM_S): dst = at least `need` of src's 2*CH_ROOM+1 window are set
function roomPass(src, dst, dir, need) {
  const S = ROOM_S, H = CH_ROOM, step = dir === 1 ? S : 1;
  for (let l = 0; l < S; l++) {
    const base = l * step;
    let c = 0;
    for (let k = 0; k < H; k++) c += src[base + k * dir];
    for (let k = 0; k < S; k++) {
      if (k + H < S) c += src[base + (k + H) * dir];
      if (k - H - 1 >= 0) c -= src[base + (k - H - 1) * dir];
      dst[base + k * dir] = c >= need ? 1 : 0;
    }
  }
}

// the roomy air around (cx, cy): ROOM_A[(y-cy+ROOM_R)*ROOM_S + x-cx+ROOM_R].
// Erode (every pixel of the window open), then dilate (any pixel set).
function roomyGrid(cx, cy) {
  const S = ROOM_S, R = ROOM_R, A = ROOM_A, B = ROOM_B;
  for (let j = 0; j < S; j++) {
    const wy = cy - R + j;
    for (let i = 0; i < S; i++) {
      const wx = cx - R + i;
      A[j * S + i] = wx >= 0 && wx < WORLD_W && wy >= 0 && wy < WORLD_H &&
        wy >= T.bgSurf[wx] && T.m[wy * WORLD_W + wx] === M_AIR ? 1 : 0;
    }
  }
  const full = 2 * CH_ROOM + 1;
  roomPass(A, B, 1, full); roomPass(B, A, S, full); // erode
  roomPass(A, B, 1, 1); roomPass(B, A, S, 1);       // dilate
  // the opening may only keep pixels that were air to begin with: it can't
  // (dilation stays inside the eroded squares), so A is ready
  return A;
}

class Colony {
  constructor(info) {
    // info: { x, entrance, junction, queenCh, storage, nursery }
    Object.assign(this, info);
    // the generated nest's chambers become the first markers; the NPC
    // anchors above (storage, nursery, queenCh) stay the navigation targets.
    // `anchor` markers keep their type and are never removed.
    this.chambers = [];
    this.nextChamberId = 1;
    this.addChamber('storage', info.storage.x, info.storage.y, true);
    this.addChamber('nursery', info.nursery.x, info.nursery.y, true);
    this.addChamber('royal', info.queenCh.x, info.queenCh.y, false);
    if (!this.chamberNear(info.junction.x, info.junction.y, CH_SPACING)) {
      this.addChamber('barracks', info.junction.x, info.junction.y, false);
    }
    this.caps = null;     // derived from chamber areas by recalcChambers()
    this.fullMsgT = 0;
    this.food = 60;
    this.score = 0;
    this.eggT = 1800;
    this.starveMsgT = 0;
    this.taskT = 0;
    this.tasks = [];
    this.lastDigTaskDay = 0;
    this.lastRaidDay = 0;
    this.stats = {
      foodGathered: 0, tasksDone: 0, antsBorn: 0,
      antsDied: 0, predatorsSlain: 0,
    };
  }

  // ---- chambers and capacity ----------------------------------------------
  addChamber(type, x, y, anchor) {
    const ch = { id: this.nextChamberId++, type, x: Math.round(x), y: Math.round(y), area: 0 };
    if (anchor) ch.anchor = true;
    this.chambers.push(ch);
    return ch;
  }

  // nearest chamber marker within r of (x, y), or null
  chamberNear(x, y, r, type) {
    let best = null, bd = r * r;
    for (const ch of this.chambers) {
      if (type && ch.type !== type) continue;
      const d = dist2(x, y, ch.x, ch.y);
      if (d < bd) { bd = d; best = ch; }
    }
    return best;
  }

  // roomy air pixels in the disk around (x, y), below the original ground.
  // "Roomy" is a morphological opening: air that some open (2*CH_ROOM+1) px
  // square covers, so a tunnel crossing the disk adds nothing while a real
  // hollow counts in full. Where two disks overlap a pixel belongs to the
  // nearer marker only, so packing markers together doesn't count the same
  // hollow twice.
  areaAt(x, y, self) {
    const others = this.chambers.filter(c => c !== self &&
      dist2(x, y, c.x, c.y) < 4 * CH_R * CH_R);
    const R2 = CH_R * CH_R;
    const cx = Math.round(x), cy = Math.round(y);
    const room = roomyGrid(cx, cy);
    const S = ROOM_S, R = ROOM_R;
    let n = 0;
    for (let py = cy - CH_R; py <= cy + CH_R; py++) {
      for (let px = cx - CH_R; px <= cx + CH_R; px++) {
        const d = dist2(px, py, x, y);
        if (d > R2 || !room[(py - cy + R) * S + (px - cx + R)]) continue;
        let mine = true;
        for (const o of others) if (dist2(px, py, o.x, o.y) < d) { mine = false; break; }
        if (mine) n++;
      }
    }
    return n;
  }

  // recount every chamber and derive the colony's capacities from them.
  // A chamber only counts the room the colony has claimed (`claimed`: its
  // roomy area when marked, plus what players dug out inside it since), so
  // the NPCs' path-digging doesn't hollow out capacity on its own.
  // Tuned so a generated nest (storage ~1050, nursery ~950, junction
  // barracks ~350-650, royal ~1400 px) gives food ~125, brood 5, population
  // ~17-20: a fresh colony soon fills it, and grows by digging and marking.
  recalcChambers() {
    const sum = { storage: 0, nursery: 0, barracks: 0, royal: 0 };
    for (const ch of this.chambers) {
      const room = this.areaAt(ch.x, ch.y, ch);
      if (!(ch.claimed >= 0)) ch.claimed = room;
      ch.area = Math.min(room, ch.claimed);
      if (ch.area >= CH_MIN_AREA) sum[ch.type] += ch.area;
    }
    this.caps = {
      // never below what the queen needs to keep laying (eggs need 30)
      food: Math.max(40, Math.round(20 + sum.storage * 0.1)),
      brood: 1 + Math.floor(sum.nursery / 200),
      pop: Math.max(10, Math.floor((sum.nursery + sum.barracks) / 75)),
      // ticks between eggs: a roomier royal chamber, a busier queen
      eggT: Math.round(2700 * Math.max(0.5, Math.min(2.5, 1550 / Math.max(1, sum.royal)))),
      soldiers: 0.1 + Math.min(0.3, sum.barracks / 10000),  // soldier share
    };
  }

  // a player dug n pixels of natural ground at (x, y): inside a chamber's
  // disk that's new room claimed for it. Returns true if it counted.
  claimDug(x, y, n) {
    const ch = this.chamberNear(x, y, CH_R);
    if (!ch || n <= 0) return false;
    ch.claimed = (ch.claimed || 0) + n;
    return true;
  }

  // the marker the mark key acts on for an ant at (x, y): the nearest one
  // within CH_NEAR that the ant can see through open air (a marker behind
  // solid earth belongs to another cavity)
  markTarget(x, y) {
    let best = null, bd = CH_NEAR * CH_NEAR;
    for (const ch of this.chambers) {
      const d = dist2(x, y, ch.x, ch.y);
      if (d < bd && airLine(x, y, ch.x, ch.y)) { bd = d; best = ch; }
    }
    return best;
  }

  // player pIdx pressed the mark key with ant `a`: cycle the chamber marker
  // in sight, or found a new storage chamber in this cavity
  markChamber(a, pIdx) {
    const refuse = key => {
      G.msg(key, [], '#ff8040', pIdx);
      G.sfx('clank', a.x, a.y);
    };
    const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, a.x)));
    if (a.y < T.bgSurf[sx] + CH_DEPTH) { refuse('m_markDeep'); return; }
    const ch = this.markTarget(a.x, a.y);
    if (ch) {
      // the generated nest's storage and nursery are where the NPCs haul
      // food and brood: their types stay put
      if (ch.anchor) {
        G.msg('m_chamberFixed', [{ key: 'ch_' + ch.type }], '#ff8040', pIdx);
        G.sfx('clank', a.x, a.y);
        return;
      }
      if (ch.type === 'royal' && this.chambers.filter(c => c.type === 'royal').length <= 1) {
        refuse('m_lastRoyal');
        return;
      }
      const i = CH_TYPES.indexOf(ch.type);
      if (i === CH_TYPES.length - 1) {
        this.chambers = this.chambers.filter(c => c !== ch);
        G.msg('m_chamberGone', [], '#e0c080', pIdx);
      } else {
        ch.type = CH_TYPES[i + 1];
        G.msg('m_chamberType', [{ key: 'ch_' + ch.type }], '#e0c080', pIdx);
      }
      G.sfx('mark', a.x, a.y);
      this.recalcChambers();
      return;
    }
    if (this.chamberNear(a.x, a.y, CH_SPACING)) { refuse('m_markClose'); return; }
    const area = this.areaAt(a.x, a.y, null);
    if (area < CH_MIN_AREA) { refuse('m_markCramped'); return; }
    // (no dig-task credit: claiming a hollow isn't digging one)
    this.addChamber('storage', a.x, a.y, false);
    this.recalcChambers();
    G.msg('m_chamberNew', [{ key: 'ch_storage' }], '#80ff80', pIdx);
    G.sfx('mark', a.x, a.y);
    G.fx('sparkle', a.x, a.y - 6, 5);
  }

  // stores at capacity? Excess food is kept, but deposits are refused
  storageFull() { return this.food >= this.caps.food; }

  // returns false when the stores are full (the item stays carried).
  // A deposit only fills the stores up to the cap: the rest spills.
  deposit(item, who) {
    if (item.kind !== 'crystal' && this.storageFull()) {
      if (who && who.playerIdx >= 0) {
        G.msg('m_storageFull', [], '#ff8040', who.playerIdx);
        G.sfx('drop', who.x, who.y);
      } else if (this.fullMsgT <= 0 && G.nearPlayer(this.storage.x, this.storage.y) < 400) {
        G.msg('m_storageFullNpc', [], '#ff8040');
        this.fullMsgT = 3600;
      }
      return false;
    }
    if (item.kind === 'crystal') {
      // treasure, not food: the colony hoards it for pure score
      this.score += 80;
      this.progress('crystal', 1);
      G.msg('m_crystal', [80], '#80e0ff');
      G.sfx('task');
    } else {
      const v = Math.min(Number(item.value) || 0, this.caps.food - this.food);
      this.food += v;
      this.stats.foodGathered += v;
      if (who && who.playerIdx >= 0) {
        this.progress('gather', 1);
        G.msg('m_foodStored', [Math.round(v)], null, who.playerIdx);
      }
    }
    item.dead = true;
    if (who) who.carry = null;
    const at = who || this.storage;
    G.fx('sparkle', at.x, at.y - 6, 5);
    G.sfx('deposit', at.x, at.y, 280);
    return true;
  }

  spawnAdult(x, y) {
    const ants = G.ants.filter(a => a.hp > 0);
    const soldiers = ants.filter(a => a.caste === 'soldier').length;
    const nurses = ants.filter(a => a.caste === 'nurse').length;
    let caste = 'worker';
    // barracks space raises the colony's appetite for soldiers
    if (soldiers < ants.length * this.caps.soldiers && Math.random() < 0.4) caste = 'soldier';
    else if (nurses < ants.length * 0.15 && Math.random() < 0.35) caste = 'nurse';
    const a = new Ant(x, y, caste);
    G.ants.push(a);
    this.stats.antsBorn++;
    G.msg('m_emerged', [{ caste }]);
    G.sfx('hatch', x, y, 300);
  }

  update() {
    if (!isFinite(this.food)) { console.error('colony.food was NaN'); this.food = 0; }
    const pop = G.ants.filter(a => a.hp > 0).length;
    if (this.fullMsgT > 0) this.fullMsgT--;

    // digging (and building) reshapes the chambers: recount now and then
    if (!this.caps || G.tick % CH_RECALC === 0) this.recalcChambers();

    // digging erodes the nest: keep the colony's mental map (chamber anchors,
    // tunnel waypoints) settled on the floors that actually exist now
    if (G.tick % 600 === 0) {
      for (const key of ['entrance', 'junction', 'queenCh', 'storage', 'nursery']) {
        const p = this[key];
        let n = 0;
        while (n++ < 30 && p.y + 4 < WORLD_H && !T.boxSolid(p.x, p.y + 3, 2, 1)) p.y++;
      }
      for (const k in this.paths) settlePath(T.m, this.paths[k]);
    }

    // everyone eats
    this.food = Math.max(0, this.food - pop * 0.00006);

    // starvation
    if (this.food <= 0 && pop > 0) {
      for (const a of G.ants) if (a.hp > 0) a.hp -= 0.006;
      if (this.starveMsgT <= 0) {
        G.msg('m_starving', [], '#ff6040');
        G.sfx('starve');
        this.starveMsgT = 1800;
      }
    }
    if (this.starveMsgT > 0) this.starveMsgT--;

    // the queen lays
    const queen = G.ants.find(a => a.caste === 'queen' && a.hp > 0);
    if (queen) {
      this.eggT--;
      const broodCount = G.brood.filter(b => !b.dead).length;
      const caps = this.caps;
      if (this.eggT <= 0 && this.food >= 30 && broodCount < caps.brood && pop + broodCount < caps.pop) {
        this.food -= 10;
        const e = new Brood(queen.x + (Math.random() - 0.5) * 14, queen.y - 4, 'egg');
        G.brood.push(e);
        this.eggT = caps.eggT;
        G.msg('m_eggLaid');
        G.sfx('lay', queen.x, queen.y, 300);
      }
      if (this.eggT <= 0) this.eggT = 600; // re-check soon
    }

    // tasks
    this.taskT--;
    if (this.taskT <= 0) {
      this.taskT = 180;
      this.generateTasks();
    }
    this.checkTasks();
    for (const t of this.tasks) if (t.done && t.doneT > 0) t.doneT--;
    this.tasks = this.tasks.filter(t => !t.done || t.doneT > 0);

    this.ambientSpawns();
  }

  // ---- tasks ---------------------------------------------------------------
  active(type) { return this.tasks.find(t => t.type === type && !t.done); }

  generateTasks() {
    const tasks = this.tasks;
    if (tasks.filter(t => !t.done).length >= 3) return;

    if (this.food < 25 && !this.active('gather')) {
      tasks.push({ type: 'gather', n: 0, need: 5, reward: 50 });
      G.msg('m_newTask', [{ key: 't_gather' }], '#80ff80');
    }
    const hungry = G.brood.filter(b => b.kind === 'larva' && b.hungry && !b.dead).length;
    if (hungry > 0 && !this.active('feed')) {
      tasks.push({ type: 'feed', n: 0, need: Math.min(2, hungry), reward: 40 });
      G.msg('m_newTask', [{ key: 't_feed' }], '#80ff80');
    }
    const pred = G.bugs.find(b => b.predator && !b.dead &&
      Math.abs(b.x - this.x) < 400);
    if (pred && !this.active('hunt')) {
      tasks.push({
        type: 'hunt', kind: pred.kind,
        targetId: pred.id, n: 0, need: 1, reward: 100
      });
      G.msg('m_defend', [], '#ff8040');
      G.sfx('danger');
    }
    if (G.day > this.lastDigTaskDay && G.day >= 1 && !this.active('dig')) {
      this.lastDigTaskDay = G.day;
      tasks.push({ type: 'dig', n: 0, need: 600, reward: 60 });
      G.msg('m_newTask', [{ key: 't_dig' }], '#80ff80');
    }
    // a prospecting expedition: dig deep below the nest for a crystal
    if (G.day >= 1 && G.day > (this.lastCrystalTaskDay || 0) + 1 &&
        !this.active('crystal') && Math.random() < 0.35) {
      this.lastCrystalTaskDay = G.day;
      tasks.push({ type: 'crystal', n: 0, need: 1, reward: 150 });
      G.msg('m_newTask', [{ key: 't_crystal' }], '#80e0ff');
    }
  }

  progress(type, n) {
    const t = this.active(type);
    if (!t) return;
    t.n += n;
    if (t.n >= t.need) this.complete(t);
  }

  complete(t) {
    t.done = true;
    t.doneT = 240;
    this.score += t.reward;
    this.stats.tasksDone++;
    G.msg('m_taskDone', [t.reward], '#ffe040');
    G.sfx('task');
  }

  checkTasks() {
    const hunt = this.active('hunt');
    if (hunt) {
      const target = G.bugs.find(b => b.id === hunt.targetId);
      if (!target || target.dead) {
        if (target && target.dead && target.killedByPlayer) this.complete(hunt);
        else if (!target || target.dead) this.complete(hunt); // soldiers count too
        else this.tasks = this.tasks.filter(x => x !== hunt);
      } else if (target.fleeing && Math.abs(target.x - this.x) > 600) {
        this.complete(hunt); // driven off
      }
    }
  }

  // ---- ambient world spawning ------------------------------------------------
  ambientSpawns() {
    const items = G.items.filter(i => !i.dead && !i.carried);
    const bugs = G.bugs.filter(b => !b.dead);
    const rnd = Math.random();

    // seeds drift down from the canopy, or ripen in the grass.
    // scarce times bring a better harvest (and keep the sim survivable)
    const foodItems = items.filter(i => ITEM_DEF[i.kind] && ITEM_DEF[i.kind].food).length;
    const seedChance = foodItems < 8 ? 0.014 : 0.005;
    if (items.filter(i => i.kind === 'seed').length < 16 && rnd < seedChance) {
      const trees = G.trees;
      if (trees.length && Math.random() < 0.5) {
        // seeds fall from the canopy and land on the forest floor below
        const t = trees[Math.floor(Math.random() * trees.length)];
        const side = Math.random() < 0.5 ? -1 : 1;
        const sx = Math.max(20, Math.min(WORLD_W - 20,
          Math.round(t.x + side * (30 + Math.random() * 60))));
        G.items.push(G.makeItem('seed', sx, T.surf[sx] - 8));
      } else {
        const x = 40 + Math.random() * (WORLD_W - 80);
        G.items.push(G.makeItem('seed', x, T.surf[Math.floor(x)] - 8));
      }
    }
    // leaf scraps on the floor
    if (items.filter(i => i.kind === 'leaf').length < 8 && rnd > 0.998) {
      const x = 40 + Math.random() * (WORLD_W - 80);
      G.items.push(G.makeItem('leaf', x, T.surf[Math.floor(x)] - 6));
    }

    const count = k => bugs.filter(b => b.kind === k).length;

    // the rival nest slowly regarrisons after the player thins its defenders
    if (G.rival) {
      const defenders = bugs.filter(b => b.kind === 'redant' && b.resident).length;
      if (defenders < 4 && Math.random() < 0.0015) {
        const rx = Math.max(20, Math.min(WORLD_W - 20,
          G.rival.entrance.x + (Math.random() - 0.5) * 90));
        const def = new Bug(rx, T.surf[Math.floor(rx)] - 8, 'redant');
        def.resident = true; def.homeX = G.rival.entrance.x;
        G.bugs.push(def);
      }
    }

    if (count('pillbug') < 4 && Math.random() < 0.0011) {
      const x = Math.random() < 0.5 ? 30 + Math.random() * 200 : WORLD_W - 30 - Math.random() * 200;
      G.bugs.push(new Bug(x, T.surf[Math.floor(x)] - 6, 'pillbug'));
    }
    if (count('aphid') < 8 && Math.random() < 0.0008 && G.trees.length) {
      // aphid herds graze the lower trunk, within an ant's easy climb
      const t = G.trees[Math.floor(Math.random() * G.trees.length)];
      const side = Math.random() < 0.5 ? -1 : 1;
      G.bugs.push(new Bug(t.x + side * (4 + Math.random() * 3),
        T.surf[t.x] - 10 - Math.random() * 40, 'aphid'));
    }
    if (count('worm') < 6 && Math.random() < 0.0009) {
      const x = 60 + Math.random() * (WORLD_W - 120);
      G.bugs.push(new Bug(x, T.surf[Math.floor(x)] + 150 + Math.random() * 700, 'worm'));
    }

    // predators: not on day 0, escalating with the days, likelier at night
    const night = G.isNight();
    const day = G.day;
    const spiderCap = Math.min(3, 1 + Math.floor(day / 3));
    if (count('spider') < spiderCap && day >= 1 && Math.random() < (night ? 0.0014 : 0.00025)) {
      const x = Math.random() < 0.5 ? 25 : WORLD_W - 25;
      G.bugs.push(new Bug(x, T.surf[Math.floor(x)] - 8, 'spider'));
      G.msg('m_spider', [], '#ff8040');
      G.sfx('danger');
    }
    const centiCap = Math.min(2, 1 + Math.floor(day / 4));
    if (count('centipede') < centiCap && day >= 2 && Math.random() < 0.0004) {
      const x = 100 + Math.random() * (WORLD_W - 200);
      G.bugs.push(new Bug(x, T.surf[Math.floor(x)] + 300 + Math.random() * 400, 'centipede'));
      G.msg('m_centi', [], '#ff8040');
      G.sfx('danger');
    }
    // wasps hunt by day
    const waspCap = Math.min(3, 1 + Math.floor(day / 3));
    if (count('wasp') < waspCap && day >= 1 && !night && Math.random() < 0.0005) {
      const x = Math.random() < 0.5 ? 60 : WORLD_W - 60;
      G.bugs.push(new Bug(x, T.surf[Math.floor(x)] - 80, 'wasp'));
      G.msg('m_wasp', [], '#ff8040');
      G.sfx('danger');
    }
    // a rare armored heavyweight, once the colony is established
    if (count('beetle') < 1 && day >= 3 && Math.random() < 0.00018) {
      const x = Math.random() < 0.5 ? 30 : WORLD_W - 30;
      G.bugs.push(new Bug(x, T.surf[Math.floor(x)] - 8, 'beetle'));
      G.msg('m_beetle', [], '#ff8040');
      G.sfx('danger');
    }
    // rival-colony raids: at most one per day, growing bolder over time.
    // The raiders advance from the direction of the rival nest, emerging from
    // the undergrowth a few screens out (a full crossing would be too slow).
    if (day >= 2 && day > this.lastRaidDay && Math.random() < 0.0001) {
      this.lastRaidDay = day;
      const side = G.rival ? (Math.sign(G.rival.x - this.x) || 1)
                           : (Math.random() < 0.5 ? -1 : 1);
      const baseX = Math.max(30, Math.min(WORLD_W - 30,
        this.x + side * (350 + Math.random() * 200)));
      const n = 3 + Math.min(3, Math.floor(day / 2));
      for (let i = 0; i < n; i++) {
        const x = Math.max(20, Math.min(WORLD_W - 20, baseX + (Math.random() - 0.5) * 40));
        G.bugs.push(new Bug(x, T.surf[Math.floor(x)] - 8, 'redant'));
      }
      G.msg('m_raid', [], '#ff5040');
      G.sfx('danger');
    }
  }
}
