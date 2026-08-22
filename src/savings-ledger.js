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
 *   { "version": 2,
 *     "events": { "<run path>": { "ts", "usd", "rule", "from", "to" } } }
 *
 * `from`/`to` are the models the routing decision moved between, and `usd` is
 * the price difference between them for this run's tokens. Version 1 priced
 * every downgraded subagent run against the session's priciest model, which
 * credited the tool for runs no rule of its own had routed; those events are
 * discarded rather than migrated, since the number they carry cannot be
 * recomputed without a rescan (which route-scan does anyway).
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

export const LEDGER_VERSION = 2;

export function loadLedger() {
  try {
    const data = JSON.parse(readFileSync(ledgerPath(), 'utf8'));
    if (!data || typeof data.events !== 'object' || data.events === null) {
      return { version: LEDGER_VERSION, events: {} };
    }
    // Pre-v2 events were priced against a different counterfactual — drop them
    // instead of mixing two meanings into one total. The next scan rebuilds
    // whatever is still attributable.
    if (data.version !== LEDGER_VERSION) return { version: LEDGER_VERSION, events: {} };
    return data;
  } catch {
    return { version: LEDGER_VERSION, events: {} };
  }
}

/**
 * Upsert saving events. `events` is an array of
 * { key, ts, usd, rule, from, to } where `key` is the run's transcript path
 * (unique per subagent run) and `from`/`to` name the models the routing
 * decision moved between. Zero-saving runs are skipped — they carry no
 * information the totals care about.
 */
export function recordDelegationEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return;
  const data = loadLedger();
  data.version = LEDGER_VERSION;
  let changed = false;
  for (const e of events) {
    if (!e || !e.key || !(Number(e.usd) > 0) || !Number.isFinite(e.ts)) continue;
    const prev = data.events[e.key];
    const usd = Math.round(Number(e.usd) * 10000) / 10000;
    if (prev && prev.ts === e.ts && prev.usd === usd) continue;
    data.events[e.key] = {
      ts: e.ts,
      usd,
      ...(e.rule ? { rule: e.rule } : {}),
      ...(e.from ? { from: e.from } : {}),
      ...(e.to ? { to: e.to } : {}),
    };
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
