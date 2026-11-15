/**
 * The offer to widen delegation until the usage window resets.
 *
 * When a window runs high the prompt hook tells the model to ask the user once
 * whether to run `sprag routing relax`. "Once" is counted per limit window and
 * per session: the offer goes through the model as a context line, and a
 * session that never relays it must not silence every other session for the
 * rest of the window. The window resetting is what makes a new offer possible
 * for a session that was already offered. The last window offered, identified
 * by its resetsAt (epoch seconds), and the sessions offered in it are kept in a
 * small file under the user data directory.
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
/** Sessions remembered per window; the oldest ids drop first. */
const MAX_SESSIONS = 50;

/** The window id used for the claim: its resetsAt, or a 5 hour bucket when the window has none. */
export function offerWindowId(resetsAt, nowMs = Date.now()) {
  if (typeof resetsAt === 'number' && Number.isFinite(resetsAt) && resetsAt > 0) return resetsAt;
  return Math.floor(nowMs / 1000 / FALLBACK_BUCKET_S) * FALLBACK_BUCKET_S;
}

/**
 * True the first time a (window, session) pair is offered, false after. A call
 * without a session id counts under one shared key, which keeps the old
 * once-per-window behaviour for it. Never throws: when the state file cannot be
 * written the offer is skipped, so a failing disk cannot turn it into a line on
 * every prompt.
 *
 * The file holds { resetsAt, sessions: [ids], offeredAt }. A file in the older
 * shape { resetsAt, offeredAt } reads as the same window with no sessions.
 *
 * @param {number|null} resetsAt epoch seconds of the busiest window's reset
 * @param {{dir?: string, nowMs?: number, session?: string}} [opts]
 */
export function claimRelaxOffer(resetsAt, { dir, nowMs = Date.now(), session } = {}) {
  try {
    const file = join(dir || userDataDir(), FILE);
    const id = offerWindowId(resetsAt, nowMs);
    const key = typeof session === 'string' ? session : '';
    let last = NaN;
    let sessions = [];
    try {
      if (existsSync(file)) {
        const saved = JSON.parse(readFileSync(file, 'utf8'));
        last = Number(saved?.resetsAt);
        if (Array.isArray(saved?.sessions)) sessions = saved.sessions.filter((s) => typeof s === 'string');
      }
    } catch { /* unreadable reads as never offered */ }
    const sameWindow = Number.isFinite(last) && Math.abs(last - id) <= SAME_WINDOW_S;
    if (sameWindow && sessions.includes(key)) return false;
    // A new window starts a fresh list; the same window keeps its resetsAt so
    // the jitter allowance does not creep forward with every session.
    const kept = sameWindow ? [...sessions, key].slice(-MAX_SESSIONS) : [key];
    writeStateFile(file, JSON.stringify({ resetsAt: sameWindow ? last : id, sessions: kept, offeredAt: nowMs }) + '\n');
    return true;
  } catch {
    return false;
  }
}
