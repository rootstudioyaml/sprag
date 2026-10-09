/**
 * saved-reset — a stopwatch reset for the lifetime "saved" counters.
 *
 * The ledgers are append-only evidence, so a reset must not delete anything.
 * Instead this file records one timestamp per counter ("mark"), and every
 * totals function counts only events at or after its mark. Undo pops the
 * latest reset and puts the previous marks back, so a reset is always
 * reversible and the underlying ledger data is never touched.
 *
 * File: <userDataDir>/saved-reset.json
 *   { "version": 1,
 *     "marks": { "routing", "doc2md", "codex-routing", "codex-docs" },  // ms | null
 *     "history": [ { "at", "scopes": [...], "prev": { "<scope>": ms | null } } ] }
 *
 * CJS because doc2md-ledger.cjs reads it; ESM code imports it the same way.
 * Every caller passes the data directory, so tests can point at a temp dir.
 *
 * Best-effort like every other state file here: a missing or unreadable file
 * reads as "never reset", so a broken marker can only over-count, never hide
 * events.
 */

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 1;
const SCOPES = ['routing', 'doc2md', 'codex-routing', 'codex-docs'];
/** Cap on remembered resets, so the file cannot grow without bound. */
const MAX_HISTORY = 50;

const emptyMarks = () => Object.fromEntries(SCOPES.map((s) => [s, null]));

function resetPath(dir) {
  return path.join(dir, 'saved-reset.json');
}

const markOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function readState(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(resetPath(dir), 'utf8'));
    if (!data || typeof data !== 'object' || data.version !== VERSION) return { marks: emptyMarks(), history: [] };
    const marks = emptyMarks();
    for (const s of SCOPES) marks[s] = markOrNull(data.marks && data.marks[s]);
    const history = Array.isArray(data.history)
      ? data.history.filter((h) => h && Array.isArray(h.scopes) && h.prev && typeof h.prev === 'object')
      : [];
    return { marks, history };
  } catch {
    return { marks: emptyMarks(), history: [] };
  }
}

/** Atomic write: a temp file renamed over the target, so a reader never sees half a file. */
function writeState(dir, state) {
  const file = resetPath(dir);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const text = JSON.stringify({ version: VERSION, marks: state.marks, history: state.history }) + '\n';
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    fs.writeFileSync(file, text);
  }
}

/** Current marks. Never throws; a missing or corrupt file means no reset. */
function readResetMarks(dir) {
  return readState(dir).marks;
}

/**
 * Reset the given scopes to `now`. Returns the new marks. Unknown scopes are
 * ignored; the caller validates user input.
 */
function resetSaved(scopes, { dir, now = Date.now() } = {}) {
  const state = readState(dir);
  const valid = [...new Set(scopes)].filter((s) => SCOPES.includes(s));
  if (valid.length === 0) return state.marks;
  const prev = {};
  for (const s of valid) {
    prev[s] = state.marks[s];
    state.marks[s] = now;
  }
  state.history.push({ at: now, scopes: valid, prev });
  if (state.history.length > MAX_HISTORY) state.history.splice(0, state.history.length - MAX_HISTORY);
  writeState(dir, state);
  return state.marks;
}

/**
 * Undo the latest reset. Returns { scopes, marks } with the restored marks,
 * or null when there is nothing to undo.
 */
function undoReset({ dir } = {}) {
  const state = readState(dir);
  const last = state.history.pop();
  if (!last) return null;
  for (const s of last.scopes) {
    if (SCOPES.includes(s)) state.marks[s] = markOrNull(last.prev[s]);
  }
  writeState(dir, state);
  return { scopes: last.scopes, marks: state.marks };
}

/**
 * True when an event at `ts` is excluded by `mark`: a mark exists and the
 * event is older than it. An event with no usable timestamp cannot be shown
 * to postdate the reset, so it is excluded too.
 */
function isBeforeReset(ts, mark) {
  if (mark === null || mark === undefined) return false;
  return !Number.isFinite(ts) || ts < mark;
}

module.exports = { SCOPES, resetPath, readResetMarks, resetSaved, undoReset, isBeforeReset };
