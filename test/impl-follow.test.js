/**
 * The reminder after three directly edited files: one notice per streak, silence
 * for subagents, scratch paths, Sonnet sessions and stale streaks.
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
import { implFollowToolUse } from '../src/impl-follow.js';
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
const events = (dir) => {
  const file = join(dir, 'route-follow-events.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

test('two distinct files are silent, the third gets the notice', (t) => {
  const dir = tmp(t);
  assert.equal(edit(dir, '/p/src/a.js'), null);
  assert.equal(edit(dir, '/p/src/b.js'), null);
  const out = edit(dir, '/p/src/c.js');
  assert.match(out, /^✇ \[sprag\] 위임 없이 파일 3개를 직접 고쳤습니다\(a\.js, b\.js, c\.js\)\./);
  assert.ok(out.includes(`${TARGET}에 넘기십시오`));
  assert.ok(out.endsWith('이 안내는 다음 위임 전까지 다시 나가지 않습니다.'));
  assert.deepEqual(events(dir).map((e) => [e.event, e.files]), [['impl-nudged', 3]]);
});

test('English notice names the files and the target', (t) => {
  const dir = tmp(t);
  edit(dir, '/p/a.js', {}, { lang: 'en' });
  edit(dir, '/p/b.js', {}, { lang: 'en' });
  const out = edit(dir, '/p/c.js', {}, { lang: 'en' });
  assert.match(out, /^✇ \[sprag\] You have edited 3 files yourself without delegating \(a\.js, b\.js, c\.js\)\./);
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

test('after the notice a fourth file is silent', (t) => {
  const dir = tmp(t);
  edit(dir, '/p/a.js'); edit(dir, '/p/b.js');
  assert.ok(edit(dir, '/p/c.js'));
  assert.equal(edit(dir, '/p/d.js'), null);
  assert.equal(edit(dir, '/p/e.js'), null);
});

test('a delegation resets the streak, and records impl-delegated after a notice', (t) => {
  const dir = tmp(t);
  edit(dir, '/p/a.js'); edit(dir, '/p/b.js');
  assert.ok(edit(dir, '/p/c.js'));
  assert.equal(agent(dir), null);
  const delegated = events(dir).filter((e) => e.event === 'impl-delegated');
  assert.equal(delegated.length, 1);
  assert.equal(delegated[0].afterNudge, true);
  assert.equal(delegated[0].agent, 'claude');
  assert.equal(delegated[0].sessionId, SID);
  assert.equal(edit(dir, '/p/d.js'), null);
  assert.equal(edit(dir, '/p/e.js'), null);
  assert.ok(edit(dir, '/p/f.js'), 'a new streak of three files is reminded again');
});

test('a delegation without a notice records nothing', (t) => {
  const dir = tmp(t);
  edit(dir, '/p/a.js');
  assert.equal(agent(dir, { hook_event_name: 'PreToolUse' }), null);
  assert.deepEqual(events(dir), []);
});

test('payloads with agent_id are ignored', (t) => {
  const dir = tmp(t);
  for (const f of ['/p/a.js', '/p/b.js', '/p/c.js', '/p/d.js']) assert.equal(edit(dir, f, { agent_id: 'sub-1' }), null);
  assert.equal(edit(dir, '/p/e.js'), null, 'the subagent edits were not counted');
});

test('scratch and .claude paths are not counted', (t) => {
  const dir = tmp(t);
  const skipped = [
    '/tmp/x.js', '/private/tmp/y.js', '/var/folders/ab/z.js', '/private/var/folders/ab/w.js',
    join(tmpdir(), 'q.js'), '/Users/me/.claude/projects/p/memory/m.md', '/p/.claude/settings.json',
  ];
  for (const f of skipped) assert.equal(edit(dir, f), null);
  assert.equal(edit(dir, '/p/a.js'), null);
  assert.equal(edit(dir, '/p/b.js'), null, 'only two real files so far');
  assert.ok(edit(dir, '/p/c.js'));
});

test('routing off and implementationFollowUp false are silent', (t) => {
  const dir = tmp(t);
  for (const cfg of [{ routing: false }, { implementationFollowUp: false }]) {
    for (const f of ['/p/a.js', '/p/b.js', '/p/c.js', '/p/d.js']) {
      assert.equal(edit(dir, f, {}, { cfg }), null);
    }
  }
});

test('a streak whose last edit is over two hours old starts over', (t) => {
  const dir = tmp(t);
  edit(dir, '/p/a.js'); edit(dir, '/p/b.js');
  const later = T0 + 2 * 60 * 60 * 1000 + 1;
  assert.equal(edit(dir, '/p/c.js', {}, { now: later }), null, 'count restarted at one');
  assert.equal(edit(dir, '/p/d.js', {}, { now: later + 1 }), null);
  assert.ok(edit(dir, '/p/e.js', {}, { now: later + 2 }));
});

test('a Sonnet-rank session is not reminded', (t) => {
  const dir = tmp(t);
  assert.equal(worthDelegating('T1', SONNET), false);
  for (const f of ['/p/a.js', '/p/b.js', '/p/c.js', '/p/d.js']) assert.equal(edit(dir, f, {}, { rank: SONNET }), null);
  assert.deepEqual(events(dir), []);
});

test('PreToolUse edits are not counted', (t) => {
  const dir = tmp(t);
  for (const f of ['/p/a.js', '/p/b.js', '/p/c.js', '/p/d.js']) assert.equal(edit(dir, f, { hook_event_name: 'PreToolUse' }), null);
  assert.equal(edit(dir, '/p/e.js'), null);
});

test('the Korean notice passes the Korean lint', (t) => {
  const dir = tmp(t);
  edit(dir, '/p/a.js'); edit(dir, '/p/b.js');
  const out = edit(dir, '/p/c.js');
  assert.deepEqual(lintKoreanText(out, { maxFindings: 50 }), []);
});

test('impl events do not change followStats', (t) => {
  const dir = tmp(t);
  startFollow(SID, { category: 'explore', label: 'x', target: 'y', lang: 'ko' }, { dir, now: T0 });
  const before = followStats({ dir, now: T0 + 1000 });
  edit(dir, '/p/a.js'); edit(dir, '/p/b.js'); edit(dir, '/p/c.js');
  agent(dir);
  assert.ok(events(dir).some((e) => e.event === 'impl-nudged'));
  assert.deepEqual(followStats({ dir, now: T0 + 1000 }), before);
  assert.equal(before.get('explore').hints, 1);
});
