/**
 * The offer to widen delegation when a usage window runs high: once per limit
 * window (not per session), instead of the plain pressure line, and only while
 * delegation is not already relaxed.
 *
 * The hook cases run bin/cli.js against a throwaway HOME and XDG_CONFIG_HOME.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { childEnv } from './helpers/child-env.js';
import { gradeKeys } from './helpers/grade-config.js';
import { claimRelaxOffer, offerWindowId } from '../src/relax-offer.js';
import { pressureLine, relaxOfferLine } from '../src/route-inject.js';
import lint from '../src/korean-lint.cjs';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const PROMPT = '지금 실행 중인 버전이 뭔지 확인해줘';
const RULES = [{ category: 'check', tier: 'T1', agent: 't1-worker', budget: { out: 6000 } }];

test('the offer text is the agreed wording and passes the Korean lint', () => {
  const ko = relaxOfferLine('7D', 82, 'ko');
  assert.equal(ko, '✇ [sprag] 7D 사용량이 82%입니다. 이번 한도 창이 끝날 때까지 위임 범위를 넓히면 사용량을 아낄 수 있습니다. 사용자에게 한 줄로 물어보고, 동의하면 sprag routing relax 를 실행하십시오. 창이 초기화되면 자동으로 원래대로 돌아옵니다.');
  assert.deepEqual(lint.lintKoreanText(ko, { maxFindings: 100 }), []);
  assert.equal(relaxOfferLine('5H', 71, 'en'), '✇ [sprag] 5H usage is at 71%. Widening delegation until this limit window resets would save usage. Ask the user in one line, and if they agree run sprag routing relax. It switches back by itself when the window resets.');
});

test('pressureLine: an offer replaces the plain line, otherwise the plain line stays', () => {
  const high = { level: 'high', pct: 75, key: 'seven_day' };
  assert.equal(pressureLine({ ...high, offer: true }, { lang: 'ko' }), relaxOfferLine('7D', 75, 'ko'));
  assert.equal(pressureLine({ ...high, level: 'critical', pct: 95, offer: true }, { lang: 'ko' }), relaxOfferLine('7D', 95, 'ko'));
  assert.equal(pressureLine(high, { lang: 'ko' }), '한도 압박: 7D 75%. 판단이 애매하면 위임하십시오.');
  assert.match(pressureLine({ ...high, level: 'critical', pct: 95 }, { lang: 'ko' }), /^한도 위험: 7D 95%\./);
  assert.equal(pressureLine({ level: 'normal', pct: 10, key: 'seven_day', offer: true }, { lang: 'ko' }), '');
});

test('claimRelaxOffer is true once per window and again after the window resets', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-relax-offer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const reset = 1_800_000_000;
  assert.equal(claimRelaxOffer(reset, { dir }), true);
  assert.equal(claimRelaxOffer(reset, { dir }), false, 'same window');
  assert.equal(claimRelaxOffer(reset + 3, { dir }), false, 'the reading jitters by seconds');
  assert.equal(claimRelaxOffer(reset + 5 * 3600, { dir }), true, 'next window');
  assert.equal(JSON.parse(readFileSync(join(dir, 'relax-offer.json'), 'utf8')).resetsAt, reset + 5 * 3600);
  // a window without a reset time is bucketed by five hours
  const t0 = 1_800_000_000_000;
  assert.equal(offerWindowId(null, t0), offerWindowId(undefined, t0 + 60_000));
  assert.notEqual(offerWindowId(null, t0), offerWindowId(null, t0 + 6 * 3600 * 1000));
});

function setup(t, config) {
  const dir = mkdtempSync(join(tmpdir(), 'sprag-relax-hook-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const hHome = join(dir, 'home');
  const state = join(dir, 'state');
  const sdir = join(state, 'claude-token-saver');
  const project = join(dir, 'project');
  for (const d of [join(hHome, '.claude'), sdir, project]) mkdirSync(d, { recursive: true });
  writeFileSync(join(sdir, 'config.json'), JSON.stringify({ language: 'ko', ...config }) + '\n');
  writeFileSync(join(sdir, 'model-rules.json'), JSON.stringify({ rules: RULES }) + '\n');
  const caps = (usedPct, resetsAt) => writeFileSync(join(sdir, 'last-caps.json'), JSON.stringify({
    capturedAt: Date.now(), model: null, caps: { windows: [{ key: 'seven_day', usedPct, resetsAt }] },
  }) + '\n');
  const run = (session_id = 's1') => execFileSync(process.execPath, [CLI, 'brief', '--hook'], {
    cwd: project,
    env: childEnv({ HOME: hHome, XDG_CONFIG_HOME: state, APPDATA: state, NO_COLOR: '1', SPRAG_NO_UPDATE_CHECK: '1' }),
    input: JSON.stringify({ session_id, prompt: PROMPT, cwd: project }),
    encoding: 'utf8',
  });
  return { caps, run, sdir };
}

test('the hook offers once per window, across sessions, then falls back to the plain line', (t) => {
  const { caps, run } = setup(t, {});
  const reset = Math.floor(Date.now() / 1000) + 3 * 24 * 3600;
  const plain = run();
  assert.match(plain, /위임 룰/);
  assert.doesNotMatch(plain, /한도|사용량이/, 'no pressure, no line');

  caps(82, reset);
  const first = run('s1');
  assert.ok(first.includes('✇ [sprag] 7D 사용량이 82%입니다.'), first);
  assert.ok(first.includes('sprag routing relax 를 실행하십시오'));
  assert.doesNotMatch(first, /한도 압박/, 'the offer replaces the plain line');

  const second = run('s1');
  assert.match(second, /\n한도 압박: 7D 82%\. 판단이 애매하면 위임하십시오\./, 'same window, same session');
  assert.doesNotMatch(second, /사용량이/);
  assert.match(run('s2'), /한도 압박: 7D 82%/, 'a new session in the same window is not offered again');

  caps(83, reset + 7 * 24 * 3600);
  assert.ok(run('s3').includes('7D 사용량이 83%입니다.'), 'a new window is offered once more');
});

test('critical usage gets the offer too, and below 70 percent there is none', (t) => {
  const { caps, run } = setup(t, {});
  const reset = Math.floor(Date.now() / 1000) + 3600;
  caps(69, reset);
  assert.doesNotMatch(run(), /사용량이/);
  caps(95, reset);
  assert.ok(run().includes('7D 사용량이 95%입니다.'));
});

test('while relaxed the plain pressure lines stay, critical wording included, and nothing is offered', (t) => {
  const { caps, run, sdir } = setup(t, gradeKeys('cost'));
  const reset = Math.floor(Date.now() / 1000) + 3600;
  caps(82, reset);
  const high = run();
  assert.match(high, /\n한도 압박: 7D 82%\. 판단이 애매하면 위임하십시오\./);
  assert.doesNotMatch(high, /사용량이|routing relax/);
  caps(96, reset);
  assert.match(run(), /\n한도 위험: 7D 96%\. /);
  assert.equal(existsOffer(sdir), false, 'no offer was claimed');
});

test('an expired relax window counts as not relaxed', (t) => {
  const { caps, run } = setup(t, { relaxUntil: Date.now() - 1000 });
  caps(82, Math.floor(Date.now() / 1000) + 3600);
  assert.ok(run().includes('7D 사용량이 82%입니다.'));
});

function existsOffer(sdir) {
  try { readFileSync(join(sdir, 'relax-offer.json')); return true; } catch { return false; }
}
