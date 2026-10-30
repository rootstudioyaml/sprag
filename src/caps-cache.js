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

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { writeViaTmp } from './state-file.js';

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
    // tmp + rename: the statusline reads this every tick and must never see a
    // half-written file.
    const tmp = `${CACHE_PATH}.${process.pid}.tmp`;
    writeViaTmp(tmp, CACHE_PATH, JSON.stringify(payload) + '\n');
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

/** Used percentage at which a window counts as under pressure. */
export const CAP_PRESSURE_HIGH = 70;
/** Used percentage at which a window counts as about to run out. */
export const CAP_PRESSURE_CRITICAL = 90;

const MODEL_FAMILY_RE = /opus|sonnet|haiku|fable/i;

function modelFamily(text) {
  const m = MODEL_FAMILY_RE.exec(String(text || ''));
  return m ? m[0].toLowerCase() : null;
}

/**
 * How close the busiest usage window is to its limit, read from the statusline
 * snapshot. The prompt hook uses it to say how hard to lean on delegation.
 *
 * A per-model window (`seven_day_opus` and the like) counts only for a session
 * on that model family, because another family's quota does not constrain it.
 * With the session's family unknown such a window is kept: overstating the
 * pressure is cheaper than hiding it. `litellm_budget` is an ordinary window
 * here and is reported with source 'litellm'.
 *
 * @param {object} [opts]
 * @param {{caps?: object|null}|null} [opts.snapshot] defaults to the recent snapshot
 * @param {string|null} [opts.sessionModel] model id or display name of the session
 * @returns {{ level: 'normal'|'high'|'critical', pct: number, key: string,
 *             source: 'subscription'|'litellm' }|null}
 *   null when there is no fresh snapshot or no window with a usable percentage
 */
export function capPressure({ snapshot = loadRecentSnapshot(), sessionModel } = {}) {
  const windows = snapshot && snapshot.caps && Array.isArray(snapshot.caps.windows) ? snapshot.caps.windows : [];
  const sessionFamily = modelFamily(sessionModel);
  let top = null;
  for (const w of windows) {
    if (!w || typeof w.key !== 'string') continue;
    if (typeof w.usedPct !== 'number' || !Number.isFinite(w.usedPct)) continue;
    const family = modelFamily(w.key);
    if (family && sessionFamily && family !== sessionFamily) continue;
    if (!top || w.usedPct > top.usedPct) top = w;
  }
  if (!top) return null;
  const level = top.usedPct >= CAP_PRESSURE_CRITICAL ? 'critical'
    : top.usedPct >= CAP_PRESSURE_HIGH ? 'high' : 'normal';
  return {
    level,
    pct: top.usedPct,
    key: top.key,
    source: top.key === 'litellm_budget' ? 'litellm' : 'subscription',
  };
}
