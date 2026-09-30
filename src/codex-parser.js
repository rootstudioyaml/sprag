import { createReadStream, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { codexUserDir } from './agent.js';

const count = (n) => Number.isSafeInteger(n) && n >= 0 ? n : 0;
const emptyTotals = () => ({ input: 0, cacheRead: 0, cacheCreation: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0 });

/**
 * A child spawned with fork_turns "all" writes its own session_meta first,
 * then a copy of the parent's session_meta and history, then its own work.
 * The copy belongs to the parent: identity comes from the first session_meta,
 * and the copied lines are skipped so the parent's request is not counted a
 * second time. The copy ends at the child's own thread_settings_applied, or
 * at the first line written after the batch copy, whichever comes first.
 */
export function forkedCopyFilter() {
  let ownId = null, copyStamp = null;
  return (e) => {
    const p = e?.payload;
    if (e?.type === 'session_meta') {
      const id = p?.id || p?.session_id || null;
      if (ownId === null) { ownId = id; return false; }
      // A resumed rollout can repeat its own meta; only another thread's is a copy.
      if (id && id !== ownId) { copyStamp = e.timestamp ?? null; return true; }
      return true;
    }
    if (copyStamp === null) return false;
    const own = e?.type === 'event_msg' && p?.type === 'thread_settings_applied' && p.thread_id === ownId;
    if (own || e?.timestamp !== copyStamp) { copyStamp = null; return false; }
    return true;
  };
}

function updateSnapshot(session, e) {
  const p = e?.payload;
  if (!p || typeof p !== 'object') return;
  const activity = Date.parse(e.timestamp);
  if (Number.isFinite(activity)) session.lastActivity = new Date(activity);
  if (e.type === 'session_meta') {
    // Callers drop forked copies, so a later meta can only be this thread's own repeat.
    if (session.sessionId) return;
    session.sessionId = p.id || p.session_id || null;
    session.projectDir = typeof p.cwd === 'string' ? p.cwd : '';
    session.source = p.source ?? null;
    session.isSubagent = typeof p.source === 'object' && p.source !== null && 'subagent' in p.source;
    session.forkedFrom = typeof p.forked_from_id === 'string' ? p.forked_from_id : null;
    session.branch = typeof p.git?.branch === 'string' ? p.git.branch : null;
    session.provider = typeof p.model_provider === 'string' ? p.model_provider : null;
  }
  if (e.type === 'turn_context') {
    if (typeof p.model === 'string') session.model = p.model;
    const effort = p.effort ?? p.reasoning_effort;
    if (typeof effort === 'string') session.effort = effort;
  }
  if (e.type !== 'event_msg') return;
  if (p.type === 'task_started') session.status = 'working';
  if (p.type === 'task_complete') session.status = 'idle';
  if (p.type === 'turn_aborted') session.status = 'interrupted';
  if (p.type !== 'token_count') return;
  if (p.rate_limits && typeof p.rate_limits === 'object') {
    session.rateLimits = p.rate_limits;
    session.rateLimitsAt = Number.isFinite(activity) ? new Date(activity) : null;
  }
  if (Number.isSafeInteger(p.info?.last_token_usage?.input_tokens) && p.info.last_token_usage.input_tokens >= 0) {
    session.lastContextTokens = p.info.last_token_usage.input_tokens;
    session.contextAt = Number.isFinite(activity) ? new Date(activity) : null;
  }
  if (count(p.info?.model_context_window)) session.contextWindow = p.info.model_context_window;
}

/** The last `tailBytes` of a rollout as whole lines; a cut first line is dropped. */
export function readCodexTailLines(filePath, tailBytes = 256 * 1024) {
  if (!filePath) return null;
  let fd;
  try {
    fd = openSync(filePath, 'r');
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - tailBytes);
    const buffer = Buffer.alloc(size - start);
    const length = readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.subarray(0, length).toString('utf8').split('\n');
    if (start) lines.shift();
    return lines;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** Prompt hooks only need the newest measurements, never a full usage scan. */
export function readCodexSnapshot(filePath, { tailBytes = 256 * 1024 } = {}) {
  const lines = readCodexTailLines(filePath, tailBytes);
  if (!lines) return null;
  const snapshot = {};
  const copied = forkedCopyFilter();
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (!copied(e)) updateSnapshot(snapshot, e);
    } catch { /* Partial or malformed record. */ }
  }
  return snapshot;
}

const textOf = (content) => (Array.isArray(content) ? content : [])
  .filter((c) => c && typeof c.text === 'string').map((c) => c.text).join('\n');
// Legacy outputs carry the exit status only as text inside the tool result.
const exitFromText = (text) => {
  const m = /(?:^|\n)(?:Process exited with code|Exit code:)\s*(-?\d+)/.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
};
const fileCwd = (value) => typeof value === 'string' ? value.replace(/^file:\/\//, '') : null;

/**
 * Tool events of one rollout record, in a shape both formats share.
 * Current rollouts carry structured `item_completed` items; older ones carry
 * `exec_command_end`/`patch_apply_end`, and the oldest only a text exit line.
 */
export function codexToolEvents(e) {
  const p = e?.payload;
  if (!p || typeof p !== 'object') return [];
  const at = Date.parse(e.timestamp);
  if (e.type === 'event_msg' && p.type === 'item_completed' && p.item && typeof p.item === 'object') {
    const it = p.item;
    const base = { turnId: p.turn_id || null, threadId: p.thread_id || null, callId: it.id || null, at };
    if (it.type === 'UserMessage') return [{ kind: 'user', ...base, text: textOf(it.content) }];
    if (it.type === 'CommandExecution') return [{ kind: 'command', ...base,
      argv: Array.isArray(it.command) ? it.command.map(String) : [String(it.command ?? '')],
      parsed: Array.isArray(it.parsed_cmd) ? it.parsed_cmd : [],
      exit: Number.isInteger(it.exit_code) ? it.exit_code : null,
      failed: it.status === 'failed' || (Number.isInteger(it.exit_code) && it.exit_code !== 0),
      output: String(it.aggregated_output ?? it.formatted_output ?? it.stdout ?? ''),
      cwd: fileCwd(it.cwd) }];
    if (it.type === 'FileChange') return [{ kind: 'patch', ...base, failed: it.status === 'failed',
      output: String(it.stderr || it.stdout || '') }];
    if (it.type === 'McpToolCall') return [{ kind: 'mcp', ...base, failed: it.status === 'failed' }];
    return [];
  }
  if (e.type === 'event_msg' && p.type === 'exec_command_end') {
    return [{ kind: 'command', turnId: p.turn_id || null, threadId: null, callId: p.call_id || null, at,
      argv: Array.isArray(p.command) ? p.command.map(String) : [String(p.command ?? '')],
      parsed: Array.isArray(p.parsed_cmd) ? p.parsed_cmd : [],
      exit: Number.isInteger(p.exit_code) ? p.exit_code : null,
      failed: p.status === 'failed' || (Number.isInteger(p.exit_code) && p.exit_code !== 0),
      output: String(p.aggregated_output ?? p.formatted_output ?? p.stdout ?? ''), cwd: fileCwd(p.cwd) }];
  }
  if (e.type === 'event_msg' && p.type === 'patch_apply_end') {
    return [{ kind: 'patch', turnId: p.turn_id || null, threadId: null, callId: p.call_id || null, at,
      failed: p.success === false || p.status === 'failed', output: String(p.stderr || p.stdout || '') }];
  }
  if (e.type === 'event_msg' && p.type === 'user_message' && typeof p.message === 'string') {
    return [{ kind: 'user', turnId: p.turn_id || null, threadId: null, callId: null, at, text: p.message, legacy: true }];
  }
  if (e.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) {
    return [{ kind: 'call', name: String(p.name ?? ''), callId: p.call_id || null, at,
      input: typeof p.arguments === 'string' ? p.arguments : typeof p.input === 'string' ? p.input : '' }];
  }
  if (e.type === 'response_item' && (p.type === 'function_call_output' || p.type === 'custom_tool_call_output')) {
    const text = typeof p.output === 'string' ? p.output : textOf(p.output);
    return [{ kind: 'output', callId: p.call_id || null, at, exit: exitFromText(text), output: text }];
  }
  return [];
}

// Map each Codex tool call onto the Claude tool names route-scan's behavior
// pool counts, one name per call: lookup-only commands are lookups, anything
// else a shell command could have done is a run.
function behaviorName(ev) {
  if (ev.kind === 'patch') return 'Edit';
  if (ev.kind === 'mcp') return 'Mcp';
  if (ev.kind !== 'command') return null;
  const types = ev.parsed.map((c) => c?.type);
  if (!types.length || types.includes('unknown')) return 'Bash';
  if (types.every((t) => t === 'search')) return 'Grep';
  if (types.every((t) => t === 'list_files')) return 'LS';
  return 'Read';
}

/** Fill in a tool result only when no structured completion describes it. */
export function codexLegacyToolEvent(call, out) {
  if (!/^(?:functions\.|tools\.)?(?:exec_command|shell_command|shell|exec|apply_patch)$/.test(call?.name || '')) return null;
  if (/apply_patch$/.test(call.name)) return { ...out, kind: 'patch', failed: out.exit !== 0 };
  let input;
  try { input = JSON.parse(call.input); } catch { /* Older calls can carry plain commands. */ }
  const command = input?.cmd ?? input?.command ?? call.input ?? '';
  return { ...out, kind: 'command', argv: Array.isArray(command) ? command : [String(command)],
    parsed: [], failed: out.exit !== 0, cwd: input?.workdir || null };
}

const emptyTurn = (turnId) => ({ turnId, startedAt: null, endedAt: null, aborted: false, model: null, effort: null, cwd: null,
  text: '', userMessages: 0, calls: 0, out: 0, input: 0, cached: 0, cacheWrite: 0, tools: {}, mutating: 0, errors: 0,
  delegated: 0, commands: [], patches: [], usageKnown: false });

/**
 * One rollout as turns, for scans that need per-turn behavior rather than
 * session totals. Legacy "Process exited" text only fills in a call no
 * structured event described, so a call is never counted twice.
 */
export async function parseCodexTurns(filePath, { cutoffMs = -Infinity } = {}) {
  const session = { filePath, sessionId: null, projectDir: '', isSubagent: false, parentThreadId: null, forkedFrom: null, provider: null, turns: [] };
  const copied = forkedCopyFilter();
  const turns = new Map();
  const turnOf = (id) => {
    if (!id) return null;
    if (!turns.has(id)) turns.set(id, emptyTurn(id));
    return turns.get(id);
  };
  const seenCalls = new Set();
  const calls = new Map();
  const legacy = [];
  const modernUsage = new Map();
  let previousUsage = null;
  let current = null;
  let context = { model: null, effort: null, cwd: null };
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const p = e?.payload;
    if (!p || typeof p !== 'object' || copied(e)) continue;
    if (e.type === 'session_meta') {
      if (session.sessionId) continue;
      session.sessionId = p.id || p.session_id || null;
      session.projectDir = typeof p.cwd === 'string' ? p.cwd : '';
      session.isSubagent = typeof p.source === 'object' && p.source !== null && 'subagent' in p.source;
      session.parentThreadId = p.source?.subagent?.thread_spawn?.parent_thread_id || null;
      session.forkedFrom = typeof p.forked_from_id === 'string' ? p.forked_from_id : null;
      session.provider = typeof p.model_provider === 'string' ? p.model_provider : null;
      continue;
    }
    if (e.type === 'turn_context') {
      context = { model: typeof p.model === 'string' ? p.model : context.model,
        effort: typeof (p.effort ?? p.reasoning_effort) === 'string' ? (p.effort ?? p.reasoning_effort) : context.effort,
        cwd: typeof p.cwd === 'string' ? p.cwd : context.cwd };
      const t = turnOf(p.turn_id || current);
      if (t) Object.assign(t, { model: context.model, effort: context.effort, cwd: context.cwd });
      continue;
    }
    if (e.type === 'event_msg' && p.type === 'task_started') {
      current = p.turn_id || null;
      const t = turnOf(current);
      if (t) {
        t.startedAt ??= Number.isFinite(Number(p.started_at)) ? Number(p.started_at) * 1000 : Date.parse(e.timestamp);
        t.model ??= context.model; t.effort ??= context.effort; t.cwd ??= context.cwd;
      }
      continue;
    }
    if (e.type === 'event_msg' && (p.type === 'task_complete' || p.type === 'turn_aborted')) {
      const t = turnOf(p.turn_id || current);
      if (t) {
        t.endedAt = Number.isFinite(Number(p.completed_at)) ? Number(p.completed_at) * 1000 : Date.parse(e.timestamp);
        if (p.type === 'turn_aborted') t.aborted = true;
      }
      continue;
    }
    if (e.type === 'token_usage_record') {
      const t = turnOf(p.turn_id);
      const u = p.turn_token_usage || p.usage;
      if (t && Number.isSafeInteger(u?.input_tokens) && Number.isSafeInteger(u?.output_tokens)) {
        const usage = { out: count(u.output_tokens), input: count(u.input_tokens),
          cached: count(u.cached_input_tokens), cacheWrite: count(u.cache_write_input_tokens) };
        const old = modernUsage.get(t.turnId);
        if (!p.turn_token_usage && old) for (const key of Object.keys(usage)) usage[key] += old[key];
        modernUsage.set(t.turnId, { ...usage, calls: (old?.calls || 0) + 1, usageKnown: true });
      }
      continue;
    }
    if (e.type === 'event_msg' && p.type === 'token_count') {
      const u = p.info?.total_token_usage;
      if (!Number.isSafeInteger(u?.input_tokens) || !Number.isSafeInteger(u?.output_tokens)) continue;
      const usage = { input: count(u.input_tokens), out: count(u.output_tokens),
        cached: count(u.cached_input_tokens), cacheWrite: count(u.cache_write_input_tokens) };
      const reset = previousUsage && (usage.input < previousUsage.input || usage.out < previousUsage.out);
      const base = reset ? null : previousUsage;
      const delta = Object.fromEntries(Object.entries(usage).map(([key, value]) => [key, Math.max(0, value - (base?.[key] || 0))]));
      previousUsage = usage;
      const t = turnOf(p.turn_id || current);
      if (t && (delta.input || delta.out)) {
        for (const [key, value] of Object.entries(delta)) t[key] += value;
        t.calls++;
        t.usageKnown = true;
      }
      continue;
    }
    for (const ev of codexToolEvents(e)) {
      if (ev.kind === 'call') {
        if (ev.callId) calls.set(ev.callId, ev);
        const t = turnOf(current);
        if (t && /^(?:functions\.|tools\.)?spawn_agent$/.test(ev.name)) t.delegated++;
        continue;
      }
      if (ev.kind === 'output') { if (ev.exit !== null && ev.callId) legacy.push({ ...ev, turnId: current }); continue; }
      const t = turnOf(ev.turnId || current);
      if (!t) continue;
      if (ev.kind === 'user') {
        t.userMessages++;
        if (!t.text) t.text = ev.text.trim();
        continue;
      }
      if (ev.callId) {
        if (seenCalls.has(ev.callId)) continue;
        seenCalls.add(ev.callId);
      }
      const name = behaviorName(ev);
      if (name) t.tools[name] = (t.tools[name] || 0) + 1;
      if (name === 'Bash' || name === 'Edit') t.mutating++;
      if (ev.failed) t.errors++;
      if (ev.kind === 'command') t.commands.push(ev);
      if (ev.kind === 'patch') t.patches.push(ev);
    }
  }
  for (const out of legacy) {
    if (seenCalls.has(out.callId)) continue;
    const t = turnOf(out.turnId);
    const call = calls.get(out.callId);
    // write_stdin/wait poll a command that is already running; only calls that
    // start work count, or one long command becomes several.
    const ev = codexLegacyToolEvent(call, out);
    if (!t || !ev) continue;
    seenCalls.add(out.callId);
    const name = behaviorName(ev);
    t.tools[name] = (t.tools[name] || 0) + 1;
    t.mutating++;
    if (ev.failed) t.errors++;
    (ev.kind === 'patch' ? t.patches : t.commands).push(ev);
  }
  for (const [id, usage] of modernUsage) Object.assign(turns.get(id), usage);
  session.turns = [...turns.values()].filter((t) => (t.startedAt ?? t.endedAt ?? 0) >= cutoffMs || !Number.isFinite(t.startedAt ?? t.endedAt));
  return session;
}

/** Rollout JSONL is a best-effort local format, not a stable Codex API. */
export async function parseCodexSessionFile(filePath, { cutoffMs = -Infinity } = {}) {
  const session = {
    agent: 'codex', sessionId: null, filePath, projectDir: '', model: 'unknown',
    startTime: null, endTime: null, requestCount: 0, totals: emptyTotals(),
    maxContextPerRequest: 0, reasoningOutputTokens: 0, contextWindow: null,
    lastContextTokens: null, rateLimits: null, lastActivity: null, effort: null,
    cacheActivity: null,
  };
  const copied = forkedCopyFilter();
  let previous = null;
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const p = e?.payload;
    if (!p || copied(e)) continue;
    updateSnapshot(session, e);
    if (e.type !== 'event_msg' || p.type !== 'token_count') continue;
    if (!p.info) continue;
    const info = p.info;
    const total = info.total_token_usage;
    // Repeated token_count events also carry rate-limit updates. Only a
    // change in cumulative usage represents newly consumed tokens.
    if (!total || !Number.isSafeInteger(total.input_tokens) || !Number.isSafeInteger(total.output_tokens)) continue;
    const current = {
      input: count(total.input_tokens), cached: count(total.cached_input_tokens),
      written: count(total.cache_write_input_tokens),
      output: count(total.output_tokens), reasoning: count(total.reasoning_output_tokens),
    };
    const reset = previous && (current.input < previous.input || current.output < previous.output);
    const base = reset || !previous ? { input: 0, cached: 0, written: 0, output: 0, reasoning: 0 } : previous;
    const delta = Object.fromEntries(Object.keys(current).map((k) => [k, Math.max(0, current[k] - base[k])]));
    previous = current;
    if (!delta.input && !delta.output) continue;
    const ts = Date.parse(e.timestamp);
    // Quota-only snapshots repeat cumulative usage. Only newly observed cache
    // reads/writes refresh the clock, never local tools or repeated snapshots.
    if (Number.isFinite(ts) && delta.input > 0 && (delta.cached > 0 || delta.written > 0) &&
        (!session.cacheActivity || ts >= session.cacheActivity.at.getTime())) {
      session.cacheActivity = { at: new Date(ts), model: session.model, provider: session.provider,
        cached: Math.min(delta.input, delta.cached), written: Math.min(delta.input, delta.written) };
    }
    if (!Number.isFinite(ts) || ts < cutoffMs) continue;
    const cached = Math.min(delta.input, delta.cached);
    session.totals.input += delta.input - cached;
    session.totals.cacheRead += cached;
    session.totals.output += delta.output;
    // Reasoning is a subset of output, just as cached input is a subset of input.
    session.reasoningOutputTokens += Math.min(delta.output, delta.reasoning);
    session.requestCount++;
    session.startTime ??= new Date(ts);
    session.endTime = new Date(ts);
    session.maxContextPerRequest = Math.max(session.maxContextPerRequest, count(info.last_token_usage?.input_tokens));
    if (count(info.model_context_window)) session.contextWindow = info.model_context_window;
  }
  return session;
}

export async function discoverCodexSessionFiles({ home = codexUserDir(), days = 30, excludeSessionPath } = {}) {
  const cutoff = Date.now() - days * 86400000;
  const files = [];
  const excluded = excludeSessionPath ? resolve(excludeSessionPath) : null;
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith('.jsonl') && resolve(path) !== excluded) {
        try {
          const s = await stat(path);
          if (s.mtimeMs >= cutoff) files.push({ path, mtime: s.mtimeMs, size: s.size });
        } catch { /* A session may disappear during archival. */ }
      }
    }
  }
  await walk(join(home, 'sessions'));
  await walk(join(home, 'archived_sessions'));
  return files.sort((a, b) => a.mtime - b.mtime);
}

export async function parseAllCodexSessions(options = {}) {
  const files = await discoverCodexSessionFiles(options);
  const cutoffMs = Date.now() - (options.days ?? 30) * 86400000;
  const results = [];
  for (let i = 0; i < files.length; i += 10) {
    const batch = await Promise.all(files.slice(i, i + 10).map(async ({ path }) => {
      try { return await parseCodexSessionFile(path, { cutoffMs }); } catch { return null; }
    }));
    results.push(...batch.filter((s) => s?.requestCount && (!options.projectFilter || s.projectDir.includes(options.projectFilter))));
  }
  // An archive can briefly coexist with the original rollout.
  const seen = new Set();
  return results.reverse().filter((s) => {
    const key = s.sessionId || s.filePath;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).reverse();
}
