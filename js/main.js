// MAUR -- client: input, simulation events, camera, rendering, menus. The
// simulation itself lives in game.js; this file only feeds it the local
// player's input and draws what it reports.
'use strict';

const VIEW_W = 320, VIEW_H = 200, HUD_H = 24;

// the local player's slot in G.players (always 0 offline)
const LOCAL = 0;

// key bindings (KeyboardEvent.code); each action accepts any of its keys
const BIND = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  bite: ['Space'], act: ['KeyE'], abil: ['KeyQ'], swap: ['Tab'],
  build: ['KeyF'], buildMat: ['KeyR'], mark: ['KeyX'], obj: ['KeyO'],
};

// client-side state, layered onto the simulation's G
Object.assign(G, {
  state: 'title',     // title | slots | intro | help | play | pause | gameover
  slot: 1,
  msgs: [],           // on-screen messages { text, color, t }
  takeover: null,     // ant-selection overlay { types, sel, refX, refY, live }
  objScreen: null,    // objectives / upgrades overlay { page, sel } (O)
  flyers: [],         // princesses on their nuptial flight (animation only)
  flightCam: null,    // the camera watches the entrance during the flight { x, y, t }
  overSel: 0,         // end screen menu
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
});

function localAnt() {
  const p = G.players[LOCAL];
  return p && p.ant && p.ant.hp > 0 ? p.ant : null;
}

function pushMsg(text, color) {
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
    if (e.t === 'msg') {
      if (e.to < 0 || e.to === LOCAL) pushMsg(msgText(e), e.color);
    } else if (e.t === 'sfx') {
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
function held(action) { return BIND[action].some(k => keys[k]); }
function tookAction(action) {
  let hit = false;
  for (const k of BIND[action]) if (tookPress(k)) hit = true;
  return hit;
}

// copy the keyboard into the local player's input for this tick
function readInput() {
  const inp = G.players[LOCAL].input;
  inp.dx = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  inp.dy = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
  inp.bite = held('bite');
  inp.build = held('build');
  if (tookAction('act')) inp.act = true;
  if (tookAction('abil')) inp.abil = true;
  if (tookAction('buildMat')) inp.buildMat = true;
  if (tookAction('mark')) inp.mark = true;
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
  TerrainView.build();
  G.stars = [];
  const srng = mulberry32(G.seed ^ 0x5747);
  for (let i = 0; i < 140; i++) G.stars.push({ x: srng() * WORLD_W, y: srng() * 280 });
  G.msgs = []; G.takeover = null; G.objScreen = null;
  G.flyers = []; G.flightCam = null;
  Particles.list = [];
  G.autosaveT = 7200;
  const a = localAnt();
  G.cam = { x: a ? a.x - VIEW_W / 2 : 0, y: a ? a.y - 60 : 0 };
}

function startNewWorld(slot) {
  newWorld((Math.random() * 0xFFFFFFFF) >>> 0, 1);
  enterWorld(slot);
}

function startSavedWorld(slot) {
  const d = loadWorldData(slot);
  if (!d || !restoreWorld(d, 1)) return false;
  enterWorld(slot);
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
  if (G.takeover) { updateTakeover(); clearInput(); }
  else if (G.objScreen) { clearInput(); updateObjScreen(); }
  else if (tookAction('obj')) {
    G.objScreen = { page: 0, sel: 0 };
    Sfx.play('menu');
    clearInput();
  } else if (tookAction('swap') && localAnt()) {
    const a = localAnt();
    if (!openTakeover(a.x, a.y, true)) pushMsg(L('m_noSwitch'), '#ff8040');
    clearInput();
  } else {
    readInput();
  }

  stepSim();
  drainEvents();
  Particles.update();
  if (G.flyers.length) updateFlyers();

  // messages
  for (const m of G.msgs) m.t--;
  G.msgs = G.msgs.filter(m => m.t > 0);

  updateCamera();

  if (G.over) { endWorld(); return; }

  // dead: offer another body
  const me = G.players[LOCAL];
  if (!localAnt() && !G.takeover) {
    const ref = me.deathPos || G.colony.entrance;
    openTakeover(ref.x, ref.y, false);
  }

  // autosave
  G.autosaveT--;
  if (G.autosaveT <= 0) {
    G.autosaveT = 7200;
    if (saveWorld(G.slot)) { pushMsg(L('m_saved'), '#80c0ff'); Sfx.play('save'); }
  }

  if (tookPress('KeyM')) G.showMap = !G.showMap;
  if (tookPress('Escape') || tookPress('KeyP')) {
    if (G.takeover && G.takeover.live) { G.takeover = null; Sfx.play('menu'); }
    else { G.state = 'pause'; G.menuSel = 0; Sfx.play('menu'); }
  }
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
  const a = localAnt();
  if (!a) return;
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
  p.look += (a.dir * 24 - p.look) * 0.03;
  const tx = p.fx - v.vw / 2 + p.look;
  const ty = p.fy - v.vh / 2 - 8;
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
  const types = takeoverOptions();
  if (types.length === 0) return false;
  G.takeover = { types, sel: 0, refX, refY, live };
  Sfx.play('menu');
  return true;
}

function updateTakeover() {
  const tk = G.takeover;
  // refresh against ants that died (or got taken) while the menu was open
  tk.types = takeoverOptions();
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
    if (takeOver(LOCAL, tk.types[tk.sel].caste, tk.refX, tk.refY)) {
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
function updateObjScreen() {
  const os = G.objScreen;
  if (tookAction('obj') || tookPress('Escape')) { G.objScreen = null; Sfx.play('menu'); return; }
  if (tookPress('ArrowLeft') || tookPress('KeyA') || tookPress('ArrowRight') || tookPress('KeyD')) {
    os.page = 1 - os.page;
    Sfx.play('menu');
  }
  if (os.page !== 1) return;
  const n = UPGRADE_IDS.length;
  if (tookPress('ArrowUp') || tookPress('KeyW')) { os.sel = (os.sel + n - 1) % n; Sfx.play('menu'); }
  if (tookPress('ArrowDown') || tookPress('KeyS')) { os.sel = (os.sel + 1) % n; Sfx.play('menu'); }
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
  // the world runs on under the panel: a hurt (or freezing) ant flashes it red
  const me = localAnt();
  if (me && me.flash > 0) {
    ctx.fillStyle = '#e03020';
    ctx.fillRect(8, 18, 304, 158);
  }
  bevelPanel(10, 20, 300, 154);
  const title = os.page === 0 ? L('ui_objectives') : L('ui_upgrades');
  drawTextCS(ctx, title, VIEW_W / 2, 26, '#ffa040');
  drawText(ctx, '<', 18, 26, (G.frame >> 4) % 2 ? '#ffe040' : '#a09070');
  drawText(ctx, '>', 297, 26, (G.frame >> 4) % 2 ? '#ffe040' : '#a09070');
  drawText(ctx, (os.page + 1) + '/2', 270, 26, '#706050');

  if (os.page === 0) {
    const s = G.season;
    drawText(ctx, SEASON_ICON[s] + ' ' + L('ui_seasonYear', seasonName(s), G.year), 20, 40, SEASON_COLOR[s]);
    const left = SEASON_DAYS - G.seasonDay;
    const ls = left <= 1 ? L('ui_lastDay') : L('ui_daysLeft', left);
    drawText(ctx, ls, 300 - textWidth(ls), 40, '#c8b890');
    let y = 56;
    for (const o of G.objectives.list) {
      const def = objDef(o.id);
      drawText(ctx, o.done ? '\x19' : '-', 20, y, o.done ? '#80ff80' : '#a09070');
      drawText(ctx, objName(o), 30, y, o.done ? '#80ff80' : '#e8e0c8');
      const pr = objProgress(o);
      drawText(ctx, pr, 300 - textWidth(pr), y, o.done ? '#80ff80' : '#ffe080');
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
      y += 14;
    }
    y = Math.max(y, 108);
    drawText(ctx, L('ui_mound', col.mound.size), 20, y, '#d8b860');
    const seal = col.sealed ? L('ui_sealed') : L('ui_open');
    drawText(ctx, seal, 300 - textWidth(seal), y, col.sealed ? '#80ff80' : '#ff9040');
    drawText(ctx, L('ui_crystals', col.crystals), 20, y + 12, '#80e0ff');
    const ms = L('ui_milestones', G.objectives.yearDone);
    drawText(ctx, ms, 300 - textWidth(ms), y + 12, '#ffe040');
    // the next flight: this spring's if it hasn't flown yet, else next year's
    const flightYear = G.season === SPRING && G.year >= 2 && G.lastFlightYear < G.year ? G.year : G.year + 1;
    drawTextC(ctx, L('ui_yearGoal', flightYear), VIEW_W / 2, y + 28, '#ff90e0');
    drawTextC(ctx, L('ui_objKeys'), VIEW_W / 2, 162, '#a09070');
  } else {
    drawText(ctx, '\x13 ' + L('ui_crystals', col.crystals), 20, 40, '#80e0ff');
    for (let i = 0; i < UPGRADE_IDS.length; i++) {
      const id = UPGRADE_IDS[i];
      const y = 58 + i * 16;
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
      drawText(ctx, cs, 300 - textWidth(cs), y,
        cost === Infinity ? '#80ff80' : cost <= col.crystals ? '#80e0ff' : '#806e58');
    }
    drawTextC(ctx, L('upd_' + UPGRADE_IDS[os.sel]), VIEW_W / 2, 128, '#c8b890');
    drawTextC(ctx, L('ui_upgKeys'), VIEW_W / 2, 162, '#a09070');
  }
  // the newest message (a purchase, a refusal, the cold) would hide under
  // the panel: a status line shows it here
  const m = G.msgs[G.msgs.length - 1];
  if (m) {
    ctx.globalAlpha = Math.min(1, m.t / 60);
    drawTextC(ctx, m.text, VIEW_W / 2, 150, m.color);
    ctx.globalAlpha = 1;
  }
}

// milestones whose goal is food in the stores
const FOOD_GOALS = ['food100', 'stockpile'];

// a milestone's name, with its (yearly growing) target
function objName(o) { return L('o_' + o.id, o.need); }

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
    // the herd grazing (huddled and still in winter)
    for (const o of [-6, -1, 4, 8]) {
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

  Particles.draw(ctx, camx, camy);
  if (G.flyers.length) drawFlyers(camx, camy);

  // while building, show where the stamp will land (a red x: nowhere)
  const pl = G.players[LOCAL];
  if (me && pl && pl.input.build) {
    const aim = buildAim(me, pl.input.dx, pl.input.dy);
    if (aim) {
      const ex = Math.round(aim.bx - camx), ey = Math.round(aim.by - camy);
      ctx.fillStyle = (G.frame >> 3) % 2 ? '#ffe040' : '#fff8c0';
      ctx.fillRect(ex - 2, ey, 1, 1); ctx.fillRect(ex + 2, ey, 1, 1);
      ctx.fillRect(ex, ey - 2, 1, 1); ctx.fillRect(ex, ey + 2, 1, 1);
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
    if (me) {
      drawChamberLabels(camx, camy, me, markCh);
      drawShelterLabel(camx, camy, me);
    }
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// chamber markers: a little signpost on the chamber floor
// ---------------------------------------------------------------------------
const CH_LOOK = {
  storage:  { icon: '\x03', color: '#d8b878' },
  nursery:  { icon: '\x0E', color: '#efe9d8' },
  barracks: { icon: '\x12', color: '#e07050' },
  royal:    { icon: '\x11', color: '#ff90e0' },
  fungus:   { icon: '\x14', color: '#a8d4b2' },
};

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

// the name (and a cramped warning) of one sign: the one X would act on, or
// else the nearest near the player's ant. One label never overlaps another.
function drawChamberLabels(camx, camy, me, target) {
  let ch = target, bd = Infinity;
  if (!ch) {
    for (const c of G.colony.chambers) {
      if (Math.abs(c.x - me.x) > 70 || Math.abs(c.y - me.y) > 50) continue;
      const d = dist2(c.x, c.y, me.x, me.y);
      if (d < bd) { bd = d; ch = c; }
    }
  }
  if (!ch) return;
  const ex = Math.round(ch.x - camx), ey = Math.round(chamberFloor(ch) - camy);
  drawTextCS(ctx, L('ch_' + ch.type), ex, ey - 25, CH_LOOK[ch.type].color);
  if (chamberCramped(ch)) drawTextCS(ctx, L('w_cramped'), ex, ey - 34, '#ff5040');
}

// an aphid shelter near the player's ant: its name, and whether it sleeps
// (winter) or is short of thatch (it falls apart below half the need)
function drawShelterLabel(camx, camy, me) {
  const col = G.colony;
  const sh = col.shelters.find(s => Math.abs(s.x - me.x) < 60 && Math.abs(s.y - me.y) < 40);
  if (!sh) return;
  const ex = Math.round(sh.x - 12 - camx), ey = Math.round(sh.y - camy);
  drawTextCS(ctx, L('ui_shelter'), ex, ey - 24, '#8cc85a');
  if (col.thatchNear(sh.x, sh.y, SHELTER_R) < SHELTER_THATCH) {
    if ((G.frame >> 4) % 2) drawTextCS(ctx, L('ui_shelterWeak'), ex, ey - 33, '#ff5040');
  } else if (G.isWinter()) {
    drawTextCS(ctx, L('ui_shelterIdle'), ex, ey - 33, '#a0c0e0');
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

function drawHud() {
  const y = VIEW_H - HUD_H;
  bevelPanel(0, y, VIEW_W, HUD_H);
  const col = G.colony;
  const caps = col.caps;

  // player panel: health, caste, carried item
  const me = localAnt();
  const pl = G.players[LOCAL];
  const px2 = 4;
  drawText(ctx, 'P1', px2, y + 4, '#ffe080');
  if (me) {
    // out in the winter cold: the bar frosts over (blinking)
    const freezing = G.isWinter() && !col.sheltered(me) && (G.frame >> 3) % 2;
    drawHpBar(px2 + 14, y + 5, 40, Math.max(0, me.hp / me.maxHp), freezing ? '#a0d8ff' : null);
    drawText(ctx, casteName(me.caste), px2 + 14, y + 14, '#b0a080');
    if (me.carry) {
      drawItem(ctx, { kind: me.carry.kind, x: 0, y: 0 },
        -(px2 + 62), -(y + 8));
    }
    // building loads: soil above (packed earth and gates), thatch below
    const thatchSel = pl.buildMat === M_THATCH;
    drawText(ctx, '\x0F', 74, y + 4, thatchSel ? '#806040' : '#c08850');
    drawLoadBar(81, y + 5, 28, me.soil / LOAD_CAP, '#a06a3c', !thatchSel);
    drawText(ctx, '\x10', 74, y + 14, thatchSel ? '#e8c870' : '#a08848');
    drawLoadBar(81, y + 15, 28, me.thatch / LOAD_CAP, '#d8b860', thatchSel);
  } else {
    drawText(ctx, L('w_dead'), px2 + 14, y + 5, '#e03020');
  }

  // colony: ants and brood against capacity, food against the stores
  const ants = G.ants.filter(a => a.hp > 0).length;
  const brood = G.brood.length;
  const food = Math.floor(col.food);
  // the queen stops laying once adults + brood fill the room: warn on that
  drawText(ctx, '\x02' + ants + '/' + caps.pop, 116, y + 4,
    ants + brood >= caps.pop ? '#ff9040' : '#e8c8a0');
  drawText(ctx, '\x0E' + brood + '/' + caps.brood, 116, y + 14, brood >= caps.brood ? '#ff9040' : '#d0c8b0');
  drawText(ctx, '\x03' + food + '/' + caps.food, 162, y + 4, food >= caps.food ? '#ff9040' : '#d8b878');
  drawText(ctx, L('w_score') + ' ' + col.score, 162, y + 14, '#a0c8a0');
  drawText(ctx, SEASON_ICON[G.season] + L('ui_seasonDay', seasonName(G.season), G.seasonDay + 1), 234, y + 4,
    G.isNight() ? '#9090b8' : SEASON_COLOR[G.season]);
  if (me) drawText(ctx, L(buildMatKey(pl.buildMat)), 234, y + 14, '#a09070');
}

function drawTaskAndMsgs() {
  // current task, top left
  let ty = 3;
  const t = G.colony.tasks.find(t => !t.done) || G.colony.tasks.find(t => t.done && t.doneT > 0);
  if (t) {
    let str;
    if (t.done) str = L('m_complete', taskText(t));
    else if (t.type === 'dig') str = taskText(t) + ' ' + Math.floor(t.n) + '/' + t.need;
    else str = taskText(t) + ' ' + t.n + '/' + t.need;
    const blink = t.done && (G.tick >> 3) % 2;
    if (!blink) drawTextS(ctx, str, 4, ty, t.done ? '#ffe040' : '#a8e8a0');
    ty += 10;
  }
  // the season's next milestone, one line (O shows them all)
  // crystals, top right
  const cs = '\x13' + G.colony.crystals;
  drawTextS(ctx, cs, VIEW_W - 5 - textWidth(cs), 3, '#80e0ff');
  const o = G.objectives && G.objectives.list.find(o => !o.done);
  if (o) {
    // with the key that opens the full list, where it fits
    let str = '\x06' + objName(o) + ' ' + objProgress(o);
    if (4 + textWidth(str + ' (O)') < VIEW_W - 12 - textWidth(cs)) str += ' (O)';
    drawTextS(ctx, str, 4, ty, '#ffd890');
  }

  // messages
  let my = 24;
  for (const m of G.msgs) {
    ctx.globalAlpha = Math.min(1, m.t / 60);
    drawTextCS(ctx, m.text, VIEW_W / 2, my, m.color);
    ctx.globalAlpha = 1;
    my += 10;
  }
}

function drawMinimap() {
  const mw = 296, mh = Math.round(mw * WORLD_H / WORLD_W);
  const mx = (VIEW_W - mw) / 2, my = (VIEW_H - mh) / 2 - 6;
  bevelPanel(mx - 3, my - 3, mw + 6, mh + 6);
  ctx.fillStyle = '#101418';
  ctx.fillRect(mx, my, mw, mh);
  ctx.drawImage(TerrainView.bgCan, 0, 0, WORLD_W, WORLD_H, mx, my, mw, mh);
  ctx.drawImage(TerrainView.terCan, 0, 0, WORLD_W, WORLD_H, mx, my, mw, mh);
  const sx = mw / WORLD_W, sy = mh / WORLD_H;
  // chamber markers in their type colors (cramped ones blink), under the ants
  for (const ch of G.colony.chambers) {
    const cx = Math.round(mx + ch.x * sx), cy = Math.round(my + ch.y * sy);
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
    ctx.fillStyle = chamberCramped(ch) && (G.frame >> 4) % 2 ? '#ff4030' : CH_LOOK[ch.type].color;
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
  }
  // aphid shelters: green dots
  for (const sh of G.colony.shelters) {
    const cx = Math.round(mx + sh.x * sx), cy = Math.round(my + sh.y * sy);
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
    ctx.fillStyle = '#8cc85a';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
  }
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
  drawTextCS(ctx, L('ui_tagline'), VIEW_W / 2, ly + 50, '#b09060');

  // menu
  const items = [L('ui_start'), L('ui_help'),
    L('ui_sound', L(Sfx.muted ? 'w_off' : 'w_on')),
    L('ui_crt', L(document.getElementById('crt').classList.contains('off') ? 'w_off' : 'w_on')),
    L('ui_lang')];
  const my = 112;
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
  if (menuNav(5)) {
    Sfx.play('select');
    switch (G.menuSel) {
      case 0: G.state = 'slots'; G.slotSel = 0; G.eraseArm = -1; break;
      case 1: G.prevState = 'title'; G.state = 'help'; break;
      case 2: Sfx.toggleMute(); break;
      case 3: document.getElementById('crt').classList.toggle('off'); break;
      case 4: setLang(LANG === 0); break;
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
      drawText(ctx, L('w_day') + ' ' + (info.day + 1) + '  \x02' + info.ants + '  \x03' + info.food + '  ' + L('w_score') + ' ' + info.score,
        48, sy + 10, '#a09070');
      if (G.eraseArm === i) drawText(ctx, L('ui_eraseArm'), 180, sy, '#ff5040');
    } else {
      drawText(ctx, L('ui_empty'), 48, sy + 10, '#706050');
    }
  }
  drawTextC(ctx, L('ui_slotKeys'), VIEW_W / 2, 164, '#b0a080');
  drawTextC(ctx, L('ui_slotKeys2'), VIEW_W / 2, 176, '#706050');
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
  if (tookPress('Enter') || tookPress('Space')) {
    Sfx.play('select');
    const slot = G.slotSel + 1;
    if (slotInfo(slot) && startSavedWorld(slot)) {
      G.state = 'play'; pushMsg(L('m_welcome'));
    } else {
      // empty slot, or a save from an incompatible world size: start fresh
      startNewWorld(slot);
      G.state = 'intro';
      G.introLine = 0;
    }
  }
}

function drawIntro() {
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const lines = introText();
  G.introLine += 0.4;
  const shown = Math.min(lines.length, Math.floor(G.introLine / 6) + 1);
  let y = 30;
  for (let i = 0; i < shown; i++) {
    drawTextC(ctx, lines[i], VIEW_W / 2, y, i === lines.length - 1 ? '#ffa040' : '#c8b890');
    y += 11;
  }
  if (shown >= lines.length && (G.frame >> 4) % 2 === 0) {
    drawTextC(ctx, L('ui_pressSpace'), VIEW_W / 2, 182, '#ffe040');
  }
}

function updateIntro() {
  if (tookPress('Space') || tookPress('Enter')) {
    G.state = 'play';
    pushMsg(L('m_gather'), '#80ff80');
    pushMsg(L('m_objHint'), '#ffd890');
    Sfx.play('select');
  }
}

function drawHelp() {
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawTextCS(ctx, L('ui_howto'), VIEW_W / 2, 12, '#ffa040', 2);
  let y = 32;
  for (const [line, color] of helpText()) {
    if (line) drawText(ctx, line, 24, y, color);
    y += 10;
  }
  drawTextC(ctx, L('ui_escBack'), VIEW_W / 2, 186, '#706050');
}

function updateHelp() {
  if (tookPress('Escape') || tookPress('Enter') || tookPress('Space')) {
    G.state = G.prevState === 'pause' ? 'pause' : G.prevState;
    Sfx.play('menu');
  }
}

function pauseItems() {
  const items = [
    { id: 'resume', label: L('ui_resume') },
    { id: 'save', label: L('ui_saveGame') },
    { id: 'help', label: L('ui_help') },
  ];
  items.push({ id: 'quit', label: L('ui_saveQuit') });
  return items;
}

function drawPause() {
  drawPlay();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const items = pauseItems();
  bevelPanel(90, 56, 140, 32 + items.length * 12);
  drawTextCS(ctx, L('ui_paused'), VIEW_W / 2, 64, '#ffa040', 2);
  for (let i = 0; i < items.length; i++) {
    const sel = i === G.menuSel;
    if (sel) drawText(ctx, '\x06', 100, 88 + i * 12, '#ffe040');
    drawText(ctx, items[i].label, 112, 88 + i * 12, sel ? '#ffe040' : '#c8b890');
  }
}

function updatePause() {
  if (tookPress('Escape')) { G.state = 'play'; return; }
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
        G.prevState = 'pause'; G.state = 'help';
        break;
      case 'quit':
        saveWorld(G.slot);
        G.running = false;
        G.state = 'title'; G.menuSel = 0;
        break;
    }
  }
}

function drawTakeover() {
  const tk = G.takeover;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  bevelPanel(70, 30, 180, 140);
  const pcol = '#ffe080';
  if (tk.live) {
    drawTextCS(ctx, L('ui_switchAnt'), VIEW_W / 2, 38, pcol, 2);
    drawTextC(ctx, L('ui_lendLegs'), VIEW_W / 2, 58, '#c8b890');
  } else {
    drawTextCS(ctx, L('ui_youDied'), VIEW_W / 2, 38, '#ff5040', 2);
    drawTextC(ctx, L('ui_colonyLives'), VIEW_W / 2, 58, '#c8b890');
  }
  drawTextC(ctx, L('ui_continueAs'), VIEW_W / 2, 70, pcol);
  for (let i = 0; i < tk.types.length; i++) {
    const t = tk.types[i];
    const sel = i === tk.sel;
    const label = casteName(t.caste) + '  X' + t.count;
    if (sel) drawText(ctx, '\x06', 92, 84 + i * 12, '#ffe040');
    drawText(ctx, label, 104, 84 + i * 12, sel ? '#ffe040' : '#c8b890');
  }
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

function drawGameOver() {
  ctx.fillStyle = '#0c0805';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const s = G.gameOverStats;
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
      [L(s.reason, s.flown), s.win ? '#ffd0f0' : '#c8b890'],
      [L('ui_milestones', s.milestones), '#ffe040'],
      [L('ui_colonySize', s.pop || 0), '#c8b890'],
      [L('ui_finalScore', s.score), '#ffe040'],
      [L('ui_foodGathered', Math.floor(s.stats.foodGathered)), '#a09070'],
      [L('ui_antsBorn', s.stats.antsBorn), '#a09070'],
    ];
    let y = 78;
    for (const [line, color] of lines) { drawTextC(ctx, line, VIEW_W / 2, y, color); y += 11; }
    const items = [L('ui_continue'), L('ui_toTitle')];
    for (let i = 0; i < items.length; i++) {
      const sel = i === G.overSel;
      const iy = 152 + i * 12;
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
      [L('ui_survived', s.day + 1), '#c8b890'],
      [L('ui_finalScore', s.score), '#ffe040'],
      [L('ui_milestones', s.milestones || 0), '#a09070'],
      [L('ui_foodGathered', Math.floor(s.stats.foodGathered)), '#a09070'],
      [L('ui_antsBorn', s.stats.antsBorn), '#a09070'],
      [L('ui_antsLost', s.stats.antsDied), '#a09070'],
      [L('ui_predSlain', s.stats.predatorsSlain), '#a09070'],
    ];
    let y = 64;
    for (const [line, color] of lines) { drawTextC(ctx, line, VIEW_W / 2, y, color); y += 12; }
  }
  if ((G.frame >> 4) % 2 === 0) drawTextC(ctx, L('ui_pressEnter'), VIEW_W / 2, 178, '#ffe040');
}

function updateGameOver() {
  const s = G.gameOverStats;
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
// global toggles + loop
// ---------------------------------------------------------------------------
function globalKeys() {
  if (tookPress('KeyC')) document.getElementById('crt').classList.toggle('off');
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
    globalKeys();
    switch (G.state) {
      case 'title': updateTitle(); break;
      case 'slots': updateSlots(); break;
      case 'intro': updateIntro(); break;
      case 'help': updateHelp(); break;
      case 'play': updatePlay(); break;
      case 'pause': updatePause(); break;
      case 'gameover': updateGameOver(); break;
    }
    // clear one-shot presses each sim step
    for (const k in pressed) pressed[k] = false;
  }

  G.frame++;
  switch (G.state) {
    case 'title': drawTitle(); break;
    case 'slots': drawSlots(); break;
    case 'intro': drawIntro(); break;
    case 'help': drawHelp(); break;
    case 'play': drawPlay(); break;
    case 'pause': drawPause(); break;
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