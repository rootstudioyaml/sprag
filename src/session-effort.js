/**
 * The effort level each session runs at, as the statusline last saw it.
 *
 * Claude Code puts `effort.level` into the statusline payload, but the
 * UserPromptSubmit payload does not carry it. The statusline therefore writes
 * the level to <userDataDir>/session-effort/<sessionId>, and the prompt hook
 * reads it back (effortNotice in src/route-inject.js).
 *
 * The statusline renders every few seconds, so an unchanged level is not
 * written again. Files untouched for 7 days are removed, checked on roughly one
 * write in PRUNE_EVERY. Every failure is swallowed: this is a hint input.
 */

import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { debug } from './debug.js';

export const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const PRUNE_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY = 100;

export const sessionEffortDir = (dir) => join(dir || userDataDir(), 'session-effort');

/** Removes level files older than 7 days. */
export function pruneSessionEffort({ dir, now = Date.now() } = {}) {
  try {
    const d = sessionEffortDir(dir);
    for (const name of readdirSync(d)) {
      try {
        if (now - statSync(join(d, name)).mtimeMs > PRUNE_MS) rmSync(join(d, name), { force: true });
      } catch { /* gone already */ }
    }
  } catch (e) { if (e?.code !== 'ENOENT') debug('session-effort:prune', e); }
}

/**
 * Record the level for a session. Returns true when a file was written; false
 * for a malformed id, an empty level, an unchanged level, or a failure.
 *
 * @param {{dir?: string, now?: number, random?: () => number}} [opts] `dir` replaces the user data dir (tests)
 */
export function recordSessionEffort(sessionId, level, { dir, now = Date.now(), random = Math.random } = {}) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return false;
  if (typeof level !== 'string' || level === '') return false;
  try {
    const file = join(sessionEffortDir(dir), sessionId);
    let prev = null;
    try { prev = readFileSync(file, 'utf8').trim(); } catch { /* first write */ }
    if (prev === level) return false;
    mkdirSync(sessionEffortDir(dir), { recursive: true });
    // Not writeStateFile: that treats a file that is not JSON as corrupt and keeps a copy.
    writeFileSync(file, level + '\n');
    if (random() < 1 / PRUNE_EVERY) pruneSessionEffort({ dir, now });
    return true;
  } catch (e) {
    debug('session-effort:record', e);
    return false;
  }
}

/** The recorded level for a session, or null. */
export function readSessionEffort(sessionId, { dir } = {}) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return null;
  try {
    const v = readFileSync(join(sessionEffortDir(dir), sessionId), 'utf8').trim();
    return v === '' ? null : v;
  } catch {
    return null;
  }
}
