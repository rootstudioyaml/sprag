/**
 * grade-counts — how often the delegation grade acted on a call.
 *
 * The guard (delegation-guard.js) raises a judgement delegation to Opus under
 * either grade. Each raise counts once here, and the statusline shows the
 * number as `model↑N`.
 *
 * File: <userDataDir>/delegation-grade-counts.json
 *   { "version": 1, "raised": 3, "since": <ms> }
 *
 * An earlier version also counted held calls in a `blocked` field. That field
 * is ignored on read and dropped on the next write, so an old file still loads.
 *
 * `since` is when the counting window opened: the first count after the last
 * routing reset. The reset mark is the same one the effort-raise ledger and
 * Routing saved read, so `sprag saved reset` zeroes all three together. The
 * counts are not evidence the way a ledger is, so a reset restarts the file
 * the next time it is written, and a read before that treats a window that
 * opened before the mark as empty.
 *
 * The write happens inside a PreToolUse hook, so it is best effort: nothing
 * throws, and two hooks racing can lose a count, which a display figure
 * tolerates.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';
import { readResetMarks, isBeforeReset } from './saved-reset.cjs';

export const GRADE_COUNTS_VERSION = 1;

export function gradeCountsPath(dir = userDataDir()) {
  return join(dir, 'delegation-grade-counts.json');
}

function readCounts(dir) {
  try {
    const data = JSON.parse(readFileSync(gradeCountsPath(dir), 'utf8'));
    if (!data || data.version !== GRADE_COUNTS_VERSION) return null;
    const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    return { raised: n(data.raised), since: Number.isFinite(data.since) ? data.since : null };
  } catch {
    return null;
  }
}

/**
 * Count one action: 'raised' (sent to Opus). Returns the new counts, or null
 * when nothing could be written.
 */
export function recordGradeAction(action, { dir = userDataDir(), now = Date.now() } = {}) {
  if (action !== 'raised') return null;
  try {
    const mark = readResetMarks(dir).routing;
    let counts = readCounts(dir);
    // A window that opened before the reset mark is the old count: start over.
    if (!counts || counts.since === null || isBeforeReset(counts.since, mark)) {
      counts = { raised: 0, since: now };
    }
    counts[action] += 1;
    writeStateFile(gradeCountsPath(dir), JSON.stringify({ version: GRADE_COUNTS_VERSION, ...counts }) + '\n');
    return counts;
  } catch {
    return null;
  }
}

/**
 * { raised, since } for the statusline, with `since` the routing reset
 * mark (null when never reset), the same field the effort guard reads. Never
 * throws; an unreadable file or a window older than the mark reads as zero.
 */
export function gradeActionTotals(dir = userDataDir()) {
  const since = readResetMarks(dir).routing;
  const zero = { raised: 0, since };
  try {
    const counts = readCounts(dir);
    if (!counts || counts.since === null || isBeforeReset(counts.since, since)) return zero;
    return { raised: counts.raised, since };
  } catch {
    return zero;
  }
}
