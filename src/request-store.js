/**
 * Per-transcript request store: a sidecar file that lets a large transcript be
 * parsed incrementally.
 *
 * The session cache keys a summary on (mtime, size), so a transcript that is
 * still being written misses on every statusline tick, and a session that
 * started before the window cutoff has to be re-read whole because the summary
 * carries no per-request data. Both cost a full pass over a file that can be
 * hundreds of megabytes. The store keeps the compact per-request records and
 * the byte offset up to which the transcript has been consumed, so the next
 * parse reads only the bytes appended since.
 *
 * Transcripts are append-only. A store is trusted only while the bytes just
 * before its offset still hash to `tailHash`; anything else (a rewritten file,
 * a truncated one) discards it and the caller parses from the start. Every
 * failure here is soft: the caller falls back to a full parse.
 */

import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync, readFileSync, mkdirSync, readdirSync, lstatSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { writeViaTmp } from './state-file.js';
import { envVar } from './env.js';
import { debug } from './debug.js';

export const STORE_VERSION = 1;
/** Transcripts smaller than this are cheap to parse whole and get no store. */
export const STORE_MIN_BYTES = 4 * 1024 * 1024;
/** How many bytes before the offset are hashed to prove the prefix is unchanged. */
const TAIL_HASH_BYTES = 256;
/** A store untouched for this long belongs to a transcript nobody reads any more. */
export const STORE_MAX_AGE_MS = 35 * 24 * 60 * 60 * 1000;

let minBytesOverride = null;

/** Tests lower the threshold; pass null to restore the default. */
export function setStoreMinBytes(n) {
  minBytesOverride = Number.isFinite(n) ? n : null;
}

export function storeMinBytes() {
  return minBytesOverride ?? STORE_MIN_BYTES;
}

export function storeDir() {
  return join(userDataDir(), 'request-store');
}

export function storePathFor(transcriptPath) {
  const id = createHash('sha1').update(transcriptPath).digest('hex').slice(0, 20);
  return join(storeDir(), `${id}.json`);
}

/** Whether a transcript of this path and size gets a store. */
export function storeEligible(filePath, size, minBytes) {
  if (envVar('NO_REQUEST_STORE') === '1') return false;
  if (filePath.endsWith('.zst')) return false;
  return size >= (minBytes ?? storeMinBytes());
}

/** sha1 of file bytes [max(0, offset - 256), offset), or null when they cannot be read in full. */
export function hashBefore(filePath, offset) {
  let fd = null;
  try {
    const start = Math.max(0, offset - TAIL_HASH_BYTES);
    const len = offset - start;
    const buf = Buffer.alloc(len);
    if (len > 0) {
      fd = openSync(filePath, 'r');
      const got = readSync(fd, buf, 0, len, start);
      if (got !== len) return null;
    }
    return createHash('sha1').update(buf).digest('hex');
  } catch (e) {
    debug('request-store:hash', e);
    return null;
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* already closed */ }
  }
}

/**
 * The stored state for a transcript when it is still a valid prefix of the
 * file, else null. `size` is the file's current size.
 */
export function readStore(filePath, size) {
  let store;
  try {
    store = JSON.parse(readFileSync(storePathFor(filePath), 'utf8'));
  } catch (e) {
    if (e && e.code !== 'ENOENT') debug('request-store:read', e);
    return null;
  }
  try {
    if (!store || store.v !== STORE_VERSION || store.path !== filePath) return null;
    if (!Number.isInteger(store.offset) || store.offset <= 0 || store.offset > size) return null;
    if (!Array.isArray(store.reqs) || typeof store.tailHash !== 'string') return null;
    if (hashBefore(filePath, store.offset) !== store.tailHash) return null;
    return store;
  } catch (e) {
    debug('request-store:validate', e);
    return null;
  }
}

/** Atomically write the store. Never throws. */
export function writeStore(filePath, state) {
  try {
    const file = storePathFor(filePath);
    mkdirSync(storeDir(), { recursive: true });
    const body = JSON.stringify({ v: STORE_VERSION, path: filePath, ...state });
    writeViaTmp(`${file}.${process.pid}.tmp`, file, body + '\n');
  } catch (e) {
    debug('request-store:write', e);
  }
}

/** Remove stores (and stray temp files) not modified for `maxAgeMs`. Returns the count removed. */
export function pruneRequestStore({ now = Date.now(), maxAgeMs = STORE_MAX_AGE_MS, dir = storeDir() } = {}) {
  let names;
  try { names = readdirSync(dir); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
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
