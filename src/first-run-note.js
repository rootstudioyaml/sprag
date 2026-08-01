/**
 * first-run-note — a one-time pointer to where a feature is explained.
 *
 * A CLI that advertises on every invocation stops being a tool, so this fires
 * ONCE per note key and then never again: the shown-at timestamp is persisted
 * next to the other state files and checked before anything is printed.
 *
 * Opt out entirely with CTS_NO_NOTE=1 (also honoured by anything that pipes
 * our output somewhere it does not belong).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from './paths.js';

export function firstRunStatePath() {
  return join(userDataDir(), 'first-run.json');
}

function load() {
  try {
    const s = JSON.parse(readFileSync(firstRunStatePath(), 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

function markShown(key, now) {
  const state = load();
  state[key] = now;
  const dir = userDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(firstRunStatePath(), JSON.stringify(state) + '\n');
}

/** True only the first time this key is asked about. Best-effort — a
 *  read-only state dir just means the note repeats, never that we crash. */
export function shouldShowOnce(key, { now = Date.now() } = {}) {
  if (process.env.CTS_NO_NOTE === '1') return false;
  if (load()[key]) return false;
  try {
    markShown(key, now);
  } catch {
    /* state dir unwritable — show it, do not fail the command */
  }
  return true;
}

const NOTES = {
  'route-scan': {
    ko: '📺 이 기능을 설명한 영상: https://www.youtube.com/@DeepPulseKR  (이 안내는 한 번만 표시됩니다)',
    en: '📺 How this works, in 3 minutes: https://www.youtube.com/@DeepPulseEN  (shown once)',
  },
};

/** Print the one-time note for `key`, or nothing. */
export function printOnce(key, lang = 'en') {
  const note = NOTES[key];
  if (!note || !shouldShowOnce(key)) return;
  console.log('');
  console.log(lang === 'ko' ? note.ko : note.en);
}
