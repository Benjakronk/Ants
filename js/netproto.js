// MAUR -- the online protocol's shared parts: version, code tables, room
// codes, player names and the byte packing of terrain. Loaded as a plain
// script by the browser (global NetProto) and require()d by the server.
'use strict';

const NetProto = (() => {
  // bump when client and server stop understanding each other
  const VERSION = 1;

  // snapshots name castes, bugs and items by their index in these lists
  const CASTES = ['worker', 'soldier', 'nurse', 'queen', 'princess'];
  const BUGS = ['aphid', 'pillbug', 'worm', 'spider', 'centipede', 'wasp', 'beetle'];
  const ITEMS = ['seed', 'honeydew', 'leaf', 'corpse', 'bigcorpse', 'morsel', 'fungus', 'berry', 'crystal'];

  // entity records (arrays of integers; positions are in half pixels):
  //   ant   [id, colony, caste, x2, y2, bits, hp, carryId, playerIdx]
  //   brood [id, colony, x2, y2, bits]
  //   bug   [id, kind, x2, y2, bits, hp, trail x2,y2 ...]
  //   item  [id, kind, x2, y2, carrierId, site]
  const A_DIR = 1, A_CLIMB = 2, A_CEIL = 4, A_FLASH = 8, A_BITE = 16, A_RAID = 32, A_STEAL = 64, A_HIT = 128;
  const B_LARVA = 1, B_ROYAL = 2, B_HUNGRY = 4, B_CARRIED = 8;
  const U_DIR = 1, U_FLASH = 2, U_CURL = 4, U_FLEE = 8, U_HIT = 16, U_CLIMB = 32;
  // ticks a bitten enemy shows its health bar (the client's FOE_BAR_T)
  const HIT_T = 240;

  // room codes: four letters, none that pass for another (no I, O)
  const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const CODE_LEN = 4;
  function makeCode(rand) {
    let s = '';
    for (let i = 0; i < CODE_LEN; i++) s += CODE_ABC[Math.floor(rand() * CODE_ABC.length) % CODE_ABC.length];
    return s;
  }
  // a typed code as the server knows it ('abcd' -> 'ABCD'), or null
  function normCode(s) {
    if (typeof s !== 'string') return null;
    const c = s.trim().toUpperCase();
    if (c.length !== CODE_LEN) return null;
    for (const ch of c) if (!CODE_ABC.includes(ch)) return null;
    return c;
  }

  // player names: what the bitmap font can draw, upper case, 1-12 chars
  const NAME_MAX = 12;
  const NAME_OK = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ0123456789 -';
  function cleanName(s) {
    if (typeof s !== 'string') return '';
    let out = '';
    for (const ch of s.toUpperCase()) {
      if (NAME_OK.includes(ch)) out += ch;
      if (out.length >= NAME_MAX) break;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  // ---- bytes <-> base64 (Buffer on the server, atob/btoa in the browser) ----
  function toB64(u8) {
    if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.length).toString('base64');
    let bin = '';
    for (let o = 0; o < u8.length; o += 8192) bin += String.fromCharCode.apply(null, u8.subarray(o, o + 8192));
    return btoa(bin);
  }
  function fromB64(s) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    const bin = atob(s);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  // ---- terrain edits: a rect of material bytes, run-length packed ----------
  // [value, run 1-255] pairs, row after row (dug-out holes are long runs of air)
  function packRect(m, W, x0, y0, x1, y1) {
    const out = [];
    let v = -1, run = 0;
    for (let y = y0; y <= y1; y++) {
      let i = y * W + x0;
      for (let x = x0; x <= x1; x++, i++) {
        const b = m[i];
        if (b === v && run < 255) { run++; continue; }
        if (run) out.push(v, run);
        v = b; run = 1;
      }
    }
    if (run) out.push(v, run);
    return toB64(Uint8Array.from(out));
  }
  // write a packed rect back into m; returns false if it doesn't fit
  function unpackRect(m, W, H, x0, y0, x1, y1, b64) {
    if (!(x0 >= 0 && y0 >= 0 && x1 < W && y1 < H && x0 <= x1 && y0 <= y1)) return false;
    const d = fromB64(b64);
    let x = x0, y = y0;
    for (let k = 0; k + 1 < d.length; k += 2) {
      const v = d[k];
      for (let r = d[k + 1]; r > 0; r--) {
        if (y > y1) return false;
        m[y * W + x] = v;
        if (++x > x1) { x = x0; y++; }
      }
    }
    return y > y1;
  }

  // ---- whole terrain: the server sends it XORed against the world the seed
  // generates (mostly zeros -- deflates to almost nothing), and a hash of the
  // result so a client whose generator disagrees asks for it in full ----------
  function xorInto(dst, a, b) {
    for (let i = 0; i < dst.length; i++) dst[i] = a[i] ^ b[i];
    return dst;
  }
  function hashBytes(u8) {
    let h = 0x811c9dc5 | 0;
    const n4 = u8.length >> 2;
    const w = new Uint32Array(u8.buffer, u8.byteOffset, n4);
    for (let i = 0; i < n4; i++) h = Math.imul(h ^ w[i], 16777619);
    for (let i = n4 << 2; i < u8.length; i++) h = Math.imul(h ^ u8[i], 16777619);
    return h >>> 0;
  }

  // the surface line (Int16 per column) as base64
  function packInt16(arr) {
    const u8 = new Uint8Array(arr.length * 2);
    for (let i = 0; i < arr.length; i++) { u8[2 * i] = arr[i] & 0xFF; u8[2 * i + 1] = (arr[i] >> 8) & 0xFF; }
    return toB64(u8);
  }
  function unpackInt16(b64, out) {
    const u8 = fromB64(b64);
    for (let i = 0; i < out.length && 2 * i + 1 < u8.length; i++) out[i] = (u8[2 * i] | (u8[2 * i + 1] << 8)) << 16 >> 16;
    return out;
  }

  return {
    VERSION, CASTES, BUGS, ITEMS, HIT_T,
    A_DIR, A_CLIMB, A_CEIL, A_FLASH, A_BITE, A_RAID, A_STEAL, A_HIT,
    B_LARVA, B_ROYAL, B_HUNGRY, B_CARRIED,
    U_DIR, U_FLASH, U_CURL, U_FLEE, U_HIT, U_CLIMB,
    CODE_ABC, CODE_LEN, makeCode, normCode, NAME_MAX, NAME_OK, cleanName,
    toB64, fromB64, packRect, unpackRect, xorInto, hashBytes, packInt16, unpackInt16,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NetProto;
