// MAUR -- terrain rendering (client only): the material map painted to canvases,
// repainted rect by rect as the simulation reports edits through T.onEdit.
'use strict';

const TerrainView = {
  terCan: null,     // foreground material pixels (transparent where air)
  terCtx: null,
  bgCan: null,      // dark underground backdrop (transparent above bgSurf)
  dirty: [],        // [x0, y0, x1, y1] rects waiting to be repainted

  build() {
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
          const c = matColor(mat, x, y, h, depth, mat === M_PACKED ? T.wear.get(i) : 0);
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

  // repaint every edited rect straight from the material map
  flush() {
    for (const [x0, y0, x1, y1] of this.dirty) {
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const img = this.terCtx.createImageData(w, h);
      const d = img.data;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const mat = T.m[y * WORLD_W + x];
          if (mat === M_AIR) continue;
          const i = y * WORLD_W + x;
          const c = matColor(mat, x, y, pxHash(x, y), y - T.bgSurf[x],
            mat === M_PACKED ? T.wear.get(i) : 0);
          const o = ((y - y0) * w + (x - x0)) * 4;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        }
      }
      this.terCtx.putImageData(img, x0, y0);
    }
    this.dirty.length = 0;
  },
};

// wear: bite damage on packed earth (shows as cracks)
function matColor(mat, x, y, h, depth, wear) {
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
      const shades = [[64, 128, 44], [52, 112, 36], [76, 142, 52]];
      return shades[h % 3];
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
      const shades = [[46, 108, 31], [37, 93, 25], [59, 125, 39]];
      let c = shades[h % 3];
      if (h % 23 === 0) c = [82, 152, 62];
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
