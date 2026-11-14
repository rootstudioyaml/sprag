#!/usr/bin/env node
/**
 * Build an implementation replay round from the ledger snapshot, without running anything.
 *
 *   node scripts/evals/implround.mjs --cases id,id,... --id <round-id> [--concurrency 2] [--timeout-min 45]
 *
 * Each case is a delegation that changed files (the main Opus handed it to the t1-worker Sonnet agent). It replays
 * under two conditions: S, the same Sonnet agent, and B, Opus doing the work directly. Every run edits its own
 * worktree outside the repo (replay.mjs, case.write), and one verify grader checks every copy and runs the tests
 * (grade.mjs). The prompt goes through the same masking and {{REPO}} templating as select.mjs; a prompt that still
 * holds the repo root afterwards is refused, and so is a commit that is not an ancestor of the repo's HEAD, because
 * a run must never reach the real checkout. The round is written to handoff/evals-work/rounds/<id>.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { workDir, readJsonl, sha10, validateRound, isMain, maskSecrets } from './lib.mjs';
import { templatePrompt, locate } from './select.mjs';

export const IMPL_RULE = 'impl-v1';
export const IMPL_CONDITIONS = [
  { key: 'S', id: 'sonnet-high', model: 'claude-sonnet-5-5', effort: 'high', agent: 't1-worker', prompt: 'original' },
  { key: 'B', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' },
];

/** Rubric file of an implementation round. Not sent to the grader (buildImplVerifyPrompt in grade.mjs); it records the scale. */
export const IMPL_RUBRIC = `# Implementation verification grading

One grader checks every run's own copy of the repository: the staged diff, the tests and the report.
- ok: everything the task asked for is done, the tests pass and nothing the task forbade was done.
- partial: the main part is done, but an instructed item is missing, some tests fail or something forbidden was done.
- fail: the task was not done or the result is broken.
tests per report: pass (the test command the task names, else the repo's own, passed in that copy), fail (it failed), none (no test command to run).
`;

/** Returns trimmed stdout, or null when git fails (merge-base --is-ancestor fails when the commit is not an ancestor). */
const defaultGit = (args) => { try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

/** Pure: the stored prompt ({ text }), or { error } when the repo root is still in it after templating. */
export function implPrompt(prompt, root, cwd = root) {
  const text = templatePrompt(maskSecrets(prompt), root, cwd);
  return text.includes(root) ? { error: `prompt still names the repo root ${root} after templating` } : { text };
}

/** Pure: the case entry of one snapshot line. */
export function implCase(e, { repo, commit }) {
  const id = sha10(e.key);
  return {
    id, prompt: `cases/${id}.md`, rubric: `rubric/${id}.md`, repo, commit, write: true, conditions: IMPL_CONDITIONS.map((c) => c.key),
    meta: { kind: 'implement', ledgerUsd: e.usd ?? null, ledgerCost: e.cost ?? null, ts: e.ts ?? null },
  };
}

/** Pure: the round.json. Round repo and commit are the most common repo and its latest case commit, as in select.mjs. */
export function implRoundJson(id, cases, { date, concurrency = 2, timeoutMin = 45 }) {
  const count = new Map(); for (const c of cases) count.set(c.repo, (count.get(c.repo) || 0) + 1);
  const repo = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const latest = cases.filter((c) => c.repo === repo).sort((a, b) => (b.meta.ts ?? 0) - (a.meta.ts ?? 0))[0];
  return {
    id, date, kind: 'conditions', repo, commit: latest?.commit, repeats: 1, concurrency, timeoutMin,
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
    grading: 'verify', rule: IMPL_RULE, tier: 'numbers', capStopPct: 85,
    conditions: IMPL_CONDITIONS.map((c) => ({ ...c })), cases,
  };
}

export function implround({ cases: ids, id, concurrency = 2, timeoutMin = 45, work = workDir(), git = defaultGit, log = console.log, today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!/^[\w-]+$/.test(id || '')) throw new Error('--id must be a slug');
  if (!ids?.length) throw new Error('--cases needs at least one case id');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('--concurrency must be an integer >= 1');
  if (!Number.isFinite(timeoutMin) || timeoutMin <= 0) throw new Error('--timeout-min must be a positive number');
  const dir = join(work, 'rounds', id);
  if (existsSync(dir)) throw new Error(`round already exists: ${dir}`);
  const byId = new Map();
  for (const e of readJsonl(join(work, 'ledger-snapshot.jsonl'))) if (!byId.has(sha10(e.key))) byId.set(sha10(e.key), e);
  const problems = []; const cases = []; const texts = new Map();
  for (const cid of ids) {
    const e = byId.get(cid);
    if (!e) { problems.push(`${cid}: not in the ledger snapshot`); continue; }
    const loc = e.cwd ? locate(e, (a) => git(a) ?? '') : null;
    if (!loc) { problems.push(`${cid}: cwd ${e.cwd ?? '(none)'} is not in a git repo`); continue; }
    if (git(['-C', loc.root, 'merge-base', '--is-ancestor', loc.commit, 'HEAD']) == null) { problems.push(`${cid}: commit ${loc.commit} is not an ancestor of HEAD in ${loc.root}`); continue; }
    const p = implPrompt(e.prompt, loc.root, e.cwd);
    if (p.error) { problems.push(`${cid}: ${p.error}`); continue; }
    const c = implCase(e, { repo: loc.root, commit: loc.commit });
    cases.push(c); texts.set(c.id, p.text);
  }
  if (problems.length) throw new Error(`refused ${problems.length} case(s); nothing written:\n- ${problems.join('\n- ')}`);
  const round = implRoundJson(id, cases, { date: today, concurrency, timeoutMin });
  const errs = validateRound(round);
  if (errs.length) throw new Error('round.json invalid:\n- ' + errs.join('\n- '));
  for (const d of ['cases', 'rubric']) mkdirSync(join(dir, d), { recursive: true });
  for (const c of cases) { writeFileSync(join(dir, c.prompt), texts.get(c.id)); writeFileSync(join(dir, c.rubric), IMPL_RUBRIC); }
  writeFileSync(join(dir, 'round.json'), JSON.stringify(round, null, 1) + '\n');
  log(`impl round ${id}: ${cases.length} case(s), ${cases.length * IMPL_CONDITIONS.length} run(s) to replay, repos ${new Set(cases.map((c) => c.repo)).size}, rule ${IMPL_RULE} -> ${dir}`);
  return { round, dir };
}

export function main(argv = []) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  if (!opt('--cases') || !opt('--id')) {
    console.error('usage: implround.mjs --cases id,id,... --id <round-id> [--concurrency 2] [--timeout-min 45]');
    return 2;
  }
  try {
    implround({
      id: opt('--id'), cases: opt('--cases').split(',').map((s) => s.trim()).filter(Boolean),
      concurrency: opt('--concurrency') == null ? 2 : Number(opt('--concurrency')), timeoutMin: opt('--timeout-min') == null ? 45 : Number(opt('--timeout-min')),
    });
    return 0;
  } catch (e) { console.error(e.message); return 1; }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
