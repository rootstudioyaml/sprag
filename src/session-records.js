/**
 * session-records — parse a Claude Code session transcript into per-API-call
 * records (model, tokens, depth, triggering user prompt, session cwd).
 *
 * This is the shared substrate for episode-level analysis (route-scan and the
 * 3.x tier-classification work): one record per API call, deduplicated by
 * requestId (last-write-wins, matching parser.js).
 */

import { transcriptLines } from './transcript-lines.js';
import { resolveModelAlias } from './model-alias.js';

/**
 * Strip context-window suffixes like "[1m]" so model ids compare cleanly, and
 * turn a gateway inference-profile ARN back into a Claude alias. Ids that are
 * already Claude aliases pass through untouched.
 */
export function normalizeModelId(model) {
  const resolved = resolveModelAlias(model || 'unknown');
  return String(resolved).replace(/\[[^\]]*\]$/, '');
}

/** Extract plain text from a Claude transcript message content field. */
function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Parse one session transcript into call records.
 * @returns {Promise<Array<{model, timestamp, prompt_tokens, completion_tokens, depth, userText, assistantText, cwd}>>}
 */
const MUTATING_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'Bash']);
const DELEGATION_TOOLS = new Set(['Task', 'Agent']);
const HANDBACK_TOOL = 'SubagentHandback';

// Permission rejections and harness policy denials arrive as is_error
// tool_results, but they encode the user's choice / the permission system's
// policy, not task difficulty — counting them poisons the rule-health error
// rate. Measured on a 14-day window: 6 user rejections + ~29 auto-mode
// classifier denials out of 142 is_error results (~25% of the numerator).
const REJECTION_RE = /doesn't want to proceed|tool use was rejected|doesn't want to take this action|denied by the claude code auto mode classifier|permission for this action was denied|requires approval/i;

// Harness-mechanical / self-corrected tool errors also arrive as is_error
// tool_results, but they reflect edit-ordering mechanics and the agent's own
// immediate correction loop — not task difficulty. Counting them poisons the
// rule-health error rate the same way permission denials do (v3.4.2). Measured
// on a 14-day window they dominate the numerator (e.g. "File has not been read
// yet" was 7/65 real errors in one project, edit-races + Task-lifecycle several
// more). Kept NARROW on purpose: ambiguous shell failures ("Exit code N", "File
// does not exist" on a Read) stay counted — those are genuine difficulty signal.
// Tool-argument schema violations (InputValidationError, "does not match the
// required schema/pattern") are the model mis-building a call, corrected on
// the next attempt — same self-correction family, not task difficulty.
// Measured 2026-09-09: they were the single largest numerator item (10/125).
const SELF_CORRECTED_RE = /File has not been read yet|has been modified since read|String to replace not found|is not running \(status:|<tool_use_error>Blocked:|InputValidationError|does not match the required/i;

// Failures with no diagnosable content — a bare exit code or "no output" —
// carry no evidence about WHY they failed, so they cannot support a
// rule-health verdict either way. Excluded from the numerator (16% of it was
// this plus schema errors, against a 20% review threshold). Anchored: an
// "Exit code 1" followed by a traceback still counts.
const NO_SIGNAL_RE = /^\s*(Command failed with no output|Exit code \d+)\s*$/;

// Environment constraints — a sandbox without `curl`/`wc`, a corporate proxy
// timing a fetch out — are not task difficulty either. The agent routinely
// routes around them and finishes: one 218-turn run that produced a 9,870-char
// sourced report was scored a failure on two `command not found` results.
// NARROW on purpose: only the shell's own "this binary is absent" wording and
// curl's transport-timeout exit, never a generic non-zero exit.
const ENVIRONMENT_RE = /command not found|curl: \(28\)|Operation timed out after|ETIMEDOUT|ENOTFOUND|getaddrinfo/i;

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join(' ');
}

function isRealToolError(block) {
  if (!block || block.type !== 'tool_result' || !block.is_error) return false;
  const txt = toolResultText(block.content);
  return !REJECTION_RE.test(txt) && !SELF_CORRECTED_RE.test(txt)
    && !ENVIRONMENT_RE.test(txt) && !NO_SIGNAL_RE.test(txt);
}

export async function collectSessionRecords(filePath, { includeContent = true } = {}) {
  const records = new Map();
  const delegationReq = new Map(); // Task/Agent tool_use id → requestId of the record that issued it
  let depth = 0;
  let lastUserText = '';
  let lastCwd = '';
  let lastRecord = null;

  for await (const line of transcriptLines(filePath)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const msg = entry.message;
    if (typeof entry.cwd === 'string' && entry.cwd) lastCwd = entry.cwd;
    if (entry.type === 'user' && msg) {
      depth += 1;
      const text = contentText(msg.content);
      if (text) lastUserText = text;
      // Tool errors arrive as tool_result blocks in the user entry that
      // follows the assistant call — attribute them to that call's record.
      if (lastRecord && Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (isRealToolError(b)) lastRecord.toolErrors += 1;
        }
      }
      // What a Task/Agent call handed back to this session: its size is what
      // stays in the context for every later call (see delegationContexts).
      // A background launch returns only an acknowledgement here; the report
      // itself arrives later, so the entry is marked `async`.
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (!b || b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
          const reqId = delegationReq.get(b.tool_use_id);
          const owner = reqId !== undefined ? records.get(reqId) : null;
          if (!owner) continue;
          const tr = entry.toolUseResult;
          owner.delegationResults[b.tool_use_id] = {
            chars: toolResultText(b.content).length,
            async: !!(tr && typeof tr === 'object' && (tr.isAsync === true || tr.status === 'async_launched')),
          };
        }
      }
      continue;
    }
    if (entry.type !== 'assistant' || !msg) continue;
    depth += 1;

    if (!msg.usage || !msg.id) continue;
    // "<synthetic>" is Claude Code's placeholder for locally-generated
    // entries (e.g. error stubs) — no real API call, nothing to record.
    if (msg.model === '<synthetic>') continue;
    const usage = msg.usage;
    const reqId = entry.requestId || msg.id;

    let mutatingToolCalls = 0;
    let delegationCalls = 0;
    const prev = records.get(reqId);
    // Per-tool call histogram — what the call actually DID. route-scan's
    // categorizer trusts this over the prompt's wording (behavior-first).
    const toolCounts = { ...(prev?.toolCounts || {}) };
    // tool_use ids of Task/Agent calls: the join key to the subagent
    // transcripts under <session>/subagents/*.meta.json, which is how the
    // outcome of a delegation is measured (rule-health v2).
    const delegationToolUseIds = [...(prev?.delegationToolUseIds || [])];
    let textChars = 0;
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b && b.type === 'text' && typeof b.text === 'string') textChars += b.text.length;
        // A subagent that reports through the handback tool puts the report in
        // the tool's `message`, not in a text block.
        if (b && b.type === 'tool_use' && b.name === HANDBACK_TOOL && typeof b.input?.message === 'string') textChars += b.input.message.length;
        if (!b || b.type !== 'tool_use') continue;
        if (MUTATING_TOOLS.has(b.name)) mutatingToolCalls += 1;
        if (DELEGATION_TOOLS.has(b.name)) {
          delegationCalls += 1;
          if (typeof b.id === 'string') {
            delegationToolUseIds.push(b.id);
            delegationReq.set(b.id, reqId);
          }
        }
        if (typeof b.name === 'string') toolCounts[b.name] = (toolCounts[b.name] || 0) + 1;
      }
    }

    lastRecord = {
      model: normalizeModelId(msg.model),
      timestamp: entry.timestamp || null,
      prompt_tokens:
        (usage.input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0) +
        (usage.cache_read_input_tokens || 0),
      completion_tokens: usage.output_tokens || 0,
      // Per-bucket split, kept alongside the collapsed prompt_tokens: pricing
      // differs per bucket, so costing a delegated run against what the
      // session model would have charged needs them separated.
      input_tokens: usage.input_tokens || 0,
      cache_creation_tokens: usage.cache_creation_input_tokens || 0,
      cache_read_tokens: usage.cache_read_input_tokens || 0,
      ephemeral5m: usage.cache_creation?.ephemeral_5m_input_tokens || 0,
      ephemeral1h: usage.cache_creation?.ephemeral_1h_input_tokens || 0,
      depth,
      userText: includeContent ? lastUserText : '',
      assistantText: includeContent ? contentText(msg.content) : '',
      cwd: lastCwd,
      // Entries of the same request accumulate tool blocks and errors.
      mutatingToolCalls: (prev?.mutatingToolCalls || 0) + mutatingToolCalls,
      delegationCalls: (prev?.delegationCalls || 0) + delegationCalls,
      delegationToolUseIds,
      toolErrors: prev?.toolErrors || 0,
      toolCounts,
      // Characters of assistant text; for a subagent transcript the last
      // record's value is the report it hands back to its parent.
      textChars: (prev?.textChars || 0) + textChars,
      // tool_use id → { chars, async } of the result the call received.
      delegationResults: prev?.delegationResults || {},
    };
    records.set(reqId, lastRecord);
  }

  return [...records.values()];
}

/** Later main calls counted for how long a delegation's result stays in context. */
export const CARRY_CAP = 50;
/** A call whose context falls below this share of the one before it follows a compaction. */
export const COMPACTION_RATIO = 0.5;

/**
 * Per Task/Agent tool_use id, what the session around the delegation looked
 * like, from the session's own call records (collectSessionRecords order):
 *   C           context of the call that issued it (input + cache read + cache write)
 *   N           main calls after it in the same session, stopping at the next
 *               compaction (context drops below COMPACTION_RATIO of the call
 *               before) or the end, capped at CARRY_CAP
 *   P           output tokens that call spent writing the prompt (its output
 *               shared evenly between the delegations it issued)
 *   resultChars size of the tool_result that came back, null when none was seen
 *   async       that result was only a background-launch acknowledgement
 * A value that cannot be read stays null, and the caller then declines to use
 * the entry rather than guess.
 */
export function delegationContexts(records) {
  const out = new Map();
  for (let j = 0; j < records.length; j++) {
    const r = records[j];
    const ids = r.delegationToolUseIds || [];
    if (ids.length === 0) continue;
    let n = 0;
    for (let k = j + 1; k < records.length && n < CARRY_CAP; k++) {
      if (records[k].prompt_tokens < records[k - 1].prompt_tokens * COMPACTION_RATIO) break;
      n += 1;
    }
    const ctx = r.prompt_tokens > 0 ? r.prompt_tokens : null;
    const prompt = r.completion_tokens > 0 ? r.completion_tokens / ids.length : null;
    for (const id of ids) {
      const res = r.delegationResults?.[id];
      out.set(id, {
        C: ctx,
        N: n,
        P: prompt,
        resultChars: res ? res.chars : null,
        async: res ? res.async : false,
      });
    }
  }
  return out;
}
