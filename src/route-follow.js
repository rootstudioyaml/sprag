/**
 * Follow-up after a delegation hint: one nudge when the model starts looking
 * things up itself instead of delegating.
 *
 * Why this exists: the prompt hint (src/route-inject.js) says "delegate this".
 * Measured over 14 days, 22 of 100 hinted turns delegated. 21 of the 23
 * delegating turns delegated before any direct lookup; the 38 turns that did
 * not delegate ran two or more direct lookups with no edit. Once the model has
 * made its second lookup it is committed to doing the work itself, and the hint
 * is two screens behind. So a PostToolUse hook counts the lookups of a hinted
 * turn and, at the second one, says so once.
 *
 * What counts: read-only lookups (Read, Grep, Glob, LS, a shell command that
 * changes nothing) as `c`, and MCP or web tools as `g`. What stops the count: a
 * delegation, an edit, or a shell command that mutates something. Those turns
 * are not "lookups instead of delegating" and the nudge would be noise.
 *
 * State is split over several small files per session instead of one JSON,
 * because the PostToolUse hooks of parallel tool calls run at the same time.
 * Each file has one writer role:
 *   <sid>.json    written once by the prompt hook (startFollow)
 *   <sid>.calls   one appended line per counted call (`c` or `g`); an append of
 *                 a single short line is atomic enough that no count is lost
 *   <sid>.stop    the counting for this turn is over
 *   <sid>.nudged  created with the `wx` flag, so of several processes that all
 *                 see "two lookups" exactly one wins and speaks
 * All of it lives under <dir>/route-follow/. Events go to a separate JSONL
 * (<dir>/route-follow-events.jsonl) so `route-scan rules` can show how often a
 * hint, and the nudge after it, ended in a delegation.
 *
 * The module never throws into a hook: followToolUse swallows everything.
 */

import {
  mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, existsSync, openSync, closeSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { loadConfig } from './config.js';
import { writeStateFile } from './state-file.js';
import { debug } from './debug.js';

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
/** A hinted turn still running this long after its prompt is left over from a session that ended. */
const TURN_TTL_MS = 60 * 60 * 1000;
/** Lookups on the turn at which the nudge goes out. */
const NUDGE_AT = 2;
const EVENTS_FILE = 'route-follow-events.jsonl';
const EVENTS_MAX_BYTES = 2 * 1024 * 1024;
const EVENTS_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const DELEGATE_TOOLS = new Set(['Task', 'Agent', 'spawn_agent']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch']);
const SHELL_TOOLS = new Set(['Bash', 'exec_command', 'shell_command', 'shell']);
const LOOKUP_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS']);
const GENERAL_TOOLS = new Set(['WebFetch', 'WebSearch']);

/**
 * A shell command that changes something: version control moves, installs,
 * file operations, cluster or infrastructure writes, and any redirect to a file
 * (`2>&1` and `> /dev/null` are not). Such a command means the turn is doing
 * work, not looking around.
 */
const MUTATING_BASH_RE = /\b(?:git\s+(?:commit|push|merge|rebase|reset|tag|checkout|switch|stash|cherry-pick|revert)|npm\s+(?:publish|version|install|i|uninstall)\b|rm\s|mv\s|cp\s|mkdir\s|touch\s|chmod\s|sed\s+-i|tee\s|kubectl\s+(?:apply|delete|edit|patch)|terraform\s+(?:apply|destroy))|(?:^|[^<>&0-9])>{1,2}\s*(?!&|\/dev\/null)\S/;

const baseDir = (dir) => dir || userDataDir();
const stateDir = (dir) => join(baseDir(dir), 'route-follow');
const eventsPath = (dir) => join(baseDir(dir), EVENTS_FILE);

function paths(sessionId, dir) {
  const d = stateDir(dir);
  return {
    d,
    json: join(d, `${sessionId}.json`),
    calls: join(d, `${sessionId}.calls`),
    stop: join(d, `${sessionId}.stop`),
    nudged: join(d, `${sessionId}.nudged`),
  };
}

const rmQuiet = (file) => {
  try { rmSync(file, { force: true }); } catch (e) { debug('route-follow:rm', e); }
};

function logEvent(dir, entry) {
  try {
    const file = eventsPath(dir);
    mkdirSync(baseDir(dir), { recursive: true });
    appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (e) { debug('route-follow:event', e); }
}

/** Keep the last 30 days once the log passes 2 MB; the log is only ever a measurement. */
function trimEvents(dir, now) {
  try {
    const file = eventsPath(dir);
    if (statSync(file).size <= EVENTS_MAX_BYTES) return;
    const kept = readFileSync(file, 'utf8').split('\n').filter((line) => {
      if (!line) return false;
      try { return now - JSON.parse(line).at <= EVENTS_KEEP_MS; } catch { return false; }
    });
    writeStateFile(file, kept.length ? kept.join('\n') + '\n' : '');
  } catch (e) { if (e?.code !== 'ENOENT') debug('route-follow:trim', e); }
}

/**
 * Record that this turn carried a delegation hint, and reset the counters left
 * by the turn before it.
 *
 * @param {string} sessionId
 * @param {{agent?: string, category: string, label: string, target: string, lang: string}} info
 * @param {{now?: number, dir?: string}} [opts] `dir` replaces the user data dir (tests)
 */
export function startFollow(sessionId, { agent = 'claude', category, label, target, lang } = {}, { now = Date.now(), dir } = {}) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return false;
  const p = paths(sessionId, dir);
  mkdirSync(p.d, { recursive: true });
  for (const f of [p.calls, p.stop, p.nudged]) rmQuiet(f);
  const turn = String(now);
  writeFileSync(p.json, JSON.stringify({ turn, ts: now, agent, category, label, target, lang }) + '\n');
  trimEvents(dir, now);
  logEvent(dir, { at: now, agent, sessionId, turn, category, event: 'hint' });
  return true;
}

/** Forget the session's hinted turn: the prompt that just arrived has no hint. */
export function clearFollow(sessionId, { dir } = {}) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return false;
  const p = paths(sessionId, dir);
  for (const f of [p.json, p.calls, p.stop, p.nudged]) rmQuiet(f);
  return true;
}

function commandOf(input) {
  if (typeof input === 'string') return input;
  const c = input?.command ?? input?.cmd;
  return Array.isArray(c) ? c.join(' ') : typeof c === 'string' ? c : '';
}

/** @returns {'delegated'|'edited'|'mutated'|'c'|'g'|null} what the call means for the turn */
function classify(toolName, input) {
  const tool = String(toolName || '').replace(/^(?:functions|tools)\./, '');
  if (DELEGATE_TOOLS.has(tool)) return 'delegated';
  if (EDIT_TOOLS.has(tool)) return 'edited';
  if (SHELL_TOOLS.has(tool)) return MUTATING_BASH_RE.test(commandOf(input)) ? 'mutated' : 'c';
  if (LOOKUP_TOOLS.has(tool)) return 'c';
  if (tool.startsWith('mcp__') || GENERAL_TOOLS.has(tool)) return 'g';
  return null;
}

function nudgeText(info, n, mcp) {
  const { label, target } = info;
  if (info.agent === 'codex') {
    return `[Sprag model routing] This turn matched the approved routing hint for ${label}, but you have run ${n} lookups yourself instead of spawning. `
      + `Hand the remaining lookups to ${target}, and summarize what you have already found in the task message. `
      + 'If there is a reason to continue on the main agent (a design judgement, an edit, one or two lookups left), state it in one line and continue. '
      + 'This notice is sent once per turn.';
  }
  if (info.lang === 'ko') {
    return `[sprag] 이 턴은 위임 룰 "${label}" 에 해당하는데, 위임하지 않고 직접 조회를 ${n}회 했습니다. `
      + (mcp
        ? 'MCP·웹 도구가 필요한 조회이므로 남은 조회는 general-purpose(model: haiku) 에 넘기고, 지금까지 확인한 내용은 위임 프롬프트에 요약해 넣으십시오. '
        : `남은 조회는 ${target} 에 넘기고, 지금까지 확인한 내용은 위임 프롬프트에 요약해 넣으십시오. `)
      + '직접 처리해야 할 이유(설계 판단이 필요함, 수정이 필요함, 한두 번 더 조회하면 끝남)가 있으면 그 이유를 답변에 한 줄로 밝히고 계속하십시오. '
      + '이 안내는 이번 턴에 한 번만 나갑니다.';
  }
  return `[sprag] This turn matches the delegation rule "${label}", but you have run ${n} lookups yourself instead of delegating. `
    + (mcp
      ? 'These lookups need MCP or web tools, so hand the remaining ones to general-purpose (model: haiku) and summarize what you have already found in the delegation prompt. '
      : `Hand the remaining lookups to ${target} and summarize what you have already found in the delegation prompt. `)
    + 'If there is a reason to continue directly (a design judgement, an edit, one or two lookups left), state it in one line in your reply and continue. '
    + 'This notice is sent once per turn.';
}

/**
 * PostToolUse entry: count the call and, on the second direct lookup of a
 * hinted turn, return the nudge.
 *
 * @param {object} payload hook payload (`session_id`, `tool_name`, `tool_input`)
 * @returns {string|null} the notice to add as context, or null
 */
export function followToolUse(payload, { now = Date.now(), cfg = loadConfig(), dir } = {}) {
  try {
    if (cfg?.routeFollowUp === false) return null;
    // A subagent's own tool calls reach this hook under the parent's session id,
    // and PostToolUse for the Task call itself only fires once the subagent has
    // finished. Counting the child's lookups would nudge the child. Claude Code
    // marks those payloads with `agent_id`; a payload without the field is
    // treated as the main agent's.
    if (payload?.agent_id) return null;
    const sessionId = payload?.session_id;
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return null;
    const p = paths(sessionId, dir);
    let info;
    try { info = JSON.parse(readFileSync(p.json, 'utf8')); } catch (e) { if (e?.code !== 'ENOENT') debug('route-follow:read', e); return null; }
    if (!info || !Number.isFinite(info.ts) || now - info.ts > TURN_TTL_MS) return null;
    if (existsSync(p.stop)) return null;

    const kind = classify(payload.tool_name, payload.tool_input);
    if (kind === null) return null;
    // PreToolUse is registered for Task/Agent only, to stop the count before the
    // subagent's own lookups can reach this hook (see installRouteFollowHook).
    // Any other tool seen on PreToolUse is counted on its PostToolUse instead.
    if (payload.hook_event_name === 'PreToolUse' && kind !== 'delegated') return null;
    const event = { at: now, agent: info.agent, sessionId, turn: info.turn, category: info.category };
    if (kind === 'delegated' || kind === 'edited' || kind === 'mutated') {
      writeFileSync(p.stop, '');
      logEvent(dir, kind === 'delegated'
        ? { ...event, event: 'delegated', nudged: existsSync(p.nudged) }
        : { ...event, event: kind });
      return null;
    }

    appendFileSync(p.calls, `${kind}\n`);
    const lines = readFileSync(p.calls, 'utf8').split('\n').filter(Boolean);
    if (lines.length < NUDGE_AT) return null;
    // Parallel hooks can all see the count here; only the process that creates
    // the marker speaks.
    try { closeSync(openSync(p.nudged, 'wx')); } catch (e) {
      if (e?.code !== 'EEXIST') debug('route-follow:nudged', e);
      return null;
    }
    logEvent(dir, { ...event, event: 'nudged' });
    return nudgeText(info, lines.length, lines.includes('g'));
  } catch (e) {
    debug('route-follow:tool', e);
    return null;
  }
}

/**
 * How hinted turns ended, per category, over the last `days`.
 *
 * @returns {Map<string, {hints: number, delegatedAtOnce: number, nudged: number, delegatedAfterNudge: number}>}
 */
export function followStats({ days = 14, now = Date.now(), agent = 'claude', dir } = {}) {
  const turns = new Map();
  let raw = '';
  try { raw = readFileSync(eventsPath(dir), 'utf8'); } catch { return new Map(); }
  const since = now - days * DAY_MS;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || e.agent !== agent || !Number.isFinite(e.at) || e.at < since) continue;
    const key = `${e.sessionId}\u0000${e.turn}`;
    let t = turns.get(key);
    if (!t) { t = { category: null, hint: false, nudged: false, delegated: null }; turns.set(key, t); }
    if (e.event === 'hint') { t.hint = true; t.category = e.category; }
    else if (e.event === 'nudged') t.nudged = true;
    else if (e.event === 'delegated' && t.delegated === null) t.delegated = e.nudged ? 'after' : 'once';
  }
  const out = new Map();
  for (const t of turns.values()) {
    // A turn counts only when its hint is in the window; later events of a
    // turn whose hint was cut off cannot be attributed to a category.
    if (!t.hint || !t.category) continue;
    const s = out.get(t.category) || { hints: 0, delegatedAtOnce: 0, nudged: 0, delegatedAfterNudge: 0 };
    s.hints += 1;
    if (t.nudged) s.nudged += 1;
    if (t.delegated === 'once') s.delegatedAtOnce += 1;
    else if (t.delegated === 'after') s.delegatedAfterNudge += 1;
    out.set(t.category, s);
  }
  return out;
}
