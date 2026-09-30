import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexContextTokens, codexRouteHint, codexPromptCategory } from '../src/codex-delegation.js';
import { recordCodexDelegation, readCodexDelegations, bindCodexSubagent, readCodexBindings, refreshCodexLedger } from '../src/codex-ledger.js';
import { codexHarnessBlock } from '../src/codex-harness.js';

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'sprag-bind-'));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const dir = join(base, 'state');
  const home = join(base, 'codex');
  for (const p of [dir, join(home, 'sessions'), join(home, 'archived_sessions')]) mkdirSync(p, { recursive: true });
  return { base, dir, home };
}

const rule = { category: 'explore', from: 'gpt-6-astra', model: 'gpt-6-luna', scope: 'global',
  targetRoot: null, status: 'active' };

// ── codexRouteHint context gate ───────────────────────────────────────────

test('codexRouteHint withholds the hint below the context floor and records once it clears', (t) => {
  const f = fixture(t);
  const payload = { prompt: 'Find the parser files', model: 'gpt-6-astra', session_id: 'parent-1', turn_id: 't1', cwd: f.base };
  assert.equal(codexRouteHint(payload, { rules: [rule], dir: f.dir, contextTokens: 59999 }), null);
  assert.deepEqual(readCodexDelegations({ dir: f.dir }), []);

  const hint = codexRouteHint(payload, { rules: [rule], dir: f.dir, contextTokens: 60000 });
  assert.match(hint, /\[Sprag model routing\]/);
  assert.match(hint, /fork_turns "none"/);
  assert.match(hint, /<!-- sprag:codex:route id=[0-9a-f]{16} -->/);
  const pending = readCodexDelegations({ dir: f.dir });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].to, 'gpt-6-luna');
  assert.equal(pending[0].parentSessionId, 'parent-1');
});

test('codexRouteHint minContext 0 clears the gate even with no measured context', (t) => {
  const f = fixture(t);
  const payload = { prompt: 'Find the parser files', model: 'gpt-6-astra', session_id: 'parent-2', cwd: f.base };
  const hint = codexRouteHint(payload, { rules: [rule], dir: f.dir, minContext: 0 });
  assert.match(hint, /\[Sprag model routing\]/);
});

// ── codexContextTokens ─────────────────────────────────────────────────────

test('codexContextTokens reads the last token_count and defaults to 0 when unreadable', (t) => {
  const f = fixture(t);
  const file = join(f.home, 'sessions', 'rollout.jsonl');
  const rows = [
    { timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1000 } } } },
    { timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'task_complete' } },
    { timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 71234 } } } },
  ];
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  assert.equal(codexContextTokens(file), 71234);
  assert.equal(codexContextTokens(join(f.home, 'sessions', 'missing.jsonl')), 0);
  assert.equal(codexContextTokens(undefined), 0);
});

// ── bindCodexSubagent ──────────────────────────────────────────────────────

test('bindCodexSubagent binds only a matching, recent, unclaimed pending route', (t) => {
  const f = fixture(t);
  const now = Date.now();
  recordCodexDelegation({ id: '0123456789abcdef', at: now - 1000, parentSessionId: 'parent-1', to: 'child-model' }, { dir: f.dir });
  recordCodexDelegation({ id: 'fedcba9876543210', at: now - 1000, parentSessionId: 'other-parent', to: 'child-model' }, { dir: f.dir });
  recordCodexDelegation({ id: '1111111111111111', at: now - 1000, parentSessionId: 'parent-1', to: 'other-model' }, { dir: f.dir });
  recordCodexDelegation({ id: '2222222222222222', at: now - 31 * 60000, parentSessionId: 'parent-1', to: 'child-model' }, { dir: f.dir });

  const payload = { session_id: 'parent-1', agent_id: 'child-session', model: 'child-model' };
  const id = bindCodexSubagent(payload, { dir: f.dir, now });
  assert.equal(id, '0123456789abcdef');
  const binds = readCodexBindings({ dir: f.dir });
  assert.equal(binds.length, 1);
  assert.equal(binds[0].childSessionId, 'child-session');

  assert.equal(bindCodexSubagent(payload, { dir: f.dir, now }), null);
  assert.equal(bindCodexSubagent({ session_id: 'other-parent-2', agent_id: 'x', model: 'child-model' }, { dir: f.dir, now }), null);
});

// ── refreshCodexLedger falls back to a binding when no marker is present ───

function records({ id, model, provider = 'current-gateway', root, parentThreadId, aborted = false }) {
  const now = Date.now();
  const rows = [{ timestamp: new Date(now - 20000).toISOString(), type: 'session_meta', payload: {
    id, cwd: root, model_provider: provider, source: { subagent: { thread_spawn: { parent_thread_id: parentThreadId } } },
  } }];
  const turn_id = `${id}-turn-0`;
  const at = now - 10000;
  const push = (type, payload, delta = 0) => rows.push({ timestamp: new Date(at + delta).toISOString(), type, payload });
  push('event_msg', { type: 'task_started', turn_id });
  push('turn_context', { turn_id, model, cwd: root });
  push('event_msg', { type: 'item_completed', turn_id, item: {
    type: 'UserMessage', id: 'message-0', content: [{ type: 'text', text: 'Find the parser files' }],
  } });
  const usage = { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 500 };
  push('token_usage_record', { turn_id, usage, turn_token_usage: usage }, 100);
  push('event_msg', { type: 'token_count', info: { last_token_usage: usage, total_token_usage: usage } }, 100);
  push('event_msg', aborted ? { type: 'turn_aborted', turn_id, reason: 'interrupted' } : { type: 'task_complete', turn_id }, 200);
  return rows;
}

test('refreshCodexLedger attributes a markerless child rollout via its SubagentStart binding', async (t) => {
  const f = fixture(t);
  const now = Date.now();
  const id = 'aaaaaaaaaaaaaaaa';
  recordCodexDelegation({ id, at: now - 15000, parentSessionId: 'parent-session', to: 'child-model', provider: 'current-gateway' }, { dir: f.dir });
  const bound = bindCodexSubagent({ session_id: 'parent-session', agent_id: 'child-session', model: 'child-model' }, { dir: f.dir, now });
  assert.equal(bound, id);

  const rows = records({ id: 'child-session', model: 'child-model', root: f.base, parentThreadId: 'parent-session' });
  writeFileSync(join(f.home, 'sessions', 'rollout.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const ledger = await refreshCodexLedger({ dir: f.dir, home: f.home, now, prices: null });
  assert.equal(ledger.events[id].childSessionId, 'child-session');
  assert.equal(ledger.events[id].tokens.output, 500);
});

test('refreshCodexLedger books an interrupted child as a loss of its whole cost, not a saving', async (t) => {
  const f = fixture(t);
  const now = Date.now();
  const id = 'bbbbbbbbbbbbbbbb';
  recordCodexDelegation({ id, at: now - 15000, parentSessionId: 'parent-session', from: 'parent-model', to: 'child-model', provider: 'current-gateway' }, { dir: f.dir });
  bindCodexSubagent({ session_id: 'parent-session', agent_id: 'child-session', model: 'child-model' }, { dir: f.dir, now });
  const rows = records({ id: 'child-session', model: 'child-model', root: f.base, parentThreadId: 'parent-session', aborted: true });
  writeFileSync(join(f.home, 'sessions', 'rollout.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const rate = (x) => ({ input: x, cacheRead: x / 10, cacheWrite: null, output: x * 4 });
  const prices = { provider: 'current-gateway', checkedAt: now, prices: { 'parent-model': rate(1e-5), 'child-model': rate(2e-6) } };

  const e = (await refreshCodexLedger({ dir: f.dir, home: f.home, now, prices })).events[id];
  // 800 uncached + 200 cached + 500 output at the child rate, all of it wasted.
  const actual = 800 * 2e-6 + 200 * 2e-7 + 500 * 8e-6;
  assert.equal(e.aborted, true);
  assert.equal(e.complete, false);
  assert.ok(Math.abs(e.usd + actual) < 1e-12, `expected ${-actual}, got ${e.usd}`);
});

test('the Codex routing hint tells the parent to wait for the child instead of redoing the task', () => {
  const hint = codexRouteHint({ prompt: 'Where is chipForIssues defined?', model: 'gpt-6-luna', cwd: '/tmp/p', session_id: 's' },
    { rules: [{ category: 'explore', from: 'gpt-6-luna', model: 'gpt-5.6-luna', scope: 'global', targetRoot: null, status: 'active' }],
      provider: 'openai', contextTokens: 60000, record: () => {} });
  assert.match(hint, /timeout_ms of at least 120000/);
  assert.match(hint, /do not do the delegated task yourself/);
  assert.match(codexHarnessBlock(), /wait for it to finish instead of doing the same task yourself/);
});

// ── harness block carries the delegation instruction ───────────────────────

test('the Codex harness block tells the agent a routing note is an explicit delegation request', () => {
  assert.match(codexHarnessBlock(), /\[Sprag model routing\] note on a request means the user has asked/);
});

// ── explore classifier keywords for "where is X defined" ──────────────────

test('codexPromptCategory recognizes "where is X defined" phrasing in English and Korean', () => {
  assert.equal(codexPromptCategory('Where is chipForIssues defined?')?.id, 'explore');
  assert.equal(codexPromptCategory('chipForIssues 함수는 어느 파일에 정의돼 있어?')?.id, 'explore');
  assert.notEqual(codexPromptCategory('잘 정의된 목표를 세워줘')?.id, 'explore');
});
