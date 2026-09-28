import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { childEnv } from './helpers/child-env.js';
import { selectAgent } from '../src/agent.js';
import { parseCodexSessionFile, parseAllCodexSessions } from '../src/codex-parser.js';
import { lintCodexTool, codexHookOutput } from '../src/codex-hooks.js';
import { CODEX_BEGIN, codexHarnessPaths, initCodexHarness } from '../src/codex-harness.js';
import { findProjectRoot } from '../src/harness.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-codex-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const home = join(dir, 'home');
  const codex = join(dir, 'custom-codex');
  const root = join(dir, 'project');
  mkdirSync(home); mkdirSync(codex); mkdirSync(root);
  mkdirSync(join(root, '.git'));
  const env = childEnv({ HOME: home, CODEX_HOME: codex, XDG_CONFIG_HOME: join(dir, 'state'), CTS_LANG: 'en', CTS_DOC2MD_NO_AUTOINSTALL: '1' });
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, cwd: root, encoding: 'utf8', timeout: 20000 });
  const fail = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, cwd: root, encoding: 'utf8', timeout: 20000 });
  return { dir, home, codex, root, env, run, fail };
}
const meta = (id, cwd) => ({ type: 'session_meta', payload: { id, cwd } });
const usage = (timestamp, input, cached, output, reasoning = 0) => ({
  timestamp, type: 'event_msg', payload: { type: 'token_count', info: {
    total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning },
    last_token_usage: { input_tokens: 80 }, model_context_window: 258400,
  } },
});
function rollout(file, records) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, records.map((r) => typeof r === 'string' ? r : JSON.stringify(r)).join('\n') + '\n');
}

test('agent selection preserves positional arguments and validates values', () => {
  assert.deepEqual(selectAgent(['harness', 'promote', 'rule', '--agent', 'codex', '--global']), {
    agent: 'codex', args: ['harness', 'promote', 'rule', '--global'],
  });
  assert.equal(selectAgent([]).agent, 'claude');
  assert.equal(selectAgent(['--agent=codex']).agent, 'codex');
  for (const args of [['--agent'], ['--agent', '--yes'], ['--agent=other']]) assert.throws(() => selectAgent(args), /expects/);
});

test('Codex install is idempotent, preserves foreign hooks and config, and respects CODEX_HOME', (t) => {
  const f = fixture(t);
  const foreign = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node sprag-probe.js' }] };
  const hooks = join(f.codex, 'hooks.json');
  writeFileSync(hooks, JSON.stringify({ description: 'Mine', hooks: { PostToolUse: [foreign] } }));
  writeFileSync(join(f.codex, 'config.toml'), 'model = "my-model"\n');
  writeFileSync(join(f.codex, 'AGENTS.md'), '# Existing instructions\n');
  const first = f.run('install', '--agent', 'codex');
  assert.match(first, /review\/trust/);
  const once = readFileSync(hooks, 'utf8');
  const agents = readFileSync(join(f.codex, 'AGENTS.md'), 'utf8');
  f.run('--agent=codex', 'install', '--force');
  assert.equal(readFileSync(hooks, 'utf8'), once);
  assert.equal(readFileSync(join(f.codex, 'AGENTS.md'), 'utf8'), agents);
  assert.equal(agents.split(CODEX_BEGIN).length, 2);
  assert.ok(agents.startsWith('# Existing instructions'));
  assert.equal(JSON.parse(once).description, 'Mine');
  assert.deepEqual(JSON.parse(once).hooks.PostToolUse[0], foreign);
  assert.equal(readFileSync(join(f.codex, 'config.toml'), 'utf8'), 'model = "my-model"\n');
  assert.equal(existsSync(join(f.home, '.claude')), false);
  assert.equal(existsSync(join(f.home, '.codex')), false);
  f.run('uninstall', '--agent', 'codex');
  assert.deepEqual(JSON.parse(readFileSync(hooks)), { description: 'Mine', hooks: { PostToolUse: [foreign] } });
  assert.doesNotMatch(readFileSync(join(f.codex, 'AGENTS.md'), 'utf8'), /sprag:codex/);
  assert.ok(existsSync(join(f.codex, 'ratchet.md')));
});

test('invalid hook config is not overwritten even by force', (t) => {
  const f = fixture(t);
  const file = join(f.codex, 'hooks.json');
  for (const text of ['{broken', 'null', '{"hooks":{"SessionStart":{}}}']) {
    writeFileSync(file, text);
    assert.notEqual(f.fail('install', '--agent', 'codex', '--force').status, 0);
    assert.equal(readFileSync(file, 'utf8'), text);
    assert.equal(existsSync(join(f.codex, 'AGENTS.md')), false);
  }
});

for (const feature of ['korean', 'cohesion', 'brief', 'doc2md', 'delegate']) {
  test(`Codex ${feature} on registers hooks before enabling the preference`, (t) => {
    const f = fixture(t);
    const config = join(f.codex, 'config.toml');
    writeFileSync(config, 'model = "my-model"\n');
    const enabled = f.run(feature, 'on', '--agent', 'codex');
    assert.match(enabled, /trust|trusted/);
    const hooksFile = join(f.codex, 'hooks.json');
    assert.ok(existsSync(hooksFile), 'an enabled feature needs registered hooks');
    const hooks = readFileSync(hooksFile, 'utf8');
    const report = JSON.parse(f.run('doctor', '--format', 'json', '--agent', 'codex'));
    assert.ok(report.hooks.events.every((event) => event.registered));
    f.run(feature, 'on', '--agent', 'codex');
    assert.equal(readFileSync(hooksFile, 'utf8'), hooks);
    f.run(feature, 'off', '--agent', 'codex');
    assert.equal(readFileSync(hooksFile, 'utf8'), hooks, 'off must preserve shared hooks');
    assert.equal(readFileSync(config, 'utf8'), 'model = "my-model"\n');
    assert.equal(existsSync(join(f.home, '.claude')), false);
  });

  test(`Codex ${feature} on leaves the preference off when hooks cannot be registered`, (t) => {
    const f = fixture(t);
    f.run(feature, 'off', '--agent', 'codex');
    const hooks = join(f.codex, 'hooks.json');
    writeFileSync(hooks, '{broken');
    const preferenceFile = join(f.dir, 'state', 'claude-token-saver', 'config.json');
    const previous = readFileSync(preferenceFile, 'utf8');
    assert.notEqual(f.fail(feature, 'on', '--agent', 'codex').status, 0);
    assert.equal(readFileSync(preferenceFile, 'utf8'), previous);
    const status = f.run(feature, 'status', '--agent', 'codex');
    assert.match(status, /off/);
    if (feature === 'doc2md') assert.match(status, /cannot read Codex hooks.json/);
    assert.equal(readFileSync(hooks, 'utf8'), '{broken');
    assert.equal(existsSync(join(f.home, '.claude')), false);
  });
}

test('Codex conversion hooks allow the full pipeline and diagnose obsolete execution settings', (t) => {
  const f = fixture(t);
  f.run('install', '--no-panel', '--agent', 'codex');
  const file = join(f.codex, 'hooks.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  for (const event of ['UserPromptSubmit', 'PreToolUse']) {
    const handler = data.hooks[event][0].hooks[0];
    assert.ok((handler.timeout ?? 600) >= 600, `${event} must allow multiple bounded conversions`);
    handler.timeout = 120;
  }
  data.hooks.PostToolUse[0].hooks[0].async = true;
  writeFileSync(file, JSON.stringify(data));
  const report = JSON.parse(f.run('doctor', '--format', 'json', '--agent', 'codex'));
  for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse']) {
    assert.equal(report.hooks.events.find((row) => row.event === event).registered, false, event);
  }
  f.run('install', '--no-panel', '--agent', 'codex');
  const repaired = JSON.parse(f.run('doctor', '--format', 'json', '--agent', 'codex'));
  assert.ok(repaired.hooks.events.every((row) => row.registered));
});

test('Codex hook diagnostics accept defaults but reject unsafe execution settings without changing them', (t) => {
  const f = fixture(t);
  f.run('install', '--no-panel', '--agent', 'codex');
  const file = join(f.codex, 'hooks.json');
  const defaults = JSON.parse(readFileSync(file, 'utf8'));
  for (const groups of Object.values(defaults.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) { delete hook.timeout; hook.async = false; }
    }
  }
  const inspect = (data) => {
    const text = JSON.stringify(data);
    writeFileSync(file, text);
    const report = JSON.parse(f.run('doctor', '--format', 'json', '--agent', 'codex'));
    assert.equal(readFileSync(file, 'utf8'), text, 'doctor must remain read-only');
    return report.hooks.events;
  };
  assert.ok(inspect(defaults).every((row) => row.registered), 'Codex defaults to 600 seconds');
  for (const override of [{ timeout: 0 }, { timeout: '600' }, { async: true }, { enabled: false }]) {
    const data = JSON.parse(JSON.stringify(defaults));
    Object.assign(data.hooks.PreToolUse[0].hooks[0], override);
    const events = inspect(data);
    assert.equal(events.find((row) => row.event === 'PreToolUse').registered, false);
    assert.ok(events.filter((row) => row.event !== 'PreToolUse').every((row) => row.registered));
  }
});

test('Codex feature toggles reject Claude hook flags without creating settings', (t) => {
  const f = fixture(t);
  for (const feature of ['korean', 'cohesion', 'brief', 'doc2md', 'delegate']) {
    assert.notEqual(f.fail(feature, 'on', '--hook', '--agent', 'codex').status, 0);
    assert.equal(existsSync(join(f.codex, 'hooks.json')), false);
    assert.equal(existsSync(join(f.dir, 'state', 'claude-token-saver', 'config.json')), false);
    assert.equal(existsSync(join(f.home, '.claude')), false);
  }
});

test('Codex harness document instructions select Codex accounting explicitly', (t) => {
  const f = fixture(t);
  const { file } = initCodexHarness({ root: f.root });
  assert.match(readFileSync(file, 'utf8'), /`sprag doc2md <file> --agent codex`/);
});

test('Codex harness uses active overrides, supports rule CRUD, and leaves Claude rules alone', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'AGENTS.override.md'), '# Override\n');
  writeFileSync(join(f.root, 'AGENTS.md'), '# Base\n');
  f.run('harness', 'init', '--agent', 'codex');
  assert.match(readFileSync(join(f.root, 'AGENTS.override.md'), 'utf8'), /Sprag Harness/);
  assert.equal(readFileSync(join(f.root, 'AGENTS.md'), 'utf8'), '# Base\n');
  assert.match(f.run('harness', 'check', '--agent', 'codex'), /5\/5/);
  f.run('harness', 'promote', 'Test the changed module.', '--project', '--agent', 'codex');
  assert.match(f.run('harness', 'list', '--agent', 'codex'), /#1.*Test the changed module/);
  assert.notEqual(f.fail('harness', 'promote', 'No scope', '--agent', 'codex').status, 0);
  assert.notEqual(f.fail('harness', 'promote', 'R1', '--project', '--agent', 'codex').status, 0);
  f.run('harness', 'rm', '--project', '1', '--agent', 'codex');
  assert.doesNotMatch(f.run('harness', 'list', '--agent', 'codex'), /#1/);
  f.run('harness', 'uninit', '--agent', 'codex');
  assert.doesNotMatch(readFileSync(join(f.root, 'AGENTS.override.md'), 'utf8'), /Sprag Harness/);
  assert.equal(existsSync(join(f.root, '.claude')), false);
});

test('malformed managed AGENTS block fails without modifying content', (t) => {
  const f = fixture(t);
  const { file } = codexHarnessPaths(f.root);
  const broken = '# Mine\n' + CODEX_BEGIN;
  writeFileSync(file, broken);
  assert.throws(() => initCodexHarness({ root: f.root }), /Malformed/);
  assert.equal(readFileSync(file, 'utf8'), broken);
});

test('Codex cumulative usage excludes repeated events and subtracts cached input, not reasoning twice', async (t) => {
  const f = fixture(t);
  const path = join(f.dir, 'rollout.jsonl');
  const ts = new Date().toISOString();
  rollout(path, [meta('session', f.root), { type: 'turn_context', payload: { model: 'test-model' } },
    usage(ts, 100, 60, 30, 10), usage(ts, 100, 60, 30, 10), '{partial',
    { type: 'event_msg', payload: { type: 'token_count', info: null } }, usage(ts, 180, 100, 50, 15)]);
  const s = await parseCodexSessionFile(path);
  assert.equal(s.requestCount, 2);
  assert.equal(s.totals.input, 80);
  assert.equal(s.totals.cacheRead, 100);
  assert.equal(s.totals.output, 50);
  assert.equal(s.reasoningOutputTokens, 15);
  assert.equal(s.model, 'test-model');
  assert.equal(s.maxContextPerRequest, 80);
  assert.equal(s.contextWindow, 258400);
});

test('Codex window filters usage within sessions; resets and malformed records remain finite', async (t) => {
  const f = fixture(t);
  const path = join(f.dir, 'rollout.jsonl');
  const now = Date.now();
  rollout(path, [meta('session', f.root), usage(new Date(now - 86400000 * 40).toISOString(), 100, 60, 30),
    usage(new Date(now).toISOString(), 180, 100, 50), usage(new Date(now).toISOString(), 20, 8, 4),
    usage(new Date(now).toISOString(), 'bad', 8, 4)]);
  const s = await parseCodexSessionFile(path, { cutoffMs: now - 86400000 });
  assert.equal(s.totals.input, 52);
  assert.equal(s.totals.cacheRead, 48);
  assert.equal(s.totals.output, 24);
  assert.equal(s.requestCount, 2);
});

test('Codex discovery handles nested, archived, duplicated, and project-filtered sessions', async (t) => {
  const f = fixture(t);
  const records = [meta('same-id', f.root), usage(new Date().toISOString(), 100, 60, 20)];
  rollout(join(f.codex, 'sessions', '2026', '09', '26', 'rollout-a.jsonl'), records);
  rollout(join(f.codex, 'archived_sessions', 'rollout-a.jsonl'), records);
  rollout(join(f.codex, 'sessions', 'other.jsonl'), [meta('other-id', '/other'), usage(new Date().toISOString(), 20, 0, 5)]);
  assert.equal((await parseAllCodexSessions({ home: f.codex, projectFilter: f.root })).length, 1);
  const data = JSON.parse(f.run('--agent', 'codex', '--format', 'json', '--project', f.root));
  assert.equal(data.agent, 'codex');
  assert.equal(data.summary.totalInput, 100);
  assert.equal(data.cost, null);
  assert.equal(data.ttl, null);
  assert.match(f.run('--agent', 'codex', '--format', 'csv'), /^agent,sessions,usage_updates/);
});

test('Codex hook loads scoped ratchets and emits JSON, with disabled features silent', async (t) => {
  const f = fixture(t);
  f.run('install', '--agent', 'codex');
  f.run('harness', 'promote', 'Global condition.', '--global', '--agent', 'codex');
  f.run('harness', 'promote', 'Project condition.', '--project', '--agent', 'codex');
  const result = execFileSync(process.execPath, [CLI, 'codex-hook', '--agent', 'codex', '--event', 'session-start'], {
    env: f.env, cwd: f.root, encoding: 'utf8', input: JSON.stringify({ cwd: f.root }),
  });
  const out = JSON.parse(result);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /Global condition/);
  assert.match(out.hookSpecificOutput.additionalContext, /Project condition/);
  assert.equal(await codexHookOutput('post-tool', { tool_name: 'apply_patch' }, { cfg: {} }), null);
  assert.equal(await codexHookOutput('prompt', { prompt: 'hello' }, { cfg: { codex: { doc2md: false } } }), null);
});

test('Codex apply_patch lint checks multiple files and honors block, warn, and off', async (t) => {
  const f = fixture(t);
  // Intentional quotations of invalid prose exercise the lint feedback modes.
  writeFileSync(join(f.root, 'one.md'), '이것은 문제에 다름 아니다.\n');
  writeFileSync(join(f.root, 'two.md'), '이것은 문제에 다름 아니다.\n');
  const payload = { cwd: f.root, tool_name: 'apply_patch', tool_input: {
    command: '*** Begin Patch\n*** Update File: one.md\n@@\n+x\n*** Add File: two.md\n+x\n*** End Patch',
  } };
  assert.match(lintCodexTool(payload), /one\.md[\s\S]*two\.md/);
  const cfg = { koreanStyle: { enabled: true } };
  assert.equal((await codexHookOutput('post-tool', payload, { cfg })).decision, 'block');
  cfg.koreanStyle.lint = 'warn';
  assert.equal((await codexHookOutput('post-tool', payload, { cfg })).hookSpecificOutput.hookEventName, 'PostToolUse');
  cfg.koreanStyle.lint = 'off';
  assert.equal(await codexHookOutput('post-tool', payload, { cfg }), null);
});

test('Codex feature switches and unsupported commands never write Claude settings', (t) => {
  const f = fixture(t);
  f.run('korean', 'on', '--agent', 'codex');
  f.run('doc2md', 'on', '--agent', 'codex');
  f.run('korean', 'off', '--agent', 'codex');
  assert.match(f.run('route-scan', '--agent', 'codex'), /Codex route-scan/);
  for (const args of [['--install-hook'], ['harness', 'pull']]) {
    const r = f.fail(...args, '--agent', 'codex');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /not supported|supports|not supported by Codex/);
  }
  assert.equal(existsSync(join(f.home, '.claude')), false);
  assert.notEqual(f.fail('upgrade', '--agent', 'codex').status, 0);
  assert.match(f.run('upgrade', '--print', '--agent', 'codex'), /--ignore-scripts/);
});

test('Codex project markers do not change Claude project root discovery', (t) => {
  const f = fixture(t);
  const nested = join(f.root, 'nested');
  mkdirSync(nested);
  writeFileSync(join(nested, 'AGENTS.md'), '# Nested instructions\n');
  assert.equal(findProjectRoot(nested), f.root);
  assert.equal(findProjectRoot(nested, { agent: 'codex' }), nested);
});
