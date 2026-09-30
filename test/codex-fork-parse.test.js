import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCodexTurns, parseCodexSessionFile, readCodexSnapshot } from '../src/codex-parser.js';
import { codexRatchetCandidates } from '../src/codex-harness.js';

// Shape of a child spawned with fork_turns "all" (Codex 0.159.2): its own
// session_meta, then the parent's session_meta and history copied in one
// batch, then the child's own thread_settings_applied and turns.
const CHILD = 'child-0000', PARENT = 'parent-0000';
const COPY = '2026-09-30T14:40:29.368Z';
const usage = (input, cached, output) => ({ type: 'event_msg', payload: { type: 'token_count',
  info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output },
    last_token_usage: { input_tokens: input } } } });

function forkedChild() {
  const at = (timestamp, e) => ({ timestamp, ...e });
  return [
    at('2026-09-30T14:40:29.342Z', { type: 'session_meta', payload: { id: CHILD, forked_from_id: PARENT, cwd: '/child',
      model_provider: 'openai', source: { subagent: { thread_spawn: { parent_thread_id: PARENT, depth: 1 } } } } }),
    at(COPY, { type: 'session_meta', payload: { id: PARENT, cwd: '/parent', source: 'exec', model_provider: 'openai' } }),
    at(COPY, { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-parent' } }),
    at(COPY, { type: 'turn_context', payload: { turn_id: 'turn-parent', model: 'gpt-6-luna', cwd: '/parent' } }),
    at(COPY, { type: 'event_msg', payload: { type: 'user_message', turn_id: 'turn-parent', message: 'parent request' } }),
    at(COPY, { type: 'event_msg', payload: { type: 'exec_command_end', turn_id: 'turn-parent', call_id: 'c-parent',
      command: ['npm', 'test'], exit_code: 1, aggregated_output: 'parent failure' } }),
    at('2026-09-30T14:40:29.378Z', { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_id: CHILD } }),
    at('2026-09-30T14:40:29.383Z', { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-child' } }),
    at('2026-09-30T14:40:30.763Z', { type: 'turn_context', payload: { turn_id: 'turn-child', model: 'gpt-5.6-luna', cwd: '/child' } }),
    at('2026-09-30T14:40:31.000Z', usage(24100, 1792, 131)),
    at('2026-09-30T14:40:32.000Z', { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-child' } }),
  ];
}

function write(records) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-codex-fork-'));
  const file = join(dir, 'rollout.jsonl');
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { dir, file };
}

test('forked child keeps its own identity and drops the copied parent history', async (t) => {
  const f = write(forkedChild());
  t.after(() => rmSync(f.dir, { recursive: true, force: true }));

  const turns = await parseCodexTurns(f.file);
  assert.equal(turns.sessionId, CHILD);
  assert.equal(turns.isSubagent, true);
  assert.equal(turns.parentThreadId, PARENT);
  assert.equal(turns.forkedFrom, PARENT);
  assert.equal(turns.projectDir, '/child');
  assert.deepEqual(turns.turns.map((x) => [x.turnId, x.model]), [['turn-child', 'gpt-5.6-luna']]);

  const session = await parseCodexSessionFile(f.file);
  assert.equal(session.sessionId, CHILD);
  assert.equal(session.isSubagent, true);
  assert.equal(session.model, 'gpt-5.6-luna');

  const snapshot = readCodexSnapshot(f.file);
  assert.equal(snapshot.sessionId, CHILD);
  assert.equal(snapshot.isSubagent, true);

  // The parent's failed command belongs to the parent's rollout only.
  assert.deepEqual(codexRatchetCandidates(f.file, { now: Date.parse('2026-09-30T14:41:00Z') }), []);
});

test('copy ends at the first later line even without thread_settings_applied', async (t) => {
  const records = forkedChild().filter((r) => r.payload.type !== 'thread_settings_applied');
  const f = write(records);
  t.after(() => rmSync(f.dir, { recursive: true, force: true }));
  const turns = await parseCodexTurns(f.file);
  assert.deepEqual(turns.turns.map((x) => x.turnId), ['turn-child']);
});

test('a repeated own session_meta does not hide the lines after it', async (t) => {
  const f = write([
    { timestamp: '2026-09-30T10:00:00.000Z', type: 'session_meta', payload: { id: 'solo', cwd: '/solo', source: 'cli' } },
    { timestamp: '2026-09-30T10:00:01.000Z', type: 'session_meta', payload: { id: 'solo', cwd: '/solo', source: 'cli' } },
    { timestamp: '2026-09-30T10:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-solo' } },
    { timestamp: '2026-09-30T10:00:01.000Z', type: 'turn_context', payload: { turn_id: 'turn-solo', model: 'gpt-5.5' } },
  ]);
  t.after(() => rmSync(f.dir, { recursive: true, force: true }));
  const turns = await parseCodexTurns(f.file);
  assert.equal(turns.sessionId, 'solo');
  assert.equal(turns.isSubagent, false);
  assert.deepEqual(turns.turns.map((x) => [x.turnId, x.model]), [['turn-solo', 'gpt-5.5']]);
});

test('a failure repeated across separate exec rollouts is a candidate', (t) => {
  const run = (id, at) => write([
    { timestamp: at, type: 'session_meta', payload: { id, cwd: '/p', source: 'exec', originator: 'codex_exec' } },
    { timestamp: at, type: 'event_msg', payload: { type: 'task_started', turn_id: `${id}-turn` } },
    { timestamp: at, type: 'event_msg', payload: { type: 'exec_command_end', turn_id: `${id}-turn`, call_id: `${id}-call`,
      command: ['npm', 'test'], exit_code: 2, aggregated_output: 'Error: missing fixture' } },
  ]);
  const a = run('run-a', '2026-10-01T00:00:00.000Z'), b = run('run-b', '2026-10-01T00:05:00.000Z');
  t.after(() => { rmSync(a.dir, { recursive: true, force: true }); rmSync(b.dir, { recursive: true, force: true }); });
  const now = Date.parse('2026-10-01T00:06:00Z');
  assert.deepEqual(codexRatchetCandidates(b.file, { now }), []);
  const across = codexRatchetCandidates(b.file, { now, siblings: [a.file] });
  assert.equal(across.length, 1);
  assert.equal(across[0].count, 2);
});
