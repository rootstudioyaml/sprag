import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexContextTokens, codexRouteHint, codexPromptCategory } from '../src/codex-delegation.js';
import { pruneCodexDelegations, recordCodexDelegation, readCodexDelegations, bindCodexSubagent, readCodexBindings, refreshCodexLedger,
  closeStaleCodexRoutes } from '../src/codex-ledger.js';
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

function records({ id, model, provider = 'current-gateway', root, parentThreadId, aborted = false, text = 'Find the parser files' }) {
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
    type: 'UserMessage', id: 'message-0', content: [{ type: 'text', text }],
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
  assert.equal(e.usd, Math.round(-actual * 10000) / 10000); // stored to 4 decimals
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

test('bindCodexSubagent consumes pending routes oldest first', (t) => {
  const f = fixture(t);
  const now = Date.now();
  // Recorded newest-first on disk on purpose: order comes from the timestamp, not the line position.
  recordCodexDelegation({ id: 'bbbbbbbbbbbbbbbb', at: now - 1000, parentSessionId: 'p', to: 'child-model' }, { dir: f.dir });
  recordCodexDelegation({ id: 'aaaaaaaaaaaaaaaa', at: now - 5000, parentSessionId: 'p', to: 'child-model' }, { dir: f.dir });
  recordCodexDelegation({ id: 'cccccccccccccccc', at: now - 3000, parentSessionId: 'p', to: 'child-model' }, { dir: f.dir });
  const bind = (agent) => bindCodexSubagent({ session_id: 'p', agent_id: agent, model: 'child-model' }, { dir: f.dir, now });
  assert.equal(bind('kid-1'), 'aaaaaaaaaaaaaaaa');
  assert.equal(bind('kid-2'), 'cccccccccccccccc');
  assert.equal(bind('kid-3'), 'bbbbbbbbbbbbbbbb');
  assert.equal(bind('kid-4'), null);
});

test('refreshCodexLedger prunes pending records older than the pending TTL', async (t) => {
  const f = fixture(t);
  const now = Date.now();
  const day = 86400000;
  recordCodexDelegation({ id: 'aaaaaaaaaaaaaaaa', at: now - 8 * day, parentSessionId: 'p', to: 'm' }, { dir: f.dir });
  recordCodexDelegation({ id: 'bbbbbbbbbbbbbbbb', at: now - 1 * day, parentSessionId: 'p', to: 'm' }, { dir: f.dir });
  await refreshCodexLedger({ dir: f.dir, home: f.home, now, prices: null });
  assert.deepEqual(readCodexDelegations({ dir: f.dir }).map((r) => r.id), ['bbbbbbbbbbbbbbbb']);
  // Nothing stale: the file is left as it is.
  pruneCodexDelegations({ dir: f.dir, now });
  assert.equal(readCodexDelegations({ dir: f.dir }).length, 1);
});

test('a shared policy records each offered tier; SubagentStart binds the chosen one and the next prompt closes the other', async (t) => {
  const f = fixture(t);
  const now = Date.now();
  writeFileSync(join(f.dir, 'model-rules.json'), JSON.stringify({ rules: ['T2', 'T1'].map((tier) => ({ status: 'active',
    category: 'explore', tier, scope: 'global', targetRoot: null, signature: `${tier}|explore|preset` })) }));
  const cfg = { codex: { sharedRules: { targets: [
    { tier: 'T2', from: 'gpt-6-astra', model: 'child-model', provider: 'current-gateway' },
    { tier: 'T1', from: 'gpt-6-astra', model: 'medium-model', provider: 'current-gateway' }] } } };
  const payload = { prompt: 'Find the parser files', model: 'gpt-6-astra', model_provider: 'current-gateway',
    session_id: 'parent-session', turn_id: 't1', cwd: f.base };
  const hint = codexRouteHint(payload, { cfg, rules: [], dir: f.dir, contextTokens: 60000,
    record: (entry, opts) => recordCodexDelegation({ ...entry, at: now - 15000 }, opts) });
  assert.match(hint, /approved shared explore policy/);
  const pending = readCodexDelegations({ dir: f.dir });
  assert.deepEqual(pending.map((r) => [r.tier, r.to, r.via, r.source]),
    [['T2', 'child-model', 'prompt', 'shared'], ['T1', 'medium-model', 'prompt', 'shared']]);
  for (const r of pending) assert.ok(hint.includes(`<!-- sprag:codex:route id=${r.id} -->`));

  const chosen = pending.find((r) => r.tier === 'T2');
  assert.equal(bindCodexSubagent({ session_id: 'parent-session', agent_id: 'child-session', model: 'child-model', turn_id: 't1' },
    { dir: f.dir, now }), chosen.id);
  assert.equal(closeStaleCodexRoutes({ session_id: 'parent-session', turn_id: 't2' }, { dir: f.dir, now }), 1);
  const rows = records({ id: 'child-session', model: 'child-model', root: f.base, parentThreadId: 'parent-session' });
  writeFileSync(join(f.home, 'sessions', 'rollout.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const events = (await refreshCodexLedger({ dir: f.dir, home: f.home, now, prices: null })).events;
  assert.deepEqual(Object.keys(events), [chosen.id]);
  assert.deepEqual([events[chosen.id].source, events[chosen.id].tier, events[chosen.id].sharedSignature],
    ['shared', 'T2', 'T2|explore|preset']);
});

test('tiers mapped to one model are not bound by model alone; the child route marker decides', async (t) => {
  const f = fixture(t);
  const now = Date.now();
  writeFileSync(join(f.dir, 'model-rules.json'), JSON.stringify({ rules: ['T2', 'T1'].map((tier) => ({ status: 'active',
    category: 'explore', tier, scope: 'global', targetRoot: null, signature: `${tier}|explore|preset` })) }));
  const cfg = { codex: { sharedRules: { targets: [
    { tier: 'T2', from: 'gpt-6-astra', model: 'child-model', effort: 'low', provider: 'current-gateway' },
    { tier: 'T1', from: 'gpt-6-astra', model: 'child-model', effort: 'high', provider: 'current-gateway' }] } } };
  const payload = { prompt: 'Find the parser files', model: 'gpt-6-astra', model_provider: 'current-gateway',
    session_id: 'parent-session', turn_id: 't1', cwd: f.base };
  codexRouteHint(payload, { cfg, rules: [], dir: f.dir, contextTokens: 60000,
    record: (entry, opts) => recordCodexDelegation({ ...entry, at: now - 15000 }, opts) });
  const pending = readCodexDelegations({ dir: f.dir });
  assert.equal(new Set(pending.map((r) => r.offerId)).size, 1);
  assert.equal(bindCodexSubagent({ session_id: 'parent-session', agent_id: 'child-session', model: 'child-model', turn_id: 't1' },
    { dir: f.dir, now }), null);
  const t1 = pending.find((r) => r.tier === 'T1');
  const rows = records({ id: 'child-session', model: 'child-model', root: f.base, parentThreadId: 'parent-session',
    text: `Find the parser files\n<!-- sprag:codex:route id=${t1.id} -->` });
  writeFileSync(join(f.home, 'sessions', 'rollout.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const events = (await refreshCodexLedger({ dir: f.dir, home: f.home, now, prices: null })).events;
  assert.deepEqual(Object.keys(events), [t1.id]);
  assert.equal(events[t1.id].tier, 'T1');
});

test('a closed route counts only a child that started before the close, marker or not', async (t) => {
  const f = fixture(t);
  const now = Date.now();
  const id = 'cccccccccccccccc';
  recordCodexDelegation({ id, at: now - 60000, via: 'prompt', turnId: 't1', parentSessionId: 'parent-session',
    source: 'rule', category: 'explore', from: 'parent-model', to: 'child-model', provider: 'current-gateway' }, { dir: f.dir });
  const child = () => {
    const rows = records({ id: 'child-session', model: 'child-model', root: f.base, parentThreadId: 'parent-session',
      text: `Find the parser files\n<!-- sprag:codex:route id=${id} -->` });
    writeFileSync(join(f.home, 'sessions', 'rollout.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };
  // The child starts about 10s before now; a close 30s ago predates it.
  assert.equal(closeStaleCodexRoutes({ session_id: 'parent-session', turn_id: 't2' }, { dir: f.dir, now: now - 30000 }), 1);
  child();
  assert.deepEqual((await refreshCodexLedger({ dir: f.dir, home: f.home, now, prices: null })).events, {});

  const g = fixture(t);
  f.dir = g.dir; f.home = g.home;
  recordCodexDelegation({ id, at: now - 60000, via: 'prompt', turnId: 't1', parentSessionId: 'parent-session',
    source: 'rule', category: 'explore', from: 'parent-model', to: 'child-model', provider: 'current-gateway' }, { dir: f.dir });
  assert.equal(closeStaleCodexRoutes({ session_id: 'parent-session', turn_id: 't2' }, { dir: f.dir, now: now - 1000 }), 1);
  child();
  assert.deepEqual(Object.keys((await refreshCodexLedger({ dir: f.dir, home: f.home, now, prices: null })).events), [id]);
});
