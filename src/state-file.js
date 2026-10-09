/**
 * Writes for the state files this tool owns: the rule registry, the savings
 * ledger, the seed answers, the config.
 *
 * Their loaders read a file that fails to parse as empty state, which is the
 * right thing for a report but meant the next save replaced the whole file
 * with that empty state. The savings ledger is a lifetime total, so one
 * half-written file (two statuslines saving at once, a full disk) erased it
 * for good. Two things stop that here: the write goes to a temp file that is
 * renamed over the target, so a reader never sees half a file, and a target
 * that does not parse is copied aside before it is replaced.
 */

import {
  writeFileSync, renameSync, readFileSync, existsSync, mkdirSync, copyFileSync, rmSync,
  readdirSync, lstatSync, unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/** Where an unreadable state file is kept. One slot: the first copy holds the data worth recovering. */
export const corruptCopyPath = (file) => `${file}.corrupt`;

function keepUnreadable(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { return; }
  if (!raw.trim()) return;
  try { JSON.parse(raw); return; } catch { /* does not parse: keep it */ }
  try {
    if (!existsSync(corruptCopyPath(file))) copyFileSync(file, corruptCopyPath(file));
  } catch { /* best effort; the write below still goes ahead */ }
}

export function writeStateFile(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  keepUnreadable(file);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  } catch {
    // Windows refuses the rename while another process holds the target open.
    // Writing in place is what this did before, and better than not saving.
    try { rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    writeFileSync(file, text);
  }
}

/**
 * Write `data` to `tmp`, then rename it over `file`. A failure at either step
 * removes `tmp` before the error goes on, so a full disk or a rename refused
 * by the OS does not leave a stray `<file>.<pid>.tmp` behind. The caller picks
 * `tmp` (pid, uuid, ...) and decides what a failure means; this only makes
 * sure the failure cleans up after itself. `unlink` errors are ignored: the
 * original error is the one worth reporting.
 */
export function writeViaTmp(tmp, file, data, options) {
  try {
    writeFileSync(tmp, data, options);
    renameSync(tmp, file);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    throw e;
  }
}

/** A temp file older than this was left by a process that died mid-write. */
export const STALE_TMP_AGE_MS = 60 * 60 * 1000;
/** `session-cache.json.52038.tmp`: the `<state file>.<pid>.tmp` shape the writers above use. */
const PID_TMP_NAME = /^.+\.json\.\d+\.tmp$/;

/**
 * Remove temp files that a killed process left in `dir` (top level only).
 *
 * Only `<name>.json.<digits>.tmp` older than an hour goes: a younger one may
 * belong to a writer that is between its write and its rename right now, and
 * anything with another shape is not ours to judge. Symlinks are skipped
 * rather than followed.
 *
 * @returns {number} how many files were removed
 */
export function sweepStaleTmp(dir, { now = Date.now(), maxAgeMs = STALE_TMP_AGE_MS } = {}) {
  let names;
  try { names = readdirSync(dir); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    if (!PID_TMP_NAME.test(name)) continue;
    const path = join(dir, name);
    try {
      const st = lstatSync(path);
      if (!st.isFile() || now - st.mtimeMs <= maxAgeMs) continue;
      unlinkSync(path);
      removed += 1;
    } catch { /* already gone, or not ours to remove */ }
  }
  return removed;
}

const HOUSEKEEPING_FILE = 'housekeeping.json';
export const HOUSEKEEPING_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Run directory clean-up jobs at most once per `intervalMs` each, however
 * often this is called. Callers sit on hot paths (the statusline saves its
 * cache on nearly every render; the Codex panel writes state every couple of
 * seconds), and a `readdir` there would cost far more than the files it
 * removes. The last run of each job is kept in `housekeeping.json` beside the
 * data: one small read per call, and the directory is listed only when a job
 * is actually due.
 *
 * The run is stamped BEFORE the job starts. A job that throws, or a stamp that
 * cannot be written, then costs one skipped day rather than a retry on every
 * call. A stamp that cannot be written skips the jobs entirely for the same
 * reason.
 *
 * @param {string} dir
 * @param {Record<string, () => void>} jobs - name -> job; names key the stamps
 * @returns {string[]} names of the jobs that ran
 */
export function runHousekeeping(dir, jobs, { now = Date.now(), intervalMs = HOUSEKEEPING_INTERVAL_MS } = {}) {
  const file = join(dir, HOUSEKEEPING_FILE);
  let marks = {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) marks = parsed;
  } catch { /* first run, or an unreadable stamp file: everything is due */ }
  // A stamp in the future (clock moved back) would otherwise silence the job
  // until the clock catches up; treat it as due.
  const due = Object.keys(jobs).filter((name) => {
    const age = now - Number(marks[name]);
    return !(Number.isFinite(age) && age >= 0 && age < intervalMs);
  });
  if (!due.length) return [];
  const next = { ...marks };
  for (const name of due) next[name] = now;
  try { writeStateFile(file, JSON.stringify(next) + '\n'); } catch { return []; }
  for (const name of due) {
    try { jobs[name](); } catch { /* clean-up is best effort */ }
  }
  return due;
}
