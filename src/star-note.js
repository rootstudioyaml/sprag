/**
 * star-note — a one-time "star the repo" ask in the statusline.
 *
 * The package is downloaded thousands of times a month and starred a handful
 * of times: all of the value lands in the statusline, so users never see the
 * repository. This asks once, at the moment the value is visible — when the
 * savings sprag itself produced (routing + doc2md) first reach $10.
 *
 * Once, because a chip that keeps asking is an advertisement. For 24 hours,
 * which is long enough to be seen across a day of sessions and short enough
 * not to linger. SPRAG_NO_NOTE=1 suppresses it, the same opt-out as every
 * other one-time note.
 */

import { envVar } from './env.js';
import { createRequire } from 'node:module';
import { delegationSavedTotals } from './savings-ledger.js';
import { noteShownAt, markNoteShown } from './first-run-note.js';
import { userDataDir } from './paths.js';
import { debug } from './debug.js';

const require = createRequire(import.meta.url);

export const STAR_THRESHOLD_USD = 10;
export const STAR_WINDOW_MS = 24 * 60 * 60 * 1000;
export const STAR_URL = 'github.com/rootstudioyaml/sprag';

/** Lifetime dollars saved by routing and doc2md; an unreadable ledger counts as 0. */
export function toolSavedUsd(now = Date.now(), dir = userDataDir()) {
  let total = 0;
  try {
    total += Number(delegationSavedTotals(now, dir).total) || 0;
  } catch (e) {
    debug('star-note:routing', e);
  }
  try {
    total += Number(require('./doc2md-ledger.cjs').doc2mdSavedTotals(dir).total) || 0;
  } catch (e) {
    debug('star-note:doc2md', e);
  }
  return total;
}

/** `{ usd, shownAt }` while the chip should show, else null. Never throws. */
export function readStarChip({ now = Date.now(), dir = userDataDir(), savedUsd } = {}) {
  try {
    if (envVar('NO_NOTE') === '1') return null;
    const shownAt = noteShownAt('star');
    if (shownAt === null) {
      const usd = savedUsd ?? toolSavedUsd(now, dir);
      if (!(usd >= STAR_THRESHOLD_USD)) return null;
      markNoteShown('star', now);
      return { usd, shownAt: now };
    }
    if (now - shownAt < STAR_WINDOW_MS) {
      return { usd: savedUsd ?? toolSavedUsd(now, dir), shownAt };
    }
    return null;
  } catch (e) {
    debug('star-note', e);
    return null;
  }
}
