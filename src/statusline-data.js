/**
 * Statusline data helpers that need more than a number from the payload.
 *
 * bin/cli.js assembles the report data inline and cannot be imported (it runs
 * on load), so the two derivations below live here where a test can reach them.
 * Both read only what the render has already loaded or one small JSON file the
 * statusline reads anyway; neither scans a transcript.
 */

import { resolve } from 'node:path';
import { modelFamily } from './savings-ledger.js';
import { loadModelRules } from './model-rules.js';

/** Longest family name shown before it is cut. Keeps an opaque gateway id from taking the line. */
const FAMILY_MAX = 14;

const shortFamily = (name) => (name.length > FAMILY_MAX ? `${name.slice(0, FAMILY_MAX - 1)}…` : name);

/**
 * The subagent runs of the session the statusline is drawing for.
 *
 * The parser already attaches each session's subagent runs (`subagentRuns`,
 * one entry per run with its own model), so this only finds the right session
 * among those loaded and tallies them by model family. The session is matched
 * by transcript path first, then by session id, because Claude Code reports
 * both and either can be absent or spelled differently (a symlinked home).
 *
 * The runs are those the analysis window kept, so a session older than the
 * window (`sprag mode` default is one day) reports only its recent runs.
 *
 * Families come from `modelFamily`, which returns an unmapped model id as it
 * is rather than folding it into a neighbour; the name is shortened here so an
 * ARN cannot flood the line.
 *
 * @param {Array} sessions parseAllSessions result
 * @param {{ transcriptPath?: string|null, sessionId?: string|null }} [ids]
 * @returns {{ total: number, families: Array<{ family: string, runs: number }> }|null}
 *   null when the session cannot be found or ran no subagents
 */
export function sessionSubagentSummary(sessions, { transcriptPath = null, sessionId = null } = {}) {
  if (!Array.isArray(sessions) || (!transcriptPath && !sessionId)) return null;
  let hit = null;
  if (transcriptPath) {
    const want = resolve(transcriptPath);
    hit = sessions.find((s) => s && s.filePath && resolve(s.filePath) === want) || null;
  }
  if (!hit && sessionId) {
    // A resumed conversation can leave more than one file under one id; the
    // most recently active is the one still being written.
    const end = (s) => (s.endTime ? new Date(s.endTime).getTime() || 0 : 0);
    hit = sessions
      .filter((s) => s && s.sessionId === sessionId)
      .sort((a, b) => end(b) - end(a))[0] || null;
  }
  const runs = hit && Array.isArray(hit.subagentRuns) ? hit.subagentRuns : [];
  if (runs.length === 0) return null;
  const byFamily = new Map();
  for (const r of runs) {
    const name = shortFamily(modelFamily(r && r.model));
    byFamily.set(name, (byFamily.get(name) || 0) + 1);
  }
  const families = [...byFamily.entries()]
    .map(([family, n]) => ({ family, runs: n }))
    .sort((a, b) => b.runs - a.runs || a.family.localeCompare(b.family));
  return { total: runs.length, families };
}

/**
 * How many delegation rules apply in this project, and how many of those are
 * flagged for review.
 *
 * "Apply" is the same test the `rule-health` warning uses: a global rule, or a
 * project rule whose target is this root. A rule switched `off` is not counted.
 * Review is `status === 'review'`, which is what model-rules.js renders as its
 * `⚠ rule-health` marker (the marker itself is a local closure there, so the
 * condition is restated rather than imported).
 *
 * @param {string} projectRoot
 * @returns {{ total: number, review: number }}
 */
export function delegationRuleStats(projectRoot) {
  let rules = [];
  try {
    rules = loadModelRules().rules;
  } catch {
    return { total: 0, review: 0 };
  }
  let total = 0;
  let review = 0;
  for (const r of rules) {
    if (!r || r.status === 'off') continue;
    if (r.scope !== 'global' && r.targetRoot !== projectRoot) continue;
    total += 1;
    if (r.status === 'review') review += 1;
  }
  return { total, review };
}
