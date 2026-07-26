import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseSessionFile, getLastUserMessageTime } from '../src/parser.js';

/** Write a JSONL fixture and return its path. */
function fixture(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-parser-'));
  const path = join(dir, 'session.jsonl');
  writeFileSync(path, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function usageEntry({ requestId, id, ts, input = 0, create = 0, read = 0, out = 0, e5m = 0, e1h = 0, model = 'claude-opus-5' }) {
  return {
    requestId,
    timestamp: ts,
    sessionId: 'sess-1',
    message: {
      id,
      model,
      usage: {
        input_tokens: input,
        cache_creation_input_tokens: create,
        cache_read_input_tokens: read,
        output_tokens: out,
        cache_creation: { ephemeral_5m_input_tokens: e5m, ephemeral_1h_input_tokens: e1h },
      },
    },
  };
}

test('parseSessionFile aggregates usage across requests', async () => {
  const { path, cleanup } = fixture([
    usageEntry({ requestId: 'r1', id: 'm1', ts: '2026-07-01T10:00:00Z', input: 10, create: 100, read: 1000, out: 5, e5m: 100 }),
    usageEntry({ requestId: 'r2', id: 'm2', ts: '2026-07-01T10:05:00Z', input: 20, create: 200, read: 2000, out: 7, e1h: 200 }),
  ]);
  try {
    const s = await parseSessionFile(path);
    assert.equal(s.sessionId, 'sess-1');
    assert.equal(s.requestCount, 2);
    assert.deepEqual(s.totals, {
      input: 30, cacheCreation: 300, cacheRead: 3000, ephemeral5m: 100, ephemeral1h: 200, output: 12,
    });
    // maxContextPerRequest is per-request input+create+read, not the sum.
    assert.equal(s.maxContextPerRequest, 20 + 200 + 2000);
    assert.equal(s.startTime.toISOString(), '2026-07-01T10:00:00.000Z');
    assert.equal(s.endTime.toISOString(), '2026-07-01T10:05:00.000Z');
    assert.equal(s.model, 'claude-opus-5');
  } finally {
    cleanup();
  }
});

test('parseSessionFile deduplicates by requestId (last write wins)', async () => {
  const { path, cleanup } = fixture([
    usageEntry({ requestId: 'r1', id: 'm1', ts: '2026-07-01T10:00:00Z', read: 100, out: 1 }),
    usageEntry({ requestId: 'r1', id: 'm1', ts: '2026-07-01T10:00:01Z', read: 500, out: 9 }),
  ]);
  try {
    const s = await parseSessionFile(path);
    assert.equal(s.requestCount, 1, 'streaming chunks of one request must collapse');
    assert.equal(s.totals.cacheRead, 500);
    assert.equal(s.totals.output, 9);
  } finally {
    cleanup();
  }
});

test('parseSessionFile skips malformed lines and entries without usage', async () => {
  const { path, cleanup } = fixture([
    'not json at all',
    { timestamp: '2026-07-01T09:00:00Z', type: 'user', message: { role: 'user' } },
    usageEntry({ requestId: 'r1', id: 'm1', ts: '2026-07-01T10:00:00Z', read: 42 }),
  ]);
  try {
    const s = await parseSessionFile(path);
    assert.equal(s.requestCount, 1);
    assert.equal(s.totals.cacheRead, 42);
    // Timestamps come from every entry, including the non-usage user message.
    assert.equal(s.startTime.toISOString(), '2026-07-01T09:00:00.000Z');
  } finally {
    cleanup();
  }
});

test('getLastUserMessageTime returns the newest user entry only', async () => {
  const { path, cleanup } = fixture([
    { type: 'user', timestamp: '2026-07-01T10:00:00Z' },
    { type: 'assistant', timestamp: '2026-07-01T10:01:00Z' },
    { type: 'user', timestamp: '2026-07-01T10:02:00Z' },
    { type: 'assistant', timestamp: '2026-07-01T10:03:00Z' },
  ]);
  try {
    const t = await getLastUserMessageTime(path);
    assert.equal(t.toISOString(), '2026-07-01T10:02:00.000Z');
  } finally {
    cleanup();
  }
});

test('getLastUserMessageTime returns null for a missing file', async () => {
  assert.equal(await getLastUserMessageTime('/nonexistent/session.jsonl'), null);
});
