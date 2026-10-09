import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSharedModelRules, sharedModelRulesForProject } from '../src/shared-model-rules.js';
import { codexRouteHint, codexDelegationTool, sharedCodexModelRules, codexSharedTargets } from '../src/codex-delegation.js';
import { routeMatch } from '../src/route-inject.js';
import { childEnv } from './helpers/child-env.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const policy = (tier = 'T2', extra = {}) => ({ status: 'active', category: 'explore', tier, scope: 'global',
  targetRoot: null, signature: `${tier}|explore|original-project`, agent: tier === 'T2' ? 'haiku-explore' : 'sonnet',
  delegatedRuns: 100, savedUsd: 999, ...extra });
const target = (tier = 'T2', extra = {}) => ({ tier, from: 'parent-model', model: tier === 'T2' ? 'small-model' : 'medium-model',
  effort: 'high', provider: 'gateway', ...extra });

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'sprag-shared-'));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const dir = join(base, 'state', 'claude-token-saver'), home = join(base, 'codex'), root = join(base, 'project');
  for (const p of [dir, home, join(root, '.git')]) mkdirSync(p, { recursive: true });
  writeFileSync(join(home, 'config.toml'), 'model_provider="gateway"\n');
  const file = join(dir, 'model-rules.json');
  const save = (rules) => writeFileSync(file, JSON.stringify({ rules }));
  save([policy('T1'), policy('T2')]);
  const cfg = { codex: { delegate: true, sharedRules: { targets: [target('T2'), target('T1')] } } };
  const payload = { model: 'parent-model', model_provider: 'gateway', cwd: root, prompt: 'Find the parser files', session_id: 'parent' };
  const recorded = [];
  const opts = { dir, root, home, cfg, rules: [], contextTokens: 60000, record: (r) => recorded.push(r) };
  const env = childEnv({ HOME: base, CODEX_HOME: home, XDG_CONFIG_HOME: join(base, 'state'),
    CTS_NO_KOREAN: '1', CTS_NO_DOC2MD: '1', CTS_LANG: 'en' });
  const run = (args, input, { agent = 'codex', cwd = root } = {}) => spawnSync(process.execPath, [CLI, ...args, '--agent', agent],
    { cwd, env, encoding: 'utf8', timeout: 10000, input: input && JSON.stringify(input) });
  return { ...opts, base, file, save, payload, recorded, opts, run };
}

test('shared policy view carries category, tier, scope and bounds, never roles or usage totals', (t) => {
  const f = fixture(t);
  const before = readFileSync(f.file, 'utf8');
  const shared = loadSharedModelRules(f);
  assert.equal(shared.length, 2);
  assert.deepEqual(shared[1].budget, { calls: 8, out: 1500 });
  for (const r of shared) for (const key of ['agent', 'savedUsd', 'delegatedRuns', 'baselineModel']) assert.equal(key in r, false);
  assert.equal(readFileSync(f.file, 'utf8'), before);
  assert.equal(existsSync(join(f.dir, 'codex-model-rules.json')), false);
});

test('invalid, inactive and review policies do not cross agents; corrupt registry fails closed', (t) => {
  const f = fixture(t);
  f.save([null, {}, policy('T0'), policy('T2', { status: 'off' }), policy('T2', { status: 'review' }),
    policy('T2', { category: 'unknown' }), policy('T2', { scope: 'project', targetRoot: 'relative' })]);
  assert.deepEqual(loadSharedModelRules(f), []);
  writeFileSync(f.file, '{bad');
  assert.deepEqual(loadSharedModelRules(f), []);
  assert.equal(codexRouteHint(f.payload, f.opts), null);
});

test('shared rules preserve project boundaries, prefer project policy per tier, and deduplicate', (t) => {
  const f = fixture(t);
  f.save([policy(), policy('T2', { signature: 'duplicate' }),
    policy('T2', { scope: 'project', targetRoot: f.root, budget: { calls: 3, out: 500 } }),
    policy('T1', { scope: 'project', targetRoot: join(f.base, 'other') })]);
  const rules = loadSharedModelRules(f);
  const own = sharedModelRulesForProject(rules, f.root);
  assert.equal(own.length, 1);
  assert.equal(own[0].budget.calls, 3);
  assert.equal(own[0].scope, 'project');
  const elsewhere = sharedModelRulesForProject(rules, join(f.base, 'elsewhere'));
  assert.equal(elsewhere.length, 1);
  assert.equal(elsewhere[0].scope, 'global');
});

test('sharing needs explicit provider and parent-specific tier mappings and honors opt-out', (t) => {
  const f = fixture(t);
  const query = { ...f.opts, model: 'parent-model', provider: 'gateway' };
  assert.equal(sharedCodexModelRules(query).length, 2);
  for (const patch of [{ cfg: {} }, { provider: 'other' }, { model: 'other' },
    { cfg: { codex: { sharedRules: { enabled: false, targets: [target()] } } } }]) {
    assert.deepEqual(sharedCodexModelRules({ ...query, ...patch }), []);
  }
  assert.deepEqual(codexSharedTargets({ codex: { sharedRules: { targets: [null, {}, target('T0'),
    target('T2', { model: 'parent-model' }), target('T2', { model: 'bad model' }), target('T2', { effort: 'invalid' })] } } }), []);
});

test('shared prompt hint offers both mapped tiers with caps, isolated context and one prompt route each', (t) => {
  const f = fixture(t);
  const hint = codexRouteHint(f.payload, f.opts);
  assert.match(hint, /approved shared explore policy/);
  assert.match(hint, /user approved this policy and its model mapping/);
  assert.match(hint, /T2: model small-model, reasoning_effort high/);
  assert.match(hint, /T1: model medium-model/);
  assert.match(hint, /8 tool calls \/ 1500 output tokens/);
  assert.match(hint, /8000 output tokens/);
  assert.match(hint, /fork_turns "none"/);
  assert.match(hint, /at most one/);
  assert.match(hint, /120000/);
  assert.match(hint, /required tier is not mapped, keep the task on the main agent/);
  // One prompt route per offered tier: SubagentStart binds whichever model the
  // child runs, and the next prompt closes the other (codex-delegation-bind.test.js).
  assert.deepEqual(f.recorded.map((r) => [r.tier, r.to, r.via, r.source, r.parentSessionId]),
    [['T2', 'small-model', 'prompt', 'shared', 'parent'], ['T1', 'medium-model', 'prompt', 'shared', 'parent']]);
  for (const r of f.recorded) {
    assert.ok(hint.includes(`<!-- sprag:codex:route id=${r.id} -->`));
    assert.equal(r.sharedSignature, `${r.tier}|explore|original-project`);
  }
});

test('shared prompt gate stays silent below context threshold and on unsafe requests', (t) => {
  const f = fixture(t);
  assert.equal(codexRouteHint(f.payload, { ...f.opts, contextTokens: 59999 }), null);
  for (const prompt of ['Find and fix the parser', 'Find and deploy the package', 'Compare architectures', 'yes']) {
    assert.equal(codexRouteHint({ ...f.payload, prompt }, f.opts), null);
  }
  assert.equal(f.recorded.length, 0);
});

test('source deletion and opt-out stop routing without stale copied rules or lost native overrides', (t) => {
  const f = fixture(t);
  assert.ok(codexRouteHint(f.payload, f.opts));
  f.save([]);
  assert.equal(codexRouteHint(f.payload, f.opts), null);
  f.save([policy()]);
  const rules = [{ status: 'active', category: 'explore', from: 'parent-model', model: 'native-target',
    provider: 'gateway', scope: 'global', targetRoot: null }];
  const hint = codexRouteHint(f.payload, { ...f.opts, rules });
  assert.match(hint, /native-target/);
  assert.doesNotMatch(hint, /shared|small-model/);
});

test('shared PreToolUse denies a spawn without a model, never guesses a tier or applies the default, and keeps explicit models/custom roles', (t) => {
  const f = fixture(t);
  f.cfg.codex.delegateTarget = { model: 'default-target' };
  const p = { ...f.payload, tool_name: 'spawn_agent', tool_input: { message: f.payload.prompt, agent_type: 'explorer' } };
  const denied = codexDelegationTool(p, f.opts).hookSpecificOutput;
  assert.equal(denied.permissionDecision, 'deny');
  assert.equal(denied.updatedInput, undefined);
  assert.match(denied.permissionDecisionReason, /fork_turns "none"/);
  assert.match(denied.permissionDecisionReason, /user approved this policy/);
  assert.match(denied.permissionDecisionReason, /T2: model small-model, reasoning_effort high/);
  assert.match(denied.permissionDecisionReason, /T1: model medium-model/);
  assert.match(denied.permissionDecisionReason, /keeping the route line/);
  assert.doesNotMatch(denied.permissionDecisionReason, /default-target/);
  // A spawn that names a model keeps it, and the route line from the hint stays
  // in the message so the ledger can join the child to its tier.
  const line = '<!-- sprag:codex:route id=0123456789abcdef -->';
  const explicit = codexDelegationTool({ ...p, tool_input: { ...p.tool_input, model: 'small-model',
    message: `${f.payload.prompt}\n${line}` } }, f.opts).hookSpecificOutput;
  assert.equal(explicit.permissionDecision, 'allow');
  assert.equal(explicit.updatedInput.model, 'small-model');
  assert.ok(explicit.updatedInput.message.includes(line));
  assert.equal(codexDelegationTool({ ...p, tool_input: { ...p.tool_input, agent_type: 'custom' } }, f.opts), null);
  assert.equal(f.recorded.length, 0);
});

test('project policies match either agent root of the working directory and its symlinked path', (t) => {
  const f = fixture(t);
  // CLAUDE.md alone makes pkg Claude's root, while Codex walks on to the .git root.
  const pkg = join(f.root, 'pkg');
  mkdirSync(pkg);
  writeFileSync(join(pkg, 'CLAUDE.md'), '');
  f.save([policy('T2', { scope: 'project', targetRoot: pkg })]);
  assert.match(codexRouteHint({ ...f.payload, cwd: pkg }, f.opts), /T2: model small-model/);
  assert.equal(codexRouteHint(f.payload, f.opts), null);
  const link = join(f.base, 'link');
  // A junction needs no privilege on Windows; POSIX ignores the type.
  symlinkSync(f.root, link, 'junction');
  f.save([policy('T2', { scope: 'project', targetRoot: f.root })]);
  assert.match(codexRouteHint({ ...f.payload, cwd: link }, { ...f.opts, root: link }), /T2: model small-model/);
  assert.equal(sharedModelRulesForProject(loadSharedModelRules(f), link).length, 1);
});

test('CLI exposes unmapped policies and validates mappings before any writes', (t) => {
  const f = fixture(t);
  const config = join(f.dir, 'config.json');
  const result = f.run(['delegate', 'rules']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Shared delegation policies: 2/);
  assert.match(result.stdout, /Unmapped tiers/);
  assert.equal(existsSync(config), false);
  for (const args of [
    ['map', 'T2'], ['map', 'T0', '--from', 'parent-model', '--model', 'child'],
    ['map', 'T2', '--from', 'parent-model', '--model', 'parent-model'],
    ['map', 'T2', '--from', 'parent-model', '--model', 'child', '--effort'],
    ['map', 'T2', '--from', 'parent-model', '--model', 'child', '--effort', 'invalid'],
    ['map', 'T2', '--from', 'parent-model', '--model', 'child', '--provider', 'bad provider'],
    ['map', 'T2', '--from', 'parent-model', '--model', 'child', '--global'],
    ['status', '--model', 'child'], ['unmap', 'T2', '--from', 'parent-model'],
  ]) {
    assert.notEqual(f.run(['delegate', 'shared', ...args]).status, 0, args.join(' '));
    assert.equal(existsSync(config), false);
    assert.equal(existsSync(join(f.home, 'hooks.json')), false);
  }
});

test('CLI maps once for all categories, replaces idempotently, and never touches Claude config or statistics', (t) => {
  const f = fixture(t);
  f.save([policy(), policy('T2', { category: 'read', signature: 'T2|read|preset' })]);
  const original = readFileSync(f.file, 'utf8');
  const config = join(f.dir, 'config.json');
  writeFileSync(config, JSON.stringify({ delegate: { enabled: true }, language: 'ko' }));
  const map = ['delegate', 'shared', 'map', 'T2', '--from', 'parent-model', '--model', 'small-model'];
  for (let i = 0; i < 2; i++) assert.equal(f.run(map).status, 0);
  const saved = JSON.parse(readFileSync(config, 'utf8'));
  assert.equal(saved.codex.sharedRules.targets.length, 1);
  assert.equal(saved.delegate.enabled, true);
  assert.equal(saved.language, 'ko');
  assert.equal(saved.codex.delegate, undefined);
  assert.equal(f.run(['delegate', 'shared', 'off']).status, 0);
  assert.equal(JSON.parse(readFileSync(config, 'utf8')).codex.sharedRules.enabled, false);
  assert.equal(f.run(['delegate', 'shared', 'on']).status, 0);
  assert.equal(f.run(['delegate', 'shared', 'unmap', 'T2', '--from', 'parent-model']).status, 0);
  assert.equal(JSON.parse(readFileSync(config, 'utf8')).codex.sharedRules.targets.length, 0);
  assert.equal(readFileSync(f.file, 'utf8'), original);
  assert.equal(existsSync(join(f.dir, 'codex-model-rules.json')), false);
});

test('CLI prompt hook reads real context, emits shared routes, and respects delegate off', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.dir, 'config.json'), JSON.stringify({ ...f.cfg, codex: { ...f.cfg.codex, brief: false } }));
  const transcript_path = join(f.base, 'rollout.jsonl');
  writeFileSync(transcript_path, JSON.stringify({ type: 'event_msg', payload: { type: 'token_count',
    info: { last_token_usage: { input_tokens: 60000 } } } }) + '\n');
  const p = { ...f.payload, transcript_path };
  const result = f.run(['codex-hook', '--event', 'prompt'], p);
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /approved shared explore policy/);
  const pending = readFileSync(join(f.dir, 'codex-delegations.jsonl'), 'utf8');
  const routes = pending.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(routes.map((r) => [r.tier, r.to, r.via]), [['T2', 'small-model', 'prompt'], ['T1', 'medium-model', 'prompt']]);
  for (const r of routes) assert.ok(context.includes(`<!-- sprag:codex:route id=${r.id} -->`));
  assert.equal(f.run(['delegate', 'off']).status, 0);
  assert.equal(f.run(['codex-hook', '--event', 'prompt'], p).stdout, '');
  assert.equal(readFileSync(join(f.dir, 'codex-delegations.jsonl'), 'utf8'), pending);
});

test('Codex-first user can approve bundled policies, map a model and route without Claude files or history', (t) => {
  const f = fixture(t);
  rmSync(f.file);
  assert.match(f.run(['delegate', 'shared', 'status']).stdout, /First use: sprag seed/);
  const listing = f.run(['seed']);
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /\[explore-t2\]/);
  assert.doesNotMatch(listing.stdout, /haiku-explore|model: haiku|model: sonnet/);
  const accepted = f.run(['seed', 'accept', 'explore-t2', '--global']);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.doesNotMatch(accepted.stdout, /haiku|sonnet/);
  const stored = JSON.parse(readFileSync(f.file, 'utf8')).rules;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].approvedBy, 'codex');
  assert.equal(stored[0].count, 0);
  assert.equal(existsSync(join(f.base, '.claude')), false);
  assert.doesNotMatch(f.run(['seed']).stdout, /\[explore-t2\]/);
  assert.equal(f.run(['delegate', 'shared', 'map', 'T2', '--from', 'parent-model', '--model', 'small-model']).status, 0);
  assert.equal(f.run(['delegate', 'on']).status, 0);
  const cfg = JSON.parse(readFileSync(join(f.dir, 'config.json'), 'utf8'));
  assert.match(codexRouteHint(f.payload, { ...f.opts, cfg }), /T2: model small-model/);
  assert.equal(existsSync(join(f.base, '.claude')), false);

  // Starting Claude later sees the same approved policy, not a second offer.
  assert.doesNotMatch(f.run(['seed'], undefined, { agent: 'claude' }).stdout, /\[explore-t2\]/);
  const module = new URL('../src/model-rules.js', import.meta.url).href;
  const render = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(module)}); m.syncAllFiles(); console.log(String(m.loadModelRules().rules.length));`],
  { cwd: f.root, env: childEnv({ HOME: f.base, XDG_CONFIG_HOME: join(f.base, 'state') }), encoding: 'utf8', timeout: 10000 });
  assert.equal(render.status, 0, render.stderr);
  assert.equal(render.stdout.trim(), '1');
  const markdown = readFileSync(join(f.base, '.claude', 'ratchet-model.md'), 'utf8');
  assert.match(markdown, /model: haiku/);
  assert.doesNotMatch(markdown, /small-model|parent-model/);
  assert.equal(JSON.parse(readFileSync(f.file, 'utf8')).rules.length, 1);
});

test('Codex project seed acceptance does not suppress another project or overwrite its policy', (t) => {
  const f = fixture(t);
  f.save([]);
  const other = join(f.base, 'other');
  mkdirSync(join(other, '.git'), { recursive: true });
  assert.notEqual(f.run(['seed', 'accept', 'read-t2']).status, 0);
  assert.equal(f.run(['seed', 'accept', 'read-t2', '--project']).status, 0);
  assert.doesNotMatch(f.run(['seed']).stdout, /\[read-t2\]/);
  assert.match(f.run(['seed'], undefined, { cwd: other }).stdout, /\[read-t2\]/);
  assert.equal(f.run(['seed', 'accept', 'read-t2', '--project'], undefined, { cwd: other }).status, 0);
  const stored = JSON.parse(readFileSync(f.file, 'utf8')).rules;
  assert.equal(stored.length, 2);
  assert.deepEqual(new Set(stored.map((r) => realpathSync(r.targetRoot))), new Set([f.root, other].map((p) => realpathSync(p))));
  assert.equal(existsSync(join(f.base, '.claude')), false);
});

test('Codex seed neither reactivates review/off policies nor overwrites a corrupt shared registry', (t) => {
  const f = fixture(t);
  f.save([policy('T2', { status: 'review' }), policy('T1', { status: 'off' })]);
  const original = readFileSync(f.file, 'utf8');
  assert.doesNotMatch(f.run(['seed']).stdout, /\[explore-t[12]\]/);
  assert.equal(f.run(['seed', 'accept', 'explore-t2', '--global']).status, 0);
  assert.equal(readFileSync(f.file, 'utf8'), original);
  writeFileSync(f.file, '{broken');
  assert.notEqual(f.run(['seed', 'accept', 'read-t2', '--global']).status, 0);
  assert.equal(readFileSync(f.file, 'utf8'), '{broken');
  assert.equal(existsSync(join(f.dir, 'codex-seed-state.json')), false);
});

test('Claude seed keeps legacy project answers decided and scopes new answers to their project', (t) => {
  const f = fixture(t);
  f.save([]);
  const state = join(f.dir, 'seed-state.json');
  writeFileSync(state, JSON.stringify({ decided: {
    // Recorded before decisions kept targetRoot; the project it named is unknown.
    'read-t2': { action: 'accepted', at: '2026-09-01', scope: 'project' },
    'run-t2': { action: 'accepted', at: '2026-10-01', scope: 'project', targetRoot: join(f.base, 'other') },
  } }));
  const listing = f.run(['seed'], undefined, { agent: 'claude' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.doesNotMatch(listing.stdout, /\[read-t2\]/);
  assert.match(listing.stdout, /\[run-t2\]/);
  writeFileSync(state, JSON.stringify({ decided: {
    'run-t2': { action: 'accepted', at: '2026-10-01', scope: 'project', targetRoot: f.root } } }));
  assert.doesNotMatch(f.run(['seed'], undefined, { agent: 'claude' }).stdout, /\[run-t2\]/);
});

test('status checks mappings for the configured parent model, and the context gate is shown and set by CLI', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.home, 'config.toml'), 'model_provider="gateway"\nmodel="parent-model"\n');
  const config = join(f.dir, 'config.json');
  assert.equal(f.run(['delegate', 'shared', 'map', 'T2', '--from', 'other-parent', '--model', 'small-model']).status, 0);
  let out = f.run(['delegate', 'shared', 'status']).stdout;
  assert.match(out, /Unmapped tiers for parent-model on gateway: T1, T2\./);
  assert.match(out, /--from parent-model --model/);
  assert.match(out, /starts at 60000 parent input tokens \(default\)/);
  assert.equal(f.run(['delegate', 'shared', 'map', 'T2', '--from', 'parent-model', '--model', 'small-model']).status, 0);
  assert.match(f.run(['delegate', 'shared', 'status']).stdout, /Unmapped tiers for parent-model on gateway: T1\./);

  assert.equal(f.run(['delegate', 'shared', 'min-context', '30000']).status, 0);
  assert.equal(JSON.parse(readFileSync(config, 'utf8')).codex.delegateMinContext, 30000);
  assert.match(f.run(['delegate', 'shared', 'status']).stdout, /starts at 30000 parent input tokens\. /);
  const before = readFileSync(config, 'utf8');
  for (const bad of [[], ['-5'], ['1.5'], ['abc'], ['30000', '--model', 'x']]) {
    assert.notEqual(f.run(['delegate', 'shared', 'min-context', ...bad]).status, 0, bad.join(' '));
    assert.equal(readFileSync(config, 'utf8'), before);
  }
  const cfg = JSON.parse(before);
  assert.ok(codexRouteHint(f.payload, { ...f.opts, cfg, contextTokens: 30000 }));
  assert.equal(codexRouteHint(f.payload, { ...f.opts, contextTokens: 30000 }), null);
  assert.equal(f.run(['delegate', 'shared', 'min-context', 'default']).status, 0);
  assert.equal('delegateMinContext' in JSON.parse(readFileSync(config, 'utf8')).codex, false);
});

test('Claude routes a project rule only inside its project, so a Codex project approval does not leak', (t) => {
  const f = fixture(t);
  const other = join(f.base, 'other');
  mkdirSync(join(other, '.git'), { recursive: true });
  const rule = { category: 'explore', tier: 'T2', agent: 'haiku-explore', scope: 'project', targetRoot: f.root, approvedBy: 'codex' };
  assert.ok(routeMatch('Find the parser files', { rules: [rule], root: f.root }));
  assert.equal(routeMatch('Find the parser files', { rules: [rule], root: other }), null);
  assert.equal(routeMatch('Find the parser files', { rules: [rule] }), null, 'an unknown directory gets global rules only');
  assert.ok(routeMatch('Find the parser files', { rules: [{ ...rule, scope: 'global', targetRoot: null }], root: other }));
});

test('in a nested project the inner root states the cap, whatever order the registry holds', (t) => {
  const f = fixture(t);
  // CLAUDE.md alone makes pkg Claude's root, while the .git root is Codex's.
  const pkg = join(f.root, 'pkg');
  mkdirSync(pkg);
  writeFileSync(join(pkg, 'CLAUDE.md'), '');
  const inner = policy('T2', { scope: 'project', targetRoot: pkg, budget: { calls: 1, out: 100 } });
  const outer = policy('T2', { scope: 'project', targetRoot: f.root, budget: { calls: 8, out: 1500 } });
  const global = policy('T2', { budget: { calls: 5, out: 900 } });
  for (const order of [[inner, outer, global], [global, outer, inner], [outer, global, inner]]) {
    f.save(order);
    const [chosen] = sharedModelRulesForProject(loadSharedModelRules(f), pkg);
    assert.deepEqual(chosen.budget, { calls: 1, out: 100 });
    const match = routeMatch('Find the parser files', { rules: order, root: pkg });
    assert.deepEqual(match.t2.budget, { calls: 1, out: 100 });
  }
});
