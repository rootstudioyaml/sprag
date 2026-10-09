'use strict';

/**
 * reply-language — catches an English reply to a Korean prompt.
 *
 * The model sometimes answers a Korean prompt in English, typically right
 * after a long stretch of English work (commit messages, release notes). The
 * slip is decidable by counting letters, so it gets a Stop hook instead of
 * another sentence in the guidance.
 *
 * The thresholds were measured on 2,204 Korean-prompt turns from 14 days of
 * real transcripts: 8 flagged, all 8 true positives, no false positives.
 * Loosening any of them reopens false positives on replies that are Korean
 * prose around code and English identifiers, so change them only with a new
 * measurement.
 *
 * CommonJS, no dependencies: this runs on every Stop, so it must stay cheap.
 */

const { openSync, readSync, fstatSync, closeSync } = require('node:fs');

// Only the tail of the transcript matters, and transcripts grow to hundreds
// of megabytes. If the last real prompt is further back than this, the turn is
// a long agentic run and we skip it rather than pay for reading it all.
const TAIL_BYTES = 2 * 1024 * 1024;

const ENGLISH_REQUESTED = /영어로|영문으로|in English/i;

// A user entry that is not something the person typed.
const NOT_A_PROMPT_PREFIX = ['<command-name', '<local-command', '<command-message', '<task-notification', 'Caveat:'];

/**
 * Strip what is legitimately not prose in the reader's language: injected
 * reminders, code, URLs and paths. Code and paths are Latin by nature, so
 * counting them would flag every Korean reply that quotes a command.
 */
function cleanText(t) {
  return String(t ?? '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(?:~|\.{0,2})?\/[\w.\-/]+/g, ' ');
}

function letterCounts(text) {
  const cleaned = cleanText(text);
  const h = (cleaned.match(/[가-힣]/g) || []).length;
  const l = (cleaned.match(/[A-Za-z]/g) || []).length;
  return { h, l, ratio: h + l === 0 ? 0 : h / (h + l) };
}

function isKoreanPrompt(text) {
  const { h, ratio } = letterCounts(text);
  return h >= 4 && ratio >= 0.3;
}

function isEnglishReply(text) {
  const { l, ratio } = letterCounts(text);
  return l >= 80 && ratio < 0.15;
}

function textBlocks(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/**
 * The text of a real user prompt, or null when the entry is a tool result, a
 * meta entry, or machinery posing as a user message.
 */
function realPromptText(entry) {
  if (entry.type !== 'user' || entry.isMeta) return null;
  const content = entry.message?.content;
  if (Array.isArray(content) && content.some((b) => b && b.type === 'tool_result')) return null;
  if (typeof content !== 'string' && !Array.isArray(content)) return null;
  const text = textBlocks(content);
  const head = text.trimStart();
  if (NOT_A_PROMPT_PREFIX.some((p) => head.startsWith(p))) return null;
  if (text.includes('[Subagent hand-back]') || text.includes('<agent-message')) return null;
  return text;
}

/**
 * The last turn in a list of JSONL lines: the final real user prompt and the
 * assistant text the user sees after it. A tool_result resets the reply,
 * because text written before a tool call is narration, not the answer.
 * Returns null when there is no prompt. Unparsable lines and sidechain
 * (subagent) entries are skipped.
 */
function lastTurn(lines) {
  let prompt = null;
  let reply = [];
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object' || entry.isSidechain) continue;
    if (entry.type === 'user') {
      const content = entry.message?.content;
      if (Array.isArray(content) && content.some((b) => b && b.type === 'tool_result')) {
        reply = [];
        continue;
      }
      const text = realPromptText(entry);
      if (text !== null) {
        prompt = text;
        reply = [];
      }
    } else if (entry.type === 'assistant') {
      const text = textBlocks(entry.message?.content);
      if (text) reply.push(text);
    }
  }
  if (prompt === null) return null;
  return { prompt, reply: reply.join('\n') };
}

function readTailLines(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, start + got);
      if (n <= 0) break;
      got += n;
    }
    const lines = buf.subarray(0, got).toString('utf8').split('\n');
    // A window that starts mid-file begins inside a line, so drop that stub.
    if (start > 0) lines.shift();
    return lines;
  } finally {
    closeSync(fd);
  }
}

/**
 * null when the reply is fine (or cannot be judged), otherwise the measured
 * ratios so a caller can report them. Never throws.
 */
function checkReplyLanguage(transcriptPath) {
  try {
    if (!transcriptPath) return null;
    const turn = lastTurn(readTailLines(transcriptPath));
    if (!turn) return null;
    if (ENGLISH_REQUESTED.test(turn.prompt)) return null;
    if (!isKoreanPrompt(turn.prompt) || !isEnglishReply(turn.reply)) return null;
    const u = letterCounts(turn.prompt);
    const r = letterCounts(turn.reply);
    return { userHangulRatio: u.ratio, replyHangulRatio: r.ratio, replyLatin: r.l };
  } catch {
    return null;
  }
}

module.exports = { checkReplyLanguage, cleanText, isKoreanPrompt, isEnglishReply, lastTurn };
