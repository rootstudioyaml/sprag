import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { childEnv } from './helpers/child-env.js';
import { readCodexSnapshot } from '../src/codex-parser.js';
import { codexIssues, runCodexBrief, readCodexHistory } from '../src/codex-brief.js';
import { createPanelReader, formatCodexPanel, panelCellWidth } from '../src/codex-panel.js';
import { lintCodexTool } from '../src/codex-hooks.js';
import { CODEX_HANDLERS } from '../src/codex-installer.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const now = Date.now();
const jsonl = (records) => records.map(JSON.stringify).join('\n') + '\n';
const meta = (id, root, source = 'cli') => ({ timestamp: new Date(now).toISOString(), type: 'session_meta',
  payload: { id, cwd: root, source, git: { branch: 'work' } } });
const usage = (input, at = now, used = 91, resets = at / 1000 + 600) => ({ timestamp: new Date(at).toISOString(), type: 'event_msg', payload: {
  type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: 50, output_tokens: 100 },
    last_token_usage: { input_tokens: input }, model_context_window: 200000 },
  rate_limits: { primary: { used_percent: used, window_minutes: 300, resets_at: resets } },
} });

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-codex-coverage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  const codex = join(dir, 'codex');
  const root = join(dir, 'project');
  for (const path of [home, join(codex, 'sessions'), join(root, '.git')]) mkdirSync(path, { recursive: true });
  const env = childEnv({ HOME: home, CODEX_HOME: codex, XDG_CONFIG_HOME: join(dir, 'config'), CTS_DOC2MD_NO_AUTOINSTALL: '1', CTS_NO_DOC2MD: '1' });
  const run = (args, input) => spawnSync(process.execPath, [CLI, ...args, '--agent', 'codex'], {
    env, cwd: root, input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', timeout: 10000,
  });
  const ok = (args, input) => {
    const result = run(args, input);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const file = join(codex, 'sessions', 'main.jsonl');
  writeFileSync(file, jsonl([meta('main', root), { type: 'turn_context', payload: { model: 'test-model', effort: 'high' } },
    { type: 'event_msg', payload: { type: 'task_started' } }, usage(170000)]));
  return { dir, home, codex, root, env, file, run, ok };
}

test('Codex statusline supports formats, bounded wrapping, labels, and one-line output', (t) => {
  const f = fixture(t);
  for (const flag of [['--statusline'], ['--format', 'statusline'], ['-f', 'statusline']]) {
    const text = f.ok([...flag, '--text', '--no-color', '--columns', '40']);
    assert.match(text, /test-model/);
    assert.match(text, /85.0%/);
    assert.match(text, /working/);
    assert.match(text, /Hooks 0\/5 registered/);
    assert.match(text, /Brief on/);
    assert.match(text, /Delegate off/);
    assert.ok(text.trimEnd().split('\n').every((line) => panelCellWidth(line) <= 40));
    assert.doesNotMatch(text, /\x1b|Cost|Cache expires|haiku/);
  }
  const single = f.ok(['--statusline', '--single-line', '--text']);
  assert.equal(single.trimEnd().split('\n').length, 1);
  assert.match(single, /Harness/);
  assert.match(single, /SPRAG v/);
  const csv = f.ok(['--format', 'csv']).trim().split('\n')[1].split(',');
  assert.equal(Number(csv[3]), 170000, 'CSV input includes cached input, matching JSON and table');
  assert.equal(Number(csv[4]), 50);
  f.ok(['mode', 'narrow', 'no-color']);
  assert.match(f.ok(['--statusline']), /◈/);
});

test('latest-project panel ignores subagents, but explicit session pin and report include them', async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.codex, 'sessions', 'child.jsonl'), jsonl([
    meta('child', f.root, { subagent: { thread_spawn: { parent_thread_id: 'main' } } }), usage(195000, now + 1000),
  ]));
  const data = await createPanelReader({ root: f.root, home: f.codex })();
  assert.equal(data.session.sessionId, 'main');
  assert.equal(data.session.branch, 'work');
  assert.equal(data.matches, 1);
  assert.equal((await createPanelReader({ root: f.root, home: f.codex, sessionId: 'child' })()).session.sessionId, 'child');
  const report = JSON.parse(f.ok(['--format', 'json', '--session', 'child']));
  assert.equal(report.sessions.length, 1);
  assert.equal(report.sessions[0].sessionId, 'child');
  assert.equal(report.usageUpdates, 1);
});

test('Codex tail snapshot uses recent records and tolerates partial/oversized logs', (t) => {
  const f = fixture(t);
  assert.equal(readCodexSnapshot(f.file).lastContextTokens, 170000);
  appendFileSync(f.file, jsonl([{ payload: { padding: 'x'.repeat(300000) } }, usage(190000)]) + '{partial');
  assert.equal(readCodexSnapshot(f.file).lastContextTokens, 190000);
  assert.equal(readCodexSnapshot(join(f.dir, 'absent')), null);
  assert.equal(readCodexSnapshot(null), null);
});

test('briefing deduplicates per session, re-arms after compaction, and isolates warning history', (t) => {
  const f = fixture(t);
  const opts = { sessionId: 'main', transcriptPath: f.file, cwd: f.root, dir: f.dir, now };
  assert.match(runCodexBrief(opts), /85%[\s\S]*91%/);
  assert.equal(runCodexBrief(opts), null);
  appendFileSync(f.file, jsonl([usage(192000, now + 1000, 91, now / 1000 + 600)]));
  assert.match(runCodexBrief({ ...opts, now: now + 1000 }), /96%/);
  appendFileSync(f.file, jsonl([usage(170000, now + 1500, 91, now / 1000 + 600)]));
  assert.equal(runCodexBrief({ ...opts, now: now + 1500 }), null, 'a downward threshold crossing stays silent');
  appendFileSync(f.file, jsonl([usage(20000, now + 2000, 40)]));
  assert.equal(runCodexBrief({ ...opts, now: now + 2000 }), null);
  appendFileSync(f.file, jsonl([usage(170000, now + 3000, 40)]));
  assert.match(runCodexBrief({ ...opts, now: now + 3000 }), /85%/);
  assert.equal(readCodexHistory({ dir: f.dir, now: now + 3000, sessionId: 'main' }).length, 4);
  assert.equal(readCodexHistory({ dir: f.dir, now: now + 3000, sessionId: 'other' }).length, 0);
  assert.equal(readCodexHistory({ dir: f.dir, now: now + 3000, project: 'absent' }).length, 0);
  assert.equal(existsSync(join(f.dir, 'brief-state.json')), false);
  assert.equal(runCodexBrief({ ...opts, sessionId: 'other' }), null);
});

test('old measurements, malformed values, and expired limits do not invent fresh warnings', (t) => {
  const f = fixture(t);
  const snapshot = readCodexSnapshot(f.file);
  assert.equal(codexIssues(snapshot, { now: now + 600000 }).length, 0);
  snapshot.contextWindow = null;
  snapshot.rateLimits.primary.resets_at = now / 1000 - 1;
  assert.equal(codexIssues(snapshot, { now }).length, 0);
  snapshot.rateLimits.primary.used_percent = '95';
  assert.equal(codexIssues(snapshot, { now }).length, 0);
  assert.deepEqual(codexIssues(null), []);
});

test('prompt hook still briefs with doc2md off; last/history are Codex-only and filterable', (t) => {
  const f = fixture(t);
  const payload = { session_id: 'main', transcript_path: f.file, cwd: f.root, prompt: 'continue' };
  const args = ['codex-hook', '--event', 'prompt'];
  const output = JSON.parse(f.ok(args, payload));
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(output.hookSpecificOutput.additionalContext, /85%/);
  assert.equal(f.ok(args, payload), '');
  assert.match(f.ok(['brief']), /85%/);
  assert.match(f.ok(['last']), /91%/);
  assert.equal(JSON.parse(f.ok(['history', '--format', 'json'])).events.length, 2);
  assert.equal(JSON.parse(f.ok(['history', '--format', 'json', '--session', 'other'])).events.length, 0);
  assert.match(f.ok(['history', '--list']), /\d{4}-\d{2}-\d{2}/);
  f.ok(['brief', 'off']);
  appendFileSync(f.file, jsonl([usage(196000)]));
  assert.equal(f.ok(args, payload), '');
  assert.match(f.ok(['brief', 'status']), /off/);
  assert.equal(existsSync(join(f.home, '.claude')), false);
});

test('SubagentStart is opt-in, delivers Codex ratchets and cohesion, and never changes tool permissions', (t) => {
  const f = fixture(t);
  f.ok(['install', '--no-panel']);
  f.ok(['harness', 'promote', 'Validate changed modules.', '--project']);
  f.ok(['cohesion', 'on']);
  const args = ['codex-hook', '--event', 'subagent-start'];
  const payload = { cwd: f.root, agent_id: 'child', agent_type: 'worker' };
  assert.equal(f.ok(args, payload), '');
  f.ok(['delegate', 'on']);
  const output = JSON.parse(f.ok(args, payload));
  assert.equal(output.hookSpecificOutput.hookEventName, 'SubagentStart');
  assert.match(output.hookSpecificOutput.additionalContext, /Validate changed modules/);
  assert.match(output.hookSpecificOutput.additionalContext, /sprag cohesion/);
  assert.match(output.hookSpecificOutput.additionalContext, /caller-provided budget/);
  assert.doesNotMatch(JSON.stringify(output), /permissionDecision|updatedInput|haiku|sonnet/);
  f.ok(['delegate', 'off']);
  assert.equal(f.ok(args, payload), '');
  assert.equal(existsSync(join(f.home, '.claude')), false);
});

test('write lint handles native, normalized, and namespaced tool inputs and workdirs', (t) => {
  const f = fixture(t);
  const nested = join(f.root, 'nested');
  mkdirSync(nested);
  // Intentional quotation: the lint test must contain a prohibited expression.
  const invalid = '이것은 문제에 다름 아니다.';
  writeFileSync(join(nested, 'one.md'), invalid);
  const patch = '*** Begin Patch\n*** Update File: nested/one.md\n@@\n+x\n*** End Patch';
  for (const tool_input of [{ command: patch }, { content: patch }, { patch }, patch]) {
    assert.match(lintCodexTool({ cwd: f.root, tool_name: 'functions.apply_patch', tool_input }), /one.md/);
  }
  assert.match(lintCodexTool({ cwd: f.root, tool_name: 'exec_command', tool_input: { cmd: 'echo text > one.md', workdir: nested } }), /one.md/);
  assert.equal(lintCodexTool(null), null);
  const matcher = new RegExp(CODEX_HANDLERS.PostToolUse.matcher);
  for (const name of ['Bash', 'apply_patch', 'Edit', 'Write', 'exec_command', 'functions.apply_patch']) assert.ok(matcher.test(name));
  assert.equal(matcher.test('mcp__foreign__apply_patch'), false);
});

test('doctor reports missing/outdated hooks and disabled features without dumping provider secrets', (t) => {
  const f = fixture(t);
  const file = join(f.codex, 'config.toml');
  const config = 'model = "test-model"\nmodel_auto_compact_token_limit = 150000\n[features]\nhooks = false\n[tui]\nstatus_line = ["model-name"]\n[model_providers.private]\nexperimental_bearer_token = "never-print-this"\n';
  writeFileSync(file, config);
  const before = JSON.parse(f.ok(['doctor', '--format', 'json']));
  assert.equal(before.config.hooksDisabled, true);
  assert.equal(before.hooks.events.filter((hook) => hook.registered).length, 0);
  assert.doesNotMatch(JSON.stringify(before), /never-print-this|experimental_bearer_token/);
  f.ok(['install', '--no-panel']);
  const after = JSON.parse(f.ok(['doctor', '--format', 'json']));
  assert.equal(after.hooks.events.filter((hook) => hook.registered).length, 5);
  assert.match(after.hooks.trust, /unknown/);
  assert.equal(after.session.id, 'main');
  assert.equal(readFileSync(file, 'utf8'), config);
  writeFileSync(file, 'invalid toml [');
  assert.match(JSON.parse(f.ok(['doctor', '--format', 'json'])).config.error, /Cannot parse/);
  writeFileSync(join(f.codex, 'hooks.json'), '{broken');
  assert.match(JSON.parse(f.ok(['doctor', '--format', 'json'])).hooks.error, /Cannot parse/);
});

test('Codex handoff uses recorded session metrics, preserves existing files, and names the correct agent', (t) => {
  const f = fixture(t);
  for (let i = 0; i < 2; i++) assert.match(f.ok(['handoff']), /Handoff written/);
  const files = readdirSync(f.root).filter((file) => file.startsWith('HANDOFF-'));
  assert.equal(files.length, 2);
  const text = readFileSync(join(f.root, files[0]), 'utf8');
  assert.match(text, /sprag handoff --agent codex/);
  assert.match(text, /170000 \/ 200000/);
  assert.match(text, /primary: 91%/);
  assert.match(text, /next Codex session/);
  assert.doesNotMatch(text, /Claude|haiku|Sonnet/);
});

test('full and compact panels show documents, preferences, and verified budget without savings estimates', () => {
  const data = { root: '/project', updatedAt: now, documents: { scope: 'codex-total', docs: 5, byExt: [{ ext: 'pdf', docs: 5, usd: 999 }] },
    budget: { spend: 20, maxBudget: 100, checkedAt: now, source: 'user' }, hooks: [{ registered: true }],
    korean: true, lint: 'warn', doc2md: true, cohesion: true, brief: true, delegate: true };
  for (const compact of [true, false]) {
    const text = formatCodexPanel(data, { compact, columns: 100, rows: 100, now, color: false });
    assert.match(text, /5 docs \(Codex total\)/);
    assert.match(text, /\$20.*\/\$100/);
    assert.match(text, /Hooks 1\/1 registered/);
    assert.match(text, /Cohesion via Korean/);
    assert.match(text, /Brief on/);
    assert.match(text, /Delegate on/);
    assert.doesNotMatch(text, /999|\x1b/);
  }
});

test('Codex-specific help/capabilities do not scan logs; malformed arguments fail without writes', (t) => {
  const f = fixture(t);
  assert.match(f.ok(['--help']), /SubagentStart/);
  const matrix = JSON.parse(f.ok(['capabilities', '--format', 'json']));
  assert.ok(matrix.capabilities.some((row) => row.feature === 'statusline' && row.support === 'supported'));
  for (const args of [['--days', '1junk'], ['--days'], ['--statusline', '--columns', '0'],
    ['--statusline', '--session='], ['doctor', '--project'], ['doctor', '--format', 'csv']]) {
    assert.notEqual(f.run(args).status, 0, args.join(' '));
  }
  assert.equal(existsSync(join(f.home, '.claude')), false);
});
