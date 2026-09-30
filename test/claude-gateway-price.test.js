import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveGatewayPrices, gatewayPriceFor, refreshGatewayModelMap } from '../src/litellm-models.js';
import { profileMapPath, resetModelAliasCache } from '../src/model-alias.js';
import { estimateCost } from '../src/cost.js';
import { sessionCost, sessionCostAcross } from '../src/claude-price.js';
import { monthSpend } from '../src/month-spend.js';
import { runSaving } from '../src/route-scan.js';
import { recordDelegationEvents, delegationSavedTotals } from '../src/savings-ledger.js';
import { formatMoney } from '../src/formatters/statusline.js';

const BASE = 'https://litellm.example.com';
const ENV = { ANTHROPIC_BASE_URL: BASE };
const ARN = 'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abcd1234wxyz';

function isolated(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-claude-price-'));
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  resetModelAliasCache();
  t.after(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prev;
    resetModelAliasCache();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return dir;
}

const row = (name, info = {}, params = {}) => ({ model_name: name, litellm_params: params,
  model_info: { input_cost_per_token: 3e-6, output_cost_per_token: 15e-6, cache_read_input_token_cost: 3e-7,
    cache_creation_input_token_cost: 3.75e-6, cache_creation_input_token_cost_above_1hr: 6e-6, ...info } });
const PRICE = { input: 3e-6, output: 15e-6, cacheRead: 3e-7, cacheWrite: 3.75e-6, cacheWrite1h: 6e-6 };

test('deriveGatewayPrices registers every name form and nulls an ambiguous key', () => {
  const prices = deriveGatewayPrices({ data: [
    row('claude-sonnet-4-6', {}, { model: 'bedrock/anthropic.claude-sonnet-4-6' }),
    row('dup', { input_cost_per_token: 1e-6 }), row('dup', { input_cost_per_token: 2e-6 }),
  ] });
  assert.deepEqual(prices['claude-sonnet-4-6'], PRICE);
  assert.deepEqual(prices['anthropic.claude-sonnet-4-6'], PRICE);
  assert.equal(prices.dup, null);
});

test('stored price keys never carry an AWS account id, and the file holds no raw payload', async (t) => {
  const dir = isolated(t);
  const payload = { data: [row('prod-large', { base_model: 'bedrock/anthropic.claude-opus-5', secret: 'sk-leak' }, { model: ARN })] };
  const result = await refreshGatewayModelMap({ base: BASE, key: 'sk-test', fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }) });
  assert.ok(result);
  const text = readFileSync(profileMapPath(), 'utf8');
  assert.doesNotMatch(text, /\d{12}/);
  assert.doesNotMatch(text, /arn:aws|sk-leak|sk-test/);
  const saved = JSON.parse(text).gateway.prices;
  assert.deepEqual(saved['prod-large'], PRICE);
  assert.deepEqual(saved['abcd1234wxyz'], PRICE);
  assert.ok(dir);
});

test('gatewayPriceFor finds a price, and reads stale or missing tables as unpriced', async (t) => {
  isolated(t);
  const payload = { data: [row('claude-opus-5')] };
  await refreshGatewayModelMap({ base: BASE, key: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }) });
  const now = Date.now();
  assert.deepEqual(gatewayPriceFor('claude-opus-5', ENV, now), PRICE);
  // The transcript's [1m] context suffix and provider prefix do not hide the entry.
  assert.deepEqual(gatewayPriceFor('claude-opus-5[1m]', ENV, now), PRICE);
  assert.equal(gatewayPriceFor('claude-unknown', ENV, now), null);
  assert.equal(gatewayPriceFor('claude-opus-5', ENV, now + 8 * 86400000), null);
  assert.equal(gatewayPriceFor('claude-opus-5', {}, now), null);
});

test('estimateCost at a gateway price uses it, and unpriced token classes give null', () => {
  const totals = { input: 1_000_000, cacheCreation: 1_000_000, ephemeral5m: 1_000_000, ephemeral1h: 0, cacheRead: 1_000_000, output: 1_000_000 };
  const c = estimateCost(totals, 'anything', { price: PRICE });
  assert.equal(c.tier, 'gateway');
  assert.equal(c.actual, round(3 + 3.75 + 0.3 + 15));
  assert.equal(estimateCost(totals, 'x', { price: { ...PRICE, cacheRead: null } }), null);
  assert.equal(estimateCost(totals, 'x', { price: { ...PRICE, cacheWrite: null } }), null);
  const oneHour = { ...totals, ephemeral5m: 0, ephemeral1h: 1_000_000 };
  assert.equal(estimateCost(oneHour, 'x', { price: { ...PRICE, cacheWrite1h: null } }), null);
  assert.ok(estimateCost(oneHour, 'x', { price: PRICE }));
  // No cache tokens: missing cache rates do not matter, and the 5m scenario collapses to actual.
  const plain = estimateCost({ input: 1000, cacheCreation: 0, cacheRead: 0, output: 1000 }, 'x', { price: { ...PRICE, cacheWrite: null, cacheRead: null } });
  assert.equal(plain.scenario5mCost, plain.actual);
  assert.equal(plain.extraCostIf5mApplicable, false);
});
const round = (n) => Math.round(n * 100) / 100;

test('sessionCost: gateway path is unpriced without a table entry, direct path is unchanged', async (t) => {
  isolated(t);
  const totals = { input: 1_000_000, cacheCreation: 0, cacheRead: 0, output: 1_000_000 };
  assert.equal(sessionCost(totals, 'claude-opus-5', { env: ENV }), null);
  assert.deepEqual(sessionCost(totals, 'claude-opus-5', { env: {} }), estimateCost(totals, 'claude-opus-5'));
  await refreshGatewayModelMap({ base: BASE, key: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [row('claude-opus-5', { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 })] }) }) });
  assert.equal(sessionCost(totals, 'claude-opus-5', { env: ENV }).actual, 3);
  const across = sessionCostAcross([{ totals, model: 'claude-opus-5' }, { totals, model: 'nope' }], { env: ENV });
  assert.equal(across.actual, 3);
  assert.equal(across.unpriced, 1);
});

test('monthSpend counts sessions the gateway cannot price instead of summing them', async (t) => {
  isolated(t);
  const prevBase = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = BASE;
  t.after(() => { if (prevBase === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = prevBase; });
  const now = new Date();
  const totals = { input: 1_000_000, cacheCreation: 0, cacheRead: 0, output: 0 };
  const m = monthSpend([{ endTime: now, totals, model: 'claude-opus-5' }], now);
  assert.equal(m.usd, 0);
  assert.equal(m.unpriced, 1);
  assert.equal(m.sessions, 0);
});

test('runSaving is unpriced on a gateway with no table, not zero', (t) => {
  isolated(t);
  const prevBase = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = BASE;
  t.after(() => { if (prevBase === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = prevBase; });
  const run = { model: 'claude-haiku-4-5', input: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, out: 1000 };
  assert.equal(runSaving(run, 'claude-opus-5'), null);
});

test('the savings ledger records a loss and totals net it out', (t) => {
  isolated(t);
  const ts = Date.now();
  recordDelegationEvents([
    { key: 'a', ts, usd: 1, from: 'claude-opus-5', to: 'claude-haiku-4-5' },
    { key: 'b', ts, usd: -3.5, from: 'claude-haiku-4-5', to: 'claude-opus-5' },
    { key: 'c', ts, usd: null, from: 'x', to: 'y' },
    { key: 'd', ts, usd: NaN, from: 'x', to: 'y' },
  ]);
  const totals = delegationSavedTotals();
  assert.equal(totals.total, -2.5);
  assert.equal(totals.week, -2.5);
  assert.equal(formatMoney(totals.total), '-$2.50');
  assert.equal(formatMoney(-0.001), '$0.00');
});
