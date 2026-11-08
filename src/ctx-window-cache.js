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
 * The payload's model id (`model.id`) is stored beside the size. The briefing
 * reads it back to look up the session's own `modelSettings` entry, which a
 * settings-only lookup cannot see when the model was picked with `/model`.
 *
 * State: <stateDir>/ctx-window.json
 *   { sessions: { [session_id]: { size, ts, model? } } }
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
export function recordLiveWindow(sessionId, size, now = Date.now(), model = null) {
  if (typeof sessionId !== 'string' || sessionId === '' || !validSize(size)) return false;
  const m = typeof model === 'string' && model !== '' ? model : undefined;
  const state = load();
  const prev = state.sessions[sessionId];
  if (prev && prev.size === size && prev.model === m && now - prev.ts < REFRESH_MS) return false;
  state.sessions[sessionId] = m ? { size, ts: now, model: m } : { size, ts: now };
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

/**
 * The window most recently reported by any session's statusline, or null.
 * `sprag compact-window` runs outside a session and has no payload of its own;
 * judged by the settings model id alone, a bare `opus` (1M by default on Opus
 * 5.5, with no `[1m]` suffix) read as 200k while the statusline said 1M.
 */
function latestEntry() {
  let best = null;
  for (const s of Object.values(load().sessions)) {
    if (s && validSize(s.size) && Number.isFinite(s.ts) && (!best || s.ts > best.ts)) best = s;
  }
  return best;
}

export function latestLiveWindow() {
  const best = latestEntry();
  return best ? best.size : null;
}

/**
 * Every recorded window with the model its session reported, newest first.
 * A session that has not rendered a statusline yet borrows the window another
 * session reported for the same model (brief.js ctxWindowFor): Claude Code
 * runs some models at 1M by default with no `[1m]` in the id, and only its
 * own report says so.
 */
export function liveWindowsByModel() {
  return Object.values(load().sessions)
    .filter((s) => s && validSize(s.size) && Number.isFinite(s.ts) && typeof s.model === 'string' && s.model !== '')
    .sort((a, b) => b.ts - a.ts)
    .map((s) => ({ model: s.model, size: s.size, ts: s.ts }));
}

/** The model id a session's statusline payload reported, or null. */
export function liveModelFor(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return null;
  const s = load().sessions[sessionId];
  return s && typeof s.model === 'string' && s.model !== '' ? s.model : null;
}

/** The model id of the most recently reported session (same pick as latestLiveWindow), or null. */
export function latestLiveModel() {
  const best = latestEntry();
  return best && typeof best.model === 'string' && best.model !== '' ? best.model : null;
}
