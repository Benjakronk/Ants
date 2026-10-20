// MAUR -- terrain rendering (client only): the material map painted to canvases,
// repainted rect by rect as the simulation reports edits through T.onEdit.
'use strict';

const TerrainView = {
  terCan: null,     // foreground material pixels (transparent where air)
  terCtx: null,
  bgCan: null,      // dark underground backdrop (transparent above bgSurf)
  bgCtx: null,
  dirty: [],        // [x0, y0, x1, y1] rects waiting to be repainted
  season: 0,        // the season the grass and leaves are painted for
  slow: [],         // season repaint strips, a few repainted per frame
  pending: [],      // first-paint tiles not yet painted, nearest the focus last

  // A new world: the whole map is ~12 million pixels, far too many to paint
  // before the first frame (that alone was ~0.75 s). So only a band around
  // (fx, fy) -- where the camera starts -- is painted now; the rest is queued
  // as tiles, nearest first, and flush() paints a few milliseconds' worth per
  // frame (all of it within a few seconds, long before anyone walks there).
  build(fx, fy) {
    this.season = G.season;
    this.slow = [];
    this.terCan = document.createElement('canvas');
    this.terCan.width = WORLD_W; this.terCan.height = WORLD_H;
    this.terCtx = this.terCan.getContext('2d');
    this.bgCan = document.createElement('canvas');      // the cave backdrop
    this.bgCan.width = WORLD_W; this.bgCan.height = WORLD_H;
    this.bgCtx = this.bgCan.getContext('2d');
    fx = fx === undefined ? WORLD_W / 2 : fx; fy = fy === undefined ? 0 : fy;
    const nx0 = Math.max(0, Math.floor(fx - 400)), nx1 = Math.min(WORLD_W - 1, Math.floor(fx + 400));
    const ny0 = Math.max(0, Math.floor(fy - 220)), ny1 = Math.min(WORLD_H - 1, Math.floor(fy + 280));
    this.paint(nx0, ny0, nx1, ny1, true);
    const TW = 128, TH = 120;
    this.pending = [];
    for (let y0 = 0; y0 < WORLD_H; y0 += TH) {
      for (let x0 = 0; x0 < WORLD_W; x0 += TW) {
        const x1 = Math.min(WORLD_W - 1, x0 + TW - 1), y1 = Math.min(WORLD_H - 1, y0 + TH - 1);
        if (x0 >= nx0 && x1 <= nx1 && y0 >= ny0 && y1 <= ny1) continue;     // already painted
        this.pending.push([x0, y0, x1, y1]);
      }
    }
    const dist = r => Math.hypot((r[0] + r[2]) / 2 - fx, ((r[1] + r[3]) / 2 - fy) * 1.5);
    this.pending.sort((a, b) => dist(b) - dist(a));     // nearest last (popped first)
    this.dirty = [];
    T.onEdit = (x0, y0, x1, y1) => this.dirty.push([x0, y0, x1, y1]);
  },

  // paint the rect (inclusive) straight from the material map; withBg: the
  // cave backdrop too (it only changes when the world is new)
  paint(x0, y0, x1, y1, withBg) {
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const img = this.terCtx.createImageData(w, h);
    const d = img.data;
    const bimg = withBg ? this.bgCtx.createImageData(w, h) : null;
    const bd = withBg ? bimg.data : null;
    const m = T.m, bgSurf = T.bgSurf;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * WORLD_W + x;
        const mat = m[i];
        const depth = y - bgSurf[x];
        if (mat === M_AIR && (!withBg || depth < 0)) continue;
        const o = ((y - y0) * w + (x - x0)) * 4;
        const hs = pxHash(x, y);
        if (mat !== M_AIR) {
          const c = matColor(mat, x, y, hs, depth, TOUGH(mat) ? T.wear.get(i) : 0, mat === M_GATE && gateRim(x, y));
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        }
        // backdrop below the original surface
        if (withBg && depth >= 0) {
          const t = Math.min(1, depth / 520);
          const j = (hs % 7) - 3;
          bd[o] = Math.max(0, 46 - 32 * t + j); bd[o + 1] = Math.max(0, 30 - 22 * t + j * 0.7);
          bd[o + 2] = Math.max(0, 18 - 13 * t + j * 0.5); bd[o + 3] = 255;
        }
      }
    }
    this.terCtx.putImageData(img, x0, y0);
    if (withBg) this.bgCtx.putImageData(bimg, x0, y0);
  },

  // paint every queued first-paint tile now (tests, or a full-map view)
  finish() {
    while (this.pending.length) this.paint(...this.pending.pop(), true);
  },

  // the season turned: repaint the band above ground (grass and foliage)
  // in strips, nearest the camera first, a couple per frame -- no hitch
  setSeason(s, camX) {
    this.season = s;
    const W = 128;
    this.slow = [];
    for (let x0 = 0; x0 < WORLD_W; x0 += W) {
      const x1 = Math.min(WORLD_W - 1, x0 + W - 1);
      let ymax = 0;
      for (let x = x0; x <= x1; x++) ymax = Math.max(ymax, T.bgSurf[x] + 4);
      this.slow.push([x0, 0, x1, Math.min(WORLD_H - 1, ymax)]);
    }
    const cx = camX || 0;
    this.slow.sort((a, b) => Math.abs(b[0] - cx) - Math.abs(a[0] - cx)); // nearest last (popped first)
  },

  // repaint every edited rect straight from the material map (a pixel
  // wider all round: a gate's rim depends on its neighbours)
  // (and the first-paint tiles still queued: a few milliseconds' worth)
  flush() {
    for (let k = 0; k < 2 && this.slow.length; k++) this.dirty.push(this.slow.pop());
    for (const [rx0, ry0, rx1, ry1] of this.dirty) {
      this.paint(Math.max(0, rx0 - 1), Math.max(0, ry0 - 1),
        Math.min(WORLD_W - 1, rx1 + 1), Math.min(WORLD_H - 1, ry1 + 1), false);
    }
    this.dirty.length = 0;
    if (this.pending.length) {
      const until = performance.now() + 5;
      do this.paint(...this.pending.pop(), true);
      while (this.pending.length && performance.now() < until);
    }
  },
};

// grass and foliage by season (spring, summer, autumn, winter)
const GRASS_SEASON = [
  [[84, 150, 52], [70, 136, 44], [98, 164, 62]],
  [[64, 128, 44], [52, 112, 36], [76, 142, 52]],
  [[138, 128, 52], [120, 108, 44], [150, 118, 48]],
  [[118, 128, 108], [104, 114, 96], [132, 140, 122]],
];
const LEAF_SEASON = [
  [[70, 140, 44], [58, 124, 36], [86, 156, 54]],
  [[46, 108, 31], [37, 93, 25], [59, 125, 39]],
  [[196, 110, 30], [176, 64, 28], [214, 160, 40], [150, 90, 30], [120, 100, 30]],
  [[96, 84, 64], [84, 74, 56], [108, 96, 74]],
];
const LEAF_FLECK = [[236, 196, 210], [82, 152, 62], [236, 196, 70], [235, 240, 248]];

// is this gate pixel at the gate's edge, beside open air? (a bright rim
// there makes a gate stand out in a dark tunnel)
function gateRim(x, y) {
  return T.get(x - 1, y) === M_AIR || T.get(x + 1, y) === M_AIR ||
    T.get(x, y - 1) === M_AIR || T.get(x, y + 1) === M_AIR;
}

// wear: bite damage on packed earth and gates (shows as cracks); rim: a
// gate pixel beside open air
function matColor(mat, x, y, h, depth, wear, rim) {
  switch (mat) {
    case M_DIRT: {
      const shades = [[122, 76, 44], [107, 66, 38], [94, 57, 32], [113, 72, 41]];
      let c = shades[h % 4].slice();
      if (h % 31 === 0) c = [74, 46, 27];          // dark speck
      else if (h % 53 === 0) c = [142, 96, 60];    // light speck
      const dk = 1 - Math.max(0, Math.min(0.32, depth / 1400)); // darker as you go down
      return [c[0] * dk | 0, c[1] * dk | 0, c[2] * dk | 0];
    }
    case M_GRASS: {
      return GRASS_SEASON[TerrainView.season][h % 3];
    }
    case M_ROCK: {
      const shades = [[112, 112, 120], [97, 97, 104], [126, 126, 134]];
      let c = shades[h % 3];
      if (h % 37 === 0) c = [150, 150, 158];
      return c;
    }
    case M_WOOD: {
      // vertical streaks
      const s = pxHash(x, (y >> 4) * 7) % 3;
      const shades = [[88, 60, 34], [75, 50, 28], [99, 68, 39]];
      return shades[s];
    }
    case M_LEAF: {
      // spring blossoms, autumn colours, winter frost on withered leaves
      const s = TerrainView.season;
      const shades = LEAF_SEASON[s];
      let c = shades[h % shades.length];
      if (h % (s === 3 ? 5 : 23) === 0) c = LEAF_FLECK[s];
      return c;
    }
    case M_ROOT: {
      // like wood, but duller and dirt-stained (and chewable)
      const shades = [[78, 54, 32], [68, 46, 27], [86, 60, 36]];
      return shades[h % 3];
    }
    case M_FUNGUS: {
      // pale glowing cave mushrooms
      const shades = [[150, 196, 164], [126, 178, 146], [168, 212, 178]];
      let c = shades[h % 3];
      if (h % 17 === 0) c = [200, 236, 204]; // bright fleck
      return c;
    }
    case M_CRYSTAL: {
      // cold glittering veins in the deep
      const shades = [[120, 180, 224], [96, 152, 208], [148, 204, 240]];
      let c = shades[h % 3];
      if (h % 11 === 0) c = [220, 240, 255]; // glint
      return c;
    }
    case M_PACKED: {
      // rammed earth: tamped clay in level bands, cracking as it's bitten
      const shades = [[156, 106, 64], [140, 94, 56], [126, 84, 50]];
      let c = shades[((y >> 1) + (h % 7 === 0 ? 1 : 0)) % 3];
      if ((y & 1) === 0 && h % 3 === 0) c = [112, 74, 44];  // tamp lines
      if (wear && h % 6 < wear * 1.6) c = [62, 40, 24];      // cracks
      return c;
    }
    case M_GATE: {
      // woven twig gate: crossed strands with pale knots and a straw-bright
      // rim where it meets the air, light enough to stand out against a dark
      // tunnel as well as against the earth
      const weave = (((x + y) >> 1) & 1) ^ (((x - y) >> 1) & 1);
      let c = weave ? [168, 124, 72] : [112, 78, 46];
      if (((x + y) & 3) === 0 && ((x - y) & 3) === 0) c = [226, 190, 112];
      if (rim) c = (x + y) & 1 ? [240, 208, 128] : [206, 168, 96];
      if (wear && h % 6 < wear * 1.6) c = [26, 16, 10];        // cracks
      return c;
    }
    case M_THATCH: {
      // straw and pine needles laid in diagonal strands
      const shades = [[210, 176, 92], [190, 154, 72], [224, 194, 112]];
      let c = shades[((x + y + (h & 1)) >> 1) % 3];
      if (h % 13 === 0) c = [150, 108, 48];   // dark needle
      return c;
    }
  }
  return [255, 0, 255];
}
