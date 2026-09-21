/**
 * session-paths — pull the file paths this session has already looked at out
 * of its transcript, so a fresh subagent can be pointed at them instead of
 * re-discovering them by exploring from scratch.
 *
 * Only the transcript TAIL is read: this runs from a PreToolUse hook on every
 * Task/Agent call, so the whole file must not be parsed each time. Older tool
 * calls fall out of the window, which is acceptable — the point is "recently
 * touched", not "ever touched".
 *
 * The window is sized by measurement, not by brief.js's 256KiB convention. A
 * transcript's bytes are dominated by tool RESULTS (file contents, command
 * output, base64 images) while the tool_use records this reads are a few
 * hundred bytes each, so a byte window is far shallower than it looks: on a
 * real 4.65MB session it held 28 lines, 1.9% of the session, and recovered 0
 * of the 8 path-bearing calls that session had made. At 1MB the same
 * transcript gave back 4; the read cost 3.3ms against this hook's 10s
 * timeout. See TAIL_BYTES below for why the default sits higher still.
 */

import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { isAbsolute, resolve, relative, sep } from 'node:path';

// Tools whose path argument names a file directly. Bash is left out on
// purpose: its `command` string is free text, not a path field, and scraping
// it for paths would be a much noisier feature than this one.
const FILE_PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit']);
const PATH_ARG_TOOLS = new Set(['Grep', 'Glob']);

/**
 * How far back to read. 4MB costs 11.5ms on the measured session — nothing
 * against the hook's 10s timeout — and buys margin that 1MB does not: a single
 * transcript line can be 240KB when a session reads an image, so four such
 * reads would exhaust a 1MB window inside one turn and empty this section
 * again. The ceiling also bounds the buffer this allocates per delegation.
 */
const TAIL_BYTES = 4 * 1024 * 1024;

/** A path that exists and is a file. Anything else — missing, directory,
 *  unreadable — is not something to point a subagent at. */
function isRegularFile(abs) {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

/**
 * Recently-touched file paths for this session, most-recent-first, restricted
 * to `root` and returned relative to it.
 *
 * Every failure mode — missing transcript, unreadable file, malformed JSON —
 * collapses to an empty array rather than throwing, because this feeds a
 * PreToolUse hook: one bad transcript line must not block the delegation it
 * was only trying to make cheaper.
 */
export function recentToolPaths(transcriptPath, { root, limit = 15, tailBytes = TAIL_BYTES } = {}) {
  try {
    if (!transcriptPath || !existsSync(transcriptPath)) return [];
    // Paths are reported relative to root, so without one there is nothing
    // meaningful to return. resolve() would throw on undefined and the outer
    // catch would hide that as an empty result, so say it here instead.
    if (typeof root !== 'string' || root === '') return [];

    const size = statSync(transcriptPath).size;
    const start = Math.max(0, size - tailBytes);
    // allocUnsafe, not alloc: the read loop below overwrites what it uses and
    // only buf.subarray(0, bytesRead) is ever decoded, so the untouched
    // remainder never leaves this function. This saves zeroing 4MB per
    // delegation, which is worth taking but is not where the cost of this
    // function is — decoding the window to a string and splitting it allocates
    // several times more. Cutting that means walking the buffer backwards by
    // newline and decoding only the lines needed to reach `limit`, which is
    // the change to make if the window is ever widened again.
    const buf = Buffer.allocUnsafe(size - start);
    let fd;
    let bytesRead = 0;
    try {
      fd = openSync(transcriptPath, 'r');
      // One readSync is not promised to fill the whole request — a short read
      // is common on some filesystems even mid-file — and the part it leaves
      // unread here is the tail end of the buffer, which is the most recent
      // slice of the transcript and exactly what this feature is trying to
      // recover. Looping until the buffer is full (or the file runs out)
      // keeps that slice from being silently dropped.
      while (bytesRead < buf.length) {
        const n = readSync(fd, buf, bytesRead, buf.length - bytesRead, start + bytesRead);
        if (n === 0) break;
        bytesRead += n;
      }
    } finally {
      if (fd !== undefined) closeSync(fd);
    }

    // Only what was actually read. A transcript is still being written while
    // this runs, so between statSync and openSync the file may have been
    // truncated or rotated, which ends the loop above early (n === 0) with
    // bytesRead short of the buffer. Decoding the untouched remainder would
    // turn the last record into NUL bytes and lose the newest path to a
    // parse error.
    const lines = buf.subarray(0, bytesRead).toString('utf8').split('\n');
    // A tail that began mid-file leaves the first line a truncated record,
    // so drop it. When the read started at byte 0 the file was smaller than
    // the window and that line is whole, so keeping it costs nothing and
    // dropping it would lose the only record a short transcript has.
    if (start > 0) lines.shift();

    // Chronological order first (oldest touched path to newest); reversed
    // and deduped below so the most recent occurrence of each path wins.
    const touched = [];
    for (const line of lines) {
      // Cheap prefilter before the JSON.parse cost, same trick brief.js uses
      // for `"usage"` — most lines in a transcript are not tool_use blocks.
      if (!line.includes('"tool_use"')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const content = entry?.message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (!block || block.type !== 'tool_use') continue;
        const input = block.input;
        if (!input || typeof input !== 'object') continue;

        let rawPath = null;
        // Grep and Glob are the two whose argument is a directory as often as
        // a file, so what they contribute has to be confirmed before it is
        // offered as something to read. Read/Edit/Write name a file by
        // contract.
        let mayBeDirectory = false;
        if (FILE_PATH_TOOLS.has(block.name)) rawPath = input.file_path;
        else if (PATH_ARG_TOOLS.has(block.name)) {
          rawPath = input.path;
          mayBeDirectory = true;
        }
        if (typeof rawPath !== 'string' || rawPath === '') continue;
        // A POSIX filename may hold any byte but `/` and NUL, and this list is
        // rendered one path per line straight into the prompt of a subagent
        // that has tool permissions. So a filename carrying a newline plus a
        // sentence would leave the "already read these" section and arrive as
        // its own instruction. Filenames are outside input whenever the
        // session is working in a repository it did not write, which makes
        // this a boundary rather than a curiosity.
        if (/[\u0000-\u001f\u007f]/.test(rawPath)) continue;
        // The free half of the directory test; the stat below covers the rest.
        if (rawPath.endsWith('/') || rawPath.endsWith(sep)) continue;

        const abs = isAbsolute(rawPath) ? rawPath : resolve(root, rawPath);
        const rel = relative(root, abs);
        // Outside root: relative() climbs out with a leading "..", or (on a
        // different Windows drive) returns an already-absolute path.
        if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue;

        touched.push({ rel, mayBeDirectory });
      }
    }

    const deduped = [];
    const seen = new Set();
    for (let i = touched.length - 1; i >= 0 && deduped.length < limit; i--) {
      const { rel: p, mayBeDirectory } = touched[i];
      if (seen.has(p)) continue;
      seen.add(p);
      // `Grep({ path: 'src' })` names a directory without a trailing
      // separator, and the section this feeds says the session "already read
      // these" — so a directory listed there invites a subagent to Read it and
      // spend one of its capped tool calls on the failure. The same reasoning
      // already guards the ratchet pointer in delegation-guard.js.
      //
      // This is the one place a syscall is worth it. It runs after dedupe and
      // stops at `limit`, so at most 15 stats happen per delegation against an
      // 11.5ms read, and only for the two tools that can name a directory.
      if (mayBeDirectory && !isRegularFile(resolve(root, p))) continue;
      deduped.push(p);
    }
    return deduped;
  } catch {
    return [];
  }
}
