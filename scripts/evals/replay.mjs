// Replay delegation cases headlessly under each condition.
// Usage: node scripts/evals/replay.mjs <round-dir> [--only <caseId>] [--max-runs N] [--dry-run] [--yes]
//
// A case with its own repo/commit runs in <round>/wt/<caseId>; other cases share <round>/wt at the round's commit.
// Dispatch is paced by the cap windows (live usage API, else the statusline snapshot last-caps.json): the seven-day window at round.capStopPct
// stops new runs, the five-hour window at 95% waits for its reset. caps.jsonl records the windows per event.
// The windows come from the OAuth usage API (60 s cache) and fall back to that snapshot file; caps.jsonl notes which.
//
// Without --yes nothing runs: the plan, an estimate and (with --dry-run) the full command lines are printed.
// Each run is `claude -p` in a detached git worktree at the round's commit, with API keys removed from the
// environment so the Max subscription pays. Edit/Write/NotebookEdit are denied unless the case sets "write": true.
import { spawn as nodeSpawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { userDataDir } from '../../src/paths.js';
import { readOauthToken } from '../../src/oauth-budget.js';
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
    const conds = c.conditions ? round.conditions.filter((x) => c.conditions.includes(x.key)) : round.conditions;
    for (const cond of conds) for (let rep = 1; rep <= (round.repeats || 1); rep++) {
      runs.push({ key: `${c.id}-${cond.key}${(round.repeats || 1) > 1 ? `-${rep}` : ''}`, case: c, cond, rep });
    }
  }
  return runs;
}
/** Arguments for one replayed run. The prompt goes in on stdin, so the variadic tool lists can come last. */
/** The child environment: API keys removed, plus the string values a condition sets in `env` (e.g. a compact window). */
export function runEnv(round, r, base = cleanEnv()) {
  const cond = round.conditions.find((c) => c.id === r.condition);
  const extra = Object.fromEntries(Object.entries(cond?.env || {}).filter(([k, v]) => /^[A-Z][A-Z0-9_]*$/.test(k) && typeof v === 'string'));
  return { ...base, ...extra };
}

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
/** The worktree a case runs in: its own when it carries repo/commit, the round's otherwise. */
export const worktreeFor = (roundDir, round, c) => (c.repo && c.commit
  ? { wt: join(roundDir, 'wt', c.id), repo: c.repo, commit: c.commit }
  : { wt: join(roundDir, 'wt'), repo: round.repo, commit: round.commit });
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

export const RATE_LIMIT_RE = /rate.?limit|usage limit|429|529|overloaded|Not logged in|Please run \/login/i;
export const capsPath = () => join(userDataDir(), 'last-caps.json');
/** Reads the statusline cap snapshot: { capturedAt, fiveHour, sevenDay } with {usedPct, resetsAt} or null per window. */
export function readCapsFile(file = capsPath()) {
  const snap = readJson(file, null);
  const win = (k) => {
    const w = (snap?.caps?.windows || []).find((x) => x && x.key === k);
    return w && Number.isFinite(w.usedPct) ? { usedPct: w.usedPct, resetsAt: Number.isFinite(w.resetsAt) ? w.resetsAt : null } : null;
  };
  return { capturedAt: snap?.capturedAt ?? null, fiveHour: win('five_hour'), sevenDay: win('seven_day'), source: 'file' };
}

const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const CAPS_TTL_MS = 60e3;
const defaultCapsCache = { at: 0, value: null };
/** Maps one usage-API window ({utilization, resets_at ISO}) to {usedPct, resetsAt epoch seconds}; null when absent. */
function apiWindow(w) {
  if (w == null) return null;
  const usedPct = Number(w.utilization);
  if (!Number.isFinite(usedPct)) throw new Error('malformed window');
  const t = w.resets_at ? Date.parse(w.resets_at) : NaN;
  return { usedPct, resetsAt: Number.isFinite(t) ? Math.floor(t / 1000) : null };
}
/**
 * Cap windows from the OAuth usage API (what the statusline snapshot is derived from, but live), cached for
 * 60 seconds. With no token, a non-200, a network error or a malformed body it falls back to the snapshot file.
 * The result carries source: 'api' | 'file'. Pass your own cache object to keep a test's state separate.
 */
export async function readCaps({ file = capsPath(), fetchImpl = globalThis.fetch, token, now = Date.now, cache = defaultCapsCache, ttlMs = CAPS_TTL_MS } = {}) {
  if (cache.value && now() - cache.at < ttlMs) return cache.value;
  try {
    const t = token === undefined ? readOauthToken() : token;
    if (t && typeof fetchImpl === 'function') {
      const res = await fetchImpl(OAUTH_USAGE_URL, {
        headers: { authorization: `Bearer ${t}`, 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' },
        signal: AbortSignal.timeout(10e3),
      });
      if (res.status === 200) {
        const body = await res.json();
        if (body && typeof body === 'object' && ('five_hour' in body || 'seven_day' in body)) {
          const value = { capturedAt: new Date(now()).toISOString(), fiveHour: apiWindow(body.five_hour), sevenDay: apiWindow(body.seven_day), source: 'api' };
          cache.at = now(); cache.value = value;
          return value;
        }
      }
    }
  } catch { /* fall back to the snapshot file */ }
  const value = readCapsFile(file);
  cache.at = now(); cache.value = value;
  return value;
}
/**
 * Pure: what to do before dispatching the next run. 'stop' when the seven-day window reached stopPct,
 * 'wait' (with untilMs) while the five-hour window is at 95% or more and has not reset, 'go' otherwise.
 */
export function capDecision(caps, stopPct, nowMs) {
  if (stopPct != null && caps.sevenDay && caps.sevenDay.usedPct >= stopPct) return { action: 'stop' };
  const f = caps.fiveHour;
  if (f && f.usedPct >= 95) {
    const untilMs = f.resetsAt ? f.resetsAt * 1000 + 60e3 : nowMs + 60e3;
    if (untilMs > nowMs) return { action: 'wait', untilMs };
  }
  return { action: 'go' };
}
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function replay(roundDir, {
  only = null, dryRun = false, yes = false, spawn = nodeSpawn, log = console.log, timeoutMs = 20 * 60e3, costFilesList = null,
  maxRuns = null, caps = () => readCaps(), sleep = defaultSleep, now = Date.now, pollMs = 60e3, retryWaitMs = 10 * 60e3,
  git = (args) => execFileSync('git', args, { stdio: 'inherit' }),
} = {}) {
  roundDir = resolve(roundDir);
  const round = readJson(join(roundDir, 'round.json'));
  const errs = validateRound(round);
  if (errs.length) throw new Error('round.json invalid:\n- ' + errs.join('\n- '));
  for (const c of round.cases) {
    if (!existsSync(join(roundDir, c.rubric))) throw new Error(`rubric missing for case ${c.id}: ${c.rubric} (write rubrics before running)`);
    for (const f of [c.prompt, c.improvedPrompt].filter(Boolean)) if (!existsSync(join(roundDir, f))) throw new Error(`prompt file missing for case ${c.id}: ${f}`);
  }
  const runsPath = join(roundDir, 'runs.json'); const done = readJson(runsPath, {});
  let todo = planRuns(round, only).filter((r) => !(r.key in done));
  if (only && !round.cases.some((c) => c.id === only)) throw new Error(`no case ${only} in round ${round.id}`);
  if (maxRuns != null) todo = todo.slice(0, Math.max(0, maxRuns));
  const est = estimateTokens(todo, costFilesList || costFiles());
  log(`round ${round.id}: ${todo.length} runs planned (${Object.keys(done).length} already done${maxRuns != null ? `, --max-runs ${maxRuns}` : ''})`);
  log(`estimated tokens: ~${(est / 1e6).toFixed(1)}M (per-model averages from past cost.json, fallback haiku 300k, sonnet 600k, opus 2M)`);
  log('billing: uses the Max subscription (no API charge, counts toward weekly limits); ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are removed from the child env');
  if (dryRun) {
    const seen = new Set();
    for (const r of todo) {
      const w = worktreeFor(roundDir, round, r.case);
      if (!seen.has(w.wt)) { seen.add(w.wt); log(`worktree: git -C ${shellQuote(w.repo)} worktree add --detach ${shellQuote(w.wt)} ${w.commit}`); }
      const argv = runArgs(round, r, '<uuid>').map(shellQuote).join(' ');
      log(`  [${r.key}] (cd ${shellQuote(w.wt)} && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude ${argv} < ${shellQuote(join(roundDir, promptFile(r)))})`);
    }
  }
  if (dryRun || !yes || !todo.length) { if (!yes && !dryRun) log('stopped before running: pass --yes to start'); return { started: 0 }; }

  for (const d of ['reports', 'transcripts']) mkdirSync(join(roundDir, d), { recursive: true });
  const cost = readJson(join(roundDir, 'cost.json'), {}); const blocked = readJson(join(roundDir, 'blocked.json'), {});
  const save = () => { writeFileSync(runsPath, JSON.stringify(done, null, 1)); writeFileSync(join(roundDir, 'cost.json'), JSON.stringify(cost, null, 1)); writeFileSync(join(roundDir, 'blocked.json'), JSON.stringify(blocked, null, 1)); };
  const capsLog = async (event, c = null) => {
    c ||= await caps();
    appendFileSync(join(roundDir, 'caps.jsonl'),
      JSON.stringify({ at: new Date(now()).toISOString(), fiveHour: c.fiveHour?.usedPct ?? null, sevenDay: c.sevenDay?.usedPct ?? null, source: c.source ?? null, event }) + '\n');
  };
  // Synchronous on purpose: two runs of one case starting together must not both try to add its worktree.
  const ensureWorktree = (w) => { if (!existsSync(w.wt)) git(['-C', w.repo, 'worktree', 'add', '--detach', w.wt, w.commit]); };
  const spawnOnce = (r, wt, sessionId, prompt) => new Promise((res) => {
    let out = '', err = '', settled = false;
    const end = (code) => { if (!settled) { settled = true; res({ code, out, err }); } };
    const child = spawn('claude', runArgs(round, r, sessionId), { cwd: wt, env: runEnv(round, r), stdio: ['pipe', 'pipe', 'pipe'], shell: false, timeout: timeoutMs });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { err += d; });
    child.on('error', (e) => { err += e.message; end(-1); });
    child.on('close', (code) => end(code));
    child.stdin.on('error', () => { /* child exited early; close handler reports it */ });
    child.stdin.end(prompt);
  });
  // A zero exit whose JSON envelope is an error counts as failed too, so a limit message is never saved as a report.
  const failedText = ({ code, out }) => { if (code !== 0) return true; try { return JSON.parse(out).is_error === true; } catch { return false; } };
  const runOne = async (r) => {
    const w = worktreeFor(roundDir, round, r.case);
    ensureWorktree(w);
    const prompt = readFileSync(join(roundDir, promptFile(r)), 'utf8').replaceAll('{{REPO}}', w.wt);
    let sessionId = randomUUID(); let startedAt = new Date(now()).toISOString();
    let res = await spawnOnce(r, w.wt, sessionId, prompt);
    if (failedText(res) && RATE_LIMIT_RE.test(res.out + res.err)) {
      const f = (await caps()).fiveHour; const resetMs = f?.resetsAt ? f.resetsAt * 1000 - now() : 0;
      const waitMs = Math.max(retryWaitMs, resetMs);
      log(`rate limited ${r.key}; retrying once in ${Math.round(waitMs / 60e3)} min`); await capsLog('rate-limit-wait');
      await sleep(waitMs);
      sessionId = randomUUID(); startedAt = new Date(now()).toISOString();
      res = await spawnOnce(r, w.wt, sessionId, prompt);
    }
    if (failedText(res)) { const tail = (res.err && res.err.trim()) || (res.out && res.out.trim()) || ''; log(`failed ${r.key} exit=${res.code}; not recorded, rerun to retry${tail ? `: ${tail.slice(-300)}` : ''}`); return; }
    let text = res.out; try { text = JSON.parse(res.out).result ?? res.out; } catch { /* keep raw */ }
    writeFileSync(join(roundDir, 'reports', `${r.key}.md`), String(text));
    const src = join(claudeProjects(), projectSlug(w.wt), `${sessionId}.jsonl`);
    if (existsSync(src)) {
      copyFileSync(src, join(roundDir, 'transcripts', `${r.key}.jsonl`));
      const entries = readJsonl(src); const c = costOfTranscript(entries, r.cond.model);
      cost[r.key] = { model: c.model, totals: c.totals, usd: c.usd, ms: c.ms, calls: c.calls, at: c.startedAt }; blocked[r.key] = countWebSearches(entries);
    } else log(`warning: transcript not found for ${r.key} at ${src}`);
    done[r.key] = { case: r.case.id, condition: r.cond.id, rep: r.rep, sessionId, startedAt, exitCode: res.code };
    save(); log(`done ${r.key} exit=${res.code}`);
  };
  const stopPct = round.capStopPct ?? null; let stopped = false;
  /** Waits out a full five-hour window; returns false once the seven-day window says stop. */
  const gate = async () => {
    let waiting = false;
    for (;;) {
      if (stopped) return false;
      const c = await caps(); const d = capDecision(c, stopPct, now());
      // Several workers can await caps() at once; only the first one to see 'stop' logs it.
      if (d.action === 'stop') { if (stopped) return false; stopped = true; await capsLog('stop', c); log(`cap stop: seven-day window at ${c.sevenDay.usedPct}% >= ${stopPct}%; in-flight runs finish, rerun to resume`); return false; }
      if (d.action === 'go') return true;
      if (!waiting) { waiting = true; await capsLog('wait', c); log(`cap wait: five-hour window at ${c.fiveHour.usedPct}% until ${new Date(d.untilMs).toISOString()}`); }
      await sleep(Math.min(pollMs, Math.max(1000, d.untilMs - now())));
    }
  };
  await capsLog('start');
  const limit = Math.max(1, round.concurrency || 2); const queue = [...todo]; let started = 0;
  const worker = async () => { while (queue.length) { if (!(await gate())) return; const r = queue.shift(); if (!r) return; started++; await runOne(r); } };
  await Promise.all(Array.from({ length: limit }, worker));
  await capsLog('end');
  return { started, stopped };
}

export async function main(argv = []) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  if (!argv[0] || argv[0].startsWith('--')) { console.error('usage: replay.mjs <round-dir> [--only <caseId>] [--max-runs N] [--dry-run] [--yes]'); return 2; }
  const maxRuns = opt('--max-runs');
  if (maxRuns != null && !/^\d+$/.test(maxRuns)) { console.error('--max-runs needs a non-negative integer'); return 2; }
  try {
    await replay(argv[0], { only: opt('--only'), dryRun: argv.includes('--dry-run'), yes: argv.includes('--yes'), maxRuns: maxRuns == null ? null : Number(maxRuns) });
    return 0;
  } catch (e) { console.error(e.message); return 1; }
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
