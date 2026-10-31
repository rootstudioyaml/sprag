/**
 * savings-ledger — per-run delegation saving events with timestamps.
 *
 * model-rules.json stores `savedUsd` as a scan-window snapshot per rule (only
 * the runs dated after the last `sprag saved reset routing`), which is right
 * for rule-health but cannot answer "how much did routing save this
 * week / this month / ever". This ledger keeps one event per subagent run,
 * keyed by the run's transcript path so re-scans over overlapping windows
 * upsert instead of double-counting.
 *
 * File: <userDataDir>/delegation-ledger.json
 *   { "version": 3,
 *     "events": { "<run path>": { "ts", "usd", "cost", "rule", "from", "to",
 *                                 "basis", "priceSource", "baselineSource" } } }
 *
 * Version 3 prices a run on the net-saving basis (src/net-saving.js), and each
 * event says how it was priced: `basis` 'v3' (cache re-reads and carried
 * context counted) or 'v2' (run tokens repriced only, used when the main
 * session's numbers could not be read), `priceSource` 'list' | 'gateway', and
 * `baselineSource` 'episode' (the episode's own main model) | 'rule' (the
 * rule's stored baseline, when that model had no price). Version 2 events keep
 * their value and read as basis v2; a rescan reprices those still inside the
 * scan window as v3 and leaves the older ones alone.
 *
 * `from`/`to` are the models the routing decision moved between, and `usd` is
 * the price difference between them for this run's tokens. `cost` is what the
 * run itself cost on the model it ran on, so the statusline can show what the
 * saving was bought with. Events written before `cost` existed lack it until a
 * scan that still covers the run fills it in. Version 1 priced
 * every downgraded subagent run against the session's priciest model, which
 * credited the tool for runs no rule of its own had routed; those events are
 * discarded rather than migrated, since the number they carry cannot be
 * recomputed without a rescan (which route-scan does anyway).
 *
 * Best-effort like every other state file here: an unreadable ledger reads as
 * empty, and the statusline renders totals of 0 as "no chip".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';
import { readResetMarks, isBeforeReset } from './saved-reset.cjs';

const WEEK_MS = 7 * 24 * 3600 * 1000;
const MONTH_MS = 30 * 24 * 3600 * 1000;

/** Stored USD is kept to 4 decimals so re-scans compare equal and files stay small. */
export const roundUsd = (usd) => Math.round(Number(usd) * 10000) / 10000;

export function ledgerPath() {
  return join(userDataDir(), 'delegation-ledger.json');
}

export const LEDGER_VERSION = 3;
// Version 2 differs only in lacking the basis fields, so it is read as is.
const READABLE_VERSIONS = new Set([2, LEDGER_VERSION]);

/**
 * Which run a ledger key names, wherever its transcript sits:
 * `<session id>/subagents/<agent file>`. A project folder that was renamed or
 * copied holds the same run under two paths, and keyed by full path alone the
 * ledger counted its saving twice. Keys that are not subagent transcript paths
 * identify themselves.
 */
export function runIdentity(key) {
  const parts = String(key).split(/[\\/]/);
  const i = parts.lastIndexOf('subagents');
  return i > 0 ? parts.slice(i - 1).join('/') : String(key);
}

export function loadLedger() {
  try {
    const data = JSON.parse(readFileSync(ledgerPath(), 'utf8'));
    if (!data || typeof data.events !== 'object' || data.events === null) {
      return { version: LEDGER_VERSION, events: {} };
    }
    // Pre-v2 events were priced against a different counterfactual — drop them
    // instead of mixing two meanings into one total. The next scan rebuilds
    // whatever is still attributable. v2 events are kept: they are the same
    // kind of figure (basis v2), only unlabelled.
    if (!READABLE_VERSIONS.has(data.version)) return { version: LEDGER_VERSION, events: {} };
    data.version = LEDGER_VERSION;
    // One event per run: duplicates recorded from a second copy of the same
    // transcript are dropped here, so every reader sums each run once and the
    // next write persists the cleanup.
    const seen = new Set();
    for (const key of Object.keys(data.events)) {
      const id = runIdentity(key);
      if (seen.has(id)) delete data.events[key];
      else seen.add(id);
    }
    return data;
  } catch {
    return { version: LEDGER_VERSION, events: {} };
  }
}

/**
 * Upsert saving events. `events` is an array of
 * { key, ts, usd, cost, rule, from, to, basis, priceSource, baselineSource } where `key` is the run's transcript
 * path (unique per subagent run) and `from`/`to` name the models the routing
 * decision moved between. `usd` is signed: a run on a pricier model is a loss
 * and is recorded as a negative amount so it reduces the totals. Only
 * non-finite amounts (unpriced runs) are skipped. A non-finite `cost` is left
 * out of the event while its saving is still recorded.
 */
export function recordDelegationEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return;
  const data = loadLedger();
  data.version = LEDGER_VERSION;
  let changed = false;
  // Earliest moment whose figures this call changed. A rescan that reprices or
  // finds a run from days ago changes a day the team sync already uploaded;
  // changedSince tells it to reach back that far (see changedSinceForSync).
  let earliest = Infinity;
  const keyOf = new Map(Object.keys(data.events).map((k) => [runIdentity(k), k]));
  for (const e of events) {
    if (!e || !e.key || typeof e.usd !== 'number' || !Number.isFinite(e.usd) || !Number.isFinite(e.ts)) continue;
    // The run may already be recorded under the path of another copy of its
    // transcript; that entry is the one to compare with and to replace.
    const id = runIdentity(e.key);
    const prevKey = keyOf.get(id) ?? e.key;
    const prev = data.events[prevKey];
    const usd = roundUsd(e.usd);
    const cost = Number.isFinite(e.cost) ? roundUsd(e.cost) : undefined;
    // An event recorded before `cost` existed compares unequal here, so the
    // first scan that still covers the run fills its cost in.
    // The same goes for the basis fields: a v2 event rescanned as v3 differs.
    if (prev && prev.ts === e.ts && prev.usd === usd && prev.cost === cost
      && prev.basis === (e.basis || undefined) && prev.priceSource === (e.priceSource || undefined)
      && prev.baselineSource === (e.baselineSource || undefined)) continue;
    earliest = Math.min(earliest, e.ts, Number.isFinite(prev?.ts) ? prev.ts : Infinity);
    if (prevKey !== e.key) delete data.events[prevKey];
    keyOf.set(id, e.key);
    data.events[e.key] = {
      ts: e.ts,
      usd,
      ...(cost !== undefined ? { cost } : {}),
      ...(e.rule ? { rule: e.rule } : {}),
      ...(e.from ? { from: e.from } : {}),
      ...(e.to ? { to: e.to } : {}),
      ...(e.basis ? { basis: e.basis } : {}),
      ...(e.priceSource ? { priceSource: e.priceSource } : {}),
      ...(e.baselineSource ? { baselineSource: e.baselineSource } : {}),
    };
    changed = true;
  }
  if (!changed) return;
  if (Number.isFinite(earliest)) {
    data.changedSince = Math.min(Number.isFinite(data.changedSince) ? data.changedSince : Infinity, earliest);
    data.changeSeq = (Number(data.changeSeq) || 0) + 1;
  }
  try {
    writeStateFile(ledgerPath(), JSON.stringify(data) + '\n');
  } catch {
    // statusline totals just stay stale until the next successful scan
  }
}

/**
 * The ledger's pending change mark, for the team sync: `since` is the earliest
 * event time a recordDelegationEvents call changed after the last upload, and
 * `seq` identifies that state so the sync clears only what it uploaded.
 * null when nothing changed.
 */
export function changedSinceForSync() {
  const data = loadLedger();
  // Ledgers written before the mark existed may already hold repriced days
  // (the v3 rescan) that went up with old figures. The first sync after the
  // upgrade re-sends every event it can reach once; uploads are upserts.
  if (data.changeTracking !== 1) {
    const ts = Object.values(data.events).map((e) => e?.ts).filter(Number.isFinite);
    const since = Math.min(...ts, Number.isFinite(data.changedSince) ? data.changedSince : Infinity);
    return { since: Number.isFinite(since) ? since : Date.now(), seq: Number(data.changeSeq) || 0, initial: true };
  }
  return Number.isFinite(data.changedSince) ? { since: data.changedSince, seq: Number(data.changeSeq) || 0 } : null;
}

/**
 * Clear the change mark once the team sync uploaded from its day onward. A
 * scan that changed the ledger again in the meantime bumped `seq`; the mark is
 * then kept, so the next sync covers that change too.
 */
export function clearChangedSince(seq) {
  const data = loadLedger();
  if ((Number(data.changeSeq) || 0) !== seq) return false;
  if (!Number.isFinite(data.changedSince) && data.changeTracking === 1) return false;
  delete data.changedSince;
  data.changeTracking = 1;
  try {
    writeStateFile(ledgerPath(), JSON.stringify(data) + '\n');
    return true;
  } catch {
    return false;
  }
}

/**
 * Family name of a model id, with the version dropped: `claude-opus-5` and
 * `claude-opus-4-5-20251101-v1:0` both read as `opus`.
 *
 * Versions move constantly, and on a statusline the digits are noise — what
 * the reader wants is the shape of the trade ("opus work now runs on haiku").
 * Falls back to the id itself so an unmapped name is visible rather than
 * silently folded into another family.
 */
export function modelFamily(model) {
  const m = String(model || '').toLowerCase();
  for (const f of ['fable', 'mythos', 'opus', 'sonnet', 'haiku']) {
    if (m.includes(f)) return f;
  }
  return String(model || '?');
}

/**
 * Rolling totals: last 7 days, last 30 days, and lifetime, plus `pairs` — the
 * lifetime rollup by family-level model change, priciest first. `now` is
 * injectable for tests. Never throws — an unreadable ledger yields zeros.
 *
 * `spent` is the lifetime sum of what the same runs cost on the models they
 * ran on, and `spentMissing` counts the runs whose event carries no `cost`
 * (written before the field existed, or unpriced), which `spent` leaves out.
 *
 * Events before the `routing` reset mark (`sprag saved reset`) are skipped
 * everywhere, and `since` reports the mark (null when never reset). `dir` is
 * the user data directory the mark is read from.
 */
export function delegationSavedTotals(now = Date.now(), dir = userDataDir()) {
  const since = readResetMarks(dir).routing;
  const empty = () => ({ week: 0, month: 0, total: 0, spent: 0, spentMissing: 0, pairs: [], since });
  const totals = empty();
  const byPair = new Map();
  try {
    for (const e of Object.values(loadLedger().events)) {
      if (isBeforeReset(e.ts, since)) continue;
      const usd = Number(e.usd);
      if (!Number.isFinite(usd)) continue;
      totals.total += usd;
      if (Number.isFinite(e.cost)) totals.spent += e.cost;
      else totals.spentMissing += 1;
      if (Number.isFinite(e.ts)) {
        if (now - e.ts <= WEEK_MS) totals.week += usd;
        if (now - e.ts <= MONTH_MS) totals.month += usd;
      }
      if (!e.from || !e.to) continue;
      const key = `${modelFamily(e.from)}→${modelFamily(e.to)}`;
      const p = byPair.get(key) || { from: modelFamily(e.from), to: modelFamily(e.to), runs: 0, usd: 0 };
      p.runs += 1;
      p.usd += usd;
      byPair.set(key, p);
    }
  } catch {
    return empty();
  }
  totals.pairs = [...byPair.values()].sort((a, b) => b.usd - a.usd);
  return totals;
}
