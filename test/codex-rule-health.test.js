import test from 'node:test';
import assert from 'node:assert/strict';
import { codexRuleHealth } from '../src/codex-rule-health.js';

const rule = { category: 'explore', from: 'gpt-6-luna', model: 'gpt-5.6-luna', provider: 'openai' };
const run = (over = {}) => ({ category: 'explore', from: 'gpt-6-luna', to: 'gpt-5.6-luna', provider: 'openai',
  complete: true, calls: 10, toolErrors: 0, usd: 0.01, ...over });

test('a rule whose delegations mostly fail goes to review', () => {
  const events = [run(), run({ aborted: true, complete: false }), ...Array.from({ length: 6 }, () => run({ toolErrors: 5 }))];
  const h = codexRuleHealth(rule, { events });
  assert.equal(h.runs, 8);
  assert.equal(h.errs, 7);
  assert.equal(h.status, 'review');
});

test('few runs or a healthy record stay active, and other rules do not count', () => {
  assert.equal(codexRuleHealth(rule, { events: [run({ toolErrors: 9 }), run({ toolErrors: 9 })] }).status, 'active');
  const healthy = Array.from({ length: 10 }, () => run({ toolErrors: 1 }));
  const h = codexRuleHealth(rule, { events: [...healthy, run({ to: 'gpt-5.5', toolErrors: 9 }), run({ category: 'run', toolErrors: 9 })] });
  assert.equal(h.runs, 10);
  assert.equal(h.errs, 0);
  assert.equal(h.status, 'active');
  assert.ok(Math.abs(h.saved - 0.1) < 1e-9);
});

test('an in-flight run is not judged yet', () => {
  assert.equal(codexRuleHealth(rule, { events: [run({ complete: false })] }).runs, 0);
});
