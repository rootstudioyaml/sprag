/**
 * session-paths — pull the file paths this session has already looked at out
 * of its transcript, so a fresh subagent can be pointed at them instead of
 * re-discovering them by exploring from scratch.
 *
 * Only the transcript TAIL is read (brief.js's TAIL_BYTES convention: this
 * runs from a PreToolUse hook on every Task/Agent call, so a multi-MB
 * transcript must not become a multi-MB read on every delegation). That means
 * older tool calls fall out of the window — acceptable here, since the whole
 * point is "recently touched", not "ever touched".
 */

import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { isAbsolute, resolve, relative, sep } from 'node:path';

// Tools whose path argument names a file directly. Bash is left out on
// purpose: its `command` string is free text, not a path field, and scraping
// it for paths would be a much noisier feature than this one.
const FILE_PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit']);
const PATH_ARG_TOOLS = new Set(['Grep', 'Glob']);

/**
 * Recently-touched file paths for this session, most-recent-first, restricted
 * to `root` and returned relative to it.
 *
 * Every failure mode — missing transcript, unreadable file, malformed JSON —
 * collapses to an empty array rather than throwing, because this feeds a
 * PreToolUse hook: one bad transcript line must not block the delegation it
 * was only trying to make cheaper.
 */
export function recentToolPaths(transcriptPath, { root, limit = 15, tailBytes = 256 * 1024 } = {}) {
  try {
    if (!transcriptPath || !existsSync(transcriptPath)) return [];
    // Paths are reported relative to root, so without one there is nothing
    // meaningful to return. resolve() would throw on undefined and the outer
    // catch would hide that as an empty result, so say it here instead.
    if (typeof root !== 'string' || root === '') return [];

    const size = statSync(transcriptPath).size;
    const start = Math.max(0, size - tailBytes);
    const buf = Buffer.alloc(size - start);
    let fd;
    try {
      fd = openSync(transcriptPath, 'r');
      readSync(fd, buf, 0, buf.length, start);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }

    const lines = buf.toString('utf8').split('\n');
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
        if (FILE_PATH_TOOLS.has(block.name)) rawPath = input.file_path;
        else if (PATH_ARG_TOOLS.has(block.name)) rawPath = input.path;
        if (typeof rawPath !== 'string' || rawPath === '') continue;
        // No existsSync check here — that would add a syscall per path found,
        // and the goal is fewer filesystem hits, not more. A trailing
        // separator is the only directory signal available for free.
        if (rawPath.endsWith('/') || rawPath.endsWith(sep)) continue;

        const abs = isAbsolute(rawPath) ? rawPath : resolve(root, rawPath);
        const rel = relative(root, abs);
        // Outside root: relative() climbs out with a leading "..", or (on a
        // different Windows drive) returns an already-absolute path.
        if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue;

        touched.push(rel);
      }
    }

    const deduped = [];
    const seen = new Set();
    for (let i = touched.length - 1; i >= 0 && deduped.length < limit; i--) {
      const p = touched[i];
      if (seen.has(p)) continue;
      seen.add(p);
      deduped.push(p);
    }
    return deduped;
  } catch {
    return [];
  }
}
