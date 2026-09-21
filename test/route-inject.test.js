/**
 * Per-request rule injection. Registered rules were going unused — 12 delegations
 * across 337 eligible episodes — partly because applying one meant scanning a rule
 * list and then resolving it against the session's general "don't spawn subagents
 * unless asked" instruction. Stating the match as a fact about the request removes
 * both steps.
 *
 * The risk runs the other way now: a hint on the wrong request costs more than no
 * hint at all, so these tests pin what keeps it quiet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeHint, sessionModelRank } from '../src/route-inject.js';
import { ESCALATE_RE } from '../src/route-scan.js';

const rules = [
  { category: 'check', tier: 'T2', agent: 'haiku-explore', budget: { calls: 8, out: 1500 } },
  { category: 'check', tier: 'T1', agent: 'sonnet', budget: { calls: null, out: 8000 } },
  { category: 'explore', tier: 'T2', agent: 'haiku-explore', budget: { calls: 8, out: 1500 } },
];
// The hint names a subagent only when that agent's .md exists, and it looks in
// two places: the project root and the user's ~/.claude. Which of the two
// phrasings comes out is therefore a property of the developer's setup, not of
// the code — an assertion naming one of them passes locally and fails in CI, or
// the reverse, which is exactly what happened to this file. So the cases below
// pin BOTH lookups at empty directories. Pinning only `root` is not enough: an
// agent installed in the real home still leaks in.
const EMPTY = mkdtempSync(join(tmpdir(), 'cts-noagents-'));

/** Run `fn` with the user agent directory pointed at an empty dir. */
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

test('a classified request names its rule, its target and its cap', () => {
  const out = hint('지금 실행 중인 버전이 뭔지 확인해줘');
  assert.ok(out, 'a check request should match');
  assert.match(out, /상태 확인·검증/, 'names the category');
  assert.match(out, /기본 model: haiku/, 'names the cheap default');
  assert.match(out, /model: sonnet/, 'and the escalation target');
  assert.match(out, /상한 haiku 도구 호출 8회·출력 1500 토큰 \/ sonnet 출력 8000 토큰/);
  assert.match(out, /🔀 \[sprag\] 모델 피팅/, 'carries the same marker line as ratchet-model.md');
});

test('an installed subagent is named, not just its model tier', (t) => {
  // The other half of the same contract: where the agent exists, saying
  // "haiku-explore(model: haiku)" tells the model which agent to spawn, and
  // "model: haiku" leaves it to guess.
  const root = mkdtempSync(join(tmpdir(), 'cts-agents-'));
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(root, '.claude', 'agents', 'haiku-explore.md'), '# haiku-explore\n');
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const out = withoutUserAgents(() => routeHint('지금 실행 중인 버전이 뭔지 확인해줘', { rules, lang: 'ko', root }));
  assert.match(out, /기본 haiku-explore\(model: haiku\)/, 'the agent is named when it is installed');
});

test('one registered tier means one target, not an invented pair', () => {
  const out = hint('이 설정값이 어느 파일에 있는지 찾아줘', {
    rules: rules.filter((r) => r.category === 'explore'),
  });
  assert.ok(out);
  assert.match(out, /model: haiku/);
  assert.doesNotMatch(out, /sonnet/, 'no T1 rule is registered for this category');
});

test('judgement and irreversible work stay on the top tier', () => {
  // ESCALATE_RE is checked before classification: such a request often reads as a
  // light "check" or "run" in its wording.
  for (const text of [
    '이 모듈 구조를 새로 설계해줘',
    '이 코드를 리팩토링하는 게 맞는지 검토해보자',
    '스테이징에 배포해줘',
    'compare these two approaches and pick one',
    // Added 2026-09-20 after a corpus check: these read as run/translate to
    // the keyword tables but publish or ask for a root cause.
    '깃헙 푸시, npm 퍼블리시 진행하자',
    '번역봇이 초대된 이후 채팅이 번역이 안되고 있는데 이유를 확인해보자',
    '마스터로 머지도 진행해둬줘',
  ]) {
    assert.equal(hint(text), null, `should stay quiet: ${text}`);
  }
});

test("'머지' must not match inside '나머지'", () => {
  // "나머지 dismiss" is literally the example on a registered run rule; a bare
  // 머지 in ESCALATE_RE silenced it (7 such prompts in the corpus).
  assert.equal(ESCALATE_RE.test('나머지 진행하자'), false);
  assert.equal(ESCALATE_RE.test('나머지 dismiss'), false);
  assert.equal(ESCALATE_RE.test('머지 진행하자'), true);
});

test('implementation work phrased as a run or a check gets no hint', () => {
  // '설치' and '확인' score for run/check, but the request is to build something.
  for (const text of [
    'korean도 설치와 동시에 설정되도록하자',
    '피드백들 확인해주고 앱 아이콘도 만들자',
    '전부 수정해주고 테스트플라이트에 최종본으로 올려주면 결제 테스트해볼게',
  ]) {
    assert.equal(hint(text), null, `should stay quiet: ${text}`);
  }
  assert.ok(hint('지금 실행 중인 버전이 뭔지 확인해줘'), 'a plain check still hints');
});

test('an unclassifiable request gets no hint', () => {
  // About half of real prompts land here: difficulty mostly surfaces after the
  // first tool call, and at prompt time there are none yet.
  assert.equal(hint('이 로그가 무슨 뜻이야'), null);
  assert.equal(hint('그거 말고 다른 걸로'), null);
});

test('a category with no registered rule gets no hint', () => {
  assert.equal(hint('지금 실행 중인 버전이 뭔지 확인해줘', { rules: [] }), null);
  assert.equal(
    hint('지금 실행 중인 버전이 뭔지 확인해줘', { rules: rules.filter((r) => r.category === 'explore') }),
    null,
    'a rule for a different category must not fire',
  );
});

test('acks and empty prompts are not tasks', () => {
  for (const text of ['ㅇㅇ', 'ok', '', '   ', null, undefined]) {
    assert.equal(hint(text), null, `should stay quiet: ${JSON.stringify(text)}`);
  }
});

test('English renders the same shape', () => {
  const out = hint('check which version is running right now', { lang: 'en' });
  assert.ok(out);
  assert.match(out, /already approved/);
  assert.match(out, /cap haiku 8 tool calls \/ 1500 output tokens/);
  assert.match(out, /model fit/);
});

test('a tier the session cannot profit from is dropped from the hint', () => {
  // The hint used to name both targets whatever the session ran on, so a Sonnet
  // session read "delegate to model: sonnet when it spans multiple steps" — a
  // delegation that saves nothing, stated as an approved rule.
  const CHECK = '지금 실행 중인 버전이 뭔지 확인해줘';

  const opus = hint(CHECK, { sessionRank: 2 });
  assert.match(opus, /model: haiku/, 'an opus session keeps the cheap target');
  assert.match(opus, /model: sonnet/, 'and the escalation target');

  const sonnet = hint(CHECK, { sessionRank: 1 });
  assert.ok(sonnet, 'a sonnet session still delegates downward');
  assert.match(sonnet, /model: haiku/);
  assert.doesNotMatch(sonnet, /sonnet/, 'but is never told to delegate to its own tier');
  assert.doesNotMatch(sonnet, /상한 haiku/, 'and the cap drops with the tier it belonged to');

  // Nothing is cheaper than the cheapest tier.
  assert.equal(hint(CHECK, { sessionRank: 0 }), null);
  // A category registered only at T1 has nothing left to say to a sonnet session.
  const t1Only = rules.filter((r) => r.category === 'check' && r.tier === 'T1');
  assert.equal(hint(CHECK, { rules: t1Only, sessionRank: 1 }), null);
  assert.ok(hint(CHECK, { rules: t1Only, sessionRank: 2 }), 'an opus session still gets it');
});

test('an unknown session model filters nothing', () => {
  // A gateway house alias names no Claude family, and modelRank() prices such a
  // string as Sonnet. Letting that guess through would silence every T1 hint on
  // a gateway, so it is reported as unknown and the hint stays as it was.
  const env = { ANTHROPIC_MODEL: 'prod-large' };
  assert.equal(sessionModelRank({ env, snapshot: null }), null);
  assert.ok(hint('지금 실행 중인 버전이 뭔지 확인해줘', { sessionRank: null }));
});

test('the session model comes from the transcript before the shared snapshot', (t) => {
  // last-caps.json is one file for the whole machine: with two sessions open,
  // whichever ticked last decides what it says. The transcript is per-session.
  const dir = mkdtempSync(join(tmpdir(), 'cts-transcript-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'session.jsonl');
  writeFileSync(file, [
    JSON.stringify({ type: 'user', timestamp: '2026-09-21T00:00:00Z' }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5' } }),
    JSON.stringify({ type: 'assistant', message: { model: '<synthetic>' } }),
  ].join('\n') + '\n');

  const snapshot = { model: 'Haiku 4.5', caps: null };
  assert.equal(
    sessionModelRank({ env: {}, transcriptPath: file, snapshot }), 2,
    'the synthetic stub is skipped and the other session\'s snapshot ignored',
  );
  // With no transcript the snapshot is still better than nothing.
  assert.equal(sessionModelRank({ env: {}, transcriptPath: null, snapshot }), 0);
  assert.equal(sessionModelRank({ env: {}, transcriptPath: null, snapshot: null }), null);
  // The gateway environment outranks the snapshot but not the transcript.
  const env = { ANTHROPIC_MODEL: 'claude-sonnet-4-5' };
  assert.equal(sessionModelRank({ env, transcriptPath: null, snapshot }), 1);
  assert.equal(sessionModelRank({ env, transcriptPath: file, snapshot }), 2);
});
