/**
 * Writes for the state files this tool owns: the rule registry, the savings
 * ledger, the seed answers, the config.
 *
 * Their loaders read a file that fails to parse as empty state, which is the
 * right thing for a report but meant the next save replaced the whole file
 * with that empty state. The savings ledger is a lifetime total, so one
 * half-written file (two statuslines saving at once, a full disk) erased it
 * for good. Two things stop that here: the write goes to a temp file that is
 * renamed over the target, so a reader never sees half a file, and a target
 * that does not parse is copied aside before it is replaced.
 */

import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

/** Where an unreadable state file is kept. One slot: the first copy holds the data worth recovering. */
export const corruptCopyPath = (file) => `${file}.corrupt`;

function keepUnreadable(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { return; }
  if (!raw.trim()) return;
  try { JSON.parse(raw); return; } catch { /* does not parse: keep it */ }
  try {
    if (!existsSync(corruptCopyPath(file))) copyFileSync(file, corruptCopyPath(file));
  } catch { /* best effort; the write below still goes ahead */ }
}

export function writeStateFile(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  keepUnreadable(file);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  } catch {
    // Windows refuses the rename while another process holds the target open.
    // Writing in place is what this did before, and better than not saving.
    try { rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    writeFileSync(file, text);
  }
}
