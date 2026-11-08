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
 * --compare lists two or more rounds in order and adds `compare` to the output: over the cases graded in all of
 * them, one step per round with its rule tag and verdict counts, pick dollars and seconds, plus the first round's
 * baseline dollars. The positional rounds still form the main aggregate.
 *
 * A case counts when both its routed lane (A or S) and its opus baseline have a graded score. A case kept on
 * main (conditions hold only the baseline) counts as ok with the baseline run as its pick; see totals.keptMain. Only counts,
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
      for (const row of [byKind[kind] ||= emptyRow(), totals]) {
        row.n++; row[v]++;
        if (keptMain) row.keptMain = (row.keptMain || 0) + 1; // absent when no case stayed on main
        row.pickUsd += usdOf(cost[pk]); row.opusUsd += usdOf(cost[bk]);
        row.pickSec += (cost[pk]?.ms || 0) / 1000; row.opusSec += (cost[bk]?.ms || 0) / 1000;
      }
      const pickCond = keptMain ? base : lane;
      const fam = shortModel(pickCond.model);
      if (fam in pickModels) pickModels[fam]++; else if (keptMain) pickModels[fam] = (pickModels[fam] || 0) + 1;
      // One numbers-only row per case, so the page can flow it through the diagram like a graded case.
      cases.push({ kind, lane: pickCond.id, verdict: v, pickUsd: pyRound(usdOf(cost[pk]), 4), opusUsd: pyRound(usdOf(cost[bk]), 4),
        pickSec: Math.round((cost[pk]?.ms || 0) / 1000), opusSec: Math.round((cost[bk]?.ms || 0) / 1000) });
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
  return { verdict: v, pickUsd: usdOf(cost[pk]), opusUsd: usdOf(cost[bk]), pickSec: (cost[pk]?.ms || 0) / 1000 };
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
export function upRound(loaded) {
  const { round, runs, cost, scores } = loaded;
  if (round.grading !== 'verify') throw new Error(`round ${round.id} is not a verify round`);
  const rows = round.conditions.map((c) => ({ id: c.id, model: shortModel(c.model), effort: c.effort, n: 0, ok: 0, partial: 0, fail: 0, verified: 0, wrong: 0, missed: 0, usd: 0, sec: 0 }));
  let n = 0;
  for (const c of round.cases) {
    if (typeof c.meta?.excluded === 'string' && c.meta.excluded) continue;
    const keys = round.conditions.map((cond) => Object.keys(runs).find((k) => runs[k].case === c.id && runs[k].condition === cond.id && !scores[k]?.reference && ['ok', 'partial', 'fail'].includes(verdictOf(scores[k]))));
    if (keys.some((k) => !k)) continue;
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
  const ci = argv.indexOf('--compare');
  const dirs = ci < 0 ? argv : argv.slice(0, ci); const cmp = ci < 0 ? [] : argv.slice(ci + 1);
  if (!dirs.length || (ci >= 0 && cmp.length < 2) || (ni >= 0 && !noise) || (ui >= 0 && !up)) { console.error('usage: bulk.mjs <round-dir> [...more round dirs] [--compare <round-dir> <round-dir> ...] [--noise <round-dir>] [--up <round-dir>]'); return 2; }
  const agg = aggregateBulk(dirs.map(loadRound));
  if (cmp.length) agg.compare = compareRounds(cmp.map(loadRound));
  if (noise) agg.noise = noiseRound(loadRound(noise));
  if (up) { try { agg.up = upRound(loadRound(up)); } catch (e) { console.error(`bulk: ${e.message}`); return 1; } }
  if (!agg.rounds.length) { console.error('bulk: no round with tier "numbers", nothing written'); return 1; }
  writeFileSync(out, JSON.stringify(agg, null, 2) + '\n');
  if (agg.noise) log(`bulk: noise floor over ${agg.noise.n} cases: Opus vs Opus ok ${agg.noise.ok}/partial ${agg.noise.partial}/fail ${agg.noise.fail}`);
  if (agg.compare) log(`bulk: compare over ${agg.compare.n} common cases: ${agg.compare.steps.map((t) => `${t.rule} ok ${t.ok}/partial ${t.partial}/fail ${t.fail} $${t.pickUsd}`).join(' -> ')}`);
  if (agg.up) log(`bulk: up over ${agg.up.n} cases: ${agg.up.conditions.map((t) => `${t.id} ok ${t.ok}/partial ${t.partial}/fail ${t.fail} $${t.usd}`).join(' | ')}`);
  log(`bulk: ${agg.n} cases from ${agg.rounds.join(', ')}; ok ${agg.totals.ok}, partial ${agg.totals.partial}, fail ${agg.totals.fail} -> ${out}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
