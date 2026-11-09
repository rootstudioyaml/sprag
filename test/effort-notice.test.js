/**
 * Main-session effort notice: effortNotice (the judgement + effort gate), the
 * once-per-session claim, the statusline's session-effort record, the
 * `effortHint` switch, and brief --hook putting it together with the model line.
 *
 * XDG_CONFIG_HOME points at a throwaway directory before any sprag module
 * loads (config.js fixes its path at import), so no test reads the real user
 * config. Every example text below is invented.
 */
import './helpers/grade-config.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { childEnv } from './helpers/child-env.js';
import { writeGradeConfig } from './helpers/grade-config.js';

const dir = mkdtempSync(join(tmpdir(), 'sprag-effort-notice-'));
const home = join(dir, 'home');
mkdirSync(join(home, '.claude'), { recursive: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(dir, 'cfg');
process.env.SPRAG_LANG = 'ko';
test.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const { effortNotice } = await import('../src/route-inject.js');
const { claimEffortNotice, claimEscalationNotice } = await import('../src/route-follow.js');
const { recordSessionEffort, readSessionEffort, pruneSessionEffort, sessionEffortDir } = await import('../src/session-effort.js');
const { effortHintEnabled, implementationFollowUpEnabled } = await import('../src/routing-switch.js');
const lint = (await import('../src/korean-lint.cjs')).default;

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const JUDGE_ASK = '이 구조를 어떻게 설계할지 정해줘';
const CHECK = '지금 실행 중인 버전이 뭔지 확인해줘';
const ACTION = '이 버전을 지금 배포해줘';
const opts = (extra = {}) => ({ grade: 'quality', lang: 'ko', ...extra });

test('effortNotice: a judgement request at effort low or medium gets the line', () => {
  for (const level of ['low', 'medium']) {
    const out = effortNotice(JUDGE_ASK, opts({ sessionEffort: level }));
    assert.ok(out, level);
    assert.match(out, new RegExp(`effort가 ${level}입니다`));
    assert.match(out, /t1h-worker/);
    assert.match(out, /\/effort high/);
  }
  assert.match(effortNotice(JUDGE_ASK, opts({ sessionEffort: 'Medium' })), /effort가 medium입니다/, 'the level is read case-insensitively');
});

test('effortNotice: nothing at high or above, with no record, or for a request that is not a judgement', () => {
  for (const level of ['high', 'xhigh', 'max', null, '']) {
    assert.equal(effortNotice(JUDGE_ASK, opts({ sessionEffort: level })), null, String(level));
  }
  assert.equal(effortNotice(CHECK, opts({ sessionEffort: 'medium' })), null, 'an ordinary request');
  assert.equal(effortNotice(ACTION, opts({ sessionEffort: 'low' })), null, 'an irreversible action');
});

test('effortNotice: grade cost speaks only for diagnosis, audit and security', () => {
  assert.ok(effortNotice('이 모듈 보안 감사해줘', opts({ grade: 'cost', sessionEffort: 'low' })));
  assert.ok(effortNotice('버그 원인 분석해줘', opts({ grade: 'cost', sessionEffort: 'low' })));
  assert.equal(effortNotice(JUDGE_ASK, opts({ grade: 'cost', sessionEffort: 'low' })), null);
  assert.ok(effortNotice(JUDGE_ASK, opts({ grade: 'quality', sessionEffort: 'low' })));
});

test('effortNotice wording: the Korean line passes the lint, the English one names high', () => {
  const ko = effortNotice(JUDGE_ASK, opts({ sessionEffort: 'medium' }));
  assert.deepEqual(lint.lintKoreanText(ko, { maxFindings: 100 }), []);
  const en = effortNotice(JUDGE_ASK, opts({ sessionEffort: 'low', lang: 'en' }));
  assert.match(en, /session runs at effort low/);
  assert.match(en, /effort high \(t1h-worker\)/);
  assert.match(en, /\/effort high/);
});

test('claimEffortNotice: once per session, independent of the model-line claim, refuses a bad id', () => {
  const d = join(dir, 'claims');
  assert.equal(claimEffortNotice('sess-1', { dir: d }), true);
  assert.equal(claimEffortNotice('sess-1', { dir: d }), false, 'second time in the same session');
  assert.equal(claimEffortNotice('sess-2', { dir: d }), true);
  assert.equal(claimEscalationNotice('sess-1', { dir: d }), true, 'the model claim is a separate file');
  assert.equal(claimEffortNotice('../evil', { dir: d }), false);
  assert.equal(claimEffortNotice(undefined, { dir: d }), false);
  assert.ok(existsSync(join(d, 'route-follow', 'sess-1.effort')));
});

test('effortHintEnabled: on by default, off for an explicit false or for routing off', () => {
  assert.equal(effortHintEnabled({}), true);
  assert.equal(effortHintEnabled({ effortHint: true }), true);
  assert.equal(effortHintEnabled({ effortHint: false }), false);
  assert.equal(effortHintEnabled({ routing: false }), false);
});

test('recordSessionEffort: writes once, skips an unchanged level, rewrites a changed one', () => {
  const d = join(dir, 'rec');
  assert.equal(recordSessionEffort('abc-1', 'medium', { dir: d }), true);
  assert.equal(readSessionEffort('abc-1', { dir: d }), 'medium');
  const file = join(sessionEffortDir(d), 'abc-1');
  const old = new Date(Date.now() - 3600_000);
  utimesSync(file, old, old);
  const before = statSync(file).mtimeMs;
  assert.equal(recordSessionEffort('abc-1', 'medium', { dir: d }), false, 'same value is not written again');
  assert.equal(statSync(file).mtimeMs, before, 'the file was not touched');
  assert.equal(recordSessionEffort('abc-1', 'high', { dir: d }), true);
  assert.equal(readSessionEffort('abc-1', { dir: d }), 'high');
  assert.equal(existsSync(`${file}.corrupt`), false, 'a plain level is not treated as corrupt state');
});

test('recordSessionEffort: a malformed session id or an empty level writes nothing', () => {
  const d = join(dir, 'bad');
  for (const id of ['../x', 'a/b', '', 'a b', 'x'.repeat(101), null, undefined, 7]) {
    assert.equal(recordSessionEffort(id, 'low', { dir: d }), false, String(id));
  }
  assert.equal(recordSessionEffort('ok-id', '', { dir: d }), false);
  assert.equal(recordSessionEffort('ok-id', null, { dir: d }), false);
  assert.equal(existsSync(d), false, 'nothing was created');
  assert.equal(readSessionEffort('../x', { dir: d }), null);
});

test('pruneSessionEffort removes files older than 7 days and keeps recent ones', () => {
  const d = join(dir, 'prune');
  recordSessionEffort('old-one', 'low', { dir: d });
  recordSessionEffort('new-one', 'low', { dir: d });
  const old = new Date(Date.now() - 8 * 24 * 3600_000);
  utimesSync(join(sessionEffortDir(d), 'old-one'), old, old);
  pruneSessionEffort({ dir: d });
  assert.deepEqual(readdirSync(sessionEffortDir(d)), ['new-one']);
});

function envFor(lang = 'en') {
  return childEnv({ HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(dir, 'cfg'), SPRAG_LANG: lang, SPRAG_NO_UPDATE_CHECK: '1' });
}

function hook(sessionId, model, prompt) {
  const transcript = join(dir, `${sessionId}.jsonl`);
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { model, role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }) + '\n');
  return spawnSync(process.execPath, [CLI, 'brief', '--hook'], {
    cwd: dir, encoding: 'utf8', timeout: 15000,
    input: JSON.stringify({ session_id: sessionId, transcript_path: transcript, cwd: dir, prompt }),
    env: envFor(),
  });
}

const dataDir = join(dir, 'cfg', 'claude-token-saver');
const ASK = 'Please audit the retry logic in this module';

test('brief --hook: an Opus session at effort medium gets the effort line once', () => {
  writeGradeConfig(dataDir, 'quality');
  recordSessionEffort('hk-opus', 'medium', { dir: dataDir });
  const first = hook('hk-opus', 'claude-opus-4-8', ASK);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /the session runs at effort medium/);
  assert.doesNotMatch(first.stdout, /ends in a judgement\. sprag recommends Opus/);
  assert.doesNotMatch(hook('hk-opus', 'claude-opus-4-8', ASK).stdout, /session runs at effort/, 'second time in the session');
});

test('brief --hook: effort high and an unrecorded session stay quiet', () => {
  recordSessionEffort('hk-high', 'high', { dir: dataDir });
  assert.doesNotMatch(hook('hk-high', 'claude-opus-4-8', ASK).stdout, /session runs at effort/);
  assert.doesNotMatch(hook('hk-none', 'claude-opus-4-8', ASK).stdout, /session runs at effort/);
});

test('brief --hook: a Sonnet session at effort low gets the model line only, the effort line stays unclaimed', () => {
  recordSessionEffort('hk-sonnet', 'low', { dir: dataDir });
  const out = hook('hk-sonnet', 'claude-sonnet-5-5', ASK);
  assert.match(out.stdout, /ends in a judgement\. sprag recommends Opus/);
  assert.doesNotMatch(out.stdout, /session runs at effort/);
  assert.equal(existsSync(join(dataDir, 'route-follow', 'hk-sonnet.effort')), false);
  assert.ok(existsSync(join(dataDir, 'route-follow', 'hk-sonnet.escalated')));
  // the model line was claimed, so the next judgement request carries the effort line
  assert.match(hook('hk-sonnet', 'claude-sonnet-5-5', ASK).stdout, /session runs at effort low/);
});

test('brief --hook: effortHint false and routing off silence the line', () => {
  recordSessionEffort('hk-off', 'low', { dir: dataDir });
  writeGradeConfig(dataDir, 'quality', { effortHint: false });
  assert.doesNotMatch(hook('hk-off', 'claude-opus-4-8', ASK).stdout, /session runs at effort/);
  writeGradeConfig(dataDir, 'quality', { effortHint: true, routing: false });
  assert.doesNotMatch(hook('hk-off', 'claude-opus-4-8', ASK).stdout, /session runs at effort/);
  writeGradeConfig(dataDir, 'quality', { effortHint: true, routing: true });
});

test('sprag routing effort-hint: sets the key, refuses a bad value, status shows the line', () => {
  const run = (...args) => spawnSync(process.execPath, [CLI, 'routing', ...args], { cwd: dir, encoding: 'utf8', timeout: 15000, env: envFor() });
  const cfgPath = join(dataDir, 'config.json');
  assert.equal(run('effort-hint', 'off').status, 0);
  assert.equal(JSON.parse(readFileSync(cfgPath, 'utf8')).effortHint, false);
  assert.match(run('status').stdout, /^effort hint: off$/m);
  assert.equal(run('effort-hint', 'on').status, 0);
  assert.equal(JSON.parse(readFileSync(cfgPath, 'utf8')).effortHint, true);
  assert.match(run('status').stdout, /^effort hint: on$/m);
  const bad = run('effort-hint', 'maybe');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Usage: sprag routing effort-hint on\|off/);
});

test('sprag routing impl: sets implementationFollowUp, refuses a bad value, status shows the line', () => {
  const run = (...args) => spawnSync(process.execPath, [CLI, 'routing', ...args], { cwd: dir, encoding: 'utf8', timeout: 15000, env: envFor() });
  const cfgPath = join(dataDir, 'config.json');
  assert.equal(run('impl', 'off').status, 0);
  assert.equal(JSON.parse(readFileSync(cfgPath, 'utf8')).implementationFollowUp, false);
  assert.match(run('status').stdout, /^Implementation reminder: off$/m);
  assert.equal(implementationFollowUpEnabled(JSON.parse(readFileSync(cfgPath, 'utf8'))), false);
  assert.equal(run('impl', 'on').status, 0);
  assert.equal(JSON.parse(readFileSync(cfgPath, 'utf8')).implementationFollowUp, true);
  assert.match(run('status').stdout, /^Implementation reminder: on$/m);
  assert.equal(implementationFollowUpEnabled({}), true);
  assert.equal(implementationFollowUpEnabled({ routing: false }), false);
  const bad = run('impl', 'maybe');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Usage: sprag routing impl on\|off/);
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, language: 'ko' }));
  const ko = run('status');
  assert.match(ko.stdout, /^구현 분업 상기: 켜짐$/m);
  writeFileSync(cfgPath, JSON.stringify(cfg));
});

test('the statusline records the payload effort per session and not for a bad id', () => {
  const render = (payload) => spawnSync(process.execPath, [CLI, '--statusline'], {
    cwd: dir, encoding: 'utf8', timeout: 30000, input: JSON.stringify(payload), env: envFor(),
  });
  const r = render({ session_id: 'sl-1', effort: { level: 'Medium' }, model: { id: 'claude-opus-4-8', display_name: 'Opus' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readSessionEffort('sl-1', { dir: dataDir }), 'medium');
  render({ session_id: '../sl-bad', effort: { level: 'low' } });
  assert.equal(existsSync(join(dataDir, 'sl-bad')), false);
  assert.equal(existsSync(join(dataDir, 'session-effort', '..', 'sl-bad')), false);
  assert.deepEqual(readdirSync(sessionEffortDir(dataDir)).filter((n) => n.includes('bad')), []);
});
