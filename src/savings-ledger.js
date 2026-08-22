/**
 * savings-ledger — per-run delegation saving events with timestamps.
 *
 * model-rules.json stores `savedUsd` as a scan-window snapshot per rule, which
 * is right for rule-health but cannot answer "how much did routing save this
 * week / this month / ever". This ledger keeps one event per subagent run,
 * keyed by the run's transcript path so re-scans over overlapping windows
 * upsert instead of double-counting.
 *
 * File: <userDataDir>/delegation-ledger.json
 *   { "events": { "<run path>": { "ts": <ms epoch>, "usd": <number> } } }
 *
 * Best-effort like every other state file here: an unreadable ledger reads as
 * empty, and the statusline renders totals of 0 as "no chip".
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';

const WEEK_MS = 7 * 24 * 3600 * 1000;
const MONTH_MS = 30 * 24 * 3600 * 1000;

export function ledgerPath() {
  return join(userDataDir(), 'delegation-ledger.json');
}

export function loadLedger() {
  try {
    const data = JSON.parse(readFileSync(ledgerPath(), 'utf8'));
    return data && typeof data.events === 'object' && data.events !== null
      ? data
      : { events: {} };
  } catch {
    return { events: {} };
  }
}

/**
 * Upsert saving events. `events` is an array of { key, ts, usd } where `key`
 * is the run's transcript path (unique per subagent run). Zero-saving runs
 * are skipped — they carry no information the totals care about.
 */
export function recordDelegationEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return;
  const data = loadLedger();
  let changed = false;
  for (const e of events) {
    if (!e || !e.key || !(Number(e.usd) > 0) || !Number.isFinite(e.ts)) continue;
    const prev = data.events[e.key];
    const usd = Math.round(Number(e.usd) * 10000) / 10000;
    if (prev && prev.ts === e.ts && prev.usd === usd) continue;
    data.events[e.key] = { ts: e.ts, usd };
    changed = true;
  }
  if (!changed) return;
  try {
    const dir = userDataDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(ledgerPath(), JSON.stringify(data) + '\n');
  } catch {
    // statusline totals just stay stale until the next successful scan
  }
}

/**
 * Rolling totals: last 7 days, last 30 days, and lifetime. `now` is injectable
 * for tests. Never throws — an unreadable ledger yields all-zero totals.
 */
export function delegationSavedTotals(now = Date.now()) {
  const totals = { week: 0, month: 0, total: 0 };
  try {
    for (const e of Object.values(loadLedger().events)) {
      const usd = Number(e.usd) || 0;
      if (usd <= 0) continue;
      totals.total += usd;
      if (Number.isFinite(e.ts)) {
        if (now - e.ts <= WEEK_MS) totals.week += usd;
        if (now - e.ts <= MONTH_MS) totals.month += usd;
      }
    }
  } catch {
    return { week: 0, month: 0, total: 0 };
  }
  return totals;
}
