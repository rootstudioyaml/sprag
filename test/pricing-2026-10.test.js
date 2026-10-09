import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// parser.js and session-cache.js resolve their directories when they load, so
// the sandbox has to be in the environment before the imports below.
const home = mkdtempSync(join(tmpdir(), 'cts-pricing-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');
delete process.env.ANTHROPIC_BASE_URL;

const { estimateCost, detectPricingTier, modelRank } = await import('../src/cost.js');
const { parseSessionFile } = await import('../src/parser.js');
const { summary, dailyTrend } = await import('../src/stats.js');

after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const ZERO = { input: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0 };
const M = 1e6;
// estimateCost rounds to cents, so rates are read off a billion tokens (x1000
// of the per-million price) to keep fractional-cent prices like $0.125 exact.
const B = 1e9;

// Price a billion tokens of each class and read back $/M.
function rates(model) {
  const one = (k, extra = {}) => estimateCost({ ...ZERO, [k]: B, ...extra }, model).actual / 1000;
  return {
    input: one('input'),
    w5m: one('cacheCreation', { ephemeral5m: B }),
    w1h: one('cacheCreation', { ephemeral1h: B }),
    read: one('cacheRead'),
    output: one('output'),
  };
}
const card = (input, w5m, w1h, read, output) => ({ input, w5m, w1h, read, output });

const SHAPES = (fam, ver) => [
  `claude-${fam}-${ver}`,
  `claude-${fam}-${ver}-20261001`,
  `anthropic.claude-${fam}-${ver}-v1:0`,
  `us.anthropic.claude-${fam}-${ver}-v1:0`,
  `claude-${fam}-${ver}@20261001`,
  `claude-${fam}-${ver}[1m]`,
  `${fam}-${ver.replace('-', '.')}`,
];

const CASES = [
  ['fable', '5-1', card(10, 12.5, 20, 0.25, 50), 'claude-fable-5-1'],
  ['mythos', '5-1', card(10, 12.5, 20, 0.25, 50), 'claude-fable-5-1'],
  ['opus', '5-5', card(4, 5, 8, 0.2, 20), 'claude-opus-5-5'],
  ['sonnet', '5-5', card(2, 2.5, 4, 0.1, 10), 'claude-sonnet-5-5'],
  ['haiku', '5-5', card(0.1, 0.125, 0.2, 0.01, 0.5), 'claude-haiku-5-5'],
];

for (const [fam, ver, expected, tier] of CASES) {
  for (const id of SHAPES(fam, ver)) {
    test(`${id} prices as ${tier}`, () => {
      assert.equal(detectPricingTier(id), tier);
      assert.deepEqual(rates(id), expected);
    });
  }
}

test('date-suffixed ids of Opus 5, Sonnet 5 and Fable 5 keep their own tier', () => {
  const opus5 = card(5, 6.25, 10, 0.5, 25);
  const sonnet5 = card(2, 2.5, 4, 0.2, 10);
  const fable5 = card(10, 12.5, 20, 1, 50);
  for (const id of ['claude-opus-5', 'claude-opus-5-20260101', 'anthropic.claude-opus-5-20260101-v1:0', 'claude-opus-5@20260101']) {
    assert.deepEqual(rates(id), opus5, id);
  }
  for (const id of ['claude-sonnet-5', 'claude-sonnet-5-20260101', 'anthropic.claude-sonnet-5-v1:0', 'claude-sonnet-5[1m]']) {
    assert.deepEqual(rates(id), sonnet5, id);
  }
  for (const id of ['claude-fable-5', 'claude-fable-5-20261001', 'claude-mythos-5-20261001']) {
    assert.deepEqual(rates(id), fable5, id);
  }
});

test('older families are unchanged: Opus 4.x, Sonnet 3.x/4.x, Haiku 4.5', () => {
  const sonnet = card(3, 3.75, 6, 0.3, 15);
  for (const id of ['claude-sonnet-4-6', 'claude-sonnet-4-5-20250929', 'claude-3-5-sonnet-20241022', 'claude-3-7-sonnet-20250219', 'claude-sonnet-4-20250514']) {
    assert.deepEqual(rates(id), sonnet, id);
  }
  assert.deepEqual(rates('claude-opus-4-8'), card(5, 6.25, 10, 0.5, 25));
  assert.deepEqual(rates('claude-opus-4-1-20250805'), card(15, 18.75, 30, 1.5, 75));
  assert.deepEqual(rates('claude-haiku-4-5-20251001'), card(1, 1.25, 2, 0.1, 5));
});

test('Haiku 5.5 prices the long-prompt part of totals at the long rates', () => {
  // One request of 110k prompt tokens (long) and one of 20k (short).
  const long = { input: 100_000_000, cacheCreation: 0, cacheRead: 10_000_000, ephemeral5m: 0, ephemeral1h: 0, output: 1_000_000 };
  const short = { input: 20_000_000, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 1_000_000 };
  const sum = {};
  for (const k of Object.keys(ZERO)) sum[k] = long[k] + short[k];

  const c = estimateCost({ ...sum, long }, 'claude-haiku-5-5');
  const shortCost = (20_000_000 * 0.1 + 1_000_000 * 0.5) / M;
  const longCost = (100_000_000 * 0.5 + 10_000_000 * 0.05 + 1_000_000 * 2.5) / M;
  assert.ok(Math.abs(c.actual - (shortCost + longCost)) < 1e-6, `${c.actual}`);
  // noCacheCost: every input token at the base rate of its own request.
  const noCache = (20_000_000 * 0.1 + 1_000_000 * 0.5 + 110_000_000 * 0.5 + 1_000_000 * 2.5) / M;
  assert.ok(Math.abs(c.noCacheCost - noCache) < 1e-6, `${c.noCacheCost}`);
  assert.equal(c.tier, 'claude-haiku-5-5');
  // Without a `long` part everything is short-priced.
  const plain = estimateCost(sum, 'claude-haiku-5-5');
  assert.ok(plain.actual < c.actual);
});

test('Haiku 5.5 long split carries the 1h write counterfactual through both parts', () => {
  const long = { input: 0, cacheCreation: 150_000_000, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 150_000_000, output: 0 };
  const short = { input: 0, cacheCreation: 50_000_000, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 50_000_000, output: 0 };
  const sum = {};
  for (const k of Object.keys(ZERO)) sum[k] = long[k] + short[k];
  const c = estimateCost({ ...sum, long }, 'claude-haiku-5-5');
  assert.ok(Math.abs(c.actual - (150_000_000 * 1.0 + 50_000_000 * 0.2) / M) < 1e-6);
  assert.equal(c.extraCostIf5mApplicable, true);
});

test('`long` is ignored by every tier other than Haiku 5.5', () => {
  const t = { ...ZERO, input: 200_000, long: { ...ZERO, input: 150_000 } };
  for (const id of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-4-5']) {
    assert.equal(estimateCost(t, id).actual, estimateCost({ ...t, long: undefined }, id).actual, id);
  }
});

test('modelRank orders the new ids with their families', () => {
  assert.equal(modelRank('claude-fable-5-1'), 3);
  assert.equal(modelRank('claude-opus-5-5'), 2);
  assert.equal(modelRank('claude-sonnet-5'), 1);
  assert.equal(modelRank('claude-sonnet-5-5'), 1);
  assert.equal(modelRank('claude-haiku-5-5'), 0);
  assert.ok(modelRank('claude-haiku-5-5') < modelRank('claude-sonnet-5-5'));
  assert.ok(modelRank('claude-sonnet-5-5') < modelRank('claude-opus-5-5'));
  assert.ok(modelRank('claude-opus-5-5') < modelRank('claude-fable-5-1'));
});

function line(n, model, usage) {
  return JSON.stringify({
    requestId: `r${n}`,
    timestamp: new Date(Date.now() - 1000 * (10 - n)).toISOString(),
    sessionId: 'long-split',
    message: { id: `m${n}`, model, usage },
  });
}

test('parser accumulates only requests with a prompt over 100k into totals.long', async () => {
  const file = join(home, 'long-split.jsonl');
  writeFileSync(file, [
    line(1, 'claude-haiku-5-5', {
      input_tokens: 20_000, cache_creation_input_tokens: 40_000, cache_read_input_tokens: 60_000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 40_000 },
      output_tokens: 500,
    }),
    line(2, 'claude-haiku-5-5', { input_tokens: 8_000, cache_read_input_tokens: 2_000, output_tokens: 100 }),
  ].join('\n') + '\n');

  const s = await parseSessionFile(file);
  assert.deepEqual(s.totals.long, {
    input: 20_000, cacheCreation: 40_000, cacheRead: 60_000, ephemeral5m: 0, ephemeral1h: 40_000, output: 500,
  });
  assert.equal(s.totals.input, 28_000);

  // Exactly 100,000 is not "over".
  const edge = join(home, 'edge.jsonl');
  writeFileSync(edge, line(1, 'claude-haiku-5-5', { input_tokens: 100_000, output_tokens: 1 }) + '\n');
  assert.equal((await parseSessionFile(edge)).totals.long, undefined);

  // No long request → the usual shape, no `long` key at all.
  const small = join(home, 'small.jsonl');
  writeFileSync(small, line(1, 'claude-haiku-5-5', { input_tokens: 5_000, output_tokens: 1 }) + '\n');
  assert.equal('long' in (await parseSessionFile(small)).totals, false);

  // The aggregates that feed estimateCost keep the split.
  const sess = [{ ...s, startTime: new Date() }];
  assert.deepEqual(summary(sess).long, s.totals.long);
  assert.deepEqual(dailyTrend(sess)[0].long, s.totals.long);
});
