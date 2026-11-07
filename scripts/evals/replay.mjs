// Replay delegation cases headlessly under each condition.
// Usage: node scripts/evals/replay.mjs <round-dir> [--only <caseId>] [--dry-run] [--yes]
//
// Without --yes nothing runs: the plan, an estimate and (with --dry-run) the full command lines are printed.
// Each run is `claude -p` in a detached git worktree at the round's commit, with API keys removed from the
// environment so the Max subscription pays. Edit/Write/NotebookEdit are denied unless the case sets "write": true.
import { spawn as nodeSpawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanEnv, validateRound, readJson, readJsonl, projectSlug, claudeProjects, costOfTranscript, countWebSearches,
  workDir, tokensOf, agentFor, isMain,
} from './lib.mjs';

const FALLBACK_TOKENS = { haiku: 3e5, sonnet: 6e5, opus: 2e6 };
const family = (m) => (/haiku/.test(m) ? 'haiku' : /opus/.test(m) ? 'opus' : 'sonnet');
const shellQuote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replaceAll("'", "'\\''")}'`);

export function planRuns(round, only = null) {
  const runs = [];
  for (const c of round.cases) {
    if (only && c.id !== only) continue;
    for (const cond of round.conditions) for (let rep = 1; rep <= (round.repeats || 1); rep++) {
      runs.push({ key: `${c.id}-${cond.key}${(round.repeats || 1) > 1 ? `-${rep}` : ''}`, case: c, cond, rep });
    }
  }
  return runs;
}
/** Arguments for one replayed run. The prompt goes in on stdin, so the variadic tool lists can come last. */
export function claudeArgs(cond, sessionId, { write = false, agent = cond.agent, allowedTools = [] } = {}) {
  const a = ['-p', '--model', cond.model, '--effort', cond.effort];
  if (agent) a.push('--agent', agent);
  a.push('--session-id', sessionId, '--output-format', 'json', '--permission-mode', 'dontAsk');
  // dontAsk denies whatever is not allowed, so a case that writes needs Edit and Write on an explicit list.
  const allow = allowedTools.length && write ? [...new Set([...allowedTools, 'Edit', 'Write'])] : allowedTools;
  if (allow.length) a.push('--allowedTools', ...allow);
  if (!write) a.push('--disallowedTools', 'Edit', 'Write', 'NotebookEdit');
  return a;
}
const runArgs = (round, r, sessionId) => claudeArgs(r.cond, sessionId, { write: r.case.write === true, agent: agentFor(r.case, r.cond), allowedTools: round.allowedTools || [] });
const promptFile = (r) => (r.cond.prompt === 'improved' ? r.case.improvedPrompt : r.case.prompt);

export function estimateTokens(runs, costFiles) {
  const sum = {}, n = {};
  for (const f of costFiles) for (const c of Object.values(readJson(f, {}))) { const k = family(c.model || ''); sum[k] = (sum[k] || 0) + tokensOf(c.totals); n[k] = (n[k] || 0) + 1; }
  return runs.reduce((t, r) => { const k = family(r.cond.model); return t + (n[k] ? sum[k] / n[k] : FALLBACK_TOKENS[k]); }, 0);
}
export function costFiles(work = workDir()) {
  const out = []; const here = fileURLToPath(new URL('../../handoff/delegation-eval/rounds/', import.meta.url));
  for (const base of [join(work, 'rounds'), here]) if (existsSync(base)) for (const r of readdirSync(base)) out.push(join(base, r, 'cost.json'));
  return out;
}

export async function replay(roundDir, { only = null, dryRun = false, yes = false, spawn = nodeSpawn, log = console.log, timeoutMs = 20 * 60e3, costFilesList = null } = {}) {
  roundDir = resolve(roundDir);
  const round = readJson(join(roundDir, 'round.json'));
  const errs = validateRound(round);
  if (errs.length) throw new Error('round.json invalid:\n- ' + errs.join('\n- '));
  for (const c of round.cases) {
    if (!existsSync(join(roundDir, c.rubric))) throw new Error(`rubric missing for case ${c.id}: ${c.rubric} (write rubrics before running)`);
    for (const f of [c.prompt, c.improvedPrompt].filter(Boolean)) if (!existsSync(join(roundDir, f))) throw new Error(`prompt file missing for case ${c.id}: ${f}`);
  }
  const runsPath = join(roundDir, 'runs.json'); const done = readJson(runsPath, {});
  const todo = planRuns(round, only).filter((r) => !(r.key in done));
  if (only && !round.cases.some((c) => c.id === only)) throw new Error(`no case ${only} in round ${round.id}`);
  const wt = join(roundDir, 'wt');
  const est = estimateTokens(todo, costFilesList || costFiles());
  log(`round ${round.id}: ${todo.length} runs planned (${Object.keys(done).length} already done)`);
  log(`estimated tokens: ~${(est / 1e6).toFixed(1)}M (per-model averages from past cost.json, fallback haiku 300k, sonnet 600k, opus 2M)`);
  log('billing: uses the Max subscription (no API charge, counts toward weekly limits); ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are removed from the child env');
  if (dryRun) {
    log(`worktree: git -C ${shellQuote(round.repo)} worktree add --detach ${shellQuote(wt)} ${round.commit}`);
    for (const r of todo) {
      const argv = runArgs(round, r, '<uuid>').map(shellQuote).join(' ');
      log(`  [${r.key}] (cd ${shellQuote(wt)} && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude ${argv} < ${shellQuote(join(roundDir, promptFile(r)))})`);
    }
  }
  if (dryRun || !yes || !todo.length) { if (!yes && !dryRun) log('stopped before running: pass --yes to start'); return { started: 0 }; }

  if (!existsSync(wt)) execFileSync('git', ['-C', round.repo, 'worktree', 'add', '--detach', wt, round.commit], { stdio: 'inherit' });
  for (const d of ['reports', 'transcripts']) mkdirSync(join(roundDir, d), { recursive: true });
  const cost = readJson(join(roundDir, 'cost.json'), {}); const blocked = readJson(join(roundDir, 'blocked.json'), {});
  const save = () => { writeFileSync(runsPath, JSON.stringify(done, null, 1)); writeFileSync(join(roundDir, 'cost.json'), JSON.stringify(cost, null, 1)); writeFileSync(join(roundDir, 'blocked.json'), JSON.stringify(blocked, null, 1)); };
  const runOne = (r) => new Promise((res) => {
    const sessionId = randomUUID();
    const prompt = readFileSync(join(roundDir, promptFile(r)), 'utf8').replaceAll('{{REPO}}', wt);
    const startedAt = new Date().toISOString(); let out = ''; let settled = false;
    const finish = (code) => {
      if (settled) return; settled = true;
      if (code !== 0) { log(`failed ${r.key} exit=${code}; not recorded, rerun to retry`); res(); return; }
      let text = out; try { text = JSON.parse(out).result ?? out; } catch { /* keep raw */ }
      writeFileSync(join(roundDir, 'reports', `${r.key}.md`), String(text));
      const src = join(claudeProjects(), projectSlug(wt), `${sessionId}.jsonl`);
      if (existsSync(src)) {
        copyFileSync(src, join(roundDir, 'transcripts', `${r.key}.jsonl`));
        const entries = readJsonl(src); const c = costOfTranscript(entries, r.cond.model);
        cost[r.key] = { model: c.model, totals: c.totals, usd: c.usd, ms: c.ms, calls: c.calls, at: c.startedAt }; blocked[r.key] = countWebSearches(entries);
      } else log(`warning: transcript not found for ${r.key} at ${src}`);
      done[r.key] = { case: r.case.id, condition: r.cond.id, rep: r.rep, sessionId, startedAt, exitCode: code };
      save(); log(`done ${r.key} exit=${code}`); res();
    };
    const child = spawn('claude', runArgs(round, r, sessionId), { cwd: wt, env: cleanEnv(), stdio: ['pipe', 'pipe', 'inherit'], shell: false, timeout: timeoutMs });
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', (e) => { log(`failed ${r.key}: ${e.message}`); finish(-1); });
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => { /* child exited early; close handler reports it */ });
    child.stdin.end(prompt);
  });
  const limit = Math.max(1, round.concurrency || 2); const queue = [...todo]; let started = 0;
  const worker = async () => { for (let r; (r = queue.shift()); ) { started++; await runOne(r); } };
  await Promise.all(Array.from({ length: limit }, worker));
  return { started };
}

export async function main(argv = []) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  if (!argv[0] || argv[0].startsWith('--')) { console.error('usage: replay.mjs <round-dir> [--only <caseId>] [--dry-run] [--yes]'); return 2; }
  try {
    await replay(argv[0], { only: opt('--only'), dryRun: argv.includes('--dry-run'), yes: argv.includes('--yes') });
    return 0;
  } catch (e) { console.error(e.message); return 1; }
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
