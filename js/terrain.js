// MAUR -- terrain store: pixel materials and digging. Pure simulation: no
// canvas here (the client's TerrainView draws it), so it runs headless too.
'use strict';

// bites of strength 1 (a worker's) that it takes to break packed earth
const PACKED_HP = 3;

// how far below the original ground (bgSurf) digging may lower the surface line
const SURF_SINK = 4;

// player-built materials (the surface line climbs over these)
function BUILT(m) { return m === M_PACKED || m === M_THATCH || m === M_GATE; }
// what a colony NPC's digging leaves standing (the `spare` argument of
// T.dig / T.digHasTarget): nothing, the thatch, or every built material
const SPARE_NONE = 0, SPARE_THATCH = 1, SPARE_BUILT = 2;
function SPARED(m, spare) {
  return spare === SPARE_BUILT ? BUILT(m) : spare === SPARE_THATCH && m === M_THATCH;
}
// tough built materials: bites wear them down over PACKED_HP
function TOUGH(m) { return m === M_PACKED || m === M_GATE; }

const T = {
  m: null,          // Uint8Array WORLD_W*WORLD_H
  surf: null,
  bgSurf: null,
  wear: null,       // Map pixel index -> bite damage on packed earth (sparse)
  onEdit: null,     // fn(x0, y0, x1, y1): a rect of pixels changed (client redraws, server relays)

  init(world) {
    this.m = world.m;
    this.surf = world.surf;
    this.bgSurf = world.bgSurf;
    this.wear = new Map();
  },

  get(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || x >= WORLD_W || y < 0) return M_ROCK;
    if (y >= WORLD_H) return M_ROCK;
    return this.m[y * WORLD_W + x];
  },

  // `own`: the test is for one of our colony's ants, to whom an ant gate is
  // as open as air. Everyone else (and anything building) sees it solid.
  solid(x, y, own) {
    const m = this.get(x, y);
    return m !== M_AIR && (m !== M_GATE || !own);
  },

  // any solid pixel inside the box centered at (x,y), half-extents hw,hh
  boxSolid(x, y, hw, hh, own) {
    const x0 = Math.floor(x - hw), x1 = Math.ceil(x + hw);
    const y0 = Math.floor(y - hh), y1 = Math.ceil(y + hh);
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        if (this.solid(px, py, own)) return true;
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

  // dig a circle; removes diggable materials only. `power` is how hard the
  // bite is (default 1): packed earth (and gates) only give way once their
  // accumulated wear reaches PACKED_HP, and power 0 leaves them untouched
  // entirely. `own`: one of our ants chewing its way -- it leaves gates be.
  // `spare` (SPARE_*): a colony NPC on its errands also leaves the players'
  // mound and walls standing; only its stuck fallbacks bite through them.
  // returns {count, leaves, fungi, crystals, soil, thatch, worn, natural} --
  // pixels removed by kind (soil = dirt/grass/root/packed), worn = packed
  // pixels that took damage but held, natural = removed pixels that weren't
  // player-built
  dig(cx, cy, r, power, own, spare) {
    if (power === undefined) power = 1;
    cx = Math.round(cx); cy = Math.round(cy);
    const r2 = r * r;
    let count = 0, leaves = 0, fungi = 0, crystals = 0, soil = 0, thatch = 0, worn = 0, natural = 0;
    const x0 = Math.max(0, cx - Math.ceil(r)), x1 = Math.min(WORLD_W - 1, cx + Math.ceil(r));
    const y0 = Math.max(0, cy - Math.ceil(r)), y1 = Math.min(WORLD_H - 1, cy + Math.ceil(r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * WORLD_W + x;
        const mat = this.m[i];
        if (!DIGGABLE(mat)) continue;
        if (spare && SPARED(mat, spare)) continue;
        if (TOUGH(mat)) {
          if (own && mat === M_GATE) continue;
          if (power <= 0) continue;
          const w = (this.wear.get(i) || 0) + power;
          if (w < PACKED_HP - 0.01) { this.wear.set(i, w); worn++; continue; }
          this.wear.delete(i);
          soil++;
        } else if (mat === M_LEAF || mat === M_THATCH) thatch++;
        else if (mat === M_FUNGUS) fungi++;
        else if (mat === M_CRYSTAL) crystals++;
        else soil++;
        if (mat === M_LEAF) leaves++;
        if (!BUILT(mat)) natural++;
        this.m[i] = M_AIR;
        count++;
      }
    }
    // cracks in worn packed earth show too
    if ((count > 0 || worn > 0) && this.onEdit) this.onEdit(x0, y0, x1, y1);
    // digging away the ground lowers the surface line for that column -- but
    // only by a shallow scrape: a hole deeper than SURF_SINK below the
    // original ground is a shaft into the earth, not new surface. (Letting
    // the line fall down the nest's entrance shaft made ants inside it think
    // they stood on the surface; foragers then paced the shaft for good.)
    if (count > 0) {
      for (let x = x0; x <= x1; x++) {
        let s = this.surf[x];
        if (s < y0 - 1 || s > y1 + 1) continue;
        const floor = Math.max(s, this.bgSurf[x] + SURF_SINK);
        while (s < floor && this.m[s * WORLD_W + x] === M_AIR) s++;
        this.surf[x] = s;
      }
    }
    return { count, leaves, fungi, crystals, soil, thatch, worn, natural };
  },

  // build: fill AIR pixels of a disk with `mat`, at most `budget` of them,
  // skipping any pixel canPlace(x, y) rejects (bodies in the way). Building
  // on top of the ground raises the surface line. Returns pixels placed.
  place(cx, cy, r, mat, canPlace, budget) {
    cx = Math.round(cx); cy = Math.round(cy);
    const r2 = r * r;
    const x0 = Math.max(0, cx - Math.ceil(r)), x1 = Math.min(WORLD_W - 1, cx + Math.ceil(r));
    const y0 = Math.max(0, cy - Math.ceil(r)), y1 = Math.min(WORLD_H - 1, cy + Math.ceil(r));
    let n = 0, ex0 = x1, ey0 = y1, ex1 = x0, ey1 = y0;
    for (let y = y0; y <= y1 && n < budget; y++) {
      for (let x = x0; x <= x1 && n < budget; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * WORLD_W + x;
        if (this.m[i] !== M_AIR) continue;
        if (canPlace && !canPlace(x, y)) continue;
        this.m[i] = mat;
        this.wear.delete(i);
        n++;
        if (x < ex0) ex0 = x;
        if (x > ex1) ex1 = x;
        if (y < ey0) ey0 = y;
        if (y > ey1) ey1 = y;
      }
    }
    if (n > 0) {
      if (this.onEdit) this.onEdit(ex0, ey0, ex1, ey1);
      for (let x = ex0; x <= ex1; x++) this.raiseSurf(x);
    }
    return n;
  },

  // the surface climbs over built material stacked on the ground (through
  // any grass blades under it, but not over trunks or a bridge floating in
  // mid-air)
  raiseSurf(x) {
    let s = this.surf[x], top = s;
    while (s > 0) {
      const m = this.m[(s - 1) * WORLD_W + x];
      if (!BUILT(m) && m !== M_GRASS) break;
      s--;
      if (BUILT(m)) top = s;
    }
    this.surf[x] = top;
  },

  // sparse packed-earth (and gate) wear for saves: flat [index, wear*10, ...]
  wearList() {
    const out = [];
    for (const [i, w] of this.wear) {
      if (TOUGH(this.m[i])) out.push(i, Math.round(w * 10));
    }
    return out;
  },
  loadWear(list) {
    this.wear = new Map();
    if (!Array.isArray(list)) return;
    for (let k = 0; k + 1 < list.length; k += 2) {
      if (TOUGH(this.m[list[k]])) this.wear.set(list[k], list[k + 1] / 10);
    }
  },

  // would this circle hit anything diggable? (own: gates don't count;
  // spare: nor the built material T.dig would spare)
  digHasTarget(cx, cy, r, own, spare) {
    cx = Math.round(cx); cy = Math.round(cy);
    const r2 = r * r;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const m = this.get(x, y);
        if (DIGGABLE(m) && (m !== M_GATE || !own) && !(spare && SPARED(m, spare))) return true;
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
