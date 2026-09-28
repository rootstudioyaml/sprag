import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseCodexTurns } from '../src/codex-parser.js';
import { runCodexRouteScan } from '../src/codex-route-scan.js';
import { codexRatchetCandidates } from '../src/codex-harness.js';
import { recordCodexDelegation, refreshCodexLedger } from '../src/codex-ledger.js';
import { childEnv } from './helpers/child-env.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const prices = {
  checkedAt: Date.now(),
  provider: 'current-gateway',
  prices: {
    'parent-model': { input: 0.00001, output: 0.00003, cacheRead: 0.000001, cacheWrite: null },
    'child-model': { input: 0.000001, output: 0.000003, cacheRead: 0.0000001, cacheWrite: null },
  },
};

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'sprag-discovery-'));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const home = join(base, 'codex');
  const dir = join(base, 'state', 'claude-token-saver');
  const root = join(base, 'project');
  for (const path of [join(home, 'sessions'), join(home, 'archived_sessions'), dir, join(root, '.git')]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(join(home, 'config.toml'), 'model_provider="current-gateway"\n');
  const now = Date.now();
  const cfg = { codex: { delegateTarget: { model: 'child-model' } } };
  return { base, home, dir, root, now, cfg, prices, refreshLedger: false };
}

function records(f, { id = 'parent-session', model = 'parent-model', provider = 'current-gateway',
  turns = 3, modern = true, message = 'Find the parser files', child = false } = {}) {
  const rows = [{ timestamp: new Date(f.now - 20000).toISOString(), type: 'session_meta', payload: {
    id, cwd: f.root, model_provider: provider,
    source: child ? { subagent: { thread_spawn: { parent_thread_id: 'parent-session' } } } : 'cli',
  } }];
  for (let i = 0; i < turns; i++) {
    const turn_id = `${id}-turn-${i}`;
    const at = f.now - 10000 + i * 1000;
    const push = (type, payload, delta = 0) => rows.push({ timestamp: new Date(at + delta).toISOString(), type, payload });
    push('event_msg', { type: 'task_started', turn_id });
    push('turn_context', { turn_id, model, cwd: f.root });
    if (modern) push('event_msg', { type: 'item_completed', turn_id, item: {
      type: 'UserMessage', id: `message-${i}`, content: [{ type: 'text', text: message }],
    } });
    else push('event_msg', { type: 'user_message', message });
    const usage = { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 500 };
    if (modern) push('token_usage_record', { turn_id, usage, turn_token_usage: usage }, 100);
    push('event_msg', { type: 'token_count', info: { last_token_usage: usage, total_token_usage: {
      input_tokens: 1000 * (i + 1), cached_input_tokens: 200 * (i + 1), output_tokens: 500 * (i + 1),
    } } }, 100);
    push('event_msg', { type: 'task_complete', turn_id }, 200);
  }
  return rows;
}

function save(f, rows, name = 'rollout.jsonl', folder = 'sessions') {
  const file = join(f.home, folder, name);
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return file;
}

test('modern rollout usage yields one correctly priced recurring route candidate', async (t) => {
  const f = fixture(t);
  const file = save(f, records(f));
  const parsed = await parseCodexTurns(file);
  assert.deepEqual(parsed.turns.map((turn) => turn.out), [500, 500, 500]);
  const scan = await runCodexRouteScan(f);
  assert.equal(scan.candidates.length, 1);
  assert.equal(scan.candidates[0].count, 3);
  assert.equal(scan.candidates[0].suggestedModel, 'child-model');
  assert.ok(scan.candidates[0].estSavedUsd > 0);
});

test('legacy token_count usage is not silently replaced by zero', async (t) => {
  const f = fixture(t);
  const file = save(f, records(f, { modern: false }));
  const parsed = await parseCodexTurns(file);
  assert.deepEqual(parsed.turns.map((turn) => turn.out), [500, 500, 500]);
  assert.equal((await runCodexRouteScan(f)).candidates.length, 1);
});

test('archived duplicate sessions do not manufacture recurrence', async (t) => {
  const f = fixture(t);
  const rows = records(f, { turns: 2 });
  save(f, rows);
  save(f, rows, 'rollout.jsonl', 'archived_sessions');
  const scan = await runCodexRouteScan(f);
  assert.equal(scan.candidates.length, 0, JSON.stringify(scan.candidates));
});

test('identical model aliases from different providers are not one priced route group', async (t) => {
  const f = fixture(t);
  save(f, records(f), 'current.jsonl');
  save(f, records(f, { id: 'other-session', provider: 'unrelated-gateway' }), 'other.jsonl');
  const scan = await runCodexRouteScan(f);
  assert.ok(scan.candidates.every((candidate) => candidate.count <= 3), JSON.stringify(scan.candidates));
});

function routeFixture(f, modern = true) {
  const id = '0123456789abcdef';
  recordCodexDelegation({ id, at: f.now - 15000, parentSessionId: 'parent-session',
    source: 'rule', category: 'explore', scope: 'project', from: 'parent-model', to: 'child-model' }, f);
  save(f, records(f, { id: 'child-session', model: 'child-model', child: true, turns: 1, modern,
    message: `Find parser files\n<!-- sprag:codex:route id=${id} -->` }));
  return id;
}

test('a recorded route joins a modern child and yields signed savings', async (t) => {
  const f = fixture(t);
  const id = routeFixture(f);
  const ledger = await refreshCodexLedger(f);
  assert.equal(ledger.events[id].childSessionId, 'child-session');
  assert.equal(ledger.events[id].tokens.output, 500);
  assert.ok(ledger.events[id].usd > 0);
  assert.equal(ledger.events[id].complete, true);
});

test('refresh with unavailable prices preserves a completed priced ledger event', async (t) => {
  const f = fixture(t);
  const id = routeFixture(f);
  const before = (await refreshCodexLedger(f)).events[id];
  const after = (await refreshCodexLedger({ ...f, prices: null })).events[id];
  assert.equal(after.usd, before.usd);
});

test('a legacy child with measured usage must not become a priced zero-token run', async (t) => {
  const f = fixture(t);
  const id = routeFixture(f, false);
  const event = (await refreshCodexLedger(f)).events[id];
  assert.equal(event.tokens.output, 500);
  assert.ok(event.usd > 0);
});

test('structured repeated failures are detected and age out', (t) => {
  const f = fixture(t);
  const rows = records(f, { turns: 1 });
  for (let i = 0; i < 2; i++) rows.push({ timestamp: new Date(f.now - 1000 + i).toISOString(),
    type: 'event_msg', payload: { type: 'item_completed', turn_id: 'parent-session-turn-0', item: {
      type: 'CommandExecution', id: `failed-${i}`, command: ['npm', 'test'], exit_code: 1,
      status: 'failed', aggregated_output: 'Error: module not found', parsed_cmd: [{ type: 'unknown' }],
    } } });
  const file = save(f, rows);
  assert.equal(codexRatchetCandidates(file, { now: f.now }).length, 1);
  assert.equal(codexRatchetCandidates(file, { now: f.now + 31 * 60000 }).length, 0);
});

test('legacy function-call failures remain visible to ratchet detection', (t) => {
  const f = fixture(t);
  const rows = records(f, { turns: 1, modern: false });
  for (let i = 0; i < 2; i++) {
    const timestamp = new Date(f.now - 1000 + i).toISOString();
    rows.push({ timestamp, type: 'response_item', payload: { type: 'function_call',
      name: 'exec_command', call_id: `failed-${i}`, arguments: JSON.stringify({ cmd: 'npm test' }) } });
    rows.push({ timestamp, type: 'response_item', payload: { type: 'function_call_output',
      call_id: `failed-${i}`, output: 'Process exited with code 1\nError: module not found' } });
  }
  assert.equal(codexRatchetCandidates(save(f, rows), { now: f.now }).length, 1);
});

test('Codex seed accepts and skips independently of Claude with the chosen scopes', (t) => {
  const f = fixture(t);
  const env = childEnv({ HOME: f.base, CODEX_HOME: f.home, XDG_CONFIG_HOME: join(f.base, 'state'),
    CTS_NO_KOREAN: '1', CTS_LANG: 'en' });
  const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
    cwd: f.root, env, encoding: 'utf8', timeout: 10000,
  });
  const listing = run(['seed', '--agent', 'codex']);
  assert.equal(listing.status, 0, listing.stderr);
  assert.doesNotMatch(listing.stdout, /model: haiku|\[run-t2\]/);
  const ids = [...listing.stdout.matchAll(/\[(fix-[0-9a-f]{6})\]/g)].map((m) => m[1]);
  assert.ok(ids.length >= 3);
  assert.notEqual(run(['seed', 'accept', ids[0], '--agent', 'codex']).status, 0);
  assert.equal(run(['seed', 'accept', ids[0], '--project', '--agent', 'codex']).status, 0);
  assert.ok(existsSync(join(f.root, '.codex', 'ratchet.md')));
  assert.equal(run(['seed', 'accept', ids[1], '--global', '--agent', 'codex']).status, 0);
  assert.ok(existsSync(join(f.home, 'ratchet.md')));
  assert.equal(run(['seed', 'skip', ids[2], '--agent', 'codex']).status, 0);
  assert.doesNotMatch(run(['seed', '--agent', 'codex']).stdout, new RegExp(`\\[${ids[2]}\\]`));
  assert.match(run(['seed']).stdout, new RegExp(`\\[${ids[2]}\\]`));
  assert.equal(existsSync(join(f.base, '.claude', 'ratchet.md')), false);
  assert.match(readFileSync(join(f.dir, 'codex-seed-state.json'), 'utf8'), /accepted|skipped/);
});
