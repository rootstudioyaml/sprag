import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatewayCachePolicies, readCodexCachePolicy, refreshCodexCachePolicy, createCodexCachePolicyReader } from '../src/codex-cache-policy.js';
import { codexCacheTimer } from '../src/codex-cache.js';

const now = 1800000000000;
const session = { model: 'alias', provider: 'litellm', cacheActivity: { model: 'alias', provider: 'litellm', at: new Date(now - 1000) } };
const row = (overrides = {}) => ({ model_name: 'alias', litellm_params: { model: 'bedrock/converse/arn:aws:bedrock:profile' },
  model_info: { base_model: 'bedrock/openai.gpt-6-astra' }, ...overrides });
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'sprag-policy-'));
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  writeFileSync(join(home, 'config.toml'), 'model_provider="litellm"\n[model_providers.litellm]\nname="LiteLLM"\nbase_url="https://example.test/v1"\nenv_key="TEST_KEY"\n');
  return { home, dir: home, env: { TEST_KEY: 'secret-key' }, now };
}

test('gateway policies resolve actual models, not alias names, and require deployment agreement', () => {
  assert.equal(gatewayCachePolicies({ data: [row()] }).alias.backend, 'Bedrock');
  assert.equal(gatewayCachePolicies({ data: [row(), row()] }).alias.seconds, 1800);
  const unknown = row({ model_info: { base_model: 'bedrock/anthropic.claude-opus-5' } });
  assert.equal(gatewayCachePolicies({ data: [unknown] }).alias, null);
  assert.equal(gatewayCachePolicies({ data: [row(), unknown] }).alias, null);
  for (const params of [
    { model: 'openai/gpt-6-astra', api_base: 'https://another-provider.test' },
    { model: 'bedrock/converse/profile', prompt_cache_options: { ttl: '5m' } },
    { model: 'bedrock/converse/profile', prompt_cache_retention: '24h' },
  ]) assert.equal(gatewayCachePolicies({ data: [row({ litellm_params: params })] }).alias, null);
  assert.throws(() => gatewayCachePolicies({}), /no model list/);
});

test('refresh authenticates only to the configured endpoint and stores sanitized policy, never raw credentials', async (t) => {
  const opts = fixture(t);
  assert.equal(readCodexCachePolicy(session, opts), null);
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://example.test/model/info');
    assert.equal(init.headers.authorization, 'Bearer secret-key');
    assert.equal(init.redirect, 'error');
    return { ok: true, json: async () => ({ data: [row({ api_key: 'raw-secret', debug: 'private' })] }) };
  };
  const policy = await refreshCodexCachePolicy(session, { ...opts, fetchImpl });
  assert.equal(codexCacheTimer(session, { now, policy }).text, 'Cache 29:59 (Bedrock 30m)');
  assert.deepEqual(readCodexCachePolicy(session, opts), policy);
  assert.equal(readCodexCachePolicy(session, { ...opts, now: now + 300000 }), null);
  assert.equal(readCodexCachePolicy(session, { ...opts, now: now - 1 }), null);
  assert.equal(readCodexCachePolicy({ ...session, model: 'other' }, opts), null);
  const files = readdirSync(join(opts.dir, 'codex-cache-policy'));
  assert.equal(files.length, 1);
  assert.doesNotMatch(readFileSync(join(opts.dir, 'codex-cache-policy', files[0]), 'utf8'), /secret|private|arn:aws|litellm_params/);
  await Promise.all([1, 2].map(() => refreshCodexCachePolicy(session, { ...opts, fetchImpl })));
  assert.equal(readdirSync(join(opts.dir, 'codex-cache-policy')).length, 1);
  await assert.rejects(refreshCodexCachePolicy(session, { ...opts, fetchImpl: async () => { throw new Error('secret-key'); } }), /model\/info unavailable/);
});

test('live reader coalesces requests and retries stale policies, keeping failures unresolved', async (t) => {
  const opts = fixture(t);
  let calls = 0, at = now;
  const read = createCodexCachePolicyReader({ ...opts, now: () => at, refresh: async (_session, args) => {
    calls++; assert.equal(args.now, at); throw new Error('offline');
  } });
  assert.equal(read(session), null);
  read(session);
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  read(session);
  assert.equal(calls, 1);
  at += 300000;
  read(session);
  await new Promise(setImmediate);
  assert.equal(calls, 2);
});

test('direct OpenAI models use the documented window unless configured to a different server', (t) => {
  const opts = fixture(t);
  const direct = { ...session, provider: 'openai', model: 'gpt-6-astra' };
  assert.equal(readCodexCachePolicy(direct, opts).seconds, 1800);
  writeFileSync(join(opts.home, 'config.toml'), 'openai_base_url="https://example.test/v1"\n');
  assert.equal(readCodexCachePolicy(direct, opts), null);
});
