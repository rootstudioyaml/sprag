/**
 * Model ids arrive in more shapes than the direct API's `claude-opus-5`.
 * Behind a company gateway they can be Bedrock ARNs, Bedrock/Vertex ids, or a
 * house alias that names no Claude family at all. The first three must price
 * correctly; the last must be refused rather than silently priced as Sonnet,
 * and must become mappable through profile-map.json.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRecognizedModelId, modelRank, estimateCost } from '../src/cost.js';
import { resolveModelAlias, resetModelAliasCache, UNKNOWN_MODEL } from '../src/model-alias.js';

test('gateway id shapes that keep the family name are priced correctly', () => {
  const cases = [
    ['anthropic.claude-opus-4-5-20251101-v1:0', 2],        // Bedrock
    ['us.anthropic.claude-haiku-4-5-20251001-v1:0', 0],    // Bedrock cross-region
    ['claude-opus-4-5@20251101', 2],                        // Vertex
    ['claude-sonnet-4-5[1m]', 1],                           // 1M context suffix
    ['claude-fable-5', 3],
  ];
  for (const [id, rank] of cases) {
    assert.ok(isRecognizedModelId(id), `${id} should be recognized`);
    assert.equal(modelRank(id), rank, `${id} rank`);
  }
});

test('a house alias is not recognized, so no comparison is built on it', () => {
  for (const id of ['prod-large', 'team-fast', 'gateway-default', 'unknown', '']) {
    assert.equal(isRecognizedModelId(id), false, `${id} must not be recognized`);
  }
  // It still prices (the Sonnet default) — which is exactly why comparisons
  // must gate on isRecognizedModelId instead of trusting the number.
  const totals = { input: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 1_000_000 };
  assert.equal(estimateCost(totals, 'prod-large').actual, estimateCost(totals, 'claude-sonnet-5').actual);
});

test('modelAliases maps a house alias back to a real model', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-house-'));
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  resetModelAliasCache();
  t.after(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
    resetModelAliasCache();
  });
  const stateDir = join(dir, 'claude-token-saver');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, 'profile-map.json'),
    JSON.stringify({ modelAliases: { 'prod-large': 'claude-opus-5', 'team-*': 'claude-haiku-4-5' } }),
  );

  assert.equal(resolveModelAlias('prod-large'), 'claude-opus-5');
  assert.equal(resolveModelAlias('team-fast'), 'claude-haiku-4-5', 'glob patterns work on plain ids too');
  // Unmapped ids pass through untouched — overrides must not rewrite anything
  // they were not asked to.
  assert.equal(resolveModelAlias('claude-sonnet-5'), 'claude-sonnet-5');
  assert.equal(resolveModelAlias('other-house-alias'), 'other-house-alias');
  assert.equal(resolveModelAlias(''), UNKNOWN_MODEL);
});
