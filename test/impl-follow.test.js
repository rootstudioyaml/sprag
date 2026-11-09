/**
 * The implementation split reminders: the PostToolUse notice after two directly
 * edited files (one per streak, silence for subagents, scratch paths, documents,
 * Sonnet sessions and stale streaks), which agent calls count as a delegation,
 * and the prompt-time implementationReminder with looksLikeImplementation.
 *
 * Every call passes `dir`, a temp directory standing in for the user data dir,
 * plus `cfg`, `rank` and `lang`, so nothing here reads or writes the developer's
 * real state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { implFollowToolUse, implementationReminder } from '../src/impl-follow.js';
import { looksLikeImplementation } from '../src/route-inject.js';
import { startFollow, followStats } from '../src/route-follow.js';
import { resolveAgentName } from '../src/agents.js';
import { TIER_TARGET_RANK } from '../src/cost.js';
import { worthDelegating } from '../src/route-scan.js';

const require = createRequire(import.meta.url);
const { lintKoreanText } = require('../src/korean-lint.cjs');

const SID = 'impl-1';
const T0 = 1_800_000_000_000;
const OPUS = TIER_TARGET_RANK.T1H;
const SONNET = TIER_TARGET_RANK.T1;
const TARGET = resolveAgentName('sonnet', null) || 'general-purpose (model: sonnet)';
const IMPL_PROMPT = '로그인 API에 refresh 토큰 회전을 추가하고 관련 테스트를 고쳐줘';

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-impl-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}
const edit = (dir, file, extra = {}, opts = {}) =>
  implFollowToolUse(
    { session_id: SID, tool_name: 'Edit', tool_input: { file_path: file }, hook_event_name: 'PostToolUse', ...extra },
    { dir, cfg: {}, rank: OPUS, now: T0, lang: 'ko', ...opts },
  );
const agent = (dir, extra = {}, opts = {}) =>
  implFollowToolUse({ session_id: SID, tool_name: 'Agent', tool_input: {}, hook_event_name: 'PostToolUse', ...extra },
    { dir, cfg: {}, rank: OPUS, now: T0, lang: 'ko', ...opts });
const agentType = (dir, subagent_type, opts = {}) => agent(dir, { tool_input: { subagent_type } }, opts);
const remind = (dir, text = IMPL_PROMPT, opts = {}) =>
  implementationReminder(text, { dir, cfg: {}, sessionId: SID, sessionRank: OPUS, now: T0, lang: 'ko', ...opts });
const events = (dir) => {
  const file = join(dir, 'route-follow-events.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

test('one file is silent, the second distinct file gets the notice', (t) => {
  const dir = tmp(t);
  assert.equal(edit(dir, '/p/src/a.js'), null);
  const out = edit(dir, '/p/src/b.js');
  assert.match(out, /^✇ \[sprag\] 위임 없이 파일 2개를 직접 고쳤습니다\(a\.js, b\.js\)\./);
  assert.ok(out.includes(`${TARGET}에 넘기십시오`));
  assert.ok(out.endsWith('이 안내는 다음 위임 전까지 다시 나가지 않습니다.'));
  assert.deepEqual(events(dir).map((e) => [e.event, e.files]), [['impl-nudged', 2]]);
});

test('English notice names the files and the target', (t) => {
  const dir = tmp(t);
  edit(dir, '/p/a.js', {}, { lang: 'en' });
  const out = edit(dir, '/p/b.js', {}, { lang: 'en' });
  assert.match(out, /^✇ \[sprag\] You have edited 2 files yourself without delegating \(a\.js, b\.js\)\./);
  assert.ok(out.includes(`hand it to ${TARGET}.`));
});

test('more than three files are summarised as "N more"', (t) => {
  const dir = tmp(t);
  // The session was on Sonnet for the first three files, then moved up to Opus.
  for (const f of ['/p/a.js', '/p/b.js', '/p/c.js']) assert.equal(edit(dir, f, {}, { rank: SONNET }), null);
  const ko = edit(dir, '/p/d.js');
  assert.match(ko, /파일 4개를 직접 고쳤습니다\(a\.js, b\.js, c\.js 외 1개\)/);
  const dir2 = tmp(t);
  for (const f of ['/p/a.js', '/p/b.js', '/p/c.js']) edit(dir2, f, {}, { rank: SONNET, lang: 'en' });
  assert.match(edit(dir2, '/p/d.js', {}, { lang: 'en' }), /\(a\.js, b\.js, c\.js and 1 more\)/);
});

test('the same file edited three times stays silent', (t) => {
  const dir = tmp(t);
  assert.equal(edit(dir, '/p/a.js'), null);
  assert.equal(edit(dir, '/p/a.js'), null);
  assert.equal(edit(dir, '/p/a.js'), null);
});

test('after the notice a third file is silent', (t) => {
  const dir = tmp(t);
  edit(dir, '/p/a.js');
  assert.ok(edit(dir, '/p/b.js'));
  assert.equal(edit(dir, '/p/c.js'), null);
  assert.equal(edit(dir, '/p/d.js'), null);
});

test('a delegation resets the streak, and records impl-delegated after a notice', (t) => {
  const dir = tmp(t);
  edit(dir, '/p/a.js');
  assert.ok(edit(dir, '/p/b.js'));
  assert.equal(agent(dir), null);
  const delegated = events(dir).filter((e) => e.event === 'impl-delegated');
  assert.equal(delegated.length, 1);
  assert.equal(delegated[0].afterNudge, true);
  assert.equal(delegated[0].afterReminder, false);
  assert.equal(delegated[0].agent, 'claude');
  assert.equal(delegated[0].sessionId, SID);
  assert.equal(edit(dir, '/p/c.js'), null);
  assert.ok(edit(dir, '/p/d.js'), 'a new streak of two files is reminded again');
});

test('a delegation without a notice records nothing', (t) => {
  const dir = tmp(t);
  edit(dir, '/p/a.js');
  assert.equal(agent(dir, { hook_event_name: 'PreToolUse' }), null);
  assert.deepEqual(events(dir), []);
});

test('lookup agents do not reset anything', (t) => {
  const dir = tmp(t);
  edit(dir, '/p/a.js');
  for (const type of ['Explore', 't2-explore', 'web-fetch', 'cavecrew-investigator']) {
    assert.equal(agentType(dir, type), null, type);
  }
  assert.ok(edit(dir, '/p/b.js'), 'the first file survived the lookup agents');
  for (const type of ['Explore', 't2-explore']) assert.equal(agentType(dir, type), null, type);
  assert.deepEqual(events(dir).map((e) => e.event), ['impl-nudged'], 'no impl-delegated line');
  assert.equal(edit(dir, '/p/c.js'), null, 'the marker survived: still one notice per streak');
});

test('implementer agents reset the streak', (t) => {
  const types = [undefined, '', 't1-worker', 't1h-worker', 'general-purpose', 'claude', 'my-builder', 'team:worker', 'cavecrew-builder'];
  for (const type of types) {
    const dir = tmp(t);
    edit(dir, '/p/a.js');
    assert.equal(type === undefined ? agent(dir) : agentType(dir, type), null);
    assert.equal(edit(dir, '/p/b.js'), null, `streak restarted after ${JSON.stringify(type)}`);
  }
  const dir = tmp(t);
  edit(dir, '/p/a.js');
  assert.equal(agent(dir, { tool_name: 'spawn_agent' }), null);
  assert.equal(edit(dir, '/p/b.js'), null, 'spawn_agent is a delegation');
});

test('payloads with agent_id are ignored', (t) => {
  const dir = tmp(t);
  for (const f of ['/p/a.js', '/p/b.js', '/p/c.js', '/p/d.js']) assert.equal(edit(dir, f, { agent_id: 'sub-1' }), null);
  assert.equal(edit(dir, '/p/e.js'), null, 'the subagent edits were not counted');
});

test('scratch, .claude and document paths are not counted', (t) => {
  const dir = tmp(t);
  const skipped = [
    '/tmp/x.js', '/private/tmp/y.js', '/var/folders/ab/z.js', '/private/var/folders/ab/w.js',
    join(tmpdir(), 'q.js'), '/Users/me/.claude/projects/p/memory/m.md', '/p/.claude/settings.json',
    '/p/README.md', '/p/docs/a.MDX', '/p/n.markdown', '/p/notes.txt', '/p/d.rst', '/p/d.adoc',
  ];
  for (const f of skipped) assert.equal(edit(dir, f), null);
  assert.equal(edit(dir, '/p/a.js'), null, 'only one real file so far');
  assert.ok(edit(dir, '/p/b.js'));
});

test('routing off and implementationFollowUp false are silent', (t) => {
  const dir = tmp(t);
  for (const cfg of [{ routing: false }, { implementationFollowUp: false }]) {
    for (const f of ['/p/a.js', '/p/b.js', '/p/c.js']) {
      assert.equal(edit(dir, f, {}, { cfg }), null);
    }
  }
});

test('a streak whose last edit is over two hours old starts over', (t) => {
  const dir = tmp(t);
  edit(dir, '/p/a.js');
  const later = T0 + 2 * 60 * 60 * 1000 + 1;
  assert.equal(edit(dir, '/p/b.js', {}, { now: later }), null, 'count restarted at one');
  assert.ok(edit(dir, '/p/c.js', {}, { now: later + 1 }));
});

test('a Sonnet-rank session is not reminded', (t) => {
  const dir = tmp(t);
  assert.equal(worthDelegating('T1', SONNET), false);
  for (const f of ['/p/a.js', '/p/b.js', '/p/c.js']) assert.equal(edit(dir, f, {}, { rank: SONNET }), null);
  assert.deepEqual(events(dir), []);
});

test('PreToolUse edits are not counted', (t) => {
  const dir = tmp(t);
  for (const f of ['/p/a.js', '/p/b.js', '/p/c.js']) assert.equal(edit(dir, f, { hook_event_name: 'PreToolUse' }), null);
  assert.equal(edit(dir, '/p/e.js'), null);
});

test('the Korean notice passes the Korean lint', (t) => {
  const dir = tmp(t);
  edit(dir, '/p/a.js');
  const out = edit(dir, '/p/b.js');
  assert.deepEqual(lintKoreanText(out, { maxFindings: 50 }), []);
});

test('impl events do not change followStats', (t) => {
  const dir = tmp(t);
  startFollow(SID, { category: 'explore', label: 'x', target: 'y', lang: 'ko' }, { dir, now: T0 });
  const before = followStats({ dir, now: T0 + 1000 });
  edit(dir, '/p/a.js'); edit(dir, '/p/b.js');
  remind(dir);
  agent(dir);
  assert.ok(events(dir).some((e) => e.event === 'impl-nudged'));
  assert.ok(events(dir).some((e) => e.event === 'impl-reminded'));
  assert.deepEqual(followStats({ dir, now: T0 + 1000 }), before);
  assert.equal(before.get('explore').hints, 1);
});

test('looksLikeImplementation: edit asks and specs yes, actions and explanations no', () => {
  assert.equal(looksLikeImplementation('별도 엔드포인트로 하고 하위 호환은 빼고 진행해줘'), true);
  assert.equal(looksLikeImplementation(IMPL_PROMPT), true);
  assert.equal(looksLikeImplementation('배포해줘'), false);
  assert.equal(looksLikeImplementation('이 함수가 하는 일을 단계별로 정리해줘'), false);
  assert.equal(looksLikeImplementation(''), false);
  assert.equal(looksLikeImplementation('<system-reminder>' + '추가해 '.repeat(40)), false, 'a harness message');
});

test('implementationReminder: silent when switched off, for a bad id, a non-implementation prompt or a Sonnet session', (t) => {
  const dir = tmp(t);
  assert.equal(remind(dir, IMPL_PROMPT, { cfg: { routing: false } }), null);
  assert.equal(remind(dir, IMPL_PROMPT, { cfg: { implementationFollowUp: false } }), null);
  assert.equal(remind(dir, IMPL_PROMPT, { sessionId: '../x' }), null);
  assert.equal(remind(dir, IMPL_PROMPT, { sessionId: undefined }), null);
  assert.equal(remind(dir, '이 함수가 하는 일을 단계별로 정리해줘'), null);
  assert.equal(remind(dir, IMPL_PROMPT, { sessionRank: SONNET }), null);
  assert.deepEqual(events(dir), []);
  assert.ok(remind(dir), 'none of the above consumed the marker');
});

test('implementationReminder: once per delegation cycle, then armed again', (t) => {
  const dir = tmp(t);
  const first = remind(dir);
  assert.match(first, /^✇ \[sprag\] 구현 요청으로 보입니다\./);
  assert.ok(first.includes(`코드 작성은 ${TARGET}에 넘기십시오`));
  assert.equal(remind(dir), null, 'second time');
  assert.equal(agentType(dir, 'Explore'), null);
  assert.equal(remind(dir), null, 'a lookup agent does not re-arm');
  assert.equal(agentType(dir, 't1-worker'), null);
  const delegated = events(dir).filter((e) => e.event === 'impl-delegated');
  assert.equal(delegated.length, 1);
  assert.equal(delegated[0].afterReminder, true);
  assert.equal(delegated[0].afterNudge, false);
  assert.ok(remind(dir), 'armed again after the delegation');
  assert.deepEqual(events(dir).map((e) => e.event), ['impl-reminded', 'impl-delegated', 'impl-reminded']);
});

test('implementationReminder: English text and both Korean texts pass what they should', (t) => {
  const dir = tmp(t);
  const en = remind(dir, IMPL_PROMPT, { lang: 'en' });
  assert.match(en, /^✇ \[sprag\] This looks like an implementation request\./);
  assert.ok(en.includes(`hand the code writing to ${TARGET}.`));
  const dir2 = tmp(t);
  const ko = remind(dir2);
  assert.deepEqual(lintKoreanText(ko, { maxFindings: 50 }), []);
  edit(dir2, '/p/a.js');
  assert.deepEqual(lintKoreanText(edit(dir2, '/p/b.js'), { maxFindings: 50 }), []);
});
