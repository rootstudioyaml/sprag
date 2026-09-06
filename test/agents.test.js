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
import { agentExists, agentPhrase, agentPhraseEn } from '../src/agents.js';

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

test('user-level agent file is named alongside its tier', (t) => {
  const home = isolatedHome(t);
  const root = mkdtempSync(join(tmpdir(), 'cts-proj-'));
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(home, '.claude', 'agents', 'haiku-runner.md'), '---\nmodel: haiku\n---\n');
  assert.strictEqual(agentPhrase('haiku-runner', { root }), 'haiku-runner(model: haiku)');
  assert.strictEqual(agentPhraseEn('haiku-runner', { root }), 'the haiku-runner (model: haiku) subagent');
});

test('project-level agent counts too', (t) => {
  isolatedHome(t);
  const root = mkdtempSync(join(tmpdir(), 'cts-proj-'));
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(root, '.claude', 'agents', 'sonnet-worker.md'), '---\nmodel: sonnet\n---\n');
  assert.strictEqual(agentPhrase('sonnet-worker', { root }), 'sonnet-worker(model: sonnet)');
  // Unknown agent name defaults to the haiku tier unless told otherwise.
  assert.strictEqual(agentPhrase('mystery', { root }), 'model: haiku');
  assert.strictEqual(agentPhrase('mystery', { root, model: 'sonnet' }), 'model: sonnet');
});
