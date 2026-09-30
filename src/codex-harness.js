import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { codexUserDir } from './agent.js';
import { codexToolEvents, codexLegacyToolEvent, readCodexTailLines, forkedCopyFilter } from './codex-parser.js';

export const CODEX_BEGIN = '<!-- sprag:codex:harness:begin -->';
export const CODEX_END = '<!-- sprag:codex:harness:end -->';
const sections = [
  ['Ratchet', 'When a mistake recurs, propose a concise condition/action rule. Ask the user for global or project scope before registering it with `sprag harness promote --agent codex --global|--project "rule"`.'],
  ['Evidence', 'Support completion claims with actual test results, command output, a file diff, or a screenshot. State any verification you could not run.'],
  ['Plan, Execute, Verify', 'For multi-step work, plan the steps, execute them, and verify the result before reporting completion.'],
  ['Structured Task', 'Establish the goal, constraints, verification method, and completion criteria before substantial work.'],
  ['Default Safe Path', 'Ask before destructive or external actions unless already authorized. Proceed with reads, local edits, and tests within the granted permissions.'],
];

export function codexHarnessPaths(root, scope = 'project') {
  const dir = scope === 'global' ? codexUserDir() : root;
  // Codex reads the override instead of AGENTS.md when it is non-empty.
  const override = join(dir, 'AGENTS.override.md');
  const file = existsSync(override) && readFileSync(override, 'utf8').trim() ? override : join(dir, 'AGENTS.md');
  return { file, ratchet: scope === 'global' ? join(dir, 'ratchet.md') : join(dir, '.codex', 'ratchet.md') };
}

export function codexHarnessBlock() {
  return `${CODEX_BEGIN}\n## Sprag Harness\n\n${sections.map(([name, text], i) => `### ${i + 1}. ${name}\n${text}`).join('\n\n')}\n\nRead the global and project Codex ratchet files before working when present. Run \`sprag harness list --agent codex --global\` and \`sprag harness list --agent codex --project\` to retrieve them. These are instructions, not Claude-style @ imports.\nUse \`sprag doc2md <file> --agent codex\` before reading PDF, Office, or Figma documents. Delegate only through available Codex tools and configured roles; do not assume Claude model names or Task/Agent arguments. A [Sprag model routing] note on a request means the user has asked for that request to be delegated: spawn the sub-agent it describes (its model, reasoning_effort, fork_turns "none", and a self-contained message ending with the route line it gives), wait for it to finish instead of doing the same task yourself, then verify the result before replying.\n${CODEX_END}\n`;
}

function range(content) {
  const begin = content.indexOf(CODEX_BEGIN);
  const end = content.indexOf(CODEX_END);
  if ((begin < 0) !== (end < 0) || (begin >= 0 && end < begin) || content.indexOf(CODEX_BEGIN, begin + CODEX_BEGIN.length) >= 0) {
    throw new Error('Malformed Sprag Codex harness markers; repair them before updating this file.');
  }
  return begin < 0 ? null : [begin, end + CODEX_END.length];
}

export function initCodexHarness({ root, scope = 'project' }) {
  const paths = codexHarnessPaths(root, scope);
  const existing = existsSync(paths.file) ? readFileSync(paths.file, 'utf8') : '';
  const span = range(existing);
  const block = codexHarnessBlock();
  const next = span ? existing.slice(0, span[0]) + block.trimEnd() + existing.slice(span[1])
    : existing + (existing ? '\n\n' : '') + block;
  mkdirSync(dirname(paths.file), { recursive: true });
  if (next !== existing) {
    if (existing) writeFileSync(`${paths.file}.bak-${Date.now()}`, existing);
    writeFileSync(paths.file, next);
  }
  if (!existsSync(paths.ratchet)) {
    mkdirSync(dirname(paths.ratchet), { recursive: true });
    writeFileSync(paths.ratchet, '# Codex Ratchet Rules\n\n## Rules\n\n');
  }
  return paths;
}

export function uninitCodexHarness({ root, scope = 'project' }) {
  const { file } = codexHarnessPaths(root, scope);
  if (!existsSync(file)) return { file, removed: false };
  const existing = readFileSync(file, 'utf8');
  const span = range(existing);
  if (!span) return { file, removed: false };
  writeFileSync(`${file}.bak-${Date.now()}`, existing);
  writeFileSync(file, existing.slice(0, span[0]) + existing.slice(span[1]));
  return { file, removed: true };
}

export function codexHarnessStatus({ root, scope = 'project' }) {
  const { file } = codexHarnessPaths(root, scope);
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const span = range(text);
  const block = span ? text.slice(...span) : '';
  const missing = sections.filter(([name], i) => !block.includes(`### ${i + 1}. ${name}`)).map(([name]) => name);
  return { file, configured: sections.length - missing.length, total: sections.length, missing };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LOOKUP = new Set(['read', 'search', 'list_files']);

/** The script a `zsh -lc` argv runs, or the argv itself. */
function commandLine(argv) {
  const i = argv.findIndex((a) => a === '-lc' || a === '-c');
  return (i >= 0 ? argv[i + 1] : argv.join(' ')) || '';
}

/** Shell words of a script's first command, honoring simple quotes. */
function firstWords(script, n) {
  const words = [];
  for (const m of String(script).matchAll(/'([^']*)'|"([^"]*)"|([^\s'"|;&]+)|([|;&])/g)) {
    if (m[4]) break;
    words.push(m[1] ?? m[2] ?? m[3]);
    if (words.length === n) break;
  }
  return words;
}

// Tools whose exit 1 is an answer, not an error: grep-style "no match" and
// diff/cmp-style "the inputs differ". Only exit 1 is exempt; 2+ still counts.
const ANSWER_EXIT_1 = /^(?:diff|cmp|grep|egrep|fgrep|rg|ag|test|\[|comm)$|^git (?:diff|grep)$/;

/**
 * A failure's identity across retries: the command's first two words plus the
 * start of its output, with run-specific noise (paths, ids, positions) removed
 * so the same failure in another temp dir still matches. Other numbers stay,
 * since exit codes and counts carry meaning.
 */
export function codexErrorSignature(ev, { cwd, home = homedir() } = {}) {
  let text = String(ev.output || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  if (cwd) text = text.replace(new RegExp(escapeRe(cwd), 'g'), '.');
  if (home) text = text.replace(new RegExp(escapeRe(home), 'g'), '~');
  text = text.replace(/(?:\/private)?\/(?:tmp|var\/folders)\/[^\s:'"]+/g, '<tmp>')
    .replace(/\b[0-9a-f]{8,}(?:-[0-9a-f]{4,}){0,4}\b/gi, '<id>')
    .replace(/:\d+:\d+/g, ':N:N')
    .replace(/\s+/g, ' ').trim().slice(0, 80);
  const head = ev.kind === 'patch' ? 'apply_patch'
    : firstWords(commandLine(ev.argv || []), 2).map((w) => w.split('/').pop()).join(' ');
  return `${head}: ${text}`;
}

/** Whether a failure is worth remembering, rather than a probe or Sprag's own feedback. */
function countable(ev) {
  if (!ev.failed) return false;
  // Sprag's write lint rewrites the tool output; that is feedback, not a mistake to learn from.
  if (/^\[(?:korean-style|claude-token-saver|sprag)/.test(String(ev.output || '').trim())) return false;
  if (ev.kind === 'patch') return true;
  // `rg` finding nothing and `ls` on an absent path are how exploration works.
  const types = (ev.parsed || []).map((c) => c?.type);
  if (types.length && types.every((t) => LOOKUP.has(t))) return false;
  if (ev.exit === 1) {
    const words = firstWords(commandLine(ev.argv || []), 2).map((w) => w.split('/').pop());
    if (ANSWER_EXIT_1.test(words[0]) || ANSWER_EXIT_1.test(words.join(' '))) return false;
  }
  return true;
}

/**
 * Repeated failures in a rollout's recent turns, newest-first by count. Reads
 * only the file tail, which is where the current session's recent work is.
 */
export function codexRatchetCandidates(filePath, { now = Date.now(), turns: window = 30, ttlMs = 30 * 60000, tailBytes = 2 * 1024 * 1024, home } = {}) {
  const lines = readCodexTailLines(filePath, tailBytes);
  if (!lines) return [];
  const order = [];
  const seen = new Set();
  const failures = [];
  const calls = new Map();
  const outputs = [];
  let cwd = null;
  let current = null;
  const copied = forkedCopyFilter();
  for (const line of lines) {
    // Cheap prefilter: these candidate lines are a small share of a rollout.
    if (!/"(?:item_completed|exec_command_end|patch_apply_end|task_started|turn_context|session_meta|thread_settings_applied|function_call|function_call_output|custom_tool_call|custom_tool_call_output)"/.test(line)) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    // A forked child's copy of the parent history holds the parent's failures, not its own.
    if (copied(e)) continue;
    const p = e?.payload;
    if (e?.type === 'session_meta' && typeof p?.cwd === 'string') cwd ??= p.cwd;
    if (e?.type === 'turn_context' && typeof p?.cwd === 'string') cwd = p.cwd;
    if (e?.type === 'event_msg' && p?.type === 'task_started') current = p.turn_id || current;
    for (const ev of codexToolEvents(e)) {
      if (ev.kind === 'call') { if (ev.callId) calls.set(ev.callId, ev); continue; }
      if (ev.kind === 'output') {
        if (ev.exit !== null && ev.callId) outputs.push({ ...ev, turn: current, cwd });
        continue;
      }
      if (ev.kind !== 'command' && ev.kind !== 'patch') continue;
      if (ev.callId) { if (seen.has(ev.callId)) continue; seen.add(ev.callId); }
      const turn = ev.turnId || current;
      if (turn && !order.includes(turn)) order.push(turn);
      if (countable(ev)) failures.push({ ...ev, turn, cwd: ev.cwd || cwd });
    }
  }
  for (const out of outputs) {
    if (seen.has(out.callId)) continue;
    const ev = codexLegacyToolEvent(calls.get(out.callId), out);
    if (!ev) continue;
    seen.add(out.callId);
    if (ev.turn && !order.includes(ev.turn)) order.push(ev.turn);
    if (countable(ev)) failures.push(ev);
  }
  const recent = new Set(order.slice(-window));
  const groups = new Map();
  for (const ev of failures) {
    if (!recent.has(ev.turn) || !Number.isFinite(ev.at) || now - ev.at > ttlMs) continue;
    const pattern = codexErrorSignature(ev, { cwd: ev.cwd, home });
    const g = groups.get(pattern) || { pattern, count: 0, lastAt: 0 };
    g.count++;
    g.lastAt = Math.max(g.lastAt, ev.at);
    groups.set(pattern, g);
  }
  return [...groups.values()].filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, 5)
    .map((g, i) => ({ id: i + 1, ...g }));
}

/** The ratchet text a candidate promotes to; the user replaces the TODO. */
export function codexCandidateRule(cand, lang) {
  return lang === 'ko'
    ? `반복 감지 ×${cand.count}: ${cand.pattern} · TODO: 원인과 예방책을 한 줄로 적습니다`
    : `Repeated failure x${cand.count}: ${cand.pattern} · TODO: write the cause and prevention in one line`;
}
