// Episode helpers for the offline routing probes. route-scan builds episodes
// the same way but keeps only the totals; the probes need the per-call records
// too, to look at a prefix of a run or at when it happened.

import { discoverSessionFiles } from '../../src/parser.js';
import { collectSessionRecords } from '../../src/session-records.js';

/** Group a session's records into episodes (consecutive same trigger prompt). */
export function episodesOf(records) {
  const out = [];
  let cur = null;
  for (const r of records) {
    const text = (r.userText || '').trim();
    if (!cur || cur.text !== text) {
      cur = { text, recs: [] };
      out.push(cur);
    }
    cur.recs.push(r);
  }
  return out;
}

/** Fold the first `k` calls (all when k is omitted) into tierOf's episode shape. */
export function fold(recs, text, k = recs.length) {
  const ep = { text, calls: 0, out: 0, mutating: 0, errors: 0, delegated: 0, models: new Set(), tools: {}, startedAt: null };
  for (const r of recs.slice(0, k)) {
    ep.calls += 1;
    ep.out += r.completion_tokens || 0;
    ep.mutating += r.mutatingToolCalls || 0;
    ep.errors += r.toolErrors || 0;
    ep.delegated += r.delegationCalls || 0;
    ep.models.add(r.model);
    for (const [name, n] of Object.entries(r.toolCounts || {})) ep.tools[name] = (ep.tools[name] || 0) + n;
    const t = r.timestamp ? Date.parse(r.timestamp) : NaN;
    if (Number.isFinite(t) && (ep.startedAt === null || t < ep.startedAt)) ep.startedAt = t;
  }
  return ep;
}

/** Every non-empty episode in the last `days` days of local transcripts. */
export async function loadEpisodes(days) {
  const files = await discoverSessionFiles({ days });
  const raw = [];
  for (const f of files) {
    let records;
    try { records = await collectSessionRecords(f.path, { includeContent: true }); } catch { continue; }
    for (const e of episodesOf(records)) if (e.text) raw.push(e);
  }
  return raw;
}
