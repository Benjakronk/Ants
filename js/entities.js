// MAUR -- entities: ants, brood, bugs, items. Physics + AI + pixel sprites.
'use strict';

let ENT_ID = 1;

// digPow: bite strength against packed earth (PACKED_HP 3: workers need 3
// bites, soldiers 2)
const CASTE = {
  // color: the players' black ants -- charcoal, lit by a pale rim and gloss
  // (see Ant.draw) so they read in a dark tunnel and never pass for red ones
  worker:  { hp: 30,  dmg: 5,  speed: 0.55, size: 1.0,  color: [62, 52, 50],   digR: 4.5, digCd: 13, digPow: 1 },
  soldier: { hp: 55,  dmg: 14, speed: 0.50, size: 1.35, color: [46, 40, 42],   digR: 6.5, digCd: 11, digPow: 1.5 },
  nurse:   { hp: 26,  dmg: 4,  speed: 0.55, size: 0.95, color: [96, 82, 74],   digR: 4.2, digCd: 15, digPow: 1 },
  queen:   { hp: 120, dmg: 12, speed: 0.30, size: 1.9,  color: [84, 50, 70],   digR: 6.5, digCd: 11, digPow: 1.5 },
  // a winged future queen: raised in autumn, waits in the royal chamber for
  // the nuptial flight. Barely digs.
  princess:{ hp: 45,  dmg: 4,  speed: 0.40, size: 1.5,  color: [112, 66, 92],  digR: 2.5, digCd: 30, digPow: 0.5 },
};
// ticks an ant climbs another nest's entrance shaft without getting higher
// before it walks out another way
const SHAFT_GIVEUP = 300;
// nudges a grazing NPC tries before chewing itself free (see shuffleFree)
const SHUFFLE = [[0, -1], [1, 0], [-1, 0], [0, 1], [1, -1], [-1, -1], [0, -2], [2, 0], [-2, 0], [2, -1], [-2, -1]];

// the rival colony's ants: the same castes in a bright fire-ant scarlet
// (well clear of the players' charcoal), with a glossy highlight
const RED_COLOR = {
  worker: [236, 36, 28], soldier: [210, 22, 18], nurse: [246, 78, 56],
  queen: [226, 16, 44], princess: [240, 56, 88],
};
const RED_SHINE = '#ffb8a0';
// the black ants' rim light, gloss and legs
const BLACK_RIM = '#8e8698', BLACK_SHINE = '#d8d4e4', BLACK_LEG = '#6e645e';

// what a (player) ant can haul in its mandibles for building, in pixels
const LOAD_CAP = 100;

// each player's colour (by player index): the chevron over its ant, its
// name tag and map dot online, its messages. Light enough to read on the
// dark tunnels, saturated enough to stand out from the sky, and none of
// them the rival's scarlet or the HUD's gold.
const PLAYER_COLORS = ['#ffe080', '#80d0ff', '#ff9ec8', '#a8f080',
  '#ffa448', '#c4a0ff', '#f4f4f4', '#40e8c8'];

// player i's colour: online the one the server gave it (no one else on its
// side has it -- versus 8v8 has sixteen players), else by index
function playerColor(i) {
  const p = G.players[i];
  const h = p && p.hue !== undefined && p.hue !== null ? p.hue : i;
  return PLAYER_COLORS[h % PLAYER_COLORS.length];
}

const ITEM_DEF = {
  seed:     { value: 5,  food: true },
  honeydew: { value: 8,  food: true },
  leaf:     { value: 2,  food: true },
  corpse:   { value: 4,  food: true },
  bigcorpse:{ value: 15, food: true },
  morsel:   { value: 2,  food: true },
  fungus:   { value: 12, food: true },   // dug from cave mushroom clumps
  berry:    { value: 5,  food: true },   // a piece of the contested site's fallen fruit
  crystal:  { value: 0,  food: false },  // deep treasure: deposits as score
};

// ---------------------------------------------------------------------------
// shared physics
// ---------------------------------------------------------------------------
const GRAV = 0.13, MAXFALL = 3.0;

function physStep(e) {
  const own = e.own;   // our ants walk through ant gates
  // at rest on the ground: still standing on something? Then nothing moves
  // (the full step below would come to the same, at three times the cost)
  if (e.vx === 0 && e.vy === 0 && e.onGround && !e.climbing && !e.ceiling) {
    e.blocked = false;
    if (T.boxSolid(e.x, e.y + 1, e.hw, e.hh, own)) return;
  }
  // horizontal
  e.blocked = false;
  if (e.vx !== 0) {
    const nx = e.x + e.vx;
    if (!T.boxSolid(nx, e.y, e.hw, e.hh, own)) {
      e.x = nx;
    } else {
      let ok = false;
      for (let s = 1; s <= 3; s++) {           // step up small ledges
        if (!T.boxSolid(nx, e.y - s, e.hw, e.hh, own)) { e.x = nx; e.y -= s; ok = true; break; }
      }
      if (!ok && e.ceiling) {
        for (let s = 1; s <= 3; s++) {         // duck under ceiling bumps
          if (!T.boxSolid(nx, e.y + s, e.hw, e.hh, own)) { e.x = nx; e.y += s; ok = true; break; }
        }
      }
      e.blocked = !ok;
    }
  }
  // vertical
  if (e.ceiling && !ceilAbove(e, 4)) e.ceiling = false; // lost grip on the roof
  if (e.climbing) {
    e.vy = e.climbV;
  } else if (e.ceiling) {
    e.vy = -0.9; // press against the roof
  } else {
    e.vy = Math.min(e.vy + GRAV, MAXFALL);
  }
  // nothing launches an ant skyward faster than a hop: stacked knockbacks
  // and escape-boost pileups otherwise fling them absurdly high
  if (e.vy < -2.6) e.vy = -2.6;
  let ground;   // the box one pixel down is solid (when the fall below found out)
  if (e.vy !== 0) {
    // climbers hug the wall and squeeze past small lips: narrower vertical box
    const vhw = (e.climbing || e.ceiling) ? Math.max(1, e.hw - 1.5) : e.hw;
    const ny = e.y + e.vy;
    if (!T.boxSolid(e.x, ny, vhw, e.hh, own)) {
      e.y = ny;
    } else {
      // settle pixel by pixel toward the obstacle
      const sd = Math.sign(e.vy);
      let moved = 0;
      while (moved < Math.abs(e.vy) && !(ground = T.boxSolid(e.x, e.y + sd, vhw, e.hh, own))) { e.y += sd; moved++; }
      // (the test that stopped a fall was the ground test itself)
      if (ground !== true || sd < 0 || vhw !== e.hw) ground = undefined;
      if (e.climbing) e.vBlocked = true;
      e.vy = 0;
    }
  }
  e.onGround = ground !== undefined ? ground : T.boxSolid(e.x, e.y + 1, e.hw, e.hh, own);
  // world clamp
  e.x = Math.max(8, Math.min(WORLD_W - 8, e.x));
  e.y = Math.max(4, Math.min(WORLD_H - 14, e.y));
}

// is there a wall right beside the body in direction dir?
function sideWall(e, dir) {
  return T.colSolid(Math.round(e.x + dir * (e.hw + 1.5)), Math.floor(e.y - e.hh), Math.ceil(e.y + e.hh), e.own);
}

// like sideWall, but reaches a few pixels further (grabbing across a wide shaft)
function wallNear(e, dir, reach) {
  const y0 = Math.floor(e.y - e.hh), y1 = Math.ceil(e.y + e.hh), own = e.own;
  for (let d = 1; d <= reach; d++) {
    if (T.colSolid(Math.round(e.x + dir * (e.hw + d)), y0, y1, own)) return true;
  }
  return false;
}

// is there a roof within reach above the body? (ceiling grip)
function ceilAbove(e, reach) {
  const x0 = Math.floor(e.x - e.hw + 1), x1 = Math.ceil(e.x + e.hw - 1), own = e.own;
  for (let d = 1; d <= reach; d++) {
    if (T.rowSolid(x0, x1, Math.round(e.y - e.hh - d), own)) return true;
  }
  return false;
}

function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

// earth overhead (within 60 px)? Under open sky an ant is outside, even down
// a shaft or in a pit dug into the mound
function roofed(e) {
  const x = Math.round(e.x);
  for (let y = Math.floor(e.y - e.hh - 1), y1 = Math.max(0, y - 60); y > y1; y--) {
    if (T.solid(x, y)) return true;
  }
  return false;
}


// winter: is this out in the deadly cold? NPC ants won't chase anything
// there (they'd freeze on the way); the frost will see to it
function outInCold(e) {
  return G.isWinter() && !sheltered(e);
}

// NPC ants give up on a foe farther away than this
const FIGHT_LEASH = 420;
const QUEEN_LEASH = 50;   // the queen fights only foes this close to her chamber
// farther than this from a nest, an ant on the surface walks there (march)
// instead of following the nest's tunnel map
const MARCH_R = 400, MARCH_STEP = 120;
const FIGHT_GIVEUP = 480;  // ticks of chasing without a bite before an NPC gives up
const RALLY_NERVE = 0.4;   // a rallied worker or nurse fights on down to this much health
const SCAN_EVERY = 3;      // NPCs look around for foes every this many ticks
// far from every player's ant an NPC thinks less often: its decisions every
// THINK_FAR ticks (staggered by id), its physics still every tick. Its
// timers count the ticks that passed (Ant.dt), so a far forager's errands
// take as long as a near one's. Fights, flight, raids, rescues, escorts and
// burrows (and a bitten ant) think every tick wherever they are. Off screen
// but within THINK_NEAR it thinks every other tick; within THINK_SEE (the
// view and a margin around it) every tick.
const THINK_SEE = 260, THINK_NEAR = 900, THINK_FAR = 4;
const THINK_BUSY = { fight: 1, flee: 1, rescue: 1, follow: 1, raid: 1, home: 1 };


// anything hunting near a colony's nest (a predator, or an ant of another
// colony) that its soldiers should see off
function colonyThreat(col) {
  const near = e => Math.abs(e.x - col.x) < 450 && Math.abs(e.y - col.entrance.y) < 350 && !outInCold(e);
  for (const b of G.bugs) if (b.predator && !b.dead && !b.fleeing && near(b)) return b;
  // (an armed enemy ant before a thief)
  let thief = null;
  for (const a of G.ants) {
    if (a.hp <= 0 || a.colony === col || !near(a)) continue;
    if (a.armed()) return a;
    thief = thief || a;
  }
  return thief;
}

// below the original ground line? Down here every passage was chewed out of
// the earth, so a climbing ant always has tunnel wall in front of and behind
// it -- climbing never requires a visible wall pixel underground.
function underground(e) {
  const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, e.x)));
  return e.y > T.bgSurf[sx] + 4;
}

// below the surface line (in a shaft, a tunnel, a pit)?
function nestDeep(e) {
  return e.y > T.surf[Math.floor(Math.max(0, Math.min(WORLD_W - 1, e.x)))] + 12;
}

// the colony whose nest mound (as the world was generated) this is on or
// over, if any
function moundOf(e) {
  for (const c of G.colonies) if (Math.abs(e.x - c.entrance.x) < MOUND_R + 10) return c;
  return null;
}
function onMound(e) { return !!moundOf(e); }

// the far rim of the hollow the surface line spans at x (the shaft's mouth,
// a pit, a crater the players dug out over the nest), going `side`: the
// first column out that way with ground right under the surface line, plus
// a step onto it. (Digging never sinks the line more than SURF_SINK, so over
// a hollow it hangs in mid-air -- and an ant that walks out to "the surface"
// there just falls back in.) null when there's no rim within reach.
const RIM_REACH = 160;
function rimX(x, side) {
  for (let i = 0, cx = Math.round(x); i < RIM_REACH; i++, cx += side) {
    if (cx < 10 || cx >= WORLD_W - 10) return null;
    const s = T.surf[cx];
    if (T.solid(cx, s) || T.solid(cx, s + 1) || T.solid(cx, s + 2)) {
      return Math.max(10, Math.min(WORLD_W - 10, cx + side * 6));
    }
  }
  return null;
}

// the colony whose nest this (underground) thing lies in, if any
function buriedInNest(e) {
  if (!nestDeep(e)) return null;
  for (const c of G.colonies) if (Math.abs(e.x - c.x) < NEST_R) return c;
  return null;
}

// ---------------------------------------------------------------------------
// Ant
// ---------------------------------------------------------------------------
class Ant {
  constructor(x, y, caste, colony) {
    this.id = ENT_ID++;
    this.kind = 'ant';
    this.caste = caste;
    this.colony = colony || G.colony;   // its colony (friend or foe is by colony)
    const c = CASTE[caste];
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.hw = 3 * c.size; this.hh = 2 * c.size;
    this.hp = c.hp; this.maxHp = c.hp;
    // the rival's queen is a tough old matriarch
    if (caste === 'queen' && this.colony && !this.colony.player) this.hp = this.maxHp = c.hp * RED_QUEEN_HP;
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
    this.ceiling = false;
    this.climbV = 0;
    this.gotoFail = false;
    this.disperseT = 0;
    this.disperseDir = 1;
    this.biteAnim = 0;
    this.flash = 0;
    this.starving = false;
    this.patrolI = 0;
    this.abilCd = 0;   // caste ability cooldown (rally, heal)
    this.rallyT = 0;   // courage: rallied ants fight instead of fleeing
    this.buildCd = 0;  // building cooldown
    this.soil = 0;     // building loads (pixels), collected by player digging
    this.thatch = 0;
    this.raiding = false; // out on a raid against another colony
    this.raidRole = null; // 'fight' or 'steal'
    this.followIdx = -1;  // a player soldier's rally: the player it escorts...
    this.followT = 0;     // ...for this many more ticks (see rallyFollow)
    this.dt = 1;          // ticks since its last think (see THINK_FAR)
    this.thinkT = 0;      // the tick it last thought
  }

  get def() { return CASTE[this.caste]; }
  // ant gates let its colony's ants through (they're the players' build)
  get own() { return this.colony ? this.colony.gates : true; }
  // a threat to an enemy forager: something it runs from (workers on their
  // errands mostly ignore each other, and a raid's thieves are no fighters)
  armed() {
    return this.caste === 'soldier' || this.caste === 'queen' || (this.raiding && this.raidRole === 'fight') ||
      this.playerIdx >= 0 || this.state === 'fight';
  }

  // caste stats with the colony's crystal upgrades applied (see UPGRADES)
  dmgNow() { return this.def.dmg * (1 + UPG_DMG * upgLevel('mandibles', this.colony)); }
  digRNow() { return this.def.digR * (1 + UPG_DIGR * upgLevel('digging', this.colony)); }
  digCdNow() { return Math.max(4, Math.round(this.def.digCd * (1 - UPG_DIGCD * upgLevel('digging', this.colony)))); }
  speedNow() {
    return this.def.speed * (this.carry ? 1 + UPG_CARRY * upgLevel('carry', this.colony) : 1);
  }

  hurt(dmg, kx, ky, by) {
    // armor plates: soldiers shrug off part of every blow
    if (this.caste === 'soldier') dmg *= 1 - UPG_ARMOR * upgLevel('armor', this.colony);

    const dealt = Math.max(0, Math.min(dmg, this.hp));
    this.hp -= dmg;
    // who bit us (a fighter turns on it, see the fight state)
    if (by) { this.hitBy = by; this.hitT = G.tick; }
    // a queen remembers whose colony drew blood, and how much of it lately
    // (the bonus for slaying the red queen needs a real hand in her death --
    // see defeatColony; -1 is anything that isn't an ant)
    if (this.caste === 'queen' && this.colony) {
      const ci = by && by.colony ? by.colony.idx : -1;
      this.colony.queenHit = { col: ci, t: G.tick };
      this.colony.woundQueen(ci, dealt);
    }
    this.flash = 6;
    this.vx += kx || 0; this.vy += (ky || 0) - 0.5;
    G.fx('blood', this.x, this.y, 4);
    G.sfx('hurt', this.x, this.y, 220);
    // (a raid's thief presses on to the stores until badly hurt; a rallied
    // worker or nurse stands its ground until it is, then runs for it --
    // raid soldiers used to cut whole rallies of workers down)
    const rallied = this.rallyT > 0 && this.hp > this.maxHp * RALLY_NERVE;
    if (this.playerIdx < 0 && this.caste !== 'soldier' && this.caste !== 'queen' &&
        this.caste !== 'princess' && !rallied && this.state !== 'rescue' &&
        !(this.raiding && this.state === 'raid' && this.hp > this.maxHp * RAID_NERVE)) {
      this.state = 'flee'; this.stateT = 120;
      this.rallyT = 0;
    }
  }

  update() {
    if (this.flash > 0) this.flash--;
    if (this.biteCd > 0) this.biteCd--;
    if (this.digCd > 0) this.digCd--;
    if (this.biteAnim > 0) this.biteAnim--;
    if (this.abilCd > 0) this.abilCd--;
    if (this.rallyT > 0) this.rallyT--;
    if (this.buildCd > 0) this.buildCd--;
    this.phase += Math.abs(this.vx) * 0.6 + (this.climbing ? 0.4 : 0);

    // buried (squeezed through a pinch, loose soil): chew yourself free
    if (this.digCd <= 0 && T.boxSolid(this.x, this.y, this.hw, this.hh, this.own) && !this.shuffleFree()) {
      // an NPC brushing the players' mound or walls leaves them standing
      // and wriggles off instead (it only chews through if that fails)
      const spare = this.playerIdx < 0 ? SPARE_BUILT : SPARE_NONE;
      // (an NPC chews out just its body: wide bites here, every time a big
      // soldier rubbed the entrance shaft, ate the nest mound into a crater)
      const r0 = Math.max(this.hw, this.hh) + (this.playerIdx < 0 ? 1 : 2.5);
      T.dig(this.x, this.y, r0, undefined, this.own, spare);
      this.digCd = this.def.digCd;
      this.biteAnim = 6;
      G.fx('dirt', this.x, this.y, 2);
      // wood or rock against the body: chewing won't free us, and a
      // sub-pixel overlap pins every walking move -- wriggle out instead
      if (T.boxHard(this.x, this.y, this.hw, this.hh) ||
          (spare && T.boxSolid(this.x, this.y, this.hw, this.hh, this.own))) {
        let freed = false;
        outer: for (let r = 1; r <= (spare ? 8 : 4); r++) {
          for (const o of [[r, 0], [-r, 0], [0, -r], [0, r], [r, -r], [-r, -r]]) {
            if (!T.boxSolid(this.x + o[0], this.y + o[1], this.hw, this.hh, this.own)) {
              this.x += o[0]; this.y += o[1];
              freed = true;
              break outer;
            }
          }
        }
        if (!freed && spare) T.dig(this.x, this.y, r0, undefined, this.own);
      }
    }

    if (this.playerIdx >= 0) {
      // player-controlled: input applied by main.js before this call
      physStep(this);
      return;
    }
    if (this.thinkNow()) {
      this.dt = this.thinkT > 0 ? Math.max(1, Math.min(THINK_FAR, G.tick - this.thinkT)) : 1;
      this.thinkT = G.tick;
      this.npcThink();
      // ceiling grip only persists while goto keeps asserting it
      if (this.gotoTick !== G.tick) this.ceiling = false;
    }
    // freeze detector: an NPC pinned in place for ~12s (wood pockets, branch
    // forks, hop loops) shakes itself loose no matter what its state machine
    // wants. The tall y-band counts jumping on the spot as pinned too.
    if (this.caste !== 'queen') {
      if (!this.freezeP || Math.abs(this.x - this.freezeP.x) > 5 || Math.abs(this.y - this.freezeP.y) > 12) {
        this.freezeP = { x: this.x, y: this.y };
        this.freezeT = 0;
      } else if (this.state !== 'idle' && ++this.freezeT > 720) {
        this.freezeT = 0;
        // whatever it was after (a seed past a trunk, an aphid in a branch
        // fork) is out of its reach: shunned like a goto failure, or the next
        // forager by -- or this one, set loose -- walks straight back into
        // the same fork (the canopy's freezes were mostly the same few items)
        const tg = this.target;
        if (tg && (this.state === 'collect' || this.state === 'milk') && !tg.carried) {
          tg.shunT = G.tick + 1800;
          if (this.state === 'collect' && (tg.shunN = (tg.shunN || 0) + 1) >= 3) tg.dead = true;
        }
        this.climbing = false; this.ceiling = false; this.crotchT = 0;
        this.state = 'idle'; this.stateT = 60; this.target = null; this.nav = null;
        T.dig(this.x, this.y + 4, Math.max(this.hw, this.hh) + 2, undefined, this.own, SPARE_THATCH);
        outer: for (let r = 4; r <= 16; r += 4) {
          for (const o of [[0, r], [r, 0], [-r, 0], [r, r], [-r, r], [0, -r]]) {
            if (!T.boxSolid(this.x + o[0], this.y + o[1], this.hw, this.hh, this.own)) {
              this.x += o[0]; this.y += o[1];
              break outer;
            }
          }
        }
        this.vy = 1;
      }
    }
    physStep(this);
    // climbing ant that lost its wall: boost over the ledge.
    // Not underground -- there the walls are implied and climbing is free.
    if (this.climbing && this.climbV < 0 && !underground(this) &&
        !wallNear(this, this.dir, 4) && !wallNear(this, -this.dir, 4)) {
      this.climbing = false;
      this.vy = -1.3; this.vx = this.dir * 0.7;
    }
  }

  // does this NPC make its decisions this tick? Every THINK_FAR ticks (by
  // id); every tick while busy (see THINK_BUSY) or near a player's ant.
  // Between thinks it keeps its last steering (speed, climb, roof grip).
  thinkNow() {
    const k = (G.tick + this.id) % THINK_FAR;
    if (k === 0) return true;
    if (this.raiding || this.followT > 0 || this.burrowT > 0 || THINK_BUSY[this.state]) return true;
    if (this.hitT !== undefined && G.tick - this.hitT < 120) return true;
    let near = false;
    for (const p of G.players) {
      const a = p.ant;
      if (!a || a.hp <= 0 || Math.abs(a.x - this.x) >= THINK_NEAR) continue;
      const d = dist2(a.x, a.y, this.x, this.y);
      if (d < THINK_SEE * THINK_SEE) return true;
      if (d < THINK_NEAR * THINK_NEAR) near = true;
    }
    return near && (k & 1) === 0;
  }

  // did a tick with (tick + id) % n === 0 pass since this ant last thought?
  // (the every-n-ticks chores of a far ant that thinks only now and then)
  every(n) { return (G.tick + this.id) % n < this.dt; }

  // an NPC whose box grazes the earth (a big soldier in a narrow shaft, a
  // sub-pixel overlap after a climb) first tries a pixel or two of shuffle
  // into open air before it chews anything. Returns true when freed.
  shuffleFree() {
    if (this.playerIdx >= 0) return false;
    for (const o of SHUFFLE) {
      if (!T.boxSolid(this.x + o[0], this.y + o[1], this.hw, this.hh, this.own)) {
        this.x += o[0]; this.y += o[1];
        return true;
      }
    }
    return false;
  }

  // walk/climb/dig toward a point. The heart of NPC navigation: no pathfinding,
  // just stubbornness -- which is also how ants get organic-looking tunnels.
  goto(tx, ty, canDig) {
    const c = this.def;
    const sp = this.speedNow(), digR = this.digRNow();
    const dx = tx - this.x, dy = ty - this.y;
    const wasCeil = this.ceiling;
    const hitCeil = this.vBlocked;   // climbed into a roof last step
    this.climbing = false;
    this.ceiling = false;
    this.gotoTick = G.tick;

    // committed crotch escape: hanging under a branch and pressed into the
    // trunk -- crawl out to the branch tip, then swing up around it
    if (this.crotchT > 0) {
      this.crotchT -= this.dt;
      this.vBlocked = false;
      if (ceilAbove(this, 4)) {
        this.ceiling = true;
        this.vx = this.crotchDir * sp;
        this.dir = this.crotchDir;
      } else {
        // ceiling ran out (the tip): hop up and back onto the branch
        this.crotchT = 0;
        this.vy = -1.9;
        this.vx = -this.crotchDir * sp * 0.6;
      }
      return Math.hypot(dx, dy);
    }
    if (wasCeil && this.blocked) {
      this.crotchN = (this.crotchN || 0) + 1;
      if (this.crotchN > 3) {
        // circling the same limb: this way is barred
        this.crotchN = 0;
        this.gotoFail = true;
      } else {
        this.crotchDir = -this.dir || (Math.random() < 0.5 ? -1 : 1);
        this.crotchT = 120;
        this.ceiling = true;
        this.vx = this.crotchDir * sp;
        this.dir = this.crotchDir;
        return Math.hypot(dx, dy);
      }
    }

    // committed climb-over: once we start scaling an obstacle, see it
    // through instead of dithering at its foot every other frame
    if (this.climbT > 0) {
      this.climbT -= this.dt;
      if (this.vBlocked) {
        this.climbT = 0; // roof overhead: the ceiling logic takes over
      } else if (wallNear(this, this.dir, 4)) {
        this.climbing = true; this.climbV = -sp * 1.1;
        this.vx = this.dir * sp * 0.5;
        return Math.hypot(dx, dy);
      } else {
        this.climbT = 0; // topped out: ledge boost / walking resumes
      }
    }

    if (Math.abs(dx) > 3) {
      this.vx = Math.sign(dx) * sp;
      this.dir = Math.sign(dx);
    } else if (Math.abs(dy) > 4) {
      // center exactly over/under the target so we can drop into holes
      // (halving the gap each tick; a far ant that steers for dt ticks at a
      // time closes as much of it, rather than overshooting back and forth)
      this.vx = Math.max(-sp, Math.min(sp, this.dt > 1 ? dx * (1 - Math.pow(0.5, this.dt)) / this.dt : dx * 0.5));
      if (this.vx !== 0) this.dir = this.vx > 0 ? 1 : -1;
    } else {
      this.vx = 0;
    }

    const wall = sideWall(this, this.dir);

    // climbing into a ceiling counts as stuck
    if (this.vBlocked) { this.blockedT += 2 * this.dt; this.vBlocked = false; }

    // is the target up a tree? Tree limbs defeat ground logic -- give up
    // sooner there so ants shun unreachable canopy food instead of flailing
    const txi = Math.floor(Math.max(0, Math.min(WORLD_W - 1, tx)));
    const treeTarget = ty < T.surf[txi] - 10 && !underground(this);

    // need to go up
    if (dy < -4) {
      let wallDir = 0;
      if (wall) wallDir = this.dir;
      else if (sideWall(this, -this.dir)) wallDir = -this.dir;
      else if (wallNear(this, 1, 6)) wallDir = 1;
      else if (wallNear(this, -1, 6)) wallDir = -1;
      if (wallDir) {
        this.climbing = true; this.climbV = -sp * 1.1;
        this.dir = wallDir;
        if (Math.abs(dx) <= 3) this.vx = wallDir * sp * 0.5; // hug the wall
      } else if (underground(this)) {
        // tunnel country: climb the implied walls, no pixel check needed
        this.climbing = true; this.climbV = -sp * 1.1;
      } else if ((wasCeil || hitCeil) && ceilAbove(this, 4)) {
        this.ceiling = true; // no wall, but a roof to hang from
      } else if (this.onGround && (this.blocked || Math.abs(dx) <= 12)) {
        // hop only when the target is nearly overhead or the way is barred --
        // hopping while still walking a long horizontal leg looks aimless
        // and gets ants nowhere
        this.vy = -1.6; // hop
        this.blockedT++;  // hopping in place counts as stuck
        // hops without getting anywhere: it's out of jumping range
        this.hopN = (this.hopN || 0) + 1;
        if (this.hopN > (treeTarget ? 5 : 12)) {
          this.hopN = 0;
          this.gotoFail = true;
        }
      }
    }

    // ceiling traverse: gripping a roof with somewhere sideways to go --
    // crawl on inverted (under branches and overhangs) instead of dropping off.
    // Not with the target below: then letting go is the way down (ants
    // under a thatched dome's roof, or a packed shelf over the forest floor,
    // crawled it for good toward food or a waypoint on the ground beneath,
    // round and round the crotch escape)
    if (!this.climbing && !this.ceiling && Math.abs(dx) > 3 && dy < 4 &&
        (wasCeil || hitCeil) && ceilAbove(this, 4)) {
      this.ceiling = true;
      if (!this.blocked) this.blockedT = Math.max(0, this.blockedT - 2); // gripping is progress
    }

    // need to go down and roughly above target: let gravity work, or dig
    if (this.blocked || (dy > 4 && Math.abs(dx) < 8 && this.onGround)) {
      this.blockedT += this.dt;
    } else if (!this.blocked) {
      this.blockedT = Math.max(0, this.blockedT - this.dt);
    }

    // stuck: chew through, climb over, or give up
    if (this.blockedT > 30) {
      let acted = false;
      // grass blades against the body (often left hanging in mid-air when
      // the ground under them was dug away) are no wall: brush them aside,
      // digging allowed or not -- an ant wedged under a floating tuft
      // climbed into it for good, unable to bite and too snagged to fall
      if (this.digCd <= 0 && this.brushGrass()) {
        this.digCd = 4;
        this.blockedT = 12;
        acted = true;
      }
      // raycast toward the target for the first diggable spot
      if (!acted && canDig && this.digCd <= 0) {
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        let hit = null;
        for (let t = this.hw + 2; t <= this.hw + 15 && !hit; t += 3) {
          const bx = this.x + ux * t, by = this.y + uy * t;
          if (T.digHasTarget(bx, by, digR, this.own, SPARE_BUILT)) hit = { bx, by };
        }
        if (hit) {
          T.dig(hit.bx, hit.by, digR, c.digPow, this.own, SPARE_BUILT);
          T.dig(this.x + ux * 2, this.y + uy * 2, digR * 0.8, 0, this.own, SPARE_BUILT); // clear around the body too
          G.fx('dirt', hit.bx, hit.by, 3);
          G.sfx('dig', hit.bx, hit.by, 200);
          this.digCd = this.digCdNow() + 6;
          this.biteAnim = 6;
          this.blockedT = 12;
          acted = true;
        }
      }
      if (!acted && this.blockedT > 240) {
        // chewing and climbing have both failed for ages: hard reset
        this.blockedT = 0;
        this.gotoFail = true;
      } else if (!acted && (dy < 4 || this.blocked) &&
                 (wallNear(this, this.dir, 4) || wallNear(this, -this.dir, 4))) {
        // nothing to chew (rock, wood, or digging forbidden): climb over it.
        // Even with the target below us, a wall in the face means up-and-
        // around is the only way through.
        if (!wallNear(this, this.dir, 4)) this.dir = -this.dir;
        this.climbing = true; this.ceiling = false; this.climbV = -sp * 1.1;
        this.vx = this.dir * sp * 0.5;
        this.climbT = 60; // commit to the ascent
      } else if (!acted && dy > 4 && this.onGround) {
        // perched on something undiggable right above the target (a rock
        // lip, say): shuffle sideways until gravity can take over
        if ((this.sideT = (this.sideT || 0) - this.dt) <= 0) {
          this.sideDir = Math.random() < 0.5 ? -1 : 1;
          this.sideT = 40 + Math.random() * 50;
        }
        this.vx = this.sideDir * sp;
        this.dir = this.sideDir;
      } else if (!acted && !this.climbing && this.blockedT > 120) {
        // truly stuck against rock or open air: tell the caller to re-plan
        this.blockedT = 0;
        this.gotoFail = true;
      }
    }

    // last resort: no progress for ~4s means some pixel geometry has us beat.
    // Squeeze bodily through the soil toward the target, Liero physics be damned.
    const dNow = Math.hypot(dx, dy);
    if (!this.lastGoto || Math.abs(this.lastGoto.x - tx) > 6 || Math.abs(this.lastGoto.y - ty) > 6) {
      this.lastGoto = { x: tx, y: ty };
      this.gotoBest = 1e9; this.noProgT = 0; this.squeezeN = 0; this.crotchN = 0; this.hopN = 0;
    }
    if (dNow < this.gotoBest - 0.5) { this.gotoBest = dNow; this.noProgT = 0; this.squeezeN = 0; this.crotchN = 0; this.hopN = 0; }
    else this.noProgT += this.dt;
    // only squeeze while gripping terrain -- a free-floating ant must fall,
    // not levitate across open chambers
    if (canDig && this.noProgT > 240 && T.boxSolid(this.x, this.y, this.hw + 2, this.hh + 2, this.own)) {
      this.squeezeN = (this.squeezeN || 0) + 1;
      if (this.squeezeN > 40) {
        // 40 squeezes with no net progress: this spot is unreachable
        this.squeezeN = 0; this.noProgT = 0;
        this.gotoFail = true;
        return dNow;
      }
      const ux = dx / (dNow || 1), uy = dy / (dNow || 1);
      // (a sealed wall of packed earth does give way here, slowly: the
      // colony is never walled in for good -- but the thatch stays)
      T.dig(this.x + ux * 3, this.y + uy * 3, Math.max(this.hw, this.hh) + 1, undefined, this.own, SPARE_THATCH);
      const nx = this.x + ux * 2, ny = this.y + uy * 2;
      if (!T.boxSolid(nx, ny, 1.5, 1.5, this.own) && !T.boxHard(nx, ny, this.hw, this.hh)) {
        this.x = nx; this.y = ny;
        this.vy = 0; // grip the soil: no falling back between squeezes
        this.noProgT = 235;
        this.biteAnim = 6;
        G.fx('dirt', this.x, this.y, 2);
        G.sfx('dig', this.x, this.y, 200);
      } else {
        // bedrock or wood in the way: this route is hopeless
        this.noProgT = 0;
        this.gotoFail = true;
      }
    } else if (this.noProgT > (treeTarget ? 420 : 900)) {
      // long stretch of zero progress (hopping at an unreachable spot,
      // pacing a ledge, circling a branch): admit defeat so the state
      // machine moves on. Tree targets get half the patience.
      this.noProgT = 0;
      this.gotoFail = true;
    }
    return dNow;
  }

  // --- nest navigation: follow the remembered tunnel centerlines ------------
  // (`col`: whose nest -- the ant's own by default. Raiders find their way
  // into the enemy's by its tunnels just the same.)
  navDest(key, col) {
    col = col || this.colony;
    return key === 'entrance' ? col.entrance
      : key === 'storage' ? col.storage
      : key === 'nursery' ? col.nursery
      : key === 'queen' ? col.queenCh
      : col.junction;
  }

  // the nest this ant is down in, if any: under a roof of earth, near one of
  // its chambers or tunnels (its mental map). Under open sky (a dug-out
  // crater over the stores) only the nest it's already finding its way
  // through still counts: a roof that comes and goes with every pixel
  // stepped must not throw its route away each tick.
  nestIn() {
    const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, this.x)));
    if (this.y < T.surf[sx] + 12) return null;
    const roof = roofed(this);
    for (const c of G.colonies) {
      if (Math.abs(this.x - c.x) >= NEST_R) continue;
      if (!roof && !(this.nav && this.nav.col === c)) continue;
      if (c.chamberNear(this.x, this.y, CH_R + 12)) return c;
      for (const k in c.paths) {
        for (const p of c.paths[k]) if (dist2(this.x, this.y, p.x, p.y) < 900) return c;
      }
    }
    return null;
  }

  planNav(key, col) {
    col = col || this.colony;
    const P = col.paths;
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
    this.nav = { key, col, pts, i: 0, t: 0, best: Infinity };
  }

  // bite away the grass pixels touching the body (a box a pixel wider than
  // it at the sides and overhead -- not the turf it stands on); returns how
  // many went
  brushGrass() {
    const x0 = Math.floor(this.x - this.hw - 1), x1 = Math.ceil(this.x + this.hw + 1);
    const y0 = Math.floor(this.y - this.hh - 1), y1 = Math.floor(this.y + this.hh);
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (T.get(x, y) === M_GRASS) { T.dig(x, y, 0.5, 0); n++; }
      }
    }
    return n;
  }

  // a long walk over the surface toward x: from waypoint to waypoint along
  // the ground, climbing what's in the way but never digging. A waypoint
  // it can't reach (up a trunk, past a boulder) is passed by.
  march(tx, dig) {
    const dir = Math.sign(tx - this.x) || 1;
    const clampX = x => Math.round(Math.max(10, Math.min(WORLD_W - 10, x)));
    // a tree in the way: its wood won't yield and its crown is a maze, so
    // dig under the roots instead (down, along, and up past the trunk)
    const t = G.trees.find(t => Math.abs(t.x - this.x) < 60 && (t.x - this.x) * dir > -30);
    if (t) {
      const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, this.x)));
      if (this.y < T.surf[sx] - 18) {
        // up in the tree already: let go and drop off the limb
        this.climbing = false; this.ceiling = false;
        this.crotchT = 0; this.climbT = 0;
        this.vx = (this.id % 2 ? dir : -dir) * this.def.speed;
        this.dir = this.vx > 0 ? 1 : -1;
        return;
      }
      const ahead = (t.x - this.x) * dir > 0, deep = T.bgSurf[t.x] + 16;
      if (ahead && this.y < deep - 6) this.goto(clampX(t.x - dir * 12), deep, true);  // down
      else if (ahead) this.goto(clampX(t.x + dir * 14), deep, true);                  // under
      else this.goto(clampX(t.x + dir * 36), T.surf[clampX(t.x + dir * 36)] - 4, true); // up
      this.gotoFail = false;
      this.marchWp = null;
      return;
    }
    // below ground (out of some side tunnel): up and onward, digging. (An
    // ant under open sky -- in a shaft, a pit -- just walks and climbs out,
    // unless it's deep down in a crater: walking waypoints on the surface
    // line far overhead gets it nowhere, so it digs its way up too.)
    const msx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, this.x)));
    if (dig || roofed(this) || this.y > T.surf[msx] + 30) {
      const ux = clampX(this.x + dir * 16);
      this.goto(ux, T.surf[ux] - 4, true);
      this.gotoFail = false;
      this.marchWp = null;
      return;
    }
    let wp = this.marchWp;
    if (wp == null || Math.abs(wp - this.x) < 8 || Math.sign(wp - this.x) !== dir ||
        Math.abs(wp - this.x) > MARCH_STEP * 2) {
      wp = this.marchWp = clampX(this.x + dir * Math.min(MARCH_STEP, Math.abs(tx - this.x)));
    }
    this.goto(wp, T.surf[wp] - 4, false);
    if (this.gotoFail) {
      this.gotoFail = false;
      this.marchWp = clampX(wp + dir * MARCH_STEP / 2);
    }
  }

  // leaving nest c by its entrance: near the top, but getting no higher for
  // SHAFT_GIVEUP ticks? Then try another way out for a while (see navTo)
  shaftWatch(c) {
    if (Math.abs(this.x - c.entrance.x) > 60 || this.y > c.entrance.y + 80) return;
    if (!(this.y < this.shaftBest - 2) && G.tick - (this.shaftT || 0) < 60) {
      if ((this.shaftN += this.dt) > SHAFT_GIVEUP) { this.shaftSkip = G.tick + SHAFT_GIVEUP * 2; this.shaftN = 0; }
    } else { this.shaftBest = this.y; this.shaftN = 0; }
    this.shaftT = G.tick;
  }

  navTo(key, col) {
    col = col || this.colony;
    const dest = this.navDest(key, col);
    const dd = Math.hypot(dest.x - this.x, dest.y - this.y);
    const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, this.x)));
    // climbing out of another nest by its entrance and getting no higher for
    // a while (the middle of a crater dug out over the nest has nothing to
    // climb): march straight out across it instead, digging up its side
    if (this.shaftSkip > G.tick && this.y > T.surf[sx] + 12) {
      this.nav = null;
      this.march(col.entrance.x, true);
      return dd;
    }
    // down in a different nest than the one we're making for: out by its
    // own tunnels first (a raider going home, or setting out)
    const inNest = this.nestIn();
    if (inNest && inNest !== col) {
      this.shaftWatch(inNest);
      this.navTo('entrance', inNest);
      return dd;
    }
    // out on the forest floor: walk the surface to the entrance (the tunnel
    // map's chain would dig into the first trunk in the way, and its
    // watchdog burrow straight across the map); from far below ground in
    // some side tunnel, dig up to the surface first
    if (!inNest) {
      // down another nest's open entrance shaft: climb out the way it goes
      if (this.y > T.surf[sx] + 12) {
        for (const c of G.colonies) {
          if (c !== col && Math.abs(this.x - c.entrance.x) < 40 && this.y < c.junction.y) {
            this.shaftWatch(c);
            if (!this.nav || this.nav.col !== c || this.nav.key !== 'entrance') this.planNav('entrance', c);
            this.goto(c.entrance.x, c.entrance.y - 8, true);
            return dd;
          }
        }
      }
      const far = Math.abs(col.entrance.x - this.x);
      if (far > MARCH_R || (far > 24 && this.y < T.surf[sx] + 12)) {
        this.nav = null;
        this.march(col.entrance.x);
        return dd;
      }
    }
    if (dd < 24) {
      this.nav = null; this.navBest = 1e9; this.navRescueN = 0;
      this.goto(dest.x, dest.y - 3, true);
      return dd;
    }
    if (!this.nav || this.nav.key !== key || this.nav.col !== col) this.planNav(key, col);

    // journey watchdog: if the whole trip stalls (waypoint ping-pong, bad
    // geometry), burrow bodily along the waypoint chain for a burst.
    // Rescues escalate: a loop the short burst keeps dropping us back into
    // earns a full burrow all the way to the destination -- loops must die.
    const nk = col.idx + key;
    if (this.navBestKey !== nk) { this.navBestKey = nk; this.navBest = dd; this.navStuck = 0; this.navRescueN = 0; }
    if (dd < this.navBest - 1) { this.navBest = dd; this.navStuck = 0; }
    else this.navStuck = (this.navStuck || 0) + this.dt;
    if (this.navStuck > 360) {
      this.navRescueN = (this.navRescueN || 0) + 1;
      this.burrowFull = this.navRescueN >= 3;
      this.burrowT = this.burrowFull ? 600 : 150;
      this.burrowSX = this.x; this.burrowSY = this.y;
      this.navStuck = 0;
    }

    const nav = this.nav;
    // skip waypoints we're already on top of
    while (nav.i < nav.pts.length &&
           dist2(this.x, this.y, nav.pts[nav.i].x, nav.pts[nav.i].y) < 81) {
      nav.i++; nav.best = Infinity; nav.t = 0;
    }
    // chain spent? The destination itself is the final waypoint -- the
    // burrow rescue must keep working on this last leg, or ants stall
    // forever at whatever barrier ate their waypoints
    let wp = nav.pts[nav.i];
    const final = !wp;
    if (final) wp = { x: dest.x, y: dest.y - 1 };
    if (this.burrowT > 0) {
      // squeeze along the waypoint chain, Liero physics be damned.
      // Rock or wood dead ahead: flow around it like water, trying
      // progressively steeper detours before giving up on the waypoint.
      this.burrowT--;
      const len = Math.hypot(wp.x - this.x, wp.y - this.y) || 1;
      const ux0 = (wp.x - this.x) / len, uy0 = (wp.y - this.y) / len;
      let moved = false;
      for (const ang of [0, 0.7, -0.7, 1.4, -1.4]) {
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const ux = ux0 * ca - uy0 * sa, uy = ux0 * sa + uy0 * ca;
        const nx = this.x + ux * 2, ny = this.y + uy * 2;
        if (T.boxSolid(nx, ny, 1.5, 1.5, this.own)) {
          // chew only what's actually in the way (don't erode the nest)
          T.dig(this.x + ux * 3, this.y + uy * 3, Math.max(this.hw, this.hh) + 1, undefined, this.own, SPARE_BUILT);
          this.biteAnim = 6;
          if ((G.tick & 7) === 0) G.fx('dirt', this.x, this.y, 2);
        }
        if (!T.boxSolid(nx, ny, 1.5, 1.5, this.own) && !T.boxHard(nx, ny, this.hw, this.hh)) {
          this.x = nx; this.y = ny;
          moved = true;
          break;
        }
      }
      if (!moved && !final) nav.i++; // walled off every way: next waypoint
      this.vx = 0; this.vy = 0;
      nav.t = 0;
      // let go once we've gone a real distance AND have something to stand
      // on or cling to -- never strand ourselves in mid-air or back where
      // we started. A full-rescue burrow never lets go early.
      if (!this.burrowFull && this.burrowT < 130 &&
          dist2(this.x, this.y, this.burrowSX, this.burrowSY) > 400 &&
          !T.boxSolid(this.x, this.y, this.hw, this.hh, this.own) &&
          (T.boxSolid(this.x, this.y + 2, this.hw, this.hh, this.own) ||
           sideWall(this, 1) || sideWall(this, -1))) {
        this.burrowT = 0;
      }
      return dd;
    }
    const d = this.goto(wp.x, wp.y - 2, true);
    // goto gave up on this waypoint: aim for the next; if this was already
    // the destination leg, replan a fresh chain from where we stand
    if (this.gotoFail) {
      this.gotoFail = false;
      if (final) this.planNav(key, col);
      else { nav.i++; nav.best = Infinity; nav.t = 0; }
      return dd;
    }
    nav.t += this.dt;
    if (d < nav.best - 1) { nav.best = d; nav.t = 0; }
    if (nav.t > 300) this.planNav(key, col); // hopelessly lost: take a fresh look

    return dd;
  }

  // nearest loose food item, skipping ones other ants claimed or gave up on
  findFood(r) {
    let best = null, bd = r * r, mine;
    for (const it of G.items) {
      if (it.dead || it.carried) continue;
      if (it.shunT > G.tick) continue;
      if (it.claimUntil > G.tick && it.claimBy !== this.id) continue;
      const d = dist2(this.x, this.y, it.x, it.y);
      if (d >= bd) continue;
      // food lying down in a nest (a corpse in a side tunnel, a seed that
      // rolled down the shaft) is for the ants already down there
      const nest = buriedInNest(it);
      if (nest && (mine === undefined ? (mine = buriedInNest(this)) : mine) !== nest) continue;
      // food stuck up in trees only tempts ants already close to it
      if (d > 150 * 150 &&
          it.y < T.surf[Math.floor(Math.max(0, Math.min(WORLD_W - 1, it.x)))] - 20) continue;
      bd = d; best = it;
    }
    return best;
  }

  npcThink() {
    const col = this.colony;
    this.vx = 0;
    this.gotoFail = false;
    if (this.followT > 0 && --this.followT <= 0) this.followIdx = -1;

    // threat reaction (winter: nothing out in the frost is worth chasing).
    // Soldiers and raiders take on any foe -- a predator or an ant of another
    // colony; the rest only notice armed ones (two rival foragers pass each
    // other by). A raider hauling its loot home runs instead.
    // (raiders on their way home only defend themselves)
    // (a look around every few ticks, staggered: it scans every ant and bug)
    const homeward = this.state === 'home';
    // (a raid's thieves slip past fights to the stores, like any forager)
    const bold = (this.caste === 'soldier' || (this.raiding && this.raidRole === 'fight' && !this.carry)) && !homeward;
    let pred = !this.every(SCAN_EVERY) ? null : G.nearestFoe(this.x, this.y, bold ? 130 : 70, col, !bold, this.raiding);
    if (pred && (outInCold(pred) || (pred.id === this.shunId && G.tick < this.shunUntil))) pred = null;
    // locked in a fight already, mandibles on the foe: no turning to look
    // at whoever else walks by (see the fight state for who bites back)
    if (pred && this.state === 'fight' && this.target && this.target.hp > 0 && !this.target.dead &&
        dist2(this.x, this.y, this.target.x, this.target.y) < 24 * 24) pred = null;
    // a thief on its way in doesn't stop for the guards: it makes for the stores
    if (pred && this.raiding && this.state === 'raid' && !bold) pred = null;
    if (pred) {
      if (bold || (this.caste === 'queen' &&
          dist2(pred.x, pred.y, col.queenCh.x, col.queenCh.y) <= QUEEN_LEASH * QUEEN_LEASH)) {
        this.state = 'fight'; this.target = pred;
      } else if (this.caste === 'queen') {
        // beyond her chamber: not her fight
      } else if (this.caste === 'princess') {
        // a princess neither fights nor runs off: she keeps to the royal
        // chamber (the idle state walks her back there)
        if (this.state !== 'idle') { this.state = 'idle'; this.stateT = 60; this.target = null; this.nav = null; }
      } else if (this.caste === 'nurse' && this.state !== 'rescue' && G.brood.some(b => b.colony === col) &&
                 underground(pred) &&
                 dist2(pred.x, pred.y, col.nursery.x, col.nursery.y) < 220 * 220) {
        // something is in the tunnels near the nursery: the brood outranks
        // everything -- rally calls included. Flee WITH the babies, not from
        // them. (Surface prowlers don't count; soldiers handle those.)
        this.state = 'rescue';
      } else if (this.rallyT > 0) {
        // a soldier called for help: stand and fight instead of fleeing
        if (this.state !== 'fight' && this.state !== 'rescue') { this.state = 'fight'; this.target = pred; }
      } else if (this.state !== 'flee' && this.state !== 'rescue') {
        this.state = 'flee'; this.stateT = 150;
      }
    }

    // winter: the surface is deadly cold. Foragers stay below, and any
    // caught outside when the frost comes head home
    if (G.isWinter() && (this.state === 'forage' || this.state === 'collect' || this.state === 'milk')) {
      this.state = this.carry ? 'return' : 'shelter';
      this.target = null;
    }

    // nurses mend wounds wherever they stand (slow, costs a little food)
    if (this.caste === 'nurse' && this.every(40) && col.food > 2) {
      for (const o of G.ants) {
        if (o !== this && o.hp > 0 && o.colony === col && o.hp < o.maxHp - 1 &&
            dist2(this.x, this.y, o.x, o.y) < 576) {
          o.hp = Math.min(o.maxHp, o.hp + 1.5);
          col.food -= 0.05;
          G.fx('sparkle', o.x, o.y - 3, 1);
          break;
        }
      }
    }

    switch (this.state) {
      case 'idle': {
        this.stateT -= this.dt;
        // a raider between fights: back to the raid (or home, if it's over)
        if (this.raiding) {
          this.state = col.raid && col.raid.phase === 'march' ? 'raid' : 'home';
          break;
        }
        // a princess waits out her time in the royal chamber
        if (this.caste === 'princess' &&
            dist2(this.x, this.y, col.queenCh.x, col.queenCh.y) > 26 * 26) {
          this.navTo('queen');
          break;
        }
        // don't pile up: drift away when too many ants crowd one spot,
        // and crowded workers cut their break short -- a clump of idlers
        // means the colony has hands to spare
        if (this.caste !== 'queen' && this.caste !== 'princess' && this.every(25)) {
          let crowd = 0, cxSum = 0;
          for (const o of G.ants) {
            if (o !== this && o.hp > 0 &&
                Math.abs(o.x - this.x) < 20 && Math.abs(o.y - this.y) < 14) {
              crowd++; cxSum += o.x;
            }
          }
          if (crowd >= 3) {
            this.disperseT = 40 + (this.id * 13) % 60;
            this.disperseDir = (this.x - cxSum / crowd) >= 0 ? 1 : -1;
            if (this.caste === 'worker') this.stateT = Math.min(this.stateT, 40);
          }
        }
        if (this.disperseT > 0) {
          this.disperseT -= this.dt;
          this.vx = this.disperseDir * this.def.speed * 0.85;
          this.dir = this.disperseDir;
        } else if (Math.random() < 0.01 * this.dt) {
          // amble around current spot (a one-tick nudge: a far ant keeps
          // its speed for dt ticks, so it nudges 1/dt as fast)
          this.vx = (Math.random() < 0.5 ? -1 : 1) * this.def.speed * 0.6 / this.dt;
        }
        // hungry colony: no loitering (unless it's winter: nothing out there)
        if (col.food < 25 && this.caste === 'worker' && !G.isWinter()) this.stateT = 0;
        if (this.stateT <= 0) {
          if (this.caste === 'worker') {
            if (G.isWinter()) {
              this.stateT = 300 + Math.random() * 300; // huddle in the warm nest
            } else {
              this.state = 'forage';
              this.target = { x: col.entrance.x, y: col.entrance.y - 6 };
            }
          } else if (this.caste === 'nurse') {
            this.state = 'tend'; this.stateT = 400;
          } else if (this.caste === 'soldier') {
            this.state = 'patrol'; this.stateT = 600;
          } else if (this.caste === 'queen' || this.caste === 'princess') {
            this.stateT = 200;
            // queen stays put, shifts her bulk now and then
            if (Math.abs(this.x - col.queenCh.x) > 18) this.goto(col.queenCh.x, col.queenCh.y, true);
          }
        }
        break;
      }

      case 'forage': {
        // already loaded (interrupted return): bring it home first
        if (this.carry) { this.state = 'return'; break; }
        // head for the surface first, then wander and look for food
        if (this.y > T.surf[Math.floor(this.x)] + 12) {
          this.navTo('entrance');
        } else {
          if (!this.target || this.target.gotoSurface || Math.abs(this.x - this.target.x) < 10) {
            const cs = G.contested;
            if (cs && cs.active && Math.random() < SITE_GO) {
              // the fallen fruit out between the nests: a long trek, but rich
              this.target = { x: cs.x + (Math.random() - 0.5) * 30, y: 0, far: true };
            } else {
              this.target = {
                x: Math.max(20, Math.min(WORLD_W - 20, col.x + (Math.random() - 0.5) * 1800)),
                y: 0
              };
            }
          }
          if (this.target.far) this.march(this.target.x);
          else this.goto(this.target.x, T.surf[Math.floor(Math.max(0, Math.min(WORLD_W - 1, this.target.x)))] - 4, false);
          if (this.gotoFail) { this.gotoFail = false; this.target = null; break; }
          // smell food?
          const it = this.findFood(600);
          if (it) {
            it.claimUntil = G.tick + 600; it.claimBy = this.id;
            this.state = 'collect'; this.target = it;
            break;
          }
          // a milkable aphid up a tree is food too
          if (this.every(30)) {
            for (const b of G.bugs) {
              if (b.kind === 'aphid' && !b.dead && b.milkCd <= 0 &&
                  !(b.claimUntil > G.tick) && !(b.shunT > G.tick) &&
                  dist2(this.x, this.y, b.x, b.y) < 150 * 150) {
                b.claimUntil = G.tick + 900; b.claimBy = this.id;
                this.state = 'milk'; this.target = b;
                break;
              }
            }
            if (this.state !== 'forage') break;
          }
          // homesick after a while (not on the long trek to the fruit)
          if (!this.target.far && Math.random() < 0.0008 * this.dt) { this.state = 'return'; }
        }
        break;
      }

      case 'collect': {
        if (this.carry) { this.state = 'return'; this.target = null; break; }
        const it = this.target;
        if (!it || it.carried || it.dead) { this.state = 'forage'; this.target = null; break; }
        it.claimUntil = G.tick + 600; it.claimBy = this.id;
        // (food lying down in a nest is only fetched from inside it, see
        // findFood. One that fell down a shaft on its way to surface food
        // climbs out by the nest's own tunnels, not up through the mound --
        // that dug the nests' mounds into craters)
        const nest = buriedInNest(it);
        const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, this.x)));
        let outOf = !nest && this.y > T.surf[sx] + 2 ? moundOf(this) : null;
        // (once climbing out, it sees it through: the mouth's edge, where the
        // surface line dips into the shaft, is no place to dither)
        if (outOf) this.outT = 60;
        else if (this.outT > 0 && (this.outT -= this.dt) > 0 && !nest) outOf = moundOf(this);
        let d;
        if (outOf) {
          // up the nest's tunnels; near the top, out beside the mouth on the
          // food's side, not over the hole. Down in an open pit or a crater
          // on the mound (under the sky, out of the narrow shaft) it climbs
          // straight out over the rim on the food's side instead: sent back
          // to the mouth, which hangs in the crater's air, it fell back in,
          // and round again -- whole colonies paced a crater for good
          const e = outOf.entrance, top = this.y < e.y + 24 && Math.abs(this.x - e.x) < 18;
          const down = !top && (roofed(this) ||
            (Math.abs(this.x - e.x) < 14 && wallNear(this, 1, 6) && wallNear(this, -1, 6)));
          if (down) {
            this.navTo('entrance', outOf);
          } else {
            const from = top ? e.x : this.x;
            const side = Math.sign(it.x - from) || 1;
            let tx = rimX(from, side);
            if (tx === null || (top && (tx - e.x) * side < 15)) {
              tx = Math.round(Math.max(10, Math.min(WORLD_W - 10, from + side * 15)));
            }
            this.goto(tx, T.surf[tx] - 4, top);
            if (Math.abs(this.x - tx) < 4) this.outT = 0;
          }
          this.gotoFail = false;
          d = Math.hypot(it.x - this.x, it.y - this.y);
        } else {
          // on a nest's mound an ant walks and climbs to the food like a
          // forager does, digging only for food lying in the earth (out in
          // the forest it still chews through foliage and roots on its way)
          d = this.goto(it.x, it.y, !!nest || nestDeep(this) || !onMound(this) || T.boxSolid(it.x, it.y, 1, 1));
          // (food beyond an open shaft mouth: hop it rather than fall in)
          for (const c of G.colonies) {
            const ex = c.entrance.x;
            if (this.onGround && !nest && Math.abs(this.x - ex) < 9 && Math.abs(this.y - c.entrance.y) < 12 &&
                Math.sign(ex - this.x) === Math.sign(it.x - this.x) && Math.abs(it.x - ex) > 6) this.vy = -1.9;
          }
        }
        if (this.gotoFail) {
          this.gotoFail = false;
          it.shunT = G.tick + 1800; // out of reach: leave it be a while
          it.shunN = (it.shunN || 0) + 1;
          if (it.shunN >= 3) it.dead = true; // lost in the brambles for good
          this.state = 'forage'; this.target = null;
          break;
        }
        if (d < 8) {
          it.carried = this;
          this.carry = it;
          this.state = 'return';
          G.sfx('pickup', this.x, this.y, 200);
        }
        break;
      }

      case 'milk': {
        const b = this.target;
        if (!b || b.dead || b.kind !== 'aphid' || b.milkCd > 0 || this.carry) {
          this.state = 'forage'; this.target = null; break;
        }
        b.claimUntil = G.tick + 600; b.claimBy = this.id;
        const d = this.goto(b.x, b.y, true);
        if (this.gotoFail) {
          this.gotoFail = false;
          b.shunT = G.tick + 1800; // can't get up there: try elsewhere
          this.state = 'forage'; this.target = null;
          break;
        }
        if (d < 9) {
          b.milkCd = 1800;
          const hd = G.makeItem('honeydew', this.x, this.y);
          hd.carried = this; this.carry = hd;
          G.items.push(hd);
          this.state = 'return';
          G.sfx('milk', this.x, this.y, 220);
        }
        break;
      }

      case 'return': {
        const d = this.navTo('storage');
        if (d < 26) {
          if (this.carry && !col.deposit(this.carry, this)) {
            // stores are full: hold on to the load and wait for room
            this.state = 'idle'; this.stateT = 400 + Math.random() * 400;
            break;
          }
          this.carry = null;
          // a raider home with its loot: its raid is done
          if (this.raiding) this.endRaid();
          // short, staggered breather so returners don't pool at the cache
          this.state = 'idle'; this.stateT = 60 + Math.random() * 180;
        }
        // drop pheromone handled in main loop (carrying ants)
        break;
      }

      case 'raid': {
        // out against another colony (see Colony.startRaid)
        const r = col.raid;
        const enemy = r ? G.colonies[r.target] : null;
        if (!enemy || r.phase !== 'march') { this.state = 'home'; break; }
        // the party gathers short of their nest, then goes in together
        // (the thieves a little behind the fighters: in while the guards
        // are busy with them)
        const ex = Math.abs(this.x - enemy.x);
        const wait = !r.massed || (this.raidRole === 'steal' && r.t - (r.massedT || 0) < RAID_THIEF_LAG);
        if (wait && !this.carry && ex < RAID_MUSTER && ex > RAID_MUSTER / 2) {
          this.climbing = false;
          break;
        }
        // on the way: a raider that stops getting any closer (wedged, lost
        // in a crater) drops out of the raid and is just an ant again
        if (ex > 200 && !this.carry) {
          if (this.raidBest === undefined || ex < this.raidBest - 4) { this.raidBest = ex; this.raidStallT = 0; }
          else if (++this.raidStallT > RAID_ANT_STALL) {
            this.raiding = false; this.raidRole = null;
            this.state = 'idle'; this.stateT = 60; this.nav = null; this.target = null;
            break;
          }
        }
        if (this.raidRole === 'steal') {
          // into their stores, and away with what we can carry
          if (this.carry) { this.state = 'return'; break; }
          const d = this.navTo('storage', enemy);
          if (d < 26) {
            if (col.steal(this, enemy)) this.state = 'return';
            else this.raidRole = 'fight';   // the stores are bare: fight instead
          }
        } else {
          // take the fight into their nest: down to the junction, then
          // prowl between it and the stores
          const d = this.navTo(this.patrolI % 2 ? 'storage' : 'junction', enemy);
          if (d < 20) this.patrolI++;
        }
        break;
      }

      case 'home': {
        // the raid is over: back down into our own nest
        if (this.carry && ITEM_DEF[this.carry.kind]) { this.state = 'return'; break; }
        const d = this.navTo('junction');
        if (d < 24) {
          this.endRaid();
          this.state = 'idle'; this.stateT = 120;
        }
        break;
      }

      case 'shelter': {
        // caught on the surface by winter: back down into the warm nest
        this.navTo('junction');
        const ssx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, this.x)));
        if (this.y > T.bgSurf[ssx] + 30) { this.state = 'idle'; this.stateT = 200; }
        break;
      }

      case 'flee': {
        this.stateT -= this.dt;
        // (fleeing across the winter surface: make for the nest instead)
        if (outInCold(this)) { this.state = 'shelter'; break; }
        const p = G.nearestFoe(this.x, this.y, 160, col, true);
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
        // a princess never fights: back to the royal chamber
        if (this.caste === 'princess') { this.state = 'idle'; this.stateT = 60; this.target = null; break; }
        let p =(this.target && this.target.hp > 0 && !this.target.dead) ? this.target
              : G.nearestFoe(this.x, this.y, 200, col, false, this.raiding);
        // bitten while chasing someone else: turn on whoever is biting, or
        // on an armed foe right at our side -- never chase a fleeing thief
        // while a soldier chews on us from behind
        if (p && this.chooseT !== G.tick >> 3) {
          this.chooseT = G.tick >> 3;
          const pd = dist2(p.x, p.y, this.x, this.y);
          const h = this.hitBy;
          if (h && h !== p && G.tick - this.hitT < 90 && !(h.hp <= 0 || h.dead) &&
              h.colony !== col && !(this.raiding && h.caste === 'queen') &&
              dist2(h.x, h.y, this.x, this.y) < Math.min(pd, 24 * 24)) {
            p = h;
          } else if (pd > 15 * 15) {
            const near = G.nearestFoe(this.x, this.y, 15, col, true, this.raiding);
            if (near) p = near;
          }
        }
        // a raider leaves the enemy's queen be (she's the players' to defend,
        // and an idle colony shouldn't fall to one raid)
        if (p && this.raiding && p.caste === 'queen') p = null;
        // a foe that got far away (fled, or wandered across the map) isn't
        // worth a march: without this leash rallied ants chased a centipede
        // a thousand pixels off and wedged themselves in a tree on the way
        if (p && dist2(p.x, p.y, this.x, this.y) > FIGHT_LEASH * FIGHT_LEASH) p = null;
        // the queen defends her chamber, but never chases a foe out of it:
        // losing her to a beetle up a tunnel ends the colony
        if (p && this.caste === 'queen' &&
            dist2(p.x, p.y, col.queenCh.x, col.queenCh.y) > QUEEN_LEASH * QUEEN_LEASH) p = null;
        // winter: break off a chase out into the cold and get back below
        if (p && outInCold(p)) {
          p = null;
          if (outInCold(this)) { this.state = 'shelter'; this.target = null; this.rallyT = 0; break; }
        }
        // a foe it can't get its mandibles on for long (up a tree, behind
        // rock): leave it be for a while
        if (p && p === this.target && ++this.fightT > FIGHT_GIVEUP) {
          this.shunId = p.id; this.shunUntil = G.tick + 900;
          p = null;
        }
        if (!p) {
          this.state = this.raiding ? 'raid' : this.followT > 0 ? 'follow' : this.caste === 'soldier' ? 'patrol' : 'idle';
          this.stateT = 200; this.target = null; this.fightT = 0;
          break;
        }
        if (p !== this.target) this.fightT = 0;
        this.target = p;
        // deep in the nest with a faraway target: take the tunnels out first
        const fsx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, this.x)));
        if (this.y > T.surf[fsx] + 40 && dist2(this.x, this.y, p.x, p.y) > 10000) {
          this.navTo('entrance', this.nestIn() || col);
          break;
        }
        // a tree trunk between us: round it the marching way (under the roots)
        const lo = Math.min(this.x, p.x) + 2, hi = Math.max(this.x, p.x) - 2;
        const trunk = G.trees.find(t => t.x > lo && t.x < hi && Math.abs(t.x - this.x) < 60);
        const d = trunk ? (this.march(p.x), Math.hypot(p.x - this.x, p.y - this.y)) : this.goto(p.x, p.y, true);
        if (d < 11 && this.biteCd <= 0) {
          p.hurt(this.dmgNow(), Math.sign(p.x - this.x) * 0.8, -0.3, this);
          this.fightT = 0;
          this.biteCd = 40;
          this.biteAnim = 8;
          G.sfx('bite', this.x, this.y, 220);
        }
        break;
      }

      case 'patrol': {
        this.stateT -= this.dt;
        if (this.followT > 0) { this.state = 'follow'; break; }
        // anything hunting near the colony is the soldiers' problem
        const threat = colonyThreat(col);
        if (threat) {
          this.state = 'fight'; this.target = threat;
          // sound the alarm: nearby ants rally to the soldier's side
          if (this.abilCd <= 0) {
            const n = rallyAllies(this, 150, threat);
            if (n > 0) {
              this.abilCd = 900;
              if (col.player && G.nearPlayer(this.x, this.y, col) < 260) {
                col.say('m_alarm', [], '#ff8040');
                col.sfx('danger');
              }
            }
          }
          break;
        }
        // (in winter the rounds skip the frozen entrance)
        const keys = G.isWinter() ? ['junction', 'storage', 'nursery', 'queen']
          : ['entrance', 'junction', 'storage', 'nursery', 'queen'];
        const d = this.navTo(keys[this.patrolI % keys.length]);
        if (d < 18) this.patrolI++;
        if (this.stateT <= 0) { this.state = 'idle'; this.stateT = 150; }
        break;
      }

      case 'follow': {
        // a player soldier's escort: keep at its side, through the forest
        // and down into nests (fights on the way are the threat scan's)
        const p = G.players[this.followIdx];
        const lead = p && p.ant && p.ant.hp > 0 && p.ant.colony === col ? p.ant : null;
        if (!lead || this.followT <= 0) {
          this.followT = 0; this.followIdx = -1;
          this.state = 'patrol'; this.stateT = 300; this.nav = null;
          break;
        }
        // (not out into the winter cold after it)
        if (outInCold(lead) || outInCold(this)) {
          if (outInCold(this)) { this.state = 'shelter'; this.followT = 0; this.followIdx = -1; }
          break;
        }
        const d = Math.hypot(lead.x - this.x, lead.y - this.y);
        // at heel (standing still on purpose: not the freeze detector's
        // business, which would dig it loose into the mound)
        if (d < 18) { this.climbing = false; this.freezeT = 0; break; }
        const leadIn = buriedInNest(lead), myIn = buriedInNest(this);
        if (d < 120 && leadIn === myIn) {
          // close: straight to it, a step behind (each escort its own spot);
          // in the same nest or out in the open, but no digging through a
          // mound from above (the erosion collect avoids too)
          this.goto(lead.x - lead.dir * (8 + (this.id % 4) * 4), lead.y, !!myIn || !onMound(this));
        } else if (leadIn && leadIn !== myIn) {
          // it went down into a nest: in by that nest's tunnels
          this.navTo('junction', leadIn);
        } else if (myIn && myIn !== leadIn) {
          this.navTo('entrance', myIn);     // out of this one first
        } else if (leadIn) {
          this.navTo(dist2(lead.x, lead.y, leadIn.queenCh.x, leadIn.queenCh.y) <
            dist2(lead.x, lead.y, leadIn.storage.x, leadIn.storage.y) ? 'queen' : 'storage', leadIn);
        } else {
          this.march(lead.x);
        }
        this.gotoFail = false;
        break;
      }

      case 'tend': {
        this.stateT -= this.dt;
        // danger near the nursery: haul the brood to the queen's chamber
        if (this.carry && (this.carry.kind === 'egg' || this.carry.kind === 'larva')) {
          this.state = 'rescue'; break;
        }
        const tendDanger = col.nurseryFoe(180);
        if (tendDanger && underground(tendDanger) && G.brood.some(b => b.colony === col)) {
          this.state = 'rescue'; break;
        }
        // find a hungry larva, fetch a morsel from stores, feed it
        const larva = G.brood.find(b => b.kind === 'larva' && b.hungry && !b.claimed && b.colony === col);
        if (larva && !this.carry && col.food >= 3) {
          const d = this.navTo('storage');
          if (d < 24) {
            col.food -= 2;
            this.carry = G.makeItem('morsel', this.x, this.y);
            this.carry.carried = this;
            G.items.push(this.carry);
            larva.claimed = this.id;
          }
        } else if (this.carry) {
          const l = G.brood.find(b => b.kind === 'larva' && b.claimed === this.id) ||
                    G.brood.find(b => b.kind === 'larva' && b.hungry && b.colony === col);
          if (!l) { // nobody hungry: put it back
            const d = this.navTo('storage');
            if (d < 24) { col.food += 2; this.carry.dead = true; this.carry = null; }
          } else if (dist2(this.x, this.y, l.x, l.y) < 3600) {
            const d = this.goto(l.x, l.y, true);
            if (d < 9) {
              l.feed();
              this.carry.dead = true; this.carry = null;
              G.sfx('milk', this.x, this.y, 200);
            }
          } else {
            // the larva lies elsewhere -- often by the queen, where she laid
            // it (or where a rescue left it): head for the nearer chamber
            const byQueen = dist2(l.x, l.y, col.queenCh.x, col.queenCh.y) <
                            dist2(l.x, l.y, col.nursery.x, col.nursery.y);
            this.navTo(byQueen ? 'queen' : 'nursery');
          }
        } else {
          // hang around the nursery (standing about on purpose: not the
          // freeze detector's business -- it dug a nurse's spot out from
          // under her every 12 s, sinking the nursery floor 30 px a day)
          if (Math.abs(this.x - col.nursery.x) > 20) this.navTo('nursery');
          else {
            this.freezeT = 0;
            if (Math.random() < 0.01 * this.dt) this.vx = (Math.random() < 0.5 ? -1 : 1) * 0.3 / this.dt;
          }
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.stateT = 150; }
        break;
      }

      case 'rescue': {
        // ferry eggs and larvae out of a threatened nursery, deep to the queen
        let danger = col.nurseryFoe(220);
        if (danger && !underground(danger)) danger = null;
        if (this.carry && (this.carry.kind === 'egg' || this.carry.kind === 'larva')) {
          const d = this.navTo('queen');
          if (d < 22) {
            const b = this.carry;
            b.carried = null; this.carry = null;
            b.x = this.x; b.y = this.y; b.vx = 0; b.vy = 0;
            b.safeT = G.tick + 3600; // delivered: don't ferry it again for a while
          }
        } else if (danger) {
          const b = G.brood.find(b => !b.dead && !b.carried && b.colony === col &&
            !(b.safeT > G.tick) &&
            dist2(b.x, b.y, col.queenCh.x, col.queenCh.y) > 70 * 70 &&
            dist2(b.x, b.y, col.nursery.x, col.nursery.y) < 150 * 150);
          if (!b) { this.state = 'tend'; this.stateT = 300; break; }
          const d = this.goto(b.x, b.y, true);
          if (this.gotoFail) {
            this.gotoFail = false;
            this.state = 'tend'; this.stateT = 200;
            break;
          }
          if (d < 8 && !b.carried) { b.carried = this; this.carry = b; }
        } else {
          this.state = 'tend'; this.stateT = 300;
        }
        break;
      }
    }
  }

  // back from a raid (home, or with the loot delivered)
  endRaid() {
    this.raiding = false;
    this.raidRole = null;
    if (this.colony.raid) this.colony.raid.home++;
  }

  draw(ctx, camx, camy) {
    const c = this.def;
    const ex = Math.round(this.x - camx), ey = Math.round(this.y - camy);
    if (ex < -16 || ex > 336 || ey < -16 || ey > 216) return;
    const s = c.size;
    ctx.save();
    ctx.translate(ex, ey);
    if (this.climbing) ctx.rotate(-this.dir * Math.PI / 2 * 0.85);
    ctx.scale(this.dir * s, this.ceiling ? -s : s); // upside-down on ceilings

    const red = this.colony && this.colony.faction === 'red';
    const rgb = red ? RED_COLOR[this.caste] : c.color;
    const col = this.flash > 0 ? '#ffffff'
      : `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    const dark = this.flash > 0 ? '#ffffff'
      : `rgb(${rgb[0] * 0.55 | 0},${rgb[1] * 0.55 | 0},${rgb[2] * 0.55 | 0})`;

    const legUp = (Math.sin(this.phase) > 0) ? 1 : 0;
    ctx.fillStyle = red || this.flash > 0 ? dark : BLACK_LEG;
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
    } else if (this.caste === 'princess') { // gaster + a pair of folded wings
      ctx.fillRect(-8, -2, 2, 4);
      ctx.fillStyle = 'rgba(230,236,255,0.7)';
      ctx.fillRect(-7, -5, 7, 2);
      ctx.fillRect(-5, -6, 4, 1);
    }
    // the red ants' gloss on gaster and head: they read as foes in the dark;
    // the black ants' cool rim light and gloss keep them from vanishing in it
    if (red && this.flash <= 0) {
      ctx.fillStyle = RED_SHINE;
      ctx.fillRect(-6, -2, 2, 1);
      ctx.fillRect(2, -2, 1, 1);
    } else if (this.flash <= 0) {
      ctx.fillStyle = BLACK_RIM;
      ctx.fillRect(-6, -2, 4, 1);
      ctx.fillRect(1, -2, 3, 1);
      ctx.fillStyle = BLACK_SHINE;
      ctx.fillRect(-5, -2, 1, 1);
      ctx.fillRect(2, -2, 1, 1);
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

    // player marker: a bobbing chevron, dark-rimmed (so it reads apart from
    // the seeds and honeydew on other ants' backs)
    if (this.playerIdx >= 0) {
      const ty = ey - Math.round(this.hh) - 6 - (G.tick >> 4) % 2;   // the tip
      ctx.fillStyle = '#100804';
      for (let i = 0; i < 4; i++) ctx.fillRect(ex - i - 1, ty - i - 1, 2 * i + 3, 2);
      ctx.fillStyle = playerColor(this.playerIdx);
      for (let i = 0; i < 3; i++) ctx.fillRect(ex - i, ty - i, 2 * i + 1, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Brood: eggs and larvae
// ---------------------------------------------------------------------------
class Brood {
  constructor(x, y, kind, colony) {
    this.id = ENT_ID++;
    this.kind = kind; // 'egg' | 'larva'
    this.colony = colony || G.colony;
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
    this.carried = null;  // a nurse (or player) hauling it to safety
    this.royal = false;   // a princess egg/larva: bigger, hungrier, slower
  }

  hurt(dmg) {
    this.hp -= dmg;
    G.fx('blood', this.x, this.y, 3);
  }

  feed() {
    this.feedCount++;
    this.hungry = false;
    this.claimed = 0;
    this.hungerT = 1500 + Math.random() * 1200;
  }

  update() {
    // a warm thatched mound speeds every egg and larva along
    this.age += this.colony ? this.colony.broodBoost : 1;
    this.phase += 0.05;
    if (this.carried) {
      // ride on the carrier's back
      const c = this.carried;
      if (c.hp <= 0 || c.carry !== this) {
        this.carried = null;  // carrier died or let go
      } else {
        this.x = c.x - c.dir * 2;
        this.y = c.y - 5 * (c.def ? c.def.size : 1);
      }
    } else {
      physStep(this);
    }
    if (this.kind === 'egg') {
      if (this.age > 3600) {  // ~60s
        this.kind = 'larva';
        this.age = 0;
        G.sfx('hatch', this.x, this.y, 240);
      }
    } else {
      this.hungerT--;
      if (this.hungerT <= 0 && !this.hungry) { this.hungry = true; this.claimed = 0; }
      if (this.hungry && this.hungerT < -3600) this.hp -= 0.004; // starves slowly
      // grown up? (a princess needs more feeding and more time)
      if (this.feedCount >= (this.royal ? 5 : 3) && this.age > (this.royal ? 7200 : 5400)) {
        this.dead = true;
        if (this.carried) {  // emerged mid-carry: hop off the carrier's back
          if (this.carried.carry === this) this.carried.carry = null;
          this.carried = null;
        }
        this.colony.spawnAdult(this.x, this.y, this.royal ? 'princess' : null);
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
      ctx.fillStyle = this.royal ? '#f4dce4' : '#efe9d8';
      ctx.fillRect(ex - 1, ey - 2, 2, 3);
      if (this.royal) ctx.fillRect(ex - 2, ey - 1, 4, 2);
      ctx.fillStyle = this.royal ? '#d8b0c0' : '#cfc8b0';
      ctx.fillRect(ex - 1, ey, 2, 1);
    } else {
      const w = Math.sin(this.phase * 4) > 0 ? 1 : 0;
      ctx.fillStyle = this.royal ? '#f0d4dc' : '#e8dfc0';
      ctx.fillRect(ex - 2 + w, ey - 1, 4, 2);
      ctx.fillRect(ex - 1 + w, ey - 2, 3, 1);
      if (this.royal) ctx.fillRect(ex - 3 + w, ey - 1, 6, 2); // a fat royal grub
      ctx.fillStyle = this.royal ? '#c898a8' : '#c8bd96';
      ctx.fillRect(ex - 1 + w, ey, 1, 1);
      ctx.fillRect(ex + 1 + w, ey, 1, 1);
      if (this.hungry && (G.tick >> 4) % 2) {
        drawText(ctx, '!', ex - 2, ey - 11, '#ff5050');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Bugs: aphid, pillbug, worm, spider, centipede, wasp, beetle
// ---------------------------------------------------------------------------
const BUG_DEF = {
  aphid:     { hp: 5,   speed: 0.1,  dmg: 0,  corpse: 4 },
  pillbug:   { hp: 14,  speed: 0.25, dmg: 0,  corpse: 8 },
  worm:      { hp: 15,  speed: 0.18, dmg: 0,  corpse: 12 },
  spider:    { hp: 60,  speed: 0.55, dmg: 7,  corpse: 22 },
  centipede: { hp: 80,  speed: 0.32, dmg: 9,  corpse: 28 },
  wasp:      { hp: 35,  speed: 0.85, dmg: 5,  corpse: 14 },
  beetle:    { hp: 140, speed: 0.22, dmg: 12, corpse: 32 },
};

class Bug {
  constructor(x, y, kind) {
    this.id = ENT_ID++;
    this.kind = kind;
    const d = BUG_DEF[kind];
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.hp = d.hp; this.maxHp = d.hp;
    this.hw = (kind === 'spider' || kind === 'beetle') ? 5 : kind === 'wasp' ? 4 : 3;
    this.hh = (kind === 'spider' || kind === 'beetle') ? 3 : 2;
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
    this.swoopT = 0;     // wasp hit-and-run timer
    this.digT = 0;       // beetle bulldozing cooldown
    this.turnT = 0;      // beetle: committed to walking away from a tree
    this.digWait = 0;    // gnawing packed earth: pause between bites
  }

  get predator() {
    return this.kind === 'spider' || this.kind === 'centipede' ||
           this.kind === 'wasp' || this.kind === 'beetle';
  }

  hurt(dmg, kx, ky) {
    if (this.kind === 'pillbug' && this.curl > 0) dmg *= 0.35;
    this.hp -= dmg;
    this.hitT = G.tick;   // (the client shows a bitten bug's health a while)
    this.flash = 6;
    this.vx += kx || 0; this.vy += (ky || 0) - 0.4;
    G.fx('blood', this.x, this.y, 4);
    if (this.kind === 'pillbug') this.curl = 180;
    if (this.kind === 'aphid' || this.kind === 'worm') this.fleeing = true;
    if (this.predator && this.hp < this.maxHp * 0.25) this.fleeing = true;
    G.sfx('hurt', this.x, this.y, 220);
  }

  update() {
    if (this.flash > 0) this.flash--;
    if (this.biteCd > 0) this.biteCd--;
    if (this.milkCd > 0) this.milkCd--;
    if (this.curl > 0) this.curl--;
    this.phase += Math.abs(this.vx) * 0.7 + 0.05;

    if (this.swoopT > 0) this.swoopT--;
    if (this.digT > 0) this.digT--;
    if (this.digWait > 0) this.digWait--;
    if (this.turnT > 0) this.turnT--;

    // predator freeze-shake: anything pinned in one spot for ~10s either
    // slips away (if already leaving) or shakes itself free
    if (this.predator && this.kind !== 'centipede') {
      if (!this.fzP || Math.abs(this.x - this.fzP.x) > 5 || Math.abs(this.y - this.fzP.y) > 12) {
        this.fzP = { x: this.x, y: this.y };
        this.fzT = 0;
      } else if (++this.fzT > 600) {
        this.fzT = 0;
        if (this.fleeing) {
          this.dead = true; // slips away into the undergrowth
        } else {
          this.dir = -this.dir;
          this.climbing = false;
          T.dig(this.x, this.y + 3, Math.max(this.hw, this.hh) + 2);
        }
      }
    }

    switch (this.kind) {
      case 'aphid':     this.aphidThink(); break;
      case 'pillbug':   this.pillbugThink(); break;
      case 'worm':      this.diggerThink(2.5, 0.012); break;
      case 'centipede': this.centipedeThink(); break;
      case 'spider':    this.spiderThink(); break;
      case 'wasp':      this.waspThink(); break;
      case 'beetle':    this.beetleThink(); break;

    }

    // walkers wedged in terrain thrash themselves loose; if the prison is
    // wood or rock (chewing won't help), squirm to open air or perish
    if (this.kind !== 'worm' && this.kind !== 'centipede' &&
        this.flash === 0 && T.boxSolid(this.x, this.y, this.hw, this.hh)) {
      T.dig(this.x, this.y, Math.max(this.hw, this.hh) + 2.5);
      if (T.boxSolid(this.x, this.y, this.hw, this.hh)) {
        this.embT = (this.embT || 0) + 1;
        if (this.embT > 180) {
          this.embT = 0;
          let freed = false;
          outer: for (let r = 4; r <= 24; r += 4) {
            for (const o of [[0, -r], [r, 0], [-r, 0], [0, r], [r, -r], [-r, -r]]) {
              if (!T.boxSolid(this.x + o[0], this.y + o[1], this.hw, this.hh)) {
                this.x += o[0]; this.y += o[1];
                freed = true;
                break outer;
              }
            }
          }
          if (!freed) this.dead = true;
        }
      } else {
        this.embT = 0;
      }
    }

    if (this.kind === 'worm' || this.kind === 'centipede') {
      // segment trail
      const last = this.trail[0];
      if (!last || dist2(last.x, last.y, this.x, this.y) > 9) {
        this.trail.unshift({ x: this.x, y: this.y });
        if (this.trail.length > (this.kind === 'centipede' ? 9 : 5)) this.trail.pop();
      }
    } else if (this.kind !== 'wasp') { // wasps fly: they integrate themselves
      physStep(this);
      if (this.climbing && !sideWall(this, this.dir)) {
        this.climbing = false; this.vy = -1.0; this.vx = this.dir * 0.5;
      }
    }
  }

  // a burrowing bite for the bugs that dig every step. Packed earth only
  // wears down, so after a bite that hit it the bug pauses like a biting
  // ant would: walls slow it in proportion to their toughness. Returns true
  // when the way ahead (nx, ny) is open.
  gnaw(nx, ny, r) {
    if (this.digWait > 0) return false;
    const res = T.dig(nx, ny, r);
    if (res.worn > 0) {
      this.digWait = 14;
      return !T.boxSolid(nx, ny, this.hw, this.hh);
    }
    return true;
  }

  aphidThink() {
    // cling to whatever it sits on; tiny crawls
    this.vx = 0;
    if (this.fleeing) { this.vx = this.dir * 0.3; if (Math.random() < 0.02) this.fleeing = false; }
    else if (Math.random() < 0.004) { this.dir = -this.dir; this.vx = this.dir * 0.1; }
    // drip honeydew once in a while (not in winter; and not onto a puddle
    // of drops nobody has come for)
    if (Math.random() < 0.0004 && !G.isWinter() &&
        G.items.filter(i => i.kind === 'honeydew' && dist2(i.x, i.y, this.x, this.y) < 1600).length < 3) {
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
        if (!this.gnaw(nx, ny, digR + 1)) return;
      } else {
        this.angle += Math.PI * (0.5 + Math.random() * 0.5);
        // hemmed in by rock on every side: turning forever won't help.
        // Squirm to the nearest opening, or slip away for good.
        this.rockN = (this.rockN || 0) + 1;
        if (this.rockN > 90) {
          this.rockN = 0;
          let freed = false;
          outer: for (let r = 4; r <= 28; r += 4) {
            for (const o of [[r, 0], [-r, 0], [0, -r], [0, r], [r, r], [-r, r], [r, -r], [-r, -r]]) {
              if (!T.boxSolid(this.x + o[0], this.y + o[1], this.hw, this.hh)) {
                this.x += o[0]; this.y += o[1];
                freed = true;
                break outer;
              }
            }
          }
          if (!freed) this.dead = true;
        }
        return;
      }
    }
    this.rockN = 0;
    this.x = nx; this.y = ny;
    this.dir = Math.cos(this.angle) >= 0 ? 1 : -1;
  }

  centipedeThink() {
    const d = BUG_DEF.centipede;
    if (this.huntCd > 0) this.huntCd--;
    const prey = (this.fleeing || this.huntCd > 0) ? null
               : G.nearestAnt(this.x, this.y, 90, true);
    if (prey) {
      const ang = Math.atan2(prey.y - this.y, prey.x - this.x);
      this.angle = ang;
      const nx = this.x + Math.cos(ang) * d.speed * 1.5;
      const ny = this.y + Math.sin(ang) * d.speed * 1.5;
      if (T.boxSolid(nx, ny, this.hw, this.hh)) {
        if (T.digHasTarget(nx, ny, 4)) {
          this.rockN = 0;
          if (!this.gnaw(nx, ny, 4)) return;
        } else {
          this.angle += 1.5;
          // prey on the far side of bedrock: stop circling at the wall
          // and go back to wandering for a while
          this.rockN = (this.rockN || 0) + 1;
          if (this.rockN > 90) { this.rockN = 0; this.huntCd = 300; }
          return;
        }
      } else {
        this.rockN = 0;
      }
      this.x = nx; this.y = ny;
      this.dir = Math.cos(ang) >= 0 ? 1 : -1;
      if (dist2(this.x, this.y, prey.x, prey.y) < 100 && this.biteCd <= 0) {
        prey.hurt(d.dmg, Math.sign(prey.x - this.x), -0.5, this);
        this.biteCd = 55;
        G.sfx('bite', this.x, this.y, 240);
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
        prey.hurt(d.dmg, this.dir * 1.2, -0.6, this);
        this.biteCd = 50;
        G.sfx('bite', this.x, this.y, 260);
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

  // wasp: a day-flying striker. Hovers over the canopy line, dives on
  // surface ants, bites, then backs off for a breath. Leaves at dusk.
  waspThink() {
    const d = BUG_DEF.wasp;
    const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, this.x)));
    if (G.isNight() || this.fleeing) {
      // climb into the sky and vanish
      this.x += this.dir * d.speed;
      this.y -= 0.8;
      if (this.y < T.surf[sx] - 240) this.dead = true;
      return;
    }
    let prey = this.swoopT > 0 ? null : G.nearestAnt(this.x, this.y, 150, false);
    if (prey) {
      const px = Math.floor(Math.max(0, Math.min(WORLD_W - 1, prey.x)));
      if (prey.y > T.surf[px] + 14) prey = null;  // can't reach tunnels
    }
    let tx, ty;
    if (prey) {
      tx = prey.x; ty = prey.y - 1;
    } else {
      // patrol above the forest floor, drifting toward the colony
      if (Math.random() < 0.01) this.dir = -this.dir;
      if (Math.random() < 0.004) this.dir = Math.sign((G.mode === 'versus' ? nestNearest(this.x) : G.colonies[0]).x - this.x) || 1;
      tx = this.x + this.dir * 40;
      ty = T.surf[sx] - 45 - Math.sin(G.tick * 0.05 + this.phase) * 8;
    }
    const ang = Math.atan2(ty - this.y, tx - this.x);
    const sp = prey ? d.speed * 1.6 : d.speed;
    const nx = this.x + Math.cos(ang) * sp;
    const ny = this.y + Math.sin(ang) * sp;
    if (!T.boxSolid(nx, ny, this.hw, this.hh)) {
      this.x = nx; this.y = ny;
      if (Math.abs(Math.cos(ang)) > 0.1) this.dir = Math.cos(ang) >= 0 ? 1 : -1;
      this.treeN = 0;
    } else if (T.digHasTarget(nx, ny, 3)) {
      // foliage in the way: chew straight through the leaves
      this.gnaw(nx, ny, 3);
      if (!T.boxSolid(nx, ny, this.hw, this.hh)) { this.x = nx; this.y = ny; }
      this.treeN = 0;
    } else if (!T.boxSolid(this.x, this.y - 1, this.hw, this.hh)) {
      this.y -= 1; // wood ahead: veer up and over the branch
    } else if (!T.boxSolid(this.x, this.y + 1, this.hw, this.hh)) {
      this.y += 1; // pinned under a limb: duck below it
      this.treeN = (this.treeN || 0) + 1;
      if (this.treeN > 120) { this.treeN = 0; this.dir = -this.dir; }
    } else {
      this.dir = -this.dir; // boxed in by wood: peel away
      return;
    }
    if (prey && dist2(this.x, this.y, prey.x, prey.y) < 90 && this.biteCd <= 0) {
      prey.hurt(d.dmg, this.dir, -0.4, this);
      this.biteCd = 45;
      this.swoopT = 110; // hit and run
      G.sfx('bite', this.x, this.y, 240);
    }
    this.x = Math.max(8, Math.min(WORLD_W - 8, this.x));
    this.y = Math.max(8, this.y);
  }

  // beetle: slow armored bruiser. Trundles toward the mound, bulldozes
  // through soil, hits like a rock.
  beetleThink() {
    const d = BUG_DEF.beetle;
    if (this.fleeing) {
      const edge = this.x < WORLD_W / 2 ? 10 : WORLD_W - 10;
      this.dir = Math.sign(edge - this.x) || 1;
      this.vx = this.dir * d.speed * 1.4;
      if (Math.abs(this.x - edge) < 40) this.dead = true;
      return;
    }
    const prey = G.nearestAnt(this.x, this.y, 130, false);
    if (prey) {
      this.dir = Math.sign(prey.x - this.x) || 1;
      this.vx = this.dir * d.speed * 1.2;
      if (dist2(this.x, this.y, prey.x, prey.y) < 130 && this.biteCd <= 0) {
        prey.hurt(d.dmg, this.dir * 1.4, -0.5, this);
        this.biteCd = 70;
        G.sfx('bite', this.x, this.y, 260);
      }
    } else {
      // menace the mound (unless we just bounced off a tree)
      if (this.turnT <= 0) {
        // (the players' nest; in versus whichever nest is nearer)
        const home = G.mode === 'versus' ? nestNearest(this.x) : G.colonies[0];
        this.dir = Math.sign(home.x - this.x) || 1;
        if (Math.abs(this.x - home.x) < 70 && Math.random() < 0.01) this.dir = -this.dir;
      }
      this.vx = this.dir * d.speed;
    }
    // bulldoze whatever blocks the path; trees turn it back
    if (this.blocked && this.digT <= 0) {
      const bx = this.x + this.dir * (this.hw + 3);
      if (T.digHasTarget(bx, this.y, 5)) {
        T.dig(bx, this.y, 5);
        G.fx('dirt', bx, this.y, 3);
        G.sfx('dig', bx, this.y, 220);
        this.digT = 40;
      } else {
        this.dir = -this.dir;
        this.turnT = 600; // wood or rock: trundle off elsewhere for a while
        this.digT = 30;
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
      case 'wasp': {
        ctx.save();
        ctx.translate(ex, ey);
        ctx.scale(this.dir, 1);
        // wings, 2-frame flutter
        const wup = (G.tick >> 1) % 2;
        ctx.fillStyle = 'rgba(225,235,250,0.75)';
        ctx.fillRect(-3, -4 - wup, 4, 2);
        ctx.fillRect(-2, -5 - wup, 3, 1);
        // striped abdomen
        ctx.fillStyle = fl ? '#fff' : '#e8c020';
        ctx.fillRect(-5, -1, 7, 3);
        ctx.fillStyle = fl ? '#fff' : '#2a2418';
        ctx.fillRect(-4, -1, 1, 3);
        ctx.fillRect(-2, -1, 1, 3);
        ctx.fillRect(0, -1, 1, 3);
        // sting
        ctx.fillRect(-6, 0, 1, 1);
        // head
        ctx.fillStyle = fl ? '#fff' : '#3a3020';
        ctx.fillRect(2, -2, 3, 3);
        ctx.fillStyle = '#d02020';
        ctx.fillRect(4, -1, 1, 1);
        ctx.restore();
        break;
      }
      case 'beetle': {
        ctx.save();
        ctx.translate(ex, ey);
        ctx.scale(this.dir, 1);
        const bd = fl ? '#fff' : '#2e2a3a';
        const bk = fl ? '#fff' : '#1c1a26';
        // legs, 2-frame stomp
        const blo = Math.sin(this.phase) > 0 ? 1 : 0;
        ctx.fillStyle = bk;
        ctx.fillRect(-4 + blo, 3, 1, 2);
        ctx.fillRect(-1 - blo, 3, 1, 2);
        ctx.fillRect(2 + blo, 3, 1, 2);
        // domed shell
        ctx.fillStyle = bd;
        ctx.fillRect(-6, -2, 10, 5);
        ctx.fillRect(-5, -3, 8, 1);
        ctx.fillRect(-4, -4, 6, 1);
        ctx.fillStyle = fl ? '#fff' : '#46405c'; // shine
        ctx.fillRect(-3, -3, 2, 1);
        // head + horn
        ctx.fillStyle = bk;
        ctx.fillRect(4, -1, 2, 4);
        ctx.fillRect(5, -3, 1, 2);
        ctx.fillStyle = '#c03020';
        ctx.fillRect(5, 0, 1, 1);
        ctx.restore();
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
// loose food left lying this long rots away (fungus keeps; crystals are
// forever). Without it, seeds and honeydew nobody reaches -- across the map,
// up a trunk -- pile up to the spawn caps and starve the colony of new food.
const ITEM_ROT = 60 * 240;   // one day (DAY_LEN; colony.js loads later)
const ROTS = { seed: 1, honeydew: 1, leaf: 1, corpse: 1, bigcorpse: 1, morsel: 1 };

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
    this.age = 0;      // ticks lying loose (carrying resets it)
    this.dir = 1; this.climbing = false; this.blocked = false;
  }
  update() {
    if (this.carried) {
      const c = this.carried;
      this.x = c.x - c.dir * 2;
      this.y = c.y - 5 * (c.def ? c.def.size : 1);
      this.age = 0;
      return;
    }
    if (++this.age > ITEM_ROT && ROTS[this.kind]) { this.dead = true; return; }
    physStep(this);
    this.vx *= 0.85;
    if (Math.abs(this.vx) < 0.01) this.vx = 0;   // (and then it rests)
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
    case 'fungus':
      ctx.fillStyle = '#96b292';
      ctx.fillRect(ex, ey - 1, 1, 2);          // stem
      ctx.fillStyle = '#a8d4b2';
      ctx.fillRect(ex - 1, ey - 2, 3, 1);      // cap
      ctx.fillStyle = '#c8ecd0';
      ctx.fillRect(ex, ey - 3, 1, 1);
      break;
    case 'berry':     // a juicy wedge of the fallen fruit
      ctx.fillStyle = '#c8304a';
      ctx.fillRect(ex - 1, ey - 1, 3, 3);
      ctx.fillStyle = '#ff8c98';
      ctx.fillRect(ex - 1, ey - 1, 1, 1);
      ctx.fillStyle = '#7a1828';
      ctx.fillRect(ex + 1, ey + 1, 1, 1);
      break;
    case 'crystal':
      ctx.fillStyle = '#78b4e0';
      ctx.fillRect(ex - 1, ey - 1, 3, 2);
      ctx.fillRect(ex, ey - 2, 1, 4);
      ctx.fillStyle = '#dcf0ff';
      ctx.fillRect(ex, ey - 1, 1, 1);
      break;
  }
}
