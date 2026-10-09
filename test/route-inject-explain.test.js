/**
 * An explanation question that one weak keyword dragged into a category.
 *
 * Reproduced 2026-10-09: "… sprag 기본 preset 설치만으로 … 도구에서 어떻게
 * 쓰이는거지?" scored run on the bare word 설치 (weight 1), tripped neither
 * ESCALATE_RE nor EDIT_RE, and the prompt hook told the model to hand a question
 * about how the tool behaves to a command-running haiku.
 *
 * These cases call routeHint / routeMatch, the functions the hook calls, and one
 * drives the hook itself. A test on the regex alone could not notice the call
 * site dropping the check, which is the failure that matters here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeHint, routeMatch, isExplainQuestion } from '../src/route-inject.js';
import { categorize, categorizeScored } from '../src/route-scan.js';
import { childEnv } from './helpers/child-env.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

const rules = [
  { category: 'run', tier: 'T2', agent: 'haiku-runner', budget: { calls: 8, out: 1500 } },
  { category: 'run', tier: 'T1', agent: 'sonnet', budget: { calls: null, out: 8000 } },
  { category: 'check', tier: 'T2', agent: 'haiku-explore', budget: { calls: 8, out: 1500 } },
  { category: 'read', tier: 'T2', agent: 'haiku-explore', budget: { calls: 8, out: 1500 } },
];

// Same isolation as route-inject.test.js: the hint names an agent only when its
// .md exists, so both lookups are pinned at an empty directory.
const EMPTY = mkdtempSync(join(tmpdir(), 'cts-explain-noagents-'));
function withoutUserAgents(fn) {
  const prev = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  process.env.HOME = EMPTY;
  process.env.USERPROFILE = EMPTY;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.HOME; else process.env.HOME = prev;
    if (prevProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevProfile;
  }
}
const hint = (text, opts = {}) =>
  withoutUserAgents(() => routeHint(text, { rules, lang: 'ko', root: EMPTY, ...opts }));

const REPRO = '논문을 통한 티어표 구분을 통해 sprag 기본 preset 설치만으로 논문을 기반으로 한 티어 구분이 도구에서 어떻게 쓰이는거지?';

test('the reproduced question gets no hint, though the scan still files it under run', () => {
  assert.equal(routeMatch(REPRO, { rules }), null);
  assert.equal(hint(REPRO), null);
  // The offline scan and the statistics are untouched: categorize() keeps
  // returning run for it, on a keyword score of exactly 1.
  assert.equal(categorize(REPRO, {}).id, 'run');
  assert.equal(categorizeScored(REPRO, null).score, 1);
});

test('a command keeps its hint: two or more points, or no question', () => {
  for (const text of ['npm test 돌려봐', 'git push 해줘', '빌드 돌려서 결과 알려줘']) {
    assert.match(hint(text), /명령 실행 \(빌드·테스트·git\)/, `should still hint: ${text}`);
  }
  // A firmly claimed category stays hinted even when the sentence is also a
  // question: npm (2) + 돌려 (1) is not a single weak word.
  assert.ok(categorizeScored('npm test 어떻게 동작하는지 돌려서 보여줘', null).score >= 2);
  assert.match(hint('npm test 어떻게 동작하는지 돌려서 보여줘'), /명령 실행/);
  // The same weak word without a question shape is still a run request.
  assert.match(hint('설치 진행해줘 부탁해요'), /명령 실행/);
});

test('the read category keeps its hint: explaining is what it is for', () => {
  // Its weight-1 keywords (설명, 알려줘, 뭐야) share one pattern, so a question
  // shape says nothing against it, and the registered rule names "…가 뭐야" as
  // its own example. route-inject.test.js pins the statusline case the same way.
  for (const text of ['statusline 이 뭐야? 알려줘', '근무일은 뭐야?', 'how does pipeline handle this, explain']) {
    assert.equal(categorizeScored(text, null).cat.id, 'read', `filed under read: ${text}`);
    assert.match(hint(text), /읽기·요약·설명/, `should still hint: ${text}`);
  }
});

test('English explanation questions are held back the same way', () => {
  assert.equal(hint('how does the build work in this repo'), null);
  assert.equal(hint('what is the status of the rollout', { lang: 'en' }), null);
  // A weak word in a plain request is untouched.
  assert.ok(hint('please run the build for me'));
});

test('a state question keeps the verdict it had before', () => {
  // "어떻게 돼 / 됐" asks for the current state, which is a check request.
  const status = '서버 상태 어떻게 돼?';
  assert.equal(isExplainQuestion(status), false);
  assert.equal(hint(status), null, 'no keyword here, so it was unclassified before and still is');

  // With a weak check keyword the old verdict is a check hint, and it must survive.
  const weak = '서버 체크 어떻게 돼?';
  assert.equal(categorizeScored(weak, null).score, 1);
  assert.equal(isExplainQuestion(weak), false);
  assert.match(hint(weak), /상태 확인·검증/);

  // Even next to a phrase that alone reads as an explanation, the state ask wins.
  const both = '서버 체크 어떻게 되는 거야? 지금 어떻게 돼?';
  assert.equal(isExplainQuestion(both), false);
  assert.match(hint(both), /상태 확인·검증/);
});

test('the shapes that ask how or what something is', () => {
  for (const text of [
    '이 도구에서 어떻게 쓰이는거지?',
    '이게 어떻게 동작하는데?',
    '캐시가 어떻게 작동해?',
    '이 값은 어떻게 되는 거야?',
    '어떤 식으로 적용되는데?',
    '이 플래그는 뭐야?',
    '이게 뭐지',
    '무엇을 하는 명령이야?',
    '이 옵션은 무슨 의미야?',
    'how does it work',
    'how do these rules apply',
    'what is this flag',
    'what does the hook do',
  ]) {
    assert.equal(isExplainQuestion(text), true, `should read as an explanation question: ${text}`);
  }
  for (const text of ['npm test 돌려봐', '서버 상태 어떻게 돼?', '어제 배포가 어떻게 됐어?', '빌드 결과 알려줘', 'run the tests']) {
    assert.equal(isExplainQuestion(text), false, `should not: ${text}`);
  }
});

test('categorize() and categorizeScored() always agree on the category', () => {
  // categorize() is the scan's classifier; the score variant exists for the hint
  // alone. They share one implementation, and this pins that they keep doing so
  // across the branches: keyword win, tool-mix fallback, paste gate, no match.
  const cases = [
    [REPRO, null],
    ['npm test 돌려봐', null],
    ['이 설정값이 어느 파일에 있는지 찾아줘', null],
    ['고쳐줘', { Bash: 5 }],
    ['그거 말고 다른 걸로', null],
    ['x'.repeat(500), null],
  ];
  for (const [text, tools] of cases) {
    const plain = categorize(text, tools);
    const scored = categorizeScored(text, tools);
    assert.equal(scored ? scored.cat : null, plain, `disagreement on: ${text.slice(0, 40)}`);
  }
  // A category that came from the tool mix carries no keyword score, so the
  // weak-word gate can never apply to it.
  assert.equal(categorizeScored('고쳐줘', { Bash: 5 }).score, 0);
});

/**
 * The hook is the real call site. Drive it with a registered run rule: the
 * reproduced question must produce no delegation line and "npm test 돌려봐" must.
 */
test('the prompt hook stays quiet for the reproduced question and still hints a command', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-explain-hook-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  const state = join(dir, 'state');
  const project = join(dir, 'project');
  for (const d of [join(home, '.claude'), join(state, 'claude-token-saver'), project]) {
    mkdirSync(d, { recursive: true });
  }
  writeFileSync(join(state, 'claude-token-saver', 'config.json'), JSON.stringify({ language: 'ko' }) + '\n');
  writeFileSync(join(state, 'claude-token-saver', 'model-rules.json'), JSON.stringify({ rules }) + '\n');

  const run = (prompt) => execFileSync(process.execPath, [CLI, 'brief', '--hook'], {
    cwd: project,
    env: childEnv({ HOME: home, XDG_CONFIG_HOME: state, APPDATA: state, NO_COLOR: '1', CTS_NO_UPDATE_CHECK: '1' }),
    input: JSON.stringify({ session_id: 'explain-q', prompt, cwd: project }),
    encoding: 'utf8',
  });

  assert.doesNotMatch(run(REPRO), /이미 승인한 위임 룰/, 'an explanation question gets no delegation line');
  assert.match(run('npm test 돌려봐'), /위임 룰 "명령 실행 \(빌드·테스트·git\)"/, 'a command still does');
});
