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
import { agentExists, agentPhrase, agentPhraseEn, agentForRule, TIER_MODEL } from '../src/agents.js';

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
  assert.strictEqual(agentExists('haiku-explore', root), false);
  assert.strictEqual(agentPhrase('haiku-explore', { root }), 'model: haiku');
  assert.strictEqual(agentPhraseEn('haiku-explore', { root }), 'a model: haiku subagent');
});

test('user-level agent file is named, and the model argument left to its definition', (t) => {
  const home = isolatedHome(t);
  const root = mkdtempSync(join(tmpdir(), 'cts-proj-'));
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(home, '.claude', 'agents', 'haiku-runner.md'), '---\nmodel: haiku\n---\n');
  // The agent's definition holds its model; passing a `model` argument would
  // override a definition pinned to a full id with the bare alias.
  assert.strictEqual(agentPhrase('haiku-runner', { root }), 'haiku-runner(model 인자 생략. 이 에이전트가 없거나 MCP 도구가 필요하면 general-purpose에 model: haiku)');
  assert.strictEqual(agentPhraseEn('haiku-runner', { root }), 'the haiku-runner subagent (omit the model argument; if it is unavailable or MCP tools are needed, use general-purpose with model: haiku)');
});

test('project-level agent counts too', (t) => {
  isolatedHome(t);
  const root = mkdtempSync(join(tmpdir(), 'cts-proj-'));
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(root, '.claude', 'agents', 'sonnet-worker.md'), '---\nmodel: sonnet\n---\n');
  assert.strictEqual(agentPhrase('sonnet-worker', { root }), 'sonnet-worker(model 인자 생략. 이 에이전트가 없거나 MCP 도구가 필요하면 general-purpose에 model: sonnet)');
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
  assert.strictEqual(agentForRule({ tier: 'T2', category: 'run', agent: 'haiku-runner' }, { agents }), 'haiku-runner');
  assert.strictEqual(agentForRule({ tier: 'T2', category: 'run', agent: '' }, { agents }), 'cheap-run');
  // no agent serves the tier
  assert.strictEqual(agentForRule({ tier: 'T1H', category: 'run' }, { agents }), null);
  assert.strictEqual(agentForRule({ tier: 'T2', category: 'run' }, { agents: [{ name: 'legacy', tier: null, categories: [] }] }), null);
});

test('agentForRule over the bundled agents keeps today\'s names', () => {
  assert.strictEqual(agentForRule({ tier: 'T2', category: 'run' }), 'haiku-runner');
  for (const c of ['explore', 'read', 'check', 'paste']) assert.strictEqual(agentForRule({ tier: 'T2', category: c }), 'haiku-explore');
  assert.strictEqual(agentForRule({ tier: 'T2', category: 'translate' }), 'haiku-translate');
  assert.strictEqual(agentForRule({ tier: 'T1', category: 'run' }), 'sonnet-worker');
  assert.strictEqual(agentForRule({ tier: 'T1H', category: 'read' }), 'opus-worker');
});

test('TIER_MODEL turns a tier into its bare model alias', () => {
  assert.deepStrictEqual(TIER_MODEL, { T2: 'haiku', T1: 'sonnet', T1H: 'opus' });
});
