#!/usr/bin/env node
/**
 * Rule-based lane assignment: a blind classifier reads one delegation prompt plus a rule and picks a lane.
 *
 *   node scripts/evals/assign.mjs <round-dir> --rule <rule.md> [--cases id,id,...] [--concurrency 3] [--redo] [--yes]
 *
 * The classifier sees the rule and the prompt only (no results, costs or original lane). Output:
 * <round-dir>/assignments/<rule basename>.json = { rule, at, byCase: { <caseId>: { lane, reason } } }.
 * Without --yes nothing runs and nothing is written: the plan and an estimate are printed.
 * Each call is `claude -p` on the Max subscription (API keys removed from the child env).
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { validateRound, readJson, extractJsonObject, runClaude, isMain } from './lib.mjs';

export const CLASSIFIER_MODEL = 'claude-sonnet-5-5';
export const LANES = ['haiku-low', 'sonnet-high', 'sonnet-xhigh', 'sonnet-xhigh-web', 'main'];
export const MAX_CLASSIFIERS = 3;
/** `--tools ""` disables every tool, so the classifier can only read what is in the prompt. */
export const assignArgs = () => ['-p', '--model', CLASSIFIER_MODEL, '--effort', 'high', '--output-format', 'json', '--tools', ''];

/** Pure: the exact text one classifier receives. The repo path is masked as <repo>. */
export function buildAssignPrompt(ruleText, promptText) {
  return [
    ruleText.trim(),
    '## 위임 프롬프트',
    promptText.replaceAll('{{REPO}}', '<repo>').trim(),
    'Answer with ONLY the JSON object described in the rule above: no code fence, no prose before or after.',
  ].join('\n\n') + '\n';
}

/** Parses one classifier reply: { lane, reason } or { errors }. */
export function parseAssignment(stdout) {
  let text = stdout, apiError = null;
  try { const j = JSON.parse(stdout); text = typeof j.result === 'string' ? j.result : stdout; if (j.is_error) apiError = text; } catch { /* raw text */ }
  if (apiError) return { errors: [`claude reported an error: ${apiError.slice(0, 200)}`] };
  const obj = extractJsonObject(text);
  if (!obj) return { errors: ['no JSON object in the reply'] };
  if (!LANES.includes(obj.lane)) return { errors: [`unknown lane: ${JSON.stringify(obj.lane)}`] };
  return { lane: obj.lane, reason: typeof obj.reason === 'string' ? obj.reason.trim() : '' };
}

/** Pure given the files: one entry per selected case that still needs a lane. */
export function planAssign(roundDir, round, { cases = null, redo = false, existing = {} } = {}) {
  const plan = [];
  for (const c of round.cases) {
    if (cases && !cases.includes(c.id)) continue;
    if (!redo && existing[c.id]) continue;
    plan.push({ caseId: c.id, promptFile: join(roundDir, c.prompt) });
  }
  return plan;
}

export async function assign(roundDir, ruleFile, {
  cases = null, concurrency = MAX_CLASSIFIERS, redo = false, yes = false, spawn = nodeSpawn, log = console.log,
  timeoutMs = 5 * 60e3, cwd = join(tmpdir(), 'sprag-evals-assign'), now = () => new Date().toISOString(),
} = {}) {
  roundDir = resolve(roundDir); ruleFile = resolve(ruleFile);
  const round = readJson(join(roundDir, 'round.json'));
  const errs = validateRound(round);
  if (errs.length) throw new Error('round.json invalid:\n- ' + errs.join('\n- '));
  if (!existsSync(ruleFile)) throw new Error(`rule file missing: ${ruleFile}`);
  if (cases) for (const id of cases) if (!round.cases.some((c) => c.id === id)) throw new Error(`no case ${id} in round ${round.id}`);
  const ruleName = basename(ruleFile).replace(/\.md$/, '');
  const outPath = join(roundDir, 'assignments', `${ruleName}.json`);
  const doc = readJson(outPath, null) || { rule: ruleName, at: now(), byCase: {} };
  const plan = planAssign(roundDir, round, { cases, redo, existing: doc.byCase });
  for (const p of plan) if (!existsSync(p.promptFile)) throw new Error(`prompt file missing for case ${p.caseId}`);
  const ruleText = readFileSync(ruleFile, 'utf8');
  for (const p of plan) p.prompt = buildAssignPrompt(ruleText, readFileSync(p.promptFile, 'utf8'));
  const chars = plan.reduce((n, p) => n + p.prompt.length, 0);
  const width = Math.max(1, Math.min(concurrency, MAX_CLASSIFIERS));
  log(`assign ${round.id} with rule ${ruleName}: ${plan.length} case(s) to classify, ~${Math.ceil(chars / 3)} input tokens (prompt chars / 3) on ${CLASSIFIER_MODEL}, at most ${width} at once`);
  log('billing: uses the Max subscription; ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are removed from the child env');
  if (!yes) { log('stopped before classifying: pass --yes to start'); return { assigned: 0, failed: [], counts: {} }; }
  if (!plan.length) { log('nothing to do'); return { assigned: 0, failed: [], counts: laneCounts(doc.byCase) }; }

  mkdirSync(cwd, { recursive: true }); mkdirSync(join(roundDir, 'assignments'), { recursive: true });
  const failed = []; let assigned = 0; const queue = [...plan];
  const classify = async (p) => {
    let last = [];
    for (let attempt = 0; attempt < 2; attempt++) { // one retry on a parse error or a failed call
      const r = await runClaude({ spawn, args: assignArgs(), prompt: p.prompt, cwd, timeoutMs });
      const parsed = r.code === 0 ? parseAssignment(r.out) : { errors: [`claude exited ${r.code}: ${r.err.slice(0, 200)}`] };
      if (!parsed.errors) return parsed;
      last = parsed.errors;
    }
    return { errors: last };
  };
  const worker = async () => {
    for (let p; (p = queue.shift()); ) {
      const r = await classify(p);
      if (r.errors) { failed.push({ caseId: p.caseId, errors: r.errors }); log(`failed ${p.caseId}: ${r.errors.join('; ')}`); continue; }
      doc.byCase[p.caseId] = { lane: r.lane, reason: r.reason };
      doc.at = now();
      writeFileSync(outPath, JSON.stringify(doc, null, 1) + '\n'); // after each case, so an interrupted run keeps its work
      assigned++; log(`assigned ${p.caseId}: ${r.lane}`);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  const counts = laneCounts(doc.byCase);
  log(`lanes: ${Object.entries(counts).map(([l, n]) => `${l} ${n}`).join(', ') || 'none'} -> ${outPath}`);
  return { assigned, failed, counts };
}

const laneCounts = (byCase) => Object.values(byCase).reduce((m, a) => { m[a.lane] = (m[a.lane] || 0) + 1; return m; }, {});

export async function main(argv = []) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const rule = opt('--rule');
  if (!argv[0] || argv[0].startsWith('--') || !rule) {
    console.error('usage: assign.mjs <round-dir> --rule <rule.md> [--cases id,id,...] [--concurrency 3] [--redo] [--yes]');
    return 2;
  }
  try {
    const { failed } = await assign(argv[0], rule, {
      cases: opt('--cases') ? opt('--cases').split(',').map((s) => s.trim()).filter(Boolean) : null,
      concurrency: Number(opt('--concurrency')) || MAX_CLASSIFIERS, redo: argv.includes('--redo'), yes: argv.includes('--yes'),
    });
    return failed.length ? 1 : 0;
  } catch (e) { console.error(e.message); return 1; }
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
