// Blind-grade the reports of a replayed round, one Opus grader per case.
// Usage: node scripts/evals/grade.mjs <round-dir> [--case <id>] [--regrade] [--yes]
//
// Without --yes nothing is written and nothing runs: the plan, an estimate and the command are printed.
// Graders run `claude -p` with no tools, so everything they need (task, rubric, answer key) must be in the
// text they receive: put the answer key inside the rubric file.
// With round.grading "verify" there is no answer key: one grader per case sees every report (baseline included, blind
// labels), checks the claims they disagree on with read-only tools in the case's replay worktree and gives each report
// a verdict plus verified/wrong/missed counts. Those graders do use tools, so they cost far more than the others.
// A write case (implround.mjs) is graded in verify mode too, against every run's own worktree (writeWorktreeFor):
// the grader reads the staged diffs, runs the tests in each copy and adds "tests" per report. It runs from an empty
// folder with --add-dir on the copies, no web tools, and the guarded env of the replay (writeGuardEnv).
// With round.grading "reference" the baseline condition's report is the answer key: graders see it under
// "# 기준 보고서" and grade the other reports against it; the baseline run is recorded as the reference.
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  validateRound, readJson, readReport, blindOrder, stripModelLines, extractJsonObject, validateGrades,
  normalizeGrades, isMain, ratesFor, runClaude, VERDICT, cleanEnv,
} from './lib.mjs';
import { worktreeFor, writeWorktreeFor, writeGuardEnv, ensureGuard } from './replay.mjs';

export const GRADER_MODEL = 'claude-opus-5-5';
export const MAX_GRADERS = 3;
/** `--tools ""` disables every tool (claude --help: 'Use "" to disable all tools'). */
export const gradeArgs = () => ['-p', '--model', GRADER_MODEL, '--effort', 'high', '--output-format', 'json', '--tools', ''];

/** Verify graders read the case's worktree and the web; every write tool is denied. */
export const verifyArgs = () => ['-p', '--model', GRADER_MODEL, '--effort', 'high', '--output-format', 'json', '--permission-mode', 'dontAsk',
  '--allowedTools', 'Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch', '--disallowedTools', 'Edit', 'Write', 'NotebookEdit'];

/** Implementation verify graders: no web tools, and every run's copy added as a working directory. */
export const implVerifyArgs = (wts) => [...verifyArgs().filter((a) => a !== 'WebFetch' && a !== 'WebSearch'), '--add-dir', ...wts];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OUTPUT_RULES = (labels) => `# Output
Answer with ONLY one JSON object: no code fence, no prose before or after. The keys are the report labels (${labels.join(', ')}).
{"${labels[0]}": {"items": [<score per rubric item, in order>], "total": <sum of items>, "max": <highest possible total>, "relay": "예" | "부분" | "아니오", "key_miss": "<one sentence naming the most important thing this report missed or got wrong, empty string if none>"}, ...}
Score every rubric item 0, 1 or 2 unless the rubric defines another scale. "relay" says whether the user could pass the report on as it is: "예" yes, "부분" only after fixes, "아니오" no.
Judge each report on its own against the rubric. Do not guess who wrote a report.`;

/** Pure: the exact text one grader receives. Model and effort lines are stripped everywhere. */
export function buildGradePrompt({ task, rubric, reports }) {
  const labels = reports.map((r) => r.label);
  return [
    'You are grading anonymous reports written for the same task. Grade only against the rubric.',
    '# Task the reports answer', stripModelLines(task).trim(),
    '# Rubric', stripModelLines(rubric).trim(),
    '# Reports',
    ...reports.map((r) => `## Report ${r.label}\n\n${stripModelLines(r.text).trim()}`),
    OUTPUT_RULES(labels),
  ].join('\n\n') + '\n';
}

/** Pure: reference mode. The baseline report goes in as the answer key; only the other reports get labels. */
export function buildReferencePrompt({ task, rubric, reference, reports }) {
  const labels = reports.map((r) => r.label);
  return [
    'You are grading anonymous reports written for the same task against a reference report. Grade only against the rubric.',
    '# Task the reports answer', stripModelLines(task).trim(),
    '# Rubric', stripModelLines(rubric).trim(),
    '# 기준 보고서', stripModelLines(reference).trim(),
    '# Reports',
    ...reports.map((r) => `## Report ${r.label}\n\n${stripModelLines(r.text).trim()}`),
    OUTPUT_RULES(labels),
  ].join('\n\n') + '\n';
}
/** Pure: verify mode. No answer key and no rubric: the grader settles the disputed claims itself, with tools. */
export function buildVerifyPrompt({ task, reports }) {
  const labels = reports.map((r) => r.label);
  return [
    'You are verifying anonymous reports written for the same task. There is no answer key: you establish the facts yourself.',
    'Your working directory is the repository the task ran in, at the commit it ran on; "<repo>" in the task and the reports means this directory. Use tools read-only (Read, Grep, Glob, read-only Bash commands, WebFetch, WebSearch). Never edit or write files and never run a command that changes state.',
    '# Task the reports answer', stripModelLines(task).trim(),
    '# Reports',
    ...reports.map((r) => `## Report ${r.label}\n\n${stripModelLines(r.text).trim()}`),
    `# What to do
1. List every claim, among the reports, that conflicts between reports or appears in only some of them, and that could change the conclusion of the task. Skip claims that do not affect the conclusion.
2. Check each claim yourself: read the files and run read-only commands in the working directory, or use the web. A claim you cannot check is "unverified".
3. For every report count: verified (key findings confirmed true), wrong (claims confirmed false), missed (key facts that another report gave, that you confirmed true and that this report lacks).
4. Build the best answer you can from the confirmed facts and give each report a verdict against it:
   - "ok": the conclusion is right and no key fact is missing or wrong.
   - "partial": the conclusion points the right way but a key fact is missing or wrong.
   - "fail": the conclusion is wrong or the task was not finished.
   A fact found by an investigation the task forbade or did not ask for does not count as missed.
5. Judge each report on its own. Do not guess who wrote a report.`,
    `# Output
Answer with ONLY one JSON object: no code fence, no prose before or after. The keys under "reports" are the report labels (${labels.join(', ')}).
{"checks": [{"claim": "<the claim>", "result": "true" | "false" | "unverified", "evidence": "<what you read or ran, and what it showed>"}, ...],
 "reports": {"${labels[0]}": {"verdict": "ok" | "partial" | "fail", "verified": <int>, "wrong": <int>, "missed": <int>, "key_miss": "<one sentence naming the most important thing this report missed or got wrong, empty string if none>"}, ...}}`,
  ].join('\n\n') + '\n';
}

/**
 * Pure: verify mode for a write case. Each report comes with the copy of the repo its run worked in (`wt`);
 * the grader checks the staged diff of every copy and runs the tests there.
 */
export function buildImplVerifyPrompt({ task, reports, base = 'HEAD' }) {
  const labels = reports.map((r) => r.label);
  return [
    'You are verifying anonymous reports of the same implementation task. Each report comes from its own copy of the repository, where the task was carried out from the same starting commit. There is no answer key: you establish the facts yourself.',
    `# Copies
${reports.map((r) => `- Report ${r.label}: ${r.wt}`).join('\n')}

"<repo>" in the task and in a report means that report's copy. The changes in each copy are staged: see them with \`git -C <copy> diff --cached ${base}\` (${base === 'HEAD' ? 'HEAD' : 'the commit every copy started from'}).`,
    '# Task the reports answer', stripModelLines(task).trim(),
    '# Reports',
    ...reports.map((r) => `## Report ${r.label}\n\n${stripModelLines(r.text).trim()}`),
    `# What to do
1. For each copy, check item by item whether its changes carry out the instructions of the task.
2. In each copy run the test command the task names, or the repository's own test command when the task names none, and record the result.
3. Check whether each copy did what the task forbade (changing files outside the allowed scope, committing and the like) and whether it broke something that worked.
4. Count the claims in each report that are false.
5. For every report count: verified (key findings confirmed true), wrong (claims confirmed false), missed (key facts that another report gave, that you confirmed true and that this report lacks). A fact found by an investigation the task forbade or did not ask for does not count as missed.
6. Give each report a verdict:
   - "ok": everything the task asked for is done, the tests pass and nothing forbidden was done.
   - "partial": the main part is done, but an instructed item is missing, some tests fail or something forbidden was done.
   - "fail": the task was not done or the result is broken.
   When the starting commit lacks what the task presupposes, so that no copy could do it, give every report "fail" and start its key_miss with "task not reproducible at this commit".
7. Never edit files and never commit in any copy. Judge each report on its own. Do not guess who wrote a report.`,
    `# Output
Answer with ONLY one JSON object: no code fence, no prose before or after. The keys under "reports" are the report labels (${labels.join(', ')}).
{"checks": [{"claim": "<the claim>", "result": "true" | "false" | "unverified", "evidence": "<what you read or ran, and what it showed>"}, ...],
 "reports": {"${labels[0]}": {"verdict": "ok" | "partial" | "fail", "verified": <int>, "wrong": <int>, "missed": <int>, "tests": "pass" | "fail" | "none", "key_miss": "<one sentence naming the most important thing this report missed or got wrong, empty string if none>"}, ...}}
"tests" is "pass" when the test command passed in that report's copy, "fail" when it failed and "none" when there was no test command to run.`,
  ].join('\n\n') + '\n';
}

/** The score recorded for the reference run itself: full marks on the scale the grader used. */
export const referenceScore = (caseId, max) => ({ verdict: 'ok', score: max, max, total: max, relay: '예', reference: true, label: `${caseId}-ref` });
const keptOnBaseline = (c, bk) => Array.isArray(c.conditions) && c.conditions.length > 0 && c.conditions.every((k) => k === bk);
const baselineKeyOf = (round) => round.conditions.find((c) => c.role === 'baseline')?.key;

/** Run keys of one case that have a report file: <id>-<K> or <id>-<K>-<rep>. */
export function reportKeys(roundDir, caseId) {
  const dir = join(roundDir, 'reports');
  if (!existsSync(dir)) return [];
  const rx = new RegExp(`^${esc(caseId)}-[A-Z](?:-\\d+)?\\.md$`);
  return readdirSync(dir).filter((f) => rx.test(f)).map((f) => f.slice(0, -3)).sort();
}

/** Pure given the files: one entry per case that still needs grading. */
export function planGrading(roundDir, round, { only = null, regrade = false } = {}) {
  const scores = readJson(join(roundDir, 'scores_by_run.json'), {});
  const plan = [];
  for (const c of round.cases) {
    if (only && c.id !== only) continue;
    const keys = reportKeys(roundDir, c.id);
    if (!keys.length) continue;
    if (!regrade && keys.every((k) => k in scores)) continue;
    const task = readFileSync(join(roundDir, c.prompt), 'utf8').replaceAll('{{REPO}}', '<repo>');
    const readOne = (key) => readReport(join(roundDir, 'reports', `${key}.md`));
    if (round.grading === 'verify') {
      if (keys.length < 2) continue; // nothing to compare yet
      const labels = blindOrder(round.id, c.id, keys); // every report, baseline included, role ignored
      if (c.write === true) {
        const reports = Object.entries(labels).map(([label, key]) => ({ label, key, text: readOne(key), wt: writeWorktreeFor(round, c, key).wt }));
        plan.push({ caseId: c.id, caseObj: c, labels, prompt: buildImplVerifyPrompt({ task, reports, base: c.commit || round.commit || 'HEAD' }), reports, verify: true, impl: true });
        continue;
      }
      const reports = Object.entries(labels).map(([label, key]) => ({ label, key, text: readOne(key) }));
      plan.push({ caseId: c.id, caseObj: c, labels, prompt: buildVerifyPrompt({ task, reports }), reports, verify: true });
      continue;
    }
    const rubric = readFileSync(join(roundDir, c.rubric), 'utf8');
    if (round.grading === 'reference') {
      const bk = baselineKeyOf(round);
      if (keptOnBaseline(c, bk)) continue; // main-only: no grader, planReferenceOnly records its reference score
      const isRef = (k) => k === `${c.id}-${bk}` || k.startsWith(`${c.id}-${bk}-`);
      const refKey = keys.filter(isRef).sort()[0];
      const others = keys.filter((k) => !isRef(k));
      if (!refKey || !others.length) continue; // nothing to compare yet
      const labels = blindOrder(round.id, c.id, others);
      const reports = Object.entries(labels).map(([label, key]) => ({ label, key, text: readOne(key) }));
      const prompt = buildReferencePrompt({ task, rubric, reference: readOne(refKey), reports });
      plan.push({ caseId: c.id, labels, prompt, reports, refKey });
      continue;
    }
    const labels = blindOrder(round.id, c.id, keys);
    const reports = Object.entries(labels).map(([label, key]) => ({ label, key, text: readOne(key) }));
    const prompt = buildGradePrompt({ task, rubric, reports });
    plan.push({ caseId: c.id, labels, prompt, reports });
  }
  return plan;
}

/**
 * Reference mode: cases kept on the baseline (their `conditions` hold only the baseline key) have nothing to
 * grade against the reference, so no grader runs. Their baseline report still gets the reference score.
 * Pure given the files: [{ caseId, refKey }] for the ones not yet scored.
 */
export function planReferenceOnly(roundDir, round, { only = null } = {}) {
  if (round.grading !== 'reference') return [];
  const bk = baselineKeyOf(round);
  const scores = readJson(join(roundDir, 'scores_by_run.json'), {});
  const out = [];
  for (const c of round.cases) {
    if (only && c.id !== only) continue;
    if (!keptOnBaseline(c, bk)) continue;
    const refKey = reportKeys(roundDir, c.id).find((k) => k === `${c.id}-${bk}` || k.startsWith(`${c.id}-${bk}-`));
    if (refKey && !(refKey in scores)) out.push({ caseId: c.id, refKey });
  }
  return out;
}
/** The scale for a reference-only score: the max the graders used so far, else the shared reference rubric's 2. */
export const referenceMax = (scores) => Object.values(scores).find((s) => Number.isFinite(s?.max))?.max ?? 2;

/** Rough per-grader size: prompt chars / 3 input tokens, plus reasoning and answer. */
export function estimateGrading(plan, date) {
  const rates = ratesFor(GRADER_MODEL, date);
  let inTok = 0, outTok = 0;
  for (const p of plan) { inTok += Math.ceil(p.prompt.length / 3) + 3000; outTok += 8000; }
  return { inTok, outTok, usd: (inTok * rates.input + outTok * rates.output) / 1e6 };
}

const runGrader = ({ spawn, prompt, cwd, timeoutMs }) => runClaude({ spawn, args: gradeArgs(), prompt, cwd, timeoutMs });

/** Parses one grader reply and returns { grades } keyed by label, or { errors }. */
export function parseGraderReply(stdout, labels) {
  let text = stdout, apiError = null;
  try { const j = JSON.parse(stdout); text = typeof j.result === 'string' ? j.result : stdout; if (j.is_error) apiError = text; } catch { /* raw text */ }
  if (apiError) return { errors: [`claude reported an error: ${apiError.slice(0, 200)}`] };
  const obj = extractJsonObject(text);
  if (!obj) return { errors: ['no JSON object in the reply'] };
  const grades = normalizeGrades(obj);
  const errors = validateGrades(grades, labels);
  return errors.length ? { errors } : { grades };
}

const VERDICTS = ['ok', 'partial', 'fail'];
const TESTS = ['pass', 'fail', 'none'];
const RELAY = Object.fromEntries(Object.entries(VERDICT).map(([k, v]) => [v, k]));
/** Parses one verify reply and returns { reports, checks } keyed by label, or { errors }. */
export function parseVerify(stdout, labels) {
  let text = stdout, apiError = null;
  try { const j = JSON.parse(stdout); text = typeof j.result === 'string' ? j.result : stdout; if (j.is_error) apiError = text; } catch { /* raw text */ }
  if (apiError) return { errors: [`claude reported an error: ${apiError.slice(0, 200)}`] };
  const obj = extractJsonObject(text);
  if (!obj) return { errors: ['no JSON object in the reply'] };
  if (!obj.reports || typeof obj.reports !== 'object') return { errors: ['no "reports" object in the reply'] };
  const errors = []; const reports = {};
  for (const l of labels) {
    const g = obj.reports[l];
    if (!g) { errors.push(`missing label ${l}`); continue; }
    if (!VERDICTS.includes(g.verdict)) errors.push(`${l}: verdict invalid`);
    for (const k of ['verified', 'wrong', 'missed']) if (!Number.isInteger(g[k]) || g[k] < 0) errors.push(`${l}: ${k} invalid`);
    reports[l] = { verdict: g.verdict, verified: g.verified, wrong: g.wrong, missed: g.missed, key_miss: typeof g.key_miss === 'string' ? g.key_miss : '' };
    if (g.tests !== undefined) { if (TESTS.includes(g.tests)) reports[l].tests = g.tests; else errors.push(`${l}: tests invalid`); }
  }
  return errors.length ? { errors } : { reports, checks: Array.isArray(obj.checks) ? obj.checks : [] };
}
/** The scores_by_run.json entry of one verify-graded run. */
export const verifyScore = (g, label) => ({
  verdict: g.verdict, relay: RELAY[g.verdict], verified: g.verified, wrong: g.wrong, missed: g.missed, key_miss: g.key_miss,
  ...(g.tests !== undefined ? { tests: g.tests } : {}), label, mode: 'verify',
});

export async function grade(roundDir, { only = null, regrade = false, yes = false, spawn = nodeSpawn, log = console.log, timeoutMs = 30 * 60e3, concurrency = MAX_GRADERS, cwd = join(tmpdir(), 'sprag-evals-grader') } = {}) {
  roundDir = resolve(roundDir);
  const round = readJson(join(roundDir, 'round.json'));
  const errs = validateRound(round);
  if (errs.length) throw new Error('round.json invalid:\n- ' + errs.join('\n- '));
  for (const c of round.cases) {
    if (!existsSync(join(roundDir, c.rubric))) throw new Error(`rubric missing for case ${c.id}: ${c.rubric}`);
    if (!existsSync(join(roundDir, c.prompt))) throw new Error(`prompt file missing for case ${c.id}: ${c.prompt}`);
  }
  const plan = planGrading(roundDir, round, { only, regrade });
  for (const p of plan) {
    if (!p.verify) continue;
    if (p.impl) {
      for (const r of p.reports) if (!existsSync(r.wt)) throw new Error(`worktree missing for run ${r.key}: ${r.wt} (replay the round first)`);
      p.cwd = join(roundDir, '.guard', 'grade-cwd');
      continue;
    }
    p.cwd = worktreeFor(roundDir, round, p.caseObj).wt;
    if (!existsSync(p.cwd)) throw new Error(`worktree missing for case ${p.caseId}: ${p.cwd} (replay the round first)`);
  }
  const est = estimateGrading(plan, round.date);
  log(`round ${round.id}: ${plan.length} case(s) to grade, ${plan.reduce((n, p) => n + p.reports.length, 0)} report(s), at most ${Math.min(concurrency, MAX_GRADERS)} graders at once`);
  for (const p of plan) log(`  ${p.caseId}: ${p.reports.length} reports${p.refKey ? ' against the reference' : ''}${p.verify ? ' to verify with tools' : ''}, prompt ${p.prompt.length} chars`);
  const refOnly = planReferenceOnly(roundDir, round, { only });
  if (refOnly.length) log(`${refOnly.length} case(s) kept on the baseline: reference score only, no grader`);
  log(`estimated: ~${(est.inTok / 1e3).toFixed(0)}k input + ~${(est.outTok / 1e3).toFixed(0)}k output tokens on ${GRADER_MODEL} (API-equivalent ~$${est.usd.toFixed(2)}, not charged on the Max subscription)`);
  log('billing: uses the Max subscription; ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are removed from the child env');
  if (plan.some((p) => p.verify)) log('verify graders run tools in the case worktree: the estimate below counts the prompt and one answer only, so the real cost is higher');
  const shown = (args) => args.map((a) => (a === '' ? '""' : /\s/.test(a) ? `'${a}'` : a)).join(' ');
  if (plan.some((p) => p.verify && !p.impl)) log(`command per verify case: (cd <case worktree> && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude ${shown(verifyArgs())} < blind/<case>.md)`);
  if (plan.some((p) => p.impl)) log(`command per write case: (cd ${join(roundDir, '.guard', 'grade-cwd')} && <guarded env> claude ${shown(implVerifyArgs(['<copy>...']))} < blind/<case>.md)`);
  if (!plan.length || plan.some((p) => !p.verify)) log(`command per case: (cd ${cwd} && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude ${shown(gradeArgs())} < blind/<case>.md)`);
  if (!yes) { log('stopped before grading: pass --yes to start'); return { graded: 0, failed: [] }; }

  mkdirSync(join(roundDir, 'blind'), { recursive: true }); mkdirSync(join(roundDir, 'grading'), { recursive: true }); mkdirSync(cwd, { recursive: true });
  const keyPath = join(roundDir, 'blind_key.json'); const scoresPath = join(roundDir, 'scores_by_run.json');
  const blindKey = readJson(keyPath, {});
  for (const p of plan) {
    writeFileSync(join(roundDir, 'blind', `${p.caseId}.md`), p.prompt);
    for (const [label, key] of Object.entries(p.labels)) blindKey[`${p.caseId}-${label}`] = key;
    if (p.refKey) blindKey[`${p.caseId}-ref`] = p.refKey;
  }
  writeFileSync(keyPath, JSON.stringify(blindKey, null, 1));

  if (plan.some((p) => p.impl)) ensureGuard(roundDir);
  const scores = readJson(scoresPath, {}); const failed = []; let graded = 0;
  for (const r of refOnly) scores[r.refKey] = referenceScore(r.caseId, referenceMax(scores));
  if (refOnly.length) writeFileSync(scoresPath, JSON.stringify(scores, null, 1));
  const queue = [...plan];
  const worker = async () => {
    for (let p; (p = queue.shift()); ) {
      const r = p.impl
        ? await runClaude({ spawn, args: implVerifyArgs(p.reports.map((x) => x.wt)), prompt: p.prompt, cwd: p.cwd, timeoutMs, env: writeGuardEnv(cleanEnv(), { roundDir }) })
        : p.verify ? await runClaude({ spawn, args: verifyArgs(), prompt: p.prompt, cwd: p.cwd, timeoutMs }) : await runGrader({ spawn, prompt: p.prompt, cwd, timeoutMs });
      writeFileSync(join(roundDir, 'grading', `${p.caseId}.out.json`), r.out);
      if (p.verify) {
        const v = r.code === 0 ? parseVerify(r.out, Object.keys(p.labels)) : { errors: [`claude exited ${r.code}: ${r.err.slice(0, 200)}`] };
        if (v.errors) { failed.push({ caseId: p.caseId, errors: v.errors }); log(`failed ${p.caseId}: ${v.errors.join('; ')}`); continue; }
        for (const [label, key] of Object.entries(p.labels)) scores[key] = verifyScore(v.reports[label], `${p.caseId}-${label}`);
        writeFileSync(scoresPath, JSON.stringify(scores, null, 1));
        graded++; log(`graded ${p.caseId}`);
        continue;
      }
      const parsed = r.code === 0 ? parseGraderReply(r.out, Object.keys(p.labels)) : { errors: [`claude exited ${r.code}: ${r.err.slice(0, 200)}`] };
      if (parsed.errors) { failed.push({ caseId: p.caseId, errors: parsed.errors }); log(`failed ${p.caseId}: ${parsed.errors.join('; ')}`); continue; }
      for (const [label, key] of Object.entries(p.labels)) scores[key] = { ...parsed.grades[label], label: `${p.caseId}-${label}` };
      if (p.refKey) scores[p.refKey] = referenceScore(p.caseId, Object.values(parsed.grades)[0].max);
      writeFileSync(scoresPath, JSON.stringify(scores, null, 1));
      graded++; log(`graded ${p.caseId}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, MAX_GRADERS)) }, worker));
  return { graded, failed };
}

export async function main(argv = []) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  if (!argv[0] || argv[0].startsWith('--')) { console.error('usage: grade.mjs <round-dir> [--case <id>] [--regrade] [--yes]'); return 2; }
  try {
    const { failed } = await grade(argv[0], { only: opt('--case'), regrade: argv.includes('--regrade'), yes: argv.includes('--yes') });
    return failed.length ? 1 : 0;
  } catch (e) { console.error(e.message); return 1; }
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
