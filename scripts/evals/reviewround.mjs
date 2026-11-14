#!/usr/bin/env node
/**
 * Build the "main model checks the sub-agent's work" round from a graded implementation round (implround.mjs).
 *
 *   node scripts/evals/reviewround.mjs <impl-round-dir> --id <new-round-id>
 *
 * An implementation round compares a sub-agent's change (S) with the main model doing the task itself (B). In real
 * use the main model does not relay S as it is: it checks the diff, runs the tests and fixes what is missing. This
 * round measures that step. Each case gets condition R: the main model, in a fresh copy that starts with S's change
 * staged (case.seedPatch), told to check the change against the task, run the tests and fix what is wrong. B is copied
 * from the source round (run, cost, report, transcript) and its copy is rebuilt from the saved diff, so the grader
 * compares R with B blind, as before. The cost of "delegate and check" is S (source round) plus R (this round).
 * Cases the source excluded are left out. Only `git worktree add` and `git apply` run here; no model is called.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { workDir, readJson, copyRel, copyRuns, validateRound, isMain } from './lib.mjs';
import { writeWorktreeFor } from './replay.mjs';

export const REVIEW_RULE = 'impl-review-v1';
export const REVIEW_CONDITION = { key: 'R', id: 'opus-review', model: 'claude-opus-5-5', effort: 'high', prompt: 'improved' };

/** Pure: what the main model is told. {{REPO}} is filled in by replay.mjs with the copy's path. */
export function reviewPrompt({ task, report, base }) {
  return `You are the main model of a coding session. You handed the task below to a sub-agent and it has finished. Its changes are already staged in this repository copy ({{REPO}}): read them with \`git -C {{REPO}} diff --cached ${base}\`.

Do the check a main model owes before it reports delegated work as done:
1. Compare the changes with the task item by item, including what the task forbids.
2. Run the test command the task names, or the repository's own, in this copy.
3. Fix whatever is missing, wrong or outside the task's scope. Keep what is right: do not rewrite working code.
4. Report what you checked, what you changed and the final test result.

Do not commit. Do not contact external services and do not run a command that sends data to a server.

# The task you handed off

${task.trim()}

# The sub-agent's report

${report.trim()}
`;
}

export function reviewround(sourceDir, { id, root = join(workDir(), 'rounds'), git = (args) => execFileSync('git', args, { encoding: 'utf8' }), log = console.log, date = new Date().toISOString().slice(0, 10) } = {}) {
  sourceDir = resolve(sourceDir);
  const src = readJson(join(sourceDir, 'round.json'));
  if (!/^[\w-]+$/.test(id || '')) throw new Error('--id must be a slug');
  const outDir = join(root, id);
  if (existsSync(outDir)) throw new Error(`round already exists: ${outDir}`);
  const base = src.conditions.find((c) => c.role === 'baseline'); const lane = src.conditions.find((c) => c.role !== 'baseline');
  if (!base || !lane) throw new Error('the source round needs a baseline and one other condition');
  const srcRuns = readJson(join(sourceDir, 'runs.json'), {}); const srcCost = readJson(join(sourceDir, 'cost.json'), {});
  const picked = src.cases.filter((c) => c.write === true && !c.meta?.excluded && srcRuns[`${c.id}-${lane.key}`] && srcRuns[`${c.id}-${base.key}`]
    && existsSync(join(sourceDir, 'diffs', `${c.id}-${lane.key}.patch`)) && existsSync(join(sourceDir, 'diffs', `${c.id}-${base.key}.patch`)));
  if (!picked.length) throw new Error('no case with both runs and both saved diffs');
  const cases = picked.map((c) => ({
    ...c, improvedPrompt: `review/${c.id}.md`, seedPatch: { [REVIEW_CONDITION.key]: `seed/${c.id}.patch` }, conditions: [REVIEW_CONDITION.key, base.key],
    meta: { ...(c.meta || {}), sourceRound: src.id, seedFrom: lane.id },
  }));
  const round = { ...src, id, date, rule: REVIEW_RULE, baselineFrom: src.id, conditions: [{ ...REVIEW_CONDITION }, { ...base }], cases };
  const errs = validateRound(round);
  if (errs.length) throw new Error('round.json invalid:\n- ' + errs.join('\n- '));
  const runs = {}, cost = {};
  for (const c of cases) {
    copyRel(sourceDir, outDir, c.prompt); copyRel(sourceDir, outDir, c.rubric);
    copyRel(sourceDir, outDir, `diffs/${c.id}-${lane.key}.patch`, c.seedPatch[REVIEW_CONDITION.key]);
    copyRel(sourceDir, outDir, `diffs/${c.id}-${base.key}.patch`);
    copyRuns({ sourceDir, outDir, caseId: c.id, srcKey: base.key, newKey: base.key, srcRuns, srcCost, runs, cost });
    const task = readFileSync(join(sourceDir, c.prompt), 'utf8'); const report = readFileSync(join(sourceDir, 'reports', `${c.id}-${lane.key}.md`), 'utf8');
    mkdirSync(join(outDir, 'review'), { recursive: true });
    writeFileSync(join(outDir, c.improvedPrompt), reviewPrompt({ task, report, base: c.commit || src.commit }));
    // The grader reads the baseline's copy under this round's id, so it is rebuilt here from the saved diff.
    const w = writeWorktreeFor(round, c, `${c.id}-${base.key}`);
    if (!existsSync(w.wt)) {
      mkdirSync(dirname(w.wt), { recursive: true });
      git(['-C', w.repo, 'worktree', 'add', '--detach', w.wt, w.commit]);
      const patch = join(outDir, 'diffs', `${c.id}-${base.key}.patch`);
      if (readFileSync(patch, 'utf8').trim()) git(['-C', w.wt, 'apply', '--index', patch]);
    }
  }
  writeFileSync(join(outDir, 'round.json'), JSON.stringify(round, null, 1) + '\n');
  writeFileSync(join(outDir, 'runs.json'), JSON.stringify(runs, null, 1)); writeFileSync(join(outDir, 'cost.json'), JSON.stringify(cost, null, 1));
  log(`review round ${id} from ${src.id}: ${cases.length} case(s), ${cases.length} run(s) to replay, baseline copied -> ${outDir}`);
  return { round, dir: outDir };
}

export function main(argv = []) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  if (!argv[0] || argv[0].startsWith('--') || !opt('--id')) { console.error('usage: reviewround.mjs <impl-round-dir> --id <new-round-id>'); return 2; }
  try { reviewround(argv[0], { id: opt('--id') }); return 0; } catch (e) { console.error(e.message); return 1; }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
