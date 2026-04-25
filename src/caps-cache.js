/**
 * Caps cache — the rate-limit numbers only flow through stdin from Claude
 * Code's statusline contract, but we want the table view (e.g. invoked by
 * `/token-monitor`) to surface the same cap-warn box. So whenever the
 * statusline path sees caps it writes them here, and the table path reads
 * them back if its own stdin was empty.
 *
 * Stale data is worse than missing data — if the saved snapshot is older
 * than `maxAgeMs` the loader returns null and the table view stays quiet.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';

const CACHE_PATH = join(userDataDir(), 'last-caps.json');

function ensureDir() {
  const dir = userDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function persistCaps(caps) {
  if (!caps) return;
  try {
    ensureDir();
    const payload = { capturedAt: Date.now(), caps };
    writeFileSync(CACHE_PATH, JSON.stringify(payload) + '\n');
  } catch {
    // best-effort cache, never blocks the statusline
  }
}

/**
 * @param {object} [opts]
 * @param {number} [opts.maxAgeMs=5*60*1000] - drop snapshots older than this.
 * @returns {object|null}
 */
export function loadRecentCaps({ maxAgeMs = 5 * 60 * 1000 } = {}) {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const raw = readFileSync(CACHE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!data || !data.caps) return null;
    if (typeof data.capturedAt !== 'number') return null;
    if (Date.now() - data.capturedAt > maxAgeMs) return null;
    return data.caps;
  } catch {
    return null;
  }
}
