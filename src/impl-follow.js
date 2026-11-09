/**
 * Reminders about the implementation split: one at prompt time (the main one)
 * and one after two directly edited files.
 *
 * Why this exists: the implementation split clause of the model rules (the main
 * model settles the design, a Sonnet worker writes the code) is static text, and
 * the model often misses it. evals/impl-delegation-rate.mjs on one machine since
 * 10-10: 87 turns delegated the implementation, 43 edited three or more code
 * files directly (issue #17 was an 8-file, 380-line one). The prompt hook cannot
 * give a delegation hint for an implementation request (the EDIT_RE gate in
 * src/route-inject.js is intentional and stays).
 *
 * Why two moments: the edit-count reminder at the third file came too late.
 * Median share of a direct turn's edit text still to come: 85% after the 1st
 * code file, 52% after the 2nd, 18% after the 3rd. So the main device is implementationReminder, which speaks on the
 * prompt itself (looksLikeImplementation in src/route-inject.js), and the
 * PostToolUse count was moved from three files to two.
 *
 * What counts at PostToolUse: Edit, Write, MultiEdit and NotebookEdit, distinct
 * paths only. Memory and settings (anything under /.claude/), scratch paths
 * (os.tmpdir(), /tmp, /var/folders) and documents (.md, .mdx, .markdown, .txt,
 * .rst, .adoc) are not implementation. Codex is out of scope (apply_patch is
 * ignored). A streak whose last edit is older than two hours is stale and starts
 * over.
 *
 * What counts as a delegation (seen on either PreToolUse or PostToolUse): a
 * spawn_agent call, or a Task or Agent call that hands work to an implementer:
 * no subagent_type (general-purpose), t1-worker, t1h-worker, general-purpose,
 * claude, or a name ending in builder or worker. Lookup agents (Explore, t2-*,
 * web-fetch, cavecrew-investigator and the like) are not a delegation of the
 * implementation: they change no state. A delegation clears the edit list and
 * the markers, so both reminders arm again.
 *
 * Both reminders are skipped when the session model is not above the Sonnet tier
 * (worthDelegating('T1', rank) is false): delegating from Sonnet saves nothing.
 *
 * State lives under <dir>/route-follow/ next to route-follow.js's files:
 *   <sid>.edits          one line per edit, "<ts>\t<path>", appended
 *   <sid>.impl-nudged    created with the `wx` flag, so of several parallel hook
 *                        processes exactly one speaks; removed by a delegation
 *   <sid>.impl-reminded  the same for the prompt-time reminder
 * Events go to the same route-follow-events.jsonl. followStats() only counts
 * turns that have a `hint` event and reads the event names `hint`, `nudged` and
 * `delegated`, so the `impl-nudged`, `impl-reminded` and `impl-delegated` lines
 * never change its numbers.
 *
 * Switch: `implementationFollowUp: false` in config.json (sprag routing impl off).
 * The module never throws into a hook.
 */

import { mkdirSync, appendFileSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { userDataDir } from './paths.js';
import { loadConfig, userLanguage } from './config.js';
import { routingEnabled } from './routing-switch.js';
import { logEvent } from './route-follow.js';
import { sessionModelRank, looksLikeImplementation } from './route-inject.js';
import { worthDelegating } from './route-scan.js';
import { resolveAgentName } from './agents.js';
import { debug } from './debug.js';

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
/** Distinct edited files at which the PostToolUse reminder goes out. */
const NUDGE_FILES = 2;
/** An edit streak whose last edit is older than this is left over from earlier work. */
const STREAK_TTL_MS = 2 * 60 * 60 * 1000;

const DELEGATE_TOOLS = new Set(['Task', 'Agent', 'spawn_agent']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const EXCLUDED_PREFIXES = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/'];
const DOC_EXT_RE = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
/** Subagent types that carry implementation work (no type means general-purpose). */
const IMPL_AGENTS = new Set(['t1-worker', 't1h-worker', 'general-purpose', 'claude']);
const IMPL_AGENT_RE = /(?:^|[:-])(?:builder|worker)$/;

const baseDir = (dir) => dir || userDataDir();

function paths(sessionId, dir) {
  const d = join(baseDir(dir), 'route-follow');
  return {
    d,
    edits: join(d, `${sessionId}.edits`),
    nudged: join(d, `${sessionId}.impl-nudged`),
    reminded: join(d, `${sessionId}.impl-reminded`),
  };
}

const rmQuiet = (file) => {
  try { rmSync(file, { force: true }); } catch (e) { debug('impl-follow:rm', e); }
};

function hasMarker(file) {
  try { readFileSync(file); return true; } catch (e) {
    if (e?.code !== 'ENOENT') debug('impl-follow:marker', e);
    return false;
  }
}

export function excludedPath(file) {
  // Windows paths arrive with backslashes; compare with forward slashes only.
  const f = file.replace(/\\/g, '/');
  if (f.includes('/.claude/')) return true;
  if (DOC_EXT_RE.test(f)) return true;
  const tmp = (tmpdir() || '').replace(/\\/g, '/');
  if (tmp && (f === tmp || f.startsWith(tmp.endsWith('/') ? tmp : `${tmp}/`))) return true;
  return EXCLUDED_PREFIXES.some((p) => f.startsWith(p));
}

/** True when this tool call hands implementation work to another agent. */
export function countsAsDelegation(tool, input) {
  if (tool === 'spawn_agent') return true;
  const type = typeof input?.subagent_type === 'string' ? input.subagent_type.trim() : '';
  if (!type) return true;
  return IMPL_AGENTS.has(type) || IMPL_AGENT_RE.test(type);
}

function readEdits(file) {
  let raw = '';
  try { raw = readFileSync(file, 'utf8'); } catch (e) { if (e?.code !== 'ENOENT') debug('impl-follow:read', e); }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const i = line.indexOf('\t');
    if (i < 0) continue;
    out.push({ ts: Number(line.slice(0, i)), path: line.slice(i + 1) });
  }
  return out;
}

function nudgeText({ n, files, target, lang }) {
  const names = files.map((f) => basename(f));
  const shown = names.slice(0, 3).join(', ');
  const more = names.length - 3;
  if (lang === 'ko') {
    const list = more > 0 ? `${shown} 외 ${more}개` : shown;
    return `✇ [sprag] 위임 없이 파일 ${n}개를 직접 고쳤습니다(${list}). `
      + `남은 구현이 여러 파일에 걸치면 구현 분업 조항대로 설계와 수정할 파일, 완료 기준, 테스트 명령을 정리해 ${target}에 넘기십시오. `
      + '남은 변경이 이미 읽은 파일의 약 50줄 이하이거나 설계를 아직 정하지 못했다면 그 이유를 답변에 한 줄로 밝히고 계속하십시오. '
      + '이 안내는 다음 위임 전까지 다시 나가지 않습니다.';
  }
  const list = more > 0 ? `${shown} and ${more} more` : shown;
  return `✇ [sprag] You have edited ${n} files yourself without delegating (${list}). `
    + 'If the remaining implementation spans several files, follow the implementation split: write down the design, files to change, completion criteria and test commands, '
    + `and hand it to ${target}. `
    + 'If what remains is roughly 50 lines in files already read, or the design is not settled yet, say so in one line in your reply and continue. '
    + 'This notice does not repeat until the next delegation.';
}

function reminderText({ target, lang }) {
  if (lang === 'ko') {
    return '✇ [sprag] 구현 요청으로 보입니다. 여러 파일을 고치는 구현이면 구현 분업 조항대로 설계를 먼저 정하고 '
      + `코드 작성은 ${target}에 넘기십시오. 이미 읽은 파일의 약 50줄 이하 변경이면 직접 처리합니다. `
      + '이 안내는 다음 위임 전까지 다시 나가지 않습니다.';
  }
  return '✇ [sprag] This looks like an implementation request. If it spans several files, follow the implementation split: '
    + `settle the design first and hand the code writing to ${target}. `
    + 'Changes of roughly 50 lines in files already read stay on the main model. '
    + 'This notice does not repeat until the next delegation.';
}

/**
 * UserPromptSubmit entry: one reminder per session (until the next delegation)
 * for a prompt that reads as an implementation request.
 *
 * @param {string} text the user's prompt
 * @param {{sessionId?: string, sessionRank?: number|null, cfg?: object, dir?: string, lang?: string, now?: number}} [opts]
 * @returns {string|null} the notice to add as context, or null
 */
export function implementationReminder(text, { sessionId, sessionRank = null, cfg = loadConfig(), dir, lang, now = Date.now() } = {}) {
  try {
    if (!routingEnabled(cfg)) return null;
    if (cfg?.implementationFollowUp === false) return null;
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return null;
    if (!looksLikeImplementation(text)) return null;
    if (sessionRank !== null && !worthDelegating('T1', sessionRank)) return null;

    const p = paths(sessionId, dir);
    mkdirSync(p.d, { recursive: true });
    try { closeSync(openSync(p.reminded, 'wx')); } catch (e) {
      if (e?.code !== 'EEXIST') debug('impl-follow:reminded', e);
      return null;
    }
    logEvent(dir, { at: now, agent: 'claude', sessionId, event: 'impl-reminded' });
    const target = resolveAgentName('sonnet', null) || 'general-purpose (model: sonnet)';
    return reminderText({ target, lang: lang || userLanguage() });
  } catch (e) {
    debug('impl-follow:reminder', e);
    return null;
  }
}

/**
 * PostToolUse entry: record the edit and, at the second distinct file edited
 * without a delegation, return the reminder.
 *
 * @param {object} payload hook payload (`session_id`, `tool_name`, `tool_input`, `hook_event_name`)
 * @param {{now?: number, cfg?: object, dir?: string, rank?: number|null, lang?: string}} [opts]
 *   `dir` replaces the user data dir (tests); `rank` replaces the session model
 *   rank read from the transcript; `lang` replaces userLanguage()
 * @returns {string|null} the notice to add as context, or null
 */
export function implFollowToolUse(payload, { now = Date.now(), cfg = loadConfig(), dir, rank, lang } = {}) {
  try {
    if (!routingEnabled(cfg)) return null;
    if (cfg?.implementationFollowUp === false) return null;
    // A subagent's own edits reach this hook under the parent's session id; the
    // worker doing the delegated edits must not be told to delegate.
    if (payload?.agent_id) return null;
    const sessionId = payload?.session_id;
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return null;

    const tool = String(payload.tool_name || '').replace(/^(?:functions|tools)\./, '');
    const p = paths(sessionId, dir);

    if (DELEGATE_TOOLS.has(tool)) {
      // A lookup agent (Explore, t2-*, web-fetch ...) delegates no implementation:
      // leave every record as it is.
      if (!countsAsDelegation(tool, payload.tool_input)) return null;
      rmQuiet(p.edits);
      const afterNudge = hasMarker(p.nudged);
      const afterReminder = hasMarker(p.reminded);
      rmQuiet(p.nudged);
      rmQuiet(p.reminded);
      if (afterNudge || afterReminder) {
        logEvent(dir, { at: now, agent: 'claude', sessionId, event: 'impl-delegated', afterNudge, afterReminder });
      }
      return null;
    }

    if (!EDIT_TOOLS.has(tool)) return null;
    if (payload.hook_event_name === 'PreToolUse') return null;
    const input = payload.tool_input;
    const file = input?.file_path ?? input?.notebook_path;
    if (typeof file !== 'string' || !file || excludedPath(file)) return null;

    mkdirSync(p.d, { recursive: true });
    let edits = readEdits(p.edits);
    const last = edits[edits.length - 1];
    if (last && Number.isFinite(last.ts) && now - last.ts > STREAK_TTL_MS) {
      rmQuiet(p.edits);
      rmQuiet(p.nudged);
      edits = [];
    }
    appendFileSync(p.edits, `${now}\t${file}\n`);
    edits.push({ ts: now, path: file });
    const files = [...new Set(edits.map((e) => e.path))];
    if (files.length < NUDGE_FILES) return null;

    const sessionRank = rank === undefined ? sessionModelRank({ transcriptPath: payload.transcript_path }) : rank;
    if (sessionRank !== null && !worthDelegating('T1', sessionRank)) return null;

    // Parallel hooks can all see the count here; only the process that creates
    // the marker speaks.
    try { closeSync(openSync(p.nudged, 'wx')); } catch (e) {
      if (e?.code !== 'EEXIST') debug('impl-follow:nudged', e);
      return null;
    }
    logEvent(dir, { at: now, agent: 'claude', sessionId, event: 'impl-nudged', files: files.length });
    const target = resolveAgentName('sonnet', null) || 'general-purpose (model: sonnet)';
    return nudgeText({ n: files.length, files, target, lang: lang || userLanguage() });
  } catch (e) {
    debug('impl-follow:tool', e);
    return null;
  }
}
