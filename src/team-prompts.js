/**
 * team-prompts — the Enterprise prompt uploader.
 *
 * Runs inside syncTeam only when the team's policy has prompt capture on (the
 * server sends prompt_capture = true, and only for Enterprise organizations).
 * What leaves the machine: the prompts the user typed in their own main
 * sessions (Claude Code transcripts and Codex sessions), including the ones
 * typed while the assistant was still working (queued), each as
 * { at, project (a directory basename), text }, with obvious secrets replaced
 * by "[redacted]". Never sent: assistant replies, tool output, file contents,
 * subagent transcripts, slash-command wrappers, system reminders, local paths,
 * background-task notifications, messages from other agents, and `!` shell
 * commands with their output.
 *
 * Consent boundary: the first time a machine sees capture on, every existing
 * transcript's offset is set to its current size, so history written before the
 * policy reached this machine is never uploaded. Files created later start at 0.
 * Turning capture off deletes the offsets file, so turning it on again starts
 * fresh at the end of every file.
 *
 * Incremental by byte offset (prompts-offsets.json: { [path]: { offset, size, ino } }).
 * The stored offset advances only after the server accepted the chunk or said
 * it already had it. The path never leaves the machine: file_key is the first
 * 16 hex chars of sha256(path).
 */

import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync, fstatSync, readdirSync, statSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { claudeUserDir, userDataDir } from './paths.js';
import { codexUserDir } from './agent.js';
import { discoverCodexSessionFiles } from './codex/parser.js';
import { writeStateFile } from './state-file.js';
import { debug } from './debug.js';

export const MAX_RUN_PROMPTS = 2000;
export const MAX_RUN_BYTES = 8 * 1024 * 1024;
export const MAX_CHUNK_PROMPTS = 500;
const MAX_CHUNK_CHARS = 1800000; // server cap is 2,000,000
const MAX_TEXT = 20000;
const READ_WINDOW = 16 * 1024 * 1024;
const READ_WINDOW_MAX = 256 * 1024 * 1024;

export const promptOffsetsPath = (dir = userDataDir()) => join(dir, 'prompts-offsets.json');

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const REDACTED = '[redacted]';
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*$/g, // key block cut off by the end of the prompt
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
];

/** Replace obvious secrets with "[redacted]". Conservative: it may over-redact, never under-redact these shapes. */
export function redactSecrets(text) {
  let s = String(text ?? '');
  for (const re of SECRET_PATTERNS) s = s.replace(re, REDACTED);
  s = s.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, `$1${REDACTED}`);
  s = s.replace(
    /\b([A-Za-z0-9_]*(?:KEY|TOKEN|PASSWORD|PASSWD|SECRET)[A-Za-z0-9_]*)(\s*=\s*)("[^"\n]*"|'[^'\n]*'|[^\s"']+)/gi,
    (m, name, eq, val) => (val === REDACTED ? m : `${name}${eq}${REDACTED}`),
  );
  return s;
}

// ---------------------------------------------------------------------------
// Prompt extraction
// ---------------------------------------------------------------------------

const basenameOf = (p) => {
  const s = String(p ?? '').replace(/[\\/]+$/, '');
  return s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1).slice(0, 80);
};

const WRAPPER_RE = /<(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr|task-notification)>/;
// machine-written turns that arrive as user messages: a background task's completion, another agent's message, a harness notice
const MACHINE_RE = /^\s*(?:<task-notification>|<agent-message\b|\[SYSTEM NOTIFICATION)/;
const REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/** Strip reminders, drop wrappers and injected context; null when nothing user-typed is left. */
function cleanPrompt(raw) {
  if (typeof raw !== 'string') return null;
  if (WRAPPER_RE.test(raw) || MACHINE_RE.test(raw)) return null;
  const text = raw.replace(REMINDER_RE, '').trim();
  if (MACHINE_RE.test(text)) return null;
  if (!text) return null;
  if (text.startsWith('[Request interrupted by user')) return null;
  return redactSecrets(text).slice(0, MAX_TEXT);
}

const textParts = (content) => (Array.isArray(content) ? content : [])
  .filter((c) => c && c.type !== 'tool_result' && typeof c.text === 'string').map((c) => c.text).join('\n');

/** One Claude Code transcript line -> { at, project, text } or null. */
export function claudePromptFromLine(line) {
  let e;
  try { e = JSON.parse(line); } catch { return null; }
  if (!e || e.isSidechain) return null;
  // A prompt typed while the assistant is still working is stored as a queued_command attachment, never as a user line;
  // only the ones a person typed (origin.kind 'human') count, not queued task notifications or messages from other agents.
  const q = e.type === 'attachment' ? e.attachment : null;
  if (q) {
    if (q.type !== 'queued_command' || q.isMeta || q.commandMode !== 'prompt' || q.origin?.kind !== 'human') return null;
    const text = cleanPrompt(q.prompt);
    const at = Date.parse(q.timestamp || e.timestamp);
    if (!text || !Number.isFinite(at)) return null;
    return { at: new Date(at).toISOString(), project: basenameOf(e.cwd), text };
  }
  if (e.type !== 'user' || e.isMeta || e.isCompactSummary || e.isVisibleInTranscriptOnly) return null;
  const c = e.message?.content;
  const text = cleanPrompt(typeof c === 'string' ? c : textParts(c));
  const at = Date.parse(e.timestamp);
  if (!text || !Number.isFinite(at)) return null;
  return { at: new Date(at).toISOString(), project: basenameOf(e.cwd), text };
}

const CODEX_INJECTED = /^\s*(?:<environment_context>|<user_instructions>|<INSTRUCTIONS>|<turn_aborted>|<permissions instructions>|# AGENTS\.md instructions|<user_action>|<skill>)/;

/** One Codex rollout line -> { at, text } or null (project comes from the file's session_meta). */
export function codexPromptFromLine(line) {
  let e;
  try { e = JSON.parse(line); } catch { return null; }
  const p = e?.payload;
  if (!p || e.type !== 'event_msg') return null;
  let raw = null;
  if (p.type === 'item_completed' && p.item?.type === 'UserMessage') raw = textParts(p.item.content);
  else if (p.type === 'user_message' && typeof p.message === 'string') raw = p.message;
  if (raw == null || CODEX_INJECTED.test(raw)) return null;
  const text = cleanPrompt(raw);
  const at = Date.parse(e.timestamp);
  if (!text || !Number.isFinite(at)) return null;
  return { at: new Date(at).toISOString(), text };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function readHead(path, bytes = 65536) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch { return ''; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* gone */ } }
}

/** { cwdBase, subagent } from a Codex file's session_meta (first line). */
function codexMeta(path) {
  const first = readHead(path).split('\n', 1)[0];
  try {
    const p = JSON.parse(first).payload || {};
    const src = typeof p.source === 'string' ? p.source : JSON.stringify(p.source || '');
    return { project: basenameOf(p.cwd), subagent: p.thread_source === 'subagent' || /subagent/.test(src) };
  } catch { return { project: '', subagent: false }; }
}

/** Main-session transcripts only: ~/.claude/projects/<dir>/*.jsonl and <codex>/sessions/**\/*.jsonl. */
export async function discoverPromptFiles({ claudeDir = claudeUserDir(), codexDir = codexUserDir() } = {}) {
  const out = [];
  const root = join(claudeDir, 'projects');
  let dirs = [];
  try { dirs = readdirSync(root, { withFileTypes: true }); } catch { /* no Claude Code data */ }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let names = [];
    try { names = readdirSync(join(root, d.name)); } catch { continue; }
    for (const n of names) if (n.endsWith('.jsonl')) out.push({ path: join(root, d.name, n), source: 'claude' });
  }
  try {
    const sessionsRoot = join(codexDir, 'sessions');
    for (const f of await discoverCodexSessionFiles({ home: codexDir, days: 36500 })) {
      if (f.path.startsWith(sessionsRoot)) out.push({ path: f.path, source: 'codex' });
    }
  } catch (e) { debug('team-prompts', e); }
  return out;
}

const fileKey = (path) => createHash('sha256').update(path).digest('hex').slice(0, 16);

export function loadOffsets(dir = userDataDir()) {
  try {
    const o = JSON.parse(readFileSync(promptOffsetsPath(dir), 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch { return null; }
}
const saveOffsets = (o, dir) => writeStateFile(promptOffsetsPath(dir), JSON.stringify(o) + '\n');
export function dropOffsets(dir = userDataDir()) {
  try { rmSync(promptOffsetsPath(dir), { force: true }); } catch (e) { debug('team-prompts', e); }
}

function statOf(path) {
  try { const s = statSync(path); return { size: s.size, ino: s.ino }; } catch { return null; }
}

/** First sight of capture = on: pin every existing file at its current size. */
function initOffsets(files, dir) {
  const o = {};
  for (const f of files) {
    const s = statOf(f.path);
    if (s) o[f.path] = { offset: s.size, size: s.size, ino: s.ino };
  }
  saveOffsets(o, dir);
  return o;
}

/**
 * Read one file from its stored offset to the last complete newline and cut the
 * prompts into chunks. Returns { chunks, end, size, ino } where end is the byte
 * offset just after the last complete line read. chunk = { start, end, prompts }.
 */
function scanFile(file, entry, { maxPrompts, maxBytes }) {
  const s = statOf(file.path);
  if (!s) return null;
  let offset = entry ? entry.offset : 0;
  if (entry && (s.size < entry.offset || (entry.ino && s.ino && entry.ino !== s.ino))) offset = 0; // shrank or rotated
  if (s.size <= offset) return { chunks: [], end: offset, size: s.size, ino: s.ino };
  let fd;
  try {
    fd = openSync(file.path, 'r');
    let win = Math.min(s.size - offset, READ_WINDOW);
    let buf; let last = -1;
    for (;;) {
      buf = Buffer.alloc(win);
      const n = readSync(fd, buf, 0, win, offset);
      buf = buf.subarray(0, n);
      last = buf.lastIndexOf(0x0a);
      if (last >= 0 || offset + win >= s.size || win >= READ_WINDOW_MAX) break;
      win = Math.min(win * 2, s.size - offset); // one very long line: widen the window
    }
    if (last < 0) return { chunks: [], end: offset, size: s.size, ino: s.ino }; // partial last line: wait
    const meta = file.source === 'codex' ? codexMeta(file.path) : null;
    if (meta?.subagent) return { chunks: [], end: offset + last + 1, size: s.size, ino: s.ino };
    const chunks = [];
    let cur = { start: offset, end: offset, prompts: [], chars: 0 };
    let bytes = 0; let total = 0; let pos = 0; let stoppedAt = null;
    let prevText = null;
    while (pos <= last) {
      const nl = buf.indexOf(0x0a, pos);
      const line = buf.toString('utf8', pos, nl);
      const lineStart = offset + pos;
      const lineEnd = offset + nl + 1;
      let pr = null;
      if (line.length > 2) pr = file.source === 'codex' ? codexPromptFromLine(line) : claudePromptFromLine(line);
      if (pr) {
        if (file.source === 'codex') {
          pr.project = meta.project;
          // current rollouts carry both UserMessage and a legacy user_message for one turn
          if (prevText === pr.text) { pos = nl + 1; cur.end = lineEnd; continue; }
          prevText = pr.text;
        }
        const b = Buffer.byteLength(pr.text);
        if (total >= maxPrompts || bytes + b > maxBytes) { stoppedAt = lineStart; break; }
        if (cur.prompts.length >= MAX_CHUNK_PROMPTS || cur.chars + pr.text.length > MAX_CHUNK_CHARS) {
          cur.end = lineStart;
          chunks.push(cur);
          cur = { start: lineStart, end: lineStart, prompts: [], chars: 0 };
        }
        cur.prompts.push(pr);
        cur.chars += pr.text.length;
        bytes += b; total += 1;
      }
      cur.end = lineEnd;
      pos = nl + 1;
    }
    if (stoppedAt !== null) cur.end = stoppedAt;
    if (cur.prompts.length) chunks.push(cur);
    const end = stoppedAt !== null ? stoppedAt : offset + last + 1;
    return { chunks, end, size: s.size, ino: s.ino, stopped: stoppedAt !== null };
  } catch (e) {
    debug('team-prompts', e);
    return null;
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* gone */ }
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Upload what is new. `put(params)` calls the prompt_chunk_put RPC and returns its JSON.
 * Returns { uploaded, chunks, duplicates, capped, off?, error? }.
 */
export async function uploadPrompts({
  put, dir = userDataDir(), claudeDir, codexDir,
  maxPrompts = MAX_RUN_PROMPTS, maxBytes = MAX_RUN_BYTES,
} = {}) {
  const files = await discoverPromptFiles({ claudeDir, codexDir });
  let offsets = loadOffsets(dir);
  if (!offsets) {
    initOffsets(files, dir); // consent boundary: no backfill
    return { uploaded: 0, chunks: 0, duplicates: 0, capped: false, initialized: true };
  }
  const res = { uploaded: 0, chunks: 0, duplicates: 0, capped: false };
  let promptsLeft = maxPrompts; let bytesLeft = maxBytes;
  const withMtime = files.map((f) => ({ ...f, mtime: (() => { try { return statSync(f.path).mtimeMs; } catch { return 0; } })() }))
    .sort((a, b) => a.mtime - b.mtime);
  for (const f of withMtime) {
    if (promptsLeft <= 0 || bytesLeft <= 0) { res.capped = true; break; }
    const entry = offsets[f.path];
    const scan = scanFile(f, entry, { maxPrompts: promptsLeft, maxBytes: bytesLeft });
    if (!scan) continue;
    const restart = entry && (scan.size < entry.offset || (entry.ino && scan.ino && entry.ino !== scan.ino));
    if (restart) { offsets[f.path] = { offset: 0, size: scan.size, ino: scan.ino }; }
    const key = fileKey(f.path);
    for (const c of scan.chunks) {
      let r;
      try {
        r = await put({
          source: f.source, file_key: key, start_offset: c.start, end_offset: c.end,
          prompts: c.prompts.map((p) => ({ at: p.at, project: p.project, text: p.text })),
        });
      } catch (e) {
        if (/prompt capture is off/.test(String(e.message))) { res.off = true; return res; }
        debug('team-prompts', e);
        res.error = e.message;
        saveOffsets(offsets, dir);
        return res;
      }
      const accepted = Number(r?.accepted) || 0;
      if (r?.duplicate) res.duplicates += 1;
      res.uploaded += accepted;
      res.chunks += 1;
      promptsLeft -= c.prompts.length;
      bytesLeft -= Buffer.byteLength(c.prompts.map((p) => p.text).join(''));
      offsets[f.path] = { offset: c.end, size: scan.size, ino: scan.ino };
      saveOffsets(offsets, dir);
    }
    // lines after the last prompt carry nothing to send: move past them without a server call
    if (scan.end > (offsets[f.path]?.offset ?? 0)) {
      offsets[f.path] = { offset: scan.end, size: scan.size, ino: scan.ino };
      saveOffsets(offsets, dir);
    }
    if (scan.stopped || promptsLeft <= 0 || bytesLeft <= 0) res.capped = true;
  }
  return res;
}

/** For `sprag team status --show-payload`: how many prompts wait and the shape of one (never all the text). */
export async function pendingPrompts({ dir = userDataDir(), claudeDir, codexDir } = {}) {
  const offsets = loadOffsets(dir);
  if (!offsets) return { count: 0, example: null, initialized: false };
  const files = await discoverPromptFiles({ claudeDir, codexDir });
  let count = 0; let example = null;
  for (const f of files) {
    const scan = scanFile(f, offsets[f.path], { maxPrompts: Infinity, maxBytes: Infinity });
    if (!scan) continue;
    for (const c of scan.chunks) {
      count += c.prompts.length;
      if (!example && c.prompts.length) {
        const p = c.prompts[0];
        example = { at: p.at, project: p.project, text: p.text.slice(0, 80) };
      }
    }
  }
  return { count, example, initialized: true };
}

export const promptOffsetsExist = (dir = userDataDir()) => existsSync(promptOffsetsPath(dir));
