// MAUR -- seeded procedural world generation.
// One byte per world pixel, Liero-style.
'use strict';

const WORLD_W = 3072;
const WORLD_H = 1920;

// materials
const M_AIR = 0;
const M_DIRT = 1;   // diggable
const M_ROCK = 2;   // not diggable
const M_GRASS = 3;  // diggable
const M_WOOD = 4;   // not diggable (trunks, branches)
const M_LEAF = 5;   // diggable (bite through, sometimes drops food)
const M_ROOT = 6;   // diggable (tree roots -- chewy, so nobody gets trapped)
const M_FUNGUS = 7; // diggable (cave mushrooms -- hearty food, bite to harvest)
const M_CRYSTAL = 8;// diggable (buried crystals -- treasure for the colony)

function DIGGABLE(m) {
  return m === M_DIRT || m === M_GRASS || m === M_LEAF || m === M_ROOT ||
         m === M_FUNGUS || m === M_CRYSTAL;
}

// --- seeded rng -------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261;
  str = String(str);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// integer pixel hash, for per-pixel color jitter (deterministic, not rng-state)
function pxHash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// --- 1d value noise for the surface -----------------------------------------
function makeNoise1D(rng, cells) {
  const vals = new Float32Array(cells + 2);
  for (let i = 0; i < vals.length; i++) vals[i] = rng();
  return function (x) {
    const i = Math.floor(x), f = x - i;
    const a = vals[((i % cells) + cells) % cells];
    const b = vals[(((i + 1) % cells) + cells) % cells];
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  };
}

// --- world generation --------------------------------------------------------
// returns { m, surf, bgSurf, colony, trees }
function genWorld(seed) {
  const rng = mulberry32(seed);
  const m = new Uint8Array(WORLD_W * WORLD_H);
  const surf = new Int16Array(WORLD_W);    // final surface (with mound)
  const bgSurf = new Int16Array(WORLD_W);  // sky/cave boundary for background

  // -- surface heightmap: rolling forest floor around y=420
  const n1 = makeNoise1D(rng, 64), n2 = makeNoise1D(rng, 64), n3 = makeNoise1D(rng, 64);
  const BASE = 420;
  for (let x = 0; x < WORLD_W; x++) {
    let h = BASE;
    h += (n1(x / 220) - 0.5) * 130;
    h += (n2(x / 60) - 0.5) * 40;
    h += (n3(x / 14) - 0.5) * 8;
    surf[x] = Math.round(h);
  }

  // -- the colony mound, near the middle
  const colonyX = Math.floor(WORLD_W / 2 + (rng() - 0.5) * 300);
  const moundR = 70, moundH = 30;
  // flatten ground under the mound a bit, then raise the dome
  const baseY = surf[colonyX];
  for (let x = colonyX - moundR; x <= colonyX + moundR; x++) {
    if (x < 0 || x >= WORLD_W) continue;
    const dx = (x - colonyX) / moundR;
    const t = Math.abs(dx);
    const flat = baseY * (1 - t) + surf[x] * t;          // blend toward flat
    const dome = moundH * 0.5 * (Math.cos(Math.PI * dx) + 1); // raised dome
    surf[x] = Math.round(flat - dome);
  }

  // background boundary = surface BEFORE we count the mound as "sky-backed";
  // anything dug above this shows sky, below shows dark earth
  for (let x = 0; x < WORLD_W; x++) bgSurf[x] = surf[x] + 2;

  // -- fill dirt + grass skin
  for (let x = 0; x < WORLD_W; x++) {
    const s = surf[x];
    for (let y = Math.max(0, s); y < WORLD_H; y++) {
      m[y * WORLD_W + x] = (y < s + 3) ? M_GRASS : M_DIRT;
    }
    // bare dirt on the mound itself
    if (Math.abs(x - colonyX) < moundR * 0.8) {
      for (let y = Math.max(0, surf[x]); y < surf[x] + 3 && y < WORLD_H; y++) {
        m[y * WORLD_W + x] = M_DIRT;
      }
    }
    // grass blades poking up
    if (pxHash(x, 7) % 5 === 0 && Math.abs(x - colonyX) > moundR) {
      const bh = 1 + (pxHash(x, 13) % 4);
      for (let y = surf[x] - bh; y < surf[x]; y++) {
        if (y >= 0) m[y * WORLD_W + x] = M_GRASS;
      }
    }
  }

  // -- bedrock floor and side walls
  for (let x = 0; x < WORLD_W; x++) {
    for (let y = WORLD_H - 10; y < WORLD_H; y++) m[y * WORLD_W + x] = M_ROCK;
  }
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < 6; x++) {
      if (y > surf[x] - 4) m[y * WORLD_W + x] = M_ROCK;
      if (y > surf[WORLD_W - 1 - x] - 4) m[y * WORLD_W + (WORLD_W - 1 - x)] = M_ROCK;
    }
  }

  // -- rock blobs underground. Kept clear of the side walls: a blob fused
  // with the bedrock edge can seal an undiggable pocket you can't escape.
  const blobCount = 150;
  for (let i = 0; i < blobCount; i++) {
    const bx = 60 + Math.floor(rng() * (WORLD_W - 120));
    const by = Math.floor(surf[Math.min(WORLD_W - 1, Math.max(0, bx))] + 60 + rng() * (WORLD_H - surf[bx] - 120));
    const rx = 6 + rng() * 26, ry = 4 + rng() * 14;
    fillEllipse(m, bx, by, rx, ry, M_ROCK);
  }

  // -- natural caves: drunken walkers
  for (let i = 0; i < 55; i++) {
    let cx = rng() * WORLD_W;
    let cy = surf[Math.floor(Math.max(0, Math.min(WORLD_W - 1, cx)))] + 100 + rng() * 1000;
    let ang = rng() * Math.PI * 2;
    const steps = 60 + rng() * 160;
    for (let s = 0; s < steps; s++) {
      carveCircle(m, cx, cy, 3 + rng() * 3);
      ang += (rng() - 0.5) * 0.9;
      cx += Math.cos(ang) * 3;
      cy += Math.sin(ang) * 3 * 0.6 + 0.15; // slight downward drift
      if (cx < 12 || cx > WORLD_W - 12 || cy > WORLD_H - 16) break;
      if (cy < surf[Math.floor(Math.max(0, Math.min(WORLD_W - 1, cx)))] + 30) ang += 0.5;
    }
  }

  // -- the nest: entrance shaft, junction, chambers
  const entrance = { x: colonyX, y: surf[colonyX] + 1 };
  const junction = { x: colonyX + Math.round((rng() - 0.5) * 30), y: surf[colonyX] + 95 };
  const queenCh  = { x: colonyX + Math.round((rng() - 0.5) * 60), y: junction.y + 90 + Math.round(rng() * 30) };
  const storage  = { x: colonyX - 60 - Math.round(rng() * 40), y: junction.y + 30 + Math.round(rng() * 30) };
  const nursery  = { x: colonyX + 55 + Math.round(rng() * 40), y: junction.y + 45 + Math.round(rng() * 30) };

  // record carved centerlines: these become the ants' mental map of the nest
  const pEntr = [], pStor = [], pNurs = [], pQueen = [];
  carveTunnel(m, rng, entrance.x, entrance.y - 4, junction.x, junction.y, 4.5, pEntr);
  carveTunnel(m, rng, junction.x, junction.y, storage.x, storage.y, 4, pStor);
  carveTunnel(m, rng, junction.x, junction.y, nursery.x, nursery.y, 4, pNurs);
  carveTunnel(m, rng, junction.x, junction.y, queenCh.x, queenCh.y, 4, pQueen);
  pEntr.reverse(); // normalize all paths to run junction -> outer end

  fillEllipseCarve(m, junction.x, junction.y, 12, 8);
  fillEllipseCarve(m, storage.x, storage.y, 26, 13);
  fillEllipseCarve(m, nursery.x, nursery.y, 24, 12);
  fillEllipseCarve(m, queenCh.x, queenCh.y, 30, 15);

  // settle waypoints onto the local floor so ants can walk them;
  // points in vertical shafts (no floor nearby) stay centered for climbing
  for (const pts of [pEntr, pStor, pNurs, pQueen]) settlePath(m, pts);

  // -- trees, away from the mound; always one near each side of the colony
  const trees = [];
  const treeXs = [
    colonyX - 180 - Math.floor(rng() * 120),
    colonyX + 180 + Math.floor(rng() * 120),
  ];
  const treeCount = 10 + Math.floor(rng() * 5);
  for (let i = 0; i < treeCount; i++) {
    treeXs.push(Math.floor(40 + rng() * (WORLD_W - 80)));
  }
  for (const txc of treeXs) {
    const tx = Math.max(40, Math.min(WORLD_W - 40, txc));
    if (Math.abs(tx - colonyX) < 140) continue;
    if (trees.some(t => Math.abs(t.x - tx) < 110)) continue;
    trees.push(growTree(m, rng, tx, surf[tx]));
  }

  // -- underground riches (NOTE: must stay LAST -- saved games regenerate
  // the world from the seed and replay this exact rng sequence; new draws
  // added before this point would scramble colony and tree layout)

  // cave fungus: glowing mushroom clumps on cave floors, hearty food
  let shrooms = 0;
  for (let i = 0; i < 900 && shrooms < 80; i++) {
    const fx = 20 + Math.floor(rng() * (WORLD_W - 40));
    const fy = Math.floor(surf[fx] + 110 + rng() * (WORLD_H - surf[fx] - 220));
    if (m[fy * WORLD_W + fx] !== M_AIR) continue;
    let gy = fy; // drop to the cave floor
    while (gy < WORLD_H - 14 && m[(gy + 1) * WORLD_W + fx] === M_AIR) gy++;
    if (gy - fy > 30 || gy >= WORLD_H - 14) continue;
    if (m[(gy + 1) * WORLD_W + fx] !== M_DIRT) continue;
    const n = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const mx = Math.max(2, Math.min(WORLD_W - 3, fx + Math.floor((rng() - 0.5) * 12)));
      let my = gy - 6;
      while (my < WORLD_H - 14 && m[(my + 1) * WORLD_W + mx] === M_AIR) my++;
      if (m[(my + 1) * WORLD_W + mx] !== M_DIRT) continue;
      const h = 2 + Math.floor(rng() * 2);             // stem
      for (let y = my - h + 1; y <= my; y++) setPxIf(m, mx, y, M_FUNGUS, M_AIR);
      const cw = 1 + Math.floor(rng() * 2);            // cap
      for (let x = mx - cw; x <= mx + cw; x++) setPxIf(m, x, my - h, M_FUNGUS, M_AIR);
      for (let x = mx - (cw - 1); x <= mx + (cw - 1); x++) setPxIf(m, x, my - h - 1, M_FUNGUS, M_AIR);
    }
    shrooms++;
  }

  // crystal pockets: small veins in the deep dirt, worth real score
  let veins = 0;
  for (let i = 0; i < 400 && veins < 22; i++) {
    const cx = 40 + Math.floor(rng() * (WORLD_W - 80));
    const cy = Math.floor(surf[cx] + 420 + rng() * Math.max(40, WORLD_H - surf[cx] - 500));
    if (cy >= WORLD_H - 20 || m[cy * WORLD_W + cx] !== M_DIRT) continue;
    const r = 2 + rng() * 2.5;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const ddx = x - cx, ddy = y - cy;
        if (ddx * ddx + ddy * ddy <= r * r) setPxIf(m, x, y, M_CRYSTAL, M_DIRT);
      }
    }
    veins++;
  }

  return {
    m, surf, bgSurf, trees,
    colony: {
      x: colonyX, entrance, junction, queenCh, storage, nursery,
      paths: { entrance: pEntr, storage: pStor, nursery: pNurs, queen: pQueen, junction: [] }
    }
  };
}

// --- trees ---------------------------------------------------------------------
// solid wood disk; claims everything but rock (so branches read as one limb)
function woodDisk(m, cx, cy, r) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) continue;
      const i = y * WORLD_W + x;
      if (m[i] !== M_ROCK) m[i] = M_WOOD;
    }
  }
}

// one limb: a curving, tapering wood path that forks into children.
// Terminal twigs record their endpoints in tips[] for foliage.
function growBranch(m, rng, x, y, ang, len, w, depth, tips) {
  let cx = x, cy = y, a = ang;
  const n = Math.max(3, Math.round(len / 2));
  for (let i = 0; i < n; i++) {
    const r = Math.max(1, w * (1 - (i / n) * 0.5));
    woodDisk(m, Math.round(cx), Math.round(cy), r);
    a += (rng() - 0.5) * 0.3;
    a += (-Math.PI / 2 - a) * 0.04;   // branches reach for the light
    cx += Math.cos(a) * 2;
    cy += Math.sin(a) * 2;
  }
  if (depth <= 0 || w <= 1) { tips.push({ x: cx, y: cy }); return; }
  const nb = 2 + (rng() < 0.35 ? 1 : 0);
  for (let b = 0; b < nb; b++) {
    growBranch(m, rng, cx, cy, a + (rng() - 0.5) * 1.5,
      len * (0.5 + rng() * 0.3), w * 0.65, depth - 1, tips);
  }
}

// a whole tree: curved trunk with side branches on the way up, a crown of
// 2-3 leaders that fork recursively, leaf puffs on every twig, root flare.
function growTree(m, rng, tx, groundY) {
  const th = 90 + Math.floor(rng() * 80);
  const trunkW = 2.2 + rng() * 1.6;
  const lean = (rng() - 0.5) * 0.22;
  const splitY = groundY - th * (0.45 + rng() * 0.2);  // where the crown starts
  const tips = [];

  // trunk: walk upward, tapering and wobbling, shedding side branches
  let cx = tx, cy = groundY + 4, ang = -Math.PI / 2 + lean * 0.3;
  let nextSide = 18 + rng() * 14;
  while (cy > splitY) {
    const t = (groundY - cy) / th;
    const r = Math.max(1.2, trunkW * (1 - t * 0.55));
    woodDisk(m, Math.round(cx), Math.round(cy), r);
    ang += (rng() - 0.5) * 0.16;
    ang += (-Math.PI / 2 + lean - ang) * 0.1;   // tropism toward the lean line
    cx += Math.cos(ang) * 2;
    cy += Math.sin(ang) * 2;
    nextSide -= 2;
    if (nextSide <= 0 && cy < groundY - th * 0.35) {
      nextSide = 16 + rng() * 18;
      const side = rng() < 0.5 ? -1 : 1;
      growBranch(m, rng, cx, cy, -Math.PI / 2 + side * (0.9 + rng() * 0.5),
        14 + rng() * 14, Math.max(1, r * 0.45), 1, tips);
    }
  }

  // crown: split into leaders
  const nl = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < nl; i++) {
    const a2 = -Math.PI / 2 + lean + (i - (nl - 1) / 2) * (0.55 + rng() * 0.3)
      + (rng() - 0.5) * 0.2;
    growBranch(m, rng, cx, cy, a2, th * (0.22 + rng() * 0.14),
      Math.max(1.2, trunkW * 0.6), 2, tips);
  }

  // foliage: a puff on every twig tip plus a body around the crown fork
  let topY = cy - 12, crownSum = 0;
  for (const p of tips) {
    fillEllipse(m, Math.round(p.x), Math.round(p.y),
      7 + rng() * 7, 5 + rng() * 4, M_LEAF, true);
    if (p.y - 6 < topY) topY = p.y - 6;
    crownSum += p.x;
  }
  fillEllipse(m, Math.round(cx), Math.round(cy - 6),
    14 + rng() * 10, 9 + rng() * 6, M_LEAF, true);
  const crownX = tips.length ? Math.round(crownSum / tips.length) : Math.round(cx);

  // roots: flare at the base plus wandering strands
  fillEllipse(m, tx, groundY + 2, trunkW + 2, 3, M_WOOD);
  const nr = 2 + Math.floor(rng() * 3);
  for (let r2 = 0; r2 < nr; r2++) {
    let rx2 = tx + (rng() - 0.5) * trunkW * 2, ry2 = groundY + 2;
    let rang = Math.PI / 2 + (rng() - 0.5) * 1.4;
    const rlen = 30 + rng() * 55;
    for (let s = 0; s < rlen; s++) {
      setPxIf(m, Math.round(rx2), Math.round(ry2), M_ROOT, M_DIRT);
      setPxIf(m, Math.round(rx2) + 1, Math.round(ry2), M_ROOT, M_DIRT);
      if (s < rlen * 0.4) setPxIf(m, Math.round(rx2), Math.round(ry2) + 1, M_ROOT, M_DIRT);
      rang += (rng() - 0.5) * 0.3;
      rx2 += Math.cos(rang);
      ry2 += Math.sin(rang);
    }
  }

  return { x: tx, topY: Math.round(topY), h: Math.round(groundY - topY), crownX };
}

// --- gen helpers --------------------------------------------------------------
function setPx(m, x, y, v) {
  if (x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H) m[y * WORLD_W + x] = v;
}
function setPxIf(m, x, y, v, onlyIf) {
  if (x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H) {
    const i = y * WORLD_W + x;
    if (m[i] === onlyIf) m[i] = v;
  }
}
function fillEllipse(m, cx, cy, rx, ry, v, onlyAir) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        if (onlyAir) setPxIf(m, x, y, v, M_AIR);
        else setPx(m, x, y, v);
      }
    }
  }
}
function fillEllipseCarve(m, cx, cy, rx, ry) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPx(m, x, y, M_AIR);
    }
  }
}
function carveCircle(m, cx, cy, r) {
  fillEllipseCarve(m, cx, cy, r, r);
}
function settlePath(m, pts) {
  for (const p of pts) {
    for (let d = 1; d <= 14; d++) {
      const y = p.y + d;
      if (y >= WORLD_H) break;
      if (m[y * WORLD_W + p.x] !== M_AIR) {
        if (d < 14) p.y = y - 3;
        break;
      }
    }
  }
}
function carveTunnel(m, rng, x0, y0, x1, y1, r, rec) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(dist / 2);
  let wob = rng() * Math.PI * 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    wob += (rng() - 0.5) * 0.8;
    const wx = Math.sin(wob) * 5 * Math.sin(t * Math.PI); // wiggle, pinned at ends
    const x = x0 + (x1 - x0) * t + wx;
    const y = y0 + (y1 - y0) * t;
    carveCircle(m, x, y, r);
    if (rec && (i % 3 === 0 || i === steps)) rec.push({ x: Math.round(x), y: Math.round(y) });
  }
}
