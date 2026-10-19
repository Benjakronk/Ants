// MAUR -- terrain rendering (client only): the material map painted to canvases,
// repainted rect by rect as the simulation reports edits through T.onEdit.
'use strict';

const TerrainView = {
  terCan: null,     // foreground material pixels (transparent where air)
  terCtx: null,
  bgCan: null,      // dark underground backdrop (transparent above bgSurf)
  dirty: [],        // [x0, y0, x1, y1] rects waiting to be repainted
  season: 0,        // the season the grass and leaves are painted for
  slow: [],         // season repaint strips, a few repainted per frame

  build() {
    this.season = G.season;
    this.slow = [];
    // foreground
    this.terCan = document.createElement('canvas');
    this.terCan.width = WORLD_W; this.terCan.height = WORLD_H;
    this.terCtx = this.terCan.getContext('2d');
    const img = this.terCtx.createImageData(WORLD_W, WORLD_H);
    const d = img.data;

    // background (cave backdrop)
    this.bgCan = document.createElement('canvas');
    this.bgCan.width = WORLD_W; this.bgCan.height = WORLD_H;
    const bgCtx = this.bgCan.getContext('2d');
    const bimg = bgCtx.createImageData(WORLD_W, WORLD_H);
    const bd = bimg.data;

    const m = T.m, bgSurf = T.bgSurf;

    for (let y = 0; y < WORLD_H; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        const i = y * WORLD_W + x;
        const o = i * 4;
        const h = pxHash(x, y);
        const mat = m[i];
        const depth = y - bgSurf[x];

        if (mat !== M_AIR) {
          const c = matColor(mat, x, y, h, depth, TOUGH(mat) ? T.wear.get(i) : 0, mat === M_GATE && gateRim(x, y));
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        }
        // backdrop below the original surface
        if (depth >= 0) {
          const t = Math.min(1, depth / 520);
          let r = 46 - 32 * t, g = 30 - 22 * t, b2 = 18 - 13 * t;
          const j = (h % 7) - 3;
          r += j; g += j * 0.7; b2 += j * 0.5;
          bd[o] = Math.max(0, r); bd[o + 1] = Math.max(0, g); bd[o + 2] = Math.max(0, b2);
          bd[o + 3] = 255;
        }
      }
    }
    this.terCtx.putImageData(img, 0, 0);
    bgCtx.putImageData(bimg, 0, 0);

    this.dirty = [];
    T.onEdit = (x0, y0, x1, y1) => this.dirty.push([x0, y0, x1, y1]);
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
  flush() {
    for (let k = 0; k < 2 && this.slow.length; k++) this.dirty.push(this.slow.pop());
    for (const [rx0, ry0, rx1, ry1] of this.dirty) {
      const x0 = Math.max(0, rx0 - 1), y0 = Math.max(0, ry0 - 1);
      const x1 = Math.min(WORLD_W - 1, rx1 + 1), y1 = Math.min(WORLD_H - 1, ry1 + 1);
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const img = this.terCtx.createImageData(w, h);
      const d = img.data;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const mat = T.m[y * WORLD_W + x];
          if (mat === M_AIR) continue;
          const i = y * WORLD_W + x;
          const c = matColor(mat, x, y, pxHash(x, y), y - T.bgSurf[x],
            TOUGH(mat) ? T.wear.get(i) : 0, mat === M_GATE && gateRim(x, y));
          const o = ((y - y0) * w + (x - x0)) * 4;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        }
      }
      this.terCtx.putImageData(img, x0, y0);
    }
    this.dirty.length = 0;
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
