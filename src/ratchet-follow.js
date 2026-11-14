/**
 * Ratchet candidates from the PostToolUse hook: spot an error that keeps coming
 * back, record it for the statusline chip, and tell the model once to ask the
 * user whether to turn it into a ratchet rule.
 *
 * Why this exists: the `ratchet? #N` chip and the "register this mistake as a
 * rule" suggestion almost never appeared. Three causes. The detector in
 * src/harness-analyzer.cjs was only called from the `--hook-run` hook, which
 * `sprag install` does not register. A candidate only ever reached the
 * statusline, never the model's context. And the detector looked for the same
 * error twice inside the last 30 lines of one session, which misses the errors
 * that recur across sessions. Measured over 30 days and 1043 sessions: 30 error
 * shapes recurred in two or more sessions, while a repeat inside a single session
 * happened in only 6 sessions over 14 days.
 *
 * So this follower runs on `sprag brief --hook-tool` (installed by default), next
 * to route-follow.js and impl-follow.js. It keeps a small ledger of error shapes
 * (`<base>/ratchet-seen.json`) that holds only hashes and times, never error
 * text, so a shape seen in another session counts toward the same candidate.
 *
 * Files under the data dir (`dir` replaces it in tests):
 *   ratchet-seen.json                 { v: 1, sigs: { "<h12>": { s: [session hash x8], first, last, nudged? } } }
 *   ratchet-candidates.json           written through harness-analyzer.cjs, read by the statusline and `harness promote N`
 *   route-follow/<sid>.ratchet-<h12>  `wx` marker, so of several parallel hook
 *                                     processes exactly one speaks
 * Events go to route-follow-events.jsonl as `ratchet-nudged` (no error text).
 *
 * Switches: `harness.enabled: false` silences everything, `ratchetFollowUp: false`
 * in config.json keeps the candidate file but drops the notice. A clean tool
 * call ends before any file is read or written. The module never throws into a
 * hook.
 */

import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { userDataDir } from './paths.js';
import { loadConfig, userLanguage } from './config.js';
import { logEvent } from './route-follow.js';
import { CLI_NAME } from './cli-name.js';
import { debug } from './debug.js';

const require = createRequire(import.meta.url);

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const TAIL_BYTES = 1024 * 1024;
const LEDGER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LEDGER_MAX = 400;
const SESSIONS_KEPT = 8;
const MAX_CANDIDATES = 5;

const sha1 = (s, n) => createHash('sha1').update(String(s)).digest('hex').slice(0, n);

function readLedger(file) {
  try {
    const l = JSON.parse(readFileSync(file, 'utf8'));
    if (l && l.v === 1 && l.sigs && typeof l.sigs === 'object') return l;
  } catch (e) {
    if (e?.code !== 'ENOENT') debug('ratchet-follow:ledger-read', e);
  }
  return { v: 1, sigs: {} };
}

function writeLedger(file, ledger, now) {
  const sigs = ledger.sigs;
  for (const k of Object.keys(sigs)) {
    if (!(now - (sigs[k].last || 0) <= LEDGER_TTL_MS)) delete sigs[k];
  }
  const keys = Object.keys(sigs);
  if (keys.length > LEDGER_MAX) {
    keys.sort((a, b) => (sigs[a].last || 0) - (sigs[b].last || 0));
    for (const k of keys.slice(0, keys.length - LEDGER_MAX)) delete sigs[k];
  }
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(ledger) + '\n');
    renameSync(tmp, file);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    throw e;
  }
}

function noticeText({ count, sessions, pattern, lang }) {
  if (lang === 'ko') {
    const where = sessions < 2 ? `이 세션에서 ${count}번` : `최근 30일 동안 세션 ${sessions}개에서`;
    return `✇ [sprag] 같은 오류가 ${where} 발생했습니다: "${pattern}". `
      + '지금 하던 작업을 마친 뒤 답변 끝에서 이 실수를 래칫 룰로 등록할지 사용자에게 한 번 물으십시오. '
      + '물을 때는 "조건 → 행동" 한 줄로 쓴 룰 초안을 보여 주고 등록 범위(global 또는 project)도 함께 묻습니다. '
      + `사용자가 승인하면 \`${CLI_NAME} harness promote "<룰>" --global\` 또는 \`--project\` 로 등록합니다. `
      + '같은 내용을 다루는 룰이 이미 있으면 새로 묻지 말고 그 룰을 따르지 못한 이유를 밝히십시오. '
      + '환경 문제나 일회성 오타라서 룰로 막을 수 없는 오류라면 묻지 말고 그 이유를 한 줄로 밝히십시오. '
      + '이 오류는 다시 안내하지 않습니다.';
  }
  const where = sessions < 2 ? `${count} times in this session` : `in ${sessions} sessions over the last 30 days`;
  return `✇ [sprag] The same error has now come up ${where}: "${pattern}". `
    + 'When the current task is done, ask the user once, at the end of your reply, whether to register this mistake as a ratchet rule. '
    + 'Show a one-line draft in the form "condition → action" and ask for the scope (global or project) in the same question. '
    + `On approval, register it with \`${CLI_NAME} harness promote "<rule>" --global\` or \`--project\`. `
    + 'If a rule already covers it, do not ask again; say why that rule was not followed. '
    + 'If no rule could have prevented it (an environment problem, a one-off typo), do not ask; say why in one line instead. '
    + 'This notice does not repeat for this error.';
}

/**
 * PostToolUse entry: update the ledger, write the candidate file, and return
 * the notice the first time a candidate crosses the threshold.
 *
 * @param {object} payload hook payload (`session_id`, `transcript_path`, `cwd`, `hook_event_name`, `agent_id`)
 * @param {{now?: number, cfg?: object, dir?: string, lang?: string, harnessReady?: boolean}} [opts]
 *   `dir` replaces the user data dir (tests); `harnessReady` replaces the check
 *   that the project's CLAUDE.md carries the harness block
 * @returns {Promise<string|null>} the notice to add as context, or null
 */
export async function ratchetFollowToolUse(payload, { now = Date.now(), cfg = loadConfig(), dir, lang, harnessReady } = {}) {
  try {
    if (cfg?.harness?.enabled === false) return null;
    if (payload?.agent_id) return null;
    if (payload?.hook_event_name && payload.hook_event_name !== 'PostToolUse') return null;
    const sessionId = payload?.session_id;
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return null;
    if (typeof payload.transcript_path !== 'string') return null;

    const analyzer = require('./harness-analyzer.cjs');
    const errors = analyzer.recentErrors(analyzer.readTailEntries(payload.transcript_path, TAIL_BYTES));
    if (errors.length === 0) return null;

    const base = dir || userDataDir();
    const ledgerFile = join(base, 'ratchet-seen.json');
    const ledger = readLedger(ledgerFile);
    const sh = sha1(sessionId, 8);
    let changed = false;
    const rows = errors.map((e) => {
      const h12 = sha1(e.key, 12);
      let entry = ledger.sigs[h12];
      if (!entry) {
        entry = { s: [], first: now, last: now };
        ledger.sigs[h12] = entry;
        changed = true;
      }
      if (!entry.s.includes(sh)) {
        entry.s = entry.s.concat(sh).slice(-SESSIONS_KEPT);
        entry.last = now;
        changed = true;
      }
      return { e, h12, entry };
    });
    if (changed) {
      mkdirSync(base, { recursive: true });
      writeLedger(ledgerFile, ledger, now);
    }

    const ranked = rows
      .map(({ e, h12, entry }) => ({ pattern: e.pattern, count: Math.max(e.count, entry.s.length), sessions: entry.s.length, lastAt: e.lastAt, key: h12 }))
      .filter((c) => c.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_CANDIDATES);
    const candidates = ranked.map((c, i) => ({ id: i + 1, ...c }));
    if (candidates.length === 0) return null;

    analyzer.writeCandidates({
      sessionId,
      cwd: payload.cwd || null,
      timestamp: new Date(now).toISOString(),
      candidates,
    }, dir);

    if (cfg?.ratchetFollowUp === false) return null;
    let ready = harnessReady;
    if (typeof ready !== 'boolean') {
      const { harnessStatus, findProjectRoot } = await import('./harness.js');
      ready = !!harnessStatus(findProjectRoot(payload.cwd || process.cwd())).hasBlock;
    }
    if (!ready) return null;

    const pick = candidates.find((c) => !ledger.sigs[c.key]?.nudged);
    if (!pick) return null;
    const markerDir = join(base, 'route-follow');
    mkdirSync(markerDir, { recursive: true });
    try { closeSync(openSync(join(markerDir, `${sessionId}.ratchet-${pick.key}`), 'wx')); } catch (e) {
      if (e?.code !== 'EEXIST') debug('ratchet-follow:marker', e);
      return null;
    }
    ledger.sigs[pick.key].nudged = now;
    writeLedger(ledgerFile, ledger, now);
    logEvent(dir, { at: now, agent: 'claude', sessionId, event: 'ratchet-nudged', count: pick.count, sessions: pick.sessions });
    return noticeText({ count: pick.count, sessions: pick.sessions, pattern: pick.pattern, lang: lang || userLanguage() });
  } catch (e) {
    debug('ratchet-follow:tool', e);
    return null;
  }
}
