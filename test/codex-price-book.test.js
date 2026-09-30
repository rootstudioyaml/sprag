import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OPENAI_LIST_PRICES, OPENAI_PRICES_CHECKED_AT } from '../src/openai-prices.js';
import { codexPriceBook, isDirectOpenAI, codexRunCost } from '../src/codex-cache-policy.js';
import { deploymentPrice } from '../src/gateway-prices.js';
import { recordCodexDelegation, refreshCodexLedger } from '../src/codex-ledger.js';

function home(t, toml) {
  const base = mkdtempSync(join(tmpdir(), 'sprag-book-'));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const dir = join(base, 'codex');
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  if (toml != null) writeFileSync(join(dir, 'config.toml'), toml);
  return { base, dir };
}

test('OpenAI list table carries per-token prices with null for missing rates', () => {
  assert.equal(OPENAI_PRICES_CHECKED_AT, Date.parse('2026-10-01T00:00:00Z'));
  assert.deepEqual(OPENAI_LIST_PRICES['gpt-6-luna'], { input: 1e-7, cacheRead: 1e-8, cacheWrite: 1.25e-7, output: 5e-7 });
  assert.deepEqual(OPENAI_LIST_PRICES['gpt-5.4'], { input: 2.5e-6, cacheRead: 2.5e-7, cacheWrite: null, output: 1.5e-5 });
  assert.deepEqual(OPENAI_LIST_PRICES['gpt-5.5-pro'], { input: 3e-5, cacheRead: null, cacheWrite: null, output: 1.8e-4 });
  assert.equal(Object.keys(OPENAI_LIST_PRICES).length, 17);
  assert.equal(OPENAI_LIST_PRICES['gpt-4o'], undefined);
});

test('codexPriceBook picks list prices for direct OpenAI and never mixes sources', (t) => {
  const litellm = { checkedAt: 5, provider: 'gw', prices: { m: { input: 1e-6, output: 2e-6, cacheRead: null, cacheWrite: null } } };
  const direct = home(t, null);
  const book = codexPriceBook('openai', litellm, { home: direct.dir });
  assert.equal(book.source, 'list');
  assert.equal(book.prices, OPENAI_LIST_PRICES);
  assert.equal(codexPriceBook('gw', litellm, { home: direct.dir }).source, 'litellm');
  assert.equal(codexPriceBook('gw', litellm, { home: direct.dir }).prices.m.input, 1e-6);
  assert.equal(codexPriceBook('other', litellm, { home: direct.dir }), null);
  assert.equal(codexPriceBook('gw', null, { home: direct.dir }), null);
});

test('an openai provider behind a proxy base url is not direct, so it needs a gateway price', (t) => {
  const proxied = home(t, 'openai_base_url = "https://proxy.example.com/v1"\n');
  assert.equal(isDirectOpenAI('openai', { home: proxied.dir }), false);
  assert.equal(codexPriceBook('openai', null, { home: proxied.dir }), null);
  const litellm = { checkedAt: 5, provider: 'openai', prices: {} };
  assert.equal(codexPriceBook('openai', litellm, { home: proxied.dir }).source, 'litellm');
  const official = home(t, 'openai_base_url = "https://api.openai.com/v1"\n');
  assert.equal(isDirectOpenAI('openai', { home: official.dir }), true);
});

test('the ledger prices a direct openai child without any LiteLLM snapshot', async (t) => {
  const h = home(t, null);
  const dir = join(h.base, 'state');
  const now = Date.now();
  const id = 'cccccccccccccccc';
  recordCodexDelegation({ id, at: now - 15000, parentSessionId: 'parent', from: 'gpt-5.4', to: 'gpt-5.4-mini', provider: 'openai' }, { dir });
  const t0 = (d) => new Date(now - 10000 + d).toISOString();
  const usage = { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 500 };
  const rows = [
    { timestamp: t0(-10000), type: 'session_meta', payload: { id: 'kid', cwd: h.base, model_provider: 'openai', source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } } },
    { timestamp: t0(0), type: 'event_msg', payload: { type: 'task_started', turn_id: 't' } },
    { timestamp: t0(0), type: 'turn_context', payload: { turn_id: 't', model: 'gpt-5.4-mini', cwd: h.base } },
    { timestamp: t0(0), type: 'event_msg', payload: { type: 'item_completed', turn_id: 't', item: { type: 'UserMessage', id: 'm', content: [{ type: 'text', text: `Find files\n<!-- sprag:codex:route id=${id} -->` }] } } },
    { timestamp: t0(100), type: 'token_usage_record', payload: { turn_id: 't', usage, turn_token_usage: usage } },
    { timestamp: t0(100), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: usage, total_token_usage: usage } } },
    { timestamp: t0(200), type: 'event_msg', payload: { type: 'task_complete', turn_id: 't' } },
  ];
  writeFileSync(join(h.dir, 'sessions', 'rollout.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const e = (await refreshCodexLedger({ dir, home: h.dir, now, prices: null })).events[id];
  const expected = codexRunCost({ input: 1000, output: 500 }, OPENAI_LIST_PRICES['gpt-5.4']) - codexRunCost({ input: 1000, output: 500 }, OPENAI_LIST_PRICES['gpt-5.4-mini']);
  assert.equal(e.priceSource, 'list');
  assert.equal(e.priceCheckedAt, OPENAI_PRICES_CHECKED_AT);
  assert.ok(Math.abs(e.usd - expected) < 1e-4);
});

test('deploymentPrice reads the 1h cache write rate and leaves it null when absent', () => {
  const info = { input_cost_per_token: 1e-6, output_cost_per_token: 5e-6, cache_creation_input_token_cost: 1.25e-6 };
  assert.equal(deploymentPrice({ model_info: info }).cacheWrite1h, null);
  assert.equal(deploymentPrice({ model_info: { ...info, cache_creation_input_token_cost_above_1hr: 2e-6 } }).cacheWrite1h, 2e-6);
});
