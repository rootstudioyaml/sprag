/**
 * diag-log: a small local log of the errors sprag swallowed on a joined machine.
 *
 * Why: a joined machine can show $0 spend, upload zero ledger rows or price
 * every Claude call as "unpriced", and the cause sits in a catch block that was
 * silent on purpose (see debug.js). The operator needs the error text from that
 * machine, so `debug()` also lands here and the team sync uploads the log to
 * `diag_upload`. Only error text goes up: never a prompt or a transcript.
 *
 * File: <userDataDir>/diag-log.json
 *   { "version": 1, "entries": [ { scope, msg, count, first, last } ] }
 * `first` and `last` are ISO times. An entry is one (scope, msg) pair.
 *
 * Costs and guarantees:
 * - recordDiag never throws and never calls debug() (that would recurse).
 * - It does nothing unless the machine is joined to a team (team.json is read
 *   once per process and directory) and the user has not set SPRAG_NO_DIAG=1
 *   or SPRAG_NO_TEAM_SYNC=1.
 * - Repeats: the first occurrence of a (scope, msg) pair in a process writes
 *   the file (count + 1). Later occurrences of the same pair in that process
 *   are ignored, so a loop that fails thousands of times costs one write. The
 *   count therefore means "processes that saw it", not "times it happened".
 * - At most MAX_ENTRIES entries; when full, the entry with the oldest `last` goes.
 *
 * Imports only node builtins, env.js, paths.js, redact.js and state-file.js, so
 * debug.js (which the statusline and the hooks load) can import it.
 */

import { readFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { envVar } from './env.js';
import { userDataDir } from './paths.js';
import { redactSecrets } from './redact.js';
import { writeStateFile } from './state-file.js';

export const DIAG_VERSION = 1;
export const MAX_ENTRIES = 50;
export const MAX_MSG = 300;
export const MAX_SCOPE = 60;

export const diagPath = (dir = userDataDir()) => join(dir, 'diag-log.json');

/** sprag's own src/ directory: a stack frame inside it is worth naming. */
export const diagSrcDir = dirname(fileURLToPath(import.meta.url));
const SRC_URL = pathToFileURL(diagSrcDir).href;

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@?#]*@)?[^\s/?#]+/gi;
const ARN_ACCOUNT_RE = /(arn:aws[\w-]*:[\w-]*:[\w-]*:)\d{12}(:)/g;
const EMAIL_RE =/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// A file path after the start, a space, a quote, `(` or `=`. `<host>/path` is not
// matched (the `>` before it), so a URL keeps its path.
const PATH_RE = /(^|[\s'"(=])((?:~|[A-Za-z]:)?[\\/][^\s'"():,]+)/g;

/**
 * A path without the directories that could name a project: the last segment
 * only, behind `…`. A home dot-directory (`~/.claude/projects/...`) keeps its
 * first two segments, which say which tool's files were missing; a project
 * directory below them is dropped all the same.
 */
function shortPath(p) {
  const root = p.startsWith('~') ? '~' : /^[A-Za-z]:/.test(p) ? p.slice(0, 2) : '';
  const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/';
  const parts = p.slice(root.length).split(/[\\/]/).filter(Boolean);
  const keep = root === '~' && parts[0]?.startsWith('.') ? Math.min(2, parts.length) : 0;
  if (parts.length <= keep + 1) return p;
  return root + sep + [...parts.slice(0, keep), '…', parts[parts.length - 1]].join(sep);
}

/**
 * Text that is safe to leave the machine: home directory -> `~`, a path cut to
 * its last segment (see shortPath), every
 * scheme://host[:port] -> `<host>` (path kept), secrets masked, e-mail
 * addresses -> `<email>`, whitespace collapsed, cut to `max` characters.
 */
export function sanitizeDiag(text, max = MAX_MSG) {
  let s = String(text ?? '');
  try {
    const home = homedir();
    if (home && home.length > 1) s = s.split(home).join('~');
  } catch { /* no home directory to mask */ }
  s = s.replace(URL_RE, '<host>');
  s = s.replace(PATH_RE, (_, lead, p) => lead + shortPath(p));
  s = s.replace(ARN_ACCOUNT_RE, '$1<acct>$2'); // a model id can be an ARN, and an ARN holds the AWS account id
  s = redactSecrets(s);
  s = s.replace(EMAIL_RE, '<email>');
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** `src/<file>.js:<line>` of the first stack frame inside sprag's own src/, or ''. */
function ownFrame(stack) {
  if (typeof stack !== 'string') return '';
  for (const line of stack.split('\n')) {
    for (const needle of [diagSrcDir, SRC_URL]) {
      const at = line.indexOf(needle);
      if (at < 0) continue;
      const m = /^[\\/]([^\s():]+?\.c?js):(\d+)/.exec(line.slice(at + needle.length));
      if (m) return `src/${m[1].replace(/\\/g, '/')}:${m[2]}`;
    }
  }
  return '';
}

function messageOf(err) {
  let msg;
  if (err && typeof err === 'object' && 'message' in err) msg = String(err.message);
  else msg = String(err);
  const first = msg.split('\n').find((l) => l.trim()) || '';
  const frame = err && typeof err === 'object' ? ownFrame(err.stack) : '';
  if (!frame) return sanitizeDiag(first);
  return sanitizeDiag(`${sanitizeDiag(first, MAX_MSG - frame.length - 4)} @ ${frame}`);
}

const keyOf = (scope, msg) => `${scope}\n${msg}`;

const joinedByDir = new Map();   // dir -> boolean, read once per process
const seenKeys = new Set();      // `${dir}\n${scope}\n${msg}` written (or attempted) by this process

/** Forget what this process cached. For tests that simulate a second process. */
export function _resetDiagForTest() {
  joinedByDir.clear();
  seenKeys.clear();
}

function isJoinedDir(dir) {
  if (joinedByDir.has(dir)) return joinedByDir.get(dir);
  let joined = false;
  try {
    const s = JSON.parse(readFileSync(join(dir, 'team.json'), 'utf8'));
    joined = !!(s && s.memberKey && !s.left);
  } catch { /* no team state: not joined */ }
  joinedByDir.set(dir, joined);
  return joined;
}

function validEntry(e) {
  return !!e && typeof e === 'object' && typeof e.scope === 'string' && typeof e.msg === 'string' && Number.isFinite(e.count) && e.count > 0;
}

/** The entries waiting in the log. Empty on any problem. */
export function readDiag({ dir = userDataDir() } = {}) {
  try {
    const data = JSON.parse(readFileSync(diagPath(dir), 'utf8'));
    if (!data || data.version !== DIAG_VERSION || !Array.isArray(data.entries)) return [];
    return data.entries.filter(validEntry);
  } catch {
    return [];
  }
}

function writeDiag(dir, entries) {
  const file = diagPath(dir);
  writeStateFile(file, JSON.stringify({ version: DIAG_VERSION, entries }, null, 2) + '\n');
  if (process.platform !== 'win32') {
    try { chmodSync(file, 0o600); } catch { /* the file is still written */ }
  }
}

/**
 * Whether recordDiag would write anything right now. Callers that build a
 * message only for the log (the unpriced-price condition runs once per priced
 * part) ask first, so a machine that is not joined pays nothing.
 */
export function diagActive({ dir = userDataDir(), env = process.env } = {}) {
  try {
    if (envVar('NO_DIAG', env) === '1' || envVar('NO_TEAM_SYNC', env) === '1') return false;
    // Under `node --test` the process shares the developer's real data dir
    // unless the test pointed XDG_CONFIG_HOME elsewhere: do not log test noise there.
    if (process.env.NODE_TEST_CONTEXT && !process.env.XDG_CONFIG_HOME) return false;
    return isJoinedDir(dir);
  } catch {
    return false;
  }
}

/**
 * Note one swallowed error. Never throws; silent when this machine is not
 * joined or diagnostics are switched off.
 */
export function recordDiag(scope, err, { dir = userDataDir(), now = Date.now(), env = process.env } = {}) {
  try {
    if (!diagActive({ dir, env })) return;
    const sc = sanitizeDiag(scope, MAX_SCOPE);
    const msg = messageOf(err);
    const key = keyOf(sc, msg);
    const seen = `${dir}\n${key}`;
    if (seenKeys.has(seen)) return;
    seenKeys.add(seen);
    const entries = readDiag({ dir });
    const iso = new Date(now).toISOString();
    const hit = entries.find((e) => keyOf(e.scope, e.msg) === key);
    if (hit) {
      hit.count += 1;
      hit.last = iso;
    } else {
      entries.push({ scope: sc, msg, count: 1, first: iso, last: iso });
      while (entries.length > MAX_ENTRIES) {
        let oldest = 0;
        for (let i = 1; i < entries.length; i++) if (String(entries[i].last) < String(entries[oldest].last)) oldest = i;
        entries.splice(oldest, 1);
      }
    }
    writeDiag(dir, entries);
  } catch { /* diagnostics must never break the caller, and must not call debug() */ }
}

/**
 * After a successful upload: take the sent counts off the log. The file is read
 * again first, so entries that arrived during the upload stay. An entry whose
 * count drops to zero or below is removed.
 */
export function ackDiag(sent, { dir = userDataDir() } = {}) {
  try {
    const gone = new Map();
    for (const e of sent || []) {
      if (!validEntry(e)) continue;
      const k = keyOf(e.scope, e.msg);
      gone.set(k, (gone.get(k) || 0) + e.count);
    }
    if (!gone.size) return;
    const kept = [];
    for (const e of readDiag({ dir })) {
      const n = gone.get(keyOf(e.scope, e.msg)) || 0;
      if (e.count - n > 0) kept.push({ ...e, count: e.count - n });
    }
    writeDiag(dir, kept);
  } catch { /* the next upload sends them again */ }
}
