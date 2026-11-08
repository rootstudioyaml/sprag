#!/usr/bin/env node
/**
 * Build a "does moving up pay off" round from a graded bulk round, without running anything.
 *
 *   node scripts/evals/upround.mjs <source-round-dir> --cases id,id,... --id <new-round-id> [--fresh-baseline]
 *
 * Each case runs three conditions on the same prompt: S sonnet high, B opus high (the baseline) and H opus xhigh,
 * all without an agent, so each run has the full tool set like a main session. Grading is "verify": a grader checks
 * the claims the reports disagree on, so no report is the answer key. The source's opus-direct run of a case
 * (runs.json and cost.json entries, report, transcript) is copied as B unless --fresh-baseline is given; its
 * reference score is not copied, because the verify grader scores every report again. The round is written to
 * handoff/evals-work/rounds/<id>; replay it with replay.mjs and grade it with grade.mjs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { workDir, readJson, validateRound, isMain, copyRel, copyRuns } from './lib.mjs';
import { planRuns } from './replay.mjs';
import { templatePrompt, VERIFY_RUBRIC } from './select.mjs';

export const UP_RULE = 'up-v1';
export const UP_CONDITIONS = [
  { key: 'S', id: 'sonnet-high', model: 'claude-sonnet-5-5', effort: 'high', prompt: 'original' },
  { key: 'B', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' },
  { key: 'H', id: 'opus-xhigh', model: 'claude-opus-5-5', effort: 'xhigh', prompt: 'original' },
];

/** Pure: the case entry of the new round. Repo, commit and meta come from the source case. */
export function upCase(src, srcRoundId) {
  const c = { id: src.id, prompt: `cases/${src.id}.md`, rubric: `rubric/${src.id}.md` };
  for (const k of ['repo', 'commit', 'write']) if (src[k] !== undefined) c[k] = src[k];
  c.conditions = UP_CONDITIONS.map((x) => x.key);
  c.meta = { ...(src.meta || {}), sourceRound: srcRoundId };
  return c;
}

/** Pure: the new round.json. Repo, commit, concurrency, allowed tools and the cap threshold come from the source. */
export function upRoundJson(srcRound, cases, { id, date }) {
  const round = {
    id, date, kind: 'conditions', repo: srcRound.repo, commit: srcRound.commit, repeats: 1, concurrency: srcRound.concurrency ?? 4,
    allowedTools: srcRound.allowedTools ?? ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch'],
    conditions: UP_CONDITIONS.map((c) => ({ ...c })), grading: 'verify', rule: UP_RULE, tier: 'numbers', baselineFrom: srcRound.id, cases,
  };
  if (srcRound.capStopPct !== undefined) round.capStopPct = srcRound.capStopPct;
  return round;
}

export function upround(sourceDir, { id, cases, freshBaseline = false, root = join(workDir(), 'rounds'), date = new Date().toISOString().slice(0, 10), log = console.log } = {}) {
  sourceDir = resolve(sourceDir);
  const srcRound = readJson(join(sourceDir, 'round.json'));
  const errs0 = validateRound(srcRound);
  if (errs0.length) throw new Error('source round.json invalid:\n- ' + errs0.join('\n- '));
  if (!/^[\w-]+$/.test(id || '')) throw new Error('--id must be a slug');
  if (!cases?.length) throw new Error('--cases needs at least one case id');
  const outDir = join(root, id);
  if (existsSync(outDir)) throw new Error(`round already exists: ${outDir}`);
  for (const cid of cases) if (!srcRound.cases.some((c) => c.id === cid)) throw new Error(`case ${cid} is not in the source round`);
  const srcCases = cases.map((cid) => srcRound.cases.find((c) => c.id === cid));
  for (const c of srcCases) if (!existsSync(join(sourceDir, c.prompt))) throw new Error(`prompt file missing for case ${c.id}: ${c.prompt}`);
  const newCases = srcCases.map((c) => upCase(c, srcRound.id));
  const round = upRoundJson(srcRound, newCases, { id, date });
  const errs = validateRound(round);
  if (errs.length) throw new Error('new round.json invalid:\n- ' + errs.join('\n- '));

  // Only a source baseline that ran the very same condition (id, model, effort) can stand in for B.
  const B = UP_CONDITIONS.find((c) => c.role === 'baseline');
  const srcBase = srcRound.conditions.find((c) => c.role === 'baseline');
  const reusable = !freshBaseline && srcBase && srcBase.id === B.id && srcBase.model === B.model && srcBase.effort === B.effort;
  const srcRuns = readJson(join(sourceDir, 'runs.json'), {}); const srcCost = readJson(join(sourceDir, 'cost.json'), {});
  const runs = {}, cost = {}; let reused = 0;
  mkdirSync(join(outDir, 'cases'), { recursive: true }); mkdirSync(join(outDir, 'rubric'), { recursive: true });
  for (const [i, c] of newCases.entries()) {
    const text = readFileSync(join(sourceDir, srcCases[i].prompt), 'utf8');
    writeFileSync(join(outDir, c.prompt), templatePrompt(text, c.repo ?? srcRound.repo));
    writeFileSync(join(outDir, c.rubric), VERIFY_RUBRIC);
    if (reusable && copyRuns({ sourceDir, outDir, caseId: c.id, srcKey: srcBase.key, newKey: B.key, srcRuns, srcCost, runs, cost }).length) reused++;
  }
  writeFileSync(join(outDir, 'round.json'), JSON.stringify(round, null, 2) + '\n');
  writeFileSync(join(outDir, 'runs.json'), JSON.stringify(runs, null, 1));
  writeFileSync(join(outDir, 'cost.json'), JSON.stringify(cost, null, 1));

  const planned = planRuns(round).filter((r) => !(r.key in runs)).length;
  log(`up round ${id} from ${srcRound.id}: ${newCases.length} case(s), ${planned} run(s) to replay, ${reused} baseline run(s) reused${freshBaseline ? ' (--fresh-baseline: none copied)' : ''}, rule ${UP_RULE} -> ${outDir}`);
  return { outDir, round, planned, reused };
}

export function main(argv = []) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  if (!argv[0] || argv[0].startsWith('--') || !opt('--cases') || !opt('--id')) {
    console.error('usage: upround.mjs <source-round-dir> --cases id,id,... --id <new-round-id> [--fresh-baseline]');
    return 2;
  }
  try {
    upround(argv[0], { id: opt('--id'), cases: opt('--cases').split(',').map((s) => s.trim()).filter(Boolean), freshBaseline: argv.includes('--fresh-baseline') });
    return 0;
  } catch (e) { console.error(e.message); return 1; }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
