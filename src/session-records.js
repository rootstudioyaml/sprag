/**
 * session-records — parse a Claude Code session transcript into per-API-call
 * records (model, tokens, depth, triggering user prompt, session cwd).
 *
 * This is the shared substrate for episode-level analysis (route-scan and the
 * 3.x tier-classification work): one record per API call, deduplicated by
 * requestId (last-write-wins, matching parser.js).
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** Strip context-window suffixes like "[1m]" so model ids compare cleanly. */
export function normalizeModelId(model) {
  return String(model || 'unknown').replace(/\[[^\]]*\]$/, '');
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
 * Parse one session transcript into call records.
 * @returns {Promise<Array<{model, timestamp, prompt_tokens, completion_tokens, depth, userText, assistantText, cwd}>>}
 */
export async function collectSessionRecords(filePath, { includeContent = true } = {}) {
  const records = new Map();
  let depth = 0;
  let lastUserText = '';
  let lastCwd = '';

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
    if (typeof entry.cwd === 'string' && entry.cwd) lastCwd = entry.cwd;
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
    // entries (e.g. error stubs) — no real API call, nothing to record.
    if (msg.model === '<synthetic>') continue;
    const usage = msg.usage;
    const reqId = entry.requestId || msg.id;

    records.set(reqId, {
      model: normalizeModelId(msg.model),
      timestamp: entry.timestamp || null,
      prompt_tokens:
        (usage.input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0) +
        (usage.cache_read_input_tokens || 0),
      completion_tokens: usage.output_tokens || 0,
      depth,
      userText: includeContent ? lastUserText : '',
      assistantText: includeContent ? contentText(msg.content) : '',
      cwd: lastCwd,
    });
  }

  return [...records.values()];
}
