/**
 * Two kinds of prompt that got a delegation hint and should not have.
 *
 * Measured over 14 days: 25 of 67 `<task-notification>` messages carried a hint,
 * though they are the harness reporting a finished background job, not a request.
 * And a question that asks what the model thinks ("…하는게 좋은가?", "…괜찮지
 * 않을까 싶은데") was routed to a cheaper model by the keywords it happened to
 * contain. On a 28-day corpus the opinion pattern removed 6 of 286 hints and none
 * of the turns that actually delegated.
 *
 * The cases go through routeMatch (the function the hook calls) and
 * codexPromptCategory, so a call site that drops the check fails here too.
 * The "still fires" cases pin the other direction: a request verb next to an
 * opinion ending, or a plain check request, must keep its hint.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeMatch, isSystemPrompt, isOpinionQuestion } from '../src/route-inject.js';
import { codexPromptCategory } from '../src/codex/delegation.js';

// One T2 rule per category the cases can land in, so a null result means the
// gate fired and not that no rule existed.
const rules = ['check', 'run', 'read', 'paste', 'explore'].map((category) => (
  { category, tier: 'T2', agent: 't2-explore', budget: { calls: 8, out: 1500 } }
));
const match = (text) => routeMatch(text, { rules, env: {} });

const TASK_NOTIFICATION = '<task-notification>\n<task-id>bi3nzakjj</task-id>\n<status>completed</status>\n<summary>Background command "Fetch per-request gateway spend logs for Oct 12" completed (exit code 0)</summary>\n</task-notification>';
const OPINIONS = [
  '1번 2회째, 2번 opt-in, 3번 general-purpose, 4번 둘다가 좋을 듯 한데 개인 래칫에 넣어 검증해보고 글로벌 프리셋에 넣을지를 고려하는게 낫겠지?',
  'sprag 사용자가 많지 않아서 그냥 프리셋으로 올려도 괜찮지 않을까 싶은데',
  'nudge 컨셉이 추가된다라,, 단순 모델 위임과 별개 nudge 컨셉을 추가하는게 좋은가?',
];

test('a task notification gets no hint', () => {
  assert.equal(match(TASK_NOTIFICATION), null);
});

test('an opinion question gets no hint', () => {
  for (const text of OPINIONS) assert.equal(match(text), null, text);
});

test('requests that must keep their hint', () => {
  for (const text of [
    '캐시 잘 적용되는지 확인 가능할까?',
    '1번으로 기록 없는 사용량 출처 확인해줘 이 pc 는 주로 claudecode를 사용하기때문에 로컬 기록이 없는게 이상해 원장 기록방식에 홀이 있는건 아닐까?',
    // Already expected to fire by route-inject.test.js.
    '지금 실행 중인 버전이 뭔지 확인해줘',
  ]) {
    assert.ok(match(text), `should still match: ${text}`);
  }
});

test('isSystemPrompt: harness messages yes, pasted user text no', () => {
  for (const text of [
    TASK_NOTIFICATION, '<system-reminder>x</system-reminder>', '  <command-name>/clear</command-name>',
    '<command-message>x</command-message>', '<command-args></command-args>', '<local-command-stdout>x</local-command-stdout>',
    '<bash-input>ls</bash-input>', '<bash-stdout>x</bash-stdout>', '<bash-stderr>x</bash-stderr>', '[Request interrupted by user]',
  ]) assert.equal(isSystemPrompt(text), true, text);
  assert.equal(isSystemPrompt('<pasted_content id="x">\nlog\n</pasted_content> 이 로그 봐줘'), false);
  assert.equal(isSystemPrompt(''), false);
});

test('isOpinionQuestion: a request verb or a plain lookup question is not an opinion', () => {
  for (const text of OPINIONS) assert.equal(isOpinionQuestion(text), true, text);
  assert.equal(isOpinionQuestion('이 설정값 어느 파일에 있어?'), false);
  // The ending is an opinion shape, but the sentence also asks for work.
  assert.equal(isOpinionQuestion('로그 기록 방식에 홀이 있는건 아닐까 확인해줘'), false);
});

test('Codex applies the same two gates', () => {
  assert.equal(codexPromptCategory(TASK_NOTIFICATION), null);
  for (const text of OPINIONS) assert.equal(codexPromptCategory(text), null, text);
  assert.ok(codexPromptCategory('지금 실행 중인 버전이 뭔지 확인해줘'));
});
