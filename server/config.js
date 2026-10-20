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

module.exports = {
  PORT: num('PORT', 3006),
  HOST: process.env.HOST || '127.0.0.1',
  MAX_ROOMS: num('MAX_ROOMS', 6),
  MAX_PLAYERS: Math.max(1, Math.min(4, num('MAX_PLAYERS', 4))),
  ROOM_IDLE_MS: num('ROOM_IDLE_MS', 60000),          // an empty room closes after this
  ROOM_OVER_MS: num('ROOM_OVER_MS', 5 * 60000),      // ...and an ended match after this
  RECONNECT_MS: num('RECONNECT_MS', 2 * 60000),      // a lost player's slot is kept this long
  MAX_CONNS: num('MAX_CONNS', 64),
  DEV: process.env.MAUR_DEV === '1',                 // test hooks (never in production)
  STATIC_DIR,
  JS_DIR: process.env.SIM_DIR || path.join(STATIC_DIR, 'js'),
};
