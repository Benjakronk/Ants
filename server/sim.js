// MAUR server -- one simulation per room. The game's sim files are plain
// browser scripts sharing one global scope; each room loads them into its own
// vm context (as test/nodesim.js does), so two rooms never share G or T.
// save.js comes along for the persistent worlds (serializeWorld; the
// browser's localStorage half of it is never called here).
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JS_DIR } = require('./config');

const SIM_FILES = ['worldgen.js', 'terrain.js', 'entities.js', 'colony.js', 'game.js', 'save.js'];

// compiled once, run in every room's context
let scripts = null;
function compile() {
  scripts = SIM_FILES.map(f => new vm.Script(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), { filename: f }));
}

// a fresh, empty simulation: { ctx, G, T, run(code) } plus the sim's
// functions and constants the server calls by name
function createSim() {
  if (!scripts) compile();
  // (save.js packs the terrain with the browser's btoa/atob: Node has them too)
  const ctx = vm.createContext({ console, btoa, atob });
  for (const s of scripts) s.runInContext(ctx);
  const run = code => vm.runInContext(code, ctx);
  // (top-level const/let live in the context's scope, not on its global)
  return {
    ctx, run,
    G: run('G'), T: run('T'),
    WORLD_W: run('WORLD_W'), WORLD_H: run('WORLD_H'),
    CASTE: run('CASTE'), BUG_DEF: run('BUG_DEF'),
    UPGRADE_IDS: run('UPGRADE_IDS'), CASTE_ORDER: run('CASTE_ORDER'),
    RED_QUEEN_HP: run('RED_QUEEN_HP'), TOUGH: ctx.TOUGH,
    genWorld: ctx.genWorld, newWorld: ctx.newWorld, stepSim: ctx.stepSim,
    ensurePlayer: ctx.ensurePlayer, releasePlayer: ctx.releasePlayer,
    reclaimAnt: ctx.reclaimAnt, takeOver: ctx.takeOver, joinColony: ctx.joinColony,
    serializeWorld: ctx.serializeWorld, restoreWorld: ctx.restoreWorld, worldSummary: ctx.worldSummary,
    rebirthWorld: ctx.rebirthWorld, notePlayers: ctx.notePlayers, playerSlots: ctx.playerSlots,
    newPlayerStats: ctx.newPlayerStats,
  };
}

module.exports = { createSim, SIM_FILES };
