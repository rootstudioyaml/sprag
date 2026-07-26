import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dailyTrend, ttlBreakdown, summary, detectContextWindow } from '../src/stats.js';

/** Minimal session shaped exactly like parseAllSessions returns. */
function session({ start, end = start, requestCount = 1, maxContext = 0, ...t }) {
  return {
    sessionId: 's',
    projectDir: 'p',
    startTime: start ? new Date(start) : null,
    endTime: end ? new Date(end) : null,
    requestCount,
    maxContextPerRequest: maxContext,
    model: 'claude-opus-5',
    totals: {
      input: t.input || 0,
      cacheCreation: t.cacheCreation || 0,
      cacheRead: t.cacheRead || 0,
      ephemeral5m: t.ephemeral5m || 0,
      ephemeral1h: t.ephemeral1h || 0,
      output: t.output || 0,
    },
  };
}

test('dailyTrend groups by start date and computes hit rate per day', () => {
  const trend = dailyTrend([
    session({ start: '2026-07-01T01:00:00Z', input: 10, cacheCreation: 10, cacheRead: 80 }),
    session({ start: '2026-07-01T23:00:00Z', input: 10, cacheCreation: 10, cacheRead: 80 }),
    session({ start: '2026-07-02T01:00:00Z', input: 50, cacheCreation: 50, cacheRead: 0 }),
  ]);
  assert.equal(trend.length, 2);
  assert.deepEqual(trend.map((d) => d.date), ['2026-07-01', '2026-07-02'], 'sorted ascending');
  assert.equal(trend[0].sessions, 2);
  assert.equal(trend[0].hitRate, 160 / 200);
  assert.equal(trend[1].hitRate, 0, 'no cache reads → 0, not NaN');
});

test('dailyTrend skips sessions without a start time', () => {
  assert.deepEqual(dailyTrend([session({ start: null, cacheRead: 100 })]), []);
});

test('ttlBreakdown splits 5m vs 1h and stays finite when empty', () => {
  const t = ttlBreakdown([
    session({ start: '2026-07-01T01:00:00Z', ephemeral5m: 300, ephemeral1h: 100 }),
  ]);
  assert.equal(t.total, 400);
  assert.equal(t.pct5m, 0.75);
  assert.equal(t.pct1h, 0.25);

  const empty = ttlBreakdown([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.pct5m, 0, 'must not divide by zero');
});

test('summary totals every session and derives the overall hit rate', () => {
  const s = summary([
    session({ start: '2026-07-01T01:00:00Z', requestCount: 2, input: 10, cacheCreation: 10, cacheRead: 80, output: 5 }),
    session({ start: '2026-07-02T01:00:00Z', requestCount: 3, input: 10, cacheCreation: 10, cacheRead: 180, output: 5 }),
  ]);
  assert.equal(s.sessions, 2);
  assert.equal(s.apiCalls, 5);
  assert.equal(s.output, 10);
  assert.equal(s.totalInput, 300);
  assert.equal(s.hitRate, 260 / 300);
});

test('detectContextWindow flags 1M only above the 210k safety margin', () => {
  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const under = detectContextWindow([session({ start: recent, maxContext: 199_000 })]);
  assert.equal(under.size, '200k');

  const over = detectContextWindow([session({ start: recent, maxContext: 400_000 })]);
  assert.equal(over.size, '1M');
  assert.equal(over.maxContext, 400_000);
  assert.equal(over.source, 'recent');

  // 205k sits above the nominal 200k ceiling but inside the margin — metadata
  // rounding must not be reported as a 1M window.
  assert.equal(detectContextWindow([session({ start: recent, maxContext: 205_000 })]).size, '200k');
});

test('detectContextWindow falls back to all sessions when nothing is recent', () => {
  const old = '2020-01-01T00:00:00Z';
  const r = detectContextWindow([session({ start: old, maxContext: 300_000 })]);
  assert.equal(r.size, '1M');
  assert.equal(r.source, 'all');
});

test('detectContextWindow reports unknown rather than guessing on no data', () => {
  const r = detectContextWindow([]);
  assert.equal(r.size, 'unknown');
  assert.equal(r.source, 'no-data');
});
