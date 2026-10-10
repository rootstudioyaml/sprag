import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncCodexKoreanBlock, initCodexHarness, uninitCodexHarness, CODEX_BEGIN, CODEX_KOREAN_BEGIN, CODEX_KOREAN_END } from '../src/codex-harness.js';
import { codexDelegateEnabled, autoCodexSharedTargets } from '../src/codex-delegation.js';
import { codexHookOutput } from '../src/codex-hooks.js';

const ON = { koreanStyle: { enabled: true } };
const OFF = { koreanStyle: { enabled: false } };

/** An isolated Codex home and Sprag data dir; the real ~/.codex is never touched. */
function sandbox(t) {
  const base = mkdtempSync(join(tmpdir(), 'sprag-oob-'));
  const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, CODEX_HOME: process.env.CODEX_HOME, CTS_NO_ROUTE_SCAN: process.env.CTS_NO_ROUTE_SCAN };
  const home = join(base, 'codex'), dir = join(base, 'state', 'claude-token-saver');
  process.env.XDG_CONFIG_HOME = join(base, 'state');
  process.env.CODEX_HOME = home;
  process.env.CTS_NO_ROUTE_SCAN = '1';
  mkdirSync(home, { recursive: true });
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(base, 'project', '.git'), { recursive: true });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return { base, home, dir, cwd: join(base, 'project') };
}

const backups = (home) => readdirSync(home).filter((n) => n.includes('.bak-'));

test('korean block is written into an empty home, then reported unchanged', (t) => {
  const f = sandbox(t);
  const first = syncCodexKoreanBlock({ cfg: ON, home: f.home });
  assert.equal(first.action, 'written');
  assert.equal(first.file, join(f.home, 'AGENTS.md'));
  const text = readFileSync(first.file, 'utf8');
  assert.ok(text.startsWith(CODEX_KOREAN_BEGIN));
  assert.match(text, /\[sprag korean-style\]/);
  assert.ok(text.trimEnd().endsWith(CODEX_KOREAN_END));
  assert.equal(backups(f.home).length, 0, 'nothing to back up in an empty home');
  assert.equal(syncCodexKoreanBlock({ cfg: ON, home: f.home }).action, 'unchanged');
  assert.equal(readFileSync(first.file, 'utf8'), text);
});

test('a missing Codex directory is skipped, not created', (t) => {
  const f = sandbox(t);
  const missing = join(f.base, 'nowhere');
  assert.equal(syncCodexKoreanBlock({ cfg: ON, home: missing }).action, 'skipped');
  assert.equal(existsSync(missing), false);
});

test('disabling removes the block and keeps the user text around it', (t) => {
  const f = sandbox(t);
  const file = join(f.home, 'AGENTS.md');
  writeFileSync(file, '# My rules\n\nBe kind.\n');
  assert.equal(syncCodexKoreanBlock({ cfg: ON, home: f.home }).action, 'written');
  assert.equal(backups(f.home).length, 1, 'first addition to a user file is backed up');
  assert.match(readFileSync(file, 'utf8'), /^# My rules\n\nBe kind\.\n\n<!-- sprag:codex:korean-style:begin -->/);
  // Replacing the block's own contents needs no further backup.
  writeFileSync(file, readFileSync(file, 'utf8').replace('이 지침은 사용자가', 'STALE 사용자가'));
  assert.equal(syncCodexKoreanBlock({ cfg: ON, home: f.home }).action, 'written');
  assert.equal(backups(f.home).length, 1);
  assert.doesNotMatch(readFileSync(file, 'utf8'), /STALE/);
  const removed = syncCodexKoreanBlock({ cfg: OFF, home: f.home });
  assert.equal(removed.action, 'removed');
  assert.equal(readFileSync(file, 'utf8'), '# My rules\n\nBe kind.\n');
  assert.equal(syncCodexKoreanBlock({ cfg: OFF, home: f.home }).action, 'absent');
});

test('a non-empty AGENTS.override.md is the target; a stale block elsewhere is cleaned when disabled', (t) => {
  const f = sandbox(t);
  writeFileSync(join(f.home, 'AGENTS.md'), 'base\n');
  syncCodexKoreanBlock({ cfg: ON, home: f.home });
  writeFileSync(join(f.home, 'AGENTS.override.md'), 'override text\n');
  const r = syncCodexKoreanBlock({ cfg: ON, home: f.home });
  assert.equal(r.file, join(f.home, 'AGENTS.override.md'));
  assert.equal(r.action, 'written');
  assert.match(readFileSync(r.file, 'utf8'), /^override text\n\n<!-- sprag:codex:korean-style:begin -->/);
  assert.equal(syncCodexKoreanBlock({ cfg: OFF, home: f.home }).action, 'removed');
  for (const name of ['AGENTS.md', 'AGENTS.override.md']) {
    assert.doesNotMatch(readFileSync(join(f.home, name), 'utf8'), /korean-style/, name);
  }
});

test('malformed korean markers fail loudly instead of rewriting the file', (t) => {
  const f = sandbox(t);
  writeFileSync(join(f.home, 'AGENTS.md'), `${CODEX_KOREAN_BEGIN}\nno end\n`);
  assert.throws(() => syncCodexKoreanBlock({ cfg: ON, home: f.home }), /Malformed Sprag Codex korean-style markers/);
});

test('global uninit removes the harness and korean blocks; project scope has none', (t) => {
  const f = sandbox(t);
  initCodexHarness({ scope: 'global' });
  syncCodexKoreanBlock({ cfg: ON, home: f.home });
  const file = join(f.home, 'AGENTS.md');
  assert.match(readFileSync(file, 'utf8'), new RegExp(`${CODEX_BEGIN}[\\s\\S]*${CODEX_KOREAN_BEGIN}`));
  const r = uninitCodexHarness({ scope: 'global' });
  assert.equal(r.removed, true);
  assert.equal(readFileSync(file, 'utf8').trim(), '');
  assert.deepEqual(uninitCodexHarness({ root: f.cwd, scope: 'project' }), { file: join(f.cwd, 'AGENTS.md'), removed: false });
});

test('session start adds the korean guide to the hook only when the block was just written', async (t) => {
  const f = sandbox(t);
  const fresh = await codexHookOutput('session-start', { cwd: f.cwd, source: 'startup' }, { cfg: ON });
  assert.match(fresh.hookSpecificOutput.additionalContext, /\[sprag korean-style\]|Read ".*" before starting work/);
  const again = await codexHookOutput('session-start', { cwd: f.cwd, source: 'startup' }, { cfg: ON });
  assert.doesNotMatch(again?.hookSpecificOutput?.additionalContext ?? '', /\[sprag korean-style\]|before starting work/);
  assert.match(readFileSync(join(f.home, 'AGENTS.md'), 'utf8'), /\[sprag korean-style\]/);
});

test('session start still carries the guide when the block cannot be synced', async (t) => {
  const f = sandbox(t);
  writeFileSync(join(f.home, 'AGENTS.md'), `${CODEX_KOREAN_BEGIN}\nno end marker\n`);
  const out = await codexHookOutput('session-start', { cwd: f.cwd, source: 'startup' }, { cfg: ON });
  assert.match(out.hookSpecificOutput.additionalContext, /\[sprag korean-style\]|before starting work/);
  assert.equal(readFileSync(join(f.home, 'AGENTS.md'), 'utf8'), `${CODEX_KOREAN_BEGIN}\nno end marker\n`);
});

test('codexDelegateEnabled is on unless explicitly turned off', () => {
  assert.equal(codexDelegateEnabled(undefined), true);
  assert.equal(codexDelegateEnabled({}), true);
  assert.equal(codexDelegateEnabled({ codex: {} }), true);
  assert.equal(codexDelegateEnabled({ codex: { delegate: true } }), true);
  assert.equal(codexDelegateEnabled({ codex: { delegate: false } }), false);
});

test('subagent start and the prompt hook work without a delegate setting', async (t) => {
  const f = sandbox(t);
  const start = await codexHookOutput('subagent-start', { cwd: f.cwd, agent_id: 'child', agent_type: 'worker' }, { cfg: {} });
  assert.match(start.hookSpecificOutput.additionalContext, /caller-provided budget/);
  assert.equal(await codexHookOutput('subagent-start', { cwd: f.cwd, agent_id: 'child' }, { cfg: { codex: { delegate: false } } }), null);
});

test('the prompt hook emits the route hint without a delegate setting and stays silent when it is off', async (t) => {
  const f = sandbox(t);
  writeFileSync(join(f.home, 'config.toml'), 'model_provider="gateway"\n');
  writeFileSync(join(f.dir, 'model-rules.json'), JSON.stringify({ rules: ['T1', 'T2'].map((tier) => ({ status: 'active',
    category: 'explore', tier, scope: 'global', targetRoot: null, signature: `${tier}|explore|original-project`,
    agent: tier === 'T2' ? 'haiku-explore' : 'sonnet', delegatedRuns: 100, savedUsd: 999 })) }));
  const transcript = join(f.base, 'rollout.jsonl');
  writeFileSync(transcript, JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 70000 } } } }) + '\n');
  const targets = [{ tier: 'T2', from: 'parent-model', model: 'small-model', provider: 'gateway' },
    { tier: 'T1', from: 'parent-model', model: 'medium-model', provider: 'gateway' }];
  const payload = { model: 'parent-model', model_provider: 'gateway', cwd: f.cwd, prompt: 'Find the parser files',
    session_id: 'parent', turn_id: 't1', transcript_path: transcript };
  const run = (codex) => codexHookOutput('prompt', payload,
    { cfg: { codex: { doc2md: false, brief: false, ...codex, sharedRules: { targets } } }, refreshLedger: () => {} });
  assert.match((await run({}))?.hookSpecificOutput?.additionalContext ?? '', /T2: model small-model/);
  assert.equal(await run({ delegate: false }), null);
});

// Priced direct-OpenAI models, the way test/shared-model-rules.test.js sets them up.
function catalog(home, models) {
  writeFileSync(join(home, 'models_cache.json'), JSON.stringify({ fetched_at: 'x', etag: 'e', client_version: '1', identity: {},
    models: models.map(([slug, visibility]) => ({ slug, visibility, supported_in_api: true })) }));
}

test('auto tiers resolve from the Codex model catalog when no history exists', (t) => {
  const f = sandbox(t);
  writeFileSync(join(f.home, 'config.toml'), 'model_provider="openai"\nmodel="gpt-6-astra"\n');
  catalog(f.home, [['gpt-6-astra', 'list'], ['gpt-6-sol', 'list'], ['gpt-6-luna', 'list'], ['gpt-5.6-terra', 'hide']]);
  const r = autoCodexSharedTargets({ dir: f.dir, home: f.home, model: 'gpt-6-astra', provider: 'openai' });
  assert.equal(r.reason, null);
  assert.deepEqual(r.targets.map((x) => [x.tier, x.model]), [['T2', 'gpt-6-luna'], ['T1', 'gpt-6-sol']]);
  // The union keeps observed models too: luna is only in the history, sol only in the catalog.
  catalog(f.home, [['gpt-6-astra', 'list'], ['gpt-6-sol', 'list']]);
  writeFileSync(join(f.dir, 'codex-route-scan.json'), JSON.stringify({ version: 1, candidates: [], observedModels: ['openai|gpt-6-luna'] }));
  const union = autoCodexSharedTargets({ dir: f.dir, home: f.home, model: 'gpt-6-astra', provider: 'openai' });
  assert.deepEqual(union.targets.map((x) => [x.tier, x.model]), [['T2', 'gpt-6-luna'], ['T1', 'gpt-6-sol']]);
});

test('the catalog is ignored for other providers and for unusable files', (t) => {
  const f = sandbox(t);
  catalog(f.home, [['gpt-6-astra', 'list'], ['gpt-6-luna', 'list']]);
  const other = autoCodexSharedTargets({ dir: f.dir, home: f.home, model: 'gpt-6-astra', provider: 'other' });
  assert.equal(other.targets.length, 0);
  writeFileSync(join(f.home, 'models_cache.json'), '{not json');
  const bad = autoCodexSharedTargets({ dir: f.dir, home: f.home, model: 'gpt-6-astra', provider: 'openai' });
  assert.equal(bad.targets.length, 0);
  assert.match(bad.reason, /no cheaper priced model has run/);
  writeFileSync(join(f.home, 'models_cache.json'), JSON.stringify({ models: 'nope' }));
  assert.equal(autoCodexSharedTargets({ dir: f.dir, home: f.home, model: 'gpt-6-astra', provider: 'openai' }).targets.length, 0);
});

test('the cheapest available parent says so instead of blaming missing history', (t) => {
  const f = sandbox(t);
  catalog(f.home, [['gpt-6-astra', 'list'], ['gpt-6-luna', 'list']]);
  const r = autoCodexSharedTargets({ dir: f.dir, home: f.home, model: 'gpt-6-luna', provider: 'openai' });
  assert.equal(r.targets.length, 0);
  assert.equal(r.reason, 'gpt-6-luna is already the cheapest available model on openai');
});
