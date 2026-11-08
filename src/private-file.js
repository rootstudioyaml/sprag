/**
 * Files that copy a user's settings or notes (the .bak and .sprag-bak
 * backups) can hold what the original holds: a token in settings.json's env
 * block, a pasted password in CLAUDE.md. A copy made with the default mode is
 * readable by every account on the machine, so these helpers cut it to the
 * owner. The content is never changed, because a backup exists to be restored.
 */

import { chmodSync, writeFileSync } from 'node:fs';

/** chmod 0600; a failure (Windows, a filesystem without modes) is ignored. */
export function restrictFile(path) {
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
}

/** Write `data` to `path` readable by the owner only, replacing an older, wider-mode copy too. */
export function writePrivateFile(path, data) {
  writeFileSync(path, data, { mode: 0o600 });
  restrictFile(path);
}
