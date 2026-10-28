// MAUR server -- settings, from the environment (and an optional server/.env)
'use strict';

const fs = require('fs');
const path = require('path');

// a tiny .env reader (KEY=VALUE lines; the real environment wins)
function loadEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadEnv(path.join(__dirname, '.env'));

const num = (k, d) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== '' ? v : d;
};
// the first of these folders that exists (deployed: public/, dev: the repo)
const firstDir = dirs => dirs.find(d => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } }) || dirs[dirs.length - 1];

const STATIC_DIR = process.env.STATIC_DIR || firstDir([path.join(__dirname, '..', 'public'), path.join(__dirname, '..')]);

// the persistent worlds: PERSIST_WORLDS is a count (the first names of
// WORLD_NAMES) or a comma-separated list of names; 0 for none
const WORLD_NAMES = ['MAURTUA', 'ENGA', 'SKOGEN', 'LYNGEN'];
function worldNames(v) {
  if (v === undefined || v === '') v = '1';
  if (/^\d+$/.test(v.trim())) return WORLD_NAMES.slice(0, Math.min(WORLD_NAMES.length, Number(v)));
  const out = [];
  for (const s of v.split(',')) {
    const n = s.trim().toUpperCase().replace(/[^A-Z0-9ÆØÅ-]/g, '').slice(0, 12);
    if (n && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 8);
}

module.exports = {
  PORT: num('PORT', 3006),
  HOST: process.env.HOST || '127.0.0.1',
  MAX_ROOMS: num('MAX_ROOMS', 4),                    // matches (lobbies included); the persistent worlds come on top
  MAX_PLAYERS: Math.max(1, Math.min(8, num('MAX_PLAYERS', 8))),   // players per co-op room and persistent world
  SIDE_MAX: Math.max(1, Math.min(8, num('SIDE_MAX', 8))),         // versus: players a side (8v8: a room of 16)
  ROOM_IDLE_MS: num('ROOM_IDLE_MS', 60000),          // an empty room closes after this
  ROOM_OVER_MS: num('ROOM_OVER_MS', 5 * 60000),      // ...and an ended match after this
  RECONNECT_MS: num('RECONNECT_MS', 2 * 60000),      // a lost player's slot is kept this long
  MAX_CONNS: num('MAX_CONNS', 64),
  // the CPU the rooms may use, in ms per 16.7 ms frame summed over every
  // running room (10: about 60% of one core); above it new matches and
  // joins are turned away (SERVER FULL)
  CPU_BUDGET_MS: num('CPU_BUDGET_MS', 10),
  PERSIST_WORLDS: worldNames(process.env.PERSIST_WORLDS),
  DATA_DIR: path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data')),   // the worlds' save files
  AUTOSAVE_MS: num('AUTOSAVE_MS', 2 * 60000),        // a running world saves this often
  DEV: process.env.MAUR_DEV === '1',                 // test hooks (never in production)
  STATIC_DIR,
  JS_DIR: process.env.SIM_DIR || path.join(STATIC_DIR, 'js'),
};
