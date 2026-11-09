/**
 * A wrapper (the yaml-sns-agent Slack bot) appends a "[운영 규칙] …" paragraph to
 * every message. At 130 characters it made each prompt read as a long spec, so
 * the delegation hint never fired and the implementation reminder always did.
 * Classification now reads the request without such paragraphs.
 */
import './helpers/grade-cost.js'; // grade 'cost', set before any src module loads
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeMatch, looksLikeImplementation, judgementMatch, stripStandingInstructions } from '../src/route-inject.js';

const rules = ['check', 'run', 'read', 'paste', 'explore'].map((category) => (
  { category, tier: 'T2', target: 'haiku', label: category }
));
const match = (text) => routeMatch(text, { rules, env: {} });

const SUFFIX = '\n\n[운영 규칙] 파일을 수정했다면 반드시 커밋하고 origin main 에 푸시할 것. 작업 종료 전 git status 로 남은 변경이 없는지 확인할 것. npm publish 는 사용자가 명시적으로 요청한 경우에만 수행할 것.';

test('a standing suffix does not hide the delegation hint', () => {
  const ask = '이 함수가 하는 일을 단계별로 정리해줘';
  assert.ok(match(ask), 'baseline: the bare request gets a hint');
  assert.deepEqual(match(ask + SUFFIX), match(ask));
});

test('a standing suffix does not make a request look like implementation', () => {
  assert.equal(looksLikeImplementation('수정은 배포나갔고 이슈 코멘트 달고 닫자' + SUFFIX), false);
  assert.equal(looksLikeImplementation('로그인 API에 refresh 토큰 회전을 추가하고 관련 테스트를 고쳐줘' + SUFFIX), true);
});

test('the suffix words do not turn a request into judgement work', () => {
  assert.deepEqual(judgementMatch('이 함수가 하는 일을 단계별로 정리해줘' + SUFFIX), judgementMatch('이 함수가 하는 일을 단계별로 정리해줘'));
});

test('labelled paragraphs come off both ends; a prompt that is only one stays', () => {
  assert.equal(stripStandingInstructions('[리마인더] 슬랙 업로드 금지\n\n진행해줘\n\n[운영 규칙] 커밋할 것'), '진행해줘');
  assert.equal(stripStandingInstructions('[운영 규칙] 커밋할 것'), '[운영 규칙] 커밋할 것');
  // A bracket inside the request, or a link, is not a label paragraph.
  assert.equal(stripStandingInstructions('진행해줘\n\n[링크](https://x.y) 참고'), '진행해줘\n\n[링크](https://x.y) 참고');
});
