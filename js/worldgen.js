// MAUR -- seeded procedural world generation.
// One byte per world pixel, Liero-style.
'use strict';

const WORLD_W = 2048;
const WORLD_H = 1280;

// materials
const M_AIR = 0;
const M_DIRT = 1;   // diggable
const M_ROCK = 2;   // not diggable
const M_GRASS = 3;  // diggable
const M_WOOD = 4;   // not diggable (trunks, roots)
const M_LEAF = 5;   // diggable (bite through, sometimes drops food)

function DIGGABLE(m) { return m === M_DIRT || m === M_GRASS || m === M_LEAF; }

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

  // -- rock blobs underground
  const blobCount = 70;
  for (let i = 0; i < blobCount; i++) {
    const bx = Math.floor(rng() * WORLD_W);
    const by = Math.floor(surf[Math.min(WORLD_W - 1, Math.max(0, bx))] + 60 + rng() * (WORLD_H - surf[bx] - 120));
    const rx = 6 + rng() * 26, ry = 4 + rng() * 14;
    fillEllipse(m, bx, by, rx, ry, M_ROCK);
  }

  // -- natural caves: drunken walkers
  for (let i = 0; i < 26; i++) {
    let cx = rng() * WORLD_W;
    let cy = surf[Math.floor(Math.max(0, Math.min(WORLD_W - 1, cx)))] + 100 + rng() * 600;
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
  const treeCount = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < treeCount; i++) {
    treeXs.push(Math.floor(40 + rng() * (WORLD_W - 80)));
  }
  for (const txc of treeXs) {
    const tx = Math.max(40, Math.min(WORLD_W - 40, txc));
    if (Math.abs(tx - colonyX) < 140) continue;
    if (trees.some(t => Math.abs(t.x - tx) < 110)) continue;
    const th = 90 + Math.floor(rng() * 70);
    const tw = 5 + Math.floor(rng() * 5);
    const groundY = surf[tx];
    const topY = groundY - th;
    // trunk (slight taper + lean)
    const lean = (rng() - 0.5) * 0.15;
    for (let y = topY; y < groundY + 6; y++) {
      const t = (y - topY) / th;
      const w = Math.max(2, Math.round(tw * (0.45 + 0.55 * t)));
      const cx2 = tx + Math.round((groundY - y) * lean);
      for (let x = cx2 - (w >> 1); x <= cx2 + (w >> 1); x++) {
        setPx(m, x, y, M_WOOD);
      }
    }
    const crownX = tx + Math.round(th * lean);
    // branches
    const nb = 2 + Math.floor(rng() * 3);
    const branchTips = [];
    for (let b = 0; b < nb; b++) {
      let bx = crownX, by = topY + 10 + rng() * th * 0.4;
      let bang = (rng() < 0.5 ? -1 : 1) * (0.3 + rng() * 0.6);
      const blen = 18 + rng() * 26;
      for (let s = 0; s < blen; s++) {
        setPx(m, Math.round(bx), Math.round(by), M_WOOD);
        setPx(m, Math.round(bx), Math.round(by) + 1, M_WOOD);
        bx += Math.cos(bang) * (bang > 0 ? 1 : -1) * (bang > 0 ? 1 : 1);
        bx += (bang > 0 ? 1 : -1);
        by -= 0.35 + rng() * 0.2;
      }
      branchTips.push({ x: bx, y: by });
    }
    // canopy: leaf blobs at top + branch tips
    fillEllipse(m, crownX, topY + 4, 16 + rng() * 14, 10 + rng() * 8, M_LEAF, true);
    fillEllipse(m, crownX - 10, topY + 12, 12 + rng() * 8, 8 + rng() * 5, M_LEAF, true);
    fillEllipse(m, crownX + 10, topY + 12, 12 + rng() * 8, 8 + rng() * 5, M_LEAF, true);
    for (const bt of branchTips) {
      fillEllipse(m, Math.round(bt.x), Math.round(bt.y), 8 + rng() * 8, 6 + rng() * 4, M_LEAF, true);
    }
    // roots
    const nr = 2 + Math.floor(rng() * 2);
    for (let r = 0; r < nr; r++) {
      let rx2 = tx + (rng() - 0.5) * tw, ry2 = groundY + 2;
      let rang = Math.PI / 2 + (rng() - 0.5) * 1.2;
      const rlen = 30 + rng() * 50;
      for (let s = 0; s < rlen; s++) {
        setPxIf(m, Math.round(rx2), Math.round(ry2), M_WOOD, M_DIRT);
        setPxIf(m, Math.round(rx2) + 1, Math.round(ry2), M_WOOD, M_DIRT);
        rang += (rng() - 0.5) * 0.3;
        rx2 += Math.cos(rang);
        ry2 += Math.sin(rang);
      }
    }
    trees.push({ x: tx, topY, h: th, crownX });
  }

  return {
    m, surf, bgSurf, trees,
    colony: {
      x: colonyX, entrance, junction, queenCh, storage, nursery,
      paths: { entrance: pEntr, storage: pStor, nursery: pNurs, queen: pQueen, junction: [] }
    }
  };
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
