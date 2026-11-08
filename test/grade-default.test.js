/**
 * The delegation grade with nothing configured (no relax window), and the once-per-session limit
 * on the Opus recommendation.
 *
 * HOME and XDG_CONFIG_HOME point at an empty throwaway directory before any
 * sprag module loads (config.js fixes its path at import), so the real user
 * config can neither supply nor hide a grade.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { childEnv } from './helpers/child-env.js';

const dir = mkdtempSync(join(tmpdir(), 'sprag-grade-default-'));
const home = join(dir, 'home');
mkdirSync(join(home, '.claude'), { recursive: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(dir, 'cfg');
test.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const { delegationGrade, DEFAULT_DELEGATION_GRADE } = await import('../src/routing-switch.js');
const { routeMatch } = await import('../src/route-inject.js');
const { renderModelRatchet } = await import('../src/model-rules.js');
const { claimEscalationNotice } = await import('../src/route-follow.js');

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

const rule = (tier, category) => ({
  tier, category, label: category, labelEn: category, scope: 'global', targetRoot: null, project: '-p',
  signature: `${tier}|${category}|-p`, rule: 'r', example: 'x', promotedAt: '2026-11-01', count: 5, status: 'active',
});
const CHECK = '지금 실행 중인 버전이 뭔지 확인해줘';

test('with no config the grade is quality', () => {
  assert.equal(DEFAULT_DELEGATION_GRADE, 'quality');
  assert.equal(delegationGrade(), 'quality');
  assert.equal(delegationGrade({}), 'quality');
  assert.equal(delegationGrade({ delegationGrade: 'cost' }), 'quality', 'the old stored key is not read');
});

test('with no grade given, routeMatch applies the JUDGE gate and the T2 filter', () => {
  // The JUDGE gate: an absence check is held back by default and handed off at cost.
  const absence = '로그에 에러가 없는지 확인해줘';
  const rules = [rule('T2', 'check'), rule('T1', 'check')];
  assert.equal(routeMatch(absence, { rules }), null);
  assert.ok(routeMatch(absence, { rules, grade: 'cost' }));
  // The T2 filter: a lookup keeps its T1 rule only.
  const byDefault = routeMatch(CHECK, { rules });
  assert.equal(byDefault.t2, undefined);
  assert.ok(byDefault.t1);
  assert.ok(routeMatch(CHECK, { rules, grade: 'cost' }).t2);
});

test('with no grade given, the rules file drops the T2 rule of a lookup category', () => {
  const md = renderModelRatchet([{ ...rule('T2', 'check'), rule: 'r2' }], 'en', { root: null });
  assert.doesNotMatch(md, /model: haiku/);
  assert.doesNotMatch(md, /delegation grade|limit window/i, 'no line unless a relax window is open');
  assert.match(renderModelRatchet([{ ...rule('T2', 'check'), rule: 'r2' }], 'en', { root: null, grade: 'cost' }), /model: haiku/);
});

test('claimEscalationNotice is true once per session id and false for a malformed one', () => {
  const state = join(dir, 'claims');
  assert.equal(claimEscalationNotice('sess-a', { dir: state }), true);
  assert.equal(claimEscalationNotice('sess-a', { dir: state }), false);
  assert.equal(claimEscalationNotice('sess-b', { dir: state }), true);
  assert.equal(claimEscalationNotice('../escape', { dir: state }), false);
  assert.equal(claimEscalationNotice(undefined, { dir: state }), false);
  assert.equal(existsSync(join(state, 'route-follow', '..', 'escape.escalated')), false);
});

test('the brief hook recommends Opus once per session, and again for another session', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'sprag-escalation-once-'));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const hHome = join(base, 'home');
  const state = join(base, 'state');
  const project = join(base, 'project');
  for (const d of [join(hHome, '.claude'), join(state, 'claude-token-saver'), project]) mkdirSync(d, { recursive: true });
  writeFileSync(join(state, 'claude-token-saver', 'config.json'), JSON.stringify({ language: 'ko' }) + '\n');
  // A Sonnet session: the recommendation only goes to a session below Opus.
  const transcript = join(base, 'session.jsonl');
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-5' } }) + '\n');

  const run = (session_id, prompt) => execFileSync(process.execPath, [CLI, 'brief', '--hook'], {
    cwd: project,
    env: childEnv({ HOME: hHome, XDG_CONFIG_HOME: state, APPDATA: state, NO_COLOR: '1', SPRAG_NO_UPDATE_CHECK: '1' }),
    input: JSON.stringify({ session_id, prompt, cwd: project, transcript_path: transcript }),
    encoding: 'utf8',
  });
  const NOTICE = /이 요청은 판단이 결론인 일입니다/;
  const design = '이 구조를 어떻게 설계할지 정해줘';
  const recommend = '쓸 만한 라이브러리 추천해줘';

  assert.match(run('once-1', design), NOTICE, 'the first judgement request of a session gets the line');
  assert.doesNotMatch(run('once-1', recommend), NOTICE, 'the second does not');
  assert.doesNotMatch(run('once-1', design), NOTICE, 'nor the third');
  assert.match(run('once-2', recommend), NOTICE, 'another session starts over');
});
