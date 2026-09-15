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
import { routeHint } from '../src/route-inject.js';

const rules = [
  { category: 'check', tier: 'T2', agent: 'haiku-explore', budget: { calls: 8, out: 1500 } },
  { category: 'check', tier: 'T1', agent: 'sonnet', budget: { calls: null, out: 8000 } },
  { category: 'explore', tier: 'T2', agent: 'haiku-explore', budget: { calls: 8, out: 1500 } },
];
const hint = (text, opts = {}) => routeHint(text, { rules, lang: 'ko', ...opts });

test('a classified request names its rule, its target and its cap', () => {
  const out = hint('지금 실행 중인 버전이 뭔지 확인해줘');
  assert.ok(out, 'a check request should match');
  assert.match(out, /상태 확인·검증/, 'names the category');
  assert.match(out, /기본 model: haiku/, 'names the cheap default');
  assert.match(out, /model: sonnet/, 'and the escalation target');
  assert.match(out, /상한 haiku 도구 호출 8회·출력 1500 토큰 \/ sonnet 출력 8000 토큰/);
  assert.match(out, /🔀 \[sprag\] 모델 피팅/, 'carries the same marker line as ratchet-model.md');
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
  ]) {
    assert.equal(hint(text), null, `should stay quiet: ${text}`);
  }
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
