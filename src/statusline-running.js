/**
 * Subagents that are running right now, for the statusline's leading chip.
 *
 * Claude Code keeps one transcript per subagent run beside the session's own:
 *   <projects>/<slug>/<sessionId>.jsonl                      the session
 *   <projects>/<slug>/<sessionId>/subagents/agent-<id>.jsonl  one per run
 *   <projects>/<slug>/<sessionId>/subagents/agent-<id>.meta.json
 *
 * Which signal says "finished" was measured on 418 real subagent transcripts
 * (2026-11-09), not guessed:
 *   - The last record of a finished run is usually NOT an assistant answer. Of
 *     the last 400 transcripts older than 10 minutes, 303 ended on a `user`
 *     tool_result (a SubagentHandback call returns one and the file stops
 *     there) and only 83 on an assistant `end_turn`. A "last record is the
 *     final answer" test would call most finished runs still running.
 *   - The sibling `agent-<id>.meta.json` carries `"finished": true` once the run
 *     ended. Of 418 transcripts, 391 had the key; the 2 being written at
 *     measurement time and 25 stale ones (24 older than 10 minutes, killed
 *     with their session) did not. The meta file is a few hundred bytes, so it
 *     is the cheapest and most reliable signal.
 *   - A run killed with its session never gets the key. The recent-modification
 *     window below is what keeps those from counting forever.
 * So a run is "running" when its transcript was modified within the window and
 * its meta file does not say `finished`.
 *
 * This is the statusline path, re-run every few seconds, so the cost is one
 * readdir and one stat per transcript, a meta read for the few recent ones and a
 * tail read (a few KB) for at most MAX_FILES of them. Nothing parses a whole file.
 */

import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { modelFamily } from './savings-ledger.js';

/**
 * A run silent for longer than this is treated as gone. A live run writes a
 * record per model turn and per tool result, but a long tool call (a test suite,
 * a render) writes nothing until it returns, so the window is wider than a turn.
 */
export const RUNNING_WINDOW_MS = 30_000;
/** Most transcripts whose model is read per render. */
export const MAX_FILES = 5;
const TAIL_BYTES = 16 * 1024;
/** Longest family name shown, as in the session chip. */
const FAMILY_MAX = 14;

/** The model id named last in the final bytes of a transcript, or null. */
function modelFromTail(file, size) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const hits = [...buf.toString('utf8').matchAll(/"model":"([^"]+)"/g)];
    return hits.length ? hits[hits.length - 1][1] : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* nothing to release */ }
    }
  }
}

/** True when the run's meta file says it ended. Unreadable or absent counts as running. */
function isFinished(metaFile) {
  try {
    return JSON.parse(readFileSync(metaFile, 'utf8')).finished === true;
  } catch {
    return false;
  }
}

/**
 * The subagents of the session behind `transcriptPath` that are still working.
 *
 * @param {string|null} transcriptPath the statusline payload's `transcript_path`
 * @param {{ now?: number, windowMs?: number, maxFiles?: number }} [o]
 * @returns {{ count: number, families: Array<{ family: string, runs: number }> }|null}
 *   null when nothing is running (the common case) or the directory is missing
 */
export function runningSubagents(transcriptPath, { now = Date.now(), windowMs = RUNNING_WINDOW_MS, maxFiles = MAX_FILES } = {}) {
  if (typeof transcriptPath !== 'string' || !transcriptPath.endsWith('.jsonl')) return null;
  const dir = join(transcriptPath.slice(0, -'.jsonl'.length), 'subagents');
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const live = [];
  for (const name of names) {
    if (!name.startsWith('agent-') || !name.endsWith('.jsonl')) continue;
    const file = join(dir, name);
    let st;
    try { st = statSync(file); } catch { continue; }
    if (now - st.mtimeMs > windowMs) continue;
    if (isFinished(file.slice(0, -'.jsonl'.length) + '.meta.json')) continue;
    live.push({ file, size: st.size, mtimeMs: st.mtimeMs });
  }
  if (live.length === 0) return null;
  live.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const byFamily = new Map();
  for (const run of live.slice(0, maxFiles)) {
    const model = modelFromTail(run.file, run.size);
    if (!model) continue;
    const fam = modelFamily(model);
    const name = fam.length > FAMILY_MAX ? `${fam.slice(0, FAMILY_MAX - 1)}…` : fam;
    byFamily.set(name, (byFamily.get(name) || 0) + 1);
  }
  const families = [...byFamily.entries()]
    .map(([family, runs]) => ({ family, runs }))
    .sort((a, b) => b.runs - a.runs || a.family.localeCompare(b.family));
  return { count: live.length, families };
}
