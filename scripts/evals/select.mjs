#!/usr/bin/env node
/**
 * Build a bulk replay round from the ledger snapshot (scripts/evals/snapshot.mjs).
 *
 *   node scripts/evals/select.mjs --n 100 [--id r3-bulk-YYYY-MM-DD] [--seed 1] [--exclude <round-dir>]... [--dry-run]
 *
 * Each picked delegation becomes one case that replays the original prompt read-only in its own repo at
 * the commit that was current when it ran: the routed lane (A haiku-low or S sonnet-high) against an
 * opus-direct baseline B. Grading compares the lane to the baseline report (round.grading "reference"),
 * so one shared rubric serves every case. The round lives under handoff/ (gitignored) because the prompts
 * are private; round.json itself holds no prompt text.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { workDir, readJson, readJsonl, sha10, mulberry32, validateRound, isMain } from './lib.mjs';

export const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const EVAL_CWD = /delegation-eval|evals-work|scratchpad/;
export const kindOf = (e) => String(e.rule || '').split('|')[1] || 'other';
export const tierOf = (e) => String(e.rule || '').split('|')[0] || null;

/** One rubric for every case: the lane's report is judged against the baseline report shown above it. */
export const REFERENCE_RUBRIC = `# 기준 대조 채점

각 보고서를 위의 기준 보고서와 대조한다. 기준 보고서는 같은 작업을 상위 모델이 직접 수행한 결과다.
항목은 하나뿐이다.

1. 기준 보고서와 같은 결론에 도달했고 그 결론을 받치는 핵심 사실을 담았는가 (0점에서 2점)
   - 2점은 결론이 같고 핵심 사실도 빠짐없이 담은 경우다.
   - 1점은 방향은 같지만 핵심 사실이 하나 빠졌거나 세부 내용이 틀린 경우다.
   - 0점은 결론이 다르거나 작업을 끝내지 못했거나 작업을 거절한 경우다.

relay 값은 점수에 맞춘다. 2점이면 예, 1점이면 부분, 0점이면 아니오다.
기준 보고서에 없는 사실을 더 담았다고 감점하지 않는다. 그 사실이 틀렸을 때만 1점 이하로 준다.
작업 지시가 금지했거나 요구하지 않은 조사에서 기준 보고서가 얻은 사실은 핵심 사실로 세지 않는다. 지시를 지켜 그 사실을 빠뜨린 보고서는 감점하지 않는다.
items 배열에는 이 항목의 점수 하나만 넣고 max는 2로 적는다.
`;

/**
 * Rubric file of a "verify" round (scripts/evals/upround.mjs). The grader's instructions live in buildVerifyPrompt
 * (grade.mjs) and this text is not sent to it; the file only records the scale next to the cases.
 */
export const VERIFY_RUBRIC = `# Verification grading

There is no reference report. One grader sees every report of the case under blind labels, checks the claims the
reports disagree on with read-only tools in the case worktree or on the web, and gives each report a verdict:
- ok: the conclusion is right and no key fact is missing or wrong.
- partial: the conclusion points the right way but a key fact is missing or wrong.
- fail: the conclusion is wrong or the task was not finished.
Counts per report: verified (key findings confirmed true), wrong (claims confirmed false), missed (key facts another
report gave, confirmed true, that this report lacks). A fact from an investigation the task forbade or did not ask for is not missed.
`;

/** Bash command shapes that write to disk or change repo state (sed -i, tee, redirects, git writes, cp/mv/rm ...). */
export const BASH_WRITE_RE = /(^|[\s;&|(])(sed\s+-i|tee\s|>>?\s*(?!\/dev\/null)[^&\s]|git\s+(commit|add|mv|rm|push|checkout\s+-b|stash)|mkdir\s|cp\s|mv\s|rm\s|touch\s|npm\s+(version|publish|install|i\s)|node\s+-e[^\n]*writeFile)/;
const blocksOf = (o) => (Array.isArray(o?.message?.content) ? o.message.content : []);
const toolNamesFromEntries = (entries) => entries.flatMap((o) => blocksOf(o).filter((b) => b.type === 'tool_use').map((b) => b.name));
/** Pure: how many assistant Bash tool_use blocks in a parsed transcript run a command that writes files. */
export function bashWriteCount(entries) {
  let n = 0;
  for (const o of entries || []) {
    if (o?.type !== undefined && o.type !== 'assistant') continue;
    for (const b of blocksOf(o)) if (b.type === 'tool_use' && b.name === 'Bash' && BASH_WRITE_RE.test(String(b.input?.command ?? ''))) n++;
  }
  return n;
}

const promptHash = (p) => createHash('sha1').update(String(p || '').replace(/\s+/g, ' ').trim().slice(0, 400)).digest('hex');

/**
 * Pure given its callbacks. Drops excluded case ids, eval-workspace cwds, missing cwds, models other than
 * haiku/sonnet, transcripts that are gone, that edited files or that wrote files through Bash, then duplicate
 * prompts (the earliest survivor is kept).
 * transcriptEntries(key) returns the parsed transcript lines, or null when it is missing. Without it,
 * transcriptToolNames(key) returns only the tool_use names (no Bash write check is possible then).
 * excludedIds is a Set of case ids (sha10 of key) to skip.
 */
export function filterSnapshot(lines, { transcriptToolNames, transcriptEntries, exists, excludedIds = new Set() }) {
  const dropped = { excluded: 0, evalCwd: 0, missingCwd: 0, model: 0, noTranscript: 0, writeTools: 0, bashWrites: 0, dup: 0 };
  const kept = [];
  for (const e of [...lines].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))) {
    if (excludedIds.has(sha10(e.key))) { dropped.excluded++; continue; }
    if (e.cwd && EVAL_CWD.test(e.cwd)) { dropped.evalCwd++; continue; }
    if (!e.cwd || !exists(e.cwd)) { dropped.missingCwd++; continue; }
    if (e.toFamily !== 'haiku' && e.toFamily !== 'sonnet') { dropped.model++; continue; }
    const entries = transcriptEntries ? transcriptEntries(e.key) : null;
    // transcriptEntries returns null for a transcript that is gone; that entry counts as noTranscript.
    const tools = entries ? toolNamesFromEntries(entries) : (transcriptToolNames ? transcriptToolNames(e.key) : null);
    if (!tools) { dropped.noTranscript++; continue; }
    if (tools.some((t) => WRITE_TOOLS.has(t))) { dropped.writeTools++; continue; }
    if (entries && bashWriteCount(entries) > 0) { dropped.bashWrites++; continue; }
    kept.push(e);
  }
  const seen = new Set(); const out = [];
  for (const e of kept) { const h = promptHash(e.prompt); if (seen.has(h)) { dropped.dup++; continue; } seen.add(h); out.push(e); }
  return { kept: out, dropped };
}

/** Pure: up to n entries, each kind in proportion to its size (largest remainder), shuffled by seed. */
export function pickBalanced(entries, n, seed = 1) {
  const groups = new Map();
  for (const e of entries) { const k = kindOf(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const total = entries.length; const kinds = [...groups.keys()].sort();
  if (n >= total) return [...entries].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  const quota = new Map(kinds.map((k) => [k, Math.floor((n * groups.get(k).length) / total)]));
  let left = n - [...quota.values()].reduce((a, b) => a + b, 0);
  const byRemainder = [...kinds].sort((a, b) => {
    const ra = ((n * groups.get(a).length) / total) % 1, rb = ((n * groups.get(b).length) / total) % 1;
    return rb - ra || a.localeCompare(b);
  });
  for (const k of byRemainder) { if (left <= 0) break; if (quota.get(k) < groups.get(k).length) { quota.set(k, quota.get(k) + 1); left--; } }
  const rnd = mulberry32(seed); const out = [];
  for (const k of kinds) {
    const g = [...groups.get(k)].sort((a, b) => String(a.key).localeCompare(String(b.key)));
    for (let i = g.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [g[i], g[j]] = [g[j], g[i]]; }
    out.push(...g.slice(0, quota.get(k)));
  }
  return out.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Pure: the prompt with the repo root (and a deeper cwd first) replaced by {{REPO}}. */
export function templatePrompt(prompt, root, cwd = root) {
  let t = String(prompt);
  // A dot ends the path only when no name character follows it: "in /r/app." is the root, "/r/app.git" is not.
  const sub = (from, to) => { t = t.replace(new RegExp(`${escRe(from)}(?![\\w-]|\\.[\\w-])`, 'g'), to); };
  if (cwd && cwd !== root && cwd.startsWith(root + '/')) sub(cwd, `{{REPO}}/${relative(root, cwd)}`);
  sub(root, '{{REPO}}');
  return t;
}

/** Pure: the case entry for one picked snapshot line. No prompt text, no path but the repo. */
export function caseFor(e, { repo, commit }) {
  const id = sha10(e.key); const kind = kindOf(e);
  const haiku = e.toFamily === 'haiku';
  return {
    id, prompt: `cases/${id}.md`, rubric: `rubric/${id}.md`, repo, commit,
    conditions: haiku ? ['A', 'B'] : ['S', 'B'],
    agents: haiku ? { A: kind === 'run' ? 't2-runner' : 't2-explore' } : { S: 't1-worker' },
    meta: { kind, tier: tierOf(e), to: e.to ?? null, ledgerUsd: e.usd ?? null, ledgerCost: e.cost ?? null, ts: e.ts ?? null, bashWrites: 0 },
  };
}

export function roundFor(id, cases, date) {
  const count = new Map(); for (const c of cases) count.set(c.repo, (count.get(c.repo) || 0) + 1);
  const repo = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const latest = cases.filter((c) => c.repo === repo).sort((a, b) => (b.meta.ts ?? 0) - (a.meta.ts ?? 0))[0];
  return {
    id, date, kind: 'conditions', repo, commit: latest?.commit, repeats: 1, concurrency: 4,
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch'],
    conditions: [
      { key: 'A', id: 'haiku-low', model: 'claude-haiku-5-5', effort: 'low', agent: 't2-explore', prompt: 'original' },
      { key: 'S', id: 'sonnet-high', model: 'claude-sonnet-5-5', effort: 'high', prompt: 'original' },
      { key: 'B', id: 'opus-direct', model: 'claude-opus-5-5', effort: 'high', prompt: 'original', role: 'baseline' },
    ],
    grading: 'reference', capStopPct: 85, tier: 'numbers',
    cases,
  };
}

const git = (args) => { try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
function locate(e) {
  const root = git(['-C', e.cwd, 'rev-parse', '--show-toplevel']);
  if (!root) return null;
  const commit = git(['-C', root, 'rev-list', '-1', `--before=${new Date(e.ts).toISOString()}`, '--all']) || git(['-C', root, 'rev-parse', 'HEAD']);
  return commit ? { root, commit } : null;
}
function entriesOf(key) {
  if (!key || !existsSync(key)) return null;
  return readJsonl(key);
}
/** Case ids of every case in the given round directories (their snapshot entries are skipped). */
function excludedIdsOf(dirs) {
  const ids = new Set();
  for (const d of dirs) for (const c of readJson(join(d, 'round.json')).cases || []) ids.add(c.id);
  return ids;
}
const tally = (xs) => xs.reduce((m, k) => { m[k] = (m[k] || 0) + 1; return m; }, {});

export function select({ n = 100, id = null, seed = 1, dryRun = false, exclude = [], work = workDir(), log = console.log, today = new Date().toISOString().slice(0, 10) } = {}) {
  id ||= `r3-bulk-${today}`;
  const lines = readJsonl(join(work, 'ledger-snapshot.jsonl'));
  const { kept, dropped } = filterSnapshot(lines, { transcriptEntries: entriesOf, exists: existsSync, excludedIds: excludedIdsOf(exclude) });
  const picked = pickBalanced(kept, n, seed);
  const cases = []; const texts = new Map(); let notGit = 0;
  for (const e of picked) {
    const loc = locate(e);
    if (!loc) { notGit++; continue; }
    const c = caseFor(e, { repo: loc.root, commit: loc.commit });
    cases.push(c); texts.set(c.id, templatePrompt(e.prompt, loc.root, e.cwd));
  }
  const round = roundFor(id, cases, today);
  log(`snapshot ${lines.length} lines; dropped ${JSON.stringify(dropped)}; eligible ${kept.length}`);
  log(`eligible by kind ${JSON.stringify(tally(kept.map(kindOf)))}`);
  log(`picked ${picked.length} (not a git repo: ${notGit}) -> ${cases.length} cases`);
  log(`cases by kind ${JSON.stringify(tally(cases.map((c) => c.meta.kind)))}`);
  log(`cases by lane ${JSON.stringify(tally(cases.map((c) => c.conditions[0])))}, runs ${cases.length * 2}, repos ${new Set(cases.map((c) => c.repo)).size}`);
  const errs = cases.length ? validateRound(round) : ['no cases'];
  if (errs.length) throw new Error('round.json invalid:\n- ' + errs.join('\n- '));
  const dir = join(work, 'rounds', id);
  if (dryRun) { log(`dry run: would write ${dir}`); return { round, dir, written: false }; }
  if (existsSync(join(dir, 'round.json'))) throw new Error(`${dir}/round.json exists; pick another --id`);
  for (const d of ['cases', 'rubric']) mkdirSync(join(dir, d), { recursive: true });
  for (const c of cases) { writeFileSync(join(dir, c.prompt), texts.get(c.id)); writeFileSync(join(dir, c.rubric), REFERENCE_RUBRIC); }
  writeFileSync(join(dir, 'round.json'), JSON.stringify(round, null, 1) + '\n');
  log(`written: ${dir}`);
  return { round, dir, written: true };
}

export function main(argv = []) {
  const optAll = (k) => argv.flatMap((a, i) => (a === k && argv[i + 1] ? [argv[i + 1]] : []));
  const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  const n = Number(opt('--n') ?? 100), seed = Number(opt('--seed') ?? 1);
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(seed)) { console.error('usage: select.mjs --n <count> [--id <round-id>] [--seed <int>] [--exclude <round-dir>]... [--dry-run]'); return 2; }
  try { select({ n, seed, id: opt('--id'), exclude: optAll('--exclude').map((d) => resolve(d)), dryRun: argv.includes('--dry-run') }); return 0; } catch (e) { console.error(e.message); return 1; }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
