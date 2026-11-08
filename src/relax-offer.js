/**
 * The offer to widen delegation until the usage window resets.
 *
 * When a window runs high the prompt hook tells the model to ask the user once
 * whether to run `sprag routing relax`. "Once" is counted per limit window, not
 * per session: a new session in the same window has already been offered, and
 * the window resetting is what makes a new offer possible. The last window
 * offered, identified by its resetsAt (epoch seconds), is kept in a small file
 * under the user data directory.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';

const FILE = 'relax-offer.json';
/** resetsAt values this close count as the same window (the reading jitters by seconds). */
const SAME_WINDOW_S = 600;
/** A window with no reset time is bucketed by this span instead. */
const FALLBACK_BUCKET_S = 5 * 60 * 60;

/** The window id used for the claim: its resetsAt, or a 5 hour bucket when the window has none. */
export function offerWindowId(resetsAt, nowMs = Date.now()) {
  if (typeof resetsAt === 'number' && Number.isFinite(resetsAt) && resetsAt > 0) return resetsAt;
  return Math.floor(nowMs / 1000 / FALLBACK_BUCKET_S) * FALLBACK_BUCKET_S;
}

/**
 * True the first time a window is offered, false after. Never throws: when the
 * state file cannot be written the offer is skipped, so a failing disk cannot
 * turn it into a line on every prompt.
 *
 * @param {number|null} resetsAt epoch seconds of the busiest window's reset
 * @param {{dir?: string, nowMs?: number}} [opts]
 */
export function claimRelaxOffer(resetsAt, { dir, nowMs = Date.now() } = {}) {
  try {
    const file = join(dir || userDataDir(), FILE);
    const id = offerWindowId(resetsAt, nowMs);
    let last = null;
    try {
      if (existsSync(file)) last = Number(JSON.parse(readFileSync(file, 'utf8'))?.resetsAt);
    } catch { /* unreadable reads as never offered */ }
    if (Number.isFinite(last) && Math.abs(last - id) <= SAME_WINDOW_S) return false;
    writeStateFile(file, JSON.stringify({ resetsAt: id, offeredAt: nowMs }) + '\n');
    return true;
  } catch {
    return false;
  }
}
