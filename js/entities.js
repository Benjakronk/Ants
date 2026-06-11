// MAUR -- entities: ants, brood, bugs, items. Physics + AI + pixel sprites.
'use strict';

let ENT_ID = 1;

const CASTE = {
  worker:  { hp: 30,  dmg: 5,  speed: 0.55, size: 1.0,  color: [168, 76, 42],  digR: 4.5, digCd: 13 },
  soldier: { hp: 55,  dmg: 9,  speed: 0.50, size: 1.35, color: [120, 46, 24],  digR: 5.2, digCd: 11 },
  nurse:   { hp: 26,  dmg: 4,  speed: 0.55, size: 0.95, color: [196, 110, 64], digR: 4.2, digCd: 15 },
  queen:   { hp: 120, dmg: 12, speed: 0.30, size: 1.9,  color: [142, 42, 54],  digR: 6.5, digCd: 11 },
};

const ITEM_DEF = {
  seed:     { value: 5,  food: true },
  honeydew: { value: 8,  food: true },
  leaf:     { value: 2,  food: true },
  corpse:   { value: 4,  food: true },
  bigcorpse:{ value: 15, food: true },
  morsel:   { value: 2,  food: true },
};

// ---------------------------------------------------------------------------
// shared physics
// ---------------------------------------------------------------------------
const GRAV = 0.13, MAXFALL = 3.0;

function physStep(e) {
  // horizontal
  e.blocked = false;
  if (e.vx !== 0) {
    const nx = e.x + e.vx;
    if (!T.boxSolid(nx, e.y, e.hw, e.hh)) {
      e.x = nx;
    } else {
      let ok = false;
      for (let s = 1; s <= 3; s++) {           // step up small ledges
        if (!T.boxSolid(nx, e.y - s, e.hw, e.hh)) { e.x = nx; e.y -= s; ok = true; break; }
      }
      e.blocked = !ok;
    }
  }
  // vertical
  if (e.climbing) {
    e.vy = e.climbV;
  } else {
    e.vy = Math.min(e.vy + GRAV, MAXFALL);
  }
  if (e.vy !== 0) {
    // climbers hug the wall and squeeze past small lips: narrower vertical box
    const vhw = e.climbing ? Math.max(1, e.hw - 1.5) : e.hw;
    const ny = e.y + e.vy;
    if (!T.boxSolid(e.x, ny, vhw, e.hh)) {
      e.y = ny;
    } else {
      // settle pixel by pixel toward the obstacle
      const sd = Math.sign(e.vy);
      let moved = 0;
      while (moved < Math.abs(e.vy) && !T.boxSolid(e.x, e.y + sd, vhw, e.hh)) { e.y += sd; moved++; }
      if (e.climbing) e.vBlocked = true;
      e.vy = 0;
    }
  }
  e.onGround = T.boxSolid(e.x, e.y + 1, e.hw, e.hh);
  // world clamp
  e.x = Math.max(8, Math.min(WORLD_W - 8, e.x));
  e.y = Math.max(4, Math.min(WORLD_H - 14, e.y));
}

// is there a wall right beside the body in direction dir?
function sideWall(e, dir) {
  const x = Math.round(e.x + dir * (e.hw + 1.5));
  for (let y = Math.floor(e.y - e.hh); y <= Math.ceil(e.y + e.hh); y++) {
    if (T.solid(x, y)) return true;
  }
  return false;
}

// like sideWall, but reaches a few pixels further (grabbing across a wide shaft)
function wallNear(e, dir, reach) {
  for (let d = 1; d <= reach; d++) {
    const x = Math.round(e.x + dir * (e.hw + d));
    for (let y = Math.floor(e.y - e.hh); y <= Math.ceil(e.y + e.hh); y++) {
      if (T.solid(x, y)) return true;
    }
  }
  return false;
}

function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

// ---------------------------------------------------------------------------
// Ant
// ---------------------------------------------------------------------------
class Ant {
  constructor(x, y, caste) {
    this.id = ENT_ID++;
    this.kind = 'ant';
    this.caste = caste;
    const c = CASTE[caste];
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.hw = 3 * c.size; this.hh = 2 * c.size;
    this.hp = c.hp; this.maxHp = c.hp;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.phase = Math.random() * 10;
    this.carry = null;
    this.playerIdx = -1;
    this.state = 'idle';
    this.stateT = 60 + Math.random() * 180;
    this.target = null;
    this.biteCd = 0;
    this.digCd = 0;
    this.blockedT = 0;
    this.climbing = false;
    this.climbV = 0;
    this.biteAnim = 0;
    this.flash = 0;
    this.starving = false;
    this.patrolI = 0;
  }

  get def() { return CASTE[this.caste]; }

  hurt(dmg, kx, ky) {
    this.hp -= dmg;
    this.flash = 6;
    this.vx += kx || 0; this.vy += (ky || 0) - 0.5;
    G.particles.blood(this.x, this.y, 4);
    if (G.nearPlayer(this.x, this.y) < 220) Sfx.play('hurt');
    if (this.playerIdx < 0 && this.caste !== 'soldier' && this.caste !== 'queen') {
      this.state = 'flee'; this.stateT = 120;
    }
  }

  update() {
    if (this.flash > 0) this.flash--;
    if (this.biteCd > 0) this.biteCd--;
    if (this.digCd > 0) this.digCd--;
    if (this.biteAnim > 0) this.biteAnim--;
    this.phase += Math.abs(this.vx) * 0.6 + (this.climbing ? 0.4 : 0);

    // buried (squeezed through a pinch, loose soil): chew yourself free
    if (this.digCd <= 0 && T.boxSolid(this.x, this.y, this.hw, this.hh)) {
      T.dig(this.x, this.y, Math.max(this.hw, this.hh) + 2.5);
      this.digCd = this.def.digCd;
      this.biteAnim = 6;
      G.particles.dirt(this.x, this.y, 2);
    }

    if (this.playerIdx >= 0) {
      // player-controlled: input applied by main.js before this call
      physStep(this);
      return;
    }
    this.npcThink();
    physStep(this);
    // climbing ant that lost its wall: boost over the ledge
    if (this.climbing && this.climbV < 0 &&
        !wallNear(this, this.dir, 4) && !wallNear(this, -this.dir, 4)) {
      this.climbing = false;
      this.vy = -1.3; this.vx = this.dir * 0.7;
    }
  }

  // walk/climb/dig toward a point. The heart of NPC navigation: no pathfinding,
  // just stubbornness -- which is also how ants get organic-looking tunnels.
  goto(tx, ty, canDig) {
    const c = this.def;
    const dx = tx - this.x, dy = ty - this.y;
    this.climbing = false;

    if (Math.abs(dx) > 3) {
      this.vx = Math.sign(dx) * c.speed;
      this.dir = Math.sign(dx);
    } else if (Math.abs(dy) > 4) {
      // center exactly over/under the target so we can drop into holes
      this.vx = Math.max(-c.speed, Math.min(c.speed, dx * 0.5));
      if (this.vx !== 0) this.dir = this.vx > 0 ? 1 : -1;
    } else {
      this.vx = 0;
    }

    const wall = sideWall(this, this.dir);

    // climbing into a ceiling counts as stuck
    if (this.vBlocked) { this.blockedT += 2; this.vBlocked = false; }

    // need to go up
    if (dy < -4) {
      let wallDir = 0;
      if (wall) wallDir = this.dir;
      else if (sideWall(this, -this.dir)) wallDir = -this.dir;
      else if (wallNear(this, 1, 6)) wallDir = 1;
      else if (wallNear(this, -1, 6)) wallDir = -1;
      if (wallDir) {
        this.climbing = true; this.climbV = -c.speed * 1.1;
        this.dir = wallDir;
        if (Math.abs(dx) <= 3) this.vx = wallDir * c.speed * 0.5; // hug the wall
      } else if (this.onGround) {
        this.vy = -1.6; // hop
        this.blockedT++;  // hopping in place counts as stuck
      }
    }
    // need to go down and roughly above target: let gravity work, or dig
    if (this.blocked || (dy > 4 && Math.abs(dx) < 8 && this.onGround)) {
      this.blockedT++;
    } else if (!this.blocked) {
      this.blockedT = Math.max(0, this.blockedT - 1);
    }

    // stuck: chew through. Raycast toward the target for the first diggable spot.
    if (canDig && this.blockedT > 30 && this.digCd <= 0) {
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      let hit = null;
      for (let t = this.hw + 2; t <= this.hw + 15 && !hit; t += 3) {
        const bx = this.x + ux * t, by = this.y + uy * t;
        if (T.digHasTarget(bx, by, c.digR)) hit = { bx, by };
      }
      if (hit) {
        T.dig(hit.bx, hit.by, c.digR);
        T.dig(this.x + ux * 2, this.y + uy * 2, c.digR * 0.8); // clear around the body too
        G.particles.dirt(hit.bx, hit.by, 3);
        if (G.nearPlayer(hit.bx, hit.by) < 200) Sfx.play('dig');
        this.digCd = c.digCd + 6;
        this.biteAnim = 6;
        this.blockedT = 12;
      } else if (dy < 4 && (wallNear(this, this.dir, 4) || wallNear(this, -this.dir, 4))) {
        // nothing to chew: climb over the obstacle instead
        if (!wallNear(this, this.dir, 4)) this.dir = -this.dir;
        this.climbing = true; this.climbV = -c.speed * 1.1;
        this.vx = this.dir * c.speed * 0.5;
      } else if (this.blockedT > 120) {
        // truly stuck against rock or open air: wander off
        this.blockedT = 0;
        this.target = { x: this.x + (Math.random() - 0.5) * 200, y: this.y };
      }
    }

    // last resort: no progress for ~4s means some pixel geometry has us beat.
    // Squeeze bodily through the soil toward the target, Liero physics be damned.
    const dNow = Math.hypot(dx, dy);
    if (!this.lastGoto || Math.abs(this.lastGoto.x - tx) > 6 || Math.abs(this.lastGoto.y - ty) > 6) {
      this.lastGoto = { x: tx, y: ty };
      this.gotoBest = 1e9; this.noProgT = 0;
    }
    if (dNow < this.gotoBest - 0.5) { this.gotoBest = dNow; this.noProgT = 0; }
    else this.noProgT++;
    if (canDig && this.noProgT > 240) {
      const ux = dx / (dNow || 1), uy = dy / (dNow || 1);
      T.dig(this.x + ux * 3, this.y + uy * 3, Math.max(this.hw, this.hh) + 1);
      this.x += ux * 2; this.y += uy * 2;
      this.vy = 0; // grip the soil: no falling back between squeezes
      this.noProgT = 235;
      this.biteAnim = 6;
      G.particles.dirt(this.x, this.y, 2);
      if (G.nearPlayer(this.x, this.y) < 200) Sfx.play('dig');
    }
    return dNow;
  }

  // --- nest navigation: follow the remembered tunnel centerlines ------------
  navDest(key) {
    const col = G.colony;
    return key === 'entrance' ? col.entrance
      : key === 'storage' ? col.storage
      : key === 'nursery' ? col.nursery
      : key === 'queen' ? col.queenCh
      : col.junction;
  }

  planNav(key) {
    const P = G.colony.paths;
    const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, this.x)));
    const onSurface = this.y < T.surf[sx] + 12;
    let srcKey = 'entrance', srcIdx = P.entrance.length - 1, best = Infinity;
    if (!onSurface) {
      for (const k in P) {
        const pts = P[k];
        for (let i = 0; i < pts.length; i++) {
          const d = dist2(this.x, this.y, pts[i].x, pts[i].y);
          if (d < best) { best = d; srcKey = k; srcIdx = i; }
        }
      }
    }
    const destPath = P[key] || [];
    let pts;
    if (srcKey === key) pts = destPath.slice(srcIdx);
    else pts = P[srcKey].slice(0, srcIdx + 1).reverse().concat(destPath);
    this.nav = { key, pts, i: 0, t: 0, best: Infinity };
  }

  navTo(key) {
    const dest = this.navDest(key);
    const dd = Math.hypot(dest.x - this.x, dest.y - this.y);
    if (dd < 24) { this.nav = null; this.navBest = 1e9; this.goto(dest.x, dest.y - 3, true); return dd; }
    if (!this.nav || this.nav.key !== key) this.planNav(key);

    // journey watchdog: if the whole trip stalls (waypoint ping-pong, bad
    // geometry), squeeze through the soil along the waypoint chain
    if (this.navBestKey !== key) { this.navBestKey = key; this.navBest = dd; this.navStuck = 0; }
    if (dd < this.navBest - 1) { this.navBest = dd; this.navStuck = 0; }
    else this.navStuck = (this.navStuck || 0) + 1;
    if (this.navStuck > 480) {
      const wp = (this.nav && this.nav.pts[this.nav.i]) || dest;
      const len = Math.hypot(wp.x - this.x, wp.y - this.y) || 1;
      const ux = (wp.x - this.x) / len, uy = (wp.y - this.y) / len;
      T.dig(this.x + ux * 3, this.y + uy * 3, Math.max(this.hw, this.hh) + 1);
      this.x += ux * 2; this.y += uy * 2;
      this.vy = 0; // grip the soil
      this.navStuck = 475;
      this.biteAnim = 6;
      G.particles.dirt(this.x, this.y, 2);
    }
    const nav = this.nav;
    // skip waypoints we're already on top of
    while (nav.i < nav.pts.length &&
           dist2(this.x, this.y, nav.pts[nav.i].x, nav.pts[nav.i].y) < 81) {
      nav.i++; nav.best = Infinity; nav.t = 0;
    }
    const wp = nav.pts[nav.i];
    if (!wp) { this.goto(dest.x, dest.y - 3, true); return dd; }
    const d = this.goto(wp.x, wp.y - 2, true);
    nav.t++;
    if (d < nav.best - 1) { nav.best = d; nav.t = 0; }
    if (nav.t > 400) this.planNav(key); // hopelessly lost: take a fresh look
    return dd;
  }

  npcThink() {
    const col = G.colony;
    this.vx = 0;

    // threat reaction
    const pred = G.nearestPredator(this.x, this.y, this.caste === 'soldier' ? 130 : 70);
    if (pred) {
      if (this.caste === 'soldier' || this.caste === 'queen') {
        this.state = 'fight'; this.target = pred;
      } else if (this.state !== 'flee') {
        this.state = 'flee'; this.stateT = 150;
      }
    }

    switch (this.state) {
      case 'idle': {
        this.stateT--;
        // amble around current spot
        if (Math.random() < 0.01) this.vx = (Math.random() < 0.5 ? -1 : 1) * this.def.speed * 0.6;
        if (G.colony.food < 15 && this.caste === 'worker') this.stateT = 0; // hungry colony: no loitering
        if (this.stateT <= 0) {
          if (this.caste === 'worker') {
            this.state = 'forage';
            this.target = { x: col.entrance.x, y: col.entrance.y - 6 };
          } else if (this.caste === 'nurse') {
            this.state = 'tend'; this.stateT = 400;
          } else if (this.caste === 'soldier') {
            this.state = 'patrol'; this.stateT = 600;
          } else if (this.caste === 'queen') {
            this.stateT = 200;
            // queen stays put, shifts her bulk now and then
            if (Math.abs(this.x - col.queenCh.x) > 18) this.goto(col.queenCh.x, col.queenCh.y, true);
          }
        }
        break;
      }

      case 'forage': {
        // head for the surface first, then wander and look for food
        if (this.y > T.surf[Math.floor(this.x)] + 12) {
          this.navTo('entrance');
        } else {
          if (!this.target || this.target.gotoSurface || Math.abs(this.x - this.target.x) < 10) {
            this.target = {
              x: Math.max(20, Math.min(WORLD_W - 20, col.x + (Math.random() - 0.5) * 1800)),
              y: 0
            };
          }
          this.goto(this.target.x, T.surf[Math.floor(Math.max(0, Math.min(WORLD_W - 1, this.target.x)))] - 4, false);
          // smell food?
          const it = G.nearestItem(this.x, this.y, 400);
          if (it) { this.state = 'collect'; this.target = it; }
          // homesick after a while
          if (Math.random() < 0.0008) { this.state = 'return'; }
        }
        break;
      }

      case 'collect': {
        const it = this.target;
        if (!it || it.carried || it.dead) { this.state = 'forage'; this.target = null; break; }
        const d = this.goto(it.x, it.y, true);
        if (d < 8) {
          it.carried = this;
          this.carry = it;
          this.state = 'return';
          if (G.nearPlayer(this.x, this.y) < 200) Sfx.play('pickup');
        }
        break;
      }

      case 'return': {
        const d = this.navTo('storage');
        if (d < 26) {
          if (this.carry) {
            G.colony.deposit(this.carry, this);
            this.carry = null;
          }
          this.state = 'idle'; this.stateT = 120 + Math.random() * 240;
        }
        // drop pheromone handled in main loop (carrying ants)
        break;
      }

      case 'flee': {
        this.stateT--;
        const p = G.nearestPredator(this.x, this.y, 160);
        if (p) {
          // run away from threat, generally toward home
          const away = Math.sign(this.x - p.x) || 1;
          this.vx = away * this.def.speed * 1.4;
          this.dir = away;
          if (sideWall(this, this.dir)) { this.climbing = true; this.climbV = -0.8; }
        } else {
          this.navTo('junction'); // hide deep in the nest
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.stateT = 100; }
        break;
      }

      case 'fight': {
        const p = (this.target && this.target.hp > 0 && !this.target.dead) ? this.target
                : G.nearestPredator(this.x, this.y, 200);
        if (!p) { this.state = this.caste === 'queen' ? 'idle' : 'patrol'; this.stateT = 200; break; }
        this.target = p;
        const d = this.goto(p.x, p.y, true);
        if (d < 11 && this.biteCd <= 0) {
          p.hurt(this.def.dmg, Math.sign(p.x - this.x) * 0.8, -0.3);
          this.biteCd = 40;
          this.biteAnim = 8;
          if (G.nearPlayer(this.x, this.y) < 220) Sfx.play('bite');
        }
        break;
      }

      case 'patrol': {
        this.stateT--;
        const keys = ['entrance', 'junction', 'storage', 'nursery', 'queen'];
        const d = this.navTo(keys[this.patrolI % keys.length]);
        if (d < 18) this.patrolI++;
        if (this.stateT <= 0) { this.state = 'idle'; this.stateT = 150; }
        break;
      }

      case 'tend': {
        this.stateT--;
        // find a hungry larva, fetch a morsel from stores, feed it
        const larva = G.brood.find(b => b.kind === 'larva' && b.hungry && !b.claimed);
        if (larva && !this.carry && G.colony.food >= 3) {
          const d = this.navTo('storage');
          if (d < 24) {
            G.colony.food -= 2;
            this.carry = G.makeItem('morsel', this.x, this.y);
            this.carry.carried = this;
            G.items.push(this.carry);
            larva.claimed = this.id;
          }
        } else if (this.carry) {
          const l = G.brood.find(b => b.kind === 'larva' && b.claimed === this.id) ||
                    G.brood.find(b => b.kind === 'larva' && b.hungry);
          if (!l) { // nobody hungry: put it back
            const d = this.navTo('storage');
            if (d < 24) { G.colony.food += 2; this.carry.dead = true; this.carry = null; }
          } else if (dist2(this.x, this.y, l.x, l.y) < 3600) {
            const d = this.goto(l.x, l.y, true);
            if (d < 9) {
              l.feed();
              this.carry.dead = true; this.carry = null;
              if (G.nearPlayer(this.x, this.y) < 200) Sfx.play('milk');
            }
          } else {
            this.navTo('nursery');
          }
        } else {
          // hang around the nursery
          if (Math.abs(this.x - col.nursery.x) > 20) this.navTo('nursery');
          else if (Math.random() < 0.01) this.vx = (Math.random() < 0.5 ? -1 : 1) * 0.3;
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.stateT = 150; }
        break;
      }
    }
  }

  draw(ctx, camx, camy) {
    const c = this.def;
    const ex = Math.round(this.x - camx), ey = Math.round(this.y - camy);
    if (ex < -16 || ex > 336 || ey < -16 || ey > 216) return;
    const s = c.size;
    ctx.save();
    ctx.translate(ex, ey);
    if (this.climbing) ctx.rotate(-this.dir * Math.PI / 2 * 0.85);
    ctx.scale(this.dir * s, s);

    const col = this.flash > 0 ? '#ffffff'
      : `rgb(${c.color[0]},${c.color[1]},${c.color[2]})`;
    const dark = this.flash > 0 ? '#ffffff'
      : `rgb(${c.color[0] * 0.55 | 0},${c.color[1] * 0.55 | 0},${c.color[2] * 0.55 | 0})`;

    const legUp = (Math.sin(this.phase) > 0) ? 1 : 0;
    ctx.fillStyle = dark;
    // legs, 2-frame gait
    ctx.fillRect(-3 + legUp, 1, 1, 2);
    ctx.fillRect(0 - legUp, 1, 1, 2);
    ctx.fillRect(2 + legUp, 1, 1, 2);
    // antennae
    ctx.fillRect(3, -3, 1, 1);
    ctx.fillRect(4, -4, 1, 1);

    ctx.fillStyle = col;
    // abdomen / thorax / head
    ctx.fillRect(-7, -2, 5, 4);
    ctx.fillRect(-7, -1, 6, 2);
    ctx.fillRect(-2, -1, 3, 2);
    ctx.fillRect(1, -2, 3, 3);
    if (this.caste === 'queen') {       // bigger gaster + wing scars
      ctx.fillRect(-9, -2, 3, 4);
      ctx.fillStyle = 'rgba(220,220,240,0.5)';
      ctx.fillRect(-6, -4, 5, 2);
    }
    // mandibles
    ctx.fillStyle = dark;
    const mo = this.biteAnim > 3 ? 1 : 0;
    ctx.fillRect(4, -2 - mo, 1, 1);
    ctx.fillRect(4, 0 + mo, 1, 1);
    // eye
    ctx.fillStyle = '#1a0e08';
    ctx.fillRect(2, -1, 1, 1);
    ctx.restore();

    // carried item rides on the back
    if (this.carry) drawItem(ctx, this.carry, camx, camy, true);

    // player marker
    if (this.playerIdx >= 0) {
      ctx.fillStyle = this.playerIdx === 0 ? '#ffe080' : '#80d0ff';
      ctx.fillRect(ex - 1, ey - 9 - (G.tick >> 4) % 2, 3, 1);
      ctx.fillRect(ex, ey - 10 - (G.tick >> 4) % 2, 1, 2);
    }
  }
}

// ---------------------------------------------------------------------------
// Brood: eggs and larvae
// ---------------------------------------------------------------------------
class Brood {
  constructor(x, y, kind) {
    this.id = ENT_ID++;
    this.kind = kind; // 'egg' | 'larva'
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.hw = 2; this.hh = 1.5;
    this.hp = 10; this.maxHp = 10;
    this.age = 0;
    this.feedCount = 0;
    this.hungry = false;
    this.hungerT = 600 + Math.random() * 600;
    this.claimed = 0;
    this.phase = Math.random() * 10;
    this.dir = 1; this.climbing = false; this.blocked = false;
  }

  hurt(dmg) {
    this.hp -= dmg;
    G.particles.blood(this.x, this.y, 3);
  }

  feed() {
    this.feedCount++;
    this.hungry = false;
    this.claimed = 0;
    this.hungerT = 1500 + Math.random() * 1200;
  }

  update() {
    this.age++;
    this.phase += 0.05;
    physStep(this);
    if (this.kind === 'egg') {
      if (this.age > 3600) {  // ~60s
        this.kind = 'larva';
        this.age = 0;
        if (G.nearPlayer(this.x, this.y) < 240) Sfx.play('hatch');
      }
    } else {
      this.hungerT--;
      if (this.hungerT <= 0 && !this.hungry) { this.hungry = true; this.claimed = 0; }
      if (this.hungry && this.hungerT < -3600) this.hp -= 0.004; // starves slowly
      // grown up?
      if (this.feedCount >= 3 && this.age > 5400) {
        this.dead = true;
        G.colony.spawnAdult(this.x, this.y);
      }
      // tiny wiggle
      if (Math.random() < 0.02) this.vx = (Math.random() - 0.5) * 0.3;
      else this.vx = 0;
    }
  }

  draw(ctx, camx, camy) {
    const ex = Math.round(this.x - camx), ey = Math.round(this.y - camy);
    if (ex < -10 || ex > 330 || ey < -10 || ey > 210) return;
    if (this.kind === 'egg') {
      ctx.fillStyle = '#efe9d8';
      ctx.fillRect(ex - 1, ey - 2, 2, 3);
      ctx.fillStyle = '#cfc8b0';
      ctx.fillRect(ex - 1, ey, 2, 1);
    } else {
      const w = Math.sin(this.phase * 4) > 0 ? 1 : 0;
      ctx.fillStyle = '#e8dfc0';
      ctx.fillRect(ex - 2 + w, ey - 1, 4, 2);
      ctx.fillRect(ex - 1 + w, ey - 2, 3, 1);
      ctx.fillStyle = '#c8bd96';
      ctx.fillRect(ex - 1 + w, ey, 1, 1);
      ctx.fillRect(ex + 1 + w, ey, 1, 1);
      if (this.hungry && (G.tick >> 4) % 2) {
        drawText(ctx, '!', ex - 2, ey - 11, '#ff5050');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Bugs: aphid, pillbug, worm, spider, centipede
// ---------------------------------------------------------------------------
const BUG_DEF = {
  aphid:     { hp: 5,   speed: 0.1,  dmg: 0, corpse: 4 },
  pillbug:   { hp: 14,  speed: 0.25, dmg: 0, corpse: 8 },
  worm:      { hp: 15,  speed: 0.18, dmg: 0, corpse: 12 },
  spider:    { hp: 60,  speed: 0.55, dmg: 7, corpse: 22 },
  centipede: { hp: 80,  speed: 0.32, dmg: 9, corpse: 28 },
};

class Bug {
  constructor(x, y, kind) {
    this.id = ENT_ID++;
    this.kind = kind;
    const d = BUG_DEF[kind];
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.hp = d.hp; this.maxHp = d.hp;
    this.hw = kind === 'spider' ? 5 : kind === 'centipede' ? 3 : 3;
    this.hh = kind === 'spider' ? 3 : 2;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.phase = Math.random() * 10;
    this.state = 'wander';
    this.stateT = 100;
    this.target = null;
    this.biteCd = 0;
    this.flash = 0;
    this.curl = 0;       // pillbug
    this.milkCd = 0;     // aphid
    this.trail = [];     // centipede / worm
    this.climbing = false; this.climbV = 0; this.blocked = false;
    this.angle = Math.random() * Math.PI * 2; // diggers
    this.fleeing = false;
  }

  get predator() { return this.kind === 'spider' || this.kind === 'centipede'; }

  hurt(dmg, kx, ky) {
    if (this.kind === 'pillbug' && this.curl > 0) dmg *= 0.35;
    this.hp -= dmg;
    this.flash = 6;
    this.vx += kx || 0; this.vy += (ky || 0) - 0.4;
    G.particles.blood(this.x, this.y, 4);
    if (this.kind === 'pillbug') this.curl = 180;
    if (this.kind === 'aphid' || this.kind === 'worm') this.fleeing = true;
    if (this.predator && this.hp < this.maxHp * 0.25) this.fleeing = true;
    if (G.nearPlayer(this.x, this.y) < 220) Sfx.play('hurt');
  }

  update() {
    if (this.flash > 0) this.flash--;
    if (this.biteCd > 0) this.biteCd--;
    if (this.milkCd > 0) this.milkCd--;
    if (this.curl > 0) this.curl--;
    this.phase += Math.abs(this.vx) * 0.7 + 0.05;

    switch (this.kind) {
      case 'aphid':     this.aphidThink(); break;
      case 'pillbug':   this.pillbugThink(); break;
      case 'worm':      this.diggerThink(2.5, 0.012); break;
      case 'centipede': this.centipedeThink(); break;
      case 'spider':    this.spiderThink(); break;
    }

    // walkers wedged in terrain thrash themselves loose
    if (this.kind !== 'worm' && this.kind !== 'centipede' &&
        this.flash === 0 && T.boxSolid(this.x, this.y, this.hw, this.hh)) {
      T.dig(this.x, this.y, Math.max(this.hw, this.hh) + 2.5);
    }

    if (this.kind === 'worm' || this.kind === 'centipede') {
      // segment trail
      const last = this.trail[0];
      if (!last || dist2(last.x, last.y, this.x, this.y) > 9) {
        this.trail.unshift({ x: this.x, y: this.y });
        if (this.trail.length > (this.kind === 'centipede' ? 9 : 5)) this.trail.pop();
      }
    } else {
      physStep(this);
      if (this.climbing && !sideWall(this, this.dir)) {
        this.climbing = false; this.vy = -1.0; this.vx = this.dir * 0.5;
      }
    }
  }

  aphidThink() {
    // cling to whatever it sits on; tiny crawls
    this.vx = 0;
    if (this.fleeing) { this.vx = this.dir * 0.3; if (Math.random() < 0.02) this.fleeing = false; }
    else if (Math.random() < 0.004) { this.dir = -this.dir; this.vx = this.dir * 0.1; }
    // drip honeydew once in a while
    if (Math.random() < 0.0004 && G.items.length < 60) {
      const it = G.makeItem('honeydew', this.x, this.y + 3);
      G.items.push(it);
    }
  }

  pillbugThink() {
    if (this.curl > 0) { this.vx = 0; return; }
    if (Math.random() < 0.008) this.dir = -this.dir;
    this.vx = this.dir * BUG_DEF.pillbug.speed;
    if (this.blocked) this.dir = -this.dir;
  }

  // worms (and the fallback for centipede wandering): tunnel through dirt
  diggerThink(digR, turnRate) {
    const d = BUG_DEF[this.kind];
    this.angle += (Math.random() - 0.5) * 0.3;
    // stay underground
    const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, this.x)));
    if (this.y < T.surf[sx] + 25) this.angle = Math.PI / 2 + (Math.random() - 0.5);
    if (this.y > WORLD_H - 40) this.angle = -Math.PI / 2 + (Math.random() - 0.5);
    const nx = this.x + Math.cos(this.angle) * d.speed;
    const ny = this.y + Math.sin(this.angle) * d.speed;
    // dig if needed
    if (T.boxSolid(nx, ny, this.hw, this.hh)) {
      if (T.digHasTarget(nx, ny, digR + 1)) {
        T.dig(nx, ny, digR + 1);
      } else { this.angle += Math.PI * (0.5 + Math.random() * 0.5); return; }
    }
    this.x = nx; this.y = ny;
    this.dir = Math.cos(this.angle) >= 0 ? 1 : -1;
  }

  centipedeThink() {
    const d = BUG_DEF.centipede;
    const prey = this.fleeing ? null : G.nearestAnt(this.x, this.y, 90, true);
    if (prey) {
      const ang = Math.atan2(prey.y - this.y, prey.x - this.x);
      this.angle = ang;
      const nx = this.x + Math.cos(ang) * d.speed * 1.5;
      const ny = this.y + Math.sin(ang) * d.speed * 1.5;
      if (T.boxSolid(nx, ny, this.hw, this.hh)) {
        if (T.digHasTarget(nx, ny, 4)) T.dig(nx, ny, 4);
        else { this.angle += 1.5; return; }
      }
      this.x = nx; this.y = ny;
      this.dir = Math.cos(ang) >= 0 ? 1 : -1;
      if (dist2(this.x, this.y, prey.x, prey.y) < 100 && this.biteCd <= 0) {
        prey.hurt(d.dmg, Math.sign(prey.x - this.x), -0.5);
        this.biteCd = 55;
        if (G.nearPlayer(this.x, this.y) < 240) Sfx.play('bite');
      }
    } else {
      this.diggerThink(3.5, 0.02);
      if (this.fleeing && Math.random() < 0.002) this.fleeing = false;
    }
  }

  spiderThink() {
    const d = BUG_DEF.spider;
    const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, this.x)));
    if (this.fleeing) {
      // run for the map edge
      const edge = this.x < WORLD_W / 2 ? 10 : WORLD_W - 10;
      this.dir = Math.sign(edge - this.x);
      this.vx = this.dir * d.speed * 1.3;
      if (this.blocked && sideWall(this, this.dir)) { this.climbing = true; this.climbV = -0.9; }
      else this.climbing = false;
      if (Math.abs(this.x - edge) < 30) this.dead = true; // slips away
      return;
    }
    const prey = G.nearestAnt(this.x, this.y, 110, false);
    if (prey && prey.y < T.surf[sx] + 60) {
      this.state = 'hunt';
      this.dir = Math.sign(prey.x - this.x) || 1;
      this.vx = this.dir * d.speed * 1.25;
      const wall = sideWall(this, this.dir);
      this.climbing = false;
      if (prey.y < this.y - 6 && wall) { this.climbing = true; this.climbV = -0.8; }
      if (dist2(this.x, this.y, prey.x, prey.y) < 110 && this.biteCd <= 0) {
        prey.hurt(d.dmg, this.dir * 1.2, -0.6);
        this.biteCd = 50;
        if (G.nearPlayer(this.x, this.y) < 260) Sfx.play('bite');
      }
    } else {
      // prowl the surface
      this.climbing = false;
      if (Math.random() < 0.006) this.dir = -this.dir;
      this.vx = this.dir * d.speed * 0.6;
      if (this.blocked) {
        if (sideWall(this, this.dir) && Math.random() < 0.5) { this.climbing = true; this.climbV = -0.8; }
        else this.dir = -this.dir;
      }
      // don't go deep: spiders dislike tunnels
      if (this.y > T.surf[sx] + 50) {
        // climb back out
        this.climbing = sideWall(this, this.dir);
        this.climbV = -0.9;
        if (!this.climbing && this.onGround) this.vy = -1.5;
      }
    }
  }

  draw(ctx, camx, camy) {
    const ex = Math.round(this.x - camx), ey = Math.round(this.y - camy);
    if (ex < -24 || ex > 344 || ey < -24 || ey > 224) return;
    const fl = this.flash > 0;
    switch (this.kind) {
      case 'aphid': {
        ctx.fillStyle = fl ? '#fff' : '#8cc85a';
        ctx.fillRect(ex - 2, ey - 2, 4, 3);
        ctx.fillStyle = fl ? '#fff' : '#6aa843';
        ctx.fillRect(ex - 2, ey, 4, 1);
        ctx.fillStyle = '#2a3a1a';
        ctx.fillRect(ex + this.dir * 2, ey - 1, 1, 1);
        ctx.fillRect(ex + this.dir * 2, ey - 3, 1, 1);
        break;
      }
      case 'pillbug': {
        if (this.curl > 0) {
          ctx.fillStyle = fl ? '#fff' : '#787884';
          ctx.fillRect(ex - 2, ey - 3, 5, 5);
          ctx.fillRect(ex - 3, ey - 2, 7, 3);
          ctx.fillStyle = fl ? '#fff' : '#5a5a64';
          ctx.fillRect(ex - 1, ey - 2, 1, 3);
          ctx.fillRect(ex + 1, ey - 2, 1, 3);
        } else {
          ctx.fillStyle = fl ? '#fff' : '#787884';
          ctx.fillRect(ex - 4, ey - 2, 8, 3);
          ctx.fillRect(ex - 3, ey - 3, 6, 1);
          ctx.fillStyle = fl ? '#fff' : '#5a5a64';
          for (let i = -3; i <= 3; i += 2) ctx.fillRect(ex + i, ey - 2, 1, 3);
          ctx.fillStyle = '#3a3a42';
          const lo = Math.sin(this.phase) > 0 ? 1 : 0;
          ctx.fillRect(ex - 3 + lo, ey + 1, 1, 1);
          ctx.fillRect(ex - lo, ey + 1, 1, 1);
          ctx.fillRect(ex + 3 - lo, ey + 1, 1, 1);
        }
        break;
      }
      case 'worm': {
        ctx.fillStyle = fl ? '#fff' : '#cc8484';
        for (let i = 0; i < this.trail.length; i++) {
          const t = this.trail[i];
          ctx.fillRect(Math.round(t.x - camx) - 1, Math.round(t.y - camy) - 1, 3, 3);
        }
        ctx.fillStyle = fl ? '#fff' : '#b06a6a';
        ctx.fillRect(ex - 1, ey - 1, 3, 3);
        break;
      }
      case 'centipede': {
        for (let i = this.trail.length - 1; i >= 0; i--) {
          const t = this.trail[i];
          const tx = Math.round(t.x - camx), ty = Math.round(t.y - camy);
          ctx.fillStyle = fl ? '#fff' : (i % 2 ? '#a8702c' : '#925f24');
          ctx.fillRect(tx - 1, ty - 1, 3, 3);
          ctx.fillStyle = '#5a3a14';
          const lo = (i + (G.tick >> 3)) % 2;
          ctx.fillRect(tx - 1, ty + 1 + lo, 1, 1);
          ctx.fillRect(tx + 1, ty + 2 - lo, 1, 1);
        }
        // head
        ctx.fillStyle = fl ? '#fff' : '#b87e34';
        ctx.fillRect(ex - 2, ey - 2, 4, 4);
        ctx.fillStyle = '#c03020';
        ctx.fillRect(ex + this.dir * 2, ey - 1, 1, 1);
        ctx.fillRect(ex + this.dir * 2, ey + 1, 1, 1);
        ctx.fillStyle = '#3a2408';
        ctx.fillRect(ex + this.dir, ey - 1, 1, 1);
        break;
      }
      case 'spider': {
        ctx.save();
        ctx.translate(ex, ey);
        ctx.scale(this.dir, 1);
        const body = fl ? '#fff' : '#3a322a';
        const dk = fl ? '#fff' : '#262019';
        // legs: 2-frame scuttle
        const lo = Math.sin(this.phase * 1.5) > 0 ? 1 : 0;
        ctx.fillStyle = dk;
        for (let i = 0; i < 4; i++) {
          const lx = -3 + i * 2;
          const o = (i + lo) % 2;
          ctx.fillRect(lx, -3 - o, 1, 2);          // upper segment
          ctx.fillRect(lx - 1, 2 + o, 1, 2);       // lower segment
          ctx.fillRect(lx + 4, -3 - (1 - o), 1, 2);
          ctx.fillRect(lx + 5, 2 + (1 - o), 1, 2);
        }
        ctx.fillStyle = body;
        ctx.fillRect(-5, -2, 6, 5);   // abdomen
        ctx.fillRect(-4, -3, 4, 1);
        ctx.fillRect(1, -1, 4, 3);    // cephalothorax
        ctx.fillStyle = '#d02020';    // eyes
        ctx.fillRect(3, -1, 1, 1);
        ctx.fillRect(4, 0, 1, 1);
        ctx.fillStyle = '#e8e0d0';    // fangs
        ctx.fillRect(5, 1, 1, 1);
        ctx.restore();
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
class Item {
  constructor(kind, x, y, value) {
    this.id = ENT_ID++;
    this.kind = kind;
    this.value = value !== undefined ? value : ITEM_DEF[kind].value;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.hw = 1.5; this.hh = 1.5;
    this.carried = null;
    this.dead = false;
    this.dir = 1; this.climbing = false; this.blocked = false;
  }
  update() {
    if (this.carried) {
      const c = this.carried;
      this.x = c.x - c.dir * 2;
      this.y = c.y - 5 * (c.def ? c.def.size : 1);
      return;
    }
    physStep(this);
    this.vx *= 0.85;
  }
}

function drawItem(ctx, it, camx, camy) {
  const ex = Math.round(it.x - camx), ey = Math.round(it.y - camy);
  if (ex < -10 || ex > 330 || ey < -10 || ey > 210) return;
  switch (it.kind) {
    case 'seed':
      ctx.fillStyle = '#d8b878';
      ctx.fillRect(ex - 1, ey - 1, 3, 2);
      ctx.fillStyle = '#a8855a';
      ctx.fillRect(ex + 1, ey, 1, 1);
      break;
    case 'honeydew':
      ctx.fillStyle = '#e8a820';
      ctx.fillRect(ex - 1, ey - 1, 3, 3);
      ctx.fillStyle = '#ffe080';
      ctx.fillRect(ex - 1, ey - 1, 1, 1);
      break;
    case 'leaf':
      ctx.fillStyle = '#54a838';
      ctx.fillRect(ex - 1, ey - 1, 3, 2);
      ctx.fillRect(ex, ey - 2, 2, 1);
      break;
    case 'corpse':
      ctx.fillStyle = '#8a8270';
      ctx.fillRect(ex - 2, ey - 1, 4, 2);
      ctx.fillStyle = '#6a6354';
      ctx.fillRect(ex - 1, ey, 2, 1);
      break;
    case 'bigcorpse':
      ctx.fillStyle = '#8a8270';
      ctx.fillRect(ex - 2, ey - 2, 5, 4);
      ctx.fillStyle = '#6a6354';
      ctx.fillRect(ex - 1, ey - 1, 3, 2);
      break;
    case 'morsel':
      ctx.fillStyle = '#f0ead0';
      ctx.fillRect(ex - 1, ey - 1, 2, 2);
      break;
  }
}
