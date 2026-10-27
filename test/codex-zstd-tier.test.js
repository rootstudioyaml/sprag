/**
 * Compressed Codex rollouts (.jsonl.zst) and long-context price tiers: the line
 * reader, discovery, per-request records, the tiered gateway price and the
 * Claude-side `totals.long` pricing. HOME/CODEX_HOME point at a temp dir.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { transcriptLines } from '../src/transcript-lines.js';
import { discoverCodexSessionFiles, parseCodexSessionFile } from '../src/codex/parser.js';
import { deploymentPrice, priceForPrompt, codexRequestCost, codexRunCost } from '../src/gateway-prices.js';
import { estimateCost } from '../src/cost.js';

const SKIP = typeof zlib.zstdCompressSync !== 'function' ? 'zlib has no zstd on this Node' : false;

function tempDir(t) {
  const root = mkdtempSync(join(tmpdir(), 'sprag-zstd-'));
  const saved = { HOME: process.env.HOME, CODEX_HOME: process.env.CODEX_HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = root;
  process.env.XDG_CONFIG_HOME = root;
  process.env.CODEX_HOME = join(root, '.codex');
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return root;
}

const ROLLOUT = [
  { timestamp: '2026-10-26T01:00:00.000Z', type: 'session_meta', payload: { id: 'sess-1', cwd: '/work/한글-프로젝트' } },
  { timestamp: '2026-10-26T01:00:01.000Z', type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-6-luna' } },
  { timestamp: '2026-10-26T01:00:02.000Z', type: 'token_usage_record', payload: { response_id: 'r1', turn_id: 't1',
    usage: { input_tokens: 1000, cached_input_tokens: 600, cache_write_input_tokens: 100, output_tokens: 50 } } },
  { timestamp: '2026-10-26T01:01:00.000Z', type: 'turn_context', payload: { turn_id: 't2', model: 'gpt-6-astra' } },
  { timestamp: '2026-10-26T01:01:02.000Z', type: 'token_usage_record', payload: { response_id: 'r2', turn_id: 't2',
    usage: { input_tokens: 400000, cached_input_tokens: 390000, cache_write_input_tokens: 5000, output_tokens: 300 } } },
].map((e) => JSON.stringify(e)).join('\n') + '\n';

function writeRollout(dir, name, { plain = true, zst = false } = {}) {
  mkdirSync(dir, { recursive: true });
  if (plain) writeFileSync(join(dir, `${name}.jsonl`), ROLLOUT);
  if (zst) writeFileSync(join(dir, `${name}.jsonl.zst`), zlib.zstdCompressSync(Buffer.from(ROLLOUT)));
}

async function collect(path) {
  const lines = [];
  for await (const line of transcriptLines(path)) lines.push(line);
  return lines;
}

test('transcriptLines yields the same lines for a .jsonl and its .zst', { skip: SKIP }, async (t) => {
  const root = tempDir(t);
  writeRollout(root, 'rollout-a', { plain: true, zst: true });
  const plain = await collect(join(root, 'rollout-a.jsonl'));
  const packed = await collect(join(root, 'rollout-a.jsonl.zst'));
  assert.equal(plain.length, 5);
  assert.deepEqual(packed, plain);
  assert.ok(packed[0].includes('한글-프로젝트'));
});

test('transcriptLines on a .zst can be left early without hanging', { skip: SKIP }, async (t) => {
  const root = tempDir(t);
  writeRollout(root, 'rollout-a', { plain: false, zst: true });
  for await (const line of transcriptLines(join(root, 'rollout-a.jsonl.zst'))) { assert.ok(line); break; }
});

test('discoverCodexSessionFiles ignores .zst by default and prefers the live .jsonl', { skip: SKIP }, async (t) => {
  const root = tempDir(t);
  const sessions = join(root, '.codex', 'sessions', '2026', '10', '26');
  writeRollout(sessions, 'rollout-plain');
  writeRollout(sessions, 'rollout-packed', { plain: false, zst: true });
  writeRollout(sessions, 'rollout-both', { plain: true, zst: true });
  const names = (files) => files.map((f) => basename(f.path)).sort();
  const home = join(root, '.codex');
  assert.deepEqual(names(await discoverCodexSessionFiles({ home })), ['rollout-both.jsonl', 'rollout-plain.jsonl']);
  assert.deepEqual(names(await discoverCodexSessionFiles({ home, compressed: true })),
    ['rollout-both.jsonl', 'rollout-packed.jsonl.zst', 'rollout-plain.jsonl']);
});

test('parseCodexSessionFile on a .zst rollout equals the plain one', { skip: SKIP }, async (t) => {
  const root = tempDir(t);
  writeRollout(root, 'rollout-a', { plain: true, zst: true });
  const plain = await parseCodexSessionFile(join(root, 'rollout-a.jsonl'));
  const packed = await parseCodexSessionFile(join(root, 'rollout-a.jsonl.zst'));
  assert.deepEqual({ ...packed, filePath: null }, { ...plain, filePath: null });
  assert.equal(packed.requestCount, 2);
});

test('keepRequests returns one row per request with its own model; absent otherwise', async (t) => {
  const root = tempDir(t);
  writeRollout(root, 'rollout-a');
  const file = join(root, 'rollout-a.jsonl');
  const kept = await parseCodexSessionFile(file, { keepRequests: true });
  assert.equal(kept.requests.length, 2);
  assert.deepEqual(kept.requests.map(({ ts, ...r }) => r), [
    { model: 'gpt-6-luna', input: 1000, cached: 600, cacheWrite: 100, output: 50 },
    { model: 'gpt-6-astra', input: 400000, cached: 390000, cacheWrite: 5000, output: 300 },
  ]);
  assert.equal(kept.requests[0].ts, Date.parse('2026-10-26T01:00:02.000Z'));
  const plain = await parseCodexSessionFile(file);
  assert.equal('requests' in plain, false);
});

const ASTRA_ROW = { model_name: 'gpt-6-astra', model_info: { mode: 'responses',
  input_cost_per_token: 1e-5, output_cost_per_token: 5e-5, cache_read_input_token_cost: 1e-6,
  cache_creation_input_token_cost: 1.25e-5, cache_creation_input_token_cost_above_1hr: 2e-5,
  input_cost_per_token_above_272k_tokens: 2e-5, output_cost_per_token_above_272k_tokens: 7.5e-5,
  cache_read_input_token_cost_above_272k_tokens: 2e-6, cache_creation_input_token_cost_above_272k_tokens: 2.5e-5 } };

test('deploymentPrice reads long-context tiers and keeps the plain 1h write rate out of them', () => {
  const price = deploymentPrice(ASTRA_ROW);
  assert.equal(price.cacheWrite1h, 2e-5);
  assert.deepEqual(price.tiers, [{ threshold: 272000, input: 2e-5, output: 7.5e-5, cacheRead: 2e-6, cacheWrite: 2.5e-5, cacheWrite1h: null }]);
  const plain = deploymentPrice({ model_info: { input_cost_per_token: 1e-5, output_cost_per_token: 5e-5, cache_creation_input_token_cost_above_1hr: 2e-5 } });
  assert.equal('tiers' in plain, false);
  assert.equal(plain.cacheWrite1h, 2e-5);
});

test('codexRequestCost prices a request at the tier its own prompt reaches', () => {
  const price = deploymentPrice(ASTRA_ROW);
  const usage = { input: 475594, cached: 475220, cacheWrite: 372, output: 342 };
  assert.ok(Math.abs(codexRequestCost(usage, price) - 0.98543) < 1e-6);
  const small = { input: 1000, cached: 600, cacheWrite: 100, output: 50 };
  assert.equal(codexRequestCost(small, price), codexRunCost(small, price));
  // LiteLLM's rule is strictly greater than the threshold
  assert.equal(priceForPrompt(price, 272000), price);
  assert.notEqual(priceForPrompt(price, 272001), price);
  assert.equal(priceForPrompt(null, 500000), null);
});

test('estimateCost with a gateway price applies a 100K tier to totals.long only', () => {
  const base = { input: 1e-5, output: 5e-5, cacheRead: 1e-6, cacheWrite: 1.25e-5, cacheWrite1h: 2e-5 };
  const tiered = { ...base, tiers: [{ threshold: 100000, input: 2e-5, output: 7.5e-5, cacheRead: 2e-6, cacheWrite: 2.5e-5, cacheWrite1h: null }] };
  const totals = { input: 2e6, cacheCreation: 0, cacheRead: 4e6, ephemeral5m: 0, ephemeral1h: 0, output: 1e6,
    long: { input: 1e6, cacheCreation: 0, cacheRead: 3e6, ephemeral5m: 0, ephemeral1h: 0, output: 5e5 } };
  // short: 1M*$10 + 1M*$1 + 0.5M*$50 = 36; long: 1M*$20 + 3M*$2 + 0.5M*$75 = 63.5
  const withTier = estimateCost(totals, 'claude-haiku-5-5', { price: tiered });
  assert.equal(withTier.tier, 'gateway');
  assert.equal(withTier.actual, 99.5);
  // no tier: everything at base, the same as before this change
  assert.equal(estimateCost(totals, 'claude-haiku-5-5', { price: base }).actual, 74);
  // a tier at another threshold cannot be applied to Claude totals
  const other = { ...base, tiers: [{ ...tiered.tiers[0], threshold: 272000 }] };
  assert.equal(estimateCost(totals, 'claude-haiku-5-5', { price: other }).actual, 74);
});
