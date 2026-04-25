/**
 * Statusline snapshot cache — the rate-limit numbers and model name only flow
 * through stdin from Claude Code's statusline contract, but we want the table
 * view (`claude-token-saver --days N`) to surface the same data. So
 * whenever the statusline path sees them it writes them here, and the table
 * path reads them back if its own stdin was empty.
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

/**
 * Persist whatever subset of statusline state we have right now. A null/empty
 * snapshot is a no-op so callers don't have to guard.
 *
 * @param {{ caps?: object|null, model?: string|null }|null} snapshot
 */
export function persistSnapshot(snapshot) {
  if (!snapshot) return;
  const hasCaps = !!snapshot.caps;
  const hasModel = typeof snapshot.model === 'string' && snapshot.model.length > 0;
  if (!hasCaps && !hasModel) return;
  try {
    ensureDir();
    const payload = {
      capturedAt: Date.now(),
      caps: snapshot.caps || null,
      model: snapshot.model || null,
    };
    writeFileSync(CACHE_PATH, JSON.stringify(payload) + '\n');
  } catch {
    // best-effort cache, never blocks the statusline
  }
}

/**
 * v2.3 wrote `caps` as `{ fiveHour, sevenDay }`; v2.4+ writes `{ windows: [...] }`.
 * Convert on read so a returning user's stale snapshot still feeds the table view
 * until the next statusline refresh overwrites it.
 */
function normalizeCaps(caps) {
  if (!caps || typeof caps !== 'object') return null;
  if (Array.isArray(caps.windows)) return caps;
  const windows = [];
  if (caps.fiveHour && typeof caps.fiveHour === 'object') {
    windows.push({ key: 'five_hour', usedPct: caps.fiveHour.usedPct, resetsAt: caps.fiveHour.resetsAt ?? null });
  }
  if (caps.sevenDay && typeof caps.sevenDay === 'object') {
    windows.push({ key: 'seven_day', usedPct: caps.sevenDay.usedPct, resetsAt: caps.sevenDay.resetsAt ?? null });
  }
  return windows.length ? { windows } : null;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.maxAgeMs=5*60*1000] - drop snapshots older than this.
 * @returns {{ caps: object|null, model: string|null }|null}
 */
export function loadRecentSnapshot({ maxAgeMs = 5 * 60 * 1000 } = {}) {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const raw = readFileSync(CACHE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data.capturedAt !== 'number') return null;
    if (Date.now() - data.capturedAt > maxAgeMs) return null;
    return {
      caps: normalizeCaps(data.caps),
      model: data.model || null,
    };
  } catch {
    return null;
  }
}
