/**
 * effort-raise-ledger — one event per subagent run the delegation guard raised
 * to high effort (the run's first prompt ends with EFFORT_RAISE_MARKER).
 *
 * The count used to live in the route-scan cache, so it covered only the scan
 * window and went stale after `sprag saved reset routing` until the next scan.
 * Routing saved is a ledger read live with the reset mark; this one is read the
 * same way, so both zero out together.
 *
 * File: <userDataDir>/effort-raise-ledger.json
 *   { "version": 1, "events": { "<run transcript path>": { "ts", "cost"?, "model"? } } }
 *
 * Keyed by the run's transcript path and upserted by run identity, like the
 * delegation ledger, so overlapping scans and renamed project folders never
 * count a run twice. The ledger is evidence: the reset mark is applied when the
 * totals are read, not when events are recorded.
 *
 * `kept` joins each raised run to its delegation-ledger event (priced live) and
 * sums the routing saving those runs produced. It is a subset of Routing saved,
 * never added to it.
 *
 * Best-effort like every other state file here: nothing throws, and an
 * unreadable or wrong-version file reads as empty.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';
import { readResetMarks, isBeforeReset } from './saved-reset.cjs';
import { loadLedger, runIdentity, roundUsd } from './savings-ledger.js';

export const EFFORT_RAISE_LEDGER_VERSION = 1;

export function effortRaiseLedgerPath(dir = userDataDir()) {
  return join(dir, 'effort-raise-ledger.json');
}

export function loadEffortRaiseLedger(dir = userDataDir()) {
  try {
    const data = JSON.parse(readFileSync(effortRaiseLedgerPath(dir), 'utf8'));
    if (!data || data.version !== EFFORT_RAISE_LEDGER_VERSION
      || typeof data.events !== 'object' || data.events === null || Array.isArray(data.events)) {
      return { version: EFFORT_RAISE_LEDGER_VERSION, events: {} };
    }
    return data;
  } catch {
    return { version: EFFORT_RAISE_LEDGER_VERSION, events: {} };
  }
}

/**
 * Upsert raise events: [{ key, ts, cost?, model? }]. `key` is the run's
 * transcript path. Entries without a key or a finite ts are skipped, and the
 * file is written only when something changed.
 */
export function recordEffortRaises(events, dir = userDataDir()) {
  try {
    if (!Array.isArray(events) || events.length === 0) return;
    const data = loadEffortRaiseLedger(dir);
    let changed = false;
    const keyOf = new Map(Object.keys(data.events).map((k) => [runIdentity(k), k]));
    for (const e of events) {
      if (!e || !e.key || !Number.isFinite(e.ts)) continue;
      const id = runIdentity(e.key);
      const prevKey = keyOf.get(id) ?? e.key;
      const prev = data.events[prevKey];
      const cost = Number.isFinite(e.cost) ? roundUsd(e.cost) : undefined;
      const model = typeof e.model === 'string' && e.model ? e.model : undefined;
      if (prev && prevKey === e.key && prev.ts === e.ts && prev.cost === cost && prev.model === model) continue;
      if (prevKey !== e.key) delete data.events[prevKey];
      keyOf.set(id, e.key);
      data.events[e.key] = {
        ts: e.ts,
        ...(cost !== undefined ? { cost } : {}),
        ...(model !== undefined ? { model } : {}),
      };
      changed = true;
    }
    if (!changed) return;
    writeStateFile(effortRaiseLedgerPath(dir), JSON.stringify(data) + '\n');
  } catch {
    // totals just stay stale until the next successful scan
  }
}

/**
 * { count, cost, costMissing, kept, keptRuns, since } over the events after the
 * `routing` reset mark. `cost` is what the raised runs cost, `kept` the routing
 * saving the same runs produced (their delegation-ledger `usd`), over the
 * `keptRuns` runs that have one. Never throws.
 */
export function effortRaiseTotals(now = Date.now(), dir = userDataDir()) { // eslint-disable-line no-unused-vars
  const since = readResetMarks(dir).routing;
  const zero = { count: 0, cost: 0, costMissing: 0, kept: 0, keptRuns: 0, since };
  try {
    const delegated = new Map();
    for (const [key, e] of Object.entries(loadLedger().events)) delegated.set(runIdentity(key), e);
    const totals = { ...zero };
    for (const [key, e] of Object.entries(loadEffortRaiseLedger(dir).events)) {
      if (!e || isBeforeReset(e.ts, since)) continue;
      totals.count += 1;
      if (Number.isFinite(e.cost)) totals.cost += e.cost;
      else totals.costMissing += 1;
      const usd = Number(delegated.get(runIdentity(key))?.usd);
      if (Number.isFinite(usd)) {
        totals.kept += usd;
        totals.keptRuns += 1;
      }
    }
    totals.cost = Math.round(totals.cost * 100) / 100;
    totals.kept = Math.round(totals.kept * 100) / 100;
    return totals;
  } catch {
    return zero;
  }
}
