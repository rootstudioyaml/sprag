import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { loadCache, getCached, putCached, saveCache } from './session-cache.js';
import { resolveModelAlias, isGatewayModelId } from './model-alias.js';

const CLAUDE_DIR = join(homedir(), '.claude', 'projects');

/**
 * Keys LiteLLM adds when it rewrites a Bedrock response into Anthropic shape.
 * A stock Anthropic `usage` object carries none of them, so their presence is
 * evidence of a gateway even when the model id looks ordinary. It is weak
 * evidence — another gateway may not add them — so it is only consulted after
 * the model id has already failed to answer the question.
 */
const GATEWAY_USAGE_KEYS = ['inference_geo', 'iterations', 'speed'];

function usageLooksGatewayShaped(usage) {
  return GATEWAY_USAGE_KEYS.some((k) => Object.prototype.hasOwnProperty.call(usage, k));
}

/**
 * Parse a single session JSONL file.
 * Deduplicates by requestId (last-write-wins for streaming chunks).
 */
export async function parseSessionFile(filePath) {
  const requests = new Map();
  let sessionId = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let gatewayObserved = false;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = entry.timestamp;
    if (ts) {
      if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
      if (!lastTimestamp || ts > lastTimestamp) lastTimestamp = ts;
    }

    if (!sessionId && entry.sessionId) {
      sessionId = entry.sessionId;
    }

    const msg = entry.message;
    if (!msg?.usage || !msg.id) continue;

    const usage = msg.usage;
    const cc = usage.cache_creation || {};
    const reqId = entry.requestId || msg.id;

    // Recorded from the RAW id, before resolveModelAlias() turns the ARN into
    // a plain model name. Downstream this is the only thing that distinguishes
    // "no cache writes yet" from "a gateway that never reports the TTL split",
    // and those two states want opposite countdown defaults.
    if (!gatewayObserved && (isGatewayModelId(msg.model) || usageLooksGatewayShaped(usage))) {
      gatewayObserved = true;
    }

    requests.set(reqId, {
      requestId: reqId,
      // Per-request timestamp so callers can filter by time window — the
      // mtime-based file filter alone lets a long-lived session drag
      // months-old requests into a narrow --days window.
      ts: ts ? Date.parse(ts) : null,
      model: resolveModelAlias(msg.model),
      inputTokens: usage.input_tokens || 0,
      cacheCreationTokens: usage.cache_creation_input_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
      ephemeral5mTokens: cc.ephemeral_5m_input_tokens || 0,
      ephemeral1hTokens: cc.ephemeral_1h_input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
    });
  }

  const reqs = [...requests.values()];
  let maxContextPerRequest = 0;
  // Representative model: the one that handled the most requests, skipping
  // "<synthetic>" (Claude Code's local error-stub placeholder — no real API
  // call). Taking reqs[0] blindly let an error stub at session start
  // misclassify the whole session (route-scan.js already counts for the same
  // reason). Falls back to '<synthetic>' only when nothing else exists.
  const modelCounts = new Map();
  for (const r of reqs) {
    if (r.model === '<synthetic>') continue;
    modelCounts.set(r.model, (modelCounts.get(r.model) || 0) + 1);
  }
  let model = 'unknown';
  let best = 0;
  for (const [m, n] of modelCounts) {
    if (n > best) { best = n; model = m; }
  }
  if (best === 0 && reqs.length > 0) model = reqs[0].model || 'unknown';
  const totals = reqs.reduce(
    (acc, r) => {
      acc.input += r.inputTokens;
      acc.cacheCreation += r.cacheCreationTokens;
      acc.cacheRead += r.cacheReadTokens;
      acc.ephemeral5m += r.ephemeral5mTokens;
      acc.ephemeral1h += r.ephemeral1hTokens;
      acc.output += r.outputTokens;
      const ctx = r.inputTokens + r.cacheCreationTokens + r.cacheReadTokens;
      if (ctx > maxContextPerRequest) maxContextPerRequest = ctx;
      return acc;
    },
    { input: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0 },
  );

  return {
    sessionId,
    filePath,
    startTime: firstTimestamp ? new Date(firstTimestamp) : null,
    endTime: lastTimestamp ? new Date(lastTimestamp) : null,
    requestCount: reqs.length,
    requests: reqs,
    totals,
    maxContextPerRequest,
    model,
    gatewayObserved,
  };
}

/**
 * Find the most recent user-message timestamp in a session JSONL.
 * Used for statusline mode so the agent's own tool calls don't reset the TTL
 * countdown — only the user's actual prompts (type === "user") do.
 *
 * @param {string} filePath absolute path to the session JSONL
 * @returns {Promise<Date|null>}
 */
export async function getLastUserMessageTime(filePath) {
  let lastUserTs = null;
  try {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'user' && entry.timestamp) {
          lastUserTs = entry.timestamp;
        }
      } catch {
        // ignore malformed lines
      }
    }
  } catch {
    return null;
  }
  return lastUserTs ? new Date(lastUserTs) : null;
}

/**
 * Discover all session JSONL files under ~/.claude/projects/
 */
export async function discoverSessionFiles(options = {}) {
  const { projectFilter, days = 30, excludeSessionPath } = options;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const files = [];
  // Resolve the excluded session to an absolute path so equality checks are exact.
  // Use path.isAbsolute() so Windows paths like C:\... are recognized too.
  const excludeAbs = excludeSessionPath
    ? (isAbsolute(excludeSessionPath) ? excludeSessionPath : join(process.cwd(), excludeSessionPath))
    : null;

  let projectDirs;
  try {
    projectDirs = await readdir(CLAUDE_DIR);
  } catch {
    return files;
  }

  for (const projDir of projectDirs) {
    if (projectFilter && !projDir.includes(projectFilter)) continue;

    const projPath = join(CLAUDE_DIR, projDir);
    let entries;
    try {
      entries = await readdir(projPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const fp = join(projPath, entry);
      if (excludeAbs && fp === excludeAbs) continue;
      try {
        const s = await stat(fp);
        if (s.mtimeMs >= cutoff) {
          // `size` pairs with `mtime` as the session-cache key — transcripts
          // are append-only, so the pair identifies a parse result exactly.
          files.push({ path: fp, projectDir: projDir, mtime: s.mtimeMs, size: s.size });
        }
      } catch {
        continue;
      }
    }
  }

  return files.sort((a, b) => a.mtime - b.mtime);
}

/**
 * Parse all sessions with concurrency control, backed by the (path, mtime,
 * size) session cache so repeated runs — above all the statusline, which
 * re-runs this every few seconds — only touch transcripts that changed.
 *
 * The returned sessions carry the aggregate summary WITHOUT the per-request
 * array: it is an aggregation detail no consumer reads, and omitting it on
 * both the cache-hit and fresh-parse paths keeps the two shapes identical.
 * Call `parseSessionFile` directly if you need the raw requests.
 *
 * @param {object} [options] forwarded to discoverSessionFiles
 * @param {boolean} [options.noCache=false] bypass the cache entirely
 */
function spansCutoff(session, cutoffMs) {
  return !!(session.startTime && session.startTime.getTime() < cutoffMs);
}

/**
 * Re-aggregate a fully parsed session keeping only requests at or after the
 * cutoff. Requests without a timestamp are kept — dropping data on a missing
 * field would be worse than slight over-counting.
 */
function trimToCutoff(session, cutoffMs) {
  const reqs = (session.requests || []).filter((r) => r.ts == null || r.ts >= cutoffMs);
  let maxContextPerRequest = 0;
  let firstTs = null;
  let lastTs = null;
  const totals = reqs.reduce(
    (acc, r) => {
      acc.input += r.inputTokens;
      acc.cacheCreation += r.cacheCreationTokens;
      acc.cacheRead += r.cacheReadTokens;
      acc.ephemeral5m += r.ephemeral5mTokens;
      acc.ephemeral1h += r.ephemeral1hTokens;
      acc.output += r.outputTokens;
      const ctx = r.inputTokens + r.cacheCreationTokens + r.cacheReadTokens;
      if (ctx > maxContextPerRequest) maxContextPerRequest = ctx;
      if (r.ts != null) {
        if (firstTs === null || r.ts < firstTs) firstTs = r.ts;
        if (lastTs === null || r.ts > lastTs) lastTs = r.ts;
      }
      return acc;
    },
    { input: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0 },
  );
  return {
    sessionId: session.sessionId,
    filePath: session.filePath,
    projectDir: session.projectDir,
    startTime: firstTs !== null ? new Date(firstTs) : session.startTime,
    endTime: lastTs !== null ? new Date(lastTs) : session.endTime,
    requestCount: reqs.length,
    totals,
    maxContextPerRequest,
    model: session.model,
    gatewayObserved: session.gatewayObserved,
  };
}

export async function parseAllSessions(options = {}) {
  const files = await discoverSessionFiles(options);
  const concurrency = 10;
  const results = [];
  const useCache = !options.noCache;
  const cache = useCache ? loadCache() : { entries: {} };
  let misses = 0;
  // The file-level mtime filter (discoverSessionFiles) is only a cheap
  // pre-selection: a session started months ago but touched today passes it,
  // and its old requests would pollute every aggregate in the window. Any
  // session whose startTime precedes the cutoff is re-aggregated from its
  // per-request timestamps. The trimmed summary is NOT cached — the cache
  // stores the window-independent full parse.
  const days = options.days ?? 30;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const parsed = await Promise.all(
      batch.map(async (f) => {
        try {
          if (useCache) {
            const hit = getCached(cache, f);
            if (hit) {
              if (!spansCutoff(hit, cutoffMs)) return hit;
              // Boundary session from cache: the cached summary has no
              // per-request data, so re-read the file to trim it.
              const full = await parseSessionFile(f.path);
              full.projectDir = f.projectDir;
              return trimToCutoff(full, cutoffMs);
            }
          }
          const session = await parseSessionFile(f.path);
          session.projectDir = f.projectDir;
          if (useCache) {
            putCached(cache, f, session);
            misses++;
          }
          if (spansCutoff(session, cutoffMs)) return trimToCutoff(session, cutoffMs);
          const { requests, ...summary } = session;
          return summary;
        } catch {
          return null;
        }
      }),
    );
    results.push(...parsed.filter(Boolean));
  }

  if (useCache && misses > 0) saveCache(cache);

  return results.filter((s) => s.requestCount > 0);
}
