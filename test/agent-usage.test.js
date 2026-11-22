/**
 * claudeSessionDetail: the per-session facts the Sprag Bar rows show, read from
 * the transcript tail and the parse cache the statusline keeps.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Pricing may read sprag's data directory; keep it on a temp one.
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'sprag-usage-xdg-'));
const { claudeSessionDetail } = await import('../src/agent-usage.js');

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-usage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const summary = (extra = {}) => ({
  sessionId: 'sid-1', startTime: null, endTime: null, requestCount: 1,
  totals: { input: 10, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 5 },
  maxContextPerRequest: 0, model: 'claude-sonnet-5-5', gatewayObserved: false, ...extra,
});

function setup(t) {
  const dataDir = tmp(t);
  const projects = join(tmp(t), 'proj');
  mkdirSync(projects, { recursive: true });
  const transcript = join(projects, 'sid-1.jsonl');
  writeFileSync(transcript, JSON.stringify({ type: 'user', sessionId: 'sid-1', message: { role: 'user', content: 'hi' } }) + '\n');
  return { dataDir, transcript };
}

test('claudeSessionDetail returns the cached compaction count of the transcript', (t) => {
  const { dataDir, transcript } = setup(t);
  const cache = { entries: {
    [transcript]: { mtimeMs: 1, size: 1, s: summary({ compactions: 3 }) },
    // A subagent of the same session: its count is its own, not added to the parent.
    [join(transcript.replace(/\.jsonl$/, ''), 'subagents', 'agent-a.jsonl')]: { mtimeMs: 1, size: 1, s: summary({ compactions: 4 }) },
  } };
  const detail = claudeSessionDetail({ sessionId: 'sid-1', transcript, dataDir, cache, env: {}, now: Date.now() });
  assert.equal(detail.compactions, 3);
  // An entry written before the count existed deserializes as 0, not missing.
  const old = { entries: { [transcript]: { mtimeMs: 1, size: 1, s: summary() } } };
  assert.equal(claudeSessionDetail({ sessionId: 'sid-1', transcript, dataDir, cache: old, env: {}, now: Date.now() }).compactions, 0);
});

test('claudeSessionDetail reports null compactions without a cache entry', (t) => {
  const { dataDir, transcript } = setup(t);
  const none = claudeSessionDetail({ sessionId: 'sid-1', transcript, dataDir, cache: { entries: {} }, env: {}, now: Date.now() });
  assert.equal(none.compactions, null);
  assert.ok(Object.hasOwn(none, 'compactions'), 'the field is always present');
  const other = { entries: { [join(transcript, '..', 'sid-2.jsonl')]: { mtimeMs: 1, size: 1, s: summary({ compactions: 9 }) } } };
  assert.equal(claudeSessionDetail({ sessionId: 'sid-1', transcript, dataDir, cache: other, env: {}, now: Date.now() }).compactions, null);
  assert.equal(claudeSessionDetail({ sessionId: 'sid-1', transcript: null, dataDir, cache: other, env: {}, now: Date.now() }).compactions, null);
});
