/**
 * team-rule-stats — the delegation-rule summary a team member uploads.
 * The registry holds project paths and prompt excerpts; the summary must carry
 * numbers and enumerations only, so the key set is pinned here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeModelRules, ruleStatsSummary, RULE_STAT_KEYS, RULE_STATS_MAX } from '../src/team-rule-stats.js';

const SECRET_PATH = '/Users/someone-secret/work/payments-app';
const SECRET_TEXT = 'SECRET-PROMPT-EXCERPT do not leak';

const base = (over) => ({
  signature: `T2|explore|${SECRET_PATH}`, tier: 'T2', category: 'explore', label: '탐색 라벨', labelEn: 'lookup label',
  scope: 'project', targetRoot: SECRET_PATH, project: SECRET_PATH, rule: `rule text ${SECRET_TEXT}`,
  example: SECRET_TEXT, exampleEn: SECRET_TEXT, count: 5, errRate: 0.1, promotedAt: '2026-10-10T08:00:00.000Z',
  lastSeen: '2026-11-01', status: 'active', delegatedRuns: 10, delegatedErrRate: 0.2, savedUsd: 1.234,
  baselineErrRate: 0.3, baselineSample: 10, budget: { calls: 8, out: 1500 }, ...over,
});

const REGISTRY = [
  base({}),
  base({ // same category and tier, another project: folded into the row above
    signature: 'T2|explore|/Users/someone-secret/other', targetRoot: '/Users/someone-secret/other', project: '/Users/someone-secret/other',
    count: 3, promotedAt: '2026-09-01', status: 'review', delegatedRuns: 30, delegatedErrRate: 0.1, savedUsd: 2.005,
    baselineErrRate: 0.1, baselineSample: 30, budget: undefined,
  }),
  base({ tier: 'T1', category: 'read', status: 'off', count: 99, delegatedRuns: 99, savedUsd: 99 }),
  base({ tier: 'T1', category: 'check', count: 2, delegatedRuns: 0, delegatedErrRate: 0, savedUsd: 0, baselineErrRate: null, baselineSample: 0, budget: undefined, promotedAt: undefined }),
  base({ tier: 'T3', category: 'run' }),         // unknown tier
  base({ tier: 'T2', category: 'not-a-category' }), // unknown category
];

test('the row keys are exactly the allowlist', () => {
  const rows = summarizeModelRules(REGISTRY);
  assert.deepEqual([...RULE_STAT_KEYS].sort(), [
    'baseline_err', 'budget_calls', 'budget_out', 'category', 'delegated', 'delegated_err',
    'episodes', 'saved_usd', 'since', 'status', 'tier',
  ]);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), [...RULE_STAT_KEYS].sort());
});

test('no path, example, label or rule text reaches the JSON', () => {
  const json = JSON.stringify(summarizeModelRules(REGISTRY));
  for (const leak of [SECRET_PATH, 'someone-secret', SECRET_TEXT, 'rule text', '탐색 라벨', 'lookup label', 'T2|explore', 'signature', 'targetRoot', 'project']) {
    assert.ok(!json.includes(leak), `leaked ${leak}`);
  }
});

test('rules of one category and tier fold: sums, weighted means, earliest date, active wins', () => {
  const rows = summarizeModelRules(REGISTRY);
  const explore = rows.find((r) => r.category === 'explore' && r.tier === 'T2');
  assert.deepEqual(explore, {
    category: 'explore', tier: 'T2', status: 'active', episodes: 8, delegated: 40,
    delegated_err: 0.125,     // (10 * 0.2 + 30 * 0.1) / 40
    saved_usd: 3.24,          // 1.234 + 2.005, two decimals
    baseline_err: 0.15,       // (10 * 0.3 + 30 * 0.1) / 40
    budget_calls: 8, budget_out: 1500, since: '2026-09-01',
  });
  assert.equal(rows.filter((r) => r.category === 'explore' && r.tier === 'T2').length, 1, 'one row per pair');
});

test('a rule with no measurements and no budget gets nulls and the tier default', () => {
  const row = summarizeModelRules(REGISTRY).find((r) => r.category === 'check');
  assert.deepEqual(row, {
    category: 'check', tier: 'T1', status: 'active', episodes: 2, delegated: 0, delegated_err: null,
    saved_usd: 0, baseline_err: null, budget_calls: null, budget_out: 8000, since: null,
  });
});

test('off rules, unknown tiers and unknown categories are left out; all review folds to review', () => {
  const rows = summarizeModelRules(REGISTRY);
  assert.deepEqual(rows.map((r) => `${r.category}/${r.tier}`), ['explore/T2', 'check/T1']);
  const onlyReview = summarizeModelRules([base({ status: 'review' }), base({ status: 'review', count: 1 })]);
  assert.equal(onlyReview.length, 1);
  assert.equal(onlyReview[0].status, 'review');
  assert.deepEqual(summarizeModelRules(null), []);
  assert.deepEqual(summarizeModelRules([null, 5, {}]), []);
});

test('the pair is unique and the list never exceeds the server cap', () => {
  const rows = summarizeModelRules(REGISTRY);
  assert.equal(new Set(rows.map((r) => `${r.category}|${r.tier}`)).size, rows.length);
  const cats = ['paste', 'translate', 'explore', 'read', 'check', 'run'];
  const all = cats.flatMap((category) => ['T2', 'T1', 'T1H'].map((tier) => base({ category, tier })));
  const full = summarizeModelRules(all);
  assert.equal(full.length, 18);
  assert.ok(full.length <= RULE_STATS_MAX && RULE_STATS_MAX === 24);
});

test('ruleStatsSummary reads model-rules.json from the given directory', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-rulestats-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(ruleStatsSummary({ dir }), [], 'no registry, no rows');
  writeFileSync(join(dir, 'model-rules.json'), JSON.stringify({ rules: REGISTRY }));
  assert.equal(ruleStatsSummary({ dir }).length, 2);
});
