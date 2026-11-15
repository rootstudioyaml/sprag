/**
 * subagent-context — a small hand-off queue between two hooks.
 *
 * In Claude Code's auto mode a PreToolUse hook that returns `updatedInput`
 * without a permission decision gets the call denied ("a hook changed this
 * call's input after auto mode reviewed it"), and the model has to send the
 * same delegation again. The delegation guard therefore cannot append its
 * appendix to the prompt there. It parks the text here instead, and the
 * SubagentStart hook (`sprag delegate --subagent-start`) hands it to the
 * subagent as additionalContext.
 *
 * SubagentStart does not receive the prompt, only the session id and the agent
 * type, so the two sides meet on that pair. The oldest entry for the pair wins:
 * two delegations of one type in a row start in the order they were sent.
 *
 * The file is shared state between short-lived hook processes. Nothing here
 * takes a lock; a lost update costs one subagent its appendix, and the hook
 * paths must never fail a delegation, so every function swallows its errors.
 */

import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { writeViaTmp } from './state-file.js';

/** An entry older than this belongs to a delegation that never started a subagent. */
export const SUBAGENT_CONTEXT_TTL_MS = 120_000;
/** Newest entries kept. A burst of parallel delegations stays well under this. */
export const SUBAGENT_CONTEXT_MAX = 20;

const FILE_NAME = 'subagent-context.json';

const queueFile = (dir) => join(dir, FILE_NAME);

/** The entries still worth delivering, oldest first. Unreadable or malformed means empty. */
function readEntries(dir, now) {
  let raw;
  try {
    raw = readFileSync(queueFile(dir), 'utf8');
  } catch {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed?.entries) ? parsed.entries : [];
  return list
    .filter((e) => e && typeof e === 'object'
      && typeof e.session === 'string' && typeof e.type === 'string'
      && typeof e.text === 'string' && Number.isFinite(e.at)
      && now - e.at <= SUBAGENT_CONTEXT_TTL_MS)
    .sort((a, b) => a.at - b.at)
    .slice(-SUBAGENT_CONTEXT_MAX);
}

function writeEntries(dir, entries) {
  mkdirSync(dir, { recursive: true });
  const file = queueFile(dir);
  writeViaTmp(`${file}.${process.pid}.tmp`, file, JSON.stringify({ entries }) + '\n');
}

/**
 * Park `entry` ({ session, type, text, at? }) for the SubagentStart hook.
 * Returns true when it was written, false on any failure.
 */
export function enqueueSubagentContext(entry, { dir = userDataDir(), now = Date.now() } = {}) {
  try {
    if (!entry || typeof entry.session !== 'string' || !entry.session
      || typeof entry.type !== 'string' || typeof entry.text !== 'string' || !entry.text) return false;
    const at = Number.isFinite(entry.at) ? entry.at : now;
    const entries = readEntries(dir, now);
    entries.push({ session: entry.session, type: entry.type, at, text: entry.text });
    writeEntries(dir, entries.sort((a, b) => a.at - b.at).slice(-SUBAGENT_CONTEXT_MAX));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove and return the oldest live entry for this session and agent type, or
 * null. Nothing is written when there is no match, so a resumed subagent (which
 * never had an entry) costs one read.
 */
export function takeSubagentContext({ session, type }, { dir = userDataDir(), now = Date.now() } = {}) {
  try {
    if (typeof session !== 'string' || !session || typeof type !== 'string' || !type) return null;
    const entries = readEntries(dir, now);
    const i = entries.findIndex((e) => e.session === session && e.type === type);
    if (i < 0) return null;
    const [entry] = entries.splice(i, 1);
    // A failed write still delivers: the subagent getting its appendix matters
    // more than the rare double delivery a stale entry could cause later (the
    // TTL ends that within two minutes).
    try { writeEntries(dir, entries); } catch { /* deliver anyway */ }
    return entry;
  } catch {
    return null;
  }
}
