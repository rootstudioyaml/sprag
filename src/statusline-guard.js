/**
 * Overlap guard for the statusline command.
 *
 * Claude Code relaunches the statusline command every refreshInterval (5s)
 * without checking whether the previous run has finished. Measured with a
 * 20-second command: 15 processes were alive at once after 75 seconds. On a
 * busy machine one render can exceed 5s, so processes pile up without bound
 * (each is 170-320MB) and memory climbs until the machine stalls.
 *
 * Two defences live here: a per-session lock so a second run exits at once
 * (printing the last good line), and a hard time budget after which a slow run
 * prints the last good line and exits. Nothing here may ever throw or break
 * the statusline: every filesystem failure degrades to "no guard".
 */

import { openSync, writeSync, closeSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { extractSessionId } from './stdin-payload.js';
import { writeStateFile } from './state-file.js';
import { envVar } from './env.js';

const LOCK_DIR = 'statusline-locks';
const LAST_FILE = 'statusline-last.json';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Default liveness probe: signal 0 checks existence without sending anything. */
export function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return !(e && e.code === 'ESRCH');
  }
}

export function sessionKeyFrom(stdinJson) {
  const id = extractSessionId(stdinJson);
  if (!id) return 'default';
  const key = id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return key || 'default';
}

function readHolder(path) {
  try {
    const h = JSON.parse(readFileSync(path, 'utf8'));
    if (h && typeof h === 'object' && Number.isFinite(h.pid) && Number.isFinite(h.startedAt)) return h;
  } catch { /* unreadable or broken: treated as stale by the caller */ }
  return null;
}

function tryCreate(path, pid, now) {
  const fd = openSync(path, 'wx');
  try {
    writeSync(fd, JSON.stringify({ pid, startedAt: now }));
  } finally {
    closeSync(fd);
  }
}

export function acquireStatuslineLock({
  dir = userDataDir(), key = 'default', now = Date.now(), pid = process.pid,
  isAlive = defaultIsAlive, staleMs = 30_000, registerExit = true,
} = {}) {
  const noop = { acquired: true, release() {} };
  try {
    const lockDir = join(dir, LOCK_DIR);
    mkdirSync(lockDir, { recursive: true });
    const path = join(lockDir, `${key}.lock`);
    const release = () => {
      try {
        const h = readHolder(path);
        if (h && h.pid === pid) unlinkSync(path);
      } catch { /* already gone */ }
    };
    const success = () => {
      if (registerExit) process.once('exit', release);
      return { acquired: true, path, release };
    };
    try {
      tryCreate(path, pid, now);
      return success();
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return noop;
    }
    const holder = readHolder(path);
    const stale = !holder || !isAlive(holder.pid) || now - holder.startedAt > staleMs;
    if (!stale) return { acquired: false, holder };
    try { unlinkSync(path); } catch { /* someone else removed it */ }
    try {
      tryCreate(path, pid, now);
      return success();
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return noop;
      return { acquired: false, holder: readHolder(path) };
    }
  } catch {
    return noop;
  }
}

function readLastMap(dir) {
  try {
    const m = JSON.parse(readFileSync(join(dir, LAST_FILE), 'utf8'));
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  } catch {
    return {};
  }
}

export function readLastRender({ dir = userDataDir(), key = 'default' } = {}) {
  try {
    const entry = readLastMap(dir)[key];
    return entry && typeof entry.text === 'string' ? entry.text : null;
  } catch {
    return null;
  }
}

export function writeLastRender({
  dir = userDataDir(), key = 'default', text, now = Date.now(), maxAgeMs = DAY_MS,
} = {}) {
  try {
    const map = readLastMap(dir);
    for (const [k, v] of Object.entries(map)) {
      if (!v || typeof v.at !== 'number' || now - v.at > maxAgeMs) delete map[k];
    }
    map[key] = { text, at: now };
    writeStateFile(join(dir, LAST_FILE), JSON.stringify(map));
  } catch { /* the cache is a convenience */ }
}

export function statuslineBudgetMs(env = process.env) {
  const raw = envVar('STATUSLINE_BUDGET_MS', env);
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return 4000;
}

export function armStatuslineDeadline({ budgetMs, onExpire }) {
  if (!budgetMs) return null;
  const timer = setTimeout(onExpire, budgetMs);
  timer.unref();
  return timer;
}
