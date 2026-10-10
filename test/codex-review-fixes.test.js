import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCodexBrief } from '../src/codex-brief.js';
import { codexRuleHealth, codexRulesInReview } from '../src/codex-rule-health.js';
import { codexRouteHint, codexDelegationTool } from '../src/codex-delegation.js';
import { bindCodexSubagent, readCodexDelegations, refreshCodexLedger, recordCodexDelegation } from '../src/codex-ledger.js';
import { formatCodexPanel } from '../src/codex-panel.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/child-env.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

const jsonl = (rows) => rows.map(JSON.stringify).join('\n') + '\n';

// Every path lives under a temp dir; the real ~/.codex and user data dir are never touched.
function sandbox(t) {
  const base = mkdtempSync(join(tmpdir(), 'sprag-codex-fixes-'));
  const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, CODEX_HOME: process.env.CODEX_HOME };
  process.env.XDG_CONFIG_HOME = join(base, 'config');
  process.env.CODEX_HOME = join(base, 'codex');
  const dir = join(base, 'config', 'claude-token-saver');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(base, 'codex', 'sessions'), { recursive: true });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return { base, dir, codex: join(base, 'codex') };
}

// ── F1 ─────────────────────────────────────────────────────────────────────

const now = Date.now();
// Rules store their project root resolved, which on Windows adds the drive
// letter, so the fixtures resolve theirs the same way.
const [WORK_A, WORK_B, WORK_C] = ['/work/a', '/work/b', '/work/c'].map((p) => resolve(p));
function limitRollout(f, resets, at = now) {
  const file = join(f.base, 'rollout.jsonl');
  writeFileSync(file, jsonl([
    { timestamp: new Date(at).toISOString(), type: 'session_meta', payload: { id: 'main', cwd: join(f.base, 'project') } },
    { timestamp: new Date(at).toISOString(), type: 'event_msg', payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 10 },
      last_token_usage: { input_tokens: 1000 }, model_context_window: 200000 },
    rate_limits: { primary: { used_percent: 95, window_minutes: 300, resets_at: resets } } } },
  ]));
  return file;
}

test('F1: a rate limit warning is not repeated when resets_at jitters by a second or two', (t) => {
  const f = sandbox(t);
  const base = Math.floor(now / 1000) + 3600;
  const opts = { sessionId: 'main', cwd: join(f.base, 'project'), dir: f.dir, now };
  assert.match(runCodexBrief({ ...opts, transcriptPath: limitRollout(f, base) }), /rate limit is 95%/);
  for (const jitter of [1, 2, 1, 0, 2, 3]) {
    assert.equal(runCodexBrief({ ...opts, transcriptPath: limitRollout(f, base + jitter) }), null, `jitter ${jitter}s`);
  }
  assert.match(runCodexBrief({ ...opts, transcriptPath: limitRollout(f, base + 3600) }), /rate limit is 95%/, 'a new window warns again');
});

test('F1: the first announced signature stays the anchor, so slow drift cannot chain into a new warning', (t) => {
  const f = sandbox(t);
  const base = Math.floor(now / 1000) + 3600;
  const opts = { sessionId: 'main', cwd: join(f.base, 'project'), dir: f.dir, now };
  assert.match(runCodexBrief({ ...opts, transcriptPath: limitRollout(f, base) }), /rate limit/);
  for (const d of [200, 250, 290]) assert.equal(runCodexBrief({ ...opts, transcriptPath: limitRollout(f, base + d) }), null);
  assert.match(runCodexBrief({ ...opts, transcriptPath: limitRollout(f, base + 400) }), /rate limit/);
});

// ── F2 ─────────────────────────────────────────────────────────────────────

const rule = { category: 'explore', from: 'gpt-6-luna', model: 'gpt-5.6-luna', provider: 'openai', scope: 'project',
  targetRoot: WORK_A, status: 'active', createdAt: '2026-09-01T00:00:00.000Z' };
const ts = Date.parse('2026-09-10T00:00:00.000Z');
const ev = (over = {}) => ({ category: 'explore', from: 'gpt-6-luna', to: 'gpt-5.6-luna', provider: 'openai', scope: 'project',
  targetRoot: WORK_A, complete: true, calls: 10, toolErrors: 5, usd: 0.01, ts, ...over });

test('F2: a project rule counts only its own project, and old events without targetRoot never count', () => {
  const events = [ev(), ev({ targetRoot: WORK_B }), ev({ targetRoot: undefined })];
  assert.equal(codexRuleHealth(rule, { events }).runs, 1);
  assert.equal(codexRuleHealth({ ...rule, targetRoot: WORK_B }, { events }).runs, 1);
  const bad = Array.from({ length: 8 }, () => ev({ targetRoot: WORK_B }));
  assert.equal(codexRuleHealth(rule, { events: bad }).status, 'active');
  assert.equal(codexRuleHealth({ ...rule, targetRoot: WORK_B }, { events: bad }).status, 'review');
});

test('F2: events from before the rule was created are excluded', () => {
  const events = [ev({ ts: Date.parse('2026-08-31T00:00:00Z') }), ev()];
  assert.equal(codexRuleHealth(rule, { events }).runs, 1);
});

test('F2: a global rule ignores targetRoot but keeps scope and createdAt; scope-less old events count for global only', () => {
  const global = { ...rule, scope: 'global', targetRoot: null };
  const events = [ev({ scope: 'global', targetRoot: null }), ev({ scope: undefined, targetRoot: undefined }),
    ev({ scope: 'project' }), ev({ scope: 'global', targetRoot: null, ts: Date.parse('2026-08-01T00:00:00Z') })];
  assert.equal(codexRuleHealth(global, { events }).runs, 2);
  assert.equal(codexRuleHealth(rule, { events: [ev({ scope: undefined, targetRoot: undefined })] }).runs, 0);
});

test('F2: the rule identity recorded by codexRouteHint reaches the ledger event', async (t) => {
  const f = sandbox(t);
  const root = join(f.base, 'project');
  const projectRule = { category: 'explore', from: 'parent-model', model: 'child-model', scope: 'project', targetRoot: root,
    status: 'active', createdAt: '2026-09-01T00:00:00.000Z' };
  const hint = codexRouteHint({ prompt: 'Where is chipForIssues defined?', model: 'parent-model', cwd: root, session_id: 'parent-session', model_provider: 'current-gateway' },
    { rules: [projectRule], root, provider: 'current-gateway', contextTokens: 90000, dir: f.dir });
  assert.match(hint, /\[Sprag model routing\]/);
  const [pending] = readCodexDelegations({ dir: f.dir });
  assert.equal(pending.targetRoot, root);
  assert.equal(pending.ruleCreatedAt, projectRule.createdAt);
  bindCodexSubagent({ session_id: 'parent-session', agent_id: 'child-session', model: 'child-model' }, { dir: f.dir, now: Date.now() });
  const at = Date.now() + 1000;
  const row = (type, payload, d = 0) => ({ timestamp: new Date(at + d).toISOString(), type, payload });
  const usage = { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 500 };
  const child = join(f.codex, 'sessions', 'rollout.jsonl');
  writeFileSync(child, jsonl([
    { timestamp: new Date(at - 500).toISOString(), type: 'session_meta', payload: { id: 'child-session', cwd: root,
      model_provider: 'current-gateway', source: { subagent: { thread_spawn: { parent_thread_id: 'parent-session' } } } } },
    row('event_msg', { type: 'task_started', turn_id: 't' }), row('turn_context', { turn_id: 't', model: 'child-model', cwd: root }),
    row('event_msg', { type: 'item_completed', turn_id: 't', item: { type: 'UserMessage', id: 'm', content: [{ type: 'text', text: 'Find it' }] } }),
    row('token_usage_record', { turn_id: 't', usage, turn_token_usage: usage }, 100),
    row('event_msg', { type: 'token_count', info: { last_token_usage: usage, total_token_usage: usage } }, 100),
    row('event_msg', { type: 'task_complete', turn_id: 't' }, 200),
  ]));
  // The ledger skips rollouts last written before the route was recorded. A
  // filesystem clock a few milliseconds behind Date.now() put this file there
  // on some CI runs, so its mtime is set to when the child actually finished.
  utimesSync(child, new Date(at + 200), new Date(at + 200));
  const ledger = await refreshCodexLedger({ dir: f.dir, home: f.codex, now: Date.now() + 5000, prices: null });
  const event = ledger.events[pending.id];
  assert.equal(event.targetRoot, root);
  assert.equal(event.ruleCreatedAt, projectRule.createdAt);
  assert.equal(codexRuleHealth(projectRule, { events: [event] }).runs, 1);
});

test('F2: an old pending record without rule identity adds no fields to the event', async (t) => {
  const f = sandbox(t);
  recordCodexDelegation({ id: 'cccccccccccccccc', parentSessionId: 'p', from: 'a', to: 'b', provider: 'x' }, { dir: f.dir });
  const [pending] = readCodexDelegations({ dir: f.dir });
  assert.equal('targetRoot' in pending, false);
});

// ── F3 ─────────────────────────────────────────────────────────────────────

const failing = (over) => Array.from({ length: 8 }, () => ev(over));

test('F3: rules in review are limited to the current project and numbered like the rules list', () => {
  const rules = [
    { ...rule, targetRoot: WORK_B },
    { ...rule, targetRoot: WORK_A },
    { ...rule, scope: 'global', targetRoot: null, category: 'read' },
  ];
  const events = [...failing({ targetRoot: WORK_A }), ...failing({ targetRoot: WORK_B }), ...failing({ scope: 'global', targetRoot: null, category: 'read' })];
  assert.deepEqual(codexRulesInReview({ root: WORK_A, rules, events }).map((r) => r.index), [2, 3]);
  assert.deepEqual(codexRulesInReview({ root: WORK_C, rules, events }).map((r) => r.index), [3]);
  assert.deepEqual(codexRulesInReview({ root: null, rules, events }).map((r) => r.index), [1, 2, 3]);
});

test('F3: the panel shows a rule-health chip with the rule number', () => {
  const data = { root: '/project', days: 7, matches: 1, updatedAt: new Date(now), harness: { global: { configured: 5, total: 5 } },
    rules: { global: 1, project: 0 }, ruleReview: [2], korean: true, lint: 'block', doc2md: true, session: null };
  assert.match(formatCodexPanel(data, { color: false, now }), /rule-health #2/);
  assert.doesNotMatch(formatCodexPanel({ ...data, ruleReview: [] }, { color: false, now }), /rule-health/);
});

function writeLedger(f, events) {
  writeFileSync(join(f.dir, 'codex-delegation-ledger.json'), JSON.stringify({ version: 1, events: Object.fromEntries(events.map((e, i) => [`r${i}`, e])) }));
}

test('F3: the briefing names a failing rule once per session and skips other projects', (t) => {
  const seed = () => {
    const f = sandbox(t);
    const root = join(f.base, 'project');
    const other = join(f.base, 'other');
    const mk = (targetRoot, category) => ({ category, from: 'gpt-6-luna', model: 'gpt-5.6-luna', scope: 'project', targetRoot,
      effort: undefined, status: 'active', createdAt: '2026-09-01T00:00:00.000Z' });
    writeFileSync(join(f.dir, 'codex-model-rules.json'), JSON.stringify({ version: 1, rules: [mk(other, 'read'), mk(root, 'explore')] }));
    writeLedger(f, [...failing({ targetRoot: root }), ...failing({ targetRoot: other, category: 'read' })]
      .map((e) => ({ ...e, provider: undefined, ts: Date.parse('2026-09-10T00:00:00Z') })));
    return { root, opts: { sessionId: 'main', cwd: root, dir: f.dir, now, transcriptPath: limitRollout(f, Math.floor(now / 1000) - 5) } };
  };
  const { opts } = seed();
  const first = runCodexBrief(opts);
  assert.match(first, /Codex model rule #2 \(explore, gpt-6-luna -> gpt-5.6-luna\) failed 8 of 8 measured runs/);
  assert.match(first, /sprag delegate rules rm 2 --agent codex/);
  assert.doesNotMatch(first, /#1/);
  assert.equal(runCodexBrief(opts), null);

  // A prompt sent from a subdirectory: the hook passes the project root, and
  // the project's rule is found by it, not by the directory the prompt came from.
  const byCwd = seed();
  const nested = join(byCwd.root, 'packages', 'app');
  assert.doesNotMatch(runCodexBrief({ ...byCwd.opts, cwd: nested }) ?? '', /Codex model rule/);
  const byRoot = seed();
  assert.match(runCodexBrief({ ...byRoot.opts, cwd: join(byRoot.root, 'packages', 'app'), root: byRoot.root }), /Codex model rule #2/);
});

test('F3: a broken rule file does not stop the rest of the briefing', (t) => {
  const f = sandbox(t);
  writeFileSync(join(f.dir, 'codex-model-rules.json'), '{ not json');
  const out = runCodexBrief({ sessionId: 'main', cwd: join(f.base, 'project'), dir: f.dir, now,
    transcriptPath: limitRollout(f, Math.floor(now / 1000) + 3600) });
  assert.match(out, /rate limit is 95%/);
});

// ── F5 ─────────────────────────────────────────────────────────────────────

test('F5: delegate off, status and model work while the rule file is unreadable', (t) => {
  const f = sandbox(t);
  writeFileSync(join(f.dir, 'config.json'), JSON.stringify({ codex: { delegate: true } }));
  writeFileSync(join(f.dir, 'codex-model-rules.json'), '{ broken');
  const env = childEnv({ HOME: join(f.base, 'home'), CODEX_HOME: f.codex, XDG_CONFIG_HOME: join(f.base, 'config') });
  const cli = (...args) => spawnSync(process.execPath, [CLI, 'delegate', ...args, '--agent', 'codex'], { env, cwd: f.base, encoding: 'utf8', timeout: 15000 });
  const status = cli('status');
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Codex delegate: on/);
  assert.match(status.stdout, /Codex rules: unreadable \(Cannot parse Codex model rules/);
  const off = cli('off');
  assert.equal(off.status, 0, off.stderr);
  assert.match(off.stdout, /Codex delegate: off/);
  assert.equal(JSON.parse(readFileSync(join(f.dir, 'config.json'), 'utf8')).codex.delegate, false);
  const model = cli('model', 'gpt-5.6-luna');
  assert.equal(model.status, 0, model.stderr);
  assert.match(model.stdout, /Default target: gpt-5.6-luna/);
  const rules = cli('rules');
  assert.notEqual(rules.status, 0);
  assert.match(rules.stderr, /Cannot parse/);
  assert.equal(readFileSync(join(f.dir, 'codex-model-rules.json'), 'utf8'), '{ broken');
});

test('F5: the spawn hook keeps the default target when the rule file is unreadable', (t) => {
  const f = sandbox(t);
  writeFileSync(join(f.dir, 'codex-model-rules.json'), '{ broken');
  const out = codexDelegationTool({ tool_name: 'spawn_agent', tool_input: { message: 'Where is it defined?' }, model: 'parent-model', cwd: f.base },
    { cfg: { codex: { delegate: true, delegateTarget: { model: 'child-model' } } }, root: f.base, home: f.codex, dir: f.dir, record: () => {} });
  assert.equal(out.hookSpecificOutput.updatedInput.model, 'child-model');
});

// ── F4, F9: the harness block in AGENTS.md ─────────────────────────────────

test('F4: uninit removes the block from AGENTS.md after an override file took over', async (t) => {
  const f = sandbox(t);
  const { initCodexHarness, uninitCodexHarness, CODEX_BEGIN } = await import('../src/codex-harness.js');
  const root = join(f.base, 'project');
  mkdirSync(root, { recursive: true });
  const agents = join(root, 'AGENTS.md');
  writeFileSync(agents, '# Mine\n');
  assert.equal(initCodexHarness({ root, scope: 'project' }).file, agents);
  // The override becomes the file Codex reads; the block is still in AGENTS.md.
  writeFileSync(join(root, 'AGENTS.override.md'), '# Override\n');
  const out = uninitCodexHarness({ root, scope: 'project' });
  assert.equal(out.removed, true);
  assert.equal(out.file, agents);
  assert.ok(!readFileSync(agents, 'utf8').includes(CODEX_BEGIN));
  assert.equal(readFileSync(agents, 'utf8'), '# Mine\n');
  assert.equal(readFileSync(join(root, 'AGENTS.override.md'), 'utf8'), '# Override\n', 'a file with no block is left alone');
  assert.equal(uninitCodexHarness({ root, scope: 'project' }).removed, false);
});

test('F9: repeated init and uninit leave AGENTS.md byte-identical', async (t) => {
  const f = sandbox(t);
  const { initCodexHarness, uninitCodexHarness, codexHarnessBlock } = await import('../src/codex-harness.js');
  const root = join(f.base, 'project');
  mkdirSync(root, { recursive: true });
  const agents = join(root, 'AGENTS.md');
  for (const original of ['# Mine\n', '# Mine\n\n\n', '']) {
    writeFileSync(agents, original);
    for (let i = 0; i < 3; i++) {
      initCodexHarness({ root, scope: 'project' });
      const body = original.replace(/\n+$/, '');
      assert.equal(readFileSync(agents, 'utf8'), (body ? `${body}\n\n` : '') + codexHarnessBlock(), `init #${i + 1} on ${JSON.stringify(original)}`);
      uninitCodexHarness({ root, scope: 'project' });
      assert.equal(readFileSync(agents, 'utf8'), body ? `${body}\n` : '', `uninit #${i + 1} on ${JSON.stringify(original)}`);
    }
  }
  // Text after the block keeps one blank line between it and what came before.
  writeFileSync(agents, `# Before\n\n${codexHarnessBlock()}\n# After\n`);
  uninitCodexHarness({ root, scope: 'project' });
  assert.equal(readFileSync(agents, 'utf8'), '# Before\n\n# After\n');
});

// ── F6 ─────────────────────────────────────────────────────────────────────

test('F6: re-adding a rule with no provider replaces it instead of stacking a copy', async (t) => {
  const f = sandbox(t);
  const { addCodexModelRule, loadCodexModelRules } = await import('../src/codex-delegation.js');
  const base = { category: 'explore', from: 'parent-model', model: 'child-model', scope: 'global' };
  addCodexModelRule({ ...base, provider: null }, { dir: f.dir });
  addCodexModelRule({ ...base, provider: null, effort: 'low' }, { dir: f.dir });
  addCodexModelRule({ ...base }, { dir: f.dir });
  assert.equal(loadCodexModelRules({ dir: f.dir }).length, 1);
  addCodexModelRule({ ...base, provider: 'gateway-a' }, { dir: f.dir });
  addCodexModelRule({ ...base, provider: 'gateway-a' }, { dir: f.dir });
  assert.equal(loadCodexModelRules({ dir: f.dir }).length, 2, 'a provider-scoped rule is a different rule');
});

// ── F7 ─────────────────────────────────────────────────────────────────────

const hinted = (dir, id, turnId, at = Date.now()) => recordCodexDelegation({ id, parentSessionId: 'parent', turnId, via: 'prompt',
  source: 'rule', category: 'explore', scope: 'global', from: 'parent-model', to: 'child-model', at }, { dir });

test('F7: a hint no child claimed is closed by the next prompt, so a later spawn is not credited to it', async (t) => {
  const f = sandbox(t);
  const { closeStaleCodexRoutes } = await import('../src/codex-ledger.js');
  hinted(f.dir, 'a'.repeat(16), 'turn-1');
  assert.equal(closeStaleCodexRoutes({ session_id: 'parent', turn_id: 'turn-1' }, { dir: f.dir }), 0, 'the hinted turn itself keeps its route');
  assert.equal(closeStaleCodexRoutes({ session_id: 'someone-else', turn_id: 'turn-2' }, { dir: f.dir }), 0);
  assert.equal(closeStaleCodexRoutes({ session_id: 'parent', turn_id: 'turn-2' }, { dir: f.dir }), 1);
  assert.equal(closeStaleCodexRoutes({ session_id: 'parent', turn_id: 'turn-3' }, { dir: f.dir }), 0, 'closed once');
  assert.equal(bindCodexSubagent({ session_id: 'parent', agent_id: 'unrelated-child', model: 'child-model' }, { dir: f.dir }), null);
});

test('F7: a claimed route is not closed, and a child in the hinted turn still binds', async (t) => {
  const f = sandbox(t);
  const { closeStaleCodexRoutes, readCodexBindings } = await import('../src/codex-ledger.js');
  const id = 'b'.repeat(16);
  hinted(f.dir, id, 'turn-1');
  assert.equal(bindCodexSubagent({ session_id: 'parent', agent_id: 'child-1', model: 'child-model' }, { dir: f.dir }), id);
  assert.equal(closeStaleCodexRoutes({ session_id: 'parent', turn_id: 'turn-2' }, { dir: f.dir }), 0);
  assert.deepEqual(readCodexBindings({ dir: f.dir }).map((b) => b.childSessionId), ['child-1']);
});

test('F7: when both sides name a turn, a child from another turn does not bind', (t) => {
  const f = sandbox(t);
  const id = 'c'.repeat(16);
  hinted(f.dir, id, 'turn-1');
  assert.equal(bindCodexSubagent({ session_id: 'parent', agent_id: 'late-child', model: 'child-model', turn_id: 'turn-9' }, { dir: f.dir }), null);
  assert.equal(bindCodexSubagent({ session_id: 'parent', agent_id: 'own-child', model: 'child-model', turn_id: 'turn-1' }, { dir: f.dir }), id);
});

// ── F8 ─────────────────────────────────────────────────────────────────────

test('F8: a bound route counts as unsettled until the ledger holds its finished run', async (t) => {
  const f = sandbox(t);
  const { unsettledCodexRoutes } = await import('../src/codex-ledger.js');
  const id = 'd'.repeat(16);
  assert.equal(unsettledCodexRoutes({ dir: f.dir }), 0);
  hinted(f.dir, id, 'turn-1');
  assert.equal(unsettledCodexRoutes({ dir: f.dir }), 0, 'a hint alone spawned nothing');
  bindCodexSubagent({ session_id: 'parent', agent_id: 'child-1', model: 'child-model' }, { dir: f.dir });
  assert.equal(unsettledCodexRoutes({ dir: f.dir }), 1);
  assert.equal(unsettledCodexRoutes({ dir: f.dir, now: Date.now() + 31 * 60000 }), 0, 'past the bind window it waits for the regular scan');
  writeFileSync(join(f.dir, 'codex-delegation-ledger.json'), JSON.stringify({ version: 1, events: { [id]: { complete: false } } }));
  assert.equal(unsettledCodexRoutes({ dir: f.dir }), 1, 'a child still running is not settled');
  writeFileSync(join(f.dir, 'codex-delegation-ledger.json'), JSON.stringify({ version: 1, events: { [id]: { complete: true } } }));
  assert.equal(unsettledCodexRoutes({ dir: f.dir }), 0);
});

test('F8: the prompt hook asks for a ledger refresh only while a delegated run is unpriced', async (t) => {
  const f = sandbox(t);
  const { codexHookOutput } = await import('../src/codex-hooks.js');
  let refreshes = 0;
  const prompt = (turn_id) => codexHookOutput('prompt', { prompt: 'hello there', session_id: 'parent', turn_id, model: 'parent-model', cwd: f.base },
    { cfg: { codex: { delegate: true, doc2md: false, brief: false } }, refreshLedger: () => { refreshes++; } });
  await prompt('turn-1');
  assert.equal(refreshes, 0);
  hinted(f.dir, 'e'.repeat(16), 'turn-1');
  bindCodexSubagent({ session_id: 'parent', agent_id: 'child-1', model: 'child-model' }, { dir: f.dir });
  await prompt('turn-2');
  assert.equal(refreshes, 1);
  writeFileSync(join(f.dir, 'codex-delegation-ledger.json'), JSON.stringify({ version: 1, events: { ['e'.repeat(16)]: { complete: true } } }));
  await prompt('turn-3');
  assert.equal(refreshes, 1);
  // With delegation off the hook neither closes routes nor refreshes.
  await codexHookOutput('prompt', { prompt: 'hello there', session_id: 'parent' }, { cfg: { codex: { delegate: false, doc2md: false, brief: false } }, refreshLedger: () => { refreshes++; } });
  assert.equal(refreshes, 1);
});

test('F8: the detached refresh command prints nothing', (t) => {
  const f = sandbox(t);
  const env = childEnv({ HOME: join(f.base, 'home'), CODEX_HOME: f.codex, XDG_CONFIG_HOME: join(f.base, 'config') });
  const run = spawnSync(process.execPath, [CLI, 'route-scan', 'savings', '--refresh', '--quiet', '--agent', 'codex'], { env, cwd: f.base, encoding: 'utf8', timeout: 15000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, '');
});

// ── F9: pinned panel ───────────────────────────────────────────────────────

test('F9: a pinned panel finds its session by rollout name, and by content when the name does not help', async (t) => {
  const f = sandbox(t);
  const { createPanelReader } = await import('../src/codex-panel.js');
  const sessions = join(f.codex, 'sessions');
  const rollout = (name, id) => writeFileSync(join(sessions, name), jsonl([
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id, cwd: join(f.base, 'project') } },
    { timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 }, last_token_usage: { input_tokens: 100 }, model_context_window: 200000 } } },
  ]));
  rollout('rollout-2026-10-01T00-00-00-sess-named.jsonl', 'sess-named');
  rollout('renamed.jsonl', 'sess-moved');
  // Carries the pinned id in its name but holds another session.
  rollout('rollout-sess-moved-decoy.jsonl', 'sess-decoy');
  const pinned = async (sessionId) => (await createPanelReader({ home: f.codex, root: f.base, sessionId })()).session?.sessionId ?? null;
  assert.equal(await pinned('sess-named'), 'sess-named');
  assert.equal(await pinned('sess-moved'), 'sess-moved');
  assert.equal(await pinned('sess-absent'), null);
});
