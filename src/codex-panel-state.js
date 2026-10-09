import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, readdirSync, lstatSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { userDataDir } from './paths.js';
import { codexUserDir } from './agent.js';
import { writeViaTmp, runHousekeeping, sweepStaleTmp } from './state-file.js';

// Every panel session leaves a `-frame` and a `-hook` file behind, keyed by a
// hash that is not reused once the session is gone. They are diagnostics for a
// live session, so a file untouched for a week describes one that is over.
const PANEL_STATE_FILE = /^codex-panel-[0-9a-f]{64}-(?:frame|hook)\.json$/;
export const PANEL_STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function panelStatePath(root, kind, dir = userDataDir(), sessionId) {
  const key = createHash('sha256').update(codexUserDir() + '\0' + resolve(root) + (sessionId ? `\0${sessionId}` : '')).digest('hex');
  return join(dir, `codex-panel-${key}-${kind}.json`);
}

export function recordPanelState(root, kind, value, dir = userDataDir()) {
  try {
    mkdirSync(dir, { recursive: true });
    const file = panelStatePath(root, kind, dir);
    const tmp = `${file}.${process.pid}.tmp`;
    const text = JSON.stringify({ ...value, at: new Date().toISOString() });
    writeViaTmp(tmp, file, text);
    if (value.sessionId) {
      const sessionFile = panelStatePath(root, kind, dir, value.sessionId);
      const sessionTmp = `${sessionFile}.${process.pid}.tmp`;
      writeViaTmp(sessionTmp, sessionFile, text);
    }
    // A live panel records a frame every couple of seconds, so the clean-up is
    // rate-limited to once a day (see runHousekeeping) rather than listing the
    // directory on every write. This session's own files, of both kinds, are
    // never candidates: a session that has run for over a week keeps writing
    // frames while its hook record is just as old.
    runHousekeeping(dir, {
      'stale-tmp': () => sweepStaleTmp(dir),
      'codex-panel': () => sweepPanelState({
        dir,
        keep: ['frame', 'hook'].flatMap((k) => [
          panelStatePath(root, k, dir),
          ...(value.sessionId ? [panelStatePath(root, k, dir, value.sessionId)] : []),
        ]),
      }),
    });
  } catch { /* Diagnostics must not stop a session or panel. */ }
}

/**
 * Remove panel state files untouched for `maxAgeMs`. Only the exact
 * `codex-panel-<64 hex>-(frame|hook).json` shape is considered, and anything
 * in `keep` (full paths) is left alone whatever its mtime.
 *
 * @returns {number} how many files were removed
 */
export function sweepPanelState({ dir = userDataDir(), now = Date.now(), maxAgeMs = PANEL_STATE_MAX_AGE_MS, keep = [] } = {}) {
  let names;
  try { names = readdirSync(dir); } catch { return 0; }
  const protectedPaths = new Set(keep);
  let removed = 0;
  for (const name of names) {
    if (!PANEL_STATE_FILE.test(name)) continue;
    const path = join(dir, name);
    if (protectedPaths.has(path)) continue;
    try {
      const st = lstatSync(path);
      if (!st.isFile() || now - st.mtimeMs <= maxAgeMs) continue;
      unlinkSync(path);
      removed += 1;
    } catch { /* already gone, or not ours to remove */ }
  }
  return removed;
}

export function readPanelState(root, kind, dir = userDataDir(), sessionId) {
  try { return JSON.parse(readFileSync(panelStatePath(root, kind, dir, sessionId), 'utf8')); }
  catch { return null; }
}

export function panelHealth(root, { now = Date.now(), dir, sessionId } = {}) {
  const hook = readPanelState(root, 'hook', dir, sessionId);
  const frame = readPanelState(root, 'frame', dir, sessionId);
  const age = frame ? now - Date.parse(frame.at) : Infinity;
  const live = frame?.status === 'rendered' && age >= 0 && age < 15000;
  return { hook, frame, live };
}
