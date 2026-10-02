/**
 * The context window Claude Code reports for each session.
 *
 * Only the statusline payload carries it (`context_window.context_window_size`).
 * The UserPromptSubmit hook gets a session id and a transcript path, so the
 * briefing used to guess the window from the configured model id, and a model
 * that is 1M without a `[1m]` suffix was judged against 200k: the 80% warning
 * fired at 160k while the statusline of the same session said "Ctx 1M". The
 * statusline records the size it was given here, and the briefing reads it back
 * by session id before it falls back to guessing.
 *
 * State: <stateDir>/ctx-window.json
 *   { sessions: { [session_id]: { size, ts } } }
 * Entries untouched for 7 days are pruned on write.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';

const PRUNE_MS = 7 * 24 * 60 * 60 * 1000;
// The statusline renders every few seconds. An unchanged size is rewritten only
// this often, which is enough to keep a long session's entry from being pruned.
const REFRESH_MS = 24 * 60 * 60 * 1000;

export function ctxWindowCachePath() {
  return join(userDataDir(), 'ctx-window.json');
}

function load() {
  try {
    const s = JSON.parse(readFileSync(ctxWindowCachePath(), 'utf8'));
    return s && s.sessions && typeof s.sessions === 'object' && !Array.isArray(s.sessions) ? s : { sessions: {} };
  } catch {
    return { sessions: {} };
  }
}

const validSize = (size) => Number.isFinite(size) && size > 0;

/** Record the window the statusline payload reported. Returns true when the file was written. */
export function recordLiveWindow(sessionId, size, now = Date.now()) {
  if (typeof sessionId !== 'string' || sessionId === '' || !validSize(size)) return false;
  const state = load();
  const prev = state.sessions[sessionId];
  if (prev && prev.size === size && now - prev.ts < REFRESH_MS) return false;
  state.sessions[sessionId] = { size, ts: now };
  for (const [id, s] of Object.entries(state.sessions)) {
    if (!s || !Number.isFinite(s.ts) || now - s.ts > PRUNE_MS) delete state.sessions[id];
  }
  writeStateFile(ctxWindowCachePath(), JSON.stringify(state) + '\n');
  return true;
}

/** The recorded window for a session, or null when the statusline never reported one. */
export function liveWindowFor(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return null;
  const s = load().sessions[sessionId];
  return s && validSize(s.size) ? s.size : null;
}
