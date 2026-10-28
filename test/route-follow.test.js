/**
 * The follow-up after a delegation hint: one notice at the second direct lookup
 * of a hinted turn, silence once the turn delegates, edits or mutates.
 *
 * Every call passes `dir`, a temp directory standing in for the user data dir,
 * so nothing here touches the developer's real state. The one case that goes
 * through the Codex hook has no `dir` option to pass, so it points
 * XDG_CONFIG_HOME at a temp directory for its duration instead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFollow, clearFollow, followToolUse, followStats } from '../src/route-follow.js';
import { codexHookOutput } from '../src/codex/hooks.js';

const SID = 'sess-1';
const T0 = 1_800_000_000_000;
const INFO = { category: 'explore', label: '탐색·조회 (파일/값 찾기)', target: 'model: haiku', lang: 'ko' };

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-follow-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}
const use = (dir, tool_name, tool_input = {}, extra = {}) =>
  followToolUse({ session_id: SID, tool_name, tool_input, ...extra }, { dir, cfg: {}, now: T0 + 1000 });

test('nothing is recorded: no notice', (t) => {
  const dir = tmp(t);
  assert.equal(use(dir, 'Read'), null);
  assert.equal(use(dir, 'Read'), null);
});

test('the second lookup gets one notice, naming the rule and the target', (t) => {
  const dir = tmp(t);
  startFollow(SID, INFO, { dir, now: T0 });
  assert.equal(use(dir, 'Read', { file_path: '/a' }), null);
  const out = use(dir, 'Grep', { pattern: 'x' });
  assert.match(out, /^\[sprag\] 이 턴은 위임 룰 "탐색·조회 \(파일\/값 찾기\)" 에 해당하는데/);
  assert.match(out, /직접 조회를 2회 했습니다/);
  assert.match(out, /남은 조회는 model: haiku 에 넘기고/);
  assert.equal(use(dir, 'Read'), null, 'the third call is silent');
});

test('English notice for lang en', (t) => {
  const dir = tmp(t);
  startFollow(SID, { ...INFO, label: 'lookup', lang: 'en' }, { dir, now: T0 });
  use(dir, 'Read');
  const out = use(dir, 'Glob');
  assert.match(out, /^\[sprag\] This turn matches the delegation rule "lookup", but you have run 2 lookups yourself/);
  assert.match(out, /Hand the remaining lookups to model: haiku/);
});

test('a delegation first ends the count', (t) => {
  const dir = tmp(t);
  startFollow(SID, INFO, { dir, now: T0 });
  assert.equal(use(dir, 'Agent'), null);
  assert.equal(use(dir, 'Read'), null);
  assert.equal(use(dir, 'Read'), null);
});

test('PreToolUse for the delegation stops the count before the subagent runs', (t) => {
  const dir = tmp(t);
  startFollow(SID, INFO, { dir, now: T0 });
  assert.equal(use(dir, 'Read'), null);
  // The Task call starts; its PostToolUse comes only after the subagent ends.
  assert.equal(use(dir, 'Agent', {}, { hook_event_name: 'PreToolUse' }), null);
  // A lookup made meanwhile, under the parent's session id, nudges nobody.
  assert.equal(use(dir, 'Grep'), null);
  assert.equal(use(dir, 'Agent'), null);
  const s = followStats({ dir, now: T0 + 2000 }).get('explore');
  assert.equal(s.delegatedAtOnce, 1, 'the delegation is counted once, at its start');
});

test('PreToolUse for anything but a delegation is not counted', (t) => {
  const dir = tmp(t);
  startFollow(SID, INFO, { dir, now: T0 });
  assert.equal(use(dir, 'Read', {}, { hook_event_name: 'PreToolUse' }), null);
  assert.equal(use(dir, 'Read'), null, 'only the PostToolUse call counted');
});

test('an edit first ends the count', (t) => {
  const dir = tmp(t);
  startFollow(SID, INFO, { dir, now: T0 });
  assert.equal(use(dir, 'Edit'), null);
  assert.equal(use(dir, 'Read'), null);
  assert.equal(use(dir, 'Read'), null);
});

test('a mutating shell command stops the count, a read-only one is counted', (t) => {
  const dir = tmp(t);
  startFollow(SID, INFO, { dir, now: T0 });
  assert.equal(use(dir, 'Bash', { command: 'git push origin x' }), null);
  assert.equal(use(dir, 'Read'), null);
  assert.equal(use(dir, 'Read'), null);

  startFollow(SID, INFO, { dir, now: T0 });
  assert.equal(use(dir, 'Bash', { command: 'ls -la' }), null);
  assert.match(use(dir, 'Bash', { command: 'cat a.txt 2>&1' }), /직접 조회를 2회/);

  startFollow(SID, INFO, { dir, now: T0 });
  assert.equal(use(dir, 'Bash', { command: 'echo hi > out.txt' }), null);
  assert.equal(use(dir, 'Read'), null, 'a redirect to a file stopped the count');
  assert.equal(use(dir, 'Read'), null);
});

test('Codex-style shell tools and prefixed names are classified', (t) => {
  const dir = tmp(t);
  startFollow(SID, INFO, { dir, now: T0 });
  assert.equal(use(dir, 'functions.exec_command', { cmd: 'rg foo' }), null);
  assert.match(use(dir, 'exec_command', { cmd: ['ls', '-la'] }), /직접 조회를 2회/);
});

test('an MCP or web lookup switches to the general-purpose notice', (t) => {
  const dir = tmp(t);
  startFollow(SID, INFO, { dir, now: T0 });
  use(dir, 'Read');
  const out = use(dir, 'mcp__x__y');
  assert.match(out, /general-purpose\(model: haiku\)/);
  assert.doesNotMatch(out, /model: haiku 에 넘기고/, 'the hint target sentence is replaced');
});

test('tools the follow-up does not know are ignored', (t) => {
  const dir = tmp(t);
  startFollow(SID, INFO, { dir, now: T0 });
  assert.equal(use(dir, 'TodoWrite'), null);
  assert.equal(use(dir, 'TodoWrite'), null);
  assert.equal(use(dir, 'Read'), null, 'only one lookup so far');
});

test('a subagent payload is not counted as the parent', (t) => {
  const dir = tmp(t);
  startFollow(SID, INFO, { dir, now: T0 });
  assert.equal(use(dir, 'Read', {}, { agent_id: 'a1' }), null);
  assert.equal(use(dir, 'Read', {}, { agent_id: 'a1' }), null);
  assert.equal(use(dir, 'Read'), null, 'the parent has made one lookup');
});

test('clearFollow ends the follow-up', (t) => {
  const dir = tmp(t);
  startFollow(SID, INFO, { dir, now: T0 });
  use(dir, 'Read');
  clearFollow(SID, { dir });
  assert.equal(use(dir, 'Read'), null);
  assert.equal(use(dir, 'Read'), null);
});

test('routeFollowUp false turns it off', (t) => {
  const dir = tmp(t);
  startFollow(SID, INFO, { dir, now: T0 });
  const off = () => followToolUse({ session_id: SID, tool_name: 'Read' }, { dir, cfg: { routeFollowUp: false }, now: T0 + 1000 });
  assert.equal(off(), null);
  assert.equal(off(), null);
});

test('a record older than 60 minutes is ignored', (t) => {
  const dir = tmp(t);
  startFollow(SID, INFO, { dir, now: T0 });
  const late = () => followToolUse({ session_id: SID, tool_name: 'Read' }, { dir, cfg: {}, now: T0 + 61 * 60 * 1000 });
  assert.equal(late(), null);
  assert.equal(late(), null);
});

test('a new hint resets the previous turn', (t) => {
  const dir = tmp(t);
  startFollow(SID, INFO, { dir, now: T0 });
  use(dir, 'Read');
  assert.ok(use(dir, 'Read'));
  startFollow(SID, INFO, { dir, now: T0 + 5000 });
  assert.equal(use(dir, 'Read'), null);
  assert.ok(use(dir, 'Read'), 'nudged again on the new turn');
});

test('a session id that is not a plain token is refused', (t) => {
  const dir = tmp(t);
  assert.equal(startFollow('../evil', INFO, { dir, now: T0 }), false);
  assert.equal(existsSync(join(dir, 'route-follow')), false);
  assert.equal(followToolUse({ session_id: '../evil', tool_name: 'Read' }, { dir, cfg: {} }), null);
});

test('followStats: hint then nudge then delegation, and hint then delegation', (t) => {
  const dir = tmp(t);
  startFollow('a', INFO, { dir, now: T0 });
  const call = (sid, tool, at) => followToolUse({ session_id: sid, tool_name: tool }, { dir, cfg: {}, now: at });
  call('a', 'Read', T0 + 1);
  assert.ok(call('a', 'Read', T0 + 2));
  call('a', 'Agent', T0 + 3);

  startFollow('b', INFO, { dir, now: T0 + 10 });
  call('b', 'Agent', T0 + 11);

  startFollow('c', INFO, { dir, now: T0 + 20 });
  call('c', 'Edit', T0 + 21);

  const stats = followStats({ dir, now: T0 + 1000 }).get('explore');
  assert.deepEqual(stats, { hints: 3, delegatedAtOnce: 1, nudged: 1, delegatedAfterNudge: 1 });
  assert.equal(followStats({ dir, now: T0 + 1000, agent: 'codex' }).size, 0);
  assert.equal(followStats({ dir, now: T0 + 15 * 24 * 60 * 60 * 1000 }).size, 0, 'outside the 14 day window');
});

test('a Codex record produces the English Codex notice', (t) => {
  const dir = tmp(t);
  startFollow(SID, { agent: 'codex', category: 'explore', label: 'lookup', target: 'the child the routing hint named', lang: 'en' }, { dir, now: T0 });
  use(dir, 'exec_command', { cmd: 'ls' });
  const out = use(dir, 'exec_command', { cmd: 'cat a' });
  assert.match(out, /^\[Sprag model routing\] This turn matched the approved routing hint for lookup, but you have run 2 lookups yourself instead of spawning\./);
  assert.match(out, /Hand the remaining lookups to the child the routing hint named, and summarize/);
});

test('Codex post-tool hook delivers the notice as PostToolUse context, and a spawn stops it', async (t) => {
  const dir = tmp(t);
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  t.after(() => { if (prev === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prev; });
  const info = { agent: 'codex', category: 'explore', label: 'lookup', target: 'the child', lang: 'en' };
  const post = (tool_name, tool_input) => codexHookOutput('post-tool', { session_id: SID, tool_name, tool_input }, { cfg: {} });

  startFollow(SID, info);
  assert.equal(await post('exec_command', { cmd: 'ls' }), null);
  const out = await post('exec_command', { cmd: 'cat a' });
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /\[Sprag model routing\]/);

  startFollow(SID, info);
  assert.equal(await post('spawn_agent', {}), null);
  assert.equal(await post('exec_command', { cmd: 'ls' }), null);
  assert.equal(await post('exec_command', { cmd: 'ls' }), null);
});
