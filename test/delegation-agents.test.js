/**
 * Delegation-only agents: file contents, ownership rules, phrase wiring, and
 * the real CLI paths (session-start hook, `delegate agents on|off`). Everything
 * runs in a child process with a fake HOME so the user's ~/.claude is untouched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { childEnv } from './helpers/child-env.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.js');
const url = (f) => pathToFileURL(join(ROOT, 'src', f)).href;
const NAMES = ['haiku-explore', 'haiku-runner', 'haiku-translate', 'sonnet-worker', 'opus-worker'];
const TOOLS = {
  'haiku-explore': 'Read, Grep, Glob, Bash',
  'haiku-runner': 'Bash, Read, Grep, Glob',
  'haiku-translate': 'Read, Grep, Glob, Edit, Write',
  'sonnet-worker': 'Read, Grep, Glob, Bash, Edit, Write, NotebookEdit',
  'opus-worker': 'Read, Grep, Glob, Bash, Edit, Write, NotebookEdit',
};
const MODEL = { 'sonnet-worker': 'sonnet', 'opus-worker': 'claude-opus-5-5' };
const EFFORT = { 'sonnet-worker': 'medium', 'opus-worker': 'high' };

function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cts-dagents-')));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const home = join(dir, 'home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  const env = childEnv({ HOME: home, XDG_CONFIG_HOME: join(dir, 'cfg'), NO_COLOR: '1', SPRAG_LANG: 'ko',
    ...(process.platform === 'win32' ? { USERPROFILE: home } : {}) });
  const run = (args, input) => execFileSync(process.execPath, [CLI, ...args], {
    cwd: dir, env, encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], timeout: 120_000 });
  const call = (file, expr) => JSON.parse(execFileSync(process.execPath, [
    '--input-type=module', '-e',
    `import * as m from ${JSON.stringify(url(file))}; const r = await (async () => (${expr}))(); console.log(JSON.stringify(r));`,
  ], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }));
  const agents = join(home, '.claude', 'agents');
  const file = (n) => join(agents, `${n}.md`);
  return { dir, home, run, call, agents, file,
    sync: (opts = {}) => call('delegation-agents.js', `m.syncDelegationAgents(${JSON.stringify(opts)})`),
    remove: () => call('delegation-agents.js', 'm.removeDelegationAgents()'),
    setConfig: (cfg) => call('config.js', `(m.saveConfig(${JSON.stringify(cfg)}), null)`) };
}

const present = (s) => NAMES.filter((n) => existsSync(s.file(n)));

test('sync writes five agent files with exact tools, model, marker and a no-MCP description', (t) => {
  const s = sandbox(t);
  const r = s.sync();
  assert.deepEqual(r.written.sort(), [...NAMES].sort());
  for (const n of NAMES) {
    const text = readFileSync(s.file(n), 'utf8');
    const fm = text.slice(0, text.indexOf('\n---', 3));
    assert.ok(fm.includes(`name: ${n}\n`), n);
    assert.ok(fm.includes(`\ntools: ${TOOLS[n]}\n`), `${n} tools`);
    assert.ok(fm.includes(`\nmodel: ${MODEL[n] ?? 'haiku'}\n`), `${n} model`);
    // Effort follows the verification shape, not the tier: command output and
    // file comparison verify the haiku agents, so they run at low; the worker
    // implements a fixed design against tests, so it takes medium.
    assert.ok(fm.includes(`\neffort: ${EFFORT[n] ?? 'low'}\n`), `${n} effort`);
    assert.ok(fm.includes('# managed by sprag (sprag:delegation-agent); edits are overwritten'), `${n} marker`);
    assert.match(fm, /description: .*It has no MCP tools\./, `${n} description`);
    assert.ok(!text.slice(fm.length).includes('sprag:delegation-agent'), 'marker stays out of the body');
  }
});

test('a second sync writes nothing', (t) => {
  const s = sandbox(t);
  s.sync();
  const r = s.sync();
  assert.deepEqual(r.written, []);
  assert.equal(r.unchanged.length, 5);
});

test('a user file without the marker is never overwritten', (t) => {
  const s = sandbox(t);
  mkdirSync(s.agents, { recursive: true });
  writeFileSync(s.file('haiku-explore'), '---\nname: haiku-explore\nmodel: haiku\n---\nmine\n');
  const r = s.sync();
  assert.deepEqual(r.skipped, [{ name: 'haiku-explore', reason: 'not-owned' }]);
  assert.equal(r.written.length, 4);
  assert.ok(readFileSync(s.file('haiku-explore'), 'utf8').includes('mine'));
});

test('delegationAgents:false and remove delete only marked files', (t) => {
  const s = sandbox(t);
  s.sync();
  writeFileSync(s.file('haiku-runner'), '---\nname: haiku-runner\n---\nuser copy\n');
  s.setConfig({ delegationAgents: false });
  const r = s.sync();
  assert.deepEqual(r.removed.sort(), ['haiku-explore', 'haiku-translate', 'opus-worker', 'sonnet-worker']);
  assert.deepEqual(present(s), ['haiku-runner']);
  assert.deepEqual(s.remove().removed, []);
  assert.ok(existsSync(s.file('haiku-runner')));
});

test("agent: 'codex' writes nothing", (t) => {
  const s = sandbox(t);
  const r = s.sync({ agent: 'codex' });
  assert.deepEqual(r, { written: [], unchanged: [], skipped: [], removed: [] });
  assert.ok(!existsSync(s.agents));
});

test('agentPhrase for the sonnet tier follows the sonnet-worker file', (t) => {
  const s = sandbox(t);
  const ko = () => s.call('agents.js', "m.agentPhrase('sonnet', { root: null })");
  const en = () => s.call('agents.js', "m.agentPhraseEn('sonnet', { root: null })");
  assert.equal(ko(), 'model: sonnet');
  assert.equal(en(), 'a model: sonnet subagent');
  mkdirSync(s.agents, { recursive: true });
  writeFileSync(s.file('sonnet-worker'), '---\nmodel: sonnet\n---\n');
  assert.equal(ko(), 'sonnet-worker(model 인자 생략. 이 에이전트가 없거나 MCP 도구가 필요하면 general-purpose에 model: sonnet)');
  assert.equal(en(), 'the sonnet-worker subagent (omit the model argument; if it is unavailable or MCP tools are needed, use general-purpose with model: sonnet)');
});

test('CLI: session-start hook installs the agents, delegate agents off/on removes and restores them', (t) => {
  const s = sandbox(t);
  s.run(['route-scan', '--hook'], '{}');
  assert.deepEqual(present(s), NAMES);
  const off = s.run(['delegate', 'agents', 'off']);
  assert.match(off, /껐습니다|are off/);
  assert.deepEqual(present(s), []);
  // The hook honours the saved setting and does not bring them back.
  s.run(['route-scan', '--hook'], '{}');
  assert.deepEqual(present(s), []);
  const on = s.run(['delegate', 'agents', 'on']);
  assert.match(on, /켰습니다|are on/);
  assert.deepEqual(present(s), NAMES);
  assert.match(s.run(['delegate', 'agents']), /haiku-explore: installed-by-sprag/);
  assert.ok(readdirSync(s.agents).length >= 4);
});
