/**
 * Generated rules must not point at a subagent that does not exist on this
 * machine — the preset agents live in the user's own ~/.claude/agents and are
 * not shipped by this package. Name the agent only when the file is there;
 * otherwise fall back to the universal `model: <tier>` phrasing.
 */
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentExists, agentPhrase, agentPhraseEn, agentForRule, resolveAgentName, LEGACY_AGENT_NAMES, TIER_MODEL } from '../src/agents.js';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function isolatedHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'cts-home-'));
  const prev = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  // os.homedir() reads USERPROFILE on Windows, so setting HOME alone leaves
  // the test pointed at the real home directory there.
  process.env.USERPROFILE = home;
  t.after(() => {
    process.env.HOME = prev;
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
  });
  return home;
}

test('missing agent falls back to the model tier', (t) => {
  isolatedHome(t);
  const root = mkdtempSync(join(tmpdir(), 'cts-proj-'));
  assert.strictEqual(agentExists('t2-explore', root), false);
  assert.strictEqual(agentPhrase('t2-explore', { root }), 'model: haiku');
  assert.strictEqual(agentPhraseEn('t2-explore', { root }), 'a model: haiku subagent');
});

test('user-level agent file is named, and the model argument left to its definition', (t) => {
  const home = isolatedHome(t);
  const root = mkdtempSync(join(tmpdir(), 'cts-proj-'));
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(home, '.claude', 'agents', 't2-runner.md'), '---\nmodel: haiku\n---\n');
  // The agent's definition holds its model; passing a `model` argument would
  // override a definition pinned to a full id with the bare alias.
  assert.strictEqual(agentPhrase('t2-runner', { root }), 't2-runner(model 인자 생략. 이 에이전트가 없거나 MCP 도구가 필요하면 general-purpose에 model: haiku)');
  assert.strictEqual(agentPhraseEn('t2-runner', { root }), 'the t2-runner subagent (omit the model argument; if it is unavailable or MCP tools are needed, use general-purpose with model: haiku)');
});

test('project-level agent counts too', (t) => {
  isolatedHome(t);
  const root = mkdtempSync(join(tmpdir(), 'cts-proj-'));
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(root, '.claude', 'agents', 't1-worker.md'), '---\nmodel: sonnet\n---\n');
  assert.strictEqual(agentPhrase('t1-worker', { root }), 't1-worker(model 인자 생략. 이 에이전트가 없거나 MCP 도구가 필요하면 general-purpose에 model: sonnet)');
  // Unknown agent name defaults to the haiku tier unless told otherwise.
  assert.strictEqual(agentPhrase('mystery', { root }), 'model: haiku');
  assert.strictEqual(agentPhrase('mystery', { root, model: 'sonnet' }), 'model: sonnet');
});

test('agentForRule: a rule names its tier, the agents say which categories they serve', () => {
  const agents = [
    { name: 'cheap-look', tier: 'T2', categories: ['explore', 'read'] },
    { name: 'cheap-run', tier: 'T2', categories: ['run'] },
    { name: 'cheap-any', tier: 'T2', categories: ['*'] },
    { name: 'worker', tier: 'T1', categories: ['*'] },
    { name: 'legacy', tier: null, categories: [] },
  ];
  // the category match wins over an earlier "*" of the same tier
  assert.strictEqual(agentForRule({ tier: 'T2', category: 'run' }, { agents }), 'cheap-run');
  assert.strictEqual(agentForRule({ tier: 'T2', category: 'read' }, { agents }), 'cheap-look');
  // no agent names the category: the first "*" agent of the tier
  assert.strictEqual(agentForRule({ tier: 'T2', category: 'translate' }, { agents }), 'cheap-any');
  assert.strictEqual(agentForRule({ tier: 'T1', category: 'run' }, { agents }), 'worker');
  // a legacy rule's agent is an override
  assert.strictEqual(agentForRule({ tier: 'T2', category: 'run', agent: 't2-runner' }, { agents }), 't2-runner');
  assert.strictEqual(agentForRule({ tier: 'T2', category: 'run', agent: '' }, { agents }), 'cheap-run');
  // no agent serves the tier
  assert.strictEqual(agentForRule({ tier: 'T1H', category: 'run' }, { agents }), null);
  assert.strictEqual(agentForRule({ tier: 'T2', category: 'run' }, { agents: [{ name: 'legacy', tier: null, categories: [] }] }), null);
});

test('agentForRule over the bundled agents keeps today\'s names', () => {
  assert.strictEqual(agentForRule({ tier: 'T2', category: 'run' }), 't2-runner');
  for (const c of ['explore', 'read', 'check', 'paste']) assert.strictEqual(agentForRule({ tier: 'T2', category: c }), 't2-explore');
  assert.strictEqual(agentForRule({ tier: 'T2', category: 'translate' }), 't2-translate');
  assert.strictEqual(agentForRule({ tier: 'T1', category: 'run' }), 't1-worker');
  assert.strictEqual(agentForRule({ tier: 'T1H', category: 'read' }), 't1h-worker');
});

test('TIER_MODEL turns a tier into its bare model alias', () => {
  assert.deepStrictEqual(TIER_MODEL, { T2: 'haiku', T1: 'sonnet', T1H: 'opus' });
});

test('LEGACY_AGENT_NAMES maps every model-named agent to its tier-named successor', () => {
  assert.deepStrictEqual(LEGACY_AGENT_NAMES, {
    'haiku-explore': 't2-explore',
    'haiku-runner': 't2-runner',
    'haiku-translate': 't2-translate',
    'sonnet-worker': 't1-worker',
    'opus-worker': 't1h-worker',
  });
});

test('agentForRule: a legacy rule.agent resolves to the new name, other names pass through', () => {
  for (const [old, now] of Object.entries(LEGACY_AGENT_NAMES)) {
    assert.strictEqual(agentForRule({ agent: old, tier: 'T2', category: 'run' }), now);
  }
  assert.strictEqual(agentForRule({ agent: 'my-own-agent', tier: 'T2', category: 'run' }), 'my-own-agent');
  assert.strictEqual(agentForRule({ agent: 'sonnet', tier: 'T1' }), 'sonnet');
});

test('resolveAgentName maps a legacy name to the new file, and falls back to an installed legacy file', (t) => {
  const home = isolatedHome(t);
  const root = mkdtempSync(join(tmpdir(), 'cts-proj-'));
  const dir = join(home, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  assert.strictEqual(resolveAgentName('haiku-runner', root), null);
  // Only the legacy file is installed (a user-edited copy sprag never removed).
  writeFileSync(join(dir, 'haiku-runner.md'), '---\nmodel: haiku\n---\n');
  assert.strictEqual(resolveAgentName('haiku-runner', root), 'haiku-runner');
  assert.strictEqual(agentPhrase('haiku-runner', { root }), 'haiku-runner(model 인자 생략. 이 에이전트가 없거나 MCP 도구가 필요하면 general-purpose에 model: haiku)');
  writeFileSync(join(dir, 'sonnet-worker.md'), '---\nmodel: sonnet\n---\n');
  assert.match(agentPhrase('sonnet-worker', { root }), /model: sonnet\)$/);
  // The new file wins as soon as it exists.
  writeFileSync(join(dir, 't2-runner.md'), '---\nmodel: haiku\n---\n');
  assert.strictEqual(resolveAgentName('haiku-runner', root), 't2-runner');
  assert.strictEqual(resolveAgentName('t2-runner', root), 't2-runner');
});

test('presets/agents.json names the agent by tier, never by model', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const { agents } = JSON.parse(readFileSync(join(here, '..', 'presets', 'agents.json'), 'utf8'));
  assert.strictEqual(agents.length, 5);
  for (const a of agents) assert.match(a.name, /^t(1h|1|2)-[a-z]+$/, a.name);
  for (const a of agents) assert.ok(!/needs general-purpose/.test(JSON.stringify(a.body)), `${a.name} body is tool-neutral`);
});
