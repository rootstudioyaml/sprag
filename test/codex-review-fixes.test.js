import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
  writeFileSync(join(f.codex, 'sessions', 'rollout.jsonl'), jsonl([
    { timestamp: new Date(at - 500).toISOString(), type: 'session_meta', payload: { id: 'child-session', cwd: root,
      model_provider: 'current-gateway', source: { subagent: { thread_spawn: { parent_thread_id: 'parent-session' } } } } },
    row('event_msg', { type: 'task_started', turn_id: 't' }), row('turn_context', { turn_id: 't', model: 'child-model', cwd: root }),
    row('event_msg', { type: 'item_completed', turn_id: 't', item: { type: 'UserMessage', id: 'm', content: [{ type: 'text', text: 'Find it' }] } }),
    row('token_usage_record', { turn_id: 't', usage, turn_token_usage: usage }, 100),
    row('event_msg', { type: 'token_count', info: { last_token_usage: usage, total_token_usage: usage } }, 100),
    row('event_msg', { type: 'task_complete', turn_id: 't' }, 200),
  ]));
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
