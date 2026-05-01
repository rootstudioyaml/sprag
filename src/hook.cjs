#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook — standalone, zero dependencies, CommonJS.
 * Appends per-session cache stats to ~/.claude/cache-stats.jsonl.
 * Warns if hit rate drops below threshold.
 *
 * Written in CommonJS so it works standalone in ~/.claude/ without package.json.
 *
 * Receives hook context on stdin:
 *   { session_id, transcript_path, cwd, tool_name, tool_input, tool_response }
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const STATS_FILE = path.join(os.homedir(), '.claude', 'cache-stats.jsonl');
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Parse threshold from args
let threshold = 0.7;
const thIdx = process.argv.indexOf('--threshold');
if (thIdx !== -1 && process.argv[thIdx + 1]) {
  threshold = parseFloat(process.argv[thIdx + 1]);
}

// Read stdin (hook context)
let stdin = '';
try {
  stdin = fs.readFileSync(0, 'utf8');
} catch {
  // no stdin
}

let context;
try {
  context = JSON.parse(stdin);
} catch {
  process.exit(0);
}

const sessionId = context.session_id;
const cwd = context.cwd || '';
if (!sessionId) process.exit(0);

// Resolve session file: prefer transcript_path, fallback to directory scan
function resolveSessionFile() {
  // Method 1: transcript_path (Claude Code v2.1.85+)
  if (context.transcript_path) {
    try {
      fs.statSync(context.transcript_path);
      return context.transcript_path;
    } catch {
      // path provided but file not found, try fallback
    }
  }

  // Method 2: scan projects directory (older versions)
  try {
    const dirs = fs.readdirSync(PROJECTS_DIR);
    for (const d of dirs) {
      const fp = path.join(PROJECTS_DIR, d, `${sessionId}.jsonl`);
      try {
        fs.statSync(fp);
        return fp;
      } catch {
        // not here
      }
    }
  } catch {
    // no projects dir
  }

  return null;
}

const sessionFile = resolveSessionFile();
if (!sessionFile) process.exit(0);

// Parse session file
let content;
try {
  content = fs.readFileSync(sessionFile, 'utf8');
} catch {
  process.exit(0);
}

const lines = content.trim().split('\n');
const requests = new Map();

for (const line of lines) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }

  const msg = entry.message;
  if (!msg || !msg.usage || !msg.id) continue;

  const u = msg.usage;
  const cc = u.cache_creation || {};
  const reqId = entry.requestId || msg.id;

  requests.set(reqId, {
    input: u.input_tokens || 0,
    cacheCreation: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    ephemeral5m: cc.ephemeral_5m_input_tokens || 0,
    ephemeral1h: cc.ephemeral_1h_input_tokens || 0,
    output: u.output_tokens || 0,
    model: msg.model || 'unknown',
  });
}

if (requests.size === 0) process.exit(0);

const reqs = Array.from(requests.values());
const totals = reqs.reduce(
  function (a, r) {
    a.input += r.input;
    a.cacheCreation += r.cacheCreation;
    a.cacheRead += r.cacheRead;
    a.ephemeral5m += r.ephemeral5m;
    a.ephemeral1h += r.ephemeral1h;
    a.output += r.output;
    return a;
  },
  { input: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0 },
);

const totalInput = totals.cacheRead + totals.cacheCreation + totals.input;
const hitRate = totalInput > 0 ? totals.cacheRead / totalInput : 0;

const record = {
  timestamp: new Date().toISOString(),
  sessionId: sessionId,
  cwd: cwd,
  apiCalls: requests.size,
  hitRate: Math.round(hitRate * 10000) / 10000,
  tokens: {
    input: totals.input,
    cacheCreation: totals.cacheCreation,
    cacheRead: totals.cacheRead,
    ephemeral5m: totals.ephemeral5m,
    ephemeral1h: totals.ephemeral1h,
    output: totals.output,
  },
  model: reqs[0] ? reqs[0].model : 'unknown',
};

// Append to stats file
try {
  fs.appendFileSync(STATS_FILE, JSON.stringify(record) + '\n', 'utf8');
} catch {
  // can't write, ignore
}

// Alert if hit rate below threshold
if (hitRate < threshold && requests.size >= 5) {
  var pct = (hitRate * 100).toFixed(1);
  var ccTotal = totals.ephemeral5m + totals.ephemeral1h;
  var pct5m = ccTotal > 0 ? ((totals.ephemeral5m / ccTotal) * 100).toFixed(0) : '0';
  process.stdout.write(
    '\u26a0 Cache hit rate: ' + pct + '% (threshold: ' + (threshold * 100).toFixed(0) + '%) | 5m TTL: ' + pct5m + '% | ' + requests.size + ' API calls\n',
  );
}

// Harness analysis \u2014 best-effort, never throws into the hook stream. The
// statusline picks up the resulting state file (`harness-state.json`) on
// the next render, so warnings appear within ~1s of the triggering turn.
try {
  var harnessAnalyzer = require('./harness-analyzer.cjs');
  var state = harnessAnalyzer.analyzeTranscript(sessionFile, {
    sessionId: sessionId,
    cwd: cwd,
  });
  if (state) harnessAnalyzer.writeState(state);
} catch (_) {
  // analyzer is purely advisory \u2014 never break the hook on failure
}
