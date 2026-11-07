// #15 stage 3: a LiteLLM gateway's price table is kept by date, and gateway-priced
// figures (session cost, delegation ledger events) use the table in effect then.

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cts-gw-history-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');
process.env.APPDATA = join(home, 'config');
delete process.env.ANTHROPIC_BASE_URL;

const history = await import('../src/gateway-price-history.js');
const { sessionCost } = await import('../src/claude-price.js');
const { estimateCost } = await import('../src/cost.js');
const { priceLedgerEvent } = await import('../src/savings-ledger.js');
const { profileMapPath, resetModelAliasCache } = await import('../src/model-alias.js');
const { refreshGatewayModelMap } = await import('../src/litellm-models.js');

after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const BASE = 'https://litellm.example.com';
const ENV = { ANTHROPIC_BASE_URL: BASE };
const DAY = 86400000;
const D1 = Date.parse('2026-10-01T09:00:00Z');
const D2 = Date.parse('2026-10-03T09:00:00Z');
const price = (input, output) => ({ input, output, cacheRead: input / 10, cacheWrite: input * 1.25, cacheWrite1h: input * 2 });
const table = (input, output) => ({ 'claude-opus-5': price(input, output) });
const readFile = () => JSON.parse(readFileSync(history.priceHistoryPath(), 'utf8'));
const ZERO = { input: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0 };

beforeEach(() => {
  rmSync(history.priceHistoryPath(), { force: true });
  rmSync(profileMapPath(), { force: true });
  resetModelAliasCache();
});

test('recordGatewayPrices appends a row only on change, replaces a same-day row, keeps order', () => {
  history.recordGatewayPrices(BASE, table(1e-6, 2e-6), D1);
  history.recordGatewayPrices(BASE, table(1e-6, 2e-6), D1 + 3600_000); // unchanged: no new row
  assert.equal(readFile().gateways[BASE].rows.length, 1);
  assert.equal(readFile().gateways[BASE].checkedAt, D1 + 3600_000);
  history.recordGatewayPrices(BASE, { 'claude-opus-5': { output: 2e-6, ...price(1e-6, 2e-6) } }, D1 + 7200_000); // key order only: unchanged
  assert.equal(readFile().gateways[BASE].rows.length, 1);
  history.recordGatewayPrices(BASE, table(5e-7, 2e-6), D1 + 7200_000); // changed on the same day: replaced
  let rows = readFile().gateways[BASE].rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].from, '2026-10-01');
  assert.equal(rows[0].prices['claude-opus-5'].input, 5e-7);
  history.recordGatewayPrices(BASE, table(2e-6, 4e-6), D2); // changed on a later day: appended
  history.recordGatewayPrices(BASE, table(2e-6, 4e-6), D2 + DAY); // unchanged again
  rows = readFile().gateways[BASE].rows;
  assert.deepEqual(rows.map((r) => r.from), ['2026-10-01', '2026-10-03']);
  assert.equal(readFile().gateways[BASE].checkedAt, D2 + DAY);
});

test('gatewayPriceAt picks the row in effect, and is null where prices are unknown', () => {
  history.recordGatewayPrices(BASE, table(1e-6, 2e-6), D1);
  history.recordGatewayPrices(BASE, table(5e-7, 1e-6), D2);
  const at = (model, t) => history.gatewayPriceAt(model, BASE, t);
  assert.deepEqual(at('claude-opus-5', D1 + 1000), price(1e-6, 2e-6));
  assert.deepEqual(at('claude-opus-5', D2 - DAY), price(1e-6, 2e-6));
  assert.deepEqual(at('claude-opus-5', D2), price(5e-7, 1e-6));
  assert.deepEqual(at('claude-opus-5', '2026-10-03T12:00:00Z'), price(5e-7, 1e-6));
  assert.deepEqual(at('claude-opus-5[1m]', D2), price(5e-7, 1e-6));
  // Before the first row: the earliest prices known.
  assert.deepEqual(at('claude-opus-5', D1 - 30 * DAY), price(1e-6, 2e-6));
  // Past the freshness limit of the latest check.
  assert.deepEqual(at('claude-opus-5', D2 + 7 * DAY), price(5e-7, 1e-6));
  assert.equal(at('claude-opus-5', D2 + 7 * DAY + 1), null);
  assert.equal(at('claude-sonnet-5-5', D2), null); // model absent from the row
  assert.equal(history.gatewayPriceAt('claude-opus-5', 'https://other.example.com', D2), null);
  assert.equal(at('claude-opus-5', 'not a date'), null);
});

test('a model missing from an older row stays unpriced there, not filled from a later one', () => {
  history.recordGatewayPrices(BASE, table(1e-6, 2e-6), D1);
  history.recordGatewayPrices(BASE, { ...table(1e-6, 2e-6), 'claude-haiku-4-5': price(1e-7, 2e-7) }, D2);
  assert.equal(history.gatewayPriceAt('claude-haiku-4-5', BASE, D1), null);
  assert.deepEqual(history.gatewayPriceAt('claude-haiku-4-5', BASE, D2), price(1e-7, 2e-7));
});

test('seed: a gateway section already in profile-map.json counts as one row from its fetchedAt day', () => {
  mkdirSync(dirname(profileMapPath()), { recursive: true });
  writeFileSync(profileMapPath(), JSON.stringify({ gateway: { base: BASE, fetchedAt: new Date(D1).toISOString(), aliases: {}, prices: table(1e-6, 2e-6), skipped: [], count: 1 } }));
  resetModelAliasCache();
  assert.equal(existsSync(history.priceHistoryPath()), false);
  assert.deepEqual(history.gatewayPriceAt('claude-opus-5', BASE, D1 + DAY), price(1e-6, 2e-6));
  assert.deepEqual(history.gatewayPriceAt('claude-opus-5', BASE, D1 - DAY), price(1e-6, 2e-6));
  assert.equal(history.gatewayPriceAt('claude-opus-5', BASE, D1 + 8 * DAY), null);
  assert.equal(history.gatewayPriceAt('claude-opus-5', 'https://other.example.com', D1 + DAY), null);
});

test('the first recorded fetch keeps the stored table as the earlier row', () => {
  mkdirSync(dirname(profileMapPath()), { recursive: true });
  writeFileSync(profileMapPath(), JSON.stringify({ gateway: { base: BASE, fetchedAt: new Date(D1).toISOString(), aliases: {}, prices: table(1e-6, 2e-6), skipped: [], count: 1 } }));
  resetModelAliasCache();
  history.recordGatewayPrices(BASE, table(5e-7, 1e-6), D2);
  assert.deepEqual(readFile().gateways[BASE].rows.map((r) => r.from), ['2026-10-01', '2026-10-03']);
  assert.deepEqual(history.gatewayPriceAt('claude-opus-5', BASE, D1 + 1000), price(1e-6, 2e-6));
});

test('refreshGatewayModelMap records the table it stores', async () => {
  const row = (input) => ({ model_name: 'claude-opus-5', litellm_params: {},
    model_info: { input_cost_per_token: input, output_cost_per_token: 2e-6, cache_read_input_token_cost: input / 10,
      cache_creation_input_token_cost: input * 1.25, cache_creation_input_token_cost_above_1hr: input * 2 } });
  const fetchImpl = (input) => async () => ({ ok: true, status: 200, json: async () => ({ data: [row(input)] }) });
  assert.ok(await refreshGatewayModelMap({ base: BASE, key: 'k', fetchImpl: fetchImpl(1e-6) }));
  const stored = JSON.parse(readFileSync(profileMapPath(), 'utf8')).gateway.prices;
  assert.deepEqual(readFile().gateways[BASE].rows[0].prices, stored);
  // A failed fetch records nothing.
  const before = readFileSync(history.priceHistoryPath(), 'utf8');
  assert.equal(await refreshGatewayModelMap({ base: BASE, key: 'k', fetchImpl: async () => ({ ok: false, status: 500 }) }), null);
  assert.equal(readFileSync(history.priceHistoryPath(), 'utf8'), before);
});

test('sessionCost on a gateway follows the dated row; without `at` it keeps the current table', () => {
  history.recordGatewayPrices(BASE, table(1e-6, 2e-6), D1);
  history.recordGatewayPrices(BASE, table(5e-7, 1e-6), D2);
  const totals = { ...ZERO, input: 1_000_000, output: 1_000_000 };
  assert.equal(sessionCost(totals, 'claude-opus-5', { env: ENV, at: D1 + 1000 }).actual, 3);
  assert.equal(sessionCost(totals, 'claude-opus-5', { env: ENV, at: D2 + 1000 }).actual, 1.5);
  assert.equal(sessionCost(totals, 'claude-opus-5', { env: ENV, at: `${'2026-10-01'}T12:00:00Z` }).actual, 3);
  assert.equal(sessionCost(totals, 'claude-sonnet-5-5', { env: ENV, at: D2 + 1000 }), null);
  // No `at`: the single current table (profile-map.json) as before; none stored here, so unpriced.
  assert.equal(sessionCost(totals, 'claude-opus-5', { env: ENV }), null);
});

test('priceLedgerEvent prices a gateway event from the history at q.at, never from the list table', () => {
  history.recordGatewayPrices(BASE, { ...table(1e-6, 2e-6), 'claude-haiku-4-5': price(1e-7, 2e-7) }, D1);
  history.recordGatewayPrices(BASE, { ...table(5e-7, 1e-6), 'claude-haiku-4-5': price(1e-7, 2e-7) }, D2);
  const ev = (at, extra = {}) => ({ ts: at, usd: 99, cost: 99, priceSource: 'gateway', gw: BASE, from: 'claude-opus-5', to: 'claude-haiku-4-5',
    q: { at, sub: { ...ZERO, input: 1_000_000, output: 1_000_000 } }, ...extra });
  // Run cost on haiku: 0.1 + 0.2 = 0.3. Same tokens on opus: 3.0 at D1 prices, 1.5 at D2 prices.
  const a = priceLedgerEvent(ev(D1 + 1000));
  const b = priceLedgerEvent(ev(D2 + 1000));
  assert.equal(a.cost, 0.3);
  assert.equal(b.cost, 0.3);
  assert.equal(a.usd, 2.7);
  assert.equal(b.usd, 1.2);
  // No gateway recorded, or no quantities: stored dollars stay.
  assert.equal(priceLedgerEvent(ev(D1 + 1000, { gw: undefined })), null);
  assert.equal(priceLedgerEvent(ev(D1 + 1000, { q: undefined })), null);
  // The list table has Sonnet 5.5 but this gateway's table does not: unpriced, not filled in.
  assert.ok(estimateCost({ ...ZERO, input: 1000 }, 'claude-sonnet-5-5'));
  assert.equal(priceLedgerEvent(ev(D1 + 1000, { from: 'claude-sonnet-5-5' })), null);
  assert.equal(priceLedgerEvent(ev(D1 + 1000, { to: 'claude-sonnet-5-5' })), null);
  // Prices that recent are unknown past the freshness limit.
  assert.equal(priceLedgerEvent(ev(D2 + 8 * DAY)), null);
  // The v3 basis (cache-read, write, output of the main model) goes through the same history.
  const v3 = (at) => priceLedgerEvent(ev(at, { basis: 'v3', q: { at, sub: { ...ZERO, input: 1_000_000, output: 1_000_000 }, main: { cacheRead: 1_000_000, write: 0, output: 0 } } }));
  assert.ok(Number.isFinite(v3(D1 + 1000).usd));
  assert.notEqual(v3(D1 + 1000).usd, v3(D2 + 1000).usd);
});

test('the list path is untouched by a recorded gateway history', () => {
  history.recordGatewayPrices(BASE, { ...table(1e-6, 2e-6), 'claude-sonnet-5-5': price(9, 9) }, D1);
  const at = Date.parse('2026-10-10T12:00:00Z');
  const totals = { ...ZERO, input: 1_000_000, output: 1_000_000 };
  assert.deepEqual(sessionCost(totals, 'claude-sonnet-5-5', { env: {}, at }), estimateCost(totals, 'claude-sonnet-5-5', { at }));
  const e = { ts: at, priceSource: 'list', from: 'claude-sonnet-5-5', to: 'claude-haiku-4-5-20251001', q: { at, sub: totals } };
  const base = estimateCost(totals, 'claude-sonnet-5-5', { at });
  assert.ok(base.actual > 0);
  const p = priceLedgerEvent(e);
  assert.ok(Number.isFinite(p.usd) && Number.isFinite(p.cost));
  // A gw on a list event is ignored.
  assert.deepEqual(priceLedgerEvent({ ...e, gw: BASE }), p);
});
