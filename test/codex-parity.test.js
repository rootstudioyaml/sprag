import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { childEnv } from './helpers/child-env.js';
import { PANEL_SHELL_BLOCK } from '../src/codex-panel-shell.js';
import { formatCodexPanel } from '../src/codex-panel.js';
import { codexSharedRuleHealth, codexRuleHealth } from '../src/codex-rule-health.js';
import { updateOffer, readUpdateChip } from '../src/update-notice.js';
import { lastCodexTurn } from '../src/codex-reply-language.js';
import { readCodexDelegations } from '../src/codex-ledger.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const jsonl = (rows) => rows.map(JSON.stringify).join('\n') + '\n';
const EN = 'This is an entirely English explanation of the implementation and its verification results. The changes are complete and all relevant tests have passed.';
const KO = '변경한 코드를 확인했고 관련 테스트도 모두 통과했습니다.';

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'sprag-parity-'));
  const home = join(base, 'home'), codex = join(home, '.codex'), root = join(base, 'project');
  const dir = join(base, 'state', 'claude-token-saver');
  for (const p of [home, codex, dir, join(root, '.git')]) mkdirSync(p, { recursive: true });
  const env = childEnv({ HOME: home, CODEX_HOME: codex, ZDOTDIR: home, XDG_CONFIG_HOME: join(base, 'state'),
    CTS_LANG: 'en', CTS_NO_TMUX: '1', CTS_NO_DOC2MD: '1', CTS_NO_UPDATE_CHECK: '1' });
  const run = (args, payload, over = {}) => spawnSync(process.execPath, [CLI, ...args, '--agent', 'codex'], {
    cwd: root, env: { ...env, ...over }, input: payload ? JSON.stringify(payload) : '', encoding: 'utf8', timeout: 15000,
  });
  const ok = (...args) => { const r = run(...args); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const save = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return { base, home, codex, root, dir, env, run, ok, save };
}

test('Codex CLI surfaces cached updates, uses safe commands, and honors dismissal and opt-out', (t) => {
  const f = fixture(t);
  const state = { current: VERSION, latest: '99.0.0', checkedAt: Date.now(), highlightsFor: '99.0.0', highlights: ['Release change.'] };
  f.save('update-check.json', state);
  const on = { CTS_NO_UPDATE_CHECK: '' };
  assert.match(f.ok(['--statusline', '--text'], null, on), /-> 99\.0\.0/);
  const check = f.ok(['update-check'], null, on);
  assert.match(check, /--ignore-scripts/);
  assert.match(check, /sprag install --agent codex/);
  assert.doesNotMatch(check, /\(or: sprag upgrade\)/);
  const payload = { cwd: f.root, source: 'startup', session_id: 'parent' };
  const hook = (extra = {}, env = on) => f.ok(['codex-hook', '--event', 'session-start'], { ...payload, ...extra }, env);
  assert.match(hook(), /\[sprag update\].*99\.0\.0/);
  assert.match(hook(), /Release change/);
  assert.doesNotMatch(hook({ source: 'compact' }), /\[sprag update\]/);
  const transcript = join(f.base, 'exec.jsonl');
  writeFileSync(transcript, jsonl([{ type: 'session_meta', payload: { originator: 'codex_exec' } }]));
  assert.doesNotMatch(hook({ transcript_path: transcript }), /\[sprag update\]/);
  assert.doesNotMatch(hook({}, { NO_UPDATE_NOTIFIER: '1' }), /\[sprag update\]/);
  f.ok(['update-check', '--dismiss'], null, on);
  assert.doesNotMatch(hook(), /\[sprag update\]/);
  assert.doesNotMatch(f.ok(['--statusline'], null, on), /99\.0\.0/);
  assert.equal(JSON.parse(readFileSync(join(f.dir, 'update-check.json'), 'utf8')).checkedAt, state.checkedAt);
});

test('shared updater uses the session interval and keeps one-shot renders offline', (t) => {
  const f = fixture(t);
  const keys = ['XDG_CONFIG_HOME', 'CTS_NO_UPDATE_CHECK', 'NO_UPDATE_NOTIFIER'];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.XDG_CONFIG_HOME = join(f.base, 'state');
  delete process.env.CTS_NO_UPDATE_CHECK;
  delete process.env.NO_UPDATE_NOTIFIER;
  t.after(() => { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const checkedAt = Date.now() - 4 * 3600000;
  f.save('update-check.json', { current: VERSION, latest: '99.0.0', checkedAt });
  let spawned = 0;
  const spawnImpl = () => { spawned++; return { unref() {} }; };
  readUpdateChip(VERSION, { refresh: false, spawnImpl });
  assert.equal(spawned, 0);
  assert.match(updateOffer(VERSION, { agent: 'codex', spawnImpl }), /--ignore-scripts/);
  assert.equal(spawned, 1);
  updateOffer(VERSION, { agent: 'codex', spawnImpl });
  assert.equal(spawned, 1);
});

test('both Codex layouts show the update without exceeding terminal width', () => {
  for (const compact of [true, false]) for (const columns of [20, 80, 160]) {
    const text = formatCodexPanel({ root: '/p', update: { available: true, latest: '3.62.0' }, labelMode: 'text' },
      { compact, columns, rows: 200, version: '3.61.0', color: false });
    assert.match(text.replace(/\n/g, ' '), /3\.61\.0.*->.*3\.62\.0/);
    assert.ok(text.split('\n').every((line) => line.length <= columns));
  }
});

test('Codex uninstall removes only the managed shell block and leaves a backup', (t) => {
  const f = fixture(t);
  const file = join(f.home, '.zshrc');
  writeFileSync(file, `# user config\n${PANEL_SHELL_BLOCK}alias mine=true\n`);
  f.ok(['install', '--no-panel']);
  f.ok(['uninstall']);
  const after = readFileSync(file, 'utf8');
  assert.match(after, /user config/);
  assert.match(after, /alias mine=true/);
  assert.doesNotMatch(after, /sprag panel run|function codex/);
  assert.ok(readdirSync(f.home).some((n) => n.startsWith('.zshrc.bak-')));
  f.ok(['uninstall']);
  assert.equal(readFileSync(file, 'utf8'), after);
});

test('Codex Stop checks current Korean prompts, respects opt-out, and never loops', (t) => {
  const f = fixture(t);
  f.ok(['korean', 'on']);
  const hooks = JSON.parse(readFileSync(join(f.codex, 'hooks.json'), 'utf8'));
  assert.match(hooks.hooks.Stop[0].hooks[0].command, /--event stop/);
  const transcript = join(f.base, 'reply.jsonl');
  const setTurn = (prompt, modern = false) => writeFileSync(transcript, jsonl([
    { type: 'session_meta', payload: { id: 'parent' } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn' } },
    { type: 'event_msg', payload: modern ? { type: 'item_completed', turn_id: 'turn', thread_id: 'parent',
      item: { type: 'UserMessage', content: [{ type: 'text', text: prompt }] } }
      : { type: 'user_message', message: prompt } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: EN }] } },
  ]));
  const stop = (over = {}) => f.ok(['codex-hook', '--event', 'stop'], {
    transcript_path: transcript, session_id: 'parent', turn_id: 'turn', last_assistant_message: EN, ...over,
  });
  for (const modern of [false, true]) {
    setTurn('변경한 코드를 검토해 주세요.', modern);
    assert.equal(JSON.parse(stop()).decision, 'block');
  }
  assert.equal(stop({ stop_hook_active: true }), '');
  assert.equal(stop({ last_assistant_message: KO }), '');
  assert.equal(stop({ last_assistant_message: null }), '', 'commentary is not a final answer');
  assert.equal(stop({ turn_id: 'other' }), '');
  assert.equal(stop({ session_id: 'other' }), '');
  setTurn('변경한 코드를 영어로 설명해 주세요.');
  assert.equal(stop(), '');
  setTurn('변경한 코드를 검토해 주세요.');
  f.ok(['korean', 'reply', 'off']);
  assert.equal(stop(), '');
  f.ok(['korean', 'reply', 'on']);
  assert.equal(JSON.parse(stop()).decision, 'block');
  f.ok(['korean', 'off']);
  assert.equal(stop(), '');
});

test('shared failures reach CLI, panel and prompt briefing without contaminating native rule health', (t) => {
  const f = fixture(t);
  const policy = { status: 'active', category: 'explore', tier: 'T1', scope: 'global', targetRoot: null, signature: 'audit' };
  f.save('model-rules.json', { rules: [policy] });
  const event = { source: 'shared', tier: 'T1', sharedSignature: 'audit', scope: 'global', category: 'explore',
    from: 'parent-model', to: 'child-model', provider: 'gateway', complete: false, aborted: true, calls: 10, ts: Date.now(), usd: -0.1 };
  const events = Array.from({ length: 8 }, () => ({ ...event }));
  f.save('codex-delegation-ledger.json', { version: 1, events: Object.fromEntries(events.map((e, i) => [i, e])) });
  assert.equal(codexSharedRuleHealth({ root: f.root, dir: f.dir, events })[0].health.status, 'review');
  assert.equal(codexRuleHealth({ ...event, model: event.to }, { events }).runs, 0);
  assert.match(f.ok(['delegate', 'rules']), /rule-health: 8\/8/);
  assert.match(f.ok(['--statusline', '--text']), /rule-health shared T1 explore/);
  const transcript = join(f.base, 'usage.jsonl');
  writeFileSync(transcript, jsonl([{ type: 'session_meta', payload: { id: 'p', cwd: f.root } }]));
  const payload = { session_id: 'p', cwd: f.root, transcript_path: transcript, prompt: 'continue' };
  assert.match(f.ok(['codex-hook', '--event', 'prompt'], payload), /shared policy T1 explore.*failed 8 of 8/);
  assert.doesNotMatch(f.ok(['codex-hook', '--event', 'prompt'], payload), /failed 8 of 8/);
  const mixed = [...events.slice(0, 4), ...events.slice(0, 4).map((e) => ({ ...e, provider: 'other' })),
    { ...event, sharedSignature: 'foreign' }, { ...event, tier: 'T2' }];
  assert.deepEqual(codexSharedRuleHealth({ root: f.root, dir: f.dir, events: mixed }).map((r) => r.health.runs), [4, 4]);
  policy.scope = 'project'; policy.targetRoot = join(f.base, 'other');
  f.save('model-rules.json', { rules: [policy] });
  assert.deepEqual(codexSharedRuleHealth({ root: f.root, dir: f.dir, events }), []);
});

test('Codex reply parser excludes copied parent history and earlier turns', () => {
  const rows = [
    { type: 'session_meta', payload: { id: 'child' }, timestamp: 'copy' },
    { type: 'session_meta', payload: { id: 'parent' }, timestamp: 'copy' },
    { type: 'event_msg', payload: { type: 'user_message', message: '한국어 질문입니다.' }, timestamp: 'copy' },
    { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_id: 'child' }, timestamp: 'copy' },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'current' } },
  ];
  assert.equal(lastCodexTurn(rows.map(JSON.stringify), { sessionId: 'child', turnId: 'current' }), null);
  rows.push({ type: 'event_msg', payload: { type: 'user_message', message: 'Explain the code.' } });
  rows.push({ type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: EN }] } });
  assert.deepEqual(lastCodexTurn(rows.map(JSON.stringify), { sessionId: 'child', turnId: 'current' }), { prompt: 'Explain the code.', reply: EN });
  rows.push({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'next' } });
  assert.equal(lastCodexTurn(rows.map(JSON.stringify), { sessionId: 'child', turnId: 'next' }), null);
});

test('implementation CLI resolves only the active parent/provider T1, and records no phantom child', (t) => {
  const f = fixture(t);
  f.ok(['delegate', 'shared', 'auto', 'off']);
  f.ok(['delegate', 'shared', 'map', 'T1', '--from', 'parent', '--model', 'medium', '--provider', 'gateway']);
  const args = ['delegate', 'implementation', '--from', 'parent', '--provider', 'gateway', '--session', 'thread'];
  assert.match(f.ok(args), /model medium.*fork_turns/);
  assert.equal(readCodexDelegations({ dir: f.dir }).length, 1);
  assert.equal(JSON.parse(f.ok(['route-scan', 'savings', '--format', 'json'])).totals.runs, 0);
  assert.match(f.ok(['delegate', 'implementation', '--from', 'parent', '--provider', 'other', '--session', 'thread']), /unresolved/);
  f.ok(['delegate', 'off']);
  assert.match(f.ok(args), /is off/);
  assert.equal(readCodexDelegations({ dir: f.dir }).length, 1);
  assert.notEqual(f.run(['delegate', 'implementation', '--from', 'parent', '--provider', 'gateway']).status, 0);
});
