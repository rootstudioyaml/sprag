/**
 * member-id — the default display name for the team layer.
 *
 * The OS login name used to fill this slot, which sent a real username to the
 * team server. A random id created once per machine names the member without
 * naming the person. It lives in its own file in the user data dir, so
 * `team leave` (which only touches team.json) keeps it and a rejoin on the same
 * machine shows up under the same name.
 *
 * One id per machine holds even when things go wrong: an id that could not be
 * written is remembered for the life of the process, and a missing file is
 * created exclusively (temp file + hard link), so two processes starting at
 * once end up with the id of whichever linked first.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';
import { debug } from './debug.js';

const ID_RE = /^member-[0-9a-f]{8}$/;
const cache = new Map();

export const memberIdPath = (dir = userDataDir()) => join(dir, 'member-id');

function readValid(file) {
  try {
    const text = readFileSync(file, 'utf8').trim();
    return ID_RE.test(text) ? text : null;
  } catch (e) { debug('member-id', e); return null; }
}

// Never throws: a failed write still returns the id it generated, and the
// cache hands the same one back on the next call.
export function memberId({ dir = userDataDir(), random = () => randomBytes(4).toString('hex') } = {}) {
  const file = memberIdPath(dir);
  const existing = readValid(file);
  if (existing) { cache.set(file, existing); return existing; }
  let id = cache.get(file) || `member-${random()}`;
  try {
    if (existsSync(file)) {
      writeStateFile(file, `${id}\n`);
    } else {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        writeFileSync(tmp, `${id}\n`);
        linkSync(tmp, file);
      } catch (e) {
        // A file system without hard links still gets the file, just not exclusively.
        if (e.code !== 'EEXIST') { debug('member-id', e); writeStateFile(file, `${id}\n`); } else {
          const winner = readValid(file); // another process created it first
          if (winner) id = winner;
        }
      } finally {
        try { unlinkSync(tmp); } catch { /* never created */ }
      }
    }
  } catch (e) { debug('member-id', e); }
  cache.set(file, id);
  return id;
}
