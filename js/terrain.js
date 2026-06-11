// MAUR -- terrain store: pixel materials, render canvases, digging.
'use strict';

const T = {
  m: null,          // Uint8Array WORLD_W*WORLD_H
  surf: null,
  bgSurf: null,
  terCan: null,     // foreground material pixels (transparent where air)
  terCtx: null,
  bgCan: null,      // dark underground backdrop (transparent above bgSurf)

  init(world) {
    this.m = world.m;
    this.surf = world.surf;
    this.bgSurf = world.bgSurf;
    this.buildCanvases();
  },

  get(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || x >= WORLD_W || y < 0) return M_ROCK;
    if (y >= WORLD_H) return M_ROCK;
    return this.m[y * WORLD_W + x];
  },

  solid(x, y) {
    return this.get(x, y) !== M_AIR;
  },

  // any solid pixel inside the box centered at (x,y), half-extents hw,hh
  boxSolid(x, y, hw, hh) {
    const x0 = Math.floor(x - hw), x1 = Math.ceil(x + hw);
    const y0 = Math.floor(y - hh), y1 = Math.ceil(y + hh);
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        if (this.solid(px, py)) return true;
      }
    }
    return false;
  },

  // any undiggable solid (rock/wood) inside the box? Forced moves (squeeze,
  // burrow) may land overlapping soil -- the ant chews out -- but never this.
  boxHard(x, y, hw, hh) {
    const x0 = Math.floor(x - hw), x1 = Math.ceil(x + hw);
    const y0 = Math.floor(y - hh), y1 = Math.ceil(y + hh);
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const m = this.get(px, py);
        if (m === M_ROCK || m === M_WOOD) return true;
      }
    }
    return false;
  },

  // dig a circle; removes diggable materials only.
  // returns {count, leaves} -- pixels removed, leaf pixels among them
  dig(cx, cy, r) {
    cx = Math.round(cx); cy = Math.round(cy);
    const r2 = r * r;
    let count = 0, leaves = 0;
    const x0 = Math.max(0, cx - Math.ceil(r)), x1 = Math.min(WORLD_W - 1, cx + Math.ceil(r));
    const y0 = Math.max(0, cy - Math.ceil(r)), y1 = Math.min(WORLD_H - 1, cy + Math.ceil(r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * WORLD_W + x;
        const mat = this.m[i];
        if (!DIGGABLE(mat)) continue;
        if (mat === M_LEAF) leaves++;
        this.m[i] = M_AIR;
        this.terCtx.clearRect(x, y, 1, 1);
        count++;
      }
    }
    // digging away the ground lowers the surface line for that column
    if (count > 0) {
      for (let x = x0; x <= x1; x++) {
        let s = this.surf[x];
        if (s < y0 - 1 || s > y1 + 1) continue;
        while (s < WORLD_H - 1 && this.m[s * WORLD_W + x] === M_AIR) s++;
        this.surf[x] = s;
      }
    }
    return { count, leaves };
  },

  // would this circle hit anything diggable?
  digHasTarget(cx, cy, r) {
    cx = Math.round(cx); cy = Math.round(cy);
    const r2 = r * r;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        if (DIGGABLE(this.get(x, y))) return true;
      }
    }
    return false;
  },

  // anything solid-but-undiggable in the circle (rock/wood -> "clank")
  digHitsHard(cx, cy, r) {
    cx = Math.round(cx); cy = Math.round(cy);
    const r2 = r * r;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const m = this.get(x, y);
        if (m === M_ROCK || m === M_WOOD) return true;
      }
    }
    return false;
  },

  buildCanvases() {
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

    const m = this.m, bgSurf = this.bgSurf;

    for (let y = 0; y < WORLD_H; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        const i = y * WORLD_W + x;
        const o = i * 4;
        const h = pxHash(x, y);
        const mat = m[i];
        let c = null;
        const depth = y - bgSurf[x];

        if (mat !== M_AIR) {
          c = matColor(mat, x, y, h, depth);
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
  }
};

function matColor(mat, x, y, h, depth) {
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
  }
  return [255, 0, 255];
}
