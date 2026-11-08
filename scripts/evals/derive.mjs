#!/usr/bin/env node
/**
 * Derive a new round from a lane assignment (scripts/evals/assign.mjs), reusing runs the source already has.
 *
 *   node scripts/evals/derive.mjs <source-round-dir> --assign <assignments.json> --id <new-round-id> [--cases id,...] [--rule <tag>]
 *
 * The new round keeps each case's prompt and rubric, runs only the assigned lane next to the baseline and
 * copies the source's baseline run (runs.json and cost.json entries, report, transcript, reference score).
 * A graded pick run is copied too when the source ran the same condition id for that case, so replay and
 * grade skip it. A case assigned to "main" keeps just the baseline. `rule` in round.json is --rule, else the
 * assignment file's rule, else its basename. Nothing runs here.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { workDir, readJson, validateRound, isMain, escRe, copyRel, copyRuns } from './lib.mjs';
import { planRuns } from './replay.mjs';

const LANE_CONDITIONS = {
  'haiku-low': { key: 'A', id: 'haiku-low', model: 'claude-haiku-5-5', effort: 'low', agent: 't2-explore', prompt: 'original' },
  'sonnet-high': { key: 'S', id: 'sonnet-high', model: 'claude-sonnet-5-5', effort: 'high', prompt: 'original' },
  // Same agent as sonnet-high (t1-worker); only the effort differs.
  'sonnet-xhigh': { key: 'Y', id: 'sonnet-xhigh', model: 'claude-sonnet-5-5', effort: 'xhigh', prompt: 'original' },
  // No agent: the run has the full tool set, WebSearch and WebFetch included.
  'sonnet-xhigh-web': { key: 'X', id: 'sonnet-xhigh-web', model: 'claude-sonnet-5-5', effort: 'xhigh', prompt: 'original' },
};
const BASELINE = { key: 'B', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' };

/** Pure: the case entry of the new round for one assigned lane. */
export function derivedCase(src, lane, { srcRound, ruleName, srcBaseKey }) {
  const srcLane = srcRound.conditions.find((x) => x.key !== srcBaseKey && (src.conditions || srcRound.conditions.map((c) => c.key)).includes(x.key));
  const c = { id: src.id, prompt: src.prompt, rubric: src.rubric };
  for (const k of ['repo', 'commit', 'write']) if (src[k] !== undefined) c[k] = src[k];
  if (lane === 'main') c.conditions = ['B'];
  else {
    const key = LANE_CONDITIONS[lane].key;
    c.conditions = [key, 'B'];
    if (lane === 'haiku-low') c.agents = { A: src.agents?.A ?? 't2-explore' };
    else if (lane === 'sonnet-high') c.agents = { S: 't1-worker' };
    else if (lane === 'sonnet-xhigh') c.agents = { Y: 't1-worker' };
  }
  c.meta = { ...(src.meta || {}), assigned: lane, assignedBy: ruleName, sourceRound: srcRound.id, sourceLane: srcLane?.id ?? null };
  return c;
}

/** Pure: the new round.json. Everything but id, date, conditions, baselineFrom and cases comes from the source. */
export function derivedRound(srcRound, cases, { id, date, rule }) {
  // All lane conditions are always listed; each case names the ones it runs in its own `conditions`.
  const conditions = Object.values(LANE_CONDITIONS).map((c) => ({ ...c }));
  const round = { ...srcRound, id, date, conditions: [...conditions, { ...BASELINE }], baselineFrom: srcRound.id, cases };
  if (rule) round.rule = rule; else delete round.rule;
  return round;
}

export function derive(sourceDir, assignFile, { id, rule = null, cases = null, runBaseline = false, root = join(workDir(), 'rounds'), date = new Date().toISOString().slice(0, 10), log = console.log } = {}) {
  sourceDir = resolve(sourceDir);
  const srcRound = readJson(join(sourceDir, 'round.json'));
  const errs0 = validateRound(srcRound);
  if (errs0.length) throw new Error('source round.json invalid:\n- ' + errs0.join('\n- '));
  const srcBase = srcRound.conditions.find((c) => c.role === 'baseline');
  const asg = readJson(resolve(assignFile), null);
  if (!asg?.byCase) throw new Error(`not an assignments file: ${assignFile}`);
  if (!/^[\w-]+$/.test(id || '')) throw new Error('--id must be a slug');
  const outDir = join(root, id);
  if (existsSync(outDir)) throw new Error(`round already exists: ${outDir}`);
  const wanted = cases || Object.keys(asg.byCase);
  for (const cid of wanted) {
    if (!asg.byCase[cid]) throw new Error(`case ${cid} has no assignment`);
    if (!srcRound.cases.some((c) => c.id === cid)) throw new Error(`case ${cid} is not in the source round`);
  }
  const newCases = srcRound.cases.filter((c) => wanted.includes(c.id))
    .map((c) => derivedCase(c, asg.byCase[c.id].lane, { srcRound, ruleName: asg.rule, srcBaseKey: srcBase.key }));
  const ruleTag = rule || (typeof asg.rule === 'string' && asg.rule) || basename(resolve(assignFile), extname(assignFile));
  const round = derivedRound(srcRound, newCases, { id, date, rule: ruleTag });
  const errs = validateRound(round);
  if (errs.length) throw new Error('derived round.json invalid:\n- ' + errs.join('\n- '));

  const srcRuns = readJson(join(sourceDir, 'runs.json'), {}); const srcCost = readJson(join(sourceDir, 'cost.json'), {});
  const srcScores = readJson(join(sourceDir, 'scores_by_run.json'), {});
  const runs = {}, cost = {}, scores = {}; const missing = []; let reused = 0;
  const copy = (rel, rel2 = rel) => copyRel(sourceDir, outDir, rel, rel2);
  mkdirSync(outDir, { recursive: true });
  for (const c of newCases) {
    copy(c.prompt); copy(c.rubric);
    // Source baseline keys are <id>-<key> or <id>-<key>-<rep>; the derived round names its baseline B.
    const keys = copyRuns({ sourceDir, outDir, caseId: c.id, srcKey: srcBase.key, newKey: 'B', srcRuns, srcCost, srcScores, runs, cost, scores });
    if (!keys.length) { missing.push(c.id); continue; }
    // A graded pick run under the same condition id carries over; the letter may differ between the rounds.
    const lane = asg.byCase[c.id].lane;
    if (lane === 'main') continue;
    const cond = LANE_CONDITIONS[lane]; const srcCond = srcRound.conditions.find((x) => x.id === cond.id && x.role !== 'baseline');
    if (!srcCond) continue;
    const prx = new RegExp(`^${escRe(c.id)}-${escRe(srcCond.key)}(-\\d+)?$`);
    for (const k of Object.keys(srcRuns).filter((x) => prx.test(x))) {
      if (srcRuns[k].case !== c.id || srcRuns[k].condition !== cond.id || !srcScores[k]) continue;
      const nk = `${c.id}-${cond.key}${k.match(prx)[1] || ''}`;
      runs[nk] = srcRuns[k]; if (srcCost[k]) cost[nk] = srcCost[k]; scores[nk] = srcScores[k]; reused++;
      copy(`reports/${k}.md`, `reports/${nk}.md`); copy(`transcripts/${k}.jsonl`, `transcripts/${nk}.jsonl`);
    }
  }
  // --run-baseline lets replay run the missing baseline instead of refusing the round.
  if (missing.length && !runBaseline) { rmSync(outDir, { recursive: true, force: true }); throw new Error(`no baseline run in the source for case(s): ${missing.join(', ')} (pass --run-baseline to replay them)`); }
  writeFileSync(join(outDir, 'round.json'), JSON.stringify(round, null, 2) + '\n');
  writeFileSync(join(outDir, 'runs.json'), JSON.stringify(runs, null, 1));
  writeFileSync(join(outDir, 'cost.json'), JSON.stringify(cost, null, 1));
  if (Object.keys(scores).length) writeFileSync(join(outDir, 'scores_by_run.json'), JSON.stringify(scores, null, 1));

  const perLane = newCases.reduce((m, c) => { m[c.meta.assigned] = (m[c.meta.assigned] || 0) + 1; return m; }, {});
  const planned = planRuns(round).filter((r) => !(r.key in runs)).length;
  log(`derived ${id} from ${srcRound.id}: ${newCases.length} case(s) (${Object.entries(perLane).map(([l, n]) => `${l} ${n}`).join(', ')}), ${planned} run(s) to replay, ${reused} pick run(s) reused, ${Object.keys(runs).length - reused} baseline run(s) reused, rule ${ruleTag} -> ${outDir}`);
  return { outDir, round, planned, perLane, reused };
}

export function main(argv = []) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  if (!argv[0] || argv[0].startsWith('--') || !opt('--assign') || !opt('--id')) {
    console.error('usage: derive.mjs <source-round-dir> --assign <assignments.json> --id <new-round-id> [--cases id,...] [--rule <tag>] [--run-baseline]');
    return 2;
  }
  try {
    derive(argv[0], opt('--assign'), { id: opt('--id'), rule: opt('--rule'), runBaseline: argv.includes('--run-baseline'), cases: opt('--cases') ? opt('--cases').split(',').map((s) => s.trim()).filter(Boolean) : null });
    return 0;
  } catch (e) { console.error(e.message); return 1; }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
