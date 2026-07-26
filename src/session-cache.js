/**
 * Parsed-session cache — keyed by (path, mtimeMs, size).
 *
 * The statusline re-runs the whole report pipeline on every refresh
 * (`refreshInterval=5` is what `install` configures), and without a cache
 * that means re-reading every session JSONL in the window line by line.
 * Measured on a 217MB / 226-file 30-day window: 3.0s per refresh, of which
 * effectively all is spent re-parsing files that cannot have changed —
 * between two refreshes only the CURRENT session's file grows.
 *
 * Session transcripts are append-only and never rewritten, so (mtimeMs, size)
 * is a sound identity for "this file's parse result is still valid". A stale
 * or corrupt cache is never fatal: every read path falls back to a full parse.
 *
 * Only the aggregate summary is stored, never the per-request array — that is
 * internal to the parser's aggregation and no consumer reads it (see
 * parseAllSessions, which drops it on the fresh-parse path too so cache hits
 * and misses return identically shaped objects).
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { debug } from './debug.js';

const CACHE_PATH = join(userDataDir(), 'session-cache.json');
// Bump when the cached summary's shape changes — old entries are dropped
// wholesale rather than migrated.
const CACHE_VERSION = 1;
// Entries for transcripts this old are pruned on write. Keeps the file
// bounded without an existence check per entry (which would cost the syscalls
// the cache exists to avoid).
const PRUNE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * @typedef {object} SessionSummary
 * @property {string|null} sessionId
 * @property {string} filePath
 * @property {Date|null} startTime
 * @property {Date|null} endTime
 * @property {number} requestCount
 * @property {object} totals
 * @property {number} maxContextPerRequest
 * @property {string} model
 * @property {string} [projectDir]
 */

/** Dates don't survive JSON — store epoch ms, rehydrate on read. */
function serialize(session) {
  return {
    sessionId: session.sessionId,
    startTime: session.startTime ? session.startTime.getTime() : null,
    endTime: session.endTime ? session.endTime.getTime() : null,
    requestCount: session.requestCount,
    totals: session.totals,
    maxContextPerRequest: session.maxContextPerRequest,
    model: session.model,
  };
}

function deserialize(stored, filePath, projectDir) {
  return {
    sessionId: stored.sessionId ?? null,
    filePath,
    projectDir,
    startTime: typeof stored.startTime === 'number' ? new Date(stored.startTime) : null,
    endTime: typeof stored.endTime === 'number' ? new Date(stored.endTime) : null,
    requestCount: stored.requestCount || 0,
    totals: stored.totals,
    maxContextPerRequest: stored.maxContextPerRequest || 0,
    model: stored.model || 'unknown',
  };
}

/**
 * Load the cache into a plain object. Any problem (missing file, bad JSON,
 * version bump) yields an empty cache — the caller just re-parses.
 *
 * @returns {{ entries: Record<string, {mtimeMs:number,size:number,s:object}> }}
 */
export function loadCache() {
  try {
    if (!existsSync(CACHE_PATH)) return { entries: {} };
    const data = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    if (!data || data.version !== CACHE_VERSION || !data.entries || typeof data.entries !== 'object') {
      return { entries: {} };
    }
    return { entries: data.entries };
  } catch (e) {
    debug('session-cache:load', e);
    return { entries: {} };
  }
}

/**
 * Look up a parsed session for a discovered file.
 *
 * @param {{entries:object}} cache
 * @param {{path:string, size:number, mtime:number, projectDir:string}} file
 * @returns {SessionSummary|null} null on miss
 */
export function getCached(cache, file) {
  const e = cache.entries[file.path];
  if (!e || e.mtimeMs !== file.mtime || e.size !== file.size || !e.s) return null;
  try {
    return deserialize(e.s, file.path, file.projectDir);
  } catch (err) {
    debug('session-cache:deserialize', err);
    return null;
  }
}

/**
 * Record a freshly parsed session against the stat values observed BEFORE the
 * parse. Keying on the pre-parse stat is deliberate: if the file grew while we
 * were reading it, the entry is keyed to a size that will never be seen again,
 * so the next run re-parses. The opposite (keying on the post-parse stat)
 * would let a hit serve a summary that missed the tail.
 */
export function putCached(cache, file, session) {
  cache.entries[file.path] = {
    mtimeMs: file.mtime,
    size: file.size,
    s: serialize(session),
  };
}

/**
 * Atomically persist the cache (tmp + rename), pruning long-dead transcripts.
 * Concurrent statusline refreshes are expected — rename is atomic on POSIX and
 * on Windows for same-volume replaces, so a reader never sees a partial file.
 * Best-effort: a write failure just means the next run re-parses.
 */
export function saveCache(cache) {
  try {
    const dir = userDataDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const cutoff = Date.now() - PRUNE_AFTER_MS;
    const entries = {};
    for (const [path, e] of Object.entries(cache.entries)) {
      if (e && typeof e.mtimeMs === 'number' && e.mtimeMs >= cutoff) entries[path] = e;
    }
    const tmp = `${CACHE_PATH}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, entries }) + '\n');
    renameSync(tmp, CACHE_PATH);
  } catch (e) {
    debug('session-cache:save', e); // best-effort — never block a report
  }
}

export function sessionCachePath() {
  return CACHE_PATH;
}
