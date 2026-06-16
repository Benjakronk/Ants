// MAUR -- colony simulation: food, brood cycle, tasks, ambient spawning.
'use strict';

const DAY_LEN = 60 * 240; // 4 minutes of frames per day
const POP_CAP = 30;

class Colony {
  constructor(info) {
    // info: { x, entrance, junction, queenCh, storage, nursery }
    Object.assign(this, info);
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

  deposit(item, who) {
    const v = Number(item.value) || 0;
    this.food += v;
    this.stats.foodGathered += v;
    item.dead = true;
    if (who) who.carry = null;
    G.particles.sparkle(this.storage.x, this.storage.y - 6, 5);
    if (G.nearPlayer(this.storage.x, this.storage.y) < 280) Sfx.play('deposit');
    if (who && who.playerIdx >= 0) {
      this.progress('gather', 1);
      G.msg('+' + item.value + ' FOOD STORED');
    }
  }

  spawnAdult(x, y) {
    const ants = G.ants.filter(a => a.hp > 0);
    const soldiers = ants.filter(a => a.caste === 'soldier').length;
    const nurses = ants.filter(a => a.caste === 'nurse').length;
    let caste = 'worker';
    if (soldiers < ants.length * 0.2 && Math.random() < 0.4) caste = 'soldier';
    else if (nurses < ants.length * 0.15 && Math.random() < 0.35) caste = 'nurse';
    const a = new Ant(x, y, caste);
    G.ants.push(a);
    this.stats.antsBorn++;
    G.msg('A NEW ' + caste.toUpperCase() + ' HAS EMERGED!');
    if (G.nearPlayer(x, y) < 300) Sfx.play('hatch');
  }

  update() {
    if (!isFinite(this.food)) { console.error('colony.food was NaN'); this.food = 0; }
    const pop = G.ants.filter(a => a.hp > 0).length;

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
        G.msg('THE COLONY IS STARVING!', '#ff6040');
        Sfx.play('starve');
        this.starveMsgT = 1800;
      }
    }
    if (this.starveMsgT > 0) this.starveMsgT--;

    // the queen lays
    const queen = G.ants.find(a => a.caste === 'queen' && a.hp > 0);
    if (queen) {
      this.eggT--;
      const broodCount = G.brood.filter(b => !b.dead).length;
      if (this.eggT <= 0 && this.food >= 30 && broodCount < 6 && pop + broodCount < POP_CAP) {
        this.food -= 10;
        const e = new Brood(queen.x + (Math.random() - 0.5) * 14, queen.y - 4, 'egg');
        G.brood.push(e);
        this.eggT = 2700;
        G.msg('THE QUEEN HAS LAID AN EGG');
        if (G.nearPlayer(queen.x, queen.y) < 300) Sfx.play('lay');
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
      tasks.push({ type: 'gather', text: 'GATHER FOOD', n: 0, need: 5, reward: 50 });
      G.msg('NEW TASK: GATHER FOOD', '#80ff80');
    }
    const hungry = G.brood.filter(b => b.kind === 'larva' && b.hungry && !b.dead).length;
    if (hungry > 0 && !this.active('feed')) {
      tasks.push({ type: 'feed', text: 'FEED THE LARVAE', n: 0, need: Math.min(2, hungry), reward: 40 });
      G.msg('NEW TASK: FEED THE LARVAE', '#80ff80');
    }
    const pred = G.bugs.find(b => b.predator && !b.dead &&
      Math.abs(b.x - this.x) < 400);
    if (pred && !this.active('hunt')) {
      tasks.push({
        type: 'hunt', text: 'DRIVE OFF THE ' + pred.kind.toUpperCase(),
        targetId: pred.id, n: 0, need: 1, reward: 100
      });
      G.msg('NEW TASK: DEFEND THE COLONY!', '#ff8040');
      Sfx.play('danger');
    }
    if (G.day > this.lastDigTaskDay && G.day >= 1 && !this.active('dig')) {
      this.lastDigTaskDay = G.day;
      tasks.push({ type: 'dig', text: 'EXPAND THE NEST', n: 0, need: 600, reward: 60 });
      G.msg('NEW TASK: EXPAND THE NEST', '#80ff80');
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
    G.msg('TASK COMPLETE! +' + t.reward, '#ffe040');
    Sfx.play('task');
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
      G.msg('A SPIDER PROWLS THE FOREST FLOOR!', '#ff8040');
      Sfx.play('danger');
    }
    const centiCap = Math.min(2, 1 + Math.floor(day / 4));
    if (count('centipede') < centiCap && day >= 2 && Math.random() < 0.0004) {
      const x = 100 + Math.random() * (WORLD_W - 200);
      G.bugs.push(new Bug(x, T.surf[Math.floor(x)] + 300 + Math.random() * 400, 'centipede'));
      G.msg('SOMETHING SLITHERS IN THE DEEP...', '#ff8040');
      Sfx.play('danger');
    }
    // wasps hunt by day
    const waspCap = Math.min(3, 1 + Math.floor(day / 3));
    if (count('wasp') < waspCap && day >= 1 && !night && Math.random() < 0.0005) {
      const x = Math.random() < 0.5 ? 60 : WORLD_W - 60;
      G.bugs.push(new Bug(x, T.surf[Math.floor(x)] - 80, 'wasp'));
      G.msg('AN ANGRY BUZZ ON THE WIND...', '#ff8040');
      Sfx.play('danger');
    }
    // a rare armored heavyweight, once the colony is established
    if (count('beetle') < 1 && day >= 3 && Math.random() < 0.00018) {
      const x = Math.random() < 0.5 ? 30 : WORLD_W - 30;
      G.bugs.push(new Bug(x, T.surf[Math.floor(x)] - 8, 'beetle'));
      G.msg('SOMETHING HEAVY TRUNDLES CLOSER...', '#ff8040');
      Sfx.play('danger');
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
      G.msg('RIVAL ANTS ARE RAIDING THE COLONY!', '#ff5040');
      Sfx.play('danger');
    }
  }
}
