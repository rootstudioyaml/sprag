/**
 * #15: a run is priced at the rate in effect when it happened. A price change
 * is a new dated row, so the past keeps its old rate, and a bare alias such as
 * `opus` is priced as the model it meant on that date (#13), not as the oldest
 * model of its family.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.ANTHROPIC_BASE_URL;

const { estimateCost, detectPricingTier, ratesAt, priceHistory, resolveAlias } = await import('../src/cost.js');

const ZERO = { input: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0 };
const B = 1e9;
// $/M of cache reads, read off a billion tokens so sub-cent rates stay exact.
const cacheReadRate = (model, at) => estimateCost({ ...ZERO, cacheRead: B }, model, { at }).actual / 1000;

test('Sonnet 5.5 cache reads cost $0.20 before 2026-10-07 and $0.10 from that day', () => {
  assert.equal(cacheReadRate('claude-sonnet-5-5', '2026-10-06T23:59:59Z'), 0.2);
  assert.equal(cacheReadRate('claude-sonnet-5-5', '2026-10-07T00:00:00Z'), 0.1);
  assert.equal(cacheReadRate('claude-sonnet-5-5', Date.parse('2026-11-01')), 0.1);
  // A time before the first dated row keeps the earliest known price.
  assert.equal(cacheReadRate('claude-sonnet-5-5', '2020-01-01'), 0.2);
});

test('without a time the current price applies, as before', () => {
  assert.equal(cacheReadRate('claude-sonnet-5-5'), 0.1);
  assert.equal(ratesAt('claude-opus-5-5').input, 4);
});

test('every tier keeps its rows oldest first with no duplicate dates', () => {
  for (const tier of ['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-new', 'claude-opus-legacy',
    'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-sonnet', 'claude-haiku-5-5', 'claude-haiku-5-5-long',
    'claude-haiku-4-5', 'claude-haiku-3-5', 'claude-haiku-3']) {
    const rows = priceHistory(tier);
    assert.ok(rows.length >= 1, tier);
    assert.equal(rows[0].from, null, `${tier}: the first row is the launch price`);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i].from && (rows[i - 1].from === null || rows[i - 1].from < rows[i].from), `${tier} row ${i}`);
    }
  }
});

test('a bare alias is priced as the model it meant on that date (#13)', () => {
  const cases = [
    ['opus', '2025-06-01', 'claude-opus-legacy'],
    ['opus', '2025-12-01', 'claude-opus-new'],
    ['opus[1m]', '2026-08-01', 'claude-opus-new'],
    ['opus', '2026-10-01', 'claude-opus-5-5'],
    ['opusplan', '2026-10-01', 'claude-opus-5-5'],
    ['sonnet', '2025-07-01', 'claude-sonnet'],
    ['sonnet', '2026-07-15', 'claude-sonnet-5'],
    ['sonnet[1m]', '2026-10-01', 'claude-sonnet-5-5'],
    ['haiku', '2025-06-01', 'claude-haiku-3-5'],
    ['haiku', '2026-01-01', 'claude-haiku-4-5'],
    ['haiku', '2026-10-08', 'claude-haiku-5-5'],
    ['fable', '2026-07-01', 'claude-fable-5'],
    ['best', '2026-10-01', 'claude-fable-5-1'],
  ];
  for (const [alias, at, tier] of cases) assert.equal(detectPricingTier(alias, { at }), tier, `${alias} @ ${at}`);
  // Today the aliases mean the newest models, not the legacy tiers they used to fall to.
  assert.equal(detectPricingTier('opus'), 'claude-opus-5-5');
  assert.equal(detectPricingTier('haiku'), 'claude-haiku-5-5');
  assert.equal(detectPricingTier('sonnet'), 'claude-sonnet-5-5');
});

test('full ids and house names are not treated as aliases', () => {
  assert.equal(resolveAlias('claude-opus-5-5'), null);
  assert.equal(resolveAlias('claude-opus-4-1-20250805', '2026-10-01'), null);
  assert.equal(detectPricingTier('claude-opus-4-1-20250805', { at: '2026-10-01' }), 'claude-opus-legacy');
  assert.equal(resolveAlias('my-opus-proxy'), null);
  assert.equal(resolveAlias(undefined), null);
});

// The saving of a delegated run is priced at the run's own date, so a rescan
// after a price change reproduces the same figure instead of overwriting it.
test('a delegated run saving uses the rates of the day the run happened', async () => {
  const { runSaving, runCost } = await import('../src/route-scan.js');
  const run = (startedAt) => ({
    model: 'claude-haiku-4-5-20251001', startedAt,
    input: 0, cacheCreation: 0, ephemeral5m: 0, ephemeral1h: 0, cacheRead: 10_000_000, out: 0,
  });
  // 10M cache-read tokens: Sonnet 5.5 at $0.20/M before the cut, $0.10/M after; Haiku 4.5 at $0.10/M.
  const before = runSaving(run(Date.parse('2026-10-01T12:00:00Z')), 'claude-sonnet-5-5');
  const after = runSaving(run(Date.parse('2026-10-10T12:00:00Z')), 'claude-sonnet-5-5');
  assert.equal(Math.round(before * 100) / 100, 1);
  assert.equal(Math.round(after * 100) / 100, 0);
  assert.equal(runCost(run(Date.parse('2026-10-01T12:00:00Z'))), 1);
});
