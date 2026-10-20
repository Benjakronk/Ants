// MAUR server -- the persistent worlds on disk: one JSON file per world in
// DATA_DIR (the save format of js/save.js, v7), written atomically -- the
// new save goes to a temporary file first, the last good one becomes the
// .bak, then the new one takes its name. A crash halfway leaves the old
// save or the backup, never half a file.
'use strict';

const fs = require('fs');
const path = require('path');

// a world's name as a file name (MAURTUA -> maurtua.json)
function fileOf(dir, name) {
  const base = name.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').replace(/[^a-z0-9-]/g, '_');
  return path.join(dir, base + '.json');
}

// the saved world's candidates, best first: the save, then its backup --
// each one that parses, as { file, data }. Empty if there's none. The
// caller tries them in turn (a save can parse and still not restore).
function loadWorld(dir, name, log) {
  const file = fileOf(dir, name);
  const out = [];
  for (const f of [file, file + '.bak']) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    try {
      const d = JSON.parse(text);
      if (d && typeof d === 'object' && d.terrain) out.push({ file: f, data: d });
      else if (log) log(`world ${name}: ${path.basename(f)} holds no world`);
    } catch (e) {
      if (log) log(`world ${name}: ${path.basename(f)} is corrupt (${e.message})`);
    }
  }
  return out;
}

// a world's files that won't load: moved aside (name.json.bad-<time>) so
// the next save never rotates them into the .bak over a good one (mainOnly:
// just the main save, when the backup loaded instead)
function quarantine(dir, name, log, mainOnly) {
  const file = fileOf(dir, name);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const f of mainOnly ? [file] : [file, file + '.bak']) {
    if (!fs.existsSync(f)) continue;
    const to = f + '.bad-' + stamp;
    try {
      fs.renameSync(f, to);
      if (log) log(`world ${name}: moved ${path.basename(f)} aside as ${path.basename(to)}`);
    } catch (e) {
      if (log) log(`world ${name}: could not move ${path.basename(f)} aside: ${e.message}`);
      return false;
    }
  }
  return true;
}

// write it (synchronously: also called on the way out at shutdown).
// Returns the bytes written, or -1 on failure.
function saveWorld(dir, name, data, log) {
  const file = fileOf(dir, name);
  const tmp = file + '.tmp';
  try {
    fs.mkdirSync(dir, { recursive: true });
    const text = JSON.stringify(data);
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fs.existsSync(file)) fs.renameSync(file, file + '.bak');
    fs.renameSync(tmp, file);
    return text.length;
  } catch (e) {
    if (log) log(`world ${name}: SAVE FAILED: ${e.message}`);
    return -1;
  }
}

module.exports = { loadWorld, saveWorld, quarantine, fileOf };
