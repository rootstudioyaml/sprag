/**
 * member-id — the default display name for the team layer.
 *
 * The OS login name used to fill this slot, which sent a real username to the
 * team server. A random id created once per machine names the member without
 * naming the person. It lives in its own file in the user data dir, so
 * `team leave` (which only touches team.json) keeps it and a rejoin on the same
 * machine shows up under the same name.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { userDataDir } from './paths.js';
import { writeStateFile } from './state-file.js';
import { debug } from './debug.js';

const ID_RE = /^member-[0-9a-f]{8}$/;

export const memberIdPath = (dir = userDataDir()) => join(dir, 'member-id');

// Never throws: a failed write still returns the id it generated, so the join
// goes ahead (the next call just generates another one).
export function memberId({ dir = userDataDir(), random = () => randomBytes(4).toString('hex') } = {}) {
  const file = memberIdPath(dir);
  try {
    if (existsSync(file)) {
      const text = readFileSync(file, 'utf8').trim();
      if (ID_RE.test(text)) return text;
    }
  } catch (e) { debug('member-id', e); }
  const id = `member-${random()}`;
  try { writeStateFile(file, `${id}\n`); } catch (e) { debug('member-id', e); }
  return id;
}
