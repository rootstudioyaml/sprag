/**
 * delegate — decideForDelegation() rewrites a Task/Agent PreToolUse call's
 * prompt; formatHookOutput() renders that decision as the PreToolUse JSON
 * Claude Code expects on stdout.
 *
 * cfg is injected directly wherever that avoids touching the real
 * ~/.claude config, the way cohesion.test.js does. buildAppendix() still
 * reads two real files (bounds.md, and — through korean-style.js — the
 * Korean preset) because those ship inside this package; that part is not
 * worth mocking.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decideForDelegation, formatHookOutput } from '../src/delegation-guard.js';

const DELEGATION_MARKER = '<!-- sprag:delegation -->';
const ON = { delegate: { enabled: true } };

test('decideForDelegation: disabled config returns null', async () => {
  const payload = { tool_name: 'Task', tool_input: { prompt: 'do the thing' } };
  assert.equal(await decideForDelegation(payload, { cfg: {} }), null);
  assert.equal(await decideForDelegation(payload, { cfg: { delegate: { enabled: false } } }), null);
});

test('decideForDelegation: a tool_name other than Task/Agent returns null', async () => {
  const payload = { tool_name: 'Bash', tool_input: { prompt: 'do the thing' } };
  assert.equal(await decideForDelegation(payload, { cfg: ON }), null);
});

test('decideForDelegation: no usable prompt returns null', async () => {
  assert.equal(await decideForDelegation({ tool_name: 'Task', tool_input: {} }, { cfg: ON }), null);
  assert.equal(await decideForDelegation({ tool_name: 'Task', tool_input: { prompt: '' } }, { cfg: ON }), null);
  assert.equal(await decideForDelegation({ tool_name: 'Agent' }, { cfg: ON }), null);
});

test('decideForDelegation: a prompt that already carries the marker is left alone (idempotent)', async () => {
  const payload = {
    tool_name: 'Task',
    tool_input: { prompt: `already rewritten\n\n${DELEGATION_MARKER}\nsome appendix` },
  };
  assert.equal(await decideForDelegation(payload, { cfg: ON }), null);
});

test('decideForDelegation: updatedInput keeps every other tool_input key untouched', async () => {
  const payload = {
    tool_name: 'Task',
    tool_input: {
      prompt: 'Investigate the failing build',
      subagent_type: 'general-purpose',
      model: 'sonnet',
      description: 'build triage',
    },
  };
  const decision = await decideForDelegation(payload, { cfg: ON });
  assert.ok(decision, 'bounds.md ships with the package, so a decision is always produced when enabled');
  assert.equal(decision.updatedInput.subagent_type, 'general-purpose');
  assert.equal(decision.updatedInput.model, 'sonnet');
  assert.equal(decision.updatedInput.description, 'build triage');
  assert.ok(decision.updatedInput.prompt.startsWith('Investigate the failing build'));
  assert.ok(decision.updatedInput.prompt.includes(DELEGATION_MARKER));
});

test('decideForDelegation: an English-only prompt never gets the Korean guidance block, even with it turned on', async () => {
  const payload = { tool_name: 'Task', tool_input: { prompt: 'Investigate the failing build, no Korean here' } };
  const cfg = { delegate: { enabled: true }, koreanStyle: { enabled: true } };
  const decision = await decideForDelegation(payload, { cfg });
  assert.ok(decision);
  assert.doesNotMatch(decision.updatedInput.prompt, /\[sprag korean-style\]/);
});

test('decideForDelegation: the tool-call cap depends on whether haiku is the target', async () => {
  const haikuByModel = await decideForDelegation(
    { tool_name: 'Task', tool_input: { prompt: 'summarize this file', model: 'claude-haiku-4-5' } },
    { cfg: ON },
  );
  assert.match(haikuByModel.updatedInput.prompt, /Cap for this delegation: 8 tool calls, 1,500 output tokens\./);

  const haikuBySubagentType = await decideForDelegation(
    { tool_name: 'Task', tool_input: { prompt: 'summarize this file', subagent_type: 'haiku' } },
    { cfg: ON },
  );
  assert.match(haikuBySubagentType.updatedInput.prompt, /Cap for this delegation: 8 tool calls, 1,500 output tokens\./);

  const nonHaiku = await decideForDelegation(
    { tool_name: 'Task', tool_input: { prompt: 'summarize this file', model: 'sonnet' } },
    { cfg: ON },
  );
  assert.match(nonHaiku.updatedInput.prompt, /Cap for this delegation: 20 tool calls, 8,000 output tokens\./);
});

test('formatHookOutput: null in, null out; otherwise fixes hookEventName and permissionDecision', () => {
  assert.equal(formatHookOutput(null), null);
  assert.equal(formatHookOutput(undefined), null);

  const rendered = formatHookOutput({ updatedInput: { prompt: 'x', model: 'sonnet' } });
  const parsed = JSON.parse(rendered);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'allow');
  assert.deepEqual(parsed.hookSpecificOutput.updatedInput, { prompt: 'x', model: 'sonnet' });
});
