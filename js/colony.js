// MAUR -- colony simulation: food, brood cycle, tasks, ambient spawning.
'use strict';

// the colony year: four seasons of SEASON_DAYS days (a FULL year ~48
// minutes). The calendar is derived from G.tick alone, so saves carry it for
// free -- given the length of a day. A match may be played SHORT or QUICK
// (G.yearLen, see setYearLen in game.js): the same year of twelve days, each
// day shorter. Everything the calendar paces (the seasons, a raid a day, the
// day's dig task, the predators growing bolder, the night) follows DAY_LEN;
// what an ant does in a second (walking, digging, eating, the food growing
// back) stays as it is, so a shorter year has its milestones scaled to the
// time it gives (objNeed) and its brood and queen a little quicker
// (yearPace). A persistent world is always FULL.
const DAY_FULL = 60 * 240;   // 4 minutes of frames per day
const YEAR_LENS = { full: DAY_FULL, short: DAY_FULL / 2, quick: DAY_FULL / 3 };   // 48, 24, 16 minutes
const YEAR_LEN_IDS = ['full', 'short', 'quick'];
let DAY_LEN = DAY_FULL;      // (set by setYearLen; a let, so every sim file sees the change)
// the share of a FULL year's time this one gives (1, 1/2, 1/3)
function yearShare() { return DAY_LEN / DAY_FULL; }
// how much quicker brood grows and the queens lay in a shorter year: the
// square root of how much shorter it is (x1.41 SHORT, x1.73 QUICK) -- the
// growth a colony needs in autumn (princesses) has to fit a shorter autumn,
// but a colony growing twice as fast would race through the milestones
function yearPace() { return Math.sqrt(DAY_FULL / DAY_LEN); }
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
const QUEEN_WARN_T = 600;  // ticks between 'our queen is under attack' warnings

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
const CH_REACH = 500;     // a player's new marker within this of the entrance (x)...
const CH_MAX = 16;        // ...and at most this many markers in all: a nest, not a
                          // storage flag on every crystal vein across the map
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
// the stores a princess egg wants: 60% of their room, at least 60 and never
// more than PRINCESS_FOOD -- all three as much smaller as a shorter year's
// food targets are (the square root of its share: x0.71 SHORT), and QUICK's
// a little smaller still (share^0.75: x0.44) and without the 60% of the
// room, its autumn is too short to stock a big storage that far
function princessFood(cap) {
  const s = yearShare(), k = Math.pow(s, s < 0.5 ? 0.75 : 0.5);
  if (s < 0.5) return 60 * k;
  return Math.max(60 * k, Math.min(PRINCESS_FOOD * k, cap * 0.6 * k));
}

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
const AI_EXPAND_DAYS = 2;    // FULL days between them (real time: a shorter year's days are shorter,
                             // and the rival mustn't outgrow a colony growing at the same pace)
const AI_EXPAND_STEP = 40;   // ticks per bite of the dig
const AI_CHAMBER_TYPES = ['storage', 'nursery', 'barracks'];
// an idle players' colony grows slowly too: once its nest has been full for
// half a day its own workers dig out a nursery, at most once a season and
// never in spring (a player who digs and marks chambers grows far faster)
// (half a day of whatever length the year's days are: see selfDigFull)
function selfDigFull() { return DAY_LEN / 2; }
// an AI queen keeps a winter reserve: from autumn on she lays only while
// the stores hold this much food per ant
const AI_RESERVE = 3;
const PLAYER_RESERVE = 2;    // ...and the players' queen this much

// raids: soldiers and workers march from the AI nest on its enemy's, fight,
// steal from the stores and carry it home. At most one a day, never in
// winter, bolder as the year goes on. (A shorter year: at most one every
// FULL day's worth of time, raidGap -- the raided colony grows at the same
// pace, and twice the raids would leave it nothing to grow with.)
const RAID_POP = 14;         // the raiding colony needs this many ants...
const RAID_FOOD = 40;        // ...and this much food in store
const RAID_CHANCE = 1 / (DAY_FULL * 0.4);  // per tick once ready (scaled by boldness)
function raidGap() { return Math.max(1, Math.round(DAY_FULL / DAY_LEN)); }   // days between raids
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
// a players' colony calls its own raids (Z): one at a time, the next no
// sooner than RAID_CALL_CD ticks after the last one is home (real time,
// whatever the year's length), never in winter
const RAID_CALL_CD = 60 * 120;
const RAID_STATES = ['raid', 'fight', 'flee', 'idle', 'home', 'return'];

// more players (G.playerSlots, see playerSlots in game.js): each one beyond
// the first gives a played colony room for another ant and a bit (co-op
// players' ants are workers on top of the household) and more storage, and
// makes the AI rival in co-op that much bigger -- its household, its caps,
// how many it needs before it raids and how many it sends (not how fast its
// queen lays: a bigger household already fills the bigger nest, and a
// faster queen had it raiding in spring) (versus has no AI rival: both sides play by the same rules). The
// milestones grow too (see OBJECTIVES). With one player every factor is 1.
const SLOT_POP = 1.5;        // population cap per extra player...
const SLOT_FOOD = 10;        // ...and food cap
const SLOT_RIVAL = 0.1;      // the AI rival: +10% per extra player (its raids already
                             // grow each day, and NPC defenders don't grow with the players)
const SLOT_OBJ = 0.15;       // a scaled milestone's target: +15% per extra player
function slotScale(k) { return 1 + k * (playerSlots() - 1); }

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

// blueprints: in plan mode (the client's B) a player's ant braces and a
// cursor paints planned pixels -- marks on open air, in a material, that
// block nothing -- into its colony's plan. Holding F by them fills them from
// the ant's load; idle workers fill them from the colony's stocks (the spoil
// that overflows a player's full load, what the NPCs dig on their errands,
// a load unloaded at the storage with E).
const PLAN_MAX = 6000;       // planned pixels a colony may have at once
const PLAN_REACH = 90;       // a player's plan cursor keeps this close to its ant
const PLAN_BRUSH = 3;        // the plan brush's radius
const PLAN_JUMP = 24;        // a cursor move longer than this in a tick starts a new stroke
const PLAN_FILL_R = 18;      // F fills planned pixels this close to the ant's middle...
const PLAN_FILL_N = 12;      // ...this many at most per BUILD_CD, in a clump this wide:
const PLAN_CLUMP = 4;
const STOCK_CAP = 300;       // the colony's soil and thatch stocks hold this much each...
const STOCK_SLOT = 50;       // ...and this much more per player beyond the first
const BUILDERS_MAX = 3;      // NPC builders at once at most...
const BUILDERS_SHARE = 0.15; // ...and no more than this share of the colony's workers
const BUILD_RECRUIT = 60;    // ticks between the colony's looks for idle hands
const PLAN_FOOD = 30;        // a hungrier colony keeps every worker foraging
const NPC_BUILD_R = 12;      // a builder fills planned pixels this close to its middle...
const NPC_BUILD_N = 4;       // ...this many a bite...
const NPC_BUILD_CD = 20;     // ...a bite every this many ticks
const NPC_BUILD_T = 2400;    // ticks a builder may take getting there before it gives up
const NPC_BUILD_NEAR = 80;   // in the same place as the spot and this close: straight to it
const PLAN_SPREAD = 24;      // builders work spots at least this far apart
const PLAN_SHUN_T = 3600;    // a spot no builder could reach is left alone this long
const PLAN_CELL = 16;        // ...in cells this big

// a blueprint as compact data (saves, the network): [index, value] entries
// sorted by index, packed as runs of consecutive pixels of one value --
// [gap, length, value, ...], gap counting the pixels since the end of the
// last run. A value of 0 is a pixel leaving the plan (the network's deltas).
function planPack(entries) {
  entries.sort((a, b) => a[0] - b[0]);
  const out = [];
  let end = 0;
  for (let k = 0; k < entries.length;) {
    const s = entries[k][0], v = entries[k][1];
    let n = 1;
    while (k + n < entries.length && entries[k + n][0] === s + n && entries[k + n][1] === v) n++;
    out.push(s - end, n, v);
    end = s + n;
    k += n;
  }
  return out;
}
// fn(index, value) for every pixel of a packed list; false if it's junk
// (the network's and the saves' data is checked here, pixel by pixel after)
function planUnpack(arr, fn) {
  if (!Array.isArray(arr)) return false;
  const size = WORLD_W * WORLD_H;
  let p = 0;
  for (let k = 0; k + 2 < arr.length; k += 3) {
    const gap = arr[k], n = arr[k + 1], v = arr[k + 2];
    if (!Number.isInteger(gap) || !Number.isInteger(n) || gap < 0 || n < 1 || p + gap + n > size) return false;
    p += gap;
    for (let j = 0; j < n; j++) fn(p + j, v);
    p += n;
  }
  return true;
}
// a material a blueprint may hold (what the build key places)
function planMat(v) { return v === M_PACKED || v === M_THATCH || v === M_GATE; }
// the load or stock a material is built from
function planLoad(m) { return m === M_THATCH ? 'thatch' : 'soil'; }

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
    // the blueprint its players paint in plan mode (pixel index -> the
    // material planned there), the stocks its builders fill it from, and
    // the spots no builder could get to lately (cell -> until when)
    this.plan = new Map();
    this.planDirty = null;  // (online: the pixels changed since the last snapshot, see planSet)
    this.stock = { soil: 0, thatch: 0 };
    this.planShun = new Map();
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
  // the nearest armed foe within r of the nursery (every tending nurse asks,
  // every tick: one look per tick and radius serves them all)
  nurseryFoe(r) {
    if (this.nfT !== G.tick) { this.nfT = G.tick; this.nf = {}; }
    if (!(r in this.nf)) this.nf[r] = G.nearestFoe(this.nursery.x, this.nursery.y, r, this, true);
    return this.nf[r];
  }

  // a message (or a sound heard anywhere) for this colony's players only
  // (an AI colony keeps quiet)
  say(key, args, color) { if (this.player) G.msg(key, args, color, null, this.idx); }
  sfx(k) { if (this.player) G.sfx(k, null, null, null, this.idx); }

  // log a wound to this colony's queen in the ledger (ci: the colony that
  // dealt it, -1 for hunger, cold, bugs -- anything that isn't an ant)
  // An enemy ant's bite also warns this colony's players (now and then: the
  // queen dying with no heir loses it all)
  woundQueen(ci, dmg) {
    if (!(dmg > 0)) return;
    const qd = this.queenDmg || (this.queenDmg = {});
    qd[ci] = (qd[ci] || 0) + dmg;
    if (ci >= 0 && ci !== this.idx && this.player && !(G.tick - (this.queenWarnT || -1e9) < QUEEN_WARN_T)) {
      this.queenWarnT = G.tick;
      this.say('m_queenAttacked', [], '#ff4030');
      this.sfx('danger');
    }
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
    // (room for more players, or an AI rival grown to match them)
    const extra = this.player ? playerSlots() - 1 : 0;
    const rs = this.player ? 1 : slotScale(SLOT_RIVAL);
    for (const ch of this.chambers) {
      const room = this.areaAt(ch.x, ch.y, ch);
      if (!(ch.claimed >= 0)) ch.claimed = room;
      ch.area = Math.min(room, ch.claimed);
      if (ch.area >= CH_MIN_AREA) sum[ch.type] += ch.area;
      if (ch.type === 'royal') royalMax = Math.max(royalMax, ch.area);
    }
    this.caps = {
      // never below what the queen needs to keep laying (eggs need 30)
      food: Math.round(Math.max(40, Math.round(20 + sum.storage * 0.1)) * rs) + SLOT_FOOD * extra,
      brood: Math.round((1 + Math.floor(sum.nursery / 200)) * rs),
      pop: Math.floor(Math.max(10, Math.floor((sum.nursery + sum.barracks) / 75)) * rs) + Math.round(SLOT_POP * extra),
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

  // ---- the blueprint and the stocks its builders fill it from ---------------
  stockCap() { return STOCK_CAP + STOCK_SLOT * (playerSlots() - 1); }
  // spoil into the stocks (whatever doesn't fit, spills)
  bank(soil, thatch) {
    const cap = this.stockCap();
    if (soil > 0) this.stock.soil = Math.min(cap, this.stock.soil + soil);
    if (thatch > 0) this.stock.thatch = Math.min(cap, this.stock.thatch + thatch);
  }

  // plan pixel i as material v (0: out of the plan). Online the server
  // (G.planSync) notes the pixels changed for the next snapshot's deltas.
  planSet(i, v) {
    if ((this.plan.get(i) || 0) === v) return false;
    if (v) this.plan.set(i, v); else this.plan.delete(i);
    if (G.planSync) (this.planDirty || (this.planDirty = new Set())).add(i);
    return true;
  }
  // the changes since the last call, packed (each pixel as it stands now), or null
  planDrain() {
    const d = this.planDirty;
    if (!d || !d.size) return null;
    const out = [];
    for (const i of d) out.push([i, this.plan.get(i) || 0]);
    d.clear();
    return planPack(out);
  }
  // the whole blueprint, packed
  planPacked() { return planPack([...this.plan]); }
  // a packed blueprint put back (a save, the world joined): open air and a
  // build material only, at most PLAN_MAX
  planLoadPacked(arr) {
    this.plan = new Map();
    this.planDirty = null;
    planUnpack(arr, (i, v) => {
      if (this.plan.size < PLAN_MAX && planMat(v) && T.m[i] === M_AIR) this.plan.set(i, v);
    });
  }

  // a spot of the blueprint for builder `a` to make for: the planned pixel
  // nearest it that the stocks can build, clear of the other builders' spots
  // and of the spots shunned lately (and in winter only out of the cold).
  // Pixels built over meanwhile are dropped from the plan here. null if none.
  planSpot(a, builders) {
    const W = WORLD_W, now = G.tick;
    for (const [k, t] of this.planShun) if (t <= now) this.planShun.delete(k);
    const winter = G.isWinter(), probe = { x: 0, y: 0 };
    let best = -1, bd = Infinity;
    const gone = [];
    for (const [i, v] of this.plan) {
      if (T.m[i] !== M_AIR) { gone.push(i); continue; }
      if (this.stock[planLoad(v)] < 1) continue;
      const x = i % W, y = (i / W) | 0;
      const d = dist2(x, y, a.x, a.y);
      if (d >= bd) continue;
      if (this.planShun.has(Math.floor(x / PLAN_CELL) * 4096 + Math.floor(y / PLAN_CELL))) continue;
      let taken = false;
      for (const o of builders) {
        if (o.target && dist2(x, y, o.target.x, o.target.y) < PLAN_SPREAD * PLAN_SPREAD) { taken = true; break; }
      }
      if (taken) continue;
      if (winter) { probe.x = x; probe.y = y; if (!sheltered(probe)) continue; }
      bd = d; best = i;
    }
    for (const i of gone) this.planSet(i, 0);
    if (best < 0) return null;
    const x = best % W, y = (best / W) | 0;
    const tg = { x, y, i: best, build: true };
    // down in a nest: by its tunnels to the chamber nearest the spot
    tg.nest = buriedInNest(tg);
    if (tg.nest) {
      let kd = Infinity;
      for (const key of ['entrance', 'junction', 'storage', 'nursery', 'queen']) {
        const p = a.navDest(key, tg.nest), d = dist2(p.x, p.y, x, y);
        if (d < kd) { kd = d; tg.key = key; }
      }
    }
    return tg;
  }
  // a spot builders couldn't get to (or build at) is left be a while
  planShunAt(x, y) {
    this.planShun.set(Math.floor(x / PLAN_CELL) * 4096 + Math.floor(y / PLAN_CELL), G.tick + PLAN_SHUN_T);
  }

  // builder `a` at its spot: up to NPC_BUILD_N planned pixels within
  // NPC_BUILD_R of it, from the stocks, nearest first (one material a bite),
  // never walling anyone in -- nor itself: never where it stands. Returns
  // the pixels placed (0: none could go this bite, someone's in the way), or
  // -1 when there's nothing left here to build or nothing to build it with.
  npcBuild(a) {
    const R = NPC_BUILD_R, W = WORLD_W;
    const cx = Math.round(a.x), cy = Math.round(a.y);
    const cand = [];
    for (let y = Math.max(0, cy - R); y <= Math.min(WORLD_H - 1, cy + R); y++) {
      for (let x = Math.max(0, cx - R); x <= Math.min(W - 1, cx + R); x++) {
        const d = dist2(x, y, a.x, a.y);
        if (d > R * R) continue;
        const i = y * W + x, v = this.plan.get(i);
        if (!v) continue;
        if (T.m[i] !== M_AIR) { this.planSet(i, 0); continue; }
        if (this.stock[planLoad(v)] >= 1) cand.push([d, i, v]);
      }
    }
    if (!cand.length) return -1;
    cand.sort((p, q) => p[0] - q[0]);
    const clear = buildClear(a.x, a.y, R);
    let mat = 0;
    const list = [];
    for (const [, i, v] of cand) {
      if (mat && v !== mat) continue;
      if (!clear(i % W, (i / W) | 0)) continue;
      mat = v;
      list.push(i);
      if (list.length >= NPC_BUILD_N) break;
    }
    if (!mat) return 0;
    const load = planLoad(mat);
    const n = T.placeAt(list, mat, null, Math.floor(this.stock[load])).length;
    this.stock[load] -= n;
    if (n > 0) {
      a.biteAnim = 5;
      G.fx('dirt', a.x + (list[0] % W - a.x) * 0.7, a.y + (((list[0] / W) | 0) - a.y) * 0.7, 1);
      G.sfx('build', a.x, a.y, 200);
    }
    return n;
  }

  // idle hands take up the blueprint: now and then one idle worker becomes
  // a builder (state 'build', see Ant.npcThink) -- while the plan has pixels
  // the stocks can build, the colony isn't hungry (its foragers come first),
  // and fewer than BUILDERS_MAX (and BUILDERS_SHARE of its workers) build
  updateBuilders() {
    if ((G.tick + this.idx * 31) % BUILD_RECRUIT !== 0 || !this.plan.size || this.food < PLAN_FOOD) return;
    if (this.stock.soil < 1 && this.stock.thatch < 1) return;
    let workers = 0, idle = null;
    const builders = [];
    for (const a of G.ants) {
      if (a.hp <= 0 || a.colony !== this || a.playerIdx >= 0 || a.caste !== 'worker') continue;
      workers++;
      if (a.state === 'build') builders.push(a);
      else if (!idle && a.state === 'idle' && !a.carry && !a.raiding && !(a.followT > 0) && !outInCold(a)) idle = a;
    }
    const cap = Math.min(BUILDERS_MAX, Math.max(1, Math.floor(workers * BUILDERS_SHARE)));
    if (!idle || builders.length >= cap) return;
    const tg = this.planSpot(idle, builders);
    if (!tg) return;
    idle.state = 'build'; idle.target = tg; idle.stateT = NPC_BUILD_T;
    idle.nav = null; idle.buildBlockN = 0;
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
      this.sfx('clank');
      return false;
    }
    this.crystals -= cost;
    this.upg[id] = (this.upg[id] || 0) + 1;
    this.say('m_upgraded', [{ key: 'up_' + id }, this.upg[id]], '#80e0ff');
    this.sfx('task');
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
    if (Math.abs(a.x - this.x) > CH_REACH) { refuse('m_markFar'); return; }
    if (this.chambers.length >= CH_MAX) { refuse('m_markMany'); return; }
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
    // -- marking more storage mustn't put princesses further off. A shorter
    // year gathers less in all: well stocked for it, see princessFood)
    if (this.food < princessFood(this.caps.food)) return false;
    return this.princessRoom();
  }
  // fewer princesses (adult or brood) than the royal chambers have room for
  princessRoom() {
    if (!this.caps.princess) return false;
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
      } else if (this.player && this.fullMsgT <= 0 && G.nearPlayer(this.storage.x, this.storage.y, this) < 400) {
        this.say('m_storageFullNpc', [], '#ff8040');
        this.fullMsgT = 3600;
      }
      return false;
    }
    // a piece of the contested site's fruit counts for whoever brings it in
    if (item.site && G.contested) {
      G.contested.got[this.idx] = (G.contested.got[this.idx] || 0) + 1;
      objEvent('contested', 1, this);
    }
    // a golden seed: brought home (its own colony's), or denied (the other's)
    if (item.kind === 'relic') { relicIn(item, this, who); return true; }
    if (item.kind === 'crystal') {
      // treasure, not food: the colony's currency for upgrades (and a
      // little score)
      this.crystals++;
      this.stats.crystalsFound++;
      if (who && who.playerIdx >= 0 && G.players[who.playerIdx]) {
        G.players[who.playerIdx].stats.crystals++;
        G.players[who.playerIdx].stats.seek++;   // (seeker's work, see jobValue)
      }
      this.score += 20;
      this.progress('crystal', 1);
      objEvent('crystals', 1, this);
      this.say('m_crystal', [this.crystals], '#80e0ff');
      this.sfx('task');
    } else if (item.kind === 'leaf' && who && who.playerIdx < 0 &&
               this.gardenNear(this.storage.x, this.storage.y, 1e5)) {
      // the colony passes a forager's leaf on to the fungus garden
      this.feedGarden(this.gardenNear(this.storage.x, this.storage.y, 1e5), LEAF_UNITS);
    } else {
      // (a forager's load is worth more: see JOB_CARRY in game.js)
      const worth = (Number(item.value) || 0) * (who && onJob(who, 'forager') ? JOB_CARRY : 1);
      const v = Math.min(worth, this.caps.food - this.food);
      this.food += v;
      this.stats.foodGathered += v;
      if (who && who.playerIdx >= 0) {
        if (G.players[who.playerIdx]) G.players[who.playerIdx].stats.food += v;
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
      this.sfx('task');
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
        this.sfx('starve');
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
      // winter: she lays at a fraction of her pace (a shorter year: a
      // little quicker all year, see yearPace)
      this.eggT -= (G.isWinter() ? WINTER_LAY : 1) * G.pace;
      const broodCount = this.broodCount();
      const caps = this.caps;
      // (from autumn on a queen keeps the winter stores: no eggs into the
      // hungry months unless they hold a reserve per ant -- the AI's queen
      // a bigger one; a players' colony that grew big in summer otherwise
      // laid its stores away and starved in autumn or winter)
      // (a shorter year's winter is shorter: the reserve as much smaller)
      let need = G.season >= AUTUMN ? Math.max(30, pop * (this.player ? PLAYER_RESERVE : AI_RESERVE) * yearShare()) : 30;
      // (autumn with princess room to fill: she saves up for a princess egg
      // instead of laying the stores away a worker egg at a time)
      if (G.season === AUTUMN && this.princessRoom()) need = Math.max(need, princessFood(this.caps.food));
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
          this.say('m_nestFull', [], '#ff9040');
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
    if (!this.defeated) this.spotQueen(queen);

    if (this.player) {
      if (G.tick % 60 === 0) updateObjectives(this);
      if (!this.defeated) this.updateExpansion(pop);
      if (this.raid) this.updateRaid(pop);
      this.updateBuilders();
      // tasks
      this.taskT--;
      // (versus: the deciding flight is flying -- no new tasks to hand out)
      if (this.taskT <= 0 && !(G.flight && G.mode === 'versus')) {
        this.taskT = 180;
        this.generateTasks();
      }
      this.checkTasks();
      for (const t of this.tasks) if (t.done && t.doneT > 0) t.doneT--;
      this.tasks = this.tasks.filter(t => !t.done || t.doneT > 0);
    } else if (!this.defeated) {
      this.updateAI(pop);
    }

    this.forageSpawns();
  }

  // a player of another colony who gets close to the queen finds her: the
  // map marks her (for that player's colony; a versus side finds the other's)
  spotQueen(queen) {
    if (!queen || this.queenSeen || G.tick % 30 !== 0) return;
    for (const p of G.players) {
      const a = p.ant;
      if (a && a.hp > 0 && a.colony !== this && dist2(a.x, a.y, queen.x, queen.y) < 140 * 140) {
        this.queenSeen = true;
        a.colony.say(G.mode === 'versus' ? 'm_queenFoundVs' : 'm_queenFound', [], '#ff6050');
        a.colony.sfx('danger');
        break;
      }
    }
  }

  // ---- the AI colony: growth, raids -------------------------------------------
  updateAI(pop) {
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
      // (what the dig brings up goes to the stocks, for the builders)
      const res = T.dig(p.x, p.y, p.r, 1, false, SPARE_BUILT);
      this.bank(res.soil, res.thatch);
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
      if (G.season === SPRING || this.fullT < selfDigFull()) return;
      if (Math.floor(this.lastExpandDay / SEASON_DAYS) === Math.floor(G.day / SEASON_DAYS) && this.expandN > 0) return;
    } else {
      if (this.expandN >= AI_EXPAND_MAX || G.day < this.lastExpandDay + AI_EXPAND_DAYS * raidGap()) return;
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
          target.say(this.player ? 'm_raidP' : 'm_raid', [], '#ff5040');
          target.sfx('danger');
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
          if (r.warned && raiders.length && r.t - (r.nearT || 0) < 1200) target.say(this.player ? 'm_raidOverP' : 'm_raidOver', [], '#e0c080');
          // (turned back at the nest: its defenders at home get the guard credit)
          if (r.warned && !looted && target.player) raidRepelled(target);
          this.say('m_raidBack', [Math.round(r.stolen)], '#e0c080');
        }
      } else if (!raiders.length) {
        this.raid = null;
        if (this.player) this.raidReadyT = G.tick + RAID_CALL_CD;
      } else if ((r.rt = (r.rt || 0) + 1) > RAID_HOME_T) {
        // stragglers that can't find their way home: just ants again
        for (const a of raiders) {
          a.raiding = false; a.raidRole = null;
          if (a.state === 'home') { a.state = 'idle'; a.stateT = 60; a.nav = null; }
        }
        this.raid = null;
        if (this.player) this.raidReadyT = G.tick + RAID_CALL_CD;
      }
      return;
    }
    if (this.player || G.tutorial) return;   // (the players call theirs: callRaid; LEARN TO ANT is calm)
    if (G.isWinter() || G.day < 2 || G.day < this.lastRaidDay + raidGap()) return;
    // (against more players: a bigger colony before it goes, a bigger party)
    const rs = slotScale(SLOT_RIVAL);
    if (pop < Math.round(RAID_POP * rs) || this.food < RAID_FOOD) return;
    const yearDay = G.day % YEAR_DAYS;
    const bold = RAID_BOLD[G.season] * (G.year >= 2 ? 1.5 : 1);
    if (Math.random() >= RAID_CHANCE * bold) return;
    const enemy = this.enemy();
    if (enemy) this.startRaid(enemy, Math.round((4 + Math.floor(yearDay / 2) + (G.year >= 2 ? 2 : 0)) * rs), pop);
  }

  // send out up to n raiders (soldiers first, one kept home; half of them
  // workers to carry off the loot). Returns the number sent.
  startRaid(enemy, n, pop) {
    if (pop === undefined) pop = this.members().length;
    n = Math.max(3, Math.min(Math.round(RAID_MAX * slotScale(SLOT_RIVAL)), n, Math.floor(pop * 0.4)));
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

  // player pIdx calls a raid (Z): the colony's fit NPCs march on the enemy's
  // nest the way the red AI's raiders do -- soldiers to fight, workers to
  // carry off food -- and the players go along as they like. Returns true
  // if a raid set out.
  callRaid(pIdx) {
    const no = key => { G.msg(key, [Math.ceil((this.raidReadyT - G.tick) / 60)], '#ff8040', pIdx); G.sfx('clank'); };
    if (this.raid) return no('m_raidOn');
    if (G.isWinter()) return no('m_raidWinter');
    if (G.tick < (this.raidReadyT || 0)) return no('m_raidWait');
    const enemy = this.enemy();
    const n = enemy ? this.startRaid(enemy, RAID_MAX) : 0;
    if (!n) return no('m_raidFew');
    G.msg('m_raidGo', [n], '#ff8040', null, this.idx);
    this.sfx('danger');
    return true;
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
      if (!this.raid.stolen) enemy.say(this.player ? 'm_raidStealP' : 'm_raidSteal', [], '#ff5040');
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
      this.say('m_newTask', [{ key: 't_gather' }], '#80ff80');
    }
    const hungry = G.brood.filter(b => b.kind === 'larva' && b.hungry && !b.dead && b.colony === this).length;
    if (hungry > 0 && !this.active('feed')) {
      tasks.push({ type: 'feed', n: 0, need: Math.min(2, hungry), reward: 40 });
      this.say('m_newTask', [{ key: 't_feed' }], '#80ff80');
    }
    const pred = G.bugs.find(b => b.predator && !b.dead &&
      Math.abs(b.x - this.x) < 400);
    if (pred && !this.active('hunt')) {
      tasks.push({
        type: 'hunt', kind: pred.kind,
        targetId: pred.id, n: 0, need: 1, reward: 100
      });
      this.say('m_defend', [], '#ff8040');
      this.sfx('danger');
    }
    if (G.day > this.lastDigTaskDay && G.day >= 1 && !this.active('dig')) {
      this.lastDigTaskDay = G.day;
      tasks.push({ type: 'dig', n: 0, need: 600, reward: 60 });
      this.say('m_newTask', [{ key: 't_dig' }], '#80ff80');
    }
    // a prospecting expedition: dig deep below the nest for a crystal
    if (G.day >= 1 && G.day > (this.lastCrystalTaskDay || 0) + 1 &&
        !this.active('crystal') && Math.random() < 0.35) {
      this.lastCrystalTaskDay = G.day;
      tasks.push({ type: 'crystal', n: 0, need: 1, reward: 150 });
      this.say('m_newTask', [{ key: 't_crystal' }], '#80e0ff');
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
    this.say('m_taskDone', [t.reward], '#ffe040');
    this.sfx('task');
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

  // (LEARN TO ANT: no predators but the spider its chapter brings)
  if (G.tutorial) return;
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
// the golden seed: halfway through spring, summer and autumn (RELIC_AT of
// the season, so it keeps to a SHORT or QUICK year's clock; a warning at
// RELIC_WARN) a golden seed falls for each played colony in the forest
// BEYOND its rival -- past the enemy's mound, on the far side from home
// (co-op: past the red AI's nest, for the players' colony only). Any ant can
// carry it (an item, kind 'relic', `rcol` the colony it is for), slowed to
// RELIC_SLOW, home through or around the enemy's ground: into its own
// colony's storage it counts as a milestone of the year (for the flight's
// second star: 8 of the 12, see startFlight), versus the tie-break after the
// princesses (endFlight), plus RELIC_SCORE and RELIC_CRYSTALS. Into the
// other colony's storage it is denied: it crumbles, and the denier gets
// RELIC_DENY. Its carrier shows on the enemy's map (and the server never
// hides it, see server/snapshot.js). A carrier that dies drops it where it
// fell; whoever comes first may pick it up -- NPC workers fetch a dropped
// seed lying within RELIC_FETCH of their nest (theirs: home; the enemy's:
// denied), and a home side's soldiers go for an enemy carrier within
// RELIC_ALARM of their nest (RELIC_GUARDS at a time). It lasts a season:
// left lying past that (or still out when the next one falls) it crumbles.
// No seed in winter (its surface would kill any carrier on the long way).
// G.relics = { k: the season (year*4+season) of the last fall, wk: of the
// last warning, side: [per colony index { ph, id, x, y, until, got, yr }] }:
// ph 'wait' (none out), 'lying', 'carried' (by its own side), 'taken' (by
// the enemy), 'home', 'denied' or 'lost'; got: brought home in year yr.
// ---------------------------------------------------------------------------
const RELIC_AT = 0.5, RELIC_WARN = 0.4;  // the season's share gone when it falls / when it is told
const RELIC_SEASONS = 3;     // spring, summer and autumn
const RELIC_BEYOND = [380, 700]; // it falls this far past the rival's mound
const RELIC_SLOW = 0.7;      // its carrier's speed
const RELIC_SCORE = 300, RELIC_CRYSTALS = 3, RELIC_DENY = 100;
const RELIC_ALARM = 800;     // a home side's soldiers chase an enemy carrier this near their nest
                             // (the whole stretch it falls in: lifting it raises the alarm)...
const RELIC_GUARDS = 3;      // ...this many at once (an AI colony: RELIC_GUARDS_AI)
const RELIC_GUARDS_AI = 2;
const RELIC_FETCH = 500;     // workers fetch a dropped seed lying this near their nest

function newRelics() { return { k: -1, wk: -1, side: [] }; }
// G.relics from a save (v11), every field checked (null: as a new world's)
const RELIC_PH = ['wait', 'lying', 'carried', 'taken', 'home', 'denied', 'lost'];
function restoreRelics(d) {
  const R = newRelics();
  if (!d || typeof d !== 'object') return R;
  const int = (v, lo) => Math.max(lo, Math.floor(Number(v) || 0));
  R.k = Number.isFinite(Number(d.k)) ? Math.floor(Number(d.k)) : -1;
  R.wk = Number.isFinite(Number(d.wk)) ? Math.floor(Number(d.wk)) : -1;
  const side = Array.isArray(d.side) ? d.side : [];
  for (let i = 0; i < side.length && i < 2; i++) {
    const s = side[i];
    if (!s || typeof s !== 'object') { R.side[i] = undefined; continue; }
    R.side[i] = {
      ph: RELIC_PH.includes(s.ph) ? s.ph : 'wait', id: int(s.id, 0),
      x: int(s.x, 0), y: int(s.y, 0), until: int(s.until, 0),
      got: Math.min(RELIC_SEASONS, int(s.got, 0)), yr: int(s.yr, 1), held: !!s.held,
    };
  }
  return R;
}
function relicSide(c) {
  const R = G.relics || (G.relics = newRelics());
  return R.side[c.idx] || (R.side[c.idx] = { ph: 'wait', id: 0, x: 0, y: 0, until: 0, got: 0, yr: G.year });
}
// the season's share gone (0..1)
function seasonFrac() {
  return ((G.day % SEASON_DAYS) * DAY_LEN + G.tick % DAY_LEN) / (SEASON_DAYS * DAY_LEN);
}
// the colony a seed for c falls beyond: its rival
function relicFoe(c) { return G.colonies.find(o => o !== c) || null; }
// the seed's item, while it lies or is carried
function relicItem(st) {
  if (!st || !st.id) return null;
  for (const it of G.items) if (it.id === st.id && !it.dead) return it;
  return null;
}
// the rival's name in a message to c's players (versus: the enemy)
function relicFoeKey(c) { return G.mode === 'versus' ? 'rl_enemyNest' : 'rl_redNest'; }

// the golden seeds colony c brought home in year yr (default: this one;
// the flight, on the first day of the next, counts the year it closes)
function relicsHome(c, yr) {
  const st = G.relics && G.relics.side[c.idx];
  return st && st.yr === (yr || G.year) ? st.got : 0;
}

function updateRelics() {
  const R = G.relics || (G.relics = newRelics());
  if (!G.colonies.length) return;
  // (LEARN TO ANT drops its one seed itself, see learn.js)
  if (!G.over && !G.tutorial && G.season < RELIC_SEASONS) {
    const k = (G.year - 1) * 4 + G.season, f = seasonFrac();
    if (f >= RELIC_WARN && f < RELIC_AT && R.wk < k) {
      R.wk = k;
      for (const c of G.colonies) {
        const r = relicFoe(c);
        if (!c.player || !r) continue;
        c.say('m_relicSoon', [{ key: relicFoeKey(c) }], '#ffd040');
        r.say('m_relicSoonFoe', [], '#ff9040');
      }
    }
    if (f >= RELIC_AT && R.k < k) {
      R.k = R.wk = k;
      for (const c of G.colonies) if (c.player && relicFoe(c)) dropRelic(c);
    }
  }
  if (G.tick % 10) return;   // (the rest six times a second)
  for (const c of G.colonies) {
    const st = R.side[c.idx];
    if (!st || !st.id) continue;
    const it = relicItem(st);
    if (!it) { if (st.ph !== 'home' && st.ph !== 'denied') st.ph = 'lost'; st.id = 0; continue; }
    st.x = Math.round(it.x); st.y = Math.round(it.y);
    const by = it.carried && it.carried.hp > 0 ? it.carried : null;
    const ph = by ? (by.colony === c ? 'carried' : 'taken') : 'lying';
    if (ph !== st.ph) relicNews(c, st.ph, ph, by);
    st.ph = ph;
    if (!by) {
      if (G.tick >= st.until) {
        it.dead = true;
        st.ph = 'lost'; st.id = 0;
        c.say('m_relicLost', [], '#c0a080');
        continue;
      }
      if (ph === 'lying' && st.held) it.dropped = true;
    } else st.held = true;
  }
}

// a golden seed for colony c falls beyond its rival's nest (last season's,
// if any is still out, crumbles)
function dropRelic(c) {
  const r = relicFoe(c);
  const st = relicSide(c);
  const old = relicItem(st);
  if (old) {
    if (old.carried) { old.carried.carry = null; old.carried = null; }
    old.dead = true;
  }
  const dir = Math.sign(r.x - c.x) || 1;
  // (where: from the world's seed, the season and the side -- its own rng,
  // so the fall leaves the sim's other dice as they were)
  const rng = mulberry32((G.seed ^ Math.imul(G.relics.k + 7, 0x9E3779B1) ^ (c.idx + 1) * 0x85EBCA6B) >>> 0);
  let x = 0;
  for (let t = 0; t < 12; t++) {
    x = Math.round(Math.max(80, Math.min(WORLD_W - 80,
      r.x + dir * (RELIC_BEYOND[0] + rng() * (RELIC_BEYOND[1] - RELIC_BEYOND[0])))));
    // (not on a trunk: it would sit up in the wood)
    if (!G.trees.some(tr => Math.abs(tr.x - x) < 40)) break;
  }
  const it = G.makeItem('relic', x, T.surf[x] - 10);
  it.rcol = c.idx;
  G.items.push(it);
  // (the first seed of a year starts its count afresh)
  const got = st.yr === G.year ? st.got : 0;
  Object.assign(st, { ph: 'lying', id: it.id, x, y: Math.round(it.y), until: G.tick + SEASON_DAYS * DAY_LEN, got, yr: G.year, held: false });
  c.say('m_relicFell', [{ key: relicFoeKey(c) }], '#ffd040');
  c.sfx('task');
  r.say('m_relicFellFoe', [], '#ff9040');
  r.sfx('danger');
}

// the seed for c changed hands: tell both sides (an AI colony keeps quiet)
function relicNews(c, was, now, by) {
  const r = relicFoe(c);
  if (now === 'carried') {
    if (by.playerIdx >= 0) c.say('m_relicOurs', [{ player: by.playerIdx }], '#ffd040');
    else c.say('m_relicOursNpc', [], '#ffd040');
    if (r) { r.say('m_relicFoeCarry', [], '#ff7040'); r.sfx('danger'); }
  } else if (now === 'taken') {
    c.say('m_relicTaken', [], '#ff7040');
    c.sfx('danger');
    if (r) r.say('m_relicHeld', [], '#ffd040');
  } else if (now === 'lying' && was !== 'wait') {
    c.say('m_relicDown', [], '#ff9040');
    if (r) r.say('m_relicDownFoe', [], '#ffd040');
  }
}

// a golden seed carried into colony c's storage by `who`
function relicIn(it, c, who) {
  const owner = G.colonies[it.rcol] || null;
  const st = owner ? relicSide(owner) : null;
  it.dead = true;
  if (who) who.carry = null;
  const at = who || c.storage;
  if (owner === c) {
    // home: a milestone's worth for the flight, crystals and score
    if (st && st.id === it.id) { st.ph = 'home'; st.id = 0; }
    if (st) { if (st.yr !== G.year) { st.got = 0; st.yr = G.year; } st.got++; }
    c.stats.relics = (c.stats.relics || 0) + 1;
    c.score += RELIC_SCORE;
    c.crystals += RELIC_CRYSTALS;
    c.say('m_relicHome', [RELIC_CRYSTALS, st ? st.got : 1], '#ffe040');
    if (who && who.playerIdx >= 0 && G.players[who.playerIdx]) G.players[who.playerIdx].stats.seek += 3;
    c.sfx('task');
    const r = relicFoe(c);
    if (r) r.say('m_relicHomeFoe', [], '#ff9040');
    G.fx('sparkle', at.x, at.y - 6, 14);
  } else {
    // denied: it crumbles in the enemy's stores
    if (st && st.id === it.id) { st.ph = 'denied'; st.id = 0; }
    c.score += RELIC_DENY;
    c.say('m_relicDeniedUs', [RELIC_DENY], '#ffe040');
    if (who && who.playerIdx >= 0 && G.players[who.playerIdx]) G.players[who.playerIdx].stats.seek++;
    c.sfx('task');
    if (owner) owner.say('m_relicDenied', [], '#ff7040');
    G.fx('dirt', at.x, at.y - 4, 8);
  }
  G.sfx('deposit', at.x, at.y, 280);
}

// an enemy ant carrying a golden seed within RELIC_ALARM of colony c's nest
// (for its soldiers to run down), or null
function relicThreat(c) {
  // (every soldier on its rounds asks: one look a tick serves them all)
  if (c.rtT === G.tick) return c.rt;
  c.rtT = G.tick; c.rt = null;
  for (const it of G.items) {
    if (it.kind !== 'relic' || it.dead || !it.carried) continue;
    const a = it.carried;
    if (a.hp > 0 && a.colony !== c && Math.abs(a.x - c.x) < RELIC_ALARM && !outInCold(a)) { c.rt = a; break; }
  }
  return c.rt;
}
// ...and how many of c's ants are on it already
function relicGuards(c, carrier) {
  let n = 0;
  for (const a of G.ants) if (a.colony === c && a.state === 'fight' && a.target === carrier) n++;
  return n;
}
// a dropped golden seed (one carried and let fall) lying within RELIC_FETCH
// of colony c's nest, that no other ant has claimed, or null
function relicDropped(c, ant) {
  for (const it of G.items) {
    if (it.kind !== 'relic' || it.dead || it.carried || !it.dropped) continue;
    if (Math.abs(it.x - c.x) > RELIC_FETCH) continue;
    if (it.claimUntil > G.tick && it.claimBy !== ant.id) continue;
    if (it.shunT > G.tick) continue;
    return it;
  }
  return null;
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
// More players make some of them easier: `scale` ones grow by SLOT_OBJ per
// player beyond the first, `perSlot` ones by that much per player (pop25:
// co-op players' ants are on top of the household). The rest -- a count of
// chambers, the royal chamber (one chamber can't grow past its disk), the
// seal, the queen, a princess -- stay as they are.
// A shorter year (see yearShare) scales the milestones that measure what a
// season's time buys by its share of a FULL year's time to the power `te`:
// 1 for what is only counted up through the season (the fruit, the seal's
// recounts, the centipedes), 0.5 for what the colony builds on all year
// (food, the mound, ants raised; with the brood quicker too) -- from
// `base`, what a fresh colony already has (pop25: its ~14 ants). SHORT
// asks for 4 new ants, 70 food, a 175 px mound, 22 ants, 4 pieces of
// fruit, 105 food for winter, a seal half as long and 2 centipedes; QUICK
// 3, 60, 145, 20, 3, 85, a third and 1. A FULL year is exactly as it was.
// ---------------------------------------------------------------------------
const SEAL_NEED = 45;   // winter recounts (8 s apart) with the entrance shut
const OBJECTIVES = [
  // spring: establish the nest
  [{ id: 'storage2', kind: 'level', need: 2, grow: 1 }, { id: 'raise', kind: 'count', need: 5, scale: true, te: 0.5 },
    { id: 'food100', kind: 'level', need: 100, grow: 50, scale: true, te: 0.5 }],
  // summer: expand, and contest the fallen fruit with the rival
  [{ id: 'mound', kind: 'level', need: 250, grow: 150, scale: true, te: 0.5 },
    { id: 'pop25', kind: 'level', need: 25, grow: 10, perSlot: 2, te: 0.5, base: 14 },
    { id: 'contested', kind: 'count', need: 8, grow: 4, scale: true, te: 1 }],
  // autumn: prepare for winter and the next generation
  [{ id: 'stockpile', kind: 'end', need: 150, grow: 50, scale: true, te: 0.5 },
    { id: 'royal', kind: 'level', need: PRINCESS_ROYAL, grow: 600 },
    { id: 'princess', kind: 'count', need: 1 }],
  // winter: survive
  [{ id: 'queen', kind: 'end', need: 1 }, { id: 'sealed', kind: 'count', need: SEAL_NEED, pct: true, te: 1 },
    { id: 'centipedes', kind: 'count', need: 3, scale: true, te: 1 }],
];
const OBJ_SCORE = 200, OBJ_CRYSTALS = 2;   // reward per milestone

function newObjectives(year, season, yearDone) {
  return {
    year, season,
    yearDone: yearDone || 0,   // milestones done this year (stars)
    list: OBJECTIVES[season].map(o => ({
      id: o.id, n: 0, need: objNeed(o, year), done: false,
    })),
  };
}

// what milestone o asks for in `year`, for the players the world is
// balanced for (see OBJECTIVES)
function objNeed(o, year) {
  let need = o.need + (o.grow || 0) * Math.max(0, year - 1);
  // (a shorter year: what its time gives room for; round numbers past 50)
  const share = yearShare();
  if (o.te && share < 1) {
    const b = o.base || 0;
    need = b + (need - b) * Math.pow(share, o.te);
    need = Math.max(1, need >= 50 ? Math.round(need / 5) * 5 : Math.round(need));
  }
  const extra = playerSlots() - 1;
  if (o.scale) return Math.round(need * (1 + SLOT_OBJ * extra));
  return need + (o.perSlot || 0) * extra;
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
  c.sfx('task');
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
