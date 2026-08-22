/**
 * Multi-line statusline: when the delegation ledger carries lifetime savings,
 * a "Routing saved $x wk · $y mo · $z all" headline owns line 1 and every
 * other chip moves to line 2. --single-line and an empty ledger both fall
 * back to the legacy one-line layout. The savings ledger itself is covered
 * here too (upsert dedupe + rolling-window sums).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatReport } from '../src/formatters/statusline.js';

function data(extra = {}) {
  return {
    summary: { hitRate: 0.9 },
    ttl: { total: 100, pct1h: 1 },
    cost: { savings: 1500 },
    options: { days: 1, windowLabel: '1d' },
    lastActivity: Date.now(),
    contextWindow: { size: '200k', maxContext: 100000 },
    ctxLive: null,
    spikeChip: null,
    caps: null,
    model: null,
    delegationSaved: 3.2,
    delegationTotals: { week: 1.25, month: 4.5, total: 9.75 },
    ...extra,
  };
}

const opts = { color: false, timer: false };

test('totals headline takes line 1, diagnostics take line 2', () => {
  const out = formatReport(data(), opts);
  const lines = out.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Routing saved \$1\.25 wk · \$4\.50 mo · \$9\.75 all$/);
  assert.match(lines[1], /Cache hit/);
  assert.match(lines[1], /Cache saved/);
  assert.doesNotMatch(lines[1], /Routing saved/, 'inline session chip is dropped when the headline renders');
});

test('icon mode keeps the 🔀 prefix on the headline', () => {
  const out = formatReport(data(), { ...opts, mode: 'icon' });
  assert.match(out.split('\n')[0], /^🔀 Routing saved \$1\.25 wk/);
});

test('--single-line falls back to the legacy layout', () => {
  const out = formatReport(data(), { ...opts, singleLine: true });
  assert.ok(!out.includes('\n'));
  assert.match(out, /Routing saved \$3\.2/, 'inline session chip returns');
});

test('empty or missing totals mean one line', () => {
  for (const totals of [null, undefined, { week: 0, month: 0, total: 0 }]) {
    const out = formatReport(data({ delegationTotals: totals }), opts);
    assert.ok(!out.includes('\n'), `totals ${JSON.stringify(totals)} should not add a line`);
  }
});

test('segment whitelist without "delegated" suppresses the headline', () => {
  const out = formatReport(data(), { ...opts, segments: ['hit', 'saved'] });
  assert.ok(!out.includes('\n'));
  assert.doesNotMatch(out, /Routing saved/);
});

test('no-color multi-line output carries no ANSI escapes', () => {
  assert.doesNotMatch(formatReport(data(), opts), /\x1b\[/);
});

test('ledger: upserts dedupe by run path and totals honor rolling windows', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-ledger-'));
  process.env.XDG_CONFIG_HOME = dir;
  t.after(() => {
    delete process.env.XDG_CONFIG_HOME;
    rmSync(dir, { recursive: true, force: true });
  });
  const { recordDelegationEvents, delegationSavedTotals } = await import('../src/savings-ledger.js');
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  recordDelegationEvents([
    { key: '/a.jsonl', ts: now - 2 * day, usd: 1 },        // in week + month
    { key: '/b.jsonl', ts: now - 10 * day, usd: 2 },       // month only
    { key: '/c.jsonl', ts: now - 60 * day, usd: 4 },       // lifetime only
    { key: '/a.jsonl', ts: now - 2 * day, usd: 1 },        // duplicate — ignored
    { key: '/zero.jsonl', ts: now, usd: 0 },               // zero saving — skipped
  ]);
  const totals = delegationSavedTotals(now);
  assert.equal(totals.week, 1);
  assert.equal(totals.month, 3);
  assert.equal(totals.total, 7);
});
