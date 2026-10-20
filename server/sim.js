// MAUR server -- one simulation per room. The game's sim files are plain
// browser scripts sharing one global scope; each room loads them into its own
// vm context (as test/nodesim.js does), so two rooms never share G or T.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JS_DIR } = require('./config');

const SIM_FILES = ['worldgen.js', 'terrain.js', 'entities.js', 'colony.js', 'game.js'];

// compiled once, run in every room's context
let scripts = null;
function compile() {
  scripts = SIM_FILES.map(f => new vm.Script(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), { filename: f }));
}

// a fresh, empty simulation: { ctx, G, T, run(code) } plus the sim's
// functions and constants the server calls by name
function createSim() {
  if (!scripts) compile();
  const ctx = vm.createContext({ console });
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
    reclaimAnt: ctx.reclaimAnt, takeOver: ctx.takeOver,
  };
}

module.exports = { createSim, SIM_FILES };
