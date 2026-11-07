#!/usr/bin/env node
// Offline-ish probe: is a decision model's confidence a usable escalation
// signal for sprag's tier routing?
//
// Hightouch (2026-11-04, "A Jev that can ask Opus for help") paired a cheap
// decision model with Opus: the cheap model judges first, and only judgements
// in a middle confidence band go to the frontier model. The pairing beat Opus
// alone only because the cheap model's errors sat in that band. A model that
// is wrong while confident (their GPT-6 Luna) never escalates its errors.
//
// This probe draws the same chart for sprag's own routing question. For every
// tierable episode in the local transcripts it asks Jev, from the request text
// alone (what a prompt-time hook would see), which tier the work belongs to,
// and compares the answer with the tier the episode actually ended in
// (tierOf, from the trajectory). Errors are then bucketed by Jev's confidence.
// If they cluster in a middle band, a confidence-gated cascade works; if they
// sit at the top, the model is overconfident on this distribution and a
// cascade would ship wrong hints.
//
// Paid: TypeSafe charges $0.042 per million input tokens. The probe prints the
// estimated cost first and refuses to run past COST_CAP_USD. Key: JEV_API_KEY
// (or TYPESAFE_API_KEY) in the environment or the project .env.
//
// Usage: node scripts/jev-calibration-probe.mjs [days=30] [--dry] [--json] [--out <file>]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  categorize, tierOf, calibrateThresholds, isSkippable, episodeRank, worthDelegating,
} from '../src/route-scan.js';
import { fold, loadEpisodes } from './lib/episodes.mjs';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const PRICE_PER_MTOK = 0.042;
const COST_CAP_USD = 0.10;
const STATE_MAX_CHARS = 4000;
const CONCURRENCY = 4;
const RANK = { T2: 0, T1: 1, T1H: 2, T0: 3 };

const argv = process.argv.slice(2);
const days = Number(argv.find((a) => /^\d+$/.test(a))) || 30;
const dry = argv.includes('--dry');
const asJson = argv.includes('--json');
const outIdx = argv.indexOf('--out');
const outFile = outIdx >= 0 ? argv[outIdx + 1] : null;

function apiKey() {
  if (process.env.JEV_API_KEY) return process.env.JEV_API_KEY;
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  if (!existsSync(envPath)) return null;
  const m = readFileSync(envPath, 'utf8').match(/^(?:JEV|TYPESAFE)_API_KEY=(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

// The tier descriptions mirror the criteria in ratchet-model.md / TIER_CRITERIA.md.
const QUESTIONS = {
  tier: {
    type: 'choice',
    instructions: 'The state is a request a developer typed to an AI coding agent (Korean or English). Which tier of model should handle it? Judge from the request alone.',
    criteria: {
      T2: 'A lookup, status check, or single command whose answer comes from the repository, files, or command output. Few steps, no real code edits. If it goes wrong, a build, test, or exit code says so.',
      T1: 'A multi-step but verifiable task: running builds, tests, or git across several steps; mechanical edits with the design already fixed; a lookup that needs several files.',
      T1H: 'A large implementation or debugging job with the design already fixed: many edits, long output, several errors to work through.',
      T0: 'Design decisions, root-cause diagnosis, security, deploy, release, merge, open-ended research, or any judgement whose failure is silent. Must stay on the strongest model.',
    },
  },
  delegable: {
    type: 'noul',
    instructions: 'Could a cheaper model than the strongest one handle this request safely, meaning its failure would surface loudly (test, build, exit code) rather than silently?',
  },
};

async function askJev(key, state) {
  const body = JSON.stringify({ model: MODEL, state, questions: QUESTIONS });
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body,
    });
    if (res.status === 429 || res.status === 529) {
      const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error('rate limited after 5 attempts');
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---- rows: same filter as prefix-routing-probe, plus the episodes the regex
// cannot categorize (a decision model is meant to cover exactly those).
const raw = await loadEpisodes(days);
const th = calibrateThresholds(raw.map((e) => fold(e.recs, e.text).out));
const UNCAT = { id: 'none' };
const rows = [];
for (const e of raw) {
  if (isSkippable(e.text)) continue;
  const full = fold(e.recs, e.text);
  if (!worthDelegating('T2', episodeRank(full))) continue;
  const cat = categorize(e.text, full.tools);
  const tier = tierOf(full, cat || UNCAT, th);
  if (!tier) continue;
  // Episodes tierOf sends to T0 from the text or from a delegation already made
  // carry no trajectory signal; the probe keeps the ones the trajectory decided.
  if (tier === 'T0' && (full.delegated > 0 || tierOf({ ...full, errors: 0, mutating: 0, out: 100, calls: 1 }, cat || UNCAT, th) === 'T0')) continue;
  rows.push({ cat: cat ? cat.id : null, tier, text: e.text, calls: full.calls, out: full.out });
}

// Category prior, in-sample, on the categorized subset (the figure TIER_CRITERIA reports).
const byCat = new Map();
for (const r of rows) {
  if (!r.cat) continue;
  const m = byCat.get(r.cat) || {};
  m[r.tier] = (m[r.tier] || 0) + 1;
  byCat.set(r.cat, m);
}
const prior = new Map([...byCat].map(([c, m]) => [c, Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]]));
const catRows = rows.filter((r) => r.cat);
const priorAccuracy = catRows.filter((r) => r.tier === prior.get(r.cat)).length / (catRows.length || 1);

const estTokens = rows.reduce((s, r) => s + Math.ceil(Math.min(r.text.length, STATE_MAX_CHARS) / 2.5) + 260, 0);
const estCost = estTokens / 1e6 * PRICE_PER_MTOK;
console.error(`window ${days}d · tierable episodes ${rows.length} (categorized ${catRows.length}, uncategorized ${rows.length - catRows.length}) · final tiers ${JSON.stringify(Object.fromEntries(Object.keys(RANK).map((t) => [t, rows.filter((r) => r.tier === t).length])))}`);
console.error(`category prior accuracy ${(priorAccuracy * 100).toFixed(1)}% on the categorized subset`);
console.error(`estimated Jev input ≈ ${estTokens} tokens ≈ $${estCost.toFixed(4)} (cap $${COST_CAP_USD})`);
if (dry) process.exit(0);
if (estCost > COST_CAP_USD) { console.error('over the cost cap; refusing'); process.exit(2); }
const key = apiKey();
if (!key) { console.error('no JEV_API_KEY / TYPESAFE_API_KEY'); process.exit(2); }

// ---- call
let spentTokens = 0;
let failures = 0;
const results = await mapLimit(rows, CONCURRENCY, async (r, i) => {
  try {
    const res = await askJev(key, r.text.slice(0, STATE_MAX_CHARS));
    spentTokens += res.usage?.input_tokens || 0;
    const a = res.answers.tier;
    if ((i + 1) % 50 === 0) console.error(`  ${i + 1}/${rows.length}`);
    return { ...r, jev: a.choice, conf: a.confidence, probs: a.probabilities, delegable: res.answers.delegable?.noul, model: res.model };
  } catch (err) {
    failures += 1;
    return { ...r, error: String(err.message || err) };
  }
});

// ---- analysis
const ok = results.filter((r) => !r.error);
const bin = (c) => Math.min(9, Math.floor(c * 10));
const buckets = Array.from({ length: 10 }, (_, i) => ({ from: i / 10, n: 0, wrong: 0, tooLow: 0 }));
for (const r of ok) {
  const b = buckets[bin(r.conf)];
  b.n += 1;
  if (r.jev !== r.tier) {
    b.wrong += 1;
    if (RANK[r.jev] < RANK[r.tier]) b.tooLow += 1;
  }
}
const accuracy = (xs) => xs.filter((r) => r.jev === r.tier).length / (xs.length || 1);
const tooLow = (xs) => xs.filter((r) => RANK[r.jev] < RANK[r.tier]).length;

// Cascade: accept Jev's tier at or above a confidence threshold, hand the rest
// to the session model (today's behaviour). Accepted-and-too-low is the harmful
// direction; accepted-and-too-high only forgoes a saving.
const cascade = [0.5, 0.6, 0.7, 0.8, 0.9].map((t) => {
  const acc = ok.filter((r) => r.conf >= t);
  return { threshold: t, accepted: acc.length, share: acc.length / (ok.length || 1), accuracy: accuracy(acc), tooLow: tooLow(acc), escalated: ok.length - acc.length };
});

const okCat = ok.filter((r) => r.cat);
const okUncat = ok.filter((r) => !r.cat);
const confusion = {};
for (const r of ok) {
  confusion[r.tier] ||= {};
  confusion[r.tier][r.jev] = (confusion[r.tier][r.jev] || 0) + 1;
}
const delegBins = Array.from({ length: 10 }, () => 0);
for (const r of ok) if (typeof r.delegable === 'number') delegBins[bin(r.delegable)] += 1;

const report = {
  days, model: ok[0]?.model, episodes: rows.length, answered: ok.length, failures,
  spentTokens, costUsd: spentTokens / 1e6 * PRICE_PER_MTOK,
  priorAccuracyCategorized: priorAccuracy,
  jevAccuracyAll: accuracy(ok), jevAccuracyCategorized: accuracy(okCat), jevAccuracyUncategorized: accuracy(okUncat),
  jevTooLowAll: tooLow(ok),
  priorTooLowCategorized: catRows.filter((r) => RANK[prior.get(r.cat)] < RANK[r.tier]).length,
  confidenceBuckets: buckets, cascade, confusion, delegableBins: delegBins,
};

if (outFile) writeFileSync(outFile, JSON.stringify({ report, rows: results }, null, 2));
if (asJson) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log(`Jev ${report.model} · answered ${ok.length}/${rows.length} (failures ${failures}) · spent ${spentTokens} tokens = $${report.costUsd.toFixed(4)}`);
console.log(`accuracy: regex prior ${pct(priorAccuracy)} (categorized ${catRows.length}) · Jev all ${pct(report.jevAccuracyAll)} · Jev categorized ${pct(report.jevAccuracyCategorized)} · Jev uncategorized ${pct(report.jevAccuracyUncategorized)} (${okUncat.length})`);
console.log(`sent too low: prior ${report.priorTooLowCategorized}/${catRows.length} · Jev ${report.jevTooLowAll}/${ok.length}`);
console.log('confidence   n   wrong  too-low   (wrong share)');
for (const b of buckets) {
  console.log(`  ${b.from.toFixed(1)}-${(b.from + 0.1).toFixed(1)}  ${String(b.n).padStart(4)}  ${String(b.wrong).padStart(5)}  ${String(b.tooLow).padStart(7)}   ${b.n ? pct(b.wrong / b.n) : '-'}`);
}
console.log('cascade (accept Jev at conf ≥ t, else session model decides):');
for (const c of cascade) {
  console.log(`  t=${c.threshold}: accepted ${c.accepted} (${pct(c.share)}) · accuracy in accepted ${pct(c.accuracy)} · too-low in accepted ${c.tooLow} · escalated ${c.escalated}`);
}
console.log(`confusion (rows = actual, cols = Jev): ${JSON.stringify(confusion)}`);
console.log(`delegable noul distribution by 0.1 bin: ${JSON.stringify(delegBins)}`);
