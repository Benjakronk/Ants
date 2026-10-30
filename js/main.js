// MAUR -- client: input, simulation events, camera, rendering, menus. The
// simulation itself lives in game.js; this file only feeds it the local
// player's input and draws what it reports.
'use strict';

const VIEW_W = 320, VIEW_H = 200, HUD_H = 24;

// the local player's slot in G.players (0 offline; online the server's
// player index for us, set when the world arrives)
let LOCAL = 0;

// key bindings (KeyboardEvent.code); each action accepts any of its keys
const BIND = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  bite: ['Space'], act: ['KeyE'], abil: ['KeyQ'], swap: ['KeyC'], scores: ['Tab'],
  build: ['KeyF'], buildMat: ['KeyR'], mark: ['KeyX'], obj: ['KeyO'],
  arrow: ['KeyG'], skipHint: ['KeyH'], plan: ['KeyB'], raid: ['KeyZ'], job: ['KeyJ'],
};

// the jobs (see JOBS in game.js) as the screens show them: an icon (font
// glyphs of their own), a colour, a name
const JOB_ICON = { forager: '\x1D', builder: '\x1E', guard: '\x1F', seeker: '\x07' };
const JOB_COLOR = { forager: '#a8e8a0', builder: '#e8b070', guard: '#ff9070', seeker: '#80e0ff' };
function jobName(j) { return JOBS.includes(j) ? L('job_' + j) : L('job_any'); }
// player i's job goal this season (offline the sim's; online the server's j key)
function myJobGoal(i) {
  const p = G.players[i];
  if (!p || !p.job) return null;
  return G.online ? p.jg || null : jobGoal(p);
}

// per-viewer settings kept in this browser (never in the sim or a save)
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

// client-side state, layered onto the simulation's G
Object.assign(G, {
  state: 'title',     // title | slots | intro | help | play | pause | gameover
                      // online: netname | netmenu | networlds | netcreate |
                      // netopen | netjoin | netwait | lobby
                      // LEARN TO ANT (learn.js): learnmenu | learnend (its
                      // chapters are played in play)
  learnSel: 0,        // LEARN TO ANT's chapter list: the chapter selected
  loadLearn: null,    // ...and the chapter LOADING makes a world for
  online: false,      // in an online match: the server runs the sim (net.js)
  slot: 1,
  msgs: [],           // on-screen messages { text, color, t }
  takeover: null,     // ant-selection overlay { types, sel, refX, refY, live }
  objScreen: null,    // objectives / upgrades overlay { page, sel } (O)
  flyers: [],         // princesses on their nuptial flight (animation only)
  flightCam: null,    // the camera watches the entrance during the flight { x, y, t }
  overSel: 0,         // end screen menu
  overPage: 0,        // ...and its page online (0 the result, 1 the highlights)
  cam: { x: 0, y: 0 },
  stars: [],
  menuSel: 0,
  slotSel: 0,
  eraseArm: -1,
  autosaveT: 0,
  introLine: 0,
  showMap: false,
  prevState: 'title',
  gameOverStats: null,
  frame: 0,           // render frame counter (blinking, title animation)
  arrowOn: lsGet('maur_arrow') !== 'off',   // the guide arrow (G)
  gates: [],          // ant gate spots for the map, rescanned while it's open
  gatesT: 0,
  nameBuf: lsGet('maur_name') || '',   // the online name being typed
  codeBuf: '',        // the room code being typed
  browseSel: 0,       // the room browser's selected row
  crSel: 0, crMode: 'coop', crPub: false,   // CREATE A MATCH: the row, the mode, public or not,
  crLen: 'full',                            // ...and the year's length (also a new solo world's)
  lobbySel: 0,        // the lobby's selected player (the host kicks)
  sidesWarnT: 0,      // versus lobby: the 'a player on each side' note flashes red until this frame
  rebornNote: null,   // a persistent world started over under us: { gen, reason } for JOIN THE COLONY
  // plan mode (B): the ant braces and a cursor of our own (no network lag)
  // paints the colony's blueprint; planCur is the cursor in world pixels,
  // planSpd its speed (it speeds up while a direction is held)
  planMode: false, planCur: null, planSpd: 0,
});

// an overlay that owns the screen: the HUD toasts wait (their timers stop)
// and the hint and arrow keep out of its way
function overlayOpen() { return !!(G.objScreen || G.takeover || G.showMap); }

// ---------------------------------------------------------------------------
// the tutorial: spring of year 1 teaches the basics one hint at a time. A
// hint stays up until the player does the thing (seen in the local ant and
// in the sim's messages to this player), then the next one comes. Progress
// (per save slot) and the on/off switch live in this browser only. What the
// player does ahead of its hint is remembered: that hint, when it comes,
// shows just long enough to read and ticks itself off.
// ---------------------------------------------------------------------------
const TUT_STEPS = ['move', 'dig', 'food', 'build', 'mark', 'obj', 'tab'];
const TUT_GAP = 70;      // frames the tick mark shows before the next hint
const TUT_END = 420;     // frames the closing hint shows
const TUT_KNOWN = 150;   // frames a hint already done ahead shows before its tick
const Tut = {
  on: lsGet('maur_hints') !== 'off',
  step: TUT_STEPS.length,    // TUT_STEPS.length: done (and hidden)
  gapT: 0, endT: 0, shownT: 0,
  seen: {},                  // what the player did this tick (see tutSaw)
  did: {},                   // what the player has done so far (food, built, cycled, mark, obj, tab)
  moved: 0, climbed: false, lastX: null, lastLoad: 0,

  key() { return 'maur_tut_' + G.slot; },
  // a world entered: a fresh one starts at the first hint; a saved one where
  // it left off (a world older than the hints, past its first day: done).
  // A player who has been through LEARN TO ANT (learn.js) knows all this: a
  // fresh world gives no hints.
  start(fresh) {
    const v = fresh ? null : lsGet(this.key());
    this.step = fresh ? (learnDone() ? TUT_STEPS.length : 0) : v !== null ? Math.max(0, Math.min(TUT_STEPS.length, Number(v) || 0))
      : G.day >= 1 ? TUT_STEPS.length : 0;
    if (fresh) lsSet(this.key(), '0');
    this.reset();
    this.did = {};
    this.endT = 0;
  },
  reset() {
    this.gapT = 0; this.shownT = 0; this.seen = {};
    this.moved = 0; this.climbed = false;
    this.lastX = null; this.lastLoad = 0;
  },
  setOn(on) {
    this.on = on;
    lsSet('maur_hints', on ? 'on' : 'off');
  },
  // the hint showing now (its step name, 'done' for the closing one), or null
  active() {
    if (!this.on || G.year > 1 || Learn.on) return null;
    if (this.step < TUT_STEPS.length) return TUT_STEPS[this.step];
    return this.endT > 0 ? 'done' : null;
  },
  next() {
    this.step++;
    lsSet(this.key(), String(this.step));
    this.reset();
    if (this.step >= TUT_STEPS.length) this.endT = TUT_END;
  },
  // once per tick in play: has the player done what the hint asks?
  update() {
    const me = localAnt();
    const seen = this.seen;
    this.seen = {};
    if (this.endT > 0 && !overlayOpen()) this.endT--;
    const st = this.active();
    if (!st || st === 'done' || !me) return;
    // (everything the hints ask for counts whichever hint is up)
    const pl = G.players[LOCAL], did = this.did;
    const load = me.soil + me.thatch;
    if (pl.input.build && load < this.lastLoad) did.built = true;
    this.lastLoad = load;
    if (seen.m_buildMat) did.cycled = true;
    if (seen.m_foodStored || seen.m_fed || seen.m_storageFull) did.food = true;   // (full stores: it got there)
    if (seen.m_chamberNew || seen.m_chamberType || seen.m_shelterNew) did.mark = true;
    if (seen.obj) did.obj = true;
    if (seen.tab) did.tab = true;
    if (st !== 'dig' && (me.soil >= 20 || me.thatch >= 20)) did.dug = true;
    if (tookAction('skipHint')) { this.next(); Sfx.play('menu'); return; }
    if (this.gapT > 0) { if (--this.gapT === 0) this.next(); return; }
    // (walking only: a switch to another ant is no stroll)
    if (this.lastX !== null && Math.abs(me.x - this.lastX) < 4) this.moved += Math.abs(me.x - this.lastX);
    this.lastX = me.x;
    if (me.climbing || me.ceiling) this.climbed = true;
    if (!overlayOpen()) this.shownT++;
    let ok = false, now = false;   // now: done while this hint showed
    switch (st) {
      case 'move': ok = now = this.moved > 60 && (this.climbed || this.moved > 400); break;
      case 'dig': ok = me.soil >= 20 || me.thatch >= 20; now = ok && !did.dug; break;
      case 'food': ok = !!did.food; now = !!(seen.m_foodStored || seen.m_fed || seen.m_storageFull); break;
      case 'build': ok = !!(did.built && did.cycled); now = !!(seen.m_buildMat || pl.input.build); break;
      case 'mark': ok = !!did.mark; now = !!(seen.m_chamberNew || seen.m_chamberType || seen.m_shelterNew); break;
      case 'obj': ok = !!did.obj; now = !!seen.obj; break;
      case 'tab': ok = !!did.tab; now = !!seen.tab; break;
    }
    // (done ahead of time: shown a moment first, so it is read)
    if (ok && (now || this.shownT >= TUT_KNOWN)) { this.gapT = TUT_GAP; Sfx.play('select'); }
  },
};
// something the hints wait for happened (a sim message to this player, or
// a client action like opening the O screen) -- LEARN TO ANT's chapters and
// the first matches' tips watch the same (learn.js)
function tutSaw(what) { Tut.seen[what] = true; Learn.seen[what] = true; Coach.seen[what] = true; }

function localAnt() {
  const p = G.players[LOCAL];
  return p && p.ant && p.ant.hp > 0 ? p.ant : null;
}

// (a colour '@n' is player n's: a personal milestone's toast is drawn in
// its player's colour)
function pushMsg(text, color) {
  if (typeof color === 'string' && color[0] === '@') color = playerColor(Number(color.slice(1)) || 0);
  G.msgs.push({ text, color: color || '#e8e0c8', t: 300 });
  if (G.msgs.length > 4) G.msgs.shift();
}

// ---------------------------------------------------------------------------
// particles (purely cosmetic, client only)
// ---------------------------------------------------------------------------
const Particles = {
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
  clank(x, y, n) {
    for (let i = 0; i < n; i++) this.add(x, y, (Math.random() - 0.5), -0.5, 10, '#c0c0c8');
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
};

// ---------------------------------------------------------------------------
// simulation events -> sound, particles, messages
// ---------------------------------------------------------------------------

// how far a world point is from where the local player is listening
function listenDist(x, y) {
  const a = localAnt();
  if (a) return Math.hypot(a.x - x, a.y - y);
  const v = playerView();
  return Math.hypot(G.cam.x + v.vw / 2 - x, G.cam.y + v.vh / 2 - y);
}

function drainEvents() {
  for (const e of G.events) {
    // (offline a colony's messages and sounds are for its players only;
    // online the server already sorted them)
    if (e.col >= 0 && G.colony && e.col !== G.colony.idx) continue;
    if (e.t === 'msg') {
      if (e.to < 0 || e.to === LOCAL) {
        pushMsg(msgText(e), e.color);
        if (e.to === LOCAL) tutSaw(e.key);
      }
    } else if (e.t === 'sfx') {
      if (e.to >= 0 && e.to !== LOCAL) continue;   // (another player's own sound)
      if (e.x == null || listenDist(e.x, e.y) < e.r) Sfx.play(e.k);
    } else if (e.t === 'fx') {
      if (e.k === 'flight') startFlightFx(e.x, e.y, e.n);
      else if (Particles[e.k] && listenDist(e.x, e.y) < 400) Particles[e.k](e.x, e.y, e.n);
    }
  }
  G.events.length = 0;
}

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------
const keys = {};
const pressed = {};
const typed = [];     // characters typed since the last step (name and code entry)

window.addEventListener('keydown', e => {
  if (!keys[e.code]) pressed[e.code] = true;
  if (e.key && e.key.length === 1) typed.push(e.key);
  keys[e.code] = true;
  Sfx.init(); Sfx.resume();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; Net.idle(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) Net.idle(); });

function tookPress(code) {
  if (pressed[code]) { pressed[code] = false; return true; }
  return false;
}
function held(action) { return BIND[action].some(k => keys[k]); }
function tookAction(action) {
  let hit = false;
  for (const k of BIND[action]) if (tookPress(k)) hit = true;
  return hit;
}

// copy the keyboard into the local player's input for this tick
function readInput() {
  const inp = G.players[LOCAL].input;
  const dx = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  const dy = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
  const me = localAnt();
  if (G.planMode && me) {
    // plan mode: the keys move the cursor, Space paints, X (held) erases
    movePlanCursor(me, dx, dy);
    inp.dx = inp.dy = 0;
    inp.bite = inp.build = false;
    inp.plan = true;
    inp.px = Math.round(G.planCur.x); inp.py = Math.round(G.planCur.y);
    inp.paint = held('bite') ? 1 : held('mark') ? 2 : 0;
    tookAction('mark');   // (X erases here: it marks no chamber)
  } else {
    inp.dx = dx; inp.dy = dy;
    inp.bite = held('bite');
    inp.build = held('build');
    inp.plan = false; inp.paint = 0;
    if (tookAction('mark')) inp.mark = true;
  }
  if (tookAction('act')) inp.act = true;
  if (tookAction('abil')) inp.abil = true;
  if (tookAction('raid')) { inp.raid = true; tutSaw('raid'); }
  if (tookAction('job')) { inp.job = true; tutSaw('job'); }
  if (tookAction('buildMat')) inp.buildMat = true;
}

// ---------------------------------------------------------------------------
// plan mode (B): a cursor of the client's own paints the colony's blueprint
// (the sim holds it to PLAN_REACH of the ant, as we do here)
// ---------------------------------------------------------------------------
function planOn() {
  const me = localAnt();
  if (!me) return;
  G.planMode = true;
  G.planSpd = 0;
  // (it starts just ahead of the ant, where a build stamp would go)
  G.planCur = { x: me.x + me.dir * 14, y: me.y };
  clampPlanCursor(me);
  Sfx.play('menu');
  tutSaw('plan');
}
function planOff() {
  if (!G.planMode) return;
  G.planMode = false;
  G.planCur = null;
  const p = G.players[LOCAL];
  if (p) { p.input.plan = false; p.input.paint = 0; }
}
// held to the reach around the ant and to the view (the camera follows)
function clampPlanCursor(me) {
  const c = G.planCur, v = playerView();
  const dx = c.x - me.x, dy = c.y - me.y, d = Math.hypot(dx, dy);
  if (d > PLAN_REACH) { c.x = me.x + dx / d * PLAN_REACH; c.y = me.y + dy / d * PLAN_REACH; }
  c.x = Math.max(G.cam.x + 2, Math.min(G.cam.x + v.vw - 3, c.x));
  c.y = Math.max(G.cam.y + 2, Math.min(G.cam.y + v.vh - 3, c.y));
  c.x = Math.max(0, Math.min(WORLD_W - 1, c.x));
  c.y = Math.max(0, Math.min(WORLD_H - 1, c.y));
}
// 1.2 px a frame at first (fine aim), speeding up to 3.5 while a direction is held
function movePlanCursor(me, dx, dy) {
  if (dx || dy) {
    G.planSpd = Math.min(3.5, G.planSpd ? G.planSpd + 0.06 : 1.2);
    const len = Math.hypot(dx, dy);
    G.planCur.x += dx / len * G.planSpd;
    G.planCur.y += dy / len * G.planSpd;
  } else G.planSpd = 0;
  clampPlanCursor(me);
}

function clearInput() {
  const p = G.players[LOCAL];
  if (p) p.input = newInput();
}

// ---------------------------------------------------------------------------
// starting and ending worlds
// ---------------------------------------------------------------------------
function enterWorld(slot) {
  G.slot = slot;
  G.stars = [];
  const srng = mulberry32(G.seed ^ 0x5747);
  for (let i = 0; i < 140; i++) G.stars.push({ x: srng() * WORLD_W, y: srng() * 280 });
  G.msgs = []; G.takeover = null; G.objScreen = null;
  G.flyers = []; G.flightCam = null;
  Particles.list = [];
  G.autosaveT = 7200;
  const a = localAnt();
  // (no ant yet -- just joined online: the view starts at the nest)
  const f = a || G.colony.entrance;
  G.cam = { x: f.x - VIEW_W / 2, y: f.y - 60 };
  TerrainView.build(f.x, f.y);      // the view around the start now, the rest frame by frame
}

// (a new solo world's year is as long as picked on the slot list)
function startNewWorld(slot) {
  newWorld((Math.random() * 0xFFFFFFFF) >>> 0, 1, 'solo', 1, G.crLen);
  assignJobs();   // (one player: the job the colony needs most)
  enterWorld(slot);
  Tut.start(true);
}

function startSavedWorld(slot) {
  const d = loadWorldData(slot);
  if (!d || !restoreWorld(d, 1)) return false;
  enterWorld(slot);
  Tut.start(false);
  return true;
}

function endWorld() {
  const o = G.over;
  G.gameOverStats = o;
  G.overSel = 0;
  // after a nuptial flight the colony lives on: keep (and save) the world
  if (o.canContinue) saveWorld(G.slot);
  else deleteWorld(G.slot);
  G.running = false;
  G.takeover = null; G.objScreen = null;
  G.state = 'gameover';
  Sfx.play(o.win ? 'task' : 'die');
}

// ---------------------------------------------------------------------------
// the nuptial flight: winged princesses rise from the entrance into the sky
// (cosmetic; the sim already took them out of the colony)
// ---------------------------------------------------------------------------
function startFlightFx(x, y, n) {
  G.flyers = [];
  for (let i = 0; i < n; i++) {
    G.flyers.push({ x, y, delay: i * 40, t: 0, dir: i % 2 ? 1 : -1, phase: Math.random() * 6 });
  }
  G.flightCam = { x, y, t: FLIGHT_T };
}

function updateFlyers() {
  for (const f of G.flyers) {
    if (f.delay > 0) { f.delay--; continue; }
    f.t++;
    // a hop out of the shaft, then a climbing spiral into the sky
    f.x += f.dir * (0.3 + Math.sin(f.t * 0.05 + f.phase) * 0.6);
    f.y -= Math.min(0.7, 0.15 + f.t * 0.004);
  }
  G.flyers = G.flyers.filter(f => f.t < 360);
}

function drawFlyers(camx, camy) {
  for (const f of G.flyers) {
    if (f.delay > 0) continue;
    const ex = Math.round(f.x - camx), ey = Math.round(f.y - camy);
    const flap = (f.t >> 2) % 2;
    ctx.fillStyle = 'rgba(235,240,255,0.8)';        // wings
    ctx.fillRect(ex - 4, ey - 3 - flap * 2, 4, 2);
    ctx.fillRect(ex + 1, ey - 3 - flap * 2, 4, 2);
    ctx.fillStyle = '#b0405c';                       // body
    ctx.fillRect(ex - 3, ey - 1, 7, 2);
    ctx.fillStyle = '#601c30';
    ctx.fillRect(ex + 3, ey - 1, 1, 1);
  }
}

// ---------------------------------------------------------------------------
// play update
// ---------------------------------------------------------------------------
function updatePlay() {
  // the ant-selection overlay owns the keys while it's open (and the
  // objectives screen likewise; neither pauses the world)
  // (plan mode ends with the ant -- or when an overlay takes the keys)
  if (G.planMode && (!localAnt() || G.takeover || G.objScreen || G.showMap)) planOff();
  if (G.takeover) { updateTakeover(); clearInput(); }
  else if (G.objScreen) { clearInput(); updateObjScreen(); }
  else if (tookAction('obj')) {
    planOff();
    G.objScreen = { page: 0, sel: 0 };
    Sfx.play('menu');
    clearInput();
    tutSaw('obj');
  } else if (tookAction('swap') && localAnt()) {
    const a = localAnt();
    planOff();
    if (!openTakeover(a.x, a.y, true)) pushMsg(L('m_noSwitch'), '#ff8040');
    clearInput();
  } else {
    // B: in and out of plan mode (Esc leaves it too, before it pauses)
    if (tookAction('plan') || (G.planMode && tookPress('Escape'))) {
      if (G.planMode) { planOff(); Sfx.play('menu'); } else planOn();
    }
    readInput();
  }
  // (J works over the switch overlay and the O screen too: it picks the next job)
  if ((G.takeover || G.objScreen) && tookAction('job')) { G.players[LOCAL].input.job = true; tutSaw('job'); }
  if (held('scores')) tutSaw('scores');

  // online the server steps the world; we draw its snapshots
  if (G.online) Net.frame(); else stepSim();
  worldTick();
  Tut.update();
  Coach.update();
  // (LEARN TO ANT: its year's end is the year chapter's flight -- no end
  // screen, nothing saved; the chapters may end the scenario)
  if (G.over && Learn.on) Learn.over();
  const was = G.state;
  Learn.update();
  if (G.state !== was) return;

  if (G.over && !G.online) { endWorld(); return; }
  if (G.online && G.state !== 'play') return;   // (the match ended, or the connection did)

  // dead (or just joined): offer another body -- online not while the
  // server is still handing us the one we picked
  const me = G.players[LOCAL];
  if (!localAnt() && !G.takeover && !(G.online && Net.takeWait > 0)) {
    const ref = me.deathPos || G.colony.entrance;
    openTakeover(ref.x, ref.y, false);
  }

  // autosave (a match online isn't saved, nor LEARN TO ANT's world)
  if (!G.online && !Learn.on) G.autosaveT--;
  if (G.autosaveT <= 0) {
    G.autosaveT = 7200;
    if (saveWorld(G.slot)) { pushMsg(L('m_saved'), '#80c0ff'); Sfx.play('save'); }
  }

  if (tookPress('KeyM')) { G.showMap = !G.showMap; G.gatesT = 0; if (G.showMap) tutSaw('map'); }
  if (tookAction('arrow')) {
    G.arrowOn = !G.arrowOn;
    tutSaw('arrow');
    lsSet('maur_arrow', G.arrowOn ? 'on' : 'off');
    pushMsg(L('m_arrow', L(G.arrowOn ? 'w_on' : 'w_off')), '#ffe080');
    Sfx.play('menu');
  }
  if (tookPress('Escape') || tookPress('KeyP')) {
    if (G.takeover && G.takeover.live) { G.takeover = null; Sfx.play('menu'); }
    else { G.state = 'pause'; G.menuSel = 0; Sfx.play('menu'); }
  }
}

// what a running world does each tick besides the sim: events into sound,
// particles and messages, the flight, the toasts' timers, the camera
function worldTick() {
  drainEvents();
  Particles.update();
  if (G.flyers.length) updateFlyers();
  // messages (they wait while an overlay covers them, and show after)
  if (!overlayOpen()) for (const m of G.msgs) m.t--;
  G.msgs = G.msgs.filter(m => m.t > 0);
  updateCamera();
}

function updateCamera() {
  const p = G.cam;
  const v = playerView();
  // the nuptial flight: everyone watches the entrance
  const fc = G.flightCam;
  if (fc && fc.t > 0) {
    fc.t--;
    p.x += (fc.x - v.vw / 2 - p.x) * 0.06;
    p.y += (fc.y - 40 - v.vh / 2 - p.y) * 0.06;
    p.x = Math.max(0, Math.min(WORLD_W - v.vw, p.x));
    p.y = Math.max(0, Math.min(WORLD_H - v.vh, p.y));
    return;
  }
  const me = localAnt();
  if (!me) return;
  // (plan mode: the view leans toward the cursor, halfway)
  const c = G.planMode && G.planCur;
  const a = c ? { x: (me.x + c.x) / 2, y: (me.y + c.y) / 2, dir: me.dir } : me;
  // focus point with a deadzone: pixel jiggle (digging, climbing) doesn't
  // shake the view; big jumps (takeover, load) snap it
  if (p.fx === undefined || Math.abs(a.x - p.fx) > 100 || Math.abs(a.y - p.fy) > 100) {
    p.fx = a.x; p.fy = a.y; p.look = a.dir * 24;
  }
  const DZX = 5, DZY = 8;
  if (a.x > p.fx + DZX) p.fx = a.x - DZX;
  else if (a.x < p.fx - DZX) p.fx = a.x + DZX;
  if (a.y > p.fy + DZY) p.fy = a.y - DZY;
  else if (a.y < p.fy - DZY) p.fy = a.y + DZY;
  // eased look-ahead so turning around doesn't yank the view
  p.look += ((c ? 0 : a.dir * 24) - p.look) * 0.03;
  const tx = p.fx - v.vw / 2 + p.look;
  // (LEARN TO ANT: the ant clear of the chapter's panel below it)
  const ty = p.fy - v.vh / 2 - 8 + (Learn.on ? Learn.lift : 0);
  p.x += (tx - p.x) * 0.08;
  p.y += (ty - p.y) * 0.08;
  p.x = Math.max(0, Math.min(WORLD_W - v.vw, p.x));
  p.y = Math.max(0, Math.min(WORLD_H - v.vh, p.y));
}

// ---------------------------------------------------------------------------
// the ant-selection overlay, shared by death takeover and live switching
// (live = cancellable, keeps the current ant until a choice is made). The
// world keeps running underneath -- online it can't pause for one player.
// ---------------------------------------------------------------------------
function openTakeover(refX, refY, live) {
  const types = takeoverOptions(LOCAL);
  if (types.length === 0) return false;
  // (the caste the player's job suits comes preselected; any will do)
  const pl = G.players[LOCAL], k = pl && pl.job ? types.findIndex(t => t.caste === JOB_CASTE[pl.job]) : -1;
  G.takeover = { types, sel: Math.max(0, k), refX, refY, live };
  Sfx.play('menu');
  return true;
}

function updateTakeover() {
  const tk = G.takeover;
  // refresh against ants that died (or got taken) while the menu was open
  tk.types = takeoverOptions(LOCAL);
  if (tk.types.length === 0) {
    // nobody free right now; a dead player waits (the sim ends the world
    // if the whole colony is gone)
    if (tk.live) G.takeover = null;
    return;
  }
  tk.sel = Math.min(tk.sel, tk.types.length - 1);
  if (tookPress('ArrowUp') || tookPress('KeyW')) { tk.sel = (tk.sel + tk.types.length - 1) % tk.types.length; Sfx.play('menu'); }
  if (tookPress('ArrowDown') || tookPress('KeyS')) { tk.sel = (tk.sel + 1) % tk.types.length; Sfx.play('menu'); }
  if (tookPress('Enter') || tookPress('Space')) {
    // (online the server hands us the ant; it arrives with a snapshot)
    const caste = tk.types[tk.sel].caste;
    if (G.online ? (Net.take(caste), true) : takeOver(LOCAL, caste, tk.refX, tk.refY)) {
      if (tk.live) tutSaw('tab');
      G.takeover = null;
      G.cam.fx = undefined; // snap the camera to the new body
      Sfx.play('select');
    }
  }
}

// ---------------------------------------------------------------------------
// the objectives screen (O): page 0 the season's milestones, page 1 the
// crystal upgrades. Like the switch overlay it never pauses the world; a
// purchase goes to the sim through the input struct (input.buy).
// ---------------------------------------------------------------------------
// (then the jobs; a persistent world has its history next; the last is
// always the player's own personal milestones)
function objPageIds() { return G.mode === 'world' ? ['obj', 'upg', 'job', 'hist', 'pm'] : ['obj', 'upg', 'job', 'pm']; }
function objPages() { return objPageIds().length; }

function updateObjScreen() {
  const os = G.objScreen;
  if (tookAction('obj') || tookPress('Escape')) { G.objScreen = null; Sfx.play('menu'); return; }
  const n = objPages();
  if (tookPress('ArrowLeft') || tookPress('KeyA')) { os.page = (os.page + n - 1) % n; Sfx.play('menu'); }
  if (tookPress('ArrowRight') || tookPress('KeyD')) { os.page = (os.page + 1) % n; Sfx.play('menu'); }
  const pid = objPageIds()[os.page];
  if (pid === 'job') {
    // the jobs: up/down picks one (from ours), Enter takes it up
    const pl = G.players[LOCAL];
    if (os.jsel === undefined) os.jsel = Math.max(0, JOBS.indexOf(pl && pl.job));
    const u = JOBS.length;
    if (tookPress('ArrowUp') || tookPress('KeyW')) { os.jsel = (os.jsel + u - 1) % u; Sfx.play('menu'); }
    if (tookPress('ArrowDown') || tookPress('KeyS')) { os.jsel = (os.jsel + 1) % u; Sfx.play('menu'); }
    if ((tookPress('Enter') || tookPress('Space')) && pl) { pl.input.jobSet = JOBS[os.jsel]; Sfx.play('select'); }
    return;
  }
  os.jsel = undefined;
  if (pid !== 'upg') return;
  const u = UPGRADE_IDS.length;
  if (tookPress('ArrowUp') || tookPress('KeyW')) { os.sel = (os.sel + u - 1) % u; Sfx.play('menu'); }
  if (tookPress('ArrowDown') || tookPress('KeyS')) { os.sel = (os.sel + 1) % u; Sfx.play('menu'); }
  if (tookPress('Enter') || tookPress('Space')) G.players[LOCAL].input.buy = UPGRADE_IDS[os.sel];
}

const SEASON_ICON = ['\x18', '\x04', '\x17', '\x16'];

function seasonName(s) { return L('season_' + SEASON_KEYS[s]); }

// a milestone's progress as shown: n/need, a percentage, or a check mark
function objProgress(o) {
  if (o.done) return '\x19';
  const def = objDef(o.id);
  if (def && def.pct) return Math.floor(100 * Math.min(1, o.n / o.need)) + '%';
  return Math.floor(o.n) + '/' + o.need;
}

function drawObjScreen() {
  const os = G.objScreen;
  const col = G.colony;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  // (a tall panel over the HUD too: the milestones, then the colony's
  // standing below a groove, the newest message, the keys)
  const PX = 10, PY = 6, PW = 300, PH = 186;
  // the world runs on under the panel: a hurt (or freezing) ant flashes it red
  const me = localAnt();
  if (me && me.flash > 0) {
    ctx.fillStyle = '#e03020';
    ctx.fillRect(PX - 2, PY - 2, PW + 4, PH + 4);
  }
  bevelPanel(PX, PY, PW, PH);
  const pid = objPageIds()[os.page] || 'obj';
  const title = L({ obj: 'ui_objectives', upg: 'ui_upgrades', job: 'ui_jobs', hist: 'ui_history', pm: 'ui_personal' }[pid]);
  drawTextCS(ctx, title, VIEW_W / 2, PY + 6, '#ffa040');
  drawText(ctx, '<', 18, PY + 6, (G.frame >> 4) % 2 ? '#ffe040' : '#a09070');
  drawText(ctx, '>', 297, PY + 6, (G.frame >> 4) % 2 ? '#ffe040' : '#a09070');
  drawText(ctx, (os.page + 1) + '/' + objPages(), 270, PY + 6, '#706050');
  const R = 300;   // right edge of the text column

  if (pid === 'obj') {
    const s = G.season;
    drawText(ctx, SEASON_ICON[s] + ' ' + L('ui_seasonYear', seasonName(s), G.year), 20, 26, SEASON_COLOR[s]);
    const left = SEASON_DAYS - G.seasonDay;
    const ls = left <= 1 ? L('ui_lastDay') : Ln('ui_daysLeft', left);
    drawText(ctx, ls, R - textWidth(ls), 26, '#c8b890');
    let y = 40;
    for (const o of G.objectives.list) {
      const def = objDef(o.id);
      drawText(ctx, o.done ? '\x19' : '-', 20, y, o.done ? '#80ff80' : '#a09070');
      drawText(ctx, objName(o), 30, y, o.done ? '#80ff80' : '#e8e0c8');
      const pr = objProgress(o);
      drawText(ctx, pr, R - textWidth(pr), y, o.done ? '#80ff80' : '#ffe080');
      // a food goal the stores can't hold yet says so (taking turns with
      // the end-of-season note)
      const capped = !o.done && FOOD_GOALS.includes(o.id) && col.caps && o.need > col.caps.food;
      const atEnd = def && def.kind === 'end' && !o.done;
      if (capped && (!atEnd || (G.frame >> 7) % 2)) {
        drawText(ctx, L('ui_storeCap', col.caps.food), 30, y + 9, '#ff9040');
        y += 9;
      } else if (atEnd) {
        drawText(ctx, L('ui_atEnd'), 30, y + 9, '#806e58');
        y += 9;
      }
      y += 12;
    }
    // the colony's standing, in two columns under a groove (9 px rows: the
    // golden seed's took the room)
    groove(18, 105, 284);
    const rowL = (str, yy, color) => drawText(ctx, str, 20, yy, color);
    const rowR = (str, yy, color) => drawText(ctx, str, R - textWidth(str), yy, color);
    rowL(L('ui_mound', col.mound.size), 110, '#d8b860');
    rowR(col.sealed ? L('ui_sealed') : L('ui_open'), 110, col.sealed ? '#80ff80' : '#ff9040');
    rowL(L('ui_crystals', col.crystals), 119, '#80e0ff');
    rowR(L('ui_milestones', G.objectives.yearDone), 119, '#ffe040');
    rowL(L('ui_score', col.score), 128, '#a0c8a0');
    // versus: our own queen's health (her fall with no heir loses the match)
    const oq = G.mode === 'versus' ? col.queen() : null;
    if (oq) rowR(L('ui_ourQueen', Math.max(1, Math.round(oq.hp / oq.maxHp * 100))), 128, oq.hp < oq.maxHp * 0.5 ? '#ff5040' : '#a8e8a0');
    // (else the builders' stocks, and how much is planned)
    else if (col.stock) rowR(L('ui_stockLine', Math.floor(col.stock.soil), Math.floor(col.stock.thatch), col.plan.size), 128, '#c8a070');
    // the rival: a rough head count (nobody counts red ants one by one;
    // in versus it is just the enemy, whichever side we're on)
    const r = G.rival;
    if (r) {
      // (versus: to the nearest 2 -- the sides start even, and should read so)
      const vs = G.mode === 'versus', step = vs ? 2 : 5;
      const rs = r.defeated ? L(r.slain ? 'ui_rivalSlain' : 'ui_rivalDied')
        : L(vs ? 'ui_enemy' : 'ui_rival', Math.max(step, Math.round(r.members().length / step) * step));
      rowL(rs, 137, r.defeated ? '#80ff80' : '#ff7060');
      // once found, how her health stands (the bonus is a long campaign)
      const q = !r.defeated && r.queenSeen ? r.queen() : null;
      if (q) rowR(L('ui_rivalQueen', Math.max(1, Math.round(q.hp / q.maxHp * 100))), 137, '#ff9080');
    }
    // our golden seed: how it stands, and this year's brought home (each a
    // milestone's worth at the flight)
    const rls = relicState();
    if (rls) {
      rowL('\x1C ' + relicStatus(rls), 146, relicColor(rls));
      rowR(L('ui_relicsHome', rls.got, RELIC_SEASONS), 146, rls.got ? '#ffe040' : '#a09070');
    }
    // the next flight: this spring's if it hasn't flown yet, else next year's
    // (a persistent world: with its legacy so far; versus: the match's goal)
    const flightYear = G.season === SPRING && G.year >= 2 && G.lastFlightYear < G.year ? G.year : G.year + 1;
    const goal = G.mode === 'world' ? L('ui_legacyLine', G.legacy, G.gen, flightYear)
      : G.mode === 'versus' ? L('ui_vsGoal', 2) : L('ui_yearGoal', flightYear);
    drawTextC(ctx, goal, VIEW_W / 2, 156, '#ff90e0');
    drawTextC(ctx, L('ui_objKeys'), VIEW_W / 2, 179, '#a09070');
  } else if (pid === 'pm') {
    drawPersonalPage(R);
  } else if (pid === 'job') {
    drawJobPage(R);
  } else if (pid === 'hist') {
    // a persistent world's story: each year's flight (or the colony lost),
    // the newest first, with the legacy it banked
    drawTextC(ctx, L('ui_legacyN', G.legacy) + '   ' + L('ui_worldColony', G.gen), VIEW_W / 2, 26, '#ff90e0');
    const hist = G.history.slice().reverse().slice(0, 9);
    if (!hist.length) drawTextC(ctx, L('ui_noHistory'), VIEW_W / 2, 70, '#806e58');
    let y = 42;
    for (const h of hist) {
      drawText(ctx, L('h_when', h.gen || 1, h.year), 20, y, '#c8b890');
      const fl = h.out === 'flight';
      const out = fl ? L('h_flight') + ' ' + '\x15'.repeat(h.stars || 0) : L(h.out === 'lost' ? 'h_lost' : 'h_noFlight');
      drawText(ctx, out, 160, y, fl ? '#ff90e0' : h.out === 'lost' ? '#ff7060' : '#a09070');
      if (h.legacy) { const s = '+' + h.legacy; drawText(ctx, s, R - textWidth(s), y, '#ffe040'); }
      y += 11;
    }
    groove(18, 143, 284);
    drawTextC(ctx, L('ui_histNote'), VIEW_W / 2, 150, '#806e58');
    drawTextC(ctx, L('ui_objKeys'), VIEW_W / 2, 179, '#a09070');
  } else {
    drawText(ctx, '\x13 ' + L('ui_crystals', col.crystals), 20, 26, '#80e0ff');
    for (let i = 0; i < UPGRADE_IDS.length; i++) {
      const id = UPGRADE_IDS[i];
      const y = 44 + i * 16;
      const sel = i === os.sel;
      const lv = col.upg[id] || 0;
      if (sel) drawText(ctx, '\x06', 18, y, '#ffe040');
      drawText(ctx, L('up_' + id), 28, y, sel ? '#ffe040' : '#e8e0c8');
      for (let k = 0; k < UPGRADES[id].length; k++) {     // level pips
        ctx.fillStyle = k < lv ? '#80e0ff' : '#2a1c10';
        ctx.fillRect(176 + k * 9, y, 7, 7);
      }
      const cost = col.upgradeCost(id);
      const cs = cost === Infinity ? L('ui_max') : '\x13' + cost;
      drawText(ctx, cs, R - textWidth(cs), y,
        cost === Infinity ? '#80ff80' : cost <= col.crystals ? '#80e0ff' : '#806e58');
    }
    groove(18, 110, 284);
    drawTextC(ctx, L('upd_' + UPGRADE_IDS[os.sel]), VIEW_W / 2, 118, '#c8b890');
    drawTextC(ctx, L('ui_upgKeys'), VIEW_W / 2, 179, '#a09070');
  }
  // the newest message (a purchase, a refusal, the cold) would hide under
  // the panel: a status line shows it here, clear of the keys
  const m = G.msgs[G.msgs.length - 1];
  if (m) {
    ctx.globalAlpha = Math.min(1, m.t / 60);
    const w = textWidth(m.text) + 8;
    ctx.fillStyle = '#241a10';
    ctx.fillRect(Math.round((VIEW_W - w) / 2), 164, w, 11);
    drawTextC(ctx, m.text, VIEW_W / 2, 166, m.color);
    ctx.globalAlpha = 1;
  }
}

// the O screen's job page: our job and its goal this season, the four jobs
// (each with where the arrow takes it, its perk and the caste it suits),
// what the colony needs most now, the keys
function drawJobPage(R) {
  const os = G.objScreen, pl = G.players[LOCAL];
  const mine = pl && pl.job, g = myJobGoal(LOCAL);
  if (mine) {
    drawText(ctx, JOB_ICON[mine] + ' ' + L('ui_jobYours', jobName(mine)), 20, 26, JOB_COLOR[mine]);
    const gs = g ? (g.done ? L('ui_jobMet') : L('jg_' + mine, g.n, g.need)) : '';
    drawText(ctx, gs, R - textWidth(gs), 26, g && g.done ? '#80ff80' : '#ffe080');
  } else drawText(ctx, L('ui_jobNone'), 20, 26, '#a09070');
  const sel = os.jsel === undefined ? Math.max(0, JOBS.indexOf(mine)) : os.jsel;
  JOBS.forEach((j, k) => {
    const y = 40 + k * 23, on = j === mine;
    if (k === sel) drawText(ctx, '\x06', 18, y, '#ffe040');
    drawText(ctx, JOB_ICON[j], 28, y, JOB_COLOR[j]);
    drawText(ctx, jobName(j), 36, y, k === sel ? '#ffe040' : on ? JOB_COLOR[j] : '#e8e0c8');
    if (on) drawText(ctx, '\x19', 36 + textWidth(jobName(j)) + 6, y, '#80ff80');
    const cs = L('ui_jobCaste', casteName(JOB_CASTE[j]));
    drawText(ctx, cs, R - textWidth(cs), y, '#806e58');
    drawText(ctx, L('jd_' + j), 36, y + 9, '#c8b890');
  });
  groove(18, 133, 284);
  drawTextC(ctx, L('ui_jobNeed', jobName(colonyNeed(G.colony))), VIEW_W / 2, 139, '#ffd890');
  drawTextC(ctx, L('ui_jobKeys'), VIEW_W / 2, 150, '#a09070');
  drawTextC(ctx, L('ui_objKeys'), VIEW_W / 2, 179, '#a09070');
}

// the personal milestones that match each job (shown first on their page)
const JOB_PM = { forager: ['forager', 'milker'], builder: ['builder', 'digger'], guard: ['hunter', 'slayer'], seeker: ['prospector'] };

// the O screen's last page: the local player's own milestones (see
// PERSONAL in game.js) -- each track's name, its tiers as stars, the next
// tier's goal and how far along it is (a check mark once all three are in);
// the tracks of the player's job first, marked with its icon
function drawPersonalPage(R) {
  const p = G.players[LOCAL];
  const st = p && p.stats && p.stats.pm ? p.stats : newPlayerStats();
  const total = PERSONAL.reduce((n, t) => n + t.tiers.length, 0);
  drawText(ctx, '\x1B ' + L('ui_pmTotal', pmCount(st), total), 20, 26, '#ffe040');
  const you = p && p.name ? p.name : L('ui_you');
  drawText(ctx, you, R - textWidth(you), 26, playerColor(LOCAL));
  let y = 39;
  const first = (p && JOB_PM[p.job]) || [];
  const tracks = PERSONAL.filter(t => first.includes(t.id)).concat(PERSONAL.filter(t => !first.includes(t.id)));
  for (const t of tracks) {
    const tier = st.pm[t.id] || 0, full = tier >= t.tiers.length;
    if (first.includes(t.id)) drawText(ctx, JOB_ICON[p.job], 12, y, JOB_COLOR[p.job]);
    drawText(ctx, L('pm_' + t.id), 20, y, full ? '#80ff80' : tier ? '#e8e0c8' : '#a09070');
    for (let k = 0; k < t.tiers.length; k++) drawText(ctx, '\x15', 96 + k * 6, y, k < tier ? '#ffd030' : '#3a2c1c');
    const need = t.tiers[Math.min(tier, t.tiers.length - 1)];
    drawText(ctx, Ln('pmd_' + t.id, need), 120, y, full ? '#80c080' : '#c8b890');
    const pr = full ? '\x19' : Math.min(t.value(st), need) + '/' + need;
    drawText(ctx, pr, R - textWidth(pr), y, full ? '#80ff80' : '#ffe080');
    y += 11;
  }
  groove(18, y + 1, 284);
  drawTextC(ctx, L('ui_pmNote'), VIEW_W / 2, y + 6, '#806e58');
  drawTextC(ctx, L('ui_objKeys'), VIEW_W / 2, 179, '#a09070');
}

// a carved groove dividing a panel (dark line over a light one)
function groove(x, y, w) {
  ctx.fillStyle = '#241a10';
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = '#7a6044';
  ctx.fillRect(x, y + 1, w, 1);
}

// milestones whose goal is food in the stores
const FOOD_GOALS = ['food100', 'stockpile'];

// a milestone's name, with its (yearly growing) target
function objName(o) { return Ln('o_' + o.id, o.need); }

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

// the sky's season: a fresh spring, a warm autumn, a pale grey winter
const SKY_TINT = [[1.0, 1.04, 1.0], [1, 1, 1], [1.1, 0.94, 0.82], [0.9, 0.93, 1.0]];
function seasonSky(c) {
  const t = SKY_TINT[G.season];
  let r = c[0] * t[0], g = c[1] * t[1], b = c[2] * t[2];
  if (G.season === WINTER) {
    const l = (r + g + b) / 3;
    r += (l - r) * 0.4; g += (l - g) * 0.4; b += (l - b) * 0.4;
  }
  return [Math.min(255, r) | 0, Math.min(255, g) | 0, Math.min(255, b) | 0];
}

// winter: snow drifts on the ground (drawn, never terrain) and flakes falling
function drawSnow(camx, camy, vw, vh) {
  ctx.fillStyle = '#eef2f8';
  for (let i = 0; i < vw; i++) {
    const x = camx + i;
    if (x < 0 || x >= WORLD_W) continue;
    const s = T.surf[x];
    if (s > T.bgSurf[x] + 2 || T.m[(s - 1) * WORLD_W + x] !== M_AIR) continue; // a pit, or built over
    const ey = s - camy;
    if (ey < -2 || ey > vh) continue;
    const th = 1 + (pxHash(x, 77) % 3 === 0 ? 1 : 0);
    ctx.fillRect(i, ey - th, 1, th);
  }
  ctx.fillStyle = '#ffffff';
  for (let k = 0; k < 60; k++) {
    const h = pxHash(k, 1234);
    const fx = ((h % 997) + G.tick * (0.15 + (h % 5) * 0.04) + Math.sin(G.tick * 0.02 + k) * 6) % vw;
    const fy = ((h >> 10) % 613 + G.tick * (0.25 + (h % 7) * 0.05)) % vh;
    const wx = Math.floor(camx + fx);
    if (wx < 0 || wx >= WORLD_W || camy + fy >= T.bgSurf[wx]) continue;  // only in the open air
    ctx.fillRect(Math.floor(fx), Math.floor(fy), 1, 1);
  }
}

// aphid shelters (a few aphids grazing under the thatch) and fungus gardens
// (mushrooms on the floor, more with a bigger leaf stock)
function drawStructures(camx, camy, vw, vh) {
  const col = G.colony;
  for (const sh of col.shelters) {
    const ex = Math.round(sh.x - camx), ey = Math.round(sh.y - camy);
    if (ex < -24 || ex > vw + 24 || ey < -24 || ey > vh + 10) continue;
    // a signpost with an aphid on its plaque, off to the side
    const sx = ex - 12;
    ctx.fillStyle = '#5a3e22';
    ctx.fillRect(sx, ey - 4, 1, 7);
    ctx.fillStyle = '#7a6044';
    ctx.fillRect(sx - 4, ey - 13, 9, 9);
    ctx.fillStyle = '#2a1c10';
    ctx.fillRect(sx - 3, ey - 12, 7, 7);
    ctx.fillStyle = G.isWinter() ? '#708060' : '#8cc85a';
    ctx.fillRect(sx - 2, ey - 9, 5, 3);
    ctx.fillRect(sx - 1, ey - 10, 3, 1);
    // a little thatched dome over the herd, its doorway dark
    for (let dx = -10; dx <= 10; dx++) {
      const h = Math.round(8 * Math.sqrt(1 - (dx / 10.5) * (dx / 10.5)));
      for (let j = 0; j < h; j++) {
        const door = Math.abs(dx) <= 3 && j < 5;
        ctx.fillStyle = door ? '#2a1c10' : j === h - 1 ? '#8a6a30' : ((dx + j) >> 1) & 1 ? '#d8b860' : '#b89040';
        ctx.fillRect(ex + 2 + dx, ey + 2 - j, 1, 1);
      }
    }
    // the herd grazing (huddled and still in winter)
    for (const o of [-1, 3, -13, 15]) {
      const bob = G.isWinter() ? 0 : ((G.tick >> 5) + o) & 1;
      ctx.fillStyle = '#8cc85a';
      ctx.fillRect(ex + o - 1, ey + 1 - bob, 3, 2);
      ctx.fillStyle = '#2a3a1a';
      ctx.fillRect(ex + o + 1, ey + 1 - bob, 1, 1);
    }
  }
  for (const ch of col.chambers) {
    if (ch.type !== 'fungus' || !(ch.leaves > 0)) continue;
    const ex = Math.round(ch.x - camx), fy = Math.round(chamberFloor(ch) - camy);
    if (ex < -40 || ex > vw + 40 || fy < -10 || fy > vh + 20) continue;
    const n = Math.min(8, Math.ceil(ch.leaves / 5));
    for (let i = 0; i < n; i++) {
      const mx = ex - 14 + (pxHash(ch.id, i) % 29);
      if (Math.abs(mx - ex) < 3) continue;  // keep clear of the sign's stake
      ctx.fillStyle = '#96b292';
      ctx.fillRect(mx, fy - 1, 1, 2);
      ctx.fillStyle = '#c8ecd0';
      ctx.fillRect(mx - 1, fy - 2, 3, 1);
    }
  }
  // this summer's fallen fruit, where its pieces lie
  const cs = G.contested;
  if (cs && cs.active) {
    const ex = Math.round(cs.x - camx), ey = Math.round(cs.y - camy) + 2;
    if (ex > -20 && ex < vw + 20 && ey > -20 && ey < vh + 20) drawFruit(ex, ey);
  }
}

// the contested fruit: a fat windfall with a stalk and a leaf (bottom at y)
const FRUIT = [
  '   ss    ',
  '   s gg  ',
  ' rRRRRr  ',
  'rRHHRRRr ',
  'rRHRRRRrr',
  'rRRRRRRrr',
  ' rRRRRrr ',
  '  rrrrr  ',
];
const FRUIT_COL = { s: '#5a3e22', g: '#54a838', r: '#7a1828', R: '#c8304a', H: '#ff8c98' };
function drawFruit(ex, ey) {
  for (let j = 0; j < FRUIT.length; j++) {
    for (let i = 0; i < FRUIT[j].length; i++) {
      const c = FRUIT_COL[FRUIT[j][i]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(ex - 4 + i, ey - FRUIT.length + j, 1, 1);
    }
  }
}

function drawViewport(vx, vy, vw, vh) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(vx, vy, vw, vh);
  ctx.clip();
  ctx.translate(vx, vy);

  const camx = Math.round(G.cam.x), camy = Math.round(G.cam.y);
  const me = localAnt();
  const tod = G.tod();

  // sky
  const sc = seasonSky(skyColor(tod));
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
  ctx.drawImage(TerrainView.bgCan, camx, camy, vw, vh, 0, 0, vw, vh);
  ctx.drawImage(TerrainView.terCan, camx, camy, vw, vh, 0, 0, vw, vh);
  if (G.season === WINTER) drawSnow(camx, camy, vw, vh);
  drawStructures(camx, camy, vw, vh);

  // each colony's food cache, piled by prosperity
  ctx.fillStyle = '#d8b878';
  for (const c of G.colonies) {
    if (Math.abs(c.storage.x - camx - vw / 2) > vw) continue;
    const pile = Math.min(24, Math.floor(c.food / 6));
    for (let i = 0; i < pile; i++) {
      const h = pxHash(i * 17, 3);
      const px2 = c.storage.x - 10 + (h % 21);
      const py2 = c.storage.y + 8 - (Math.floor(h / 64) % 5) - Math.floor(Math.abs(px2 - c.storage.x) / 4);
      ctx.fillRect(Math.round(px2 - camx), Math.round(py2 - camy), 2, 1);
    }
  }
  const col = G.colony;

  // the marker X would act on (in sight and in reach) gets a blinking frame
  const markCh = me ? col.markTarget(me.x, me.y) : null;
  drawChamberSigns(camx, camy, vw, vh, markCh);

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
  drawFoeBars(camx, camy, vw, vh, me);

  Particles.draw(ctx, camx, camy);
  if (G.flyers.length) drawFlyers(camx, camy);

  // while building, show where the stamp will land (a red x: nowhere) --
  // or, by the blueprint, the planned pixels it fills next (drawn with it)
  const pl = G.players[LOCAL];
  const planNextUp = me && pl && pl.input.build && !G.planMode ? planNext(me, G.colony, pl.input.dx, pl.input.dy) : null;
  if (me && pl && pl.input.build && !planNextUp) {
    const aim = buildAim(me, pl.input.dx, pl.input.dy);
    if (aim) {
      const ex = Math.round(aim.bx - camx), ey = Math.round(aim.by - camy);
      // the stamp's footprint, in the material's colour, on the open pixels
      ctx.fillStyle = pl.buildMat === M_THATCH ? '#d2b05c' : pl.buildMat === M_GATE ? '#f0d080' : '#9c6a40';
      ctx.globalAlpha = 0.7 + 0.2 * Math.sin(G.frame * 0.2);
      const r = Math.ceil(BUILD_R);
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          const wx = Math.round(aim.bx) + ox, wy = Math.round(aim.by) + oy;
          if (ox * ox + oy * oy <= BUILD_R * BUILD_R && !T.solid(wx, wy)) ctx.fillRect(ex + ox, ey + oy, 1, 1);
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = (G.frame >> 3) % 2 ? '#ffe040' : '#fff8c0';
      ctx.fillRect(ex - 4, ey, 1, 1); ctx.fillRect(ex + 4, ey, 1, 1);   // (a cross framing it)
      ctx.fillRect(ex, ey - 4, 1, 1); ctx.fillRect(ex, ey + 4, 1, 1);
    } else {
      const f = aimPoint(me, pl.input.dx, pl.input.dy);
      const ex = Math.round(f.bx - camx), ey = Math.round(f.by - camy);
      ctx.fillStyle = '#ff4030';
      for (let k = -1; k <= 1; k++) {
        ctx.fillRect(ex + k, ey + k, 1, 1); ctx.fillRect(ex + k, ey - k, 1, 1);
      }
    }
  }

  // darkness: depth + night, with a pool of sight around your ant -- or,
  // while the nuptial flight plays, around the entrance the camera watches
  const fc = G.flightCam && G.flightCam.t > 0 ? G.flightCam : null;
  if (me || fc) {
    const lx = fc ? fc.x : me.x, ly = fc ? fc.y - 30 : me.y;
    const sx = Math.floor(Math.max(0, Math.min(WORLD_W - 1, lx)));
    const depth = Math.max(0, ly - T.bgSurf[sx]);
    let amb = Math.min(0.86, depth / 90 * 0.86);
    if (G.isNight()) amb = Math.max(amb, 0.55);
    else if (tod > 0.62) amb = Math.max(amb, (tod - 0.62) / 0.08 * 0.4);
    if (amb > 0.03) {
      const px2 = Math.round(lx - camx), py2 = Math.round(ly - camy);
      const grad = ctx.createRadialGradient(px2, py2, 18, px2, py2, 90);
      grad.addColorStop(0, 'rgba(4,2,8,0)');
      grad.addColorStop(0.7, `rgba(4,2,8,${amb * 0.55})`);
      grad.addColorStop(1, `rgba(4,2,8,${amb})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, vw, vh);
    }
  }
  // the blueprint over the dark (it's a drawing, not the world), the plan
  // cursor, and what F fills next
  drawPlan(camx, camy, vw, vh, planNextUp);
  if (G.planMode && me && G.planCur) drawPlanCursor(camx, camy, me);
  // labels over the dark (each in a free spot), then the guide arrows
  Labels.clear(camx, camy, vw, vh);
  if (G.online) drawNameTags(camx, camy, vw, vh);
  if (me) {
    drawChamberLabels(camx, camy, me, markCh);
    drawShelterLabel(camx, camy, me);
    drawSiteLabel(camx, camy, me);
  }
  drawGuides(camx, camy, vw, vh, me);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// the blueprint (our colony's only): a ghost of each planned pixel in its
// material's colour, a gentle pulse, its rim brighter; the plan cursor; in
// plan mode a bar of keys over the HUD
// ---------------------------------------------------------------------------
const PLAN_LOOK = { [M_PACKED]: '#e09a5c', [M_THATCH]: '#f2e070', [M_GATE]: '#8ce8ff' };
function planColor(m) { return PLAN_LOOK[m] || '#ffffff'; }

// next: what F fills next (planNext), drawn bright over the ghost
function drawPlan(camx, camy, vw, vh, next) {
  const col = G.colony;
  if (!col || !col.plan || !col.plan.size) return;
  const W = WORLD_W, plan = col.plan;
  const pulse = 0.5 + 0.5 * Math.sin(G.frame * 0.07);
  const fill = {}, rim = {};
  for (const [i, v] of plan) {
    const x = i % W - camx;
    if (x < 0 || x >= vw) continue;
    const y = ((i / W) | 0) - camy;
    if (y < 0 || y >= vh || T.m[i] !== M_AIR) continue;
    const edge = !plan.has(i - 1) || !plan.has(i + 1) || !plan.has(i - W) || !plan.has(i + W);
    const b = edge ? rim : fill;
    (b[v] || (b[v] = [])).push(x, y);
  }
  // (brighter while planning)
  const on = G.planMode ? 0.1 : 0;
  for (const [b, a] of [[fill, 0.3 + 0.12 * pulse + on], [rim, 0.62 + 0.3 * pulse + on]]) {
    ctx.globalAlpha = Math.min(1, a);
    for (const v in b) {
      ctx.fillStyle = planColor(Number(v));
      const l = b[v];
      for (let k = 0; k < l.length; k += 2) ctx.fillRect(l[k], l[k + 1], 1, 1);
    }
  }
  ctx.globalAlpha = 1;
  if (next && next.list.length) {
    ctx.fillStyle = (G.frame >> 2) % 2 ? '#ffffff' : '#ffe040';
    for (const i of next.list) ctx.fillRect(i % W - camx, ((i / W) | 0) - camy, 1, 1);
  }
}

// the plan cursor: a crosshair and the brush's circle (in the material's
// colour while it paints, red while it erases), and a faint ring of how far
// from the ant it may go
function drawPlanCursor(camx, camy, me) {
  const pl = G.players[LOCAL], c = G.planCur;
  const ex = Math.round(c.x - camx), ey = Math.round(c.y - camy);
  const paint = pl.input.paint;
  // (the ring in dots, light and dark by turns: it reads on sky and earth)
  ctx.globalAlpha = 0.45;
  const ax = me.x - camx, ay = me.y - camy;
  for (let k = 0; k < 96; k++) {
    const t = k / 96 * Math.PI * 2;
    ctx.fillStyle = k % 2 ? '#f0e8d0' : '#201810';
    ctx.fillRect(Math.round(ax + Math.cos(t) * PLAN_REACH), Math.round(ay + Math.sin(t) * PLAN_REACH), 1, 1);
  }
  ctx.globalAlpha = 1;
  // the brush
  const R = PLAN_BRUSH;
  ctx.fillStyle = paint === 2 ? '#ff5040' : paint ? planColor(pl.buildMat) : (G.frame >> 4) % 2 ? '#e8e0c8' : planColor(pl.buildMat);
  for (let oy = -R - 1; oy <= R + 1; oy++) {
    for (let ox = -R - 1; ox <= R + 1; ox++) {
      const d = Math.hypot(ox, oy);
      if (d > R + 0.5 && d <= R + 1.5) ctx.fillRect(ex + ox, ey + oy, 1, 1);
    }
  }
  // the crosshair, black-backed so it reads on sky and earth alike
  const arms = [[-R - 5, 0, 3, 1], [R + 3, 0, 3, 1], [0, -R - 5, 1, 3], [0, R + 3, 1, 3]];
  ctx.fillStyle = '#000000';
  for (const [x, y, w, h] of arms) ctx.fillRect(ex + x - 1, ey + y - 1, w + 2, h + 2);
  ctx.fillStyle = '#ffffff';
  for (const [x, y, w, h] of arms) ctx.fillRect(ex + x, ey + y, w, h);
  ctx.fillRect(ex, ey, 1, 1);
}

// plan mode's bar over the HUD: the keys, the material, the plan's size
// and the colony's stocks
function drawPlanBar() {
  const col = G.colony, pl = G.players[LOCAL];
  const y0 = VIEW_H - HUD_H - 30;
  bevelPanel(10, y0, 300, 28);
  drawTextC(ctx, L('ui_planKeys'), VIEW_W / 2, y0 + 4, '#ffe8a0');
  drawMatSwatch(16, y0 + 16, pl.buildMat);
  drawText(ctx, L(buildMatKey(pl.buildMat)), 25, y0 + 15, planColor(pl.buildMat));
  const n = col.plan.size;
  const ps = L('ui_planCount', n, PLAN_MAX);
  drawText(ctx, ps, 160 - textWidth(ps) / 2, y0 + 15, n >= PLAN_MAX ? '#ff9040' : '#c8b890');
  const st = L('ui_stockShort', Math.floor(col.stock.soil), Math.floor(col.stock.thatch));
  drawText(ctx, st, 304 - textWidth(st), y0 + 15, '#c8a070');
}

// ---------------------------------------------------------------------------
// chamber markers: a little signpost on the chamber floor
// ---------------------------------------------------------------------------
const FOE_BAR_T = 240;   // ticks a bitten enemy shows its health bar

const CH_LOOK = {
  storage:  { icon: '\x03', color: '#d8b878' },
  nursery:  { icon: '\x0E', color: '#efe9d8' },
  barracks: { icon: '\x12', color: '#e07050' },
  royal:    { icon: '\x11', color: '#ff90e0' },
  fungus:   { icon: '\x14', color: '#a8d4b2' },
};

// a small health bar over an enemy that is hurt: the red queen once she's
// been found, an enemy ant bitten in the last few seconds, and a hurt big
// bug (spider, centipede, wasp, beetle) bitten lately or near the player's
// ant -- a fight shows its progress
// Returns how many bars it drew.
function drawFoeBars(camx, camy, vw, vh, me) {
  let n = 0;
  const bar = (e, w, up, color) => {
    const ex = Math.round(e.x - camx) - (w >> 1), ey = Math.round(e.y - camy) - up;
    if (ex < -w || ex > vw || ey < -4 || ey > vh) return;
    n++;
    ctx.fillStyle = '#1a1008';
    ctx.fillRect(ex, ey, w, 3);
    ctx.fillStyle = color;
    ctx.fillRect(ex + 1, ey + 1, Math.max(1, Math.round((w - 2) * e.hp / e.maxHp)), 1);
  };
  for (const a of G.ants) {
    if (a.hp <= 0 || a.colony === G.colony || a.hp >= a.maxHp) continue;
    const queen = a.caste === 'queen' && a.colony.queenSeen;
    if (!queen && !(G.tick - (a.hitT || -1e9) < FOE_BAR_T)) continue;
    bar(a, queen ? 16 : 8, queen ? 12 : 9, queen ? '#ff4060' : '#e08040');
  }
  for (const b of G.bugs) {
    if (b.dead || !b.predator || b.hp >= b.maxHp) continue;
    const near = me && dist2(b.x, b.y, me.x, me.y) < 110 * 110;
    if (!near && !(G.tick - (b.hitT || -1e9) < FOE_BAR_T)) continue;
    bar(b, b.kind === 'beetle' || b.kind === 'centipede' ? 14 : 10, b.hh + 6, '#e0c040');
  }
  return n;
}

// labels in the world (chamber names, the aphid shelters, the fruit) are
// placed one by one, each nudged up or down to a free spot or else left out,
// so no label is ever drawn over another
const Labels = {
  rects: [],
  // (the screen's own text keeps its place: the task lines, the toasts, the
  // hint panel, the raid banner -- and the guide arrow over its target)
  clear(camx, camy, vw, vh) {
    this.rects.length = 0;
    const me = localAnt(), t = me && G.arrowOn && !overlayOpen() ? guideTarget() : null;
    if (t) {
      const sp = edgeSpot(t.x, t.y, camx, camy, vw, vh);
      if (sp.sight) this.rects.push({ x: sp.x - 6, y: sp.y - 7, w: 13, h: 15 });
    }
    this.rects.push({ x: 0, y: 0, w: VIEW_W, h: 22 });
    if (G.msgs.length) this.rects.push({ x: 20, y: 23, w: VIEW_W - 40, h: G.msgs.length * 10 });
    const hint = !!(Tut.active() && localAnt());
    if (hint) this.rects.push({ x: 8, y: 142, w: 304, h: 34 });
    const raid = raidAlert();
    if (raid && raid.banner) this.rects.push({ x: 0, y: hint ? 131 : 159, w: VIEW_W, h: 13 });
  },
  // lines: [[text, color], ...] stacked upward from y (the bottom line's top)
  place(cx, y, lines) {
    const w = Math.max(...lines.map(l => textWidth(l[0]))) + 2;
    const h = lines.length * 9;
    for (const dy of [0, -9, 9, -18, 18]) {
      const r = { x: cx - (w >> 1), y: y + dy - h + 9, w, h };
      if (this.rects.some(o => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h)) continue;
      this.rects.push(r);
      for (let i = 0; i < lines.length; i++) drawTextCS(ctx, lines[i][0], cx, r.y + i * 9, lines[i][1]);
      return true;
    }
    return false;
  },
};

// online: the other players' ants carry their names, in their colours
// (placed first, so the chamber labels keep clear of them)
// (on a dark plate, kept on the screen, and lifted clear of every player's
// chevron -- the local one's too -- and of each other. Only for ants on
// screen; nearest the local ant first, and a tag with no clear spot left
// (a crowd of players) is left out rather than drawn over another)
function drawNameTags(camx, camy, vw, vh) {
  const hit = (r, list) => list.some(o => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h);
  const keep = [];
  const shown = [];
  for (let i = 0; i < G.players.length; i++) {
    const p = G.players[i];
    if (!p || !p.ant) continue;
    const a = p.ant;
    const sx = Math.round(a.x - camx), sy = Math.round(a.y - camy);
    if (sx < -8 || sx > vw + 8 || sy < -8 || sy > vh + 8) continue;
    keep.push({ x: sx - 5, y: sy - Math.round(a.hh) - 12, w: 11, h: 8 });
    if (i !== LOCAL && p.name && sx >= 0 && sx < vw && sy >= 0 && sy < vh) shown.push(i);
  }
  const me = localAnt();
  if (me) shown.sort((i, j) => dist2(G.players[i].ant.x, G.players[i].ant.y, me.x, me.y) - dist2(G.players[j].ant.x, G.players[j].ant.y, me.x, me.y));
  // (the task, milestone and goal lines at the top stay readable: a tag
  // that would cover them goes under its ant instead)
  const top = G.showMap || G.objScreen ? [] : topLayout().rects;
  // (...and so do the toasts under them)
  if (G.msgs.length && !overlayOpen()) top.push({ x: 0, y: 23, w: VIEW_W, h: G.msgs.length * 10 });
  for (const i of shown) {
    const p = G.players[i];
    const a = p.ant;
    const w = textWidth(p.name) + 4;
    let ex = Math.round(a.x - camx), ey = Math.round(a.y - camy) - Math.round(a.hh) - 21;
    ex = Math.max((w >> 1) + 1, Math.min(vw - (w >> 1) - 1, ex));
    ey = Math.max(1, ey);
    const blocked = yy => hit({ x: ex - (w >> 1), y: yy - 1, w, h: 10 }, keep) || hit({ x: ex - (w >> 1), y: yy - 1, w, h: 10 }, top);
    for (let n = 0; n < 2 && blocked(ey); n++) ey -= 10;
    if (ey < 1 || blocked(ey)) ey = Math.round(a.y - camy) + Math.round(a.hh) + 4;
    if (ey > vh - 10 || blocked(ey)) continue;
    const r = { x: ex - (w >> 1), y: ey - 1, w, h: 10 };
    ctx.fillStyle = 'rgba(16,8,4,0.7)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    drawTextCS(ctx, p.name, ex, ey, playerColor(i));
    keep.push(r);
    Labels.rects.push(r);
  }
}

// this summer's fallen fruit: named when the player's ant is near it
function drawSiteLabel(camx, camy, me) {
  const cs = G.contested;
  if (!me || !cs || !cs.active || Math.abs(cs.x - me.x) > 170 || Math.abs(cs.y - me.y) > 90) return;
  Labels.place(Math.round(cs.x - camx), Math.round(cs.y - camy) - 22, [[L('ui_siteLabel'), '#ffb0c0']]);
}

// the floor under a marker (markers sit at a chamber's middle)
function chamberFloor(ch) {
  let y = ch.y;
  for (let i = 0; i < 28 && !T.solid(ch.x, y + 1); i++) y++;
  return y;
}

function chamberCramped(ch) { return ch.area < CH_MIN_AREA; }

function drawChamberSigns(camx, camy, vw, vh, target) {
  for (const ch of G.colony.chambers) {
    const ex = Math.round(ch.x - camx), ey = Math.round(chamberFloor(ch) - camy);
    if (ex < -10 || ex > vw + 10 || ey < -10 || ey > vh + 20) continue;
    const look = CH_LOOK[ch.type];
    ctx.fillStyle = '#5a3e22';               // stake
    ctx.fillRect(ex, ey - 6, 1, 7);
    if (ch === target && (G.frame >> 4) % 2) {
      ctx.fillStyle = '#ffe040';             // X acts on this one
      ctx.fillRect(ex - 5, ey - 16, 11, 12);
    }
    ctx.fillStyle = '#7a6044';               // plaque
    ctx.fillRect(ex - 4, ey - 15, 9, 10);
    ctx.fillStyle = '#2a1c10';
    ctx.fillRect(ex - 3, ey - 14, 7, 8);
    const blink = chamberCramped(ch) && (G.frame >> 4) % 2;
    drawText(ctx, look.icon, ex - 2, ey - 14, blink ? '#ff4030' : look.color);
  }
}

// the names (and cramped warnings) of the signs near the player's ant: the
// one X would act on first, then the nearest few, none over another
function drawChamberLabels(camx, camy, me, target) {
  const near = G.colony.chambers.filter(c => c !== target &&
    Math.abs(c.x - me.x) < 110 && Math.abs(c.y - me.y) < 70);
  near.sort((a, b) => dist2(a.x, a.y, me.x, me.y) - dist2(b.x, b.y, me.x, me.y));
  const list = (target ? [target] : []).concat(near.slice(0, 3));
  for (const ch of list) {
    const ex = Math.round(ch.x - camx), ey = Math.round(chamberFloor(ch) - camy);
    const lines = [[L('ch_' + ch.type), CH_LOOK[ch.type].color]];
    if (chamberCramped(ch)) lines.unshift([L('w_cramped'), '#ff5040']);
    Labels.place(ex, ey - 25, lines);
  }
}

// the aphid shelters near the player's ant: the name, and whether one
// sleeps (winter) or is short of thatch (it falls apart below half the need)
function drawShelterLabel(camx, camy, me) {
  const col = G.colony;
  for (const sh of col.shelters) {
    if (Math.abs(sh.x - me.x) > 120 || Math.abs(sh.y - me.y) > 70) continue;
    const ex = Math.round(sh.x - 12 - camx), ey = Math.round(sh.y - camy);
    const lines = [[L('ui_shelter'), '#8cc85a']];
    if (col.thatchNear(sh.x, sh.y, SHELTER_R) < SHELTER_THATCH) {
      if ((G.frame >> 4) % 2) lines.unshift([L('ui_shelterWeak'), '#ff5040']);
    } else if (G.isWinter()) {
      lines.unshift([L('ui_shelterIdle'), '#a0c0e0']);
    }
    Labels.place(ex, ey - 24, lines);
  }
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

function drawHpBar(x, y, w, pct, color) {
  ctx.fillStyle = '#1a1008';
  ctx.fillRect(x, y, w, 5);
  const fw = Math.max(0, Math.round((w - 2) * pct));
  ctx.fillStyle = color || (pct > 0.5 ? '#40c040' : pct > 0.25 ? '#e0c020' : '#e03020');
  ctx.fillRect(x + 1, y + 1, fw, 3);
}

// a small 5 px load bar; the selected building material gets a gold frame
function drawLoadBar(x, y, w, pct, color, sel) {
  if (sel) {
    ctx.fillStyle = '#ffe040';
    ctx.fillRect(x - 1, y - 1, w + 2, 7);
  }
  ctx.fillStyle = '#1a1008';
  ctx.fillRect(x, y, w, 5);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, Math.round((w - 2) * Math.max(0, Math.min(1, pct))), 3);
}

// the bottom HUD in three groups divided by grooves: your ant (caste,
// health, what it carries, its building loads and the selected material),
// the colony (ants, brood, food against their caps; crystals) and the time
// (season and year, day of the season and the clock)
const HUD_G1 = 108, HUD_G2 = 226;

function drawHud() {
  const y = VIEW_H - HUD_H;
  bevelPanel(0, y, VIEW_W, HUD_H);
  for (const gx of [HUD_G1, HUD_G2]) {
    ctx.fillStyle = '#241a10';
    ctx.fillRect(gx, y + 3, 1, HUD_H - 6);
    ctx.fillStyle = '#7a6044';
    ctx.fillRect(gx + 1, y + 3, 1, HUD_H - 6);
  }
  const col = G.colony;
  const caps = col.caps;

  // your ant
  const me = localAnt();
  const pl = G.players[LOCAL];
  if (me) {
    drawText(ctx, casteName(me.caste), 4, y + 4, '#e8d8b0');
    // out in the winter cold: the bar frosts over (blinking)
    const freezing = G.isWinter() && !col.sheltered(me) && (G.frame >> 3) % 2;
    drawText(ctx, '\x01', 4, y + 14, freezing ? '#a0d8ff' : '#e05040');
    drawHpBar(11, y + 15, 36, Math.max(0, me.hp / me.maxHp), freezing ? '#a0d8ff' : null);
    if (me.carry) drawItem(ctx, { kind: me.carry.kind, x: 0, y: 0 }, -54, -(y + 17));
    // building loads: soil above (packed earth and gates), thatch below;
    // the selected material's bar is framed in gold, its swatch beside it
    const thatchSel = pl.buildMat === M_THATCH;
    drawText(ctx, '\x0F', 61, y + 4, thatchSel ? '#806040' : '#c08850');
    drawLoadBar(68, y + 5, 26, me.soil / LOAD_CAP, '#a06a3c', !thatchSel);
    drawText(ctx, '\x10', 61, y + 14, thatchSel ? '#e8c870' : '#a08848');
    drawLoadBar(68, y + 15, 26, me.thatch / LOAD_CAP, '#d8b860', thatchSel);
    drawMatSwatch(98, thatchSel ? y + 14 : y + 4, pl.buildMat);
  } else if (G.online && pl && !pl.deathPos) {
    // (just joined: no ant yet, and none lost)
    drawTextC(ctx, L('w_joining'), HUD_G1 / 2, y + 9, '#c8b890');
  } else {
    drawTextC(ctx, L('w_dead'), HUD_G1 / 2, y + 9, '#e03020');
  }

  // the colony: ants and brood against capacity, food against the stores
  const ants = col.members().length;
  const brood = col.broodCount();
  const food = Math.floor(col.food);
  const cx = HUD_G1 + 5, cx2 = HUD_G1 + 62;
  // the queen stops laying once adults + brood fill the room: warn on that
  drawText(ctx, '\x02' + ants + '/' + caps.pop, cx, y + 4, ants + brood >= caps.pop ? '#ff9040' : '#e8c8a0');
  drawText(ctx, '\x0E' + brood + '/' + caps.brood, cx2, y + 4, brood >= caps.brood ? '#ff9040' : '#d0c8b0');
  drawText(ctx, '\x03' + food + '/' + caps.food, cx, y + 14, food >= caps.food ? '#ff9040' : '#d8b878');
  drawText(ctx, '\x13' + col.crystals, cx2, y + 14, '#80e0ff');

  // the time
  const tx = HUD_G2 + 5;
  drawText(ctx, SEASON_ICON[G.season] + L('ui_hudSeason', seasonName(G.season), G.year), tx, y + 4, SEASON_COLOR[G.season]);
  const night = G.isNight();
  drawText(ctx, (night ? '\x05' : '\x04') + L('ui_hudClock', (G.seasonDay + 1) + '/' + SEASON_DAYS, clockText()),
    tx, y + 14, night ? '#9090b8' : '#c8b890');
}

// the time of day as a clock: the day breaks around five in the morning
function clockText() {
  const min = Math.floor(((5 + G.tod() * 24) % 24) * 6) * 10;
  const h = Math.floor(min / 60), m = min % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

// a 5x5 sample of a building material (the selected one, by its load bar)
function drawMatSwatch(x, y, mat) {
  ctx.fillStyle = '#1a1008';
  ctx.fillRect(x - 1, y - 1, 7, 7);
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < 5; i++) {
      const c = matColor(mat, i + 3, j + 2, pxHash(i + 7, j + 3), 50, 0);
      ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      ctx.fillRect(x + i, y + j, 1, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// the top of the screen: the current task and the season's next milestone
// down the left (two rows of 10 px), and the season's goal at a glance on
// the right -- the season, its milestones done, the time left in it; from
// autumn the princesses raised (grown or growing), in winter the time to
// the nuptial flight. The goal strip takes the first row with room beside
// the left-hand text, in its longest form that fits (it always fits in its
// short form: the task line is the shorter one). The name tags keep clear
// of all of it (topLayout().rects).
// ---------------------------------------------------------------------------
// With a job the first row is the job's: its icon and the season's goal
// (or GOAL MET); the colony's task takes its turn there (a third of the
// time), and a task just done has the row while it blinks.
const TOP_ROWS = [3, 13];
const JOB_TURN = 540;   // frames: the job line two thirds of it, an open task the rest
function topLayout() {
  const out = { task: null, job: null, obj: null, strip: null, rects: [] };
  if (!G.colony) return out;
  const rows = [];
  let t = G.colony.tasks.find(t => !t.done) || G.colony.tasks.find(t => t.done && t.doneT > 0);
  const g = myJobGoal(LOCAL);
  if (g && !(t && t.done) && !(t && G.frame % JOB_TURN >= JOB_TURN * 2 / 3)) {
    const str = JOB_ICON[g.job] + ' ' + (g.done ? L('ui_jobDone', jobName(g.job)) : L('jg_' + g.job, g.n, g.need));
    out.job = { str, y: TOP_ROWS[0], color: g.done ? '#80ff80' : JOB_COLOR[g.job] };
    rows.push(out.job);
    t = null;
  }
  if (t) {
    let str;
    if (t.done) str = L('m_complete', taskText(t));
    else if (t.type === 'dig') str = taskText(t) + ' ' + Math.floor(t.n) + '/' + t.need;
    else str = taskText(t) + ' ' + t.n + '/' + t.need;
    out.task = { str, y: TOP_ROWS[rows.length], color: t.done ? '#ffe040' : '#a8e8a0', blink: t.done && (G.tick >> 3) % 2 };
    rows.push(out.task);
  }
  // the season's next milestone, one line (O shows them all)
  // (versus: not while the deciding flight flies -- there's no next year)
  const over = G.mode === 'versus' && (G.flight || G.lastFlightYear >= 2);
  const o = !over && G.objectives && G.objectives.list.find(o => !o.done);
  if (o) {
    out.obj = { str: '\x06' + objName(o) + ' ' + objProgress(o), y: TOP_ROWS[rows.length], color: '#ffd890' };
    rows.push(out.obj);
  }
  if (!over && G.objectives) {
    const forms = goalStrip();
    const leftW = y => { const r = rows.find(r => r.y === y); return r ? 4 + textWidth(r.str) + 8 : 0; };
    let pick = null;
    for (const f of forms) {
      for (const y of TOP_ROWS) if (!pick && leftW(y) + textWidth(f.map(s => s[0]).join('')) <= VIEW_W - 4) pick = { segs: f, y };
    }
    if (!pick) pick = { segs: forms[forms.length - 1], y: TOP_ROWS[0] };
    const w = textWidth(pick.segs.map(s => s[0]).join(''));
    out.strip = { segs: pick.segs, y: pick.y, x: VIEW_W - 4 - w, w };
  }
  // ...and the milestone's key that opens the full list, where it still fits
  if (out.obj) {
    const right = out.strip && out.strip.y === out.obj.y ? out.strip.x - 8 : VIEW_W - 8;
    if (4 + textWidth(out.obj.str + ' (O)') < right) out.obj.str += ' (O)';
  }
  for (const r of [out.job, out.task, out.obj]) if (r) out.rects.push({ x: 0, y: r.y - 1, w: textWidth(r.str) + 6, h: 10 });
  if (out.strip) out.rects.push({ x: out.strip.x - 2, y: out.strip.y - 1, w: out.strip.w + 6, h: 10 });
  return out;
}

// the goal strip's forms, longest first: each a list of [text, colour]
function goalStrip() {
  const s = G.season, ob = G.objectives;
  const done = ob.list.filter(o => o.done).length, all = ob.list.length;
  const left = Math.max(0, (Math.floor(G.day / SEASON_DAYS) + 1) * SEASON_DAYS * DAY_LEN - G.tick);
  const sec = Math.ceil(left / 60);
  const clock = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  const sc = SEASON_COLOR[s];
  const icon = [SEASON_ICON[s], sc], name = [SEASON_ICON[s] + seasonName(s) + ' ', sc];
  const tally = [done + '/' + all + ' ', done >= all ? '#80ff80' : '#ffe080'];
  const segs = [];
  // (from autumn: the princesses for the flight, grown or growing)
  if (s >= AUTUMN) {
    const col = G.colony;
    const n = G.ants.filter(a => a.caste === 'princess' && a.hp > 0 && a.colony === col).length +
      G.brood.filter(b => b.royal && !b.dead && b.colony === col).length;
    segs.push(['\x11' + n + ' ', n ? '#ff90e0' : '#a07090']);
  }
  const warn = sec <= 30 && (G.frame >> 4) % 2 ? '#ffffff' : '#c8b890';
  const flight = s === WINTER;
  const timeL = [flight ? L('hud_flightIn', clock) : '\x1A' + clock, flight ? '#ff90e0' : warn];
  const timeS = ['\x1A' + clock, flight ? '#ff90e0' : warn];
  // (the golden seed: this year's brought home, in the colour of how ours
  // stands -- out there, carried, taken; not in winter unless one is out)
  const rs = relicState();
  const rseg = rs && (s < RELIC_SEASONS || ['lying', 'carried', 'taken'].includes(rs.ph))
    ? [['\x1C' + rs.got + '/' + RELIC_SEASONS + ' ', relicColor(rs)]] : [];
  return [
    [name, tally].concat(rseg, segs, [timeL]),
    [icon, [' ', sc], tally].concat(rseg, segs, [timeS]),
    [icon, [' ', sc], tally].concat(segs, [timeS]),
  ];
}

// our side's golden seed as the HUD shows it: { ph, x, y, until, got,
// held } (see updateRelics; online the server's r0/r1), or null
function relicState() {
  if (!G.colony || !G.rival) return null;
  // (none fallen yet this year: waiting for the first, nothing home)
  const st = (G.relics && G.relics.side[G.colIdx]) || { ph: 'wait', got: 0 };
  // (the sim keeps the year its count is for; the server sends this year's)
  return { ph: st.ph, x: st.x, y: st.y, until: st.until, held: !!st.held,
    got: st.yr === undefined || st.yr === G.year ? st.got || 0 : 0 };
}
function relicColor(rs) {
  const on = (G.frame >> 4) % 2;
  switch (rs.ph) {
    case 'lying': return on ? '#ffd040' : '#c89820';
    case 'carried': return on ? '#ffffff' : '#ffe080';
    case 'taken': return on ? '#ff6040' : '#c04020';
    case 'home': return '#80ff80';
  }
  return '#a08858';
}
// what the O screen says of it
function relicStatus(rs) {
  if (rs.ph === 'lying') return L(rs.held ? 'rs_down' : G.mode === 'versus' ? 'rs_lyingVs' : 'rs_lying');
  if (rs.ph === 'wait') return L(G.season < RELIC_SEASONS ? 'rs_wait' : 'rs_winter');
  if (rs.ph === 'taken') return L(G.mode === 'versus' ? 'rs_takenVs' : 'rs_taken');
  return L('rs_' + rs.ph);
}

function drawTaskAndMsgs() {
  if (G.showMap || G.objScreen) return;   // (the map and the O panel cover the screen)
  const top = topLayout();
  if (top.job) drawTextS(ctx, top.job.str, 4, top.job.y, top.job.color);
  if (top.task && !top.task.blink) drawTextS(ctx, top.task.str, 4, top.task.y, top.task.color);
  if (top.obj) drawTextS(ctx, top.obj.str, 4, top.obj.y, top.obj.color);
  if (top.strip) {
    let x = top.strip.x;
    for (const [str, color] of top.strip.segs) { drawTextS(ctx, str, x, top.strip.y, color); x += str.length * FONT_ADV; }
  }

  // overlays hide the toasts (they wait, and show after) and the alerts
  if (overlayOpen()) return;
  const raid = raidAlert();
  let my = 24;
  for (const m of G.msgs) {
    ctx.globalAlpha = Math.min(1, m.t / 60);
    drawTextCS(ctx, m.text, VIEW_W / 2, my, m.color);
    ctx.globalAlpha = 1;
    my += 10;
  }
  // (plan mode: its bar of keys where the hint goes)
  const hint = G.planMode && localAnt() ? (drawPlanBar(), true) : drawHint();
  if (raid && raid.banner) drawRaidBanner(raid, hint ? 132 : 160);
}

// the tutorial's hint, in a panel just above the HUD (LEARN TO ANT: the
// chapter's panel; online, a first match's tip instead -- see learn.js).
// Returns true if drawn.
function drawHint() {
  if (Learn.on) return drawLearn();
  if (Coach.showing()) return drawCoach();
  const st = Tut.active();
  if (!st || !localAnt()) return false;
  const lines = L('h_' + st).split('\n');
  const y0 = 144;
  bevelPanel(10, y0, 300, 30);
  if (Tut.gapT > 0) {
    // done: a tick mark while the next one waits
    drawTextCS(ctx, '\x19', VIEW_W / 2, y0 + 11, '#80ff80');
    return true;
  }
  if (st !== 'done') {
    drawText(ctx, L('ui_hintHead', Tut.step + 1, TUT_STEPS.length), 14, y0 + 3, '#a09070');
    const k = L('ui_hintKeys');
    drawText(ctx, k, 306 - textWidth(k), y0 + 3, '#806e58');
  }
  drawTextC(ctx, lines[0], VIEW_W / 2, y0 + 12, '#ffe8a0');
  if (lines[1]) drawTextC(ctx, lines[1], VIEW_W / 2, y0 + 21, '#ffe8a0');
  return true;
}

// a raid on the players' nest: where its raiders are on average, how close
// the nearest has come, what it has stolen -- or null. Marching, or on the
// way home with our food (flee: then only the laden thieves count). banner:
// worth the big banner -- the raid is close (the sim has warned of it), or
// the thieves are still near enough to chase; before that just the marker.
function raidAlert() {
  const r = G.rival;
  const raid = r && r.raid;
  if (!raid || G.colonies[raid.target] !== G.colony) return null;
  const flee = raid.phase !== 'march';
  if (flee && !(raid.stolen > 0)) return null;
  let n = 0, sx = 0, sy = 0, near = Infinity;
  for (const a of G.ants) {
    if (!a.raiding || a.colony !== r || a.hp <= 0) continue;
    if (flee && !(a.carry && a.carry.kind === 'morsel')) continue;
    n++; sx += a.x; sy += a.y;
    near = Math.min(near, Math.abs(a.x - G.colony.x));
  }
  if (!n) return null;
  const banner = flee ? near < RAID_FLEE_R : !!raid.warned || near < 600;
  return { x: sx / n, y: sy / n, n, near, stolen: raid.stolen || 0, flee, banner };
}
const RAID_FLEE_R = 700;   // fleeing thieves within this of the nest keep the banner up

// the raid alert: a blinking banner saying where the raid is, with arrows
// toward it
function drawRaidBanner(raid, y) {
  const key = raid.flee ? 'ui_raidFlee' : raid.stolen > 0 ? 'ui_raidSteal' : raid.near < 220 ? 'ui_raidNest' : 'ui_raidMarch';
  const str = L(key);
  const me = localAnt();
  const vx = me ? me.x : G.cam.x + VIEW_W / 2;
  const dir = raid.x < vx - 40 ? -1 : raid.x > vx + 40 ? 1 : 0;
  const w = textWidth(str) + 36;
  const x = Math.round((VIEW_W - w) / 2);
  const on = (G.frame >> 4) % 2;
  ctx.fillStyle = on ? '#7a1408' : '#4a0c04';
  ctx.fillRect(x, y, w, 11);
  ctx.fillStyle = '#ff5040';
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + 10, w, 1);
  drawTextC(ctx, str, VIEW_W / 2, y + 2, on ? '#ffe0c0' : '#ff9070');
  if (dir) drawText(ctx, dir < 0 ? '<<' : '>>', dir < 0 ? x + 3 : x + w - 14, y + 2, '#ffe040');
}

// ---------------------------------------------------------------------------
// the guide arrow (G): where the season's next milestone wants you. While a
// hint asks for food it shows the food (and then the stores); a load of food
// always goes to the stores; with the season's work done, the red nest.
// Returns { x, y, color, icon } or null. A target down in a nest the
// player isn't in yet is shown at that nest's entrance first (the arrow
// points in a straight line, and through the mound is no way in).
// ---------------------------------------------------------------------------
function guideTarget() {
  const me = localAnt();
  // (the first two hints are about the keys: no arrow yet to distract)
  const st = Tut.active();
  if (st === 'move' || st === 'dig') return null;
  // (LEARN TO ANT: the chapter's own target, see learn.js)
  const t = me ? (Learn.on ? Learn.target(me) : guidePoint(me)) : null;
  if (!t) return null;
  const nest = buriedInNest(t);
  if (nest && buriedInNest(me) !== nest) return { x: nest.entrance.x, y: nest.entrance.y, color: t.color, icon: t.icon };
  return t;
}

// the guide arrow's real target, wherever it lies
function guidePoint(me) {
  const col = G.colony;
  const carryFood = me.carry && ITEM_DEF[me.carry.kind];
  if (Tut.active() === 'food') return carryFood ? storageTarget(me) : foodTarget(me);
  if (carryFood) return storageTarget(me);
  // a job: where it wants us (see jobTarget); with nothing there, the
  // season's work as before
  const pl = G.players[LOCAL];
  if (pl && pl.job) { const jt = jobTarget(me, pl.job); if (jt) return jt; }
  if (col.active('gather')) return foodTarget(me);
  const o = G.objectives && G.objectives.list.find(o => !o.done);
  const at = (p, color, icon) => ({ x: p.x, y: p.y, color, icon });
  if (o) {
    switch (o.id) {
      case 'food100': case 'stockpile': return foodTarget(me);
      // (a new chamber is dug somewhere down in the nest: there, first)
      case 'storage2': return nestDeep(me) ? null : at(col.junction, '#d8b878', '\x03');
      case 'raise': case 'pop25': return at(col.nursery, '#efe9d8', '\x0E');
      case 'mound': case 'sealed': return at(col.entrance, '#d8b860', '\x10');
      case 'royal': case 'princess': return at(royalTarget(col), '#ff90e0', '\x11');
      case 'queen': { const q = col.queen(); return q ? at(q, '#ff90e0', '\x11') : null; }
      case 'contested': {
        const cs = G.contested;
        return cs && cs.active ? at(cs, '#ffb040', '\x03') : null;
      }
      case 'centipedes': {
        let best = null, bd = 700 * 700;
        for (const b of G.bugs) {
          if (b.kind !== 'centipede' || b.dead) continue;
          const d = dist2(b.x, b.y, me.x, me.y);
          if (d < bd) { bd = d; best = b; }
        }
        return best ? at(best, '#ff6050', '!') : null;
      }
    }
  }
  // the season's work done (or nothing to point at), or a player already
  // close to the red nest: the red queen once found, else her nest
  const r = G.rival;
  if (r && !r.defeated && (!o || Math.abs(me.x - r.x) < 700)) {
    const q = r.queenSeen ? r.queen() : null;
    return at(q || r.entrance, '#ff6050', '\x11');
  }
  return null;
}

// the guide arrow for a job (see JOBS in game.js), or null (nothing to show):
// FORAGER the nearest food (loose food, the fallen fruit, else an aphid);
// BUILDER the blueprint, else in winter the entrance to gate, a cramped
// chamber to dig out, in summer the mound; GUARD a raid on the nest, an
// enemy running off with a golden seed, an intruder at home, the queen
// under attack, else the nest (from afar its entrance, near it the queen);
// SEEKER our golden seed lying out there, our raid's target, else the
// crystal field in the middle (none once there: dig)
function jobTarget(me, job) {
  const col = G.colony;
  const at = (p, color, icon) => p ? { x: p.x, y: p.y, color, icon } : null;
  const ic = JOB_ICON[job], cl = JOB_COLOR[job];
  if (job === 'forager') return forageTarget(me);
  if (job === 'builder') {
    const pp = planTarget(me);
    if (pp) return pp;
    if (G.isWinter() && !col.sealed) return at(col.entrance, '#8ce8ff', ic);
    const ch = crampedChamber(col, me);
    if (ch) return at(ch, cl, ic);
    if (G.season === SUMMER || col.mound.size < MOUND_WARM) return at(col.entrance, '#d8b860', '\x10');
    return null;
  }
  if (job === 'guard') {
    const raid = raidAlert();
    if (raid) return { x: raid.x, y: raid.y - 6, color: '#ff4030', icon: '!' };
    for (const it of G.items) {
      const c = it.kind === 'relic' && !it.dead ? it.carried : null;
      if (c && c.colony !== col && Math.abs(c.x - col.x) < RELIC_ALARM) return at(c, '#ff7040', '\x1C');
    }
    // (an intruder at home: an enemy ant, or a predator, near the nest)
    let foe = null, bd = Infinity;
    const near = e => Math.abs(e.x - col.x) < 450 && Math.abs(e.y - col.entrance.y) < 350;
    for (const a of G.ants) {
      if (a.hp <= 0 || a.colony === col || !near(a)) continue;
      const d = dist2(a.x, a.y, me.x, me.y);
      if (d < bd) { bd = d; foe = a; }
    }
    for (const b of G.bugs) {
      if (b.dead || !b.predator || !near(b)) continue;
      const d = dist2(b.x, b.y, me.x, me.y);
      if (d < bd) { bd = d; foe = b; }
    }
    if (foe) return at(foe, '#ff6050', '!');
    const q = col.queen();
    if (q && (q.hitT > G.tick || G.tick - q.hitT < 120)) return at(q, '#ff4030', '\x11');
    return Math.abs(me.x - col.x) > 300 || !nestDeep(me) ? at(col.entrance, cl, ic) : at(q || col.queenCh, cl, '\x11');
  }
  if (job === 'seeker') {
    const rs = relicState();
    if (rs && rs.ph === 'lying') return { x: rs.x, y: rs.y, color: '#ffd040', icon: '\x1C' };
    const r = G.rival;
    if (r && col.raid && col.raid.phase === 'march' && G.colonies[col.raid.target]) return at(G.colonies[col.raid.target].entrance, '#ff8040', '!');
    if (!r) return null;
    const mx = Math.round((col.x + r.x) / 2);
    const fy = T.surf[Math.max(0, Math.min(WORLD_W - 1, mx))] + 290;
    return Math.abs(me.x - mx) < 150 && me.y > fy - 120 ? null : { x: mx, y: fy, color: cl, icon: '\x13' };
  }
  return null;
}

// a forager's next find: the nearest loose food on our side of the forest,
// or the fallen fruit, whichever is nearer; else an aphid to milk
function forageTarget(me) {
  const t = foodTarget(me), cs = G.contested;
  let best = t, bd = t ? dist2(t.x, t.y, me.x, me.y) : Infinity;
  if (cs && cs.active && dist2(cs.x, cs.y, me.x, me.y) < bd) { best = { x: cs.x, y: cs.y, color: '#ffb040', icon: '\x03' }; bd = 0; }
  if (best) return best;
  for (const b of G.bugs) {
    if (b.kind !== 'aphid' || b.dead || Math.abs(b.x - G.colony.x) > FORAGE_R) continue;
    const d = dist2(b.x, b.y, me.x, me.y);
    if (d < bd) { bd = d; best = { x: b.x, y: b.y, color: '#a8e8a0', icon: JOB_ICON.forager }; }
  }
  return best;
}

// the nearest planned pixel of our blueprint (looked up a few times a
// second: the plan holds thousands)
const PlanSeek = { f: -99, x: 0, y: 0, t: null };
function planTarget(me) {
  const plan = G.colony.plan;
  if (!plan.size) return null;
  const S = PlanSeek;
  if (G.frame - S.f < 15 && Math.abs(me.x - S.x) < 30 && Math.abs(me.y - S.y) < 30 && (!S.t || plan.has(S.t.i))) return S.t;
  let bi = -1, bd = Infinity;
  for (const i of plan.keys()) {
    const x = i % WORLD_W, y = (i / WORLD_W) | 0;
    const d = dist2(x, y, me.x, me.y);
    if (d < bd) { bd = d; bi = i; }
  }
  S.f = G.frame; S.x = me.x; S.y = me.y;
  S.t = bi < 0 ? null : { i: bi, x: bi % WORLD_W, y: (bi / WORLD_W) | 0, color: planColor(plan.get(bi)), icon: JOB_ICON.builder };
  return S.t;
}

// a marked chamber still too cramped to count, nearest us
function crampedChamber(col, me) {
  let best = null, bd = Infinity;
  for (const ch of col.chambers) {
    if (ch.area >= CH_MIN_AREA) continue;
    const d = dist2(ch.x, ch.y, me.x, me.y);
    if (d < bd) { bd = d; best = ch; }
  }
  return best;
}

// the nearest storage (the main cache or a storage chamber)
function storageTarget(me) {
  const col = G.colony;
  let best = col.storage, bd = dist2(me.x, me.y, col.storage.x, col.storage.y);
  for (const ch of col.chambers) {
    if (ch.type !== 'storage' || ch.area < CH_MIN_AREA) continue;
    const d = dist2(me.x, me.y, ch.x, ch.y);
    if (d < bd) { bd = d; best = ch; }
  }
  return { x: best.x, y: best.y, color: '#d8b878', icon: '\x03' };
}

// the nearest loose food on the colony's side of the forest
function foodTarget(me) {
  let best = null, bd = Infinity;
  for (const it of G.items) {
    if (it.dead || it.carried || !ITEM_DEF[it.kind] || !ITEM_DEF[it.kind].food) continue;
    if (Math.abs(it.x - G.colony.x) > FORAGE_R) continue;
    const d = dist2(me.x, me.y, it.x, it.y);
    if (d < bd) { bd = d; best = it; }
  }
  return best ? { x: best.x, y: best.y, color: '#a8e8a0', icon: '\x03' } : null;
}

// the roomiest royal chamber (the queen's own if none is marked)
function royalTarget(col) {
  let best = null;
  for (const ch of col.chambers) if (ch.type === 'royal' && (!best || ch.area > best.area)) best = ch;
  return best || col.queenCh;
}

// a small pixel arrow centred on (cx, cy) pointing along angle a, dark-rimmed
function drawArrow(cx, cy, a, color) {
  const ca = Math.cos(a), sa = Math.sin(a);
  for (const pass of [0, 1]) {
    ctx.fillStyle = pass ? color : '#100804';
    const g = pass ? 0 : 1;
    for (let py = -7; py <= 7; py++) {
      for (let px = -7; px <= 7; px++) {
        const u = px * ca + py * sa, v = -px * sa + py * ca;
        const head = u <= 4 + g && u >= -1 - g && Math.abs(v) <= (4 - u) * 0.75 + g;
        const tail = u < -1 && u >= -5 - g && Math.abs(v) <= 1 + g;
        if (head || tail) ctx.fillRect(Math.round(cx + px), Math.round(cy + py), 1, 1);
      }
    }
  }
}

// the guide arrow, and the raid's red marker: at the viewport's edge toward
// a target out of sight, or bobbing over one in sight
function drawGuides(camx, camy, vw, vh, me) {
  if (overlayOpen() || !me) return;
  drawYouRing(camx, camy, me);
  const raid = raidAlert();
  if (raid) drawEdgeMarker(raid.x, raid.y - 6, camx, camy, vw, vh, me, '#ff4030', '!');
  // golden seeds: an enemy carrying one near our nest (run it down), and
  // ours lying loose within a march of us (go and get it)
  for (const it of G.items) {
    if (it.kind !== 'relic' || it.dead || me.carry === it) continue;
    const c = it.carried;
    if (c && c.colony !== G.colony && Math.abs(c.x - G.colony.x) < RELIC_ALARM + 300) {
      drawEdgeMarker(c.x, c.y - 6, camx, camy, vw, vh, me, '#ff7040', '\x1C');
    } else if (!c && it.rcol === G.colIdx && Math.abs(it.x - me.x) < 900) {
      drawEdgeMarker(it.x, it.y - 4, camx, camy, vw, vh, me, '#ffd040', '\x1C');
    }
  }
  if (!G.arrowOn) return;
  const t = guideTarget();
  if (t) drawEdgeMarker(t.x, t.y, camx, camy, vw, vh, me, t.color, t.icon);
}

// a new body (a switch, a world entered): a ring closing in on it for a
// couple of seconds, so you see at once which ant you are now
const YOU_T = 120;
const You = { ant: null, t: 0 };
function drawYouRing(camx, camy, me) {
  if (me !== You.ant) { You.ant = me; You.t = YOU_T; }
  if (You.t <= 0) return;
  You.t--;
  const r = 6 + You.t / 10, cx = me.x - camx, cy = me.y - camy;
  ctx.fillStyle = (G.frame >> 2) % 2 ? '#ffe080' : '#fff8d0';
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2 + You.t * 0.03;
    ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.8), 1, 1);
  }
}

// where a guide arrow for world point (wx, wy) goes on screen: { x, y, a,
// sight } -- bobbing over the point when it is in sight (sight true, a
// pointing down), else on the viewport's edge pointing its way
function edgeSpot(wx, wy, camx, camy, vw, vh) {
  const ex = wx - camx, ey = wy - camy;
  const top = 24, bot = Tut.active() ? 40 : 10, side = 8;
  if (ex >= side && ex <= vw - side && ey >= top && ey <= vh - bot) {
    return { x: Math.round(ex), y: Math.round(ey) - 12 - ((G.frame >> 3) % 2), a: Math.PI / 2, sight: true };
  }
  const cx = vw / 2, cy = (top + vh - bot) / 2;
  const dx = ex - cx, dy = ey - cy;
  const k = Math.min(dx ? (vw / 2 - side) / Math.abs(dx) : Infinity,
    dy ? (dy < 0 ? cy - top : vh - bot - cy) / Math.abs(dy) : Infinity);
  return { x: cx + dx * k, y: cy + dy * k, a: Math.atan2(dy, dx), sight: false };
}

function drawEdgeMarker(wx, wy, camx, camy, vw, vh, me, color, icon) {
  const sp = edgeSpot(wx, wy, camx, camy, vw, vh);
  // (in sight and right beside us: no arrow needed)
  if (sp.sight && dist2(wx, wy, me.x, me.y) < 26 * 26) return;
  drawArrow(sp.x, sp.y, sp.a, (G.frame >> 4) % 2 ? color : '#fff8d0');
  // off screen, the target's sign just inside the arrow
  if (icon && !sp.sight) {
    const ca = Math.cos(sp.a), sa = Math.sin(sp.a);
    drawTextS(ctx, icon, Math.round(sp.x - ca * 12) - 2, Math.round(sp.y - sa * 12) - 3, color);
  }
}

// the ant gates around our nest, for the map: one spot per 8 px cell with
// gate in it (a scan of the nest's surroundings, redone now and then while
// the map is open -- gates are built rarely)
function scanGates() {
  const c = G.colony, cell = 8;
  const x0 = Math.max(0, c.x - 900), x1 = Math.min(WORLD_W - 1, c.x + 900);
  const y0 = Math.max(0, c.entrance.y - 120), y1 = Math.min(WORLD_H - 1, c.entrance.y + 700);
  const seen = new Set(), out = [];
  for (let y = y0; y <= y1; y++) {
    const row = y * WORLD_W;
    for (let x = x0; x <= x1; x++) {
      if (T.m[row + x] !== M_GATE) continue;
      const k = ((x / cell) | 0) * 4096 + ((y / cell) | 0);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ x: ((x / cell) | 0) * cell + 4, y: ((y / cell) | 0) * cell + 4 });
    }
  }
  return out;
}

// map icons, drawn at a map pixel with a black backing
function mapDot(x, y, color, r) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - r - 1, y - r - 1, 2 * r + 3, 2 * r + 3);
  ctx.fillStyle = color;
  ctx.fillRect(x - r, y - r, 2 * r + 1, 2 * r + 1);
}
function mapGate(x, y) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - 2, y - 2, 5, 5);
  ctx.fillStyle = '#d8a860';
  ctx.fillRect(x - 1, y - 1, 3, 3);
  ctx.fillStyle = '#6a4424';
  ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y + 1, 1, 1);
}
function mapDome(x, y, color) {   // a shelter or the mound: a little dome
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - 4, y - 3, 9, 5);
  ctx.fillRect(x - 3, y - 4, 7, 1);
  ctx.fillStyle = color;
  ctx.fillRect(x - 3, y - 2, 7, 3);
  ctx.fillRect(x - 2, y - 3, 5, 1);
}
function mapFlag(x, y, color) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - 1, y - 9, 7, 6);
  ctx.fillRect(x - 1, y - 9, 3, 10);
  ctx.fillStyle = '#c8b890';
  ctx.fillRect(x, y - 8, 1, 8);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y - 8, 4, 4);
}
function mapRelic(x, y) {         // a golden seed: a blinking gold drop
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - 3, y - 3, 7, 7);
  ctx.fillStyle = (G.frame >> 3) % 2 ? '#ffd040' : '#fff4b0';
  ctx.fillRect(x - 2, y - 1, 5, 3);
  ctx.fillRect(x - 1, y - 2, 3, 5);
}
// a golden seed's carrier on the map: a gold ring (ours or the enemy's --
// the server shows a carrier to both sides)
function mapCarrier(x, y) {
  ctx.fillStyle = (G.frame >> 3) % 2 ? '#ffd040' : '#ffffff';
  ctx.fillRect(x - 3, y - 4, 7, 1); ctx.fillRect(x - 3, y + 4, 7, 1);
  ctx.fillRect(x - 4, y - 3, 1, 7); ctx.fillRect(x + 4, y - 3, 1, 7);
}
function mapFruit(x, y) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - 3, y - 3, 7, 7);
  ctx.fillStyle = (G.frame >> 4) % 2 ? '#ffb040' : '#c8304a';
  ctx.fillRect(x - 2, y - 2, 5, 5);
  ctx.fillStyle = '#54a838';
  ctx.fillRect(x, y - 3, 2, 1);
}

// our blueprint on a map, faintly: a dot for each map pixel it touches
function mapPlan(mx, my, sx, sy, wx0, wy0) {
  const plan = G.colony.plan;
  if (!plan || !plan.size) return;
  const seen = new Set();
  ctx.fillStyle = 'rgba(140,232,255,0.55)';
  for (const i of plan.keys()) {
    const x = Math.round(mx + (i % WORLD_W - wx0) * sx), y = Math.round(my + (((i / WORLD_W) | 0) - wy0) * sy);
    const k = x * 4096 + y;
    if (seen.has(k)) continue;
    seen.add(k);
    ctx.fillRect(x, y, 1, 1);
  }
}

// M: the whole world in a panel, the nest close up below it, and a legend
function drawMinimap() {
  const col = G.colony;
  if (--G.gatesT <= 0) { G.gates = scanGates(); G.gatesT = 120; }
  const mw = 296, mh = Math.round(mw * WORLD_H / WORLD_W);
  const mx = (VIEW_W - mw) / 2, my = 10;
  bevelPanel(mx - 3, my - 3, mw + 6, mh + 6 + 70);
  ctx.fillStyle = '#101418';
  ctx.fillRect(mx, my, mw, mh);
  TerrainView.finish();   // the whole map shows: no unpainted tiles (only in a world's first seconds)
  ctx.drawImage(TerrainView.bgCan, 0, 0, WORLD_W, WORLD_H, mx, my, mw, mh);
  ctx.drawImage(TerrainView.terCan, 0, 0, WORLD_W, WORLD_H, mx, my, mw, mh);
  const sx = mw / WORLD_W, sy = mh / WORLD_H;
  const P = (x, y) => [Math.round(mx + x * sx), Math.round(my + y * sy)];
  // our nest: a flag over the entrance (on the mound, once thatched)
  const [ex, ey] = P(col.entrance.x, col.entrance.y);
  if (col.mound.size >= MOUND_WARM) mapDome(ex, ey, '#d8b860');
  mapFlag(ex, ey - 2, '#ffe080');
  // chambers in their type colours (cramped ones blink)
  for (const ch of col.chambers) {
    const [cx, cy] = P(ch.x, ch.y);
    mapDot(cx, cy, chamberCramped(ch) && (G.frame >> 4) % 2 ? '#ff4030' : CH_LOOK[ch.type].color, 1);
  }
  for (const g of G.gates) { const [gx, gy] = P(g.x, g.y); mapGate(gx, gy); }
  mapPlan(mx, my, sx, sy, 0, 0);
  for (const sh of col.shelters) { const [hx, hy] = P(sh.x, sh.y); mapDome(hx, hy, '#8cc85a'); }
  // the rival nests: a flag in its colours over each entrance (grey once
  // its queen fell)
  for (const c of G.colonies) {
    if (c === col) continue;
    const [fx, fy] = P(c.entrance.x, c.entrance.y);
    mapFlag(fx, fy - 2, c.defeated ? '#706050' : enemyFlag(c));
  }
  // this summer's fallen fruit between the nests
  const cs = G.contested;
  if (cs && cs.active) { const [fx, fy] = P(cs.x, cs.y); mapFruit(fx, fy - 2); }
  // golden seeds lying loose: ours always, the enemy's (versus) where we
  // see it (the server sends it no farther)
  for (const it of G.items) {
    if (it.kind !== 'relic' || it.dead || it.carried) continue;
    if (it.rcol === G.colIdx || G.mode === 'versus') { const [rx, ry] = P(it.x, it.y); mapRelic(rx, ry - 1); }
  }
  drawMapAnts(mx, my, sx, sy, 0, 0, WORLD_W, WORLD_H);
  for (const a of G.ants) {
    if (a.hp > 0 && a.carry && a.carry.kind === 'relic') { const [cx, cy] = P(a.x, a.y); mapCarrier(cx, cy); }
  }
  ctx.fillStyle = '#ff3020';
  for (const b of G.bugs) {
    if (b.predator) ctx.fillRect(mx + b.x * sx - 1, my + b.y * sy - 1, 2, 2);
  }
  // where the guide arrow points: a blinking ring
  const t = G.arrowOn ? guideTarget() : null;
  if (t && (G.frame >> 3) % 2) {
    const [tx, ty] = P(t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillRect(tx - 3, ty - 3, 7, 1); ctx.fillRect(tx - 3, ty + 3, 7, 1);
    ctx.fillRect(tx - 3, ty - 3, 1, 7); ctx.fillRect(tx + 3, ty - 3, 1, 7);
  }
  drawNestInset(mx, my + mh + 6, 150, 62);
  drawMapLegend(mx + 156, my + mh + 6);
}

// an enemy colony's colours on the map: its flag, its ants
function enemyFlag(c) { return c.faction === 'red' ? '#e03828' : '#c8c0d8'; }
function enemyDot(c) { return c.faction === 'red' ? '#ff6050' : '#b8b0c8'; }

// the ants as dots: players blink, the queen pink, rivals in their colours
// (a rival queen gets her own marker once found); clipped to the world box
// (wx0, wy0)-(wx1, wy1)
function drawMapAnts(mx, my, sx, sy, wx0, wy0, wx1, wy1) {
  for (const a of G.ants) {
    if (a.hp <= 0 || a.x < wx0 || a.x > wx1 || a.y < wy0 || a.y > wy1) continue;
    const red = a.colony !== G.colony;
    if (red && a.caste === 'queen' && a.colony.queenSeen) continue;
    const x = mx + (a.x - wx0) * sx, y = my + (a.y - wy0) * sy;
    if (red) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(x - 1, y, 2, 2);
    }
    ctx.fillStyle = a.playerIdx >= 0 ? playerColor(a.playerIdx)
      : red ? enemyDot(a.colony) : a.caste === 'queen' ? '#ff40c0' : '#e0a060';
    const sz = a.playerIdx >= 0 && (G.tick >> 3) % 2 ? 3 : 2;
    ctx.fillRect(x - 1, y - 1, sz, sz);
  }
  for (const c of G.colonies) {
    const q = c !== G.colony && c.queenSeen ? c.queen() : null;
    if (!q || q.x < wx0 || q.x > wx1 || q.y < wy0 || q.y > wy1) continue;
    mapDot(Math.round(mx + (q.x - wx0) * sx), Math.round(my + (q.y - wy0) * sy),
      (G.frame >> 3) % 2 ? '#ff4060' : '#ffe040', 1);
  }
}

// our nest close up: its tunnels, chamber signs, gates and ants
function drawNestInset(x, y, w, h) {
  const col = G.colony, Z = 0.2;
  const ww = w / Z, wh = h / Z;
  const wx0 = Math.round(Math.max(0, Math.min(WORLD_W - ww, col.entrance.x - ww / 2)));
  const wy0 = Math.round(Math.max(0, Math.min(WORLD_H - wh, col.entrance.y - 45)));
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  const sc = seasonSky(skyColor(G.tod()));
  ctx.fillStyle = `rgb(${sc[0]},${sc[1]},${sc[2]})`;
  ctx.fillRect(x, y, w, h);
  ctx.drawImage(TerrainView.bgCan, wx0, wy0, ww, wh, x, y, w, h);
  ctx.drawImage(TerrainView.terCan, wx0, wy0, ww, wh, x, y, w, h);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const P = (px, py) => [Math.round(x + (px - wx0) * Z), Math.round(y + (py - wy0) * Z)];
  for (const g of G.gates) { const [gx, gy] = P(g.x, g.y); mapGate(gx, gy); }
  mapPlan(x, y, Z, Z, wx0, wy0);
  drawMapAnts(x, y, Z, Z, wx0, wy0, wx0 + ww, wy0 + wh);
  for (const ch of col.chambers) {
    const [cx, cy] = P(ch.x, ch.y);
    const blink = chamberCramped(ch) && (G.frame >> 4) % 2;
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx - 4, cy - 5, 9, 9);
    drawText(ctx, CH_LOOK[ch.type].icon, cx - 2, cy - 4, blink ? '#ff4030' : CH_LOOK[ch.type].color);
  }
  ctx.restore();
  drawTextS(ctx, L('ui_ourNest'), x + 3, y + 2, '#ffe080');
}

// what the map's signs mean, in two columns
function drawMapLegend(x, y) {
  const items = [
    [() => drawText(ctx, CH_LOOK.storage.icon, x, y, CH_LOOK.storage.color), 'lg_storage'],
    [() => drawText(ctx, CH_LOOK.nursery.icon, x, y + 10, CH_LOOK.nursery.color), 'lg_nursery'],
    [() => drawText(ctx, CH_LOOK.barracks.icon, x, y + 20, CH_LOOK.barracks.color), 'lg_barracks'],
    [() => drawText(ctx, CH_LOOK.royal.icon, x, y + 30, CH_LOOK.royal.color), 'lg_royal'],
    [() => drawText(ctx, CH_LOOK.fungus.icon, x, y + 40, CH_LOOK.fungus.color), 'lg_fungus'],
    [() => mapDome(x + 72 + 2, y + 4, '#8cc85a'), 'lg_shelter'],
    [() => mapGate(x + 72 + 2, y + 13), 'lg_gate'],
    [() => mapDome(x + 72 + 2, y + 24, '#d8b860'), 'lg_mound'],
    [() => mapFruit(x + 72 + 2, y + 33), 'lg_fruit'],
    [() => mapFlag(x + 72 + 1, y + 48, G.rival ? enemyFlag(G.rival) : '#e03828'), G.mode === 'versus' ? 'lg_enemy' : 'lg_red'],
    [() => mapRelic(x + 72 + 2, y + 53), 'lg_relic'],
  ];
  for (let i = 0; i < items.length; i++) {
    items[i][0]();
    // (five a column; the golden seed a sixth row under the second)
    const lx = i < 5 ? x + 8 : x + 81, ly = y + (i < 5 ? i : i - 5) * 10;
    drawText(ctx, L(items[i][1]), lx, ly, '#c8b890');
  }
}

// the game viewport on the screen (above the HUD)
function playerView() {
  return { vx: 0, vy: 0, vw: VIEW_W, vh: VIEW_H - HUD_H };
}

function drawPlay() {
  if (TerrainView.season !== G.season) TerrainView.setSeason(G.season, G.cam.x);
  TerrainView.flush();
  drawViewport(0, 0, VIEW_W, VIEW_H - HUD_H);
  drawHud();
  drawTaskAndMsgs();
  if (G.showMap) drawMinimap();
  if (G.objScreen) drawObjScreen();
  if (G.takeover) drawTakeover();
  else if (held('scores') && !G.objScreen && !G.showMap) drawScoreboard();
  if (G.online && Net.status === 'lost') drawNetLost();
}

// the scoreboard, while Tab is held: each player's kills, deaths, food
// stored, earth dug and built (see newPlayerStats), and its personal
// milestones reached (versus: only our own side's -- the other side's show
// on the end screen), the most kills first -- versus a block a side
const SCORE_COLS = [118, 160, 194, 234, 274, 302];   // (right edges)
function drawScoreboard() {
  const vs = G.mode === 'versus';
  const rows = [];
  G.players.forEach((p, i) => {
    if (!p || !p.stats || (G.online ? !p.name : i !== LOCAL)) return;
    rows.push({ i, p, name: p.name || L('ui_you'), col: vs ? p.col || 0 : 0 });
  });
  const groups = vs ? [0, 1].map(c => rows.filter(r => r.col === c)) : [rows];
  for (const g of groups) g.sort((a, b) => b.p.stats.kills - a.p.stats.kills || a.p.stats.deaths - b.p.stats.deaths || a.i - b.i);
  const h = 30 + rows.length * 8 + (vs ? 22 : 0);
  bevelPanel(6, 4, 308, h);
  drawTextC(ctx, L('ui_scores'), VIEW_W / 2, 9, '#ffa040');
  const heads = L('ui_scoreCols').split(',').concat(['\x1B']);
  heads.forEach((t, k) => drawText(ctx, t, SCORE_COLS[k] - textWidth(t), 20, '#a09070'));
  let y = 30;
  groups.forEach((g, c) => {
    if (vs) {
      drawText(ctx, L(c ? 'ui_red' : 'ui_black'), 14, y, c ? '#ff7060' : '#d8d4e4');
      y += 11;
    }
    for (const r of g) {
      const st = r.p.stats, off = G.online && !r.p.online;
      if (r.i === LOCAL) drawText(ctx, '\x06', 8, y, '#ffe040');
      // (its job's icon: our own side's only -- the enemy's jobs are never sent)
      if (r.p.job) drawText(ctx, JOB_ICON[r.p.job], 16, y, off ? '#706050' : JOB_COLOR[r.p.job]);
      drawText(ctx, r.name, 23, y, off ? '#706050' : playerColor(r.i));
      const pm = !G.online || r.p.pmKnown ? pmCount(st) : '-';
      [st.kills, st.deaths, Math.round(st.food), st.dug, st.built, pm].forEach((v, k) => {
        const s = String(v);
        drawText(ctx, s, SCORE_COLS[k] - textWidth(s), y, off ? '#706050' : r.i === LOCAL ? '#ffe040' : '#c8b890');
      });
      y += 8;
    }
  });
}

// online: the connection dropped and we're trying to get back in
function drawNetLost() {
  const str = L('ui_netLost') + '.'.repeat((G.frame >> 4) % 4);
  const w = textWidth(L('ui_netLost')) + 34;
  const x = Math.round((VIEW_W - w) / 2);
  ctx.fillStyle = '#4a0c04';
  ctx.fillRect(x, 80, w, 15);
  ctx.fillStyle = '#ff5040';
  ctx.fillRect(x, 80, w, 1);
  ctx.fillRect(x, 94, w, 1);
  drawText(ctx, str, x + 14, 84, (G.frame >> 4) % 2 ? '#ffe0c0' : '#ff9070');
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
  titleAnts.push({ x: -i * 40 - Math.random() * 30, y: 176, phase: Math.random() * 10 });
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
  drawTextCS(ctx, L('ui_tagline'), VIEW_W / 2, ly + 50, '#b09060');

  // menu (LEARN TO ANT stands out until it has been played through)
  const its = titleItems(), items = its.map(it => it.label);
  const my = 100;
  for (let i = 0; i < items.length; i++) {
    const sel = i === G.menuSel;
    if (sel) drawTextC(ctx, '\x06', VIEW_W / 2 - textWidth(items[i]) / 2 - 12, my + i * 10, '#ffe040');
    drawTextCS(ctx, items[i], VIEW_W / 2, my + i * 10, sel ? '#ffe040' : its[i].hot ? '#a8e8a0' : '#c8b890');
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

  drawTextC(ctx, '(C) 2026 LEKTOR ENSRUD', VIEW_W / 2, VIEW_H - 12, '#605040');
}

function titleItems() {
  return [
    { id: 'solo', label: L('ui_start') },
    { id: 'online', label: L('ui_online') },
    { id: 'learn', label: L('ui_learn') + (learnDone() ? ' \x19' : ''), hot: !learnDone() },
    { id: 'help', label: L('ui_help') },
    { id: 'sound', label: L('ui_sound', L(Sfx.muted ? 'w_off' : 'w_on')) },
    { id: 'crt', label: L('ui_crt', L(document.getElementById('crt').classList.contains('off') ? 'w_off' : 'w_on')) },
    { id: 'lang', label: L('ui_lang') },
    { id: 'hints', label: L('ui_hints', L(Tut.on ? 'w_on' : 'w_off')) },
  ];
}

function updateTitle() {
  const items = titleItems();
  if (menuNav(items.length)) {
    Sfx.play('select');
    switch (items[G.menuSel].id) {
      case 'solo': G.state = 'slots'; G.slotSel = 0; G.eraseArm = -1; break;
      case 'online': G.state = 'netname'; Net.err = null; break;
      case 'learn': openLearnMenu(); break;
      case 'help': openHelp('solo'); G.prevState = 'title'; G.state = 'help'; break;
      case 'sound': Sfx.toggleMute(); break;
      case 'crt': document.getElementById('crt').classList.toggle('off'); break;
      case 'lang': setLang(LANG === 0); break;
      case 'hints': Tut.setOn(!Tut.on); break;
    }
  }
}

function drawSlots() {
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawTextCS(ctx, L('ui_choose'), VIEW_W / 2, 18, '#ffa040', 2);

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
    drawText(ctx, L('ui_world', i + 1), 48, sy, sel ? '#ffe040' : '#c8b890');
    if (info) {
      // (a shorter year says so)
      if (info.len !== 'full') drawText(ctx, lenName(info.len), 272 - textWidth(lenName(info.len)), sy, '#80e0ff');
      drawText(ctx, L('w_day') + ' ' + (info.day + 1) + '  \x02' + info.ants + '  \x03' + info.food + '  ' + L('w_score') + ' ' + info.score,
        48, sy + 10, '#a09070');
      if (G.eraseArm === i) drawText(ctx, L('ui_eraseArm'), 180, sy, '#ff5040');
    } else {
      drawText(ctx, L('ui_empty'), 48, sy + 10, '#706050');
      // (an empty slot picks the new year's length)
      if (sel) {
        const ls = '< ' + L('ui_lenTag', lenName(G.crLen), lenMinutes(G.crLen)) + ' >';
        drawText(ctx, ls, 272 - textWidth(ls), sy, G.crLen === 'full' ? '#c8b890' : '#80e0ff');
      }
    }
  }
  if (!slotInfo(G.slotSel + 1)) drawTextC(ctx, L('ui_slotLenKey'), VIEW_W / 2, 152, '#806e58');
  drawTextC(ctx, L('ui_slotKeys'), VIEW_W / 2, 164, '#b0a080');
  drawTextC(ctx, L('ui_slotKeys2'), VIEW_W / 2, 176, '#706050');
  // (a newcomer: LEARN TO ANT first, see learn.js)
  if (!learnDone()) drawTextC(ctx, L('ui_learnOffer'), VIEW_W / 2, 188, '#a8e8a0');
}

function updateSlots() {
  if (tookPress('ArrowUp') || tookPress('KeyW')) { G.slotSel = (G.slotSel + 2) % 3; G.eraseArm = -1; Sfx.play('menu'); }
  if (tookPress('ArrowDown') || tookPress('KeyS')) { G.slotSel = (G.slotSel + 1) % 3; G.eraseArm = -1; Sfx.play('menu'); }
  if (tookPress('Escape')) { G.state = 'title'; return; }
  if (!learnDone() && tookPress('KeyL')) { openLearnMenu(); Sfx.play('select'); return; }
  // (an empty slot: left/right picks the new year's length)
  const left = tookPress('ArrowLeft') || tookPress('KeyA');
  if ((left || tookPress('ArrowRight') || tookPress('KeyD')) && !slotInfo(G.slotSel + 1)) { G.crLen = cycleLen(G.crLen, left ? -1 : 1); Sfx.play('menu'); }
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
  if (tookPress('Enter') || tookPress('Space')) {
    Sfx.play('select');
    // a LOADING frame goes on screen first; the world is made on the next step
    G.loadSlot = G.slotSel + 1; G.loadAt = G.frame;
    G.state = 'loading';
  }
}

function updateLoading() {
  if (G.frame <= G.loadAt) return;   // the LOADING frame isn't drawn yet
  // (LEARN TO ANT: a fresh scenario world at the chapter picked)
  if (G.loadLearn != null) { const ch = G.loadLearn; G.loadLearn = null; Learn.begin(ch); return; }
  const slot = G.loadSlot;
  if (slotInfo(slot) && startSavedWorld(slot)) {
    G.state = 'play'; pushMsg(L('m_welcome'));
  } else {
    // empty slot, or a save from an incompatible world size: start fresh
    startNewWorld(slot);
    G.state = 'intro';
    G.introLine = 0;
  }
}

function drawLoading() {
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawTextC(ctx, L('ui_loading'), VIEW_W / 2, VIEW_H / 2 - 4, '#c8b890');
}

function drawIntro() {
  TerrainView.flush();   // the map keeps painting in the background while the story is read
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const lines = introText();
  G.introLine += 0.4;
  const shown = Math.min(lines.length, Math.floor(G.introLine / 6) + 1);
  let y = 18;
  for (let i = 0; i < shown; i++) {
    drawTextC(ctx, lines[i], VIEW_W / 2, y, i === lines.length - 1 ? '#ffa040' : '#c8b890');
    y += 10;
  }
  if (shown >= lines.length && (G.frame >> 4) % 2 === 0) {
    drawTextC(ctx, L('ui_pressSpace'), VIEW_W / 2, 182, '#ffe040');
  }
}

function updateIntro() {
  if (tookPress('Space') || tookPress('Enter')) {
    G.state = 'play';
    pushMsg(L('m_gather'), '#80ff80');
    if (!Tut.active()) pushMsg(L('m_objHint'), '#ffd890');   // (else hint 6 tells it)
    Sfx.play('select');
  }
}

// the help screen: pages for a mode (see helpPages), over whatever opened
// it -- its own state from the title and the solo pause menu; online an
// overlay (G.help) on the lobby or the menu, the world running on under it
function openHelp(mode) { G.help = { mode, page: 0 }; }

function drawHelp() {
  const pages = helpPages(G.help ? G.help.mode : 'solo');
  const pg = pages[Math.min(G.help ? G.help.page : 0, pages.length - 1)];
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawTextCS(ctx, pg.title, VIEW_W / 2, 12, '#ffa040', 2);
  let y = 32;
  for (const [line, color] of pg.lines) {
    if (line) drawText(ctx, line, 24, y, color);
    y += 9;
  }
  const keys = pages.length > 1 ? L('ui_helpKeys', G.help.page + 1, pages.length) : L('ui_escBack');
  drawTextC(ctx, keys, VIEW_W / 2, 186, '#706050');
}

// the help screen's keys: Left/Right turn the pages, Esc (Enter, Space)
// closes it. Returns false once closed.
function helpKeys() {
  const h = G.help, n = helpPages(h.mode).length;
  if (tookPress('ArrowLeft') || tookPress('KeyA')) { h.page = (h.page + n - 1) % n; Sfx.play('menu'); }
  if (tookPress('ArrowRight') || tookPress('KeyD')) { h.page = (h.page + 1) % n; Sfx.play('menu'); }
  if (tookPress('Escape') || tookPress('Enter') || tookPress('Space')) { G.help = null; Sfx.play('menu'); return false; }
  return true;
}

function updateHelp() {
  if (!G.help) openHelp('solo');
  if (!helpKeys()) G.state = G.prevState === 'pause' ? 'pause' : G.prevState;
}

function pauseItems() {
  // (online nothing pauses: the menu just covers the running world; HINTS
  // turns off the spring hints and the first matches' tips alike)
  if (G.online) {
    return [{ id: 'resume', label: L('ui_resume') }, { id: 'help', label: L('ui_help') },
      { id: 'hints', label: L('ui_hints', L(Tut.on ? 'w_on' : 'w_off')) },
      { id: 'leave', label: L(G.mode === 'world' ? 'ui_leaveWorld' : 'ui_leaveMatch') }];
  }
  // (LEARN TO ANT: nothing is saved; skip a chapter, pick one, or leave)
  if (Learn.on) {
    return [{ id: 'resume', label: L('ui_resume') }, { id: 'skip', label: L('ui_skipCh') },
      { id: 'chapters', label: L('ui_chapters') }, { id: 'help', label: L('ui_help') },
      { id: 'leaveLearn', label: L('ui_leaveLearn') }];
  }
  const items = [
    { id: 'resume', label: L('ui_resume') },
    { id: 'save', label: L('ui_saveGame') },
    { id: 'help', label: L('ui_help') },
    { id: 'hints', label: L('ui_hints', L(Tut.on ? 'w_on' : 'w_off')) },
  ];
  items.push({ id: 'quit', label: L('ui_saveQuit') });
  return items;
}

function drawPause() {
  if (G.help) { drawHelp(); return; }   // (online: the help over the running world)
  drawPlay();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const items = pauseItems();
  // (clear of the hint panel below, y 144)
  bevelPanel(90, 46, 140, 35 + items.length * 12 + (G.online ? 10 : 0));
  drawTextCS(ctx, L(G.online ? 'ui_menu' : 'ui_paused'), VIEW_W / 2, 54, '#ffa040', 2);
  if (G.online) drawTextC(ctx, L('ui_worldRuns'), VIEW_W / 2, 79 + items.length * 12, '#806e58');
  for (let i = 0; i < items.length; i++) {
    const sel = i === G.menuSel;
    if (sel) drawText(ctx, '\x06', 100, 78 + i * 12, '#ffe040');
    drawText(ctx, items[i].label, 112, 78 + i * 12, sel ? '#ffe040' : '#c8b890');
  }
}

function updatePause() {
  if (G.online) {
    // the match goes on under the menu: our ant stands still meanwhile
    clearInput();
    Net.frame();
    worldTick();
    if (G.state !== 'pause') return;
    if (G.help) { helpKeys(); return; }
  }
  if (tookPress('Escape') || (G.online && tookPress('KeyP'))) { G.state = 'play'; return; }
  const items = pauseItems();
  if (menuNav(items.length)) {
    Sfx.play('select');
    switch (items[G.menuSel].id) {
      case 'resume':
        G.state = 'play';
        break;
      case 'save':
        if (saveWorld(G.slot)) { pushMsg(L('m_saved'), '#80c0ff'); Sfx.play('save'); }
        G.state = 'play';
        break;
      case 'help':
        openHelp(G.online ? G.mode : 'solo');
        if (!G.online) { G.prevState = 'pause'; G.state = 'help'; }
        break;
      case 'hints':
        Tut.setOn(!Tut.on);
        if (!Tut.on) pushMsg(L('m_hintsOff'), '#ffd890');
        break;
      case 'quit':
        saveWorld(G.slot);
        G.running = false;
        G.state = 'title'; G.menuSel = 0;
        break;
      case 'leave':
        // (a persistent world: back to the world list, for another one)
        leaveOnline(G.mode === 'world' ? 'networlds' : 'title');
        break;
      case 'skip':
        G.state = 'play';
        Learn.next();
        break;
      case 'chapters':
        G.learnSel = Learn.ch; G.state = 'learnmenu';
        break;
      case 'leaveLearn':
        Learn.leave();
        break;
    }
  }
}

function drawTakeover() {
  const tk = G.takeover;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const title = tk.live ? L('ui_switchAnt') : G.online && !G.players[LOCAL].deathPos ? L('ui_joinColony') : L('ui_youDied');
  // (the panel widens for a long title, in big letters)
  const pw = Math.min(VIEW_W - 8, Math.max(180, textWidth(title) * 2 + 16));
  bevelPanel(Math.round((VIEW_W - pw) / 2), 30, pw, 140);
  const pcol = playerColor(LOCAL);
  if (tk.live) {
    drawTextCS(ctx, L('ui_switchAnt'), VIEW_W / 2, 38, pcol, 2);
    drawTextC(ctx, L('ui_lendLegs'), VIEW_W / 2, 58, '#c8b890');
  } else if (G.online && !G.players[LOCAL].deathPos) {
    // (just joined, or back from a lost connection with the old ant gone)
    drawTextCS(ctx, L('ui_joinColony'), VIEW_W / 2, 38, pcol, 2);
    if (G.rebornNote) {
      drawTextC(ctx, L(G.rebornNote.reason), VIEW_W / 2, 57, '#ff7060');
      drawTextC(ctx, L('ui_rebornNote', G.rebornNote.gen), VIEW_W / 2, 67, '#ffb040');
    } else drawTextC(ctx, L('ui_pickAnt'), VIEW_W / 2, 58, '#c8b890');
  } else {
    drawTextCS(ctx, L('ui_youDied'), VIEW_W / 2, 38, '#ff5040', 2);
    drawTextC(ctx, L('ui_colonyLives'), VIEW_W / 2, 58, '#c8b890');
  }
  // (the rebirth note's second line pushes the list down)
  const dy = !tk.live && G.online && !G.players[LOCAL].deathPos && G.rebornNote ? 12 : 0;
  const job = G.players[LOCAL] && G.players[LOCAL].job;
  drawTextC(ctx, L('ui_continueAs'), VIEW_W / 2, 70 + dy, pcol);
  for (let i = 0; i < tk.types.length; i++) {
    const t = tk.types[i];
    const sel = i === tk.sel;
    const label = t.fresh ? L('ui_freshWorker') : casteName(t.caste) + '  X' + t.count;
    if (sel) drawText(ctx, '\x06', 92, 84 + dy + i * 12, '#ffe040');
    drawText(ctx, label, 104, 84 + dy + i * 12, sel ? '#ffe040' : '#c8b890');
    // (the caste our job suits: its icon beside it)
    if (job && JOB_CASTE[job] === t.caste) drawText(ctx, JOB_ICON[job], 110 + textWidth(label), 84 + dy + i * 12, JOB_COLOR[job]);
  }
  if (job) drawTextC(ctx, L('ui_jobSuits', JOB_ICON[job] + jobName(job), casteName(JOB_CASTE[job])), VIEW_W / 2, 84 + dy + Math.max(3, tk.types.length) * 12 + 6, JOB_COLOR[job]);
  drawTextC(ctx, tk.live ? L('ui_switchKeys') : L('ui_takeOver'),
    VIEW_W / 2, 160, '#a09070');
}

// three big pixel stars, earned ones in gold
function drawStars(n, y) {
  for (let i = 0; i < 3; i++) {
    const x = VIEW_W / 2 - 34 + i * 24;
    drawText(ctx, '\x15', x + 1, y + 1, '#000000', 3);
    drawText(ctx, '\x15', x, y, i < n ? '#ffd030' : '#3a2c1c', 3);
  }
}

// the end screen: the year's result (a solo world's, or the match's for
// everyone online). Online it has a second page, the HIGHLIGHTS (Left/Right):
// the awards, every player's MVP score and personal milestones this match
// (versus: both sides -- the enemy's milestones are shown only here), and
// the local player's own. The result page names the MVP and what the
// local player won. G.overPage: the page.
function drawGameOver() {
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const s = G.gameOverStats;
  const online = G.online && s && s.hl;
  if (online && G.overPage === 1) { drawHighlights(s); return; }
  if (s && s.versus) { drawVersusOver(s); return; }
  if (s && s.canContinue) {
    // the year's end: a nuptial flight (or none)
    if (s.win) {
      drawTextCS(ctx, L('ui_winTitle'), VIEW_W / 2, 16, '#ff90e0', 2);
    } else {
      drawTextCS(ctx, L('ui_noFlight1'), VIEW_W / 2, 10, '#e0c080', 2);
      drawTextCS(ctx, L('ui_noFlight2'), VIEW_W / 2, 28, '#e0c080', 2);
    }
    drawStars(s.stars, 48);
    const lines = [
      [Ln(s.reason, s.flown), s.win ? '#ffd0f0' : '#c8b890'],
      [L('ui_milestones', s.milestones), '#ffe040'],
      [Ln('ui_colonySize', s.pop || 0), '#c8b890'],
      [L(s.rivalDead ? 'ui_rivalDead' : s.rival ? 'ui_rivalWon' : 'ui_rivalLost'), s.rival ? '#80ff80' : '#ff7060'],
      [L('ui_finalScore', s.score), '#ffe040'],
      [L('ui_foodGathered', Math.floor(s.stats.foodGathered)), '#a09070'],
    ];
    // (solo: the player's personal milestones, all of them so far)
    if (!G.online) lines.push(pmTotalLine());
    let y = 76;
    for (const [line, color] of lines) { drawTextC(ctx, line, VIEW_W / 2, y, color); y += 10; }
    const items = G.online ? [L('ui_toTitle')] : [L('ui_continue'), L('ui_toTitle')];
    // (online the match is over for everyone: no next year)
    if (online) {
      drawOverBrief(s, 136);
      drawTextC(ctx, L('ui_matchOverHl'), VIEW_W / 2, 160, '#a09070');
    }
    for (let i = 0; i < items.length; i++) {
      const sel = i === G.overSel;
      const iy = (G.online ? 172 : 152) + i * 12;
      if (sel) drawText(ctx, '\x06', VIEW_W / 2 - textWidth(items[i]) / 2 - 12, iy, '#ffe040');
      drawTextCS(ctx, items[i], VIEW_W / 2, iy, sel ? '#ffe040' : '#c8b890');
    }
    return;
  }
  drawTextCS(ctx, L('ui_gameover1'), VIEW_W / 2, 20, '#ff5040', 2);
  drawTextCS(ctx, L('ui_gameover2'), VIEW_W / 2, 38, '#ff5040', 2);
  if (s) {
    const lines = [
      [L(s.reason || 'r_extinct'), '#ff9070'],
      [Ln('ui_survived', s.day + 1), '#c8b890'],
      [L('ui_finalScore', s.score), '#ffe040'],
      [L('ui_milestones', s.milestones || 0), '#a09070'],
      [L('ui_foodGathered', Math.floor(s.stats.foodGathered)), '#a09070'],
      [L('ui_antsBorn', s.stats.antsBorn), '#a09070'],
      [L('ui_antsLost', s.stats.antsDied), '#a09070'],
      [L('ui_predSlain', s.stats.predatorsSlain), '#a09070'],
    ];
    if (!G.online) lines.push(pmTotalLine());
    // (online: closer together, the MVP and our awards under them)
    const dy = online ? 10 : 12;
    let y = online ? 60 : 64;
    for (const [line, color] of lines) { drawTextC(ctx, line, VIEW_W / 2, y, color); y += dy; }
    if (online) drawOverBrief(s, 142);
  }
  if (G.online) drawTextC(ctx, L(online ? 'ui_matchOverHl' : 'ui_matchOver'), VIEW_W / 2, 164, '#a09070');
  if ((G.frame >> 4) % 2 === 0) drawTextC(ctx, L('ui_pressEnter'), VIEW_W / 2, 178, '#ffe040');
}

// a versus match's end: victory, defeat or a draw, how it was decided, and
// both sides' numbers side by side
function drawVersusOver(s) {
  const me = Net.faction === 'red' ? 1 : 0;
  const won = s.winner === me, draw = s.winner < 0;
  drawTextCS(ctx, L(draw ? 'ui_vsDraw' : won ? 'ui_vsWin' : 'ui_vsLose'), VIEW_W / 2, 12, draw ? '#e0c080' : won ? '#80ff80' : '#ff5040', 2);
  if (!draw) drawTextC(ctx, L('ui_vsWinner' + s.winner), VIEW_W / 2, 34, s.winner ? '#ff7060' : '#d8d4e4');
  const lost = 1 - s.winner;
  const reason = s.reason === 'r_vsQueen' || s.reason === 'r_vsExtinct' ? s.reason + lost : s.reason;
  drawTextC(ctx, L(reason), VIEW_W / 2, 46, '#c8b890');
  const sides = s.sides || [];
  const X = [196, 266], head = ['ui_black', 'ui_red'], hc = ['#d8d4e4', '#ff7060'];
  groove(30, 60, 260);
  for (let i = 0; i < 2; i++) {
    drawTextC(ctx, L(head[i]), X[i], 66, hc[i]);
    if (i === me) drawText(ctx, '\x06', X[i] - textWidth(L(head[i])) / 2 - 10, 66, '#ffe040');
  }
  const rows = [
    ['ui_vsStars', sd => '\x15'.repeat(sd.stars || 0) || '-'],
    ['ui_vsFlown', sd => String(sd.flown || 0)],
    ['ui_vsAnts', sd => String(sd.pop || 0)],
    ['ui_vsMiles', sd => String(sd.milestones || 0)],
    ['w_score', sd => String(sd.score || 0)],
  ];
  let y = 80;
  for (const [key, fmt] of rows) {
    drawText(ctx, L(key), 40, y, '#a09070');
    for (let i = 0; i < 2; i++) if (sides[i]) drawTextC(ctx, fmt(sides[i]), X[i], y, i === s.winner ? '#ffe040' : '#c8b890');
    y += 12;
  }
  if (s.hl) drawOverBrief(s, 142);
  drawTextC(ctx, L(s.hl ? 'ui_matchOverHl' : 'ui_matchOver'), VIEW_W / 2, 164, '#a09070');
  if ((G.frame >> 4) % 2 === 0) drawTextC(ctx, L('ui_pressEnter'), VIEW_W / 2, 178, '#ffe040');
}

// the local player's personal milestones, all of them so far (solo)
function pmTotalLine() {
  const p = G.players[LOCAL];
  const total = PERSONAL.reduce((n, t) => n + t.tiers.length, 0);
  return ['\x1B ' + L('ui_pmTotalLine', p && p.stats ? pmCount(p.stats) : 0, total), '#ffd030'];
}

// the awards (see matchHighlights in game.js): a label, and the winning
// value as shown
function awardLabel(k) { return L('aw_' + k); }
function awardValue(a) { return Ln('awv_' + a.k, a.v); }
function hlRow(s, i) { return s.hl ? s.hl.players.find(r => r.i === i) || null : null; }
function hlName(s, i) {
  const r = hlRow(s, i);
  return r && r.n ? r.n : G.online ? playerName(i) : L('ui_you');
}
// a list of labels, cut to fit `w` px with a "+n" for the rest
function fitList(items, w, sep) {
  sep = sep || ', ';
  for (let n = items.length; n > 0; n--) {
    const s = items.slice(0, n).join(sep) + (n < items.length ? ' +' + (items.length - n) : '');
    if (textWidth(s) <= w) return s;
  }
  return items.length ? '+' + items.length : '';
}

// under the result: the MVP (in its colour), and what the local player won
// -- or, with no award, its personal milestones this match
function drawOverBrief(s, y) {
  const hl = s.hl;
  const mvp = hl.awards.find(a => a.k === 'mvp');
  if (mvp) {
    const head = '\x1B ' + awardLabel('mvp') + ': ', nm = hlName(s, mvp.i);
    const x = Math.round(VIEW_W / 2 - textWidth(head + nm) / 2);
    drawTextS(ctx, head, x, y, '#ffe040');
    drawTextS(ctx, nm, x + head.length * FONT_ADV, y, playerColor(mvp.i));
  }
  const mine = hl.awards.filter(a => a.i === LOCAL && a.k !== 'mvp').map(a => awardLabel(a.k));
  const r = hlRow(s, LOCAL);
  if (mine.length) {
    const head = L('ui_youWon', '');
    drawTextC(ctx, head + fitList(mine, 300 - textWidth(head)), VIEW_W / 2, y + 10, '#80ff80');
  } else if (r) drawTextC(ctx, Ln('ui_yourPmMatch', r.pmNew.length), VIEW_W / 2, y + 10, '#c8b890');
}

// the HIGHLIGHTS page: the awards (who, and how much), then every player
// in two columns (co-op: half each; versus: a side each; best first,
// eight at most) with its MVP score and the personal milestones it earned
// this match, then the local player's own milestones by name
function drawHighlights(s) {
  const hl = s.hl;
  drawTextCS(ctx, L('ui_highlights'), VIEW_W / 2, 6, '#ffa040', 2);
  // (more than six awards -- the jobs' too: rows of 8 px, and the rest
  // of the page a row lower)
  const many = hl.awards.length > 6, ady = many ? 8 : 9, off = many ? 8 : 0;
  let y = 26;
  for (const a of hl.awards) {
    drawText(ctx, awardLabel(a.k), 24, y, a.k === 'mvp' ? '#ffe040' : '#c8b890');
    if (a.i === LOCAL) drawText(ctx, '\x06', 108, y, '#ffe040');
    // (versus: the winner's side, as a chip -- the colours repeat across sides)
    const r = s.versus && hlRow(s, a.i);
    if (r) { ctx.fillStyle = r.c ? '#ff7060' : '#d8d4e4'; ctx.fillRect(117, y + 2, 3, 3); }
    drawText(ctx, hlName(s, a.i), 124, y, playerColor(a.i));
    const v = awardValue(a);
    drawText(ctx, v, 296 - textWidth(v), y, '#a09070');
    y += ady;
  }
  groove(12, 82 + off, 296);
  const vs = !!s.versus;
  const best = list => list.slice().sort((a, b) => b.mvp - a.mvp || a.i - b.i);
  // (co-op: best first, more than four split over both columns)
  const all = best(hl.players), half = all.length > 4 ? Math.ceil(all.length / 2) : all.length;
  const cols = vs ? [0, 1].map(c => best(hl.players.filter(r => r.c === c))) : [all.slice(0, half), all.slice(half)];
  const X = [12, 166];
  for (let c = 0; c < 2; c++) {
    if (!cols[c].length && !vs) continue;
    const x0 = X[c];
    if (vs) drawText(ctx, L(c ? 'ui_red' : 'ui_black'), x0 + 7, 87 + off, c ? '#ff7060' : '#d8d4e4');
    else drawText(ctx, L('ui_hlPlayer'), x0 + 7, 87 + off, '#806e58');
    const mh = L('ui_hlMvp');
    drawText(ctx, mh, x0 + 118 - textWidth(mh), 87 + off, '#806e58');
    drawText(ctx, '\x1B', x0 + 137, 87 + off, '#806e58');
    cols[c].slice(0, 8).forEach((r, k) => {
      const yy = 96 + off + k * 8, me = r.i === LOCAL;
      if (me) drawText(ctx, '\x06', x0, yy, '#ffe040');
      // (the job it ended the match on -- both sides', the match is over)
      if (r.j && JOB_ICON[r.j]) drawText(ctx, JOB_ICON[r.j], x0 + 7, yy, JOB_COLOR[r.j]);
      drawText(ctx, String(r.n || L('ui_you')).slice(0, 12), x0 + 14, yy, playerColor(r.i));
      const m = String(r.mvp);
      drawText(ctx, m, x0 + 118 - textWidth(m), yy, me ? '#ffe040' : '#c8b890');
      const p = String(r.pmNew.length);
      drawText(ctx, p, x0 + 142 - textWidth(p), yy, r.pmNew.length ? '#ffd030' : '#706050');
    });
  }
  groove(12, 162 + off, 296);
  // our own personal milestones this match: each track's best new tier
  const r = hlRow(s, LOCAL);
  if (r) {
    const top = {};
    for (const [id, tier] of r.pmNew) top[id] = Math.max(top[id] || 0, tier);
    const names = Object.keys(top).map(id => L('pm_' + id) + '\x15'.repeat(top[id]));
    const str = names.length ? '\x1B ' + fitList(names, 290, ' ') : L('ui_noPmMatch');
    drawTextC(ctx, str, VIEW_W / 2, 167 + off * 0.75, names.length ? '#ffd030' : '#806e58');
  }
  drawTextC(ctx, L('ui_hlKeys'), VIEW_W / 2, 181 + off, (G.frame >> 4) % 2 ? '#ffe040' : '#c8b890');
}

function updateGameOver() {
  const s = G.gameOverStats;
  if (G.online) {
    // left/right: the result or the highlights
    if (s && s.hl && (tookPress('ArrowLeft') || tookPress('KeyA') || tookPress('ArrowRight') || tookPress('KeyD'))) {
      G.overPage = G.overPage ? 0 : 1;
      Sfx.play('menu');
    }
    // the match is over for everyone: back to the title
    if (tookPress('Enter') || tookPress('Space') || tookPress('Escape')) {
      Sfx.play('select');
      leaveOnline('title');
    }
    return;
  }
  if (s && s.canContinue) {
    // continue into the next year, or leave the (saved) world for now
    const n = 2;
    if (tookPress('ArrowUp') || tookPress('KeyW')) { G.overSel = (G.overSel + n - 1) % n; Sfx.play('menu'); }
    if (tookPress('ArrowDown') || tookPress('KeyS')) { G.overSel = (G.overSel + 1) % n; Sfx.play('menu'); }
    if (tookPress('Enter') || tookPress('Space')) {
      Sfx.play('select');
      if (G.overSel === 0) {
        continueYear();
        G.running = true;
        G.state = 'play';
        G.flyers = []; G.flightCam = null;
        clearInput();
      } else {
        G.state = 'title'; G.menuSel = 0;
      }
    }
    return;
  }
  if (tookPress('Enter') || tookPress('Space') || tookPress('Escape')) {
    G.state = 'title'; G.menuSel = 0;
    Sfx.play('select');
  }
}

// ---------------------------------------------------------------------------
// online: name, CREATE / JOIN, the code, the lobby. Net (net.js) talks to the
// server and calls the netOn* hooks below as the answers come.
// ---------------------------------------------------------------------------
function netBackdrop(title) {
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawTextCS(ctx, title, VIEW_W / 2, 14, '#ffa040', 2);
}

// the last error, in red, under the menu
function drawNetErr(y) {
  if (Net.err) drawTextC(ctx, errText(Net.err), VIEW_W / 2, y, '#ff5040');
}

// a text box with a blinking cursor
function drawEntry(text, y, w) {
  const x = Math.round((VIEW_W - w) / 2);
  bevelPanel(x, y, w, 19);
  ctx.fillStyle = '#1a1008';
  ctx.fillRect(x + 3, y + 3, w - 6, 13);
  const tx = drawText(ctx, text, x + 7, y + 6, '#ffe8a0');
  if ((G.frame >> 4) % 2) drawText(ctx, '_', tx, y + 6, '#ffe040');
}

function drawNetName() {
  netBackdrop(L('ui_onlineTitle'));
  drawTextC(ctx, L('ui_onlineNote'), VIEW_W / 2, 40, '#b09060');
  drawTextCS(ctx, L('ui_yourName'), VIEW_W / 2, 70, '#ffe080');
  drawEntry(G.nameBuf, 84, 110);
  drawNetErr(120);
  drawTextC(ctx, L('ui_nameKeys'), VIEW_W / 2, 176, '#a09070');
}

function updateNetName() {
  for (const ch of typed) {
    const c = ch.toUpperCase();
    if (NetProto.NAME_OK.includes(c) && G.nameBuf.length < NetProto.NAME_MAX && !(c === ' ' && !G.nameBuf)) G.nameBuf += c;
  }
  if (tookPress('Backspace')) G.nameBuf = G.nameBuf.slice(0, -1);
  if (tookPress('Escape')) { G.state = 'title'; Net.err = null; Sfx.play('menu'); return; }
  if (!tookPress('Enter')) return;
  // (nothing typed yet: say so)
  if (!NetProto.cleanName(G.nameBuf)) { Net.err = 'e_noName'; Sfx.play('menu'); return; }
  Net.err = null;
  G.nameBuf = NetProto.cleanName(G.nameBuf);
  lsSet('maur_name', G.nameBuf);
  G.state = 'netmenu'; G.menuSel = 0;
  Sfx.play('select');
}

function netMenuItems() {
  return [
    { id: 'worlds', label: L('ui_worlds'), note: 'ui_worldsNote' },
    { id: 'create', label: L('ui_create'), note: 'ui_createNote' },
    { id: 'join', label: L('ui_joinCode'), note: 'ui_joinNote' },
    { id: 'open', label: L('ui_openMatches'), note: 'ui_openNote' },
    { id: 'back', label: L('ui_back') },
  ];
}

function drawNetMenu() {
  netBackdrop(L('ui_onlineTitle'));
  drawTextC(ctx, G.nameBuf, VIEW_W / 2, 40, '#ffe080');
  const items = netMenuItems();
  for (let i = 0; i < items.length; i++) {
    const sel = i === G.menuSel, y = 62 + i * 14;
    if (sel) drawTextC(ctx, '\x06', VIEW_W / 2 - textWidth(items[i].label) / 2 - 12, y, '#ffe040');
    drawTextCS(ctx, items[i].label, VIEW_W / 2, y, sel ? '#ffe040' : '#c8b890');
  }
  const it = items[G.menuSel];
  if (it && it.note) drawTextC(ctx, L(it.note), VIEW_W / 2, 140, '#a09070');
  drawNetErr(156);
  // (a newcomer: LEARN TO ANT first)
  if (!learnDone()) drawTextC(ctx, L('ui_learnOffer'), VIEW_W / 2, 176, '#a8e8a0');
}

function updateNetMenu() {
  if (tookPress('Escape')) { G.state = 'netname'; Sfx.play('menu'); return; }
  if (!learnDone() && tookPress('KeyL')) { Net.close(); openLearnMenu(); Sfx.play('select'); return; }
  const items = netMenuItems();
  if (!menuNav(items.length)) return;
  Sfx.play('select');
  Net.err = null;
  Net.name = G.nameBuf;
  switch (items[G.menuSel].id) {
    case 'worlds': case 'open':
      // the room browser: a connection that asks for the list now and then
      Net.list = null;
      Net.request({ t: 'list' });
      G.state = items[G.menuSel].id === 'worlds' ? 'networlds' : 'netopen';
      G.browseSel = 0;
      break;
    case 'create':
      G.state = 'netcreate'; G.crSel = 0;
      break;
    case 'join':
      G.state = 'netjoin'; G.codeBuf = ''; Net.err = null;
      break;
    case 'back':
      G.state = 'title'; G.menuSel = 1;
      break;
  }
}

// ---- the room browser: the persistent worlds, the open matches -----------------
// a list panel row: the selection frame
// (two lines of text: at y and y + 9, the frame clear of both)
function browseRow(y, sel) {
  bevelPanel(24, y - 4, 272, 22);
  if (!sel) return;
  ctx.fillStyle = '#ffe040';
  ctx.fillRect(24, y - 4, 272, 1); ctx.fillRect(24, y + 17, 272, 1);
  ctx.fillRect(24, y - 4, 1, 22); ctx.fillRect(295, y - 4, 1, 22);
  drawText(ctx, '\x06', 14, y + 3, '#ffe040');
}

// the list as the server last sent it (null: still asking)
function browseList(kind) { return Net.list ? Net.list[kind] || [] : null; }

// shared keys: up/down, Enter on a row, Esc back to the menu (the
// connection closes). Returns the row chosen, or null.
function browseNav(rows) {
  Net.poll();
  Net.askList();
  if (tookPress('Escape')) { Net.close(); G.state = 'netmenu'; Net.err = null; Sfx.play('menu'); return null; }
  const n = rows ? rows.length : 0;
  if (!n) return null;
  G.browseSel = Math.min(G.browseSel, n - 1);
  if (tookPress('ArrowUp') || tookPress('KeyW')) { G.browseSel = (G.browseSel + n - 1) % n; Sfx.play('menu'); }
  if (tookPress('ArrowDown') || tookPress('KeyS')) { G.browseSel = (G.browseSel + 1) % n; Sfx.play('menu'); }
  return tookPress('Enter') || tookPress('Space') ? rows[G.browseSel] : null;
}

function drawBrowseFoot(empty, list) {
  if (!list) drawTextCS(ctx, L('ui_listing'), VIEW_W / 2, 80, (G.frame >> 4) % 2 ? '#ffe080' : '#c8b890');
  // (no open match to join, and none can be made: just the server-full line)
  else if (!list.length && !(Net.list.full && empty === 'ui_noOpen')) drawTextC(ctx, L(empty), VIEW_W / 2, 80, '#a09070');
  if (Net.list && Net.list.full) drawTextC(ctx, L('ui_serverFull'), VIEW_W / 2, 150, '#ff9040');
  drawNetErr(160);
  drawTextC(ctx, L('ui_codeKeys'), VIEW_W / 2, 178, '#a09070');
}

function drawNetWorlds() {
  netBackdrop(L('ui_worlds'));
  const list = browseList('worlds');
  (list || []).slice(0, 4).forEach((w, i) => {
    const y = 40 + i * 28, sel = i === G.browseSel;
    browseRow(y, sel);
    drawText(ctx, w.name, 32, y, sel ? '#ffe040' : '#e8e0c8');
    const pl = w.players + '/' + w.max;
    drawText(ctx, pl, 288 - textWidth(pl), y, w.players >= w.max ? '#ff9040' : '#80d0ff');
    const yr = SEASON_ICON[w.season] + ' ' + L('ui_seasonYear', seasonName(w.season), w.year);
    drawText(ctx, yr, 32, y + 9, SEASON_COLOR[w.season]);
    const lg = L('ui_legacyN', w.legacy) + (w.gen > 1 ? '  ' + L('ui_worldColony', w.gen) : '');
    drawText(ctx, lg, 288 - textWidth(lg), y + 9, '#ff90e0');
    if (w.sleeping && !w.players) drawText(ctx, L('ui_asleep'), 160 - textWidth(L('ui_asleep')) / 2, y, '#706050');
  });
  drawBrowseFoot('ui_noWorlds', list);
}

function updateNetWorlds() {
  const w = browseNav(browseList('worlds'));
  if (!w) return;
  Net.request({ t: 'enter', name: w.name });
  G.state = 'netwait';
  Sfx.play('select');
}

function drawNetOpen() {
  netBackdrop(L('ui_openMatches'));
  const list = browseList('matches');
  (list || []).slice(0, 4).forEach((m, i) => {
    const y = 40 + i * 28, sel = i === G.browseSel;
    browseRow(y, sel);
    drawText(ctx, m.code, 32, y, sel ? '#ffe040' : '#e8e0c8');
    drawText(ctx, L(m.mode === 'versus' ? 'ui_modeVersus' : 'ui_modeCoop'), 80, y, m.mode === 'versus' ? '#ff9080' : '#a8e8a0');
    // (the year's length: how long a joiner signs up for)
    drawText(ctx, L('ui_lenTag', lenName(m.len), lenMinutes(m.len)), 146, y, m.len && m.len !== 'full' ? '#80e0ff' : '#a09070');
    const pl = m.players + '/' + m.max;
    drawText(ctx, pl, 288 - textWidth(pl), y, '#80d0ff');
    drawText(ctx, L('ui_hostIs', m.host), 32, y + 9, '#a09070');
    // (a match already under way: joiners pick an ant from the colony)
    const st = L(m.on ? 'ui_underWay' : 'ui_inLobby');
    drawText(ctx, st, 288 - textWidth(st), y + 9, m.on ? '#ffb040' : '#a09070');
  });
  drawBrowseFoot('ui_noOpen', list);
}

function updateNetOpen() {
  const m = browseNav(browseList('matches'));
  if (!m) return;
  Net.request({ t: 'join', code: m.code });
  G.state = 'netwait';
  Sfx.play('select');
}

// ---- CREATE A MATCH: co-op or versus, the year's length, public or private ------
// a year's length as shown: its name, and its minutes
function lenName(k) { return L('len_' + (YEAR_LENS[k] ? k : 'full')); }
function lenMinutes(k) { return Math.round((YEAR_LENS[k] || DAY_FULL) * YEAR_DAYS / 3600); }
// the next (or, d = -1, the previous) year's length
function cycleLen(k, d) {
  const i = Math.max(0, YEAR_LEN_IDS.indexOf(k));
  return YEAR_LEN_IDS[(i + YEAR_LEN_IDS.length + (d < 0 ? -1 : 1)) % YEAR_LEN_IDS.length];
}
function drawNetCreate() {
  netBackdrop(L('ui_create'));
  const rows = [
    L('ui_crMode', L(G.crMode === 'versus' ? 'ui_modeVersus' : 'ui_modeCoop')),
    L('ui_crLen', lenName(G.crLen)),
    L('ui_crVis', L(G.crPub ? 'ui_public' : 'ui_private')),
    L('ui_crGo'),
  ];
  for (let i = 0; i < rows.length; i++) {
    const sel = i === G.crSel, y = 50 + i * 16;
    const lr = i < 3 && sel ? '< ' + rows[i] + ' >' : rows[i];
    if (sel) drawTextC(ctx, '\x06', VIEW_W / 2 - textWidth(lr) / 2 - 12, y, '#ffe040');
    drawTextCS(ctx, lr, VIEW_W / 2, y, sel ? '#ffe040' : '#c8b890');
  }
  drawTextC(ctx, L(G.crMode === 'versus' ? 'ui_versusNote' : 'ui_coopNote'), VIEW_W / 2, 118, '#a09070');
  drawTextC(ctx, L('ui_lenNote', lenMinutes(G.crLen)), VIEW_W / 2, 128, '#a09070');
  drawTextC(ctx, L(G.crPub ? 'ui_pubNote' : 'ui_privNote'), VIEW_W / 2, 138, '#a09070');
  drawNetErr(154);
  drawTextC(ctx, L('ui_crKeys'), VIEW_W / 2, 178, '#a09070');
}

function updateNetCreate() {
  if (tookPress('Escape')) { G.state = 'netmenu'; G.menuSel = 1; Sfx.play('menu'); return; }
  if (tookPress('ArrowUp') || tookPress('KeyW')) { G.crSel = (G.crSel + 3) % 4; Sfx.play('menu'); }
  if (tookPress('ArrowDown') || tookPress('KeyS')) { G.crSel = (G.crSel + 1) % 4; Sfx.play('menu'); }
  const left = tookPress('ArrowLeft') || tookPress('KeyA');
  const lr = left || tookPress('ArrowRight') || tookPress('KeyD');
  const go = tookPress('Enter') || tookPress('Space');
  if ((lr || go) && G.crSel === 0) { G.crMode = G.crMode === 'versus' ? 'coop' : 'versus'; Sfx.play('menu'); }
  else if ((lr || go) && G.crSel === 1) { G.crLen = cycleLen(G.crLen, left ? -1 : 1); Sfx.play('menu'); }
  else if ((lr || go) && G.crSel === 2) { G.crPub = !G.crPub; Sfx.play('menu'); }
  else if (go && G.crSel === 3) {
    Net.err = null;
    Net.name = G.nameBuf;
    Net.start({ t: 'create', mode: G.crMode, pub: G.crPub, len: G.crLen });
    G.state = 'netwait';
    Sfx.play('select');
  }
}

function drawNetJoin() {
  netBackdrop(L('ui_onlineTitle'));
  drawTextCS(ctx, L('ui_enterCode'), VIEW_W / 2, 60, '#ffe080');
  // four boxes, the letters big
  for (let i = 0; i < NetProto.CODE_LEN; i++) {
    const x = VIEW_W / 2 - 58 + i * 30;
    bevelPanel(x, 78, 26, 30);
    ctx.fillStyle = '#1a1008';
    ctx.fillRect(x + 3, 81, 20, 24);
    const ch = G.codeBuf[i];
    if (ch) drawText(ctx, ch, x + 6, 85, '#ffe8a0', 3);
    else if (i === G.codeBuf.length && (G.frame >> 4) % 2) drawText(ctx, '_', x + 6, 85, '#ffe040', 3);
  }
  drawNetErr(124);
  drawTextC(ctx, L('ui_codeKeys'), VIEW_W / 2, 176, '#a09070');
}

function updateNetJoin() {
  for (const ch of typed) {
    const c = ch.toUpperCase();
    if (NetProto.CODE_ABC.includes(c) && G.codeBuf.length < NetProto.CODE_LEN) G.codeBuf += c;
  }
  if (tookPress('Backspace')) G.codeBuf = G.codeBuf.slice(0, -1);
  if (tookPress('Escape')) { G.state = 'netmenu'; Net.err = null; Sfx.play('menu'); return; }
  if (tookPress('Enter') && NetProto.normCode(G.codeBuf)) {
    Net.name = G.nameBuf;
    Net.start({ t: 'join', code: G.codeBuf });
    G.state = 'netwait';
    Sfx.play('select');
  }
}

function drawNetWait() {
  netBackdrop(L('ui_onlineTitle'));
  const str = Net.inMatch || Net.roomState === 'play' ? L('ui_loading') : L('ui_connecting');
  drawTextCS(ctx, str, VIEW_W / 2, 90, (G.frame >> 4) % 2 ? '#ffe080' : '#c8b890');
  drawTextC(ctx, L('ui_escBack'), VIEW_W / 2, 176, '#706050');
}

function updateNetWait() {
  if (tookPress('Escape')) { leaveOnline('netmenu'); Sfx.play('menu'); }
}

// versus: the players on each side
function lobbySides() {
  const n = [0, 0];
  for (const pl of Net.players) if (pl) n[pl.f === 'red' ? 1 : 0]++;
  return n;
}

// the lobby's player list: two columns (co-op: the first four players on
// the left, the rest on the right; versus: black left, red right), the empty
// places dimmed. Four rows of 10 px under the big room code -- or, versus
// with more than four a side, up to eight rows of 8 px under a smaller one
const LOBBY_COL = [10, 166];
function lobbyLayout() {
  const rows = Net.mode === 'versus' ? Math.max(1, Math.min(8, Math.ceil(Net.max / 2))) : 4;
  return rows > 4 ? { rows, y: 82, dy: 8, compact: true } : { rows, y: 104, dy: 10, compact: false };
}
function lobbyPlaces() {
  const vs = Net.mode === 'versus';
  const { rows, y: y0, dy } = lobbyLayout();
  const out = [];
  const fill = [0, 0];
  Net.players.forEach((pl, i) => {
    if (!pl) return;
    const c = vs ? (pl.f === 'red' ? 1 : 0) : Math.min(1, Math.floor(fill[0] / rows));
    const r = vs ? fill[c]++ : fill[0]++ % rows;
    if (r < rows) out.push({ pl, i, x: LOBBY_COL[c], y: y0 + r * dy });
  });
  return out;
}

function drawLobby() {
  if (G.help) { drawHelp(); return; }
  const vs = Net.mode === 'versus';
  // (the title: the mode and the year's length)
  netBackdrop(L('ui_lobbyTitle', L(vs ? 'ui_modeVersus' : 'ui_modeCoop'), lenName(Net.len)));
  const lay = lobbyLayout(), rows = lay.rows;
  // (compact: the room code at half size, no line under it)
  drawTextC(ctx, L('ui_roomCode'), VIEW_W / 2, lay.compact ? 30 : 32, '#b09060');
  drawTextCS(ctx, Net.code || '----', VIEW_W / 2, lay.compact ? 39 : 42, '#ffe040', lay.compact ? 2 : 4);
  if (!lay.compact) drawTextC(ctx, L('ui_shareCode'), VIEW_W / 2, 72, '#806e58');
  // (the head count and public/private on one line)
  const n = Net.players.filter(Boolean).length;
  const pc = L('ui_lobbyPlayers', n, Net.max), pv = L(Net.pub ? 'ui_lobbyPub' : 'ui_lobbyPriv');
  const px = Math.round(VIEW_W / 2 - (textWidth(pc) + 18 + textWidth(pv)) / 2);
  const py = lay.compact ? 58 : 82;
  drawText(ctx, pc, px, py, '#c8b890');
  drawText(ctx, pv, px + textWidth(pc) + 18, py, Net.pub ? '#a8e8a0' : '#a09070');
  // versus: a heading over each side's column
  const side = vs ? lobbySides() : null;
  const sideMax = vs ? rows : 0;
  if (vs) {
    drawTextC(ctx, L('ui_black') + ' ' + side[0] + '/' + sideMax, LOBBY_COL[0] + 73, lay.y - 11, '#d8d4e4');
    drawTextC(ctx, L('ui_red') + ' ' + side[1] + '/' + sideMax, LOBBY_COL[1] + 73, lay.y - 11, '#ff7060');
  }
  // the empty places, then the players
  for (let c = 0; c < 2; c++) {
    const have = vs ? side[c] : Math.max(0, Math.min(rows, n - c * rows));
    const room = vs ? sideMax : Math.max(0, Math.min(rows, Net.max - c * rows));
    for (let r = have; r < room; r++) {
      const x = LOBBY_COL[c], y = lay.y + r * lay.dy;
      ctx.fillStyle = '#2a1e14';
      ctx.fillRect(x + 1, y - 1, 9, 9);
      ctx.fillStyle = '#0c0805';
      ctx.fillRect(x + 2, y, 7, 7);
    }
  }
  const host = Net.you === Net.host && Net.roomState === 'lobby';
  for (const { pl, i, x, y } of lobbyPlaces()) {
    const col = PLAYER_COLORS[(pl.h !== undefined && pl.h !== null ? pl.h : i) % PLAYER_COLORS.length];
    // (the host's cursor, for a kick)
    if (host && i === G.lobbySel && i !== Net.you) drawText(ctx, '\x06', x - 9, y, '#ffe040');
    ctx.fillStyle = '#000000';
    ctx.fillRect(x + 1, y - 1, 9, 9);
    ctx.fillStyle = pl.on ? col : '#4a3826';
    ctx.fillRect(x + 2, y, 7, 7);
    drawText(ctx, pl.n, x + 14, y, pl.on ? col : '#706050');
    // (short tags, right-aligned in the column; an offline player is dimmed)
    const tags = [];
    if (i === Net.host) tags.push(L('ui_host'));
    if (i === Net.you) tags.push(L('ui_you'));
    if (!pl.on) tags.push(L('ui_offline'));
    const tg = tags.join(' ');
    if (tg) drawText(ctx, tg, x + 146 - textWidth(tg), y, !pl.on ? '#806e58' : '#a09070');
    // (its preferred job, an icon left of the tags -- versus, our side's only)
    if (JOB_ICON[pl.j]) drawText(ctx, JOB_ICON[pl.j], x + 146 - textWidth(tg) - (tg ? 10 : 4), y, pl.on ? JOB_COLOR[pl.j] : '#706050');
  }
  let note = Net.you === Net.host ? L('ui_hostStart') : L('ui_waitHost');
  if (Net.roomState === 'play') note = L('ui_inProgress');
  else if (vs && lobbySides().some(k => !k)) note = L('ui_needSides');
  const up = Net.status === 'open';
  // (a start refused for an empty side: the note itself flashes red)
  const warn = G.frame < G.sidesWarnT || Net.err === 'e_sides';
  drawTextC(ctx, note, VIEW_W / 2, 152, !up ? '#706050' : warn ? '#ff5040' : host && (G.frame >> 4) % 2 ? '#ffe040' : '#c8b890');
  const keys = [vs && Net.roomState === 'lobby' ? L('ui_sideKeys') : null, host ? L('ui_lobbyHostKeys') : null].filter(Boolean);
  keys.forEach((k, i) => drawTextC(ctx, k, VIEW_W / 2, 163 + i * 9, '#806e58'));
  const myPref = Net.players[Net.you] && Net.players[Net.you].j;
  // (a newcomer is offered LEARN TO ANT: on a free key line, else in turn
  // with the bottom line)
  const offer = lobbyOffer();
  if (offer) drawTextC(ctx, L('ui_learnOffer'), VIEW_W / 2, offer.y, (G.frame >> 4) % 2 ? '#c8f0c0' : '#a8e8a0');
  if (!offer || offer.y !== 182) drawTextC(ctx, L('ui_lobbyLeave', jobName(myPref)), VIEW_W / 2, 182, myPref ? '#a09070' : '#706050');
  if (Net.err !== 'e_sides') drawNetErr(144);
  if (Net.status === 'lost') drawNetLost();
}

// where the lobby offers LEARN TO ANT to a newcomer (who hasn't been
// through it): { y } -- the first free key line under the note, else the
// bottom line a third of the time -- or null
function lobbyOffer() {
  if (learnDone()) return null;
  const n = (Net.mode === 'versus' && Net.roomState === 'lobby' ? 1 : 0) + (Net.you === Net.host && Net.roomState === 'lobby' ? 1 : 0);
  if (n < 2) return { y: 163 + n * 9 };
  return G.frame % 360 >= 240 ? { y: 182 } : null;
}

function updateLobby() {
  Net.poll();
  if (G.state !== 'lobby') return;
  if (G.help) { helpKeys(); return; }
  if (tookPress('KeyH')) { openHelp(Net.mode === 'versus' ? 'versus' : 'coop'); Sfx.play('menu'); return; }
  // L: LEARN TO ANT first (the room is left)
  if (!learnDone() && tookPress('KeyL')) { leaveOnline('title'); openLearnMenu(); Sfx.play('select'); return; }
  if (tookPress('Escape')) { leaveOnline('netmenu'); Sfx.play('menu'); return; }
  if (Net.roomState !== 'lobby' || Net.status !== 'open') return;
  // J: the job we'd like (ANY, then each in turn; the match start honours it)
  if (tookAction('job')) {
    const cur = Net.players[Net.you] && Net.players[Net.you].j;
    const k = JOBS.indexOf(cur);
    Net.send({ t: 'jobpref', j: k + 1 < JOBS.length ? JOBS[k + 1] : 'any' });
    Sfx.play('menu');
  }
  // versus: pick a side
  if (Net.mode === 'versus') {
    const l = tookPress('ArrowLeft') || tookPress('KeyA'), r = tookPress('ArrowRight') || tookPress('KeyD');
    if (l || r) { Net.err = null; Net.send({ t: 'side', f: l ? 'black' : 'red' }); Sfx.play('menu'); }
  }
  if (Net.you !== Net.host) return;
  // the host: start, kick the selected player, public or private
  const n = Net.players.length;
  if (n) {
    if (tookPress('ArrowUp') || tookPress('KeyW')) { G.lobbySel = (G.lobbySel + n - 1) % n; Sfx.play('menu'); }
    if (tookPress('ArrowDown') || tookPress('KeyS')) { G.lobbySel = (G.lobbySel + 1) % n; Sfx.play('menu'); }
    G.lobbySel = Math.min(G.lobbySel, n - 1);
  }
  if (tookPress('KeyX') && G.lobbySel !== Net.you && Net.players[G.lobbySel]) {
    Net.send({ t: 'kick', idx: G.lobbySel });
    Sfx.play('kill');
  }
  if (tookPress('Tab')) { Net.send({ t: 'pub', on: !Net.pub }); Sfx.play('menu'); }
  if (tookPress('Enter')) {
    Net.err = null;
    if (Net.mode === 'versus' && lobbySides().some(k => !k)) { G.sidesWarnT = G.frame + 90; Sfx.play('menu'); return; }
    Net.send({ t: 'start' });
    Sfx.play('select');
  }
}

// leave the room (and the match), for the title or the online menu
function leaveOnline(state) {
  Net.leave();
  Coach.stop();
  G.online = false; G.running = false;
  G.takeover = null; G.objScreen = null; G.showMap = false; G.help = null;
  LOCAL = 0; G.colIdx = 0; G.mode = 'solo';
  G.rebornNote = null;
  G.state = state; G.menuSel = state === 'title' ? 1 : 0;
  if (state === 'networlds') {
    // (a fresh connection for the list; the menu under it is the online one)
    Net.list = null;
    Net.request({ t: 'list' });
    G.browseSel = 0;
  }
}

// ---- what net.js reports ------------------------------------------------------
function netOnLobby() {
  // (the lobby changed: a refusal shown for an older state of it is stale)
  if (G.state === 'lobby') Net.err = null;
  if (G.state === 'netwait' || G.state === 'lobby') G.state = Net.roomState === 'over' ? 'netwait' : 'lobby';
}

// a new world replaces the one being played (a persistent world started
// over): LOADING until its first snapshot, then netOnWorldReady
function netOnWorldSwap() {
  if (G.state !== 'play' && G.state !== 'pause') return;
  G.takeover = null; G.objScreen = null; G.showMap = false;
  G.state = 'netwait';
}

// the world and its first snapshot are in: play (or, back from a lost
// connection, carry on)
function netOnWorldReady(fresh) {
  const wasPlaying = G.online && (G.state === 'play' || G.state === 'pause');
  G.online = true;
  G.running = true;
  enterWorld('net');
  G.rebornNote = null;
  if (!wasPlaying) G.help = null;   // (the lobby's help, closed as the match starts)
  if (fresh && Net.reborn) {
    // our persistent world started over (its colony lost): no welcome, no
    // tutorial again -- JOIN THE COLONY says what happened, the sim's
    // messages (why, then the new colony) follow once an ant is picked
    const h = G.history[G.history.length - 1];
    G.rebornNote = { gen: G.gen, reason: h && h.reason === 'r_queen' ? 'r_queen' : 'r_extinct' };
  } else if (fresh) {
    Tut.start(true);
    // the first few matches online: tips for the job instead of the spring
    // hints (learn.js); after LEARN TO ANT no spring hints either
    Coach.start();
    if (Coach.on) Tut.step = TUT_STEPS.length;
    if (G.mode === 'versus') {
      // (no tutorial in versus: both sides know the game)
      Tut.step = TUT_STEPS.length;
      pushMsg(L(G.colIdx ? 'm_vsRed' : 'm_vsBlack'), G.colIdx ? '#ff7060' : '#d8d4e4');
    } else if (G.mode === 'world') {
      pushMsg(L('m_worldWelcome', Net.worldName || '', G.gen, G.year), '#80ff80');
    } else {
      pushMsg(Ln('m_coopStart', Net.players.filter(Boolean).length), '#80ff80');
    }
    if (!Tut.active()) pushMsg(L('m_objHint'), '#ffd890');
    pushMsg(L('m_helpHint'), '#ffd890');
  }
  if (!wasPlaying) { G.state = 'play'; Sfx.play('select'); }
}

function netOnError(key) {
  Net.err = key;
  const t = Net.intent && Net.intent.t;
  if (G.state === 'netwait') {
    // (back where the attempt came from: the world list, the open matches,
    // the code, the menu)
    const from = Net.list && t === 'enter' ? 'networlds' : Net.list && t === 'join' ? 'netopen' : null;
    G.state = from || (['e_noRoom', 'e_full', 'e_over'].includes(key) ? 'netjoin' : 'netmenu');
    // (the menu's cursor on the item that failed)
    G.menuSel = t === 'create' ? 1 : t === 'join' ? 2 : 0;
  } else if (G.state === 'lobby') {
    // (a refused side or start: the lobby stays, with the reason)
    if (!['e_sides', 'e_sideFull', 'e_notHost', 'e_busy', 'e_started'].includes(key)) { G.state = 'netmenu'; G.menuSel = 0; }
  } else if (G.online) {
    pushMsg(errText(key), '#ff5040');
  }
}

// the room is gone (closed, crashed, our place lost): to the online menu --
// unless the end screen is up, which stays
function netOnClosed(key) {
  Net.err = key;
  if (G.state === 'gameover' && G.online) return;
  if (['play', 'pause', 'lobby', 'netwait'].includes(G.state)) {
    G.online = false; G.running = false;
    G.takeover = null; G.objScreen = null; G.showMap = false;
    LOCAL = 0; G.colIdx = 0; G.mode = 'solo';
    G.state = 'netmenu'; G.menuSel = 0;
  }
}

// the match is over: everyone gets the year's end screen (versus: each
// side its own victory or defeat)
function netOnOver(over) {
  // (online even when no world came first: a reload after the end)
  G.online = true;
  G.over = over;
  G.gameOverStats = over;
  G.overSel = 0; G.overPage = 0;
  G.takeover = null; G.objScreen = null; G.showMap = false;
  G.state = 'gameover';
  const won = over && (over.versus ? over.winner === (Net.faction === 'red' ? 1 : 0) : over.win);
  Sfx.play(won ? 'task' : 'die');
}

// ---------------------------------------------------------------------------
// global toggles + loop
// ---------------------------------------------------------------------------
function globalKeys() {
  if (G.state === 'netname' || G.state === 'netjoin') return;   // (letters are being typed)
  // (V: C switches ants in play, and a key that means two things by screen
  // flipped the filter from overlays and menus)
  if (tookPress('KeyV')) document.getElementById('crt').classList.toggle('off');
  if (tookPress('KeyN')) {
    const m = Sfx.toggleMute();
    if (G.state === 'play') pushMsg(L('m_sound', L(m ? 'w_off' : 'w_on')), '#80c0ff');
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
    if (Logo.active()) Logo.step(pressed);
    // while the logo's ants are still uncovering the title, keys only skip them
    if (!Logo.blocking()) {
      globalKeys();
      switch (G.state) {
        case 'title': updateTitle(); break;
        case 'slots': updateSlots(); break;
        case 'loading': updateLoading(); break;
        case 'intro': updateIntro(); break;
        case 'help': updateHelp(); break;
        case 'play': updatePlay(); break;
        case 'pause': updatePause(); break;
        case 'gameover': updateGameOver(); break;
        case 'netname': updateNetName(); break;
        case 'netmenu': updateNetMenu(); break;
        case 'networlds': updateNetWorlds(); break;
        case 'netopen': updateNetOpen(); break;
        case 'netcreate': updateNetCreate(); break;
        case 'netjoin': updateNetJoin(); break;
        case 'netwait': updateNetWait(); break;
        case 'lobby': updateLobby(); break;
        case 'learnmenu': updateLearnMenu(); break;
        case 'learnend': updateLearnEnd(); break;
      }
    }
    // clear one-shot presses each sim step
    for (const k in pressed) pressed[k] = false;
    typed.length = 0;
  }

  G.frame++;
  switch (G.state) {
    case 'title': drawTitle(); break;
    case 'slots': drawSlots(); break;
    case 'loading': drawLoading(); break;
    case 'intro': drawIntro(); break;
    case 'help': drawHelp(); break;
    case 'play': drawPlay(); break;
    case 'pause': drawPause(); break;
    case 'gameover': drawGameOver(); break;
    case 'netname': drawNetName(); break;
    case 'netmenu': drawNetMenu(); break;
    case 'networlds': drawNetWorlds(); break;
    case 'netopen': drawNetOpen(); break;
    case 'netcreate': drawNetCreate(); break;
    case 'netjoin': drawNetJoin(); break;
    case 'netwait': drawNetWait(); break;
    case 'lobby': drawLobby(); break;
    case 'learnmenu': drawLearnMenu(); break;
    case 'learnend': drawLearnEnd(); break;
  }
  if (Logo.active()) Logo.draw(ctx);
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
  if (G.running && !G.online && !Learn.on) saveWorld(G.slot);
});

// a reload in the middle of an online match: back into it, if the server
// still keeps our place
{
  const s = Net.savedSession();
  if (s) { Net.resumeSaved(s); G.state = 'netwait'; }
}

// the opening logo first (not when a reload is getting back into a match),
// then the loop; keys pressed to skip the logo must not reach the title menu
function startLoop() {
  for (const k in pressed) pressed[k] = false;
  typed.length = 0;
  requestAnimationFrame(frame);
}
if (G.state === 'netwait') startLoop();
else Logo.play(document.getElementById('game')).then(startLoop, startLoop);