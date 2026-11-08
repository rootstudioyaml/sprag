// Did the main session fill in what a delegated report missed, or pass the gap on to the user?
// Usage: node scripts/evals/turns.mjs --limit 30 [--yes] [--out <dir>]
//
// For every replayed case that has a reference report (the Opus direct run), this finds the original sub-agent's
// final report (P) and the answer the main session gave the user afterwards (F), then asks one Opus grader to
// compare both with the reference. Without --yes nothing is graded: the matches and an estimate are printed.
// Graders run `claude -p` with no tools on the Max subscription (ANTHROPIC_API_KEY is removed from their env).
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  workDir, sha10, readJson, readJsonl, readReport, scrub, maskSecrets, extractJsonObject, runClaude, isMain, ratesFor,
} from './lib.mjs';
import { gradeArgs, GRADER_MODEL, MAX_GRADERS } from './grade.mjs';

export const ROUNDS = ['r3-bulk-2026-11-08', 'r4-bulk-2026-11-08', 'r9-v3-2026-11-09'];
export const OUT_DIR = 'turns-2026-11-09';
export const FINAL_CAP = 6000;

// ---- paths ----
/** `<projects>/<slug>/<sessionId>/subagents/agent-<id>.jsonl` -> `<projects>/<slug>/<sessionId>.jsonl`, else null. */
export function parentPathOf(key) {
  const m = String(key).match(/^(.*)\/([^/]+)\/subagents\/agent-[^/]+\.jsonl$/);
  return m ? `${m[1]}/${m[2]}.jsonl` : null;
}
export const agentIdOf = (key) => String(key).match(/\/agent-([^/]+)\.jsonl$/)?.[1] ?? null;

// ---- transcripts ----
const blocks = (o) => (Array.isArray(o?.message?.content) ? o.message.content : []);
const textOf = (o) => blocks(o).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
/** Last assistant text of a sub-agent transcript: its final report. */
export function lastAssistantText(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const o = entries[i];
    if (o.type !== 'assistant') continue;
    const t = textOf(o).trim();
    if (t) return t;
  }
  return '';
}
const SYSTEM_TEXT = /^\s*<(system-reminder|task-notification|local-command|command-name|command-message|agent-message)|^\s*\[(SYSTEM NOTIFICATION|Subagent hand-back)/;
/** True for a message the user typed: not a tool result, not an injected notification. */
export function isRealUser(o) {
  if (o?.type === 'user') {
    if (o.isMeta || o.isSidechain) return false;
    const c = o.message?.content;
    if (typeof c === 'string') return c.trim() !== '' && !SYSTEM_TEXT.test(c);
    if (!Array.isArray(c)) return false;
    const texts = c.filter((b) => b.type === 'text' && b.text?.trim());
    return texts.length > 0 && !c.some((b) => b.type === 'tool_result') && texts.some((b) => !SYSTEM_TEXT.test(b.text));
  }
  if (o?.type === 'attachment' && o.attachment?.type === 'queued_command' && o.attachment.commandMode === 'prompt') {
    const p = o.attachment.prompt;
    return typeof p === 'string' && p.trim() !== '' && !SYSTEM_TEXT.test(p) && (!o.attachment.origin?.kind || o.attachment.origin.kind === 'human');
  }
  return false;
}
const dumps = (o) => JSON.stringify(o);
/**
 * Index of the entry after which the main session knew the sub-agent's result.
 * Prefers the hand-back message, then the task notification, then the first entry that names the agent (a synchronous
 * call's tool_result). Without an agent id match, falls back to the Agent/Task tool_use closest in time to `startMs`
 * (at most `toleranceMs` away). Returns { index, how } or null.
 */
export function findAnchor(entries, agentId, { startMs = null, toleranceMs = 120e3 } = {}) {
  const hit = (pred) => entries.findIndex((o) => (o.type === 'user' || o.type === 'attachment') && pred(dumps(o)));
  if (agentId) {
    let i = hit((s) => s.includes(agentId) && s.includes('Subagent hand-back')); if (i >= 0) return { index: i, how: 'hand-back' };
    i = hit((s) => s.includes(agentId) && s.includes('task-notification')); if (i >= 0) return { index: i, how: 'notification' };
    i = hit((s) => s.includes(agentId)); if (i >= 0) return { index: i, how: 'result' };
  }
  if (startMs == null) return null;
  let best = null;
  entries.forEach((o, idx) => {
    if (o.type !== 'assistant' || o.isSidechain) return;
    for (const b of blocks(o)) {
      if (b.type !== 'tool_use' || !['Agent', 'Task'].includes(b.name)) continue;
      const d = Math.abs(Date.parse(o.timestamp) - startMs);
      if (d <= toleranceMs && (!best || d < best.d)) best = { d, id: b.id, idx };
    }
  });
  if (!best) return null;
  const byId = (pred) => entries.findIndex((o, k) => k > best.idx && (o.type === 'user' || o.type === 'attachment') && pred(dumps(o)));
  let i = byId((s) => s.includes(best.id) && s.includes('task-notification')); if (i >= 0) return { index: i, how: 'time+notification' };
  i = byId((s) => s.includes(best.id)); if (i >= 0) return { index: i, how: 'time+result' };
  return null;
}
/** Main-session assistant text after `index` up to the next real user message, joined. */
export function extractFinalAnswer(entries, index) {
  const parts = [];
  for (let i = index + 1; i < entries.length; i++) {
    const o = entries[i];
    if (isRealUser(o)) break;
    if (o.type !== 'assistant' || o.isSidechain) continue;
    const t = textOf(o).trim();
    if (t) parts.push(t);
  }
  return parts.join('\n\n');
}
/** Keeps the start and the end of a long answer; the middle is replaced by a marker. */
export function capFinal(text, cap = FINAL_CAP) {
  const cps = [...text];
  if (cps.length <= cap) return text;
  const head = Math.floor(cap * 0.6), tail = cap - head;
  return `${cps.slice(0, head).join('').trimEnd()}\n\n[... ${cps.length - cap} characters omitted ...]\n\n${cps.slice(-tail).join('').trimStart()}`;
}

// ---- grading ----
export const GRADES = { report: ['ok', 'partial', 'fail'], final: ['fixed', 'passed', 'not_applicable'] };
export function buildTurnPrompt({ task, reference, delegated, final }) {
  return [
    'A main assistant delegated a task to a sub-agent. The sub-agent returned a report (P). The main assistant then answered the user (F). A reference report (an expert doing the same task directly) shows the key facts. Judge whether P missed key facts and, if so, whether F carried the gap on or filled it.',
    '# Task given to the sub-agent', task.trim(),
    '# 기준 보고서 (reference)', reference.trim(),
    '# Report P (sub-agent final report)', delegated.trim(),
    '# Answer F (what the main assistant wrote to the user after receiving P)', final.trim() || '(empty)',
    `# Rules
- "report": "ok" if P reaches the same conclusion as the reference and has the key facts behind it; "partial" if the direction is right but a key fact is missing or wrong; "fail" if the conclusion differs or the task was not finished.
- "missing": the key facts of the reference that P lacks, one short string each. Empty array when there are none. A fact found by an investigation the task forbade or did not ask for is NOT missing.
- "final": only when "missing" is not empty. "fixed" if F contains or corrects those facts; "passed" if F leaves them out or states them wrongly, passing P's gap on; "not_applicable" if F does not address the topic so it cannot be judged. When "missing" is empty use "not_applicable".
- F may be long routine work chatter. Judge only what F tells the user about the delegated topic.`,
    `# Output
Answer with ONLY one JSON object: no code fence, no prose before or after.
{"report": "ok" | "partial" | "fail", "missing": ["..."], "final": "fixed" | "passed" | "not_applicable", "note": "<one sentence>"}`,
  ].join('\n\n') + '\n';
}
/** Parses one grader reply into { grade } or { errors }. */
export function parseTurnGrade(stdout) {
  let text = String(stdout), apiError = null;
  try { const j = JSON.parse(stdout); text = typeof j.result === 'string' ? j.result : text; if (j.is_error) apiError = text; } catch { /* raw text */ }
  if (apiError) return { errors: [`claude reported an error: ${apiError.slice(0, 200)}`] };
  const o = extractJsonObject(text);
  if (!o) return { errors: ['no JSON object in the reply'] };
  const errors = [];
  if (!GRADES.report.includes(o.report)) errors.push('report invalid');
  if (!Array.isArray(o.missing) || !o.missing.every((x) => typeof x === 'string')) errors.push('missing invalid');
  if (!GRADES.final.includes(o.final)) errors.push('final invalid');
  if (typeof o.note !== 'string') errors.push('note invalid');
  if (errors.length) return { errors };
  const final = o.missing.length ? o.final : 'not_applicable';
  return { grade: { report: o.report, missing: o.missing, final, note: o.note } };
}
/** Pure: counts for summary.json from graded results ({ meta.kind, grade }). */
export function summarize(results) {
  const report = { ok: 0, partial: 0, fail: 0 };
  const final = { fixed: 0, passed: 0, not_applicable: 0 };
  let withMissing = 0;
  for (const r of results) {
    if (!r.grade) continue;
    report[r.grade.report]++;
    if (r.grade.missing.length) { withMissing++; final[r.grade.final]++; }
  }
  return { graded: results.filter((r) => r.grade).length, report, withMissing, finalOfMissing: final };
}
/** Round-robin over kinds (sorted), within a kind by case id; stable and mixed. */
export function pickMixed(cands, limit) {
  const groups = new Map();
  for (const c of [...cands].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!groups.has(c.kind)) groups.set(c.kind, []);
    groups.get(c.kind).push(c);
  }
  const kinds = [...groups.keys()].sort(); const out = [];
  for (let i = 0; out.length < limit; i++) {
    let any = false;
    for (const k of kinds) { const c = groups.get(k)[i]; if (c) { any = true; if (out.length < limit) out.push(c); } }
    if (!any) break;
  }
  return out;
}

// ---- gathering ----
/** One entry per case id that has a baseline (-B) report in one of the rounds and a ledger line. */
export function gatherCandidates(work, { rounds = ROUNDS } = {}) {
  const ledger = new Map();
  for (const l of readFileSync(join(work, 'ledger-snapshot.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    try { const d = JSON.parse(l); ledger.set(sha10(d.key), d); } catch { /* skip */ }
  }
  const out = new Map();
  for (const r of rounds) {
    const dir = join(work, 'rounds', r);
    const round = readJson(join(dir, 'round.json'));
    if (!round) continue;
    for (const c of round.cases) {
      if (out.has(c.id) || !ledger.has(c.id)) continue;
      const ref = join(dir, 'reports', `${c.id}-B.md`);
      const prompt = join(dir, c.prompt);
      if (!existsSync(ref) || !existsSync(prompt)) continue;
      out.set(c.id, { id: c.id, round: r, kind: c.meta?.kind ?? 'other', ledger: ledger.get(c.id), refPath: ref, promptPath: prompt });
    }
  }
  return [...out.values()];
}
/** Loads everything for one candidate. Returns { ...candidate, ok, why? , task, reference, delegated, final, how }. */
export function matchCandidate(c) {
  const key = c.ledger.key;
  const parent = parentPathOf(key);
  if (!parent) return { ...c, ok: false, why: 'key is not a subagents path' };
  if (!existsSync(parent)) return { ...c, ok: false, why: 'parent transcript missing' };
  const sub = existsSync(key) ? readJsonl(key) : null;
  const delegated = (sub ? lastAssistantText(sub) : '') || c.ledger.answer || '';
  if (!delegated.trim()) return { ...c, ok: false, why: 'no delegated report' };
  const parentEntries = readJsonl(parent);
  const startMs = sub ? Date.parse(sub.find((o) => o.timestamp)?.timestamp) : c.ledger.ts - 0;
  const anchor = findAnchor(parentEntries, agentIdOf(key) ?? c.ledger.agentId, { startMs: Number.isFinite(startMs) ? startMs : null });
  if (!anchor) return { ...c, ok: false, why: 'no matching Agent call in the parent' };
  const final = extractFinalAnswer(parentEntries, anchor.index);
  if (!final.trim()) return { ...c, ok: false, why: 'main wrote no text after the result', how: anchor.how };
  const clean = (t) => scrub(maskSecrets(t)).trim();
  return {
    ...c, ok: true, how: anchor.how, finalChars: [...final].length,
    task: clean(readFileSync(c.promptPath, 'utf8').replaceAll('{{REPO}}', '<repo>')),
    reference: readReport(c.refPath), delegated: clean(delegated), final: clean(capFinal(final)),
  };
}

export function estimate(prompts, date = '2026-11-09') {
  const rates = ratesFor(GRADER_MODEL, date);
  let inTok = 0, outTok = 0;
  for (const p of prompts) { inTok += Math.ceil(p.length / 3) + 3000; outTok += 8000; }
  return { inTok, outTok, usd: (inTok * rates.input + outTok * rates.output) / 1e6 };
}

export async function run({ limit = 30, yes = false, out = null, work = workDir(), spawn = nodeSpawn, log = console.log, timeoutMs = 20 * 60e3, cwd = join(tmpdir(), 'sprag-evals-grader') } = {}) {
  const outDir = out ?? join(work, OUT_DIR);
  const cands = gatherCandidates(work);
  const matched = []; const failed = [];
  for (const c of cands) { const m = matchCandidate(c); (m.ok ? matched : failed).push(m); }
  const picked = pickMixed(matched, limit);
  const tally = (xs, f) => xs.reduce((a, x) => { const k = f(x); a[k] = (a[k] || 0) + 1; return a; }, {});
  log(`candidates with a reference report: ${cands.length}; matched ${matched.length}; not matched ${failed.length} ${JSON.stringify(tally(failed, (f) => f.why))}`);
  log(`matched by how: ${JSON.stringify(tally(matched, (m) => m.how))}; picked ${picked.length} by kind ${JSON.stringify(tally(picked, (m) => m.kind))}`);
  const prompts = picked.map((m) => buildTurnPrompt(m));
  const est = estimate(prompts);
  log(`estimated: ~${(est.inTok / 1e3).toFixed(0)}k input + ~${(est.outTok / 1e3).toFixed(0)}k output tokens on ${GRADER_MODEL} (API-equivalent ~$${est.usd.toFixed(2)}, not charged on the Max subscription)`);
  log('billing: uses the Max subscription; ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are removed from the child env');
  log(`command per case: (cd ${cwd} && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude ${gradeArgs().map((a) => (a === '' ? '""' : a)).join(' ')} < prompt)`);
  if (!yes) { log('stopped before grading: pass --yes to start'); return { picked: picked.length, failed: [] }; }

  mkdirSync(outDir, { recursive: true }); mkdirSync(cwd, { recursive: true });
  const results = []; const errors = [];
  const queue = picked.map((m, i) => ({ m, prompt: prompts[i] }));
  const worker = async () => {
    for (let q; (q = queue.shift()); ) {
      const { m, prompt } = q;
      writeFileSync(join(outDir, `${m.id}.in.md`), prompt);
      const r = await runClaude({ spawn, args: gradeArgs(), prompt, cwd, timeoutMs });
      writeFileSync(join(outDir, `${m.id}.out.json`), r.out);
      const parsed = r.code === 0 ? parseTurnGrade(r.out) : { errors: [`claude exited ${r.code}: ${r.err.slice(0, 200)}`] };
      const rec = { caseId: m.id, kind: m.kind, round: m.round, how: m.how, finalChars: m.finalChars, ...(parsed.grade ? { grade: parsed.grade } : { errors: parsed.errors }) };
      writeFileSync(join(outDir, `${m.id}.json`), JSON.stringify(rec, null, 1));
      if (parsed.errors) { errors.push({ caseId: m.id, errors: parsed.errors }); log(`failed ${m.id}: ${parsed.errors.join('; ')}`); continue; }
      results.push(rec); log(`graded ${m.id} (${m.kind}): ${parsed.grade.report}, missing ${parsed.grade.missing.length}, final ${parsed.grade.final}`);
    }
  };
  await Promise.all(Array.from({ length: MAX_GRADERS }, worker));
  const summary = {
    candidates: cands.length, matched: matched.length, notMatched: failed.length,
    notMatchedWhy: tally(failed, (f) => f.why), picked: picked.length, pickedByKind: tally(picked, (m) => m.kind),
    ...summarize(results), gradeErrors: errors,
    passed: results.filter((r) => r.grade.missing.length && r.grade.final === 'passed').map((r) => ({ caseId: r.caseId, kind: r.kind, missing: r.grade.missing, note: r.grade.note })),
  };
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));
  log(`summary: ${JSON.stringify({ report: summary.report, withMissing: summary.withMissing, finalOfMissing: summary.finalOfMissing })}`);
  return { picked: picked.length, failed: errors };
}

export async function main(argv = []) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const limit = opt('--limit') ? Number(opt('--limit')) : 30;
  if (!Number.isInteger(limit) || limit < 1) { console.error('usage: turns.mjs --limit <n> [--yes] [--out <dir>]'); return 2; }
  try {
    const { failed } = await run({ limit, yes: argv.includes('--yes'), out: opt('--out') });
    return failed.length ? 1 : 0;
  } catch (e) { console.error(e.message); return 1; }
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
