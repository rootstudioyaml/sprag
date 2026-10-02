/**
 * The caps of the delegation rule the current prompt matched, kept per session
 * so the PreToolUse guard can state the same numbers the rule does.
 *
 * The prompt hook tells the main model "delegate, cap 6,100 output tokens" from
 * the rule's calibrated budget. The guard then rewrote the Task prompt with its
 * own fixed pair (8 calls / 1,500 tokens for haiku, 20 / 8,000 otherwise), so
 * the subagent was held to a different limit than the one the main model had
 * just been given. The guard sees only the Task call, not the user prompt that
 * matched the rule, so the prompt hook leaves the matched caps here for it.
 *
 * One record per session, replaced by every prompt: a prompt that matches no
 * rule clears it, so a cap never outlives the turn it was stated for.
 *
 * State: <stateDir>/route-caps.json
 *   { sessions: { [session_id]: { ts, T2?: { calls, out }, T1?: { calls, out } } } }
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';

// A turn that is still delegating this long after its prompt is unusual; past
// it the record is treated as left over from a session that ended mid-turn.
const TTL_MS = 60 * 60 * 1000;
const PRUNE_MS = 24 * 60 * 60 * 1000;

export function routeCapsPath() {
  return join(userDataDir(), 'route-caps.json');
}

function load() {
  try {
    const s = JSON.parse(readFileSync(routeCapsPath(), 'utf8'));
    return s && s.sessions && typeof s.sessions === 'object' && !Array.isArray(s.sessions) ? s : { sessions: {} };
  } catch {
    return { sessions: {} };
  }
}

const validBudget = (b) => b && Number.isFinite(b.out) && b.out > 0;

/**
 * Record the caps this prompt's rule match carries, or clear the session's
 * record when `caps` is null. Writes nothing when there is nothing to change.
 */
export function recordRouteCaps(sessionId, caps, now = Date.now()) {
  if (typeof sessionId !== 'string' || sessionId === '') return false;
  const state = load();
  const next = {};
  for (const tier of ['T2', 'T1']) {
    if (validBudget(caps?.[tier])) next[tier] = { calls: caps[tier].calls ?? null, out: caps[tier].out };
  }
  const has = Object.keys(next).length > 0;
  if (!has && !state.sessions[sessionId]) return false;
  if (has) state.sessions[sessionId] = { ts: now, ...next };
  else delete state.sessions[sessionId];
  for (const [id, s] of Object.entries(state.sessions)) {
    if (!s || !Number.isFinite(s.ts) || now - s.ts > PRUNE_MS) delete state.sessions[id];
  }
  writeStateFile(routeCapsPath(), JSON.stringify(state) + '\n');
  return true;
}

/** The caps recorded for this session's current turn, or null. */
export function routeCapsFor(sessionId, now = Date.now()) {
  if (typeof sessionId !== 'string' || sessionId === '') return null;
  const s = load().sessions[sessionId];
  if (!s || !Number.isFinite(s.ts) || now - s.ts > TTL_MS) return null;
  const out = {};
  for (const tier of ['T2', 'T1']) if (validBudget(s[tier])) out[tier] = s[tier];
  return Object.keys(out).length ? out : null;
}
