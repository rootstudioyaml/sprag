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
 * Several Agent calls in one response start several hook processes at once, so
 * the queue needs no lock: each entry is its own file in
 * `<dir>/subagent-context/`, written as a temp file and renamed into place, and
 * a take claims an entry by renaming it away, which only one process can win.
 * An entry is therefore delivered at most once, and one process's write cannot
 * drop another's entry. The hook paths must never fail a delegation, so every
 * function swallows its errors.
 */

import { readFileSync, readdirSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { writeViaTmp } from './state-file.js';

/** An entry older than this belongs to a delegation that never started a subagent. */
export const SUBAGENT_CONTEXT_TTL_MS = 120_000;
/** Newest entries kept. A burst of parallel delegations stays well under this. */
export const SUBAGENT_CONTEXT_MAX = 20;

const DIR_NAME = 'subagent-context';
/** The single-file queue an older version kept; nothing reads it any more. */
const OLD_FILE_NAME = 'subagent-context.json';
const ENTRY_NAME = /^(\d{15})-\d+-[0-9a-f]{8}\.json$/;
const TAKEN_MARK = '.taken-';

const queueDir = (dir) => join(dir, DIR_NAME);
const rand = () => randomBytes(4).toString('hex');
const rmQuiet = (file) => { try { unlinkSync(file); } catch { /* already gone */ } };

/** The `at` encoded in a queue file name (entry or claimed), or null when the name does not parse. */
function nameAt(name) {
  const m = /^(\d{15})-/.exec(name);
  return m ? Number(m[1]) : null;
}

const expired = (name, now) => {
  const at = nameAt(name);
  return at === null || now - at > SUBAGENT_CONTEXT_TTL_MS;
};

const list = (dir) => {
  try { return readdirSync(queueDir(dir)); } catch { return []; }
};

/**
 * Delete expired files (a name that does not parse counts as expired, claimed
 * leftovers included), then the oldest entries beyond the cap.
 */
function prune(dir, now) {
  const base = queueDir(dir);
  const live = [];
  for (const name of list(dir).sort()) {
    if (expired(name, now)) rmQuiet(join(base, name));
    else if (ENTRY_NAME.test(name)) live.push(name);
  }
  for (const name of live.slice(0, Math.max(0, live.length - SUBAGENT_CONTEXT_MAX))) rmQuiet(join(base, name));
}

/** An entry file's parsed body, or null when it is unreadable or malformed. */
function readEntry(file) {
  try {
    const e = JSON.parse(readFileSync(file, 'utf8'));
    if (e && typeof e === 'object' && typeof e.session === 'string' && typeof e.type === 'string'
      && typeof e.text === 'string' && Number.isFinite(e.at)) return e;
  } catch { /* unreadable reads as no entry */ }
  return null;
}

/**
 * Park `entry` ({ session, type, text, at? }) for the SubagentStart hook.
 * Returns true when it was written, false on any failure.
 */
export function enqueueSubagentContext(entry, { dir = userDataDir(), now = Date.now() } = {}) {
  try {
    if (!entry || typeof entry.session !== 'string' || !entry.session
      || typeof entry.type !== 'string' || typeof entry.text !== 'string' || !entry.text) return false;
    const at = Number.isFinite(entry.at) && entry.at >= 0 ? Math.floor(entry.at) : now;
    const base = queueDir(dir);
    mkdirSync(base, { recursive: true });
    const name = `${String(at).padStart(15, '0')}-${process.pid}-${rand()}.json`;
    const body = JSON.stringify({ session: entry.session, type: entry.type, at, text: entry.text }) + '\n';
    // The temp name keeps the `at` prefix, so prune treats it like any file of
    // this time and never deletes a write that is still in flight.
    writeViaTmp(join(base, `${name}.tmp`), join(base, name), body);
    prune(dir, now);
    rmQuiet(join(dir, OLD_FILE_NAME));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove and return the oldest live entry for this session and agent type, or
 * null. Nothing is written when there is no match, so a resumed subagent (which
 * never had an entry) costs one directory read.
 */
export function takeSubagentContext({ session, type }, { dir = userDataDir(), now = Date.now() } = {}) {
  try {
    if (typeof session !== 'string' || !session || typeof type !== 'string' || !type) return null;
    const base = queueDir(dir);
    for (const name of list(dir).sort()) {
      if (!ENTRY_NAME.test(name)) continue;
      const file = join(base, name);
      if (expired(name, now)) { rmQuiet(file); continue; }
      const entry = readEntry(file);
      if (!entry || entry.session !== session || entry.type !== type) continue;
      // The rename is the claim: of two processes after the same file, one gets
      // ENOENT and moves on to the next candidate.
      const claimed = `${file}${TAKEN_MARK}${process.pid}-${rand()}`;
      try { renameSync(file, claimed); } catch { continue; }
      const mine = readEntry(claimed) || entry;
      rmQuiet(claimed);
      return mine;
    }
    return null;
  } catch {
    return null;
  }
}
