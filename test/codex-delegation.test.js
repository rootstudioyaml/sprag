import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';
import { addCodexModelRule, loadCodexModelRules, matchCodexModelRule, removeCodexModelRule, codexDelegationTool, codexRouteHint } from '../src/codex-delegation.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-route-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const home = join(dir, 'codex'), root = join(dir, 'project');
  mkdirSync(home); mkdirSync(root); mkdirSync(join(root, '.git'));
  const env = childEnv({ HOME: dir, CODEX_HOME: home, XDG_CONFIG_HOME: join(dir, 'state'), CTS_NO_DOC2MD: '1', CTS_NO_KOREAN: '1' });
  const run = (args, input) => spawnSync(process.execPath, [CLI, ...args, '--agent', 'codex'], { cwd: root, env, input: input && JSON.stringify(input), encoding: 'utf8', timeout: 10000 });
  return { dir, home, root, run };
}
const cfg = { codex: { delegate: true, delegateTarget: { model: 'gpt-6-luna', effort: 'high' } } };
const payload = (root, input = {}) => ({ cwd: root, model: 'gpt-6-astra', tool_name: 'spawn_agent',
  tool_input: { message: 'Find the parser files', agent_type: 'explorer', ...input } });

test('Codex-only rules use the shared classifier and retain their project precedence', (t) => {
  const f = fixture(t);
  const add = (scope, model) => addCodexModelRule({ category: 'explore', from: 'gpt-6-astra', model, scope, root: f.root }, f);
  add('global', 'gpt-6-luna');
  add('project', 'gpt-6-sol');
  const rules = loadCodexModelRules(f);
  assert.equal(matchCodexModelRule('Find parser files', { model: 'gpt-6-astra', root: f.root, rules }).model, 'gpt-6-sol');
  assert.equal(matchCodexModelRule('Find parser files', { model: 'gpt-6-astra', root: f.dir, rules }).model, 'gpt-6-luna');
  for (const prompt of ['Find and fix parser files', 'Find and deploy the package', 'Find files and compare architectures']) {
    assert.equal(matchCodexModelRule(prompt, { model: 'gpt-6-astra', root: f.root, rules }), null);
  }
  assert.equal(matchCodexModelRule('Find parser files', { model: 'other', root: f.root, rules }), null);
  assert.match(codexRouteHint({ prompt: 'Find parser files', model: 'gpt-6-astra', cwd: f.root },
    { rules, contextTokens: 60000, record: () => {} }), /gpt-6-sol/);
  removeCodexModelRule(1, f);
  assert.equal(loadCodexModelRules(f).length, 1);
});

test('spawn rewrite uses native arguments, preserves explicit targets and other fields, and is idempotent', (t) => {
  const f = fixture(t), p = payload(f.root, { fork_context: false });
  const opts = { ...f, cfg, rules: [] };
  const out = codexDelegationTool(p, opts).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'allow');
  assert.equal(out.updatedInput.model, 'gpt-6-luna');
  assert.equal(out.updatedInput.reasoning_effort, 'high');
  assert.equal(out.updatedInput.fork_context, false);
  assert.match(out.updatedInput.message, /actual command results/);
  assert.equal(codexDelegationTool({ ...p, tool_input: out.updatedInput }, opts), null);
  const explicit = codexDelegationTool(payload(f.root, { model: 'gpt-6-sol', reasoning_effort: 'low' }), opts).hookSpecificOutput.updatedInput;
  assert.equal(explicit.model, 'gpt-6-sol'); assert.equal(explicit.reasoning_effort, 'low');
  assert.equal(codexDelegationTool(p, { ...opts, cfg: {} }), null);
  assert.equal(codexDelegationTool({ ...p, tool_name: 'Task' }, opts), null);
  assert.equal(codexDelegationTool(payload(f.root, { agent_type: 'my-reviewer' }), opts), null);
});

test('custom built-in overrides in ancestor agent files or legacy config are preserved', (t) => {
  const f = fixture(t), opts = { ...f, cfg, rules: [] };
  mkdirSync(join(f.root, '.codex', 'agents'), { recursive: true });
  writeFileSync(join(f.root, '.codex', 'agents', 'custom.toml'), 'name="explorer"\nmodel="custom-model"\n');
  const subdir = join(f.root, 'nested'); mkdirSync(subdir);
  assert.equal(codexDelegationTool(payload(subdir), opts), null);
  writeFileSync(join(f.home, 'config.toml'), '[agents.worker]\nconfig_file="worker.toml"\n');
  assert.equal(codexDelegationTool(payload(f.root, { agent_type: 'worker' }), opts), null);
});

test('CLI validates before writes, registers routing hooks, and keeps Claude settings untouched', (t) => {
  const f = fixture(t);
  const config = join(f.dir, 'state', 'claude-token-saver', 'config.json');
  for (const args of [['delegate', 'on', '--model'], ['delegate', 'on', '--model', 'gpt-6-luna', '--effort'],
    ['delegate', 'model', 'bad model'], ['delegate', 'rules', 'add', 'read', '--from', 'gpt-6-astra', '--model', 'gpt-6-luna']]) {
    assert.notEqual(f.run(args).status, 0, args.join(' '));
    assert.equal(existsSync(config), false);
    assert.equal(existsSync(join(f.home, 'hooks.json')), false);
  }
  const enabled = f.run(['delegate', 'on', '--model', 'gpt-6-luna', '--effort', 'high']);
  assert.equal(enabled.status, 0, enabled.stderr);
  assert.match(readFileSync(join(f.home, 'hooks.json'), 'utf8'), /PreToolUse/);
  const hook = f.run(['codex-hook', '--event', 'pre-tool'], payload(f.root));
  assert.equal(JSON.parse(hook.stdout).hookSpecificOutput.updatedInput.model, 'gpt-6-luna');
  assert.equal(existsSync(join(f.dir, '.claude')), false);
  assert.equal(f.run(['delegate', 'off']).status, 0);
  assert.equal(f.run(['codex-hook', '--event', 'pre-tool'], payload(f.root)).stdout, '');
  const rulesFile = join(f.dir, 'state', 'claude-token-saver', 'codex-model-rules.json');
  writeFileSync(rulesFile, '{broken');
  // A damaged rule file blocks only the rules subcommand; on/off/status still work and leave it untouched.
  const reenabled = f.run(['delegate', 'on']);
  assert.equal(reenabled.status, 0, reenabled.stderr);
  assert.match(reenabled.stdout, /Codex rules: unreadable/);
  assert.notEqual(f.run(['delegate', 'rules']).status, 0);
  assert.equal(readFileSync(rulesFile, 'utf8'), '{broken');
});
