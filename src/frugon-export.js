/**
 * frugon export — convert Claude Code session transcripts into the
 * OpenAI-compatible JSONL log format frugon analyzes.
 * (frugon: local LLM cost analyzer — github.com/Rodiun/frugon)
 *
 * One output line per API call:
 *   {
 *     "model": "claude-opus-4-8",
 *     "timestamp": "2026-07-12T02:11:05.123Z",
 *     "usage": { "prompt_tokens": 1234, "completion_tokens": 56 },
 *     "request": { "messages": [ ...stubs..., { "role": "user", "content": "<last user prompt>" } ] },
 *     "response": { "choices": [ { "message": { "role": "assistant", "content": "<reply>" } } ] }
 *   }
 *
 * Design notes (kept in sync with frugon 0.2.x internals):
 *  - frugon prefers the usage block for token counts, so message content is
 *    never re-tokenized — stubs with empty content are safe.
 *  - frugon's easy/hard difficulty score reads prompt_tokens, completion_tokens
 *    and conversation depth (len(messages) - 1, saturating at 6 turns). We emit
 *    up to MAX_STUB_MESSAGES role-alternating stubs so depth survives the
 *    export without duplicating the whole conversation into every record.
 *  - frugon has no notion of prompt caching: every prompt token is priced at
 *    the base input rate. Claude Code sessions are cache-read heavy (~90%+),
 *    so raw totals would overstate spend ~10x. By default we fold Anthropic's
 *    cache multipliers (5m write 1.25x, 1h write 2x, read 0.1x) into an
 *    "effective" prompt_tokens so frugon's dollar figures match reality.
 *    Pass cacheWeighted: false for raw physical token counts.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { discoverSessionFiles } from './parser.js';

// Depth cap: frugon's turn signal saturates at 6 turns (len(messages)-1 >= 6),
// so 7 messages carry the maximum-depth signal at minimum size.
const MAX_STUB_MESSAGES = 7;

// Anthropic cache multipliers relative to the base input rate — uniform
// across model tiers (see src/cost.js PRICING).
const CACHE_WEIGHTS = { write5m: 1.25, write1h: 2, read: 0.1 };

/** Strip context-window suffixes like "[1m]" so frugon's pricing table matches. */
export function normalizeModelId(model) {
  return String(model || 'unknown').replace(/\[[^\]]*\]$/, '');
}

/**
 * Effective prompt tokens: what the call *costs* expressed in base-rate
 * input tokens, so frugon (which prices all prompt tokens at the input rate)
 * reproduces the real cache-discounted spend.
 */
export function effectivePromptTokens(r) {
  const tracked = (r.ephemeral5mTokens || 0) + (r.ephemeral1hTokens || 0);
  const untracked = Math.max(0, (r.cacheCreationTokens || 0) - tracked);
  return Math.round(
    (r.inputTokens || 0) +
    ((r.ephemeral5mTokens || 0) + untracked) * CACHE_WEIGHTS.write5m +
    (r.ephemeral1hTokens || 0) * CACHE_WEIGHTS.write1h +
    (r.cacheReadTokens || 0) * CACHE_WEIGHTS.read,
  );
}

/** Raw physical prompt tokens (input + cache writes + cache reads). */
export function rawPromptTokens(r) {
  return (r.inputTokens || 0) + (r.cacheCreationTokens || 0) + (r.cacheReadTokens || 0);
}

/** Extract plain text from a Claude transcript message content field. */
function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Parse one session transcript into frugon records.
 * Deduplicates by requestId (last-write-wins, matching parser.js) while
 * tracking the conversation depth and last user prompt at each call.
 */
export async function collectSessionRecords(filePath, { cacheWeighted = true, includeContent = true } = {}) {
  const records = new Map();
  let depth = 0;
  let lastUserText = '';

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const msg = entry.message;
    if (entry.type === 'user' && msg) {
      depth += 1;
      const text = contentText(msg.content);
      if (text) lastUserText = text;
      continue;
    }
    if (entry.type !== 'assistant' || !msg) continue;
    depth += 1;

    if (!msg.usage || !msg.id) continue;
    // "<synthetic>" is Claude Code's placeholder for locally-generated
    // entries (e.g. error stubs) — no real API call, nothing to price.
    if (msg.model === '<synthetic>') continue;
    const usage = msg.usage;
    const reqId = entry.requestId || msg.id;
    const r = {
      inputTokens: usage.input_tokens || 0,
      cacheCreationTokens: usage.cache_creation_input_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
      ephemeral5mTokens: usage.cache_creation?.ephemeral_5m_input_tokens || 0,
      ephemeral1hTokens: usage.cache_creation?.ephemeral_1h_input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
    };

    records.set(reqId, {
      model: normalizeModelId(msg.model),
      timestamp: entry.timestamp || null,
      prompt_tokens: cacheWeighted ? effectivePromptTokens(r) : rawPromptTokens(r),
      completion_tokens: r.outputTokens,
      depth,
      userText: includeContent ? lastUserText : '',
      assistantText: includeContent ? contentText(msg.content) : '',
    });
  }

  return [...records.values()];
}

/** Build the frugon JSONL object for one collected record. */
export function toFrugonRecord(rec) {
  const msgCount = Math.max(1, Math.min(rec.depth, MAX_STUB_MESSAGES));
  const messages = [];
  for (let i = 0; i < msgCount - 1; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: '' });
  }
  messages.push({ role: 'user', content: rec.userText || '' });

  const out = {
    model: rec.model,
    request: { messages },
    response: {
      choices: [{ message: { role: 'assistant', content: rec.assistantText || '' } }],
    },
    usage: {
      prompt_tokens: rec.prompt_tokens,
      completion_tokens: rec.completion_tokens,
    },
  };
  if (rec.timestamp) out.timestamp = rec.timestamp;
  return out;
}

/**
 * Export Claude Code transcripts to a frugon-compatible JSONL file.
 *
 * @param {object} options
 *   days           lookback window (default 30)
 *   projectFilter  substring match on the project dir name
 *   outPath        output JSONL path
 *   cacheWeighted  fold cache pricing into prompt_tokens (default true)
 *   includeContent include user prompt / assistant reply text (default true)
 * @returns {Promise<{records:number, sessions:number, models:Object, outPath:string}>}
 */
export async function exportFrugonLogs({
  days = 30,
  projectFilter,
  outPath,
  cacheWeighted = true,
  includeContent = true,
} = {}) {
  const files = await discoverSessionFiles({ days, projectFilter });
  const models = {};
  let recordCount = 0;
  let sessionCount = 0;

  const stream = createWriteStream(outPath, { encoding: 'utf8' });
  for (const f of files) {
    let recs;
    try {
      recs = await collectSessionRecords(f.path, { cacheWeighted, includeContent });
    } catch {
      continue;
    }
    if (recs.length === 0) continue;
    sessionCount += 1;
    for (const rec of recs) {
      stream.write(JSON.stringify(toFrugonRecord(rec)) + '\n');
      models[rec.model] = (models[rec.model] || 0) + 1;
      recordCount += 1;
    }
  }
  await new Promise((resolve, reject) => {
    stream.end((err) => (err ? reject(err) : resolve()));
  });

  return { records: recordCount, sessions: sessionCount, models, outPath };
}
