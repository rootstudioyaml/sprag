/**
 * What an agent session has used, for `sprag bar`: model, context, tokens, cost
 * and the account limits Claude and Codex report.
 *
 * Every read is defensive and none throws: the files are internal to Claude Code
 * and Codex, change shape without notice, and may be half-written. A missing or
 * odd file gives null for that field and nothing else.
 *
 *   - Claude limits come from the statusline's last-caps.json snapshot, which is
 *     only fresh while a statusline is rendering. Claude Code exposes no other
 *     way to read them.
 *   - Claude model and context come from the tail of the session transcript.
 *     The window size and a statusline-reported model come from ctx-window.json.
 *   - Claude tokens and cost come from session-cache.json, the parse cache the
 *     statusline keeps current. This module never parses a whole transcript.
 *   - Codex writes one rollout file per session under
 *     <codexHome>/sessions/YYYY/MM/DD/. A running `codex` process is tied to its
 *     rollout through the files it holds open (`lsof`), because a rollout does
 *     not record its process.
 *
 * The only child process started here is `lsof`, and only while a Codex process
 * is running. It never re-runs the sprag CLI and never spawns a detached child.
 */

import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, sep } from 'node:path';
import { loadRecentSnapshot } from './caps-cache.js';
import { liveModelFor, liveWindowFor } from './ctx-window-cache.js';
import { peekCached } from './session-cache.js';
import { sessionCostAcross } from './claude-price.js';
import { labelForKey, windowLabel } from './window-labels.js';
import { shortModelName } from './formatters/statusline.js';
import { readCodexSnapshot, readCodexTailLines } from './codex/parser.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The statusline writes last-caps.json every few seconds, so half an hour old means no statusline is running. */
const CAPS_MAX_AGE_MS = 30 * 60 * 1000;
const TRANSCRIPT_TAIL = 256 * 1024;
// One large tool result can fill the whole tail and push the last request out of it.
const TRANSCRIPT_WIDE_TAIL = 4 * 1024 * 1024;
const ROLLOUT_TAIL = 1024 * 1024;
const ROLLOUT_HEAD = 64 * 1024;
/** A lone Codex process with no open rollout is matched to a rollout written this recently. */
const SINGLE_ROW_FRESH_MS = 15 * 60 * 1000;
const ROLLOUT_NAME = /^rollout-.*\.jsonl$/;
const ROLLOUT_OPEN = /[\\/]rollout-[^\\/]*\.jsonl$/;

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const cents = (usd) => Math.round(usd * 100) / 100;

/**
 * The last `tailBytes` of a file as text. `cut` is true when the file is longer,
 * so the first line of `text` may be a fragment.
 *
 * @returns {{ text: string, cut: boolean }|null} null when the file cannot be read or is empty
 */
export function readTail(path, tailBytes = TRANSCRIPT_TAIL) {
  if (typeof path !== 'string' || path === '') return null;
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = statSync(path).size;
    const len = Math.min(size, tailBytes);
    if (len <= 0) return null;
    const buf = Buffer.alloc(len);
    const got = readSync(fd, buf, 0, len, size - len);
    return { text: buf.toString('utf8', 0, got), cut: size > len };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* nothing to release */ }
    }
  }
}

// ---------------------------------------------------------------- Claude

/**
 * The account windows from the statusline snapshot, or null when there is no
 * snapshot younger than half an hour. A window with no usable percentage, or
 * one that already reset, would show a number that is no longer true, so it is
 * left out. `resetsAt` is stored in seconds and returned in milliseconds.
 *
 * @returns {{ windows: Array<{ key: string, label: string, usedPct: number, resetsAt: number|null, spend?: number, maxBudget?: number }> }|null}
 */
export function claudeLimits({ dataDir, now = Date.now() }) {
  try {
    const snap = loadRecentSnapshot({ maxAgeMs: CAPS_MAX_AGE_MS, path: join(dataDir, 'last-caps.json') });
    const windows = snap?.caps?.windows;
    if (!Array.isArray(windows)) return null;
    const out = [];
    for (const w of windows) {
      if (!w || typeof w.key !== 'string' || !finite(w.usedPct)) continue;
      const resetsAt = finite(w.resetsAt) && w.resetsAt > 0 ? w.resetsAt * 1000 : null;
      if (resetsAt !== null && resetsAt <= now) continue;
      const entry = { key: w.key, label: labelForKey(w.key).short, usedPct: w.usedPct, resetsAt };
      // The spend limit window carries the money behind its percentage.
      if (finite(w.spend)) entry.spend = w.spend;
      if (finite(w.maxBudget)) entry.maxBudget = w.maxBudget;
      out.push(entry);
    }
    return out.length ? { windows: out } : null;
  } catch {
    return null;
  }
}

/** The last model id in a transcript tail; `<synthetic>` marks a stub Claude Code wrote itself. */
function lastModel(text) {
  let model = null;
  for (const m of text.matchAll(/"model":"([^"]+)"/g)) {
    if (m[1] !== '<synthetic>') model = m[1];
  }
  return model;
}

const USAGE_RE = /"usage":\{"input_tokens":(\d+),"cache_creation_input_tokens":(\d+),"cache_read_input_tokens":(\d+)/;

/**
 * Prompt size of the newest main-thread request in a transcript tail. A
 * sidechain line belongs to a subagent, whose prompt is not this session's
 * context. Counts input, cache writes and cache reads, as the statusline does.
 */
function lastContextTokens({ text, cut }) {
  const lines = text.split('\n');
  if (cut) lines.shift();
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"usage":{"input_tokens"') || line.includes('"isSidechain":true')) continue;
    const m = USAGE_RE.exec(line);
    if (m) return Number(m[1]) + Number(m[2]) + Number(m[3]);
  }
  return null;
}

/**
 * Tokens, requests and cost of a Claude session and its subagents, from the
 * parse cache the statusline keeps. Subagent transcripts are cached under
 * `<transcript minus .jsonl>/...`, so they are found by key prefix. The cache
 * may lag the transcript by a few seconds, which is fine for a display.
 *
 * @returns {{ tokens: { input: number, cacheRead: number, cacheWrite: number, output: number }, requests: number, costUsd: number|null }|null}
 */
export function claudeUsage({ cache, transcript, sessionId, env, now }) {
  if (!cache?.entries || typeof transcript !== 'string' || typeof sessionId !== 'string') return null;
  const subPrefix = join(dirname(transcript), sessionId) + sep;
  const summaries = [];
  const own = peekCached(cache, transcript);
  if (own) summaries.push(own);
  for (const key of Object.keys(cache.entries)) {
    if (!key.startsWith(subPrefix)) continue;
    const s = peekCached(cache, key);
    if (s) summaries.push(s);
  }
  const counted = summaries.filter((s) => s.totals && typeof s.totals === 'object');
  if (!counted.length) return null;
  const tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  let requests = 0;
  for (const s of counted) {
    tokens.input += s.totals.input || 0;
    tokens.cacheRead += s.totals.cacheRead || 0;
    tokens.cacheWrite += s.totals.cacheCreation || 0;
    tokens.output += s.totals.output || 0;
    requests += s.requestCount || 0;
  }
  let costUsd = null;
  try {
    const cost = sessionCostAcross(counted, { env, now });
    // Nothing priced means "unknown", not zero dollars.
    if (!(cost.unpriced > 0 && !(cost.actual > 0)) && finite(cost.actual)) costUsd = cents(cost.actual);
  } catch { costUsd = null; }
  return { tokens, requests, costUsd };
}

/**
 * Model, context and usage of one Claude session. `cache` is the loaded
 * session-cache.json, shared by every row of one snapshot.
 *
 * @returns {{ model: string|null, modelName: string|null,
 *             context: { tokens: number, window: number|null, pct: number|null }|null,
 *             usage: object|null }}
 */
export function claudeSessionDetail({ sessionId, transcript, dataDir, cache, env, now }) {
  const detail = { model: null, modelName: null, context: null, usage: null };
  try {
    const ctxPath = join(dataDir, 'ctx-window.json');
    const tail = readTail(transcript);
    detail.model = liveModelFor(sessionId, ctxPath) ?? (tail ? lastModel(tail.text) : null);
    detail.modelName = detail.model ? shortModelName(detail.model) : null;
    let tokens = tail ? lastContextTokens(tail) : null;
    if (tokens === null && tail?.cut) {
      const wide = readTail(transcript, TRANSCRIPT_WIDE_TAIL);
      if (wide) tokens = lastContextTokens(wide);
    }
    if (tokens !== null) {
      const window = liveWindowFor(sessionId, ctxPath);
      detail.context = { tokens, window, pct: window ? Math.round(tokens / window * 100) : null };
    }
    detail.usage = claudeUsage({ cache, transcript, sessionId, env, now });
  } catch { /* keep whatever was read */ }
  return detail;
}

// ----------------------------------------------------------------- Codex

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Rollout files written in the last `withinMs`, newest first. Codex files them
 * by local date, so only today's and yesterday's folders are read.
 *
 * @returns {Array<{ file: string, mtimeMs: number }>}
 */
export function recentRollouts({ codexHome, now = Date.now(), withinMs = DAY_MS }) {
  const out = [];
  try {
    const days = new Set();
    for (const t of [now, now - DAY_MS]) {
      const d = new Date(t);
      days.add(join(codexHome, 'sessions', String(d.getFullYear()), pad2(d.getMonth() + 1), pad2(d.getDate())));
    }
    for (const dir of days) {
      let names;
      try { names = readdirSync(dir); } catch { continue; }
      for (const name of names) {
        if (!ROLLOUT_NAME.test(name)) continue;
        const file = join(dir, name);
        try {
          const mtimeMs = statSync(file).mtimeMs;
          if (now - mtimeMs <= withinMs) out.push({ file, mtimeMs });
        } catch { /* removed since the listing */ }
      }
    }
  } catch { /* no codex home */ }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.file < b.file ? 1 : -1));
}

/**
 * The files each pid holds open, from one `lsof` call. A pid that exited
 * between `ps` and `lsof` makes lsof exit 1 while it still prints the others,
 * so output on a failed run is used too.
 *
 * @returns {Map<number, string[]>|null} null on Windows, when lsof is missing or prints nothing
 */
export function defaultOpenFiles(pids) {
  if (process.platform === 'win32' || !Array.isArray(pids) || !pids.length) return null;
  let out;
  try {
    out = execFileSync('lsof', ['-a', '-p', pids.join(','), '-Fpn'], {
      encoding: 'utf8', timeout: 1500, maxBuffer: 8 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    out = typeof e?.stdout === 'string' ? e.stdout : null;
  }
  if (!out) return null;
  const map = new Map();
  let files = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) {
      const pid = Number(line.slice(1));
      files = Number.isFinite(pid) ? [] : null;
      if (files) map.set(pid, files);
    } else if (line.startsWith('n') && files) {
      files.push(line.slice(1));
    }
  }
  return map;
}

/**
 * The rollout a Codex process is writing: the first rollout among the files its
 * pids hold open. Without one, a lone Codex process falls back to the newest
 * rollout written in the last 15 minutes. With several processes nothing says
 * which rollout is whose, so none is guessed.
 *
 * @param {number[]} pids the process and its Codex children (the native binary may hold the file)
 * @returns {string|null}
 */
export function pickRollout({ pids, open, rollouts, onlyRow, now = Date.now() }) {
  if (open instanceof Map) {
    for (const pid of pids) {
      const hit = (open.get(pid) ?? []).find((f) => ROLLOUT_OPEN.test(f));
      if (hit) return hit;
    }
  }
  if (!onlyRow) return null;
  const fresh = rollouts.find((r) => now - r.mtimeMs <= SINGLE_ROW_FRESH_MS);
  return fresh ? fresh.file : null;
}

/** `cwd` from the session_meta line at the head of a rollout. That line can be longer than the head read, so a cut line is searched by pattern. */
function readSessionCwd(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(ROLLOUT_HEAD);
    const got = readSync(fd, buf, 0, ROLLOUT_HEAD, 0);
    const first = buf.toString('utf8', 0, got).split('\n')[0];
    try {
      const cwd = JSON.parse(first)?.payload?.cwd;
      if (typeof cwd === 'string' && cwd) return cwd;
    } catch { /* cut or malformed: search the text */ }
    const m = /"cwd":("(?:[^"\\]|\\.)*")/.exec(first);
    if (m) {
      const cwd = JSON.parse(m[1]);
      if (typeof cwd === 'string' && cwd) return cwd;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* nothing to release */ }
    }
  }
}

/** Running totals of the newest `token_count` record in the tail lines. */
function lastTotalUsage(lines) {
  if (!lines) return null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"token_count"')) continue;
    try {
      const e = JSON.parse(line);
      const u = e?.payload?.type === 'token_count' ? e.payload.info?.total_token_usage : null;
      if (u && typeof u === 'object') return u;
    } catch { /* partial record */ }
  }
  return null;
}

/**
 * What one rollout says: the parser's snapshot (model, effort, status, context,
 * rate limits), the running token totals and the working folder. null when the
 * file cannot be read.
 */
export function readRollout(file) {
  try {
    const snapshot = readCodexSnapshot(file, { tailBytes: ROLLOUT_TAIL });
    if (!snapshot) return null;
    return {
      snapshot,
      total: lastTotalUsage(readCodexTailLines(file, ROLLOUT_TAIL)),
      cwd: readSessionCwd(file),
    };
  } catch {
    return null;
  }
}

const CODEX_STATE = { working: 'busy', idle: 'idle', interrupted: 'idle' };

/**
 * The row fields a rollout fills in. Codex cost is not priced here: the
 * rollout carries token counts only, and a number that disagrees with the
 * Codex panel would be worse than none, so `requests` and `costUsd` stay null.
 */
export function codexRowFields(rollout) {
  const s = rollout.snapshot;
  const model = typeof s.model === 'string' && s.model ? s.model : null;
  const tokens = finite(s.lastContextTokens) ? s.lastContextTokens : null;
  const window = finite(s.contextWindow) ? s.contextWindow : null;
  const u = rollout.total;
  const count = (n) => (finite(n) && n >= 0 ? n : 0);
  return {
    model,
    modelName: model,
    effort: typeof s.effort === 'string' && s.effort ? s.effort : null,
    state: CODEX_STATE[s.status] ?? null,
    context: tokens === null ? null : { tokens, window, pct: window ? Math.round(tokens / window * 100) : null },
    usage: u ? {
      tokens: {
        input: Math.max(0, count(u.input_tokens) - count(u.cached_input_tokens)),
        cacheRead: count(u.cached_input_tokens),
        cacheWrite: count(u.cache_write_input_tokens),
        output: count(u.output_tokens),
      },
      requests: null,
      costUsd: null,
    } : null,
    cwd: rollout.cwd,
  };
}

/**
 * The Codex account windows from a rollout's `rate_limits`. A window with no
 * percentage or one that already reset is left out, as for Claude.
 *
 * @returns {{ plan: string|null, windows: Array<{ key: string, label: string, usedPct: number, resetsAt: number|null }> }|null}
 */
export function codexLimits(rateLimits, now = Date.now()) {
  try {
    if (!rateLimits || typeof rateLimits !== 'object') return null;
    const windows = [];
    for (const key of ['primary', 'secondary']) {
      const w = rateLimits[key];
      if (!finite(w?.used_percent)) continue;
      const resetsAt = finite(w.resets_at) ? w.resets_at * 1000 : null;
      if (resetsAt !== null && resetsAt <= now) continue;
      windows.push({ key, label: windowLabel(w.window_minutes, key), usedPct: w.used_percent, resetsAt });
    }
    if (!windows.length) return null;
    return { plan: typeof rateLimits.plan_type === 'string' ? rateLimits.plan_type : null, windows };
  } catch {
    return null;
  }
}
