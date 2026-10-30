#!/usr/bin/env node
// Offline probe: how early does an episode's own trajectory reveal that it is
// heavier than its category suggests?
//
// SWE-Router (arXiv 2607.00053) argues that routing on the request text alone
// has an error floor in agentic work, and that reading the first few turns of
// a cheap run before committing is never worse. sprag routes on the request
// (category → tier rule) and stops a delegate at a fixed budget. This probe
// measures, on the local transcripts, what a checkpoint after K calls would
// add: for each tierable episode it compares
//   - the category prior: the tier most episodes of that category ended in;
//   - the prefix check: the first K calls already break the tier's limits
//     (mutation, tool errors, output), which tierOf would also reject.
// A prefix violation can only move a prediction upward, so it never raises a
// false alarm against the final tier; what it measures is how much of the
// prior's misses the first K calls already expose.
//
// Read-only. Usage: node scripts/prefix-routing-probe.mjs [days=30] [--json]

import { discoverSessionFiles } from '../src/parser.js';
import { collectSessionRecords } from '../src/session-records.js';
import {
  categorize, tierOf, calibrateThresholds, isSkippable, episodeRank, worthDelegating,
  T2_MAX_CALLS, T2_MAX_MUTATING, T1_MAX_MUTATING, T1_MAX_ERRORS,
} from '../src/route-scan.js';

const days = Number(process.argv.find((a) => /^\d+$/.test(a))) || 30;
const asJson = process.argv.includes('--json');
const KS = [1, 2, 3, 4, 6];
const RANK = { T2: 0, T1: 1, T1H: 2, T0: 3 };

/** Episodes as route-scan builds them, keeping the per-call records. */
function episodesOf(records) {
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
function fold(recs, text, k = recs.length) {
  const ep = { text, calls: 0, out: 0, mutating: 0, errors: 0, delegated: 0, models: new Set(), tools: {} };
  for (const r of recs.slice(0, k)) {
    ep.calls += 1;
    ep.out += r.completion_tokens || 0;
    ep.mutating += r.mutatingToolCalls || 0;
    ep.errors += r.toolErrors || 0;
    ep.delegated += r.delegationCalls || 0;
    ep.models.add(r.model);
    for (const [name, n] of Object.entries(r.toolCounts || {})) ep.tools[name] = (ep.tools[name] || 0) + n;
  }
  return ep;
}

/** Lowest tier the prefix still fits; a prefix only ever rules tiers out. */
function prefixFloor(p, th) {
  if (p.calls <= T2_MAX_CALLS && p.out <= th.t2Out && p.mutating <= T2_MAX_MUTATING && p.errors === 0) return 'T2';
  if (p.out <= th.t1Out && p.mutating <= T1_MAX_MUTATING && p.errors <= T1_MAX_ERRORS) return 'T1';
  return 'T1H';
}

const files = await discoverSessionFiles({ days });
const raw = [];
for (const f of files) {
  let records;
  try { records = await collectSessionRecords(f.path, { includeContent: true }); } catch { continue; }
  for (const e of episodesOf(records)) if (e.text) raw.push(e);
}
const th = calibrateThresholds(raw.map((e) => fold(e.recs, e.text).out));

const rows = [];
for (const e of raw) {
  if (isSkippable(e.text)) continue;
  const full = fold(e.recs, e.text);
  if (!worthDelegating('T2', episodeRank(full))) continue;
  const cat = categorize(e.text, full.tools);
  const tier = tierOf(full, cat, th);
  if (!tier || !cat) continue;
  // tierOf sends judgement keywords and episodes that already delegated to T0
  // before looking at the trajectory; no checkpoint would change those.
  if (tier === 'T0' && (full.delegated > 0 || tierOf({ ...full, errors: 0, mutating: 0, out: 100, calls: 1 }, cat, th) === 'T0')) continue;
  rows.push({ cat: cat.id, tier, recs: e.recs, text: e.text, calls: full.calls });
}

// Category prior, fitted in-sample: the most generous reading of request-only routing.
const byCat = new Map();
for (const r of rows) {
  const m = byCat.get(r.cat) || {};
  m[r.tier] = (m[r.tier] || 0) + 1;
  byCat.set(r.cat, m);
}
const prior = new Map([...byCat].map(([c, m]) => [c, Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]]));

const priorMiss = rows.filter((r) => RANK[r.tier] > RANK[prior.get(r.cat)]);
const result = {
  days, thresholds: th, episodes: rows.length,
  finalTiers: Object.fromEntries(Object.keys(RANK).map((t) => [t, rows.filter((r) => r.tier === t).length])),
  priorAccuracy: rows.filter((r) => r.tier === prior.get(r.cat)).length / (rows.length || 1),
  priorUnderestimates: priorMiss.length,
  checkpoints: KS.map((k) => {
    // Of the episodes the prior sent too low, how many had shown it by call k
    // (and had not already finished, i.e. a checkpoint at k would still fire)?
    const caught = priorMiss.filter((r) => r.calls > k && RANK[prefixFloor(fold(r.recs, r.text, k), th)] > RANK[prior.get(r.cat)]);
    // Calls a cheap delegate would spend before the checkpoint on those episodes.
    return { k, caught: caught.length, share: caught.length / (priorMiss.length || 1), stillRunning: priorMiss.filter((r) => r.calls > k).length };
  }),
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`window ${days}d · tierable episodes ${rows.length} · final tiers ${JSON.stringify(result.finalTiers)}`);
  console.log(`category prior: accuracy ${(result.priorAccuracy * 100).toFixed(1)}% · sent too low ${priorMiss.length}`);
  for (const c of result.checkpoints) {
    console.log(`  checkpoint after ${c.k} call(s): exposes ${c.caught}/${priorMiss.length} (${(c.share * 100).toFixed(0)}%) · still running ${c.stillRunning}`);
  }
}
