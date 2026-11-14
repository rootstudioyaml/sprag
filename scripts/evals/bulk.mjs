#!/usr/bin/env node
/**
 * Aggregate graded bulk rounds (round.tier "numbers") into evals/bulk.json for the proof page.
 *
 *   node scripts/evals/bulk.mjs <round-dir> [...more round dirs] [--compare <round-dir> <round-dir> ...]
 *
 * --noise <round-dir> adds `noise`: a round whose compared lane is the baseline model run a second time, so the
 * page can show how often Opus agrees with itself under the same grader.
 * --up <round-dir> adds `up`: a verify round (grading "verify", scripts/evals/upround.mjs) summarised per condition over
 * the cases graded under every condition, to show what moving up a tier or an effort level buys.
 * --impl <round-dir> adds `impl`: an implementation round (scripts/evals/implround.mjs) summarised like --up, plus per
 * condition the grader's test outcomes { pass, fail, none } and the summed diff size { files, insertions, deletions }.
 * --impl-large <round-dir> adds `implLarge`: the --impl summary over a round of larger implementations.
 * --impl-spec <round-B-dir> --spec <round-A-dir> adds `implSpec` (scripts/evals/specround.mjs): the --impl summary over the
 * round where a worker implements from a specification the main model wrote under the current standard, plus
 * `spec` { n, usd, sec } (what round A, the specification step, cost over the cases that reached round B) and
 * `capLines` { implementation, own, numeric } (which cap line each specification got). The two flags go together.
 * --compare lists two or more rounds in order and adds `compare` to the output: over the cases graded in all of
 * them, one step per round with its rule tag and verdict counts, pick dollars and seconds, plus the first round's
 * baseline dollars. The positional rounds still form the main aggregate.
 *
 * A case counts when both its routed lane (A or S) and its opus baseline have a graded score. A case kept on
 * main (conditions hold only the baseline) counts as ok with the baseline run as its pick; see totals.keptMain.
 * A case whose blind verdict was overturned by a later check carries meta.recheck in round.json, set by hand:
 * { verdict, baseline, cause }. `verdict` replaces the lane's graded verdict in every count, `baseline` (default ok)
 * is what the reference itself turned out to be, and the row keeps the blind grade as `graded` so the page can
 * show both. totals.rechecked and byKind[kind].rechecked count such cases. Only counts,
 * dollars and seconds leave the machine: no prompts, no paths, no rule names. The `cases` array holds one
 * numbers-only row per case (kind, lane, verdict, dollars, seconds). build.mjs attaches the file as siteData.bulk.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJson, exactUsd, ratesFor, pyRound, shortModel, VERDICT, isMain } from './lib.mjs';

const emptyRow = () => ({ n: 0, ok: 0, partial: 0, fail: 0, pickUsd: 0, opusUsd: 0, pickSec: 0, opusSec: 0 });
/** Unrounded dollars when the token totals are there; the stored 2-decimal figure otherwise. */
const usdOf = (c) => {
  if (c?.totals && c.model) { try { return exactUsd(c.totals, ratesFor(c.model, String(c.at || '').slice(0, 10) || undefined)); } catch { /* fall back */ } }
  return Number(c?.usd) || 0;
};
const verdictOf = (s) => s?.verdict || VERDICT[s?.relay];
const VERDICTS = ['ok', 'partial', 'fail'];
/** The hand-set correction of a case's blind verdict (meta.recheck), or null. */
const recheckOf = (c) => {
  const r = c.meta?.recheck;
  if (!r || !VERDICTS.includes(r.verdict)) return null;
  return { verdict: r.verdict, baseline: VERDICTS.includes(r.baseline) ? r.baseline : 'ok', cause: typeof r.cause === 'string' ? r.cause : '' };
};

/** Pure: rounds = [{ round, runs, cost, scores }] -> the bulk aggregate. */
export function aggregateBulk(rounds) {
  const byKind = {}; const totals = emptyRow(); const pickModels = { haiku: 0, sonnet: 0 }; const ids = []; const cases = [];
  for (const { round, runs, cost, scores } of rounds) {
    if (round.tier !== 'numbers' || round.grading === 'verify') continue; // verify rounds go through upRound
    ids.push(round.id);
    const base = round.conditions.find((c) => c.role === 'baseline');
    const keyOf = (caseId, cond) => Object.keys(runs).find((k) => runs[k].case === caseId && runs[k].condition === cond.id && k in scores);
    for (const c of round.cases) {
      if (typeof c.meta?.excluded === 'string' && c.meta.excluded) continue; // set by hand, e.g. 'bash-writes'
      const lane = round.conditions.find((x) => x.key !== base.key && (c.conditions || []).includes(x.key));
      // A case whose only condition is the baseline stays on the main model: its pick is the baseline run itself.
      const keptMain = !lane && Array.isArray(c.conditions) && c.conditions.length > 0 && c.conditions.every((k) => k === base.key);
      if (!lane && !keptMain) continue;
      const bk = keyOf(c.id, base);
      const pk = keptMain ? bk : keyOf(c.id, lane);
      if (!pk || !bk) continue;
      const v = keptMain ? 'ok' : verdictOf(scores[pk]);
      if (!['ok', 'partial', 'fail'].includes(v)) continue;
      const kind = c.meta?.kind || 'other';
      const rc = keptMain ? null : recheckOf(c);
      const pv = rc ? rc.verdict : v; // the verdict that is published
      for (const row of [byKind[kind] ||= emptyRow(), totals]) {
        row.n++; row[pv]++;
        if (keptMain) row.keptMain = (row.keptMain || 0) + 1; // absent when no case stayed on main
        if (rc) row.rechecked = (row.rechecked || 0) + 1; // absent when no verdict was overturned
        row.pickUsd += usdOf(cost[pk]); row.opusUsd += usdOf(cost[bk]);
        row.pickSec += (cost[pk]?.ms || 0) / 1000; row.opusSec += (cost[bk]?.ms || 0) / 1000;
      }
      const pickCond = keptMain ? base : lane;
      const fam = shortModel(pickCond.model);
      if (fam in pickModels) pickModels[fam]++; else if (keptMain) pickModels[fam] = (pickModels[fam] || 0) + 1;
      // One numbers-only row per case, so the page can flow it through the diagram like a graded case.
      cases.push({ kind, lane: pickCond.id, verdict: pv, pickUsd: pyRound(usdOf(cost[pk]), 4), opusUsd: pyRound(usdOf(cost[bk]), 4),
        pickSec: Math.round((cost[pk]?.ms || 0) / 1000), opusSec: Math.round((cost[bk]?.ms || 0) / 1000),
        ...(rc ? { graded: v, opusVerdict: rc.baseline, recheck: rc.cause } : {}) });
    }
  }
  const fin = (r) => ({ ...r, pickUsd: pyRound(r.pickUsd, 4), opusUsd: pyRound(r.opusUsd, 4), pickSec: Math.round(r.pickSec), opusSec: Math.round(r.opusSec) });
  return {
    rounds: ids, n: totals.n,
    byKind: Object.fromEntries(Object.keys(byKind).sort().map((k) => [k, fin(byKind[k])])),
    totals: fin(totals), pickModels, cases,
  };
}

/** Pure: the per-case outcome the aggregate uses, or null when the case is excluded or not graded. */
function caseOutcome({ round, runs, cost, scores }, c) {
  if (typeof c.meta?.excluded === 'string' && c.meta.excluded) return null;
  const base = round.conditions.find((x) => x.role === 'baseline');
  const keyOf = (cond) => Object.keys(runs).find((k) => runs[k].case === c.id && runs[k].condition === cond.id && k in scores);
  const lane = round.conditions.find((x) => x.key !== base.key && (c.conditions || []).includes(x.key));
  const keptMain = !lane && Array.isArray(c.conditions) && c.conditions.length > 0 && c.conditions.every((k) => k === base.key);
  if (!lane && !keptMain) return null;
  const bk = keyOf(base); const pk = keptMain ? bk : keyOf(lane);
  if (!pk || !bk) return null;
  const v = keptMain ? 'ok' : verdictOf(scores[pk]);
  if (!['ok', 'partial', 'fail'].includes(v)) return null;
  const rc = keptMain ? null : recheckOf(c);
  return { verdict: rc ? rc.verdict : v, pickUsd: usdOf(cost[pk]), opusUsd: usdOf(cost[bk]), pickSec: (cost[pk]?.ms || 0) / 1000 };
}

/** Pure: loaded rounds in order -> { n, opusUsd, steps } over the cases graded in every round. */
export function compareRounds(loaded) {
  const per = loaded.map((l) => new Map(l.round.cases.map((c) => [c.id, caseOutcome(l, c)]).filter(([, o]) => o)));
  const common = [...(per[0] || new Map()).keys()].filter((id) => per.every((m) => m.has(id)));
  const steps = loaded.map((l, i) => {
    const st = { round: l.round.id, rule: l.round.rule || 'v0', ok: 0, partial: 0, fail: 0, pickUsd: 0, pickSec: 0 };
    for (const id of common) { const o = per[i].get(id); st[o.verdict]++; st.pickUsd += o.pickUsd; st.pickSec += o.pickSec; }
    return { ...st, pickUsd: pyRound(st.pickUsd, 4), pickSec: Math.round(st.pickSec) };
  });
  const opusUsd = common.reduce((t, id) => t + per[0].get(id).opusUsd, 0);
  return { n: common.length, opusUsd: pyRound(opusUsd, 4), steps };
}

/** Pure: one round where the compared lane is a second run of the baseline model -> how often Opus agrees with itself. */
export function noiseRound(loaded) {
  const out = { round: loaded.round.id, n: 0, ok: 0, partial: 0, fail: 0, pickUsd: 0, opusUsd: 0 };
  for (const c of loaded.round.cases) { const o = caseOutcome(loaded, c); if (!o) continue; out.n++; out[o.verdict]++; out.pickUsd += o.pickUsd; out.opusUsd += o.opusUsd; }
  return { ...out, pickUsd: pyRound(out.pickUsd, 4), opusUsd: pyRound(out.opusUsd, 4) };
}

/**
 * Pure: a verify round -> one row per condition over the cases graded under every condition (excluded cases skipped).
 * model is the family name (haiku/sonnet/opus), as in every public figure.
 */
/** Pure: per case graded under every condition (excluded cases skipped), the run key of each condition in round order. */
function gradedUnderAll({ round, runs, scores }) {
  const out = [];
  for (const c of round.cases) {
    if (typeof c.meta?.excluded === 'string' && c.meta.excluded) continue;
    const keys = round.conditions.map((cond) => Object.keys(runs).find((k) => runs[k].case === c.id && runs[k].condition === cond.id && !scores[k]?.reference && ['ok', 'partial', 'fail'].includes(verdictOf(scores[k]))));
    if (!keys.some((k) => !k)) out.push(keys);
  }
  return out;
}

export function upRound(loaded) {
  const { round, runs, cost, scores } = loaded;
  if (round.grading !== 'verify') throw new Error(`round ${round.id} is not a verify round`);
  const rows = round.conditions.map((c) => ({ id: c.id, model: shortModel(c.model), effort: c.effort, n: 0, ok: 0, partial: 0, fail: 0, verified: 0, wrong: 0, missed: 0, usd: 0, sec: 0 }));
  let n = 0;
  for (const keys of gradedUnderAll(loaded)) {
    n++;
    keys.forEach((k, i) => {
      const r = rows[i], s = scores[k];
      r.n++; r[verdictOf(s)]++;
      for (const f of ['verified', 'wrong', 'missed']) r[f] += Number(s[f]) || 0;
      r.usd += usdOf(cost[k]); r.sec += (cost[k]?.ms || 0) / 1000;
    });
  }
  return { round: round.id, n, conditions: rows.map((r) => ({ ...r, usd: pyRound(r.usd, 4), sec: Math.round(r.sec) })) };
}

/**
 * Pure: an implementation round -> upRound's rows plus, over the same cases, the test outcomes and the summed diff size
 * per condition id. A score without a valid "tests" value counts as none; the diff comes from cost.json (replay.mjs).
 */
export function implRound(loaded) {
  const up = upRound(loaded);
  const { round, cost, scores } = loaded;
  const tests = Object.fromEntries(round.conditions.map((c) => [c.id, { pass: 0, fail: 0, none: 0 }]));
  const diff = Object.fromEntries(round.conditions.map((c) => [c.id, { files: 0, insertions: 0, deletions: 0 }]));
  for (const keys of gradedUnderAll(loaded)) {
    keys.forEach((k, i) => {
      const id = round.conditions[i].id; const t = scores[k]?.tests;
      tests[id][t === 'pass' || t === 'fail' ? t : 'none']++;
      for (const f of ['files', 'insertions', 'deletions']) diff[id][f] += Number(cost[k]?.diff?.[f]) || 0;
    });
  }
  return { ...up, tests, diff };
}

/**
 * Pure: the specification round (B: a worker implements from a written specification) -> implRound's summary plus what
 * the specification step (round A) cost over the cases present in B, and how many specifications got each cap line.
 */
export function implSpecRound(loaded, specLoaded) {
  const spec = { n: 0, usd: 0, sec: 0 }; const capLines = { implementation: 0, own: 0, numeric: 0 };
  for (const c of loaded.round.cases) {
    if (c.meta?.capLine in capLines) capLines[c.meta.capLine]++;
    const k = Object.keys(specLoaded.runs).find((x) => specLoaded.runs[x].case === c.id);
    if (!k) continue;
    spec.n++; spec.usd += usdOf(specLoaded.cost[k]); spec.sec += (specLoaded.cost[k]?.ms || 0) / 1000;
  }
  return { ...implRound(loaded), spec: { n: spec.n, usd: pyRound(spec.usd, 4), sec: Math.round(spec.sec) }, capLines };
}

export function loadRound(dir) {
  dir = resolve(dir);
  return {
    round: readJson(join(dir, 'round.json')), runs: readJson(join(dir, 'runs.json'), {}),
    cost: readJson(join(dir, 'cost.json'), {}), scores: readJson(join(dir, 'scores_by_run.json'), {}),
  };
}

export function main(argv = [], { out = new URL('../../evals/bulk.json', import.meta.url).pathname, log = console.log } = {}) {
  const ni = argv.indexOf('--noise'); const noise = ni >= 0 ? argv[ni + 1] : null;
  if (ni >= 0) argv = argv.slice(0, ni).concat(argv.slice(ni + 2));
  const ui = argv.indexOf('--up'); const up = ui >= 0 ? argv[ui + 1] : null;
  if (ui >= 0) argv = argv.slice(0, ui).concat(argv.slice(ui + 2));
  // --impl-review <round-dir> (reviewround.mjs): the same summary over the round where the main model checks and
  // fixes each sub-agent change. It is parsed first so that --impl does not match its prefix by position.
  const li = argv.indexOf('--impl-large'); const implLarge = li >= 0 ? argv[li + 1] : null;
  if (li >= 0) argv = argv.slice(0, li).concat(argv.slice(li + 2));
  const si = argv.indexOf('--impl-spec'); const implSpec = si >= 0 ? argv[si + 1] : null;
  if (si >= 0) argv = argv.slice(0, si).concat(argv.slice(si + 2));
  const pi = argv.indexOf('--spec'); const specDir = pi >= 0 ? argv[pi + 1] : null;
  if (pi >= 0) argv = argv.slice(0, pi).concat(argv.slice(pi + 2));
  const ri = argv.indexOf('--impl-review'); const implReview = ri >= 0 ? argv[ri + 1] : null;
  if (ri >= 0) argv = argv.slice(0, ri).concat(argv.slice(ri + 2));
  const ii = argv.indexOf('--impl'); const impl = ii >= 0 ? argv[ii + 1] : null;
  if (ii >= 0) argv = argv.slice(0, ii).concat(argv.slice(ii + 2));
  const ci = argv.indexOf('--compare');
  const dirs = ci < 0 ? argv : argv.slice(0, ci); const cmp = ci < 0 ? [] : argv.slice(ci + 1);
  if (!dirs.length || (ci >= 0 && cmp.length < 2) || (ni >= 0 && !noise) || (ui >= 0 && !up) || (ii >= 0 && !impl) || (li >= 0 && !implLarge)
    || (si >= 0) !== (pi >= 0) || (si >= 0 && (!implSpec || !specDir))) {
    console.error('usage: bulk.mjs <round-dir> [...more round dirs] [--compare <round-dir> <round-dir> ...] [--noise <round-dir>] [--up <round-dir>] [--impl <round-dir>] [--impl-large <round-dir>] [--impl-spec <round-B-dir> --spec <round-A-dir>]'); return 2;
  }
  const agg = aggregateBulk(dirs.map(loadRound));
  if (cmp.length) agg.compare = compareRounds(cmp.map(loadRound));
  if (noise) agg.noise = noiseRound(loadRound(noise));
  if (up) { try { agg.up = upRound(loadRound(up)); } catch (e) { console.error(`bulk: ${e.message}`); return 1; } }
  if (impl) { try { agg.impl = implRound(loadRound(impl)); } catch (e) { console.error(`bulk: ${e.message}`); return 1; } }
  if (implReview) { try { agg.implReview = implRound(loadRound(implReview)); } catch (e) { console.error(`bulk: ${e.message}`); return 1; } }
  if (implLarge) { try { agg.implLarge = implRound(loadRound(implLarge)); } catch (e) { console.error(`bulk: ${e.message}`); return 1; } }
  if (implSpec) { try { agg.implSpec = implSpecRound(loadRound(implSpec), loadRound(specDir)); } catch (e) { console.error(`bulk: ${e.message}`); return 1; } }
  if (!agg.rounds.length) { console.error('bulk: no round with tier "numbers", nothing written'); return 1; }
  writeFileSync(out, JSON.stringify(agg, null, 2) + '\n');
  if (agg.noise) log(`bulk: noise floor over ${agg.noise.n} cases: Opus vs Opus ok ${agg.noise.ok}/partial ${agg.noise.partial}/fail ${agg.noise.fail}`);
  if (agg.compare) log(`bulk: compare over ${agg.compare.n} common cases: ${agg.compare.steps.map((t) => `${t.rule} ok ${t.ok}/partial ${t.partial}/fail ${t.fail} $${t.pickUsd}`).join(' -> ')}`);
  if (agg.up) log(`bulk: up over ${agg.up.n} cases: ${agg.up.conditions.map((t) => `${t.id} ok ${t.ok}/partial ${t.partial}/fail ${t.fail} $${t.usd}`).join(' | ')}`);
  if (agg.impl) log(`bulk: impl over ${agg.impl.n} cases: ${agg.impl.conditions.map((t) => `${t.id} ok ${t.ok}/partial ${t.partial}/fail ${t.fail} tests pass ${agg.impl.tests[t.id].pass} $${t.usd}`).join(' | ')}`);
  log(`bulk: ${agg.n} cases from ${agg.rounds.join(', ')}; ok ${agg.totals.ok}, partial ${agg.totals.partial}, fail ${agg.totals.fail} -> ${out}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
