// Rule health judges a delegated rule against the session model's own failure
// rate on the same work (Co-Failure Ceiling, arXiv 2606.27288): failures every
// model hits are not the downgrade's fault.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The rule registry resolves its directory from the environment when it loads.
const home = realpathSync(mkdtempSync(join(tmpdir(), 'cts-health-baseline-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, 'config');
process.env.APPDATA = join(home, 'config');

const rules = await import('../src/model-rules.js');

after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const stateDir = join(home, 'config', 'claude-token-saver');
const saveRegistry = (list) => {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'model-rules.json'), JSON.stringify({ rules: list }));
};
const rule = {
  tier: 'T1', category: 'run', label: '명령 실행', labelEn: 'running commands', agent: 't1-worker',
  scope: 'global', targetRoot: null, project: '-p', signature: 'T1|run|-p', rule: 'r',
  example: 'npm 인증', promotedAt: '2026-08-01', count: 5, status: 'active',
};
// 5 failures in 8 delegated runs: Wilson lower bound ≈ 0.31, over the 20% floor.
const delegated = () => new Map([['T1|run|-p', { runs: 8, errRuns: 5, outTokens: 0, savedUsd: 0 }]]);
const shapeStats = (failCount, epCount) => new Map([
  ['T1|run|-p', { count: epCount, errCount: failCount, failCount, epCount, baselineModel: null, modelCounts: {} }],
]);

test('reviewThreshold falls back to the floor without a usable baseline', () => {
  assert.equal(rules.reviewThreshold(null), rules.HEALTH_ERR_RATE);
  assert.equal(rules.reviewThreshold(0.6, rules.HEALTH_MIN_SAMPLE - 1), rules.HEALTH_ERR_RATE, 'too few episodes');
  assert.equal(rules.reviewThreshold(0.05, 50), rules.HEALTH_ERR_RATE, 'never stricter than the floor');
  assert.equal(rules.reviewThreshold(0.45, 20), 0.45);
});

test('a delegated rule failing no more than the session model stays active', () => {
  saveRegistry([{ ...rule }]);
  const [r] = rules.refreshModelRules(shapeStats(9, 20), delegated(), { now: '2026-10-30T00:00:00.000Z' }).rules;
  assert.equal(r.healthSource, 'delegated');
  assert.equal(r.baselineErrRate, 0.45);
  assert.equal(r.baselineSample, 20);
  assert.equal(r.status, 'active');
  assert.equal(rules.ruleReviewThreshold(r), 0.45);
});

test('the same delegated failures go to review when the session model rarely fails', () => {
  saveRegistry([{ ...rule }]);
  const [r] = rules.refreshModelRules(shapeStats(1, 20), delegated(), { now: '2026-10-30T00:00:00.000Z' }).rules;
  assert.equal(r.status, 'review');
  assert.equal(rules.ruleReviewThreshold(r), rules.HEALTH_ERR_RATE);
});

test('without shape episodes the floor decides, as before the baseline existed', () => {
  saveRegistry([{ ...rule }]);
  const [r] = rules.refreshModelRules(new Map(), delegated(), { now: '2026-10-30T00:00:00.000Z' }).rules;
  assert.equal(r.baselineErrRate, null);
  assert.equal(r.status, 'review');
});
