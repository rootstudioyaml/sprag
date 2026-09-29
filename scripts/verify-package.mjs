#!/usr/bin/env node
// Exercise the shipped package without reading or changing the user's setup.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from '../test/helpers/child-env.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const offline = args.includes('--offline') ? ['--offline'] : [];
const cacheIndex = args.indexOf('--cache');
const cache = cacheIndex < 0 ? undefined : args[cacheIndex + 1];
if (cacheIndex >= 0 && (!cache || cache.startsWith('--'))) throw new Error('--cache requires a path');
const work = mkdtempSync(join(tmpdir(), 'sprag-package-check-'));
const home = join(work, 'home');
const codex = join(home, '.codex');
const project = join(work, 'project');
const prefix = join(work, 'prefix');
const userNpmConfig = join(work, 'npmrc');
const globalNpmConfig = join(work, 'global-npmrc');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = childEnv({
  HOME: home, CODEX_HOME: codex, XDG_CONFIG_HOME: join(work, 'state'),
  APPDATA: join(work, 'state'), ZDOTDIR: home, CTS_LANG: 'en',
  CTS_NO_KOREAN: '1', CTS_NO_INPUT: '1', CTS_DOC2MD_NO_AUTOINSTALL: '1',
  CTS_NO_UPDATE_CHECK: '1', CTS_NO_TMUX: '1', NO_COLOR: '1',
  NPM_CONFIG_USERCONFIG: userNpmConfig,
  NPM_CONFIG_GLOBALCONFIG: globalNpmConfig,
  NPM_CONFIG_CACHE: cache || join(work, 'npm-cache'),
  NPM_CONFIG_PREFIX: prefix,
});
let checks = 0;
function check(name, verify) {
  verify();
  checks += 1;
  console.log(`PASS  ${name}`);
}
function run(file, commandArgs, cwd = project, input) {
  return execFileSync(file, commandArgs, {
    cwd, env, input, encoding: 'utf8', timeout: 120_000,
    shell: process.platform === 'win32' && file === npm,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

try {
  mkdirSync(codex, { recursive: true });
  mkdirSync(join(project, '.git'), { recursive: true });
  writeFileSync(userNpmConfig, '');
  writeFileSync(globalNpmConfig, '');
  const [packed] = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', work, ...offline], root));
  const shipped = new Set(packed.files.map((file) => file.path));
  check('tarball includes Codex modules, dependency declaration, and both guides', () => {
    for (const file of readdirSync(join(root, 'src')).filter((name) => name.startsWith('codex-'))) {
      assert.ok(shipped.has(`src/${file}`), file);
    }
    for (const file of ['src/agent.js', 'src/commands/codex.js', 'src/commands/codex-delegate.js',
      'docs/CODEX.md', 'docs/CODEX.ko.md', 'package.json', 'LICENSE', 'NOTICE']) assert.ok(shipped.has(file), file);
    assert.ok(![...shipped].some((file) => /^(?:test\/|site\/|docs\/releases\/|HANDOFF|\.env|\.codex\/|:memory:)/.test(file)));
  });
  run(npm, ['install', '--global', join(work, packed.filename), '--prefix', prefix,
    '--ignore-scripts', '--no-audit', '--no-fund', ...offline]);
  const installed = join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', 'sprag-cli');
  const cli = join(installed, 'bin', 'cli.js');
  const sprag = (...commandArgs) => run(process.execPath, [cli, ...commandArgs]);
  check('installed CLI boots from outside the repository', () => {
    assert.equal(sprag('--version').trim(), packed.version);
    assert.ok(existsSync(join(prefix, process.platform === 'win32' ? 'sprag.cmd' : 'bin/sprag')));
    assert.match(sprag('--help', '--agent', 'codex'), /route-scan/);
    assert.equal(existsSync(join(home, '.claude')), false);
    assert.equal(existsSync(join(codex, 'hooks.json')), false);
  });

  const foreign = { hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'echo foreign-hook' }] }] } };
  const config = 'model = "example-model"\n[tui]\nstatus_line = ["current-dir"]\n';
  const instructions = '# Existing instructions\n';
  writeFileSync(join(codex, 'hooks.json'), JSON.stringify(foreign));
  writeFileSync(join(codex, 'config.toml'), config);
  writeFileSync(join(codex, 'AGENTS.md'), instructions);
  sprag('install', '--no-panel', '--agent', 'codex');
  const hooks = readFileSync(join(codex, 'hooks.json'), 'utf8');
  const agents = readFileSync(join(codex, 'AGENTS.md'), 'utf8');
  check('Codex installation resolves the packaged TOML dependency and registers five hooks', () => {
    const doctor = JSON.parse(sprag('doctor', '--format', 'json', '--agent', 'codex'));
    assert.equal(doctor.config.error, undefined);
    assert.equal(doctor.hooks.events.length, 5);
    assert.ok(doctor.hooks.events.every((event) => event.registered));
    assert.match(doctor.hooks.trust, /unknown/);
    assert.deepEqual(JSON.parse(hooks).hooks.PostToolUse[0], foreign.hooks.PostToolUse[0]);
    assert.ok(agents.startsWith(instructions));
    assert.match(agents, /sprag:codex:harness:begin/);
  });
  sprag('install', '--no-panel', '--agent', 'codex');
  check('reinstallation preserves instructions, hooks, and config', () => {
    assert.equal(readFileSync(join(codex, 'hooks.json'), 'utf8'), hooks);
    assert.equal(readFileSync(join(codex, 'AGENTS.md'), 'utf8'), agents);
    assert.equal(readFileSync(join(codex, 'config.toml'), 'utf8'), config);
  });

  mkdirSync(join(codex, 'sessions'));
  const records = [
    { type: 'session_meta', payload: { id: 'package-example', cwd: project } },
    { type: 'turn_context', payload: { model: 'example-model', effort: 'high' } },
    { type: 'event_msg', payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 20, reasoning_output_tokens: 5 },
      last_token_usage: { input_tokens: 100 }, model_context_window: 200000,
    } } },
  ].map((row) => JSON.stringify({ timestamp: new Date().toISOString(), ...row }));
  writeFileSync(join(codex, 'sessions', 'example.jsonl'), records.join('\n') + '\n');
  check('installed reports and panel read only the isolated example session', () => {
    const report = JSON.parse(sprag('--format', 'json', '--agent', 'codex'));
    assert.equal(report.agent, 'codex');
    assert.equal(report.summary.totalInput, 100);
    assert.equal(report.cost, null);
    assert.equal(report.ttl, null);
    assert.match(sprag('panel', '--once', '--no-color', '--agent', 'codex'), /example-model/);
    assert.match(sprag('--statusline', '--text', '--no-color', '--agent', 'codex'), /example-model/);
  });
  check('packaged hooks and presets execute without repository files', () => {
    const output = run(process.execPath, [cli, 'codex-hook', '--event', 'session-start', '--agent', 'codex'],
      project, JSON.stringify({ cwd: project, source: 'startup', session_id: 'package-example' }));
    assert.equal(JSON.parse(output).hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(sprag('seed', '--agent', 'codex'), /fix-[0-9a-f]{6}/);
    assert.match(sprag('route-scan', 'savings', '--agent', 'codex'), /n\/a/);
    assert.match(sprag('upgrade', '--print', '--agent', 'codex'), /--ignore-scripts/);
  });
  sprag('uninstall', '--agent', 'codex');
  check('uninstall preserves foreign hooks, config, ratchets, and Claude isolation', () => {
    assert.deepEqual(JSON.parse(readFileSync(join(codex, 'hooks.json'), 'utf8')), foreign);
    assert.equal(readFileSync(join(codex, 'AGENTS.md'), 'utf8').trim(), instructions.trim());
    assert.equal(readFileSync(join(codex, 'config.toml'), 'utf8'), config);
    assert.ok(existsSync(join(codex, 'ratchet.md')));
    assert.equal(existsSync(join(home, '.claude')), false);
  });
  console.log(`\n${checks} package checks passed (${packed.name}@${packed.version}, ${packed.entryCount} files).`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
