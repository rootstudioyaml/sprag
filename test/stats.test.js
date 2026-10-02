import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dailyTrend, ttlBreakdown, summary, detectContextWindow, detectSpikes, computeBaseline, BASELINE_MIN_REQUESTS, CONTEXT_WARN_TOKENS } from '../src/stats.js';
import { chipForIssues, CHIP_TO_CODES } from '../src/advice.js';

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
    // No zone suffix: these are local times, and the trend is keyed by local day.
    session({ start: '2026-07-01T01:00:00', input: 10, cacheCreation: 10, cacheRead: 80 }),
    session({ start: '2026-07-01T23:00:00', input: 10, cacheCreation: 10, cacheRead: 80 }),
    session({ start: '2026-07-02T01:00:00', input: 50, cacheCreation: 50, cacheRead: 0 }),
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

test('the context warning fires at 500k, not at the 1M window label', () => {
  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  // A 1M window carrying 300k is the ordinary case for every current model —
  // it must not raise a chip, which is what made the old 200k line useless.
  const ordinary = detectContextWindow([session({ start: recent, maxContext: 300_000 })]);
  assert.equal(ordinary.size, '1M');
  assert.equal(ordinary.overWarn, false);
  assert.equal(chipForIssues([], ordinary), null);

  const heavy = detectContextWindow([session({ start: recent, maxContext: 620_000 })]);
  assert.equal(heavy.overWarn, true);
  assert.equal(chipForIssues([], heavy), '⚠ Ctx 500k+');

  assert.equal(detectContextWindow([]).overWarn, false);
  assert.equal(CONTEXT_WARN_TOKENS, 500_000);
});

test('the 500k chip and its legacy 200k spelling both resolve to advice', () => {
  assert.deepEqual(CHIP_TO_CODES['⚠ Ctx 500k+'], ['LARGE_INPUT_PER_REQUEST']);
  assert.deepEqual(CHIP_TO_CODES['⚠ Ctx 200k+'], ['LARGE_INPUT_PER_REQUEST']);
});

test('the trend is keyed by the local day, like the month total beside it', () => {
  // Half past midnight local time is "today" for the reader in every zone.
  // Keyed by the UTC day, the same session fell on the previous date anywhere
  // east of Greenwich.
  const start = new Date(2026, 6, 15, 0, 30);
  const [day] = dailyTrend([session({ start, input: 10 })]);
  assert.equal(day.date, '2026-07-15');
  const late = new Date(2026, 6, 15, 23, 30);
  assert.equal(dailyTrend([session({ start: late, input: 10 })])[0].date, '2026-07-15');
});

test('one-shot calls stay out of the spike baseline', () => {
  const day = 24 * 3600 * 1000;
  const now = Date.now();
  // What a week looks like with scripted `claude -p` calls in it: hundreds of
  // single-request sessions of ~45k tokens beside a few real conversations.
  const oneShots = Array.from({ length: 300 }, (_, i) =>
    session({ start: now - 3 * day - i * 1000, requestCount: 1, cacheRead: 45_000 }));
  const conversations = [8_000_000, 12_000_000, 20_000_000, 30_000_000].map((cacheRead, i) =>
    session({ start: now - (2 + i) * day, requestCount: 60, cacheRead }));
  const today = session({ start: now - 3600 * 1000, requestCount: 62, cacheRead: 13_000_000 });

  const baseline = computeBaseline([...oneShots, ...conversations, today]);
  assert.equal(baseline.sampleSize, conversations.length);
  assert.equal(baseline.p95TotalInput, 30_000_000);
  assert.equal(baseline.medianRequestCount, 60);
  // An ordinary 13M session is not a spike against conversations. Against the
  // one-shot calls it was hundreds of times the "p95".
  assert.deepEqual(detectSpikes([...oneShots, ...conversations, today]).spikes, []);

  // With only one-shot calls behind it there is no baseline to compare with.
  assert.equal(computeBaseline([...oneShots, today]).enough, false);
  assert.equal(BASELINE_MIN_REQUESTS, 3);
});

test('a session listed for one large request is not labelled with a p95 ratio', async () => {
  const { formatReport } = await import('../src/formatters/table.js');
  const { buildTableDemoData } = await import('../src/demo.js');
  const day = 24 * 3600 * 1000;
  const now = Date.now();
  const conversations = [80_000_000, 90_000_000, 100_000_000, 110_000_000].map((cacheRead, i) =>
    session({ start: now - (2 + i) * day, requestCount: 60, cacheRead }));
  const today = session({ start: now - 3600 * 1000, requestCount: 62, cacheRead: 15_000_000, maxContext: 300_000 });
  const report = detectSpikes([...conversations, today]);
  assert.equal(report.spikes.length, 1);
  assert.equal(report.spikes[0].byRatio, false);
  const out = formatReport({ ...buildTableDemoData({ version: '0.0.0' }), spikeReport: report }, { color: false });
  assert.match(out, /single-request > 250k, 62 requests/);
  assert.doesNotMatch(out, /0\.\d× p95/);
});
