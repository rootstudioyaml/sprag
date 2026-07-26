/**
 * Claude Code's statusline contract feeds this tool a JSON blob on stdin every
 * refresh. These helpers own reading and interpreting that payload; everything
 * else in the CLI takes the extracted values.
 */

import { readFileSync } from 'node:fs';

/**
 * Read the JSON blob Claude Code feeds the statusline command on stdin.
 * Returns null when stdin is a TTY or empty (e.g. user invokes `--statusline`
 * by hand) so callers can fall back to flag/env config.
 *
 * The blob shape (subset we consume):
 *   {
 *     "transcript_path": "...",
 *     "rate_limits": {
 *       "five_hour":  { "used_percentage": 94, "resets_at": 1777099200 },
 *       "seven_day":  { "used_percentage": 7,  "resets_at": 1777521600 }
 *     }
 *   }
 *
 * extractCaps treats `rate_limits` as a generic object so any future window
 * Anthropic adds (e.g. a Sonnet-only weekly bucket) flows through without code
 * changes — known keys get curated labels, unknowns get derived ones.
 */
export function readStdinJson() {
  if (process.stdin.isTTY) return null;
  try {
    const raw = readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function extractCaps(stdinJson) {
  if (!stdinJson || !stdinJson.rate_limits || typeof stdinJson.rate_limits !== 'object') return null;
  const windows = [];
  for (const [key, value] of Object.entries(stdinJson.rate_limits)) {
    if (!value || typeof value !== 'object') continue;
    const usedPct = Number(value.used_percentage);
    if (!Number.isFinite(usedPct)) continue;
    const resetsAt = Number(value.resets_at);
    windows.push({
      key,
      usedPct,
      resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
    });
  }
  return windows.length ? { windows } : null;
}

/**
 * Pull the human-friendly model name out of Claude Code's stdin payload.
 * `model.display_name` is the contract; fall back to `model.id` when it's
 * absent. Returns null when nothing usable is in the JSON.
 */
// Bedrock/litellm proxies pass model IDs like
//   global.anthropic.claude-opus-4-7-20251001-v1:0
//   anthropic.claude-sonnet-4-6-20250930-v1:0
//   bedrock/anthropic.claude-haiku-4-5
// while Claude Code's `display_name` collapses these to a generic family
// label ("Opus 4", "Sonnet 4") that hides the actual minor version. Pull the
// version out of the id when we can spot it so the statusline shows the real
// model in use (Opus 4.7 vs 4.6 matters a lot for token budgeting).
export function bedrockDisplayFromId(id) {
  if (typeof id !== 'string') return null;
  const m = id.match(/claude[-_](opus|sonnet|haiku)[-_](\d+)[-_](\d+)/i);
  if (!m) return null;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  return `${family} ${m[2]}.${m[3]}`;
}

/**
 * Live context usage from Claude Code's stdin payload (`context_window`).
 * More accurate than inferring from transcripts: it's the CURRENT session's
 * real fill level, updated every refresh. Shape (subset):
 *   "context_window": { "context_window_size": 200000, "used_percentage": 68 }
 */
export function extractContextUsage(stdinJson) {
  const cw = stdinJson && stdinJson.context_window;
  if (!cw || typeof cw !== 'object') return null;
  const usedPct = Number(cw.used_percentage);
  const size = Number(cw.context_window_size);
  if (!Number.isFinite(usedPct)) return null;
  return {
    usedPct,
    size: Number.isFinite(size) && size > 0 ? size : null,
  };
}

export function extractModel(stdinJson) {
  if (!stdinJson || !stdinJson.model) return null;
  const m = stdinJson.model;
  if (typeof m === 'string') return bedrockDisplayFromId(m) || m;
  // Prefer the id when it carries a precise version (e.g. Bedrock IDs); fall
  // back to display_name for the standard Claude Code path where display_name
  // already says "Claude Opus 4.7".
  const idDerived = bedrockDisplayFromId(m.id);
  if (idDerived) return idDerived;
  if (typeof m.display_name === 'string' && m.display_name) return m.display_name;
  if (typeof m.id === 'string' && m.id) return m.id;
  return null;
}
