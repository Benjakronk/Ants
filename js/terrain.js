// MAUR -- terrain store: pixel materials and digging. Pure simulation: no
// canvas here (the client's TerrainView draws it), so it runs headless too.
'use strict';

const T = {
  m: null,          // Uint8Array WORLD_W*WORLD_H
  surf: null,
  bgSurf: null,
  onEdit: null,     // fn(x0, y0, x1, y1): a rect of pixels changed (client redraws, server relays)

  init(world) {
    this.m = world.m;
    this.surf = world.surf;
    this.bgSurf = world.bgSurf;
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
  // returns {count, leaves, fungi, crystals} -- pixels removed by kind
  dig(cx, cy, r) {
    cx = Math.round(cx); cy = Math.round(cy);
    const r2 = r * r;
    let count = 0, leaves = 0, fungi = 0, crystals = 0;
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
        else if (mat === M_FUNGUS) fungi++;
        else if (mat === M_CRYSTAL) crystals++;
        this.m[i] = M_AIR;
        count++;
      }
    }
    // digging away the ground lowers the surface line for that column
    if (count > 0) {
      if (this.onEdit) this.onEdit(x0, y0, x1, y1);
      for (let x = x0; x <= x1; x++) {
        let s = this.surf[x];
        if (s < y0 - 1 || s > y1 + 1) continue;
        while (s < WORLD_H - 1 && this.m[s * WORLD_W + x] === M_AIR) s++;
        this.surf[x] = s;
      }
    }
    return { count, leaves, fungi, crystals };
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
  }
};
