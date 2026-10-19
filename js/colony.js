// MAUR -- colony simulation: food, brood cycle, tasks, ambient spawning.
'use strict';

const DAY_LEN = 60 * 240; // 4 minutes of frames per day

// the colony year: four seasons of SEASON_DAYS days (a year ~48 minutes).
// The calendar is derived from G.tick alone, so saves carry it for free.
const SEASON_DAYS = 3;
const YEAR_DAYS = SEASON_DAYS * 4;
const SPRING = 0, SUMMER = 1, AUTUMN = 2, WINTER = 3;
const SEASON_KEYS = ['spring', 'summer', 'autumn', 'winter'];
// how much food the forest floor offers, by season
const SEASON_FOOD = [1.0, 1.25, 0.5, 0];

// foraging: food spawns within this of the nest (the foragers' range)
const FORAGE_R = 900;
const SEED_RATE = 0.005, SEED_RATE_LEAN = 0.014; // chance per tick (lean: < 8 food items in reach)
const SEED_CAP = 14;                              // loose seeds in reach

// chambers: marked cavities whose dug-out area sets the colony's capacity
// (a fungus garden instead turns leaves into food)
const CH_TYPES = ['storage', 'nursery', 'barracks', 'royal', 'fungus'];
const CH_R = 32;          // a chamber's area is the air inside this disk
const CH_MIN_AREA = 300;  // smaller is cramped: counts as zero
const CH_ROOM = 4;        // only air within reach of a (2*4+1) px open square
                          // counts: a room, not the tunnels running through it
const CH_NEAR = 40;       // X within this of a marker (in sight) cycles its type
const CH_SPACING = 50;    // new markers keep this far from the others
const CH_DEPTH = 30;      // markers go at least this far below the ground
const CH_RECALC = 480;    // ticks between area recounts

// the thatched mound: thatch built over the nest entrance. It warms the brood
// (faster growth) and shelters ants from winter's cold.
const MOUND_SPAN = 90;       // counts thatch within this of the entrance...
const MOUND_TALL = 70;       // ...from this far above the ground down to it
const MOUND_WARM = 60;       // px of thatch before it keeps the cold off
const MOUND_BOOST_PER = 600; // px per +100% brood growth...
const MOUND_BOOST_MAX = 0.5; // ...capped at +50%
const COLD_DMG = 0.01;       // hp per tick for an ant out on the winter surface
const WINTER_EAT = 0.5;      // what an overwintering colony eats, against the rest of the year

// the entrance seal check (flood fill box around the shaft)
const SEAL_BOX = 70;

// aphid shelters: thatch built by a tree, marked with X on the surface
const SHELTER_THATCH = 40;   // px of thatch within SHELTER_R it needs
const SHELTER_R = 16;
const SHELTER_TREE = 70;     // must be this close to a tree trunk
const SHELTER_MAX = 3, SHELTER_SPACING = 60;
const SHELTER_T = 1500;      // ticks between honeydew drops

// fungus gardens: leaves in, food out (works in winter too)
const LEAF_UNITS = 4;        // garden units per leaf item
const THATCH_PER_UNIT = 10;  // px of thatch load per garden unit
const FUNGUS_RATE = 0.1 / 60; // units converted per tick per 1000 px of area
const FUNGUS_YIELD = 1.5;    // food per unit
const FUNGUS_STOCK = 0.1;    // units a garden holds per px of area

// princesses: laid in autumn, once a royal chamber is roomy enough
const PRINCESS_ROYAL = 1800; // area the largest royal chamber needs
const PRINCESS_AREA = 900;   // royal area per princess (the cap)
const PRINCESS_FOOD = 150;   // stores that are always plenty for a princess egg
const WINTER_LAY = 0.25;     // the queen's laying pace in winter

// crystal upgrades: cost per level (3 levels), colony-wide, NPCs included
const UPGRADES = {
  mandibles: [3, 5, 8],      // bite damage +25% a level
  digging:   [2, 4, 7],      // bite reach +12%, bite cooldown -12% a level
  armor:     [3, 5, 8],      // soldiers take 20% less damage a level
  carry:     [2, 4, 6],      // laden ants walk 12% faster a level
};
const UPGRADE_IDS = ['mandibles', 'digging', 'armor', 'carry'];
const UPG_DMG = 0.25, UPG_DIGR = 0.12, UPG_DIGCD = 0.12, UPG_ARMOR = 0.2, UPG_CARRY = 0.12;
// a colony's upgrade level (default: the players' colony)
function upgLevel(id, col) {
  col = col || G.colony;
  return col && col.upg ? col.upg[id] || 0 : 0;
}

// the colonies: index 0 is the players' (black), index 1 the rival red one.
// Every colony runs the same sim; `player` colonies get tasks, milestones and
// the messages, AI colonies get the expansion and raid rules below.
const FACTIONS = ['black', 'red'];
const NEST_R = 250;          // an ant within this of a nest's x, underground, is in that nest

// the rival's growth: a cramped AI colony digs out a new chamber now and then
const AI_EXPAND_MAX = 3;     // chambers it adds in all
const AI_EXPAND_DAYS = 2;    // days between them
const AI_EXPAND_STEP = 40;   // ticks per bite of the dig
const AI_CHAMBER_TYPES = ['storage', 'nursery', 'barracks'];
// an idle players' colony grows slowly too: once its nest has been full for
// half a day its own workers dig out a nursery, at most once a season and
// never in spring (a player who digs and marks chambers grows far faster)
const SELF_DIG_FULL = DAY_LEN / 2;
// an AI queen keeps a winter reserve: from autumn on she lays only while
// the stores hold this much food per ant
const AI_RESERVE = 3;
const PLAYER_RESERVE = 2;    // ...and the players' queen this much

// raids: soldiers and workers march from the AI nest on its enemy's, fight,
// steal from the stores and carry it home. At most one a day, never in
// winter, bolder as the year goes on.
const RAID_POP = 14;         // the raiding colony needs this many ants...
const RAID_FOOD = 40;        // ...and this much food in store
const RAID_CHANCE = 1 / (DAY_LEN * 0.4);  // per tick once ready (scaled by boldness)
const RAID_BOLD = [0.5, 1, 1.5, 0];       // by season
const RAID_T = 20000;        // ticks before the raiders give up and go home...
const RAID_SIEGE = 2400;     // ...or this long at the enemy's nest
const RAID_MAX = 10;         // raiders at most
const RAID_STEAL = 8;        // food a raider carries off from the stores
const RAID_NERVE = 0.2;      // a thief bitten on its way in only runs below this much health
const RAID_MUSTER = 520;     // the party gathers this far short of the enemy's nest (out of its soldiers' sight)...
const RAID_MUSTER_T = 1200;  // ...waiting at most this long for stragglers, then goes in together
const RAID_LOSS = 0.34;      // the raid breaks off once fewer than this share of it is left
const RAID_THIEF_LAG = 360;  // ticks the thieves hold back once the fighters go in
const RAID_STALL = 1800;     // ticks with no raider getting closer (and none at the gates): give up
const RAID_ANT_STALL = 1500; // ticks one raider may go without getting closer before it drops out
const RAID_HOME_T = 9000;    // ticks the retreat may take before stragglers drop the raid (the walk home is ~6000)
// what a raider may be busy with; any other state (a forage errand, a
// rescue) means it lost the thread and is no longer one
const RAID_STATES = ['raid', 'fight', 'flee', 'idle', 'home', 'return'];

// the red queen slain: the rival colony is defeated
const RIVAL_SCORE = 1000, RIVAL_CRYSTALS = 5;
const SLAIN_T = 1200;        // ticks a queen's last wound counts toward who slew her (old saves)
const SLAIN_SHARE = 0.25;    // the players' share of her recent wounds that makes her slain by them
const SLAIN_MIN = 0.05;      // ...and their recent wounds must come to this much of her full health
const QDMG_FADE = 0.994;     // the wound ledger fades by this a second (half-life ~2 minutes)
const LEADERLESS_DMG = 0.003; // hp per tick the queenless ants waste away
const RED_QUEEN_HP = 1.5;    // the red queen's health (times a queen's): tough, but an escort can take her

// the contested food site: a fallen fruit between the nests each summer,
// whose pieces both colonies' foragers race for
const SITE_PIECES = 14;      // pieces when it falls...
const SITE_MAX = 40;         // ...and at most this many over the summer
const SITE_REFILL = 1200;    // ticks between top-ups (while few lie there)
const SITE_GO = 0.3;         // a forager's chance to head for it

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

// out of the winter cold: below ground, or within any colony's thatched mound
function sheltered(e) {
  if (underground(e)) return true;
  for (const c of G.colonies) if (c.inMound(e)) return true;
  return false;
}

class Colony {
  constructor(info, idx) {
    // info: { x, entrance, junction, queenCh, storage, nursery, paths }
    Object.assign(this, info);
    this.idx = idx || 0;                    // its index in G.colonies
    this.faction = FACTIONS[this.idx] || 'red';
    this.player = this.idx === 0;           // played (tasks, milestones, messages)
    this.gates = this.player;               // its ants pass ant gates (the players' build)
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
    this.nestFullT = 0;   // the "nest is full" hint's cooldown
    this.food = 60;
    this.score = 0;
    this.crystals = 0;    // currency for upgrades
    this.upg = { mandibles: 0, digging: 0, armor: 0, carry: 0 };
    this.shelters = [];   // aphid shelters { x, y, t }
    this.mound = { size: 0, x0: 0, x1: -1, top: 0 };
    this.broodBoost = 1;  // brood growth speed (the mound's warmth)
    this.sealed = false;  // entrance shut to outsiders (last recount)
    this.eggT = 1800;
    this.starveMsgT = 0;
    this.taskT = 0;
    this.tasks = [];
    this.lastDigTaskDay = 0;
    this.lastRaidDay = 0;
    this.objectives = null; // this season's milestones (player colonies)
    this.defeated = false;  // its queen died with no heir (an AI colony)
    this.slain = false;     // ...killed by a player colony (the bonus was paid)
    this.queenHit = null;   // { col, t }: whose colony last wounded its queen
    this.queenDmg = {};     // { colony index (or -1): recent damage } dealt to its queen
    this.fullT = 0;         // ticks the nest has been full (adults + brood at the cap)
    this.raid = null;       // a raid under way { phase, t, target, n0, stolen, warned, home }
    this.queenSeen = false; // a player has found its queen (the map marks her)
    this.expandN = 0;       // chambers the AI dug out
    this.lastExpandDay = 0;
    this.digJob = null;     // the AI's chamber dig in progress { pts, i, type }
    this.stats = {
      foodGathered: 0, tasksDone: 0, antsBorn: 0,
      antsDied: 0, predatorsSlain: 0,
      milestones: 0, princesses: 0, flown: 0, crystalsFound: 0,
      eggsLaid: 0, raids: 0, foodStolen: 0, rivalsSlain: 0, rivalDefeated: 0,
    };
  }

  // ---- members -----------------------------------------------------------------
  // the living ants of this colony
  members() { return G.ants.filter(a => a.hp > 0 && a.colony === this); }
  queen() { return G.ants.find(a => a.caste === 'queen' && a.hp > 0 && a.colony === this) || null; }
  broodCount() {
    let n = 0;
    for (const b of G.brood) if (!b.dead && b.colony === this) n++;
    return n;
  }
  // a message for this colony's players (an AI colony keeps quiet)
  say(key, args, color) { if (this.player) G.msg(key, args, color); }

  // log a wound to this colony's queen in the ledger (ci: the colony that
  // dealt it, -1 for hunger, cold, bugs -- anything that isn't an ant)
  woundQueen(ci, dmg) {
    if (!(dmg > 0)) return;
    const qd = this.queenDmg || (this.queenDmg = {});
    qd[ci] = (qd[ci] || 0) + dmg;
  }
  // the colony this one fights: the nearest other one still standing
  enemy() {
    let best = null;
    for (const c of G.colonies) {
      if (c === this || c.defeated) continue;
      if (!best || Math.abs(c.x - this.x) < Math.abs(best.x - this.x)) best = c;
    }
    return best;
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
    const sum = { storage: 0, nursery: 0, barracks: 0, royal: 0, fungus: 0 };
    let royalMax = 0;
    for (const ch of this.chambers) {
      const room = this.areaAt(ch.x, ch.y, ch);
      if (!(ch.claimed >= 0)) ch.claimed = room;
      ch.area = Math.min(room, ch.claimed);
      if (ch.area >= CH_MIN_AREA) sum[ch.type] += ch.area;
      if (ch.type === 'royal') royalMax = Math.max(royalMax, ch.area);
    }
    this.caps = {
      // never below what the queen needs to keep laying (eggs need 30)
      food: Math.max(40, Math.round(20 + sum.storage * 0.1)),
      brood: 1 + Math.floor(sum.nursery / 200),
      pop: Math.max(10, Math.floor((sum.nursery + sum.barracks) / 75)),
      // ticks between eggs: a roomier royal chamber, a busier queen
      eggT: Math.round(2700 * Math.max(0.5, Math.min(2.5, 1550 / Math.max(1, sum.royal)))),
      soldiers: 0.1 + Math.min(0.3, sum.barracks / 10000),  // soldier share
      // princesses: only once a royal chamber is roomy, and as many as the
      // royal chambers have room for
      princess: royalMax >= PRINCESS_ROYAL ? Math.floor(sum.royal / PRINCESS_AREA) : 0,
      royalMax,
    };
    this.recountMound();
    this.sealed = this.entranceSealed();
  }

  // ---- special structures ---------------------------------------------------
  // the thatched mound: thatch in the region over the entrance
  recountMound() {
    const e = this.entrance;
    let size = 0, x0 = Infinity, x1 = -Infinity, top = Infinity;
    for (let x = Math.max(0, e.x - MOUND_SPAN); x <= Math.min(WORLD_W - 1, e.x + MOUND_SPAN); x++) {
      const g = T.bgSurf[x];
      for (let y = Math.max(0, g - MOUND_TALL); y < g + 6; y++) {
        if (T.m[y * WORLD_W + x] !== M_THATCH) continue;
        size++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < top) top = y;
      }
    }
    this.mound = { size, x0, x1, top };
    this.broodBoost = 1 + Math.min(MOUND_BOOST_MAX, size / MOUND_BOOST_PER);
  }

  // out of the cold: below ground, or on the surface within a mound that's
  // big enough (beside or under it, not perched on top)
  sheltered(a) { return sheltered(a); }
  inMound(a) {
    const m = this.mound;
    return m.size >= MOUND_WARM && a.x >= m.x0 - 4 && a.x <= m.x1 + 4 && a.y >= m.top - 4;
  }

  // is the nest shut to outsiders? A flood fill through open air (packed
  // earth and gates bar it) from the sky over the entrance, kept to a box
  // around the shaft: sealed when it can't reach the junction.
  entranceSealed() {
    const e = this.entrance, j = this.junction;
    const x0 = Math.max(0, e.x - SEAL_BOX), x1 = Math.min(WORLD_W - 1, e.x + SEAL_BOX);
    const y0 = Math.max(0, e.y - 40), y1 = Math.min(WORLD_H - 1, j.y + 12);
    const W = x1 - x0 + 1, H = y1 - y0 + 1;
    const seen = new Uint8Array(W * H);
    const stack = [];
    const visit = (k, x, y) => {
      if (seen[k] || T.m[y * WORLD_W + x] !== M_AIR) return;
      seen[k] = 1;
      stack.push(k);
    };
    for (let x = x0; x <= x1; x++) visit(x - x0, x, y0);
    while (stack.length) {
      const i = stack.pop();
      const x = x0 + i % W, y = y0 + ((i / W) | 0);
      if (Math.abs(x - j.x) <= 8 && Math.abs(y - j.y) <= 8) return false;
      if (x > x0) visit(i - 1, x - 1, y);
      if (x < x1) visit(i + 1, x + 1, y);
      if (y > y0) visit(i - W, x, y - 1);
      if (y < y1) visit(i + W, x, y + 1);
    }
    return true;
  }

  // thatch pixels within r of (x, y)
  thatchNear(x, y, r) {
    let n = 0;
    const cx = Math.round(x), cy = Math.round(y);
    for (let py = cy - r; py <= cy + r; py++) {
      for (let px = cx - r; px <= cx + r; px++) {
        if ((px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r && T.get(px, py) === M_THATCH) n++;
      }
    }
    return n;
  }

  // X on the surface: by a tree, with thatch built around, an aphid shelter
  markShelter(a, pIdx, refuse) {
    const nearTree = G.trees.some(t => Math.abs(t.x - a.x) < SHELTER_TREE);
    if (!nearTree) { refuse('m_shelterTree'); return; }
    if (this.shelters.some(sh => dist2(sh.x, sh.y, a.x, a.y) < SHELTER_SPACING * SHELTER_SPACING)) {
      refuse('m_shelterClose'); return;
    }
    if (this.shelters.length >= SHELTER_MAX) { refuse('m_shelterMax'); return; }
    if (this.thatchNear(a.x, a.y, SHELTER_R) < SHELTER_THATCH) { refuse('m_shelterThatch'); return; }
    this.shelters.push({ x: Math.round(a.x), y: Math.round(a.y), t: SHELTER_T });
    G.msg('m_shelterNew', [], '#80ff80', pIdx);
    G.sfx('mark', a.x, a.y);
    G.fx('sparkle', a.x, a.y - 6, 5);
  }

  // shelters drip honeydew now and then (not in winter); one whose thatch
  // was torn down is abandoned
  updateShelters() {
    let gone = false;
    for (const sh of this.shelters) {
      if (--sh.t > 0) continue;
      sh.t = SHELTER_T;
      if (this.thatchNear(sh.x, sh.y, SHELTER_R) < SHELTER_THATCH / 2) {
        sh.gone = gone = true;
        this.say('m_shelterGone', [], '#ff8040');
        continue;
      }
      if (G.isWinter()) continue;
      const near = G.items.filter(i => i.kind === 'honeydew' && !i.carried &&
        dist2(i.x, i.y, sh.x, sh.y) < 900).length;
      if (near >= 3) continue;
      G.items.push(G.makeItem('honeydew', sh.x + (Math.random() - 0.5) * 12, sh.y - 4));
      G.fx('sparkle', sh.x, sh.y - 4, 2);
    }
    if (gone) this.shelters = this.shelters.filter(sh => !sh.gone);
  }

  // fungus gardens: their leaf stock slowly turns into food in the stores
  updateGardens() {
    for (const ch of this.chambers) {
      if (ch.type !== 'fungus' || !(ch.leaves > 0) || ch.area < CH_MIN_AREA) continue;
      if (this.storageFull()) return;
      const u = Math.min(ch.leaves, FUNGUS_RATE * ch.area / 1000);
      ch.leaves -= u;
      this.food = Math.min(this.caps.food, this.food + u * FUNGUS_YIELD);
      this.stats.foodGathered += u * FUNGUS_YIELD;
    }
  }

  // the fungus garden within r of (x, y) that has room for more leaves
  gardenNear(x, y, r) {
    let best = null, bd = r * r;
    for (const ch of this.chambers) {
      if (ch.type !== 'fungus' || ch.area < CH_MIN_AREA) continue;
      if ((ch.leaves || 0) >= ch.area * FUNGUS_STOCK) continue;
      const d = dist2(x, y, ch.x, ch.y);
      if (d < bd) { bd = d; best = ch; }
    }
    return best;
  }

  // feed a garden n units (leaves or thatch); returns the units taken
  feedGarden(ch, n) {
    const room = Math.max(0, ch.area * FUNGUS_STOCK - (ch.leaves || 0));
    const u = Math.min(room, n);
    ch.leaves = (ch.leaves || 0) + u;
    return u;
  }

  // ---- crystal upgrades -------------------------------------------------------
  upgradeCost(id) {
    const lv = this.upg[id] || 0;
    return lv >= UPGRADES[id].length ? Infinity : UPGRADES[id][lv];
  }

  // player pIdx asked to buy upgrade `id`: the sim checks it's real and paid
  buyUpgrade(id, pIdx) {
    if (!Object.prototype.hasOwnProperty.call(UPGRADES, id)) return false;
    const cost = this.upgradeCost(id);
    if (cost === Infinity) { G.msg('m_upgMax', [], '#ff8040', pIdx); return false; }
    if (this.crystals < cost) {
      G.msg('m_noCrystals', [cost], '#ff8040', pIdx);
      G.sfx('clank');
      return false;
    }
    this.crystals -= cost;
    this.upg[id] = (this.upg[id] || 0) + 1;
    G.msg('m_upgraded', [{ key: 'up_' + id }, this.upg[id]], '#80e0ff');
    G.sfx('task');
    return true;
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
    if (a.y < T.bgSurf[sx] + CH_DEPTH) {
      // up top, by a tree, X founds an aphid shelter instead
      if (a.y < T.bgSurf[sx] + 8) this.markShelter(a, pIdx, refuse);
      else refuse('m_markDeep');
      return;
    }
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

  // should the queen's next egg be a princess? Only in autumn, with a roomy
  // royal chamber, plentiful food, and fewer princesses (adult or brood)
  // than the royal chambers have room for
  wantPrincess() {
    if (G.season !== AUTUMN || !this.caps.princess) return false;
    // (well stocked: 60% of the stores, though never more than PRINCESS_FOOD
    // -- marking more storage mustn't put princesses further off)
    if (this.food < Math.max(60, Math.min(PRINCESS_FOOD, this.caps.food * 0.6))) return false;
    const have = G.ants.filter(a => a.caste === 'princess' && a.hp > 0 && a.colony === this).length +
      G.brood.filter(b => b.royal && !b.dead && b.colony === this).length;
    return have < this.caps.princess;
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
      } else if (this.player && this.fullMsgT <= 0 && G.nearPlayer(this.storage.x, this.storage.y) < 400) {
        G.msg('m_storageFullNpc', [], '#ff8040');
        this.fullMsgT = 3600;
      }
      return false;
    }
    // a piece of the contested site's fruit counts for whoever brings it in
    if (item.site && G.contested) {
      G.contested.got[this.idx] = (G.contested.got[this.idx] || 0) + 1;
      objEvent('contested', 1, this);
    }
    if (item.kind === 'crystal') {
      // treasure, not food: the colony's currency for upgrades (and a
      // little score)
      this.crystals++;
      this.stats.crystalsFound++;
      this.score += 20;
      this.progress('crystal', 1);
      objEvent('crystals', 1, this);
      this.say('m_crystal', [this.crystals], '#80e0ff');
      if (this.player) G.sfx('task');
    } else if (item.kind === 'leaf' && who && who.playerIdx < 0 &&
               this.gardenNear(this.storage.x, this.storage.y, 1e5)) {
      // the colony passes a forager's leaf on to the fungus garden
      this.feedGarden(this.gardenNear(this.storage.x, this.storage.y, 1e5), LEAF_UNITS);
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

  // a grown larva emerges; `caste` forces one (princesses), else the colony's
  // needs pick it
  spawnAdult(x, y, caste) {
    if (!caste) {
      const ants = this.members();
      const soldiers = ants.filter(a => a.caste === 'soldier').length;
      const nurses = ants.filter(a => a.caste === 'nurse').length;
      caste = 'worker';
      // barracks space raises the colony's appetite for soldiers
      if (soldiers < ants.length * this.caps.soldiers && Math.random() < 0.4) caste = 'soldier';
      else if (nurses < ants.length * 0.15 && Math.random() < 0.35) caste = 'nurse';
    }
    const a = new Ant(x, y, caste, this);
    G.ants.push(a);
    this.stats.antsBorn++;
    if (caste === 'princess') {
      this.stats.princesses++;
      objEvent('princess', 1, this);
      this.say('m_princess', [], '#ff90e0');
      if (this.player) G.sfx('task');
    } else {
      objEvent('raise', 1, this);
      this.say('m_emerged', [{ caste }]);
    }
    G.sfx('hatch', x, y, 300);
    return a;
  }

  update() {
    if (!isFinite(this.food)) { console.error('colony.food was NaN'); this.food = 0; }
    const ants = this.members();
    const pop = ants.length;
    if (this.fullMsgT > 0) this.fullMsgT--;

    // digging (and building) reshapes the chambers: recount now and then
    // (the colonies take turns, half a recount apart)
    if (!this.caps || (G.tick + this.idx * (CH_RECALC >> 1)) % CH_RECALC === 0) {
      this.recalcChambers();
      // the winter milestone counts the recounts that found the nest shut
      if (G.isWinter() && this.sealed) objEvent('sealed', 1, this);
    }

    // digging erodes the nest: keep the colony's mental map (chamber anchors,
    // tunnel waypoints) settled on the floors that actually exist now. Not
    // the entrance: it is the shaft's mouth, and "settling" it slid it down
    // the open shaft, 30 px a time, until foragers heading out "arrived" at
    // the bottom of the shaft and never surfaced again.
    if ((G.tick + this.idx * 300) % 600 === 0) {
      for (const key of ['junction', 'queenCh', 'storage', 'nursery']) {
        const p = this[key];
        let n = 0;
        while (n++ < 30 && p.y + 4 < WORLD_H && !T.boxSolid(p.x, p.y + 3, 2, 1)) p.y++;
      }
      for (const k in this.paths) settlePath(T.m, this.paths[k]);
    }

    // everyone eats (in winter, huddled below, about half as much)
    this.food = Math.max(0, this.food - pop * 0.00006 * (G.isWinter() ? WINTER_EAT : 1));

    // starvation (the last morsels go to the queen and the princesses: a
    // famine thins out the workers long before it takes the crown)
    if (this.food <= 0 && pop > 0) {
      for (const a of ants) {
        const d = a.caste === 'queen' || a.caste === 'princess' ? 0.0015 : 0.006;
        if (a.caste === 'queen') this.woundQueen(-1, Math.min(d, Math.max(0, a.hp)));
        a.hp -= d;
      }
      if (this.starveMsgT <= 0) {
        this.say('m_starving', [], '#ff6040');
        if (this.player) G.sfx('starve');
        this.starveMsgT = 1800;
      }
    }
    if (this.starveMsgT > 0) this.starveMsgT--;

    // a defeated colony has no queen to hold it together: its ants waste
    // away, and its brood with them
    if (this.defeated) {
      for (const a of ants) a.hp -= LEADERLESS_DMG;
      for (const b of G.brood) if (b.colony === this) b.hp -= LEADERLESS_DMG;
    }

    // the queen lays
    const queen = this.queen();
    if (queen) {
      // winter: she lays at a fraction of her pace
      this.eggT -= G.isWinter() ? WINTER_LAY : 1;
      const broodCount = this.broodCount();
      const caps = this.caps;
      // (from autumn on a queen keeps the winter stores: no eggs into the
      // hungry months unless they hold a reserve per ant -- the AI's queen
      // a bigger one; a players' colony that grew big in summer otherwise
      // laid its stores away and starved in autumn or winter)
      const need = G.season >= AUTUMN ? Math.max(30, pop * (this.player ? PLAYER_RESERVE : AI_RESERVE)) : 30;
      if (this.eggT <= 0 && this.food >= need && broodCount < caps.brood && pop + broodCount < caps.pop) {
        this.food -= 10;
        const e = new Brood(queen.x + (Math.random() - 0.5) * 14, queen.y - 4, 'egg', this);
        // autumn, a roomy royal chamber and full stores: a princess egg
        if (this.wantPrincess()) {
          e.royal = true;
          this.say('m_royalEgg', [], '#ff90e0');
        } else {
          this.say('m_eggLaid');
        }
        G.brood.push(e);
        this.stats.eggsLaid++;
        this.eggT = caps.eggT;
        G.sfx('lay', queen.x, queen.y, 300);
      }
      if (this.eggT <= 0) {
        this.eggT = 600; // re-check soon
        // held back only by the room: tell the players (once a day at most)
        if (this.player && this.food >= 30 && broodCount < caps.brood && pop + broodCount >= caps.pop &&
            this.nestFullT <= 0) {
          this.nestFullT = DAY_LEN;
          G.msg('m_nestFull', [], '#ff9040');
        }
      }
    }

    if (this.nestFullT > 0) this.nestFullT -= 1;
    // full to the brim (the queen can't lay): how long for
    this.fullT = queen && pop + this.broodCount() >= this.caps.pop ? this.fullT + 1 : 0;
    // old wounds fade from the queen's ledger
    if (G.tick % 60 === 0) for (const k in this.queenDmg) this.queenDmg[k] *= QDMG_FADE;

    // the special structures
    this.updateShelters();
    this.updateGardens();

    if (this.player) {
      if (G.tick % 60 === 0) updateObjectives(this);
      if (!this.defeated) this.updateExpansion(pop);
      // tasks
      this.taskT--;
      if (this.taskT <= 0) {
        this.taskT = 180;
        this.generateTasks();
      }
      this.checkTasks();
      for (const t of this.tasks) if (t.done && t.doneT > 0) t.doneT--;
      this.tasks = this.tasks.filter(t => !t.done || t.doneT > 0);
    } else if (!this.defeated) {
      this.updateAI(pop, queen);
    }

    this.forageSpawns();
  }

  // ---- the AI colony: growth, raids, its queen found -------------------------
  updateAI(pop, queen) {
    // a player who gets close to the queen finds her: the map marks her
    if (queen && !this.queenSeen && G.tick % 30 === 0) {
      for (const p of G.players) {
        if (p.ant && p.ant.hp > 0 && dist2(p.ant.x, p.ant.y, queen.x, queen.y) < 140 * 140) {
          this.queenSeen = true;
          G.msg('m_queenFound', [], '#ff6050');
          G.sfx('danger');
          break;
        }
      }
    }
    this.updateExpansion(pop);
    this.updateRaid(pop);
  }

  // cramped and not too lately grown: dig out a new chamber off the
  // junction, a bite at a time, and mark it once it's hollow
  updateExpansion(pop) {
    const job = this.digJob;
    if (job) {
      if (G.tick % AI_EXPAND_STEP !== 0) return;
      const p = job.pts[job.i++];
      T.dig(p.x, p.y, p.r, 1, false, SPARE_BUILT);
      if (job.i < job.pts.length) return;
      this.digJob = null;
      this.expandN++;
      this.lastExpandDay = G.day;
      this.addChamber(job.type, job.x, job.y, false);
      this.recalcChambers();
      this.say('m_workersDug', [{ key: 'ch_' + job.type }], '#80ff80');
      return;
    }
    if (G.isWinter() || (G.tick + this.idx * 97) % 600 !== 0 || !this.caps) return;
    if (this.player) {
      // (the players' colony: slowly, and only once full for a while)
      if (G.season === SPRING || this.fullT < SELF_DIG_FULL) return;
      if (Math.floor(this.lastExpandDay / SEASON_DAYS) === Math.floor(G.day / SEASON_DAYS) && this.expandN > 0) return;
    } else {
      if (this.expandN >= AI_EXPAND_MAX || G.day < this.lastExpandDay + AI_EXPAND_DAYS) return;
      if (pop + this.broodCount() < this.caps.pop - 2) return;
    }
    // where: a few tries around the junction for a spot clear of the other
    // chambers, deep enough, with no rock at its middle
    const j = this.junction;
    for (let k = 0; k < 8; k++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = Math.round(j.x + side * (100 + Math.random() * 110));
      const y = Math.round(j.y + 30 + Math.random() * 110);
      if (x < 60 || x > WORLD_W - 60 || y > WORLD_H - 60) continue;
      if (this.chamberNear(x, y, CH_SPACING * 1.6)) continue;
      if (T.digHitsHard(x, y, 14)) continue;
      // a tunnel from the junction, then the hollow itself
      const pts = [];
      const n = Math.ceil(Math.hypot(x - j.x, y - j.y) / 5);
      for (let i = 1; i <= n; i++) pts.push({ x: j.x + (x - j.x) * i / n, y: j.y + (y - j.y) * i / n, r: 4 });
      // (the players' own workers dig a modest one: room for ~7 more)
      const hw = this.player ? 8 : 16, hh = this.player ? 4 : 6;
      for (let dy = -hh; dy <= hh; dy += hh) {
        for (let dx = -hw; dx <= hw; dx += 8) pts.push({ x: x + dx, y: y + dy, r: 6 });
      }
      this.digJob = { pts, i: 0, x, y, type: this.player ? 'nursery' : AI_CHAMBER_TYPES[this.expandN % AI_CHAMBER_TYPES.length] };
      return;
    }
  }

  // raids: start one when strong enough, then watch it play out
  updateRaid(pop) {
    const r = this.raid;
    if (r) {
      r.t++;
      const target = G.colonies[r.target];
      const raiders = [];
      let near = Infinity;
      for (const a of G.ants) {
        if (!a.raiding || a.colony !== this || a.hp <= 0) continue;
        if (!RAID_STATES.includes(a.state)) { a.raiding = false; a.raidRole = null; continue; }
        raiders.push(a);
        near = Math.min(near, Math.abs(a.x - target.x));
      }
      // the siege clock runs once the raiders are at the enemy's gates
      if (near < 200) r.siege = (r.siege || 0) + 1;
      if (near < 600) r.nearT = r.t;
      if (r.phase === 'march') {
        // the march's progress: the closest any raider has come. Stuck at
        // home, lost, or the last ones near the nest killed: it's over.
        if (r.best === undefined || near < r.best - 4 || near < 200) {
          r.best = Math.min(r.best === undefined ? Infinity : r.best, near);
          r.stall = 0;
        } else r.stall = (r.stall || 0) + 1;
        // the party masses short of the nest: in together, not one by one
        if (!r.massed) {
          let at = 0;
          for (const a of raiders) if (Math.abs(a.x - target.x) < RAID_MUSTER + 40) at++;
          if (at) r.musterT = (r.musterT || 0) + 1;
          if (raiders.length && (at === raiders.length || r.musterT > RAID_MUSTER_T)) { r.massed = true; r.massedT = r.t; }
        }
        // the raiders draw near: the target colony is warned
        if (!r.warned && near < 600) {
          r.warned = true;
          target.say('m_raid', [], '#ff5040');
          if (target.player) G.sfx('danger');
        }
        // the thieves all laden: what the raid came for is won
        const thieves = raiders.filter(a => a.raidRole === 'steal');
        const looted = r.stolen > 0 && !thieves.some(a => !a.carry);
        // out of time, stalled, too many lost, loot won, or winter: back home
        if (r.t > RAID_T || r.siege > RAID_SIEGE || r.stall > RAID_STALL ||
            raiders.length < Math.max(1, r.n0 * RAID_LOSS) || looted || G.isWinter() || target.defeated) {
          r.phase = 'retreat';
          r.rt = 0;
          for (const a of raiders) {
            if (a.state === 'raid' || a.state === 'fight' || a.state === 'idle') { a.state = 'home'; a.target = null; }
          }
          // (only news if raiders were actually seen at the nest lately)
          if (r.warned && raiders.length && r.t - (r.nearT || 0) < 1200) target.say('m_raidOver', [], '#e0c080');
        }
      } else if (!raiders.length) {
        this.raid = null;
      } else if ((r.rt = (r.rt || 0) + 1) > RAID_HOME_T) {
        // stragglers that can't find their way home: just ants again
        for (const a of raiders) {
          a.raiding = false; a.raidRole = null;
          if (a.state === 'home') { a.state = 'idle'; a.stateT = 60; a.nav = null; }
        }
        this.raid = null;
      }
      return;
    }
    if (G.isWinter() || G.day < 2 || G.day <= this.lastRaidDay) return;
    if (pop < RAID_POP || this.food < RAID_FOOD) return;
    const yearDay = G.day % YEAR_DAYS;
    const bold = RAID_BOLD[G.season] * (G.year >= 2 ? 1.5 : 1);
    if (Math.random() >= RAID_CHANCE * bold) return;
    const enemy = this.enemy();
    if (enemy) this.startRaid(enemy, 4 + Math.floor(yearDay / 2) + (G.year >= 2 ? 2 : 0), pop);
  }

  // send out up to n raiders (soldiers first, one kept home; half of them
  // workers to carry off the loot). Returns the number sent.
  startRaid(enemy, n, pop) {
    if (pop === undefined) pop = this.members().length;
    n = Math.max(3, Math.min(RAID_MAX, n, Math.floor(pop * 0.4)));
    const fit = a => a.colony === this && a.hp > a.maxHp * 0.6 && a.playerIdx < 0 && !a.raiding && !a.carry;
    const soldiers = G.ants.filter(a => fit(a) && a.caste === 'soldier');
    const workers = G.ants.filter(a => fit(a) && a.caste === 'worker');
    const nWork = Math.min(workers.length, Math.max(1, Math.round(n / 2)));
    const nSold = Math.min(Math.max(0, soldiers.length - 1), n - nWork);
    const team = soldiers.slice(0, nSold).concat(workers.slice(0, n - nSold));
    if (team.length < 3) return 0;
    for (const a of team) {
      a.raiding = true;
      a.raidRole = a.caste === 'worker' ? 'steal' : 'fight';
      a.state = 'raid'; a.target = null; a.nav = null; a.stateT = 0;
      a.raidBest = undefined; a.raidStallT = 0;
    }
    this.raid = { phase: 'march', t: 0, siege: 0, target: enemy.idx, n0: team.length, stolen: 0, warned: false, home: 0 };

    this.lastRaidDay = G.day;
    this.stats.raids++;
    return team.length;
  }

  // a raider at the enemy's stores takes what it can carry
  steal(a, enemy) {
    const v = Math.min(RAID_STEAL, Math.floor(enemy.food));
    if (v < 2) return false;
    enemy.food -= v;
    enemy.stats.foodStolen = (enemy.stats.foodStolen || 0) + v;
    const loot = G.makeItem('morsel', a.x, a.y, v);
    loot.carried = a; a.carry = loot;
    G.items.push(loot);
    if (this.raid) {
      if (!this.raid.stolen) enemy.say('m_raidSteal', [], '#ff5040');
      this.raid.stolen += v;
    }
    enemy.say('m_foodStolen', [v], '#ff7050');
    G.sfx('pickup', a.x, a.y, 200);
    return true;
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
    const hungry = G.brood.filter(b => b.kind === 'larva' && b.hungry && !b.dead && b.colony === this).length;
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

  // ---- food within the foragers' reach -----------------------------------------
  forageSpawns() {
    // seeds drift down from the canopy, or ripen in the grass. What counts
    // is the food within the foragers' reach: seeds lying across the map
    // feed nobody, so they neither fill the caps nor hold back the harvest.
    // Scarce times bring a better one (and keep the sim survivable); the
    // season sets the bounty, and winter brings none at all.
    const mul = SEASON_FOOD[G.season];
    let foodNear = 0, seedsNear = 0, leavesNear = 0;
    for (const i of G.items) {
      if (i.dead || i.carried || Math.abs(i.x - this.x) >= FORAGE_R) continue;
      if (i.kind === 'leaf') leavesNear++;
      if (!ITEM_DEF[i.kind] || !ITEM_DEF[i.kind].food) continue;
      foodNear++;
      if (i.kind === 'seed') seedsNear++;
    }
    const seedChance = (foodNear < 8 ? SEED_RATE_LEAN : SEED_RATE) * mul;
    if (seedsNear < SEED_CAP && Math.random() < seedChance) {
      const trees = G.trees.filter(t => Math.abs(t.x - this.x) < FORAGE_R);
      let sx;
      if (trees.length && Math.random() < 0.5) {
        // seeds fall from the canopy and land on the forest floor below
        const t = trees[Math.floor(Math.random() * trees.length)];
        const side = Math.random() < 0.5 ? -1 : 1;
        sx = Math.round(t.x + side * (30 + Math.random() * 60));
      } else {
        sx = Math.round(this.x + (Math.random() - 0.5) * 2 * FORAGE_R);
      }
      sx = Math.max(20, Math.min(WORLD_W - 20, sx));
      G.items.push(G.makeItem('seed', sx, T.surf[sx] - 8));
    }
    // leaf scraps on the floor (autumn's leaf fall brings plenty)
    const leafMul = G.season === 2 ? 4 : mul > 0 ? 1 : 0;
    if (leavesNear < 5 * Math.max(1, leafMul / 2) && Math.random() < 0.0012 * leafMul) {
      const lx = Math.max(20, Math.min(WORLD_W - 20, Math.round(this.x + (Math.random() - 0.5) * 2 * FORAGE_R)));
      G.items.push(G.makeItem('leaf', lx, T.surf[lx] - 6));
    }
  }
}

// ---------------------------------------------------------------------------
// the wider world: seeds and leaves for those who roam, fauna and predators
// ---------------------------------------------------------------------------
function worldSpawns() {
  const col = G.colony;   // the predators come for the players' nest
  const mul = SEASON_FOOD[G.season];
  let seedsFar = 0, leavesFar = 0;
  for (const i of G.items) {
    if (i.dead || i.carried) continue;
    if (G.colonies.some(c => Math.abs(i.x - c.x) < FORAGE_R)) continue;
    if (i.kind === 'seed') seedsFar++;
    else if (i.kind === 'leaf') leavesFar++;
  }
  // a sprinkling of seeds across the wider forest
  if (seedsFar < 12 && Math.random() < 0.002 * mul) {
    const x = 40 + Math.random() * (WORLD_W - 80);
    G.items.push(G.makeItem('seed', x, T.surf[Math.floor(x)] - 8));
  }
  const leafMul = G.season === 2 ? 4 : mul > 0 ? 1 : 0;
  if (leavesFar < 4 * Math.max(1, leafMul / 2) && Math.random() < 0.0008 * leafMul) {
    const lx = Math.round(40 + Math.random() * (WORLD_W - 80));
    G.items.push(G.makeItem('leaf', lx, T.surf[lx] - 6));
  }

  const counts = {};
  for (const b of G.bugs) if (!b.dead) counts[b.kind] = (counts[b.kind] || 0) + 1;
  const count = k => counts[k] || 0;

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
  const winter = G.isWinter();
  const centiCap = Math.min(2, 1 + Math.floor(day / 4)) + (winter ? 1 : 0);
  if (count('centipede') < centiCap && day >= 2 && Math.random() < (winter ? 0.0015 : 0.0004)) {
    const x = 100 + Math.random() * (WORLD_W - 200);
    G.bugs.push(new Bug(x, T.surf[Math.floor(x)] + 300 + Math.random() * 400, 'centipede'));
    G.msg('m_centi', [], '#ff8040');
    G.sfx('danger');
  }
  // wasps hunt by day
  const waspCap = Math.min(3, 1 + Math.floor(day / 3));
  if (count('wasp') < waspCap && day >= 1 && !night && !winter && Math.random() < 0.0005) {
    const x = Math.random() < 0.5 ? 60 : WORLD_W - 60;
    G.bugs.push(new Bug(x, T.surf[Math.floor(x)] - 80, 'wasp'));
    G.msg('m_wasp', [], '#ff8040');
    G.sfx('danger');
  }
  // a rare armored heavyweight, once the colony is established
  if (count('beetle') < 1 && day >= 3 && col && Math.random() < 0.00018) {
    const x = Math.random() < 0.5 ? 30 : WORLD_W - 30;
    G.bugs.push(new Bug(x, T.surf[Math.floor(x)] - 8, 'beetle'));
    G.msg('m_beetle', [], '#ff8040');
    G.sfx('danger');
  }
}

// ---------------------------------------------------------------------------
// the contested food site: each summer a fruit falls between the two nests.
// Its pieces (items flagged `site`) are good food, they keep all summer, and
// both colonies' foragers go for them. G.contested = { x, y, year, spawned,
// active, got: [pieces delivered by colony index] }
// ---------------------------------------------------------------------------
function updateContested() {
  const cs = G.contested;
  if (G.season === SUMMER) {
    if (!cs || cs.year !== G.year) {
      // the fruit falls somewhere in the no-man's-land between the nests
      const a = G.colonies[0], b = G.colonies[1];
      const mid = b ? (a.x + b.x) / 2 : a.x + 1200;
      const x = Math.round(Math.max(60, Math.min(WORLD_W - 60, mid + (Math.random() - 0.5) * 500)));
      G.contested = { x, y: T.surf[x] - 6, year: G.year, spawned: 0, active: true, got: [] };
      dropSitePieces(SITE_PIECES);
      G.msg('m_siteFell', [], '#ffb040');
      G.sfx('task');
    } else if (cs.active && G.tick % SITE_REFILL === 0 && cs.spawned < SITE_MAX) {
      const left = G.items.filter(i => i.site && !i.dead && !i.carried &&
        Math.abs(i.x - cs.x) < 40).length;
      if (left < 5) dropSitePieces(3);
    }
  } else if (cs && cs.active) {
    // summer's over: what's left of the fruit withers away
    cs.active = false;
    for (const i of G.items) if (i.site && !i.carried) i.dead = true;
  }
}

function dropSitePieces(n) {
  const cs = G.contested;
  for (let k = 0; k < n && cs.spawned < SITE_MAX; k++) {
    const x = Math.max(20, Math.min(WORLD_W - 20, Math.round(cs.x + (Math.random() - 0.5) * 24)));
    const it = G.makeItem('berry', x, T.surf[x] - 6 - Math.random() * 4);
    it.site = true;
    G.items.push(it);
    cs.spawned++;
  }
}

// ---------------------------------------------------------------------------
// the year's milestones: three a season, kept in each player colony's
// `objectives` (saved; G.objectives is the players' colony's). An AI colony
// has none, and every function here leaves it be.
// kind 'level': a value the colony reaches (checked once a second);
// 'count': events counted during the season; 'end': judged as the season
// ends (meanwhile the progress shows the current value). Missing one never
// ends the game -- it only costs stars at the nuptial flight. `grow`: what
// the need rises by each later year (the nest is bigger by then, and a goal
// met last year shouldn't tick itself off the moment its season starts).
// ---------------------------------------------------------------------------
const SEAL_NEED = 45;   // winter recounts (8 s apart) with the entrance shut
const OBJECTIVES = [
  // spring: establish the nest
  [{ id: 'storage2', kind: 'level', need: 2, grow: 1 }, { id: 'raise', kind: 'count', need: 5 },
    { id: 'food100', kind: 'level', need: 100, grow: 50 }],
  // summer: expand, and contest the fallen fruit with the rival
  [{ id: 'mound', kind: 'level', need: 250, grow: 150 }, { id: 'pop25', kind: 'level', need: 25, grow: 10 },
    { id: 'contested', kind: 'count', need: 8, grow: 4 }],
  // autumn: prepare for winter and the next generation
  [{ id: 'stockpile', kind: 'end', need: 150, grow: 50 },
    { id: 'royal', kind: 'level', need: PRINCESS_ROYAL, grow: 600 },
    { id: 'princess', kind: 'count', need: 1 }],
  // winter: survive
  [{ id: 'queen', kind: 'end', need: 1 }, { id: 'sealed', kind: 'count', need: SEAL_NEED, pct: true },
    { id: 'centipedes', kind: 'count', need: 3 }],
];
const OBJ_SCORE = 200, OBJ_CRYSTALS = 2;   // reward per milestone

function newObjectives(year, season, yearDone) {
  return {
    year, season,
    yearDone: yearDone || 0,   // milestones done this year (stars)
    list: OBJECTIVES[season].map(o => ({
      id: o.id, n: 0, need: o.need + (o.grow || 0) * Math.max(0, year - 1), done: false,
    })),
  };
}

function objDef(id) {
  for (const s of OBJECTIVES) for (const o of s) if (o.id === id) return o;
  return null;
}

// something countable happened for colony c (default: the players'): an
// ant raised, a crystal stored, ...
function objEvent(id, n, c) {
  c = c || G.colony;
  const ob = c && c.objectives;
  if (!ob) return;
  const o = ob.list.find(o => o.id === id);
  if (!o || o.done) return;
  o.n += n;
  if (o.n >= o.need) completeObjective(o, c);
}

// the current value behind a 'level' or 'end' milestone
function objLevel(id, c) {
  c = c || G.colony;
  switch (id) {
    case 'storage2': return c.chambers.filter(ch => ch.type === 'storage' && ch.area >= CH_MIN_AREA).length;
    case 'food100': case 'stockpile': return Math.floor(c.food);
    case 'mound': return c.mound.size;
    case 'pop25': return c.members().length;
    case 'royal': return c.caps ? c.caps.royalMax : 0;
    case 'queen': return c.queen() ? 1 : 0;
  }
  return 0;
}

function updateObjectives(c) {
  c = c || G.colony;
  const ob = c.objectives;
  if (!ob) return;
  for (const o of ob.list) {
    if (o.done) continue;
    const def = objDef(o.id);
    if (!def || def.kind === 'count') continue;
    o.n = objLevel(o.id, c);
    if (def.kind === 'level' && o.n >= o.need) completeObjective(o, c);
  }
}

function completeObjective(o, c) {
  c = c || G.colony;
  o.done = true;
  c.objectives.yearDone++;
  c.stats.milestones = (c.stats.milestones || 0) + 1;
  c.score += OBJ_SCORE;
  c.crystals += OBJ_CRYSTALS;
  c.say('m_milestone', [{ key: 'o_' + o.id, args: [o.need] }, OBJ_CRYSTALS], '#ffe040');
  G.sfx('task');
}

// the season is over: judge its end-of-season milestones
function closeObjectives(c) {
  c = c || G.colony;
  const ob = c.objectives;
  for (const o of ob.list) {
    const def = objDef(o.id);
    if (o.done || !def || def.kind !== 'end') continue;
    o.n = objLevel(o.id, c);
    if (o.n >= o.need) completeObjective(o, c);
  }
  c.say('m_seasonDone', [ob.list.filter(o => o.done).length], '#e0c080');
}
