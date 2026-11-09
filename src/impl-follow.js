/**
 * Follow-up after direct edits: one reminder when the main model has edited
 * three distinct files itself without delegating.
 *
 * Why this exists: the implementation split clause of the model rules (the main
 * model settles the design, a Sonnet worker writes the code) is static text, and
 * the model often misses it. Measured since 10-10 over 112 implementation turns:
 * 48 delegated, 64 were edited directly by the main model across three or more
 * files. The prompt hook cannot give a hint for an implementation request (the
 * EDIT_RE gate in src/route-inject.js is intentional and stays), so the
 * judgement is made at PostToolUse from what was actually edited.
 *
 * What counts: Edit, Write, MultiEdit and NotebookEdit on PostToolUse, distinct
 * paths only. Memory and settings (anything under /.claude/) and scratch paths
 * (os.tmpdir(), /tmp, /var/folders) are not implementation. Codex is out of scope
 * (apply_patch is ignored). A Task or Agent call, seen on either PreToolUse or
 * PostToolUse, counts as a delegation: the edit list and the marker are cleared,
 * so the next streak of three files can be reminded again. A streak whose last
 * edit is older than two hours is stale and starts over.
 *
 * The reminder is skipped when the session model is not above the Sonnet tier
 * (worthDelegating('T1', rank) is false): delegating from Sonnet saves nothing.
 * The rank is only computed once the threshold is reached.
 *
 * State lives under <dir>/route-follow/ next to route-follow.js's files:
 *   <sid>.edits         one line per edit, "<ts>\t<path>", appended
 *   <sid>.impl-nudged   created with the `wx` flag, so of several parallel hook
 *                       processes exactly one speaks; removed by a delegation
 * Events go to the same route-follow-events.jsonl. followStats() only counts
 * turns that have a `hint` event and reads the event names `hint`, `nudged` and
 * `delegated`, so the `impl-nudged` and `impl-delegated` lines never change its
 * numbers.
 *
 * The module never throws into a hook: implFollowToolUse swallows everything.
 */

import { mkdirSync, appendFileSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { userDataDir } from './paths.js';
import { loadConfig, userLanguage } from './config.js';
import { routingEnabled } from './routing-switch.js';
import { logEvent } from './route-follow.js';
import { sessionModelRank } from './route-inject.js';
import { worthDelegating } from './route-scan.js';
import { resolveAgentName } from './agents.js';
import { debug } from './debug.js';

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
/** Distinct edited files at which the reminder goes out. */
const NUDGE_FILES = 3;
/** An edit streak whose last edit is older than this is left over from earlier work. */
const STREAK_TTL_MS = 2 * 60 * 60 * 1000;

const DELEGATE_TOOLS = new Set(['Task', 'Agent', 'spawn_agent']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const EXCLUDED_PREFIXES = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/'];

const baseDir = (dir) => dir || userDataDir();

function paths(sessionId, dir) {
  const d = join(baseDir(dir), 'route-follow');
  return {
    d,
    edits: join(d, `${sessionId}.edits`),
    nudged: join(d, `${sessionId}.impl-nudged`),
  };
}

const rmQuiet = (file) => {
  try { rmSync(file, { force: true }); } catch (e) { debug('impl-follow:rm', e); }
};

function excludedPath(file) {
  if (file.includes('/.claude/')) return true;
  const tmp = tmpdir();
  if (tmp && (file === tmp || file.startsWith(tmp.endsWith('/') ? tmp : `${tmp}/`))) return true;
  return EXCLUDED_PREFIXES.some((p) => file.startsWith(p));
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

/**
 * PostToolUse entry: record the edit and, at the third distinct file edited
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
      rmQuiet(p.edits);
      let hadMarker = false;
      try { readFileSync(p.nudged); hadMarker = true; } catch (e) { if (e?.code !== 'ENOENT') debug('impl-follow:marker', e); }
      rmQuiet(p.nudged);
      if (hadMarker) logEvent(dir, { at: now, agent: 'claude', sessionId, event: 'impl-delegated', afterNudge: true });
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
