/**
 * What a Claude Code session is working on, for `sprag bar --json --detail`: the
 * request the user typed, the last text the agent wrote back and its recent tool
 * calls, read from the end of the session transcript.
 *
 * Nothing parses a whole transcript: the tail is read, and a request that is not
 * in the tail is looked for further back in 4 MiB chunks, newest first, parsing
 * only the lines that can hold one. The transcript is an internal Claude Code
 * file, so every read is defensive and none throws. The user's own prompts pass
 * through here, so nothing is logged; the caller decides what it keeps.
 */

import { basename } from 'node:path';
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';

const TRANSCRIPT_TAIL = 256 * 1024;
/** Bytes scanned backwards for a request the tail does not hold, when no earlier snapshot says where to stop. */
export const DEEP_LIMIT = 64 * 1024 * 1024;
const DEEP_CHUNK = 4 * 1024 * 1024;
/** A scan that resumes from an earlier snapshot starts this far before the size it saw: that snapshot may have caught a line half written. */
const RESUME_OVERLAP = 64 * 1024;
const TEXT_MAX = 400;
const TARGET_MAX = 80;
const RECENT_MAX = 12;

/** Blocks the harness injects into a user message; they are not what the user typed. */
const WRAPPER_TAGS = [
  'system-reminder', 'command-name', 'command-message', 'command-args',
  'local-command-stdout', 'local-command-stderr', 'local-command-caveat',
  'task-notification', 'user-prompt-submit-hook', 'pasted_content', 'agent-message', 'teammate-message',
];
const WRAPPER_RE = new RegExp(`<(${WRAPPER_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?</\\1>`, 'g');

/** Collapse whitespace runs and cut to `max` code points, ending a cut text with `…`. */
function tidy(text, max) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : flat;
}

const str = (v) => (typeof v === 'string' ? v : '');
const hostOf = (url) => {
  try { return new URL(url).host || url; } catch { return url; }
};

/**
 * A short label for what a tool call is acting on. '' when there is nothing
 * useful to show, for an unknown tool or an input of an unexpected shape.
 */
export function toolTarget(name, input) {
  if (!input || typeof input !== 'object') return '';
  let target = '';
  switch (name) {
    case 'Bash':
      target = str(input.description) || str(input.command);
      break;
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit': {
      const path = str(input.file_path) || str(input.notebook_path);
      target = path ? basename(path) : '';
      break;
    }
    case 'Grep':
    case 'Glob':
      target = str(input.pattern);
      break;
    case 'Agent':
    case 'Task': {
      const description = str(input.description);
      const type = str(input.subagent_type);
      target = type ? `${description} (${type})` : description;
      break;
    }
    case 'WebSearch':
      target = str(input.query);
      break;
    case 'WebFetch':
      target = hostOf(str(input.url));
      break;
    case 'Skill':
      target = str(input.skill);
      break;
    default:
      return '';
  }
  return tidy(target, TARGET_MAX);
}

const atOf = (entry) => {
  const ms = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

const contentOf = (entry) => entry?.message?.content;

/**
 * What the user typed, from a line that can carry it: a `user` line, or the
 * `queue-operation` line Claude Code writes for a message sent while the agent
 * was working (the matching `remove` line repeats it and does not count).
 * null for tool results, meta lines, context-compaction summaries and messages
 * that hold nothing but harness wrappers.
 */
function promptOf(entry) {
  let text;
  if (entry.type === 'queue-operation') {
    if (entry.operation !== 'enqueue' || typeof entry.content !== 'string') return null;
    text = entry.content;
  } else if (entry.type === 'user') {
    if (entry.isMeta === true || entry.isCompactSummary === true || entry.isVisibleInTranscriptOnly === true) return null;
    const content = contentOf(entry);
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      if (content.some((item) => item?.type === 'tool_result')) return null;
      text = content.filter((item) => item?.type === 'text' && typeof item.text === 'string').map((item) => item.text).join('\n');
    } else {
      return null;
    }
  } else {
    return null;
  }
  const clean = tidy(text.replace(WRAPPER_RE, ' '), TEXT_MAX);
  return clean === '' ? null : clean;
}

function newestPrompt(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const text = promptOf(entries[i]);
    if (text !== null) return { text, at: atOf(entries[i]) };
  }
  return null;
}

function newestReply(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type !== 'assistant' || !Array.isArray(contentOf(e))) continue;
    const texts = contentOf(e).filter((item) => item?.type === 'text' && typeof item.text === 'string' && item.text.trim() !== '').map((item) => item.text);
    if (texts.length) return { text: tidy(texts.join('\n'), TEXT_MAX), at: atOf(e) };
  }
  return null;
}

function recentCalls(entries) {
  const done = new Set();
  const calls = [];
  for (const e of entries) {
    const content = contentOf(e);
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (e.type === 'user' && item?.type === 'tool_result' && typeof item.tool_use_id === 'string') done.add(item.tool_use_id);
      if (e.type === 'assistant' && item?.type === 'tool_use' && typeof item.name === 'string') {
        calls.push({ id: item.id, at: atOf(e), tool: item.name, target: toolTarget(item.name, item.input) });
      }
    }
  }
  return calls.slice(-RECENT_MAX).map(({ id, ...call }) => ({ ...call, pending: !done.has(id) }));
}

function readRange(fd, start, length) {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = readSync(fd, buf, got, length - got, start + got);
    if (n <= 0) break;
    got += n;
  }
  return got === length ? buf : buf.subarray(0, got);
}

/**
 * The newest prompt in bytes [lo, hi) of the file, looking at the newest 4 MiB
 * first. Only lines that can hold a prompt are parsed. A line split by a chunk
 * edge is completed by carrying its start over to the older chunk. `hi` must be
 * the end of a line; `lo` may fall inside one, and that cut line is skipped.
 */
function scanBack(fd, lo, hi, chunkBytes) {
  let end = hi;
  let carry = Buffer.alloc(0);
  while (end > lo) {
    const start = Math.max(lo, end - chunkBytes);
    let buf = Buffer.concat([readRange(fd, start, end - start), carry]);
    carry = Buffer.alloc(0);
    if (start > lo) {
      // The first line of this chunk began in an older one: hold it back.
      const nl = buf.indexOf(0x0a);
      if (nl === -1) { carry = buf; end = start; continue; }
      carry = buf.subarray(0, nl);
      buf = buf.subarray(nl + 1);
    }
    const lines = buf.toString('utf8').split('\n');
    // At `lo` the first line is whole only when lo is the start of the file.
    if (start === lo && lo > 0) lines.shift();
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || !(line.includes('"type":"user"') || line.includes('"type":"queue-operation"'))) continue;
      try {
        const entry = JSON.parse(line);
        if (!entry || typeof entry !== 'object' || entry.isSidechain === true) continue;
        const text = promptOf(entry);
        if (text !== null) return { text, at: atOf(entry) };
      } catch { /* partial or foreign line */ }
    }
    end = start;
  }
  return null;
}

/**
 * The two lines Claude Code writes to name a session in its own picker: the last
 * typed prompt (`last-prompt`, rewritten every turn) and a title it makes from the
 * opening topic (`ai-title`, absent in a brand new session). Only the last
 * `tailBytes` are read, and a line is parsed only when it carries one of the two
 * type markers; the newest of each wins. Never throws.
 *
 * @returns {{ lastPrompt: string|null, aiTitle: string|null }}
 */
export function sessionTitleHints({ transcript, tailBytes = TRANSCRIPT_TAIL } = {}) {
  const out = { lastPrompt: null, aiTitle: null };
  if (typeof transcript !== 'string' || transcript === '') return out;
  let fd;
  try {
    fd = openSync(transcript, 'r');
    const size = fstatSync(fd).size;
    if (size <= 0) return out;
    const tailStart = Math.max(0, size - tailBytes);
    const lines = readRange(fd, tailStart, size - tailStart).toString('utf8').split('\n');
    if (tailStart > 0) lines.shift();
    for (const line of lines) {
      const isPrompt = line.includes('"type":"last-prompt"');
      const isTitle = !isPrompt && line.includes('"type":"ai-title"');
      if (!isPrompt && !isTitle) continue;
      try {
        const entry = JSON.parse(line);
        if (!entry || typeof entry !== 'object') continue;
        if (isPrompt && entry.type === 'last-prompt' && typeof entry.lastPrompt === 'string') out.lastPrompt = entry.lastPrompt;
        if (isTitle && entry.type === 'ai-title' && typeof entry.aiTitle === 'string') out.aiTitle = entry.aiTitle;
      } catch { /* partial or foreign line */ }
    }
    return out;
  } catch {
    return { lastPrompt: null, aiTitle: null };
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* nothing to release */ }
    }
  }
}

/**
 * The newest typed request, the newest text reply and the last 12 tool calls of
 * a transcript. Never throws.
 *
 * Reply and tool calls come from the last `tailBytes`. A request can be older
 * than that (a long run of tool results follows it), so it is looked for further
 * back. `known` is what an earlier snapshot of the same file found, as
 * `{ size, prompt }`: only the bytes written since then are scanned, and the
 * earlier prompt stands when they hold none. Without it the scan goes back up
 * to 64 MiB. `size` in the result is the file size this call saw, for the
 * caller to keep as the next `known`.
 *
 * @returns {{ prompt: { text: string, at: number|null }|null, reply: { text: string, at: number|null }|null,
 *             recent: Array<{ at: number|null, tool: string, target: string, pending: boolean }>, size: number|null }}
 */
export function sessionDetail({
  transcript, tailBytes = TRANSCRIPT_TAIL, known = null, chunkBytes = DEEP_CHUNK, deepLimit = DEEP_LIMIT,
}) {
  const empty = { prompt: null, reply: null, recent: [], size: null };
  if (typeof transcript !== 'string' || transcript === '') return empty;
  let fd;
  try {
    fd = openSync(transcript, 'r');
    const size = fstatSync(fd).size;
    if (size <= 0) return empty;
    const tailStart = Math.max(0, size - tailBytes);
    const tail = readRange(fd, tailStart, size - tailStart);
    const entries = [];
    let lines = tail.toString('utf8').split('\n');
    if (tailStart > 0) lines.shift();
    for (const line of lines) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry && typeof entry === 'object' && entry.isSidechain !== true) entries.push(entry);
      } catch { /* partial or foreign line */ }
    }
    let prompt = newestPrompt(entries);
    if (!prompt && tailStart > 0) {
      // The tail starts inside a line; that line's head is part of the older region.
      const firstNl = tail.indexOf(0x0a);
      const hi = firstNl === -1 ? size : tailStart + firstNl + 1;
      const resumable = known && Number.isFinite(known.size) && known.size <= size;
      const lo = resumable ? Math.max(0, known.size - RESUME_OVERLAP) : Math.max(0, tailStart - deepLimit);
      if (lo < hi) prompt = scanBack(fd, lo, hi, chunkBytes);
      if (!prompt && resumable) prompt = known.prompt ?? null;
    }
    return { prompt, reply: newestReply(entries), recent: recentCalls(entries), size };
  } catch {
    return empty;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* nothing to release */ }
    }
  }
}
