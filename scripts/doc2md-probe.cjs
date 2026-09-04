#!/usr/bin/env node
// Temporary diagnostic. Records what each hook event actually receives, so the
// doc2md coverage question can be answered from evidence rather than from the
// documentation's silence about attachments. Writes one JSON line per
// invocation and prints nothing, so it cannot disturb a session.
//
// Remove once the question is settled: delete the entries this added to
// ~/.claude/settings.json.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT = path.join(os.homedir(), '.claude', 'doc2md-probe.jsonl');

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  /* no stdin */
}

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  payload = { unparsed: raw.slice(0, 2000) };
}

// Keep the shape and the interesting text, drop anything large: a base64
// attachment would make the log unreadable and is not what is being asked.
function summarize(value, depth) {
  if (depth > 4) return '…';
  if (typeof value === 'string') {
    return value.length > 1500 ? `${value.slice(0, 1500)}…[${value.length} chars]` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => summarize(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = summarize(v, depth + 1);
    return out;
  }
  return value;
}

try {
  fs.appendFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(),
    argv: process.argv.slice(2),
    topLevelKeys: payload && typeof payload === 'object' ? Object.keys(payload) : null,
    payload: summarize(payload, 0),
  }) + '\n');
} catch {
  /* an unwritable log is not worth breaking a session over */
}

process.exit(0);
