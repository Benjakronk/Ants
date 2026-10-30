// MAUR -- client: LEARN TO ANT, a guided scenario in eight short chapters on
// a calm world of its own (the title menu's LEARN TO ANT), and the tips of
// the first online matches, keyed to the player's job (Coach). Neither is
// saved with a world or sent to the server: the scenario runs the sim right
// here (G.tutorial keeps it calm, see game.js), the tips only read the view.
// Loaded just before main.js (the title asks learnDone as soon as it is
// drawn): nothing here touches main.js until it is called.
'use strict';

// ---------------------------------------------------------------------------
// the scenario's world: a fixed seed, then a few edits after the generator
// (its rng and its order untouched): a small hollow off the nest, cramped
// still, for the chamber chapter to dig out and mark
// ---------------------------------------------------------------------------
const LEARN_SEED = 31337;
const LEARN_POCKET = 170;   // roomy px the hollow starts with (a chamber needs CH_MIN_AREA)
const LEARN_DIG = 20;       // the load the first chapter asks for
const LEARN_WALK = 80;      // px walked
const LEARN_IDS = ['body', 'food', 'nest', 'way', 'build', 'danger', 'year', 'together'];
const LEARN_STAGES = ['summer', 'autumn', 'winter', 'flight'];   // the year chapter's fast-forward

// what this browser has been through (never in a save): the whole scenario
// ('maur_learn': done), and each chapter (a 0/1 a chapter, 'maur_learn_ch')
function learnDone() { return lsGet('maur_learn') === 'done'; }
function learnChDone(i) { return (lsGet('maur_learn_ch') || '')[i] === '1'; }
function learnMarkCh(i) {
  const s = (lsGet('maur_learn_ch') || '').padEnd(LEARN_IDS.length, '0').slice(0, LEARN_IDS.length).split('');
  s[i] = '1';
  lsSet('maur_learn_ch', s.join(''));
}
function learnCount() {
  let n = 0;
  for (let i = 0; i < LEARN_IDS.length; i++) if (learnChDone(i)) n++;
  return n;
}

// a new scenario world (the sim's own newWorld, then the edits); returns
// the hollow's middle, or null if the nest had no spot for one
function learnWorld() {
  newWorld(LEARN_SEED, 1, 'solo', 1, 'full');
  G.tutorial = true;
  assignJobs();
  return learnHollow(G.colony);
}

// an ellipse of diggable pixels turned to air (rock and wood stay)
function learnCarve(cx, cy, rx, ry) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) continue;
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const i = y * WORLD_W + x;
      if (DIGGABLE(T.m[i])) T.m[i] = M_AIR;
    }
  }
}

// a hollow beside the nest, beyond its storage or nursery, with a narrow
// tunnel to it (too narrow to count as room): deep enough, clear of the
// other chambers, no rock on the way. It starts cramped (LEARN_POCKET).
function learnHollow(c) {
  const j = c.junction;
  for (const dy of [40, 60, 25]) {
    for (const dx of [175, 150, 200, 130]) {
      for (const side of [-1, 1]) {
        const x = Math.round(j.x + side * dx), y = Math.round(j.y + dy);
        if (Math.abs(x - c.entrance.x) > CH_REACH - 60 || y < T.bgSurf[x] + CH_DEPTH + 30) continue;
        if (c.chamberNear(x, y, CH_SPACING + 30) || c.areaAt(x, y, null) > 40 || T.digHitsHard(x, y, 18)) continue;
        const from = side < 0 ? c.storage : c.nursery;
        const n = Math.ceil(Math.hypot(x - from.x, y - from.y) / 3);
        let rock = false;
        for (let i = 0; i <= n && !rock; i++) rock = T.digHitsHard(from.x + (x - from.x) * i / n, from.y + (y - from.y) * i / n, 5);
        if (rock) continue;
        for (let i = 0; i <= n; i++) learnCarve(from.x + (x - from.x) * i / n, from.y + (y - from.y) * i / n, 3.5, 3.5);
        for (let rx = 7; rx <= 16 && c.areaAt(x, y, null) < LEARN_POCKET; rx++) learnCarve(x, y, rx, Math.round(rx * 0.6));
        return { x, y };
      }
    }
  }
  return null;
}

// the year chapter's leap: on to `day` (of the whole calendar), never back
function learnJump(day) {
  const t = Math.round(day * DAY_LEN);
  if (t > G.tick) G.tick = t;
}

// ---------------------------------------------------------------------------
// the chapters: what each asks (its goals, in the order the arrow takes
// them), what it sets up, where the arrow points, and how each goal is seen
// to be done -- in the local ant, the sim's messages to this player and the
// keys pressed (tutSaw). A goal once met stays met.
// ---------------------------------------------------------------------------
const LEARN_CH = {
  body: {
    goals: ['walk', 'climb', 'dig'],
    setup(S, me) { if (me) { me.soil = 0; me.thatch = 0; } S.moved = 0; S.lastX = null; },
    check(S, me) {
      // (walking only: a switch to another ant is no stroll)
      if (S.lastX !== null && Math.abs(me.x - S.lastX) < 4) S.moved += Math.abs(me.x - S.lastX);
      S.lastX = me.x;
      return { walk: S.moved >= LEARN_WALK, climb: me.climbing || me.ceiling, dig: me.soil + me.thatch >= LEARN_DIG };
    },
    prog(S, me, g) { return g === 'dig' && me ? [Math.min(LEARN_DIG, Math.floor(me.soil + me.thatch)), LEARN_DIG] : null; },
    // (a tree to climb, once walking is done)
    target(S, me) {
      if (!S.got.walk || S.got.climb) return null;
      let best = null;
      for (const t of G.trees) if (Math.abs(t.x - me.x) < 600 && (!best || Math.abs(t.x - me.x) < Math.abs(best.x - me.x))) best = t;
      return best ? { x: best.x, y: T.surf[best.x] - 18, color: '#a8e8a0', icon: '\x06' } : null;
    },
    hl: () => [58, 177, 46, 22],   // (done: the load bars)
  },
  food: {
    goals: ['pick', 'store'],
    // two seeds a short walk either side of the mound
    setup(S) { S.food = learnSeeds(); },
    check(S, me, seen) {
      const it = me.carry, food = !!(it && ITEM_DEF[it.kind] && ITEM_DEF[it.kind].food);
      // (none left near: the NPC foragers took them -- another falls ahead)
      if (!food && !S.got.store && G.tick % 120 === 0 && !foodTarget(me)) learnSeeds();
      return { pick: food, store: !!(seen.m_foodStored || seen.m_storageFull) };
    },
    target(S, me) {
      const it = me.carry;
      if (it && ITEM_DEF[it.kind] && ITEM_DEF[it.kind].food) return storageTarget(me);
      return S.got.store ? null : foodTarget(me);
    },
    hl: () => [HUD_G1 + 2, 177, HUD_G2 - HUD_G1 - 3, 22],   // (done: the colony's numbers)
  },
  nest: {
    goals: ['widen', 'mark', 'type'],
    setup(S) {
      const c = G.colony;
      S.base = c.chambers.slice();
      S.caps = Object.assign({}, c.caps);
      S.area = S.pocket ? c.areaAt(S.pocket.x, S.pocket.y, null) : 0;
    },
    check(S, me) {
      const c = G.colony;
      if (S.pocket && G.tick % 10 === 0) S.area = c.areaAt(S.pocket.x, S.pocket.y, null);
      const fresh = c.chambers.filter(ch => !S.base.includes(ch));
      const mark = fresh.length > 0;
      return { widen: mark || S.area >= CH_MIN_AREA, mark, type: fresh.some(ch => ch.type !== 'storage') };
    },
    prog(S, me, g) { return g === 'widen' && S.pocket ? [Math.min(CH_MIN_AREA, S.area), CH_MIN_AREA] : null; },
    target(S) { return S.pocket && !S.got.type ? { x: S.pocket.x, y: S.pocket.y, color: '#d8b878', icon: '\x03' } : null; },
    hl: () => [HUD_G1 + 2, 177, HUD_G2 - HUD_G1 - 3, 22],
  },
  way: {
    goals: ['map', 'obj', 'arrow'],
    setup() {},
    check(S, me, seen) {
      if (seen.arrow) S.toggled = true;
      return { map: !!seen.map, obj: !!seen.obj, arrow: !!S.toggled && G.arrowOn };
    },
    // (where the enemy is: the red nest, far to the right)
    target() { const r = G.rival; return r ? { x: r.entrance.x, y: r.entrance.y, color: '#ff6050', icon: '\x11' } : null; },
    hl: () => [0, 0, VIEW_W, 23],   // (done: the top lines)
  },
  build: {
    goals: ['build', 'mat', 'plan'],
    setup(S, me) {
      const p = G.players[LOCAL];
      if (me) { me.soil = Math.max(me.soil, 60); me.thatch = Math.max(me.thatch, 40); }
      if (p) p.buildMat = M_PACKED;
      S.built = p && p.stats ? p.stats.built : 0;
      S.plan0 = G.colony.plan.size;
    },
    check(S, me, seen) {
      const p = G.players[LOCAL];
      if (G.planMode && G.colony.plan.size > S.plan0) S.painted = true;
      return { build: !!(p && p.stats && p.stats.built > S.built), mat: !!seen.m_buildMat, plan: !!S.painted && !G.planMode };
    },
    target() { return null; },
  },
  danger: {
    goals: ['soldier', 'rally', 'spider'],
    // a spider by the mound -- a weakened one, but a spider
    setup(S) {
      const c = G.colony, x = Math.round(c.entrance.x + 140);
      const b = new Bug(x, T.surf[x] - 8, 'spider');
      b.hp = b.maxHp * 0.6;
      G.bugs.push(b);
      S.spider = b;
      pushMsg(L('m_spider'), '#ff8040');
      Sfx.play('danger');
    },
    check(S, me, seen) {
      const b = S.spider;
      // (a soldier just taken over may have sounded the alarm a moment ago:
      // its rally is ready, so Q answers at once)
      if (me.caste === 'soldier' && !S.got.soldier) me.abilCd = 0;
      return {
        soldier: me.caste === 'soldier',
        rally: !!(seen.m_rally || seen.m_rallyAlone || seen.m_follow || seen.m_patrol),
        spider: !b || b.dead || b.fleeing || !G.bugs.includes(b),
      };
    },
    target(S, me) {
      const b = S.spider;
      return me.caste === 'soldier' && b && !b.dead && G.bugs.includes(b) ? { x: b.x, y: b.y - 4, color: '#ff6050', icon: '!' } : null;
    },
  },
  year: {
    goals: LEARN_STAGES,
    // (the player's ant by the queen: the princesses come here)
    setup(S, me) {
      S.stage = 0; S.flight = null; S.y0 = G.year;
      const q = G.colony.queen() || G.colony.queenCh;
      if (me) { me.x = q.x + 14; me.y = q.y; me.vx = me.vy = 0; me.climbing = me.ceiling = false; G.cam.fx = undefined; }
    },
    check(S, me) {
      // Enter: on to the next season, the year leaping ahead
      if (S.stage < LEARN_STAGES.length && !overlayOpen() && tookPress('Enter')) {
        const base = (S.y0 - 1) * YEAR_DAYS, c = G.colony;
        const st = LEARN_STAGES[S.stage++];
        if (st === 'summer') learnJump(base + SEASON_DAYS + 0.1);
        else if (st === 'autumn') {
          learnJump(base + 2 * SEASON_DAYS + 0.1);
          // (the queen lays them in a roomy royal chamber with full stores:
          // here three are grown already, for the flight to come)
          const q = c.queen() || c.queenCh;
          for (let i = 0; i < 3; i++) G.ants.push(new Ant(q.x - 12 + i * 8, q.y - 2, 'princess', c));
          pushMsg(L('m_princess'), '#ff90e0');
        } else if (st === 'winter') learnJump(base + 3 * SEASON_DAYS + 0.1);
        else learnJump(base + YEAR_DAYS + 0.08);   // (spring: the next tick's new season flies them)
        Sfx.play('select');
      }
      const got = {};
      LEARN_STAGES.forEach((st, i) => { got[st] = i < S.stage && (st !== 'flight' || !!S.flight); });
      return got;
    },
    target() { return null; },
  },
  together: {
    goals: ['job', 'jobpage', 'scores', 'raid'],
    // (the season's golden seed falls now, beyond the red nest: the goal
    // strip and the map show it)
    setup() {
      const c = G.colony, R = G.relics;
      if (R && !G.isWinter() && relicFoe(c)) { R.k = R.wk = (G.year - 1) * 4 + G.season; dropRelic(c); }
    },
    check(S, me, seen) {
      const os = G.objScreen;
      return { job: !!seen.job, jobpage: !!(os && objPageIds()[os.page] === 'job'), scores: !!seen.scores, raid: !!seen.raid };
    },
    // (the job's own arrow, as in a match)
    target(S, me) { return guidePoint(me); },
  },
};

// two seeds on the ground a short walk either side of the mound
function learnSeeds() {
  const c = G.colony;
  for (const dx of [-70, 80]) {
    const x = Math.round(c.entrance.x + dx);
    G.items.push(G.makeItem('seed', x, T.surf[x] - 8));
  }
  return true;
}

// ---------------------------------------------------------------------------
// the scenario: begin (a fresh world at a chapter), each tick's goals, the
// chapter done ("why this matters", Enter: the next), skip (H), the end
// ---------------------------------------------------------------------------
const Learn = {
  on: false,
  ch: 0,
  S: null,         // the chapter's state: { got, pocket, ... }
  seen: {},        // what happened this tick (see tutSaw)
  done: false,     // the chapter's goals all met: its "why" shows
  doneT: 0,
  lift: 0,         // half the panel's height: the camera lifts the ant clear of it

  // a fresh scenario world, at chapter ch
  begin(ch) {
    const pocket = learnWorld();
    enterWorld('learn');
    this.on = true;
    this.pocket = pocket;
    G.arrowOn = true;   // (not remembered: G remembers it)
    G.objScreen = null; G.showMap = false; G.takeover = null;
    this.enter(ch);
    G.state = 'play';
  },
  enter(ch) {
    this.ch = Math.max(0, Math.min(LEARN_IDS.length - 1, ch));
    this.S = { got: {}, pocket: this.pocket };
    this.seen = {};
    this.done = false; this.doneT = 0;
    planOff();
    // (the chapters are played by day: past the afternoon, the next morning)
    if (G.tod() > 0.55) G.tick = (G.day + 1) * DAY_LEN + Math.floor(DAY_LEN * 0.08);
    this.def().setup(this.S, localAnt());
  },
  id() { return LEARN_IDS[this.ch]; },
  def() { return LEARN_CH[this.id()]; },

  // once per tick in play (after the sim and its messages)
  update() {
    if (!this.on) return;
    const seen = this.seen;
    this.seen = {};
    if (this.done) {
      this.doneT++;
      if (this.doneT > 20 && !overlayOpen() && (tookPress('Enter') || tookAction('skipHint'))) { Sfx.play('select'); this.next(); }
      return;
    }
    if (!overlayOpen() && tookAction('skipHint')) { Sfx.play('menu'); this.next(); return; }
    const me = localAnt();
    if (!me) return;
    const S = this.S, def = this.def();
    const got = def.check(S, me, seen);
    for (const g of def.goals) {
      if (got[g] && !S.got[g]) { S.got[g] = true; Sfx.play('select'); }
    }
    if (def.goals.every(g => S.got[g])) {
      this.done = true; this.doneT = 0;
      learnMarkCh(this.ch);
      if (this.id() === 'nest') S.capsNow = Object.assign({}, G.colony.caps);
      Sfx.play('task');
    }
  },
  // the year's end came (the year chapter's flight): its stars kept, the
  // world goes on (nothing is saved, no end screen)
  over() {
    const o = G.over;
    G.over = null;
    if (this.S && this.id() === 'year') this.S.flight = { stars: o.stars || 0, flown: o.flown || 0 };
  },
  // where the arrow points this chapter (null: nowhere)
  target(me) { return this.def().target(this.S, me) || null; },
  next() {
    if (this.ch + 1 < LEARN_IDS.length) this.enter(this.ch + 1);
    else this.finish();
  },
  // the last chapter done (or skipped): YOU'RE READY
  finish() {
    lsSet('maur_learn', 'done');
    this.stop();
    G.state = 'learnend'; G.menuSel = 0;
    Sfx.play('task');
  },
  leave() {
    this.stop();
    G.state = 'title'; G.menuSel = titleItems().findIndex(i => i.id === 'learn');
  },
  stop() {
    planOff();
    this.on = false;
    G.running = false;
    G.takeover = null; G.objScreen = null; G.showMap = false;
    G.flyers = []; G.flightCam = null;
    G.arrowOn = lsGet('maur_arrow') !== 'off';
  },
};

// ---------------------------------------------------------------------------
// the chapter's panel, above the HUD: the chapter and the keys, what to do,
// its goals ticked off as they are met (two columns for four); done, why it
// matters and ENTER for the next. Returns true (drawn).
// ---------------------------------------------------------------------------
const LEARN_W = 308, LEARN_X = 6;
function drawLearn() {
  const S = Learn.S, def = Learn.def(), id = Learn.id(), me = localAnt();
  const rows = [];   // [text, colour, x] -- x: 'c' centred, or a column
  const n = LEARN_IDS.length;
  if (!Learn.done) {
    const st = id === 'year' && S.stage > 0 ? 'ty_' + LEARN_STAGES[S.stage - 1] : 'ti_' + id;
    for (const line of L(st).split('\n')) rows.push([[line, '#ffe8a0', 12]]);
    const goals = def.goals.map((g, i) => {
      const ok = !!S.got[g], cur = !ok && def.goals.findIndex(k => !S.got[k]) === i;
      const p = def.prog && def.prog(S, me, g);
      const txt = (ok ? '\x19 ' : cur ? '\x06 ' : '- ') + (p ? L('tg_' + g, p[0], p[1]) : L('tg_' + g));
      return [txt, ok ? '#80ff80' : cur ? '#ffffff' : '#a09070'];
    });
    if (goals.length >= 4) {
      for (let i = 0; i < goals.length; i += 2) rows.push([[goals[i][0], goals[i][1], 12], goals[i + 1] ? [goals[i + 1][0], goals[i + 1][1], 160] : null].filter(Boolean));
    } else for (const g of goals) rows.push([[g[0], g[1], 12]]);
    // (the year: Enter leaps on; the flight flies)
    if (id === 'year') {
      const on = (G.frame >> 4) % 2;
      if (S.stage < LEARN_STAGES.length) rows.push([[L('tu_enter', L('tg_' + LEARN_STAGES[S.stage])), on ? '#ffe040' : '#c8b890', 'c']]);
      else rows.push([[L('tu_flying'), '#ff90e0', 'c']]);
    }
  } else {
    for (const line of L('tw_' + id, S.flight ? S.flight.stars : 0).split('\n')) rows.push([[line, '#a8e8a0', 12]]);
    // (the chamber's chapter: the room it made)
    const a = S.caps, b = S.capsNow;
    if (id === 'nest' && a && b) rows.push([[L('tu_caps', a.food, b.food, a.pop, b.pop, a.brood, b.brood), '#ffe080', 12]]);
    const on = (G.frame >> 4) % 2;
    rows.push([[L(Learn.ch + 1 < n ? 'tu_next' : 'tu_last'), on ? '#ffe040' : '#c8b890', 'c']]);
  }
  const h = 14 + rows.length * 9;
  const y0 = VIEW_H - HUD_H - 3 - h;
  Learn.lift = Math.round(h / 2);
  bevelPanel(LEARN_X, y0, LEARN_W, h);
  // the head: the chapter (or DONE), the keys
  const head = Learn.done ? L(id === 'year' ? 'tu_win' : 'tu_done') : L('tu_head', Learn.ch + 1, n, L('tt_' + id));
  drawText(ctx, head, LEARN_X + 6, y0 + 4, Learn.done ? '#80ff80' : '#ffa040');
  if (Learn.done && id === 'year' && S.flight) {
    for (let i = 0; i < 3; i++) drawText(ctx, '\x15', LEARN_X + 12 + textWidth(head) + i * 8, y0 + 4, i < S.flight.stars ? '#ffd030' : '#5a4630');
  }
  const k = L('tu_keys');
  drawText(ctx, k, LEARN_X + LEARN_W - 6 - textWidth(k), y0 + 4, '#806e58');
  let y = y0 + 14;
  for (const row of rows) {
    for (const [str, color, x] of row) {
      if (x === 'c') drawTextC(ctx, str, VIEW_W / 2, y, color);
      else drawText(ctx, str, LEARN_X + x - 6, y, color);
    }
    y += 9;
  }
  // done: what the chapter was about, framed on the screen (blinking)
  if (Learn.done && def.hl && (G.frame >> 4) % 2) {
    const [x, hy, w, hh] = def.hl();
    ctx.fillStyle = '#ffe040';
    ctx.fillRect(x, hy, w, 1); ctx.fillRect(x, hy + hh - 1, w, 1);
    ctx.fillRect(x, hy, 1, hh); ctx.fillRect(x + w - 1, hy, 1, hh);
  }
  return true;
}

// ---------------------------------------------------------------------------
// the chapter list (from the title, or the scenario's pause menu): pick a
// chapter, each played on a fresh world; the ones done are ticked
// ---------------------------------------------------------------------------
function drawLearnMenu() {
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawTextCS(ctx, L('ui_learn'), VIEW_W / 2, 10, '#ffa040', 2);
  drawTextC(ctx, L('ln_sub'), VIEW_W / 2, 32, '#b09060');
  const x = 84;
  LEARN_IDS.forEach((id, i) => {
    const y = 48 + i * 12, sel = i === G.learnSel;
    if (sel) drawText(ctx, '\x06', x - 22, y, '#ffe040');
    if (learnChDone(i)) drawText(ctx, '\x19', x - 12, y, '#80ff80');
    drawText(ctx, (i + 1) + '. ' + L('tt_' + id), x, y, sel ? '#ffe040' : '#c8b890');
  });
  drawTextC(ctx, L('ln_done', learnCount(), LEARN_IDS.length), VIEW_W / 2, 148, learnDone() ? '#80ff80' : '#a09070');
  drawTextC(ctx, L('ln_keys'), VIEW_W / 2, 166, '#b0a080');
  drawTextC(ctx, L('ln_keys2'), VIEW_W / 2, 178, '#706050');
}

function updateLearnMenu() {
  const n = LEARN_IDS.length;
  if (tookPress('ArrowUp') || tookPress('KeyW')) { G.learnSel = (G.learnSel + n - 1) % n; Sfx.play('menu'); }
  if (tookPress('ArrowDown') || tookPress('KeyS')) { G.learnSel = (G.learnSel + 1) % n; Sfx.play('menu'); }
  // (Esc: back to the scenario's pause menu if one is running, else the title)
  if (tookPress('Escape')) {
    Sfx.play('menu');
    if (Learn.on) { G.state = 'pause'; G.menuSel = 0; } else { G.state = 'title'; G.menuSel = titleItems().findIndex(i => i.id === 'learn'); }
    return;
  }
  if (tookPress('Enter') || tookPress('Space')) {
    Sfx.play('select');
    if (Learn.on) Learn.stop();
    // a LOADING frame first; the world is made on the next step
    G.loadLearn = G.learnSel; G.loadAt = G.frame;
    G.state = 'loading';
  }
}

// the chapter list opened: at the first chapter not done yet
function openLearnMenu() {
  let k = 0;
  while (k < LEARN_IDS.length - 1 && learnChDone(k)) k++;
  G.learnSel = learnDone() ? 0 : k;
  G.state = 'learnmenu';
}

// ---------------------------------------------------------------------------
// the end: YOU'RE READY -- the goal in a few lines, then on to a solo
// world, online, or the title
// ---------------------------------------------------------------------------
function learnEndItems() {
  return [
    { id: 'solo', label: L('ui_start') },
    { id: 'online', label: L('ui_online') },
    { id: 'title', label: L('ui_toTitle') },
  ];
}

function drawLearnEnd() {
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawTextCS(ctx, L('le_title'), VIEW_W / 2, 12, '#ffa040', 2);
  const lines = L('le_text').split('\n');
  lines.forEach((line, i) => drawTextC(ctx, line, VIEW_W / 2, 36 + i * 10, i < 2 ? '#ff90e0' : '#c8b890'));
  drawTextC(ctx, L('ln_done', learnCount(), LEARN_IDS.length), VIEW_W / 2, 40 + lines.length * 10, '#80ff80');
  const items = learnEndItems().map(it => it.label);
  for (let i = 0; i < items.length; i++) {
    const sel = i === G.menuSel, y = 124 + i * 14;
    if (sel) drawTextC(ctx, '\x06', VIEW_W / 2 - textWidth(items[i]) / 2 - 12, y, '#ffe040');
    drawTextCS(ctx, items[i], VIEW_W / 2, y, sel ? '#ffe040' : '#c8b890');
  }
}

function updateLearnEnd() {
  const items = learnEndItems();
  if (tookPress('Escape')) { G.state = 'title'; G.menuSel = 0; Sfx.play('menu'); return; }
  if (!menuNav(items.length)) return;
  Sfx.play('select');
  switch (items[G.menuSel].id) {
    case 'solo': G.state = 'slots'; G.slotSel = 0; G.eraseArm = -1; break;
    case 'online': G.state = 'netname'; Net.err = null; break;
    case 'title': G.state = 'title'; G.menuSel = 0; break;
  }
}

// ---------------------------------------------------------------------------
// the first online matches' tips (COACH_MATCHES of them, while the hints are
// on: the pause menu's HINTS turns them off). First four in turn -- your job
// and how to do it, the arrow and the top line, how the match is won, the
// keys -- then, at most one every COACH_GAP, a tip for what is happening to
// you: keyed to your job (a forager laden, a builder with no soil, a guard
// with a raid on, a seeker with our seed out there) or to the season. Each
// shows COACH_SHOW frames, or until H. Read from the view the client already
// has; nothing new on the wire.
// ---------------------------------------------------------------------------
const COACH_MATCHES = 3;
const COACH_SHOW = 660, COACH_GAP = 60 * 45, COACH_FIRST = 90;
const COACH_INTRO = ['job', 'arrow', 'win', 'more'];
// the tips for what is happening: [id, the job it is for (null: anyone), when]
const COACH_TIPS = [
  ['raid', 'guard', () => { const r = raidAlert(); return !!(r && r.banner); }],
  ['seed', 'seeker', () => { const rs = relicState(); return !!(rs && rs.ph === 'lying'); }],
  ['carry', 'forager', (C, me) => C.carryT > 180],
  ['load', 'builder', (C, me, seen) => !!seen.m_noSoil],
  ['full', null, () => G.colony.caps && G.colony.food >= G.colony.caps.food - 1],
  ['autumn', null, () => G.season === AUTUMN],
  ['winter', null, () => G.season === WINTER],
];
const Coach = {
  on: false,
  cur: null,       // the tip showing (an id), or null
  t: 0,            // frames it has shown
  step: 0,         // the next of COACH_INTRO
  gapT: 0,         // frames before the next tip
  used: {},        // tips already shown this match
  seen: {},
  carryT: 0,

  // a match (or a persistent world) begins: tips if this is one of the
  // first few online, and the hints are on
  start() {
    const n = Number(lsGet('maur_coach')) || 0;
    this.on = Tut.on && n < COACH_MATCHES;
    if (this.on) lsSet('maur_coach', String(n + 1));
    this.cur = null; this.t = 0; this.step = 0; this.gapT = COACH_FIRST;
    this.used = {}; this.seen = {}; this.carryT = 0;
  },
  stop() { this.on = false; this.cur = null; },
  showing() { return !!(this.on && Tut.on && G.online && this.cur && localAnt()); },
  update() {
    const seen = this.seen;
    this.seen = {};
    if (!this.on || !G.online || !Tut.on) return;
    const me = localAnt();
    if (!me || overlayOpen()) return;
    const c = me.carry;
    this.carryT = c && ITEM_DEF[c.kind] && ITEM_DEF[c.kind].food ? this.carryT + 1 : 0;
    if (this.cur) {
      this.t++;
      if ((this.t > 20 && tookAction('skipHint')) || this.t > COACH_SHOW) {
        this.cur = null;
        this.gapT = this.step < COACH_INTRO.length ? 30 : COACH_GAP;
        Sfx.play('menu');
      }
      return;
    }
    if (this.gapT > 0) { this.gapT--; return; }
    const job = G.players[LOCAL] && G.players[LOCAL].job;
    if (this.step < COACH_INTRO.length) {
      // (the job's tip waits a little for the job to come)
      if (COACH_INTRO[this.step] === 'job' && !job && this.t++ < 600) return;
      if (COACH_INTRO[this.step] === 'job' && !job) this.step++;
      this.show(COACH_INTRO[this.step++]);
      return;
    }
    for (const [id, forJob, when] of COACH_TIPS) {
      if (this.used[id] || (forJob && forJob !== job) || !when(this, me, seen)) continue;
      this.used[id] = true;
      this.show(id);
      return;
    }
  },
  show(id) { this.cur = id; this.t = 0; Sfx.play('select'); },
  // the tip's two lines
  text() {
    const id = this.cur, job = G.players[LOCAL] && G.players[LOCAL].job;
    if (id === 'job') return L('cc_' + job);
    if (id === 'win') return L(G.mode === 'versus' ? 'cc_winVs' : G.mode === 'world' ? 'cc_winWorld' : 'cc_winCoop');
    if (id === 'seed') return L('cc_seed', L(G.mode === 'versus' ? 'rl_enemyNest' : 'rl_redNest'));
    return L('cc_' + id);
  },
};

// the tip's panel, where the hints go
function drawCoach() {
  const lines = Coach.text().split('\n');
  const y0 = 144;
  bevelPanel(10, y0, 300, 30);
  const intro = COACH_INTRO.indexOf(Coach.cur) >= 0;
  drawText(ctx, intro ? L('cc_head', COACH_INTRO.indexOf(Coach.cur) + 1, COACH_INTRO.length) : L('cc_tip'), 14, y0 + 3, '#a09070');
  const k = L('cc_keys');
  drawText(ctx, k, 306 - textWidth(k), y0 + 3, '#806e58');
  const job = G.players[LOCAL] && G.players[LOCAL].job;
  const color = Coach.cur === 'job' && JOB_COLOR[job] ? JOB_COLOR[job] : '#ffe8a0';
  drawTextC(ctx, lines[0], VIEW_W / 2, y0 + 12, color);
  if (lines[1]) drawTextC(ctx, lines[1], VIEW_W / 2, y0 + 21, color);
  return true;
}
