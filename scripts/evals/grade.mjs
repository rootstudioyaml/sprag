// Blind-grade the reports of a replayed round, one Opus grader per case.
// Usage: node scripts/evals/grade.mjs <round-dir> [--case <id>] [--regrade] [--yes]
//
// Without --yes nothing is written and nothing runs: the plan, an estimate and the command are printed.
// Graders run `claude -p` with no tools, so everything they need (task, rubric, answer key) must be in the
// text they receive: put the answer key inside the rubric file.
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  cleanEnv, validateRound, readJson, readReport, blindOrder, stripModelLines, extractJsonObject, validateGrades,
  normalizeGrades, isMain, ratesFor,
} from './lib.mjs';

export const GRADER_MODEL = 'claude-opus-5-5';
export const MAX_GRADERS = 3;
/** `--tools ""` disables every tool (claude --help: 'Use "" to disable all tools'). */
export const gradeArgs = () => ['-p', '--model', GRADER_MODEL, '--effort', 'high', '--output-format', 'json', '--tools', ''];

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
    const labels = blindOrder(round.id, c.id, keys);
    const task = readFileSync(join(roundDir, c.prompt), 'utf8').replaceAll('{{REPO}}', '<repo>');
    const rubric = readFileSync(join(roundDir, c.rubric), 'utf8');
    const reports = Object.entries(labels).map(([label, key]) => ({ label, key, text: readReport(join(roundDir, 'reports', `${key}.md`)) }));
    const prompt = buildGradePrompt({ task, rubric, reports });
    plan.push({ caseId: c.id, labels, prompt, reports });
  }
  return plan;
}

/** Rough per-grader size: prompt chars / 3 input tokens, plus reasoning and answer. */
export function estimateGrading(plan, date) {
  const rates = ratesFor(GRADER_MODEL, date);
  let inTok = 0, outTok = 0;
  for (const p of plan) { inTok += Math.ceil(p.prompt.length / 3) + 3000; outTok += 8000; }
  return { inTok, outTok, usd: (inTok * rates.input + outTok * rates.output) / 1e6 };
}

function runGrader({ spawn, prompt, cwd, timeoutMs }) {
  return new Promise((res) => {
    let out = '', err = '', settled = false;
    const done = (v) => { if (!settled) { settled = true; res(v); } };
    const child = spawn('claude', gradeArgs(), { cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'], shell: false, timeout: timeoutMs });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { err += d; });
    child.on('error', (e) => done({ code: -1, out, err: err + e.message }));
    child.on('close', (code) => done({ code, out, err }));
    child.stdin.on('error', () => { /* the close handler reports an early exit */ });
    child.stdin.end(prompt);
  });
}

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
  const est = estimateGrading(plan, round.date);
  log(`round ${round.id}: ${plan.length} case(s) to grade, ${plan.reduce((n, p) => n + p.reports.length, 0)} report(s), at most ${Math.min(concurrency, MAX_GRADERS)} graders at once`);
  for (const p of plan) log(`  ${p.caseId}: ${p.reports.length} reports, prompt ${p.prompt.length} chars`);
  log(`estimated: ~${(est.inTok / 1e3).toFixed(0)}k input + ~${(est.outTok / 1e3).toFixed(0)}k output tokens on ${GRADER_MODEL} (API-equivalent ~$${est.usd.toFixed(2)}, not charged on the Max subscription)`);
  log('billing: uses the Max subscription; ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are removed from the child env');
  log(`command per case: (cd ${cwd} && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude ${gradeArgs().map((a) => (a === '' ? '""' : a)).join(' ')} < blind/<case>.md)`);
  if (!yes || !plan.length) { if (!yes) log('stopped before grading: pass --yes to start'); return { graded: 0, failed: [] }; }

  mkdirSync(join(roundDir, 'blind'), { recursive: true }); mkdirSync(join(roundDir, 'grading'), { recursive: true }); mkdirSync(cwd, { recursive: true });
  const keyPath = join(roundDir, 'blind_key.json'); const scoresPath = join(roundDir, 'scores_by_run.json');
  const blindKey = readJson(keyPath, {});
  for (const p of plan) {
    writeFileSync(join(roundDir, 'blind', `${p.caseId}.md`), p.prompt);
    for (const [label, key] of Object.entries(p.labels)) blindKey[`${p.caseId}-${label}`] = key;
  }
  writeFileSync(keyPath, JSON.stringify(blindKey, null, 1));

  const scores = readJson(scoresPath, {}); const failed = []; let graded = 0;
  const queue = [...plan];
  const worker = async () => {
    for (let p; (p = queue.shift()); ) {
      const r = await runGrader({ spawn, prompt: p.prompt, cwd, timeoutMs });
      writeFileSync(join(roundDir, 'grading', `${p.caseId}.out.json`), r.out);
      const parsed = r.code === 0 ? parseGraderReply(r.out, Object.keys(p.labels)) : { errors: [`claude exited ${r.code}: ${r.err.slice(0, 200)}`] };
      if (parsed.errors) { failed.push({ caseId: p.caseId, errors: parsed.errors }); log(`failed ${p.caseId}: ${parsed.errors.join('; ')}`); continue; }
      for (const [label, key] of Object.entries(p.labels)) scores[key] = { ...parsed.grades[label], label: `${p.caseId}-${label}` };
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
