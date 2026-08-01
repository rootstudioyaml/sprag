/**
 * subagent-records — read the transcripts of subagent runs a session spawned.
 *
 * Why this exists: rule-health used to be a PROXY. It measured the error rate
 * of episodes the expensive model handled DIRECTLY that merely *looked*
 * delegable by shape — never the outcome of an actual delegation. So a rule
 * could be quietly failing every time it fired and the signal would not move.
 * Claude Code writes each subagent run to its own transcript, which makes the
 * real outcome measurable:
 *
 *   ~/.claude/projects/<munged>/<sessionId>/subagents/agent-<id>.jsonl
 *   ~/.claude/projects/<munged>/<sessionId>/subagents/agent-<id>.meta.json
 *
 * The .jsonl is byte-identical in shape to a main transcript (`isSidechain:
 * true`, assistant entries carrying `message.model` + `message.usage`,
 * tool_result blocks carrying `is_error`), so collectSessionRecords parses it
 * unchanged — including the rejection / self-corrected error filters, which
 * must apply here for the same reason they apply to main sessions.
 *
 * The .meta.json carries `{ agentType, description, toolUseId, spawnDepth }`.
 * `toolUseId` is the join key back to the Task/Agent tool_use block in the
 * parent transcript, which is how a run is attributed to the episode (and
 * therefore the category) that caused it.
 *
 * Everything is best-effort: this layout is a Claude Code internal, so a
 * missing directory, an absent meta file, or an unparseable line degrades to
 * less data, never to a throw. route-scan keeps its proxy signal as fallback.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { collectSessionRecords, normalizeModelId } from './session-records.js';

/** Directory holding a session's subagent transcripts (may not exist). */
export function subagentDirFor(sessionPath) {
  return join(dirname(sessionPath), basename(sessionPath, '.jsonl'), 'subagents');
}

async function readMeta(metaPath) {
  try {
    return JSON.parse(await readFile(metaPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * A run's model when several appear in one transcript (a harness retry can
 * switch tiers mid-run): the one that produced the most output, since that is
 * what dominates both the bill and the counterfactual.
 */
function primaryModel(byModelOut) {
  let best = null;
  let bestOut = -1;
  for (const [model, out] of byModelOut) {
    if (out > bestOut) { best = model; bestOut = out; }
  }
  return best;
}

/**
 * Aggregate one subagent transcript into a single run record.
 * Returns null when the file carries no billable API call.
 */
export async function collectSubagentRun(jsonlPath) {
  let records;
  try {
    records = await collectSessionRecords(jsonlPath, { includeContent: false });
  } catch {
    return null;
  }
  if (records.length === 0) return null;

  const run = {
    path: jsonlPath,
    agentId: basename(jsonlPath, '.jsonl').replace(/^agent-/, ''),
    agentType: null,
    toolUseId: null,
    spawnDepth: null,
    model: null,
    calls: records.length,
    out: 0,
    input: 0,
    cacheCreation: 0,
    cacheRead: 0,
    ephemeral5m: 0,
    ephemeral1h: 0,
    toolErrors: 0,
    startedAt: null,
    endedAt: null,
    bytes: 0,
  };
  const byModelOut = new Map();
  for (const r of records) {
    run.out += r.completion_tokens || 0;
    run.input += r.input_tokens || 0;
    run.cacheCreation += r.cache_creation_tokens || 0;
    run.cacheRead += r.cache_read_tokens || 0;
    run.ephemeral5m += r.ephemeral5m || 0;
    run.ephemeral1h += r.ephemeral1h || 0;
    run.toolErrors += r.toolErrors || 0;
    const model = normalizeModelId(r.model);
    byModelOut.set(model, (byModelOut.get(model) || 0) + (r.completion_tokens || 0));
    if (r.timestamp) {
      const t = Date.parse(r.timestamp);
      if (Number.isFinite(t)) {
        if (run.startedAt === null || t < run.startedAt) run.startedAt = t;
        if (run.endedAt === null || t > run.endedAt) run.endedAt = t;
      }
    }
  }
  run.model = primaryModel(byModelOut);

  const meta = await readMeta(jsonlPath.replace(/\.jsonl$/, '.meta.json'));
  if (meta) {
    run.agentType = meta.agentType ?? null;
    run.toolUseId = meta.toolUseId ?? null;
    run.spawnDepth = meta.spawnDepth ?? null;
  }
  try {
    run.bytes = (await stat(jsonlPath)).size;
  } catch { /* size only feeds the rescan gate — 0 is a safe under-estimate */ }

  return run;
}

/**
 * All subagent runs a session spawned. Empty array when the session never
 * delegated (the common case) or the directory is unreadable.
 */
export async function collectSubagentRuns(sessionPath) {
  const dir = subagentDirFor(sessionPath);
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const runs = [];
  for (const e of entries) {
    if (!e.endsWith('.jsonl')) continue;
    const run = await collectSubagentRun(join(dir, e));
    if (run) runs.push(run);
  }
  return runs;
}

/**
 * Index a session's runs for attribution: exact join by tool_use id first,
 * with the un-joinable ones kept aside for the timestamp fallback (a run
 * whose .meta.json is missing or predates toolUseId still happened, and
 * dropping it would silently under-count a rule's real error rate).
 */
export function indexRuns(runs) {
  const byToolUse = new Map();
  const unjoined = [];
  for (const r of runs) {
    if (r.toolUseId) byToolUse.set(r.toolUseId, r);
    else unjoined.push(r);
  }
  return { byToolUse, unjoined, all: runs };
}

/**
 * Runs attributable to one episode. Exact tool_use ids win; anything left
 * unjoined is matched by start time falling inside the episode's span. `used`
 * is a shared Set of run paths across the session so no run is counted twice
 * (an episode's span can overlap a neighbouring episode's runs).
 */
export function runsForEpisode(index, ep, used) {
  const out = [];
  for (const id of ep.delegationToolUseIds || []) {
    const r = index.byToolUse.get(id);
    if (r && !used.has(r.path)) { used.add(r.path); out.push(r); }
  }
  if (ep.startedAt === null || ep.endedAt === null) return out;
  for (const r of index.unjoined) {
    if (used.has(r.path) || r.startedAt === null) continue;
    if (r.startedAt >= ep.startedAt && r.startedAt <= ep.endedAt) {
      used.add(r.path);
      out.push(r);
    }
  }
  return out;
}
