/**
 * usage-ledger: token usage per session, UTC day and model, kept after Claude
 * Code deletes the transcript (#15).
 *
 * Month spend is computed from transcripts, and Claude Code removes old ones.
 * A deleted session would drop out of the month's total and the figure would
 * shrink for no reason. This file keeps the tokens (never dollars), so cost is
 * still priced when it is read, at the price row of each day, and a later
 * price correction applies to the history too.
 *
 * Shape: `{ version: 1, writtenAt, sessions: { [id]: { days: { 'YYYY-MM-DD':
 * { [model]: totals } }, updatedAt } } }`. A subagent run is keyed
 * `<session id>/<agent file>`. Days are UTC days, because price rows change at
 * UTC midnight.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';
import { sumTotals } from './claude-price.js';
import { debug } from './debug.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Entries whose newest day is older than this are dropped on write.
const KEEP_DAYS = 400;
// The statusline calls this on every refresh; hourly is plenty for a history.
const THROTTLE_MS = 60 * 60 * 1000;

const ledgerPath = () => join(userDataDir(), 'usage-ledger.json');
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function load() {
  try {
    const data = JSON.parse(readFileSync(ledgerPath(), 'utf8'));
    if (data && data.version === 1 && data.sessions && typeof data.sessions === 'object') return data;
  } catch (e) {
    if (e && e.code !== 'ENOENT') debug('usage-ledger:load', e);
  }
  return { version: 1, sessions: {} };
}

/** `{ day: { model: totals } }` of a parsed session or subagent run, or null when it has no usable time. */
function daysOf(x) {
  if (!x) return null;
  if (x.dayTotals) return x.dayTotals;
  const t = x.startTime || x.endTime;
  const ms = t ? new Date(t).getTime() : NaN;
  if (!Number.isFinite(ms)) return null;
  const models = x.modelTotals || (x.totals ? { [x.model || 'unknown']: x.totals } : null);
  return models ? { [utcDay(ms)]: models } : null;
}

/**
 * Upsert the usage of the given sessions (and their subagent runs). Safe to
 * repeat: an entry is replaced by what the transcript says now, day by day, so
 * days only an earlier, wider parse knew about are kept. Skipped entirely when
 * the file was written less than an hour ago. Returns true when it wrote.
 */
export function recordUsage(sessions, { now = Date.now() } = {}) {
  const ledger = load();
  const age = now - (ledger.writtenAt || 0);
  if (ledger.writtenAt && age >= 0 && age < THROTTLE_MS) return false;

  const upsert = (id, days) => {
    if (!id || !days) return;
    const old = ledger.sessions[id];
    const merged = { ...(old ? old.days : {}), ...days };
    if (old && JSON.stringify(old.days) === JSON.stringify(merged)) return;
    ledger.sessions[id] = { days: merged, updatedAt: now };
  };
  for (const s of sessions || []) {
    if (!s) continue;
    upsert(s.sessionId, daysOf(s));
    for (const r of s.subagentRuns || []) if (s.sessionId && r.agent) upsert(`${s.sessionId}/${r.agent}`, daysOf(r));
  }

  const oldest = utcDay(now - KEEP_DAYS * DAY_MS);
  for (const [id, e] of Object.entries(ledger.sessions)) {
    const newest = Object.keys(e.days || {}).sort().pop();
    if (!newest || newest < oldest) delete ledger.sessions[id];
  }

  ledger.writtenAt = now;
  writeStateFile(ledgerPath(), JSON.stringify(ledger) + '\n');
  return true;
}

/**
 * Ledger usage from the UTC day of `sinceMs` on, as parts that partCost can
 * price (one per session and model). Entries named in `exclude` are skipped:
 * the caller already has those from a live transcript. `own` is false for a
 * subagent run, as for the parts pricedParts builds.
 */
export function usageSince(sinceMs, { exclude = new Set() } = {}) {
  const sinceDay = utcDay(sinceMs);
  const parts = [];
  for (const [id, e] of Object.entries(load().sessions)) {
    if (exclude.has(id)) continue;
    const byModel = {};
    for (const [day, models] of Object.entries(e.days || {})) {
      if (day < sinceDay) continue;
      for (const [model, totals] of Object.entries(models)) (byModel[model] ||= {})[day] = totals;
    }
    for (const [model, byDay] of Object.entries(byModel)) {
      const days = Object.keys(byDay).sort();
      parts.push({
        id,
        model,
        totals: sumTotals(days.map((d) => byDay[d])),
        at: Date.parse(`${days[0]}T12:00:00Z`),
        byDay,
        own: !id.includes('/'),
      });
    }
  }
  return parts;
}
