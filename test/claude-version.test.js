/**
 * Claude Code version from AI_AGENT, and the first-install notice built on it.
 * A pure function test: nothing here spawns the CLI or the claude binary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionClaudeVersion, agentsLoadMidSession, AGENTS_LIVE_MIN_VERSION } from '../src/claude-version.js';
import { firstInstallNotice } from '../src/delegation-agents.js';

test('sessionClaudeVersion reads the hook and tool spellings of AI_AGENT', () => {
  assert.equal(sessionClaudeVersion({ AI_AGENT: 'claude-code_2-1-319_harness' }), '2.1.319');
  assert.equal(sessionClaudeVersion({ AI_AGENT: 'claude-code_2-1-319_agent' }), '2.1.319');
  assert.equal(sessionClaudeVersion({ AI_AGENT: 'claude-code_2-1-319' }), '2.1.319');
  assert.equal(sessionClaudeVersion({ AI_AGENT: '' }), null);
  assert.equal(sessionClaudeVersion({}), null);
  assert.equal(sessionClaudeVersion({ AI_AGENT: 'codex_1-2-3' }), null);
  assert.equal(sessionClaudeVersion({ AI_AGENT: 'claude-code_2-1' }), null);
});

test('agentsLoadMidSession: true from 2.1.326, false before, null when unknown', () => {
  assert.equal(AGENTS_LIVE_MIN_VERSION, '2.1.326');
  assert.equal(agentsLoadMidSession('2.1.326'), true);
  assert.equal(agentsLoadMidSession('2.1.330'), true);
  assert.equal(agentsLoadMidSession('2.2.0'), true);
  assert.equal(agentsLoadMidSession('3.0.0'), true);
  assert.equal(agentsLoadMidSession('2.1.325'), false);
  assert.equal(agentsLoadMidSession('2.0.999'), false);
  assert.equal(agentsLoadMidSession(null), null);
  assert.equal(agentsLoadMidSession(undefined), null);
});

const created = { written: ['t2-runner', 't1-worker'], unchanged: [], skipped: [], removed: [], createdDir: true };

test('firstInstallNotice: silent unless the folder was just created and the version is not known to be new', () => {
  const old = { AI_AGENT: 'claude-code_2-1-319_harness' };
  const fresh = { AI_AGENT: 'claude-code_2-1-326_harness' };
  assert.equal(firstInstallNotice({ ...created, createdDir: false }, { env: old }), null);
  assert.equal(firstInstallNotice({ ...created, written: [] }, { env: old }), null);
  assert.equal(firstInstallNotice(null, { env: old }), null);
  assert.equal(firstInstallNotice(created, { env: fresh }), null);
  for (const env of [old, {}]) {
    const ko = firstInstallNotice(created, { env });
    assert.match(ko, /^✇ \[sprag agents\] .*2개\(t2-runner, t1-worker\)/);
    assert.match(ko, /general-purpose/);
    const en = firstInstallNotice(created, { env, lang: 'en' });
    assert.match(en, /installed 2 delegation-only agent\(s\) for the first time \(t2-runner, t1-worker\)/);
    assert.match(en, /general-purpose/);
  }
});
